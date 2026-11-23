# Version installable — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** publier le dépôt sur GitHub, puis livrer Loupedeck HA comme application Windows installable (icône de notification, démarrage avec Windows, « À propos ») qui se met à jour seule à chaque fusion sur `main`.

**Architecture :** un processus principal Electron (`src/shell/`) héberge l'icône, le menu, la mise à jour et un superviseur ; le code actuel (`dist/main.js`) tourne inchangé dans un `utilityProcess` et dialogue avec lui par deux messages (`ready`, `stop`). La logique du shell est découpée en modules purs testés avec des faux ; `src/shell/main.ts` n'est que du câblage. electron-builder produit l'installateur NSIS et publie la Release depuis GitHub Actions ; electron-updater la consomme.

**Tech Stack :** TypeScript (NodeNext, ESM), Electron 45.x (Node ≥ 24 à vérifier), electron-builder 26.x, electron-updater 6.x, vitest (pool `vmThreads`), GitHub Actions `windows-latest`, pnpm.

**Spec :** `docs/superpowers/specs/2026-11-22-version-installable-design.md`

## Global Constraints

- **pnpm seulement**, jamais npm/npx, y compris dans le workflow et les scripts.
- Node embarqué par Electron **≥ 24** ; Node du workflow : **26** (celui du poste de développement).
- Dépôt : **`decarufe/loupedeck-ha`**, public, branche par défaut **`main`**. Licence **MIT**.
- Adresse git publiée : **`1083536+decarufe@users.noreply.github.com`** (jamais l'adresse personnelle).
- Configuration et journaux dans **`%APPDATA%\loupedeck-ha`** ; journal du shell : `logs\shell.log` ; état du shell : `shell.json`.
- Version publiée **`0.2.<github.run_number>`**, étiquette **`v0.2.<n>`** ; `package.json` commité : `0.2.0`.
- Relance après plantage : **5000 ms** ; délai d'arrêt propre avant `kill` : **10000 ms**.
- Mises à jour : première vérification **10 s** après le démarrage, puis toutes les **4 h** ; erreurs journalisées sans dialogue ni notification.
- Libellés exacts du menu : `Redémarrer pour installer la version <v>`, `Ouvrir la configuration`, `Démarrer avec Windows`, `À propos…`, `Quitter`.
- Port de l'éditeur par défaut **8765** ; URL `http://127.0.0.1:<port>/`.
- `appId` : **`com.decarufe.loupedeck-ha`** ; `productName` : **`Loupedeck HA`** ; installateur : **`LoupedeckHA-Setup-${version}.exe`**.
- Le jeton Home Assistant n'apparaît jamais dans un journal, un artefact ou une Release.
- `pnpm start` / `pnpm run dev` continuent de lancer l'application sans Electron.

## Review Focus

1. **Plantage en boucle au démarrage** (config illisible → code 1 à chaque essai) : relance toutes les 5 s sans fin, icône toujours utilisable, une ligne de journal par relance. → test dans Task 3.
2. **« Quitter » pendant l'attente de relance** (enfant planté, minuterie de 5 s en cours) : aucune relance, `stop()` se résout tout de suite. → test dans Task 3.
3. **Application qui ne répond pas à `stop`** : tuée après 10 s, « Quitter » aboutit quand même. → test dans Task 3.
4. **PC hors ligne ou GitHub indisponible** pendant une vérification : journal en `warn`, aucune notification, nouvel essai au cycle suivant. → test dans Task 5.
5. **« Démarrer avec Windows » décoché puis relance** : le choix de l'utilisateur n'est jamais réactivé. → test dans Task 4.

---

### Task 1 : Publier le dépôt (historique anonymisé, licence)

Opération sortante et irréversible demandée par l'utilisateur : ne rien pousser tant que les vérifications de l'étape 4 ne sont pas vides.

**Files :**
- Create : `LICENSE`
- Réécrit : tout l'historique de `feat/loupedeck-ha`

- [ ] **Step 1 : Sauvegarde locale** — `git branch backup/avant-publication feat/loupedeck-ha` (jamais poussée).

- [ ] **Step 2 : Écrire le script de remplacement** `<scratchpad>/anonymize.sed` après lecture de `docs/superpowers/notes/2026-11-20-alarmcom-doorbell.md`. Il remplace, dans tous les fichiers texte suivis :
  - les modèles `<modèle de sonnette>`, `<modèle de caméra>`, `<modèle de caméra>` → `<modèle de sonnette>` / `<modèle de caméra>` (la variante `x` avant la courte) ;
  - les entités `camera.exemple_sonnette`, `camera.exemple_avant`, `camera.exemple_arriere` → `camera.exemple_sonnette`, `camera.exemple_avant`, `camera.exemple_arriere` ;
  - dans la note, le paragraphe « Contenu, paragraphe de description retiré » et sa liste → une phrase : « Les images reçues étaient nettes, récentes (heure incrustée à jour) et à la bonne taille. »
  Les noms Tapo et l'opérateur restent (décision de la spec : documents tels quels hors la note).

- [ ] **Step 3 : Réécrire** :
```bash
git filter-branch -f \
  --env-filter 'export GIT_AUTHOR_EMAIL=1083536+decarufe@users.noreply.github.com GIT_COMMITTER_EMAIL=1083536+decarufe@users.noreply.github.com' \
  --tree-filter 'grep -rlE --exclude-dir=.git "<modèle>|camera\.(sonnette|camera_avant|camera_arriere)|paragraphe de description retiré" . | xargs -r sed -i -E -f "<scratchpad>/anonymize.sed"' \
  -- feat/loupedeck-ha
git for-each-ref --format='%(refname)' refs/original | xargs -r -n1 git update-ref -d
git config user.email 1083536+decarufe@users.noreply.github.com
```

- [ ] **Step 4 : Vérifier** (chaque commande doit ne rien afficher) :
```bash
git log --format='%ae%n%ce' feat/loupedeck-ha | sort -u | grep -v '^1083536+decarufe@users.noreply.github.com$'
git grep -nE '<modèle>|camera\.(sonnette|camera_avant|camera_arriere)|paragraphe de description retiré' $(git rev-list feat/loupedeck-ha)
git grep -n '<adresse personnelle>' $(git rev-list feat/loupedeck-ha)
```
Et `git diff backup/avant-publication feat/loupedeck-ha --stat` ne touche que des fichiers `docs/`.

- [ ] **Step 5 : Licence** — `LICENSE` MIT standard, `Copyright (c) 2026 Eric De Carufel` ; `package.json` : `"license": "MIT"`, `"repository": "github:decarufe/loupedeck-ha"`. Commit `chore: licence MIT`.

- [ ] **Step 6 : Créer et pousser** :
```bash
gh repo create decarufe/loupedeck-ha --public --description "Loupedeck Live comme télécommande Home Assistant (Windows)" --source . --remote origin
git push -u origin feat/loupedeck-ha:main
gh repo edit decarufe/loupedeck-ha --default-branch main
git branch -m feat/loupedeck-ha main && git branch -u origin/main main
git branch -D master
git switch -c feat/installable
```
Expected : `gh repo view decarufe/loupedeck-ha --json visibility,defaultBranchRef` → `PUBLIC`, `main`.

---

### Task 2 : Côté application — messages avec le shell

**Files :**
- Create : `src/shared/ipc.ts`, `src/shared/paths.ts`
- Modify : `src/lifecycle.ts`, `src/main.ts`
- Delete : `scripts/install-autostart.ps1`, `scripts/launch-hidden.vbs`, `scripts/test-shortcuts.ps1`, `test/scripts/launch-hidden.test.ts`
- Test : `test/lifecycle.test.ts`, `test/shared/ipc.test.ts`, `test/shared/paths.test.ts`

**Interfaces :**
- Produces :
  - `src/shared/ipc.ts` : `type AppToShell = { type: 'ready'; editorUrl: string | null }`, `type ShellToApp = { type: 'stop' }`, `isAppToShell(x: unknown): x is AppToShell`, `isShellToApp(x: unknown): x is ShellToApp`.
  - `src/shared/paths.ts` : `configDir(env: NodeJS.ProcessEnv, homedir: string): string` → `<APPDATA>\loupedeck-ha`, sinon `<homedir>/.loupedeck-ha` (logique actuelle de `main.ts`).
  - `src/lifecycle.ts` : `interface ParentPortLike { on(event: 'message', l: (e: { data: unknown }) => void): unknown; postMessage(msg: AppToShell): void }` ; `ProcessHandlersOptions.parentPort?: ParentPortLike`.

- [ ] **Step 1 : Tests qui échouent**
  - `lifecycle.test.ts` › `un message { type: 'stop' } du parent arrête proprement et sort à 0` : faux port, émet `{ data: { type: 'stop' } }` → `stop` appelé une fois, `exit(0)`.
  - `lifecycle.test.ts` › `un message inconnu du parent est ignoré` : `{ data: { type: 'x' } }` → ni `stop` ni `exit`.
  - `lifecycle.test.ts` › `stop du parent puis SIGINT : un seul arrêt`.
  - `ipc.test.ts` : `isAppToShell({ type: 'ready', editorUrl: null })` vrai ; `isAppToShell({ type: 'ready' })` faux ; `isShellToApp({ type: 'stop' })` vrai.
  - `paths.test.ts` : `configDir({ APPDATA: 'C:\\A' }, 'C:\\H')` → `path.join('C:\\A', 'loupedeck-ha')` ; sans `APPDATA` → `path.join('C:\\H', '.loupedeck-ha')`.

- [ ] **Step 2 : Lancer** `pnpm exec vitest run test/lifecycle.test.ts test/shared` → FAIL.

- [ ] **Step 3 : Implémenter.** `installProcessHandlers` branche `parentPort.on('message')` sur le même `shutdown` (signal journalisé : `'parent'`). `main.ts` : `const parentPort = (process as { parentPort?: ParentPortLike }).parentPort` passé aux handlers ; après `createApp`, `parentPort?.postMessage({ type: 'ready', editorUrl: app.editorUrl })` ; `configDir` vient de `paths.ts`. Commentaires de `lifecycle.ts`/`main.ts` : « le superviseur du shell » à la place de `launch-hidden.vbs`. Supprimer les quatre fichiers listés.

- [ ] **Step 4 : Lancer** `pnpm test` et `pnpm exec tsc -p . --noEmit` → PASS.

- [ ] **Step 5 : Commit** `feat(shell): messages ready/stop entre l'application et son superviseur`.

---

### Task 3 : Superviseur

**Files :**
- Create : `src/shell/supervisor.ts`
- Test : `test/shell/supervisor.test.ts`

**Interfaces :**
- Consumes : `AppToShell`, `ShellToApp`, `isAppToShell` (Task 2) ; `Logger` (`src/log.ts`).
- Produces :
```ts
export const RESTART_DELAY_MS = 5000
export const STOP_TIMEOUT_MS = 10_000
export interface ChildLike {
  postMessage(msg: ShellToApp): void
  kill(): boolean
  on(event: 'message', l: (msg: unknown) => void): unknown
  on(event: 'exit', l: (code: number) => void): unknown
}
export interface Supervisor {
  start(): void
  stop(): Promise<void>
  editorUrl(): string | null
  onEditorUrl(l: (url: string | null) => void): () => void
}
export function createSupervisor(o: { fork: () => ChildLike; log: Logger; restartDelayMs?: number; stopTimeoutMs?: number }): Supervisor
```

- [ ] **Step 1 : Tests qui échouent** (`vi.useFakeTimers()`, faux enfant = `EventEmitter` avec `postMessage`/`kill` espionnés) :
  - `relance 5000 ms après une sortie à 1` : sortie 1 → `fork` pas rappelé à 4999 ms, rappelé à 5000 ms.
  - `ne relance pas après une sortie à 0`.
  - `relance à chaque plantage successif` : trois sorties à 1 → quatre `fork`, trois lignes `log.warn`.
  - `ready met à jour editorUrl et prévient les abonnés` ; un message non conforme est ignoré.
  - `editorUrl redevient null quand l'enfant sort`.
  - `stop envoie { type: 'stop' } et se résout à la sortie de l'enfant`, sans relance ensuite même si le code est 1.
  - `stop tue l'enfant après 10000 ms sans sortie` et se résout.
  - `stop pendant l'attente de relance annule la relance et se résout tout de suite`.
  - `stop appelé deux fois : un seul message stop`.

- [ ] **Step 2 : Lancer** `pnpm exec vitest run test/shell/supervisor.test.ts` → FAIL.

- [ ] **Step 3 : Implémenter `createSupervisor`** dans `src/shell/supervisor.ts` (aucun import `electron`).

- [ ] **Step 4 : Lancer** le test → PASS.

- [ ] **Step 5 : Commit** `feat(shell): superviseur avec relance après plantage et arrêt propre`.

---

### Task 4 : Modules purs du shell — menu, « À propos », URL de l'éditeur, démarrage avec Windows, ancienne installation

**Files :**
- Create : `src/shell/menu.ts`, `src/shell/about.ts`, `src/shell/editor-url.ts`, `src/shell/autostart.ts`, `src/shell/legacy.ts`
- Test : `test/shell/menu.test.ts`, `test/shell/about.test.ts`, `test/shell/editor-url.test.ts`, `test/shell/autostart.test.ts`, `test/shell/legacy.test.ts`

**Interfaces (Produces)** — `electron` seulement en `import type` :
```ts
// menu.ts
export interface MenuState { autostart: boolean; autostartAvailable: boolean; updateVersion: string | null }
export interface MenuHandlers { openEditor(): void; toggleAutostart(next: boolean): void; about(): void; quit(): void; installUpdate(): void }
export function buildMenuTemplate(s: MenuState, h: MenuHandlers): MenuItemConstructorOptions[]
// about.ts
export const REPO_URL = 'https://github.com/decarufe/loupedeck-ha'
export type AboutChoice = 'logs' | 'github' | 'close'
export function aboutDialogOptions(version: string): MessageBoxOptions
export function aboutChoice(response: number): AboutChoice
// editor-url.ts
export const DEFAULT_EDITOR_PORT = 8765
export function editorUrlFromPort(port: number): string
export async function readEditorPort(configPath: string, readFile?: (p: string) => Promise<string>): Promise<number>
// autostart.ts
export interface LoginItems { get(): boolean; set(openAtLogin: boolean): void }
export async function initAutostart(o: { statePath: string; login: LoginItems; log: Logger }): Promise<void>
// legacy.ts
export const LEGACY_TASK = 'Loupedeck HA'
export const LEGACY_SHORTCUT = 'Loupedeck HA – Configuration.url'
export interface LegacyDeps {
  run(cmd: string, args: string[]): Promise<{ code: number }>
  exists(p: string): Promise<boolean>
  unlink(p: string): Promise<void>
  desktopDir: string; startMenuDir: string; log: Logger
}
export async function removeLegacyInstall(d: LegacyDeps): Promise<{ task: boolean; shortcuts: string[] }>
```

- [ ] **Step 1 : Tests qui échouent**
  - menu : sans mise à jour → libellés `['Ouvrir la configuration', 'Démarrer avec Windows', 'À propos…', <séparateur>, 'Quitter']` ; avec `updateVersion: '0.2.14'` → première entrée `Redémarrer pour installer la version 0.2.14` suivie d'un séparateur ; la case est `type: 'checkbox'`, `checked` = `autostart`, `enabled` = `autostartAvailable` ; cliquer la case appelle `toggleAutostart(!autostart)` ; chaque entrée appelle son handler.
  - about : `aboutDialogOptions('0.2.7')` → `buttons` = `['Ouvrir les journaux', 'Page GitHub', 'Fermer']`, `defaultId` 2, `cancelId` 2, `message` `'Loupedeck HA'`, `detail` contient `Version 0.2.7` et `REPO_URL` ; `aboutChoice(0|1|2|-1)` → `logs`, `github`, `close`, `close`.
  - editor-url : `editorUrlFromPort(9000)` → `http://127.0.0.1:9000/` ; `readEditorPort` → 9000 pour `{"editor":{"port":9000}}` ; 8765 pour fichier absent (rejet ENOENT), JSON invalide, `port` = `"9000"`, `0`, `70000`, `80.5`.
  - autostart : premier lancement (pas de `shell.json`) → `login.set(true)`, fichier écrit `{"autostartInitialized":true}` ; deuxième lancement avec `get()` faux → `set` jamais appelé ; `shell.json` illisible → traité comme premier lancement, sans exception.
  - legacy : `schtasks /Query /TN "Loupedeck HA"` code 0 → `schtasks /Delete /TN "Loupedeck HA" /F` appelé, `task: true` ; code 1 → pas de suppression, `task: false`, pas d'exception ; les deux raccourcis présents → supprimés et listés ; `run` qui rejette → journalisé, `task: false`, pas d'exception.

- [ ] **Step 2 : Lancer** `pnpm exec vitest run test/shell` → FAIL.

- [ ] **Step 3 : Implémenter** les cinq modules. `run` reçoit les arguments séparés (`['/Query', '/TN', 'Loupedeck HA']`), sans shell.

- [ ] **Step 4 : Lancer** `pnpm exec vitest run test/shell` → PASS.

- [ ] **Step 5 : Commit** `feat(shell): menu, à propos, démarrage avec Windows et retrait de l'ancienne installation`.

---

### Task 5 : Contrôleur de mise à jour

**Files :**
- Create : `src/shell/updater.ts`
- Test : `test/shell/updater.test.ts`

**Interfaces :**
- Produces :
```ts
export const UPDATE_INITIAL_DELAY_MS = 10_000
export const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  on(event: 'update-downloaded', l: (info: { version: string }) => void): unknown
  on(event: 'error', l: (err: Error) => void): unknown
}
export function startUpdateChecks(o: { updater: UpdaterLike; log: Logger; onDownloaded(version: string): void }): () => void
```

- [ ] **Step 1 : Tests qui échouent** (minuteries simulées) :
  - `règle autoDownload et autoInstallOnAppQuit à true`.
  - `première vérification à 10 s, puis toutes les 4 h` (0 appel à 9999 ms, 1 à 10000, 2 à 10000 + 4 h).
  - `checkForUpdates rejeté (hors ligne) : log.warn, onDownloaded jamais appelé, nouvel essai au cycle suivant`.
  - `événement error : log.warn, pas d'exception`.
  - `update-downloaded 0.2.9 deux fois : onDownloaded appelé une seule fois avec '0.2.9'`.
  - `la fonction retournée arrête les vérifications`.

- [ ] **Step 2 : Lancer** → FAIL. **Step 3 : Implémenter.** **Step 4 : Lancer** → PASS.

- [ ] **Step 5 : Commit** `feat(shell): vérification périodique des mises à jour`.

---

### Task 6 : Câblage Electron, icône et installateur local

**Files :**
- Create : `src/shell/main.ts`, `electron-builder.yml`, `scripts/make-icon.ts`, `build/icon.ico`
- Modify : `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `pnpm-lock.yaml`, `.vscode/launch.json`

**Interfaces :**
- Consumes : tout ce que produisent les Tasks 2 à 5.

- [ ] **Step 1 : Dépendances** — `pnpm add electron-updater@^6.8.11` ; `pnpm add -D electron@^45.4.1 electron-builder@^26.18.0` ; `pnpm-workspace.yaml` › `allowBuilds` : ajouter `electron: true`. Si electron-builder ne récupère pas correctement les dépendances avec la structure pnpm (vérifié à l'étape 6), régler `nodeLinker: hoisted` dans `pnpm-workspace.yaml` et relancer `pnpm install`.

- [ ] **Step 2 : `package.json`** — `"version": "0.2.0"`, `"main": "dist/shell/main.js"`, `"description": "Loupedeck Live comme télécommande Home Assistant"`, `"author": "decarufe"` ; scripts `"app": "pnpm run build && electron ."`, `"package": "pnpm run build && electron-builder --win --publish never"`, `"icon": "tsx scripts/make-icon.ts"`. `.gitignore` : `release`.

- [ ] **Step 3 : Icône** — `scripts/make-icon.ts` dessine avec `@napi-rs/canvas` (évocation d'une console à touches, couleurs Home Assistant, lisible à 16 px) et écrit `build/icon.ico` contenant des entrées PNG 16, 24, 32, 48, 64, 128, 256 (en-tête ICONDIR + ICONDIRENTRY, données PNG brutes). `pnpm run icon` ; commiter `build/icon.ico`.

- [ ] **Step 4 : `electron-builder.yml`**
```yaml
appId: com.decarufe.loupedeck-ha
productName: Loupedeck HA
directories: { output: release, buildResources: build }
files: [dist/**, editor/dist/**, build/icon.ico, package.json]
asar: false        # modules natifs et fichiers de l'éditeur lus tels quels
npmRebuild: false  # serialport et @napi-rs/canvas sont N-API
win:
  target: [{ target: nsis, arch: [x64] }]
  icon: build/icon.ico
  artifactName: LoupedeckHA-Setup-${version}.${ext}
nsis: { oneClick: true, perMachine: false, deleteAppDataOnUninstall: false, shortcutName: Loupedeck HA }
publish: { provider: github, owner: decarufe, repo: loupedeck-ha, releaseType: release }
```

- [ ] **Step 5 : `src/shell/main.ts`** — câblage seulement :
  - `app.requestSingleInstanceLock()` faux → `app.quit()` ; `second-instance` → ouvrir l'éditeur.
  - `app.setAppUserModelId('com.decarufe.loupedeck-ha')` ; journal `createLogger(<configDir>/logs/shell.log)` ; `configDir(process.env, os.homedir())`.
  - Si `app.isPackaged` : `removeLegacyInstall` (`execFile` sans shell, `app.getPath('desktop')`, `%APPDATA%\Microsoft\Windows\Start Menu\Programs`), puis `initAutostart` (`statePath` = `<configDir>/shell.json`, `LoginItems` sur `app.get/setLoginItemSettings`), puis `startUpdateChecks` avec l'`autoUpdater` d'`electron-updater` (paquet CJS : `import updater from 'electron-updater'; const { autoUpdater } = updater`).
  - Superviseur : `fork = () => utilityProcess.fork(path.join(app.getAppPath(), 'dist', 'main.js'), [], { serviceName: 'Loupedeck HA' })`, démarré au `ready`.
  - `Tray(path.join(app.getAppPath(), 'build', 'icon.ico'))`, info-bulle `Loupedeck HA`, clic gauche = ouvrir l'éditeur, menu reconstruit par `buildMenuTemplate` à chaque changement d'état (case, mise à jour). `autostartAvailable` = `app.isPackaged`.
  - Ouvrir l'éditeur : `shell.openExternal(supervisor.editorUrl() ?? editorUrlFromPort(await readEditorPort(<configDir>/config.json)))`.
  - « À propos » : `dialog.showMessageBox(aboutDialogOptions(app.getVersion()))` puis `aboutChoice` → `shell.openPath(<configDir>/logs)` ou `shell.openExternal(REPO_URL)`.
  - Mise à jour téléchargée : état du menu + `new Notification({ title: 'Loupedeck HA', body: 'Version <v> prête — redémarrer pour installer' }).show()`.
  - « Quitter » et `before-quit` : une seule fois, `await supervisor.stop()` puis `app.exit(0)`. « Redémarrer pour installer » : `await supervisor.stop()` puis `autoUpdater.quitAndInstall(true, true)`.
  - Fermeture de session : une `BrowserWindow` jamais affichée (`show: false`) écoute `session-end` et appelle `supervisor.stop()`. `window-all-closed` ne quitte pas l'application.

- [ ] **Step 6 : Vérifier localement**
  - `pnpm exec tsc -p . --noEmit` et `pnpm test` → PASS.
  - `pnpm run package` → `release/LoupedeckHA-Setup-0.2.0.exe` et `release/win-unpacked/`.
  - Présents dans `release/win-unpacked/resources/app/` : `dist/main.js`, `dist/shell/main.js`, `editor/dist/index.html`, `node_modules/@serialport/bindings-cpp/prebuilds/win32-x64/`, `node_modules/@napi-rs/canvas-win32-x64-msvc/`.
  - `release\win-unpacked\Loupedeck HA.exe` lancé **après avoir arrêté toute autre instance** : l'icône apparaît ; `logs\app.log` montre « Loupedeck HA démarré » ; une ligne de `shell.log` note `process.versions.node` (≥ 24) ; « Ouvrir la configuration » ouvre l'éditeur ; « À propos… » affiche `Version 0.2.0` ; « Quitter » éteint la console et ferme l'icône ; un second lancement pendant que la première instance tourne ouvre seulement l'éditeur.
  - `.vscode/launch.json` : ajouter une configuration « Run Script: app » (`pnpm run app`).

- [ ] **Step 7 : Commit** `feat(shell): application Electron dans la zone de notification et installateur`.

---

### Task 7 : Workflow GitHub Actions

**Files :**
- Create : `.github/workflows/build.yml`, `.github/dependabot.yml`

- [ ] **Step 1 : Écrire le workflow**, en trois jobs (durcissement demandé par la revue de sécurité : le code des dépendances ne voit jamais de jeton capable de publier) :
  - `check` (PR et push, Windows) : checkout (`persist-credentials: false`), pnpm, Node 26 avec cache pnpm, `pnpm install --frozen-lockfile`, `pnpm exec tsc -p . --noEmit`, `pnpm test`, `pnpm run build`.
  - `package` (push sur `main` seulement, `needs: check`, `permissions: contents: read`, Windows) : mêmes préparatifs, `pnpm run build`, `pnpm exec electron-builder --win --publish never -c.extraMetadata.version=0.2.${{ github.run_number }}`, puis `actions/upload-artifact` de `release/LoupedeckHA-Setup-*.exe`, `release/LoupedeckHA-Setup-*.exe.blockmap` et `release/latest.yml` (`if-no-files-found: error`).
  - `publish` (`needs: package`, `permissions: contents: write`, `concurrency: { group: release, cancel-in-progress: false }`, Ubuntu) : aucun checkout ni code de dépendance ; `actions/download-artifact`, puis `gh release create v0.2.${{ github.run_number }} <fichiers> --repo ${{ github.repository }} --target ${{ github.sha }} --title "v0.2.${{ github.run_number }}" --generate-notes` avec `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
  - Le `latest.yml` produit par `--publish never` nomme `LoupedeckHA-Setup-<version>.exe`, comme l'asset de la Release ; le bloc `publish:` d'`electron-builder.yml` reste en place, car il génère `resources/app-update.yml` (provider github, `decarufe/loupedeck-ha`) lu par electron-updater.
  - Chaque `uses:` est épinglé sur le SHA complet du commit de sa version, version en commentaire (`# v7.0.1`) ; SHA obtenus par `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, tags annotés déréférencés jusqu'au commit.

- [ ] **Step 2 : `.github/dependabot.yml`** — `package-ecosystem: github-actions`, `directory: /`, `interval: weekly`, pour tenir les SHA à jour.

- [ ] **Step 3 : Vérifier la syntaxe** — `pnpm dlx @action-validator/cli .github/workflows/build.yml` → aucune erreur (cet outil ne connaît pas le format Dependabot : ne pas l'appliquer à `dependabot.yml`).

- [ ] **Step 4 : Commit** `ci: vérification des PR et release à chaque fusion sur main`.

---

### Task 8 : README

**Files :**
- Modify : `README.md`

- [ ] **Step 1 : Réorganiser** selon la section 7.9 de la spec : présentation ; **Installation** (lien `https://github.com/decarufe/loupedeck-ha/releases/latest`, `LoupedeckHA-Setup-x.y.z.exe`, SmartScreen « Informations complémentaires → Exécuter quand même », libérer la console, jeton HA) ; **Utilisation** (menu de l'icône avec les libellés exacts, éditeur — contenu actuel conservé —, démarrage avec Windows, mises à jour automatiques, journaux `app.log` et `shell.log`) ; **Dépannage** (contenu actuel sans la tâche planifiée) ; **Passer de la version du dépôt à la version installée** (ancienne tâche et raccourcis retirés automatiquement, configuration reprise) ; **Contribuer** (Node ≥ 24, pnpm, `pnpm install`, `pnpm run build`, `pnpm start`, `pnpm run dev`, `pnpm run editor:dev`, `pnpm run app`, `pnpm test`, `pnpm run package`, quitter la version installée avant de lancer celle du dépôt, cycle PR → fusion → release `v0.2.<n>`) ; **Licence** MIT. Plus aucune mention de `install-autostart.ps1`, `launch-hidden.vbs`, `test-shortcuts.ps1`.

- [ ] **Step 2 : Vérifier** — `grep -nE "install-autostart|launch-hidden|test-shortcuts|npm |npx " README.md` → rien.

- [ ] **Step 3 : Commit** `docs(readme): installation depuis les Releases, section Contribuer`.

---

### Task 9 : Pull request, première release, mise à jour de bout en bout

- [ ] **Step 1 :** `git push -u origin feat/installable` puis `gh pr create --base main` (description finissant par la ligne d'attribution). Le job `check` passe.
- [ ] **Step 2 :** fusion **par l'utilisateur** (ou sur son accord explicite). Le job `release` publie `v0.2.<n>` avec `LoupedeckHA-Setup-0.2.<n>.exe`, `.blockmap` et `latest.yml` : `gh release view --repo decarufe/loupedeck-ha`.
- [ ] **Step 3 :** l'utilisateur installe cette release ; vérifier l'icône, la reprise de sa configuration, la case « Démarrer avec Windows » cochée, l'absence de la tâche « Loupedeck HA » (`schtasks /Query /TN "Loupedeck HA"` → introuvable).
- [ ] **Step 4 :** une deuxième fusion (petit changement de doc) publie `v0.2.<n+1>` ; dans les 4 h ou au redémarrage de l'application installée, la notification et l'entrée « Redémarrer pour installer la version 0.2.<n+1> » apparaissent ; après clic, « À propos… » affiche la nouvelle version et la configuration est intacte.
