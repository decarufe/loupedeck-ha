import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '../src/log.js'

describe('createLogger', () => {
  let dir: string
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lha-log-')) })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  it('écrit dans le fichier (dossier créé au besoin) en masquant les jetons', async () => {
    const file = path.join(dir, 'logs', 'app.log')
    const log = createLogger(file, { stdout: false })
    log.info('Bonjour', {
      token: 'SECRET-1',
      ha: { token: 'SECRET-2' },
      access_token: 'SECRET-3',
      headers: { authorization: 'Bearer SECRET-4' },
      url: 'http://ha.local:8123',
    })
    log.warn('Sans détails')
    const text = await fs.readFile(file, 'utf8')
    const lines = text.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => l.msg)).toEqual(['Bonjour', 'Sans détails'])
    expect(lines[0].url).toBe('http://ha.local:8123')
    expect(text).not.toMatch(/SECRET/)
  })
})
