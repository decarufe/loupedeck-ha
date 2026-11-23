<script setup lang="ts">
import { computed } from 'vue'
import { arrangeOrder, KNOB_IDS, type KnobId } from '@shared/config/schema'
import { keyRect, stripZoneRect, type Rect } from '@shared/device/regions'
import { previewUrl } from '../api'
import {
  clearSlot, movePage, moveTile, placeEntity, placeKind, select, selectSlot, slotId, state,
  type DragSource, type SlotTarget,
} from '../store'

const SCALE = 1.5
const W = 480
const H = 270
/** Pendant l'animation du réordonnancement, la cible survolée ne change pas (évite les va-et-vient). */
const LOCK_MS = 200
const ROUND_STEP = 70

const pct = (r: Rect) => ({
  left: `${(r.x / W) * 100}%`, top: `${(r.y / H) * 100}%`,
  width: `${(r.width / W) * 100}%`, height: `${(r.height / H) * 100}%`,
})

const buttons = computed(() => state.config?.buttons ?? [])
const selected = computed(() => buttons.value[state.selectedButton] ?? null)
const custom = computed(() => (selected.value?.type === 'custom' ? selected.value : null))
const src = computed(() => previewUrl(state.selectedButton, state.previewVersion))

/** Morceau de l'aperçu correspondant à un emplacement : pendant un glisser, chaque touche emporte son image. */
const crop = (r: Rect) => ({
  backgroundImage: `url(${src.value})`,
  backgroundSize: `${(W / r.width) * 100}% ${(H / r.height) * 100}%`,
  backgroundPosition: `${(r.x / (W - r.width)) * 100}% ${r.height === H ? 0 : (r.y / (H - r.height)) * 100}%`,
})

const draggingTile = computed(() => state.drag?.type === 'key' || state.drag?.type === 'strip')

const keyOrder = computed(() => {
  const d = state.drag
  const over = state.dragOver
  const page = custom.value
  if (page && d?.type === 'key' && over?.startsWith('key:')) return arrangeOrder(page.keys, d.index, Number(over.slice(4)), state.dragSwap)
  return Array.from({ length: 12 }, (_, i) => i)
})
const roundOrder = computed(() => {
  const d = state.drag
  const over = state.dragOver
  if (d?.type === 'round' && over?.startsWith('round:')) return arrangeOrder(buttons.value, d.index, Number(over.slice(6)), state.dragSwap)
  return buttons.value.map((_, i) => i)
})

/** Touches gardées par leur place d'origine (`oi`), dessinées à leur place provisoire (`pos`). */
const keys = computed(() => Array.from({ length: 12 }, (_, oi) => {
  const pos = keyOrder.value.indexOf(oi)
  return { oi, pos, style: { ...pct(keyRect(pos)), ...(draggingTile.value ? crop(keyRect(oi)) : {}) }, tile: custom.value?.keys[oi] ?? null }
}))
const strips = computed(() => KNOB_IDS.map((knob, n) => {
  const r = stripZoneRect(n < 3 ? 'left' : 'right', (n % 3) as 0 | 1 | 2)
  return { knob, style: { ...pct(r), ...(draggingTile.value ? crop(r) : {}) }, tile: custom.value?.strips[knob] ?? null }
}))
const rounds = computed(() => buttons.value.map((b, oi) => ({ oi, pos: roundOrder.value.indexOf(oi), b })))

const isSelected = (t: SlotTarget) => state.selectedSlot !== null && slotId(state.selectedSlot) === slotId(t)
const isLifted = (t: SlotTarget) => (state.drag?.type === 'key' && t.kind === 'key' && state.drag.index === t.index)
  || (state.drag?.type === 'strip' && t.kind === 'strip' && state.drag.knob === t.knob)

/** Avec une entité ou un type en attente (palette), un clic le pose ; sinon il sélectionne l'emplacement. */
function clickSlot(t: SlotTarget) {
  if (state.pendingEntity) void placeEntity(t, state.pendingEntity)
  else if (state.pendingKind) void placeKind(t, state.pendingKind)
  else selectSlot(t)
}

function startDrag(e: DragEvent, source: DragSource, data: string) {
  state.drag = source
  state.dragOver = null
  e.dataTransfer?.setData('application/x-slot', data)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove'
}
function endDrag() {
  clearTimeout(lockTimer)
  pendingOver = null
  state.drag = null
  state.dragOver = null
  state.dragSwap = false
}

