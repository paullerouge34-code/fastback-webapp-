# Fastback v1 — design

Date : 2026-11-03 · Statut : validé par Paul (« oui pour tout, commence le dev »)

## Pourquoi

Paul développe des apps mobiles (ex. DopaBreak) depuis son téléphone avec des sessions Claude Code.
Quand il teste ses apps, il veut noter vite les bugs, idées et détails de design, puis les envoyer à Claude pour correction.
Fastback est l'outil de prise de notes de test, pensé pour le téléphone.

## Objectifs v1

1. Classer les feedbacks par **projet → branche de version (v1, v2…) → session de test (v1.01, v1.02…) → feedback**.
2. Un feedback = captures d'écran annotées + note libre + priorité (haute / moyenne / basse), tout optionnel.
3. Annoter les captures : dessin libre, flèche, rectangle, cercle, texte, flou (pixellisation).
4. Statut par feedback : à faire / corrigé.
5. Envoyer à Claude : un feedback, une session, ou tous les « à faire » d'un projet. Le message trie par priorité et demande à Claude de commencer par les hautes.

## Hors périmètre v1

- Note vocale (plus tard, avec transcription en texte)
- Capture d'écran native / bouton flottant (demanderait une app Android native)
- Sync GitHub, création d'issues, comptes, sauvegarde cloud

## Contraintes

- Web app / PWA hébergée sur GitHub Pages (repo public), ajoutée à l'écran d'accueil Android.
- Développée depuis le téléphone via des sessions Claude Code : pas d'étape de build, code lisible tel quel.
- Les données restent sur le téléphone (IndexedDB). Si Paul efface les données du navigateur, tout est perdu.

## Approches envisagées

| Approche | Pour | Contre |
|---|---|---|
| **HTML + JS natif (modules ES), sans build** ✅ | Rien à installer, GitHub Pages sert les fichiers tels quels, chaque session Claude peut modifier un fichier et pousser | Moins de confort qu'un framework pour une très grosse app |
| React/Vite + build GitHub Actions | Écosystème riche | Étape de build à maintenir, plus lourd à faire évoluer depuis le téléphone |
| App native Android | Capture d'écran native possible | Hors de portée d'un dev 100 % téléphone, publication compliquée |

Choix (décision de Claude, Paul a dit oui pour tout) : **HTML + JS natif sans build**.

## Comment c'est construit

