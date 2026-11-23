<script setup lang="ts">
import { computed } from 'vue'
import { DASHBOARD_LABELS, DASHBOARD_TYPES, isEmptyPage, type DashboardType } from '@shared/config/schema'
import { clearPage, removePage, save, setPageType, state } from '../store'
import DashboardEntities from './DashboardEntities.vue'
import MdiIcon from './MdiIcon.vue'
import SlotEditor from './SlotEditor.vue'

const DESCRIPTIONS: Record<DashboardType, string> = {
  custom: 'Grille de touches et bandes à composer',
  weather: 'Conditions actuelles et prévisions',
  camera: 'Image d’une caméra en plein écran',
  climate: 'Thermostat : température, consigne et mode',
  graph: 'Courbe d’un capteur ; molettes : échelle et défilement',
}
const TYPE_ICONS: Record<DashboardType, string> = { custom: 'mdi:view-grid-outline', weather: 'mdi:weather-partly-cloudy', camera: 'mdi:cctv', climate: 'mdi:thermostat', graph: 'mdi:chart-line' }
const LED_COLORS = ['#FFB300', '#FF7043', '#EF5350', '#AB47BC', '#5C6BC0', '#4FC3F7', '#26A69A', '#9CCC65']

const index = computed(() => state.selectedButton)
const dashboard = computed(() => state.config?.buttons[index.value] ?? null)
const empty = computed(() => isEmptyPage(dashboard.value))
const current = computed(() => dashboard.value?.type ?? null)
/** Comme dans l'Atelier : une touche sélectionnée remplace les réglages de la page dans ce panneau. */
const slotMode = computed(() => current.value === 'custom' && state.selectedSlot !== null)

function rename(e: Event) {
  const name = (e.target as HTMLInputElement).value
  const i = index.value
  if (name === dashboard.value?.name) return
  void save((cfg) => { const b = cfg.buttons[i]; if (b) b.name = name })
}

function setColor(color: string) {
  const i = index.value
  if (color.toLowerCase() === dashboard.value?.color.toLowerCase()) return
  void save((cfg) => { const b = cfg.buttons[i]; if (b) b.color = color.toUpperCase() })
}
const recolor = (e: Event) => setColor((e.target as HTMLInputElement).value)

function commitOnEnter(e: Event) {
  (e.target as HTMLInputElement).blur()
}
</script>

<template>
  <aside class="panel inspector" :aria-label="`Configuration du bouton rond ${index + 1}`">
    <template v-if="slotMode">
      <button type="button" class="back" @click="state.selectedSlot = null">← Page « {{ dashboard?.name }} »</button>
      <SlotEditor />
    </template>
    <template v-else>
      <div class="ins-head">
        <h2>{{ dashboard ? `Page du bouton ${index + 1}` : `Bouton rond ${index + 1}` }}</h2>
        <span v-if="dashboard" class="actions">
          <button v-if="!empty" type="button" class="clear-page" title="Retire tout le contenu : la page redevient vide et son type peut être choisi" @click="clearPage(index)">
            {{ current === 'custom' ? 'Vider les contrôles' : 'Vider la page' }}
          </button>
          <button type="button" class="remove-page danger" @click="removePage(index)">Retirer</button>
        </span>
      </div>

      <template v-if="empty">
        <p class="note">{{ dashboard ? 'Page vide. Choisissez le type de contenu qu’elle affichera :' : 'Ce bouton n’ouvre aucune page. Choisissez un type :' }}</p>
        <div class="dash-types" role="group" aria-label="Type de contenu de la page">
          <button
            v-for="t in DASHBOARD_TYPES" :key="t" type="button" class="type-choice" :data-type="t"
            :aria-pressed="current === t" @click="setPageType(index, t)"
          >
            <MdiIcon :name="TYPE_ICONS[t]" />
            <span class="n">{{ DASHBOARD_LABELS[t] }}</span>
            <span class="d">{{ DESCRIPTIONS[t] }}</span>
          </button>
        </div>
      </template>
      <div v-else class="field">
        <span>Type de contenu</span>
        <p class="type-fixed"><MdiIcon :name="TYPE_ICONS[current!]" />{{ DASHBOARD_LABELS[current!] }}</p>
      </div>

      <template v-if="dashboard">
        <label class="field">
          <span>Nom</span>
          <input class="name-input" type="text" :value="dashboard.name" @blur="rename" @keydown.enter="commitOnEnter" />
        </label>
        <div class="field">
          <span>Couleur de la LED</span>
          <div class="swatches">
            <button
              v-for="c in LED_COLORS" :key="c" type="button" class="swatch led-swatch" :style="{ background: c }" :aria-label="`Couleur ${c}`"
              :aria-pressed="dashboard.color.toUpperCase() === c" @click="setColor(c)"
            />
            <input class="color-input" type="color" title="Autre couleur" aria-label="Autre couleur" :value="dashboard.color.toLowerCase()" @change="recolor" />
          </div>
        </div>
        <DashboardEntities />
        <p class="note">
          <template v-if="current === 'custom' && empty">Glissez un type de touche ou une entité sur la console pour en faire une page Bouton custom, ou choisissez un autre type ci-dessus.</template>
          <template v-else-if="current === 'custom'">Cliquez une touche ou une bande pour la régler. Glissez une touche sur une autre pour la déplacer (les suivantes se décalent ; <span class="kbd">Maj</span> : échanger ; <span class="kbd">Ctrl</span> : copier), ou sous la console pour la retirer.</template>
          <template v-else>Pour changer le type de la page, videz-la d’abord.</template>
          Glissez un bouton rond sur un autre pour déplacer la page.
        </p>
      </template>
    </template>
  </aside>
</template>

<style scoped>
.inspector { display: flex; flex-direction: column; gap: 12px; }
.ins-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ins-head h2 { font-size: 0.95rem; }
.actions { display: flex; gap: 6px; }
.back { align-self: flex-start; background: transparent; font-size: 0.8rem; color: var(--muted); padding: 2px 8px; }
.dash-types { display: grid; grid-template-columns: 1fr; gap: 6px; }
.type-choice { display: grid; grid-template-columns: 24px 1fr; gap: 1px 8px; align-items: center; text-align: left; }
.type-choice .mdi { grid-row: span 2; width: 20px; height: 20px; }
.type-choice .n { font-weight: 600; font-size: 0.86rem; }
.type-choice .d { font-size: 0.74rem; color: var(--muted); }
.type-choice[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-bg); }
.type-fixed { display: flex; align-items: center; gap: 8px; margin: 0; padding: 6px 8px; background: var(--panel-2); border-radius: 6px; color: var(--fg); font-size: 0.86rem; }
.type-fixed .mdi { width: 18px; height: 18px; }
.color-input { width: 34px; height: 30px; padding: 2px; }
</style>
