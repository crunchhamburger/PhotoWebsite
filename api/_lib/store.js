// Where the research view reads episodes and screenshots from.
//   r2Store: a private Cloudflare R2 bucket, read with a read-only key (production).
//   localStore: a folder on this Mac (scripts/research-local.mjs; never used on Vercel).
// Layout (written by ~/Market Briefs/scripts/upload-research.mjs):
//   index.json                         episodes, newest first
//   episodes/<slug>/meta.json          title, date, public URL, charts [{file, caption, url, source, inStore}]
//   episodes/<slug>/brief.html         the brief text (same as the public page)
//   episodes/<slug>/img/<file>         saved screenshots
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { signRequest, objectUrl } from './sigv4.js';

const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', json: 'application/json', html: 'text/html; charset=utf-8' };
const typeOf = (key) => TYPES[key.split('.').pop().toLowerCase()] ?? 'application/octet-stream';

export function r2Store({ accountId, bucket, accessKeyId, secretAccessKey, endpoint, fetchImpl = fetch }) {
  const base = endpoint ?? `https://${accountId}.r2.cloudflarestorage.com`;
  const host = new URL(base).host;
  return {
    async get(key) {
      const path = `/${bucket}/${key}`;
      const headers = signRequest({ method: 'GET', host, path, accessKeyId, secretAccessKey });
      const res = await fetchImpl(objectUrl(base, path), { headers, signal: AbortSignal.timeout(15000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 GET ${key}: HTTP ${res.status}`);
      return { body: res.body, contentType: res.headers.get('content-type') || typeOf(key), size: Number(res.headers.get('content-length')) || undefined };
    },
  };
}

export function localStore(root) {
  const base = resolve(root);
  return {
    async get(key) {
      const file = resolve(base, key);
      if (!file.startsWith(base + sep)) return null;
      try {
        const s = await stat(file);
        if (!s.isFile()) return null;
        return { body: await readFile(file), contentType: typeOf(key), size: s.size };
      } catch {
        return null;
      }
    },
  };
}

/** Reads a JSON or text object, or null. */
export async function getText(store, key) {
  const obj = await store.get(key);
  if (!obj) return null;
  if (Buffer.isBuffer(obj.body)) return obj.body.toString('utf8');
  return new Response(obj.body).text();
}
