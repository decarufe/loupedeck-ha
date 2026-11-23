<script setup lang="ts">
import { computed } from 'vue'
import { CLOCK_FORMATS, TILE_GRAPH_PERIODS, TILE_KINDS, type ClockFormat, type Tile, type TileKind } from '@shared/config/schema'
import type { SlotKind } from '@shared/shared/placement'
import { fitsSlot, TILE_KIND_LABELS, TILE_NEEDS } from '@shared/shared/tiles'
import { clearSlot, placeKind, setTileEntity, setTileKind, slotName, state, tileAt, updateTile } from '../store'
import EntityPicker from './EntityPicker.vue'

const CLOCK_LABELS: Record<ClockFormat, string> = { 'time-date': 'Heure + jour et date', time: 'Heure seule', 'time-seconds': 'Heure avec secondes', date: 'Date seule' }
const TOKENS = ['{valeur}', '{unité}', '{nom}']
const SWATCHES = ['#FFB300', '#FF7043', '#EF5350', '#AB47BC', '#5C6BC0', '#4FC3F7', '#26A69A', '#9CCC65']

const target = computed(() => state.selectedSlot)
const tile = computed<Tile | null>(() => (target.value ? tileAt(target.value) : null))
const slotType = computed(() => (target.value?.kind === 'key' ? 'key' : 'strip'))
const allowed = computed(() => TILE_KINDS.filter((k) => fitsSlot(k, slotType.value)))
const entityId = computed(() => (tile.value && tile.value.kind !== 'clock' ? tile.value.entityId : null))
const page = computed(() => state.config?.buttons[state.selectedButton])
const pageColor = computed(() => (page.value ? page.value.color : '#26A69A'))

const patch = (p: Record<string, unknown>) => { if (target.value) void updateTile(target.value, p) }
function commit(field: 'label' | 'icon' | 'template', e: Event) {
  const value = (e.target as HTMLInputElement).value
  const cur = tile.value as Record<string, unknown> | null
  if (!cur || value === (cur[field] ?? '')) return
  patch({ [field]: value })
}
function insertToken(token: string) {
  const t = tile.value
  if (t?.kind !== 'value') return
  patch({ template: `${t.template}${t.template.endsWith(' ') || t.template === '' ? '' : ' '}${token}` })
}
function setLook(which: 'on' | 'off', field: 'text' | 'color', e: Event) {
  const t = tile.value
  if (t?.kind !== 'state') return
  const value = (e.target as HTMLInputElement).value
  if (t[which][field] === value) return
  patch({ [which]: { ...t[which], [field]: field === 'color' ? value.toUpperCase() : value } })
}
const blurOnEnter = (e: Event) => (e.target as HTMLInputElement).blur()
const kindChange = (e: Event) => { if (target.value) void setTileKind(target.value, (e.target as HTMLSelectElement).value as TileKind) }
</script>

