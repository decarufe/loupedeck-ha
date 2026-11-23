import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import { handleLive, reset, state } from '../src/store'
import { publicConfig } from './helpers'

afterEach(() => vi.unstubAllGlobals())

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const holder = (name: string, label: string, agent = false) => ({ name, pid: 1, label, agent })
const DONE = { connected: true, reason: null, killed: ['LogiPluginService.exe'], failed: [], agentRunning: true }

/** Éditeur complet devant une console déconnectée. */
async function app(o: { problem?: string | null; status?: string; holders?: unknown[]; results?: unknown[] } = {}) {
  let device = { status: o.status ?? 'disconnected', firmware: null as string | null, problem: o.problem === undefined ? 'busy' : o.problem }
  const forced: unknown[] = []
  const results = [...(o.results ?? [DONE])]
  vi.stubGlobal('WebSocket', class { close() {} })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/config') return json(publicConfig())
    if (url === '/api/status') return json({ device, ha: { state: 'online' }, activeButton: 0 })
    if (url === '/api/entities') return json([])
    if (url === '/api/console/holders') return json(o.holders ?? [holder('LogiPluginService.exe', 'Logi Plugin Service'), holder('LogiPluginServiceExt.exe', 'Logi Plugin Service'), holder('logioptionsplus_agent.exe', 'Logi Options+', true)])
    if (url === '/api/console/force') {
      forced.push(JSON.parse(String(init!.body)))
      const r = results.shift() as { connected?: boolean; error?: string }
      if (r.error) return json(r, 500)
      if (r.connected) device = { status: 'connected', firmware: '0.2.5', problem: null }
      return json(r)
    }
    return json({ error: 'Introuvable' }, 404)
  }))
  reset()
  const w = mount(App)
  await flushPromises()
  return { w, forced, setDevice: (d: typeof device) => { device = d } }
}

describe('forcer la connexion à la console', () => {
  it('banner_names_the_program_and_forces_on_click_only', async () => {
    const { w, forced } = await app()
    expect(w.text()).toContain('Console occupée')
    const banner = w.get('.console-release')
    expect(banner.text()).toContain('Logi Plugin Service')
    expect(banner.text()).not.toContain('Logi Options+')
    expect(forced).toEqual([])
    await banner.get('button.force-console').trigger('click')
    await flushPromises()
    expect(forced).toEqual([{ includeAgent: false }])
    expect(w.find('.console-release').exists()).toBe(false)
    expect(w.text()).toContain('Console connectée')
    expect(state.notice).toBe('Console connectée. Programme fermé : LogiPluginService.exe.')
    w.unmount()
  })

  it('offers_options_plus_only_after_a_failure', async () => {
    const { w, forced } = await app({ results: [{ ...DONE, connected: false, reason: 'still-busy' }, { ...DONE, killed: ['logioptionsplus_agent.exe', 'LogiPluginService.exe'] }] })
    expect(w.find('button.force-agent').exists()).toBe(false)
    await w.get('button.force-console').trigger('click')
    await flushPromises()
    expect(w.get('.console-release').text()).toContain('la console ne répond toujours pas')
    await w.get('button.force-agent').trigger('click')
    await flushPromises()
    expect(forced).toEqual([{ includeAgent: false }, { includeAgent: true }])
    expect(state.notice).toContain('logioptionsplus_agent.exe, LogiPluginService.exe')
    w.unmount()
  })

  it.each([
    ['denied', { connected: false, reason: 'denied', killed: [], failed: ['Loupedeck2.exe'], agentRunning: false }, 'Windows a refusé de fermer Loupedeck2.exe'],
    ['no-holder', { connected: false, reason: 'no-holder', killed: [], failed: [], agentRunning: false }, 'Aucun logiciel Loupedeck ou Logi'],
    ['absent', { connected: false, reason: 'absent', killed: [], failed: [], agentRunning: false }, 'n’est pas détectée'],
  ])('explains_%s', async (_n, result, text) => {
    const { w } = await app({ results: [result] })
    await w.get('button.force-console').trigger('click')
    await flushPromises()
    expect(w.get('.console-release').text()).toContain(text)
    expect(w.find('button.force-agent').exists()).toBe(false)
    w.unmount()
  })

  it('server_error_is_shown_and_the_button_works_again', async () => {
    const { w, forced } = await app({ results: [{ error: 'Impossible de lister ou de fermer les programmes' }, DONE] })
    await w.get('button.force-console').trigger('click')
    await flushPromises()
    expect(state.error).toBe('Impossible de lister ou de fermer les programmes')
    await w.get('button.force-console').trigger('click')
    await flushPromises()
    expect(forced).toHaveLength(2)
    w.unmount()
  })

  it.each([
    ['absent', 'Console non branchée'],
    [null, 'Console déconnectée'],
  ])('nothing_to_force_when_%s', async (problem, chip) => {
    const { w } = await app({ problem })
    expect(w.text()).toContain(chip)
    expect(w.find('.console-release').exists()).toBe(false)
    w.unmount()
  })

  it('banner_follows_the_live_status', async () => {
    const { w, setDevice } = await app({ status: 'connected', problem: null })
    expect(w.find('.console-release').exists()).toBe(false)
    setDevice({ status: 'disconnected', firmware: null, problem: 'silent' })
    await handleLive({ type: 'status' })
    await flushPromises()
    expect(w.get('.console-release').text()).toContain('La console ne répond pas')
    w.unmount()
  })
})
