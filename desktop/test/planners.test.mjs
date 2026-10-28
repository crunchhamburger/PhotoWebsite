// node --test desktop/test/planners.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibrary, summarize, carryOver, validId } from '../lib/planners.mjs';

const fresh = async () => {
  const lib = createLibrary(await mkdtemp(join(tmpdir(), 'planners-')));
  await lib.init();
  return lib;
};

const board = (updatedAt = 5) => ({
  version: 1,
  updatedAt,
  cards: [
    { id: 'a', kind: 'list', title: 'School', color: '#7cc7ff', x: 0, y: 0, items: [{ id: 'i1', text: 'hw', done: false }, { id: 'i2', text: 'quiz', done: true }] },
    { id: 'b', kind: 'note', text: 'hi', x: 400, y: 0 },
  ],
  archive: [{ id: 'old', done: true }],
  settings: { theme: 'light' },
});

test('create, list, rename, archive', async () => {
  const lib = await fresh();
  const a = await lib.create('Fall semester');
  const b = await lib.create('', 'blank');
  assert.ok(validId(a.id) && validId(b.id));
  assert.equal(b.name, 'Untitled planner');
  assert.equal(await lib.readBoard(a.id), null, 'starter planners are seeded by the app on first open');
  assert.equal(JSON.parse(await lib.readBoard(b.id)).cards.length, 0);
  await lib.update(a.id, { name: 'Fall 2026', archived: true });
  const all = await lib.list();
  assert.equal(all.length, 2);
  assert.equal(all.find((p) => p.id === a.id).name, 'Fall 2026');
  assert.equal(all.find((p) => p.id === a.id).archived, true);
});

test('boards save atomically and update the index; bad JSON and unknown ids are refused', async () => {
  const lib = await fresh();
  const p = await lib.create('X');
  await lib.writeBoard(p.id, JSON.stringify(board(1234)));
  assert.equal(JSON.parse(await lib.readBoard(p.id)).updatedAt, 1234);
  assert.equal((await lib.get(p.id)).updatedAt, 1234);
  await assert.rejects(lib.writeBoard(p.id, 'nope'));
  await assert.rejects(lib.writeBoard('zzzzzzzzzzzz', '{}'), /no such planner/);
  await assert.rejects(lib.writeBoard('../evil', '{}'), /bad planner id/);
});

test('summaries count tasks, archive and cards', async () => {
  const s = summarize(board());
  assert.deepEqual([s.lists, s.notes, s.open, s.done], [1, 1, 1, 2]);
  assert.equal(s.map.length, 2);
  assert.deepEqual(summarize(null), { lists: 0, notes: 0, open: 0, done: 0, listTitles: [], map: [] });
});

test('a new planner can reuse lists and carry over only unfinished tasks', async () => {
  const lib = await fresh();
  const old = await lib.create('Week 1');
  await lib.writeBoard(old.id, JSON.stringify(board()));
  const next = await lib.create('Week 2', { from: old.id, carry: true });
  const nb = JSON.parse(await lib.readBoard(next.id));
  assert.equal(nb.cards.length, 1, 'notes are not carried');
  assert.deepEqual(nb.cards[0].items.map((i) => i.text), ['hw']);
  assert.notEqual(nb.cards[0].id, 'a', 'fresh ids');
  assert.equal(nb.settings.theme, 'light');
  const empty = carryOver(board(), { carry: false });
  assert.equal(empty.cards[0].items.length, 0);
});

test('duplicate, remove to trash, and recover lost boards', async () => {
  const lib = await fresh();
  const p = await lib.create('Orig');
  await lib.writeBoard(p.id, JSON.stringify(board()));
  const d = await lib.duplicate(p.id);
  assert.equal(d.name, 'Orig copy');
  assert.equal(JSON.parse(await lib.readBoard(d.id)).cards.length, 2);
  const trashed = [];
  assert.equal(await lib.remove(d.id, async (f) => { trashed.push(f); await rm(f); }), true);
  assert.equal(trashed.length, 1);
  assert.equal((await lib.list()).length, 1);
  // A board file the index doesn't know about comes back as "Recovered planner".
  await writeFile(join(lib.dir, 'boards', 'abcdef123456.json'), JSON.stringify(board()));
  assert.equal(await lib.recover(), 1);
  assert.ok((await lib.list()).some((x) => x.name === 'Recovered planner'));
  assert.ok((await readFile(join(lib.dir, 'planners.json'), 'utf8')).includes('abcdef123456'));
});
