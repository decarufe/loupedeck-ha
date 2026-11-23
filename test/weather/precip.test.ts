import { describe, expect, it } from 'vitest'
import { classifyPrecip, splitPrecip } from '../../src/weather/precip.js'

const base = { rainMm: 0, snowMm: 0, tempC: 5, probability: null as number | null, weatherCode: 3 }

describe('classement des précipitations', () => {
  it('pluie_quand_seule_la_pluie_tombe', () => {
    expect(classifyPrecip({ ...base, rainMm: 2, tempC: 8 })).toBe('rain')
  })

  it('neige_quand_seule_la_neige_tombe', () => {
    expect(classifyPrecip({ ...base, snowMm: 1, tempC: -5 })).toBe('snow')
  })

  it('melange_quand_chaque_type_depasse_30_pour_cent', () => {
    expect(classifyPrecip({ ...base, rainMm: 1, snowMm: 1 })).toBe('mix')
  })

  it('pluie_quand_la_neige_est_minime', () => {
    expect(classifyPrecip({ ...base, rainMm: 1, snowMm: 0.1 })).toBe('rain')
  })

  it('melange_pour_pluie_verglacante', () => {
    expect(classifyPrecip({ ...base, rainMm: 1, tempC: -2 })).toBe('mix')
  })

  it('type_du_code_meteo_quand_quantite_nulle_et_probabilite_elevee', () => {
    expect(classifyPrecip({ ...base, probability: 60, weatherCode: 73 })).toBe('snow')
    expect(classifyPrecip({ ...base, probability: 60, weatherCode: 61 })).toBe('rain')
    expect(classifyPrecip({ ...base, probability: 60, weatherCode: 66 })).toBe('mix')
  })

  it('aucune_quand_quantite_nulle_et_probabilite_faible_ou_absente', () => {
    expect(classifyPrecip({ ...base, probability: 20, weatherCode: 61 })).toBe('none')
    expect(classifyPrecip({ ...base, probability: null, weatherCode: 61 })).toBe('none')
  })

  it('split_separe_pluie_et_neige_sans_valeur_negative', () => {
    expect(splitPrecip(3, 1.4)).toEqual({ rainMm: 1, snowMm: 2 })
    expect(splitPrecip(1, 1.4)).toEqual({ rainMm: 0, snowMm: 2 })
    expect(splitPrecip(0, 0)).toEqual({ rainMm: 0, snowMm: 0 })
  })
})
