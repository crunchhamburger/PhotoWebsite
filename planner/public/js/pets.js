// The desk pet: one 3D meme critter (奶龙, 奶蛙, 奶蛋, 美团老鼠) living on the whiteboard.
// It strolls (smooth steering, steps matched to distance), turns to face where it walks, looks
// at you, naps, visits your lists to comment on them, and has a mood that goes up when you pet
// it, feed it, play fetch or finish tasks.
// Interactions: click (reaction), double-click (signature move), hover (pet it), drag (pick up,
// flick to toss), right-click (menu), drop a task on it (eats = completes it), P (come here),
// Shift+P (follow me), fetch with a ball you throw, and it sits with you during focus sessions.
import { store, lists, findItem } from './store.js';
import * as fx from './motion.js';
import { h, popover, menu, closeFloats, toast, fmtDue } from './ui.js';
import { toggleItem } from './actions.js';
import { isTyping } from './board.js';
import { THREE, buildPet, loadGLBPet, GLB_PETS, addLights, shadowTexture } from './models3d.js';

const board = document.getElementById('board');
const layer = document.getElementById('pets');
const W = 210; // canvas size (CSS px)
const H = 250;
const BASE_SPEED = 30; // px/s at speed 1: a stroll

const KINDS = {
  nailong: {
    name: '奶龙', signature: ['tongue', 'tongue', 'dance'],
    lines: ['我是奶龙!', '嘿嘿', '略略略~', '奶龙饿了', '今天也要加油鸭'],
  },
  naiwa: {
    name: '奶蛙', signature: ['bellyrub', 'sideeye', 'sideeye'],
    lines: ['……', '呱', '肚肚好圆', '👀', '在看你学习'],
  },
  naidan: {
    name: '奶蛋', signature: ['wobble', 'flip', 'wobble'],
    lines: ['咕?', '我是蛋', '别把我煎了', '滚来滚去', '……咕'],
  },
  laoshu: {
    name: '美团老鼠', signature: ['laugh', 'laugh', 'hops'],
    lines: ['你的外卖我偷吃了😋', '哈哈哈哈', '黄色的不一定是外卖', '准时送达!', '饿饿'],
  },
};
const ORDER = ['nailong', 'naiwa', 'naidan', 'laoshu'];
const DEFAULTS = { kind: 'nailong', on: true, speed: 1, size: 1, sound: false, cheer: true, chatty: true, quiet: false, names: {}, mood: 70, moodAt: 0 };
export const cfg = () => ({ ...DEFAULTS, ...(store.state.settings.pet || {}) });
function setCfg(patch, { quiet = true } = {}) {
  store.update((s) => (s.settings.pet = { ...cfg(), ...patch }), { undoable: false, quiet });
}
const petName = (kind = cfg().kind) => cfg().names?.[kind] || KINDS[kind].name;

// ---------- Mood ----------
// 5..100. Drifts down ~3 points an hour; petting, food, fetch and finished tasks raise it.

function mood() {
  const c = cfg();
  const hours = c.moodAt ? (Date.now() - c.moodAt) / 3.6e6 : 0;
  return clamp(Math.round(c.mood - hours * 3), 5, 100);
}
function addMood(n) {
  setCfg({ mood: clamp(mood() + n, 5, 100), moodAt: Date.now() });
}
const moodWord = (m) => (m >= 85 ? '超开心' : m >= 65 ? '开心' : m >= 40 ? '还行' : m >= 20 ? '有点闷' : '想你了');

// ---------- Sound (tiny synth, off by default) ----------

let audio = null;
function sound(kind) {
  if (!cfg().sound) return;
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.connect(g).connect(audio.destination);
    g.gain.setValueAtTime(0.0001, t);
    const env = (peak, len) => {
      g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.start(t);
      o.stop(t + len + 0.02);
    };
    const f = o.frequency;
    if (kind === 'pop') { o.type = 'sine'; f.setValueAtTime(820, t); f.exponentialRampToValueAtTime(200, t + 0.1); env(0.3, 0.12); }
    else if (kind === 'boing') { o.type = 'triangle'; f.setValueAtTime(170, t); f.exponentialRampToValueAtTime(560, t + 0.12); f.exponentialRampToValueAtTime(240, t + 0.3); env(0.22, 0.32); }
    else if (kind === 'happy') { o.type = 'sine'; f.setValueAtTime(660, t); f.setValueAtTime(880, t + 0.09); f.setValueAtTime(1100, t + 0.18); env(0.15, 0.3); }
    else { o.type = 'sine'; f.setValueAtTime(1200, t); f.exponentialRampToValueAtTime(1800, t + 0.07); env(0.1, 0.12); }
  } catch {}
}

// ---------- Three.js scene ----------

let renderer, scene, camera, shadow, raycaster;
let wrap, canvas, fxEl;
let pet = null; // model parts
let feetFromTop = 0.8; // where the feet sit in the canvas (fraction from the top)

function setupGL() {
  if (renderer) return true;
  canvas = h('canvas.pet3d-canvas', { width: W * 2, height: H * 2 });
  fxEl = h('div.pet-fx');
  wrap = h('div.pet3d', canvas, fxEl);
  layer.append(wrap);
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    wrap.remove();
    return false;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  scene = new THREE.Scene();
  addLights(scene);
  camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 60);
  camera.position.set(0, 2.0, 8.2);
  camera.lookAt(0, 1.25, 0);
  camera.updateMatrixWorld();
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.003;
  scene.add(shadow);
  const v = new THREE.Vector3(0, 0, 0).project(camera);
  feetFromTop = (1 - v.y) / 2;
  wrap.style.transformOrigin = `${W / 2}px ${H * feetFromTop}px`;
  raycaster = new THREE.Raycaster();
  return true;
}

async function loadModel(kind) {
  const next = (await loadGLBPet(kind, GLB_PETS[kind])) || buildPet(kind);
  if (pet) {
    scene.remove(pet.root);
    if (!pet.glb) {
      pet.root.traverse((o) => {
        o.geometry?.dispose();
        if (o.material && !o.material.map) o.material.dispose();
      });
    }
  }
  pet = next;
  if (pet.glb) pet.scale = 1;
  else {
    const target = kind === 'naidan' ? 1.55 : 2.15;
    pet.scale = target / pet.height;
    pet.body.scale.setScalar(pet.scale);
  }
  scene.add(pet.root);
  shadow.scale.setScalar(kind === 'laoshu' ? 1.15 : 1);
}

// ---------- State ----------

// Modes that walk somewhere: stroll | visit | treat | fetch | carry | follow | buddy
// Modes that stay put: idle | sit | wait | sleep | react | drag | toss | drop
const WALKING = new Set(['stroll', 'visit', 'treat', 'fetch', 'carry', 'follow', 'buddy']);

const st = {
  x: 200, y: 300, // feet position on the board (px)
  tx: 200, ty: 300,
  heading: Math.PI / 2, spd: 0, // walking direction (screen radians) and speed (px/s)
  vx: 0, vy: 0, // free velocity for tosses and reaction moves
  yaw: 0, yawTarget: 0,
  mode: 'idle',
  until: 0,
  pauseUntil: 0,
  phase: 0, walk: 0, lastS: 0,
  sq: 1, sqV: 0,
  blinkAt: 0, blinkT: 0,
  hoverSince: 0, pettedAt: 0,
  lift: 0, liftV: 0,
  visit: null,
  follow: false,
  stay: false,
  buddy: false,
  drag: null, // { x, y } pointer target while held
  dragTilt: 0, dragVx: 0,
  lastActive: performance.now(),
  lastChat: performance.now(),
  look: { x: 0, y: 0 },
  idleLook: 0,
  reaction: null,
  savedAt: 0,
};
let mouse = { x: -9999, y: -9999, on: false };
let treat = null;
let ball = null;
let raf = 0;
let lastT = 0;
let running = false;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeIO = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const bounds = () => ({ x0: 70, y0: 150, x1: board.clientWidth - 70, y1: board.clientHeight - 20 });
const size = () => clamp(cfg().size || 1, 0.6, 1.5);

function squashImpulse(v) {
  st.sq = v;
  st.sqV = 0;
}

// ---------- Choosing where to go ----------

/** Card rectangles in board coordinates (the pet avoids loitering on top of your lists). */
function cardRects() {
  const br = board.getBoundingClientRect();
  return [...board.querySelectorAll('.card')].map((c) => {
    const r = c.getBoundingClientRect();
    return { l: r.left - br.left - 30, r: r.right - br.left + 30, t: r.top - br.top - 10, b: r.bottom - br.top + 120 };
  });
}
const onCard = (x, y, rects) => rects.some((c) => x > c.l && x < c.r && y > c.t && y < c.b);

/** A spot to stroll to, `near` px-ish away, preferring empty board. */
function freeSpot(minD = 70, maxD = 260) {
  const b = bounds();
  const rects = cardRects();
  let best = null;
  for (let i = 0; i < 14; i++) {
    const a = rand(0, Math.PI * 2);
    const d = rand(minD, maxD);
    const x = clamp(st.x + Math.cos(a) * d, b.x0, b.x1);
    const y = clamp(st.y + Math.sin(a) * d * 0.75, b.y0, b.y1);
    if (!onCard(x, y, rects)) return { x, y };
    best ??= { x, y };
  }
  return best;
}

