import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['editor/**', 'node_modules/**'],
    // Les pools par défaut (threads/forks) échouent sous Node 26 avec « vitest failed to find the current suite ».
    pool: 'vmThreads',
  },
})
