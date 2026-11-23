import { describe, expect, it } from 'vitest'
import { formatAge, formatClock, formatSpan, formatTemplate, formatUpdated } from '../../src/shared/format.js'

const sp = (s: string) => s.replace(/\s/g, ' ')

describe('formats ajoutés', () => {
  it('template', () => {
    expect(sp(formatTemplate('{valeur} {unité}', '1240.4', 'W', 'Conso', 0))).toBe('1 240 W')
    expect(formatTemplate('{nom} : {valeur}', 'on', null, 'Porte', 0)).toBe('Porte : on')
    expect(formatTemplate('{valeur}{unité}', '21.44', '°', 'x', 1)).toBe('21,4°')
  })
  it('age', () => {
    expect(formatAge(7_400)).toBe('7 s')
    expect(formatAge(65_000)).toBe('1 min 05 s')
    expect(formatAge(3_720_000)).toBe('1 h 02 min')
    expect(formatAge(-5)).toBe('0 s')
  })
  it('span, updated, clock', () => {
    expect(formatSpan(45 * 60_000)).toBe('45 min')
    expect(formatSpan(6 * 3_600_000)).toBe('6 h')
    expect(sp(formatUpdated(new Date('2026-11-22T22:48:00')))).toBe('22 nov., 22 h 48')
    expect(formatClock('date', new Date('2026-11-22T10:00:00'))).toEqual({ big: '22 nov.', sub: 'dimanche' })
  })
})
