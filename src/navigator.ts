import type { AppConfig, DashboardConfig } from './config/schema.js'
import type { StateStore } from './config/state.js'
import { createDashboard } from './dashboards/factory.js'
import type { Dashboard } from './dashboards/types.js'
import type { InputEvent } from './device/input.js'
import type { DeviceLink } from './device/link.js'
import type { Actions } from './ha/actions.js'
import type { HaPort } from './ha/types.js'
import type { Logger } from './log.js'
import { paint } from './render/painters.js'
import { createSurface } from './render/surface.js'
import { EMPTY_TILE, type View } from './views.js'

export type DevicePort = Pick<DeviceLink, 'present' | 'setLed' | 'onInput' | 'onStatus'>

const BUTTON_COUNT = 8
const OFF_COLOR = '#000000'
const ALERT_COLOR = '#FF0000'
const DIM_FACTOR = 0.15
const BLINK_MS = 500

export function dim(hex: string, factor: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const ch = (shift: number) => Math.round(((n >> shift) & 0xff) * factor).toString(16).padStart(2, '0')
  return `#${ch(16)}${ch(8)}${ch(0)}`
}

const EMPTY_VIEW: View = {
  kind: 'grid',
  keys: Array.from({ length: 12 }, () => EMPTY_TILE),
  left: [EMPTY_TILE, EMPTY_TILE, EMPTY_TILE],
  right: [EMPTY_TILE, EMPTY_TILE, EMPTY_TILE],
  offline: false,
}

interface NavigatorDeps {
  device: DevicePort
  ha: HaPort
  actions: Actions
  state: StateStore
  makeDashboard?: typeof createDashboard
  log?: Logger
}

export class Navigator {
  private readonly device: DevicePort
  private readonly ha: HaPort
  private readonly actions: Actions
  private readonly state: StateStore
  private readonly makeDashboard: typeof createDashboard
  private readonly log: Logger | undefined
  private cfgs: (DashboardConfig | null)[] = Array.from({ length: BUTTON_COUNT }, () => null)
  private dashboards: (Dashboard | null)[] = Array.from({ length: BUTTON_COUNT }, () => null)
  private active = -1
  private readonly activeCbs = new Set<(i: number) => void>()
  private readonly renderedCbs = new Set<() => void>()
  private readonly offs: (() => void)[]
  private disposed = false

  private renderScheduled = false
  private rendering = false
  private dirty = false
  private immediate: ReturnType<typeof setImmediate> | null = null
  private blinkTimer: ReturnType<typeof setInterval> | null = null
  private blinkRed = false

  constructor(d: NavigatorDeps) {
    this.device = d.device
    this.ha = d.ha
    this.actions = d.actions
    this.state = d.state
    this.makeDashboard = d.makeDashboard ?? createDashboard
    this.log = d.log
    this.offs = [
      this.device.onInput(e => this.handle(e)),
      this.device.onStatus(s => {
        if (s === 'connected') {
          this.applyLeds()
          this.requestRender()
        }
      }),
    ]
  }

  applyConfig(cfg: AppConfig): void {
    const previous = this.active
    this.stopBlink()
    this.dashboards[this.active]?.deactivate()
    const before = this.active >= 0 ? JSON.stringify(this.cfgs[this.active] ?? null) : null
    this.cfgs = Array.from({ length: BUTTON_COUNT }, (_, i) => cfg.buttons[i] ?? null)
    const deps = { ha: this.ha, actions: this.actions, requestRender: () => this.requestRender() }
    this.dashboards = this.cfgs.map(c => (c ? this.makeDashboard(c, deps) : null))
    const stored = this.state.activeButton()
    let wanted = stored
    // Pages réordonnées dans l'éditeur : la console reste sur la même page, qui a changé de bouton.
    if (before !== null && before !== 'null' && JSON.stringify(this.cfgs[wanted] ?? null) !== before) {
      const moved = this.cfgs.findIndex((c) => c !== null && JSON.stringify(c) === before)
      if (moved >= 0) wanted = moved
    }
    this.active = this.cfgs[wanted] ? wanted : this.cfgs.findIndex(c => c !== null)
    this.dashboards[this.active]?.activate()
    if (this.active >= 0 && this.active !== stored) this.persist(this.active)
    this.applyLeds()
    this.requestRender()
    if (this.active !== previous) this.emitActive()
  }

