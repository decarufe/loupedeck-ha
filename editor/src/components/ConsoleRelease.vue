<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ForceResult } from '../api'
import { forceConsole, loadHolders, state } from '../store'

/** Bandeau affiché quand la console est branchée mais prise par un autre programme, ou muette. */
const problem = computed(() => {
  const d = state.status?.device
  return d && d.status !== 'connected' && d.problem && d.problem !== 'absent' ? d.problem : null
})
const holders = ref<string[]>([])
const result = ref<ForceResult | null>(null)
const busy = ref(false)

watch(problem, async (p) => {
  if (!p) { result.value = null; return }
  holders.value = [...new Set((await loadHolders()).filter((h) => !h.agent).map((h) => h.label))]
}, { immediate: true })

const cause = computed(() => {
  if (problem.value === 'busy') return 'La console est utilisée par un autre programme'
  return problem.value === 'silent' ? 'La console ne répond pas' : 'Connexion à la console impossible'
})
const outcome = computed(() => {
  const r = result.value
  switch (r?.reason) {
    case 'denied': return `Windows a refusé de fermer ${r.failed.join(', ')} : fermez-le à la main (Gestionnaire des tâches), puis réessayez.`
    case 'still-busy': return `Fermé : ${r.killed.join(', ')}, mais la console ne répond toujours pas. Débranchez-la et rebranchez-la si cela persiste.`
    case 'no-holder': return 'Aucun logiciel Loupedeck ou Logi connu ne tourne. Vérifiez qu’une autre copie de Loupedeck HA n’est pas ouverte, ou débranchez et rebranchez la console.'
    case 'absent': return 'La console n’est pas détectée : vérifiez le câble USB.'
    default: return null
  }
})
const offerAgent = computed(() => result.value?.reason === 'still-busy' && result.value.agentRunning)

async function force(includeAgent: boolean) {
  busy.value = true
  try {
    result.value = await forceConsole(includeAgent)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="problem" class="banner warning console-release" role="status">
    <div class="text">
      <strong>{{ cause }}<template v-if="holders.length > 0"> (en cours : {{ holders.join(', ') }})</template>.</strong>
      <span v-if="outcome" class="outcome">{{ outcome }}</span>
      <span v-else>« Forcer la connexion » ferme immédiatement les logiciels Loupedeck et Logi Plugin Service, puis prend la console.</span>
    </div>
    <div class="actions">
      <button type="button" class="force-console" :disabled="busy" @click="force(false)">{{ busy ? 'Connexion…' : 'Forcer la connexion' }}</button>
      <button v-if="offerAgent" type="button" class="force-agent" :disabled="busy" title="Logi Options+ relance le service qui prend la console. Les réglages de souris et de clavier Logitech peuvent s’interrompre un instant." @click="force(true)">
        Fermer aussi Logi Options+
      </button>
    </div>
  </div>
</template>

<style scoped>
.console-release { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
.text { display: flex; flex-direction: column; gap: 2px; flex: 1 1 320px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.force-console { background: var(--accent-bg); border-color: var(--accent); }
</style>
