#!/usr/bin/env node
// The research view on this Mac only: every saved screenshot, straight from the local store
// that ~/Market Briefs/scripts/upload-research.mjs builds (~/Market Briefs/research-store).
// Nothing is uploaded. Listens on 127.0.0.1 only and refuses any non-loopback connection,
// which is why it needs no sign-in.
//   npm run research:local     → http://127.0.0.1:4330/research
import { createServer } from 'node:http';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Readable } from 'node:stream';
import { createHandler } from '../api/_lib/handler.js';
import { localStore } from '../api/_lib/store.js';

const root = process.env.RESEARCH_STORE || join(process.env.MARKET_BRIEFS_DIR || join(homedir(), 'Market Briefs'), 'research-store');
const port = Number(process.env.PORT || 4330);
const handle = createHandler({ store: localStore(root), requireAuth: false });
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

createServer(async (req, res) => {
  if (!LOOPBACK.has(req.socket.remoteAddress)) {
    res.writeHead(403).end('Local only');
    return;
  }
  if (req.url === '/' || req.url === '') {
    res.writeHead(302, { Location: '/research' }).end();
    return;
  }
  const response = await handle(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body).pipe(res);
  else res.end();
}).listen(port, '127.0.0.1', () => console.log(`Research view (local only): http://127.0.0.1:${port}/research  ←  ${root}`));
