import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeHa } from '../fakes/fake-ha.js'
import { Actions } from '../../src/ha/actions.js'
import { createCameraDashboard, STALE_MS } from '../../src/dashboards/camera.js'
import { createHaProxySource, type CameraSource } from '../../src/camera/source.js'
import type { FullView } from '../../src/views.js'
import type { CameraDashboard } from '../../src/config/schema.js'

function cfg(over: Partial<CameraDashboard> = {}): CameraDashboard {
  return { type: 'camera', name: 'Porte', color: '#FF8800', entityId: 'camera.porte', source: 'ha-proxy', intervalMs: 1000, ...over }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const img = (n: number) => Buffer.from([n])

interface Probe extends CameraSource { calls: number; running: number; max: number }
/** Source factice : `delay` ms de latence (0 = immédiat), `fail` pour rejeter, `hang` pour rester pendante. */
function probe(opts: { delay?: number; fail?: () => boolean; hang?: () => boolean } = {}): Probe {
  const p: Probe = {
    calls: 0, running: 0, max: 0,
    async next() {
      p.calls++
      const n = p.calls
      p.running++
      p.max = Math.max(p.max, p.running)
      try {
        if (opts.hang?.()) await new Promise<never>(() => {})
        if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay))
        if (opts.fail?.()) throw new Error('boom')
        return img(n)
      } finally { p.running-- }
    },
  }
  return p
}

