// ============================================================================
// 09b — GARMENT DETAILS: collar leaves, epaulettes and rank bars, belt buckle, radio, hi-vis vest, reflective tape
// ============================================================================
// Everything here is conformal to the shirt (it samples the same torso section function as the shirt shell, offset a few
// millimetres), so it follows the body however the build changes, and it is weighted to the same bones. Parts that come in
// pairs are built for the right side only (the caller mirrors them).

// a closed rounded block (centre c, half sizes h) lofted along z: the buckle, the radio, …
function humBlock(acc, c, h, col, w, rot = 0) {
  const sc = [0.0, 0.5, 0.9, 1, 1, 0.9, 0.5, 0.0], zs = [-1, -1, -0.96, -0.8, 0.8, 0.96, 1, 1], rings = [];
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let i = 0; i < 8; i++) rings.push(humRing([c[0], c[1], c[2] + zs[i] * h[2]], [cr, sr, 0], [-sr, cr, 0], Math.max(1e-4, h[0] * sc[i]), Math.max(1e-4, h[1] * sc[i]), Math.max(1e-4, h[1] * sc[i]), 5, 8, []));
  humLoft(acc, rings, 8, { uv: () => [0.5, 0.5], col: () => col, w: () => w });
}

// the right leaf of the shirt collar: a strip on the shoulder / chest surface starting at the band's top edge and lying outwards and down,
// longest at the front where it ends in a point
function humBuildCollarLeaf(P, o, acc) {
  const sc = P.sc, seg = o.lod === 'low' ? 8 : 14, hy = P.hipH, R = HUV.shirtMisc, rows = [0, 0.33, 0.66, 1], a0 = 1.45, a1 = -1.15;
  const rings = rows.map((t) => {
    const ring = [];
    for (let k = 0; k <= seg; k++) {
      const s = k / seg, a = a0 + (a1 - a0) * s, an = (a + 2 * Math.PI) % (2 * Math.PI);
      const L = (0.026 + 0.052 * humSS(0.25, 1, s) ** 1.3) * sc, yb = humNeckY(P, an) + 0.016 * sc;
      const p = humTorsoPoint(P, Math.max(0.3 * sc, yb - t * L), a, 0.0026 + 0.0022 * t, false); ring.push(p[0], hy + p[1], p[2]);
    }
    return ring;
  });
  humLoft(acc, rings, seg, { open: true, uv: (r, k) => humUV(R, 0.05 + 0.55 * k / seg, 0.3 + 0.18 * r), col: (p, n, r) => { const g = 1 - 0.06 * r; return [g, g, g]; }, w: () => humW(HB.torso, 1) });
}

// right shoulder epaulette (navy tab with gold bars): conformal to the shoulder slope
function humBuildEpaulette(P, o, trim, metal) {
  const sc = P.sc, hy = P.hipH, nBars = o.epaulettes || 0; if (!nBars) return;
  const seg = 4, yTop = 0.585 * sc, yTip = 0.522 * sc, rows = 9, navy = [0.075, 0.105, 0.19], gold = [0.86, 0.69, 0.25], wt = humW(HB.torso, 0.85, HB.clav[1], 0.15);
  const surf = (t, c, off) => { const y = yTop + (yTip - yTop) * t, a = (c - 0.5) * 0.62; const p = humTorsoPoint(P, y, a, off, false); return [p[0], hy + p[1], p[2]]; };
  const tab = [];
  for (let r = 0; r <= rows; r++) { const t = r / rows, ring = []; for (let k = 0; k <= seg; k++) ring.push(...surf(t * 0.985, k / seg, 0.0036)); tab.push(ring); }
  humLoft(trim, tab, seg, { open: true, uv: () => [0.5, 0.5], col: () => navy, w: () => wt });
  // rank bars across the tab (the bars stand 1.3 mm proud of it)
  for (let b = 0; b < nBars; b++) {
    const t0 = 0.3 + b * 0.145, r0 = [], r1 = [];
    for (let k = 0; k <= seg; k++) { r0.push(...surf(t0, k / seg, 0.0049)); r1.push(...surf(t0 + 0.07, k / seg, 0.0049)); }
    humLoft(metal, [r0, r1], seg, { open: true, uv: () => [0.5, 0.5], col: () => gold, w: () => wt });
  }
}

