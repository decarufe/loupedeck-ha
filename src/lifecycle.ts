import type { Logger } from './log.js'

/** Sortie volontaire (Ctrl+C, SIGINT, SIGTERM) : le lanceur (launch-hidden.vbs) ne relance pas. */
export const EXIT_OK = 0
/** Plantage (exception non rattrapée, démarrage impossible) : le lanceur relance après 5 s. */
export const EXIT_CRASH = 1

export interface ProcessLike {
  on(event: string, listener: (...args: any[]) => void): unknown
  exit(code: number): void
}

export interface ProcessHandlersOptions {
  proc: ProcessLike
  log: Logger
  /** Description sans secret d'une erreur, pour le journal. */
  describe: (err: unknown) => object
  /** Arrêt propre de l'application (peut être absent si elle n'a pas démarré). */
  stop: () => Promise<void> | undefined
}

/**
 * Codes de sortie du processus : 0 sur arrêt volontaire (après l'arrêt propre, même s'il échoue),
 * 1 sur exception non rattrapée. Une promesse rejetée sans traitement est journalisée, sans arrêt.
 */
export function installProcessHandlers(o: ProcessHandlersOptions): void {
  const { proc, log, describe } = o
  proc.on('unhandledRejection', (reason: unknown) => {
    log.error('Promesse rejetée sans traitement (l’application continue)', describe(reason))
  })
  proc.on('uncaughtException', (err: unknown) => {
    log.error('Erreur inattendue : arrêt de l’application', describe(err))
    proc.exit(EXIT_CRASH)
  })

  let stopping = false
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return
    stopping = true
    log.info('Arrêt demandé', { signal })
    try {
      await o.stop()
    } catch (err) {
      log.error('Erreur pendant l’arrêt', describe(err))
    }
    proc.exit(EXIT_OK)
  }
  proc.on('SIGINT', (s: string) => { void shutdown(s) })
  proc.on('SIGTERM', (s: string) => { void shutdown(s) })
}
