# Fastback — notes de brainstorming

> Fichier de passage de relais : toute nouvelle session Claude (locale ou cloud) doit lire ce fichier d'abord.
> Brainstorming terminé, v1 codée (voir `docs/superpowers/specs/2026-11-03-fastback-v1-design.md`). Réponses en français, style "ADHD mode" (action d'abord, étapes numérotées, état rappelé à chaque message).

## But

Une web app qui m'aide à noter vite des feedbacks (bugs, idées, détails design) quand je teste les apps mobiles que je développe, puis à les retrouver ou les donner à Claude pour correction.

## Décisions prises (2026-11-03)

1. **Type d'app** : web app / PWA, hébergée sur GitHub Pages (repo public). Ajoutée à l'écran d'accueil du téléphone.
2. **Développement** : à terme 100 % depuis le téléphone, via des sessions cloud Claude Code sur ce repo. Le code est sauvegardé sur GitHub à chaque changement.
3. **Capture** : je fais la capture d'écran avec le téléphone, puis je l'importe dans l'app (une web app ne peut pas capturer l'écran d'une autre app).
4. **Sortie des feedbacks** : A + B
   - A : liste dans l'app (statut à faire / corrigé)
   - B : bouton "copier pour Claude" qui génère un texte propre (+ images) à coller dans une session Claude Code
   - Les feedbacks restent sur le téléphone (pas de sync GitHub pour l'instant).
5. **Plusieurs projets** : les feedbacks sont classés par projet (ex. DopaBreak, autre app).
6. **Outils d'annotation** : tous — dessin libre, flèches, rectangles/cercles, texte, flou.
7. **Contenu d'un feedback** : images annotées, texte libre, priorité. Tout est optionnel et combinable.
   - Propositions de Claude (à confirmer) : plusieurs images possibles par feedback ; priorité sur 3 niveaux (haute / moyenne / basse).
   - Note vocale : **pas en v1**, on verra plus tard (rappel : Claude Code ne peut pas écouter l'audio, il faudra une transcription en texte).
8. **Envoi vers Claude** : les deux modes.
   - Un feedback à la fois (bouton sur chaque feedback).
   - Tout d'un coup (bouton sur le projet) : le message demande à Claude de traiter dans l'ordre des priorités quand il y en a.
   - Piste technique : partage Android direct vers l'app Claude (texte + images), plus fiable que le presse-papier.
9. **Navigation en canvas** : un canvas visuel avec le nom du projet en racine, une branche par version de l'app ("Feedback v1", "Feedback v2"…).
   - Choix de Paul (variante B de la maquette) : **v1.01, v1.02… = des sessions de test**, chacune regroupe plusieurs feedbacks. Clic sur une session → liste de ses feedbacks → clic → détail (captures, note, priorité).
   - Maquette : https://claude.ai/artifact/1tMTTTyBtJ9ft6JPX6CmM8 (source dans le scratchpad de la session, non versionnée)
   - Propositions de Claude (à confirmer) : numéro de session automatique (v1.01, v1.02…) + date comme titre ; branche v2 créée à la main ; envoi possible pour une session entière.

## État (2026-11-04)

- En ligne sur GitHub Pages (`main`), installée sur le téléphone de Paul. Version 1.7.
- Détail de chaque version (1.1 à 1.7) : `docs/superpowers/specs/2026-11-03-fastback-v1-design.md`.
- Méthode de travail : voir `CLAUDE.md` (numéro de version, test Pixel 7, PR vers `main` fusionnée sans redemander).
- Si une publication GitHub Pages reste bloquée « In progress » sans étape, une nouvelle fusion dans `main` relance une publication neuve.
- Idées proposées mais pas encore faites : partage direct d'une capture vers Fastback, badge « Envoyé à Claude », « Tout marquer corrigé » après un envoi.

## Hors périmètre v1

- Note vocale (plus tard, avec transcription en texte)
- Bouton flottant / capture native (nécessiterait une app Android native)
- Création d'issues GitHub, sync des feedbacks sur GitHub
