import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import fastifyWebsocket from '@fastify/websocket'
import Fastify, { type FastifyReply } from 'fastify'
import { appConfigSchema, KNOB_IDS, type AppConfig, type KnobId, type Tile } from '../config/schema.js'
import type { InputEvent, TapTarget } from '../device/input.js'
import { ConfigStore, ConfigValidationError } from '../config/store.js'
import type { DeviceLink } from '../device/link.js'
import type { HaPort } from '../ha/types.js'
import type { Logger } from '../log.js'
import type { Navigator } from '../navigator.js'
import { paint } from '../render/painters.js'
import { createSurface, toPng } from '../render/surface.js'
import { canPlace, type EntityInfo, type SlotKind } from '../shared/placement.js'
import type { View } from '../views.js'

export type LiveMessage = { type: 'config' } | { type: 'active'; button: number } | { type: 'status' } | { type: 'entities' } | { type: 'preview' }
export type PublicConfig = Omit<AppConfig, 'ha'> & {
  ha: { url: string; allowSelfSigned: boolean; hasToken: boolean }
  loadWarning: string | null
}

export interface EditorServerDeps {
  store: ConfigStore
  ha: () => HaPort
  navigator: () => Navigator | null
  device: () => DeviceLink
  port: number
  staticDir: string
  log: Logger
  /** Délai maximal de la liste des entités lors d'un PUT (défaut 3000 ms). */
  entityTimeoutMs?: number
}

export interface EditorServer {
  url: string
  close(): Promise<void>
  notify(m: LiveMessage): void
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
}

const HOST = '127.0.0.1'
const STILL_SIZE = { width: 480, height: 270 }

const NOT_BUILT_PAGE = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Éditeur Loupedeck</title></head>
<body style="font-family:sans-serif;margin:3rem">
<h1>Éditeur non compilé</h1>
<p>Éditeur non compilé — lancez <code>pnpm run editor:build</code>.</p>
</body></html>`

const issuesOf = (error: { issues: { path: PropertyKey[]; message: string }[] }): string[] =>
  error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`)

function publicConfig(store: ConfigStore): PublicConfig {
  const { ha, ...rest } = store.get()
  return {
    ...structuredClone(rest),
    ha: { url: ha.url, allowSelfSigned: ha.allowSelfSigned, hasToken: ha.token.trim() !== '' },
    loadWarning: store.loadWarning,
  }
}

/** Fichier d'export des réglages : toute la configuration sauf le jeton. */
export const EXPORT_FORMAT = 'loupedeck-ha'

function exportSettings(store: ConfigStore) {
  const { ha, ...rest } = store.get()
  return { format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), config: { ...rest, ha: { url: ha.url, allowSelfSigned: ha.allowSelfSigned } } }
}

/** Configuration contenue dans un fichier importé : un export, ou une copie de config.json. */
function settingsOf(file: unknown): { ha: Record<string, unknown>; rest: Record<string, unknown> } | null {
  if (!isRecord(file)) return null
  if (file.format !== undefined && file.format !== EXPORT_FORMAT) return null
  const config = file.format === EXPORT_FORMAT ? file.config : file
  if (!isRecord(config) || !isRecord(config.ha) || !Array.isArray(config.buttons)) return null
  const { ha, ...rest } = config
  return { ha: ha as Record<string, unknown>, rest }
}

