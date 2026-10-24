// The whiteboard: an infinite, pannable, zoomable canvas of list cards and sticky notes.
import { store, uid, findCard, findItem, COLORS } from './store.js';
import { parseQuickAdd } from './parse.js';
import { h, svg, ICONS, fmtDue, fmtEst, fmtTime, menu, toast } from './ui.js';
import { toggleItem, openDetails, moveItem, startFocus, scheduleNext, addParsed } from './actions.js';
import * as fx from './motion.js';

const board = document.getElementById('board');
const world = document.getElementById('world');
const linksSvg = document.getElementById('links');
const glow = document.getElementById('board-glow');
const GRID = 10;
const MIN_Z = 0.25;
const MAX_Z = 2;

let view = { x: 0, y: 0, zoom: 1 };
let filter = '';
let connectingFrom = null;
let space = false;
export let dragItemId = null;
let lastListId = null;
const cardEls = new Map();

export const getLastListId = () => lastListId;

// ---------- View ----------

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  const g = 22 * view.zoom;
  board.style.backgroundSize = glow.style.backgroundSize = `${g}px ${g}px`;
  board.style.backgroundPosition = glow.style.backgroundPosition = `${view.x}px ${view.y}px`;
  document.getElementById('zoom-level').textContent = `${Math.round(view.zoom * 100)}%`;
}

// Glides the camera to a target view. Any wheel/drag cancels it.
let cancelGlide = () => {};
function glideTo(target, duration = 650) {
  cancelGlide();
  const from = { ...view };
  // Interpolate the zoom in log space and keep the screen-space motion of the target consistent.
  cancelGlide = fx.tween(duration, (t) => {
    const z = from.zoom * Math.pow(target.zoom / from.zoom, t);
    view = { zoom: z, x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t };
    applyView();
  }, { onDone: saveView });
}

let viewSaveTimer = null;
function saveView() {
  clearTimeout(viewSaveTimer);
  viewSaveTimer = setTimeout(() => store.update((s) => (s.view = { ...view }), { undoable: false, quiet: true }), 400);
}

function zoomAt(factor, cx, cy) {
  const r = board.getBoundingClientRect();
  const px = cx - r.left;
  const py = cy - r.top;
  const z = Math.min(MAX_Z, Math.max(MIN_Z, view.zoom * factor));
  view.x = px - ((px - view.x) * z) / view.zoom;
  view.y = py - ((py - view.y) * z) / view.zoom;
  view.zoom = z;
  applyView();
  saveView();
}

/** Animated zoom around the center of the board. */
export function zoomBy(f) {
  const r = board.getBoundingClientRect();
  const z = Math.min(MAX_Z, Math.max(MIN_Z, view.zoom * f));
  const px = r.width / 2;
  const py = r.height / 2;
  glideTo({ zoom: z, x: px - ((px - view.x) * z) / view.zoom, y: py - ((py - view.y) * z) / view.zoom }, 420);
}

export function resetZoom() {
  zoomBy(1 / view.zoom);
}

export function fit(instant = false) {
  const cs = store.state.cards;
  if (!cs.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cs) {
    const el = cardEls.get(c.id);
    x0 = Math.min(x0, c.x);
    y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x + (el?.offsetWidth || c.w || 300));
    y1 = Math.max(y1, c.y + (el?.offsetHeight || c.h || 200));
  }
  const r = board.getBoundingClientRect();
  const pad = 48;
  const z = Math.min(1.1, Math.max(MIN_Z, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
  const target = { zoom: z, x: (r.width - (x1 - x0) * z) / 2 - x0 * z, y: (r.height - (y1 - y0) * z) / 2 - y0 * z };
  if (instant) {
    view = target;
    applyView();
    saveView();
  } else glideTo(target, 800);
}

/** Glides so a card is centered (used by search and quick add). Resolves when it arrives. */
export function reveal(cardId, { pulse = true } = {}) {
  const c = findCard(store.state, cardId);
  const el = cardEls.get(cardId);
  if (!c || !el) return Promise.resolve();
  const r = board.getBoundingClientRect();
  const target = { zoom: view.zoom, x: r.width / 2 - (c.x + el.offsetWidth / 2) * view.zoom, y: r.height / 2 - (c.y + Math.min(el.offsetHeight, 300) / 2) * view.zoom };
  const far = Math.hypot(target.x - view.x, target.y - view.y);
  return new Promise((resolve) => {
    const done = () => {
      if (pulse) cardEls.get(cardId)?.classList.add('pulse');
      setTimeout(() => cardEls.get(cardId)?.classList.remove('pulse'), 1200);
      resolve();
    };
    if (far < 4) return done();
    glideTo(target, Math.min(900, 380 + far * 0.4));
    setTimeout(done, fx.reduced() ? 0 : Math.min(900, 380 + far * 0.4));
  });
}

/** True when most of a card is on screen. */
export function isVisible(cardId) {
  const el = cardEls.get(cardId);
  if (!el) return false;
  const a = el.getBoundingClientRect();
  const b = board.getBoundingClientRect();
  return a.left >= b.left - 20 && a.right <= b.right + 20 && a.top >= b.top - 20 && a.top < b.bottom - 80;
}

/** Screen point -> world point. */
function toWorld(cx, cy) {
  const r = board.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.zoom, y: (cy - r.top - view.y) / view.zoom };
}

