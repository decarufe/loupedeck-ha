/** Messages entre l'application (processus enfant) et le shell Electron qui la supervise. */

/** Envoyé par l'application une fois démarrée. */
export type AppToShell = { type: 'ready'; editorUrl: string | null }
/** Envoyé par le shell pour demander un arrêt propre (équivalent de SIGINT). */
export type ShellToApp = { type: 'stop' }

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

export function isAppToShell(x: unknown): x is AppToShell {
  return isObject(x) && x.type === 'ready' && (x.editorUrl === null || typeof x.editorUrl === 'string')
}

export function isShellToApp(x: unknown): x is ShellToApp {
  return isObject(x) && x.type === 'stop'
}
