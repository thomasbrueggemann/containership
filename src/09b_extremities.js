// ============================================================================
// 09b — HANDS AND SHOES (lofted like the rest of the body; right side, mirrored by the caller)
// ============================================================================

// A tube along a polyline: rings at pts[i] with half width wd[i] (along A[i]) and half depths dp[i] = [palmar, dorsal] (along B[i]),
// closed by a rounded cap. frames[i] = [A, B] unit vectors. Weights/uv come from the callbacks.
function humTube(acc, pts, wd, dp, frames, seg, o) {
  const rings = [];
  for (let i = 0; i < pts.length; i++) rings.push(humRing(pts[i], frames[i][0], frames[i][1], wd[i], dp[i][0], dp[i][1], o.n || 2.0, seg, []));
  if (o.capEnd) {
    const i = pts.length - 1, t = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]], tl = Math.hypot(t[0], t[1], t[2]) || 1;
    const h = Math.min(wd[i], Math.max(dp[i][0], dp[i][1]));
    for (const a of [38, 66, 90]) { const f = Math.cos(a * Math.PI / 180), d = Math.sin(a * Math.PI / 180) * h; rings.push(humRing([pts[i][0] + t[0] / tl * d, pts[i][1] + t[1] / tl * d, pts[i][2] + t[2] / tl * d], frames[i][0], frames[i][1], wd[i] * f, dp[i][0] * f, dp[i][1] * f, o.n || 2.0, seg, [])); }
  }
  return humLoft(acc, rings, seg, o);
}

// ------------------------------------------------------------------ hand
// Wrist origin at (shX, wrist height, 0); the arm hangs along -y, the back of the hand faces +x (outwards), the thumb points forward (-z).
function humBuildHand(P, o, acc) {
  const hs = P.hand / 0.185, wy = P.hipH + P.shY - P.upper - P.fore, W = [P.shX, wy, 0], wb = HB.wr[1], seg = o.lod === 'low' ? 6 : 8;
  const wAll = () => humW(wb, 1), UV = (u, v) => [u, v];
  const glove = !!o.gloves;
  const col = glove ? [0.92, 0.9, 0.82] : [1, 1, 1];
  // palm: rows [s below the wrist, half width (z), palmar half thickness, dorsal half thickness]
  const rows = [[-0.035, 0.029, 0.0165, 0.0185], [0, 0.029, 0.0165, 0.0185], [0.03, 0.033, 0.0178, 0.0195], [0.065, 0.040, 0.0172, 0.0188], [0.095, 0.0445, 0.0152, 0.0165], [0.108, 0.0430, 0.0122, 0.0135]];
  const rings = [];
  for (const [s, hz, tp, td] of rows) rings.push(humRing([W[0] + 0.001, W[1] - s * hs, W[2]], HUM_Z, HUM_X, hz * hs, tp * hs, td * hs, 2.3, seg + 2, []));
  rings.push(humRing([W[0] + 0.001, W[1] - 0.116 * hs, W[2]], HUM_Z, HUM_X, 0.034 * hs, 0.007 * hs, 0.008 * hs, 2.2, seg + 2, []));
  rings.push(humRing([W[0] + 0.001, W[1] - 0.119 * hs, W[2]], HUM_Z, HUM_X, 0.012 * hs, 0.002 * hs, 0.002 * hs, 2.2, seg + 2, []));
  humLoft(acc, rings, seg + 2, { uv: (r, k) => UV(k / (seg + 2), r / 7), col: () => col, w: wAll });
  // fingers: base z, segment lengths, curl angles (rad) at MCP / PIP / DIP, half widths
  const fingers = [
    { z: -0.0325, L: [0.040, 0.023, 0.019], C: [15, 30, 12], w: 0.0098 }, { z: -0.0108, L: [0.044, 0.026, 0.021], C: [20, 38, 14], w: 0.0100 },
    { z: 0.0108, L: [0.041, 0.025, 0.020], C: [26, 44, 16], w: 0.0094 }, { z: 0.0320, L: [0.032, 0.019, 0.017], C: [32, 48, 18], w: 0.0083 },
  ];
  for (const f of fingers) {
    const pts = [], wd = [], dp = [], fr = [];
    let x = 0.0, y = -0.100, a = 0;
    const push = (px, py, ang, w, bulge = 1) => {
      pts.push([W[0] + 0.001 + px * hs, W[1] + py * hs, W[2] + f.z * hs]); wd.push(w * hs * bulge); dp.push([w * 0.95 * hs * bulge, w * 0.86 * hs * bulge]);
      fr.push([HUM_Z, [Math.cos(ang), -Math.sin(ang), 0]]);
    };
    push(x, y, 0, f.w * 0.97);
    for (let j = 0; j < 3; j++) {
      const a0 = a; a += f.C[j] * Math.PI / 180;
      const d = [-Math.sin(a), -Math.cos(a)], taper = 1 - 0.1 * j;
      // a ring half-way along the phalanx, then the next joint (a little thicker: the knuckle)
      push(x + d[0] * f.L[j] * 0.5, y + d[1] * f.L[j] * 0.5, a, f.w * taper * 0.96);
      x += d[0] * f.L[j]; y += d[1] * f.L[j];
      push(x, y, a, f.w * (taper - 0.05), j < 2 ? 1.07 : 0.98);
    }
    humTube(acc, pts, wd, dp, fr, seg, { capEnd: true, n: 2.1, uv: (r, k) => UV(k / seg, r / 10), col: (p, n, r) => (glove ? col : (r >= pts.length + 1 ? [1, 0.93, 0.9] : [1, 1, 1])), w: wAll });
  }
  // thumb: a polyline from the thenar towards the front-medial side
  const T = [[-0.004, -0.018, -0.022], [-0.009, -0.050, -0.039], [-0.013, -0.077, -0.047], [-0.0135, -0.098, -0.0465], [-0.012, -0.112, -0.043]], tw = [0.0125, 0.0108, 0.0098, 0.0092, 0.0084];
  const pts = [], wd = [], dp = [], fr = [];
  for (let i = 0; i < T.length; i++) {
    const p = T[i], q = T[Math.min(T.length - 1, i + 1)], r = T[Math.max(0, i - 1)];
    let t = [q[0] - r[0], q[1] - r[1], q[2] - r[2]]; const tl = Math.hypot(t[0], t[1], t[2]); t = t.map((v) => v / tl);
    let A = [0, t[2], -t[1]];                                                        // t × X: the width axis, mostly along z
    const al = Math.hypot(A[0], A[1], A[2]) || 1; A = A.map((v) => v / al);
    const B = [t[1] * A[2] - t[2] * A[1], t[2] * A[0] - t[0] * A[2], t[0] * A[1] - t[1] * A[0]];
    pts.push([W[0] + 0.001 + p[0] * hs, W[1] + p[1] * hs, W[2] + p[2] * hs]); wd.push(tw[i] * hs); dp.push([tw[i] * 0.92 * hs, tw[i] * 0.92 * hs]); fr.push([A, B]);
  }
  humTube(acc, pts, wd, dp, fr, seg, { capEnd: true, n: 2.0, uv: (r, k) => UV(k / seg, r / 8), col: () => col, w: wAll });
}

