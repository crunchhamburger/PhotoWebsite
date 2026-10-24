// Pets: little meme critters that roam the whiteboard. Click one for a reaction, drag to throw it,
// give them a treat to race for. They cheer when you finish tasks.
// All art is drawn here as SVG so every part (eyes, mouth, tail, feet) can be animated.
import { store } from './store.js';
import * as fx from './motion.js';
import { h, popover, closeFloats, toast } from './ui.js';

const board = document.getElementById('board');
const layer = document.getElementById('pets');
const SIZE = 72;
const BASE_SPEED = 75; // px/s at speed 1

const DEFAULTS = { count: 3, kinds: ['nailong', 'roo', 'pop', 'huh', 'loaf'], speed: 1, sound: false, cheer: true, custom: null };
const PICKS = ['nailong', 'roo', 'egg', 'pop', 'loaf', 'huh'];
export const cfg = () => ({ ...DEFAULTS, ...(store.state.settings.pets || {}) });
function setCfg(patch, { quiet = true } = {}) {
  store.update((s) => (s.settings.pets = { ...cfg(), ...patch }), { undoable: false, quiet });
}

// ---------- Art ----------

let artId = 0;
const eye = (cx, cy, rx = 5.5, ry = 6.5, hl = true) =>
  `<g class="eye"><g class="look"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#231a14"/>${hl ? `<circle cx="${cx + rx * 0.35}" cy="${cy - ry * 0.4}" r="${rx * 0.38}" fill="#fff"/>` : ''}</g></g>`;
const blush = (cx, cy) => `<ellipse class="blush" cx="${cx}" cy="${cy}" rx="6" ry="3.4" fill="#ff9fb4" opacity=".75"/>`;
const dizzyEyes = (a, b, y) => `<g class="x-eyes">${[a, b].map((x) => `<path d="M${x - 5} ${y - 5} l10 10 M${x + 5} ${y - 5} l-10 10" stroke="#231a14" stroke-width="2.6" stroke-linecap="round"/>`).join('')}</g>`;

