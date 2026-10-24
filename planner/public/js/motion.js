// Motion layer: spring easings, FLIP animations across full re-renders, confetti, flying chips,
// ripples and tweens. Everything turns into a no-op under prefers-reduced-motion.

const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => reduceQuery.matches;

// ---------- Springs ----------

/** Simulates a damped spring and turns it into a CSS linear() easing + duration. */
function spring({ stiffness = 260, damping = 22, mass = 1 } = {}) {
  const dt = 1 / 240;
  let x = 0, v = 0, t = 0;
  const pts = [0];
  while (t < 3) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    t += dt;
    pts.push(x);
    if (Math.abs(1 - x) < 0.0008 && Math.abs(v) < 0.01) break;
  }
  const n = 56;
  const out = [];
  for (let i = 0; i <= n; i++) out.push(+pts[Math.round((i * (pts.length - 1)) / n)].toFixed(4));
  out[n] = 1;
  return { easing: `linear(${out.join(', ')})`, duration: Math.round(t * 1000) };
}

const linearOk = typeof CSS !== 'undefined' && CSS.supports('animation-timing-function', 'linear(0, 0.5, 1)');
const pick = (cfg, fallback) => (linearOk ? spring(cfg) : fallback);
export const SPRING = pick({ stiffness: 280, damping: 24 }, { easing: 'cubic-bezier(.34,1.4,.64,1)', duration: 520 });
export const SPRING_SOFT = pick({ stiffness: 170, damping: 22 }, { easing: 'cubic-bezier(.22,1.2,.36,1)', duration: 650 });
export const SPRING_BOUNCY = pick({ stiffness: 420, damping: 14 }, { easing: 'cubic-bezier(.34,1.8,.64,1)', duration: 700 });
export const EASE_OUT = 'cubic-bezier(.16, 1, .3, 1)';
export const EASE_IN = 'cubic-bezier(.7, 0, .84, 0)';

// Expose the springs to CSS too.
document.documentElement.style.setProperty('--spring', SPRING.easing);
document.documentElement.style.setProperty('--spring-bouncy', SPRING_BOUNCY.easing);

/** element.animate that respects reduced motion. */
export function play(el, keyframes, opts) {
  if (!el || reduced()) return null;
  return el.animate(keyframes, typeof opts === 'number' ? { duration: opts } : { fill: 'none', ...opts });
}

// ---------- FLIP ----------

/** Records where keyed elements are, before a re-render. */
export function snapshot(root, selector, attr) {
  const m = new Map();
  for (const el of root.querySelectorAll(selector)) {
    const key = el.getAttribute(attr);
    let next = el.nextElementSibling;
    while (next && !next.hasAttribute(attr)) next = next.nextElementSibling;
    const group = el.parentElement?.closest('[data-flip-group]');
    m.set(key, {
      el,
      rect: el.getBoundingClientRect(),
      groupRect: group?.getBoundingClientRect() ?? null,
      group: group?.dataset.flipGroup ?? null,
      next: next?.getAttribute(attr) ?? null,
      color: el.closest('[style*="--c"]')?.style.getPropertyValue('--c') || '',
    });
  }
  return m;
}

/** Moves an element from where it was to where it is now. */
export function flipFrom(el, dx, dy, { scale = 1, timing = SPRING_SOFT, extra = {} } = {}) {
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  return play(el, [{ transform: `translate(${dx / scale}px, ${dy / scale}px)`, ...extra }, { transform: 'none' }], timing);
}

/** A fixed-position clone of an element that no longer exists, for exit/flight animations. */
export function ghost(info, scale = 1) {
  const c = info.el.cloneNode(true);
  c.removeAttribute('id');
  c.classList.add('fx-ghost');
  if (info.color) c.style.setProperty('--c', info.color);
  Object.assign(c.style, {
    position: 'fixed',
    left: info.rect.left + 'px',
    top: info.rect.top + 'px',
    width: info.rect.width / scale + 'px',
    height: info.rect.height / scale + 'px',
    margin: '0',
    transformOrigin: '0 0',
    transform: `scale(${scale})`,
    pointerEvents: 'none',
    zIndex: 70,
  });
  layer().append(c);
  return c;
}

