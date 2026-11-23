import { describe, it, expect } from 'vitest'
import { normalizeInput } from '../../src/device/input.js'

describe('normalizeInput', () => {
  it('traduit les boutons ronds et ignore les relâchements', () => {
    expect(normalizeInput('down', { id: 3 })).toEqual({ type: 'button', id: 3 })
    expect(normalizeInput('up', { id: 3 })).toBeNull()
  })

  it('traduit les appuis de molette et ignore knobCT', () => {
    expect(normalizeInput('down', { id: 'knobCL' })).toEqual({ type: 'knobPress', knob: 'knobCL' })
    expect(normalizeInput('down', { id: 'knobCT' })).toBeNull()
  })

  it('traduit les rotations', () => {
    expect(normalizeInput('rotate', { id: 'knobTR', delta: -1 })).toEqual({ type: 'knobTurn', knob: 'knobTR', delta: -1 })
    expect(normalizeInput('rotate', { id: 'knobCT', delta: 1 })).toBeNull()
  })

  it('traduit un toucher de bande en zone', () => {
    expect(normalizeInput('touchstart', { changedTouches: [{ x: 30, y: 200, id: 1, target: { screen: 'left' } }] }))
      .toEqual({ type: 'tap', target: { kind: 'strip', side: 'left', zone: 2 } })
    expect(normalizeInput('touchstart', { changedTouches: [{ x: 450, y: 10, id: 1, target: { screen: 'right' } }] }))
      .toEqual({ type: 'tap', target: { kind: 'strip', side: 'right', zone: 0 } })
  })

  it('borne la zone à 2 pour y = 270', () => {
    expect(normalizeInput('touchstart', { changedTouches: [{ x: 30, y: 270, id: 1, target: { screen: 'left' } }] }))
      .toEqual({ type: 'tap', target: { kind: 'strip', side: 'left', zone: 2 } })
  })

  it('traduit un toucher de touche', () => {
    expect(normalizeInput('touchstart', { changedTouches: [{ x: 150, y: 100, id: 1, target: { screen: 'center', key: 5 } }] }))
      .toEqual({ type: 'tap', target: { kind: 'key', index: 5 } })
  })

  it('traduit une fin de toucher (appui court ou long)', () => {
    expect(normalizeInput('touchend', { changedTouches: [{ x: 30, y: 10, id: 1, target: { screen: 'left' } }] }))
      .toEqual({ type: 'release', target: { kind: 'strip', side: 'left', zone: 0 } })
    expect(normalizeInput('touchend', { changedTouches: [] })).toBeNull()
  })

  it('ignore les mouvements et charges vides', () => {
    expect(normalizeInput('touchmove', { changedTouches: [] })).toBeNull()
    expect(normalizeInput('touchstart', { changedTouches: [] })).toBeNull()
    expect(normalizeInput('touchstart', undefined)).toBeNull()
    expect(normalizeInput('down', undefined)).toBeNull()
  })
})
