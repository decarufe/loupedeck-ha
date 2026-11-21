import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeHa } from '../fakes/fake-ha.js'
import { Actions } from '../../src/ha/actions.js'
import { createLightsDashboard } from '../../src/dashboards/lights.js'
import { EMPTY_TILE, type GridView } from '../../src/views.js'
import { defaultConfig, KNOB_IDS, type KnobId, type LightsDashboard } from '../../src/config/schema.js'

function cfg(over: Partial<LightsDashboard> = {}): LightsDashboard {
  const dimmers = Object.fromEntries(KNOB_IDS.map(k => [k, null])) as Record<KnobId, null>
  return {
    type: 'lights', name: 'Lumières', color: '#FFAA00',
    keys: [{ entityId: 'light.salon' }, null, { entityId: 'switch.hall' }, { entityId: 'light.ghost' }, { entityId: 'light.indispo' }],
    dimmers: { ...dimmers, knobCL: { entityId: 'light.cuisine' }, knobTR: { entityId: 'light.bureau' } },
    ...over,
  }
}

describe('tableau Lumières', () => {
  let ha: FakeHa
  let actions: Actions
  let render: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    ha = new FakeHa()
    ha.setEntity('light.salon', 'on', { friendly_name: 'Salon', brightness: 153, supported_color_modes: ['brightness'] })
    ha.setEntity('switch.hall', 'on', { friendly_name: 'Hall' })
    ha.setEntity('light.indispo', 'unavailable', { friendly_name: 'Indispo' })
    ha.setEntity('light.cuisine', 'on', { friendly_name: 'Cuisine', brightness: 153, supported_color_modes: ['brightness'] })
    ha.setEntity('light.bureau', 'off', { friendly_name: 'Bureau', brightness: null, supported_color_modes: ['brightness'] })
    actions = new Actions({ ha, feedback: () => {} })
    render = vi.fn()
  })
  afterEach(() => {
    actions.dispose()
    vi.useRealTimers()
  })

  const make = (c = cfg()) => createLightsDashboard(c, { ha, actions, requestRender: render })
  const grid = (d: ReturnType<typeof make>) => d.view() as GridView

  it('on_light_tile', () => {
    expect(grid(make()).keys[0]).toMatchObject({ state: 'on', label: 'Salon', valueText: '60 %', accent: '#FFAA00', level: 0.6 })
  })

  it('slot.label remplace friendly_name', () => {
    const c = cfg({ keys: [{ entityId: 'light.salon', label: 'Séjour' }] })
    expect(grid(make(c)).keys[0].label).toBe('Séjour')
  })

  it('switch_tile', () => {
    const t = grid(make()).keys[2]
    expect(t).toMatchObject({ state: 'on', valueText: null, level: null, icon: 'mdi:toggle-switch' })
  })

  it('missing_entity_tile', () => {
    expect(grid(make()).keys[3]).toMatchObject({ state: 'missing', label: 'light.ghost', valueText: 'Introuvable' })
  })

  it('unavailable_tile', () => {
    expect(grid(make()).keys[4]).toMatchObject({ state: 'unavailable', valueText: 'Indisponible' })
  })

  it('unknown_state_tile_is_unavailable', () => {
    ha.setEntity('light.indispo', 'unknown', { friendly_name: 'Inconnue', supported_color_modes: ['brightness'] })
    ha.setEntity('light.cuisine', 'unknown', { friendly_name: 'Cuisine', supported_color_modes: ['brightness'] })
    const v = grid(make())
    expect(v.keys[4]).toMatchObject({ state: 'unavailable', valueText: 'Indisponible', level: null, label: 'Inconnue' })
    // Molette knobCL → bande gauche, zone 1.
    expect(v.left[1]).toMatchObject({ state: 'unavailable', valueText: 'Indisponible', level: null })
  })

  it('lumière éteinte gradable: Éteinte, niveau 0, icône outline', () => {
    ha.setEntity('light.salon', 'off', { friendly_name: 'Salon', brightness: null, supported_color_modes: ['brightness'] })
    expect(grid(make()).keys[0]).toMatchObject({ state: 'off', valueText: 'Éteinte', level: 0, icon: 'mdi:lightbulb-outline' })
  })

  it('icône: slot.icon puis attributes.icon puis défaut', () => {
    ha.setEntity('light.salon', 'on', { icon: 'mdi:lamp', brightness: 153, supported_color_modes: ['brightness'] })
    expect(grid(make()).keys[0].icon).toBe('mdi:lamp')
    expect(grid(make(cfg({ keys: [{ entityId: 'light.salon', icon: 'mdi:x' }] }))).keys[0].icon).toBe('mdi:x')
    expect(grid(make(cfg({ keys: [{ entityId: 'switch.hall' }] }))).keys[0].icon).toBe('mdi:toggle-switch')
  })

  it('pending vient de actions.overlay', () => {
    const d = make()
    d.handle({ type: 'tap', target: { kind: 'key', index: 0 } })
    expect(grid(d).keys[0].pending).toBe(true)
  })

  it('tap_key_toggles', () => {
    const d = make()
    d.handle({ type: 'tap', target: { kind: 'key', index: 0 } })
    expect(ha.calls).toEqual([{ domain: 'light', service: 'toggle', data: undefined, target: { entity_id: 'light.salon' } }])
    ha.calls.length = 0
    d.handle({ type: 'tap', target: { kind: 'key', index: 1 } })
    d.handle({ type: 'tap', target: { kind: 'key', index: 9 } })
    expect(ha.calls).toEqual([])
  })

  it('strip_order', () => {
    const v = grid(make())
    expect(v.keys).toHaveLength(12)
    expect(v.left).toHaveLength(3)
    expect(v.right).toHaveLength(3)
    expect(v.left[0]).toEqual(EMPTY_TILE)
    expect(v.left[1].label).toBe('Cuisine')
    expect(v.left[2]).toEqual(EMPTY_TILE)
    expect(v.right[0].label).toBe('Bureau')
    expect(v.right[0]).toMatchObject({ state: 'off', valueText: 'Éteinte' })
    expect(v.right[1]).toEqual(EMPTY_TILE)
  })

  it('knob_dims', () => {
    const d = make()
    const turn = (knob: KnobId, delta: number) => d.handle({ type: 'knobTurn', knob, delta })
    turn('knobCL', 1)
    vi.advanceTimersByTime(1500)
    turn('knobCL', -2)
    vi.advanceTimersByTime(1500)
    turn('knobTR', 1)
    vi.advanceTimersByTime(1500)
    expect(ha.calls.map(c => c.data)).toEqual([{ brightness_pct: 65 }, { brightness_pct: 50 }, { brightness_pct: 5 }])
  })

  it('knob à 100 % reste à 100', () => {
    ha.setEntity('light.cuisine', 'on', { brightness: 255, supported_color_modes: ['brightness'] })
    make().handle({ type: 'knobTurn', knob: 'knobCL', delta: 1 })
    expect(ha.calls[0].data).toEqual({ brightness_pct: 100 })
  })

  it('knob_uses_overlay', () => {
    const d = make()
    d.handle({ type: 'knobTurn', knob: 'knobCL', delta: 1 })
    d.handle({ type: 'knobTurn', knob: 'knobCL', delta: 1 })
    expect(actions.overlay('light.cuisine').brightnessPct).toBe(70)
    vi.advanceTimersByTime(300)
    expect(ha.calls.map(c => c.data)).toEqual([{ brightness_pct: 65 }, { brightness_pct: 70 }])
  })

  it('knob_press_and_strip_tap_toggle', () => {
    const d = make()
    d.handle({ type: 'knobPress', knob: 'knobCL' })
    d.handle({ type: 'tap', target: { kind: 'strip', side: 'left', zone: 1 } })
    d.handle({ type: 'tap', target: { kind: 'strip', side: 'right', zone: 0 } })
    expect(ha.calls.map(c => [c.service, (c.target as any).entity_id])).toEqual([
      ['toggle', 'light.cuisine'], ['toggle', 'light.cuisine'], ['toggle', 'light.bureau'],
    ])
  })

  it('unassigned_knob_noop et boutons ignorés', () => {
    const d = make()
    d.handle({ type: 'knobTurn', knob: 'knobTL', delta: 1 })
    d.handle({ type: 'knobPress', knob: 'knobBR' })
    d.handle({ type: 'tap', target: { kind: 'strip', side: 'left', zone: 0 } })
    d.handle({ type: 'button', id: 0 })
    expect(ha.calls).toEqual([])
  })

  it('offline_flag', () => {
    expect(grid(make()).offline).toBe(false)
    ha.setStatus({ state: 'offline', reason: 'network' })
    expect(grid(make()).offline).toBe(true)
    ha.setStatus({ state: 'connecting', reason: null })
    expect(grid(make()).offline).toBe(true)
    ha.setStatus({ state: 'online', reason: null })
    expect(grid(make()).offline).toBe(false)
  })

  it('rerender_on_entities', () => {
    const d = make()
    ha.setEntity('light.salon', 'off')
    expect(render).not.toHaveBeenCalled()
    d.activate()
    ha.setEntity('light.salon', 'on')
    expect(render).toHaveBeenCalledTimes(1)
    actions.setBrightness('light.cuisine', 30)
    expect(render).toHaveBeenCalledTimes(2)
    d.deactivate()
    ha.setEntity('light.salon', 'off')
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('empty_board_shows_message', () => {
    const c = cfg({ keys: [], dimmers: Object.fromEntries(KNOB_IDS.map(k => [k, null])) as Record<KnobId, null> })
    const v = grid(make(c))
    expect(v.keys[5]).toMatchObject({ state: 'empty', label: 'Aucune lumière configurée' })
    expect(v.keys.filter(k => k.label !== '')).toHaveLength(1)
  })

  it('default_board_shows_message', () => {
    const b = defaultConfig().buttons[0] as LightsDashboard
    expect(grid(make(b)).keys[5].label).toBe('Aucune lumière configurée')
  })

  it('message_disappears_with_one_key_or_one_dimmer', () => {
    const none = Object.fromEntries(KNOB_IDS.map(k => [k, null])) as Record<KnobId, null>
    const withKey = grid(make(cfg({ keys: [{ entityId: 'light.salon' }], dimmers: none })))
    expect(withKey.keys.some(k => k.label === 'Aucune lumière configurée')).toBe(false)
    const withDimmer = grid(make(cfg({ keys: [], dimmers: { ...none, knobBR: { entityId: 'light.bureau' } } })))
    expect(withDimmer.keys.some(k => k.label === 'Aucune lumière configurée')).toBe(false)
  })
})
