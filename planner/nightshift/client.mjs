// The overnight runner's client for the planner board on the website.
//
// Every write is the same loop the Mac app uses: read the board and its version, change it, save
// with X-Board-Base naming that version. If the phone (or the Mac) saved in between, the website
// answers 412 with the current board; the change is then applied again on top of that fresh copy
// and saved again. Nothing stale is ever written back, because the change is re-done on the board
// as it is, not merged from an old snapshot.
//
// The runner may only touch lists that have card fields (the Night Shift lists); any change to an
// ordinary list, a note, a link, a time block or the settings is refused before it is sent.
//
// Plain Node, everything injectable (fetch, clock), so it can be tested against the real website
// handler without a network.
import { fieldsOf, setField, getField, applyPreset, refreshPreset, reconcileDone, FIELD_PRESETS } from '../public/js/fields.js';

export const DEFAULT_SITE = 'https://www.haozhewang.com';
const MAX_TRIES = 5;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Exchanges the planner password for a sync key (valid about a year). The password is not kept. */
export async function connect({ site = DEFAULT_SITE, password, fetch: fetchFn = fetch }) {
  const r = await fetchFn(`${site.replace(/\/+$/, '')}/planner/api/sync-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  if (r.status === 401) throw new Error('That password isn’t right.');
  if (!r.ok) throw new Error(`The website answered ${r.status} to the key exchange.`);
  const { key, expiresAt } = await r.json();
  return { key, expiresAt };
}

/**
 * Refuses a change that touches anything but lists with card fields. Both boards are compared card
 * by card; the rest of the board (links, blocks, archive, settings) must be identical. The one-time
 * seed may also add brand-new cards of any kind (the Rules note), never change existing ones.
 */
export function assertNightShiftOnly(before, after, { allowNewCards = false } = {}) {
  const b = new Map((before.cards || []).map((c) => [c.id, c]));
  const a = new Map((after.cards || []).map((c) => [c.id, c]));
  for (const id of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(id);
    const y = a.get(id);
    if (x && y && stable(x) === stable(y)) continue;
    if (!x && y && allowNewCards) continue;
    const card = y || x;
    if (card.kind !== 'list' || !fieldsOf(card).length) throw new Error(`refused: the runner may only change lists with card fields (tried “${card.title || card.text || id}”)`);
  }
  for (const k of ['links', 'blocks', 'archive', 'settings']) {
    if (stable(before[k] ?? null) !== stable(after[k] ?? null)) throw new Error(`refused: the runner may not change ${k}`);
  }
  if ((before.cards || []).map((c) => c.id).join() !== (after.cards || []).map((c) => c.id).join()) {
    // New Night Shift lists may be appended; existing cards keep their order.
    const kept = (after.cards || []).filter((c) => b.has(c.id)).map((c) => c.id).join();
    if (kept !== (before.cards || []).map((c) => c.id).join()) throw new Error('refused: the runner may not reorder or remove cards');
  }
}

export function createClient({ site = DEFAULT_SITE, key, fetch: fetchFn = fetch, now = () => Date.now(), log = () => {} }) {
  if (!key) throw new Error('No sync key. Run: node planner/nightshift.mjs connect');
  const api = `${site.replace(/\/+$/, '')}/planner/api/state`;
  const auth = { Authorization: `Bearer ${key}` };

  async function read() {
    const r = await fetchFn(api, { headers: auth, cache: 'no-store' });
    if (r.status === 401) throw new Error('The website no longer accepts this sync key. Run: node planner/nightshift.mjs connect');
    if (r.status === 204) return { board: null, version: null };
    if (r.status !== 200) throw new Error(`The website answered ${r.status}.`);
    return { board: await r.json(), version: r.headers.get('x-board-version') };
  }

  /**
   * Applies `mutate(board)` to the live board and saves it. `mutate` returns false for "nothing
   * to do" (then nothing is saved) or anything else as the result. Retried on 412.
   */
  async function commit(mutate, { allowNewCards = false } = {}) {
    for (let i = 0; i < MAX_TRIES; i++) {
      const { board, version } = await read();
      if (!board) throw new Error('The website has no board yet. Open the planner once first.');
      const next = structuredClone(board);
      // Field definitions follow the code's presets (the app does the same on load).
      for (const c of next.cards || []) {
        if (c.kind !== 'list' || !c.preset) continue;
        refreshPreset(c);
        for (const it of c.items || []) reconcileDone(c, it);
      }
      const result = await mutate(next);
      if (result === false) return { changed: false, result: false };
      assertNightShiftOnly(board, next, { allowNewCards });
      next.updatedAt = now();
      const w = await fetchFn(api, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json', ...(version ? { 'X-Board-Base': version } : {}) }, body: JSON.stringify(next) });
      if (w.status === 412) { log(`someone saved in between (try ${i + 1}); applying the change again`); continue; }
      if (!w.ok) throw new Error(`The website didn’t take the save (${w.status}).`);
      return { changed: true, result, version: w.headers.get('x-board-version') };
    }
    throw new Error(`Gave up after ${MAX_TRIES} tries: the board kept changing under the runner.`);
  }

  const lists = (board) => (board.cards || []).filter((c) => c.kind === 'list');
  const queueLists = (board) => lists(board).filter((l) => l.preset === 'night-queue');
  const listByTitle = (board, title) => lists(board).find((l) => l.title.trim().toLowerCase() === title.trim().toLowerCase() && fieldsOf(l).length) || null;
  const findItem = (board, id) => {
    for (const l of lists(board)) {
      const item = l.items.find((it) => it.id === id);
      if (item) return { list: l, item };
    }
    return null;
  };

  /** A card as a script wants to see it: flat fields, list name, and the task's own notes as `body`. */
  const view = (list, it) => ({
    id: it.id, job: it.text, list: list.title, done: !!it.done,
    ...Object.fromEntries(fieldsOf(list).map((f) => [f.key, getField(it, f.key) ?? null])),
    body: it.notes ?? null,
  });

  return {
    read,
    commit,

    /** Night Queue cards with a status (default Ready), oldest first as they sit in the list. */
    async queue({ status = 'Ready' } = {}) {
      const { board } = await read();
      if (!board) return [];
      return queueLists(board).flatMap((l) => l.items.filter((it) => !status || getField(it, 'status') === status).map((it) => view(l, it)));
    },

    async card(id) {
      const { board } = await read();
      const f = board && findItem(board, id);
      if (!f) throw new Error(`No card ${id}`);
      return view(f.list, f.item);
    },

    /** Sets fields on a Night Queue card: { status, result, notes, score, reviewMinutes, stuck, … }. */
    async patch(id, patch) {
      return commit((board) => {
        const f = findItem(board, id);
        if (!f) throw new Error(`No card ${id}`);
        if (f.list.preset !== 'night-queue') throw new Error(`“${f.item.text}” is not in a Night Queue list`);
        for (const [k, v] of Object.entries(patch)) {
          const r = setField(f.list, f.item, k, v);
          if (!r.ok) throw new Error(r.error);
        }
        return view(f.list, f.item);
      });
    },

    /**
     * Adds a section to the day's brief: Morning Briefs › YYYY-MM-DD › <title>. The day's card is
     * created on first use; the markdown goes under a "## <title>" heading in its notes.
     */
    async brief({ date = today(now()), title, markdown, list = 'Morning Briefs' }) {
      if (!title) throw new Error('A brief needs a title (e.g. Pre-market)');
      return commit((board) => {
        const l = listByTitle(board, list);
        if (!l) throw new Error(`No “${list}” list with card fields on the board. Seed it first.`);
        let it = l.items.find((x) => x.text === date);
        if (!it) {
          it = { id: uid(), text: date, done: false, fields: { date }, notes: '' };
          l.items.unshift(it); // newest day on top
        }
        const sep = it.notes && !it.notes.endsWith('\n') ? '\n\n' : it.notes ? '\n' : '';
        it.notes = `${it.notes || ''}${sep}## ${title}\n\n${String(markdown ?? '').trim()}\n`;
        const sections = (getField(it, 'sections') || '').split(/\s*·\s*/).filter(Boolean);
        if (!sections.includes(title)) sections.push(title);
        setField(l, it, 'sections', sections.join(' · '));
        return { id: it.id, date, title };
      });
    },

    /** Voice Inbox transcripts recorded in the last `hours` (by the Recorded field or a "YYYY-MM-DD HH:MM" title), unprocessed unless `all`. */
    async voice({ hours = 24, all = false, list = 'Voice Inbox' } = {}) {
      const { board } = await read();
      const l = board && listByTitle(board, list);
      if (!l) return [];
      const since = now() - hours * 3600000;
      return l.items
        .filter((it) => {
          if (!all && getField(it, 'processed')) return false;
          const when = recordedAt(it);
          return when == null ? false : when >= since;
        })
        .map((it) => ({ ...view(l, it), transcript: it.notes ?? '' }));
    },

    /** Appends the runner's output under a transcript as "Processed YYYY-MM-DD" and marks it processed. */
    async processed(id, { date = today(now()), markdown }) {
      return commit((board) => {
        const f = findItem(board, id);
        if (!f) throw new Error(`No transcript ${id}`);
        if (f.list.preset !== 'voice-inbox') throw new Error(`“${f.item.text}” is not in the Voice Inbox`);
        const it = f.item;
        it.notes = `${(it.notes || '').replace(/\s+$/, '')}\n\n## Processed ${date}\n\n${String(markdown ?? '').trim()}\n`;
        const r = setField(f.list, it, 'processed', date);
        if (!r.ok) throw new Error(r.error);
        return { id, date };
      });
    },

    /**
     * Creates the Night Shift lists, note and starter cards from a seed ({ cards: [...] }). Safe
     * to run again: lists are matched by title, tasks by text, and existing ones are left alone.
     * New cards are placed in a block to the right of everything already on the board.
     */
    async seed(spec) {
      return commit((board) => {
        const added = [];
        const cards = board.cards || (board.cards = []);
        let x = cards.length ? Math.max(...cards.map((c) => c.x + (c.w || 300))) + 60 : 80;
        const top = cards.length ? Math.min(...cards.map((c) => c.y)) : 80;
        let y = top;
        let col = 0;
        const place = (w) => {
          const at = { x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 };
          y += 420;
          if (++col % 2 === 0) { y = top; x += w + 40; }
          return at;
        };
        for (const c of spec.cards || []) {
          if (c.kind === 'note') {
            const key = (t) => String(t || '').trim().toLowerCase();
            const existing = cards.find((k) => k.kind === 'note' && key(k.text).split('\n')[0] === key(c.text).split('\n')[0]);
            if (existing) continue;
            cards.push({ id: uid(), kind: 'note', text: c.text, color: c.color || '#ffd166', ...place(c.w || 320), w: c.w || 320, h: c.h || 300 });
            added.push(`note “${c.text.split('\n')[0]}”`);
            continue;
          }
          let l = lists(board).find((k) => k.title.trim().toLowerCase() === c.title.trim().toLowerCase());
          if (!l) {
            l = { id: uid(), kind: 'list', title: c.title, color: c.color || '#7cc7ff', ...place(c.w || 340), w: c.w || 340, h: 0, collapsed: false, items: [] };
            cards.push(l);
            added.push(`list “${c.title}”`);
          }
          if (c.preset && l.preset !== c.preset) {
            if (!FIELD_PRESETS[c.preset]) throw new Error(`unknown preset ${c.preset}`);
            applyPreset(l, c.preset);
            added.push(`fields on “${c.title}”`);
          }
          if (!fieldsOf(l).length) throw new Error(`“${c.title}” has no card fields; give it a preset in the seed`);
          for (const s of c.items || []) {
            if (l.items.some((it) => it.text === s.text)) continue;
            const it = { id: uid(), text: s.text, done: false, ...(s.notes ? { notes: s.notes } : {}) };
            for (const [k, v] of Object.entries(s.fields || {})) {
              const r = setField(l, it, k, v);
              if (!r.ok) throw new Error(`${c.title} › ${s.text}: ${r.error}`);
            }
            l.items.push(it);
            added.push(`card “${s.text}”`);
          }
        }
        return added.length ? added : false;
      }, { allowNewCards: true });
    },
  };
}

/** When a Voice Inbox transcript was recorded: its Recorded field, else a "YYYY-MM-DD HH:MM" title. */
export function recordedAt(it) {
  const rec = getField(it, 'recorded');
  const t = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(String(it.text || ''));
  const day = t ? t[1] : rec;
  if (!day) return null;
  const d = new Date(`${day}T${t && t[2] ? `${t[2].padStart(2, '0')}:${t[3]}` : '12:00'}:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// ---------- .env ----------

/** Reads KEY=value lines (quotes optional, # comments). Missing file → {}. */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** Sets keys in a .env text, keeping every other line as it is. */
export function updateEnv(text, values) {
  const lines = String(text || '').split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const done = new Set();
  const out = lines.map((line) => {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/i.exec(line);
    if (m && m[1] in values && !line.trim().startsWith('#')) { done.add(m[1]); return `${m[1]}=${values[m[1]]}`; }
    return line;
  });
  for (const [k, v] of Object.entries(values)) if (!done.has(k)) out.push(`${k}=${v}`);
  return out.join('\n') + '\n';
}
