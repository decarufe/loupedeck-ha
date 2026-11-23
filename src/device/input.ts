import { KNOB_IDS, type KnobId } from '../config/schema.js'

export type TapTarget = { kind: 'key'; index: number } | { kind: 'strip'; side: 'left' | 'right'; zone: 0 | 1 | 2 }
export type InputEvent =
  | { type: 'button'; id: number }
  | { type: 'knobTurn'; knob: KnobId; delta: number }
  | { type: 'knobPress'; knob: KnobId }
  | { type: 'tap'; target: TapTarget }
  /** Fin d'un toucher : avec `tap`, sert à distinguer l'appui court de l'appui long. */
  | { type: 'release'; target: TapTarget }

export type RawInputEventName = 'down' | 'up' | 'rotate' | 'touchstart' | 'touchmove' | 'touchend'

const ZONE_HEIGHT = 90
const KEY_COUNT = 12
const BUTTON_COUNT = 8

function isKnob(id: unknown): id is KnobId {
  return typeof id === 'string' && (KNOB_IDS as readonly string[]).includes(id)
}

function tapTarget(touch: any): TapTarget | null {
  const screen = touch?.target?.screen
  if (screen === 'left' || screen === 'right') {
    if (typeof touch.y !== 'number') return null
    const zone = Math.max(0, Math.min(2, Math.floor(touch.y / ZONE_HEIGHT))) as 0 | 1 | 2
    return { kind: 'strip', side: screen, zone }
  }
  if (screen === 'center') {
    const key = touch.target.key
    if (Number.isInteger(key) && key >= 0 && key < KEY_COUNT) return { kind: 'key', index: key }
  }
  return null
}

/** Traduit un événement brut de la librairie `loupedeck` ; null si l'événement est ignoré. */
export function normalizeInput(event: RawInputEventName, payload: any): InputEvent | null {
  switch (event) {
    case 'down': {
      const id = payload?.id
      if (isKnob(id)) return { type: 'knobPress', knob: id }
      if (Number.isInteger(id) && id >= 0 && id < BUTTON_COUNT) return { type: 'button', id }
      return null
    }
    case 'rotate': {
      const { id, delta } = payload ?? {}
      if (isKnob(id) && typeof delta === 'number' && delta !== 0) return { type: 'knobTurn', knob: id, delta }
      return null
    }
    case 'touchstart': {
      const touch = payload?.changedTouches?.[0]
      const target = touch ? tapTarget(touch) : null
      return target ? { type: 'tap', target } : null
    }
    case 'touchend': {
      const touch = payload?.changedTouches?.[0]
      const target = touch ? tapTarget(touch) : null
      return target ? { type: 'release', target } : null
    }
    default:
      return null
  }
}
