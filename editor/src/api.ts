import type { AppConfig } from '@shared/config/schema'
import type { EntityInfo } from '@shared/shared/placement'

/** Contrat de src/editor/server.ts (copié ici : ce module est node-only). */
export type PublicConfig = Omit<AppConfig, 'ha'> & {
  ha: { url: string; allowSelfSigned: boolean; hasToken: boolean }
  loadWarning: string | null
}
/** `preview` : la console a été redessinée, l'aperçu doit être rechargé (au plus une fois par seconde). */
export type LiveMessage = { type: 'config' } | { type: 'active'; button: number } | { type: 'status' } | { type: 'entities' } | { type: 'preview' }
export interface Status {
  device: { status: string; firmware: string | null }
  ha: { state: string; [k: string]: unknown }
  activeButton: number
}

/** Erreur de l'API : `message` est le texte français du serveur, `issues` le détail éventuel. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly issues: string[] = []) {
    super(message)
  }
}

const WRITE_HEADERS = { 'Content-Type': 'application/json', 'X-Loupedeck-Editor': '1' }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new ApiError('Serveur injoignable', 0)
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; issues?: string[] }
    throw new ApiError(b.error ?? `Erreur ${res.status}`, res.status, b.issues ?? [])
  }
  return body as T
}

export const getConfig = () => request<PublicConfig>('/api/config')

export function putConfig(cfg: PublicConfig, newToken?: string) {
  // Le jeton n'est jamais renvoyé : seuls `newToken` (optionnel) et la configuration publique partent.
  const { loadWarning: _w, ...rest } = cfg
  const { hasToken: _h, ...ha } = rest.ha
  const body = { ...rest, ha, ...(newToken ? { newToken } : {}) }
  return request<PublicConfig>('/api/config', { method: 'PUT', headers: WRITE_HEADERS, body: JSON.stringify(body) })
}

export const undo = () => request<PublicConfig>('/api/config/undo', { method: 'POST', headers: WRITE_HEADERS, body: '{}' })
export const getEntities = () => request<EntityInfo[]>('/api/entities')
export const getStatus = () => request<Status>('/api/status')
export const pageCommand = (button: number, command: 'refresh' | 'reload') =>
  request<{ ok: true }>(`/api/pages/${button}/command`, { method: 'POST', headers: WRITE_HEADERS, body: JSON.stringify({ command }) })
/** Mode Essayer : geste de la Live virtuelle transmis à la page (pilote la vraie maison). */
export const pageInput = (button: number, event: object) =>
  request<{ ok: true }>(`/api/pages/${button}/input`, { method: 'POST', headers: WRITE_HEADERS, body: JSON.stringify(event) })
export const previewUrl = (button: number, version: number) => `/api/preview/${button}.png?v=${version}`

/**
 * WebSocket live avec reconnexion toutes les 2 s. `onReopen` est appelé à chaque ouverture qui suit
 * une coupure (pas à la première). Retourne une fonction d'arrêt.
 */
export function connectLive(onMessage: (m: LiveMessage) => void, onReopen?: () => void): () => void {
  let ws: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let openedOnce = false
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/api/live`)
    ws.onopen = () => {
      if (openedOnce) onReopen?.()
      openedOnce = true
    }
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(String(e.data)) as LiveMessage) } catch { /* message illisible ignoré */ }
    }
    ws.onclose = () => {
      if (!stopped) timer = setTimeout(open, 2000)
    }
  }
  open()
  return () => {
    stopped = true
    clearTimeout(timer)
    ws?.close()
  }
}