function nextGoal(now) {
  const b = bounds();
  const m = mood();
  const hour = new Date().getHours();
  const night = hour >= 23 || hour < 6;
  const quiet = now - st.lastActive > 90000;
  if ((night || quiet) && Math.random() < 0.4) return sleep(now);
  if (m < 25 && Math.random() < 0.3 && mouse.on) {
    say(pick(['陪我玩嘛…', '摸摸我…', '无聊…']), { auto: true });
    return goTo(clamp(mouse.x + rand(-60, 60), b.x0, b.x1), clamp(mouse.y + 90, b.y0, b.y1), 'stroll');
  }
  if (m > 80 && Math.random() < 0.12) return start(pick(['dance', 'spin', 'hop1']));
  const r = Math.random();
  if (r < 0.25 && cfg().chatty) {
    // Visit one of the lists that's on screen.
    const br = board.getBoundingClientRect();
    const cards = [...board.querySelectorAll('.card:not(.note)')].filter((c) => {
      const cr = c.getBoundingClientRect();
      return cr.right > br.left + 60 && cr.left < br.right - 60 && cr.bottom > br.top + 120 && cr.bottom < br.bottom - 10;
    });
    if (cards.length) {
      const c = pick(cards);
      const cr = c.getBoundingClientRect();
      st.visit = c.dataset.id;
      return goTo(clamp(cr.left - br.left + rand(30, cr.width - 30), b.x0, b.x1), clamp(cr.bottom - br.top + 34, b.y0, b.y1), 'visit');
    }
  }
  if (r < 0.37 && mouse.on) return goTo(clamp(mouse.x + rand(-90, 90), b.x0, b.x1), clamp(mouse.y + rand(60, 110), b.y0, b.y1), 'stroll');
  const far = Math.random() < 0.25;
  const p = freeSpot(far ? 220 : 70, far ? 480 : 230);
  goTo(p.x, p.y, 'stroll');
}

function goTo(x, y, mode) {
  st.tx = x;
  st.ty = y;
  st.mode = mode;
  st.reaction = null;
}

function idle(now, ms = rand(4000, 9000)) {
  st.mode = 'idle';
  st.until = now + ms;
  st.idleLook = rand(0, 10);
}

function sleep(now) {
  st.mode = 'sleep';
  st.until = now + rand(10000, 20000);
  zzz();
}

/** After a reaction or interruption: go back to what it was doing. */
function resume(now) {
  st.reaction = null;
  if (ball && ball.state !== 'gone') {
    st.mode = 'wait';
    st.until = now + 20000;
  } else if (st.follow) st.mode = 'follow';
  else if (st.buddy && st.buddySpot) {
    // Back to its seat by the focus timer (walk there if it was moved).
    const far = Math.hypot(st.buddySpot.x - st.x, st.buddySpot.y - st.y) > 20;
    if (far) goTo(st.buddySpot.x, st.buddySpot.y, 'buddy');
    else st.mode = 'sit';
  } else idle(now, st.stay ? 1e9 : rand(1500, 4000));
}

// ---------- Movement ----------

/** Steers towards (tx, ty): limited turn rate, eased speed, slowing to arrive. Returns distance. */
function steer(dt, tx, ty, maxSp, arrive = 6) {
  const dx = tx - st.x;
  const dy = ty - st.y;
  const d = Math.hypot(dx, dy);
  const desired = Math.atan2(dy, dx);
  const turn = wrapAngle(desired - st.heading);
  // Turn on the spot when (nearly) stopped, gently while walking.
  const maxTurn = (st.spd < 8 ? 7 : 2.2) * dt;
  st.heading = wrapAngle(st.heading + clamp(turn, -maxTurn, maxTurn));
  // Brake over a distance that grows with speed, so fast runs (fetch, treats) don't overshoot.
  const brake = Math.max(60, maxSp * 0.7);
  const want = d <= arrive ? 0 : maxSp * clamp((d - arrive) / brake, 0.15, 1) * (0.3 + 0.7 * Math.max(0, Math.cos(turn)));
  st.spd += clamp(want - st.spd, -260 * dt, 60 * dt);
  return d;
}

function speedLimit(mode) {
  const base = fx.reduced() ? 0 : BASE_SPEED * cfg().speed * (mood() < 25 ? 0.75 : 1);
  return base * ({ treat: 3, fetch: 3.4, carry: 1.8, follow: 2.2, buddy: 1.6 }[mode] || 1);
}

function update(dt, now) {
  const b = bounds();
  let moving = false;

  if (st.mode === 'drag') {
    // Follow the pointer with a little lag; tilt with its speed.
    st.x += (st.drag.x - st.x) * Math.min(1, dt * 18);
    st.y += (st.drag.y - st.y) * Math.min(1, dt * 18);
    st.lift += (0.55 - st.lift) * Math.min(1, dt * 10);
    st.dragTilt += (clamp(-st.dragVx * 0.0011, -0.35, 0.35) - st.dragTilt) * Math.min(1, dt * 7);
    st.dragVx *= Math.exp(-dt * 6);
    st.spd = 0;
  } else if (WALKING.has(st.mode)) {
    let tx = st.tx;
    let ty = st.ty;
    let arrive = 6;
    if (st.mode === 'treat' && treat) ({ x: tx, y: ty } = treat);
    if (st.mode === 'fetch' && ball) ({ x: tx, y: ty } = ball);
    if (st.mode === 'carry' || (st.mode === 'follow' && mouse.on)) {
      tx = clamp(mouse.on ? mouse.x : board.clientWidth / 2, b.x0, b.x1);
      ty = clamp(mouse.on ? mouse.y + 80 : board.clientHeight / 2, b.y0, b.y1);
      arrive = st.mode === 'follow' ? 55 : 45;
    }
    const paused = now < st.pauseUntil;
    const d = steer(dt, tx, ty, paused ? 0 : speedLimit(st.mode), arrive);
    if (st.mode === 'stroll' && !paused && st.spd > 12 && Math.random() < dt * 0.06) {
      st.pauseUntil = now + rand(900, 2400); // stop to look around now and then
      st.idleLook = rand(0, 10);
    }
    // Arrived: stopped at the goal, or close enough when chasing something.
    const chasing = st.mode === 'fetch' || st.mode === 'treat';
    if ((d <= arrive + 2 && st.spd < 4) || (chasing && d <= 18)) arrive_(now);
    moving = st.spd > 3;
  } else {
    st.spd = Math.max(0, st.spd - 140 * dt);
    if (st.mode === 'idle' || st.mode === 'sit') {
      if (st.mode === 'idle' && !st.stay && now > st.until) nextGoal(now);
      else if (Math.random() < dt * 0.05) doIdleFidget(now);
    } else if (st.mode === 'wait') {
      if (now > st.until) endFetch();
      // Chase once the ball has landed (it may still be rolling).
      else if (ball?.state === 'free' && Math.hypot(ball.vx, ball.vy) < 260 && ball.z < 4 && Math.hypot(ball.x - st.x, ball.y - st.y) > 70) st.mode = 'fetch';
    } else if (st.mode === 'sleep') {
      if (now > st.until) wake(now);
    } else if (st.mode === 'react') {
      if (st.reaction?.move) {
        st.x += st.reaction.move.x * dt;
        st.y += st.reaction.move.y * dt;
      }
      if (now > st.until) resume(now);
    } else if (st.mode === 'toss' || st.mode === 'drop') {
      st.x += st.vx * dt;
      st.y += st.vy * dt;
      st.vx *= Math.exp(-dt * 2.2);
      st.vy *= Math.exp(-dt * 2.2);
      if (st.lift <= 0.001 && Math.abs(st.liftV) < 0.01 && Math.hypot(st.vx, st.vy) < 15) {
        st.vx = st.vy = 0;
        st.mode = 'react';
        st.until = now + 500;
      }
    }
  }

  // Walk along the heading. Hoppers move mostly while in the air; waddlers step with distance.
  if (st.mode !== 'drag' && st.spd > 0.1) {
    let f = 1;
    if (pet.gait === 'hop') f = 0.15 + 2.4 * Math.max(0, Math.sin(st.phase));
    st.x += Math.cos(st.heading) * st.spd * f * dt;
    st.y += Math.sin(st.heading) * st.spd * f * dt;
  }
  st.x = clamp(st.x, b.x0 - 40, b.x1 + 40);
  st.y = clamp(st.y, b.y0 - 60, b.y1 + 10);
  // Toss bounces off the edges.
  if (st.mode === 'toss') {
    if (st.x <= b.x0 - 40 || st.x >= b.x1 + 40) st.vx = -st.vx * 0.5;
    if (st.y <= b.y0 - 60 || st.y >= b.y1 + 10) st.vy = -st.vy * 0.5;
  }

  st.walk += ((moving ? 1 : 0) - st.walk) * Math.min(1, dt * 4);
  if (pet.gait === 'hop') {
    if (moving || Math.sin(st.phase) > 0.02) st.phase += dt * 5.6 * (0.7 + 0.3 * Math.min(1.5, st.spd / BASE_SPEED));
  } else {
    st.phase += (st.spd * dt) / 15 * Math.PI; // one step per ~15px
  }

  // Face where it's walking (towards you when walking down the screen); turn to you when idle.
  if (st.spd > 6 && st.mode !== 'drag') st.yawTarget = Math.atan2(Math.cos(st.heading), Math.sin(st.heading));
  else if (st.spd < 3 && st.mode !== 'react') st.yawTarget = wrapAngle(st.yawTarget) * Math.exp(-dt * 1.2);
  st.yaw = wrapAngle(st.yaw + wrapAngle(st.yawTarget - st.yaw) * Math.min(1, dt * 4));

  // Gravity for drops, tosses and spawns.
  if (st.mode !== 'drag' && (st.lift > 0 || st.liftV > 0)) {
    st.liftV -= 9.8 * dt;
    st.lift += st.liftV * dt;
    if (st.lift <= 0) {
      if (st.liftV < -2) {
        squashImpulse(0.78);
        sound('boing');
      }
      st.lift = 0;
      st.liftV = 0;
    }
  }

  // Squash spring (critically damped-ish: no wobbling face).
  st.sqV += (-150 * (st.sq - 1) - 20 * st.sqV) * dt;
  st.sq += st.sqV * dt;

  // Blink.
  if (now > st.blinkAt) {
    st.blinkT = now;
    st.blinkAt = now + rand(2200, 5500) * (Math.random() < 0.2 ? 0.15 : 1);
  }

  // Petting: hover still on the pet for a moment.
  if (st.hoverSince && now - st.hoverSince > 700 && now - st.pettedAt > 2600 && st.mode !== 'drag' && st.mode !== 'sleep') {
    st.pettedAt = now;
    hearts(4);
    say(pick(['嘿嘿', '好舒服~', '再摸摸', '♡', '呼噜呼噜']));
    sound('happy');
    addMood(2);
  }

  // Occasional chatter while strolling.
  if (cfg().chatty && st.mode === 'stroll' && now - st.lastChat > 45000 && Math.random() < dt * 0.05) {
    st.lastChat = now;
    say(pick(KINDS[pet.kind].lines), { auto: true });
  }

  updateBall(dt);

  // Remember where it is.
  if (now - st.savedAt > 3000 && st.mode !== 'drag') {
    st.savedAt = now;
    try { localStorage.setItem('planner.petpos', JSON.stringify({ x: Math.round(st.x), y: Math.round(st.y) })); } catch {}
  }
}

