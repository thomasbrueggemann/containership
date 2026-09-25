// ============================================================================
// 01 — PROCEDURAL TEXTURES (no external assets)
// ============================================================================

// Draws blobs with wrap-around so the result tiles seamlessly.
function wrapBlob(x, cx, cy, r, w, h, fill) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const px = cx + ox * w, py = cy + oy * h;
    if (px + r < 0 || px - r > w || py + r < 0 || py - r > h) continue;
    x.fillStyle = fill; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
  }
}

function drawStar(x, cx, cy, R, color = '#fff') {
  x.fillStyle = color; x.beginPath();
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 7, rad = i % 2 === 0 ? R : R * 0.42;
    const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  }
  x.closePath(); x.fill();
}

// --------------------------------------------------------------- containers
// Atlas 1024×512: top half = long side (12.19 × 2.59 m), bottom-left = door end,
// bottom-right = roof.
function containerAtlas(kind) {
  const W = 1024, H = 512;
  const c = makeCanvas(W, H), x = c.getContext('2d');
  const b = makeCanvas(W, H), bx = b.getContext('2d');
  const base = kind === 'maersk' ? '#3f97c7' : kind === 'reefer' ? '#e9ecec' : '#dedede';
  x.fillStyle = base; x.fillRect(0, 0, W, H);
  bx.fillStyle = '#808080'; bx.fillRect(0, 0, W, H);
  // side corrugation (trapezoidal, ~ 52 pitches)
  const ridges = 54;
  for (let i = 0; i < ridges; i++) {
    const x0 = 20 + i * (W - 40) / ridges, pw = (W - 40) / ridges;
    const gr = x.createLinearGradient(x0, 0, x0 + pw, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.16)'); gr.addColorStop(0.28, 'rgba(255,255,255,0.10)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.03)'); gr.addColorStop(0.8, 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.18)');
    x.fillStyle = gr; x.fillRect(x0, 12, pw, 232);
    const gb = bx.createLinearGradient(x0, 0, x0 + pw, 0);
    gb.addColorStop(0, '#303030'); gb.addColorStop(0.3, '#d0d0d0'); gb.addColorStop(0.7, '#d0d0d0'); gb.addColorStop(1, '#303030');
    bx.fillStyle = gb; bx.fillRect(x0, 12, pw, 232);
  }
  // rails & corner posts
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 0, W, 12); x.fillRect(0, 244, W, 12);
  x.fillRect(0, 0, 20, 256); x.fillRect(W - 20, 0, 20, 256);
  x.fillStyle = 'rgba(20,20,20,0.7)';
  for (const [px, py] of [[0, 0], [W - 20, 0], [0, 240], [W - 20, 240]]) x.fillRect(px, py, 20, 16);
  bx.fillStyle = '#ffffff'; bx.fillRect(0, 0, W, 12); bx.fillRect(0, 244, W, 12); bx.fillRect(0, 0, 20, 256); bx.fillRect(W - 20, 0, 20, 256);

  if (kind === 'maersk') {
    x.fillStyle = '#ffffff';
    x.font = '800 118px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    x.textBaseline = 'middle'; x.textAlign = 'left';
    x.save(); x.scale(1.0, 1.0);
    x.fillText('MAERSK', 330, 130);
    x.restore();
    // star logo square
    x.fillStyle = '#ffffff'; x.fillRect(190, 72, 116, 116);
    x.fillStyle = '#3f97c7'; x.fillRect(196, 78, 104, 104);
    drawStar(x, 248, 131, 46, '#ffffff');
  }
  if (kind === 'reefer') {
    x.fillStyle = 'rgba(40,40,40,0.2)'; x.fillRect(W - 120, 20, 90, 220);
  }
  // id codes near the door end (top-right)
  x.fillStyle = kind === 'generic' ? 'rgba(255,255,255,0.9)' : '#fff';
  x.font = '600 20px ui-monospace, Menlo, monospace'; x.textAlign = 'right';
  x.fillText(kind === 'maersk' ? 'MSKU 739214 5' : 'TGHU 610822 1', W - 34, 34);
  x.font = '600 16px ui-monospace, Menlo, monospace'; x.fillText(kind === 'reefer' ? '45R1' : '45G1', W - 34, 58);

  // door end (bottom-left 256×256)
  x.fillStyle = base; x.fillRect(0, 256, 256, 256);
  x.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 12; i++) x.fillRect(14 + i * 19, 270, 9, 228);
  x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(126, 262, 4, 244);
  x.fillStyle = 'rgba(40,40,40,0.8)';
  for (const bxp of [40, 88, 168, 216]) x.fillRect(bxp, 262, 5, 244);
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 256, 256, 10); x.fillRect(0, 502, 256, 10);
  bx.fillStyle = '#b0b0b0'; bx.fillRect(0, 256, 256, 256);
  // roof (bottom-right)
  x.fillStyle = base; x.fillRect(256, 256, 768, 256);
  for (let i = 0; i < 40; i++) { x.fillStyle = i % 2 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)'; x.fillRect(256 + i * 19.2, 256, 9.6, 256); }

  // weathering & grime
  const R = mulberry32(kind.length * 13);
  for (let i = 0; i < 900; i++) {
    const px = R() * W, py = R() * H, r = 1 + R() * 5;
    x.fillStyle = `rgba(${R() < 0.5 ? '60,40,25' : '0,0,0'},${0.03 + R() * 0.07})`;
    x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }
  for (let i = 0; i < 70; i++) { // rust streaks
    const px = R() * W, py = R() < 0.5 ? 12 : 256 + 10;
    const g = x.createLinearGradient(0, py, 0, py + 60 + R() * 120);
    g.addColorStop(0, 'rgba(110,55,25,0.25)'); g.addColorStop(1, 'rgba(110,55,25,0)');
    x.fillStyle = g; x.fillRect(px, py, 2 + R() * 3, 180);
  }
  const map = canvasTexture(c); map.anisotropy = 8;
  const bump = canvasTexture(b, { linear: true });
  return { map, bump };
}

