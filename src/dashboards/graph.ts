import { GRAPH_WINDOWS_H, type GraphDashboard } from '../config/schema.js'
import type { InputEvent } from '../device/input.js'
import { HistoryCache } from '../ha/history.js'
import { formatNumber, formatSpan } from '../shared/format.js'
import type { GraphView } from '../views.js'
import type { Dashboard, DashboardDeps } from './types.js'

const H = 3_600_000
/** Historique chargé : la plus grande fenêtre. */
export const GRAPH_HISTORY_H = GRAPH_WINDOWS_H.at(-1)!
const ZOOM_MAX = 16
const TICK_MS = 30_000

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

function ago(ms: number): string {
  return ms < 60_000 ? 'maintenant' : `il y a ${formatSpan(ms)}`
}

/**
 * Graphique plein écran d'un capteur numérique. Molettes : haut gauche = échelle verticale, milieu gauche = défilement vertical,
 * haut droite = échelle horizontale (fenêtre), milieu droite = défilement horizontal. Un appui sur une molette recadre son axe.
 */
export function createGraphDashboard(cfg: GraphDashboard, d: DashboardDeps, now: () => number = Date.now): Dashboard {
  const history = new HistoryCache(d.ha, now)
  const defaultWin = Math.max(0, GRAPH_WINDOWS_H.indexOf(cfg.windowHours as typeof GRAPH_WINDOWS_H[number]))
  let win = defaultWin
  let xOff = 0
  let zoom = 1
  let yOff = 0
  let unsubs: (() => void)[] = []
  let timer: ReturnType<typeof setInterval> | null = null

  const winMs = () => GRAPH_WINDOWS_H[win]! * H
  const maxOff = () => Math.max(0, GRAPH_HISTORY_H * H - winMs())

  function view(): GraphView {
    const offline = d.ha.status().state !== 'online'
    const blank: GraphView = {
      kind: 'graph', title: cfg.name, valueText: '', subtitle: '', color: cfg.color, points: [], start: 0, end: 1, lo: 0, hi: 1, decimals: 0,
      xLabels: ['', '', ''], scroll: { from: 0, width: 1 }, hints: {}, message: null, offline,
    }
    if (!cfg.entityId) return { ...blank, message: 'Aucun capteur configuré' }
    const e = d.ha.entities()[cfg.entityId]
    const t = now()
    const end = t - xOff
    const start = end - winMs()
    const all = history.points(cfg.entityId, GRAPH_HISTORY_H)
    const before = all.filter((p) => p.t < start).at(-1)
    const visible = all.filter((p) => p.t >= start && p.t <= end)
    const points = before ? [{ t: start, v: before.v }, ...visible] : visible
    const unit = e?.attributes.unit_of_measurement ?? ''
    const title = e?.attributes.friendly_name ?? cfg.name
    const current = Number.parseFloat(e?.state ?? '')
    const valueText = Number.isFinite(current) ? `${formatNumber(current, Math.abs(current) < 100 ? 1 : 0)}${unit ? ` ${unit}` : ''}` : (e?.state ?? '—')
    if (points.length === 0) return { ...blank, title, valueText, message: e ? 'Historique en cours de chargement…' : 'Capteur introuvable' }

    const vs = points.map((p) => p.v)
    const vmin = Math.min(...vs)
    const vmax = Math.max(...vs)
    const span0 = vmax - vmin || Math.max(1, Math.abs(vmax) * 0.1)
    const span = (span0 * 1.2) / zoom
    const mid = (vmax + vmin) / 2 + yOff * span0
    const decimals = span < 3 ? 1 : 0
    const zoomText = `×${formatNumber(zoom, Number.isInteger(zoom) ? 0 : 1)}`
    const total = GRAPH_HISTORY_H * H
    return {
      kind: 'graph', title, valueText, color: cfg.color, points, start, end, lo: mid - span / 2, hi: mid + span / 2, decimals,
      subtitle: `${formatSpan(winMs())} · ${xOff ? `fin ${ago(xOff)}` : 'en direct'} · échelle ${zoomText}`,
      xLabels: [ago(t - start), ago(t - (start + end) / 2), ago(t - end)],
      scroll: { from: clamp((start - (t - total)) / total, 0, 1), width: Math.min(1, winMs() / total) },
      hints: {
        L0: { glyph: '↕', title: 'Échelle V', sub: zoomText },
        L1: { glyph: '⇅', title: 'Défil. V', sub: yOff ? `${yOff > 0 ? '↑' : '↓'} ${formatNumber(Math.abs(yOff * span0), decimals)}` : 'centré' },
        R0: { glyph: '↔', title: 'Échelle H', sub: formatSpan(winMs()) },
        R1: { glyph: '⇆', title: 'Défil. H', sub: xOff ? ago(xOff) : 'en direct' },
      },
      message: null, offline,
    }
  }

  return {
    view,

    handle(e: InputEvent) {
      if (e.type === 'knobTurn') {
        switch (e.knob) {
          case 'knobTL': zoom = Math.round(clamp(zoom * 1.25 ** e.delta, 1, ZOOM_MAX) * 100) / 100; break
          case 'knobCL': yOff = clamp(yOff + (e.delta * 0.08) / zoom, -1, 1); break
          case 'knobTR': win = clamp(win - Math.sign(e.delta), 0, GRAPH_WINDOWS_H.length - 1); xOff = clamp(xOff, 0, maxOff()); break
          case 'knobCR': xOff = clamp(xOff - e.delta * (winMs() / 6), 0, maxOff()); break
          default: return
        }
        d.requestRender()
      } else if (e.type === 'knobPress') {
        if (e.knob === 'knobTL' || e.knob === 'knobCL') { zoom = 1; yOff = 0 }
        else if (e.knob === 'knobTR' || e.knob === 'knobCR') { win = defaultWin; xOff = 0 }
        else return
        d.requestRender()
      }
    },

    activate() {
      this.deactivate()
      history.start()
      unsubs = [history.onChange(() => d.requestRender()), d.ha.onStatus(() => d.requestRender())]
      timer = setInterval(() => d.requestRender(), TICK_MS)
    },

    deactivate() {
      for (const u of unsubs) u()
      unsubs = []
      history.stop()
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
