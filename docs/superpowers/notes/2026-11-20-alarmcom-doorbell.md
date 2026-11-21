# Essai n° 2 : la sonnette Alarm.com

*Essai fait le 21 novembre 2026 sur votre Home Assistant, en lecture seule. Rien n'a été modifié dans Home Assistant : aucun service appelé, aucun réglage changé, rien d'installé.*

## En bref

**Bonne nouvelle : la sonnette fonctionne déjà avec ce qui est construit.** Home Assistant renvoie une vraie image de la sonnette, et une image neuve à chaque demande. On peut afficher environ **une image par seconde**, comme pour les Tapo. La caméra avant fonctionne de la même façon.

**Recommandation :** garder la source actuelle (le proxy caméra de Home Assistant) pour les caméras Alarm.com. Ne pas construire de source WebRTC pour l'instant. Deux petits ajustements sont proposés plus bas. Ils sont facultatifs.

## 1. Ce qui a été observé

### L'intégration installée

| Élément | Valeur |
|---|---|
| Intégration | **ibasebcast/ha-alarmdotcom** (domaine `alarmdotcom`, installée par HACS) |
| Version | **2026.11.18**, la dernière publiée au moment de l'essai |
| Source | <https://github.com/ibasebcast/ha-alarmdotcom> |
| Carte Lovelace fournie | `/alarmdotcom/alarm-webrtc-card.js`, servie par l'intégration elle-même |

Ce sont les informations que Home Assistant donne sur l'intégration (le manifeste, la liste des intégrations configurées et les ressources Lovelace). Parmi les candidates de la spec §8, c'est donc **ibasebcast/ha-alarmdotcom**. Les autres ne sont pas installées.

Votre installation compte **trois** caméras Alarm.com, pas deux :

| Entité | Nom | Modèle | Rôle |
|---|---|---|---|
| `camera.exemple_sonnette` | Sonnette | <modèle de sonnette> | sonnette vidéo |
| `camera.exemple_avant` | Caméra Avant | <modèle de caméra> | caméra avant |
| `camera.exemple_arriere` | Caméra arrière | <modèle de caméra> | caméra arrière, non prévue jusqu'ici |

Pour ces trois caméras, Home Assistant n'annonce aucun flux natif : `camera/capabilities` renvoie `frontend_stream_types: []`. Les Tapo, elles, annoncent `hls` et `web_rtc`. La vidéo en direct ne passe donc que par la carte WebRTC de l'intégration, comme prévu dans la spec. **L'image fixe, elle, fonctionne.**

### Les images fixes (`/api/camera_proxy/...`)

Deux appels par caméra, à environ 12 s d'intervalle, puis un appel à la taille de l'écran (480 × 270) :

| Caméra | Appel | HTTP | Type | Taille | Délai | Image changée ? |
|---|---|---|---|---|---|---|
| Sonnette | 1, taille d'origine | 200 | image/jpeg | 127 ko (960 × 960) | 1,9 s | — |
| Sonnette | 2, taille d'origine | 200 | image/jpeg | 127 ko | 2,4 s | **oui** (heure incrustée : +19 s) |
| Sonnette | 480 × 270 demandé | 200 | image/jpeg | 35 ko (480 × 480) | 0,9 s | oui |
| Caméra avant | 1, taille d'origine | 200 | image/jpeg | 122 ko (1280 × 720) | 0,9 s | — |
| Caméra avant | 2, taille d'origine | 200 | image/jpeg | 122 ko | 0,9 s | **oui** (heure incrustée : +15 s) |
| Caméra avant | 480 × 270 demandé | 200 | image/jpeg | 21 ko | 0,8 s | oui |

**Cadence possible :** six demandes de suite à la sonnette, à la taille de l'écran, ont pris 6,6 s au total, de 0,8 à 1,7 s chacune. Les six images étaient toutes différentes. L'heure incrustée par la caméra avançait au même rythme que l'horloge : ce sont des **images prises au moment de la demande**, pas une vieille image gardée en mémoire.

Les images reçues étaient nettes, récentes (heure incrustée à jour) et à la bonne taille.

Les images ont été enregistrées seulement dans le dossier temporaire du PC, pour les regarder, puis effacées. Elles ne sont pas dans le dépôt.

### Pourquoi ça marche (lecture du code de l'intégration)

Fichier `custom_components/alarmdotcom/camera.py`, fonction `async_camera_image` (commit `5446cbd`, version 2026.11.18) :

1. À chaque demande, l'intégration demande à Alarm.com une adresse d'image temporaire et signée : `GET https://www.alarm.com/web/api/video/snapshots/<id caméra>` (`camera_api.py`, `get_snapshot_url`).
2. Elle télécharge l'image à cette adresse et la rend à Home Assistant.

Conséquence : **chaque image affichée sur la console = deux requêtes vers les serveurs d'Alarm.com.** À une image par seconde, cela fait environ 7 200 requêtes par heure, mais seulement tant que le tableau de la sonnette est affiché, puisque le flux s'arrête dès qu'on change de tableau. Alarm.com ne publie aucune limite. Aucune erreur n'a été vue pendant l'essai.

### Comment marche le WebRTC (pour mémoire)

La spec demandait aussi de l'établir. D'après le code (`webrtc_ws.py`, `camera_api.py` et `www/alarm-webrtc-card.js`) :

