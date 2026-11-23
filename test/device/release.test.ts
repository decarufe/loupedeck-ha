import { describe, expect, it, vi } from 'vitest'
import type { DeviceProblem } from '../../src/device/link.js'
import { createConsoleReleaser, parseTasklist, type ConsoleLink, type RunResult } from '../../src/device/release.js'
import type { Logger } from '../../src/log.js'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} }

/** Faux Windows : une liste de processus, et ce qui se passe quand on en ferme un. */
function setup(names: string[], o: { problem?: DeviceProblem | null; deny?: string[]; respawn?: string[]; agentFrees?: boolean; frees?: string[]; platform?: NodeJS.Platform } = {}) {
  let procs = names.map((name, i) => ({ name, pid: 100 + i }))
  let connected = false
  let nextPid = 900
  const runs: string[][] = []
  const killed: string[] = []
  const frees = o.frees ?? ['LogiPluginService.exe', 'Loupedeck2.exe']
  const link = {
    status: () => (connected ? 'connected' : 'disconnected') as 'connected' | 'disconnected',
    problem: () => (connected ? null : o.problem === undefined ? 'busy' : o.problem),
    retryNow: vi.fn(() => { if (frees.some((f) => killed.includes(f)) && !procs.some((p) => frees.includes(p.name))) connected = true }),
    waitConnected: vi.fn(async () => connected),
  } satisfies ConsoleLink
  const run = async (cmd: string, args: string[]): Promise<RunResult> => {
    runs.push([cmd, ...args])
    if (/tasklist\.exe$/i.test(cmd)) {
      return { code: 0, stdout: ['"System Idle Process","0","Services","0","8 Ko"', ...procs.map((p) => `"${p.name}","${p.pid}","Console","1","43 644 Ko"`), ''].join('\r\n') }
    }
    const name = args[args.indexOf('/IM') + 1]!
    if (o.deny?.includes(name)) return { code: 1, stdout: '' }
    procs = procs.filter((p) => p.name !== name)
    killed.push(name)
    if (o.respawn?.includes(name)) procs.push({ name, pid: nextPid++ })
    return { code: 0, stdout: '' }
  }
  const releaser = createConsoleReleaser({ run, link: () => link, log: silent, platform: o.platform ?? 'win32', systemRoot: 'C:\\Windows' })
  return { releaser, runs, killed, link, setConnected: () => { connected = true } }
}

describe('parseTasklist', () => {
  it('reads_names_and_pids_and_ignores_the_rest', () => {
    expect(parseTasklist('"a b.exe","12","Console","1","1 Ko"\r\nINFO: rien\r\n"x.exe","abc","c","1","1"\r\n')).toEqual([{ name: 'a b.exe', pid: 12 }])
  })
})

describe('programmes qui peuvent tenir la console', () => {
  it('finds_loupedeck_and_logi_plugin_service_only', async () => {
    const { releaser } = setup([
      'explorer.exe', 'Loupedeck HA.exe', 'LoupedeckHA.exe', 'LoupedeckHA-Setup-0.2.10.exe', 'logioptionsplus_updater.exe', 'lghub.exe', 'node.exe',
      'LogiPluginService.exe', 'logipluginserviceext.exe', 'Loupedeck2.exe', 'LoupedeckConfig.exe', 'logioptionsplus_agent.exe',
    ])
    expect(await releaser.holders()).toEqual([
      { name: 'LogiPluginService.exe', pid: 107, label: 'Logi Plugin Service', agent: false },
      { name: 'logipluginserviceext.exe', pid: 108, label: 'Logi Plugin Service', agent: false },
      { name: 'Loupedeck2.exe', pid: 109, label: 'Loupedeck', agent: false },
      { name: 'LoupedeckConfig.exe', pid: 110, label: 'Loupedeck', agent: false },
      { name: 'logioptionsplus_agent.exe', pid: 111, label: 'Logi Options+', agent: true },
    ])
  })

  it('never_runs_anything_outside_windows', async () => {
    const { releaser, runs } = setup(['Loupedeck2.exe'], { platform: 'linux' })
    expect(await releaser.holders()).toEqual([])
    expect((await releaser.force()).killed).toEqual([])
    expect(runs).toEqual([])
  })
})