const ART = {
  // 奶龙-style: chubby yellow dragon, cream belly, nub horns, pink cheeks, big laugh.
  nailong: () => {
    const g = `nl${++artId}`;
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>
      <radialGradient id="${g}" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#ffe98a"/><stop offset=".65" stop-color="#ffd43b"/><stop offset="1" stop-color="#f2b81c"/></radialGradient></defs>
      <ellipse class="shadow" cx="50" cy="96" rx="30" ry="4" fill="#000" opacity=".18"/>
      <path class="tail" d="M80 78c12 2 16-6 14-14-4 4-8 6-14 6" fill="#ffd43b" stroke="#e0a514" stroke-width="2" stroke-linejoin="round"/>
      <g class="feet"><ellipse class="foot l" cx="37" cy="91" rx="9" ry="5" fill="#ffd43b" stroke="#e0a514" stroke-width="2"/><ellipse class="foot r" cx="63" cy="91" rx="9" ry="5" fill="#ffd43b" stroke="#e0a514" stroke-width="2"/></g>
      <path d="M33 18c-2-8 4-12 8-8M67 18c2-8-4-12-8-8" fill="#ffe27a" stroke="#e0a514" stroke-width="2.2" stroke-linecap="round"/>
      <path class="body" d="M50 13C74 13 88 34 88 58 88 80 72 93 50 93S12 80 12 58C12 34 26 13 50 13Z" fill="url(#${g})" stroke="#e0a514" stroke-width="2.2"/>
      <ellipse cx="50" cy="74" rx="22" ry="16" fill="#fff4bf" opacity=".95"/>
      <path d="M14 58c-6 2-8 8-4 11M86 58c6 2 8 8 4 11" fill="none" stroke="#e0a514" stroke-width="2.2" stroke-linecap="round"/>
      <ellipse cx="36" cy="27" rx="7" ry="4" fill="#fff" opacity=".55" transform="rotate(-20 36 27)"/>
      ${eye(37, 44, 5.8, 7)}${eye(63, 44, 5.8, 7)}${dizzyEyes(37, 63, 44)}
      ${blush(26, 55)}${blush(74, 55)}
      <path class="mouth closed" d="M42 54q8 9 16 0" fill="#7a2b1c" stroke="#231a14" stroke-width="2" stroke-linejoin="round"/>
      <g class="mouth open"><path d="M36 52q14 22 28 0Z" fill="#6b2318" stroke="#231a14" stroke-width="2" stroke-linejoin="round"/><ellipse cx="50" cy="62" rx="7" ry="3.6" fill="#ff7f91"/></g>
    </svg>`;
  },
  // Delivery kangaroo: yellow roo in a helmet with a delivery box on its back (no logos).
  roo: () => `<svg viewBox="0 0 100 100" aria-hidden="true">
      <ellipse class="shadow" cx="50" cy="96" rx="28" ry="4" fill="#000" opacity=".18"/>
      <path class="tail" d="M70 82c14 2 24 0 26-8" fill="none" stroke="#f5c400" stroke-width="7" stroke-linecap="round"/>
      <rect x="62" y="40" width="26" height="26" rx="4" fill="#ffd60a" stroke="#c99a00" stroke-width="2"/>
      <path d="M62 49h26M75 40v26" stroke="#c99a00" stroke-width="1.6" opacity=".7"/>
      <g class="feet"><ellipse class="foot l" cx="36" cy="92" rx="11" ry="4.5" fill="#f5c400" stroke="#c99a00" stroke-width="1.8"/><ellipse class="foot r" cx="58" cy="92" rx="11" ry="4.5" fill="#f5c400" stroke="#c99a00" stroke-width="1.8"/></g>
      <path class="body" d="M28 90c-6-14-4-34 6-44 6-6 22-6 28 2 8 10 8 30 2 42Z" fill="#ffd21f" stroke="#c99a00" stroke-width="2"/>
      <path d="M38 74q10 8 20 0v10q-10 6-20 0Z" fill="#ffe36b" stroke="#c99a00" stroke-width="1.5"/>
      <path d="M30 22c-6-12-2-18 4-16 4 2 6 8 6 14M62 22c4-12 0-18-6-16-4 2-6 8-6 14" fill="#ffd21f" stroke="#c99a00" stroke-width="2"/>
      <path class="head" d="M24 40c0-14 10-22 24-22s24 8 24 22-10 20-24 20-24-6-24-20Z" fill="#ffd21f" stroke="#c99a00" stroke-width="2"/>
      <path d="M22 34c0-14 12-22 26-22s26 8 26 22c-8-6-16-8-26-8s-18 2-26 8Z" fill="#ffc300" stroke="#c99a00" stroke-width="2"/>
      <path d="M30 30q18-8 36 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>
      ${eye(38, 42, 4.6, 5.6)}${eye(58, 42, 4.6, 5.6)}${dizzyEyes(38, 58, 42)}
      ${blush(30, 50)}${blush(66, 50)}
      <ellipse cx="48" cy="49" rx="3.4" ry="2.4" fill="#5a3a12"/>
      <path class="mouth closed" d="M43 53q5 5 10 0" fill="none" stroke="#231a14" stroke-width="2" stroke-linecap="round"/>
      <g class="mouth open"><ellipse cx="48" cy="56" rx="5" ry="5.5" fill="#6b2318"/></g>
    </svg>`,
  // 奶蛋: a milky egg with a yolk curl and tiny feet.
  egg: () => {
    const g = `egg${++artId}`;
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>
      <radialGradient id="${g}" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="#fffefb"/><stop offset=".6" stop-color="#fff6e3"/><stop offset="1" stop-color="#f1dfb8"/></radialGradient></defs>
      <ellipse class="shadow" cx="50" cy="95" rx="26" ry="4" fill="#000" opacity=".18"/>
      <g class="feet"><ellipse class="foot l" cx="39" cy="91" rx="8" ry="4.6" fill="#ffb347"/><ellipse class="foot r" cx="61" cy="91" rx="8" ry="4.6" fill="#ffb347"/></g>
      <path class="body" d="M50 9C72 9 86 39 86 61 86 80 70 92 50 92 30 92 14 80 14 61 14 39 28 9 50 9Z" fill="url(#${g})" stroke="#e6d3a8" stroke-width="2"/>
      <path class="curl" d="M50 10c1-7 9-9 11-3" fill="none" stroke="#ffcf4d" stroke-width="3.5" stroke-linecap="round"/>
      <ellipse cx="36" cy="27" rx="6" ry="10" fill="#fff" opacity=".8" transform="rotate(-25 36 27)"/>
      <path class="crack" d="M22 44l8 6 6-8 8 9 7-8 7 8 7-8 9 6" fill="none" stroke="#b89a62" stroke-width="2.4" stroke-linejoin="round"/>
      ${eye(38, 57)}${eye(62, 57)}${dizzyEyes(38, 62, 57)}
      ${blush(28, 67)}${blush(72, 67)}
      <path class="mouth closed" d="M45 67q5 5 10 0" fill="none" stroke="#231a14" stroke-width="2.4" stroke-linecap="round"/>
      <g class="mouth open"><ellipse cx="50" cy="70" rx="6.5" ry="7.5" fill="#6b2626"/><ellipse cx="50" cy="74" rx="4" ry="2.6" fill="#ff8fa3"/></g>
    </svg>`;
  },
  // Pop cat: round white cat whose mouth pops wide open.
  pop: () => `<svg viewBox="0 0 100 100" aria-hidden="true">
      <ellipse class="shadow" cx="50" cy="95" rx="28" ry="4" fill="#000" opacity=".18"/>
      <path class="tail" d="M78 80c14-2 16-18 8-24" fill="none" stroke="#e9e4dc" stroke-width="7" stroke-linecap="round"/>
      <path d="M20 44 25 12 45 30Z M80 44 75 12 55 30Z" fill="#f4f1ec" stroke="#d5cec3" stroke-width="2" stroke-linejoin="round"/>
      <path d="M26 36 28 20 38 30Z M74 36 72 20 62 30Z" fill="#ffb3c1"/>
      <path class="body" d="M16 60C16 37 30 26 50 26S84 37 84 60 70 92 50 92 16 83 16 60Z" fill="#f6f3ee" stroke="#d5cec3" stroke-width="2"/>
      <path d="M44 32l2 7M50 31v8M56 32l-2 7" stroke="#d9d2c6" stroke-width="2.4" stroke-linecap="round"/>
      ${eye(37, 56, 5, 6)}${eye(63, 56, 5, 6)}${dizzyEyes(37, 63, 56)}
      ${blush(27, 66)}${blush(73, 66)}
      <path d="M48 62h4l-2 2.5z" fill="#ff8fa3"/>
      <path class="mouth closed" d="M43 66q3.5 4 7 0 3.5 4 7 0" fill="none" stroke="#231a14" stroke-width="2.2" stroke-linecap="round"/>
      <g class="mouth open"><circle cx="50" cy="72" r="11" fill="#4a1d1d"/><ellipse cx="50" cy="78" rx="7" ry="3.6" fill="#ff8fa3"/></g>
      <path d="M14 60h14M15 66l13-2M86 60H72M85 66l-13-2" stroke="#bdb5a8" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`,
  // Bread-loaf cat: an orange loaf with tucked paws and happy closed eyes.
  loaf: () => `<svg viewBox="0 0 100 100" aria-hidden="true">
      <ellipse class="shadow" cx="50" cy="95" rx="38" ry="4" fill="#000" opacity=".18"/>
      <path class="tail" d="M86 84c8 0 10-10 4-14" fill="none" stroke="#f39a3d" stroke-width="7" stroke-linecap="round"/>
      <path class="body" d="M10 74c0-22 16-30 40-30s40 8 40 30v8q0 10-10 10H20Q10 92 10 82Z" fill="#ffad55" stroke="#e08a35" stroke-width="2"/>
      <path d="M62 54c6 2 10 6 12 12M68 50c6 3 10 8 11 14" fill="none" stroke="#e8893a" stroke-width="3" stroke-linecap="round"/>
      <path d="M24 40 26 16 42 30Z M76 40 74 16 58 30Z" fill="#ffad55" stroke="#e08a35" stroke-width="2" stroke-linejoin="round"/>
      <path class="head" d="M22 50c0-17 12-24 28-24s28 7 28 24-12 26-28 26-28-9-28-26Z" fill="#ffb764" stroke="#e08a35" stroke-width="2"/>
      <path d="M43 30l1 6M50 29v7M57 30l-1 6" stroke="#e8893a" stroke-width="2.6" stroke-linecap="round"/>
      <g class="eye closed-eyes"><path d="M33 50q5-6 10 0M57 50q5-6 10 0" fill="none" stroke="#231a14" stroke-width="2.6" stroke-linecap="round"/></g>
      <g class="open-eyes">${eye(38, 50, 4.5, 5.5)}${eye(62, 50, 4.5, 5.5)}</g>
      ${dizzyEyes(38, 62, 50)}
      ${blush(30, 60)}${blush(70, 60)}
      <path d="M48 57h4l-2 2.4z" fill="#ff8fa3"/>
      <path class="mouth closed" d="M45 61q2.5 3 5 0 2.5 3 5 0" fill="none" stroke="#231a14" stroke-width="2" stroke-linecap="round"/>
      <g class="mouth open"><ellipse cx="50" cy="65" rx="5" ry="6" fill="#4a1d1d"/></g>
      <g class="feet"><ellipse class="foot l" cx="38" cy="90" rx="8" ry="4.5" fill="#ffd0a0" stroke="#e08a35" stroke-width="1.5"/><ellipse class="foot r" cx="62" cy="90" rx="8" ry="4.5" fill="#ffd0a0" stroke="#e08a35" stroke-width="1.5"/></g>
    </svg>`,
  // "Huh?" cat: grey tabby with huge eyes.
  huh: () => `<svg viewBox="0 0 100 100" aria-hidden="true">
      <ellipse class="shadow" cx="50" cy="95" rx="28" ry="4" fill="#000" opacity=".18"/>
      <path class="tail" d="M76 84c16 4 20-14 12-20" fill="none" stroke="#9c958d" stroke-width="7" stroke-linecap="round"/>
      <path d="M18 46 22 10 44 30Z M82 46 78 10 56 30Z" fill="#b3aca4" stroke="#8d867e" stroke-width="2" stroke-linejoin="round"/>
      <path d="M24 38 26 20 37 30Z M76 38 74 20 63 30Z" fill="#f2b8c4"/>
      <path class="body" d="M14 60C14 36 30 26 50 26S86 36 86 60 72 93 50 93 14 84 14 60Z" fill="#bdb6ae" stroke="#8d867e" stroke-width="2"/>
      <path d="M42 30l2 9M50 29v10M58 30l-2 9M16 56h10M16 63h9M84 56H74M84 63h-9" stroke="#8d867e" stroke-width="2.6" stroke-linecap="round"/>
      <g class="eye"><circle cx="36" cy="56" r="10" fill="#e8f07a" stroke="#6b665f" stroke-width="1.5"/><circle cx="64" cy="56" r="10" fill="#e8f07a" stroke="#6b665f" stroke-width="1.5"/>
        <g class="look"><ellipse cx="36" cy="56" rx="3.4" ry="7.5" fill="#1b1611"/><ellipse cx="64" cy="56" rx="3.4" ry="7.5" fill="#1b1611"/><circle cx="38" cy="52" r="2" fill="#fff"/><circle cx="66" cy="52" r="2" fill="#fff"/></g></g>
      ${dizzyEyes(36, 64, 56)}
      <path d="M48 67h4l-2 2.5z" fill="#e88a9c"/>
      <path class="mouth closed" d="M47 72l3 2 3-2" fill="none" stroke="#231a14" stroke-width="2" stroke-linecap="round"/>
      <g class="mouth open"><ellipse cx="50" cy="75" rx="4.5" ry="5.5" fill="#4a1d1d"/></g>
    </svg>`,
  custom: () => `<img class="custom-art" alt="" src="${cfg().custom || ''}" draggable="false">`,
};

