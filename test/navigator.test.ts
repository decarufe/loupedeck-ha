import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeHa } from './fakes/fake-ha.js'
import { Actions } from '../src/ha/actions.js'
import { dim, Navigator, type DevicePort } from '../src/navigator.js'
import { defaultConfig, type CameraDashboard, type DashboardConfig } from '../src/config/schema.js'
import type { Dashboard } from '../src/dashboards/types.js'
import type { InputEvent } from '../src/device/input.js'
import type { View } from '../src/views.js'

const paintGate = vi.hoisted(() => ({ hold: null as Promise<void> | null }))
vi.mock('../src/render/painters.js', async (orig) => {
  const actual = await orig<typeof import('../src/render/painters.js')>()
  return { ...actual, paint: async (...a: Parameters<typeof actual.paint>) => { await paintGate.hold; return actual.paint(...a) } }
})

class FakeDevice implements DevicePort {
  present = vi.fn()
  setLed = vi.fn()
  vibrate = vi.fn()
  private inputs = new Set<(e: InputEvent) => void>()
  private statuses = new Set<(s: 'connected' | 'disconnected') => void>()
  onInput(cb: (e: InputEvent) => void) { this.inputs.add(cb); return () => { this.inputs.delete(cb) } }
  onStatus(cb: (s: 'connected' | 'disconnected') => void) { this.statuses.add(cb); return () => { this.statuses.delete(cb) } }
  emit(e: InputEvent) { for (const cb of [...this.inputs]) cb(e) }
  status(s: 'connected' | 'disconnected') { for (const cb of [...this.statuses]) cb(s) }
  listeners() { return this.inputs.size + this.statuses.size }
}

interface Fake extends Dashboard { index: number; prepareAlert: ReturnType<typeof vi.fn>; activate: ReturnType<typeof vi.fn>; deactivate: ReturnType<typeof vi.fn>; handle: ReturnType<typeof vi.fn>; stale: boolean }

const flush = () => new Promise<void>(r => setImmediate(r))
const settle = async () => { await flush(); await flush(); await flush() }

