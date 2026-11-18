// Voice Inbox: a capture-first view of the planner's "Voice Inbox" list. Same board, same store,
// same versioned sync as the planner (store.js): a note saved here reaches the phone, the Mac app
// and the Night Shift runner like any other task. Each note is a task titled "YYYY-MM-DD HH:MM"
// with the transcript in its notes; the runner appends "## Processed <date>" under it.
import { store, uid, findCard } from '../js/store.js';
import { h, toast, menu, closeFloats } from '../js/ui.js';
import * as fx from '../js/motion.js';
import { getField, setField, fieldsOf, applyPreset } from '../js/fields.js';
import { renderMarkdown } from '../js/markdown.js';

const $ = (id) => document.getElementById(id);
const feed = $('vi-feed');
const text = $('vi-text');
const interim = $('vi-interim');
const saveBtn = $('vi-save');
const micBtn = $('vi-mic');
const capture = $('vi-capture');

let filter = 'all';
try { filter = localStorage.getItem('planner.voice.filter') || 'all'; } catch {}
const expanded = new Set(); // transcript ids shown in full
const opened = new Set(); // ids whose Night Shift output is unfolded
let rendered = false;

// ---------- Data ----------

const inboxOf = (s) => s.cards.find((c) => c.kind === 'list' && (c.preset === 'voice-inbox' || c.title.trim().toLowerCase() === 'voice inbox')) || null;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** A task as the view wants it: when it was recorded, the transcript, and the runner's output. */
function entry(it) {
  const notes = it.notes || '';
  const cut = notes.search(/^## Processed /m);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(it.text || '');
  const rec = getField(it, 'recorded');
  const when = m ? new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0) : rec ? new Date(`${rec}T12:00:00`) : null;
  // Typed from the phone's quick add: the whole note is the title.
  const transcript = (cut >= 0 ? notes.slice(0, cut) : notes).trim() || (m ? '' : it.text);
  return { id: it.id, when, title: it.text, transcript, output: cut >= 0 ? notes.slice(cut).trim() : '', processed: getField(it, 'processed') || null };
}

const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayLabel(d) {
  if (!d) return 'Undated';
  const days = Math.round((sod(new Date()) - sod(d)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return DOW[d.getDay()];
  return `${DOW[d.getDay()].slice(0, 3)}, ${MON[d.getMonth()]} ${d.getDate()}`;
}
const timeLabel = (d) => (d ? `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'am' : 'pm'}` : '');
const fmtDate = (iso) => { const [y, m, d] = iso.split('-'); return `${MON[+m - 1]} ${+d}`; };

// ---------- Capture ----------

function setNow() {
  const d = new Date();
  $('vi-now').textContent = `${dayLabel(d)} · ${timeLabel(d)}`;
}
setNow();
setInterval(setNow, 15000);

function autosize() {
  text.style.height = 'auto';
  text.style.height = Math.min(text.scrollHeight, innerHeight * 0.4) + 'px';
  saveBtn.disabled = !text.value.trim() && !interim.textContent;
}
text.addEventListener('input', autosize);
text.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
});

function save() {
  const body = `${text.value.trim()}${interim.textContent ? (text.value.trim() ? ' ' : '') + interim.textContent.trim() : ''}`.trim();
  if (!body) return;
  if (listening) stopListening();
  const now = new Date();
  const item = { id: uid(), text: stamp(now), done: false, notes: body };
  let created = false;
  store.update((s) => {
    let l = inboxOf(s);
    if (!l) {
      // First note ever: make the list, to the right of everything on the board.
      const right = s.cards.length ? Math.max(...s.cards.map((c) => c.x + (c.w || 300))) + 60 : 80;
      l = { id: uid(), kind: 'list', title: 'Voice Inbox', color: '#ff7ab6', x: Math.round(right / 10) * 10, y: 80, w: 340, h: 0, collapsed: false, items: [] };
      s.cards.push(l);
      created = true;
    }
    if (!fieldsOf(l).length) applyPreset(l, 'voice-inbox');
    setField(l, item, 'recorded', item.text.slice(0, 10));
    l.items.unshift(item);
  });
  text.value = '';
  interim.textContent = '';
  autosize();
  saveBtn.classList.remove('pop');
  void saveBtn.offsetWidth;
  saveBtn.classList.add('pop');
  const r = saveBtn.getBoundingClientRect();
  fx.ripple(r.left + r.width / 2, r.top + r.height / 2, 'var(--voice)', 160);
  if (filter === 'done') setFilter('all');
  justAdded = item.id;
  toast(created ? 'Saved. A Voice Inbox list was added to your board.' : `Saved for tonight · ${timeLabel(now)}`, { ms: 2200 });
}
saveBtn.addEventListener('click', save);
let justAdded = null;