// ------------------------------------------------------------------ shoes
// Right shoe into accU (upper, laces: the vertex colours carry the whole colour) and accS (sole and heel). Ankle joint at (hipX, ankleH, 0).
function humBuildShoe(P, o, accU, accS) {
  const fs = P.foot.fs, ax = P.hipX, F = P.F, boots = !!o.boots, seg = o.lod === 'low' ? 8 : 14;
  const bone = (z) => { const t = humSS(P.foot.ball + 0.035 * fs, P.foot.ball - 0.035 * fs, z); return humW(HB.ank[1], 1 - t, HB.toe[1], t); };
  const lea = boots ? [0.07, 0.055, 0.045] : [0.045, 0.045, 0.05], lace = [0.82, 0.8, 0.72];
  // rows [z (forward is negative), half width, top height above the floor]
  const U = [[0.0680, 0.012, 0.034], [0.0668, 0.026, 0.052], [0.0610, 0.0315, 0.066], [0.0490, 0.0345, 0.0745], [0.0300, 0.0365, 0.0785], [0.0100, 0.0380, 0.0805], [-0.0150, 0.0395, 0.0845],
    [-0.0450, 0.0435, 0.0815], [-0.0750, 0.0485, 0.0725], [-0.1050, 0.0520, 0.0625], [-0.1380, 0.0525, 0.0525], [-0.1650, 0.0500, 0.0450], [-0.1900, 0.0440, 0.0365], [-0.2080, 0.0350, 0.0270], [-0.2165, 0.0225, 0.0175], [-0.2182, 0.0080, 0.0100]];
  if (boots) for (const r of U) { r[2] += r[0] > -0.06 ? 0.004 : 0; if (r[0] < -0.17) { r[1] += 0.003; r[2] += 0.008; } }
  const heelH = F ? 0.036 : boots ? 0.032 : 0.028, soleH = boots ? 0.016 : 0.011;
  const soleTop = (z) => humMix(heelH, soleH, humSS(0.02 * fs, -0.05 * fs, z)), soleBot = (z) => 0.014 * humSS(-0.12 * fs, -0.22 * fs, z) ** 1.3;
  const zs = U.map((r) => r[0] * fs);
  const upperRings = U.map((r, i) => {
    const z = r[0] * fs, yb = soleBot(z) + 0.5 * soleTop(z), yt = r[2] * fs, cy = (yb + yt) / 2, h = Math.max(0.004, (yt - yb) / 2);
    return humRing([ax, cy, z], HUM_X, HUM_Y, r[1] * fs, h, h, 3.0, seg, []);
  });
  const vOf = (r) => (P.foot.heel - zs[r]) / (P.foot.heel - P.foot.tip);
  humLoft(accU, upperRings, seg, {
    uv: (r, k) => [k / seg, vOf(r)],
    col: (p, n, r) => lea.map((c) => c), w: (p, r) => bone(zs[r]),
  });
  // laces: crossbars over the throat (rows are the same ring shape, sampled at the top)
  const bars = [-0.010, -0.024, -0.038, -0.052, -0.066, -0.080];
  for (const zb of bars) {
    const z = zb * fs, rr = humRows(U.map((r) => [r[0], r[1], r[2]]), zb), w = rr[0] * fs, yt = rr[1] * fs, yb = soleBot(z) + 0.5 * soleTop(z), cy = (yb + yt) / 2, h = (yt - yb) / 2;
    const pts = [], wd = [], dp = [], fr = [];
    for (let i = 0; i < 7; i++) {
      const xx = (i / 6 - 0.5) * 2 * 0.0215 * fs, ex = Math.min(0.97, Math.abs(xx) / w), yy = cy + h * Math.pow(Math.max(0, 1 - Math.pow(ex, 3)), 1 / 3) + 0.0012;
      pts.push([ax + xx, yy, z]); wd.push(0.0022 * fs); dp.push([0.0022 * fs, 0.0022 * fs]); fr.push([HUM_Z, HUM_Y]);
    }
    humTube(accU, pts, wd, dp, fr, 5, { n: 2, uv: (r, k) => [0.5, 0.5], col: () => lace, w: () => bone(z) });
  }
  // sole: slab slightly wider than the upper, thick under the heel
  const S = [[0.0690, 0.014], [0.0680, 0.030], [0.0610, 0.0345], [0.045, 0.0372], [0.020, 0.0395], [-0.01, 0.0415], [-0.05, 0.0470], [-0.09, 0.0530], [-0.13, 0.0545], [-0.165, 0.0525], [-0.195, 0.0465], [-0.2120, 0.0365], [-0.2195, 0.0220], [-0.2215, 0.0090]];
  const sRings = S.map((r) => { const z = r[0] * fs, yb = soleBot(z), yt = soleTop(z), cy = (yb + yt) / 2, h = Math.max(0.003, (yt - yb) / 2); return humRing([ax, cy, z], HUM_X, HUM_Y, r[1] * fs, h, h, 3.4, seg, []); });
  humLoft(accS, sRings, seg, { uv: (r, k) => [k / seg, (P.foot.heel - S[r][0] * fs) / (P.foot.heel - P.foot.tip)], col: () => [1, 1, 1], w: (p, r) => bone(S[r][0] * fs) });
  // boots: a shaft up the shin (hidden by the coverall's trouser legs)
  if (boots) {
    const rings = []; const ys = [0.06, 0.09, 0.12, 0.15].map((y) => y * fs);
    for (const y of ys) rings.push(humRing([ax, y, 0.004 * fs], HUM_X, HUM_Z, 0.046 * fs, 0.05 * fs, 0.052 * fs, 2.2, seg, []));
    humLoft(accU, rings, seg, { uv: (r, k) => [k / seg, 0.5], col: () => lea, w: () => humW(HB.ank[1], 1) });
  }
}

