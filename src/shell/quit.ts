import type { Logger } from '../log.js'

export interface QuitController {
  /** Arrête l'application puis quitte (code 0), même si l'arrêt a été lancé par installUpdate. */
  quit(): Promise<void>
  /** Arrête l'application puis lance l'installation de la mise à jour ; repli : quitter. */
  installUpdate(): Promise<void>
  /** Vrai dès qu'un arrêt (quit ou installUpdate) est engagé. */
  inProgress(): boolean
}

export interface QuitControllerOptions {
  /** Arrêt propre de l'application (superviseur). */
  stop: () => Promise<void>
  /** `app.exit`. */
  exit: (code: number) => void
  /** `autoUpdater.quitAndInstall(true, true)`. */
  quitAndInstall: () => void
  log: Logger
}

export function createQuitController(o: QuitControllerOptions): QuitController {
  let stopping: Promise<void> | null = null
  let installing = false
  const stopOnce = () => (stopping ??= o.stop())

  return {
    async quit() {
      if (!stopping) o.log.info('Arrêt demandé')
      await stopOnce()
      o.exit(0)
    },

    async installUpdate() {
      if (stopping) return
      installing = true
      o.log.info('Installation de la mise à jour')
      await stopOnce()
      try {
        o.quitAndInstall()
      } catch (err) {
        o.log.error('Installation de la mise à jour impossible : arrêt', { erreur: err instanceof Error ? err.message : String(err) })
        o.exit(0)
      }
    },

    inProgress: () => stopping !== null || installing,
  }
}
