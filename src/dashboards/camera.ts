import type { CameraDashboard } from '../config/schema.js'
import type { InputEvent } from '../device/input.js'
import { createHaProxySource, type CameraSource } from '../camera/source.js'
import { PressTracker } from '../device/press.js'
import { formatAge } from '../shared/format.js'
import type { CameraAge, FullView } from '../views.js'
import type { Dashboard, DashboardDeps } from './types.js'

/** Compteur de la tuile haut gauche : ambre à partir de 10 s sans nouvelle image, rouge (image figée) à partir de 30 s. */
export const WARN_MS = 10_000
export const STALE_MS = 30_000
/** Le compteur avance chaque seconde. */
const TICK_MS = 1000
const TILE_KEY = 'age'

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
  let wakeUp: (() => void) | null = null
  let tickTimer: ReturnType<typeof setInterval> | null = null
  let busy: CameraAge['busy'] = null
  /** Ouverture par une alerte : « Chargement… » jusqu'à la première image ou au premier échec. */
  let loading = false
  const press = new PressTracker()

  const isStale = () => image !== null && Date.now() - lastFrameAt >= STALE_MS

  function sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve()
    return new Promise((resolve) => {
      wakeUp = () => { if (sleepTimer) clearTimeout(sleepTimer); sleepTimer = null; wakeUp = null; resolve() }
      sleepTimer = setTimeout(() => wakeUp?.(), ms)
    })
  }

  /** Appui court sur la tuile : nouvelle image tout de suite (la boucle n'attend pas la fin de l'intervalle). */
  function refresh(): void {
    if (busy === 'reload') return
    busy = 'refresh'
    d.requestRender()
    wakeUp?.()
  }

  /** Appui long sur la tuile : recharge l'intégration de la caméra dans Home Assistant, puis redemande une image. */
  function reload(): void {
    if (!cfg.entityId) return
    busy = 'reload'
    d.requestRender()
    d.actions.reloadIntegration(cfg.entityId).catch(() => undefined).finally(() => {
      if (busy === 'reload') busy = 'refresh'
      d.requestRender()
      wakeUp?.()
    })
  }

  function age(): CameraAge {
    const ms = Date.now() - lastFrameAt
    if (!image) return { text: '—', level: 'bad', busy }
    return { text: formatAge(ms), level: ms >= STALE_MS ? 'bad' : ms >= WARN_MS ? 'warn' : 'ok', busy }
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
        loading = false
        if (busy === 'refresh') busy = null
        ok = true
        d.requestRender()
      } catch {
        if (mine !== epoch) return
        if (loading) { loading = false; d.requestRender() }
        // On garde la dernière image ; un nouvel essai part après un intervalle complet.
        if (busy === 'refresh') { busy = null; d.requestRender() }
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
        message: image ? null : loading ? 'Chargement…' : 'Image non disponible',
        stale: isStale(),
        offline,
        fit,
        age: age(),
      }
    },

    /** Seule la tuile haut gauche réagit : appui court = forcer une image, appui long = recharger l'intégration. */
    handle(e: InputEvent) {
      if (!cfg.entityId) return
      const onTile = (e.type === 'tap' || e.type === 'release') && e.target.kind === 'strip' && e.target.side === 'left' && e.target.zone === 0
      if (!onTile) return
      if (e.type === 'tap') press.press(TILE_KEY, refresh, reload)
      else press.release(TILE_KEY)
    },

    prepareAlert() {
      image = null
      loading = true
    },

    activate() {
      const keepLoading = loading
      this.deactivate()
      loading = keepLoading
      if (!cfg.entityId) return
      source ??= makeSource(cfg)
      const mine = ++epoch
      abort = new AbortController()
      tickTimer = setInterval(() => d.requestRender(), TICK_MS)
      void loop(mine, abort.signal)
    },

    deactivate() {
      epoch++
      abort?.abort()
      abort = null
      if (sleepTimer) clearTimeout(sleepTimer)
      sleepTimer = null
      wakeUp = null
      if (tickTimer) clearInterval(tickTimer)
      tickTimer = null
      press.clear()
      loading = false
      if (busy === 'refresh') busy = null
    },
  }
}
