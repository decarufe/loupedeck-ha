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

### Configuration

L'éditeur visuel arrive dans une prochaine version. **Pour l'instant, on modifie la configuration à la main**
dans `%APPDATA%\loupedeck-ha\config.json`.

Ce fichier est **créé avec les valeurs par défaut au premier démarrage** (`pnpm start`, puis Ctrl+C) : un
tableau Lumières sur le bouton 0, Température sur le 1, Météo sur le 2, quatre Caméras sur les boutons 3 à 6.
Il suffit ensuite d'y renseigner `ha.url`, `ha.token` et les entités. Voici les parties à modifier pour un
tableau Lumières avec une seule touche. **Modifiez le fichier généré, ne le remplacez pas par cet extrait** :
les sections `device` et `editor` et les 8 entrées de `buttons` doivent rester présentes.

```json
{
  "version": 1,
  "ha": {
    "url": "http://homeassistant.local:8123",
    "token": "eyJhbGciOi...votre-jeton...",
    "allowSelfSigned": false
  },
  "buttons": [
    {
      "type": "lights",
      "name": "Lumières",
      "color": "#FFB300",
      "keys": [
        { "entityId": "light.xxx" },
        null, null, null, null, null, null, null, null, null, null, null
      ],
      "dimmers": { "knobTL": null, "knobCL": null, "knobBL": null, "knobTR": null, "knobCR": null, "knobBR": null }
    }
  ]
}
```

- `keys` contient toujours **12** emplacements (`null` = touche vide) ; `buttons` en contient toujours **8**.
- Une touche accepte aussi `"label"` et `"icon"` (ex. `{ "entityId": "light.salon", "label": "Salon", "icon": "mdi:sofa" }`).
- `https://…` est accepté ; `"allowSelfSigned": true` seulement pour un certificat auto-signé.
- Un fichier invalide est mis de côté (`config.invalid-<date>.json`) et remplacé par les valeurs par défaut :
  le journal l'indique.
- Pour l'instant, redémarrez l'application après avoir modifié le fichier.

## Lancer

```powershell
pnpm start
```

Les journaux s'affichent dans le terminal et sont aussi écrits dans `%APPDATA%\loupedeck-ha\logs\app.log`.
Au démarrage, le journal indique le fichier de configuration, l'URL Home Assistant et si un jeton est configuré.
Ctrl+C arrête proprement l'application. `LOG_LEVEL=debug` donne plus de détails.

Sans jeton, ou si Home Assistant est injoignable, la console affiche ses tableaux grisés avec l'indicateur
« HA hors ligne » ; la reconnexion est automatique.

## Démarrage automatique avec Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Install
```

Crée la tâche planifiée **« Loupedeck HA »**, lancée à l'ouverture de votre session, sans fenêtre
(`scripts\launch-hidden.vbs` exécute `node dist\main.js` depuis la racine du dépôt ; `node` doit donc être
dans le PATH). Pour la retirer :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall
```

Après une mise à jour du code, relancez `pnpm run build`. Si l'installation est refusée, lancez PowerShell
en administrateur.

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
pnpm test                      # tests
pnpm exec tsc -p . --noEmit    # vérification des types
pnpm run dev                   # lancement avec rechargement (tsx)
```

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
- [ ] **5. Caméras** : l'image remplit tout l'écran, environ 1 image/s ; le flux s'arrête quand on quitte
  le tableau ; une caméra sans image affiche « image non disponible » sans bloquer ; une image figée depuis
  5 s passe en gris avec la LED rouge clignotante.
- [ ] **6. Éditeur visuel** : prochaine version (pour l'instant, configuration à la main ci-dessus).
- [ ] **7. Fiabilité** : démarre à l'ouverture de session sans fenêtre (tâche « Loupedeck HA ») ; se
  reconnecte seule après avoir débranché / rebranché la console, redémarré Home Assistant ou coupé le
  réseau ; quand HA est injoignable, les touches sont grisées avec « HA hors ligne » au lieu d'états périmés.
