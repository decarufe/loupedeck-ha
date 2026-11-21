import {
  callService as haCallService,
  createConnection,
  createLongLivedTokenAuth,
  ERR_CANNOT_CONNECT,
  ERR_HASS_HOST_REQUIRED,
  ERR_INVALID_AUTH,
  isConnectionLost,
  subscribeEntities,
  type Connection,
  type ConnectionOptions,
  type HaWebSocket,
  type HassEntities,
} from 'home-assistant-js-websocket'
import { Agent, fetch } from 'undici'
import WebSocket from 'ws'
import type { Logger } from '../log.js'
import { isDimmable, type EntityInfo } from '../shared/placement.js'
import { CameraImageError, OFFLINE_MESSAGE, type Forecast, type ForecastType, type HaEntity, type HaPort, type HaStatus } from './types.js'

/** Délai maximal de la phase d'ouverture + authentification d'une socket. */
const AUTH_TIMEOUT_MS = 10_000
const CAMERA_TIMEOUT_MS = 5000
const DEFAULT_RETRY_DELAY_MS = 5000
/** Ping périodique : détecte une connexion à moitié ouverte (socket ouverte, plus rien ne revient). */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** `http(s)://hôte:port[/]` → `ws(s)://hôte:port/api/websocket`. */
export function toWebSocketUrl(httpUrl: string): string {
  const base = stripTrailingSlash(httpUrl.trim())
  const m = /^(https?):\/\/(.+)$/i.exec(base)
  if (!m) throw new Error(`URL Home Assistant invalide : ${httpUrl} (attendu http:// ou https://)`)
  return `${m[1].toLowerCase() === 'https' ? 'wss' : 'ws'}://${m[2]}/api/websocket`
}

function atLeastVersion(version: string | undefined, major: number, minor: number): boolean {
  if (!version) return false
  const [ma, mi] = version.split('.').map((p) => Number.parseInt(p, 10))
  return ma > major || (ma === major && mi >= minor)
}

/** Décrit une erreur sans jamais inclure d'en-têtes ni de jeton : code de la librairie ou message seul. */
function describe(err: unknown): string {
  if (err === ERR_INVALID_AUTH) return 'ERR_INVALID_AUTH'
  if (err === ERR_CANNOT_CONNECT) return 'ERR_CANNOT_CONNECT'
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null) {
    const e = err as { message?: unknown; code?: unknown; error?: { message?: unknown; code?: unknown } }
    const msg = e.message ?? e.error?.message ?? e.code ?? e.error?.code
    if (msg !== undefined) return String(msg)
  }
  return String(err)
}

type Scrub = (s: string) => string

/**
 * Masque le jeton (entier, et chacun de ses morceaux s'il contient des retours à la ligne) dans un texte.
 * Défense en profondeur : appliqué à tout message d'erreur produit et à tout appel au journal.
 */
function makeScrubber(token: string): Scrub {
  const secrets = [token, ...token.split(/[\r\n\0]+/)].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length)
  return (s) => secrets.reduce((acc, secret) => acc.split(secret).join('[jeton masqué]'), s)
}

function scrubbingLogger(log: Logger, scrub: Scrub): Logger {
  const clean = (o?: object): object | undefined => {
    if (o === undefined) return undefined
    try {
      return JSON.parse(JSON.stringify(o, (_k, v: unknown) => (typeof v === 'string' ? scrub(v) : v))) as object
    } catch {
      return { note: 'détails non journalisables' }
    }
  }
  return {
    debug: (m, o) => log.debug(scrub(m), clean(o)),
    info: (m, o) => log.info(scrub(m), clean(o)),
    warn: (m, o) => log.warn(scrub(m), clean(o)),
    error: (m, o) => log.error(scrub(m), clean(o)),
  }
}

/**
 * Les rejets de la librairie sont des objets `{code, message}` : on les convertit en Error lisible.
 * Toujours une nouvelle Error au message nettoyé, pour qu'aucune pile d'origine ne transporte le jeton.
 */
