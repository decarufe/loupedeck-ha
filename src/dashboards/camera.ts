import type { CameraDashboard } from '../config/schema.js'
import type { InputEvent } from '../device/input.js'
import { createHaProxySource, type CameraSource } from '../camera/source.js'
import type { FullView } from '../views.js'
import type { Dashboard, DashboardDeps } from './types.js'

export const STALE_MS = 5000
const STALE_CHECK_MS = 1000

export function createCameraDashboard(
  cfg: CameraDashboard,
  d: DashboardDeps & { createSource?: (cfg: CameraDashboard) => CameraSource },
): Dashboard {
  const makeSource = d.createSource ?? ((c: CameraDashboard) => createHaProxySource(d.ha, c.entityId!))
  let source: CameraSource | null = null
  let image: Buffer | null = null
  let lastFrameAt = 0
  let epoch = 0
  let abort: AbortController | null = null
  let sleepTimer: ReturnType<typeof setTimeout> | null = null
  let staleTimer: ReturnType<typeof setInterval> | null = null
  let reportedStale = false

  const isStale = () => image !== null && Date.now() - lastFrameAt >= STALE_MS

  function sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve()
    return new Promise((resolve) => { sleepTimer = setTimeout(() => { sleepTimer = null; resolve() }, ms) })
  }

  async function loop(mine: number, signal: AbortSignal): Promise<void> {
    while (mine === epoch) {
      const t0 = Date.now()
      let ok = false
      try {
        const frame = await source!.next(signal)
        if (mine !== epoch) return
        image = frame
        lastFrameAt = Date.now()
        reportedStale = false
        ok = true
        d.requestRender()
      } catch {
        if (mine !== epoch) return
        // On garde la dernière image ; un nouvel essai part après un intervalle complet.
      }
      await sleep(ok ? Math.max(0, cfg.intervalMs - (Date.now() - t0)) : cfg.intervalMs)
    }
  }

  return {
    view(): FullView {
      const offline = d.ha.status().state !== 'online'
      const fit = cfg.fit ?? 'cover'
      if (!cfg.entityId) return { kind: 'full', image: null, message: 'Aucune caméra configurée', stale: false, offline, fit }
      return {
        kind: 'full',
        image,
        message: image ? null : 'Image non disponible',
        stale: isStale(),
        offline,
        fit,
      }
    },

    handle(_e: InputEvent) {},

    activate() {
      this.deactivate()
      if (!cfg.entityId) return
      source ??= makeSource(cfg)
      const mine = ++epoch
      abort = new AbortController()
      reportedStale = isStale()
      staleTimer = setInterval(() => {
        const stale = isStale()
        if (stale !== reportedStale) { reportedStale = stale; d.requestRender() }
      }, STALE_CHECK_MS)
      void loop(mine, abort.signal)
    },

    deactivate() {
      epoch++
      abort?.abort()
      abort = null
      if (sleepTimer) clearTimeout(sleepTimer)
      sleepTimer = null
      if (staleTimer) clearInterval(staleTimer)
      staleTimer = null
    },
  }
}
