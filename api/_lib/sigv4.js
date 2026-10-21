// AWS Signature Version 4 for S3-compatible requests (Cloudflare R2), using only node:crypto.
// R2 uses region "auto" and service "s3". Tested against AWS's published GET Object example
// (scripts/test/research.test.mjs).
import { createHash, createHmac } from 'node:crypto';

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
export const EMPTY_SHA256 = sha256Hex('');

// RFC 3986 encoding of each path segment, as S3 expects.
const encodeSegment = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Returns the headers to send (including Authorization) for one request.
 * `path` is the decoded object path, e.g. "/bucket/episodes/2026-10-20/img/a.png".
 * `payloadHash` is the hex SHA-256 of the body (EMPTY_SHA256 for GET/DELETE).
 */
export function signRequest({ method, host, path, query = {}, headers = {}, payloadHash = EMPTY_SHA256, accessKeyId, secretAccessKey, region = 'auto', service = 's3', now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${all[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalPath = path.split('/').map(encodeSegment).join('/');
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeSegment(k)}=${encodeSegment(query[k])}`)
    .join('&');
  const canonicalRequest = [method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
  return {
    ...all,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** The URL for an object path, encoded the same way as the signature. */
export const objectUrl = (endpoint, path) => `${endpoint}${path.split('/').map(encodeSegment).join('/')}`;
