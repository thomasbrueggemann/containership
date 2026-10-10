// ============================================================================
// 09b — HUMAN BODY: proportions, procedural clothing and skin shells, rig
// ============================================================================
// Every person is a handful of skinned meshes (skin, shirt, trousers, shoes, trim, …) that share one skeleton. The shells are
// lofted from elliptical / superelliptical rings (so shoulders, waist, seat, thighs and calves have real sections), pushed
// around by a few anatomical bumps, and weighted to the bones with smooth blends across the joints so elbows, knees, hips and
// the waist bend like cloth over a body instead of two tubes and a ball. Texture coordinates run per garment through a UV
// rectangle (see 09b_cloth.js: the same rectangles are painted there); vertex colours carry baked ambient occlusion.
//
// Frame (bind pose, metres): x to the person's right (starboard when facing forward), y up from the floor, z to the BACK (the
// person faces -z). Left/right pairs are index 0 = left (x < 0), 1 = right (x > 0). Parts are built for the right side and
// mirrored.
// ============================================================================
const HB = {                                  // bone indices (left / right pairs: [left, right])
  hips: 0, torso: 1, chest: 2, neck: 3, head: 4,
  clav: [5, 9], sh: [6, 10], el: [7, 11], wr: [8, 12],
  hp: [13, 17], kn: [14, 18], ank: [15, 19], toe: [16, 20], fa: [21, 22],      // fa: forearm twist (pronation is spread over the forearm)
  COUNT: 23,
};
const humMirrorBone = (b) => (b >= 21 ? 43 - b : b >= 5 && b <= 8 ? b + 4 : b >= 9 && b <= 12 ? b - 4 : b >= 13 && b <= 16 ? b + 4 : b >= 17 ? b - 4 : b);
const humSS = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };   // smoothstep (a > b reverses it)
const humMix = (a, b, t) => a + (b - a) * t;
const humSgnPow = (v, e) => (v < 0 ? -1 : 1) * Math.abs(v) ** e;
const humW = (...a) => a;                                    // bone weights: (bone, weight, bone, weight, …)

// Catmull-Rom style interpolation of a table of rows [x, a, b, c, …] at x (rows sorted by x): returns the interpolated columns
function humRows(rows, x) {
  const n = rows.length, nc = rows[0].length, out = new Array(nc - 1);
  if (x <= rows[0][0]) { for (let c = 1; c < nc; c++) out[c - 1] = rows[0][c]; return out; }
  if (x >= rows[n - 1][0]) { for (let c = 1; c < nc; c++) out[c - 1] = rows[n - 1][c]; return out; }
  let i = 0; while (i < n - 2 && x > rows[i + 1][0]) i++;
  const r0 = rows[Math.max(0, i - 1)], r1 = rows[i], r2 = rows[i + 1], r3 = rows[Math.min(n - 1, i + 2)];
  const h = r2[0] - r1[0], t = (x - r1[0]) / h, t2 = t * t, t3 = t2 * t;
  for (let c = 1; c < nc; c++) {
    const m1 = (r2[c] - r0[c]) / Math.max(1e-6, r2[0] - r0[0]) * h, m2 = (r3[c] - r1[c]) / Math.max(1e-6, r3[0] - r1[0]) * h;
    out[c - 1] = (2 * t3 - 3 * t2 + 1) * r1[c] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * r2[c] + (t3 - t2) * m2;
  }
  return out;
}

// ------------------------------------------------------------------ proportions
// Every length the body, the rig and the walking code need, for one person. A "standard" man is 1.78 m, a woman 1.67 m.
function humProportions(o) {
  const F = !!o.female, H = o.height || (F ? 1.67 : 1.78), sc = H / 1.78;
  const legK = o.legLen || 1, build = { lean: 0.92, average: 1, stocky: 1.1, heavy: 1.18 }[o.build || 'average'] || 1;
  const P = { F, H, sc, o };
  P.thigh = 0.43 * sc * legK; P.shin = 0.415 * sc * legK;
  P.ankleH = 0.081 * sc;                                    // ankle joint centre above the floor
  P.hipH = P.thigh + P.shin + P.ankleH;                     // hip joint (and pelvis pivot) height
  P.hipX = (F ? 0.093 : 0.088) * sc * (o.hips || 1);        // hip joint x offset
  P.spineY = 0.08 * sc; P.chestY = 0.28 * sc;               // bone heights above the hip line
  P.neckY = 0.575 * sc;                                     // neck base (C7)
  P.eyeY = P.hipH + 0.746 * sc * (o.legLen ? 1 : 1);        // eye line above the floor
  P.shX = (F ? 0.168 : 0.186) * sc * (o.shoulder || 1);     // glenohumeral joint x offset
  P.shY = 0.468 * sc;                                       // …and its height above the hip line
  P.upper = 0.305 * sc; P.fore = 0.265 * sc;                // upper arm, forearm (joint to joint)
  P.hand = 0.185 * sc * (F ? 0.93 : 1);                     // wrist to fingertip
  P.bw = build * (o.width || 1); P.bd = (0.5 + build / 2) * (o.depth || 1); P.belly = o.belly || 0; P.shoulderK = o.shoulder || 1;
  P.armK = (o.arm || 1) * (0.55 + build * 0.45); P.legK = (o.leg || 1) * (0.55 + build * 0.45);
  const fs = (F ? 0.9 : 1) * sc * (o.foot || 1);            // foot: heel contact, ball of the foot, toe tip (z relative to the ankle; forward is -z)
  P.foot = { fs, heel: 0.068 * fs, ball: -0.138 * fs, tip: -0.218 * fs, w: 0.052 * fs };
  return P;
}

