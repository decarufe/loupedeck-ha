<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ButtonPanel from './components/ButtonPanel.vue'
import EntityPalette from './components/EntityPalette.vue'
import LiveDevice from './components/LiveDevice.vue'
import Messages from './components/Messages.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { clearSlot, init, state, tileAt, undo } from './store'

const showSettings = ref(false)
let stop: (() => void) | null = null

const haChip = computed(() => {
  const ha = state.status?.ha
  if (!ha) return null
  if (ha.state === 'online') return { text: 'Home Assistant connecté', cls: 'ok' }
  if (ha.state === 'connecting') return { text: 'Connexion…', cls: 'warn' }
  return { text: ha.reason === 'auth' ? 'Jeton invalide' : 'Home Assistant hors ligne', cls: 'bad' }
})
const deviceChip = computed(() => {
  const d = state.status?.device
  if (!d) return null
  return d.status === 'connected' ? { text: 'Console connectée', cls: 'ok' } : { text: 'Console déconnectée', cls: 'bad' }
})

function setMode(m: 'edit' | 'try') {
  state.mode = m
  state.pendingEntity = null
  state.pendingKind = null
}

/** Raccourcis : Ctrl+Z annule, Échap désélectionne (ou ferme les réglages), Suppr retire la touche sélectionnée. */
function onKey(e: KeyboardEvent) {
  const el = document.activeElement as HTMLElement | null
  const typing = !!el && (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault()
    void undo()
  } else if (e.key === 'Escape') {
    if (showSettings.value) { showSettings.value = false; return }
    state.pendingEntity = null
    state.pendingKind = null
    state.selectedSlot = null
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && state.mode === 'edit' && state.selectedSlot && tileAt(state.selectedSlot)) {
    e.preventDefault()
    void clearSlot(state.selectedSlot)
  }
}

onMounted(async () => {
  document.addEventListener('keydown', onKey)
  stop = await init()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  stop?.()
})
</script>

<template>
  <main class="app">
    <header class="top">
      <h1>Atelier Loupedeck</h1>
      <span v-if="haChip" class="status-chip" :class="haChip.cls" role="status">{{ haChip.text }}</span>
      <span v-if="deviceChip" class="status-chip" :class="deviceChip.cls" role="status">{{ deviceChip.text }}</span>
      <span class="spacer" />
      <span class="group">
        <span class="seg-label">Mode</span>
        <span class="seg" role="group" aria-label="Mode">
          <button type="button" class="mode-edit" :aria-pressed="state.mode === 'edit'" @click="setMode('edit')">Éditer</button>
          <button type="button" class="mode-try" :aria-pressed="state.mode === 'try'" @click="setMode('try')">Essayer</button>
        </span>
      </span>
      <button type="button" class="undo" title="Annuler (Ctrl+Z)" aria-label="Annuler la dernière modification" @click="undo">Annuler</button>
      <button type="button" class="open-settings" aria-label="Réglages" title="Réglages : Home Assistant, console" @click="showSettings = true">⚙ Réglages</button>
    </header>
    <p v-if="state.config?.loadWarning" class="banner warning" role="status">{{ state.config.loadWarning }}</p>
    <Messages v-if="!showSettings" />
    <p v-if="state.mode === 'try'" class="banner try" role="status">
      Mode Essayer : les touches et les molettes de la Live virtuelle pilotent la vraie maison, comme la console.
    </p>
    <p v-if="!state.config" class="loading">Chargement…</p>
    <div v-else class="workspace">
      <EntityPalette class="palette-area" />
      <LiveDevice class="device-area" />
      <ButtonPanel class="inspector-area" />
    </div>

    <div v-if="showSettings" class="overlay" @click.self="showSettings = false">
      <div class="dialog panel" role="dialog" aria-modal="true" aria-label="Réglages">
        <button type="button" class="close-settings" aria-label="Fermer les réglages" @click="showSettings = false">×</button>
        <!-- La page est masquée par la fenêtre : ses messages s’affichent ici. -->
        <Messages />
        <SettingsPanel />
      </div>
    </div>
  </main>
</template>

<style>
.app { padding: 12px max(16px, env(safe-area-inset-left, 0px)) 24px; max-width: 1500px; margin: 0 auto; }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-bottom: 12px; }
.top h1 { font-size: 1.25rem; font-weight: 600; }
.top .spacer { flex: 1; }
.top .group { display: inline-flex; align-items: center; gap: 6px; }
.seg-label { font-size: 0.75rem; color: var(--muted); }
.status-chip { font-size: 0.72rem; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 7px; border-radius: 4px; border: 1px solid; }
.status-chip.ok { color: var(--ok); border-color: #2c5a2e; }
.status-chip.warn { color: var(--warn); border-color: #5a4710; }
.status-chip.bad { color: #f3b1b1; border-color: #5a2a2a; }
.banner { padding: 8px 12px; border-radius: 8px; margin: 0 0 12px; font-size: 0.88rem; }
.banner.error { background: #3a1616; border: 1px solid #7a2c2c; }
.banner.warning { background: #3a3012; border: 1px solid #6b5a1c; }
.banner.notice { background: #14301a; border: 1px solid #2c5a2e; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.close-notice { padding: 0 8px; background: transparent; }
.banner.try { background: #12303f; border: 1px solid #2b5a72; color: #d6f1ff; }
.loading { color: var(--muted); }
/* Atelier en trois zones : palette · console · réglages. */
.workspace { display: grid; gap: 14px; align-items: start; grid-template-columns: 260px minmax(0, 1fr) 320px; grid-template-areas: 'pal dev ins'; }
.palette-area { grid-area: pal; }
.device-area { grid-area: dev; }
.inspector-area { grid-area: ins; }
@media (max-width: 1100px) {
  .workspace { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'dev' 'ins' 'pal'; }
}
.overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); display: grid; place-items: center; z-index: 40; padding: 16px; }
.dialog { position: relative; width: min(520px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; padding: 16px; }
.dialog > .banner { margin-right: 2.5rem; }
.close-settings { position: absolute; top: 10px; right: 10px; padding: 2px 9px; font-size: 1.1rem; line-height: 1.2; }
</style>
