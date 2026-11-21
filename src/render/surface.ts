import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas'
import { SCREEN, type Rect } from '../device/regions.js'

export interface Surface { canvas: Canvas; ctx: SKRSContext2D }

export function createSurface(): Surface {
  const canvas = createCanvas(SCREEN.width, SCREEN.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, SCREEN.width, SCREEN.height)
  return { canvas, ctx }
}

/** Convertit un rectangle de la surface en RGB565 little-endian (w*h*2 octets). */
export function toRgb565(s: Surface, r: Rect): Buffer {
  const { data } = s.ctx.getImageData(r.x, r.y, r.width, r.height)
  const n = r.width * r.height
  const out = Buffer.allocUnsafe(n * 2)
  for (let i = 0, j = 0, p = 0; i < n; i++, p += 4, j += 2) {
    const v = ((data[p]! >> 3) << 11) | ((data[p + 1]! >> 2) << 5) | (data[p + 2]! >> 3)
    out[j] = v & 0xff
    out[j + 1] = v >> 8
  }
  return out
}

export function toPng(s: Surface): Promise<Buffer> {
  return s.canvas.encode('png')
}
