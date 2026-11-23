import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupervisor, RESTART_DELAY_MS, STOP_TIMEOUT_MS, type ChildLike } from '../../src/shell/supervisor.js'

class FakeChild extends EventEmitter {
  postMessage = vi.fn()
  kill = vi.fn(() => true)
  exit(code: number) { this.emit('exit', code) }
  send(msg: unknown) { this.emit('message', msg) }
}

function setup() {
  const children: FakeChild[] = []
  const fork = vi.fn((): ChildLike => {
    const c = new FakeChild()
    children.push(c)
    return c as unknown as ChildLike
  })
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const sup = createSupervisor({ fork, log })
  return { sup, fork, log, children, last: () => children[children.length - 1]! }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('createSupervisor', () => {
  it('valeurs par défaut', () => {
    expect(RESTART_DELAY_MS).toBe(5000)
    expect(STOP_TIMEOUT_MS).toBe(10_000)
  })

  it('relance 5000 ms après une sortie à 1', () => {
    const { sup, fork, last } = setup()
    sup.start()
    expect(fork).toHaveBeenCalledTimes(1)
    last().exit(1)
    vi.advanceTimersByTime(4999)
    expect(fork).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(fork).toHaveBeenCalledTimes(2)
  })

  it('ne relance pas après une sortie à 0', () => {
    const { sup, fork, last } = setup()
    sup.start()
    last().exit(0)
    vi.advanceTimersByTime(60_000)
    expect(fork).toHaveBeenCalledTimes(1)
  })

  it('relance à chaque plantage successif', () => {
    const { sup, fork, log, last } = setup()
    sup.start()
    for (let i = 0; i < 3; i++) {
      last().exit(1)
      vi.advanceTimersByTime(RESTART_DELAY_MS)
    }
    expect(fork).toHaveBeenCalledTimes(4)
    expect(log.warn).toHaveBeenCalledTimes(3)
  })

  it('ready met à jour editorUrl et prévient les abonnés ; un message non conforme est ignoré', () => {
    const { sup, last } = setup()
    const seen: (string | null)[] = []
    sup.onEditorUrl((u) => seen.push(u))
    sup.start()
    expect(sup.editorUrl()).toBeNull()
    last().send({ type: 'ready', editorUrl: 'http://127.0.0.1:8765/' })
    expect(sup.editorUrl()).toBe('http://127.0.0.1:8765/')
    last().send({ type: 'ready' })
    last().send('n’importe quoi')
    expect(sup.editorUrl()).toBe('http://127.0.0.1:8765/')
    expect(seen).toEqual(['http://127.0.0.1:8765/'])
  })

  it('le désabonnement arrête les notifications', () => {
    const { sup, last } = setup()
    const l = vi.fn()
    const off = sup.onEditorUrl(l)
    off()
    sup.start()
    last().send({ type: 'ready', editorUrl: 'http://127.0.0.1:8765/' })
    expect(l).not.toHaveBeenCalled()
  })

  it('editorUrl redevient null quand l’enfant sort', () => {
    const { sup, last } = setup()
    const seen: (string | null)[] = []
    sup.onEditorUrl((u) => seen.push(u))
    sup.start()
    last().send({ type: 'ready', editorUrl: 'http://127.0.0.1:8765/' })
    last().exit(1)
    expect(sup.editorUrl()).toBeNull()
    expect(seen).toEqual(['http://127.0.0.1:8765/', null])
  })

  it('stop envoie { type: stop } et se résout à la sortie de l’enfant, sans relance ensuite', async () => {
    const { sup, fork, last } = setup()
    sup.start()
    const child = last()
    let done = false
    const p = sup.stop().then(() => { done = true })
    expect(child.postMessage).toHaveBeenCalledWith({ type: 'stop' })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    child.exit(1)
    await p
    expect(done).toBe(true)
    vi.advanceTimersByTime(60_000)
    expect(fork).toHaveBeenCalledTimes(1)
  })

  it('stop tue l’enfant après 10000 ms sans sortie et se résout', async () => {
    const { sup, last } = setup()
    sup.start()
    const child = last()
    let done = false
    const p = sup.stop().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS - 1)
    expect(child.kill).not.toHaveBeenCalled()
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(child.kill).toHaveBeenCalledTimes(1)
    await p
    expect(done).toBe(true)
  })

  it('stop pendant l’attente de relance annule la relance et se résout tout de suite', async () => {
    const { sup, fork, last } = setup()
    sup.start()
    last().exit(1)
    await sup.stop()
    vi.advanceTimersByTime(60_000)
    expect(fork).toHaveBeenCalledTimes(1)
  })

  it('stop appelé deux fois : un seul message stop', async () => {
    const { sup, last } = setup()
    sup.start()
    const child = last()
    const a = sup.stop()
    const b = sup.stop()
    expect(child.postMessage).toHaveBeenCalledTimes(1)
    child.exit(0)
    await Promise.all([a, b])
  })

  it('fork qui lève : erreur journalisée, nouvel essai après 5000 ms', () => {
    const { sup, fork, log } = setup()
    fork.mockImplementationOnce(() => { throw new Error('spawn EPERM') })
    sup.start()
    expect(log.error).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(RESTART_DELAY_MS - 1)
    expect(fork).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(fork).toHaveBeenCalledTimes(2)
  })

  it('fork qui lève depuis la relance : nouvel essai, sauf après stop', async () => {
    const { sup, fork, log, last } = setup()
    sup.start()
    fork.mockImplementationOnce(() => { throw new Error('spawn EPERM') })
    last().exit(1)
    vi.advanceTimersByTime(RESTART_DELAY_MS)
    expect(fork).toHaveBeenCalledTimes(2)
    expect(log.error).toHaveBeenCalledTimes(1)
    await sup.stop()
    vi.advanceTimersByTime(60_000)
    expect(fork).toHaveBeenCalledTimes(2)
  })

  it('stop sans démarrage se résout', async () => {
    const { sup, fork } = setup()
    await sup.stop()
    sup.start()
    expect(fork).not.toHaveBeenCalled()
  })
})
