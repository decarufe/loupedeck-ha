# Loupedeck Live × Home Assistant — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** une application Node.js / TypeScript, sous Windows, qui fait de la Loupedeck Live une télécommande Home Assistant à 7 tableaux de bord : Lumières, Température, Météo et 4 Caméras. Sa disposition se configure dans un éditeur web local.

**Architecture :** un seul processus. Il se compose de :
- **DeviceLink** : enveloppe `loupedeck` avec délais d'expiration, reconnexion et file de dessin à différentiel ;
- **HaClient** : WebSocket Home Assistant + REST caméra ;
- **Actions** : limitation de débit, états optimistes, garde hors ligne ;
- **Dashboards** : produisent des *vues* pures, que les *painters* dessinent sur une surface 480 × 270 ;
- **Navigator** : boutons ronds, LED, routage des entrées ;
- **ConfigStore** : JSON atomique avec historique d'annulation ;
- **EditorServer** : Fastify sur 127.0.0.1 ;
- **l'éditeur** : une interface Vue 3.

La même fonction de dessin produit le RGB565 pour la console et le PNG pour l'aperçu.

**Tech Stack :**
- Node 24 LTS, TypeScript (strict, ESM), Vitest ;
- `loupedeck` ^7.2.1, `@napi-rs/canvas`, `@mdi/js`, `home-assistant-js-websocket`, `ws`, `zod`, `fastify` (+ `@fastify/static`, `@fastify/websocket`), `pino` ;
- éditeur : Vue 3, Vite, `@vue/test-utils`, `jsdom`.

**Spec :** [docs/superpowers/specs/2026-11-20-loupedeck-home-assistant-design.md](../specs/2026-11-20-loupedeck-home-assistant-design.md)

## Global Constraints

### Plateforme et dépendances

- Windows 11, **Node 24 LTS**, TypeScript `strict`, ESM (`"type": "module"`).
- `loupedeck` v7.x utilisé **tel quel, sans fork**. Un contournement s'écrit dans une enveloppe, jamais en modifiant la librairie.
- **Ne jamais appeler `drawCanvas` de foxxyz.** On envoie des buffers RGB565 little-endian via `drawBuffer`.
- Bibliothèque de dessin : `@napi-rs/canvas`, qui s'installe sans compilateur sous Windows x64.
- Si `npm ci` échoue sur le module `canvas` (dépendance de `loupedeck`), ajouter dans `package.json` : `"overrides": { "canvas": "file:./stubs/canvas" }`, avec un paquet vide `stubs/canvas` (`package.json` + `index.js` qui exporte `{}`). La librairie n'en a besoin que pour `drawCanvas`.

### Console

- Plein écran : `drawBuffer({ id: 'left', x, y, width, height, autoRefresh: false }, buf)`, puis **un seul** `refresh('left')` par image. `left` n'a pas de décalage et partage le framebuffer `M`.
- Coordonnées sur l'écran de 480 × 270 :
  - touche `i` : `x = 60 + (i % 4) * 90`, `y = floor(i / 4) * 90`, 90 × 90 ;
  - bande gauche : `x = 0`, 60 × 270 ;
  - bande droite : `x = 420`, 60 × 270 ;
  - zone de bande `z` : `y = z * 90`, 60 × 90.
- Molettes : à gauche `knobTL`, `knobCL`, `knobBL` (zones 0, 1, 2), à droite `knobTR`, `knobCR`, `knobBR` (zones 0, 1, 2). Boutons ronds : ids `0`–`7`.
- Vibrations : `ok` = `HAPTIC.SHORT` (`0x01`), `error` = `HAPTIC.DESCEND_FAST` (`0x48`). **Jamais `HAPTIC.VERY_LONG` (`0x76`).**
- Luminosité : pleine (`1`) par défaut, **aucune mise en veille ni atténuation automatique**.

### Home Assistant et éditeur

- Éditeur : écoute sur **`127.0.0.1` uniquement**. Le jeton Home Assistant n'est **jamais** renvoyé au navigateur ni écrit dans les journaux.
- URL Home Assistant par défaut : `http://homeassistant.local:8123`, l'adresse locale. `https://hass.decarufel.net` est accepté. Le WebSocket utilise `ws://` ou `wss://` selon le protocole de l'URL.
- Le certificat auto-signé n'est accepté que si `ha.allowSelfSigned` vaut `true`.

### Délais et valeurs fixés par la spec

| Paramètre | Valeur |
|---|---|
| Limitation des appels venant des molettes | **200 ms**, premier et dernier envoi |
| Priorité de la valeur locale après la dernière rotation | **1500 ms** |
| Attente de confirmation après une bascule | **3000 ms**, puis retour à l'état HA + vibration `error` |
| Pas de consigne | **0,5 °C**, sauf si `target_temp_step` est défini ; bornes `min_temp`/`max_temp` |
| Pas de gradation par cran de molette | **5 %** (choix de Claude) |
| Intervalle caméra par défaut | **1000 ms**, entre 250 et 2000 |
| Image caméra périmée | après **5000 ms** sans nouvelle image : niveaux de gris + LED rouge clignotante |
| Météo | rafraîchie à chaque changement d'état de l'entité et toutes les **30 min** tant que le tableau est actif |

### Fichiers

- Configuration : `%APPDATA%\loupedeck-ha\config.json`, avec écriture atomique (`.tmp` puis renommage).
- État (tableau actif) : `state.json`, à part.
- Journaux : `%APPDATA%\loupedeck-ha\logs\app.log`.

### Langue

Toute l'interface est en français : console, éditeur, messages d'erreur.

## Review Focus

1. **Console occupée par le logiciel officiel au démarrage.** `connect()` ne se résout jamais. L'application doit journaliser « Fermez le logiciel Loupedeck », réessayer avec un délai croissant sans jamais rester bloquée, et se connecter dès que le port se libère. Test : Task 5, `connect_timeout_retries`.
2. **Câble USB débranché pendant un dessin.** La promesse de `drawBuffer` ne se résout jamais. La file de dessin doit se libérer, la console passer à « déconnectée » et l'image complète être redessinée à la reconnexion. Test : Task 5, `draw_timeout_frees_queue`.
3. **Jeton Home Assistant invalide ou révoqué.** Statut `offline` / `auth`, **sans boucle de reconnexion**. L'éditeur affiche « Jeton invalide ». Test : Task 6, `auth_invalid_no_retry`.
4. **Entité configurée puis supprimée ou renommée dans Home Assistant.** La touche affiche « Introuvable », sans plantage. Test : Task 8, `missing_entity_tile`.
5. **`config.json` corrompu ou modifié à la main de façon invalide.** On le renomme en `config.invalid-<horodatage>.json` sans l'écraser, on démarre avec la configuration par défaut et on affiche un avertissement dans l'éditeur. Test : Task 2, `corrupt_config_quarantined`.

---

## Structure des fichiers

```text
package.json · tsconfig.json · vitest.config.ts · README.md
src/
  main.ts                 point d'entrée (APPDATA, logger, signaux)
  app.ts                  câblage des composants, réaction aux changements de config
  log.ts                  Logger (pino, masquage du jeton)
  config/schema.ts        schéma zod, types, defaultConfig()
  config/store.ts         ConfigStore (atomique, historique, quarantaine)
  config/state.ts         StateStore (tableau actif)
  shared/placement.ts     isDimmable(), canPlace() — partagé avec l'éditeur
  shared/throttle.ts      createThrottle()
  shared/format.ts        formatTemp(), formatPct(), libellés FR
  device/regions.ts       Rect, REGIONS, keyRect(), stripZoneRect()
  device/input.ts         InputEvent, normalizeInput()
  device/link.ts          DeviceLink, findLivePath()
  ha/types.ts             HaPort, HaEntity, HaStatus, Forecast, EntityInfo
  ha/client.ts            HaClient
  ha/actions.ts           Actions
  render/surface.ts       Surface, createSurface(), toRgb565(), toPng()
  render/icons.ts         iconPath(), drawIcon(), weatherIcon()
  render/painters.ts      paint(surface, view)
  views.ts                TileView, GridView, WeatherView, FullView, View
  dashboards/types.ts     Dashboard, DashboardDeps
  dashboards/lights.ts · climate.ts · weather.ts · camera.ts · factory.ts
  camera/source.ts        CameraSource, createHaProxySource()
  navigator.ts            Navigator
  editor/server.ts        startEditorServer()
editor/                   application Vue 3 (Vite), compilée dans editor/dist
scripts/spike-throughput.ts · install-autostart.ps1 · launch-hidden.vbs
test/                     même arborescence que src/ ; test/fakes/ (FakeHa, FakeDevice, mock HA server)
docs/superpowers/notes/   résultats des essais
```

---

### Task 1 : Squelette du projet et essai de débit de la console

