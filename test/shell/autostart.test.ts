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

beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ldha-autostart-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('initAutostart', () => {
  it('premier lancement : active le démarrage et mémorise', async () => {
    const statePath = path.join(dir, 'shell.json')
    const l = login(false)
    await initAutostart({ statePath, login: l, log: log() })
    expect(l.set).toHaveBeenCalledWith(true)
    expect(JSON.parse(await fs.readFile(statePath, 'utf8'))).toEqual({ autostartInitialized: true })
  })

  it('lancement suivant après décochage : ne réactive jamais', async () => {
    const statePath = path.join(dir, 'shell.json')
    await fs.writeFile(statePath, JSON.stringify({ autostartInitialized: true }))
    const l = login(false)
    await initAutostart({ statePath, login: l, log: log() })
    expect(l.set).not.toHaveBeenCalled()
  })

  it('shell.json illisible : traité comme un premier lancement, sans exception', async () => {
    const statePath = path.join(dir, 'shell.json')
    await fs.writeFile(statePath, '{pas du json')
    const l = login(false)
    await initAutostart({ statePath, login: l, log: log() })
    expect(l.set).toHaveBeenCalledWith(true)
  })

  it('dossier absent : créé', async () => {
    const statePath = path.join(dir, 'sous', 'shell.json')
    await initAutostart({ statePath, login: login(false), log: log() })
    expect(JSON.parse(await fs.readFile(statePath, 'utf8'))).toEqual({ autostartInitialized: true })
  })
})
