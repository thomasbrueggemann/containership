// ============================================================================
// 05b — BRIDGE DETAILS: surfaces, nautical fittings, instruments on the walls
// ============================================================================

function bridgeSurfaceTextures(M) {
  // studded rubber deck covering (1 texture = 2 m)
  const f = makeCanvas(512, 512), fx = f.getContext('2d');
  fx.fillStyle = '#343f49'; fx.fillRect(0, 0, 512, 512);
  const R = mulberry32(4);
  for (let i = 0; i < 2500; i++) { fx.fillStyle = `rgba(${R() < 0.5 ? 0 : 255},${R() < 0.5 ? 0 : 255},${R() < 0.5 ? 0 : 255},0.02)`; fx.fillRect(R() * 512, R() * 512, 3, 3); }
  for (let y = 8; y < 512; y += 16) for (let x = 8 + ((y / 16) % 2) * 8; x < 512; x += 16) {
    const g = fx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, 5); g.addColorStop(0, '#56626c'); g.addColorStop(1, '#2c353e');
    fx.fillStyle = g; fx.beginPath(); fx.arc(x, y, 4.2, 0, 7); fx.fill();
  }
  fx.strokeStyle = 'rgba(0,0,0,0.5)'; fx.lineWidth = 2; fx.strokeRect(1, 1, 510, 510);
  const ft = canvasTexture(f, { repeat: [1, 1] });
  M.floor.map = ft; M.floor.color.set(0xffffff); M.floor.roughness = 0.85; M.floor.needsUpdate = true;
  // wall lining panels (1 texture = 1.2 m)
  const w = makeCanvas(512, 512), wx = w.getContext('2d');
  const wg = wx.createLinearGradient(0, 0, 512, 0); wg.addColorStop(0, '#e2d9c6'); wg.addColorStop(0.5, '#ebe3d1'); wg.addColorStop(1, '#ded5c2');
  wx.fillStyle = wg; wx.fillRect(0, 0, 512, 512);
  wx.fillStyle = 'rgba(0,0,0,0.28)'; wx.fillRect(0, 0, 3, 512); wx.fillRect(0, 0, 512, 3);
  wx.fillStyle = 'rgba(255,255,255,0.35)'; wx.fillRect(3, 0, 2, 512);
  for (const [x, y] of [[14, 14], [498, 14], [14, 498], [498, 498], [14, 256], [498, 256]]) { wx.fillStyle = '#9a9890'; wx.beginPath(); wx.arc(x, y, 3.5, 0, 7); wx.fill(); }
  M.wall.map = canvasTexture(w, { repeat: [1, 1] }); M.wall.color.set(0xffffff); M.wall.needsUpdate = true;
  // perforated ceiling tiles (1 texture = 1.2 m → 2 × 2 tiles)
  const c = makeCanvas(512, 512), cx = c.getContext('2d');
  cx.fillStyle = '#eceae4'; cx.fillRect(0, 0, 512, 512);
  cx.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 6; y < 512; y += 12) for (let x = 6; x < 512; x += 12) cx.fillRect(x, y, 2, 2);
  cx.fillStyle = '#b9b7b0'; cx.fillRect(0, 0, 512, 6); cx.fillRect(0, 253, 512, 6); cx.fillRect(0, 0, 6, 512); cx.fillRect(253, 0, 6, 512);
  M.ceiling.map = canvasTexture(c, { repeat: [1, 1] }); M.ceiling.color.set(0xffffff); M.ceiling.needsUpdate = true;
}

function teakTexture() {
  const c = makeCanvas(256, 64), x = c.getContext('2d');
  x.fillStyle = '#8a5a30'; x.fillRect(0, 0, 256, 64);
  const R = mulberry32(9);
  for (let i = 0; i < 60; i++) { x.strokeStyle = `rgba(${R() < 0.5 ? '60,35,15' : '170,120,70'},${0.15 + R() * 0.25})`; x.lineWidth = 1 + R() * 2; x.beginPath(); const y = R() * 64; x.moveTo(0, y); x.bezierCurveTo(80, y + R() * 8 - 4, 170, y + R() * 8 - 4, 256, y + R() * 6 - 3); x.stroke(); }
  return canvasTexture(c, { repeat: [1, 1] });
}

function compassCardTexture() {
  const c = makeCanvas(512, 512), x = c.getContext('2d');
  x.fillStyle = '#f4f1e6'; x.beginPath(); x.arc(256, 256, 254, 0, 7); x.fill();
  x.strokeStyle = '#111'; x.fillStyle = '#111';
  for (let d = 0; d < 360; d++) {
    const a = d * DEG, r0 = 250, r1 = d % 10 === 0 ? 222 : d % 5 === 0 ? 232 : 240;
    x.lineWidth = d % 10 === 0 ? 2.5 : 1;
    x.beginPath(); x.moveTo(256 + Math.sin(a) * r0, 256 - Math.cos(a) * r0); x.lineTo(256 + Math.sin(a) * r1, 256 - Math.cos(a) * r1); x.stroke();
    if (d % 30 === 0) { x.save(); x.translate(256 + Math.sin(a) * 200, 256 - Math.cos(a) * 200); x.rotate(a); x.font = '700 22px Georgia, serif'; x.textAlign = 'center'; x.fillText(String(d / 10).padStart(2, '0'), 0, 8); x.restore(); }
  }
  const pts = ['N', 'E', 'S', 'W'];
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2; x.save(); x.translate(256, 256); x.rotate(a);
    x.fillStyle = k === 0 ? '#b3261e' : '#1a1a1a'; x.beginPath(); x.moveTo(0, -165); x.lineTo(18, -20); x.lineTo(-18, -20); x.fill();
    x.font = '800 40px Georgia, serif'; x.textAlign = 'center'; x.fillStyle = k === 0 ? '#b3261e' : '#111'; x.fillText(pts[k], 0, -172 + 40);
    x.restore();
  }
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; x.save(); x.translate(256, 256); x.rotate(a); x.fillStyle = '#555'; x.beginPath(); x.moveTo(0, -110); x.lineTo(12, -15); x.lineTo(-12, -15); x.fill(); x.restore(); }
  x.fillStyle = '#333'; x.beginPath(); x.arc(256, 256, 14, 0, 7); x.fill();
  return canvasTexture(c);
}

