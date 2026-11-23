import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { configDir } from '../../src/shared/paths.js'

describe('configDir', () => {
  it('utilise APPDATA quand il est défini', () => {
    expect(configDir({ APPDATA: 'C:\A' }, 'C:\H')).toBe(path.join('C:\A', 'loupedeck-ha'))
  })

  it('se replie sur le dossier personnel sans APPDATA', () => {
    expect(configDir({}, 'C:\H')).toBe(path.join('C:\H', '.loupedeck-ha'))
  })
})
