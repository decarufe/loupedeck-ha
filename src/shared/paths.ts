import path from 'node:path'

/** Dossier de configuration et des journaux : `%APPDATA%\loupedeck-ha`, sinon `~/.loupedeck-ha`. */
export function configDir(env: NodeJS.ProcessEnv, homedir: string): string {
  return env.APPDATA ? path.join(env.APPDATA, 'loupedeck-ha') : path.join(homedir, '.loupedeck-ha')
}