// International Code of Signals – the 26 letter flags
function icsFlagsTexture() {
  const W = 1024, H = 768, c = makeCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#f1ede0'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#0b2b3d'; x.font = '800 34px Georgia, serif'; x.textAlign = 'center'; x.fillText('INTERNATIONAL CODE OF SIGNALS', W / 2, 50);
  const Y = '#f5c400', B = '#1c3f94', R = '#c8102e', Wt = '#ffffff', K = '#111111';
  const flags = {
    A: (d) => { d.v([Wt, B], [0.5, 0.5]); d.swallow(); }, B: (d) => { d.fill(R); d.swallow(); }, C: (d) => d.h([B, Wt, R, Wt, B]), D: (d) => d.h([Y, B, B, B, Y].slice(0, 3).length ? [Y, B, Y] : []),
    E: (d) => d.h([B, R]), F: (d) => { d.fill(Wt); d.diamond(R); }, G: (d) => d.v([Y, B, Y, B, Y, B]), H: (d) => d.v([Wt, R]), I: (d) => { d.fill(Y); d.circle(K); },
    J: (d) => d.h([B, Wt, B]), K: (d) => d.v([Y, B]), L: (d) => d.quarters(Y, K), M: (d) => { d.fill(B); d.saltire(Wt); }, N: (d) => d.checks(B, Wt, 4), O: (d) => d.diag(R, Y),
    P: (d) => { d.fill(B); d.square(Wt); }, Q: (d) => d.fill(Y), R: (d) => { d.fill(R); d.cross(Y); }, S: (d) => { d.fill(Wt); d.square(B); }, T: (d) => d.v([R, Wt, B]),
    U: (d) => d.quarters(R, Wt), V: (d) => { d.fill(Wt); d.saltire(R); }, W: (d) => { d.fill(B); d.square(Wt, 0.62); d.square(R, 0.3); }, X: (d) => { d.fill(Wt); d.cross(B); },
    Y: (d) => d.bands(Y, R), Z: (d) => d.tri([K, Y, B, R]),
  };
  const fw = 150, fh = 100, cols = 6;
  Object.keys(flags).forEach((L, i) => {
    const cx = 60 + (i % cols) * 160 + (i >= 24 ? 320 : 0), cy = 90 + Math.floor(i / cols) * 130;
    x.save(); x.translate(cx, cy); x.beginPath(); x.rect(0, 0, fw, fh); x.clip();
    const d = {
      fill: (col) => { x.fillStyle = col; x.fillRect(0, 0, fw, fh); },
      h: (cs) => cs.forEach((col, k) => { x.fillStyle = col; x.fillRect(0, k * fh / cs.length, fw, fh / cs.length + 1); }),
      v: (cs) => cs.forEach((col, k) => { x.fillStyle = col; x.fillRect(k * fw / cs.length, 0, fw / cs.length + 1, fh); }),
      quarters: (a, b) => { x.fillStyle = a; x.fillRect(0, 0, fw, fh); x.fillStyle = b; x.fillRect(fw / 2, 0, fw / 2, fh / 2); x.fillRect(0, fh / 2, fw / 2, fh / 2); },
      square: (col, k = 0.5) => { x.fillStyle = col; x.fillRect(fw * (1 - k) / 2, fh * (1 - k) / 2, fw * k, fh * k); },
      cross: (col) => { x.fillStyle = col; x.fillRect(fw * 0.4, 0, fw * 0.2, fh); x.fillRect(0, fh * 0.38, fw, fh * 0.24); },
      saltire: (col) => { x.strokeStyle = col; x.lineWidth = 20; x.beginPath(); x.moveTo(0, 0); x.lineTo(fw, fh); x.moveTo(fw, 0); x.lineTo(0, fh); x.stroke(); },
      circle: (col) => { x.fillStyle = col; x.beginPath(); x.arc(fw / 2, fh / 2, fh * 0.28, 0, 7); x.fill(); },
      diamond: (col) => { x.fillStyle = col; x.beginPath(); x.moveTo(fw / 2, 0); x.lineTo(fw, fh / 2); x.lineTo(fw / 2, fh); x.lineTo(0, fh / 2); x.fill(); },
      checks: (a, b, n) => { for (let i2 = 0; i2 < n; i2++) for (let j = 0; j < n; j++) { x.fillStyle = (i2 + j) % 2 ? b : a; x.fillRect(i2 * fw / n, j * fh / n, fw / n + 1, fh / n + 1); } },
      diag: (a, b) => { x.fillStyle = a; x.fillRect(0, 0, fw, fh); x.fillStyle = b; x.beginPath(); x.moveTo(fw, 0); x.lineTo(fw, fh); x.lineTo(0, fh); x.fill(); },
      bands: (a, b) => { x.fillStyle = a; x.fillRect(0, 0, fw, fh); x.strokeStyle = b; x.lineWidth = 13; for (let k = -6; k < 12; k++) { x.beginPath(); x.moveTo(k * 26, 0); x.lineTo(k * 26 + fh, fh); x.stroke(); } },
      tri: (cs) => { const P = [[0, 0, fw, 0], [fw, 0, fw, fh], [fw, fh, 0, fh], [0, fh, 0, 0]]; P.forEach(([a1, b1, a2, b2], k) => { x.fillStyle = cs[k]; x.beginPath(); x.moveTo(a1, b1); x.lineTo(a2, b2); x.lineTo(fw / 2, fh / 2); x.fill(); }); },
      swallow: () => { x.fillStyle = '#f1ede0'; x.beginPath(); x.moveTo(fw, 0); x.lineTo(fw * 0.72, fh / 2); x.lineTo(fw, fh); x.fill(); },
    };
    flags[L](d);
    x.restore();
    x.strokeStyle = '#555'; x.lineWidth = 1; x.strokeRect(cx, cy, fw, fh);
    x.fillStyle = '#222'; x.font = '700 18px Georgia, serif'; x.textAlign = 'center'; x.fillText(L, cx + fw / 2, cy + fh + 20);
  });
  return canvasTexture(c);
}

function framedArtTexture(kind) {
  const c = makeCanvas(512, 320), x = c.getContext('2d');
  if (kind === 'ship') {
    const g = x.createLinearGradient(0, 0, 0, 200); g.addColorStop(0, '#f0a868'); g.addColorStop(1, '#f7d9a4'); x.fillStyle = g; x.fillRect(0, 0, 512, 200);
    x.fillStyle = '#ffe3a8'; x.beginPath(); x.arc(380, 150, 26, 0, 7); x.fill();
    const s = x.createLinearGradient(0, 200, 0, 320); s.addColorStop(0, '#6a7f8c'); s.addColorStop(1, '#2b3d4a'); x.fillStyle = s; x.fillRect(0, 196, 512, 124);
    x.fillStyle = '#1f3448'; x.beginPath(); x.moveTo(40, 196); x.lineTo(470, 196); x.lineTo(455, 222); x.lineTo(60, 222); x.fill();
    const cols = ['#3f97c7', '#3f97c7', '#a8382a', '#3f97c7', '#e06a1a', '#dcdcd8'];
    for (let i = 0; i < 26; i++) { if (i === 17) continue; const h = 5 + Math.floor(Math.random() * 3); for (let k = 0; k < h; k++) { x.fillStyle = cols[(i + k) % cols.length]; x.fillRect(70 + i * 14.5, 190 - k * 8, 13.5, 7); } }
    x.fillStyle = '#eee'; x.fillRect(318, 120, 16, 76); x.fillStyle = '#42b0d5'; x.fillRect(430, 148, 18, 30);
    x.fillStyle = '#fff'; x.font = '900 14px Arial'; x.fillText('MAERSK', 190, 214);
  } else { // fire & safety plan
    x.fillStyle = '#fbfaf5'; x.fillRect(0, 0, 512, 320);
    x.fillStyle = '#0b2b3d'; x.font = '800 20px Arial'; x.fillText('FIRE & SAFETY PLAN — MAJESTIC MAERSK', 18, 30);
    x.strokeStyle = '#333'; x.lineWidth = 3; x.beginPath(); x.moveTo(20, 170); x.lineTo(440, 170); x.lineTo(495, 205); x.lineTo(440, 240); x.lineTo(20, 240); x.closePath(); x.stroke();
    for (let i = 0; i < 40; i++) { x.fillStyle = ['#c8102e', '#1e8a3c', '#1c3f94'][i % 3]; x.fillRect(30 + Math.random() * 420, 178 + Math.random() * 54, 7, 7); }
    [['#c8102e', 'Fire extinguisher'], ['#1e8a3c', 'Lifesaving / escape'], ['#1c3f94', 'Fire hydrant']].forEach(([col, t], i) => { x.fillStyle = col; x.fillRect(20, 60 + i * 30, 14, 14); x.fillStyle = '#222'; x.font = '15px Arial'; x.fillText(t, 42, 72 + i * 30); });
    x.fillStyle = '#1e8a3c'; x.fillRect(360, 60, 130, 70); x.fillStyle = '#fff'; x.font = '700 16px Arial'; x.fillText('YOU ARE', 385, 90); x.fillText('HERE ▲ BRIDGE', 368, 112);
  }
  return canvasTexture(c);
}