describe('tableau Caméra', () => {
  let ha: FakeHa
  let actions: Actions
  let render: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T15:00:00'))
    ha = new FakeHa()
    actions = new Actions({ ha, feedback: () => {} })
    render = vi.fn()
  })
  afterEach(() => {
    actions.dispose()
    vi.useRealTimers()
  })

  const make = (src: CameraSource, c = cfg()) => createCameraDashboard(c, { ha, actions, requestRender: render, createSource: () => src })
  const fv = (d: ReturnType<typeof make>) => d.view() as FullView

  it('idle_until_active', async () => {
    const src = probe()
    const d = make(src)
    await vi.advanceTimersByTimeAsync(5000)
    expect(src.calls).toBe(0)
    d.activate()
    await vi.advanceTimersByTimeAsync(2000)
    expect(src.calls).toBeGreaterThan(0)
    d.deactivate()
    expect(vi.getTimerCount()).toBe(0)
    const n = src.calls
    await vi.advanceTimersByTimeAsync(5000)
    expect(src.calls).toBe(n)
  })

  it('paced_no_overlap', async () => {
    const src = probe()
    const d = make(src)
    d.activate()
    await vi.advanceTimersByTimeAsync(3000)
    expect(src.calls).toBeGreaterThanOrEqual(3)
    expect(src.calls).toBeLessThanOrEqual(4)
    expect(src.max).toBe(1)
    expect(render).toHaveBeenCalled()
    d.deactivate()
  })

  it('slow_source_no_pileup', async () => {
    const src = probe({ delay: 1500 })
    const d = make(src)
    d.activate()
    await vi.advanceTimersByTimeAsync(1499)
    expect(src.calls).toBe(1)
    await vi.advanceTimersByTimeAsync(1) // réponse à 1500 : l'appel suivant part tout de suite
    expect(src.calls).toBe(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(src.calls).toBe(4)
    expect(src.max).toBe(1)
    d.deactivate()
  })

  it('first_failure_message', async () => {
    const d = make(probe({ fail: () => true }))
    d.activate()
    await vi.advanceTimersByTimeAsync(10)
    expect(fv(d)).toMatchObject({ image: null, message: 'Image non disponible' })
    d.deactivate()
  })

  it('failure_keeps_last_image', async () => {
    let n = 0
    const d = make(probe({ fail: () => ++n > 1 }))
    d.activate()
    await vi.advanceTimersByTimeAsync(10)
    const first = fv(d).image
    expect(first).not.toBeNull()
    await vi.advanceTimersByTimeAsync(3000)
    expect(fv(d).image).toBe(first)
    expect(fv(d).message).toBeNull()
    d.deactivate()
  })

  it('stale_after_5s', async () => {
    let hang = false
    const d = make(probe({ hang: () => hang }))
    d.activate()
    await vi.advanceTimersByTimeAsync(10)
    expect(fv(d).stale).toBe(false)
    hang = true
    await vi.advanceTimersByTimeAsync(1000) // la source reste pendante
    render.mockClear()
    await vi.advanceTimersByTimeAsync(STALE_MS + 1 - 1000)
    expect(fv(d).stale).toBe(true)
    expect(render).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(render).toHaveBeenCalledTimes(1) // pas de rendu répété tant que l'état ne change pas
    d.deactivate()
  })

  it('stale_view_matches_tick_render', async () => {
    let hang = false
    const d = make(probe({ hang: () => hang }))
    let staleAtRender: boolean[] = []
    render.mockImplementation(() => { staleAtRender.push(fv(d).stale) })
    d.activate()
    await vi.advanceTimersByTimeAsync(10)
    hang = true
    await vi.advanceTimersByTimeAsync(1000)
    staleAtRender = []
    await vi.advanceTimersByTimeAsync(4000 - 10) // t = 5000 : age exactement 5000
    expect(staleAtRender).toEqual([true])
    d.deactivate()
  })

  it('deactivate_aborts_source_signal', async () => {
    let seen: AbortSignal | undefined
    const src: CameraSource = { next: (s) => { seen = s; return new Promise<never>(() => {}) } }
    const d = make(src)
    d.activate()
    await vi.advanceTimersByTimeAsync(10)
    expect(seen?.aborted).toBe(false)
    d.deactivate()
    expect(seen?.aborted).toBe(true)
  })

  it('stale_clears_on_success', async () => {
    let hang = false
    const src = probe({ hang: () => hang })
    const d = make(src)
    d.activate()
    await vi.advanceTimersByTimeAsync(10)
    hang = true
    await vi.advanceTimersByTimeAsync(6000)
    expect(fv(d).stale).toBe(true)
    d.deactivate()
    hang = false
    d.activate() // nouvelle boucle : garde l'ancienne image jusqu'à la nouvelle
    expect(fv(d).image).not.toBeNull()
    await vi.advanceTimersByTimeAsync(10)
    expect(fv(d).stale).toBe(false)
    d.deactivate()
  })

  it('no_message_with_image', async () => {
    const d = make(probe())
    d.activate()
    await vi.advanceTimersByTimeAsync(10)
    expect(fv(d)).toMatchObject({ message: null, offline: false })
    ha.setStatus({ state: 'offline', reason: null })
    expect(fv(d)).toMatchObject({ offline: true, message: null })
    expect(fv(d).image).not.toBeNull()
    d.deactivate()
  })

  it('input_ignored', () => {
    const d = make(probe())
    d.handle({ type: 'tap', target: { kind: 'key', index: 0 } })
    d.handle({ type: 'knobTurn', knob: 'knobTL', delta: 1 })
    d.handle({ type: 'knobPress', knob: 'knobTL' })
    expect(ha.calls).toEqual([])
  })

  it('no_entity', async () => {
    const createSource = vi.fn(() => probe())
    const d = createCameraDashboard(cfg({ entityId: null }), { ha, actions, requestRender: render, createSource })
    expect(fv(d)).toMatchObject({ image: null, message: 'Aucune caméra configurée' })
    d.activate()
    await vi.advanceTimersByTimeAsync(5000)
    expect(createSource).not.toHaveBeenCalled()
    d.deactivate()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ha_proxy_source', async () => {
    const spy = vi.spyOn(ha, 'fetchCameraImage')
    const signal = new AbortController().signal
    const out = await createHaProxySource(ha, 'camera.porte').next(signal)
    expect(spy).toHaveBeenCalledWith('camera.porte', { width: 480, height: 270 }, signal)
    expect(Buffer.isBuffer(out)).toBe(true)
  })
})
