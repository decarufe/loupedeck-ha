import { reactive } from 'vue'
import {
  DASHBOARD_LABELS, emptyDashboard, isEmptyPage, moveItem, KNOB_IDS,
  type DashboardType, type KnobId, type Tile, type TileKind,
} from '@shared/config/schema'
import { canPlace, type EntityInfo, type SlotKind } from '@shared/shared/placement'
import { changeKind, fitsSlot, newTile, placeOnTile, TILE_KIND_LABELS, type SlotType } from '@shared/shared/tiles'
import type { InputEvent } from '@shared/device/input'
import * as api from './api'
import type { LiveMessage, PublicConfig, Status } from './api'

/** Emplacement d'une page Bouton custom : une touche (0-11) ou la zone latérale d'une molette. */
export type SlotTarget = { kind: 'key'; index: number } | { kind: 'strip'; knob: KnobId }

/** Ce qu'on glisse dans l'éditeur, gardé ici car `dataTransfer` est illisible pendant le survol. */
export type DragSource =
  | { type: 'key'; index: number }
  | { type: 'strip'; knob: KnobId }
  | { type: 'round'; index: number }
  | { type: 'entity'; entityId: string }
  | { type: 'kind'; kind: TileKind }

export interface EditorState {
  config: PublicConfig | null
  entities: EntityInfo[]
  /** Vrai quand la liste des entités n'a pas pu être chargée (Home Assistant hors ligne). */
  entitiesUnavailable: boolean
  /** Entité choisie dans la palette, en attente d'un clic sur un emplacement. */
  pendingEntity: string | null
  /** Type de touche choisi dans la palette, en attente d'un clic sur un emplacement. */
  pendingKind: TileKind | null
  /** Glisser en cours et emplacement survolé (aperçu du réordonnancement). */
  drag: DragSource | null
  dragOver: string | null
  dragSwap: boolean
  /** `edit` : cliquer règle, glisser place. `try` : les gestes pilotent la page comme sur la console. */
  mode: 'edit' | 'try'
  /** Emplacement sélectionné pour l'édition du libellé et de l'icône. */
  selectedSlot: SlotTarget | null
  status: Status | null
  selectedButton: number
  previewVersion: number
  activeButton: number
  error: string | null
}

const initial = (): EditorState => ({
  config: null, entities: [], entitiesUnavailable: false, pendingEntity: null, pendingKind: null, drag: null, dragOver: null, dragSwap: false, mode: 'edit', selectedSlot: null,
  status: null, selectedButton: 0, previewVersion: 0, activeButton: -1, error: null,
})

export const state = reactive<EditorState>(initial())

/** File des écritures : un seul PUT (ou annulation) à la fois, dans l'ordre d'appel. */
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

export function reset() {
  Object.assign(state, initial())
  queue = Promise.resolve()
}

function fail(e: unknown) {
  if (e instanceof api.ApiError) {
    state.error = e.issues.length > 0 ? `${e.message} — ${e.issues.join(' ; ')}` : e.message
  } else {
    state.error = e instanceof Error ? e.message : String(e)
  }
}

export function select(i: number) {
  state.selectedButton = i
  state.selectedSlot = null
}

export function selectSlot(t: SlotTarget | null) {
  state.selectedSlot = t && state.selectedSlot && slotId(state.selectedSlot) === slotId(t) ? null : t
}

export async function loadConfig() {
  try {
    state.config = await api.getConfig()
  } catch (e) { fail(e) }
}

export async function loadStatus() {
  try {
    state.status = await api.getStatus()
    state.activeButton = state.status.activeButton
  } catch (e) { fail(e) }
}

export async function loadEntities() {
  try {
    state.entities = await api.getEntities()
    state.entitiesUnavailable = false
  } catch {
    // Home Assistant hors ligne : la palette est vide et l'indique, ce n'est pas une erreur d'édition.
    state.entities = []
    state.entitiesUnavailable = true
  }
}

/**
 * Met la sauvegarde en file. À son tour, la mutation s'applique à la configuration la plus récente
 * (celle renvoyée par le PUT précédent), puis part ; en cas d'échec l'erreur du serveur est affichée.
 */