/** World point at the center of the visible board. */
export function viewCenter() {
  const r = board.getBoundingClientRect();
  return toWorld(r.left + r.width / 2, r.top + r.height / 2);
}

// ---------- Creating cards ----------

export function addList(at, { edit = true } = {}) {
  const p = at || viewCenter();
  const n = store.state.cards.filter((c) => c.kind === 'list').length;
  const card = { id: uid(), kind: 'list', title: 'New list', color: COLORS[n % COLORS.length], x: snap(p.x - 150), y: snap(p.y - 40), w: 300, h: 0, items: [] };
  store.update((s) => s.cards.push(card));
  if (edit) requestAnimationFrame(() => editTitle(card.id, true));
  return card;
}

export function addNote(at) {
  const p = at || viewCenter();
  const card = { id: uid(), kind: 'note', text: '', color: COLORS[5], x: snap(p.x - 120), y: snap(p.y - 60), w: 240, h: 150 };
  store.update((s) => s.cards.push(card));
  requestAnimationFrame(() => cardEls.get(card.id)?.querySelector('textarea')?.focus());
}

const snap = (v) => Math.round(v / GRID) * GRID;

// ---------- Rendering ----------

let rendered = false;
const progress = new Map(); // list id -> last completion ratio
const knownLinks = new Set();

export function render() {
  const s = store.state;
  // Keep focus/caret in an input across re-renders (typing in "Add item", for instance).
  const ae = document.activeElement;
  const keep = ae && world.contains(ae) && ae.dataset.keep ? { key: ae.dataset.keep, value: ae.value, start: ae.selectionStart } : null;

  const animate = rendered && !fx.reduced();
  const oldItems = animate ? fx.snapshot(world, '.item[data-item]', 'data-item') : null;
  const oldCards = animate ? fx.snapshot(world, '.card[data-id]', 'data-id') : null;

  paint(s);

  if (keep) {
    const el = world.querySelector(`[data-keep="${keep.key}"]`);
    if (el) {
      el.value = keep.value;
      el.focus();
      try { el.setSelectionRange(keep.start, keep.start); } catch {}
    }
  }

  if (!rendered) entrance();
  else if (animate) animateChanges(oldItems, oldCards);
  animateProgress();
  playQueued();
  rendered = true;
}

function paint(s) {
  const seen = new Set();
  for (const c of s.cards) {
    seen.add(c.id);
    const el = c.kind === 'note' ? renderNote(c) : renderList(c);
    const old = cardEls.get(c.id);
    if (old) old.replaceWith(el);
    else world.append(el);
    cardEls.set(c.id, el);
  }
  for (const [id, el] of cardEls) if (!seen.has(id)) { el.remove(); cardEls.delete(id); }
  // Paint order follows the array (last = on top).
  for (const c of s.cards) world.append(cardEls.get(c.id));
  drawLinks();
  applyFilter();
}

// ---------- Animations ----------

