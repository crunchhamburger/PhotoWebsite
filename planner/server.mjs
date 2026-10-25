// Local server for the planner: serves planner/public, keeps the board in planner/data/board.json,
// and fetches calendar feeds (Google Calendar secret iCal, Canvas calendar feed) on the browser's
// behalf, since those hosts don't send CORS headers. The website serves the same app privately
// through api/planner.js instead.
//   node planner/server.mjs            -> http://localhost:4310
//   PORT=5000 node planner/server.mjs
// No dependencies. Listens on 127.0.0.1 only.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { join, resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFeed, canvasApi } from './proxy.mjs';

export { allowedFeed, allowedCanvasHost } from './proxy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(here, 'public');
const DATA = resolve(here, 'data');
const BOARD = join(DATA, 'board.json');
const PORT = Number(process.env.PORT) || 4310;
const MAX_BODY = 5 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Same-origin only: a page on another site must not write the board or use the proxies.
const crossOrigin = (req) => req.headers.origin && req.headers.origin !== `http://${req.headers.host}`;

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/state') {
    if (req.method === 'GET') {
      try {
        const s = await stat(BOARD);
        return send(res, 200, await readFile(BOARD), { 'Content-Type': 'application/json', 'Last-Modified': s.mtime.toUTCString() });
      } catch {
        return send(res, 204, '');
      }
    }
    if (req.method === 'PUT') {
      if (crossOrigin(req)) return send(res, 403, 'cross-origin write refused');
      const text = await readBody(req);
      JSON.parse(text); // reject anything that isn't JSON
      await mkdir(DATA, { recursive: true });
      const tmp = BOARD + '.tmp';
      await writeFile(tmp, text);
      await rename(tmp, BOARD);
      return send(res, 204, '');
    }
    return send(res, 405, 'method not allowed', { Allow: 'GET, PUT' });
  }

  if (url.pathname === '/api/ics') {
    const r = await fetchFeed(url.searchParams.get('url'));
    return send(res, r.status, r.body, { 'Content-Type': r.type });
  }

  if (url.pathname.startsWith('/api/canvas/')) {
    if (crossOrigin(req)) return send(res, 403, 'cross-origin request refused');
    const r = await canvasApi(url.pathname.slice('/api/canvas/'.length), req.method, url.searchParams, req.headers['x-canvas-token'], () => readBody(req));
    return send(res, r.status, r.body, { 'Content-Type': r.type });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(PUBLIC, '.' + path);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) return send(res, 404, 'not found');
  try {
    const body = await readFile(file);
    return send(res, 200, body, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  } catch {
    return send(res, 404, 'not found');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer((req, res) =>
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, e.status ?? 500, e.status ? e.message : 'server error');
    }),
  ).listen(PORT, '127.0.0.1', () => console.log(`Planner running at http://localhost:${PORT}`));
}
