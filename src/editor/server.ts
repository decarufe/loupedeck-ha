import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import fastifyWebsocket from '@fastify/websocket'
import Fastify, { type FastifyReply } from 'fastify'
import { appConfigSchema, type AppConfig } from '../config/schema.js'
import { ConfigStore, ConfigValidationError } from '../config/store.js'
import type { DeviceLink } from '../device/link.js'
import type { HaPort } from '../ha/types.js'
import type { Logger } from '../log.js'
import type { Navigator } from '../navigator.js'
import { paint } from '../render/painters.js'
import { createSurface, toPng } from '../render/surface.js'
import { canPlace, type EntityInfo, type SlotKind } from '../shared/placement.js'
import type { View } from '../views.js'

export type LiveMessage = { type: 'config' } | { type: 'active'; button: number } | { type: 'status' } | { type: 'entities' }
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

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
      case 'lights':
        b.keys.forEach((k, j) => check(`${t}, touche ${j + 1}`, 'key', k?.entityId))
        for (const [knob, slot] of Object.entries(b.dimmers)) check(`${t}, molette ${knob}`, 'dimmer', slot?.entityId)
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
    const normUrl = (u: unknown) => (typeof u === 'string' ? u.trim().replace(/\/+$/, '') : u)
    const urlChanged = isRecord(rest.ha) && normUrl(rest.ha.url) !== normUrl(d.store.get().ha.url)
    if (urlChanged && trimmed === '') {
      return bad('Saisissez à nouveau le jeton pour une nouvelle adresse Home Assistant')
    }
    const token = trimmed !== '' ? trimmed : d.store.get().ha.token
    const candidate = { ...rest, ha: isRecord(rest.ha) ? { ...rest.ha, token } : rest.ha }

    const parsed = appConfigSchema.safeParse(candidate)
    if (!parsed.success) return bad('Configuration invalide', issuesOf(parsed.error))

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
    const placement = placementIssues(parsed.data, known)
    if (placement.length > 0) return bad(placement.join(' ; '), placement)

    try {
      await d.store.update(parsed.data)
    } catch (err) {
      if (err instanceof ConfigValidationError) return bad('Configuration invalide', err.issues)
      throw err
    }
    return publicConfig(d.store)
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
    notify(m) {
      const text = JSON.stringify(m)
      for (const s of sockets) if (s.readyState === s.OPEN) s.send(text)
    },
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
