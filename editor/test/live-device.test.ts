import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleLive } from '../src/store'
import { mockFetch, mountEditor } from './helpers'

afterEach(() => vi.unstubAllGlobals())

describe('LiveDevice', () => {
  it('renders_8_round_buttons_with_colors', async () => {
    mockFetch()
    const w = await mountEditor()
    const rounds = w.findAll('.round-button')
    expect(rounds).toHaveLength(8)
    expect(rounds[0]!.attributes('style')).toContain('background-color: rgb(255, 179, 0)')
    expect(rounds[7]!.classes()).toContain('empty')
    expect(rounds[2]!.attributes('aria-label')).toBe('Bouton rond 3 — Météo')
  })

  it('preview_background', async () => {
    mockFetch()
    const w = await mountEditor()
    await w.findAll('.round-button')[2]!.trigger('click')
    expect(w.get('img.preview').attributes('src')).toBe('/api/preview/2.png?v=0')
    await handleLive({ type: 'config' })
    await flushPromises()
    expect(w.get('img.preview').attributes('src')).toMatch(/v=1$/)
  })

  it('key_and_strip_hotspots', async () => {
    mockFetch()
    const w = await mountEditor() // le bouton 0 est le tableau Lumières
    expect(w.findAll('.key-slot')).toHaveLength(12)
    expect(w.findAll('.dimmer-slot')).toHaveLength(6)
    const dimmers = w.findAll('.dimmer-slot')
    expect(dimmers[0]!.attributes('style')).toContain('left: 0%')
    expect(dimmers[3]!.attributes('style')).toContain('left: 87.5%')
    expect(dimmers[1]!.attributes('style')).toContain('top: 33.3333')
    await w.findAll('.round-button')[2]!.trigger('click')
    expect(w.findAll('.key-slot')).toHaveLength(0)
  })

  it('active_on_console_badge', async () => {
    mockFetch()
    const w = await mountEditor()
    await handleLive({ type: 'active', button: 3 })
    await flushPromises()
    const rounds = w.findAll('.round-button')
    expect(rounds[3]!.classes()).toContain('active-on-device')
    expect(rounds[0]!.classes()).not.toContain('active-on-device')
  })
})