export function save(mutator: (cfg: PublicConfig) => void, newToken?: string): Promise<boolean> {
  return enqueue(async () => {
    if (!state.config) return false
    const draft = JSON.parse(JSON.stringify(state.config)) as PublicConfig
    mutator(draft)
    try {
      state.config = await api.putConfig(draft, newToken)
      state.error = null
      state.previewVersion++
      return true
    } catch (e) {
      fail(e)
      return false
    }
  })
}

const slotType = (t: SlotTarget): SlotType => (t.kind === 'key' ? 'key' : 'strip')
export const slotId = (t: SlotTarget): string => (t.kind === 'key' ? `key:${t.index}` : `strip:${t.knob}`)
export const slotName = (t: SlotTarget): string => (t.kind === 'key' ? `Touche ${t.index + 1}` : `Molette ${t.knob}`)

function slotAccess(cfg: PublicConfig, button: number, t: SlotTarget) {
  const b = cfg.buttons[button]
  if (b?.type !== 'custom') return null
  return t.kind === 'key'
    ? { get: (): Tile | null => b.keys[t.index] ?? null, set: (v: Tile | null) => { b.keys[t.index] = v } }
    : { get: (): Tile | null => b.strips[t.knob], set: (v: Tile | null) => { b.strips[t.knob] = v } }
}

export function tileAt(t: SlotTarget): Tile | null {
  return state.config ? slotAccess(state.config, state.selectedButton, t)?.get() ?? null : null
}

/**
 * Pose une entité sur un emplacement de la page sélectionnée. Le type de touche est deviné (porte → État, scène → Action,
 * lumière gradable sur une bande → Gradateur) ; sur une touche du même type, seule l'entité change. Refus : raison affichée, sans PUT.
 */
export async function placeEntity(target: SlotTarget, entityId: string): Promise<boolean> {
  const info = state.entities.find((e) => e.entityId === entityId)
  if (!info) {
    state.error = `Entité inconnue : ${entityId}`
    return false
  }
  const verdict = placeOnTile(info, slotType(target), tileAt(target))
  if (!verdict.ok) {
    state.error = verdict.reason
    return false
  }
  const button = state.selectedButton
  const ok = await save((cfg) => { slotAccess(cfg, button, target)?.set(verdict.tile) })
  if (ok) {
    state.pendingEntity = null
    state.selectedSlot = target
  }
  return ok
}

/** Crée une touche d'un type sur un emplacement (l'entité se choisit ensuite). */
export async function placeKind(target: SlotTarget, kind: TileKind): Promise<boolean> {
  if (!fitsSlot(kind, slotType(target))) {
    state.error = `${TILE_KIND_LABELS[kind].name} : seulement sur ${kind === 'dimmer' ? 'une bande latérale (molette)' : 'une touche centrale'}.`
    return false
  }
  const button = state.selectedButton
  const current = tileAt(target)
  const tile = current ? changeKind(current, kind, state.entities) : newTile(kind)
  const ok = await save((cfg) => { slotAccess(cfg, button, target)?.set(tile) })
  if (ok) {
    state.pendingKind = null
    state.selectedSlot = target
  }
  return ok
}

/** Modifie une touche : `patch` remplace des champs (une fonction le calcule depuis la touche à jour, après les sauvegardes en file) ; une chaîne vide supprime `label`, `icon` ou `color`. */
export function updateTile(target: SlotTarget, patch: Record<string, unknown> | ((tile: Tile) => Record<string, unknown>)): Promise<boolean> {
  const button = state.selectedButton
  return save((cfg) => {
    const access = slotAccess(cfg, button, target)
    const tile = access?.get()
    if (!access || !tile) return
    const next = { ...tile, ...(typeof patch === 'function' ? patch(tile) : patch) } as Record<string, unknown>
    for (const k of ['label', 'icon', 'color']) if (typeof next[k] === 'string' && (next[k] as string).trim() === '') delete next[k]
    access.set(next as unknown as Tile)
  })
}

/** Ancien nom : libellé et icône d'une touche. */
export const updateSlot = (target: SlotTarget, patch: { label?: string; icon?: string }) => updateTile(target, patch)

export function setTileKind(target: SlotTarget, kind: TileKind): Promise<boolean> {
  const tile = tileAt(target)
  if (!tile) return placeKind(target, kind)
  const button = state.selectedButton
  const next = changeKind(tile, kind, state.entities)
  return save((cfg) => { slotAccess(cfg, button, target)?.set(next) })
}

