// Three-way merge of two copies of a board that both changed since they last agreed (`base`).
// Used to sync the Mac app with the website, and by the website when two devices saved at once.
//
// Everything is merged per thing, not per board: each list/note, each task, each time block,
// link, archived task and setting. For each one:
//   - changed on one side only → that side's version wins (including deleting it);
//   - changed on both sides → the copy saved more recently wins, but an edit beats a deletion;
//   - added on either side → kept.
// Task order inside a list and the order of cards come from whichever side reordered them.
// The board's camera (`view`) is per device and is never merged.
//
// With no base (two boards being linked for the first time), lists with the same title (and
// Canvas lists), notes with the same text, and tasks with the same Canvas assignment or text in
// matched lists are treated as the same thing, so nothing is duplicated.

const stable = (v) => {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
};
export const same = (a, b) => stable(a) === stable(b);

/** One value, three-way. `localWins` breaks ties when both sides changed it. */
function pick(b, l, r, localWins) {
  if (same(l, r)) return l;
  if (same(b, l)) return r;
  if (same(b, r)) return l;
  // Both changed. An edit beats a deletion; otherwise the newer side wins.
  if (l === undefined) return r;
  if (r === undefined) return l;
  return localWins ? l : r;
}

function mergeMaps(b, l, r, localWins) {
  const out = new Map();
  for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const v = pick(b.get(id), l.get(id), r.get(id), localWins);
    if (v !== undefined) out.set(id, v);
  }
  return out;
}

/** An order (array of ids): the side that changed it wins; then fit it to the ids that exist. */
function mergeOrder(b, l, r, keep, localWins) {
  const chosen = same(l, b) ? r : same(r, b) ? l : localWins ? l : r;
  const other = chosen === l ? r : l;
  const out = chosen.filter((id) => keep.has(id));
  const seen = new Set(out);
  for (const id of [...other, ...keep]) if (keep.has(id) && !seen.has(id)) { out.push(id); seen.add(id); }
  return out;
}

const byId = (arr) => new Map((Array.isArray(arr) ? arr : []).filter((x) => x && x.id != null).map((x) => [String(x.id), x]));

/** A board as flat collections the merge works on. */
function flatten(board) {
  const s = board || {};
  const cards = new Map();
  const items = new Map();
  const itemOrder = new Map();
  const cardOrder = [];
  for (const c of Array.isArray(s.cards) ? s.cards : []) {
    if (!c || c.id == null) continue;
    const { items: its, ...rest } = c;
    cards.set(String(c.id), rest);
    cardOrder.push(String(c.id));
    if (c.kind === 'list') {
      const order = [];
      for (const it of Array.isArray(its) ? its : []) {
        if (!it || it.id == null) continue;
        items.set(String(it.id), { ...it, _list: String(c.id) });
        order.push(String(it.id));
      }
      itemOrder.set(String(c.id), order);
    }
  }
  const settings = new Map(Object.entries(s.settings || {}));
  return { cards, items, itemOrder, cardOrder, blocks: byId(s.blocks), links: byId(s.links), archive: byId(s.archive), settings, extra: s };
}

// ---------- First link: match things that are the same but have different ids ----------

const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
const itemKey = (it) => (it.source?.key ? `src:${it.source.key}` : `text:${norm(it.text)}`);

/** Renames ids on the remote board to the local ids of the things they match. */
function pairUp(local, remote) {
  const L = flatten(local);
  const R = flatten(remote);
  const cardMap = new Map();
  const usedL = new Set();
  const cardKey = (c) => (c.kind === 'list' ? (c.source === 'canvas' ? 'list:canvas' : `list:${norm(c.title)}`) : `note:${norm(c.text)}`);
  const lByKey = new Map();
  for (const [id, c] of L.cards) if (!lByKey.has(cardKey(c))) lByKey.set(cardKey(c), id);
  for (const [id, c] of R.cards) {
    if (L.cards.has(id)) continue; // already the same id
    const lid = lByKey.get(cardKey(c));
    if (lid && !usedL.has(lid) && !R.cards.has(lid)) { cardMap.set(id, lid); usedL.add(lid); }
  }
  const itemMap = new Map();
  const lItemsByListKey = new Map();
  for (const [id, it] of L.items) lItemsByListKey.set(`${it._list}|${itemKey(it)}`, id);
  const lItemsBySource = new Map();
  for (const [id, it] of L.items) if (it.source?.key) lItemsBySource.set(it.source.key, id);
  const taken = new Set();
  for (const [id, it] of R.items) {
    if (L.items.has(id)) continue;
    const list = cardMap.get(it._list) || it._list;
    const lid = (it.source?.key && lItemsBySource.get(it.source.key)) || lItemsByListKey.get(`${list}|${itemKey(it)}`);
    if (lid && !taken.has(lid) && !R.items.has(lid)) { itemMap.set(id, lid); taken.add(lid); }
  }
  if (!cardMap.size && !itemMap.size) return remote;
  const c = (id) => cardMap.get(String(id)) || id;
  const i = (id) => itemMap.get(String(id)) || id;
  return {
    ...remote,
    cards: (remote.cards || []).map((card) => ({ ...card, id: c(card.id), ...(Array.isArray(card.items) ? { items: card.items.map((it) => ({ ...it, id: i(it.id) })) } : {}) })),
    links: (remote.links || []).map((l) => ({ ...l, from: c(l.from), to: c(l.to) })),
    blocks: (remote.blocks || []).map((b) => (b.itemId ? { ...b, itemId: i(b.itemId) } : b)),
  };
}

