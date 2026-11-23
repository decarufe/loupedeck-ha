<script setup lang="ts">
import { state } from '../store'
</script>

<template>
  <p v-if="state.error" class="banner error" role="alert">{{ state.error }}</p>
  <p v-if="state.notice" class="banner notice" role="status">
    {{ state.notice }}
    <button type="button" class="close-notice" aria-label="Fermer le message" @click="state.notice = null">×</button>
  </p>
</template>