/** First paint: cards rise in one after another, their items trail behind. */
function entrance() {
  if (fx.reduced()) return;
  const cards = [...cardEls.values()].sort((a, b) => parseFloat(a.style.left) - parseFloat(b.style.left) || parseFloat(a.style.top) - parseFloat(b.style.top));
  cards.forEach((el, i) => {
    const delay = 80 + i * 70;
    fx.play(el, [{ opacity: 0, transform: 'translateY(26px) scale(.94)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { ...fx.SPRING_SOFT, delay, fill: 'backwards' });
    el.querySelectorAll('.item').forEach((it, j) =>
      fx.play(it, [{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: delay + 160 + j * 45, easing: fx.EASE_OUT, fill: 'backwards' }));
    const bar = el.querySelector('.card-progress span');
    if (bar) fx.play(bar, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 900, delay: delay + 200, easing: fx.EASE_OUT, fill: 'backwards' });
  });
  linksSvg.querySelectorAll('path.link').forEach((p) => drawOn(p, 600));
  fx.play(board, [{ backgroundColor: 'var(--bg)', opacity: 0.6 }, { opacity: 1 }], { duration: 700 });
}

/**
 * Every change re-renders the board, so animations are FLIP-style: compare where keyed elements
 * were with where they are now, then play the difference.
 */
function animateChanges(oldItems, oldCards) {
  const z = view.zoom;
  const newCards = new Map([...world.querySelectorAll('.card[data-id]')].map((el) => [el.dataset.id, el]));
  const newItems = new Map([...world.querySelectorAll('.item[data-item]')].map((el) => [el.dataset.item, el]));

  // 1. Space for removed items collapses; new items grow in. Done first so they shape the layout
  //    the remaining items are measured against.
  let enterIndex = 0;
  for (const [id, info] of oldItems) {
    if (newItems.has(id)) continue;
    const body = newCards.get(info.group)?.querySelector('.card-body');
    if (body) fx.collapseSpace(body, info.next ? body.querySelector(`[data-item="${info.next}"]`) : body.querySelector('.drop-line'), info.rect.height / z);
    fx.exit(info, { scale: z, to: 'translateX(24px)' });
  }
  for (const [id, el] of newItems) {
    if (oldItems.has(id)) continue;
    fx.growIn(el, { delay: enterIndex++ * 50 });
  }
  // Items that moved to another list leave a gap in the old one: close it smoothly.
  for (const [id, info] of oldItems) {
    const el = newItems.get(id);
    if (!el || el.closest('.card')?.dataset.id === info.group) continue;
    const body = newCards.get(info.group)?.querySelector('.card-body');
    if (body) fx.collapseSpace(body, info.next ? body.querySelector(`[data-item="${info.next}"]`) : null, info.rect.height / z);
  }

  // 2. Measure everything, then animate (so early animations don't skew later measurements).
  const cardMoves = [];
  for (const [id, el] of newCards) {
    const old = oldCards.get(id);
    if (!old) continue;
    const r = el.getBoundingClientRect();
    cardMoves.push([el, old.rect.left - r.left, old.rect.top - r.top]);
  }
  const itemMoves = [];
  const flights = [];
  for (const [id, el] of newItems) {
    const old = oldItems.get(id);
    if (!old) continue;
    const card = el.closest('.card');
    if (card.dataset.id !== old.group) {
      flights.push([old, el]);
      continue;
    }
    const r = el.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    // Relative to the card, so a card moving doesn't double-move its items.
    itemMoves.push([el, (old.rect.left - old.groupRect.left) - (r.left - cr.left), (old.rect.top - old.groupRect.top) - (r.top - cr.top)]);
  }

  for (const [el, dx, dy] of cardMoves) fx.flipFrom(el, dx, dy, { scale: z, timing: fx.SPRING_SOFT });
  for (const [el, dx, dy] of itemMoves) fx.flipFrom(el, dx, dy, { scale: z, timing: fx.SPRING });
  for (const [old, el] of flights) fx.fly(old, el, { scale: z });

  for (const [id, el] of newCards) {
    if (oldCards.has(id)) continue;
    fx.popIn(el, { from: 0.8 });
    const r = el.getBoundingClientRect();
    fx.ripple(r.left + r.width / 2, r.top + 30, el.style.getPropertyValue('--c'), 260);
  }
  for (const [id, info] of oldCards) {
    if (newCards.has(id)) continue;
    fx.exit(info, { scale: z, to: 'translateY(30px) rotate(-6deg)', duration: 420 });
  }
}

function animateProgress() {
  for (const c of store.state.cards) {
    if (c.kind !== 'list') continue;
    const total = c.items.length;
    const ratio = total ? c.items.filter((i) => i.done).length / total : 0;
    const prev = progress.get(c.id);
    progress.set(c.id, ratio);
    if (prev === undefined || prev === ratio || !rendered) continue;
    const el = cardEls.get(c.id);
    const bar = el?.querySelector('.card-progress span');
    if (!bar) continue;
    bar.style.width = `${prev * 100}%`;
    bar.getBoundingClientRect();
    bar.style.width = `${ratio * 100}%`;
    if (ratio > prev) bar.classList.add('shine');
    if (ratio === 1 && prev < 1 && total > 1) {
      fx.celebrate(el.getBoundingClientRect(), c.color);
      el.classList.add('complete');
      setTimeout(() => el.classList.remove('complete'), 1600);
    }
  }
}

/** Effects queued by actions (checking an item, settling a dragged card). */
function playQueued() {
  for (const key of fx.pendingKeys()) {
    const [kind, id] = key.split(':');
    if (kind === 'item') {
      const el = world.querySelector(`[data-item="${id}"]`);
      if (!el) continue;
      const e = fx.take(key);
      if (e.type === 'check') {
        el.classList.add('just-done');
        const cb = el.querySelector('.check').getBoundingClientRect();
        const color = el.closest('.card').style.getPropertyValue('--c');
        if (!e.burstDone) {
          fx.confetti(cb.left + cb.width / 2, cb.top + cb.height / 2, { count: 16, power: 4.5, colors: [color, color, '#ffffff'], size: 4, gravity: 0.16 });
          fx.ripple(cb.left + cb.width / 2, cb.top + cb.height / 2, color, 46);
        }
      } else if (e.type === 'uncheck') el.classList.add('just-undone');
      else if (e.type === 'land') fx.flash(el, el.closest('.card').style.getPropertyValue('--c'));
    } else if (kind === 'card') {
      const el = cardEls.get(id);
      if (!el) continue;
      const e = fx.take(key);
      if (e.type === 'settle') {
        fx.play(el, [{ rotate: `${e.rot}deg`, scale: '1.035' }, { rotate: '0deg', scale: '1' }], fx.SPRING_BOUNCY);
        const r = el.getBoundingClientRect();
        fx.ripple(r.left + r.width / 2, r.top + r.height / 2, el.style.getPropertyValue('--c'), Math.max(r.width, r.height) * 1.3);
      }
    }
  }
}

function drawOn(path, delay = 0) {
  const len = path.getTotalLength?.() || 0;
  if (!len) return;
  fx.play(path, [{ strokeDasharray: `${len}`, strokeDashoffset: `${len}` }, { strokeDasharray: `${len}`, strokeDashoffset: '0' }], { duration: 700, delay, easing: fx.EASE_OUT, fill: 'backwards' });
}

function cardShell(c, extraClass, children) {
  const el = h(`div.card${extraClass}`, {
    dataset: { id: c.id },
    style: { left: c.x + 'px', top: c.y + 'px', width: (c.w || 300) + 'px', '--c': c.color, ...(c.h ? { height: c.h + 'px' } : {}) },
  }, children, h('div.resize', { title: 'Resize' }));
  if (connectingFrom && connectingFrom !== c.id) el.classList.add('connect-target');
  return el;
}

function renderList(c) {
  const total = c.items.length;
  const done = c.items.filter((i) => i.done).length;
  const body = h('div.card-body', { dataset: { list: c.id, flipGroup: c.id }, style: c.h ? {} : { maxHeight: '560px' } },
    c.items.length ? c.items.map((it) => renderItem(it, c)) : h('div.empty-hint', c.source === 'canvas' ? 'Add your Canvas calendar feed in Settings to fill this list automatically.' : 'Nothing here yet.'),
  );
  return cardShell(c, c.collapsed ? '.collapsed' : '', [
    h('div.card-head', { dataset: { drag: c.id } },
      h('button.swatch', { title: 'Change color', 'aria-label': 'Change color', onclick: (e) => colorMenu(e.currentTarget, c) }),
      h('div.card-title', { ondblclick: () => editTitle(c.id) }, c.title),
      h('span.card-count', total ? `${done}/${total}` : ''),
      h('button.icon-btn', { title: 'List menu', 'aria-label': 'List menu', onclick: (e) => listMenu(e.currentTarget, c) }, svg(ICONS.dots)),
    ),
    h('div.card-progress', h('span', { style: { width: total ? `${(done / total) * 100}%` : '0' } })),
    body,
    h('div.card-foot',
      h('input.add-item', {
        placeholder: '+ Add item   (try “essay fri ~2h”)',
        dataset: { keep: `add-${c.id}` },
        onfocus: () => (lastListId = c.id),
        onkeydown: (e) => {
          if (e.key === 'Escape') return e.target.blur();
          if (e.key !== 'Enter' || !e.target.value.trim()) return;
          const p = parseQuickAdd(e.target.value);
          p.list = null; // typed into this list: stay here
          e.target.value = '';
          addParsed(p, c.id);
        },
      }),
    ),
  ]);
}

function renderItem(it, list) {
  const chips = [];
  const due = fmtDue(it.due, it.hasTime !== false);
  if (due) chips.push(h(`span.chip.${due.status}`, { title: new Date(it.due).toLocaleString() }, due.label));
  const block = store.state.blocks.find((b) => b.itemId === it.id && Date.parse(b.end) > Date.now());
  if (block) chips.push(h('span.chip.block', { title: 'Time blocked' }, svg(ICONS.cal), `${fmtDue(block.start).label.split(' ')[0]} ${fmtTime(new Date(block.start))}`));
  if (it.priority) chips.push(h(`span.chip.p${it.priority}`, { title: ['', 'Low', 'Medium', 'High'][it.priority] + ' priority' }, '!'.repeat(it.priority)));
  if (it.est) chips.push(h('span.chip', { title: 'Estimate' }, `~${fmtEst(it.est)}`));
  if (it.repeat) chips.push(h('span.chip', { title: `Repeats ${it.repeat}` }, '↻ ' + it.repeat));
  if (it.course) chips.push(h('span.chip', it.course));
  if (it.points) chips.push(h('span.chip', `${it.points} pts`));
  if (it.sub?.length) chips.push(h('span.chip', `${it.sub.filter((x) => x.done).length}/${it.sub.length} steps`));
  if (it.url) chips.push(h('a.chip', { href: it.url, target: '_blank', rel: 'noopener noreferrer', title: it.url, onpointerdown: (e) => e.stopPropagation() }, svg(ICONS.link), 'Open'));

  const row = h(`div.item${it.done ? '.done' : ''}`, { draggable: true, dataset: { item: it.id } },
    h('input.check', { type: 'checkbox', checked: it.done, 'aria-label': 'Done', onchange: (e) => toggleItem(it.id, e.currentTarget) }),
    h('div.item-main',
      h('span.item-text', { onclick: (e) => editItemText(e.currentTarget, it.id) }, it.text),
      chips.length ? h('div.chips', chips) : null,
    ),
    h('div.item-actions',
      h('button.icon-btn', { title: 'Focus (25 min)', 'aria-label': 'Start focus timer', onclick: () => startFocus(it.id) }, svg(ICONS.play)),
      h('button.icon-btn', { title: 'Block time today', 'aria-label': 'Block time today', onclick: () => scheduleNext(it.id) }, svg(ICONS.cal)),
      h('button.icon-btn', { title: 'Details', 'aria-label': 'Details', onclick: (e) => openDetails(e.currentTarget, it.id) }, svg(ICONS.dots)),
    ),
  );
  row.addEventListener('dragstart', (e) => {
    if (row.querySelector('[contenteditable="true"]')) return e.preventDefault();
    dragItemId = it.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-planner-item', it.id);
    e.dataTransfer.setData('text/plain', it.text);
    requestAnimationFrame(() => row.classList.add('dragging'));
  });
  row.addEventListener('dragend', () => {
    dragItemId = null;
    row.classList.remove('dragging');
    clearDrop();
  });
  return row;
}

function renderNote(c) {
  return cardShell(c, '.note', [
    h('div.card-head', { dataset: { drag: c.id } },
      h('button.swatch', { title: 'Change color', 'aria-label': 'Change color', onclick: (e) => colorMenu(e.currentTarget, c) }),
      h('div.card-title.faint.small', { style: { fontWeight: 500, fontFamily: 'var(--font-body)' } }, 'Note'),
      h('button.icon-btn', { 'aria-label': 'Note menu', onclick: (e) => menu(e.currentTarget, [
        { label: 'Connect to…', onclick: () => startConnect(c.id) },
        { label: 'Delete note', danger: true, onclick: () => deleteCard(c.id) },
      ]) }, svg(ICONS.dots)),
    ),
    h('textarea', {
      value: c.text,
      placeholder: 'Write anything…',
      dataset: { keep: `note-${c.id}` },
      oninput: (e) => store.update((s) => (findCard(s, c.id).text = e.target.value), { undoable: false, quiet: true }),
    }),
  ]);
}

// ---------- Inline editing ----------

function editTitle(id, selectAll = false) {
  const el = cardEls.get(id)?.querySelector('.card-title');
  if (!el) return;
  el.contentEditable = 'true';
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  if (!selectAll) range.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  const done = (save) => {
    el.contentEditable = 'false';
    el.removeEventListener('keydown', key);
    const t = el.textContent.trim();
    if (save && t) store.update((s) => (findCard(s, id).title = t));
    else store.emit();
  };
  const key = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.textContent = findCard(store.state, id).title; el.blur(); }
  };
  el.addEventListener('keydown', key);
  el.addEventListener('blur', () => done(true), { once: true });
}

function editItemText(el, id) {
  if (el.contentEditable === 'true') return;
  el.contentEditable = 'true';
  el.closest('.item').draggable = false;
  el.focus();
  const original = el.textContent;
  const key = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.textContent = original; el.blur(); }
  };
  el.addEventListener('keydown', key);
  el.addEventListener('blur', () => {
    el.removeEventListener('keydown', key);
    el.contentEditable = 'false';
    const t = el.textContent.trim();
    if (t && t !== original) store.update((s) => (findItem(s, id).item.text = t));
    else store.emit();
  }, { once: true });
}

