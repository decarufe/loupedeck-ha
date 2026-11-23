import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tile } from '@shared/config/schema'
import { state } from '../src/store'
import { entity, mockFetch, mountEditor, publicConfig } from './helpers'

afterEach(() => vi.unstubAllGlobals())

const clock = (n: number): Tile => ({ kind: 'clock', format: 'time', label: `T${n}` })

function withKeys() {
  const cfg = publicConfig()
  const b = cfg.buttons[0]
  if (b?.type === 'custom') {
    for (let i = 0; i < 4; i++) b.keys[i] = clock(i)
    b.strips.knobTL = { kind: 'dimmer', entityId: 'light.salon' }
  }
  return cfg
}
const dt = (data: Record<string, string> = {}) => ({ getData: (t: string) => data[t] ?? '', setData: () => {}, dropEffect: 'move', effectAllowed: 'all' })
const labels = (keys: (Tile | null)[]) => keys.slice(0, 5).map((k) => k?.label ?? null)

describe('réordonner par glisser-déposer', () => {
  it('keys_shift_live_while_dragging_then_drop_commits', async () => {
    const m = mockFetch(withKeys())
    const w = await mountEditor()
    const key = (pos: number) => w.get(`.key-slot[data-key="${pos}"]`)
    await key(0).trigger('dragstart', { dataTransfer: dt() })
    expect(state.drag).toEqual({ type: 'key', index: 0 })
    expect(w.get('.screen').classes()).toContain('tile-drag')
    expect(w.find('.trash').exists()).toBe(true)
    await key(2).trigger('dragover', { dataTransfer: dt() })
    // Aperçu : la touche 0 est dessinée en 3e place, les touches 1 et 2 ont reculé d'une place.
    const lifted = w.get('.key-slot.lifted')
    expect(lifted.attributes('data-key')).toBe('2')
    expect(lifted.attributes('aria-label')).toBe('Touche 3 — T0')
    expect(w.get('.key-slot[data-key="0"]').attributes('aria-label')).toBe('Touche 1 — T1')
    expect(m.puts()).toHaveLength(0)
    await w.get('.key-slot[data-key="2"]').trigger('drop', { dataTransfer: dt() })
    await flushPromises()
    expect(labels(m.puts()[0]!.body.buttons[0].keys)).toEqual(['T1', 'T2', 'T0', 'T3', null])
    expect(state.drag).toBeNull()
    expect(w.find('.trash').exists()).toBe(false)
  })

  it('shift_swaps_and_empty_place_just_moves', async () => {
    const m = mockFetch(withKeys())
    const w = await mountEditor()
    await w.get('.key-slot[data-key="0"]').trigger('dragstart', { dataTransfer: dt() })
    await w.get('.key-slot[data-key="3"]').trigger('drop', { dataTransfer: dt(), shiftKey: true })
    await flushPromises()
    expect(labels(m.puts()[0]!.body.buttons[0].keys)).toEqual(['T3', 'T1', 'T2', 'T0', null])
    await w.get('.key-slot[data-key="1"]').trigger('dragstart', { dataTransfer: dt() })
    await w.get('.key-slot[data-key="4"]').trigger('drop', { dataTransfer: dt() })
    await flushPromises()
    expect(labels(m.puts()[1]!.body.buttons[0].keys)).toEqual(['T3', null, 'T2', 'T0', 'T1'])
  })

  it('ctrl_copies_and_trash_removes', async () => {
    const m = mockFetch(withKeys())
    const w = await mountEditor()
    await w.get('.key-slot[data-key="0"]').trigger('dragstart', { dataTransfer: dt() })
    await w.get('.key-slot[data-key="6"]').trigger('drop', { dataTransfer: dt(), ctrlKey: true })
    await flushPromises()
    const keys = m.puts()[0]!.body.buttons[0].keys
    expect(keys[0].label).toBe('T0')
    expect(keys[6].label).toBe('T0')
    await w.get('.key-slot[data-key="1"]').trigger('dragstart', { dataTransfer: dt() })
    await w.get('.trash').trigger('drop', { dataTransfer: dt() })
    await flushPromises()
    expect(m.puts()[1]!.body.buttons[0].keys[1]).toBeNull()
  })

  it('a_dimmer_cannot_move_to_a_key', async () => {
    const m = mockFetch(withKeys())
    const w = await mountEditor()
    await w.get('.dimmer-slot[data-knob=knobTL]').trigger('dragstart', { dataTransfer: dt() })
    await w.get('.key-slot[data-key="8"]').trigger('drop', { dataTransfer: dt() })
    await flushPromises()
    expect(m.puts()).toHaveLength(0)
    expect(state.error).toBe('Gradateur ne va pas sur une touche centrale.')
  })

  it('pages_shift_live_and_selection_follows', async () => {
    const m = mockFetch(publicConfig())
    const w = await mountEditor()
    const round = (pos: number) => w.get(`.round-button[data-round="${pos}"]`)
    await round(0).trigger('dragstart', { dataTransfer: dt() })
    await round(2).trigger('dragover', { dataTransfer: dt() })
    expect(w.get('.round-button.lifted').attributes('style')).toContain('left: 25%')
    expect(round(0).attributes('aria-label')).toBe('Bouton rond 2 — Température')
    await round(2).trigger('drop', { dataTransfer: dt() })
    await flushPromises()
    expect(m.puts()[0]!.body.buttons.slice(0, 4).map((b: { name: string } | null) => b?.name)).toEqual(['Température', 'Météo', 'Maison', 'Caméra 1'])
    expect(state.selectedButton).toBe(2)
  })

  it('palette_kind_drop_creates_tile_then_entity_is_chosen', async () => {
    const m = mockFetch(publicConfig(), { entities: [entity('binary_sensor.porte', { deviceClass: 'door' })] })
    const w = await mountEditor()
    await flushPromises()
    await w.get('.tab-kinds').trigger('click')
    await w.get('.kind-row[data-kind=state]').trigger('dragstart', { dataTransfer: dt() })
    await w.get('.key-slot[data-key="5"]').trigger('drop', { dataTransfer: dt() })
    await flushPromises()
    expect(m.puts()[0]!.body.buttons[0].keys[5]).toMatchObject({ kind: 'state', entityId: null })
    await w.get('select.tile-entity').setValue('binary_sensor.porte')
    await flushPromises()
    expect(m.puts()[1]!.body.buttons[0].keys[5]).toMatchObject({ kind: 'state', entityId: 'binary_sensor.porte', on: { text: 'Ouverte' }, off: { text: 'Fermée' } })
  })

  it('dimmer_kind_is_refused_on_a_key', async () => {
    const m = mockFetch(publicConfig())
    const w = await mountEditor()
    await w.get('.tab-kinds').trigger('click')
    await w.get('.kind-row[data-kind=dimmer]').trigger('click')
    await w.get('.key-slot[data-key="1"]').trigger('click')
    await flushPromises()
    expect(m.puts()).toHaveLength(0)
    expect(state.error).toBe('Gradateur : seulement sur une bande latérale (molette).')
  })
})

