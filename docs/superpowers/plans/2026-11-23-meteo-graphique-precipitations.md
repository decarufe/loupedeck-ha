# Météo : graphique des précipitations — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Remplacer les jours 6 à 8 de la page Météo par un graphique continu (−8 h → +4 h) sur les touches 9, 10 et 11 : barres de pluie/neige, température et température ressentie canadienne.

**Architecture :** Un nouveau dossier `src/weather/` contient du code pur et testable (formules canadiennes, classement pluie/neige, client Open-Meteo). Le tableau Météo (`src/dashboards/weather.ts`) récupère la position de la maison via `HaPort`, appelle Open-Meteo toutes les 15 min et expose un champ `outlook` dans `WeatherView`. `paintWeather` dessine ce champ sur le rectangle des touches 9 à 11.

**Tech Stack :** TypeScript (ESM, Node ≥ 24, `fetch` global), vitest, `@napi-rs/canvas`, `home-assistant-js-websocket` (`getConfig`). Gestionnaire de paquets : **pnpm uniquement, jamais npm ni npx**.

**Spec :** `docs/superpowers/specs/2026-11-23-meteo-graphique-precipitations-design.md` (à lire en entier avant de commencer).

## Global Constraints

- Touches 9, 10, 11 = rectangle `x 150..420`, `y 180..270` (`keyRect(9)`, `keyRect(11)`). Période affichée : `now − 8 h` → `now + 4 h` ; « maintenant » tombe à `x = 330` (frontière touches 10 / 11).
- Les touches 4 à 8 gardent les jours : **5 jours maximum** (`MAX_DAYS = 5`).
- Rafraîchissement du graphique : **15 min** (`OUTLOOK_REFRESH_MS = 900_000`).
- Position envoyée à Open-Meteo : **arrondie à 2 décimales** (~1 km). Jamais la position exacte.
- Aucune phrase de résumé. Aucun texte à cheval sur une frontière de touche.
- Textes en français, accents corrects. Messages d'état exacts : `Position inconnue` et `Prévision indisponible`, affichés dans la touche 10 ; les touches 9 et 11 restent vides.
- Couleurs : pluie `#2F80ED`, neige `#E8F4FF`, température `#FFB300`, ressentie `#FF7043` (zone = ressentie à 25 % d'opacité). Barres dessinées **après** les lignes (les lignes passent derrière).
- Hors ligne ou erreur de service avec données déjà reçues : on garde la dernière courbe, `stale: true`, dessinée à 40 % d'opacité.
- Commandes : `pnpm exec vitest run <fichier>`, `pnpm exec tsc --noEmit`, `pnpm test`.

## Review Focus

- Heure avec pluie à 0 mm mais probabilité ≥ 30 % : type d'après le code météo (neige 71–77, 85, 86 ; verglas 56, 57, 66, 67 → mélange ; sinon pluie), jamais « aucune ».
- Pluie à T ≤ 0 °C : classée **mélange** (pluie verglaçante).
- Réponse Open-Meteo avec des `null` (valeurs manquantes) : points ignorés, pas de plantage ni de `NaN` dans les lignes.
- Vent ≤ 4,8 km/h ou humidex < 25 : la ligne ressentie égale la température (zone nulle, pas de trou).
- Home Assistant sans coordonnées valides (0/0 ou absentes) : `Position inconnue`, aucune requête Open-Meteo.
- Changement de tableau pendant une requête : le résultat tardif est ignoré (même mécanisme d'`epoch` que les prévisions).

---

### Task 1 : Formules canadiennes de température ressentie

**Files:**
- Create: `src/weather/feels-like.ts`
- Test: `test/weather/feels-like.test.ts`

**Interfaces:**
- Produces : `humidex(tempC: number, dewPointC: number): number`, `windChill(tempC: number, windKmh: number): number`, `feelsLike(tempC: number, dewPointC: number, windKmh: number): number`.

- [ ] **Step 1 : Écrire le test** `feels-like.test.ts` (tolérance `toBeCloseTo(x, 1)`) :
  - `humidex(30, 20)` ≈ 37,6 ; `humidex(25, 15)` ≈ 29,0.
  - `windChill(-10, 20)` ≈ -17,9 ; `windChill(-20, 30)` ≈ -32,6 ; `windChill(-5, 10)` ≈ -9,3.
  - `feelsLike(-10, -15, 20)` ≈ -17,9 (refroidissement : T ≤ 0 et vent > 4,8).
  - `feelsLike(-10, -15, 4)` = -10 (vent trop faible).
  - `feelsLike(30, 20, 5)` ≈ 37,6 (humidex ≥ 25).
  - `feelsLike(20, 5, 5)` = 20 (humidex < 25).
- [ ] **Step 2 :** `pnpm exec vitest run test/weather/feels-like.test.ts` → échec (module absent).
- [ ] **Step 3 : Implémenter** les trois fonctions. Humidex : `T + 0,5555 × (e − 10)` avec `e = 6,11 × exp(5417,753 × (1/273,16 − 1/(Td + 273,16)))`. Refroidissement : `13,12 + 0,6215·T − 11,37·v^0,16 + 0,3965·T·v^0,16`. `feelsLike` : refroidissement si `T ≤ 0` et `v > 4,8` ; sinon humidex s'il vaut au moins 25 ; sinon `T`.
- [ ] **Step 4 :** relancer le test → succès.
- [ ] **Step 5 : Commit** `feat(météo): formules canadiennes d'humidex et de refroidissement éolien`

### Task 2 : Classement pluie / neige / mélange

**Files:**
- Create: `src/weather/precip.ts`
- Test: `test/weather/precip.test.ts`

**Interfaces:**
- Produces : `type PrecipKind = 'none' | 'rain' | 'snow' | 'mix'`
- `splitPrecip(precipMm: number, snowfallCm: number): { rainMm: number; snowMm: number }` — `snowMm = snowfallCm / 0,7`, `rainMm = max(0, precipMm − snowMm)`.
- `classifyPrecip(i: { rainMm: number; snowMm: number; tempC: number; probability: number | null; weatherCode: number }): PrecipKind`

- [ ] **Step 1 : Écrire le test**, une assertion par cas :
  - `rainMm` 2, `snowMm` 0 à 8 °C → `rain` ; `rainMm` 0, `snowMm` 1 à -5 °C → `snow`.
  - pluie 1 mm + neige 1 mm → `mix` (chacune ≥ 30 % du total) ; pluie 1 mm + neige 0,1 mm → `rain`.
  - pluie 1 mm à -2 °C → `mix` (pluie verglaçante).
  - 0 mm, probabilité 60 %, code 73 → `snow` ; code 61 → `rain` ; code 66 → `mix`.
  - 0 mm, probabilité 20 %, code 61 → `none` ; 0 mm, probabilité `null` → `none`.
  - `splitPrecip(3, 1.4)` → `{ rainMm: 1, snowMm: 2 }` ; `splitPrecip(1, 1.4)` → `{ rainMm: 0, snowMm: 2 }` (jamais négatif) ; `splitPrecip(0, 0)` → `{ rainMm: 0, snowMm: 0 }`.
- [ ] **Step 2 :** lancer, échec attendu.
- [ ] **Step 3 : Implémenter.** Total nul → seuil de probabilité 30 % puis code météo ; sinon la plus grande quantité l'emporte, `mix` si les deux dépassent 30 % du total ; pluie avec `tempC ≤ 0` → `mix`.
- [ ] **Step 4 :** lancer, succès.
- [ ] **Step 5 : Commit** `feat(météo): classement pluie, neige et mélange`

### Task 3 : Client Open-Meteo

**Files:**
- Create: `src/weather/openmeteo.ts`, `test/weather/fixtures/openmeteo-hourly.json`
- Test: `test/weather/openmeteo.test.ts`

**Interfaces:**
- Consumes : `feelsLike` (Task 1), `splitPrecip` et `classifyPrecip` (Task 2).
- Produces :
  - `interface OutlookPoint { t: number; temp: number; feels: number; mm: number; kind: PrecipKind; prob: number | null }` (`t` = début de l'heure, en ms).
  - `interface GeoPoint { latitude: number; longitude: number }`
  - `buildOutlookUrl(loc: GeoPoint): string`
  - `parseOutlook(json: unknown): OutlookPoint[]`
  - `fetchOutlook(loc: GeoPoint, fetchFn?: typeof fetch): Promise<OutlookPoint[]>` (rejette si HTTP non 2xx).

- [ ] **Step 1 : Vérifier l'API** (documentation officielle Open-Meteo, Context7 ou le site) : `past_hours`, `forecast_hours`, `timezone`, unités. Écrire la fixture JSON (12 heures) conforme à la vraie réponse.
- [ ] **Step 2 : Écrire le test :**
  - `buildOutlookUrl({ latitude: 45.50169, longitude: -73.56725 })` contient `latitude=45.5`, `longitude=-73.57`, `past_hours=8`, `forecast_hours=4`, `timezone=UTC` et les variables horaires `temperature_2m,dew_point_2m,wind_speed_10m,precipitation,snowfall,precipitation_probability,weather_code`. Ne doit contenir aucune décimale au-delà de la 2ᵉ.
  - `parseOutlook(fixture)` renvoie 12 points triés, `t` en ms, `feels` calculé avec `feelsLike`, `kind` de `classifyPrecip`, `prob` repris du JSON.
  - Une valeur `null` dans `temperature_2m` → ce point est ignoré.
  - `fetchOutlook` avec un `fetchFn` simulé : une 500 → rejet avec un message en français.
- [ ] **Step 3 :** lancer, échec attendu.
- [ ] **Step 4 : Implémenter** les trois fonctions. Les heures sont lues en UTC (`timezone=UTC`, suffixe `Z` ajouté avant `Date.parse`). Vent en km/h (défaut d'Open-Meteo). Délai maximum 10 s (`AbortSignal.timeout`).
- [ ] **Step 5 :** lancer, succès. **Step 6 : Commit** `feat(météo): client Open-Meteo (−8 h à +4 h)`

### Task 4 : Position de la maison dans `HaPort`

**Files:**
- Modify: `src/ha/types.ts` (interface `HaPort`), `src/ha/client.ts` (près de `getHistory`, ligne ~293), `test/fakes/fake-ha.ts`
- Test: `test/ha/client.test.ts` (suivre le style des tests de `getHistory`)

**Interfaces:**
- Produces : `HaPort.homeLocation(): Promise<GeoPoint | null>` (importer `GeoPoint` en type depuis `src/weather/openmeteo.ts`). `FakeHa.location: GeoPoint | null = { latitude: 45.5, longitude: -73.5 }`.

- [ ] **Step 1 : Test** : le client (message `get_config` simulé par le faux serveur de `test/fakes/mock-ha-server.ts`) renvoie `{ latitude, longitude }` ; coordonnées absentes ou `0/0` → `null`. Hors ligne → rejet (`requireConn`).
- [ ] **Step 2 :** lancer, échec attendu.
- [ ] **Step 3 : Implémenter** avec `getConfig(conn)` de `home-assistant-js-websocket`, en passant par `toError(err, this.scrub)` comme les autres méthodes. Ajouter la méthode au faux HA.
- [ ] **Step 4 :** `pnpm exec vitest run test/ha` puis `pnpm exec tsc --noEmit`.
- [ ] **Step 5 : Commit** `feat(ha): position de la maison`

### Task 5 : Le tableau Météo récupère le graphique

**Files:**
- Modify: `src/views.ts` (type `WeatherView`), `src/dashboards/types.ts` (`DashboardDeps`), `src/dashboards/weather.ts`
- Test: `test/dashboards/weather.test.ts`

**Interfaces:**
- Consumes : `HaPort.homeLocation` (Task 4), `fetchOutlook` et `OutlookPoint` (Task 3).
- Produces :
  - `interface WeatherOutlook { points: OutlookPoint[]; start: number; now: number; end: number; stale: boolean; message: string | null }` et `WeatherView.outlook?: WeatherOutlook | null` dans `src/views.ts`.
  - `DashboardDeps.fetchOutlook?: (loc: GeoPoint) => Promise<OutlookPoint[]>` (optionnel ; par défaut `fetchOutlook` du Task 3).
  - Exports de `weather.ts` : `OUTLOOK_REFRESH_MS = 900_000`.

- [ ] **Step 1 : Écrire les tests** (`FakeHa`, `vi.useFakeTimers`, `deps.fetchOutlook` simulé ; adapter les tests existants) :
  - `aggregate_caps_8` devient `aggregate_caps_5` : `MAX_DAYS = 5`.
  - Après `activate()` et `flush()`, `view().outlook.points` contient les points simulés ; `start = now − 8 h`, `end = now + 4 h`, `message = null`, `stale = false`.
  - `ha.location = null` → `outlook.message = 'Position inconnue'`, `fetchOutlook` jamais appelé.
  - `fetchOutlook` rejette et aucune donnée avant → `message = 'Prévision indisponible'`.
  - `fetchOutlook` rejette après un succès → points conservés, `stale = true`.
  - `OUTLOOK_REFRESH_MS` plus tard → nouvel appel. Un appui sur la zone « Actualiser » rappelle aussi `fetchOutlook`.
  - `deactivate()` pendant la requête → résultat tardif ignoré (aucun `requestRender`).
- [ ] **Step 2 :** lancer, échec attendu.
- [ ] **Step 3 : Implémenter** dans `weather.ts` : état `outlook`/`outlookError`, une fonction `loadOutlook()` protégée comme `fetchForecasts` (`epoch`, `inFlight`), un second `setInterval` de `OUTLOOK_REFRESH_MS`, appel dans `activate()` et dans `refresh()`, nettoyage dans `deactivate()`. Un `setInterval` de 60 s appelle `d.requestRender()` pour déplacer le trait « maintenant ». `view()` remplit `outlook` (position/erreur → `message`, jamais `undefined` quand un identifiant d'entité est configuré).
- [ ] **Step 4 :** `pnpm exec vitest run test/dashboards/weather.test.ts` puis `pnpm exec tsc --noEmit`.
- [ ] **Step 5 : Commit** `feat(météo): récupérer le graphique des précipitations`

### Task 6 : Dessin du graphique sur les touches 9 à 11

**Files:**
- Modify: `src/render/painters.ts` (`paintWeather`, ligne ~266 ; boucle des jours : `i < 5`)
- Test: `test/render/painters.test.ts` (adapter les cas à 8 jours, ligne ~285 ; ajouter ceux ci-dessous)

**Interfaces:**
- Consumes : `WeatherOutlook` (Task 5).
- Produces : `paintOutlook(ctx: SKRSContext2D, o: WeatherOutlook): void` (interne à `painters.ts`).

- [ ] **Step 1 : Écrire les tests** (pixels, comme `px()` existant ; zone `x 150..420`, `y 180..270`, `now` fixé, points horaires construits dans le test) :
  - Une barre pluie passée de 2 mm : pixel au centre de la barre, 3 px au-dessus du bas du rectangle = `#2F80ED` (hauteur max car mm ≥ échelle minimale de 2 mm).
  - Une barre neige : pixel = `#E8F4FF`.
  - Une barre prévision à 50 % : plus petite que la barre passée, et plus pâle (canal rouge du pixel ≠ celui de la barre pleine).
  - Une barre passée de 0,2 mm est visible (au moins 2 px de haut).
  - `message: 'Position inconnue'` : aucun pixel de barre, du texte dans `keyRect(10)`, rien dans `keyRect(9)` ni `keyRect(11)`.
  - `stale: true` : le pixel de la barre est plus sombre que `#2F80ED`.
  - Les touches 9 à 11 ne contiennent plus de jours avec 8 jours dans `days` ; la touche 8 en contient encore un.
  - Le trait « maintenant » : pixel à `x = 330` en haut du graphique, différent du fond.
- [ ] **Step 2 :** lancer, échec attendu.
- [ ] **Step 3 : Implémenter.** Abscisse `x = 150 + (t − start) / (end − start) × 270`. Chaque point = barre de 1 h (`t` → `t + 1 h`), écart de 2 px, découpée aux bords. Passé (`t ≤ now`) : hauteur = `mm / max(2, plus grand mm visible)` ; prévision (`t > now`) : hauteur = `prob / 100` (retour à `mm` si `prob` est `null`) et opacité 0,45. Hauteur maximale des barres : 60 % du rectangle ; hauteur minimale 2 px si le type n'est pas `none`. Lignes température et ressentie sur une échelle commune (marges de 6 px), zone entre les deux (25 %). Mélange : bandes diagonales de 4 px alternant pluie et neige (clip). Flocon `mdi:snowflake` (12 px) au-dessus de la barre neige la plus haute si la place le permet. Trait pointillé vertical « maintenant ». `stale` : tout à 40 % d'opacité. `message` : `paintWrapped` dans `keyRect(10)`.
- [ ] **Step 4 :** lancer le fichier de tests, puis `pnpm test` en entier.
- [ ] **Step 5 : Vérification visuelle** : écrire dans le dossier temporaire un petit script `tsx` qui dessine une vue d'exemple (pluie, neige, mélange, prévision) et enregistre un PNG ; l'ouvrir et vérifier le rendu (barres lisibles, lignes derrière, zone visible, rien de coupé).
- [ ] **Step 6 : README** : ajouter 3 lignes sur le graphique (Open-Meteo, position de la maison arrondie, 15 min).
- [ ] **Step 7 : Commit** `feat(météo): graphique des précipitations sur les trois dernières touches`

---

## Auto-revue

- **Couverture de la spec** : visuel (Task 6), source et formules (Tasks 1–3), position et vie privée (Tasks 3–4), états vide et hors ligne (Tasks 5–6), 5 jours (Tasks 5–6). Pas de phrase de résumé (retirée par l'utilisateur).
- **Cohérence des types** : `OutlookPoint`, `GeoPoint`, `PrecipKind`, `WeatherOutlook` définis une seule fois (Tasks 2, 3, 5) et réutilisés sous le même nom.
- **Laissé au constructeur** : paramètres exacts de l'API (vérifiés à la Task 3), fuseau, détails du dessin hors valeurs pinées.
