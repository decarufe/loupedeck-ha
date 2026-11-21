import fs from 'node:fs/promises'
import path from 'node:path'
import { writeFileAtomic } from './atomic.js'

export class StateStore {
  private constructor(private readonly file: string, private active: number) {}

  static async open(dir: string): Promise<StateStore> {
    const file = path.join(dir, 'state.json')
    let active = 0
    try {
      const v = JSON.parse(await fs.readFile(file, 'utf8'))?.activeButton
      if (Number.isInteger(v) && v >= 0 && v <= 7) active = v
    } catch {
      // fichier absent ou corrompu : on repart de 0
    }
    return new StateStore(file, active)
  }

  activeButton(): number {
    return this.active
  }

  async setActiveButton(i: number): Promise<void> {
    this.active = i
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 })
    await writeFileAtomic(this.file, JSON.stringify({ activeButton: i }))
  }
}
