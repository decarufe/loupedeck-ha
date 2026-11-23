import { afterEach, describe, expect, it, vi } from 'vitest'
import { HaClient, toWebSocketUrl } from '../../src/ha/client.js'
import { CameraImageError, type HaStatus } from '../../src/ha/types.js'
import type { Logger } from '../../src/log.js'
import { FakeHa } from '../fakes/fake-ha.js'
import { MockHaServer } from '../fakes/mock-ha-server.js'

const GOOD = 'bon-jeton-secret-1234567890'
const BAD = 'mauvais-jeton-secret-0987654321'
// Jeton collé avec un retour à la ligne au milieu (JWT replié).
const NL_PART1 = 'eyJhbGciOiJIUzI1NiJ9-PARTIE-UNE'
const NL_PART2 = 'eyJzdWIiOiJsb3VwZWRlY2sifQ-PARTIE-DEUX'

/** Tous les appels au journal, sur l'ensemble des scénarios (vérifiés par token_never_logged). */
const logCalls: unknown[][] = []
const log: Logger = {
  debug: (...a) => { logCalls.push(['debug', ...a]) },
  info: (...a) => { logCalls.push(['info', ...a]) },
  warn: (...a) => { logCalls.push(['warn', ...a]) },
  error: (...a) => { logCalls.push(['error', ...a]) },
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const waitOpts = { timeout: 3000, interval: 10 }

let servers: MockHaServer[] = []
let clients: HaClient[] = []

async function startServer(): Promise<MockHaServer> {
  const s = await MockHaServer.start({ token: GOOD })
  servers.push(s)
  return s
}

function makeClient(
  server: MockHaServer,
  o: { token?: string; url?: string; retryDelayMs?: number; heartbeatIntervalMs?: number; heartbeatTimeoutMs?: number } = {},
): HaClient {
  const c = new HaClient({
    url: o.url ?? server.url,
    token: o.token ?? GOOD,
    allowSelfSigned: false,
    log,
    retryDelayMs: o.retryDelayMs ?? 50,
    heartbeatIntervalMs: o.heartbeatIntervalMs,
    heartbeatTimeoutMs: o.heartbeatTimeoutMs,
  })
  clients.push(c)
  return c
}

async function onlineClient(server: MockHaServer): Promise<HaClient> {
  const c = makeClient(server)
  c.start()
  await vi.waitFor(() => {
    expect(c.status()).toEqual({ state: 'online', reason: null })
    expect(c.entities()['light.salon']).toBeDefined()
  }, waitOpts)
  return c
}

function withoutId(m: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, ...rest } = m
  return rest
}

afterEach(async () => {
  for (const c of clients) c.close()
  clients = []
  for (const s of servers) await s.close()
  servers = []
})

