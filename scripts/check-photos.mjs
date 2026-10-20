// Checks the /photos folder before a build and prints warnings for:
//   - images over 5 MB (export smaller from Lightroom: long edge ~3000–4000 px, JPEG quality ~85)
//   - non-web formats (.tif/.heic/...) and unsupported files
//   - project folders without index.md, without images, or missing their cover file
//   - missing alt text (coverAlt, per-image `alt:` entries, _home/_about alt.json)
//
//   npm run check:photos              # warnings only, always exits 0
//   npm run check:photos -- --strict  # exits 1 if there are any warnings
//
// No dependencies; uses only Node built-ins.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../photos/', import.meta.url));
const STRICT = process.argv.includes('--strict');
const MAX_BYTES = 5 * 1024 * 1024;

// Formats the site build picks up (see src/lib/photos.ts).
const WEB_IMG = /\.(jpe?g|png|webp|avif)$/i;
const BUILD_IMG = /\.(jpe?g|png|webp|avif|tiff?)$/i;
// Image formats that should be re-exported as JPEG.
const NON_WEB = /\.(tiff?|heic|heif|dng|cr2|cr3|nef|arw|raf|orf|rw2|psd|gif|bmp)$/i;
const IGNORED = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', 'index.md', 'alt.json']);

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { bold: paint(1), dim: paint(2), red: paint(31), green: paint(32), yellow: paint(33), cyan: paint(36) };

const groups = new Map(); // folder -> [warning, ...]
let total = 0;
/** Record a warning. `count` > 1 when one line covers several images. */
function warn(folder, msg, count = 1) {
  if (!groups.has(folder)) groups.set(folder, []);
  groups.get(folder).push(msg);
  total += count;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });

// ---------- minimal frontmatter parsing ----------

/** Strip a trailing `# comment` that is not inside quotes. */
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '\\' && q === '"') i++;
      else if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/** Turn a YAML scalar into a string: strips quotes, handles null/~. */
function scalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const inner = s.slice(1, -1);
    return s[0] === '"' ? inner.replace(/\\"/g, '"') : inner.replace(/''/g, "'");
  }
  return s;
}

/** Split `a: b, "c, d": e` on top-level commas (outside quotes). */
function splitTopLevel(s, sep) {
  const out = [];
  let q = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '\\' && q === '"') { cur += ch + (s[++i] ?? ''); continue; }
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === sep) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Split `key: value` at the first colon outside quotes. */
function splitKeyValue(s) {
  const parts = splitTopLevel(s, ':');
  if (parts.length < 2) return null;
  return [scalar(parts[0]), parts.slice(1).join(':')];
}

/** Parse a flow map `{ "01.jpg": "x", 02.jpg: y }`. */
function parseFlowMap(text) {
  const map = {};
  const inner = text.trim().replace(/^\{/, '').replace(/\}$/, '');
  for (const entry of splitTopLevel(inner, ',')) {
    if (!entry.trim()) continue;
    const kv = splitKeyValue(entry);
    if (kv) map[kv[0]] = scalar(kv[1]);
  }
  return map;
}

/**
 * Reads only what this script needs from index.md: cover, coverAlt, draft and the alt map.
 * Supports `alt: {}`, `alt: { "01.jpg": "x" }` (possibly spanning lines) and block style:
 *   alt:
 *     01.jpg: "..."
 */
function parseFrontmatter(src) {
  const m = src.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/).map(stripComment);
  const data = { alt: {} };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const top = line.match(/^([A-Za-z_][\w-]*)\s*:(.*)$/);
    if (!top) continue;
    const [, key, rest] = top;
    if (key !== 'alt') {
      data[key] = scalar(rest);
      continue;
    }
    let value = rest.trim();
    if (value.startsWith('{')) {
      // Flow map, possibly continued over several lines until the closing brace.
      while (!value.includes('}') && i + 1 < lines.length) value += ' ' + lines[++i].trim();
      data.alt = parseFlowMap(value);
    } else if (value === '') {
      // Block map: following indented lines.
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        const entry = lines[++i].trim();
        if (!entry) continue;
        const kv = splitKeyValue(entry);
        if (kv) data.alt[kv[0]] = scalar(kv[1]);
      }
    }
  }
  return data;
}

// ---------- checks ----------

function listFiles(dir) {
  return readdirSync(dir)
    .filter((f) => !f.startsWith('.') && !IGNORED.has(f) && statSync(join(dir, f)).isFile())
    .sort(byName);
}

