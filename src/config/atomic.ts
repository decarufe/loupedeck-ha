import fs from 'node:fs/promises'
import crypto from 'node:crypto'

/** Écriture atomique : fichier temporaire unique (flag wx, mode 0o600) puis renommage sur la cible. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  try {
    const fh = await fs.open(tmp, 'wx', 0o600)
    try {
      await fh.writeFile(data)
    } finally {
      await fh.close()
    }
    await fs.rename(tmp, file)
  } catch (e) {
    await fs.unlink(tmp).catch(() => {})
    throw e
  }
}

export async function chmodBestEffort(file: string, mode: number): Promise<void> {
  await fs.chmod(file, mode).catch(() => {})
}
