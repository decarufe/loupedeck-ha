import { z } from 'zod'

export const KNOB_IDS = ['knobTL', 'knobCL', 'knobBL', 'knobTR', 'knobCR', 'knobBR'] as const
export type KnobId = typeof KNOB_IDS[number]

// ---------- touches d'une page « Bouton custom » ----------

/** Types de touche. `dimmer` ne va que sur une bande latérale (molette) ; `action` et `graph` que sur une touche centrale. */
export const TILE_KINDS = ['toggle', 'action', 'state', 'value', 'graph', 'clock', 'dimmer'] as const
export type TileKind = typeof TILE_KINDS[number]

export const CLOCK_FORMATS = ['time-date', 'time', 'time-seconds', 'date'] as const
export type ClockFormat = typeof CLOCK_FORMATS[number]
export const TILE_GRAPH_PERIODS = ['1h', '6h', '24h'] as const
export type TileGraphPeriod = typeof TILE_GRAPH_PERIODS[number]

export interface StateLook { text: string; color: string; icon?: string }

interface TileBase { label?: string; icon?: string; color?: string }
export interface ToggleTile extends TileBase { kind: 'toggle'; entityId: string | null }
export interface ActionTile extends TileBase { kind: 'action'; entityId: string | null; confirm: boolean }
export interface StateTile extends TileBase { kind: 'state'; entityId: string | null; on: StateLook; off: StateLook }
export interface ValueTile extends TileBase { kind: 'value'; entityId: string | null; template: string; decimals: number }
export interface GraphTile extends TileBase { kind: 'graph'; entityId: string | null; period: TileGraphPeriod; style: 'area' | 'line'; showMinMax: boolean; decimals: number }
export interface ClockTile extends TileBase { kind: 'clock'; format: ClockFormat }
export interface DimmerTile extends TileBase { kind: 'dimmer'; entityId: string | null }
export type Tile = ToggleTile | ActionTile | StateTile | ValueTile | GraphTile | ClockTile | DimmerTile

/** Où un type de touche peut aller : `key` = 12 touches centrales, `strip` = 6 zones latérales (une par molette). */
export const TILE_SLOTS: Record<TileKind, readonly ('key' | 'strip')[]> = {
  toggle: ['key', 'strip'],
  action: ['key'],
  state: ['key', 'strip'],
  value: ['key', 'strip'],
  graph: ['key'],
  clock: ['key', 'strip'],
  dimmer: ['strip'],
}

// ---------- pages ----------

export interface CustomDashboard { type: 'custom'; name: string; color: string; keys: (Tile | null)[]; strips: Record<KnobId, Tile | null> }
export interface ClimateDashboard { type: 'climate'; name: string; color: string; entityId: string | null; setpointKnob: KnobId; sensors: { entityId: string; label?: string; icon?: string }[] }
export interface WeatherDashboard { type: 'weather'; name: string; color: string; entityId: string | null }
/** Cadrage de l'image caméra : `cover` remplit l'écran (bords rognés), `contain` montre l'image entière avec des bandes noires. */
export type CameraFit = 'cover' | 'contain'
export const CAMERA_FITS = ['cover', 'contain'] as const satisfies readonly CameraFit[]
/** Alerte d'une page caméra : capteurs (`binary_sensor`) dont une détection ouvre la page et fait vibrer la console. */
export interface CameraAlert { enabled: boolean; sensors: string[] }
export interface CameraDashboard { type: 'camera'; name: string; color: string; entityId: string | null; source: 'ha-proxy'; intervalMs: number; fit: CameraFit; alert: CameraAlert }
/** Fenêtres du graphique plein écran, en heures ; la molette haut droite passe de l'une à l'autre. */
export const GRAPH_WINDOWS_H = [1, 3, 6, 12, 24, 72] as const
export interface GraphDashboard { type: 'graph'; name: string; color: string; entityId: string | null; windowHours: number }
export type DashboardConfig = CustomDashboard | ClimateDashboard | WeatherDashboard | CameraDashboard | GraphDashboard
export type DashboardType = DashboardConfig['type']
export const DASHBOARD_TYPES = ['custom', 'weather', 'camera', 'climate', 'graph'] as const satisfies readonly DashboardType[]

export interface AppConfig {
  version: 2
  ha: { url: string; token: string; allowSelfSigned: boolean }
  device: { path: string | null; brightness: number }
  editor: { port: number }
  buttons: (DashboardConfig | null)[]
}

const knobId = z.enum(KNOB_IDS)
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const entity = z.string().min(1).nullable()
const tileBase = { label: z.string().optional(), icon: z.string().optional(), color: hex.optional() }
const look = z.object({ text: z.string(), color: hex, icon: z.string().optional() })

