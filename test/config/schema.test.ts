import { describe, expect, it } from 'vitest'
import { appConfigSchema, defaultConfig, emptyDashboard } from '../../src/config/schema.js'

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
})
