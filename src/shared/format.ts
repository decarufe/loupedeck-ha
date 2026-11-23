const nf = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })

export function formatTemp(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${nf.format(v)} °C`
}

export function formatPct(v: number): string {
  return `${Math.round(v)} %`
}

export const HVAC_LABELS: Record<string, string> = {
  heat: 'Chauffage',
  cool: 'Climatisation',
  off: 'Arrêt',
  heat_cool: 'Auto',
  auto: 'Auto',
  dry: 'Déshumidif.',
  fan_only: 'Ventilation',
}

export const CONDITION_LABELS: Record<string, string> = {
  'clear-night': 'Nuit dégagée',
  cloudy: 'Nuageux',
  exceptional: 'Exceptionnel',
  fog: 'Brouillard',
  hail: 'Grêle',
  lightning: 'Orages',
  'lightning-rainy': 'Orages et pluie',
  partlycloudy: 'Partiellement nuageux',
  pouring: 'Averses fortes',
  rainy: 'Pluie',
  snowy: 'Neige',
  'snowy-rainy': 'Neige et pluie',
  sunny: 'Ensoleillé',
  windy: 'Venteux',
  'windy-variant': 'Venteux et nuageux',
}

/** Nombre au format québécois avec un nombre fixe de décimales (espace insécable pour les milliers). */
export function formatNumber(v: number, decimals: number): string {
  return new Intl.NumberFormat('fr-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v)
}

/**
 * Format d'une touche Valeur : `{valeur}`, `{unité}` et `{nom}` sont remplacés.
 * Un état numérique est arrondi à `decimals` ; un état texte est repris tel quel.
 */
export function formatTemplate(template: string, state: string, unit: string | null, name: string, decimals: number): string {
  const n = Number.parseFloat(state)
  const value = Number.isFinite(n) && /^\s*-?[\d.]/.test(state) ? formatNumber(n, decimals) : state
  return template.replaceAll('{valeur}', value).replaceAll('{unité}', unit ?? '').replaceAll('{nom}', name).replace(/\s+/g, ' ').trim()
}

const TIME = new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit' })
const TIME_S = new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const WEEKDAY = new Intl.DateTimeFormat('fr-CA', { weekday: 'long' })
const DAY_MONTH = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short' })

/** Horloge d'une touche Date et heure : `big` en grand, `sub` dessous (vide si sans objet). */
export function formatClock(format: 'time-date' | 'time' | 'time-seconds' | 'date', d: Date): { big: string; sub: string } {
  switch (format) {
    case 'time': return { big: TIME.format(d), sub: '' }
    case 'time-seconds': return { big: TIME_S.format(d), sub: '' }
    case 'date': return { big: DAY_MONTH.format(d), sub: WEEKDAY.format(d) }
    default: return { big: TIME.format(d), sub: `${WEEKDAY.format(d)} ${DAY_MONTH.format(d)}` }
  }
}

/** Date et heure courtes d'une mise à jour : « 22 nov., 22 h 48 ». */
export function formatUpdated(d: Date): string {
  return `${DAY_MONTH.format(d)}, ${TIME.format(d)}`
}

/** Temps écoulé : « 7 s », puis « 1 min 05 s », puis « 1 h 02 min ». */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
  return `${Math.floor(s / 3600)} h ${String(Math.floor(s / 60) % 60).padStart(2, '0')} min`
}

/** Durée d'une fenêtre de graphique : « 45 min », « 6 h ». */
export function formatSpan(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m} min`
  const h = m / 60
  return `${Number.isInteger(h) ? h : formatNumber(h, 1)} h`
}
