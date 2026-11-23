import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startUpdateChecks, UPDATE_INITIAL_DELAY_MS, UPDATE_INTERVAL_MS, type UpdaterLike } from '../../src/shell/updater.js'

class FakeUpdater extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = false
  checkForUpdates = vi.fn(async (): Promise<unknown> => null)
}

function setup() {
  const updater = new FakeUpdater()
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const onDownloaded = vi.fn()
  const stop = startUpdateChecks({ updater: updater as unknown as UpdaterLike, log, onDownloaded })
  return { updater, log, onDownloaded, stop }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('startUpdateChecks', () => {
  it('constantes', () => {
    expect(UPDATE_INITIAL_DELAY_MS).toBe(10_000)
    expect(UPDATE_INTERVAL_MS).toBe(4 * 60 * 60 * 1000)
  })

  it('règle autoDownload et autoInstallOnAppQuit à true', () => {
    const { updater } = setup()
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
  })

  it('première vérification à 10 s, puis toutes les 4 h', async () => {
    const { updater } = setup()
    await vi.advanceTimersByTimeAsync(9999)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('checkForUpdates rejeté (hors ligne) : log.warn, pas de notification, nouvel essai au cycle suivant', async () => {
    const { updater, log, onDownloaded } = setup()
    updater.checkForUpdates.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'))
    await vi.advanceTimersByTimeAsync(UPDATE_INITIAL_DELAY_MS)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(onDownloaded).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('téléchargement en arrière-plan rejeté : pas de rejet non traité (l’événement error le journalise)', async () => {
    const { updater } = setup()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    updater.checkForUpdates.mockImplementation(async () => ({ isUpdateAvailable: true, updateInfo: { version: '0.2.11' }, downloadPromise: Promise.reject(new Error('coupure')) }))
    await vi.advanceTimersByTimeAsync(UPDATE_INITIAL_DELAY_MS)
    vi.useRealTimers()
    await new Promise((r) => setTimeout(r, 20))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('événement error : log.warn, pas d’exception', () => {
    const { updater, log } = setup()
    updater.emit('error', new Error('GitHub indisponible'))
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('update-downloaded 0.2.9 deux fois : onDownloaded appelé une seule fois', () => {
    const { updater, onDownloaded } = setup()
    updater.emit('update-downloaded', { version: '0.2.9' })
    updater.emit('update-downloaded', { version: '0.2.9' })
    expect(onDownloaded.mock.calls).toEqual([['0.2.9']])
  })

  it('la fonction retournée arrête les vérifications', async () => {
    const { updater, stop } = setup()
    stop()
    await vi.advanceTimersByTimeAsync(UPDATE_INITIAL_DELAY_MS + UPDATE_INTERVAL_MS * 2)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
})
