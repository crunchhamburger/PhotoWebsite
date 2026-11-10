// Syncs one planner of the Mac app with the private planner on the website.
//
// A three-way merge (planner/public/js/merge.js) against the last copy both sides agreed on (the
// "base", kept in the app's data folder), so edits made on the phone and on the Mac since then
// both survive. Writes on both ends are conditional on the version that was read, so a save that
// lands in between (the phone, a Planner window) is merged in on the next round, never lost.
//
// Plain Node with everything injected, so it can be tested against the real website handler.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const versionOf = (text) => (text == null ? 'none' : createHash('sha1').update(text).digest('base64url').slice(0, 20));

/**
 * The Mac side of the sync over the planner library: versioned reads, and writes that only happen
 * if the board is still the version that was read. One lock per planner, also used by the app's
 * own save path, so a check and its write can't be split by another save.
 */
export function localAdapter(lib) {
  const locks = new Map();
  const lock = (id, fn) => {
    const p = (locks.get(id) || Promise.resolve()).then(fn, fn);
    locks.set(id, p.catch(() => {}));
    return p;
  };
  return {
    lock,
    async read(id) {
      const text = await lib.readBoard(id);
      return { text, version: versionOf(text) };
    },
    write: (id, text, expected) => lock(id, async () => {
      if (expected && versionOf(await lib.readBoard(id)) !== expected) return false;
      await lib.writeBoard(id, text);
      return true;
    }),
    name: async (id) => (await lib.get(id))?.name ?? null,
  };
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}
async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

/**
 * dir        app data folder (sync.json, sync-base.json, backups/)
 * local      { read(id) -> { text, version }, write(id, text, expectedVersion) -> boolean, name(id) }
 * merge      { mergeBoards, sameContent }
 * fetch      fetch implementation (tests pass the website handler)
 * keys       { seal(key) -> string, open(string) -> key }  (Keychain-backed in the app)
 * onLocal    called after the sync wrote the local board: (id, updatedAt)
 */
