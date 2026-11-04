// Éditeur d'annotation plein écran : déplacer, dessin libre, flèche, rectangle, cercle, texte, flou.
// openAnnotator(originalBlob, shapes, crop) → Promise<{ shapes, crop, rendered } | null>
import { pushOverlay } from './overlay.js';

const MAX_SIDE = 2000;

// Les 3 premières couleurs portent une importance, comme la priorité d'un feedback.
export const COLORS = [
  { c: '#ff3b30', name: 'Rouge', prio: 'haute' },
  { c: '#ff9500', name: 'Orange', prio: 'moyenne' },
  { c: '#34c759', name: 'Vert', prio: 'basse' },
  { c: '#2f6bff', name: 'Bleu' },
  { c: '#ffffff', name: 'Blanc' },
  { c: '#111111', name: 'Noir' },
];
export const COLOR_PRIO = Object.fromEntries(COLORS.filter((x) => x.prio).map((x) => [x.c, x.prio]));
const WIDTHS = [{ label: 'Fin', k: 0.6 }, { label: 'Moyen', k: 1 }, { label: 'Épais', k: 1.8 }];

const ICONS = {
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  pen: '<path d="M4 20c3-1 4-3 6-6s4-7 7-9c1.5-1 3 .5 2 2-2 3-6 5-9 7s-5 3-6 6"/>',
  arrow: '<path d="M5 19 19 5M10 5h9v9"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  blur: '<path d="M4 4h4v4H4zM12 4h4v4h-4zM8 8h4v4H8zM16 8h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4zM8 16h4v4H8zM16 16h4v4h-4z"/>',
  undo: '<path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
};
const TOOLS = [
  ['move', 'Déplacer'], ['pen', 'Dessin'], ['arrow', 'Flèche'], ['rect', 'Rectangle'],
  ['ellipse', 'Cercle'], ['text', 'Texte'], ['blur', 'Flou'], ['crop', 'Recadrer'],
];

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const clone = (x) => JSON.parse(JSON.stringify(x));

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150;
}

// ---------- Géométrie ----------
const textFont = (s) => `700 ${s.size}px system-ui, sans-serif`;