- **Les jetons :** la carte les obtient par une **commande WebSocket de Home Assistant**, `alarmdotcom/webrtc_config` (avec `entity_id`). Ce n'est pas un point d'accès HTTP.
  - La commande exige seulement le droit de lecture sur la caméra. Le jeton Home Assistant de notre application suffirait donc : **pas besoin de vos identifiants Alarm.com dans l'application.**
  - Chaque appel fait chercher à l'intégration des jetons neufs chez Alarm.com (`video/videoSources/liveVideoHighestResSources/<id>`).
  - Cette commande n'a pas été appelée pendant l'essai : elle aurait rapporté des jetons de session réels.
- **Deux protocoles possibles :**
  - **« endToEnd »**, le réglage par défaut de l'intégration. La carte ouvre un WebSocket vers un serveur de signalisation d'Alarm.com et envoie `HELLO 2.0.1`, puis `START_SESSION <jeton>`. La caméra envoie alors une offre WebRTC, à laquelle la carte répond.
  - **« Janus »** : un serveur Janus d'Alarm.com, avec son greffon `streaming`.
  - Le choix entre les deux a changé récemment (version 2026.11.06, tickets #172 et #177 du dépôt). Ces protocoles ne sont pas documentés et bougent.
- **MJPEG :** la réponse d'Alarm.com contient un indicateur `isMjpeg`, mais l'intégration se contente de l'écrire dans le journal de débogage. Elle **ne gère aucun chemin MJPEG**, et le code ne donne aucune adresse MJPEG. La PR #8 de SeloraHomes (<https://github.com/SeloraHomes/ha-alarmdotcom/pull/8>, fusionnée) fait la même chose : elle ne fait qu'améliorer ce message de journal.

## 2. Les options

### Option A : statu quo, l'image fixe par Home Assistant (déjà construit)

- **Ce que c'est :** la source `ha-proxy` actuelle, réglée à environ 1 image/s.
- **Effort :** nul. Deux ajustements facultatifs, tous deux réglables maintenant dans l'éditeur, tableau par tableau :
  1. **Cadrage de la sonnette.** L'image de la sonnette est **carrée** (960 × 960), alors que l'écran est en 16:9. Avec le cadrage par défaut, l'application remplit l'écran : elle garde la bande centrale et coupe le haut et le bas de l'image. On perd l'heure incrustée, ainsi qu'une partie du haut de l'image, où se trouverait le visage d'une personne très proche de la porte. Le réglage **« Cadrage »** du tableau caméra propose deux options : **« Plein écran »** (par défaut, image rognée) et **« Image entière »** (image complète centrée, bandes noires sur les côtés). Pour la sonnette, choisir « Image entière ».
  2. **Intervalle pour Alarm.com.** Prendre par prudence **1 500 à 2 000 ms** pour les caméras Alarm.com, afin de limiter les requêtes vers leurs serveurs. Le champ **« Intervalle (ms) »** du tableau caméra accepte de 250 à 2 000 ms, par pas de 250 ms.
- **Risques :** faibles.
  - Alarm.com pourrait limiter un usage intensif : rien de tel n'a été observé, et le flux ne tourne que tableau affiché.
  - Le délai d'environ 1 s par image donne un rendu « diaporama », pas de la vidéo fluide.

### Option B : une source `alarmcom-webrtc` (`werift` + ffmpeg)

- **Ce que c'est :** obtenir les jetons par `alarmdotcom/webrtc_config`, faire la négociation WebRTC dans Node avec `werift`, puis décoder la vidéo H.264 avec ffmpeg (présent sur le PC) pour produire des images.
- **Effort :** environ **4 à 6 jours**. Il faut gérer les deux protocoles, endToEnd et Janus. Il faut aussi le relais TURN d'Alarm.com, les reconnexions, le maintien de session et le décodage vidéo.
- **Risques :** **élevés.**
  - Les protocoles d'Alarm.com ne sont pas documentés, et ils ont changé ce mois-ci : la source pourrait casser à chaque mise à jour.
  - `werift` n'a jamais été essayé avec les serveurs d'Alarm.com.
  - Chaque session consomme des jetons et peut entrer en concurrence avec l'application Alarm.com ou la carte Lovelace.
  - Le décodage vidéo charge le processeur du PC.
- **Sécurité et conditions d'utilisation :** pas d'identifiants Alarm.com dans notre application, seulement le jeton Home Assistant, et des jetons temporaires gardés en mémoire. C'est le même usage non officiel de l'API d'Alarm.com que celui de l'intégration elle-même : une zone grise vis-à-vis de leurs conditions d'utilisation, mais sans aggravation.
- **Gain :** de la vidéo fluide au lieu d'environ 1 image/s.

### Option C : un chemin MJPEG

- **Ce que c'est :** lire directement un flux MJPEG de la sonnette.
- **Effort :** inconnu. Aucune adresse MJPEG n'est connue, et l'intégration ne l'expose pas. Il faudrait rétro-concevoir l'API d'Alarm.com avec vos identifiants.
- **Risque :** élevé, pour un gain incertain. **Non recommandé.**

## 3. Recommandation

**Option A.** La sonnette et la caméra avant s'affichent déjà avec la source actuelle, à environ une image par seconde, avec des images fraîches. Cela couvre l'objectif de la spec (« au moins essayer d'afficher la sonnette »).

Ce qui reste à décider :

- **Ajustements :** appliquer ou non, dans l'éditeur, les deux ajustements de l'option A, c'est-à-dire le cadrage « Image entière » pour la sonnette et l'intervalle de 1 500 à 2 000 ms.
- **Caméra arrière :** l'ajouter ou non comme tableau caméra. Elle fonctionne de la même façon.
- **Vidéo fluide :** revenir à l'option B seulement si la vidéo fluide devient un vrai besoin, après usage de l'option A.

*Aucune construction n'est lancée avant votre décision (spec §8).*
