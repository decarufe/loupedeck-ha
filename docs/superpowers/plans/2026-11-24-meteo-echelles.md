# Météo : échelles, fond du futur et barres en mm — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Ajouter au graphique météo (touches 9 à 11) les échelles de température, de précipitations et de temps, un fond grisé pour le futur (lignes et barres désaturées), et des barres dont la hauteur est toujours en mm.

**Architecture :** Les calculs d'échelle sont purs et testés dans `src/weather/scales.ts`. Le dessin reste dans `src/render/painters.ts` (`paintOutlook` et ses aides) et les données (`WeatherOutlook`) ne changent pas.

**Tech Stack :** TypeScript, vitest, `@napi-rs/canvas`. **pnpm uniquement, jamais npm ni npx.**

**Spec :** `docs/superpowers/specs/2026-11-23-meteo-graphique-precipitations-design.md` (section 5, « Visuel », révision 1). Ce plan complète `docs/superpowers/plans/2026-11-23-meteo-graphique-precipitations.md`, déjà livré.

## Global Constraints

- Rectangle du graphique : `x 150..420`, `y 180..270` (`OUTLOOK_RECT`). « Maintenant » reste à `x = 330` ; chaque touche couvre 4 h.
- **Ligne de base des barres : `y = 259`** (bande de temps de 11 px en bas : `y 259..270`). Haut du graphique : `y = 186`. Hauteur maximale d'une barre : 60 % de `259 − 186`.
- Futur (`x ≥ x(now)`, jusqu'à `x = 420`, `y 180..270`) : fond `#1B1D21`. Lignes, zone et barres du futur : couleur mélangée avec `#808080` à 55 % (`mix(couleur, '#808080', 0.55)`). Le trait pointillé « maintenant » reste.
- Barres : hauteur = `mm / axeMax` (passé **et** futur), minimum 2 px si le type n'est pas `none`. Futur : opacité = `0,3 + 0,7 × prob/100` (`prob` nul → 0,6). Une heure passée à 0 mm n'a toujours aucune barre.
- Axe des mm : `axeMax = max(2, ceil(plus grand mm))`. Axe des °C : entiers qui encadrent les courbes (température et ressenti), écart minimum 2 °C ; les lignes sont tracées sur cet axe.
- Échelles : traits gris `#8A8A8A` de 3 px (bords gauche et droit, bas), textes `#E6E6E6` en 9 px, derrière chaque texte un fond `rgba(0,0,0,0.55)`. Ligne cm en `#E8F4FF`, seulement s'il y a une barre `snow` ou `mix`. Cm = mm × 0,7. Température : `-3°` (trait d'union ASCII, sans décimale). Heures locales : `14 h`.
- Couleurs existantes : pluie `#2F80ED`, neige `#E8F4FF`, température `#FFB300`, ressentie `#FF7043`.
- Commandes : `pnpm exec vitest run <fichier>`, `pnpm exec tsc --noEmit`, `pnpm test`.

## Review Focus

- Température constante ou écart de moins de 2 °C : l'axe s'élargit, aucun `NaN`, deux étiquettes distinctes.
- Écart de température très grand (plus de 15 °, plus de 40 °) : le pas des traits grandit, jamais plus de 15 traits.
- Précipitation maximale très forte (plus de 10 mm, plus de 20 mm) : le pas des traits grandit, jamais plus de 10 traits.
- Décalage horaire à 30 min ou changement d'heure : les traits d'heure tombent sur des heures locales pleines.
- Étiquette qui dépasserait du rectangle (heures aux bords, texte à droite) : omise ou alignée, jamais coupée par une autre touche.
- Données périmées (`stale`) : fond, échelles et barres sont tous atténués, pas de texte plein sur fond gris.

---

### Task 1 : Calculs d'échelle purs

**Files:**
- Create: `src/weather/scales.ts`
- Test: `test/weather/scales.test.ts`

**Interfaces:**
- Produces :
  - `niceStep(range: number, maxTicks: number): number` — plus petit pas de `[1, 2, 5, 10, 20, 50, 100, 200, 500]` tel que `range / pas ≤ maxTicks`.
  - `tempAxis(lo: number, hi: number): { lo: number; hi: number }` — `lo = floor(lo)`, `hi = ceil(hi)` ; si l'écart est inférieur à 2, `lo = floor((lo + hi) / 2 − 1)` et `hi = lo + 2`.
  - `precipAxis(maxMm: number): number` — `max(2, ceil(maxMm))`.
  - `tickValues(lo: number, hi: number, step: number): number[]` — multiples de `step` dans `[lo, hi]`, du plus petit au plus grand.
  - `hourMarks(start: number, end: number): { t: number; label: string | null }[]` — chaque heure locale pleine dans `[start, end]` ; `label = "<heure> h"` quand l'heure locale est paire, sinon `null`.
  - `formatCm(mm: number): string` — `mm × 0,7` avec au plus 1 décimale, virgule française, suffixe ` cm` (`formatCm(2)` → `1,4 cm`).

