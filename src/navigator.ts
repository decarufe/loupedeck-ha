import { AlertMonitor, type AlertPage } from './alerts.js'
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

export type DevicePort = Pick<DeviceLink, 'present' | 'setLed' | 'onInput' | 'onStatus' | 'vibrate'>

const BUTTON_COUNT = 8
const OFF_COLOR = '#000000'
const ALERT_COLOR = '#FF0000'
const DIM_FACTOR = 0.15
const BLINK_MS = 500
/** Alerte de caméra : magenta, qu'aucune page n'utilise, et clignotement plus vif que le rouge de l'image figée. */
const ALERT_LED = '#FF00FF'
const ALERT_BLINK_MS = 250
/** Un geste de moins de 5 s empêche l'ouverture automatique d'une page. */
const GESTURE_GUARD_MS = 5000
/** Une caméra ouverte par une alerte se referme après 5 minutes sans geste. */
const AUTO_RETURN_MS = 300_000

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

  private readonly monitor: AlertMonitor
  /** Dernière page ouverte par l'utilisateur (celle de `state.json`) : celle où revient l'écran après une alerte. */
  private home = -1
  /** La page active a été ouverte par une alerte. */
  private autoOpened = false
  private lastGesture = Number.NEGATIVE_INFINITY
  private returnTimer: ReturnType<typeof setTimeout> | null = null
  private alertTimer: ReturnType<typeof setInterval> | null = null
  private alertOn = true

  constructor(d: NavigatorDeps) {
    this.device = d.device
    this.ha = d.ha
    this.actions = d.actions
    this.state = d.state
    this.makeDashboard = d.makeDashboard ?? createDashboard
    this.log = d.log
    this.monitor = new AlertMonitor({
      onStart: (pages) => this.onAlertStart(pages),
      onEnd: (page) => { if (this.autoOpened && page === this.active) this.returnHome() },
      onChange: () => { this.syncAlertBlink(); this.applyLeds() },
    })
    this.offs = [
      this.ha.onEntities(e => this.monitor.update(e)),
      // Home Assistant injoignable : les capteurs gardent leur dernier état ; on les tient pour inconnus.
      this.ha.onStatus(st => { if (st.state === 'offline') this.monitor.update({}) }),
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
    this.stopAlertBlink()
    if (this.autoOpened) {
      // Une alerte avait ouvert une caméra : la configuration change, on repart de la page de l'utilisateur.
      this.dashboards[this.active]?.deactivate()
      if (this.home >= 0) this.active = this.home
      this.autoOpened = false
    }
    this.clearReturn()
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
    this.home = this.active
    this.monitor.configure(this.cfgs.map((c): AlertPage | null => (c?.type === 'camera' && c.alert.enabled && c.alert.sensors.length > 0 ? { entityId: c.entityId, sensors: c.alert.sensors } : null)), this.ha.entities())
    this.applyLeds()
    this.requestRender()
    if (this.active !== previous) this.emitActive()
  }

  handle(e: InputEvent): void {
    this.lastGesture = Date.now()
    // Un geste pendant qu'une caméra en alerte est affichée : l'alerte est vue.
    this.monitor.markSeen(this.active)
    if (this.autoOpened) this.armReturn()
    if (e.type === 'button') {
      this.userButton(e.id)
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
    this.stopAlertBlink()
    this.clearReturn()
    this.monitor.dispose()
    if (this.immediate) clearImmediate(this.immediate)
    this.immediate = null
    this.renderScheduled = false
    this.dashboards[this.active]?.deactivate()
    this.activeCbs.clear()
    this.renderedCbs.clear()
  }

  /** Affiche la page `i` sans rien enregistrer ; `alert` : ouverte par une alerte (image précédente effacée). */
  private show(i: number, alert: boolean): void {
    this.stopBlink()
    this.dashboards[this.active]?.deactivate()
    this.active = i
    if (alert) this.dashboards[i]!.prepareAlert?.()
    this.dashboards[i]!.activate()
    this.applyLeds()
    this.requestRender()
    this.emitActive()
  }

  private switchTo(i: number, alert = false): void {
    if (i === this.active || !this.dashboards[i]) return
    this.show(i, alert)
    this.persist(i)
  }

  /** Bouton rond pressé par l'utilisateur : la page choisie devient sa page d'accueil. */
  private userButton(id: number): void {
    if (!this.dashboards[id]) return
    // Un bouton en alerte ou en rappel : l'image gardée peut dater de plusieurs heures.
    if (id !== this.active) this.switchTo(id, this.monitor.led(id) !== 'none')
    else if (!this.autoOpened) return
    else this.persist(id)
    this.home = id
    this.autoOpened = false
    this.clearReturn()
    this.monitor.markSeen(id)
  }

  private onAlertStart(pages: number[]): void {
    this.device.vibrate('alert')
    this.syncAlertBlink()
    if (pages.includes(this.active)) return
    if (Date.now() - this.lastGesture < GESTURE_GUARD_MS) return
    const target = pages[0]!
    this.clearReturn()
    this.autoOpened = true
    this.show(target, true)
  }

  private returnHome(): void {
    this.autoOpened = false
    this.clearReturn()
    if (this.home >= 0 && this.home !== this.active && this.dashboards[this.home]) this.show(this.home, false)
  }

  private armReturn(): void {
    this.clearReturn()
    this.returnTimer = setTimeout(() => { this.returnTimer = null; if (this.autoOpened) this.returnHome() }, AUTO_RETURN_MS)
  }

  private clearReturn(): void {
    if (this.returnTimer) clearTimeout(this.returnTimer)
    this.returnTimer = null
  }

  /** Le clignotement tourne tant qu'une page est en alerte non vue. */
  private syncAlertBlink(): void {
    const any = this.cfgs.some((_, i) => this.monitor.led(i) === 'alert')
    if (!any) { this.stopAlertBlink(); return }
    if (this.alertTimer) return
    this.alertOn = true
    this.alertTimer = setInterval(() => {
      if (this.disposed) return
      this.alertOn = !this.alertOn
      for (let i = 0; i < BUTTON_COUNT; i++) if (this.monitor.led(i) === 'alert') this.device.setLed(i, this.ledColor(i))
    }, ALERT_BLINK_MS)
  }

  private stopAlertBlink(): void {
    if (this.alertTimer) clearInterval(this.alertTimer)
    this.alertTimer = null
    this.alertOn = true
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
    const alert = this.monitor.led(i)
    if (alert === 'reminder') return ALERT_LED
    if (alert === 'alert') return this.alertOn ? ALERT_LED : OFF_COLOR
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
      // L'alerte de caméra (et son rappel) prime sur le rouge de l'image figée.
      if (this.monitor.led(this.active) !== 'none') return
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