// ---------- Menus ----------

function colorMenu(anchor, c) {
  menu(anchor, [
    h('div.swatches', COLORS.map((col) => h(`button${col === c.color ? '.on' : ''}`, {
      style: { '--c': col },
      'aria-label': `Color ${col}`,
      onclick: () => { store.update((s) => (findCard(s, c.id).color = col)); document.getElementById('menu').hidden = true; },
    }))),
  ]);
}

function listMenu(anchor, c) {
  const doneCount = c.items.filter((i) => i.done).length;
  menu(anchor, [
    { label: 'Rename', onclick: () => editTitle(c.id, true) },
    { label: c.collapsed ? 'Expand' : 'Collapse', onclick: () => store.update((s) => (findCard(s, c.id).collapsed = !c.collapsed)) },
    { label: 'Sort by due date', onclick: () => store.update((s) => findCard(s, c.id).items.sort((a, b) => (a.done - b.done) || ((a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity)) || (b.priority || 0) - (a.priority || 0))) },
    { label: 'Sort by priority', onclick: () => store.update((s) => findCard(s, c.id).items.sort((a, b) => (a.done - b.done) || (b.priority || 0) - (a.priority || 0))) },
    { label: `Archive completed${doneCount ? ` (${doneCount})` : ''}`, onclick: () => archiveDone(c.id) },
    { label: 'Connect to…', onclick: () => startConnect(c.id) },
    { label: 'Auto-height', onclick: () => store.update((s) => (findCard(s, c.id).h = 0)) },
    'hr',
    { label: 'Delete list', danger: true, onclick: () => deleteCard(c.id) },
  ]);
}

