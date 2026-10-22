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
// Also copies each episode's full brief to src/content/briefs/, which the episode page shows:
// the published brief page (<kind>/<date>-page.html, the same page the email links to) as
// <slug>.html when it exists, else the Markdown brief (<kind>/<date>.md) as <slug>.md. Plus a
// charts.json of the source charts' captions and links. The screenshots themselves are never
// copied into the site: they are other publications' graphics and live only in the private
// research view (see ~/Market Briefs/scripts/upload-research.mjs). A missing brief is skipped.
//
// Chinese edition (optional): `audio_zh` (an MP3 in audio/, copied to public/podcast/audio/<slug>.zh.mp3)
// and the Chinese brief page <kind>/<date>-zh.html (copied, tidied, to src/content/briefs/<slug>.zh.html).
// The site's /zh/podcast pages use them; episodes without them fall back to English there.
// An optional second Chinese narrator (`audio_zh_2`, `voice_zh`, `voice_zh_2`) is copied to
// <slug>.zh-2.mp3 and offered as a voice switch on the Chinese pages.
//
// The episode's own `charts:` list (original charts of public-domain data, placed under named
// brief sections) is validated here too; see src/content.config.ts for the format.
import { readdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const SRC = process.env.MARKET_BRIEFS_DIR || join(homedir(), 'Market Briefs');
const REPO = fileURLToPath(new URL('..', import.meta.url));
const CONTENT_DIR = join(REPO, 'src/content/podcast');
const AUDIO_DIR = join(REPO, 'public/podcast/audio');
const BRIEFS_DIR = join(REPO, 'src/content/briefs');
const SERIES = JSON.parse(readFileSync(join(REPO, 'src/data/series.json'), 'utf8')).series;
const RANGES = ['3m', '6m', '1y', '2y', '5y', '10y', 'ytd', 'max'];

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
  for (const k of ['title_zh', 'headline_zh']) if (fm[k] !== undefined && !isStr(fm[k])) errs.push(`${k}: expected a string`);
  if (fm.audio_zh !== undefined && (!isStr(fm.audio_zh) || !/\.mp3$/i.test(fm.audio_zh) || /[\\/]/.test(fm.audio_zh))) {
    errs.push(`audio_zh: expected an .mp3 file name in audio/, got ${JSON.stringify(fm.audio_zh)}`);
  }
  if (fm.audio_zh_2 !== undefined && (!isStr(fm.audio_zh_2) || !/\.mp3$/i.test(fm.audio_zh_2) || /[\\/]/.test(fm.audio_zh_2))) {
    errs.push(`audio_zh_2: expected an .mp3 file name in audio/, got ${JSON.stringify(fm.audio_zh_2)}`);
  }
  for (const k of ['voice_zh', 'voice_zh_2']) if (fm[k] !== undefined && !isStr(fm[k])) errs.push(`${k}: expected a string`);
  if (fm.duration_zh !== undefined && fm.duration_zh !== null && !(Number.isInteger(fm.duration_zh) && fm.duration_zh > 0)) {
    errs.push(`duration_zh: expected whole seconds, got ${JSON.stringify(fm.duration_zh)}`);
  }
  errs.push(...validateCharts(fm.charts));
  return { errs, date };
}

