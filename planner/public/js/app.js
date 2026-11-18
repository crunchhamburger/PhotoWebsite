// Planner bootstrap: wires the store, whiteboard, side panel, command bar (omnibox, now chip,
// brief and voice) and shortcuts.
import { store, lists } from './store.js';
import { calendar } from './feeds.js';
import { fmtDue, toast } from './ui.js';
import { initBoard, render, addList, addNote, fit, zoomBy, resetZoom, isTyping, viewCenter, toggleMap, showHiddenPanel } from './board.js';
import { renderSide, showTab, moveInk, openVoice, openBrief } from './sidebar.js';
import { notify, startFocus } from './actions.js';
import * as fx from './motion.js';
import { initPets, syncPet } from './pets.js';
import { initOmni, openOmni } from './omni.js';
import { initNow } from './now.js';
import { voiceStats, latestBrief, briefSeen } from './inbox.js';

const SIDE_KEY = 'planner.side';
const SYNC_EVERY = 15 * 60000;

// Mac app: title bar, planner name, library.
if (window.plannerDesktop) import('./desktop.js');

await store.load();
calendar.restoreCache();
applyTheme();
initBoard();
// Phones: bottom tab bar, Lists view, swipes (pinch zoom is in board.js).
const PHONE = !window.plannerDesktop && (matchMedia('(max-width: 760px)').matches || (matchMedia('(pointer: coarse)').matches && innerWidth < 900));
if (PHONE) await import('./mobile.js');
// Pets arrive after the cards have risen in.
setTimeout(initPets, fx.reduced() ? 0 : 700);
// Undo/import can change the pet settings: keep the board in step.
let petsKey = JSON.stringify(store.state.settings.pet || {});
store.subscribe((s) => {
  const k = JSON.stringify(s.settings.pet || {});
  if (k !== petsKey) syncPet();
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

// Drag the panel's left edge to make it wider or narrower (remembered; double-click resets).
const SIDE_W_KEY = 'planner.side.w';
const setSideW = (w) => document.documentElement.style.setProperty('--side-w', `${Math.round(Math.min(Math.max(w, 320), Math.min(720, innerWidth - 360)))}px`);
try { const w = Number(localStorage.getItem(SIDE_W_KEY)); if (w) setSideW(w); } catch {}
const resizer = document.getElementById('side-resize');
resizer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  resizer.setPointerCapture(e.pointerId);
  document.body.classList.add('side-resizing');
  const move = (ev) => { setSideW(innerWidth - ev.clientX); moveInk(); };
  const up = () => {
    resizer.removeEventListener('pointermove', move);
    document.body.classList.remove('side-resizing');
    try { localStorage.setItem(SIDE_W_KEY, String(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--side-w')))); } catch {}
  };
  resizer.addEventListener('pointermove', move);
  resizer.addEventListener('pointerup', up, { once: true });
  resizer.addEventListener('pointercancel', up, { once: true });
});
resizer.addEventListener('dblclick', () => {
  document.documentElement.style.removeProperty('--side-w');
  try { localStorage.removeItem(SIDE_W_KEY); } catch {}
  moveInk();
});

// ---------- Board dock ----------

document.getElementById('add-list').addEventListener('click', () => addList());
document.getElementById('add-note').addEventListener('click', () => addNote());
document.getElementById('zoom-in').addEventListener('click', () => zoomBy(1.2));
document.getElementById('zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
document.getElementById('zoom-level').addEventListener('click', resetZoom);
document.getElementById('zoom-fit').addEventListener('click', () => fit());
document.getElementById('map-btn').addEventListener('click', () => toggleMap());

// ---------- Command bar ----------

document.getElementById('theme-btn').addEventListener('click', (e) => toggleTheme(e.currentTarget));
document.getElementById('brief-btn').addEventListener('click', () => openBrief());
document.getElementById('voice-btn').addEventListener('click', () => openVoice({ dictate: true }));
document.getElementById('quick-add-btn').addEventListener('click', () => openOmni());
addEventListener('resize', moveInk);
document.fonts?.ready.then(moveInk);

/** Badges: a dot when there's a brief you haven't opened, the count of voice notes waiting. */
function updateBadges() {
  const b = latestBrief();
  const unread = !!b && b.key !== briefSeen();
  document.getElementById('brief-dot').hidden = !unread;
  document.getElementById('tab-brief-dot').hidden = !unread;
  document.getElementById('brief-btn').title = b ? `Morning brief${unread ? ' · new' : ''}${b.questions ? ` · ${b.questions} question${b.questions > 1 ? 's' : ''} for you` : ''} (B)` : 'Morning brief (B)';
  const { waiting } = voiceStats();
  for (const id of ['voice-count', 'tab-voice-count']) {
    const el = document.getElementById(id);
    el.hidden = !waiting;
    el.textContent = waiting > 9 ? '9+' : String(waiting);
  }
  document.getElementById('voice-btn').title = `Voice note${waiting ? ` · ${waiting} waiting for tonight` : ''} (V)`;
}
updateBadges();
store.subscribe(updateBadges);
document.addEventListener('planner:brief-seen', updateBadges);

initNow({ onFocus: (id) => startFocus(id), onOpen: () => showTab('today') });

const I = {
  mic: '<rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/>',
  sun: '<path d="M3 15h14M5.5 15a4.5 4.5 0 0 1 9 0M10 4v2.5M4.2 7.2l1.6 1.6M15.8 7.2l-1.6 1.6"/>',
  today: '<rect x="3" y="4" width="14" height="13" rx="2.5"/><path d="M3 8h14M7 2.5v3M13 2.5v3M7.5 12l2 2 3.5-3.5"/>',
  cal: '<rect x="3" y="4" width="14" height="13" rx="2.5"/><path d="M3 8h14M7 2.5v3M13 2.5v3"/>',
  list: '<rect x="3" y="3.5" width="14" height="13" rx="2.5"/><path d="M6.5 8h7M6.5 11h5"/>',
  note: '<path d="M4 3.5h12v8.5l-4 4.5H4z"/><path d="M12 16.5V12h4"/>',
  fit: '<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/>',
  map: '<path d="M3 5.5 7.5 3.5l5 2 4.5-2v11l-4.5 2-5-2L3 16.5z"/><path d="M7.5 3.5v11M12.5 5.5v11"/>',
  eye: '<path d="M3 3l14 14M8.5 5.2A7.7 7.7 0 0 1 10 5c4.5 0 7.5 5 7.5 5a13 13 0 0 1-2.2 2.8M5.6 6.6C3.6 8 2.5 10 2.5 10s3 5 7.5 5c1 0 1.9-.2 2.7-.5"/>',
  moon: '<path d="M10 3a7 7 0 1 0 7 7 5.5 5.5 0 0 1-7-7Z"/>',
  panel: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M12.5 3.5v13"/>',
  gear: '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M2.5 10h2M15.5 10h2M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  sync: '<path d="M16 6.5A6.5 6.5 0 0 0 4.3 7.5M4 13.5a6.5 6.5 0 0 0 11.7-1M16 3v3.5h-3.5M4 17v-3.5h3.5"/>',
};
initOmni([
  { label: 'Record a voice note', group: 'Capture', key: 'V', icon: I.mic, suggest: true, keywords: 'voice dictate inbox mic', run: () => openVoice({ dictate: true }) },
  { label: 'New list', group: 'Capture', key: 'L', icon: I.list, suggest: true, run: () => addList(viewCenter()) },
  { label: 'New sticky note', group: 'Capture', icon: I.note, suggest: true, keywords: 'note pad', run: () => addNote() },
  { label: 'Read the morning brief', group: 'Go to', key: 'B', icon: I.sun, suggest: true, keywords: 'night shift brief', run: () => openBrief() },
  { label: 'Plan my day', group: 'Go to', key: '1', icon: I.today, suggest: true, keywords: 'today agenda', run: () => showTab('today') },
  { label: 'Voice Inbox', group: 'Go to', key: '3', icon: I.mic, keywords: 'notes transcripts', run: () => openVoice() },
  { label: 'Calendar', group: 'Go to', key: '4', icon: I.cal, suggest: true, run: () => showTab('calendar') },
  { label: 'Settings', group: 'Go to', key: '5', icon: I.gear, keywords: 'feeds canvas google preferences', run: () => showTab('settings') },
  { label: 'Fit the whole board', group: 'Board', key: 'F', icon: I.fit, suggest: true, keywords: 'zoom overview', run: () => fit() },
  { label: 'Show the map', group: 'Board', key: 'M', icon: I.map, suggest: true, keywords: 'minimap navigator', run: () => toggleMap() },
  { label: 'Show hidden lists and notes', group: 'Board', icon: I.eye, keywords: 'hidden unhide', run: () => showHiddenPanel() },
  { label: 'Switch light / dark', group: 'App', icon: I.moon, keywords: 'theme dark light', run: () => toggleTheme(document.getElementById('theme-btn')) },
  { label: 'Show or hide the side panel', group: 'App', key: '\\', icon: I.panel, run: () => toggleSide() },
  { label: 'Sync calendars now', group: 'App', icon: I.sync, keywords: 'refresh canvas google', run: () => calendar.sync() },
]);

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

// ---------- Shortcuts ----------

const TAB_KEYS = { 1: 'today', 2: 'brief', 3: 'voice', 4: 'calendar', 5: 'settings' };
addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    return openOmni();
  }
  if (mod && e.key.toLowerCase() === 'z' && !isTyping(e.target)) {
    e.preventDefault();
    const ok = e.shiftKey ? store.redoLast() : store.undoLast();
    if (!ok) toast(e.shiftKey ? 'Nothing to redo' : 'Nothing to undo', { ms: 1500 });
    return;
  }
  if (mod || e.altKey || isTyping(e.target) || document.querySelector('dialog[open]')) return;
  const k = e.key;
  if (k === 'n' || k === 'N') { e.preventDefault(); openOmni(); }
  else if (k === '/') { e.preventDefault(); openOmni('/'); }
  else if (k === 'l' || k === 'L') addList(viewCenter());
  else if (k === 'f' || k === 'F') fit();
  else if (k === 'm' || k === 'M') toggleMap();
  else if (k === 'b' || k === 'B') openBrief();
  else if (k === 'v' || k === 'V') { e.preventDefault(); openVoice({ dictate: true }); }
  else if (TAB_KEYS[k]) showTab(TAB_KEYS[k]);
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