const KINDS = {
  nailong: { name: '奶龙', lines: ['我是奶龙!', '哈哈哈哈', '嘿嘿嘿', '奶龙来咯'], favorite: ['laugh', 'laugh', 'jump', 'hearts'] },
  roo: { name: '外卖袋鼠', lines: ['外卖到了!', '准时达~', '跑单中', '袋鼠冲冲冲'], favorite: ['deliver', 'deliver', 'zoom', 'jump'] },
  egg: { name: '奶蛋', lines: ['奶蛋!', '嘿嘿~', '蛋蛋来啦', '♡', '戳我干嘛'], favorite: ['crack', 'jump', 'hearts'] },
  pop: { name: 'Pop 猫', lines: ['POP!', '喵', 'pop pop', '喵喵?'], favorite: ['pop', 'pop', 'spin'] },
  loaf: { name: '面包猫', lines: ['面包喵~', '喵呜', '好困…', '揉揉'], favorite: ['zzz', 'zoom', 'hearts'] },
  huh: { name: 'Huh 猫', lines: ['huh?', '？？？', '喵?', 'what'], favorite: ['tilt', 'dizzy', 'jump'] },
  custom: { name: '我的宠物', lines: ['hi!', '♡', '!!'], favorite: ['jump', 'spin', 'hearts'] },
};

// ---------- Sound (tiny synth, off by default) ----------

let audio = null;
function sound(kind) {
  if (!cfg().sound) return;
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const o = audio.createOscillator();
    const g = audio.createGain();
    const f = audio.createBiquadFilter();
    o.connect(f).connect(g).connect(audio.destination);
    f.type = 'lowpass';
    f.frequency.value = 2400;
    g.gain.setValueAtTime(0.0001, t);
    const env = (peak, len) => {
      g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.start(t);
      o.stop(t + len + 0.02);
    };
    if (kind === 'pop') {
      o.type = 'sine';
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(180, t + 0.09);
      env(0.35, 0.11);
    } else if (kind === 'boing') {
      o.type = 'triangle';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(620, t + 0.12);
      o.frequency.exponentialRampToValueAtTime(260, t + 0.3);
      env(0.25, 0.32);
    } else if (kind === 'meow') {
      o.type = 'sawtooth';
      f.frequency.setValueAtTime(1200, t);
      f.frequency.linearRampToValueAtTime(2600, t + 0.15);
      f.frequency.linearRampToValueAtTime(900, t + 0.45);
      o.frequency.setValueAtTime(520, t);
      o.frequency.linearRampToValueAtTime(760, t + 0.14);
      o.frequency.linearRampToValueAtTime(460, t + 0.45);
      env(0.12, 0.48);
    } else {
      o.type = 'sine';
      o.frequency.setValueAtTime(1300, t);
      o.frequency.exponentialRampToValueAtTime(1900, t + 0.06);
      env(0.12, 0.12);
    }
  } catch {}
}

