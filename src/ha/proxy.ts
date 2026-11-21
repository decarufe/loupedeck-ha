import type { Logger } from '../log.js'
import type { EntityInfo } from '../shared/placement.js'
import type { Forecast, ForecastType, HaEntity, HaPort, HaStatus } from './types.js'

/**
 * HaPort stable donné à Actions, Navigator et aux tableaux : quand la section `ha` de la configuration
 * change, on remplace le client sous-jacent sans que les abonnés aient à se réabonner.
 */
export class HaProxy implements HaPort {
  private inner: HaPort
  private offInner: (() => void)[] = []
  private readonly entityCbs = new Set<(e: Record<string, HaEntity>) => void>()
  private readonly statusCbs = new Set<(s: HaStatus) => void>()

  constructor(initial: HaPort, private readonly log?: Logger) {
    this.inner = initial
    this.bind()
  }

  /** Ferme l'ancien client, s'abonne au nouveau et émet aussitôt son statut et ses entités. */
  replace(next: HaPort): void {
    this.unbind()
    const old = this.inner
    this.inner = next
    try {
      old.close()
    } catch (err) {
      this.log?.warn("Fermeture de l'ancien client Home Assistant impossible", { erreur: String(err) })
    }
    this.bind()
    this.notify(this.statusCbs, next.status(), 'onStatus')
    this.notify(this.entityCbs, next.entities(), 'onEntities')
  }

  status(): HaStatus { return this.inner.status() }
  entities(): Record<string, HaEntity> { return this.inner.entities() }

  onEntities(cb: (e: Record<string, HaEntity>) => void): () => void {
    this.entityCbs.add(cb)
    return () => { this.entityCbs.delete(cb) }
  }

  onStatus(cb: (s: HaStatus) => void): () => void {
    this.statusCbs.add(cb)
    return () => { this.statusCbs.delete(cb) }
  }

  callService(domain: string, service: string, data?: object, target?: { entity_id: string }): Promise<void> {
    return this.inner.callService(domain, service, data, target)
  }

  getForecasts(entityId: string, type: ForecastType): Promise<Forecast[]> {
    return this.inner.getForecasts(entityId, type)
  }

  listEntityInfo(): Promise<EntityInfo[]> {
    return this.inner.listEntityInfo()
  }

  fetchCameraImage(entityId: string, size: { width: number; height: number }, signal?: AbortSignal): Promise<Buffer> {
    return this.inner.fetchCameraImage(entityId, size, signal)
  }

  close(): void {
    this.unbind()
    this.entityCbs.clear()
    this.statusCbs.clear()
    this.inner.close()
  }

  private bind(): void {
    const inner = this.inner
    this.offInner = [
      inner.onEntities((e) => { if (this.inner === inner) this.notify(this.entityCbs, e, 'onEntities') }),
      inner.onStatus((s) => { if (this.inner === inner) this.notify(this.statusCbs, s, 'onStatus') }),
    ]
  }

  private unbind(): void {
    for (const off of this.offInner) off()
    this.offInner = []
  }

  /** Chaque écouteur est isolé : une exception est journalisée sans priver les suivants. */
  private notify<T>(cbs: Set<(v: T) => void>, value: T, kind: string): void {
    for (const cb of [...cbs]) {
      try {
        cb(value)
      } catch (err) {
        this.log?.error(`Un écouteur ${kind} a levé une exception`, { erreur: String(err) })
      }
    }
  }
}
