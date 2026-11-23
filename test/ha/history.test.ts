import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeHa } from '../fakes/fake-ha.js'
import { HISTORY_REFRESH_MS, HistoryCache } from '../../src/ha/history.js'
import { parseHistory } from '../../src/ha/client.js'

const H = 3_600_000

describe('historique', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-22T22:00:00')) })
  afterEach(() => { vi.useRealTimers() })

  it('parses_compressed_and_full_states', () => {
    expect(parseHistory([
      { s: '21.5', lu: 1_700_000_000 },
      { state: '22', last_updated: '2023-11-14T22:14:00Z' },
      { s: 'unavailable', lu: 1_700_000_100 },
    ])).toEqual([
      { t: 1_700_000_000_000, v: 21.5 },
      { t: Date.parse('2023-11-14T22:14:00Z'), v: 22 },
    ])
    expect(parseHistory(undefined)).toEqual([])
  })

  it('loads_once_then_reloads_after_delay_and_appends_live_states', async () => {
    const ha = new FakeHa()
    const now = Date.now()
    ha.history['sensor.t'] = [{ t: now - 2 * H, v: 20 }]
    const cache = new HistoryCache(ha)
    const changed = vi.fn()
    cache.onChange(changed)
    cache.start()
    expect(cache.points('sensor.t', 6)).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(cache.points('sensor.t', 6)).toEqual([{ t: now - 2 * H, v: 20 }])
    expect(ha.historyCalls).toHaveLength(1)
    expect(changed).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    ha.setEntity('sensor.t', '21')
    expect(cache.points('sensor.t', 6).at(-1)).toEqual({ t: Date.now(), v: 21 })
    expect(ha.historyCalls).toHaveLength(1)
    vi.advanceTimersByTime(HISTORY_REFRESH_MS + 1)
    cache.points('sensor.t', 6)
    expect(ha.historyCalls).toHaveLength(2)
    // Une fenêtre plus longue relance le chargement.
    await vi.advanceTimersByTimeAsync(1)
    cache.points('sensor.t', 24)
    expect(ha.historyCalls.at(-1)!.endMs - ha.historyCalls.at(-1)!.startMs).toBe(24 * H)
    cache.stop()
  })
})
