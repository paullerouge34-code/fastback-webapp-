import * as db from './db.js';
import { openAnnotator } from './annotate.js';
import { buildMessage, send, sortByPriority } from './share.js';

const app = document.getElementById('app');
const PRIO = { high: 'Haute', mid: 'Moyenne', low: 'Basse' };

// ---------- Petits utilitaires ----------
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const firstLine = (s) => (s || '').trim().split('\n')[0];
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

let urls = [];
const blobUrl = (blob) => { const u = URL.createObjectURL(blob); urls.push(u); return u; };
const releaseUrls = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };

const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-6 16-3-7-7-1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>',
};

function bar(title, { back, menu, sub } = {}) {
  return `<header class="bar">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Retour">${ICON.back}</a>` : '<span class="brand-mark" aria-hidden="true"></span>'}
    <div class="bar-title"><h1>${esc(title)}</h1>${sub ? `<span>${esc(sub)}</span>` : ''}</div>
    ${menu ? `<button class="icon-btn" data-act="menu" aria-label="Plus d'options">${ICON.more}</button>` : ''}
  </header>`;
}

export function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2200);
  setTimeout(() => el.remove(), 2600);
}

// Feuille modale. actions : [{ label, value, kind: 'primary'|'danger'|'ghost' }]
function sheet({ title, body = '', actions = [{ label: 'Fermer', value: null, kind: 'ghost' }], onOpen }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sheet';
    el.innerHTML = `<form class="sheet-in" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2>${body}
      <div class="sheet-actions">${actions.map((a, i) => `<button type="${a.kind === 'primary' ? 'submit' : 'button'}" class="btn ${a.kind || 'ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>
    </form>`;
    const form = el.querySelector('form');
    const done = (v) => { el.remove(); resolve(v); };
    const primary = actions.findIndex((a) => a.kind === 'primary');
    form.addEventListener('submit', (e) => { e.preventDefault(); done(pick(actions[primary])); });
    el.addEventListener('click', (e) => {
      if (e.target === el) return done(null);
      const b = e.target.closest('button[data-i]');
      if (b && b.type === 'button') done(pick(actions[Number(b.dataset.i)]));
    });
    const pick = (a) => (typeof a.value === 'function' ? a.value(form) : a.value);
    document.body.appendChild(el);
    onOpen?.(form, done);
    form.querySelector('input, textarea')?.focus();
  });
}

const askName = (title, value = '') => sheet({
  title,
  body: `<input class="input" name="name" maxlength="60" placeholder="Ex. DopaBreak" value="${esc(value)}" autocomplete="off">`,
  actions: [{ label: 'Annuler', value: null }, { label: 'Valider', kind: 'primary', value: (f) => f.name.value.trim() || null }],
});

const confirmDelete = (what) => sheet({
  title: `Supprimer ${what} ?`,
  body: '<p class="muted">Cette action est définitive.</p>',
  actions: [{ label: 'Annuler', value: false }, { label: 'Supprimer', kind: 'danger', value: true }],
});

async function sendSheet(payload) {
  const msg = await buildMessage(payload);
  const n = msg.files.length;
  const res = await sheet({
    title: 'Envoyer à Claude',
    body: `<p class="muted">${n ? `${plural(n, 'image')} + ce texte. ` : ''}Choisis l'app Claude dans le menu de partage.</p><pre class="preview">${esc(msg.text)}</pre>`,
    actions: [
      { label: 'Copier le texte', value: 'copy' },
      { label: n ? `Partager (texte + ${plural(n, 'image')})` : 'Partager', kind: 'primary', value: 'share' },
    ],
  });
  if (res === 'copy') {
    try { await navigator.clipboard.writeText(msg.text); toast('Texte copié'); } catch { toast('Copie impossible sur cet appareil'); }
  } else if (res === 'share') {
    const r = await send(msg);
    if (r === 'copied') toast('Partage indisponible : texte copié à la place');
    else if (r === 'failed') toast('Partage impossible sur cet appareil');
  }
}

