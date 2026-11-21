import fs from 'node:fs/promises'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as realSleep } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App, type AppDeps } from '../src/app.js'
import { defaultConfig, emptyDashboard, type AppConfig, type LightsDashboard } from '../src/config/schema.js'
import type { HaPort } from '../src/ha/types.js'
import { FakeDevice } from './fakes/fake-device.js'
import { FakeHa } from './fakes/fake-ha.js'

/** Avance les minuteurs simulés et laisse passer les setImmediate (réels) du Navigator. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await new Promise<void>((r) => setImmediate(r))
  }
}

const touchKey = (key: number) => ({ changedTouches: [{ x: 0, y: 0, target: { screen: 'center', key } }] })

describe('createApp', () => {
  let dir: string
  let app: App | null
  let devices: FakeDevice[]
  let devicePaths: (string | null)[]
  let has: FakeHa[]
  let createHa: ReturnType<typeof vi.fn<(ha: AppConfig['ha']) => HaPort>>
  let log: AppDeps['log']

  const deps = (): AppDeps => ({
    configDir: dir,
    log,
    startEditor: false,
    createDevice: (p) => {
      devicePaths.push(p)
      return async () => {
        const d = new FakeDevice()
        devices.push(d)
        return d
      }
    },
    createHa: createHa as unknown as AppDeps['createHa'],
  })

  const start = async (): Promise<App> => {
    app = await createApp(deps())
    await settle()
    return app
  }

  const withChange = (a: App, change: (c: AppConfig) => void): AppConfig => {
    const c = structuredClone(a.store.get())
    change(c)
    return c
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lha-app-'))
    app = null
    devices = []
    devicePaths = []
    has = []
    createHa = vi.fn(() => {
      const h = new FakeHa()
      h.setEntity('light.salon', 'off')
      has.push(h)
      return h
    })
    log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  })

  afterEach(async () => {
    await app?.stop()
    vi.useRealTimers()
    // L'écriture de state.json (non attendue par le Navigator) peut encore être en cours.
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  })

  it('end_to_end_toggle', async () => {
    const a = await start()
    await a.store.update(withChange(a, (c) => { (c.buttons[0] as LightsDashboard).keys[0] = { entityId: 'light.salon' } }))
    await settle()
    devices[0]!.emit('touchstart', touchKey(0))
    await settle()
    expect(has[0]!.calls).toContainEqual({ domain: 'light', service: 'toggle', data: undefined, target: { entity_id: 'light.salon' } })
    expect(devices[0]!.callsOf('vibrate').map((c) => c.args[0])).toContain(0x01)
  })

  it('config_change_rebuilds_navigator', async () => {
    const a = await start()
    expect(a.navigator.dashboard(7)).toBeNull()
    await a.store.update(withChange(a, (c) => { c.buttons[7] = emptyDashboard('lights', 7) }))
    await settle()
    devices[0]!.emit('down', { id: 7 })
    await settle()
    expect(a.navigator.activeIndex()).toBe(7)
  })

  it('ha_section_change_recreates_client', async () => {
    const a = await start()
    const proxy = a.ha()
    const close0 = vi.spyOn(has[0]!, 'close')
    await a.store.update(withChange(a, (c) => {
      c.ha.url = 'https://hass.example.net'
      ;(c.buttons[0] as LightsDashboard).keys[0] = { entityId: 'light.salon' }
    }))
    await settle()
    expect(close0).toHaveBeenCalledTimes(1)
    expect(createHa).toHaveBeenCalledTimes(2)
    expect(createHa.mock.calls[1]![0].url).toBe('https://hass.example.net')
    expect(a.ha()).toBe(proxy)
    devices[0]!.emit('touchstart', touchKey(0))
    await settle()
    expect(has[0]!.calls).toEqual([])
    expect(has[1]!.calls.map((c) => `${c.domain}.${c.service}`)).toEqual(['light.toggle'])
  })

  it('un changement hors de la section ha ne recrée pas le client', async () => {
    const a = await start()
    await a.store.update(withChange(a, (c) => { c.buttons[7] = emptyDashboard('weather', 7) }))
    await settle()
    expect(createHa).toHaveBeenCalledTimes(1)
  })

  it('brightness_change_applied', async () => {
    const a = await start()
    await a.store.update(withChange(a, (c) => { c.device.brightness = 0.5 }))
    await settle()
    expect(devices[0]!.callsOf('setBrightness').map((c) => c.args[0]).at(-1)).toBe(0.5)
  })

  it('startup_applies_brightness_1', async () => {
    await start()
    expect(devices).toHaveLength(1)
    expect(devices[0]!.callsOf('setBrightness').map((c) => c.args[0])).toEqual([1])
  })

  it('la console reçoit une image et les LED au démarrage', async () => {
    await start()
    expect(devices[0]!.callsOf('refresh').length).toBeGreaterThan(0)
    expect(devices[0]!.callsOf('setButtonColor').length).toBeGreaterThanOrEqual(8)
  })

  it('un changement de device.path redémarre la liaison avec le nouveau chemin', async () => {
    const a = await start()
    const oldLink = a.device
    await a.store.update(withChange(a, (c) => {
      c.device.path = 'COM9'
      ;(c.buttons[0] as LightsDashboard).keys[0] = { entityId: 'light.salon' }
    }))
    await settle()
    expect(devicePaths).toEqual([null, 'COM9'])
    expect(devices[0]!.callsOf('close').length).toBeGreaterThan(0)
    expect(a.device).not.toBe(oldLink)
    expect(a.device.status()).toBe('connected')
    expect(devices[1]!.callsOf('setBrightness').map((c) => c.args[0])).toEqual([1])
    // L'ancienne console n'est plus écoutée ; la nouvelle pilote le Navigator et reçoit les vibrations.
    devices[1]!.emit('touchstart', touchKey(0))
    await settle()
    expect(has[0]!.calls.map((c) => `${c.domain}.${c.service}`)).toEqual(['light.toggle'])
    expect(devices[1]!.callsOf('vibrate').map((c) => c.args[0])).toContain(0x01)
    expect(devices[1]!.callsOf('refresh').length).toBeGreaterThan(0)
  })

  it('ha_status_change_rerenders', async () => {
    const a = await start()
    const present = vi.spyOn(a.device, 'present')
    has[0]!.setStatus({ state: 'offline', reason: 'network' })
    await settle()
    expect(present).toHaveBeenCalledTimes(1)
    has[0]!.setStatus({ state: 'online', reason: null })
    await settle()
    expect(present).toHaveBeenCalledTimes(2)
  })

  it('ha_status_change_rerenders_after_replace_and_device_switch', async () => {
    const a = await start()
    await a.store.update(withChange(a, (c) => { c.ha.url = 'https://hass.example.net'; c.device.path = 'COM9' }))
    await settle()
    expect(devices).toHaveLength(2)
    const present = vi.spyOn(a.device, 'present')
    has[1]!.setStatus({ state: 'offline', reason: 'network' })
    await settle()
    expect(present).toHaveBeenCalledTimes(1)
    // Le Navigator courant reçoit l'image ; la nouvelle console la dessine.
    expect(devices[1]!.callsOf('refresh').length).toBeGreaterThan(0)
  })

  it('stop_is_clean', async () => {
    const a = await start()
    await a.store.update(withChange(a, (c) => { (c.buttons[0] as LightsDashboard).keys[0] = { entityId: 'light.salon' } }))
    await settle()
    devices[0]!.emit('touchstart', touchKey(0)) // arme le minuteur de confirmation de 3 s
    await settle()
    const close = vi.spyOn(has[0]!, 'close')
    await a.stop()
    app = null
    expect(vi.getTimerCount()).toBe(0)
    expect(close).toHaveBeenCalled()
    expect(devices[0]!.callsOf('close').length).toBeGreaterThan(0)
  })

  it("démarre l'éditeur sur le port configuré, annonce les changements et le referme à l'arrêt", async () => {
    const free = await new Promise<number>((resolve) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)) })
    })
    const cfg = defaultConfig()
    cfg.editor.port = free
    await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(cfg))
    const a = (app = await createApp({ ...deps(), startEditor: true, editorStaticDir: path.join(dir, 'absent') }))
    await settle()
    expect(a.editorUrl).toBe(`http://127.0.0.1:${free}`)
    const messages: unknown[] = []
    const { default: WebSocket } = await import('ws')
    const ws = new WebSocket(`ws://127.0.0.1:${free}/api/live`)
    ws.on('message', (m) => messages.push(JSON.parse(String(m))))
    await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject) })
    await a.store.update(withChange(a, (c) => { c.device.brightness = 0.5 }))
    has[0]!.setStatus({ state: 'offline', reason: 'network' })
    has[0]!.setStatus({ state: 'online', reason: null })
    await new Promise<void>((r) => setImmediate(r))
    await vi.waitFor(() => expect(messages).toEqual(expect.arrayContaining([{ type: 'config' }, { type: 'status' }, { type: 'entities' }])))
    await a.stop()
    app = null
    await new Promise<void>((resolve, reject) => {
      const s = net.connect({ host: '127.0.0.1', port: free })
      s.on('connect', () => { s.destroy(); reject(new Error('le port est resté ouvert')) })
      s.on('error', () => resolve())
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("annonce l'aperçu à l'éditeur au plus une fois par seconde après un rendu ou un changement d'entités", async () => {
    const free = await new Promise<number>((resolve) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)) })
    })
    const cfg = defaultConfig()
    cfg.editor.port = free
    await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(cfg))
    const a = (app = await createApp({ ...deps(), startEditor: true, editorStaticDir: path.join(dir, 'absent') }))
    await settle()
    const messages: { type: string }[] = []
    const { default: WebSocket } = await import('ws')
    const ws = new WebSocket(`ws://127.0.0.1:${free}/api/live`)
    ws.on('message', (m) => messages.push(JSON.parse(String(m))))
    await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject) })
    const previews = () => messages.filter((m) => m.type === 'preview').length
    // Fenêtres du démarrage écoulées.
    await vi.advanceTimersByTimeAsync(3000)
    await realSleep(50)
    messages.length = 0

    // Rafale de changements d'entités (chacun redessine la console) : un seul envoi immédiat…
    for (let i = 0; i < 5; i++) has[0]!.setEntity('light.salon', i % 2 ? 'on' : 'off')
    await settle()
    await vi.waitFor(() => expect(previews()).toBe(1))
    await realSleep(50)
    expect(previews()).toBe(1)
    // … puis un seul envoi en fin de fenêtre, et plus rien sans nouvelle activité.
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(previews()).toBe(2))
    await vi.advanceTimersByTimeAsync(5000)
    await realSleep(50)
    expect(previews()).toBe(2)

    // Un rendu seul (changement de tableau actif) est aussi annoncé.
    devices[0]!.emit('down', { id: 1 })
    await settle()
    await vi.waitFor(() => expect(previews()).toBe(3))
    await a.stop()
    app = null
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejette si la configuration ne peut pas être ouverte, sans rien démarrer', async () => {
    const file = path.join(dir, 'pas-un-dossier')
    await fs.writeFile(file, 'x')
    await expect(createApp({ ...deps(), configDir: file })).rejects.toThrow()
    await settle()
    expect(createHa).not.toHaveBeenCalled()
    expect(devicePaths).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})
