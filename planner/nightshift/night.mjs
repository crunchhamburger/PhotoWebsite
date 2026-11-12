// The runner's night: files in, files out, and the sync key never leaves this process.
//
//   prepare <dir>   exports the live board, writes one folder per Ready job with everything the
//                   agent may read (the card, the rules, voice transcripts), marks the jobs Running.
//   (agents run)    read <dir>/jobs/<id>/job.json, write <dir>/jobs/<id>/result.json + files.
//   collect <dir>   reads each result.json and makes every planner write itself: status, notes,
//                   briefs, processed transcripts. Anything malformed is reported, not written.
//
// Agents get a directory, never .env or the key. They cannot reach the planner at all.
import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { today } from './client.mjs';

export const EXPORT_MAX_AGE = 60 * 60000;
const stamp = (now) => new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);

/** Saves the full live board (with its version) to `file`, or to <dir>/board-<time>.json. Returns the path. */
export async function exportBoard(client, { file, dir, now = Date.now() }) {
  const { board, version } = await client.read();
  if (!board) throw new Error('The website has no board to export.');
  const path = file ? resolve(file) : join(resolve(dir), `board-${stamp(now)}.json`);
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify({ exportedAt: new Date(now).toISOString(), version, board }, null, 2));
  return path;
}

/** The newest board-*.json in `dir` that is at most `maxAge` old, or null. */
export async function recentExport(dir, { now = Date.now(), maxAge = EXPORT_MAX_AGE } = {}) {
  let files = [];
  try { files = (await readdir(resolve(dir))).filter((f) => /^board-.*\.json$/.test(f)); } catch { return null; }
  let best = null;
  for (const f of files) {
    const s = await stat(join(resolve(dir), f));
    if (now - s.mtimeMs <= maxAge && (!best || s.mtimeMs > best.mtime)) best = { path: join(resolve(dir), f), mtime: s.mtimeMs };
  }
  return best?.path ?? null;
}

const RULES = `Night Shift rules (binding for every job)
1. Drafts only: never send email, post, buy, trade, delete, or accept invites.
2. If unsure, write the question in the brief and move to the next job; never wait for input.
3. Every job must meet its "Done when" or be marked Partial/Blocked with a reason.
4. Respect each job's budget; stop at the cap.
5. Never grade your own work: a separate checker pass scores outputs.
6. Cite sources for every factual claim.`;

/**
 * Exports the board, then writes <dir>/jobs/<id>/job.json for every Ready card and marks it
 * Running. Voice jobs also get the unprocessed transcripts of the last 24h. Returns the manifest.
 */
export async function prepare(client, dir, { now = Date.now(), voiceHours = 24 } = {}) {
  const root = resolve(dir);
  const exported = await exportBoard(client, { dir: join(root, 'exports'), now });
  const ready = await client.queue({ status: 'Ready' });
  const voice = ready.some((j) => j.exploration === 'Voice') ? await client.voice({ hours: voiceHours }) : [];
  const manifest = { preparedAt: new Date(now).toISOString(), export: exported, jobs: [] };
  for (const job of ready) {
    const folder = join(root, 'jobs', job.id);
    await mkdir(folder, { recursive: true });
    const input = { job, rules: RULES, date: today(now), ...(job.exploration === 'Voice' ? { transcripts: voice } : {}), resultFile: 'result.json', resultFormat: RESULT_FORMAT };
    await writeFile(join(folder, 'job.json'), JSON.stringify(input, null, 2));
    await client.patch(job.id, { status: 'Running', stuck: 'no' });
    manifest.jobs.push({ id: job.id, job: job.job, folder });
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export const RESULT_FORMAT = {
  status: 'Done | Partial | Blocked (required)',
  notes: 'optional text for the card’s Notes (e.g. "Last run: 2026-11-12")',
  stuck: 'optional true/false',
  result: 'optional https link',
  questions: 'optional list of questions for the morning brief',
  briefs: [{ title: 'Pre-market', file: 'pre-market.md', date: 'optional YYYY-MM-DD' }],
  processed: [{ id: 'transcript id from job.json', file: 'diary.md', date: 'optional YYYY-MM-DD' }],
};
const STATUSES = new Set(['Done', 'Partial', 'Blocked']);

/**
 * Reads <dir>/jobs/<id>/result.json for every prepared job and writes the outcome to the planner.
 * A job with no or a malformed result is marked Blocked with the reason; nothing else is touched.
 */
export async function collect(client, dir, { now = Date.now() } = {}) {
  const root = resolve(dir);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const report = [];
  for (const { id, job, folder } of manifest.jobs) {
    const say = (what) => report.push({ id, job, ...what });
    let r;
    try {
      r = JSON.parse(await readFile(join(folder, 'result.json'), 'utf8'));
      if (!r || typeof r !== 'object' || !STATUSES.has(r.status)) throw new Error(`status must be one of ${[...STATUSES].join(', ')}`);
    } catch (e) {
      await client.patch(id, { status: 'Blocked', stuck: 'yes', notes: `No usable result.json: ${e.message}` });
      say({ status: 'Blocked', reason: e.message });
      continue;
    }
    try {
      const written = [];
      for (const b of r.briefs || []) {
        const markdown = await readFile(join(folder, b.file), 'utf8');
        const out = await client.brief({ title: b.title, markdown: withQuestions(markdown, r.questions), date: b.date || today(now) });
        written.push(`brief ${out.result.date} › ${b.title}`);
      }
      for (const p of r.processed || []) {
        const markdown = await readFile(join(folder, p.file), 'utf8');
        await client.processed(p.id, { markdown, date: p.date || today(now) });
        written.push(`processed ${p.id}`);
      }
      const patch = { status: r.status };
      if (typeof r.notes === 'string') patch.notes = r.notes;
      if (r.stuck != null) patch.stuck = r.stuck;
      if (r.result) patch.result = r.result;
      await client.patch(id, patch);
      say({ status: r.status, written });
    } catch (e) {
      await client.patch(id, { status: 'Blocked', stuck: 'yes', notes: `Collect failed: ${e.message}` });
      say({ status: 'Blocked', reason: e.message });
    }
  }
  await writeFile(join(root, `collected-${stamp(now)}.json`), JSON.stringify(report, null, 2));
  return report;
}

function withQuestions(markdown, questions) {
  if (!Array.isArray(questions) || !questions.length) return markdown;
  return `${markdown.trim()}\n\n### Questions for you\n${questions.map((q) => `- ${q}`).join('\n')}\n`;
}
