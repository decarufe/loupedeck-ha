import type { MessageBoxOptions } from 'electron'
import type { Logger } from '../log.js'
import { REPO_URL } from './about.js'
import type { UpdateCheck } from './updater.js'

export const DOWNLOAD_PAGE = `${REPO_URL}/releases/latest`
const MAX_ERROR_LENGTH = 200

/** `asking` : une fenêtre attend une réponse. */
export type UpdateFlowState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'asking' } | { kind: 'downloading'; version: string }

export interface UpdateFlow {
  /** Vérifie tout de suite ; s'il existe une version plus récente, propose de l'installer sans attendre. */
  run(): Promise<void>
  /** Vrai quand « Installer maintenant » a été choisi : inutile d'annoncer en plus la version téléchargée. */
  installing(): boolean
}

export interface UpdateFlowDeps {
  updater: { checkForUpdates(): Promise<UpdateCheck | null> }
  currentVersion: string
  /** Affiche la fenêtre et renvoie l'indice du bouton choisi. */
  showDialog(o: MessageBoxOptions): Promise<number>
  /** Arrête l'application puis lance l'installateur, qui la relance. */
  install(): Promise<void>
  notify(body: string): void
  openUrl(url: string): void
  quitting(): boolean
  onState(s: UpdateFlowState): void
  log: Logger
}

const base = { title: 'Mise à jour de Loupedeck HA', noLink: true } as const

/** Première ligne seulement : electron-updater ajoute la pile et les en-têtes HTTP. */
const shortError = (err: unknown) => (err instanceof Error ? err.message : String(err)).split(/\r?\n/)[0]!.slice(0, MAX_ERROR_LENGTH)

export const upToDateDialog = (current: string): MessageBoxOptions => ({
  ...base, type: 'info', message: 'Loupedeck HA est à jour', detail: `Version installée : ${current}`, buttons: ['OK'], defaultId: 0, cancelId: 0,
})

export const offerDialog = (current: string, next: string): MessageBoxOptions => ({
  ...base, type: 'question', message: `La version ${next} est disponible`,
  detail: `Version installée : ${current}\n\n« Installer maintenant » termine le téléchargement puis redémarre Loupedeck HA : la console s’éteint un instant.\n« Plus tard » : elle s’installera à la prochaine fermeture, ou depuis le menu de l’icône.`,
  buttons: ['Installer maintenant', 'Plus tard'], defaultId: 0, cancelId: 1,
})

export const failureDialog = (err: unknown): MessageBoxOptions => ({
  ...base, type: 'warning', message: 'Mise à jour impossible',
  detail: `Vérifiez la connexion Internet et réessayez, ou téléchargez l’installateur depuis GitHub.\n\n${shortError(err)}`,
  buttons: ['Page de téléchargement', 'Fermer'], defaultId: 1, cancelId: 1,
})

/** Vérification demandée par l'utilisateur (menu de l'icône, « À propos »). `run` ne rejette jamais. */
export function createUpdateFlow(d: UpdateFlowDeps): UpdateFlow {
  let current: Promise<void> | null = null
  let installNow = false

  const ask = (o: MessageBoxOptions): Promise<number> => {
    d.onState({ kind: 'asking' })
    return d.showDialog(o)
  }

  async function update(): Promise<void> {
    d.onState({ kind: 'checking' })
    const check = await d.updater.checkForUpdates()
    if (!check) throw new Error('Vérification des mises à jour inactive')
    // Le téléchargement est déjà parti ; son échec éventuel ne compte que si on l'attend.
    check.downloadPromise?.catch(() => {})
    if (!check.isUpdateAvailable) {
      await ask(upToDateDialog(d.currentVersion))
      return
    }
    const { version } = check.updateInfo
    if ((await ask(offerDialog(d.currentVersion, version))) !== 0) return
    if (!check.downloadPromise) throw new Error(`Téléchargement de la version ${version} impossible`)
    installNow = true
    d.log.info('Installation immédiate demandée', { version })
    d.onState({ kind: 'downloading', version })
    d.notify(`Téléchargement de la version ${version}… Loupedeck HA redémarrera ensuite.`)
    await check.downloadPromise
    await d.install()
  }

  async function guarded(): Promise<void> {
    try {
      await update()
    } catch (err) {
      installNow = false
      d.log.warn('Mise à jour demandée : échec', { erreur: shortError(err) })
      try {
        if ((await ask(failureDialog(err))) === 0) d.openUrl(DOWNLOAD_PAGE)
      } catch (dialogErr) {
        d.log.error('Fenêtre de mise à jour impossible à afficher', { erreur: shortError(dialogErr) })
      }
    } finally {
      installNow = false
      d.onState({ kind: 'idle' })
    }
  }

  return {
    run() {
      if (d.quitting()) return Promise.resolve()
      current ??= guarded().finally(() => { current = null })
      return current
    },
    installing: () => installNow,
  }
}