export function archiveDone(id) {
  const c = findCard(store.state, id);
  const n = c.items.filter((i) => i.done).length;
  if (!n) return toast('Nothing completed to archive');
  store.update((s) => {
    const l = findCard(s, id);
    s.archive.unshift(...l.items.filter((i) => i.done).map((i) => ({ ...i, listTitle: l.title, listId: l.id, doneAt: i.doneAt || Date.now() })));
    l.items = l.items.filter((i) => !i.done);
    if (s.archive.length > 1000) s.archive.length = 1000;
  });
  toast(`Archived ${n} item${n > 1 ? 's' : ''}`, { action: 'Undo', onAction: () => store.undoLast() });
}

function deleteCard(id) {
  const c = findCard(store.state, id);
  store.update((s) => {
    s.cards = s.cards.filter((x) => x.id !== id);
    s.links = s.links.filter((l) => l.from !== id && l.to !== id);
  });
  toast(`Deleted ${c.kind === 'note' ? 'note' : `“${c.title}”`}`, { action: 'Undo', onAction: () => store.undoLast() });
}

// ---------- Connectors ----------

function startConnect(id) {
  connectingFrom = id;
  board.classList.add('connecting');
  store.emit();
  toast('Click another card to connect it. Esc to cancel.', { ms: 3000 });
}

