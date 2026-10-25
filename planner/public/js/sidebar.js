// Side panel: Today (plan my day), Calendar (workload heatmap + day timeline), Settings.
import { store, uid, lists, findItem, COLORS } from './store.js';
import { calendar, workload, defaultEstimate, canvasToken, setCanvasToken, startOfDay, addDays, sameDay } from './feeds.js';
import { gcal } from './gcal.js';
import { h, fill, svg, ICONS, fmtDue, fmtDay, fmtMonth, fmtHours, fmtTime, fmtEst, toast } from './ui.js';
import { toggleItem, openDetails, scheduleNext, createBlock, updateBlock, deleteBlock } from './actions.js';
import { dragItemId, reveal } from './board.js';
import * as fx from './motion.js';

const panes = { today: document.getElementById('pane-today'), calendar: document.getElementById('pane-calendar'), settings: document.getElementById('pane-settings') };
const TABS = ['today', 'calendar', 'settings'];
let tab = 'today';
let month = startOfDay(new Date());
month.setDate(1);
let selected = startOfDay(new Date());
const HOUR_PX = 44;
let fresh = true; // next render of the pane is a fresh entrance (tab switch), not an update
let monthDir = 0; // -1/1 when the month just changed, 2 for a fresh calendar
let meterPrev = null;

