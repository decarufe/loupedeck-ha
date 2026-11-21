import os from 'node:os'
import path from 'node:path'
import { createApp, type App } from './app.js'
import { EXIT_CRASH, installProcessHandlers } from './lifecycle.js'
import { createLogger, createSecretScrubber } from './log.js'

const appData = process.env.APPDATA
const configDir = appData ? path.join(appData, 'loupedeck-ha') : path.join(os.homedir(), '.loupedeck-ha')
const log = createLogger(path.join(configDir, 'logs', 'app.log'), { level: process.env.LOG_LEVEL ?? 'info' })
let app: App | null = null

/** Tous les jetons vus pendant la vie du processus (initial + chaque changement) sont masqués. */
const secrets = createSecretScrubber()
const scrub = (text: string): string => secrets.scrub(text)

function describe(err: unknown): { message: string; pile?: string } {
  if (err instanceof Error) return { message: scrub(err.message), pile: err.stack ? scrub(err.stack) : undefined }
  return { message: scrub(String(err)) }
}

// Codes de sortie : 0 sur arrêt volontaire (Ctrl+C, SIGINT, SIGTERM), 1 sur plantage. Le lanceur
// scripts\launch-hidden.vbs relance l'application tant que le code est différent de 0.
installProcessHandlers({ proc: process, log, describe, stop: () => app?.stop() })

if (!appData) log.warn('Variable APPDATA absente : dossier de configuration de repli utilisé', { dossier: configDir })

try {
  app = await createApp({ configDir, log, startEditor: true })
} catch (err) {
  log.error('Démarrage impossible : configuration illisible', describe(err))
  process.exit(EXIT_CRASH)
}

const cfg = app.store.get()
secrets.remember(cfg.ha.token)
app.store.onChange((next) => secrets.remember(next.ha.token))
log.info('Loupedeck HA démarré', { configuration: path.join(configDir, 'config.json') })
log.info('Home Assistant', { url: cfg.ha.url, jeton: cfg.ha.token.trim() ? 'configuré' : 'absent' })
if (app.editorUrl) log.info('Éditeur', { url: app.editorUrl })

