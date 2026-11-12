// node --test planner/test/nightshift.test.mjs
// The overnight runner's client against the real website handler (in memory): key exchange,
// versioned writes with retry on 412, the Night-Shift-lists-only guard, briefs, voice, seeding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlannerHandler, configFromEnv } from '../../api/_lib/planner.js';
import { createClient, connect, assertNightShiftOnly, parseEnv, updateEnv, recordedAt } from '../nightshift/client.mjs';
import { applyPreset } from '../public/js/fields.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const ORIGIN = 'https://www.haozhewang.com';
const env = { PLANNER_PASSWORD: 'correct horse battery', PLANNER_SECRET: 'x'.repeat(40), BLOB_READ_WRITE_TOKEN: 'test' };

function memoryStore() {
  let version = 0;
  const m = new Map();
  return {
    m,
    async get(p) { return m.get(p) ?? null; },
    async put(p, body, contentType, { ifMatch } = {}) {
      if (ifMatch && m.get(p)?.etag !== ifMatch) throw Object.assign(new Error('changed'), { status: 412 });
      const etag = `"v${++version}"`;
      m.set(p, { body, contentType, size: body.length, etag });
      return { etag };
    },
  };
}

const plainList = () => ({ id: 'plain', kind: 'list', title: 'Research', color: '#fff', x: 80, y: 80, w: 300, h: 0, items: [{ id: 'p1', text: 'Read', done: false }] });
const seedSpec = {
  cards: [
    { kind: 'list', title: 'Night Queue', preset: 'night-queue', items: [{ text: 'CRWV pre-market brief', fields: { status: 'Ready', exploration: 'CRWV', budget: '20 min' }, }] },
    { kind: 'note', text: 'Night Shift Rules\n- Drafts only.' },
    { kind: 'list', title: 'Morning Briefs', preset: 'morning-briefs' },
    { kind: 'list', title: 'Voice Inbox', preset: 'voice-inbox' },
  ],
};

async function setup(board = { version: 1, cards: [plainList()], links: [], blocks: [], archive: [], settings: { theme: 'dark' }, view: { x: 0, y: 0, zoom: 1 }, updatedAt: 1 }) {
  const store = memoryStore();
  await store.put('board.json', JSON.stringify(board), 'application/json');
  const handle = createPlannerHandler({ config: configFromEnv(env), store, root, delay: 0 });
  const fetchFn = (url, init = {}) => handle(new Request(url, init));
  const { key, expiresAt } = await connect({ site: ORIGIN, password: env.PLANNER_PASSWORD, fetch: fetchFn });
  const now = () => Date.parse('2026-11-12T08:00:00Z');
  const client = createClient({ site: ORIGIN, key, fetch: fetchFn, now });
  const current = () => JSON.parse(store.m.get('board.json').body);
  return { store, fetchFn, key, expiresAt, client, current, handle };
}

test('connect trades the password for a year-long sync key; a wrong password is refused', async () => {
  const { expiresAt, fetchFn } = await setup();
  assert.ok(expiresAt - Date.now() > 360 * 86400000);
  await assert.rejects(connect({ site: ORIGIN, password: 'nope', fetch: fetchFn }), /password/);
});

test('seed creates the lists, note and cards once; a second run adds nothing', async () => {
  const { client, current } = await setup();
  const r = await client.seed(seedSpec);
  assert.equal(r.changed, true);
  assert.deepEqual(r.result, ['list “Night Queue”', 'fields on “Night Queue”', 'card “CRWV pre-market brief”', 'note “Night Shift Rules”', 'list “Morning Briefs”', 'fields on “Morning Briefs”', 'list “Voice Inbox”', 'fields on “Voice Inbox”']);
  const b = current();
  assert.deepEqual(b.cards[0], plainList(), 'the existing list is untouched');
  const nq = b.cards.find((c) => c.title === 'Night Queue');
  assert.equal(nq.preset, 'night-queue');
  assert.deepEqual(nq.items[0].fields, { status: 'Ready', exploration: 'CRWV', budget: '20 min' });
  assert.ok(nq.x > 80 + 300, 'placed to the right of the existing board');
  const again = await client.seed(seedSpec);
  assert.equal(again.changed, false);
  assert.equal(current().cards.length, 5);
});

