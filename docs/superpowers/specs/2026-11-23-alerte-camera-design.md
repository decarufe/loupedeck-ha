# Alerte de caméra sur la console — Conception

Date : 2026-11-23. Les noms de caméras et d'entités sont génériques.
**[Choix]** marque une décision prise par le rédacteur, pas par l'utilisateur.

## 1. Intention

L'utilisateur reçoit sur son téléphone une notification quand une de ses caméras, par exemple celle de la
sonnette, détecte un mouvement. À son bureau, il veut que la console **lui montre immédiatement cette
caméra**, sans chercher la bonne page ni sortir son téléphone : vibration, bouton rond de la caméra qui
clignote, et passage automatique à sa page.

## 2. Objectifs et limites

**Objectifs**
- Une détection sur un capteur coché provoque vibration, clignotement et ouverture de la page de la caméra.
- L'écran revient seul à la page précédente ; une alerte non vue laisse un rappel sur le bouton.
- Chaque page caméra choisit ses capteurs dans l'éditeur.

**Non-objectifs**
- Notification Windows, son, téléphone ; historique des alertes ; enregistrement d'images.
- Plages horaires et conditions (présence, mode alarme).
- Journal Alarm.com et appui sur la sonnette (aucun capteur ne les publie), sauf par un capteur binaire que
  l'utilisateur crée dans Home Assistant et ajoute à la page.
- Vidéo plus fluide, changement de la source d'images.

**Ce qui en ferait un échec, même si tout fonctionne**
- L'écran change sous les doigts de l'utilisateur et un geste tombe au mauvais endroit.
- L'alerte montre une vieille image comme si elle était actuelle.
- La console vibre sans arrêt pendant qu'une personne reste devant une caméra.
- Une page caméra reste ouverte des heures sans personne : chaque image Alarm.com coûte deux requêtes à
  ses serveurs, soit environ 7 200 par heure à une image par seconde.
- L'alerte se confond avec le rouge clignotant (image figée) ou avec les vibrations « ok » et « erreur ».

## 3. Ce qui existe et les contraintes

- `HaPort.onEntities` reçoit déjà tous les états en direct, quelle que soit la page affichée.
- Alarm.com (intégration `ibasebcast/ha-alarmdotcom`, commit `5446cbd`) : quatre `binary_sensor` par caméra
  (personne, véhicule, animal, colis), de classe `motion`, poussés par Alarm.com. Chacun passe à `on`, puis à
  `off` 10 s après la dernière détection. Un mouvement non classé ne les active pas. Caméra et capteurs sont
  sur le même appareil Home Assistant. **Le délai réel n'a pas été mesuré.**
- D'autres caméras (Tapo) ont des capteurs mouvement, personne et véhicule, parfois indisponibles.
- `CameraDashboard` ne charge d'image que si sa page est active, et garde la dernière image reçue, même
  ancienne, jusqu'à la suivante.
- `Navigator` pilote les LED, et fait clignoter en rouge la LED active quand l'image est figée.
  `switchTo` enregistre la page active dans `state.json`.
- `DeviceLink.vibrate` connaît `ok` et `error`. Le motif `VERY_LONG` (`0x76`) est **interdit**.
- `listEntityInfo` lit déjà le registre des entités, dont `device_id`, sans le transmettre à l'éditeur.
- Le projet utilise pnpm, et les textes destinés à l'utilisateur sont en français.

## 4. Approches

| | Pour | Contre |
|---|---|---|
| **1. Capteurs de Home Assistant (choisie)** | Immédiat, réglable dans l'éditeur, valable pour toute marque | Rate les mouvements non classés et l'appui sur la sonnette |
| 2. Capteurs + journal Alarm.com | Couvre plus de déclenchements | Environ 15 s de retard, propre à Alarm.com, doublons à filtrer |
| 3. Automatisation Home Assistant par caméra | Conditions libres | À écrire et maintenir par caméra, rien dans l'éditeur |

L'utilisateur a choisi la **1** : elle répond à « immédiatement », et l'ajout de tout capteur binaire couvre
les cas de la 3. La 2 reste possible plus tard si trop de notifications sont ratées.

## 5. Comportement

### Début d'une alerte
- Une alerte commence quand un capteur coché passe de `off` à `on`, si sa page n'est pas déjà en alerte.
  **[Choix]** Un premier état connu, ou un passage depuis `unknown` / `unavailable`, ne déclenche rien :
  ni le démarrage ni une reconnexion ne créent d'alerte.
- Effets : une vibration, le bouton clignote en magenta, et la page s'ouvre.
- La page **ne s'ouvre pas** si l'utilisateur a touché la console (bouton, molette ou écran) il y a moins de
  5 s. Vibration et clignotement seulement ; son bouton ouvre la caméra. Cette alerte n'ouvrira pas la page
  plus tard.
- Si l'utilisateur affiche déjà cette page, qu'il a ouverte lui-même : vibration et clignotement, et aucun
  retour automatique à la fin.
- **La dernière alerte prend l'écran**, même si une autre caméra en alerte l'occupe (une personne passe devant
  la caméra avant, puis arrive à la sonnette). Une alerte n'ouvre sa page qu'une fois, à son début : pas de
  va-et-vient. La règle des 5 s s'applique aussi ; le bouton de la première caméra continue de clignoter.
- **Une seule vibration par alerte**, quelles que soient les détections suivantes de la même caméra.

### Image
- **[Choix]** À l'ouverture par une alerte, l'image précédente est effacée. La page affiche « Chargement… »
  jusqu'à la première image reçue.

