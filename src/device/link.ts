import type { Logger } from '../log.js'
import { REGIONS, SCREEN, type Rect, type RegionId } from './regions.js'
import { toRgb565, type Surface } from '../render/surface.js'
import { normalizeInput, type InputEvent, type RawInputEventName } from './input.js'

export interface LoupedeckLike {
  on(e: string, cb: (p: any) => void): unknown
  removeAllListeners(): unknown
  connect(): Promise<unknown>; close(): unknown
  drawBuffer(o: { id: 'left'; x: number; y: number; width: number; height: number; autoRefresh: false }, b: Buffer): Promise<unknown> | undefined
  refresh(id: 'left'): Promise<unknown> | undefined
  setButtonColor(o: { id: number; color: string }): Promise<unknown> | undefined
  setBrightness(v: number): Promise<unknown> | undefined
  vibrate(p: number): Promise<unknown> | undefined
  getInfo(): Promise<{ serial: string; version: string }>
  reconnectInterval: number
}

export interface DeviceLinkOptions {
  /** Trouve le chemin et construit avec autoConnect:false, reconnectInterval:0. */
  createDevice: () => Promise<LoupedeckLike>
  log: Logger
  connectTimeoutMs?: number
  drawTimeoutMs?: number
  /** Le dernier délai se répète. */
  retryDelaysMs?: number[]
  /** Nombre de régions modifiées à partir duquel on envoie le plein écran (mesure de la Task 1). */
  fullFrameThreshold?: number
}

export type DeviceStatus = 'connected' | 'disconnected'

const LIVE_VENDOR_ID = 0x2ec2
const LIVE_PRODUCT_ID = 0x0004
// Valeurs de HAPTIC (librairie loupedeck). HAPTIC.VERY_LONG (0x76) est interdit.
const HAPTIC_SHORT = 0x01
const HAPTIC_DESCEND_FAST = 0x48
/** Délai maximal accordé à close() pendant stop(). */
const CLOSE_TIMEOUT_MS = 1000

const INPUT_EVENTS: RawInputEventName[] = ['down', 'up', 'rotate', 'touchstart', 'touchmove', 'touchend']
const REGION_ENTRIES = Object.entries(REGIONS) as [RegionId, Rect][]

class TimeoutError extends Error {}
class StoppedError extends Error {}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

function errorText(e: unknown): string {
  return toError(e).message
}

const BUSY_PORT = /access denied|accès refusé|busy|EBUSY|EACCES/i
const BUSY_HINT = 'La console est peut-être occupée par un autre programme. Fermez le logiciel Loupedeck.'

interface PendingTimer { timer: ReturnType<typeof setTimeout>; reject: (e: Error) => void }

/**
 * Enveloppe fiable de la console : délais sur chaque appel, reconnexion avec
 * temporisation croissante, dessin différentiel avec fusion des images en attente.
 */
export class DeviceLink {
  private readonly createDevice: () => Promise<LoupedeckLike>
  private readonly log: Logger
  private readonly connectTimeoutMs: number
  private readonly drawTimeoutMs: number
  private readonly retryDelaysMs: number[]
  private readonly fullFrameThreshold: number

  private started = false
  private stopped = false
  private device: LoupedeckLike | null = null
  private current: DeviceStatus = 'disconnected'
  private firmwareVersion: string | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryIndex = 0
  private readonly timers = new Set<PendingTimer>()

  private readonly inputCbs = new Set<(e: InputEvent) => void>()
  private readonly statusCbs = new Set<(s: DeviceStatus) => void>()

  private pending: Surface | null = null
  private latest: Surface | null = null
  private drawing = false
  private lastSent = new Map<RegionId, Buffer>()

  private readonly leds = new Map<number, string>()
  private brightness = 1

  constructor(o: DeviceLinkOptions) {
    this.createDevice = o.createDevice
    this.log = o.log
    this.connectTimeoutMs = o.connectTimeoutMs ?? 5000
    this.drawTimeoutMs = o.drawTimeoutMs ?? 2000
    this.retryDelaysMs = o.retryDelaysMs && o.retryDelaysMs.length > 0 ? o.retryDelaysMs : [1000, 2000, 5000, 10000, 30000]
    this.fullFrameThreshold = o.fullFrameThreshold ?? 7
  }

  start(): void {
    if (this.started || this.stopped) return
    this.started = true
    void this.attempt()
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    for (const t of this.timers) {
      clearTimeout(t.timer)
      t.reject(new StoppedError('arrêt'))
    }
    this.timers.clear()
    const dev = this.device
    this.device = null
    this.pending = null
    this.lastSent.clear()
    this.setStatus('disconnected')
    if (dev) await this.closeWithin(dev, CLOSE_TIMEOUT_MS)
  }

  status(): DeviceStatus { return this.current }
  firmware(): string | null { return this.firmwareVersion }

