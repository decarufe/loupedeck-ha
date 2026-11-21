import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger, createSecretScrubber } from '../src/log.js'

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

describe('createSecretScrubber', () => {
  it('masque tous les jetons connus, y compris un ancien jeton après un changement', () => {
    const s = createSecretScrubber()
    s.remember('OLD-TOKEN-1234')
    s.remember('  NEW-TOKEN-5678  ')
    s.remember('') // jeton vide : ignoré
    const out = s.scrub('a OLD-TOKEN-1234 b NEW-TOKEN-5678 c authorization: Bearer abc.def')
    expect(out).not.toContain('OLD-TOKEN')
    expect(out).not.toContain('NEW-TOKEN')
    expect(out).not.toContain('abc.def')
    expect(out).toContain('[jeton masqué]')
    expect(out.startsWith('a ')).toBe(true)
  })
})