function toError(err: unknown, scrub: Scrub): Error {
  if (isConnectionLost(err)) return new Error(OFFLINE_MESSAGE)
  if (err instanceof Error && err.message === OFFLINE_MESSAGE) return new Error(OFFLINE_MESSAGE)
  return new Error(`Home Assistant : ${scrub(describe(err))}`)
}

/** Fetch interrompu par `AbortSignal.timeout` (TimeoutError) ou une annulation. */
function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

const INVALID_TOKEN_CHARS = /[\r\n\0]/

/**
 * `createSocket` pour `createConnection`, basé sur le paquet `ws` (Node).
 * Même contrat que celui de la librairie avec `setupRetry: 0` (seule valeur utilisée, y compris par
 * `Connection` lors des reconnexions) : une seule tentative ; `auth_invalid` → rejet `ERR_INVALID_AUTH` ;
 * erreur, fermeture ou délai dépassé avant `auth_ok` → rejet `ERR_CANNOT_CONNECT`. Les nouvelles tentatives
 * sont gérées par l'appelant (HaClient au démarrage, Connection après une coupure).
 */
function makeCreateSocket(wsUrl: string, allowSelfSigned: boolean, log: Logger) {
  return (options: ConnectionOptions): Promise<HaWebSocket> =>
    new Promise<HaWebSocket>((resolve, reject) => {
      const auth = options.auth
      if (!auth) {
        reject(ERR_HASS_HOST_REQUIRED)
        return
      }
      const socket = new WebSocket(wsUrl, { rejectUnauthorized: !allowSelfSigned, handshakeTimeout: AUTH_TIMEOUT_MS })
      // Écouteur permanent : un 'error' sans écouteur ferait planter le processus. 'close' suit toujours.
      socket.on('error', (e) => log.debug('WebSocket Home Assistant : erreur', { message: e.message }))
      let settled = false
      const timer = setTimeout(() => fail(ERR_CANNOT_CONNECT), AUTH_TIMEOUT_MS)
      const cleanup = () => {
        settled = true
        clearTimeout(timer)
        socket.off('message', onMessage)
        socket.off('error', onFailure)
        socket.off('close', onFailure)
      }
      const fail = (code: number) => {
        if (settled) return
        cleanup()
        socket.terminate()
        reject(code)
      }
      const onFailure = () => fail(ERR_CANNOT_CONNECT)
      const onMessage = (data: WebSocket.RawData) => {
        let msg: { type?: string; ha_version?: string }
        try {
          msg = JSON.parse(data.toString())
        } catch {
          fail(ERR_CANNOT_CONNECT)
          return
        }
        switch (msg.type) {
          case 'auth_required':
            socket.send(JSON.stringify({ type: 'auth', access_token: auth.accessToken }))
            return
          case 'auth_invalid':
            fail(ERR_INVALID_AUTH)
            return
          case 'auth_ok': {
            cleanup()
            const haSocket = socket as unknown as HaWebSocket
            haSocket.haVersion = msg.ha_version ?? ''
            if (atLeastVersion(haSocket.haVersion, 2022, 9)) {
              socket.send(JSON.stringify({ type: 'supported_features', id: 1, features: { coalesce_messages: 1 } }))
            }
            resolve(haSocket)
            return
          }
        }
      }
      socket.on('message', onMessage)
      socket.on('error', onFailure)
      socket.on('close', onFailure)
    })
}

export interface HaClientOptions {
  url: string
  token: string
  allowSelfSigned: boolean
  log: Logger
  /** Délai entre deux tentatives de connexion initiale (hors refus du jeton). */
  retryDelayMs?: number
  /** Intervalle entre deux `ping` (30 s par défaut). */
  heartbeatIntervalMs?: number
  /** Délai maximal d'attente du `pong` (10 s par défaut) ; au-delà : hors ligne puis reconnexion forcée. */
  heartbeatTimeoutMs?: number
}

interface RegistryEntity {
  entity_id: string
  name?: string | null
  area_id?: string | null
  device_id?: string | null
  icon?: string | null
  device_class?: string | null
  original_device_class?: string | null
}
interface RegistryDevice { id: string; area_id?: string | null }
interface RegistryArea { area_id: string; name: string }