/** Fades a removed element out from its last position. */
export function exit(info, { scale = 1, to = 'translateY(6px)', duration = 320 } = {}) {
  if (reduced()) return;
  const g = ghost(info, scale);
  const a = g.animate(
    [{ opacity: 1, transform: `scale(${scale})`, filter: 'blur(0)' }, { opacity: 0, transform: `scale(${scale}) ${to} scale(.94)`, filter: 'blur(2px)' }],
    { duration, easing: EASE_OUT, fill: 'forwards' },
  );
  a.onfinish = () => g.remove();
}

/** Holds the space an element used and collapses it, so neighbours slide instead of jumping. */
export function collapseSpace(parent, before, height) {
  if (reduced() || !parent || height < 1) return;
  const s = document.createElement('div');
  s.className = 'flip-spacer';
  s.style.height = height + 'px';
  parent.insertBefore(s, before || null);
  const a = s.animate([{ height: height + 'px' }, { height: '0px' }], { duration: 380, easing: EASE_OUT });
  a.onfinish = () => s.remove();
}

/** Grows a new element from zero height (pushes neighbours smoothly). */
export function growIn(el, { delay = 0 } = {}) {
  if (reduced()) return;
  const h = el.offsetHeight;
  el.animate(
    [{ height: '0px', opacity: 0, transform: 'translateY(-6px) scale(.98)', overflow: 'hidden', paddingTop: '0px', paddingBottom: '0px' },
     { height: h + 'px', opacity: 1, transform: 'none', overflow: 'hidden' }],
    { duration: 420, delay, easing: EASE_OUT, fill: 'backwards' },
  );
}

export function popIn(el, { delay = 0, from = 0.85 } = {}) {
  return play(el, [{ opacity: 0, transform: `scale(${from})` }, { opacity: 1, transform: 'none' }], { ...SPRING_BOUNCY, delay, fill: 'backwards' });
}

/** Flies a clone of an old element to a new element's position, hiding the target until it lands. */
export function fly(info, target, { scale = 1, onLand } = {}) {
  if (reduced()) return onLand?.();
  const g = ghost(info, scale);
  g.classList.add('flying');
  const to = target.getBoundingClientRect();
  const dx = to.left - info.rect.left;
  const dy = to.top - info.rect.top;
  target.style.opacity = '0';
  const lift = Math.min(80, Math.hypot(dx, dy) * 0.18);
  const a = g.animate(
    [
      { transform: `translate(0,0) scale(${scale})`, offset: 0 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(${scale * 1.06}) rotate(${dx > 0 ? 3 : -3}deg)`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, offset: 1 },
    ],
    { duration: 560, easing: 'cubic-bezier(.45,.05,.2,1)' },
  );
  a.onfinish = () => {
    g.remove();
    target.style.opacity = '';
    play(target, [{ transform: 'scale(1.04)' }, { transform: 'none' }], SPRING_BOUNCY);
    onLand?.();
  };
}

/** A short-lived background flash in an element's color. */
export function flash(el, color = 'var(--accent)') {
  play(el, [{ boxShadow: `0 0 0 2px ${color}, 0 0 24px 2px ${color}` , backgroundColor: `color-mix(in srgb, ${color} 22%, transparent)` }, { boxShadow: '0 0 0 0 transparent', backgroundColor: 'transparent' }], { duration: 900, easing: EASE_OUT });
}

// ---------- Overlay layer, ripples, flying chips ----------

let layerEl = null;
function layer() {
  if (!layerEl) {
    layerEl = document.createElement('div');
    layerEl.className = 'fx-layer';
    document.body.append(layerEl);
  }
  return layerEl;
}

export function ripple(x, y, color = 'var(--accent)', size = 120) {
  if (reduced()) return;
  const r = document.createElement('div');
  r.className = 'fx-ripple';
  Object.assign(r.style, { left: x + 'px', top: y + 'px', width: size + 'px', height: size + 'px', borderColor: color });
  layer().append(r);
  r.animate([{ transform: 'translate(-50%,-50%) scale(.1)', opacity: 0.9 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 }], { duration: 650, easing: EASE_OUT }).onfinish = () => r.remove();
}

/** A text chip that flies from a rect to an element. */
export function flyChip(text, from, target, color) {
  if (reduced() || !target) return;
  const chip = document.createElement('div');
  chip.className = 'fx-chip';
  chip.textContent = text;
  chip.style.setProperty('--c', color || 'var(--accent)');
  Object.assign(chip.style, { left: from.left + 'px', top: from.top + 'px' });
  layer().append(chip);
  const to = target.getBoundingClientRect();
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const lift = Math.min(140, Math.abs(dx) * 0.25 + 40);
  chip.animate(
    [
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(1.08) rotate(-4deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(.8)`, opacity: 0.25 },
    ],
    { duration: 720, easing: 'cubic-bezier(.5,0,.15,1)' },
  ).onfinish = () => {
    chip.remove();
    flash(target, color);
  };
}