function endConnect(toId) {
  const from = connectingFrom;
  connectingFrom = null;
  board.classList.remove('connecting');
  if (toId && toId !== from && !store.state.links.some((l) => l.from === from && l.to === toId)) {
    store.update((s) => s.links.push({ id: uid(), from, to: toId }));
  } else store.emit();
}

function edgePoint(r, tx, ty) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(Math.abs(r.w / 2 / (dx || 1e-9)), Math.abs(r.h / 2 / (dy || 1e-9)));
  return { x: cx + dx * s, y: cy + dy * s };
}

function rectOf(id) {
  const c = findCard(store.state, id);
  const el = cardEls.get(id);
  if (!c || !el) return null;
  return { x: c.x, y: c.y, w: el.offsetWidth, h: el.offsetHeight };
}

function drawLinks() {
  linksSvg.querySelectorAll('g').forEach((g) => g.remove());
  for (const l of store.state.links) {
    const a = rectOf(l.from);
    const b = rectOf(l.to);
    if (!a || !b) continue;
    const p = edgePoint(a, b.x + b.w / 2, b.y + b.h / 2);
    const q = edgePoint(b, a.x + a.w / 2, a.y + a.h / 2);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const d = `M${p.x},${p.y} L${q.x},${q.y}`;
    g.innerHTML = `<path class="link-hit" d="${d}"/><path class="link" d="${d}"/>`;
    g.querySelectorAll('path').forEach((path) => path.addEventListener('click', () => {
      store.update((s) => (s.links = s.links.filter((x) => x.id !== l.id)));
      toast('Connection removed', { action: 'Undo', onAction: () => store.undoLast() });
    }));
    g.querySelector('.link-hit').appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'title')).textContent = 'Click to remove';
    linksSvg.append(g);
    if (!knownLinks.has(l.id)) {
      knownLinks.add(l.id);
      if (rendered) drawOn(g.querySelector('path.link'));
    }
  }
}

