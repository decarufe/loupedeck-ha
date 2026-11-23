import type { MessageBoxOptions } from 'electron'

export const REPO_URL = 'https://github.com/decarufe/loupedeck-ha'

export type AboutChoice = 'logs' | 'github' | 'close'

const BUTTONS = ['Ouvrir les journaux', 'Page GitHub', 'Fermer']

export function aboutDialogOptions(version: string): MessageBoxOptions {
  return {
    type: 'info',
    title: 'À propos de Loupedeck HA',
    message: 'Loupedeck HA',
    detail: `Version ${version}\nLoupedeck Live comme télécommande Home Assistant.\n${REPO_URL}`,
    buttons: BUTTONS,
    defaultId: 2,
    cancelId: 2,
    noLink: true,
  }
}

export function aboutChoice(response: number): AboutChoice {
  if (response === 0) return 'logs'
  if (response === 1) return 'github'
  return 'close'
}
