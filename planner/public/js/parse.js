// Quick-add parser: "hw3 fri 5pm #canvas ~2h !high every week" ->
// { text: 'hw3', due: <Fri 17:00>, hasTime: true, list: 'canvas', est: 120, priority: 3, repeat: 'weekly' }.
// Understands: today, tonight, tomorrow/tmr, weekday names (next occurrence; "next fri" skips a week),
// "in 3 days", 10/24, oct 24, 2026-10-24, 5pm, 17:00, noon, "eod".

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const PRIORITY = { '!!!': 3, '!!': 2, '!': 1, '!high': 3, '!h': 3, '!med': 2, '!medium': 2, '!m': 2, '!low': 1, '!l': 1, '!p1': 3, '!p2': 2, '!p3': 1 };
const REPEAT = { daily: 'daily', 'every day': 'daily', weekly: 'weekly', 'every week': 'weekly', monthly: 'monthly', 'every month': 'monthly', weekdays: 'weekdays', 'every weekday': 'weekdays' };

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function parseQuickAdd(input, now = new Date()) {
  let s = ` ${input.trim()} `;
  const out = { text: '', due: null, hasTime: false, list: null, est: null, priority: 0, repeat: null };
  const take = (re, fn) => {
    s = s.replace(re, (...m) => {
      fn(...m);
      return ' ';
    });
  };

  take(/\s#([\p{L}\p{N}_-]+)(?=\s)/u, (_, tag) => (out.list = tag.toLowerCase()));
  take(/\s~(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)?(?=\s)/i, (_, n, u) => {
    out.est = Math.round(/^m/i.test(u ?? '') ? +n : +n * 60);
  });
  take(/\s(!!!|!!|!(?:high|h|med|medium|m|low|l|p[123])?)(?=\s)/i, (_, p) => (out.priority = PRIORITY[p.toLowerCase()] ?? 1));
  take(/\s(every (?:day|week|month|weekday)|daily|weekly|monthly|weekdays)(?=\s)/i, (_, r) => (out.repeat = REPEAT[r.toLowerCase()]));

  let day = null;
  let hour = null;
  let minute = 0;

  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i, (_, h, m, ap) => {
    hour = (+h % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0);
    minute = +(m ?? 0);
  });
  if (hour === null) {
    take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (_, h, m) => {
      hour = +h;
      minute = +m;
    });
  }
  if (hour === null) take(/\s(noon|midnight|eod)(?=\s)/i, (_, w) => {
    const k = w.toLowerCase();
    hour = k === 'noon' ? 12 : k === 'eod' ? 23 : 23;
    minute = k === 'noon' ? 0 : 59;
  });

  const today = startOfDay(now);
  take(/\s(today|tonight|tod)(?=\s)/i, (_, w) => {
    day = today;
    if (/tonight/i.test(w) && hour === null) hour = 20;
  });
  if (!day) take(/\s(tomorrow|tmr|tmrw|tom)(?=\s)/i, () => (day = addDays(today, 1)));
  if (!day) take(/\sin\s+(\d+)\s+(days?|weeks?)(?=\s)/i, (_, n, u) => (day = addDays(today, +n * (/^w/i.test(u) ? 7 : 1))));
  if (!day) take(/\s(next\s+week)(?=\s)/i, () => (day = addDays(today, ((8 - today.getDay()) % 7) || 7)));
  if (!day) {
    take(/\s(?:(next|this)\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*(?=\s)/i, (_, mod, w) => {
      const target = WEEKDAYS.indexOf(w.slice(0, 3).toLowerCase());
      let diff = (target - today.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      if (mod?.toLowerCase() === 'next' && diff < 7) diff += 7;
      day = addDays(today, diff);
    });
  }
  if (!day) take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/, (_, y, m, d) => (day = new Date(+y, +m - 1, +d)));
  if (!day) {
    take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/, (_, m, d, y) => {
      day = new Date(y ? (+y < 100 ? 2000 + +y : +y) : today.getFullYear(), +m - 1, +d);
      if (!y && day < today) day.setFullYear(day.getFullYear() + 1);
    });
  }
  if (!day) {
    take(/\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?=\s)/i, (_, mo, d) => {
      day = new Date(today.getFullYear(), MONTHS.indexOf(mo.slice(0, 3).toLowerCase()), +d);
      if (day < today) day.setFullYear(day.getFullYear() + 1);
    });
  }

  if (hour !== null && !day) {
    day = today;
    if (hour * 60 + minute <= now.getHours() * 60 + now.getMinutes()) day = addDays(today, 1);
  }
  if (day) {
    out.due = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour ?? 23, hour === null ? 59 : minute);
    out.hasTime = hour !== null;
  }
  out.text = s.replace(/\s+/g, ' ').trim();
  return out;
}

/** Next due date after completing a repeating task. */
export function nextDue(due, repeat) {
  const d = new Date(due);
  if (repeat === 'daily') d.setDate(d.getDate() + 1);
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (repeat === 'weekdays') {
    do d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6);
  } else return null;
  return d;
}