**Files :**
- Create : `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `scripts/spike-throughput.ts`, `docs/superpowers/notes/2026-11-20-spike-throughput.md`
- Test : `test/smoke.test.ts`

**Interfaces :**
- Produces :
  - scripts npm `build` (`tsc -p .`), `dev` (`tsx watch src/main.ts`), `start` (`node dist/main.js`), `test` (`vitest run`), `spike` (`tsx scripts/spike-throughput.ts`) ;
  - `tsconfig` : `module`/`moduleResolution` `NodeNext`, `outDir` `dist`, `rootDir` `.` ; inclut `src` et `scripts`.

- [ ] **Step 1 : Écrire `test/smoke.test.ts`.** Il importe `LoupedeckLive` depuis `loupedeck` et `createCanvas` depuis `@napi-rs/canvas`, puis vérifie :

```ts
expect(LoupedeckLive.productId).toBe(0x0004)
expect(LoupedeckLive.vendorId).toBe(0x2ec2)
expect(createCanvas(480, 270).width).toBe(480)
```

- [ ] **Step 2 :** `npm init`, puis installer les dépendances listées dans Tech Stack (dev : `typescript`, `tsx`, `vitest`, `@types/node`, `@types/ws`). Lancer `npm test` : PASS. Si l'installation de `canvas` échoue, appliquer le remède décrit dans Global Constraints.
- [ ] **Step 3 : Écrire `scripts/spike-throughput.ts`, un script jetable.**
  - Il trouve la Live par `LoupedeckLive.list()` (VID `0x2ec2`, PID `0x0004`) et se connecte avec `new LoupedeckLive({ path, autoConnect: false })`.
  - Il affiche `getInfo()` (numéro de série et firmware).
  - Il mesure pendant 10 s :
    - **(a)** plein écran : `drawBuffer({id:'left',x:0,y:0,width:480,height:270,autoRefresh:false})` + `refresh('left')` avec des couleurs qui alternent ;
    - **(b)** une touche de 90 × 90 en boucle.
  - Il affiche les images/s de chaque mesure.
- [ ] **Step 4 : Exécuter l'essai sur la vraie console** (`npm run spike`), logiciel Loupedeck fermé.
  - Noter dans `docs/superpowers/notes/2026-11-20-spike-throughput.md` le firmware, les images/s en plein écran, les images/s par touche, et toute erreur.
  - Si la console est introuvable ou que le port est occupé, s'arrêter et demander à l'utilisateur de la brancher ou de fermer le logiciel officiel.
  - Si le firmware est 0.2.26 et que les dessins échouent, le noter et prévenir l'utilisateur (spec §12, point 8).
- [ ] **Step 5 : Fixer `FULL_FRAME_THRESHOLD`.**
  - D'après les mesures, choisir la valeur que la Task 5 utilisera : le nombre de régions modifiées à partir duquel on envoie le plein écran. Valeur par défaut : 7 sur 14.
  - Noter dans le fichier de résultats si la cible caméra d'une image/s est atteignable.
- [ ] **Step 6 : Commit.** Avec `.gitignore` : `node_modules`, `dist`, `editor/dist`.

```bash
git add -A && git commit -m "chore: squelette du projet et essai de débit de la console"
```

---

### Task 2 : Configuration, état et règles de placement

**Files :**
- Create : `src/config/schema.ts`, `src/config/store.ts`, `src/config/state.ts`, `src/shared/placement.ts`
- Test : `test/config/store.test.ts`, `test/config/state.test.ts`, `test/shared/placement.test.ts`

**Interfaces :**
- Produces (`src/config/schema.ts`) :

```ts
export const KNOB_IDS = ['knobTL','knobCL','knobBL','knobTR','knobCR','knobBR'] as const
export type KnobId = typeof KNOB_IDS[number]
export interface KeySlot { entityId: string; label?: string; icon?: string }
export interface LightsDashboard  { type:'lights';  name:string; color:string; keys:(KeySlot|null)[] /*12*/; dimmers:Record<KnobId, KeySlot|null> }
export interface ClimateDashboard { type:'climate'; name:string; color:string; entityId:string|null; setpointKnob:KnobId /*'knobTR'*/; sensors:KeySlot[] /*≤4*/ }
export interface WeatherDashboard { type:'weather'; name:string; color:string; entityId:string|null }
export interface CameraDashboard  { type:'camera';  name:string; color:string; entityId:string|null; source:'ha-proxy'; intervalMs:number /*1000, 250..2000*/ }
export type DashboardConfig = LightsDashboard | ClimateDashboard | WeatherDashboard | CameraDashboard
export interface AppConfig {
  version: 1
  ha: { url: string; token: string; allowSelfSigned: boolean }
  device: { path: string | null; brightness: number /*0..1, défaut 1*/ }
  editor: { port: number /*défaut 8765*/ }
  buttons: (DashboardConfig | null)[] /*exactement 8*/
}
export const appConfigSchema: z.ZodType<AppConfig>
export function defaultConfig(): AppConfig
export function emptyDashboard(type: DashboardConfig['type'], index: number): DashboardConfig
```

- Produces (`src/config/store.ts`) :

```ts
export class ConfigValidationError extends Error { issues: string[] }
export class ConfigStore {
  static open(dir: string, log: Logger): Promise<ConfigStore>
  get(): AppConfig
  update(next: AppConfig): Promise<void>       // valide, historique (max 50), écriture atomique, notifie
  undo(): Promise<boolean>                     // false si rien à annuler
  onChange(cb: (cfg: AppConfig, prev: AppConfig) => void): () => void
  readonly loadWarning: string | null
}
```

- Produces (`src/config/state.ts`) : `class StateStore { static open(dir): Promise<StateStore>; activeButton(): number; setActiveButton(i: number): Promise<void> }`. Valeur par défaut : `0`. Si le fichier est corrompu, on repart de `0`.
- Produces (`src/shared/placement.ts`) :

```ts
export interface EntityInfo { entityId:string; name:string; domain:string; areaName:string|null; state:string; dimmable:boolean; deviceClass:string|null; icon:string|null }
export type SlotKind = 'key' | 'dimmer' | 'climate' | 'sensor' | 'weather' | 'camera'
export function isDimmable(attributes: Record<string, unknown>): boolean
export function canPlace(kind: SlotKind, e: EntityInfo): { ok: true } | { ok: false; reason: string }
```

- Consumes : `Logger` (Task 13 le définit dans `src/log.ts`). Pour l'instant, déclarer dans `src/log.ts` le type `export interface Logger { debug(msg:string, o?:object):void; info(...):void; warn(...):void; error(...):void }`. La Task 13 y ajoutera l'implémentation pino.

- [ ] **Step 1 : Écrire les tests de placement** (`test/shared/placement.test.ts`).

```ts
expect(isDimmable({ supported_color_modes: ['onoff'] })).toBe(false)
expect(isDimmable({ supported_color_modes: ['brightness'] })).toBe(true)
expect(isDimmable({ supported_color_modes: ['onoff','color_temp'] })).toBe(true)
expect(isDimmable({ brightness: null })).toBe(false)              // une lampe éteinte : brightness est null
expect(canPlace('key', ent({ domain:'switch' })).ok).toBe(true)
expect(canPlace('key', ent({ domain:'sensor' })).ok).toBe(false)
expect(canPlace('dimmer', ent({ domain:'light', dimmable:false })))
  .toEqual({ ok:false, reason:"Cette lumière n'est pas gradable : placez-la sur une touche centrale." })
expect(canPlace('sensor', ent({ domain:'sensor', deviceClass:'temperature' })).ok).toBe(true)
expect(canPlace('camera', ent({ domain:'camera' })).ok).toBe(true)
```

  Règles :
  - `key` : domaine `light` ou `switch` ;
  - `dimmer` : `light` gradable ;
  - `climate` : `climate` ;
  - `sensor` : `sensor` avec `deviceClass` `temperature` ;
  - `weather` : `weather` ;
  - `camera` : `camera`.

  Chaque refus a une raison en français.
- [ ] **Step 2 : Écrire les tests du store** (`test/config/store.test.ts`), dans un dossier temporaire.
  - `missing_file_writes_defaults` : `open()` sur un dossier vide écrit `config.json`, qui contient bien `defaultConfig()`.
  - `defaults_layout` :
    - `buttons[0].type` vaut `'lights'`, `[1]` `'climate'`, `[2]` `'weather'`, `[3..6]` `'camera'`, `[7]` `null` ;
    - `device.brightness` vaut `1`, `ha.url` vaut `'http://homeassistant.local:8123'`.
  - `corrupt_config_quarantined` :
    - on écrit `"{oops"` dans `config.json`, puis on appelle `open()` ;
    - il existe alors un fichier `config.invalid-*.json` dont le contenu est `"{oops"` ;
    - `get()` renvoie la configuration par défaut et `loadWarning` contient `'invalide'`.
  - `update_rejects_invalid` : `update({...cfg, buttons: []})` lève `ConfigValidationError` et le fichier sur disque est inchangé.
  - `update_is_atomic` : après `update`, aucun `config.json.tmp` ne reste et le fichier relu vaut la nouvelle configuration.
  - `undo_restores_previous` : deux `update`, puis `undo()` renvoie `true` et `get()` vaut le premier ; un `undo()` de plus renvoie `true`, le suivant `false`.
  - `onChange_fires_with_prev`.
- [ ] **Step 3 :** Lancer `npx vitest run test/config test/shared` : FAIL (modules absents).
- [ ] **Step 4 : Implémenter** `schema.ts`, `store.ts`, `state.ts` et `placement.ts` selon les interfaces.
  - Couleurs par défaut : Lumières `#FFB300`, Température `#FF5722`, Météo `#03A9F4`, Caméras `#9C27B0`.
  - Noms par défaut : `Lumières`, `Température`, `Météo`, `Caméra 1` à `Caméra 4`.
  - L'horodatage de quarantaine est au format ISO, avec `:` remplacé par `-`.
- [ ] **Step 5 :** Lancer `npx vitest run test/config test/shared` : PASS.
- [ ] **Step 6 :** `git add src/config src/shared/placement.ts src/log.ts test/config test/shared && git commit -m "feat: configuration, état et règles de placement"`

---

### Task 3 : Surface de dessin, régions et icônes

**Files :**
- Create : `src/device/regions.ts`, `src/render/surface.ts`, `src/render/icons.ts`
- Test : `test/device/regions.test.ts`, `test/render/surface.test.ts`, `test/render/icons.test.ts`

**Interfaces :**
- Produces :

```ts
// regions.ts
export interface Rect { x:number; y:number; width:number; height:number }
export type RegionId = `key${number}` | 'stripL' | 'stripR'
export const SCREEN: Rect                      // {0,0,480,270}
export const REGIONS: Record<RegionId, Rect>   // 14 entrées : key0..key11, stripL, stripR
export function keyRect(i: number): Rect
export function stripZoneRect(side: 'left'|'right', zone: 0|1|2): Rect
// surface.ts
export interface Surface { canvas: Canvas; ctx: SKRSContext2D }
export function createSurface(): Surface        // 480×270, fond noir
export function toRgb565(s: Surface, r: Rect): Buffer   // LE, longueur w*h*2
export function toPng(s: Surface): Promise<Buffer>
// icons.ts
export function iconPath(name: string | null): string | null   // 'mdi:lightbulb' → chemin SVG de @mdi/js (mdiLightbulb)
export function drawIcon(ctx: SKRSContext2D, name: string|null, x:number, y:number, size:number, color:string): boolean
export function weatherIcon(condition: string): string          // condition HA → 'mdi:weather-…'
```

- [ ] **Step 1 : Écrire les tests.**

