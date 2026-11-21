import { describe, it, expect } from 'vitest'
import { canPlace, isDimmable, type EntityInfo } from '../../src/shared/placement.js'

function ent(o: Partial<EntityInfo>): EntityInfo {
  return { entityId: 'x.y', name: 'Test', domain: 'light', areaName: null, state: 'on', dimmable: true, deviceClass: null, icon: null, ...o }
}

describe('isDimmable', () => {
  it('lit les modes de couleur', () => {
    expect(isDimmable({ supported_color_modes: ['onoff'] })).toBe(false)
    expect(isDimmable({ supported_color_modes: ['brightness'] })).toBe(true)
    expect(isDimmable({ supported_color_modes: ['onoff', 'color_temp'] })).toBe(true)
  })
  it('une lampe éteinte (brightness null) sans modes n\'est pas gradable', () => {
    expect(isDimmable({ brightness: null })).toBe(false)
    expect(isDimmable({})).toBe(false)
  })
  it('brightness numérique implique gradable', () => {
    expect(isDimmable({ brightness: 128 })).toBe(true)
  })
})

describe('canPlace', () => {
  it('key', () => {
    expect(canPlace('key', ent({ domain: 'switch' })).ok).toBe(true)
    expect(canPlace('key', ent({ domain: 'light' })).ok).toBe(true)
    const r = canPlace('key', ent({ domain: 'sensor' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0)
  })
  it('dimmer', () => {
    expect(canPlace('dimmer', ent({ domain: 'light', dimmable: true })).ok).toBe(true)
    expect(canPlace('dimmer', ent({ domain: 'light', dimmable: false })))
      .toEqual({ ok: false, reason: "Cette lumière n'est pas gradable : placez-la sur une touche centrale." })
    expect(canPlace('dimmer', ent({ domain: 'switch' })).ok).toBe(false)
  })
  it('climate, sensor, weather, camera', () => {
    expect(canPlace('climate', ent({ domain: 'climate' })).ok).toBe(true)
    expect(canPlace('climate', ent({ domain: 'light' })).ok).toBe(false)
    expect(canPlace('sensor', ent({ domain: 'sensor', deviceClass: 'temperature' })).ok).toBe(true)
    expect(canPlace('sensor', ent({ domain: 'sensor', deviceClass: 'humidity' })).ok).toBe(false)
    expect(canPlace('sensor', ent({ domain: 'light' })).ok).toBe(false)
    expect(canPlace('weather', ent({ domain: 'weather' })).ok).toBe(true)
    expect(canPlace('weather', ent({ domain: 'light' })).ok).toBe(false)
    expect(canPlace('camera', ent({ domain: 'camera' })).ok).toBe(true)
    expect(canPlace('camera', ent({ domain: 'light' })).ok).toBe(false)
  })
})