// ---------- Dictation (Web Speech API, where the browser has it) ----------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let listening = false;
if (!Recognition) {
  micBtn.classList.add('unsupported');
  $('vi-hint').textContent = 'Paste a transcript (dictation needs Chrome or Safari). Stamped with the time when you save.';
}
function startListening() {
  rec = new Recognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || 'en-US';
  let finalSinceStart = '';
  rec.onresult = (e) => {
    let interimText = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalSinceStart += t.trim() + ' ';
      else interimText += t;
    }
    if (finalSinceStart) {
      text.value = `${text.value.replace(/\s+$/, '')}${text.value.trim() ? ' ' : ''}${finalSinceStart.trim()}`;
      finalSinceStart = '';
    }
    interim.textContent = interimText.trim();
    autosize();
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed') toast('Microphone access was refused. Paste a transcript instead.', { kind: 'warn' });
    stopListening();
  };
  rec.onend = () => { if (listening) { try { rec.start(); } catch { stopListening(); } } };
  try { rec.start(); } catch { return toast('Dictation could not start here.', { kind: 'warn' }); }
  listening = true;
  micBtn.setAttribute('aria-pressed', 'true');
  capture.classList.add('listening');
  $('vi-live').hidden = false;
  $('vi-hint').textContent = 'Listening… tap the mic again to stop, then save.';
  text.focus();
}
function stopListening() {
  listening = false;
  try { rec?.stop(); } catch {}
  micBtn.setAttribute('aria-pressed', 'false');
  capture.classList.remove('listening');
  $('vi-live').hidden = true;
  $('vi-hint').textContent = 'Stamped with the time when you save. The Night Shift runner picks it up tonight.';
  if (interim.textContent) { text.value = `${text.value.replace(/\s+$/, '')}${text.value.trim() ? ' ' : ''}${interim.textContent}`; interim.textContent = ''; }
  autosize();
}
micBtn.addEventListener('click', () => (listening ? stopListening() : startListening()));

// ---------- Filter ----------

const filterBar = $('vi-filter');
function setFilter(f) {
  filter = f;
  try { localStorage.setItem('planner.voice.filter', f); } catch {}
  const idx = ['all', 'new', 'done'].indexOf(f);
  $('vi-ink').style.transform = `translateX(${idx * 100}%)`;
  for (const b of filterBar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.f === f));
  render();
}
filterBar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setFilter(b.dataset.f); });

// ---------- Feed ----------

const ICON_CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.5 3.2 3.2L15 7"/></svg>';
const ICON_SPARK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.5 5.5l2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2"/></svg>';
const ICON_MOON = '<svg class="moon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3a7 7 0 1 0 7 7 5.5 5.5 0 0 1-7-7Z"/></svg>';
const ICON_CHEV = '<svg class="chev" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>';
const svgOf = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; };

function card(e) {
  const long = e.transcript.length > 280 || e.transcript.split('\n').length > 4;
  const clamp = long && !expanded.has(e.id);
  const el = h(`article.vi-card${e.processed ? '.done' : ''}`, { dataset: { id: e.id } },
    h('div.vi-card-head',
      h('div.vi-time', e.when ? timeLabel(e.when) : 'Undated', e.when ? h('small', `${MON[e.when.getMonth()]} ${e.when.getDate()}`) : null),
      h(`span.vi-pill${e.processed ? '.done' : ''}`, svgOf(e.processed ? ICON_CHECK : ICON_SPARK), e.processed ? `Processed ${fmtDate(e.processed)}` : 'Waiting for tonight'),
      h('button.vi-menu-btn', { 'aria-label': 'More', onclick: (ev) => cardMenu(ev.currentTarget, e) }, svgOf('<svg viewBox="0 0 20 20"><circle cx="5" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="15" cy="10" r="1.6"/></svg>')),
    ),
    h('div.vi-body',
      h(`p.vi-transcript${clamp ? '.clamp' : ''}`, e.transcript || h('span', { style: { color: 'var(--fg-faint)' } }, 'Empty note')),
      long ? h('button.vi-more', { onclick: () => { expanded.has(e.id) ? expanded.delete(e.id) : expanded.add(e.id); render(); } }, clamp ? 'Show more' : 'Show less') : null,
    ),
    e.output ? h('details.vi-fold', { open: opened.has(e.id), ontoggle: (ev) => (ev.target.open ? opened.add(e.id) : opened.delete(e.id)) },
      h('summary.vi-fold-btn', svgOf(ICON_MOON), 'Night Shift output', svgOf(ICON_CHEV)),
      h('div.vi-fold-body', h('div', markdownEl(e.output))),
    ) : null,
  );
  return el;
}

