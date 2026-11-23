# Loupedeck HA — Version installable — Conception

Date : 2026-11-22
Statut : approuvé par l’utilisateur le 2026-11-22

## 1. Intention

Aujourd'hui, Loupedeck HA se lance depuis le dépôt : `pnpm install`, `pnpm run build`, puis `pnpm start`
(en pratique, l'utilisateur le démarre depuis VS Code). La tâche planifiée `install-autostart.ps1` existe
mais pointe vers le dépôt et suppose Node dans le PATH.

L'utilisateur veut **ne plus dépendre de VS Code ni du dépôt** pour son usage quotidien : une application
installée qui vit dans la zone de notification de Windows et **se met à jour toute seule** à chaque fusion
sur `main`. C'est pour son propre PC ; le dépôt devient **public** sur GitHub, donc le README doit permettre
à n'importe qui d'installer la version publiée, puis expliquer comment contribuer.

## 2. Objectifs

1. **Mettre le dépôt en ligne** (fait par Claude, à la demande de l'utilisateur). Créer le dépôt public
   GitHub `decarufe/loupedeck-ha` et y pousser l'historique de `feat/loupedeck-ha` comme branche `main`
   (branche par défaut). La branche locale `master` (ancêtre de `feat/loupedeck-ha`, 2 commits de
   conception) est abandonnée. **Avant le premier push** (décisions de l'utilisateur) :
   - l'historique est réécrit en local pour que l'auteur et le committer de chaque commit utilisent
     l'adresse GitHub anonyme de l'utilisateur (`<id>+decarufe@users.noreply.github.com`) au lieu de son
     adresse personnelle ; la configuration git locale du dépôt utilise ensuite cette adresse ;
   - `docs/superpowers/notes/2026-11-20-alarmcom-doorbell.md` est anonymisée : identifiants d'entités, noms
     et modèles de caméras et détails de l'installation remplacés par des exemples génériques, le contenu
     technique conservé. Comme l'historique est réécrit de toute façon, la version anonymisée remplace la
     note dans tous les commits (aucune version d'origine dans l'historique publié) ;
   - un fichier `LICENSE` **MIT** est ajouté (même licence que la librairie `loupedeck`).
2. **Application Electron dans la zone de notification.** Une icône dont le menu (clic droit) propose :
   ```
   Ouvrir la configuration        ← ouvre http://127.0.0.1:<editor.port>/ dans le navigateur (aussi : clic gauche)
   ✓ Démarrer avec Windows        ← case à cocher
   À propos…                      ← dialogue : nom, version, lien GitHub, bouton « Ouvrir les journaux »
   ───────────────
   Quitter
   ```
   Quand une mise à jour est prête, une entrée **« Redémarrer pour installer la version X »** apparaît en tête
   du menu, et une notification Windows l'annonce une fois.
3. **Installateur Windows** (NSIS, par utilisateur, sans droits administrateur) : `LoupedeckHA-Setup-<version>.exe`.
   Il crée un raccourci « Loupedeck HA » dans le menu Démarrer. La désinstallation **conserve**
   `%APPDATA%\loupedeck-ha` (configuration, jeton, journaux).
4. **Mise à jour automatique** depuis les Releases GitHub publiques (electron-updater) : vérification au
   démarrage puis toutes les 4 heures, téléchargement en arrière-plan, installation au redémarrage demandé
   depuis le menu, ou à la fermeture de l'application.
5. **Workflow GitHub Actions.**
   - Sur chaque pull request vers `main` : installation, vérification des types, tests, compilation.
   - Sur chaque push sur `main` (donc chaque fusion) : la même chose, puis fabrication de l'installateur et
     publication d'une Release GitHub `v0.2.<numéro>` contenant l'installateur, son `.blockmap` et `latest.yml`.
6. **README réorganisé.** D'abord : télécharger l'installateur depuis la dernière Release, l'installer,
   configurer dans l'éditeur, mises à jour automatiques. Ensuite, une section **« Contribuer »** : prérequis
   (Node, pnpm), compilation et lancement locaux, tests, comment une fusion produit une release.

## 3. Non-objectifs

- Signer l'exécutable. SmartScreen avertira à la première installation (« Exécuter quand même ») ; le README
  le dit.
- Afficher l'état de la console ou de Home Assistant dans l'icône ou son info-bulle (possible plus tard).
- Remplacer l'éditeur web par une fenêtre Electron : l'icône ouvre l'éditeur dans le navigateur habituel.
- Canaux de mise à jour (bêta, stable), retour à une version antérieure depuis l'application.
- macOS, Linux, ARM64 : seulement Windows x64.
- Modifier le comportement de l'application elle-même (tableaux, éditeur, HA).

## 4. Anti-objectifs (échec même si « ça marche »)

- **Une mise à jour qui redémarre l'application pendant que l'utilisateur s'en sert**, sans qu'il l'ait
  demandé. L'installation ne se fait qu'au redémarrage choisi dans le menu ou à la fermeture.
- **Une mise à jour ou une désinstallation qui efface la configuration** ou le jeton.
- **Deux instances qui se disputent la console USB** (version installée lancée deux fois, ou ancienne tâche
  planifiée qui lance la version du dépôt en même temps).
- **Le jeton Home Assistant dans un journal, un artefact de build ou une Release.**
- `pnpm run dev` / `pnpm start` qui ne marchent plus sans Electron : le développement sans Electron reste
  possible.

## 5. Contraintes

- **pnpm uniquement**, jamais npm/npx (préférence de l'utilisateur), y compris dans le workflow
  (`pnpm/action-setup`, `pnpm install --frozen-lockfile`, `pnpm exec`).
- **Node ≥ 24** : l'application cible Node 24. La version d'Electron choisie doit embarquer un Node ≥ 24.
- **Modules natifs** : `@serialport/bindings-cpp` et `@napi-rs/canvas`, tous deux N-API (pas de recompilation
  pour l'ABI d'Electron). Ils doivent être exclus de l'archive asar (`asarUnpack`) pour pouvoir être chargés.
- **pnpm et electron-builder** : la structure de liens symboliques de pnpm pose des problèmes connus à
  electron-builder ; à résoudre (par exemple `node-linker=hoisted` limité au besoin, ou une étape de
  préparation des dépendances de production) et à vérifier en ouvrant l'installateur produit.
- **Override existant** : `canvas` est redirigé vers `stubs/canvas` (pnpm-workspace.yaml) ; le paquet
  produit ne doit pas tenter de charger le vrai `canvas`.
- **Chemins** : la configuration et les journaux restent dans `%APPDATA%\loupedeck-ha` (pas dans le dossier
  `userData` par défaut d'Electron). L'éditeur compilé (`editor/dist`) doit être trouvé dans le paquet :
  `createApp` accepte déjà `editorStaticDir`.
- **Une seule instance** : `app.requestSingleInstanceLock()`. Une deuxième ouverture (raccourci du menu
  Démarrer) ne lance rien et ouvre l'éditeur dans le navigateur.
- **Version du dépôt et version installée** : elles partagent la console, le port de l'éditeur et
  `%APPDATA%\loupedeck-ha`. Aucun verrou entre les deux *(choix de Claude)* : pour développer, on quitte la
  version installée depuis son menu avant `pnpm start` ; le README (section Contribuer) le dit.
- **Runner** `windows-latest` : l'installateur NSIS se fabrique sous Windows ; les tests existants y passent
  déjà (le projet est développé sous Windows).
- **Permissions du workflow** : `contents: write` seulement pour le job de publication ; le `GITHUB_TOKEN`
  suffit (pas de secret supplémentaire).

## 6. Approches considérées

| Approche | Pour | Contre |
|---|---|---|
| **A. Electron + electron-builder + electron-updater** *(retenue)* | Icône, dialogue, démarrage avec Windows et mise à jour depuis GitHub Releases fournis et éprouvés ; une seule chaîne de build TypeScript | Installateur d'environ 100 Mo (Chromium embarqué, presque inutilisé) ; Electron avait été écarté pour la v1 dans la conception initiale (« possible plus tard sans réécriture ») |
| B. Node SEA + petit programme d'icône en C#/.NET + Inno Setup | Environ 40 Mo, très peu de mémoire au repos | Trois chaînes de build, deux langages, mise à jour à écrire soi-même (la partie la plus délicate) |
| C. Tauri + Node en processus annexe | Interface légère | Rust en plus, et Node à emballer quand même : la complexité de B en pire |

**Choix de l'utilisateur : A**, parce que la mise à jour automatique, la partie qu'il veut fiable, y est
déjà écrite et éprouvée.

## 7. Conception

### 7.1 Processus

- **Processus principal Electron** (`src/electron/main.ts` ou équivalent) : verrou d'instance unique, icône
  et menu, dialogue « À propos », démarrage avec Windows, mise à jour, supervision.
- **Processus de l'application** : le code actuel, lancé par le processus principal comme processus Node
  enfant (`utilityProcess.fork`). Il démarre `createApp` comme `src/main.ts` aujourd'hui, avec les mêmes
  journaux et le même masquage du jeton. Le séparer du processus principal garde l'icône vivante si
  l'application plante et permet de la relancer.
- **Supervision** (remplace la boucle de `launch-hidden.vbs`) : si le processus de l'application sort avec
  un code différent de 0, le principal le relance après 5 s. Sortie à 0 : pas de relance.
- **Arrêt propre** : « Quitter », l'installation d'une mise à jour et la fermeture de session demandent au
  processus de l'application de s'arrêter proprement (équivalent du SIGINT actuel : `app.stop()`, LED et
  écran éteints), avec un délai maximal au-delà duquel il est tué.
- **Port de l'éditeur** : le processus principal a besoin de l'URL de l'éditeur pour « Ouvrir la
  configuration ». Il la reçoit du processus de l'application (message après démarrage, et à chaque
  changement), ou la lit dans `config.json` (`editor.port`, défaut 8765) si l'application n'a pas encore
  démarré.

### 7.2 Démarrage avec Windows

- `app.setLoginItemSettings({ openAtLogin })` ; la case du menu reflète `getLoginItemSettings().openAtLogin`.
- **Activé par défaut au premier lancement** après installation *(choix de Claude : c'est l'usage visé)*.
  L'utilisateur peut le décocher ; son choix est ensuite respecté.
- **Ancienne tâche planifiée** : au démarrage, si la tâche « Loupedeck HA » (créée par
  `install-autostart.ps1`) existe, l'application installée la supprime et le journalise, ainsi que les
  raccourcis « Loupedeck HA – Configuration.url » du Bureau et du menu Démarrer s'ils existent
  *(choix de Claude : sinon la version du dépôt et la version installée se disputeraient la console à
  l'ouverture de session)*.
- `scripts/install-autostart.ps1`, `scripts/launch-hidden.vbs` et `scripts/test-shortcuts.ps1` (et leurs
  tests s'il y en a) sont supprimés : l'application installée les remplace.

### 7.3 Mise à jour

- electron-updater, fournisseur GitHub (`decarufe/loupedeck-ha`), dépôt public : aucun jeton.
- Vérification au démarrage (après quelques secondes) puis toutes les 4 heures ; téléchargement automatique
  en arrière-plan.
- Mise à jour téléchargée → entrée de menu « Redémarrer pour installer la version X » + une notification
  Windows. `autoInstallOnAppQuit` reste actif : sinon, elle s'installe à la prochaine fermeture.
- Erreurs (hors ligne, GitHub indisponible) : journalisées, sans dialogue ni notification ; nouvel essai au
  prochain cycle.
- Les journaux de mise à jour vont dans le même fichier `%APPDATA%\loupedeck-ha\logs\app.log`, ou dans un
  fichier voisin.

### 7.4 Version

- Une fusion sur `main` = une release. Version **`0.2.<dernière étiquette publiée + 1>`**, calculée par le workflow
  (pas `github.run_number` : les vérifications de PR l'incrémentent aussi, les versions sautaient de 2) et
  écrite dans `package.json` par le workflow avant la fabrication (le fichier commité garde une version de
  base, par ex. `0.2.0`) *(choix de Claude : aucune modification manuelle avant de fusionner)*.
- La Release GitHub est étiquetée `v0.2.<numéro>` et pointe sur le commit fusionné.
- « À propos » affiche `app.getVersion()`. En développement, la version de `package.json`.

### 7.5 Dialogue « À propos »

`dialog.showMessageBox` : « Loupedeck HA », « Version 0.2.N », une ligne de description, le lien du dépôt
GitHub. Boutons : « Ouvrir les journaux » (ouvre le dossier `%APPDATA%\loupedeck-ha\logs`), « Page GitHub »,
« Fermer ».

### 7.6 Icône

Une icône `.ico` multi-tailles (16 à 256 px) pour l'installateur, l'exécutable et la zone de notification,
commitée dans le dépôt (par ex. `build/icon.ico`). Le dessin est laissé au constructeur : simple et lisible
à 16 px (évocation d'une console à touches, couleurs de Home Assistant).

### 7.7 Scripts du dépôt

- `pnpm run build` : compile l'application et l'éditeur (inchangé) et le processus principal Electron.
- `pnpm start` / `pnpm run dev` : l'application sans Electron, comme aujourd'hui.
- Nouveaux : un script pour lancer la version Electron depuis le dépôt (par ex. `pnpm run app`), et
  `pnpm run package` pour fabriquer l'installateur localement sans publier.

### 7.8 Workflow GitHub Actions

Fichier `.github/workflows/build.yml` (ou deux fichiers) :

- Déclencheurs : `pull_request` vers `main`, `push` sur `main`.
- Job `check` (Windows) : `pnpm install --frozen-lockfile`, `pnpm exec tsc -p . --noEmit`, `pnpm test`,
  `pnpm run build`.
- Job `release` (push sur `main` seulement, après `check`) : écrit la version, fabrique l'installateur,
  publie la Release `v0.2.<n>` avec l'installateur, le `.blockmap` et `latest.yml`. La publication
  est faite par electron-builder (`--publish always`) ou par une étape dédiée ; un seul mécanisme.
- Concurrence : deux fusions rapprochées ne doivent pas publier dans le désordre (`concurrency` sur le
  workflow : le numéro est calculé puis publié par un seul run à la fois).

### 7.9 README

Ordre proposé :

1. Ce que fait l'application (inchangé).
2. **Installation** : prérequis (Windows 11 x64, Loupedeck Live), télécharger
   `LoupedeckHA-Setup-x.y.z.exe` depuis la dernière Release, avertissement SmartScreen, libérer la console
   (fermer le logiciel Loupedeck / Logi Options+), jeton Home Assistant.
3. **Utilisation** : l'icône et son menu, configuration dans l'éditeur (contenu actuel), démarrage avec
   Windows, mises à jour automatiques, journaux.
4. **Dépannage** (contenu actuel, mis à jour : plus de tâche planifiée).
5. **Passer de la version du dépôt à la version installée** : l'ancienne tâche et les anciens raccourcis
   sont retirés automatiquement ; la configuration est reprise telle quelle.
6. **Contribuer** : Node ≥ 24, pnpm, `pnpm install`, `pnpm run build`, `pnpm start` / `pnpm run dev` /
   `pnpm run editor:dev` / version Electron, tests, `pnpm run package`, et le cycle « pull request → fusion
   sur `main` → release automatique ».

### 7.10 Ordre de mise en œuvre

1. Réécrire l'historique (adresse anonyme, note anonymisée), ajouter `LICENSE`, créer le dépôt public et
   pousser `feat/loupedeck-ha` comme `main` (y compris ce document).
2. Travailler sur une branche (par ex. `feat/installable`), ouvrir une pull request vers `main` : le job
   `check` s'exécute.
3. La fusion de la pull request produit la première Release, à installer à la main une première fois ; les
   suivantes arrivent par mise à jour automatique.

## 8. Laissé au constructeur

- La version exacte d'Electron (contrainte : Node ≥ 24) et la façon de faire cohabiter pnpm et
  electron-builder.
- Le découpage des fichiers du processus principal, et le protocole de messages avec le processus de
  l'application (URL de l'éditeur, demande d'arrêt).
- Le dessin de l'icône.
- Les tests : la logique pure (supervision, choix de la version, lecture du port, nettoyage de l'ancienne
  tâche) est testée avec des faux, comme le reste du projet ; l'installateur et la mise à jour se vérifient
  de bout en bout sur une vraie Release.
