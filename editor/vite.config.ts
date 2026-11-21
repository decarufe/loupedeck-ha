import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const BACKEND = 'http://127.0.0.1:8765'

/** Le serveur refuse toute origine autre que la sienne : on réécrit l'en-tête Origin (HTTP et WebSocket). */
const fixOrigin = (proxy: { on: (e: string, cb: (req: { setHeader: (k: string, v: string) => void }) => void) => void }) => {
  proxy.on('proxyReq', (req) => req.setHeader('origin', BACKEND))
  proxy.on('proxyReqWs', (req) => req.setHeader('origin', BACKEND))
}

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: {
    proxy: { '/api': { target: BACKEND, ws: true, changeOrigin: true, configure: fixOrigin } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
