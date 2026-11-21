import os from 'node:os'
import path from 'node:path'
import { createApp, type App } from './app.js'
import { createLogger } from './log.js'

const appData = process.env.APPDATA
const configDir = appData ? path.join(appData, 'loupedeck-ha') : path.join(os.homedir(), '.loupedeck-ha')
const log = createLogger(path.join(configDir, 'logs', 'app.log'), { level: process.env.LOG_LEVEL ?? 'info' })
let app: App | null = null

/** Masque le jeton courant et tout en-tête « Bearer … » dans un texte destiné au journal. */
function scrub(text: string): string {
  let out = text.replace(/Bearer\s+[^\s"',]+/gi, 'Bearer [jeton masqué]')
  const token = app?.store.get().ha.token.trim() ?? ''
  if (token.length >= 4) out = out.split(token).join('[jeton masqué]')
  return out
}

function describe(err: unknown): { message: string; pile?: string } {
  if (err instanceof Error) return { message: scrub(err.message), pile: err.stack ? scrub(err.stack) : undefined }
  return { message: scrub(String(err)) }
}

process.on('unhandledRejection', (reason) => {
  log.error('Promesse rejetée sans traitement (l’application continue)', describe(reason))
})
process.on('uncaughtException', (err) => {
  log.error('Erreur inattendue : arrêt de l’application', describe(err))
  process.exit(1)
})

if (!appData) log.warn('Variable APPDATA absente : dossier de configuration de repli utilisé', { dossier: configDir })

try {
  app = await createApp({ configDir, log, startEditor: true })
} catch (err) {
  log.error('Démarrage impossible : configuration illisible', describe(err))
  process.exit(1)
}

const cfg = app.store.get()
log.info('Loupedeck HA démarré', { configuration: path.join(configDir, 'config.json') })
log.info('Home Assistant', { url: cfg.ha.url, jeton: cfg.ha.token.trim() ? 'configuré' : 'absent' })
log.info('Éditeur : disponible dans une prochaine version')

let stopping = false
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return
  stopping = true
  log.info('Arrêt demandé', { signal })
  try {
    await app?.stop()
  } catch (err) {
    log.error('Erreur pendant l’arrêt', describe(err))
  }
  process.exit(0)
}
process.on('SIGINT', (s) => { void shutdown(s) })
process.on('SIGTERM', (s) => { void shutdown(s) })
