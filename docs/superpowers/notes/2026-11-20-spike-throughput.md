# Essai de débit de la Loupedeck Live (2026-11-20)

Script : `npm run spike` (`scripts/spike-throughput.ts`). Machine : Windows 11, Node 26.3.0.

## Console
- Port : COM4, VID 0x2ec2, PID 0x0004
- Numéro de série : LDD2001014021330700766B0008
- Firmware : 0.2.5 (pas le 0.2.26 : le problème de dessin du point 8 de la spec §12 ne s'applique pas ici)
- Erreurs : aucune. Connexion immédiate, `close()` propre.

## Mesures (10 s chacune, `drawBuffer` avec `autoRefresh: false` puis `refresh('left')`, couleurs alternées)
| Mesure | Images | Images/s |
|---|---|---|
| Plein écran 480 x 270 | 396 | 39,6 (environ 25 ms par image) |
| Touche 90 x 90 | 4285 | 428,5 (environ 2,3 ms par image) |

## Décision : `FULL_FRAME_THRESHOLD`
- Coût mesuré : 14 régions à 2,3 ms valent environ 33 ms, contre 25 ms pour le plein écran. Le point d'équilibre est donc vers 10 à 11 régions.
- Valeur retenue : **7 sur 14** (la valeur par défaut). À 7 régions, l'envoi par régions (environ 16 ms) reste moins cher que le plein écran, avec de la marge pour les régions de bande (60 x 90).

## Caméra à 1 image/s
Atteignable avec une très grande marge : une région de caméra coûte quelques millisecondes, soit moins de 1 % du temps disponible par seconde. Même à 4 images/s (intervalle minimal de 250 ms), un plein écran (25 ms) tient largement.
