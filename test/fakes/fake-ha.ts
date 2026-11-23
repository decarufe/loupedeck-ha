import { OFFLINE_MESSAGE, type Forecast, type ForecastType, type HaEntity, type HaPort, type HaStatus, type HistoryPoint } from '../../src/ha/types.js'
import { isDimmable, type EntityInfo } from '../../src/shared/placement.js'
import type { GeoPoint } from '../../src/weather/openmeteo.js'

// Plus petit JPEG reconnaissable (SOI + EOI) : suffisant pour les tests qui ne décodent pas l'image.
const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9])

/** Faux Home Assistant en mémoire ; toutes les notifications sont synchrones. */
export class FakeHa implements HaPort {
  calls: { domain: string; service: string; data?: object; target?: object }[] = []
  forecasts: Forecast[] = []
  forecastError: Error | null = null
  forecastCalls: { entityId: string; type: ForecastType }[] = []
  cameraImage: Buffer | Error = TINY_JPEG
  /** Position de la maison renvoyée par `homeLocation()` (null = jamais configurée). */
  location: GeoPoint | null = { latitude: 45.5, longitude: -73.5 }
  history: Record<string, HistoryPoint[]> = {}
  historyCalls: { entityId: string; startMs: number; endMs: number }[] = []
  private st: HaStatus = { state: 'online', reason: null }
  private ents: Record<string, HaEntity> = {}
  private entityListeners = new Set<(e: Record<string, HaEntity>) => void>()
  private statusListeners = new Set<(s: HaStatus) => void>()

  setEntity(id: string, state: string, attributes: object = {}): void {
    this.ents = { ...this.ents, [id]: { entity_id: id, state, attributes: { ...attributes } } }
    this.emitEntities()
  }

  removeEntity(id: string): void {
    const { [id]: _removed, ...rest } = this.ents
    this.ents = rest
    this.emitEntities()
  }

  setStatus(s: HaStatus): void {
    this.st = s
    for (const cb of [...this.statusListeners]) cb(s)
  }

  status(): HaStatus {
    return this.st
  }

  entities(): Record<string, HaEntity> {
    return this.ents
  }

  onEntities(cb: (e: Record<string, HaEntity>) => void): () => void {
    this.entityListeners.add(cb)
    return () => { this.entityListeners.delete(cb) }
  }

  onStatus(cb: (s: HaStatus) => void): () => void {
    this.statusListeners.add(cb)
    return () => { this.statusListeners.delete(cb) }
  }

  callService(domain: string, service: string, data?: object, target?: { entity_id: string }): Promise<void> {
    if (this.st.state !== 'online') return Promise.reject(new Error(OFFLINE_MESSAGE))
    this.calls.push({ domain, service, data, target })
    return Promise.resolve()
  }

  getForecasts(entityId: string, type: ForecastType): Promise<Forecast[]> {
    this.forecastCalls.push({ entityId, type })
    if (this.forecastError) return Promise.reject(this.forecastError)
    return Promise.resolve(this.forecasts)
  }

  getHistory(entityId: string, startMs: number, endMs: number): Promise<HistoryPoint[]> {
    this.historyCalls.push({ entityId, startMs, endMs })
    return Promise.resolve((this.history[entityId] ?? []).filter((p) => p.t >= startMs && p.t <= endMs))
  }

  homeLocation(): Promise<GeoPoint | null> {
    return Promise.resolve(this.location)
  }

  listEntityInfo(): Promise<EntityInfo[]> {
    return Promise.resolve(Object.values(this.ents).map((e) => ({
      entityId: e.entity_id,
      name: e.attributes.friendly_name ?? e.entity_id,
      domain: e.entity_id.split('.')[0],
      areaName: null,
      state: e.state,
      dimmable: isDimmable(e.attributes),
      deviceClass: e.attributes.device_class ?? null,
      icon: e.attributes.icon ?? null,
      unit: e.attributes.unit_of_measurement ?? null,
      deviceId: e.attributes.device_id ?? null,
    })))
  }

  fetchCameraImage(_entityId: string, _size: { width: number; height: number }, signal?: AbortSignal): Promise<Buffer> {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
    if (this.cameraImage instanceof Error) return Promise.reject(this.cameraImage)
    return Promise.resolve(this.cameraImage)
  }

  close(): void {
    this.entityListeners.clear()
    this.statusListeners.clear()
  }

  private emitEntities(): void {
    for (const cb of [...this.entityListeners]) cb(this.ents)
  }
}
