// 3D pet models, built from primitives so every part (head, eyes, ears, arms, legs, tail,
// tongue) is a separate node the animation code can move.
// Units: feet on y = 0, about 2 units tall, facing +z (towards the camera at yaw 0).
import * as THREE from '../vendor/three.module.min.js';

const mat = (color, roughness = 0.5, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
const mesh = (geo, m) => {
  const o = new THREE.Mesh(geo, m);
  o.castShadow = false;
  return o;
};
const sphere = (r, m, w = 48, h = 32) => mesh(new THREE.SphereGeometry(r, w, h), m);
const capsule = (r, len, m) => mesh(new THREE.CapsuleGeometry(r, len, 10, 24), m);
const group = (...kids) => {
  const g = new THREE.Group();
  for (const k of kids) if (k) g.add(k);
  return g;
};
function at(o, x, y, z, s) {
  o.position.set(x, y, z);
  if (s !== undefined) Array.isArray(s) ? o.scale.set(...s) : o.scale.setScalar(s);
  return o;
}
function rot(o, x = 0, y = 0, z = 0) {
  o.rotation.set(x, y, z);
  return o;
}
/** A smooth solid of revolution from (radius, height) control points. */
function lathe(pts, m, seg = 64) {
  const curve = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y)));
  const p = curve.getPoints(48).map((v) => new THREE.Vector2(Math.max(0, v.x), v.y));
  return mesh(new THREE.LatheGeometry(p, seg), m);
}

/** An eye facing +z: sclera ball, iris + pupil caps in a "look" group, and a highlight. */
function eye({ r = 0.1, sclera = '#fbfbf6', iris = '#3f9a45', irisA = 0.62, pupilA = 0.36, ring = null }) {
  const g = new THREE.Group();
  g.add(sphere(r, mat(sclera, 0.18), 32, 24));
  const look = new THREE.Group();
  const cap = (rr, a, color, rough = 0.25) => rot(mesh(new THREE.SphereGeometry(rr, 32, 10, 0, Math.PI * 2, 0, a), mat(color, rough)), Math.PI / 2);
  if (ring) look.add(cap(r * 1.003, irisA + 0.1, ring));
  look.add(cap(r * 1.006, irisA, iris));
  look.add(cap(r * 1.01, pupilA, '#0d0b0a', 0.15));
  const hl = sphere(r * 0.16, new THREE.MeshBasicMaterial({ color: '#ffffff' }), 12, 8);
  hl.position.set(r * 0.28, r * 0.3, r * 0.96);
  look.add(hl);
  g.add(look);
  g.userData.look = look;
  return g;
}

/** A curved line (smile) facing +z. */
function smile(radius, tube, color, arc = Math.PI * 0.8) {
  const t = mesh(new THREE.TorusGeometry(radius, tube, 8, 32, arc), mat(color, 0.4));
  t.rotation.z = Math.PI + (Math.PI - arc) / 2;
  return t;
}

function claws(n, r, color, spread, z) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) g.add(at(sphere(r, mat(color, 0.4), 12, 8), (i - (n - 1) / 2) * spread, 0, z));
  return g;
}

