// Calendar data: iCal feeds (through the server's /api/ics proxy), Google Calendar (gcal.js) and
// the optional Canvas planner API. Also syncs Canvas assignments into the Canvas list and works
// out the daily workload used by the heatmap and "Plan my day".
import { parseIcs, expand, splitCanvasTitle } from './ics.js';
import { gcal } from './gcal.js';
import { store, uid, lists, scoped } from './store.js';

const ICS_API = document.querySelector('meta[name="planner-ics"]')?.content || '/api/ics';
const CANVAS_API = document.querySelector('meta[name="planner-canvas"]')?.content || '/api/canvas';
const CACHE_KEY = scoped('planner.events.v1');
const CANVAS_TOKEN_KEY = 'planner.canvasToken';

export const DAY = 86400000;
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const calendar = {
  events: [], // { id, summary, start, end, allDay, color, source, feedId?, url? }
  errors: {}, // feedId|'google'|'canvas-api' -> message
  lastSync: 0,
  syncing: false,
  listeners: new Set(),

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
  emit() {
    for (const fn of this.listeners) fn(this);
  },

  restoreCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c) {
        this.events = c.events.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
        this.lastSync = c.at;
      }
    } catch {}
  },

  async sync({ silent = false } = {}) {
    if (this.syncing) return;
    this.syncing = true;
    this.emit();
    const s = store.state.settings;
    const from = addDays(startOfDay(new Date()), -45);
    const to = addDays(startOfDay(new Date()), 120);
    const errors = {};
    const events = [];

    await Promise.all(
      s.feeds.filter((f) => f.on !== false && f.url).map(async (f) => {
        try {
          const r = await fetch(`${ICS_API}?url=${encodeURIComponent(f.url)}`, { credentials: 'same-origin' });
          if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
          const raw = parseIcs(await r.text());
          for (const e of expand(raw, from, to)) {
            events.push({ id: `${f.id}:${e.id}`, uid: e.uid, summary: e.summary || '(busy)', description: e.description, location: e.location, url: e.url, start: e.start, end: e.end, allDay: e.allDay, color: f.color, source: f.kind, feedId: f.id });
          }
        } catch (e) {
          errors[f.id] = e.message;
        }
      }),
    );

    if (s.googleClientId && s.googleCalendars.length && gcal.connected) {
      try {
        const colors = Object.fromEntries((s.googleCalendarMeta || []).map((c) => [c.id, c.color]));
        events.push(...(await gcal.events(s.googleCalendars, from, to, colors)));
      } catch (e) {
        errors.google = e.message;
      }
    }

    let canvasApi = null;
    if (s.canvasHost && canvasToken()) {
      try {
        canvasApi = await fetchCanvasPlanner(s.canvasHost, from, to);
      } catch (e) {
        errors['canvas-api'] = e.message;
      }
    }

    // Time blocks already pushed to Google come back as events: show them once, as blocks.
    this.events = events.filter((e) => !e.planner).sort((a, b) => a.start - b.start);
    this.errors = errors;
    this.lastSync = Date.now();
    this.syncing = false;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: this.lastSync, events: this.events }));
    } catch {}
    importCanvas(this.events.filter((e) => e.source === 'canvas'), canvasApi);
    this.emit();
    if (!silent && Object.keys(errors).length) document.dispatchEvent(new CustomEvent('planner:toast', { detail: { text: `Some calendars didn't load: ${Object.values(errors)[0]}`, kind: 'warn' } }));
  },

  /** Events (not all-day) and all-day events touching a day. */
  forDay(day) {
    const a = startOfDay(day).getTime();
    const b = a + DAY;
    return this.events.filter((e) => e.start.getTime() < b && e.end.getTime() > a);
  },
};

// ---------- Canvas ----------

