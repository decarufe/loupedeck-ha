import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyDashboard } from '@shared/config/schema'
import { state } from '../src/store'
import { mockFetch, mountEditor, publicConfig } from './helpers'

afterEach(() => vi.unstubAllGlobals())

const types = (w: { findAll: (s: string) => any[] }) => w.findAll('.type-choice').map((b) => b.attributes('data-type'))

describe('ButtonPanel', () => {
  it('select_button_shows_fixed_type', async () => {
    mockFetch()
    const w = await mountEditor()
    await w.findAll('.round-button')[2]!.trigger('click')
    expect(w.get('.type-fixed').text()).toBe('Météo')
    expect(w.findAll('.type-choice')).toHaveLength(0)
    expect((w.get('input.name-input').element as HTMLInputElement).value).toBe('Météo')
    expect(w.get('button.clear-page').text()).toBe('Vider la page')
  })

  it('empty_page_offers_the_five_types', async () => {
    mockFetch()
    const w = await mountEditor()
    // Bouton 1 : page Bouton custom sans touche, donc vide.
    expect(types(w)).toEqual(['custom', 'weather', 'camera', 'climate', 'graph'])
    expect(w.get('.type-choice[data-type=custom]').attributes('aria-pressed')).toBe('true')
    await w.findAll('.round-button')[7]!.trigger('click')
    expect(types(w)).toHaveLength(5)
  })

  it('choosing_a_type_on_an_empty_button_puts_it', async () => {
    const m = mockFetch()
    const w = await mountEditor()
    await w.findAll('.round-button')[7]!.trigger('click')
    await w.get('.type-choice[data-type=graph]').trigger('click')
    await flushPromises()
    expect(m.puts()).toHaveLength(1)
    expect(m.puts()[0]!.body.buttons[7]).toEqual(emptyDashboard('graph', 7))
    expect(m.puts()[0]!.body.token).toBeUndefined()
    expect(m.puts()[0]!.body.ha.token).toBeUndefined()
    expect(m.puts()[0]!.headers['X-Loupedeck-Editor']).toBe('1')
    expect(m.puts()[0]!.headers['Content-Type']).toBe('application/json')
    expect(w.get('.type-fixed').text()).toBe('Graphique plein écran')
  })

  it('empty_custom_page_keeps_its_name_and_colour_when_typed', async () => {
    const cfg = publicConfig()
    cfg.buttons[0]!.name = 'Entrée'
    cfg.buttons[0]!.color = '#112233'
    const m = mockFetch(cfg)
    const w = await mountEditor()
    await w.get('.type-choice[data-type=weather]').trigger('click')
    await flushPromises()
    expect(m.puts()[0]!.body.buttons[0]).toMatchObject({ type: 'weather', name: 'Entrée', color: '#112233', entityId: null })
  })

  it('a_page_with_controls_must_be_cleared_before_changing_type', async () => {
    const cfg = publicConfig()
    const b = cfg.buttons[0]
    if (b?.type === 'custom') b.keys[3] = { kind: 'clock', format: 'time' }
    const m = mockFetch(cfg)
    const w = await mountEditor()
    expect(w.findAll('.type-choice')).toHaveLength(0)
    expect(w.get('.type-fixed').text()).toBe('Bouton custom')
    await w.get('button.clear-page').trigger('click')
    await flushPromises()
    expect(m.puts()[0]!.body.buttons[0]).toMatchObject({ type: 'custom', name: 'Maison' })
    expect(m.puts()[0]!.body.buttons[0].keys.every((k: unknown) => k === null)).toBe(true)
    expect(types(w)).toHaveLength(5)
  })

  it('remove_page_empties_the_button', async () => {
    const m = mockFetch()
    const w = await mountEditor()
    await w.findAll('.round-button')[2]!.trigger('click')
    await w.get('button.remove-page').trigger('click')
    await flushPromises()
    expect(m.puts()[0]!.body.buttons[2]).toBeNull()
  })

  it('rename_and_color_save_on_change', async () => {
    const m = mockFetch()
    const w = await mountEditor()
    const name = w.get('input.name-input')
    await name.setValue('Salon')
    await name.trigger('blur')
    await flushPromises()
    expect(m.puts()).toHaveLength(1)
    expect(m.puts()[0]!.body.buttons[0].name).toBe('Salon')

    const color = w.get('input.color-input')
    ;(color.element as HTMLInputElement).value = '#112233'
    await color.trigger('change')
    await flushPromises()
    expect(m.puts()).toHaveLength(2)
    expect(m.puts()[1]!.body.buttons[0].color).toBe('#112233')
  })

  it('save_error_is_kept_for_display', async () => {
    mockFetch()
    const w = await mountEditor()
    const body = JSON.stringify({ error: 'Configuration invalide', issues: ['buttons.0.name : trop long'] })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 400, headers: { 'Content-Type': 'application/json' } })))
    const name = w.get('input.name-input')
    await name.setValue('X')
    await name.trigger('blur')
    await flushPromises()
    expect(state.error).toBe('Configuration invalide — buttons.0.name : trop long')
  })
})