describe('HaClient', () => {
  it('ws_url', () => {
    expect(toWebSocketUrl('https://hass.example:8123/')).toBe('wss://hass.example:8123/api/websocket')
    expect(toWebSocketUrl('http://homeassistant.local:8123')).toBe('ws://homeassistant.local:8123/api/websocket')
  })

  it('auth_ok_populates_entities', async () => {
    const server = await startServer()
    const c = makeClient(server)
    expect(c.status()).toEqual({ state: 'connecting', reason: null })
    c.start()
    await vi.waitFor(() => {
      expect(c.status()).toEqual({ state: 'online', reason: null })
      expect(c.entities()['light.salon'].attributes.brightness).toBe(153)
    }, waitOpts)
    expect(c.entities()['light.salon'].state).toBe('on')
  })

  it('on_entities_receives_updates', async () => {
    const server = await startServer()
    const c = await onlineClient(server)
    const seen: number[] = []
    const off = c.onEntities((e) => { seen.push(e['light.salon'].attributes.brightness) })
    server.pushState('light.salon', 'on', { brightness: 200 })
    await vi.waitFor(() => expect(seen).toContain(200), waitOpts)
    expect(c.entities()['light.salon'].attributes.brightness).toBe(200)
    off()
    server.pushState('light.salon', 'on', { brightness: 10 })
    await vi.waitFor(() => expect(c.entities()['light.salon'].attributes.brightness).toBe(10), waitOpts)
    expect(seen).not.toContain(10)
  })

  it('auth_invalid_no_retry', async () => {
    const server = await startServer()
    const c = makeClient(server, { token: BAD, retryDelayMs: 100 })
    c.start()
    await vi.waitFor(() => expect(c.status()).toEqual({ state: 'offline', reason: 'auth' }), waitOpts)
    await sleep(350)
    expect(server.connections).toBe(1)
    expect(c.status()).toEqual({ state: 'offline', reason: 'auth' })
  })

  it('initial_network_failure_retries', async () => {
    const server = await startServer()
    server.refuse = true
    const c = makeClient(server, { retryDelayMs: 50 })
    c.start()
    await vi.waitFor(() => {
      expect(c.status()).toEqual({ state: 'offline', reason: 'network' })
      expect(server.refused).toBeGreaterThanOrEqual(2)
    }, waitOpts)
    server.refuse = false
    await vi.waitFor(() => expect(c.status()).toEqual({ state: 'online', reason: null }), waitOpts)
  })

  it('network_drop_reconnects', async () => {
    const server = await startServer()
    const c = await onlineClient(server)
    const statuses: HaStatus[] = []
    c.onStatus((s) => { statuses.push(s) })
    server.dropAll()
    await vi.waitFor(() => {
      expect(statuses).toContainEqual({ state: 'offline', reason: 'network' })
      expect(c.status()).toEqual({ state: 'online', reason: null })
    }, waitOpts)
    expect(statuses.at(-1)).toEqual({ state: 'online', reason: null })
    expect(server.connections).toBe(2)
    // L'abonnement aux entités est rétabli sur la nouvelle connexion.
    server.pushState('light.salon', 'off', { brightness: 0 })
    await vi.waitFor(() => expect(c.entities()['light.salon'].state).toBe('off'), waitOpts)
  })

  it('heartbeat_pings_a_responsive_server_and_stays_online', async () => {
    const server = await startServer()
    const c = makeClient(server, { heartbeatIntervalMs: 30, heartbeatTimeoutMs: 100 })
    const statuses: HaStatus[] = []
    c.onStatus((s) => { statuses.push(s) })
    c.start()
    await vi.waitFor(() => expect(server.received.filter((m) => m.type === 'ping').length).toBeGreaterThanOrEqual(3), waitOpts)
    expect(statuses).toEqual([{ state: 'online', reason: null }])
    expect(server.connections).toBe(1)
  })

  it('heartbeat_timeout_goes_offline_then_reconnects', async () => {
    const server = await startServer()
    const c = makeClient(server, { heartbeatIntervalMs: 40, heartbeatTimeoutMs: 40 })
    c.start()
    await vi.waitFor(() => expect(c.status()).toEqual({ state: 'online', reason: null }), waitOpts)
    const statuses: HaStatus[] = []
    c.onStatus((s) => { statuses.push(s) })
    // Connexion à moitié ouverte : la socket reste ouverte mais plus rien ne répond.
    server.ignorePings = true
    await vi.waitFor(() => expect(statuses).toContainEqual({ state: 'offline', reason: 'network' }), waitOpts)
    server.ignorePings = false
    await vi.waitFor(() => {
      expect(c.status()).toEqual({ state: 'online', reason: null })
      expect(server.connections).toBeGreaterThanOrEqual(2)
    }, waitOpts)
    // L'abonnement aux entités suit la nouvelle connexion.
    server.pushState('light.salon', 'off', { brightness: 0 })
    await vi.waitFor(() => expect(c.entities()['light.salon'].state).toBe('off'), waitOpts)
  })

  it('heartbeat_stops_on_close', async () => {
    const server = await startServer()
    const c = makeClient(server, { heartbeatIntervalMs: 20, heartbeatTimeoutMs: 100 })
    c.start()
    await vi.waitFor(() => expect(server.received.some((m) => m.type === 'ping')).toBe(true), waitOpts)
    c.close()
    await sleep(30)
    const pings = server.received.filter((m) => m.type === 'ping').length
    await sleep(120)
    expect(server.received.filter((m) => m.type === 'ping').length).toBe(pings)
  })

  it('heartbeat_stops_while_disconnected', async () => {
    const server = await startServer()
    const c = makeClient(server, { heartbeatIntervalMs: 20, heartbeatTimeoutMs: 20, retryDelayMs: 1000 })
    c.start()
    await vi.waitFor(() => expect(c.status()).toEqual({ state: 'online', reason: null }), waitOpts)
    const statuses: HaStatus[] = []
    c.onStatus((s) => { statuses.push(s) })
    server.refuse = true
    server.dropAll()
    await vi.waitFor(() => expect(statuses).toContainEqual({ state: 'offline', reason: 'network' }), waitOpts)
    await sleep(150)
    // Aucune nouvelle transition parasite causée par une minuterie restée active.
    expect(statuses).toEqual([{ state: 'offline', reason: 'network' }])
  })

  it('reconnect_auth_invalid_stops', async () => {
    const server = await startServer()
    const c = await onlineClient(server)
    server.validToken = 'jeton-révoqué'
    server.dropAll()
    await vi.waitFor(() => expect(c.status()).toEqual({ state: 'offline', reason: 'auth' }), waitOpts)
    expect(server.connections).toBe(2)
    await expect(c.callService('light', 'toggle', undefined, { entity_id: 'light.salon' })).rejects.toThrow('Home Assistant hors ligne')
  })

  it('call_service_message', async () => {
    const server = await startServer()
    const c = await onlineClient(server)
    await c.callService('light', 'toggle', undefined, { entity_id: 'light.salon' })
    const sent = server.received.filter((m) => m.type === 'call_service')
    expect(sent).toHaveLength(1)
    expect(withoutId(sent[0])).toEqual({ type: 'call_service', domain: 'light', service: 'toggle', target: { entity_id: 'light.salon' } })
  })

  it('call_service_with_data', async () => {
    const server = await startServer()
    const c = await onlineClient(server)
    await c.callService('light', 'turn_on', { brightness_pct: 40 }, { entity_id: 'light.salon' })
    const sent = server.received.find((m) => m.type === 'call_service')!
    expect(sent.service_data).toEqual({ brightness_pct: 40 })
  })

  it('call_service_offline_rejects', async () => {
    const server = await startServer()
    const c = makeClient(server, { token: BAD })
    c.start()
    await vi.waitFor(() => expect(c.status().state).toBe('offline'), waitOpts)
    await expect(c.callService('light', 'toggle')).rejects.toThrow('Home Assistant hors ligne')
    await expect(c.getForecasts('weather.maison', 'daily')).rejects.toThrow('Home Assistant hors ligne')
    await expect(c.listEntityInfo()).rejects.toThrow('Home Assistant hors ligne')
  })

  it('forecasts_return_response', async () => {
    const server = await startServer()
    const c = await onlineClient(server)
    const f = await c.getForecasts('weather.maison', 'daily')
    expect(f).toEqual([
      { datetime: '2026-11-21T12:00:00+00:00', condition: 'sunny', temperature: 5, templow: -2 },
      { datetime: '2026-11-22T12:00:00+00:00', condition: 'rainy', temperature: 3, templow: null },
    ])
    const sent = server.received.find((m) => m.type === 'call_service')!
    expect(sent).toMatchObject({
      domain: 'weather',
      service: 'get_forecasts',
      return_response: true,
      service_data: { type: 'daily' },
      target: { entity_id: 'weather.maison' },
    })
  })

  it('entity_info_joins_registries', async () => {
    const server = await startServer()
    const c = await onlineClient(server)
    const infos = await c.listEntityInfo()
    const by = Object.fromEntries(infos.map((i) => [i.entityId, i]))
    expect(by['light.salon']).toEqual({
      entityId: 'light.salon', name: 'Plafonnier salon', domain: 'light', areaName: 'Salon',
      state: 'on', dimmable: true, deviceClass: null, icon: null, unit: null,
    })
    // Pièce héritée de l'appareil quand l'entité n'en a pas.
    expect(by['light.cuisine']).toMatchObject({ areaName: 'Cuisine', dimmable: false, icon: 'mdi:ceiling-light', name: 'Cuisine' })
    expect(by['sensor.temp_bureau']).toMatchObject({ name: 'Température bureau', deviceClass: 'temperature', areaName: null, domain: 'sensor' })
    // Présente dans les états mais absente du registre.
    expect(by['switch.orphelin']).toMatchObject({ name: 'switch.orphelin', areaName: null, domain: 'switch', state: 'off' })
    expect(infos).toHaveLength(4)
  })

  it('camera_fetch_auth_header', async () => {
    const server = await startServer()
    const c = makeClient(server, { url: `${server.url}/` })
    const img = await c.fetchCameraImage('camera.porte', { width: 480, height: 270 })
    expect(Buffer.compare(img, server.camera.body)).toBe(0)
    const req = server.httpRequests.at(-1)!
    expect(req.method).toBe('GET')
    expect(req.url).toBe('/api/camera_proxy/camera.porte?width=480&height=270')
    expect(req.headers.authorization).toBe(`Bearer ${GOOD}`)

    server.camera = { status: 500, contentType: 'image/jpeg', body: Buffer.from('boom') }
    await expect(c.fetchCameraImage('camera.porte', { width: 480, height: 270 })).rejects.toBeInstanceOf(CameraImageError)
    server.camera = { status: 200, contentType: 'text/html', body: Buffer.from('<html></html>') }
    const err = await c.fetchCameraImage('camera.porte', { width: 480, height: 270 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CameraImageError)
    expect(String((err as Error).message)).not.toContain(GOOD)
  })

  it('camera_fetch_abort_cancels_in_flight', async () => {
    const server = await startServer()
    server.cameraDelayMs = 3000
    const c = makeClient(server)
    const ac = new AbortController()
    const started = Date.now()
    const p = c.fetchCameraImage('camera.porte', { width: 480, height: 270 }, ac.signal).catch((e: unknown) => e)
    await sleep(50)
    ac.abort()
    const err = await p
    expect(Date.now() - started).toBeLessThan(1500)
    expect(err).toBeInstanceOf(CameraImageError)
    expect((err as Error).message).toBe('Requête caméra annulée')
    expect(String((err as Error).message)).not.toContain(GOOD)
  })

  it('close_stops_retries_and_listeners', async () => {
    const server = await startServer()
    server.refuse = true
    const c = makeClient(server, { retryDelayMs: 30 })
    const statuses: HaStatus[] = []
    c.onStatus((s) => { statuses.push(s) })
    c.start()
    await vi.waitFor(() => expect(server.refused).toBeGreaterThanOrEqual(1), waitOpts)
    c.close()
    const refused = server.refused
    const seen = statuses.length
    server.refuse = false
    await sleep(150)
    expect(server.refused).toBe(refused)
    expect(server.connections).toBe(0)
    expect(statuses).toHaveLength(seen)
  })

  it('close_while_online', async () => {
    const server = await startServer()
    const c = await onlineClient(server)
    c.close()
    await sleep(100)
    expect(server.connections).toBe(1)
    await expect(c.callService('light', 'toggle')).rejects.toThrow('Home Assistant hors ligne')
  })

  it('token_with_newline_is_invalid_config_and_never_leaks', async () => {
    const server = await startServer()
    const c = makeClient(server, { token: `${NL_PART1}\n${NL_PART2}` })
    const err = await c.fetchCameraImage('camera.porte', { width: 480, height: 270 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CameraImageError)
    const text = `${(err as Error).message}\n${(err as Error).stack}`
    expect(text).not.toContain(NL_PART1)
    expect(text).not.toContain(NL_PART2)
    c.start()
    await vi.waitFor(() => expect(c.status()).toEqual({ state: 'offline', reason: 'auth' }), waitOpts)
    expect(server.connections).toBe(0)
  })

  it('camera_network_error_uses_fixed_message', async () => {
    const server = await startServer()
    const url = server.url
    await server.close()
    servers = servers.filter((s) => s !== server)
    const c = makeClient(server, { url })
    const err = await c.fetchCameraImage('camera.porte', { width: 480, height: 270 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CameraImageError)
    expect((err as Error).message).toBe('Caméra injoignable')
  })

  it('token_surrounding_whitespace_is_trimmed', async () => {
    const server = await startServer()
    const c = makeClient(server, { token: `  ${GOOD}\r\n` })
    c.start()
    await vi.waitFor(() => expect(c.status()).toEqual({ state: 'online', reason: null }), waitOpts)
    await c.fetchCameraImage('camera.porte', { width: 480, height: 270 })
    expect(server.httpRequests.at(-1)!.headers.authorization).toBe(`Bearer ${GOOD}`)
  })

  it('throwing_status_listener_does_not_stop_retries', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (r: unknown) => { unhandled.push(r) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const server = await startServer()
      server.refuse = true
      const c = makeClient(server, { retryDelayMs: 30 })
      c.onStatus(() => { throw new Error('écouteur en panne') })
      const statuses: HaStatus[] = []
      c.onStatus((s) => { statuses.push(s) })
      c.start()
      await vi.waitFor(() => expect(server.refused).toBeGreaterThanOrEqual(2), waitOpts)
      server.refuse = false
      await vi.waitFor(() => expect(c.status()).toEqual({ state: 'online', reason: null }), waitOpts)
      expect(statuses).toEqual([{ state: 'offline', reason: 'network' }, { state: 'online', reason: null }])
      // Les événements de la connexion (disconnected/ready) passent aussi par l'écouteur fautif.
      server.dropAll()
      await vi.waitFor(() => {
        expect(statuses).toHaveLength(4)
        expect(c.status()).toEqual({ state: 'online', reason: null })
      }, waitOpts)
      await sleep(20)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('throwing_entities_listener_does_not_break_others', async () => {
    const server = await startServer()
    const c = await onlineClient(server)
    c.onEntities(() => { throw new Error('écouteur en panne') })
    const seen: number[] = []
    c.onEntities((e) => { seen.push(e['light.salon'].attributes.brightness) })
    server.pushState('light.salon', 'on', { brightness: 77 })
    await vi.waitFor(() => expect(seen).toContain(77), waitOpts)
    server.pushState('light.salon', 'on', { brightness: 78 })
    await vi.waitFor(() => expect(seen).toContain(78), waitOpts)
    expect(c.status()).toEqual({ state: 'online', reason: null })
    await c.callService('light', 'toggle', undefined, { entity_id: 'light.salon' })
  })

  it('token_never_logged', () => {
    expect(logCalls.length).toBeGreaterThan(0)
    const dump = JSON.stringify(logCalls)
    expect(dump).not.toContain(GOOD)
    expect(dump).not.toContain(BAD)
    expect(dump).not.toContain(NL_PART1)
    expect(dump).not.toContain(NL_PART2)
  })
})

describe('FakeHa', () => {
  it('records calls, notifies listeners and honours offline status', async () => {
    const ha = new FakeHa()
    expect(ha.status()).toEqual({ state: 'online', reason: null })
    const seen: string[] = []
    ha.onEntities((e) => { seen.push(Object.keys(e).join(',')) })
    const statuses: HaStatus[] = []
    ha.onStatus((s) => { statuses.push(s) })

    ha.setEntity('light.salon', 'on', { brightness: 100 })
    expect(ha.entities()['light.salon']).toEqual({ entity_id: 'light.salon', state: 'on', attributes: { brightness: 100 } })
    ha.removeEntity('light.salon')
    expect(seen).toEqual(['light.salon', ''])

    await ha.callService('light', 'toggle', undefined, { entity_id: 'light.salon' })
    expect(ha.calls).toEqual([{ domain: 'light', service: 'toggle', data: undefined, target: { entity_id: 'light.salon' } }])

    ha.setStatus({ state: 'offline', reason: 'network' })
    expect(statuses).toEqual([{ state: 'offline', reason: 'network' }])
    await expect(ha.callService('light', 'toggle')).rejects.toThrow('Home Assistant hors ligne')
    expect(ha.calls).toHaveLength(1)
  })

  it('serves forecasts, camera image and entity info from its fields', async () => {
    const ha = new FakeHa()
    expect(await ha.getForecasts('weather.maison', 'daily')).toEqual([])
    ha.forecastError = new Error('panne')
    await expect(ha.getForecasts('weather.maison', 'daily')).rejects.toThrow('panne')
    expect(Buffer.isBuffer(await ha.fetchCameraImage('camera.porte', { width: 480, height: 270 }))).toBe(true)
    ha.cameraImage = new CameraImageError('Image indisponible')
    await expect(ha.fetchCameraImage('camera.porte', { width: 480, height: 270 })).rejects.toBeInstanceOf(CameraImageError)
    ha.setEntity('light.salon', 'on', { friendly_name: 'Salon', brightness: 10 })
    expect(await ha.listEntityInfo()).toEqual([
      { entityId: 'light.salon', name: 'Salon', domain: 'light', areaName: null, state: 'on', dimmable: true, deviceClass: null, icon: null, unit: null },
    ])
  })
})
