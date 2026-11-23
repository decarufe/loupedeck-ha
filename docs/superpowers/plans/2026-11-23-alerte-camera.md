# Alerte de caméra — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** quand un capteur coché d'une page caméra détecte quelque chose, la console vibre, fait clignoter le bouton de la caméra et ouvre sa page, puis revient seule.

**Architecture :** `AlertMonitor` (`src/alerts.ts`) transforme les états Home Assistant en alertes par page ; il ne connaît ni l'écran ni les LED. `Navigator` décide de l'affichage, du retour, des LED et de la vibration. L'éditeur choisit les capteurs, enregistrés dans la page ; le registre Home Assistant ne sert qu'à les proposer.

**Tech Stack :** TypeScript (NodeNext, ESM, imports en `.js`), zod 4, vitest (minuteurs simulés), Vue 3 pour l'éditeur, pnpm.

**Spec :** `docs/superpowers/specs/2026-11-23-alerte-camera-design.md`

## Global Constraints

- **pnpm seulement**, jamais npm ni npx. Aucune nouvelle dépendance.
- Textes visibles, commentaires et messages de commit en français accentué ; noms d'entités génériques (dépôt public).
- Durées : geste récent **5 000 ms** ; calme **30 000 ms** ; alerte au plus **300 000 ms** ; capteur bloqué **300 000 ms** ; retour sans geste **300 000 ms** ; clignotement **250 ms**.
- Magenta **`#FF00FF`** ; phase éteinte du clignotement **`#000000`** ; vibration **`0x6a`** ; jamais `0x76`.
- Configuration toujours en `version: 2` ; une page caméra sans `alert` se charge avec `{ enabled: false, sensors: [] }`.
- L'ouverture automatique n'appelle jamais `state.setActiveButton`.
- Départ : 446 tests à la racine et 91 dans l'éditeur, tous verts. Un commit par tâche, terminé par
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Caméra injoignable pendant l'alerte** : après un premier échec, « Image non disponible », pas « Chargement… » sans fin. → Task 3.
2. **Plusieurs capteurs pour un même passage** (personne, puis colis) : une alerte, une vibration, fin 30 s après le dernier `off`. → Task 2.
3. **Home Assistant remplacé ou perdu pendant l'alerte** (entités disparues) : l'alerte finit après 30 s, et rien ne se déclenche au retour. → Task 2.
4. **Capteur supprimé ou renommé dans Home Assistant** : ignoré, les autres alertent ; l'éditeur le montre encore pour le retirer. → Tasks 2 et 5.
5. **Bouton d'une autre page pressé juste après l'ouverture automatique** : on va à la page demandée, l'alerte est vue, aucun retour ensuite. → Task 4.

---

### Task 1 : Configuration et données de l'éditeur

**Files :**
- Modify : `src/config/schema.ts`, `src/shared/placement.ts`, `src/ha/client.ts` (`listEntityInfo`), `src/editor/server.ts` (`placementIssues`), `test/fakes/fake-ha.ts`, `test/dashboards/camera.test.ts` (aide `cfg`)
- Test : `test/config/schema.test.ts`, `test/shared/placement.test.ts`, `test/ha/client.test.ts`, `test/editor/server.test.ts`

**Interfaces :**
- Produces : `interface CameraAlert { enabled: boolean; sensors: string[] }` ; `CameraDashboard.alert: CameraAlert` ; `EntityInfo.deviceId?: string | null` ; `SlotKind` gagne `'alert'`.

- [ ] **Step 1 : Écrire les tests**

