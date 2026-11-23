/**
 * Dessine l'icône de Loupedeck HA et écrit build/icon.ico (entrées PNG de 16 à 256 px) et build/icon.png.
 * Usage : pnpm run icon
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const HA_BLUE = '#18BCF2'
const ACCENT = '#FFB300'

/** Une console vue de face : boîtier sombre arrondi, grille de 2 × 2 touches (une allumée en ambre). */
function draw(size: number): Buffer {
  const c = createCanvas(size, size)
  const g = c.getContext('2d')
  const r = (x: number, y: number, w: number, h: number, rad: number) => {
    g.beginPath()
    g.roundRect(x, y, w, h, rad)
    g.fill()
  }
  const u = size / 16
  g.fillStyle = '#1E2A33'
  r(0.5 * u, 0.5 * u, 15 * u, 15 * u, 3.2 * u)
  const pad = 2.6 * u
  const gap = 1.6 * u
  const key = (size - 2 * pad - gap) / 2
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      g.fillStyle = row === 0 && col === 1 ? ACCENT : HA_BLUE
      r(pad + col * (key + gap), pad + row * (key + gap), key, key, 1.4 * u)
    }
  }
  return c.toBuffer('image/png')
}

/** Conteneur ICO avec des images PNG (pris en charge depuis Windows Vista). */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries: Buffer[] = []
  let offset = 6 + 16 * pngs.length
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build')
fs.mkdirSync(outDir, { recursive: true })
const pngs = SIZES.map((size) => ({ size, data: draw(size) }))
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico(pngs))
fs.writeFileSync(path.join(outDir, 'icon.png'), pngs[pngs.length - 1]!.data)
console.log(`Icône écrite dans ${outDir}`)