- `index.html` + `css/app.css` + `js/*.js` (modules ES), routage par `#hash`.
- `js/db.js` : IndexedDB, magasins `projects`, `branches`, `sessions`, `feedbacks`, `images`.
- `js/annotate.js` : éditeur plein écran sur `<canvas>`. On garde l'image d'origine + la liste des formes, pour pouvoir ré-annoter ; une image rendue (JPEG) sert à l'affichage et à l'envoi.
- `js/share.js` : construit le texte pour Claude ; envoi via le menu de partage Android (Web Share API avec fichiers). Si le partage n'est pas disponible : copie du texte dans le presse-papier.
- `sw.js` + `manifest.webmanifest` : installable et utilisable hors ligne (réseau d'abord, cache en secours).

### Modèle de données

- Project `{id, name, createdAt}`
- Branch `{id, projectId, version, createdAt}` — affichée « Feedback v{version} »
- Session `{id, branchId, number, createdAt}` — affichée « v{version}.{number sur 2 chiffres} », titre = date
- Feedback `{id, sessionId, note, priority: 'high'|'mid'|'low'|null, status: 'todo'|'done', imageIds[], createdAt}`
- Image `{id, feedbackId, original: Blob, shapes: [], rendered: Blob}`

### Écrans

1. **Mes projets** : liste + créer un projet (crée aussi la branche v1).
2. **Canvas du projet** : racine = nom du projet, une colonne par branche, sessions dessous. Boutons « + Nouvelle session », « + Branche vN », « Tout envoyer à Claude ».
3. **Session** : liste des feedbacks (vignette, priorité, statut), « + Ajouter un feedback », « Envoyer cette session ».
4. **Feedback** : captures (ajouter / annoter / supprimer), note, priorité, statut, « Envoyer à Claude ».
5. **Annotation** : outils, couleur, épaisseur, annuler, enregistrer.

### Format du message pour Claude

```
Projet : DopaBreak (v1, session v1.02)
Corrige ces 3 feedbacks. Traite-les dans l'ordre des priorités : haute, puis moyenne, puis basse.

1. [priorité haute] Le bouton Démarrer est caché par la barre du bas
   Captures : image 1, image 2
...
```

Les images sont jointes dans le même ordre (nommées `fb1-img1.jpg`…).

## Laissé au développeur

Style visuel (reprend la maquette), détails d'interaction, messages d'erreur.

## Retours de Paul après le premier test (2026-11-04)

1. **Notes en liste** : la note d'un feedback est une liste de points (un champ par point, Entrée ajoute un point, Retour arrière sur un point vide le supprime). Le premier point sert de titre. Stocké comme avant : un point par ligne dans `note`. Dans le message pour Claude, les points suivants sont des tirets.
2. **Outil Déplacer** dans l'annotation : toucher une annotation la sélectionne. On peut la glisser, la redimensionner avec les ronds blancs (coins, ou extrémités pour une flèche), changer sa couleur ou son épaisseur, la supprimer (corbeille). Toucher un texte déjà sélectionné permet de le modifier.
3. **Couleur = importance** : rouge = haute, orange = moyenne, vert = basse (pastilles H / M / B). Si une capture utilise ces couleurs, le message pour Claude explique ce code couleur.
4. **Bouton retour du téléphone** : il ferme la feuille ouverte (envoi, menus) ou l'écran d'annotation, au lieu de changer de page derrière. Depuis l'annotation, le retour garde ce qui a été dessiné (`js/overlay.js`).

## Retours du 2026-11-04 (suite)

1. **Bouton Enregistrer** sur un feedback, à côté de « Envoyer à Claude » : enregistre, confirme par un message et revient à la session. (La saisie reste enregistrée automatiquement au fil de l'eau.)
2. **Appui long sur une carte de feedback** (`js/reorder.js`) : la carte se soulève. On la glisse pour changer l'ordre (champ `order`, utilisé aussi pour départager les feedbacks de même priorité dans le message), ou on la lâche sur la zone rouge en bas pour la supprimer, avec un bouton « Annuler » pendant 5 secondes. Un appui long sans bouger ouvre un menu avec « Supprimer ».
3. **Canvas** : grande surface qu'on fait glisser dans tous les sens (haut, bas, gauche, droite). À l'ouverture, le nom du projet est centré en haut ; en revenant d'une session, on retrouve la position où on était.

## Retours du 2026-11-04 (3)

1. **Zoom du canvas** : boutons − / 100 % / + en haut à droite, pincement à deux doigts (et Ctrl + molette sur ordinateur). De 30 % à 250 %, zoom et position retenus par projet. Les traits sont calculés en unités de mise en page pour rester alignés à tous les niveaux de zoom.
2. **Supprimer une branche** : toucher l'en-tête « Feedback vN » ouvre un menu avec « Supprimer la branche » (avec confirmation, supprime aussi ses sessions).
3. **Sélection par simple appui** dans l'annotation, quel que soit l'outil : un appui sans glisser sur une annotation la sélectionne et passe en mode Déplacer. Une annotation sélectionnée se déplace ou se redimensionne directement.
4. **Rétablir** : flèche à côté d'Annuler pour refaire ce qui a été annulé.
5. **Partage vers Claude** : avec des images, l'app Claude ignore le texte partagé. Le bouton « Partager » copie donc aussi le texte dans le presse-papier ; la feuille explique de le coller dans le message Claude (appui long → Coller).

## Version 1.5 (2026-11-04)

1. **Sauvegarde** (`js/backup.js`) : sur l'accueil, « Exporter » crée un fichier JSON avec toutes les données, captures comprises en base64. On peut le télécharger ou le partager vers Drive. « Importer » ajoute ou remplace sans rien supprimer. La date de la dernière sauvegarde est affichée.
2. **Filtre et tri** dans une session : Tous / À faire / Corrigés, et « Tri : mon ordre » ou « Tri : priorité ». Le choix est gardé sur le téléphone. Le glisser-déposer garde la place des cartes cachées par le filtre et est désactivé en tri par priorité.
3. **Recadrer** : outil dans l'annotation. Le cadre est gardé avec l'image (`crop`), les annotations restent modifiables, l'image envoyée est recadrée. La corbeille enlève le recadrage, et Annuler / Rétablir le prennent en compte.
4. **Déplacer un feedback** vers une autre session du projet, depuis le menu ⋯ du feedback ou l'appui long sur sa carte.
5. **Type** de feedback (Bug / Idée / Design), en option. Il apparaît en étiquette sur la carte et dans le message pour Claude.
6. **Vert quand c'est fini** : une session, ou une version (« Feedback vN »), dont tous les feedbacks sont corrigés devient verte et un peu transparente dans le canvas.

## Version 1.6 (2026-11-04)

- **Deux destinations** dans la fenêtre d'envoi : « Claude (discussion) » pour une nouvelle discussion, avec un texte qui donne le contexte et demande la cause probable et la correction, et « Claude Code », avec un texte de travail dans le code : corriger dans l'ordre des priorités, vérifier le reste, demander si un point n'est pas clair, un commit par feedback, puis la liste des numéros corrigés. Le dernier choix est retenu.
- **Dépôt GitHub du projet** (optionnel, menu ⋯ du projet), écrit dans le texte pour Claude Code. Une adresse github.com collée est réduite à `propriétaire/dépôt`.

