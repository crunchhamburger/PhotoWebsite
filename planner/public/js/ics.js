// Minimal iCalendar (RFC 5545) reader for Google Calendar secret addresses and Canvas feeds.
// Handles line folding, all-day dates, UTC and TZID times (TZID times are read as local wall time),
// and expands RRULE (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY) plus EXDATE
// and RECURRENCE-ID overrides inside a window.

const DAY = 86400000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescape(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** Parses "20261023", "20261023T140000", "20261023T140000Z" into { date, allDay }. */
export function parseIcsDate(value, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || params.VALUE === 'DATE') return { date: new Date(+y, +mo - 1, +d), allDay: true };
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))), allDay: false };
  return { date: new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)), allDay: false };
}

function parseLine(line) {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...rawParams] = head.split(';');
  const params = {};
  for (const p of rawParams) {
    const i = p.indexOf('=');
    if (i > 0) params[p.slice(0, i).toUpperCase()] = p.slice(i + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

/** Returns the raw VEVENTs: { uid, summary, description, location, url, start, end, allDay, rrule, exdates, recurrenceId, status }. */
export function parseIcs(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      cur = { exdates: [] };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur?.start) {
        if (!cur.end) cur.end = new Date(cur.start.getTime() + (cur.allDay ? DAY : 0));
        events.push(cur);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case 'UID': cur.uid = p.value; break;
      case 'SUMMARY': cur.summary = unescape(p.value); break;
      case 'DESCRIPTION': cur.description = unescape(p.value); break;
      case 'LOCATION': cur.location = unescape(p.value); break;
      case 'URL': cur.url = p.value; break;
      case 'STATUS': cur.status = p.value.toUpperCase(); break;
      case 'RRULE': cur.rrule = p.value; break;
      case 'DTSTART': {
        const d = parseIcsDate(p.value, p.params);
        if (d) Object.assign(cur, { start: d.date, allDay: d.allDay });
        break;
      }
      case 'DTEND': {
        const d = parseIcsDate(p.value, p.params);
        if (d) cur.end = d.date;
        break;
      }
      case 'EXDATE':
        for (const v of p.value.split(',')) {
          const d = parseIcsDate(v, p.params);
          if (d) cur.exdates.push(d.date.getTime());
        }
        break;
      case 'RECURRENCE-ID': {
        const d = parseIcsDate(p.value, p.params);
        if (d) cur.recurrenceId = d.date.getTime();
        break;
      }
    }
  }
  return events;
}

function parseRule(rule) {
  const r = {};
  for (const part of rule.split(';')) {
    const [k, v] = part.split('=');
    r[k.toUpperCase()] = v;
  }
  return {
    freq: r.FREQ,
    interval: Math.max(1, Number(r.INTERVAL) || 1),
    count: r.COUNT ? Number(r.COUNT) : Infinity,
    until: r.UNTIL ? parseIcsDate(r.UNTIL)?.date : null,
    byday: r.BYDAY ? r.BYDAY.split(',').map((d) => WEEKDAYS.indexOf(d.slice(-2))).filter((d) => d >= 0) : null,
  };
}

const sameTimeOn = (base, day) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), base.getHours(), base.getMinutes(), base.getSeconds());

/** Occurrence start times of a recurring event, from its first one, stopping after `to`. */
function* occurrences(ev, to) {
  const rule = parseRule(ev.rrule);
  const start = ev.start;
  let n = 0;
  const stop = (d) => d > to || (rule.until && d > rule.until) || n >= rule.count;
  if (rule.freq === 'WEEKLY') {
    const days = rule.byday?.length ? [...rule.byday].sort() : [start.getDay()];
    const weekStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - start.getDay());
    for (let w = 0; w < 2000; w += rule.interval) {
      for (const wd of days) {
        const d = sameTimeOn(start, new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + w * 7 + wd));
        if (d < start) continue;
        if (stop(d)) return;
        n++;
        yield d;
      }
    }
    return;
  }
  for (let i = 0; i < 5000; i += rule.interval) {
    let d;
    if (rule.freq === 'DAILY') d = sameTimeOn(start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    else if (rule.freq === 'MONTHLY') d = sameTimeOn(start, new Date(start.getFullYear(), start.getMonth() + i, start.getDate()));
    else if (rule.freq === 'YEARLY') d = sameTimeOn(start, new Date(start.getFullYear() + i, start.getMonth(), start.getDate()));
    else return;
    if (d.getDate() !== start.getDate()) continue; // e.g. the 31st in a 30-day month
    if (stop(d)) return;
    n++;
    yield d;
  }
}

/** Expands events into concrete instances overlapping [from, to). */
export function expand(events, from, to) {
  const overrides = new Map();
  for (const ev of events) if (ev.recurrenceId) overrides.set(`${ev.uid}|${ev.recurrenceId}`, ev);
  const out = [];
  const push = (ev, start, end) => {
    if (ev.status === 'CANCELLED') return;
    if (end > from && start < to) out.push({ ...ev, start, end, id: `${ev.uid}|${start.getTime()}` });
  };
  for (const ev of events) {
    if (ev.recurrenceId) {
      push(ev, ev.start, ev.end);
      continue;
    }
    if (!ev.rrule) {
      push(ev, ev.start, ev.end);
      continue;
    }
    const dur = ev.end - ev.start;
    const ex = new Set(ev.exdates);
    for (const s of occurrences(ev, to)) {
      if (ex.has(s.getTime()) || overrides.has(`${ev.uid}|${s.getTime()}`)) continue;
      push(ev, s, new Date(s.getTime() + dur));
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Canvas puts the course in brackets: "Problem Set 3 [MATH UN1201]". */
export function splitCanvasTitle(summary = '') {
  const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(summary);
  return m ? { title: m[1], course: m[2] } : { title: summary, course: '' };
}
