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
