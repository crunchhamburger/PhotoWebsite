// Planner bootstrap: wires the store, whiteboard, side panel, quick add, search and shortcuts.
import { store, findCard, lists, listByTag } from './store.js';
import { calendar } from './feeds.js';
import { parseQuickAdd } from './parse.js';
import { h, fmtDue, fmtEst, toast } from './ui.js';
import { initBoard, render, addList, addNote, fit, zoomBy, resetZoom, setFilter, revealFirstMatch, reveal, isVisible, getLastListId, isTyping, viewCenter } from './board.js';
import { renderSide, showTab, moveInk } from './sidebar.js';
import { addParsed, notify } from './actions.js';
import * as fx from './motion.js';
import { initPets, syncPets } from './pets.js';

const SIDE_KEY = 'planner.side';
const SYNC_EVERY = 15 * 60000;

await store.load();
calendar.restoreCache();
applyTheme();
initBoard();
// Pets arrive after the cards have risen in.
setTimeout(initPets, fx.reduced() ? 0 : 700);
// Undo/import can change the pet settings: keep the board in step.
let petsKey = '';
store.subscribe((s) => {
  const k = JSON.stringify(s.settings.pets || {});
  if (petsKey && k !== petsKey) syncPets();
  petsKey = k;
});

let frame = 0;
const schedule = () => {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
    renderSide();
    applyTheme();
  });
};
store.subscribe(schedule);
calendar.subscribe(() => renderSide());

// ---------- Side panel ----------

try {
  if (localStorage.getItem(SIDE_KEY) === 'closed' || innerWidth < 860) document.body.classList.add('side-closed');
} catch {}
for (const b of document.querySelectorAll('.tabs [role=tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));
document.getElementById('side-btn').addEventListener('click', toggleSide);
function toggleSide() {
  document.body.classList.toggle('side-closed');
  try { localStorage.setItem(SIDE_KEY, document.body.classList.contains('side-closed') ? 'closed' : 'open'); } catch {}
}
showTab('today');
if (innerWidth < 860) document.body.classList.add('side-closed');

// ---------- Top bar ----------

document.getElementById('add-list').addEventListener('click', () => addList());
document.getElementById('add-note').addEventListener('click', () => addNote());
document.getElementById('zoom-in').addEventListener('click', () => zoomBy(1.2));
document.getElementById('zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
document.getElementById('zoom-level').addEventListener('click', resetZoom);
document.getElementById('zoom-fit').addEventListener('click', () => fit());
document.getElementById('theme-btn').addEventListener('click', (e) => toggleTheme(e.currentTarget));
addEventListener('resize', moveInk);
document.fonts?.ready.then(moveInk);

/** Light/dark with a circular reveal spreading from the button (View Transitions). */
function toggleTheme(btn) {
  const flip = () => {
    store.update((s) => (s.settings.theme = s.settings.theme === 'light' ? 'dark' : 'light'), { undoable: false, quiet: true });
    applyTheme();
  };
  if (!document.startViewTransition || fx.reduced()) return flip();
  const r = btn.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const t = document.startViewTransition(flip);
  t.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 700, easing: 'cubic-bezier(.65, 0, .35, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
  fx.play(btn, [{ transform: 'rotate(0) scale(1)' }, { transform: 'rotate(-200deg) scale(.7)' }, { transform: 'rotate(-360deg) scale(1)' }], { duration: 700, easing: fx.EASE_OUT });
}

function applyTheme() {
  document.documentElement.dataset.theme = store.state.settings.theme === 'light' ? 'light' : 'dark';
}

const dot = document.getElementById('save-dot');
document.addEventListener('planner:saved', (e) => {
  dot.className = `save-dot ${e.detail.ok ? 'ok' : 'err'}`;
  dot.title = e.detail.ok ? 'Saved' : 'Saved in this browser only (server unreachable)';
});
document.addEventListener('planner:toast', (e) => toast(e.detail.text, { kind: e.detail.kind }));

// ---------- Search ----------

const search = document.getElementById('search');
search.addEventListener('input', () => setFilter(search.value));
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') revealFirstMatch();
  if (e.key === 'Escape') {
    search.value = '';
    setFilter('');
    search.blur();
  }
});

// ---------- Quick add ----------

const dlg = document.getElementById('quick');
const qi = document.getElementById('quick-input');
const preview = document.getElementById('quick-preview');

function openQuick() {
  qi.value = '';
  prevChips = new Set();
  renderPreview();
  dlg.showModal();
  qi.focus();
  fx.play(dlg, [{ opacity: 0, transform: 'translateY(-14px) scale(.96)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], fx.SPRING);
}

// Chips that weren't in the preview a keystroke ago pop in.
let prevChips = new Set();
function popNewChips() {
  const now = new Set();
  [...preview.children].forEach((c) => {
    now.add(c.textContent);
    if (!prevChips.has(c.textContent)) fx.popIn(c, { from: 0.5 });
  });
  prevChips = now;
}

function targetFor(p) {
  return listByTag(store.state, p.list) || findCard(store.state, getLastListId()) || lists(store.state)[0];
}

function renderPreview() {
  const p = parseQuickAdd(qi.value);
  const chips = [];
  if (!qi.value.trim()) {
    preview.replaceChildren(h('span.chip', `→ ${targetFor(p)?.title ?? 'first list'}`));
    return;
  }
  const t = listByTag(store.state, p.list);
  chips.push(h('span.chip', { style: t ? { color: t.color } : {} }, p.list && !t ? `→ new list “${p.list}”` : `→ ${(t || targetFor(p))?.title}`));
  if (p.due) {
    const d = fmtDue(p.due.toISOString(), p.hasTime);
    chips.push(h(`span.chip.${d.status}`, d.label));
  }
  if (p.est) chips.push(h('span.chip', `~${fmtEst(p.est)}`));
  if (p.priority) chips.push(h(`span.chip.p${p.priority}`, '!'.repeat(p.priority)));
  if (p.repeat) chips.push(h('span.chip', `↻ ${p.repeat}`));
  preview.replaceChildren(...chips);
  popNewChips();
}

qi.addEventListener('input', renderPreview);
document.getElementById('quick-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = parseQuickAdd(qi.value);
  const from = qi.getBoundingClientRect();
  qi.value = '';
  dlg.close();
  if (!p.text) return;
  const { listId, itemId } = addParsed(p, getLastListId());
  const l = findCard(store.state, listId);
  toast(`Added to ${l.title}`, { action: 'Show', onAction: () => reveal(listId) });
  // The task flies from the input to its place in the list (gliding there first if it's off screen).
  const launch = () => {
    const target = document.querySelector(`.card [data-item="${itemId}"]`);
    if (target) fx.flyChip(p.text, { left: from.left + 18, top: from.top + 14 }, target, l.color);
  };
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (isVisible(listId)) launch();
    else reveal(listId, { pulse: false }).then(launch);
  }));
});
// Chrome can leave focus on the input of a closed <dialog>, which would swallow shortcuts.
// The close event is async: skip it if quick add was already reopened.
dlg.addEventListener('close', () => {
  if (dlg.open) return;
  qi.value = '';
  qi.blur();
  document.getElementById('board').focus({ preventScroll: true });
});
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
document.getElementById('quick-add-btn').addEventListener('click', openQuick);

