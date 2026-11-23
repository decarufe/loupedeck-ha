import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Logger } from '../log.js'

/** « Démarrer avec Windows » (adaptateur de `app.get/setLoginItemSettings`). */
export interface LoginItems {
  get(): boolean
  set(openAtLogin: boolean): void
}

type MarkerState = 'absent' | 'present' | 'invalid'

async function readMarker(statePath: string): Promise<MarkerState> {
  let raw: string
  try {
    raw = await fsp.readFile(statePath, 'utf8')
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'absent' : 'invalid'
  }
  try {
    const s = JSON.parse(raw) as { autostartInitialized?: unknown } | null
    return s?.autostartInitialized === true ? 'present' : 'invalid'
  } catch {
    return 'invalid'
  }
}

async function writeMarker(statePath: string, log: Logger): Promise<boolean> {
  try {
    await fsp.mkdir(path.dirname(statePath), { recursive: true })
    await fsp.writeFile(statePath, JSON.stringify({ autostartInitialized: true }))
    return true
  } catch (err) {
    log.warn('Impossible d’enregistrer l’état du shell', { fichier: statePath, erreur: String(err) })
    return false
  }
}

/**
 * Au premier lancement après installation (`shell.json` absent), mémorise le passage puis active le
 * démarrage avec Windows. Ensuite, le choix de l'utilisateur (case du menu) n'est plus jamais modifié :
 * un `shell.json` illisible est seulement journalisé et réécrit, sans rien réactiver. Si le marqueur ne
 * peut pas être écrit, rien n'est activé (sinon le démarrage serait réactivé à chaque lancement).
 */
export async function initAutostart(o: { statePath: string; login: LoginItems; log: Logger }): Promise<void> {
  const state = await readMarker(o.statePath)
  if (state === 'present') return
  if (state === 'invalid') {
    o.log.warn('État du shell illisible : réécrit, démarrage avec Windows inchangé', { fichier: o.statePath })
    await writeMarker(o.statePath, o.log)
    return
  }
  if (!(await writeMarker(o.statePath, o.log))) return
  o.login.set(true)
  o.log.info('Premier lancement : démarrage avec Windows activé')
}
