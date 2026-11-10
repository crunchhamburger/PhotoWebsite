// node --test planner/test/merge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBoards, sameContent } from '../public/js/merge.js';

const clone = (x) => structuredClone(x);
const base = () => ({
  version: 1,
  updatedAt: 100,
  view: { x: 0, y: 0, zoom: 1 },
  cards: [
    { id: 'L1', kind: 'list', title: 'School', color: '#7cc7ff', x: 0, y: 0, items: [
      { id: 'a', text: 'hw 1', done: false },
      { id: 'b', text: 'hw 2', done: false },
      { id: 'c', text: 'quiz', done: false },
    ] },
    { id: 'L2', kind: 'list', title: 'Life', color: '#ff9e7a', x: 400, y: 0, items: [{ id: 'd', text: 'groceries', done: false }] },
    { id: 'N1', kind: 'note', text: 'hi', x: 800, y: 0 },
  ],
  links: [{ id: 'k1', from: 'L1', to: 'N1' }],
  blocks: [{ id: 'B1', itemId: 'a', title: 'hw 1', start: '2026-11-10T14:00:00.000Z', end: '2026-11-10T15:00:00.000Z' }],
  archive: [],
  settings: { capacity: 6, theme: 'dark', pet: { kind: 'naiwa', on: true } },
});
const items = (board, listId) => board.cards.find((c) => c.id === listId).items;
const texts = (board, listId) => items(board, listId).map((i) => `${i.done ? 'x' : ' '}${i.text}`);

test('edits to different things on each side both survive', () => {
  const b = base();
  const phone = clone(b);
  items(phone, 'L1')[0].done = true; // ticked hw 1 on the phone
  phone.updatedAt = 200;
  const mac = clone(b);
  items(mac, 'L2').push({ id: 'e', text: 'call mom', done: false }); // added on the Mac
  mac.cards.find((c) => c.id === 'L1').title = 'School (fall)';
  mac.updatedAt = 150;
  const m = mergeBoards(b, mac, phone);
  assert.deepEqual(texts(m, 'L1'), ['xhw 1', ' hw 2', ' quiz']);
  assert.deepEqual(texts(m, 'L2'), [' groceries', ' call mom']);
  assert.equal(m.cards.find((c) => c.id === 'L1').title, 'School (fall)');
  assert.equal(m.updatedAt, 200);
});

test('deletions apply unless the other side edited the same thing', () => {
  const b = base();
  const mac = clone(b);
  items(mac, 'L1').splice(2, 1); // deleted "quiz"
  items(mac, 'L1').splice(1, 1); // deleted "hw 2"
  const phone = clone(b);
  items(phone, 'L1')[1].text = 'hw 2 (redo)'; // edited "hw 2" meanwhile
  const m = mergeBoards(b, mac, phone);
  assert.deepEqual(texts(m, 'L1'), [' hw 1', ' hw 2 (redo)']);
});

test('the same thing changed on both sides: the newer save wins', () => {
  const b = base();
  const mac = clone(b);
  items(mac, 'L1')[0].text = 'hw 1 (mac)';
  mac.updatedAt = 300;
  const phone = clone(b);
  items(phone, 'L1')[0].text = 'hw 1 (phone)';
  phone.updatedAt = 250;
  assert.equal(items(mergeBoards(b, mac, phone), 'L1')[0].text, 'hw 1 (mac)');
  phone.updatedAt = 400;
  assert.equal(items(mergeBoards(b, mac, phone), 'L1')[0].text, 'hw 1 (phone)');
});

test('reordering and moving tasks between lists', () => {
  const b = base();
  const mac = clone(b);
  const l1 = items(mac, 'L1');
  l1.unshift(l1.pop()); // quiz to the top
  const phone = clone(b);
  const moved = items(phone, 'L1').splice(1, 1)[0]; // hw 2 moved to Life on the phone
  items(phone, 'L2').push(moved);
  const m = mergeBoards(b, mac, phone);
  assert.deepEqual(texts(m, 'L1'), [' quiz', ' hw 1']);
  assert.deepEqual(texts(m, 'L2'), [' groceries', ' hw 2']);
});