export function showTab(name) {
  const dir = Math.sign(TABS.indexOf(name) - TABS.indexOf(tab));
  const changed = name !== tab;
  tab = name;
  for (const b of document.querySelectorAll('.tabs [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const [k, el] of Object.entries(panes)) el.hidden = k !== name;
  document.body.classList.remove('side-closed');
  moveInk();
  fresh = true;
  if (name === 'calendar') monthDir = 2;
  if (name === 'today') meterPrev = null;
  renderSide();
  if (changed) fx.play(panes[name], [{ opacity: 0, transform: `translateX(${dir * 18}px)` }, { opacity: 1, transform: 'none' }], { duration: 380, easing: fx.EASE_OUT });
}

/** The sliding underline under the active tab. */
export function moveInk() {
  const nav = document.querySelector('.tabs');
  const on = nav.querySelector('[aria-selected="true"]');
  let ink = nav.querySelector('.tab-ink');
  if (!ink) nav.append((ink = h('span.tab-ink')));
  if (!on) return;
  ink.style.left = on.offsetLeft + 'px';
  ink.style.width = on.offsetWidth + 'px';
}

export function renderSide() {
  const pane = panes[tab];
  // Preserve a focused field (typing a feed URL while a sync finishes, for instance).
  const ae = document.activeElement;
  const keep = ae && pane.contains(ae) && ae.dataset.keep ? { key: ae.dataset.keep, value: ae.value } : null;
  const scroll = pane.scrollTop;
  const before = fresh || daySwitch || monthDir || fx.reduced() ? null : fx.snapshot(pane, '[data-key]', 'data-key');
  if (tab === 'today') renderToday(pane);
  else if (tab === 'calendar') renderCalendar(pane);
  else renderSettings(pane);
  pane.scrollTop = scroll;
  if (keep) {
    const el = pane.querySelector(`[data-keep="${keep.key}"]`);
    if (el) { el.value = keep.value; el.focus(); }
  }
  if (fresh) staggerIn(pane);
  else if (before) morph(pane, before);
  animateMeter(pane);
  fresh = false;
}

/** Meter segments grow from their previous widths; the meter shakes when you tip into overcommitted. */
function animateMeter(pane) {
  const m = pane.querySelector('.meter[data-meter]');
  if (!m) return;
  const spans = [...m.querySelectorAll('.meter-bar span')];
  const now = { widths: spans.map((s) => s.style.width), over: m.classList.contains('over') };
  const prev = meterPrev ?? { widths: spans.map(() => '0%'), over: false };
  spans.forEach((s, i) => {
    if (prev.widths[i] !== now.widths[i]) fx.play(s, [{ width: prev.widths[i] }, { width: now.widths[i] }], { duration: 900, delay: meterPrev ? 0 : 250 + i * 90, easing: fx.EASE_OUT, fill: 'backwards' });
  });
  if (now.over && !prev.over) {
    fx.play(m, [{ transform: 'none' }, { transform: 'translateX(-7px) rotate(-.6deg)' }, { transform: 'translateX(6px) rotate(.5deg)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(2px)' }, { transform: 'none' }], { duration: 520, delay: meterPrev ? 0 : 600, easing: 'ease-out' });
  }
  meterPrev = now;
}

/** Rows cascade in when a tab opens. */
function staggerIn(pane) {
  [...pane.querySelectorAll('[data-key], h3, .meter')].slice(0, 30).forEach((el, i) =>
    fx.play(el, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 60 + i * 28, easing: fx.EASE_OUT, fill: 'backwards' }));
}

/** On updates: rows that moved slide, new rows grow in, removed rows slide out to the right. */
function morph(pane, before) {
  const now = new Map([...pane.querySelectorAll('[data-key]')].map((el) => [el.dataset.key, el]));
  let n = 0;
  for (const [key, info] of before) {
    if (now.has(key)) continue;
    const next = info.next && now.get(info.next);
    if (next) fx.collapseSpace(next.parentElement, next, info.rect.height);
    fx.exit(info, { to: 'translateX(40px)' });
  }
  for (const [key, el] of now) {
    if (before.has(key)) continue;
    if (el.classList.contains('blk')) fx.popIn(el, { delay: n++ * 60, from: 0.7 });
    else fx.growIn(el, { delay: n++ * 40 });
  }
  const moves = [];
  for (const [key, el] of now) {
    const old = before.get(key);
    if (!old) continue;
    const r = el.getBoundingClientRect();
    moves.push([el, old.rect.left - r.left, old.rect.top - r.top]);
  }
  for (const [el, dx, dy] of moves) fx.flipFrom(el, dx, dy, { timing: fx.SPRING });
}

// ---------- Shared rows ----------

function taskRow({ item, list }, { showList = true } = {}) {
  const due = fmtDue(item.due, item.hasTime !== false);
  const blk = store.state.blocks.find((b) => b.itemId === item.id && Date.parse(b.end) > Date.now());
  const meta = [
    showList ? h('span', h('span.dot', { style: { '--c': list.color } }), list.title) : null,
    due ? h('span', { style: { color: due.status === 'overdue' ? 'var(--danger)' : due.status === 'today' ? 'var(--warn)' : '' } }, ` · ${due.label}`) : null,
    ` · ~${fmtEst(item.est ?? defaultEstimate(item))}`,
    blk ? h('span', { style: { color: 'var(--accent)' } }, ` · blocked ${fmtTime(new Date(blk.start))}`) : null,
    item.course ? ` · ${item.course}` : null,
  ];
  return h(`div.row${item.done ? '.done' : ''}`, { dataset: { key: item.id }, draggable: true, ondragstart: (e) => { e.dataTransfer.setData('application/x-planner-item', item.id); setSideDrag(item.id); }, ondragend: () => setSideDrag(null) },
    h('input.check', { type: 'checkbox', checked: item.done, style: { '--c': list.color }, 'aria-label': 'Done', onchange: (e) => toggleItem(item.id, e.currentTarget) }),
    h('div', h('div.title', { style: { cursor: 'pointer' }, onclick: () => reveal(list.id) }, item.priority ? h('span', { style: { color: ['', '#7cc7ff', 'var(--warn)', 'var(--danger)'][item.priority] } }, '!'.repeat(item.priority) + ' ') : null, item.text), h('div.sub', meta)),
    h('div.row-actions',
      blk ? null : h('button.icon-btn', { title: 'Block time today', 'aria-label': 'Block time today', onclick: () => scheduleNext(item.id) }, svg(ICONS.cal)),
      h('button.icon-btn', { title: 'Details', 'aria-label': 'Details', onclick: (e) => openDetails(e.currentTarget, item.id) }, svg(ICONS.dots)),
    ),
  );
}

// Items dragged from the side panel (not the board) also need to drop on the timeline.
let sideDrag = null;
const setSideDrag = (id) => (sideDrag = id);
const draggingId = () => dragItemId || sideDrag;

function openItems() {
  const out = [];
  for (const l of lists(store.state)) for (const it of l.items) if (!it.done) out.push({ item: it, list: l });
  return out;
}

const byDue = (a, b) => Date.parse(a.item.due) - Date.parse(b.item.due) || (b.item.priority || 0) - (a.item.priority || 0);

// ---------- Today ----------

function meter(day) {
  const w = workload(day);
  const total = Math.max(w.room + w.events, w.events + w.blocks + w.tasks, 1);
  const pct = (v) => `${(v / total) * 100}%`;
  return h(`div.meter${w.over ? '.over' : ''}`, { dataset: { meter: '1' } },
    h('div.inline', { style: { justifyContent: 'space-between' } },
      h('strong', w.over ? 'Overcommitted' : w.busy === 0 ? 'Wide open' : w.level >= 3 ? 'Busy day' : 'Manageable'),
      h('span.small.muted', `${fmtHours(Math.max(0, w.free - w.tasks))} free focus time`),
    ),
    h('div.meter-bar', h('span.m-ev', { style: { width: pct(w.events) } }), h('span.m-bl', { style: { width: pct(w.blocks) } }), h('span.m-tk', { style: { width: pct(w.tasks) } })),
    h('div.meter-legend',
      h('span', h('i', { style: { background: '#7cc7ff' } }), `Classes & events ${fmtHours(w.events)}`),
      h('span', h('i', { style: { background: 'var(--accent)' } }), `Time blocked ${fmtHours(w.blocks)}`),
      h('span', h('i', { style: { background: 'color-mix(in srgb, var(--accent) 45%, var(--bg-elev2))' } }), `Unscheduled due ${fmtHours(w.tasks)}`),
    ),
    w.over ? h('div.over-msg', `${fmtHours(w.blocks + w.tasks)} of work vs ${fmtHours(w.room)} you have room for (capacity ${store.state.settings.capacity}h). Push something to tomorrow or lower estimates.`) : null,
  );
}

function renderToday(pane) {
  const now = new Date();
  const today = startOfDay(now);
  const items = openItems().filter((x) => x.item.due);
  const overdue = items.filter((x) => new Date(x.item.due) < now && !sameDay(new Date(x.item.due), today)).sort(byDue);
  const dueToday = items.filter((x) => sameDay(new Date(x.item.due), today)).sort(byDue);
  const blockedToday = store.state.blocks.filter((b) => sameDay(new Date(b.start), today)).map((b) => b.itemId);
  const listed = new Set([...overdue, ...dueToday].map((x) => x.item.id));
  const blockedOnly = openItems().filter((x) => blockedToday.includes(x.item.id) && !listed.has(x.item.id));
  const week = items.filter((x) => { const d = new Date(x.item.due); return d > addDays(today, 1) - 1 && d < addDays(today, 8); }).sort(byDue);
  const unblocked = [...overdue, ...dueToday].filter((x) => !store.state.blocks.some((b) => b.itemId === x.item.id && Date.parse(b.end) > Date.now()));

  const agenda = [
    ...calendar.forDay(today).filter((e) => !e.allDay && e.source !== 'canvas').map((e) => ({ start: e.start, end: e.end, title: e.summary, color: e.color || '#7cc7ff' })),
    ...store.state.blocks.filter((b) => sameDay(new Date(b.start), today)).map((b) => ({ start: new Date(b.start), end: new Date(b.end), title: b.title, color: 'var(--accent)', block: true })),
  ].sort((a, b) => a.start - b.start);

  fill(pane, 
    h('div.inline', { style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
      h('div', h('h2', 'Plan my day'), h('div.muted.small', fmtDay(now))),
      syncButton(),
    ),
    meter(today),
    unblocked.length ? h('div.inline', { style: { marginTop: '10px', gap: '6px' } },
      h('button.btn.small', { onclick: () => {
        let n = 0;
        for (const x of unblocked.sort((a, b) => (b.item.priority || 0) - (a.item.priority || 0))) if (scheduleNext(x.item.id, today, { quiet: true })) n++;
        toast(n ? `Blocked time for ${n} task${n > 1 ? 's' : ''} today` : 'No free slots left today', { action: n ? 'Undo' : null, onAction: () => { for (let i = 0; i < n; i++) store.undoLast(); }, kind: n ? '' : 'warn' });
      } }, `Auto-schedule ${unblocked.length} task${unblocked.length > 1 ? 's' : ''} into free time`),
    ) : null,
    section('Overdue', overdue),
    section('Due today', dueToday, 'Nothing due today.'),
    blockedOnly.length ? section('Also blocked today', blockedOnly) : null,
    agenda.length ? h('h3', 'Schedule', h('span.count', agenda.length)) : null,
    ...agenda.map((a) => h('div.row', { dataset: { key: `ag:${a.start.getTime()}:${a.title}` }, style: { gridTemplateColumns: '64px 1fr' } },
      h('span.small.muted', fmtTime(a.start)),
      h('div', h('div.title', h('span', { style: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: a.color, marginRight: '7px' } }), a.title), h('div.sub', `${fmtTime(a.start)}–${fmtTime(a.end)}${a.block ? ' · time block' : ''}`)),
    )),
    section('Next 7 days', week, 'Nothing due this week.'),
    noFeedsHint(),
  );
}

function section(title, rows, empty) {
  if (!rows.length && !empty) return null;
  return h('div', h('h3', title, h('span.count', rows.length || '')), rows.length ? rows.map((r) => taskRow(r)) : h('p.small.faint', empty));
}

function noFeedsHint() {
  const s = store.state.settings;
  if (s.feeds.length || s.googleClientId) return null;
  return h('div.meter', { style: { marginTop: '22px' } },
    h('strong', 'Connect your calendars'),
    h('p.small.muted', { style: { margin: '6px 0 10px' } }, 'Add your Canvas feed and Google Calendar so classes, meetings and assignments count toward your workload.'),
    h('button.btn.small', { onclick: () => showTab('settings') }, 'Open settings'),
  );
}

function syncButton() {
  const age = calendar.lastSync ? Math.round((Date.now() - calendar.lastSync) / 60000) : null;
  return h('button.btn.small.ghost', { title: 'Refresh calendars', onclick: () => calendar.sync() },
    svg(ICONS.sync), calendar.syncing ? 'Syncing…' : age == null ? 'Sync' : age < 1 ? 'Just now' : `${age}m ago`);
}

// ---------- Calendar ----------

function renderCalendar(pane) {
  const first = new Date(month);
  const start = addDays(first, -first.getDay());
  const today = startOfDay(new Date());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i === 35 && d.getMonth() !== month.getMonth()) break;
    const w = workload(d);
    const evCount = calendar.forDay(d).filter((e) => e.source !== 'canvas').length;
    const pips = [];
    for (let k = 0; k < Math.min(3, evCount); k++) pips.push(h('i'));
    if (w.due.length) pips.push(h('i.due'));
    const cls = ['day', d.getMonth() !== month.getMonth() && 'other', sameDay(d, today) && 'today', sameDay(d, selected) && 'sel', w.level && `l${w.level}`].filter(Boolean).join('.');
    const cell = h(`button.${cls}`, {
      title: `${fmtDay(d)}: ${fmtHours(w.events)} events, ${fmtHours(w.blocks)} blocked, ${w.due.length} due (${fmtHours(w.tasks)} est.)`,
      onclick: () => { selected = d; daySwitch = true; renderSide(); },
      ondragover: (e) => { if (draggingId()) { e.preventDefault(); cell.classList.add('drop'); } },
      ondragleave: () => cell.classList.remove('drop'),
      ondrop: (e) => {
        e.preventDefault();
        const id = draggingId();
        if (!id) return;
        const it = findItem(store.state, id)?.item;
        const prev = it?.due ? new Date(it.due) : null;
        const due = new Date(d.getFullYear(), d.getMonth(), d.getDate(), prev && it.hasTime ? prev.getHours() : 23, prev && it.hasTime ? prev.getMinutes() : 59);
        store.update((s) => Object.assign(findItem(s, id).item, { due: due.toISOString(), dueEdited: true }));
        toast(`Due ${fmtDue(due.toISOString(), it.hasTime).label}`, { action: 'Undo', onAction: () => store.undoLast() });
      },
    }, h('span', d.getDate()), h('span.pips', pips));
    cells.push(cell);
  }

  fill(pane, 
    h('div.month-head',
      h('h2', fmtMonth(month)),
      h('div.inline', { style: { gap: '2px' } },
        syncButton(),
        h('button.icon-btn', { 'aria-label': 'Previous month', onclick: () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); monthDir = -1; renderSide(); } }, '‹'),
        h('button.btn.small.ghost', { onclick: () => { month = startOfDay(new Date()); month.setDate(1); selected = startOfDay(new Date()); monthDir = 2; renderSide(); } }, 'Today'),
        h('button.icon-btn', { 'aria-label': 'Next month', onclick: () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); monthDir = 1; renderSide(); } }, '›'),
      ),
    ),
    h('div.month', ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => h('div.dow', d)), cells),
    h('div.heat-legend', 'Light', h('span'), h('span.l1'), h('span.l2'), h('span.l3'), h('span.l4'), 'Heavy'),
    dayView(selected),
  );

  // Month change / fresh open: the heatmap washes in as a diagonal wave.
  if (monthDir) {
    const days = [...pane.querySelectorAll('.month .day')];
    days.forEach((el, i) => {
      const wave = (i % 7) + Math.floor(i / 7);
      const dx = monthDir === 2 ? 0 : monthDir * 22;
      fx.play(el, [{ opacity: 0, transform: `translate(${dx}px, ${monthDir === 2 ? 10 : 0}px) scale(.6)` }, { opacity: 1, transform: 'none' }], { ...fx.SPRING, delay: wave * 28, fill: 'backwards' });
    });
    if (monthDir !== 2) fx.play(pane.querySelector('.month-head h2'), [{ opacity: 0, transform: `translateX(${monthDir * 16}px)` }, { opacity: 1, transform: 'none' }], { duration: 380, easing: fx.EASE_OUT });
    monthDir = 0;
  }
  if (daySwitch) {
    daySwitch = false;
    fx.play(pane.querySelector('.day.sel'), [{ transform: 'scale(.82)' }, { transform: 'none' }], fx.SPRING_BOUNCY);
    fx.play(pane.querySelector('.day-view'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: fx.EASE_OUT });
  }
}

