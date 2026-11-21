import fs from 'node:fs/promises'
import path from 'node:path'
import type { Logger } from '../log.js'
import { writeFileAtomic, chmodBestEffort } from "./atomic.js"
import { appConfigSchema, defaultConfig, type AppConfig } from './schema.js'

const MAX_HISTORY = 50

export class ConfigValidationError extends Error {
  constructor(public issues: string[]) {
    super(`Configuration invalide : ${issues.join('; ')}`)
    this.name = 'ConfigValidationError'
  }
}

function validate(value: unknown): AppConfig {
  const r = appConfigSchema.safeParse(value)
  if (!r.success) {
    throw new ConfigValidationError(r.error.issues.map(i => `${i.path.join('.') || '(racine)'} : ${i.message}`))
  }
  return r.data
}

export class ConfigStore {
  private history: AppConfig[] = []
  private listeners = new Set<(cfg: AppConfig, prev: AppConfig) => void>()

  private constructor(
    private readonly file: string,
    private current: AppConfig,
    readonly loadWarning: string | null,
    private readonly log: Logger,
  ) {}

  static async open(dir: string, log: Logger): Promise<ConfigStore> {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const file = path.join(dir, 'config.json')
    let raw: string | null = null
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    if (raw !== null) await chmodBestEffort(file, 0o600)
    if (raw === null) {
      const store = new ConfigStore(file, defaultConfig(), null, log)
      await store.write(store.current)
      log.info('Configuration créée avec les valeurs par défaut')
      return store
    }
    try {
      return new ConfigStore(file, validate(JSON.parse(raw)), null, log)
    } catch (e) {
      const stamp = new Date().toISOString().replaceAll(':', '-')
      const quarantine = path.join(dir, `config.invalid-${stamp}.json`)
      await fs.rename(file, quarantine)
      await chmodBestEffort(quarantine, 0o600)
      const warning = `Le fichier de configuration était invalide (${(e as Error).message}) ; il a été mis de côté dans ${path.basename(quarantine)}.`
      log.warn(warning)
      const store = new ConfigStore(file, defaultConfig(), warning, log)
      await store.write(store.current)
      return store
    }
  }

  get(): AppConfig {
    return this.current
  }

  async update(next: AppConfig): Promise<void> {
    const valid = structuredClone(validate(next))
    await this.write(valid)
    this.history.push(this.current)
    if (this.history.length > MAX_HISTORY) this.history.shift()
    this.apply(valid)
  }

  async undo(): Promise<boolean> {
    const previous = this.history.pop()
    if (!previous) return false
    try {
      await this.write(previous)
    } catch (e) {
      this.history.push(previous)
      throw e
    }
    this.apply(previous)
    return true
  }

  onChange(cb: (cfg: AppConfig, prev: AppConfig) => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  private apply(cfg: AppConfig): void {
    const prev = this.current
    this.current = cfg
    for (const cb of [...this.listeners]) {
      try {
        cb(cfg, prev)
      } catch (e) {
        this.log.error('Erreur dans un écouteur de configuration', { error: String(e) })
      }
    }
  }

  private async write(cfg: AppConfig): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify(cfg, null, 2))
  }
}
