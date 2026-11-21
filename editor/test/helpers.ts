import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { vi } from 'vitest'
import { defaultConfig } from '@shared/config/schema'
import type { EntityInfo } from '@shared/shared/placement'
import type { PublicConfig } from '../src/api'
import ButtonPanel from '../src/components/ButtonPanel.vue'
import EntityPalette from '../src/components/EntityPalette.vue'
import LiveDevice from '../src/components/LiveDevice.vue'
import SettingsPanel from '../src/components/SettingsPanel.vue'
import { loadConfig, reset } from '../src/store'

export interface Call { method: string; url: string; headers: Record<string, string>; body: any }

export function publicConfig(): PublicConfig {
  const { ha, ...rest } = defaultConfig()
  return { ...rest, ha: { url: ha.url, allowSelfSigned: ha.allowSelfSigned, hasToken: true }, loadWarning: null }
}

export function entity(entityId: string, over: Partial<EntityInfo> = {}): EntityInfo {
  const domain = entityId.split('.')[0]!
  return {
    entityId, name: entityId.split('.')[1]!, domain, areaName: null, state: 'on',
    dimmable: domain === 'light', deviceClass: null, icon: null, ...over,
  }
}

export interface MockOptions { entities?: EntityInfo[]; entitiesStatus?: number }

/** `fetch` simulé : GET /api/config renvoie la configuration courante, PUT l'enregistre et la renvoie. */
export function mockFetch(initial: PublicConfig = publicConfig(), opts: MockOptions = {}) {
  let current = initial
  let entities = opts.entities ?? []
  let entitiesStatus = opts.entitiesStatus ?? 200
  const calls: Call[] = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const call: Call = { method, url, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/config' && method === 'PUT') {
      const { newToken: _n, ...rest } = call.body
      current = { ...rest, ha: { ...rest.ha, hasToken: true }, loadWarning: null }
      return json(current)
    }
    if (url === '/api/config/undo' && method === 'POST') return json(current)
    if (url === '/api/config') return json(current)
    if (url === '/api/status') return json({ device: { status: 'connected', firmware: '0.2.5' }, ha: { state: 'online' }, activeButton: -1 })
    if (url === '/api/entities') return entitiesStatus === 200 ? json(entities) : json({ error: 'Home Assistant hors ligne' }, entitiesStatus)
    return json({ error: 'Introuvable' }, 404)
  })
  vi.stubGlobal('fetch', fn)
  return {
    calls,
    puts: () => calls.filter((c) => c.method === 'PUT'),
    setEntities: (list: EntityInfo[]) => { entities = list },
    setEntitiesStatus: (status: number) => { entitiesStatus = status },
  }
}

export async function mountEditor() {
  reset()
  await loadConfig()
  const Harness = defineComponent({ render: () => h('div', [h(LiveDevice), h(ButtonPanel), h(EntityPalette), h(SettingsPanel)]) })
  return mount(Harness)
}