let lockUntil = 0
let pendingOver: string | null = null
let lockTimer: ReturnType<typeof setTimeout> | undefined
function over(e: DragEvent, id: string) {
  state.dragSwap = e.shiftKey
  if (e.dataTransfer) e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey || e.altKey ? 'copy' : 'move'
  const now = performance.now()
  if (state.dragOver === id) { pendingOver = null; return }
  if (now < lockUntil) {
    // Survol pendant l'animation : appliqué à la fin du verrou, même si le pointeur ne bouge plus.
    pendingOver = id
    clearTimeout(lockTimer)
    lockTimer = setTimeout(() => {
      if (state.drag && pendingOver) { state.dragOver = pendingOver; pendingOver = null; lockUntil = performance.now() + LOCK_MS }
    }, lockUntil - now)
    return
  }
  pendingOver = null
  state.dragOver = id
  lockUntil = now + LOCK_MS
}
function leaveDevice(e: DragEvent) {
  const to = e.relatedTarget as Node | null
  if (!to || !(e.currentTarget as HTMLElement).contains(to)) state.dragOver = null
}

/** Source du dépôt : le glisser suivi par l'éditeur, sinon les données du `dataTransfer` (glisser venu d'ailleurs, tests). */
function sourceOf(e: DragEvent): DragSource | null {
  if (state.drag) return state.drag
  const dt = e.dataTransfer
  const entityId = dt?.getData('application/x-entity-id')
  if (entityId) return { type: 'entity', entityId }
  const kind = dt?.getData('application/x-tile-kind')
  if (kind) return { type: 'kind', kind: kind as never }
  const slot = dt?.getData('application/x-slot') ?? ''
  const m = /^(key|round):(\d+)$/.exec(slot)
  if (m) return { type: m[1] as 'key' | 'round', index: Number(m[2]) }
  const s = /^strip:(\w+)$/.exec(slot)
  if (s) return { type: 'strip', knob: s[1] as KnobId }
  return null
}
const asTarget = (s: DragSource): SlotTarget | null => (s.type === 'key' ? { kind: 'key', index: s.index } : s.type === 'strip' ? { kind: 'strip', knob: s.knob } : null)

/** Place montrée par l'aperçu au moment du dépôt : on dépose là où l'utilisateur voit la touche. */
function previewed(prefix: 'key:' | 'round:', fallback: number): number {
  const id = pendingOver ?? state.dragOver
  return id?.startsWith(prefix) ? Number(id.slice(prefix.length)) : fallback
}
function dropOn(e: DragEvent, t: SlotTarget) {
  const s = sourceOf(e)
  const copy = e.ctrlKey || e.metaKey || e.altKey
  const target: SlotTarget = s?.type === 'key' && t.kind === 'key' && !copy ? { kind: 'key', index: previewed('key:', t.index) } : t
  endDrag()
  if (!s) return
  if (s.type === 'entity') void placeEntity(t, s.entityId)
  else if (s.type === 'kind') void placeKind(t, s.kind)
  else if (s.type === 'key' || s.type === 'strip') void moveTile(asTarget(s)!, target, { swap: e.shiftKey, copy })
}
function dropOnRound(e: DragEvent, pos: number) {
  const s = sourceOf(e)
  const to = previewed('round:', pos)
  endDrag()
  if (s?.type === 'round') void movePage(s.index, to, e.shiftKey)
}
function dropOnTrash(e: DragEvent) {
  const s = sourceOf(e)
  endDrag()
  const t = s ? asTarget(s) : null
  if (t) void clearSlot(t)
}

const tileLabel = (t: { label?: string; kind: string; entityId?: string | null } | null) => (t ? t.label ?? (t.entityId || t.kind) : null)
const roundLabel = (i: number) => `Bouton rond ${i + 1}${buttons.value[i] ? ` — ${buttons.value[i]!.name}` : ' — vide'}`
</script>

