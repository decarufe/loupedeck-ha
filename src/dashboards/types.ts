import type { HaPort } from '../ha/types.js'
import type { Actions } from '../ha/actions.js'
import type { InputEvent } from '../device/input.js'
import type { View } from '../views.js'
import type { GeoPoint, OutlookPoint } from '../weather/openmeteo.js'

/** États Home Assistant sans valeur exploitable : la tuile affiche « Indisponible ». */
export function isUnavailableState(state: string): boolean {
  return state === 'unavailable' || state === 'unknown'
}

export interface DashboardDeps {
  ha: HaPort
  actions: Actions
  requestRender: () => void
  /** Source du graphique météo ; Open-Meteo par défaut. Les tests la remplacent pour ne pas toucher au réseau. */
  fetchOutlook?: (loc: GeoPoint) => Promise<OutlookPoint[]>
}
export interface Dashboard { view(): View; handle(e: InputEvent): void; activate(): void; deactivate(): void }
