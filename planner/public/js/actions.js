// Actions shared by the whiteboard and the side panel.
import { store, uid, findItem, findCard, lists, listByTag, COLORS } from './store.js';
import { nextDue } from './parse.js';
import { calendar, markCanvasDone, defaultEstimate, startOfDay, sameDay } from './feeds.js';
import { gcal } from './gcal.js';
import { h, toast, popover, closeFloats, fmtDue, fmtTime, toLocalInput, fmtEst } from './ui.js';

// ---------- Items ----------

export function toggleItem(id) {
  const f = findItem(store.state, id);
  if (!f) return;
  const it = f.item;
  if (!it.done && it.repeat && it.due) {
    const next = nextDue(new Date(it.due), it.repeat);
    store.update((s) => {
      const x = findItem(s, id).item;
      s.archive.unshift({ ...structuredClone(x), id: uid(), done: true, doneAt: Date.now(), listTitle: f.list.title, repeat: null });
      x.due = next.toISOString();
      for (const t of x.sub || []) t.done = false;
    });
    toast(`Done. Next one: ${fmtDue(next.toISOString(), it.hasTime).label}`, { action: 'Undo', onAction: () => store.undoLast() });
    return;
  }
  const done = !it.done;
  store.update((s) => {
    const x = findItem(s, id).item;
    x.done = done;
    x.doneAt = done ? Date.now() : null;
  });
  if (it.source?.type === 'canvas') markCanvasDone(findItem(store.state, id).item, done);
  if (done) toast(`Completed “${truncate(it.text, 40)}”`, { action: 'Undo', onAction: () => store.undoLast(), ms: 3500 });
}

export function deleteItem(id) {
  const f = findItem(store.state, id);
  if (!f) return;
  store.update((s) => {
    const l = findCard(s, f.list.id);
    l.items = l.items.filter((x) => x.id !== id);
    s.blocks = s.blocks.filter((b) => b.itemId !== id);
  });
  for (const b of store.state.blocks) if (b.itemId === id) removeBlockRemote(b);
  toast('Task deleted', { action: 'Undo', onAction: () => store.undoLast() });
}

/** Adds a parsed quick-add result. A #tag that matches no list creates one. Returns the list id. */
export function addParsed(p, fallbackListId) {
  if (!p.text) return null;
  let list = listByTag(store.state, p.list) || (fallbackListId && findCard(store.state, fallbackListId)) || lists(store.state)[0];
  let createdList = null;
  if (p.list && !listByTag(store.state, p.list)) {
    const title = p.list.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
    createdList = { id: uid(), kind: 'list', title, color: COLORS[lists(store.state).length % COLORS.length], ...freeSpot(), w: 300, h: 0, items: [] };
    list = createdList;
  }
  const item = {
    id: uid(),
    text: p.text,
    done: false,
    due: p.due ? p.due.toISOString() : null,
    hasTime: p.hasTime,
    est: p.est,
    priority: p.priority || 0,
    repeat: p.repeat,
  };
  store.update((s) => {
    if (createdList) s.cards.push(createdList);
    const l = findCard(s, list.id);
    l.items.push(item);
  });
  return list.id;
}

/** A free place on the board to the right of everything. */
export function freeSpot() {
  const cs = store.state.cards;
  if (!cs.length) return { x: 80, y: 80 };
  const right = Math.max(...cs.map((c) => c.x + (c.w || 300)));
  const top = Math.min(...cs.map((c) => c.y));
  return { x: Math.round((right + 40) / 10) * 10, y: top };
}

const truncate = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

// ---------- Item details ----------

