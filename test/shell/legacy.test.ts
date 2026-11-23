import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { LEGACY_SHORTCUT, LEGACY_TASK, removeLegacyInstall, type LegacyDeps } from '../../src/shell/legacy.js'

function deps(over: { run?: LegacyDeps['run']; queryCode?: number; present?: string[] } = {}) {
  const present = new Set(over.present ?? [])
  const run = vi.fn(async (_cmd: string, args: string[]) => ({ code: args[0] === '/Query' ? (over.queryCode ?? 1) : 0 }))
  const d = {
    run: over.run ?? run,
    exists: vi.fn(async (p: string) => present.has(p)),
    unlink: vi.fn(async (p: string) => { present.delete(p) }),
    desktopDir: 'C:\\Bureau',
    startMenuDir: 'C:\\Programmes',
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
  return { d, run }
}

describe('removeLegacyInstall', () => {
  it('noms', () => {
    expect(LEGACY_TASK).toBe('Loupedeck HA')
    expect(LEGACY_SHORTCUT).toBe('Loupedeck HA – Configuration.url')
  })

  it('tâche présente : supprimée', async () => {
    const { d, run } = deps({ queryCode: 0 })
    const r = await removeLegacyInstall(d)
    expect(run).toHaveBeenCalledWith('schtasks', ['/Query', '/TN', 'Loupedeck HA'])
    expect(run).toHaveBeenCalledWith('schtasks', ['/Delete', '/TN', 'Loupedeck HA', '/F'])
    expect(r.task).toBe(true)
  })

  it('tâche absente : rien supprimé, pas d’exception', async () => {
    const { d, run } = deps({ queryCode: 1 })
    const r = await removeLegacyInstall(d)
    expect(run).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ task: false, shortcuts: [] })
  })

  it('raccourcis présents : supprimés et listés', async () => {
    const a = path.join('C:\\Bureau', LEGACY_SHORTCUT)
    const b = path.join('C:\\Programmes', LEGACY_SHORTCUT)
    const { d } = deps({ present: [a, b] })
    const r = await removeLegacyInstall(d)
    expect(r.shortcuts).toEqual([a, b])
    expect(d.unlink).toHaveBeenCalledTimes(2)
  })

  it('run qui rejette : journalisé, pas d’exception', async () => {
    const { d } = deps({ run: async () => { throw new Error('schtasks introuvable') } })
    const r = await removeLegacyInstall(d)
    expect(r.task).toBe(false)
    expect(d.log.warn).toHaveBeenCalled()
  })
})
