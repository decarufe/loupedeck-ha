import type { HaPort } from '../ha/types.js'

export interface CameraSource { next(signal: AbortSignal): Promise<Buffer> }

export const CAMERA_WIDTH = 480
export const CAMERA_HEIGHT = 270

/** Image obtenue par le proxy caméra de Home Assistant, déjà à la taille de l'écran. */
export function createHaProxySource(ha: HaPort, entityId: string): CameraSource {
  return { next: (signal) => ha.fetchCameraImage(entityId, { width: CAMERA_WIDTH, height: CAMERA_HEIGHT }, signal) }
}