// ---------- Écran : mes projets ----------
async function projectsScreen() {
  const projects = await db.listProjects();
  const rows = await Promise.all(projects.map(async (p) => {
    const branches = await db.listBranches(p.id);
    let todo = 0, sessions = 0;
    for (const b of branches) {
      const ss = await db.listSessions(b.id);
      sessions += ss.length;
      for (const s of ss) todo += (await db.listFeedbacks(s.id)).filter((f) => f.status === 'todo').length;
    }
    const last = branches[branches.length - 1];
    return `<a class="project-card" href="#/p/${p.id}">
      <span class="pc-name">${esc(p.name)}</span>
      <span class="pc-meta">v${last ? last.version : 1} · ${plural(sessions, 'session')}</span>
      ${todo ? `<span class="chip todo">${todo} à faire</span>` : '<span class="chip status">à jour</span>'}
    </a>`;
  }));
  app.innerHTML = `${bar('Fastback', { sub: 'Mes projets' })}
    <main class="page">
      ${rows.length ? `<div class="stack">${rows.join('')}</div>` : `<div class="empty">
        <p class="empty-title">Aucun projet pour l'instant</p>
        <p class="muted">Crée un projet par app que tu testes, par exemple DopaBreak.</p></div>`}
      <button class="btn primary wide" data-act="new-project">${ICON.plus} Nouveau projet</button>
    </main>`;
  app.querySelector('[data-act="new-project"]').onclick = async () => {
    const name = await askName('Nouveau projet');
    if (!name) return;
    const p = await db.createProject(name);
    location.hash = `#/p/${p.id}`;
  };
}

// ---------- Écran : canvas du projet ----------
async function projectScreen(id) {
  const project = await db.get('projects', id);
  if (!project) return notFound();
  const branches = await db.listBranches(id);
  const cols = [];
  for (const b of branches) {
    const sessions = await db.listSessions(b.id);
    let branchTodo = 0;
    const nodes = [];
    for (const s of sessions) {
      const fbs = await db.listFeedbacks(s.id);
      const todo = fbs.filter((f) => f.status === 'todo');
      branchTodo += todo.length;
      const top = sortByPriority(todo)[0];
      nodes.push(`<a class="node leaf" href="#/s/${s.id}">
        <span class="dot ${top?.priority || (todo.length ? 'none' : 'ok')}"></span>
        <span class="v">${db.sessionLabel(b, s)}</span>
        <span class="t">${fmtDate(s.createdAt)} · ${fbs.length ? (todo.length ? `${todo.length} à faire` : 'tout corrigé') : 'vide'}</span>
      </a>`);
    }
    cols.push(`<div class="branch" data-branch>
      <div class="node branch-head" data-head><span>Feedback v${b.version}</span><small>${plural(sessions.length, 'session')}${branchTodo ? ` · ${branchTodo} à faire` : ''}</small></div>
      ${nodes.join('')}
      <button class="add" data-act="new-session" data-id="${b.id}">${ICON.plus} Nouvelle session</button>
    </div>`);
  }
  const nextV = branches.length ? branches[branches.length - 1].version + 1 : 1;
  cols.push(`<div class="branch"><button class="node add big" data-head data-act="new-branch">${ICON.plus} Branche v${nextV}</button></div>`);

  app.innerHTML = `${bar(project.name, { back: '#/', menu: true, sub: 'Projet' })}
    <main class="canvas-wrap"><div class="canvas"><div class="tree" id="tree">
      <div class="node root" id="root"><span class="name">${esc(project.name)}</span><span class="sub">projet</span></div>
      <div class="branches">${cols.join('')}</div>
    </div></div></main>
    <button class="fab" data-act="send-all">${ICON.send} Tout envoyer à Claude</button>`;

  requestAnimationFrame(drawWires);
  app.onclick = async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'new-session') {
      const s = await db.createSession(t.dataset.id);
      location.hash = `#/s/${s.id}`;
    } else if (act === 'new-branch') {
      await db.createBranch(id);
      toast(`Branche v${nextV} créée`);
      route();
    } else if (act === 'send-all') {
      const items = [];
      for (const b of branches) for (const s of await db.listSessions(b.id)) {
        for (const f of await db.listFeedbacks(s.id)) if (f.status === 'todo') items.push({ feedback: f, label: db.sessionLabel(b, s) });
      }
      if (!items.length) return toast('Aucun feedback à faire dans ce projet');
      sendSheet({ project, scope: 'tous les feedbacks à faire', items });
    } else if (act === 'menu') {
      const choice = await sheet({
        title: project.name,
        actions: [{ label: 'Renommer', value: 'rename' }, { label: 'Supprimer le projet', value: 'delete', kind: 'danger' }, { label: 'Fermer', value: null }],
      });
      if (choice === 'rename') {
        const name = await askName('Renommer le projet', project.name);
        if (name) { await db.put('projects', { ...project, name }); route(); }
      } else if (choice === 'delete' && await confirmDelete(`le projet « ${project.name} » et tous ses feedbacks`)) {
        await db.deleteProject(id);
        location.hash = '#/';
      }
    }
  };
}

