import type { EntityInfo } from './placement.js'

const MOTION_CLASSES = ['motion', 'occupancy', 'presence']
const text = (e: EntityInfo) => `${e.entityId} ${e.name}`

/** `binary_sensor` du même appareil que la caméra, de classe motion, occupancy ou presence, triés par nom. */
export function alertCandidates(cameraId: string | null, entities: EntityInfo[]): EntityInfo[] {
  const device = cameraId ? entities.find((e) => e.entityId === cameraId)?.deviceId : null
  if (!device) return []
  return entities
    .filter((e) => e.domain === 'binary_sensor' && e.deviceId === device && e.deviceClass !== null && MOTION_CLASSES.includes(e.deviceClass))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Ids reconnus par /person|package|parcel|colis/i dans l'id ou le nom ; aucun reconnu : tous. */
export function defaultAlertSensors(candidates: EntityInfo[]): string[] {
  const known = candidates.filter((e) => /person|package|parcel|colis/i.test(text(e)))
  return (known.length > 0 ? known : candidates).map((e) => e.entityId).sort()
}

/** « Personne », « Colis », « Véhicule », « Animal », « Mouvement », sinon le nom de l'entité. */
export function alertLabel(e: EntityInfo): string {
  const t = text(e)
  if (/person/i.test(t)) return 'Personne'
  if (/package|parcel|colis/i.test(t)) return 'Colis'
  if (/vehicle|véhicule|vehicule/i.test(t)) return 'Véhicule'
  if (/animal/i.test(t)) return 'Animal'
  if (/motion|mouvement/i.test(t)) return 'Mouvement'
  return e.name
}
