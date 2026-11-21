export interface EntityInfo {
  entityId: string
  name: string
  domain: string
  areaName: string | null
  state: string
  dimmable: boolean
  deviceClass: string | null
  icon: string | null
}

export type SlotKind = 'key' | 'dimmer' | 'climate' | 'sensor' | 'weather' | 'camera'

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
      return e.domain === 'light' || e.domain === 'switch' ? ok : no('Une touche accepte seulement une lumière ou une prise (interrupteur).')
    case 'dimmer':
      if (e.domain !== 'light') return no('Une molette accepte seulement une lumière.')
      return e.dimmable ? ok : no("Cette lumière n'est pas gradable : placez-la sur une touche centrale.")
    case 'climate':
      return e.domain === 'climate' ? ok : no('Ce tableau accepte seulement un thermostat (climate).')
    case 'sensor':
      return e.domain === 'sensor' && e.deviceClass === 'temperature' ? ok : no('Seuls les capteurs de température sont acceptés ici.')
    case 'weather':
      return e.domain === 'weather' ? ok : no('Ce tableau accepte seulement une entité météo.')
    case 'camera':
      return e.domain === 'camera' ? ok : no('Ce tableau accepte seulement une caméra.')
  }
}
