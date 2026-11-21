import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeHa } from '../fakes/fake-ha.js'
import { Actions } from '../../src/ha/actions.js'
import { createClimateDashboard } from '../../src/dashboards/climate.js'
import { EMPTY_TILE, type GridView } from '../../src/views.js'
import type { ClimateDashboard, KnobId } from '../../src/config/schema.js'

function cfg(over: Partial<ClimateDashboard> = {}): ClimateDashboard {
  return { type: 'climate', name: 'Température', color: '#FF6600', entityId: 'climate.t10', setpointKnob: 'knobTR', sensors: [], ...over }
}
const attrs = (over: object = {}) => ({
  current_temperature: 21, temperature: 19, hvac_modes: ['off', 'heat', 'cool'], min_temp: 7, max_temp: 30, ...over,
})

describe('tableau Température', () => {
  let ha: FakeHa
  let actions: Actions
  let render: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    ha = new FakeHa()
    ha.setEntity('climate.t10', 'heat', attrs())
    actions = new Actions({ ha, feedback: () => {} })
    render = vi.fn()
  })
  afterEach(() => {
    actions.dispose()
    vi.useRealTimers()
  })

  const make = (c = cfg()) => createClimateDashboard(c, { ha, actions, requestRender: render })
  const grid = (d: ReturnType<typeof make>) => d.view() as GridView
  const turn = (d: ReturnType<typeof make>, delta: number, knob: KnobId = 'knobTR') => d.handle({ type: 'knobTurn', knob, delta })

  it('layout', () => {
    const v = grid(make())
    expect(v.keys).toHaveLength(12)
    expect(v.keys[0]).toMatchObject({ label: 'Ambiante', valueText: '21,0 °C', icon: 'mdi:home-thermometer', state: 'on', accent: '#FF6600' })
    expect(v.keys[1]).toMatchObject({ label: 'Consigne', valueText: '19,0 °C', icon: 'mdi:thermostat', state: 'on' })
    expect(v.keys.slice(4, 7).map(k => k.label)).toEqual(['Arrêt', 'Chauffage', 'Climatisation'])
    expect(v.keys.slice(4, 7).map(k => k.state)).toEqual(['off', 'on', 'off'])
    expect(v.keys.slice(4, 7).map(k => k.icon)).toEqual(['mdi:power', 'mdi:fire', 'mdi:snowflake'])
    expect(v.keys[7]).toEqual(EMPTY_TILE)
    expect(v.right[0]).toMatchObject({ label: 'Consigne', valueText: '19,0 °C', state: 'on', accent: '#FF6600' })
    expect(v.right[1]).toEqual(EMPTY_TILE)
    expect(v.left.every(t => t.state === 'empty')).toBe(true)
  })

  it('zone de bande selon setpointKnob', () => {
    expect(grid(make(cfg({ setpointKnob: 'knobCL' }))).left[1].label).toBe('Consigne')
    expect(grid(make(cfg({ setpointKnob: 'knobBR' }))).right[2].label).toBe('Consigne')
    expect(grid(make(cfg({ setpointKnob: 'knobCL' }))).right[0]).toEqual(EMPTY_TILE)
  })

  it('mode off: touches et bande off', () => {
    ha.setEntity('climate.t10', 'off', attrs({ temperature: null }))
    const v = grid(make())
    expect(v.keys[0].state).toBe('off')
    expect(v.right[0].state).toBe('off')
    expect(v.keys[1].valueText).toBe('—')
  })

  it('at most 4 modes', () => {
    ha.setEntity('climate.t10', 'heat', attrs({ hvac_modes: ['off', 'heat', 'cool', 'auto', 'dry', 'fan_only'] }))
    const v = grid(make())
    expect(v.keys.slice(4, 8).map(k => k.label)).toEqual(['Arrêt', 'Chauffage', 'Climatisation', 'Auto'])
    expect(v.keys[8]).toEqual(EMPTY_TILE)
  })

  it('knob_setpoint_step', () => {
    turn(make(), 1)
    expect(ha.calls).toEqual([{ domain: 'climate', service: 'set_temperature', data: { temperature: 19.5 }, target: { entity_id: 'climate.t10' } }])
  })

  it('knob uses target_temp_step', () => {
    ha.setEntity('climate.t10', 'heat', attrs({ target_temp_step: 1 }))
    turn(make(), 1)
    expect(ha.calls[0].data).toEqual({ temperature: 20 })
  })

  it('knob clamps to max and min', () => {
    ha.setEntity('climate.t10', 'heat', attrs({ temperature: 30 }))
    turn(make(), 1)
    expect(ha.calls[0].data).toEqual({ temperature: 30 })
    ha.calls.length = 0
    vi.advanceTimersByTime(5000)
    ha.setEntity('climate.t10', 'heat', attrs({ temperature: 7 }))
    turn(make(), -3)
    expect(ha.calls[0].data).toEqual({ temperature: 7 })
  })

  it('knob rounds to step', () => {
    ha.setEntity('climate.t10', 'heat', attrs({ temperature: 19.2 }))
    turn(make(), 1)
    expect(ha.calls[0].data).toEqual({ temperature: 19.5 })
  })

  it('knob on another knob or temperature null does nothing', () => {
    const d = make()
    turn(d, 1, 'knobCL')
    ha.setEntity('climate.t10', 'off', attrs({ temperature: null }))
    turn(d, 1)
    expect(ha.calls).toEqual([])
  })

  it('overlay_shown', () => {
    const d = make()
    turn(d, 1)
    expect(grid(d).keys[1].valueText).toBe('19,5 °C')
    expect(grid(d).right[0].valueText).toBe('19,5 °C')
  })

  it('knob accumulates through overlay', () => {
    const d = make()
    turn(d, 1)
    turn(d, 1)
    expect(actions.overlay('climate.t10').temperature).toBe(20)
  })

  it('tap_mode', () => {
    make().handle({ type: 'tap', target: { kind: 'key', index: 4 } })
    expect(ha.calls).toEqual([{ domain: 'climate', service: 'set_hvac_mode', data: { hvac_mode: 'off' }, target: { entity_id: 'climate.t10' } }])
  })

  it('taps hors modes ignorés', () => {
    const d = make()
    for (const index of [0, 1, 7, 9]) d.handle({ type: 'tap', target: { kind: 'key', index } })
    d.handle({ type: 'tap', target: { kind: 'strip', side: 'right', zone: 0 } })
    expect(ha.calls).toEqual([])
  })

  it('sensor_tiles', () => {
    ha.setEntity('sensor.salon_temp', '20.4', { friendly_name: 'Salon' })
    ha.setEntity('sensor.hs', 'unavailable', { friendly_name: 'HS' })
    const v = grid(make(cfg({ sensors: [{ entityId: 'sensor.salon_temp' }, { entityId: 'sensor.hs' }, { entityId: 'sensor.ghost' }, { entityId: 'sensor.salon_temp', label: 'Séjour' }] })))
    expect(v.keys[8]).toMatchObject({ valueText: '20,4 °C', label: 'Salon', icon: 'mdi:thermometer', state: 'on' })
    expect(v.keys[9]).toMatchObject({ state: 'unavailable', valueText: 'Indisponible' })
    expect(v.keys[10]).toMatchObject({ state: 'missing', label: 'sensor.ghost', valueText: 'Introuvable' })
    expect(v.keys[11].label).toBe('Séjour')
  })

  it('no_entity_configured', () => {
    const d = make(cfg({ entityId: null }))
    expect(grid(d).keys[0]).toMatchObject({ state: 'empty', label: 'Aucun thermostat' })
    turn(d, 1)
    expect(ha.calls).toEqual([])
  })

  it('missing_climate', () => {
    const d = make(cfg({ entityId: 'climate.ghost' }))
    const v = grid(d)
    expect(v.keys[0]).toMatchObject({ state: 'missing', label: 'climate.ghost', valueText: 'Introuvable' })
    expect(v.keys[1]).toEqual(EMPTY_TILE)
    expect(v.keys.slice(4, 8).every(k => k.state === 'empty')).toBe(true)
    turn(d, 1)
    expect(ha.calls).toEqual([])
  })

  it('unavailable climate', () => {
    ha.setEntity('climate.t10', 'unavailable', {})
    const v = grid(make())
    expect(v.keys[0].state).toBe('unavailable')
    expect(v.keys[1].state).toBe('unavailable')
  })

  it('unknown_climate_is_unavailable', () => {
    ha.setEntity('climate.t10', 'unknown', attrs())
    const v = grid(make())
    expect(v.keys[0]).toMatchObject({ state: 'unavailable', valueText: 'Indisponible' })
    expect(v.keys[1]).toMatchObject({ state: 'unavailable', valueText: 'Indisponible' })
    expect(v.right[0]).toMatchObject({ state: 'unavailable', valueText: 'Indisponible' })
  })

  it('unknown_sensor_is_unavailable', () => {
    ha.setEntity('sensor.inconnu', 'unknown', { friendly_name: 'Inconnu' })
    const v = grid(make(cfg({ sensors: [{ entityId: 'sensor.inconnu' }] })))
    expect(v.keys[8]).toMatchObject({ state: 'unavailable', valueText: 'Indisponible', label: 'Inconnu' })
  })

  it('offline_flag', () => {
    expect(grid(make()).offline).toBe(false)
    ha.setStatus({ state: 'connecting', reason: null })
    expect(grid(make()).offline).toBe(true)
  })

  it('rerender_on_entities', () => {
    const d = make()
    d.activate()
    ha.setEntity('climate.t10', 'cool', attrs())
    expect(render).toHaveBeenCalledTimes(1)
    actions.setTemperature('climate.t10', 20)
    expect(render).toHaveBeenCalledTimes(2)
    d.deactivate()
    ha.setEntity('climate.t10', 'heat', attrs())
    expect(render).toHaveBeenCalledTimes(2)
  })
})
