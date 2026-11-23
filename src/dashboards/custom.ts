import { KNOB_IDS, type CustomDashboard, type KnobId, type StateLook, type Tile } from '../config/schema.js'
import type { InputEvent, TapTarget } from '../device/input.js'
import { PressTracker, targetKey } from '../device/press.js'
import { HistoryCache } from '../ha/history.js'
import type { HaEntity } from '../ha/types.js'
import { formatClock, formatNumber, formatPct, formatTemplate } from '../shared/format.js'
import { isDimmable } from '../shared/placement.js'
import { EMPTY_TILE, type TileView } from '../views.js'
import { isUnavailableState, type Dashboard, type DashboardDeps } from './types.js'

export const DIM_STEP_PCT = 5
const KEY_COUNT = 12
const PERIOD_H = { '1h': 1, '6h': 6, '24h': 24 } as const
const SPARK_POINTS = 48
const EMPTY_MESSAGE: TileView = { ...EMPTY_TILE, label: 'Page vide : configurez-la dans l’éditeur' }

const KIND_NAMES: Record<Tile['kind'], string> = {
  toggle: 'Interrupteur', action: 'Action', state: 'État', value: 'Valeur', graph: 'Graphique', clock: 'Date et heure', dimmer: 'Gradateur',
}

function haPct(attributes: Record<string, any>): number {
  const b = attributes.brightness
  return typeof b === 'number' ? Math.round(b / 255 * 100) : 0
}

/** Valeurs régulièrement espacées dans le temps (dernière valeur connue à chaque pas), pour la courbe d'une touche. */
export function resample(points: { t: number; v: number }[], start: number, end: number, n: number): number[] {
  if (points.length === 0) return []
  const out: number[] = []
  let j = 0
  let last = points[0]!.v
  for (let i = 0; i < n; i++) {
    const t = start + ((end - start) * i) / (n - 1)
    while (j < points.length && points[j]!.t <= t) last = points[j++]!.v
    out.push(last)
  }
  return out
}

function defaultStateIcon(e: HaEntity | undefined, on: boolean): string {
  switch (e?.attributes.device_class) {
    case 'door': case 'garage_door': return on ? 'mdi:door-open' : 'mdi:door-closed'
    case 'window': return on ? 'mdi:window-open' : 'mdi:window-closed'
    case 'motion': case 'occupancy': case 'presence': return on ? 'mdi:motion-sensor' : 'mdi:motion-sensor-off'
    default: return on ? 'mdi:checkbox-blank-circle' : 'mdi:checkbox-blank-circle-outline'
  }
}

