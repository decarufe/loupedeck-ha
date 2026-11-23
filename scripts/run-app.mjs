// Lance la version Electron depuis le dépôt (pnpm run app). Retire ELECTRON_RUN_AS_NODE, hérité des
// terminaux ouverts par certains outils (extensions VS Code) : avec cette variable, Electron tourne comme
// un simple Node et le shell ne peut pas démarrer.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const electron = createRequire(import.meta.url)('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: false })
child.on('close', (code) => process.exit(code ?? 1))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