export class HaClient implements HaPort {
  private readonly base: string
  private readonly wsUrl: string
  private readonly token: string
  private readonly allowSelfSigned: boolean
  private readonly log: Logger
  private readonly retryDelayMs: number
  private readonly heartbeatIntervalMs: number
  private readonly heartbeatTimeoutMs: number
  private heartbeatTimer: NodeJS.Timeout | null = null
  private pingInFlight = false
  /** Incrémenté à chaque arrêt de la minuterie : un ping d'une génération périmée est ignoré. */
  private heartbeatGen = 0
  private readonly dispatcher: Agent | undefined
  private conn: Connection | null = null
  private current: HaStatus = { state: 'connecting', reason: null }
  private states: Record<string, HaEntity> = {}
  private readonly entityListeners = new Set<(e: Record<string, HaEntity>) => void>()
  private readonly statusListeners = new Set<(s: HaStatus) => void>()
  private readonly scrub: Scrub
  /** Jeton contenant CR/LF/NUL après rognage : configuration invalide, on ne l'envoie jamais. */
  private readonly tokenInvalid: boolean
  private retryTimer: NodeJS.Timeout | null = null
  private started = false
  private closed = false

  constructor(o: HaClientOptions) {
    this.base = stripTrailingSlash(o.url.trim())
    this.wsUrl = toWebSocketUrl(this.base)
    this.token = o.token.trim()
    this.tokenInvalid = INVALID_TOKEN_CHARS.test(this.token)
    this.scrub = makeScrubber(this.token)
    this.allowSelfSigned = o.allowSelfSigned
    this.log = scrubbingLogger(o.log, this.scrub)
    this.retryDelayMs = o.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    this.heartbeatIntervalMs = o.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.heartbeatTimeoutMs = o.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS
    this.dispatcher = o.allowSelfSigned ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined
  }

  start(): void {
    if (this.started || this.closed) return
    this.started = true
    if (this.tokenInvalid) {
      this.log.error('Jeton Home Assistant invalide (retour à la ligne ou caractère nul) : corrigez-le dans la configuration')
      this.setStatus({ state: 'offline', reason: 'auth' })
      return
    }
    this.runConnect()
  }

  status(): HaStatus {
    return this.current
  }

  entities(): Record<string, HaEntity> {
    return this.states
  }

  onEntities(cb: (e: Record<string, HaEntity>) => void): () => void {
    this.entityListeners.add(cb)
    return () => { this.entityListeners.delete(cb) }
  }

  onStatus(cb: (s: HaStatus) => void): () => void {
    this.statusListeners.add(cb)
    return () => { this.statusListeners.delete(cb) }
  }

  async callService(domain: string, service: string, data?: object, target?: { entity_id: string }): Promise<void> {
    const conn = this.requireConn()
    try {
      await haCallService(conn, domain, service, data, target)
    } catch (err) {
      throw toError(err, this.scrub)
    }
  }

  async getForecasts(entityId: string, type: ForecastType): Promise<Forecast[]> {
    const conn = this.requireConn()
    let res: { response?: Record<string, { forecast?: unknown }> } | undefined
    try {
      res = (await haCallService(conn, 'weather', 'get_forecasts', { type }, { entity_id: entityId }, true)) as typeof res
    } catch (err) {
      throw toError(err, this.scrub)
    }
    const list = res?.response?.[entityId]?.forecast
    if (!Array.isArray(list)) throw new Error(`Prévisions absentes de la réponse pour ${entityId}`)
    return list.map((f: Record<string, any>) => ({
      datetime: String(f.datetime),
      condition: String(f.condition),
      temperature: Number(f.temperature),
      templow: typeof f.templow === 'number' ? f.templow : null,
    }))
  }

