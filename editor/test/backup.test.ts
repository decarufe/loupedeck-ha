import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import { reset, state } from '../src/store'
import { mockFetch, mountEditor, publicConfig } from './helpers'

afterEach(() => vi.unstubAllGlobals())

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

async function pick(w: Awaited<ReturnType<typeof mountEditor>>, text: string) {
  const input = w.get('input.import-file')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [{ text: async () => text }] })
  await input.trigger('change')
  await flushPromises()
  return input.element as HTMLInputElement
}

describe('export et import des réglages', () => {
  it('export_is_a_download_link', async () => {
    mockFetch()
    const w = await mountEditor()
    const a = w.get('a.export-settings')
    expect(a.attributes('href')).toBe('/api/config/export')
    expect(a.attributes('download')).toBeDefined()
  })

  it('import_posts_the_file_and_shows_the_result', async () => {
    mockFetch()
    const w = await mountEditor()
    state.selectedSlot = { kind: 'key', index: 2 }
    const next = publicConfig()
    next.device.brightness = 0.3
    const post = vi.fn(async (_url: string, _init?: RequestInit) => json({ config: next, tokenRequired: false }))
    vi.stubGlobal('fetch', post)
    await pick(w, '{"format":"loupedeck-ha","config":{"a":1}}')
    const [url, init] = post.mock.calls[0]!
    expect(url).toBe('/api/config/import')
    expect(init!.method).toBe('POST')
    expect((init!.headers as Record<string, string>)['X-Loupedeck-Editor']).toBe('1')
    expect(JSON.parse(String(init!.body))).toEqual({ format: 'loupedeck-ha', config: { a: 1 } })
    expect(state.config!.device.brightness).toBe(0.3)
    expect(state.selectedSlot).toBeNull()
    expect(state.error).toBeNull()
    expect(state.notice).toBe('Réglages importés. « Annuler » revient aux réglages précédents.')
  })

  it('import_asks_for_the_token_of_a_new_address', async () => {
    mockFetch()
    const w = await mountEditor()
    vi.stubGlobal('fetch', vi.fn(async () => json({ config: publicConfig(), tokenRequired: true })))
    await pick(w, '{}')
    expect(state.notice).toContain('Saisissez le jeton')
  })

  it('import_refusal_and_unreadable_file_show_why', async () => {
    const m = mockFetch()
    const w = await mountEditor()
    await pick(w, 'pas du JSON')
    expect(state.error).toBe('Ce fichier ne contient pas de réglages Loupedeck HA')
    expect(m.calls.some((c) => c.method === 'POST')).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Configuration invalide', issues: ['buttons : 8 attendus'] }, 400)))
    const input = await pick(w, '{}')
    expect(state.error).toBe('Configuration invalide — buttons : 8 attendus')
    expect(state.notice).toBeNull()
    // Le même fichier, corrigé, doit pouvoir être choisi à nouveau.
    expect(input.value).toBe('')
  })

  it('the_notice_is_shown_and_goes_away_with_the_next_change', async () => {
    vi.stubGlobal('WebSocket', class { close() {} })
    reset()
    mockFetch()
    const w = mount(App)
    await flushPromises()
    state.notice = 'Réglages importés.'
    await flushPromises()
    expect(w.get('.banner.notice').text()).toContain('Réglages importés.')
    await w.get('button.undo').trigger('click')
    await flushPromises()
    expect(w.find('.banner.notice').exists()).toBe(false)
    w.unmount()
  })
})
