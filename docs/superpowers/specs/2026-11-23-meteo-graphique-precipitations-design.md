# Météo : graphique des précipitations sur les 3 derniers boutons — Conception

Date : 2026-11-23. Révise la page Météo décrite dans `2026-11-22-types-de-page-design.md`.

## 1. Intention

Sur la page Météo, l'utilisateur veut **voir d'un coup d'œil si la pluie (ou la neige) arrive**.
Les trois derniers boutons de la page forment une seule courbe continue sur 12 h :

| Bouton | Touche | Période |
|---|---|---|
| 1 | 9 | de −8 h à −4 h (historique) |
| 2 | 10 | de −4 h à maintenant (historique) |
| 3 | 11 | de maintenant à +4 h (prévision) |

Les touches 4 à 8 gardent les prévisions par jour (5 jours au lieu de 8 : les jours 6 à 8 disparaissent).
Les touches 0 à 3 (conditions actuelles) et la zone « Mise à jour / Actualiser » ne changent pas.

## 2. Ce que l'utilisateur a demandé (ses mots, résumés)

- Une ligne pour la température, qui se sépare d'une seconde ligne (humidex ou refroidissement éolien) pour former une **zone** (« area »).
- Des **barres verticales** pour les précipitations, passées et prévues.
- Ce qu'il veut savoir d'un coup d'œil : **est-ce que la pluie arrive**. La **neige** doit se distinguer de la pluie dans le visuel.
- Il accepte de **ne pas dépendre de Home Assistant** pour ces données si celui-ci est limité.

## 3. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Savoir en moins de 2 s si des précipitations arrivent dans les 4 prochaines heures et de quel type (pluie, neige, mélange).
- Voir les 8 dernières heures de précipitations et de température.

**Non-objectifs**
- Pas de réglage de la période (fixe : −8 h à +4 h) ni d'interaction tactile sur ces trois boutons.
- Pas de repli sur Home Assistant pour les données du graphique (approche mixte écartée pour la première version).
- Pas de graphique pour d'autres types de page.

**Anti-objectifs (échec même si « ça marche »)**
- Un graphique où la température domine et où l'on ne repère pas la pluie.
- Pluie et neige impossibles à distinguer.
- Envoyer la position exacte de la maison à un tiers.

## 4. Approches envisagées

- **A. Open-Meteo pour les 3 boutons — retenue.** Une seule requête donne passé et futur, pluie et neige séparées, température ressentie, probabilité de précipitation. Gratuit, sans clé. Le passé vient des analyses du modèle, pas d'un pluviomètre.
- **B. Home Assistant seul — écartée.** Le passé n'a ni millimètres ni distinction pluie/neige sans capteurs ajoutés par l'utilisateur ; il faut aussi ajouter les prévisions horaires.
- **C. Mixte (Open-Meteo avec repli sur Home Assistant) — écartée pour la première version.** Plus robuste mais double le code.

L'utilisateur a choisi **A**.

## 5. Conception (décidée avec l'utilisateur)

