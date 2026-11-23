import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyDashboard } from '@shared/config/schema'
import { entity, mockFetch, mountEditor, publicConfig } from './helpers'

afterEach(() => vi.unstubAllGlobals())

const sensor = (id: string, over: Record<string, unknown> = {}) => entity(`binary_sensor.${id}`, { deviceClass: 'motion', deviceId: 'dev1', ...over })
const entities = () => [
  entity('camera.a', { deviceId: 'dev1' }), entity('camera.b', { deviceId: 'dev2' }),
  sensor('a_person'), sensor('a_package'), sensor('a_vehicle'), sensor('a_animal'),
  entity('binary_sensor.portail', { deviceClass: 'door' }),
]

const config = (alert?: { enabled: boolean; sensors: string[] }, entityId: string | null = 'camera.a') => {
  const c = publicConfig()
  const cam = emptyDashboard('camera', 3)
  if (cam.type === 'camera') { cam.entityId = entityId; if (alert) cam.alert = alert }
  c.buttons[3] = cam
  return c
}

async function open(cfg = config()) {
  const m = mockFetch(cfg, { entities: entities() })
  const w = await mountEditor()
  await flushPromises()
  await w.findAll('.round-button')[3]!.trigger('click')
  return { m, w }
}
const lastAlert = (m: ReturnType<typeof mockFetch>) => m.puts().at(-1)!.body.buttons[3].alert

describe('alerte d’une page caméra', () => {
  it('enabling_checks_person_and_package', async () => {
    const { m, w } = await open()
    await w.get('input.alert-enabled').setValue(true)
    await flushPromises()
    expect(lastAlert(m)).toEqual({ enabled: true, sensors: ['binary_sensor.a_package', 'binary_sensor.a_person'] })
  })

  it('disabling_keeps_sensors', async () => {
    const { m, w } = await open(config({ enabled: true, sensors: ['binary_sensor.a_person'] }))
    await w.get('input.alert-enabled').setValue(false)
    await flushPromises()
    expect(lastAlert(m)).toEqual({ enabled: false, sensors: ['binary_sensor.a_person'] })
  })

  it('toggling_a_sensor', async () => {
    const { m, w } = await open(config({ enabled: true, sensors: ['binary_sensor.a_person'] }))
    await w.get('input.alert-sensor[data-id="binary_sensor.a_vehicle"]').setValue(true)
    await flushPromises()
    expect(lastAlert(m).sensors).toEqual(['binary_sensor.a_person', 'binary_sensor.a_vehicle'])
    await w.get('input.alert-sensor[data-id="binary_sensor.a_person"]').setValue(false)
    await flushPromises()
    expect(lastAlert(m).sensors).toEqual(['binary_sensor.a_vehicle'])
  })

  it('add_other_sensor', async () => {
    const { m, w } = await open(config({ enabled: true, sensors: ['binary_sensor.a_person'] }))
    await w.get('select.alert-picker').setValue('binary_sensor.portail')
    await flushPromises()
    expect(lastAlert(m).sensors).toEqual(['binary_sensor.a_person', 'binary_sensor.portail'])
    expect(w.find('select.alert-picker option[value="binary_sensor.portail"]').exists()).toBe(false)
  })

  it('missing_sensor_is_shown_and_removable', async () => {
    const { m, w } = await open(config({ enabled: true, sensors: ['binary_sensor.disparu'] }))
    expect(w.text()).toContain('binary_sensor.disparu')
    await w.get('button.alert-remove').trigger('click')
    await flushPromises()
    expect(lastAlert(m).sensors).toEqual([])
  })

  it('no_sensor_hint', async () => {
    const { w } = await open(config({ enabled: true, sensors: [] }))
    expect(w.text()).toContain('Cochez ou ajoutez au moins un capteur : sans capteur, rien n’alerte.')
  })

  it('changing_camera_resets_alert', async () => {
    const { m, w } = await open(config({ enabled: true, sensors: ['binary_sensor.a_person'] }))
    await w.get('select.entity-picker').setValue('camera.b')
    await flushPromises()
    expect(lastAlert(m)).toEqual({ enabled: false, sensors: [] })
  })

  it('absent_without_camera_entity', async () => {
    const { w } = await open(config(undefined, null))
    expect(w.find('input.alert-enabled').exists()).toBe(false)
  })
})
