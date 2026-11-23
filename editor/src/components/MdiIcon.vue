<script setup lang="ts">
import { computed } from 'vue'
import * as mdi from '@mdi/js'

const ICONS = mdi as unknown as Record<string, unknown>
const props = defineProps<{ name: string | null | undefined }>()

/** « mdi:lightbulb-on » → chemin de mdiLightbulbOn ; une icône inconnue donne une maison. */
const path = computed(() => {
  const n = props.name
  const key = n && n.startsWith('mdi:') ? 'mdi' + n.slice(4).split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('') : ''
  const v = key && Object.hasOwn(ICONS, key) ? ICONS[key] : ICONS.mdiHome
  return typeof v === 'string' ? v : ''
})
</script>

<template>
  <svg class="mdi" viewBox="0 0 24 24" aria-hidden="true"><path :d="path" fill="currentColor" /></svg>
</template>
