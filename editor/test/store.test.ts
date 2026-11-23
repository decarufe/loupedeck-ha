import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleLive, init, loadConfig, placeEntity, reset, save, state, updateSlot } from '../src/store'
import { entity, mockFetch, mountEditor, publicConfig } from './helpers'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const drop = (id: string) => ({ dataTransfer: { getData: (t: string) => (t === 'application/x-entity-id' ? id : '') } })

function withSlot2() {
  const cfg = publicConfig()
  const b = cfg.buttons[0]
  if (b?.type === 'custom') b.keys[2] = { kind: 'toggle', entityId: 'light.salon' }
  return cfg
}

const waitPuts = async (m: ReturnType<typeof mockFetch>, n: number) =>
  vi.waitFor(() => expect(m.puts()).toHaveLength(n), { timeout: 2000, interval: 5 })

describe('file des sauvegardes', () => {
  it('label_blur_then_immediate_drop_keeps_both_changes', async () => {
    const m = mockFetch(withSlot2(), { entities: [entity('light.salon'), entity('light.cuisine')], putDelayMs: 20 })
    const w = await mountEditor()
    await flushPromises()
    await w.get('.key-slot[data-key="2"]').trigger('click')
    await w.get('input.slot-label').setValue('Lampe')
    // Le blur part, et le placement suit aussitôt, avant la réponse du premier PUT.
    void w.get('input.slot-label').trigger('blur')
    void w.get('.key-slot[data-key="5"]').trigger('drop', drop('light.cuisine'))
    await waitPuts(m, 2)
    // Attendre la réponse du second PUT.
    await vi.waitFor(() => {
      const b = state.config!.buttons[0]
      expect(b?.type === 'custom' && b.keys[5]).toBeTruthy()
    }, { timeout: 2000, interval: 5 })
    const last = m.puts()[1]!.body.buttons[0]
    expect(last.keys[2]).toEqual({ kind: 'toggle', entityId: 'light.salon', label: 'Lampe' })
    expect(last.keys[5]).toEqual({ kind: 'toggle', entityId: 'light.cuisine' })
    expect(m.maxPutsInFlight()).toBe(1)
    const b = state.config!.buttons[0]
    expect(b?.type === 'custom' && b.keys[2]).toEqual({ kind: 'toggle', entityId: 'light.salon', label: 'Lampe' })
    expect(b?.type === 'custom' && b.keys[5]).toEqual({ kind: 'toggle', entityId: 'light.cuisine' })
  })

  it('mutators_apply_to_the_latest_config_one_put_at_a_time', async () => {
    const m = mockFetch(withSlot2(), { entities: [entity('light.salon'), entity('light.cuisine')], putDelayMs: 10 })
    reset()
    await loadConfig()
    state.entities = [entity('light.salon'), entity('light.cuisine')]
    const results = await Promise.all([
      updateSlot({ kind: 'key', index: 2 }, { label: 'Lampe' }),
      placeEntity({ kind: 'key', index: 7 }, 'light.cuisine'),
      save((cfg) => { cfg.buttons[0]!.name = 'Pièces' }),
    ])
    expect(results).toEqual([true, true, true])
    expect(m.maxPutsInFlight()).toBe(1)
    const last = m.puts()[2]!.body.buttons[0]
    expect(last.name).toBe('Pièces')
    expect(last.keys[2]).toEqual({ kind: 'toggle', entityId: 'light.salon', label: 'Lampe' })
    expect(last.keys[7]).toEqual({ kind: 'toggle', entityId: 'light.cuisine' })
  })

  it('a_failed_save_does_not_block_the_queue', async () => {
    const m = mockFetch(withSlot2(), { putDelayMs: 5 })
    reset()
    await loadConfig()
    const fetchFn = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchFn.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'Refusé' }), { status: 400 }))
    const [a, b] = await Promise.all([
      save((cfg) => { cfg.buttons[0]!.name = 'A' }),
      save((cfg) => { cfg.buttons[0]!.name = 'B' }),
    ])
    expect(a).toBe(false)
    expect(b).toBe(true)
    expect(state.config!.buttons[0]!.name).toBe('B')
    expect(m.puts()).toHaveLength(1)
  })
})

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  constructor(readonly url: string) { FakeWebSocket.instances.push(this) }
  close() { this.onclose?.() }
}

describe('reconnexion du WebSocket live', () => {
  it('reopen_reloads_config_and_status', async () => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const m = mockFetch(publicConfig())
    reset()
    vi.useFakeTimers()
    const stop = await init()
    const ws1 = FakeWebSocket.instances[0]!
    ws1.onopen?.()
    await flushPromises()
    const count = (url: string) => m.calls.filter((c) => c.method === 'GET' && c.url === url).length
    // Première ouverture : init a déjà tout chargé, pas de rechargement en double.
    expect(count('/api/config')).toBe(1)
    expect(count('/api/status')).toBe(1)

    // Le serveur a redémarré avec une autre configuration pendant la coupure.
    const changed = publicConfig()
    changed.buttons[0]!.name = 'Modifié ailleurs'
    m.setServerConfig(changed)
    ws1.onclose?.()
    await vi.advanceTimersByTimeAsync(2000)
    const ws2 = FakeWebSocket.instances[1]!
    expect(ws2).toBeDefined()
    ws2.onopen?.()
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(count('/api/config')).toBe(2)
    expect(count('/api/status')).toBe(2)
    expect(state.config!.buttons[0]!.name).toBe('Modifié ailleurs')
    stop()
  })
})

describe('message live « preview »', () => {
  it('preview_bumps_preview_version_without_fetching', async () => {
    const m = mockFetch(publicConfig())
    reset()
    const before = state.previewVersion
    await handleLive({ type: 'preview' })
    expect(state.previewVersion).toBe(before + 1)
    expect(m.calls).toHaveLength(0)
  })
})
