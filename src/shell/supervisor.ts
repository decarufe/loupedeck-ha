import type { Logger } from '../log.js'
import { isAppToShell, type ShellToApp } from '../shared/ipc.js'

/** Pause avant de relancer l'application après un plantage (code de sortie ≠ 0). */
export const RESTART_DELAY_MS = 5000
/** Délai laissé à l'application pour s'arrêter proprement avant d'être tuée. */
export const STOP_TIMEOUT_MS = 10_000

/** Processus de l'application vu par le superviseur (sous-ensemble de `UtilityProcess` d'Electron). */
export interface ChildLike {
  postMessage(msg: ShellToApp): void
  kill(): boolean
  on(event: 'message', l: (msg: unknown) => void): unknown
  on(event: 'exit', l: (code: number) => void): unknown
}

export interface Supervisor {
  start(): void
  /** Arrêt propre, définitif : plus aucune relance ensuite. */
  stop(): Promise<void>
  editorUrl(): string | null
  onEditorUrl(l: (url: string | null) => void): () => void
}

export interface SupervisorOptions {
  fork: () => ChildLike
  log: Logger
  restartDelayMs?: number
  stopTimeoutMs?: number
}

/**
 * Lance l'application, la relance après un plantage et l'arrête proprement à la demande
 * (remplace la boucle de l'ancien `launch-hidden.vbs`).
 */
export function createSupervisor(o: SupervisorOptions): Supervisor {
  const restartDelayMs = o.restartDelayMs ?? RESTART_DELAY_MS
  const stopTimeoutMs = o.stopTimeoutMs ?? STOP_TIMEOUT_MS
  const listeners = new Set<(url: string | null) => void>()
  let child: ChildLike | null = null
  let url: string | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  let stopping: Promise<void> | null = null
  let onChildExit: (() => void) | null = null

  function setUrl(next: string | null) {
    if (next === url) return
    url = next
    for (const l of listeners) l(next)
  }

  function spawn() {
    restartTimer = null
    const c = o.fork()
    child = c
    o.log.info('Application lancée')
    c.on('message', (msg) => { if (child === c && isAppToShell(msg)) setUrl(msg.editorUrl) })
    c.on('exit', (code) => {
      if (child !== c) return
      child = null
      setUrl(null)
      if (onChildExit) {
        onChildExit()
        return
      }
      if (code === 0) {
        o.log.info('Application arrêtée', { code })
        return
      }
      o.log.warn('Application arrêtée sur une erreur : relance prévue', { code, delaiMs: restartDelayMs })
      restartTimer = setTimeout(spawn, restartDelayMs)
    })
  }

  return {
    start() {
      if (stopping || child || restartTimer) return
      spawn()
    },

    stop() {
      if (stopping) return stopping
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
      }
      const c = child
      if (!c) {
        stopping = Promise.resolve()
        return stopping
      }
      stopping = new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          o.log.warn('L’application ne répond pas à la demande d’arrêt : arrêt forcé', { delaiMs: stopTimeoutMs })
          c.kill()
          finish()
        }, stopTimeoutMs)
        function finish() {
          clearTimeout(killTimer)
          onChildExit = null
          child = null
          setUrl(null)
          resolve()
        }
        onChildExit = finish
        c.postMessage({ type: 'stop' })
      })
      return stopping
    },

    editorUrl: () => url,

    onEditorUrl(l) {
      listeners.add(l)
      return () => { listeners.delete(l) }
    },
  }
}
