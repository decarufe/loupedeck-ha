import { describe, expect, it } from 'vitest'
import { isAppToShell, isShellToApp } from '../../src/shared/ipc.js'

describe('ipc', () => {
  it('reconnaît le message ready', () => {
    expect(isAppToShell({ type: 'ready', editorUrl: null })).toBe(true)
    expect(isAppToShell({ type: 'ready', editorUrl: 'http://127.0.0.1:8765/' })).toBe(true)
  })

  it('refuse un ready incomplet ou mal typé', () => {
    expect(isAppToShell({ type: 'ready' })).toBe(false)
    expect(isAppToShell({ type: 'ready', editorUrl: 3 })).toBe(false)
    expect(isAppToShell(null)).toBe(false)
    expect(isAppToShell('ready')).toBe(false)
  })

  it('reconnaît le message stop', () => {
    expect(isShellToApp({ type: 'stop' })).toBe(true)
    expect(isShellToApp({ type: 'ready', editorUrl: null })).toBe(false)
    expect(isShellToApp(undefined)).toBe(false)
  })
})