function drawWires() {
  const tree = document.getElementById('tree');
  if (!tree) return;
  tree.querySelector('svg.wires')?.remove();
  const r = tree.getBoundingClientRect();
  const box = (el) => { const b = el.getBoundingClientRect(); return { cx: b.left - r.left + b.width / 2, l: b.left - r.left, t: b.top - r.top, b: b.bottom - r.top }; };
  const root = box(document.getElementById('root'));
  let d = '';
  tree.querySelectorAll('[data-head]').forEach((h) => {
    const b = box(h); const my = (root.b + b.t) / 2;
    d += `M${root.cx} ${root.b}V${my}H${b.cx}V${b.t}`;
  });
  tree.querySelectorAll('[data-branch]').forEach((col) => {
    const head = box(col.querySelector('[data-head]'));
    const items = col.querySelectorAll('.leaf, .add');
    if (!items.length) return;
    const x = head.l + 14;
    d += `M${x} ${head.b}V${box(items[items.length - 1]).t + 18}`;
    items.forEach((it) => { const ib = box(it); d += `M${x} ${ib.t + 18}H${ib.l}`; });
  });
  tree.insertAdjacentHTML('afterbegin', `<svg class="wires" aria-hidden="true" width="${tree.scrollWidth}" height="${tree.scrollHeight}"><path d="${d}"/></svg>`);
}
window.addEventListener('resize', () => requestAnimationFrame(drawWires));

// ---------- Écran : session ----------
async function sessionScreen(id) {
  const { session, branch, project } = await db.context({ sessionId: id });
  if (!session || !branch || !project) return notFound();
  const label = db.sessionLabel(branch, session);
  const fbs = await db.listFeedbacks(id);
  const cards = await Promise.all(fbs.map(async (f) => {
    const img = f.imageIds[0] ? await db.get('images', f.imageIds[0]) : null;
    const thumb = img ? `<img src="${blobUrl(img.rendered || img.original)}" alt="">` : '<span>Texte</span>';
    return `<a class="fb-card ${f.status === 'done' ? 'done' : ''}" href="#/f/${f.id}">
      <span class="thumb">${thumb}${f.imageIds.length > 1 ? `<b>${f.imageIds.length}</b>` : ''}</span>
      <span class="fb-c"><span class="fb-t">${esc(firstLine(f.note)) || '<i class="muted">Sans note</i>'}</span>
      <span class="row">${f.priority ? `<span class="chip ${f.priority}">${PRIO[f.priority]}</span>` : ''}<span class="chip status">${f.status === 'done' ? 'Corrigé' : 'À faire'}</span></span></span>
    </a>`;
  }));
  const todo = fbs.filter((f) => f.status === 'todo');
  app.innerHTML = `${bar(`${label} · ${fmtDate(session.createdAt)}`, { back: `#/p/${project.id}`, menu: true, sub: `${project.name} › Feedback v${branch.version}` })}
    <main class="page">
      ${cards.length ? `<div class="stack">${cards.join('')}</div>` : `<div class="empty"><p class="empty-title">Session vide</p><p class="muted">Ajoute un feedback pour chaque problème ou idée trouvé pendant ton test.</p></div>`}
      <button class="btn primary wide" data-act="new-fb">${ICON.plus} Nouveau feedback</button>
      ${fbs.length ? `<button class="btn ghost wide" data-act="send">${ICON.send} Envoyer cette session à Claude${todo.length ? ` (${todo.length})` : ''}</button>` : ''}
    </main>`;
  app.onclick = async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'new-fb') {
      const f = await db.createFeedback(id);
      location.hash = `#/f/${f.id}?new`;
    } else if (t.dataset.act === 'send') {
      if (!todo.length) return toast('Tous les feedbacks de cette session sont corrigés');
      sendSheet({ project, scope: `v${branch.version}, session ${label}`, items: todo.map((f) => ({ feedback: f, label: null })) });
    } else if (t.dataset.act === 'menu') {
      const c = await sheet({ title: `Session ${label}`, actions: [{ label: 'Supprimer la session', value: 'delete', kind: 'danger' }, { label: 'Fermer', value: null }] });
      if (c === 'delete' && await confirmDelete(`la session ${label} et ses feedbacks`)) {
        await db.deleteSession(id);
        location.hash = `#/p/${project.id}`;
      }
    }
  };
}

