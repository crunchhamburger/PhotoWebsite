#!/usr/bin/env node
// Runs after `astro build` (part of npm run build): fails the build if anything private reached
// the public output in dist/.
//   - no research view pages or API code under dist/research or dist/api
//   - no "/research" in the sitemap, RSS feed or robots allow-list
//   - no images under dist/podcast (episode pages use SVG charts, not image files)
//   - no file whose name looks like a pipeline screenshot (ft-01-…, wsj-02-…, prices-01-…)
//   - when ~/Market Briefs is present (local builds), no file in dist with the same bytes as any
//     saved screenshot (staging/*/charts, weekly/*-charts)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const SRC = process.env.MARKET_BRIEFS_DIR || join(homedir(), 'Market Briefs');
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const SCREENSHOT_NAME = /^(ft|wsj|cnbc|info|theinformation|prices|ornn|dram)-\d{2}-.+\.(png|jpe?g|webp)$/i;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

if (!existsSync(DIST)) {
  console.error('check-public-dist: dist/ not found; run astro build first');
  process.exit(1);
}
const files = walk(DIST);
const problems = [];

for (const f of files) {
  const rel = relative(DIST, f);
  if (/^(research|api)(\/|\.html$)/.test(rel)) problems.push(`private route in public output: ${rel}`);
  if (rel.startsWith('podcast/') && IMAGE.has(extname(f).toLowerCase())) problems.push(`image under podcast/: ${rel}`);
  const base = rel.split('/').pop();
  if (SCREENSHOT_NAME.test(base)) problems.push(`screenshot-like file name: ${rel}`);
}

for (const name of ['sitemap-0.xml', 'sitemap-index.xml', 'podcast/rss.xml']) {
  const f = join(DIST, name);
  if (existsSync(f) && /\/research\b/.test(readFileSync(f, 'utf8'))) problems.push(`${name} mentions /research`);
}

// Byte-for-byte comparison with the saved screenshots, when they are on this machine.
let compared = 0;
if (existsSync(SRC)) {
  const shots = new Set();
  const dirs = [];
  if (existsSync(join(SRC, 'staging'))) {
    for (const d of readdirSync(join(SRC, 'staging'))) dirs.push(join(SRC, 'staging', d, 'charts'));
  }
  if (existsSync(join(SRC, 'weekly'))) {
    for (const d of readdirSync(join(SRC, 'weekly'))) if (d.endsWith('-charts')) dirs.push(join(SRC, 'weekly', d));
  }
  for (const d of dirs.filter((d) => existsSync(d) && statSync(d).isDirectory())) {
    for (const f of readdirSync(d)) if (IMAGE.has(extname(f).toLowerCase())) shots.add(sha(join(d, f)));
  }
  compared = shots.size;
  for (const f of files) {
    if (IMAGE.has(extname(f).toLowerCase()) && shots.has(sha(f))) problems.push(`publisher screenshot copied into dist: ${relative(DIST, f)}`);
  }
}

if (problems.length) {
  console.error(`check-public-dist: ${problems.length} problem(s) — nothing private may be published:`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`check-public-dist: OK (${files.length} files${compared ? `, compared against ${compared} saved screenshots` : ''})`);
