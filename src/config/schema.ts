import { z } from 'zod'

export const KNOB_IDS = ['knobTL', 'knobCL', 'knobBL', 'knobTR', 'knobCR', 'knobBR'] as const
export type KnobId = typeof KNOB_IDS[number]

export interface KeySlot { entityId: string; label?: string; icon?: string }
export interface LightsDashboard { type: 'lights'; name: string; color: string; keys: (KeySlot | null)[]; dimmers: Record<KnobId, KeySlot | null> }
export interface ClimateDashboard { type: 'climate'; name: string; color: string; entityId: string | null; setpointKnob: KnobId; sensors: KeySlot[] }
export interface WeatherDashboard { type: 'weather'; name: string; color: string; entityId: string | null }
/** Cadrage de l'image caméra : `cover` remplit l'écran (bords rognés), `contain` montre l'image entière avec des bandes noires. */
export type CameraFit = 'cover' | 'contain'
export const CAMERA_FITS = ['cover', 'contain'] as const satisfies readonly CameraFit[]
export interface CameraDashboard { type: 'camera'; name: string; color: string; entityId: string | null; source: 'ha-proxy'; intervalMs: number; fit: CameraFit }
export type DashboardConfig = LightsDashboard | ClimateDashboard | WeatherDashboard | CameraDashboard
export interface AppConfig {
  version: 1
  ha: { url: string; token: string; allowSelfSigned: boolean }
  device: { path: string | null; brightness: number }
  editor: { port: number }
  buttons: (DashboardConfig | null)[]
}

const knobId = z.enum(KNOB_IDS)
const keySlot = z.object({
  entityId: z.string().min(1),
  label: z.string().optional(),
  icon: z.string().optional(),
})
const slotOrNull = keySlot.nullable()
const base = { name: z.string(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }

const lights = z.object({
  type: z.literal('lights'),
  ...base,
  keys: z.array(slotOrNull).length(12),
  dimmers: z.object({
    knobTL: slotOrNull, knobCL: slotOrNull, knobBL: slotOrNull,
    knobTR: slotOrNull, knobCR: slotOrNull, knobBR: slotOrNull,
  }),
})
const climate = z.object({
  type: z.literal('climate'),
  ...base,
  entityId: z.string().min(1).nullable(),
  setpointKnob: knobId,
  sensors: z.array(keySlot).max(4),
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
})

const dashboard = z.discriminatedUnion('type', [lights, climate, weather, camera])

export const appConfigSchema: z.ZodType<AppConfig> = z.object({
  version: z.literal(1),
  ha: z.object({ url: z.string(), token: z.string(), allowSelfSigned: z.boolean() }),
  device: z.object({ path: z.string().nullable(), brightness: z.number().min(0).max(1) }),
  editor: z.object({ port: z.number().int().min(1).max(65535) }),
  buttons: z.array(dashboard.nullable()).length(8),
})

const COLORS = { lights: '#FFB300', climate: '#FF5722', weather: '#03A9F4', camera: '#9C27B0' } as const
const NAMES = { lights: 'Lumières', climate: 'Température', weather: 'Météo' } as const

export function emptyDashboard(type: DashboardConfig['type'], index: number): DashboardConfig {
  const color = COLORS[type]
  switch (type) {
    case 'lights':
      return {
        type, name: NAMES.lights, color,
        keys: Array.from({ length: 12 }, () => null),
        dimmers: { knobTL: null, knobCL: null, knobBL: null, knobTR: null, knobCR: null, knobBR: null },
      }
    case 'climate':
      return { type, name: NAMES.climate, color, entityId: null, setpointKnob: 'knobTR', sensors: [] }
    case 'weather':
      return { type, name: NAMES.weather, color, entityId: null }
    case 'camera':
      return { type, name: `Caméra ${index + 1}`, color, entityId: null, source: 'ha-proxy', intervalMs: 1000, fit: 'cover' }
  }
}

export function defaultConfig(): AppConfig {
  return {
    version: 1,
    ha: { url: 'http://homeassistant.local:8123', token: '', allowSelfSigned: false },
    device: { path: null, brightness: 1 },
    editor: { port: 8765 },
    buttons: [
      emptyDashboard('lights', 0),
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
