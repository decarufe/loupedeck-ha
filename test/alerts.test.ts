import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AlertMonitor, CALM_MS, STUCK_MS, type AlertPage } from '../src/alerts.js'
import type { HaEntity } from '../src/ha/types.js'

const S = 'binary_sensor.cam_person'
const P = 'binary_sensor.cam_package'

describe('AlertMonitor', () => {
  let log: string[]
  let ents: Record<string, HaEntity>
  let changes: number
  let m: AlertMonitor
  const pages: (AlertPage | null)[] = [null, null, null, { entityId: 'camera.a', sensors: [S, P] }]

  const withStates = (states: Record<string, string>): Record<string, HaEntity> =>
    Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { entity_id: id, state, attributes: {} }]))
  const configureWith = (states: Record<string, string>, p = pages) => { ents = withStates(states); m.configure(p, ents) }
  const set = (id: string, state: string) => { ents = { ...ents, ...withStates({ [id]: state }) }; m.update(ents) }

  beforeEach(() => {
    vi.useFakeTimers()
    log = []
    changes = 0
    m = new AlertMonitor({
      onStart: (p) => log.push(`start ${p.join(',')}`),
      onEnd: (p) => log.push(`end ${p}`),
      onChange: () => { changes++ },
    })
    configureWith({ [S]: 'off', [P]: 'off' })
  })
  afterEach(() => { m.dispose(); vi.useRealTimers() })

  it('off_to_on_starts_once', () => {
    set(S, 'on')
    expect(log).toEqual(['start 3'])
    expect(m.led(3)).toBe('alert')
    expect(changes).toBeGreaterThan(0)
  })

  it('initial_on_and_unavailable_to_on_do_not_start', () => {
    configureWith({ [S]: 'on', [P]: 'unavailable' })
    set(P, 'on')
    expect(log).toEqual([])
  })

  it('ends_30s_after_off_with_reminder', () => {
    set(S, 'on'); vi.advanceTimersByTime(10_000); set(S, 'off'); vi.advanceTimersByTime(29_999)
    expect(m.led(3)).toBe('alert')
    vi.advanceTimersByTime(1)
    expect(m.led(3)).toBe('reminder')
    expect(log).toEqual(['start 3', 'end 3'])
  })

  it('several_sensors_make_one_alert', () => {
    set(S, 'on'); vi.advanceTimersByTime(5_000); set(P, 'on'); set(S, 'off'); vi.advanceTimersByTime(40_000)
    expect(m.led(3)).toBe('alert')
    set(P, 'off'); vi.advanceTimersByTime(30_000)
    expect(log).toEqual(['start 3', 'end 3'])
  })

  it('detection_during_calm_extends_without_restart', () => {
    set(S, 'on'); set(S, 'off'); vi.advanceTimersByTime(20_000); set(S, 'on'); set(S, 'off'); vi.advanceTimersByTime(29_999)
    expect(log).toEqual(['start 3'])
  })

  it('capped_at_5min_then_silent_until_calm', () => {
    for (let i = 0; i < 20; i++) { set(S, 'on'); vi.advanceTimersByTime(10_000); set(S, 'off'); vi.advanceTimersByTime(10_000) }
    expect(log).toEqual(['start 3', 'end 3'])
    expect(m.led(3)).toBe('reminder')
    vi.advanceTimersByTime(20_000); set(S, 'on')
    expect(log).toEqual(['start 3', 'end 3', 'start 3'])
  })

  it('stuck_sensor_does_not_block_others', () => {
    set(S, 'on'); vi.advanceTimersByTime(STUCK_MS + CALM_MS); set(P, 'on')
    expect(log).toEqual(['start 3', 'end 3', 'start 3'])
  })

  it('seen_is_silent_until_calm', () => {
    set(S, 'on'); m.markSeen(3)
    expect(m.led(3)).toBe('none')
    set(S, 'off'); vi.advanceTimersByTime(20_000); set(S, 'on'); set(S, 'off'); vi.advanceTimersByTime(30_000)
    expect(log).toEqual(['start 3'])
    expect(m.led(3)).toBe('none')
    set(S, 'on')
    expect(log).toEqual(['start 3', 'start 3'])
  })

  it('seen_clears_reminder', () => {
    set(S, 'on'); set(S, 'off'); vi.advanceTimersByTime(30_000)
    expect(m.led(3)).toBe('reminder')
    m.markSeen(3)
    expect(m.led(3)).toBe('none')
  })

  it('same_camera_pages_start_together_and_are_seen_together', () => {
    const two: (AlertPage | null)[] = [null, null, null, { entityId: 'camera.a', sensors: [S] }, null, { entityId: 'camera.a', sensors: [S] }]
    configureWith({ [S]: 'off' }, two)
    set(S, 'on')
    expect(log).toEqual(['start 3,5'])
    m.markSeen(5)
    expect([m.led(3), m.led(5)]).toEqual(['none', 'none'])
  })

  it('entities_gone_end_the_alert_and_return_silent', () => {
    set(S, 'on'); m.update({}); vi.advanceTimersByTime(30_000)
    m.update(withStates({ [S]: 'on' }))
    expect(log).toEqual(['start 3', 'end 3'])
  })

  it('missing_sensor_is_ignored', () => {
    configureWith({ [P]: 'off' })
    set(P, 'on')
    expect(log).toEqual(['start 3'])
  })

  it('configure_resets_everything', () => {
    set(S, 'on')
    configureWith({ [S]: 'on' })
    expect(m.led(3)).toBe('none')
    vi.advanceTimersByTime(600_000)
    expect(log).toEqual(['start 3'])
  })

  it('dispose_leaves_no_timers', () => {
    set(S, 'on'); m.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
