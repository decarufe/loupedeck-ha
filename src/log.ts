import { pino, type DestinationStream, type StreamEntry } from 'pino'

export interface Logger {
  debug(msg: string, o?: object): void
  info(msg: string, o?: object): void
  warn(msg: string, o?: object): void
  error(msg: string, o?: object): void
}

/** Chemins masqués par pino, dans le fichier comme dans le terminal. */
const REDACT = ['token', '*.token', 'access_token', 'headers.authorization']

const LEVEL_NAMES: Record<number, string> = { 10: 'TRACE', 20: 'DEBUG', 30: 'INFO ', 40: 'WARN ', 50: 'ERROR', 60: 'FATAL' }

/** Lignes lisibles pour le terminal : `HH:MM:SS NIVEAU message {détails}`. Le fichier garde le JSON de pino. */
const consoleStream: DestinationStream = {
  write(line: string) {
    try {
      const { level, time, msg, ...rest } = JSON.parse(line) as { level: number; time: number; msg?: string }
      const hhmmss = new Date(time).toTimeString().slice(0, 8)
      const details = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : ''
      process.stdout.write(`${hhmmss} ${LEVEL_NAMES[level] ?? level} ${msg ?? ''}${details}\n`)
    } catch {
      process.stdout.write(line)
    }
  },
}

export interface LoggerOptions {
  /** Recopie aussi les journaux dans le terminal (vrai par défaut). */
  stdout?: boolean
  level?: string
}

/**
 * Journal pino. `file` : fichier JSON (dossier créé au besoin, écriture synchrone pour ne rien perdre
 * à l'arrêt) ; `null` : terminal seulement.
 */
export function createLogger(file: string | null, o: LoggerOptions = {}): Logger {
  const level = o.level ?? 'info'
  const streams: StreamEntry[] = []
  if (file) streams.push({ level: 'trace', stream: pino.destination({ dest: file, mkdir: true, sync: true }) })
  if (o.stdout ?? true) streams.push({ level: 'trace', stream: consoleStream })
  const p = pino({ level, base: undefined, redact: REDACT }, pino.multistream(streams))
  return {
    debug: (m, x) => p.debug(x ?? {}, m),
    info: (m, x) => p.info(x ?? {}, m),
    warn: (m, x) => p.warn(x ?? {}, m),
    error: (m, x) => p.error(x ?? {}, m),
  }
}
