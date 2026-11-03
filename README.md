# Fastback

Web app (PWA) pour noter vite les feedbacks quand je teste mes apps mobiles, puis les envoyer à Claude pour correction.

- Projet → branche de version (v1, v2…) → session de test (v1.01, v1.02…) → feedback
- Un feedback = captures annotées (dessin, flèche, rectangle, cercle, texte, flou) + note + priorité + statut
- Envoi à Claude : un feedback, une session, ou tout ce qui reste à faire, trié par priorité
- Les données restent sur le téléphone (IndexedDB du navigateur)

Design : [`docs/superpowers/specs/2026-11-03-fastback-v1-design.md`](docs/superpowers/specs/2026-11-03-fastback-v1-design.md)

## Mise en ligne (GitHub Pages)

1. Fusionner le travail dans `main`.
2. Sur GitHub : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. L'app est servie sur `https://paullerouge34-code.github.io/fastback-webapp-/`.
4. Sur Android (Chrome) : ouvrir l'adresse → menu ⋮ → **Ajouter à l'écran d'accueil**.

## Développement

Aucune étape de build : HTML, CSS et JavaScript (modules ES) servis tels quels.

```
python3 -m http.server 8000   # puis ouvrir http://localhost:8000
```

- `index.html`, `css/app.css`
- `js/app.js` : écrans et routage (`#/p/…`, `#/s/…`, `#/f/…`)
- `js/db.js` : stockage IndexedDB
- `js/annotate.js` : éditeur d'annotation
- `js/share.js` : message pour Claude + menu de partage
- `sw.js`, `manifest.webmanifest` : installation et hors ligne