```ts
expect(keyRect(5)).toEqual({ x:150, y:90, width:90, height:90 })
expect(keyRect(11)).toEqual({ x:330, y:180, width:90, height:90 })
expect(stripZoneRect('right', 2)).toEqual({ x:420, y:180, width:60, height:90 })
expect(Object.keys(REGIONS)).toHaveLength(14)
// toRgb565 : remplir un pixel 1×1 à (0,0) puis lire le Rect {0,0,1,1}
red   → [0x00, 0xF8];  green (#00FF00) → [0xE0, 0x07];  white → [0xFF, 0xFF]
expect(toRgb565(createSurface(), keyRect(0)).length).toBe(90*90*2)
expect((await toPng(createSurface())).subarray(0,4)).toEqual(Buffer.from([0x89,0x50,0x4E,0x47]))
expect(iconPath('mdi:lightbulb')).toBe(mdiLightbulb)
expect(iconPath('mdi:does-not-exist')).toBeNull()
expect(weatherIcon('partlycloudy')).toBe('mdi:weather-partly-cloudy')
expect(weatherIcon('clear-night')).toBe('mdi:weather-night')
expect(weatherIcon('inconnu')).toBe('mdi:weather-cloudy-alert')
```

- [ ] **Step 2 :** Lancer `npx vitest run test/device/regions.test.ts test/render` : FAIL.
- [ ] **Step 3 : Implémenter.**
  - `toRgb565` : lit `getImageData` puis convertit pixel par pixel, `((r>>3)<<11)|((g>>2)<<5)|(b>>3)`, écrit avec `writeUInt16LE`.
  - `iconPath` : convertit le kebab-case en `mdi` + PascalCase, puis cherche dans `@mdi/js`.
  - `drawIcon` : utilise `Path2D` à l'échelle `size/24`.
  - `weatherIcon` couvre les 15 conditions HA : `clear-night`, `cloudy`, `exceptional`, `fog`, `hail`, `lightning`, `lightning-rainy`, `partlycloudy`, `pouring`, `rainy`, `snowy`, `snowy-rainy`, `sunny`, `windy`, `windy-variant`.
- [ ] **Step 4 :** Relancer : PASS.
- [ ] **Step 5 :** `git commit -m "feat: surface de dessin, régions et icônes"` (avec les fichiers ci-dessus).

---

### Task 4 : Vues et painters

**Files :**
- Create : `src/views.ts`, `src/shared/format.ts`, `src/render/painters.ts`
- Test : `test/render/painters.test.ts`, `test/shared/format.test.ts`

**Interfaces :**
- Consumes : `Surface`, `createSurface`, `keyRect`, `stripZoneRect`, `drawIcon` (Task 3).
- Produces :

```ts
// views.ts
export type TileState = 'on' | 'off' | 'unavailable' | 'missing' | 'empty'
export interface TileView { label:string; icon:string|null; state:TileState; valueText:string|null; level:number|null /*0..1*/; pending:boolean; accent:string }
export const EMPTY_TILE: TileView                 // state 'empty', label ''
export interface GridView    { kind:'grid'; keys:TileView[] /*12*/; left:TileView[] /*3*/; right:TileView[] /*3*/; offline:boolean }
export interface WeatherDay  { label:string; icon:string; high:string; low:string }
export interface WeatherView { kind:'weather'; current:{ icon:string; temperature:string; apparent:string|null; condition:string } | null; days:WeatherDay[] /*≤8*/; message:string|null; offline:boolean }
export interface FullView    { kind:'full'; image:Buffer|null; message:string|null; stale:boolean; offline:boolean }
export type View = GridView | WeatherView | FullView
// format.ts
export function formatTemp(v: number | null | undefined): string   // 19.5 → '19,5 °C' ; null → '—'
export function formatPct(v: number): string                       // 60 → '60 %'
export const HVAC_LABELS: Record<string,string>   // heat:'Chauffage', cool:'Climatisation', off:'Arrêt', heat_cool:'Auto', auto:'Auto', dry:'Déshumidif.', fan_only:'Ventilation'
export const CONDITION_LABELS: Record<string,string>  // les 15 conditions HA en français (partlycloudy:'Partiellement nuageux', …)
// painters.ts
export const COLORS: { off:'#202020'; empty:'#000000'; unavailable:'#3A3A3A'; bar:'#FFFFFF' }
export function paint(s: Surface, v: View): Promise<void>
```

- [ ] **Step 1 : Écrire les tests.** On échantillonne les pixels avec `ctx.getImageData(x,y,1,1)`.
  - `grid_on_tile_uses_accent` : `keys[0]` dans l'état `on` avec l'accent `#FFB300` ; le pixel (64, 4) vaut `[255,179,0]`.
  - `grid_off_tile` : `state:'off'` ; le pixel (64, 4) vaut `[0x20,0x20,0x20]`.
  - `grid_offline_desaturates` : la même tuile `on` avec `offline:true` ; au pixel (64, 4), on a `r===g===b`.
  - `dimmer_level_bar` :
    - `left[1]` vaut `{state:'on', level:0.6}` ;
    - la barre est horizontale, de 6 px de haut, collée en bas de la zone ; elle commence à x = zone.x + 4, sa largeur vaut `round(level*52)` et sa couleur `COLORS.bar` ;
    - le pixel `(4+26, 90+90-3)` est blanc ;
    - le pixel `(4+45, 177)` ne l'est pas.
  - `full_image_scaled` : un JPEG rouge de 960 × 540 (créé avec `@napi-rs/canvas`) ; le pixel (240, 135) est rouge (r > 200, g < 50).
  - `full_stale_grayscale` : la même image avec `stale:true` ; au pixel (240, 135), `r===g===b`.
  - `full_invalid_jpeg_shows_message` : `image: Buffer.from('nope')` ; `paint` ne lève pas d'exception et des pixels non noirs apparaissent dans la bande de texte centrale (y entre 120 et 150).
  - `weather_paints_current` : une `WeatherView` avec `current` ; des pixels non noirs dans la rangée 0 (y < 90).
  - Format :
    - `formatTemp(19.5) === '19,5 °C'`, `formatTemp(21) === '21,0 °C'`, `formatTemp(null) === '—'` ;
    - `formatPct(60) === '60 %'`.
- [ ] **Step 2 :** Lancer `npx vitest run test/render/painters.test.ts test/shared/format.test.ts` : FAIL.
- [ ] **Step 3 : Implémenter `paint`.**
  - **Grille.**
    - Fond de tuile selon `state`, accent si `on`.
    - Icône de 36 px en haut, puis le libellé (12 px), puis `valueText` (14 px gras).
    - `pending` : bordure pointillée de 2 px.
    - `missing` et `unavailable` : texte gris.
    - Les zones de bande suivent la même logique sur 60 × 90, avec la barre de niveau.
    - `offline` : on dessine normalement, puis on désature tout l'écran (luminance) et on ajoute la pastille « HA hors ligne » en haut de la bande gauche, sur 60 × 18 px, fond `#B00020`.
  - **Météo.**
    - La rangée 0 (360 × 90, à x = 60) affiche les conditions actuelles : icône de 64 px, température en 32 px, libellé de la condition et ressenti.
    - Les rangées 1 et 2 affichent jusqu'à 8 jours, dans les 8 cellules de touches : jour, icône de 32 px, max/min.
    - `message` : un texte centré remplace les jours.
  - **Plein écran.**
    - L'image est décodée avec `loadImage` et étirée en « cover » sur 480 × 270.
    - `stale` : désaturation.
    - Si l'image manque ou ne se décode pas, fond noir et `message ?? 'Image non disponible'` en blanc, centré.
- [ ] **Step 4 :** Relancer : PASS.
- [ ] **Step 5 :** `git commit -m "feat: vues et painters"`

---

### Task 5 : DeviceLink, l'enveloppe fiable de la console

**Files :**
- Create : `src/device/input.ts`, `src/device/link.ts`, `test/fakes/fake-device.ts`
- Test : `test/device/input.test.ts`, `test/device/link.test.ts`

**Interfaces :**
- Consumes : `REGIONS`, `SCREEN`, `Rect` (Task 3) ; `Surface`, `toRgb565` (Task 3) ; `KnobId` (Task 2) ; `Logger`.
- Produces :

```ts
// input.ts
export type TapTarget = { kind:'key'; index:number } | { kind:'strip'; side:'left'|'right'; zone:0|1|2 }
export type InputEvent =
  | { type:'button'; id:number } | { type:'knobTurn'; knob:KnobId; delta:number }
  | { type:'knobPress'; knob:KnobId } | { type:'tap'; target:TapTarget }
export function normalizeInput(event: 'down'|'up'|'rotate'|'touchstart'|'touchmove'|'touchend', payload: any): InputEvent | null
// link.ts
export interface LoupedeckLike {
  on(e: string, cb: (p: any) => void): unknown
  removeAllListeners(): unknown
  connect(): Promise<unknown>; close(): unknown
  drawBuffer(o: { id:'left'; x:number; y:number; width:number; height:number; autoRefresh:false }, b: Buffer): Promise<unknown> | undefined
  refresh(id: 'left'): Promise<unknown> | undefined
  setButtonColor(o: { id:number; color:string }): Promise<unknown> | undefined
  setBrightness(v: number): Promise<unknown> | undefined
  vibrate(p: number): Promise<unknown> | undefined
  getInfo(): Promise<{ serial:string; version:string }>
  reconnectInterval: number
}
export interface DeviceLinkOptions {
  createDevice: () => Promise<LoupedeckLike>   // trouve le chemin et construit avec autoConnect:false, reconnectInterval:0
  log: Logger; connectTimeoutMs?: number /*5000*/; drawTimeoutMs?: number /*2000*/
  retryDelaysMs?: number[] /*[1000,2000,5000,10000,30000], le dernier se répète*/; fullFrameThreshold?: number /*Task 1, défaut 7*/
}
export type DeviceStatus = 'connected' | 'disconnected'
export class DeviceLink {
  constructor(o: DeviceLinkOptions)
  start(): void; stop(): Promise<void>
  status(): DeviceStatus; firmware(): string | null
  onInput(cb: (e: InputEvent) => void): () => void
  onStatus(cb: (s: DeviceStatus) => void): () => void
  present(s: Surface): void
  setLed(id: number, color: string): void
  setBrightness(v: number): void
  vibrate(kind: 'ok' | 'error'): void
}
export function findLivePath(list: { path:string; vendorId:number; productId:number }[], configured: string | null): string | null
export function createLoupedeckFactory(configuredPath: string | null): () => Promise<LoupedeckLike>
```