// ---------- Shortcuts ----------

addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    return dlg.open ? dlg.close() : openQuick();
  }
  if (mod && e.key.toLowerCase() === 'z' && !isTyping(e.target)) {
    e.preventDefault();
    const ok = e.shiftKey ? store.redoLast() : store.undoLast();
    if (!ok) toast(e.shiftKey ? 'Nothing to redo' : 'Nothing to undo', { ms: 1500 });
    return;
  }
  const typing = isTyping(e.target) && !e.target.closest('dialog:not([open])');
  if (mod || e.altKey || typing || dlg.open) return;
  const k = e.key;
  if (k === 'n' || k === 'N') { e.preventDefault(); openQuick(); }
  else if (k === '/') { e.preventDefault(); search.focus(); }
  else if (k === 'l' || k === 'L') addList(viewCenter());
  else if (k === 'f' || k === 'F') fit();
  else if (k === '1') showTab('today');
  else if (k === '2') showTab('calendar');
  else if (k === '3') showTab('settings');
  else if (k === '\\') toggleSide();
  else if (k === '=' || k === '+') zoomBy(1.2);
  else if (k === '-') zoomBy(1 / 1.2);
});

addEventListener('beforeunload', () => store.flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.flush();
  else if (Date.now() - calendar.lastSync > SYNC_EVERY) calendar.sync({ silent: true });
});

// ---------- Calendar sync + reminders ----------

if (store.state.settings.feeds.length || store.state.settings.canvasHost) calendar.sync({ silent: true });
setInterval(() => calendar.sync({ silent: true }), SYNC_EVERY);

const REMINDED_KEY = 'planner.reminded';
let reminded = {};
try { reminded = JSON.parse(localStorage.getItem(REMINDED_KEY) || '{}'); } catch {}
function checkReminders() {
  const before = store.state.settings.remindBefore ?? 60;
  if (!before) return;
  const now = Date.now();
  for (const l of lists(store.state)) {
    for (const it of l.items) {
      if (it.done || !it.due) continue;
      const due = Date.parse(it.due);
      const key = `${it.id}|${it.due}`;
      if (due - now <= before * 60000 && due > now && !reminded[key]) {
        reminded[key] = now;
        notify(`“${it.text}” is due ${fmtDue(it.due, it.hasTime !== false).label}`);
      }
    }
  }
  for (const [k, t] of Object.entries(reminded)) if (now - t > 7 * 86400000) delete reminded[k];
  try { localStorage.setItem(REMINDED_KEY, JSON.stringify(reminded)); } catch {}
}
setTimeout(checkReminders, 3000);
setInterval(checkReminders, 60000);
// Redraw relative dates ("Today", overdue) and the now-line every few minutes.
setInterval(schedule, 5 * 60000);
