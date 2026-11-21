import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyDashboard } from '@shared/config/schema'
import { state } from '../src/store'
import { entity, mockFetch, mountEditor, publicConfig } from './helpers'

afterEach(() => vi.unstubAllGlobals())

const drop = (id: string) => ({ dataTransfer: { getData: (t: string) => (t === 'application/x-entity-id' ? id : '') } })

const entities = () => [
  entity('light.salon', { name: 'Salon', areaName: 'Salon' }),
  entity('light.plug', { name: 'Prise lampe', dimmable: false }),
  entity('weather.home'), entity('weather.other'), entity('camera.porch'), entity('camera.back'),
  entity('climate.thermo'), entity('climate.other'),
  entity('sensor.temp', { deviceClass: 'temperature' }), entity('sensor.humid', { deviceClass: 'humidity' }),
]

function withButtons(patch: (cfg: ReturnType<typeof publicConfig>) => void) {
  const cfg = publicConfig()
  patch(cfg)
  return cfg
}

const options = (w: { findAll: (s: string) => any[] }, sel: string) =>
  w.findAll(`${sel} option`).map((o) => (o.element as HTMLOptionElement).value)

describe('glisser-déposer et emplacements', () => {
  it('drop_invalid_shows_reason_no_put', async () => {
    const m = mockFetch(publicConfig(), { entities: entities() })
    const w = await mountEditor()
    await flushPromises()
    await w.get('.dimmer-slot[data-knob=knobTL]').trigger('drop', drop('light.plug'))
    await flushPromises()
    expect(state.error).toBe("Cette lumière n'est pas gradable : placez-la sur une touche centrale.")
    expect(m.puts()).toHaveLength(0)
  })

  it('drop_valid_puts_slot', async () => {
    const m = mockFetch(publicConfig(), { entities: entities() })
    const w = await mountEditor()
    await flushPromises()
    await w.get('.key-slot[data-key="4"]').trigger('drop', drop('light.salon'))
    await flushPromises()
    expect(m.puts()).toHaveLength(1)
    expect(m.puts()[0]!.body.buttons[0].keys[4]).toEqual({ entityId: 'light.salon' })
    expect(state.error).toBeNull()
  })

  it('click_alternative_select_entity_then_slot', async () => {
    const m = mockFetch(publicConfig(), { entities: entities() })
    const w = await mountEditor()
    await flushPromises()
    await w.findAll('.entity-row').find((r) => r.text().includes('light.salon'))!.trigger('click')
    await w.get('.dimmer-slot[data-knob=knobCL]').trigger('click')
    await flushPromises()
    expect(m.puts()).toHaveLength(1)
    expect(m.puts()[0]!.body.buttons[0].dimmers.knobCL).toEqual({ entityId: 'light.salon' })
    // La sélection est consommée : un clic suivant n'écrase rien.
    await w.get('.key-slot[data-key="0"]').trigger('click')
    await flushPromises()
    expect(m.puts()).toHaveLength(1)
  })

  it('click_alternative_invalid_shows_reason', async () => {
    const m = mockFetch(publicConfig(), { entities: entities() })
    const w = await mountEditor()
    await flushPromises()
    await w.findAll('.entity-row').find((r) => r.text().includes('weather.home'))!.trigger('click')
    await w.get('.key-slot[data-key="1"]').trigger('click')
    await flushPromises()
    expect(state.error).toBe('Une touche accepte seulement une lumière ou une prise (interrupteur).')
    expect(m.puts()).toHaveLength(0)
  })

  it('slot_editor_label_icon_blur', async () => {
    const m = mockFetch(withButtons((c) => {
      const b = c.buttons[0]
      if (b?.type === 'lights') b.keys[2] = { entityId: 'light.salon' }
    }), { entities: entities() })
    const w = await mountEditor()
    await flushPromises()
    expect(w.find('input.slot-label').exists()).toBe(false)
    await w.get('.key-slot[data-key="2"]').trigger('click')

    const label = w.get('input.slot-label')
    await label.setValue('Lampe')
    await label.trigger('blur')
    await flushPromises()
    expect(m.puts()).toHaveLength(1)
    expect(m.puts()[0]!.body.buttons[0].keys[2]).toEqual({ entityId: 'light.salon', label: 'Lampe' })

    const icon = w.get('input.slot-icon')
    await icon.setValue('mdi:lamp')
    await icon.trigger('blur')
    await flushPromises()
    expect(m.puts()[1]!.body.buttons[0].keys[2]).toEqual({ entityId: 'light.salon', label: 'Lampe', icon: 'mdi:lamp' })

    await w.get('button.slot-remove').trigger('click')
    await flushPromises()
    expect(m.puts()[2]!.body.buttons[0].keys[2]).toBeNull()
    expect(w.find('input.slot-label').exists()).toBe(false)
  })

  it('entity_picker_filtered', async () => {
    const m = mockFetch(withButtons((c) => {
      const cam = emptyDashboard('camera', 3)
      if (cam.type === 'camera') cam.entityId = 'camera.porch'
      c.buttons[3] = cam
    }), { entities: entities() })
    const w = await mountEditor()
    await flushPromises()

    await w.findAll('.round-button')[2]!.trigger('click') // Météo
    expect(options(w, 'select.entity-picker')).toEqual(['', 'weather.home', 'weather.other'])
    await w.get('select.entity-picker').setValue('weather.home')
    await flushPromises()
    expect(m.puts()[0]!.body.buttons[2].entityId).toBe('weather.home')

    await w.findAll('.round-button')[3]!.trigger('click') // Caméra
    expect(options(w, 'select.entity-picker')).toEqual(['', 'camera.back', 'camera.porch'])
    expect(w.get('img.camera-still').attributes('src')).toMatch(/^\/api\/preview\/3\.png\?refreshCamera=1&v=\d+$/)

    await w.findAll('.round-button')[1]!.trigger('click') // Température
    expect(options(w, 'select.entity-picker')).toEqual(['', 'climate.other', 'climate.thermo'])
    expect(options(w, 'select.sensor-picker')).toEqual(['', 'sensor.temp'])
    await w.get('select.sensor-picker').setValue('sensor.temp')
    await flushPromises()
    expect(m.puts().at(-1)!.body.buttons[1].sensors).toEqual([{ entityId: 'sensor.temp' }])
    await w.get('button.sensor-remove').trigger('click')
    await flushPromises()
    expect(m.puts().at(-1)!.body.buttons[1].sensors).toEqual([])
  })

  it('sensor_list_capped_at_four', async () => {
    mockFetch(withButtons((c) => {
      const b = c.buttons[1]
      if (b?.type === 'climate') b.sensors = ['a', 'b', 'c', 'd'].map((n) => ({ entityId: `sensor.${n}` }))
    }), { entities: entities() })
    const w = await mountEditor()
    await flushPromises()
    await w.findAll('.round-button')[1]!.trigger('click')
    expect(w.findAll('.sensor-row')).toHaveLength(4)
    expect(w.find('select.sensor-picker').exists()).toBe(false)
  })
})

