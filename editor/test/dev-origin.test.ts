import { describe, expect, it } from 'vitest'
import { rewriteOrigin } from '../dev-origin'

const DEV = ['http://localhost:5173', 'http://127.0.0.1:5173']
const BACKEND = 'http://127.0.0.1:8765'

describe('rewriteOrigin', () => {
  it('rewrites the dev server origin to the backend', () => {
    expect(rewriteOrigin('http://localhost:5173', DEV, BACKEND)).toBe(BACKEND)
    expect(rewriteOrigin('http://127.0.0.1:5173', DEV, BACKEND)).toBe(BACKEND)
  })
  it('leaves a foreign origin unchanged', () => {
    expect(rewriteOrigin('https://evil.example', DEV, BACKEND)).toBe('https://evil.example')
    expect(rewriteOrigin('http://localhost:9999', DEV, BACKEND)).toBe('http://localhost:9999')
    expect(rewriteOrigin('null', DEV, BACKEND)).toBe('null')
  })
  it('keeps an absent origin absent', () => {
    expect(rewriteOrigin(undefined, DEV, BACKEND)).toBeUndefined()
  })
  it('does not rewrite case or trailing-slash variants', () => {
    expect(rewriteOrigin('HTTP://LOCALHOST:5173', DEV, BACKEND)).toBe('HTTP://LOCALHOST:5173')
    expect(rewriteOrigin('http://localhost:5173/', DEV, BACKEND)).toBe('http://localhost:5173/')
  })
})
