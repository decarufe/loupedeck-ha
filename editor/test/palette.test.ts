import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleLive } from '../src/store'
import { entity, mockFetch, mountEditor, publicConfig } from './helpers'

afterEach(() => vi.unstubAllGlobals())

const four = () => [
  entity('light.salon', { name: 'Salon', areaName: 'Salon' }),
  entity('switch.hall', { name: 'Hall', areaName: 'Hall' }),
  entity('sensor.temp', { name: 'Temp', deviceClass: 'temperature' }),
  entity('light.ghost', { name: 'Ghost', state: 'unavailable' }),
]

describe('EntityPalette', () => {
  it('palette_search_and_filters', async () => {
    mockFetch(publicConfig(), { entities: four() })
    const w = await mountEditor()
    await flushPromises()
    const rows = () => w.findAll('.entity-row')
    expect(rows()).toHaveLength(4)
    for (const id of ['light.salon', 'switch.hall', 'sensor.temp', 'light.ghost']) {
      expect(w.text()).toContain(id)
    }

    await w.get('input.palette-search').setValue('sal')
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.text()).toContain('light.salon')
    await w.get('input.palette-search').setValue('')

    await w.get('select.domain-filter').setValue('switch')
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.text()).toContain('switch.hall')
    await w.get('select.domain-filter').setValue('')

    await w.get('select.area-filter').setValue('Hall')
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.text()).toContain('switch.hall')
    await w.get('select.area-filter').setValue('')

    const ghost = rows().find((r) => r.text().includes('light.ghost'))!
    expect(ghost.get('.badge').text()).toBe('Indisponible')
    expect(rows().filter((r) => r.find('.badge').exists())).toHaveLength(1)
  })

  it('palette_drag_sets_entity_id', async () => {
    mockFetch(publicConfig(), { entities: four() })
    const w = await mountEditor()
    await flushPromises()
    const setData = vi.fn()
    await w.findAll('.entity-row')[0]!.trigger('dragstart', { dataTransfer: { setData, effectAllowed: '' } })
    expect(setData).toHaveBeenCalledWith('application/x-entity-id', 'light.salon')
  })

  it('palette_offline_message_and_reload_on_live', async () => {
    const m = mockFetch(publicConfig(), { entitiesStatus: 503 })
    const w = await mountEditor()
    await flushPromises()
    expect(w.get('.palette-offline').text()).toBe('Home Assistant hors ligne — liste des entités indisponible')
    expect(w.find('input.palette-search').exists()).toBe(true) // l'éditeur reste utilisable

    m.setEntitiesStatus(200)
    m.setEntities(four())
    await handleLive({ type: 'entities' })
    await flushPromises()
    expect(w.find('.palette-offline').exists()).toBe(false)
    expect(w.findAll('.entity-row')).toHaveLength(4)
  })
})