// ------------------------------------------------------------------ mesh accumulator
class HumAcc {
  constructor(name) { this.name = name; this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.si = []; this.sw = []; this.idx = []; this.n = 0; }
  // one vertex: position, normal, uv, colour (rgb multiplier), up to four bones with weights (kept, normalised)
  v(p, nr, uv, c, bw) {
    this.pos.push(p[0], p[1], p[2]); this.nrm.push(nr[0], nr[1], nr[2]); this.uv.push(uv[0], uv[1]); this.col.push(c[0], c[1], c[2]);
    const pairs = []; for (let k = 0; k < bw.length; k += 2) if (bw[k + 1] > 1e-4) pairs.push([bw[k], bw[k + 1]]);
    if (!pairs.length) pairs.push([0, 1]);
    pairs.sort((a, b) => b[1] - a[1]);
    let t = 0; for (let k = 0; k < 4; k++) t += pairs[k] ? pairs[k][1] : 0;
    for (let k = 0; k < 4; k++) { this.si.push(pairs[k] ? pairs[k][0] : 0); this.sw.push(pairs[k] ? pairs[k][1] / t : 0); }
    return this.n++;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  // append another accumulator mirrored about x = 0 (right → left): positions, normals, bones swapped, winding reversed
  addMirrored(o) {
    const base = this.n;
    for (let i = 0; i < o.n; i++) {
      this.pos.push(-o.pos[3 * i], o.pos[3 * i + 1], o.pos[3 * i + 2]); this.nrm.push(-o.nrm[3 * i], o.nrm[3 * i + 1], o.nrm[3 * i + 2]);
      this.uv.push(o.uv[2 * i], o.uv[2 * i + 1]); this.col.push(o.col[3 * i], o.col[3 * i + 1], o.col[3 * i + 2]);
      for (let k = 0; k < 4; k++) { this.si.push(o.sw[4 * i + k] > 0 ? humMirrorBone(o.si[4 * i + k]) : 0); this.sw.push(o.sw[4 * i + k]); }
    }
    for (let i = 0; i < o.idx.length; i += 3) this.idx.push(base + o.idx[i], base + o.idx[i + 2], base + o.idx[i + 1]);
    this.n += o.n;
  }
  addAcc(o) { const base = this.n; for (const k of ['pos', 'nrm', 'uv', 'col', 'si', 'sw']) for (const x of o[k]) this[k].push(x); for (const i of o.idx) this.idx.push(base + i); this.n += o.n; }
  geometry(sphere) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx); g.computeBoundingBox();
    g.boundingSphere = sphere || new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 0.78);
    return g;
  }
}

// ------------------------------------------------------------------ lofting
// A ring: the points of a superellipse (exponent n) in the plane spanned by the unit vectors A (width) and B (depth) around centre c;
// the depth radius is rbF on the -B side of the B axis and rbB on the +B side (a body section is deeper at the back than at the front).
function humRing(c, A, B, ra, rbF, rbB, n, seg, out) {
  const e = 2 / n;
  for (let k = 0; k <= seg; k++) {
    const a = (k % seg) / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const x = ra * humSgnPow(ca, e), z = (sa < 0 ? rbF : rbB) * humSgnPow(sa, e);
    out.push(c[0] + A[0] * x + B[0] * z, c[1] + A[1] * x + B[1] * z, c[2] + A[2] * x + B[2] * z);
  }
  return out;
}
const HUM_X = [1, 0, 0], HUM_Y = [0, 1, 0], HUM_Z = [0, 0, 1];

// Grid surface from rings (each an array of (seg + 1) * 3 numbers with the seam duplicated) into acc.
//   o.uv(r, k) → [u, v]; o.col(p, n, r, k) → [r, g, b]; o.w(p, r, k) → humW(...); returns { first, rows, seg }
function humLoft(acc, rings, seg, o) {
  const R = rings.length, W = seg + 1;
  const P = (r, k) => [rings[r][k * 3], rings[r][k * 3 + 1], rings[r][k * 3 + 2]];
  const centre = rings.map((ring) => { let x = 0, y = 0, z = 0; for (let k = 0; k < seg; k++) { x += ring[k * 3]; y += ring[k * 3 + 1]; z += ring[k * 3 + 2]; } return [x / seg, y / seg, z / seg]; });
  const raw = (r, k) => {
    const a = P(r, o.open ? Math.min(seg, k + 1) : (k + 1) % seg), b = P(r, o.open ? Math.max(0, k - 1) : (k - 1 + seg) % seg), c = P(Math.min(R - 1, r + 1), k), d = P(Math.max(0, r - 1), k);
    const tk = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], tr = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
    return [tk[1] * tr[2] - tk[2] * tr[1], tk[2] * tr[0] - tk[0] * tr[2], tk[0] * tr[1] - tk[1] * tr[0]];
  };
  // sign: make the normal point away from the ring centre (checked on the middle ring)
  let sign = o.flip || 0;
  if (!sign) {
    const r = Math.max(1, Math.min(R - 2, R >> 1)); let s = 0;
    for (let k = 0; k < seg; k += Math.max(1, seg >> 3)) { const n = raw(r, k), p = P(r, k); s += n[0] * (p[0] - centre[r][0]) + n[1] * (p[1] - centre[r][1]) + n[2] * (p[2] - centre[r][2]); }
    sign = s >= 0 ? 1 : -1;
  }
  const first = acc.n;
  for (let r = 0; r < R; r++) for (let k = 0; k < W; k++) {
    const p = P(r, k); let n = raw(r, k), l = Math.hypot(n[0], n[1], n[2]);
    if (l > 1e-10) n = [n[0] / l * sign, n[1] / l * sign, n[2] / l * sign];
    else {
      // degenerate (a pole, or rings collapsed onto each other): one-sided differences along the loft, else the direction away from the previous ring, else radial
      const a = P(r, o.open ? Math.min(seg, k + 1) : (k + 1) % seg), b = P(r, o.open ? Math.max(0, k - 1) : (k - 1 + seg) % seg), tk = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      let done = false;
      for (const rr of [r + 1, r - 1, r + 2, r - 2]) {
        if (rr < 0 || rr >= R) continue; const q = P(rr, k), tr = [(q[0] - p[0]) * (rr > r ? 1 : -1), (q[1] - p[1]) * (rr > r ? 1 : -1), (q[2] - p[2]) * (rr > r ? 1 : -1)];
        const m = [tk[1] * tr[2] - tk[2] * tr[1], tk[2] * tr[0] - tk[0] * tr[2], tk[0] * tr[1] - tk[1] * tr[0]], ml = Math.hypot(m[0], m[1], m[2]);
        if (ml > 1e-10) { n = [m[0] / ml * sign, m[1] / ml * sign, m[2] / ml * sign]; done = true; break; }
      }
      if (!done) {
        const q = P(r > 0 ? r - 1 : Math.min(R - 1, 1), k), dd = [p[0] - q[0], p[1] - q[1], p[2] - q[2]], dl = Math.hypot(dd[0], dd[1], dd[2]);
        if (dl > 1e-9) { const sg = r > 0 ? 1 : -1; n = [dd[0] / dl * sg, dd[1] / dl * sg, dd[2] / dl * sg]; }
        else { const rx = p[0] - centre[r][0], rz = p[2] - centre[r][2], rl = Math.hypot(rx, rz) || 1; n = [rx / rl, 0, rz / rl]; }
      }
    }
    acc.v(p, n, o.uv(r, k), o.col ? o.col(p, n, r, k) : [1, 1, 1], o.w(p, r, k));
  }
  for (let r = 0; r < R - 1; r++) for (let k = 0; k < seg; k++) {
    const a = first + r * W + k, b = a + 1, d = first + (r + 1) * W + k, c = d + 1;
    if (sign > 0) { acc.tri(a, b, d); acc.tri(b, c, d); } else { acc.tri(a, d, b); acc.tri(b, d, c); }
  }
  return { first, rows: R, seg, centre };
}

