import { describe, it, expect } from 'vitest'
import { mdiLightbulb } from '@mdi/js'
import { iconPath, drawIcon, weatherIcon } from '../../src/render/icons.js'
import { createSurface } from '../../src/render/surface.js'

const CONDITIONS: Record<string, string> = {
  'clear-night': 'mdi:weather-night', cloudy: 'mdi:weather-cloudy', exceptional: 'mdi:alert-circle-outline',
  fog: 'mdi:weather-fog', hail: 'mdi:weather-hail', lightning: 'mdi:weather-lightning',
  'lightning-rainy': 'mdi:weather-lightning-rainy', partlycloudy: 'mdi:weather-partly-cloudy',
  pouring: 'mdi:weather-pouring', rainy: 'mdi:weather-rainy', snowy: 'mdi:weather-snowy',
  'snowy-rainy': 'mdi:weather-snowy-rainy', sunny: 'mdi:weather-sunny', windy: 'mdi:weather-windy',
  'windy-variant': 'mdi:weather-windy-variant',
}

describe('icons', () => {
  it('résout les chemins mdi', () => {
    expect(iconPath('mdi:lightbulb')).toBe(mdiLightbulb)
    expect(iconPath('mdi:does-not-exist')).toBeNull()
    expect(iconPath(null)).toBeNull()
    expect(iconPath('lightbulb')).toBeNull()
    expect(iconPath('hass:lightbulb')).toBeNull()
  })
  it('mappe les 15 conditions météo vers des icônes existantes', () => {
    for (const [cond, icon] of Object.entries(CONDITIONS)) {
      expect(weatherIcon(cond)).toBe(icon)
      expect(iconPath(icon)).not.toBeNull()
    }
    expect(weatherIcon('inconnu')).toBe('mdi:weather-cloudy-alert')
    expect(iconPath('mdi:weather-cloudy-alert')).not.toBeNull()
  })
  it('dessine une icône ou renvoie false', () => {
    const s = createSurface()
    expect(drawIcon(s.ctx, 'mdi:nope-nope', 0, 0, 48, '#fff')).toBe(false)
    expect(s.ctx.getImageData(0, 0, 48, 48).data.some(v => v !== 0 && v !== 255)).toBe(false)
    expect(drawIcon(s.ctx, 'mdi:lightbulb', 0, 0, 48, '#ffffff')).toBe(true)
    const d = s.ctx.getImageData(0, 0, 48, 48).data
    expect(d.some((v, i) => i % 4 === 0 && v > 200)).toBe(true)
  })
})