  handle(e: InputEvent): void {
    if (e.type === 'button') {
      this.switchTo(e.id)
      return
    }
    this.dashboards[this.active]?.handle(e)
  }

  activeIndex(): number { return this.active }

  dashboard(i: number): Dashboard | null { return this.dashboards[i] ?? null }

  onActiveChange(cb: (i: number) => void): () => void {
    this.activeCbs.add(cb)
    return () => { this.activeCbs.delete(cb) }
  }

  /** Appelé après chaque image envoyée à la console (l'aperçu de l'éditeur peut alors être rafraîchi). */
  onRendered(cb: () => void): () => void {
    this.renderedCbs.add(cb)
    return () => { this.renderedCbs.delete(cb) }
  }

  requestRender(): void {
    if (this.disposed) return
    if (this.rendering) {
      this.dirty = true
      return
    }
    if (this.renderScheduled) return
    this.renderScheduled = true
    this.immediate = setImmediate(() => {
      this.immediate = null
      this.renderScheduled = false
      void this.render()
    })
  }

  dispose(): void {
    this.disposed = true
    for (const off of this.offs) off()
    this.offs.length = 0
    this.stopBlink()
    if (this.immediate) clearImmediate(this.immediate)
    this.immediate = null
    this.renderScheduled = false
    this.dashboards[this.active]?.deactivate()
    this.activeCbs.clear()
    this.renderedCbs.clear()
  }

  private switchTo(i: number): void {
    if (i === this.active || !this.dashboards[i]) return
    this.stopBlink()
    this.dashboards[this.active]?.deactivate()
    this.active = i
    this.dashboards[i]!.activate()
    this.persist(i)
    this.applyLeds()
    this.requestRender()
    this.emitActive()
  }

  private persist(i: number): void {
    this.state.setActiveButton(i).catch(err => this.log?.warn("Écriture de l'état impossible", { erreur: String(err) }))
  }

  private emitActive(): void {
    for (const cb of [...this.activeCbs]) cb(this.active)
  }

  private ledColor(i: number): string {
    const c = this.cfgs[i]
    if (!c) return OFF_COLOR
    return i === this.active ? c.color : dim(c.color, DIM_FACTOR)
  }

  private applyLeds(): void {
    for (let i = 0; i < BUTTON_COUNT; i++) this.device.setLed(i, this.ledColor(i))
  }

  private async render(): Promise<void> {
    if (this.disposed) return
    this.rendering = true
    try {
      const view = this.dashboards[this.active]?.view() ?? EMPTY_VIEW
      const surface = createSurface()
      await paint(surface, view)
      if (this.disposed) return
      this.device.present(surface)
      this.updateBlink(view)
      for (const cb of [...this.renderedCbs]) cb()
    } catch (err) {
      this.log?.error('Erreur de rendu', { erreur: String(err) })
    } finally {
      this.rendering = false
      if (this.dirty) {
        this.dirty = false
        this.requestRender()
      }
    }
  }

  private updateBlink(view: View): void {
    if (!(view.kind === 'full' && view.stale)) {
      this.stopBlink()
      return
    }
    if (this.blinkTimer) return
    this.blinkRed = false
    this.blinkTimer = setInterval(() => {
      if (this.disposed) return
      this.blinkRed = !this.blinkRed
      this.device.setLed(this.active, this.blinkRed ? ALERT_COLOR : this.ledColor(this.active))
    }, BLINK_MS)
  }

  private stopBlink(): void {
    if (!this.blinkTimer) return
    clearInterval(this.blinkTimer)
    this.blinkTimer = null
    if (this.blinkRed && this.active >= 0 && !this.disposed) this.device.setLed(this.active, this.ledColor(this.active))
    this.blinkRed = false
  }
}