// ------------------------------------------------------------------ a simple head for the deck hands, who are too far away for the scanned faces
// Returns a group in head-centre coordinates (faces -z): skull, jaw, nose, ears, neck, eyes, brows, mouth, hair, hat.
function humProceduralHead(P, o) {
  const grp = new THREE.Group(), M = (c, r) => humHook(new THREE.MeshStandardMaterial({ color: c, roughness: r, envMapIntensity: 0.4 }));
  const skinM = M(o.skin || 0xc99a78, 0.6), hairM = M(o.hair || 0x241a12, 0.9), dark = M(0x1a1410, 0.3), lip = M(0x6a3a30, 0.6);
  const parts = [];
  const at = (g, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0) => { g.scale(sx, sy, sz); g.rotateX(rx); g.translate(x, y, z); return g; };
  parts.push(at(new THREE.SphereGeometry(0.108, 18, 14), 0, 0, 0, 0.92, 1.12, 1.0));
  parts.push(at(new THREE.SphereGeometry(0.085, 14, 10), 0, -0.055, -0.02, 0.95, 0.8, 1));
  for (const sx of [-1, 1]) parts.push(at(new THREE.SphereGeometry(0.024, 8, 6), sx * 0.1, 0, 0, 0.5, 1, 0.8));
  parts.push(at(new THREE.ConeGeometry(0.018, 0.05, 8), 0, -0.005, -0.112, 1, 1, 1, -Math.PI / 2 - 0.3));
  parts.push(at(new THREE.CylinderGeometry(0.05, 0.058, 0.2, 10), 0, -0.14, 0.012));
  const merged = mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g.index ? g : g; })); const skinMesh = new THREE.Mesh(merged, skinM); grp.add(skinMesh);
  const eyeG = mergeGeometries([-1, 1].map((sx) => { const g = new THREE.SphereGeometry(0.014, 8, 6); g.deleteAttribute('uv'); g.translate(sx * 0.037, 0.018, -0.095); return g; })); grp.add(new THREE.Mesh(eyeG, dark));
  const browG = mergeGeometries([-1, 1].map((sx) => { const g = new THREE.BoxGeometry(0.04, 0.008, 0.01); g.deleteAttribute('uv'); g.translate(sx * 0.037, 0.045, -0.1); return g; })); grp.add(new THREE.Mesh(browG, hairM));
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.006, 0.01), lip); mouth.position.set(0, -0.052, -0.098); grp.add(mouth);
  if (o.hat !== 'helmet' || true) { const hair = new THREE.Mesh(new THREE.SphereGeometry(0.114, 16, 12, 0, Math.PI * 2, 0, Math.PI * (o.female ? 0.62 : 0.5)), hairM); hair.position.y = 0.012; hair.scale.set(0.95, 1.12, 1.03); hair.rotation.x = 0.25; grp.add(hair); }
  if (o.hat === 'helmet') {
    const hm = M(o.helmetCol || 0xffffff, 0.4);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), hm); h.position.y = 0.03; grp.add(h);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 16), hm); brim.position.set(0, 0.03, -0.02); grp.add(brim);
  }
  if (o.hat === 'cap') {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.115, 0.07, 16), M(0x1a2233, 0.7)); h.position.y = 0.09; grp.add(h);
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.08), M(0x111111, 0.4)); v.position.set(0, 0.06, -0.12); grp.add(v);
  }
  grp.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return grp;
}

