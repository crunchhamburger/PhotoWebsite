#!/usr/bin/env node
// Imports podcast episodes from the market-brief pipeline into the site.
//   npm run podcast:import
//   MARKET_BRIEFS_DIR=/path/to/briefs npm run podcast:import
//
// Reads <dir>/daily/*-episode.md and <dir>/weekly/*-episode.md, and copies each new or
// changed one to src/content/podcast/<slug>.md (slug: <date> for daily, <date>-weekly for
// weekly), with its MP3 from <dir>/audio/ to public/podcast/audio/<slug>.mp3. MP3s are
// named by slug so a Friday daily and that week's weekly can never overwrite each other.
//
// Idempotent: unchanged files are skipped. Every episode is validated before anything is
// copied; a bad frontmatter field or a missing MP3 stops the run with exit code 1.
//
// Also copies each episode's full brief (<kind>/<date>.md) to src/content/briefs/<slug>.md,
// which the episode page shows, with a charts.json of chart captions and source links. The
// chart images go to src/content/briefs/<slug>/charts/, which is git-ignored: they are
// screenshots of other publications' graphics, shown only in `npm run dev`. A missing brief
// or chart is skipped, never an error.
import { readdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const SRC = process.env.MARKET_BRIEFS_DIR || join(homedir(), 'Documents', 'Market Briefs');
const REPO = fileURLToPath(new URL('..', import.meta.url));
const CONTENT_DIR = join(REPO, 'src/content/podcast');
const AUDIO_DIR = join(REPO, 'public/podcast/audio');
const BRIEFS_DIR = join(REPO, 'src/content/briefs');

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c(2), bold = c(1), green = c(32), red = c(31), yellow = c(33);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['daily', 'weekly'];

if (!existsSync(SRC) || !statSync(SRC).isDirectory()) {
  console.error(red(`Market briefs folder not found: ${SRC}`));
  console.error(dim('Set MARKET_BRIEFS_DIR to the folder that holds daily/, weekly/ and audio/.'));
  process.exit(1);
}

/** Splits a Markdown file into its YAML frontmatter object and body. */
function readFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) throw new Error('no YAML frontmatter (the file must start with ---)');
  const data = parseYaml(m[1]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('frontmatter is not a YAML mapping');
  return data;
}

/** Returns a list of problems with an episode's frontmatter (empty if valid). */
function validate(fm, folderKind, fileDate) {
  const errs = [];
  const isStr = (v) => typeof v === 'string' && v.trim() !== '';
  // YAML parses an unquoted 2026-10-20 as a string with the yaml package's default schema.
  const date = fm.date instanceof Date ? fm.date.toISOString().slice(0, 10) : String(fm.date ?? '');

  if (!isStr(fm.title)) errs.push('title: required string');
  if (!DATE_RE.test(date)) errs.push(`date: expected YYYY-MM-DD, got ${JSON.stringify(fm.date)}`);
  else if (date !== fileDate) errs.push(`date: ${date} does not match the file name date ${fileDate}`);
  if (!KINDS.includes(fm.kind)) errs.push(`kind: expected daily or weekly, got ${JSON.stringify(fm.kind)}`);
  else if (fm.kind !== folderKind) errs.push(`kind: ${fm.kind} but the file is in ${folderKind}/`);
  if (!isStr(fm.headline)) errs.push('headline: required string');
  if (!isStr(fm.audio) || !/\.mp3$/i.test(fm.audio) || /[\\/]/.test(fm.audio)) {
    errs.push(`audio: expected an .mp3 file name in audio/, got ${JSON.stringify(fm.audio)}`);
  }
  if (fm.duration !== undefined && fm.duration !== null && !(Number.isInteger(fm.duration) && fm.duration > 0)) {
    errs.push(`duration: expected whole seconds, got ${JSON.stringify(fm.duration)}`);
  }
  if (fm.tickers !== undefined && !(Array.isArray(fm.tickers) && fm.tickers.every(isStr))) {
    errs.push('tickers: expected a list of strings');
  }
  if (fm.sources !== undefined) {
    if (!Array.isArray(fm.sources)) errs.push('sources: expected a list');
    else {
      fm.sources.forEach((s, i) => {
        if (!s || !isStr(s.publication) || !isStr(s.title) || !isStr(s.url)) {
          errs.push(`sources[${i}]: needs publication, title and url`);
          return;
        }
        try {
          const u = new URL(s.url);
          if (!/^https?:$/.test(u.protocol)) throw new Error();
        } catch {
          errs.push(`sources[${i}].url: not an http(s) URL: ${s.url}`);
        }
      });
    }
  }
  return { errs, date };
}

/** True when dest exists and has exactly the same bytes as src. */
function sameFile(src, dest) {
  if (!existsSync(dest)) return false;
  if (statSync(src).size !== statSync(dest).size) return false;
  return readFileSync(src).equals(readFileSync(dest));
}

/** Writes `data` to dest unless it already holds exactly those bytes. Returns true if written. */
function writeIfChanged(dest, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (existsSync(dest) && readFileSync(dest).equals(buf)) return false;
  writeFileSync(dest, buf);
  return true;
}

/**
 * The full brief, tidied for the site: drops the H1 (the page has its own title), the
 * "Listen" line with the email's {{PAGE_URL}} placeholder, and the "## Charts" list
 * (the page shows the chart images instead).
 */