// darkening by a list of [cx, cy, cz, radius, strength] dimples (baked ambient occlusion)
function humAO(p, list, base = 1) {
  let a = base;
  for (const [cx, cy, cz, r, s] of list) { const d = Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz); if (d < r) a -= s * (1 - humSS(0, r, d)); }
  return Math.max(0.4, a);
}

// UV rectangles [u0, v0, du, dv] inside a garment atlas (09b_cloth.js paints the same layout)
const HUV = {
  shirtTorso: [0, 0, 1, 0.52], shirtSleeve: [0, 0.52, 0.34, 0.48], shirtMisc: [0.34, 0.52, 0.66, 0.48],
  trPelvis: [0, 0, 1, 0.22], trLeg: [0, 0.22, 0.5, 0.78], trMisc: [0.5, 0.22, 0.5, 0.78],
};
const humUV = (rect, u, v) => [rect[0] + rect[2] * u, 1 - (rect[1] + rect[3] * v)];        // rects are in canvas coordinates (v down); the texture is flipY

// ------------------------------------------------------------------ torso
// Rows [y above the hip line, half width, front depth, back depth, exponent] for the shirt layer (≈1 cm ease on the body)
const HUM_TORSO_M = [
  [0.00, 0.168, 0.112, 0.122, 2.6], [0.10, 0.160, 0.108, 0.116, 2.6], [0.18, 0.156, 0.104, 0.112, 2.5], [0.26, 0.162, 0.108, 0.112, 2.5],
  [0.34, 0.172, 0.118, 0.114, 2.5], [0.40, 0.178, 0.124, 0.116, 2.5], [0.455, 0.182, 0.118, 0.116, 2.4], [0.495, 0.190, 0.106, 0.110, 2.3],
  [0.518, 0.186, 0.094, 0.102, 2.2], [0.538, 0.158, 0.084, 0.092, 2.1], [0.558, 0.118, 0.074, 0.084, 2.0], [0.576, 0.086, 0.066, 0.082, 2.0], [0.590, 0.072, 0.060, 0.076, 2.0], [0.602, 0.069, 0.058, 0.072, 2.0], [0.62, 0.068, 0.057, 0.071, 2.0],
];
const HUM_TORSO_F = [
  [0.00, 0.164, 0.104, 0.122, 2.7], [0.10, 0.146, 0.098, 0.110, 2.6], [0.18, 0.132, 0.092, 0.100, 2.5], [0.26, 0.140, 0.100, 0.100, 2.5],
  [0.34, 0.152, 0.116, 0.102, 2.4], [0.40, 0.158, 0.126, 0.104, 2.4], [0.455, 0.160, 0.112, 0.104, 2.4], [0.495, 0.168, 0.096, 0.098, 2.3],
  [0.518, 0.164, 0.084, 0.092, 2.2], [0.538, 0.138, 0.076, 0.084, 2.1], [0.558, 0.106, 0.068, 0.078, 2.0], [0.576, 0.082, 0.066, 0.076, 2.0], [0.590, 0.068, 0.060, 0.068, 2.0], [0.602, 0.066, 0.058, 0.066, 2.0], [0.62, 0.065, 0.057, 0.065, 2.0],
];

// The shirt section [w, df, db, n] at height y (above the hip line, metres, bind pose) with the person's build applied
function humTorsoRow(P, y) {
  const sc = P.sc, yn = y / sc;
  let [w, df, db, n] = humRows(P.F ? HUM_TORSO_F : HUM_TORSO_M, yn);
  const sh = humMix(1, P.shoulderK, humSS(0.34, 0.47, yn) * (1 - humSS(0.53, 0.60, yn)));
  w *= P.bw * sh * sc; df *= P.bd * sc; db *= P.bd * sc;
  const belly = P.belly * Math.exp(-(((yn - 0.17) / 0.12) ** 2));
  df += belly * 0.075 * sc; w += belly * 0.02 * sc;
  return [w, df, db, n];
}

