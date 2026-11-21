import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { rewriteOrigin } from './dev-origin'

const BACKEND = 'http://127.0.0.1:8765'
const PORT = 5173
const DEV_ORIGINS = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]

type ProxyReq = { setHeader: (k: string, v: string) => void }
type Incoming = { headers: { origin?: string } }

/** Le serveur refuse toute origine étrangère : on ne réécrit l'Origin que si elle vient du serveur de développement lui-même. */
const fixOrigin = (proxy: { on: (e: string, cb: (proxyReq: ProxyReq, req: Incoming) => void) => void }) => {
  const apply = (proxyReq: ProxyReq, req: Incoming) => {
    const out = rewriteOrigin(req.headers.origin, DEV_ORIGINS, BACKEND)
    if (out !== undefined) proxyReq.setHeader('origin', out)
  }
  proxy.on('proxyReq', apply)
  proxy.on('proxyReqWs', apply)
}

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: PORT,
    strictPort: true,
    proxy: { '/api': { target: BACKEND, ws: true, changeOrigin: true, configure: fixOrigin } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