// ---------- 奶龙 ----------
function nailong() {
  const skin = mat('#f6b42a', 0.42, { emissive: '#3a1d00', emissiveIntensity: 0.06 });
  const belly = mat('#fff6e6', 0.5);
  const dark = '#5b3a20';
  const p = {};

  const torso = at(sphere(0.62, skin), 0, 0.66, 0, [1, 0.95, 0.88]);
  const tummy = at(sphere(0.5, belly), 0, 0.6, 0.3, [0.82, 0.98, 0.62]);

  p.legL = group(at(capsule(0.15, 0.1, skin), 0, -0.1, 0), at(sphere(0.17, skin), 0, -0.24, 0.07, [1, 0.55, 1.35]), at(claws(3, 0.028, dark, 0.07, 0.28), 0, -0.25, 0));
  p.legR = p.legL.clone();
  at(p.legL, -0.26, 0.3, 0.02);
  at(p.legR, 0.26, 0.3, 0.02);

  const arm = () => group(at(capsule(0.1, 0.24, skin), 0, -0.18, 0.02), at(claws(3, 0.022, dark, 0.045, 0.06), 0, -0.36, 0.02));
  p.armL = rot(at(arm(), -0.52, 0.88, 0.08), 0, 0, -0.35);
  p.armR = rot(at(arm(), 0.52, 0.88, 0.08), 0, 0, 0.35);

  p.tail = group(rot(at(capsule(0.14, 0.32, skin), 0, -0.05, -0.2), -1.15), at(sphere(0.12, skin), 0, -0.2, -0.42));
  at(p.tail, 0, 0.42, -0.42);

  // Big dome head with a soft snout.
  p.head = group(
    at(sphere(0.72, skin), 0, 0.5, 0, [1, 0.9, 0.94]),
    at(sphere(0.46, skin), 0, 0.36, 0.3, [1.12, 0.78, 0.92]),
  );
  const eL = rot(at(eye({ r: 0.11, iris: '#2f7d3c', irisA: 0.66, pupilA: 0.4 }), -0.34, 0.56, 0.54), 0, -0.42, 0);
  const eR = rot(at(eye({ r: 0.11, iris: '#2f7d3c', irisA: 0.66, pupilA: 0.4 }), 0.34, 0.56, 0.54), 0, 0.42, 0);
  p.eyes = [eL, eR];
  p.mouthClosed = at(smile(0.07, 0.012, '#7a3a1a'), 0, 0.28, 0.71);
  p.mouthOpen = at(sphere(0.12, mat('#6b1f16', 0.6)), 0, 0.27, 0.66, [1, 0.6, 0.5]);
  p.mouthOpen.visible = false;
  p.tongue = rot(at(capsule(0.085, 0.16, mat('#ff7d97', 0.35)), 0, 0.2, 0.74, [1, 1, 0.55]), 1.25);
  p.tongue.scale.set(0.001, 0.001, 0.001);
  p.head.add(eL, eR, p.mouthClosed, p.mouthOpen, p.tongue);
  at(p.head, 0, 1.0, 0.04);

  p.body = group(torso, tummy, p.legL, p.legR, p.armL, p.armR, p.tail, p.head);
  return { ...p, name: '奶龙', height: 2.15, gait: 'waddle' };
}

// ---------- 奶蛙 ----------
function naiwa() {
  const skin = mat('#f5cd3c', 0.48);
  const belly = mat('#f3e7cf', 0.6);
  const hand = mat('#5f5b4a', 0.55);
  const p = {};
  const body = lathe([[0, 0], [0.55, 0.04], [0.78, 0.3], [0.82, 0.62], [0.76, 0.98], [0.6, 1.36], [0.47, 1.66], [0.36, 1.92], [0.18, 2.08], [0, 2.12]], skin);
  const tummy = at(sphere(0.6, belly), 0, 0.68, 0.6, [0.98, 1.08, 0.5]);

  p.legL = at(group(at(capsule(0.2, 0.06, skin), 0, -0.05, 0), at(sphere(0.21, skin), 0, -0.14, 0.08, [1, 0.5, 1.3])), -0.3, 0.16, 0.05);
  p.legR = at(p.legL.clone(), 0.3, 0.16, 0.05);

  const arm = (side) => {
    const g = group(at(capsule(0.12, 0.5, skin), 0, -0.32, 0), at(sphere(0.13, hand), 0, -0.66, 0.02, [1, 1.1, 0.9]));
    return rot(at(g, side * 0.64, 1.28, 0.02), 0, 0, side * 0.16);
  };
  p.armL = arm(-1);
  p.armR = arm(1);

  // No neck: the "head" is a group on top of the body carrying the face, so it can turn a bit.
  p.head = new THREE.Group();
  const eL = rot(at(eye({ r: 0.12, iris: '#47b54d', irisA: 0.78, pupilA: 0.38, ring: '#2a7a30' }), -0.29, 0.0, 0.29), 0, -0.78, 0);
  const eR = rot(at(eye({ r: 0.12, iris: '#47b54d', irisA: 0.78, pupilA: 0.38, ring: '#2a7a30' }), 0.29, 0.0, 0.29), 0, 0.78, 0);
  p.eyes = [eL, eR];
  p.mouthClosed = at(smile(0.06, 0.011, '#4a3a20', Math.PI * 0.6), 0, -0.13, 0.43);
  p.mouthOpen = at(sphere(0.07, mat('#5a2016', 0.6)), 0, -0.13, 0.41, [1.2, 0.7, 0.5]);
  p.mouthOpen.visible = false;
  p.head.add(eL, eR, p.mouthClosed, p.mouthOpen);
  at(p.head, 0, 1.72, 0);

  p.body = group(body, tummy, p.legL, p.legR, p.armL, p.armR, p.head);
  return { ...p, name: '奶蛙', height: 2.12, gait: 'waddle', noNeck: true };
}

