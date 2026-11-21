export type TileState = 'on' | 'off' | 'unavailable' | 'missing' | 'empty'

export interface TileView {
  label: string
  icon: string | null
  state: TileState
  valueText: string | null
  /** 0..1, null = pas de barre */
  level: number | null
  pending: boolean
  accent: string
}

export const EMPTY_TILE: TileView = { label: '', icon: null, state: 'empty', valueText: null, level: null, pending: false, accent: '#FFFFFF' }

export interface GridView { kind: 'grid'; keys: TileView[]; left: TileView[]; right: TileView[]; offline: boolean }
export interface WeatherDay { label: string; icon: string; high: string; low: string }
export interface WeatherView {
  kind: 'weather'
  current: { icon: string; temperature: string; apparent: string | null; condition: string } | null
  days: WeatherDay[]
  message: string | null
  offline: boolean
}
export interface FullView { kind: 'full'; image: Buffer | null; message: string | null; stale: boolean; offline: boolean }
export type View = GridView | WeatherView | FullView
