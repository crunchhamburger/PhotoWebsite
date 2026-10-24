// Google Calendar through Google Identity Services (token model) + Calendar API v3.
// Needs an OAuth "Web application" client ID whose Authorized JavaScript origins include this
// page's origin (http://localhost:4310 locally, https://www.haozhewang.com on the site).
// The access token lives in sessionStorage for its ~1 hour lifetime; nothing is stored server-side.

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');
const TOKEN_KEY = 'planner.gtoken';
const API = 'https://www.googleapis.com/calendar/v3';

let gisLoaded = null;
let tokenClient = null;
let clientIdInUse = '';

function loadGis() {
  gisLoaded ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
  return gisLoaded;
}

function storedToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    return t && t.exp > Date.now() + 60000 ? t.token : null;
  } catch {
    return null;
  }
}

export const gcal = {
  get connected() {
    return !!storedToken();
  },

  /** Must be called from a click (Google opens a popup). */
  async connect(clientId, { prompt = '' } = {}) {
    await loadGis();
    if (!tokenClient || clientIdInUse !== clientId) {
      clientIdInUse = clientId;
      tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPES, callback: () => {} });
    }
    return new Promise((resolve, reject) => {
      tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: resp.access_token, exp: Date.now() + resp.expires_in * 1000 }));
        resolve(resp.access_token);
      };
      tokenClient.error_callback = (e) => reject(new Error(e?.message || 'Google sign-in was closed'));
      tokenClient.requestAccessToken({ prompt });
    });
  },

  disconnect() {
    const t = storedToken();
    sessionStorage.removeItem(TOKEN_KEY);
    if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
  },

  async call(path, opts = {}) {
    const token = storedToken();
    if (!token) throw Object.assign(new Error('Google Calendar session expired: reconnect in Settings'), { code: 'auth' });
    const r = await fetch(API + path, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (r.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      throw Object.assign(new Error('Google Calendar session expired: reconnect in Settings'), { code: 'auth' });
    }
    if (r.status === 204) return null;
    if (!r.ok) throw new Error(`Google Calendar: HTTP ${r.status}`);
    return r.json();
  },

  async calendars() {
    const r = await this.call('/users/me/calendarList?minAccessRole=reader&maxResults=250');
    return (r.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor, primary: !!c.primary }));
  },

  /** Events in [from, to) from the given calendars, normalized like ics.js instances. */
  async events(calendarIds, from, to, colors = {}) {
    const out = [];
    await Promise.all(
      calendarIds.map(async (cal) => {
        let pageToken = '';
        do {
          const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' });
          if (pageToken) q.set('pageToken', pageToken);
          const r = await this.call(`/calendars/${encodeURIComponent(cal)}/events?${q}`);
          for (const e of r.items || []) {
            // Skip cancelled events and timed events marked "free" (they don't use up the day).
            if (e.status === 'cancelled' || (e.transparency === 'transparent' && !e.start?.date)) continue;
            const allDay = !!e.start?.date;
            const start = allDay ? localDate(e.start.date) : new Date(e.start.dateTime);
            const end = allDay ? localDate(e.end.date) : new Date(e.end.dateTime);
            out.push({
              id: `g:${cal}:${e.id}`,
              gid: e.id,
              calendarId: cal,
              summary: e.summary || '(busy)',
              location: e.location,
              url: e.htmlLink,
              start,
              end,
              allDay,
              color: colors[cal],
              source: 'google',
              planner: e.extendedProperties?.private?.plannerBlock || null,
            });
          }
          pageToken = r.nextPageToken || '';
        } while (pageToken);
      }),
    );
    return out;
  },

  insertBlock(calendarId, { title, start, end, blockId }) {
    return this.call(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify({
        summary: title,
        start: { dateTime: new Date(start).toISOString() },
        end: { dateTime: new Date(end).toISOString() },
        colorId: '2',
        extendedProperties: { private: { plannerBlock: blockId } },
      }),
    });
  },

  moveBlock(calendarId, eventId, { start, end, title }) {
    return this.call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ summary: title, start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(end).toISOString() } }),
    });
  },

  deleteBlock(calendarId, eventId) {
    return this.call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }).catch((e) => {
      if (!/HTTP 410|HTTP 404/.test(e.message)) throw e;
    });
  },
};

function localDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}
