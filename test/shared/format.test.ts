import { describe, it, expect } from 'vitest'
import { formatTemp, formatPct, CONDITION_LABELS, HVAC_LABELS } from '../../src/shared/format.js'

describe('format', () => {
  it('formatTemp', () => {
    expect(formatTemp(19.5)).toBe('19,5 °C')
    expect(formatTemp(21)).toBe('21,0 °C')
    expect(formatTemp(null)).toBe('—')
    expect(formatTemp(undefined)).toBe('—')
    expect(formatTemp(NaN)).toBe('—')
  })
  it('formatPct', () => {
    expect(formatPct(60)).toBe('60 %')
    expect(formatPct(59.6)).toBe('60 %')
  })
  it('labels', () => {
    expect(Object.keys(CONDITION_LABELS)).toHaveLength(15)
    expect(CONDITION_LABELS.partlycloudy).toBe('Partiellement nuageux')
    expect(HVAC_LABELS.heat).toBe('Chauffage')
  })
})