function dialTexture(kind) {
  const c = makeCanvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#f6f1e2'; x.beginPath(); x.arc(128, 128, 126, 0, 7); x.fill();
  x.strokeStyle = '#222';
  if (kind === 'baro') {
    for (let v = 960; v <= 1060; v += 2) { const a = -Math.PI * 1.25 + (v - 960) / 100 * Math.PI * 1.5; x.lineWidth = v % 10 === 0 ? 2.5 : 1; x.beginPath(); x.moveTo(128 + Math.cos(a) * 118, 128 + Math.sin(a) * 118); x.lineTo(128 + Math.cos(a) * (v % 10 === 0 ? 100 : 108), 128 + Math.sin(a) * (v % 10 === 0 ? 100 : 108)); x.stroke(); }
    x.fillStyle = '#222'; x.font = 'italic 700 15px Georgia'; x.textAlign = 'center';
    [['STORMY', 970], ['RAIN', 990], ['CHANGE', 1010], ['FAIR', 1030], ['VERY DRY', 1050]].forEach(([t, v]) => { const a = -Math.PI * 1.25 + (v - 960) / 100 * Math.PI * 1.5; x.fillText(t, 128 + Math.cos(a) * 78, 132 + Math.sin(a) * 78); });
    x.font = '600 11px Georgia'; x.fillText('hPa', 128, 180);
    const a = -Math.PI * 1.25 + (1016 - 960) / 100 * Math.PI * 1.5; x.strokeStyle = '#111'; x.lineWidth = 3; x.beginPath(); x.moveTo(128, 128); x.lineTo(128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100); x.stroke();
  }
  return canvasTexture(c);
}

function consoleDoorTexture() {
  // 512 px = 1.1 m module; cabinet doors occupy the lower 0.8 m (bottom 72.7 %)
  const c = makeCanvas(512, 512), x = c.getContext('2d');
  x.fillStyle = '#c9cecb'; x.fillRect(0, 0, 512, 512);
  const top = 140;
  x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 3;
  for (const [x0, w] of [[10, 240], [262, 240]]) {
    x.strokeRect(x0, top + 22, w, 512 - top - 60);
    x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(x0 + 2, top + 24, w - 4, 3);
    for (let k = 0; k < 6; k++) { x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(x0 + 40, top + 250 + k * 12, w - 80, 4); }
    x.fillStyle = '#3a3f43'; x.beginPath(); x.arc(x0 + w - 24, top + 60, 7, 0, 7); x.fill();
    x.fillStyle = '#9aa0a3'; x.fillRect(x0 + w - 26, top + 57, 4, 6);
  }
  x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, 490, 512, 22);
  x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, top - 4, 512, 4);
  const R = mulberry32(12); for (let i = 0; i < 700; i++) { x.fillStyle = `rgba(0,0,0,${R() * 0.03})`; x.fillRect(R() * 512, R() * 512, 2, 2); }
  return canvasTexture(c, { repeat: [1, 1] });
}

// potted plant: tapered pot, soil, arching stems with broad glossy leaves
function buildPlant(B, x, z, s = 1, seed = 1) {
  const R = mulberry32(seed * 97 + 5);
  const pot = new THREE.MeshStandardMaterial({ color: 0x8c8580, roughness: 0.55, metalness: 0.1 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x2e2218, roughness: 1 });
  const stem = new THREE.MeshStandardMaterial({ color: 0x4d6a2a, roughness: 0.8 });
  const leafA = new THREE.MeshStandardMaterial({ color: 0x2f6a2a, roughness: 0.45, side: THREE.DoubleSide });
  const leafB = new THREE.MeshStandardMaterial({ color: 0x3f8436, roughness: 0.5, side: THREE.DoubleSide });
  B.cyl(pot, 0.26 * s, 0.19 * s, 0.5 * s, x, 0.25 * s, z, 20);
  B.cyl(pot, 0.28 * s, 0.28 * s, 0.05 * s, x, 0.5 * s, z, 20);
  B.cyl(soil, 0.25 * s, 0.25 * s, 0.02 * s, x, 0.49 * s, z, 20);
  // leaf blade: elliptic shape, cupped along its midrib
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.bezierCurveTo(0.09, 0.08, 0.1, 0.3, 0, 0.42); sh.bezierCurveTo(-0.1, 0.3, -0.09, 0.08, 0, 0);
  const leafG = new THREE.ShapeGeometry(sh, 6); const lp = leafG.attributes.position;
  for (let i = 0; i < lp.count; i++) { const lx = lp.getX(i), ly = lp.getY(i); lp.setZ(i, lx * lx * 3 - ly * ly * 0.35); }
  leafG.computeVertexNormals();
  const n = 9 + Math.floor(R() * 4);
  for (let k = 0; k < n; k++) {
    const az = k / n * Math.PI * 2 + R() * 0.5, lean = 0.25 + R() * 0.45, h = (0.6 + R() * 0.7) * s;
    const top = new THREE.Vector3(x + Math.sin(az) * Math.sin(lean) * h, 0.5 * s + Math.cos(lean) * h, z + Math.cos(az) * Math.sin(lean) * h);
    B.beam(stem, new THREE.Vector3(x + Math.sin(az) * 0.05, 0.5 * s, z + Math.cos(az) * 0.05), top, 0.018 * s);
    for (let j = 0; j < 3; j++) {
      const a2 = az + (j - 1) * 0.7 + R() * 0.3, droop = 0.4 + R() * 0.7, ls = (0.9 + R() * 0.6) * s;
      B.add(leafG, j % 2 ? leafA : leafB, MX(top.x, top.y - j * 0.08 * s, top.z, -Math.PI / 2 + droop, a2, 0, ls, ls, ls));
    }
  }
}