- [ ] **Step 1 : Écrire `test/fakes/fake-device.ts`.**
  - `FakeDevice` est un `EventEmitter` qui implémente `LoupedeckLike`.
  - Le comportement de `connect` est réglable : `'resolve'`, `'hang'` ou `'reject'`.
  - Le comportement de `drawBuffer` est réglable : il se résout tout de suite, ou reste pendant via un déclencheur manuel.
  - Chaque appel est enregistré dans `calls: {method, args}[]`.
- [ ] **Step 2 : Écrire `test/device/input.test.ts`.**

```ts
expect(normalizeInput('down', { id: 3 })).toEqual({ type:'button', id:3 })
expect(normalizeInput('down', { id: 'knobCL' })).toEqual({ type:'knobPress', knob:'knobCL' })
expect(normalizeInput('down', { id: 'knobCT' })).toBeNull()
expect(normalizeInput('up', { id: 3 })).toBeNull()
expect(normalizeInput('rotate', { id:'knobTR', delta:-1 })).toEqual({ type:'knobTurn', knob:'knobTR', delta:-1 })
expect(normalizeInput('touchstart', { changedTouches:[{ x:30, y:200, id:1, target:{ screen:'left' } }] }))
  .toEqual({ type:'tap', target:{ kind:'strip', side:'left', zone:2 } })
expect(normalizeInput('touchstart', { changedTouches:[{ x:150, y:100, id:1, target:{ screen:'center', key:5 } }] }))
  .toEqual({ type:'tap', target:{ kind:'key', index:5 } })
expect(normalizeInput('touchmove', { changedTouches:[] })).toBeNull()
```

  Une coordonnée `y = 270` donne la zone 2 (valeur bornée).
- [ ] **Step 3 : Écrire `test/device/link.test.ts`,** avec les fausses horloges de vitest.
  - `connect_timeout_retries` :
    - le premier `connect` reste pendant ; on avance de 5000 ms ;
    - `status()` vaut `'disconnected'` et `log.warn` a reçu un message contenant `'Fermez le logiciel Loupedeck'` ;
    - le deuxième appareil se connecte ; après 1000 ms de plus, `status()` vaut `'connected'` et `onStatus` a émis `'connected'`.
  - `retry_backoff_caps` : une série d'échecs fait attendre successivement 1000, 2000, 5000, 10000, 30000, puis 30000 ms.
  - `double_disconnect_single_retry` : l'appareil émet `disconnect` deux fois et une seule reconnexion est programmée.
  - `first_present_full_frame` :
    - le premier `present()` après la connexion appelle `drawBuffer` une seule fois, avec `{id:'left',x:0,y:0,width:480,height:270,autoRefresh:false}` ;
    - puis `refresh('left')` est appelé une seule fois.
  - `diff_only_changed_key` : le deuxième `present()` ne modifie que `keyRect(3)` ; un seul `drawBuffer`, avec `{x:330,y:0,width:90,height:90}`, puis un `refresh`.
  - `coalesce_while_drawing` : avec `drawBuffer` en attente, trois `present()` (A, B, C) ; une fois le dessin libéré, il ne reste qu'un seul cycle supplémentaire, qui contient les pixels de C.
  - `draw_timeout_frees_queue` :
    - `drawBuffer` reste pendant ; on avance de 2000 ms ;
    - `status()` vaut `'disconnected'` et une reconnexion est programmée ;
    - après la reconnexion, le `present()` suivant envoie à nouveau le plein écran.
  - `reapply_state_on_reconnect` : `setLed(2,'#FF0000')` et `setBrightness(1)` avant une déconnexion ; à la reconnexion, `setButtonColor({id:2,color:'#FF0000'})` et `setBrightness(1)` sont réappliqués.
  - `vibrate_patterns` : `vibrate('ok')` donne `vibrate(0x01)`, `vibrate('error')` donne `vibrate(0x48)`, et aucun appel ne porte `0x76`.
  - `sync_throw_is_caught` : un `drawBuffer` qui lève une exception synchrone ne fait pas planter l'application ; l'erreur est journalisée et le lien passe à `'disconnected'`.
  - `findLivePath` :
    - il renvoie le chemin correspondant à vendor `0x2ec2` + product `0x0004` ;
    - il ignore `0x1532` ;
    - un chemin configuré est renvoyé tel quel ;
    - une liste vide donne `null`.
- [ ] **Step 4 :** Lancer `npx vitest run test/device` : FAIL.
- [ ] **Step 5 : Implémenter.**
  - `createDevice()` est entouré de `Promise.race` avec un délai d'expiration de `connectTimeoutMs`. En cas d'échec, `close()` est appelé dans un `try`, les écouteurs sont retirés, puis la tentative suivante est programmée.
  - Sur chaque `present()`, l'algorithme est le suivant :

```text
present(surface): mémorise surface comme `pending` ; si aucun dessin en cours → drain()
drain(): tant que pending :
  s = pending ; pending = null
  bufs = toRgb565 de chaque REGION ; changed = régions dont buf ≠ lastSent (tout si lastSent vide)
  si changed.length ≥ fullFrameThreshold → une seule écriture SCREEN
  sinon → une écriture par région changée
  chaque écriture et le refresh('left') final sont enveloppés d'un délai drawTimeoutMs
  succès → lastSent = bufs ; délai dépassé ou exception → lastSent vidé, markDisconnected()
```

  - Les LED et la luminosité sont mémorisées dans un cache, réappliqué à chaque `connect`.
  - `firmware()` vient de `getInfo().version`, lu après la connexion. Un échec de cette lecture n'est pas fatal.
- [ ] **Step 6 :** Relancer `npx vitest run test/device` : PASS.
- [ ] **Step 7 :** `git commit -m "feat: DeviceLink avec délais, reconnexion et dessin différentiel"`

---

### Task 6 : HaClient, la connexion à Home Assistant

**Files :**
- Create : `src/ha/types.ts`, `src/ha/client.ts`, `test/fakes/fake-ha.ts`, `test/fakes/mock-ha-server.ts`
- Test : `test/ha/client.test.ts`

**Interfaces :**
- Consumes : `EntityInfo`, `isDimmable` (Task 2) ; `Logger`.
- Produces :

```ts
// types.ts
export interface HaEntity { entity_id:string; state:string; attributes:Record<string, any> }
export interface HaStatus { state:'connecting'|'online'|'offline'; reason:'auth'|'network'|null }
export interface Forecast { datetime:string; condition:string; temperature:number; templow:number|null }
export type ForecastType = 'daily' | 'twice_daily' | 'hourly'
export class CameraImageError extends Error {}
export interface HaPort {
  status(): HaStatus
  entities(): Record<string, HaEntity>
  onEntities(cb: (e: Record<string, HaEntity>) => void): () => void
  onStatus(cb: (s: HaStatus) => void): () => void
  callService(domain:string, service:string, data?:object, target?:{ entity_id:string }): Promise<void>
  getForecasts(entityId:string, type:ForecastType): Promise<Forecast[]>
  listEntityInfo(): Promise<EntityInfo[]>
  fetchCameraImage(entityId:string, size:{ width:number; height:number }): Promise<Buffer>
  close(): void
}
// client.ts
export function toWebSocketUrl(httpUrl: string): string
export class HaClient implements HaPort { constructor(o: { url:string; token:string; allowSelfSigned:boolean; log:Logger }); start(): void }
// fake-ha.ts (tests uniquement)
export class FakeHa implements HaPort {
  calls: { domain:string; service:string; data?:object; target?:object }[]
  setEntity(id:string, state:string, attributes?:object): void   // notifie onEntities
  removeEntity(id:string): void
  setStatus(s: HaStatus): void
  forecasts: Forecast[]; forecastError: Error | null
  cameraImage: Buffer | Error
}
```

- [ ] **Step 1 : Écrire `test/fakes/mock-ha-server.ts`.**
  - C'est un `WebSocketServer` du paquet `ws` sur un port libre, plus un serveur HTTP pour `/api/camera_proxy/...`.
  - Il envoie `auth_required`, puis répond `auth_ok` (bon jeton) ou `auth_invalid`.
  - Messages gérés :
    - `subscribe_entities` → `result`, puis `event:{ a:{ 'light.salon':{ s:'on', a:{ brightness:153 } } } }` ;
    - `call_service` → `result` ;
    - `call_service` avec `return_response:true` sur `weather.get_forecasts` → `result:{ response:{ [id]:{ forecast:[...] } } }` ;
    - `config/entity_registry/list`, `config/device_registry/list`, `config/area_registry/list` → données de test ;
    - `ping` → `pong`.
  - Il compte les connexions dans `connections`.
- [ ] **Step 2 : Écrire `test/ha/client.test.ts`.**
  - `ws_url` :
    - `toWebSocketUrl('https://hass.example:8123/')` vaut `'wss://hass.example:8123/api/websocket'` ;
    - `toWebSocketUrl('http://homeassistant.local:8123')` vaut `'ws://homeassistant.local:8123/api/websocket'`.
  - `auth_ok_populates_entities` : `status()` passe à `{state:'online',reason:null}` et `entities()['light.salon'].attributes.brightness` vaut `153`.
  - `auth_invalid_no_retry` :
    - avec un mauvais jeton, `status()` vaut `{state:'offline',reason:'auth'}` ;
    - on attend 3 s en temps réel (ou un délai de reconnexion injecté à 100 ms) ;
    - `server.connections` vaut toujours `1`.
  - `network_drop_reconnects` : le serveur coupe la socket ; on passe par l'état `offline`/`network`, puis à nouveau `online`.
  - `call_service_message` : `callService('light','toggle',undefined,{entity_id:'light.salon'})` envoie `{type:'call_service',domain:'light',service:'toggle',target:{entity_id:'light.salon'}}`.
  - `forecasts_return_response` : la requête porte `return_response:true` et `service_data:{type:'daily'}`, et la fonction renvoie le tableau `forecast`.
  - `entity_info_joins_registries` :
    - `listEntityInfo()` renvoie pour `light.salon` `{areaName:'Salon', dimmable:true, domain:'light'}` ;
    - la pièce vient de l'appareil quand l'entité n'en a pas.
  - `camera_fetch_auth_header` :
    - le serveur reçoit `GET /api/camera_proxy/camera.porte?width=480&height=270` avec `authorization: Bearer <jeton>` ;
    - une réponse 500 ou un `content-type: text/html` lève `CameraImageError`.
  - `token_never_logged` : après tous les scénarios, aucun appel au logger espion ne contient le jeton, même en JSON.