// ---------- Merge ----------

/**
 * Merges `local` and `remote`, both descended from `base` (null on first link).
 * Returns the merged board; `view` is local's. Ties go to the board saved more recently.
 */
export function mergeBoards(base, local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  if (!base) remote = pairUp(local, remote);
  const localWins = (local.updatedAt || 0) >= (remote.updatedAt || 0);
  const B = flatten(base || {});
  const L = flatten(local);
  const R = flatten(remote);

  const cards = mergeMaps(B.cards, L.cards, R.cards, localWins);
  const items = mergeMaps(B.items, L.items, R.items, localWins);
  // First link: a task finished on either device stays finished.
  if (!base) {
    for (const [id, it] of items) {
      const done = [L.items.get(id), R.items.get(id)].find((x) => x?.done);
      if (done && !it.done) items.set(id, { ...it, done: true, doneAt: done.doneAt ?? it.doneAt });
    }
  }
  // A list deleted on one side while the other added or changed tasks in it is kept (that counts
  // as an edit to it).
  for (const [id, it] of items) {
    if (cards.has(it._list) || same(B.items.get(id), it)) continue;
    const back = L.cards.get(it._list) || R.cards.get(it._list);
    if (back) cards.set(it._list, back);
  }
  // A task whose list is gone anyway goes to the first remaining list rather than vanishing.
  const firstList = [...cards.values()].find((c) => c.kind === 'list')?.id;
  for (const [id, it] of items) {
    if (!cards.has(it._list) || cards.get(it._list).kind !== 'list') {
      if (firstList == null) items.delete(id);
      else items.set(id, { ...it, _list: String(firstList) });
    }
  }
  const cardOrder = mergeOrder(B.cardOrder, L.cardOrder, R.cardOrder, new Set(cards.keys()), localWins);
  const outCards = cardOrder.map((id) => {
    const card = { ...cards.get(id) };
    if (card.kind === 'list') {
      const keep = new Set([...items].filter(([, it]) => it._list === id).map(([iid]) => iid));
      const order = mergeOrder(B.itemOrder.get(id) || [], L.itemOrder.get(id) || [], R.itemOrder.get(id) || [], keep, localWins);
      card.items = order.map((iid) => {
        const { _list, ...it } = items.get(iid);
        return it;
      });
    }
    return card;
  });

  const settings = Object.fromEntries(mergeMaps(B.settings, L.settings, R.settings, localWins));
  const ordered = (merged, l, r) => {
    // Keep a stable order: local's order, then anything only the remote had (newest first, as stored).
    const out = [];
    const seen = new Set();
    for (const id of [...l.keys(), ...r.keys()]) if (merged.has(id) && !seen.has(id)) { out.push(merged.get(id)); seen.add(id); }
    return out;
  };
  const blocks = mergeMaps(B.blocks, L.blocks, R.blocks, localWins);
  const links = mergeMaps(B.links, L.links, R.links, localWins);
  const archive = mergeMaps(B.archive, L.archive, R.archive, localWins);
  const cardIds = new Set(outCards.map((c) => String(c.id)));

  return {
    ...remote,
    ...local,
    version: Math.max(local.version || 1, remote.version || 1),
    cards: outCards,
    links: ordered(links, L.links, R.links).filter((l) => cardIds.has(String(l.from)) && cardIds.has(String(l.to))),
    blocks: ordered(blocks, L.blocks, R.blocks),
    archive: ordered(archive, L.archive, R.archive).slice(0, 1000),
    settings,
    view: local.view,
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
  };
}

/** True if two boards hold the same content (ignoring the per-device camera and save time). */
export function sameContent(a, b) {
  const strip = (x) => {
    if (!x) return x;
    const { view, updatedAt, ...rest } = x;
    return rest;
  };
  return same(strip(a), strip(b));
}
