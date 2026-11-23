<script setup lang="ts">
import { computed } from 'vue'
import { DASHBOARD_LABELS, DASHBOARD_TYPES, isEmptyPage, type DashboardType } from '@shared/config/schema'
import { clearPage, removePage, save, setPageType, state } from '../store'
import DashboardEntities from './DashboardEntities.vue'
import SlotEditor from './SlotEditor.vue'

const DESCRIPTIONS: Record<DashboardType, string> = {
  custom: 'Grille de touches et bandes à composer',
  weather: 'Conditions actuelles et prévisions',
  camera: 'Image d’une caméra en plein écran',
  climate: 'Thermostat : température, consigne et mode',
  graph: 'Courbe d’un capteur ; molettes : échelle et défilement',
}

const index = computed(() => state.selectedButton)
const dashboard = computed(() => state.config?.buttons[index.value] ?? null)
const empty = computed(() => isEmptyPage(dashboard.value))
const current = computed(() => dashboard.value?.type ?? null)

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
    <header class="head">
      <h2>Page du bouton {{ index + 1 }}</h2>
      <span v-if="dashboard" class="actions">
        <button v-if="!empty" type="button" class="clear-page" title="Retire tout le contenu : la page redevient vide et son type peut être choisi" @click="clearPage(index)">
          {{ current === 'custom' ? 'Vider les contrôles' : 'Vider la page' }}
        </button>
        <button type="button" class="remove-page danger" @click="removePage(index)">Retirer</button>
      </span>
    </header>

    <div class="field">
      <span>Type de contenu</span>
      <div v-if="empty" class="types" role="group" aria-label="Type de contenu de la page">
        <button
          v-for="t in DASHBOARD_TYPES" :key="t" type="button" class="type-choice" :data-type="t"
          :aria-pressed="current === t" @click="setPageType(index, t)"
        >
          <span class="n">{{ DASHBOARD_LABELS[t] }}</span>
          <span class="d">{{ DESCRIPTIONS[t] }}</span>
        </button>
      </div>
      <p v-else class="type-fixed">{{ DASHBOARD_LABELS[current!] }}</p>
    </div>

    <template v-if="dashboard">
      <label>
        Nom
        <input class="name-input" type="text" :value="dashboard.name" @blur="rename" @keydown.enter="commitOnEnter" />
      </label>
      <label>
        Couleur de la LED
        <input class="color-input" type="color" :value="dashboard.color.toLowerCase()" @change="recolor" />
      </label>
      <DashboardEntities />
      <SlotEditor />
      <p class="hint">
        <template v-if="current === 'custom' && empty">Page vide : glissez un type de touche ou une entité sur la console pour en faire une page Bouton custom, ou choisissez un autre type ci-dessus.</template>
        <template v-else-if="current === 'custom'">Cliquez une touche pour la régler. Glissez une touche sur une autre pour la déplacer (les suivantes se décalent ; Maj : échanger ; Ctrl : copier), ou sous la console pour la retirer.</template>
        <template v-else>Pour changer le type de la page, videz-la d’abord.</template>
        Glissez un bouton rond sur un autre pour déplacer la page (Maj : échanger).
      </p>
    </template>
    <p v-else class="hint">Ce bouton n’a pas de page : choisissez le type de contenu qu’elle affichera.</p>
  </section>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: 0.8rem; min-width: 16rem; max-width: 22rem; background: #1c1c1c; padding: 1rem; border-radius: 8px; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
.actions { display: flex; gap: 0.4rem; }
h2 { font-size: 1.05rem; margin: 0; }
label, .field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
input[type='text'] { font: inherit; color: inherit; background: #2a2a2a; border: 1px solid #555; border-radius: 6px; padding: 0.35rem; }
input[type='color'] { width: 4rem; height: 2rem; padding: 0; background: none; border: 1px solid #555; }
.types { display: flex; flex-direction: column; gap: 0.35rem; }
.type-choice { display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 0.1rem; }
.type-choice .n { font-weight: 600; }
.type-choice .d { font-size: 0.78rem; color: #aaa; }
.type-choice[aria-pressed='true'] { border-color: #4fc3f7; background: #1d3a4a; }
.type-fixed { margin: 0; padding: 0.4rem 0.6rem; background: #2a2a2a; border-radius: 6px; }
.danger { color: #f3b1b1; border-color: #5a2a2a; }
.hint { color: #aaa; margin: 0; font-size: 0.85rem; line-height: 1.4; }
</style>
