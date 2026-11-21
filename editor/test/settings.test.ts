import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import { state } from '../src/store'
import { mockFetch, mountEditor, publicConfig } from './helpers'

afterEach(() => vi.unstubAllGlobals())

class FakeSocket {
  onmessage: unknown = null
  onclose: unknown = null
  close() {}
}

describe('SettingsPanel', () => {
  it('settings_token_never_prefilled', async () => {
    const m = mockFetch()
    const w = await mountEditor()
    const token = w.get('input.ha-token')
    expect(token.attributes('type')).toBe('password')
    expect((token.element as HTMLInputElement).value).toBe('')
    expect(w.text()).toContain('Jeton enregistré')

    await token.setValue('  secret-token ')
    await w.get('button.save-settings').trigger('click')
    await flushPromises()
    expect(m.puts()).toHaveLength(1)
    expect(m.puts()[0]!.body.newToken).toBe('secret-token')
    expect(m.puts()[0]!.body.ha.token).toBeUndefined()
    expect((w.get('input.ha-token').element as HTMLInputElement).value).toBe('')
  })

  it('settings_no_saved_token_message_when_missing', async () => {
    const cfg = publicConfig()
    cfg.ha.hasToken = false
    mockFetch(cfg)
    const w = await mountEditor()
    expect(w.text()).not.toContain('Jeton enregistré')
  })

  it('settings_http_warning', async () => {
    mockFetch()
    const w = await mountEditor()
    expect(w.get('.insecure-warning').text()).toContain('Connexion non chiffrée')
    await w.get('input.ha-url').setValue('https://hass.decarufel.net')
    expect(w.find('.insecure-warning').exists()).toBe(false)
  })

  it('settings_url_change_requires_token', async () => {
    const m = mockFetch()
    const w = await mountEditor()
    const save = () => w.get('button.save-settings').element as HTMLButtonElement
    expect(save().disabled).toBe(false)
    expect(w.text()).not.toContain('Saisissez à nouveau le jeton pour une nouvelle adresse')

    await w.get('input.ha-url').setValue('https://hass.decarufel.net')
    expect(save().disabled).toBe(true)
    expect(w.text()).toContain('Saisissez à nouveau le jeton pour une nouvelle adresse')

    await w.get('input.ha-token').setValue('abc')
    expect(save().disabled).toBe(false)
    expect(w.text()).not.toContain('Saisissez à nouveau le jeton pour une nouvelle adresse')
    await w.get('button.save-settings').trigger('click')
    await flushPromises()
    expect(m.puts()[0]!.body.ha.url).toBe('https://hass.decarufel.net')
    expect(m.puts()[0]!.body.newToken).toBe('abc')

    // Un simple « / » final n'est pas un changement d'adresse (même règle que le serveur).
    await w.get('input.ha-url').setValue('https://hass.decarufel.net/')
    expect(save().disabled).toBe(false)
  })

  it('settings_self_signed_checkbox', async () => {
    const m = mockFetch()
    const w = await mountEditor()
    await w.get('input.allow-self-signed').setValue(true)
    await w.get('button.save-settings').trigger('click')
    await flushPromises()
    expect(m.puts()[0]!.body.ha.allowSelfSigned).toBe(true)
  })

  it('settings_status', async () => {
    mockFetch()
    const w = await mountEditor()
    state.status = { device: { status: 'connected', firmware: '0.2.5' }, ha: { state: 'offline', reason: 'auth' }, activeButton: -1 }
    await flushPromises()
    expect(w.get('.ha-status').text()).toContain('Jeton invalide')
    expect(w.get('.device-status').text()).toContain('0.2.5')

    state.status = { device: { status: 'disconnected', firmware: null }, ha: { state: 'offline', reason: 'network' }, activeButton: -1 }
    await flushPromises()
    expect(w.get('.device-status').text()).toContain('Console déconnectée')
    expect(w.get('.ha-status').text()).toContain('Home Assistant hors ligne')

    state.status = { device: { status: 'disconnected', firmware: null }, ha: { state: 'connecting', reason: null }, activeButton: -1 }
    await flushPromises()
    expect(w.get('.ha-status').text()).toContain('Connexion…')
  })

  it('brightness_slider', async () => {
    const m = mockFetch()
    const w = await mountEditor()
    const range = w.get('input.brightness')
    expect(range.attributes('type')).toBe('range')
    expect(range.attributes('min')).toBe('0')
    expect(range.attributes('max')).toBe('1')
    expect(range.attributes('step')).toBe('0.1')
    ;(range.element as HTMLInputElement).value = '0.5'
    await range.trigger('change')
    await flushPromises()
    expect(m.puts()).toHaveLength(1)
    expect(m.puts()[0]!.body.device.brightness).toBe(0.5)
  })
})

describe('App', () => {
  it('load_warning_banner', async () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const cfg = publicConfig()
    cfg.loadWarning = 'Configuration illisible : valeurs par défaut utilisées'
    mockFetch(cfg)
    const w = mount(App)
    await flushPromises()
    expect(w.get('.banner.warning').text()).toBe('Configuration illisible : valeurs par défaut utilisées')
    w.unmount()
  })

  it('undo_button', async () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const m = mockFetch()
    const w = mount(App)
    await flushPromises()
    await w.get('button.undo').trigger('click')
    await flushPromises()
    const undo = m.calls.filter((c) => c.method === 'POST' && c.url === '/api/config/undo')
    expect(undo).toHaveLength(1)
    expect(undo[0]!.headers['X-Loupedeck-Editor']).toBe('1')
    w.unmount()
  })

  it('entities_loaded_once_at_startup', async () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const m = mockFetch()
    const w = mount(App)
    await flushPromises()
    expect(m.calls.filter((c) => c.url === '/api/entities')).toHaveLength(1)
    w.unmount()
  })
})
