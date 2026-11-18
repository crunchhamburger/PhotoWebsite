// The omnibox in the top bar: one place to add a task (quick-add syntax: "hw3 fri 5pm #canvas ~2h"),
// find a list or a task (the board highlights matches as you type), or run a command ("/" lists
// them). Enter runs the highlighted row; Shift+Enter always adds; Esc closes.
import { store, lists, listByTag, findCard } from './store.js';
import { parseQuickAdd } from './parse.js';
import { h, fmtDue, fmtEst, toast } from './ui.js';
import { setFilter, reveal, isVisible, getLastListId } from './board.js';
import { addParsed } from './actions.js';
import * as fx from './motion.js';

const input = document.getElementById('search');
const pop = document.getElementById('omni-pop');
const listEl = document.getElementById('omni-list');
const foot = document.getElementById('omni-foot');

const ICON = {
  plus: '<path d="M10 4v12M4 10h12"/>',
  list: '<rect x="3" y="3.5" width="14" height="13" rx="2.5"/><path d="M6.5 8h7M6.5 11h5"/>',
  task: '<rect x="3.5" y="3.5" width="13" height="13" rx="3.5"/><path d="m7 10 2 2 4-4"/>',
  go: '<path d="M5 10h10M11 6l4 4-4 4"/>',
};
const icon = (paths) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 20 20');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = paths;
  return s;
};

let commands = [];
let rows = [];
let sel = 0;
let open = false;

const norm = (t) => String(t || '').toLowerCase();
/** Text with the matched part marked. */
function marked(text, q) {
  if (!q) return text;
  const i = norm(text).indexOf(norm(q));
  if (i < 0) return text;
  return [text.slice(0, i), h('mark', text.slice(i, i + q.length)), text.slice(i + q.length)];
}
const fuzzy = (hay, q) => {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const t = norm(hay);
  return words.every((w) => t.includes(w));
};

function targetFor(p) {
  return listByTag(store.state, p.list) || findCard(store.state, getLastListId()) || lists(store.state).find((l) => !l.hidden) || lists(store.state)[0];
}

// ---------- Rows ----------

function addRow(q) {
  const p = parseQuickAdd(q);
  if (!p.text) return null;
  const t = listByTag(store.state, p.list);
  const where = p.list && !t ? `new list “${p.list}”` : (t || targetFor(p))?.title || 'a new list';
  const bits = [`→ ${where}`];
  if (p.due) bits.push(fmtDue(p.due.toISOString(), p.hasTime).label);
  if (p.est) bits.push(`~${fmtEst(p.est)}`);
  if (p.priority) bits.push('!'.repeat(p.priority));
  if (p.repeat) bits.push(`↻ ${p.repeat}`);
  return { kind: 'add', group: null, label: [`Add “`, p.text, `”`], sub: bits.join(' · '), icon: ICON.plus, run: () => addTask(q) };
}

function listRows(q) {
  return lists(store.state).filter((l) => fuzzy(l.title, q)).slice(0, 4).map((l) => {
    const open_ = l.items.filter((i) => !i.done).length;
    return { kind: 'list', group: 'Lists', label: marked(l.title, q), sub: `${open_} open${l.hidden ? ' · hidden' : ''}`, dot: l.color, run: () => { close(); reveal(l.id); } };
  });
}

function taskRows(q) {
  const out = [];
  for (const l of lists(store.state)) {
    for (const it of l.items) {
      if (!fuzzy(`${it.text} ${it.course || ''} ${it.notes || ''}`, q)) continue;
      const due = fmtDue(it.due, it.hasTime !== false);
      out.push({
        kind: 'task', group: 'Tasks', done: it.done, label: marked(it.text, q),
        sub: [l.title, due?.label, it.done ? 'done' : null].filter(Boolean).join(' · '), icon: ICON.task,
        run: () => {
          close();
          reveal(l.id, { pulse: false }).then(() => {
            const el = document.querySelector(`.card [data-item="${it.id}"]`);
            if (el) fx.flash(el, l.color);
          });
        },
      });
    }
  }
  // Open tasks first, then by how early the match is.
  return out.sort((a, b) => a.done - b.done).slice(0, 6);
}

function commandRows(q, { all = false } = {}) {
  const pick = q ? commands.filter((c) => fuzzy(`${c.label} ${c.keywords || ''}`, q)) : all ? commands : commands.filter((c) => c.suggest);
  return pick.map((c) => ({ kind: 'cmd', group: q || all ? 'Commands' : c.group, label: marked(c.label, q), sub: c.sub, icon: c.icon, key: c.key, run: () => { close(); c.run(); } }));
}