function bbox(ctx, s) {
  if (s.type === 'pen') {
    const xs = s.points.map((p) => p[0]), ys = s.points.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (s.type === 'text') {
    ctx.save(); ctx.font = textFont(s);
    const lines = s.text.split('\n');
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    ctx.restore();
    return { x: s.x, y: s.y, w, h: lines.length * s.size * 1.2 };
  }
  const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
  return { x, y, w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
}

function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function hit(ctx, s, p, tol) {
  if (s.type === 'pen') {
    if (s.points.length === 1) return Math.hypot(p[0] - s.points[0][0], p[1] - s.points[0][1]) < tol + s.width;
    for (let i = 1; i < s.points.length; i++) if (distToSeg(p, s.points[i - 1], s.points[i]) < tol + s.width / 2) return true;
    return false;
  }
  if (s.type === 'arrow') return distToSeg(p, [s.x1, s.y1], [s.x2, s.y2]) < tol + s.width / 2;
  const b = bbox(ctx, s);
  if (s.type === 'ellipse') {
    const rx = b.w / 2 + tol, ry = b.h / 2 + tol;
    const dx = p[0] - (b.x + b.w / 2), dy = p[1] - (b.y + b.h / 2);
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
  }
  return p[0] >= b.x - tol && p[0] <= b.x + b.w + tol && p[1] >= b.y - tol && p[1] <= b.y + b.h + tol;
}

function handles(ctx, s) {
  if (s.type === 'arrow') return [{ id: 'p1', x: s.x1, y: s.y1 }, { id: 'p2', x: s.x2, y: s.y2 }];
  const b = bbox(ctx, s);
  return [
    { id: 'nw', x: b.x, y: b.y }, { id: 'ne', x: b.x + b.w, y: b.y },
    { id: 'sw', x: b.x, y: b.y + b.h }, { id: 'se', x: b.x + b.w, y: b.y + b.h },
  ];
}

function moved(snap, dx, dy) {
  const s = clone(snap);
  if (s.type === 'pen') s.points = snap.points.map(([x, y]) => [x + dx, y + dy]);
  else if (s.type === 'text') { s.x += dx; s.y += dy; }
  else { s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy; }
  return s;
}

// Redimensionne en tirant une poignée ; le coin opposé reste fixe.
function resized(ctx, snap, handle, p) {
  const s = clone(snap);
  if (handle === 'p1') { s.x1 = p[0]; s.y1 = p[1]; return s; }
  if (handle === 'p2') { s.x2 = p[0]; s.y2 = p[1]; return s; }
  const ob = bbox(ctx, snap);
  const fx = handle.includes('w') ? ob.x + ob.w : ob.x;
  const fy = handle.includes('n') ? ob.y + ob.h : ob.y;
  if (s.type === 'text') {
    const k = Math.max(0.2, Math.max(Math.abs(p[0] - fx) / (ob.w || 1), Math.abs(p[1] - fy) / (ob.h || 1)));
    s.size = Math.max(8, snap.size * k);
    const nw = ob.w * (s.size / snap.size), nh = ob.h * (s.size / snap.size);
    s.x = handle.includes('w') ? fx - nw : fx;
    s.y = handle.includes('n') ? fy - nh : fy;
    return s;
  }
  const nb = { x: Math.min(fx, p[0]), y: Math.min(fy, p[1]), w: Math.abs(p[0] - fx), h: Math.abs(p[1] - fy) };
  const sx = ob.w ? nb.w / ob.w : 1, sy = ob.h ? nb.h / ob.h : 1;
  const mx = (x) => nb.x + (x - ob.x) * sx, my = (y) => nb.y + (y - ob.y) * sy;
  if (s.type === 'pen') s.points = snap.points.map(([x, y]) => [mx(x), my(y)]);
  else { s.x1 = mx(snap.x1); s.y1 = my(snap.y1); s.x2 = mx(snap.x2); s.y2 = my(snap.y2); }
  return s;
}

// ---------- Rendu ----------
export function renderShapes(ctx, img, shapes, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const sx = img.naturalWidth / w;
  const sy = img.naturalHeight / h;
  for (const s of shapes) {
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.type === 'pen') {
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (s.points.length === 1) ctx.lineTo(s.points[0][0] + 0.1, s.points[0][1]);
      ctx.stroke();
    } else if (s.type === 'arrow') {
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const head = Math.max(s.width * 4, 18);
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.moveTo(s.x2 - head * Math.cos(ang - 0.5), s.y2 - head * Math.sin(ang - 0.5));
      ctx.lineTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - head * Math.cos(ang + 0.5), s.y2 - head * Math.sin(ang + 0.5));
      ctx.stroke();
    } else if (s.type === 'rect') {
      ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
    } else if (s.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Math.abs(s.x2 - s.x1) / 2 || 1, Math.abs(s.y2 - s.y1) / 2 || 1, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.type === 'text') {
      ctx.font = textFont(s);
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, s.size / 7);
      ctx.strokeStyle = isLight(s.color) ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.85)';
      s.text.split('\n').forEach((line, i) => {
        ctx.strokeText(line, s.x, s.y + i * s.size * 1.2);
        ctx.fillText(line, s.x, s.y + i * s.size * 1.2);
      });
    } else if (s.type === 'blur') {
      const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
      const rw = Math.abs(s.x2 - s.x1), rh = Math.abs(s.y2 - s.y1);
      if (rw > 2 && rh > 2) {
        const block = Math.max(8, Math.round(Math.max(w, h) / 70));
        const tw = Math.max(1, Math.round(rw / block)), th = Math.max(1, Math.round(rh / block));
        const tmp = document.createElement('canvas');
        tmp.width = tw; tmp.height = th;
        tmp.getContext('2d').drawImage(img, x * sx, y * sy, rw * sx, rh * sy, 0, 0, tw, th);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, tw, th, x, y, rw, rh);
      }
    }
    ctx.restore();
  }
}

