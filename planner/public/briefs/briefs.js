// Morning Briefs: a reader for the planner's "Morning Briefs" list. Each day is a task titled
// YYYY-MM-DD whose notes hold the night's sections ("## Pre-market", "## Filing watch", …) as
// Markdown. Same store and sync as the board; nothing is written from here except sync.
import { store } from '../js/store.js';
import { h, toast } from '../js/ui.js';
import * as fx from '../js/motion.js';
import { getField } from '../js/fields.js';
import { renderMarkdown } from '../js/markdown.js';

const $ = (id) => document.getElementById(id);
const feed = $('br-feed');
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let rendered = false;
const closed = new Set(); // "date|section" folds the reader closed

const listOf = (s) => s.cards.find((c) => c.kind === 'list' && (c.preset === 'morning-briefs' || c.title.trim().toLowerCase() === 'morning briefs')) || null;

/** Splits a day's notes into its "## " sections. Text before the first heading becomes "Brief". */
function sections(notes) {
  const out = [];
  let cur = null;
  for (const line of String(notes || '').split('\n')) {
    const m = /^## (.+)$/.exec(line);
    if (m) { cur = { title: m[1].trim(), body: [] }; out.push(cur); continue; }
    if (!cur) { if (!line.trim()) continue; cur = { title: 'Brief', body: [] }; out.push(cur); }
    cur.body.push(line);
  }
  return out.map((s) => ({ ...s, body: s.body.join('\n').trim() })).filter((s) => s.body);
}

const dateLabel = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return { big: iso, small: '' };
  const days = Math.round((new Date().setHours(12, 0, 0, 0) - d) / 86400000);
  return { big: days === 0 ? 'This morning' : days === 1 ? 'Yesterday' : `${DOW[d.getDay()]}`, small: `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}` };
};

function markdownEl(md) {
  const div = h('div.vi-md');
  // "### Questions for you" gets its own box so it stands out on a phone.
  div.innerHTML = renderMarkdown(md).replace(/<h3>Questions for you<\/h3>\s*(<ul>[\s\S]*?<\/ul>)/, '<div class="br-questions"><h3>Questions for you</h3>$1</div>');
  return div;
}

function dayCard(it, latest) {
  const date = it.text;
  const { big, small } = dateLabel(date);
  const secs = sections(it.notes);
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  return h('article.vi-card.br-card', { dataset: { id: it.id } },
    h('div.br-day', h('h2.br-date', big, h('small', small))),
    h('div.br-chips', secs.map((s) => h('span.br-chip', s.title))),
    secs.map((s) => {
      const key = `${date}|${s.title}`;
      return h('details.vi-fold.br-section', { open: latest ? !closed.has(key) : closed.has(`open:${key}`), ontoggle: (ev) => {
        if (latest) ev.target.open ? closed.delete(key) : closed.add(key);
        else ev.target.open ? closed.add(`open:${key}`) : closed.delete(`open:${key}`);
      } },
        h('summary.vi-fold-btn', s.title, h('span.n', `· ${words(s.body)} words`), (() => { const t = document.createElement('template'); t.innerHTML = '<svg class="chev" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>'; return t.content.firstChild; })()),
        h('div.vi-fold-body', h('div', markdownEl(s.body))),
      );
    }),
  );
}

function render() {
  const l = listOf(store.state);
  const days = (l ? l.items.filter((it) => /^\d{4}-\d{2}-\d{2}/.test(it.text)) : []).sort((a, b) => (a.text < b.text ? 1 : -1));
  $('vi-sub').textContent = l ? (days.length ? `${days.length} morning${days.length === 1 ? '' : 's'} · newest first` : 'No briefs yet') : 'No Morning Briefs list on the board yet';
  const nodes = days.map((it, i) => dayCard(it, i === 0));
  if (!nodes.length) nodes.push(h('div.vi-empty', h('strong', 'Nothing here yet'), 'The Night Shift runner writes a card here each morning: one section per job, plus any questions it had for you.'));
  feed.replaceChildren(...nodes);
  if (!rendered && !fx.reduced()) [...feed.children].forEach((el, i) => fx.play(el, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 80 + Math.min(i, 8) * 60, easing: fx.EASE_OUT, fill: 'backwards' }));
  rendered = true;
}

await store.load();
const theme = () => {
  document.documentElement.dataset.theme = store.state.settings.theme === 'light' ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]').content = store.state.settings.theme === 'light' ? '#f6f5f2' : '#0b0b0c';
};
theme();
render();
store.subscribe(() => { theme(); render(); });
const dot = $('vi-dot');
document.addEventListener('planner:saved', (e) => { dot.className = `vi-dot ${e.detail.ok ? 'ok' : 'err'}`; });
$('vi-sync').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.classList.add('spin');
  await store.pull();
  setTimeout(() => b.classList.remove('spin'), 600);
  toast('Up to date', { ms: 1200 });
});