function build() {
  const raw = input.value;
  const q = raw.trim();
  if (q.startsWith('/') || q.startsWith('>')) {
    setFilter('');
    return commandRows(q.slice(1).trim(), { all: true });
  }
  if (!q) {
    setFilter('');
    return commandRows('');
  }
  const found = [...listRows(q), ...taskRows(q)];
  // The board highlights matches; a new task's text (matching nothing) leaves it alone.
  setFilter(found.length ? q : '');
  return [addRow(q), ...found, ...commandRows(q)].filter(Boolean);
}

function render() {
  rows = build();
  sel = Math.min(sel, Math.max(0, rows.length - 1));
  const nodes = [];
  let group = undefined;
  rows.forEach((r, i) => {
    if (r.group !== group) {
      group = r.group;
      if (group) nodes.push(h('div.omni-group', group));
    }
    nodes.push(h(`button.omni-row.${r.kind}`, {
      type: 'button', role: 'option', id: `omni-${i}`, 'aria-selected': String(i === sel), tabIndex: -1,
      onpointerdown: (e) => e.preventDefault(), // keep focus in the box
      onpointermove: () => select(i),
      onclick: () => r.run(),
    },
      h('span.ic', r.dot ? h('span.dot', { style: { '--c': r.dot } }) : icon(r.icon || ICON.go)),
      h('span.lbl', h('strong', r.label), r.sub ? h('small', r.sub) : null),
      r.key ? h('span.key', r.key) : null,
    ));
  });
  if (!rows.length) nodes.push(h('div.omni-group', 'Nothing matches. Shift+Enter adds it as a task.'));
  listEl.replaceChildren(...nodes);
  foot.replaceChildren(
    h('span', h('kbd', '↵'), rows[sel]?.kind === 'add' ? 'add' : 'open'),
    h('span', h('kbd', '⇧↵'), 'always add'),
    h('span', h('kbd', '/'), 'commands'),
    h('span', h('kbd', 'esc'), 'close'));
  input.setAttribute('aria-activedescendant', rows.length ? `omni-${sel}` : '');
}

function select(i) {
  if (i === sel) return;
  sel = i;
  for (const el of listEl.querySelectorAll('.omni-row')) el.setAttribute('aria-selected', String(el.id === `omni-${sel}`));
  listEl.querySelector(`#omni-${sel}`)?.scrollIntoView({ block: 'nearest' });
  input.setAttribute('aria-activedescendant', `omni-${sel}`);
  const r = rows[sel];
  foot.firstChild?.replaceChildren(h('kbd', '↵'), r?.kind === 'add' ? 'add' : 'open');
}

// ---------- Open / close ----------

function show() {
  if (open) return;
  open = true;
  pop.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  document.documentElement.classList.add('omni-open');
}

export function close({ keepText = false } = {}) {
  open = false;
  pop.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  document.documentElement.classList.remove('omni-open', 'searching');
  if (!keepText) {
    input.value = '';
    setFilter('');
  }
  input.blur();
}

/** Focuses the omnibox, optionally starting with some text ("/" for commands). */
export function openOmni(text = '') {
  document.documentElement.classList.add('searching'); // phones: the box drops in under the top bar
  input.value = text;
  sel = 0;
  input.focus();
  show();
  render();
}

function addTask(q) {
  const p = parseQuickAdd(q);
  if (!p.text) return;
  const from = input.getBoundingClientRect();
  const { listId, itemId } = addParsed(p, getLastListId());
  const l = findCard(store.state, listId);
  // Stay open for the next one: rapid entry is the common case.
  input.value = '';
  sel = 0;
  render();
  toast(`Added to ${l.title}`, { action: 'Show', onAction: () => reveal(listId) });
  // The task flies from the box to its place in the list (gliding there first if it's off screen).
  const launch = () => {
    const target = document.querySelector(`.card [data-item="${itemId}"]`);
    if (target) fx.flyChip(p.text, { left: from.left + 18, top: from.top + 10 }, target, l.color);
  };
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (isVisible(listId)) launch();
    else reveal(listId, { pulse: false }).then(launch);
  }));
}

/** commands: [{ label, group, sub?, key?, icon, run, keywords?, suggest? }] */
export function initOmni(cmds) {
  commands = cmds;
  input.addEventListener('focus', () => { show(); render(); });
  input.addEventListener('input', () => { sel = 0; show(); render(); });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input && open) close({ keepText: !!input.value.trim() && !document.documentElement.classList.contains('phone') }); }, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(Math.min(rows.length - 1, sel + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(Math.max(0, sel - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (e.shiftKey && q && !q.startsWith('/')) return addTask(q);
      rows[sel]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
      document.getElementById('board').focus({ preventScroll: true });
    }
  });
  // Clicking outside closes it.
  document.addEventListener('pointerdown', (e) => { if (open && !e.target.closest('#omni')) close({ keepText: false }); });
  store.subscribe(() => open && render());
}

export const omniIcons = ICON;
