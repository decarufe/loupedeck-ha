import { TILE_SLOTS, type StateLook, type Tile, type TileKind } from '../config/schema.js'
import { canPlace, type EntityInfo } from './placement.js'

export type SlotType = 'key' | 'strip'

export const TILE_KIND_LABELS: Record<TileKind, { name: string; desc: string; icon: string }> = {
  toggle: { name: 'Interrupteur', desc: 'Allume ou éteint une lumière, une prise', icon: 'mdi:toggle-switch' },
  action: { name: 'Action', desc: 'Lance une scène ou un script', icon: 'mdi:play' },
  state: { name: 'État', desc: 'Porte, fenêtre, mouvement : texte et couleur', icon: 'mdi:door' },
  value: { name: 'Valeur', desc: 'Une mesure, avec son format', icon: 'mdi:gauge' },
  graph: { name: 'Graphique', desc: 'Courbe d’un capteur numérique', icon: 'mdi:chart-line' },
  clock: { name: 'Date et heure', desc: 'Horloge du PC, sans entité', icon: 'mdi:clock-outline' },
  dimmer: { name: 'Gradateur', desc: 'Intensité réglée par la molette', icon: 'mdi:brightness-6' },
}

export const fitsSlot = (kind: TileKind, slot: SlotType): boolean => TILE_SLOTS[kind].includes(slot)

/** Ce qu'il faut au type de touche, pour les messages : « une scène ou un script ». */
export const TILE_NEEDS: Partial<Record<TileKind, string>> = {
  toggle: 'une lumière, une prise ou un booléen',
  action: 'une scène ou un script',
  state: 'un capteur tout ou rien',
  value: 'un capteur',
  graph: 'un capteur numérique',
  dimmer: 'une lumière gradable',
}

/** Textes et couleurs par défaut d'une touche État, selon la classe du capteur. */
export function stateLooks(deviceClass: string | null | undefined): { on: StateLook; off: StateLook } {
  switch (deviceClass) {
    case 'door': case 'garage_door':
      return { on: { text: 'Ouverte', color: '#EF5350' }, off: { text: 'Fermée', color: '#66BB6A' } }
    case 'window':
      return { on: { text: 'Ouverte', color: '#FFB300' }, off: { text: 'Fermée', color: '#66BB6A' } }
    case 'motion': case 'occupancy': case 'presence':
      return { on: { text: 'Mouvement', color: '#FFB300' }, off: { text: 'Calme', color: '#78909C' } }
    default:
      return { on: { text: 'Actif', color: '#FFB300' }, off: { text: 'Inactif', color: '#78909C' } }
  }
}

/** Nouvelle touche d'un type, avec ses réglages par défaut ; `entity` la renseigne si elle est fournie. */
export function newTile(kind: TileKind, entity?: EntityInfo | null): Tile {
  const entityId = entity?.entityId ?? null
  switch (kind) {
    case 'toggle': return { kind, entityId }
    case 'dimmer': return { kind, entityId }
    case 'action': return { kind, entityId, confirm: false }
    case 'state': return { kind, entityId, ...stateLooks(entity?.deviceClass) }
    case 'value': return { kind, entityId, template: entity?.unit ? '{valeur} {unité}' : '{valeur}', decimals: entity?.unit === '°C' ? 1 : 0 }
    case 'graph': return { kind, entityId, period: '6h', style: 'area', showMinMax: false, decimals: 0 }
    case 'clock': return { kind, format: 'time-date' }
  }
}

/**
 * Type de touche deviné pour une entité déposée sur un emplacement : on garde le type actuel s'il accepte l'entité,
 * sinon porte → État, scène → Action, lumière gradable sur une bande → Gradateur, etc. `null` si rien ne convient.
 */
export function inferKind(e: EntityInfo, slot: SlotType, current: Tile | null): TileKind | null {
  const accepts = (k: TileKind) => k !== 'clock' && fitsSlot(k, slot) && canPlace(k, e).ok
  if (current && accepts(current.kind)) return current.kind
  if (slot === 'strip' && accepts('dimmer')) return 'dimmer'
  for (const k of ['toggle', 'action', 'state', 'value'] as const) if (accepts(k)) return k
  return null
}

/** Pose une entité sur un emplacement : remplace l'entité en gardant le format si le type ne change pas. */
export function placeOnTile(e: EntityInfo, slot: SlotType, current: Tile | null): { ok: true; tile: Tile } | { ok: false; reason: string } {
  const kind = inferKind(e, slot, current)
  if (!kind) {
    const where = slot === 'key' ? 'une touche centrale' : 'une bande latérale'
    return { ok: false, reason: `${e.name} ne peut pas aller sur ${where}.` }
  }
  if (current && current.kind === kind && current.kind !== 'clock') {
    const next = { ...current, entityId: e.entityId } as Tile
    if (next.kind === 'state') Object.assign(next, stateLooks(e.deviceClass))
    return { ok: true, tile: next }
  }
  const tile = newTile(kind, e)
  if (current) {
    if (current.color) tile.color = current.color
  }
  return { ok: true, tile }
}

/** Change le type d'une touche en gardant l'entité si le nouveau type l'accepte. */
export function changeKind(tile: Tile, kind: TileKind, entities: EntityInfo[]): Tile {
  const id = tile.kind === 'clock' ? null : tile.entityId
  const e = id ? entities.find((x) => x.entityId === id) ?? null : null
  const keep = e && kind !== 'clock' && canPlace(kind, e).ok ? e : null
  const next = newTile(kind, keep)
  if (!keep && id && kind !== 'clock' && !e) (next as { entityId: string | null }).entityId = null
  for (const k of ['label', 'icon', 'color'] as const) if (tile[k] !== undefined) next[k] = tile[k]
  return next
}
