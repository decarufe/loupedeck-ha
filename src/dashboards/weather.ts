import type { WeatherDashboard } from '../config/schema.js'
import type { InputEvent } from '../device/input.js'
import type { Forecast, ForecastType, HaEntity } from '../ha/types.js'
import { weatherIcon } from '../render/icons.js'
import { CONDITION_LABELS, formatTemp, formatUpdated } from '../shared/format.js'
import type { WeatherDay, WeatherView } from '../views.js'
import type { Dashboard, DashboardDeps } from './types.js'

export const WEATHER_REFRESH_MS = 1_800_000
const MAX_DAYS = 8
const DAY_FORMAT = new Intl.DateTimeFormat('fr-CA', { weekday: 'short' })

/** Bits de `supported_features` : 1 = daily, 2 = hourly, 4 = twice_daily. */
export function pickForecastType(supportedFeatures: number): ForecastType | null {
  if (supportedFeatures & 1) return 'daily'
  if (supportedFeatures & 4) return 'twice_daily'
  if (supportedFeatures & 2) return 'hourly'
  return null
}

function localDate(d: Date): string {
  return d.toLocaleDateString('sv-SE')
}

export function aggregateByDay(f: Forecast[], today: Date): { date: string; condition: string; high: number; low: number }[] {
  const todayKey = localDate(today)
  const byDay = new Map<string, { date: string; condition: string; high: number; low: number }>()
  for (const item of f) {
    const date = localDate(new Date(item.datetime))
    if (date <= todayKey) continue
    const low = item.templow ?? item.temperature
    const day = byDay.get(date)
    if (!day) byDay.set(date, { date, condition: item.condition, high: item.temperature, low })
    else {
      day.high = Math.max(day.high, item.temperature)
      day.low = Math.min(day.low, low)
    }
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, MAX_DAYS)
}

export function createWeatherDashboard(cfg: WeatherDashboard, d: DashboardDeps): Dashboard {
  const id = cfg.entityId
  let unsubs: (() => void)[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let days: WeatherDay[] = []
  let epoch = 0
  let active = false
  let inFlight = false
  let refetch = false
  let lastEntity: HaEntity | undefined
  /** Dernière mise à jour des données affichées (prévisions reçues ou état de l'entité changé). */
  let updatedAt: number | null = null
  let refreshing = false

  /** Appui sur la zone haut droite : Home Assistant relit l'entité, puis les prévisions sont redemandées. */
  async function refresh(): Promise<void> {
    if (!id || refreshing) return
    refreshing = true
    d.requestRender()
    try {
      await d.actions.updateEntity(id).catch(() => undefined)
      await fetchForecasts()
    } finally {
      refreshing = false
      d.requestRender()
    }
  }

  function weather(): HaEntity | undefined {
    return id ? d.ha.entities()[id] : undefined
  }

  function forecastType(e: HaEntity | undefined): ForecastType | null {
    const sf = e?.attributes.supported_features
    return pickForecastType(typeof sf === 'number' ? sf : 0)
  }

  async function fetchForecasts(): Promise<void> {
    if (!active || !id) return
    if (inFlight) { refetch = true; return }
    const type = forecastType(weather())
    if (!type) return
    const mine = epoch
    inFlight = true
    try {
      const list = await d.ha.getForecasts(id, type)
      if (mine !== epoch) return
      updatedAt = Date.now()
      days = aggregateByDay(list, new Date()).map((x) => ({
        label: DAY_FORMAT.format(new Date(`${x.date}T00:00:00`)),
        icon: weatherIcon(x.condition),
        high: formatTemp(x.high),
        low: formatTemp(x.low),
      }))
      d.requestRender()
    } catch {
      // On garde les jours précédents.
    } finally {
      if (mine === epoch) {
        inFlight = false
        if (refetch) { refetch = false; void fetchForecasts() }
      }
    }
  }

  return {
    view(): WeatherView {
      const offline = d.ha.status().state !== 'online'
      const e = weather()
      if (!id) return { kind: 'weather', current: null, days: [], message: 'Aucune entité météo configurée', offline }
      const updated = { text: refreshing ? 'Actualisation…' : updatedAt ? formatUpdated(new Date(updatedAt)) : '—', busy: refreshing }
      if (!e || e.state === 'unavailable') return { kind: 'weather', current: null, days, message: 'Météo indisponible', offline, updated }
      const apparent = e.attributes.apparent_temperature
      return {
        kind: 'weather',
        current: {
          icon: weatherIcon(e.state),
          temperature: formatTemp(e.attributes.temperature),
          apparent: apparent === null || apparent === undefined ? null : `Ressenti ${formatTemp(apparent)}`,
          condition: CONDITION_LABELS[e.state] ?? e.state,
        },
        days,
        message: forecastType(e) ? null : 'Pas de prévisions pour cette entité',
        offline,
        updated,
      }
    },

    handle(e: InputEvent) {
      if (e.type === 'tap' && e.target.kind === 'strip' && e.target.side === 'right' && e.target.zone === 0) void refresh()
    },

    activate() {
      this.deactivate()
      active = true
      lastEntity = weather()
      unsubs = [d.ha.onEntities(() => {
        d.requestRender()
        const e = weather()
        if (e !== lastEntity) {
          const changed = e?.state !== lastEntity?.state || e?.attributes !== lastEntity?.attributes
          lastEntity = e
          if (changed) {
            updatedAt = Date.now()
            void fetchForecasts()
          }
        }
      })]
      timer = setInterval(() => { void fetchForecasts() }, WEATHER_REFRESH_MS)
      void fetchForecasts()
    },

    deactivate() {
      active = false
      epoch++
      inFlight = false
      refetch = false
      for (const u of unsubs) u()
      unsubs = []
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
