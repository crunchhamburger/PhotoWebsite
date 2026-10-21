// Tests for the owner-only research view (api/_lib). Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { signRequest } from '../../api/_lib/sigv4.js';
import { sign, verify } from '../../api/_lib/session.js';
import { createHandler, configFromEnv } from '../../api/_lib/handler.js';
import { r2Store } from '../../api/_lib/store.js';

const SECRET = 'x'.repeat(40);
const OWNER = '4242';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const objects = {
  'index.json': JSON.stringify([{ slug: '2026-10-20', title: 'Daily Market Brief — Tue, Oct 20, 2026', kind: 'daily', charts: 1, stored: 1 }]),
  'episodes/2026-10-20/meta.json': JSON.stringify({ title: 'Daily <b>Brief</b>', date: '2026-10-20', publicUrl: 'https://www.haozhewang.com/podcast/2026-10-20', charts: [{ file: 'ft-01-x.png', caption: 'A chart', url: 'https://www.ft.com/x', source: 'FT', inStore: true }] }),
  'episodes/2026-10-20/brief.html': '<h2>Article Takeaways</h2><p>Text</p>',
  'episodes/2026-10-20/img/ft-01-x.png': PNG,
};
const memStore = { async get(key) { const v = objects[key]; return v === undefined ? null : { body: Buffer.from(v), contentType: key.endsWith('.png') ? 'image/png' : 'application/json', size: Buffer.byteLength(v) }; } };
const config = { missing: [], origin: 'https://www.haozhewang.com', clientId: 'cid', clientSecret: 'csecret', ownerId: OWNER, secret: SECRET };
const now = () => Date.parse('2026-10-21T12:00:00Z');
const H = 'https://www.haozhewang.com';
const ownerCookie = (o = {}) => `__Host-research_session=${sign({ sub: OWNER, iat: 0, exp: Math.floor(now() / 1000) + 3600, ...o }, SECRET)}`;
const req = (path, { cookie, method = 'GET', headers = {} } = {}) => new Request(H + path, { method, headers: { ...(cookie ? { cookie } : {}), ...headers } });

function githubFake({ userId = Number(OWNER), token = 'gho_test' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/login/oauth/access_token')) return Response.json(token ? { access_token: token } : { error: 'bad_verification_code' });
    if (String(url).endsWith('/user')) return Response.json({ id: userId, login: 'someone' });
    return new Response(null, { status: 204 });
  };
  return { fetchImpl, calls };
}

test('SigV4 matches the AWS S3 GET Object example', () => {
  const h = signRequest({ method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', headers: { Range: 'bytes=0-9' }, accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', now: new Date('2013-05-24T00:00:00Z') });
  assert.match(h.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

test('signed values: tampering, wrong key and expiry are rejected', () => {
  const v = sign({ sub: OWNER, exp: 2_000_000_000 }, SECRET);
  assert.equal(verify(v, SECRET).sub, OWNER);
  assert.equal(verify(v, 'y'.repeat(40)), null);
  const [body, sig] = v.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: OWNER, exp: 2_100_000_000 })).toString('base64url');
  assert.equal(verify(`${forged}.${sig}`, SECRET), null);
  assert.equal(verify(sign({ sub: OWNER, exp: 1 }, SECRET), SECRET), null);
  assert.equal(verify('garbage', SECRET), null);
  assert.ok(body);
});

test('fails closed (503) when configuration is missing', async () => {
  const cfg = configFromEnv({});
  assert.ok(cfg.missing.length >= 8);
  const handle = createHandler({ config: cfg });
  for (const p of ['/research', '/research/img/2026-10-20/ft-01-x.png', '/research/login']) {
    const r = await handle(req(p, { cookie: ownerCookie() }));
    assert.equal(r.status, 503, p);
  }
  assert.ok(configFromEnv({ RESEARCH_SESSION_SECRET: 'short' }).missing.some((m) => m.includes('32')));
});

test('images require a valid owner session on every request', async () => {
  const handle = createHandler({ config, store: memStore, now });
  const img = '/research/img/2026-10-20/ft-01-x.png';
  const anon = await handle(req(img));
  assert.equal(anon.status, 401);
  assert.equal((await anon.arrayBuffer()).byteLength < 50, true);
  assert.equal((await handle(req(img, { cookie: '__Host-research_session=abc.def' }))).status, 401);
  assert.equal((await handle(req(img, { cookie: ownerCookie({ exp: 1 }) }))).status, 401);
  assert.equal((await handle(req(img, { cookie: ownerCookie({ sub: '999' }) }))).status, 401);
  const ok = await handle(req(img, { cookie: ownerCookie() }));
  assert.equal(ok.status, 200);
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), PNG);
  assert.equal(ok.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.match(ok.headers.get('x-robots-tag'), /noindex/);
  assert.equal(ok.headers.get('cross-origin-resource-policy'), 'same-origin');
});

test('rejects path tricks and unknown objects', async () => {
  const handle = createHandler({ config, store: memStore, now });
  const c = ownerCookie();
  for (const p of ['/research/img/2026-10-20/../../index.json', '/research/img/2026-10-20/%2e%2e%2fmeta.json', '/research/img/../episodes/x.png', '/research/img/2026-10-20/meta.json', '/research/img/2026-10-20/nope.png', '/research/img/evil/ft-01-x.png']) {
    const r = await handle(req(p, { cookie: c }));
    assert.ok([400, 404].includes(r.status), `${p} → ${r.status}`);
  }
});