function fitSize(img) {
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  return { w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k) };
}

// ---------- Éditeur ----------
export async function openAnnotator(original, initialShapes = [], initialCrop = null) {
  const img = await loadImage(original);
  const { w, h } = fitSize(img);
  const base = Math.max(w, h) / 220;
  let shapes = clone(initialShapes);
  // Recadrage : rectangle gardé, en coordonnées de l'image entière (null = toute l'image).
  let crop = initialCrop ? clone(initialCrop) : null;
  const undoStack = [];
  const redoStack = [];
  let tapHit = null;
  let tool = 'arrow', color = COLORS[0].c, widthK = 1;
  let draft = null, selected = null, drag = null;

  const root = document.createElement('div');
  root.className = 'annot';
  root.innerHTML = `
    <div class="annot-top">
      <button class="annot-btn" data-act="cancel">Annuler</button>
      <div class="annot-mid">
        <button class="annot-btn icon" data-act="undo" aria-label="Annuler la dernière action">${svg(ICONS.undo)}</button>
        <button class="annot-btn icon" data-act="redo" aria-label="Rétablir">${svg(ICONS.redo)}</button>
        <button class="annot-btn icon danger" data-act="delete" aria-label="Supprimer l'annotation sélectionnée" hidden>${svg(ICONS.trash)}</button>
      </div>
      <button class="annot-btn primary" data-act="save">Enregistrer</button>
    </div>
    <div class="annot-stage"><canvas></canvas></div>
    <div class="annot-tools">
      <div class="annot-row" role="group" aria-label="Outils">
        ${TOOLS.map(([id, label]) => `<button class="annot-tool" data-tool="${id}" aria-label="${label}">${svg(ICONS[id])}<span>${label}</span></button>`).join('')}
      </div>
      <div class="annot-row">
        <div class="annot-colors" role="group" aria-label="Couleur">
          ${COLORS.map((x) => `<button class="annot-color" data-color="${x.c}" style="--c:${x.c}" aria-label="${x.name}${x.prio ? ` (importance ${x.prio})` : ''}">${x.prio ? `<em>${x.prio[0].toUpperCase()}</em>` : ''}</button>`).join('')}
        </div>
        <div class="annot-widths" role="group" aria-label="Épaisseur">
          ${WIDTHS.map((x) => `<button class="annot-width" data-k="${x.k}" aria-label="${x.label}"><i style="--k:${x.k}"></i></button>`).join('')}
        </div>
      </div>
      <p class="annot-hint"></p>
    </div>
    <form class="annot-text" hidden>
      <textarea rows="2" placeholder="Ton texte"></textarea>
      <div class="annot-text-actions"><button type="button" class="annot-btn" data-act="text-cancel">Annuler</button><button class="annot-btn primary">Valider</button></div>
    </form>`;
  document.body.appendChild(root);
  document.body.classList.add('no-scroll');

  const canvas = root.querySelector('canvas');
  const stage = root.querySelector('.annot-stage');
  const hint = root.querySelector('.annot-hint');
  const ctx = canvas.getContext('2d');
  // Partie de l'image affichée : tout en mode Recadrer, sinon le cadre gardé.
  const full = { x: 0, y: 0, w, h };
  const view = () => (tool === 'crop' || !crop ? full : crop);
  const scale = () => canvas.getBoundingClientRect().width / view().w || 1;
  const fit = () => {
    const v = view();
    if (canvas.width !== Math.round(v.w) || canvas.height !== Math.round(v.h)) {
      canvas.width = Math.round(v.w); canvas.height = Math.round(v.h);
    }
    const r = stage.getBoundingClientRect();
    const k = Math.min(r.width / v.w, r.height / v.h);
    canvas.style.width = `${v.w * k}px`;
    canvas.style.height = `${v.h * k}px`;
  };
  const cropHandles = (c) => [
    { id: 'nw', x: c.x, y: c.y }, { id: 'ne', x: c.x + c.w, y: c.y },
    { id: 'sw', x: c.x, y: c.y + c.h }, { id: 'se', x: c.x + c.w, y: c.y + c.h },
  ];
  const drawCrop = () => {
    const c = crop || full, k = scale();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = 'rgba(0, 0, 0, .58)';
    ctx.fill('evenodd');
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 / k;
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    for (const hd of cropHandles(c)) {
      ctx.beginPath(); ctx.arc(hd.x, hd.y, 10 / k, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
    }
    ctx.restore();
  };
  const drawSelection = () => {
    const s = shapes[selected];
    if (!s) return;
    const k = scale();
    const pad = (s.width || 0) / 2 + 6 / k;
    ctx.save();
    ctx.lineWidth = 2 / k;
    if (s.type !== 'arrow') {
      const b = bbox(ctx, s);
      ctx.setLineDash([6 / k, 5 / k]);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.strokeStyle = '#ffb547';
      ctx.lineDashOffset = 5 / k;
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.setLineDash([]);
    }
    for (const hd of handles(ctx, s)) {
      ctx.beginPath();
      ctx.arc(hd.x, hd.y, 9 / k, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 3 / k; ctx.stroke();
    }
    ctx.restore();
  };
  const redraw = () => {
    const v = view();
    ctx.setTransform(1, 0, 0, 1, -v.x, -v.y);
    renderShapes(ctx, img, draft ? [...shapes, draft] : shapes, w, h);
    if (tool === 'crop') drawCrop(); else drawSelection();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };
  const syncUI = () => {
    const sel = shapes[selected];
    const shownColor = sel ? sel.color : color;
    root.querySelectorAll('.annot-tool').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === tool));
    root.querySelectorAll('.annot-color').forEach((b) => b.setAttribute('aria-pressed', b.dataset.color === shownColor));
    root.querySelectorAll('.annot-width').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.k) === (sel?.k ?? widthK)));
    root.querySelector('[data-act="undo"]').disabled = !undoStack.length;
    root.querySelector('[data-act="redo"]').disabled = !redoStack.length;
    root.querySelector('[data-act="delete"]').hidden = tool === 'crop' ? !crop : !sel;
    hint.textContent = tool === 'crop'
      ? 'Trace le cadre à garder, tire les ronds blancs pour l\'ajuster. La corbeille enlève le recadrage.'
      : tool === 'move'
        ? (sel ? 'Glisse pour déplacer, tire un rond blanc pour changer la taille. Touche une couleur pour la changer.' : 'Touche une annotation pour la sélectionner.')
        : 'Rouge = importance haute · Orange = moyenne · Vert = basse';
  };
  const state = () => clone({ shapes, crop });
  const restore = (st) => { shapes = st.shapes; crop = st.crop; };
  const commit = () => { undoStack.push(state()); redoStack.length = 0; };
  const pos = (e) => {
    const r = canvas.getBoundingClientRect(), v = view();
    return [v.x + ((e.clientX - r.left) / r.width) * v.w, v.y + ((e.clientY - r.top) / r.height) * v.h];
  };
  const clampCrop = (c) => {
    const x = Math.max(0, Math.min(c.x, w)), y = Math.max(0, Math.min(c.y, h));
    return { x, y, w: Math.min(c.w, w - x), h: Math.min(c.h, h - y) };
  };
  const rectFrom = (a, b) => clampCrop({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) });
  const select = (i) => { selected = i; redraw(); syncUI(); };

  fit(); redraw(); syncUI();
  const onResize = () => { fit(); redraw(); };
  window.addEventListener('resize', onResize);

  // Texte : ajout ou modification
  const textForm = root.querySelector('.annot-text');
  const textArea = textForm.querySelector('textarea');
  let textAt = null, textEdit = null;
  const askText = (p, editIndex = null) => {
    textAt = p; textEdit = editIndex;
    textForm.hidden = false;
    textArea.value = editIndex != null ? shapes[editIndex].text : '';
    textArea.focus();
  };
  textForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = textArea.value.trim();
    if (textEdit != null) {
      commit();
      if (text) shapes[textEdit].text = text;
      else { shapes.splice(textEdit, 1); selected = null; }
    } else if (text && textAt) {
      commit();
      shapes.push({ type: 'text', x: textAt[0], y: textAt[1], text, color, size: Math.round(base * 7 * widthK), k: widthK });
    }
    textForm.hidden = true; textAt = null; textEdit = null; redraw(); syncUI();
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (!textForm.hidden) return;
    e.preventDefault();
    const p = pos(e);
    const tol = 14 / scale();
    if (tool === 'crop') {
      const c = crop || full;
      const hd = cropHandles(c).find((x) => Math.hypot(x.x - p[0], x.y - p[1]) < tol * 1.6);
      const inside = crop && p[0] > c.x && p[0] < c.x + c.w && p[1] > c.y && p[1] < c.y + c.h;
      drag = { mode: hd ? `crop-${hd.id}` : inside ? 'crop-move' : 'crop-new', start: p, snapCrop: clone(c), before: state(), changed: false };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const sel = shapes[selected];
    let found = null;
    for (let i = shapes.length - 1; i >= 0; i--) if (hit(ctx, shapes[i], p, tol)) { found = i; break; }
    // Une annotation déjà sélectionnée se déplace ou se redimensionne quel que soit l'outil.
    const hd = sel && handles(ctx, sel).find((x) => Math.hypot(x.x - p[0], x.y - p[1]) < tol * 1.4);
    if (hd) {
      drag = { mode: hd.id, start: p, snap: clone(sel), before: state(), changed: false };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'move' || (sel && found === selected)) {
      const wasSelected = found != null && found === selected;
      select(found);
      if (found != null) {
        drag = { mode: 'move', start: p, snap: clone(shapes[found]), before: state(), changed: false, wasSelected };
        canvas.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (selected != null) select(null);
    if (tool === 'text') {
      // Toucher une annotation existante la sélectionne au lieu d'ajouter un texte.
      if (found != null) { tool = 'move'; select(found); return; }
      askText(p);
      return;
    }
    tapHit = found;
    canvas.setPointerCapture(e.pointerId);
    const width = Math.max(2, base * widthK);
    draft = tool === 'pen'
      ? { type: 'pen', color, width, k: widthK, points: [p] }
      : { type: tool, color, width, k: widthK, x1: p[0], y1: p[1], x2: p[0], y2: p[1] };
    redraw();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (drag) {
      const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
      if (!drag.changed && Math.hypot(dx, dy) < 4 / scale()) return;
      drag.changed = true;
      if (drag.mode.startsWith('crop')) {
        const c = drag.snapCrop;
        if (drag.mode === 'crop-new') crop = rectFrom(drag.start, p);
        else if (drag.mode === 'crop-move') {
          crop = { ...c, x: Math.max(0, Math.min(w - c.w, c.x + dx)), y: Math.max(0, Math.min(h - c.h, c.y + dy)) };
        } else {
          const id = drag.mode.slice(5);
          const fixed = [id.includes('w') ? c.x + c.w : c.x, id.includes('n') ? c.y + c.h : c.y];
          crop = rectFrom(fixed, p);
        }
        redraw();
        return;
      }
      shapes[selected] = drag.mode === 'move' ? moved(drag.snap, dx, dy) : resized(ctx, drag.snap, drag.mode, p);
      redraw();
      return;
    }
    if (!draft) return;
    if (draft.type === 'pen') draft.points.push(p);
    else { draft.x2 = p[0]; draft.y2 = p[1]; }
    redraw();
  });

  const end = () => {
    if (drag) {
      // Un cadre trop petit (simple appui) est ignoré.
      if (drag.mode.startsWith('crop') && crop && (crop.w < base * 8 || crop.h < base * 8)) { restore(drag.before); drag.changed = false; }
      if (drag.changed) { undoStack.push(drag.before); redoStack.length = 0; }
      else if (drag.wasSelected && shapes[selected]?.type === 'text') askText(null, selected);
      drag = null; redraw(); syncUI();
      return;
    }
    if (!draft) return;
    const span = draft.type === 'pen'
      ? Math.max(...draft.points.map(([x, y]) => Math.hypot(x - draft.points[0][0], y - draft.points[0][1])))
      : Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1);
    const tiny = span < base * 2;
    // Un simple appui sur une annotation existante la sélectionne pour la modifier.
    if (tiny && tapHit != null) {
      draft = null; tool = 'move'; select(tapHit); tapHit = null;
      return;
    }
    tapHit = null;
    if (!tiny || draft.type === 'pen') { commit(); shapes.push(draft); }
    draft = null; redraw(); syncUI();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  return new Promise((resolve) => {
    let closed = false;
    const finish = (result) => {
      if (closed) return;
      closed = true;
      window.removeEventListener('resize', onResize);
      document.body.classList.remove('no-scroll');
      root.remove();
      resolve(result);
    };
    const save = () => {
      const c = crop || full;
      const out = document.createElement('canvas');
      out.width = Math.round(c.w); out.height = Math.round(c.h);
      const octx = out.getContext('2d');
      octx.setTransform(1, 0, 0, 1, -c.x, -c.y);
      renderShapes(octx, img, shapes, w, h);
      return new Promise((r) => out.toBlob((rendered) => r({ shapes, crop, rendered }), 'image/jpeg', 0.86));
    };
    // Retour du téléphone : on garde ce qui a été dessiné.
    const release = pushOverlay(async () => finish(await save()));
    const close = async (result) => { await release(); finish(result); };

    root.addEventListener('click', async (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      const sel = shapes[selected];
      if (t.dataset.tool) {
        tool = t.dataset.tool;
        if (tool !== 'move') selected = null;
        fit(); redraw(); syncUI();
      } else if (t.dataset.color) {
        color = t.dataset.color;
        if (sel && sel.type !== 'blur') { commit(); sel.color = color; redraw(); }
        syncUI();
      } else if (t.dataset.k) {
        widthK = Number(t.dataset.k);
        if (sel && sel.type !== 'blur') {
          commit();
          if (sel.type === 'text') sel.size = Math.round(base * 7 * widthK);
          else sel.width = Math.max(2, base * widthK);
          sel.k = widthK;
          redraw();
        }
        syncUI();
      } else if (t.dataset.act === 'undo') {
        if (undoStack.length) { redoStack.push(state()); restore(undoStack.pop()); selected = null; fit(); redraw(); syncUI(); }
      } else if (t.dataset.act === 'redo') {
        if (redoStack.length) { undoStack.push(state()); restore(redoStack.pop()); selected = null; fit(); redraw(); syncUI(); }
      } else if (t.dataset.act === 'delete') {
        if (tool === 'crop') { if (crop) { commit(); crop = null; redraw(); syncUI(); } }
        else if (sel) { commit(); shapes.splice(selected, 1); selected = null; redraw(); syncUI(); }
      } else if (t.dataset.act === 'text-cancel') {
        textForm.hidden = true; textAt = null; textEdit = null;
      } else if (t.dataset.act === 'cancel') {
        close(null);
      } else if (t.dataset.act === 'save') {
        t.disabled = true;
        close(await save());
      }
    });
  });
}