// ---------- 奶蛋 ----------
function naidan() {
  const shell = mat('#f2cf38', 0.78);
  const p = {};
  const egg = lathe([[0, 0], [0.42, 0.04], [0.66, 0.28], [0.74, 0.62], [0.68, 0.98], [0.52, 1.3], [0.28, 1.52], [0, 1.6]], shell);
  p.head = new THREE.Group();
  const eL = rot(at(eye({ r: 0.1, iris: '#3f9e3c', irisA: 0.72, pupilA: 0.36, ring: '#2c7a2a' }), -0.27, 0.0, 0.58), 0, -0.42, 0);
  const eR = rot(at(eye({ r: 0.1, iris: '#3f9e3c', irisA: 0.72, pupilA: 0.36, ring: '#2c7a2a' }), 0.27, 0.0, 0.58), 0, 0.42, 0);
  p.eyes = [eL, eR];
  const beak = rot(at(mesh(new THREE.ConeGeometry(0.1, 0.17, 28), mat('#e9c22e', 0.6)), 0, -0.17, 0.74), Math.PI / 2 + 0.3);
  p.mouthClosed = at(smile(0.085, 0.009, '#7a5a10', Math.PI * 0.55), 0, -0.18, 0.75);
  p.mouthOpen = at(sphere(0.06, mat('#7a2a16', 0.6)), 0, -0.25, 0.72, [1.2, 0.6, 0.5]);
  p.mouthOpen.visible = false;
  p.head.add(eL, eR, beak, p.mouthClosed, p.mouthOpen);
  at(p.head, 0, 1.08, 0);
  p.body = group(egg, p.head);
  return { ...p, name: '奶蛋', height: 1.6, gait: 'hop', noNeck: true };
}

// ---------- 美团老鼠 ----------
function laoshu() {
  const clay = mat('#ffc414', 0.92);
  const belly = mat('#fff0a6', 0.92);
  const nose = mat('#6a2a0e', 0.45);
  const p = {};
  const body = lathe([[0, 0], [0.56, 0.04], [0.74, 0.3], [0.72, 0.62], [0.58, 0.92], [0.4, 1.12], [0, 1.2]], clay);
  const tummy = at(sphere(0.52, belly), 0, 0.5, 0.38, [0.88, 0.98, 0.55]);

  const leg = (side) => group(at(sphere(0.3, clay), side * 0.42, 0.26, 0.12, [1, 0.9, 1.1]), at(capsule(0.15, 0.26, clay), side * 0.36, 0.12, 0.46));
  p.legL = leg(-1);
  p.legR = leg(1);
  p.legL.children[1].rotation.x = Math.PI / 2;
  p.legR.children[1].rotation.x = Math.PI / 2;

  const arm = (side) => rot(at(group(at(capsule(0.09, 0.2, clay), 0, -0.14, 0)), side * 0.42, 0.9, 0.3), 0.7, 0, side * 0.9);
  p.armL = arm(-1);
  p.armR = arm(1);

  p.tail = at(group(rot(at(capsule(0.09, 0.42, clay), 0, 0.05, -0.2), -1.2), at(sphere(0.1, clay), 0, 0.28, -0.4)), 0, 0.22, -0.5);

  p.head = new THREE.Group();
  p.head.add(at(sphere(0.46, clay), 0, 0.34, 0, [0.96, 1, 0.96]));
  p.head.add(rot(at(capsule(0.26, 0.3, clay), 0, 0.2, 0.36), Math.PI / 2 - 0.12));
  p.head.add(at(sphere(0.16, nose), 0, 0.26, 0.76, [1.2, 0.85, 0.8]));
  const eL = rot(at(eye({ r: 0.078, iris: '#4a2408', irisA: 0.7, pupilA: 0.3 }), -0.17, 0.48, 0.32), 0, -0.32, 0);
  const eR = rot(at(eye({ r: 0.078, iris: '#4a2408', irisA: 0.7, pupilA: 0.3 }), 0.17, 0.48, 0.32), 0, 0.32, 0);
  p.eyes = [eL, eR];
  const ear = (side) => {
    const e = group(at(capsule(0.16, 0.36, clay), 0, 0.28, 0, [1, 1, 0.62]));
    return rot(at(e, side * 0.2, 0.62, -0.06), 0, 0, -side * 0.38);
  };
  p.earL = ear(-1);
  p.earR = ear(1);
  p.mouthClosed = at(smile(0.1, 0.014, '#7a3a10', Math.PI * 0.7), 0, 0.06, 0.58);
  p.mouthOpen = at(sphere(0.14, mat('#7a2416', 0.6)), 0, 0.04, 0.5, [1.25, 0.6, 0.6]);
  p.mouthOpen.visible = false;
  p.head.add(eL, eR, p.earL, p.earR, p.mouthClosed, p.mouthOpen);
  at(p.head, 0, 1.0, 0.05);

  p.body = group(body, tummy, p.legL, p.legR, p.armL, p.armR, p.tail, p.head);
  return { ...p, name: '美团老鼠', height: 2.05, gait: 'hop' };
}

