export type PrecipKind = 'none' | 'rain' | 'snow' | 'mix'

/** Part d'une précipitation (en mm d'eau) qui est de la pluie ou de la neige ; 1 mm d'eau = 0,7 cm de neige. */
export function splitPrecip(precipMm: number, snowfallCm: number): { rainMm: number; snowMm: number } {
  const round = (v: number) => Math.round(v * 1000) / 1000
  const snowMm = round(snowfallCm / 0.7)
  return { rainMm: round(Math.max(0, precipMm - snowMm)), snowMm }
}

const MIN_PROBABILITY = 30
const MIX_SHARE = 0.3
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])
const FREEZING_CODES = new Set([56, 57, 66, 67])

/** Type d'une heure de précipitations : la plus grande quantité l'emporte, mélange si chaque type pèse au moins 30 %. */
export function classifyPrecip(i: { rainMm: number; snowMm: number; tempC: number; probability: number | null; weatherCode: number }): PrecipKind {
  const total = i.rainMm + i.snowMm
  if (total <= 0) {
    if (i.probability === null || i.probability < MIN_PROBABILITY) return 'none'
    if (SNOW_CODES.has(i.weatherCode)) return 'snow'
    if (FREEZING_CODES.has(i.weatherCode)) return 'mix'
    return 'rain'
  }
  if (i.rainMm / total >= MIX_SHARE && i.snowMm / total >= MIX_SHARE) return 'mix'
  if (i.snowMm > i.rainMm) return 'snow'
  return i.tempC <= 0 ? 'mix' : 'rain'
}