// ---------- Écran : feedback ----------
async function feedbackScreen(id, isNew) {
  const { feedback, session, branch, project } = await db.context({ feedbackId: id });
  if (!feedback || !session) return notFound();
  let f = feedback;
  const label = db.sessionLabel(branch, session);
  const images = (await Promise.all(f.imageIds.map((i) => db.get('images', i)))).filter(Boolean);

  app.innerHTML = `${bar('Feedback', { back: `#/s/${session.id}`, menu: true, sub: `${project.name} › ${label}` })}
    <main class="page detail">
      <section class="field">
        <span class="label">Captures</span>
        <div class="shots">
          ${images.map((img, k) => `<div class="shot">
            <button class="shot-img" data-act="annotate" data-id="${img.id}" aria-label="Annoter la capture ${k + 1}"><img src="${blobUrl(img.rendered || img.original)}" alt=""></button>
            <span class="shot-n">${k + 1}/${images.length}</span>
            <button class="shot-edit" data-act="annotate" data-id="${img.id}" aria-label="Annoter">${ICON.pen}</button>
            <button class="shot-del" data-act="del-img" data-id="${img.id}" aria-label="Supprimer la capture">${ICON.x}</button>
          </div>`).join('')}
          <label class="shot add-shot">${ICON.plus}<span>Ajouter des captures</span><input type="file" id="pick" accept="image/*" multiple hidden></label>
        </div>
      </section>
      <section class="field">
        <label class="label" for="note">Note</label>
        <textarea id="note" class="input note" rows="4" placeholder="Ce qui ne va pas, ou ton idée. La première ligne sert de titre.">${esc(f.note)}</textarea>
      </section>
      <section class="field">
        <span class="label">Priorité</span>
        <div class="seg" role="group" aria-label="Priorité">
          ${['high', 'mid', 'low'].map((p) => `<button class="seg-btn ${p}" data-act="prio" data-p="${p}" aria-pressed="${f.priority === p}">${PRIO[p]}</button>`).join('')}
        </div>
      </section>
      <section class="field">
        <span class="label">Statut</span>
        <div class="seg" role="group" aria-label="Statut">
          <button class="seg-btn" data-act="status" data-s="todo" aria-pressed="${f.status === 'todo'}">À faire</button>
          <button class="seg-btn ok" data-act="status" data-s="done" aria-pressed="${f.status === 'done'}">Corrigé</button>
        </div>
      </section>
      <button class="btn primary wide" data-act="send">${ICON.send} Envoyer à Claude</button>
    </main>`;

  const save = async (patch) => { f = { ...f, ...patch }; await db.put('feedbacks', f); };
  const note = app.querySelector('#note');
  let timer;
  note.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => save({ note: note.value }), 300); });
  note.addEventListener('blur', () => { clearTimeout(timer); save({ note: note.value }); });

  const annotate = async (imgId) => {
    const img = await db.get('images', imgId);
    const res = await openAnnotator(img.original, img.shapes || []);
    if (res) { await db.put('images', { ...img, shapes: res.shapes, rendered: res.rendered }); }
    route();
  };

  app.querySelector('#pick').addEventListener('change', async (e) => {
    const picked = [...e.target.files];
    if (!picked.length) return;
    await save({ note: note.value });
    const ids = [];
    for (const file of picked) {
      const img = await db.put('images', { id: db.uid(), feedbackId: id, original: file, shapes: [], rendered: null });
      ids.push(img.id);
    }
    await save({ imageIds: [...f.imageIds, ...ids] });
    if (ids.length === 1) return annotate(ids[0]);
    route();
  });

  app.onclick = async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'prio') {
      await save({ priority: f.priority === t.dataset.p ? null : t.dataset.p });
      app.querySelectorAll('[data-act="prio"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.p === f.priority));
    } else if (act === 'status') {
      await save({ status: t.dataset.s });
      app.querySelectorAll('[data-act="status"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.s === f.status));
    } else if (act === 'annotate') {
      await save({ note: note.value });
      annotate(t.dataset.id);
    } else if (act === 'del-img') {
      if (!await confirmDelete('cette capture')) return;
      await db.del('images', t.dataset.id);
      await save({ note: note.value, imageIds: f.imageIds.filter((i) => i !== t.dataset.id) });
      route();
    } else if (act === 'send') {
      await save({ note: note.value });
      if (!f.note.trim() && !f.imageIds.length) return toast('Ajoute une note ou une capture avant d\'envoyer');
      sendSheet({ project, scope: `v${branch.version}, session ${label}`, items: [{ feedback: f, label: null }] });
    } else if (act === 'menu') {
      const c = await sheet({ title: 'Feedback', actions: [{ label: 'Supprimer le feedback', value: 'delete', kind: 'danger' }, { label: 'Fermer', value: null }] });
      if (c === 'delete' && await confirmDelete('ce feedback')) {
        await db.deleteFeedback(id);
        location.hash = `#/s/${session.id}`;
      }
    }
  };
  if (isNew) note.focus();
}