function containerGeometry(len = 12.19, w = 2.44, h = 2.59) {
  const g = new THREE.BoxGeometry(w, h, len);
  const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k, u = uv.getX(i), v = uv.getY(i);
      let nu, nv;
      if (f === 0 || f === 1) { nu = u; nv = 0.5 + 0.5 * v; }          // long sides
      else if (f === 2 || f === 3) { nu = 0.25 + 0.75 * v; nv = 0.5 * u; } // roof / floor
      else { nu = 0.25 * u; nv = 0.5 * v; }                              // ends
      uv.setXY(i, nu, nv);
    }
  }
  return g;
}

// --------------------------------------------------------------- water
function waterNormalTexture() {
  const N = 512, c = makeCanvas(N, N), x = c.getContext('2d');
  const img = x.createImageData(N, N);
  const R = mulberry32(99);
  const waves = [];
  for (let i = 0; i < 90; i++) {
    const k = 3 + Math.pow(R(), 1.5) * 34, th = R() * Math.PI * 2;
    const kx = Math.round(Math.cos(th) * k), ky = Math.round(Math.sin(th) * k);
    if (!kx && !ky) continue;
    const kk = Math.hypot(kx, ky);
    waves.push([kx, ky, 1 / Math.pow(kk, 1.55), R() * Math.PI * 2]);
  }
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let s = 0; const u = i / N * Math.PI * 2, v = j / N * Math.PI * 2;
    for (const [kx, ky, a, p] of waves) { const ph = kx * u + ky * v + p; s += a * (Math.sin(ph) - 0.35 * Math.abs(Math.cos(ph))); }
    h[j * N + i] = s;
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const hl = h[j * N + ((i - 1 + N) % N)], hr = h[j * N + ((i + 1) % N)];
    const hd = h[((j - 1 + N) % N) * N + i], hu = h[((j + 1) % N) * N + i];
    let nx = (hl - hr) * 9, ny = (hd - hu) * 9, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (j * N + i) * 4;
    img.data[o] = (nx * 0.5 + 0.5) * 255; img.data[o + 1] = (ny * 0.5 + 0.5) * 255; img.data[o + 2] = (nz * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = canvasTexture(c, { linear: true, repeat: [1, 1] });
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function foamTexture() {
  const N = 256, c = makeCanvas(N, N), x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, N, N);
  const R = mulberry32(5);
  for (let i = 0; i < 520; i++) {
    const r = 1 + Math.pow(R(), 3) * 16;
    wrapBlob(x, R() * N, R() * N, r, N, N, `rgba(255,255,255,${0.08 + R() * 0.35})`);
  }
  for (let i = 0; i < 1400; i++) wrapBlob(x, R() * N, R() * N, 0.6 + R() * 1.5, N, N, `rgba(255,255,255,${0.3 + R() * 0.5})`);
  return canvasTexture(c, { linear: true, repeat: [1, 1] });
}

// --------------------------------------------------------------- ground
function groundTexture(kind) {
  const N = 512, c = makeCanvas(N, N), x = c.getContext('2d');
  const R = mulberry32(kind.length * 31 + 7);
  const pal = {
    concrete: ['#8f9191', [[70, 70, 70], [150, 150, 145]], 0.06],
    asphalt: ['#3f4244', [[20, 20, 22], [110, 110, 110]], 0.08],
    grass: ['#5d6b3c', [[60, 80, 35], [120, 125, 70]], 0.12],
    sand: ['#c9b58c', [[150, 130, 95], [225, 210, 175]], 0.09],
    rock: ['#6d6c67', [[40, 40, 38], [150, 148, 140]], 0.25],
  }[kind];
  x.fillStyle = pal[0]; x.fillRect(0, 0, N, N);
  const n = kind === 'rock' ? 900 : 2600;
  for (let i = 0; i < n; i++) {
    const col = pal[1][R() < 0.5 ? 0 : 1];
    const r = kind === 'rock' ? 4 + R() * 22 : 1 + Math.pow(R(), 2) * 18;
    wrapBlob(x, R() * N, R() * N, r, N, N, `rgba(${col[0]},${col[1]},${col[2]},${pal[2] * (0.4 + R())})`);
  }
  if (kind === 'concrete') { // slab joints
    x.strokeStyle = 'rgba(40,40,40,0.35)'; x.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 128, 0); x.lineTo(i * 128, N); x.stroke(); x.beginPath(); x.moveTo(0, i * 128); x.lineTo(N, i * 128); x.stroke(); }
  }
  if (kind === 'rock') { // shaded boulders
    for (let i = 0; i < 260; i++) {
      const cx = R() * N, cy = R() * N, r = 8 + R() * 22;
      const g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r);
      const l = 90 + R() * 70; g.addColorStop(0, `rgba(${l + 40},${l + 38},${l + 32},0.9)`); g.addColorStop(1, `rgba(${l * 0.35},${l * 0.35},${l * 0.33},0.9)`);
      wrapBlob(x, cx, cy, r, N, N, g);
    }
  }
  return canvasTexture(c, { repeat: [1, 1] });
}

