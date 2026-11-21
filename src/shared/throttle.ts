/**
 * Limite la cadence d'envoi : premier appel immédiat, puis au plus un envoi par fenêtre de `ms`,
 * le dernier envoi ne portant que la valeur la plus récente.
 */
export function createThrottle<T>(fn: (v: T) => void, ms: number): ((v: T) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { v: T } | null = null

  const endWindow = (): void => {
    timer = null
    if (!pending) return
    const { v } = pending
    pending = null
    // Un envoi de fin de fenêtre ouvre une nouvelle fenêtre.
    timer = setTimeout(endWindow, ms)
    fn(v)
  }

  const throttled = (v: T): void => {
    if (timer) {
      pending = { v }
      return
    }
    timer = setTimeout(endWindow, ms)
    fn(v)
  }

  throttled.cancel = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    pending = null
  }
  return throttled
}