function notFound() {
  app.innerHTML = `${bar('Introuvable', { back: '#/' })}<main class="page"><div class="empty"><p class="empty-title">Cet élément n'existe plus</p><p class="muted">Il a peut-être été supprimé.</p></div></main>`;
}

// ---------- Routeur ----------
let currentFeedback = null;

// Un feedback laissé sans note ni capture est supprimé en sortant.
async function cleanupEmpty(nextFeedback) {
  if (!currentFeedback || currentFeedback === nextFeedback) return;
  const f = await db.get('feedbacks', currentFeedback);
  if (f && !f.note.trim() && !f.imageIds.length) await db.deleteFeedback(f.id);
}

async function route() {
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const [, kind, id] = path.split('/');
  await cleanupEmpty(kind === 'f' ? id : null);
  currentFeedback = kind === 'f' ? id : null;
  releaseUrls();
  app.onclick = null;
  window.scrollTo(0, 0);
  try {
    if (kind === 'p') await projectScreen(id);
    else if (kind === 's') await sessionScreen(id);
    else if (kind === 'f') await feedbackScreen(id, query === 'new');
    else await projectsScreen();
  } catch (err) {
    console.error(err);
    app.innerHTML = `${bar('Erreur', { back: '#/' })}<main class="page"><div class="empty"><p class="empty-title">Quelque chose a planté</p><p class="muted">${esc(err.message)}</p></div></main>`;
  }
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
// Demande au navigateur de ne pas effacer les données en cas de manque de place.
navigator.storage?.persist?.().catch(() => {});
