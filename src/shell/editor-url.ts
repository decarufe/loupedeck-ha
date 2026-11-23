import fsp from 'node:fs/promises'

export const DEFAULT_EDITOR_PORT = 8765

export function editorUrlFromPort(port: number): string {
  return `http://127.0.0.1:${port}/`
}

/**
 * Port de l'éditeur lu dans `config.json` (`editor.port`), pour ouvrir l'éditeur avant que l'application
 * n'ait annoncé son adresse. Fichier absent, illisible ou port invalide : 8765. Le jeton n'est jamais lu
 * au-delà du parsing.
 */
export async function readEditorPort(configPath: string, readFile: (p: string) => Promise<string> = (p) => fsp.readFile(p, 'utf8')): Promise<number> {
  try {
    const cfg = JSON.parse(await readFile(configPath)) as { editor?: { port?: unknown } } | null
    const port = cfg?.editor?.port
    if (typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535) return port
  } catch {
    // fichier absent ou illisible : port par défaut
  }
  return DEFAULT_EDITOR_PORT
}
