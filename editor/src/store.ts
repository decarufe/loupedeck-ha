import { reactive } from 'vue'
import type { EntityInfo } from '@shared/shared/placement'
import * as api from './api'
import type { LiveMessage, PublicConfig, Status } from './api'

export interface EditorState {
  config: PublicConfig | null
  entities: EntityInfo[]
  status: Status | null
  selectedButton: number
  previewVersion: number
  activeButton: number
  error: string | null
}

const initial = (): EditorState => ({
  config: null, entities: [], status: null, selectedButton: 0, previewVersion: 0, activeButton: -1, error: null,
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
  } catch {
    state.entities = [] // Home Assistant hors ligne : la palette sera vide, pas une erreur d'édition.
  }
}

/** Clone la configuration, applique la mutation, l'envoie ; en cas d'échec l'erreur du serveur est affichée. */
export async function save(mutator: (cfg: PublicConfig) => void): Promise<boolean> {
  if (!state.config) return false
  const draft = JSON.parse(JSON.stringify(state.config)) as PublicConfig
  mutator(draft)
  try {
    state.config = await api.putConfig(draft)
    state.error = null
    state.previewVersion++
    return true
  } catch (e) {
    fail(e)
    return false
  }
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
  await Promise.all([loadConfig(), loadStatus(), loadEntities()])
  return api.connectLive((m) => { void handleLive(m) })
}
