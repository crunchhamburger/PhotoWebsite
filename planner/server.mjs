// Local server for the planner: serves planner/public, keeps the board in planner/data/board.json,
// and fetches calendar feeds (Google Calendar secret iCal, Canvas calendar feed) on the browser's
// behalf, since those hosts don't send CORS headers.
//   node planner/server.mjs            -> http://localhost:4310
//   PORT=5000 node planner/server.mjs
// No dependencies. Listens on 127.0.0.1 only.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { join, resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
};

// Feeds the proxy will fetch. Anything else is refused so this can't be used as an open proxy.
export function allowedFeed(raw) {
  let u;
  try {
    u = new URL(raw.replace(/^webcal:/i, 'https:'));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  const ok =
    h === 'calendar.google.com' ||
    h.endsWith('.instructure.com') ||
    h.endsWith('.icloud.com') ||
    h === 'outlook.office365.com' ||
    h === 'outlook.live.com' ||
    // Schools that run Canvas on their own domain (canvas.<school>.edu, courseworks2.columbia.edu ...)
    (h.endsWith('.edu') && u.pathname.startsWith('/feeds/calendars/'));
  return ok ? u : null;
}

/** A Canvas host the API proxy may call: canvas.instructure.com-style or a school's own .edu domain. */
export function allowedCanvasHost(raw) {
  const h = String(raw ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(instructure\.com|edu)$/.test(h) ? h : null;
}

// Canvas REST API (planner items, mark complete). The personal access token comes from the
// browser in X-Canvas-Token on each call and is never stored here.
async function canvas(req, res, url) {
  const host = allowedCanvasHost(url.searchParams.get('host'));
  const token = req.headers['x-canvas-token'];
  if (!host) return send(res, 400, 'Canvas host must end in .instructure.com or .edu');
  if (!token) return send(res, 400, 'Missing Canvas token');
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, 'cross-origin request refused');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  if (url.pathname === '/api/canvas/planner' && req.method === 'GET') {
    const q = new URLSearchParams({ start_date: url.searchParams.get('start_date') ?? '', end_date: url.searchParams.get('end_date') ?? '', per_page: '100' });
    let next = `https://${host}/api/v1/planner/items?${q}`;
    const items = [];
    for (let page = 0; next && page < 20; page++) {
      const r = await fetch(next, { headers, signal: AbortSignal.timeout(15000) });
      if (!r.ok) return send(res, r.status === 401 ? 401 : 502, r.status === 401 ? 'Canvas rejected the access token' : `Canvas answered HTTP ${r.status}`);
      items.push(...(await r.json()));
      next = /<([^>]+)>;\s*rel="next"/.exec(r.headers.get('link') ?? '')?.[1] ?? null;
      if (next && new URL(next).host !== host) next = null;
    }
    return send(res, 200, JSON.stringify(items), { 'Content-Type': 'application/json' });
  }

  if (url.pathname === '/api/canvas/override' && req.method === 'POST') {
    const b = JSON.parse(await readBody(req));
    const type = String(b.plannable_type ?? '');
    const id = String(b.plannable_id ?? '');
    if (!/^[a-z_]+$/.test(type) || !/^\d+$/.test(id)) return send(res, 400, 'bad item');
    const overrideId = b.override_id != null && /^\d+$/.test(String(b.override_id)) ? String(b.override_id) : null;
    const r = await fetch(overrideId ? `https://${host}/api/v1/planner/overrides/${overrideId}` : `https://${host}/api/v1/planner/overrides`, {
      method: overrideId ? 'PUT' : 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(overrideId ? { marked_complete: !!b.marked_complete } : { plannable_type: type, plannable_id: Number(id), marked_complete: !!b.marked_complete }),
      signal: AbortSignal.timeout(15000),
    });
    return send(res, r.ok ? 200 : 502, await r.text(), { 'Content-Type': 'application/json' });
  }
  return send(res, 404, 'not found');
}

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
      // Same-origin only: a page on another site must not be able to overwrite the board.
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, 'cross-origin write refused');
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
    const feed = allowedFeed(url.searchParams.get('url') ?? '');
    if (!feed) return send(res, 400, 'Only Google Calendar, Canvas, iCloud and Outlook calendar feeds are allowed.');
    const r = await fetch(feed, { headers: { 'User-Agent': 'planner-local/1.0' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!r.ok) return send(res, 502, `Feed answered HTTP ${r.status}`);
    return send(res, 200, await r.text(), { 'Content-Type': 'text/calendar; charset=utf-8' });
  }

  if (url.pathname.startsWith('/api/canvas/')) return canvas(req, res, url);

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
