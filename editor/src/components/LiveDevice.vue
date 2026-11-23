<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { arrangeOrder, DASHBOARD_LABELS, isEmptyPage, KNOB_IDS, type KnobId } from '@shared/config/schema'
import type { TapTarget } from '@shared/device/input'
import { keyRect, stripZoneRect, type Rect } from '@shared/device/regions'
import { previewUrl } from '../api'
import {
  canDropOn, clearSlot, dragLabel, movePage, moveTile, placeEntity, placeKind, select, selectSlot, slotId, state, tryInput,
  type DragSource, type SlotTarget,
} from '../store'

const W = 480
const H = 270
/** Pendant l'animation du réordonnancement, la cible survolée ne change pas (évite les va-et-vient). */
const LOCK_MS = 200
const KNOB_STEP_PX = 12
const KNOB_NAMES: Record<KnobId, string> = {
  knobTL: 'molette haut gauche', knobCL: 'molette milieu gauche', knobBL: 'molette bas gauche',
  knobTR: 'molette haut droite', knobCR: 'molette milieu droite', knobBR: 'molette bas droite',
}
const BLANK = typeof Image !== 'undefined' ? Object.assign(new Image(), { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }) : null

const pct = (r: Rect) => ({
  left: `${(r.x / W) * 100}%`, top: `${(r.y / H) * 100}%`,
  width: `${(r.width / W) * 100}%`, height: `${(r.height / H) * 100}%`,
})

const buttons = computed(() => state.config?.buttons ?? [])
const selected = computed(() => buttons.value[state.selectedButton] ?? null)
const custom = computed(() => (selected.value?.type === 'custom' ? selected.value : null))
const src = computed(() => previewUrl(state.selectedButton, state.previewVersion))
const editing = computed(() => state.mode === 'edit')
const title = computed(() => {
  const d = selected.value
  if (!d) return 'Bouton rond vide'
  return `${d.name} · ${isEmptyPage(d) ? 'page vide' : DASHBOARD_LABELS[d.type]}`
})

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

/** Pendant un glisser : cible valide (vert) ou non (atténuée). */
const verdictClass = (id: string) => {
  if (!state.drag) return ''
  return canDropOn(state.drag, id).ok ? 'ok' : 'no'
}

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
  if (!editing.value) return
  if (state.pendingEntity) void placeEntity(t, state.pendingEntity)
  else if (state.pendingKind) void placeKind(t, state.pendingKind)
  else selectSlot(t)
}

// ---------- mode Essayer : gestes transmis à la page ----------

const tapTarget = (t: SlotTarget): TapTarget => {
  if (t.kind === 'key') return { kind: 'key', index: t.index }
  const n = KNOB_IDS.indexOf(t.knob)
  return { kind: 'strip', side: n < 3 ? 'left' : 'right', zone: (n % 3) as 0 | 1 | 2 }
}
/** Sur une page sans touches (plein écran), l'écran entier reçoit les gestes : on retrouve la zone touchée. */
function screenTarget(e: PointerEvent): TapTarget | null {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return null
  const x = ((e.clientX - r.left) / r.width) * W
  const y = ((e.clientY - r.top) / r.height) * H
  const zone = Math.max(0, Math.min(2, Math.floor(y / 90))) as 0 | 1 | 2
  if (x < 60) return { kind: 'strip', side: 'left', zone }
  if (x >= 420) return { kind: 'strip', side: 'right', zone }
  return { kind: 'key', index: zone * 4 + Math.max(0, Math.min(3, Math.floor((x - 60) / 90))) }
}
let pressed: TapTarget | null = null
function tryDown(e: PointerEvent, t?: SlotTarget) {
  if (editing.value || !selected.value) return
  const target = t ? tapTarget(t) : screenTarget(e)
  if (!target) return
  pressed = target
  void tryInput({ type: 'tap', target })
}
function tryUp() {
  if (!pressed) return
  const target = pressed
  pressed = null
  void tryInput({ type: 'release', target })
}
function screenDown(e: PointerEvent) {
  if (!custom.value) tryDown(e)
}

