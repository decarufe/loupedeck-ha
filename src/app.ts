import type { AppConfig } from './config/schema.js'
import { StateStore } from './config/state.js'
import { ConfigStore } from './config/store.js'
import { createLoupedeckFactory, DeviceLink, type LoupedeckLike } from './device/link.js'
import { startEditorServer, type EditorServer } from './editor/server.js'
import { Actions } from './ha/actions.js'
import { HaClient } from './ha/client.js'
import { HaProxy } from './ha/proxy.js'
import { CameraImageError, OFFLINE_MESSAGE, type HaPort, type HaStatus } from './ha/types.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Logger } from './log.js'
import { Navigator } from './navigator.js'
import { createThrottle } from './shared/throttle.js'

/** Cadence maximale des messages live « preview » envoyés à l'éditeur. */
const PREVIEW_NOTIFY_MS = 1000

export interface AppDeps {
  configDir: string
  log: Logger
  createDevice?: (path: string | null) => () => Promise<LoupedeckLike>
  createHa?: (ha: AppConfig['ha'], log: Logger) => HaPort
  /** Démarre le serveur de l'éditeur (défaut : oui). */
  startEditor?: boolean
  /** Dossier de l'éditeur compilé (défaut : `<dépôt>/editor/dist`). */
  editorStaticDir?: string
}

export interface App {
  stop(): Promise<void>
  navigator: Navigator
  device: DeviceLink
  store: ConfigStore
  ha(): HaPort
  /** Adresse de l'éditeur, ou null s'il n'est pas démarré. */
  editorUrl: string | null
}

/** HaPort sans connexion : jeton absent ou URL invalide. Aucune tentative d'authentification n'est faite. */
function disconnectedHa(status: HaStatus): HaPort {
  const offline = () => Promise.reject(new Error(OFFLINE_MESSAGE))
  return {
    status: () => status,
    entities: () => ({}),
    onEntities: () => () => {},
    onStatus: () => () => {},
    callService: offline,
    getForecasts: offline,
    getHistory: offline,
    listEntityInfo: offline,
    fetchCameraImage: () => Promise.reject(new CameraImageError(OFFLINE_MESSAGE)),
    close: () => {},
  }
}

