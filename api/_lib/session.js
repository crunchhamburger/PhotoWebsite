// Signed, expiring cookie values (HMAC-SHA256) for the owner-only research view.
// A value is base64url(JSON payload) + "." + base64url(signature). Nothing secret is stored in
// it; the signature only proves this server issued it. Verification is constant-time.
import { createHmac, timingSafeEqual, randomBytes, createHash } from 'node:crypto';

const b64 = (buf) => Buffer.from(buf).toString('base64url');

export function sign(payload, secret) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(createHmac('sha256', secret).update(body).digest())}`;
}

/** Returns the payload if the signature is valid and it hasn't expired (`exp`, seconds); else null. */
export function verify(value, secret, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const dot = value.indexOf('.');
  if (dot < 1) return null;
  const body = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), 'base64url');
  const expected = createHmac('sha256', secret).update(body).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;
  return payload;
}

export const randomToken = (bytes = 32) => b64(randomBytes(bytes));
/** PKCE S256 challenge for a verifier. */
export const pkceChallenge = (verifier) => b64(createHash('sha256').update(verifier).digest());

export function parseCookies(header) {
  const out = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** A __Host- cookie: Secure, Path=/, no Domain, HttpOnly. */
export function cookie(name, value, { maxAge, sameSite = 'Lax' } = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'Secure', 'HttpOnly', `SameSite=${sameSite}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}
