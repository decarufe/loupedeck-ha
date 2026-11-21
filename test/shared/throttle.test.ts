import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createThrottle } from '../../src/shared/throttle.js'

describe('createThrottle', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('throttle_leading_trailing', () => {
    const fn = vi.fn()
    const t = createThrottle<number>(fn, 200)
    t(1)
    vi.advanceTimersByTime(50); t(2)
    vi.advanceTimersByTime(50); t(3)
    vi.advanceTimersByTime(50); t(4)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith(1)
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(4)
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("un appel isolé n'envoie pas de fin de fenêtre", () => {
    const fn = vi.fn()
    const t = createThrottle<number>(fn, 200)
    t(1)
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
    t(2)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancel annule la valeur en attente et les minuteries', () => {
    const fn = vi.fn()
    const t = createThrottle<number>(fn, 200)
    t(1); t(2)
    t.cancel()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