const knobDrag = ref<{ knob: KnobId; y: number; moved: boolean } | null>(null)
function knobDown(e: PointerEvent, knob: KnobId) {
  if (editing.value || !selected.value) return
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  knobDrag.value = { knob, y: e.clientY, moved: false }
}
function knobMove(e: PointerEvent) {
  const k = knobDrag.value
  if (!k) return
  const dy = k.y - e.clientY
  if (Math.abs(dy) >= KNOB_STEP_PX) {
    k.y = e.clientY
    k.moved = true
    void tryInput({ type: 'knobTurn', knob: k.knob, delta: Math.sign(dy) })
  }
}
function knobUp() {
  const k = knobDrag.value
  knobDrag.value = null
  if (k && !k.moved) void tryInput({ type: 'knobPress', knob: k.knob })
}
function knobWheel(e: WheelEvent, knob: KnobId) {
  if (editing.value || !selected.value) return
  e.preventDefault()
  void tryInput({ type: 'knobTurn', knob, delta: e.deltaY < 0 ? 1 : -1 })
}

// ---------- glisser-déposer (mode Éditer) ----------

const ghost = ref<{ x: number; y: number } | null>(null)
const ghostVerdict = computed(() => (state.drag && state.dragOver ? canDropOn(state.drag, state.dragOver) : null))
function trackPointer(e: DragEvent) {
  if (state.drag && (e.clientX || e.clientY)) ghost.value = { x: e.clientX, y: e.clientY }
}
onMounted(() => document.addEventListener('dragover', trackPointer))
onBeforeUnmount(() => document.removeEventListener('dragover', trackPointer))

function startDrag(e: DragEvent, source: DragSource, data: string) {
  if (!editing.value) { e.preventDefault(); return }
  state.drag = source
  state.dragOver = null
  e.dataTransfer?.setData('application/x-slot', data)
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copyMove'
    if (BLANK) e.dataTransfer.setDragImage?.(BLANK, 0, 0)
  }
}

let lockUntil = 0
let pendingOver: string | null = null
let lockTimer: ReturnType<typeof setTimeout> | undefined
function endDrag() {
  clearTimeout(lockTimer)
  pendingOver = null
  ghost.value = null
  state.drag = null
  state.dragOver = null
  state.dragSwap = false
}
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
function overRound(e: DragEvent, pos: number) {
  if (state.drag?.type === 'round') over(e, `round:${pos}`)
}

const tileLabel = (t: { label?: string; kind: string; entityId?: string | null } | null) => (t ? t.label ?? (t.entityId || t.kind) : null)
const roundLabel = (i: number) => `Bouton rond ${i + 1}${buttons.value[i] ? ` — ${buttons.value[i]!.name}` : ' — vide'}`
const knobLinked = (knob: KnobId) => custom.value?.strips[knob]?.kind === 'dimmer'
  || (selected.value?.type === 'graph' && ['knobTL', 'knobCL', 'knobTR', 'knobCR'].includes(knob))
  || (selected.value?.type === 'climate' && selected.value.setpointKnob === knob)
</script>

