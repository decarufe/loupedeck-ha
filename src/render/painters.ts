import { loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import { SCREEN, keyRect, stripZoneRect, type Rect } from '../device/regions.js'
import { drawIcon } from './icons.js'
import type { Surface } from './surface.js'
import { EMPTY_TILE, type FullView, type GridView, type TileView, type View, type WeatherView } from '../views.js'

export const COLORS = { off: '#202020', empty: '#000000', unavailable: '#3A3A3A', bar: '#FFFFFF' } as const

const FONT = '"Segoe UI", sans-serif'
const GRAY = '#8A8A8A'
const LIGHT = '#E6E6E6'

export async function paint(s: Surface, v: View): Promise<void> {
  switch (v.kind) {
    case 'grid': paintGrid(s, v); break
    case 'weather': paintWeather(s, v); break
    case 'full': await paintFull(s, v); break
  }
}

// ---------- utilitaires ----------

/** Tronque avec '…' pour tenir dans maxW (la police du contexte doit déjà être posée). */
function fit(ctx: SKRSContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid
    else hi = mid - 1
  }
  return lo === 0 ? '…' : text.slice(0, lo) + '…'
}

function drawText(ctx: SKRSContext2D, text: string, x: number, y: number, maxW: number, font: string, color: string, align: 'left' | 'center'): void {
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(fit(ctx, text, maxW), x, y)
}

function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1]!, 16)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150
}

/** Luminance sur tout l'écran : r === g === b partout après l'appel. */
function desaturate(s: Surface): void {
  const img = s.ctx.getImageData(0, 0, SCREEN.width, SCREEN.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!)
    d[i] = d[i + 1] = d[i + 2] = y
  }
  s.ctx.putImageData(img, 0, 0)
}

function offlineBadge(s: Surface): void {
  s.ctx.fillStyle = '#B00020'
  s.ctx.fillRect(0, 0, 60, 18)
  drawText(s.ctx, 'HA hors ligne', 30, 9, 58, `bold 8px ${FONT}`, '#FFFFFF', 'center')
}

// ---------- grille ----------

/** Texte replié dans une case : centré, au plus 3 lignes (césure aux espaces), chaque ligne tronquée avec « … ». */
function paintWrapped(ctx: SKRSContext2D, r: Rect, text: string, size: number, color: string): void {
  const maxW = r.width - 8
  ctx.font = `${size}px ${FONT}`
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word
    if (!cur || ctx.measureText(next).width <= maxW) cur = next
    else { lines.push(cur); cur = word }
  }
  if (cur) lines.push(cur)
  if (lines.length > 3) lines.splice(2, lines.length - 2, lines.slice(2).join(' '))
  const lh = size + 4
  const top = r.y + r.height / 2 - (lines.length * lh) / 2 + lh / 2
  lines.forEach((line, i) => drawText(ctx, line, r.x + r.width / 2, top + i * lh, maxW, `${size}px ${FONT}`, color, 'center'))
}

/** Libellé d'une tuile vide : gris, centré, replié. */
function paintEmptyLabel(ctx: SKRSContext2D, r: Rect, label: string, compact: boolean): void {
  paintWrapped(ctx, r, label, compact ? 10 : 12, '#9E9E9E')
}

function paintTile(ctx: SKRSContext2D, r: Rect, t: TileView, compact: boolean): void {
  if (t.state === 'empty') {
    ctx.fillStyle = COLORS.empty
    ctx.fillRect(r.x, r.y, r.width, r.height)
    if (t.label) paintEmptyLabel(ctx, r, t.label, compact)
    return
  }
  const bg = t.state === 'on' ? t.accent : t.state === 'unavailable' || t.state === 'missing' ? COLORS.unavailable : COLORS.off
  ctx.fillStyle = bg
  ctx.fillRect(r.x, r.y, r.width, r.height)

  const dim = t.state === 'missing' || t.state === 'unavailable'
  const fg = dim ? GRAY : t.state === 'on' ? (isLight(t.accent) ? '#000000' : '#FFFFFF') : LIGHT
  const cx = r.x + r.width / 2
  const maxW = r.width - 6
  const iconSize = compact ? 28 : 36
  const iconY = r.y + 8
  if (t.icon) drawIcon(ctx, t.icon, cx - iconSize / 2, iconY, iconSize, fg)

  const labelY = iconY + iconSize + (compact ? 10 : 11)
  if (t.label) drawText(ctx, t.label, cx, labelY, maxW, `${compact ? 10 : 12}px ${FONT}`, fg, 'center')
  if (t.valueText) drawText(ctx, t.valueText, cx, labelY + (compact ? 14 : 17), maxW, `bold ${compact ? 12 : 14}px ${FONT}`, fg, 'center')

  if (compact && t.level !== null) {
    const full = r.width - 8
    const by = r.y + r.height - 6
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(r.x + 4, by, full, 6)
    ctx.fillStyle = COLORS.bar
    ctx.fillRect(r.x + 4, by, Math.round(Math.min(1, Math.max(0, t.level)) * full), 6)
  }

  if (t.pending) {
    ctx.save()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 4])
    ctx.strokeRect(r.x + 1, r.y + 1, r.width - 2, r.height - 2)
    ctx.restore()
  }
}