let daySwitch = false;

function dayView(day) {
  const { workStart, workEnd } = store.state.settings;
  const d0 = startOfDay(day).getTime();
  const top = (t) => ((t - d0) / 3600000 - workStart) * HOUR_PX;
  const evs = calendar.forDay(day);
  const allDay = evs.filter((e) => e.allDay || e.source === 'canvas');
  const timed = evs.filter((e) => !e.allDay && e.source !== 'canvas');
  const w = workload(day);

  const tl = h('div.timeline', { style: { '--hh': HOUR_PX + 'px', height: (workEnd - workStart) * HOUR_PX + 'px' } });
  for (let hr = workStart; hr < workEnd; hr++) tl.append(h('div.hour', h('b', fmtTime(new Date(2000, 0, 1, hr)))));

  // Overlapping events share the width.
  const cols = layoutColumns(timed);
  for (const e of timed) {
    const s = Math.max(e.start.getTime(), d0 + workStart * 3600000);
    const en = Math.min(e.end.getTime(), d0 + workEnd * 3600000);
    if (en <= s) continue;
    const { col, of } = cols.get(e);
    tl.append(h('div.ev', {
      style: { top: top(s) + 'px', height: Math.max(18, top(en) - top(s) - 2) + 'px', '--c': e.color || '#7cc7ff', left: `calc(4px + ${(col / of) * 100}%)`, width: `calc(${100 / of}% - 8px)`, right: 'auto' },
      title: `${e.summary}\n${fmtTime(e.start)}–${fmtTime(e.end)}${e.location ? '\n' + e.location : ''}`,
    }, e.summary, h('small', `${fmtTime(e.start)}–${fmtTime(e.end)}`)));
  }

  for (const b of store.state.blocks.filter((x) => sameDay(new Date(x.start), day))) {
    const s = Date.parse(b.start);
    const en = Date.parse(b.end);
    const it = b.itemId ? findItem(store.state, b.itemId)?.item : null;
    const el = h(`div.blk${it?.done ? '.done' : ''}`, { dataset: { key: b.id }, style: { top: top(s) + 'px', height: Math.max(18, top(en) - top(s) - 2) + 'px' }, title: 'Drag to move · drag the bottom edge to resize' },
      b.title, h('small', `${fmtTime(new Date(s))}–${fmtTime(new Date(en))}${b.gcalId ? ' · on Google' : ''}`),
      h('button.x', { 'aria-label': 'Remove block', onclick: (e) => { e.stopPropagation(); deleteBlock(b.id); toast('Time block removed', { action: 'Undo', onAction: () => store.undoLast() }); } }, '×'),
      h('div.grow'),
    );
    el.addEventListener('pointerdown', (e) => dragBlock(e, el, b, top));
    tl.append(el);
  }

  for (const { item } of w.due) {
    if (item.hasTime === false) continue;
    const t = Date.parse(item.due);
    if (t < d0 + workStart * 3600000 || t > d0 + workEnd * 3600000) continue;
    tl.append(h('div.due-mark', { style: { top: top(t) + 'px' } }, `due · ${item.text.slice(0, 24)}`));
  }

  if (sameDay(day, new Date())) {
    const t = Date.now();
    if (t > d0 + workStart * 3600000 && t < d0 + workEnd * 3600000) tl.append(h('div.now-line', { style: { top: top(t) + 'px' } }));
  }

  // Drop a task from the board or the Today list to block time for it.
  let ghost = null;
  const slotAt = (clientY) => {
    const r = tl.getBoundingClientRect();
    const hrs = workStart + (clientY - r.top) / HOUR_PX;
    return d0 + Math.round(hrs * 4) / 4 * 3600000;
  };
  tl.addEventListener('dragover', (e) => {
    const id = draggingId();
    if (!id) return;
    e.preventDefault();
    const it = findItem(store.state, id)?.item;
    const min = it?.est ?? defaultEstimate(it || {});
    const s = slotAt(e.clientY);
    ghost ??= tl.appendChild(h('div.drop-ghost'));
    ghost.style.top = top(s) + 'px';
    ghost.style.height = (min / 60) * HOUR_PX + 'px';
    ghost.textContent = `${fmtTime(new Date(s))} · ${fmtEst(min)}`;
  });
  tl.addEventListener('dragleave', (e) => { if (!tl.contains(e.relatedTarget)) { ghost?.remove(); ghost = null; } });
  tl.addEventListener('drop', (e) => {
    e.preventDefault();
    ghost?.remove();
    ghost = null;
    const id = draggingId();
    if (!id) return;
    const it = findItem(store.state, id)?.item;
    const min = it?.est ?? defaultEstimate(it || {});
    const s = slotAt(e.clientY);
    const b = createBlock(id, s, s + min * 60000);
    toast(`Blocked ${fmtTime(new Date(s))} for “${it.text.slice(0, 30)}”`, { action: 'Undo', onAction: () => deleteBlock(b.id) });
  });

  return h('div.day-view',
    h('h3', fmtDay(day), h('span.count', `${fmtHours(w.events + w.blocks)} scheduled · ${w.due.length} due`)),
    h('p.small.faint', { style: { margin: '-4px 0 10px' } }, 'Drag tasks here to block time. Drop them on a date above to change the due date.'),
    allDay.length ? h('div.allday', allDay.map((e) => h('div', { style: { '--c': e.color || '#ff9e7a' }, title: e.summary }, e.source === 'canvas' ? `📘 ${e.summary}` : e.summary))) : null,
    tl,
    w.due.length ? h('div', h('h3', 'Due this day'), w.due.map((x) => taskRow(x))) : null,
  );
}

