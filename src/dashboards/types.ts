import type { HaPort } from '../ha/types.js'
import type { Actions } from '../ha/actions.js'
import type { InputEvent } from '../device/input.js'
import type { View } from '../views.js'

export interface DashboardDeps { ha: HaPort; actions: Actions; requestRender: () => void }
export interface Dashboard { view(): View; handle(e: InputEvent): void; activate(): void; deactivate(): void }
