import { describe, it, expect } from 'vitest'
import { REGIONS, SCREEN, keyRect, stripZoneRect } from '../../src/device/regions.js'

describe('regions', () => {
  it('calcule les rectangles de touches', () => {
    expect(keyRect(0)).toEqual({ x: 60, y: 0, width: 90, height: 90 })
    expect(keyRect(5)).toEqual({ x: 150, y: 90, width: 90, height: 90 })
    expect(keyRect(11)).toEqual({ x: 330, y: 180, width: 90, height: 90 })
  })
  it('calcule les zones de bande', () => {
    expect(stripZoneRect('right', 2)).toEqual({ x: 420, y: 180, width: 60, height: 90 })
    expect(stripZoneRect('left', 1)).toEqual({ x: 0, y: 90, width: 60, height: 90 })
  })
  it('expose 14 régions', () => {
    expect(Object.keys(REGIONS)).toHaveLength(14)
    expect(REGIONS.key3).toEqual(keyRect(3))
    expect(REGIONS.stripL).toEqual({ x: 0, y: 0, width: 60, height: 270 })
    expect(REGIONS.stripR).toEqual({ x: 420, y: 0, width: 60, height: 270 })
    expect(SCREEN).toEqual({ x: 0, y: 0, width: 480, height: 270 })
  })
})
