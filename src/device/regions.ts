export interface Rect { x: number; y: number; width: number; height: number }
export type RegionId = `key${number}` | 'stripL' | 'stripR'

export const SCREEN: Rect = { x: 0, y: 0, width: 480, height: 270 }

export function keyRect(i: number): Rect {
  return { x: 60 + (i % 4) * 90, y: Math.floor(i / 4) * 90, width: 90, height: 90 }
}

export function stripZoneRect(side: 'left' | 'right', zone: 0 | 1 | 2): Rect {
  return { x: side === 'left' ? 0 : 420, y: zone * 90, width: 60, height: 90 }
}

function buildRegions(): Record<RegionId, Rect> {
  const r: Record<string, Rect> = {}
  for (let i = 0; i < 12; i++) r[`key${i}`] = keyRect(i)
  r.stripL = { x: 0, y: 0, width: 60, height: 270 }
  r.stripR = { x: 420, y: 0, width: 60, height: 270 }
  return r as Record<RegionId, Rect>
}

export const REGIONS: Record<RegionId, Rect> = buildRegions()