// anatomical bumps (centre on the right side; mirrored): [x, y, z, sigma x, y, z, amplitude along the horizontal normal]
function humBumps(P) {
  const s = P.sc;
  if (P.F) return [[0.058 * s, 0.388 * s, -0.098 * s, 0.05 * s, 0.05 * s, 0.05 * s, 0.03 * s], [0.07 * s, 0.40 * s, 0.10 * s, 0.07 * s, 0.07 * s, 0.05 * s, 0.006],
    [0.09 * s, -0.01 * s, 0.12 * s, 0.07 * s, 0.07 * s, 0.05 * s, 0.01 * s]];
  return [[0.082 * s, 0.395 * s, -0.112 * s, 0.065 * s, 0.05 * s, 0.05 * s, 0.011 * s], [0.08 * s, 0.41 * s, 0.10 * s, 0.07 * s, 0.07 * s, 0.05 * s, 0.007],
    [0.09 * s, -0.01 * s, 0.12 * s, 0.07 * s, 0.07 * s, 0.05 * s, 0.01 * s]];
}

// A point on the shirt surface: height y above the hip line, angle a (0 = right side, +π/2 = back, -π/2 = front), off along the normal
function humTorsoPoint(P, y, a, off = 0, bumps = true) {
  const [w, df, db, n] = humTorsoRow(P, y), e = 2 / n, ca = Math.cos(a), sa = Math.sin(a), d = sa < 0 ? df : db;
  let x = w * humSgnPow(ca, e), z = d * humSgnPow(sa, e);
  let push = off;
  if (bumps) for (const [bx, by, bz, sx, sy, sz, amp] of humBumps(P)) for (const sg of [-1, 1]) { const dx = (x - sg * bx) / sx, dy = (y - by) / sy, dz = (z - bz) / sz; push += amp * Math.exp(-(dx * dx + dy * dy + dz * dz) / 2); }
  const nx = x / (w * w), nz = z / (d * d), nl = Math.hypot(nx, nz) || 1;      // horizontal outward normal of the section
  return [x + nx / nl * push, y, z + nz / nl * push];
}

// Torso weights: pelvis → spine blend through the waist, chest bone (breathing) over the ribs
function humTorsoW(P, y) {
  const s = P.sc, wh = 1 - humSS(0.05 * s, 0.21 * s, y), chest = humSS(0.26 * s, 0.34 * s, y) * (1 - humSS(0.46 * s, 0.53 * s, y));
  return humW(HB.hips, wh, HB.torso, (1 - wh) * (1 - chest), HB.chest, (1 - wh) * chest);
}

// the neckline: height above the hip line at which the cloth ends, at angle a (a V at the front for an open collar)
function humNeckY(P, a) {
  const o = P.o, vOpen = (o.vOpen !== undefined ? o.vOpen : o.coverall ? 0.02 : P.F ? 0.026 : 0.034) * P.sc;
  const d = Math.atan2(Math.sin(a - 1.5 * Math.PI), Math.cos(a - 1.5 * Math.PI));
  return 0.611 * P.sc - vOpen * Math.exp(-((d / 0.42) ** 2));
}

function humBuildShirtTorso(P, o, acc) {
  const seg = o.lod === 'low' ? 14 : 26;
  const ys = [0.035, 0.085, 0.13, 0.17, 0.21, 0.25, 0.29, 0.33, 0.365, 0.395, 0.425, 0.452, 0.478, 0.502, 0.523, 0.542, 0.558, 0.573, 0.587, 0.599, 0.611].map((y) => y * P.sc);
  const rings = ys.map((y) => { const ring = []; for (let k = 0; k <= seg; k++) { const a = (k % seg) / seg * Math.PI * 2, p = humTorsoPoint(P, y, a); ring.push(p[0], P.hipH + Math.min(y, humNeckY(P, a)), p[2]); } return ring; });
  const top = ys[ys.length - 1], bot = ys[0], R = HUV.shirtTorso, s = P.sc, hy = P.hipH;
  const ao = [[0, hy + 0.575 * s, -0.062, 0.07, 0.3], [P.shX * 0.92, hy + 0.43 * s, 0.01, 0.07, 0.4], [-P.shX * 0.92, hy + 0.43 * s, 0.01, 0.07, 0.4], [0, hy + 0.11 * s, -0.11, 0.09, 0.12]];
  return humLoft(acc, rings, seg, {
    uv: (r, k) => humUV(R, k / seg, 1 - (ys[r] - bot) / (top - bot)),
    col: (p) => { const g = humAO(p, ao); return [g, g, g]; },
    w: (p, r) => humTorsoW(P, ys[r]),
  });
}

// The collar: a stand band round the neck, open in front, rolled over at the top edge; it follows the neckline
function humBuildCollar(P, o, acc) {
  const seg = o.lod === 'low' ? 12 : 22, sc = P.sc, hy = P.hipH, R = HUV.shirtMisc, gap = o.coverall ? 0.12 : 0.2;
  const aStart = 1.5 * Math.PI + gap, aSpan = 2 * Math.PI - 2 * gap;
  const spec = [[0, 0.0, 0.0028, 0], [1, 0.35, 0.0042, 0], [1, 0.75, 0.0054, 0], [1, 1.0, 0.0050, 0], [2, 0, 0.0032, 0.0009], [2, 0, 0.0010, -0.0011], [2, 0, 0.0007, -0.0125]];
  const rings = spec.map(([mode, t, off, dy]) => {
    const ring = [];
    for (let k = 0; k <= seg; k++) {
      const a = aStart + aSpan * k / seg, yn = humNeckY(P, a), yb = yn - 0.016 * sc, yt = yn + 0.013 * sc * (0.55 + 0.45 * Math.cos(0.5 * (a - 0.5 * Math.PI) * 0)),
        y = mode === 0 ? yb : mode === 1 ? yb + (yt - yb) * t : yt + dy * sc;
      const p = humTorsoPoint(P, y, a, off, false); ring.push(p[0], hy + y, p[2]);
    }
    return ring;
  });
  humLoft(acc, rings, seg, {
    open: true,
    uv: (r, k) => humUV(R, 0.05 + 0.5 * k / seg, 0.1 + 0.1 * r),
    col: (p, n, r) => { const g = r >= 5 ? 0.82 : 1; return [g, g, g]; },
    w: () => humW(HB.torso, 1),
  });
}

