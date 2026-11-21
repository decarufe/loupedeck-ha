import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyDashboard } from '@shared/config/schema'
import { state } from '../src/store'
import { mockFetch, mountEditor } from './helpers'

afterEach(() => vi.unstubAllGlobals())

describe('ButtonPanel', () => {
  it('select_button_shows_panel', async () => {
    mockFetch()
    const w = await mountEditor()
    await w.findAll('.round-button')[2]!.trigger('click')
    const select = w.get('select.type-select').element as HTMLSelectElement
    expect(select.selectedOptions[0]!.textContent).toBe('Météo')
    expect((w.get('input.name-input').element as HTMLInputElement).value).toBe('Météo')
  })

  it('change_type_confirms_then_puts', async () => {
    const m = mockFetch()
    const w = await mountEditor()
    await w.findAll('.round-button')[7]!.trigger('click')
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    await w.get('select.type-select').setValue('lights')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(m.puts()).toHaveLength(1)
    expect(m.puts()[0]!.body.buttons[7]).toEqual(emptyDashboard('lights', 7))
    expect(m.puts()[0]!.body.token).toBeUndefined()
    expect(m.puts()[0]!.body.ha.token).toBeUndefined()
    expect(m.puts()[0]!.headers['X-Loupedeck-Editor']).toBe('1')
    expect(m.puts()[0]!.headers['Content-Type']).toBe('application/json')

    // Refus : aucun PUT supplémentaire et le sélecteur revient à la valeur courante.
    vi.stubGlobal('confirm', vi.fn(() => false))
    await w.get('select.type-select').setValue('weather')
    await flushPromises()
    expect(m.puts()).toHaveLength(1)
    expect((w.get('select.type-select').element as HTMLSelectElement).value).toBe('lights')
  })

  it('confirm_false_sends_no_put', async () => {
    const m = mockFetch()
    const w = await mountEditor()
    await w.findAll('.round-button')[7]!.trigger('click')
    vi.stubGlobal('confirm', vi.fn(() => false))
    await w.get('select.type-select').setValue('lights')
    await flushPromises()
    expect(m.puts()).toHaveLength(0)
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
