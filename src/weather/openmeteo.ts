import { feelsLike } from './feels-like.js'
import { classifyPrecip, splitPrecip, type PrecipKind } from './precip.js'

export interface GeoPoint { latitude: number; longitude: number }

/** Une heure de météo : `t` = début de l'heure (ms), `mm` = précipitations en mm d'eau, `prob` = probabilité en % (ou null). */
export interface OutlookPoint { t: number; temp: number; feels: number; mm: number; kind: PrecipKind; prob: number | null }

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
const HOURLY = 'temperature_2m,dew_point_2m,wind_speed_10m,precipitation,snowfall,precipitation_probability,weather_code'
/** L'heure courante compte dans les heures « futures » : 5 heures couvrent donc jusqu'à maintenant + 4 h. */
const PAST_HOURS = 8
const FORECAST_HOURS = 5
const TIMEOUT_MS = 10_000

/** Arrondi à 2 décimales (~1 km) : la position exacte de la maison ne quitte pas l'ordinateur. */
const round2 = (v: number): number => Math.round(v * 100) / 100

export function buildOutlookUrl(loc: GeoPoint): string {
  return `${ENDPOINT}?latitude=${round2(loc.latitude)}&longitude=${round2(loc.longitude)}&hourly=${HOURLY}&past_hours=${PAST_HOURS}&forecast_hours=${FORECAST_HOURS}&timezone=UTC`
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function parseOutlook(json: unknown): OutlookPoint[] {
  const h = (json as { hourly?: Record<string, unknown> } | null)?.hourly
  const time = h?.time
  if (!h || !Array.isArray(time)) throw new Error('Réponse Open-Meteo invalide : données horaires absentes')
  const col = (name: string): unknown[] => (Array.isArray(h[name]) ? (h[name] as unknown[]) : [])
  const [temps, dews, winds, precips, snows, probs, codes] = [
    'temperature_2m', 'dew_point_2m', 'wind_speed_10m', 'precipitation', 'snowfall', 'precipitation_probability', 'weather_code',
  ].map(col)
  const out: OutlookPoint[] = []
  time.forEach((iso, i) => {
    const t = Date.parse(`${String(iso)}Z`)
    const temp = num(temps![i])
    const dew = num(dews![i])
    const wind = num(winds![i])
    if (!Number.isFinite(t) || temp === null || dew === null || wind === null) return
    const mm = num(precips![i]) ?? 0
    const { rainMm, snowMm } = splitPrecip(mm, num(snows![i]) ?? 0)
    const prob = num(probs![i])
    out.push({
      t,
      temp,
      feels: feelsLike(temp, dew, wind),
      mm,
      kind: classifyPrecip({ rainMm, snowMm, tempC: temp, probability: prob, weatherCode: num(codes![i]) ?? 0 }),
      prob,
    })
  })
  return out.sort((a, b) => a.t - b.t)
}

export async function fetchOutlook(loc: GeoPoint, fetchFn: typeof fetch = fetch): Promise<OutlookPoint[]> {
  const res = await fetchFn(buildOutlookUrl(loc), { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Open-Meteo indisponible (HTTP ${res.status})`)
  return parseOutlook(await res.json())
}
