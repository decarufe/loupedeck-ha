import { loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import { SCREEN, keyRect, stripZoneRect, type Rect } from '../device/regions.js'
import { drawIcon } from './icons.js'
import type { Surface } from './surface.js'
import { EMPTY_TILE, type CameraAge, type FullView, type GraphView, type GridView, type KnobHint, type TileView, type View, type WeatherView } from '../views.js'

export const COLORS = { off: '#202020', empty: '#000000', unavailable: '#3A3A3A', bar: '#FFFFFF' } as const

const FONT = '"Segoe UI", sans-serif'
const GRAY = '#8A8A8A'
const LIGHT = '#E6E6E6'

export async function paint(s: Surface, v: View): Promise<void> {
  switch (v.kind) {
    case 'grid': paintGrid(s, v); break
    case 'weather': paintWeather(s, v); break
    case 'full': await paintFull(s, v); break
    case 'graph': paintGraph(s, v); break
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
  const dim = t.state === 'missing' || t.state === 'unavailable'
  const bg = t.state === 'on' ? t.accent : dim ? COLORS.unavailable : t.tint ? mix(t.tint, COLORS.off, 0.28) : COLORS.off
  ctx.fillStyle = bg
  ctx.fillRect(r.x, r.y, r.width, r.height)

  const fg = dim ? GRAY : t.state === 'on' ? (isLight(t.accent) ? '#000000' : '#FFFFFF') : LIGHT
  const cx = r.x + r.width / 2
  const maxW = r.width - 6
  if (!dim && t.layout === 'big') {
    paintBigTile(ctx, r, t, compact, fg)
    paintPending(ctx, r, t)
    return
  }
  if (!dim && t.layout === 'graph') {
    paintGraphTile(ctx, r, t, compact, fg)
    paintPending(ctx, r, t)
    return
  }
  const iconSize = compact ? 28 : 36
  const iconY = r.y + 8
  if (t.icon) drawIcon(ctx, t.icon, cx - iconSize / 2, iconY, iconSize, fg)

  const labelY = iconY + iconSize + (compact ? 10 : 11)
  const labelColor = t.tint && !dim ? t.tint : fg
  if (t.label) drawText(ctx, t.label, cx, labelY, maxW, `${t.tint ? 'bold ' : ''}${compact ? 10 : 12}px ${FONT}`, labelColor, 'center')
  if (t.valueText) drawText(ctx, t.valueText, cx, labelY + (compact ? 14 : 17), maxW, `bold ${compact ? 12 : 14}px ${FONT}`, fg, 'center')

  if (compact && t.level !== null) {
    const full = r.width - 8
    const by = r.y + r.height - 6
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(r.x + 4, by, full, 6)
    ctx.fillStyle = COLORS.bar
    ctx.fillRect(r.x + 4, by, Math.round(Math.min(1, Math.max(0, t.level)) * full), 6)
  }

  if (t.confirm) {
    ctx.save()
    ctx.strokeStyle = GRAY
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(r.x + r.width - 9, r.y + 9, 4, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  paintPending(ctx, r, t)
}

function paintPending(ctx: SKRSContext2D, r: Rect, t: TileView): void {
  if (!t.pending) return
  ctx.save()
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = 2
  ctx.setLineDash([5, 4])
  ctx.strokeRect(r.x + 1, r.y + 1, r.width - 2, r.height - 2)
  ctx.restore()
}

/** Couleur `a` mélangée à `b` (part de `a` : `k`). */
function mix(a: string, b: string, k: number): string {
  const p = (h: string) => { const n = parseInt(h.replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255] }
  const [x, y] = [p(a), p(b)]
  return '#' + x.map((v, i) => Math.round(v * k + y[i]! * (1 - k)).toString(16).padStart(2, '0')).join('')
}

/** Police la plus grande (de `max` à `min`) pour que `text` tienne dans `maxW`. */
function fitFont(ctx: SKRSContext2D, text: string, maxW: number, max: number, min: number, weight = 'bold'): number {
  let size = max
  ctx.font = `${weight} ${size}px ${FONT}`
  while (size > min && ctx.measureText(text).width > maxW) {
    size -= 1
    ctx.font = `${weight} ${size}px ${FONT}`
  }
  return size
}

/** Touche Valeur ou Date et heure : libellé en haut, valeur en grand au centre, ligne secondaire dessous, barre de couleur en bas. */
function paintBigTile(ctx: SKRSContext2D, r: Rect, t: TileView, compact: boolean, fg: string): void {
  const cx = r.x + r.width / 2
  const maxW = r.width - 8
  const big = t.valueText ?? ''
  const size = fitFont(ctx, big, maxW, compact ? 18 : 26, 9)
  const hasLabel = Boolean(t.label)
  const cy = r.y + r.height / 2 + (hasLabel && !t.sub ? 4 : 0)
  if (hasLabel) drawText(ctx, t.label, cx, r.y + (compact ? 14 : 16), maxW, `${compact ? 9 : 11}px ${FONT}`, GRAY, 'center')
  drawText(ctx, big, cx, cy, maxW, `bold ${size}px ${FONT}`, fg, 'center')
  if (t.sub) drawText(ctx, t.sub, cx, cy + size / 2 + (compact ? 9 : 11), maxW, `${compact ? 9 : 11}px ${FONT}`, GRAY, 'center')
  ctx.fillStyle = t.accent
  ctx.fillRect(r.x, r.y + r.height - 4, r.width, 4)
}

/** Touche Graphique : libellé et valeur en haut à gauche, courbe sur la moitié basse. */
function paintGraphTile(ctx: SKRSContext2D, r: Rect, t: TileView, compact: boolean, fg: string): void {
  const x = r.x + 6
  const maxW = r.width - 12
  ctx.textAlign = 'left'
  drawText(ctx, t.label, x, r.y + 12, maxW, `bold ${compact ? 9 : 11}px ${FONT}`, fg, 'left')
  drawText(ctx, t.valueText ?? '', x, r.y + 30, maxW, `bold ${compact ? 13 : 17}px ${FONT}`, fg, 'left')
  if (t.sub) drawText(ctx, t.sub, x, r.y + 45, maxW, `${compact ? 8 : 10}px ${FONT}`, GRAY, 'left')
  const vals = t.spark?.values ?? []
  if (vals.length < 2) return
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = hi - lo || 1
  const top = r.y + r.height * 0.55
  const bottom = r.y + r.height - 3
  const px = (i: number) => r.x + (i / (vals.length - 1)) * r.width
  const py = (v: number) => bottom - ((v - lo) / span) * (bottom - top)
  ctx.save()
  ctx.beginPath()
  vals.forEach((v, i) => (i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v))))
  if (t.spark!.style === 'area') {
    ctx.lineTo(r.x + r.width, r.y + r.height)
    ctx.lineTo(r.x, r.y + r.height)
    ctx.closePath()
    ctx.globalAlpha = 0.28
    ctx.fillStyle = t.accent
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.beginPath()
    vals.forEach((v, i) => (i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v))))
  }
  ctx.strokeStyle = t.accent
  ctx.lineWidth = 1.6
  ctx.stroke()
  ctx.restore()
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

  if (v.updated) paintUpdated(ctx, stripZoneRect('right', 0), v.updated)

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

/** Zone haut droite de la météo : date et heure de la dernière mise à jour, et le bouton Actualiser. */
function paintUpdated(ctx: SKRSContext2D, r: Rect, u: { text: string; busy: boolean }): void {
  ctx.fillStyle = '#16181C'
  ctx.fillRect(r.x + 2, r.y + 2, r.width - 4, r.height - 4)
  const cx = r.x + r.width / 2
  drawText(ctx, u.busy ? 'Actualisation' : 'Mise à jour', cx, r.y + 14, r.width - 6, `9px ${FONT}`, GRAY, 'center')
  const [day, time] = u.text.includes(', ') ? u.text.split(', ') : [u.text, '']
  drawText(ctx, day ?? '', cx, r.y + 32, r.width - 6, `bold 11px ${FONT}`, LIGHT, 'center')
  if (time) drawText(ctx, time, cx, r.y + 47, r.width - 6, `bold 11px ${FONT}`, LIGHT, 'center')
  drawIcon(ctx, 'mdi:refresh', cx - 10, r.y + 58, 20, u.busy ? '#4FC3F7' : GRAY)
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
  // Image figée : la couleur de la tuile compteur le signale (plus de passage en niveaux de gris) ; hors ligne : gris.
  if (v.offline) desaturate(s)
  if (v.age) paintCameraAge(ctx, stripZoneRect('left', 0), v.age)
}

const AGE_COLORS = { ok: '#66BB6A', warn: '#FFB300', bad: '#EF5350', busy: '#4FC3F7' } as const

/** Tuile haut gauche d'une caméra : temps écoulé depuis la dernière image, couleur selon l'âge. */
function paintCameraAge(ctx: SKRSContext2D, r: Rect, a: CameraAge): void {
  const c = a.busy ? AGE_COLORS.busy : AGE_COLORS[a.level]
  const x = r.x + 3
  const y = r.y + 3
  const w = r.width - 6
  const h = r.height - 6
  ctx.save()
  ctx.globalAlpha = 0.85
  ctx.fillStyle = a.level === 'bad' && !a.busy ? mix(AGE_COLORS.bad, '#0E1014', 0.25) : '#0E1014'
  ctx.fillRect(x, y, w, h)
  ctx.restore()
  ctx.save()
  ctx.strokeStyle = c
  ctx.lineWidth = 2
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
  ctx.restore()
  const cx = r.x + r.width / 2
  const label = a.busy === 'reload' ? 'Recharge' : a.busy === 'refresh' ? 'Image…' : 'Dernière'
  drawText(ctx, label, cx, y + 14, w - 4, `9px ${FONT}`, '#AAB2BD', 'center')
  if (!a.busy) drawText(ctx, 'image', cx, y + 25, w - 4, `9px ${FONT}`, '#AAB2BD', 'center')
  const size = fitFont(ctx, a.text, w - 6, 15, 8)
  drawText(ctx, a.text, cx, y + 46, w - 6, `bold ${size}px ${FONT}`, c, 'center')
  drawIcon(ctx, 'mdi:refresh', cx - 8, y + h - 21, 16, '#AAB2BD')
}

// ---------- graphique plein écran ----------

function paintHint(ctx: SKRSContext2D, r: Rect, h: KnobHint): void {
  const cx = r.x + r.width / 2
  drawText(ctx, h.glyph, cx, r.y + 26, r.width - 4, `bold 20px ${FONT}`, '#4FC3F7', 'center')
  drawText(ctx, h.title, cx, r.y + 50, r.width - 4, `bold 10px ${FONT}`, LIGHT, 'center')
  drawText(ctx, h.sub, cx, r.y + 65, r.width - 4, `9px ${FONT}`, GRAY, 'center')
}

function paintGraph(s: Surface, v: GraphView): void {
  const { ctx } = s
  ctx.fillStyle = COLORS.empty
  ctx.fillRect(0, 0, SCREEN.width, SCREEN.height)
  const X0 = 100
  const X1 = 412
  const Y0 = 50
  const Y1 = 236
  drawText(ctx, v.title, X0, 16, 200, `bold 14px ${FONT}`, '#FFFFFF', 'left')
  ctx.font = `bold 18px ${FONT}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#FFFFFF'
  ctx.fillText(fit(ctx, v.valueText, 120), X1, 17)
  drawText(ctx, v.subtitle, X0, 35, X1 - X0, `10px ${FONT}`, GRAY, 'left')

  for (const [id, h] of Object.entries(v.hints)) {
    if (!h) continue
    const side = id[0] === 'L' ? 'left' : 'right'
    paintHint(ctx, stripZoneRect(side, Number(id[1]) as 0 | 1 | 2), h)
  }

  if (v.message) {
    paintWrapped(ctx, { x: X0, y: Y0, width: X1 - X0, height: Y1 - Y0 }, v.message, 13, LIGHT)
  } else {
    const px = (t: number) => X0 + ((t - v.start) / (v.end - v.start)) * (X1 - X0)
    const py = (val: number) => Y1 - ((val - v.lo) / (v.hi - v.lo)) * (Y1 - Y0)
    ctx.save()
    for (let k = 0; k <= 4; k++) {
      const val = v.lo + (k * (v.hi - v.lo)) / 4
      const y = Math.round(py(val)) + 0.5
      ctx.strokeStyle = '#2A2E35'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(X0, y)
      ctx.lineTo(X1, y)
      ctx.stroke()
      ctx.font = `9px ${FONT}`
      ctx.fillStyle = '#8B939E'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(new Intl.NumberFormat('fr-CA', { minimumFractionDigits: v.decimals, maximumFractionDigits: v.decimals }).format(val), X0 - 5, y)
    }
    ctx.beginPath()
    ctx.rect(X0, Y0, X1 - X0, Y1 - Y0)
    ctx.clip()
    // Segments entre les points (comme les graphiques de capteurs de Home Assistant), prolongés jusqu'à la fin de la fenêtre.
    const pts = v.points
    const trace = () => {
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(px(p.t), py(p.v)) : ctx.lineTo(px(p.t), py(p.v))))
      ctx.lineTo(px(v.end), py(pts.at(-1)!.v))
    }
    ctx.beginPath()
    trace()
    ctx.lineTo(px(v.end), Y1)
    ctx.lineTo(px(pts[0]!.t), Y1)
    ctx.closePath()
    ctx.globalAlpha = 0.2
    ctx.fillStyle = v.color
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.beginPath()
    trace()
    ctx.strokeStyle = v.color
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()
    ctx.font = `9px ${FONT}`
    ctx.fillStyle = '#8B939E'
    ctx.textBaseline = 'middle'
    ;(['left', 'center', 'right'] as const).forEach((align, i) => {
      ctx.textAlign = align
      ctx.fillText(v.xLabels[i]!, align === 'left' ? X0 : align === 'right' ? X1 : (X0 + X1) / 2, Y1 + 12)
    })
  }
  // Position de la fenêtre dans l'historique chargé.
  ctx.fillStyle = '#2A2E35'
  ctx.fillRect(X0, 258, X1 - X0, 4)
  ctx.fillStyle = v.color
  ctx.fillRect(X0 + v.scroll.from * (X1 - X0), 258, Math.max(6, v.scroll.width * (X1 - X0)), 4)

  if (v.offline) {
    desaturate(s)
    offlineBadge(s)
  }
}
