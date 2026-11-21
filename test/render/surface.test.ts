import { describe, it, expect } from 'vitest'
import { createSurface, toRgb565, toPng } from '../../src/render/surface.js'
import { keyRect } from '../../src/device/regions.js'

function pixel(color: string): number[] {
  const s = createSurface()
  s.ctx.fillStyle = color
  s.ctx.fillRect(0, 0, 1, 1)
  return [...toRgb565(s, { x: 0, y: 0, width: 1, height: 1 })]
}

describe('surface', () => {
  it('convertit en RGB565 little-endian', () => {
    expect(pixel('#ff0000')).toEqual([0x00, 0xf8])
    expect(pixel('#00ff00')).toEqual([0xe0, 0x07])
    expect(pixel('#0000ff')).toEqual([0x1f, 0x00])
    expect(pixel('#ffffff')).toEqual([0xff, 0xff])
    expect(pixel('#000000')).toEqual([0x00, 0x00])
  })
  it('fond noir et longueur w*h*2', () => {
    const b = toRgb565(createSurface(), keyRect(0))
    expect(b.length).toBe(90 * 90 * 2)
    expect(b.every(v => v === 0)).toBe(true)
  })
  it('lit un rectangle décalé', () => {
    const s = createSurface()
    s.ctx.fillStyle = '#ff0000'
    s.ctx.fillRect(60, 0, 1, 1)
    const b = toRgb565(s, { x: 59, y: 0, width: 3, height: 1 })
    expect([...b]).toEqual([0, 0, 0x00, 0xf8, 0, 0])
  })
  it('produit un PNG', async () => {
    expect((await toPng(createSurface())).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })
})
