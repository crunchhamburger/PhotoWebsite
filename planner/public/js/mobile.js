// Phone layout and gestures (loaded by app.js on small touch screens): a bottom tab bar, a stacked
// "Lists" view, swipe a task right to complete it or left for its actions, pull down to sync.
// Pinch-to-zoom and double-tap live in board.js.
import { store } from './store.js';
import { h, menu, toast } from './ui.js';
import { toggleItem, openDetails, startFocus, scheduleNext } from './actions.js';
import { render, fit, setFilter } from './board.js';
import { showTab } from './sidebar.js';

const VIEW_KEY = 'planner.mobile.view';
const root = document.documentElement;
const board = document.getElementById('board');
const world = document.getElementById('world');

root.classList.add('phone');
const hint = document.getElementById('board-hint');
if (hint) hint.textContent = 'Pinch to zoom · drag to move · double-tap to zoom · double-tap a list’s title to read it';

// ---------- Bottom tab bar ----------

const icon = (paths) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = paths;
  return s;
};
const ICON = {
  board: '<rect x="3" y="4" width="8" height="7" rx="2"/><rect x="13" y="4" width="8" height="12" rx="2"/><rect x="3" y="13" width="8" height="7" rx="2"/>',
  lists: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="18" r="1.2"/>',
  today: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="m9 14.5 2 2 4-4"/>',
  more: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
};
const tab = (id, label, paths) => h('button.m-tab', { dataset: { tab: id }, 'aria-label': label }, icon(paths), h('span', label));
const bar = h('nav.m-bar', { 'aria-label': 'Sections' },
  tab('board', 'Board', ICON.board),
  tab('lists', 'Lists', ICON.lists),
  h('button.m-add', { 'aria-label': 'Quick add', onclick: () => document.getElementById('quick-add-btn').click() }, icon(ICON.plus)),
  tab('today', 'Today', ICON.today),
  tab('more', 'Settings', ICON.more),
);
document.body.append(bar);

let view = 'board';
try { view = localStorage.getItem(VIEW_KEY) === 'lists' ? 'lists' : 'board'; } catch {}

const sideOpen = () => !document.body.classList.contains('side-closed');
function setSide(open, which) {
  document.body.classList.toggle('side-closed', !open);
  if (open && which) showTab(which);
  markTabs();
}
function markTabs() {
  const active = !sideOpen() ? view : document.querySelector('.tabs [aria-selected="true"]')?.dataset.tab === 'settings' ? 'more' : 'today';
  for (const b of bar.querySelectorAll('.m-tab')) b.classList.toggle('on', b.dataset.tab === active);
}
bar.addEventListener('click', (e) => {
  const b = e.target.closest('.m-tab');
  if (!b) return;
  const t = b.dataset.tab;
  if (t === 'today') return setSide(!(sideOpen() && b.classList.contains('on')), 'today');
  if (t === 'more') return setSide(!(sideOpen() && b.classList.contains('on')), 'settings');
  setSide(false);
  setView(t);
});
for (const t of document.querySelectorAll('.tabs [role=tab]')) t.addEventListener('click', () => requestAnimationFrame(markTabs));

// ---------- Board / Lists ----------

function setView(v) {
  view = v;
  try { localStorage.setItem(VIEW_KEY, v); } catch {}
  board.classList.toggle('stacked', v === 'lists');
  if (v === 'lists') {
    board.scrollTop = 0;
    orderStacked();
  } else {
    board.scrollTop = 0;
    requestAnimationFrame(() => fit());
  }
  markTabs();
  window.dispatchEvent(new Event('resize')); // the pet re-measures its space
}

/** In the Lists view, lists read left to right, then top to bottom, like the board. */
function orderStacked() {
  if (!board.classList.contains('stacked')) return;
  const cards = [...store.state.cards].sort((a, b) => Math.round(a.x / 200) - Math.round(b.x / 200) || a.y - b.y);
  cards.forEach((c, i) => {
    const el = world.querySelector(`.card[data-id="${c.id}"]`);
    if (el) el.style.order = String(i);
  });
}
store.subscribe(() => requestAnimationFrame(orderStacked));

