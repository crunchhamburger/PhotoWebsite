// node --test planner/test/hosted.test.mjs
// The private /planner function: sign-in, access control, board storage, models, file serving.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlannerHandler, configFromEnv, hostedIndex } from '../../api/_lib/planner.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const ORIGIN = 'https://www.haozhewang.com';
const env = { PLANNER_PASSWORD: 'correct horse battery', PLANNER_SECRET: 'x'.repeat(40), BLOB_READ_WRITE_TOKEN: 'test' };

function memoryStore() {
  const m = new Map([['models/naiwa.glb', { body: 'GLB', contentType: 'model/gltf-binary', size: 3 }]]);
  return {
    m,
    async get(p) { return m.get(p) ?? null; },
    async put(p, body, contentType) { m.set(p, { body, contentType, size: body.length }); },
  };
}

function setup() {
  const store = memoryStore();
  const handle = createPlannerHandler({ config: configFromEnv(env), store, root, delay: 0 });
  const req = (path, init = {}) => handle(new Request(ORIGIN + path, init));
  const login = async (password = env.PLANNER_PASSWORD) => {
    const r = await req('/planner/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }, body: new URLSearchParams({ password }) });
    const set = r.headers.get('set-cookie') ?? '';
    return { r, cookie: set.split(';')[0] };
  };
  return { store, req, login };
}

test('fails closed without configuration', async () => {
  const handle = createPlannerHandler({ config: configFromEnv({ PLANNER_PASSWORD: 'short' }), store: memoryStore(), root });
  assert.equal((await handle(new Request(ORIGIN + '/planner/'))).status, 503);
  assert.equal((await handle(new Request(ORIGIN + '/planner/js/app.js'))).status, 503);
});

test('everything but the login page needs a session', async () => {
  const { req } = setup();
  const page = await req('/planner/');
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('location'), '/planner/login');
  for (const p of ['/planner/js/app.js', '/planner/api/state', '/planner/models/naiwa.glb', '/planner/api/ics?url=x']) {
    assert.equal((await req(p)).status, 401, p);
  }
  const lp = await req('/planner/login');
  assert.equal(lp.status, 200);
  assert.match(await lp.text(), /type="password"/);
  assert.match(lp.headers.get('x-robots-tag'), /noindex/);
});

test('wrong password is refused; right one sets a secure 30-day cookie', async () => {
  const { login } = setup();
  const bad = await login('nope');
  assert.equal(bad.r.status, 401);
  assert.equal(bad.r.headers.get('set-cookie'), null);
  const good = await login();
  assert.equal(good.r.status, 303);
  const set = good.r.headers.get('set-cookie');
  assert.match(set, /^__Host-planner_session=/);
  assert.match(set, /HttpOnly/);
  assert.match(set, /Secure/);
  assert.match(set, /Max-Age=2592000/);
});

test('cross-site sign-in and writes are refused', async () => {
  const { req, login } = setup();
  const r = await req('/planner/login', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(env.PLANNER_PASSWORD) });
  assert.equal(r.status, 403);
  const { cookie } = await login();
  const w = await req('/planner/api/state', { method: 'PUT', headers: { cookie, origin: 'https://evil.example' }, body: '{}' });
  assert.equal(w.status, 403);
});

test('signed in: app, board, models; no traversal or dev files', async () => {
  const { req, login, store } = setup();
  const { cookie } = await login();
  const h = { cookie };

  const index = await req('/planner/', { headers: h });
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.match(html, /<base href="\/planner\/">/);
  assert.match(html, /content="\/planner\/api\/state"/);
  assert.match(html, /planner-hosted/);
  assert.match(index.headers.get('cache-control'), /no-store/);

  const js = await req('/planner/js/app.js', { headers: h });
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);

  assert.equal((await req('/planner/api/state', { headers: h })).status, 204);
  const put = await req('/planner/api/state', { method: 'PUT', headers: { ...h, origin: ORIGIN }, body: '{"cards":[]}' });
  assert.equal(put.status, 204);
  assert.equal(store.m.get('board.json').body, '{"cards":[]}');
  const bad = await req('/planner/api/state', { method: 'PUT', headers: { ...h, origin: ORIGIN }, body: 'not json' });
  assert.equal(bad.status, 400);

  const glb = await req('/planner/models/naiwa.glb', { headers: h });
  assert.equal(glb.status, 200);
  assert.equal(glb.headers.get('content-type'), 'model/gltf-binary');
  assert.equal((await req('/planner/models/other.glb', { headers: h })).status, 404);

  for (const p of ['/api/planner?__path=../server.mjs', '/api/planner?__path=js/../../proxy.mjs', '/planner/dev/models.html', '/planner/.env', '/api/planner?__path=models/../../server.mjs']) {
    assert.equal((await req(p, { headers: h })).status, 404, p);
  }

  const out = await req('/planner/logout', { method: 'POST', headers: { ...h, origin: ORIGIN } });
  assert.equal(out.status, 303);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});

test('a forged or expired cookie is not a session', async () => {
  const { req } = setup();
  assert.equal((await req('/planner/api/state', { headers: { cookie: '__Host-planner_session=eyJzdWIiOiJvd25lciJ9.bad' } })).status, 401);
});

test('hostedIndex rewrites paths only', () => {
  const out = hostedIndex('<head><meta name="planner-api" content="/api/state"><meta name="planner-ics" content="/api/ics"><meta name="planner-canvas" content="/api/canvas">');
  assert.match(out, /<base href="\/planner\/">/);
  assert.match(out, /\/planner\/api\/ics/);
  assert.match(out, /\/planner\/api\/canvas/);
});