const tile = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('toggle'), entityId: entity, ...tileBase }),
  z.object({ kind: z.literal('action'), entityId: entity, confirm: z.boolean().default(false), ...tileBase }),
  z.object({ kind: z.literal('state'), entityId: entity, on: look, off: look, ...tileBase }),
  z.object({ kind: z.literal('value'), entityId: entity, template: z.string().default('{valeur} {unité}'), decimals: z.number().int().min(0).max(3).default(0), ...tileBase }),
  z.object({
    kind: z.literal('graph'), entityId: entity, period: z.enum(TILE_GRAPH_PERIODS).default('6h'), style: z.enum(['area', 'line']).default('area'),
    showMinMax: z.boolean().default(false), decimals: z.number().int().min(0).max(3).default(0), ...tileBase,
  }),
  z.object({ kind: z.literal('clock'), format: z.enum(CLOCK_FORMATS).default('time-date'), ...tileBase }),
  z.object({ kind: z.literal('dimmer'), entityId: entity, ...tileBase }),
])
const tileOrNull = tile.nullable()
const base = { name: z.string(), color: hex }

const custom = z.object({
  type: z.literal('custom'),
  ...base,
  keys: z.array(tileOrNull).length(12),
  strips: z.object({
    knobTL: tileOrNull, knobCL: tileOrNull, knobBL: tileOrNull,
    knobTR: tileOrNull, knobCR: tileOrNull, knobBR: tileOrNull,
  }),
}).superRefine((d, ctx) => {
  d.keys.forEach((t, i) => {
    if (t && !TILE_SLOTS[t.kind].includes('key')) ctx.addIssue({ code: 'custom', path: ['keys', i], message: `Le type « ${t.kind} » ne va pas sur une touche centrale` })
  })
  for (const k of KNOB_IDS) {
    const t = d.strips[k]
    if (t && !TILE_SLOTS[t.kind].includes('strip')) ctx.addIssue({ code: 'custom', path: ['strips', k], message: `Le type « ${t.kind} » ne va pas sur une bande latérale` })
  }
})
const climate = z.object({
  type: z.literal('climate'),
  ...base,
  entityId: z.string().min(1).nullable(),
  setpointKnob: knobId,
  sensors: z.array(z.object({ entityId: z.string().min(1), label: z.string().optional(), icon: z.string().optional() })).max(4),
})
const weather = z.object({
  type: z.literal('weather'),
  ...base,
  entityId: z.string().min(1).nullable(),
})
const camera = z.object({
  type: z.literal('camera'),
  ...base,
  entityId: z.string().min(1).nullable(),
  source: z.literal('ha-proxy'),
  intervalMs: z.number().int().min(250).max(2000),
  // Absent d'une ancienne configuration : `cover` (comportement d'origine) appliqué au chargement.
  fit: z.enum(CAMERA_FITS).default('cover'),
  // Absente d'une ancienne configuration : alerte désactivée.
  alert: z.object({ enabled: z.boolean(), sensors: z.array(z.string().min(1)) }).default({ enabled: false, sensors: [] }),
})
const graph = z.object({
  type: z.literal('graph'),
  ...base,
  entityId: z.string().min(1).nullable(),
  windowHours: z.number().refine((h) => (GRAPH_WINDOWS_H as readonly number[]).includes(h), 'Fenêtre de graphique inconnue').default(12),
})

/** Adresse Home Assistant : `http://` ou `https://` (espaces autour tolérés) ; vide admis pour une configuration vierge. */
const haUrl = z.string().refine((u) => u.trim() === '' || /^https?:\/\//i.test(u.trim()), {
  message: "L'adresse Home Assistant doit commencer par http:// ou https://",
})

const dashboard = z.discriminatedUnion('type', [custom, climate, weather, camera, graph])

const v2 = z.object({
  version: z.literal(2),
  ha: z.object({ url: haUrl, token: z.string(), allowSelfSigned: z.boolean() }),
  device: z.object({ path: z.string().nullable(), brightness: z.number().min(0).max(1) }),
  editor: z.object({ port: z.number().int().min(1).max(65535) }),
  buttons: z.array(dashboard.nullable()).length(8),
})

/**
 * Configuration v1 → v2 : le tableau « Lumières » devient une page « Bouton custom ».
 * Ses touches deviennent des Interrupteurs, ses molettes des Gradateurs (seules les lumières gradables y étaient admises).
 * Une valeur qui n'a pas la forme attendue est rendue telle quelle : la validation v2 la refusera.
 */
