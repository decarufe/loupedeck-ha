import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canDropOn, state } from '../src/store'
import { entity, mockFetch, mountEditor, publicConfig } from './helpers'

afterEach(() => vi.unstubAllGlobals())

const inputs = (m: ReturnType<typeof mockFetch>) => m.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/input')).map((c) => [c.url, c.body])

describe('mode Essayer', () => {
  it('touches_and_knobs_are_sent_to_the_page', async () => {
    const cfg = publicConfig()
    const b = cfg.buttons[0]
    if (b?.type === 'custom') {
      b.keys[2] = { kind: 'toggle', entityId: 'switch.cafe' }
      b.strips.knobCL = { kind: 'dimmer', entityId: 'light.salon' }
    }
    const m = mockFetch(cfg)
    const w = await mountEditor()
    state.mode = 'try'
    await flushPromises()
    await w.get('.key-slot[data-key="2"]').trigger('pointerdown')
    await w.get('.screen').trigger('pointerup')
    await w.get('[data-knob-control=knobCL]').trigger('wheel', { deltaY: -100 })
    await w.get('[data-knob-control=knobCL]').trigger('pointerdown', { clientY: 100 })
    await w.get('[data-knob-control=knobCL]').trigger('pointerup')
    await flushPromises()
    expect(inputs(m)).toEqual([
      ['/api/pages/0/input', { type: 'tap', target: { kind: 'key', index: 2 } }],
      ['/api/pages/0/input', { type: 'release', target: { kind: 'key', index: 2 } }],
      ['/api/pages/0/input', { type: 'knobTurn', knob: 'knobCL', delta: 1 }],
      ['/api/pages/0/input', { type: 'knobPress', knob: 'knobCL' }],
    ])
    // En mode Essayer, un clic ne sélectionne pas et rien n'est enregistré.
    await w.get('.key-slot[data-key="2"]').trigger('click')
    expect(state.selectedSlot).toBeNull()
    expect(m.puts()).toHaveLength(0)
    state.mode = 'edit'
  })

  it('edit_mode_sends_no_gesture', async () => {
    const m = mockFetch()
    const w = await mountEditor()
    await w.get('.key-slot[data-key="0"]').trigger('pointerdown')
    await w.get('[data-knob-control=knobTL]').trigger('wheel', { deltaY: -100 })
    await flushPromises()
    expect(inputs(m)).toEqual([])
  })
})

describe('glisser : cibles et étiquette', () => {
  it('verdicts_explain_what_happens', async () => {
    const cfg = publicConfig()
    const b = cfg.buttons[0]
    if (b?.type === 'custom') b.strips.knobTL = { kind: 'dimmer', entityId: 'light.salon' }
    mockFetch(cfg, { entities: [entity('weather.home')] })
    const w = await mountEditor()
    await flushPromises()
    expect(canDropOn({ type: 'kind', kind: 'dimmer' }, 'key:0')).toEqual({ ok: false, why: 'Gradateur : seulement sur les bandes latérales (molettes)' })
    expect(canDropOn({ type: 'kind', kind: 'clock' }, 'key:0')).toEqual({ ok: true, how: 'Créer : Date et heure' })
    expect(canDropOn({ type: 'strip', knob: 'knobTL' }, 'key:3')).toMatchObject({ ok: false })
    expect(canDropOn({ type: 'entity', entityId: 'weather.home' }, 'strip:knobCR')).toEqual({ ok: false, why: 'home ne peut pas aller sur une bande latérale.' })
    expect(canDropOn({ type: 'round', index: 0 }, 'round:2')).toEqual({ ok: true, how: 'Placer la page ici (les autres se décalent) · Maj : échanger' })
    // Pendant le glisser d'un gradateur, les touches centrales sont atténuées et les bandes en vert.
    await w.get('.dimmer-slot[data-knob=knobTL]').trigger('dragstart', { dataTransfer: { setData: () => {} } })
    expect(w.get('.key-slot[data-key="0"]').classes()).toContain('no')
    expect(w.get('.dimmer-slot[data-knob=knobCR]').classes()).toContain('ok')
    await w.get('.dimmer-slot[data-knob=knobTL]').trigger('dragend')
  })
})