  async listEntityInfo(): Promise<EntityInfo[]> {
    const conn = this.requireConn()
    let registry: RegistryEntity[]
    let devices: RegistryDevice[]
    let areas: RegistryArea[]
    try {
      ;[registry, devices, areas] = await Promise.all([
        conn.sendMessagePromise<RegistryEntity[]>({ type: 'config/entity_registry/list' }),
        conn.sendMessagePromise<RegistryDevice[]>({ type: 'config/device_registry/list' }),
        conn.sendMessagePromise<RegistryArea[]>({ type: 'config/area_registry/list' }),
      ])
    } catch (err) {
      throw toError(err, this.scrub)
    }
    const regById = new Map(registry.map((r) => [r.entity_id, r]))
    const deviceArea = new Map(devices.map((d) => [d.id, d.area_id ?? null]))
    const areaName = new Map(areas.map((a) => [a.area_id, a.name]))
    return Object.values(this.states).map((s): EntityInfo => {
      const reg = regById.get(s.entity_id)
      const attrs = s.attributes ?? {}
      const areaId = reg?.area_id ?? (reg?.device_id ? deviceArea.get(reg.device_id) ?? null : null)
      return {
        entityId: s.entity_id,
        name: attrs.friendly_name ?? reg?.name ?? s.entity_id,
        domain: s.entity_id.split('.')[0],
        areaName: areaId ? areaName.get(areaId) ?? null : null,
        state: s.state,
        dimmable: isDimmable(attrs),
        deviceClass: attrs.device_class ?? reg?.device_class ?? reg?.original_device_class ?? null,
        icon: attrs.icon ?? reg?.icon ?? null,
      }
    })
  }

