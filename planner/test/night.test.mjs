// node --test planner/test/night.test.mjs
// prepare/collect: the runner holds the key and does every write; agents only touch files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, utimes, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlannerHandler, configFromEnv } from '../../api/_lib/planner.js';
import { createClient, connect } from '../nightshift/client.mjs';
import { exportBoard, recentExport, prepare, collect } from '../nightshift/night.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const ORIGIN = 'https://www.haozhewang.com';
const env = { PLANNER_PASSWORD: 'correct horse battery', PLANNER_SECRET: 'x'.repeat(40), BLOB_READ_WRITE_TOKEN: 'test' };
const NOW = Date.parse('2026-11-12T08:00:00Z');
const seedSpec = { cards: [
  { kind: 'list', title: 'Night Queue', preset: 'night-queue', items: [
    { text: 'CRWV filing watch', fields: { status: 'Ready', exploration: 'CRWV', notes: 'Last run: never.' } },
    { text: 'Voice note → diary', fields: { status: 'Ready', exploration: 'Voice' } },
    { text: 'Not tonight', fields: { status: 'Draft' } },
  ] },
  { kind: 'list', title: 'Morning Briefs', preset: 'morning-briefs' },
  { kind: 'list', title: 'Voice Inbox', preset: 'voice-inbox' },
] };

async function setup() {
  let v = 0; const m = new Map();
  const store = { async get(p) { return m.get(p) ?? null; }, async put(p, body, contentType, { ifMatch } = {}) { if (ifMatch && m.get(p)?.etag !== ifMatch) throw Object.assign(new Error('changed'), { status: 412 }); const etag = `"v${++v}"`; m.set(p, { body, contentType, size: body.length, etag }); return { etag }; } };
  await store.put('board.json', JSON.stringify({ version: 1, cards: [], links: [], blocks: [], archive: [], settings: {}, view: {}, updatedAt: 1 }), 'application/json');
  const handle = createPlannerHandler({ config: configFromEnv(env), store, root, delay: 0 });
  const fetchFn = (url, init = {}) => handle(new Request(url, init));
  const { key } = await connect({ site: ORIGIN, password: env.PLANNER_PASSWORD, fetch: fetchFn });
  const client = createClient({ site: ORIGIN, key, fetch: fetchFn, now: () => NOW });
  await client.seed(seedSpec);
  await client.commit((b) => { b.cards.find((c) => c.title === 'Voice Inbox').items.push({ id: 'v1', text: '2026-11-11 21:40', notes: 'Finish the memo.' }); });
  const dir = await mkdtemp(join(tmpdir(), 'night-'));
  const current = () => JSON.parse(m.get('board.json').body);
  return { client, dir, current, key };
}

test('export writes the full live board; seed’s guard only accepts an export from the last hour', async () => {
  const { client, dir, current } = await setup();
  assert.equal(await recentExport(join(dir, 'exports'), { now: NOW }), null, 'no exports yet');
  const path = await exportBoard(client, { dir: join(dir, 'exports'), now: NOW });
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(saved.board, current());
  assert.match(saved.version, /^"v/);
  assert.equal(await recentExport(join(dir, 'exports'), { now: Date.now() }), path);
  // Two hours later it no longer counts.
  const old = Date.now() - 2 * 3600000;
  await utimes(path, old / 1000, old / 1000);
  assert.equal(await recentExport(join(dir, 'exports'), { now: Date.now() }), null);
});

test('prepare: one folder per Ready job with everything the agent may read, jobs marked Running, no key anywhere', async () => {
  const { client, dir, current, key } = await setup();
  const m = await prepare(client, dir, { now: NOW });
  assert.equal(m.jobs.length, 2, 'Draft cards are not prepared');
  assert.ok((await readdir(join(dir, 'exports'))).some((f) => f.startsWith('board-')), 'board exported first');
  const filing = JSON.parse(await readFile(join(m.jobs[0].folder, 'job.json'), 'utf8'));
  assert.equal(filing.job.job, 'CRWV filing watch');
  assert.equal(filing.job.notes, 'Last run: never.');
  assert.match(filing.rules, /Drafts only/);
  assert.equal(filing.transcripts, undefined);
  const voice = JSON.parse(await readFile(join(m.jobs[1].folder, 'job.json'), 'utf8'));
  assert.equal(voice.transcripts.length, 1);
  assert.equal(voice.transcripts[0].transcript, 'Finish the memo.');
  for (const j of m.jobs) assert.ok(!(await readFile(join(j.folder, 'job.json'), 'utf8')).includes(key), 'the sync key is not in any job file');
  assert.deepEqual((await client.queue({ status: 'Running' })).map((j) => j.job), ['CRWV filing watch', 'Voice note → diary']);
  assert.deepEqual(await client.queue({ status: 'Ready' }), []);
  assert.equal(current().cards.find((c) => c.title === 'Night Queue').items[2].fields.status, 'Draft');
});

test('collect: results become planner writes; a missing or bad result blocks only that job', async () => {
  const { client, dir, current } = await setup();
  const m = await prepare(client, dir, { now: NOW });
  const [filing, voice] = m.jobs;
  await writeFile(join(filing.folder, 'filing.md'), '**No new filings** (EDGAR checked 2026-11-12).');
  await writeFile(join(filing.folder, 'result.json'), JSON.stringify({ status: 'Done', notes: 'Recurring, daily. Last run: 2026-11-12', questions: ['Should 424B2 count?'], briefs: [{ title: 'Filing watch', file: 'filing.md' }] }));
  await writeFile(join(voice.folder, 'result.json'), JSON.stringify({ status: 'Maybe' })); // malformed
  const report = await collect(client, dir, { now: NOW });
  assert.deepEqual(report.map((r) => r.status), ['Done', 'Blocked']);
  const b = current();
  const nq = b.cards.find((c) => c.title === 'Night Queue');
  assert.equal(nq.items[0].fields.status, 'Done');
  assert.equal(nq.items[0].done, true);
  assert.equal(nq.items[0].fields.notes, 'Recurring, daily. Last run: 2026-11-12');
  assert.equal(nq.items[1].fields.status, 'Blocked');
  assert.equal(nq.items[1].fields.stuck, true);
  assert.match(nq.items[1].fields.notes, /status must be one of/);
  const brief = b.cards.find((c) => c.title === 'Morning Briefs').items[0];
  assert.equal(brief.text, '2026-11-12');
  assert.equal(brief.notes, '## Filing watch\n\n**No new filings** (EDGAR checked 2026-11-12).\n\n### Questions for you\n- Should 424B2 count?\n');
  // A second night: the voice job answers with a processed transcript.
  await client.patch(nq.items[1].id, { status: 'Ready' });
  const m2 = await prepare(client, dir, { now: NOW + 86400000 });
  assert.equal(m2.jobs.length, 1);
  await writeFile(join(m2.jobs[0].folder, 'diary.md'), '### Diary\nMemo finished.');
  await writeFile(join(m2.jobs[0].folder, 'result.json'), JSON.stringify({ status: 'Done', processed: [{ id: 'v1', file: 'diary.md' }] }));
  const r2 = await collect(client, dir, { now: NOW + 86400000 });
  assert.deepEqual(r2[0].written, ['processed v1']);
  const v1 = current().cards.find((c) => c.title === 'Voice Inbox').items[0];
  assert.equal(v1.fields.processed, '2026-11-13');
  assert.match(v1.notes, /## Processed 2026-11-13\n\n### Diary\nMemo finished\./);
  // Nothing outside the Night Shift lists changed across all of this.
  assert.equal(current().cards.length, 3);
});
