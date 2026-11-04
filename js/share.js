// Construit le message pour Claude et l'envoie via le menu de partage Android.
import * as db from './db.js';
import { COLOR_PRIO } from './annotate.js';

const PRIO_LABEL = { high: 'haute', mid: 'moyenne', low: 'basse' };
const TYPE_LABEL = { bug: 'bug', idea: 'idée', design: 'design' };
const PRIO_ORDER = { high: 0, mid: 1, low: 2 };

export const sortByPriority = (list) =>
  list.slice().sort((a, b) => (PRIO_ORDER[a.priority] ?? 3) - (PRIO_ORDER[b.priority] ?? 3) || db.feedbackOrder(a) - db.feedbackOrder(b));

// items : [{ feedback, label }] (label = "v1.02" ou null)
// target : 'chat' (nouvelle discussion Claude) ou 'code' (session Claude Code sur le dépôt de l'app)
// known : Claude connaît déjà le projet et la méthode → texte court, sans la présentation.
export async function buildMessage({ project, scope, items, target = 'chat', known = false }) {
  const sorted = sortByPriority(items.map((i) => i.feedback)).map((f) => items.find((i) => i.feedback === f));
  const files = [];
  let colorCode = false;
  const n = sorted.length;
  const hasPrio = sorted.some((i) => i.feedback.priority);
  const order = hasPrio && n > 1 ? ', dans l\'ordre des priorités : haute, puis moyenne, puis basse' : '';
  const what = n > 1 ? `ces ${n} feedbacks` : 'ce feedback';
  const lines = [];
  const where = `${project.name}${scope ? `, ${scope}` : ''}`;
  if (known) {
    lines.push(target === 'code'
      ? `Nouveaux feedbacks à corriger (${where}). Même méthode que d'habitude${order}.`
      : `Autres retours sur ${project.name}${scope ? ` (${scope})` : ''}${order ? '. Traite-les dans l\'ordre des priorités : haute, puis moyenne, puis basse.' : ' :'}`);
  } else if (target === 'code') {
    lines.push(`Projet : ${project.name}${scope ? ` (${scope})` : ''}`);
    if (project.repo) lines.push(`Dépôt GitHub : ${project.repo}`);
    lines.push(`Tu travailles dans le code de cette app. Corrige ${what}${order}.`);
    lines.push('Pour chaque feedback :');
    lines.push('- trouve le code concerné et corrige-le ;');
    lines.push('- vérifie que le reste de l\'app marche toujours ;');
    lines.push('- si le point n\'est pas clair, pose-moi la question avant de modifier.');
  } else {
    lines.push(`Je teste mon app « ${project.name} »${scope ? ` (${scope})` : ''} et j'ai noté ${n > 1 ? `${n} retours` : 'un retour'}.`);
    lines.push(`Aide-moi à corriger ${what}${order}. Pour chacun, explique la cause probable et la correction à faire.`);
  }
  const headerEnd = lines.length;
  for (const [i, { feedback: f, label }] of sorted.entries()) {
    const num = i + 1;
    const tags = [f.screen ? `écran ${f.screen}` : null, TYPE_LABEL[f.type] || null, f.priority ? `priorité ${PRIO_LABEL[f.priority]}` : null, label ? `session ${label}` : null].filter(Boolean);
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
  const extra = [];
  if (files.length && !known) extra.push('Les captures sont jointes, nommées dans l\'ordre des numéros (fb1-img1.jpg…).');
  if (colorCode) extra.push('Sur les captures, la couleur des annotations indique l\'importance : rouge = haute, orange = moyenne, vert = basse.');
  lines.splice(headerEnd, 0, ...extra);
  if (target === 'code' && known) {
    lines.push('');
    lines.push('À la fin, donne-moi les numéros corrigés.');
  } else if (target === 'code') {
    lines.push('');
    lines.push('À la fin : fais un commit par feedback (avec son numéro dans le message), puis donne-moi la liste des numéros corrigés pour que je les passe en « Corrigé » dans Fastback.');
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