<template>
  <div class="device" @dragleave="leaveDevice">
    <div class="deck">
      <div class="knobs left"><span v-for="n in 3" :key="n" class="knob" aria-hidden="true" /></div>
      <div class="screen" :class="{ 'tile-drag': draggingTile }" :style="{ width: `${W * SCALE}px`, height: `${H * SCALE}px` }">
        <img v-if="selected" class="preview" :src="src" alt="Aperçu du tableau" />
        <template v-if="custom">
          <button
            v-for="k in keys" :key="k.oi" type="button" class="slot key-slot" :style="k.style"
            :data-key="k.pos" :draggable="Boolean(k.tile)"
            :class="{ selected: isSelected({ kind: 'key', index: k.oi }), lifted: isLifted({ kind: 'key', index: k.oi }), filled: Boolean(k.tile) }"
            :aria-label="`Touche ${k.pos + 1}${k.tile ? ` — ${tileLabel(k.tile)}` : ' — vide'}`"
            @click="clickSlot({ kind: 'key', index: k.oi })"
            @dragstart="startDrag($event, { type: 'key', index: k.oi }, `key:${k.oi}`)" @dragend="endDrag"
            @dragover.prevent="over($event, `key:${k.pos}`)" @drop.prevent="dropOn($event, { kind: 'key', index: k.pos })"
          />
          <button
            v-for="d in strips" :key="d.knob" type="button" class="slot dimmer-slot" :style="d.style"
            :data-knob="d.knob" :draggable="Boolean(d.tile)"
            :class="{ selected: isSelected({ kind: 'strip', knob: d.knob }), lifted: isLifted({ kind: 'strip', knob: d.knob }), filled: Boolean(d.tile) }"
            :aria-label="`Molette ${d.knob}${d.tile ? ` — ${tileLabel(d.tile)}` : ' — vide'}`"
            @click="clickSlot({ kind: 'strip', knob: d.knob })"
            @dragstart="startDrag($event, { type: 'strip', knob: d.knob }, `strip:${d.knob}`)" @dragend="endDrag"
            @dragover.prevent="over($event, `strip:${d.knob}`)" @drop.prevent="dropOn($event, { kind: 'strip', knob: d.knob })"
          />
        </template>
      </div>
      <div class="knobs right"><span v-for="n in 3" :key="n" class="knob" aria-hidden="true" /></div>
    </div>
    <div class="rounds" :style="{ width: `${buttons.length * ROUND_STEP}px` }">
      <button
        v-for="r in rounds" :key="r.oi" type="button" class="round-button" :data-round="r.pos"
        :class="{ empty: !r.b, selected: r.oi === state.selectedButton, 'active-on-device': r.oi === state.activeButton, lifted: state.drag?.type === 'round' && state.drag.index === r.oi }"
        :style="{ left: `${r.pos * ROUND_STEP}px`, ...(r.b ? { backgroundColor: r.b.color } : {}) }"
        :draggable="Boolean(r.b)" :aria-label="roundLabel(r.oi)" :aria-pressed="r.oi === state.selectedButton"
        @click="select(r.oi)"
        @dragstart="startDrag($event, { type: 'round', index: r.oi }, `round:${r.oi}`)" @dragend="endDrag"
        @dragover.prevent="state.drag?.type === 'round' && over($event, `round:${r.pos}`)" @drop.prevent="dropOnRound($event, r.pos)"
      />
    </div>
    <div v-if="draggingTile" class="trash" @dragover.prevent @drop.prevent="dropOnTrash">Déposer ici pour retirer la touche</div>
  </div>
</template>

<style scoped>
.device { background: #0c0c0c; border: 2px solid #333; border-radius: 18px; padding: 1.2rem; }
.deck { display: flex; align-items: center; gap: 0.8rem; justify-content: center; }
.screen { position: relative; background: #000; border-radius: 4px; flex: none; overflow: hidden; }
.preview { width: 100%; height: 100%; display: block; }
/* Pendant un glisser de touche, l'aperçu est remplacé par les touches elles-mêmes, qui se décalent en direct. */
.screen.tile-drag .preview { visibility: hidden; }
.slot {
  position: absolute; padding: 0; border: 1px dashed transparent; background: transparent no-repeat; border-radius: 2px;
  transition: left 180ms ease, top 180ms ease;
}
.slot.selected { border-color: #fff; background-color: rgba(255, 255, 255, 0.2); }
.slot:hover, .slot:focus-visible { border-color: #4fc3f7; background-color: rgba(79, 195, 247, 0.15); }
.slot.filled { cursor: grab; }
.slot.lifted { opacity: 0.55; border: 2px dashed #4fc3f7; }
.knobs { display: flex; flex-direction: column; justify-content: space-around; align-self: stretch; }
.knob { width: 44px; height: 44px; border-radius: 50%; background: radial-gradient(#555, #222); border: 2px solid #444; }
.rounds { position: relative; height: 58px; margin: 1.2rem auto 0; }
.round-button { position: absolute; top: 0; width: 52px; height: 52px; border-radius: 50%; padding: 0; border: 3px solid #333; transition: left 180ms ease; }
.round-button.empty { background: #1a1a1a; border-style: dashed; }
.round-button.selected { border-color: #fff; box-shadow: 0 0 0 2px #4fc3f7; }
.round-button.active-on-device { outline: 3px solid #66bb6a; outline-offset: 3px; }
.round-button.lifted { opacity: 0.55; border-style: dashed; border-color: #4fc3f7; }
.trash { margin-top: 0.8rem; padding: 0.6rem; text-align: center; border: 2px dashed #6a2c2c; color: #f3b1b1; background: #2a1414; border-radius: 10px; }
@media (prefers-reduced-motion: reduce) { .slot, .round-button { transition: none; } }
</style>