// ------------------------------------------------------------------ sleeves (right arm; the shoulder joint is the origin of the rows)
// rows [s along the arm from the shoulder joint, half width, half depth]
const HUM_ARM_ROWS = [
  [0.00, 0.052, 0.055], [0.04, 0.0525, 0.0555], [0.10, 0.0510, 0.0540], [0.17, 0.0485, 0.0515], [0.24, 0.0455, 0.0485], [0.285, 0.0435, 0.0465], [0.305, 0.043, 0.046],
  [0.325, 0.0440, 0.0465], [0.36, 0.043, 0.044], [0.42, 0.040, 0.040], [0.48, 0.0375, 0.0365], [0.53, 0.0355, 0.0345], [0.57, 0.0355, 0.0345],
];
function humArmRow(P, s) { const r = humRows(HUM_ARM_ROWS, s / P.sc); return [r[0] * P.armK * P.sc * (P.F ? 0.92 : 1), r[1] * P.armK * P.sc * (P.F ? 0.92 : 1)]; }

// weights along the arm: shoulder → elbow → wrist, plus the shoulder cap following the clavicle a little
function humArmW(P, s, side = 1) {
  const el = P.upper, fo = P.fore, sc = P.sc;
  const t1 = humSS(el - 0.065 * sc, el + 0.065 * sc, s), t2 = humSS(el + 0.06 * sc, el + 0.2 * sc, s), t3 = humSS(el + fo - 0.12 * sc, el + fo - 0.01 * sc, s);
  const cap = humSS(0.0, -0.07 * sc, s) * 0.4;                            // top of the cap: partly with the shoulder girdle
  return humW(HB.sh[side], (1 - t1) * (1 - cap), HB.clav[side], (1 - t1) * cap, HB.el[side], t1 * (1 - t2), HB.fa[side], t1 * t2 * (1 - t3), HB.wr[side], t1 * t2 * t3);
}

// kind: 'long' (to the wrist, with a cuff), 'short' (to mid upper arm), 'coverall'
function humBuildSleeve(P, o, acc, kind) {
  const seg = o.lod === 'low' ? 10 : 14, sc = P.sc, cx = P.shX, cy = P.hipH + P.shY, capH = 0.05 * sc;
  const end = kind === 'short' ? 0.15 * sc : kind === 'rolled' ? 0.30 * sc : 0.575 * sc;
  // stations: the cap (a quarter ellipsoid), then the rows (denser around the elbow)
  const ss = []; for (const a of [90, 72, 52, 32, 14]) ss.push(-capH * Math.sin(a * Math.PI / 180));
  const base = [0, 0.04, 0.10, 0.17, 0.24, 0.275, 0.305, 0.335, 0.37, 0.42, 0.48, 0.53, 0.56, 0.575].map((s) => s * sc).filter((s) => s < end - 0.003);
  const stations = ss.concat(base, [end]);
  const rings = stations.map((s) => {
    const [rx, rz] = humArmRow(P, Math.max(0, s)); let k = 1;
    if (s < 0) k = Math.cos(Math.asin(Math.min(1, -s / capH)));
    const ease = kind === 'long' && s > end - 0.04 * sc ? 1 : 1;
    return humRing([cx, cy - s, 0.002 * sc], HUM_X, HUM_Z, rx * k * ease, rz * k, rz * k, 2.0, seg, []);
  });
  const R = HUV.shirtSleeve, sEnd = end, ao = [[cx - 0.05, cy - 0.02, 0, 0.05, 0.3]];
  humLoft(acc, rings, seg, {
    uv: (r, k) => humUV(R, k / seg, Math.max(0, stations[r]) / (0.575 * sc)),
    col: (p) => { const g = humAO(p, ao); return [g, g, g]; },
    w: (p, r) => humArmW(P, stations[r], 1),
  });
}

// The bare arm below a short or rolled sleeve (skin): rows [s from the shoulder joint, half width (x, the thickness), half depth (z, the width)]
const HUM_SKINARM_ROWS = [
  [0.00, 0.040, 0.043], [0.15, 0.0405, 0.0435], [0.24, 0.037, 0.040], [0.305, 0.0355, 0.0385], [0.35, 0.038, 0.0415], [0.42, 0.0335, 0.039], [0.49, 0.027, 0.035], [0.54, 0.0215, 0.031], [0.575, 0.0188, 0.0288], [0.60, 0.0185, 0.0286],
];
function humBuildSkinArm(P, o, acc, from) {
  const seg = o.lod === 'low' ? 8 : 12, sc = P.sc, cx = P.shX, cy = P.hipH + P.shY, k = P.armK * (P.F ? 0.92 : 1) * sc;
  const ss = [0.15, 0.2, 0.25, 0.285, 0.305, 0.325, 0.36, 0.42, 0.48, 0.53, 0.56, 0.585].map((s) => s * sc).filter((s) => s >= from - 1e-6);
  const rings = ss.map((s) => { const r = humRows(HUM_SKINARM_ROWS, s / sc); return humRing([cx, cy - s, 0.002 * sc], HUM_X, HUM_Z, r[0] * k, r[1] * k, r[1] * k, 2.2, seg, []); });
  const len = 0.6 * sc;
  humLoft(acc, rings, seg, { uv: (r, kk) => [kk / seg * 0.5, ss[r] / len], col: () => [1, 1, 1], w: (p, r) => humArmW(P, ss[r], 1) });
}

