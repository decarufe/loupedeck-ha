import type { Logger } from '../log.js'

export const UPDATE_INITIAL_DELAY_MS = 10_000
export const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000

/** Sous-ensemble du résultat d'une vérification d'electron-updater. */
export interface UpdateCheck {
  isUpdateAvailable: boolean
  updateInfo: { version: string }
  downloadPromise?: Promise<unknown> | null
}

/** Sous-ensemble de l'`autoUpdater` d'electron-updater. */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<UpdateCheck | null>
  on(event: 'update-downloaded', l: (info: { version: string }) => void): unknown
  on(event: 'error', l: (err: Error) => void): unknown
}

/**
 * Vérifie les Releases GitHub 10 s après le démarrage puis toutes les 4 h ; la mise à jour se télécharge
 * en arrière-plan et s'installe au redémarrage demandé ou à la fermeture. Les erreurs (hors ligne, GitHub
 * indisponible) sont seulement journalisées. Retourne une fonction qui arrête les vérifications.
 */
export function startUpdateChecks(o: { updater: UpdaterLike; log: Logger; onDownloaded(version: string): void }): () => void {
  const { updater, log } = o
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  let announced: string | null = null

  updater.on('error', (err) => { log.warn('Mise à jour : erreur', { erreur: err?.message ?? String(err) }) })
  updater.on('update-downloaded', (info) => {
    if (info.version === announced) return
    announced = info.version
    log.info('Mise à jour téléchargée', { version: info.version })
    o.onDownloaded(info.version)
  })

  const check = () => {
    updater.checkForUpdates().then((r) => {
      // Un téléchargement interrompu est déjà journalisé par l'événement « error ».
      r?.downloadPromise?.catch(() => {})
    }).catch((err: unknown) => {
      log.warn('Mise à jour : vérification impossible', { erreur: err instanceof Error ? err.message : String(err) })
    })
  }
  let interval: ReturnType<typeof setInterval> | null = null
  const first = setTimeout(() => {
    check()
    interval = setInterval(check, UPDATE_INTERVAL_MS)
  }, UPDATE_INITIAL_DELAY_MS)

  return () => {
    clearTimeout(first)
    if (interval) clearInterval(interval)
  }
}
