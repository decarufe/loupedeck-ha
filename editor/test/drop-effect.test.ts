import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { entity, mockFetch, mountEditor, publicConfig } from './helpers'

afterEach(() => vi.unstubAllGlobals())

/** `dataTransfer` qui applique la règle du navigateur : un `dropEffect` absent de `effectAllowed` annule le dépôt. */
function browserTransfer() {
  const data: Record<string, string> = {}
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    setData: (t: string, v: string) => { data[t] = v },
    getData: (t: string) => data[t] ?? '',
    accepts(): boolean {
      return this.dropEffect !== 'none' && (this.effectAllowed === 'all' || this.effectAllowed.toLowerCase().includes(this.dropEffect))
    },
  }
}

function withKey() {
  const cfg = publicConfig()
  const b = cfg.buttons[0]
  if (b?.type === 'custom') b.keys[0] = { kind: 'clock', format: 'time' }
  return cfg
}

describe('le navigateur accepte le dépôt', () => {
  it.each([
    ['entité de la palette', '.entity-row', ''],
    ['type de touche de la palette', '.kind-row[data-kind=clock]', '.tab-kinds'],
    ['touche de la console', '.key-slot[data-key="0"]', ''],
  ])('%s', async (_name, from, tab) => {
    mockFetch(withKey(), { entities: [entity('light.salon')] })
    const w = await mountEditor()
    await flushPromises()
    if (tab) await w.get(tab).trigger('click')
    const dataTransfer = browserTransfer()
    await w.get(from).trigger('dragstart', { dataTransfer })
    for (const over of ['.key-slot[data-key="7"]', '.dimmer-slot[data-knob=knobTL]']) {
      await w.get(over).trigger('dragover', { dataTransfer })
      expect(dataTransfer.accepts(), `${over} : ${dataTransfer.effectAllowed} / ${dataTransfer.dropEffect}`).toBe(true)
    }
  })

  it('moving_a_tile_stays_a_move_and_ctrl_copies', async () => {
    mockFetch(withKey())
    const w = await mountEditor()
    const dataTransfer = browserTransfer()
    await w.get('.key-slot[data-key="0"]').trigger('dragstart', { dataTransfer })
    await w.get('.key-slot[data-key="7"]').trigger('dragover', { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('move')
    await w.get('.key-slot[data-key="7"]').trigger('dragover', { dataTransfer, ctrlKey: true })
    expect(dataTransfer.dropEffect).toBe('copy')
  })
})
