import fs from 'node:fs/promises'
import os from 'node:os'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { defaultConfig, type AppConfig, type CameraDashboard, type CustomDashboard } from '../../src/config/schema.js'
import { ConfigStore } from '../../src/config/store.js'
import { DeviceLink } from '../../src/device/link.js'
import type { ConsoleReleaser, ForceResult } from '../../src/device/release.js'
import { startEditorServer, type LiveMessage } from '../../src/editor/server.js'
import { Actions } from '../../src/ha/actions.js'
import { CameraImageError } from '../../src/ha/types.js'
import type { Logger } from '../../src/log.js'
import { Navigator, type DevicePort } from '../../src/navigator.js'
import { FakeHa } from '../fakes/fake-ha.js'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} }
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

class StubDevice implements DevicePort {
  present = vi.fn()
  setLed = vi.fn()
  vibrate = vi.fn()
  onInput() { return () => {} }
  onStatus() { return () => {} }
}

type Editor = Awaited<ReturnType<typeof startEditorServer>>

describe('serveur de l’éditeur', () => {
  let dir: string
  let store: ConfigStore
  let ha: FakeHa
  let actions: Actions
  let nav: Navigator | null
  let link: DeviceLink
  let editor: Editor | undefined
  let statics: string
  let release: ConsoleReleaser | undefined

  const start = async (staticDir = statics) => {
    editor = await startEditorServer({
      store, ha: () => ha, navigator: () => nav, device: () => link, port: 0, staticDir, log: silent, release,
    })
    return editor
  }
  const ed = (): Editor => editor!
  const port = () => Number(new URL(ed().url).port)
  const hostHeader = () => ({ host: `127.0.0.1:${port()}` })
  const editorHeaders = () => ({ ...hostHeader(), 'x-loupedeck-editor': '1' })
  /** Vraie requête HTTP (fastify.inject ne se charge pas sous vmThreads) ; l'en-tête Host est modifiable. */
  const request = (method: string, url: string, o: { headers?: Record<string, string>; payload?: unknown } = {}) =>
    new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; rawPayload: Buffer; body: string; json: () => any }>((resolve, reject) => {
      const data = o.payload === undefined ? null : typeof o.payload === 'string' ? o.payload : JSON.stringify(o.payload)
      const headers: Record<string, string> = { ...(o.headers ?? hostHeader()) }
      if (data !== null) headers['content-type'] ??= 'application/json'
      const req = http.request({ host: '127.0.0.1', port: port(), method, path: url, headers, setHost: false }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks)
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, rawPayload: raw, body: raw.toString('utf8'), json: () => JSON.parse(raw.toString('utf8')) })
        })
      })
      req.on('error', reject)
      req.end(data)
    })
  const put = (payload: unknown) => request('PUT', '/api/config', { payload, headers: editorHeaders() })
  const post = (url: string) => request('POST', url, { headers: editorHeaders() })
  const get = (url: string, headers: Record<string, string> = hostHeader()) => request('GET', url, { headers })
  const body = (cfg: AppConfig, extra: object = {}) => {
    const { ha: h, ...rest } = structuredClone(cfg)
    return { ...rest, ha: { url: h.url, allowSelfSigned: h.allowSelfSigned }, ...extra }
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lha-editor-'))
    statics = path.join(dir, 'dist')
    store = await ConfigStore.open(dir, silent)
    const cfg = structuredClone(store.get())
    cfg.ha.token = 'SECRET123'
    await store.update(cfg)
    ha = new FakeHa()
    actions = new Actions({ ha, feedback: () => {} })
    link = new DeviceLink({ createDevice: async () => { throw new Error('inutilisé') }, log: silent })
    nav = new Navigator({
      device: new StubDevice(), ha, actions,
      state: { activeButton: () => 0, setActiveButton: async () => {} } as never,
    })
    nav.applyConfig(store.get())
  })

  afterEach(async () => {
    await editor?.close()
    editor = undefined
    release = undefined
    nav?.dispose()
    actions.dispose()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('listens_localhost_only', async () => {
    await start()
    await expect(new Promise<void>((resolve, reject) => {
      const s = net.connect({ host: '::1', port: port() })
      s.on('connect', () => { s.destroy(); resolve() })
      s.on('error', reject)
    })).rejects.toBeDefined()
    expect(ed().url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('rejects_foreign_host', async () => {
    await start()
    for (const host of ['evil.example', `evil.example:${port()}`, '127.0.0.1:1', `[::1]:${port()}`]) {
      expect((await get('/api/status', { host })).statusCode, host).toBe(403)
    }
    expect((await get('/api/status', { host: `127.0.0.1:${port()}` })).statusCode).toBe(200)
    expect((await get('/api/status', { host: `localhost:${port()}` })).statusCode).toBe(200)
  })

  it('rejects_foreign_host_on_websocket_upgrade', async () => {
    await start()
    const ws = new WebSocket(`ws://127.0.0.1:${port()}/api/live`, { headers: { host: 'evil.example' } })
    const code = await new Promise<number>((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
      ws.on('open', () => resolve(101))
      ws.on('error', () => {})
    })
    expect(code).toBe(403)
  })

  it('config_redacts_token', async () => {
    await start()
    const res = await get('/api/config')
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('SECRET123')
    const cfg = res.json()
    expect(cfg.ha).toEqual({ url: store.get().ha.url, allowSelfSigned: false, hasToken: true })
    expect(cfg.loadWarning).toBeNull()
    expect(cfg.buttons).toHaveLength(8)
  })

  it('put_keeps_token_when_absent', async () => {
    await start()
    let res = await put(body(store.get()))
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('SECRET123')
    expect(store.get().ha.token).toBe('SECRET123')
    res = await put(body(store.get(), { newToken: '' }))
    expect(store.get().ha.token).toBe('SECRET123')
    res = await put(body(store.get(), { newToken: '  NEW ' }))
    expect(res.statusCode).toBe(200)
    expect(store.get().ha.token).toBe('NEW')
    expect(res.body).not.toContain('NEW')
    expect(res.json().ha.hasToken).toBe(true)
  })

  it('put_rejects_token_field', async () => {
    await start()
    const b = body(store.get())
    const res = await put({ ...b, ha: { ...b.ha, token: 'x' } })
    expect(res.statusCode).toBe(400)
    expect(store.get().ha.token).toBe('SECRET123')
  })

  it('put_invalid_400', async () => {
    await start()
    const res = await put(body(store.get(), { buttons: [] }))
    expect(res.statusCode).toBe(400)
    expect(res.json().issues.length).toBeGreaterThan(0)
    const bad = await request('PUT', '/api/config', { payload: '[1]', headers: editorHeaders() })
    expect(bad.statusCode).toBe(400)
  })

  it('put_placement_400', async () => {
    await start()
    ha.setEntity('light.lampe', 'on', { supported_color_modes: ['onoff'] })
    const cfg = structuredClone(store.get())
    ;(cfg.buttons[0] as CustomDashboard).strips.knobTL = { kind: 'dimmer', entityId: 'light.lampe' }
    const res = await put(body(cfg))
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain("n'est pas gradable")
    expect(store.get().buttons[0]).toEqual(defaultConfig().buttons[0])
    // Entité inconnue de HA : acceptée.
    const unknown = structuredClone(store.get())
    ;(unknown.buttons[0] as CustomDashboard).strips.knobTL = { kind: 'dimmer', entityId: 'light.inconnue' }
    expect((await put(body(unknown))).statusCode).toBe(200)
    // Mauvais domaine sur une touche.
    ha.setEntity('sensor.t', '20', { device_class: 'temperature' })
    const wrong = structuredClone(store.get())
    ;(wrong.buttons[0] as CustomDashboard).keys[0] = { entityId: 'sensor.t' }
    expect((await put(body(wrong))).statusCode).toBe(400)
  })

  it('put_alert_sensor_placement_400', async () => {
    await start()
    ha.setEntity('light.salon', 'on', {})
    const cfg = structuredClone(store.get())
    ;(cfg.buttons[3] as CameraDashboard).alert = { enabled: true, sensors: ['light.salon'] }
    const res = await put(body(cfg))
    expect(res.statusCode).toBe(400)
    expect(res.json().issues[0]).toContain('Bouton 4, alerte (light.salon)')
  })

  describe('export et import des réglages', () => {
    const importFile = (payload: unknown) => request('POST', '/api/config/import', { payload, headers: editorHeaders() })
    const exported = async () => (await get('/api/config/export')).json()

    it('export_is_a_download_without_the_token', async () => {
      await start()
      const res = await get('/api/config/export')
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="loupedeck-ha-\d{4}-\d{2}-\d{2}\.json"$/)
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.body).not.toContain('SECRET123')
      expect(res.body.toLowerCase()).not.toContain('token')
      const { ha: h, device, ...rest } = store.get()
      expect(res.json()).toMatchObject({ format: 'loupedeck-ha', config: { ...rest, device: { brightness: device.brightness }, ha: { url: h.url, allowSelfSigned: h.allowSelfSigned } } })
    })

    it('import_restores_everything_and_keeps_the_token_of_the_same_address', async () => {
      await start()
      const file = await exported()
      const changed = structuredClone(store.get())
      changed.device.brightness = 0.2
      changed.buttons[0] = null
      await store.update(changed)
      const res = await importFile(file)
      expect(res.statusCode).toBe(200)
      expect(res.body).not.toContain('SECRET123')
      expect(res.json()).toMatchObject({ tokenRequired: false, config: { device: { brightness: 1 }, ha: { hasToken: true } } })
      expect(store.get().buttons[0]).not.toBeNull()
      expect(store.get().ha.token).toBe('SECRET123')
      expect((await post('/api/config/undo')).json().device.brightness).toBe(0.2)
    })

    it('import_never_sends_the_saved_token_to_another_address', async () => {
      await start()
      const file = await exported()
      file.config.ha.url = 'https://ailleurs.example'
      const res = await importFile(file)
      expect(res.json()).toMatchObject({ tokenRequired: true, config: { ha: { url: 'https://ailleurs.example', hasToken: false } } })
      expect(store.get().ha.token).toBe('')
      await post('/api/config/undo')
      expect(store.get().ha.token).toBe('SECRET123')
    })

    it('import_never_turns_certificate_checks_off', async () => {
      await start()
      const file = await exported()
      file.config.ha.allowSelfSigned = true
      expect((await importFile(file)).json()).toMatchObject({ tokenRequired: false, tlsKept: true, config: { ha: { allowSelfSigned: false } } })
      // Une fois le certificat auto-signé accepté ici, l'import le garde ; il peut toujours durcir.
      const relaxed = structuredClone(store.get())
      relaxed.ha.allowSelfSigned = true
      await store.update(relaxed)
      expect((await importFile(file)).json()).toMatchObject({ tlsKept: false, config: { ha: { allowSelfSigned: true } } })
      file.config.ha.allowSelfSigned = false
      expect((await importFile(file)).json()).toMatchObject({ tlsKept: false, config: { ha: { allowSelfSigned: false } } })
      // Nouvelle adresse : un jeton va y être saisi, la case reste à cocher par l'utilisateur.
      file.config.ha = { url: 'https://ailleurs.example', allowSelfSigned: true }
      await store.update(relaxed)
      expect((await importFile(file)).json()).toMatchObject({ tokenRequired: true, tlsKept: true, config: { ha: { allowSelfSigned: false } } })
    })

    it('import_keeps_the_port_of_this_computer', async () => {
      await start()
      const cfg = structuredClone(store.get())
      cfg.device.path = 'COM4'
      await store.update(cfg)
      const file = await exported()
      expect(file.config.device).toEqual({ brightness: 1 })
      file.config.device = { path: '\\\\serveur\\partage', brightness: 0.4 }
      expect((await importFile(file)).statusCode).toBe(200)
      expect(store.get().device).toEqual({ path: 'COM4', brightness: 0.4 })
    })

    it('import_ignores_a_token_found_in_the_file', async () => {
      await start()
      // Copie à la main de config.json : configuration nue, jeton compris.
      const raw = structuredClone(store.get())
      raw.ha.token = 'JETON-DU-FICHIER'
      expect((await importFile(raw)).statusCode).toBe(200)
      expect(store.get().ha.token).toBe('SECRET123')
    })

    it('import_migrates_a_v1_configuration', async () => {
      await start()
      const keys = Array.from({ length: 12 }, () => null as unknown)
      keys[0] = { entityId: 'light.salon' }
      const dimmers = { knobTL: null, knobCL: null, knobBL: null, knobTR: null, knobCR: null, knobBR: null }
      const { buttons: _b, ...rest } = structuredClone(store.get())
      const lights = { type: 'lights', name: 'Lumières', color: '#FFB300', keys, dimmers }
      const res = await importFile({ ...rest, version: 1, buttons: [lights, ...Array.from({ length: 7 }, () => null)] })
      expect(res.statusCode).toBe(200)
      expect((store.get().buttons[0] as CustomDashboard).keys[0]).toEqual({ kind: 'toggle', entityId: 'light.salon' })
    })

    it('import_refuses_anything_else_and_changes_nothing', async () => {
      await start()
      const before = structuredClone(store.get())
      for (const bad of [[], {}, { format: 'autre', config: {} }, 'null']) {
        const res = await importFile(bad)
        expect(res.statusCode, JSON.stringify(bad)).toBe(400)
        expect(res.json().error).toBe('Ce fichier ne contient pas de réglages Loupedeck HA')
      }
      const file = await exported()
      file.config.buttons = []
      const res = await importFile(file)
      expect(res.statusCode).toBe(400)
      expect(res.json().issues.length).toBeGreaterThan(0)
      expect((await request('POST', '/api/config/import', { payload: file })).statusCode).toBe(403)
      expect(store.get()).toEqual(before)
    })

    it('import_checks_entities_of_the_same_home', async () => {
      await start()
      ha.setEntity('sensor.t', '20', {})
      const file = await exported()
      file.config.buttons[0].keys[0] = { kind: 'toggle', entityId: 'sensor.t' }
      expect((await importFile(file)).statusCode).toBe(400)
      // Autre maison : les entités connues ici ne disent rien de la sienne.
      file.config.ha.url = 'https://ailleurs.example'
      expect((await importFile(file)).statusCode).toBe(200)
    })
  })

  describe('libérer la console', () => {
    const RESULT: ForceResult = { connected: true, reason: null, killed: ['LogiPluginService.exe'], failed: [], agentRunning: true }
    const force = (payload: unknown, headers = editorHeaders()) => request('POST', '/api/console/force', { payload, headers })

    it('lists_holders_and_forces', async () => {
      const holders = [{ name: 'LogiPluginService.exe', pid: 7, label: 'Logi Plugin Service', agent: false }]
      const forceFn = vi.fn(async () => RESULT)
      release = { holders: async () => holders, force: forceFn }
      await start()
      expect((await get('/api/console/holders')).json()).toEqual(holders)
      expect((await force({})).json()).toEqual(RESULT)
      expect(forceFn).toHaveBeenLastCalledWith({ includeAgent: false })
      await force({ includeAgent: true })
      expect(forceFn).toHaveBeenLastCalledWith({ includeAgent: true })
      // Seul un vrai booléen ferme aussi Logi Options+.
      await force({ includeAgent: 'oui', name: 'explorer.exe' })
      expect(forceFn).toHaveBeenLastCalledWith({ includeAgent: false })
    })

    it('another_site_cannot_force', async () => {
      const forceFn = vi.fn(async () => RESULT)
      release = { holders: async () => [], force: forceFn }
      await start()
      expect((await force({}, hostHeader() as never)).statusCode).toBe(403)
      expect((await force({}, { ...editorHeaders(), origin: 'https://evil.example' } as never)).statusCode).toBe(403)
      expect(forceFn).not.toHaveBeenCalled()
    })

    it('failure_is_reported', async () => {
      release = { holders: async () => { throw new Error('x') }, force: async () => { throw new Error('x') } }
      await start()
      const res = await force({})
      expect(res.statusCode).toBe(500)
      expect(res.json()).toEqual({ error: 'Impossible de lister ou de fermer les programmes' })
      expect((await get('/api/console/holders')).statusCode).toBe(500)
    })

    it('status_tells_why_the_console_is_not_connected', async () => {
      await start()
      const b = new DeviceLink({ createDevice: async () => { throw new Error('Opening COM4: Access denied') }, log: silent })
      link = b
      b.start()
      await vi.waitFor(() => expect(b.problem()).toBe('busy'))
      expect((await get('/api/status')).json().device).toEqual({ status: 'disconnected', firmware: null, problem: 'busy' })
      await b.stop()
    })
  })

  it('undo_flow', async () => {
    await start()
    const cfg = structuredClone(store.get())
    cfg.device.brightness = 0.5
    expect((await put(body(cfg))).statusCode).toBe(200)
    const undo = await post('/api/config/undo')
    expect(undo.statusCode).toBe(200)
    expect(undo.json().device.brightness).toBe(1)
    while (await store.undo()) { /* vide l'historique (dont la mise en place du jeton) */ }
    const again = await post('/api/config/undo')
    expect(again.statusCode).toBe(409)
    expect(again.json()).toEqual({ error: 'Rien à annuler' })
  })

  it('entities_sorted_and_offline_503', async () => {
    await start()
    ha.setStatus({ state: 'offline', reason: 'network' })
    const off = await get('/api/entities')
    expect(off.statusCode).toBe(503)
    expect(off.json()).toEqual({ error: 'Home Assistant hors ligne' })
    ha.setStatus({ state: 'online', reason: null })
    ha.setEntity('light.b', 'on', { friendly_name: 'Zèbre' })
    ha.setEntity('light.a', 'on', { friendly_name: 'Abeille' })
    const ok = await get('/api/entities')
    expect(ok.statusCode).toBe(200)
    expect(ok.json().map((e: { name: string }) => e.name)).toEqual(['Abeille', 'Zèbre'])
  })

  it('preview_png', async () => {
    await start()
    const res = await get('/api/preview/0.png')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.rawPayload.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    expect((await get('/api/preview/7.png')).statusCode).toBe(404)
    expect((await get('/api/preview/9.png')).statusCode).toBe(404)
  })

  it('preview_503_during_switch', async () => {
    await start()
    const saved = nav
    nav = null
    const res = await get('/api/preview/0.png')
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'Console en cours de reconnexion' })
    expect((await get('/api/status')).json().activeButton).toBe(-1)
    nav = saved
  })

  it('preview_camera_still_cached_and_refreshed', async () => {
    const cfg = structuredClone(store.get())
    ;(cfg.buttons[4] as CameraDashboard).entityId = 'camera.salon'
    await store.update(cfg)
    nav!.applyConfig(store.get())
    await start()
    const fetchSpy = vi.spyOn(ha, 'fetchCameraImage')
    expect((await get('/api/preview/4.png')).statusCode).toBe(200)
    expect((await get('/api/preview/4.png')).statusCode).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith('camera.salon', { width: 480, height: 270 })
    await get('/api/preview/4.png?refreshCamera=1')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    // Échec : on dessine tout de même la vue telle quelle.
    ha.cameraImage = new CameraImageError('boom')
    const res = await get('/api/preview/4.png?refreshCamera=1')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
  })

  it('status_shape', async () => {
    await start()
    const res = await get('/api/status')
    expect(res.json()).toEqual({
      device: { status: 'disconnected', firmware: null, problem: null },
      ha: { state: 'online', reason: null },
      activeButton: 0,
    })
  })

  it('serves_placeholder_when_not_built_and_static_with_spa_fallback', async () => {
    await start()
    const page = await get('/')
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toContain('text/html')
    expect(page.body).toContain('Éditeur non compilé')
    expect(page.body).toContain('pnpm run editor:build')
    await ed().close()

    await fs.mkdir(path.join(statics, 'assets'), { recursive: true })
    await fs.writeFile(path.join(statics, 'index.html'), '<html>EDITEUR</html>')
    await fs.writeFile(path.join(statics, 'assets', 'a.js'), 'console.log(1)')
    await start()
    expect((await get('/')).body).toContain('EDITEUR')
    expect((await get('/assets/a.js')).body).toBe('console.log(1)')
    expect((await get('/tableaux/3')).body).toContain('EDITEUR')
    expect((await get('/api/inconnu')).statusCode).toBe(404)
  })

  it('csrf_origin_and_custom_header', async () => {
    await start()
    const evil = { ...hostHeader(), origin: 'https://evil.example' }
    const good = { ...hostHeader(), origin: `http://127.0.0.1:${port()}` }
    expect((await get('/api/config', evil)).statusCode).toBe(403)
    expect((await get('/api/config', good)).statusCode).toBe(200)
    expect((await get('/api/config', { ...hostHeader(), origin: `http://localhost:${port()}` })).statusCode).toBe(200)
    expect((await request('PUT', '/api/config', { payload: body(store.get()), headers: evil })).statusCode).toBe(403)
    expect((await request('POST', '/api/config/undo', { headers: evil })).statusCode).toBe(403)
    expect((await request('POST', '/api/config/undo', { headers: { ...evil, 'x-loupedeck-editor': '1' } })).statusCode).toBe(403)
    // Ni Origin ni en-tête personnalisé : refusé ; avec l'un ou l'autre : accepté.
    expect((await request('POST', '/api/config/undo', { headers: hostHeader() })).statusCode).toBe(403)
    expect((await request('PUT', '/api/config', { payload: body(store.get()), headers: hostHeader() })).statusCode).toBe(403)
    expect((await request('POST', '/api/config/undo', { headers: editorHeaders() })).statusCode).toBe(200)
    expect((await request('PUT', '/api/config', { payload: body(store.get()), headers: good })).statusCode).toBe(200)
    const ws = new WebSocket(`ws://127.0.0.1:${port()}/api/live`, { headers: { origin: 'https://evil.example' } })
    const code = await new Promise<number>((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
      ws.on('open', () => resolve(101))
      ws.on('error', () => {})
    })
    expect(code).toBe(403)
    ws.terminate()
  })

  it('static_traversal_guard', async () => {
    await fs.mkdir(statics, { recursive: true })
    await fs.writeFile(path.join(statics, 'index.html'), '<html>EDITEUR</html>')
    await fs.writeFile(path.join(dir, 'secret.txt'), 'TOPSECRET')
    await fs.mkdir(path.join(dir, 'dist2'))
    await fs.writeFile(path.join(dir, 'dist2', 'x.txt'), 'TOPSECRET')
    await start()
    for (const url of ['/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt', '/..%5c..%5csecret.txt', '/../secret.txt', '/..%2fdist2%2fx.txt', '/%2e%2e%2fdist2/x.txt', '/assets/..%2f..%2f..%2fsecret.txt']) {
      const res = await get(url)
      expect(res.body, url).not.toContain('TOPSECRET')
      expect([200, 400, 403, 404], url).toContain(res.statusCode)
    }
  })

  it('put_requires_json_content_type', async () => {
    await start()
    const res = await request('PUT', '/api/config', { payload: JSON.stringify(body(store.get())), headers: { ...editorHeaders(), 'content-type': 'text/plain' } })
    expect(res.statusCode).toBe(415)
  })

  it('put_url_change_requires_new_token', async () => {
    await start()
    const cfg = body(store.get())
    cfg.ha.url = 'https://autre.example'
    let res = await put(cfg)
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Saisissez à nouveau le jeton pour une nouvelle adresse Home Assistant')
    expect(store.get().ha.token).toBe('SECRET123')
    res = await put({ ...cfg, newToken: 'AUTRE' })
    expect(res.statusCode).toBe(200)
    expect(store.get().ha).toMatchObject({ url: 'https://autre.example', token: 'AUTRE' })
    // Même adresse à un slash final ou des espaces près : jeton conservé.
    const same = body(store.get())
    same.ha.url = ` ${store.get().ha.url}/ `
    expect((await put(same)).statusCode).toBe(200)
    expect(store.get().ha.token).toBe('AUTRE')
  })

  it('put_rejects_url_without_http_scheme', async () => {
    await start()
    const cfg = body(store.get())
    cfg.ha.url = 'homeassistant.local:8123'
    const res = await put({ ...cfg, newToken: 'AUTRE' })
    expect(res.statusCode).toBe(400)
    expect(res.json().issues).toContain("ha.url : L'adresse Home Assistant doit commencer par http:// ou https://")
    expect(store.get().ha.token).toBe('SECRET123')
  })

  it('put_does_not_hang_when_entity_list_never_resolves', async () => {
    await ed()?.close()
    editor = await startEditorServer({
      store, ha: () => ha, navigator: () => nav, device: () => link, port: 0, staticDir: statics, log: silent, entityTimeoutMs: 50,
    })
    vi.spyOn(ha, 'listEntityInfo').mockReturnValue(new Promise(() => {}))
    const res = await put(body(store.get()))
    expect(res.statusCode).toBe(200)
  })

  describe('/api/live', () => {
    const open = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port()}/api/live`)
      const messages: LiveMessage[] = []
      const waiters: ((m: LiveMessage) => void)[] = []
      ws.on('message', (data) => {
        const m = JSON.parse(String(data)) as LiveMessage
        const w = waiters.shift()
        if (w) w(m)
        else messages.push(m)
      })
      await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject) })
      return {
        ws,
        next: () => (messages.length ? Promise.resolve(messages.shift()!) : new Promise<LiveMessage>((r) => waiters.push(r))),
      }
    }

    it('live_pushes_config', async () => {
      await start()
      const c = await open()
      const off = store.onChange(() => ed().notify({ type: 'config' })) // app.ts joue ce rôle
      const next = c.next()
      const cfg = structuredClone(store.get())
      cfg.device.brightness = 0.4
      await store.update(cfg)
      expect(await next).toEqual({ type: 'config' })
      off()
      c.ws.close()
    })

    it('live_pushes_active', async () => {
      await start()
      const c = await open()
      const off = nav!.onActiveChange((button) => ed().notify({ type: 'active', button }))
      const next = c.next()
      nav!.handle({ type: 'button', id: 2 })
      expect(await next).toEqual({ type: 'active', button: 2 })
      off()
      c.ws.close()
    })

    it('close_terminates_clients', async () => {
      await start()
      const c = await open()
      const closed = new Promise<void>((r) => c.ws.on('close', () => r()))
      await ed().close()
      await closed
    })
  })

  it('page_commands_reach_home_assistant', async () => {
    await start()
    const cfg = structuredClone(store.get())
    const w = cfg.buttons[2]
    if (w?.type === 'weather') w.entityId = 'weather.home'
    const c = cfg.buttons[3]
    if (c?.type === 'camera') c.entityId = 'camera.porte'
    expect((await put(body(cfg))).statusCode).toBe(200)
    const cmd = (i: number, command: string) => request('POST', `/api/pages/${i}/command`, { payload: { command }, headers: { ...editorHeaders(), 'content-type': 'application/json' } })
    expect((await cmd(2, 'refresh')).statusCode).toBe(200)
    expect((await cmd(3, 'reload')).statusCode).toBe(200)
    expect((await cmd(3, 'refresh')).statusCode).toBe(200)
    expect(ha.calls.map((x) => [x.service, (x.target as { entity_id: string }).entity_id])).toEqual([
      ['update_entity', 'weather.home'], ['reload_config_entry', 'camera.porte'],
    ])
    expect((await cmd(2, 'reload')).statusCode).toBe(400)
    expect((await cmd(4, 'reload')).statusCode).toBe(400) // caméra sans entité
    expect((await cmd(9, 'reload')).statusCode).toBe(404)
  })

  it('put_accepts_v1_config_and_migrates_it', async () => {
    await start()
    const cfg = body(store.get()) as Record<string, any>
    cfg.version = 1
    cfg.buttons[0] = { type: 'lights', name: 'Lumières', color: '#FFB300', keys: Array(12).fill(null), dimmers: { knobTL: null, knobCL: null, knobBL: null, knobTR: null, knobCR: null, knobBR: null } }
    cfg.buttons[0].keys[0] = { entityId: 'switch.cafe' }
    const res = await put(cfg)
    expect(res.statusCode).toBe(200)
    expect(store.get().version).toBe(2)
    const b = store.get().buttons[0]
    expect(b?.type).toBe('custom')
    expect(b?.type === 'custom' && b.keys[0]).toEqual({ kind: 'toggle', entityId: 'switch.cafe' })
  })

  it('try_mode_input_reaches_the_page', async () => {
    await start()
    ha.setEntity('switch.cafe', 'off', { friendly_name: 'Café' })
    const cfg = structuredClone(store.get())
    const b = cfg.buttons[0]
    if (b?.type === 'custom') b.keys[1] = { kind: 'toggle', entityId: 'switch.cafe' }
    expect((await put(body(cfg))).statusCode).toBe(200)
    nav!.applyConfig(store.get()) // dans l'application, l'écouteur de la configuration le fait
    const input = (i: number, payload: unknown) => request('POST', `/api/pages/${i}/input`, { payload, headers: { ...editorHeaders(), 'content-type': 'application/json' } })
    expect((await input(0, { type: 'tap', target: { kind: 'key', index: 1 } })).statusCode).toBe(200)
    expect(ha.calls).toEqual([{ domain: 'switch', service: 'toggle', data: undefined, target: { entity_id: 'switch.cafe' } }])
    expect((await input(0, { type: 'tap', target: { kind: 'key', index: 12 } })).statusCode).toBe(400)
    expect((await input(0, { type: 'knobTurn', knob: 'knobXX', delta: 1 })).statusCode).toBe(400)
    expect((await input(0, { type: 'button', id: 2 })).statusCode).toBe(400)
    expect((await input(7, { type: 'knobPress', knob: 'knobTL' })).statusCode).toBe(404)
    expect((await request('POST', '/api/pages/0/input', { payload: { type: 'tap', target: { kind: 'key', index: 1 } }, headers: { ...hostHeader(), 'content-type': 'application/json' } })).statusCode).toBe(403)
    expect(ha.calls).toHaveLength(1)
  })
})
