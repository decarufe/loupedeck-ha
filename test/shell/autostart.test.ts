import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initAutostart } from '../../src/shell/autostart.js'

let dir: string
const log = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
function login(initial: boolean) {
  let v = initial
  return { get: () => v, set: vi.fn((next: boolean) => { v = next }) }
}
const marker = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8'))

beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ldha-autostart-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('initAutostart', () => {
  it('premier lancement (shell.json absent) : écrit le marqueur, puis active le démarrage', async () => {
    const statePath = path.join(dir, 'shell.json')
    const l = login(false)
    let markerWhenSet: unknown = null
    l.set.mockImplementation(() => {
      markerWhenSet = fsSync.existsSync(statePath) ? JSON.parse(fsSync.readFileSync(statePath, 'utf8')) : null
    })
    await initAutostart({ statePath, login: l, log: log() })
    expect(l.set).toHaveBeenCalledWith(true)
    expect(markerWhenSet).toEqual({ autostartInitialized: true })
    expect(await marker(statePath)).toEqual({ autostartInitialized: true })
  })

  it('lancement suivant après décochage : ne réactive jamais', async () => {
    const statePath = path.join(dir, 'shell.json')
    await fs.writeFile(statePath, JSON.stringify({ autostartInitialized: true }))
    const l = login(false)
    await initAutostart({ statePath, login: l, log: log() })
    expect(l.set).not.toHaveBeenCalled()
  })

  it('shell.json illisible : ne réactive rien, journalise et réécrit le marqueur', async () => {
    for (const content of ['{pas du json', 'null', '{}']) {
      const statePath = path.join(dir, 'shell.json')
      await fs.writeFile(statePath, content)
      const l = login(false)
      const lg = log()
      await initAutostart({ statePath, login: l, log: lg })
      expect(l.set).not.toHaveBeenCalled()
      expect(lg.warn).toHaveBeenCalled()
      expect(await marker(statePath)).toEqual({ autostartInitialized: true })
    }
  })

  it('dossier absent : créé au premier lancement', async () => {
    const statePath = path.join(dir, 'sous', 'shell.json')
    await initAutostart({ statePath, login: login(false), log: log() })
    expect(await marker(statePath)).toEqual({ autostartInitialized: true })
  })

  it('marqueur impossible à écrire au premier lancement : n’active pas (sinon réactivation à chaque lancement)', async () => {
    const blocker = path.join(dir, 'fichier')
    await fs.writeFile(blocker, 'x')
    const statePath = path.join(blocker, 'shell.json')
    const l = login(false)
    const lg = log()
    await initAutostart({ statePath, login: l, log: lg })
    expect(l.set).not.toHaveBeenCalled()
    expect(lg.warn).toHaveBeenCalled()
  })
})