/** Choisit l'entité d'une touche ; refusée si le type de touche ne l'accepte pas. */
export function setTileEntity(target: SlotTarget, entityId: string | null): Promise<boolean> {
  const tile = tileAt(target)
  if (!tile || tile.kind === 'clock') return Promise.resolve(false)
  const info = entityId ? state.entities.find((e) => e.entityId === entityId) : undefined
  if (info) {
    const r = canPlace(tile.kind as SlotKind, info)
    if (!r.ok) { state.error = r.reason; return Promise.resolve(false) }
  }
  const patch: Record<string, unknown> = { entityId }
  if (tile.kind === 'state' && info) Object.assign(patch, newTile('state', info))
  return updateTile(target, patch)
}

export async function clearSlot(target: SlotTarget): Promise<boolean> {
  const button = state.selectedButton
  const ok = await save((cfg) => { slotAccess(cfg, button, target)?.set(null) })
  if (ok) state.selectedSlot = null
  return ok
}

/** Les 18 emplacements dans l'ordre de l'écran : 12 touches puis les 6 molettes. */
export function slotList(): SlotTarget[] {
  return [...Array.from({ length: 12 }, (_, index) => ({ kind: 'key', index }) as SlotTarget), ...KNOB_IDS.map((knob) => ({ kind: 'strip', knob }) as SlotTarget)]
}

/**
 * Déplace une touche. Entre deux touches centrales : insertion et décalage des suivantes (`swap` : échange).
 * Vers ou depuis une bande latérale : échange. `copy` : copie par-dessus sans toucher l'origine.
 */
export async function moveTile(from: SlotTarget, to: SlotTarget, o: { swap?: boolean; copy?: boolean } = {}): Promise<boolean> {
  if (slotId(from) === slotId(to)) return false
  const a = tileAt(from)
  if (!a) return false
  const b = tileAt(to)
  if (!fitsSlot(a.kind, slotType(to))) {
    state.error = `${TILE_KIND_LABELS[a.kind].name} ne va pas sur ${to.kind === 'key' ? 'une touche centrale' : 'une bande latérale'}.`
    return false
  }
  if (b && !o.copy && !(from.kind === 'key' && to.kind === 'key' && !o.swap) && !fitsSlot(b.kind, slotType(from))) {
    state.error = `Échange impossible : ${TILE_KIND_LABELS[b.kind].name} ne va pas sur ${from.kind === 'key' ? 'une touche centrale' : 'une bande latérale'}.`
    return false
  }
  const button = state.selectedButton
  const ok = await save((cfg) => {
    const page = cfg.buttons[button]
    if (page?.type !== 'custom') return
    if (o.copy) { slotAccess(cfg, button, to)!.set(JSON.parse(JSON.stringify(a)) as Tile); return }
    if (from.kind === 'key' && to.kind === 'key') { page.keys = moveItem(page.keys, from.index, to.index, o.swap); return }
    slotAccess(cfg, button, to)!.set(a)
    slotAccess(cfg, button, from)!.set(b)
  })
  if (ok) state.selectedSlot = to
  return ok
}

// ---------- pages ----------

/** Choisit le type d'une page ; seulement sur une page vide (bouton sans page ou page Bouton custom sans touche). */
export async function setPageType(index: number, type: DashboardType): Promise<boolean> {
  const cur = state.config?.buttons[index] ?? null
  if (!isEmptyPage(cur)) {
    state.error = 'Videz d’abord la page pour changer son type.'
    return false
  }
  if (cur?.type === type) return true
  const keepName = cur && cur.name !== 'Nouvelle page' && !Object.values(DASHBOARD_LABELS).includes(cur.name)
  return save((cfg) => {
    const next = emptyDashboard(type, index)
    if (cur) {
      next.color = cur.color
      if (keepName) next.name = cur.name
    }
    cfg.buttons[index] = next
  })
}

/** Vide une page : elle redevient une page vide (Bouton custom sans touche), son nom et sa couleur sont gardés. */
export async function clearPage(index: number): Promise<boolean> {
  const cur = state.config?.buttons[index]
  if (!cur) return false
  state.selectedSlot = null
  return save((cfg) => {
    const next = emptyDashboard('custom', index)
    next.name = cur.name
    next.color = cur.color
    cfg.buttons[index] = next
  })
}

