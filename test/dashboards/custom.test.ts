import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeHa } from '../fakes/fake-ha.js'
import { Actions } from '../../src/ha/actions.js'
import { createCustomDashboard } from '../../src/dashboards/custom.js'
import { EMPTY_TILE, type GridView } from '../../src/views.js'
import { defaultConfig, KNOB_IDS, type CustomDashboard, type KnobId, type Tile } from '../../src/config/schema.js'

function cfg(over: Partial<CustomDashboard> = {}): CustomDashboard {
  const dimmers = Object.fromEntries(KNOB_IDS.map(k => [k, null])) as Record<KnobId, Tile | null>
  return {
    type: 'custom', name: 'Maison', color: '#FFAA00',
    keys: [{ kind: 'toggle', entityId: 'light.salon' }, null, { kind: 'toggle', entityId: 'switch.hall' }, { kind: 'toggle', entityId: 'light.ghost' }, { kind: 'toggle', entityId: 'light.indispo' }],
    strips: { ...dimmers, knobCL: { kind: 'dimmer', entityId: 'light.cuisine' }, knobTR: { kind: 'dimmer', entityId: 'light.bureau' } },
    ...over,
  }
}

describe('page Bouton custom : Interrupteur et Gradateur', () => {
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

  const make = (c = cfg()) => createCustomDashboard(c, { ha, actions, requestRender: render })
  const grid = (d: ReturnType<typeof make>) => d.view() as GridView

  it('on_light_tile', () => {
    expect(grid(make()).keys[0]).toMatchObject({ state: 'on', label: 'Salon', valueText: '60 %', accent: '#FFAA00', level: 0.6 })
  })

  it('slot.label remplace friendly_name', () => {
    const c = cfg({ keys: [{ kind: 'toggle', entityId: 'light.salon', label: 'Séjour' }] })
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
    expect(grid(make(cfg({ keys: [{ kind: 'toggle', entityId: 'light.salon', icon: 'mdi:x' }] }))).keys[0].icon).toBe('mdi:x')
    expect(grid(make(cfg({ keys: [{ kind: 'toggle', entityId: 'switch.hall' }] }))).keys[0].icon).toBe('mdi:toggle-switch')
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
    const c = cfg({ keys: [], strips: Object.fromEntries(KNOB_IDS.map(k => [k, null])) as Record<KnobId, Tile | null> })
    const v = grid(make(c))
    expect(v.keys[5]).toMatchObject({ state: 'empty', label: 'Page vide : configurez-la dans l’éditeur' })
    expect(v.keys.filter(k => k.label !== '')).toHaveLength(1)
  })

  it('default_board_shows_message', () => {
    const b = defaultConfig().buttons[0] as CustomDashboard
    expect(grid(make(b)).keys[5].label).toBe('Page vide : configurez-la dans l’éditeur')
  })

  it('message_disappears_with_one_key_or_one_dimmer', () => {
    const none = Object.fromEntries(KNOB_IDS.map(k => [k, null])) as Record<KnobId, Tile | null>
    const withKey = grid(make(cfg({ keys: [{ kind: 'toggle', entityId: 'light.salon' }], strips: none })))
    expect(withKey.keys.some(k => k.label === 'Page vide : configurez-la dans l’éditeur')).toBe(false)
    const withDimmer = grid(make(cfg({ keys: [], strips: { ...none, knobBR: { kind: 'dimmer', entityId: 'light.bureau' } } })))
    expect(withDimmer.keys.some(k => k.label === 'Page vide : configurez-la dans l’éditeur')).toBe(false)
  })
})