<template>
  <section class="device-wrap" aria-label="Console" @dragleave="leaveDevice">
    <div class="device-bar">
      <div class="dash-name"><span class="dot" :style="{ background: selected?.color ?? '#333' }" />{{ title }}</div>
      <div class="mode-hint">
        {{ editing ? 'Éditer : cliquer pour régler, glisser pour placer' : 'Essayer : touches et molettes (glisser ou molette de souris) comme sur la vraie console' }}
      </div>
    </div>
    <div class="device" :class="editing ? 'edit' : 'try'">
      <div class="deck">
        <div class="knobs">
          <span
            v-for="k in KNOB_IDS.slice(0, 3)" :key="k" class="knob" :class="{ linked: knobLinked(k) }" :data-knob-control="k"
            :title="KNOB_NAMES[k]" :aria-label="KNOB_NAMES[k]" role="slider"
            @pointerdown="knobDown($event, k)" @pointermove="knobMove" @pointerup="knobUp" @pointercancel="knobDrag = null" @wheel="knobWheel($event, k)"
          />
        </div>
        <div class="screen" :class="{ 'tile-drag': draggingTile }" @pointerdown="screenDown" @pointerup="tryUp" @pointerleave="tryUp">
          <img v-if="selected" class="preview" :src="src" alt="Aperçu de la page" draggable="false" />
          <div v-else class="empty-screen">Bouton rond libre.<br />Choisissez un type de page dans le panneau de droite.</div>
          <template v-if="custom">
            <button
              v-for="k in keys" :key="k.oi" type="button" class="slot key-slot" :style="k.style"
              :data-key="k.pos" :draggable="editing && Boolean(k.tile)"
              :class="[verdictClass(`key:${k.pos}`), { selected: isSelected({ kind: 'key', index: k.oi }), lifted: isLifted({ kind: 'key', index: k.oi }), filled: Boolean(k.tile), hover: state.dragOver === `key:${k.pos}` }]"
              :aria-label="`Touche ${k.pos + 1}${k.tile ? ` — ${tileLabel(k.tile)}` : ' — vide'}`"
              @click="clickSlot({ kind: 'key', index: k.oi })"
              @pointerdown.stop="tryDown($event, { kind: 'key', index: k.oi })"
              @dragstart="startDrag($event, { type: 'key', index: k.oi }, `key:${k.oi}`)" @dragend="endDrag"
              @dragover.prevent="over($event, `key:${k.pos}`)" @drop.prevent="dropOn($event, { kind: 'key', index: k.pos })"
            />
            <button
              v-for="d in strips" :key="d.knob" type="button" class="slot dimmer-slot" :style="d.style"
              :data-knob="d.knob" :draggable="editing && Boolean(d.tile)"
              :class="[verdictClass(`strip:${d.knob}`), { selected: isSelected({ kind: 'strip', knob: d.knob }), lifted: isLifted({ kind: 'strip', knob: d.knob }), filled: Boolean(d.tile), hover: state.dragOver === `strip:${d.knob}` }]"
              :aria-label="`Molette ${d.knob}${d.tile ? ` — ${tileLabel(d.tile)}` : ' — vide'}`"
              @click="clickSlot({ kind: 'strip', knob: d.knob })"
              @pointerdown.stop="tryDown($event, { kind: 'strip', knob: d.knob })"
              @dragstart="startDrag($event, { type: 'strip', knob: d.knob }, `strip:${d.knob}`)" @dragend="endDrag"
              @dragover.prevent="over($event, `strip:${d.knob}`)" @drop.prevent="dropOn($event, { kind: 'strip', knob: d.knob })"
            />
          </template>
        </div>
        <div class="knobs">
          <span
            v-for="k in KNOB_IDS.slice(3)" :key="k" class="knob" :class="{ linked: knobLinked(k) }" :data-knob-control="k"
            :title="KNOB_NAMES[k]" :aria-label="KNOB_NAMES[k]" role="slider"
            @pointerdown="knobDown($event, k)" @pointermove="knobMove" @pointerup="knobUp" @pointercancel="knobDrag = null" @wheel="knobWheel($event, k)"
          />
        </div>
      </div>
      <div class="rounds">
        <button
          v-for="r in rounds" :key="r.oi" type="button" class="round round-button" :data-round="r.pos"
          :class="[verdictClass(`round:${r.pos}`), { empty: !r.b, selected: r.oi === state.selectedButton, 'active-on-device': r.oi === state.activeButton, lifted: state.drag?.type === 'round' && state.drag.index === r.oi, hover: state.dragOver === `round:${r.pos}` }]"
          :style="{ left: `${r.pos * 12.5}%` }"
          :draggable="editing && Boolean(r.b)" :aria-label="roundLabel(r.oi)" :aria-pressed="r.oi === state.selectedButton"
          @click="select(r.oi)"
          @dragstart="startDrag($event, { type: 'round', index: r.oi }, `round:${r.oi}`)" @dragend="endDrag"
          @dragover.prevent="overRound($event, r.pos)" @drop.prevent="dropOnRound($event, r.pos)"
        >
          <span v-if="r.b" class="led" :style="{ background: r.b.color, opacity: r.oi === state.selectedButton ? 1 : 0.35 }" />
          <span v-else class="plus">+</span>
        </button>
      </div>
    </div>
    <div
      v-if="draggingTile" class="trash" :class="{ hover: state.dragOver === 'trash' }"
      @dragover.prevent="over($event, 'trash')" @drop.prevent="dropOnTrash"
    >Déposer ici pour retirer la touche</div>

    <div v-if="state.drag && ghost" class="ghost" :style="{ transform: `translate(${ghost.x + 14}px, ${ghost.y + 14}px)` }" aria-hidden="true">
      <strong>{{ dragLabel(state.drag) }}</strong>
      <span v-if="ghostVerdict?.ok" class="how">{{ ghostVerdict.how }}</span>
      <span v-else-if="ghostVerdict && ghostVerdict.why" class="why">{{ ghostVerdict.why }}</span>
    </div>
  </section>
