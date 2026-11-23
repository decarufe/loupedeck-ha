import { describe, expect, it } from 'vitest'
import { feelsLike, humidex, windChill } from '../../src/weather/feels-like.js'

describe('température ressentie canadienne', () => {
  it('humidex_valeurs_de_reference', () => {
    expect(humidex(30, 20)).toBeCloseTo(37.6, 1)
    expect(humidex(25, 15)).toBeCloseTo(29.0, 1)
  })

  it('refroidissement_valeurs_de_reference', () => {
    expect(windChill(-10, 20)).toBeCloseTo(-17.9, 1)
    expect(windChill(-20, 30)).toBeCloseTo(-32.6, 1)
    expect(windChill(-5, 10)).toBeCloseTo(-9.3, 1)
  })

  it('feels_like_refroidissement_quand_froid_et_venteux', () => {
    expect(feelsLike(-10, -15, 20)).toBeCloseTo(-17.9, 1)
  })

  it('feels_like_egale_la_temperature_si_vent_trop_faible', () => {
    expect(feelsLike(-10, -15, 4)).toBe(-10)
  })

  it('feels_like_humidex_quand_au_moins_25', () => {
    expect(feelsLike(30, 20, 5)).toBeCloseTo(37.6, 1)
  })

  it('feels_like_egale_la_temperature_si_humidex_sous_25', () => {
    expect(feelsLike(20, 5, 5)).toBe(20)
  })
})
