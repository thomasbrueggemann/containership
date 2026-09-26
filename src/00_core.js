// ============================================================================
// 00 — CORE: imports, helpers, renderer, shared state
// ============================================================================
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const DEG = Math.PI / 180, KN = 0.514444, NM = 1852;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const wrap360 = (d) => ((d % 360) + 360) % 360;
const wrap180 = (d) => ((d + 540) % 360) - 180;
const $ = (id) => document.getElementById(id);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '--');
const pad = (n, w = 3) => String(Math.round(n)).padStart(w, '0');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let _rng = mulberry32(1911);
const rand = () => _rng();
const rr = (a, b) => a + (b - a) * _rng();
const ri = (a, b) => Math.floor(rr(a, b + 1));
const pick = (arr) => arr[Math.floor(_rng() * arr.length)];
const reseed = (s) => { _rng = mulberry32(s); };

// value noise (2D) for textures & terrain
const _perm = new Uint8Array(512);
{ const r = mulberry32(77); const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) _perm[i] = p[i & 255]; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (i, j) => _perm[(_perm[(xi + i) & 255] + yi + j) & 255] / 255;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(h(0, 0), h(1, 0), u), lerp(h(0, 1), h(1, 1), u), v);
}
function fbm(x, y, oct = 4) { let a = 0.5, s = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }

// position → lat/lon (fictional port on the North Sea coast)
const LAT0 = 51 + 58.2 / 60, LON0 = 3 + 59.5 / 60;
function toLatLon(x, z) { return [LAT0 + (-z) / NM / 60, LON0 + x / (NM * 60 * Math.cos(LAT0 * DEG))]; }
function fmtLat(l) { const d = Math.floor(l), m = (l - d) * 60; return `${d}°${m.toFixed(3).padStart(6, '0')}'N`; }
function fmtLon(l) { const d = Math.floor(l), m = (l - d) * 60; return `${String(d).padStart(3, '0')}°${m.toFixed(3).padStart(6, '0')}'E`; }

// ---------------------------------------------------------------- settings
const CFG = { tod: 'morning', wind: 'moderate', sea: 'moderate', traffic: 'on', assist: 'on', voice: 'on', quality: 'high' };
// Sea state (Douglas scale): wave slope amplitude, whitecaps, own-ship swell response, small-craft motion
const SEA_STATES = {
  // waveA: amplitude [m] of the leading swell train (Hs ≈ 4.2 × waveA: ~0.2 / 0.6 / 1.6 / 5.5 m)
  calm: { label: 'Calm (1)', sea: 0.32, caps: 0.0, swell: 0.35, bob: 0.35, waveA: 0.05 },
  slight: { label: 'Slight (3)', sea: 0.58, caps: 0.12, swell: 0.9, bob: 0.8, waveA: 0.15 },
  moderate: { label: 'Moderate (4)', sea: 0.82, caps: 0.45, swell: 1.5, bob: 1.2, waveA: 0.38 },
  rough: { label: 'Rough (5–6)', sea: 1.25, caps: 1.0, swell: 3.2, bob: 2.2, waveA: 1.3 },
};
const seaState = () => SEA_STATES[CFG.sea] || SEA_STATES.moderate;

// ---------------------------------------------------------------- shared state
const G = {
  simT: 0, realT: 0, timeScale: 1, paused: true, running: false, started: false,
  mode: 'bridge',            // bridge | orbit
  ship: null,                // ShipPhysics
  shipGroup: null, bridgeGroup: null,
  steering: 'AUTO',          // AUTO | HAND | NFU
  apHeading: 90, apRudderLimit: 15, apRot: 20,
  helmOrder: 0,              // ordered rudder in hand steering
  whistle: false,
  navLights: false, deckLights: false,
  wipers: false,
  vhfCh: 16,
  radarRange: [3, 6], ecdisRange: 1.5, ecdisRange2: 3,
  interactables: [],
  flags: {},                 // scenario flags
  events: [],
  score: { penalties: [], bonuses: [] },
  splitEngines: false,
  bellBook: [],
};
const START_TIME = { morning: 7 * 3600 + 40 * 60, golden: 19 * 3600 + 5 * 60, night: 23 * 3600 + 20 * 60 };

