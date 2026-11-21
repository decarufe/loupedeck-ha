export interface Logger {
  debug(msg: string, o?: object): void
  info(msg: string, o?: object): void
  warn(msg: string, o?: object): void
  error(msg: string, o?: object): void
}
