# Loupedeck Live × Home Assistant — Conception

Date : 2026-11-20
Statut : en attente d'approbation par l'utilisateur

## 1. Intention

Transformer une **Loupedeck Live** en télécommande physique pour **Home Assistant**, avec une application maison qui remplace le logiciel officiel Loupedeck. L'application a sa propre logique d'affichage : plusieurs tableaux de bord, avec un bouton physique par tableau. Sa disposition se configure dans un **éditeur visuel**.

Pourquoi : l'utilisateur veut piloter sa maison (lumières, chauffage, météo, caméras) depuis son bureau avec des contrôles physiques. L'affichage doit rester à jour en direct, y compris quand quelqu'un agit depuis Home Assistant ou le téléphone.

## 2. Contexte matériel et réseau

- **Appareil :** Loupedeck Live (VID `0x2ec2`, PID `0x0004`), branchée en USB sur le **PC Windows 11** de l'utilisateur.
  - 12 touches tactiles de 90 × 90 px (4 colonnes × 3 rangées) dans l'écran central de 360 × 270 px.
  - 2 bandes latérales de 60 × 270 px : `left` et `right`.
  - Un seul framebuffer physique de 480 × 270 px.
  - 6 molettes cliquables : `knobTL`, `knobCL`, `knobBL`, `knobTR`, `knobCR`, `knobBR`.
  - 8 boutons ronds à LED RGB (ids 0 à 7), un vibreur, luminosité globale sur 11 paliers.
