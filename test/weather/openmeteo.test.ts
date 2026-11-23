import { describe, expect, it } from 'vitest'
import fixture from './fixtures/openmeteo-hourly.json' with { type: 'json' }
import { feelsLike } from '../../src/weather/feels-like.js'
import { buildOutlookUrl, fetchOutlook, parseOutlook } from '../../src/weather/openmeteo.js'

const T0 = Date.parse('2026-11-23T14:00:00Z')

describe('client Open-Meteo', () => {
  it('url_position_arrondie_et_variables_horaires', () => {
    const url = buildOutlookUrl({ latitude: 45.50169, longitude: -73.56725 })
    expect(url).toContain('latitude=45.5&')
    expect(url).toContain('longitude=-73.57&')
    expect(url).toMatch(/latitude=-?\d+(\.\d{1,2})?&/)
    expect(url).toMatch(/longitude=-?\d+(\.\d{1,2})?&/)
    expect(url).toContain('past_hours=8')
    expect(url).toContain('forecast_hours=5')
    expect(url).toContain('timezone=UTC')
    expect(decodeURIComponent(url)).toContain('hourly=temperature_2m,dew_point_2m,wind_speed_10m,precipitation,snowfall,precipitation_probability,weather_code')
  })

  it('parse_donne_treize_points_tries_en_ms', () => {
    const pts = parseOutlook(fixture)
    expect(pts).toHaveLength(13)
    expect(pts[0]!.t).toBe(T0)
    expect(pts[12]!.t).toBe(T0 + 12 * 3_600_000)
  })

  it('parse_calcule_ressentie_type_et_quantite', () => {
    const pts = parseOutlook(fixture)
    expect(pts[8]!.feels).toBeCloseTo(feelsLike(-3, -6, 15.7), 5)
    expect(pts[3]).toMatchObject({ kind: 'rain', mm: 1.2, prob: 70 })
    expect(pts[8]).toMatchObject({ kind: 'snow', mm: 0.7 })
    expect(pts[9]).toMatchObject({ kind: 'mix', mm: 1.4 })
    expect(pts[10]).toMatchObject({ kind: 'snow', mm: 0, prob: 50 })
    expect(pts[11]).toMatchObject({ kind: 'none', prob: null })
  })

  it('parse_ignore_un_point_sans_temperature', () => {
    const broken = structuredClone(fixture) as typeof fixture & { hourly: { temperature_2m: (number | null)[] } }
    broken.hourly.temperature_2m[2] = null
    const pts = parseOutlook(broken)
    expect(pts).toHaveLength(12)
    expect(pts.some((p) => p.t === T0 + 2 * 3_600_000)).toBe(false)
    expect(pts.every((p) => Number.isFinite(p.temp) && Number.isFinite(p.feels) && Number.isFinite(p.mm))).toBe(true)
  })

  it('parse_rejette_une_reponse_sans_donnees_horaires', () => {
    expect(() => parseOutlook({})).toThrow(/Open-Meteo/)
  })

  it('fetch_rejette_en_francais_si_http_500', async () => {
    const fetchFn = (async () => new Response('boom', { status: 500 })) as typeof fetch
    await expect(fetchOutlook({ latitude: 45.5, longitude: -73.5 }, fetchFn)).rejects.toThrow(/Open-Meteo indisponible \(HTTP 500\)/)
  })

  it('fetch_renvoie_les_points_si_http_200', async () => {
    let seen = ''
    const fetchFn = (async (u: string | URL | Request) => {
      seen = String(u)
      return new Response(JSON.stringify(fixture), { status: 200 })
    }) as typeof fetch
    const pts = await fetchOutlook({ latitude: 45.50169, longitude: -73.56725 }, fetchFn)
    expect(pts).toHaveLength(13)
    expect(seen).toContain('latitude=45.5&')
  })
})