/** Client réel : démarre la connexion en arrière-plan (les échecs réseau sont retentés par HaClient). */
export function defaultCreateHa(ha: AppConfig['ha'], log: Logger): HaPort {
  if (ha.token.trim() === '') {
    log.warn('Aucun jeton Home Assistant configuré : connexion désactivée')
    return disconnectedHa({ state: 'offline', reason: 'auth' })
  }
  try {
    const client = new HaClient({ url: ha.url, token: ha.token, allowSelfSigned: ha.allowSelfSigned, log })
    client.start()
    return client
  } catch (err) {
    log.error('URL Home Assistant invalide : connexion désactivée', { erreur: (err as Error).message })
    return disconnectedHa({ state: 'offline', reason: 'network' })
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Assemble l'application. Rejette seulement si la configuration ou l'état ne peuvent pas être ouverts
 * (rien n'est alors démarré) ; une console ou un Home Assistant injoignables sont retentés en arrière-plan.
 */
export async function createApp(d: AppDeps): Promise<App> {
  const { log } = d
  const createDevice = d.createDevice ?? createLoupedeckFactory
  const createHa = d.createHa ?? defaultCreateHa

  const store = await ConfigStore.open(d.configDir, log)
  const state = await StateStore.open(d.configDir)

  const proxy = new HaProxy(createHa(store.get().ha, log), log)
  let link!: DeviceLink
  let nav = null as Navigator | null
  let editor: EditorServer | null = null
  const actions = new Actions({ ha: proxy, feedback: (k) => link.vibrate(k) })
  // L'aperçu de l'éditeur suit la console : au plus un message par seconde, le dernier changement n'est jamais perdu.
  const notifyPreview = createThrottle<void>(() => editor?.notify({ type: 'preview' }), PREVIEW_NOTIFY_MS)

  /** Crée la liaison avec la console et le Navigator qui la pilote, à partir de la configuration courante. */
  const wire = (path: string | null): void => {
    const cfg = store.get()
    link = new DeviceLink({ createDevice: createDevice(path), log })
    link.setBrightness(cfg.device.brightness)
    link.start()
    nav = new Navigator({ device: link, ha: proxy, actions, state, log })
    // Abonnements posés avant applyConfig : le choix du tableau actif initial est aussi annoncé à l'éditeur.
    nav.onActiveChange((button) => editor?.notify({ type: 'active', button }))
    link.onStatus(() => editor?.notify({ type: 'status' }))
    nav.onRendered(() => notifyPreview())
    nav.applyConfig(cfg)
  }

  let stopped = false
  let switching = 0
  let deviceTask: Promise<void> = Promise.resolve()

  /** Changement de chemin : on libère l'ancien port avant d'ouvrir le nouveau. */
  const restartDevice = (path: string | null): void => {
    switching++
    deviceTask = deviceTask
      .then(async () => {
        nav?.dispose()
        nav = null
        await link.stop()
        if (!stopped) wire(path)
      })
      .catch((err: unknown) => log.error('Redémarrage de la liaison avec la console impossible', { erreur: String(err) }))
      .finally(() => { switching-- })
  }

  try {
    wire(store.get().device.path)
  } catch (err) {
    nav?.dispose()
    notifyPreview.cancel()
    actions.dispose()
    await link?.stop()
    proxy.close()
    throw err
  }

  // Les tableaux ne suivent que les entités : un changement de statut seul (coupure, reconnexion,
  // remplacement du client) doit quand même redessiner l'indicateur « HA hors ligne ». `nav` désigne
  // toujours le Navigator courant, y compris après un changement de device.path.
  const offStatus = proxy.onStatus((st) => {
    nav?.requestRender()
    editor?.notify({ type: 'status' })
    if (st.state === 'online') editor?.notify({ type: 'entities' })
  })
  const offEntities = proxy.onEntities(() => notifyPreview())

  const offChange = store.onChange((cfg, prev) => {
    if (stopped) return
    editor?.notify({ type: 'config' })
    if (!same(cfg.ha, prev.ha)) {
      log.info('Paramètres Home Assistant modifiés : nouvelle connexion', { url: cfg.ha.url })
      proxy.replace(createHa(cfg.ha, log))
    }
    if (cfg.device.path !== prev.device.path) {
      log.info('Chemin de la console modifié : reconnexion', { chemin: cfg.device.path ?? 'automatique' })
      restartDevice(cfg.device.path)
      return
    }
    // Pendant un redémarrage de la liaison, wire() appliquera la configuration la plus récente.
    if (switching > 0) return
    if (cfg.device.brightness !== prev.device.brightness) link.setBrightness(cfg.device.brightness)
    if (!same(cfg.buttons, prev.buttons)) nav?.applyConfig(cfg)
  })

  if (d.startEditor !== false) {
    const staticDir = d.editorStaticDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'editor', 'dist')
    try {
      editor = await startEditorServer({
        store, ha: () => proxy, navigator: () => nav, device: () => link,
        port: store.get().editor.port, staticDir, log,
      })
    } catch (err) {
      // Le port est peut-être pris : la console et Home Assistant continuent de fonctionner sans éditeur.
      log.error("Serveur de l'éditeur impossible à démarrer", { port: store.get().editor.port, erreur: String(err) })
    }
  }

  let stopping: Promise<void> | null = null
  return {
    get navigator() { return nav! },
    get device() { return link },
    store,
    ha: () => proxy,
    editorUrl: editor?.url ?? null,
    stop() {
      stopping ??= (async () => {
        stopped = true
        offChange()
        offStatus()
        offEntities()
        notifyPreview.cancel()
        await editor?.close()
        editor = null
        await deviceTask
        nav?.dispose()
        nav = null
        notifyPreview.cancel()
        actions.dispose()
        await link.stop()
        proxy.close()
      })()
      return stopping
    },
  }
}