- [ ] **Step 3 :** Lancer `npx vitest run test/ha/client.test.ts` : FAIL.
- [ ] **Step 4 : Implémenter `HaClient`** avec `home-assistant-js-websocket`.
  - **`createSocket` maison** passé à `createConnection` :
    - socket du paquet `ws` avec `{ rejectUnauthorized: !allowSelfSigned }` ;
    - négociation `auth_required` → `auth` → `auth_ok` ;
    - sur `auth_invalid`, rejet avec `ERR_INVALID_AUTH`.
  - **Abonnement** aux entités avec `subscribeEntities`.
  - **Événements** de la connexion :
    - `ready` → `online` ;
    - `disconnected` → `offline` / `network` ;
    - `reconnect-error` portant `ERR_INVALID_AUTH` → `offline` / `auth`, puis `conn.close()`, sans nouvelle tentative.
  - **Échec initial** de `createConnection` :
    - si l'authentification est refusée, on reste `offline` / `auth` ;
    - sinon on réessaie toutes les 5 s.
  - **`callService`** et **`getForecasts`** passent par `callService(conn, …, returnResponse)` de la librairie.
  - **`fetchCameraImage`** utilise `fetch` avec une limite de 5 s (`AbortSignal.timeout(5000)`) et `dispatcher: new Agent({ connect: { rejectUnauthorized: false } })` d'`undici` si `allowSelfSigned`.
  - **Jamais de jeton dans un message de journal.**
  - **`FakeHa`** implémente `HaPort` en mémoire.
- [ ] **Step 5 :** Relancer : PASS.
- [ ] **Step 6 :** `git commit -m "feat: client Home Assistant (WebSocket, services, caméra)"`

---

### Task 7 : Actions (limitation de débit, états optimistes, garde hors ligne)

**Files :**
- Create : `src/shared/throttle.ts`, `src/ha/actions.ts`
- Test : `test/shared/throttle.test.ts`, `test/ha/actions.test.ts`

**Interfaces :**
- Consumes : `HaPort`, `FakeHa` (Task 6).
- Produces :

```ts
export function createThrottle<T>(fn: (v: T) => void, ms: number): (v: T) => void   // premier et dernier envoi
export interface Overlay { pending:boolean; brightnessPct?:number; temperature?:number }
export class Actions {
  constructor(d: { ha: HaPort; feedback: (k: 'ok'|'error') => void; throttleMs?: number /*200*/; confirmTimeoutMs?: number /*3000*/; holdMs?: number /*1500*/ })
  toggle(entityId: string): void
  setBrightness(entityId: string, pct: number): void
  setTemperature(entityId: string, value: number): void
  setHvacMode(entityId: string, mode: string): void
  overlay(entityId: string): Overlay
  onChange(cb: () => void): () => void
  dispose(): void
}
```

- [ ] **Step 1 : Écrire les tests,** avec les fausses horloges.
  - `throttle_leading_trailing` :
    - appels à t = 0 (1), 50 (2), 100 (3), 150 (4), avec un délai de 200 ms ;
    - `fn` est appelée avec 1 à t = 0 et avec 4 à t = 200, soit exactement 2 appels.
  - `offline_guard` : avec `FakeHa` à `offline`, `toggle('light.a')` ne fait aucun `calls` et appelle `feedback('error')`.
  - `toggle_pending_then_confirmed` :
    - `toggle('light.a')` donne `calls[0]` = `{domain:'light',service:'toggle',target:{entity_id:'light.a'}}` et appelle `feedback('ok')` ;
    - `overlay().pending` vaut `true` ;
    - un `setEntity('light.a','off')` le fait repasser à `false`.
  - `toggle_timeout_reverts` : sans changement d'état au bout de 3000 ms, `pending` vaut `false`, `feedback('error')` est appelé et `onChange` se déclenche.
  - `switch_toggle_domain` : `toggle('switch.b')` appelle le service `switch` / `toggle`.
  - `brightness_throttled` :
    - `setBrightness` avec 10, 20, 30, 40 à t = 0, 50, 100, 150 ;
    - deux appels `light.turn_on` : `{brightness_pct:10}` à t = 0, puis `{brightness_pct:40}` à t = 200 ;
    - `overlay().brightnessPct` vaut `40` tout de suite, puis `undefined` à t = 150 + 1500.
  - `brightness_zero_turns_off` : `setBrightness('light.a', 0)` appelle `light` / `turn_off`.
  - `brightness_clamped` : 130 donne `brightness_pct:100`.
  - `temperature_throttled` : `setTemperature('climate.t', 19.5)` envoie `climate` / `set_temperature`, `{temperature:19.5}` ; `overlay().temperature` vaut `19.5`.
  - `hvac_mode` : `setHvacMode('climate.t','cool')` envoie `climate` / `set_hvac_mode`, `{hvac_mode:'cool'}`.
  - `service_rejection_feedback` : si `callService` rejette, `feedback('error')` est appelé.
