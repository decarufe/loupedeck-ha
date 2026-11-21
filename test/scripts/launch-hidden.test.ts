import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const VBS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'launch-hidden.vbs')

/**
 * Faux main.js : chaque lancement ajoute un caractère au journal, puis sort avec le code suivant de la liste.
 * Le lanceur reçoit le script et une pause courte (paramètres réservés aux tests).
 */
async function runLauncher(dir: string, codes: number[]): Promise<{ runs: number; exit: number | null }> {
  const script = path.join(dir, 'fake-main.mjs')
  const journal = path.join(dir, 'runs.txt')
  await fs.writeFile(script, `
    import fs from 'node:fs'
    const codes = ${JSON.stringify(codes)}
    const runs = fs.existsSync(${JSON.stringify(journal)}) ? fs.readFileSync(${JSON.stringify(journal)}, 'utf8').length : 0
    fs.appendFileSync(${JSON.stringify(journal)}, 'x')
    process.exit(codes[Math.min(runs, codes.length - 1)])
  `)
  const exit = await new Promise<number | null>((resolve, reject) => {
    const child = spawn('cscript', ['//nologo', VBS, script, '50'], { windowsHide: true })
    let output = ''
    child.stdout.on('data', (d) => { output += String(d) })
    child.stderr.on('data', (d) => { output += String(d) })
    const timer = setTimeout(() => { child.kill(); reject(new Error(`le lanceur ne s’est pas arrêté : ${output}`)) }, 20_000)
    child.on('error', reject)
    child.on('exit', (code) => { clearTimeout(timer); resolve(code) })
  })
  const runs = (await fs.readFile(journal, 'utf8')).length
  return { runs, exit }
}

describe.runIf(process.platform === 'win32')('launch-hidden.vbs', () => {
  let dir: string
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lha-vbs-')) })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  it('relaunches_after_a_crash_until_a_voluntary_exit', async () => {
    const r = await runLauncher(dir, [1, 3, 0])
    expect(r.runs).toBe(3)
    expect(r.exit).toBe(0)
  }, 30_000)

  it('voluntary_exit_0_stops_the_loop', async () => {
    const r = await runLauncher(dir, [0])
    expect(r.runs).toBe(1)
  }, 30_000)
})