  onInput(cb: (e: InputEvent) => void): () => void {
    this.inputCbs.add(cb)
    return () => { this.inputCbs.delete(cb) }
  }

  onStatus(cb: (s: DeviceStatus) => void): () => void {
    this.statusCbs.add(cb)
    return () => { this.statusCbs.delete(cb) }
  }

  present(s: Surface): void {
    this.latest = s
    this.pending = s
    if (this.device && !this.drawing) void this.drain()
  }

  setLed(id: number, color: string): void {
    this.leds.set(id, color)
    const dev = this.device
    if (dev) this.fire('setButtonColor', () => dev.setButtonColor({ id, color }))
  }

  setBrightness(v: number): void {
    this.brightness = Math.max(0, Math.min(1, v))
    const dev = this.device
    if (dev) this.fire('setBrightness', () => dev.setBrightness(this.brightness))
  }

  vibrate(kind: 'ok' | 'error'): void {
    const dev = this.device
    if (dev) this.fire('vibrate', () => dev.vibrate(kind === 'ok' ? HAPTIC_SHORT : HAPTIC_DESCEND_FAST))
  }

  // --- Connexion -----------------------------------------------------------

  private async attempt(): Promise<void> {
    this.retryTimer = null
    if (this.stopped) return
    let candidate: LoupedeckLike | null = null
    let abandoned = false
    const op = (async () => {
      const d = await this.createDevice()
      if (abandoned) {
        this.discard(d)
        throw new Error('tentative abandonnée')
      }
      candidate = d
      // Si la tentative a été abandonnée (délai ou stop()) pendant l'ouverture, le premier close() a pu
      // être sans effet (port pas encore ouvert) : on referme une fois connect() terminé, quelle qu'en soit l'issue.
      try {
        await d.connect()
      } catch (err) {
        if (abandoned) this.discard(d)
        throw err
      }
      if (abandoned) {
        this.discard(d)
        throw new Error('tentative abandonnée')
      }
      return d
    })()
    try {
      const dev = await this.timed(op, this.connectTimeoutMs)
      if (this.stopped) {
        this.discard(dev)
        return
      }
      this.onConnected(dev)
    } catch (err) {
      abandoned = true
      if (candidate) this.discard(candidate)
      if (this.stopped) return
      if (err instanceof TimeoutError) {
        this.log.warn(`Délai de connexion à la console dépassé (${this.connectTimeoutMs} ms). ${BUSY_HINT}`)
      } else {
        const msg = errorText(err)
        const hint = BUSY_PORT.test(msg) ? ` ${BUSY_HINT}` : ''
        this.log.warn(`Connexion à la console impossible.${hint}`, { erreur: msg })
      }
      this.scheduleRetry()
    }
  }

  private onConnected(dev: LoupedeckLike): void {
    this.device = dev
    this.retryIndex = 0
    this.lastSent.clear()
    for (const name of INPUT_EVENTS) {
      dev.on(name, (p) => {
        if (this.device !== dev) return
        const e = normalizeInput(name, p)
        if (e) this.emitInput(e)
      })
    }
    dev.on('disconnect', (err) => {
      if (this.device !== dev) return
      this.lose(dev, 'Console déconnectée', err ? { erreur: errorText(err) } : undefined, 'warn')
    })
    this.log.info('Console connectée')
    this.setStatus('connected')

    this.fire('setBrightness', () => dev.setBrightness(this.brightness))
    for (const [id, color] of this.leds) this.fire('setButtonColor', () => dev.setButtonColor({ id, color }))
    void this.readFirmware(dev)

    if (this.latest) {
      this.pending = this.latest
      if (!this.drawing) void this.drain()
    }
  }

  private async readFirmware(dev: LoupedeckLike): Promise<void> {
    try {
      const info = await this.timed(Promise.resolve().then(() => dev.getInfo()), this.connectTimeoutMs)
      if (this.device !== dev) return
      this.firmwareVersion = info.version
      this.log.info('Micrologiciel de la console', { version: info.version, serie: info.serial })
    } catch (err) {
      if (this.stopped) return
      this.log.warn('Lecture des informations de la console impossible', { erreur: errorText(err) })
    }
  }

  /** Abandonne l'appareil courant et programme une reconnexion. */
  private lose(dev: LoupedeckLike, msg: string, detail: object | undefined, level: 'warn' | 'error'): void {
    if (this.device !== dev || this.stopped) return
    this.device = null
    this.lastSent.clear()
    this.log[level](msg, detail)
    this.discard(dev)
    this.setStatus('disconnected')
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return
    const delay = this.retryDelaysMs[Math.min(this.retryIndex, this.retryDelaysMs.length - 1)]!
    this.retryIndex++
    this.log.debug('Nouvelle tentative de connexion programmée', { delaiMs: delay })
    this.retryTimer = setTimeout(() => { void this.attempt() }, delay)
  }