export const canvasToken = () => {
  try {
    return localStorage.getItem(CANVAS_TOKEN_KEY) || '';
  } catch {
    return '';
  }
};
export const setCanvasToken = (t) => {
  try {
    t ? localStorage.setItem(CANVAS_TOKEN_KEY, t) : localStorage.removeItem(CANVAS_TOKEN_KEY);
  } catch {}
};

async function fetchCanvasPlanner(host, from, to) {
  const q = new URLSearchParams({ host, start_date: from.toISOString(), end_date: to.toISOString() });
  const r = await fetch(`${CANVAS_API}/planner?${q}`, { headers: { 'X-Canvas-Token': canvasToken() }, credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.text()) || `Canvas API HTTP ${r.status}`);
  return r.json();
}

/** Marks a Canvas planner item done/undone in Canvas itself (needs the API token). */
export async function markCanvasDone(item, done) {
  const s = store.state.settings;
  if (!s.canvasHost || !canvasToken() || !item.source?.plannable) return;
  await fetch(`${CANVAS_API}/override?host=${encodeURIComponent(s.canvasHost)}`, {
    method: 'POST',
    headers: { 'X-Canvas-Token': canvasToken(), 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ plannable_type: item.source.plannable.type, plannable_id: item.source.plannable.id, override_id: item.source.overrideId ?? null, marked_complete: done }),
  })
    .then(async (r) => {
      if (r.ok) {
        const o = await r.json().catch(() => null);
        if (o?.id) store.update((st) => {
          for (const l of lists(st)) for (const it of l.items) if (it.id === item.id) it.source.overrideId = o.id;
        }, { undoable: false });
      }
    })
    .catch(() => {});
}

/**
 * Adds new Canvas assignments to the Canvas list and keeps due dates current. Items the user
 * deleted or archived are remembered in `canvasSeen` so they don't come back.
 */
function importCanvas(feedEvents, apiItems) {
  const st = store.state;
  const target = lists(st).find((l) => l.source === 'canvas');
  if (!target) return;
  const incoming = [];
  const horizon = addDays(startOfDay(new Date()), -14);

  for (const e of feedEvents) {
    if (e.end < horizon) continue;
    const { title, course } = splitCanvasTitle(e.summary);
    // Canvas puts assignments in the feed as all-day or zero-length events at the due time.
    const due = e.allDay ? new Date(e.start.getFullYear(), e.start.getMonth(), e.start.getDate(), 23, 59) : e.start;
    incoming.push({ key: `ics:${e.uid}`, text: title, course, due, url: e.url, hasTime: !e.allDay });
  }
  for (const p of apiItems || []) {
    const due = p.plannable_date ? new Date(p.plannable_date) : null;
    if (due && due < horizon) continue;
    const key = `api:${p.plannable_type}:${p.plannable_id}`;
    incoming.push({
      key,
      text: p.plannable?.title || p.plannable?.name || 'Canvas item',
      course: p.context_name || '',
      due,
      url: p.html_url ? new URL(p.html_url, `https://${store.state.settings.canvasHost}`).href : null,
      hasTime: true,
      points: p.plannable?.points_possible ?? null,
      submitted: !!(p.submissions && (p.submissions.submitted || p.submissions.graded)),
      plannable: { type: p.plannable_type, id: p.plannable_id },
      overrideId: p.planner_override?.id ?? null,
      done: !!p.planner_override?.marked_complete,
    });
  }
  if (!incoming.length) return;

  store.update(
    (s) => {
      const t = lists(s).find((l) => l.source === 'canvas');
      s.canvasSeen ??= {};
      const byKey = new Map();
      for (const l of lists(s)) for (const it of l.items) if (it.source?.key) byKey.set(it.source.key, it);
      // The same assignment can come from both the feed and the API: match on title + due day too.
      const sig = (text, due) => `${text.toLowerCase()}|${due ? startOfDay(new Date(due)).getTime() : ''}`;
      const bySig = new Map();
      for (const l of lists(s)) for (const it of l.items) if (it.source?.type === 'canvas') bySig.set(sig(it.text, it.due), it);

      for (const inc of incoming) {
        const existing = byKey.get(inc.key) || bySig.get(sig(inc.text, inc.due));
        if (existing) {
          if (inc.due && existing.due !== inc.due.toISOString() && !existing.dueEdited) existing.due = inc.due.toISOString();
          if (inc.plannable && !existing.source.plannable) Object.assign(existing.source, { plannable: inc.plannable, overrideId: inc.overrideId });
          if ((inc.submitted || inc.done) && !existing.done) existing.done = true;
          if (inc.points != null) existing.points = inc.points;
          continue;
        }
        if (s.canvasSeen[inc.key] || inc.submitted || inc.done) continue;
        s.canvasSeen[inc.key] = 1;
        // Slot new assignments in by due date without reordering what's already there.
        const at = t.items.findIndex((x) => !x.done && x.due && inc.due && Date.parse(x.due) > inc.due.getTime());
        t.items.splice(at < 0 ? t.items.length : at, 0, {
          id: uid(),
          text: inc.text,
          done: false,
          due: inc.due ? inc.due.toISOString() : null,
          hasTime: inc.hasTime,
          course: inc.course,
          url: inc.url,
          points: inc.points ?? null,
          source: { type: 'canvas', key: inc.key, plannable: inc.plannable, overrideId: inc.overrideId },
        });
      }
    },
    { undoable: false },
  );
}

// ---------- Workload ----------

const hours = (ms) => ms / 3600000;

/**
 * Workload for one day:
 *   events   hours of timed calendar events inside working hours
 *   blocks   hours of planner time blocks
 *   tasks    estimated hours of open tasks due that day that aren't time-blocked
 *   free     focus hours left = min(capacity, working hours - events) - blocks
 *   level    0..4 for the heatmap
 */
export function workload(day) {
  const s = store.state;
  const { capacity, workStart, workEnd } = s.settings;
  const d0 = startOfDay(day);
  const ws = d0.getTime() + workStart * 3600000;
  const we = d0.getTime() + workEnd * 3600000;
  let ev = 0;
  for (const e of calendar.forDay(day)) {
    if (e.allDay || e.source === 'canvas') continue;
    ev += Math.max(0, Math.min(e.end.getTime(), we) - Math.max(e.start.getTime(), ws));
  }
  let bl = 0;
  const blocked = new Set();
  for (const b of s.blocks) {
    const bs = Date.parse(b.start);
    const be = Date.parse(b.end);
    if (sameDay(new Date(bs), d0)) {
      bl += be - bs;
      if (b.itemId) blocked.add(b.itemId);
    }
  }
  let tk = 0;
  const due = [];
  for (const l of lists(s)) {
    for (const it of l.items) {
      if (it.done || !it.due || !sameDay(new Date(it.due), d0)) continue;
      due.push({ item: it, list: l });
      if (!blocked.has(it.id)) tk += (it.est ?? defaultEstimate(it)) * 60000;
    }
  }
  const events = hours(ev);
  const blocks = hours(bl);
  const tasks = hours(tk);
  const room = Math.max(0, Math.min(capacity, workEnd - workStart - events));
  const free = room - blocks;
  const busy = events + blocks + tasks;
  const ratio = (blocks + tasks) / Math.max(0.5, room) * 0.7 + events / Math.max(1, workEnd - workStart) * 0.6;
  const level = busy === 0 ? 0 : ratio < 0.35 ? 1 : ratio < 0.7 ? 2 : ratio < 1 ? 3 : 4;
  return { events, blocks, tasks, free, room, busy, level, over: blocks + tasks > room + 0.01, due };
}

/** Rough default: Canvas items by points, everything else 30 minutes. */
export function defaultEstimate(it) {
  if (it.source?.type === 'canvas') return it.points >= 50 ? 180 : it.points >= 10 ? 90 : 60;
  return 30;
}