// ---------- Search ----------

export function setFilter(q) {
  filter = q.trim().toLowerCase();
  applyFilter();
}

function applyFilter() {
  let first = null;
  for (const c of store.state.cards) {
    const el = cardEls.get(c.id);
    if (!el) continue;
    if (!filter) { el.classList.remove('dim'); el.querySelectorAll('.match').forEach((x) => x.classList.remove('match')); continue; }
    let hit = (c.title || c.text || '').toLowerCase().includes(filter);
    for (const it of c.items || []) {
      const m = `${it.text} ${it.course || ''} ${it.notes || ''}`.toLowerCase().includes(filter);
      el.querySelector(`[data-item="${it.id}"]`)?.classList.toggle('match', m);
      hit ||= m;
    }
    el.classList.toggle('dim', !hit);
    if (hit && !first) first = c.id;
  }
  return first;
}

export function revealFirstMatch() {
  const id = applyFilter();
  if (id) reveal(id);
}

// ---------- Pointer interaction ----------

function startDragCard(e, id, mode) {
  const c = findCard(store.state, id);
  const el = cardEls.get(id);
  const sx = e.clientX;
  const sy = e.clientY;
  const ox = c.x, oy = c.y, ow = el.offsetWidth, oh = el.offsetHeight;
  let moved = false;
  let rot = 0;
  let lastX = e.clientX;
  // Bring to front first: moving the node after setPointerCapture would release the capture.
  if (mode === 'move' && store.state.cards[store.state.cards.length - 1].id !== id) {
    world.append(el);
  }
  // Listen on window so the drag always ends, even if the capture is lost.
  try { el.setPointerCapture(e.pointerId); } catch {}
  const move = (ev) => {
    const dx = (ev.clientX - sx) / view.zoom;
    const dy = (ev.clientY - sy) / view.zoom;
    if (!moved && Math.hypot(dx, dy) < 3) return;
    moved = true;
    if (mode === 'move') {
      el.classList.add('dragging');
      el.style.left = (ev.altKey ? ox + dx : snap(ox + dx)) + 'px';
      el.style.top = (ev.altKey ? oy + dy : snap(oy + dy)) + 'px';
      // Tilt with horizontal speed, like picking up a card by its top edge.
      if (!fx.reduced()) {
        const vx = ev.clientX - lastX;
        lastX = ev.clientX;
        rot += (Math.max(-7, Math.min(7, vx * 0.45)) - rot) * 0.22;
        el.style.rotate = `${rot.toFixed(2)}deg`;
      }
    } else {
      el.style.width = Math.max(220, snap(ow + dx)) + 'px';
      el.style.height = Math.max(c.kind === 'note' ? 100 : 120, snap(oh + dy)) + 'px';
    }
    drawLinksLive(id, el);
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    el.classList.remove('dragging');
    el.style.rotate = '';
    if (!moved) return;
    if (mode === 'move') fx.queue(`card:${id}`, { type: 'settle', rot });
    store.update((s) => {
      const i = s.cards.findIndex((x) => x.id === id);
      const card = s.cards[i];
      if (mode === 'move') {
        card.x = parseFloat(el.style.left);
        card.y = parseFloat(el.style.top);
        s.cards.push(s.cards.splice(i, 1)[0]);
      } else {
        card.w = parseFloat(el.style.width);
        card.h = parseFloat(el.style.height);
      }
    });
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

function drawLinksLive(id, el) {
  if (!store.state.links.some((l) => l.from === id || l.to === id)) return;
  const c = findCard(store.state, id);
  const keep = { x: c.x, y: c.y };
  c.x = parseFloat(el.style.left);
  c.y = parseFloat(el.style.top);
  drawLinks();
  Object.assign(c, keep);
}

function startPan(e) {
  cancelGlide();
  const sx = e.clientX - view.x;
  const sy = e.clientY - view.y;
  board.classList.add('panning');
  board.setPointerCapture(e.pointerId);
  const move = (ev) => {
    view.x = ev.clientX - sx;
    view.y = ev.clientY - sy;
    applyView();
  };
  const up = () => {
    board.classList.remove('panning');
    board.removeEventListener('pointermove', move);
    board.removeEventListener('pointerup', up);
    board.removeEventListener('pointercancel', up);
    saveView();
  };
  board.addEventListener('pointermove', move);
  board.addEventListener('pointerup', up);
  board.addEventListener('pointercancel', up);
}

const isBackground = (t) => t === board || t === world || t === linksSvg || t.classList?.contains('board-hint');

board.addEventListener('pointerdown', (e) => {
  hideHint();
  if (e.button === 1 || (e.button === 0 && (space || isBackground(e.target)))) {
    if (connectingFrom && isBackground(e.target)) return endConnect(null);
    e.preventDefault();
    document.activeElement?.blur?.();
    return startPan(e);
  }
  if (e.button !== 0) return;
  const cardEl = e.target.closest('.card');
  if (!cardEl) return;
  const id = cardEl.dataset.id;
  if (connectingFrom) {
    e.preventDefault();
    return endConnect(id);
  }
  if (e.target.classList.contains('resize')) {
    e.preventDefault();
    return startDragCard(e, id, 'resize');
  }
  const head = e.target.closest('.card-head');
  if (head && !e.target.closest('button') && e.target.contentEditable !== 'true') {
    e.preventDefault();
    startDragCard(e, id, 'move');
  }
});

board.addEventListener('dblclick', (e) => {
  if (!isBackground(e.target)) return;
  fx.ripple(e.clientX, e.clientY, 'var(--accent)', 180);
  addList(toWorld(e.clientX, e.clientY));
});

// Spotlight: the dot grid lights up around the cursor.
let glowFrame = 0;
board.addEventListener('pointermove', (e) => {
  if (glowFrame) return;
  glowFrame = requestAnimationFrame(() => {
    glowFrame = 0;
    const r = board.getBoundingClientRect();
    board.style.setProperty('--mx', `${e.clientX - r.left}px`);
    board.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
  board.classList.add('lit');
});
board.addEventListener('pointerleave', () => board.classList.remove('lit'));

board.addEventListener('wheel', (e) => {
  // Let lists scroll their own items.
  const body = e.target.closest('.card-body, textarea');
  if (body && !e.ctrlKey && !e.metaKey && body.scrollHeight > body.clientHeight) return;
  e.preventDefault();
  hideHint();
  cancelGlide();
  if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01)), e.clientX, e.clientY);
  else {
    view.x -= e.deltaX;
    view.y -= e.deltaY;
    applyView();
    saveView();
  }
}, { passive: false });

addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !isTyping(e.target)) {
    if (!space) board.classList.add('space');
    space = true;
    if (e.target === document.body || e.target === board) e.preventDefault();
  }
  if (e.key === 'Escape' && connectingFrom) endConnect(null);
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    space = false;
    board.classList.remove('space');
  }
});