describe('Navigator', () => {
  let device: FakeDevice
  let ha: FakeHa
  let actions: Actions
  let nav: Navigator
  let stored: number
  let setActive: ReturnType<typeof vi.fn>
  let made: Fake[]

  const makeDashboard = (cfg: DashboardConfig): Dashboard => {
    const f: Fake = {
      index: made.length, stale: false,
      view: () => (cfg.type === 'camera' && f.stale
        ? { kind: 'full', image: null, message: null, stale: true, offline: false }
        : { kind: 'grid', keys: [], left: [], right: [], offline: false }) as unknown as View,
      handle: vi.fn(), activate: vi.fn(), deactivate: vi.fn(), prepareAlert: vi.fn(),
    }
    made.push(f)
    return f
  }
  const create = () => new Navigator({
    device, ha, actions,
    state: { activeButton: () => stored, setActiveButton: setActive } as never,
    makeDashboard: makeDashboard as never,
  })

  beforeEach(() => {
    device = new FakeDevice()
    ha = new FakeHa()
    actions = new Actions({ ha, feedback: () => {} })
    stored = 0
    setActive = vi.fn(async (i: number) => { stored = i })
    made = []
    nav = create()
  })
  afterEach(() => {
    nav.dispose()
    actions.dispose()
    vi.useRealTimers()
  })

  it('dim_values', () => {
    expect(dim('#FFB300', 0.15)).toBe('#261b00')
  })

  it('switch_dashboard', async () => {
    const cfg = defaultConfig()
    nav.applyConfig(cfg)
    await settle()
    const [d0, , d2] = made
    const changes: number[] = []
    nav.onActiveChange(i => changes.push(i))
    device.present.mockClear()
    d0.activate.mockClear()
    device.emit({ type: 'button', id: 2 })
    expect(d0.deactivate).toHaveBeenCalledTimes(1)
    expect(d2.activate).toHaveBeenCalledTimes(1)
    expect(setActive).toHaveBeenCalledWith(2)
    expect(changes).toEqual([2])
    expect(nav.activeIndex()).toBe(2)
    await settle()
    expect(device.present).toHaveBeenCalledTimes(1)
  })

  it('same_button_noop', () => {
    nav.applyConfig(defaultConfig())
    const d0 = made[0]
    d0.activate.mockClear()
    device.emit({ type: 'button', id: 0 })
    expect(d0.deactivate).not.toHaveBeenCalled()
    expect(d0.activate).not.toHaveBeenCalled()
  })

  it('leds', () => {
    stored = 2
    nav.applyConfig(defaultConfig())
    expect(device.setLed).toHaveBeenCalledWith(2, '#03A9F4')
    expect(device.setLed).toHaveBeenCalledWith(0, dim('#26A69A', 0.15))
    expect(device.setLed).toHaveBeenCalledWith(7, '#000000')
  })

  it('null_button_ignored', () => {
    nav.applyConfig(defaultConfig())
    device.emit({ type: 'button', id: 7 })
    expect(nav.activeIndex()).toBe(0)
    expect(setActive).not.toHaveBeenCalled()
  })

  it('forward_inputs', () => {
    nav.applyConfig(defaultConfig())
    const turn: InputEvent = { type: 'knobTurn', knob: 'knobTL', delta: 1 }
    const tap: InputEvent = { type: 'tap', target: { kind: 'key', index: 3 } }
    device.emit(turn)
    device.emit(tap)
    expect(made[0].handle.mock.calls).toEqual([[turn], [tap]])
    for (const m of made.slice(1)) expect(m.handle).not.toHaveBeenCalled()
  })

  it('restore_active_from_state', () => {
    stored = 3
    nav.applyConfig(defaultConfig())
    expect(nav.activeIndex()).toBe(3)
    expect(made[3].activate).toHaveBeenCalledTimes(1)
    expect(setActive).not.toHaveBeenCalled()
  })

  it('active_removed_falls_back', () => {
    stored = 3
    nav.applyConfig(defaultConfig())
    const cfg = defaultConfig()
    cfg.buttons[3] = null
    cfg.buttons[0] = null
    const changes: number[] = []
    nav.onActiveChange(i => changes.push(i))
    nav.applyConfig(cfg)
    expect(nav.activeIndex()).toBe(1)
    expect(setActive).toHaveBeenCalledWith(1)
    expect(changes).toEqual([1])
    expect(nav.dashboard(0)).toBeNull()
    expect(nav.dashboard(1)).not.toBeNull()
  })

  it('apply_config_rebuilds', () => {
    nav.applyConfig(defaultConfig())
    const old = made[0]
    nav.applyConfig(defaultConfig())
    expect(old.deactivate).toHaveBeenCalledTimes(1)
    const fresh = nav.dashboard(0) as Fake
    expect(fresh).not.toBe(old)
    expect(fresh.activate).toHaveBeenCalledTimes(1)
  })

  it('no_dashboard_renders_empty', async () => {
    const cfg = defaultConfig()
    cfg.buttons = cfg.buttons.map(() => null)
    nav.applyConfig(cfg)
    expect(nav.activeIndex()).toBe(-1)
    await settle()
    expect(device.present).toHaveBeenCalledTimes(1)
  })

  it('render_coalesced', async () => {
    nav.applyConfig(defaultConfig())
    await settle()
    device.present.mockClear()
    for (let i = 0; i < 5; i++) nav.requestRender()
    await settle()
    expect(device.present).toHaveBeenCalledTimes(1)
  })

  it('on_rendered_fires_after_each_present', async () => {
    const rendered = vi.fn()
    const off = nav.onRendered(rendered)
    nav.applyConfig(defaultConfig())
    await settle()
    expect(rendered).toHaveBeenCalledTimes(1)
    nav.requestRender()
    await settle()
    expect(rendered).toHaveBeenCalledTimes(2)
    off()
    nav.requestRender()
    await settle()
    expect(rendered).toHaveBeenCalledTimes(2)
  })

  it('on_rendered_not_fired_when_present_fails', async () => {
    const rendered = vi.fn()
    nav.onRendered(rendered)
    nav.applyConfig(defaultConfig())
    await settle()
    rendered.mockClear()
    device.present.mockImplementationOnce(() => { throw new Error('boom') })
    nav.requestRender()
    await settle()
    expect(rendered).not.toHaveBeenCalled()
  })

  it('reconnect_rerenders', async () => {
    nav.applyConfig(defaultConfig())
    await settle()
    device.present.mockClear()
    device.setLed.mockClear()
    device.status('connected')
    expect(device.setLed).toHaveBeenCalledTimes(8)
    await settle()
    expect(device.present).toHaveBeenCalledTimes(1)
  })

  it('render_error_does_not_stop_later_renders', async () => {
    nav.applyConfig(defaultConfig())
    await settle()
    device.present.mockClear()
    device.present.mockImplementationOnce(() => { throw new Error('boom') })
    nav.requestRender()
    await settle()
    nav.requestRender()
    await settle()
    expect(device.present).toHaveBeenCalledTimes(2)
  })

  it('stale_blinks_red', async () => {
    vi.useFakeTimers()
    stored = 3
    nav.applyConfig(defaultConfig())
    const cam = made[3]
    cam.stale = true
    await vi.advanceTimersByTimeAsync(10)
    expect(device.present).toHaveBeenCalled()
    device.setLed.mockClear()
    await vi.advanceTimersByTimeAsync(1000)
    const color = defaultConfig().buttons[3]!.color
    expect(device.setLed.mock.calls).toEqual([[3, '#FF0000'], [3, color]])
    // fin du clignotement : la vue n'est plus périmée
    await vi.advanceTimersByTimeAsync(500)
    expect(device.setLed).toHaveBeenLastCalledWith(3, '#FF0000')
    cam.stale = false
    nav.requestRender()
    await vi.advanceTimersByTimeAsync(10)
    expect(device.setLed).toHaveBeenLastCalledWith(3, color)
    device.setLed.mockClear()
    await vi.advanceTimersByTimeAsync(2000)
    expect(device.setLed).not.toHaveBeenCalled()
  })

  it('dispose_unsubscribes_and_leaves_no_timers', async () => {
    vi.useFakeTimers()
    stored = 3
    nav.applyConfig(defaultConfig())
    made[3].stale = true
    await vi.advanceTimersByTimeAsync(10)
    nav.dispose()
    expect(made[3].deactivate).toHaveBeenCalledTimes(1)
    expect(device.listeners()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('dispose_during_paint_leaves_nothing', async () => {
    vi.useFakeTimers()
    stored = 3
    nav.applyConfig(defaultConfig())
    made[3].stale = true
    await vi.advanceTimersByTimeAsync(10)
    device.present.mockClear()
    device.setLed.mockClear()
    let release!: () => void
    paintGate.hold = new Promise<void>(r => { release = r })
    nav.requestRender()
    await vi.advanceTimersByTimeAsync(10)
    nav.dispose()
    paintGate.hold = null
    release()
    await vi.advanceTimersByTimeAsync(2000)
    expect(device.present).not.toHaveBeenCalled()
    expect(device.setLed).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  describe('alertes de caméra', () => {
    const S3 = 'binary_sensor.cam_a_person'
    const S4 = 'binary_sensor.cam_b_person'
    const alertConfig = (over: { enabled?: boolean } = {}) => {
      const c = defaultConfig()
      const a = c.buttons[3] as CameraDashboard
      const b = c.buttons[4] as CameraDashboard
      a.entityId = 'camera.a'; a.alert = { enabled: over.enabled ?? true, sensors: [S3] }
      b.entityId = 'camera.b'; b.alert = { enabled: over.enabled ?? true, sensors: [S4] }
      return c
    }
    const adv = (ms: number) => vi.advanceTimersByTimeAsync(ms)
    const fire = (id: string) => { ha.setEntity(id, 'off'); ha.setEntity(id, 'on') }
    const clear = (id: string) => ha.setEntity(id, 'off')
    const press = (i: number) => device.emit({ type: 'button', id: i })
    const turn = () => device.emit({ type: 'knobTurn', knob: 'knobTL', delta: 1 })
    const ledsOf = (i: number) => device.setLed.mock.calls.filter((c) => c[0] === i).map((c) => c[1])
    const lastLed = (i: number) => ledsOf(i).at(-1)

    beforeEach(() => {
      vi.useFakeTimers()
      nav.dispose()
      ha.setEntity(S3, 'off'); ha.setEntity(S4, 'off')
      nav = create()
      nav.applyConfig(alertConfig())
    })

    it('alert_opens_vibrates_without_persisting', () => {
      fire(S3)
      expect(nav.activeIndex()).toBe(3)
      expect(device.vibrate.mock.calls).toEqual([['alert']])
      expect(setActive).not.toHaveBeenCalled()
    })
    it('alert_calls_prepare_before_activate', () => {
      fire(S3)
      expect(made[3].prepareAlert.mock.invocationCallOrder[0]).toBeLessThan(made[3].activate.mock.invocationCallOrder.at(-1)!)
    })
    it('returns_home_after_calm', async () => {
      fire(S3); clear(S3); await adv(30_000)
      expect(nav.activeIndex()).toBe(0)
      expect(lastLed(3)).toBe('#FF00FF')
    })
    it('no_opening_within_5s_of_a_gesture', async () => {
      turn(); await adv(4_999); fire(S3)
      expect(nav.activeIndex()).toBe(0)
      expect(device.vibrate).toHaveBeenCalledTimes(1)
      await adv(60_000)
      expect(nav.activeIndex()).toBe(0)
    })
    it('opens_5s_after_a_gesture', async () => {
      turn(); await adv(5_000); fire(S3)
      expect(nav.activeIndex()).toBe(3)
    })
    it('already_displayed_page_never_returns', async () => {
      press(3); await adv(5_000); fire(S3); clear(S3); await adv(30_000)
      expect(nav.activeIndex()).toBe(3)
    })
    it('latest_alert_takes_the_screen_then_home', async () => {
      fire(S3); fire(S4)
      expect(nav.activeIndex()).toBe(4)
      clear(S4); await adv(30_000)
      expect(nav.activeIndex()).toBe(0)
    })
    it('end_of_hidden_alert_keeps_screen', async () => {
      fire(S3); fire(S4); clear(S3); await adv(30_000)
      expect(nav.activeIndex()).toBe(4)
    })
    it('gesture_marks_seen_and_returns_after_5min', async () => {
      fire(S3); turn(); clear(S3); await adv(200_000)
      expect(nav.activeIndex()).toBe(3)
      turn(); await adv(299_999)
      expect(nav.activeIndex()).toBe(3)
      await adv(1)
      expect(nav.activeIndex()).toBe(0)
      expect(lastLed(3)).not.toBe('#FF00FF')
    })
    it('own_button_keeps_the_camera', async () => {
      fire(S3); press(3)
      expect(setActive).toHaveBeenCalledWith(3)
      await adv(600_000)
      expect(nav.activeIndex()).toBe(3)
    })
    it('other_button_wins_and_marks_seen', async () => {
      fire(S3); press(2)
      expect(nav.activeIndex()).toBe(2)
      await adv(600_000)
      expect(nav.activeIndex()).toBe(2)
      expect(lastLed(3)).not.toBe('#FF00FF')
    })
    it('gesture_on_another_page_does_not_mark_seen', async () => {
      turn(); fire(S3); turn(); clear(S3); await adv(30_000)
      expect(lastLed(3)).toBe('#FF00FF')
    })
    it('button_clears_the_reminder', async () => {
      fire(S3); clear(S3); await adv(30_000)
      press(3)
      expect(lastLed(3)).not.toBe('#FF00FF')
    })
    it('blinks_every_250ms', async () => {
      fire(S3); device.setLed.mockClear(); await adv(500)
      expect(ledsOf(3)).toEqual(['#000000', '#FF00FF'])
    })
    it('alert_hides_stale_red', async () => {
      made[3].stale = true; fire(S3); await adv(3_000)
      expect(ledsOf(3)).not.toContain('#FF0000')
    })
    it('reconnect_restores_alert_led', () => {
      turn(); fire(S3); device.setLed.mockClear(); device.status('connected')
      expect(ledsOf(3)[0]).toMatch(/^#(FF00FF|000000)$/)
    })
    it('config_change_ends_alerts_and_goes_home', async () => {
      fire(S3); nav.applyConfig(alertConfig())
      expect(nav.activeIndex()).toBe(0)
      await adv(600_000)
      expect(lastLed(3)).not.toBe('#FF00FF')
    })
    it('disabled_alert_does_nothing', () => {
      nav.applyConfig(alertConfig({ enabled: false })); fire(S3)
      expect(nav.activeIndex()).toBe(0)
      expect(device.vibrate).not.toHaveBeenCalled()
    })
    it('dispose_during_alert_leaves_no_timers', () => {
      fire(S3); nav.dispose()
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
