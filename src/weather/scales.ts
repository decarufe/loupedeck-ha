/** Calculs purs des échelles du graphique météo (températures, précipitations, temps). */

const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500]
const MM_TO_CM_SNOW = 0.7
const cmFormat = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1 })

/** Plus petit pas « rond » (1, 2, 5, 10…) qui donne au plus `maxTicks` graduations sur `range`. */
export function niceStep(range: number, maxTicks: number): number {
  return STEPS.find((s) => range / s <= maxTicks) ?? STEPS[STEPS.length - 1]!
}

/** Entiers qui encadrent les courbes ; l'écart est d'au moins 2 °C (une courbe plate reste lisible). */
export function tempAxis(lo: number, hi: number): { lo: number; hi: number } {
  const a = Math.floor(lo)
  const b = Math.ceil(hi)
  if (b - a >= 2) return { lo: a, hi: b }
  const start = Math.floor((lo + hi) / 2 - 1)
  return { lo: start, hi: start + 2 }
}

/** Maximum de l'axe des mm : entier, au moins 2 (une bruine reste petite). */
export function precipAxis(maxMm: number): number {
  return Math.max(2, Math.ceil(maxMm))
}

/** Multiples de `step` dans `[lo, hi]`, du plus petit au plus grand. */
export function tickValues(lo: number, hi: number, step: number): number[] {
  const out: number[] = []
  for (let k = Math.ceil(lo / step); k * step <= hi + 1e-9; k++) out.push(k * step + 0)
  return out
}

/** Chaque heure locale pleine entre `start` et `end` (ms) ; l'étiquette (« 14 h ») n'existe que pour les heures paires. */
export function hourMarks(start: number, end: number): { t: number; label: string | null }[] {
  const d = new Date(start)
  d.setMinutes(0, 0, 0)
  if (d.getTime() < start) d.setHours(d.getHours() + 1)
  const out: { t: number; label: string | null }[] = []
  while (d.getTime() <= end) {
    const h = d.getHours()
    out.push({ t: d.getTime(), label: h % 2 === 0 ? `${h} h` : null })
    d.setHours(h + 1)
  }
  return out
}

/** Équivalent en cm de neige d'une quantité d'eau en mm (1 mm d'eau = 0,7 cm de neige), au format « 1,4 cm ». */
export function formatCm(mm: number): string {
  return `${cmFormat.format(mm * MM_TO_CM_SNOW)} cm`
}