// belt buckle (centre front) and, for officers, a handheld VHF radio on the right hip; both on the pelvis
function humBuildBeltKit(P, o, trim, metal) {
  const sc = P.sc, hy = P.hipH;
  if (!o.coverall) {
    const [w, df] = humPelvisRow(P, 0.09 * sc);
    humBlock(metal, [0, hy + 0.0895 * sc, -(df + 0.0056)], [0.0225 * sc, 0.0165 * sc, 0.0024], [0.7, 0.7, 0.72], humW(HB.hips, 1));
    humBlock(trim, [0, hy + 0.0895 * sc, -(df + 0.0083)], [0.0135 * sc, 0.0075 * sc, 0.0012], [0.07, 0.07, 0.07], humW(HB.hips, 1));
  }
  if (o.radio) {
    const [w, df] = humPelvisRow(P, 0.05 * sc), x = w * 0.78 + 0.01, z = -df * 0.55;
    humBlock(trim, [x, hy + 0.05 * sc, z], [0.0155 * sc, 0.062 * sc, 0.027 * sc], [0.07, 0.075, 0.08], humW(HB.hips, 1));
    humBlock(trim, [x + 0.008 * sc, hy + 0.125 * sc, z - 0.004], [0.0045 * sc, 0.032 * sc, 0.0045 * sc], [0.05, 0.05, 0.055], humW(HB.hips, 1));              // antenna
    humBlock(metal, [x, hy + 0.092 * sc, z - 0.0272 * sc], [0.009 * sc, 0.0085 * sc, 0.0012], [0.6, 0.6, 0.62], humW(HB.hips, 1));                           // the display strip
  }
}

// ------------------------------------------------------------------ hi-vis vest (own mesh, own texture): V neck, armholes, shoulder straps
function humBuildVest(P, o, acc) {
  const sc = P.sc, seg = o.lod === 'low' ? 16 : 30, hy = P.hipH, off = 0.012;
  const ytop = (x, z) => {
    const ax = Math.abs(x) / sc, back = z > 0;
    if (ax < 0.066) return ((back ? 0.53 : 0.468) + (back ? 0.05 : 0.1) * (ax / 0.066)) * sc;
    if (ax < 0.128) return 0.6 * sc;
    return (0.43 + 0.17 * humSS(0.186, 0.128, ax)) * sc;
  };
  const ys = []; for (let i = 0; i <= 26; i++) ys.push((0.115 + (0.6 - 0.115) * i / 26) * sc);
  const rings = ys.map((y) => {
    const ring = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k % seg) / seg * Math.PI * 2; let yy = y, p = humTorsoPoint(P, yy, a, off);
      for (let it = 0; it < 4; it++) { yy = Math.min(y, ytop(p[0], p[2])); p = humTorsoPoint(P, yy, a, off); }
      ring.push(p[0], hy + p[1], p[2]);
    }
    return ring;
  });
  const bot = ys[0], top = ys[ys.length - 1];
  humLoft(acc, rings, seg, { uv: (r, k) => [k / seg, (ys[r] - bot) / (top - bot)], col: () => [1, 1, 1], w: (p, r) => humTorsoW(P, Math.min(ys[r], 0.6 * sc)) });
}

// ------------------------------------------------------------------ reflective tape (coverall): bands round the sleeves, legs and chest
function humBuildTape(P, o, acc) {
  const sc = P.sc, hy = P.hipH, col = [0.8, 0.82, 0.84], edge = [0.5, 0.52, 0.55], segA = o.lod === 'low' ? 10 : 14, segL = o.lod === 'low' ? 10 : 16, segT = o.lod === 'low' ? 14 : 26, w = 0.026 * sc;
  const right = new HumAcc('tape');
  const loft = (a, rings, seg, wf) => humLoft(a, rings, seg, { uv: () => [0.5, 0.5], col: (p, n, r) => (r === 0 || r === rings.length - 1 ? edge : col), w: wf });
  const ss = (s) => [s - w / 2, s - w / 2, s + w / 2, s + w / 2], e = (i) => (i === 0 || i === 3 ? 0.0004 : 0.0016);
  for (const s of [0.21 * sc, 0.45 * sc]) { const s4 = ss(s); loft(right, s4.map((q, i) => { const [rx, rz] = humArmRow(P, q); return humRing([P.shX, hy + P.shY - q, 0.002 * sc], HUM_X, HUM_Z, rx + e(i), rz + e(i), rz + e(i), 2.0, segA, []); }), segA, (p, r) => humArmW(P, s4[r], 1)); }
  for (const s of [0.30 * sc, 0.6 * sc]) { const s4 = ss(s), k = o.coverall ? 1.07 : 1; loft(right, s4.map((q, i) => { const [rx, rz, zc] = humLegRow(P, q); return humRing([P.hipX, P.hipH - q, zc], HUM_X, HUM_Z, rx * k + e(i), rz * k + e(i), rz * k + e(i), 2.2, segL, []); }), segL, (p, r) => humLegW(P, s4[r], 1)); }
  acc.addAcc(right); acc.addMirrored(right);
  // chest and back band
  for (const y of [0.31 * sc]) { const y4 = [y - w / 2, y - w / 2, y + w / 2, y + w / 2]; loft(acc, y4.map((q, i) => { const ring = []; for (let k = 0; k <= segT; k++) { const p = humTorsoPoint(P, q, (k % segT) / segT * Math.PI * 2, e(i) + 0.0013); ring.push(p[0], hy + p[1], p[2]); } return ring; }), segT, (p, r) => humTorsoW(P, y4[r])); }
}
