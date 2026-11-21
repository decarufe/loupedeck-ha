import type { EntityInfo } from '../shared/placement.js'

export interface HaEntity { entity_id: string; state: string; attributes: Record<string, any> }
export interface HaStatus { state: 'connecting' | 'online' | 'offline'; reason: 'auth' | 'network' | null }
export interface Forecast { datetime: string; condition: string; temperature: number; templow: number | null }
export type ForecastType = 'daily' | 'twice_daily' | 'hourly'

/** Échec de récupération d'une image caméra (HTTP non 2xx, type non image, délai, réseau). */
export class CameraImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CameraImageError'
  }
}

export interface HaPort {
  status(): HaStatus
  entities(): Record<string, HaEntity>
  onEntities(cb: (e: Record<string, HaEntity>) => void): () => void
  onStatus(cb: (s: HaStatus) => void): () => void
  callService(domain: string, service: string, data?: object, target?: { entity_id: string }): Promise<void>
  getForecasts(entityId: string, type: ForecastType): Promise<Forecast[]>
  listEntityInfo(): Promise<EntityInfo[]>
  fetchCameraImage(entityId: string, size: { width: number; height: number }): Promise<Buffer>
  close(): void
}

export const OFFLINE_MESSAGE = 'Home Assistant hors ligne'