test('queue, show and patch go through validated fields', async () => {
  const { client, current } = await setup();
  await client.seed(seedSpec);
  const ready = await client.queue();
  assert.equal(ready.length, 1);
  assert.equal(ready[0].job, 'CRWV pre-market brief');
  assert.equal(ready[0].status, 'Ready');
  const id = ready[0].id;
  const r = await client.patch(id, { status: 'running' });
  assert.equal(r.result.status, 'Running');
  assert.deepEqual(await client.queue(), []);
  await client.patch(id, { status: 'Done', result: 'https://example.com/brief', notes: 'Last run: 2026-11-12', stuck: 'no' });
  const card = await client.card(id);
  assert.equal(card.result, 'https://example.com/brief');
  assert.equal(card.stuck, null);
  await assert.rejects(client.patch(id, { score: 4 }), /at most 3/);
  await assert.rejects(client.patch(id, { result: 'javascript:x' }), /http/);
  assert.equal(current().cards.find((c) => c.title === 'Night Queue').items[0].fields.status, 'Done');
  await assert.rejects(client.patch('p1', { status: 'Done' }), /not in a Night Queue/);
});

test('a save that lands between read and write is retried on top of the fresh board', async () => {
  const { client, store, current, handle } = await setup();
  await client.seed(seedSpec);
  const id = (await client.queue())[0].id;
  // The phone renames the plain list's task right after the runner has read the board.
  let intruded = false;
  const phone = async () => {
    const r = await handle(new Request(`${ORIGIN}/planner/api/state`, { headers: { authorization: `Bearer ${(await connect({ site: ORIGIN, password: env.PLANNER_PASSWORD, fetch: (u, i) => handle(new Request(u, i)) })).key}` } }));
    const b = await r.json();
    b.cards[0].items[0].text = 'Read (edited on the phone)';
    b.updatedAt = 5;
    await store.put('board.json', JSON.stringify(b), 'application/json');
  };
  const origPut = store.put.bind(store);
  store.put = async (...a) => {
    if (!intruded) { intruded = true; await phone(); }
    return origPut(...a);
  };
  const r = await client.patch(id, { status: 'Running' });
  assert.equal(r.changed, true);
  const b = current();
  assert.equal(b.cards[0].items[0].text, 'Read (edited on the phone)', 'the phone edit survives');
  assert.equal(b.cards.find((c) => c.title === 'Night Queue').items[0].fields.status, 'Running', 'and so does the runner’s');
});

test('the guard refuses changes outside lists with card fields', () => {
  const before = { cards: [plainList(), applyPreset({ id: 'nq', kind: 'list', title: 'Night Queue', items: [] }, 'night-queue'), { id: 'n', kind: 'note', text: 'hi' }], links: [], blocks: [], archive: [], settings: { a: 1 } };
  const ok = structuredClone(before);
  ok.cards[1].items.push({ id: 'x', text: 'job' });
  assert.doesNotThrow(() => assertNightShiftOnly(before, ok));
  const plain = structuredClone(before);
  plain.cards[0].items[0].done = true;
  assert.throws(() => assertNightShiftOnly(before, plain), /lists with card fields/);
  const note = structuredClone(before);
  note.cards[2].text = 'changed';
  assert.throws(() => assertNightShiftOnly(before, note), /lists with card fields/);
  const settings = structuredClone(before);
  settings.settings.a = 2;
  assert.throws(() => assertNightShiftOnly(before, settings), /settings/);
  const removed = structuredClone(before);
  removed.cards.splice(0, 1);
  assert.throws(() => assertNightShiftOnly(before, removed), /lists with card fields/);
  const reordered = structuredClone(before);
  reordered.cards.reverse();
  assert.throws(() => assertNightShiftOnly(before, reordered), /reorder/);
  // Seeding may add a new note, but still not touch an existing card.
  const newNote = structuredClone(before);
  newNote.cards.push({ id: 'n2', kind: 'note', text: 'Rules' });
  assert.throws(() => assertNightShiftOnly(before, newNote), /lists with card fields/);
  assert.doesNotThrow(() => assertNightShiftOnly(before, newNote, { allowNewCards: true }));
  newNote.cards[2].text = 'changed';
  assert.throws(() => assertNightShiftOnly(before, newNote, { allowNewCards: true }), /lists with card fields/);
});

