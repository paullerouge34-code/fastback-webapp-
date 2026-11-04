// Construit le message pour Claude et l'envoie via le menu de partage Android.
import * as db from './db.js';
import { COLOR_PRIO } from './annotate.js';

const PRIO_LABEL = { high: 'haute', mid: 'moyenne', low: 'basse' };
const PRIO_ORDER = { high: 0, mid: 1, low: 2 };

export const sortByPriority = (list) =>
  list.slice().sort((a, b) => (PRIO_ORDER[a.priority] ?? 3) - (PRIO_ORDER[b.priority] ?? 3) || db.feedbackOrder(a) - db.feedbackOrder(b));

// items : [{ feedback, label }] (label = "v1.02" ou null)
export async function buildMessage({ project, scope, items }) {
  const sorted = sortByPriority(items.map((i) => i.feedback)).map((f) => items.find((i) => i.feedback === f));
  const files = [];
  let colorCode = false;
  const lines = [`Projet : ${project.name}${scope ? ` (${scope})` : ''}`];
  if (sorted.length > 1) {
    const hasPrio = sorted.some((i) => i.feedback.priority);
    lines.push(`Corrige ces ${sorted.length} feedbacks.${hasPrio ? ' Traite-les dans l\'ordre des priorités : haute, puis moyenne, puis basse.' : ''}`);
  } else {
    lines.push('Corrige ce feedback.');
  }
  for (const [n, { feedback: f, label }] of sorted.entries()) {
    const num = n + 1;
    const tags = [f.priority ? `priorité ${PRIO_LABEL[f.priority]}` : null, label ? `session ${label}` : null].filter(Boolean);
    const [first, ...rest] = (f.note || '').trim().split('\n');
    lines.push('');
    lines.push(`${num}. ${tags.length ? `[${tags.join(' · ')}] ` : ''}${first || '(pas de note, voir les captures)'}`);
    for (const r of rest) if (r.trim()) lines.push(`   - ${r.trim()}`);
    const names = [];
    for (const [k, imgId] of f.imageIds.entries()) {
      const img = await db.get('images', imgId);
      if (!img) continue;
      if ((img.shapes || []).some((s) => COLOR_PRIO[s.color])) colorCode = true;
      const name = `fb${num}-img${k + 1}.jpg`;
      names.push(name);
      files.push(new File([img.rendered || img.original], name, { type: 'image/jpeg' }));
    }
    if (names.length) lines.push(`   Captures : ${names.join(', ')}`);
  }
  if (colorCode) {
    lines.splice(2, 0, 'Sur les captures, la couleur des annotations indique l\'importance : rouge = haute, orange = moyenne, vert = basse.');
  }
  return { text: lines.join('\n'), files };
}

// Renvoie 'shared' | 'shared-text' | 'copied' | 'cancelled' | 'failed'
// Avec des images, beaucoup d'apps (dont Claude) ignorent le texte partagé :
// on copie donc aussi le texte, pour pouvoir le coller dans le message.
export async function send({ text, files }) {
  if (navigator.share) {
    try {
      if (files.length && navigator.canShare?.({ files, text })) {
        const copied = navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false);
        await navigator.share({ text, files });
        return (await copied) ? 'shared-copied' : 'shared';
      }
      if (!files.length) {
        await navigator.share({ text });
        return 'shared-text';
      }
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
