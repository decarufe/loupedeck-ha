# Types de page, touches configurables et réordonnancement — Conception

Date : 2026-11-22. Source : le prototype « Atelier Loupedeck » validé par l'utilisateur dans Claude.
Ce document révise plusieurs points de `2026-11-20-loupedeck-home-assistant-design.md` (signalés dans ce document-là).

## 1. Ce que l'utilisateur a demandé

- Chaque page (le tableau ouvert par un bouton rond) affiche un type de contenu, au choix parmi cinq :
  **Bouton custom**, **Météo**, **Caméra**, **Contrôle de température**, **Graphique plein écran**.
- Une lumière est une touche comme une autre : le type « Lumières » disparaît, ses tableaux deviennent des pages Bouton custom.
- Le type d'une page ne se choisit que sur une page vide. Pour en changer, on vide d'abord la page (ou ses contrôles).
- Les pages et les touches se réordonnent par glisser-déposer, et les autres se décalent **en direct** pendant le glisser.
- Graphique plein écran : les molettes règlent l'échelle verticale et horizontale, et font défiler verticalement et horizontalement.
- Météo : la date et l'heure de la dernière mise à jour sont affichées, et on peut actualiser.
- Caméra : la tuile en haut à gauche compte le temps écoulé depuis la dernière image affichée.
  Appui court : forcer une image. Appui long : recharger l'intégration Home Assistant de la caméra.
- Décisions prises en répondant aux questions de Claude :
  - un seul lot de travail (une seule PR) ;
  - sur une page caméra, **seule la tuile compteur** réagit au toucher ;
  - seuils du compteur : vert sous 10 s, ambre jusqu'à 30 s, rouge au-delà ; l'image ne passe plus en niveaux de gris quand elle est figée ;
  - les tableaux Lumières existants sont convertis automatiquement en pages Bouton custom.

## 2. Configuration (version 2)

- `version: 2`. Une configuration v1 est convertie au chargement (`migrateConfig`) :
  touches Lumières → touches **Interrupteur**, molettes → **Gradateur**. Rien ne se perd ; le fichier est réécrit en v2 à la première modification.
- Page `custom` : `keys` (12 touches) et `strips` (une zone latérale par molette, clés `knobTL`… `knobBR`).
  Chaque emplacement est vide ou contient une touche typée :

| Type | Entité | Touche centrale | Bande latérale | Réglages |
|---|---|---|---|---|
| Interrupteur (`toggle`) | lumière, prise, booléen, ventilateur | oui | oui | — |
| Action (`action`) | scène ou script | oui | non | appui long obligatoire (`confirm`) |
| État (`state`) | capteur tout ou rien | oui | oui | texte et couleur pour chaque état |
| Valeur (`value`) | capteur | oui | oui | format (`{valeur}`, `{unité}`, `{nom}`), décimales |
| Graphique (`graph`) | capteur numérique | oui | non | période 1 h / 6 h / 24 h, aire ou ligne, min et max, décimales |
| Date et heure (`clock`) | aucune | oui | oui | format |
| Gradateur (`dimmer`) | lumière gradable | non | oui | — |

  Toutes les touches acceptent un libellé, une icône et une couleur (sinon la couleur de la page).
  Une touche peut exister sans entité (type choisi d'abord) : elle affiche « Choisir une entité ».
- Page `graph` : `entityId` (capteur numérique) et `windowHours` (1, 3, 6, 12, 24 ou 72 h).
- Une page est **vide** si le bouton n'a pas de page, ou si c'est une page Bouton custom sans aucune touche.

## 3. Console

- Gestes : la librairie fournit `touchstart` et `touchend`. `touchend` devient l'événement `release` ; l'appui long (1 s) est détecté par `PressTracker`.
- Bouton custom : Interrupteur et Gradateur gardent le comportement de l'ancien tableau Lumières. Action : un appui lance la scène ou le script ;
  une action protégée ne part qu'après un appui long. État, Valeur, Graphique et Date et heure sont en lecture seule.
- Historique : `history/history_during_period` (réponse minimale, sans attributs), rechargé toutes les 5 min et complété par les changements d'état en direct.
- Graphique plein écran : 72 h d'historique chargées. Molettes : haut gauche = échelle verticale, milieu gauche = défilement vertical,
  haut droite = fenêtre (échelle horizontale), milieu droite = défilement horizontal. Un appui sur une molette recadre son axe.
  Chaque zone latérale indique la fonction et la valeur de sa molette ; une barre en bas montre la position dans l'historique.
- Météo : zone haut droite (bande latérale) = date et heure de la dernière mise à jour (prévisions reçues ou entité changée).
  Un appui demande `homeassistant.update_entity` puis redemande les prévisions.
- Caméra : tuile haut gauche (zone de la molette haut gauche) = temps depuis la dernière image, en couleur selon les seuils.
  Appui court : la boucle demande une image sans attendre la fin de l'intervalle. Appui long : `homeassistant.reload_config_entry` sur l'entité caméra,
  puis nouvelle image. Le reste de l'écran ne réagit pas. Image figée (30 s) : la tuile passe au rouge et la LED du bouton actif
  clignote en rouge, comme avant. Home Assistant hors ligne : l'image passe toujours en niveaux de gris.
- Pages réordonnées pendant que la console affiche l'une d'elles : la console reste sur la même page, qui a changé de bouton.

## 4. Éditeur

- Panneau de page : sur une page vide, les cinq types à choisir. Sinon, le type est affiché, avec « Vider les contrôles » (Bouton custom)
  ou « Vider la page » (autres types) ; la page vidée garde son nom et sa couleur. Annuler permet de revenir en arrière.
- Palette à deux onglets : **Types de touche** et **Entités**. On glisse un type puis on choisit son entité, ou on glisse une entité
  et le type est deviné (porte → État, scène → Action, lumière gradable sur une bande → Gradateur, etc.).
  Déposée sur une touche du même type, une entité remplace l'ancienne et garde le format.
- Éditeur de touche : type, entité filtrée selon le type, libellé, réglages propres au type, couleur, icône.
- Glisser-déposer :
  - touches centrales : déposée sur une touche occupée, la touche s'insère et les suivantes se décalent ; Maj = échanger ; Ctrl = copier ;
    sur un emplacement vide, simple déplacement ;
  - bandes latérales : échange ;
  - sous la console pendant un glisser : zone « Déposer ici pour retirer » ;
  - boutons ronds : même règle que les touches centrales, la sélection suit la page.
  Pendant le glisser, l'aperçu montre le résultat : les touches (morceaux de l'aperçu) et les boutons ronds glissent à leur place provisoire.