function layoutColumns(events) {
  const out = new Map();
  let group = [];
  let groupEnd = 0;
  const flush = () => {
    const cols = [];
    for (const e of group) {
      let c = cols.findIndex((end) => end <= e.start.getTime());
      if (c < 0) c = cols.push(0) - 1;
      cols[c] = e.end.getTime();
      out.set(e, { col: c, of: 0 });
    }
    for (const e of group) out.get(e).of = cols.length;
    group = [];
  };
  for (const e of [...events].sort((a, b) => a.start - b.start)) {
    if (group.length && e.start.getTime() >= groupEnd) flush();
    group.push(e);
    groupEnd = Math.max(groupEnd, e.end.getTime());
  }
  flush();
  return out;
}

function dragBlock(e, el, b, top) {
  if (e.target.closest('.x')) return;
  e.preventDefault();
  const resize = e.target.classList.contains('grow');
  const sy = e.clientY;
  const s0 = Date.parse(b.start);
  const e0 = Date.parse(b.end);
  const q = 15 * 60000;
  let ns = s0, ne = e0, moved = false;
  el.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const dt = Math.round(((ev.clientY - sy) / HOUR_PX) * 4) * q;
    if (dt) moved = true;
    if (resize) ne = Math.max(s0 + q, e0 + dt);
    else { ns = s0 + dt; ne = e0 + dt; }
    el.style.top = top(ns) + 'px';
    el.style.height = Math.max(18, top(ne) - top(ns) - 2) + 'px';
    el.querySelector('small').textContent = `${fmtTime(new Date(ns))}–${fmtTime(new Date(ne))}`;
  };
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    if (moved) updateBlock(b.id, { start: new Date(ns).toISOString(), end: new Date(ne).toISOString() });
    else if (b.itemId && findItem(store.state, b.itemId)) openDetails(el, b.itemId);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
}

