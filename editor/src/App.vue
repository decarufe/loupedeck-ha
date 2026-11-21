<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import ButtonPanel from './components/ButtonPanel.vue'
import LiveDevice from './components/LiveDevice.vue'
import { init, state, undo } from './store'

let stop: (() => void) | null = null
onMounted(async () => { stop = await init() })
onBeforeUnmount(() => stop?.())
</script>

<template>
  <main class="app">
    <header class="top">
      <h1>Éditeur Loupedeck</h1>
      <button type="button" aria-label="Annuler la dernière modification" @click="undo">Annuler</button>
    </header>
    <p v-if="state.config?.loadWarning" class="banner warning" role="status">{{ state.config.loadWarning }}</p>
    <p v-if="state.error" class="banner error" role="alert">{{ state.error }}</p>
    <p v-if="!state.config" class="loading">Chargement…</p>
    <div v-else class="layout">
      <LiveDevice />
      <ButtonPanel />
    </div>
  </main>
</template>

<style>
:root { color-scheme: dark; }
body { margin: 0; background: #121212; color: #eee; font-family: system-ui, sans-serif; }
.app { max-width: 1200px; margin: 0 auto; padding: 1rem; }
.top { display: flex; align-items: center; justify-content: space-between; }
.top h1 { font-size: 1.3rem; margin: 0; }
button { font: inherit; color: inherit; background: #2a2a2a; border: 1px solid #555; border-radius: 6px; padding: 0.35rem 0.8rem; cursor: pointer; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #4fc3f7; outline-offset: 2px; }
.banner { padding: 0.6rem 0.9rem; border-radius: 6px; margin: 0.8rem 0; }
.banner.error { background: #5a1d1d; border: 1px solid #c0392b; }
.banner.warning { background: #4a3d12; border: 1px solid #b8962e; }
.layout { display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: flex-start; }
</style>
