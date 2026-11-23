import type { MessageBoxOptions } from 'electron'

export const REPO_URL = 'https://github.com/decarufe/loupedeck-ha'

export type AboutChoice = 'check-updates' | 'install-update' | 'logs' | 'github' | 'close'

export interface AboutUpdates {
  /** Faux dans la version du dépôt (electron-updater inactif) ou pendant une mise à jour. */
  available: boolean
  /** Version téléchargée et prête à installer, ou null. */
  ready: string | null
}

function aboutButtons(u: AboutUpdates): { label: string; choice: AboutChoice }[] {
  const update: { label: string; choice: AboutChoice }[] = !u.available ? []
    : u.ready ? [{ label: `Installer la version ${u.ready}`, choice: 'install-update' }]
      : [{ label: 'Vérifier les mises à jour', choice: 'check-updates' }]
  return [
    ...update,
    { label: 'Ouvrir les journaux', choice: 'logs' },
    { label: 'Page GitHub', choice: 'github' },
    { label: 'Fermer', choice: 'close' },
  ]
}

export function aboutDialogOptions(version: string, updates: AboutUpdates): MessageBoxOptions {
  const buttons = aboutButtons(updates).map((b) => b.label)
  return {
    type: 'info',
    title: 'À propos de Loupedeck HA',
    message: 'Loupedeck HA',
    detail: `Version ${version}\nLoupedeck Live comme télécommande Home Assistant.\n${REPO_URL}`,
    buttons,
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
    noLink: true,
  }
}

export function aboutChoice(response: number, updates: AboutUpdates): AboutChoice {
  return aboutButtons(updates)[response]?.choice ?? 'close'
}