/** Reached the current walking goal. */
function arrive_(now) {
  st.spd = 0;
  if (st.mode === 'treat') return eatTreat(now);
  if (st.mode === 'visit') return arriveAtList(now);
  if (st.mode === 'fetch') return pickUpBall(now);
  if (st.mode === 'carry') return dropBall(now);
  if (st.mode === 'follow') return; // stays in follow mode, just stands
  if (st.mode === 'buddy') {
    st.mode = 'sit';
    if (!st.buddySaid) say(pick(['我陪你专注~', '加油!', '一起努力']), { auto: true });
    st.buddySaid = true;
    return;
  }
  idle(now);
}

function wake(now) {
  clearInterval(zTimer);
  idle(now, rand(1500, 3000));
  say(pick(['哈~欠', '醒了', '…嗯?']), { auto: true });
}

function doIdleFidget(now) {
  // A little life while standing: a look around, a stretch, a hop, a wiggle, a nod in focus mode.
  if (st.mode === 'sit') {
    if (Math.random() < 0.4) { start('nod'); say(pick(['加油!', '专注~', '你可以的']), { auto: true }); }
    return;
  }
  const f = pick(['look', 'look', 'stretch', 'hop', 'wiggle']);
  if (f === 'hop') start('hop1');
  else if (f === 'stretch') start('stretch');
  else if (f === 'wiggle') start('wiggle');
  else st.idleLook = rand(0, 10);
}

function arriveAtList(now) {
  idle(now, rand(4000, 7000));
  const l = lists(store.state).find((x) => x.id === st.visit);
  st.visit = null;
  if (!l) return;
  st.yawTarget = Math.PI; // turn round to "read" the list
  setTimeout(() => (st.yawTarget = 0), 1600);
  const open = l.items.filter((i) => !i.done);
  const overdue = open.filter((i) => i.due && Date.parse(i.due) < Date.now());
  const soon = open.filter((i) => i.due && Date.parse(i.due) >= Date.now()).sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  const short = (t) => (t.length > 14 ? t.slice(0, 13) + '…' : t);
  let line;
  if (overdue.length) line = `「${short(overdue[0].text)}」过期啦!😱`;
  else if (soon.length && Math.random() < 0.7) line = `「${short(soon[0].text)}」${fmtDue(soon[0].due, soon[0].hasTime !== false).label}到期哦`;
  else if (!open.length && l.items.length) line = `${short(l.title)}全搞定!奖励我吗?`;
  else if (open.length) line = `${short(l.title)}还有${open.length}件事~`;
  else line = `${short(l.title)}空空的`;
  setTimeout(() => say(line, { long: true, auto: true }), 900);
}

// ---------- Reactions ----------
// Each reaction: dur (ms), optional start(), and pose(k 0..1, e seconds, pose) adding offsets.