**Visuel** (proposition validée implicitement, non contredite)
- Les **barres de précipitations** sont l'élément principal : elles partent du bas, plus larges et plus lisibles que la courbe.
- Pluie : bleu. Neige : blanc glacé avec un petit flocon au-dessus de la barre la plus haute. Mélange : barre rayée bleu et blanc.
- Toutes les barres ont une hauteur en **mm** (passé et futur). Futur : l'**opacité** suit la probabilité (plus pâle = moins sûr).
- La **température** est une ligne fine derrière les barres ; la **température ressentie** (humidex ou refroidissement éolien) est la seconde ligne ; l'espace entre les deux est une zone semi-transparente.
- Un **trait pointillé « maintenant »** sépare le bouton 2 du bouton 3.
- **Le futur a un fond légèrement grisé**, et ses lignes et ses barres sont un peu désaturées : on voit d'un coup d'œil la séparation passé/futur (demande de l'utilisateur, révision 1).
- **Échelles** (révision 1), superposées au tracé pour garder « 4 h par touche » :
  - Température (bord gauche) : valeurs maximum et minimum (entiers qui encadrent les courbes) et un petit trait par degré (par 2 ° si l'écart dépasse 15 °, puis par 5 °, etc.).
  - Précipitations (bord droit) : maximum en mm (au moins 2), un trait par mm, « 0 » en bas ; s'il y a de la neige, une seconde ligne en blanc donne l'équivalent en cm (cm = mm × 0,7).
  - Temps (bas, bande de 11 px) : un trait par heure pleine et l'heure locale toutes les 2 h (« 14 h »).

**Source des données**
- Service Open-Meteo : température, point de rosée, vent, précipitations (pluie et neige séparées), probabilité de précipitation, sur −8 h à +4 h.
- Chaque valeur de précipitation (et la probabilité) datée `T` couvre l'**heure précédente** (`T − 1 h` → `T`) ; la température et le code météo sont instantanés. La barre d'une valeur datée `T` va donc de `T − 1 h` à `T`, et 6 horodatages futurs (`forecast_hours=6`) couvrent jusqu'à maintenant + 4 h.
- Mise à jour toutes les 15 min.
- La position est celle de la **maison dans Home Assistant**, arrondie à environ 1 km avant l'envoi.
- Hors ligne ou service en erreur : les boutons gardent la dernière courbe reçue, en grisé.

## 6. Choix du concepteur (à confirmer à la lecture)

- Résolution des barres, rafraîchissement de 15 min, arrondi de la position à ~1 km, grisé hors ligne : mes choix, non demandés par l'utilisateur.
- **Pas de phrase de résumé** : l'utilisateur ne la veut pas. Les barres et leur couleur suffisent.
- **Deuxième ligne de température (décision de l'utilisateur : calcul canadien)** : on récupère la température, le point de rosée (`dew_point_2m`) et la vitesse du vent à 10 m (`wind_speed_10m`, en km/h), puis on calcule nous-mêmes :
  - **Refroidissement éolien canadien** quand T ≤ 0 °C et vent > 4,8 km/h : `13,12 + 0,6215·T − 11,37·v^0,16 + 0,3965·T·v^0,16`.
  - **Humidex canadien** sinon, quand il vaut au moins 25 : `T + 0,5555·(e − 10)` avec `e = 6,11·exp(5417,753·(1/273,16 − 1/(Td + 273,16)))`.
  - Sinon, la deuxième ligne égale la température (pas de zone visible).
  - Les formules et seuils exacts sont à vérifier par le constructeur contre la définition d'Environnement Canada.
- **Type d'une barre (pluie / neige / mélange)** : il vient des quantités prévues ou mesurées. Le type de la plus grande quantité l'emporte ; si les deux dépassent 30 % du total, c'est un mélange. Pluie verglaçante ou bruine : traitées comme pluie, la température ≤ 0 °C les marque comme mélange. Si la probabilité est élevée mais la quantité nulle, le type vient du code météo, et par défaut c'est la pluie.
- **Échelle des barres** : le maximum est au moins 2 mm/h (une bruine reste visible mais petite) et grandit si une valeur le dépasse. Pour le futur, la hauteur suit la probabilité (comme présenté à l'utilisateur) et le type vient des quantités.
- **État vide** : sans position ou sans première réponse du service, les boutons 1 à 3 restent vides et le bouton 2 affiche un court message (« Position inconnue » ou « Prévision indisponible »). Les jours de prévision restent affichés.
- Remplacement des jours 6 à 8 : conséquence directe de « les 3 derniers boutons », signalée à l'utilisateur.
- Pas de nouveau réglage dans l'éditeur pour la première version.

## 7. Contraintes (code existant)

- Page Météo : `src/dashboards/weather.ts` (données, rafraîchissement 30 min), vue `WeatherView` dans `src/views.ts`, dessin dans `paintWeather` de `src/render/painters.ts` (touches 4 à 11 = jours).
- Les prévisions Home Assistant actuelles sont quotidiennes uniquement (`pickForecastType`) et ne contiennent ni précipitations ni température ressentie.
- L'historique existant (`src/ha/history.ts`) ne lit que des états numériques : inutilisable pour ce besoin.
- Le projet utilise pnpm (jamais npm), des tests vitest, et des textes en français.

## 8. Laissé au constructeur

- Paramètres exacts de l'API Open-Meteo, modèle météo à utiliser (le modèle canadien GEM est une piste), pas de temps.
- Où lire les coordonnées de la maison dans Home Assistant.
- Gestion du fuseau horaire et du passage à l'heure d'été.
- Découpage du dessin sur trois touches (un seul tracé coupé en trois, sans texte à cheval sur une frontière).
- Structure des tests (réseau simulé comme pour les autres tests du dépôt).