test('briefs: one card per day, sections appended under headings', async () => {
  const { client, current } = await setup();
  await client.seed(seedSpec);
  await client.brief({ title: 'Pre-market', markdown: 'Nikkei +1%.' });
  await client.brief({ title: 'Filing watch', markdown: 'No new filings.' });
  const mb = current().cards.find((c) => c.title === 'Morning Briefs');
  assert.equal(mb.items.length, 1);
  assert.equal(mb.items[0].text, '2026-11-12');
  assert.equal(mb.items[0].notes, '## Pre-market\n\nNikkei +1%.\n\n## Filing watch\n\nNo new filings.\n');
  assert.deepEqual(mb.items[0].fields, { date: '2026-11-12', sections: 'Pre-market · Filing watch' });
  await client.brief({ title: 'Pre-market', markdown: 'x', date: '2026-11-13' });
  assert.deepEqual(current().cards.find((c) => c.title === 'Morning Briefs').items.map((i) => i.text), ['2026-11-13', '2026-11-12'], 'newest day on top');
  await assert.rejects(client.brief({ title: 'x', markdown: 'y', list: 'Research' }), /No “Research” list with card fields/);
});

test('voice: transcripts from the last 24h by title or Recorded field, until processed', async () => {
  const { client, current } = await setup();
  await client.seed(seedSpec);
  // Transcripts added from the phone (by hand, so no Recorded field: the title carries the time).
  await client.commit((b) => {
    const vi = b.cards.find((c) => c.title === 'Voice Inbox');
    vi.items.push({ id: 'v1', text: '2026-11-11 21:40', notes: 'I should finish the memo.' }, { id: 'v2', text: '2026-11-09 08:00', notes: 'old' }, { id: 'v3', text: 'untitled', notes: 'no date', fields: { recorded: '2026-11-12' } });
  });
  const fresh = await client.voice({ hours: 24 });
  assert.deepEqual(fresh.map((v) => v.id), ['v1', 'v3']);
  assert.equal(fresh[0].transcript, 'I should finish the memo.');
  await client.processed('v1', { markdown: '### Diary\nFinished the memo.' });
  assert.deepEqual((await client.voice({ hours: 24 })).map((v) => v.id), ['v3']);
  assert.deepEqual((await client.voice({ hours: 24, all: true })).map((v) => v.id), ['v1', 'v3']);
  const v1 = current().cards.find((c) => c.title === 'Voice Inbox').items[0];
  assert.equal(v1.notes, 'I should finish the memo.\n\n## Processed 2026-11-12\n\n### Diary\nFinished the memo.\n');
  assert.equal(v1.fields.processed, '2026-11-12');
  assert.equal(recordedAt({ text: 'nothing here' }), null);
});

test('.env helpers keep other lines and never duplicate keys', () => {
  const t = '# site\nPUBLIC_FORM_ENDPOINT=https://x\nNIGHTSHIFT_SYNC_KEY=old\n';
  const u = updateEnv(t, { NIGHTSHIFT_SYNC_KEY: 'new', NIGHTSHIFT_KEY_EXPIRES: '2027-11-12' });
  assert.equal(u, '# site\nPUBLIC_FORM_ENDPOINT=https://x\nNIGHTSHIFT_SYNC_KEY=new\nNIGHTSHIFT_KEY_EXPIRES=2027-11-12\n');
  assert.deepEqual(parseEnv(u), { PUBLIC_FORM_ENDPOINT: 'https://x', NIGHTSHIFT_SYNC_KEY: 'new', NIGHTSHIFT_KEY_EXPIRES: '2027-11-12' });
  assert.deepEqual(parseEnv('A="quoted"\nexport B=2\n'), { A: 'quoted', B: '2' });
});
