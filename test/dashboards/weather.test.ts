import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeHa } from '../fakes/fake-ha.js'
import { Actions } from '../../src/ha/actions.js'
import { aggregateByDay, createWeatherDashboard, OUTLOOK_REFRESH_MS, pickForecastType, WEATHER_REFRESH_MS } from '../../src/dashboards/weather.js'
import type { WeatherView } from '../../src/views.js'
import type { WeatherDashboard } from '../../src/config/schema.js'
import type { Forecast } from '../../src/ha/types.js'
import type { GeoPoint, OutlookPoint } from '../../src/weather/openmeteo.js'

const HOUR = 3_600_000
const pt = (t: number, over: Partial<OutlookPoint> = {}): OutlookPoint => ({ t, temp: 1, feels: -3, mm: 0, kind: 'none', prob: null, ...over })

function cfg(over: Partial<WeatherDashboard> = {}): WeatherDashboard {
  return { type: 'weather', name: 'Météo', color: '#3399FF', entityId: 'weather.home', ...over }
}
const fc = (datetime: string, temperature: number, templow: number | null, condition = 'cloudy'): Forecast =>
  ({ datetime, condition, temperature, templow })
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

describe('tableau Météo', () => {
  let ha: FakeHa
  let actions: Actions
  let render: ReturnType<typeof vi.fn>
  const today = () => new Date()
  let outlookFn: ReturnType<typeof vi.fn<(loc: GeoPoint) => Promise<OutlookPoint[]>>>

  beforeEach(() => {
    outlookFn = vi.fn(() => Promise.resolve([]))
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T15:00:00'))
    ha = new FakeHa()
    ha.setEntity('weather.home', 'partlycloudy', { temperature: -2, apparent_temperature: -6, supported_features: 1 })
    actions = new Actions({ ha, feedback: () => {} })
    render = vi.fn()
  })
  afterEach(() => {
    actions.dispose()
    vi.useRealTimers()
  })

  const make = (c = cfg()) => createWeatherDashboard(c, { ha, actions, requestRender: render, fetchOutlook: outlookFn })
  const wv = (d: ReturnType<typeof make>) => d.view() as WeatherView

  it('pick_type', () => {
    expect(pickForecastType(1)).toBe('daily')
    expect(pickForecastType(6)).toBe('twice_daily')
    expect(pickForecastType(2)).toBe('hourly')
    expect(pickForecastType(0)).toBeNull()
  })

  it('aggregate_twice_daily', () => {
    const out = aggregateByDay([
      fc('2026-11-20T18:00:00', 5, 0, 'rainy'),
      fc('2026-11-21T06:00:00', 3, -1, 'snowy'),
      fc('2026-11-21T18:00:00', 1, -4, 'cloudy'),
    ], today())
    expect(out).toEqual([{ date: '2026-11-21', condition: 'snowy', high: 3, low: -4 }])
  })

  it('aggregate_caps_5', () => {
    const many = Array.from({ length: 12 }, (_, i) => fc(new Date(2026, 10, 21 + i, 12).toISOString(), i, i - 1))
    expect(aggregateByDay(many, today())).toHaveLength(5)
  })

  it('view_current', () => {
    expect(wv(make()).current).toEqual({
      condition: 'Partiellement nuageux', temperature: '-2,0 °C', apparent: 'Ressenti -6,0 °C', icon: 'mdi:weather-partly-cloudy',
    })
  })

  it('day_labels_fr', async () => {
    ha.forecasts = [fc('2026-11-21T12:00:00', 3, -1, 'rainy')]
    const d = make()
    d.activate()
    await flush()
    const expected = new Intl.DateTimeFormat('fr-CA', { weekday: 'short' }).format(new Date(2026, 10, 21))
    expect(expected).toBe('sam.')
    expect(wv(d).days).toEqual([{ label: expected, icon: 'mdi:weather-rainy', high: '3,0 °C', low: '-1,0 °C' }])
    d.deactivate()
  })

  it('no_forecast_support', () => {
    ha.setEntity('weather.home', 'cloudy', { temperature: 1, supported_features: 0 })
    expect(wv(make()).message).toBe('Pas de prévisions pour cette entité')
  })

  it('no_entity', () => {
    const v = wv(make(cfg({ entityId: null })))
    expect(v.message).toBe('Aucune entité météo configurée')
    expect(v.current).toBeNull()
  })

  it('unavailable', () => {
    ha.setEntity('weather.home', 'unavailable', {})
    const v = wv(make())
    expect(v.current).toBeNull()
    expect(v.message).toBe('Météo indisponible')
  })

  it('offline', () => {
    ha.setStatus({ state: 'connecting', reason: null })
    expect(wv(make()).offline).toBe(true)
  })

  it('fetch_on_activate_and_every_30min', async () => {
    const d = make()
    d.activate()
    await flush()
    expect(ha.forecastCalls).toEqual([{ entityId: 'weather.home', type: 'daily' }])
    await vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS)
    expect(ha.forecastCalls).toHaveLength(2)
    d.deactivate()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS)
    expect(ha.forecastCalls).toHaveLength(2)
  })

  it('refetch_on_state_change_only', async () => {
    const d = make()
    d.activate()
    await flush()
    ha.setEntity('light.x', 'on')
    await flush()
    expect(ha.forecastCalls).toHaveLength(1)
    ha.setEntity('weather.home', 'rainy', { temperature: 0, supported_features: 1 })
    await flush()
    expect(ha.forecastCalls).toHaveLength(2)
    d.deactivate()
  })

  it('never_overlaps_and_refetches_once', async () => {
    let release!: (f: Forecast[]) => void
    let calls = 0
    ha.getForecasts = (entityId, type) => {
      ha.forecastCalls.push({ entityId, type })
      calls++
      return calls === 1 ? new Promise<Forecast[]>((r) => { release = r }) : Promise.resolve([])
    }
    const d = make()
    d.activate()
    ha.setEntity('weather.home', 'rainy', { supported_features: 1 })
    ha.setEntity('weather.home', 'snowy', { supported_features: 1 })
    expect(ha.forecastCalls).toHaveLength(1)
    release([])
    await flush()
    expect(ha.forecastCalls).toHaveLength(2)
    d.deactivate()
  })

  it('ignores_result_after_deactivate', async () => {
    let release!: (f: Forecast[]) => void
    ha.getForecasts = () => new Promise<Forecast[]>((r) => { release = r })
    const d = make()
    d.activate()
    d.deactivate()
    release([fc('2026-11-21T12:00:00', 3, -1)])
    await flush()
    expect(wv(d).days).toEqual([])
    expect(render).not.toHaveBeenCalled()
  })

  it('forecast_error_keeps_previous', async () => {
    ha.forecasts = [fc('2026-11-21T12:00:00', 3, -1)]
    const d = make()
    d.activate()
    await flush()
    expect(wv(d).days).toHaveLength(1)
    ha.forecastError = new Error('boom')
    await vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS)
    expect(ha.forecastCalls).toHaveLength(2)
    expect(wv(d).days).toHaveLength(1)
    d.deactivate()
  })

  it('handle_is_noop', () => {
    expect(() => make().handle({ type: 'knobTurn', knob: 'knobTR', delta: 1 })).not.toThrow()
  })

  it('shows_last_update_and_refreshes_on_top_right_tap', async () => {
    const d = make()
    d.activate()
    await flush()
    const first = wv(d).updated
    expect(first?.busy).toBe(false)
    expect(first?.text).toMatch(/20 nov\., 15 h 00/)
    vi.setSystemTime(new Date('2026-11-20T15:42:00'))
    ha.forecastCalls.length = 0
    d.handle({ type: 'tap', target: { kind: 'strip', side: 'right', zone: 0 } })
    expect(wv(d).updated).toMatchObject({ busy: true, text: 'Actualisation…' })
    await flush()
    expect(ha.calls).toContainEqual({ domain: 'homeassistant', service: 'update_entity', data: undefined, target: { entity_id: 'weather.home' } })
    expect(ha.forecastCalls).toHaveLength(1)
    expect(wv(d).updated?.text).toMatch(/15 h 42/)
    d.deactivate()
  })

  describe('graphique des précipitations', () => {
    const NOW = new Date('2026-11-20T15:00:00').getTime()
    const ov = (d: ReturnType<typeof make>) => wv(d).outlook!

    it('outlook_points_et_fenetre_apres_activate', async () => {
      const points = [pt(NOW - 2 * HOUR, { mm: 1, kind: 'rain' }), pt(NOW + HOUR, { prob: 60, kind: 'snow' })]
      outlookFn.mockResolvedValue(points)
      const d = make()
      d.activate()
      await flush()
      expect(outlookFn).toHaveBeenCalledWith({ latitude: 45.5, longitude: -73.5 })
      expect(ov(d)).toEqual({ points, start: NOW - 8 * HOUR, now: NOW, end: NOW + 4 * HOUR, stale: false, message: null })
      d.deactivate()
    })

    it('position_inconnue_sans_appel_au_service', async () => {
      ha.location = null
      const d = make()
      d.activate()
      await flush()
      expect(ov(d).message).toBe('Position inconnue')
      expect(ov(d).points).toEqual([])
      expect(outlookFn).not.toHaveBeenCalled()
      d.deactivate()
    })

    it('prevision_indisponible_sans_donnees_avant', async () => {
      outlookFn.mockRejectedValue(new Error('panne'))
      const d = make()
      d.activate()
      await flush()
      expect(ov(d)).toMatchObject({ points: [], message: 'Prévision indisponible', stale: false })
      d.deactivate()
    })

    it('erreur_apres_succes_garde_les_points_en_grise', async () => {
      const points = [pt(NOW - HOUR, { mm: 1, kind: 'rain' })]
      outlookFn.mockResolvedValueOnce(points)
      const d = make()
      d.activate()
      await flush()
      outlookFn.mockRejectedValue(new Error('panne'))
      await vi.advanceTimersByTimeAsync(OUTLOOK_REFRESH_MS)
      expect(outlookFn).toHaveBeenCalledTimes(2)
      expect(ov(d)).toMatchObject({ points, message: null, stale: true })
      d.deactivate()
    })

    it('rafraichi_toutes_les_15_minutes_et_au_toucher_actualiser', async () => {
      const d = make()
      d.activate()
      await flush()
      expect(outlookFn).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(OUTLOOK_REFRESH_MS)
      expect(outlookFn).toHaveBeenCalledTimes(2)
      d.handle({ type: 'tap', target: { kind: 'strip', side: 'right', zone: 0 } })
      await flush()
      expect(outlookFn).toHaveBeenCalledTimes(3)
      d.deactivate()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('resultat_tardif_ignore_apres_deactivate', async () => {
      let release!: (p: OutlookPoint[]) => void
      outlookFn.mockImplementation(() => new Promise<OutlookPoint[]>((r) => { release = r }))
      const d = make()
      d.activate()
      await flush()
      d.deactivate()
      render.mockClear()
      release([pt(NOW)])
      await flush()
      expect(ov(d).points).toEqual([])
      expect(render).not.toHaveBeenCalled()
    })

    it('reessaie_quand_home_assistant_revient_en_ligne', async () => {
      outlookFn.mockRejectedValueOnce(new Error('panne'))
      const d = make()
      d.activate()
      await flush()
      expect(ov(d).message).toBe('Prévision indisponible')
      outlookFn.mockResolvedValue([pt(NOW - HOUR, { mm: 1, kind: 'rain' })])
      ha.setStatus({ state: 'connecting', reason: null })
      ha.setStatus({ state: 'online', reason: null })
      await flush()
      expect(ov(d)).toMatchObject({ message: null, stale: false })
      expect(ov(d).points).toHaveLength(1)
      d.deactivate()
    })

    it('pas_de_graphique_sans_entite_meteo', async () => {
      const d = make(cfg({ entityId: null }))
      d.activate()
      await flush()
      expect(wv(d).outlook ?? null).toBeNull()
      expect(outlookFn).not.toHaveBeenCalled()
      d.deactivate()
    })
  })

  it('other_touches_do_not_refresh', async () => {
    const d = make()
    d.activate()
    await flush()
    ha.forecastCalls.length = 0
    d.handle({ type: 'tap', target: { kind: 'key', index: 3 } })
    d.handle({ type: 'tap', target: { kind: 'strip', side: 'left', zone: 0 } })
    await flush()
    expect(ha.calls).toEqual([])
    expect(ha.forecastCalls).toEqual([])
    d.deactivate()
  })
})
