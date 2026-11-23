import type { HaEntity } from './ha/types.js'

/** Calme (aucun capteur actif) qui met fin à une alerte. */
export const CALM_MS = 30_000
/** Durée maximale d'une alerte (clignotement et affichage), même si les détections continuent. */
export const MAX_ALERT_MS = 300_000
/** Un capteur resté à `on` aussi longtemps est ignoré jusqu'à son retour à `off`. */
export const STUCK_MS = 300_000

export interface AlertPage { entityId: string | null; sensors: string[] }
export type AlertLed = 'none' | 'alert' | 'reminder'

export interface AlertEvents {
  /** Pages dont une alerte vient de commencer dans la même mise à jour, par numéro croissant. */
  onStart(pages: number[]): void
  /** Alerte terminée sans avoir été vue (calme ou durée maximale). */
  onEnd(page: number): void
  /** L'état `led` d'au moins une page a changé. */
  onChange(): void
}

type Phase = 'idle' | 'alerting' | 'quiet'

interface PageState {
  cfg: AlertPage
  phase: Phase
  seen: boolean
  reminder: boolean
  calm: ReturnType<typeof setTimeout> | null
  cap: ReturnType<typeof setTimeout> | null
}

interface SensorState {
  state: string | undefined
  stuck: boolean
  stuckTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Transforme les états des capteurs de détection en alertes par page caméra.
 * Ne connaît ni l'écran ni les LED : il annonce le début, la fin et l'état visuel de chaque page.
 */
export class AlertMonitor {
  private pages = new Map<number, PageState>()
  private sensors = new Map<string, SensorState>()

  constructor(private readonly events: AlertEvents) {}

  /** Termine tout sans événement `onEnd`, efface les rappels ; `entities` devient l'état de départ. */
  configure(pages: (AlertPage | null)[], entities: Record<string, HaEntity>): void {
    this.clear()
    pages.forEach((cfg, i) => {
      if (cfg && cfg.sensors.length > 0) {
        this.pages.set(i, { cfg: { entityId: cfg.entityId, sensors: [...new Set(cfg.sensors)] }, phase: 'idle', seen: false, reminder: false, calm: null, cap: null })
      }
    })
    for (const p of this.pages.values()) {
      for (const id of p.cfg.sensors) {
        if (this.sensors.has(id)) continue
        const sensor: SensorState = { state: entities[id]?.state, stuck: false, stuckTimer: null }
        this.sensors.set(id, sensor)
        if (sensor.state === 'on') this.armStuck(id, sensor)
      }
    }
  }

  update(entities: Record<string, HaEntity>): void {
    this.tracked(() => {
      const triggered = new Set<string>()
      for (const [id, sensor] of this.sensors) {
        const prev = sensor.state
        const next = entities[id]?.state
        sensor.state = next
        if (next === 'on' && prev !== 'on') {
          if (prev === 'off') triggered.add(id)
          this.armStuck(id, sensor)
        } else if (next !== 'on') {
          this.disarmStuck(sensor)
        }
      }
      const started: number[] = []
      for (const [i, p] of [...this.pages].sort((a, b) => a[0] - b[0])) {
        if (p.phase === 'idle' && p.cfg.sensors.some((id) => triggered.has(id))) {
          p.phase = 'alerting'
          p.seen = false
          p.reminder = false
          p.cap = setTimeout(() => this.tracked(() => this.cap(i)), MAX_ALERT_MS)
          started.push(i)
        }
      }
      for (const i of this.pages.keys()) this.recheck(i)
      if (started.length > 0) this.events.onStart(started)
    })
  }

  led(page: number): AlertLed {
    const p = this.pages.get(page)
    if (!p) return 'none'
    if (p.phase === 'alerting' && !p.seen) return 'alert'
    return p.reminder ? 'reminder' : 'none'
  }

  /** Alerte ou rappel de cette page, et des pages de même `entityId` non nul, marqués comme vus. */
  markSeen(page: number): void {
    const target = this.pages.get(page)
    if (!target) return
    this.tracked(() => {
      for (const p of this.pages.values()) {
        if (p !== target && (target.cfg.entityId === null || p.cfg.entityId !== target.cfg.entityId)) continue
        p.reminder = false
        if (p.phase === 'alerting') p.seen = true
      }
    })
  }

  dispose(): void {
    this.clear()
  }

  private active(id: string): boolean {
    const s = this.sensors.get(id)
    return s?.state === 'on' && !s.stuck
  }

  /** Hors repos, le minuteur de calme court tant qu'aucun capteur n'est actif. */
  private recheck(i: number): void {
    const p = this.pages.get(i)
    if (!p || p.phase === 'idle') return
    if (p.cfg.sensors.some((id) => this.active(id))) {
      if (p.calm) clearTimeout(p.calm)
      p.calm = null
    } else if (!p.calm) {
      p.calm = setTimeout(() => this.tracked(() => this.calm(i)), CALM_MS)
    }
  }

  private calm(i: number): void {
    const p = this.pages.get(i)
    if (!p) return
    p.calm = null
    if (p.phase === 'idle') return
    const wasAlerting = p.phase === 'alerting'
    if (p.cap) clearTimeout(p.cap)
    p.cap = null
    p.phase = 'idle'
    if (wasAlerting && !p.seen) {
      p.reminder = true
      this.events.onEnd(i)
    }
  }

  private cap(i: number): void {
    const p = this.pages.get(i)
    if (!p) return
    p.cap = null
    if (p.phase !== 'alerting') return
    p.phase = 'quiet'
    if (!p.seen) {
      p.reminder = true
      this.events.onEnd(i)
    }
  }

  private armStuck(id: string, sensor: SensorState): void {
    this.disarmStuck(sensor)
    sensor.stuckTimer = setTimeout(() => this.tracked(() => {
      sensor.stuckTimer = null
      sensor.stuck = true
      for (const [i, p] of this.pages) if (p.cfg.sensors.includes(id)) this.recheck(i)
    }), STUCK_MS)
  }

  private disarmStuck(sensor: SensorState): void {
    if (sensor.stuckTimer) clearTimeout(sensor.stuckTimer)
    sensor.stuckTimer = null
    sensor.stuck = false
  }

  private clear(): void {
    for (const p of this.pages.values()) {
      if (p.calm) clearTimeout(p.calm)
      if (p.cap) clearTimeout(p.cap)
    }
    for (const s of this.sensors.values()) if (s.stuckTimer) clearTimeout(s.stuckTimer)
    this.pages.clear()
    this.sensors.clear()
  }

  /** Exécute `fn` puis signale `onChange` si l'état visuel d'une page a changé. */
  private tracked(fn: () => void): void {
    const snapshot = () => [...this.pages.keys()].map((i) => `${i}:${this.led(i)}`).join('|')
    const before = snapshot()
    fn()
    if (snapshot() !== before) this.events.onChange()
  }
}
