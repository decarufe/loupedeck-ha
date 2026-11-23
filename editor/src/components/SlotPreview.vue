<script setup lang="ts">
import { computed } from 'vue'
import { KNOB_IDS } from '@shared/config/schema'
import { keyRect, stripZoneRect, type Rect } from '@shared/device/regions'
import { previewUrl } from '../api'
import { slotName, state, type SlotTarget } from '../store'

/**
 * Aperçu agrandi d'un emplacement : le morceau correspondant de l'aperçu de la console. Composant à part pour que
 * le rafraîchissement en direct ne redessine que lui, et non tout le panneau de réglages. Une image (plutôt qu'un
 * fond CSS) reste affichée jusqu'à l'arrivée de la suivante : pas de clignotement.
 */
const props = defineProps<{ target: SlotTarget }>()
const W = 480
const H = 270

const rect = computed<Rect>(() => {
  const t = props.target
  if (t.kind === 'key') return keyRect(t.index)
  const n = KNOB_IDS.indexOf(t.knob)
  return stripZoneRect(n < 3 ? 'left' : 'right', (n % 3) as 0 | 1 | 2)
})
const style = computed(() => {
  const r = rect.value
  return { width: `${(W / r.width) * 100}%`, height: `${(H / r.height) * 100}%`, left: `${(-r.x / r.width) * 100}%`, top: `${(-r.y / r.height) * 100}%` }
})
const src = computed(() => previewUrl(state.selectedButton, state.previewVersion))
</script>

<template>
  <div class="preview-tile" :class="{ 'strip-shape': target.kind === 'strip' }" role="img" :aria-label="`Aperçu de ${slotName(target)}`">
    <img :src="src" :style="style" alt="" draggable="false" />
  </div>
</template>

<style scoped>
.preview-tile { position: relative; overflow: hidden; width: 120px; aspect-ratio: 1; flex: none; border-radius: 8%; background: #000; border: 1px solid var(--line); }
.preview-tile.strip-shape { width: 80px; aspect-ratio: 60 / 90; }
.preview-tile img { position: absolute; max-width: none; }
</style>