/** Checks the episode's `charts:` list (original charts). Mirrors the schema in src/content.config.ts. */
function validateCharts(charts) {
  if (charts === undefined || charts === null) return [];
  if (!Array.isArray(charts)) return ['charts: expected a list'];
  const errs = [];
  if (charts.length > 4) errs.push('charts: at most 4 per episode');
  const isStr = (v) => typeof v === 'string' && v.trim() !== '';
  charts.forEach((c, i) => {
    const at = `charts[${i}]`;
    if (!c || typeof c !== 'object') return errs.push(`${at}: expected an object`);
    if (!isStr(c.after)) errs.push(`${at}.after: name the brief section heading to place it under`);
    if (!isStr(c.title)) errs.push(`${at}.title: required`);
    if (c.type === 'line') {
      if (!Array.isArray(c.series) || c.series.length < 1 || c.series.length > 3) errs.push(`${at}.series: 1 to 3 series ids`);
      else c.series.filter((id) => !SERIES[id]).forEach((id) => errs.push(`${at}.series: unknown series "${id}" (see src/data/series.json)`));
      if (c.range !== undefined && !RANGES.includes(c.range)) errs.push(`${at}.range: one of ${RANGES.join(', ')}`);
      if (c.transform !== undefined && !['level', 'yoy'].includes(c.transform)) errs.push(`${at}.transform: level or yoy`);
    } else if (c.type === 'bar') {
      if (!Array.isArray(c.data) || c.data.length < 2 || c.data.length > 12) errs.push(`${at}.data: 2 to 12 {label, value}`);
      else if (!c.data.every((d) => isStr(d?.label) && typeof d?.value === 'number' && Number.isFinite(d.value))) errs.push(`${at}.data: each needs a label and a number`);
      if (!['official', 'two-sources'].includes(c.verification)) errs.push(`${at}.verification: official or two-sources`);
      const srcs = Array.isArray(c.sources) ? c.sources : [];
      if (!srcs.length || !srcs.every((s) => isStr(s?.publication) && isStr(s?.title) && /^https?:\/\//.test(s?.url ?? ''))) {
        errs.push(`${at}.sources: each needs publication, title and an http(s) url`);
      } else if (c.verification === 'two-sources' && new Set(srcs.map((s) => s.publication.toLowerCase())).size < 2) {
        errs.push(`${at}: two-sources needs at least two different publications`);
      }
    } else {
      errs.push(`${at}.type: line or bar`);
    }
  });
  return errs;
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

/**
 * The published brief page's <main>, tidied for the site: drops the H1 and audio player (the
 * episode page has its own), the Charts section with its screenshots (the page lists chart
 * captions and links instead), and anything executable. Turns the daily page's "- " lines
 * inside paragraphs into real lists. Returns null if the page has no <main>.
 */
function cleanPage(html) {
  const m = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (!m) return null;
  let s = m[1];
  s = s.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '');
  s = s.replace(/<div class="listen">[\s\S]*?<\/div>/i, '');
  s = s.replace(/<p class="lang">[\s\S]*?<\/p>/i, '');
  s = s.replace(/<h2[^>]*>\s*(?:\d+\.\s*)?(?:Charts|图表)\s*<\/h2>[\s\S]*?(?=<h2|$)/i, '');
  s = s.replace(/<(script|style|audio|video|iframe|object)\b[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<\/?(img|figure|figcaption|source|embed)\b[^>]*>/gi, '');
  s = s.replace(/\s+on\w+="[^"]*"/gi, '');
  s = s.replace(/<p>([\s\S]*?)<\/p>/g, (all, inner) => {
    if (!/\n-\s/.test(inner)) return all;
    const [lead, ...items] = inner.split(/\n-\s+/);
    return (lead.trim() ? `<p>${lead.trim()}</p>\n` : '') + `<ul>\n${items.map((i) => `<li>${i.trim()}</li>`).join('\n')}\n</ul>`;
  });
  s = s.replace(/[^\S\n]*\{\{[A-Z_]+\}\}[^\S\n]*/g, '');
  return s.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Deletes a folder if it exists. Returns true if it did. */
function removeDir(dir) {
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Deletes a file if it exists. Returns true if it did. */
function removeIfPresent(file) {
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

/** Copies the full brief, chart list and chart images for one episode into src/content/briefs/. Returns what changed. */
function importBrief(ep) {
  const changes = [];
  // The brief page: <kind>/<date>-page.html, or the bilingual edition's English page
  // (editions/<date>/index.html, weekly editions/<date>-weekly/index.html).
  const editionPage = join(SRC, 'editions', ep.kind === 'weekly' ? `${ep.date}-weekly` : ep.date, 'index.html');
  const legacyPage = join(SRC, ep.kind, `${ep.date}-page.html`);
  const pageFile = existsSync(legacyPage) ? legacyPage : editionPage;
  const mdFile = join(SRC, ep.kind, `${ep.date}.md`);
  const page = existsSync(pageFile) ? cleanPage(readFileSync(pageFile, 'utf8')) : null;
  if (!page && !existsSync(mdFile)) return changes;
  mkdirSync(BRIEFS_DIR, { recursive: true });
  const htmlDest = join(BRIEFS_DIR, `${ep.slug}.html`);
  const mdDest = join(BRIEFS_DIR, `${ep.slug}.md`);
  // Each original chart goes under the brief section named in `after`; warn if there is none.
  const headingKey = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;|’/g, "'").replace(/^\s*\d+\.\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const headings = page
    ? [...page.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].map((m) => headingKey(m[1]))
    : readFileSync(mdFile, 'utf8').split('\n').filter((l) => /^#{2,3}\s/.test(l)).map((l) => headingKey(l.replace(/^#+\s*/, '')));
  for (const c of ep.charts) {
    if (!headings.includes(headingKey(c.after))) changes.push(`WARNING chart "${c.title}": no section "${c.after}" in the brief, it will go at the end`);
  }
  // Chinese brief page, when the pipeline made one.
  const zhFile = join(SRC, ep.kind, `${ep.date}-zh.html`);
  const zhPage = existsSync(zhFile) ? cleanPage(readFileSync(zhFile, 'utf8')) : null;
  if (zhPage && writeIfChanged(join(BRIEFS_DIR, `${ep.slug}.zh.html`), zhPage)) changes.push('Chinese brief page');
  if (page) {
    if (writeIfChanged(htmlDest, page)) changes.push('brief page');
    removeIfPresent(mdDest);
  } else {
    if (writeIfChanged(mdDest, cleanBrief(readFileSync(mdFile, 'utf8')))) changes.push('brief');
    removeIfPresent(htmlDest);
  }

  // charts-order.txt: one chart per line, "file<TAB>caption<TAB>source url".
  const chartDir = ep.kind === 'weekly' ? join(SRC, 'weekly', `${ep.date}-charts`) : join(SRC, 'staging', ep.date, 'charts');
  const orderFile = ep.kind === 'weekly' ? join(chartDir, 'charts-order.txt') : join(SRC, 'staging', ep.date, 'charts-order.txt');
  if (!existsSync(orderFile)) return changes;
  const charts = [];
  // Earlier versions copied the screenshots here; make sure none are left in the site folder.
  if (removeDir(join(BRIEFS_DIR, ep.slug, 'charts'))) changes.push('removed local screenshot copies');
  for (const line of readFileSync(orderFile, 'utf8').split(/\r?\n/)) {
    const [file, caption = '', url = ''] = line.split('\t').map((s) => s.trim());
    if (!file || !/^[\w.-]+\.(png|jpe?g|webp)$/i.test(file) || !existsSync(join(chartDir, file))) continue;
    charts.push({ file, caption, url });
  }
  mkdirSync(join(BRIEFS_DIR, ep.slug), { recursive: true });
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
    let mp3Zh = null;
    if (fm.audio_zh) {
      mp3Zh = join(SRC, 'audio', fm.audio_zh);
      if (!existsSync(mp3Zh)) {
        problems.push(`${label}: Chinese MP3 not found: ${relative(SRC, mp3Zh)}`);
        continue;
      }
    }
    let mp3Zh2 = null;
    if (fm.audio_zh_2) {
      mp3Zh2 = join(SRC, 'audio', fm.audio_zh_2);
      if (!existsSync(mp3Zh2)) {
        problems.push(`${label}: second Chinese MP3 not found: ${relative(SRC, mp3Zh2)}`);
        continue;
      }
    }
    const slug = kind === 'weekly' ? `${date}-weekly` : date;
    episodes.push({ label, file, mp3, mp3Zh, mp3Zh2, slug, kind, date, charts: fm.charts ?? [] });
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
  if (ep.mp3Zh) {
    const zhDest = join(AUDIO_DIR, `${ep.slug}.zh.mp3`);
    if (!sameFile(ep.mp3Zh, zhDest)) {
      copyFileSync(ep.mp3Zh, zhDest);
      changes.push('Chinese audio');
    }
  }
  if (ep.mp3Zh2) {
    const zh2Dest = join(AUDIO_DIR, `${ep.slug}.zh-2.mp3`);
    if (!sameFile(ep.mp3Zh2, zh2Dest)) {
      copyFileSync(ep.mp3Zh2, zh2Dest);
      changes.push('second Chinese voice');
    }
  }
  let briefNote = '';
  try {
    const briefChanges = importBrief(ep);
    if (briefChanges.length) briefNote = (briefChanges.some((c) => c.startsWith('WARNING')) ? yellow : dim)(`    full brief: ${briefChanges.join(', ')}`);
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
