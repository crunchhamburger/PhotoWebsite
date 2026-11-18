// Voice Inbox and Morning Briefs as components, mounted by their own pages (voice-inbox/, briefs/)
// and by the planner's side panel (Voice and Brief tabs). Same store and versioned sync as the
// board: a note saved here reaches the phone, the Mac app and the Night Shift runner like any task.
//
// Voice Inbox: tasks titled "YYYY-MM-DD HH:MM" with the transcript in their notes; the runner
// appends "## Processed <date>" under it. Morning Briefs: tasks titled YYYY-MM-DD whose notes hold
// the night's "## " sections as Markdown.
import { store, uid } from './store.js';
import { h, toast, menu } from './ui.js';
import * as fx from './motion.js';
import { getField, setField, fieldsOf, applyPreset } from './fields.js';
import { renderMarkdown } from './markdown.js';

// ---------- Data ----------

export const voiceListOf = (s) => s.cards.find((c) => c.kind === 'list' && (c.preset === 'voice-inbox' || c.title.trim().toLowerCase() === 'voice inbox')) || null;
export const briefListOf = (s) => s.cards.find((c) => c.kind === 'list' && (c.preset === 'morning-briefs' || c.title.trim().toLowerCase() === 'morning briefs')) || null;

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A voice task as the view wants it: when it was recorded, the transcript, and the runner's output. */
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

/** Counts for badges: notes waiting for tonight's run, and all notes. */
export function voiceStats(s = store.state) {
  const l = voiceListOf(s);
  const all = l ? l.items.map(entry) : [];
  return { total: all.length, waiting: all.filter((e) => !e.processed).length, hasList: !!l };
}

/** Splits a day's notes into its "## " sections. Text before the first heading becomes "Brief". */
function sections(notes) {
  const out = [];
  let cur = null;
  for (const line of String(notes || '').split('\n')) {
    const m = /^## (.+)$/.exec(line);
    if (m) { cur = { title: m[1].trim(), body: [] }; out.push(cur); continue; }
    if (!cur) { if (!line.trim()) continue; cur = { title: 'Brief', body: [] }; out.push(cur); }
    cur.body.push(line);
  }
  return out.map((x) => ({ ...x, body: x.body.join('\n').trim() })).filter((x) => x.body);
}

const briefDays = (s) => {
  const l = briefListOf(s);
  return (l ? l.items.filter((it) => /^\d{4}-\d{2}-\d{2}/.test(it.text)) : []).sort((a, b) => (a.text < b.text ? 1 : -1));
};