const REACT = {
  jump: {
    dur: 1000,
    start() { squashImpulse(0.82); sound('boing'); },
    pose(k, e, p) {
      const air = clamp((k - 0.15) / 0.65, 0, 1);
      p.lift += Math.sin(Math.PI * air) * 0.9;
      p.yawAdd += Math.PI * 2 * easeIO(air);
      p.armLz -= 1.2 * Math.sin(Math.PI * air);
      p.armRz += 1.2 * Math.sin(Math.PI * air);
      p.eyesWide = 1 + 0.15 * Math.sin(Math.PI * air);
      if (k > 0.8 && !this.landed) { this.landed = true; squashImpulse(0.8); }
    },
  },
  spin: {
    dur: 1100,
    start() { sound('chirp'); },
    pose(k, e, p) { p.yawAdd += Math.PI * 2 * easeIO(k); p.lift += Math.sin(Math.PI * k) * 0.2; },
  },
  wave: {
    dur: 1800,
    start() { say(pick(['hi~', '你好呀', '👋'])); },
    pose(k, e, p) {
      const up = Math.sin(Math.PI * Math.min(1, k * 1.4));
      p.faceCam = 1;
      if (pet.armR) p.armRz += 2.5 * clamp(up * 1.5, 0, 1) + Math.sin(e * 10) * 0.3 * up;
      else p.roll += Math.sin(e * 7) * 0.12 * up;
      p.headRoll += 0.15 * up;
      p.eyes = 0.6;
    },
  },
  curious: {
    dur: 2200,
    start() { say(pick(['?', '嗯?', '你在干嘛'])); },
    pose(k, e, p) { const u = Math.sin(Math.PI * k); p.faceCam = 1; p.headRoll += 0.32 * u; p.eyesWide = 1 + 0.25 * u; p.lean += 0.06 * u; },
  },
  hearts: {
    dur: 1800,
    start() { hearts(7); sound('happy'); },
    pose(k, e, p) { p.eyes = 0.25; p.roll += Math.sin(e * 5) * 0.08; p.faceCam = 1; },
  },
  dance: {
    dur: 2600,
    start() { sound('happy'); notes(); say(pick(['🎶', '扭一扭', '跳舞!'])); },
    pose(k, e, p) {
      p.lift += Math.abs(Math.sin(e * 6)) * 0.18;
      p.roll += Math.sin(e * 6) * 0.18;
      p.yawAdd += Math.sin(e * 3) * 0.6;
      p.armLz -= 1.6 + Math.sin(e * 6) * 0.5;
      p.armRz += 1.6 + Math.sin(e * 6 + 1) * 0.5;
      p.eyes = 0.35;
      p.mouth = Math.sin(e * 6) > 0;
    },
  },
  dizzy: {
    dur: 2400,
    start() { stars(); say('晕…'); },
    pose(k, e, p) {
      const u = 1 - k * 0.5;
      p.headRoll += Math.sin(e * 6) * 0.25 * u;
      p.roll += Math.sin(e * 4.5) * 0.12 * u;
      p.lookX = Math.cos(e * 10) * 0.45;
      p.lookY = Math.sin(e * 10) * 0.45;
    },
  },
  hop1: {
    dur: 600,
    pose(k, e, p) { p.lift += Math.sin(Math.PI * k) * 0.28; if (k > 0.85 && !this.l) { this.l = 1; squashImpulse(0.88); } },
  },
  stretch: {
    dur: 1800,
    start() { say(pick(['哈~欠', '伸懒腰']), { auto: true }); },
    pose(k, e, p) { const u = Math.sin(Math.PI * k); p.sqY = 1 + 0.1 * u; p.armLz -= 2.2 * u; p.armRz += 2.2 * u; p.eyes = 1 - 0.85 * u; p.mouth = u > 0.5; p.headPitch -= 0.3 * u; },
  },
  wiggle: {
    dur: 1200,
    pose(k, e, p) { p.roll += Math.sin(e * 11) * 0.06 * (1 - k); p.tailY += Math.sin(e * 16) * 0.6; },
  },
  chomp: {
    // Eating a task or treat.
    dur: 1400,
    start() { sound('pop'); },
    pose(k, e, p) { p.faceCam = 1; p.mouth = Math.sin(e * 14) > 0; p.sqY *= 1 + Math.sin(e * 14) * 0.035; p.eyes = 0.4; },
  },

  // ---- signatures ----
  tongue: {
    // 奶龙 meme: tongue out, eyes rolled up, head tilted, swaying.
    dur: 2600,
    start() { say(pick(['略略略~', '😛', '嘻嘻'])); sound('pop'); },
    pose(k, e, p) {
      const u = clamp(k * 5, 0, 1) * clamp((1 - k) * 6, 0, 1);
      p.faceCam = 1;
      p.tongue = u;
      p.mouth = u > 0.1;
      p.lookY = -0.55 * u;
      p.lookX = -0.25 * u;
      p.headRoll += 0.3 * u;
      p.headPitch -= 0.12 * u;
      p.roll += Math.sin(e * 4) * 0.07 * u;
    },
  },
  bellyrub: {
    // 奶蛙: hands on the round belly, rubbing, very content.
    dur: 2800,
    start() { say(pick(['肚肚~', '……舒服', '吃饱了'])); },
    pose(k, e, p) {
      const u = clamp(k * 4, 0, 1) * clamp((1 - k) * 4, 0, 1);
      p.faceCam = 1;
      p.armLx -= 0.75 * u; p.armRx -= 0.75 * u;
      p.armLz += (0.55 + Math.sin(e * 5) * 0.12) * u;
      p.armRz -= (0.55 + Math.sin(e * 5 + 1.5) * 0.12) * u;
      p.eyes = 1 - 0.55 * u;
      p.roll += Math.sin(e * 3) * 0.04 * u;
    },
  },
  sideeye: {
    // 奶蛙 meme: body turned away, eyes slowly sliding over to stare at you.
    dur: 3000,
    start() { setTimeout(() => say('👀'), 900); },
    pose(k, e, p) {
      const u = clamp(k * 3, 0, 1) * clamp((1 - k) * 4, 0, 1);
      p.yawOverride = 0.75 * u;
      p.lookX = -0.5 * clamp(k * 2 - 0.3, 0, 1) * u;
      p.eyes = 1 - 0.4 * u;
      p.headYaw -= 0.15 * u;
    },
  },
  wobble: {
    // 奶蛋: rocks side to side like a weeble.
    dur: 2200,
    start() { say(pick(['咕?', '晃~', '不倒蛋'])); },
    pose(k, e, p) { p.roll += Math.sin(e * 7) * 0.38 * (1 - k); p.lift += Math.abs(Math.sin(e * 7)) * 0.03; },
  },
  flip: {
    // 奶蛋: a full somersault.
    dur: 1200,
    start() { squashImpulse(0.78); sound('boing'); },
    pose(k, e, p) {
      const air = clamp((k - 0.12) / 0.7, 0, 1);
      p.lift += Math.sin(Math.PI * air) * 1.2;
      p.flip = Math.PI * 2 * easeIO(air);
      if (k > 0.85 && !this.landed) { this.landed = true; squashImpulse(0.75); say('咕!'); }
    },
  },
  laugh: {
    // 美团老鼠 meme: eyes squeezed shut, mouth wide, body bouncing with laughter.
    dur: 2800,
    start() { say(pick(['你的外卖我偷吃了😋', '哈哈哈哈哈', '嘿嘿嘿嘿']), { long: true }); sound('happy'); haha(); },
    pose(k, e, p) {
      const u = clamp(k * 6, 0, 1) * clamp((1 - k) * 5, 0, 1);
      p.faceCam = 1;
      p.eyes = 1 - 0.9 * u;
      p.mouth = u > 0.2;
      p.headPitch -= 0.25 * u;
      p.lift += Math.abs(Math.sin(e * 9)) * 0.05 * u; // chuckle bounce instead of a fast shake
      p.roll += Math.sin(e * 9) * 0.04 * u;
      p.earL += Math.sin(e * 9) * 0.25 * u;
      p.earR += Math.sin(e * 9 + 1) * 0.25 * u;
      p.armLx += Math.sin(e * 9) * 0.2 * u;
      p.armRx += Math.sin(e * 9) * 0.2 * u;
    },
  },
  headshake: {
    // "Nope": shakes side to side.
    dur: 1600,
    start() { say(pick(['不要~', '略略略', '才不'])); },
    pose(k, e, p) { const u = Math.sin(Math.PI * k); p.faceCam = 1; p.headYaw += Math.sin(e * 10) * 0.5 * u; p.roll += Math.sin(e * 10) * 0.04 * u; },
  },
  nod: {
    dur: 1500,
    start() { say(pick(['嗯嗯!', '对对对', '好的']), { auto: true }); },
    pose(k, e, p) { const u = Math.sin(Math.PI * k); p.faceCam = 1; p.headPitch += Math.max(0, Math.sin(e * 8)) * 0.4 * u; },
  },
  bellybounce: {
    // 奶蛙: the round belly jiggles up and down.
    dur: 2200,
    start() { say(pick(['肚肚~', '……舒服', '吃饱了'])); },
    pose(k, e, p) { const u = Math.sin(Math.PI * k); p.faceCam = 1; p.sqY *= 1 + Math.sin(e * 11) * 0.045 * u; p.lift += Math.abs(Math.sin(e * 5.5)) * 0.05 * u; p.headPitch -= 0.1 * u; },
  },
  hops: {
    // 美团老鼠: kangaroo hops across the board, delivery style.
    dur: 2000,
    start() {
      const a = Math.random() < 0.5 ? 1 : -1;
      this.move = { x: a * 70, y: rand(-15, 15) };
      setTimeout(() => say(pick(['外卖到了!', '准时达~', '跑单中'])), 1500);
    },
    pose(k, e, p) {
      p.lift += Math.abs(Math.sin(e * Math.PI * 1.5)) * 0.5;
      p.earL += Math.abs(Math.sin(e * Math.PI * 1.5)) * 0.4;
      p.earR += Math.abs(Math.sin(e * Math.PI * 1.5)) * 0.4;
      p.pitch -= 0.12;
    },
  },
};

function start(name) {
  const r = Object.create(REACT[name]);
  r.name = name;
  r.t0 = performance.now();
  st.reaction = r;
  st.mode = 'react';
  st.until = r.t0 + r.dur;
  st.spd = 0;
  r.start?.call(r);
  if (r.move) st.yawTarget = Math.atan2(r.move.x, r.move.y); // hops travel: face that way
}

// Generated models have no separate eyes/arms/tongue: their signatures use whole-body moves.
const GLB_SIGNATURE = {
  nailong: ['headshake', 'dance', 'nod'],
  naiwa: ['sideeye', 'bellybounce', 'bellybounce'],
  naidan: ['wobble', 'flip', 'wobble'],
  laoshu: ['laugh', 'laugh', 'hops'],
};
const signatures = () => (pet.glb ? GLB_SIGNATURE[pet.kind] : KINDS[pet.kind].signature);

let lastReaction = '';
function react() {
  const generic = pet.glb ? ['jump', 'spin', 'curious', 'hearts', 'dance', 'dizzy'] : ['jump', 'spin', 'wave', 'curious', 'hearts', 'dance', 'dizzy'];
  let name;
  do name = Math.random() < 0.5 ? pick(signatures()) : pick(generic);
  while (name === lastReaction);
  lastReaction = name;
  if (st.mode === 'sleep') {
    clearInterval(zTimer);
    say('!');
    name = 'jump';
  }
  start(name);
  addMood(1);
}

// ---------- Pose ----------

function basePose() {
  return {
    lift: 0, yawAdd: 0, yawOverride: null, faceCam: 0, flip: 0, roll: 0, pitch: 0, lean: 0, sqY: 1,
    headYaw: 0, headPitch: 0, headRoll: 0,
    armLx: 0, armLz: 0, armRx: 0, armRz: 0, legLx: 0, legRx: 0,
    tailX: 0, tailY: 0, earL: 0, earR: 0,
    eyes: 1, eyesWide: 1, lookX: 0, lookY: 0, mouth: false, tongue: 0,
  };
}

