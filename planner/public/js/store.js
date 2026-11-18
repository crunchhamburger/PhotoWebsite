// Board state, persistence and undo.
// The board is one JSON document. It is saved to localStorage on every change and, debounced,
// to the server (PUT /api/state), which writes planner/data/board.json locally or private
// storage on the website. Secrets (Canvas token, Google access token) never go in the board.

import { mergeBoards, sameContent } from './merge.js';
import { refreshPreset, reconcileDone } from './fields.js';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const API = document.querySelector('meta[name="planner-api"]')?.content || '/api/state';
// The Mac app runs several planners side by side: each keeps its own browser copy.
export const PLANNER_ID = document.querySelector('meta[name="planner-id"]')?.content || '';
export const DESKTOP = !!window.plannerDesktop && !!PLANNER_ID;
export const scoped = (key) => (PLANNER_ID ? `${key}:${PLANNER_ID}` : key);
const LOCAL_KEY = scoped('planner.board.v1');
// The website keeps a version of the board (X-Board-Version). The last copy this device saw from
// the server is the "base" that edits from other devices (the Mac app, another phone) merge against.
const BASE_KEY = scoped('planner.base.v1');

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

const readBase = () => {
  try { return JSON.parse(localStorage.getItem(BASE_KEY) || 'null'); } catch { return null; }
};

export const store = {
  state: null,
  // { version, board } — the server's copy as of the last load/save (website only).
  base: null,
  listeners: new Set(),
  undo: [],
  redo: [],
  saveTimer: null,
  dirty: false,
  serverOk: false,

  async load() {
    let server = null;
    let version = null;
    try {
      const r = await fetch(API, { cache: 'no-store', credentials: 'same-origin' });
      if (r.status === 200) server = await r.json();
      version = r.headers.get('x-board-version');
      this.serverOk = r.ok;
    } catch {}
    let local = null;
    try {
      local = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    } catch {}
    const base = readBase();
    let pick;
    if (version && server && local && base?.board) {
      // Edits made here while offline merge with whatever changed on the server meanwhile.
      pick = base.version === version ? local : mergeBoards(base.board, local, server);
    } else {
      // Whichever copy was edited last wins (e.g. edits made while the server was down).
      pick = [server, local].filter(Boolean).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    }
    if (version && server) this.setBase(version, server);
    this.state = migrate(pick || seed());
    if (version && server && !sameContent(this.state, server)) this.persist();
    this.emit();
  },

  setBase(version, board) {
    this.base = { version, board: structuredClone(board) };
    try { localStorage.setItem(BASE_KEY, JSON.stringify(this.base)); } catch {}
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

  /**
   * Picks up changes saved elsewhere: another window of this planner (Mac app), or on the website
   * another device or the Mac app's sync (merged with anything not yet saved here).
   */
  async pull() {
    if (this.dirty && !this.base) return;
    try {
      const r = await fetch(API, { cache: 'no-store', credentials: 'same-origin' });
      if (r.status !== 200 || !this.state) return;
      const version = r.headers.get('x-board-version');
      if (version && this.base?.version === version) return; // nothing new
      const next = await r.json();
      if (version && this.base) {
        const merged = migrate(mergeBoards(this.base.board, this.state, next));
        this.setBase(version, next);
        if (sameContent(merged, this.state)) return;
        this.state = merged;
        try { localStorage.setItem(LOCAL_KEY, JSON.stringify(this.state)); } catch {}
        if (!sameContent(merged, next)) this.persist(); // local edits still need saving
        this.emit();
        return;
      }
      if (this.dirty || (next.updatedAt || 0) <= (this.state.updatedAt || 0)) return;
      this.state = migrate(next);
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(this.state)); } catch {}
      this.emit();
    } catch {}
  },

  async flush(attempt = 0) {
    clearTimeout(this.saveTimer);
    this.dirty = false;
    const sent = JSON.stringify(this.state);
    try {
      const r = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(this.base?.version ? { 'X-Board-Base': this.base.version } : {}) },
        credentials: 'same-origin',
        body: sent,
        keepalive: sent.length < 60000,
      });
      const version = r.headers.get('x-board-version');
      if (r.status === 412 && version && attempt < 3) {
        // Someone else saved first (the Mac app, another device): merge and save again.
        const theirs = await r.json();
        const merged = migrate(mergeBoards(this.base?.board || null, this.state, theirs));
        this.setBase(version, theirs);
        this.state = merged;
        try { localStorage.setItem(LOCAL_KEY, JSON.stringify(this.state)); } catch {}
        this.emit();
        return this.flush(attempt + 1);
      }
      if (r.ok && version) this.setBase(version, JSON.parse(sent));
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

// Website: other devices' changes arrive when you come back to the app, and every minute.
if (!window.plannerDesktop) {
  const pullSoon = () => document.visibilityState === 'visible' && store.state && store.pull();
  document.addEventListener('visibilitychange', pullSoon);
  addEventListener('focus', pullSoon);
  addEventListener('online', () => store.state && (store.dirty ? store.flush() : store.pull()));
  setInterval(pullSoon, 60000);
}

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
  for (const c of s.cards) {
    if (c.kind !== 'list' || !c.preset) continue;
    refreshPreset(c);
    for (const it of c.items || []) reconcileDone(c, it);
  }
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