- Commandes de page (POST `/api/pages/:i/command`) : Météo « Actualiser » (`update_entity`) ; Caméra « Forcer une image » (nouvelle image fixe
  pour l'aperçu) et « Recharger l'intégration » (`reload_config_entry`). Ce sont les seules actions de l'éditeur qui touchent Home Assistant.

## 5. Interface de l'éditeur (reprise de l'Atelier, 2026-11-23)

- Thème sombre de l'Atelier : polices locales seulement (Inter, Space Grotesk si installées, sinon Segoe UI) — l'éditeur ne contacte aucun service externe.
- En-tête : titre « Atelier Loupedeck », état de Home Assistant et de la console, choix du mode **Éditer / Essayer**, **Annuler**, **⚙ Réglages**.
  Les réglages (adresse, jeton, luminosité) s'ouvrent dans un panneau par-dessus l'atelier. Pas de « Rétablir » ni de « Réinitialiser » (choix de l'utilisateur).
- Atelier en trois colonnes (disposition A seulement) : palette · console · réglages ; une seule colonne sur un écran étroit.
- Palette : types de touche avec icône et description ; entités avec icône, identifiant, pièce et valeur actuelle.
- Console : molettes, boutons ronds avec leur LED, nom et couleur de la page ; touches de l'écran arrondies et séparées (aussi sur la vraie console).
- Réglages de touche : aperçu agrandi de la touche, ce qu'elle fait sur la console, pastilles de couleur, grille d'icônes (et champ pour une autre icône `mdi:`).
  Une touche sélectionnée remplace les réglages de la page dans le panneau ; « ← Page » ou Échap y revient.
- Pendant un glisser : cibles valides en vert, les autres atténuées, étiquette qui suit le pointeur avec ce qui va se passer ou pourquoi c'est refusé.
- Raccourcis : Ctrl+Z annule, Échap désélectionne (ou ferme les réglages), Suppr retire la touche sélectionnée.
- **Mode Essayer** (décision de l'utilisateur, révise l'objectif « l'éditeur ne pilote pas la maison ») : toucher une touche, une zone ou l'écran,
  tourner une molette (molette de souris ou glisser vertical) ou l'appuyer envoie le geste à la page par `POST /api/pages/:i/input`,
  exactement comme la console : **la vraie maison est pilotée**. Le serveur valide chaque geste champ par champ. L'appui long est le temps réel
  entre l'appui et le relâchement. En mode Éditer, aucun geste n'est envoyé.
