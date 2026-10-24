// The desk pet: one 3D meme critter (奶龙, 奶蛙, 奶蛋, 美团老鼠) strolling around the whiteboard.
// It wanders slowly, turns to walk where it's going, looks at your cursor, naps, visits your lists
// to comment on them, likes being petted (hover), can be picked up (drag), chases treats and
// cheers when you finish tasks. Click it for a reaction; each pet has its own meme moves.
import { store, lists } from './store.js';
import * as fx from './motion.js';
import { h, popover, closeFloats, toast, fmtDue } from './ui.js';
import { THREE, buildPet, loadGLBPet, GLB_PETS, addLights, shadowTexture } from './models3d.js';

const board = document.getElementById('board');
const layer = document.getElementById('pets');
const W = 210; // canvas size (CSS px)
const H = 250;
const BASE_SPEED = 32; // px/s at speed 1: a stroll

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
const DEFAULTS = { kind: 'nailong', on: true, speed: 1, sound: false, cheer: true, chatty: true };
export const cfg = () => ({ ...DEFAULTS, ...(store.state.settings.pet || {}) });
function setCfg(patch, { quiet = true } = {}) {
  store.update((s) => (s.settings.pet = { ...cfg(), ...patch }), { undoable: false, quiet });
}

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

const st = {
  x: 200, y: 300, // feet position on the board (px)
  tx: 200, ty: 300,
  vx: 0, vy: 0,
  yaw: 0, yawTarget: 0,
  mode: 'idle', // stroll | idle | sleep | drag | drop | react | treat | visit | spawn
  until: 0,
  phase: 0, walk: 0, lastS: 0,
  sq: 1, sqV: 0,
  blinkAt: 0, blinkT: 0,
  hoverSince: 0, pettedAt: 0,
  lift: 0, liftV: 0,
  visit: null,
  lastActive: performance.now(),
  lastChat: performance.now(),
  look: { x: 0, y: 0 },
  idleLook: 0,
  reaction: null,
};
let mouse = { x: -9999, y: -9999, on: false };
let treat = null;
let raf = 0;
let lastT = 0;
let running = false;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => 1 - Math.pow(1 - k, 3);
const easeIO = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const bounds = () => ({ x0: 70, y0: 150, x1: board.clientWidth - 70, y1: board.clientHeight - 20 });

function squashImpulse(v) {
  st.sq = v;
  st.sqV = 0;
}

// ---------- Behaviour ----------

function nextGoal(now) {
  const b = bounds();
  const r = Math.random();
  const night = new Date().getHours() >= 23 || new Date().getHours() < 6;
  const quiet = now - st.lastActive > 90000;
  if ((night || quiet) && Math.random() < 0.45) return sleep(now);
  if (r < 0.3 && cfg().chatty) {
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
      return goTo(clamp(cr.left - br.left + rand(30, cr.width - 30), b.x0, b.x1), clamp(cr.bottom - br.top + 26, b.y0, b.y1), 'visit');
    }
  }
  if (r < 0.42 && mouse.on) return goTo(clamp(mouse.x + rand(-80, 80), b.x0, b.x1), clamp(mouse.y + rand(40, 90), b.y0, b.y1), 'stroll');
  // Mostly short strolls from where it is, sometimes a longer walk.
  const far = Math.random() < 0.3;
  const d = far ? rand(200, 520) : rand(70, 220);
  const a = rand(0, Math.PI * 2);
  goTo(clamp(st.x + Math.cos(a) * d, b.x0, b.x1), clamp(st.y + Math.sin(a) * d * 0.7, b.y0, b.y1), 'stroll');
}

function goTo(x, y, mode) {
  st.tx = x;
  st.ty = y;
  st.mode = mode;
}

function idle(now, ms = rand(3500, 8000)) {
  st.mode = 'idle';
  st.until = now + ms;
  st.idleLook = rand(0, 10);
}

function sleep(now) {
  st.mode = 'sleep';
  st.until = now + rand(9000, 18000);
  zzz();
}

