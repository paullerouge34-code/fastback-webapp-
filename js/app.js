import * as db from './db.js';
import { openAnnotator } from './annotate.js';
import { buildMessage, send, sortByPriority } from './share.js';
import { pushOverlay, dismissAll } from './overlay.js';
import { enableReorder } from './reorder.js';

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
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17 19 7"/></svg>',
  pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>',
};

function bar(title, { back, menu, sub } = {}) {
  return `<header class="bar">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Retour">${ICON.back}</a>` : '<span class="brand-mark" aria-hidden="true"></span>'}
    <div class="bar-title"><h1>${esc(title)}</h1>${sub ? `<span>${esc(sub)}</span>` : ''}</div>
    ${menu ? `<button class="icon-btn" data-act="menu" aria-label="Plus d'options">${ICON.more}</button>` : ''}
  </header>`;
}

// action : { label, run } affiche un bouton dans le message (ex. Annuler).
export function toast(msg, action) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.remove(); action.run(); };
  document.body.appendChild(el);
  const life = action ? 5000 : 2200;
  setTimeout(() => el.classList.add('out'), life);
  setTimeout(() => el.remove(), life + 400);
}

// Feuille modale. actions : [{ label, value, kind: 'primary'|'danger'|'ghost', run }]
// run(form) s'exécute tout de suite dans le geste (nécessaire pour partager / copier).
// Le bouton retour du téléphone ferme la feuille.
function sheet({ title, body = '', actions = [{ label: 'Fermer', value: null, kind: 'ghost' }], onOpen }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sheet';
    el.innerHTML = `<form class="sheet-in" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2>${body}
      <div class="sheet-actions">${actions.map((a, i) => `<button type="${a.kind === 'primary' ? 'submit' : 'button'}" class="btn ${a.kind || 'ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>
    </form>`;
    const form = el.querySelector('form');
    let closed = false;
    const finish = (v) => { if (closed) return; closed = true; el.remove(); resolve(v); };
    const release = pushOverlay(() => finish(null));
    const done = async (v) => { if (closed) return; el.remove(); await release(); finish(v); };
    const primary = actions.findIndex((a) => a.kind === 'primary');
    const pick = (a) => { a.run?.(form); return typeof a.value === 'function' ? a.value(form) : a.value; };
    form.addEventListener('submit', (e) => { e.preventDefault(); done(pick(actions[primary])); });
    el.addEventListener('click', (e) => {
      if (e.target === el) return done(null);
      const b = e.target.closest('button[data-i]');
      if (b && b.type === 'button') done(pick(actions[Number(b.dataset.i)]));
    });
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
  const copy = () => navigator.clipboard.writeText(msg.text)
    .then(() => toast('Texte copié'), () => toast('Copie impossible sur cet appareil'));
  const share = () => send(msg).then((r) => {
    if (r === 'shared-copied') toast('Texte copié : colle-le dans le message Claude');
    else if (r === 'copied') toast('Partage indisponible : texte copié à la place');
    else if (r === 'failed') toast('Partage impossible sur cet appareil');
  });
  await sheet({
    title: 'Envoyer à Claude',
    body: n
      ? `<ol class="steps"><li>Appuie sur <b>Partager</b> et choisis l'app Claude : ${plural(n, 'image')} y ${n > 1 ? 'sont ajoutées' : 'est ajoutée'}.</li>
         <li>Le texte est copié en même temps. Dans Claude, fais un <b>appui long dans la zone de message</b>, puis <b>Coller</b>.</li></ol><pre class="preview">${esc(msg.text)}</pre>`
      : `<p class="muted">Choisis l'app Claude dans le menu de partage.</p><pre class="preview">${esc(msg.text)}</pre>`,
    actions: [
      { label: 'Copier le texte seulement', value: null, run: copy },
      { label: n ? `Partager les ${plural(n, 'image')} + copier le texte` : 'Partager', kind: 'primary', value: null, run: share },
    ],
  });
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
const canvasScroll = new Map();

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
      <button class="node branch-head" data-head data-act="branch-menu" data-id="${b.id}" data-v="${b.version}" data-n="${sessions.length}"><span>Feedback v${b.version} <i aria-hidden="true">⋯</i></span><small>${plural(sessions.length, 'session')}${branchTodo ? ` · ${branchTodo} à faire` : ''}</small></button>
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
    <div class="zoom" role="group" aria-label="Zoom">
      <button class="zoom-btn" data-act="zoom-out" aria-label="Dézoomer">−</button>
      <button class="zoom-btn zoom-val" data-act="zoom-reset" aria-label="Taille normale">100 %</button>
      <button class="zoom-btn" data-act="zoom-in" aria-label="Zoomer">+</button>
    </div>
    <button class="fab" data-act="send-all">${ICON.send} Tout envoyer à Claude</button>`;

  app.classList.add('screen-canvas');
  const wrap = app.querySelector('.canvas-wrap');
  const tree = app.querySelector('#tree');
  const zoomVal = app.querySelector('.zoom-val');
  const saved = canvasScroll.get(id);
  let zoom = saved?.z || 1;
  const remember = () => canvasScroll.set(id, { x: wrap.scrollLeft, y: wrap.scrollTop, z: zoom });
  // Change le zoom en gardant le point (fx, fy) de l'écran au même endroit.
  const setZoom = (z, fx = wrap.clientWidth / 2, fy = wrap.clientHeight / 2, from = null) => {
    const s = from || { z: zoom, x: wrap.scrollLeft, y: wrap.scrollTop, fx, fy };
    z = Math.min(2.5, Math.max(0.3, z));
    const w = wrap.getBoundingClientRect(), t = tree.getBoundingClientRect();
    const tx = t.left - w.left + wrap.scrollLeft, ty = t.top - w.top + wrap.scrollTop;
    zoom = z;
    tree.style.zoom = z;
    const k = z / s.z;
    wrap.scrollLeft = tx + (s.x + s.fx - tx) * k - fx;
    wrap.scrollTop = ty + (s.y + s.fy - ty) * k - fy;
    zoomVal.textContent = `${Math.round(z * 100)} %`;
    remember();
  };
  tree.style.zoom = zoom;
  zoomVal.textContent = `${Math.round(zoom * 100)} %`;
  requestAnimationFrame(() => {
    drawWires();
    // Revient où on était dans ce canvas, sinon centre le nom du projet en haut.
    if (saved) { wrap.scrollLeft = saved.x; wrap.scrollTop = saved.y; return; }
    const w = wrap.getBoundingClientRect(), r = document.getElementById('root').getBoundingClientRect();
    wrap.scrollLeft += r.left - w.left + r.width / 2 - w.width / 2;
    wrap.scrollTop += r.top - w.top - 24;
  });
  wrap.addEventListener('scroll', remember, { passive: true });
  // Pincer avec deux doigts pour zoomer / dézoomer.
  let pinch = null;
  const mid = (a, b) => { const w = wrap.getBoundingClientRect(); return [(a.clientX + b.clientX) / 2 - w.left, (a.clientY + b.clientY) / 2 - w.top]; };
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    const [a, b] = e.touches; const [fx, fy] = mid(a, b);
    pinch = { d: dist(a, b), from: { z: zoom, x: wrap.scrollLeft, y: wrap.scrollTop, fx, fy } };
  }, { passive: true });
  wrap.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches; const [fx, fy] = mid(a, b);
    setZoom(pinch.from.z * (dist(a, b) / pinch.d), fx, fy, pinch.from);
  }, { passive: false });
  wrap.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; });
  wrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const w = wrap.getBoundingClientRect();
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX - w.left, e.clientY - w.top);
  }, { passive: false });
  app.onclick = async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'zoom-in') setZoom(zoom * 1.25);
    else if (act === 'zoom-out') setZoom(zoom / 1.25);
    else if (act === 'zoom-reset') setZoom(1);
    else if (act === 'branch-menu') {
      const v = t.dataset.v, n = Number(t.dataset.n);
      const c = await sheet({
        title: `Feedback v${v}`,
        actions: [{ label: 'Supprimer la branche', value: 'delete', kind: 'danger' }, { label: 'Fermer', value: null }],
      });
      if (c === 'delete' && await confirmDelete(`la branche v${v}${n ? ` et ses ${plural(n, 'session')}` : ''}`)) {
        await db.deleteBranch(t.dataset.id);
        toast(`Branche v${v} supprimée`);
        route();
      }
    } else if (act === 'new-session') {
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
  // Positions en unités de mise en page (le zoom du canvas s'applique ensuite à tout).
  const box = (el) => {
    let l = 0, t = 0;
    for (let n = el; n && n !== tree; n = n.offsetParent) { l += n.offsetLeft; t += n.offsetTop; }
    return { cx: l + el.offsetWidth / 2, l, t, b: t + el.offsetHeight };
  };
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
  tree.insertAdjacentHTML('afterbegin', `<svg class="wires" aria-hidden="true" width="1" height="1"><path d="${d}"/></svg>`);
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
    return `<a class="fb-card ${f.status === 'done' ? 'done' : ''}" href="#/f/${f.id}" data-id="${f.id}">
      <span class="thumb">${thumb}${f.imageIds.length > 1 ? `<b>${f.imageIds.length}</b>` : ''}</span>
      <span class="fb-c"><span class="fb-t">${esc(firstLine(f.note)) || '<i class="muted">Sans note</i>'}</span>
      <span class="row">${f.priority ? `<span class="chip ${f.priority}">${PRIO[f.priority]}</span>` : ''}<span class="chip status">${f.status === 'done' ? 'Corrigé' : 'À faire'}</span></span></span>
    </a>`;
  }));
  const todo = fbs.filter((f) => f.status === 'todo');
  const removeWithUndo = async (fbId) => {
    const saved = await db.get('feedbacks', fbId);
    const imgs = (await Promise.all(saved.imageIds.map((i) => db.get('images', i)))).filter(Boolean);
    await db.deleteFeedback(fbId);
    route();
    toast('Feedback supprimé', {
      label: 'Annuler',
      run: async () => { for (const im of imgs) await db.put('images', im); await db.put('feedbacks', saved); route(); },
    });
  };
  app.innerHTML = `${bar(`${label} · ${fmtDate(session.createdAt)}`, { back: `#/p/${project.id}`, menu: true, sub: `${project.name} › Feedback v${branch.version}` })}
    <main class="page">
      ${cards.length ? `<div class="stack" id="fb-list">${cards.join('')}</div>${cards.length > 1 ? '<p class="hint">Maintiens une carte pour changer son ordre ou la supprimer.</p>' : ''}` : `<div class="empty"><p class="empty-title">Session vide</p><p class="muted">Ajoute un feedback pour chaque problème ou idée trouvé pendant ton test.</p></div>`}
      <button class="btn primary wide" data-act="new-fb">${ICON.plus} Nouveau feedback</button>
      ${fbs.length ? `<button class="btn ghost wide" data-act="send">${ICON.send} Envoyer cette session à Claude${todo.length ? ` (${todo.length})` : ''}</button>` : ''}
    </main>`;
  const fbList = app.querySelector('#fb-list');
  if (fbList) {
    enableReorder(fbList, {
      onReorder: async (ids) => { await db.reorderFeedbacks(ids); route(); },
      onDelete: removeWithUndo,
      onHold: async (fbId) => {
        const f = fbs.find((x) => x.id === fbId);
        const c = await sheet({
          title: firstLine(f.note) || 'Feedback',
          body: '<p class="muted">Pour changer l\'ordre, maintiens la carte puis glisse-la.</p>',
          actions: [{ label: 'Supprimer ce feedback', value: 'delete', kind: 'danger' }, { label: 'Fermer', value: null }],
        });
        if (c === 'delete') removeWithUndo(fbId);
      },
    });
  }
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
        <span class="label" id="points-label">Notes</span>
        <ul class="points" id="points" aria-labelledby="points-label"></ul>
        <button class="add-point" data-act="add-point">${ICON.plus} Ajouter un point</button>
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
      <div class="actions-row">
        <button class="btn primary" data-act="save">${ICON.check} Enregistrer</button>
        <button class="btn ghost" data-act="send">${ICON.send} Envoyer à Claude</button>
      </div>
    </main>`;

  const save = async (patch) => { f = { ...f, ...patch }; await db.put('feedbacks', f); };
  // Notes en liste : un point par ligne, le premier sert de titre.
  const list = app.querySelector('#points');
  const note = { get value() { return [...list.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean).join('\n'); } };
  const pointHtml = (text) => `<li class="point"><span class="bullet" aria-hidden="true"></span>
    <input class="point-input" value="${esc(text)}" enterkeyhint="next" autocomplete="off">
    <button class="point-del" data-act="del-point" aria-label="Supprimer ce point">${ICON.x}</button></li>`;
  const placeholders = () => list.querySelectorAll('input').forEach((inp, i) => {
    inp.placeholder = i ? 'Un autre point' : 'Le problème ou l\'idée (sert de titre)';
    inp.setAttribute('aria-label', `Point ${i + 1}`);
  });
  const addPoint = (after, text = '') => {
    const tmp = document.createElement('ul');
    tmp.innerHTML = pointHtml(text);
    const li = tmp.firstElementChild;
    if (after) after.after(li); else list.append(li);
    placeholders();
    return li.querySelector('input');
  };
  const items = (f.note || '').split('\n').map((x) => x.trim()).filter(Boolean);
  (items.length ? items : ['']).forEach((t) => addPoint(null, t));
  let timer;
  const saveNote = () => { clearTimeout(timer); return save({ note: note.value }); };
  list.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(saveNote, 300); });
  list.addEventListener('focusout', saveNote);
  list.addEventListener('keydown', (e) => {
    const inp = e.target.closest('input');
    if (!inp) return;
    const li = inp.closest('li');
    if (e.key === 'Enter') {
      e.preventDefault();
      addPoint(li).focus();
    } else if (e.key === 'Backspace' && !inp.value && list.children.length > 1) {
      e.preventDefault();
      const prev = li.previousElementSibling?.querySelector('input') || li.nextElementSibling?.querySelector('input');
      li.remove(); placeholders(); saveNote();
      prev?.focus();
    }
  });

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
    if (act === 'add-point') {
      const inputs = list.querySelectorAll('input');
      const last = inputs[inputs.length - 1];
      (last && !last.value.trim() ? last : addPoint(list.lastElementChild)).focus();
    } else if (act === 'del-point') {
      const li = t.closest('li');
      if (list.children.length > 1) li.remove(); else li.querySelector('input').value = '';
      placeholders(); saveNote();
    } else if (act === 'prio') {
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
    } else if (act === 'save') {
      await saveNote();
      if (f.note.trim() || f.imageIds.length) toast('Feedback enregistré');
      location.hash = `#/s/${session.id}`;
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
  if (isNew) list.querySelector('input').focus();
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
  dismissAll();
  releaseUrls();
  app.onclick = null;
  app.className = '';
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