- [ ] **Step 2 :** Lancer `npx vitest run test/shared/throttle.test.ts test/ha/actions.test.ts` : FAIL.
- [ ] **Step 3 : Implémenter.** Il y a une limitation de débit par couple (entité, type d'action). La confirmation d'une bascule est détectée quand `entities()[id].state` diffère de l'état mémorisé au moment de l'envoi.
- [ ] **Step 4 :** Relancer : PASS.
- [ ] **Step 5 :** `git commit -m "feat: actions limitées, optimistes et protégées hors ligne"`

---

### Task 8 : Tableau Lumières

**Files :**
- Create : `src/dashboards/types.ts`, `src/dashboards/lights.ts`
- Test : `test/dashboards/lights.test.ts`

**Interfaces :**
- Consumes : `LightsDashboard`, `KnobId`, `KNOB_IDS` (Task 2) ; `GridView`, `TileView`, `EMPTY_TILE`, `formatPct` (Task 4) ; `InputEvent` (Task 5) ; `HaPort` (Task 6) ; `Actions` (Task 7).
- Produces :

```ts
// types.ts
export interface DashboardDeps { ha: HaPort; actions: Actions; requestRender: () => void }
export interface Dashboard { view(): View; handle(e: InputEvent): void; activate(): void; deactivate(): void }
// lights.ts
export const DIM_STEP_PCT = 5
export function createLightsDashboard(cfg: LightsDashboard, d: DashboardDeps): Dashboard
```

- [ ] **Step 1 : Écrire les tests,** avec `FakeHa` et de vraies `Actions` (fausses horloges).
  - `on_light_tile` :
    - `light.salon` est `on` avec `brightness:153` et `friendly_name:'Salon'` ;
    - `keys[0]` vaut `{state:'on', label:'Salon', valueText:'60 %', accent:cfg.color}` ;
    - si `slot.label` est défini, il remplace `friendly_name`.
  - `switch_tile` : `switch.hall` est `on` ; la tuile vaut `{state:'on', valueText:null}`.
  - `missing_entity_tile` : l'entité est absente de `entities()` ; la tuile vaut `{state:'missing', label:'light.ghost', valueText:'Introuvable'}`, sans exception.
  - `unavailable_tile` : l'état `unavailable` donne `{state:'unavailable', valueText:'Indisponible'}`.
  - `tap_key_toggles` : un appui sur la touche 0 envoie `light.toggle` pour `light.salon`. Un appui sur une touche vide n'envoie rien.
  - `strip_order` :
    - `view().left` vaut `[TL, CL, BL]` et `view().right` vaut `[TR, CR, BR]`, d'après `dimmers` ;
    - une zone vide vaut `EMPTY_TILE`.
  - `knob_dims` :
    - `knobCL` est associée à `light.cuisine`, allumée à 60 % ;
    - un `knobTurn` de +1 appelle `setBrightness(…, 65)`, un `knobTurn` de −2 appelle `setBrightness(…, 50)` ;
    - pour une lampe éteinte (`brightness:null`), +1 donne 5 ;
    - à 100 %, +1 donne 100.
  - `knob_uses_overlay` : deux crans rapides de +1 en partant de 60 donnent 65 puis 70, parce qu'on part de `overlay().brightnessPct` quand il est défini.
  - `knob_press_and_strip_tap_toggle` : un `knobPress` sur `knobCL` et un appui sur la zone 1 de la bande gauche envoient chacun `light.toggle`.
  - `unassigned_knob_noop`.
  - `offline_flag` : quand `FakeHa` est `offline`, `view().offline` vaut `true`.
  - `rerender_on_entities` : un `setEntity` appelle `requestRender` (abonnement fait dans `activate`, retiré dans `deactivate`).
- [ ] **Step 2 :** Lancer `npx vitest run test/dashboards/lights.test.ts` : FAIL.
- [ ] **Step 3 : Implémenter.**
  - Le niveau d'une tuile gradable vaut `brightnessPct/100`, et `valueText` vaut `formatPct`.
  - `pending` vient de `actions.overlay`.
  - Icône : `slot.icon`, sinon `attributes.icon`, sinon `mdi:lightbulb` pour une lampe allumée, `mdi:lightbulb-outline` pour une lampe éteinte, et `mdi:toggle-switch` / `mdi:toggle-switch-off-outline` pour un interrupteur.
- [ ] **Step 4 :** Relancer : PASS.
- [ ] **Step 5 :** `git commit -m "feat: tableau Lumières"`

---

### Task 9 : Tableau Température

**Files :**
- Create : `src/dashboards/climate.ts`
- Test : `test/dashboards/climate.test.ts`

**Interfaces :**
- Consumes : `ClimateDashboard` (Task 2) ; `Dashboard`, `DashboardDeps` (Task 8) ; `formatTemp`, `HVAC_LABELS` (Task 4).
- Produces : `export function createClimateDashboard(cfg: ClimateDashboard, d: DashboardDeps): Dashboard`.

  Disposition :

  | Touche | Libellé | Valeur | Icône |
  |---|---|---|---|
  | `keys[0]` | « Ambiante » | `current_temperature` | `mdi:home-thermometer` |
  | `keys[1]` | « Consigne » | `temperature`, ou la valeur locale | `mdi:thermostat` |
  | `keys[4..]` | un mode par entrée de `hvac_modes`, dans l'ordre | | |
  | `keys[8..11]` | les capteurs | | |

  Le mode actif est dans l'état `on`. La zone de bande de `setpointKnob` porte le libellé « Consigne ».

- [ ] **Step 1 : Écrire les tests.** On utilise `climate.t10` avec `{ current_temperature:21, temperature:19, hvac_modes:['off','heat','cool'], min_temp:7, max_temp:30 }` et l'état `heat`.
  - `layout` :
    - `keys[0].valueText` vaut `'21,0 °C'` et `keys[1].valueText` vaut `'19,0 °C'` ;
    - les libellés de `keys[4..6]` sont `['Arrêt','Chauffage','Climatisation']`, et `keys[5].state` vaut `'on'` ;
    - `right[0].label` vaut `'Consigne'`.
  - `knob_setpoint_step` :
    - un cran de +1 sur `knobTR` appelle `setTemperature('climate.t10', 19.5)` ;
    - avec `target_temp_step:1`, on obtient 20 ;
    - à `temperature:30`, +1 donne 30.
  - `overlay_shown` : après un cran, `keys[1].valueText` vaut `'19,5 °C'`, avant même la réponse de HA.
  - `tap_mode` : un appui sur la touche 4 appelle `setHvacMode('climate.t10','off')`.
  - `sensor_tiles` : `sensors:[{entityId:'sensor.salon_temp'}]` à `20.4` donne `keys[8].valueText` = `'20,4 °C'`.
  - `no_entity_configured` : `entityId:null` donne `keys[0]` = `{state:'empty', label:'Aucun thermostat'}` ; la molette ne fait rien.
  - `missing_climate` : l'entité absente donne `keys[0].state` = `'missing'`.
- [ ] **Step 2 :** Lancer `npx vitest run test/dashboards/climate.test.ts` : FAIL.
- [ ] **Step 3 : Implémenter.** La valeur affichée est arrondie au pas, puis bornée à `[min_temp, max_temp]`.
- [ ] **Step 4 :** Relancer : PASS.
- [ ] **Step 5 :** `git commit -m "feat: tableau Température"`

---

### Task 10 : Tableau Météo

**Files :**
- Create : `src/dashboards/weather.ts`
- Test : `test/dashboards/weather.test.ts`

**Interfaces :**
- Consumes : `WeatherDashboard` (Task 2) ; `WeatherView`, `CONDITION_LABELS`, `formatTemp` (Task 4) ; `weatherIcon` (Task 3) ; `Forecast` (Task 6) ; `Dashboard`, `DashboardDeps` (Task 8).
- Produces :

```ts
export const WEATHER_REFRESH_MS = 1_800_000
export function pickForecastType(supportedFeatures: number): ForecastType | null   // bit 1 = daily, 4 = twice_daily, 2 = hourly ; ordre de préférence daily > twice_daily > hourly
export function aggregateByDay(f: Forecast[], today: Date): { date: string; condition: string; high: number; low: number }[]   // exclut aujourd'hui, au plus 8 jours
export function createWeatherDashboard(cfg: WeatherDashboard, d: DashboardDeps): Dashboard
```

- [ ] **Step 1 : Écrire les tests,** avec l'heure système simulée à `2026-11-20T15:00:00` en heure locale.
  - `pick_type` : `pickForecastType(1)` vaut `'daily'`, `(6)` vaut `'twice_daily'`, `(2)` vaut `'hourly'`, `(0)` vaut `null`.
  - `aggregate_twice_daily` :
    - deux prévisions le 21 (jour 3 °C / basse −1, nuit 1 °C / basse −4) donnent `{date:'2026-11-21', high:3, low:-4}` ;
    - les prévisions du 20 sont exclues ;
    - la condition retenue est celle de la première prévision du jour.
  - `aggregate_caps_8`.
  - `view_current` :
    - `weather.home` est `partlycloudy` avec `{temperature:-2, apparent_temperature:-6}` ;
    - `current` vaut `{condition:'Partiellement nuageux', temperature:'-2,0 °C', apparent:'Ressenti -6,0 °C', icon:'mdi:weather-partly-cloudy'}`.
  - `day_labels_fr` : le libellé du 2026-11-21 vaut `'sam.'`, obtenu avec `Intl.DateTimeFormat('fr-CA',{weekday:'short'})`.
  - `no_forecast_support` : `supported_features:0` donne `message` = `'Pas de prévisions pour cette entité'`.
  - `fetch_on_activate_and_every_30min` :
    - `activate()` appelle `getForecasts` une fois ;
    - après 30 min, un deuxième appel ;
    - après `deactivate()` et 30 min de plus, aucun nouvel appel.
  - `refetch_on_state_change` : un `setEntity('weather.home', …)` pendant que le tableau est actif provoque un nouvel appel.
  - `forecast_error_keeps_previous` : un premier succès, puis un rejet ; les jours précédents sont conservés, sans exception.
  - `no_entity` : `entityId:null` donne `message` = `'Aucune entité météo configurée'`.
- [ ] **Step 2 :** Lancer `npx vitest run test/dashboards/weather.test.ts` : FAIL.
- [ ] **Step 3 : Implémenter.** Les dates sont regroupées par jour en heure locale (`toLocaleDateString('sv-SE')` donne `YYYY-MM-DD`).
- [ ] **Step 4 :** Relancer : PASS.
- [ ] **Step 5 :** `git commit -m "feat: tableau Météo"`

---

### Task 11 : Source d'images et tableau Caméra

**Files :**
- Create : `src/camera/source.ts`, `src/dashboards/camera.ts`
- Test : `test/dashboards/camera.test.ts`

**Interfaces :**
- Consumes : `CameraDashboard` (Task 2) ; `FullView` (Task 4) ; `HaPort` (Task 6) ; `Dashboard`, `DashboardDeps` (Task 8).
- Produces :

```ts
// source.ts
export interface CameraSource { next(signal: AbortSignal): Promise<Buffer> }
export function createHaProxySource(ha: HaPort, entityId: string): CameraSource   // fetchCameraImage(entityId, {width:480, height:270})
// camera.ts
export const STALE_MS = 5000
export function createCameraDashboard(cfg: CameraDashboard, d: DashboardDeps & { createSource?: (cfg: CameraDashboard) => CameraSource }): Dashboard
```

- [ ] **Step 1 : Écrire les tests,** avec une source factice qui compte les appels et la concurrence maximale, et de fausses horloges.
  - `idle_until_active` : aucun appel à `next` avant `activate()`. Après `deactivate()`, plus aucun appel (vérifié sur 5 s simulées).
  - `paced_no_overlap` :
    - avec une source qui répond tout de suite et `intervalMs:1000`, on simule 3000 ms ;
    - `next` est appelé entre 3 et 4 fois ;
    - la concurrence maximale vaut `1`.
  - `slow_source_no_pileup` : une source qui met 1500 ms à répondre ; la concurrence reste à 1 et l'appel suivant part dès la réponse précédente (pas de délai supplémentaire).
  - `first_failure_message` : un rejet donne `view()` = `{image:null, message:'Image non disponible'}`.
  - `failure_keeps_last_image` : un succès, puis un rejet ; `image` reste celle du succès.
  - `stale_after_5s` :
    - un succès, puis la source reste pendante ;
    - à t + 5001, `view().stale` vaut `true` et `requestRender` a été appelé ;
    - au succès suivant, `stale` repasse à `false`.
  - `input_ignored` : `handle(tap)`, `handle(knobTurn)` et `handle(knobPress)` ne déclenchent aucun appel à `FakeHa.calls`.
  - `no_entity` : `entityId:null` donne `message` = `'Aucune caméra configurée'`, et `next` n'est jamais appelé.
  - `ha_proxy_source` : `createHaProxySource(fakeHa,'camera.porte').next()` appelle `fetchCameraImage('camera.porte',{width:480,height:270})`.
- [ ] **Step 2 :** Lancer `npx vitest run test/dashboards/camera.test.ts` : FAIL.
- [ ] **Step 3 : Implémenter.**
  - Boucle `async` : `t0` → `await next(signal)` → mise à jour → `await sleep(max(0, intervalMs - (now - t0)))`.
  - Un `AbortController` par activation.
  - Un minuteur d'une seconde vérifie si l'image est périmée.
- [ ] **Step 4 :** Relancer : PASS.
- [ ] **Step 5 :** `git commit -m "feat: tableau Caméra et source ha-proxy"`

---

### Task 12 : Navigator (boutons ronds, LED, routage)

**Files :**
- Create : `src/dashboards/factory.ts`, `src/navigator.ts`
- Test : `test/navigator.test.ts`

**Interfaces :**
- Consumes : `AppConfig`, `DashboardConfig` (Task 2) ; `StateStore` (Task 2) ; `Surface`, `createSurface` (Task 3) ; `paint`, `View` (Task 4) ; `DeviceLink` (Task 5), réduit à `DevicePort` ; `HaPort` ; `Actions` ; les quatre `create*Dashboard` (Tasks 8 à 11).
- Produces :

```ts
// factory.ts
export function createDashboard(cfg: DashboardConfig, d: DashboardDeps): Dashboard
// navigator.ts
export type DevicePort = Pick<DeviceLink, 'present'|'setLed'|'onInput'|'onStatus'>
export function dim(hex: string, factor: number): string        // dim('#FFB300', 0.15) === '#261b00'
export class Navigator {
  constructor(d: { device: DevicePort; ha: HaPort; actions: Actions; state: StateStore; makeDashboard?: typeof createDashboard })
  applyConfig(cfg: AppConfig): void
  handle(e: InputEvent): void
  activeIndex(): number
  dashboard(i: number): Dashboard | null
  onActiveChange(cb: (i: number) => void): () => void
  requestRender(): void
  dispose(): void
}
```

- [ ] **Step 1 : Écrire les tests,** avec un `DevicePort` factice, `FakeHa` et des tableaux factices qui comptent les appels.
  - `switch_dashboard` :
    - à partir du tableau 0, un `{type:'button',id:2}` désactive 0 et active 2 ;
    - `state.setActiveButton(2)` est appelé, `onActiveChange(2)` est émis et `present` est appelé.
  - `leds` : avec la configuration par défaut et le tableau 2 actif :
    - `setLed(2,'#03A9F4')` ;
    - `setLed(0, dim('#FFB300',0.15))` ;
    - `setLed(7,'#000000')`.
  - `null_button_ignored` : `{type:'button',id:7}` ne change pas le tableau actif.
  - `forward_inputs` : `knobTurn` et `tap` sont transmis à `handle` du tableau actif seulement.
  - `restore_active_from_state` : si `StateStore` contient 3, le tableau 3 est actif après `applyConfig`.
  - `active_removed_falls_back` : le bouton actif devient `null` dans la nouvelle configuration ; le premier bouton configuré devient actif.
  - `apply_config_rebuilds` : l'ancien tableau actif reçoit `deactivate()`, le nouveau reçoit `activate()`.
  - `render_coalesced` : 5 appels à `requestRender()` dans le même tick donnent un seul `present`, au microtask ou au `setImmediate` suivant.
  - `reconnect_rerenders` : `onStatus('connected')` réapplique les LED et appelle `present`.
  - `stale_blinks_red` : le tableau actif renvoie `{kind:'full', stale:true}` ; sur 1000 ms, la LED active alterne entre `'#FF0000'` et la couleur du tableau toutes les 500 ms. Le clignotement s'arrête dès que `stale` repasse à `false`.
  - `dim_values` : `dim('#FFB300',0.15) === '#261b00'`.
- [ ] **Step 2 :** Lancer `npx vitest run test/navigator.test.ts` : FAIL.
- [ ] **Step 3 : Implémenter.** Un rendu se fait ainsi : `view()` → `createSurface()` → `await paint()` → `device.present()`. Une erreur de rendu est journalisée sans bloquer les rendus suivants.
- [ ] **Step 4 :** Relancer : PASS.
- [ ] **Step 5 :** `git commit -m "feat: navigation par boutons ronds et LED"`

---

### Task 13 : Câblage de l'application, journaux, démarrage automatique

**Files :**
- Create : `src/log.ts` (implémentation), `src/ha/proxy.ts`, `src/app.ts`, `src/main.ts`, `scripts/install-autostart.ps1`, `scripts/launch-hidden.vbs`, `README.md`
- Test : `test/app.test.ts`, `test/ha/proxy.test.ts`

**Interfaces :**
- Consumes : tout ce qui précède.
- Produces :

```ts
// ha/proxy.ts — un HaPort stable, que l'on donne à Actions, Navigator et EditorServer
export class HaProxy implements HaPort {
  constructor(initial: HaPort)
  replace(next: HaPort): void   // close() sur l'ancien, réabonne les écouteurs onEntities/onStatus au nouveau, émet immédiatement son statut et ses entités
}
// log.ts
export function createLogger(file: string | null): Logger   // pino ; redact: ['token','*.token','access_token','headers.authorization']
// app.ts
export interface AppDeps {
  configDir: string; log: Logger
  createDevice?: (path: string | null) => () => Promise<LoupedeckLike>
  createHa?: (ha: AppConfig['ha'], log: Logger) => HaPort
  startEditor?: boolean
}
export interface App { stop(): Promise<void>; navigator: Navigator; device: DeviceLink; store: ConfigStore; ha(): HaPort }
export function createApp(d: AppDeps): Promise<App>
```

- [ ] **Step 0 : Écrire `test/ha/proxy.test.ts`.**
  - `replace_rebinds_listeners` :
    - un écouteur `onStatus` est enregistré sur le proxy ;
    - après `replace(fake2)`, un `fake2.setStatus(...)` atteint cet écouteur, alors qu'un `fake1.setStatus(...)` ne l'atteint plus ;
    - `fake1.close` a été appelé.
  - `delegates_calls` : `proxy.callService(...)` est enregistré dans `fake2.calls` après le remplacement.
- [ ] **Step 1 : Écrire `test/app.test.ts`,** avec `FakeDevice`, `FakeHa` et `startEditor:false`.
  - `end_to_end_toggle` :
    - le `FakeHa` contient `light.salon` ;
    - on configure `buttons[0].keys[0] = {entityId:'light.salon'}` avec `store.update` ;
    - le faux appareil émet `touchstart` sur la touche 0 ;
    - `FakeHa.calls` contient `light.toggle` et le faux appareil a reçu `vibrate(0x01)`.
  - `config_change_rebuilds_navigator` : `store.update` change le type du bouton 7 en `lights` ; un appui sur le bouton 7 rend ce tableau actif.
  - `ha_section_change_recreates_client` :
    - changer `ha.url` appelle `close()` sur l'ancien `HaPort`, et `createHa` reçoit la nouvelle URL ;
    - `app.ha()` renvoie toujours le même `HaProxy` ;
    - un appui sur une touche appelle bien le nouveau client.
  - `brightness_change_applied` : `device.brightness` passe à `0.5`, et `setBrightness(0.5)` est appelé sur l'appareil.
  - `startup_applies_brightness_1`.
  - `stop_is_clean` : `stop()` résout sans laisser de minuteur actif (`vi.getTimerCount() === 0`).
- [ ] **Step 2 :** Lancer `npx vitest run test/app.test.ts` : FAIL.
- [ ] **Step 3 : Implémenter `createApp`.**
  - Ordre de démarrage : `ConfigStore` → `StateStore` → `HaClient` enveloppé dans un `HaProxy` → `Actions` (avec `feedback` vers `device.vibrate`) → `DeviceLink.start()` → `Navigator.applyConfig()` → abonnement à `store.onChange`.
  - Un changement de la section `ha` appelle `proxy.replace(createHa(...))`.
  - `main.ts` :
    - dossier de configuration : `join(process.env.APPDATA!, 'loupedeck-ha')` ;
    - journaux dans `logs/app.log` ;
    - sur `SIGINT`/`SIGTERM` : `stop()`, puis `process.exit(0)` ;
    - au démarrage, journaliser l'URL de l'éditeur.
- [ ] **Step 4 :** Relancer : PASS. Puis `npm run build` doit se terminer sans erreur TypeScript.
- [ ] **Step 5 : Écrire les scripts de démarrage automatique.**
  - `scripts/launch-hidden.vbs` lance `node "<repo>\dist\main.js"` sans fenêtre (`WScript.Shell.Run …, 0, False`), avec un dossier de travail égal à la racine du dépôt.
  - `scripts/install-autostart.ps1` :
    - `-Install` crée, avec `Register-ScheduledTask`, la tâche « Loupedeck HA » déclenchée à l'ouverture de session de l'utilisateur courant, dont l'action est `wscript.exe "<repo>\scripts\launch-hidden.vbs"` ;
    - `-Uninstall` supprime cette tâche.
- [ ] **Step 6 : Écrire `README.md`** en français :
  - prérequis : Node 24, `npm ci`, `npm run build` ;
  - fermer ou désactiver au démarrage le logiciel Loupedeck / Logi Options+ ;
  - créer un jeton longue durée dans le profil Home Assistant ;
  - `npm start`, puis ouvrir l'éditeur sur `http://127.0.0.1:8765` ;
  - `scripts/install-autostart.ps1 -Install` ;
  - désactiver la « suspension sélective USB » en cas de déconnexions après une veille ;
  - firmware 0.2.26 : voir la note de l'essai ;
  - une liste « Recette sur matériel » qui reprend les objectifs 1 à 7 de la spec.
- [ ] **Step 7 :** `git commit -m "feat: câblage de l'application, journaux et démarrage automatique"`

---

### Task 14 : Serveur de l'éditeur

**Files :**
- Create : `src/editor/server.ts`
- Modify : `src/app.ts` (démarrer le serveur si `startEditor !== false`)
- Test : `test/editor/server.test.ts`

**Interfaces :**
- Consumes : `ConfigStore`, `ConfigValidationError`, `canPlace`, `EntityInfo` (Task 2) ; `HaPort` ; `Navigator` ; `DeviceLink` ; `createSurface`, `toPng` (Task 3) ; `paint` (Task 4).
- Produces :

```ts
export type LiveMessage = { type:'config' } | { type:'active'; button:number } | { type:'status' } | { type:'entities' }
export type PublicConfig = Omit<AppConfig,'ha'> & { ha: { url:string; allowSelfSigned:boolean; hasToken:boolean }; loadWarning: string|null }
export function startEditorServer(d: {
  store: ConfigStore; ha: () => HaPort; navigator: Navigator; device: DeviceLink
  port: number; staticDir: string; log: Logger
}): Promise<{ url: string; close(): Promise<void>; notify(m: LiveMessage): void }>
```

  Contrat HTTP :

  | Requête | Réponse |
  |---|---|
  | `GET /api/config` | `PublicConfig` |
  | `PUT /api/config` | corps : `PublicConfig` sans `hasToken` ni `loadWarning`, plus un champ facultatif `newToken?: string` ; répond 200 `PublicConfig`, ou 400 `{ error:string, issues?:string[] }` |
  | `POST /api/config/undo` | 200 `PublicConfig`, ou 409 `{ error:'Rien à annuler' }` |
  | `GET /api/entities` | 200 `EntityInfo[]` trié par `name`, ou 503 `{ error:'Home Assistant hors ligne' }` |
  | `GET /api/preview/:button.png` | `image/png`, ou 404 si le bouton est `null` ; `?refreshCamera=1` recharge l'image fixe de la caméra |
  | `GET /api/status` | `{ device:{ status, firmware }, ha:HaStatus, activeButton:number }` |
  | `GET /api/live` | WebSocket qui pousse des `LiveMessage` |
  | `/*` | fichiers statiques de `staticDir`, avec repli sur `index.html` |

- [ ] **Step 1 : Écrire les tests,** avec `server.inject` de Fastify, plus un vrai démarrage pour l'adresse d'écoute et le WebSocket.
  - `listens_localhost_only` : l'adresse d'écoute vaut `'127.0.0.1'`.
  - `rejects_foreign_host` : `Host: evil.example` donne 403. `Host: 127.0.0.1:8765` et `Host: localhost:8765` sont acceptés.
  - `config_redacts_token` : avec le jeton `'SECRET123'`, la réponse ne contient pas `'SECRET123'` et `ha.hasToken` vaut `true`.
  - `put_keeps_token_when_absent` : un `PUT` sans `newToken` laisse `store.get().ha.token` à `'SECRET123'`. Avec `newToken:'NEW'`, il devient `'NEW'`.
  - `put_invalid_400` : `buttons:[]` donne 400 avec des `issues`.
  - `put_placement_400` :
    - `dimmers.knobTL` contient un `light` connu, mais non gradable ;
    - la réponse est 400 et `error` contient `"n'est pas gradable"` ;
    - pour une entité inconnue de HA (hors ligne), le placement est accepté.
  - `undo_flow` : 200, puis 409.
  - `entities_offline_503`.
  - `preview_png` : `/api/preview/0.png` répond avec `content-type` `image/png`, et le corps commence par la signature PNG. `/api/preview/7.png` donne 404.
  - `status_shape`.
  - `live_pushes_config` : après un `store.update`, le client WebSocket reçoit `{type:'config'}`.
  - `live_pushes_active` : après un changement de tableau, il reçoit `{type:'active', button:2}`.
- [ ] **Step 2 :** Lancer `npx vitest run test/editor/server.test.ts` : FAIL.
- [ ] **Step 3 : Implémenter.**
  - Contrôle du `Host` dans un hook `onRequest`.
  - L'aperçu dessine `navigator.dashboard(i).view()` avec `paint` et `toPng`.
  - Pour une caméra inactive, `fetchCameraImage` est mis en cache par bouton, rechargé seulement avec `refreshCamera=1`.
  - `notify` est branché sur `store.onChange` → `config`, `navigator.onActiveChange` → `active`, `device.onStatus` → `status`, et `ha().onStatus` → `status`. Quand le statut passe à `online`, il envoie aussi `entities`.
  - `ha()` renvoie le `HaProxy` de la Task 13.
- [ ] **Step 4 :** Relancer : PASS.
- [ ] **Step 5 :** `git commit -m "feat: serveur de l'éditeur (API, aperçu, live)"`

---

### Task 15 : Éditeur, partie 1 (console virtuelle et configuration des boutons)

**Files :**
- Create : `editor/package.json`, `editor/vite.config.ts`, `editor/index.html`, `editor/src/main.ts`, `editor/src/api.ts`, `editor/src/store.ts`, `editor/src/App.vue`, `editor/src/components/LiveDevice.vue`, `editor/src/components/ButtonPanel.vue`
- Modify : `package.json` racine (scripts `editor:dev` = `vite editor`, `editor:build` = `vite build editor` ; `build` exécute aussi `editor:build`)
- Test : `editor/test/live-device.test.ts`, `editor/test/button-panel.test.ts`

**Interfaces :**
- Consumes : le contrat HTTP et WebSocket de la Task 14 ; `emptyDashboard` (Task 2), importé avec l'alias Vite `@shared` vers `../src` (dans `src/config/schema.ts`, il ne faut importer que `zod`).
- Produces :
  - `editor/src/api.ts` : `getConfig()`, `putConfig(cfg, newToken?)`, `undo()`, `getEntities()`, `getStatus()`, `previewUrl(button, version)`, `connectLive(onMessage)`.
  - `editor/src/store.ts` : un état réactif `{ config, entities, status, selectedButton, previewVersion, error }`, et les actions `select(i)`, `save(mutator)` (clone, mutation, `PUT`, puis mise à jour de `config` ou de `error`) et `undo()`.

- [ ] **Step 1 : Écrire les tests,** avec `@vue/test-utils`, `jsdom` et un `fetch` simulé.
  - `renders_8_round_buttons_with_colors` : `LiveDevice` affiche 8 `.round-button` ; le bouton 0 a le style `background-color: #FFB300` et le bouton 7 la classe `empty`.
  - `select_button_shows_panel` : un clic sur le bouton 2 fait afficher par `ButtonPanel` le type « Météo » et le nom « Météo ».
  - `preview_background` : l'`img.preview` a pour `src` `/api/preview/2.png?v=0`. Après un message live `{type:'config'}`, le `src` se termine par `v=1`.
  - `key_and_strip_hotspots` : pour un tableau Lumières, on trouve 12 `.key-slot` et 6 `.dimmer-slot` (3 de chaque côté, alignés avec les molettes).
  - `change_type_confirms_then_puts` :
    - avec `window.confirm` simulé à `true`, changer le type du bouton 7 en « Lumières » envoie un `PUT` dont `buttons[7]` vaut `emptyDashboard('lights', 7)` ;
    - avec `confirm` à `false`, aucun `PUT`.
  - `rename_and_color_save_on_change` : un `blur` sur le champ du nom ou un `change` sur le sélecteur de couleur envoie un `PUT`.
  - `active_on_console_badge` : après le message live `{type:'active',button:3}`, le bouton 3 porte la classe `active-on-device`.
- [ ] **Step 2 :** Lancer `npx vitest run --root editor` : FAIL.
- [ ] **Step 3 : Implémenter.**
  - `LiveDevice` reproduit les proportions de la Live :
    - au centre, l'aperçu PNG (480 × 270, mis à l'échelle × 1,5) ;
    - les zones cliquables positionnées en pourcentage d'après `keyRect` et `stripZoneRect` ;
    - 3 molettes de chaque côté ;
    - 8 boutons ronds en dessous.
  - Le serveur de développement Vite redirige `/api` vers `http://127.0.0.1:8765`, WebSocket compris.