export const isTyping = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

let hintHidden = false;
function hideHint() {
  if (hintHidden) return;
  hintHidden = true;
  document.getElementById('board-hint').style.opacity = '0';
}

// ---------- Item drag & drop between lists ----------

let dropLine = null;
function clearDrop() {
  dropLine?.remove();
  dropLine = null;
  world.querySelectorAll('.drop-into').forEach((x) => x.classList.remove('drop-into'));
}

function dropIndex(body, clientY) {
  const rows = [...body.querySelectorAll('.item:not(.dragging)')];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return { index: i, before: rows[i] };
  }
  return { index: rows.length, before: null };
}

world.addEventListener('dragover', (e) => {
  if (!dragItemId) return;
  const card = e.target.closest('.card:not(.note)');
  if (!card) return clearDrop();
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const body = card.querySelector('.card-body');
  const { before } = dropIndex(body, e.clientY);
  clearDrop();
  card.classList.add('drop-into');
  dropLine = h('div.drop-line');
  if (before) body.insertBefore(dropLine, before);
  else body.append(dropLine);
});

world.addEventListener('dragleave', (e) => {
  if (!world.contains(e.relatedTarget)) clearDrop();
});

world.addEventListener('drop', (e) => {
  if (!dragItemId) return;
  const card = e.target.closest('.card:not(.note)');
  if (!card) return;
  e.preventDefault();
  const body = card.querySelector('.card-body');
  dropLine?.remove();
  // Index among all items, counting the dragged one if it's in this list.
  const rows = [...body.querySelectorAll('.item')];
  const { before } = dropIndex(body, e.clientY);
  const index = before ? rows.indexOf(before) : rows.length;
  const id = dragItemId;
  clearDrop();
  moveItem(id, card.dataset.id, index);
});

// ---------- Init ----------

export function initBoard() {
  view = { ...store.state.view };
  applyView();
  render();
  if (!store.state.view || (store.state.view.x === 0 && store.state.view.y === 0 && store.state.view.zoom === 1)) requestAnimationFrame(() => fit(true));
}
