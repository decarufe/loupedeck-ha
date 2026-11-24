/** Calculs purs des échelles du graphique météo (températures, précipitations, temps). */

/** Garde-fou : jamais plus de graduations que cela, quelles que soient les valeurs reçues. */
const MAX_TICK_VALUES = 200;
const MM_TO_CM_SNOW = 0.7;
const cmFormat = new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 1 });

/** Plus petit pas « rond » (1, 2, 5 × 10^n) qui donne au plus `maxTicks` graduations sur `range`, pour n'importe quel écart. */
export function niceStep(range: number, maxTicks: number): number {
  const target = range / maxTicks;
  if (!Number.isFinite(target) || target <= 1) return 1;
  const base = 10 ** Math.floor(Math.log10(target));
  return (
    [1, 2, 5, 10].map((m) => m * base).find((step) => step >= target) ??
    base * 10
  );
}

/** Entiers qui encadrent les courbes et toujours 0 °C ; l'écart est d'au moins 2 °C (une courbe plate reste lisible). */
export function tempAxis(lo: number, hi: number): { lo: number; hi: number } {
  const a = Math.min(0, Math.floor(lo)) + 0; // + 0 : jamais « -0 »
  const b = Math.max(0, Math.ceil(hi));
  if (b - a >= 2) return { lo: a, hi: b };
  const start = Math.floor((lo + hi) / 2 - 1); // l'axe tient ici entre -1 et 1 : 0 reste compris dans [start, start + 2]
  return { lo: start, hi: start + 2 };
}

/** Maximum de l'axe des mm : entier, au moins 2 (une bruine reste petite). */
export function precipAxis(maxMm: number): number {
  return Math.max(2, Math.ceil(maxMm));
}

/** Multiples de `step` dans `[lo, hi]`, du plus petit au plus grand (au plus 200). */
export function tickValues(lo: number, hi: number, step: number): number[] {
  if (
    !Number.isFinite(lo) ||
    !Number.isFinite(hi) ||
    !Number.isFinite(step) ||
    step <= 0
  )
    return [];
  const out: number[] = [];
  for (
    let k = Math.ceil(lo / step);
    k * step <= hi + 1e-9 && out.length < MAX_TICK_VALUES;
    k++
  )
    out.push(k * step + 0);
  return out;
}

/** Chaque heure locale pleine entre `start` et `end` (ms) ; l'étiquette (« 14 h ») n'existe que pour les heures paires. */
export function hourMarks(
  start: number,
  end: number,
): { t: number; label: string | null }[] {
  const d = new Date(start);
  d.setMinutes(0, 0, 0);
  if (d.getTime() < start) d.setHours(d.getHours() + 1);
  const out: { t: number; label: string | null }[] = [];
  while (d.getTime() <= end) {
    const h = d.getHours();
    out.push({ t: d.getTime(), label: h % 2 === 0 ? `${h} h` : null });
    d.setHours(h + 1);
  }
  return out;
}

/** Équivalent en cm de neige d'une quantité d'eau en mm (1 mm d'eau = 0,7 cm de neige), au format « 1,4 cm ». */
export function formatCm(mm: number): string {
  return `${cmFormat.format(mm * MM_TO_CM_SNOW)} cm`;
}
