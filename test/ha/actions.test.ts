import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Actions } from '../../src/ha/actions.js'
import { FakeHa } from '../fakes/fake-ha.js'

let ha: FakeHa
let feedback: ReturnType<typeof vi.fn>
let actions: Actions

beforeEach(() => {
  vi.useFakeTimers()
  ha = new FakeHa()
  feedback = vi.fn()
  actions = new Actions({ ha, feedback })
})
afterEach(() => {
  actions.dispose()
  vi.useRealTimers()
})

describe('Actions', () => {
  it('offline_guard', () => {
    ha.setStatus({ state: 'offline', reason: 'network' })
    const onChange = vi.fn()
    actions.onChange(onChange)
    actions.toggle('light.a')
    expect(ha.calls).toEqual([])
    expect(feedback).toHaveBeenCalledWith('error')
    expect(actions.overlay('light.a').pending).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('offline_guard sur les réglages', () => {
    ha.setStatus({ state: 'connecting', reason: null })
    actions.setBrightness('light.a', 50)
    actions.setTemperature('climate.t', 20)
    actions.setHvacMode('climate.t', 'cool')
    expect(ha.calls).toEqual([])
    expect(feedback).toHaveBeenCalledTimes(3)
    expect(actions.overlay('light.a').brightnessPct).toBeUndefined()
    expect(actions.overlay('climate.t').temperature).toBeUndefined()
  })

  it('toggle_pending_then_confirmed', () => {
    ha.setEntity('light.a', 'on')
    const onChange = vi.fn()
    actions.onChange(onChange)
    actions.toggle('light.a')
    expect(ha.calls[0]).toEqual({ domain: 'light', service: 'toggle', data: undefined, target: { entity_id: 'light.a' } })
    expect(feedback).toHaveBeenCalledWith('ok')
    expect(actions.overlay('light.a').pending).toBe(true)
    ha.setEntity('light.a', 'off')
    expect(actions.overlay('light.a').pending).toBe(false)
    expect(onChange).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("une mise à jour sans changement d'état ne confirme pas", () => {
    ha.setEntity('light.a', 'on')
    actions.toggle('light.a')
    ha.setEntity('light.a', 'on', { brightness: 3 })
    expect(actions.overlay('light.a').pending).toBe(true)
  })

  it('toggle_timeout_reverts', () => {
    ha.setEntity('light.a', 'on')
    const onChange = vi.fn()
    actions.onChange(onChange)
    actions.toggle('light.a')
    feedback.mockClear()
    vi.advanceTimersByTime(2999)
    expect(actions.overlay('light.a').pending).toBe(true)
    vi.advanceTimersByTime(1)
    expect(actions.overlay('light.a').pending).toBe(false)
    expect(feedback).toHaveBeenCalledWith('error')
    expect(onChange).toHaveBeenCalled()
  })

  it("un second toggle en attente relance l'attente avec une nouvelle base", () => {
    ha.setEntity('light.a', 'on')
    actions.toggle('light.a')
    vi.advanceTimersByTime(2000)
    actions.toggle('light.a')
    vi.advanceTimersByTime(2000)
    expect(actions.overlay('light.a').pending).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(actions.overlay('light.a').pending).toBe(false)
  })

  it('switch_toggle_domain', () => {
    actions.toggle('switch.b')
    expect(ha.calls[0]).toMatchObject({ domain: 'switch', service: 'toggle', target: { entity_id: 'switch.b' } })
  })

  it('brightness_throttled', () => {
    actions.setBrightness('light.a', 10)
    vi.advanceTimersByTime(50); actions.setBrightness('light.a', 20)
    vi.advanceTimersByTime(50); actions.setBrightness('light.a', 30)
    vi.advanceTimersByTime(50); actions.setBrightness('light.a', 40)
    expect(ha.calls).toHaveLength(1)
    expect(ha.calls[0]).toMatchObject({ domain: 'light', service: 'turn_on', data: { brightness_pct: 10 }, target: { entity_id: 'light.a' } })
    expect(actions.overlay('light.a').brightnessPct).toBe(40)
    vi.advanceTimersByTime(50)
    expect(ha.calls).toHaveLength(2)
    expect(ha.calls[1]).toMatchObject({ service: 'turn_on', data: { brightness_pct: 40 } })
    vi.advanceTimersByTime(1449)
    expect(actions.overlay('light.a').brightnessPct).toBe(40)
    vi.advanceTimersByTime(1)
    expect(actions.overlay('light.a').brightnessPct).toBeUndefined()
  })

  it('la rétention se termine 1500 ms après le dernier réglage et notifie', () => {
    const onChange = vi.fn()
    actions.onChange(onChange)
    actions.setBrightness('light.a', 10)
    onChange.mockClear()
    vi.advanceTimersByTime(1500)
    expect(onChange).toHaveBeenCalled()
  })

  it('la limitation est indépendante par entité et par type', () => {
    actions.setBrightness('light.a', 10)
    actions.setBrightness('light.b', 20)
    actions.setTemperature('climate.t', 19)
    expect(ha.calls).toHaveLength(3)
  })

  it('brightness_zero_turns_off', () => {
    actions.setBrightness('light.a', 0)
    expect(ha.calls[0]).toMatchObject({ domain: 'light', service: 'turn_off', target: { entity_id: 'light.a' } })
    expect(ha.calls[0].data).toBeUndefined()
  })

  it('brightness_clamped', () => {
    actions.setBrightness('light.a', 130)
    expect(ha.calls[0]).toMatchObject({ service: 'turn_on', data: { brightness_pct: 100 } })
    expect(actions.overlay('light.a').brightnessPct).toBe(100)
  })

  it('brightness arrondie et bornée à 0', () => {
    actions.setBrightness('light.a', 33.6)
    expect(ha.calls[0]).toMatchObject({ data: { brightness_pct: 34 } })
    actions.setBrightness('light.b', -5)
    expect(ha.calls[1]).toMatchObject({ service: 'turn_off' })
  })

  it('temperature_throttled', () => {
    actions.setTemperature('climate.t', 19.5)
    expect(ha.calls[0]).toMatchObject({ domain: 'climate', service: 'set_temperature', data: { temperature: 19.5 }, target: { entity_id: 'climate.t' } })
    expect(actions.overlay('climate.t').temperature).toBe(19.5)
    actions.setTemperature('climate.t', 20)
    actions.setTemperature('climate.t', 20.5)
    expect(ha.calls).toHaveLength(1)
    vi.advanceTimersByTime(200)
    expect(ha.calls).toHaveLength(2)
    expect(ha.calls[1]).toMatchObject({ data: { temperature: 20.5 } })
  })

  it('knob_settings_send_no_ok_vibration', () => {
    actions.setBrightness('light.a', 10)
    vi.advanceTimersByTime(50); actions.setBrightness('light.a', 20)
    vi.advanceTimersByTime(200)
    actions.setTemperature('climate.t', 19.5)
    actions.setTemperature('climate.t', 20)
    vi.advanceTimersByTime(200)
    expect(ha.calls).toHaveLength(4)
    expect(feedback).not.toHaveBeenCalled()
  })

  it('toggle_and_mode_still_vibrate_ok', () => {
    actions.toggle('light.a')
    expect(feedback).toHaveBeenLastCalledWith('ok')
    feedback.mockClear()
    actions.setHvacMode('climate.t', 'heat')
    expect(feedback).toHaveBeenCalledWith('ok')
  })

  it('knob_setting_rejected_still_vibrates_error', async () => {
    ha.callService = () => Promise.reject(new Error('boom'))
    actions.setBrightness('light.a', 40)
    actions.setTemperature('climate.t', 21)
    await vi.advanceTimersByTimeAsync(0)
    expect(feedback.mock.calls).toEqual([['error'], ['error']])
  })

  it('hvac_mode', () => {
    actions.setHvacMode('climate.t', 'cool')
    actions.setHvacMode('climate.t', 'heat')
    expect(ha.calls).toHaveLength(2)
    expect(ha.calls[0]).toMatchObject({ domain: 'climate', service: 'set_hvac_mode', data: { hvac_mode: 'cool' }, target: { entity_id: 'climate.t' } })
  })

  it('service_rejection_feedback', async () => {
    ha.callService = () => Promise.reject(new Error('boom'))
    actions.toggle('light.a')
    expect(feedback).toHaveBeenCalledWith('ok')
    await vi.advanceTimersByTimeAsync(0)
    expect(feedback).toHaveBeenLastCalledWith('error')
    expect(actions.overlay('light.a').pending).toBe(false)
  })

  it("rejet d'un réglage : feedback error", async () => {
    ha.callService = () => Promise.reject(new Error('boom'))
    actions.setHvacMode('climate.t', 'cool')
    await vi.advanceTimersByTimeAsync(0)
    expect(feedback).toHaveBeenLastCalledWith('error')
  })

  it('onChange : désabonnement et exceptions isolées', () => {
    const good = vi.fn()
    actions.onChange(() => { throw new Error('mauvais écouteur') })
    const off = actions.onChange(good)
    actions.setBrightness('light.a', 10)
    expect(good).toHaveBeenCalled()
    good.mockClear()
    off()
    actions.setBrightness('light.a', 20)
    expect(good).not.toHaveBeenCalled()
  })

  it('dispose vide minuteries et écouteurs', () => {
    ha.setEntity('light.a', 'on')
    const onChange = vi.fn()
    actions.onChange(onChange)
    actions.toggle('light.a')
    actions.setBrightness('light.a', 10)
    actions.setBrightness('light.a', 20)
    actions.setTemperature('climate.t', 20)
    actions.dispose()
    expect(vi.getTimerCount()).toBe(0)
    onChange.mockClear()
    ha.setEntity('light.a', 'off')
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(ha.calls.filter((c) => c.service === 'turn_on')).toHaveLength(1)
  })
})
