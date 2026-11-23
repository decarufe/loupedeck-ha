import type { HaPort } from '../ha/types.js'
import type { Actions } from '../ha/actions.js'
import type { InputEvent } from '../device/input.js'
import type { View } from '../views.js'

/** États Home Assistant sans valeur exploitable : la tuile affiche « Indisponible ». */
export function isUnavailableState(state: string): boolean {
  return state === 'unavailable' || state === 'unknown'
}

export interface DashboardDeps { ha: HaPort; actions: Actions; requestRender: () => void }
export interface Dashboard {
  view(): View
  handle(e: InputEvent): void
  activate(): void
  deactivate(): void
  /** Appelé avant `activate()` quand une alerte ouvre la page : l'image précédente ne doit pas passer pour actuelle. */
  prepareAlert?(): void
}