// ship's mess-style chair with blue upholstery (bolted to the deck at sea)
function buildMessChair(B, M, x, z, ry) {
  const up = new THREE.MeshStandardMaterial({ color: 0x2d62ad, roughness: 0.85 });
  const c = Math.cos(ry), sn = Math.sin(ry);
  const L = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
  for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) { const [px, pz] = L(lx, lz); B.cyl(M.chrome, 0.015, 0.015, 0.45, px, 0.225, pz, 8); }
  const [sx, sz] = L(0, 0), [bx, bz] = L(0, 0.22);
  B.add(new RoundedBoxGeometry(0.46, 0.08, 0.46, 2, 0.03), up, MX(sx, 0.48, sz, 0, ry, 0));
  B.add(new RoundedBoxGeometry(0.44, 0.42, 0.06, 2, 0.025), up, MX(bx, 0.76, bz, -0.1, ry, 0));
  for (const lx of [-0.2, 0.2]) { const [px, pz] = L(lx, 0.22); B.cyl(M.chrome, 0.012, 0.012, 0.4, px, 0.66, pz, 8); }
}

function meshAt(m, x, y, z) { m.position.set(x, y, z); return m; }

function watchBoardTexture() {
  const c = makeCanvas(700, 450), x = c.getContext('2d');
  x.fillStyle = '#fbfbf8'; x.fillRect(0, 0, 700, 450);
  x.fillStyle = '#1b3b8a'; x.font = '700 28px "Marker Felt", "Comic Sans MS", cursive'; x.fillText('BRIDGE WATCHES', 24, 44);
  x.font = '600 22px "Marker Felt", "Comic Sans MS", cursive';
  [['00–04 / 12–16', '2/O Santos + AB'], ['04–08 / 16–20', 'C/O Nielsen + AB Reyes'], ['08–12 / 20–24', '3/O Mehta + OS'], ['', ''], ['ARRIVAL WESTERHAVEN', 'Pilot 08:20 LT · Berth 4 PS'], ['Stand-by', 'C/O fwd · 2/O aft · 3/O bridge'], ['Tugs', '2 × ASD (Titan, Hercules)']].forEach(([a, b], i) => { x.fillStyle = i >= 4 ? '#b3261e' : '#1b3b8a'; x.fillText(a, 24, 100 + i * 46); x.fillStyle = '#222'; x.fillText(b, 300, 100 + i * 46); });
  return canvasTexture(c);
}

