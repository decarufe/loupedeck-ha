<script setup lang="ts">
import { computed } from 'vue'
import type { KeySlot } from '@shared/config/schema'
import { clearSlot, state, updateSlot } from '../store'

const target = computed(() => state.selectedSlot)
const slot = computed<KeySlot | null>(() => {
  const b = state.config?.buttons[state.selectedButton]
  const t = target.value
  if (b?.type !== 'lights' || !t) return null
  return t.kind === 'key' ? (b.keys[t.index] ?? null) : b.dimmers[t.knob]
})
const title = computed(() => {
  const t = target.value
  return t ? (t.kind === 'key' ? `Touche ${t.index + 1}` : `Molette ${t.knob}`) : ''
})

function commit(field: 'label' | 'icon', e: Event) {
  const t = target.value
  const value = (e.target as HTMLInputElement).value
  if (!t || value === (slot.value?.[field] ?? '')) return
  void updateSlot(t, { [field]: value })
}
const blurOnEnter = (e: Event) => (e.target as HTMLInputElement).blur()
</script>

<template>
  <section v-if="slot && target" class="slot-editor" :aria-label="`Emplacement : ${title}`">
    <h3>{{ title }}</h3>
    <p class="entity-id">{{ slot.entityId }}</p>
    <label>
      Libellé
      <input class="slot-label" type="text" :value="slot.label ?? ''" placeholder="Nom affiché sur la touche" @blur="commit('label', $event)" @keydown.enter="blurOnEnter" />
    </label>
    <label>
      Icône
      <input class="slot-icon" type="text" :value="slot.icon ?? ''" placeholder="ex. mdi:lamp" @blur="commit('icon', $event)" @keydown.enter="blurOnEnter" />
    </label>
    <button type="button" class="slot-remove" @click="clearSlot(target)">Retirer</button>
  </section>
  <p v-else-if="target" class="hint">Emplacement vide : placez-y une entité (glisser-déposer, ou sélection dans la palette puis clic).</p>
</template>

<style scoped>
.slot-editor { display: flex; flex-direction: column; gap: 0.6rem; border-top: 1px solid #333; padding-top: 0.8rem; }
h3 { font-size: 0.95rem; margin: 0; }
.entity-id { margin: 0; color: #aaa; font-size: 0.85rem; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
input { font: inherit; color: inherit; background: #2a2a2a; border: 1px solid #555; border-radius: 6px; padding: 0.35rem; }
.hint { color: #aaa; margin: 0; font-size: 0.85rem; }
</style>
