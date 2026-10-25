// Small DOM helpers shared by the board and the side panel.
import * as fx from './motion.js';

/** h('div.card#x', { onclick, style: {...}, dataset: {...} }, ...children) */
export function h(tag, props, ...children) {
  const [, name = 'div', rest = ''] = /^([a-z0-9-]*)(.*)$/i.exec(tag);
  const el = document.createElement(name || 'div');
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) m[1] === '.' ? el.classList.add(m[2]) : (el.id = m[2]);
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val);
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

/** replaceChildren that skips null/false and flattens arrays. */
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

export const svg = (d, extra = '') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 20 20');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = d + extra;
  return s;
};

export const ICONS = {
  dots: '<circle cx="5" cy="10" r="1.2"/><circle cx="10" cy="10" r="1.2"/><circle cx="15" cy="10" r="1.2"/>',
  play: '<path d="M7 5.5v9l7-4.5z"/>',
  edit: '<path d="M4 16h3l8.5-8.5-3-3L4 13z"/>',
  cal: '<rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 3v3M13 3v3"/>',
  x: '<path d="m5 5 10 10M15 5 5 15"/>',
  link: '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.8-.8"/>',
  repeat: '<path d="M4 9V8a3 3 0 0 1 3-3h8l-2-2M16 11v1a3 3 0 0 1-3 3H5l2 2"/>',
  chev: '<path d="m7 8 3 3 3-3"/>',
  sync: '<path d="M16 6.5A6.5 6.5 0 0 0 4.3 7.5M4 13.5a6.5 6.5 0 0 0 11.7-1M16 3v3.5h-3.5M4 17v-3.5h3.5"/>',
};

// ---------- Dates ----------

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function fmtTime(d) {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
}

/** "Today 5pm", "Tomorrow", "Fri", "Nov 2", with a status: overdue | today | soon | later. */
export function fmtDue(iso, hasTime = true) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const days = Math.round((sod(d) - sod(now)) / 86400000);
  const showTime = hasTime && !(d.getHours() === 23 && d.getMinutes() === 59);
  let label;
  if (days === 0) label = 'Today';
  else if (days === 1) label = 'Tomorrow';
  else if (days === -1) label = 'Yesterday';
  else if (days > 1 && days < 7) label = DOW[d.getDay()];
  else label = `${MON[d.getMonth()]} ${d.getDate()}`;
  if (showTime) label += ' ' + fmtTime(d);
  const status = d < now ? 'overdue' : days === 0 ? 'today' : days <= 2 ? 'soon' : 'later';
  return { label, status, days };
}

export const fmtDay = (d) => `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
export const fmtMonth = (d) => `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]} ${d.getFullYear()}`;
export const fmtHours = (h) => (h < 1 && h > 0 ? `${Math.round(h * 60)}m` : `${Math.round(h * 10) / 10}h`);
export const fmtEst = (min) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10}h` : `${min}m`);

/** For <input type="datetime-local"> */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- Toasts ----------

/** Toasts spring in, show a countdown bar (paused while hovered) and slide out. */
export function toast(text, { action, onAction, kind = '', ms = 4500 } = {}) {
  const box = document.getElementById('toasts');
  const bar = h('i.toast-bar', { style: { animationDuration: ms + 'ms' } });
  const el = h(`div.toast${kind ? '.' + kind : ''}`, h('span', text), bar);
  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    const a = fx.play(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(40px) scale(.96)' }], { duration: 220, easing: fx.EASE_IN });
    a ? (a.onfinish = () => el.remove()) : el.remove();
  };
  if (action) el.append(h('button', { onclick: () => { onAction?.(); dismiss(); } }, action));
  box.append(el);
  // Keep at most 4 on screen.
  while (box.children.length > 4) box.firstElementChild.remove();
  fx.play(el, [{ opacity: 0, transform: 'translateY(16px) scale(.9)' }, { opacity: 1, transform: 'none' }], fx.SPRING_BOUNCY);
  if (fx.reduced()) setTimeout(dismiss, ms);
  else bar.addEventListener('animationend', dismiss);
}

// ---------- Floating menu / popover ----------

let closeFloating = null;

export function closeFloats() {
  closeFloating?.();
  closeFloating = null;
}

function place(el, anchor) {
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  el.hidden = false;
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let x = r.left;
  let y = r.bottom + 6;
  if (x + w > innerWidth - 8) x = Math.max(8, r.right - w);
  if (y + hgt > innerHeight - 8) y = Math.max(8, r.top - hgt - 6);
  if (y < 8) y = 8;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  // Grow out of the anchor.
  el.style.transformOrigin = `${Math.min(w, Math.max(0, r.left - x + 12))}px ${y < r.top ? hgt : 0}px`;
  fx.play(el, [{ opacity: 0, transform: `translateY(${y < r.top ? 6 : -6}px) scale(.94)` }, { opacity: 1, transform: 'none' }], { duration: 260, easing: fx.EASE_OUT });
  [...el.children].forEach((c, i) => {
    if (el.id === 'menu' && i < 10) fx.play(c, [{ opacity: 0, transform: 'translateX(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, delay: 20 + i * 18, easing: fx.EASE_OUT, fill: 'backwards' });
  });
}

function openFloating(el, anchor, onClose) {
  closeFloats();
  place(el, anchor);
  const away = (e) => {
    if (!el.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) closeFloats();
  };
  const esc = (e) => e.key === 'Escape' && closeFloats();
  setTimeout(() => document.addEventListener('pointerdown', away, true));
  document.addEventListener('keydown', esc);
  closeFloating = () => {
    document.removeEventListener('pointerdown', away, true);
    document.removeEventListener('keydown', esc);
    el.hidden = true;
    el.replaceChildren();
    onClose?.();
  };
}

/** items: [{ label, onclick, danger }, 'hr', HTMLElement] */
export function menu(anchor, items) {
  const el = document.getElementById('menu');
  el.replaceChildren(
    ...items.filter(Boolean).map((it) =>
      it === 'hr' ? h('hr') : it instanceof Node ? it : h(`button${it.danger ? '.danger' : ''}`, { onclick: () => { closeFloats(); it.onclick(); } }, it.label),
    ),
  );
  openFloating(el, anchor);
}

export function popover(anchor, content, onClose) {
  const el = document.getElementById('popover');
  el.replaceChildren(content);
  openFloating(el, anchor, onClose);
  return el;
}
