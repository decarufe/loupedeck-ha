/**
 * Processus principal Electron : icône de notification, menu, « À propos », démarrage avec Windows,
 * mises à jour et supervision de l'application (dist/main.js, lancée dans un utilityProcess).
 * Câblage seulement : la logique est dans les modules voisins, testés séparément.
 */
import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, dialog, Menu, Notification, shell, Tray, utilityProcess } from 'electron'
import updaterPkg from 'electron-updater'
import { createLogger } from '../log.js'
import { configDir as resolveConfigDir } from '../shared/paths.js'
import { aboutChoice, aboutDialogOptions, REPO_URL } from './about.js'
import { initAutostart } from './autostart.js'
import { editorUrlFromPort, readEditorPort } from './editor-url.js'
import { removeLegacyInstall } from './legacy.js'
import { buildMenuTemplate, type MenuState } from './menu.js'
import { createSupervisor, type ChildLike } from './supervisor.js'
import { startUpdateChecks } from './updater.js'

const APP_ID = 'com.decarufe.loupedeck-ha'
const { autoUpdater } = updaterPkg

const configDir = resolveConfigDir(process.env, os.homedir())
const logsDir = path.join(configDir, 'logs')
const log = createLogger(path.join(logsDir, 'shell.log'), { level: process.env.LOG_LEVEL ?? 'info' })

if (!app.requestSingleInstanceLock()) {
  // Une instance tourne déjà : elle ouvre l'éditeur (événement second-instance).
  app.quit()
} else {
  void main()
}

async function main(): Promise<void> {
  app.setAppUserModelId(APP_ID)
  await app.whenReady()
  log.info('Shell démarré', {
    version: app.getVersion(), node: process.versions.node, electron: process.versions.electron, installe: app.isPackaged,
  })

  const supervisor = createSupervisor({
    fork: () => utilityProcess.fork(path.join(app.getAppPath(), 'dist', 'main.js'), [], { serviceName: 'Loupedeck HA' }) as unknown as ChildLike,
    log,
  })

  const state: MenuState = {
    autostart: app.getLoginItemSettings().openAtLogin,
    autostartAvailable: app.isPackaged,
    updateVersion: null,
  }

  async function openEditor(): Promise<void> {
    const url = supervisor.editorUrl() ?? editorUrlFromPort(await readEditorPort(path.join(configDir, 'config.json')))
    await shell.openExternal(url)
  }

  async function about(): Promise<void> {
    const { response } = await dialog.showMessageBox(aboutDialogOptions(app.getVersion()))
    const choice = aboutChoice(response)
    if (choice === 'logs') await shell.openPath(logsDir)
    else if (choice === 'github') await shell.openExternal(REPO_URL)
  }

  let quitting: Promise<void> | null = null
  function quit(): Promise<void> {
    quitting ??= (async () => {
      log.info('Arrêt demandé')
      await supervisor.stop()
      app.exit(0)
    })()
    return quitting
  }

  async function installUpdate(): Promise<void> {
    if (quitting) return
    log.info('Installation de la mise à jour', { version: state.updateVersion })
    quitting = supervisor.stop()
    await quitting
    autoUpdater.quitAndInstall(true, true)
  }

  const tray = new Tray(path.join(app.getAppPath(), 'build', 'icon.ico'))
  tray.setToolTip('Loupedeck HA')
  const refreshMenu = () => {
    tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate(state, {
      openEditor: () => { void openEditor() },
      toggleAutostart: (next) => {
        app.setLoginItemSettings({ openAtLogin: next })
        state.autostart = app.getLoginItemSettings().openAtLogin
        log.info('Démarrage avec Windows', { actif: state.autostart })
        refreshMenu()
      },
      about: () => { void about() },
      quit: () => { void quit() },
      installUpdate: () => { void installUpdate() },
    })))
  }
  tray.on('click', () => { void openEditor() })
  refreshMenu()

  app.on('second-instance', () => { void openEditor() })
  app.on('window-all-closed', () => { /* l'application vit dans la zone de notification */ })
  app.on('before-quit', (e) => {
    if (quitting) return
    e.preventDefault()
    void quit()
  })

  // Fenêtre jamais affichée : seul moyen de recevoir la fin de session Windows (session-end).
  const sessionWindow = new BrowserWindow({ show: false, skipTaskbar: true, webPreferences: { sandbox: true } })
  sessionWindow.on('session-end', () => {
    log.info('Fin de session Windows')
    void supervisor.stop()
  })

  if (app.isPackaged) {
    await removeLegacyInstall({
      run: (cmd, args) => new Promise((resolve) => {
        execFile(cmd, args, { windowsHide: true }, (err) => {
          const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
          resolve({ code })
        })
      }),
      exists: (p) => fsp.access(p).then(() => true, () => false),
      unlink: (p) => fsp.unlink(p),
      desktopDir: app.getPath('desktop'),
      startMenuDir: path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      log,
    })
    await initAutostart({
      statePath: path.join(configDir, 'shell.json'),
      login: {
        get: () => app.getLoginItemSettings().openAtLogin,
        set: (openAtLogin) => app.setLoginItemSettings({ openAtLogin }),
      },
      log,
    })
    state.autostart = app.getLoginItemSettings().openAtLogin
    refreshMenu()
  }

  supervisor.start()

  if (app.isPackaged) {
    autoUpdater.logger = null
    startUpdateChecks({
      updater: autoUpdater,
      log,
      onDownloaded: (version) => {
        state.updateVersion = version
        refreshMenu()
        new Notification({ title: 'Loupedeck HA', body: `Version ${version} prête — redémarrer pour installer` }).show()
      },
    })
  }
}
