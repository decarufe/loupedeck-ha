import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StateStore } from '../../src/config/state.js'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ldha-state-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('StateStore', () => {
  it('defaults to 0', async () => {
    expect((await StateStore.open(dir)).activeButton()).toBe(0)
  })
  it('persists the active button', async () => {
    const s = await StateStore.open(dir)
    await s.setActiveButton(5)
    expect(s.activeButton()).toBe(5)
    expect((await StateStore.open(dir)).activeButton()).toBe(5)
    expect(await fs.readdir(dir)).not.toContain('state.json.tmp')
  })
  it('restarts from 0 when the file is corrupt', async () => {
    await fs.writeFile(path.join(dir, 'state.json'), '{oops')
    expect((await StateStore.open(dir)).activeButton()).toBe(0)
  })
  it('restarts from 0 when the value is out of range', async () => {
    await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({ activeButton: 12 }))
    expect((await StateStore.open(dir)).activeButton()).toBe(0)
  })
})