  async fetchCameraImage(entityId: string, size: { width: number; height: number }, signal?: AbortSignal): Promise<Buffer> {
    if (this.tokenInvalid) throw new CameraImageError('Configuration invalide (jeton)')
    const url = `${this.base}/api/camera_proxy/${encodeURIComponent(entityId)}?width=${size.width}&height=${size.height}`
    try {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(CAMERA_TIMEOUT_MS)]) : AbortSignal.timeout(CAMERA_TIMEOUT_MS),
        dispatcher: this.dispatcher,
      })
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined)
        throw new CameraImageError(`Image caméra refusée par Home Assistant pour ${entityId} (HTTP ${res.status})`)
      }
      const type = res.headers.get('content-type') ?? ''
      if (!type.startsWith('image/')) {
        await res.body?.cancel().catch(() => undefined)
        throw new CameraImageError(this.scrub(`Réponse inattendue pour la caméra ${entityId} (type ${type || 'inconnu'})`))
      }
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      if (err instanceof CameraImageError) throw err
      // Jamais le message brut de fetch/undici : il peut recopier la valeur de l'en-tête Authorization.
      if (signal?.aborted) throw new CameraImageError('Requête caméra annulée')
      throw new CameraImageError(isTimeout(err) ? "Délai dépassé pour l'image de la caméra" : 'Caméra injoignable')
    }
  }

  close(): void {
    this.closed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.stopHeartbeat()
    this.entityListeners.clear()
    this.statusListeners.clear()
    // On ne désabonne pas la collection d'entités : son désabonnement arme un minuteur de 5 s dans la
    // librairie. La connexion fermée n'émettra plus rien, et le rappel ignore toute connexion périmée.
    const conn = this.conn
    this.conn = null
    conn?.close()
    void this.dispatcher?.close().catch(() => undefined)
    this.current = { state: 'offline', reason: 'network' }
  }

  private startHeartbeat(conn: Connection): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => this.heartbeat(conn), this.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.pingInFlight = false
    this.heartbeatGen++
  }

  private heartbeat(conn: Connection): void {
    if (this.closed || this.conn !== conn || !conn.connected) {
      this.stopHeartbeat()
      return
    }
    if (this.pingInFlight) return
    this.pingInFlight = true
    const gen = this.heartbeatGen
    let timer: NodeJS.Timeout | undefined
    const timedOut = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), this.heartbeatTimeoutMs) })
    const pong = conn.ping().then(() => 'pong' as const, () => 'lost' as const)
    void Promise.race([pong, timedOut]).then((outcome) => {
      clearTimeout(timer)
      if (this.conn !== conn || this.closed || gen !== this.heartbeatGen) return
      this.pingInFlight = false
      if (outcome !== 'timeout') return
      // Une perte de connexion ('lost') est gérée par l'événement 'disconnected' de la librairie.
      this.log.warn(`Home Assistant ne répond plus (aucun pong en ${this.heartbeatTimeoutMs} ms), reconnexion forcée`)
      this.stopHeartbeat()
      this.setStatus({ state: 'offline', reason: 'network' })
      conn.reconnect(true)
    })
  }

  private requireConn(): Connection {
    if (!this.conn || this.current.state !== 'online') throw new Error(OFFLINE_MESSAGE)
    return this.conn
  }

  private setStatus(s: HaStatus): void {
    if (this.closed) return
    if (s.state === this.current.state && s.reason === this.current.reason) return
    this.current = s
    this.notify(this.statusListeners, s, 'onStatus')
  }

  /** Appelle chaque écouteur isolément : une exception est journalisée sans gêner les autres ni la connexion. */
  private notify<T>(listeners: Set<(v: T) => void>, value: T, kind: string): void {
    for (const cb of [...listeners]) {
      try {
        cb(value)
      } catch (err) {
        this.log.error(`Un écouteur ${kind} a levé une exception`, { message: this.scrub(describe(err)) })
      }
    }
  }

  private runConnect(): void {
    this.connect().catch((err: unknown) => {
      this.log.error('Erreur inattendue pendant la connexion à Home Assistant', { message: this.scrub(describe(err)) })
    })
  }

  private async connect(): Promise<void> {
    this.retryTimer = null
    let conn: Connection
    try {
      conn = await createConnection({
        auth: createLongLivedTokenAuth(this.base, this.token),
        createSocket: makeCreateSocket(this.wsUrl, this.allowSelfSigned, this.log),
      })
    } catch (err) {
      if (this.closed) return
      if (err === ERR_INVALID_AUTH) {
        this.log.error('Home Assistant a refusé le jeton : vérifiez-le dans la configuration', { code: 'ERR_INVALID_AUTH' })
        this.setStatus({ state: 'offline', reason: 'auth' })
        return
      }
      const reason = describe(err)
      if (this.current.state === 'offline') {
        this.log.debug('Home Assistant toujours injoignable', { reason })
      } else {
        this.log.warn(`Home Assistant injoignable, nouvelle tentative toutes les ${this.retryDelayMs} ms`, { url: this.base, reason })
      }
      // Programmer la nouvelle tentative avant de notifier.
      this.retryTimer = setTimeout(() => this.runConnect(), this.retryDelayMs)
      this.setStatus({ state: 'offline', reason: 'network' })
      return
    }
    if (this.closed) {
      conn.close()
      return
    }
    this.conn = conn
    conn.addEventListener('ready', () => {
      if (this.conn !== conn) return
      this.log.info('Home Assistant reconnecté')
      this.setStatus({ state: 'online', reason: null })
      this.startHeartbeat(conn)
    })
    conn.addEventListener('disconnected', () => {
      if (this.conn !== conn) return
      this.stopHeartbeat()
      this.log.warn('Connexion à Home Assistant perdue, reconnexion automatique')
      this.setStatus({ state: 'offline', reason: 'network' })
    })
    conn.addEventListener('reconnect-error', (_c, err) => {
      if (this.conn !== conn || err !== ERR_INVALID_AUTH) return
      this.log.error('Home Assistant a refusé le jeton à la reconnexion : vérifiez-le dans la configuration', { code: 'ERR_INVALID_AUTH' })
      this.stopHeartbeat()
      this.conn = null
      conn.close()
      this.setStatus({ state: 'offline', reason: 'auth' })
    })
    subscribeEntities(conn, (ents: HassEntities) => {
      if (this.conn !== conn) return
      this.states = ents
      this.notify(this.entityListeners, ents, 'onEntities')
    })
    this.log.info('Connecté à Home Assistant', { url: this.base, haVersion: conn.haVersion })
    this.setStatus({ state: 'online', reason: null })
    this.startHeartbeat(conn)
  }
}
