import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyDashboard } from '@shared/config/schema'
import { handleLive, state } from '../src/store'
import { entity, mockFetch, mountEditor, publicConfig } from './helpers'

afterEach(() => vi.unstubAllGlobals())

function config() {
  const cfg = publicConfig()
  const b = cfg.buttons[0]
  if (b?.type === 'custom') {
    b.keys[0] = { kind: 'value', entityId: 'sensor.t', label: 'Salon', template: '{valeur}', decimals: 0 }
    b.keys[1] = { kind: 'state', entityId: 'binary_sensor.p', on: { text: 'Ouverte', color: '#FF0000' }, off: { text: 'Fermée', color: '#00FF00' } }
  }
  const cam = emptyDashboard('camera', 3)
  if (cam.type === 'camera') cam.entityId = 'camera.porch'
  cfg.buttons[3] = cam
  return cfg
}

async function editor() {
  const m = mockFetch(config(), { entities: [entity('sensor.t'), entity('camera.porch')] })
  const w = await mountEditor()
  await flushPromises()
  const el = (sel: string) => w.get(sel).element as HTMLInputElement
  /** Saisie en cours : le texte est tapé, le champ n'a pas encore perdu le focus. */
  const type = async (sel: string, value: string) => {
    el(sel).value = value
    await w.get(sel).trigger('input')
  }
  return { m, w, type, valueOf: (sel: string) => el(sel).value }
}

/** Ce que le serveur envoie sans arrêt pendant que la maison vit. */
async function refreshes() {
  for (const type of ['preview', 'config', 'status', 'entities'] as const) {
    await handleLive({ type })
    await flushPromises()
  }
}

describe('une saisie survit aux rafraîchissements en direct', () => {
  it.each([
    ['input.slot-label', 0],
    ['input.tile-template', 0],
    ['input.slot-icon', 0],
    ['input.look-text-on', 1],
  ])('%s', async (sel, key) => {
    const { m, w, type, valueOf } = await editor()
    await w.get(`.key-slot[data-key="${key}"]`).trigger('click')
    await type(sel, 'mdi:nouveau')
    await refreshes()
    expect(valueOf(sel)).toBe('mdi:nouveau')
    expect(m.puts()).toHaveLength(0)
    await w.get(sel).trigger('blur')
    await flushPromises()
    expect(m.puts()).toHaveLength(1)
  })

  it('look_color_being_picked', async () => {
    const { w, type, valueOf } = await editor()
    await w.get('.key-slot[data-key="1"]').trigger('click')
    await type('input.look-color-on', '#123456')
    await refreshes()
    expect(valueOf('input.look-color-on')).toBe('#123456')
  })

  it('page_name_and_color', async () => {
    const { type, valueOf } = await editor()
    await type('input.name-input', 'Chez nous')
    await type('input.color-input', '#123456')
    await refreshes()
    expect(valueOf('input.name-input')).toBe('Chez nous')
    expect(valueOf('input.color-input')).toBe('#123456')
  })

  it('camera_interval', async () => {
    const { w, type, valueOf } = await editor()
    await w.findAll('.round-button')[3]!.trigger('click')
    await type('input.camera-interval', '50')
    await refreshes()
    expect(valueOf('input.camera-interval')).toBe('50')
  })

  it('the_preview_itself_still_refreshes', async () => {
    const { w } = await editor()
    await w.get('.key-slot[data-key="0"]').trigger('click')
    const src = () => w.get('.preview-tile img').attributes('src')
    const before = src()
    await handleLive({ type: 'preview' })
    await flushPromises()
    expect(src()).not.toBe(before)
  })
})

describe('après la saisie', () => {
  it('clicking_a_token_keeps_the_text_just_typed', async () => {
    const { m, w, type } = await editor()
    await w.get('.key-slot[data-key="0"]').trigger('click')
    await type('input.tile-template', 'T : {valeur}')
    // Le clic sur le bouton retire d'abord le focus du champ : les deux sauvegardes se suivent.
    await w.get('input.tile-template').trigger('blur')
    await w.findAll('button.token')[1]!.trigger('click')
    await flushPromises()
    expect(m.puts().at(-1)!.body.buttons[0].keys[0].template).toBe('T : {valeur} {unité}')
  })

  it('a_refused_save_shows_the_saved_value_again', async () => {
    const { w, type, valueOf } = await editor()
    await w.get('.key-slot[data-key="0"]').trigger('click')
    await type('input.slot-label', 'Refusé')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Non' }), { status: 400 })))
    await w.get('input.slot-label').trigger('blur')
    await flushPromises()
    expect(state.error).toBe('Non')
    expect(valueOf('input.slot-label')).toBe('Salon')
  })

  it('a_change_from_elsewhere_shows_when_not_typing', async () => {
    const { m, w, valueOf } = await editor()
    await w.get('.key-slot[data-key="0"]').trigger('click')
    const cfg = config()
    const b = cfg.buttons[0]
    if (b?.type === 'custom') b.keys[0]!.label = 'Autre fenêtre'
    m.setServerConfig(cfg)
    await handleLive({ type: 'config' })
    await flushPromises()
    expect(valueOf('input.slot-label')).toBe('Autre fenêtre')
  })

  it('typing_does_not_leak_to_the_next_slot_or_page', async () => {
    const { m, w, type, valueOf } = await editor()
    await type('input.name-input', 'Abandonné')
    await w.findAll('.round-button')[3]!.trigger('click')
    expect(valueOf('input.name-input')).toBe('Caméra 4')
    await w.findAll('.round-button')[0]!.trigger('click')
    await w.get('.key-slot[data-key="0"]').trigger('click')
    await type('input.slot-label', 'Abandonné')
    state.selectedSlot = { kind: 'key', index: 1 }
    await flushPromises()
    expect(valueOf('input.slot-label')).toBe('')
    expect(m.puts()).toHaveLength(0)
  })
})
