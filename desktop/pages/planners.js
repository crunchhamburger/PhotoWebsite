// The planner library: every planner you've made, newest first. Open one, start a new one (from
// scratch or carrying over another's lists and unfinished tasks), rename, duplicate, archive.
import { h, fill, menu, toast } from '../js/ui.js';
import * as fx from '../js/motion.js';

const lib = window.plannerDesktop.library;
const grid = document.getElementById('lib-grid');
const empty = document.getElementById('lib-empty');
const search = document.getElementById('lib-search');
const dlg = document.getElementById('new-dialog');
const nameIn = document.getElementById('new-name');
const fromSel = document.getElementById('new-from');

let all = [];
let tab = 'active';
let first = true;

// Follows the theme of the planner you used last (dark by default).
try { document.documentElement.dataset.theme = localStorage.getItem('planner.lib.theme') || 'dark'; } catch {}

const ago = (t) => {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};

/** A tiny map of the board: each card as a rounded rectangle in its color. */
function preview(map) {
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = document.createElementNS(NS, 'svg');
  svgEl.setAttribute('class', 'lib-map');
  svgEl.setAttribute('aria-hidden', 'true');
  if (!map.length) {
    svgEl.setAttribute('viewBox', '0 0 100 60');
    return svgEl;
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of map) {
    x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h);
  }
  const pad = 60;
  const w = Math.max(400, x1 - x0 + pad * 2);
  const hgt = Math.max(240, y1 - y0 + pad * 2);
  // Keep the map's aspect close to the card's (5:3) by growing the short side.
  const vw = Math.max(w, (hgt * 5) / 3);
  const vh = Math.max(hgt, (w * 3) / 5);
  svgEl.setAttribute('viewBox', `${x0 - pad - (vw - w) / 2} ${y0 - pad - (vh - hgt) / 2} ${vw} ${vh}`);
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  for (const c of map) {
    const r = document.createElementNS(NS, 'rect');
    Object.entries({ x: c.x, y: c.y, width: c.w, height: c.h, rx: 18, fill: c.color, 'fill-opacity': c.kind === 'note' ? 0.35 : 0.22, stroke: c.color, 'stroke-opacity': 0.7, 'stroke-width': 6 }).forEach(([k, v]) => r.setAttribute(k, v));
    svgEl.append(r);
    if (c.kind === 'list') {
      const bar = document.createElementNS(NS, 'rect');
      Object.entries({ x: c.x + 22, y: c.y + 24, width: Math.min(c.w - 44, 160), height: 16, rx: 8, fill: c.color }).forEach(([k, v]) => bar.setAttribute(k, v));
      svgEl.append(bar);
    }
  }
  return svgEl;
}

function card(p, i) {
  const s = p.summary;
  const el = h(`article.lib-card${p.archived ? '.archived' : ''}`, {
    tabIndex: 0,
    dataset: { id: p.id },
    title: `Open “${p.name}”`,
    onclick: (e) => { if (!e.target.closest('button, input')) open(p); },
    onkeydown: (e) => { if (e.key === 'Enter' && e.target === el) open(p); },
  },
    h('div.lib-thumb', preview(s.map), p.archived ? h('span.lib-badge', 'Archived') : null),
    h('div.lib-info',
      h('div.lib-row',
        h('h3.lib-name', { ondblclick: (e) => rename(e.currentTarget, p) }, p.name),
        h('button.icon-btn.lib-more', { title: 'More', 'aria-label': `More actions for ${p.name}`, onclick: (e) => more(e.currentTarget, p) },
          h('span', { 'aria-hidden': 'true' }, '⋯'))),
      h('p.lib-meta', `Edited ${ago(p.updatedAt)} · ${s.lists} list${s.lists === 1 ? '' : 's'}`),
      h('div.lib-stats',
        h('span.chip', `${s.open} to do`),
        h('span.chip.done', `${s.done} done`),
        s.listTitles.length ? h('span.lib-lists.faint', s.listTitles.join(' · ')) : null),
    ),
  );
  if (first && !fx.reduced()) fx.play(el, [{ opacity: 0, transform: 'translateY(14px) scale(.98)' }, { opacity: 1, transform: 'none' }], { ...fx.SPRING_SOFT, delay: 40 + i * 45, fill: 'backwards' });
  return el;
}

function render() {
  const q = search.value.trim().toLowerCase();
  const active = all.filter((p) => !p.archived);
  const archived = all.filter((p) => p.archived);
  document.getElementById('count-active').textContent = active.length || '';
  document.getElementById('count-archived').textContent = archived.length || '';
  const shown = (tab === 'active' ? active : archived).filter((p) => !q || `${p.name} ${p.summary.listTitles.join(' ')}`.toLowerCase().includes(q));
  fill(grid, shown.map(card));
  empty.hidden = shown.length > 0;
  empty.textContent = q ? `No planners match “${search.value.trim()}”.` : tab === 'active' ? 'No planners yet. Make one with “New planner”.' : 'Planners you archive show up here.';
  first = false;
}