<template>
  <section v-if="tile && target" class="slot-editor" :aria-label="`Emplacement : ${slotName(target)}`">
    <header class="head">
      <h3>{{ slotName(target) }}</h3>
      <button type="button" class="slot-remove danger" @click="clearSlot(target)">Retirer</button>
    </header>
    <label>
      Type de touche
      <select class="tile-kind" :value="tile.kind" @change="kindChange">
        <option v-for="k in allowed" :key="k" :value="k">{{ TILE_KIND_LABELS[k].name }}</option>
      </select>
    </label>
    <EntityPicker
      v-if="tile.kind !== 'clock'" class="tile-entity" :kind="tile.kind as SlotKind" :model-value="entityId"
      :label="`Entité (${TILE_NEEDS[tile.kind]})`" @update:model-value="(v) => setTileEntity(target!, v)"
    />
    <label>
      Libellé
      <input class="slot-label" type="text" :value="tile.label ?? ''" placeholder="Nom affiché sur la touche" @blur="commit('label', $event)" @keydown.enter="blurOnEnter" />
    </label>

    <template v-if="tile.kind === 'value'">
      <label>
        Format affiché
        <input class="tile-template" type="text" :value="tile.template" @blur="commit('template', $event)" @keydown.enter="blurOnEnter" />
      </label>
      <div class="tokens"><button v-for="t in TOKENS" :key="t" type="button" class="token" @click="insertToken(t)">{{ t }}</button></div>
      <label>
        Décimales
        <select class="tile-decimals" :value="tile.decimals" @change="patch({ decimals: Number(($event.target as HTMLSelectElement).value) })">
          <option v-for="n in [0, 1, 2, 3]" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
    </template>

    <template v-if="tile.kind === 'graph'">
      <div class="row2">
        <label>
          Période
          <select class="tile-period" :value="tile.period" @change="patch({ period: ($event.target as HTMLSelectElement).value })">
            <option v-for="p in TILE_GRAPH_PERIODS" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
        <label>
          Style
          <select class="tile-style" :value="tile.style" @change="patch({ style: ($event.target as HTMLSelectElement).value })">
            <option value="area">Aire</option>
            <option value="line">Ligne</option>
          </select>
        </label>
      </div>
      <div class="row2">
        <label>
          Décimales
          <select class="tile-decimals" :value="tile.decimals" @change="patch({ decimals: Number(($event.target as HTMLSelectElement).value) })">
            <option v-for="n in [0, 1, 2, 3]" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <label class="check">
          <input class="tile-minmax" type="checkbox" :checked="tile.showMinMax" @change="patch({ showMinMax: ($event.target as HTMLInputElement).checked })" />
          Min et max
        </label>
      </div>
    </template>

    <label v-if="tile.kind === 'clock'">
      Format
      <select class="tile-clock" :value="tile.format" @change="patch({ format: ($event.target as HTMLSelectElement).value })">
        <option v-for="f in CLOCK_FORMATS" :key="f" :value="f">{{ CLOCK_LABELS[f] }}</option>
      </select>
    </label>

    <div v-if="tile.kind === 'state'" class="looks">
      <span>Selon l’état</span>
      <template v-for="w in (['on', 'off'] as const)" :key="w">
        <span class="look-name">{{ w === 'on' ? 'Actif' : 'Inactif' }}</span>
        <input :class="`look-text-${w}`" type="text" :value="tile[w].text" :aria-label="`Texte si ${w === 'on' ? 'actif' : 'inactif'}`" @blur="setLook(w, 'text', $event)" @keydown.enter="blurOnEnter" />
        <input :class="`look-color-${w}`" type="color" :value="tile[w].color.toLowerCase()" :aria-label="`Couleur si ${w === 'on' ? 'actif' : 'inactif'}`" @change="setLook(w, 'color', $event)" />
      </template>
    </div>

    <label v-if="tile.kind === 'action'" class="check">
      <input class="tile-confirm" type="checkbox" :checked="tile.confirm" @change="patch({ confirm: ($event.target as HTMLInputElement).checked })" />
      Demander un appui long (évite les déclenchements par erreur)
    </label>

    <div class="field">
      <span>Couleur</span>
      <div class="swatches">
        <button type="button" class="swatch auto" :style="{ background: pageColor }" :aria-pressed="!tile.color" title="Couleur de la page" @click="patch({ color: '' })">auto</button>
        <button
          v-for="c in SWATCHES" :key="c" type="button" class="swatch" :style="{ background: c }" :aria-label="`Couleur ${c}`"
          :aria-pressed="tile.color?.toUpperCase() === c" @click="patch({ color: c })"
        />
      </div>
    </div>
    <label v-if="tile.kind !== 'clock' && tile.kind !== 'state'">
      Icône
      <input class="slot-icon" type="text" :value="tile.icon ?? ''" placeholder="ex. mdi:lamp (vide : automatique)" @blur="commit('icon', $event)" @keydown.enter="blurOnEnter" />
    </label>
  </section>
  <section v-else-if="target && page?.type === 'custom'" class="slot-editor empty">
    <h3>{{ slotName(target) }}</h3>
    <p class="hint">Emplacement vide. Glissez un type de touche ou une entité, ou choisissez :</p>
    <div class="kinds">
      <button v-for="k in allowed" :key="k" type="button" class="new-kind" :data-kind="k" @click="placeKind(target!, k)">{{ TILE_KIND_LABELS[k].name }}</button>
    </div>
  </section>
</template>

<style scoped>
.slot-editor { display: flex; flex-direction: column; gap: 0.6rem; border-top: 1px solid #333; padding-top: 0.8rem; }
.head { display: flex; justify-content: space-between; align-items: center; }
h3 { font-size: 0.95rem; margin: 0; }
label, .field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
label.check { flex-direction: row; align-items: center; gap: 0.4rem; }
input[type='text'], select { font: inherit; color: inherit; background: #2a2a2a; border: 1px solid #555; border-radius: 6px; padding: 0.35rem; }
input[type='color'] { width: 2.4rem; height: 1.8rem; padding: 0; background: none; border: 1px solid #555; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; align-items: end; }
.tokens, .kinds { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.token { font-family: ui-monospace, Consolas, monospace; font-size: 0.8rem; padding: 0.1rem 0.4rem; }
.looks { display: grid; grid-template-columns: auto 1fr auto; gap: 0.35rem; align-items: center; font-size: 0.9rem; }
.looks > span:first-child { grid-column: 1 / -1; }
.swatches { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.swatch { width: 1.7rem; height: 1.7rem; border-radius: 50%; padding: 0; border: 2px solid transparent; }
.swatch.auto { width: auto; border-radius: 0.85rem; padding: 0 0.5rem; font-size: 0.75rem; color: #000; }
.swatch[aria-pressed='true'] { border-color: #fff; }
.danger { color: #f3b1b1; border-color: #5a2a2a; }
.hint { color: #aaa; margin: 0; font-size: 0.85rem; }
</style>