test('pages: login prompt without a session, content with one; HTML is escaped and locked down', async () => {
  const handle = createHandler({ config, store: memStore, now });
  const anon = await handle(req('/research/2026-10-20'));
  assert.equal(anon.status, 401);
  assert.doesNotMatch(await anon.text(), /Article Takeaways/);
  const r = await handle(req('/research/2026-10-20', { cookie: ownerCookie() }));
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /Article Takeaways/);
  assert.match(body, /Daily &lt;b&gt;Brief&lt;\/b&gt;/);
  assert.match(body, /\/research\/img\/2026-10-20\/ft-01-x\.png/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.doesNotMatch(r.headers.get('content-security-policy'), /script-src/);
  const index = await handle(req('/research', { cookie: ownerCookie() }));
  assert.match(await index.text(), /1 of 1 screenshots stored/);
});

test('OAuth: state, PKCE, owner check, token revocation, safe redirects', async () => {
  const gh = githubFake();
  const handle = createHandler({ config, store: memStore, now, fetchImpl: gh.fetchImpl });
  const start = await handle(req('/research/login?next=/research/2026-10-20'));
  assert.equal(start.status, 303);
  const auth = new URL(start.headers.get('location'));
  assert.equal(auth.origin + auth.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(auth.searchParams.get('redirect_uri'), 'https://www.haozhewang.com/research/callback');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  const flowCookie = start.headers.get('set-cookie');
  assert.match(flowCookie, /^__Host-research_oauth=.*; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
  const flow = flowCookie.split(';')[0];
  const state = auth.searchParams.get('state');

  // wrong state, missing flow cookie
  assert.equal((await handle(req(`/research/callback?code=c&state=nope`, { cookie: flow }))).status, 400);
  assert.equal((await handle(req(`/research/callback?code=c&state=${state}`))).status, 400);

  const ok = await handle(req(`/research/callback?code=c&state=${state}`, { cookie: flow }));
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/research/2026-10-20');
  const cookies = ok.headers.getSetCookie();
  assert.ok(cookies.some((c) => /^__Host-research_session=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200$/.test(c)));
  const tokenCall = gh.calls.find((c) => c.url.includes('access_token'));
  assert.ok(JSON.parse(tokenCall.init.body).code_verifier.length >= 43);
  assert.ok(gh.calls.some((c) => c.init.method === 'DELETE' && c.url.endsWith('/applications/cid/token')));

  // someone else's GitHub account
  const other = githubFake({ userId: 7 });
  const h2 = createHandler({ config, store: memStore, now, fetchImpl: other.fetchImpl });
  const s2 = await h2(req('/research/login'));
  const st2 = new URL(s2.headers.get('location')).searchParams.get('state');
  const denied = await h2(req(`/research/callback?code=c&state=${st2}`, { cookie: s2.headers.get('set-cookie').split(';')[0] }));
  assert.equal(denied.status, 403);
  assert.ok(!denied.headers.getSetCookie().some((c) => c.startsWith('__Host-research_session=') && !c.includes('Max-Age=0')));

  // open redirect attempts fall back to /research
  for (const next of ['https://evil.example', '//evil.example', '/podcast', '/research/../x']) {
    const s = await handle(req(`/research/login?next=${encodeURIComponent(next)}`));
    const st = new URL(s.headers.get('location')).searchParams.get('state');
    const done = await handle(req(`/research/callback?code=c&state=${st}`, { cookie: s.headers.get('set-cookie').split(';')[0] }));
    assert.equal(done.headers.get('location'), '/research', next);
  }
});

test('logout is POST-only and same-origin', async () => {
  const handle = createHandler({ config, store: memStore, now });
  assert.equal((await handle(req('/research/logout', { cookie: ownerCookie() }))).status, 405);
  assert.equal((await handle(req('/research/logout', { method: 'POST', cookie: ownerCookie(), headers: { origin: 'https://evil.example' } }))).status, 403);
  const out = await handle(req('/research/logout', { method: 'POST', cookie: ownerCookie(), headers: { origin: H } }));
  assert.equal(out.status, 303);
  assert.match(out.headers.get('set-cookie'), /__Host-research_session=; .*Max-Age=0/);
});

test('Vercel rewrite form (/api/research?__path=...) routes the same way', async () => {
  const handle = createHandler({ config, store: memStore, now });
  assert.equal((await handle(req('/api/research?__path=img/2026-10-20/ft-01-x.png'))).status, 401);
  assert.equal((await handle(req('/api/research?__path=img/2026-10-20/ft-01-x.png', { cookie: ownerCookie() }))).status, 200);
});

test('r2Store signs path-style requests and maps 404 to null', async () => {
  const seen = [];
  const server = createServer((rq, rs) => {
    seen.push({ url: rq.url, auth: rq.headers.authorization, sha: rq.headers['x-amz-content-sha256'] });
    if (rq.url.endsWith('missing.png')) return rs.writeHead(404).end();
    rs.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const store = r2Store({ bucket: 'research', accessKeyId: 'AK', secretAccessKey: 'SK', endpoint: `http://127.0.0.1:${server.address().port}` });
  const got = await store.get('episodes/2026-10-20/img/ft 01.png');
  assert.deepEqual(Buffer.from(await new Response(got.body).arrayBuffer()), PNG);
  assert.equal(await store.get('episodes/x/img/missing.png'), null);
  server.close();
  assert.equal(seen[0].url, '/research/episodes/2026-10-20/img/ft%2001.png');
  assert.match(seen[0].auth, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});
