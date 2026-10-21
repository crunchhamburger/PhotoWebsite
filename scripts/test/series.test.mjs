// node --test scripts/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, validate } from '../fetch-series.mjs';

const daily = { frequency: 'daily', min: -5, max: 30 };
const monthly = { frequency: 'monthly', min: 0, max: 2000 };
const days = (n, start = '2020-01-01', v = (i) => 1 + i / 1000) =>
  Array.from({ length: n }, (_, i) => [new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10), v(i)]);

test('parses FRED CSV and skips missing values', () => {
  const rows = parseCsv('observation_date,DGS10\n2026-10-16,5.09\n2026-10-17,.\n2026-10-19,5.15\n', 'DGS10');
  assert.deepEqual(rows, [['2026-10-16', 5.09], ['2026-10-19', 5.15]]);
});

test('rejects an unexpected header or a bad date', () => {
  assert.throws(() => parseCsv('<html>error</html>', 'DGS10'), /unexpected header/);
  assert.throws(() => parseCsv('date,value\n2026-13,1\n', 'DGS10'), /bad date/);
});

test('accepts an append-only update', () => {
  const prev = days(100);
  assert.deepEqual(validate('X', daily, days(101), prev), []);
});

test('rejects a change to old history', () => {
  const prev = days(100);
  const next = days(101).map(([d, v], i) => [d, i === 5 ? v + 1 : v]);
  assert.match(validate('X', daily, next, prev).join(), /historical observation .* changed/);
});

test('rejects a missing old observation and a backwards latest date', () => {
  const prev = days(100);
  assert.match(validate('X', daily, days(100).filter((_, i) => i !== 3), prev).join(), /disappeared/);
  assert.match(validate('X', daily, days(90), prev).join(), /went backwards/);
});

test('allows small recent revisions, rejects large ones', () => {
  const prev = days(100);
  const small = days(100).map(([d, v], i) => [d, i === 98 ? v * 1.01 : v]);
  const big = days(100).map(([d, v], i) => [d, i === 98 ? v * 1.5 : v]);
  assert.deepEqual(validate('X', daily, small, prev), []);
  assert.match(validate('X', daily, big, prev).join(), /recent revision too large/);
});

test('monthly data may be revised within six years (BLS seasonal factors)', () => {
  const months = (n) => Array.from({ length: n }, (_, i) => [`${2010 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, 200 + i]);
  const prev = months(180);
  const revised = months(181).map(([d, v], i) => [d, i === 170 ? v * 1.002 : v]);
  assert.deepEqual(validate('X', monthly, revised, prev), []);
  const old = months(181).map(([d, v], i) => [d, i === 10 ? v * 1.002 : v]);
  assert.match(validate('X', monthly, old, prev).join(), /historical observation/);
});

test('rejects values outside the series bounds and non-increasing dates', () => {
  assert.match(validate('X', daily, days(50, '2020-01-01', () => 99)).join(), /outside/);
  const dup = days(50);
  dup[10] = dup[9];
  assert.match(validate('X', daily, dup).join(), /not increasing/);
});