export function removePage(index: number): Promise<boolean> {
  state.selectedSlot = null
  return save((cfg) => { cfg.buttons[index] = null })
}

/** Déplace une page sur un autre bouton rond : les autres se décalent (`swap` : échange) ; la sélection suit la page. */
export async function movePage(from: number, to: number, swap = false): Promise<boolean> {
  if (from === to || !state.config?.buttons[from]) return false
  const ok = await save((cfg) => { cfg.buttons = moveItem(cfg.buttons, from, to, swap) })
  if (ok) {
    state.selectedButton = to
    state.selectedSlot = null
  }
  return ok
}

/** Commande ponctuelle envoyée à Home Assistant pour une page : actualiser la météo, recharger l'intégration d'une caméra. */
export async function pageCommand(index: number, command: 'refresh' | 'reload'): Promise<boolean> {
  try {
    await api.pageCommand(index, command)
    state.error = null
    state.previewVersion++
    return true
  } catch (e) {
    fail(e)
    return false
  }
}

// ---------- glisser : ce qui est permis, et ce qui se passera ----------

export type DropVerdict = { ok: true; how: string } | { ok: false; why: string }

const SLOT_WHERE: Record<SlotType, string> = { key: 'les touches', strip: 'les bandes latérales (molettes)' }

export function targetFromId(id: string): SlotTarget | null {
  const k = /^key:(\d+)$/.exec(id)
  if (k) return { kind: 'key', index: Number(k[1]) }
  const s = /^strip:(\w+)$/.exec(id)
  return s ? { kind: 'strip', knob: s[1] as KnobId } : null
}

/** Verdict d'un dépôt de `source` sur la cible `id` (`key:3`, `strip:knobTL`, `round:2`, `trash`), pour surligner et étiqueter. */
export function canDropOn(source: DragSource, id: string): DropVerdict {
  if (id === 'trash') return source.type === 'key' || source.type === 'strip' ? { ok: true, how: 'Retirer la touche' } : { ok: false, why: '' }
  if (id.startsWith('round:')) {
    if (source.type !== 'round') return { ok: false, why: 'Déposez sur une touche ou une bande' }
    const to = Number(id.slice(6))
    if (to === source.index) return { ok: false, why: '' }
    return { ok: true, how: state.config?.buttons[to] ? 'Placer la page ici (les autres se décalent) · Maj : échanger' : 'Déplacer la page sur ce bouton' }
  }
  if (source.type === 'round') return { ok: false, why: '' }
  const t = targetFromId(id)
  const page = state.config?.buttons[state.selectedButton]
  if (!t || page?.type !== 'custom') return { ok: false, why: 'Cette page n’a pas de touches' }
  const st = slotType(t)
  const current = tileAt(t)
  if (source.type === 'kind') {
    const k = TILE_KIND_LABELS[source.kind]
    return fitsSlot(source.kind, st) ? { ok: true, how: `Créer : ${k.name}` } : { ok: false, why: `${k.name} : seulement sur ${source.kind === 'dimmer' ? SLOT_WHERE.strip : SLOT_WHERE.key}` }
  }
  if (source.type === 'entity') {
    const info = state.entities.find((e) => e.entityId === source.entityId)
    if (!info) return { ok: false, why: 'Entité inconnue' }
    const r = placeOnTile(info, st, current)
    if (!r.ok) return { ok: false, why: r.reason }
    return { ok: true, how: current && current.kind === r.tile.kind ? 'Remplacer l’entité (format gardé)' : `Créer : ${TILE_KIND_LABELS[r.tile.kind].name}` }
  }
  const from: SlotTarget = source.type === 'key' ? { kind: 'key', index: source.index } : { kind: 'strip', knob: source.knob }
  if (slotId(from) === id) return { ok: false, why: '' }
  const a = tileAt(from)
  if (!a) return { ok: false, why: '' }
  if (!fitsSlot(a.kind, st)) return { ok: false, why: `${TILE_KIND_LABELS[a.kind].name} ne va pas sur ${SLOT_WHERE[st]}` }
  if (from.kind === 'key' && t.kind === 'key') {
    return { ok: true, how: current ? 'Placer ici (les suivantes se décalent) · Maj : échanger · Ctrl : copier' : 'Déplacer (Ctrl : copier)' }
  }
  if (current && !fitsSlot(current.kind, slotType(from))) return { ok: false, why: `Échange impossible : ${TILE_KIND_LABELS[current.kind].name} ne va pas sur ${SLOT_WHERE[slotType(from)]}` }
  return { ok: true, how: current ? 'Échanger (Ctrl : copier par-dessus)' : 'Déplacer (Ctrl : copier)' }
}

