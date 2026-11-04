# Fastback — consignes pour Claude

- Réponds en français, style « ADHD mode » : action d'abord, étapes numérotées, état rappelé.
- Lis d'abord `docs/brainstorm-notes.md` et `docs/superpowers/specs/2026-11-03-fastback-v1-design.md`.
- Pas d'étape de build : HTML + CSS + JS (modules ES) servis tels quels par GitHub Pages depuis `main`.

## À chaque mise à jour (demandé par Paul, le 2026-11-04)

1. Augmente la version dans `js/version.js` (`APP_VERSION`, `APP_DATE`) : 1.4 → 1.5 → 1.6…
2. Augmente `CACHE` dans `sw.js` et ajoute tout nouveau fichier JS à `SHELL`.
3. Teste dans Chromium avec l'émulation Pixel 7 (Playwright déjà installé).
4. Commit, push sur la branche de travail, puis **crée la pull request vers `main` et fusionne-la** sans redemander.
5. Dis à Paul quel numéro de version chercher en bas de l'écran d'accueil.
