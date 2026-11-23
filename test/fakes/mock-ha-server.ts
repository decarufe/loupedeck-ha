import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'

export interface CompressedState { s: string; a: Record<string, unknown> }
export interface HttpRequestRecord { method: string; url: string; headers: IncomingHttpHeaders }

type Msg = { id?: number; type: string; [k: string]: any }

/** Faux Home Assistant local : WebSocket `/api/websocket` + HTTP `/api/camera_proxy/...` sur un port libre. */
export class MockHaServer {
  /** Connexions WebSocket acceptées (ouvertes), authentifiées ou non. */
  connections = 0
  /** Tentatives refusées pendant que `refuse` vaut true. */
  refused = 0
  /** Refuse la mise à niveau WebSocket (HTTP 503), comme un HA en cours de démarrage. */
  refuse = false
  validToken: string
  /** Ne répond plus aux `ping` : simule une connexion à moitié ouverte (socket ouverte, plus rien ne revient). */
  ignorePings = false
  haVersion = '2026.11.0'
  /** Messages reçus des clients après l'authentification. */
  received: Msg[] = []
  httpRequests: HttpRequestRecord[] = []
  cameraDelayMs = 0
  camera: { status: number; contentType: string; body: Buffer } = {
    status: 200,
    contentType: 'image/jpeg',
    body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  }
  states: Record<string, CompressedState> = {
    'light.salon': { s: 'on', a: { brightness: 153, friendly_name: 'Plafonnier salon', supported_color_modes: ['brightness'] } },
    'light.cuisine': { s: 'off', a: { friendly_name: 'Cuisine', supported_color_modes: ['onoff'] } },
    'sensor.temp_bureau': { s: '21.5', a: { device_class: 'temperature', unit_of_measurement: '°C' } },
    'switch.orphelin': { s: 'off', a: {} },
  }
  forecasts: Record<string, unknown[]> = {
    'weather.maison': [
      { datetime: '2026-11-21T12:00:00+00:00', condition: 'sunny', temperature: 5, templow: -2 },
      { datetime: '2026-11-22T12:00:00+00:00', condition: 'rainy', temperature: 3 },
    ],
  }
  /** Réponse de `get_config` : la maison de Home Assistant (0/0 = jamais configurée). */
  homeConfig: { latitude: number; longitude: number } = { latitude: 45.50169, longitude: -73.56725 }
  entityRegistry: Record<string, unknown>[] = [
    { entity_id: 'light.salon', name: null, area_id: 'salon', device_id: 'dev1', icon: null },
    { entity_id: 'light.cuisine', name: null, area_id: null, device_id: 'dev2', icon: 'mdi:ceiling-light' },
    { entity_id: 'sensor.temp_bureau', name: 'Température bureau', area_id: null, device_id: null, icon: null },
  ]
  deviceRegistry: Record<string, unknown>[] = [
    { id: 'dev1', area_id: 'cuisine', name: 'Ampoule 1' },
    { id: 'dev2', area_id: 'cuisine', name: 'Ampoule 2' },
  ]
  areaRegistry: Record<string, unknown>[] = [
    { area_id: 'salon', name: 'Salon' },
    { area_id: 'cuisine', name: 'Cuisine' },
  ]

  private http: Server
  private wss: WebSocketServer
  private sockets = new Set<WebSocket>()
  private entitySubs = new Map<WebSocket, number>()

