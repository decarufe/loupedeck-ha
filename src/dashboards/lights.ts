import { KNOB_IDS, type KeySlot, type KnobId, type LightsDashboard } from '../config/schema.js'
import type { InputEvent } from '../device/input.js'
import { formatPct } from '../shared/format.js'
import { isDimmable } from '../shared/placement.js'
import { EMPTY_TILE, type TileView } from '../views.js'
import type { Dashboard, DashboardDeps } from './types.js'

export const DIM_STEP_PCT = 5
const KEY_COUNT = 12
const EMPTY_MESSAGE: TileView = { ...EMPTY_TILE, label: 'Aucune lumière configurée' }

function haPct(attributes: Record<string, any>): number {
  const b = attributes.brightness
  return typeof b === 'number' ? Math.round(b / 255 * 100) : 0
}

export function createLightsDashboard(cfg: LightsDashboard, d: DashboardDeps): Dashboard {
  let unsubs: (() => void)[] = []

  function tile(slot: KeySlot | null): TileView {
    if (!slot) return EMPTY_TILE
    const base = { accent: cfg.color, pending: d.actions.overlay(slot.entityId).pending }
    const entity = d.ha.entities()[slot.entityId]
    if (!entity) {
      return { ...base, label: slot.label ?? slot.entityId, icon: slot.icon ?? null, state: 'missing', valueText: 'Introuvable', level: null }
    }
    const label = slot.label ?? entity.attributes.friendly_name ?? slot.entityId
    const isSwitch = slot.entityId.startsWith('switch.')
    const configuredIcon = slot.icon ?? entity.attributes.icon ?? null
    if (entity.state === 'unavailable') {
      return { ...base, label, icon: configuredIcon, state: 'unavailable', valueText: 'Indisponible', level: null }
    }
    const on = entity.state === 'on'
    const icon = configuredIcon ?? (isSwitch
      ? (on ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off-outline')
      : (on ? 'mdi:lightbulb' : 'mdi:lightbulb-outline'))
    if (isSwitch || !isDimmable(entity.attributes)) {
      return { ...base, label, icon, state: on ? 'on' : 'off', valueText: null, level: null }
    }
    if (!on) return { ...base, label, icon, state: 'off', valueText: 'Éteinte', level: 0 }
    const pct = haPct(entity.attributes)
    return { ...base, label, icon, state: 'on', valueText: formatPct(pct), level: pct / 100 }
  }

  function dimmerSlot(side: 'left' | 'right', zone: number): KeySlot | null {
    return cfg.dimmers[KNOB_IDS[(side === 'left' ? 0 : 3) + zone]]
  }

  return {
    view() {
      const unconfigured = !cfg.keys.some(Boolean) && !KNOB_IDS.some(k => cfg.dimmers[k])
      return {
        kind: 'grid',
        keys: Array.from({ length: KEY_COUNT }, (_, i) => (unconfigured && i === 5 ? EMPTY_MESSAGE : tile(cfg.keys[i] ?? null))),
        left: [0, 1, 2].map(z => tile(dimmerSlot('left', z))),
        right: [0, 1, 2].map(z => tile(dimmerSlot('right', z))),
        offline: d.ha.status().state !== 'online',
      }
    },

    handle(e: InputEvent) {
      const toggle = (slot: KeySlot | null | undefined) => { if (slot) d.actions.toggle(slot.entityId) }
      switch (e.type) {
        case 'tap':
          if (e.target.kind === 'key') toggle(cfg.keys[e.target.index])
          else toggle(dimmerSlot(e.target.side, e.target.zone))
          return
        case 'knobPress':
          toggle(cfg.dimmers[e.knob as KnobId])
          return
        case 'knobTurn': {
          const slot = cfg.dimmers[e.knob as KnobId]
          if (!slot) return
          const current = d.actions.overlay(slot.entityId).brightnessPct
            ?? haPct(d.ha.entities()[slot.entityId]?.attributes ?? {})
          const next = Math.min(100, Math.max(0, current + e.delta * DIM_STEP_PCT))
          d.actions.setBrightness(slot.entityId, next)
          return
        }
        default:
          return
      }
    },

    activate() {
      this.deactivate()
      unsubs = [d.ha.onEntities(() => d.requestRender()), d.actions.onChange(() => d.requestRender())]
    },

    deactivate() {
      for (const u of unsubs) u()
      unsubs = []
    },
  }
}
