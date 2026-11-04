// Fait fermer les fenêtres (feuilles, annotation) par le bouton retour du téléphone,
// au lieu de changer de page derrière elles.
const stack = [];
const waiters = [];

window.addEventListener('popstate', () => {
  if (waiters.length) { waiters.shift()(); return; }
  stack.pop()?.onBack();
});

// onBack : appelé quand l'utilisateur appuie sur retour.
// Renvoie release() à appeler quand la fenêtre se ferme par un bouton.
export function pushOverlay(onBack) {
  const entry = { onBack };
  history.pushState({ fastbackOverlay: true }, '');
  stack.push(entry);
  return () => new Promise((resolve) => {
    const i = stack.indexOf(entry);
    if (i < 0) return resolve();
    stack.splice(i, 1);
    waiters.push(resolve);
    history.back();
  });
}

// Filet de sécurité : si la page change quand même, on ferme tout.
export function dismissAll() {
  while (stack.length) stack.pop().onBack();
}
