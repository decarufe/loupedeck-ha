import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DeviceLink, findLivePath, type DeviceLinkOptions, type DeviceStatus } from '../../src/device/link.js'
import type { InputEvent } from '../../src/device/input.js'
import { SCREEN, keyRect } from '../../src/device/regions.js'
import { createSurface, toRgb565, type Surface } from '../../src/render/surface.js'
import { FakeDevice } from '../fakes/fake-device.js'

const FULL = { id: 'left', x: 0, y: 0, width: 480, height: 270, autoRefresh: false }

function solid(color: string): Surface {
  const s = createSurface()
  s.ctx.fillStyle = color
  s.ctx.fillRect(0, 0, SCREEN.width, SCREEN.height)
  return s
}

function setup(devices: FakeDevice[] = [], opts: Partial<DeviceLinkOptions> = {}) {
  const queue = [...devices]
  const created: FakeDevice[] = []
  const times: number[] = []
  const createDevice = vi.fn(async () => {
    times.push(Date.now())
    const d = queue.shift() ?? new FakeDevice()
    created.push(d)
    return d
  })
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const link = new DeviceLink({ createDevice, log, ...opts })
  const statuses: DeviceStatus[] = []
  link.onStatus((s) => statuses.push(s))
  return { link, log, created, times, statuses }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

async function connected(devices: FakeDevice[] = [], opts: Partial<DeviceLinkOptions> = {}) {
  const ctx = setup(devices, opts)
  ctx.link.start()
  await flush()
  expect(ctx.link.status()).toBe('connected')
  return ctx
}

describe('DeviceLink', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('connect_timeout_retries', async () => {
    const d1 = new FakeDevice({ connect: 'hang' })
    const d2 = new FakeDevice()
    const { link, log, created, statuses } = setup([d1, d2])
    link.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(link.status()).toBe('disconnected')
    expect(log.warn.mock.calls.some(([m]) => String(m).includes('Fermez le logiciel Loupedeck'))).toBe(true)
    expect(d1.callsOf('close')).toHaveLength(1)
    expect(d1.listenerCount('disconnect')).toBe(0)
    expect(created).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(created).toHaveLength(2)
    expect(link.status()).toBe('connected')
    expect(statuses).toEqual(['connected'])
    expect(link.firmware()).toBe('0.2.5')
    await link.stop()
  })

  it('retry_backoff_caps', async () => {
    const devices = Array.from({ length: 8 }, () => new FakeDevice({ connect: 'reject' }))
    const { link, times, log } = setup(devices)
    link.start()
    await vi.advanceTimersByTimeAsync(78_000)
    const gaps = times.slice(1).map((t, i) => t - times[i]!)
    expect(gaps).toEqual([1000, 2000, 5000, 10000, 30000, 30000])
    expect(link.status()).toBe('disconnected')
    expect(log.warn).toHaveBeenCalled()
    expect(devices[0]!.callsOf('close')).toHaveLength(1)
    await link.stop()
  })

  it('createDevice qui échoue compte comme un échec de connexion', async () => {
    const createDevice = vi.fn(async () => { throw new Error('Loupedeck Live introuvable') })
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const link = new DeviceLink({ createDevice, log })
    link.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(createDevice).toHaveBeenCalledTimes(2)
    expect(log.warn.mock.calls.some(([m, o]) => JSON.stringify([m, o]).includes('introuvable'))).toBe(true)
    await link.stop()
  })

  it('remet le délai de reconnexion à zéro après une connexion réussie', async () => {
    const devices = [new FakeDevice({ connect: 'reject' }), new FakeDevice({ connect: 'reject' }), new FakeDevice(), new FakeDevice()]
    const { link, times } = setup(devices)
    link.start()
    await vi.advanceTimersByTimeAsync(3000) // échec à 0, échec à 1000, connexion à 3000
    expect(link.status()).toBe('connected')
    devices[2]!.emit('disconnect', new Error('câble'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(link.status()).toBe('connected')
    expect(times.slice(1).map((t, i) => t - times[i]!)).toEqual([1000, 2000, 1000])
    await link.stop()
  })

  it('double_disconnect_single_retry', async () => {
    const d1 = new FakeDevice()
    const { link, created, statuses } = await connected([d1])
    d1.emit('disconnect', new Error('read error'))
    d1.emit('disconnect')
    expect(link.status()).toBe('disconnected')
    expect(statuses).toEqual(['connected', 'disconnected'])
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(created).toHaveLength(2)
    expect(link.status()).toBe('connected')
    expect(statuses).toEqual(['connected', 'disconnected', 'connected'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(created).toHaveLength(2)
    await link.stop()
  })

  it('first_present_full_frame', async () => {
    const d = new FakeDevice()
    const { link } = await connected([d])
    link.present(solid('#ff0000'))
    await flush()
    const draws = d.callsOf('drawBuffer')
    expect(draws).toHaveLength(1)
    expect(draws[0]!.args[0]).toEqual(FULL)
    expect((draws[0]!.args[1] as Buffer).length).toBe(480 * 270 * 2)
    expect(d.callsOf('refresh').map((c) => c.args)).toEqual([['left']])
    await link.stop()
  })

  it('diff_only_changed_key', async () => {
    const d = new FakeDevice()
    const { link } = await connected([d])
    const s = solid('#ff0000')
    link.present(s)
    await flush()
    const r = keyRect(3)
    s.ctx.fillStyle = '#0000ff'
    s.ctx.fillRect(r.x, r.y, r.width, r.height)
    link.present(s)
    await flush()
    const draws = d.callsOf('drawBuffer')
    expect(draws).toHaveLength(2)
    expect(draws[1]!.args[0]).toEqual({ id: 'left', x: 330, y: 0, width: 90, height: 90, autoRefresh: false })
    expect(draws[1]!.args[1]).toEqual(toRgb565(s, r))
    expect(d.callsOf('refresh')).toHaveLength(2)
    // Rien n'a changé : aucune écriture.
    link.present(s)
    await flush()
    expect(d.callsOf('drawBuffer')).toHaveLength(2)
    await link.stop()
  })

  it('coalesce_while_drawing', async () => {
    const d = new FakeDevice({ draw: 'hang' })
    const { link } = await connected([d])
    const a = solid('#ff0000'), b = solid('#00ff00'), c = solid('#0000ff')
    link.present(a)
    await flush()
    link.present(b)
    link.present(c)
    await flush()
    expect(d.callsOf('drawBuffer')).toHaveLength(1)
    d.drawMode = 'resolve'
    d.releaseDraws()
    await flush()
    const draws = d.callsOf('drawBuffer')
    expect(draws).toHaveLength(2)
    expect(draws[1]!.args[0]).toEqual(FULL)
    expect(draws[1]!.args[1]).toEqual(toRgb565(c, SCREEN))
    expect(d.callsOf('refresh')).toHaveLength(2)
    expect(link.status()).toBe('connected')
    await link.stop()
  })

  it('draw_timeout_frees_queue', async () => {
    const d1 = new FakeDevice({ draw: 'hang' })
    const d2 = new FakeDevice()
    const { link, log, created } = await connected([d1, d2])
    const a = solid('#ff0000')
    link.present(a)
    await vi.advanceTimersByTimeAsync(1999)
    expect(link.status()).toBe('connected')
    await vi.advanceTimersByTimeAsync(1)
    expect(link.status()).toBe('disconnected')
    expect(log.error).toHaveBeenCalled()
    expect(d1.callsOf('close')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(created).toHaveLength(2)
    expect(link.status()).toBe('connected')
    // La dernière image est renvoyée en plein écran sur la nouvelle connexion.
    let draws = d2.callsOf('drawBuffer')
    expect(draws).toHaveLength(1)
    expect(draws[0]!.args[0]).toEqual(FULL)
    expect(draws[0]!.args[1]).toEqual(toRgb565(a, SCREEN))
    // Et la file n'est plus bloquée.
    const b = solid('#00ff00')
    link.present(b)
    await flush()
    draws = d2.callsOf('drawBuffer')
    expect(draws).toHaveLength(2)
    expect(draws[1]!.args[0]).toEqual(FULL)
    expect(d2.callsOf('refresh')).toHaveLength(2)
    await link.stop()
  })

  it('present pendant la déconnexion est dessiné à la connexion', async () => {
    const d = new FakeDevice({ connect: 'hang' })
    const d2 = new FakeDevice()
    const { link } = setup([d, d2])
    link.start()
    link.present(solid('#ff0000'))
    const last = solid('#00ff00')
    link.present(last)
    await vi.advanceTimersByTimeAsync(6000)
    expect(link.status()).toBe('connected')
    const draws = d2.callsOf('drawBuffer')
    expect(draws).toHaveLength(1)
    expect(draws[0]!.args[0]).toEqual(FULL)
    expect(draws[0]!.args[1]).toEqual(toRgb565(last, SCREEN))
    await link.stop()
  })

  it('reapply_state_on_reconnect', async () => {
    const d1 = new FakeDevice()
    const d2 = new FakeDevice()
    const { link } = await connected([d1, d2])
    link.setLed(2, '#FF0000')
    link.setBrightness(1)
    expect(d1.callsOf('setButtonColor').map((c) => c.args[0])).toEqual([{ id: 2, color: '#FF0000' }])
    d1.emit('disconnect', new Error('câble'))
    link.setLed(3, '#00FF00')
    expect(d1.callsOf('setButtonColor')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(link.status()).toBe('connected')
    expect(d2.callsOf('setButtonColor').map((c) => c.args[0])).toEqual([
      { id: 2, color: '#FF0000' },
      { id: 3, color: '#00FF00' },
    ])
    expect(d2.callsOf('setBrightness').map((c) => c.args[0])).toEqual([1])
    await link.stop()
  })

  it('vibrate_patterns', async () => {
    const d = new FakeDevice()
    const { link } = await connected([d])
    link.vibrate('ok')
    link.vibrate('error')
    const patterns = d.callsOf('vibrate').map((c) => c.args[0])
    expect(patterns).toEqual([0x01, 0x48])
    expect(patterns).not.toContain(0x76)
    await link.stop()
  })

  it('sync_throw_is_caught', async () => {
    const d = new FakeDevice()
    d.drawThrows = true
    const { link, log } = await connected([d])
    link.present(solid('#ff0000'))
    await flush()
    expect(log.error).toHaveBeenCalled()
    expect(link.status()).toBe('disconnected')
    await link.stop()
  })

  it('transmet les entrées normalisées et permet de se désabonner', async () => {
    const d = new FakeDevice()
    const { link } = await connected([d])
    const got: InputEvent[] = []
    const off = link.onInput((e) => got.push(e))
    d.emit('down', { id: 3 })
    d.emit('up', { id: 3 })
    d.emit('rotate', { id: 'knobBL', delta: 1 })
    off()
    d.emit('down', { id: 4 })
    expect(got).toEqual([{ type: 'button', id: 3 }, { type: 'knobTurn', knob: 'knobBL', delta: 1 }])
    await link.stop()
  })

  it('stop() pendant un dessin bloqué ne laisse aucun minuteur', async () => {
    const d = new FakeDevice({ draw: 'hang' })
    const { link, statuses } = await connected([d])
    link.present(solid('#ff0000'))
    await flush()
    await link.stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(d.callsOf('close')).toHaveLength(1)
    expect(link.status()).toBe('disconnected')
    expect(statuses).toEqual(['connected', 'disconnected'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stop() pendant une connexion bloquée ne laisse aucun minuteur', async () => {
    const d = new FakeDevice({ connect: 'hang' })
    const { link, created } = setup([d])
    link.start()
    await flush()
    await link.stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(d.callsOf('close')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(created).toHaveLength(1)
  })

  it('un connect qui réussit après le délai referme l’appareil orphelin', async () => {
    const d1 = new FakeDevice({ connect: 'hang' })
    const d2 = new FakeDevice({ connect: 'hang' })
    const { link } = setup([d1, d2])
    link.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(d1.callsOf('close')).toHaveLength(1)
    // Le port finit de s'ouvrir à 5500 ms, après l'abandon (le premier close() était sans effet).
    await vi.advanceTimersByTimeAsync(500)
    d1.settleConnect('resolve')
    await flush()
    expect(d1.callsOf('close')).toHaveLength(2)
    expect(link.status()).toBe('disconnected')
    await link.stop()
  })

  it('un connect qui échoue après le délai referme aussi l’appareil orphelin', async () => {
    const d1 = new FakeDevice({ connect: 'hang' })
    const { link, log } = setup([d1, new FakeDevice({ connect: 'hang' })])
    link.start()
    await vi.advanceTimersByTimeAsync(5500)
    expect(d1.callsOf('close')).toHaveLength(1)
    const warns = log.warn.mock.calls.length
    d1.settleConnect('reject')
    await flush()
    expect(d1.callsOf('close')).toHaveLength(2)
    expect(log.warn.mock.calls.length).toBe(warns)
    await link.stop()
  })

  it('un connect qui aboutit après stop() referme l’appareil', async () => {
    const d = new FakeDevice({ connect: 'hang' })
    const { link } = setup([d])
    link.start()
    await flush()
    await link.stop()
    expect(d.callsOf('close')).toHaveLength(1)
    d.settleConnect('resolve')
    await flush()
    expect(d.callsOf('close')).toHaveLength(2)
    expect(link.status()).toBe('disconnected')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('un connect qui échoue après stop() referme l’appareil', async () => {
    const d = new FakeDevice({ connect: 'hang' })
    const { link } = setup([d])
    link.start()
    await flush()
    await link.stop()
    d.settleConnect('reject')
    await flush()
    expect(d.callsOf('close')).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stop() pendant l’attente de reconnexion ne laisse aucun minuteur', async () => {
    const { link, created } = setup([new FakeDevice({ connect: 'reject' })])
    link.start()
    await flush()
    expect(vi.getTimerCount()).toBe(1)
    await link.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(created).toHaveLength(1)
  })
})

describe('findLivePath', () => {
  const live = { path: 'COM4', vendorId: 0x2ec2, productId: 0x0004 }
  const razer = { path: 'COM5', vendorId: 0x1532, productId: 0x0d06 }

  it('trouve la Loupedeck Live', () => {
    expect(findLivePath([razer, live], null)).toBe('COM4')
  })
  it('ignore les autres fabricants', () => {
    expect(findLivePath([razer], null)).toBeNull()
  })
  it('renvoie tel quel un chemin configuré', () => {
    expect(findLivePath([live], 'COM9')).toBe('COM9')
  })
  it('renvoie null pour une liste vide', () => {
    expect(findLivePath([], null)).toBeNull()
  })
})
