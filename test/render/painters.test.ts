import { describe, it, expect } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { keyRect } from '../../src/device/regions.js'
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

/** Image carrée rouge : en « contain » sur 480 × 270, elle occupe x = 105..375 avec des bandes noires de chaque côté. */
function redSquareJpeg(): Buffer {
  const c = createCanvas(200, 200)
  const g = c.getContext('2d')
  g.fillStyle = '#ff0000'
  g.fillRect(0, 0, 200, 200)
  return c.toBuffer('image/jpeg')
}

describe('painters', () => {
  it('full_cover_fills_the_screen', async () => {
    const s = createSurface()
    await paint(s, { kind: 'full', image: redSquareJpeg(), message: null, stale: false, offline: false, fit: 'cover' })
    for (const x of [2, 50, 240, 430, 477]) expect(px(s, x, 135)[0]).toBeGreaterThan(200)
  })

  it('full_contain_whole_image_centered_with_black_bars', async () => {
    const s = createSurface()
    await paint(s, { kind: 'full', image: redSquareJpeg(), message: null, stale: false, offline: false, fit: 'contain' })
    // Bandes noires à gauche (0..104) et à droite (376..479), sur toute la hauteur.
    for (const [x, y] of [[0, 0], [50, 135], [100, 269], [380, 10], [430, 135], [479, 269]] as const) {
      expect(px(s, x, y)).toEqual([0, 0, 0])
    }
    // Image entière : centre et bords haut/bas de l'image sont rouges.
    for (const [x, y] of [[240, 135], [110, 2], [370, 267]] as const) {
      const [r, g] = px(s, x, y)
      expect(r).toBeGreaterThan(200)
      expect(g).toBeLessThan(50)
    }
  })

  it('full_contain_with_message_draws_no_text', async () => {
    const withMsg = createSurface()
    const without = createSurface()
    const image = redSquareJpeg()
    await paint(withMsg, { kind: 'full', image, message: 'Texte', stale: false, offline: false, fit: 'contain' })
    await paint(without, { kind: 'full', image, message: null, stale: false, offline: false, fit: 'contain' })
    expect(Buffer.from(withMsg.ctx.getImageData(0, 0, 480, 270).data).equals(Buffer.from(without.ctx.getImageData(0, 0, 480, 270).data))).toBe(true)
  })


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

describe('painters (corrections)', () => {
  it('missing_tile_uses_unavailable_background', async () => {
    const s = createSurface()
    await paint(s, withKey0(tile({ state: 'missing' })))
    expect(px(s, 64, 4)).toEqual([0x3a, 0x3a, 0x3a])
  })
  it('key_tile_has_no_level_bar', async () => {
    const s = createSurface()
    await paint(s, withKey0(tile({ level: 0.6 })))
    expect(px(s, 64, 87)).toEqual([255, 179, 0])
    expect(px(s, 70, 87)).toEqual([255, 179, 0])
  })
  it('strip_bar_ends_at_round_level_52', async () => {
    const s = createSurface()
    await paint(s, grid({ left: [EMPTY_TILE, tile({ level: 0.6 }), EMPTY_TILE] }))
    expect(px(s, 4 + 30, 177)).toEqual([255, 255, 255])
    expect(px(s, 4 + 31, 177)).not.toEqual([255, 255, 255])
  })
  it('full_image_with_message_draws_no_text', async () => {
    const withMsg = createSurface()
    const without = createSurface()
    const image = redJpeg()
    await paint(withMsg, { kind: 'full', image, message: 'Texte', stale: false, offline: false })
    await paint(without, { kind: 'full', image, message: null, stale: false, offline: false })
    const a = withMsg.ctx.getImageData(0, 240, 480, 30).data
    const b = without.ctx.getImageData(0, 240, 480, 30).data
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })
  it('empty_tile_with_label_draws_text_inside_tile', async () => {
    const s = createSurface()
    await paint(s, grid({ keys: [{ ...EMPTY_TILE, label: 'Aucun thermostat' }, ...Array.from({ length: 11 }, () => EMPTY_TILE)] }))
    const inTile = s.ctx.getImageData(60, 0, 90, 90).data
    let lit = 0
    for (let i = 0; i < inTile.length; i += 4) if (inTile[i]! + inTile[i + 1]! + inTile[i + 2]! > 0) lit++
    expect(lit).toBeGreaterThan(20)
    const next = s.ctx.getImageData(150, 0, 90, 90).data
    expect(next.every((v, i) => i % 4 === 3 || v === 0)).toBe(true)
  })
  it('empty_tile_without_label_stays_black', async () => {
    const s = createSurface()
    await paint(s, grid())
    const all = s.ctx.getImageData(60, 0, 90, 90).data
    expect(all.every((v, i) => i % 4 === 3 || v === 0)).toBe(true)
  })
})

describe('painters (aucun texte sur une frontière de case)', () => {
  const VX = [60, 150, 240, 330, 420]
  const HY = [90, 180]
  /** Pixels des bandes de 2 px centrées sur les frontières, filtrés par `keep` (r,g,b). */
  function boundaryHits(s: Surface, keep: (r: number, g: number, b: number) => boolean): string[] {
    const hits: string[] = []
    const d = s.ctx.getImageData(0, 0, 480, 270).data
    const test = (x: number, y: number) => {
      const i = (y * 480 + x) * 4
      if (keep(d[i]!, d[i + 1]!, d[i + 2]!)) hits.push(`${x},${y}`)
    }
    for (const bx of VX) for (const x of [bx - 1, bx]) for (let y = 0; y < 270; y++) test(x, y)
    for (const by of HY) for (const y of [by - 1, by]) for (let x = 60; x < 420; x++) test(x, y)
    return hits
  }
  const nonBlack = (r: number, g: number, b: number) => r + g + b > 0
  // Les fonds de tuile colorés touchent légitimement les frontières : sur les grilles on ne
  // regarde que les pixels clairs (luminance > 128), c'est-à-dire le texte sur fond sombre.
  const light = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b > 128

  const weather: WeatherView = {
    kind: 'weather',
    current: { icon: 'mdi:weather-sunny', temperature: '19,5 °C', apparent: 'Ressenti 18,0 °C', condition: 'Ensoleillé avec quelques passages nuageux' },
    days: Array.from({ length: 8 }, (_, i) => ({ label: `Lun ${i}`, icon: 'mdi:weather-cloudy', high: '20°', low: '10°' })),
    message: null,
    offline: false,
  }
  const msg = 'Aucune entité météo configurée dans la configuration'
  const darkTile = tile({ state: 'off', label: 'Un libellé extrêmement long qui déborde', valueText: 'Valeur très très longue' })

  it('weather_current_and_days_stay_off_borders', async () => {
    const s = createSurface()
    await paint(s, weather)
    expect(boundaryHits(s, nonBlack)).toEqual([])
  })
  it('weather_message_stays_off_borders', async () => {
    const s = createSurface()
    await paint(s, { ...weather, current: null, days: [], message: msg })
    expect(boundaryHits(s, nonBlack)).toEqual([])
  })
  it('full_message_stays_off_borders', async () => {
    const s = createSurface()
    await paint(s, { kind: 'full', image: null, message: msg, stale: false, offline: false })
    expect(boundaryHits(s, nonBlack)).toEqual([])
  })
  it('offline_grid_text_stays_off_borders', async () => {
    const s = createSurface()
    const keys = Array.from({ length: 12 }, () => darkTile)
    const strip = [darkTile, darkTile, darkTile]
    await paint(s, grid({ keys, left: strip, right: strip, offline: true }))
    expect(boundaryHits(s, light)).toEqual([])
  })
  it('weather_message_is_inside_key5', async () => {
    const s = createSurface()
    await paint(s, { ...weather, current: null, days: [], message: msg })
    const d = s.ctx.getImageData(0, 0, 480, 270).data
    const k = keyRect(5)
    let lit = 0
    for (let y = 0; y < 270; y++) for (let x = 0; x < 480; x++) {
      const i = (y * 480 + x) * 4
      if (d[i]! + d[i + 1]! + d[i + 2]! === 0) continue
      lit++
      expect(x >= k.x + 4 && x < k.x + k.width - 4 && y >= k.y + 4 && y < k.y + k.height - 4).toBe(true)
    }
    expect(lit).toBeGreaterThan(50)
  })
  it('weather_current_one_item_per_key', async () => {
    const s = createSurface()
    await paint(s, { ...weather, days: [] })
    for (let i = 0; i < 4; i++) {
      const k = keyRect(i)
      const d = s.ctx.getImageData(k.x, k.y, k.width, k.height).data
      let lit = 0
      for (let j = 0; j < d.length; j += 4) if (d[j]! + d[j + 1]! + d[j + 2]! > 0) lit++
      expect(lit).toBeGreaterThan(20)
    }
  })
})
