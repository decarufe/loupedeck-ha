import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['editor/**', 'node_modules/**'],
    // Les pools par défaut (threads/forks) échouent sous Node 26 avec « vitest failed to find the current suite ».
    pool: 'vmThreads',
  },
  // Sans cela, Vite explore editor/index.html et tente de pré-empaqueter le binaire natif de @napi-rs/canvas (env interne du pool vmThreads).
  environments: {
    __vitest_vm__: { optimizeDeps: { entries: [], noDiscovery: true, include: [] } },
  },
})
