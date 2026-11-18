// The "now" chip in the top bar: what this hour is for. During a time block or a class it shows
// that, with how far through it you are; otherwise the next thing today and how soon. Clicking a
// time block starts its focus timer; anything else opens Today.
import { store } from './store.js';
import { calendar, sameDay, startOfDay } from './feeds.js';
import { h, fmtTime } from './ui.js';

const chip = document.getElementById('now-chip');

function agenda() {
  const today = startOfDay(new Date());
  return [
    ...calendar.forDay(today).filter((e) => !e.allDay && e.source !== 'canvas').map((e) => ({ start: new Date(e.start), end: new Date(e.end), title: e.summary || 'Busy' })),
    ...store.state.blocks.filter((b) => sameDay(new Date(b.start), today)).map((b) => ({ start: new Date(b.start), end: new Date(b.end), title: b.title, itemId: b.itemId, block: true })),
  ].filter((a) => a.end > a.start).sort((a, b) => a.start - b.start);
}

const mins = (ms) => Math.max(1, Math.round(ms / 60000));
const until = (ms) => (ms < 3600000 ? `${mins(ms)}m` : `${Math.floor(ms / 3600000)}h${Math.round((ms % 3600000) / 60000) ? ` ${Math.round((ms % 3600000) / 60000)}m` : ''}`);

let current = null;

export function renderNow() {
  const now = Date.now();
  const a = agenda();
  const live = a.filter((x) => x.start <= now && x.end > now).sort((x, y) => (y.block ? 1 : 0) - (x.block ? 1 : 0))[0];
  const next = a.find((x) => x.start > now);
  current = live || next || null;
  if (!current) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  chip.classList.toggle('live', !!live);
  if (live) {
    const p = ((now - live.start) / (live.end - live.start)) * 100;
    chip.style.setProperty('--p', `${p.toFixed(1)}%`);
    chip.replaceChildren(h('span.pulse'), 'Now', h('b', live.title), h('span.when', `till ${fmtTime(live.end)}`), h('span.bar'));
    chip.title = `${live.title} · ${fmtTime(live.start)}–${fmtTime(live.end)}${live.block && live.itemId ? ' · click to start a focus timer' : ''}`;
  } else {
    const ms = next.start - now;
    chip.style.removeProperty('--p');
    chip.replaceChildren(h('span.pulse'), 'Next', h('b', next.title), h('span.when', ms < 2 * 3600000 ? `in ${until(ms)}` : `at ${fmtTime(next.start)}`));
    chip.title = `${next.title} · ${fmtTime(next.start)}–${fmtTime(next.end)}`;
  }
}

/** onFocus(itemId) starts a focus timer; onOpen() shows Today. */
export function initNow({ onFocus, onOpen }) {
  chip.addEventListener('click', () => (current?.block && current.itemId && current.start <= Date.now() ? onFocus(current.itemId) : onOpen()));
  renderNow();
  setInterval(renderNow, 30000);
  store.subscribe(() => renderNow());
  calendar.subscribe(() => renderNow());
}