/** The newest brief: its date, section titles, and how many questions it has for you. */
export function latestBrief(s = store.state) {
  const it = briefDays(s)[0];
  if (!it) return null;
  const secs = sections(it.notes);
  const questions = (String(it.notes || '').match(/### Questions for you\s*\n((?:\s*[-*] .*\n?)+)/g) || [])
    .reduce((n, block) => n + (block.match(/^\s*[-*] /gm) || []).length, 0);
  const d = new Date(`${it.text.slice(0, 10)}T12:00:00`);
  const today = Math.round((new Date().setHours(12, 0, 0, 0) - d) / 86400000) === 0;
  return { id: it.id, date: it.text.slice(0, 10), today, sections: secs.map((x) => x.title), questions, key: `${it.id}:${(it.notes || '').length}` };
}

// "Seen" for the Brief badge: the newest brief's key once it has been opened.
const SEEN_KEY = 'planner.brief.seen';
export const briefSeen = () => { try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; } };
export const markBriefSeen = () => {
  const b = latestBrief();
  if (b) try { localStorage.setItem(SEEN_KEY, b.key); } catch {}
  document.dispatchEvent(new CustomEvent('planner:brief-seen'));
};

const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
function dayLabel(d) {
  if (!d) return 'Undated';
  const days = Math.round((sod(new Date()) - sod(d)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return DOW[d.getDay()];
  return `${DOW[d.getDay()].slice(0, 3)}, ${MON[d.getMonth()]} ${d.getDate()}`;
}
const timeLabel = (d) => (d ? `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'am' : 'pm'}` : '');
const fmtDate = (iso) => { const [, m, d] = iso.split('-'); return `${MON[+m - 1]} ${+d}`; };

const svgOf = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; };
const ICON = {
  check: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.5 3.2 3.2L15 7"/></svg>',
  spark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.5 5.5l2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2"/></svg>',
  moon: '<svg class="moon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3a7 7 0 1 0 7 7 5.5 5.5 0 0 1-7-7Z"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>',
  dots: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="15" cy="10" r="1.6"/></svg>',
  mic: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7.5 17.5h5"/></svg>',
};

function markdownEl(md, { questions = false } = {}) {
  const div = h('div.vi-md');
  let html = renderMarkdown(md);
  // "### Questions for you" gets its own box so it stands out.
  if (questions) html = html.replace(/<h3>Questions for you<\/h3>\s*(<ul>[\s\S]*?<\/ul>)/, '<div class="br-questions"><h3>Questions for you</h3>$1</div>');
  div.innerHTML = html;
  return div;
}

/** Re-renders when the store changes while the component is on screen; a hidden one catches up
 *  when it's shown (the returned function, called by whoever shows it). */
function liveRender(root, render) {
  const visible = () => root.isConnected && root.offsetParent !== null;
  store.subscribe(() => visible() && render());
  return render;
}

// ---------- Voice Inbox ----------

/**
 * Builds the Voice Inbox into `root`. Returns { render, focus, dictate }.
 * onStatus(text): a one-line summary ("2 waiting for tonight · 3 processed"), for a page header.
 */
export function mountVoice(root, { onStatus = () => {} } = {}) {
  const now = h('span.vi-now');
  const live = h('span.vi-live', { hidden: true }, h('i'), h('i'), h('i'), h('i'), h('i'));
  const text = h('textarea', { rows: 3, placeholder: 'Speak, or paste a transcript…', 'aria-label': 'Transcript' });
  const interim = h('div.vi-interim', { 'aria-live': 'polite' });
  const micBtn = h('button.vi-mic', { 'aria-label': 'Dictate', 'aria-pressed': 'false', type: 'button' }, h('span.ring'), h('span.ring'), svgOf(ICON.mic));
  const hint = h('span.vi-hint', 'Stamped with the time when you save. The Night Shift runner picks it up tonight.');
  const saveBtn = h('button.vi-save', { disabled: true, type: 'button' }, 'Save note');
  const capture = h('section.vi-capture', { 'aria-label': 'New voice note' },
    h('div.vi-capture-head', now, live), text, interim, h('div.vi-capture-foot', micBtn, hint, saveBtn));
  const ink = h('span.vi-ink');
  const filterBar = h('nav.vi-filter', { 'aria-label': 'Show' }, ink,
    ...[['all', 'All'], ['new', 'New'], ['done', 'Processed']].map(([f, label]) => h('button', { type: 'button', dataset: { f }, 'aria-pressed': 'false' }, label)));
  const feed = h('section.vi-feed', { 'aria-live': 'polite' });
  root.replaceChildren(capture, filterBar, feed);

  let filter = 'all';
  try { filter = localStorage.getItem('planner.voice.filter') || 'all'; } catch {}
  const expanded = new Set(); // transcript ids shown in full
  const opened = new Set(); // ids whose Night Shift output is unfolded
  let rendered = false;
  let justAdded = null;

  const setNow = () => { const d = new Date(); now.textContent = `${dayLabel(d)} · ${timeLabel(d)}`; };
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
    const when = new Date();
    const item = { id: uid(), text: stamp(when), done: false, notes: body };
    let created = false;
    store.update((s) => {
      let l = voiceListOf(s);
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
    toast(created ? 'Saved. A Voice Inbox list was added to your board.' : `Saved for tonight · ${timeLabel(when)}`, { ms: 2200 });
  }
  saveBtn.addEventListener('click', save);

  // Dictation (Web Speech API, where the browser has it).
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let listening = false;
  if (!Recognition) {
    micBtn.classList.add('unsupported');
    hint.textContent = 'Type or paste a transcript (dictation needs Chrome or Safari). Stamped with the time when you save.';
  }
  function startListening() {
    if (!Recognition || listening) return;
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
      if (e.error === 'not-allowed') toast('Microphone access was refused. Type or paste a transcript instead.', { kind: 'warn' });
      stopListening();
    };
    rec.onend = () => { if (listening) { try { rec.start(); } catch { stopListening(); } } };
    try { rec.start(); } catch { return toast('Dictation could not start here.', { kind: 'warn' }); }
    listening = true;
    micBtn.setAttribute('aria-pressed', 'true');
    capture.classList.add('listening');
    live.hidden = false;
    hint.textContent = 'Listening… tap the mic again to stop, then save.';
    text.focus();
  }
  function stopListening() {
    listening = false;
    try { rec?.stop(); } catch {}
    micBtn.setAttribute('aria-pressed', 'false');
    capture.classList.remove('listening');
    live.hidden = true;
    hint.textContent = 'Stamped with the time when you save. The Night Shift runner picks it up tonight.';
    if (interim.textContent) { text.value = `${text.value.replace(/\s+$/, '')}${text.value.trim() ? ' ' : ''}${interim.textContent}`; interim.textContent = ''; }
    autosize();
  }
  micBtn.addEventListener('click', () => (listening ? stopListening() : startListening()));

  function setFilter(f) {
    filter = f;
    try { localStorage.setItem('planner.voice.filter', f); } catch {}
    const idx = ['all', 'new', 'done'].indexOf(f);
    ink.style.transform = `translateX(${idx * 100}%)`;
    for (const b of filterBar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.f === f));
    render();
  }
  filterBar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setFilter(b.dataset.f); });

  function card(e) {
    const long = e.transcript.length > 280 || e.transcript.split('\n').length > 4;
    const clamp = long && !expanded.has(e.id);
    return h(`article.vi-card${e.processed ? '.done' : ''}`, { dataset: { id: e.id } },
      h('div.vi-card-head',
        h('div.vi-time', e.when ? timeLabel(e.when) : 'Undated', e.when ? h('small', `${MON[e.when.getMonth()]} ${e.when.getDate()}`) : null),
        h(`span.vi-pill${e.processed ? '.done' : ''}`, svgOf(e.processed ? ICON.check : ICON.spark), e.processed ? `Processed ${fmtDate(e.processed)}` : 'Waiting for tonight'),
        h('button.vi-menu-btn', { type: 'button', 'aria-label': 'More', onclick: (ev) => cardMenu(ev.currentTarget, e) }, svgOf(ICON.dots)),
      ),
      h('div.vi-body',
        h(`p.vi-transcript${clamp ? '.clamp' : ''}`, e.transcript || h('span', { style: { color: 'var(--fg-faint)' } }, 'Empty note')),
        long ? h('button.vi-more', { type: 'button', onclick: () => { expanded.has(e.id) ? expanded.delete(e.id) : expanded.add(e.id); render(); } }, clamp ? 'Show more' : 'Show less') : null,
      ),
      e.output ? h('details.vi-fold', { open: opened.has(e.id), ontoggle: (ev) => (ev.target.open ? opened.add(e.id) : opened.delete(e.id)) },
        h('summary.vi-fold-btn', svgOf(ICON.moon), 'Night Shift output', svgOf(ICON.chev)),
        // The first line is the "## Processed <date>" heading, already shown in the pill.
        h('div.vi-fold-body', h('div', markdownEl(e.output.replace(/^## Processed [^\n]*\n?/, '')))),
      ) : null,
    );
  }

  function cardMenu(anchor, e) {
    menu(anchor, [
      { label: 'Copy transcript', onclick: () => navigator.clipboard?.writeText(e.transcript).then(() => toast('Copied', { ms: 1200 })) },
      e.output ? { label: 'Copy Night Shift output', onclick: () => navigator.clipboard?.writeText(e.output).then(() => toast('Copied', { ms: 1200 })) } : null,
      e.processed ? { label: 'Process again tonight', onclick: () => { store.update((s) => { const l = voiceListOf(s); const it = l.items.find((x) => x.id === e.id); setField(l, it, 'processed', null); }); toast('Back in tonight’s queue'); } } : null,
      'hr',
      { label: 'Delete note', danger: true, onclick: () => {
        store.update((s) => { const l = voiceListOf(s); l.items = l.items.filter((x) => x.id !== e.id); });
        toast('Note deleted', { action: 'Undo', onAction: () => store.undoLast() });
      } },
    ]);
  }

  function render() {
    const l = voiceListOf(store.state);
    const entries = (l ? l.items.map(entry) : []).sort((a, b) => (b.when?.getTime() || 0) - (a.when?.getTime() || 0));
    const fresh = entries.filter((e) => !e.processed).length;
    onStatus(l ? (fresh ? `${fresh} waiting for tonight · ${entries.length - fresh} processed` : entries.length ? `All ${entries.length} processed` : 'No notes yet') : 'No Voice Inbox list on the board yet');
    for (const b of filterBar.querySelectorAll('button')) {
      const n = b.dataset.f === 'all' ? entries.length : b.dataset.f === 'new' ? fresh : entries.length - fresh;
      const label = b.dataset.f === 'all' ? 'All' : b.dataset.f === 'new' ? 'New' : 'Processed';
      b.replaceChildren(...[label, n ? h('b', String(n)) : null].filter(Boolean));
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
        h('div.glyph', svgOf(ICON.mic)),
        h('strong', filter === 'done' ? 'Nothing processed yet' : filter === 'new' ? 'Nothing waiting' : 'No voice notes yet'),
        filter === 'all' ? 'Tap the mic or type above. Tonight the runner turns it into a diary entry, a plan and tasks.' : 'Switch to All to see everything.'));
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
    // FLIP: cards that stayed glide to their new place; new ones grow in.
    for (const el of feed.querySelectorAll('.vi-card[data-id]')) {
      const o = old.get(el.dataset.id);
      if (!o) {
        fx.growIn(el);
        if (el.dataset.id === justAdded) { el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 1200); justAdded = null; }
        continue;
      }
      const r = el.getBoundingClientRect();
      if (Math.abs(o.rect.top - r.top) > 1) fx.flipFrom(el, 0, o.rect.top - r.top);
      if (!o.el?.classList.contains('done') && el.classList.contains('done')) el.classList.add('just-done');
    }
  }

  const refresh = liveRender(root, render);
  setFilter(filter);
  return {
    render: refresh,
    focus: () => { text.focus(); },
    dictate: () => { if (Recognition) startListening(); else text.focus(); },
  };
}

// ---------- Morning Briefs ----------

const dateLabel = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return { big: iso, small: '' };
  const days = Math.round((new Date().setHours(12, 0, 0, 0) - d) / 86400000);
  return { big: days === 0 ? 'This morning' : days === 1 ? 'Yesterday' : `${DOW[d.getDay()]}`, small: `${DOW[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}` };
};

