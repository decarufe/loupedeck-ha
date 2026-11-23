import type { MenuItemConstructorOptions } from 'electron'

export interface MenuState {
  autostart: boolean
  /** Faux en développement (`pnpm run app`) : on n'inscrit pas electron.exe au démarrage de Windows. */
  autostartAvailable: boolean
  /** Version téléchargée et prête à installer, ou null. */
  updateVersion: string | null
}

export interface MenuHandlers {
  openEditor(): void
  toggleAutostart(next: boolean): void
  about(): void
  quit(): void
  installUpdate(): void
}

/** Menu contextuel de l'icône de notification. */
export function buildMenuTemplate(s: MenuState, h: MenuHandlers): MenuItemConstructorOptions[] {
  const update: MenuItemConstructorOptions[] = s.updateVersion
    ? [{ label: `Redémarrer pour installer la version ${s.updateVersion}`, click: () => h.installUpdate() }, { type: 'separator' }]
    : []
  return [
    ...update,
    { label: 'Ouvrir la configuration', click: () => h.openEditor() },
    {
      label: 'Démarrer avec Windows', type: 'checkbox', checked: s.autostart, enabled: s.autostartAvailable,
      click: () => h.toggleAutostart(!s.autostart),
    },
    { label: 'À propos…', click: () => h.about() },
    { type: 'separator' },
    { label: 'Quitter', click: () => h.quit() },
  ]
}
