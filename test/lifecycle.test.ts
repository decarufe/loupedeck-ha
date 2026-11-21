import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { EXIT_CRASH, EXIT_OK, installProcessHandlers } from '../src/lifecycle.js'

function fakeProcess() {
  const proc = Object.assign(new EventEmitter(), { exit: vi.fn<(code: number) => void>() })
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return { proc, log }
}

const settle = () => new Promise<void>((r) => setImmediate(r))

describe('installProcessHandlers', () => {
  it('codes_de_sortie', () => {
    expect(EXIT_OK).toBe(0)
    expect(EXIT_CRASH).toBe(1)
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    it(`${signal}_stops_the_app_then_exits_0`, async () => {
      const { proc, log } = fakeProcess()
      const order: string[] = []
      const stop = vi.fn(async () => { order.push('stop') })
      proc.exit.mockImplementation((code) => { order.push(`exit ${code}`) })
      installProcessHandlers({ proc, log, describe: (e) => ({ message: String(e) }), stop })
      proc.emit(signal, signal)
      await settle()
      expect(order).toEqual(['stop', 'exit 0'])
    })
  }

  it('voluntary_stop_exits_0_even_if_stop_fails', async () => {
    const { proc, log } = fakeProcess()
    installProcessHandlers({ proc, log, describe: (e) => ({ message: String(e) }), stop: async () => { throw new Error('boom') } })
    proc.emit('SIGTERM', 'SIGTERM')
    await settle()
    expect(log.error).toHaveBeenCalled()
    expect(proc.exit.mock.calls).toEqual([[0]])
  })

  it('second_signal_while_stopping_is_ignored', async () => {
    const { proc, log } = fakeProcess()
    let release!: () => void
    const stop = vi.fn(() => new Promise<void>((r) => { release = r }))
    installProcessHandlers({ proc, log, describe: (e) => ({ message: String(e) }), stop })
    proc.emit('SIGINT', 'SIGINT')
    proc.emit('SIGINT', 'SIGINT')
    proc.emit('SIGTERM', 'SIGTERM')
    release()
    await settle()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(proc.exit.mock.calls).toEqual([[0]])
  })

  it('uncaught_exception_logs_and_exits_1', () => {
    const { proc, log } = fakeProcess()
    const stop = vi.fn(async () => {})
    installProcessHandlers({ proc, log, describe: (e) => ({ message: (e as Error).message }), stop })
    proc.emit('uncaughtException', new Error('plantage'))
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('arrêt'), { message: 'plantage' })
    expect(proc.exit.mock.calls).toEqual([[1]])
  })

  it('unhandled_rejection_is_logged_and_the_app_keeps_running', () => {
    const { proc, log } = fakeProcess()
    installProcessHandlers({ proc, log, describe: (e) => ({ message: String(e) }), stop: async () => {} })
    proc.emit('unhandledRejection', new Error('oubli'))
    expect(log.error).toHaveBeenCalled()
    expect(proc.exit).not.toHaveBeenCalled()
  })
})