const normUrl = (u: unknown) => (typeof u === 'string' ? u.trim().replace(/\/+$/, '') : u)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Geste du mode Essayer, validé champ par champ (rien d'autre n'atteint la page). */
export function parseInput(v: unknown): InputEvent | null {
  if (!isRecord(v)) return null
  const target = (t: unknown): TapTarget | null => {
    if (!isRecord(t)) return null
    if (t.kind === 'key' && Number.isInteger(t.index) && (t.index as number) >= 0 && (t.index as number) < 12) return { kind: 'key', index: t.index as number }
    if (t.kind === 'strip' && (t.side === 'left' || t.side === 'right') && [0, 1, 2].includes(t.zone as number)) return { kind: 'strip', side: t.side, zone: t.zone as 0 | 1 | 2 }
    return null
  }
  const knob = (k: unknown): KnobId | null => ((KNOB_IDS as readonly unknown[]).includes(k) ? (k as KnobId) : null)
  switch (v.type) {
    case 'tap':
    case 'release': {
      const t = target(v.target)
      return t ? { type: v.type, target: t } : null
    }
    case 'knobTurn': {
      const k = knob(v.knob)
      const delta = v.delta
      return k && typeof delta === 'number' && Number.isInteger(delta) && delta !== 0 && Math.abs(delta) <= 10 ? { type: 'knobTurn', knob: k, delta } : null
    }
    case 'knobPress': {
      const k = knob(v.knob)
      return k ? { type: 'knobPress', knob: k } : null
    }
    default:
      return null
  }
}

/** Vérifie chaque emplacement contre les entités connues ; une entité inconnue est acceptée. */
function placementIssues(cfg: AppConfig, known: Map<string, EntityInfo>): string[] {
  const issues: string[] = []
  const check = (where: string, kind: SlotKind, entityId: string | null | undefined) => {
    if (!entityId) return
    const info = known.get(entityId)
    if (!info) return
    const r = canPlace(kind, info)
    if (!r.ok) issues.push(`${where} (${entityId}) : ${r.reason}`)
  }
  cfg.buttons.forEach((b, i) => {
    if (!b) return
    const t = `Bouton ${i + 1}`
    switch (b.type) {
      case 'custom': {
        const tileCheck = (where: string, tile: Tile | null) => {
          if (tile && tile.kind !== 'clock') check(where, tile.kind, tile.entityId)
        }
        b.keys.forEach((k, j) => tileCheck(`${t}, touche ${j + 1}`, k))
        for (const knob of KNOB_IDS) tileCheck(`${t}, molette ${knob}`, b.strips[knob])
        break
      }
      case 'graph':
        check(`${t}, graphique`, 'graph', b.entityId)
        break
      case 'climate':
        check(`${t}, thermostat`, 'climate', b.entityId)
        b.sensors.forEach((s, j) => check(`${t}, capteur ${j + 1}`, 'sensor', s.entityId))
        break
      case 'weather':
        check(`${t}, météo`, 'weather', b.entityId)
        break
      case 'camera':
        check(`${t}, caméra`, 'camera', b.entityId)
        break
    }
  })
  return issues
}