// ---------- Confetti ----------

let canvas, ctx, parts = [], running = false;
const PALETTE = ['#d8ff5a', '#7cc7ff', '#ff9e7a', '#c79bff', '#5ee0b0', '#ffd166', '#ff7ab6'];

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'fx-confetti';
  document.body.append(canvas);
  ctx = canvas.getContext('2d');
  const size = () => {
    const d = devicePixelRatio || 1;
    canvas.width = innerWidth * d;
    canvas.height = innerHeight * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  };
  size();
  addEventListener('resize', size);
}

/** Particle burst at (x, y). power ~ speed, count ~ particles. */
export function confetti(x, y, { count = 14, colors, power = 6, spread = Math.PI * 2, angle = -Math.PI / 2, gravity = 0.22, size = 5 } = {}) {
  if (reduced()) return;
  ensureCanvas();
  const cs = colors?.length ? colors : PALETTE;
  for (let i = 0; i < count; i++) {
    const a = angle + (Math.random() - 0.5) * spread;
    const s = power * (0.45 + Math.random() * 0.75);
    parts.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      g: gravity,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      w: size * (0.6 + Math.random() * 0.8),
      h: size * (0.35 + Math.random() * 0.5),
      c: cs[(Math.random() * cs.length) | 0],
      round: Math.random() < 0.3,
      life: 1,
      decay: 0.008 + Math.random() * 0.01,
    });
  }
  if (!running) {
    running = true;
    requestAnimationFrame(tick);
  }
}

function tick() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 40);
  for (const p of parts) {
    p.vx *= 0.985;
    p.vy = p.vy * 0.985 + p.g;
    p.x += p.vx;
    p.y += p.vy;
    p.r += p.vr;
    p.life -= p.decay;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.r);
    ctx.fillStyle = p.c;
    if (p.round) {
      ctx.beginPath();
      ctx.arc(0, 0, p.h, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Flutter: squash the width with rotation so pieces look like they spin in 3D.
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w * Math.abs(Math.cos(p.r * 2)), p.h);
    }
    ctx.restore();
  }
  if (parts.length) requestAnimationFrame(tick);
  else {
    running = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/** Big celebration from the top edge of a rect (a list hitting 100%). */
export function celebrate(rect, color) {
  if (reduced()) return;
  const cx = rect.left + rect.width / 2;
  const colors = [color, ...PALETTE].filter(Boolean);
  confetti(cx, rect.top + 10, { count: 70, power: 11, spread: Math.PI * 0.9, colors, size: 7 });
  setTimeout(() => confetti(rect.left + 20, rect.top + 20, { count: 30, power: 9, angle: -Math.PI * 0.7, spread: 0.9, colors, size: 6 }), 120);
  setTimeout(() => confetti(rect.right - 20, rect.top + 20, { count: 30, power: 9, angle: -Math.PI * 0.3, spread: 0.9, colors, size: 6 }), 200);
}

// ---------- Tweens ----------

export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** rAF tween; returns cancel(). */
export function tween(duration, onUpdate, { ease = easeOutExpo, onDone } = {}) {
  if (reduced()) {
    onUpdate(1);
    onDone?.();
    return () => {};
  }
  const t0 = performance.now();
  let raf = 0;
  let live = true;
  const step = (now) => {
    if (!live) return;
    const t = Math.min(1, (now - t0) / duration);
    onUpdate(ease(t));
    if (t < 1) raf = requestAnimationFrame(step);
    else onDone?.();
  };
  raf = requestAnimationFrame(step);
  return () => {
    live = false;
    cancelAnimationFrame(raf);
  };
}

// ---------- Effects queued for the next render ----------

const pending = new Map();
/** Remember an effect to play on an element after it's re-rendered (e.g. "check" on an item). */
export function queue(key, effect) {
  pending.set(key, effect);
}
export function take(key) {
  const e = pending.get(key);
  pending.delete(key);
  return e;
}
export const pendingKeys = () => [...pending.keys()];
