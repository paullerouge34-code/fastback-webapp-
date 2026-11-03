# Fastback — notes de brainstorming

> Fichier de passage de relais : toute nouvelle session Claude (locale ou cloud) doit lire ce fichier d'abord.
> Brainstorming en cours (skill `brainstorming`), réponses en français, style "ADHD mode" (action d'abord, étapes numérotées, état rappelé à chaque message).

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

7. **Contenu d'un feedback** : images annotées, texte libre, note vocale, priorité. Tout est optionnel et combinable (un feedback peut n'avoir qu'un vocal, ou qu'une image, etc.).
   - Propositions de Claude (à confirmer) : plusieurs images possibles par feedback ; priorité sur 3 niveaux (haute / moyenne / basse).
   - Point soulevé : Claude Code ne peut pas écouter un fichier audio → pour que le vocal serve à la correction, il faudrait le transcrire en texte.

## Questions restantes

- (prochaine) Le vocal : il sert à toi (te souvenir) ou à Claude (doit être transcrit en texte dans l'export) ?
- Format exact de l'export "copier pour Claude"
- Ensuite : proposer 2-3 approches techniques, présenter le design, écrire le spec dans `docs/superpowers/specs/`.

## Hors périmètre v1

- Bouton flottant / capture native (nécessiterait une app Android native)
- Création d'issues GitHub, sync des feedbacks sur GitHub
