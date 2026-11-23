import { describe, expect, it, vi } from 'vitest'
import { createQuitController } from '../../src/shell/quit.js'

function setup(over: { quitAndInstall?: () => void } = {}) {
  const order: string[] = []
  const stop = vi.fn(async () => { order.push('stop') })
  const exit = vi.fn((code: number) => { order.push(`exit ${code}`) })
  const quitAndInstall = vi.fn(over.quitAndInstall ?? (() => { order.push('quitAndInstall') }))
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const c = createQuitController({ stop, exit, quitAndInstall, log })
  return { c, stop, exit, quitAndInstall, log, order }
}

describe('createQuitController', () => {
  it('quit arrête l’application puis sort à 0', async () => {
    const { c, order } = setup()
    expect(c.inProgress()).toBe(false)
    await c.quit()
    expect(order).toEqual(['stop', 'exit 0'])
    expect(c.inProgress()).toBe(true)
  })

  it('installUpdate arrête l’application puis lance l’installation', async () => {
    const { c, order, exit } = setup()
    await c.installUpdate()
    expect(order).toEqual(['stop', 'quitAndInstall'])
    expect(exit).not.toHaveBeenCalled()
  })

  it('quitAndInstall qui lève : erreur journalisée, puis sortie à 0', async () => {
    const { c, order, log } = setup({ quitAndInstall: () => { throw new Error('installateur introuvable') } })
    await c.installUpdate()
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['stop', 'exit 0'])
  })

  it('quitAndInstall qui ne quitte pas : Quitter sort quand même à 0', async () => {
    const { c, stop, exit } = setup()
    await c.installUpdate()
    await c.quit()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(exit.mock.calls).toEqual([[0]])
  })

  it('installUpdate deux fois, ou après quit : une seule installation, un seul arrêt', async () => {
    const { c, stop, quitAndInstall } = setup()
    await Promise.all([c.installUpdate(), c.installUpdate()])
    expect(stop).toHaveBeenCalledTimes(1)
    expect(quitAndInstall).toHaveBeenCalledTimes(1)
    const other = setup()
    await other.c.quit()
    await other.c.installUpdate()
    expect(other.quitAndInstall).not.toHaveBeenCalled()
  })
})
