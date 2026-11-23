<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { TILE_KINDS, type TileKind } from '@shared/config/schema'
import type { EntityInfo } from '@shared/shared/placement'
import { TILE_KIND_LABELS } from '@shared/shared/tiles'
import { loadEntities, state } from '../store'

const tab = ref<'kinds' | 'entities'>('entities')
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

const toggle = (e: EntityInfo) => {
  state.pendingKind = null
  state.pendingEntity = state.pendingEntity === e.entityId ? null : e.entityId
}
const toggleKind = (k: TileKind) => {
  state.pendingEntity = null
  state.pendingKind = state.pendingKind === k ? null : k
}

function dragStart(ev: DragEvent, e: EntityInfo) {
  ev.dataTransfer?.setData('application/x-entity-id', e.entityId)
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy'
  state.drag = { type: 'entity', entityId: e.entityId }
}
function dragKind(ev: DragEvent, k: TileKind) {
  ev.dataTransfer?.setData('application/x-tile-kind', k)
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy'
  state.drag = { type: 'kind', kind: k }
}
const dragEnd = () => { state.drag = null; state.dragOver = null }
</script>

<template>
  <section class="palette" aria-label="Palette : types de touche et entités Home Assistant">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" class="tab-kinds" :aria-selected="tab === 'kinds'" @click="tab = 'kinds'">Types de touche</button>
      <button type="button" role="tab" class="tab-entities" :aria-selected="tab === 'entities'" @click="tab = 'entities'">Entités</button>
    </div>
    <template v-if="tab === 'kinds'">
      <ul class="list kinds">
        <li v-for="k in TILE_KINDS" :key="k">
          <button
            type="button" class="kind-row" draggable="true" :data-kind="k"
            :class="{ pending: state.pendingKind === k }" :aria-pressed="state.pendingKind === k"
            @click="toggleKind(k)" @dragstart="dragKind($event, k)" @dragend="dragEnd"
          >
            <span class="name">{{ TILE_KIND_LABELS[k].name }}</span>
            <span class="id">{{ TILE_KIND_LABELS[k].desc }}</span>
          </button>
        </li>
      </ul>
      <p class="hint">Glissez un type sur une touche, puis choisissez son entité. Ou cliquez le type, puis l’emplacement.</p>
    </template>
    <template v-else>
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
    <p class="hint">Glissez une entité directement : le type de touche est deviné (porte → État, scène → Action, lumière sur une bande → Gradateur). Déposée sur une touche du même type, elle remplace l’entité et garde le format.</p>
    <ul class="list">
      <li v-for="e in rows" :key="e.entityId">
        <button
          type="button" class="entity-row" draggable="true"
          :class="{ pending: state.pendingEntity === e.entityId }" :aria-pressed="state.pendingEntity === e.entityId"
          @click="toggle(e)" @dragstart="dragStart($event, e)" @dragend="dragEnd"
        >
          <span class="name">{{ e.name }}</span>
          <span class="id">{{ e.entityId }}</span>
          <span v-if="e.areaName" class="area">{{ e.areaName }}</span>
          <span v-if="e.state === 'unavailable'" class="badge">Indisponible</span>
        </button>
      </li>
    </ul>
    <p v-if="rows.length === 0 && !state.entitiesUnavailable" class="hint">Aucune entité ne correspond.</p>
    </template>
  </section>
</template>

<style scoped>
.palette { display: flex; flex-direction: column; gap: 0.6rem; min-width: 18rem; max-width: 24rem; background: #1c1c1c; padding: 1rem; border-radius: 8px; }
h2 { font-size: 1.05rem; margin: 0; }
.filters { display: flex; flex-direction: column; gap: 0.4rem; }
input, select { font: inherit; color: inherit; background: #2a2a2a; border: 1px solid #555; border-radius: 6px; padding: 0.35rem; }
.list { list-style: none; margin: 0; padding: 0; max-height: 28rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem; }
.tabs { display: flex; gap: 0.3rem; }
.tabs button { flex: 1; background: transparent; }
.tabs button[aria-selected='true'] { background: #2a2a2a; border-color: #777; }
.kind-row { width: 100%; display: flex; flex-direction: column; align-items: flex-start; text-align: left; cursor: grab; }
.kind-row.pending { border-color: #4fc3f7; background: #1d3a4a; }
.entity-row { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 0 0.5rem; text-align: left; cursor: grab; }
.entity-row.pending { border-color: #4fc3f7; background: #1d3a4a; }
.id { color: #aaa; font-size: 0.8rem; grid-column: 1; }
.area { color: #aaa; font-size: 0.8rem; grid-column: 2; grid-row: 1; }
.badge { grid-column: 2; background: #5a1d1d; border-radius: 4px; padding: 0 0.4rem; font-size: 0.75rem; align-self: center; }
.palette-offline { margin: 0; padding: 0.5rem; background: #4a3d12; border: 1px solid #b8962e; border-radius: 6px; }
.hint { color: #aaa; margin: 0; font-size: 0.85rem; }
</style>
