// Calendar-feed and Canvas API proxying, shared by the local server (planner/server.mjs) and the
// website function (api/_lib/planner.js). Only allowlisted hosts are fetched, so neither can be
// used as an open proxy. Results are { status, body, type }.

/** Feeds the proxy will fetch: Google Calendar, Canvas, iCloud and Outlook. Returns a URL or null. */
export function allowedFeed(raw) {
  let u;
  try {
    u = new URL(String(raw ?? '').replace(/^webcal:/i, 'https:'));
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

const text = (status, body) => ({ status, body, type: 'text/plain; charset=utf-8' });
const json = (status, body) => ({ status, body, type: 'application/json' });

export async function fetchFeed(rawUrl) {
  const feed = allowedFeed(rawUrl);
  if (!feed) return text(400, 'Only Google Calendar, Canvas, iCloud and Outlook calendar feeds are allowed.');
  const r = await fetch(feed, { headers: { 'User-Agent': 'planner/1.0' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!r.ok) return text(502, `Feed answered HTTP ${r.status}`);
  return { status: 200, body: await r.text(), type: 'text/calendar; charset=utf-8' };
}

/**
 * Canvas REST API (planner items, mark complete). The personal access token comes from the
 * browser on each call and is never stored. `sub` is 'planner' or 'override'.
 */
export async function canvasApi(sub, method, params, token, readBody) {
  const host = allowedCanvasHost(params.get('host'));
  if (!host) return text(400, 'Canvas host must end in .instructure.com or .edu');
  if (!token) return text(400, 'Missing Canvas token');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  if (sub === 'planner' && method === 'GET') {
    const q = new URLSearchParams({ start_date: params.get('start_date') ?? '', end_date: params.get('end_date') ?? '', per_page: '100' });
    let next = `https://${host}/api/v1/planner/items?${q}`;
    const items = [];
    for (let page = 0; next && page < 20; page++) {
      const r = await fetch(next, { headers, signal: AbortSignal.timeout(15000) });
      if (r.status === 401) return text(401, 'Canvas rejected the access token');
      if (!r.ok) return text(502, `Canvas answered HTTP ${r.status}`);
      items.push(...(await r.json()));
      next = /<([^>]+)>;\s*rel="next"/.exec(r.headers.get('link') ?? '')?.[1] ?? null;
      if (next && new URL(next).host !== host) next = null;
    }
    return json(200, JSON.stringify(items));
  }

  if (sub === 'override' && method === 'POST') {
    const b = JSON.parse(await readBody());
    const type = String(b.plannable_type ?? '');
    const id = String(b.plannable_id ?? '');
    if (!/^[a-z_]+$/.test(type) || !/^\d+$/.test(id)) return text(400, 'bad item');
    const overrideId = b.override_id != null && /^\d+$/.test(String(b.override_id)) ? String(b.override_id) : null;
    const r = await fetch(overrideId ? `https://${host}/api/v1/planner/overrides/${overrideId}` : `https://${host}/api/v1/planner/overrides`, {
      method: overrideId ? 'PUT' : 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(overrideId ? { marked_complete: !!b.marked_complete } : { plannable_type: type, plannable_id: Number(id), marked_complete: !!b.marked_complete }),
      signal: AbortSignal.timeout(15000),
    });
    return json(r.ok ? 200 : 502, await r.text());
  }
  return text(404, 'not found');
}