### Fin d'une alerte
- L'alerte se termine après **30 s sans détection**, comptées depuis le moment où tous ses capteurs cochés
  sont revenus à `off` (avec Alarm.com, environ 40 s après la dernière détection). `unavailable` compte
  comme `off`.
- **[Choix]** Elle se termine de toute façon après **5 minutes** (clignotement et affichage), même si les
  détections continuent. Vue ou non, la page reste ensuite silencieuse jusqu'à **30 s de calme** : tous ses
  capteurs cochés à `off`. Une longue activité devant une caméra ne vibre donc qu'une fois.
- **[Choix]** Un capteur resté à `on` sans interruption pendant 5 minutes est ignoré jusqu'à son retour à
  `off` : un capteur bloqué n'empêche pas les autres d'alerter.
- Quand l'alerte affichée se termine, l'écran revient à la page précédente, sauf si l'utilisateur a touché la
  console. **[Choix]** La « page précédente » est toujours la dernière page que l'utilisateur a ouverte avec un
  bouton rond, celle de `state.json`, même après plusieurs alertes à la suite.
- **[Choix]** La fin d'une alerte qui n'est pas affichée ne change pas l'écran.

### Alerte vue
- Tout geste sur la console pendant que la caméra en alerte est affichée marque l'alerte comme vue :
  le clignotement cesse et le retour à 30 s est annulé. Le geste garde son effet normal.
- Si c'est l'alerte qui a ouvert la page, l'écran revient à la page précédente après **5 minutes sans geste**
  (chaque geste relance le délai). Une caméra ouverte par l'utilisateur reste affichée, comme aujourd'hui.
  **[Choix]** Appuyer sur le bouton rond de la caméra affichée compte comme l'ouvrir soi-même : elle reste.
- Sur une autre page, seul l'appui sur le bouton de la caméra marque son alerte comme vue.
- Une alerte vue ne vibre plus et ne clignote plus tant que les 30 s de calme ne sont pas écoulées.
- **[Choix]** Les gestes du mode Essayer de l'éditeur ne comptent pas.

### Rappel
- Une alerte terminée sans avoir été vue laisse le bouton **magenta fixe**, jusqu'à ce que l'utilisateur
  ouvre la page, ou fasse un geste pendant qu'elle est affichée. **[Choix]** Le rappel est en mémoire
  seulement : il disparaît au redémarrage.

### Priorités et cas limites
- LED : alerte (clignotement magenta) > rappel (magenta fixe) > rouge clignotant (image figée) > couleur normale.
- **[Choix]** L'ouverture automatique n'est pas enregistrée dans `state.json` : après un redémarrage, la
  console revient à la page choisie par l'utilisateur.
- **[Choix]** Modifier les pages dans l'éditeur termine toutes les alertes et efface les rappels ; si une
  caméra avait été ouverte par une alerte, la page d'origine revient d'abord.
- Console débranchée : l'alerte suit son cours sans vibration ; les LED se rétablissent à la reconnexion.
- **[Choix]** Les alertes sont suivies par page. Deux pages avec le même capteur : les deux boutons clignotent,
  une seule vibration, la première page s'ouvre. Voir l'alerte d'une page marque aussi comme vues celles des
  autres pages de la même caméra.

### Constantes
L'utilisateur a accepté 5 s, 30 s, le retour après 5 minutes sans geste et le magenta. **[Choix]** pour le reste :
magenta exact `#FF00FF` ; clignotement 250 ms (le rouge reste à 500 ms) ; vibration `RISE_FALL` (`0x6a`), à
valider en main. Les durées sont des constantes nommées, sans réglage dans l'éditeur.

## 6. Configuration et éditeur

- Page caméra : `alert: { enabled: boolean, sensors: string[] }`, par défaut `{ false, [] }`. Le schéma reste
  en version 2 ; une configuration existante se charge sans alerte. L'export et l'import suivent.
- Le fonctionnement ne dépend que de `sensors` ; le registre ne sert qu'à l'éditeur.
- Panneau d'une page caméra :

```
Alerte   [x] activée
   [x] Personne   [x] Colis   [ ] Véhicule   [ ] Animal
   [x] Autre capteur ajouté                    Retirer
   + Ajouter un autre capteur…
```

- L'éditeur propose les `binary_sensor` du même appareil que la caméra, de classe `motion`, `occupancy` ou
  `presence`. « Ajouter » accepte tout `binary_sensor`. Un capteur coché mais absent de Home Assistant reste visible.
- **[Choix]** L'alerte est désactivée par défaut, page par page. À la première activation, personne et colis
  sont cochés s'ils se reconnaissent ; sinon, tous les capteurs proposés.
- **[Choix]** Changer l'entité caméra d'une page désactive l'alerte et vide `sensors`.

## 7. Réussite

- Tests automatisés de chaque règle du § 5, avec horloge simulée et les doubles existants.
- Sur la console : forcer un capteur à `on` dans les outils de développement de Home Assistant fait vibrer et
  clignoter en moins de 0,5 s ; l'image suit au rythme de la caméra (1 à 2 s observées).
- À la sonnette : la console réagit à un passage réel. Comparer avec la notification du téléphone ; noter le
  délai et les détections ratées.
- Le README décrit l'alerte.

## 8. Laissé au réalisateur

Découpage du code, emplacement de la logique d'alerte, reconnaissance de « personne » et « colis », libellés
courts des capteurs, présentation exacte dans l'éditeur, ordre des travaux.
