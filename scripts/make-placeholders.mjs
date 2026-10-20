// Generates dark gradient placeholder images so the site builds before the real photos arrive.
// It only fills folders that contain NO images, so it never touches your originals.
//   npm run placeholders
import { readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('../photos/', import.meta.url).pathname;
const IMG = /\.(jpe?g|png|webp|avif|tiff?)$/i;

// Portrait/landscape mix so the masonry gallery looks realistic.
const SHAPES = [
  [1600, 2000], [2000, 1333], [1600, 2000], [2000, 1333],
  [2000, 1333], [1600, 2400], [2000, 1125], [1600, 2000],
];
const PALETTE = [
  ['#0d1b2a', '#3a0ca3'], ['#1b1b1b', '#7f5539'], ['#081c15', '#2d6a4f'],
  ['#10002b', '#c9184a'], ['#03045e', '#00b4d8'], ['#1a1a2e', '#e94560'],
  ['#2b2d42', '#8d99ae'], ['#3d0000', '#ff7b00'], ['#0b090a', '#a4161a'],
  ['#283618', '#dda15e'], ['#14213d', '#fca311'], ['#212529', '#6c757d'],
  ['#1f0322', '#8a1c7c'],
];

const hasImages = (dir) => existsSync(dir) && readdirSync(dir).some((f) => IMG.test(f));

async function make(file, w, h, [c1, c2], label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="50%" fill="rgba(255,255,255,.55)" font-family="Helvetica, Arial, sans-serif"
      font-size="${Math.round(w / 22)}" text-anchor="middle" letter-spacing="6">${label}</text>
    <text x="50%" y="${h / 2 + w / 14}" fill="rgba(255,255,255,.35)" font-family="Helvetica, Arial, sans-serif"
      font-size="${Math.round(w / 40)}" text-anchor="middle" letter-spacing="4">PLACEHOLDER — REPLACE WITH ORIGINAL</text>
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 70 }).toFile(file);
}

const folders = readdirSync(ROOT).filter((f) => statSync(join(ROOT, f)).isDirectory());
let made = 0;
for (const [i, folder] of folders.entries()) {
  const dir = join(ROOT, folder);
  if (hasImages(dir)) continue;
  mkdirSync(dir, { recursive: true });
  const colors = PALETTE[i % PALETTE.length];
  const name = folder.replace(/^_/, '').replace(/-/g, ' ').toUpperCase();
  if (folder === '_home') {
    for (let n = 1; n <= 3; n++) await make(join(dir, `0${n}.jpg`), 2400, 1350, PALETTE[(i + n) % PALETTE.length], `HERO ${n}`);
    made += 3;
  } else if (folder === '_about') {
    await make(join(dir, 'portrait.jpg'), 1200, 1600, colors, 'PORTRAIT');
    made += 1;
  } else {
    await make(join(dir, 'cover.jpg'), 1600, 1600, colors, name);
    for (const [n, [w, h]] of SHAPES.entries()) {
      await make(join(dir, `${String(n + 1).padStart(2, '0')}.jpg`), w, h, colors, `${name} ${n + 1}`);
    }
    made += SHAPES.length + 1;
  }
}
console.log(made ? `Created ${made} placeholder images.` : 'Every folder already has images; nothing to do.');
