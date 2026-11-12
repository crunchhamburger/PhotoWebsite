#!/usr/bin/env node
// Night Shift: the overnight runner's command line for the planner board on the website.
//
//   node planner/nightshift.mjs connect                      trade the planner password for a sync key (.env)
//   node planner/nightshift.mjs status                       key expiry, board version, Night Shift lists
//   node planner/nightshift.mjs list-ready [--status=Ready]  Night Queue cards as JSON
//   node planner/nightshift.mjs show <id>                    one card as JSON
//   node planner/nightshift.mjs patch <id> status=Running "notes=..." score=2 reviewMinutes=6 stuck=no result=https://…
//   node planner/nightshift.mjs brief <title> [--date=YYYY-MM-DD] [file.md | - (stdin)]
//   node planner/nightshift.mjs voice [--since=24h] [--all]  transcripts as JSON (with the text)
//   node planner/nightshift.mjs processed <id> [--date=…] [file.md | -]
//   node planner/nightshift.mjs export [file]                save the full live board (default: planner/data/exports/board-<time>.json)
//   node planner/nightshift.mjs seed <seed.json>             create the Night Shift lists/cards (needs an export from the last hour)
//   node planner/nightshift.mjs prepare <dir>                export, write <dir>/jobs/<id>/job.json per Ready card, mark them Running
//   node planner/nightshift.mjs collect <dir>                read each job's result.json and write the outcomes to the planner
//
// Agents never get the key: prepare/collect do every planner write, agents only read job.json and
// write result.json + markdown files in their job folder.
//
// Settings come from .env at the repo root (git-ignored): NIGHTSHIFT_SYNC_KEY, NIGHTSHIFT_KEY_EXPIRES,
// NIGHTSHIFT_SITE (default https://www.haozhewang.com). The key is never printed.
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createClient, connect, parseEnv, updateEnv, DEFAULT_SITE } from './nightshift/client.mjs';
import { exportBoard, recentExport, prepare, collect, EXPORT_MAX_AGE } from './nightshift/night.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = resolve(ROOT, '.env');
const EXPORTS = resolve(ROOT, 'planner/data/exports');

const args = process.argv.slice(2);
const flags = {};
const rest = [];
for (const a of args) {
  const m = /^--([a-z-]+)(?:=(.*))?$/i.exec(a);
  if (m) flags[m[1]] = m[2] ?? true;
  else rest.push(a);
}
const [cmd, ...params] = rest;

const readEnv = async () => parseEnv(await readFile(ENV_FILE, 'utf8').catch(() => ''));
const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const readText = async (file) => (!file || file === '-' ? await new Promise((res, rej) => { let s = ''; process.stdin.setEncoding('utf8').on('data', (c) => (s += c)).on('end', () => res(s)).on('error', rej); }) : readFile(resolve(file), 'utf8'));
const hours = (s) => { const m = /^(\d+(?:\.\d+)?)\s*(h|d|m)?$/i.exec(String(s || '24h')); if (!m) throw new Error(`bad --since: ${s}`); return +m[1] * ({ h: 1, d: 24, m: 1 / 60 }[(m[2] || 'h').toLowerCase()]); };

async function askHidden(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const muted = { on: false };
  rl._writeToOutput = (s) => { if (!muted.on) rl.output.write(s); };
  return new Promise((res) => {
    rl.question(prompt, (a) => { rl.output.write('\n'); rl.close(); res(a); });
    muted.on = true;
  });
}

async function client() {
  const env = await readEnv();
  const site = env.NIGHTSHIFT_SITE || DEFAULT_SITE;
  if (!env.NIGHTSHIFT_SYNC_KEY) throw new Error('No sync key in .env. Run: node planner/nightshift.mjs connect');
  const exp = Date.parse(env.NIGHTSHIFT_KEY_EXPIRES || '');
  if (exp && exp - Date.now() < 14 * 86400000) console.error(`⚠ sync key expires ${env.NIGHTSHIFT_KEY_EXPIRES} (${Math.max(0, Math.round((exp - Date.now()) / 86400000))} days). Run: node planner/nightshift.mjs connect`);
  return { c: createClient({ site, key: env.NIGHTSHIFT_SYNC_KEY, log: (m) => console.error(m) }), site, env };
}