// ---------- Settings ----------

function renderSettings(pane) {
  const s = store.state.settings;
  const set = (patch, opts) => store.update((st) => Object.assign(st.settings, patch), opts);

  const feeds = s.feeds.map((f) =>
    h('div.feed', { dataset: { key: f.id } },
      h('button.swatch', { style: { '--c': f.color }, title: 'Change color', onclick: () => set({ feeds: s.feeds.map((x) => (x.id === f.id ? { ...x, color: COLORS[(COLORS.indexOf(x.color) + 1) % COLORS.length] } : x)) }) }),
      h('div',
        h('div.name', f.name, h('span.faint.small', ` · ${f.kind === 'canvas' ? 'Canvas' : f.kind === 'google' ? 'Google (read-only)' : 'iCal'}`)),
        calendar.errors[f.id] ? h('div.err', calendar.errors[f.id]) : h('div.small.faint', f.on === false ? 'Hidden' : `${calendar.events.filter((e) => e.feedId === f.id).length} events loaded`),
      ),
      h('div.inline', { style: { gap: '2px' } },
        h('button.btn.small.ghost', { onclick: () => { set({ feeds: s.feeds.map((x) => (x.id === f.id ? { ...x, on: x.on === false } : x)) }); calendar.sync({ silent: true }); } }, f.on === false ? 'Show' : 'Hide'),
        h('button.btn.small.ghost.danger', { onclick: () => { set({ feeds: s.feeds.filter((x) => x.id !== f.id) }); calendar.sync({ silent: true }); } }, 'Remove'),
      ),
    ),
  );

  const name = h('input.input', { placeholder: 'Name (e.g. Canvas, Classes)', dataset: { keep: 'feed-name' } });
  const url = h('input.input', { placeholder: 'https://…/feeds/calendars/user_….ics', dataset: { keep: 'feed-url' } });
  const kind = h('select.input', { style: { width: '120px', flex: 'none' } }, h('option', { value: 'canvas' }, 'Canvas'), h('option', { value: 'google' }, 'Google'), h('option', { value: 'other' }, 'Other iCal'));
  url.addEventListener('input', () => {
    if (/calendar\.google\.com/.test(url.value)) kind.value = 'google';
    else if (/feeds\/calendars/.test(url.value)) kind.value = 'canvas';
  });
  const addFeed = () => {
    const u = url.value.trim();
    if (!/^(https|webcal):\/\//i.test(u)) return toast('Paste the full https:// or webcal:// address', { kind: 'warn' });
    const k = kind.value;
    set({ feeds: [...s.feeds, { id: uid(), name: name.value.trim() || (k === 'canvas' ? 'Canvas' : k === 'google' ? 'Google Calendar' : 'Calendar'), url: u, kind: k, color: k === 'canvas' ? '#ff9e7a' : COLORS[(s.feeds.length + 1) % COLORS.length], on: true }] });
    name.value = '';
    url.value = '';
    calendar.sync();
  };

  fill(pane, 
    h('h2', 'Settings'),

    h('h3', 'Calendar feeds'),
    feeds.length ? feeds : h('p.small.faint', 'No feeds yet.'),
    h('div', { style: { marginTop: '10px', display: 'grid', gap: '8px' } }, name, h('div.inline', url, kind), h('button.btn.small', { onclick: addFeed, style: { justifySelf: 'start' } }, 'Add feed')),
    h('details.help-box',
      h('summary', 'Where do I find these links?'),
      h('div.help',
        h('strong', 'Canvas'),
        h('ol', h('li', 'Open Canvas → Calendar (left menu).'), h('li', 'Click “Calendar Feed” at the bottom right and copy the link.'), h('li', 'Paste it here with type Canvas. Assignments land in your “Canvas school work” list automatically.')),
        h('strong', 'Google Calendar (quick, read-only)'),
        h('ol', h('li', 'calendar.google.com → ⚙ Settings → pick a calendar under “Settings for my calendars”.'), h('li', 'Scroll to “Integrate calendar” → copy “Secret address in iCal format”.'), h('li', 'Paste it here with type Google. Repeat per calendar (e.g. classes, work).')),
        h('p', 'Feeds refresh every 15 minutes while the planner is open. Keep these links private: anyone with them can read the calendar.'),
      ),
    ),

    h('h3', 'Google Calendar: two-way'),
    h('p.help', 'Optional. Sign in with Google to read every calendar and have the time blocks you drag in show up in Google Calendar too.'),
    googleSection(s, set),

    h('h3', 'Canvas API (optional)'),
    h('p.help', 'The feed above is enough for most people. Adding a token also pulls in Canvas To Do items and marks things complete in Canvas when you check them off here.'),
    h('div.field', h('label', 'Canvas address'), h('input.input', { value: s.canvasHost, placeholder: 'school.instructure.com', dataset: { keep: 'canvas-host' }, onchange: (e) => set({ canvasHost: e.target.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') }) })),
    h('div.field', h('label', 'Access token (kept in this browser only)'),
      h('div.inline',
        h('input.input', { type: 'password', value: canvasToken(), placeholder: 'Canvas → Account → Settings → New access token', dataset: { keep: 'canvas-token' }, onchange: (e) => { setCanvasToken(e.target.value.trim()); calendar.sync(); } }),
        canvasToken() ? h('button.btn.small.ghost', { onclick: () => { setCanvasToken(''); renderSide(); } }, 'Forget') : null,
      ),
      calendar.errors['canvas-api'] ? h('div.small', { style: { color: 'var(--danger)' } }, calendar.errors['canvas-api']) : null,
    ),

    h('h3', 'Workload'),
    h('div.grid2', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' } },
      h('div.field', h('label', 'Focus hours / day'), h('input.input', { type: 'number', min: 1, max: 16, step: 0.5, value: s.capacity, onchange: (e) => set({ capacity: Math.max(1, Number(e.target.value) || 6) }) })),
      h('div.field', h('label', 'Day starts'), hourSelect(s.workStart, (v) => set({ workStart: Math.min(v, s.workEnd - 1) }))),
      h('div.field', h('label', 'Day ends'), hourSelect(s.workEnd, (v) => set({ workEnd: Math.max(v, s.workStart + 1) }))),
    ),
    h('p.help', 'The heatmap compares each day’s classes, time blocks and estimated work due against these hours. Items without an estimate count as 30 min (Canvas items: 1–3h by points).'),

    h('h3', 'Reminders'),
    h('div.inline',
      h('select.input', { style: { width: '170px', flex: 'none' }, onchange: (e) => set({ remindBefore: Number(e.target.value) }) },
        [[0, 'Off'], [15, '15 min before'], [60, '1 hour before'], [180, '3 hours before'], [1440, '1 day before']].map(([v, l]) => h('option', { value: v, selected: (s.remindBefore ?? 60) === v }, l))),
      'Notification' in window && Notification.permission !== 'granted'
        ? h('button.btn.small', { onclick: () => Notification.requestPermission().then(() => renderSide()) }, 'Allow notifications')
        : h('span.small.faint', 'Notifications on'),
    ),

    h('h3', 'Archive', h('span.count', store.state.archive.length || '')),
    store.state.archive.length
      ? h('div', store.state.archive.slice(0, 25).map((a) => h('div.archive-row', { dataset: { key: a.id } }, h('span', a.text, h('span.faint', ` · ${a.listTitle || ''}`)), h('button.btn.small.ghost', { onclick: () => restore(a.id) }, 'Restore'))),
          store.state.archive.length > 25 ? h('p.small.faint', `…and ${store.state.archive.length - 25} more`) : null)
      : h('p.small.faint', 'Completed tasks you archive (or finished repeating tasks) show up here.'),

    // On the website (served privately at /planner) there's a session to end.
    document.querySelector('meta[name="planner-hosted"]')
      ? h('div', h('h3', 'Account'),
          h('form', { method: 'post', action: '/planner/logout' }, h('button.btn.small', { type: 'submit' }, 'Sign out')))
      : null,
    h('h3', 'Backup'),
    h('div.inline', { style: { flexWrap: 'wrap' } },
      h('button.btn.small', { onclick: exportJson }, 'Export JSON'),
      h('label.btn.small', { style: { cursor: 'pointer' } }, 'Import JSON', h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: importJson })),
    ),
    h('p.help', store.serverOk ? 'Saved to the server and to this browser.' : 'Saved in this browser (server not reachable).'),

    h('h3', 'Keyboard'),
    h('div.kbd-list',
      h('kbd', 'N'), 'Quick add (also ⌘K)',
      h('kbd', '/'), 'Search',
      h('kbd', 'L'), 'New list in view',
      h('kbd', 'F'), 'Fit board to screen',
      h('kbd', '1 2 3'), 'Today / Calendar / Settings',
      h('kbd', '\\'), 'Toggle side panel',
      h('kbd', '⌘Z'), 'Undo (⇧⌘Z redo)',
      h('kbd', 'Space'), 'Hold + drag to pan over cards',
      h('kbd', 'Alt'), 'Drag without snapping',
    ),
  );
}

function googleSection(s, set) {
  const meta = s.googleCalendarMeta || [];
  const wrap = h('div');
  wrap.append(
    h('div.field', h('label', 'OAuth client ID'), h('input.input', { value: s.googleClientId, placeholder: '…apps.googleusercontent.com', dataset: { keep: 'g-client' }, onchange: (e) => set({ googleClientId: e.target.value.trim() }) })),
  );
  if (s.googleClientId) {
    if (!gcal.connected) {
      wrap.append(h('button.btn.small', { onclick: async () => {
        try {
          await gcal.connect(s.googleClientId);
          const cals = await gcal.calendars();
          set({ googleCalendarMeta: cals, googleCalendars: s.googleCalendars.length ? s.googleCalendars : cals.filter((c) => c.primary).map((c) => c.id), pushCalendar: s.pushCalendar || cals.find((c) => c.primary)?.id || '' });
          calendar.sync();
        } catch (e) {
          toast(e.message, { kind: 'warn' });
        }
      } }, meta.length ? 'Reconnect Google Calendar' : 'Connect Google Calendar'));
      if (meta.length) wrap.append(h('p.help', 'Google sign-ins last about an hour; reconnect to refresh events and sync blocks.'));
    } else {
      wrap.append(
        h('div.small.muted', { style: { marginBottom: '6px' } }, 'Show these calendars:'),
        ...meta.map((c) => h('label.cal-pick', h('input', { type: 'checkbox', checked: s.googleCalendars.includes(c.id), onchange: (e) => { set({ googleCalendars: e.target.checked ? [...s.googleCalendars, c.id] : s.googleCalendars.filter((x) => x !== c.id) }); calendar.sync({ silent: true }); } }), h('i', { style: { '--c': c.color } }), c.name)),
        h('div.field', { style: { marginTop: '8px' } }, h('label', 'Put time blocks on'), h('select.input', { onchange: (e) => set({ pushCalendar: e.target.value }) }, h('option', { value: '' }, 'Don’t add to Google'), meta.map((c) => h('option', { value: c.id, selected: s.pushCalendar === c.id }, c.name)))),
        h('button.btn.small.ghost', { onclick: () => { gcal.disconnect(); renderSide(); } }, 'Disconnect'),
      );
    }
  }
  wrap.append(h('details.help-box',
    h('summary', 'How to get a client ID (5 minutes, free)'),
    h('div.help', h('ol',
      h('li', 'Go to console.cloud.google.com → create a project (e.g. “Planner”).'),
      h('li', 'APIs & Services → Library → enable “Google Calendar API”.'),
      h('li', 'OAuth consent screen → External → fill the app name and your email → add yourself under Test users. Leave it in Testing.'),
      h('li', 'Credentials → Create credentials → OAuth client ID → Web application.'),
      h('li', h('span', 'Authorized JavaScript origins: add ', h('code', location.origin), ' (and later ', h('code', 'https://www.haozhewang.com'), ').')),
      h('li', 'Copy the client ID here and click Connect.'),
    ), h('p', 'The client ID is not a secret. Google tokens stay in this browser tab and expire after about an hour.')),
  ));
  return wrap;
}

function hourSelect(value, onchange) {
  return h('select.input', { onchange: (e) => onchange(Number(e.target.value)) },
    Array.from({ length: 25 }, (_, i) => h('option', { value: i, selected: i === value }, i === 24 ? '12am' : fmtTime(new Date(2000, 0, 1, i)))));
}

function restore(id) {
  store.update((s) => {
    const a = s.archive.find((x) => x.id === id);
    if (!a) return;
    s.archive = s.archive.filter((x) => x.id !== id);
    const l = lists(s).find((x) => x.id === a.listId) || lists(s).find((x) => x.title === a.listTitle) || lists(s)[0];
    const { listTitle, listId, ...item } = a;
    l.items.push({ ...item, done: false, doneAt: null });
  });
  toast('Restored');
}

function exportJson() {
  const blob = new Blob([JSON.stringify(store.state, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `planner-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.cards)) throw new Error('Not a planner backup');
    store.replace(data);
    toast('Board imported', { action: 'Undo', onAction: () => store.undoLast() });
  } catch (err) {
    toast(`Import failed: ${err.message}`, { kind: 'warn' });
  }
}
