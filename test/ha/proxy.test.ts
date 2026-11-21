import { describe, expect, it, vi } from 'vitest'
import { HaProxy } from '../../src/ha/proxy.js'
import type { HaEntity, HaStatus } from '../../src/ha/types.js'
import { FakeHa } from '../fakes/fake-ha.js'

describe('HaProxy', () => {
  it('replace_rebinds_listeners', () => {
    const fake1 = new FakeHa()
    const fake2 = new FakeHa()
    // close() neutralisé : le proxy doit se désabonner lui-même de l'ancien client.
    const close1 = vi.spyOn(fake1, 'close').mockImplementation(() => {})
    const proxy = new HaProxy(fake1)
    const statuses: HaStatus[] = []
    proxy.onStatus((s) => statuses.push(s))

    fake1.setStatus({ state: 'offline', reason: 'network' })
    expect(statuses).toEqual([{ state: 'offline', reason: 'network' }])

    proxy.replace(fake2)
    expect(close1).toHaveBeenCalledTimes(1)
    // Le statut du nouveau client est émis immédiatement.
    expect(statuses.at(-1)).toEqual({ state: 'online', reason: null })
    const before = statuses.length

    fake1.setStatus({ state: 'offline', reason: 'auth' })
    expect(statuses).toHaveLength(before)

    fake2.setStatus({ state: 'connecting', reason: null })
    expect(statuses.at(-1)).toEqual({ state: 'connecting', reason: null })
    expect(proxy.status()).toEqual({ state: 'connecting', reason: null })
  })

  it('replace émet immédiatement les entités du nouveau client et suit ses mises à jour', () => {
    const fake1 = new FakeHa()
    const fake2 = new FakeHa()
    vi.spyOn(fake1, 'close').mockImplementation(() => {})
    fake2.setEntity('light.salon', 'on')
    const proxy = new HaProxy(fake1)
    const seen: Record<string, HaEntity>[] = []
    proxy.onEntities((e) => seen.push(e))

    proxy.replace(fake2)
    expect(Object.keys(seen.at(-1)!)).toEqual(['light.salon'])
    expect(proxy.entities()['light.salon']?.state).toBe('on')

    fake1.setEntity('light.cuisine', 'on')
    expect(seen).toHaveLength(1)
    fake2.setEntity('light.salon', 'off')
    expect(seen.at(-1)!['light.salon']?.state).toBe('off')
  })

  it('delegates_calls', async () => {
    const fake1 = new FakeHa()
    const fake2 = new FakeHa()
    const proxy = new HaProxy(fake1)
    proxy.replace(fake2)
    await proxy.callService('light', 'toggle', undefined, { entity_id: 'light.salon' })
    expect(fake1.calls).toEqual([])
    expect(fake2.calls).toEqual([{ domain: 'light', service: 'toggle', data: undefined, target: { entity_id: 'light.salon' } }])
  })

  it('un écouteur qui lève n’empêche pas les autres de recevoir', () => {
    const fake = new FakeHa()
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const proxy = new HaProxy(fake, log)
    const seen: HaStatus[] = []
    proxy.onStatus(() => { throw new Error('boum') })
    proxy.onStatus((s) => seen.push(s))
    fake.setStatus({ state: 'offline', reason: 'network' })
    expect(seen).toHaveLength(1)
    expect(log.error).toHaveBeenCalled()
  })

  it('se désabonner retire l’écouteur ; close() ferme le client courant', () => {
    const fake = new FakeHa()
    const close = vi.spyOn(fake, 'close')
    const proxy = new HaProxy(fake)
    const seen: HaStatus[] = []
    const off = proxy.onStatus((s) => seen.push(s))
    off()
    fake.setStatus({ state: 'offline', reason: 'network' })
    expect(seen).toEqual([])
    proxy.close()
    expect(close).toHaveBeenCalledTimes(1)
  })
})
