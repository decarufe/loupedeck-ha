import { describe, expect, it } from 'vitest'
import { alertCandidates, alertLabel, defaultAlertSensors } from '../../src/shared/alerts.js'
import type { EntityInfo } from '../../src/shared/placement.js'

const ent = (entityId: string, o: Partial<EntityInfo> = {}): EntityInfo => ({
  entityId, name: entityId.split('.')[1]!, domain: entityId.split('.')[0]!, areaName: null, state: 'off',
  dimmable: false, deviceClass: 'motion', icon: null, deviceId: 'dev1', ...o,
})
const cam = ent('camera.a', { deviceClass: null })
const person = ent('binary_sensor.a_person_detected')
const pkg = ent('binary_sensor.a_package_detected')
const vehicle = ent('binary_sensor.a_vehicle_detected')
const animal = ent('binary_sensor.a_animal_detected')
const all = [cam, vehicle, animal, person, pkg, ent('binary_sensor.b_person_detected', { deviceId: 'dev2' }),
  ent('binary_sensor.porte', { deviceClass: 'door' }), ent('sensor.x', { deviceClass: 'motion' })]

describe('alertCandidates', () => {
  it('keeps motion binary sensors of the same device, sorted by name', () => {
    expect(alertCandidates('camera.a', all).map((e) => e.entityId)).toEqual([
      'binary_sensor.a_animal_detected', 'binary_sensor.a_package_detected', 'binary_sensor.a_person_detected', 'binary_sensor.a_vehicle_detected',
    ])
  })
  it('is empty without a known camera or device', () => {
    expect(alertCandidates(null, all)).toEqual([])
    expect(alertCandidates('camera.inconnue', all)).toEqual([])
    expect(alertCandidates('camera.a', [ent('camera.a', { deviceId: null }), person])).toEqual([])
  })
  it('accepts occupancy and presence classes', () => {
    expect(alertCandidates('camera.a', [cam, ent('binary_sensor.o', { deviceClass: 'occupancy' }), ent('binary_sensor.p', { deviceClass: 'presence' })])).toHaveLength(2)
  })
})

describe('defaultAlertSensors', () => {
  it('prefers person and package', () => {
    expect(defaultAlertSensors([animal, person, pkg, vehicle])).toEqual(['binary_sensor.a_package_detected', 'binary_sensor.a_person_detected'])
  })
  it('falls back to every candidate', () => {
    expect(defaultAlertSensors([ent('binary_sensor.b_motion')])).toEqual(['binary_sensor.b_motion'])
  })
})

describe('alertLabel', () => {
  it('names the usual classes', () => {
    expect([person, pkg, vehicle, animal].map(alertLabel).sort()).toEqual(['Animal', 'Colis', 'Personne', 'Véhicule'])
    expect(alertLabel(ent('binary_sensor.b_motion'))).toBe('Mouvement')
  })
  it('falls back to the entity name', () => {
    expect(alertLabel(ent('binary_sensor.portail'))).toBe('portail')
  })
})