function computePose(now, t, dt) {
  const p = basePose();
  const w = st.walk;
  const s = Math.sin(st.phase);

  // Gait
  if (pet.gait === 'waddle') {
    p.legLx += s * 0.5 * w;
    p.legRx -= s * 0.5 * w;
    p.armLx -= s * 0.4 * w;
    p.armRx += s * 0.4 * w;
    p.roll += s * 0.055 * w;
    p.lift += Math.abs(s) * 0.035 * w;
    p.tailY += s * 0.35 * w;
    p.pitch -= 0.04 * w; // lean into the walk
  } else {
    const up = Math.max(0, s);
    p.lift += up * 0.22;
    p.pitch -= (s > 0 ? 0.06 : 0) * w;
    p.earL += up * 0.3;
    p.earR += up * 0.3;
    p.tailX += up * 0.3;
    if (st.lastS > 0 && s <= 0) squashImpulse(0.93);
    st.lastS = s;
  }

  // Breathing and idle life
  p.sqY *= 1 + Math.sin(t * 2.1) * 0.01;
  p.tailY += Math.sin(t * 1.5) * 0.22;
  p.earL += Math.sin(t * 2.1) * 0.03;
  p.earR += Math.sin(t * 2.1 + 1) * 0.03;

  // Where to look: the cursor (with a dead zone while touching it, so it doesn't flip about),
  // the ball during fetch, or around the room when idle.
  if (st.mode !== 'sleep') {
    const cx = st.x;
    const cy = st.y - 80 * size();
    let lx = 0;
    let ly = 0;
    const lookAt = (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      lx = clamp(dx / 300, -1, 1);
      ly = clamp(dy / 350, -1, 1);
    };
    if (ball && ball.state !== 'carried' && (st.mode === 'wait' || st.mode === 'fetch')) lookAt(ball.x, ball.y - ball.z);
    else if (mouse.on && Math.hypot(mouse.x - cx, mouse.y - cy) < 420) {
      if (Math.hypot(mouse.x - cx, mouse.y - cy) < 75) ly = -0.2; // touching: look up at you
      else lookAt(mouse.x, mouse.y);
    } else if (st.mode === 'idle' || now < st.pauseUntil) {
      lx = Math.sin(t * 0.4 + st.idleLook) * 0.7;
      ly = Math.sin(t * 0.27 + st.idleLook) * 0.15;
    }
    const k = 1 - Math.exp(-dt * 5);
    st.look.x += (lx - st.look.x) * k;
    st.look.y += (ly - st.look.y) * k;
    if (Math.abs(wrapAngle(st.yaw)) < 1.3) {
      p.headYaw += st.look.x * 0.75;
      p.headPitch += st.look.y * 0.25;
      p.lookX = st.look.x * 0.32;
      p.lookY = st.look.y * 0.3;
    }
  }

  // Being petted: eyes close happily.
  if (st.hoverSince && now - st.hoverSince > 350 && st.mode !== 'drag') {
    p.eyes = Math.min(p.eyes, 0.35);
    p.roll += Math.sin(t * 2.5) * 0.03;
  }

  // Blink / sleep
  const sinceBlink = now - st.blinkT;
  if (sinceBlink < 170) p.eyes = Math.min(p.eyes, Math.abs(sinceBlink - 85) / 85);
  if (st.mode === 'sleep') {
    p.eyes = 0.06;
    p.headPitch += 0.25;
    p.headRoll += 0.12;
    p.sqY *= 1 + Math.sin(t * 1.3) * 0.025;
  }

  // Held: legs dangle, it leans with the pointer.
  if (st.mode === 'drag') {
    p.legLx += Math.sin(t * 5) * 0.4;
    p.legRx -= Math.sin(t * 5) * 0.4;
    p.armLz -= 0.9 + Math.sin(t * 4.5) * 0.15;
    p.armRz += 0.9 + Math.sin(t * 4.5) * 0.15;
    p.eyesWide = 1.15;
    p.mouth = true;
    p.roll += st.dragTilt;
    p.faceCam = 1;
  }

  // A task being dragged over it: eager.
  if (dropHover) {
    p.faceCam = 1;
    p.eyesWide = 1.25;
    p.mouth = true;
    p.lift += Math.abs(Math.sin(t * 7)) * 0.06;
  }

  if (st.reaction) {
    const r = st.reaction;
    const e = (now - r.t0) / 1000;
    const k = clamp((now - r.t0) / r.dur, 0, 1);
    r.pose.call(r, k, e, p);
  }
  return p;
}

function setRot(k, x, y, z) {
  const o = pet[k];
  if (!o) return;
  const r = pet.rest.get(k).rot;
  o.rotation.set(r.x + x, r.y + y, r.z + z);
}

function applyPose(p) {
  const P = pet;
  let yaw = st.yaw;
  if (p.faceCam) yaw = yaw * (1 - p.faceCam);
  if (p.yawOverride !== null) yaw = p.yawOverride;
  // Generated models are one rigid mesh: "looking" turns and tips the whole pet a little.
  const look = P.glb ? { yaw: clamp(p.headYaw, -0.9, 0.9) * 0.4, pitch: p.headPitch * 0.12, roll: p.headRoll * 0.5 } : { yaw: 0, pitch: 0, roll: 0 };
  P.root.position.set(0, st.lift + p.lift, 0);
  P.root.rotation.set(0, yaw + p.yawAdd + look.yaw, 0);
  // Somersault rotates around the body's middle.
  const mid = P.height * P.scale * 0.5;
  P.squash.position.set(0, p.flip ? mid : 0, 0);
  P.body.position.set(0, p.flip ? -mid : 0, 0);
  P.squash.rotation.set(p.flip, 0, 0);
  P.body.rotation.set(p.pitch + p.lean + look.pitch, 0, p.roll + look.roll);
  const sy = st.sq * p.sqY;
  const sx = 1 / Math.sqrt(Math.max(0.3, sy));
  P.squash.scale.set(sx, sy, sx);
  setRot('head', p.headPitch, p.headYaw * (P.noNeck ? 0.4 : 1), p.headRoll);
  setRot('armL', p.armLx, 0, p.armLz);
  setRot('armR', p.armRx, 0, p.armRz);
  setRot('legL', p.legLx, 0, 0);
  setRot('legR', p.legRx, 0, 0);
  setRot('tail', p.tailX, p.tailY, 0);
  setRot('earL', 0, 0, p.earL);
  setRot('earR', 0, 0, -p.earR);
  for (const e of P.eyes) {
    e.scale.set(p.eyesWide, Math.max(0.06, p.eyes) * p.eyesWide, p.eyesWide);
    e.userData.look.rotation.set(p.lookY, p.lookX, 0);
  }
  P.mouthOpen.visible = !!p.mouth;
  P.mouthClosed.visible = !p.mouth;
  if (P.tongue) {
    const s = Math.max(0.001, p.tongue);
    P.tongue.scale.set(s, s, s * 0.55);
  }
  const lift = st.lift + p.lift;
  shadow.scale.setScalar((pet.kind === 'laoshu' ? 1.15 : 1) * (1 - Math.min(0.5, lift * 0.25)));
  shadow.material.opacity = 1 - Math.min(0.6, lift * 0.35);
}

// ---------- Loop ----------

function frame(now) {
  raf = 0;
  if (!running) return;
  const dt = Math.min(0.05, (now - (lastT || now)) / 1000);
  lastT = now;
  update(dt, now);
  applyPose(computePose(now, now / 1000, dt));
  wrap.style.transform = `translate3d(${(st.x - W / 2).toFixed(1)}px, ${(st.y - H * feetFromTop).toFixed(1)}px, 0) scale(${size()})`;
  wrap.style.zIndex = String(Math.round(st.y));
  renderer.render(scene, camera);
  raf = requestAnimationFrame(frame);
}

function startLoop() {
  running = true;
  lastT = 0;
  if (!raf) raf = requestAnimationFrame(frame);
}
function stopLoop() {
  running = false;
  cancelAnimationFrame(raf);
  raf = 0;
}

// ---------- Overlay effects (bubbles, hearts, z's, stars) ----------

function headPoint() {
  // Screen position of the top of the head inside the canvas.
  const v = new THREE.Vector3(0, (pet.height * pet.scale) + 0.15 + st.lift, 0).project(camera);
  return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
}

