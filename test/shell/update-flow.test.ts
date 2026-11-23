import { describe, expect, it, vi } from 'vitest'
import { REPO_URL } from '../../src/shell/about.js'
import { createUpdateFlow, failureDialog, offerDialog, upToDateDialog, type UpdateFlowState } from '../../src/shell/update-flow.js'
import type { UpdateCheck } from '../../src/shell/updater.js'

const available = (version: string, downloadPromise: Promise<unknown> = Promise.resolve([])): UpdateCheck => ({ isUpdateAvailable: true, updateInfo: { version }, downloadPromise })
const none: UpdateCheck = { isUpdateAvailable: false, updateInfo: { version: '0.2.10' } }

function deferred() {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

/** `answer` : bouton choisi dans chaque dialogue, dans l'ordre (0 = premier). */
function setup(check: () => Promise<UpdateCheck | null>, answers: number[] = [], o: { quitting?: boolean } = {}) {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const states: UpdateFlowState[] = []
  const dialogs: { message: string; buttons: string[] }[] = []
  const install = vi.fn(async () => {})
  const notify = vi.fn()
  const openUrl = vi.fn()
  const checkForUpdates = vi.fn(check)
  const flow = createUpdateFlow({
    updater: { checkForUpdates },
    currentVersion: '0.2.10',
    showDialog: async (d) => {
      dialogs.push({ message: d.message, buttons: d.buttons! })
      return answers.shift() ?? d.cancelId!
    },
    install, notify, openUrl, log,
    quitting: () => o.quitting ?? false,
    onState: (s) => states.push(s),
  })
  return { flow, log, states, dialogs, install, notify, openUrl, checkForUpdates }
}

describe('vérifier et forcer une mise à jour', () => {
  it('à jour : le dit, n’installe rien', async () => {
    const t = setup(async () => none)
    await t.flow.run()
    expect(t.dialogs).toEqual([{ message: 'Loupedeck HA est à jour', buttons: ['OK'] }])
    expect(t.install).not.toHaveBeenCalled()
    expect(t.states).toEqual([{ kind: 'checking' }, { kind: 'asking' }, { kind: 'idle' }])
  })

  it('« Installer maintenant » : attend la fin du téléchargement puis installe', async () => {
    const dl = deferred()
    const t = setup(async () => available('0.2.11', dl.promise), [0])
    const run = t.flow.run()
    await flush()
    expect(t.dialogs[0]).toEqual({ message: 'La version 0.2.11 est disponible', buttons: ['Installer maintenant', 'Plus tard'] })
    expect(t.notify).toHaveBeenCalledWith('Téléchargement de la version 0.2.11… Loupedeck HA redémarrera ensuite.')
    expect(t.flow.installing()).toBe(true)
    expect(t.install).not.toHaveBeenCalled()
    dl.resolve()
    await run
    expect(t.install).toHaveBeenCalledTimes(1)
    expect(t.states).toEqual([{ kind: 'checking' }, { kind: 'asking' }, { kind: 'downloading', version: '0.2.11' }, { kind: 'idle' }])
  })

  it('« Plus tard » : le téléchargement continue, rien n’est installé ; son échec est sans effet', async () => {
    const dl = deferred()
    const t = setup(async () => available('0.2.11', dl.promise), [1])
    await t.flow.run()
    expect(t.install).not.toHaveBeenCalled()
    expect(t.flow.installing()).toBe(false)
    dl.reject(new Error('coupure'))
    await flush()
    expect(t.dialogs).toHaveLength(1)
  })

  it('fermer la fenêtre vaut « Plus tard »', async () => {
    const t = setup(async () => available('0.2.11'))
    await t.flow.run()
    expect(t.install).not.toHaveBeenCalled()
  })

  it('vérification impossible : le dit et propose la page de téléchargement', async () => {
    const t = setup(async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED\nheaders: {…}') }, [0])
    await t.flow.run()
    expect(t.dialogs).toEqual([{ message: 'Mise à jour impossible', buttons: ['Page de téléchargement', 'Fermer'] }])
    expect(t.openUrl).toHaveBeenCalledWith(`${REPO_URL}/releases/latest`)
    expect(t.log.warn).toHaveBeenCalledTimes(1)
    expect(t.states.at(-1)).toEqual({ kind: 'idle' })
  })

  it('échec du téléchargement après « Installer maintenant » : rien n’est installé', async () => {
    const t = setup(async () => available('0.2.11', Promise.reject(new Error('sha512 checksum mismatch'))), [0])
    await t.flow.run()
    expect(t.dialogs.map((d) => d.message)).toEqual(['La version 0.2.11 est disponible', 'Mise à jour impossible'])
    expect(t.install).not.toHaveBeenCalled()
    expect(t.openUrl).not.toHaveBeenCalled()
    expect(t.flow.installing()).toBe(false)
    expect(t.states.at(-1)).toEqual({ kind: 'idle' })
  })

  it('mise à jour sans téléchargement ou vérification inactive : échec annoncé, jamais d’installation à vide', async () => {
    for (const r of [null, { isUpdateAvailable: true, updateInfo: { version: '0.2.11' }, downloadPromise: null }]) {
      const t = setup(async () => r, [0])
      await t.flow.run()
      expect(t.dialogs.at(-1)!.message).toBe('Mise à jour impossible')
      expect(t.install).not.toHaveBeenCalled()
    }
  })

  it('deux demandes simultanées : une seule vérification, une seule fenêtre', async () => {
    const t = setup(async () => none)
    await Promise.all([t.flow.run(), t.flow.run()])
    expect(t.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(t.dialogs).toHaveLength(1)
    await t.flow.run()
    expect(t.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('arrêt en cours : ne fait rien', async () => {
    const t = setup(async () => none, [], { quitting: true })
    await t.flow.run()
    expect(t.checkForUpdates).not.toHaveBeenCalled()
  })

  it('une erreur du dialogue ne bloque pas les vérifications suivantes', async () => {
    const t = setup(async () => none)
    const failing = createUpdateFlow({
      updater: { checkForUpdates: t.checkForUpdates }, currentVersion: '0.2.10', showDialog: async () => { throw new Error('x') },
      install: t.install, notify: t.notify, openUrl: t.openUrl, log: t.log, quitting: () => false, onState: (s) => t.states.push(s),
    })
    await expect(failing.run()).resolves.toBeUndefined()
    expect(t.states.at(-1)).toEqual({ kind: 'idle' })
    await failing.run()
    expect(t.checkForUpdates).toHaveBeenCalledTimes(2)
  })
})

describe('dialogues', () => {
  it('textes', () => {
    expect(upToDateDialog('0.2.10').detail).toContain('0.2.10')
    const offer = offerDialog('0.2.10', '0.2.11')
    expect(offer.detail).toContain('Version installée : 0.2.10')
    expect(offer.detail).toContain('redémarre')
    expect([offer.defaultId, offer.cancelId]).toEqual([0, 1])
  })

  it('l’erreur est réduite à sa première ligne, courte', () => {
    const d = failureDialog(new Error(`${'a'.repeat(500)}\nheaders: secret`))
    expect(d.detail).not.toContain('headers')
    expect(d.detail!.length).toBeLessThan(400)
  })
})
