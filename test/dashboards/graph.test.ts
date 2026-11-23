import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeHa } from '../fakes/fake-ha.js'
import { Actions } from '../../src/ha/actions.js'
import { createGraphDashboard } from '../../src/dashboards/graph.js'
import type { GraphDashboard } from '../../src/config/schema.js'
import type { GraphView } from '../../src/views.js'

const H = 3_600_000

describe('page Graphique plein écran', () => {
  let ha: FakeHa
  let actions: Actions
  let render: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-22T22:00:00'))
    ha = new FakeHa()
    actions = new Actions({ ha, feedback: () => {} })
    render = vi.fn()
    const now = Date.now()
    ha.setEntity('sensor.conso', '1240', { friendly_name: 'Consommation', unit_of_measurement: 'W' })
    ha.history['sensor.conso'] = Array.from({ length: 72 }, (_, i) => ({ t: now - (72 - i) * H, v: 1000 + (i % 10) * 100 }))
  })
  afterEach(() => {
    actions.dispose()
    vi.useRealTimers()
  })

  const cfg = (over: Partial<GraphDashboard> = {}): GraphDashboard => ({ type: 'graph', name: 'Conso', color: '#FFB300', entityId: 'sensor.conso', windowHours: 12, ...over })
  const make = (c = cfg()) => createGraphDashboard(c, { ha, actions, requestRender: render })
  const gv = (d: ReturnType<typeof make>) => d.view() as GraphView
  const ready = async (d: ReturnType<typeof make>) => { d.activate(); gv(d); await vi.advanceTimersByTimeAsync(10) }

  it('without_entity_shows_message', () => {
    expect(gv(make(cfg({ entityId: null }))).message).toBe('Aucun capteur configuré')
  })

  it('loads_72h_and_shows_default_window', async () => {
    const d = make()
    await ready(d)
    expect(ha.historyCalls[0]!.endMs - ha.historyCalls[0]!.startMs).toBe(72 * H)
    const v = gv(d)
    expect(v.message).toBeNull()
    expect(v.end - v.start).toBe(12 * H)
    expect(v.title).toBe('Consommation')
    expect(v.valueText.replace(/\s/g, ' ')).toBe('1 240 W')
    expect(v.subtitle).toContain('12 h · en direct')
    expect(v.hints.R0?.sub).toBe('12 h')
    expect(v.xLabels[2]).toBe('maintenant')
    d.deactivate()
  })

  it('knobs_scale_and_scroll', async () => {
    const d = make()
    await ready(d)
    const base = gv(d)
    d.handle({ type: 'knobTurn', knob: 'knobTL', delta: 1 })
    const zoomed = gv(d)
    expect(zoomed.hi - zoomed.lo).toBeCloseTo((base.hi - base.lo) / 1.25)
    d.handle({ type: 'knobTurn', knob: 'knobCL', delta: 2 })
    expect(gv(d).lo).toBeGreaterThan(zoomed.lo)
    d.handle({ type: 'knobTurn', knob: 'knobTR', delta: -1 })
    expect(gv(d).end - gv(d).start).toBe(24 * H)
    d.handle({ type: 'knobTurn', knob: 'knobCR', delta: -3 })
    const scrolled = gv(d)
    expect(Date.now() - scrolled.end).toBe(12 * H)
    expect(scrolled.hints.R1?.sub).toBe('il y a 12 h')
    expect(scrolled.scroll.from).toBeCloseTo((72 - 36) / 72)
    expect(render).toHaveBeenCalled()
    d.deactivate()
  })

  it('scroll_is_bounded_by_loaded_history', async () => {
    const d = make()
    await ready(d)
    d.handle({ type: 'knobTurn', knob: 'knobCR', delta: -100 })
    expect(Date.now() - gv(d).start).toBe(72 * H)
    d.handle({ type: 'knobTurn', knob: 'knobCR', delta: 100 })
    expect(gv(d).end).toBe(Date.now())
    d.deactivate()
  })

  it('knob_press_resets_axis', async () => {
    const d = make()
    await ready(d)
    d.handle({ type: 'knobTurn', knob: 'knobTR', delta: 2 })
    d.handle({ type: 'knobTurn', knob: 'knobCR', delta: -2 })
    d.handle({ type: 'knobTurn', knob: 'knobTL', delta: 3 })
    d.handle({ type: 'knobPress', knob: 'knobCR' })
    expect(gv(d).end - gv(d).start).toBe(12 * H)
    expect(gv(d).end).toBe(Date.now())
    expect(gv(d).hints.L0?.sub).not.toBe('×1')
    d.handle({ type: 'knobPress', knob: 'knobTL' })
    expect(gv(d).hints.L0?.sub).toBe('×1')
    d.deactivate()
  })
})