function paintGrid(s: Surface, v: GridView): void {
  const { ctx } = s
  ctx.fillStyle = COLORS.empty
  ctx.fillRect(0, 0, SCREEN.width, SCREEN.height)
  for (let i = 0; i < 12; i++) paintTile(ctx, keyRect(i), v.keys[i] ?? EMPTY_TILE, false)
  const zones = [0, 1, 2] as const
  for (const z of zones) {
    paintTile(ctx, stripZoneRect('left', z), v.left[z] ?? EMPTY_TILE, true)
    paintTile(ctx, stripZoneRect('right', z), v.right[z] ?? EMPTY_TILE, true)
  }
  if (v.offline) {
    desaturate(s)
    offlineBadge(s)
  }
}

// ---------- météo ----------

function paintWeather(s: Surface, v: WeatherView): void {
  const { ctx } = s
  ctx.fillStyle = COLORS.empty
  ctx.fillRect(0, 0, SCREEN.width, SCREEN.height)

  // rangée 0 : une information par case (aucun texte à cheval sur une frontière)
  if (v.current) {
    const c = v.current
    const k0 = keyRect(0)
    drawIcon(ctx, c.icon, k0.x + (k0.width - 56) / 2, k0.y + (k0.height - 56) / 2, 56, '#FFFFFF')

    const k1 = keyRect(1)
    let size = 32
    ctx.font = `bold ${size}px ${FONT}`
    while (size > 12 && ctx.measureText(c.temperature).width > k1.width - 8) {
      size -= 2
      ctx.font = `bold ${size}px ${FONT}`
    }
    drawText(ctx, c.temperature, k1.x + k1.width / 2, k1.y + k1.height / 2, k1.width - 8, `bold ${size}px ${FONT}`, '#FFFFFF', 'center')

    paintWrapped(ctx, keyRect(2), c.condition, 13, LIGHT)

    if (c.apparent) {
      const k3 = keyRect(3)
      const cx = k3.x + k3.width / 2
      const value = c.apparent.replace(/^Ressenti\s*/i, '')
      drawText(ctx, 'Ressenti', cx, k3.y + 33, k3.width - 8, `12px ${FONT}`, GRAY, 'center')
      drawText(ctx, value, cx, k3.y + 55, k3.width - 8, `bold 14px ${FONT}`, LIGHT, 'center')
    }
  }

  if (v.message) {
    paintWrapped(ctx, keyRect(5), v.message, 12, LIGHT)
  } else {
    for (let i = 0; i < 8; i++) {
      const d = v.days[i]
      if (!d) continue
      const r = keyRect(4 + i)
      const cx = r.x + r.width / 2
      drawText(ctx, d.label, cx, r.y + 14, r.width - 6, `bold 13px ${FONT}`, LIGHT, 'center')
      drawIcon(ctx, d.icon, cx - 16, r.y + 26, 32, '#FFFFFF')
      drawText(ctx, d.high, cx, r.y + 68, r.width - 6, `bold 13px ${FONT}`, '#FFB300', 'center')
      drawText(ctx, d.low, cx, r.y + 82, r.width - 6, `12px ${FONT}`, '#7FB6FF', 'center')
    }
  }

  if (v.offline) {
    desaturate(s)
    offlineBadge(s)
  }
}

// ---------- plein écran ----------

async function paintFull(s: Surface, v: FullView): Promise<void> {
  const { ctx } = s
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, SCREEN.width, SCREEN.height)

  let drawn = false
  if (v.image) {
    try {
      const img = await loadImage(v.image)
      if (img && img.width > 0 && img.height > 0) {
        // cover : l'image remplit l'écran (bords rognés) ; contain : image entière, bandes noires (fond déjà noir).
        const scale = v.fit === 'contain' ? Math.min : Math.max
        const k = scale(SCREEN.width / img.width, SCREEN.height / img.height)
        const w = img.width * k
        const h = img.height * k
        ctx.drawImage(img, (SCREEN.width - w) / 2, (SCREEN.height - h) / 2, w, h)
        drawn = true
      }
    } catch {
      drawn = false
    }
  }

  if (!drawn) {
    paintWrapped(ctx, keyRect(5), v.message ?? 'Image non disponible', 12, '#FFFFFF')
  }
  if (v.stale || v.offline) desaturate(s)
}