function addBridgeDetails(bg, M, B) {
  const W = BR.halfW, zf = BR.zFront, za = BR.zAft, H = BR.H;
  bridgeSurfaceTextures(M);
  const std = (c, r = 0.7, m = 0, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, envMapIntensity: 0.6, ...o });
  M.brass = std(0xc9a14a, 0.28, 1.0, { envMapIntensity: 1.1 });
  M.chrome = std(0xd8dcdf, 0.18, 1.0, { envMapIntensity: 1.1 });
  M.teak = std(0xffffff, 0.45, 0.0, { map: teakTexture() });
  M.mat = std(0x121416, 0.95);
  M.greyBox = std(0x8e959a, 0.6, 0.3);

  // ---------- teak handrail along the front bulkhead + chrome brackets
  for (const [x0, x1] of [[-W + 0.4, -6.4], [6.4, W - 0.4], [-6.3, 6.3]]) {
    const len = x1 - x0, cx = (x0 + x1) / 2;
    const z = x0 > -6.4 && x1 < 6.4 ? zf + 0.2 : zf + 0.2;
    B.cyl(M.teak, 0.032, 0.032, len, cx, 0.98, z, 10, 0, 0, Math.PI / 2);
    for (let x = x0 + 0.3; x < x1; x += 1.8) { B.box(M.chrome, 0.03, 0.03, 0.16, x, 0.98, z - 0.08); B.box(M.chrome, 0.05, 0.12, 0.02, x, 0.93, zf + 0.07); }
  }
  // teak dado rail along the aft wall and the lower side walls
  for (const [x0, x1] of [[-9.45, -0.62], [0.62, 9.45]]) B.box(M.teak, x1 - x0, 0.07, 0.04, (x0 + x1) / 2, 1.05, za - 0.09);
  for (const sx of [-1, 1]) B.box(M.teak, 0.04, 0.07, BR.WZ - zf - 0.3, sx * (W - 0.09), 1.0, (zf + BR.WZ) / 2);
  // skirting board
  B.box(M.mat, W * 2 - 0.3, 0.1, 0.02, 0, 0.05, zf + 0.075);
  for (const sx of [-1, 1]) B.box(M.mat, 0.02, 0.1, BR.WZ - zf, sx * (W - 0.075), 0.05, (zf + BR.WZ) / 2);
  // chrome grab rail along the operator side of the main console (skips the steering stand)
  for (const [x0, x1] of [[-6.0, -0.55], [0.55, 6.0]]) {
    B.cyl(M.chrome, 0.018, 0.018, x1 - x0, (x0 + x1) / 2, 0.7, -3.9, 10, 0, 0, Math.PI / 2);
    for (let x = x0 + 0.2; x < x1; x += 1.1) B.box(M.chrome, 0.025, 0.025, 0.13, x, 0.7, -3.96);
  }
  // console kick plate and rubber bumper
  B.box(M.chrome, 12.1, 0.12, 0.02, 0, 0.07, -4.02);
  B.box(M.mat, 12.12, 0.04, 0.06, 0, 0.815, -4.03);
  // anti-fatigue mats
  B.box(M.mat, 11.6, 0.012, 1.0, 0, 0.006, -3.45);
  for (const sx of [-1, 1]) B.box(M.mat, 2.2, 0.012, 1.0, sx * 28.2, 0.006, -3.55);

  // ---------- ceiling: cable trays, vents, speakers, smoke detectors
  for (const [z, hw] of [[-3.2, W - 1], [2.0, BR.CW - 0.5]]) { B.box(M.greyBox, hw * 2, 0.08, 0.3, 0, H - 0.1, z); for (let x = -hw; x < hw; x += 3) B.box(M.greyBox, 0.04, 0.1, 0.3, x, H - 0.05, z); }
  const vent = std(0xd8d8d2, 0.6);
  for (let x = -9.75; x <= 9.75; x += 6.5) {
    B.box(vent, 0.6, 0.03, 0.3, x, H - 0.05, 4.2);
    for (let k = 0; k < 5; k++) B.box(M.greyBox, 0.56, 0.02, 0.012, x, H - 0.07, 4.08 + k * 0.06);
    B.cyl(vent, 0.07, 0.07, 0.04, x + 3.2, H - 0.06, 0.4, 14);
    B.cyl(M.black, 0.11, 0.11, 0.05, x + 1.5, H - 0.06, -1.2, 16);
  }
  // roller-blind housings above the front windows
  const soffit = std(0x2c5f96, 0.6, 0.2);
  B.box(soffit, W * 2 - 0.3, 0.32, 0.9, 0, H - 0.16, zf - 0.08);
  B.box(M.greyBox, W * 2 - 0.4, 0.06, 0.08, 0, H - 0.34, zf + 0.34);

  // ---------- magnetic compass periscope (reflector from the monkey island compass)
  {
    B.cyl(M.black, 0.07, 0.07, H - 2.55, 0, (H + 2.55) / 2, -4.95, 16);
    const head = new THREE.Group(); head.position.set(0, 2.47, -4.95); head.rotation.x = -0.6; head.scale.setScalar(0.8); bg.add(head);
    const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 24), M.black); hb.rotation.x = Math.PI / 2; head.add(hb);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 8, 30), M.brass); ring.position.z = 0.062; head.add(ring);
    const card = new THREE.Mesh(new THREE.CircleGeometry(0.135, 40), new THREE.MeshBasicMaterial({ map: compassCardTexture(), toneMapped: false, color: ENV.night ? 0x886644 : 0xffffff }));
    card.position.z = 0.064; head.add(card);
    const lub = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05, 0.004), new THREE.MeshBasicMaterial({ color: 0xcc2222 })); lub.position.set(0, 0.11, 0.068); head.add(lub);
    interactive(hb, { name: 'Magnetic compass (reflector)', hint: 'Periscope view of the standard magnetic compass on the compass deck. Deviation card on the chart table.' });
    BR.anim.push({ type: 'fn', fn: () => { card.rotation.z = G.ship.psi + 2.1 * DEG; } });
  }

  // ---------- clear-view screens on the two centre windows
  {
    const tilt = Math.atan2(0.42, H - 0.3 - BR.sill);
    for (const x of [-1.025, 1.025]) {
      const y = 2.25, z = zf - 0.42 * (y - BR.sill) / (H - 0.3 - BR.sill) + 0.035;
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.x = tilt; bg.add(g);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.02, 8, 40), M.chrome); g.add(rim);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.23, 32), new THREE.MeshPhysicalMaterial({ color: 0xdfeee8, transparent: true, opacity: 0.1, roughness: 0.02, depthWrite: false })); disc.position.z = 0.005; g.add(disc);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 16), M.chrome); hub.rotation.x = Math.PI / 2; hub.position.z = 0.05; g.add(hub);
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.012, 0.01), M.chrome); spoke.position.z = 0.012; g.add(spoke);
      interactive(hub, { name: 'Clear-view screen', hint: 'Spinning glass disc throws off spray and rain. Runs with the wipers.', click: () => { G.wipers = !G.wipers; } });
      BR.anim.push({ type: 'fn', fn: (dt) => { if (G.wipers) spoke.rotation.z += dt * 25; } });
    }
  }

  // ---------- clinometer (heel indicator) next to the overhead panel
  {
    const g = new THREE.Group(); g.position.set(-5.45, H - 0.5, -5.4); g.rotation.x = 0.38; bg.add(g);
    const cc = makeCanvas(256, 160), x = cc.getContext('2d');
    x.fillStyle = '#f4f1e6'; x.fillRect(0, 0, 256, 160); x.strokeStyle = '#222';
    for (let d = -40; d <= 40; d += 5) { const a = Math.PI / 2 + d * DEG; x.lineWidth = d % 10 === 0 ? 2.5 : 1; x.beginPath(); x.moveTo(128 + Math.cos(a) * 118, 20 + Math.sin(a) * 118); x.lineTo(128 + Math.cos(a) * (d % 10 ? 108 : 100), 20 + Math.sin(a) * (d % 10 ? 108 : 100)); x.stroke(); if (d % 10 === 0) { x.fillStyle = d < 0 ? '#b3261e' : d > 0 ? '#1e8a3c' : '#222'; x.font = '700 14px Georgia'; x.textAlign = 'center'; x.fillText(Math.abs(d), 128 + Math.cos(a) * 88, 25 + Math.sin(a) * 88); } }
    x.fillStyle = '#222'; x.font = '700 13px Georgia'; x.textAlign = 'center'; x.fillText('CLINOMETER', 128, 50);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.05), M.brass));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.28), new THREE.MeshStandardMaterial({ map: canvasTexture(cc), roughness: 0.5 })); face.position.z = 0.027; g.add(face);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.2, 0.004), M.black); needle.geometry.translate(0, -0.1, 0); needle.position.set(0, 0.13, 0.031); g.add(needle);
    interactive(face, { name: 'Clinometer', hint: 'Shows the ship\'s heel — watch it when turning at speed or with beam wind' });
    BR.anim.push({ type: 'fn', fn: () => { needle.rotation.z = -(G.shipGroup.rotation.z) * 6; } });
  }

  // ---------- gyro repeaters with pelorus on both wings
  const cardTex = compassCardTexture();
  for (const sx of [-1, 1]) {
    const x = sx * 25.9, z = -5.35;
    B.cyl(M.greyBox, 0.09, 0.14, 1.05, x, 0.525, z, 16);
    B.cyl(M.greyBox, 0.24, 0.26, 0.04, x, 0.02, z, 20);
    const g = new THREE.Group(); g.position.set(x, 1.1, z); bg.add(g);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.1, 28), M.black); g.add(bowl);
    const card = new THREE.Mesh(new THREE.CircleGeometry(0.18, 40), new THREE.MeshBasicMaterial({ map: cardTex, toneMapped: false, color: ENV.night ? 0x886644 : 0xffffff }));
    card.rotation.x = -Math.PI / 2; card.position.y = 0.052; g.add(card);
    const ring = new THREE.Group(); ring.position.y = 0.07; g.add(ring);
    ring.add(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 8, 36).rotateX(Math.PI / 2), M.brass));
    for (const s of [-1, 1]) { const vane = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.03), M.brass); vane.position.set(0, 0.06, s * 0.2); ring.add(vane); }
    interactive(bowl, { name: 'Gyro repeater & pelorus', hint: 'Take compass bearings of buoys, lights and ships from the wing' });
    BR.anim.push({ type: 'fn', fn: (dt, t) => { card.rotation.z = G.ship.psi; ring.rotation.y = Math.sin(t * 0.05 + sx) * 0.6; } });
    // Aldis signalling lamp on its bracket
    B.box(M.greyBox, 0.05, 0.3, 0.05, sx * (W - 0.15), 1.35, -2.3);
    B.cyl(M.black, 0.1, 0.12, 0.3, sx * (W - 0.3), 1.52, -2.3, 16, Math.PI / 2);
    B.cyl(M.chrome, 0.1, 0.1, 0.02, sx * (W - 0.3), 1.52, -2.45, 16, Math.PI / 2);
  }

  // ---------- aft wall furniture & nautical fittings
  const wallZ = za - 0.085;
  const framed = (tex, x, y, w, h, name, hint, click) => {
    B.box(M.teak, w + 0.08, h + 0.08, 0.03, x, y, wallZ - 0.01);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    m.position.set(x, y, wallZ - 0.03); m.rotation.y = Math.PI; bg.add(m);
    if (name) interactive(m, { name, hint: hint || '', click });
    return m;
  };
  // lifebuoys
  for (const x of [-8.9, 8.9]) {
    const lb = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.075, 12, 40), new THREE.MeshStandardMaterial({ map: stripesTexture('#f06a14', '#ffffff', 8, true), roughness: 0.6 }));
    lb.position.set(x, 1.75, wallZ - 0.08); bg.add(lb);
    B.box(M.greyBox, 0.06, 0.12, 0.08, x, 2.07, wallZ - 0.04);
    interactive(lb, { name: 'Lifebuoy with light & smoke signal', hint: 'MAJESTIC MAERSK — KØBENHAVN' });
  }
  const ics = icsFlagsTexture(); registerStatic('ics', 'International Code of Signals', ics);
  framed(ics, 5.0, 1.9, 1.0, 0.75, 'International Code of Signals', 'Click to read — flag H means “I have a pilot on board”', () => UI.zoomDisplay('ics'));
  framed(framedArtTexture('safety'), -7.2, 1.8, 1.0, 0.62, 'Fire & safety plan', 'Locations of extinguishers, hydrants and escape routes');
  framed(framedArtTexture('ship'), -4.5, 1.85, 1.0, 0.62, 'Framed photo', 'MAJESTIC MAERSK on sea trials off Okpo, 2013');
  // brass clock & barometer on a teak plaque
  {
    B.box(M.teak, 0.95, 0.46, 0.04, -5.95, 1.95, wallZ - 0.01);
    const clockC = makeCanvas(256, 256), cx = clockC.getContext('2d'); const clockT = canvasTexture(clockC);
    const drawClock = () => {
      cx.fillStyle = '#f6f1e2'; cx.beginPath(); cx.arc(128, 128, 126, 0, 7); cx.fill();
      cx.strokeStyle = '#222'; for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2; cx.lineWidth = i % 5 ? 1 : 3; cx.beginPath(); cx.moveTo(128 + Math.sin(a) * 118, 128 - Math.cos(a) * 118); cx.lineTo(128 + Math.sin(a) * (i % 5 ? 110 : 100), 128 - Math.cos(a) * (i % 5 ? 110 : 100)); cx.stroke(); }
      cx.fillStyle = '#222'; cx.font = '700 22px Georgia'; cx.textAlign = 'center'; for (let i = 1; i <= 12; i++) { const a = i / 12 * Math.PI * 2; cx.fillText(i, 128 + Math.sin(a) * 84, 136 - Math.cos(a) * 84); }
      const [h, m, s] = nowClock();
      const hand = (a, len, w, col) => { cx.strokeStyle = col; cx.lineWidth = w; cx.lineCap = 'round'; cx.beginPath(); cx.moveTo(128, 128); cx.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len); cx.stroke(); };
      hand(((h % 12) + m / 60) / 12 * Math.PI * 2, 58, 7, '#111'); hand((m + s / 60) / 60 * Math.PI * 2, 88, 4, '#111'); hand(s / 60 * Math.PI * 2, 96, 1.5, '#b3261e');
      clockT.needsUpdate = true;
    };
    drawClock();
    for (const [x, tex, name] of [[-6.2, clockT, 'Ship\'s clock (local time)'], [-5.7, dialTexture('baro'), 'Aneroid barometer — 1016 hPa, steady']]) {
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.06, 32), M.brass); rim.rotation.x = Math.PI / 2; rim.position.set(x, 1.95, wallZ - 0.05); bg.add(rim);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.16, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 })); face.position.set(x, 1.95, wallZ - 0.081); face.rotation.y = Math.PI; bg.add(face);
      interactive(face, { name, hint: '' });
    }
    let acc = 0; BR.anim.push({ type: 'fn', fn: (dt) => { acc += dt; if (acc > 1) { acc = 0; drawClock(); } } });
  }
  // ship's bell next to the door
  {
    const prof = [[0.0, 0.25], [0.04, 0.25], [0.055, 0.235], [0.065, 0.19], [0.075, 0.11], [0.095, 0.045], [0.125, 0.008], [0.13, -0.004], [0.12, -0.01], [0.0, -0.005]].map(([r, y]) => new THREE.Vector2(r, y));
    const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), M.brass);
    bell.position.set(0.95, 1.62, wallZ - 0.22); bell.scale.setScalar(1.5); bg.add(bell);
    B.box(M.brass, 0.03, 0.03, 0.22, 0.95, 1.96, wallZ - 0.11);
    B.box(M.brass, 0.12, 0.16, 0.02, 0.95, 1.96, wallZ - 0.01);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), std(0xf2eee0, 0.9)); rope.position.set(0.95, 1.58, wallZ - 0.2); bg.add(rope);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.05), new THREE.MeshStandardMaterial({ map: labelTexture('MAJESTIC MAERSK · 2013', { w: 256, h: 64, bg: '#b8913e', color: '#3a2a10', size: 18 }), metalness: 0.6, roughness: 0.35 }));
    plate.position.set(0.95, 1.82, wallZ - 0.22); plate.rotation.y = Math.PI; plate.rotation.x = 0; bg.add(plate);
    interactive(bell, { name: 'Ship\'s bell', hint: 'Click to ring it — one bell!', click: () => { AUDIO.bell(); bell.rotation.x = 0.25; setTimeout(() => (bell.rotation.x = -0.12), 180); setTimeout(() => (bell.rotation.x = 0), 420); } });
  }
  // signal flag locker (pigeon holes with rolled flags)
  {
    const x0 = 6.9, y0 = 0.05;
    B.box(M.teak, 1.3, 1.3, 0.42, x0, y0 + 0.65, wallZ - 0.21);
    const cols = [0xc8102e, 0x1c3f94, 0xf5c400, 0xffffff, 0x111111];
    const flagMats = cols.map((c) => std(c, 0.85));
    const dark = std(0x2a1a0c, 0.9);
    for (let r = 0; r < 5; r++) for (let k = 0; k < 6; k++) {
      const x = x0 - 0.52 + k * 0.208, y = y0 + 0.17 + r * 0.24;
      B.box(dark, 0.19, 0.2, 0.02, x, y, wallZ - 0.43 + 0.012);
      B.cyl(flagMats[(r * 3 + k) % 5], 0.07, 0.07, 0.3, x, y - 0.02, wallZ - 0.28, 10, Math.PI / 2);
      B.cyl(flagMats[(r * 3 + k + 2) % 5], 0.071, 0.071, 0.06, x, y - 0.02, wallZ - 0.4, 10, Math.PI / 2);
    }
    addCollider(x0 - 0.7, x0 + 0.7, wallZ - 0.45, za);
    // UHF radio charging rack above it
    B.box(M.black, 1.0, 0.08, 0.14, x0, 1.62, wallZ - 0.07);
    const ledOn = new THREE.MeshBasicMaterial({ color: 0x33ff66 });
    for (let k = 0; k < 6; k++) {
      const x = x0 - 0.4 + k * 0.16;
      B.box(M.black, 0.06, 0.16, 0.04, x, 1.74, wallZ - 0.09);
      B.box(M.black, 0.01, 0.1, 0.01, x + 0.015, 1.87, wallZ - 0.09);
      B.box(ledOn, 0.012, 0.012, 0.01, x, 1.6, wallZ - 0.145);
    }
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.9, 0.45), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(x0, 0.95, wallZ - 0.22); bg.add(hit);
    interactive(hit, { name: 'Signal flag locker & UHF radios', hint: 'Full set of code flags. Mooring stations talk to the bridge on UHF.' });
  }
  // first-aid boxes & torches
  for (const sx of [-1, 1]) {
    B.box(std(0xf4f4f0, 0.5), 0.4, 0.3, 0.12, sx * 11.45, 1.55, wallZ - 0.06);
    B.box(std(0x1e8a3c, 0.5), 0.18, 0.05, 0.01, sx * 11.45, 1.55, wallZ - 0.125); B.box(std(0x1e8a3c, 0.5), 0.05, 0.18, 0.01, sx * 11.45, 1.55, wallZ - 0.125);
    B.cyl(std(0xf0c020, 0.5), 0.035, 0.035, 0.22, sx * 11.45, 1.95, wallZ - 0.05, 10);
  }
  // binoculars resting on the front sill
  for (const x of [-7.4, 7.2]) for (const dx of [-0.035, 0.035]) B.cyl(M.black, 0.03, 0.032, 0.17, x + dx, 1.12, zf - 0.02, 12, Math.PI / 2, 0.4);
  // log books on the chart table
  B.box(std(0x1d2d55, 0.7), 0.3, 0.035, 0.42, -10.6, 0.945, 5.35, 0.1);
  B.box(std(0x6a1a1a, 0.7), 0.24, 0.03, 0.34, -10.55, 0.98, 5.35, -0.15);

  // ---------- console dressing: label plates, keyboards, microphone, mug, lamp strips
  const names = ['RADAR 1 · X-BAND', 'ECDIS 1', 'AUTOPILOT', 'CONNING', 'CONNING · PROP', 'STEERING', 'MAIN ENGINES', 'TUGS · THRUSTERS', 'DOCKING', 'ECDIS 2', 'RADAR 2 · S-BAND'];
  names.forEach((n, i) => {
    const x = -6.05 + 0.55 + i * 1.1;
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.05), new THREE.MeshStandardMaterial({ map: labelTexture(n, { w: 256, h: 28, bg: '#15191c', color: '#c9d3d8', size: 15 }), roughness: 0.5 }));
    lab.position.set(x, 0.72, -4.012); bg.add(lab);
  });
  // gooseneck PA microphone
  {
    const pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push(new THREE.Vector3(-2.6, 0.87 + t * 0.28, -4.45 + Math.sin(t * 1.4) * 0.22)); }
    B.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.008, 6), M.black);
    B.add(new THREE.CapsuleGeometry(0.022, 0.05, 4, 8), M.black, MX(-2.6, 1.16, -4.23, Math.PI / 2 - 0.4));
  }
  {
    const pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push(new THREE.Vector3(2.6, 0.87 + t * 0.28, -4.45 + Math.sin(t * 1.4) * 0.22)); }
    B.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.008, 6), M.black);
    B.add(new THREE.CapsuleGeometry(0.022, 0.05, 4, 8), M.black, MX(2.6, 1.16, -4.23, Math.PI / 2 - 0.4));
  }
  for (const [x, z] of [[-3.55, -4.2], [1.72, -4.25], [4.95, -4.2]]) {
    B.box(M.black, 0.09, 0.03, 0.2, x, 0.84, z, 0.3);
    B.add(new THREE.CapsuleGeometry(0.02, 0.15, 4, 8), M.black, MX(x, 0.875, z, 0, 0.3, Math.PI / 2 + 0.0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  }
  // navy blackout curtain around the chart table
  {
    const cg = new THREE.PlaneGeometry(2.0, 3.1, 40, 1); const pos = cg.attributes.position;
    for (let i = 0; i < pos.count; i++) { const u = pos.getX(i); pos.setZ(i, Math.sin(u * 22) * 0.05 * (1 - (u + 1) / 2 * 0.6)); }
    cg.computeVertexNormals();
    const cm = new THREE.Mesh(cg, std(0x1d2a44, 0.95, 0, { side: THREE.DoubleSide }));
    cm.rotation.y = Math.PI / 2; cm.scale.x = 0.45; cm.position.set(-8.35, 1.62, 5.45); bg.add(cm);
    B.box(M.greyBox, 0.05, 0.05, 2.6, -8.35, H - 0.1, 4.7);
  }
  // ---------- aft planning console (route planning ECDIS, alert management, CCTV)
  {
    const cx0 = 2.4, cx1 = 5.7, z0 = 1.3, z1 = 2.1, hh = 0.9;
    B.add(boxUV(cx1 - cx0, hh, z1 - z0, 1.1), M.consoleDoors, MX((cx0 + cx1) / 2, hh / 2, (z0 + z1) / 2));
    addCollider(cx0 - 0.05, cx1 + 0.05, z0 - 0.05, z1 + 0.15);
    const keys = [['ecdis2', 'Route planning ECDIS'], ['bams', 'Bridge alert management (BAMS)'], ['cctv', 'CCTV — cargo holds, mooring decks, engine room']];
    keys.forEach(([k, name], i) => {
      const x = cx0 + 0.55 + i * 1.1;
      const g = new THREE.Group(); g.position.set(x, hh, z0 + 0.25); g.rotation.x = 0.5; g.rotation.y = Math.PI; bg.add(g);
      g.add(meshAt(new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.6, 0.06), M.bezel), 0, 0.3, 0));
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.55), DISPLAYS[k].material); sc.position.set(0, 0.3, 0.032); g.add(sc);
      interactive(sc, { name, hint: 'Click to view full screen', click: () => UI.zoomDisplay(k) });
    });
    B.box(M.black, 0.45, 0.02, 0.16, cx0 + 1.65, hh + 0.01, z1 - 0.2);
    buildChair(bg, cx0 + 1.65, z1 + 0.75, M);
  }
  // ---------- master's office desk (port side, aft)
  {
    const dx0 = -5.9, dx1 = -2.9, dz0 = 1.4, dz1 = 2.2;
    B.box(M.teak, dx1 - dx0, 0.05, dz1 - dz0, (dx0 + dx1) / 2, 0.76, (dz0 + dz1) / 2);
    B.add(boxUV(0.5, 0.74, dz1 - dz0 - 0.05, 1.1), M.consoleDoors, MX(dx0 + 0.3, 0.37, (dz0 + dz1) / 2));
    B.add(boxUV(0.5, 0.74, dz1 - dz0 - 0.05, 1.1), M.consoleDoors, MX(dx1 - 0.3, 0.37, (dz0 + dz1) / 2));
    addCollider(dx0 - 0.05, dx1 + 0.05, dz0 - 0.05, dz1 + 0.1);
    const mon = new THREE.Group(); mon.position.set(-4.4, 0.79, dz0 + 0.18); mon.rotation.y = Math.PI; bg.add(mon);
    mon.add(meshAt(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.38, 0.04), M.bezel), 0, 0.3, 0));
    const ms = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.33), DISPLAYS.office.material); ms.position.set(0, 0.3, 0.021); mon.add(ms);
    B.box(M.greyBox, 0.05, 0.12, 0.05, -4.4, 0.85, dz0 + 0.2);
    interactive(ms, { name: 'Ship\'s office PC', hint: 'Voyage orders, port information, crew list. Click to read', click: () => UI.zoomDisplay('office') });
    B.box(M.black, 0.42, 0.02, 0.14, -4.4, 0.8, dz0 + 0.55); B.box(M.black, 0.07, 0.02, 0.1, -4.0, 0.8, dz0 + 0.55);
    B.box(std(0xe8e8e4, 0.5), 0.45, 0.22, 0.38, -5.45, 0.9, dz0 + 0.3);             // printer
    B.box(std(0xfbfbf7, 0.8), 0.21, 0.005, 0.3, -3.35, 0.79, dz0 + 0.45, 0.2);      // papers
    B.box(std(0xfbfbf7, 0.8), 0.21, 0.005, 0.3, -3.3, 0.795, dz0 + 0.5, -0.1);
    buildChair(bg, -4.4, dz1 + 0.6, M);
  }
  // ---------- coat hooks by the door: hard hats, hi-vis vests, lifejackets
  {
    B.box(M.teak, 1.3, 0.08, 0.05, -1.35, 1.85, wallZ - 0.03);
    const hat = std(0xf5f5f0, 0.4), hat2 = std(0xf2c21a, 0.4), vest = std(0xd8f000, 0.8), vest2 = std(0xf07a14, 0.8);
    [[-1.85, hat, vest], [-1.35, hat2, vest2], [-0.85, hat, vest]].forEach(([x, hm, vm]) => {
      B.box(M.steel, 0.02, 0.02, 0.1, x, 1.83, wallZ - 0.08);
      B.add(new THREE.SphereGeometry(0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), hm, MX(x, 1.9, wallZ - 0.16));
      B.add(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 16), hm, MX(x, 1.9, wallZ - 0.17));
      B.box(vm, 0.36, 0.55, 0.05, x, 1.5, wallZ - 0.06);
      B.box(std(0xd8d8d0, 0.4, 0.4), 0.36, 0.035, 0.052, x, 1.45, wallZ - 0.06);
    });
  }
  // ---------- side walls of the wheelhouse: watch schedule board and CCTV monitor
  {
    const wb = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshStandardMaterial({ map: watchBoardTexture(), roughness: 0.4 }));
    wb.position.set(-BR.CW + 0.09, 1.75, 4.4); wb.rotation.y = Math.PI / 2; bg.add(wb);
    B.box(M.chrome, 0.03, 0.96, 1.46, -BR.CW + 0.07, 1.75, 4.4);
    interactive(wb, { name: 'Watch schedule & standing orders', hint: 'Bridge watchkeeping rota and Master\'s standing orders' });
    const tv = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.62), DISPLAYS.cctv.material);
    tv.position.set(BR.CW - 0.1, 2.1, 4.4); tv.rotation.y = -Math.PI / 2; bg.add(tv);
    B.box(M.black, 0.05, 0.68, 1.16, BR.CW - 0.07, 2.1, 4.4);
    interactive(tv, { name: 'CCTV monitor', hint: 'Mooring stations fore & aft, hold 3, engine room. Click to enlarge', click: () => UI.zoomDisplay('cctv') });
    // tall publication & equipment cabinets
    for (const [x, z] of [[-BR.CW + 0.35, 2.6], [BR.CW - 0.35, 2.6]]) { B.add(boxUV(0.6, 2.0, 1.1, 1.1), M.consoleDoors, MX(x, 1.0, z)); addCollider(x - 0.3, x + 0.3, z - 0.55, z + 0.55); }
    // waste bin & fire extinguisher by the office
    B.cyl(M.greyBox, 0.14, 0.12, 0.4, -6.3, 0.2, 2.6, 14);
  }
  // ---------- meeting / pilot's table with chairs and a plant (port side, aft of the wing passage)
  {
    const tx = -9.9, tz = 0.5, tw = 1.7, td = 0.95;
    B.box(M.teak, tw, 0.05, td, tx, 0.74, tz);
    for (const dz of [-td / 2, td / 2]) B.box(M.teak, tw, 0.035, 0.03, tx, 0.78, tz + dz);          // fiddles (sea rails)
    for (const dx of [-tw / 2, tw / 2]) B.box(M.teak, 0.03, 0.035, td, tx + dx, 0.78, tz);
    for (const dx of [-0.6, 0.6]) { B.cyl(M.chrome, 0.035, 0.035, 0.72, tx + dx, 0.36, tz, 10); B.cyl(M.chrome, 0.2, 0.22, 0.03, tx + dx, 0.015, tz, 16); }
    addCollider(tx - tw / 2 - 0.05, tx + tw / 2 + 0.05, tz - td / 2 - 0.05, tz + td / 2 + 0.05);
    for (const dx of [-0.45, 0.45]) { buildMessChair(B, M, tx + dx, tz - 0.85, 0); buildMessChair(B, M, tx + dx, tz + 0.85, Math.PI); }
    addCollider(tx - 1.0, tx + 1.0, tz - 1.15, tz - 0.6); addCollider(tx - 1.0, tx + 1.0, tz + 0.6, tz + 1.15);
    // things on the table: mugs, a chart folio, walkie-talkie
    B.cyl(std(0xffffff, 0.4), 0.04, 0.035, 0.1, tx - 0.5, 0.815, tz - 0.2, 12);
    B.cyl(std(0x42b0d5, 0.4), 0.04, 0.035, 0.1, tx + 0.35, 0.815, tz + 0.25, 12);
    B.box(std(0x2a4f7a, 0.7), 0.55, 0.02, 0.4, tx + 0.1, 0.775, tz - 0.05, 0.15);
    B.box(M.black, 0.06, 0.03, 0.14, tx - 0.2, 0.78, tz + 0.2, 0.6);
    buildPlant(B, -11.3, -0.75, 1.05, 7);
    addCollider(-11.65, -10.95, -1.1, -0.4);
  }
  buildPlant(B, 11.25, 1.2, 0.95, 9); addCollider(11.0, 11.6, 0.9, 1.5);
  // coffee mug and standing-orders binder on the console
  B.cyl(std(0x42b0d5, 0.5), 0.042, 0.037, 0.1, 3.72, 0.86, -4.12, 14);
  B.box(std(0x1f3e6e, 0.7), 0.24, 0.05, 0.32, -4.15, 0.83, -4.2, 0.2);
}
