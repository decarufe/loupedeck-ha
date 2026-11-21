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
})
