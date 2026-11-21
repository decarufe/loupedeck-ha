import { describe, it, expect } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { createSurface, type Surface } from '../../src/render/surface.js'
import { paint, COLORS } from '../../src/render/painters.js'
import { EMPTY_TILE, type GridView, type TileView, type WeatherView, type FullView } from '../../src/views.js'

const px = (s: Surface, x: number, y: number) => Array.from(s.ctx.getImageData(x, y, 1, 1).data.slice(0, 3))
const tile = (o: Partial<TileView>): TileView => ({ label: 'Salon', icon: 'mdi:lightbulb', state: 'on', valueText: '60 %', level: null, pending: false, accent: '#FFB300', ...o })
const grid = (o: Partial<GridView> = {}): GridView => ({
  kind: 'grid',
  keys: Array.from({ length: 12 }, () => EMPTY_TILE),
  left: [EMPTY_TILE, EMPTY_TILE, EMPTY_TILE],
  right: [EMPTY_TILE, EMPTY_TILE, EMPTY_TILE],
  offline: false,
  ...o,
})
const withKey0 = (t: TileView, offline = false) => grid({ keys: [t, ...Array.from({ length: 11 }, () => EMPTY_TILE)], offline })

function redJpeg(): Buffer {
  const c = createCanvas(960, 540)
  const g = c.getContext('2d')
  g.fillStyle = '#ff0000'
  g.fillRect(0, 0, 960, 540)
  return c.toBuffer('image/jpeg')
}

describe('painters', () => {
  it('grid_on_tile_uses_accent', async () => {
    const s = createSurface()
    await paint(s, withKey0(tile({})))
    expect(px(s, 64, 4)).toEqual([255, 179, 0])
  })
  it('grid_off_tile', async () => {
    const s = createSurface()
    await paint(s, withKey0(tile({ state: 'off' })))
    expect(px(s, 64, 4)).toEqual([0x20, 0x20, 0x20])
  })
  it('grid_offline_desaturates', async () => {
    const s = createSurface()
    await paint(s, withKey0(tile({}), true))
    const [r, g, b] = px(s, 64, 4)
    expect(r).toBe(g)
    expect(g).toBe(b)
    expect(r).toBeGreaterThan(0)
    // pastille rouge conservée en couleur
    expect(px(s, 2, 2)).toEqual([0xb0, 0x00, 0x20])
  })
  it('dimmer_level_bar', async () => {
    const s = createSurface()
    const v = grid({ left: [EMPTY_TILE, tile({ level: 0.6 }), EMPTY_TILE] })
    await paint(s, v)
    expect(px(s, 4 + 26, 90 + 90 - 3)).toEqual([255, 255, 255])
    expect(px(s, 4 + 45, 177)).not.toEqual([255, 255, 255])
    expect(COLORS.bar).toBe('#FFFFFF')
  })
  it('grid_text_does_not_overflow_tile', async () => {
    const s = createSurface()
    await paint(s, withKey0(tile({ label: 'Un libellé extrêmement long qui déborde', valueText: 'Valeur très très longue aussi' })))
    // la touche 1 (x 150..240) reste noire
    const d = s.ctx.getImageData(150, 0, 90, 90).data
    expect(Array.from(d).filter((_, i) => i % 4 < 3).every((v) => v === 0)).toBe(true)
  })
  it('full_image_scaled', async () => {
    const s = createSurface()
    const v: FullView = { kind: 'full', image: redJpeg(), message: null, stale: false, offline: false }
    await paint(s, v)
    const [r, g] = px(s, 240, 135)
    expect(r).toBeGreaterThan(200)
    expect(g).toBeLessThan(50)
  })
  it('full_stale_grayscale', async () => {
    const s = createSurface()
    await paint(s, { kind: 'full', image: redJpeg(), message: null, stale: true, offline: false })
    const [r, g, b] = px(s, 240, 135)
    expect(r).toBe(g)
    expect(g).toBe(b)
    expect(r).toBeGreaterThan(0)
  })
  it('full_invalid_jpeg_shows_message', async () => {
    const s = createSurface()
    await expect(paint(s, { kind: 'full', image: Buffer.from('nope'), message: null, stale: false, offline: false })).resolves.toBeUndefined()
    const d = s.ctx.getImageData(0, 120, 480, 30).data
    let lit = 0
    for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! > 0) lit++
    expect(lit).toBeGreaterThan(0)
  })
  it('weather_paints_current', async () => {
    const s = createSurface()
    const v: WeatherView = {
      kind: 'weather',
      current: { icon: 'mdi:weather-sunny', temperature: '19,5 °C', apparent: 'Ressenti 18,0 °C', condition: 'Ensoleillé' },
      days: [{ label: 'Lun', icon: 'mdi:weather-cloudy', high: '20°', low: '10°' }],
      message: null,
      offline: false,
    }
    await paint(s, v)
    const d = s.ctx.getImageData(60, 0, 360, 90).data
    let lit = 0
    for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! > 0) lit++
    expect(lit).toBeGreaterThan(100)
  })
})