// ---------- Pets ----------

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
let pets = [];
let mouse = { x: -9999, y: -9999 };
let treat = null;
let raf = 0;
let last = 0;

function bounds() {
  return { w: board.clientWidth - SIZE, h: board.clientHeight - SIZE };
}

class Pet {
  constructor(kind, spawn = true) {
    this.kind = kind;
    this.squashEl = h('div.pet-squash', (this.art = h('div.pet-art')));
    this.art.innerHTML = ART[kind]();
    this.flip = h('div.pet-flip', this.squashEl);
    this.fxEl = h('div.pet-fx');
    this.tag = h('div.pet-tag', KINDS[kind].name);
    this.el = h('div.pet', { dataset: { kind }, role: 'button', 'aria-label': `${KINDS[kind].name} (click me)` }, this.flip, this.fxEl, this.tag);
    const b = bounds();
    this.x = rand(0, Math.max(1, b.w));
    this.y = rand(0, Math.max(1, b.h));
    this.setHeading(rand(0, Math.PI * 2));
    this.state = 'roam';
    this.until = performance.now() + rand(3000, 8000);
    this.face = this.vx < 0 ? -1 : 1;
    this.lastReaction = '';
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    layer.append(this.el);
    this.blinkTimer = setTimeout(() => this.blink(), rand(1500, 5000));
    if (spawn) this.spawn();
  }

  get speed() {
    return fx.reduced() ? 0 : BASE_SPEED * cfg().speed;
  }

  setHeading(a, mult = 1) {
    this.vx = Math.cos(a) * this.speed * mult;
    this.vy = Math.sin(a) * this.speed * mult;
  }

  spawn() {
    // Drops in from above with a squash and a puff.
    const dy = -(this.y + SIZE + 40);
    fx.play(this.art, [{ transform: `translateY(${dy}px) rotate(-30deg)`, opacity: 0.4 }, { transform: 'translateY(0) rotate(0)', opacity: 1, offset: 0.7 }, { transform: 'translateY(-14px)', offset: 0.85 }, { transform: 'none' }], { duration: 900, easing: 'cubic-bezier(.3,0,.4,1)' });
    setTimeout(() => this.squash(1.25, 0.75), 640);
  }

  remove() {
    clearTimeout(this.blinkTimer);
    const a = fx.play(this.el, [{ opacity: 1, transform: this.el.style.transform + ' scale(1)' }, { opacity: 0, transform: this.el.style.transform + ' scale(.2)' }], { duration: 320, easing: fx.EASE_IN });
    const r = this.el.getBoundingClientRect();
    fx.confetti(r.left + r.width / 2, r.top + r.height / 2, { count: 10, power: 3.5, size: 4, colors: ['#ffffff', '#d8ff5a', '#ffd166'] });
    a ? (a.onfinish = () => this.el.remove()) : this.el.remove();
  }

  blink() {
    if (!this.el.isConnected) return;
    if (this.state !== 'sleep') {
      this.el.classList.add('blink');
      setTimeout(() => this.el.classList.remove('blink'), 140);
      // Sometimes a double blink.
      if (Math.random() < 0.25) setTimeout(() => { this.el.classList.add('blink'); setTimeout(() => this.el.classList.remove('blink'), 120); }, 260);
    }
    this.blinkTimer = setTimeout(() => this.blink(), rand(2200, 6000));
  }

  squash(sx = 0.78, sy = 1.18, origin = 'center bottom') {
    this.squashEl.style.transformOrigin = origin;
    fx.play(this.squashEl, [{ transform: `scale(${sx}, ${sy})` }, { transform: 'none' }], fx.SPRING_BOUNCY);
  }

  // ---- movement ----
  update(dt, now, b) {
    if (this.state === 'drag') return;
    if (this.state === 'fling') {
      const f = Math.pow(0.12, dt); // friction
      this.vx *= f;
      this.vy *= f;
      this.move(dt, b, 0.72);
      if (Math.hypot(this.vx, this.vy) < this.speed * 1.05) {
        this.state = 'roam';
        this.until = now + rand(2500, 6000);
        if (Math.hypot(this.vx, this.vy) < 1) this.setHeading(rand(0, Math.PI * 2));
        else this.setHeading(Math.atan2(this.vy, this.vx));
      }
      return;
    }
    if (this.state === 'roam') {
      if (treat) {
        // Race for the treat.
        const dx = treat.x - this.x;
        const dy = treat.y - this.y;
        const d = Math.hypot(dx, dy);
        if (d < 26) return eatTreat(this);
        const sp = Math.max(this.speed, 40) * 2.6;
        this.vx += ((dx / d) * sp - this.vx) * Math.min(1, dt * 5);
        this.vy += ((dy / d) * sp - this.vy) * Math.min(1, dt * 5);
      } else {
        // Wander: drift the heading a little; slow down near the cursor to look at it.
        const a = Math.atan2(this.vy, this.vx) + rand(-0.9, 0.9) * dt;
        const near = Math.hypot(mouse.x - (this.x + SIZE / 2), mouse.y - (this.y + SIZE / 2)) < 110;
        const sp = this.speed * (near ? 0.25 : 1);
        this.vx += (Math.cos(a) * sp - this.vx) * Math.min(1, dt * 3);
        this.vy += (Math.sin(a) * sp - this.vy) * Math.min(1, dt * 3);
        if (now > this.until) {
          this.state = Math.random() < 0.15 ? 'sleep' : 'idle';
          this.el.classList.toggle('sleeping', this.state === 'sleep');
          this.until = now + (this.state === 'sleep' ? rand(5000, 9000) : rand(1500, 3800));
          if (this.state === 'sleep') this.zzz();
        }
      }
      this.move(dt, b, 1);
      return;
    }
    if ((this.state === 'idle' || this.state === 'sleep' || this.state === 'react') && now > this.until) {
      this.wake();
    }
    if (treat && (this.state === 'idle' || this.state === 'sleep')) this.wake();
  }