- [ ] **Step 4 :** Relancer : PASS. `npm run editor:build` produit `editor/dist/index.html`.
- [ ] **Step 5 :** `git commit -m "feat: éditeur, console virtuelle et configuration des boutons"`

---

### Task 16 : Éditeur, partie 2 (entités, glisser-déposer, réglages)

**Files :**
- Create : `editor/src/components/EntityPalette.vue`, `editor/src/components/SlotEditor.vue`, `editor/src/components/EntityPicker.vue`, `editor/src/components/SettingsPanel.vue`
- Modify : `editor/src/App.vue`, `editor/src/components/LiveDevice.vue` (cibles de dépôt)
- Test : `editor/test/palette.test.ts`, `editor/test/dnd.test.ts`, `editor/test/settings.test.ts`

**Interfaces :**
- Consumes : `canPlace`, `EntityInfo`, `SlotKind` (`@shared/shared/placement`) ; le store et l'API de la Task 15.
- Produces : les composants ci-dessus. Le glisser-déposer utilise le transfert de données HTML5 `application/x-entity-id`.

- [ ] **Step 1 : Écrire les tests.**
  - `palette_search_and_filters` :
    - avec 4 entités (`light.salon` dans Salon, `switch.hall` dans Hall, `sensor.temp`, `light.ghost` `unavailable`) ;
    - taper « sal » ne laisse que Salon ;
    - le filtre de domaine `switch` ne laisse que Hall ;
    - le filtre de pièce Hall ne laisse que Hall ;
    - chaque ligne affiche l'`entityId` ;
    - `light.ghost` porte un badge « Indisponible ».
  - `drop_invalid_shows_reason_no_put` : déposer une lumière non gradable sur `.dimmer-slot[data-knob=knobTL]` affiche « Cette lumière n'est pas gradable : placez-la sur une touche centrale. », sans `PUT`.
  - `drop_valid_puts_slot` : déposer `light.salon` sur la touche 4 envoie un `PUT` dont `buttons[0].keys[4]` vaut `{entityId:'light.salon'}`.
  - `slot_editor_label_icon_blur` : sur une touche occupée, éditer le libellé puis `blur` envoie un `PUT` avec `label`. Un bouton « Retirer » met l'emplacement à `null`.
  - `entity_picker_filtered` :
    - pour un tableau Météo, la liste ne propose que des `weather.*` ;
    - pour une caméra, que des `camera.*` ;
    - pour Température, que des `climate.*` (les capteurs se choisissent dans une liste séparée, filtrée par `canPlace('sensor')`).
  - `settings_token_never_prefilled` : le champ jeton est de type `password` et vide. Quand `hasToken` vaut `true`, le texte « Jeton enregistré » s'affiche. Une saisie suivie d'« Enregistrer » envoie un `PUT` avec `newToken`.
  - `settings_http_warning` : avec l'URL `http://…`, l'avertissement « Connexion non chiffrée » s'affiche. Avec `https://…`, il disparaît.
  - `settings_status` : l'état `{ha:{state:'offline',reason:'auth'}}` affiche « Jeton invalide », et `{device:{status:'disconnected'}}` affiche « Console déconnectée ».
  - `load_warning_banner` : quand `config.loadWarning` est défini, un bandeau d'avertissement s'affiche.
  - `brightness_slider` : la plage va de 0 à 1 par pas de 0,1. Un `change` envoie un `PUT` avec `device.brightness`.
  - `undo_button` : un clic appelle `POST /api/config/undo`.