describe('forcer la connexion', () => {
  it('closes_the_holder_then_connects_at_once', async () => {
    const { releaser, runs, link } = setup(['explorer.exe', 'LogiPluginService.exe', 'logioptionsplus_agent.exe'])
    expect(await releaser.force()).toEqual({ connected: true, reason: null, killed: ['LogiPluginService.exe'], failed: [], agentRunning: true })
    expect(runs.filter(([c]) => /taskkill/.test(c!))).toEqual([['C:\\Windows\\System32\\taskkill.exe', '/F', '/T', '/IM', 'LogiPluginService.exe']])
    expect(link.retryNow).toHaveBeenCalled()
  })

  it('kills_each_program_once_even_with_several_instances', async () => {
    const { releaser, killed } = setup(['Loupedeck2.exe', 'Loupedeck2.exe', 'LoupedeckConfig.exe'])
    expect((await releaser.force()).connected).toBe(true)
    expect(killed).toEqual(['Loupedeck2.exe', 'LoupedeckConfig.exe'])
  })

  it('leaves_options_plus_alone_unless_asked', async () => {
    const a = setup(['LogiPluginService.exe', 'logioptionsplus_agent.exe'], { respawn: ['LogiPluginService.exe'] })
    const r = await a.releaser.force()
    expect(r).toMatchObject({ connected: false, reason: 'still-busy', agentRunning: true })
    expect(a.killed).not.toContain('logioptionsplus_agent.exe')
    // L'agent relance le service à chaque essai : on insiste, mais pas sans fin.
    expect(a.killed).toEqual(['LogiPluginService.exe', 'LogiPluginService.exe', 'LogiPluginService.exe'])
    const b = setup(['LogiPluginService.exe', 'logioptionsplus_agent.exe'])
    expect((await b.releaser.force({ includeAgent: true })).connected).toBe(true)
    // L'agent d'abord : il ne peut plus relancer le service.
    expect(b.killed).toEqual(['logioptionsplus_agent.exe', 'LogiPluginService.exe'])
  })

  it('reports_what_windows_refused_to_close', async () => {
    const { releaser } = setup(['Loupedeck2.exe'], { deny: ['Loupedeck2.exe'] })
    expect(await releaser.force()).toMatchObject({ connected: false, reason: 'denied', killed: [], failed: ['Loupedeck2.exe'] })
  })

  it('closes_nothing_when_the_console_is_connected_or_unplugged', async () => {
    const a = setup(['LogiPluginService.exe'])
    a.setConnected()
    expect(await a.releaser.force()).toMatchObject({ connected: true, killed: [] })
    const b = setup(['LogiPluginService.exe'], { problem: 'absent' })
    expect(await b.releaser.force()).toMatchObject({ connected: false, reason: 'absent', killed: [] })
    expect(a.killed).toEqual([])
    expect(b.killed).toEqual([])
    expect(b.link.retryNow).toHaveBeenCalled()
  })

  it('says_when_no_known_program_is_running', async () => {
    const { releaser, link } = setup(['explorer.exe', 'logioptionsplus_agent.exe'])
    expect(await releaser.force()).toMatchObject({ connected: false, reason: 'no-holder', killed: [] })
    expect(link.retryNow).toHaveBeenCalled()
  })

  it('concurrent_requests_share_one_run', async () => {
    const { releaser, killed } = setup(['LogiPluginService.exe'])
    const [a, b] = await Promise.all([releaser.force(), releaser.force()])
    expect(a).toBe(b)
    expect(killed).toEqual(['LogiPluginService.exe'])
  })

  it('a_failing_tasklist_is_an_error_not_a_silent_success', async () => {
    const link: ConsoleLink = { status: () => 'disconnected', problem: () => 'busy', retryNow: () => {}, waitConnected: async () => false }
    const releaser = createConsoleReleaser({ run: async () => ({ code: 1, stdout: '' }), link: () => link, log: silent, platform: 'win32', systemRoot: 'C:\\Windows' })
    await expect(releaser.force()).rejects.toThrow('Liste des programmes impossible')
  })
})
