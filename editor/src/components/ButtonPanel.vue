<script setup lang="ts">
import { computed } from 'vue'
import { emptyDashboard, type DashboardConfig } from '@shared/config/schema'
import { save, state } from '../store'
import DashboardEntities from './DashboardEntities.vue'
import SlotEditor from './SlotEditor.vue'

type Kind = DashboardConfig['type']
const TYPES: { value: Kind; label: string }[] = [
  { value: 'lights', label: 'Lumières' },
  { value: 'climate', label: 'Température' },
  { value: 'weather', label: 'Météo' },
  { value: 'camera', label: 'Caméra' },
]

const index = computed(() => state.selectedButton)
const dashboard = computed(() => state.config?.buttons[index.value] ?? null)
const current = computed(() => dashboard.value?.type ?? '')

function changeType(e: Event) {
  const el = e.target as HTMLSelectElement
  const value = el.value as Kind | ''
  if (value === current.value) return
  const label = value === '' ? 'vide' : TYPES.find((t) => t.value === value)!.label
  const msg = `Changer le type du bouton ${index.value + 1} en « ${label} » ? La configuration actuelle de ce bouton sera perdue.`
  if (!window.confirm(msg)) {
    el.value = current.value
    return
  }
  const i = index.value
  void save((cfg) => { cfg.buttons[i] = value === '' ? null : emptyDashboard(value, i) })
}

function rename(e: Event) {
  const name = (e.target as HTMLInputElement).value
  const i = index.value
  if (name === dashboard.value?.name) return
  void save((cfg) => { const b = cfg.buttons[i]; if (b) b.name = name })
}

function recolor(e: Event) {
  const color = (e.target as HTMLInputElement).value
  const i = index.value
  if (color.toLowerCase() === dashboard.value?.color.toLowerCase()) return
  void save((cfg) => { const b = cfg.buttons[i]; if (b) b.color = color.toUpperCase() })
}

function commitOnEnter(e: Event) {
  (e.target as HTMLInputElement).blur()
}
</script>

<template>
  <section class="panel" :aria-label="`Configuration du bouton rond ${index + 1}`">
    <h2>Bouton rond {{ index + 1 }}</h2>
    <label>
      Type
      <select class="type-select" :value="current" @change="changeType">
        <option value="">Vide</option>
        <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
      </select>
    </label>
    <template v-if="dashboard">
      <label>
        Nom
        <input class="name-input" type="text" :value="dashboard.name" @blur="rename" @keydown.enter="commitOnEnter" />
      </label>
      <label>
        Couleur
        <input class="color-input" type="color" :value="dashboard.color.toLowerCase()" @change="recolor" />
      </label>
      <DashboardEntities />
      <SlotEditor />
    </template>
    <p v-else class="hint">Ce bouton est vide : choisissez un type pour le configurer.</p>
  </section>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: 0.8rem; min-width: 16rem; background: #1c1c1c; padding: 1rem; border-radius: 8px; }
h2 { font-size: 1.05rem; margin: 0; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
select, input[type='text'] { font: inherit; color: inherit; background: #2a2a2a; border: 1px solid #555; border-radius: 6px; padding: 0.35rem; }
input[type='color'] { width: 4rem; height: 2rem; padding: 0; background: none; border: 1px solid #555; }
.hint { color: #aaa; margin: 0; }
</style>