const commands = {
  async connect() {
    const env = await readEnv();
    const site = flags.site || env.NIGHTSHIFT_SITE || DEFAULT_SITE;
    const password = process.env.PLANNER_PASSWORD || (await askHidden(`Planner password for ${site}: `));
    const { key, expiresAt } = await connect({ site, password });
    const expires = new Date(expiresAt).toISOString().slice(0, 10);
    await writeFile(ENV_FILE, updateEnv(await readFile(ENV_FILE, 'utf8').catch(() => ''), { NIGHTSHIFT_SITE: site, NIGHTSHIFT_SYNC_KEY: key, NIGHTSHIFT_KEY_EXPIRES: expires }));
    await chmod(ENV_FILE, 0o600).catch(() => {});
    out(`Connected to ${site}. Sync key saved to .env (git-ignored); it expires on ${expires}. Reconnect before then.`);
  },
  async status() {
    const { c, site, env } = await client();
    const { board, version } = await c.read();
    const lists = (board?.cards || []).filter((x) => x.kind === 'list' && Array.isArray(x.fields));
    out({ site, keyExpires: env.NIGHTSHIFT_KEY_EXPIRES || 'unknown', boardVersion: version, boardUpdatedAt: board ? new Date(board.updatedAt).toISOString() : null, nightShiftLists: lists.map((l) => ({ title: l.title, preset: l.preset, cards: l.items.length, hidden: !!l.hidden })) });
  },
  async 'list-ready'() {
    const { c } = await client();
    out(await c.queue({ status: flags.status === 'all' ? '' : flags.status || 'Ready' }));
  },
  async show(id) {
    if (!id) throw new Error('show <id>');
    const { c } = await client();
    out(await c.card(id));
  },
  async patch(id, ...kv) {
    if (!id || !kv.length) throw new Error('patch <id> key=value …   (status, result, notes, score, reviewMinutes, stuck)');
    const patch = {};
    for (const p of kv) {
      const i = p.indexOf('=');
      if (i < 1) throw new Error(`expected key=value, got “${p}”`);
      patch[p.slice(0, i)] = p.slice(i + 1);
    }
    const { c } = await client();
    const r = await c.patch(id, patch);
    out(r.result);
  },
  async brief(title, file) {
    if (!title) throw new Error('brief <title> [--date=YYYY-MM-DD] [file.md | -]');
    const markdown = await readText(file);
    const { c } = await client();
    const r = await c.brief({ title, markdown, ...(flags.date ? { date: flags.date } : {}) });
    out(`Saved Morning Briefs › ${r.result.date} › ${title} (${markdown.trim().split(/\s+/).length} words)`);
  },
  async voice() {
    const { c } = await client();
    out(await c.voice({ hours: hours(flags.since), all: !!flags.all }));
  },
  async processed(id, file) {
    if (!id) throw new Error('processed <id> [--date=YYYY-MM-DD] [file.md | -]');
    const markdown = await readText(file);
    const { c } = await client();
    const r = await c.processed(id, { markdown, ...(flags.date ? { date: flags.date } : {}) });
    out(`Appended “Processed ${r.result.date}” under transcript ${id}`);
  },
  async export(file) {
    const { c } = await client();
    out(`Exported the live board to ${await exportBoard(c, file ? { file } : { dir: EXPORTS })}`);
  },
  async seed(file) {
    if (!file) throw new Error('seed <seed.json>');
    const spec = JSON.parse(await readFile(resolve(file), 'utf8'));
    const backup = await recentExport(EXPORTS);
    if (!backup) throw new Error(`seed changes the live board: first run “node planner/nightshift.mjs export” (an export from the last ${EXPORT_MAX_AGE / 60000} minutes is required; none found in planner/data/exports).`);
    console.error(`Backup on hand: ${backup}`);
    const { c } = await client();
    const r = await c.seed(spec);
    out(r.changed ? `Added: ${r.result.join(', ')}` : 'Nothing to add: everything in the seed is already on the board.');
  },
};

commands.prepare = async (dir) => {
  if (!dir) throw new Error('prepare <dir>');
  const { c } = await client();
  const m = await prepare(c, dir);
  out(m.jobs.length ? `Prepared ${m.jobs.length} job(s) in ${resolve(dir)}/jobs (board exported to ${m.export}); they are Running now.` : 'No Ready cards; nothing prepared.');
  for (const j of m.jobs) out(`  ${j.id}  ${j.job}`);
};
commands.collect = async (dir) => {
  if (!dir) throw new Error('collect <dir>');
  const { c } = await client();
  for (const r of await collect(c, dir)) out(`  ${r.status.padEnd(8)} ${r.job}${r.written?.length ? `  → ${r.written.join(', ')}` : ''}${r.reason ? `  (${r.reason})` : ''}`);
};

const fn = commands[cmd];
if (!fn) {
  console.error(`Usage: node planner/nightshift.mjs <${Object.keys(commands).join('|')}> …  (see the top of this file)`);
  process.exit(2);
}
fn(...params).catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
