// node --test planner/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd, nextDue } from '../public/js/parse.js';
import { parseIcs, expand, splitCanvasTitle } from '../public/js/ics.js';
import { allowedFeed } from '../server.mjs';

const now = new Date(2026, 9, 23, 20, 0); // Friday evening

test('quick add: tags, estimate, priority, weekday + time', () => {
  const r = parseQuickAdd('hw3 fri 5pm #canvas ~2h !high', now);
  assert.equal(r.text, 'hw3');
  assert.equal(r.list, 'canvas');
  assert.equal(r.est, 120);
  assert.equal(r.priority, 3);
  assert.deepEqual(r.due, new Date(2026, 9, 30, 17, 0)); // today is Fri, so next Fri
  assert.equal(r.hasTime, true);
});

test('quick add: relative and absolute dates', () => {
  assert.deepEqual(parseQuickAdd('read paper tomorrow ~45m', now).due, new Date(2026, 9, 24, 23, 59));
  assert.equal(parseQuickAdd('read paper tomorrow ~45m', now).est, 45);
  assert.deepEqual(parseQuickAdd('essay 11/2', now).due, new Date(2026, 10, 2, 23, 59));
  assert.deepEqual(parseQuickAdd('apply dec 1 #long-term', now).due, new Date(2026, 11, 1, 23, 59));
  assert.equal(parseQuickAdd('apply dec 1 #long-term', now).list, 'long-term');
  assert.deepEqual(parseQuickAdd('thing in 3 days 14:30', now).due, new Date(2026, 9, 26, 14, 30));
  assert.deepEqual(parseQuickAdd('lab next mon', now).due, new Date(2026, 10, 2, 23, 59));
  // A time that already passed today rolls to tomorrow
  assert.deepEqual(parseQuickAdd('call 9am', now).due, new Date(2026, 9, 24, 9, 0));
});

test('quick add: repeat and plain text untouched', () => {
  const r = parseQuickAdd('gym every week mon 7am #hobbies', now);
  assert.equal(r.repeat, 'weekly');
  assert.equal(r.text, 'gym');
  assert.equal(parseQuickAdd('Monday notes on Fridays', now).text.length > 0, true);
  assert.equal(parseQuickAdd('just a thought', now).due, null);
});

test('nextDue', () => {
  assert.deepEqual(nextDue(new Date(2026, 9, 23, 17), 'weekdays'), new Date(2026, 9, 26, 17));
  assert.deepEqual(nextDue(new Date(2026, 9, 23, 17), 'weekly'), new Date(2026, 9, 30, 17));
});

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Calc lecture',
  'DTSTART;TZID=America/New_York:20260901T100000', 'DTEND;TZID=America/New_York:20260901T111500',
  'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261210T000000Z', 'EXDATE;TZID=America/New_York:20261027T100000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Problem Set 5 [MATH', '  UN1201]', 'DTSTART;VALUE=DATE:20261028', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('ics: weekly recurrence with EXDATE, folded lines, all-day', () => {
  const evs = expand(parseIcs(ICS), new Date(2026, 9, 19), new Date(2026, 10, 2));
  const lectures = evs.filter((e) => e.summary === 'Calc lecture').map((e) => e.start.getDate());
  assert.deepEqual(lectures, [20, 22, 29]); // 27th excluded
  const ps = evs.find((e) => e.uid === 'b');
  assert.equal(ps.allDay, true);
  assert.deepEqual(splitCanvasTitle(ps.summary), { title: 'Problem Set 5', course: 'MATH UN1201' });
});

test('feed proxy allowlist', () => {
  assert.ok(allowedFeed('https://calendar.google.com/calendar/ical/x/private-abc/basic.ics'));
  assert.ok(allowedFeed('webcal://columbia.instructure.com/feeds/calendars/user_abc.ics'));
  assert.ok(allowedFeed('https://courseworks2.columbia.edu/feeds/calendars/user_abc.ics'));
  assert.equal(allowedFeed('https://evil.example.com/x.ics'), null);
  assert.equal(allowedFeed('http://calendar.google.com/x'), null);
  assert.equal(allowedFeed('https://www.columbia.edu/secret'), null);
});