```ts
// schema.test.ts
it('camera_alert_defaults_for_old_config', () => {
  const old = JSON.parse(JSON.stringify(defaultConfig()))
  for (const b of old.buttons) if (b?.type === 'camera') delete b.alert
  const r = parse(old)
  expect(r.success && (r.data.buttons[3] as CameraDashboard).alert).toEqual({ enabled: false, sensors: [] })
})
it('camera_alert_kept_and_validated', () => {
  const c = defaultConfig()
  ;(c.buttons[3] as CameraDashboard).alert = { enabled: true, sensors: ['binary_sensor.a'] }
  const r = parse(c)
  expect(r.success && (r.data.buttons[3] as CameraDashboard).alert).toEqual({ enabled: true, sensors: ['binary_sensor.a'] })
  ;(c.buttons[3] as CameraDashboard).alert.sensors = ['']
  expect(parse(c).success).toBe(false)
})
// placement.test.ts
it('alert_accepts_only_binary_sensors', () => {
  expect(canPlace('alert', ent({ domain: 'binary_sensor' }))).toEqual({ ok: true })
  expect(canPlace('alert', ent({ domain: 'light' }))).toEqual({ ok: false, reason: 'Une alerte accepte seulement un capteur tout ou rien (binary_sensor).' })
})
// client.test.ts, dans entity_info_joins_registries : deviceId ajouté à l'objet attendu de light.salon
deviceId: 'dev1'
expect(by['switch.orphelin']).toMatchObject({ deviceId: null })
// server.test.ts : PUT avec sensors: ['light.salon'] (entité connue) sur la page 3
expect(res.status).toBe(400)
expect(body.issues[0]).toContain('Bouton 4, alerte (light.salon)')
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm exec vitest run test/config test/shared/placement.test.ts test/ha/client.test.ts test/editor` ; attendu : les nouveaux tests échouent.
- [ ] **Step 3 : Implémenter** — `alert` dans l'objet zod `camera` (entrées `z.string().min(1)`, défauts ci-dessus) et dans `emptyDashboard('camera')` ; `deviceId` pris dans `reg?.device_id ?? null` ; `placementIssues` vérifie chaque `b.alert.sensors` avec `'alert'` et le libellé `` `${t}, alerte` `` ; `FakeHa.listEntityInfo` rend `deviceId: e.attributes.device_id ?? null`.
- [ ] **Step 4 : Vérifier** — `pnpm test` et `pnpm exec tsc -p . --noEmit` ; attendu : tout passe.
- [ ] **Step 5 : Commit** — `feat(config): alerte d'une page caméra (activée, capteurs)`

---

### Task 2 : `AlertMonitor`

**Files :**
- Create : `src/alerts.ts`
- Test : `test/alerts.test.ts`

**Interfaces :**
- Consumes : `HaEntity` (`src/ha/types.ts`).
- Produces :

```ts
export const CALM_MS = 30_000
export const MAX_ALERT_MS = 300_000
export const STUCK_MS = 300_000
export interface AlertPage { entityId: string | null; sensors: string[] }
export type AlertLed = 'none' | 'alert' | 'reminder'
export interface AlertEvents {
  /** Pages dont une alerte vient de commencer dans la même mise à jour, par numéro croissant. */
  onStart(pages: number[]): void
  /** Alerte terminée sans avoir été vue (calme ou durée maximale). */
  onEnd(page: number): void
  /** L'état `led` d'au moins une page a changé. */
  onChange(): void
}
export class AlertMonitor {
  constructor(events: AlertEvents)
  /** Termine tout sans événement onEnd, efface les rappels ; `entities` devient l'état de départ. */
  configure(pages: (AlertPage | null)[], entities: Record<string, HaEntity>): void
  update(entities: Record<string, HaEntity>): void
  led(page: number): AlertLed
  /** Alerte ou rappel de cette page, et des pages de même `entityId` non nul, marqués comme vus. */
  markSeen(page: number): void
  dispose(): void
}
```