/** Speech bubble. `auto` lines (chatter, comments) are skipped in quiet mode. */
function say(text, { long = false, auto = false } = {}) {
  if (!wrap || !pet || (auto && cfg().quiet)) return;
  fxEl.querySelector('.bubble')?.remove();
  const hp = headPoint();
  const b = h('div.bubble', { style: { left: hp.x + 'px', top: hp.y + 'px' } }, text);
  fxEl.append(b);
  fx.play(b, [{ opacity: 0, transform: 'translate(-50%, calc(-100% + 8px)) scale(.4)' }, { opacity: 1, transform: 'translate(-50%, -100%) scale(1)' }], fx.SPRING_BOUNCY);
  setTimeout(() => {
    const a = fx.play(b, [{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%, calc(-100% - 10px)) scale(.9)' }], { duration: 260, fill: 'forwards' });
    a ? (a.onfinish = () => b.remove()) : b.remove();
  }, long ? 3200 : 1900);
}

function floaty(text, { delay = 0, color, size: sz = 16, dx = 0, dy = -70, font } = {}) {
  if (!pet) return;
  const hp = headPoint();
  const s = h('span.floaty', { style: { left: hp.x + 'px', top: hp.y + 12 + 'px', color, fontSize: sz + 'px', ...(font ? { font } : {}) } }, text);
  fxEl.append(s);
  const a = fx.play(s, [
    { opacity: 0, transform: 'translate(-50%, 0) scale(.4)' },
    { opacity: 1, transform: `translate(calc(-50% + ${dx * 0.4}px), ${dy * 0.35}px) scale(1)`, offset: 0.25 },
    { opacity: 0, transform: `translate(calc(-50% + ${dx}px), ${dy}px) scale(.8) rotate(${dx * 0.3}deg)` },
  ], { duration: 1400, delay, easing: 'ease-out', fill: 'backwards' });
  a ? (a.onfinish = () => s.remove()) : s.remove();
}

const hearts = (n) => { for (let i = 0; i < n; i++) floaty(pick(['♥', '♥', '❤', '💕']), { delay: i * 120, color: pick(['#ff6b8b', '#ff8fab', '#ff4d6d']), size: rand(14, 22), dx: rand(-50, 50) }); };
const notes = () => { for (let i = 0; i < 5; i++) floaty(pick(['♪', '♫', '♬']), { delay: i * 300, color: 'var(--accent)', size: rand(16, 22), dx: rand(-60, 60) }); };
const haha = () => { for (let i = 0; i < 5; i++) floaty(pick(['哈', '哈哈', '哈哈哈']), { delay: i * 300, color: '#f2b81c', size: rand(15, 22), dx: rand(-55, 55), font: '700 1em var(--font-display)' }); };
function stars() {
  const hp = headPoint();
  const s = h('div.stars', { style: { left: hp.x + 'px', top: hp.y + 14 + 'px' } }, h('span', '★'), h('span', '✦'), h('span', '★'));
  fxEl.append(s);
  setTimeout(() => s.remove(), 2400);
}
let zTimer = 0;
function zzz() {
  clearInterval(zTimer);
  const once = () => floaty('z', { color: 'var(--fg-muted)', size: rand(13, 20), dx: rand(10, 34), dy: -50, font: '600 1em var(--font-display)' });
  once();
  zTimer = setInterval(() => (st.mode === 'sleep' ? once() : clearInterval(zTimer)), 900);
}

// ---------- Input ----------

function hit(clientX, clientY) {
  if (!running || !pet) return false;
  const r = canvas.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObject(pet.root, true).length > 0;
}

function boardPoint(e) {
  const r = board.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

board.addEventListener('pointerdown', (e) => {
  st.lastActive = performance.now();
  if (e.button !== 0 || !hit(e.clientX, e.clientY)) return;
  e.stopPropagation();
  e.preventDefault();
  closeFloats();
  const p0 = boardPoint(e);
  const off = { x: st.x - p0.x, y: st.y - p0.y };
  let dragging = false;
  const samples = [];
  const move = (ev) => {
    const p = boardPoint(ev);
    if (!dragging && Math.hypot(p.x - p0.x, p.y - p0.y) > 6) {
      dragging = true;
      st.mode = 'drag';
      st.reaction = null;
      clearInterval(zTimer);
      squashImpulse(1.1);
      board.classList.add('pet-grab');
      say(pick(['诶诶诶?!', '放我下来', '飞~', '!!']));
    }
    if (!dragging) return;
    st.drag = { x: p.x + off.x, y: p.y + off.y + 24 };
    samples.push({ x: p.x, y: p.y, t: performance.now() });
    if (samples.length > 6) samples.shift();
    if (samples.length > 1) {
      const a = samples[0];
      const z = samples[samples.length - 1];
      st.dragVx = ((z.x - a.x) / Math.max(1, z.t - a.t)) * 1000;
    }
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    board.classList.remove('pet-grab');
    if (!dragging) return react();
    // Let go: falls, and keeps a bit of the hand's speed if it was flicked.
    const a = samples[0];
    const z = samples[samples.length - 1];
    const dt = a && z && z.t > a.t ? (z.t - a.t) / 1000 : 1;
    let vx = a ? (z.x - a.x) / dt : 0;
    let vy = a ? (z.y - a.y) / dt : 0;
    const sp = Math.hypot(vx, vy);
    if (sp > 900) { vx *= 900 / sp; vy *= 900 / sp; }
    const flicked = sp > 250;
    st.vx = flicked ? vx * 0.8 : 0;
    st.vy = flicked ? vy * 0.8 : 0;
    st.liftV = flicked ? 2.2 : 0;
    st.mode = flicked ? 'toss' : 'drop';
    if (flicked) say(pick(['哇~~', '飞咯', '啊啊啊']));
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}, true);

board.addEventListener('pointermove', (e) => {
  const p = boardPoint(e);
  mouse = { x: p.x, y: p.y, on: true };
  st.lastActive = performance.now();
  if (!running) return;
  const over = hit(e.clientX, e.clientY);
  board.classList.toggle('pet-hover', over);
  if (over && !st.hoverSince) st.hoverSince = performance.now();
  if (!over) st.hoverSince = 0;
  // Working on a list the pet is standing in front of: fade it so the list stays readable.
  const r = canvas.getBoundingClientRect();
  const inside = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
  wrap.classList.toggle('ghosted', inside && !over && !!e.target.closest?.('.card'));
});
board.addEventListener('pointerleave', () => {
  mouse.on = false;
  st.hoverSince = 0;
  board.classList.remove('pet-hover');
  wrap?.classList.remove('ghosted');
});
board.addEventListener('dblclick', (e) => {
  if (!hit(e.clientX, e.clientY)) return;
  e.stopPropagation();
  start(pick(signatures()));
}, true);
board.addEventListener('contextmenu', (e) => {
  if (!hit(e.clientX, e.clientY)) return;
  e.preventDefault();
  e.stopPropagation();
  openPetMenu({ x: e.clientX, y: e.clientY });
}, true);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopLoop();
  else if (cfg().on && pet) startLoop();
});

// Keyboard: P = come here, Shift+P = follow me, Esc stops following.
addEventListener('keydown', (e) => {
  if (!running || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector('dialog[open]')) return;
  if (e.key === 'p') callOver();
  else if (e.key === 'P') toggleFollow();
  else if (e.key === 'Escape' && st.follow) toggleFollow(false);
});

// ---------- Drop a task on the pet: it eats it (marks it done) ----------

let dropHover = false;
board.addEventListener('dragover', (e) => {
  if (!running || !e.dataTransfer?.types.includes('application/x-planner-item')) return;
  const over = hit(e.clientX, e.clientY);
  if (over && !dropHover && st.mode !== 'sleep') say(pick(['给我给我!', '好吃的?', '啊——']));
  dropHover = over;
  wrap.classList.toggle('drop-target', over);
  if (!over) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
}, true);
board.addEventListener('dragleave', (e) => {
  if (!board.contains(e.relatedTarget)) {
    dropHover = false;
    wrap?.classList.remove('drop-target');
  }
});
board.addEventListener('drop', (e) => {
  if (!dropHover) return;
  dropHover = false;
  wrap.classList.remove('drop-target');
  if (!hit(e.clientX, e.clientY)) return;
  e.preventDefault();
  e.stopPropagation();
  eatTask(e.dataTransfer.getData('application/x-planner-item'));
}, true);
addEventListener('dragend', () => {
  dropHover = false;
  wrap?.classList.remove('drop-target');
});

function eatTask(id) {
  const f = findItem(store.state, id);
  if (!f) return;
  const short = f.item.text.length > 12 ? f.item.text.slice(0, 11) + '…' : f.item.text;
  if (f.item.done) {
    start('headshake');
    say('这个已经做完啦');
    return;
  }
  start('chomp'); // first, so the usual "task done" cheer sees it busy and doesn't cut in
  toggleItem(id, null);
  setTimeout(() => {
    hearts(5);
    say(`吃掉「${short}」✓ 好吃!`, { long: true });
  }, 600);
  addMood(5);
}

// ---------- Planner events ----------

document.addEventListener('planner:done', () => {
  addMood(3);
  if (!cfg().cheer || !running || st.mode === 'drag' || st.mode === 'react') return;
  setTimeout(() => {
    start(Math.random() < 0.5 ? 'jump' : 'hearts');
    say(pick(['好耶!', '又搞定一个!', '厉害!', '👏']));
  }, 250);
});
document.addEventListener('planner:celebrate', () => {
  if (!cfg().cheer || !running || st.mode === 'drag') return;
  setTimeout(() => start('dance'), 300);
});

// ---------- Focus buddy ----------
// While the focus timer runs, the pet walks over and sits near it; it cheers when a break starts.

let lastTimerState = 'off';
setInterval(() => {
  if (!running || !pet) return;
  const t = document.getElementById('timer');
  const state = !t || t.hidden ? 'off' : t.classList.contains('break') ? 'break' : 'focus';
  if (state === lastTimerState) return;
  const was = lastTimerState;
  lastTimerState = state;
  if (state === 'focus') {
    st.buddy = true;
    if (['drag', 'fetch', 'carry', 'treat', 'toss'].includes(st.mode) || st.follow) return;
    const b = bounds();
    st.buddySpot = { x: clamp(board.clientWidth / 2 + 200, b.x0, b.x1), y: b.y1 - 4 };
    st.buddySaid = false;
    goTo(st.buddySpot.x, st.buddySpot.y, 'buddy');
  } else {
    st.buddy = false;
    if (st.mode === 'sit' || st.mode === 'buddy') {
      if (state === 'break' && was === 'focus') {
        start('dance');
        say('休息一下~ 你好棒', { long: true });
      } else idle(performance.now(), 2000);
    }
  }
}, 1000);

// ---------- Treats ----------

function giveTreat() {
  if (!running) return toast('Turn the pet on first');
  treat?.el.remove();
  const b = bounds();
  const p = freeSpot(120, 320);
  const t = { x: clamp(p.x, b.x0 + 40, b.x1 - 40), y: clamp(p.y, b.y0 + 40, b.y1 - 20) };
  t.el = h('div.treat', pick(['🍤', '🍗', '🍜', '🥟', '🍰', '🍟']));
  t.el.style.left = t.x + 'px';
  t.el.style.top = t.y + 'px';
  layer.append(t.el);
  fx.play(t.el, [{ opacity: 0, transform: 'translate(-50%, -260px) rotate(-90deg)' }, { opacity: 1, transform: 'translate(-50%, -100%)' }], fx.SPRING_BOUNCY);
  treat = t;
  clearInterval(zTimer);
  goTo(t.x, t.y, 'treat');
  say(pick(['!!!', '吃的!', '冲!', '是外卖吗']));
}

function eatTreat(now) {
  const t = treat;
  treat = null;
  if (t) {
    const r = t.el.getBoundingClientRect();
    fx.confetti(r.left + r.width / 2, r.top + r.height / 2, { count: 14, power: 3.5, size: 4, colors: ['#ffd166', '#ffffff', '#ff9e7a'] });
    t.el.remove();
  }
  start('chomp');
  setTimeout(() => { hearts(5); say(pick(['好吃!', '嗷呜', '😋', '还要!'])); }, 500);
  st.until = now + 1600;
  addMood(8);
}

// ---------- Fetch ----------
// A ball you drag and throw; the pet runs after it, carries it back to you and waits for more.

function startFetch() {
  if (!running) return toast('Turn the pet on first');
  endFetch(true);
  const b = bounds();
  ball = { x: clamp(st.x + 40, b.x0, b.x1), y: clamp(st.y + 20, b.y0, b.y1), z: 0, vx: 0, vy: 0, vz: 0, state: 'free' };
  ball.shadowEl = h('div.ball-shadow');
  ball.el = h('div.ball', { title: 'Drag and let go to throw' });
  layer.append(ball.shadowEl, ball.el);
  ball.el.addEventListener('pointerdown', grabBall);
  fx.play(ball.el, [{ transform: `translate(${ball.x - 11}px, ${ball.y - 200}px)` }, { transform: `translate(${ball.x - 11}px, ${ball.y - 22}px)` }], fx.SPRING_BOUNCY);
  st.reaction = null;
  st.follow = false;
  st.mode = 'wait';
  st.until = performance.now() + 25000;
  say('扔给我!');
  toast('Drag the ball and let go to throw it');
}

function grabBall(e) {
  if (!ball || ball.state === 'carried') return;
  e.preventDefault();
  e.stopPropagation();
  ball.state = 'held';
  ball.el.classList.add('held');
  const samples = [];
  const move = (ev) => {
    const p = boardPoint(ev);
    ball.x = p.x;
    ball.y = p.y + 30;
    ball.z = 30;
    samples.push({ x: p.x, y: p.y, t: performance.now() });
    if (samples.length > 6) samples.shift();
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    ball.el.classList.remove('held');
    const a = samples[0];
    const z = samples[samples.length - 1];
    const dt = a && z && z.t > a.t ? (z.t - a.t) / 1000 : 1;
    let vx = a ? (z.x - a.x) / dt : 0;
    let vy = a ? (z.y - a.y) / dt : 0;
    const sp = Math.hypot(vx, vy);
    if (sp > 1500) { vx *= 1500 / sp; vy *= 1500 / sp; }
    Object.assign(ball, { vx, vy, vz: 220 + Math.min(sp, 1500) * 0.25, state: 'free' });
    if (st.mode === 'wait' || st.mode === 'idle' || st.mode === 'sit') {
      st.mode = 'wait';
      st.until = performance.now() + 25000;
      if (sp > 150) say(pick(['!!', '冲!', '看我的']));
    }
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}

function updateBall(dt) {
  if (!ball) return;
  // The ball stays inside the area the pet can reach.
  const pb = bounds();
  const b = { x0: pb.x0 - 30, y0: pb.y0 - 50, x1: pb.x1 + 30, y1: pb.y1 + 5 };
  if (ball.state === 'free') {
    ball.vz -= 1500 * dt;
    ball.z += ball.vz * dt;
    if (ball.z <= 0) {
      ball.z = 0;
      ball.vz = Math.abs(ball.vz) > 90 ? -ball.vz * 0.5 : 0;
    }
    const drag = ball.z > 0 ? 0.25 : 2.2;
    ball.vx *= Math.exp(-dt * drag);
    ball.vy *= Math.exp(-dt * drag);
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (ball.x < b.x0 || ball.x > b.x1) { ball.x = clamp(ball.x, b.x0, b.x1); ball.vx = -ball.vx * 0.6; }
    if (ball.y < b.y0 || ball.y > b.y1) { ball.y = clamp(ball.y, b.y0, b.y1); ball.vy = -ball.vy * 0.6; }
  } else if (ball.state === 'carried') {
    const dir = Math.cos(st.heading) >= 0 ? 1 : -1;
    ball.x = st.x + dir * 14 * size();
    ball.y = st.y + 2;
    ball.z = 70 * size() + st.lift * 60;
  }
  ball.el.style.transform = `translate(${ball.x - 11}px, ${ball.y - 22 - ball.z}px)`;
  ball.el.style.zIndex = String(Math.round(ball.y) + (ball.state === 'carried' ? 2 : 0));
  ball.shadowEl.style.transform = `translate(${ball.x - 10}px, ${ball.y - 4}px) scale(${1 - Math.min(0.6, ball.z / 200)})`;
  ball.shadowEl.style.opacity = String(1 - Math.min(0.7, ball.z / 160));
}

function pickUpBall(now) {
  if (!ball || ball.z > 14) {
    st.mode = 'fetch'; // still bouncing: keep chasing
    return;
  }
  ball.state = 'carried';
  squashImpulse(0.9);
  sound('pop');
  st.mode = 'carry';
  say(pick(['拿到了!', '嘿嘿', '✓']));
}

function dropBall(now) {
  ball.state = 'free';
  ball.z = 6;
  ball.vz = 60;
  ball.vx = rand(-20, 20);
  ball.vy = 40;
  st.mode = 'wait';
  st.until = now + 25000;
  hearts(3);
  say(pick(['再扔一次!', '还要玩!', '给你~']));
  addMood(4);
}

function endFetch(silent) {
  if (!ball) return;
  const old = ball;
  ball = null;
  old.el.removeEventListener('pointerdown', grabBall);
  const a = fx.play(old.el, [{ opacity: 1 }, { opacity: 0, transform: old.el.style.transform + ' scale(.3)' }], { duration: 300, fill: 'forwards' });
  a ? (a.onfinish = () => old.el.remove()) : old.el.remove();
  old.shadowEl.remove();
  if (!silent && running) {
    say(pick(['不玩了?', '下次再玩~']), { auto: true });
    idle(performance.now());
  }
}

// ---------- Follow / call / stay ----------

function callOver() {
  if (!running) return;
  const b = bounds();
  clearInterval(zTimer);
  const x = mouse.on ? mouse.x : board.clientWidth / 2;
  const y = mouse.on ? mouse.y + 90 : board.clientHeight / 2 + 120;
  goTo(clamp(x, b.x0, b.x1), clamp(y, b.y0, b.y1), 'stroll');
  say(pick(['来啦~', '马上到', '嗯嗯']));
}

function toggleFollow(on = !st.follow) {
  st.follow = on;
  if (on) {
    st.stay = false;
    clearInterval(zTimer);
    st.reaction = null;
    st.mode = 'follow';
    say(pick(['跟着你!', '走吧~', '去哪?']));
    toast('Following your cursor · Esc or Shift+P to stop');
  } else {
    say(pick(['好的~', '我自己玩']));
    idle(performance.now(), 3000);
  }
}

function toggleStay(on = !st.stay) {
  st.stay = on;
  if (on) {
    st.follow = false;
    st.reaction = null;
    idle(performance.now(), 1e9);
    say(pick(['乖乖待着', '不动了', '坐好']));
  } else {
    say(pick(['自由啦!', '去逛逛~']));
    idle(performance.now(), 1000);
  }
}

// ---------- Show / switch ----------

let loadingKind = null;
async function spawn(kind, { from = 'top' } = {}) {
  loadingKind = kind;
  await loadModel(kind);
  loadingKind = null;
  st.reaction = null;
  if (from === 'top') {
    st.lift = 3.2;
    st.liftV = 0;
  }
  st.mode = 'drop';
  st.vx = st.vy = 0;
  st.yaw = st.yawTarget = 0;
  setTimeout(() => say(pick([`我是${petName(kind)}!`, ...KINDS[kind].lines]), { auto: true }), 900);
}

/** Matches the board to the pet settings. */
export function syncPet() {
  const c = cfg();
  updateControl();
  if (!c.on) {
    if (running) {
      poof();
      stopLoop();
      wrap.style.display = 'none';
      endFetch(true);
    }
    return;
  }
  if (!setupGL()) return;
  wrap.style.display = '';
  if (loadingKind === c.kind) return;
  if (!pet) {
    // Back where it was last time, if that's still on the board.
    const b = bounds();
    let pos = null;
    try { pos = JSON.parse(localStorage.getItem('planner.petpos') || 'null'); } catch {}
    st.x = pos ? clamp(pos.x, b.x0, b.x1) : rand(b.x0 + 60, Math.max(b.x0 + 61, b.x1 - 60));
    st.y = pos ? clamp(pos.y, b.y0, b.y1) : rand(b.y0 + 100, Math.max(b.y0 + 101, b.y1 - 40));
    spawn(c.kind).then(startLoop);
    return;
  }
  if (pet.kind !== c.kind) {
    poof();
    spawn(c.kind);
  }
  startLoop();
}

function poof() {
  if (!wrap) return;
  const r = canvas.getBoundingClientRect();
  fx.confetti(r.left + r.width / 2, r.top + r.height * feetFromTop - 60, { count: 22, power: 4.5, size: 5, colors: ['#ffffff', '#ffd43b', '#f6b42a', '#d8ff5a'] });
  fx.ripple(r.left + r.width / 2, r.top + r.height * feetFromTop - 60, '#ffd43b', 160);
}

// ---------- Right-click menu ----------

function openPetMenu(at) {
  const s = size();
  const sizes = h('div.pet-sizes', h('span.faint.small', '大小'),
    [['S', 0.75], ['M', 1], ['L', 1.3]].map(([label, v]) => h(`button${Math.abs(s - v) < 0.01 ? '.on' : ''}`, {
      onclick: () => { setCfg({ size: v }, { quiet: false }); closeFloats(); say(v > 1 ? '变大啦!' : v < 1 ? '变小了~' : '刚刚好'); },
    }, label)));
  menu(at, [
    h('div.pet-menu-head', h('strong', petName()), h('span.faint.small', ` · 心情 ${moodWord(mood())} ${mood()}%`)),
    { label: '🍤 Feed a treat', onclick: giveTreat },
    { label: '🎾 Play fetch', onclick: startFetch },
    { label: st.follow ? '✋ Stop following' : '🐾 Follow me  (Shift+P)', onclick: () => toggleFollow() },
    { label: st.stay ? '🚶 Roam again' : '🪑 Stay here', onclick: () => toggleStay() },
    { label: '💤 Nap', onclick: () => { st.reaction = null; sleep(performance.now()); } },
    { label: '💃 Dance', onclick: () => start('dance') },
    { label: '✨ Signature move', onclick: () => start(pick(signatures())) },
    'hr',
    sizes,
    { label: '⚙️ Pet settings…', onclick: () => openPanel(document.getElementById('pets-btn')) },
  ]);
}

// ---------- Top-bar carousel + panel ----------

const thumbs = new Map();
let thumbRenderer = null;

/** Renders a pet (coded or generated) to a small PNG data URL. */
function renderThumb(p) {
  try {
    if (!thumbRenderer) {
      thumbRenderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: true });
      thumbRenderer.setPixelRatio(2);
      thumbRenderer.setSize(96, 96, false);
      thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
      thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
    const s = new THREE.Scene();
    addLights(s);
    if (!p.glb) p.body.scale.setScalar(2 / p.height);
    p.root.rotation.y = 0.35;
    s.add(p.root);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    cam.position.set(0, 1.5, 5.4);
    cam.lookAt(0, 1.0, 0);
    thumbRenderer.render(s, cam);
    return thumbRenderer.domElement.toDataURL('image/png');
  } catch {
    return '';
  }
}

/** Thumbnail URL for a pet: the coded model at once, swapped for the generated one when it loads. */
function thumb(kind) {
  if (thumbs.has(kind)) return thumbs.get(kind);
  thumbs.set(kind, renderThumb(buildPet(kind)));
  loadGLBPet(kind, { ...GLB_PETS[kind], target: 2 }).then((p) => {
    if (!p) return;
    const url = renderThumb(p);
    if (!url) return;
    thumbs.set(kind, url);
    for (const img of document.querySelectorAll(`img[data-thumb="${kind}"]`)) img.src = url;
  });
  return thumbs.get(kind);
}

const ctl = {
  img: document.getElementById('pet-thumb'),
  name: document.getElementById('pet-name'),
  prev: document.getElementById('pet-prev'),
  next: document.getElementById('pet-next'),
  cur: document.getElementById('pet-current'),
};

function updateControl() {
  const c = cfg();
  ctl.img.src = thumb(c.kind);
  ctl.img.dataset.thumb = c.kind;
  ctl.name.textContent = c.on ? petName(c.kind) : '休息中';
  ctl.cur.classList.toggle('off', !c.on);
  ctl.cur.title = c.on ? `${petName(c.kind)} · 心情 ${mood()}% · click to hide, right-click the pet for more` : 'Click to bring your pet back';
}

function cycle(dir) {
  const c = cfg();
  const i = (ORDER.indexOf(c.kind) + dir + ORDER.length) % ORDER.length;
  setCfg({ kind: ORDER[i], on: true }, { quiet: false });
  fx.play(ctl.cur, [{ opacity: 0, transform: `translateX(${dir * 14}px)` }, { opacity: 1, transform: 'none' }], { duration: 300, easing: fx.EASE_OUT });
  syncPet();
}
ctl.prev.addEventListener('click', () => cycle(-1));
ctl.next.addEventListener('click', () => cycle(1));
ctl.cur.addEventListener('click', () => {
  setCfg({ on: !cfg().on }, { quiet: false });
  syncPet();
});
document.getElementById('pets-btn').addEventListener('click', (e) => openPanel(e.currentTarget));

function openPanel(anchor) {
  const c = cfg();
  const m = mood();
  const tile = (k) => h(`button.pet-pick${c.kind === k && c.on ? '.on' : ''}`, {
    title: petName(k),
    onclick: () => {
      setCfg({ kind: k, on: true }, { quiet: false });
      syncPet();
      openPanel(anchor);
    },
  }, h('img.pet-thumb', { src: thumb(k), alt: '', dataset: { thumb: k } }), h('span', petName(k)));
  const toggle = (label, key, after) => h('label.cal-pick', h('input', { type: 'checkbox', checked: c[key], onchange: (e) => { setCfg({ [key]: e.target.checked }, { quiet: false }); after?.(e.target.checked); } }), label);
  const speedLabel = h('label', `Stroll speed ${c.speed.toFixed(1)}×`);
  const content = h('div.pets-panel',
    h('div.inline', { style: { justifyContent: 'space-between' } },
      h('strong', '🐾 桌宠'),
      h('label.cal-pick', { style: { padding: 0 } }, h('input', { type: 'checkbox', checked: c.on, onchange: (e) => { setCfg({ on: e.target.checked }, { quiet: false }); syncPet(); } }), 'Show')),
    h('div.pet-picks', ORDER.map(tile)),
    h('div.pet-mood', { title: 'Goes up when you pet, feed or play with it and when you finish tasks' },
      h('span', `心情 · ${moodWord(m)}`),
      h('div.pet-mood-bar', h('i', { style: { width: `${m}%` } })),
      h('span.faint', `${m}%`)),
    h('div.field', { style: { marginTop: '4px' } }, h('label', 'Name'),
      h('input.input', {
        value: petName(c.kind), maxLength: 12,
        onchange: (e) => {
          const v = e.target.value.trim();
          const names = { ...(cfg().names || {}) };
          if (v && v !== KINDS[c.kind].name) names[c.kind] = v;
          else delete names[c.kind];
          setCfg({ names }, { quiet: false });
          updateControl();
          say(v ? `我叫${v}!` : '好哦');
        },
      })),
    h('div.grid2', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } },
      h('div.field', speedLabel,
        h('input.pet-range', {
          type: 'range', min: 0.4, max: 2.5, step: 0.1, value: c.speed,
          style: { '--p': `${((c.speed - 0.4) / 2.1) * 100}%` },
          oninput: (e) => {
            const v = Number(e.target.value);
            setCfg({ speed: v });
            speedLabel.textContent = `Stroll speed ${v.toFixed(1)}×`;
            e.target.style.setProperty('--p', `${((v - 0.4) / 2.1) * 100}%`);
          },
        })),
      h('div.field', h('label', 'Size'),
        h('div.pet-sizes', [['S', 0.75], ['M', 1], ['L', 1.3]].map(([label, v]) => h(`button${Math.abs(size() - v) < 0.01 ? '.on' : ''}`, {
          onclick: () => { setCfg({ size: v }, { quiet: false }); openPanel(anchor); },
        }, label))))),
    toggle('Comments on my lists', 'chatty'),
    toggle('Cheers when I finish tasks', 'cheer'),
    toggle('Quiet (only talks when you play with it)', 'quiet'),
    toggle('Sounds', 'sound', (on) => on && sound('happy')),
    h('div.inline', { style: { flexWrap: 'wrap', gap: '6px', marginTop: '6px' } },
      h('button.btn.small', { onclick: () => { closeFloats(); giveTreat(); } }, '🍤 Treat'),
      h('button.btn.small', { onclick: () => { closeFloats(); startFetch(); } }, '🎾 Fetch'),
      h('button.btn.small', { onclick: () => { closeFloats(); toggleFollow(); } }, st.follow ? '✋ Stop' : '🐾 Follow'),
      h('button.btn.small', { onclick: () => { closeFloats(); callOver(); } }, '👋 Come'),
      h('button.btn.small', { onclick: () => { closeFloats(); if (running) { st.reaction = null; sleep(performance.now()); } } }, '💤 Nap'),
      h('button.btn.small', { onclick: () => { closeFloats(); if (running) start('dance'); } }, '💃 Dance'),
    ),
    h('p.help', { style: { marginTop: '8px' } },
      'Click: reaction · double-click: signature move · hover: pet it · drag: pick up (flick to toss) · right-click: menu · drop a task on it to complete it · P: come here · Shift+P: follow. It keeps you company during focus sessions.'),
  );
  popover(anchor, content);
}

/** For tests and the console. */
export const petDebug = () => ({ st, pet, start, react, say, startFetch, giveTreat, toggleFollow, toggleStay, eatTask, mood, ball: () => ball });

export function initPets() {
  updateControl();
  syncPet();
}
