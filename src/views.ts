import type { OutlookPoint } from './weather/openmeteo.js'

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
  /**
   * Mise en page : `standard` (icône, libellé, valeur), `big` (libellé en haut, valeur en grand, `sub` dessous),
   * `graph` (libellé, valeur, courbe `spark` en bas). Absent = `standard`.
   */
  layout?: 'standard' | 'big' | 'graph'
  sub?: string | null
  spark?: { values: number[]; style: 'area' | 'line' } | null
  /** Fond teinté par une couleur (touche État) au lieu du fond « éteint ». */
  tint?: string | null
  /** Action protégée : un petit rond indique qu'il faut un appui long. */
  confirm?: boolean
}

export const EMPTY_TILE: TileView = { label: '', icon: null, state: 'empty', valueText: null, level: null, pending: false, accent: '#FFFFFF' }

export interface GridView { kind: 'grid'; keys: TileView[]; left: TileView[]; right: TileView[]; offline: boolean }
export interface WeatherDay { label: string; icon: string; high: string; low: string }
/** Graphique des touches 9 à 11 : `start` = maintenant − 8 h, `end` = maintenant + 4 h (ms). Sans `points`, `message` dit pourquoi. */
export interface WeatherOutlook {
  points: OutlookPoint[]
  start: number
  now: number
  end: number
  /** Données gardées mais plus à jour (service en erreur ou Home Assistant hors ligne) : dessinées en grisé. */
  stale: boolean
  message: string | null
}
export interface WeatherView {
  kind: 'weather'
  current: { icon: string; temperature: string; apparent: string | null; condition: string } | null
  days: WeatherDay[]
  message: string | null
  offline: boolean
  /** Zone haut droite : date et heure de la dernière mise à jour ; un appui l'actualise. */
  updated?: { text: string; busy: boolean } | null
  outlook?: WeatherOutlook | null
}
/** Tuile haut gauche d'une page caméra : temps écoulé depuis la dernière image affichée. */
export interface CameraAge { text: string; level: 'ok' | 'warn' | 'bad'; busy: 'refresh' | 'reload' | null }
/** `fit` : `cover` remplit l'écran, `contain` montre l'image entière centrée (bandes noires). */
export interface FullView {
  kind: 'full'; image: Buffer | null; message: string | null; stale: boolean; offline: boolean; fit: 'cover' | 'contain'
  age?: CameraAge | null
}
/** Indication d'une molette, affichée dans sa zone latérale. */
export interface KnobHint { glyph: string; title: string; sub: string }
export interface GraphView {
  kind: 'graph'
  title: string
  valueText: string
  subtitle: string
  color: string
  /** Points visibles, temps en ms et valeur ; l'axe vertical va de `lo` à `hi`. */
  points: { t: number; v: number }[]
  start: number
  end: number
  lo: number
  hi: number
  decimals: number
  xLabels: [string, string, string]
  /** Position de la fenêtre dans l'historique chargé, 0..1 (début et largeur). */
  scroll: { from: number; width: number }
  hints: Partial<Record<'L0' | 'L1' | 'L2' | 'R0' | 'R1' | 'R2', KnobHint>>
  message: string | null
  offline: boolean
}
export type View = GridView | WeatherView | FullView | GraphView
