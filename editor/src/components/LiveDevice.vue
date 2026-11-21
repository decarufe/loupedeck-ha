<script setup lang="ts">
import { computed } from 'vue'
import { KNOB_IDS } from '@shared/config/schema'
import { keyRect, stripZoneRect, type Rect } from '@shared/device/regions'
import { previewUrl } from '../api'
import { placeEntity, select, state, type SlotTarget } from '../store'

const SCALE = 1.5
const W = 480
const H = 270

const pct = (r: Rect) => ({
  left: `${(r.x / W) * 100}%`, top: `${(r.y / H) * 100}%`,
  width: `${(r.width / W) * 100}%`, height: `${(r.height / H) * 100}%`,
})

const buttons = computed(() => state.config?.buttons ?? [])
const selected = computed(() => buttons.value[state.selectedButton] ?? null)
const lights = computed(() => (selected.value?.type === 'lights' ? selected.value : null))

const keys = computed(() => Array.from({ length: 12 }, (_, i) => ({ i, style: pct(keyRect(i)), slot: lights.value?.keys[i] ?? null })))
const dimmers = computed(() =>
  KNOB_IDS.map((id, n) => {
    const side = n < 3 ? 'left' : 'right'
    return { id, style: pct(stripZoneRect(side, (n % 3) as 0 | 1 | 2)), slot: lights.value?.dimmers[id] ?? null }
  }),
)

const sameSlot = (a: SlotTarget | null, b: SlotTarget) =>
  a !== null && (a.kind === 'key' ? b.kind === 'key' && a.index === b.index : b.kind === 'dimmer' && a.knob === b.knob)

/** Avec une entité en attente (palette), un clic la place ; sinon il sélectionne l'emplacement pour l'éditer. */
function clickSlot(t: SlotTarget) {
  if (state.pendingEntity) void placeEntity(t, state.pendingEntity)
  else state.selectedSlot = sameSlot(state.selectedSlot, t) ? null : t
}

function dropOn(e: DragEvent, t: SlotTarget) {
  const id = e.dataTransfer?.getData('application/x-entity-id')
  if (id) void placeEntity(t, id)
}

const roundLabel = (i: number) => `Bouton rond ${i + 1}${buttons.value[i] ? ` — ${buttons.value[i]!.name}` : ' — vide'}`
</script>

<template>
  <div class="device">
    <div class="deck">
      <div class="knobs left"><span v-for="n in 3" :key="n" class="knob" aria-hidden="true" /></div>
      <div class="screen" :style="{ width: `${W * SCALE}px`, height: `${H * SCALE}px` }">
        <img v-if="selected" class="preview" :src="previewUrl(state.selectedButton, state.previewVersion)" alt="Aperçu du tableau" />
        <template v-if="lights">
          <button
            v-for="k in keys" :key="k.i" type="button" class="slot key-slot" :style="k.style"
            :data-key="k.i" :class="{ selected: sameSlot(state.selectedSlot, { kind: 'key', index: k.i }) }"
            @click="clickSlot({ kind: 'key', index: k.i })" @dragover.prevent @drop.prevent="dropOn($event, { kind: 'key', index: k.i })"
            :aria-label="`Touche ${k.i + 1}${k.slot ? ` — ${k.slot.label ?? k.slot.entityId}` : ' — vide'}`"
          />
          <button
            v-for="d in dimmers" :key="d.id" type="button" class="slot dimmer-slot" :style="d.style"
            :data-knob="d.id" :class="{ selected: sameSlot(state.selectedSlot, { kind: 'dimmer', knob: d.id }) }"
            @click="clickSlot({ kind: 'dimmer', knob: d.id })" @dragover.prevent @drop.prevent="dropOn($event, { kind: 'dimmer', knob: d.id })"
            :aria-label="`Molette ${d.id}${d.slot ? ` — ${d.slot.label ?? d.slot.entityId}` : ' — vide'}`"
          />
        </template>
      </div>
      <div class="knobs right"><span v-for="n in 3" :key="n" class="knob" aria-hidden="true" /></div>
    </div>
    <div class="rounds">
      <button
        v-for="(b, i) in buttons" :key="i" type="button" class="round-button"
        :class="{ empty: !b, selected: i === state.selectedButton, 'active-on-device': i === state.activeButton }"
        :style="b ? { backgroundColor: b.color } : undefined"
        :aria-label="roundLabel(i)" :aria-pressed="i === state.selectedButton"
        @click="select(i)"
      />
    </div>
  </div>
</template>

<style scoped>
.device { background: #0c0c0c; border: 2px solid #333; border-radius: 18px; padding: 1.2rem; }
.deck { display: flex; align-items: center; gap: 0.8rem; justify-content: center; }
.screen { position: relative; background: #000; border-radius: 4px; flex: none; }
.preview { width: 100%; height: 100%; display: block; }
.slot { position: absolute; padding: 0; border: 1px dashed transparent; background: transparent; border-radius: 2px; }
.slot.selected { border-color: #fff; background: rgba(255, 255, 255, 0.2); }
.slot:hover, .slot:focus-visible { border-color: #4fc3f7; background: rgba(79, 195, 247, 0.15); }
.knobs { display: flex; flex-direction: column; justify-content: space-around; align-self: stretch; }
.knob { width: 44px; height: 44px; border-radius: 50%; background: radial-gradient(#555, #222); border: 2px solid #444; }
.rounds { display: flex; justify-content: center; gap: 1.2rem; margin-top: 1.2rem; }
.round-button { width: 52px; height: 52px; border-radius: 50%; padding: 0; border: 3px solid #333; }
.round-button.empty { background: #1a1a1a; border-style: dashed; }
.round-button.selected { border-color: #fff; box-shadow: 0 0 0 2px #4fc3f7; }
.round-button.active-on-device { outline: 3px solid #66bb6a; outline-offset: 3px; }
</style>
