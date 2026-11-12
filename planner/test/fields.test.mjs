// node --test planner/test/fields.test.mjs
// Card fields: presets, value coercion, filters, and that ordinary lists are untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_PRESETS, fieldsOf, isQueue, applyPreset, clearFields, getField, setField, coerce, matchesFilter, searchText, formatField } from '../public/js/fields.js';

const list = (extra = {}) => ({ id: 'l1', kind: 'list', title: 'Night Queue', color: '#000', x: 0, y: 0, w: 300, h: 0, items: [], ...extra });

test('ordinary lists have no fields and are not queues', () => {
  const l = list();
  assert.deepEqual(fieldsOf(l), []);
  assert.equal(isQueue(l), false);
  assert.deepEqual(fieldsOf({ ...l, fields: 'nope' }), []);
  assert.deepEqual(fieldsOf({ ...l, fields: [{ label: 'no key' }] }), []);
});

test('the Night Queue preset has every required field', () => {
  const l = applyPreset(list(), 'night-queue');
  assert.equal(isQueue(l), true);
  assert.equal(l.preset, 'night-queue');
  const byKey = Object.fromEntries(fieldsOf(l).map((f) => [f.key, f]));
  assert.deepEqual(byKey.status.options, ['Draft', 'Ready', 'Running', 'Done', 'Partial', 'Blocked']);
  assert.deepEqual(byKey.exploration.options, ['Higgsfield', 'Voice', 'Speaking', 'CRWV', 'Gamma', 'Night Shift', 'Recruiting']);
  for (const k of ['goal', 'inputs', 'doneWhen', 'notAllowed', 'output', 'budget', 'notes']) assert.equal(byKey[k].type, 'text', k);
  assert.equal(byKey.result.type, 'url');
  assert.deepEqual([byKey.score.type, byKey.score.min, byKey.score.max], ['number', 0, 3]);
  assert.equal(byKey.reviewMinutes.type, 'number');
  assert.equal(byKey.stuck.type, 'checkbox');
  assert.equal(byKey.status.filter, true);
  // A copy, not a reference: editing the list's fields leaves the preset alone.
  l.fields[0].options.push('Oops');
  assert.equal(FIELD_PRESETS['night-queue'].fields[0].options.length, 6);
});

test('the Exploration Log preset', () => {
  const keys = fieldsOf(applyPreset(list(), 'exploration-log')).map((f) => f.key);
  assert.deepEqual(keys, ['question', 'experiment', 'finding', 'opportunity', 'decision', 'date']);
  assert.throws(() => applyPreset(list(), 'nope'), /unknown field preset/);
});

test('applying and removing a preset keeps task values', () => {
  const l = applyPreset(list({ items: [{ id: 'i1', text: 'Job', done: false }] }), 'night-queue');
  assert.ok(setField(l, l.items[0], 'status', 'Ready').ok);
  clearFields(l);
  assert.equal(isQueue(l), false);
  assert.equal(l.preset, undefined);
  assert.equal(getField(l.items[0], 'status'), 'Ready');
  applyPreset(l, 'night-queue');
  assert.equal(getField(l.items[0], 'status'), 'Ready');
});

test('coercion: selects, numbers, checkboxes, urls, dates, text', () => {
  const l = applyPreset(list(), 'night-queue');
  const def = (k) => fieldsOf(l).find((f) => f.key === k);
  assert.deepEqual(coerce(def('status'), 'ready'), { ok: true, value: 'Ready' });
  assert.equal(coerce(def('status'), 'Maybe').ok, false);
  assert.deepEqual(coerce(def('score'), '2'), { ok: true, value: 2 });
  assert.equal(coerce(def('score'), 4).ok, false);
  assert.equal(coerce(def('score'), -1).ok, false);
  assert.equal(coerce(def('score'), 'two').ok, false);
  assert.deepEqual(coerce(def('reviewMinutes'), 7), { ok: true, value: 7 });
  assert.deepEqual(coerce(def('stuck'), 'yes'), { ok: true, value: true });
  assert.deepEqual(coerce(def('stuck'), false), { ok: true, value: false });
  assert.equal(coerce(def('stuck'), 'maybe').ok, false);
  assert.deepEqual(coerce(def('result'), 'https://example.com/x'), { ok: true, value: 'https://example.com/x' });
  assert.equal(coerce(def('result'), 'javascript:alert(1)').ok, false);
  assert.equal(coerce(def('result'), 'not a url').ok, false);
  assert.deepEqual(coerce(def('goal'), 'One sentence'), { ok: true, value: 'One sentence' });
  assert.deepEqual(coerce(def('goal'), ''), { ok: true, value: null });
  const log = applyPreset(list(), 'exploration-log');
  const date = fieldsOf(log).find((f) => f.key === 'date');
  assert.deepEqual(coerce(date, '2026-11-12'), { ok: true, value: '2026-11-12' });
  assert.equal(coerce(date, '11/12/2026').ok, false);
});

test('setField stores, clears and never leaves an empty fields object', () => {
  const l = applyPreset(list({ items: [{ id: 'i1', text: 'Job', done: false }] }), 'night-queue');
  const it = l.items[0];
  assert.equal(setField(l, it, 'nope', 'x').ok, false);
  assert.ok(setField(l, it, 'status', 'Ready').ok);
  assert.ok(setField(l, it, 'score', '3').ok);
  assert.ok(setField(l, it, 'stuck', true).ok);
  assert.deepEqual(it.fields, { status: 'Ready', score: 3, stuck: true });
  assert.equal(setField(l, it, 'score', 9).ok, false);
  assert.equal(it.fields.score, 3, 'a rejected value leaves the old one');
  setField(l, it, 'stuck', false);
  setField(l, it, 'score', '');
  setField(l, it, 'status', null);
  assert.equal(it.fields, undefined);
});

test('filters and search text', () => {
  const l = applyPreset(list({ items: [{ id: 'i1', text: 'A', done: false, fields: { status: 'Ready', goal: 'Brief me' } }, { id: 'i2', text: 'B', done: false }] }), 'night-queue');
  assert.equal(matchesFilter(l.items[0], { status: 'Ready' }), true);
  assert.equal(matchesFilter(l.items[1], { status: 'Ready' }), false);
  assert.equal(matchesFilter(l.items[1], {}), true);
  assert.equal(matchesFilter(l.items[1], { status: '' }), true);
  assert.equal(searchText(l, l.items[0]), 'Ready Brief me');
  assert.equal(searchText(l, l.items[1]), '');
  assert.equal(formatField({ type: 'checkbox' }, true), 'Yes');
  assert.equal(formatField({ type: 'checkbox' }, false), '');
});

test('merge keeps fields on tasks like any other task property', async () => {
  const { mergeBoards } = await import('../public/js/merge.js');
  const base = { version: 1, cards: [applyPreset(list({ items: [{ id: 'i1', text: 'Job', done: false, fields: { status: 'Ready' } }] }), 'night-queue')], updatedAt: 1 };
  const local = structuredClone(base); // the phone: untouched
  const remote = structuredClone(base); // the night runner: status + result
  Object.assign(remote.cards[0].items[0].fields, { status: 'Done', result: 'https://example.com/brief' });
  remote.updatedAt = 2;
  const m = mergeBoards(base, local, remote);
  assert.deepEqual(m.cards[0].items[0].fields, { status: 'Done', result: 'https://example.com/brief' });
  assert.deepEqual(m.cards[0].fields, base.cards[0].fields);
});
