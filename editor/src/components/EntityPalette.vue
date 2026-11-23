<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { TILE_KINDS, type TileKind } from '@shared/config/schema'
import type { EntityInfo } from '@shared/shared/placement'
import { TILE_KIND_LABELS } from '@shared/shared/tiles'
import { entityIcon, entityValue, loadEntities, state } from '../store'
import MdiIcon from './MdiIcon.vue'

const DOMAIN_NAMES: Record<string, string> = {
  light: 'Lumières', switch: 'Prises et interrupteurs', input_boolean: 'Booléens', fan: 'Ventilateurs', scene: 'Scènes', script: 'Scripts',
  binary_sensor: 'Capteurs tout ou rien', sensor: 'Capteurs', climate: 'Thermostats', weather: 'Météo', camera: 'Caméras',
}
/** Image de glisser invisible : l'étiquette de l'éditeur suit le pointeur à sa place. */
const BLANK = typeof Image !== 'undefined' ? Object.assign(new Image(), { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }) : null

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
const editing = computed(() => state.mode === 'edit')

const toggle = (e: EntityInfo) => {
  state.pendingKind = null
  state.pendingEntity = state.pendingEntity === e.entityId ? null : e.entityId
}
const toggleKind = (k: TileKind) => {
  state.pendingEntity = null
  state.pendingKind = state.pendingKind === k ? null : k
}

function begin(ev: DragEvent) {
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'copy'
    if (BLANK) ev.dataTransfer.setDragImage?.(BLANK, 0, 0)
  }
}
function dragStart(ev: DragEvent, e: EntityInfo) {
  ev.dataTransfer?.setData('application/x-entity-id', e.entityId)
  begin(ev)
  state.drag = { type: 'entity', entityId: e.entityId }
}
function dragKind(ev: DragEvent, k: TileKind) {
  ev.dataTransfer?.setData('application/x-tile-kind', k)
  begin(ev)
  state.drag = { type: 'kind', kind: k }
}
const dragEnd = () => { state.drag = null; state.dragOver = null }
</script>

<template>
  <section class="panel palette" aria-label="Palette : types de touche et entités Home Assistant">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" class="tab-kinds" :aria-selected="tab === 'kinds'" @click="tab = 'kinds'">Types de touche</button>
      <button type="button" role="tab" class="tab-entities" :aria-selected="tab === 'entities'" @click="tab = 'entities'">Entités</button>
    </div>

    <template v-if="tab === 'kinds'">
      <div class="kinds">
        <button
          v-for="k in TILE_KINDS" :key="k" type="button" class="chip kind-row" :draggable="editing" :data-kind="k"
          :class="{ pending: state.pendingKind === k }" :aria-pressed="state.pendingKind === k" :disabled="!editing"
          @click="toggleKind(k)" @dragstart="dragKind($event, k)" @dragend="dragEnd"
        >
          <MdiIcon :name="TILE_KIND_LABELS[k].icon" />
          <span class="n">{{ TILE_KIND_LABELS[k].name }}</span>
          <span class="d">{{ TILE_KIND_LABELS[k].desc }}</span>
        </button>
      </div>
      <p class="hint">Glissez un type sur une touche, puis choisissez son entité. Ou cliquez le type, puis l’emplacement.</p>
    </template>

    <template v-else>
      <p v-if="state.entitiesUnavailable" class="palette-offline note" role="status">Home Assistant hors ligne — liste des entités indisponible</p>
      <div class="filters">
        <input class="palette-search" type="search" placeholder="Rechercher (nom, identifiant, pièce)" aria-label="Rechercher une entité" v-model="search" />
        <select class="domain-filter" aria-label="Filtrer par type" v-model="domain">
          <option value="">Tous les types</option>
          <option v-for="d in domains" :key="d" :value="d">{{ DOMAIN_NAMES[d] ?? d }}</option>
        </select>
        <select v-if="areas.length > 0" class="area-filter" aria-label="Filtrer par pièce" v-model="area">
          <option value="">Toutes les pièces</option>
          <option v-for="a in areas" :key="a" :value="a">{{ a }}</option>
        </select>
      </div>
      <ul class="ents">
        <li v-for="e in rows" :key="e.entityId">
          <button
            type="button" class="ent entity-row" :draggable="editing" :disabled="!editing"
            :class="{ pending: state.pendingEntity === e.entityId }" :aria-pressed="state.pendingEntity === e.entityId"
            @click="toggle(e)" @dragstart="dragStart($event, e)" @dragend="dragEnd"
          >
            <MdiIcon :name="entityIcon(e)" />
            <span class="n">{{ e.name }}</span>
            <span class="i">{{ e.entityId }}{{ e.areaName ? ` · ${e.areaName}` : '' }}</span>
            <span class="v" :class="{ badge: e.state === 'unavailable' }">{{ entityValue(e) }}</span>
          </button>
        </li>
      </ul>
      <p v-if="rows.length === 0 && !state.entitiesUnavailable" class="hint">Aucune entité ne correspond.</p>
      <p class="hint">Glissez une entité directement : le type de touche est deviné (porte → État, scène → Action, lumière sur une bande → Gradateur). Déposée sur une touche du même type, elle remplace l’entité et garde le format.</p>
    </template>
  </section>
</template>

<style scoped>
.palette { display: flex; flex-direction: column; gap: 8px; }
.tabs { display: flex; gap: 4px; margin-bottom: 2px; }
.tabs button { flex: 1; background: transparent; }
.tabs button[aria-selected='true'] { background: var(--panel-2); border-color: #46505c; }
.kinds { display: grid; grid-template-columns: 1fr; gap: 6px; }
.chip { display: grid; grid-template-columns: 28px 1fr; gap: 2px 8px; align-items: center; text-align: left; padding: 7px 8px; cursor: grab; user-select: none; background: var(--panel-2); }
.chip .mdi { grid-row: span 2; width: 22px; height: 22px; }
.chip .n { font-weight: 600; font-size: 0.88rem; }
.chip .d { font-size: 0.74rem; color: var(--muted); }
.chip.pending, .ent.pending { border-color: var(--accent); background: var(--accent-bg); }
.filters { display: flex; flex-direction: column; gap: 6px; }
.ents { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 460px; overflow-y: auto; }
.ent { width: 100%; display: grid; grid-template-columns: 22px 1fr auto; gap: 0 8px; align-items: center; text-align: left; padding: 6px 8px; cursor: grab; user-select: none; }
.ent .mdi { width: 18px; height: 18px; grid-row: span 2; }
.ent .n { font-size: 0.86rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ent .i { font-size: 0.72rem; color: var(--muted); grid-column: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ent .v { grid-column: 3; grid-row: 1 / span 2; font-size: 0.75rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.ent .v.badge { color: #f3b1b1; }
button:disabled { cursor: default; opacity: 0.6; }
</style>
