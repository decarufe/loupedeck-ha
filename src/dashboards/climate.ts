import { KNOB_IDS, type ClimateDashboard } from '../config/schema.js'
import type { InputEvent } from '../device/input.js'
import { formatTemp, HVAC_LABELS } from '../shared/format.js'
import { EMPTY_TILE, type TileView } from '../views.js'
import { isUnavailableState, type Dashboard, type DashboardDeps } from './types.js'

const KEY_COUNT = 12
const MODE_START = 4
const MAX_MODES = 4
const SENSOR_START = 8
const DEFAULT_STEP = 0.5

const MODE_ICONS: Record<string, string> = {
  heat: 'mdi:fire',
  cool: 'mdi:snowflake',
  off: 'mdi:power',
  heat_cool: 'mdi:thermostat-auto',
  auto: 'mdi:thermostat-auto',
  dry: 'mdi:water-percent',
  fan_only: 'mdi:fan',
}

function num(v: unknown): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null
}

export function createClimateDashboard(cfg: ClimateDashboard, d: DashboardDeps): Dashboard {
  let unsubs: (() => void)[] = []
  const id = cfg.entityId

  function climate() {
    return id ? d.ha.entities()[id] : undefined
  }

  function setpoint(): number | null {
    if (!id) return null
    return d.actions.overlay(id).temperature ?? num(climate()?.attributes.temperature)
  }

  function sensorTile(slot: { entityId: string; label?: string }): TileView {
    const base = { accent: cfg.color, pending: false, level: null }
    const e = d.ha.entities()[slot.entityId]
    if (!e) return { ...base, label: slot.label ?? slot.entityId, icon: 'mdi:thermometer', state: 'missing', valueText: 'Introuvable' }
    const label = slot.label ?? e.attributes.friendly_name ?? slot.entityId
    if (isUnavailableState(e.state)) return { ...base, label, icon: 'mdi:thermometer', state: 'unavailable', valueText: 'Indisponible' }
    return { ...base, label, icon: 'mdi:thermometer', state: 'on', valueText: formatTemp(Number(e.state)) }
  }

  function stripZone(): { side: 'left' | 'right'; zone: number } {
    const i = KNOB_IDS.indexOf(cfg.setpointKnob)
    return { side: i < 3 ? 'left' : 'right', zone: i % 3 }
  }

  return {
    view() {
      const keys: TileView[] = Array.from({ length: KEY_COUNT }, () => EMPTY_TILE)
      const left: TileView[] = [EMPTY_TILE, EMPTY_TILE, EMPTY_TILE]
      const right: TileView[] = [EMPTY_TILE, EMPTY_TILE, EMPTY_TILE]
      const offline = d.ha.status().state !== 'online'
      const entity = climate()

      if (!id) {
        keys[0] = { ...EMPTY_TILE, label: 'Aucun thermostat' }
      } else if (!entity) {
        keys[0] = { ...EMPTY_TILE, accent: cfg.color, label: id, state: 'missing', valueText: 'Introuvable' }
      } else {
        const unavailable = isUnavailableState(entity.state)
        const state = unavailable ? 'unavailable' : entity.state !== 'off' ? 'on' : 'off'
        const base = { accent: cfg.color, level: null }
        const pending = d.actions.overlay(id).pending
        const sp = setpoint()
        keys[0] = { ...base, pending: false, label: 'Ambiante', icon: 'mdi:home-thermometer', state, valueText: unavailable ? 'Indisponible' : formatTemp(num(entity.attributes.current_temperature)) }
        keys[1] = { ...base, pending, label: 'Consigne', icon: 'mdi:thermostat', state, valueText: unavailable ? 'Indisponible' : formatTemp(sp) }
        const modes: string[] = Array.isArray(entity.attributes.hvac_modes) ? entity.attributes.hvac_modes : []
        modes.slice(0, MAX_MODES).forEach((mode, i) => {
          keys[MODE_START + i] = {
            ...base, pending: false,
            label: HVAC_LABELS[mode] ?? mode,
            icon: MODE_ICONS[mode] ?? null,
            state: mode === entity.state ? 'on' : 'off',
            valueText: null,
          }
        })
        const z = stripZone()
        const strip = z.side === 'left' ? left : right
        strip[z.zone] = { ...base, pending, label: 'Consigne', icon: null, state, valueText: unavailable ? 'Indisponible' : formatTemp(sp) }
      }

      cfg.sensors.slice(0, KEY_COUNT - SENSOR_START).forEach((s, i) => { keys[SENSOR_START + i] = sensorTile(s) })
      return { kind: 'grid', keys, left, right, offline }
    },

    handle(e: InputEvent) {
      const entity = climate()
      if (!id || !entity) return
      if (e.type === 'tap' && e.target.kind === 'key') {
        const modes: string[] = Array.isArray(entity.attributes.hvac_modes) ? entity.attributes.hvac_modes : []
        const mode = modes.slice(0, MAX_MODES)[e.target.index - MODE_START]
        if (e.target.index >= MODE_START && mode) d.actions.setHvacMode(id, mode)
        return
      }
      if (e.type === 'knobTurn' && e.knob === cfg.setpointKnob) {
        const current = setpoint()
        if (current === null) return
        const step = num(entity.attributes.target_temp_step) ?? DEFAULT_STEP
        const min = num(entity.attributes.min_temp) ?? -Infinity
        const max = num(entity.attributes.max_temp) ?? Infinity
        const raw = Math.round((current + e.delta * step) / step) * step
        const next = Math.min(max, Math.max(min, Math.round(raw * 100) / 100))
        d.actions.setTemperature(id, next)
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
