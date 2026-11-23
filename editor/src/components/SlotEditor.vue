<script setup lang="ts">
import { computed } from 'vue'
import { CLOCK_FORMATS, TILE_GRAPH_PERIODS, TILE_KINDS, KNOB_IDS, type ClockFormat, type Tile, type TileKind } from '@shared/config/schema'
import { keyRect, stripZoneRect, type Rect } from '@shared/device/regions'
import type { SlotKind } from '@shared/shared/placement'
import { fitsSlot, TILE_KIND_LABELS, TILE_NEEDS } from '@shared/shared/tiles'
import { previewUrl } from '../api'
import { clearSlot, placeKind, setTileEntity, setTileKind, slotName, state, tileAt, updateTile } from '../store'
import EntityPicker from './EntityPicker.vue'
import MdiIcon from './MdiIcon.vue'

const CLOCK_LABELS: Record<ClockFormat, string> = { 'time-date': 'Heure + jour et date', time: 'Heure seule', 'time-seconds': 'Heure avec secondes', date: 'Date seule' }
const TOKENS = ['{valeur}', '{unité}', '{nom}']
const SWATCHES = ['#FFB300', '#FF7043', '#EF5350', '#AB47BC', '#5C6BC0', '#4FC3F7', '#26A69A', '#9CCC65']
const ICON_CHOICES = [
  'mdi:lightbulb', 'mdi:toggle-switch', 'mdi:play', 'mdi:star', 'mdi:weather-night', 'mdi:door', 'mdi:window-closed-variant', 'mdi:motion-sensor',
  'mdi:garage', 'mdi:thermometer', 'mdi:chip', 'mdi:memory', 'mdi:flash', 'mdi:coffee', 'mdi:white-balance-sunny', 'mdi:home',
]
const KNOB_NAMES: Record<string, string> = {
  knobTL: 'molette haut gauche', knobCL: 'molette milieu gauche', knobBL: 'molette bas gauche',
  knobTR: 'molette haut droite', knobCR: 'molette milieu droite', knobBR: 'molette bas droite',
}
const W = 480
const H = 270

const target = computed(() => state.selectedSlot)
const tile = computed<Tile | null>(() => (target.value ? tileAt(target.value) : null))
const slotType = computed(() => (target.value?.kind === 'key' ? 'key' : 'strip'))
const allowed = computed(() => TILE_KINDS.filter((k) => fitsSlot(k, slotType.value)))
const entityId = computed(() => (tile.value && tile.value.kind !== 'clock' ? tile.value.entityId : null))
const page = computed(() => state.config?.buttons[state.selectedButton])
const pageColor = computed(() => (page.value ? page.value.color : '#26A69A'))

/** Aperçu agrandi : le morceau de l'aperçu de la console qui correspond à l'emplacement. */
const rect = computed<Rect | null>(() => {
  const t = target.value
  if (!t) return null
  if (t.kind === 'key') return keyRect(t.index)
  const n = KNOB_IDS.indexOf(t.knob)
  return stripZoneRect(n < 3 ? 'left' : 'right', (n % 3) as 0 | 1 | 2)
})
const previewStyle = computed(() => {
  const r = rect.value
  if (!r) return {}
  return {
    backgroundImage: `url(${previewUrl(state.selectedButton, state.previewVersion)})`,
    backgroundSize: `${(W / r.width) * 100}% ${(H / r.height) * 100}%`,
    backgroundPosition: `${(r.x / (W - r.width)) * 100}% ${(r.y / (H - r.height)) * 100}%`,
  }
})