/** Size + format checks shared by every folder. Returns the images the build will use. */
function checkFiles(folder, dir) {
  const files = listFiles(dir);
  for (const f of files) {
    const ext = extname(f).toLowerCase();
    if (NON_WEB.test(f)) {
      warn(folder, `${f}: ${ext} is not a web format — export it as JPEG (sRGB, quality ~85)`);
    } else if (!WEB_IMG.test(f)) {
      warn(folder, `${f}: not an image the site uses (ignored by the build)`);
    }
    const size = statSync(join(dir, f)).size;
    if (BUILD_IMG.test(f) || NON_WEB.test(f)) {
      if (size > MAX_BYTES) warn(folder, `${f}: ${mb(size)} is over 5 MB — re-export at ~3000–4000 px long edge, quality ~85`);
    }
  }
  return files.filter((f) => BUILD_IMG.test(f));
}

function readAltJson(folder, dir) {
  const p = join(dir, 'alt.json');
  if (!existsSync(p)) return {};
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    warn(folder, `alt.json is not valid JSON (${e.message})`);
    return {};
  }
}

function checkSpecial(folder, dir) {
  const images = checkFiles(folder, dir);
  if (images.length === 0) {
    warn(folder, folder === '_home' ? 'no hero images found' : 'no portrait image found');
    return;
  }
  const alts = readAltJson(folder, dir);
  // The About page only uses the first image in _about.
  const used = folder === '_about' ? images.slice(0, 1) : images;
  for (const f of used) {
    if (!String(alts[f] ?? '').trim()) warn(folder, `${f}: missing alt text in ${folder}/alt.json`);
  }
  for (const key of Object.keys(alts)) {
    if (!images.includes(key)) warn(folder, `alt.json has an entry for "${key}" but no such image exists`);
  }
}

function checkProject(folder, dir) {
  const images = checkFiles(folder, dir);
  const indexPath = join(dir, 'index.md');
  if (!existsSync(indexPath)) {
    warn(folder, 'missing index.md — this folder will not appear on the site');
    if (images.length === 0) warn(folder, 'no images in this folder');
    return;
  }
  const fm = parseFrontmatter(readFileSync(indexPath, 'utf8'));
  if (!fm) {
    warn(folder, 'index.md has no frontmatter block (--- ... ---)');
    return;
  }
  if (fm.draft === 'true') return; // drafts are not published; skip alt checks
  if (images.length === 0) {
    warn(folder, 'no images in this folder — the build will fail for this project');
    return;
  }

  const cover = fm.cover || 'cover.jpg';
  if (!images.includes(cover)) {
    warn(folder, `cover file "${cover}" not found — using ${images[0]} instead`);
  } else if (!String(fm.coverAlt ?? '').trim() && !String(fm.alt[cover] ?? '').trim()) {
    warn(folder, `${cover}: coverAlt is empty`);
  }

  const gallery = images.length > 1 ? images.filter((f) => f !== cover) : images;
  const missing = gallery.filter((f) => !String(fm.alt[f] ?? '').trim());
  if (missing.length) {
    // One line per folder, but every image counts as a warning.
    warn(folder, `missing alt text for ${missing.length} image${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`, missing.length);
  }
  for (const key of Object.keys(fm.alt)) {
    if (!images.includes(key)) warn(folder, `alt text for "${key}" but no such image exists (renamed?)`);
  }
}

// ---------- run ----------

if (!existsSync(ROOT)) {
  console.log(c.red('photos/ folder not found.'));
  process.exit(STRICT ? 1 : 0);
}

const folders = readdirSync(ROOT)
  .filter((f) => !f.startsWith('.') && statSync(join(ROOT, f)).isDirectory())
  .sort(byName);

let imageCount = 0;
for (const folder of folders) {
  const dir = join(ROOT, folder);
  imageCount += listFiles(dir).filter((f) => BUILD_IMG.test(f)).length;
  if (folder === '_home' || folder === '_about') checkSpecial(folder, dir);
  else if (folder.startsWith('_')) continue;
  else checkProject(folder, dir);
}
for (const required of ['_home', '_about']) {
  if (!folders.includes(required)) warn(required, `photos/${required}/ folder is missing`);
}
for (const f of listFiles(ROOT)) warn('(photos root)', `${f}: loose file — move it into a project folder`);

console.log(c.bold(`Photo check — ${relative(process.cwd(), ROOT) || ROOT}`));
console.log(c.dim(`${folders.length} folders, ${imageCount} images`));
for (const [folder, msgs] of groups) {
  console.log(`\n${c.cyan(c.bold(folder))} ${c.dim(`(${msgs.length})`)}`);
  for (const msg of msgs) console.log(`  ${c.yellow('!')} ${msg}`);
}
console.log('');
if (total === 0) {
  console.log(c.green('No problems found.'));
} else {
  const where = `${groups.size} folder${groups.size === 1 ? '' : 's'}`;
  console.log(c.yellow(`${total} warning${total === 1 ? '' : 's'} in ${where}.`) + (STRICT ? '' : c.dim(' (warnings only; use --strict to fail the build)')));
}
process.exit(STRICT && total > 0 ? 1 : 0);
