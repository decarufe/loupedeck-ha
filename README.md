# Loupedeck HA

Transforme une **Loupedeck Live** en télécommande **Home Assistant** sous Windows : lumières, thermostat,
météo et caméras, un tableau de bord par bouton rond.

## Installation

Prérequis : Windows 11 (x64) et une Loupedeck Live branchée en USB. Rien d'autre à installer : Node.js et
pnpm ne servent qu'à [contribuer](#contribuer).

1. Téléchargez `LoupedeckHA-Setup-x.y.z.exe` depuis la
   [dernière version publiée](https://github.com/decarufe/loupedeck-ha/releases/latest).
2. Lancez-le. L'installateur n'est pas signé : à la première installation, Windows SmartScreen affiche
   « Windows a protégé votre PC ». Cliquez **Informations complémentaires**, puis **Exécuter quand même**.
3. L'installation se fait pour votre compte seulement, sans droits administrateur. L'application démarre
   aussitôt : son icône apparaît dans la zone de notification (près de l'horloge ; elle peut être cachée
   derrière la flèche « ^ »).

### Libérer la console

La console ne peut être ouverte que par un seul programme. **Fermez le logiciel Loupedeck / Logi Options+**
et désactivez son lancement au démarrage de Windows (Gestionnaire des tâches → Applications de démarrage).
Si la console est occupée, le journal l'indique (« Fermez le logiciel Loupedeck ») et l'application réessaie
toute seule.

### Jeton Home Assistant

Dans Home Assistant : **Profil → Sécurité → Jetons d'accès longue durée → Créer un jeton**. Copiez-le
tout de suite : il n'est affiché qu'une fois. Il se saisit dans l'éditeur (voir plus bas) et n'est jamais
écrit dans les journaux.

## Utilisation

### L'icône de notification

Clic gauche : ouvre l'éditeur. Clic droit :

| Entrée | Effet |
| --- | --- |
| **Redémarrer pour installer la version x.y.z** | Présente seulement quand une mise à jour est prête (voir plus bas). |
| **Ouvrir la configuration** | Ouvre l'éditeur dans votre navigateur (`http://127.0.0.1:8765/` par défaut). |
| **Démarrer avec Windows** | Case à cocher : lance l'application à l'ouverture de votre session. Cochée au premier lancement. |
| **À propos…** | Version installée, lien vers ce dépôt, bouton pour ouvrir le dossier des journaux. |
| **Quitter** | Arrête proprement l'application (la console s'éteint) et retire l'icône. |

Relancer « Loupedeck HA » depuis le menu Démarrer alors qu'elle tourne déjà ouvre simplement l'éditeur.

Si l'application plante, elle est relancée automatiquement après 5 s ; l'icône reste disponible.

### Configuration : l'éditeur visuel

La configuration se fait dans **l'éditeur**, une page web locale servie par l'application : menu de l'icône
→ **Ouvrir la configuration**.

- **Réglages** : adresse Home Assistant (`http://…` ou `https://…`), jeton, certificat auto-signé,
  luminosité de la console. Le jeton saisi n'est jamais réaffiché ; changer d'adresse demande de le saisir
  à nouveau.
- **Pages** : cliquez sur un bouton rond de la Live virtuelle. Une page vide propose cinq types de contenu :
  **Bouton custom**, **Météo**, **Caméra**, **Contrôle de température**, **Graphique plein écran**. Pour
  changer le type d'une page, videz-la d'abord (« Vider la page » ou « Vider les contrôles »). Glissez un
  bouton rond sur un autre pour déplacer la page : les autres se décalent (Maj : échanger).
- **Bouton custom** : chaque touche a un type — Interrupteur, Action (scène ou script, appui long en option),
  État, Valeur, Graphique, Date et heure, ou Gradateur (sur les bandes latérales, réglé par la molette).
  Glissez un type de touche ou une entité de la palette (le type est alors deviné), ou cliquez-le puis
  l'emplacement. Un dépôt refusé est expliqué. Glissez une touche sur une autre pour la déplacer (les
  suivantes se décalent ; Maj : échanger ; Ctrl : copier), ou sous la console pour la retirer.
