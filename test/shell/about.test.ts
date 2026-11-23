import { describe, expect, it } from 'vitest'
import { aboutChoice, aboutDialogOptions, REPO_URL } from '../../src/shell/about.js'

describe('À propos', () => {
  it('options du dialogue', () => {
    const o = aboutDialogOptions('0.2.7')
    expect(o.buttons).toEqual(['Ouvrir les journaux', 'Page GitHub', 'Fermer'])
    expect(o.defaultId).toBe(2)
    expect(o.cancelId).toBe(2)
    expect(o.message).toBe('Loupedeck HA')
    expect(o.title).toBe('À propos de Loupedeck HA')
    expect(o.detail).toContain('Version 0.2.7')
    expect(o.detail).toContain(REPO_URL)
    expect(REPO_URL).toBe('https://github.com/decarufe/loupedeck-ha')
  })

  it('choix selon le bouton', () => {
    expect(aboutChoice(0)).toBe('logs')
    expect(aboutChoice(1)).toBe('github')
    expect(aboutChoice(2)).toBe('close')
    expect(aboutChoice(-1)).toBe('close')
  })
})