export function createSync({ dir, local, merge, fetch: fetchFn = fetch, keys, onLocal = () => {}, now = () => Date.now() }) {
  const stateFile = join(dir, 'sync.json');
  const baseFile = join(dir, 'sync-base.json');
  let running = null;
  let state = null;

  async function load() {
    state ??= { site: 'https://www.haozhewang.com', planner: null, key: null, daily: true, lastSync: 0, lastError: null, ...(await readJSON(stateFile, {})) };
    return state;
  }
  const save = () => writeAtomic(stateFile, JSON.stringify(state, null, 2));
  const api = (path) => `${state.site.replace(/\/+$/, '')}/planner/${path}`;
  const auth = () => ({ Authorization: `Bearer ${keys.open(state.key)}` });

  async function backup(label, text) {
    if (text == null) return;
    const folder = join(dir, 'backups');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, `sync-${new Date(now()).toISOString().replace(/[:.]/g, '-')}-${label}.json`), text);
  }

  async function round() {
    const id = state.planner;
    // 1. Both copies and the base.
    const mine = await local.read(id);
    const r = await fetchFn(api('api/state'), { headers: auth(), cache: 'no-store' });
    if (r.status === 401) throw Object.assign(new Error('The website no longer accepts this Mac. Connect again with your password.'), { signedOut: true });
    if (r.status !== 200 && r.status !== 204) throw new Error(`The website answered ${r.status}.`);
    const remoteText = r.status === 200 ? await r.text() : null;
    const remoteVersion = r.headers.get('x-board-version');
    const localBoard = mine.text ? JSON.parse(mine.text) : null;
    const remoteBoard = remoteText ? JSON.parse(remoteText) : null;
    const saved = await readJSON(baseFile, null);
    const base = saved && saved.planner === id && saved.site === state.site ? saved : null;

    // Nothing changed on either side since the last sync.
    if (base && remoteBoard && base.version === remoteVersion && localBoard && merge.sameContent(localBoard, base.board)) return { changed: false };

    if (!base) {
      // First sync of this pair: keep a copy of both, just in case.
      await backup('mac', mine.text);
      await backup('website', remoteText);
    }
    const merged = !remoteBoard ? localBoard : !localBoard ? remoteBoard : merge.mergeBoards(base?.board ?? null, localBoard, remoteBoard);
    if (!merged) return { changed: false };

    // 2. Website: save the merged board unless it already is that.
    let agreed = remoteBoard;
    let version = remoteVersion;
    if (!remoteBoard || !merge.sameContent(merged, remoteBoard)) {
      const out = { ...merged, view: remoteBoard?.view ?? merged.view, updatedAt: now() };
      const w = await fetchFn(api('api/state'), {
        method: 'PUT',
        headers: { ...auth(), 'Content-Type': 'application/json', ...(remoteVersion ? { 'X-Board-Base': remoteVersion } : {}) },
        body: JSON.stringify(out),
      });
      if (w.status === 412) return { retry: true }; // the phone saved in between: merge again
      if (!w.ok) throw new Error(`The website didn't take the save (${w.status}).`);
      agreed = out;
      version = w.headers.get('x-board-version') || version;
    }

    // 3. Mac: write the merged board unless it already is that (and only if no window saved since).
    let wroteLocal = false;
    if (!localBoard || !merge.sameContent(merged, localBoard)) {
      const out = { ...merged, view: localBoard?.view ?? merged.view, updatedAt: now() };
      // A window saved since we read: try again. The base stays as it was, because that window's
      // edit was made on top of the old Mac copy, not on top of what we just merged.
      if (!(await local.write(id, JSON.stringify(out), mine.version))) return { retry: true };
      wroteLocal = true;
      onLocal(id, out.updatedAt);
    }
    await writeAtomic(baseFile, JSON.stringify({ planner: id, site: state.site, version, board: agreed }));
    return { changed: true, wroteLocal };
  }

  async function syncNow() {
    await load();
    if (!state.planner || !state.key) return status();
    if (running) return running;
    running = (async () => {
      try {
        let res;
        for (let i = 0; i < 4; i++) {
          res = await round();
          if (!res.retry) break;
        }
        state.lastSync = now();
        state.lastError = null;
      } catch (e) {
        state.lastError = e.message || String(e);
        if (e.signedOut) state.key = null;
      } finally {
        await save();
        running = null;
      }
      return status();
    })();
    return running;
  }

  async function status() {
    await load();
    return {
      connected: !!state.key,
      site: state.site,
      planner: state.planner,
      plannerName: state.planner ? await local.name(state.planner) : null,
      lastSync: state.lastSync,
      lastError: state.lastError,
      daily: state.daily,
      syncing: !!running,
    };
  }

  return {
    load,
    status,
    syncNow,
    /** Trades the password for a sync key (the password isn't kept) and links `planner`. */
    async connect(site, password, planner) {
      await load();
      let url;
      try {
        url = new URL(site || state.site);
      } catch {
        throw new Error('That website address doesn’t look right.');
      }
      if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('The website must use https.');
      state.site = url.origin;
      const r = await fetchFn(api('api/sync-key'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: String(password || '') }) });
      if (r.status === 401) throw new Error('That password isn’t right.');
      if (!r.ok) throw new Error(`The website answered ${r.status}. Is the planner set up there?`);
      const { key } = await r.json();
      state.key = keys.seal(key);
      state.planner = planner;
      state.lastError = null;
      await save();
      return syncNow();
    },
    /** Syncs a different planner from now on (the next sync merges it with the website). */
    async link(planner) {
      await load();
      state.planner = planner;
      await save();
      return syncNow();
    },
    async setDaily(on) {
      await load();
      state.daily = !!on;
      await save();
      return status();
    },
    async disconnect() {
      await load();
      Object.assign(state, { key: null, planner: null, lastError: null });
      await save();
      return status();
    },
    isLinked: async (id) => (await load()).planner === id && !!state.key,
  };
}