describe('page Bouton custom : autres types de touche', () => {
  let ha: FakeHa
  let actions: Actions
  let render: ReturnType<typeof vi.fn>
  const strips = () => Object.fromEntries(KNOB_IDS.map(k => [k, null])) as Record<KnobId, Tile | null>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-22T22:30:00'))
    ha = new FakeHa()
    actions = new Actions({ ha, feedback: () => {} })
    render = vi.fn()
  })
  afterEach(() => {
    actions.dispose()
    vi.useRealTimers()
  })

  const page = (keys: (Tile | null)[], s = strips()): CustomDashboard => ({ type: 'custom', name: 'Maison', color: '#26A69A', keys, strips: s })
  const make = (c: CustomDashboard) => createCustomDashboard(c, { ha, actions, requestRender: render })
  const grid = (d: ReturnType<typeof make>) => d.view() as GridView

  it('action_runs_scene_or_script', () => {
    ha.setEntity('scene.soiree', 'scening', { friendly_name: 'Soirée' })
    ha.setEntity('script.garage', 'off', { friendly_name: 'Garage' })
    const d = make(page([{ kind: 'action', entityId: 'scene.soiree', confirm: false }, { kind: 'action', entityId: 'script.garage', confirm: false }]))
    expect(grid(d).keys[0]).toMatchObject({ label: 'Soirée', valueText: 'Scène', icon: 'mdi:palette' })
    d.handle({ type: 'tap', target: { kind: 'key', index: 0 } })
    d.handle({ type: 'tap', target: { kind: 'key', index: 1 } })
    expect(ha.calls.map(c => [c.domain, c.service, (c.target as any).entity_id])).toEqual([
      ['scene', 'turn_on', 'scene.soiree'], ['script', 'turn_on', 'script.garage'],
    ])
  })

  it('protected_action_needs_long_press', () => {
    ha.setEntity('script.garage', 'off', { friendly_name: 'Garage' })
    const d = make(page([{ kind: 'action', entityId: 'script.garage', confirm: true }]))
    expect(grid(d).keys[0]).toMatchObject({ valueText: 'Appui long', confirm: true })
    const key = { kind: 'key', index: 0 } as const
    d.handle({ type: 'tap', target: key })
    vi.advanceTimersByTime(300)
    d.handle({ type: 'release', target: key })
    vi.advanceTimersByTime(2000)
    expect(ha.calls).toEqual([])
    d.handle({ type: 'tap', target: key })
    vi.advanceTimersByTime(1000)
    expect(ha.calls).toHaveLength(1)
    d.handle({ type: 'release', target: key })
    expect(ha.calls).toHaveLength(1)
  })

  it('state_tile_uses_text_and_colour_of_state', () => {
    ha.setEntity('binary_sensor.porte', 'on', { friendly_name: 'Porte', device_class: 'door' })
    const tile: Tile = { kind: 'state', entityId: 'binary_sensor.porte', on: { text: 'Ouverte', color: '#EF5350' }, off: { text: 'Fermée', color: '#66BB6A' } }
    const d = make(page([tile]))
    expect(grid(d).keys[0]).toMatchObject({ label: 'Ouverte', valueText: 'Porte', tint: '#EF5350', icon: 'mdi:door-open' })
    ha.setEntity('binary_sensor.porte', 'off', { friendly_name: 'Porte', device_class: 'door' })
    expect(grid(d).keys[0]).toMatchObject({ label: 'Fermée', tint: '#66BB6A', icon: 'mdi:door-closed' })
    d.handle({ type: 'tap', target: { kind: 'key', index: 0 } })
    expect(ha.calls).toEqual([])
  })

  it('value_tile_formats_template', () => {
    ha.setEntity('sensor.exterieur', '-3.64', { friendly_name: 'Extérieur', unit_of_measurement: '°C' })
    ha.setEntity('sensor.collecte', 'Recyclage', { friendly_name: 'Collecte' })
    const d = make(page([
      { kind: 'value', entityId: 'sensor.exterieur', template: 'Dehors {valeur} {unité}', decimals: 1 },
      { kind: 'value', entityId: 'sensor.collecte', template: '{valeur}', decimals: 0 },
    ]))
    expect(grid(d).keys[0]).toMatchObject({ layout: 'big', valueText: 'Dehors -3,6 °C', label: 'Extérieur' })
    expect(grid(d).keys[1].valueText).toBe('Recyclage')
  })

  it('clock_tile_shows_time_and_date', () => {
    const d = make(page([{ kind: 'clock', format: 'time-date' }, { kind: 'clock', format: 'time' }]))
    const [a, b] = grid(d).keys
    expect(a).toMatchObject({ layout: 'big', valueText: '22 h 30' })
    expect(a!.sub).toContain('dimanche')
    expect(b!.sub).toBeNull()
  })

  it('graph_tile_draws_history', async () => {
    const now = Date.now()
    ha.setEntity('sensor.cpu', '23', { friendly_name: 'CPU', unit_of_measurement: '%' })
    ha.history['sensor.cpu'] = [{ t: now - 5 * 3_600_000, v: 10 }, { t: now - 3_600_000, v: 40 }, { t: now - 60_000, v: 23 }]
    const d = make(page([{ kind: 'graph', entityId: 'sensor.cpu', period: '6h', style: 'area', showMinMax: true, decimals: 0 }]))
    d.activate()
    grid(d)
    await vi.advanceTimersByTimeAsync(10)
    const t = grid(d).keys[0]!
    expect(t).toMatchObject({ layout: 'graph', valueText: '23 %', label: 'CPU' })
    expect(t.spark?.values.length).toBeGreaterThan(10)
    expect(t.sub).toBe('10–40 · 6h')
    expect(render).toHaveBeenCalled()
    d.deactivate()
  })

  it('tile_without_entity_asks_for_one', () => {
    const d = make(page([{ kind: 'value', entityId: null, template: '{valeur}', decimals: 0 }]))
    expect(grid(d).keys[0]).toMatchObject({ state: 'missing', valueText: 'Choisir une entité', label: 'Valeur' })
  })

  it('tile_colour_overrides_page_colour', () => {
    ha.setEntity('switch.cafe', 'on', { friendly_name: 'Café' })
    const d = make(page([{ kind: 'toggle', entityId: 'switch.cafe', color: '#FF7043' }, { kind: 'toggle', entityId: 'switch.cafe' }]))
    expect(grid(d).keys[0]!.accent).toBe('#FF7043')
    expect(grid(d).keys[1]!.accent).toBe('#26A69A')
  })
})