**Automate, par page** : `idle` → `alerting` (déclenchement) → `idle` + rappel (calme) ou `quiet` + rappel (durée maximale) ou `quiet` sans rappel (vue). `quiet` → `idle` au calme. Un déclenchement ne démarre une alerte qu'en `idle` ; il efface alors le rappel.
**Calme** : hors `idle`, un minuteur `CALM_MS` part quand aucun capteur coché n'est actif, et s'annule dès qu'un l'est.
**Capteur** : actif = `on` et pas bloqué. Déclenchement = `off` → `on` strictement. Tout autre état, ou une entité absente, compte comme inconnu : ni déclenchement, ni actif. Bloqué après `STUCK_MS` de `on` continu (y compris depuis l'état de départ), jusqu'au prochain `off`.

- [ ] **Step 1 : Écrire les tests** (`vi.useFakeTimers()` ; `S` = personne, `P` = colis, page 3 = `{ entityId: 'camera.a', sensors: [S, P] }` ; `set(id, état)` met à jour les entités et appelle `update` ; `log` reçoit `start 3`, `end 3`)

```ts
it('off_to_on_starts_once', () => { set(S,'on'); m.update(ents); expect(log).toEqual(['start 3']); expect(m.led(3)).toBe('alert') })
it('initial_on_and_unavailable_to_on_do_not_start', () => { configureWith({ [S]: 'on', [P]: 'unavailable' }); set(P,'on'); expect(log).toEqual([]) })
it('ends_30s_after_off_with_reminder', () => {
  set(S,'on'); vi.advanceTimersByTime(10_000); set(S,'off'); vi.advanceTimersByTime(29_999)
  expect(m.led(3)).toBe('alert'); vi.advanceTimersByTime(1)
  expect(m.led(3)).toBe('reminder'); expect(log).toEqual(['start 3', 'end 3'])
})
it('several_sensors_make_one_alert', () => { // Review Focus 2
  set(S,'on'); vi.advanceTimersByTime(5_000); set(P,'on'); set(S,'off'); vi.advanceTimersByTime(40_000)
  expect(m.led(3)).toBe('alert'); set(P,'off'); vi.advanceTimersByTime(30_000)
  expect(log).toEqual(['start 3', 'end 3'])
})
it('detection_during_calm_extends_without_restart', () => { set(S,'on'); set(S,'off'); vi.advanceTimersByTime(20_000); set(S,'on'); set(S,'off'); vi.advanceTimersByTime(29_999); expect(log).toEqual(['start 3']) })
it('capped_at_5min_then_silent_until_calm', () => {
  for (let i = 0; i < 20; i++) { set(S,'on'); vi.advanceTimersByTime(10_000); set(S,'off'); vi.advanceTimersByTime(10_000) } // 400 s
  expect(log).toEqual(['start 3', 'end 3']); expect(m.led(3)).toBe('reminder')
  vi.advanceTimersByTime(20_000); set(S,'on'); expect(log).toEqual(['start 3', 'end 3', 'start 3'])
})
it('stuck_sensor_does_not_block_others', () => {
  set(S,'on'); vi.advanceTimersByTime(STUCK_MS + CALM_MS); set(P,'on')
  expect(log).toEqual(['start 3', 'end 3', 'start 3'])
})
it('seen_is_silent_until_calm', () => {
  set(S,'on'); m.markSeen(3); expect(m.led(3)).toBe('none')
  set(S,'off'); vi.advanceTimersByTime(20_000); set(S,'on'); set(S,'off'); vi.advanceTimersByTime(30_000)
  expect(log).toEqual(['start 3']); expect(m.led(3)).toBe('none')
  set(S,'on'); expect(log).toEqual(['start 3', 'start 3'])
})
it('seen_clears_reminder', () => { set(S,'on'); set(S,'off'); vi.advanceTimersByTime(30_000); m.markSeen(3); expect(m.led(3)).toBe('none') })
it('same_camera_pages_start_together_and_are_seen_together', () => { // pages 3 et 5 : même entityId, mêmes capteurs
  set(S,'on'); expect(log).toEqual(['start 3,5']); m.markSeen(5); expect([m.led(3), m.led(5)]).toEqual(['none', 'none'])
})
it('entities_gone_end_the_alert_and_return_silent', () => { // Review Focus 3
  set(S,'on'); m.update({}); vi.advanceTimersByTime(30_000); m.update(withStates({ [S]: 'on' }))
  expect(log).toEqual(['start 3', 'end 3'])
})
it('missing_sensor_is_ignored', () => { configureWith({ [P]: 'off' }); set(P,'on'); expect(log).toEqual(['start 3']) }) // Review Focus 4
it('configure_resets_everything', () => { set(S,'on'); configureWith({ [S]: 'on' }); expect(m.led(3)).toBe('none'); vi.advanceTimersByTime(600_000); expect(log).toEqual(['start 3']) })
it('dispose_leaves_no_timers', () => { set(S,'on'); m.dispose(); expect(vi.getTimerCount()).toBe(0) })
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm exec vitest run test/alerts.test.ts` ; attendu : module introuvable.
- [ ] **Step 3 : Implémenter `AlertMonitor`** selon l'automate ci-dessus ; un seul `onStart` par `update`, appelé une fois toutes les pages à jour.
- [ ] **Step 4 : Vérifier** — même commande ; attendu : tout passe.
- [ ] **Step 5 : Commit** — `feat(alertes): suivi des détections par page caméra`

---

### Task 3 : Vibration d'alerte et image effacée

**Files :**
- Modify : `src/device/link.ts` (`vibrate`), `src/dashboards/types.ts`, `src/dashboards/camera.ts`
- Test : `test/device/link.test.ts`, `test/dashboards/camera.test.ts`

**Interfaces :**
- Produces : `DeviceLink.vibrate(kind: 'ok' | 'error' | 'alert')` ; `Dashboard.prepareAlert?(): void`, appelé avant `activate()` quand une alerte ouvre la page.

- [ ] **Step 1 : Écrire les tests**

```ts
// link.test.ts, vibrate_patterns : ajouter link.vibrate('alert')
expect(patterns).toEqual([0x01, 0x48, 0x6a])
// camera.test.ts
it('alert_hides_the_old_image_until_a_new_one', async () => {
  const d = make(probe({ delay: 500 })); d.activate(); await vi.advanceTimersByTimeAsync(500); d.deactivate()
  expect(fv(d).image).not.toBeNull()
  d.prepareAlert!(); d.activate()
  expect(fv(d)).toMatchObject({ image: null, message: 'Chargement…', stale: false })
  await vi.advanceTimersByTimeAsync(500)
  expect(fv(d)).toMatchObject({ message: null }); expect(fv(d).image).not.toBeNull(); d.deactivate()
})
it('alert_with_unreachable_camera_says_so', async () => { // Review Focus 1
  const d = make(probe({ fail: () => true })); d.prepareAlert!(); d.activate(); await flush()
  expect(fv(d).message).toBe('Image non disponible'); d.deactivate()
})
it('normal_opening_keeps_the_last_image', async () => {
  const d = make(probe()); d.activate(); await flush(); d.deactivate(); d.activate()
  expect(fv(d).image).not.toBeNull(); d.deactivate()
})
```

- [ ] **Step 2 : Vérifier l'échec** — `pnpm exec vitest run test/device/link.test.ts test/dashboards/camera.test.ts`.
- [ ] **Step 3 : Implémenter** — `HAPTIC_RISE_FALL = 0x6a` ; `prepareAlert` efface l'image et pose `loading = true`. `loading` repasse à faux à la première image, au premier échec et à `deactivate`. Un échec doit demander un nouveau rendu quand `loading` était vrai.
- [ ] **Step 4 : Vérifier** — même commande ; attendu : tout passe.
- [ ] **Step 5 : Commit** — `feat(caméra): vibration d'alerte et image précédente effacée à l'ouverture`

---

### Task 4 : `Navigator` — ouverture, retour, LED

**Files :**
- Modify : `src/navigator.ts` (seul fichier de production), `test/editor/server.test.ts` (`StubDevice.vibrate = vi.fn()`)
- Test : `test/navigator.test.ts`, `test/app.test.ts`

**Interfaces :**
- Consumes : `AlertMonitor`, `AlertPage` (Task 2) ; `vibrate('alert')`, `prepareAlert` (Task 3) ; `CameraDashboard.alert` (Task 1).
- Produces : `DevicePort` inclut `'vibrate'`. `createApp` n'a rien à changer : `DeviceLink` fournit déjà la méthode.

**Règles** (`home` = dernière page ouverte par l'utilisateur ; `autoOpened` = page active ouverte par une alerte) :

| Événement | Effet |
|---|---|
| `onStart(pages)` | `vibrate('alert')` une fois. N'ouvre rien si la page active est dans `pages`, ou si le dernier geste a moins de 5 000 ms. Sinon ouvre `pages[0]` (`prepareAlert`, `activate`), `autoOpened = true`, minuteur de retour annulé, rien n'est enregistré. |
| `onEnd(i)` | Si `autoOpened` et `i` est la page active : retour à `home`. Sinon rien. |
| Geste quelconque | Note l'heure ; `markSeen(page active)`. Si `autoOpened` : (re)lance le retour dans 300 000 ms. Puis effet normal. |
| Bouton d'une autre page | En plus : ouvre la page, `home` = elle, enregistrée, `autoOpened = false`, minuteur annulé, `markSeen` de cette page. |
| Bouton de la page affichée, `autoOpened` | `home` = elle, enregistrée, `autoOpened = false`, minuteur annulé. |
| `applyConfig` | Si `autoOpened`, la page active redevient `home` avant le calcul existant ; puis `configure` avec les pages caméra dont l'alerte est activée. `home` = page active finale. |

LED : `led(i)` `'alert'` → alterne `#FF00FF` (d'abord) et `#000000` toutes les 250 ms ; `'reminder'` → `#FF00FF` fixe ; `'none'` → couleur actuelle. Le rouge de l'image figée ne s'écrit jamais sur un bouton en `'alert'` ou `'reminder'`. `dispose` annule tous les minuteurs et abonnements.

- [ ] **Step 1 : Écrire les tests** (minuteurs simulés ; pages 3 et 4 = caméras `camera.a` / `camera.b`, alertes sur `S3` / `S4`, départ à `off` ; `fire(id)` = `off` puis `on` ; `clear(id)` = `off` ; `press(i)` = `emit({ type: 'button', id: i })` ; `turn()` = une molette ; page active de départ 0)

```ts
it('alert_opens_vibrates_without_persisting', () => { fire(S3); expect(nav.activeIndex()).toBe(3); expect(device.vibrate.mock.calls).toEqual([['alert']]); expect(setActive).not.toHaveBeenCalled() })
it('alert_calls_prepare_before_activate', () => { fire(S3); expect(made[3].prepareAlert.mock.invocationCallOrder[0]).toBeLessThan(made[3].activate.mock.invocationCallOrder[0]!) })
it('returns_home_after_calm', async () => { fire(S3); clear(S3); await adv(30_000); expect(nav.activeIndex()).toBe(0); expect(lastLed(3)).toBe('#FF00FF') })
it('no_opening_within_5s_of_a_gesture', async () => { turn(); await adv(4_999); fire(S3); expect(nav.activeIndex()).toBe(0); expect(device.vibrate).toHaveBeenCalledTimes(1); await adv(60_000); expect(nav.activeIndex()).toBe(0) })
it('opens_5s_after_a_gesture', async () => { turn(); await adv(5_000); fire(S3); expect(nav.activeIndex()).toBe(3) })
it('already_displayed_page_never_returns', async () => { press(3); await adv(5_000); fire(S3); clear(S3); await adv(30_000); expect(nav.activeIndex()).toBe(3) })
it('latest_alert_takes_the_screen_then_home', async () => { fire(S3); fire(S4); expect(nav.activeIndex()).toBe(4); clear(S4); await adv(30_000); expect(nav.activeIndex()).toBe(0) })
it('end_of_hidden_alert_keeps_screen', async () => { fire(S3); fire(S4); clear(S3); await adv(30_000); expect(nav.activeIndex()).toBe(4) })
it('gesture_marks_seen_and_returns_after_5min', async () => { fire(S3); turn(); clear(S3); await adv(200_000); expect(nav.activeIndex()).toBe(3); turn(); await adv(299_999); expect(nav.activeIndex()).toBe(3); await adv(1); expect(nav.activeIndex()).toBe(0); expect(lastLed(3)).not.toBe('#FF00FF') })
it('own_button_keeps_the_camera', async () => { fire(S3); press(3); expect(setActive).toHaveBeenCalledWith(3); await adv(600_000); expect(nav.activeIndex()).toBe(3) })
it('other_button_wins_and_marks_seen', async () => { fire(S3); press(2); expect(nav.activeIndex()).toBe(2); await adv(600_000); expect(nav.activeIndex()).toBe(2); expect(lastLed(3)).not.toBe('#FF00FF') }) // Review Focus 5
it('gesture_on_another_page_does_not_mark_seen', async () => { turn(); fire(S3); turn(); clear(S3); await adv(30_000); expect(lastLed(3)).toBe('#FF00FF') })
it('button_clears_the_reminder', async () => { fire(S3); clear(S3); await adv(30_000); press(3); expect(lastLed(3)).not.toBe('#FF00FF') })
it('blinks_every_250ms', async () => { fire(S3); device.setLed.mockClear(); await adv(500); expect(ledsOf(3)).toEqual(['#000000', '#FF00FF']) })
it('alert_hides_stale_red', async () => { made[3].stale = true; fire(S3); await adv(3_000); expect(ledsOf(3)).not.toContain('#FF0000') })
it('reconnect_restores_alert_led', () => { turn(); fire(S3); device.setLed.mockClear(); device.status('connected'); expect(ledsOf(3)[0]).toMatch(/^#(FF00FF|000000)$/) })
it('config_change_ends_alerts_and_goes_home', async () => { fire(S3); nav.applyConfig(alertConfig()); expect(nav.activeIndex()).toBe(0); await adv(600_000); expect(lastLed(3)).not.toBe('#FF00FF') })
it('disabled_alert_does_nothing', () => { nav.applyConfig(alertConfig({ enabled: false })); fire(S3); expect(nav.activeIndex()).toBe(0); expect(device.vibrate).not.toHaveBeenCalled() })
it('dispose_during_alert_leaves_no_timers', () => { fire(S3); nav.dispose(); expect(vi.getTimerCount()).toBe(0) })
// app.test.ts : page 3 = caméra avec alerte sur binary_sensor.porte, puis off → on sur has[0]
it('camera_alert_end_to_end', …) // expect(a.navigator.activeIndex()).toBe(3) ; callsOf('vibrate') contient 0x6a ; state.json : activeButton toujours 0 ou absent
```

Les faux tableaux gagnent `prepareAlert: vi.fn()` et `FakeDevice` gagne `vibrate = vi.fn()`.

- [ ] **Step 2 : Vérifier l'échec** — `pnpm exec vitest run test/navigator.test.ts test/app.test.ts`.
- [ ] **Step 3 : Implémenter** selon le tableau ; extraire de `switchTo` une méthode privée `show(i: number, alert: boolean): void` (désactive, change `active`, `prepareAlert` si `alert`, active, LED, rendu, `emitActive`), sans enregistrement. Le mode Essayer passe par `page.handle`, donc ne compte pas comme geste : ne rien changer au serveur.
- [ ] **Step 4 : Vérifier** — `pnpm test` et `pnpm exec tsc -p . --noEmit` ; attendu : tout passe, anciens tests du Navigator compris.
- [ ] **Step 5 : Commit** — `feat(console): une détection ouvre la caméra, clignote et vibre`

---

### Task 5 : Éditeur et README

**Files :**
- Create : `src/shared/alerts.ts`, `editor/src/components/CameraAlert.vue`
- Modify : `editor/src/components/DashboardEntities.vue` (affiche `<CameraAlert>` sous « Cadrage » ; `setEntity`), `README.md` (puce **Caméras**)
- Test : `test/shared/alerts.test.ts`, `editor/test/camera-alert.test.ts`

**Interfaces :**
- Consumes : `EntityInfo.deviceId`, `SlotKind 'alert'`, `CameraAlert` (Task 1) ; `save`, `state`, `EntityPicker`.
- Produces :

```ts
/** binary_sensor du même appareil que la caméra, de classe motion, occupancy ou presence, triés par nom. */
export function alertCandidates(cameraId: string | null, entities: EntityInfo[]): EntityInfo[]
/** Ids reconnus par /person|package|parcel|colis/i dans l'id ou le nom ; aucun reconnu : tous. */
export function defaultAlertSensors(candidates: EntityInfo[]): string[]
/** « Personne », « Colis », « Véhicule », « Animal », « Mouvement », sinon le nom de l'entité. */
export function alertLabel(e: EntityInfo): string
```

- [ ] **Step 1 : Écrire les tests**

```ts
// alerts.test.ts — camera.a et 4 capteurs *_person_detected, *_package_detected, *_vehicle_detected, *_animal_detected sur 'dev1'
expect(alertCandidates('camera.a', all).map((e) => e.entityId)).toEqual([/* les 4, par nom */])
// exclus : autre appareil, classe 'door', domaine 'sensor' ; caméra nulle, inconnue ou sans appareil → []
expect(defaultAlertSensors(four)).toEqual(['binary_sensor.a_package_detected', 'binary_sensor.a_person_detected'])
expect(defaultAlertSensors([motionOnly])).toEqual(['binary_sensor.b_motion'])
expect(four.map(alertLabel).sort()).toEqual(['Animal', 'Colis', 'Personne', 'Véhicule'])
expect(alertLabel(entity('binary_sensor.portail'))).toBe('portail')

// camera-alert.test.ts (mountEditor, page 3 = caméra camera.a)
it('enabling_checks_person_and_package')      // coche .alert-enabled → PUT alert { enabled: true, sensors: [package, person] }
it('disabling_keeps_sensors')                 // PUT enabled: false, sensors inchangés
it('toggling_a_sensor')                       // coche vehicle → ajouté ; décoche person → retiré
it('add_other_sensor')                        // select.alert-picker → binary_sensor.portail ajouté, sans doublon
it('missing_sensor_is_shown_and_removable')   // capteur absent de Home Assistant : id affiché, « Retirer » le retire (Review Focus 4)
it('no_sensor_hint')                          // activée, sensors vide → « Cochez ou ajoutez au moins un capteur : sans capteur, rien n’alerte. »
it('changing_camera_resets_alert')            // select.entity-picker → autre caméra : PUT alert { enabled: false, sensors: [] }
it('absent_without_camera_entity')            // entityId null : pas de .alert-enabled
```

Chaque test du composant vérifie `m.puts().at(-1)!.body.buttons[3].alert` (ou le texte affiché) avec les valeurs en commentaire.

- [ ] **Step 2 : Vérifier l'échec** — `pnpm exec vitest run test/shared/alerts.test.ts` et `pnpm --dir editor exec vitest run test/camera-alert.test.ts`.
- [ ] **Step 3 : Implémenter** — `CameraAlert.vue` reçoit `index: number`. Cases : candidats, puis capteurs enregistrés hors candidats avec « Retirer ». Les capteurs par défaut ne sont posés qu'à l'activation avec `sensors` vide. Classes : `.alert-enabled`, `.alert-sensor` (attribut `data-id`), `.alert-remove`, `select.alert-picker` (libellé « Ajouter un autre capteur… »).
- [ ] **Step 4 : README** — ajouter à la puce **Caméras** : « **Alerte** : quand un capteur coché détecte quelque chose, la console vibre, le bouton clignote en magenta et la caméra s'ouvre. L'écran revient seul après 30 s sans détection (5 minutes sans geste si vous avez touché la console) ; un bouton magenta fixe signale une alerte non vue. Rien ne s'ouvre dans les 5 s qui suivent un geste. »
- [ ] **Step 5 : Vérifier** — `pnpm test` et `pnpm run build` ; attendu : tout passe.
- [ ] **Step 6 : Commit** — `feat(éditeur): choix des capteurs d'alerte d'une caméra ; README`

---

### Task 6 : Vérification sur la console, avec l'utilisateur

**Files :** aucun (corriger la constante `HAPTIC_RISE_FALL` si le motif ne convient pas, avec son test).

- [ ] **Step 1** — Quitter l'application installée (icône → **Quitter**), puis `pnpm run build` et `pnpm start`. Attendu : « Console connectée ».
- [ ] **Step 2** — Activer l'alerte de la sonnette dans l'éditeur. Attendu : les quatre capteurs proposés, personne et colis cochés. Les pages P1S et Tapo : noter ce qui est proposé.
- [ ] **Step 3** — L'utilisateur force « personne » à `off` puis `on` dans Home Assistant (Outils de développement → États). Attendu : vibration et clignotement en moins de 0,5 s, « Chargement… » puis l'image. Remettre à `off` : retour 30 s plus tard, bouton magenta fixe.
- [ ] **Step 4** — L'utilisateur juge la vibration (`RISE_FALL`) et le magenta.
- [ ] **Step 5** — Passage réel devant la sonnette : noter le délai entre la console et le téléphone, et les notifications Telus sans alerte. Reporter le résultat à l'utilisateur ; s'il en manque trop, proposer l'approche 2 de la spec, sans la construire.