- [ ] **Step 1 : Écrire le test** `scales.test.ts` :
  - `niceStep(12, 15)` = 1 ; `niceStep(16, 15)` = 2 ; `niceStep(40, 15)` = 5 ; `niceStep(100, 15)` = 10 ; `niceStep(8, 10)` = 1 ; `niceStep(12, 10)` = 2 ; `niceStep(0, 10)` = 1.
  - `tempAxis(-2.4, 8.6)` = `{ lo: -3, hi: 9 }` ; `tempAxis(5, 5)` = `{ lo: 4, hi: 6 }` ; `tempAxis(5.2, 5.9)` = `{ lo: 4, hi: 6 }` ; `tempAxis(6, 6)` = `{ lo: 5, hi: 7 }`. Pour chacun : `lo ≤ min`, `hi ≥ max`, écart ≥ 2.
  - `precipAxis(0)` = 2 ; `precipAxis(1.2)` = 2 ; `precipAxis(2.1)` = 3 ; `precipAxis(8)` = 8.
  - `tickValues(-3, 9, 1)` a 13 valeurs de -3 à 9 ; `tickValues(-3, 9, 5)` = `[0, 5]` ; `tickValues(0, 8, 2)` = `[0, 2, 4, 6, 8]`.
  - `hourMarks(Date.UTC(2026, 10, 20, 14, 37), Date.UTC(2026, 10, 21, 2, 37))` : 12 ou 13 repères ; chacun a `getMinutes() === 0` en heure locale, est dans `[start, end]`, et son `label` vaut `` `${new Date(t).getHours()} h` `` si l'heure locale est paire, `null` sinon.
  - `formatCm(2)` = `1,4 cm` ; `formatCm(0)` = `0 cm` ; `formatCm(3)` = `2,1 cm`.
