import * as mdi from '@mdi/js'
import { Path2D, type SKRSContext2D } from '@napi-rs/canvas'

const ICONS = mdi as unknown as Record<string, unknown>

/** 'mdi:lightbulb-on' → chemin SVG de mdiLightbulbOn, ou null. */
export function iconPath(name: string | null): string | null {
  if (!name || !name.startsWith('mdi:')) return null
  const key = 'mdi' + name.slice(4).split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  const v = Object.hasOwn(ICONS, key) ? ICONS[key] : undefined
  return typeof v === 'string' ? v : null
}

export function drawIcon(ctx: SKRSContext2D, name: string | null, x: number, y: number, size: number, color: string): boolean {
  const d = iconPath(name)
  if (d === null) return false
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.fillStyle = color
  ctx.fill(new Path2D(d))
  ctx.restore()
  return true
}

const WEATHER: Record<string, string> = {
  'clear-night': 'mdi:weather-night',
  cloudy: 'mdi:weather-cloudy',
  exceptional: 'mdi:alert-circle-outline',
  fog: 'mdi:weather-fog',
  hail: 'mdi:weather-hail',
  lightning: 'mdi:weather-lightning',
  'lightning-rainy': 'mdi:weather-lightning-rainy',
  partlycloudy: 'mdi:weather-partly-cloudy',
  pouring: 'mdi:weather-pouring',
  rainy: 'mdi:weather-rainy',
  snowy: 'mdi:weather-snowy',
  'snowy-rainy': 'mdi:weather-snowy-rainy',
  sunny: 'mdi:weather-sunny',
  windy: 'mdi:weather-windy',
  'windy-variant': 'mdi:weather-windy-variant',
}

export function weatherIcon(condition: string): string {
  return Object.hasOwn(WEATHER, condition) ? WEATHER[condition]! : 'mdi:weather-cloudy-alert'
}