/** Page « Bouton custom » : 12 touches et 6 zones latérales, chacune d'un des 7 types de touche. */
export function createCustomDashboard(cfg: CustomDashboard, d: DashboardDeps, now: () => number = Date.now): Dashboard {
  let unsubs: (() => void)[] = []
  let clockTimer: ReturnType<typeof setInterval> | null = null
  const history = new HistoryCache(d.ha, now)
  const press = new PressTracker()

  const stripTile = (knob: KnobId) => cfg.strips[knob]
  const slotAt = (t: TapTarget): Tile | null =>
    t.kind === 'key' ? cfg.keys[t.index] ?? null : stripTile(KNOB_IDS[(t.side === 'left' ? 0 : 3) + t.zone]!)

  function missingOrUnavailable(tile: Tile & { entityId: string | null }, base: Pick<TileView, 'accent' | 'pending'>, e: HaEntity | undefined): TileView | null {
    if (!tile.entityId) return { ...base, label: tile.label ?? KIND_NAMES[tile.kind], icon: tile.icon ?? null, state: 'missing', valueText: 'Choisir une entité', level: null }
    if (!e) return { ...base, label: tile.label ?? tile.entityId, icon: tile.icon ?? null, state: 'missing', valueText: 'Introuvable', level: null }
    if (isUnavailableState(e.state)) {
      return { ...base, label: tile.label ?? e.attributes.friendly_name ?? tile.entityId, icon: tile.icon ?? e.attributes.icon ?? null, state: 'unavailable', valueText: 'Indisponible', level: null }
    }
    return null
  }

  function view(tile: Tile | null): TileView {
    if (!tile) return EMPTY_TILE
    const accent = tile.color ?? cfg.color
    if (tile.kind === 'clock') {
      const c = formatClock(tile.format, new Date(now()))
      return { label: tile.label ?? '', icon: null, state: 'off', valueText: c.big, level: null, pending: false, accent, layout: 'big', sub: c.sub || null }
    }
    const e = tile.entityId ? d.ha.entities()[tile.entityId] : undefined
    const base = { accent, pending: tile.entityId ? d.actions.overlay(tile.entityId).pending : false }
    const bad = missingOrUnavailable(tile, base, e)
    if (bad || !e) return bad!
    const name = tile.label ?? e.attributes.friendly_name ?? tile.entityId!
    const configuredIcon = tile.icon ?? e.attributes.icon ?? null

    switch (tile.kind) {
      case 'toggle':
      case 'dimmer': {
        const on = e.state === 'on'
        const isLight = tile.entityId!.startsWith('light.')
        const icon = configuredIcon ?? (isLight
          ? (on ? 'mdi:lightbulb' : 'mdi:lightbulb-outline')
          : (on ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off-outline'))
        if (!isLight || !isDimmable(e.attributes)) return { ...base, label: name, icon, state: on ? 'on' : 'off', valueText: null, level: null }
        if (!on) return { ...base, label: name, icon, state: 'off', valueText: 'Éteinte', level: 0 }
        const pct = d.actions.overlay(tile.entityId!).brightnessPct ?? haPct(e.attributes)
        return { ...base, label: name, icon, state: 'on', valueText: formatPct(pct), level: pct / 100 }
      }
      case 'action': {
        const scene = tile.entityId!.startsWith('scene.')
        return {
          ...base, label: name, icon: configuredIcon ?? (scene ? 'mdi:palette' : 'mdi:play'), state: 'off',
          valueText: tile.confirm ? 'Appui long' : scene ? 'Scène' : 'Script', level: null, confirm: tile.confirm,
        }
      }
      case 'state': {
        const on = e.state === 'on'
        const look: StateLook = on ? tile.on : tile.off
        return {
          ...base, label: look.text, icon: tile.icon ?? look.icon ?? defaultStateIcon(e, on), state: 'off',
          valueText: name, level: null, tint: look.color,
        }
      }
      case 'value': {
        const text = formatTemplate(tile.template, e.state, e.attributes.unit_of_measurement ?? null, name, tile.decimals)
        return { ...base, label: name, icon: null, state: 'off', valueText: text, level: null, layout: 'big' }
      }
      case 'graph': {
        const hours = PERIOD_H[tile.period]
        const end = now()
        const start = end - hours * 3_600_000
        const pts = history.points(tile.entityId!, hours).filter((p) => p.t >= start)
        const values = resample(pts, start, end, SPARK_POINTS)
        const v = Number.parseFloat(e.state)
        const unit = e.attributes.unit_of_measurement ?? ''
        const current = Number.isFinite(v) ? `${formatNumber(v, tile.decimals)}${unit ? ` ${unit}` : ''}` : e.state
        const sub = tile.showMinMax && values.length > 0
          ? `${formatNumber(Math.min(...values), tile.decimals)}–${formatNumber(Math.max(...values), tile.decimals)} · ${tile.period}`
          : tile.period
        return { ...base, label: name, icon: null, state: 'off', valueText: current, level: null, layout: 'graph', sub, spark: { values, style: tile.style } }
      }
    }
  }

  function run(tile: Tile | null): void {
    if (!tile || tile.kind === 'clock' || !tile.entityId) return
    if (tile.kind === 'toggle' || tile.kind === 'dimmer') d.actions.toggle(tile.entityId)
    else if (tile.kind === 'action') d.actions.run(tile.entityId)
  }

  const hasClockSeconds = () => [...cfg.keys, ...KNOB_IDS.map(stripTile)].some((t) => t?.kind === 'clock' && t.format === 'time-seconds')
  const hasClock = () => [...cfg.keys, ...KNOB_IDS.map(stripTile)].some((t) => t?.kind === 'clock')

  return {
    view() {
      const unconfigured = !cfg.keys.some(Boolean) && !KNOB_IDS.some((k) => stripTile(k))
      return {
        kind: 'grid',
        keys: Array.from({ length: KEY_COUNT }, (_, i) => (unconfigured && i === 5 ? EMPTY_MESSAGE : view(cfg.keys[i] ?? null))),
        left: [0, 1, 2].map((z) => view(stripTile(KNOB_IDS[z]!))),
        right: [0, 1, 2].map((z) => view(stripTile(KNOB_IDS[3 + z]!))),
        offline: d.ha.status().state !== 'online',
      }
    },

    handle(e: InputEvent) {
      switch (e.type) {
        case 'tap': {
          const tile = slotAt(e.target)
          if (tile?.kind === 'action' && tile.confirm) {
            // Action protégée : seul l'appui long la lance ; un appui court ne fait rien.
            press.press(targetKey(e.target), () => {}, () => run(tile))
            return
          }
          run(tile)
          return
        }
        case 'release':
          press.release(targetKey(e.target))
          return
        case 'knobPress': {
          const tile = stripTile(e.knob as KnobId)
          if (tile?.kind === 'toggle' || tile?.kind === 'dimmer') run(tile)
          return
        }
        case 'knobTurn': {
          const tile = stripTile(e.knob as KnobId)
          if (tile?.kind !== 'dimmer' || !tile.entityId) return
          const current = d.actions.overlay(tile.entityId).brightnessPct
            ?? haPct(d.ha.entities()[tile.entityId]?.attributes ?? {})
          const next = Math.min(100, Math.max(0, current + e.delta * DIM_STEP_PCT))
          d.actions.setBrightness(tile.entityId, next)
          return
        }
        default:
          return
      }
    },

    activate() {
      this.deactivate()
      history.start()
      unsubs = [d.ha.onEntities(() => d.requestRender()), d.actions.onChange(() => d.requestRender()), history.onChange(() => d.requestRender())]
      if (hasClock()) clockTimer = setInterval(() => d.requestRender(), hasClockSeconds() ? 1000 : 15_000)
    },

    deactivate() {
      for (const u of unsubs) u()
      unsubs = []
      history.stop()
      press.clear()
      if (clockTimer) clearInterval(clockTimer)
      clockTimer = null
    },
  }
}