// ---------------------------------------------------------------- renderer
let renderer, scene, camera, clock;
function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  const pr = CFG.quality === 'high' ? Math.min(devicePixelRatio, 2) : CFG.quality === 'medium' ? Math.min(devicePixelRatio, 1.4) : 1;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = CFG.quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('app').appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.08, 90000);
  camera.rotation.order = 'YXZ';
  clock = new THREE.Clock();
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  });
}

// ---------------------------------------------------------------- geometry helpers
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v3 = new THREE.Vector3(), _s3 = new THREE.Vector3();
function MX(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.clone(), new THREE.Vector3(sx, sy, sz));
}

// Merges many static primitives into one mesh per material (few draw calls).
class Batcher {
  constructor() { this.map = new Map(); }
  add(geo, mat, matrix) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.clearGroups();
    if (matrix) g.applyMatrix4(matrix);
    let a = this.map.get(mat); if (!a) { a = []; this.map.set(mat, a); }
    a.push(g);
    return this;
  }
  box(mat, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) { return this.add(BOX(w, h, d), mat, MX(x, y, z, rx, ry, rz)); }
  // box whose bottom sits at y
  boxB(mat, w, h, d, x, y, z, ry = 0) { return this.add(BOX(w, h, d), mat, MX(x, y + h / 2, z, 0, ry, 0)); }
  cyl(mat, rt, rb, h, x, y, z, seg = 12, rx = 0, ry = 0, rz = 0) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, MX(x, y, z, rx, ry, rz)); }
  // beam between two points
  beam(mat, a, b, w, h = w) {
    const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length();
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
    return this.add(BOX(w, len, h), mat, m);
  }
  build(parent, opts = {}) {
    const out = [];
    for (const [mat, list] of this.map) {
      if (!list.length) continue;
      // chunk to keep index sizes sane
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = !!opts.cast; mesh.receiveShadow = !!opts.receive;
      mesh.matrixAutoUpdate = opts.dynamic ? true : false; mesh.updateMatrix();
      parent.add(mesh); out.push(mesh);
    }
    this.map.clear();
    return out;
  }
}
const _boxCache = new Map();
function BOX(w, h, d) {
  const k = w + '|' + h + '|' + d; let g = _boxCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); _boxCache.set(k, g); }
  return g;
}

// ---------------------------------------------------------------- canvas helpers
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTexture(canvas, opts = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 8;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
  if (opts.nearest) { t.magFilter = THREE.NearestFilter; }
  return t;
}
function labelTexture(text, o = {}) {
  const w = o.w || 256, h = o.h || 64;
  const c = makeCanvas(w, h), x = c.getContext('2d');
  x.fillStyle = o.bg || '#1b2229'; x.fillRect(0, 0, w, h);
  if (o.border) { x.strokeStyle = o.border; x.lineWidth = 4; x.strokeRect(2, 2, w - 4, h - 4); }
  x.fillStyle = o.color || '#e6eef3';
  x.font = `${o.weight || 700} ${o.size || Math.floor(h * 0.42)}px ${o.font || 'Inter, system-ui, sans-serif'}`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const lines = String(text).split('\n');
  const lh = (o.size || Math.floor(h * 0.42)) * 1.1;
  lines.forEach((ln, i) => x.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh));
  return canvasTexture(c);
}
function glowTexture(color = '255,255,255') {
  const c = makeCanvas(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, `rgba(${color},1)`); g.addColorStop(0.12, `rgba(${color},.85)`);
  g.addColorStop(0.35, `rgba(${color},.22)`); g.addColorStop(1, `rgba(${color},0)`);
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return canvasTexture(c);
}
