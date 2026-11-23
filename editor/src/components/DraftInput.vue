<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

/**
 * Champ de saisie qui garde ce qu'on y tape jusqu'à la validation (perte du focus, Entrée, ou fermeture du
 * sélecteur de couleur). L'éditeur est redessiné sans arrêt (aperçu en direct) : un simple `:value` serait
 * réécrit à chaque rendu et effacerait la saisie en cours.
 */
defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue: string; commit: (value: string) => unknown }>()

/** Saisie en cours ; null quand le champ suit la configuration. */
const draft = ref<string | null>(null)
let saving: string | null = null
let gone = false
onBeforeUnmount(() => { gone = true })

async function commitDraft() {
  const value = draft.value
  // Retiré de la page (Échap, autre emplacement) : certains navigateurs émettent encore `blur`.
  if (gone || value === null || value === saving) return
  if (value === props.modelValue) {
    draft.value = null
    return
  }
  saving = value
  try {
    await props.commit(value)
  } finally {
    saving = null
    // Enregistrée ou refusée, la configuration fait foi ; sauf si la saisie a repris entre-temps.
    if (draft.value === value) draft.value = null
  }
}
const onInput = (e: Event) => { draft.value = (e.target as HTMLInputElement).value }
function onChange(e: Event) {
  onInput(e)
  void commitDraft()
}
const blurOnEnter = (e: Event) => (e.target as HTMLInputElement).blur()
</script>

<template>
  <input v-bind="$attrs" :value="draft ?? modelValue" @input="onInput" @change="onChange" @blur="commitDraft" @keydown.enter="blurOnEnter" />
</template>
