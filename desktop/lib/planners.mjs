// The planner library: every planner is one board JSON file in <dir>/boards/<id>.json, and
// <dir>/planners.json lists them (name, dates, archived). Files are written atomically, so a crash
// mid-save never leaves a half-written board. Plain Node, no Electron, so it can be tested.
import { readFile, writeFile, rename, mkdir, readdir, rm, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const ID = /^[a-z0-9]{6,32}$/;
export const validId = (id) => typeof id === 'string' && ID.test(id);
const newId = () => randomBytes(6).toString('hex');

async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Counts for the library cards: lists, open/done tasks, and a tiny map of the board. */
export function summarize(board) {
  const cards = Array.isArray(board?.cards) ? board.cards : [];
  const lists = cards.filter((c) => c.kind === 'list');
  let open = 0;
  let done = 0;
  for (const l of lists) for (const it of l.items || []) it.done ? done++ : open++;
  return {
    lists: lists.length,
    notes: cards.length - lists.length,
    open,
    done: done + (Array.isArray(board?.archive) ? board.archive.length : 0),
    listTitles: lists.slice(0, 6).map((l) => l.title),
    // Card rectangles (board coordinates) for the preview thumbnail.
    map: cards.slice(0, 40).map((c) => ({ x: c.x || 0, y: c.y || 0, w: c.w || 300, h: c.h || Math.min(420, 90 + (c.items?.length || 0) * 34), color: c.color || '#a3a19c', kind: c.kind })),
  };
}

/** A new board with the same lists as `from` and, if `carry`, its unfinished tasks. */
export function carryOver(from, { carry = true } = {}) {
  const uid = () => randomBytes(5).toString('hex');
  const cards = (from?.cards || [])
    .filter((c) => c.kind === 'list')
    .map((l) => ({
      ...l,
      id: uid(),
      items: carry ? (l.items || []).filter((it) => !it.done).map((it) => ({ ...it, id: uid() })) : [],
    }));
  return {
    version: 1,
    cards,
    links: [],
    archive: [],
    blocks: [],
    view: from?.view || { x: 0, y: 0, zoom: 1 },
    settings: from?.settings || {},
    updatedAt: Date.now(),
  };
}

export function createLibrary(dir) {
  const boards = join(dir, 'boards');
  const indexFile = join(dir, 'planners.json');
  let queue = Promise.resolve();
  // Index writes are serialized so two quick changes can't interleave.
  const serial = (fn) => (queue = queue.then(fn, fn));

  async function index() {
    const list = await readJSON(indexFile, []);
    return Array.isArray(list) ? list.filter((p) => validId(p?.id)) : [];
  }
  const saveIndex = (list) => writeAtomic(indexFile, JSON.stringify(list, null, 2));
  const boardFile = (id) => {
    if (!validId(id)) throw Object.assign(new Error('bad planner id'), { status: 400 });
    return join(boards, `${id}.json`);
  };

  const lib = {
    dir,
    async init() {
      await mkdir(boards, { recursive: true });
    },

    /** All planners, most recently opened first, each with a summary of its board. */
    async list() {
      const list = await index();
      const out = [];
      for (const p of list) out.push({ ...p, summary: summarize(await readJSON(boardFile(p.id), null)) });
      return out.sort((a, b) => (b.openedAt || b.updatedAt || 0) - (a.openedAt || a.updatedAt || 0));
    },

    async get(id) {
      return (await index()).find((p) => p.id === id) || null;
    },

    /**
     * Creates a planner. `start`: 'starter' (the default lists), 'blank', or { from: id, carry }
     * to reuse another planner's lists (and its unfinished tasks).
     */
    create(name, start = 'starter') {
      return serial(async () => {
        const list = await index();
        const id = newId();
        const now = Date.now();
        const entry = { id, name: String(name || '').trim().slice(0, 80) || 'Untitled planner', createdAt: now, updatedAt: now, openedAt: now, archived: false };
        if (start === 'blank') await writeAtomic(boardFile(id), JSON.stringify({ version: 1, cards: [], updatedAt: now }));
        else if (start && typeof start === 'object' && validId(start.from)) {
          const from = await readJSON(boardFile(start.from), null);
          if (from) await writeAtomic(boardFile(id), JSON.stringify(carryOver(from, { carry: start.carry !== false })));
        }
        // 'starter': no file yet; the app seeds its default lists on first open.
        list.push(entry);
        await saveIndex(list);
        return entry;
      });
    },

    update(id, patch) {
      return serial(async () => {
        const list = await index();
        const p = list.find((x) => x.id === id);
        if (!p) return null;
        if (typeof patch.name === 'string') p.name = patch.name.trim().slice(0, 80) || p.name;
        if (typeof patch.archived === 'boolean') p.archived = patch.archived;
        if (typeof patch.openedAt === 'number') p.openedAt = patch.openedAt;
        if (typeof patch.updatedAt === 'number') p.updatedAt = patch.updatedAt;
        if (patch.bounds && typeof patch.bounds === 'object') p.bounds = patch.bounds;
        await saveIndex(list);
        return p;
      });
    },

    duplicate(id) {
      return serial(async () => {
        const list = await index();
        const src = list.find((x) => x.id === id);
        if (!src) return null;
        const copy = { ...src, id: newId(), name: `${src.name} copy`.slice(0, 80), createdAt: Date.now(), updatedAt: Date.now(), openedAt: Date.now(), archived: false };
        delete copy.bounds;
        try { await copyFile(boardFile(id), boardFile(copy.id)); } catch {}
        list.push(copy);
        await saveIndex(list);
        return copy;
      });
    },

    /** Removes a planner from the library. `trash(file)` moves its board file somewhere recoverable. */
    remove(id, trash) {
      return serial(async () => {
        const list = await index();
        if (!list.some((x) => x.id === id)) return false;
        const file = boardFile(id);
        try { await (trash ? trash(file) : rm(file)); } catch {}
        await saveIndex(list.filter((x) => x.id !== id));
        return true;
      });
    },

    /** The board JSON text, or null if it hasn't been saved yet. */
    async readBoard(id) {
      try {
        return await readFile(boardFile(id), 'utf8');
      } catch {
        return null;
      }
    },

    async writeBoard(id, text) {
      const file = boardFile(id);
      const board = JSON.parse(text); // reject anything that isn't JSON
      if (!(await lib.get(id))) throw Object.assign(new Error('no such planner'), { status: 404 });
      await writeAtomic(file, text);
      await lib.update(id, { updatedAt: Number(board.updatedAt) || Date.now() });
      return board;
    },

    /** Planners on disk that the index lost track of (e.g. after a crash) are listed again. */
    async recover() {
      const list = await index();
      const known = new Set(list.map((p) => p.id));
      let files = [];
      try { files = await readdir(boards); } catch {}
      const lost = files.filter((f) => f.endsWith('.json') && !known.has(f.slice(0, -5)) && validId(f.slice(0, -5)));
      if (!lost.length) return 0;
      await serial(async () => {
        const now = Date.now();
        const l = await index();
        for (const f of lost) l.push({ id: f.slice(0, -5), name: 'Recovered planner', createdAt: now, updatedAt: now, openedAt: 0, archived: false });
        await saveIndex(l);
      });
      return lost.length;
    },
  };
  return lib;
}
