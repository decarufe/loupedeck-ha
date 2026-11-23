/** Durée d'un appui long sur l'écran tactile. */
export const LONG_PRESS_MS = 1000

/**
 * Distingue l'appui court de l'appui long à partir de `tap` (début du toucher) et `release` (fin).
 * L'appui long part dès que la durée est atteinte, sans attendre la fin du toucher.
 */
export class PressTracker {
  private readonly pending = new Map<string, { timer: ReturnType<typeof setTimeout>; onShort: () => void }>()

  constructor(private readonly holdMs = LONG_PRESS_MS) {}

  press(key: string, onShort: () => void, onLong: () => void): void {
    this.cancel(key)
    const timer = setTimeout(() => {
      this.pending.delete(key)
      onLong()
    }, this.holdMs)
    this.pending.set(key, { timer, onShort })
  }

  release(key: string): void {
    const p = this.pending.get(key)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(key)
    p.onShort()
  }

  cancel(key: string): void {
    const p = this.pending.get(key)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(key)
  }

  clear(): void {
    for (const p of this.pending.values()) clearTimeout(p.timer)
    this.pending.clear()
  }
}

export function targetKey(t: { kind: 'key'; index: number } | { kind: 'strip'; side: 'left' | 'right'; zone: number }): string {
  return t.kind === 'key' ? `key${t.index}` : `strip:${t.side}:${t.zone}`
}
