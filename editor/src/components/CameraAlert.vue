<script setup lang="ts">
import { computed } from 'vue'
import type { CameraDashboard } from '@shared/config/schema'
import { alertCandidates, alertLabel, defaultAlertSensors } from '@shared/shared/alerts'
import { save, state } from '../store'

const props = defineProps<{ index: number }>()

const camera = computed(() => {
  const b = state.config?.buttons[props.index]
  return b?.type === 'camera' ? b : null
})
const alert = computed(() => camera.value?.alert ?? { enabled: false, sensors: [] })
const candidates = computed(() => alertCandidates(camera.value?.entityId ?? null, state.entities))
const candidateIds = computed(() => new Set(candidates.value.map((e) => e.entityId)))
/** Capteurs enregistrés hors de la liste proposée : ajoutés à la main, ou disparus de Home Assistant. */
const extras = computed(() => alert.value.sensors.filter((id) => !candidateIds.value.has(id)))
const addable = computed(() => state.entities
  .filter((e) => e.domain === 'binary_sensor' && !alert.value.sensors.includes(e.entityId))
  .map((e) => ({ id: e.entityId, text: `${e.name} (${e.entityId})` }))
  .sort((a, b) => a.text.localeCompare(b.text)))
const nameOf = (id: string) => state.entities.find((e) => e.entityId === id)?.name

function change(mutator: (a: CameraDashboard['alert']) => void) {
  const i = props.index
  return save((cfg) => {
    const b = cfg.buttons[i]
    if (b?.type === 'camera') mutator(b.alert)
  })
}

function setEnabled(e: Event) {
  const on = (e.target as HTMLInputElement).checked
  const defaults = defaultAlertSensors(candidates.value)
  void change((a) => {
    a.enabled = on
    if (on && a.sensors.length === 0) a.sensors = defaults
  })
}

function toggle(id: string, e: Event) {
  const on = (e.target as HTMLInputElement).checked
  void change((a) => {
    a.sensors = on ? (a.sensors.includes(id) ? a.sensors : [...a.sensors, id]) : a.sensors.filter((s) => s !== id)
  })
}

function add(e: Event) {
  const sel = e.target as HTMLSelectElement
  const id = sel.value
  sel.value = ''
  if (id) void change((a) => { if (!a.sensors.includes(id)) a.sensors = [...a.sensors, id] })
}

function remove(id: string) {
  void change((a) => { a.sensors = a.sensors.filter((s) => s !== id) })
}
</script>

<template>
  <div v-if="camera && camera.entityId" class="camera-alert">
    <label class="enable">
      <input class="alert-enabled" type="checkbox" :checked="alert.enabled" @change="setEnabled" />
      Alerte sur la console
    </label>
    <template v-if="alert.enabled">
      <ul class="sensors">
        <li v-for="e in candidates" :key="e.entityId">
          <label>
            <input class="alert-sensor" type="checkbox" :data-id="e.entityId" :checked="alert.sensors.includes(e.entityId)" @change="toggle(e.entityId, $event)" />
            {{ alertLabel(e) }}
          </label>
        </li>
        <li v-for="id in extras" :key="id" class="extra">
          <label>
            <input class="alert-sensor" type="checkbox" :data-id="id" checked @change="toggle(id, $event)" />
            {{ nameOf(id) ?? id }}<span v-if="!nameOf(id)" class="missing"> (introuvable dans Home Assistant)</span>
          </label>
          <button type="button" class="alert-remove" :aria-label="`Retirer ${id}`" @click="remove(id)">Retirer</button>
        </li>
      </ul>
      <label class="add">
        Ajouter un autre capteur…
        <select class="alert-picker" value="" @change="add">
          <option value="">— Aucun —</option>
          <option v-for="o in addable" :key="o.id" :value="o.id">{{ o.text }}</option>
        </select>
      </label>
      <p v-if="alert.sensors.length === 0" class="hint">Cochez ou ajoutez au moins un capteur : sans capteur, rien n’alerte.</p>
      <p class="hint">Une détection ouvre la caméra, fait vibrer la console et clignoter son bouton en magenta. Rien ne s’ouvre dans les 5 s qui suivent un geste.</p>
    </template>
  </div>
</template>

<style scoped>
.camera-alert { display: flex; flex-direction: column; gap: 6px; font-size: 0.82rem; }
.enable { display: flex; align-items: center; gap: 6px; color: var(--fg); font-weight: 600; }
.sensors { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.sensors li { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.sensors label { display: flex; align-items: center; gap: 6px; }
.missing { color: var(--muted); }
.add { display: flex; flex-direction: column; gap: 4px; color: var(--muted); }
.add select { color: var(--fg); }
.hint { font-size: 0.78rem; color: var(--muted); margin: 0; line-height: 1.45; }
</style>