describe('réglages du tableau Caméra', () => {
  const cameraConfig = () => withButtons((c) => {
    const cam = emptyDashboard('camera', 3)
    if (cam.type === 'camera') cam.entityId = 'camera.porch'
    c.buttons[3] = cam
  })

  it('camera_interval_field_puts_interval', async () => {
    const m = mockFetch(cameraConfig(), { entities: entities() })
    const w = await mountEditor()
    await flushPromises()
    await w.findAll('.round-button')[3]!.trigger('click')
    const input = w.get('input.camera-interval')
    expect(input.attributes('min')).toBe('250')
    expect(input.attributes('max')).toBe('2000')
    expect(input.attributes('step')).toBe('250')
    expect((input.element as HTMLInputElement).value).toBe('1000')
    expect(w.text()).toContain('Intervalle (ms)')
    await input.setValue('500')
    await input.trigger('change')
    await flushPromises()
    expect(m.puts().at(-1)!.body.buttons[3].intervalMs).toBe(500)
  })

  it('camera_interval_snaps_to_step_and_bounds', async () => {
    const m = mockFetch(cameraConfig(), { entities: entities() })
    const w = await mountEditor()
    await flushPromises()
    await w.findAll('.round-button')[3]!.trigger('click')
    const input = w.get('input.camera-interval')
    await input.setValue('5000')
    await input.trigger('change')
    await flushPromises()
    expect(m.puts().at(-1)!.body.buttons[3].intervalMs).toBe(2000)
    await input.setValue('620')
    await input.trigger('change')
    await flushPromises()
    expect(m.puts().at(-1)!.body.buttons[3].intervalMs).toBe(500)
  })

  it('camera_fit_select_puts_fit', async () => {
    const m = mockFetch(cameraConfig(), { entities: entities() })
    const w = await mountEditor()
    await flushPromises()
    await w.findAll('.round-button')[3]!.trigger('click')
    expect(w.text()).toContain('Cadrage')
    const select = w.get('select.camera-fit')
    expect(options(w, 'select.camera-fit')).toEqual(['cover', 'contain'])
    expect(select.findAll('option').map((o) => o.text())).toEqual(['Plein écran', 'Image entière'])
    expect((select.element as HTMLSelectElement).value).toBe('cover')
    await select.setValue('contain')
    await flushPromises()
    expect(m.puts().at(-1)!.body.buttons[3].fit).toBe('contain')
  })

  it('camera_settings_absent_for_other_dashboards', async () => {
    mockFetch(cameraConfig(), { entities: entities() })
    const w = await mountEditor()
    await flushPromises()
    await w.findAll('.round-button')[2]!.trigger('click') // Météo
    expect(w.find('input.camera-interval').exists()).toBe(false)
    expect(w.find('select.camera-fit').exists()).toBe(false)
  })
})
