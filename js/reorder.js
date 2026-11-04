// Appui long sur une carte : on la soulève, on la glisse pour changer l'ordre,
// ou on la lâche sur la corbeille pour la supprimer.
// Un appui long sans bouger appelle onHold (menu rapide).
const LONG_PRESS = 420;
const MOVE_CANCEL = 10;

export function enableReorder(list, { onReorder, onDelete, onHold }) {
  let press = null; // { x, y, card, timer }
  let drag = null;  // { card, ph, offsetY, lastY, moved, trash, raf, startIds }
  let suppressClick = false;

  const items = () => [...list.querySelectorAll(':scope > [data-id]')];

  list.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-id]')) e.preventDefault(); });
  list.addEventListener('click', (e) => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; }
  }, true);

  const onTouchMove = (e) => { if (drag) e.preventDefault(); };

  list.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('[data-id]');
    if (!card || e.button > 0 || drag) return;
    press = { x: e.clientX, y: e.clientY, card, timer: setTimeout(() => begin(), LONG_PRESS) };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
  });

  function begin() {
    const { card, y } = press;
    press.timer = null;
    navigator.vibrate?.(12);
    suppressClick = true;
    const r = card.getBoundingClientRect();
    const ph = document.createElement('div');
    ph.className = 'drag-placeholder';
    ph.style.height = `${r.height}px`;
    card.before(ph);
    card.classList.add('lifted');
    Object.assign(card.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` });
    const trash = document.createElement('div');
    trash.className = 'drag-trash';
    trash.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg><span>Lâche ici pour supprimer</span>';
    document.body.appendChild(trash);
    drag = { card, ph, offsetY: y - r.top, lastY: y, moved: false, trash, startIds: items().map((c) => c.dataset.id) };
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function overTrash(y) {
    return y > drag.trash.getBoundingClientRect().top;
  }

  function place(y) {
    drag.card.style.top = `${y - drag.offsetY}px`;
    const isOver = overTrash(y);
    drag.trash.classList.toggle('over', isOver);
    drag.card.classList.toggle('to-delete', isOver);
    if (isOver) return;
    const others = items().filter((c) => c !== drag.card);
    const next = others.find((c) => { const b = c.getBoundingClientRect(); return y < b.top + b.height / 2; });
    if (next) { if (drag.ph.nextElementSibling !== next) next.before(drag.ph); }
    else if (others.length) others[others.length - 1].after(drag.ph);
  }

  function autoScroll() {
    if (!drag) return;
    const y = drag.lastY;
    const bottomLimit = drag.trash.getBoundingClientRect().top - 40;
    if (y < 90) window.scrollBy(0, -8);
    else if (y > bottomLimit && y < bottomLimit + 40) window.scrollBy(0, 8);
    place(y);
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function onMove(e) {
    if (drag) {
      e.preventDefault();
      if (Math.abs(e.clientY - drag.lastY) > 2) drag.moved = true;
      drag.lastY = e.clientY;
      place(e.clientY);
      return;
    }
    if (press?.timer && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_CANCEL) cleanup();
  }

  function onUp(e) {
    if (!drag) return cleanup();
    const { card, moved, startIds } = drag;
    const id = card.dataset.id;
    const deleting = overTrash(e.clientY);
    restore();
    cleanup();
    if (deleting) { card.remove(); onDelete(id); return; }
    const ids = items().map((c) => c.dataset.id);
    if (ids.join() !== startIds.join()) onReorder(ids);
    else if (!moved) onHold?.(id);
  }

  function onCancel() {
    if (drag) restore();
    cleanup();
  }

  function restore() {
    const { card, ph, trash } = drag;
    cancelAnimationFrame(drag.raf);
    ph.replaceWith(card);
    card.classList.remove('lifted', 'to-delete');
    card.style.position = card.style.left = card.style.top = card.style.width = '';
    trash.remove();
  }

  function cleanup() {
    if (press?.timer) clearTimeout(press.timer);
    press = null;
    drag = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('touchmove', onTouchMove);
    // Laisse passer le clic « fantôme » éventuel après un glisser, puis réactive les clics.
    setTimeout(() => { suppressClick = false; }, 350);
  }
}