// ------------------------------------------------------------------ things held up to the face (children of the head-centre group: x right, y up, faces -z)
function humHandset() {
  const g = new THREE.Group(), M = (c, r) => humHook(new THREE.MeshStandardMaterial({ color: c, roughness: r, envMapIntensity: 0.4 }));
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.0155, 0.1, 4, 10), M(0x1a1c1f, 0.45)); g.add(body);
  for (const [y, r] of [[0.074, 0.027], [-0.074, 0.024]]) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, 0.02, 14), M(0x24272b, 0.5)); cup.position.y = y; g.add(cup); }
  g.position.set(0.098, -0.075, -0.012); g.rotation.set(-0.18, 0, -0.1);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}
function humBinoculars() {
  const g = new THREE.Group(), M = (c, r) => humHook(new THREE.MeshStandardMaterial({ color: c, roughness: r, envMapIntensity: 0.5 }));
  const rub = M(0x15171a, 0.7), glass = M(0x203040, 0.1);
  for (const sx of [-1, 1]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.026, 0.1, 16), rub); barrel.rotation.x = Math.PI / 2; barrel.position.set(sx * 0.036, -0.06, -0.19); g.add(barrel);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.004, 16), glass); lens.rotation.x = Math.PI / 2; lens.position.set(sx * 0.036, -0.06, -0.242); g.add(lens);
    const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.03, 14), rub); eye.rotation.x = Math.PI / 2; eye.position.set(sx * 0.036, -0.06, -0.125); g.add(eye);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.08), rub); bridge.position.set(0, -0.06, -0.19); g.add(bridge);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}
