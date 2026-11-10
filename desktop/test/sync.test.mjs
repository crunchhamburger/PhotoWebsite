// node --test desktop/test/sync.test.mjs
// The Mac app's sync against the real website handler (api/_lib/planner.js) with in-memory storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLibrary } from '../lib/planners.mjs';
import { createSync, localAdapter } from '../lib/sync.mjs';
import * as merge from '../../planner/public/js/merge.js';
import { createPlannerHandler, configFromEnv } from '../../api/_lib/planner.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../planner/public');
const SITE = 'https://www.haozhewang.com';
const PASSWORD = 'correct horse battery';

function website() {
  let v = 0;
  const m = new Map();
  const store = {
    m,
    async get(p) { return m.get(p) ?? null; },
    async put(p, body, contentType, { ifMatch } = {}) {
      if (ifMatch && m.get(p)?.etag !== ifMatch) throw Object.assign(new Error('changed'), { status: 412 });
      const etag = `"v${++v}"`;
      m.set(p, { body, contentType, etag });
      return { etag };
    },
  };
  const handle = createPlannerHandler({ config: configFromEnv({ PLANNER_PASSWORD: PASSWORD, PLANNER_SECRET: 's'.repeat(40), BLOB_READ_WRITE_TOKEN: 't' }), store, root, delay: 0 });
  const fetch = (url, init) => handle(new Request(url, init));
  // The phone: a signed-in browser session saving like the website app does.
  const phone = async () => {
    const r = await fetch(`${SITE}/planner/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: SITE }, body: new URLSearchParams({ password: PASSWORD }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return {
      async get() {
        const g = await fetch(`${SITE}/planner/api/state`, { headers: { cookie } });
        return { board: g.status === 200 ? await g.json() : null, version: g.headers.get('x-board-version') };
      },
      put: (board, base) => fetch(`${SITE}/planner/api/state`, { method: 'PUT', headers: { cookie, origin: SITE, ...(base ? { 'x-board-base': base } : {}) }, body: JSON.stringify(board) }),
    };
  };
  return { fetch, store, phone };
}

const keys = { seal: (k) => `sealed:${k}`, open: (s) => s.slice(7) };

async function mac() {
  const dir = await mkdtemp(join(tmpdir(), 'sync-'));
  const lib = createLibrary(join(dir, 'planners'));
  await lib.init();
  const p = await lib.create('My planner', 'blank');
  return { dir, lib, id: p.id, local: localAdapter(lib) };
}

const board = (items, extra = {}) => ({
  version: 1,
  updatedAt: 1000,
  cards: [{ id: 'L1', kind: 'list', title: 'Research', items: items.map(([id, text, done = false]) => ({ id, text, done })) }],
  settings: { capacity: 6 },
  ...extra,
});
const texts = (b) => b.cards.find((c) => c.kind === 'list').items.map((i) => `${i.done ? 'x' : ' '}${i.text}`);

test('connect: wrong password refused; right one links and pushes the Mac board up', async () => {
  const web = website();
  const m = await mac();
  await m.lib.writeBoard(m.id, JSON.stringify(board([['a', 'paper']])));
  let n = 0;
  const sync = createSync({ dir: m.dir, local: m.local, merge, fetch: web.fetch, keys, now: () => 5000 + n++ });
  await assert.rejects(sync.connect(SITE, 'nope'), /password isn’t right/);
  const st = await sync.connect(SITE, PASSWORD, m.id);
  assert.equal(st.connected, true);
  assert.equal(st.lastError, null);
  const phone = await web.phone();
  assert.deepEqual(texts((await phone.get()).board), [' paper']);
  assert.ok((await readdir(join(m.dir, 'backups'))).some((f) => f.includes('-mac')), 'first sync backs up');
});

test('phone and Mac edits made between syncs both survive, in both places', async () => {
  const web = website();
  const m = await mac();
  await m.lib.writeBoard(m.id, JSON.stringify(board([['a', 'paper'], ['b', 'notes']])));
  let t = 10000;
  const sync = createSync({ dir: m.dir, local: m.local, merge, fetch: web.fetch, keys, now: () => (t += 10) });
  await sync.connect(SITE, PASSWORD, m.id);

  // Phone ticks "paper" and adds a task.
  const phone = await web.phone();
  const { board: pb, version } = await phone.get();
  pb.cards[0].items[0].done = true;
  pb.cards[0].items.push({ id: 'c', text: 'from phone', done: false });
  pb.updatedAt = (t += 10);
  assert.equal((await phone.put(pb, version)).status, 204);
  // Mac renames "notes" and adds one too.
  const mb = JSON.parse(await m.lib.readBoard(m.id));
  mb.cards[0].items[1].text = 'notes (edited on Mac)';
  mb.cards[0].items.push({ id: 'd', text: 'from Mac', done: false });
  mb.updatedAt = (t += 10);
  await m.lib.writeBoard(m.id, JSON.stringify(mb));

  const st = await sync.syncNow();
  assert.equal(st.lastError, null);
  const onMac = texts(JSON.parse(await m.lib.readBoard(m.id)));
  assert.deepEqual([...onMac].sort(), ['xpaper', ' notes (edited on Mac)', ' from phone', ' from Mac'].sort());
  assert.deepEqual(texts((await phone.get()).board), onMac, 'same board, same order, in both places');
  // A second sync with nothing new changes nothing.
  const before = (await phone.get()).version;
  await sync.syncNow();
  assert.equal((await phone.get()).version, before);
});

test('the phone saving from an old copy merges instead of overwriting the Mac', async () => {
  const web = website();
  const m = await mac();
  await m.lib.writeBoard(m.id, JSON.stringify(board([['a', 'paper']])));
  let t = 20000;
  const sync = createSync({ dir: m.dir, local: m.local, merge, fetch: web.fetch, keys, now: () => (t += 10) });
  await sync.connect(SITE, PASSWORD, m.id);
  const phone = await web.phone();
  const stale = await phone.get(); // phone opened earlier
  const staleBase = structuredClone(stale.board); // the copy the phone keeps as its base

  const mb = JSON.parse(await m.lib.readBoard(m.id));
  mb.cards[0].items.push({ id: 'm', text: 'added on Mac', done: false });
  mb.updatedAt = (t += 10);
  await m.lib.writeBoard(m.id, JSON.stringify(mb));
  await sync.syncNow();

  // The phone saves an edit from its old copy: the website refuses (412) with the current board.
  stale.board.cards[0].items[0].done = true;
  const r = await phone.put(stale.board, stale.version);
  assert.equal(r.status, 412);
  const current = await r.json();
  // ...which the website app merges and saves again (what store.js does).
  const merged = merge.mergeBoards(staleBase, stale.board, current);
  assert.deepEqual(texts(merged), ['xpaper', ' added on Mac']);
});

test('a Planner window saving during a sync is merged on the next round, not lost', async () => {
  const web = website();
  const m = await mac();
  await m.lib.writeBoard(m.id, JSON.stringify(board([['a', 'paper']])));
  let t = 30000;
  // A window saves right after the sync reads the Mac board.
  let sneak = true;
  const local = {
    ...m.local,
    async read(id) {
      const r = await m.local.read(id);
      if (sneak && r.text && JSON.parse(r.text).cards[0].items.length === 1 && t > 30100) {
        sneak = false;
        const b = JSON.parse(r.text);
        b.cards[0].items.push({ id: 'w', text: 'typed in a window', done: false });
        b.updatedAt = (t += 10);
        await m.lib.writeBoard(id, JSON.stringify(b));
      }
      return r;
    },
  };
  const sync = createSync({ dir: m.dir, local, merge, fetch: web.fetch, keys, now: () => (t += 10) });
  await sync.connect(SITE, PASSWORD, m.id);
  const phone = await web.phone();
  const { board: pb, version } = await phone.get();
  pb.cards[0].items.push({ id: 'p', text: 'from phone', done: false });
  pb.updatedAt = (t += 200);
  await phone.put(pb, version);
  await sync.syncNow();
  const want = [' paper', ' from phone', ' typed in a window'];
  assert.deepEqual(texts(JSON.parse(await m.lib.readBoard(m.id))).sort(), [...want].sort());
  assert.deepEqual(texts((await phone.get()).board).sort(), [...want].sort());
});

test('a revoked key signs the Mac out with a clear message', async () => {
  const web = website();
  const m = await mac();
  await m.lib.writeBoard(m.id, JSON.stringify(board([['a', 'paper']])));
  const sync = createSync({ dir: m.dir, local: m.local, merge, fetch: web.fetch, keys: { seal: () => 'sealed:bad.key', open: (s) => s.slice(7) } });
  const st = await sync.connect(SITE, PASSWORD, m.id);
  assert.equal(st.connected, false);
  assert.match(st.lastError, /Connect again/);
});