// ------------------------------------------------------------------ trousers (pelvis shell + legs)
// rows [s below the hip joint, half width, half depth, z centre]
const HUM_LEG_ROWS = [
  [-0.03, 0.090, 0.100, 0.005], [0.00, 0.094, 0.106, 0.005], [0.06, 0.094, 0.104, 0.002], [0.14, 0.088, 0.096, -0.002], [0.24, 0.078, 0.086, -0.004],
  [0.34, 0.068, 0.076, -0.006], [0.40, 0.063, 0.070, -0.008], [0.43, 0.062, 0.068, -0.010], [0.47, 0.062, 0.068, -0.006], [0.54, 0.063, 0.070, 0.004],
  [0.62, 0.060, 0.068, 0.006], [0.72, 0.057, 0.066, 0.006], [0.80, 0.056, 0.067, 0.006], [0.89, 0.057, 0.071, 0.008],
];
function humLegRow(P, s) { const r = humRows(HUM_LEG_ROWS, s / P.sc); const k = P.legK * P.sc; return [r[0] * k * (P.F ? 0.95 : 1), r[1] * k * (P.F ? 0.95 : 1), r[2] * P.sc]; }

// weights down the leg (right side): pelvis → thigh → shin
function humLegW(P, s, side = 1) {
  const sc = P.sc, toThigh = humSS(-0.015 * sc, 0.1 * sc, s), toShin = humSS(P.thigh - 0.07 * sc, P.thigh + 0.07 * sc, s);
  return humW(HB.hips, 1 - toThigh, HB.hp[side], toThigh * (1 - toShin), HB.kn[side], toShin);
}

// the leg of the trousers: kind 'trousers' or 'coverall' (a little looser)
function humBuildLeg(P, o, acc) {
  const seg = o.lod === 'low' ? 10 : 16, sc = P.sc, hipX = P.hipX, hipY = P.hipH;
  const base = [-0.03, 0.0, 0.05, 0.10, 0.16, 0.22, 0.28, 0.34, 0.385, 0.415, 0.43, 0.445, 0.475, 0.52, 0.57, 0.62, 0.68, 0.74, 0.80, 0.85, 0.887].map((s) => s * sc);
  const loose = o.coverall ? 1.07 : 1;
  const rings = base.map((s) => { const [rx, rz, zc] = humLegRow(P, s); return humRing([hipX, hipY - s, zc], HUM_X, HUM_Z, rx * loose, rz * loose, rz * loose, 2.2, seg, []); });
  const R = HUV.trLeg, len = base[base.length - 1] - base[0];
  const ao = [[hipX - 0.06, hipY - 0.02, 0.0, 0.07, 0.25], [hipX, hipY - P.thigh, 0.06 * sc, 0.045, 0.22]];
  humLoft(acc, rings, seg, {
    uv: (r, k) => humUV(R, k / seg, (base[r] - base[0]) / len),
    col: (p) => { const g = humAO(p, ao); return [g, g, g]; },
    w: (p, r) => humLegW(P, base[r], 1),
  });
}

// rows for the pelvis shell: [y above the hip line, half width, front depth, back depth, exponent]
const HUM_PELVIS_M = [[-0.085, 0.130, 0.060, 0.100, 2.2], [-0.06, 0.168, 0.092, 0.126, 2.4], [-0.02, 0.188, 0.108, 0.138, 2.5], [0.03, 0.182, 0.112, 0.134, 2.6], [0.075, 0.174, 0.112, 0.128, 2.6], [0.118, 0.170, 0.110, 0.122, 2.6]];
const HUM_PELVIS_F = [[-0.085, 0.130, 0.060, 0.100, 2.2], [-0.06, 0.172, 0.090, 0.130, 2.4], [-0.02, 0.194, 0.104, 0.144, 2.5], [0.03, 0.180, 0.106, 0.138, 2.6], [0.075, 0.156, 0.102, 0.124, 2.6], [0.118, 0.146, 0.098, 0.116, 2.6]];
function humPelvisRow(P, y) {
  const sc = P.sc, hipK = 0.5 + 0.5 * (P.o.hips || 1); let [w, df, db, n] = humRows(P.F ? HUM_PELVIS_F : HUM_PELVIS_M, y / sc);
  const belly = P.belly * Math.exp(-((((y / sc) - 0.06) / 0.1) ** 2));
  return [w * P.bw * sc * hipK, (df + belly * 0.05) * P.bd * sc, db * P.bd * sc, n];
}