export const MODELS = { nailong, naiwa, naidan, laoshu };

/** Builds a pet: root (position/yaw) > squash (scale) > body. */
export function buildPet(kind) {
  const p = MODELS[kind]();
  p.kind = kind;
  p.squash = group(p.body);
  p.root = group(p.squash);
  // Rest poses, so animation can be expressed as offsets.
  p.rest = new Map();
  for (const k of ['head', 'armL', 'armR', 'legL', 'legR', 'tail', 'earL', 'earR']) {
    if (p[k]) p.rest.set(k, { pos: p[k].position.clone(), rot: p[k].rotation.clone() });
  }
  return p;
}

// ---------- Generated GLB pets ----------
// A generated model (image-to-3D) is one solid mesh, so it has no head or limb nodes. To make it
// move like the coded pets, it gets a vertex shader that bends its upper part: a "head" that turns
// (twist), nods and tilts, weighted by height. Geometry is baked into model space (feet at y = 0,
// centred, about `target` units tall) so the shader can work in those units.

// Generated models (planner/public/models/<kind>.glb) are used when present; the coded models
// are the fallback. `yaw` turns a generated model so its face points at the camera. `paint`
// repaints the generated texture in the character's flat colours: the generator bakes shadows
// in and invents colours (grey-blue bands, green smears) on the sides the photo didn't show.
export const GLB_PETS = {
  nailong: { target: 2.15, yaw: 0, paint: { body: '#f7b52c', dark: 22 }, belly: { color: '#fff4e2', cy: 0.68, rx: 0.36, ry: 0.44 } },
  naiwa: { target: 2.2, yaw: 1.1 },
  naidan: { target: 1.6, yaw: 0, paint: { body: '#f2cf38' } },
  laoshu: { target: 2.05, yaw: 0 },
};

let gltfLoader = null;
const glbCache = new Map();

/**
 * Loads /models/<kind>.glb if it exists. Resolves to a pet like buildPet(), or null.
 * `paint` repaints the generated texture with the character's own flat palette (the generator
 * bakes in shadows and invents colours on the sides it never saw): { body, belly?, dark? }.
 */
export function loadGLBPet(kind, { url = new URL(`../models/${kind}.glb`, import.meta.url).href, target = 2.15, yaw = 0, paint = null, belly = null } = {}) {
  if (!glbCache.has(url)) {
    glbCache.set(url, (async () => {
      const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
      if (!head?.ok) return null;
      gltfLoader ??= new (await import('../vendor/addons/loaders/GLTFLoader.js')).GLTFLoader();
      const gltf = await gltfLoader.loadAsync(url);
      if (paint) gltf.scene.traverse((o) => o.isMesh && [].concat(o.material).forEach((m) => m.map && (m.map = paintTexture(m.map, paint))));
      return gltf;
    })().catch(() => null));
  }
  return glbCache.get(url).then((gltf) => (gltf ? petFromGLTF(kind, gltf, target, yaw, belly) : null));
}

const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * Copy of a texture reduced to the palette: near-black pixels (pupils, mouth, claws, nose) and
 * bright green irises are kept; pale low-saturation pixels become the belly; everything else the body.
 */
function paintTexture(tex, { body, belly = null, dark = 32 }) {
  const img = tex.image;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const B = hexRGB(body);
  const W = belly && hexRGB(belly);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const gg = d[i + 1];
    const b = d[i + 2];
    const lum = 0.3 * r + 0.59 * gg + 0.11 * b;
    if (lum < dark || (gg > r * 0.98 && gg > b * 1.8 && lum > 100)) continue;
    const to = W && lum > 55 && r - b < r * 0.45 ? W : B;
    d[i] = to[0];
    d[i + 1] = to[1];
    d[i + 2] = to[2];
  }
  g.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = tex.flipY;
  t.colorSpace = tex.colorSpace;
  t.channel = tex.channel;
  t.wrapS = tex.wrapS;
  t.wrapT = tex.wrapT;
  t.anisotropy = 4;
  return t;
}

/**
 * Soft 0..1 weight per vertex for a belly patch: front-facing vertices inside an ellipse
 * (model units, feet at y = 0).
 */