function update(dt, now) {
  const b = bounds();
  st.x = clamp(st.x, b.x0 - 40, b.x1 + 40);
  st.y = clamp(st.y, b.y0 - 60, b.y1 + 10);
  let moving = false;

  if (st.mode === 'stroll' || st.mode === 'visit' || st.mode === 'treat') {
    const tx = st.mode === 'treat' && treat ? treat.x : st.tx;
    const ty = st.mode === 'treat' && treat ? treat.y : st.ty;
    const dx = tx - st.x;
    const dy = ty - st.y;
    const d = Math.hypot(dx, dy);
    const sp = (fx.reduced() ? 0 : BASE_SPEED * cfg().speed) * (st.mode === 'treat' ? 3 : 1) * (pet.gait === 'hop' ? 1.15 : 1);
    if (d < 5 || sp === 0) {
      st.vx *= 0.5;
      st.vy *= 0.5;
      if (st.mode === 'treat') eatTreat(now);
      else if (st.mode === 'visit') arriveAtList(now);
      else idle(now);
    } else {
      // Ease in/out of the walk; slow down near the goal.
      const want = Math.min(sp, d * 1.2 + 8);
      st.vx += ((dx / d) * want - st.vx) * Math.min(1, dt * 2.5);
      st.vy += ((dy / d) * want - st.vy) * Math.min(1, dt * 2.5);
      moving = true;
    }
  } else if (st.mode === 'idle') {
    st.vx = st.vy = 0;
    if (now > st.until) nextGoal(now);
    else if (Math.random() < dt * 0.06) doIdleFidget();
  } else if (st.mode === 'sleep') {
    st.vx = st.vy = 0;
    if (now > st.until) wake(now);
  } else if (st.mode === 'react' || st.mode === 'spawn') {
    st.vx *= 0.8;
    st.vy *= 0.8;
    if (st.reaction?.move) {
      st.vx = st.reaction.move.x;
      st.vy = st.reaction.move.y;
    }
    if (now > st.until) {
      st.reaction = null;
      idle(now, rand(1500, 4000));
    }
  } else if (st.mode === 'drop') {
    if (st.lift <= 0.001 && Math.abs(st.liftV) < 0.01) {
      st.mode = 'react';
      st.until = now + 600;
    }
  }

  if (st.mode !== 'drag') {
    st.x += st.vx * dt;
    st.y += st.vy * dt;
  }
  const speed = Math.hypot(st.vx, st.vy);
  st.walk += ((moving && speed > 4 ? 1 : 0) - st.walk) * Math.min(1, dt * 5);
  st.phase += dt * (pet.gait === 'hop' ? 6.2 : 7.5) * (0.6 + 0.4 * Math.min(1.6, speed / BASE_SPEED));

  // Face where it's walking (towards the camera when moving down the screen); face you when idle.
  if (speed > 6 && st.mode !== 'drag') st.yawTarget = Math.atan2(st.vx, st.vy);
  else if (st.mode === 'idle' || st.mode === 'sleep') st.yawTarget = wrapAngle(st.yawTarget) * Math.exp(-dt * 0.8);
  st.yaw += wrapAngle(st.yawTarget - st.yaw) * Math.min(1, dt * 3.2);

  // Gravity for drops and spawns.
  if (st.mode !== 'drag') {
    if (st.lift > 0 || st.liftV > 0) {
      st.liftV -= 9.8 * dt;
      st.lift += st.liftV * dt;
      if (st.lift <= 0) {
        if (st.liftV < -2) {
          squashImpulse(0.72);
          sound('boing');
        }
        st.lift = 0;
        st.liftV = 0;
      }
    }
  }

  // Squash spring.
  const k = 180;
  const c = 12;
  st.sqV += (-k * (st.sq - 1) - c * st.sqV) * dt;
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
  }

  // Occasional chatter while strolling.
  if (cfg().chatty && st.mode === 'stroll' && now - st.lastChat > 45000 && Math.random() < dt * 0.05) {
    st.lastChat = now;
    say(pick(KINDS[pet.kind].lines));
  }
}

function wake(now) {
  st.mode = 'idle';
  st.until = now + rand(1500, 3000);
  clearInterval(zTimer);
  say(pick(['哈~欠', '醒了', '…嗯?']));
}

