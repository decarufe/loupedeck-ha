import type { WeatherDashboard } from '../config/schema.js'
import type { InputEvent } from '../device/input.js'
import type { Forecast, ForecastType, HaEntity } from '../ha/types.js'
import { weatherIcon } from '../render/icons.js'
import { CONDITION_LABELS, formatTemp, formatUpdated } from '../shared/format.js'
import type { WeatherDay, WeatherOutlook, WeatherView } from '../views.js'
import { fetchOutlook as fetchFromOpenMeteo, type GeoPoint, type OutlookPoint } from '../weather/openmeteo.js'
import type { Dashboard, DashboardDeps } from './types.js'

export const WEATHER_REFRESH_MS = 1_800_000
/** Graphique des précipitations : données rafraîchies toutes les 15 min, trait « maintenant » redessiné chaque minute. */
export const OUTLOOK_REFRESH_MS = 900_000
const OUTLOOK_TICK_MS = 60_000
const HOUR_MS = 3_600_000
/** Les touches 9 à 11 sont prises par le graphique : il reste 5 jours (touches 4 à 8). */
const MAX_DAYS = 5
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
  const fetchOutlook = d.fetchOutlook ?? ((loc: GeoPoint) => fetchFromOpenMeteo(loc))
  let outlook: OutlookPoint[] = []
  let outlookError = false
  let locationUnknown = false
  let outlookBusy = false
  let outlookRetry = false
  /** Position de la maison, demandée à Home Assistant, gardée tant que le tableau reste actif. */
  let home: GeoPoint | null = null
  let outlookTimer: ReturnType<typeof setInterval> | null = null
  let tickTimer: ReturnType<typeof setInterval> | null = null

  /** Appui sur la zone haut droite : Home Assistant relit l'entité, puis les prévisions sont redemandées. */
  async function refresh(): Promise<void> {
    if (!id || refreshing) return
    refreshing = true
    d.requestRender()
    try {
      await d.actions.updateEntity(id).catch(() => undefined)
      await Promise.all([fetchForecasts(), loadOutlook()])
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

  /** Graphique des précipitations (Open-Meteo, à la position de la maison dans Home Assistant). Jamais bloquant, jamais en double. */
  async function loadOutlook(): Promise<void> {
    if (!active || !id) return
    if (outlookBusy) { outlookRetry = true; return }
    const mine = epoch
    outlookBusy = true
    try {
      if (!home) {
        const loc = await d.ha.homeLocation()
        if (mine !== epoch) return
        if (!loc) { locationUnknown = true; return }
        home = loc
      }
      locationUnknown = false
      const points = await fetchOutlook(home)
      if (mine !== epoch) return
      outlook = points
      outlookError = false
    } catch {
      if (mine === epoch) outlookError = true
    } finally {
      if (mine === epoch) {
        outlookBusy = false
        d.requestRender()
        if (outlookRetry) { outlookRetry = false; void loadOutlook() }
      }
    }
  }

  function outlookView(): WeatherOutlook | null {
    if (!id) return null
    const now = Date.now()
    const hasPoints = outlook.length > 0
    return {
      points: outlook,
      start: now - 8 * HOUR_MS,
      now,
      end: now + 4 * HOUR_MS,
      stale: hasPoints && (outlookError || d.ha.status().state !== 'online'),
      message: hasPoints ? null : locationUnknown ? 'Position inconnue' : outlookError ? 'Prévision indisponible' : null,
    }
  }

  return {
    view(): WeatherView {
      const offline = d.ha.status().state !== 'online'
      const e = weather()
      if (!id) return { kind: 'weather', current: null, days: [], message: 'Aucune entité météo configurée', offline }
      const updated = { text: refreshing ? 'Actualisation…' : updatedAt ? formatUpdated(new Date(updatedAt)) : '—', busy: refreshing }
      if (!e || e.state === 'unavailable') return { kind: 'weather', current: null, days, message: 'Météo indisponible', offline, updated, outlook: outlookView() }
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
        outlook: outlookView(),
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
      }), d.ha.onStatus((s) => {
        // Home Assistant revient : on retente le graphique s'il avait échoué (position ou service).
        if (s.state === 'online' && (outlookError || locationUnknown)) void loadOutlook()
      })]
      timer = setInterval(() => { void fetchForecasts() }, WEATHER_REFRESH_MS)
      outlookTimer = setInterval(() => { void loadOutlook() }, OUTLOOK_REFRESH_MS)
      tickTimer = setInterval(() => d.requestRender(), OUTLOOK_TICK_MS)
      void fetchForecasts()
      void loadOutlook()
    },

    deactivate() {
      active = false
      epoch++
      inFlight = false
      refetch = false
      outlookBusy = false
      outlookRetry = false
      home = null
      for (const u of unsubs) u()
      unsubs = []
      for (const t of [timer, outlookTimer, tickTimer]) if (t) clearInterval(t)
      timer = null
      outlookTimer = null
      tickTimer = null
    },
  }
}
