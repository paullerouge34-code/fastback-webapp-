// Éditeur d'annotation plein écran : dessin libre, flèche, rectangle, cercle, texte, flou.
// openAnnotator(originalBlob, shapes) → Promise<{ shapes, rendered } | null>

const MAX_SIDE = 2000;
const COLORS = ['#ff3b30', '#ffcc00', '#2f6bff', '#34c759', '#ffffff', '#111111'];
const WIDTHS = [{ id: 's', label: 'Fin', k: 0.6 }, { id: 'm', label: 'Moyen', k: 1 }, { id: 'l', label: 'Épais', k: 1.8 }];

const ICONS = {
  pen: '<path d="M4 20c3-1 4-3 6-6s4-7 7-9c1.5-1 3 .5 2 2-2 3-6 5-9 7s-5 3-6 6"/>',
  arrow: '<path d="M5 19 19 5M10 5h9v9"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  blur: '<path d="M4 4h4v4H4zM12 4h4v4h-4zM8 8h4v4H8zM16 8h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4zM8 16h4v4H8zM16 16h4v4h-4z"/>',
  undo: '<path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>',
};
const TOOLS = [
  ['pen', 'Dessin'], ['arrow', 'Flèche'], ['rect', 'Rectangle'], ['ellipse', 'Cercle'], ['text', 'Texte'], ['blur', 'Flou'],
];

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}

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
      ctx.font = `700 ${s.size}px system-ui, sans-serif`;
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

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150;
}

export async function renderToBlob(original, shapes) {
  const img = await loadImage(original);
  const { w, h } = fitSize(img);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  renderShapes(c.getContext('2d'), img, shapes, w, h);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
}

function fitSize(img) {
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  return { w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k) };
}

export async function openAnnotator(original, initialShapes = []) {
  const img = await loadImage(original);
  const { w, h } = fitSize(img);
  const base = Math.max(w, h) / 220;
  let shapes = structuredClone(initialShapes);
  let tool = 'arrow', color = COLORS[0], widthK = 1, draft = null;

  const root = document.createElement('div');
  root.className = 'annot';
  root.innerHTML = `
    <div class="annot-top">
      <button class="annot-btn" data-act="cancel">Annuler</button>
      <button class="annot-btn icon" data-act="undo" aria-label="Annuler le dernier trait">${svg(ICONS.undo)}</button>
      <button class="annot-btn primary" data-act="save">Enregistrer</button>
    </div>
    <div class="annot-stage"><canvas></canvas></div>
    <div class="annot-tools">
      <div class="annot-row" role="group" aria-label="Outils">
        ${TOOLS.map(([id, label]) => `<button class="annot-tool" data-tool="${id}" aria-label="${label}" title="${label}">${svg(ICONS[id])}<span>${label}</span></button>`).join('')}
      </div>
      <div class="annot-row">
        <div class="annot-colors" role="group" aria-label="Couleur">
          ${COLORS.map((c) => `<button class="annot-color" data-color="${c}" style="--c:${c}" aria-label="Couleur ${c}"></button>`).join('')}
        </div>
        <div class="annot-widths" role="group" aria-label="Épaisseur">
          ${WIDTHS.map((x) => `<button class="annot-width" data-k="${x.k}" aria-label="${x.label}"><i style="--k:${x.k}"></i></button>`).join('')}
        </div>
      </div>
    </div>
    <form class="annot-text" hidden>
      <textarea rows="2" placeholder="Ton texte"></textarea>
      <div class="annot-text-actions"><button type="button" class="annot-btn" data-act="text-cancel">Annuler</button><button class="annot-btn primary">Ajouter</button></div>
    </form>`;
  document.body.appendChild(root);
  document.body.classList.add('no-scroll');

  const canvas = root.querySelector('canvas');
  const stage = root.querySelector('.annot-stage');
  const ctx = canvas.getContext('2d');
  canvas.width = w; canvas.height = h;

  const fit = () => {
    const r = stage.getBoundingClientRect();
    const k = Math.min(r.width / w, r.height / h);
    canvas.style.width = `${w * k}px`;
    canvas.style.height = `${h * k}px`;
  };
  const redraw = () => renderShapes(ctx, img, draft ? [...shapes, draft] : shapes, w, h);
  const syncUI = () => {
    root.querySelectorAll('.annot-tool').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === tool));
    root.querySelectorAll('.annot-color').forEach((b) => b.setAttribute('aria-pressed', b.dataset.color === color));
    root.querySelectorAll('.annot-width').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.k) === widthK));
    root.querySelector('[data-act="undo"]').disabled = !shapes.length;
  };
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h];
  };

  fit(); redraw(); syncUI();
  const onResize = () => fit();
  window.addEventListener('resize', onResize);

  // Texte
  const textForm = root.querySelector('.annot-text');
  const textArea = textForm.querySelector('textarea');
  let textAt = null;
  const askText = (p) => { textAt = p; textForm.hidden = false; textArea.value = ''; textArea.focus(); };
  textForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = textArea.value.trim();
    if (text && textAt) {
      shapes.push({ type: 'text', x: textAt[0], y: textAt[1], text, color, size: Math.round(base * 7 * widthK) });
    }
    textForm.hidden = true; textAt = null; redraw(); syncUI();
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (!textForm.hidden) return;
    e.preventDefault();
    const p = pos(e);
    if (tool === 'text') { askText(p); return; }
    canvas.setPointerCapture(e.pointerId);
    const width = Math.max(2, base * widthK);
    draft = tool === 'pen'
      ? { type: 'pen', color, width, points: [p] }
      : { type: tool, color, width, x1: p[0], y1: p[1], x2: p[0], y2: p[1] };
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!draft) return;
    const p = pos(e);
    if (draft.type === 'pen') draft.points.push(p);
    else { draft.x2 = p[0]; draft.y2 = p[1]; }
    redraw();
  });
  const end = () => {
    if (!draft) return;
    const tiny = draft.type !== 'pen' && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) < base * 2;
    if (!tiny) shapes.push(draft);
    draft = null; redraw(); syncUI();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  return new Promise((resolve) => {
    const close = (result) => {
      window.removeEventListener('resize', onResize);
      document.body.classList.remove('no-scroll');
      root.remove();
      resolve(result);
    };
    root.addEventListener('click', async (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.tool) { tool = t.dataset.tool; syncUI(); }
      else if (t.dataset.color) { color = t.dataset.color; syncUI(); }
      else if (t.dataset.k) { widthK = Number(t.dataset.k); syncUI(); }
      else if (t.dataset.act === 'undo') { shapes.pop(); redraw(); syncUI(); }
      else if (t.dataset.act === 'text-cancel') { textForm.hidden = true; textAt = null; }
      else if (t.dataset.act === 'cancel') close(null);
      else if (t.dataset.act === 'save') {
        t.disabled = true;
        renderShapes(ctx, img, shapes, w, h);
        canvas.toBlob((rendered) => close({ shapes, rendered }), 'image/jpeg', 0.86);
      }
    });
  });
}
