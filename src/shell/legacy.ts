import path from 'node:path'
import type { Logger } from '../log.js'

/** Tâche planifiée créée par l'ancien `scripts/install-autostart.ps1`. */
export const LEGACY_TASK = 'Loupedeck HA'
/** Raccourcis créés par l'ancien script sur le Bureau et dans le menu Démarrer. */
export const LEGACY_SHORTCUT = 'Loupedeck HA – Configuration.url'

export interface LegacyDeps {
  /** Lance une commande sans shell ; `code` est son code de sortie. */
  run(cmd: string, args: string[]): Promise<{ code: number }>
  exists(p: string): Promise<boolean>
  unlink(p: string): Promise<void>
  desktopDir: string
  startMenuDir: string
  log: Logger
}

/**
 * Retire l'ancienne installation depuis le dépôt (tâche planifiée et raccourcis), qui lancerait sinon la
 * version du dépôt à l'ouverture de session, en concurrence avec la version installée pour la console.
 * Ne lève jamais d'exception.
 */
export async function removeLegacyInstall(d: LegacyDeps): Promise<{ task: boolean; shortcuts: string[] }> {
  let task = false
  try {
    const query = await d.run('schtasks', ['/Query', '/TN', LEGACY_TASK])
    if (query.code === 0) {
      const del = await d.run('schtasks', ['/Delete', '/TN', LEGACY_TASK, '/F'])
      task = del.code === 0
      if (task) d.log.info('Ancienne tâche planifiée supprimée', { tache: LEGACY_TASK })
      else d.log.warn('Impossible de supprimer l’ancienne tâche planifiée', { tache: LEGACY_TASK, code: del.code })
    }
  } catch (err) {
    d.log.warn('Vérification de l’ancienne tâche planifiée impossible', { erreur: String(err) })
  }

  const shortcuts: string[] = []
  for (const dir of [d.desktopDir, d.startMenuDir]) {
    const file = path.join(dir, LEGACY_SHORTCUT)
    try {
      if (await d.exists(file)) {
        await d.unlink(file)
        shortcuts.push(file)
        d.log.info('Ancien raccourci supprimé', { fichier: file })
      }
    } catch (err) {
      d.log.warn('Impossible de supprimer l’ancien raccourci', { fichier: file, erreur: String(err) })
    }
  }
  return { task, shortcuts }
}