function doIdleFidget() {
  // A little life while standing: a stretch, a look around, a hop, a wiggle.
  const f = pick(['look', 'stretch', 'hop', 'wiggle']);
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
  st.yawTarget = Math.PI; // turn to "read" the list
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
  setTimeout(() => say(line, { long: true }), 900);
}

// ---------- Reactions ----------
// Each reaction: dur (ms), optional start(), and pose(k 0..1, e seconds, pose) adding offsets.

const REACT = {
  jump: {
    dur: 1000,
    start() { squashImpulse(0.8); sound('boing'); },
    pose(k, e, p) {
      const air = clamp((k - 0.15) / 0.65, 0, 1);
      p.lift += Math.sin(Math.PI * air) * 1.0;
      p.yawAdd += Math.PI * 2 * easeIO(air);
      p.armLz -= 1.2 * Math.sin(Math.PI * air);
      p.armRz += 1.2 * Math.sin(Math.PI * air);
      p.eyesWide = 1 + 0.15 * Math.sin(Math.PI * air);
      if (k > 0.8 && !this.landed) { this.landed = true; squashImpulse(0.75); }
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
      const up = Math.sin(Math.PI * Math.min(1, k * 1.4)) ;
      p.faceCam = 1;
      if (pet.armR) p.armRz += 2.5 * clamp(up * 1.5, 0, 1) + Math.sin(e * 14) * 0.3 * up;
      else p.roll += Math.sin(e * 10) * 0.18 * up;
      p.headRoll += 0.15 * up;
      p.eyes = 0.6;
    },
  },
  curious: {
    dur: 2200,
    start() { say(pick(['?', '嗯?', '你在干嘛'])); },
    pose(k, e, p) { const u = Math.sin(Math.PI * k); p.faceCam = 1; p.headRoll += 0.38 * u; p.eyesWide = 1 + 0.3 * u; p.lean += 0.08 * u; },
  },
  hearts: {
    dur: 1800,
    start() { hearts(7); sound('happy'); },
    pose(k, e, p) { p.eyes = 0.25; p.roll += Math.sin(e * 6) * 0.1; p.faceCam = 1; },
  },
  dance: {
    dur: 2600,
    start() { sound('happy'); notes(); say(pick(['🎶', '扭一扭', '跳舞!'])); },
    pose(k, e, p) {
      p.lift += Math.abs(Math.sin(e * 7)) * 0.2;
      p.roll += Math.sin(e * 7) * 0.22;
      p.yawAdd += Math.sin(e * 3.5) * 0.7;
      p.armLz -= 1.6 + Math.sin(e * 7) * 0.5;
      p.armRz += 1.6 + Math.sin(e * 7 + 1) * 0.5;
      p.eyes = 0.35;
      p.mouth = Math.sin(e * 7) > 0;
    },
  },
  dizzy: {
    dur: 2400,
    start() { stars(); say('晕…'); },
    pose(k, e, p) {
      const u = 1 - k * 0.5;
      p.headRoll += Math.sin(e * 9) * 0.3 * u;
      p.roll += Math.sin(e * 6) * 0.14 * u;
      p.lookX = Math.cos(e * 12) * 0.45;
      p.lookY = Math.sin(e * 12) * 0.45;
    },
  },
  hop1: {
    dur: 600,
    pose(k, e, p) { p.lift += Math.sin(Math.PI * k) * 0.3; if (k > 0.85 && !this.l) { this.l = 1; squashImpulse(0.85); } },
  },
  stretch: {
    dur: 1800,
    start() { say(pick(['哈~欠', '伸懒腰'])); },
    pose(k, e, p) { const u = Math.sin(Math.PI * k); p.sqY = 1 + 0.12 * u; p.armLz -= 2.2 * u; p.armRz += 2.2 * u; p.eyes = 1 - 0.85 * u; p.mouth = u > 0.5; p.headPitch -= 0.3 * u; },
  },
  wiggle: {
    dur: 1200,
    pose(k, e, p) { p.roll += Math.sin(e * 16) * 0.08 * (1 - k); p.tailY += Math.sin(e * 20) * 0.6; },
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
      p.roll += Math.sin(e * 5) * 0.08 * u;
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
      p.armLz += (0.55 + Math.sin(e * 6) * 0.12) * u;
      p.armRz -= (0.55 + Math.sin(e * 6 + 1.5) * 0.12) * u;
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
    pose(k, e, p) { p.roll += Math.sin(e * 8) * 0.42 * (1 - k); p.lift += Math.abs(Math.sin(e * 8)) * 0.04; },
  },
  flip: {
    // 奶蛋: a full somersault.
    dur: 1200,
    start() { squashImpulse(0.75); sound('boing'); },
    pose(k, e, p) {
      const air = clamp((k - 0.12) / 0.7, 0, 1);
      p.lift += Math.sin(Math.PI * air) * 1.3;
      p.flip = Math.PI * 2 * easeIO(air);
      if (k > 0.85 && !this.landed) { this.landed = true; squashImpulse(0.7); say('咕!'); }
    },
  },
  laugh: {
    // 美团老鼠 meme: eyes squeezed shut, mouth wide, shaking with laughter.
    dur: 2800,
    start() { say(pick(['你的外卖我偷吃了😋', '哈哈哈哈哈', '嘿嘿嘿嘿']), { long: true }); sound('happy'); haha(); },
    pose(k, e, p) {
      const u = clamp(k * 6, 0, 1) * clamp((1 - k) * 5, 0, 1);
      p.faceCam = 1;
      p.eyes = 1 - 0.9 * u;
      p.mouth = u > 0.2;
      p.headPitch -= 0.28 * u;
      p.shake = Math.sin(e * 45) * 0.03 * u;
      p.roll += Math.sin(e * 22) * 0.04 * u;
      p.earL += Math.sin(e * 18) * 0.25 * u;
      p.earR += Math.sin(e * 18 + 1) * 0.25 * u;
      p.armLx += Math.sin(e * 22) * 0.2 * u;
      p.armRx += Math.sin(e * 22) * 0.2 * u;
    },
  },
  headshake: {
    // "Nope": head shakes side to side.
    dur: 1600,
    start() { say(pick(['不要~', '略略略', '才不'])); },
    pose(k, e, p) { const u = Math.sin(Math.PI * k); p.faceCam = 1; p.headYaw += Math.sin(e * 13) * 0.55 * u; p.roll += Math.sin(e * 13) * 0.05 * u; },
  },
  nod: {
    dur: 1500,
    start() { say(pick(['嗯嗯!', '对对对', '好的'])); },
    pose(k, e, p) { const u = Math.sin(Math.PI * k); p.faceCam = 1; p.headPitch += Math.max(0, Math.sin(e * 11)) * 0.45 * u; },
  },
  bellybounce: {
    // 奶蛙: the round belly jiggles up and down.
    dur: 2200,
    start() { say(pick(['肚肚~', '……舒服', '吃饱了'])); },
    pose(k, e, p) { const u = Math.sin(Math.PI * k); p.faceCam = 1; p.sqY *= 1 + Math.sin(e * 16) * 0.06 * u; p.lift += Math.abs(Math.sin(e * 8)) * 0.06 * u; p.headPitch -= 0.1 * u; },
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
      p.lift += Math.abs(Math.sin(e * Math.PI * 1.5)) * 0.55;
      p.earL += Math.abs(Math.sin(e * Math.PI * 1.5)) * 0.4;
      p.earR += Math.abs(Math.sin(e * Math.PI * 1.5)) * 0.4;
      p.pitch -= 0.15;
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
  r.start?.call(r);
  if (r.move) {
    // Hops travel: face the hop direction.
    st.yawTarget = Math.atan2(r.move.x, r.move.y);
  }
}

// Generated models have no separate eyes/arms/tongue: their signatures use whole-body and head bends.
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
}