/** Ce que fait la touche sur la console. */
const behaviour = computed(() => {
  const t = tile.value
  if (!t) return []
  switch (t.kind) {
    case 'toggle': return ['Appui : allume ou éteint']
    case 'action': return [t.confirm ? 'Appui long (1 s) : lance l’action' : 'Appui : lance l’action', 'Vibration courte de confirmation']
    case 'state': return ['Lecture seule', 'Change de texte et de couleur en direct']
    case 'value': return ['Lecture seule, mise à jour en direct']
    case 'graph': return ['Lecture seule', `Courbe sur ${t.period}`]
    case 'clock': return ['Lecture seule, heure du PC']
    case 'dimmer': {
      const knob = target.value?.kind === 'strip' ? KNOB_NAMES[target.value.knob] : 'molette'
      return [`Molette (${knob}) : intensité ±5 %`, 'Appui sur la molette ou la zone : allume ou éteint']
    }
  }
})

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
    <div class="ins-head">
      <h2>{{ slotName(target) }}</h2>
      <button type="button" class="slot-remove danger" @click="clearSlot(target)">Retirer</button>
    </div>
    <div class="preview-box">
      <div class="preview-tile" :class="{ 'strip-shape': target.kind === 'strip' }" :style="previewStyle" role="img" :aria-label="`Aperçu de ${slotName(target)}`" />
      <ul class="behaviour"><li v-for="b in behaviour" :key="b">{{ b }}</li></ul>
    </div>
    <label class="field">
      <span>Type de touche</span>
      <select class="tile-kind" :value="tile.kind" @change="kindChange">
        <option v-for="k in allowed" :key="k" :value="k">{{ TILE_KIND_LABELS[k].name }}</option>
      </select>
    </label>
    <EntityPicker
      v-if="tile.kind !== 'clock'" class="tile-entity" :kind="tile.kind as SlotKind" :model-value="entityId"
      :label="`Entité (${TILE_NEEDS[tile.kind]})`" @update:model-value="(v) => setTileEntity(target!, v)"
    />
    <label class="field">
      <span>Libellé</span>
      <input class="slot-label" type="text" :value="tile.label ?? ''" placeholder="Nom affiché sur la touche" @blur="commit('label', $event)" @keydown.enter="blurOnEnter" />
    </label>

    <template v-if="tile.kind === 'value'">
      <label class="field">
        <span>Format affiché</span>
        <input class="tile-template" type="text" :value="tile.template" @blur="commit('template', $event)" @keydown.enter="blurOnEnter" />
      </label>
      <div class="tokens"><button v-for="t in TOKENS" :key="t" type="button" class="token" @click="insertToken(t)">{{ t }}</button></div>
      <label class="field">
        <span>Décimales</span>
        <select class="tile-decimals" :value="tile.decimals" @change="patch({ decimals: Number(($event.target as HTMLSelectElement).value) })">
          <option v-for="n in [0, 1, 2, 3]" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
    </template>

    <template v-if="tile.kind === 'graph'">
      <div class="row2">
        <label class="field">
          <span>Période</span>
          <select class="tile-period" :value="tile.period" @change="patch({ period: ($event.target as HTMLSelectElement).value })">
            <option v-for="p in TILE_GRAPH_PERIODS" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
        <label class="field">
          <span>Style</span>
          <select class="tile-style" :value="tile.style" @change="patch({ style: ($event.target as HTMLSelectElement).value })">
            <option value="area">Aire</option>
            <option value="line">Ligne</option>
          </select>
        </label>
      </div>
      <div class="row2">
        <label class="field">
          <span>Décimales</span>
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

    <label v-if="tile.kind === 'clock'" class="field">
      <span>Format</span>
      <select class="tile-clock" :value="tile.format" @change="patch({ format: ($event.target as HTMLSelectElement).value })">
        <option v-for="f in CLOCK_FORMATS" :key="f" :value="f">{{ CLOCK_LABELS[f] }}</option>
      </select>
    </label>

    <div v-if="tile.kind === 'state'" class="field">
      <span>Selon l’état</span>
      <div class="map">
        <template v-for="w in (['on', 'off'] as const)" :key="w">
          <span>{{ w === 'on' ? 'Actif' : 'Inactif' }}</span>
          <input :class="`look-text-${w}`" type="text" :value="tile[w].text" :aria-label="`Texte si ${w === 'on' ? 'actif' : 'inactif'}`" @blur="setLook(w, 'text', $event)" @keydown.enter="blurOnEnter" />
          <input :class="`look-color-${w}`" type="color" :value="tile[w].color.toLowerCase()" :aria-label="`Couleur si ${w === 'on' ? 'actif' : 'inactif'}`" @change="setLook(w, 'color', $event)" />
        </template>
      </div>
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
    <div v-if="tile.kind !== 'clock' && tile.kind !== 'state'" class="field">
      <span>Icône</span>
      <div class="icons">
        <button type="button" class="icon-choice" :aria-pressed="!tile.icon" title="Automatique" @click="patch({ icon: '' })">auto</button>
        <button
          v-for="n in ICON_CHOICES" :key="n" type="button" class="icon-choice" :title="n" :aria-label="`Icône ${n}`"
          :aria-pressed="tile.icon === n" @click="patch({ icon: n })"
        ><MdiIcon :name="n" /></button>
      </div>
      <input class="slot-icon" type="text" :value="tile.icon ?? ''" placeholder="Autre icône : mdi:lamp" aria-label="Autre icône Material Design" @blur="commit('icon', $event)" @keydown.enter="blurOnEnter" />
    </div>
  </section>
  <section v-else-if="target && page?.type === 'custom'" class="slot-editor empty">
    <div class="ins-head"><h2>{{ slotName(target) }}</h2></div>
    <p class="note">Emplacement vide. Glissez un type de touche ou une entité, ou choisissez :</p>
    <div class="kinds">
      <button v-for="k in allowed" :key="k" type="button" class="new-kind" :data-kind="k" @click="placeKind(target!, k)">
        <MdiIcon :name="TILE_KIND_LABELS[k].icon" />{{ TILE_KIND_LABELS[k].name }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.slot-editor { display: flex; flex-direction: column; gap: 12px; }
.ins-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.ins-head h2 { font-size: 0.95rem; }
.preview-box { display: flex; gap: 12px; align-items: center; }
.preview-tile { width: 120px; aspect-ratio: 1; flex: none; border-radius: 8%; background-color: #000; background-repeat: no-repeat; border: 1px solid var(--line); }
.preview-tile.strip-shape { width: 80px; aspect-ratio: 60 / 90; }
.behaviour { font-size: 0.8rem; color: var(--muted); line-height: 1.5; margin: 0; padding-left: 16px; }
.check { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: end; }
.tokens { display: flex; flex-wrap: wrap; gap: 4px; }
.token { font-family: ui-monospace, Consolas, monospace; font-size: 0.75rem; padding: 2px 6px; }
.map { display: grid; grid-template-columns: auto 1fr auto; gap: 6px; align-items: center; font-size: 0.8rem; color: var(--fg); }
.map input[type='color'] { width: 34px; height: 30px; padding: 2px; }
.swatch.auto { width: auto; border-radius: 13px; padding: 0 8px; font-size: 0.72rem; color: #000; }
.icons { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
.icon-choice { padding: 4px; aspect-ratio: 1; display: grid; place-items: center; font-size: 0.68rem; }
.icon-choice .mdi { width: 18px; height: 18px; }
.icon-choice[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-bg); }
.kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.new-kind { display: flex; align-items: center; gap: 6px; text-align: left; }
.new-kind .mdi { width: 18px; height: 18px; flex: none; }
</style>