function markdownEl(md) {
  const div = h('div.vi-md');
  // The first line is the "## Processed <date>" heading, already shown in the pill.
  div.innerHTML = renderMarkdown(md.replace(/^## Processed [^\n]*\n?/, ''));
  return div;
}

function cardMenu(anchor, e) {
  menu(anchor, [
    { label: 'Copy transcript', onclick: () => navigator.clipboard?.writeText(e.transcript).then(() => toast('Copied', { ms: 1200 })) },
    e.output ? { label: 'Copy Night Shift output', onclick: () => navigator.clipboard?.writeText(e.output).then(() => toast('Copied', { ms: 1200 })) } : null,
    e.processed ? { label: 'Process again tonight', onclick: () => { store.update((s) => { const l = inboxOf(s); const it = l.items.find((x) => x.id === e.id); setField(l, it, 'processed', null); }); toast('Back in tonight’s queue'); } } : null,
    'hr',
    { label: 'Delete note', danger: true, onclick: () => deleteNote(e) },
  ]);
}

function deleteNote(e) {
  store.update((s) => { const l = inboxOf(s); l.items = l.items.filter((x) => x.id !== e.id); });
  toast('Note deleted', { action: 'Undo', onAction: () => store.undoLast() });
}

function render() {
  const s = store.state;
  const l = inboxOf(s);
  const entries = (l ? l.items.map(entry) : []).sort((a, b) => (b.when?.getTime() || 0) - (a.when?.getTime() || 0));
  const fresh = entries.filter((e) => !e.processed).length;
  $('vi-sub').textContent = l ? (fresh ? `${fresh} waiting for tonight · ${entries.length - fresh} processed` : entries.length ? `All ${entries.length} processed` : 'No notes yet') : 'No Voice Inbox list on the board yet';
  for (const b of filterBar.querySelectorAll('button')) {
    const n = b.dataset.f === 'all' ? entries.length : b.dataset.f === 'new' ? fresh : entries.length - fresh;
    b.replaceChildren(b.dataset.f === 'all' ? 'All' : b.dataset.f === 'new' ? 'New' : 'Processed', n ? h('b', String(n)) : null);
  }
  const shown = entries.filter((e) => filter === 'all' || (filter === 'new' ? !e.processed : !!e.processed));

  const animate = rendered && !fx.reduced();
  const old = animate ? fx.snapshot(feed, '.vi-card[data-id]', 'data-id') : null;

  const nodes = [];
  let lastDay = null;
  for (const e of shown) {
    const day = dayLabel(e.when);
    if (day !== lastDay) { nodes.push(h('div.vi-day', day)); lastDay = day; }
    nodes.push(card(e));
  }
  if (!shown.length) {
    nodes.push(h('div.vi-empty',
      h('div.glyph', svgOf('<svg viewBox="0 0 20 20"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/></svg>')),
      h('strong', filter === 'done' ? 'Nothing processed yet' : filter === 'new' ? 'Nothing waiting' : 'No voice notes yet'),
      filter === 'all' ? 'Tap the mic or paste a transcript above. Tonight the runner turns it into a diary entry, a plan and tasks.' : 'Switch to All to see everything.'));
  }
  feed.replaceChildren(...nodes);

  if (!rendered) {
    if (!fx.reduced()) {
      fx.play(capture, [{ opacity: 0, transform: 'translateY(14px) scale(.98)' }, { opacity: 1, transform: 'none' }], { ...fx.SPRING_SOFT, fill: 'backwards' });
      [...feed.children].forEach((el, i) => fx.play(el, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 120 + Math.min(i, 8) * 55, easing: fx.EASE_OUT, fill: 'backwards' }));
    }
    rendered = true;
    return;
  }
  if (!animate) return;
  // FLIP: cards that stayed glide to their new place; new ones grow in; gone ones are already gone.
  const fresh2 = new Map([...feed.querySelectorAll('.vi-card[data-id]')].map((el) => [el.dataset.id, el]));
  for (const [id, el] of fresh2) {
    const o = old.get(id);
    if (!o) {
      fx.growIn(el);
      if (id === justAdded) { el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 1200); justAdded = null; }
      continue;
    }
    const r = el.getBoundingClientRect();
    if (Math.abs(o.rect.top - r.top) > 1) fx.flipFrom(el, 0, o.rect.top - r.top);
    if (!o.el?.classList.contains('done') && el.classList.contains('done')) el.classList.add('just-done');
  }
}

// ---------- Boot ----------

await store.load();
document.documentElement.dataset.theme = store.state.settings.theme === 'light' ? 'light' : 'dark';
setFilter(filter);
store.subscribe(() => {
  document.documentElement.dataset.theme = store.state.settings.theme === 'light' ? 'light' : 'dark';
  render();
});
const dot = $('vi-dot');
document.addEventListener('planner:saved', (e) => {
  dot.className = `vi-dot ${e.detail.ok ? 'ok' : 'err'}`;
  dot.title = e.detail.ok ? 'Saved' : 'Saved in this browser only (server unreachable)';
});
$('vi-sync').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.classList.add('spin');
  if (store.dirty) await store.flush();
  await store.pull();
  setTimeout(() => b.classList.remove('spin'), 600);
  toast('Up to date', { ms: 1200 });
});
addEventListener('beforeunload', () => store.flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });
