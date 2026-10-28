// Board state, persistence and undo.
// The board is one JSON document. It is saved to localStorage on every change and, debounced,
// to the server (PUT /api/state), which writes planner/data/board.json locally or private
// storage on the website. Secrets (Canvas token, Google access token) never go in the board.

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const API = document.querySelector('meta[name="planner-api"]')?.content || '/api/state';
// The Mac app runs several planners side by side: each keeps its own browser copy.
export const PLANNER_ID = document.querySelector('meta[name="planner-id"]')?.content || '';
export const DESKTOP = !!window.plannerDesktop && !!PLANNER_ID;
export const scoped = (key) => (PLANNER_ID ? `${key}:${PLANNER_ID}` : key);
const LOCAL_KEY = scoped('planner.board.v1');

export const COLORS = ['#d8ff5a', '#7cc7ff', '#ff9e7a', '#c79bff', '#5ee0b0', '#ffd166', '#ff7ab6', '#a3a19c'];

function seed() {
  const list = (title, color, x, y, items = []) => ({
    id: uid(), kind: 'list', title, color, x, y, w: 300, h: 0, collapsed: false,
    items: items.map((text) => ({ id: uid(), text, done: false })),
  });
  const canvas = list('Canvas school work', COLORS[1], 80, 80, []);
  canvas.source = 'canvas';
  return {
    version: 1,
    cards: [
      canvas,
      list('Research', COLORS[3], 420, 80, ['Pick 3 papers to read this week', 'Draft literature notes']),
      list('Hobbies', COLORS[2], 760, 80, ['Edit last shoot', 'Plan a weekend photo walk']),
      list('Long term', COLORS[4], 1100, 80, ['Summer internship applications', 'Grad school shortlist']),
      { id: uid(), kind: 'note', text: 'Tip: press N or ⌘K to quick-add.\n"hw3 fri 5pm #canvas ~2h !high"', color: COLORS[5], x: 1440, y: 80, w: 240, h: 130 },
    ],
    links: [],
    archive: [],
    blocks: [], // time blocks: { id, itemId, title, start, end, gcalId? }
    view: { x: 0, y: 0, zoom: 1 },
    settings: {
      capacity: 6, // focus hours available per day
      workStart: 8,
      workEnd: 22,
      feeds: [], // { id, name, url, kind: 'google'|'canvas'|'other', color, on }
      googleClientId: '',
      googleCalendars: [], // ids chosen to read
      canvasHost: '',
      theme: 'dark',
    },
    updatedAt: Date.now(),
  };
}

export const store = {
  state: null,
  listeners: new Set(),
  undo: [],
  redo: [],
  saveTimer: null,
  dirty: false,
  serverOk: false,

  async load() {
    let server = null;
    try {
      const r = await fetch(API, { cache: 'no-store', credentials: 'same-origin' });
      if (r.status === 200) server = await r.json();
      this.serverOk = r.ok;
    } catch {}
    let local = null;
    try {
      local = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    } catch {}
    // Whichever copy was edited last wins (e.g. edits made while the server was down).
    const pick = [server, local].filter(Boolean).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    this.state = migrate(pick || seed());
    this.emit();
  },

  /** Applies a change. `fn` mutates a draft; the previous state is kept for undo. */
  update(fn, { undoable = true, quiet = false } = {}) {
    const before = JSON.stringify(this.state);
    fn(this.state);
    if (undoable) {
      this.undo.push(before);
      if (this.undo.length > 100) this.undo.shift();
      this.redo.length = 0;
    }
    this.state.updatedAt = Date.now();
    this.persist();
    if (!quiet) this.emit();
  },

  undoLast() {
    const prev = this.undo.pop();
    if (!prev) return false;
    this.redo.push(JSON.stringify(this.state));
    this.state = JSON.parse(prev);
    this.state.updatedAt = Date.now();
    this.persist();
    this.emit();
    return true;
  },

  redoLast() {
    const next = this.redo.pop();
    if (!next) return false;
    this.undo.push(JSON.stringify(this.state));
    this.state = JSON.parse(next);
    this.state.updatedAt = Date.now();
    this.persist();
    this.emit();
    return true;
  },

  persist() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.state));
    } catch {}
    clearTimeout(this.saveTimer);
    this.dirty = true;
    this.saveTimer = setTimeout(() => this.flush(), DESKTOP ? 250 : 600);
  },

  /** Takes the saved copy if it's newer (another window of this planner changed it). */
  async pull() {
    if (this.dirty) return;
    try {
      const r = await fetch(API, { cache: 'no-store' });
      if (r.status !== 200) return;
      const next = await r.json();
      if (this.dirty || !this.state || (next.updatedAt || 0) <= (this.state.updatedAt || 0)) return;
      this.state = migrate(next);
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(this.state)); } catch {}
      this.emit();
    } catch {}
  },

  async flush() {
    clearTimeout(this.saveTimer);
    this.dirty = false;
    try {
      const r = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(this.state),
        keepalive: true,
      });
      this.serverOk = r.ok;
    } catch {
      this.serverOk = false;
    }
    document.dispatchEvent(new CustomEvent('planner:saved', { detail: { ok: this.serverOk } }));
  },

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
  emit() {
    for (const fn of this.listeners) fn(this.state);
  },

  replace(next) {
    this.update((s) => {
      for (const k of Object.keys(s)) delete s[k];
      Object.assign(s, migrate(next));
    });
  },
};

window.plannerDesktop?.onPlannerChanged((id, updatedAt) => {
  if (id === PLANNER_ID && store.state && updatedAt > (store.state.updatedAt || 0)) store.pull();
});

function migrate(s) {
  const base = seed();
  s.settings = { ...base.settings, ...(s.settings || {}) };
  s.cards ??= [];
  s.links ??= [];
  s.archive ??= [];
  s.blocks ??= [];
  s.view ??= base.view;
  return s;
}

// ---------- Queries over the board ----------

export const lists = (s) => s.cards.filter((c) => c.kind === 'list');

/** Every item with its list, including sub-items. */
export function allItems(s) {
  const out = [];
  for (const l of lists(s)) for (const it of l.items) out.push({ item: it, list: l });
  return out;
}

export function findItem(s, id) {
  for (const l of lists(s)) {
    const i = l.items.findIndex((it) => it.id === id);
    if (i >= 0) return { list: l, item: l.items[i], index: i };
  }
  return null;
}

export const findCard = (s, id) => s.cards.find((c) => c.id === id);

/** Finds a list by a quick-add tag: "#canvas" matches "Canvas school work", "#long-term" matches "Long term". */
export function listByTag(s, tag) {
  if (!tag) return null;
  const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const t = norm(tag);
  const ls = lists(s);
  return ls.find((l) => norm(l.title) === t) || ls.find((l) => norm(l.title).startsWith(t)) || ls.find((l) => norm(l.title).includes(t)) || null;
}
