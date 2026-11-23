import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Logger } from '../log.js'

/** « Démarrer avec Windows » (adaptateur de `app.get/setLoginItemSettings`). */
export interface LoginItems {
  get(): boolean
  set(openAtLogin: boolean): void
}

interface ShellState { autostartInitialized?: boolean }

async function readState(statePath: string): Promise<ShellState> {
  try {
    const s = JSON.parse(await fsp.readFile(statePath, 'utf8')) as unknown
    return typeof s === 'object' && s !== null ? (s as ShellState) : {}
  } catch {
    return {}
  }
}

/**
 * Au premier lancement après installation, active le démarrage avec Windows puis le mémorise dans
 * `shell.json` ; ensuite, le choix de l'utilisateur (case du menu) n'est plus jamais modifié.
 */
export async function initAutostart(o: { statePath: string; login: LoginItems; log: Logger }): Promise<void> {
  const state = await readState(o.statePath)
  if (state.autostartInitialized === true) return
  o.login.set(true)
  o.log.info('Premier lancement : démarrage avec Windows activé')
  try {
    await fsp.mkdir(path.dirname(o.statePath), { recursive: true })
    await fsp.writeFile(o.statePath, JSON.stringify({ ...state, autostartInitialized: true }))
  } catch (err) {
    o.log.warn('Impossible d’enregistrer l’état du shell', { fichier: o.statePath, erreur: String(err) })
  }
}