describe('éditeur de touche', () => {
  it('value_tile_options', async () => {
    const cfg = publicConfig()
    const b = cfg.buttons[0]
    if (b?.type === 'custom') b.keys[0] = { kind: 'value', entityId: 'sensor.t', template: '{valeur}', decimals: 0 }
    const m = mockFetch(cfg, { entities: [entity('sensor.t', { unit: '°C', state: '21.4' })] })
    const w = await mountEditor()
    await flushPromises()
    await w.get('.key-slot[data-key="0"]').trigger('click')
    await w.findAll('button.token').find((t) => t.text() === '{unité}')!.trigger('click')
    await flushPromises()
    expect(m.puts()[0]!.body.buttons[0].keys[0].template).toBe('{valeur} {unité}')
    await w.get('select.tile-decimals').setValue('1')
    await flushPromises()
    expect(m.puts()[1]!.body.buttons[0].keys[0].decimals).toBe(1)
    await w.findAll('button.swatch')[2]!.trigger('click')
    await flushPromises()
    expect(m.puts()[2]!.body.buttons[0].keys[0].color).toBe('#FF7043')
    await w.get('select.tile-kind').setValue('graph')
    await flushPromises()
    expect(m.puts()[3]!.body.buttons[0].keys[0]).toMatchObject({ kind: 'graph', entityId: 'sensor.t', color: '#FF7043', period: '6h' })
  })

  it('empty_slot_lists_allowed_kinds', async () => {
    mockFetch()
    const w = await mountEditor()
    await w.get('.dimmer-slot[data-knob=knobCR]').trigger('click')
    expect(w.findAll('button.new-kind').map((b) => b.attributes('data-kind'))).toEqual(['toggle', 'state', 'value', 'clock', 'dimmer'])
    await w.get('.key-slot[data-key="0"]').trigger('click')
    expect(w.findAll('button.new-kind').map((b) => b.attributes('data-kind'))).toEqual(['toggle', 'action', 'state', 'value', 'graph', 'clock'])
  })
})

describe('commandes de page', () => {
  it('camera_and_weather_commands_post_to_server', async () => {
    const cfg = publicConfig()
    const cam = cfg.buttons[3]
    if (cam?.type === 'camera') cam.entityId = 'camera.porte'
    const weather = cfg.buttons[2]
    if (weather?.type === 'weather') weather.entityId = 'weather.home'
    const m = mockFetch(cfg)
    const w = await mountEditor()
    await w.findAll('.round-button')[3]!.trigger('click')
    await w.get('button.camera-reload').trigger('click')
    await flushPromises()
    await w.findAll('.round-button')[2]!.trigger('click')
    await w.get('button.weather-refresh').trigger('click')
    await flushPromises()
    const posts = m.calls.filter((c) => c.method === 'POST' && c.url.startsWith('/api/pages/'))
    expect(posts.map((c) => [c.url, c.body.command])).toEqual([['/api/pages/3/command', 'reload'], ['/api/pages/2/command', 'refresh']])
  })
})