/** Builds the Morning Briefs reader into `root`: newest day first, its sections as folds. */
export function mountBriefs(root, { onStatus = () => {} } = {}) {
  const feed = h('section.vi-feed.br-feed', { 'aria-live': 'polite' });
  root.replaceChildren(feed);
  const closed = new Set(); // "date|section" folds the reader closed (or opened, for older days)
  let rendered = false;

  function dayCard(it, latest) {
    const date = it.text;
    const { big, small } = dateLabel(date);
    const secs = sections(it.notes);
    const words = (x) => x.split(/\s+/).filter(Boolean).length;
    return h('article.vi-card.br-card', { dataset: { id: it.id } },
      h('div.br-day', h('h2.br-date', big, h('small', small))),
      h('div.br-chips', secs.map((x) => h('span.br-chip', x.title))),
      secs.map((x) => {
        const key = `${date}|${x.title}`;
        return h('details.vi-fold.br-section', { open: latest ? !closed.has(key) : closed.has(`open:${key}`), ontoggle: (ev) => {
          if (latest) ev.target.open ? closed.delete(key) : closed.add(key);
          else ev.target.open ? closed.add(`open:${key}`) : closed.delete(`open:${key}`);
        } },
          h('summary.vi-fold-btn', x.title, h('span.n', `· ${words(x.body)} words`), svgOf(ICON.chev)),
          h('div.vi-fold-body', h('div', markdownEl(x.body, { questions: true }))),
        );
      }),
    );
  }

  function render() {
    const l = briefListOf(store.state);
    const days = briefDays(store.state);
    onStatus(l ? (days.length ? `${days.length} morning${days.length === 1 ? '' : 's'} · newest first` : 'No briefs yet') : 'No Morning Briefs list on the board yet');
    const nodes = days.map((it, i) => dayCard(it, i === 0));
    if (!nodes.length) nodes.push(h('div.vi-empty', h('strong', 'Nothing here yet'), 'The Night Shift runner writes a card here each morning: one section per job, plus any questions it had for you.'));
    feed.replaceChildren(...nodes);
    if (!rendered && !fx.reduced()) [...feed.children].forEach((el, i) => fx.play(el, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 80 + Math.min(i, 8) * 60, easing: fx.EASE_OUT, fill: 'backwards' }));
    rendered = true;
  }

  const refresh = liveRender(root, render);
  render();
  return { render: refresh };
}
