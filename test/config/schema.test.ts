import { describe, expect, it } from 'vitest'
import { appConfigSchema, arrangeOrder, defaultConfig, emptyDashboard, isEmptyPage, migrateConfig, moveItem } from '../../src/config/schema.js'

const parse = (v: unknown) => appConfigSchema.safeParse(v)

describe('schéma de configuration', () => {
  describe('tableau Caméra : cadrage', () => {
    it('camera_fit_defaults_to_cover_for_old_config', () => {
      const old = JSON.parse(JSON.stringify(defaultConfig()))
      for (const b of old.buttons) if (b?.type === 'camera') delete b.fit
      const r = parse(old)
      expect(r.success).toBe(true)
      const cam = r.data!.buttons[3]
      expect(cam?.type === 'camera' && cam.fit).toBe('cover')
    })

    it('camera_fit_accepts_cover_and_contain', () => {
      for (const fit of ['cover', 'contain']) {
        const c = JSON.parse(JSON.stringify(defaultConfig()))
        c.buttons[3].fit = fit
        const r = parse(c)
        expect(r.success).toBe(true)
        const cam = r.data!.buttons[3]
        expect(cam?.type === 'camera' && cam.fit).toBe(fit)
      }
    })

    it('camera_fit_rejects_other_values', () => {
      const c = JSON.parse(JSON.stringify(defaultConfig()))
      c.buttons[3].fit = 'stretch'
      expect(parse(c).success).toBe(false)
    })

    it('empty_camera_dashboard_is_cover', () => {
      const cam = emptyDashboard('camera', 0)
      expect(cam.type === 'camera' && cam.fit).toBe('cover')
    })
  })

  describe('adresse Home Assistant', () => {
    const withUrl = (url: string) => {
      const c = defaultConfig()
      c.ha.url = url
      return c
    }

    it('ha_url_accepts_http_and_https', () => {
      for (const url of ['http://homeassistant.local:8123', 'https://hass.example.net', 'HTTPS://hass.example.net/', ' http://10.0.0.2:8123 ']) {
        expect(parse(withUrl(url)).success, url).toBe(true)
      }
    })

    it('ha_url_rejects_other_schemes_with_french_message', () => {
      for (const url of ['ftp://hass.example', 'homeassistant.local:8123', 'ws://hass.example', 'http:/x']) {
        const r = parse(withUrl(url))
        expect(r.success, url).toBe(false)
        const issue = r.error!.issues.find((i) => i.path.join('.') === 'ha.url')
        expect(issue?.message).toBe("L'adresse Home Assistant doit commencer par http:// ou https://")
      }
    })

    it('ha_url_empty_still_allowed_for_blank_config', () => {
      expect(parse(withUrl('')).success).toBe(true)
    })
  })

  describe('version 2 : pages Bouton custom et Graphique', () => {
    const v1 = () => {
      const c = JSON.parse(JSON.stringify(defaultConfig()))
      c.version = 1
      c.buttons[0] = {
        type: 'lights', name: 'Lumières', color: '#FFB300',
        keys: [{ entityId: 'light.salon', label: 'Séjour' }, null, { entityId: 'switch.cafe', icon: 'mdi:coffee' }, null, null, null, null, null, null, null, null, null],
        dimmers: { knobTL: { entityId: 'light.bureau' }, knobCL: null, knobBL: null, knobTR: null, knobCR: null, knobBR: null },
      }
      return c
    }

    it('migrates_v1_lights_to_custom_page', () => {
      const r = parse(v1())
      expect(r.success).toBe(true)
      expect(r.data!.version).toBe(2)
      const b = r.data!.buttons[0]
      expect(b?.type).toBe('custom')
      if (b?.type !== 'custom') return
      expect(b.name).toBe('Lumières')
      expect(b.keys[0]).toEqual({ kind: 'toggle', entityId: 'light.salon', label: 'Séjour' })
      expect(b.keys[2]).toEqual({ kind: 'toggle', entityId: 'switch.cafe', icon: 'mdi:coffee' })
      expect(b.strips.knobTL).toEqual({ kind: 'dimmer', entityId: 'light.bureau' })
      expect(b.strips.knobBR).toBeNull()
    })

    it('migration_leaves_v2_untouched', () => {
      const c = defaultConfig()
      expect(migrateConfig(c)).toBe(c)
    })

    it('rejects_tile_kind_in_wrong_slot', () => {
      const c = JSON.parse(JSON.stringify(defaultConfig()))
      c.buttons[0].keys[0] = { kind: 'dimmer', entityId: 'light.salon' }
      expect(parse(c).success).toBe(false)
      const d = JSON.parse(JSON.stringify(defaultConfig()))
      d.buttons[0].strips.knobTL = { kind: 'action', entityId: 'scene.soiree' }
      expect(parse(d).success).toBe(false)
    })

    it('fills_tile_defaults', () => {
      const c = JSON.parse(JSON.stringify(defaultConfig()))
      c.buttons[0].keys[0] = { kind: 'value', entityId: 'sensor.temp' }
      c.buttons[0].keys[1] = { kind: 'graph', entityId: 'sensor.cpu' }
      c.buttons[0].keys[2] = { kind: 'clock' }
      const r = parse(c)
      expect(r.success).toBe(true)
      const b = r.data!.buttons[0]
      if (b?.type !== 'custom') throw new Error('page custom attendue')
      expect(b.keys[0]).toMatchObject({ template: '{valeur} {unité}', decimals: 0 })
      expect(b.keys[1]).toMatchObject({ period: '6h', style: 'area', showMinMax: false })
      expect(b.keys[2]).toMatchObject({ format: 'time-date' })
    })

    it('graph_page_window_must_be_known', () => {
      const c = JSON.parse(JSON.stringify(defaultConfig()))
      c.buttons[7] = emptyDashboard('graph', 7)
      expect(parse(c).success).toBe(true)
      c.buttons[7].windowHours = 5
      expect(parse(c).success).toBe(false)
    })

    it('empty_page_rule', () => {
      expect(isEmptyPage(null)).toBe(true)
      expect(isEmptyPage(emptyDashboard('custom', 0))).toBe(true)
      expect(isEmptyPage(emptyDashboard('weather', 0))).toBe(false)
      const p = emptyDashboard('custom', 0)
      if (p.type === 'custom') p.strips.knobCR = { kind: 'clock', format: 'time' }
      expect(isEmptyPage(p)).toBe(false)
    })
  })

  describe('réordonner', () => {
    it('inserts_and_shifts_onto_occupied_place', () => {
      expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
      expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
    })
    it('swaps_onto_empty_place_or_with_swap', () => {
      expect(moveItem(['a', null, 'c'], 0, 1)).toEqual([null, 'a', 'c'])
      expect(moveItem(['a', 'b', 'c'], 0, 2, true)).toEqual(['c', 'b', 'a'])
    })
    it('same_place_is_noop', () => {
      expect(arrangeOrder(['a', 'b'], 1, 1)).toEqual([0, 1])
    })
  })
})
