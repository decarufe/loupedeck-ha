<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { save, state } from '../store'

const url = ref(state.config?.ha.url ?? '')
const allowSelfSigned = ref(state.config?.ha.allowSelfSigned ?? false)
const newToken = ref('')

// Resynchronise le formulaire quand la configuration change ailleurs (annulation, autre fenêtre).
watch(() => state.config?.ha.url, (v) => { if (v !== undefined) url.value = v }, { immediate: true })
watch(() => state.config?.ha.allowSelfSigned, (v) => { if (v !== undefined) allowSelfSigned.value = v }, { immediate: true })

/** Même normalisation que le serveur : espaces et « / » finaux ignorés. */
const norm = (u: string) => u.trim().replace(/\/+$/, '')
const urlChanged = computed(() => state.config !== null && norm(url.value) !== norm(state.config.ha.url))
const needsToken = computed(() => urlChanged.value && newToken.value.trim() === '')
const insecure = computed(() => url.value.trim().toLowerCase().startsWith('http://'))
const brightness = computed(() => state.config?.device.brightness ?? 1)

const haStatus = computed(() => {
  const ha = state.status?.ha
  if (!ha) return null
  if (ha.state === 'online') return 'Home Assistant connecté'
  if (ha.state === 'connecting') return 'Connexion…'
  return ha.reason === 'auth' ? 'Jeton invalide' : 'Home Assistant hors ligne'
})
const deviceStatus = computed(() => {
  const d = state.status?.device
  if (!d) return null
  if (d.status !== 'connected') return 'Console déconnectée'
  return d.firmware ? `Console connectée (firmware ${d.firmware})` : 'Console connectée'
})

async function saveConnection() {
  const token = newToken.value.trim()
  const u = url.value.trim()
  const ok = await save((cfg) => {
    cfg.ha.url = u
    cfg.ha.allowSelfSigned = allowSelfSigned.value
  }, token === '' ? undefined : token)
  if (ok) newToken.value = ''
}

function setBrightness(e: Event) {
  const value = Number((e.target as HTMLInputElement).value)
  if (value === brightness.value) return
  void save((cfg) => { cfg.device.brightness = value })
}
</script>

<template>
  <section v-if="state.config" class="settings" aria-label="Réglages">
    <h2>Réglages</h2>
    <p v-if="haStatus" class="ha-status" role="status">{{ haStatus }}</p>
    <p v-if="deviceStatus" class="device-status" role="status">{{ deviceStatus }}</p>

    <label>
      Adresse de Home Assistant
      <input class="ha-url" type="text" autocomplete="off" spellcheck="false" v-model="url" />
    </label>
    <p v-if="insecure" class="insecure-warning" role="alert">Connexion non chiffrée : le jeton transite en clair sur le réseau. Préférez une adresse https://.</p>

    <label>
      Jeton d'accès
      <input class="ha-token" type="password" autocomplete="new-password" placeholder="Nouveau jeton" v-model="newToken" />
    </label>
    <p v-if="state.config.ha.hasToken" class="token-saved">Jeton enregistré</p>
    <p v-if="needsToken" class="token-required" role="alert">Saisissez à nouveau le jeton pour une nouvelle adresse</p>

    <label class="inline">
      <input class="allow-self-signed" type="checkbox" v-model="allowSelfSigned" />
      Accepter un certificat auto-signé
    </label>
    <button type="button" class="save-settings" :disabled="needsToken" @click="saveConnection">Enregistrer</button>

    <label>
      Luminosité de la console ({{ Math.round(brightness * 100) }} %)
      <input class="brightness" type="range" min="0" max="1" step="0.1" :value="brightness" @change="setBrightness" />
    </label>
  </section>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; gap: 10px; }
h2 { font-size: 1.05rem; font-weight: 600; padding-right: 2rem; }
p { margin: 0; font-size: 0.82rem; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 0.82rem; color: var(--muted); }
label input { color: var(--fg); }
label.inline { flex-direction: row; align-items: center; gap: 8px; color: var(--fg); }
.ha-status, .device-status { color: var(--muted); }
.insecure-warning { padding: 8px 10px; background: #3a3012; border: 1px solid #6b5a1c; border-radius: 8px; }
.token-required { color: #f3b1b1; }
.token-saved { color: var(--ok); }
.save-settings { align-self: flex-start; }
input[type='range'] { width: 100%; padding: 0; accent-color: var(--accent); }
</style>
