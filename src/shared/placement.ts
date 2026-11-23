export interface EntityInfo {
  entityId: string
  name: string
  domain: string
  areaName: string | null
  state: string
  dimmable: boolean
  deviceClass: string | null
  icon: string | null
  /** Appareil Home Assistant de l'entité (registre), s'il en a un. */
  deviceId?: string | null
  /** Unité de mesure (`unit_of_measurement`), si l'entité en a une. */
  unit?: string | null
}

/**
 * `key` = ancienne touche Lumières (équivaut à `toggle`). Les types de touche d'une page Bouton custom
 * (`toggle`, `action`, `state`, `value`, `graph`, `dimmer`) et l'entité d'une page (`climate`, `weather`, `camera`, `graph`).
 */
export type SlotKind = 'key' | 'toggle' | 'action' | 'state' | 'value' | 'graph' | 'dimmer' | 'climate' | 'sensor' | 'weather' | 'camera' | 'alert'

/** Un capteur est numérique s'il a une unité ou si son état se lit comme un nombre. */
export function isNumeric(e: EntityInfo): boolean {
  return e.domain === 'sensor' && ((e.unit ?? null) !== null || Number.isFinite(Number.parseFloat(e.state)))
}

/** Une lumière est gradable si un de ses modes de couleur dépasse on/off, ou si elle expose une luminosité numérique. */
export function isDimmable(attributes: Record<string, unknown>): boolean {
  const modes = attributes.supported_color_modes
  if (Array.isArray(modes)) {
    return modes.some(m => m !== 'onoff' && m !== 'unknown')
  }
  return typeof attributes.brightness === 'number'
}

export function canPlace(kind: SlotKind, e: EntityInfo): { ok: true } | { ok: false; reason: string } {
  const ok = { ok: true } as const
  const no = (reason: string) => ({ ok: false, reason }) as const
  switch (kind) {
    case 'key':
    case 'toggle':
      return ['light', 'switch', 'input_boolean', 'fan'].includes(e.domain) ? ok : no('Un interrupteur accepte seulement une lumière, une prise ou un booléen.')
    case 'action':
      return e.domain === 'scene' || e.domain === 'script' ? ok : no('Une action accepte seulement une scène ou un script.')
    case 'state':
      return e.domain === 'binary_sensor' ? ok : no('Une touche État accepte seulement un capteur tout ou rien (binary_sensor).')
    case 'value':
      return e.domain === 'sensor' ? ok : no('Une touche Valeur accepte seulement un capteur.')
    case 'graph':
      return isNumeric(e) ? ok : no('Un graphique accepte seulement un capteur numérique.')
    case 'dimmer':
      if (e.domain !== 'light') return no('Une molette accepte seulement une lumière.')
      return e.dimmable ? ok : no("Cette lumière n'est pas gradable : placez-la sur une touche centrale.")
    case 'climate':
      return e.domain === 'climate' ? ok : no('Ce tableau accepte seulement un thermostat (climate).')
    case 'sensor':
      return e.domain === 'sensor' && e.deviceClass === 'temperature' ? ok : no('Seuls les capteurs de température sont acceptés ici.')
    case 'weather':
      return e.domain === 'weather' ? ok : no('Ce tableau accepte seulement une entité météo.')
    case 'alert':
      return e.domain === 'binary_sensor' ? ok : no('Une alerte accepte seulement un capteur tout ou rien (binary_sensor).')
    case 'camera':
      return e.domain === 'camera' ? ok : no('Ce tableau accepte seulement une caméra.')
  }
}
