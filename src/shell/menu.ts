import type { MenuItemConstructorOptions } from 'electron'
import type { UpdateFlowState } from './update-flow.js'

export interface MenuState {
  autostart: boolean
  /** Faux en développement (`pnpm run app`) : on n'inscrit pas electron.exe au démarrage de Windows. */
  autostartAvailable: boolean
  /** Faux dans la version du dépôt : electron-updater y est inactif. */
  updatesAvailable: boolean
  /** Version téléchargée et prête à installer, ou null. */
  updateVersion: string | null
  /** Vérification demandée par l'utilisateur, en cours ou non. */
  update: UpdateFlowState
}

export interface MenuHandlers {
  openEditor(): void
  toggleAutostart(next: boolean): void
  about(): void
  quit(): void
  installUpdate(): void
  checkUpdates(): void
}

function updateLabel(s: UpdateFlowState): string {
  switch (s.kind) {
    case 'idle': return 'Vérifier les mises à jour…'
    case 'checking': return 'Recherche de mises à jour…'
    case 'asking': return 'Mise à jour : répondez à la fenêtre ouverte'
    case 'downloading': return `Téléchargement de la version ${s.version}…`
  }
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
    { label: updateLabel(s.update), enabled: s.updatesAvailable && s.update.kind === 'idle', click: () => h.checkUpdates() },
    { label: 'À propos…', click: () => h.about() },
    { type: 'separator' },
    { label: 'Quitter', click: () => h.quit() },
  ]
}
