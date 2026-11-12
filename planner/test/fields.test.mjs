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

test('Status Done and the checkbox are one rule', async () => {
  const { setClock, syncStatus } = await import('../public/js/fields.js');
  setClock(() => 1000);
  const l = applyPreset(list({ items: [{ id: 'i1', text: 'Job', done: false }] }), 'night-queue');
  const it = l.items[0];
  // Status → checkbox.
  setField(l, it, 'status', 'Done');
  assert.deepEqual([it.done, it.doneAt], [true, 1000]);
  setField(l, it, 'status', 'Partial');
  assert.deepEqual([it.done, it.doneAt], [false, null], 'Partial is unchecked');
  setField(l, it, 'status', 'Blocked');
  assert.equal(it.done, false, 'Blocked is unchecked');
  setField(l, it, 'status', 'Done');
  setField(l, it, 'status', null);
  assert.equal(it.done, false, 'clearing the status unchecks');
  // Checkbox → status.
  it.done = true;
  assert.equal(syncStatus(l, it), true);
  assert.equal(getField(it, 'status'), 'Done');
  it.done = false;
  syncStatus(l, it);
  assert.equal(getField(it, 'status'), 'Ready', 'unchecking a done task re-queues it');
  setField(l, it, 'status', 'Blocked');
  it.done = false;
  assert.equal(syncStatus(l, it), false, 'nothing to do when already unchecked');
  assert.equal(getField(it, 'status'), 'Blocked');
  // The list counter counts done tasks, so it agrees by construction.
  setField(l, it, 'status', 'Done');
  assert.equal(l.items.filter((x) => x.done).length, 1);
  // Ordinary lists are untouched by the rule.
  const plain = list({ items: [{ id: 'p', text: 'x', done: true }] });
  assert.equal(syncStatus(plain, plain.items[0]), false);
  assert.equal(plain.items[0].fields, undefined);
});

test('a task added under a status filter takes that status', async () => {
  const { applyFilterDefaults } = await import('../public/js/fields.js');
  const l = applyPreset(list(), 'night-queue');
  const it = applyFilterDefaults(l, { id: 'n', text: 'new', done: false }, { status: 'Running' });
  assert.equal(getField(it, 'status'), 'Running');
  assert.equal(matchesFilter(it, { status: 'Running' }), true, 'so it stays in view');
  const done = applyFilterDefaults(l, { id: 'n2', text: 'new', done: false }, { status: 'Done' });
  assert.equal(done.done, true, 'and the checkbox follows');
  const kept = applyFilterDefaults(l, { id: 'n3', text: 'x', done: false, fields: { status: 'Blocked' } }, { status: 'Running' });
  assert.equal(getField(kept, 'status'), 'Blocked', 'an explicit status is not overridden');
  assert.deepEqual(applyFilterDefaults(l, { id: 'n4', text: 'x', done: false }, {}).fields, undefined, 'no filter, no change');
});

test('a list’s field definitions follow its preset when the preset changes', async () => {
  const { refreshPreset } = await import('../public/js/fields.js');
  const l = applyPreset(list(), 'night-queue');
  assert.equal(refreshPreset(l), false, 'already current');
  delete l.fields[0].done; // an older copy, from before the done rule existed
  assert.equal(refreshPreset(l), true);
  assert.equal(l.fields[0].done, 'Done');
  const custom = list({ preset: 'something-else', fields: [{ key: 'k', label: 'K', type: 'text' }] });
  assert.equal(refreshPreset(custom), false, 'unknown presets keep their own definitions');
  assert.equal(refreshPreset(list()), false);
});

test('existing tasks are reconciled with the Done rule on load', async () => {
  const { reconcileDone, setClock } = await import('../public/js/fields.js');
  setClock(() => 7);
  const l = applyPreset(list({ items: [
    { id: 'a', text: 'checked before the rule', done: true, doneAt: 3, fields: { status: 'Running' } },
    { id: 'b', text: 'marked Done by the old runner', done: false, fields: { status: 'Done' } },
    { id: 'c', text: 'fine', done: false, fields: { status: 'Blocked' } },
  ] }), 'night-queue');
  assert.deepEqual(l.items.map((it) => reconcileDone(l, it)), [true, true, false]);
  assert.equal(getField(l.items[0], 'status'), 'Done', 'a checked task is Done');
  assert.deepEqual([l.items[1].done, l.items[1].doneAt], [true, 7], 'a Done task is checked');
  assert.equal(l.items[2].done, false);
});

test('old code (site@c792012 merge, used by the deployed app and the Mac sync) keeps card fields', async () => {
  const { mergeBoards: oldMerge } = await import('./fixtures/merge-site-c792012.js');
  const nq = applyPreset(list({ items: [
    { id: 'q1', text: 'CRWV pre-market brief', done: false, fields: { status: 'Ready', exploration: 'CRWV', goal: 'Brief me.' } },
    { id: 'q2', text: 'Voice note', done: false, fields: { status: 'Ready' } },
  ] }), 'night-queue');
  const base = { version: 1, cards: [list({ id: 'plain', title: 'Research', items: [{ id: 'p1', text: 'Read', done: false }] }), nq], links: [], blocks: [], archive: [], settings: { theme: 'dark' }, view: {}, updatedAt: 1 };
  // The Mac app (old code) renames q1 and checks q2; the runner (new code) sets q1's status.
  const mac = structuredClone(base);
  mac.cards[1].items[0].text = 'CRWV pre-market brief (renamed on the Mac)';
  mac.cards[1].items[1].done = true;
  mac.cards[1].items.push({ id: 'q3', text: 'added on the Mac', done: false });
  mac.updatedAt = 2;
  const runner = structuredClone(base);
  runner.cards[1].items[0].fields.status = 'Done';
  runner.cards[1].items[0].fields.result = 'https://example.com/brief';
  runner.updatedAt = 3;
  for (const [a, b] of [[mac, runner], [runner, mac]]) {
    const m = oldMerge(base, a, b);
    const q = m.cards.find((c) => c.id === 'l1');
    assert.deepEqual(q.fields, nq.fields, 'list definitions survive');
    assert.equal(q.preset, 'night-queue');
    // q1 changed on both sides: the merge is per task, so the copy saved later (the runner, 3 > 2)
    // wins whole; the Mac's rename of that one task is lost, its fields are not.
    assert.deepEqual(q.items[0], { id: 'q1', text: 'CRWV pre-market brief', done: false, fields: { status: 'Done', exploration: 'CRWV', goal: 'Brief me.', result: 'https://example.com/brief' } });
    // q2 changed only on the Mac: its edit stays, and the fields it never knew about stay with it.
    assert.deepEqual(q.items[1], { id: 'q2', text: 'Voice note', done: true, fields: { status: 'Ready' } });
    assert.equal(q.items[2].text, 'added on the Mac');
  }
  // First link (no base): old code pairs lists by title and still keeps the fields.
  const linked = oldMerge(null, mac, runner);
  assert.deepEqual(linked.cards.find((c) => c.id === 'l1').fields, nq.fields);
});
