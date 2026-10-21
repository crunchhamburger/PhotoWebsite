// The owner-only research view at /research: brief text beside the saved publisher screenshots.
// Runs as one Vercel function (api/research.js); the public site stays fully static.
//
// Security model
// - Sign in with GitHub (OAuth with state + PKCE). Only the GitHub account whose numeric id is
//   RESEARCH_OWNER_GITHUB_ID gets a session; the GitHub token is used once and revoked.
// - Session: __Host- cookie, HMAC-signed, HttpOnly, Secure, SameSite=Lax, 12 hours.
// - Every request is checked, images included: /research/img/... returns 401 without a valid
//   session, and images are streamed from the private R2 bucket through this function (no
//   public bucket, no signed URLs that could be shared).
// - Responses are private, no-store, noindex, no-referrer; HTML gets a strict CSP (no scripts).
// - Missing configuration fails closed: every route answers 503.
import { sign, verify, randomToken, pkceChallenge, parseCookies, cookie } from './session.js';
import { r2Store, getText } from './store.js';

const SESSION = '__Host-research_session';
const OAUTH = '__Host-research_oauth';
const SESSION_HOURS = 12;
const SLUG = /^\d{4}-\d{2}-\d{2}(-weekly)?$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|webp)$/;
const NEXT = /^\/research(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/; // no "." or ".." segments

const REQUIRED = [
  'RESEARCH_GITHUB_CLIENT_ID',
  'RESEARCH_GITHUB_CLIENT_SECRET',
  'RESEARCH_OWNER_GITHUB_ID',
  'RESEARCH_SESSION_SECRET',
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'R2_READ_ACCESS_KEY_ID',
  'R2_READ_SECRET_ACCESS_KEY',
];

/** Reads configuration from environment variables. `missing` lists what isn't set. */
export function configFromEnv(env) {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (env.RESEARCH_SESSION_SECRET && env.RESEARCH_SESSION_SECRET.length < 32) missing.push('RESEARCH_SESSION_SECRET (at least 32 characters)');
  if (env.RESEARCH_OWNER_GITHUB_ID && !/^\d+$/.test(env.RESEARCH_OWNER_GITHUB_ID)) missing.push('RESEARCH_OWNER_GITHUB_ID (numeric GitHub user id)');
  return {
    missing,
    origin: env.RESEARCH_ORIGIN || 'https://www.haozhewang.com',
    clientId: env.RESEARCH_GITHUB_CLIENT_ID,
    clientSecret: env.RESEARCH_GITHUB_CLIENT_SECRET,
    ownerId: env.RESEARCH_OWNER_GITHUB_ID,
    secret: env.RESEARCH_SESSION_SECRET,
    store: missing.length
      ? null
      : r2Store({
          accountId: env.R2_ACCOUNT_ID,
          bucket: env.R2_BUCKET,
          accessKeyId: env.R2_READ_ACCESS_KEY_ID,
          secretAccessKey: env.R2_READ_SECRET_ACCESS_KEY,
          endpoint: env.R2_ENDPOINT,
        }),
  };
}

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  Vary: 'Cookie',
};
const CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'; base-uri 'none'";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function respond(status, body, headers = {}) {
  const { 'Set-Cookie': cookies, ...rest } = headers;
  const h = new Headers({ ...BASE_HEADERS, ...rest });
  for (const c of [].concat(cookies ?? [])) h.append('Set-Cookie', c);
  return new Response(body, { status, headers: h });
}
const html = (status, title, body, headers = {}) =>
  respond(status, page(title, body), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, ...headers });
