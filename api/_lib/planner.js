// The owner-only planner at /planner (vercel.json rewrites /planner and /planner/* to api/planner.js).
// The rest of the site stays static; the planner's files are bundled into this function and only
// served after sign-in, so nothing of it is in the public build output.
//
// Security model
// - One owner. Sign-in is a password (PLANNER_PASSWORD, at least 12 characters) compared in
//   constant time; failures are slowed down. The session is an HMAC-signed __Host- cookie
//   (HttpOnly, Secure, SameSite=Lax, 30 days) keyed with PLANNER_SECRET.
// - Every route except the login page requires the session, including the app's own files, the
//   3D models and the board data. Writes and logout are same-origin only.
// - Board data and the 3D models live in a private Vercel Blob store (no public URLs).
// - Calendar and Canvas proxies only fetch allowlisted hosts (planner/proxy.mjs).
// - Responses are private, no-store (models: private cache), noindex, no-referrer.
// - Missing configuration fails closed: every route answers 503.
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { sign, verify, parseCookies, cookie, randomToken } from './session.js';
import { fetchFeed, canvasApi } from '../../planner/proxy.mjs';

const SESSION = '__Host-planner_session';
const SESSION_DAYS = 30;
const MAX_BODY = 5 * 1024 * 1024;
const MODELS = new Set(['nailong', 'naiwa', 'naidan', 'laoshu']);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
};

/** Reads configuration from environment variables. `missing` lists what isn't set. */
export function configFromEnv(env) {
  const missing = [];
  const password = normalizePassword(env.PLANNER_PASSWORD);
  if (password.length < 12) missing.push('PLANNER_PASSWORD (at least 12 characters)');
  if (!env.PLANNER_SECRET || env.PLANNER_SECRET.length < 32) missing.push('PLANNER_SECRET (at least 32 characters)');
  if (!env.BLOB_READ_WRITE_TOKEN && !env.BLOB_STORE_ID) missing.push('Blob store (BLOB_READ_WRITE_TOKEN)');
  return { missing, password, secret: env.PLANNER_SECRET };
}