// the trouser seat: waistband down to the crotch (the legs overlap its lower rim); closed at the bottom with a point between the thighs
function humBuildPelvis(P, o, acc) {
  const seg = o.lod === 'low' ? 16 : 28, sc = P.sc, hy = P.hipH;
  const ys = [-0.085, -0.07, -0.045, -0.02, 0.01, 0.04, 0.075, 0.105, 0.118].map((y) => y * sc);
  const rings = [];
  const pole = []; for (let k = 0; k <= seg; k++) pole.push(0, hy + ys[0] - 0.022 * sc, 0.02 * sc);
  rings.push(pole);
  for (const y of ys) {
    const [w, df, db, n] = humPelvisRow(P, y), e = 2 / n, r = [];
    for (let k = 0; k <= seg; k++) { const a = (k % seg) / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a); r.push(w * humSgnPow(ca, e), hy + y, (sa < 0 ? df : db) * humSgnPow(sa, e)); }
    rings.push(r);
  }
  const yAll = [ys[0] - 0.022 * sc].concat(ys), R = HUV.trPelvis, top = ys[ys.length - 1], bot = yAll[0], ao = [[0, hy - 0.05 * sc, -0.02, 0.08, 0.3]];
  humLoft(acc, rings, seg, {
    uv: (r, k) => humUV(R, k / seg, 1 - (yAll[r] - bot) / (top - bot)),
    col: (p) => { const g = humAO(p, ao); return [g, g, g]; },
    w: (p, r) => {
      const y = yAll[r], toThigh = humSS(-0.02 * sc, -0.085 * sc, y) * humSS(0.0, 0.045, Math.abs(p[0])), side = p[0] >= 0 ? 1 : 0;
      return humW(HB.hips, 1 - toThigh, HB.hp[side], toThigh);
    },
  });
}

// belt: a band round the waist (leather, own mesh); the buckle is added by the details
function humBuildBelt(P, o, acc) {
  const seg = o.lod === 'low' ? 16 : 28, sc = P.sc, hy = P.hipH, ys = [0.071, 0.0735, 0.1035, 0.106].map((y) => y * sc);
  const rings = ys.map((y, i) => {
    const [w, df, db, n] = humPelvisRow(P, y), e = 2 / n, off = i === 0 || i === 3 ? 0.0015 : 0.0032, r = [];
    for (let k = 0; k <= seg; k++) { const a = (k % seg) / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a); r.push((w + off) * humSgnPow(ca, e), hy + y, ((sa < 0 ? df : db) + off) * humSgnPow(sa, e)); }
    return r;
  });
  humLoft(acc, rings, seg, { uv: (r, k) => [k / seg, r / 3], col: () => [1, 1, 1], w: () => humW(HB.hips, 1) });
}

// ------------------------------------------------------------------ the rig
function humSkeleton(P) {
  const root = new THREE.Group(); root.name = 'human';
  const bones = new Array(HB.COUNT), abs = new Array(HB.COUNT), sc = P.sc;
  const add = (idx, name, parent, a) => {
    const b = new THREE.Bone(); b.name = name; const pa = parent < 0 ? [0, 0, 0] : abs[parent];
    b.position.set(a[0] - pa[0], a[1] - pa[1], a[2] - pa[2]); (parent < 0 ? root : bones[parent]).add(b); bones[idx] = b; abs[idx] = a; return b;
  };
  const hy = P.hipH;
  add(HB.hips, 'hips', -1, [0, hy, 0]);
  add(HB.torso, 'torso', HB.hips, [0, hy + P.spineY, 0.04 * sc]);
  add(HB.chest, 'chest', HB.torso, [0, hy + P.chestY, 0]);
  add(HB.neck, 'neck', HB.torso, [0, hy + P.neckY, 0.005 * sc]);
  add(HB.head, 'head', HB.neck, [0, hy + P.neckY, 0.005 * sc]);
  for (const side of [0, 1]) {
    const sx = side ? 1 : -1, sd = side ? 'R' : 'L';
    add(HB.clav[side], 'clav' + sd, HB.torso, [sx * 0.025 * sc, hy + 0.545 * sc, -0.02 * sc]);
    add(HB.sh[side], 'sh' + sd, HB.clav[side], [sx * P.shX, hy + P.shY, 0]);
    add(HB.el[side], 'el' + sd, HB.sh[side], [sx * P.shX, hy + P.shY - P.upper, 0]);
    add(HB.fa[side], 'fa' + sd, HB.el[side], [sx * P.shX, hy + P.shY - P.upper - P.fore * 0.5, 0]);
    add(HB.wr[side], 'wr' + sd, HB.fa[side], [sx * P.shX, hy + P.shY - P.upper - P.fore, 0]);
    add(HB.hp[side], 'hp' + sd, HB.hips, [sx * P.hipX, hy, 0]);
    add(HB.kn[side], 'kn' + sd, HB.hp[side], [sx * P.hipX, hy - P.thigh, 0]);
    add(HB.ank[side], 'ank' + sd, HB.kn[side], [sx * P.hipX, P.ankleH, 0]);
    add(HB.toe[side], 'toe' + sd, HB.ank[side], [sx * P.hipX, 0.02 * P.foot.fs, P.foot.ball]);
  }
  root.updateMatrixWorld(true);
  return { root, bones, abs, skeleton: new THREE.Skeleton(bones) };
}

// ------------------------------------------------------------------ assembling a person
const HUMGEO = new Map();             // geometry cache: people with the same body share their meshes (the six deck hands, say)
function humKey(o) { return JSON.stringify([!!o.female, o.height, o.build, o.belly, o.shoulder, o.arm, o.leg, o.legLen, o.hips, o.width, o.depth, o.foot, o.sleeves, !!o.coverall, !!o.vest, !!o.boots, !!o.gloves, o.lod, o.epaulettes, !!o.radio, !!o.pocket]); }