export function migrateConfig(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) return raw
  const v1 = raw as Record<string, unknown> & { buttons?: unknown }
  const slot = (kind: 'toggle' | 'dimmer', s: unknown) => {
    if (!s || typeof s !== 'object') return s ?? null
    const { entityId, label, icon } = s as Record<string, unknown>
    return { kind, entityId, ...(label !== undefined ? { label } : {}), ...(icon !== undefined ? { icon } : {}) }
  }
  const buttons = Array.isArray(v1.buttons)
    ? v1.buttons.map((b) => {
      if (!b || typeof b !== 'object' || (b as { type?: unknown }).type !== 'lights') return b
      const l = b as { name?: unknown; color?: unknown; keys?: unknown; dimmers?: Record<string, unknown> }
      const dimmers = l.dimmers && typeof l.dimmers === 'object' ? l.dimmers : {}
      return {
        type: 'custom', name: l.name, color: l.color,
        keys: Array.isArray(l.keys) ? l.keys.map((k) => slot('toggle', k)) : l.keys,
        strips: Object.fromEntries(KNOB_IDS.map((k) => [k, slot('dimmer', dimmers[k])])),
      }
    })
    : v1.buttons
  return { ...v1, version: 2, buttons }
}

export const appConfigSchema: z.ZodType<AppConfig, unknown> = z.preprocess(migrateConfig, v2) as unknown as z.ZodType<AppConfig, unknown>

const COLORS: Record<DashboardType, string> = { custom: '#26A69A', climate: '#FF5722', weather: '#03A9F4', camera: '#9C27B0', graph: '#FFB300' }
export const DASHBOARD_LABELS: Record<DashboardType, string> = {
  custom: 'Bouton custom', weather: 'Météo', camera: 'Caméra', climate: 'Contrôle de température', graph: 'Graphique plein écran',
}
const NAMES: Record<DashboardType, string> = { custom: 'Nouvelle page', climate: 'Température', weather: 'Météo', camera: 'Caméra', graph: 'Graphique' }

export const emptyStrips = (): Record<KnobId, Tile | null> => ({ knobTL: null, knobCL: null, knobBL: null, knobTR: null, knobCR: null, knobBR: null })

export function emptyDashboard(type: DashboardType, index: number): DashboardConfig {
  const color = COLORS[type]
  switch (type) {
    case 'custom':
      return { type, name: NAMES.custom, color, keys: Array.from({ length: 12 }, () => null), strips: emptyStrips() }
    case 'climate':
      return { type, name: NAMES.climate, color, entityId: null, setpointKnob: 'knobTR', sensors: [] }
    case 'weather':
      return { type, name: NAMES.weather, color, entityId: null }
    case 'camera':
      return { type, name: `${NAMES.camera} ${index + 1}`, color, entityId: null, source: 'ha-proxy', intervalMs: 1000, fit: 'cover', alert: { enabled: false, sensors: [] } }
    case 'graph':
      return { type, name: NAMES.graph, color, entityId: null, windowHours: 12 }
  }
}

/** Une page « vide » : bouton sans page, ou page Bouton custom sans aucune touche. Seule une page vide peut changer de type. */
export function isEmptyPage(d: DashboardConfig | null | undefined): boolean {
  if (!d) return true
  return d.type === 'custom' && d.keys.every((k) => !k) && KNOB_IDS.every((k) => !d.strips[k])
}

export function defaultConfig(): AppConfig {
  return {
    version: 2,
    ha: { url: 'http://homeassistant.local:8123', token: '', allowSelfSigned: false },
    device: { path: null, brightness: 1 },
    editor: { port: 8765 },
    buttons: [
      { ...emptyDashboard('custom', 0), name: 'Maison' },
      emptyDashboard('climate', 1),
      emptyDashboard('weather', 2),
      emptyDashboard('camera', 0),
      emptyDashboard('camera', 1),
      emptyDashboard('camera', 2),
      emptyDashboard('camera', 3),
      null,
    ],
  }
}

/** Réordonnancement commun (pages, touches) : vers une place occupée, insertion et décalage ; vers une place vide (ou `swap`), échange. */
export function arrangeOrder<T>(items: readonly (T | null)[], from: number, to: number, swap = false): number[] {
  const order = items.map((_, i) => i)
  if (from === to) return order
  if (swap || !items[to]) [order[from], order[to]] = [order[to]!, order[from]!]
  else { const [x] = order.splice(from, 1); order.splice(to, 0, x!) }
  return order
}

export function moveItem<T>(items: (T | null)[], from: number, to: number, swap = false): (T | null)[] {
  return arrangeOrder(items, from, to, swap).map((i) => items[i] ?? null)
}