// facade with window grid (deckhouses, buildings)
function facadeTexture(o) {
  const W = o.w || 512, H = o.h || 512, c = makeCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = o.wall || '#e9ecec'; x.fillRect(0, 0, W, H);
  const R = mulberry32(o.seed || 3);
  const cols = o.cols, rows = o.rows;
  const cw = W / cols, rh = H / rows;
  for (let r = 0; r < rows; r++) {
    x.fillStyle = 'rgba(0,0,0,0.06)'; x.fillRect(0, r * rh + rh - 3, W, 3);
    for (let k = 0; k < cols; k++) {
      if (o.skip && R() < o.skip) continue;
      const lit = o.night && R() < (o.litP ?? 0.45);
      x.fillStyle = lit ? `rgb(${230 + R() * 25},${190 + R() * 40},${120 + R() * 50})` : (o.glass || '#23384a');
      x.fillRect(k * cw + cw * (o.mx ?? 0.2), r * rh + rh * (o.my ?? 0.25), cw * (1 - 2 * (o.mx ?? 0.2)), rh * (o.wh ?? 0.45));
      if (!lit) { x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(k * cw + cw * (o.mx ?? 0.2), r * rh + rh * (o.my ?? 0.25), cw * (1 - 2 * (o.mx ?? 0.2)) * 0.4, rh * (o.wh ?? 0.45)); }
    }
  }
  for (let i = 0; i < 200; i++) { x.fillStyle = `rgba(80,70,60,${R() * 0.05})`; x.fillRect(R() * W, R() * H, 2 + R() * 40, 2 + R() * 30); }
  return canvasTexture(c);
}

function emissiveWindowsTexture(o) { // black with lit windows – used as emissiveMap at night
  const W = o.w || 512, H = o.h || 512, c = makeCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  const R = mulberry32(o.seed || 3);
  const cw = W / o.cols, rh = H / o.rows;
  for (let r = 0; r < o.rows; r++) for (let k = 0; k < o.cols; k++) {
    if (o.skip && R() < o.skip) continue;
    const lit = R() < (o.litP ?? 0.45);
    if (!lit) continue;
    x.fillStyle = `rgb(${230 + R() * 25},${180 + R() * 50},${110 + R() * 60})`;
    x.fillRect(k * cw + cw * (o.mx ?? 0.2), r * rh + rh * (o.my ?? 0.25), cw * (1 - 2 * (o.mx ?? 0.2)), rh * (o.wh ?? 0.45));
  }
  return canvasTexture(c);
}

function stripesTexture(c1, c2, n = 8, vertical = false) {
  const c = makeCanvas(64, 64), x = c.getContext('2d');
  for (let i = 0; i < n; i++) { x.fillStyle = i % 2 ? c2 : c1; vertical ? x.fillRect(i * 64 / n, 0, 64 / n, 64) : x.fillRect(0, i * 64 / n, 64, 64 / n); }
  return canvasTexture(c);
}

function panelTexture(base = '#39424a', seed = 1) {
  const c = makeCanvas(256, 256), x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  const R = mulberry32(seed);
  for (let i = 0; i < 1600; i++) { x.fillStyle = `rgba(${R() < 0.5 ? 0 : 255},${R() < 0.5 ? 0 : 255},${R() < 0.5 ? 0 : 255},0.018)`; x.fillRect(R() * 256, R() * 256, 2, 2); }
  return canvasTexture(c, { repeat: [1, 1] });
}
