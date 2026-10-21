#!/usr/bin/env node
// Fetches the public-domain government data series behind the podcast's original charts.
//   npm run series:update                 # fetch every series in src/data/series.json from FRED
//   node scripts/fetch-series.mjs --from-dir <dir>   # read <ID>.csv files from a folder instead (tests)
//   node scripts/fetch-series.mjs --check            # validate the committed files only, no fetch
//
// Writes src/data/series/<ID>.csv ("date,value"), backfilled from the config's start date.
// Every update is validated before it replaces the committed file:
//   - well-formed CSV, strictly increasing ISO dates, numeric values inside the series' bounds
//   - the latest observation never moves backwards
//   - history outside the revision window (30 days for daily data, 6 years for monthly data,
//     which BLS revises seasonally) must be unchanged, and recent revisions stay under 5%
// A series that fails keeps its previous file. Unchanged data is not rewritten, so re-runs are
// idempotent. Exit code: 0 = all good, 2 = some series kept their previous data, 1 = fatal.
// Log lines (JSON) go to stdout and, if set, to the file in $PODCAST_LOG.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(REPO, 'src/data/series.json'), 'utf8'));
const OUT_DIR = join(REPO, 'src/data/series');
const args = process.argv.slice(2);
const fromDir = args.includes('--from-dir') ? args[args.indexOf('--from-dir') + 1] : null;
const checkOnly = args.includes('--check');

const DAY = 86400000;

function log(level, msg, extra = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), stage: 'series', level, msg, ...extra });
  console.log(line);
  if (process.env.PODCAST_LOG) appendFileSync(process.env.PODCAST_LOG, line + '\n');
}

/** Parses "date,value" CSV (our files) or FRED's "observation_date,<ID>" CSV. Missing values (".") are skipped. */
export function parseCsv(text, id) {
  const lines = text.trim().split(/\r?\n/);
  const header = (lines.shift() ?? '').trim();
  const ok = header === 'date,value' || header === `observation_date,${id}` || header === `DATE,${id}`;
  if (!ok) throw new Error(`unexpected header "${header.slice(0, 60)}"`);
  const rows = [];
  for (const [i, line] of lines.entries()) {
    const [date, raw] = line.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error(`line ${i + 2}: bad date "${date}"`);
    if (raw === undefined) throw new Error(`line ${i + 2}: missing value`);
    if (raw === '.' || raw.trim() === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`line ${i + 2}: bad value "${raw}"`);
    rows.push([date, value]);
  }
  return rows;
}

/** Returns a list of problems with `next` (empty if it may replace `prev`). */
export function validate(id, meta, next, prev) {
  const errs = [];
  if (next.length < 24) errs.push(`only ${next.length} observations`);
  for (let i = 0; i < next.length; i++) {
    const [d, v] = next[i];
    if (i && d <= next[i - 1][0]) errs.push(`dates not increasing at ${d}`);
    if (v < meta.min || v > meta.max) errs.push(`${d}: ${v} outside ${meta.min}..${meta.max}`);
    if (errs.length > 5) break;
  }
  if (prev?.length) {
    const prevLast = prev[prev.length - 1][0];
    const nextLast = next[next.length - 1]?.[0] ?? '';
    if (nextLast < prevLast) errs.push(`latest observation went backwards: ${nextLast} < ${prevLast}`);
    const window = meta.frequency === 'monthly' ? 6 * 366 * DAY : 30 * DAY;
    const cutoff = new Date(Date.parse(prevLast) - window).toISOString().slice(0, 10);
    const nextMap = new Map(next);
    let changed = 0;
    for (const [d, v] of prev) {
      if (d < CONFIG.start) continue;
      const nv = nextMap.get(d);
      if (d < cutoff) {
        if (nv === undefined) errs.push(`historical observation ${d} disappeared`);
        else if (Math.abs(nv - v) > 1e-9) errs.push(`historical observation ${d} changed ${v} → ${nv}`);
      } else if (nv !== undefined && Math.abs(nv - v) > Math.max(Math.abs(v) * 0.05, 1e-9)) {
        errs.push(`recent revision too large at ${d}: ${v} → ${nv}`);
      }
      if (nv !== undefined && nv !== v) changed++;
      if (errs.length > 5) break;
    }
    if (changed) log('info', `${id}: ${changed} revised observation(s)`, { id, revised: changed });
  }
  return errs;
}

const serialize = (rows) => 'date,value\n' + rows.map(([d, v]) => `${d},${v}`).join('\n') + '\n';

async function fetchFred(id) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${CONFIG.start}`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'haozhewang.com podcast charts' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  throw new Error(`fetch failed after 3 attempts: ${lastErr?.message}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let kept = 0;
  const summary = [];
  for (const [id, meta] of Object.entries(CONFIG.series)) {
    const file = join(OUT_DIR, `${id}.csv`);
    let prev = null;
    try {
      prev = existsSync(file) ? parseCsv(readFileSync(file, 'utf8'), id) : null;
    } catch (e) {
      log('error', `${id}: committed file is invalid (${e.message}); it will be replaced if the new data validates`, { id });
    }
    if (checkOnly) {
      const errs = prev ? validate(id, meta, prev, null) : ['missing file'];
      if (errs.length) { kept++; log('error', `${id}: ${errs.join('; ')}`, { id }); }
      else summary.push(`${id} ${prev.length} obs, latest ${prev.at(-1)[0]}`);
      continue;
    }
    try {
      const text = fromDir ? readFileSync(join(fromDir, `${id}.csv`), 'utf8') : await fetchFred(id);
      const next = parseCsv(text, id).filter(([d]) => d >= CONFIG.start);
      const errs = validate(id, meta, next, prev);
      if (errs.length) throw new Error(`validation failed: ${errs.join('; ')}`);
      const out = serialize(next);
      const latest = next.at(-1)[0];
      const staleDays = Math.round((Date.now() - Date.parse(latest)) / DAY);
      const staleLimit = meta.frequency === 'monthly' ? 75 : 10;
      if (staleDays > staleLimit) log('warn', `${id}: latest observation ${latest} is ${staleDays} days old`, { id, latest });
      if (existsSync(file) && readFileSync(file, 'utf8') === out) {
        summary.push(`${id} unchanged (latest ${latest})`);
        continue;
      }
      writeFileSync(file + '.tmp', out);
      renameSync(file + '.tmp', file);
      log('info', `${id}: updated, ${next.length} obs, latest ${latest}`, { id, latest, rows: next.length });
      summary.push(`${id} updated (latest ${latest})`);
    } catch (e) {
      kept++;
      log('error', `${id}: ${e.message}; kept the previous data`, { id });
    }
  }
  log(kept ? 'warn' : 'info', `series done: ${summary.length} ok, ${kept} kept previous`, { ok: summary.length, kept });
  process.exit(kept ? 2 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    log('error', `fatal: ${e.message}`);
    process.exit(1);
  });
}
