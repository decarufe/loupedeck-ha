import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConfigStore, ConfigValidationError } from '../../src/config/store.js'
import { defaultConfig, type AppConfig } from '../../src/config/schema.js'
import type { Logger } from '../../src/log.js'

const log: Logger = { debug() {}, info() {}, warn() {}, error() {} }
let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ldha-cfg-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const file = () => path.join(dir, 'config.json')
const withUrl = (c: AppConfig, url: string): AppConfig => ({ ...c, ha: { ...c.ha, url } })

describe('ConfigStore', () => {
  it('missing_file_writes_defaults', async () => {
    const s = await ConfigStore.open(dir, log)
    expect(JSON.parse(await fs.readFile(file(), 'utf8'))).toEqual(defaultConfig())
    expect(s.get()).toEqual(defaultConfig())
    expect(s.loadWarning).toBeNull()
  })

  it('defaults_layout', async () => {
    const c = (await ConfigStore.open(dir, log)).get()
    expect(c.buttons).toHaveLength(8)
    expect(c.buttons.map(b => b?.type ?? null)).toEqual(['lights', 'climate', 'weather', 'camera', 'camera', 'camera', 'camera', null])
    expect(c.device.brightness).toBe(1)
    expect(c.ha.url).toBe('http://homeassistant.local:8123')
    expect(c.editor.port).toBe(8765)
    expect(c.buttons.map(b => b?.name)).toEqual(['Lumières', 'Température', 'Météo', 'Caméra 1', 'Caméra 2', 'Caméra 3', 'Caméra 4', undefined])
    expect(c.buttons.map(b => b?.color)).toEqual(['#FFB300', '#FF5722', '#03A9F4', '#9C27B0', '#9C27B0', '#9C27B0', '#9C27B0', undefined])
  })

  it('corrupt_config_quarantined', async () => {
    await fs.writeFile(file(), '{oops')
    const s = await ConfigStore.open(dir, log)
    const q = (await fs.readdir(dir)).filter(f => /^config\.invalid-.*\.json$/.test(f))
    expect(q).toHaveLength(1)
    expect(q[0]).not.toContain(':')
    expect(await fs.readFile(path.join(dir, q[0]!), 'utf8')).toBe('{oops')
    expect(s.get()).toEqual(defaultConfig())
    expect(s.loadWarning).toContain('invalide')
  })

  it('quarantine_warning_never_contains_the_token', async () => {
    // Jeton non mis entre guillemets : le message de JSON.parse en recopierait un extrait.
    await fs.writeFile(file(), '{"version":1,"ha":{"url":"http://ha.local:8123","token":eyJhbGciOiFAKETOKEN0123456789}}')
    const lines: string[] = []
    const spy: Logger = {
      debug: (m, o) => { lines.push(m + JSON.stringify(o ?? {})) },
      info: (m, o) => { lines.push(m + JSON.stringify(o ?? {})) },
      warn: (m, o) => { lines.push(m + JSON.stringify(o ?? {})) },
      error: (m, o) => { lines.push(m + JSON.stringify(o ?? {})) },
    }
    const s = await ConfigStore.open(dir, spy)
    const q = (await fs.readdir(dir)).find(f => f.startsWith('config.invalid-'))!
    expect(s.loadWarning).toBe(`Fichier de configuration invalide : mis de côté sous ${q} ; configuration par défaut utilisée.`)
    const all = [s.loadWarning, ...lines].join('\n')
    expect(lines.length).toBeGreaterThan(0)
    for (const part of ['eyJ', 'FAKETOKEN', '0123456789', 'Unexpected']) expect(all).not.toContain(part)
  })

  it('schema-invalid config is quarantined too', async () => {
    await fs.writeFile(file(), JSON.stringify({ version: 1 }))
    const s = await ConfigStore.open(dir, log)
    expect(s.loadWarning).toContain('invalide')
    expect((await fs.readdir(dir)).some(f => f.startsWith('config.invalid-'))).toBe(true)
  })

  it('loads a valid existing file', async () => {
    const c = withUrl(defaultConfig(), 'https://hass.decarufel.net')
    await fs.writeFile(file(), JSON.stringify(c))
    const s = await ConfigStore.open(dir, log)
    expect(s.get()).toEqual(c)
    expect(s.loadWarning).toBeNull()
  })

  it('update_rejects_invalid', async () => {
    const s = await ConfigStore.open(dir, log)
    const before = await fs.readFile(file(), 'utf8')
    const bad = { ...s.get(), buttons: [] } as AppConfig
    await expect(s.update(bad)).rejects.toBeInstanceOf(ConfigValidationError)
    await expect(s.update(bad)).rejects.toMatchObject({ issues: expect.any(Array) })
    expect(await fs.readFile(file(), 'utf8')).toBe(before)
    expect(s.get()).toEqual(defaultConfig())
  })

  it('update_is_atomic', async () => {
    const s = await ConfigStore.open(dir, log)
    const next = withUrl(s.get(), 'http://10.0.0.5:8123')
    await s.update(next)
    expect((await fs.readdir(dir)).filter(f => f.endsWith('.tmp'))).toEqual([])
    expect(JSON.parse(await fs.readFile(file(), 'utf8'))).toEqual(next)
    expect(s.get()).toEqual(next)
  })

  it('update deep-clones what it stores', async () => {
    const s = await ConfigStore.open(dir, log)
    const next = withUrl(s.get(), 'http://a:1')
    await s.update(next)
    next.ha.url = 'http://mutated'
    expect(s.get().ha.url).toBe('http://a:1')
  })

  it('undo_restores_previous', async () => {
    const s = await ConfigStore.open(dir, log)
    const c0 = s.get()
    const c1 = withUrl(c0, 'http://one:1')
    const c2 = withUrl(c0, 'http://two:2')
    await s.update(c1)
    await s.update(c2)
    expect(await s.undo()).toBe(true)
    expect(s.get()).toEqual(c1)
    expect(JSON.parse(await fs.readFile(file(), 'utf8'))).toEqual(c1)
    expect(await s.undo()).toBe(true)
    expect(s.get()).toEqual(c0)
    expect(await s.undo()).toBe(false)
  })

  it('concurrent_updates_keep_a_coherent_history', async () => {
    const s = await ConfigStore.open(dir, log)
    const c0 = s.get()
    const c1 = withUrl(c0, 'http://one:1')
    const c2 = withUrl(c0, 'http://two:2')
    await Promise.all([s.update(c1), s.update(c2)])
    // Appliquées dans l'ordre d'appel : la dernière gagne, en mémoire comme sur disque.
    expect(s.get()).toEqual(c2)
    expect(JSON.parse(await fs.readFile(file(), 'utf8'))).toEqual(c2)
    expect(await s.undo()).toBe(true)
    expect(s.get()).toEqual(c1)
    expect(await s.undo()).toBe(true)
    expect(s.get()).toEqual(c0)
    expect(await s.undo()).toBe(false)
  })

  it('concurrent_update_and_undo_are_serialized', async () => {
    const s = await ConfigStore.open(dir, log)
    const c0 = s.get()
    const c1 = withUrl(c0, 'http://one:1')
    const c2 = withUrl(c0, 'http://two:2')
    await s.update(c1)
    // update(c2) puis undo() lancés ensemble : équivalent à les exécuter l'un après l'autre.
    const [, undone] = await Promise.all([s.update(c2), s.undo()])
    expect(undone).toBe(true)
    expect(s.get()).toEqual(c1)
    expect(JSON.parse(await fs.readFile(file(), 'utf8'))).toEqual(c1)
    expect(await s.undo()).toBe(true)
    expect(s.get()).toEqual(c0)
    expect(await s.undo()).toBe(false)
  })

  it('a_failed_update_does_not_block_the_next_one', async () => {
    const s = await ConfigStore.open(dir, log)
    const c1 = withUrl(s.get(), 'http://one:1')
    const bad = { ...s.get(), device: { brightness: 7 } } as unknown as AppConfig
    const results = await Promise.allSettled([s.update(bad), s.update(c1)])
    expect(results[0]!.status).toBe('rejected')
    expect(results[1]!.status).toBe('fulfilled')
    expect(s.get()).toEqual(c1)
  })

  it('undo history is capped at 50', async () => {
    const s = await ConfigStore.open(dir, log)
    for (let i = 0; i < 55; i++) await s.update(withUrl(s.get(), `http://h${i}:1`))
    let n = 0
    while (await s.undo()) n++
    expect(n).toBe(50)
  })

  it('onChange_fires_with_prev', async () => {
    const s = await ConfigStore.open(dir, log)
    const calls: [AppConfig, AppConfig][] = []
    const off = s.onChange((c, p) => calls.push([c, p]))
    const c0 = s.get()
    const c1 = withUrl(c0, 'http://one:1')
    await s.update(c1)
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]).toEqual(c1)
    expect(calls[0]![1]).toEqual(c0)
    await s.undo()
    expect(calls).toHaveLength(2)
    expect(calls[1]![0]).toEqual(c0)
    expect(calls[1]![1]).toEqual(c1)
    off()
    await s.update(c1)
    expect(calls).toHaveLength(2)
  })
})
