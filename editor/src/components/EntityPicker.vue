<script setup lang="ts">
import { computed } from 'vue'
import { canPlace, type SlotKind } from '@shared/shared/placement'
import { state } from '../store'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ kind: SlotKind; modelValue: string | null; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

const options = computed(() => {
  const list = state.entities.filter((e) => canPlace(props.kind, e).ok)
    .map((e) => ({ id: e.entityId, text: `${e.name} (${e.entityId})` }))
    .sort((a, b) => a.text.localeCompare(b.text))
  // Une entité déjà configurée mais absente de la liste (Home Assistant hors ligne) reste visible.
  if (props.modelValue && !list.some((o) => o.id === props.modelValue)) list.unshift({ id: props.modelValue, text: props.modelValue })
  return list
})

const change = (e: Event) => {
  const v = (e.target as HTMLSelectElement).value
  emit('update:modelValue', v === '' ? null : v)
}
</script>

<template>
  <label class="picker">
    {{ label }}
    <select v-bind="$attrs" :value="modelValue ?? ''" @change="change">
      <option value="">— Aucune —</option>
      <option v-for="o in options" :key="o.id" :value="o.id">{{ o.text }}</option>
    </select>
  </label>
</template>

<style scoped>
.picker { display: flex; flex-direction: column; gap: 4px; font-size: 0.82rem; color: var(--muted); }
select { color: var(--fg); }
</style>