  wake() {
    this.el.classList.remove('sleeping');
    clearInterval(this.zTimer);
    this.state = 'roam';
    this.until = performance.now() + rand(3500, 9000);
    this.setHeading(rand(0, Math.PI * 2));
  }

  move(dt, b, restitution) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const hard = Math.hypot(this.vx, this.vy) > this.speed * 2;
    if (this.x < 0 || this.x > b.w) {
      this.x = Math.max(0, Math.min(b.w, this.x));
      this.vx = -this.vx * restitution;
      if (hard) {
        this.squash(0.7, 1.2, this.vx > 0 ? 'left center' : 'right center');
        sound('boing');
      }
    }
    if (this.y < 0 || this.y > b.h) {
      this.y = Math.max(0, Math.min(b.h, this.y));
      this.vy = -this.vy * restitution;
      if (hard) {
        this.squash(1.25, 0.72, this.vy < 0 ? 'center bottom' : 'center top');
        sound('boing');
      }
    }
    if (Math.abs(this.vx) > 4) this.face = this.vx < 0 ? -1 : 1;
  }

  render(now) {
    this.el.style.transform = `translate3d(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px, 0)`;
    this.flip.style.transform = `scaleX(${this.face})`;
    this.el.classList.toggle('walking', this.state === 'roam' || this.state === 'fling');
    this.el.style.zIndex = String(Math.round(this.y));
    // Eyes follow the cursor (in art space: flip the x when facing left).
    const cx = this.x + SIZE / 2;
    const cy = this.y + SIZE / 2;
    const dx = mouse.x - cx;
    const dy = mouse.y - cy;
    const d = Math.hypot(dx, dy);
    if (d < 260 && d > 1) {
      this.el.style.setProperty('--lx', `${((dx / d) * 2.2 * this.face).toFixed(2)}px`);
      this.el.style.setProperty('--ly', `${((dy / d) * 2).toFixed(2)}px`);
    } else {
      this.el.style.setProperty('--lx', '0px');
      this.el.style.setProperty('--ly', '0px');
    }
  }

  // ---- input ----
  down(e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const r = board.getBoundingClientRect();
    const ox = e.clientX - r.left - this.x;
    const oy = e.clientY - r.top - this.y;
    let dragging = false;
    const samples = [];
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) {
        dragging = true;
        this.prevState = this.state;
        this.state = 'drag';
        this.el.classList.add('held');
        this.el.classList.remove('sleeping');
        this.squash(1.12, 0.9, 'center top');
      }
      if (!dragging) return;
      const b = bounds();
      this.x = Math.max(-10, Math.min(b.w + 10, ev.clientX - r.left - ox));
      this.y = Math.max(-10, Math.min(b.h + 10, ev.clientY - r.top - oy));
      samples.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
      if (samples.length > 6) samples.shift();
      const dir = samples.length > 1 ? samples[samples.length - 1].x - samples[0].x : 0;
      if (Math.abs(dir) > 2) this.face = dir < 0 ? -1 : 1;
      this.squashEl.style.rotate = `${Math.max(-25, Math.min(25, dir * 0.8))}deg`;
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      this.el.classList.remove('held');
      this.squashEl.style.rotate = '';
      if (!dragging) return this.react();
      // Throw with the release velocity.
      const a = samples[0];
      const z = samples[samples.length - 1];
      const dt = a && z && z.t > a.t ? (z.t - a.t) / 1000 : 1;
      let vx = a ? (z.x - a.x) / dt : 0;
      let vy = a ? (z.y - a.y) / dt : 0;
      const sp = Math.hypot(vx, vy);
      if (sp > 2200) { vx *= 2200 / sp; vy *= 2200 / sp; }
      this.vx = vx;
      this.vy = vy;
      this.state = 'fling';
      if (sp > 300) {
        sound('boing');
        this.say(pick(['wheee!', '啊啊啊', '飞~', '!!!']));
      }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  // ---- reactions ----
  react(name) {
    if (this.state === 'sleep' && !name) {
      this.el.classList.remove('sleeping');
      clearInterval(this.zTimer);
      this.say('!');
      return this.do('jump');
    }
    const k = KINDS[this.kind];
    const own = { egg: ['crack'], nailong: ['laugh'], roo: ['deliver'] }[this.kind] || [];
    const pool = ['jump', 'spin', 'hearts', 'dizzy', 'speak', 'zoom', 'pop', 'zzz', 'tilt', ...own, ...k.favorite, ...k.favorite];
    let r = name || pick(pool);
    if (!name) while (r === this.lastReaction) r = pick(pool);
    this.lastReaction = r;
    this.do(r);
  }

  do(r) {
    const now = performance.now();
    const hold = (ms) => {
      this.state = 'react';
      this.vx = this.vy = 0;
      this.until = now + ms;
    };
    const k = KINDS[this.kind];
    switch (r) {
      case 'jump':
        hold(800);
        sound('boing');
        this.squash(1.2, 0.8);
        fx.play(this.art, [
          { transform: 'translateY(0) rotate(0) scale(1)' },
          { transform: 'translateY(-78px) rotate(180deg) scale(1.08)', offset: 0.45 },
          { transform: 'translateY(0) rotate(360deg) scale(1)', offset: 0.85 },
          { transform: 'translateY(-8px) rotate(360deg)', offset: 0.93 },
          { transform: 'translateY(0) rotate(360deg)' },
        ], { duration: 760, easing: 'cubic-bezier(.3,.6,.4,1)' });
        setTimeout(() => this.squash(1.3, 0.7), 640);
        break;
      case 'spin':
        hold(900);
        sound('chirp');
        fx.play(this.art, [{ transform: 'rotate(0) scale(1)' }, { transform: 'rotate(400deg) scale(1.2)', offset: 0.6 }, { transform: 'rotate(720deg) scale(1)' }], { duration: 850, easing: 'cubic-bezier(.5,0,.3,1)' });
        setTimeout(() => this.burst(['#d8ff5a', '#ffd166', '#7cc7ff'], 14), 500);
        break;
      case 'hearts':
        hold(1300);
        sound('meow');
        this.el.classList.add('love');
        setTimeout(() => this.el.classList.remove('love'), 1300);
        for (let i = 0; i < 7; i++) this.float(pick(['♥', '♥', '❤', '💕']), { delay: i * 110, color: pick(['#ff6b8b', '#ff8fab', '#ff4d6d']), size: rand(14, 22), dx: rand(-40, 40) });
        fx.play(this.art, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(.96)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 900, easing: 'ease-in-out' });
        break;
      case 'dizzy':
        hold(1900);
        this.el.classList.add('dizzy');
        setTimeout(() => this.el.classList.remove('dizzy'), 1900);
        fx.play(this.art, [0, -14, 12, -10, 8, -5, 0].map((d) => ({ transform: `rotate(${d}deg) translateX(${d * 0.3}px)` })), { duration: 1500, easing: 'ease-in-out' });
        this.fxEl.append(h('div.stars', h('span', '★'), h('span', '✦'), h('span', '★')));
        setTimeout(() => this.fxEl.querySelector('.stars')?.remove(), 1900);
        break;
      case 'speak':
        hold(1500);
        sound(this.kind === 'egg' ? 'chirp' : 'meow');
        this.say(pick(k.lines));
        this.squash(0.9, 1.12);
        break;
      case 'zoom': {
        sound('boing');
        this.say('💨');
        this.el.classList.add('zoomies');
        setTimeout(() => this.el.classList.remove('zoomies'), 900);
        const a = rand(0, Math.PI * 2);
        this.vx = Math.cos(a) * 1500;
        this.vy = Math.sin(a) * 1500;
        this.state = 'fling';
        break;
      }
      case 'pop':
        hold(700);
        sound('pop');
        this.el.classList.add('open');
        this.squash(1.18, 0.86);
        this.say('POP!', { big: true });
        setTimeout(() => this.el.classList.remove('open'), 260);
        // Pop cat pops twice.
        if (this.kind === 'pop') setTimeout(() => { sound('pop'); this.el.classList.add('open'); this.squash(1.18, 0.86); setTimeout(() => this.el.classList.remove('open'), 220); }, 380);
        break;
      case 'zzz':
        this.state = 'sleep';
        this.vx = this.vy = 0;
        this.until = now + rand(4500, 6500);
        this.el.classList.add('sleeping');
        this.zzz();
        break;
      case 'tilt':
        hold(1300);
        this.el.classList.add('wide');
        setTimeout(() => this.el.classList.remove('wide'), 1300);
        this.say(this.kind === 'huh' ? 'huh?' : '?');
        fx.play(this.art, [{ transform: 'rotate(0)' }, { transform: 'rotate(-22deg)', offset: 0.2 }, { transform: 'rotate(-22deg)', offset: 0.75 }, { transform: 'rotate(0)' }], { duration: 1200, easing: 'cubic-bezier(.3,1.4,.5,1)' });
        break;
      case 'laugh':
        // 奶龙's signature: mouth wide, whole body shaking, 哈哈哈 floating up.
        hold(1700);
        sound('pop');
        this.el.classList.add('open', 'laughing');
        fx.play(this.art, Array.from({ length: 13 }, (_, i) => ({ transform: i === 12 ? 'none' : `translate(${i % 2 ? 3 : -3}px, ${i % 3 ? -2 : 1}px) rotate(${i % 2 ? 4 : -4}deg) scale(${1 + (i % 4) * 0.02})` })), { duration: 1500, easing: 'linear' });
        for (let i = 0; i < 4; i++) this.float(pick(['哈', '哈哈', '哈哈哈']), { delay: i * 260, color: '#f2b81c', size: rand(15, 22), dx: rand(-36, 36), font: '700 1em var(--font-display)' });
        setTimeout(() => this.el.classList.remove('open', 'laughing'), 1600);
        break;
      case 'deliver': {
        // Delivery kangaroo: three hops in a row, then "外卖到了!"
        hold(1500);
        const hop = [
          { transform: 'translateY(0) rotate(0)' },
          { transform: 'translateY(-40px) rotate(-8deg)', offset: 0.15 }, { transform: 'translateY(0) rotate(0)', offset: 0.3 },
          { transform: 'translateY(-46px) rotate(-8deg)', offset: 0.47 }, { transform: 'translateY(0) rotate(0)', offset: 0.64 },
          { transform: 'translateY(-56px) rotate(350deg)', offset: 0.82 }, { transform: 'translateY(0) rotate(360deg)' },
        ];
        fx.play(this.art, hop, { duration: 1300, easing: 'ease-in-out' });
        [0, 390, 820].forEach((d) => setTimeout(() => { sound('boing'); this.squash(1.2, 0.8); }, d + 180));
        setTimeout(() => {
          this.say(pick(['外卖到了!', '您的外卖~', '准时送达!']));
          this.float('📦', { size: 20, dy: -60 });
        }, 1250);
        break;
      }
      case 'crack':
        hold(1800);
        sound('pop');
        this.el.classList.add('cracked');
        fx.play(this.art, [0, -6, 6, -5, 5, -3, 3, 0].map((d) => ({ transform: `rotate(${d}deg)` })), { duration: 600 });
        setTimeout(() => {
          this.burst(['#ffd23f', '#ffcf4d', '#fff6e3'], 18);
          this.say('蛋黄!');
          this.squash(1.2, 0.85);
        }, 650);
        setTimeout(() => this.el.classList.remove('cracked'), 1800);
        break;
    }
  }

  zzz() {
    clearInterval(this.zTimer);
    const once = () => this.float('z', { color: 'var(--fg-muted)', size: rand(12, 18), dx: rand(8, 26), dy: -44, font: '600 1em var(--font-display)' });
    once();
    this.zTimer = setInterval(() => (this.state === 'sleep' ? once() : clearInterval(this.zTimer)), 750);
  }

  say(text, { big = false } = {}) {
    this.fxEl.querySelector('.bubble')?.remove();
    const b = h(`div.bubble${big ? '.big' : ''}`, text);
    this.fxEl.append(b);
    fx.play(b, [{ opacity: 0, transform: 'translate(-50%, 8px) scale(.4)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)' }], fx.SPRING_BOUNCY);
    setTimeout(() => {
      const a = fx.play(b, [{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%, -10px) scale(.9)' }], { duration: 250, fill: 'forwards' });
      a ? (a.onfinish = () => b.remove()) : b.remove();
    }, big ? 700 : 1400);
  }

  float(text, { delay = 0, color, size = 16, dx = 0, dy = -70, font } = {}) {
    const s = h('span.floaty', { style: { color, fontSize: size + 'px', ...(font ? { font } : {}) } }, text);
    this.fxEl.append(s);
    const a = fx.play(s, [{ opacity: 0, transform: 'translate(-50%, 0) scale(.4)' }, { opacity: 1, transform: `translate(calc(-50% + ${dx * 0.4}px), ${dy * 0.35}px) scale(1)`, offset: 0.25 }, { opacity: 0, transform: `translate(calc(-50% + ${dx}px), ${dy}px) scale(.8) rotate(${dx * 0.3}deg)` }], { duration: 1300, delay, easing: 'ease-out', fill: 'backwards' });
    a ? (a.onfinish = () => s.remove()) : s.remove();
  }

  burst(colors, count) {
    const r = this.el.getBoundingClientRect();
    fx.confetti(r.left + r.width / 2, r.top + r.height / 3, { count, power: 5, size: 4.5, colors, gravity: 0.2 });
  }
}

// ---------- World ----------

function collide() {
  for (let i = 0; i < pets.length; i++) {
    for (let j = i + 1; j < pets.length; j++) {
      const a = pets[i];
      const b = pets[j];
      if (a.state === 'drag' || b.state === 'drag') continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = SIZE * 0.72;
      if (d >= min || d === 0) continue;
      const nx = dx / d;
      const ny = dy / d;
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      // Bounce: exchange velocity along the normal (only for moving pets).
      const va = a.vx * nx + a.vy * ny;
      const vb = b.vx * nx + b.vy * ny;
      if (va - vb > 0) {
        const movingA = a.state === 'roam' || a.state === 'fling';
        const movingB = b.state === 'roam' || b.state === 'fling';
        if (movingA) { a.vx += (vb - va) * nx; a.vy += (vb - va) * ny; }
        if (movingB) { b.vx += (va - vb) * nx; b.vy += (va - vb) * ny; }
        if (Math.abs(va - vb) > 60) {
          a.squash(0.85, 1.1);
          b.squash(0.85, 1.1);
        }
      }
    }
  }
}

function step(now) {
  const dt = Math.min(0.05, (now - (last || now)) / 1000);
  last = now;
  const b = bounds();
  for (const p of pets) p.update(dt, now, b);
  collide();
  for (const p of pets) p.render(now);
  raf = pets.length ? requestAnimationFrame(step) : 0;
}

function ensureLoop() {
  if (!raf && pets.length) {
    last = 0;
    raf = requestAnimationFrame(step);
  }
}

/** Matches the pets on the board to the settings (count + enabled kinds). */
export function syncPets() {
  const c = cfg();
  const kinds = c.kinds.filter((k) => ART[k] && (k !== 'custom' || c.custom));
  const want = kinds.length ? Array.from({ length: c.count }, (_, i) => kinds[i % kinds.length]) : [];
  // Keep pets whose kind still matches their slot; replace or remove the rest.
  for (let i = 0; i < Math.max(want.length, pets.length); i++) {
    const p = pets[i];
    if (p && want[i] === p.kind && !(p.kind === 'custom' && p.customSrc !== c.custom)) continue;
    if (p) p.remove();
    if (want[i]) {
      pets[i] = new Pet(want[i]);
      if (want[i] === 'custom') pets[i].customSrc = c.custom;
    } else pets[i] = null;
  }
  pets = pets.filter(Boolean);
  for (const p of pets) {
    // Speed changes apply to the current heading.
    if (p.state === 'roam') p.setHeading(Math.atan2(p.vy, p.vx) || rand(0, 6.28));
  }
  updateControl();
  ensureLoop();
}

// ---------- Treats & events ----------

function giveTreat() {
  if (!pets.length) return toast('No pets out. Slide the pets slider up first.');
  treat?.el.remove();
  const b = bounds();
  const t = { x: rand(SIZE, Math.max(SIZE + 1, b.w - SIZE)), y: rand(SIZE, Math.max(SIZE + 1, b.h - SIZE)) };
  t.el = h('div.treat', pick(['🐟', '🍪', '🥛', '🍳', '🍤']));
  t.el.style.transform = `translate(${t.x + SIZE / 2 - 14}px, ${t.y + SIZE / 2 - 14}px)`;
  layer.append(t.el);
  fx.play(t.el, [{ opacity: 0, transform: `translate(${t.x + SIZE / 2 - 14}px, ${t.y - 200}px) rotate(-90deg)` }, { opacity: 1, transform: `translate(${t.x + SIZE / 2 - 14}px, ${t.y + SIZE / 2 - 14}px)` }], fx.SPRING_BOUNCY);
  treat = t;
  for (const p of pets) {
    if (p.state !== 'drag') p.wake();
    p.say(pick(['!!', '吃的!', '!', '冲!']));
  }
}

function eatTreat(p) {
  const t = treat;
  treat = null;
  const r = t.el.getBoundingClientRect();
  fx.confetti(r.left + 14, r.top + 14, { count: 16, power: 4, size: 4, colors: ['#ffd166', '#ffffff', '#ff9e7a'] });
  t.el.remove();
  sound('pop');
  p.vx = p.vy = 0;
  p.say(pick(['yum!', '好吃!', '嗷呜', '😋']));
  p.do('hearts');
  for (const o of pets) if (o !== p && o.state === 'roam') o.say(pick(['…', '哼', '下次!']));
}

document.addEventListener('planner:done', () => {
  if (!cfg().cheer || !pets.length) return;
  for (const p of pets) {
    if (p.state === 'drag') continue;
    if (Math.random() < 0.6) setTimeout(() => p.do(Math.random() < 0.5 ? 'hearts' : 'jump'), rand(0, 400));
  }
});

document.addEventListener('planner:celebrate', () => {
  if (!cfg().cheer) return;
  pets.forEach((p, i) => p.state !== 'drag' && setTimeout(() => { p.do(i % 2 ? 'spin' : 'jump'); p.say(pick(['🎉', '好耶!', 'yay!'])); }, i * 140));
});

board.addEventListener('pointermove', (e) => {
  const r = board.getBoundingClientRect();
  mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
});
board.addEventListener('pointerleave', () => (mouse = { x: -9999, y: -9999 }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') last = 0;
});

// ---------- Top-bar control + panel ----------

const range = document.getElementById('pets-range');
const countEl = document.getElementById('pets-count');

function updateControl() {
  const c = cfg();
  range.value = String(c.count);
  countEl.textContent = String(c.count);
  range.style.setProperty('--p', `${(c.count / Number(range.max)) * 100}%`);
}

range.addEventListener('input', () => {
  setCfg({ count: Number(range.value) });
  syncPets();
});
range.addEventListener('change', () => setCfg({ count: Number(range.value) }, { quiet: false }));

document.getElementById('pets-btn').addEventListener('click', (e) => openPanel(e.currentTarget));

function openPanel(anchor) {
  const c = cfg();
  const kindTile = (k) =>
    h(`button.pet-pick${c.kinds.includes(k) ? '.on' : ''}`, {
      title: KINDS[k].name,
      onclick: () => {
        const cur = cfg().kinds;
        setCfg({ kinds: cur.includes(k) ? cur.filter((x) => x !== k) : [k, ...cur] }, { quiet: false });
        syncPets();
        openPanel(anchor);
      },
    }, h('span.pet-thumb', { innerHTML: ART[k]() }), h('span', KINDS[k].name));

  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => uploadCustom(e.target.files[0], anchor) });
  const content = h('div.pets-panel',
    h('div.inline', { style: { justifyContent: 'space-between' } }, h('strong', '🐾 Pets'), h('span.small.muted', `${c.count} on the board`)),
    h('div.pet-picks', PICKS.map(kindTile),
      c.custom
        ? kindTile('custom')
        : h('label.pet-pick.upload', { title: 'Use your own picture (e.g. the real 奶蛋)' }, h('span.pet-thumb.plus', '+'), h('span', 'Upload pet'), fileInput)),
    c.custom ? h('div.inline.small', { style: { gap: '6px', marginTop: '-2px' } },
      h('label.btn.small.ghost', { style: { cursor: 'pointer' } }, 'Change picture', fileInput),
      h('button.btn.small.ghost.danger', { onclick: () => { setCfg({ custom: null, kinds: cfg().kinds.filter((x) => x !== 'custom') }, { quiet: false }); syncPets(); openPanel(anchor); } }, 'Remove')) : null,
    h('div.field', { style: { marginTop: '10px' } }, h('label', `Speed ${c.speed.toFixed(1)}×`),
      h('input.pet-range', {
        type: 'range', min: 0.3, max: 2.5, step: 0.1, value: c.speed,
        style: { '--p': `${((c.speed - 0.3) / 2.2) * 100}%` },
        oninput: (e) => {
          const v = Number(e.target.value);
          setCfg({ speed: v });
          e.target.previousSibling.textContent = `Speed ${v.toFixed(1)}×`;
          e.target.style.setProperty('--p', `${((v - 0.3) / 2.2) * 100}%`);
          syncPets();
        },
      })),
    h('label.cal-pick', h('input', { type: 'checkbox', checked: c.sound, onchange: (e) => { setCfg({ sound: e.target.checked }, { quiet: false }); if (e.target.checked) sound('meow'); } }), 'Sounds'),
    h('label.cal-pick', h('input', { type: 'checkbox', checked: c.cheer, onchange: (e) => setCfg({ cheer: e.target.checked }, { quiet: false }) }), 'Cheer when I finish tasks'),
    h('div.inline', { style: { flexWrap: 'wrap', gap: '6px', marginTop: '10px' } },
      h('button.btn.small', { onclick: giveTreat }, '🐟 Treat'),
      h('button.btn.small', { onclick: () => pets.forEach((p, i) => setTimeout(() => p.do('zzz'), i * 120)) }, '💤 Nap'),
      h('button.btn.small', { onclick: party }, '🎉 Party'),
    ),
    h('p.help', { style: { marginTop: '10px' } }, 'Click a pet for a reaction · drag to throw · they cheer when you check things off.'),
  );
  popover(anchor, content);
}

function party() {
  pets.forEach((p, i) => setTimeout(() => {
    p.do(pick(['spin', 'jump', 'hearts', 'pop']));
    p.burst(['#d8ff5a', '#7cc7ff', '#ff9e7a', '#c79bff', '#ffd166'], 20);
  }, i * 160));
}

/** Downscales an uploaded picture to 160px and stores it in the board settings. */
function uploadCustom(file, anchor) {
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const s = 160 / Math.max(img.width, img.height);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * Math.min(1, s));
    c.height = Math.round(img.height * Math.min(1, s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/webp', 0.9);
    URL.revokeObjectURL(img.src);
    setCfg({ custom: url, kinds: ['custom', ...cfg().kinds.filter((x) => x !== 'custom')] }, { quiet: false });
    syncPets();
    closeFloats();
    toast('Your pet is out on the board');
    openPanel(anchor);
  };
  img.onerror = () => toast('That file could not be read as an image', { kind: 'warn' });
  img.src = URL.createObjectURL(file);
}

/** For tests and the console: the live pets. */
export const livePets = () => pets;

export function initPets() {
  updateControl();
  syncPets();
}