</template>

<style scoped>
.device-wrap { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.device-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.dash-name { font-family: var(--font-display); font-weight: 600; font-size: 1rem; display: flex; align-items: center; gap: 8px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.mode-hint { color: var(--muted); font-size: 0.8rem; }
.device { background: var(--device); border: 2px solid #2b2b2e; border-radius: 22px; padding: 3% 3% 2.4%; box-shadow: inset 0 1px 0 #1f1f22; }
.deck { display: grid; grid-template-columns: 9% 1fr 9%; gap: 2.2%; align-items: stretch; }
.knobs { display: flex; flex-direction: column; justify-content: space-around; align-items: center; }
.knob { width: 100%; aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #4a4a50, #1b1b1e 70%); border: 2px solid #3a3a40; position: relative; touch-action: none; }
.knob::after { content: ''; position: absolute; left: 50%; top: 8%; width: 3px; height: 22%; background: #777; transform: translateX(-50%) rotate(-135deg); transform-origin: 50% 190%; border-radius: 2px; }
.knob.linked { border-color: var(--accent); }
.try .knob { cursor: ns-resize; }
.screen { position: relative; aspect-ratio: 480 / 270; background: #000; border-radius: 4px; overflow: hidden; }
.try .screen { cursor: pointer; }
.preview { width: 100%; height: 100%; display: block; user-select: none; }
.empty-screen { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; color: #8b939e; font-size: 0.9rem; padding: 6%; line-height: 1.4; }
/* Pendant un glisser de touche, l'aperçu est remplacé par les touches elles-mêmes, qui se décalent en direct. */
.screen.tile-drag .preview { visibility: hidden; }
.slot {
  position: absolute; padding: 0; border: 0; background: transparent no-repeat; border-radius: 3px;
  transition: left 180ms ease, top 180ms ease, box-shadow 120ms ease, opacity 120ms ease;
}
.edit .slot:hover { box-shadow: inset 0 0 0 2px var(--accent); }
.slot.selected { box-shadow: inset 0 0 0 2px #fff, inset 0 0 0 4px var(--accent); }
.edit .slot.filled { cursor: grab; }
.slot.lifted { opacity: 0.55; outline: 2px dashed var(--accent); outline-offset: -2px; }
.slot.ok { box-shadow: inset 0 0 0 2px var(--ok); }
.slot.ok.hover { box-shadow: inset 0 0 0 4px var(--ok); background-color: rgba(102, 187, 106, 0.18); }
.slot.no:not(.lifted) { opacity: 0.35; background-color: rgba(0, 0, 0, 0.5); }
.rounds { position: relative; aspect-ratio: 8 / 0.84; margin: 3% 8% 0; }
.round { position: absolute; top: 0; width: 9.5%; margin-left: 1.5%; aspect-ratio: 1; border-radius: 50%; padding: 0; border: 3px solid #2e2e33; background: #161618; transition: left 180ms ease; }
.round .led { position: absolute; inset: 22%; border-radius: 50%; }
.round.selected { border-color: #fff; box-shadow: 0 0 0 2px var(--accent); }
.round.empty { border-style: dashed; }
.round .plus { position: absolute; inset: 0; display: grid; place-items: center; color: #666; font-size: 1.2rem; }
.round.active-on-device { outline: 3px solid var(--ok); outline-offset: 3px; }
.round.lifted { opacity: 0.55; border-style: dashed; border-color: var(--accent); }
.round.ok.hover { box-shadow: 0 0 0 4px var(--ok); }
.trash { display: flex; align-items: center; justify-content: center; border: 2px dashed #6a2c2c; color: #f3b1b1; border-radius: 10px; padding: 10px; background: #2a1414; }
.trash.hover { background: #4a1d1d; border-color: var(--bad); }
.ghost { position: fixed; left: 0; top: 0; pointer-events: none; z-index: 50; background: var(--panel-2); border: 1px solid var(--accent); border-radius: 8px; padding: 6px 10px; font-size: 0.85rem; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); max-width: 280px; }
.ghost .how { display: block; font-size: 0.75rem; color: #b8e6bb; margin-top: 2px; }
.ghost .why { display: block; font-size: 0.75rem; color: #f3b1b1; margin-top: 2px; }
</style>