  /** Fermeture au mieux : close() puis retrait des écouteurs, sans jamais lever. */
  private discard(dev: LoupedeckLike): void {
    try {
      const r = dev.close()
      if (r instanceof Promise) r.catch(() => {})
    } catch { /* fermeture au mieux */ }
    try { dev.removeAllListeners() } catch { /* idem */ }
  }

  private async closeWithin(dev: LoupedeckLike, ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.resolve().then(() => dev.close()).catch(() => {}),
        new Promise<void>((res) => { timer = setTimeout(res, ms) }),
      ])
    } finally {
      clearTimeout(timer)
      try { dev.removeAllListeners() } catch { /* fermeture au mieux */ }
    }
  }

  // --- Dessin --------------------------------------------------------------

  private async drain(): Promise<void> {
    this.drawing = true
    try {
      while (this.pending && this.device) {
        const dev = this.device
        const s = this.pending
        this.pending = null
        try {
          const bufs = new Map<RegionId, Buffer>()
          for (const [id, rect] of REGION_ENTRIES) bufs.set(id, toRgb565(s, rect))
          const changed = this.lastSent.size === 0
            ? REGION_ENTRIES
            : REGION_ENTRIES.filter(([id]) => !this.lastSent.get(id)!.equals(bufs.get(id)!))
          if (changed.length === 0) continue
          if (changed.length >= this.fullFrameThreshold) {
            await this.write(dev, SCREEN, toRgb565(s, SCREEN))
          } else {
            for (const [id, rect] of changed) await this.write(dev, rect, bufs.get(id)!)
          }
          await this.timed(dev.refresh('left'), this.drawTimeoutMs)
          if (this.device === dev) {
            // Repère pour le diagnostic : une fois par connexion.
            if (this.lastSent.size === 0) this.log.info('Première image affichée sur la console')
            this.lastSent = bufs
          }
        } catch (err) {
          if (this.stopped) return
          const detail = { erreur: errorText(err) }
          const msg = err instanceof TimeoutError
            ? `La console ne répond plus (dessin > ${this.drawTimeoutMs} ms)`
            : 'Échec du dessin sur la console'
          this.lose(dev, msg, detail, 'error')
        }
      }
    } finally {
      this.drawing = false
    }
  }

  private write(dev: LoupedeckLike, r: Rect, buf: Buffer): Promise<unknown> {
    return this.timed(
      dev.drawBuffer({ id: 'left', x: r.x, y: r.y, width: r.width, height: r.height, autoRefresh: false }, buf),
      this.drawTimeoutMs,
    )
  }

  // --- Utilitaires ---------------------------------------------------------

  /** Course contre un délai ; le minuteur est suivi pour que stop() le supprime. */
  private timed<T>(p: Promise<T> | T, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: PendingTimer = {
        timer: setTimeout(() => {
          this.timers.delete(entry)
          reject(new TimeoutError(`délai de ${ms} ms dépassé`))
        }, ms),
        reject,
      }
      this.timers.add(entry)
      Promise.resolve(p).then(
        (v) => { clearTimeout(entry.timer); this.timers.delete(entry); resolve(v) },
        (e) => { clearTimeout(entry.timer); this.timers.delete(entry); reject(toError(e)) },
      )
    })
  }

  /** Appel « tire et oublie » : une erreur synchrone ou asynchrone est journalisée, jamais propagée. */
  private fire(what: string, call: () => Promise<unknown> | undefined): void {
    const report = (e: unknown) => this.log.warn('Commande refusée par la console', { commande: what, erreur: errorText(e) })
    try {
      const r = call()
      if (r) r.catch(report)
    } catch (e) {
      report(e)
    }
  }

  private setStatus(s: DeviceStatus): void {
    if (s === this.current) return
    this.current = s
    for (const cb of [...this.statusCbs]) {
      try { cb(s) } catch (e) { this.log.error("Erreur dans un abonné à l'état de la console", { erreur: errorText(e) }) }
    }
  }

  private emitInput(e: InputEvent): void {
    for (const cb of [...this.inputCbs]) {
      try { cb(e) } catch (err) { this.log.error('Erreur dans le traitement d’une entrée', { erreur: errorText(err) }) }
    }
  }
}

export function findLivePath(
  list: { path: string; vendorId: number; productId: number }[],
  configured: string | null,
): string | null {
  if (configured) return configured
  return list.find((d) => d.vendorId === LIVE_VENDOR_ID && d.productId === LIVE_PRODUCT_ID)?.path ?? null
}

export function createLoupedeckFactory(configuredPath: string | null): () => Promise<LoupedeckLike> {
  return async () => {
    // Import différé : la librairie charge serialport (module natif) ; inutile tant qu'on ne se connecte pas.
    const { LoupedeckLive } = await import('loupedeck')
    const path = findLivePath(await LoupedeckLive.list({ ignoreWebsocket: true }), configuredPath)
    if (!path) throw new Error('Loupedeck Live introuvable')
    return new LoupedeckLive({ path, autoConnect: false, reconnectInterval: 0 })
  }
}