/** Nom court de ce qu'on glisse, pour l'étiquette qui suit le pointeur. */
export function dragLabel(source: DragSource): string {
  switch (source.type) {
    case 'kind': return TILE_KIND_LABELS[source.kind].name
    case 'entity': return state.entities.find((e) => e.entityId === source.entityId)?.name ?? source.entityId
    case 'round': return `Bouton rond ${source.index + 1} · ${state.config?.buttons[source.index]?.name ?? ''}`
    default: {
      const t: SlotTarget = source.type === 'key' ? { kind: 'key', index: source.index } : { kind: 'strip', knob: source.knob }
      const tile = tileAt(t)
      return `${slotName(t)}${tile ? ` · ${TILE_KIND_LABELS[tile.kind].name}` : ''}`
    }
  }
}

// ---------- mode Essayer ----------

/** Envoie un geste à la page sélectionnée ; l'aperçu se recharge peu après (la maison a pu changer). */
export async function tryInput(e: InputEvent): Promise<void> {
  try {
    await api.pageInput(state.selectedButton, e)
    state.error = null
    setTimeout(() => { state.previewVersion++ }, 400)
  } catch (err) { fail(err) }
}

// ---------- entités : icône et valeur affichées dans la palette ----------

export function entityIcon(e: EntityInfo): string {
  if (e.icon) return e.icon
  switch (e.domain) {
    case 'light': return 'mdi:lightbulb'
    case 'switch': return 'mdi:toggle-switch'
    case 'input_boolean': return 'mdi:toggle-switch-outline'
    case 'fan': return 'mdi:fan'
    case 'scene': return 'mdi:palette'
    case 'script': return 'mdi:play'
    case 'binary_sensor': return e.deviceClass === 'motion' ? 'mdi:motion-sensor' : e.deviceClass === 'window' ? 'mdi:window-closed-variant' : 'mdi:door'
    case 'sensor': return e.deviceClass === 'temperature' ? 'mdi:thermometer' : e.deviceClass === 'power' ? 'mdi:flash' : 'mdi:gauge'
    case 'climate': return 'mdi:thermostat'
    case 'weather': return 'mdi:weather-partly-cloudy'
    case 'camera': return 'mdi:cctv'
    default: return 'mdi:home'
  }
}

export function entityValue(e: EntityInfo): string {
  if (e.state === 'unavailable' || e.state === 'unknown') return 'indisponible'
  const n = Number.parseFloat(e.state)
  if (e.domain === 'sensor' && Number.isFinite(n)) return `${new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1 }).format(n)}${e.unit ? ` ${e.unit}` : ''}`
  if (['light', 'switch', 'input_boolean', 'fan'].includes(e.domain)) return e.state === 'on' ? 'allumé' : 'éteint'
  if (e.domain === 'binary_sensor') return e.state === 'on' ? 'actif' : 'inactif'
  if (e.domain === 'scene' || e.domain === 'script') return ''
  return e.state
}

export function undo(): Promise<void> {
  return enqueue(async () => {
    try {
      state.config = await api.undo()
      state.error = null
      state.previewVersion++
    } catch (e) { fail(e) }
  })
}

export async function handleLive(m: LiveMessage) {
  switch (m.type) {
    case 'config':
      await loadConfig()
      state.previewVersion++
      break
    case 'active':
      state.activeButton = m.button
      break
    case 'status':
      await loadStatus()
      break
    case 'entities':
      await loadEntities()
      break
    case 'preview':
      state.previewVersion++
      break
  }
}

export async function init(): Promise<() => void> {
  // Les entités sont chargées par la palette à son ouverture, puis sur chaque message live « entities ».
  await Promise.all([loadConfig(), loadStatus()])
  // À chaque réouverture du WebSocket (serveur redémarré, coupure), des messages ont pu être manqués :
  // on recharge la configuration et le statut.
  return api.connectLive((m) => { void handleLive(m) }, () => {
    void Promise.all([loadConfig(), loadStatus()]).then(() => { state.previewVersion++ })
  })
}