// ---------- Swipe a task ----------

let swipe = null;
world.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  const row = e.target.closest('.item');
  if (!row || e.target.closest('input, button, a, [contenteditable="true"]')) return;
  swipe = { row, id: row.dataset.item, x: e.clientX, y: e.clientY, dx: 0, on: false, pid: e.pointerId };
});
addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.pid) return;
  const dx = e.clientX - swipe.x;
  const dy = e.clientY - swipe.y;
  if (!swipe.on) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; } // scrolling
    if (Math.abs(dx) < 12) return;
    swipe.on = true;
    swipe.row.classList.add('swiping');
    swipe.row.append(h('span.swipe-hint.done', '✓'), h('span.swipe-hint.more', '⋯'));
  }
  swipe.dx = Math.max(-110, Math.min(110, dx));
  swipe.row.style.transform = `translateX(${swipe.dx}px)`;
  swipe.row.querySelector('.swipe-hint.done').classList.toggle('armed', swipe.dx > 70);
  swipe.row.querySelector('.swipe-hint.more').classList.toggle('armed', swipe.dx < -70);
}, { passive: true });
const endSwipe = () => {
  if (!swipe) return;
  const { row, id, dx, on } = swipe;
  swipe = null;
  if (!on) return;
  row.classList.remove('swiping');
  row.classList.add('swipe-back');
  row.style.transform = '';
  setTimeout(() => {
    row.classList.remove('swipe-back');
    row.querySelectorAll('.swipe-hint').forEach((x) => x.remove());
  }, 320);
  if (dx > 70) toggleItem(id, row.querySelector('.check'));
  else if (dx < -70) {
    const r = row.getBoundingClientRect();
    menu({ x: r.right - 12, y: r.top + r.height / 2 }, [
      { label: 'Details', onclick: () => openDetails(row.querySelector('.check') || row, id) },
      { label: 'Focus for 25 minutes', onclick: () => startFocus(id) },
      { label: 'Block time today', onclick: () => scheduleNext(id) },
    ]);
  }
};
addEventListener('pointerup', endSwipe);
addEventListener('pointercancel', endSwipe);

// ---------- Pull down to sync (Lists view) ----------

const pull = h('div.m-pull', icon('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4h-4"/>'));
board.append(pull);
let pullY = null;
board.addEventListener('touchstart', (e) => {
  pullY = board.classList.contains('stacked') && board.scrollTop <= 0 ? e.touches[0].clientY : null;
}, { passive: true });
board.addEventListener('touchmove', (e) => {
  if (pullY == null) return;
  const d = Math.max(0, Math.min(110, e.touches[0].clientY - pullY));
  pull.style.transform = `translateY(${d * 0.6 - 48}px) rotate(${d * 3}deg)`;
  pull.style.opacity = String(Math.min(1, d / 70));
}, { passive: true });
board.addEventListener('touchend', async (e) => {
  if (pullY == null) return;
  const d = (e.changedTouches[0]?.clientY ?? pullY) - pullY;
  pullY = null;
  if (d < 80) {
    pull.style.transform = '';
    pull.style.opacity = '0';
    return;
  }
  pull.classList.add('spin');
  pull.style.transform = 'translateY(14px)';
  if (store.dirty) await store.flush();
  await store.pull();
  pull.classList.remove('spin');
  pull.style.transform = '';
  pull.style.opacity = '0';
  toast('Up to date', { ms: 1200 });
});

// ---------- Search from the top bar ----------

const searchBtn = h('button.icon-btn#m-search-btn', { 'aria-label': 'Search tasks', onclick: () => {
  root.classList.toggle('searching');
  if (root.classList.contains('searching')) document.getElementById('search').focus();
  else {
    document.getElementById('search').value = '';
    setFilter('');
  }
} }, icon(ICON.search));
document.querySelector('.top-actions').prepend(searchBtn);
document.getElementById('search').addEventListener('blur', (e) => {
  if (!e.target.value) root.classList.remove('searching');
});

// ---------- Start ----------

document.body.classList.add('side-closed');
setView(view);
markTabs();
render();
