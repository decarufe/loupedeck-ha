<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { EntityInfo } from '@shared/shared/placement'
import { loadEntities, state } from '../store'

const search = ref('')
const domain = ref('')
const area = ref('')

onMounted(() => { void loadEntities() })

const domains = computed(() => [...new Set(state.entities.map((e) => e.domain))].sort())
const areas = computed(() => [...new Set(state.entities.flatMap((e) => (e.areaName ? [e.areaName] : [])))].sort((a, b) => a.localeCompare(b)))

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return state.entities.filter((e) =>
    (domain.value === '' || e.domain === domain.value)
    && (area.value === '' || e.areaName === area.value)
    && (q === '' || [e.name, e.entityId, e.areaName ?? ''].some((t) => t.toLowerCase().includes(q))))
})

const toggle = (e: EntityInfo) => { state.pendingEntity = state.pendingEntity === e.entityId ? null : e.entityId }

function dragStart(ev: DragEvent, e: EntityInfo) {
  ev.dataTransfer?.setData('application/x-entity-id', e.entityId)
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <section class="palette" aria-label="Entités Home Assistant">
    <h2>Entités</h2>
    <p v-if="state.entitiesUnavailable" class="palette-offline" role="status">Home Assistant hors ligne — liste des entités indisponible</p>
    <div class="filters">
      <input class="palette-search" type="search" placeholder="Rechercher (nom, identifiant, pièce)" aria-label="Rechercher une entité" v-model="search" />
      <select class="domain-filter" aria-label="Filtrer par type" v-model="domain">
        <option value="">Tous les types</option>
        <option v-for="d in domains" :key="d" :value="d">{{ d }}</option>
      </select>
      <select class="area-filter" aria-label="Filtrer par pièce" v-model="area">
        <option value="">Toutes les pièces</option>
        <option v-for="a in areas" :key="a" :value="a">{{ a }}</option>
      </select>
    </div>
    <p class="hint">Glissez une entité sur une touche ou une molette, ou sélectionnez-la puis cliquez sur l'emplacement.</p>
    <ul class="list">
      <li v-for="e in rows" :key="e.entityId">
        <button
          type="button" class="entity-row" draggable="true"
          :class="{ pending: state.pendingEntity === e.entityId }" :aria-pressed="state.pendingEntity === e.entityId"
          @click="toggle(e)" @dragstart="dragStart($event, e)"
        >
          <span class="name">{{ e.name }}</span>
          <span class="id">{{ e.entityId }}</span>
          <span v-if="e.areaName" class="area">{{ e.areaName }}</span>
          <span v-if="e.state === 'unavailable'" class="badge">Indisponible</span>
        </button>
      </li>
    </ul>
    <p v-if="rows.length === 0 && !state.entitiesUnavailable" class="hint">Aucune entité ne correspond.</p>
  </section>
</template>

<style scoped>
.palette { display: flex; flex-direction: column; gap: 0.6rem; min-width: 18rem; max-width: 24rem; background: #1c1c1c; padding: 1rem; border-radius: 8px; }
h2 { font-size: 1.05rem; margin: 0; }
.filters { display: flex; flex-direction: column; gap: 0.4rem; }
input, select { font: inherit; color: inherit; background: #2a2a2a; border: 1px solid #555; border-radius: 6px; padding: 0.35rem; }
.list { list-style: none; margin: 0; padding: 0; max-height: 28rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem; }
.entity-row { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 0 0.5rem; text-align: left; cursor: grab; }
.entity-row.pending { border-color: #4fc3f7; background: #1d3a4a; }
.id { color: #aaa; font-size: 0.8rem; grid-column: 1; }
.area { color: #aaa; font-size: 0.8rem; grid-column: 2; grid-row: 1; }
.badge { grid-column: 2; background: #5a1d1d; border-radius: 4px; padding: 0 0.4rem; font-size: 0.75rem; align-self: center; }
.palette-offline { margin: 0; padding: 0.5rem; background: #4a3d12; border: 1px solid #b8962e; border-radius: 6px; }
.hint { color: #aaa; margin: 0; font-size: 0.85rem; }
</style>