const text = (status, msg, headers = {}) => respond(status, msg, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
const redirect = (location, headers = {}) => respond(303, null, { Location: location, ...headers });

/**
 * Builds the request handler. Options:
 *   config      from configFromEnv (production) or a test config
 *   store       overrides config.store (tests, local mode)
 *   requireAuth false only for scripts/research-local.mjs on 127.0.0.1
 *   fetchImpl   for GitHub calls (tests)
 */
export function createHandler({ config, store = config?.store, requireAuth = true, fetchImpl = fetch, now = () => Date.now() }) {
  const configured = !requireAuth || (config && !config.missing.length && store);

  function session(request) {
    if (!requireAuth) return { sub: 'local' };
    const p = verify(parseCookies(request.headers.get('cookie'))[SESSION], config.secret, now());
    return p && p.sub === config.ownerId ? p : null;
  }

  return async function handle(request) {
    if (!configured) {
      return html(503, 'Not configured', `<h1>Research view not configured</h1><p>The owner-only view needs its GitHub sign-in and private storage settings. Nothing is served until they are set.</p>`);
    }
    const url = new URL(request.url);
    // Vercel rewrites /research/<path> to /api/research?__path=<path>; locally the path arrives as is.
    let path = url.pathname.replace(/\/+$/, '') || '/';
    if (!path.startsWith('/research')) path = '/research' + (url.searchParams.get('__path') ? `/${url.searchParams.get('__path')}` : '');
    path = path.replace(/\/+$/, '');
    const parts = path.split('/').slice(2).filter(Boolean);
    const method = request.method.toUpperCase();

    try {
      if (parts[0] === 'login' && method === 'GET') return login(url);
      if (parts[0] === 'callback' && method === 'GET') return await callback(request, url);
      if (parts[0] === 'logout') {
        if (method !== 'POST') return text(405, 'Method not allowed', { Allow: 'POST' });
        const origin = request.headers.get('origin');
        if (requireAuth && origin !== config.origin) return text(403, 'Cross-site logout refused');
        return redirect('/', { 'Set-Cookie': cookie(SESSION, '', { maxAge: 0 }) });
      }
      if (method !== 'GET' && method !== 'HEAD') return text(405, 'Method not allowed', { Allow: 'GET' });

      const user = session(request);
      if (parts[0] === 'img') {
        if (!user) return text(401, 'Sign in required');
        const [, slug, file] = parts;
        if (parts.length !== 3 || !SLUG.test(slug) || !FILE.test(file)) return text(404, 'Not found');
        const obj = await store.get(`episodes/${slug}/img/${file}`);
        if (!obj) return text(404, 'Not found');
        return respond(200, method === 'HEAD' ? null : obj.body, {
          'Content-Type': obj.contentType.startsWith('image/') ? obj.contentType : 'application/octet-stream',
          ...(obj.size ? { 'Content-Length': String(obj.size) } : {}),
          'Content-Disposition': 'inline',
          'Content-Security-Policy': "default-src 'none'",
        });
      }
      if (!user) return loginPage(path);
      if (parts.length === 0) return await indexPage();
      if (parts.length === 1 && SLUG.test(parts[0])) return await episodePage(parts[0]);
      return html(404, 'Not found', '<h1>Not found</h1><p><a href="/research">All episodes</a></p>');
    } catch (e) {
      console.error('research view error', e);
      return html(502, 'Error', '<h1>Something went wrong</h1><p>The private storage could not be read. Try again in a minute.</p>');
    }
  };

  function loginPage(next) {
    const n = NEXT.test(next) ? next : '/research';
    return html(401, 'Sign in', `<h1>Private research view</h1><p>This area is for the site owner only.</p><p><a class="btn" href="/research/login?next=${encodeURIComponent(n)}">Sign in with GitHub</a></p>`);
  }

  function login(url) {
    if (!requireAuth) return redirect('/research');
    const next = NEXT.test(url.searchParams.get('next') ?? '') ? url.searchParams.get('next') : '/research';
    const state = randomToken();
    const verifier = randomToken(48);
    const flow = sign({ state, verifier, next, exp: Math.floor(now() / 1000) + 600 }, config.secret);
    const auth = new URL('https://github.com/login/oauth/authorize');
    auth.searchParams.set('client_id', config.clientId);
    auth.searchParams.set('redirect_uri', `${config.origin}/research/callback`);
    auth.searchParams.set('state', state);
    auth.searchParams.set('code_challenge', pkceChallenge(verifier));
    auth.searchParams.set('code_challenge_method', 'S256');
    auth.searchParams.set('allow_signup', 'false');
    return redirect(auth.href, { 'Set-Cookie': cookie(OAUTH, flow, { maxAge: 600 }) });
  }

  async function callback(request, url) {
    if (!requireAuth) return redirect('/research');
    const clear = cookie(OAUTH, '', { maxAge: 0 });
    const flow = verify(parseCookies(request.headers.get('cookie'))[OAUTH], config.secret, now());
    const code = url.searchParams.get('code');
    if (!flow || !code || url.searchParams.get('state') !== flow.state) {
      return html(400, 'Sign-in failed', '<h1>Sign-in failed</h1><p>The sign-in link expired or was not started here. <a href="/research/login">Try again</a>.</p>', { 'Set-Cookie': clear });
    }
    const tokenRes = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: `${config.origin}/research/callback`, code_verifier: flow.verifier }),
      signal: AbortSignal.timeout(10000),
    });
    const token = (await tokenRes.json().catch(() => ({}))).access_token;
    if (!token) return html(400, 'Sign-in failed', '<h1>Sign-in failed</h1><p>GitHub did not confirm the sign-in. <a href="/research/login">Try again</a>.</p>', { 'Set-Cookie': clear });
    let user = {};
    try {
      const userRes = await fetchImpl('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'haozhewang-research' },
        signal: AbortSignal.timeout(10000),
      });
      user = await userRes.json().catch(() => ({}));
    } finally {
      // The token is only needed to read the account id: revoke it straight away (best effort).
      fetchImpl(`https://api.github.com/applications/${config.clientId}/token`, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`, Accept: 'application/vnd.github+json', 'User-Agent': 'haozhewang-research', 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: token }),
      }).catch(() => {});
    }
    if (String(user.id ?? '') !== config.ownerId) {
      return html(403, 'Private', '<h1>Private</h1><p>This area is only for the site owner.</p>', { 'Set-Cookie': clear });
    }
    const exp = Math.floor(now() / 1000) + SESSION_HOURS * 3600;
    const value = sign({ sub: config.ownerId, iat: Math.floor(now() / 1000), exp, n: randomToken(8) }, config.secret);
    return redirect(flow.next, { 'Set-Cookie': [clear, cookie(SESSION, value, { maxAge: SESSION_HOURS * 3600 })] });
  }

  async function indexPage() {
    const index = JSON.parse((await getText(store, 'index.json')) ?? '[]');
    const rows = index
      .map((e) => `<li><a href="/research/${esc(e.slug)}">${esc(e.title)}</a><span class="meta">${esc(e.kind)} · ${Number(e.stored) || 0} of ${Number(e.charts) || 0} screenshots stored</span></li>`)
      .join('');
    return html(200, 'Research', `${nav()}<h1>Research</h1><p class="meta">Briefs with the publishers' charts saved while reading them. Private: never shown on the public site.</p>${rows ? `<ul class="list">${rows}</ul>` : '<p>No episodes uploaded yet.</p>'}`);
  }

  async function episodePage(slug) {
    const metaText = await getText(store, `episodes/${slug}/meta.json`);
    if (!metaText) return html(404, 'Not found', `${nav()}<h1>Not found</h1>`);
    const meta = JSON.parse(metaText);
    const brief = (await getText(store, `episodes/${slug}/brief.html`)) ?? '';
    const charts = (meta.charts ?? [])
      .map((c) => {
        const img = c.inStore && FILE.test(c.file) ? `<a href="/research/img/${esc(slug)}/${esc(c.file)}"><img src="/research/img/${esc(slug)}/${esc(c.file)}" alt="${esc(c.caption)}" loading="lazy"></a>` : `<p class="missing">Screenshot kept on the Mac only (${esc(c.reason ?? 'not uploaded')}).</p>`;
        return `<figure>${img}<figcaption>${esc(c.caption)}${c.url ? ` <a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.source ?? 'Source')}</a>` : ''}</figcaption></figure>`;
      })
      .join('');
    return html(200, meta.title, `${nav()}<p class="meta">${esc(meta.date)} · <a href="${esc(meta.publicUrl)}">Public page</a></p><h1>${esc(meta.title)}</h1><div class="split"><article class="brief">${brief}</article><aside><h2>Saved charts</h2>${charts || '<p class="meta">No screenshots for this episode.</p>'}</aside></div>`);
  }

  function nav() {
    return `<nav><a href="/research">Research</a><span class="spacer"></span>${requireAuth ? '<form method="post" action="/research/logout"><button>Sign out</button></form>' : '<span class="meta">local mode</span>'}</nav>`;
  }
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} — Private</title><style>
:root{color-scheme:light dark;--bg:#f6f5f2;--elev:#fff;--fg:#141414;--muted:#5f5d59;--faint:#a3a19c;--line:#dddbd6;--accent:#3a46ff}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0c;--elev:#141416;--fg:#ecebe8;--muted:#9a9894;--faint:#5d5b58;--line:#262628;--accent:#d8ff5a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 'Inter',system-ui,-apple-system,sans-serif;padding:0 16px 64px}
main{max-width:1280px;margin:0 auto}nav{display:flex;align-items:center;gap:16px;padding:16px 0;border-bottom:1px solid var(--line);margin-bottom:24px}
.spacer{flex:1}a{color:var(--fg)}h1{font-weight:500;font-size:clamp(1.5rem,3vw,2.2rem);line-height:1.15;margin:.2em 0 .6em}
h2{font-weight:500;font-size:1.15rem;margin:1.6em 0 .6em}.meta{color:var(--muted);font-size:.85rem}
button,.btn{font:inherit;font-size:.9rem;padding:8px 14px;border:1px solid var(--line);border-radius:4px;background:var(--elev);color:var(--fg);cursor:pointer;text-decoration:none;display:inline-block}
.list{list-style:none;padding:0}.list li{display:flex;flex-wrap:wrap;gap:4px 16px;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--line)}
.split{display:grid;gap:32px}@media(min-width:1000px){.split{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}aside{position:sticky;top:16px;align-self:start;max-height:calc(100vh - 32px);overflow:auto}}
.brief table{border-collapse:collapse;width:100%;font-size:.9rem}.brief td,.brief th{border-bottom:1px solid var(--line);padding:6px 8px 6px 0;text-align:left}
.lede{background:var(--elev);border:1px solid var(--line);padding:12px 14px;border-radius:4px}
figure{margin:0 0 20px;padding:10px;background:var(--elev);border:1px solid var(--line);border-radius:4px}figure img{display:block;width:100%;height:auto;background:#fff;border-radius:2px}
figcaption{font-size:.85rem;color:var(--muted);margin-top:8px}.missing{font-size:.85rem;color:var(--faint);margin:0}
</style></head><body><main>${body}</main></body></html>`;
}