async function load() {
  all = await lib.list();
  render();
}

const open = (p) => {
  if (p.archived) lib.update(p.id, { archived: false });
  lib.open(p.id);
};

function rename(el, p) {
  el.contentEditable = 'true';
  el.focus();
  getSelection().selectAllChildren(el);
  const done = async (save) => {
    el.contentEditable = 'false';
    const t = el.textContent.trim();
    if (save && t && t !== p.name) await lib.update(p.id, { name: t });
    else el.textContent = p.name;
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.textContent = p.name; el.blur(); }
  });
  el.addEventListener('blur', () => done(true), { once: true });
}

function more(anchor, p) {
  menu(anchor, [
    { label: 'Open', onclick: () => open(p) },
    { label: 'Rename', onclick: () => rename(grid.querySelector(`[data-id="${p.id}"] .lib-name`), p) },
    { label: 'Start the next planner from this…', onclick: () => newPlanner(p.id) },
    { label: 'Duplicate', onclick: async () => { await lib.duplicate(p.id); toast(`Duplicated “${p.name}”`); } },
    { label: 'Export backup…', onclick: () => lib.exportBoard(p.id) },
    'hr',
    p.archived
      ? { label: 'Restore to active', onclick: async () => { await lib.update(p.id, { archived: false }); toast(`Restored “${p.name}”`); } }
      : { label: 'Archive', onclick: async () => {
        await lib.update(p.id, { archived: true });
        toast(`Archived “${p.name}”`, { action: 'Undo', onAction: () => lib.update(p.id, { archived: false }) });
      } },
    { label: 'Move to Trash…', danger: true, onclick: () => lib.remove(p.id) },
  ]);
}

// ---------- New planner ----------

function suggestName() {
  const d = new Date();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const base = `Week of ${monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  let name = base;
  for (let n = 2; all.some((p) => p.name === name); n++) name = `${base} (${n})`;
  return name;
}

function newPlanner(fromId = null) {
  nameIn.value = suggestName();
  const sources = all.filter((p) => p.summary.lists > 0);
  fill(fromSel, sources.map((p) => h('option', { value: p.id }, p.name)));
  const fromRadio = dlg.querySelector('input[value="from"]');
  fromRadio.disabled = !sources.length;
  fromRadio.closest('.opt').classList.toggle('disabled', !sources.length);
  const pickFrom = fromId && sources.some((p) => p.id === fromId) ? fromId : null;
  if (pickFrom) fromSel.value = pickFrom;
  dlg.querySelector(`input[value="${pickFrom ? 'from' : 'starter'}"]`).checked = true;
  dlg.showModal();
  nameIn.select();
  fx.play(dlg, [{ opacity: 0, transform: 'translateY(-12px) scale(.97)' }, { opacity: 1, transform: 'none' }], fx.SPRING);
}
fromSel.addEventListener('change', () => (dlg.querySelector('input[value="from"]').checked = true));
document.getElementById('new-carry').addEventListener('change', () => (dlg.querySelector('input[value="from"]').checked = true));

// Handled on submit rather than on the dialog's close event, which can arrive late (or not at
// all) while the window is in the background.
document.getElementById('new-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'create') return;
  e.preventDefault();
  if (!nameIn.reportValidity()) return;
  dlg.close();
  const how = dlg.querySelector('input[name="start"]:checked').value;
  const start = how === 'from' ? { from: fromSel.value, carry: document.getElementById('new-carry').checked } : how;
  const p = await lib.create(nameIn.value, start);
  lib.open(p.id);
});
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

// ---------- Wiring ----------

document.getElementById('lib-new').addEventListener('click', () => newPlanner());
document.getElementById('lib-import').addEventListener('click', importBackup);
async function importBackup() {
  try {
    const p = await lib.importBoard();
    if (p) toast(`Imported “${p.name}”`);
  } catch (e) {
    toast(e.message || 'Could not import that file', { kind: 'warn' });
  }
}
search.addEventListener('input', render);
for (const b of document.querySelectorAll('.lib-tabs [role=tab]')) {
  b.addEventListener('click', () => {
    tab = b.dataset.tab;
    for (const x of document.querySelectorAll('.lib-tabs [role=tab]')) x.setAttribute('aria-selected', String(x === b));
    first = true;
    render();
  });
}
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); search.focus(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newPlanner(); }
});
lib.onChanged(load);
window.plannerDesktop.onLibCreate?.((from) => newPlanner(from));
window.plannerDesktop.onLibImport?.(importBackup);
// Relative times ("5 min ago") stay current.
setInterval(render, 60000);

await load();
