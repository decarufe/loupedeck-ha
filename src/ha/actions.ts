import { createThrottle } from '../shared/throttle.js'
import type { HaPort } from './types.js'

export interface Overlay { pending: boolean; brightnessPct?: number; temperature?: number }

interface Deps {
  ha: HaPort
  feedback: (k: 'ok' | 'error') => void
  throttleMs?: number
  confirmTimeoutMs?: number
  holdMs?: number
}

type Kind = 'brightness' | 'temperature'

interface PendingToggle { baseline: string | undefined; timer: ReturnType<typeof setTimeout> }

export class Actions {
  private readonly ha: HaPort
  private readonly feedback: (k: 'ok' | 'error') => void
  private readonly throttleMs: number
  private readonly confirmTimeoutMs: number
  private readonly holdMs: number
  private readonly pendings = new Map<string, PendingToggle>()
  private readonly values = new Map<string, number>() // clé `${entityId}:${kind}`
  private readonly holdTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly throttles = new Map<string, ReturnType<typeof createThrottle<number>>>()
  private readonly listeners = new Set<() => void>()
  private readonly offEntities: () => void

  constructor(d: Deps) {
    this.ha = d.ha
    this.feedback = d.feedback
    this.throttleMs = d.throttleMs ?? 200
    this.confirmTimeoutMs = d.confirmTimeoutMs ?? 3000
    this.holdMs = d.holdMs ?? 1500
    this.offEntities = this.ha.onEntities((entities) => {
      let changed = false
      for (const [id, p] of [...this.pendings]) {
        if (entities[id]?.state !== p.baseline) {
          clearTimeout(p.timer)
          this.pendings.delete(id)
          changed = true
        }
      }
      if (changed) this.emit()
    })
  }

  toggle(entityId: string): void {
    if (!this.guard()) return
    const previous = this.pendings.get(entityId)
    if (previous) clearTimeout(previous.timer)
    const entry: PendingToggle = {
      baseline: this.ha.entities()[entityId]?.state,
      timer: setTimeout(() => {
        if (this.pendings.get(entityId) !== entry) return
        this.pendings.delete(entityId)
        this.feedback('error')
        this.emit()
      }, this.confirmTimeoutMs),
    }
    this.pendings.set(entityId, entry)
    this.send(entityId.split('.')[0], 'toggle', undefined, entityId, () => {
      if (this.pendings.get(entityId) !== entry) return
      clearTimeout(entry.timer)
      this.pendings.delete(entityId)
      this.emit()
    })
    this.emit()
  }

  setBrightness(entityId: string, pct: number): void {
    if (!this.guard()) return
    const v = Math.round(Math.min(100, Math.max(0, pct)))
    this.hold(entityId, 'brightness', v)
    this.throttle(entityId, 'brightness', (value) => {
      if (value === 0) this.send('light', 'turn_off', undefined, entityId)
      else this.send('light', 'turn_on', { brightness_pct: value }, entityId)
    })(v)
  }

  setTemperature(entityId: string, value: number): void {
    if (!this.guard()) return
    this.hold(entityId, 'temperature', value)
    this.throttle(entityId, 'temperature', (t) => {
      this.send('climate', 'set_temperature', { temperature: t }, entityId)
    })(value)
  }

  setHvacMode(entityId: string, mode: string): void {
    if (!this.guard()) return
    this.send('climate', 'set_hvac_mode', { hvac_mode: mode }, entityId)
  }

  overlay(entityId: string): Overlay {
    const o: Overlay = { pending: this.pendings.has(entityId) }
    const b = this.values.get(`${entityId}:brightness`)
    const t = this.values.get(`${entityId}:temperature`)
    if (b !== undefined) o.brightnessPct = b
    if (t !== undefined) o.temperature = t
    return o
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  dispose(): void {
    this.offEntities()
    for (const p of this.pendings.values()) clearTimeout(p.timer)
    this.pendings.clear()
    for (const t of this.holdTimers.values()) clearTimeout(t)
    this.holdTimers.clear()
    for (const t of this.throttles.values()) t.cancel()
    this.throttles.clear()
    this.values.clear()
    this.listeners.clear()
  }

  private guard(): boolean {
    if (this.ha.status().state === 'online') return true
    this.feedback('error')
    return false
  }

  /** Envoie l'appel de service ; `ok` à l'envoi, `error` au rejet. */
  private send(domain: string, service: string, data: object | undefined, entityId: string, onReject?: () => void): void {
    this.feedback('ok')
    this.ha.callService(domain, service, data, { entity_id: entityId }).catch(() => {
      onReject?.()
      this.feedback('error')
    })
  }

  private throttle(entityId: string, kind: Kind, fn: (v: number) => void): (v: number) => void {
    const key = `${entityId}:${kind}`
    let t = this.throttles.get(key)
    if (!t) {
      t = createThrottle<number>(fn, this.throttleMs)
      this.throttles.set(key, t)
    }
    return t
  }

  /** Valeur locale prioritaire jusqu'à `holdMs` après le dernier réglage. */
  private hold(entityId: string, kind: Kind, v: number): void {
    const key = `${entityId}:${kind}`
    this.values.set(key, v)
    const old = this.holdTimers.get(key)
    if (old) clearTimeout(old)
    this.holdTimers.set(key, setTimeout(() => {
      this.holdTimers.delete(key)
      this.values.delete(key)
      this.emit()
    }, this.holdMs))
    this.emit()
  }

  private emit(): void {
    for (const cb of [...this.listeners]) {
      try { cb() } catch { /* un écouteur défaillant ne doit pas gêner les autres */ }
    }
  }
}