- **Graphique plein écran** : capteur numérique et fenêtre par défaut. Sur la console, les molettes du haut
  règlent l'échelle et celles du milieu font défiler (à gauche verticalement, à droite horizontalement).
- **Météo** : la zone haut droite de la console affiche la dernière mise à jour ; un appui l'actualise.
- **Caméras** : entité, **Intervalle (ms)** (250 à 2000, par pas de 250) et **Cadrage** : « Plein écran »
  (l'image remplit l'écran, bords rognés) ou « Image entière » (image complète, bandes noires). Sur la
  console, la tuile haut gauche compte le temps depuis la dernière image (vert, ambre après 10 s, rouge
  après 30 s) ; appui court : forcer une image, appui long : recharger l'intégration de la caméra.
- **Annuler** revient à la configuration précédente. Chaque modification est enregistrée et appliquée à la
  console aussitôt ; l'aperçu suit la console en direct.

Les modifications sont enregistrées dans `%APPDATA%\loupedeck-ha\config.json`, créé avec les valeurs par
défaut au premier démarrage : une page Bouton custom vide sur le bouton 0, Température sur le 1, Météo sur
le 2, quatre Caméras sur les boutons 3 à 6. Une configuration de l'ancienne version (tableau Lumières) est
convertie automatiquement en page Bouton custom.

#### En recours : modifier le fichier à la main

**Application arrêtée** seulement (menu de l'icône → **Quitter**) : sinon, la prochaine modification faite
dans l'éditeur écraserait la vôtre. Modifiez le fichier généré sans le remplacer (les sections `device` et
`editor` et les 8 entrées de `buttons` doivent rester présentes), puis relancez l'application.

- `keys` contient toujours **12** emplacements (`null` = touche vide) ; `buttons` en contient toujours **8**.
- `ha.url` commence par `http://` ou `https://` ; `"allowSelfSigned": true` seulement pour un certificat
  auto-signé.
- Un fichier invalide est mis de côté (`config.invalid-<date>.json`) et remplacé par les valeurs par défaut :
  le journal l'indique.

Sans jeton, ou si Home Assistant est injoignable, la console affiche ses tableaux grisés avec l'indicateur
« HA hors ligne » ; la reconnexion est automatique (une connexion qui ne répond plus est détectée en
40 s au plus).

### Mises à jour automatiques

Chaque modification fusionnée dans ce dépôt publie une nouvelle version. L'application vérifie s'il en existe
une 10 s après son démarrage, puis toutes les 4 heures, et la télécharge en arrière-plan. Quand elle est
prête, une notification Windows l'annonce et l'entrée **Redémarrer pour installer la version x.y.z**
apparaît en tête du menu. Rien ne s'installe pendant que vous utilisez la console : la mise à jour
s'installe quand vous choisissez cette entrée, ou sinon à la prochaine fermeture de l'application.
Sans connexion Internet, la vérification échoue en silence et réessaie au cycle suivant.

La configuration et le jeton sont conservés par les mises à jour comme par la désinstallation.

### Journaux