const EST = [null, 15, 30, 45, 60, 90, 120, 180, 240, 360, 480];
const PRI = [['0', 'None'], ['1', 'Low'], ['2', 'Medium'], ['3', 'High']];
const REP = [['', 'Doesn’t repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['monthly', 'Every month']];

export function openDetails(anchor, id) {
  const f = findItem(store.state, id);
  if (!f) return;
  const set = (patch) => store.update((s) => Object.assign(findItem(s, id).item, patch));
  const it = f.item;

  const sel = (opts, value, onchange) =>
    h('select.input', { onchange }, opts.map(([v, l]) => h('option', { value: v, selected: String(value ?? '') === v }, l)));

  const subWrap = h('div.subtasks');
  const renderSubs = () => {
    const cur = findItem(store.state, id)?.item;
    subWrap.replaceChildren(
      ...(cur?.sub || []).map((t) =>
        h(`div.st${t.done ? '.done' : ''}`,
          h('input.check', { type: 'checkbox', checked: t.done, style: { '--c': f.list.color }, onchange: (e) => { store.update((s) => (findItem(s, id).item.sub.find((x) => x.id === t.id).done = e.target.checked)); renderSubs(); } }),
          h('input', { type: 'text', value: t.text, onchange: (e) => store.update((s) => (findItem(s, id).item.sub.find((x) => x.id === t.id).text = e.target.value)) }),
          h('button.icon-btn', { 'aria-label': 'Remove step', onclick: () => { store.update((s) => { const x = findItem(s, id).item; x.sub = x.sub.filter((y) => y.id !== t.id); }); renderSubs(); } }, '×'),
        ),
      ),
    );
  };
  renderSubs();

  const content = h('div',
    h('div.field', h('input.input.title-input', { value: it.text, 'aria-label': 'Task', onchange: (e) => e.target.value.trim() && set({ text: e.target.value.trim() }) })),
    h('div.grid2',
      h('div.field', h('label', 'Due'), h('input.input', { type: 'datetime-local', value: toLocalInput(it.due), onchange: (e) => set({ due: e.target.value ? new Date(e.target.value).toISOString() : null, hasTime: true, dueEdited: true }) })),
      h('div.field', h('label', 'Estimate'), sel(EST.map((m) => [m == null ? '' : String(m), m == null ? `Auto (${fmtEst(defaultEstimate(it))})` : fmtEst(m)]), it.est ?? '', (e) => set({ est: e.target.value ? Number(e.target.value) : null }))),
      h('div.field', h('label', 'Priority'), sel(PRI, it.priority || 0, (e) => set({ priority: Number(e.target.value) }))),
      h('div.field', h('label', 'Repeat'), sel(REP, it.repeat || '', (e) => set({ repeat: e.target.value || null }))),
    ),
    h('div.grid2',
      h('div.field', h('label', 'Course / tag'), h('input.input', { value: it.course || '', onchange: (e) => set({ course: e.target.value.trim() }) })),
      h('div.field', h('label', 'List'), sel(lists(store.state).map((l) => [l.id, l.title]), f.list.id, (e) => moveItem(id, e.target.value, Infinity))),
    ),
    h('div.field', h('label', 'Link'), h('input.input', { type: 'url', value: it.url || '', placeholder: 'https://', onchange: (e) => set({ url: e.target.value.trim() || null }) })),
    h('div.field', h('span.label', 'Steps'), subWrap,
      h('input.input', { placeholder: 'Add a step and press Enter', onkeydown: (e) => {
        if (e.key !== 'Enter' || !e.target.value.trim()) return;
        const text = e.target.value.trim();
        e.target.value = '';
        store.update((s) => { const x = findItem(s, id).item; (x.sub ??= []).push({ id: uid(), text, done: false }); });
        renderSubs();
      } })),
    h('div.field', h('label', 'Notes'), h('textarea.input', { value: it.notes || '', rows: 3, onchange: (e) => set({ notes: e.target.value }) })),
    it.spent ? h('p.small.muted', `Focused ${fmtEst(Math.round(it.spent))} on this so far.`) : null,
    h('div.pop-foot',
      h('button.btn.small.danger', { onclick: () => { closeFloats(); deleteItem(id); } }, 'Delete'),
      h('div.inline',
        h('button.btn.small', { onclick: () => { closeFloats(); scheduleNext(id); } }, 'Block time today'),
        h('button.btn.small', { onclick: () => { closeFloats(); startFocus(id); } }, 'Focus'),
      ),
    ),
  );
  popover(anchor, content);
}

export function moveItem(id, toListId, index) {
  store.update((s) => {
    const f = findItem(s, id);
    if (!f) return;
    f.list.items.splice(f.index, 1);
    const to = findCard(s, toListId);
    let i = Math.min(index, to.items.length);
    if (f.list.id === toListId && f.index < index) i = Math.min(index - 1, to.items.length);
    to.items.splice(Math.max(0, i), 0, f.item);
  });
}

// ---------- Time blocks ----------

const settings = () => store.state.settings;

export function createBlock(itemId, start, end, title) {
  const it = itemId ? findItem(store.state, itemId)?.item : null;
  const block = { id: uid(), itemId, title: title || it?.text || 'Focus', start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  store.update((s) => s.blocks.push(block));
  const cal = settings().pushCalendar;
  if (cal && gcal.connected) {
    gcal.insertBlock(cal, { title: block.title, start, end, blockId: block.id })
      .then((ev) => store.update((s) => { const b = s.blocks.find((x) => x.id === block.id); if (b) Object.assign(b, { gcalId: ev.id, gcalCal: cal }); }, { undoable: false }))
      .catch((e) => toast(`Not added to Google Calendar: ${e.message}`, { kind: 'warn' }));
  }
  return block;
}

export function updateBlock(id, patch) {
  store.update((s) => Object.assign(s.blocks.find((b) => b.id === id), patch));
  const b = store.state.blocks.find((x) => x.id === id);
  if (b?.gcalId && gcal.connected) gcal.moveBlock(b.gcalCal, b.gcalId, b).catch((e) => toast(`Google Calendar not updated: ${e.message}`, { kind: 'warn' }));
}

export function deleteBlock(id) {
  const b = store.state.blocks.find((x) => x.id === id);
  store.update((s) => (s.blocks = s.blocks.filter((x) => x.id !== id)));
  if (b) removeBlockRemote(b);
}

function removeBlockRemote(b) {
  if (b.gcalId && gcal.connected) gcal.deleteBlock(b.gcalCal, b.gcalId).catch(() => {});
}

/** Busy intervals for a day: calendar events + existing blocks, as [startMs, endMs]. */
function busy(day) {
  const out = [];
  for (const e of calendar.forDay(day)) if (!e.allDay && e.source !== 'canvas') out.push([e.start.getTime(), e.end.getTime()]);
  for (const b of store.state.blocks) if (sameDay(new Date(b.start), day)) out.push([Date.parse(b.start), Date.parse(b.end)]);
  return out.sort((a, b) => a[0] - b[0]);
}

/** First free slot of `minutes` on `day`, from now (rounded up to 15 min) or the start of the work day. */
export function findSlot(day, minutes) {
  const { workStart, workEnd } = settings();
  const d0 = startOfDay(day).getTime();
  const q = 15 * 60000;
  let t = Math.max(d0 + workStart * 3600000, Math.ceil(Date.now() / q) * q);
  const end = d0 + workEnd * 3600000;
  const len = minutes * 60000;
  for (const [bs, be] of busy(day)) {
    if (bs - t >= len) break;
    if (be > t) t = Math.ceil(be / q) * q;
  }
  return t + len <= end ? new Date(t) : null;
}

export function scheduleNext(id, day = new Date(), { quiet = false } = {}) {
  const it = findItem(store.state, id)?.item;
  if (!it) return null;
  const minutes = it.est ?? defaultEstimate(it);
  const start = findSlot(day, minutes);
  if (!start) {
    if (!quiet) toast(`No free ${fmtEst(minutes)} slot left on that day`, { kind: 'warn' });
    return null;
  }
  const b = createBlock(id, start, new Date(start.getTime() + minutes * 60000));
  if (!quiet) toast(`Blocked ${fmtTime(start)}–${fmtTime(new Date(Date.parse(b.end)))} for “${truncate(it.text, 32)}”`, { action: 'Undo', onAction: () => deleteBlock(b.id) });
  return b;
}

// ---------- Focus timer ----------

const timer = { itemId: null, mode: 'focus', endsAt: 0, left: 0, paused: false, tick: null, startedAt: 0 };
const FOCUS = 25;
const BREAK = 5;

export function startFocus(id) {
  stopFocus(true);
  Object.assign(timer, { itemId: id, mode: 'focus', endsAt: Date.now() + FOCUS * 60000, paused: false, startedAt: Date.now() });
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  timer.tick = setInterval(renderTimer, 500);
  renderTimer();
}

function logFocus() {
  if (timer.mode !== 'focus' || !timer.itemId || timer.paused) return;
  const min = (Date.now() - timer.startedAt) / 60000;
  if (min < 0.5) return;
  store.update((s) => { const f = findItem(s, timer.itemId); if (f) f.item.spent = (f.item.spent || 0) + min; }, { undoable: false });
}

function stopFocus(silent) {
  if (!timer.tick) return;
  logFocus();
  clearInterval(timer.tick);
  timer.tick = null;
  document.getElementById('timer').hidden = true;
  if (!silent) document.title = 'Planner';
}

function renderTimer() {
  const el = document.getElementById('timer');
  const left = timer.paused ? timer.left : timer.endsAt - Date.now();
  if (left <= 0) {
    const wasFocus = timer.mode === 'focus';
    logFocus();
    notify(wasFocus ? 'Focus session done — take 5.' : 'Break over. Back to it?');
    timer.mode = wasFocus ? 'break' : 'focus';
    timer.endsAt = Date.now() + (wasFocus ? BREAK : FOCUS) * 60000;
    timer.startedAt = Date.now();
    return renderTimer();
  }
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const t = `${m}:${String(s).padStart(2, '0')}`;
  const it = findItem(store.state, timer.itemId)?.item;
  document.title = `${t} · ${timer.mode === 'focus' ? it?.text ?? 'Focus' : 'Break'}`;
  el.className = `timer${timer.mode === 'break' ? ' break' : ''}`;
  el.replaceChildren(
    h('span.t', t),
    h('span.what', timer.mode === 'focus' ? it?.text ?? 'Focus' : 'Break'),
    h('button.btn.small', { onclick: () => {
      if (timer.paused) { timer.endsAt = Date.now() + timer.left; timer.startedAt = Date.now(); timer.paused = false; }
      else { logFocus(); timer.left = timer.endsAt - Date.now(); timer.paused = true; }
      renderTimer();
    } }, timer.paused ? 'Resume' : 'Pause'),
    h('button.btn.small', { onclick: () => stopFocus() }, 'Stop'),
  );
  el.hidden = false;
}

export function notify(text) {
  toast(text);
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('Planner', { body: text, silent: false });
    } catch {}
  }
}
