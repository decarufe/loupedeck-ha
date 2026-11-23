import { describe, expect, it } from 'vitest'
import { DEFAULT_EDITOR_PORT, editorUrlFromPort, readEditorPort } from '../../src/shell/editor-url.js'

const file = (content: string) => async () => content
const missing = async (): Promise<string> => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }

describe('URL de l’éditeur', () => {
  it('format de l’URL', () => {
    expect(DEFAULT_EDITOR_PORT).toBe(8765)
    expect(editorUrlFromPort(9000)).toBe('http://127.0.0.1:9000/')
  })

  it('lit editor.port', async () => {
    expect(await readEditorPort('c.json', file('{"editor":{"port":9000}}'))).toBe(9000)
  })

  it('8765 si le fichier est absent ou le port invalide', async () => {
    expect(await readEditorPort('c.json', missing)).toBe(8765)
    for (const content of ['{pas du json', '{"editor":{"port":"9000"}}', '{"editor":{"port":0}}', '{"editor":{"port":70000}}', '{"editor":{"port":80.5}}', '{}', 'null']) {
      expect(await readEditorPort('c.json', file(content))).toBe(8765)
    }
  })
})