- [ ] **Step 2 :** Lancer `npx vitest run --root editor` : FAIL.
- [ ] **Step 3 : Implémenter les composants.** La palette se recharge sur le message live `{type:'entities'}` et à l'ouverture.
- [ ] **Step 4 :** Relancer : PASS. Puis `npm run build` à la racine : OK.
- [ ] **Step 5 :** `git commit -m "feat: éditeur, entités, glisser-déposer et réglages"`

---

### Task 17 : Essai n° 2, la sonnette Alarm.com (rapport, sans code de production)

**Files :**
- Create : `docs/superpowers/notes/2026-11-20-alarmcom-doorbell.md`, et au besoin `scripts/spike-alarmcom.ts` (jetable)

**Interfaces :**
- Consumes : `HaClient` (Task 6), pour lister les entités et tester `camera_proxy` avec le jeton de l'utilisateur.

- [ ] **Step 1 :** Avec l'application configurée (URL et jeton), lister les entités `camera.*` (`listEntityInfo()`) et identifier la sonnette et la caméra avant Alarm.com. Ne rien modifier dans Home Assistant.
- [ ] **Step 2 :** Demander à l'utilisateur quelle intégration Alarm.com est installée : nom dans HACS ou dépôt. La comparer aux candidates de la spec §8 (essai n° 2).
- [ ] **Step 3 :** Tester `fetchCameraImage` sur la sonnette et la caméra avant. Noter le code HTTP, le type de contenu et la fraîcheur de l'image (deux appels à 10 s d'intervalle).
- [ ] **Step 4 :** Si aucune image n'arrive, lire le code de l'intégration installée et de sa carte WebRTC pour établir :
  - comment les jetons Janus sont obtenus : point d'accès HTTP de l'intégration ou commande WebSocket ;
  - s'il existe un chemin MJPEG.
- [ ] **Step 5 :** Rédiger le rapport :
  - les faits observés, avec des URL ou des fichiers à l'appui ;
  - les options (source `alarmcom-webrtc` avec `werift` + ffmpeg, chemin MJPEG, ou statu quo) ;
  - pour chaque option, l'effort estimé et le risque ;
  - une recommandation.

  Présenter le rapport à l'utilisateur et **attendre sa décision** avant toute construction (spec §8).
- [ ] **Step 6 :** `git add docs/superpowers/notes && git commit -m "docs: essai n° 2, sonnette Alarm.com"`