test('settings merge key by key; the camera stays per device; blocks and links follow', () => {
  const b = base();
  const mac = clone(b);
  mac.settings.capacity = 5;
  mac.view = { x: 10, y: 20, zoom: 0.5 };
  mac.blocks.push({ id: 'B2', itemId: 'b', title: 'hw 2', start: '2026-11-10T16:00:00.000Z', end: '2026-11-10T17:00:00.000Z' });
  const phone = clone(b);
  phone.settings.theme = 'light';
  phone.view = { x: 99, y: 99, zoom: 2 };
  phone.cards = phone.cards.filter((c) => c.id !== 'N1'); // note deleted on the phone
  const m = mergeBoards(b, mac, phone);
  assert.equal(m.settings.capacity, 5);
  assert.equal(m.settings.theme, 'light');
  assert.deepEqual(m.view, { x: 10, y: 20, zoom: 0.5 });
  assert.deepEqual(m.blocks.map((x) => x.id), ['B1', 'B2']);
  assert.equal(m.links.length, 0, 'link to the deleted note goes too');
});

test('a task whose list was deleted on one side moves to another list instead of vanishing', () => {
  const b = base();
  const mac = clone(b);
  mac.cards = mac.cards.filter((c) => c.id !== 'L2');
  const phone = clone(b);
  items(phone, 'L2').push({ id: 'z', text: 'new on phone', done: false });
  const m = mergeBoards(b, mac, phone);
  // The phone added to Life, so Life stays (an edit beats a delete).
  assert.ok(m.cards.some((c) => c.id === 'L2'));
  assert.ok(texts(m, 'L2').includes(' new on phone'));
});

test('first link: matching lists, notes and tasks pair up instead of duplicating', () => {
  const mac = {
    updatedAt: 500,
    cards: [
      { id: 'm1', kind: 'list', title: 'Canvas school work', source: 'canvas', items: [{ id: 'mi1', text: 'HW 7A', source: { type: 'canvas', key: 'k7a' } }] },
      { id: 'm2', kind: 'list', title: 'Research', items: [{ id: 'mi2', text: 'Draft literature notes' }, { id: 'mi3', text: 'Mac only' }] },
      { id: 'm3', kind: 'note', text: 'Tip: press N' },
    ],
    settings: { capacity: 6 },
  };
  const web = {
    updatedAt: 400,
    cards: [
      { id: 'w1', kind: 'list', title: 'Canvas', source: 'canvas', items: [{ id: 'wi1', text: 'HW 7A [MATH]', source: { type: 'canvas', key: 'k7a' }, done: true }] },
      { id: 'w2', kind: 'list', title: 'research', items: [{ id: 'wi2', text: 'draft  literature notes' }, { id: 'wi3', text: 'Phone only' }] },
      { id: 'w3', kind: 'note', text: 'Tip: press N' },
      { id: 'w4', kind: 'list', title: 'Gym', items: [] },
    ],
    blocks: [{ id: 'wb', itemId: 'wi3', title: 'Phone only', start: '2026-11-10T14:00:00.000Z', end: '2026-11-10T15:00:00.000Z' }],
    settings: { capacity: 4 },
  };
  const m = mergeBoards(null, mac, web);
  assert.deepEqual(m.cards.map((c) => c.title || c.text), ['Canvas school work', 'Research', 'Tip: press N', 'Gym']);
  const canvas = m.cards[0].items;
  assert.equal(canvas.length, 1, 'same Canvas assignment');
  const research = m.cards[1].items.map((i) => i.text);
  assert.equal(research.length, 3);
  assert.ok(research.includes('Mac only') && research.includes('Phone only'));
  assert.equal(m.blocks[0].itemId, 'wi3');
  assert.equal(m.settings.capacity, 6, 'the newer board wins a clash');
  assert.equal(canvas[0].done, true, 'done on the phone stays done, though the Mac board is newer');
});

test('merging is stable: merging the result again changes nothing', () => {
  const b = base();
  const mac = clone(b);
  items(mac, 'L1')[0].done = true;
  const phone = clone(b);
  items(phone, 'L2').push({ id: 'q', text: 'new', done: false });
  const m = mergeBoards(b, mac, phone);
  assert.ok(sameContent(mergeBoards(m, m, m), m));
  assert.ok(sameContent(mergeBoards(b, b, b), b));
});