- **PC :** toujours allumé. Que l'application ne fonctionne que pendant que le PC est allumé est **accepté**.
- **Home Assistant :** tourne sur un **Raspberry Pi**, ailleurs sur le réseau local. L'application s'y connecte par le réseau.
- **Librairie :** [`foxxyz/loupedeck`](https://github.com/foxxyz/loupedeck) v7.x, sous licence MIT. C'est la base imposée par l'utilisateur.

## 3. Objectifs

1. **Navigation par boutons ronds.** Chaque bouton rond ouvre un tableau de bord. La LED du bouton actif est allumée, dans la couleur du tableau ; les autres LED sont éteintes ou atténuées. Le tableau actif reste mémorisé quand l'application redémarre.
2. **Tableau Lumières.** Il occupe toute la disposition physique. *(Décision de l'utilisateur.)*
   - **Touches centrales (12) : lumières tout ou rien.** Chaque touche montre une lumière avec son nom, une icône et son état. Un appui l'allume ou l'éteint. Types acceptés : `light.*` et `switch.*`. Une lumière à gradation peut aussi y être placée ; elle se comporte alors en tout ou rien.
   - **Bandes latérales (6 emplacements) : lumières à gradation.** Chaque bande est découpée en 3 zones de 60 × 90 px, alignées avec les 3 molettes de son côté. Chaque zone montre une lumière : son nom, son état et une jauge d'intensité.
     - Tourner la molette voisine règle l'intensité.
     - Appuyer sur la molette allume ou éteint la lumière.
     - Toucher la zone l'allume ou l'éteint aussi.
     - Seules les entités `light.*` gradables (qui acceptent `brightness`) peuvent occuper ces emplacements.
   - **Capacité :** 12 lumières tout ou rien et 6 à gradation par tableau. Pour en mettre davantage, on crée un deuxième tableau Lumières sur un autre bouton rond, par exemple le bouton 7, libre. Pas de pagination dans un tableau en v1. *(Choix de Claude.)*
3. **Tableau Température.** L'utilisateur a **un seul thermostat central** (`climate.*`). Il peut choisir chauffage ou climatisation, régler **une consigne unique**, et il rapporte la température ambiante.
   - **Affichage :** température ambiante, consigne et mode actuel, en grand.
   - **Molette :** ajuste la consigne par **pas de 0,5 °C**, ou selon le `target_temp_step` de l'entité s'il est défini, dans les limites `min_temp`/`max_temp`.
   - **Touches de mode :** une touche par mode proposé par l'entité dans `hvac_modes` (par exemple Chauffage, Climatisation, Arrêt). Le mode actif est mis en évidence.
   - **En option :** des capteurs de température (`sensor.*`, `device_class: temperature`) en lecture seule, sur les touches restantes.
   - Le tableau est conçu pour un thermostat. En choisir un autre se fait dans l'éditeur.
4. **Tableau Météo.**
   - Conditions actuelles en grand : icône, température, ressenti s'il est disponible, condition.
   - Prévisions des **jours suivants** : icône, maximum et minimum par jour.
   - Source : une entité `weather.*` de Home Assistant, et rien d'autre. Les prévisions viennent du service `weather.get_forecasts` (type `daily`, avec réponse).
5. **Tableaux Caméra, 4 caméras.**
   - **Les caméras :** deux Tapo, « Tapo-camera-avant » (C720) et « Camera Lavage ». Deux Alarm.com (TELUS) : la caméra avant et **la sonnette, qui est la caméra la plus importante pour l'utilisateur**.
   - Chaque tableau caméra est relié à une entité `camera.*`. L'image remplit **tout l'écran de 480 × 270 px**, bandes latérales comprises, sans touches ni étiquettes par-dessus.
   - Le flux ne tourne **que** lorsqu'un tableau caméra est affiché.
   - **Source des images en v1 : Home Assistant uniquement** *(décision de l'utilisateur)*. On utilise `camera_proxy` (image fixe, redimensionnée par Home Assistant avec `width`/`height`) ou `camera_proxy_stream`.
     - **Tapo :** ces caméras ne fournissent pas d'image fixe. Home Assistant en extrait une du flux RTSP avec ffmpeg, sur le Pi, et une Tapo accepte au plus 2 flux simultanés. La cible réaliste est d'environ **1 image/s**, et au minimum une image toutes les 2 s.
     - Le RTSP direct depuis le PC (vidéo fluide, ffmpeg sur le PC, compte caméra Tapo) est **reporté** à une version ultérieure.
   - **Alarm.com, et la sonnette en priorité.** Les intégrations communautaires d'Alarm.com fournissent la vidéo surtout en **WebRTC**, à travers le serveur Janus d'Alarm.com, avec des jetons obtenus par une carte Lovelace. `camera_proxy` ne renvoie probablement aucune image. Certaines sonnettes exposent plutôt un chemin MJPEG, que ces intégrations ne gèrent pas encore.

     L'objectif est d'**essayer** d'afficher la sonnette :
     1. **v1, de base.** Si `camera_proxy` renvoie une image, on l'utilise. Sinon, la page affiche « image non disponible », avec le nom de la caméra, sans bloquer l'application.
     2. **Essai dédié** (section 8, essai n° 2). On cherche si une voie fiable permet d'obtenir des images de la sonnette dans l'application, en reproduisant ce que fait la carte WebRTC de l'intégration. Le résultat est présenté à l'utilisateur avant d'être construit.
   - **Architecture :** une source d'images par caméra, enfichable. Elle vaut `ha-proxy` par défaut. Une source `alarmcom-webrtc` ou `rtsp-direct` pourra s'ajouter sans toucher au reste.
6. **Éditeur visuel**, sur une page web locale servie par l'application.
   - Il affiche une Live virtuelle : écran, bandes latérales, molettes, boutons ronds.
   - **Aperçu fidèle :** les images viennent du même code de dessin que celui qui alimente la console.
   - Il liste les entités Home Assistant, avec recherche et filtre par domaine ; on les glisse sur les touches.
   - Il permet de choisir quel tableau de bord est relié à chaque bouton rond, avec son type et sa couleur.
   - Il permet de renommer une touche et d'en changer l'icône.
   - Il permet de choisir l'entité météo et les entités caméra.
   - Il permet de régler l'URL Home Assistant, le jeton d'accès et la luminosité de la console.
   - Toute modification enregistrée s'applique **immédiatement** sur la console, sans redémarrer l'application.
7. **Fiabilité, puisque l'application tourne en permanence.**
   - Elle démarre avec la session Windows, sans fenêtre.
   - Elle se reconnecte toute seule quand la console est débranchée puis rebranchée, quand Home Assistant redémarre ou quand le réseau coupe.
   - Quand Home Assistant est injoignable, la console l'indique, par exemple avec des touches grisées et un indicateur « HA hors ligne », au lieu de montrer des états périmés comme s'ils étaient vrais.

### Ce qu'on a observé dans le Home Assistant de l'utilisateur (2026-11-20, via le serveur MCP)

Le serveur MCP de Home Assistant ne voit que les entités exposées à Assist. Les caméras et la météo n'y apparaissent donc pas.

- **Entités nombreuses et hétérogènes.** Une soixantaine d'entités `light.*` et `switch.*`. Beaucoup de lampes sont des `switch.*` (« Lumière Hall », « Lampe 1 »…). Les domaines `light`/`switch` contiennent aussi des éléments qui ne sont pas des lampes : ventilateur du Pi, écrans browser_mod, prises, imprimante 3D, recharge de voiture.

  Conséquences pour l'éditeur :
  - recherche par nom, filtre par pièce et par domaine ;
  - affichage de l'`entity_id`, car certains noms sont en double, par exemple deux « Cuisine Lumière d'évier » ;
  - les entités `unavailable` sont signalées.
- **Gradable ou non.** Une lumière éteinte rapporte `brightness: null`. Pour décider si une lumière est gradable, il faut lire `supported_color_modes` (tout mode autre que `onoff`), pas la présence de `brightness`.
- **Thermostats.** Plusieurs entités `climate.*` existent :
  - « T10 Plus Thermostat » (Hall, chauffage, 21 °C, consigne 19 °C) ;
  - « Couloir » (chauffage, 21 °C, consigne 21 °C) ;
  - « TUCSON Climate Control », qui est la voiture.

  L'utilisateur choisit le sien dans l'éditeur.
- **Caméras devinées d'après les entités associées :**
  - deux caméras Tapo : « Tapo-camera-avant » (C720, à projecteur) et « Camera Lavage » ;
  - deux caméras Alarm.com (TELUS SmartHome) d'après l'utilisateur : la caméra avant et la sonnette. « Caméra Telus Garage » est la prise qui alimente une caméra.
- **Accès.** Home Assistant est joignable en HTTPS à l'adresse `hass.decarufel.net`.

## 4. Non-objectifs (version 1)

- Piloter Windows : raccourcis clavier, volume, lancement d'applications.
- Prendre en charge d'autres modèles que la Live ou plusieurs consoles en même temps.
  - Le code ne doit pas l'empêcher, mais on ne le teste pas.
- Tourner ailleurs que sur Windows : Raspberry Pi, module complémentaire Home Assistant.
- Emballer l'application dans Electron, ou lui donner une icône dans la zone de notification.
  - C'est possible plus tard, sans réécriture.
- Afficher la caméra en fond derrière les touches des autres tableaux.
- Lire les caméras en RTSP direct depuis le PC, ou obtenir de la vidéo fluide : en v1, tout passe par Home Assistant. La source WebRTC pour Alarm.com dépend de l'essai n° 2.
- Mettre la console en veille ou l'atténuer automatiquement : elle reste à la luminosité réglée (pleine par défaut), à la demande de l'utilisateur.
- Piloter la maison depuis la Live virtuelle de l'éditeur : elle sert seulement à modifier la disposition, mais elle affiche les états réels.
- Ajouter des types de tableau au-delà des quatre décrits : médias, scènes, alarme. L'architecture doit cependant permettre d'en ajouter facilement (section 7).
- Gérer plusieurs utilisateurs ou un accès depuis un autre poste : l'éditeur écoute sur `localhost` seulement.

## 5. Anti-objectifs (ce qui serait un échec même si « ça marche »)

- **Afficher un état faux sans le signaler.** Une lumière montrée « allumée » alors qu'elle est éteinte, ou un état figé après une perte de connexion.
- **Une console qui gèle ou demande un redémarrage manuel** après une veille de l'écran, un débranchement ou un redémarrage du Pi. La librairie a des attentes sans délai d'expiration : voir la section 9.
- **Des actions accidentelles :**
  - une page caméra qui déclenche quelque chose au toucher ;
  - une molette qui envoie des dizaines d'appels de service à Home Assistant en une seconde.
- **Un jeton Home Assistant exposé** sur le réseau ou affiché en clair dans l'éditeur une fois saisi.
- **Un éditeur dont l'aperçu ne correspond pas à la console.**

## 6. Approches considérées

| | Approche | Compromis | Décision |
|---|---|---|---|
| **A** | **Un seul processus Node.js / TypeScript** en arrière-plan : pilote de la console (foxxyz), client Home Assistant, moteur de rendu, et serveur web local pour l'éditeur | Le plus court. Utilise la librairie telle quelle. Un seul programme. L'aperçu partage le code de dessin. Pas de vraie fenêtre ni d'icône. | **Choisie par l'utilisateur** |
| B | Application Electron (fenêtre + icône dans la zone de notification) | Plus « logiciel installé ». Environ 100 Mo, et les modules natifs sont à recompiler pour Electron. Gain surtout cosmétique. | Écartée. Reste possible plus tard autour de A. |
| C | Réécriture en C#/.NET à partir du protocole documenté dans le dépôt | Application native. Il faut réimplémenter et maintenir le protocole, et refaire l'éditeur en WPF ou WinUI. C'est le plus long. | Écartée |

## 7. Architecture (approche A)

Un seul processus Node.js, **Node 24 LTS**, en TypeScript et en ESM. La librairie est en ESM uniquement et utilise un `await` de premier niveau.

```
┌───────────────────────── Processus Node (PC Windows) ─────────────────────────┐
│                                                                               │
│  DeviceLink ──(événements)──▶ Navigator / Dashboard actif ──▶ Renderer        │
│  (foxxyz + watchdog)     ◀──(tuiles RGB565, LED)──────────────┘   ▲           │
│                                     │  ▲                          │           │
│                          appels de service │ états                │           │
│                                     ▼  │                          │           │
│                              HaClient (WebSocket + REST caméra)   │           │
│                                     ▲                             │           │
│  ConfigStore (fichier JSON) ◀──▶ EditorServer (HTTP + WS, localhost)          │
│                                     └── aperçu : mêmes images que la console ─┘
└───────────────────────────────────────────────────────────────────────────────┘
          │ USB série                                        │ réseau local
     Loupedeck Live                                Home Assistant (Raspberry Pi)
```

### Composants

- **DeviceLink.** Il enveloppe `LoupedeckLive` de foxxyz.
  - **Délai d'expiration et surveillance.** La librairie peut rester bloquée indéfiniment : `connect()` sur un port occupé, `send()` sans réponse. DeviceLink ajoute un délai d'expiration à la connexion et à chaque dessin. Il détecte la déconnexion, une même déconnexion pouvant être signalée deux fois, puis se reconnecte avec un délai croissant.
  - **Une seule écriture à la fois.** La console dessine plus lentement que les molettes ne tournent. DeviceLink tient donc une file : une seule écriture d'écran en cours, et les mises à jour en attente pour une même zone sont fusionnées, seule la plus récente gagne.
  - **Découverte.** Il choisit l'appareil par `list()` en filtrant VID `0x2ec2` et PID `0x0004`, ou par un port COM configuré. Il ne prend pas « le premier appareil trouvé » : la découverte de la librairie ne filtre que par VID ou fabricant.
  - **Logiciel officiel.** Si le port est occupé, DeviceLink le signale clairement dans le journal (« fermez le logiciel Loupedeck ») et réessaie.
- **HaClient.** Il parle à l'API WebSocket de Home Assistant (`ws://<hôte>:8123/api/websocket`) avec un **jeton d'accès longue durée**.
  - Il récupère les états initiaux, puis s'abonne aux changements en continu. Il garde en mémoire un cache des états et le diffuse aux tableaux.
  - Il appelle les services : `light.toggle`, `light.turn_on` avec `brightness_pct`, `switch.toggle`, `climate.set_temperature`, `climate.set_hvac_mode`, et `weather.get_forecasts` avec réponse.
  - Il récupère les images de caméra par REST : `/api/camera_proxy/<entity_id>` ou le flux MJPEG `/api/camera_proxy_stream/<entity_id>`, à travers la source `ha-proxy`. Le choix entre les deux est tranché par l'essai de la section 8.
  - L'URL de Home Assistant est configurable. Par défaut, l'adresse locale du Pi, pour ne pas dépendre d'Internet ; `https://hass.decarufel.net` reste possible. *(Choix de Claude.)*
  - Il se reconnecte automatiquement et expose un état de connexion. Il limite le débit des appels déclenchés par les molettes.
- **Navigator.** Il associe chaque bouton rond (0 à 7) à un tableau, gère les LED et le changement de tableau. Il transmet les événements de la console au tableau actif : appui, rotation, toucher.
- **Dashboards.** Une interface commune. Chaque type de tableau reçoit les états et les événements, et produit des **tuiles** : 12 touches, 2 bandes latérales, ou un plein écran pour les caméras. Ajouter un type de tableau, c'est ajouter une implémentation de cette interface et sa configuration dans l'éditeur. Quatre types en version 1 :
  - `lights` (12 touches tout ou rien et 6 zones de gradation, sans pagination) ;
  - `climate` ;
  - `weather` ;
  - `camera`.
- **Renderer.** Il transforme une tuile (texte, icône, valeur, barre, couleurs) en image.
  - Il produit du RGB565 pour la console et du PNG pour l'aperçu de l'éditeur, **à partir du même dessin**.
  - Il décode les JPEG des caméras et les met à l'échelle 480 × 270.
- **ConfigStore.** Un fichier de configuration JSON dans le profil de l'utilisateur, par exemple `%APPDATA%\loupedeck-ha\config.json`.
  - Il contient : la connexion Home Assistant, la luminosité, les 8 boutons avec le type, la couleur et les paramètres de chaque tableau, et les touches avec l'entité, le libellé et l'icône.
  - Il valide le fichier au chargement, notifie les autres composants à chaque changement et écrit de façon atomique.
  - Le jeton y est stocké. Il ne repart jamais vers le navigateur : l'éditeur l'affiche masqué.
- **EditorServer.** Il sert l'interface de l'éditeur en HTTP sur `127.0.0.1`, plus une API qui donne accès à :
  - la configuration (lecture et écriture) ;
  - la liste des entités Home Assistant ;
  - les rendus d'aperçu par tableau ;
  - l'état de la connexion à la console et à Home Assistant.

  Un canal WebSocket pousse les mises à jour de l'aperçu en direct.

### Comportements de la console décidés (propositions de Claude, non contestées)

**Boutons ronds, configurables dans l'éditeur.** Disposition par défaut : `0` Lumières, `1` Température, `2` Météo, `3` à `6` Caméras 1 à 4, `7` libre.

**Bandes latérales : les zones des molettes.** La bande gauche est découpée en 3 zones de 60 × 90 px, alignées avec `knobTL`, `knobCL` et `knobBL`. La bande droite fait de même avec `knobTR`, `knobCR` et `knobBR`. Chaque zone montre ce que contrôle la molette voisine et sa valeur actuelle, par exemple « Salon 60 % ».

**Lumières :**
- Les touches centrales basculent les lumières.
- Les 6 lumières à gradation sont dans les zones latérales.
- Tourner une molette applique l'intensité. La valeur s'affiche aussitôt sur la console, mais l'appel à Home Assistant est envoyé au plus toutes les 150 à 250 ms, avec toujours la dernière valeur.
- Une molette sans lumière assignée ne fait rien, et sa zone reste vide.

**Température :**
- Une molette, `knobTR` par défaut, ajuste la consigne, avec la même limitation de débit. Sa zone latérale affiche la consigne.
- Les touches centrales affichent la température ambiante, la consigne et les modes. Toucher une touche de mode change de mode.

**Caméra :**
- Toucher l'écran ou appuyer sur une molette ne fait rien.
- On quitte le tableau en appuyant sur un autre bouton rond.

**Vibration :** une courte vibration confirme une action envoyée. On ne fait **jamais** vibrer avec le motif `VERY_LONG`, qui dure 10 s.

**Home Assistant hors ligne :**
- Les touches sont grisées et un indicateur s'affiche sur une bande latérale.
- Les actions sont ignorées, avec une vibration d'erreur, plutôt que mises en file.

## 8. Essai jetable à faire en premier : débit de la console

Personne n'a documenté combien d'images par seconde la Live encaisse pour un écran complet : 480 × 270 × 2 octets, soit environ 259 ko par image. Avant de construire les tableaux caméra, il faut un petit script qui mesure :

- la cadence obtenue en plein écran ;
- la cadence pour une touche seule de 90 × 90 px ;
- la version du firmware, donnée par `getInfo()`. Le firmware 0.2.26 est signalé cassé sous Linux, et on ne sait pas ce qu'il en est sous Windows.

Le résultat fixe deux choses :
- la cadence cible des caméras, entre l'image fixe rafraîchie et le flux MJPEG décodé en continu ;
- la stratégie de rafraîchissement des autres tableaux, entre redessiner tout l'écran ou seulement les touches qui ont changé.

Cet essai sert à mesurer, pas à construire : son code n'est pas conservé tel quel.

### Essai n° 2 : sonnette Alarm.com

L'essai se fait sur l'installation réelle de l'utilisateur, en lecture seule. Il doit établir :

1. **L'intégration installée.** Laquelle des intégrations Alarm.com est installée : pyalarmdotcom/alarmdotcom, ibasebcast/ha-alarmdotcom, SeloraHomes/ha-alarmdotcom, HA-ADC/alarmdotcom-ha ? Et quelles entités `camera.*` elle crée pour la sonnette et la caméra avant ?
2. **Les images fixes.** Est-ce que `/api/camera_proxy/<sonnette>` renvoie une image ? Avec quelle fréquence de renouvellement ?
3. **Le WebRTC.** Sinon, comment la carte WebRTC de l'intégration obtient-elle ses jetons ? Par un point d'accès HTTP de l'intégration ou par l'API WebSocket de Home Assistant ? Et peut-on reproduire la négociation depuis Node ? Par exemple avec une implémentation WebRTC en TypeScript pur comme `werift`, puis en décodant le H.264 avec ffmpeg.
4. **Le chemin MJPEG.** La sonnette expose-t-elle plutôt un chemin MJPEG exploitable ?

**Résultat attendu :** une recommandation, puis une décision de l'utilisateur. On construit la source `alarmcom-webrtc`, ou on se contente de la v1 de base. L'essai ne modifie rien dans Home Assistant.

## 9. Contraintes

- **Windows 11, Node 24 LTS, TypeScript.** La librairie `loupedeck` v7.x est utilisée telle quelle, sans fork. Si un contournement est nécessaire, on enveloppe la librairie plutôt que de la modifier.
- **Port série exclusif.** Le logiciel officiel Loupedeck (ou Logi Options+) doit être fermé ou désactivé au démarrage. L'application ne cherche pas à le tuer.
- **Modules natifs.** La librairie dépend de `serialport` (binaires précompilés pour win32-x64) et de `canvas`. `canvas` est facultatif pour la librairie, mais il est le principal risque à l'installation.
  - Le Renderer **ne doit pas dépendre** de `drawCanvas` de foxxyz : il envoie des buffers RGB565 via `drawBuffer`/`drawKey`.
  - La bibliothèque de dessin est laissée au constructeur (section 11). Elle doit s'installer sans compilateur sous Windows x64.
- **Limites connues de la librairie à contourner dans DeviceLink :**
  - aucun délai d'expiration sur `connect()` ni sur les transactions ;
  - `disconnect` peut être émis deux fois ;
  - `close()` n'annule pas toujours une reconnexion programmée ;
  - `drawKey` et `drawCanvas` lèvent leurs exceptions de façon synchrone.
- **Sécurité :**
  - l'éditeur écoute sur `127.0.0.1` seulement ;
  - le jeton n'est jamais renvoyé au navigateur ni écrit dans les journaux.
- **Démarrage automatique** avec la session Windows, sans fenêtre de console visible. Le mécanisme est laissé au constructeur, par exemple le Planificateur de tâches ou un lanceur `.vbs`/`.cmd` minimisé.
- **Testable sans matériel.** On peut injecter des trames dans `device.onReceive(...)` et remplacer la connexion par une connexion factice, comme le font les tests de la librairie. Le client Home Assistant doit pouvoir être remplacé par un faux.

## 10. Ce que l'utilisateur a décidé

- Application maison avec sa propre logique d'affichage, construite à partir de `foxxyz/loupedeck`.
- Intégration à Home Assistant, qui tourne sur un Raspberry Pi sur le réseau local.
- Elle tourne sur le PC Windows, toujours allumé. Fonctionner seulement quand le PC est allumé est acceptable.
- Appareil : Loupedeck Live.
- Les boutons de page font changer de tableau de bord.
- Les tableaux : lumières (interrupteurs et gradateurs), contrôle de la température, météo du jour et des jours suivants, caméra.
- La caméra s'affiche sur sa propre page, à la place des images des touches. **4 caméras**, sur les boutons restants.
- **Éditeur visuel** plutôt qu'un fichier édité à la main.
- **Approche A** : un seul programme Node.js avec l'éditeur dans le navigateur.
- **Lumières :** les lumières tout ou rien vont sur les touches centrales. Les lumières à gradation vont sur les côtés, près de leur molette.
- **Thermostat :** un seul thermostat central. On y choisit chauffage ou climatisation et une consigne unique, et il rapporte la température ambiante.
- **Luminosité :** pleine luminosité en permanence, sans mise en veille de la console.
- **Caméras :** 4 caméras, venant de deux intégrations Home Assistant. Tapo : avant et lavage. Alarm.com : avant et **sonnette**. La sonnette est la plus importante : il faut au moins essayer de l'afficher.
- **Images :** elles passent par Home Assistant pour le moment, avec environ 1 image/s pour les Tapo. Le RTSP direct viendra plus tard s'il le faut.
- **Éditeur :** cliquer sur la Live virtuelle sert seulement à modifier, et ne pilote pas la maison.

## 11. Laissé au constructeur

- La bibliothèque de dessin, par exemple `@napi-rs/canvas`, `skia-canvas` ou `sharp` combiné à un moteur de texte. Contrainte : pas de compilation sous Windows x64.
- La police et le jeu d'icônes, par exemple Material Design Icons, déjà utilisé par Home Assistant (`mdi:`). Utiliser l'attribut `icon` des entités quand il existe est souhaitable.
- La technologie de l'interface de l'éditeur (Vue, React, Svelte…) et son style.
- Le détail du schéma JSON de configuration et sa validation.
- Le mécanisme exact de démarrage automatique et l'emplacement des journaux.
- La disposition précise des touches du tableau Température : quelle touche affiche quoi, à partir de quelle position commencent les modes.
- La mise en page exacte des tuiles et du tableau Météo : nombre de jours affichés selon la place, usage des bandes latérales.

## 12. Choix de Claude après la relecture (à vérifier par l'utilisateur)

Ces points ont été soulevés par la relecture du document par des constructeurs. Claude les a tranchés. Ils ne changent pas ce que l'utilisateur a demandé, mais il peut les contester.

### Comportement sur la console

1. **Température.** Une touche par mode présent dans `hvac_modes`, plutôt qu'une touche unique qui fait défiler les modes. Avec un seul thermostat, la place ne manque pas.
2. **Molette Lumières, cas limites.**
   - Sur une lumière éteinte, tourner la molette l'allume à l'intensité choisie (`light.turn_on` + `brightness_pct`).
   - Tourner jusqu'à 0 % éteint la lumière.
3. **Valeur affichée contre état réel.**
   - Pendant la rotation d'une molette, et environ 1,5 s après, l'affichage suit la molette ; ensuite, c'est l'état Home Assistant qui fait foi.
   - Après une bascule, la tuile est marquée « en attente » jusqu'à ce que Home Assistant confirme. Sans confirmation au bout d'environ 3 s, elle revient à l'état de Home Assistant et une vibration d'erreur se déclenche.
4. **Caméra figée ou Home Assistant hors ligne.**
   - On ne dessine rien par-dessus l'image.
   - Après environ 5 s sans nouvelle image, l'image passe en niveaux de gris et la LED du bouton actif clignote en rouge.
5. **Plein écran caméra.** `drawBuffer({ id: 'left', x: 0, y: 0, width: 480, height: 270 })` couvre tout le framebuffer, car `left` n'a pas de décalage. C'est vérifié dans le code de la librairie.
6. **Gestes.** La librairie ne fournit que `touchstart`, `touchmove` et `touchend`. La détection de l'appui court et de l'appui long est à construire dans Navigator.
7. **Veille ou suspension USB.** Prévoir un test de reconnexion après une sortie de veille. Documenter la désactivation de la « suspension sélective USB » de Windows si elle pose problème.
8. **Firmware.** L'essai de la section 8 lit `getInfo()` en premier. Si la version 0.2.26 pose problème sous Windows, on documente le retour à la 0.2.23 avec le logiciel officiel, sans contournement dans le code.

### Home Assistant

9. **Météo sans prévisions `daily`.**
   - On lit les `supported_features` de l'entité. Si `daily` manque, on regroupe les prévisions `twice_daily` ou `hourly` par jour.
   - L'éditeur signale une entité sans prévisions.
   - On rafraîchit à chaque changement d'état de l'entité et toutes les 30 min. S'abonner avec `weather/subscribe_forecast` est une alternative acceptable.
10. **`http` ou `https` vers Home Assistant.**
    - C'est le protocole de l'URL qui décide (`ws://` ou `wss://`).
    - Un certificat auto-signé n'est accepté que si une option est explicitement cochée.
    - En `http`, l'éditeur affiche un avertissement qui ne bloque rien.

### Éditeur

11. **Placement dans l'éditeur.**
    - Lumières : 12 emplacements centraux (touches 0 à 11, trous permis) qui acceptent `light.*` et `switch.*`. 6 emplacements latéraux, un par molette, qui n'acceptent que les lumières gradables. L'éditeur refuse un dépôt invalide et explique pourquoi.
    - Température : on choisit l'entité `climate.*`, plus d'éventuels capteurs en option.
    - Météo et Caméra : pas de touches à modifier, on choisit seulement l'entité.
12. **Enregistrement.**
    - Chaque action terminée est enregistrée et appliquée aussitôt : dépôt, renommage (validé quand on quitte le champ), couleur. Un bouton Annuler permet de revenir en arrière.
    - Pas de brouillon : l'aperçu et la console ne divergent jamais.
13. **Changer le type d'un bouton** demande une confirmation, puis supprime les touches de l'ancien tableau.
14. **Tableaux et boutons.**
    - On peut mettre deux tableaux du même type sur deux boutons, par exemple deux tableaux Lumières.
    - Un bouton peut rester libre.
    - Les molettes ne sont pas réglables dans l'éditeur en v1.
15. **Caméra dans l'éditeur.** On affiche une image fixe (`camera_proxy`), chargée à l'ouverture et rafraîchie à la demande, jamais en flux continu.
16. **Éditeur et console sont indépendants.** L'éditeur indique seulement quel tableau est actif sur la console.

### Projet

17. **Installation.** Un dossier source, Node 24, `npm ci`, et un démarrage par le Planificateur de tâches. Pas d'exécutable autonome en v1.
18. **Tests.**
    - Les tests unitaires et d'intégration utilisent un faux Home Assistant et une fausse connexion à la console.
    - L'essai de la section 8 et la recette finale se font sur la vraie Live.
    - Aucun appel de service réel n'est fait sans entités de test désignées par l'utilisateur.
