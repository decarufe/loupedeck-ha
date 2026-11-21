import { reactive } from 'vue'
import type { KeySlot, KnobId } from '@shared/config/schema'
import { canPlace, type EntityInfo, type SlotKind } from '@shared/shared/placement'
import * as api from './api'
import type { LiveMessage, PublicConfig, Status } from './api'

/** Emplacement d'un tableau Lumières : une touche (0-11) ou une molette. */
export type SlotTarget = { kind: 'key'; index: number } | { kind: 'dimmer'; knob: KnobId }

export interface EditorState {
  config: PublicConfig | null
  entities: EntityInfo[]
  /** Vrai quand la liste des entités n'a pas pu être chargée (Home Assistant hors ligne). */
  entitiesUnavailable: boolean
  /** Entité choisie dans la palette, en attente d'un clic sur un emplacement. */
  pendingEntity: string | null
  /** Emplacement sélectionné pour l'édition du libellé et de l'icône. */
  selectedSlot: SlotTarget | null
  status: Status | null
  selectedButton: number
  previewVersion: number
  activeButton: number
  error: string | null
}

const initial = (): EditorState => ({
  config: null, entities: [], entitiesUnavailable: false, pendingEntity: null, selectedSlot: null,
  status: null, selectedButton: 0, previewVersion: 0, activeButton: -1, error: null,
})

export const state = reactive<EditorState>(initial())

export function reset() {
  Object.assign(state, initial())
}

function fail(e: unknown) {
  if (e instanceof api.ApiError) {
    state.error = e.issues.length > 0 ? `${e.message} — ${e.issues.join(' ; ')}` : e.message
  } else {
    state.error = e instanceof Error ? e.message : String(e)
  }
}

export function select(i: number) {
  state.selectedButton = i
  state.selectedSlot = null
}

export async function loadConfig() {
  try {
    state.config = await api.getConfig()
  } catch (e) { fail(e) }
}

export async function loadStatus() {
  try {
    state.status = await api.getStatus()
    state.activeButton = state.status.activeButton
  } catch (e) { fail(e) }
}

export async function loadEntities() {
  try {
    state.entities = await api.getEntities()
    state.entitiesUnavailable = false
  } catch {
    // Home Assistant hors ligne : la palette est vide et l'indique, ce n'est pas une erreur d'édition.
    state.entities = []
    state.entitiesUnavailable = true
  }
}

/** Clone la configuration, applique la mutation, l'envoie ; en cas d'échec l'erreur du serveur est affichée. */
export async function save(mutator: (cfg: PublicConfig) => void, newToken?: string): Promise<boolean> {
  if (!state.config) return false
  const draft = JSON.parse(JSON.stringify(state.config)) as PublicConfig
  mutator(draft)
  try {
    state.config = await api.putConfig(draft, newToken)
    state.error = null
    state.previewVersion++
    return true
  } catch (e) {
    fail(e)
    return false
  }
}

const slotKind = (t: SlotTarget): SlotKind => (t.kind === 'key' ? 'key' : 'dimmer')

function slotAccess(cfg: PublicConfig, button: number, t: SlotTarget) {
  const b = cfg.buttons[button]
  if (b?.type !== 'lights') return null
  return t.kind === 'key'
    ? { get: (): KeySlot | null => b.keys[t.index] ?? null, set: (v: KeySlot | null) => { b.keys[t.index] = v } }
    : { get: (): KeySlot | null => b.dimmers[t.knob], set: (v: KeySlot | null) => { b.dimmers[t.knob] = v } }
}

/** Place une entité sur un emplacement du tableau sélectionné ; une entité refusée affiche la raison, sans PUT. */
export async function placeEntity(target: SlotTarget, entityId: string): Promise<boolean> {
  const info = state.entities.find((e) => e.entityId === entityId)
  if (!info) {
    state.error = `Entité inconnue : ${entityId}`
    return false
  }
  const verdict = canPlace(slotKind(target), info)
  if (!verdict.ok) {
    state.error = verdict.reason
    return false
  }
  const button = state.selectedButton
  const ok = await save((cfg) => { slotAccess(cfg, button, target)?.set({ entityId }) })
  if (ok) state.pendingEntity = null
  return ok
}

/** Modifie le libellé ou l'icône ; une valeur vide supprime la propriété. */
export function updateSlot(target: SlotTarget, patch: { label?: string; icon?: string }): Promise<boolean> {
  const button = state.selectedButton
  return save((cfg) => {
    const access = slotAccess(cfg, button, target)
    const slot = access?.get()
    if (!access || !slot) return
    const next: KeySlot = { ...slot }
    for (const k of ['label', 'icon'] as const) {
      const v = patch[k]
      if (v === undefined) continue
      if (v.trim() === '') delete next[k]
      else next[k] = v
    }
    access.set(next)
  })
}

export async function clearSlot(target: SlotTarget): Promise<boolean> {
  const button = state.selectedButton
  const ok = await save((cfg) => { slotAccess(cfg, button, target)?.set(null) })
  if (ok) state.selectedSlot = null
  return ok
}

export async function undo() {
  try {
    state.config = await api.undo()
    state.error = null
    state.previewVersion++
  } catch (e) { fail(e) }
}

export async function handleLive(m: LiveMessage) {
  switch (m.type) {
    case 'config':
      await loadConfig()
      state.previewVersion++
      break
    case 'active':
      state.activeButton = m.button
      break
    case 'status':
      await loadStatus()
      break
    case 'entities':
      await loadEntities()
      break
  }
}

export async function init(): Promise<() => void> {
  // Les entités sont chargées par la palette à son ouverture, puis sur chaque message live « entities ».
  await Promise.all([loadConfig(), loadStatus()])
  return api.connectLive((m) => { void handleLive(m) })
}