/** The private Blob store, behind a small interface so tests can swap it. */
export function blobStore() {
  let mod;
  const lib = async () => (mod ??= await import('@vercel/blob'));
  return {
    async get(pathname, { fresh = false } = {}) {
      const { get } = await lib();
      const r = await get(pathname, { access: 'private', useCache: !fresh });
      if (!r || r.statusCode !== 200) return null;
      return { body: r.stream, contentType: r.blob.contentType, size: r.blob.size };
    },
    async put(pathname, body, contentType) {
      const { put } = await lib();
      await put(pathname, body, { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType, cacheControlMaxAge: 60 });
    },
  };
}

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function respond(status, body, headers = {}) {
  const { 'Set-Cookie': cookies, ...rest } = headers;
  const h = new Headers({ ...BASE_HEADERS, ...rest });
  for (const c of [].concat(cookies ?? [])) h.append('Set-Cookie', c);
  return new Response(body, { status, headers: h });
}
const text = (status, msg, headers = {}) => respond(status, msg, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
const redirect = (location, headers = {}) => respond(303, null, { Location: location, ...headers });

const sha = (s) => createHash('sha256').update(String(s)).digest();

/**
 * The stored and typed password are compared after this, so a value pasted into the Vercel
 * dashboard with a stray space or line break, or typed with full-width characters, still matches.
 */
export const normalizePassword = (s) => String(s ?? '').normalize('NFKC').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Builds the request handler. Options:
 *   config   from configFromEnv (production) or a test config
 *   store    the private store (blobStore() in production)
 *   root     directory holding the planner's files (planner/public)
 *   now      clock (tests)
 */
export function createPlannerHandler({ config, store, root = resolve(process.cwd(), 'planner/public'), now = () => Date.now(), delay = 800 }) {
  const configured = config && !config.missing.length && store;
  const ROOT = resolve(root);

  function session(request) {
    const p = verify(parseCookies(request.headers.get('cookie'))[SESSION], config.secret, now());
    return p && p.sub === 'owner' ? p : null;
  }

  return async function handle(request) {
    if (!configured) return page(503, 'Not configured', '<h1>Planner not configured</h1><p>The private planner needs its password, session secret and private storage. Nothing is served until they are set.</p>');
    const url = new URL(request.url);
    // Vercel rewrites /planner/<path> to /api/planner?__path=<path>; locally the path arrives as is.
    let rest = url.pathname.startsWith('/planner') ? url.pathname.slice('/planner'.length) : url.searchParams.get('__path') ? `/${url.searchParams.get('__path')}` : '';
    rest = rest.replace(/^\/+/, '');
    const method = request.method.toUpperCase();
    const sameOrigin = () => {
      const o = request.headers.get('origin');
      return !o || o === url.origin;
    };

    try {
      if (rest === 'login') {
        if (method === 'GET') return session(request) ? redirect('/planner') : loginPage();
        if (method !== 'POST') return text(405, 'Method not allowed', { Allow: 'GET, POST' });
        if (!sameOrigin()) return text(403, 'Cross-site sign-in refused');
        const form = new URLSearchParams(await readText(request, 4096));
        const given = normalizePassword(form.get('password'));
        if (!timingSafeEqual(sha(given), sha(config.password))) {
          await sleep(delay);
          return loginPage('That password isn’t right.', 401);
        }
        const exp = Math.floor(now() / 1000) + SESSION_DAYS * 86400;
        const value = sign({ sub: 'owner', iat: Math.floor(now() / 1000), exp, n: randomToken(8) }, config.secret);
        return redirect('/planner', { 'Set-Cookie': cookie(SESSION, value, { maxAge: SESSION_DAYS * 86400 }) });
      }
      if (rest === 'logout') {
        if (method !== 'POST') return text(405, 'Method not allowed', { Allow: 'POST' });
        if (!sameOrigin()) return text(403, 'Cross-site sign-out refused');
        return redirect('/planner/login', { 'Set-Cookie': cookie(SESSION, '', { maxAge: 0 }) });
      }

      if (!session(request)) {
        if (method === 'GET' && (rest === '' || rest === 'index.html')) return redirect('/planner/login');
        return text(401, 'Sign in required');
      }

      // ---- API ----
      if (rest === 'api/state') {
        if (method === 'GET' || method === 'HEAD') {
          const obj = await store.get('board.json', { fresh: true });
          if (!obj) return respond(204, null);
          return respond(200, method === 'HEAD' ? null : obj.body, { 'Content-Type': 'application/json' });
        }
        if (method === 'PUT') {
          if (!sameOrigin()) return text(403, 'Cross-origin write refused');
          const body = await readText(request, MAX_BODY);
          JSON.parse(body); // reject anything that isn't JSON
          await store.put('board.json', body, 'application/json');
          return respond(204, null);
        }
        return text(405, 'Method not allowed', { Allow: 'GET, PUT' });
      }
      if (rest === 'api/ics') {
        const r = await fetchFeed(url.searchParams.get('url'));
        return respond(r.status, r.body, { 'Content-Type': r.type });
      }
      if (rest.startsWith('api/canvas/')) {
        if (!sameOrigin()) return text(403, 'Cross-origin request refused');
        const r = await canvasApi(rest.slice('api/canvas/'.length), method, url.searchParams, request.headers.get('x-canvas-token'), () => readText(request, 65536));
        return respond(r.status, r.body, { 'Content-Type': r.type });
      }

      if (method !== 'GET' && method !== 'HEAD') return text(405, 'Method not allowed', { Allow: 'GET' });

      // ---- 3D models (private store) ----
      const model = /^models\/([a-z]+)\.glb$/.exec(rest);
      if (model) {
        if (!MODELS.has(model[1])) return text(404, 'Not found');
        const obj = await store.get(`models/${model[1]}.glb`);
        if (!obj) return text(404, 'Not found');
        return respond(200, method === 'HEAD' ? null : obj.body, {
          'Content-Type': 'model/gltf-binary',
          ...(obj.size ? { 'Content-Length': String(obj.size) } : {}),
          'Cache-Control': 'private, max-age=86400',
        });
      }

      // ---- The app's own files ----
      const rel = rest === '' ? 'index.html' : rest;
      if (rel.startsWith('dev/') || rel.startsWith('models/') || rel.split('/').some((s) => s === '..' || s.startsWith('.'))) return text(404, 'Not found');
      const file = resolve(ROOT, rel);
      if (!file.startsWith(ROOT + sep)) return text(404, 'Not found');
      let body;
      try {
        body = await readFile(file);
      } catch {
        return text(404, 'Not found');
      }
      const type = TYPES[extname(file)] ?? 'application/octet-stream';
      if (rel === 'index.html') body = hostedIndex(body.toString('utf8'));
      return respond(200, method === 'HEAD' ? null : body, {
        'Content-Type': type,
        // Code can be cached privately for a while; the page itself is always fresh.
        'Cache-Control': rel === 'index.html' ? 'private, no-store, max-age=0' : 'private, max-age=300',
      });
    } catch (e) {
      if (e.status) return text(e.status, e.message);
      if (e instanceof SyntaxError) return text(400, 'Not JSON');
      console.error('planner error', e);
      return text(502, 'Something went wrong. Try again in a minute.');
    }
  };

  function loginPage(error = '', status = 200) {
    return page(status, 'Sign in', `<form method="post" action="/planner/login" class="card">
      <div class="mark" aria-hidden="true"></div>
      <h1>Planner</h1>
      <p class="meta">Private. Owner only.</p>
      ${error ? `<p class="err" role="alert">${error}</p>` : ''}
      <label for="pw">Password</label>
      <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Sign in</button>
    </form>`);
  }
}

/** The app's index.html as served on the site: base path and API paths under /planner. */
export function hostedIndex(html) {
  return html
    .replace('<head>', '<head>\n  <base href="/planner/">')
    .replace('content="/api/state"', 'content="/planner/api/state"')
    .replace('content="/api/ics"', 'content="/planner/api/ics"')
    .replace('content="/api/canvas"', 'content="/planner/api/canvas"')
    .replace('<meta name="planner-api"', '<meta name="planner-hosted" content="1">\n  <meta name="planner-api"');
}

async function readText(request, limit) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > limit) throw Object.assign(new Error('too large'), { status: 413 });
  const t = await request.text();
  if (t.length > limit) throw Object.assign(new Error('too large'), { status: 413 });
  return t;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(status, title, body) {
  return respond(status, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} — Planner</title><style>
:root{color-scheme:light dark;--bg:#0b0b0c;--elev:#141416;--fg:#ecebe8;--muted:#9a9894;--line:#262628;--accent:#d8ff5a;--ink:#0b0b0c;--err:#ff6b6b}
@media (prefers-color-scheme:light){:root{--bg:#f6f5f2;--elev:#fff;--fg:#141414;--muted:#5f5d59;--line:#dddbd6;--accent:#3a46ff;--ink:#fff;--err:#d93838}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 'Inter',system-ui,-apple-system,sans-serif;padding:16px}
.card{width:min(360px,100%);background:var(--elev);border:1px solid var(--line);border-radius:16px;padding:28px;display:grid;gap:10px;box-shadow:0 20px 60px rgb(0 0 0 / .25)}
.mark{width:28px;height:28px;border-radius:8px;background:conic-gradient(var(--accent) 0 25%,#7cc7ff 0 50%,#ff9e7a 0 75%,#c79bff 0)}
h1{margin:4px 0 0;font-size:22px;font-weight:600}.meta{margin:0 0 6px;color:var(--muted);font-size:14px}
label{font-size:13px;color:var(--muted)}input{font:inherit;height:42px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg);outline:none}
input:focus{border-color:var(--accent)}button{font:inherit;font-weight:600;height:42px;border:0;border-radius:10px;background:var(--accent);color:var(--ink);cursor:pointer;margin-top:6px}
.err{margin:0;color:var(--err);font-size:14px}
</style></head><body>${body}</body></html>`, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
}