function bellyWeights(geo, { cx = 0, cy, rx, ry }) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const w = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const d = Math.hypot((p.getX(i) - cx) / rx, (p.getY(i) - cy) / ry);
    w[i] = (1 - THREE.MathUtils.smoothstep(d, 0.82, 1)) * THREE.MathUtils.smoothstep(n.getZ(i), 0.15, 0.45);
  }
  geo.setAttribute('aBelly', new THREE.BufferAttribute(w, 1));
}

function petFromGLTF(kind, gltf, target, yaw, belly) {
  const src = gltf.scene;
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src);
  const size = box.getSize(new THREE.Vector3());
  const s = target / size.y;
  const norm = new THREE.Matrix4()
    .makeRotationY(yaw)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));

  const uniforms = {
    uTwist: { value: 0 }, uNod: { value: 0 }, uTilt: { value: 0 },
    uNeck: { value: target * 0.55 }, uTop: { value: target * 0.95 },
    uBelly: { value: new THREE.Color(belly?.color ?? '#ffffff') },
  };
  const body = new THREE.Group();
  src.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
    // Hunyuan3D writes UVs with a bottom-left origin (glTF expects top-left) and no normals.
    const uv = geo.attributes.uv;
    if (uv) {
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      uv.needsUpdate = true;
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (belly) bellyWeights(geo, belly);
    const m = (Array.isArray(o.material) ? o.material : [o.material]).map((mt) => {
      const c = mt.clone();
      // Soften the look a touch: generated PBR textures can come out very matte or metallic.
      if ('metalness' in c) c.metalness = Math.min(c.metalness ?? 0, 0.05);
      if ('roughness' in c) c.roughness = Math.min(Math.max(c.roughness ?? 0.5, 0.35), 0.7);
      bendShader(c, uniforms, !!belly);
      return c;
    });
    body.add(new THREE.Mesh(geo, Array.isArray(o.material) ? m : m[0]));
  });

  const dummy = () => {
    const g = new THREE.Group();
    g.visible = false;
    return g;
  };
  const p = { name: kind, height: target, gait: kind === 'naidan' || kind === 'laoshu' ? 'hop' : 'waddle', body, eyes: [], mouthOpen: dummy(), mouthClosed: dummy(), glb: true, uniforms };
  p.kind = kind;
  p.squash = group(p.body);
  p.root = group(p.squash);
  p.rest = new Map();
  return p;
}

/**
 * Injects the head bend (twist / nod / tilt above uNeck) into a standard material, and
 * optionally the belly patch (aBelly weights mixed towards uBelly).
 */
function bendShader(material, uniforms, belly = false) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const fn = /* glsl */ `
      uniform float uTwist; uniform float uNod; uniform float uTilt; uniform float uNeck; uniform float uTop;
      vec3 petBend(vec3 p, float w) {
        float a = uTwist * w;
        p.xz = mat2(cos(a), sin(a), -sin(a), cos(a)) * p.xz;
        float b = uNod * w;
        vec2 yz = vec2(p.y - uNeck, p.z);
        yz = mat2(cos(b), sin(b), -sin(b), cos(b)) * yz;
        p.y = yz.x + uNeck; p.z = yz.y;
        float c = uTilt * w;
        vec2 xy = vec2(p.x, p.y - uNeck);
        xy = mat2(cos(c), sin(c), -sin(c), cos(c)) * xy;
        p.x = xy.x; p.y = xy.y + uNeck;
        return p;
      }`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${fn}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float petW = smoothstep(uNeck, uTop, position.y);
        objectNormal = normalize(petBend(objectNormal + vec3(0.0, uNeck, 0.0), petW) - vec3(0.0, uNeck, 0.0));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed = petBend(transformed, petW);`);
    if (belly) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aBelly;\nvarying float vBelly;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBelly = aBelly;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uBelly;\nvarying float vBelly;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uBelly, vBelly);');
    }
  };
  material.customProgramCacheKey = () => (belly ? 'petBend+belly' : 'petBend');
}

/** Studio lighting that flatters the soft vinyl/clay look. */
export function addLights(scene) {
  scene.add(new THREE.HemisphereLight('#fff7e6', '#a58f6c', 1.5));
  const key = new THREE.DirectionalLight('#ffffff', 2.3);
  key.position.set(3, 5, 6);
  const rim = new THREE.DirectionalLight('#ffe2a8', 1.6);
  rim.position.set(-4, 3.5, -4);
  const fill = new THREE.DirectionalLight('#dfe9ff', 0.55);
  fill.position.set(-4, 1, 5);
  scene.add(key, rim, fill);
}

/** A soft round contact shadow texture. */
export function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export { THREE };