- [ ] **Step 2 :** `pnpm exec vitest run test/weather/scales.test.ts` → échec (module absent).
- [ ] **Step 3 : Implémenter** les six fonctions. `hourMarks` avance avec `setHours(h + 1)` sur une date locale (sûr au changement d'heure). `formatCm` utilise `Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1 })`.
- [ ] **Step 4 :** relancer le test → succès.
- [ ] **Step 5 : Commit** `feat(météo): calculs d'échelle du graphique`

### Task 2 : Fond du futur, désaturation et barres en mm

**Files:**
- Modify: `src/render/painters.ts` (`paintOutlook`, `paintOutlookLines`, `paintOutlookBars`)
- Test: `test/render/painters.test.ts` (bloc « météo : graphique des précipitations »)

**Interfaces:**
- Consumes : `tempAxis`, `precipAxis` (Task 1) ; `mix` existant dans `painters.ts`.
- Produces : même signature `paintOutlook(ctx, o)` ; les aides internes reçoivent la ligne de base (259) et l'axe.

- [ ] **Step 1 : Adapter les tests existants** à la nouvelle géométrie : `BOTTOM = 256` (3 px au-dessus de la base 259) ; hauteur pleine ≈ 43,8 px (sommet vers `y = 215`) ; mettre à jour les y des tests `barre_de_pluie_passee_pleine_hauteur` (pixel à `y = 219`), `flocon_au_dessus_de_la_barre_de_neige` (région `y 198..214`), `petite_pluie_reste_visible` (`y = 258` et `256`), `le_maximum_grandit_au_dela_de_2_mm` (`y = 225`), `heure_passee_sans_precipitation_mesuree_na_pas_de_barre` (`y = 258`), `lignes_de_temperature_et_zone_ressentie` (région `y 186..239`, compte sur la moitié passée seulement), `valeur_datee_maintenant_finit_au_trait_maintenant` (à droite du trait : le fond du futur `#1B1D21`, pas noir), `valeur_datee_dans_une_heure_commence_au_trait_maintenant` (à droite : couleur différente du fond du futur).
- [ ] **Step 2 : Écrire les nouveaux tests** (constante `FUTURE_BG = [0x1b, 0x1d, 0x21]`) :
  - `fond_du_futur_grise` : `px(380, 184)` = `FUTURE_BG`, `px(200, 184)` = `[0, 0, 0]`.
  - `barre_de_prevision_desaturee` : barre future `mm: 2, prob: 100` ; au pixel `BOTTOM` de son centre, `max(r,g,b) − min(r,g,b)` est inférieur à celui de la pluie passée (`#2F80ED` → 190) et différent de `RAIN`.
  - `ligne_du_futur_desaturee` : des températures plates ; aucun pixel proche de `#FFB300` (R > 240, G > 165, B < 20) à `x > 335`, et plus de 50 à `x < 325`.
  - `opacite_de_la_prevision_suit_la_probabilite` : deux barres futures `mm: 2` avec `prob: 100` et `prob: 30` ; la barre à 30 % est plus sombre (canal bleu plus faible au pixel `BOTTOM`) et de même hauteur (même pixel haut à `y = 219`, non noir/non fond pour les deux).
  - `prevision_hauteur_en_mm` : future `mm: 1, prob: 100` et passée `mm: 1` ont le même sommet (pixel à `y = 259 − 22` non fond, et à `y = 259 − 26` fond).
- [ ] **Step 3 :** lancer `pnpm exec vitest run test/render/painters.test.ts` → échecs attendus.
- [ ] **Step 4 : Implémenter.** Fond du futur dessiné en premier (`x(now)` → 420, `y 180..270`, `FUTURE_BG`, atténué par `stale`). `paintOutlookLines` est appelée deux fois (passé / futur) avec une région de coupure et des couleurs (mélangées à `#808080` à 55 % pour le futur, zone comprise) ; l'échelle verticale vient de `tempAxis` sur les extrêmes de `temp` et `feels`. Ligne de base des barres : 259 ; hauteur maximale `(259 − 186) × 0,6` ; `axeMax = precipAxis(plus grand mm)`. Barres : hauteur `mm / axeMax`, couleur du futur mélangée, opacité du futur selon la probabilité (voir contraintes). Retirer l'usage de `prob` pour la hauteur.
- [ ] **Step 5 :** lancer le fichier de tests, puis `pnpm exec tsc --noEmit`.
- [ ] **Step 6 : Commit** `feat(météo): fond du futur grisé, lignes et barres désaturées, barres en mm`

### Task 3 : Dessin des échelles

**Files:**
- Modify: `src/render/painters.ts`
- Test: `test/render/painters.test.ts`

**Interfaces:**
- Consumes : `tempAxis`, `precipAxis`, `niceStep`, `tickValues`, `hourMarks`, `formatCm` (Task 1) ; la ligne de base, l'axe et les fonctions `y(v)` de la Task 2.
- Produces : `paintOutlookScales(ctx, o, axis, mmMax, geometry)` (interne), appelée après les barres et avant le trait « maintenant ».

- [ ] **Step 1 : Écrire les tests** (comptes de pixels « clairs » : tous les canaux > 180 ; points de 12 h, températures `9 … -3` pour `tempAxis` = `-3..9`) :
  - `echelle_temperature_etiquettes_max_et_min` : des pixels clairs dans `(150, 186, 26, 16)` (haut gauche, max) et dans `(150, 226, 26, 14)` (bas gauche, min), plus de 8 dans chacun.
  - `echelle_temperature_un_trait_par_degre` : au moins 10 pixels `[138, 138, 138]` dans la colonne `x = 151`, de `y = 186` à `y = 240`.
  - `echelle_precipitations_maximum_en_mm` : un point pluie de 3 mm ; des pixels clairs dans `(388, 211, 32, 12)` (étiquette `3 mm`), plus de 6.
  - `echelle_precipitations_cm_seulement_avec_neige` : sans neige, aucun pixel `≥ 200` sur les trois canaux dans `(388, 224, 32, 10)` ; avec une barre `snow` de 2 mm, plus de 6.
  - `echelle_de_temps_traits_et_etiquettes` : des pixels `[138, 138, 138]` en `y = 260` dans la bande `x 150..420` (au moins 8, un par heure) ; des pixels clairs (> 120 sur tous les canaux) dans `(150, 262, 270, 8)` (au moins 20).
  - `echelles_attenuees_si_donnees_perimees` : avec `stale: true`, le plus grand canal des pixels de texte dans `(150, 186, 26, 16)` est inférieur à 180.
- [ ] **Step 2 :** lancer les tests → échec.
- [ ] **Step 3 : Implémenter** les trois échelles avec les valeurs des contraintes globales. Température : traits à `x 150..153` pour `tickValues(axe.lo, axe.hi, niceStep(axe.hi − axe.lo, 15))`, étiquettes `max` en haut et `min` en bas, alignées à gauche à `x = 155`. Précipitations : traits à `x 417..420` pour `tickValues(0, axeMax, niceStep(axeMax, 10))`, étiquette `<axeMax> mm` alignée à droite à `x = 415` sous le sommet de l'échelle, `0` près de la base, ligne `formatCm(axeMax)` en neige dessous quand une barre `snow` ou `mix` existe. Temps : trait de 3 px à `y 259..262` pour chaque `hourMarks`, étiquette 9 px centrée en `y = 266` quand `label` existe et qu'elle tient dans le rectangle. Chaque texte a son fond sombre ; `stale` atténue tout.
- [ ] **Step 4 :** lancer le fichier de tests puis `pnpm test`.
- [ ] **Step 5 : Vérification visuelle** : régénérer un PNG d'exemple (script `tsx` dans le dossier temporaire, comme pour la première livraison) et vérifier : étiquettes lisibles, rien de coupé aux frontières de touche, fond du futur visible, lignes et barres du futur plus ternes.
- [ ] **Step 6 : README** : une phrase sur les échelles et le fond du futur.
- [ ] **Step 7 : Commit** `feat(météo): échelles de température, de précipitations et de temps`

---

## Auto-revue

- **Couverture de la spec :** échelles (Tasks 1 et 3), fond du futur et désaturation (Task 2), barres en mm avec opacité par probabilité (Task 2), trait « maintenant » conservé.
- **Types cohérents :** les fonctions de `scales.ts` sont définies en Task 1 et réutilisées sous les mêmes noms en Task 3.
- **Laissé au constructeur :** positions fines des étiquettes (à l'intérieur des contraintes), taille exacte des fonds de texte, forme du code de découpe passé/futur.