  private constructor(token: string) {
    this.validToken = token
    this.http = createServer((req, res) => {
      this.httpRequests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers })
      if (req.url?.startsWith('/api/camera_proxy/')) {
        const { status, contentType, body } = this.camera
        setTimeout(() => {
          if (res.destroyed) return
          res.writeHead(status, { 'content-type': contentType })
          res.end(body)
        }, this.cameraDelayMs)
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    })
    this.wss = new WebSocketServer({
      server: this.http,
      path: '/api/websocket',
      verifyClient: (_info, cb) => {
        if (this.refuse) {
          this.refused++
          cb(false, 503)
          return
        }
        cb(true)
      },
    })
    this.wss.on('connection', (ws) => this.onConnection(ws))
  }

  static async start(o: { token?: string } = {}): Promise<MockHaServer> {
    const s = new MockHaServer(o.token ?? 'bon-jeton')
    await new Promise<void>((resolve) => s.http.listen(0, '127.0.0.1', resolve))
    return s
  }

  get url(): string {
    return `http://127.0.0.1:${(this.http.address() as AddressInfo).port}`
  }

  /** Coupe brutalement toutes les sockets clientes. */
  dropAll(): void {
    for (const ws of this.sockets) ws.terminate()
  }

  /** Envoie une mise à jour d'entité aux clients abonnés. */
  pushState(id: string, s: string, a: Record<string, unknown> = {}): void {
    this.states[id] = { s, a }
    for (const [ws, subId] of this.entitySubs) {
      ws.send(JSON.stringify({ id: subId, type: 'event', event: { a: { [id]: { s, a, lc: 1 } } } }))
    }
  }

  close(): Promise<void> {
    for (const ws of this.sockets) ws.terminate()
    this.http.closeAllConnections()
    return new Promise((resolve) => this.wss.close(() => this.http.close(() => resolve())))
  }

  private onConnection(ws: WebSocket): void {
    this.connections++
    this.sockets.add(ws)
    let authed = false
    ws.on('close', () => {
      this.sockets.delete(ws)
      this.entitySubs.delete(ws)
    })
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as Msg
      if (!authed) {
        if (msg.type !== 'auth') return
        if (msg.access_token === this.validToken) {
          authed = true
          ws.send(JSON.stringify({ type: 'auth_ok', ha_version: this.haVersion }))
        } else {
          ws.send(JSON.stringify({ type: 'auth_invalid', message: 'Invalid access token or password' }))
          ws.close()
        }
        return
      }
      this.received.push(msg)
      this.handle(ws, msg)
    })
    ws.send(JSON.stringify({ type: 'auth_required', ha_version: this.haVersion }))
  }

  private handle(ws: WebSocket, msg: Msg): void {
    const reply = (result: unknown) => ws.send(JSON.stringify({ id: msg.id, type: 'result', success: true, result }))
    switch (msg.type) {
      case 'supported_features':
        reply(null)
        return
      case 'ping':
        if (this.ignorePings) return
        ws.send(JSON.stringify({ id: msg.id, type: 'pong' }))
        return
      case 'subscribe_entities': {
        reply(null)
        this.entitySubs.set(ws, msg.id!)
        const a: Record<string, unknown> = {}
        for (const [id, st] of Object.entries(this.states)) a[id] = { ...st, lc: 1 }
        ws.send(JSON.stringify({ id: msg.id, type: 'event', event: { a } }))
        return
      }
      case 'unsubscribe_events':
        reply(null)
        return
      case 'call_service':
        if (msg.return_response && msg.domain === 'weather' && msg.service === 'get_forecasts') {
          const response: Record<string, unknown> = {}
          for (const id of [msg.target?.entity_id].flat()) response[id] = { forecast: this.forecasts[id] ?? [] }
          reply({ context: { id: 'ctx' }, response })
          return
        }
        reply({ context: { id: 'ctx' } })
        return
      case 'get_config':
        reply({ ...this.homeConfig, elevation: 40, unit_system: {}, location_name: 'Maison', time_zone: 'America/Toronto', components: [], version: this.haVersion })
        return
      case 'config/entity_registry/list':
        reply(this.entityRegistry)
        return
      case 'config/device_registry/list':
        reply(this.deviceRegistry)
        return
      case 'config/area_registry/list':
        reply(this.areaRegistry)
        return
      default:
        ws.send(JSON.stringify({ id: msg.id, type: 'result', success: false, error: { code: 'unknown_command', message: 'Unknown command.' } }))
    }
  }
}
