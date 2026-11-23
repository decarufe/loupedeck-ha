import { describe, expect, it, vi } from 'vitest'
import { buildMenuTemplate, type MenuHandlers, type MenuState } from '../../src/shell/menu.js'

function handlers(): MenuHandlers {
  return { openEditor: vi.fn(), toggleAutostart: vi.fn(), about: vi.fn(), quit: vi.fn(), installUpdate: vi.fn(), checkUpdates: vi.fn() }
}
const base: MenuState = { autostart: true, autostartAvailable: true, updatesAvailable: true, updateVersion: null, update: { kind: 'idle' } }
type Item = ReturnType<typeof buildMenuTemplate>[number]
const labels = (t: Item[]) => t.map((i) => (i.type === 'separator' ? '---' : i.label))
const click = (item: Item) => (item.click as unknown as () => void)()

describe('buildMenuTemplate', () => {
  it('sans mise à jour', () => {
    expect(labels(buildMenuTemplate(base, handlers()))).toEqual(['Ouvrir la configuration', 'Démarrer avec Windows', 'Vérifier les mises à jour…', 'À propos…', '---', 'Quitter'])
  })

  it('avec une mise à jour prête, l’entrée apparaît en tête suivie d’un séparateur', () => {
    const t = buildMenuTemplate({ ...base, updateVersion: '0.2.14' }, handlers())
    expect(labels(t).slice(0, 2)).toEqual(['Redémarrer pour installer la version 0.2.14', '---'])
    expect(t).toHaveLength(8)
    expect(labels(t)).toContain('Vérifier les mises à jour…')
  })

  it('case Démarrer avec Windows', () => {
    const h = handlers()
    const box = buildMenuTemplate({ ...base, autostart: false, autostartAvailable: false }, h).find((i) => i.label === 'Démarrer avec Windows')!
    expect(box.type).toBe('checkbox')
    expect(box.checked).toBe(false)
    expect(box.enabled).toBe(false)
    click(box)
    expect(h.toggleAutostart).toHaveBeenCalledWith(true)
    const on = buildMenuTemplate(base, h).find((i) => i.label === 'Démarrer avec Windows')!
    expect(on.checked).toBe(true)
    expect(on.enabled).toBe(true)
    click(on)
    expect(h.toggleAutostart).toHaveBeenLastCalledWith(false)
  })

  it('entrée de mise à jour selon l’état', () => {
    const item = (s: Partial<MenuState>) => buildMenuTemplate({ ...base, ...s }, handlers()).find((i) => /mise|version/i.test(i.label ?? ''))!
    expect(item({})).toMatchObject({ label: 'Vérifier les mises à jour…', enabled: true })
    expect(item({ update: { kind: 'checking' } })).toMatchObject({ label: 'Recherche de mises à jour…', enabled: false })
    expect(item({ update: { kind: 'downloading', version: '0.2.11' } })).toMatchObject({ label: 'Téléchargement de la version 0.2.11…', enabled: false })
    expect(item({ update: { kind: 'asking' } })).toMatchObject({ label: 'Mise à jour : répondez à la fenêtre ouverte', enabled: false })
    // Version du dépôt : electron-updater est inactif.
    expect(item({ updatesAvailable: false })).toMatchObject({ label: 'Vérifier les mises à jour…', enabled: false })
  })

  it('chaque entrée appelle son handler', () => {
    const h = handlers()
    const t = buildMenuTemplate({ ...base, updateVersion: '0.2.3' }, h)
    const byLabel = (l: string) => t.find((i) => i.label === l)!
    click(byLabel('Redémarrer pour installer la version 0.2.3'))
    click(byLabel('Ouvrir la configuration'))
    click(byLabel('Vérifier les mises à jour…'))
    click(byLabel('À propos…'))
    click(byLabel('Quitter'))
    expect(h.installUpdate).toHaveBeenCalledTimes(1)
    expect(h.openEditor).toHaveBeenCalledTimes(1)
    expect(h.checkUpdates).toHaveBeenCalledTimes(1)
    expect(h.about).toHaveBeenCalledTimes(1)
    expect(h.quit).toHaveBeenCalledTimes(1)
  })
})
