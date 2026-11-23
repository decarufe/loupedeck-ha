import type { HaPort, HistoryPoint } from './types.js'

export const HISTORY_REFRESH_MS = 300_000
/** Au plus un point par seconde gardé à partir des changements d'état en direct. */
const LIVE_MIN_GAP_MS = 1000

interface Entry { hours: number; points: HistoryPoint[]; loadedAt: number; loading: boolean }

/**
 * Historique numérique des entités suivies par une page : chargé depuis Home Assistant, rechargé toutes les 5 min,
 * complété en direct par les changements d'état. `points` ne bloque jamais : il rend ce qui est en cache et lance le chargement.
 */
export class HistoryCache {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<() => void>()
  private off: (() => void) | null = null
  private epoch = 0

  constructor(private readonly ha: HaPort, private readonly now: () => number = Date.now) {}

  start(): void {
    this.stop()
    this.off = this.ha.onEntities((all) => {
      let changed = false
      for (const [id, e] of this.entries) {
        const v = Number.parseFloat(all[id]?.state ?? '')
        if (!Number.isFinite(v)) continue
        const last = e.points.at(-1)
        const t = this.now()
        if (last && last.v === v) continue
        if (last && t - last.t < LIVE_MIN_GAP_MS) e.points[e.points.length - 1] = { t, v }
        else e.points.push({ t, v })
        changed = true
      }
      if (changed) this.emit()
    })
  }

  stop(): void {
    this.off?.()
    this.off = null
    this.epoch++
    for (const e of this.entries.values()) e.loading = false
  }

  /** Points des `hours` dernières heures (au moins), triés par temps. */
  points(entityId: string, hours: number): HistoryPoint[] {
    let e = this.entries.get(entityId)
    if (!e) {
      e = { hours, points: [], loadedAt: 0, loading: false }
      this.entries.set(entityId, e)
    }
    const stale = this.now() - e.loadedAt > HISTORY_REFRESH_MS
    if (hours > e.hours || stale) {
      e.hours = Math.max(e.hours, hours)
      void this.load(entityId, e)
    }
    return e.points
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  private async load(entityId: string, e: Entry): Promise<void> {
    if (e.loading || this.ha.status().state !== 'online') return
    e.loading = true
    const mine = this.epoch
    const end = this.now()
    try {
      const pts = await this.ha.getHistory(entityId, end - e.hours * 3_600_000, end)
      if (mine !== this.epoch) return
      // Les points reçus en direct pendant le chargement sont gardés après la fin de la période chargée.
      e.points = [...pts, ...e.points.filter((p) => p.t > end)]
      e.loadedAt = end
      this.emit()
    } catch {
      // Historique indisponible : on garde ce qu'on a ; nouvel essai au prochain affichage après le délai.
      if (mine === this.epoch) e.loadedAt = end
    } finally {
      if (mine === this.epoch) e.loading = false
    }
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb()
  }
}