// ---------- Pose ----------

function basePose() {
  return {
    lift: 0, yawAdd: 0, yawOverride: null, faceCam: 0, flip: 0, roll: 0, pitch: 0, lean: 0, shake: 0, sqY: 1,
    headYaw: 0, headPitch: 0, headRoll: 0,
    armLx: 0, armLz: 0, armRx: 0, armRz: 0, legLx: 0, legRx: 0,
    tailX: 0, tailY: 0, earL: 0, earR: 0,
    eyes: 1, eyesWide: 1, lookX: 0, lookY: 0, mouth: false, tongue: 0,
  };
}

function computePose(now, t) {
  const p = basePose();
  const w = st.walk;
  const s = Math.sin(st.phase);

  // Gait
  if (pet.gait === 'waddle') {
    p.legLx += s * 0.55 * w;
    p.legRx -= s * 0.55 * w;
    p.armLx -= s * 0.45 * w;
    p.armRx += s * 0.45 * w;
    p.roll += s * 0.08 * w;
    p.lift += Math.abs(Math.cos(st.phase)) * 0.05 * w;
    p.tailY += s * 0.4 * w;
  } else {
    const up = Math.max(0, s);
    p.lift += up * 0.3 * w;
    p.pitch -= (s > 0 ? 0.08 : -0.03) * w;
    p.earL += up * 0.3 * w;
    p.earR += up * 0.3 * w;
    p.tailX += up * 0.35 * w;
    if (st.lastS > 0 && s <= 0 && w > 0.5) squashImpulse(0.88);
    st.lastS = s;
  }

  // Breathing and idle life
  p.sqY *= 1 + Math.sin(t * 2.1) * 0.012;
  p.tailY += Math.sin(t * 1.7) * 0.25;
  p.earL += Math.sin(t * 2.3) * 0.03;
  p.earR += Math.sin(t * 2.3 + 1) * 0.03;

  // Look at the cursor (or look around when idle).
  if (st.mode !== 'sleep') {
    const headY = st.y - (H * (feetFromTop - 0.18));
    const dx = mouse.x - st.x;
    const dy = mouse.y - headY;
    const d = Math.hypot(dx, dy);
    let lx = 0, ly = 0;
    if (mouse.on && d < 380) {
      lx = clamp(dx / 260, -1, 1);
      ly = clamp(dy / 300, -1, 1);
    } else if (st.mode === 'idle') {
      lx = Math.sin(t * 0.45 + st.idleLook) * 0.7;
      ly = Math.sin(t * 0.3 + st.idleLook) * 0.15;
    }
    st.look.x += (lx - st.look.x) * 0.08;
    st.look.y += (ly - st.look.y) * 0.08;
    const facingAway = Math.abs(wrapAngle(st.yaw)) > 1.9;
    if (!facingAway) {
      p.headYaw += clamp(st.look.x * 0.8 - wrapAngle(st.yaw) * 0.6, -0.85, 0.85);
      p.headPitch += st.look.y * 0.3;
      p.lookX = st.look.x * 0.32;
      p.lookY = st.look.y * 0.3;
    }
  }

  // Blink / sleep
  const sinceBlink = now - st.blinkT;
  if (sinceBlink < 170) p.eyes = Math.abs(sinceBlink - 85) / 85;
  if (st.mode === 'sleep') {
    p.eyes = 0.06;
    p.headPitch += 0.25;
    p.headRoll += 0.12;
    p.sqY *= 1 + Math.sin(t * 1.3) * 0.03;
    p.lift = 0;
  }

  // Held: dangle.
  if (st.mode === 'drag') {
    p.legLx += Math.sin(t * 7) * 0.45;
    p.legRx -= Math.sin(t * 7) * 0.45;
    p.armLz -= 0.9 + Math.sin(t * 6) * 0.2;
    p.armRz += 0.9 + Math.sin(t * 6) * 0.2;
    p.eyesWide = 1.2;
    p.mouth = true;
    p.roll += st.dragTilt || 0;
    p.faceCam = 1;
  }

  // Reaction on top
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
  P.root.position.set(p.shake, st.lift + p.lift, 0);
  P.root.rotation.set(0, yaw + p.yawAdd, 0);
  // Somersault rotates around the body's middle.
  const mid = P.height * P.scale * 0.5;
  P.squash.position.set(0, p.flip ? mid : 0, 0);
  P.body.position.set(0, p.flip ? -mid : 0, 0);
  P.squash.rotation.set(p.flip, 0, 0);
  P.body.rotation.set(p.pitch + p.lean, 0, p.roll);
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
  if (P.glb) {
    // Head bend for generated models; their waddle comes from a stronger body roll.
    P.uniforms.uTwist.value = clamp(p.headYaw, -0.9, 0.9);
    P.uniforms.uNod.value = clamp(p.headPitch, -0.5, 0.5);
    P.uniforms.uTilt.value = clamp(p.headRoll * 0.8 + p.roll * 0.6, -0.5, 0.5);
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
  const pose = computePose(now, now / 1000);
  applyPose(pose);
  wrap.style.transform = `translate3d(${(st.x - W / 2).toFixed(1)}px, ${(st.y - H * feetFromTop).toFixed(1)}px, 0)`;
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

function say(text, { long = false } = {}) {
  if (!wrap) return;
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

function floaty(text, { delay = 0, color, size = 16, dx = 0, dy = -70, font } = {}) {
  const hp = headPoint();
  const s = h('span.floaty', { style: { left: hp.x + 'px', top: hp.y + 12 + 'px', color, fontSize: size + 'px', ...(font ? { font } : {}) } }, text);
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
  const p0 = boardPoint(e);
  const off = { x: st.x - p0.x, y: st.y - p0.y };
  let dragging = false;
  let lastX = e.clientX;
  const move = (ev) => {
    const p = boardPoint(ev);
    if (!dragging && Math.hypot(p.x - p0.x, p.y - p0.y) > 5) {
      dragging = true;
      st.mode = 'drag';
      st.reaction = null;
      clearInterval(zTimer);
      squashImpulse(1.15);
      board.classList.add('pet-grab');
      say(pick(['诶诶诶?!', '放我下来', '飞~', '!!']));
    }
    if (!dragging) return;
    st.x = p.x + off.x;
    st.y = p.y + off.y + 20;
    st.lift = 0.45;
    st.dragTilt = clamp((ev.clientX - lastX) * -0.03, -0.4, 0.4);
    lastX = ev.clientX;
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    board.classList.remove('pet-grab');
    st.dragTilt = 0;
    if (!dragging) return react();
    st.y -= 20;
    st.mode = 'drop';
    st.liftV = 0;
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}, true);

board.addEventListener('pointermove', (e) => {
  const p = boardPoint(e);
  mouse = { x: p.x, y: p.y, on: true };
  st.lastActive = performance.now();
  const over = hit(e.clientX, e.clientY);
  board.classList.toggle('pet-hover', over);
  if (over && !st.hoverSince) st.hoverSince = performance.now();
  if (!over) st.hoverSince = 0;
});
board.addEventListener('pointerleave', () => {
  mouse.on = false;
  st.hoverSince = 0;
  board.classList.remove('pet-hover');
});
board.addEventListener('dblclick', (e) => {
  if (!hit(e.clientX, e.clientY)) return;
  e.stopPropagation();
  start(pick(signatures()));
}, true);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopLoop();
  else if (cfg().on && pet) startLoop();
});

// ---------- Planner events ----------

document.addEventListener('planner:done', () => {
  if (!cfg().cheer || !running || st.mode === 'drag') return;
  setTimeout(() => {
    start(Math.random() < 0.5 ? 'jump' : 'hearts');
    say(pick(['好耶!', '又搞定一个!', '厉害!', '👏']));
  }, 250);
});
document.addEventListener('planner:celebrate', () => {
  if (!cfg().cheer || !running || st.mode === 'drag') return;
  setTimeout(() => start('dance'), 300);
});

// ---------- Treats ----------

function giveTreat() {
  if (!running) return toast('Turn the pet on first');
  treat?.el.remove();
  const b = bounds();
  const t = { x: rand(b.x0 + 40, b.x1 - 40), y: rand(b.y0 + 40, b.y1 - 20) };
  t.el = h('div.treat', pick(['🍤', '🍗', '🍜', '🥟', '🍰', '🍟']));
  t.el.style.left = t.x + 'px';
  t.el.style.top = t.y + 'px';
  layer.append(t.el);
  fx.play(t.el, [{ opacity: 0, transform: 'translate(-50%, -260px) rotate(-90deg)' }, { opacity: 1, transform: 'translate(-50%, -100%)' }], fx.SPRING_BOUNCY);
  treat = t;
  clearInterval(zTimer);
  st.reaction = null;
  st.mode = 'treat';
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
  sound('pop');
  start('hearts');
  say(pick(['好吃!', '嗷呜', '😋', '还要!']));
  st.until = now + 1800;
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
  st.yaw = st.yawTarget = 0;
  setTimeout(() => say(pick(KINDS[kind].lines)), 900);
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
    }
    return;
  }
  if (!setupGL()) return;
  wrap.style.display = '';
  if (loadingKind === c.kind) return;
  if (!pet) {
    const b = bounds();
    st.x = rand(b.x0 + 60, Math.max(b.x0 + 61, b.x1 - 60));
    st.y = rand(b.y0 + 100, Math.max(b.y0 + 101, b.y1 - 40));
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
  ctl.name.textContent = c.on ? KINDS[c.kind].name : '休息中';
  ctl.cur.classList.toggle('off', !c.on);
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
  const tile = (k) => h(`button.pet-pick${c.kind === k && c.on ? '.on' : ''}`, {
    title: KINDS[k].name,
    onclick: () => {
      setCfg({ kind: k, on: true }, { quiet: false });
      syncPet();
      openPanel(anchor);
    },
  }, h('img.pet-thumb', { src: thumb(k), alt: '', dataset: { thumb: k } }), h('span', KINDS[k].name));
  const toggle = (label, key, after) => h('label.cal-pick', h('input', { type: 'checkbox', checked: c[key], onchange: (e) => { setCfg({ [key]: e.target.checked }, { quiet: false }); after?.(e.target.checked); } }), label);
  const speedLabel = h('label', `Stroll speed ${c.speed.toFixed(1)}×`);
  const content = h('div.pets-panel',
    h('div.inline', { style: { justifyContent: 'space-between' } },
      h('strong', '🐾 桌宠'),
      h('label.cal-pick', { style: { padding: 0 } }, h('input', { type: 'checkbox', checked: c.on, onchange: (e) => { setCfg({ on: e.target.checked }, { quiet: false }); syncPet(); } }), 'Show')),
    h('div.pet-picks', ORDER.map(tile)),
    h('div.field', { style: { marginTop: '6px' } }, speedLabel,
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
    toggle('Comments on my lists', 'chatty'),
    toggle('Cheers when I finish tasks', 'cheer'),
    toggle('Sounds', 'sound', (on) => on && sound('happy')),
    h('div.inline', { style: { flexWrap: 'wrap', gap: '6px', marginTop: '8px' } },
      h('button.btn.small', { onclick: () => { closeFloats(); giveTreat(); } }, '🍤 Treat'),
      h('button.btn.small', { onclick: () => { closeFloats(); if (running) { st.reaction = null; sleep(performance.now()); } } }, '💤 Nap'),
      h('button.btn.small', { onclick: () => { closeFloats(); if (running) start('dance'); } }, '💃 Dance'),
      h('button.btn.small', { onclick: () => { closeFloats(); if (running) comeHere(); } }, '👋 Come here'),
    ),
    h('p.help', { style: { marginTop: '8px' } }, 'Click it for a reaction · double-click for its signature move · hover to pet · drag to pick it up.'),
  );
  popover(anchor, content);
}

function comeHere() {
  const b = bounds();
  const tx = board.clientWidth / 2;
  const ty = Math.min(b.y1, board.clientHeight / 2 + 120);
  st.reaction = null;
  clearInterval(zTimer);
  goTo(tx, ty, 'stroll');
  say(pick(['来啦~', '马上到', '嗯嗯']));
}

/** For tests and the console. */
export const petDebug = () => ({ st, pet, start, react, say });

export function initPets() {
  updateControl();
  syncPet();
}