function humGeometries(P, o) {
  const key = humKey(o); let g = HUMGEO.get(key); if (g) return g;
  const sph = new THREE.Sphere(new THREE.Vector3(0, P.H * 0.5, 0), 0.78);
  const shirt = new HumAcc('shirt'), trou = new HumAcc('trousers'), belt = new HumAcc('belt'), skin = new HumAcc('skin');
  humBuildShirtTorso(P, o, shirt); humBuildCollar(P, o, shirt);
  const sl =new HumAcc('sleeve'); humBuildSleeve(P, o, sl, o.coverall ? 'long' : (o.sleeves || 'long')); shirt.addAcc(sl); shirt.addMirrored(sl);
  humBuildPelvis(P, o, trou);
  { const kind = o.coverall ? 'long' : (o.sleeves || 'long'); if (kind !== 'long') { const sa = new HumAcc('skinarm'); humBuildSkinArm(P, o, sa, (kind === 'short' ? 0.13 : 0.27) * P.sc); skin.addAcc(sa); skin.addMirrored(sa); } }
  const lg = new HumAcc('leg'); humBuildLeg(P, o, lg); trou.addAcc(lg); trou.addMirrored(lg);
  if (!o.coverall) humBuildBelt(P, o, belt);
  const trim = new HumAcc('trim'), metal = new HumAcc('metal'), vest = new HumAcc('vest');
  { const cl = new HumAcc('cl'); humBuildCollarLeaf(P, o, cl); shirt.addAcc(cl); shirt.addMirrored(cl); }
  { const tr = new HumAcc('tr'), mr = new HumAcc('mr'); humBuildEpaulette(P, o, tr, mr); trim.addAcc(tr); trim.addMirrored(tr); metal.addAcc(mr); metal.addMirrored(mr); }
  humBuildBeltKit(P, o, trim, metal);
  if (o.coverall) humBuildTape(P, o, trim);
  if (o.vest) humBuildVest(P, o, vest);
  const hd = new HumAcc('hand'); humBuildHand(P, o, hd); const glove = new HumAcc('glove'); const hdTarget = o.gloves ? glove : skin; hdTarget.addAcc(hd); hdTarget.addMirrored(hd);
  const shU = new HumAcc('shoeUpper'), shS = new HumAcc('shoeSole'); const sh1U = new HumAcc('u'), sh1S = new HumAcc('s'); humBuildShoe(P, o, sh1U, sh1S);
  shU.addAcc(sh1U); shU.addMirrored(sh1U); shS.addAcc(sh1S); shS.addMirrored(sh1S);
  g = { shirt: shirt.geometry(sph), trousers: trou.geometry(sph), belt: belt.n ? belt.geometry(sph) : null, skin: skin.n ? skin.geometry(sph) : null, glove: glove.n ? glove.geometry(sph) : null, shoeUpper: shU.geometry(sph), shoeSole: shS.geometry(sph), trim: trim.n ? trim.geometry(sph) : null, metal: metal.n ? metal.geometry(sph) : null, vest: vest.n ? vest.geometry(sph) : null };
  // vertices of the two feet (for the skate measurement): the left shoe comes second in the mirrored half
  g.footVerts = [Int32Array.from({ length: sh1U.n }, (_, i) => sh1U.n + i), Int32Array.from({ length: sh1U.n }, (_, i) => i)];
  g.footVerts = [g.footVerts[0], g.footVerts[1]];
  HUMGEO.set(key, g);
  return g;
}

function buildHuman(o) {
  o = Object.assign({}, o);
  const P = humProportions(o), rig = humSkeleton(P), { root, bones, skeleton } = rig, G3 = humGeometries(P, o), mats = humMaterials(P, o);
  const sphere = new THREE.Sphere(new THREE.Vector3(0, P.H * 0.5, 0), P.H * 0.62);
  const meshes = {};
  const mk = (name, geo, mat) => {
    if (!geo) return null;
    const m = new THREE.SkinnedMesh(geo, mat); m.name = name; m.bind(skeleton, new THREE.Matrix4()); m.boundingSphere = sphere.clone();
    m.castShadow = true; m.receiveShadow = true; root.add(m); meshes[name] = m; return m;
  };
  mk('shirt', G3.shirt, mats.shirt); mk('trousers', G3.trousers, mats.trousers); mk('belt', G3.belt, mats.belt); mk('skin', G3.skin, mats.skin); mk('glove', G3.glove, mats.glove); mk('trim', G3.trim, mats.trim); mk('metal', G3.metal, mats.metal); mk('vest', G3.vest, mats.vest);
  mk('shoeUpper', G3.shoeUpper, mats.shoeUpper); mk('shoeSole', G3.shoeSole, mats.shoeSole);
  // head: the scanned face on the head bone (see 09a_heads.js), raised so that the eye line sits where the proportions say
  const head = bones[HB.head], hc = new THREE.Group(); head.add(hc);
  hc.position.set(0, P.eyeY - (P.hipH + P.neckY) + 0.06, -0.012);
  let eyes = null;
  if (HEADS.ready && !o.procedural) {
    const hb = o.female && HEADS.femaleReady ? HEADS.buildFemale(o) : HEADS.build(o);
    hc.add(hb.group); eyes = hb.eyes; P.skinCol = hb.skin;
    if (mats.skin) mats.skin.color.copy(hb.skin).multiplyScalar(0.92);
  } else { hc.position.y -= 0.078; hc.add(humProceduralHead(P, o)); }
  const arms = [0, 1].map((i) => ({ clav: bones[HB.clav[i]], sh: bones[HB.sh[i]], el: bones[HB.el[i]], fa: bones[HB.fa[i]], wr: bones[HB.wr[i]] }));
  const legs = [0, 1].map((i) => {
    const ankle = bones[HB.ank[i]], toe = bones[HB.toe[i]], heel = new THREE.Object3D(), ball = new THREE.Object3D();
    heel.position.set(0, -P.ankleH, P.foot.heel); ankle.add(heel); ball.position.set(0, -P.ankleH + 0.012, P.foot.ball); ankle.add(ball);
    return { hp: bones[HB.hp[i]], kn: bones[HB.kn[i]], ankle, toe, heel, ball };
  });
  root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return { root, hips: bones[HB.hips], torso: bones[HB.torso], chest: bones[HB.chest], neck: bones[HB.neck], head, hc, arms, legs, eyes, P, skeleton, bones, meshes, shoeMesh: meshes.shoeUpper, footVerts: G3.footVerts, height: P.H };
}