export async function startEditorServer(d: EditorServerDeps): Promise<EditorServer> {
  const app = Fastify({ logger: false, forceCloseConnections: true })
  const sockets = new Set<import('ws').WebSocket>()
  let boundPort = d.port
  const connections = new Set<import('node:net').Socket>()
  app.server.on('connection', (c) => { connections.add(c); c.on('close', () => connections.delete(c)) })
  const stills = new Map<string, Buffer>()

  const allowedHost = (host: string | undefined): boolean => {
    if (!host) return false
    const names = [HOST, 'localhost']
    return names.some((n) => host === n || host === `${n}:${boundPort}`)
  }

  const allowedOrigin = (origin: string): boolean =>
    [HOST, 'localhost'].some((n) => origin === `http://${n}:${boundPort}`)

  app.addHook('onRequest', async (req, reply) => {
    if (!allowedHost(req.headers.host)) return reply.code(403).send({ error: 'Hôte non autorisé' })
    const origin = req.headers.origin
    // Protège du CSRF et du détournement du WebSocket par un autre site (le Host seul ne suffit pas).
    if (origin !== undefined && !allowedOrigin(origin)) return reply.code(403).send({ error: 'Origine non autorisée' })
    if (req.method !== 'GET' && req.method !== 'HEAD' && origin === undefined && req.headers['x-loupedeck-editor'] !== '1') {
      return reply.code(403).send({ error: 'Requête non autorisée' })
    }
  })

  const notifyAll = (m: LiveMessage) => {
    const text = JSON.stringify(m)
    for (const s of sockets) if (s.readyState === s.OPEN) s.send(text)
  }

  await app.register(fastifyWebsocket)

  app.get('/api/live', { websocket: true }, (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => sockets.delete(socket))
  })

  app.get('/api/config', async () => publicConfig(d.store))

  app.put('/api/config', async (req, reply) => {
    const bad = (error: string, issues?: string[]) => reply.code(400).send(issues ? { error, issues } : { error })
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return reply.code(415).send({ error: 'Content-Type application/json requis' })
    }
    const input = req.body
    if (!isRecord(input)) return bad('Corps de requête invalide', ['(racine) : objet attendu'])
    if ('token' in input || (isRecord(input.ha) && 'token' in input.ha)) {
      return bad('Le jeton ne se modifie pas ainsi : utilisez « newToken ».')
    }
    const { newToken, hasToken: _hasToken, loadWarning: _loadWarning, ...rest } = input
    if (newToken !== undefined && typeof newToken !== 'string') return bad('Corps de requête invalide', ['newToken : texte attendu'])
    const trimmed = (newToken ?? '').trim()
    const urlChanged = isRecord(rest.ha) && normUrl(rest.ha.url) !== normUrl(d.store.get().ha.url)
    if (urlChanged && trimmed === '') {
      return bad('Saisissez à nouveau le jeton pour une nouvelle adresse Home Assistant')
    }
    const token = trimmed !== '' ? trimmed : d.store.get().ha.token
    const candidate = { ...rest, ha: isRecord(rest.ha) ? { ...rest.ha, token } : rest.ha }

    const parsed = appConfigSchema.safeParse(candidate)
    if (!parsed.success) return bad('Configuration invalide', issuesOf(parsed.error))

    const refusal = await tryUpdate(parsed.data)
    return refusal ? bad(refusal.error, refusal.issues) : publicConfig(d.store)
  })

  /** Entités connues de Home Assistant, pour vérifier les emplacements ; vide s'il est injoignable ou trop lent. */
  const knownEntities = async (): Promise<Map<string, EntityInfo>> => {
    const known = new Map<string, EntityInfo>()
    try {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('délai dépassé')), d.entityTimeoutMs ?? 3000) })
      try {
        for (const e of await Promise.race([d.ha().listEntityInfo(), timeout])) known.set(e.entityId, e)
      } finally {
        clearTimeout(timer)
      }
    } catch {
      // Home Assistant injoignable ou trop lent : aucune entité connue, le placement est accepté.
    }
    return known
  }

  /** Vérifie les emplacements puis enregistre ; renvoie la raison d'un refus, sinon null. */
  const tryUpdate = async (cfg: AppConfig, checkEntities = true): Promise<{ error: string; issues: string[] } | null> => {
    const placement = checkEntities ? placementIssues(cfg, await knownEntities()) : []
    if (placement.length > 0) return { error: placement.join(' ; '), issues: placement }
    try {
      await d.store.update(cfg)
    } catch (err) {
      if (err instanceof ConfigValidationError) return { error: 'Configuration invalide', issues: err.issues }
      throw err
    }
    return null
  }

  app.get('/api/config/export', async (_req, reply) => reply
    .header('Content-Type', 'application/json; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="loupedeck-ha-${new Date().toLocaleDateString('sv-SE')}.json"`)
    .header('Cache-Control', 'no-store')
    .send(JSON.stringify(exportSettings(d.store), null, 2)))

  /**
   * Remplace tous les réglages par ceux d'un fichier. Le jeton n'en vient jamais : celui en place est gardé, sauf si
   * l'adresse Home Assistant change (il partirait vers un autre serveur) ; il faut alors le saisir à nouveau.
   */
  app.post('/api/config/import', async (req, reply) => {
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return reply.code(415).send({ error: 'Content-Type application/json requis' })
    }
    const file = settingsOf(req.body)
    if (!file) return reply.code(400).send({ error: 'Ce fichier ne contient pas de réglages Loupedeck HA' })
    const current = d.store.get().ha
    const sameHome = normUrl(file.ha.url) === normUrl(current.url)
    const parsed = appConfigSchema.safeParse({ ...file.rest, ha: { ...file.ha, token: sameHome ? current.token : '' } })
    if (!parsed.success) return reply.code(400).send({ error: 'Configuration invalide', issues: issuesOf(parsed.error) })
    const refusal = await tryUpdate(parsed.data, sameHome)
    if (refusal) return reply.code(400).send(refusal)
    d.log.info('Réglages importés', { memeAdresse: sameHome })
    const config = publicConfig(d.store)
    return { config, tokenRequired: !config.ha.hasToken }
  })

  app.post('/api/config/undo', async (_req, reply) => {
    if (!(await d.store.undo())) return reply.code(409).send({ error: 'Rien à annuler' })
    return publicConfig(d.store)
  })

  app.get('/api/entities', async (_req, reply) => {
    const offline = () => reply.code(503).send({ error: 'Home Assistant hors ligne' })
    if (d.ha().status().state !== 'online') return offline()
    try {
      const list = await d.ha().listEntityInfo()
      return [...list].sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return offline()
    }
  })

  app.get<{ Params: { file: string }; Querystring: { refreshCamera?: string } }>('/api/preview/:file', async (req, reply) => {
    const m = /^([0-7])\.png$/.exec(req.params.file)
    if (!m) return reply.code(404).send({ error: 'Bouton inconnu' })
    const i = Number(m[1])
    const nav = d.navigator()
    if (!nav) return reply.code(503).send({ error: 'Console en cours de reconnexion' })
    const dashboard = nav.dashboard(i)
    if (!dashboard) return reply.code(404).send({ error: 'Bouton vide' })

    let view: View = dashboard.view()
    const cfg = d.store.get().buttons[i]
    if (view.kind === 'full' && !view.image && cfg?.type === 'camera' && cfg.entityId && nav.activeIndex() !== i) {
      const key = `${i}:${cfg.entityId}`
      let still = req.query.refreshCamera === '1' ? undefined : stills.get(key)
      if (!still) {
        try {
          still = await d.ha().fetchCameraImage(cfg.entityId, STILL_SIZE)
          stills.set(key, still)
        } catch (err) {
          d.log.warn("Image fixe de la caméra indisponible pour l'aperçu", { bouton: i, erreur: String(err) })
        }
      }
      if (still) view = { ...view, image: still, message: null }
    }

    const surface = createSurface()
    await paint(surface, view)
    const png = await toPng(surface)
    return reply.header('Content-Type', 'image/png').header('Cache-Control', 'no-store').send(png)
  })

  /** Commandes ponctuelles d'une page : `refresh` (météo : relire l'entité ; caméra : nouvelle image fixe), `reload` (caméra : recharger l'intégration). */
  app.post<{ Params: { index: string } }>('/api/pages/:index/command', async (req, reply) => {
    const i = Number(req.params.index)
    const cfg = Number.isInteger(i) && i >= 0 && i < 8 ? d.store.get().buttons[i] : undefined
    if (!cfg) return reply.code(404).send({ error: 'Page inconnue' })
    const body = isRecord(req.body) ? req.body : {}
    const command = body.command
    const entityId = 'entityId' in cfg ? cfg.entityId : null
    if (!entityId) return reply.code(400).send({ error: 'Aucune entité configurée sur cette page' })
    const call = async (service: string) => {
      if (d.ha().status().state !== 'online') return reply.code(503).send({ error: 'Home Assistant hors ligne' })
      try {
        await d.ha().callService('homeassistant', service, undefined, { entity_id: entityId })
      } catch {
        return reply.code(502).send({ error: 'Home Assistant a refusé la commande' })
      }
      return { ok: true }
    }
    if (cfg.type === 'weather' && command === 'refresh') return call('update_entity')
    if (cfg.type === 'camera' && command === 'refresh') {
      for (const k of [...stills.keys()]) if (k.startsWith(`${i}:`)) stills.delete(k)
      return { ok: true }
    }
    if (cfg.type === 'camera' && command === 'reload') return call('reload_config_entry')
    return reply.code(400).send({ error: 'Commande inconnue pour cette page' })
  })

  /**
   * Mode Essayer de l'éditeur : un geste sur la Live virtuelle est transmis à la page comme s'il venait de la console
   * (toucher, fin de toucher, molette tournée ou appuyée). Il pilote donc la vraie maison, comme la console.
   */
  app.post<{ Params: { index: string } }>('/api/pages/:index/input', async (req, reply) => {
    const i = Number(req.params.index)
    const nav = d.navigator()
    if (!nav) return reply.code(503).send({ error: 'Console en cours de reconnexion' })
    const page = Number.isInteger(i) && i >= 0 && i < 8 ? nav.dashboard(i) : null
    if (!page) return reply.code(404).send({ error: 'Page inconnue' })
    const e = parseInput(req.body)
    if (!e) return reply.code(400).send({ error: 'Geste invalide' })
    page.handle(e)
    // L'aperçu d'une page qui n'est pas affichée sur la console ne suit pas seul : on le signale.
    setTimeout(() => notifyAll({ type: 'preview' }), 150)
    return { ok: true }
  })

  app.get('/api/status', async () => {
    const device = d.device()
    return {
      device: { status: device.status(), firmware: device.firmware() },
      ha: d.ha().status(),
      activeButton: d.navigator()?.activeIndex() ?? -1,
    }
  })

  const root = path.resolve(d.staticDir)
  const built = fs.existsSync(path.join(root, 'index.html'))

  /** Fichier statique sous le dossier racine (sans sortie du dossier), ou null. */
  const staticFile = async (urlPath: string): Promise<{ file: string; data: Buffer } | null> => {
    let rel: string
    try { rel = decodeURIComponent(urlPath) } catch { return null }
    const file = path.resolve(root, '.' + path.posix.normalize('/' + rel))
    if (file !== root && !file.startsWith(root + path.sep)) return null
    try {
      const st = await fsp.stat(file)
      if (!st.isFile()) return null
      return { file, data: await fsp.readFile(file) }
    } catch { return null }
  }
  const send = (reply: FastifyReply, f: { file: string; data: Buffer }) =>
    reply.type(MIME[path.extname(f.file).toLowerCase()] ?? 'application/octet-stream').send(f.data)

  app.setNotFoundHandler(async (req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Introuvable' })
    if (!built) return reply.code(200).type('text/html; charset=utf-8').send(NOT_BUILT_PAGE)
    const pathname = req.url.split('?')[0]!
    const hit = pathname === '/' ? null : await staticFile(pathname)
    return send(reply, hit ?? (await staticFile('/index.html'))!)
  })

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: 'Requête invalide' })
    d.log.error("Erreur de l'API de l'éditeur", { erreur: String(err) })
    return reply.code(500).send({ error: 'Erreur interne' })
  })

  await app.listen({ host: HOST, port: d.port })
  boundPort = (app.server.address() as { port: number }).port

  let closing: Promise<void> | null = null
  return {
    url: `http://${HOST}:${boundPort}`,
    notify: notifyAll,
    close() {
      closing ??= (async () => {
        for (const s of sockets) s.terminate()
        sockets.clear()
        stills.clear()
        const closed = app.close()
        // Les connexions « upgrade » refusées ne sont pas suivies par Fastify : on les détruit nous-mêmes.
        for (const c of connections) c.destroy()
        await closed
      })()
      return closing
    },
  }
}
