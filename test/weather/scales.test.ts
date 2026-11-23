import { describe, expect, it } from 'vitest'
import { formatCm, hourMarks, niceStep, precipAxis, tempAxis, tickValues } from '../../src/weather/scales.js'

describe('échelles du graphique météo', () => {
  it('nice_step_choisit_le_plus_petit_pas_qui_tient', () => {
    expect(niceStep(12, 15)).toBe(1)
    expect(niceStep(16, 15)).toBe(2)
    expect(niceStep(40, 15)).toBe(5)
    expect(niceStep(100, 15)).toBe(10)
    expect(niceStep(8, 10)).toBe(1)
    expect(niceStep(12, 10)).toBe(2)
    expect(niceStep(0, 10)).toBe(1)
  })

  it('temp_axis_encadre_les_courbes_avec_des_entiers', () => {
    expect(tempAxis(-2.4, 8.6)).toEqual({ lo: -3, hi: 9 })
    expect(tempAxis(5, 5)).toEqual({ lo: 4, hi: 6 })
    expect(tempAxis(5.2, 5.9)).toEqual({ lo: 4, hi: 6 })
    expect(tempAxis(6, 6)).toEqual({ lo: 5, hi: 7 })
  })

  it('temp_axis_contient_toujours_les_donnees_et_ecart_au_moins_2', () => {
    for (const [lo, hi] of [[-2.4, 8.6], [5, 5], [5.2, 5.9], [6, 6], [5.9, 6], [-0.1, 0.1], [-40, 35.5]] as const) {
      const a = tempAxis(lo, hi)
      expect(a.lo).toBeLessThanOrEqual(lo)
      expect(a.hi).toBeGreaterThanOrEqual(hi)
      expect(a.hi - a.lo).toBeGreaterThanOrEqual(2)
    }
  })

  it('precip_axis_au_moins_2_mm_et_entier', () => {
    expect(precipAxis(0)).toBe(2)
    expect(precipAxis(1.2)).toBe(2)
    expect(precipAxis(2.1)).toBe(3)
    expect(precipAxis(8)).toBe(8)
  })

  it('tick_values_multiples_du_pas', () => {
    expect(tickValues(-3, 9, 1)).toEqual([-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(tickValues(-3, 9, 5)).toEqual([0, 5])
    expect(tickValues(0, 8, 2)).toEqual([0, 2, 4, 6, 8])
  })

  it('hour_marks_heures_locales_pleines_etiquettes_paires', () => {
    const start = Date.UTC(2026, 10, 20, 14, 37)
    const end = Date.UTC(2026, 10, 21, 2, 37)
    const marks = hourMarks(start, end)
    expect(marks.length).toBeGreaterThanOrEqual(12)
    expect(marks.length).toBeLessThanOrEqual(13)
    for (const m of marks) {
      const d = new Date(m.t)
      expect(d.getMinutes()).toBe(0)
      expect(m.t).toBeGreaterThanOrEqual(start)
      expect(m.t).toBeLessThanOrEqual(end)
      expect(m.label).toBe(d.getHours() % 2 === 0 ? `${d.getHours()} h` : null)
    }
  })

  it('format_cm_equivalent_neige_virgule_francaise', () => {
    expect(formatCm(2)).toBe('1,4 cm')
    expect(formatCm(0)).toBe('0 cm')
    expect(formatCm(3)).toBe('2,1 cm')
  })
})
