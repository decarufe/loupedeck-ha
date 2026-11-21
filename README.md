# Loupedeck HA

Transforme une **Loupedeck Live** en télécommande **Home Assistant** sous Windows : lumières, thermostat,
météo et caméras, un tableau de bord par bouton rond.

## Prérequis

- Windows 11, **Node.js 24 ou plus récent**.
- **pnpm** (le projet n'utilise pas npm) : `corepack enable` ou [pnpm.io/installation](https://pnpm.io/installation).
- Une Loupedeck Live branchée en USB.

## Installation

```powershell
pnpm install
pnpm run build
```

### Libérer la console

La console ne peut être ouverte que par un seul programme. **Fermez le logiciel Loupedeck / Logi Options+**
et désactivez son lancement au démarrage de Windows (Gestionnaire des tâches → Applications de démarrage).
Si la console est occupée, le journal l'indique (« Fermez le logiciel Loupedeck ») et l'application réessaie
toute seule.

### Jeton Home Assistant

Dans Home Assistant : **Profil → Sécurité → Jetons d'accès longue durée → Créer un jeton**. Copiez-le
tout de suite : il n'est affiché qu'une fois. Le jeton n'est jamais écrit dans les journaux.

### Configuration : l'éditeur visuel

La configuration se fait dans **l'éditeur**, une page web locale servie par l'application :

1. Lancez l'application (`pnpm start`, voir plus bas) ;
2. Ouvrez **<http://127.0.0.1:8765>** dans votre navigateur, ou le raccourci
   **« Loupedeck HA – Configuration »** du Bureau ou du menu Démarrer (voir
   [Raccourci vers l'éditeur](#raccourci-vers-léditeur)).

`pnpm run build` compile **l'application et l'éditeur** ; sans cette étape, la page affiche seulement un
message d'attente.

Dans l'éditeur :

- **Réglages** : adresse Home Assistant (`http://…` ou `https://…`), jeton, certificat auto-signé,
  luminosité de la console. Le jeton saisi n'est jamais réaffiché ; changer d'adresse demande de le saisir
  à nouveau.
- **Boutons ronds** : cliquez sur un bouton de la Live virtuelle pour choisir le type de tableau, son nom et
  sa couleur.
- **Entités** : glissez une entité de la palette sur une touche ou une molette (ou cliquez l'entité, puis
  l'emplacement). Un dépôt refusé est expliqué. Libellé et icône se modifient dans le panneau de l'emplacement.
- **Caméras** : entité, **Intervalle (ms)** (250 à 2000, par pas de 250) et **Cadrage** : « Plein écran »
  (l'image remplit l'écran, bords rognés) ou « Image entière » (image complète, bandes noires).
- **Annuler** revient à la configuration précédente. Chaque modification est enregistrée et appliquée à la
  console aussitôt ; l'aperçu suit la console en direct.

Les modifications sont enregistrées dans `%APPDATA%\loupedeck-ha\config.json`, créé avec les valeurs par
défaut au premier démarrage : Lumières sur le bouton 0, Température sur le 1, Météo sur le 2, quatre Caméras
sur les boutons 3 à 6.

#### En recours : modifier le fichier à la main

**Application arrêtée** seulement (Ctrl+C, ou fin de la tâche « Loupedeck HA ») : sinon, la prochaine
modification faite dans l'éditeur écraserait la vôtre. Modifiez le fichier généré sans le remplacer (les
sections `device` et `editor` et les 8 entrées de `buttons` doivent rester présentes), puis relancez
l'application.

- `keys` contient toujours **12** emplacements (`null` = touche vide) ; `buttons` en contient toujours **8**.
- `ha.url` commence par `http://` ou `https://` ; `"allowSelfSigned": true` seulement pour un certificat
  auto-signé.
- Un fichier invalide est mis de côté (`config.invalid-<date>.json`) et remplacé par les valeurs par défaut :
  le journal l'indique.

## Lancer

```powershell
pnpm start
```

Les journaux s'affichent dans le terminal et sont aussi écrits dans `%APPDATA%\loupedeck-ha\logs\app.log`.
Au démarrage, le journal indique le fichier de configuration, l'URL Home Assistant, si un jeton est configuré
et l'adresse de l'éditeur. Ctrl+C arrête proprement l'application. Pour plus de détails dans le journal :

```powershell
$env:LOG_LEVEL='debug'; pnpm start
```

Sans jeton, ou si Home Assistant est injoignable, la console affiche ses tableaux grisés avec l'indicateur
« HA hors ligne » ; la reconnexion est automatique (une connexion qui ne répond plus est détectée en
40 s au plus).

## Démarrage automatique avec Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Install
```

Crée la tâche planifiée **« Loupedeck HA »**, lancée à l'ouverture de votre session, sans fenêtre
(`scripts\launch-hidden.vbs` exécute `node dist\main.js` depuis la racine du dépôt ; `node` doit donc être
dans le PATH).

**Relance après un plantage** : si l'application s'arrête sur une erreur (code de sortie différent de 0),
`launch-hidden.vbs` la relance après 5 s, autant de fois que nécessaire. Un arrêt volontaire (Ctrl+C,
SIGINT ou SIGTERM : code de sortie 0) arrête la boucle.

Pour retirer la tâche :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall
```

Après une mise à jour du code, relancez `pnpm run build` (application et éditeur).

## Raccourci vers l'éditeur

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Install
```

En plus de la tâche planifiée, `-Install` crée le raccourci **« Loupedeck HA – Configuration »** (fichier
`.url`) sur le **Bureau** et dans le **menu Démarrer**. Il ouvre l'éditeur sur `http://127.0.0.1:<port>/`
(l'application doit tourner). Le port est lu dans `editor.port` de `%APPDATA%\loupedeck-ha\config.json`,
sinon 8765 ; si vous changez le port, relancez `-Install` pour mettre les raccourcis à jour. Le jeton n'est
jamais lu ni affiché. `-Uninstall` supprime la tâche et les deux raccourcis (sans erreur s'ils n'existent pas).

Test du script (dossiers temporaires, aucune tâche ni raccourci réel) :
`powershell -ExecutionPolicy Bypass -File scripts\test-shortcuts.ps1`

## Dépannage

- **Écran noir alors que la console est connectée** : la Live démarre avec la luminosité à 0 ; rien n'est
  visible tant que l'application n'a pas envoyé la luminosité. L'application l'envoie à chaque connexion
  (`device.brightness`, 1 par défaut). Le journal doit afficher « Console connectée » puis
  « Première image affichée sur la console ».
- **Déconnexions après une mise en veille** : désactivez la **suspension sélective USB** (Panneau de
  configuration → Options d'alimentation → Modifier les paramètres du mode → Paramètres d'alimentation
  avancés → Paramètres USB → Paramètre de la suspension sélective USB → Désactivé).
- **Plusieurs consoles ou détection ratée** : fixez le port dans `device.path` (ex. `"COM4"`).
- **Firmware** : la console testée est en 0.2.5. Le problème de dessin connu avec le firmware 0.2.26 ne la
  concerne pas ; voir `docs/superpowers/notes/2026-11-20-spike-throughput.md`.

## Développement

```powershell
pnpm test                      # tests (application puis éditeur)
pnpm exec tsc -p . --noEmit    # vérification des types
pnpm run build                 # compile l'application (dist\) et l'éditeur (editor\dist\)
pnpm run dev                   # application avec rechargement (tsx)
pnpm run editor:dev            # éditeur avec rechargement (Vite)
```

`pnpm run editor:dev` sert l'éditeur en développement sur <http://127.0.0.1:5173> (Vite) ; il
s'adresse à l'application, qui doit tourner en parallèle (`pnpm run dev` ou `pnpm start`) sur le port 8765.

## Recette sur matériel

À vérifier sur la vraie console (objectifs 1 à 7 de la spec) :

- [ ] **1. Navigation** : chaque bouton rond configuré ouvre son tableau ; la LED du tableau actif est
  allumée dans sa couleur, les autres sont atténuées (éteintes si le bouton est vide). Après un redémarrage
  de l'application, le même tableau est actif.
- [ ] **2. Lumières** : un appui sur une touche allume / éteint la lumière (vibration courte) ; l'état suit
  Home Assistant. Une molette règle l'intensité de la lumière de la zone voisine ; appuyer sur la molette ou
  toucher la zone l'allume / l'éteint. Sans confirmation de HA sous 3 s, la touche revient à l'état réel avec
  une vibration d'erreur.
- [ ] **3. Température** : température ambiante, consigne et mode affichés en grand ; la molette change la
  consigne par pas de 0,5 °C (ou `target_temp_step`) dans les bornes ; les touches de mode changent le mode,
  le mode actif est mis en évidence.
- [ ] **4. Météo** : conditions actuelles (icône, température, ressenti, condition) et prévisions des jours
  suivants (icône, max, min).
- [ ] **5. Caméras** : l'image remplit tout l'écran (« Plein écran ») ou s'affiche entière avec des bandes
  noires (« Image entière »), au rythme de l'intervalle réglé (1 image/s par défaut) ; le flux s'arrête quand
  on quitte le tableau ; une caméra sans image affiche « image non disponible » sans bloquer ; une image
  figée depuis 5 s passe en gris avec la LED rouge clignotante.
- [ ] **6. Éditeur visuel** : <http://127.0.0.1:8765> (ou le raccourci) s'ouvre ; la Live virtuelle montre
  l'aperçu de la console, qui suit les changements en direct ; changer le type, le nom ou la couleur d'un
  bouton, placer une entité par glisser-déposer, modifier un libellé, régler l'intervalle et le cadrage d'une
  caméra : la console change aussitôt ; un dépôt invalide est refusé avec une explication ; « Annuler »
  revient en arrière ; le jeton n'est jamais réaffiché.
- [ ] **7. Fiabilité** : démarre à l'ouverture de session sans fenêtre (tâche « Loupedeck HA ») ; se
  reconnecte seule après avoir débranché / rebranché la console, redémarré Home Assistant ou coupé le
  réseau ; quand HA est injoignable, les touches sont grisées avec « HA hors ligne » au lieu d'états périmés ;
  après un plantage, l'application est relancée au bout de 5 s.
