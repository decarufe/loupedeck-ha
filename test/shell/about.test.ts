import { describe, expect, it } from 'vitest'
import { aboutChoice, aboutDialogOptions, REPO_URL } from '../../src/shell/about.js'

describe('À propos', () => {
  it('options du dialogue', () => {
    const o = aboutDialogOptions('0.2.7', { available: true, ready: null })
    expect(o.buttons).toEqual(['Vérifier les mises à jour', 'Ouvrir les journaux', 'Page GitHub', 'Fermer'])
    expect(o.defaultId).toBe(3)
    expect(o.cancelId).toBe(3)
    expect(o.message).toBe('Loupedeck HA')
    expect(o.title).toBe('À propos de Loupedeck HA')
    expect(o.detail).toContain('Version 0.2.7')
    expect(o.detail).toContain(REPO_URL)
    expect(REPO_URL).toBe('https://github.com/decarufe/loupedeck-ha')
  })

  it('choix selon le bouton', () => {
    const u = { available: true, ready: null }
    expect([0, 1, 2, 3, -1].map((i) => aboutChoice(i, u))).toEqual(['check-updates', 'logs', 'github', 'close', 'close'])
  })

  it('version téléchargée : le bouton l’installe', () => {
    const u = { available: true, ready: '0.2.11' }
    expect(aboutDialogOptions('0.2.7', u).buttons![0]).toBe('Installer la version 0.2.11')
    expect(aboutChoice(0, u)).toBe('install-update')
  })

  it('version du dépôt : pas de bouton de mise à jour', () => {
    const u = { available: false, ready: null }
    const o = aboutDialogOptions('0.2.0', u)
    expect(o.buttons).toEqual(['Ouvrir les journaux', 'Page GitHub', 'Fermer'])
    expect(o.cancelId).toBe(2)
    expect([0, 1, 2, -1].map((i) => aboutChoice(i, u))).toEqual(['logs', 'github', 'close', 'close'])
  })
})
