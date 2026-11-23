<script setup lang="ts">
import { computed } from 'vue'
import { GRAPH_WINDOWS_H, type CameraFit } from '@shared/config/schema'
import { pageCommand, save, state } from '../store'
import DraftInput from './DraftInput.vue'
import EntityPicker from './EntityPicker.vue'

const MAX_SENSORS = 4
const INTERVAL = { min: 250, max: 2000, step: 250 } as const
const FIT_OPTIONS: { value: CameraFit; label: string }[] = [
  { value: 'cover', label: 'Plein écran' },
  { value: 'contain', label: 'Image entière' },
]
const index = computed(() => state.selectedButton)
const dashboard = computed(() => state.config?.buttons[index.value] ?? null)
const climate = computed(() => (dashboard.value?.type === 'climate' ? dashboard.value : null))
const camera = computed(() => (dashboard.value?.type === 'camera' ? dashboard.value : null))
const graph = computed(() => (dashboard.value?.type === 'graph' ? dashboard.value : null))
const withEntity = computed(() => (dashboard.value && dashboard.value.type !== 'custom' ? dashboard.value : null))
const PICKER_LABEL = { climate: 'Thermostat', weather: 'Entité météo', camera: 'Caméra', graph: 'Capteur numérique' } as const
// Image fixe de la caméra : refreshCamera force une nouvelle capture côté serveur.
const stillSrc = computed(() => `/api/preview/${index.value}.png?refreshCamera=1&v=${state.previewVersion}`)

function setEntity(entityId: string | null) {
  const i = index.value
  void save((cfg) => {
    const b = cfg.buttons[i]
    if (b && b.type !== 'custom') b.entityId = entityId
  })
}

/** Ramène la saisie au pas de 250 ms, entre 250 et 2000 ms ; une saisie vide ou illisible est ignorée. */
function setIntervalMs(value: string) {
  const raw = Number(value)
  const cam = camera.value
  if (!cam || value.trim() === '' || !Number.isFinite(raw)) return undefined
  const snapped = Math.min(INTERVAL.max, Math.max(INTERVAL.min, Math.round(raw / INTERVAL.step) * INTERVAL.step))
  if (snapped === cam.intervalMs) return undefined
  const i = index.value
  return save((cfg) => {
    const b = cfg.buttons[i]
    if (b?.type === 'camera') b.intervalMs = snapped
  })
}

function setFit(e: Event) {
  const value = (e.target as HTMLSelectElement).value as CameraFit
  if (!FIT_OPTIONS.some((o) => o.value === value)) return
  const i = index.value
  void save((cfg) => {
    const b = cfg.buttons[i]
    if (b?.type === 'camera') b.fit = value
  })
}

function setWindow(e: Event) {
  const h = Number((e.target as HTMLSelectElement).value)
  const i = index.value
  void save((cfg) => {
    const b = cfg.buttons[i]
    if (b?.type === 'graph') b.windowHours = h
  })
}

function addSensor(entityId: string | null) {
  if (!entityId) return
  const i = index.value
  void save((cfg) => {
    const b = cfg.buttons[i]
    if (b?.type === 'climate' && b.sensors.length < MAX_SENSORS && !b.sensors.some((s) => s.entityId === entityId)) b.sensors.push({ entityId })
  })
}

function removeSensor(n: number) {
  const i = index.value
  void save((cfg) => {
    const b = cfg.buttons[i]
    if (b?.type === 'climate') b.sensors.splice(n, 1)
  })
}
</script>

<template>
  <div v-if="withEntity" class="dashboard-entities">
    <EntityPicker
      class="entity-picker" :kind="withEntity.type"
      :model-value="withEntity.entityId"
      :label="PICKER_LABEL[withEntity.type]"
      @update:model-value="setEntity"
    />
    <template v-if="graph">
      <label class="field">
        Fenêtre par défaut
        <select class="graph-window" :value="graph.windowHours" @change="setWindow">
          <option v-for="h in GRAPH_WINDOWS_H" :key="h" :value="h">{{ h }} h</option>
        </select>
      </label>
      <p class="hint">Sur la console, les molettes règlent l’échelle (haut) et le défilement (milieu) : à gauche verticalement, à droite horizontalement. Un appui sur une molette recadre son axe.</p>
    </template>
    <div v-if="dashboard?.type === 'weather' && withEntity.entityId" class="commands">
      <button type="button" class="weather-refresh" @click="pageCommand(index, 'refresh')">↻ Actualiser</button>
      <span class="hint">Sur la console : appui sur la zone haut droite (date et heure de la dernière mise à jour).</span>
    </div>
    <template v-if="climate">
      <h3>Capteurs de température ({{ climate.sensors.length }}/{{ MAX_SENSORS }})</h3>
      <ul v-if="climate.sensors.length > 0" class="sensors">
        <li v-for="(s, n) in climate.sensors" :key="s.entityId" class="sensor-row">
          <span>{{ s.entityId }}</span>
          <button type="button" class="sensor-remove" :aria-label="`Retirer ${s.entityId}`" @click="removeSensor(n)">Retirer</button>
        </li>
      </ul>
      <EntityPicker v-if="climate.sensors.length < MAX_SENSORS" :key="climate.sensors.length" class="sensor-picker" kind="sensor" :model-value="null" label="Ajouter un capteur" @update:model-value="addSensor" />
    </template>
    <template v-if="camera">
      <label class="field">
        Intervalle (ms)
        <DraftInput
          :key="index" class="camera-interval" type="number" :min="INTERVAL.min" :max="INTERVAL.max" :step="INTERVAL.step"
          :model-value="String(camera.intervalMs)" :commit="setIntervalMs"
        />
      </label>
      <label class="field">
        Cadrage
        <select class="camera-fit" :value="camera.fit ?? 'cover'" @change="setFit">
          <option v-for="o in FIT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
    </template>
    <template v-if="camera && camera.entityId">
      <div class="commands">
        <button type="button" class="camera-refresh" @click="pageCommand(index, 'refresh')">↻ Forcer une image</button>
        <button type="button" class="camera-reload" @click="pageCommand(index, 'reload')">Recharger l’intégration</button>
      </div>
      <p class="hint">Sur la console, la tuile haut gauche compte le temps depuis la dernière image (vert sous 10 s, ambre jusqu’à 30 s, rouge au-delà). Appui court : forcer une image ; appui long (1 s) : recharger l’intégration.</p>
      <img class="camera-still" :src="stillSrc" alt="Image fixe de la caméra" />
    </template>
  </div>
</template>

<style scoped>
.dashboard-entities { display: flex; flex-direction: column; gap: 10px; }
h3 { font-size: 0.86rem; font-weight: 600; }
.sensors { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.sensor-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 0.82rem; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 0.82rem; color: var(--muted); }
.field input, .field select { color: var(--fg); }
.camera-still { width: 100%; border-radius: 6px; background: #000; border: 1px solid var(--line); }
.commands { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.hint { font-size: 0.78rem; color: var(--muted); margin: 0; line-height: 1.45; }
</style>