function cleanBrief(text) {
  const out = [];
  let skipping = false;
  let first = true;
  for (let line of text.split(/\r?\n/)) {
    if (first && /^#\s/.test(line)) { first = false; continue; }
    if (line.trim()) first = false;
    // Weekly intro names internal note files ("Detailed notes are in ft-tech.md, …"): drop that sentence.
    line = line.replace(/\s*Detailed notes are in .*?\.md\.(?=\s|$)/g, '');
    if (/^##\s+Charts\s*$/.test(line)) { skipping = true; continue; }
    if (skipping && /^##\s/.test(line)) skipping = false;
    if (skipping) continue;
    if (/^\*\*Listen:\*\*/.test(line) || line.includes('{{PAGE_URL}}')) continue;
    out.push(line);
  }
  return out.join('\n').replace(/(\n---\s*)+(\n## )/g, '\n$2').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Copies the full brief, chart list and chart images for one episode into src/content/briefs/. Returns what changed. */
function importBrief(ep) {
  const changes = [];
  const briefFile = join(SRC, ep.kind, `${ep.date}.md`);
  if (!existsSync(briefFile)) return changes;
  mkdirSync(BRIEFS_DIR, { recursive: true });
  if (writeIfChanged(join(BRIEFS_DIR, `${ep.slug}.md`), cleanBrief(readFileSync(briefFile, 'utf8')))) changes.push('brief');

  // charts-order.txt: one chart per line, "file<TAB>caption<TAB>source url".
  const chartDir = ep.kind === 'weekly' ? join(SRC, 'weekly', `${ep.date}-charts`) : join(SRC, 'staging', ep.date, 'charts');
  const orderFile = ep.kind === 'weekly' ? join(chartDir, 'charts-order.txt') : join(SRC, 'staging', ep.date, 'charts-order.txt');
  if (!existsSync(orderFile)) return changes;
  const charts = [];
  const outDir = join(BRIEFS_DIR, ep.slug, 'charts');
  for (const line of readFileSync(orderFile, 'utf8').split(/\r?\n/)) {
    const [file, caption = '', url = ''] = line.split('\t').map((s) => s.trim());
    if (!file || !/^[\w.-]+\.(png|jpe?g|webp)$/i.test(file) || !existsSync(join(chartDir, file))) continue;
    mkdirSync(outDir, { recursive: true });
    if (writeIfChanged(join(outDir, file), readFileSync(join(chartDir, file)))) changes.push(`chart ${file}`);
    charts.push({ file, caption, url });
  }
  if (writeIfChanged(join(BRIEFS_DIR, ep.slug, 'charts.json'), JSON.stringify(charts, null, 2) + '\n') && !changes.length) {
    changes.push('chart list');
  }
  return changes;
}

// ---------- collect and validate ----------
const episodes = [];
const problems = [];

for (const kind of KINDS) {
  const dir = join(SRC, kind);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).sort()) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})-episode\.md$/);
    if (!m) continue;
    const file = join(dir, name);
    const label = `${kind}/${name}`;
    let fm;
    try {
      fm = readFrontmatter(readFileSync(file, 'utf8'));
    } catch (e) {
      problems.push(`${label}: ${e.message}`);
      continue;
    }
    const { errs, date } = validate(fm, kind, m[1]);
    if (errs.length) {
      problems.push(...errs.map((e) => `${label}: ${e}`));
      continue;
    }
    const mp3 = join(SRC, 'audio', fm.audio);
    if (!existsSync(mp3)) {
      problems.push(`${label}: MP3 not found: ${relative(SRC, mp3)}`);
      continue;
    }
    const slug = kind === 'weekly' ? `${date}-weekly` : date;
    episodes.push({ label, file, mp3, slug, kind, date });
  }
}

if (problems.length) {
  console.error(red(bold(`Podcast import failed: ${problems.length} problem${problems.length === 1 ? '' : 's'}. Nothing was copied.`)));
  for (const p of problems) console.error(`  ${red('✗')} ${p}`);
  process.exit(1);
}

if (!episodes.length) {
  console.log(dim(`No episode files in ${SRC}/{daily,weekly}/. Nothing to import.`));
  process.exit(0);
}

// ---------- copy ----------
mkdirSync(CONTENT_DIR, { recursive: true });
mkdirSync(AUDIO_DIR, { recursive: true });

let copied = 0;
for (const ep of episodes) {
  const mdDest = join(CONTENT_DIR, `${ep.slug}.md`);
  const mp3Dest = join(AUDIO_DIR, `${ep.slug}.mp3`);
  const changes = [];
  const isNew = !existsSync(mdDest);
  if (!sameFile(ep.file, mdDest)) {
    writeFileSync(mdDest, readFileSync(ep.file));
    changes.push('notes');
  }
  if (!sameFile(ep.mp3, mp3Dest)) {
    copyFileSync(ep.mp3, mp3Dest);
    changes.push('audio');
  }
  let briefNote = '';
  try {
    const briefChanges = importBrief(ep);
    if (briefChanges.length) briefNote = dim(`    full brief: ${briefChanges.join(', ')}`);
  } catch (e) {
    briefNote = yellow(`    full brief skipped: ${e.message}`);
  }
  if (changes.length) {
    copied++;
    console.log(`  ${green(isNew ? '+' : '~')} ${ep.slug} ${dim(`(${isNew ? 'new' : `updated ${changes.join(' + ')}`})`)}`);
  } else {
    console.log(dim(`  = ${ep.slug} (unchanged)`));
  }
  if (briefNote) console.log(briefNote);
}

console.log(
  copied
    ? green(`Imported ${copied} episode${copied === 1 ? '' : 's'} of ${episodes.length}.`)
    : dim(`All ${episodes.length} episodes already up to date.`),
);