Dans `%APPDATA%\loupedeck-ha\logs\` (menu de l'icône → **À propos…** → **Ouvrir les journaux**) :

- `app.log` : l'application (console, Home Assistant, éditeur). Au démarrage, il indique le fichier de
  configuration, l'URL Home Assistant, si un jeton est configuré et l'adresse de l'éditeur.
- `shell.log` : l'icône, le démarrage avec Windows, les mises à jour et les relances après plantage.

## Dépannage

- **Écran noir alors que la console est connectée** : la Live démarre avec la luminosité à 0 ; rien n'est
  visible tant que l'application n'a pas envoyé la luminosité. L'application l'envoie à chaque connexion
  (`device.brightness`, 1 par défaut). `app.log` doit afficher « Console connectée » puis
  « Première image affichée sur la console ».
- **Déconnexions après une mise en veille** : désactivez la **suspension sélective USB** (Panneau de
  configuration → Options d'alimentation → Modifier les paramètres du mode → Paramètres d'alimentation
  avancés → Paramètres USB → Paramètre de la suspension sélective USB → Désactivé).
- **Plusieurs consoles ou détection ratée** : fixez le port dans `device.path` (ex. `"COM4"`).
- **L'icône n'apparaît pas** : vérifiez la zone des icônes cachées (flèche « ^ ») ; `shell.log` doit
  contenir « Shell démarré ».
- **Firmware** : la console testée est en 0.2.5. Le problème de dessin connu avec le firmware 0.2.26 ne la
  concerne pas ; voir `docs/superpowers/notes/2026-11-20-spike-throughput.md`.

## Passer de la version du dépôt à la version installée

Si vous lanciez l'application depuis le dépôt (`pnpm start`, tâche planifiée « Loupedeck HA » créée par
l'ancien script d'installation du dépôt) :

1. **Avant de lancer l'installateur**, arrêtez l'ancienne version : dans VS Code (arrêt du débogage, ou
   Ctrl+C dans le terminal de `pnpm start`), ou, si elle tourne par la tâche planifiée, mettez fin à la
   tâche « Loupedeck HA » (Planificateur de tâches) et vérifiez dans le Gestionnaire des tâches qu'aucun
   processus Node.js de Loupedeck HA ne reste. Sinon, la version installée ne peut pas ouvrir la console ni
   le port de l'éditeur.
2. Installez la version publiée (voir [Installation](#installation)).

Au premier lancement, la version installée supprime l'ancienne tâche planifiée « Loupedeck HA » et les
raccourcis « Loupedeck HA – Configuration » du Bureau et du menu Démarrer : sinon, les deux versions se
disputeraient la console à l'ouverture de session. La configuration (`%APPDATA%\loupedeck-ha`) est reprise
telle quelle.

## Contribuer

### Prérequis

- Windows 11, **Node.js 24 ou plus récent**.
- **pnpm** (le projet n'utilise pas npm) : `corepack enable` ou [pnpm.io/installation](https://pnpm.io/installation).

### Compiler et lancer depuis le dépôt

```powershell
pnpm install
pnpm run build                 # compile l'application (dist\) et l'éditeur (editor\dist\)
pnpm start                     # l'application seule, sans icône (Ctrl+C pour arrêter)
pnpm run app                   # la version Electron (icône de notification) depuis le dépôt
```

**Quittez d'abord la version installée** (menu de l'icône → **Quitter**) : les deux versions partagent la
console, le port de l'éditeur et `%APPDATA%\loupedeck-ha`, et rien n'empêche de les lancer en même temps.

En développement, la case « Démarrer avec Windows » est grisée et les mises à jour automatiques sont
désactivées. Pour plus de détails dans le journal : `$env:LOG_LEVEL='debug'; pnpm start`.

### Développement

```powershell
pnpm test                      # tests (application puis éditeur)
pnpm exec tsc -p . --noEmit    # vérification des types
pnpm run dev                   # application avec rechargement (tsx)
pnpm run editor:dev            # éditeur avec rechargement (Vite)
pnpm run package               # installateur local dans release\ (sans publication)
pnpm run icon                  # régénère build\icon.ico
```

### Des modifications à la version publiée

1. Travaillez sur une branche et ouvrez une pull request vers `main` : le workflow `build` vérifie les types,
   lance les tests et compile.
2. À la fusion sur `main`, le workflow publie une Release `v0.2.<n>` (installateur, `.blockmap` et
   `latest.yml`). Les applications installées la récupèrent d'elles-mêmes.

## Licence

[MIT](LICENSE).
