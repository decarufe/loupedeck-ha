import { execFile } from 'node:child_process'
import path from 'node:path'
import type { Logger } from '../log.js'
import type { DeviceLink } from './link.js'

/** Programme connu pour ouvrir la console, en cours d'exécution. */
export interface ConsoleHolder {
  name: string
  pid: number
  label: string
  /** Agent Logi Options+ : il ne tient pas la console, mais relance le service qui la tient. Fermé seulement sur demande. */
  agent: boolean
}

export interface ForceResult {
  connected: boolean
  /**
   * Pourquoi la console n'est pas connectée : `absent` (pas branchée, rien n'est fermé), `no-holder` (aucun programme
   * connu ne tourne), `denied` (Windows refuse la fermeture), `still-busy` (fermé, mais la console ne répond toujours pas).
   */
  reason: 'absent' | 'no-holder' | 'denied' | 'still-busy' | null
  killed: string[]
  failed: string[]
  agentRunning: boolean
}

export interface RunResult { code: number; stdout: string }
export type ConsoleLink = Pick<DeviceLink, 'status' | 'problem' | 'retryNow' | 'waitConnected'>

export interface ConsoleReleaser {
  holders(): Promise<ConsoleHolder[]>
  force(o?: { includeAgent?: boolean }): Promise<ForceResult>
}

export interface ConsoleReleaserDeps {
  /** Lance une commande sans shell. */
  run: (cmd: string, args: string[]) => Promise<RunResult>
  link: () => ConsoleLink
  log: Logger
  platform?: NodeJS.Platform
  systemRoot?: string
}

/** Noms d'image fermés par l'application : rien d'autre ne peut l'être, quelle que soit la requête. */
const KNOWN: { pattern: RegExp; label: string; agent: boolean }[] = [
  { pattern: /^logipluginservice(ext)?\.exe$/i, label: 'Logi Plugin Service', agent: false },
  // Loupedeck.exe, Loupedeck2.exe, LoupedeckConfig.exe, LoupedeckService.exe… mais jamais cette application.
  { pattern: /^loupedeck(?!ha\.exe$)[a-z0-9]*\.exe$/i, label: 'Loupedeck', agent: false },
  { pattern: /^logioptionsplus_agent\.exe$/i, label: 'Logi Options+', agent: true },
]

/** Fermetures successives : l'agent Logi Options+ peut relancer le service avant que la console soit prise. */
const MAX_ROUNDS = 3
/** Un peu plus que le délai de connexion d'une tentative (5 s). */
const WAIT_MS = 6000
const COMMAND_TIMEOUT_MS = 10_000

/** Sortie de `tasklist /FO CSV /NH` : nom d'image et PID (les autres colonnes dépendent de la langue). */
export function parseTasklist(csv: string): { name: string; pid: number }[] {
  return csv.split(/\r?\n/).flatMap((line) => {
    const m = /^"([^"]+)","(\d+)"/.exec(line)
    return m ? [{ name: m[1]!, pid: Number(m[2]) }] : []
  })
}

export const runCommand = (cmd: string, args: string[]): Promise<RunResult> =>
  new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout })
    })
  })

/** Ferme, à la demande de l'utilisateur, les logiciels Loupedeck / Logi qui tiennent la console, puis la prend aussitôt. */
export function createConsoleReleaser(d: ConsoleReleaserDeps): ConsoleReleaser {
  const windows = (d.platform ?? process.platform) === 'win32'
  // Chemin complet : un tasklist.exe ou taskkill.exe placé ailleurs dans le PATH n'est jamais lancé.
  const system = (exe: string) => path.win32.join(d.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows', 'System32', exe)

  async function holders(): Promise<ConsoleHolder[]> {
    if (!windows) return []
    const { code, stdout } = await d.run(system('tasklist.exe'), ['/FO', 'CSV', '/NH'])
    if (code !== 0) throw new Error('Liste des programmes impossible')
    return parseTasklist(stdout).flatMap((p) => {
      const known = KNOWN.find((k) => k.pattern.test(p.name))
      return known ? [{ ...p, label: known.label, agent: known.agent }] : []
    })
  }

  async function doForce(includeAgent: boolean): Promise<ForceResult> {
    const link = d.link()
    const killed = new Set<string>()
    const failed = new Set<string>()
    const result = async (connected: boolean, reason: ForceResult['reason']): Promise<ForceResult> => ({
      connected, reason, killed: [...killed], failed: [...failed], agentRunning: (await holders()).some((h) => h.agent),
    })
    if (link.status() === 'connected') return result(true, null)
    if (link.problem() === 'absent') {
      // Rien à libérer : fermer des programmes ne ferait pas apparaître la console.
      link.retryNow()
      return result(false, 'absent')
    }
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const targets = (await holders()).filter((h) => includeAgent || !h.agent)
      // L'agent d'abord, pour qu'il ne relance pas le service entre les deux fermetures.
      const names = [...new Set(targets.sort((a, b) => Number(b.agent) - Number(a.agent)).map((h) => h.name))]
      if (names.length === 0 && round > 0) break
      failed.clear()
      for (const name of names) {
        // Sans /T : il fermerait aussi les applications que ce logiciel a lancées (action « ouvrir » d'une touche).
        const { code } = await d.run(system('taskkill.exe'), ['/F', '/IM', name])
        // 128 : déjà parti, par exemple arrêté avec le service qui l'avait lancé.
        if (code === 0) killed.add(name)
        else if (code !== 128) failed.add(name)
      }
      if (names.length > 0 && failed.size === names.length) break
      if (names.length > 0) d.log.warn('Programmes fermés pour libérer la console', { fermes: [...killed], refuses: [...failed] })
      d.link().retryNow()
      if (await d.link().waitConnected(WAIT_MS)) return result(true, null)
      if (names.length === 0) break
    }
    if (failed.size > 0) return result(false, 'denied')
    return result(false, killed.size > 0 ? 'still-busy' : 'no-holder')
  }

  let current: Promise<ForceResult> | null = null
  return {
    holders,
    force(o = {}) {
      current ??= doForce(o.includeAgent === true).finally(() => { current = null })
      return current
    },
  }
}
