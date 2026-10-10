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

// --------------------------------------------------------------- height → normal map
// Canvas height field (grey 128 = flat) → tangent-space normal map. Wraps at the edges, so tileable heights stay tileable.
function heightToNormalTexture(hc, strength = 2, opts = {}) {
  const w = hc.width, h = hc.height, src = hc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const out = new Uint8ClampedArray(w * h * 4), H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
    const dx = (H(xx + 1, y) - H(xx - 1, y)) * strength, dy = (H(xx, y - 1) - H(xx, y + 1)) * strength;   // +v is up the canvas
    const l = Math.hypot(dx, dy, 1), o = (y * w + xx) * 4;
    out[o] = (-dx / l * 0.5 + 0.5) * 255; out[o + 1] = (-dy / l * 0.5 + 0.5) * 255; out[o + 2] = (1 / l * 0.5 + 0.5) * 255; out[o + 3] = 255;
  }
  const nc = makeCanvas(w, h); nc.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
  return canvasTexture(nc, { linear: true, aniso: opts.aniso ?? 8 });
}

// --------------------------------------------------------------- containers
// Atlas 1024×512: top half = long side (12.19 × 2.59 m), bottom-left = door end,
// bottom-right = roof. Returns colour, normal and packed ORM (g = roughness, b = metalness) maps.
function containerAtlas(kind) {
  const W = 1024, H = 512;
  const c = makeCanvas(W, H), x = c.getContext('2d');
  const hc = makeCanvas(W, H), hx = hc.getContext('2d');          // height
  const oc = makeCanvas(W, H), ox = oc.getContext('2d');          // occlusion / roughness / metalness
  const R = mulberry32(kind.length * 13 + 5);
  const base = kind === 'maersk' ? '#3f97c7' : kind === 'reefer' ? '#e9ecec' : '#dedede';
  x.fillStyle = base; x.fillRect(0, 0, W, H);
  hx.fillStyle = '#808080'; hx.fillRect(0, 0, W, H);
  ox.fillStyle = 'rgb(255,138,10)'; ox.fillRect(0, 0, W, H);
  // roof and door end are painted a little rougher than the side walls
  ox.fillStyle = 'rgb(255,186,12)'; ox.fillRect(256, 256, 768, 256);
  ox.fillStyle = 'rgb(255,152,10)'; ox.fillRect(0, 256, 256, 256);

  // ---- side corrugation: trapezoid profile (≈ 54 pitches), valleys slightly darker and shielded
  const ridges = 54, rw = (W - 40) / ridges;
  for (let i = 0; i < ridges; i++) {
    const x0 = 20 + i * rw;
    const gr = x.createLinearGradient(x0, 0, x0 + rw, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.10)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.65, 'rgba(255,255,255,0.03)'); gr.addColorStop(0.85, 'rgba(0,0,0,0.09)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)');
    x.fillStyle = gr; x.fillRect(x0, 12, rw, 232);
    const gh = hx.createLinearGradient(x0, 0, x0 + rw, 0);
    gh.addColorStop(0, '#303030'); gh.addColorStop(0.2, '#303030'); gh.addColorStop(0.36, '#d8d8d8'); gh.addColorStop(0.62, '#d8d8d8'); gh.addColorStop(0.78, '#303030'); gh.addColorStop(1, '#303030');
    hx.fillStyle = gh; hx.fillRect(x0, 12, rw, 232);
    const go = ox.createLinearGradient(x0, 0, x0 + rw, 0);          // ridges are polished a little by rubbing lashings, valleys keep the dirt
    go.addColorStop(0, 'rgb(215,160,10)'); go.addColorStop(0.4, 'rgb(255,118,10)'); go.addColorStop(0.62, 'rgb(255,118,10)'); go.addColorStop(1, 'rgb(215,160,10)');
    ox.fillStyle = go; ox.fillRect(x0, 12, rw, 232);
  }
  // ---- rails and corner posts: smooth, raised, darker
  x.fillStyle = 'rgba(0,0,0,0.30)'; x.fillRect(0, 0, W, 12); x.fillRect(0, 244, W, 12); x.fillRect(0, 0, 20, 256); x.fillRect(W - 20, 0, 20, 256);
  hx.fillStyle = '#c4c4c4'; hx.fillRect(0, 0, W, 12); hx.fillRect(0, 244, W, 12); hx.fillRect(0, 0, 20, 256); hx.fillRect(W - 20, 0, 20, 256);
  ox.fillStyle = 'rgb(255,150,14)'; ox.fillRect(0, 0, W, 12); ox.fillRect(0, 244, W, 12); ox.fillRect(0, 0, 20, 256); ox.fillRect(W - 20, 0, 20, 256);
  // corner castings: dark, rough, a bit metallic
  for (const [px, py] of [[0, 0], [W - 20, 0], [0, 238], [W - 20, 238]]) {
    x.fillStyle = 'rgba(25,25,25,0.78)'; x.fillRect(px, py, 20, 18);
    hx.fillStyle = '#e8e8e8'; hx.fillRect(px, py, 20, 18);
    ox.fillStyle = 'rgb(220,215,60)'; ox.fillRect(px, py, 20, 18);
  }
  if (kind === 'maersk') {
    x.fillStyle = '#ffffff'; x.font = '800 118px "Arial Black", "Helvetica Neue", Arial, sans-serif'; x.textBaseline = 'middle'; x.textAlign = 'left';
    x.fillText('MAERSK', 330, 130);
    x.fillStyle = '#ffffff'; x.fillRect(190, 72, 116, 116); x.fillStyle = '#3f97c7'; x.fillRect(196, 78, 104, 104);
    drawStar(x, 248, 131, 46, '#ffffff');
    // the decals are flat paint on top of the corrugation: slightly raised, smoother
    hx.fillStyle = 'rgba(160,160,160,0.35)'; hx.fillRect(190, 72, 640, 116);
  }
  if (kind === 'reefer') {
    x.fillStyle = 'rgba(40,40,40,0.2)'; x.fillRect(W - 120, 20, 90, 220);
    hx.fillStyle = '#a0a0a0'; hx.fillRect(W - 120, 20, 90, 220);                 // refrigeration unit panel
    for (let k = 0; k < 9; k++) { hx.fillStyle = '#606060'; hx.fillRect(W - 112, 34 + k * 22, 74, 6); }
  }
  x.fillStyle = kind === 'generic' ? 'rgba(255,255,255,0.9)' : '#fff';
  x.font = '600 20px ui-monospace, Menlo, monospace'; x.textAlign = 'right';
  x.fillText(kind === 'maersk' ? 'MSKU 739214 5' : 'TGHU 610822 1', W - 34, 34);
  x.font = '600 16px ui-monospace, Menlo, monospace'; x.fillText(kind === 'reefer' ? '45R1' : '45G1', W - 34, 58);

  // ---- door end (bottom-left 256×256): door panels, vertical locking rods and cams, hinges
  x.fillStyle = base; x.fillRect(0, 256, 256, 256);
  x.fillStyle = 'rgba(0,0,0,0.10)'; for (let i = 0; i < 12; i++) x.fillRect(14 + i * 19, 270, 9, 228);
  hx.fillStyle = '#707070'; for (let i = 0; i < 12; i++) hx.fillRect(14 + i * 19, 270, 9, 228);
  for (const door of [[12, 118], [134, 118]]) { hx.strokeStyle = '#d0d0d0'; hx.lineWidth = 4; hx.strokeRect(door[0], 264, door[1], 238); }
  x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(126, 262, 4, 244); hx.fillStyle = '#202020'; hx.fillRect(125, 262, 6, 244);
  for (const bxp of [40, 88, 168, 216]) {
    x.fillStyle = 'rgba(55,55,55,0.85)'; x.fillRect(bxp, 262, 5, 244);
    const gr = hx.createLinearGradient(bxp, 0, bxp + 7, 0); gr.addColorStop(0, '#808080'); gr.addColorStop(0.5, '#f0f0f0'); gr.addColorStop(1, '#808080'); hx.fillStyle = gr; hx.fillRect(bxp - 1, 262, 7, 244);
    ox.fillStyle = 'rgb(255,120,150)'; ox.fillRect(bxp, 262, 5, 244);
    for (const cy of [290, 380, 470]) { x.fillStyle = 'rgba(30,30,30,0.9)'; x.fillRect(bxp - 3, cy, 12, 9); hx.fillStyle = '#ffffff'; hx.fillRect(bxp - 3, cy, 12, 9); }
  }
  x.fillStyle = 'rgba(0,0,0,0.30)'; x.fillRect(0, 256, 256, 10); x.fillRect(0, 502, 256, 10);
  hx.fillStyle = '#c4c4c4'; hx.fillRect(0, 256, 256, 10); hx.fillRect(0, 502, 256, 10);
  // ---- roof (bottom-right): shallow ribs along the width, frame around it
  x.fillStyle = base; x.fillRect(256, 256, 768, 256);
  for (let i = 0; i < 40; i++) {
    x.fillStyle = i % 2 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)'; x.fillRect(256 + i * 19.2, 256, 9.6, 256);
    hx.fillStyle = i % 2 ? '#6c6c6c' : '#989898'; hx.fillRect(256 + i * 19.2, 256, 9.6, 256);
  }
  hx.fillStyle = '#c0c0c0'; hx.fillRect(256, 256, 768, 10); hx.fillRect(256, 502, 768, 10);

  // ---- weathering: grime, repaints, rust at the edges, dents, scuffs
  for (let i = 0; i < 700; i++) {
    const px = R() * W, py = R() * H, r = 1 + R() * 6;
    x.fillStyle = `rgba(${R() < 0.5 ? '60,40,25' : '0,0,0'},${0.025 + R() * 0.06})`; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }
  for (let i = 0; i < 5; i++) {                                   // repainted panels: a slightly different tone
    const px = 40 + R() * (W - 200), w = 80 + R() * 220, py = 14, hgt = 228;
    x.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'; x.fillRect(px, py, w, hgt);
    ox.fillStyle = 'rgba(255,40,0,0.18)'; ox.fillRect(px, py, w, hgt);                      // new paint is glossier
  }
  const grime = x.createLinearGradient(0, 0, 0, 256); grime.addColorStop(0, 'rgba(0,0,0,0)'); grime.addColorStop(0.7, 'rgba(40,30,20,0.0)'); grime.addColorStop(1, 'rgba(40,30,20,0.28)');
  x.fillStyle = grime; x.fillRect(0, 0, W, 256);
  for (let i = 0; i < 90; i++) {                                  // rust runs from the rails and corners
    const px = R() < 0.4 ? (R() < 0.5 ? 6 + R() * 14 : W - 26 + R() * 14) : R() * W, py = R() < 0.5 ? 12 : 256 + 6;
    const len = 30 + R() * 140, g = x.createLinearGradient(0, py, 0, py + len);
    g.addColorStop(0, `rgba(120,58,26,${0.18 + R() * 0.25})`); g.addColorStop(1, 'rgba(120,58,26,0)');
    x.fillStyle = g; x.fillRect(px, py, 1.5 + R() * 3.5, len);
    ox.fillStyle = g; ox.globalAlpha = 0.5; ox.fillStyle = 'rgb(255,215,40)'; ox.fillRect(px, py, 2 + R() * 3, len * 0.6); ox.globalAlpha = 1;
  }
  for (let i = 0; i < 26; i++) {                                  // rust blooms on the lower rail and around the corner castings
    const px = R() * W, py = 236 + R() * 20, r = 3 + R() * 9;
    const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(110,52,22,0.55)'); g.addColorStop(1, 'rgba(110,52,22,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
    ox.fillStyle = 'rgb(255,225,35)'; ox.globalAlpha = 0.6; ox.beginPath(); ox.arc(px, py, r * 0.8, 0, 7); ox.fill(); ox.globalAlpha = 1;
  }
  for (let i = 0; i < 16; i++) {                                  // dents
    const px = 40 + R() * (W - 80), py = 30 + R() * 190, r = 8 + R() * 24;
    const g = hx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(40,40,40,0.55)'); g.addColorStop(0.7, 'rgba(60,60,60,0.2)'); g.addColorStop(1, 'rgba(128,128,128,0)');
    hx.fillStyle = g; hx.beginPath(); hx.arc(px, py, r, 0, 7); hx.fill();
  }
  for (let i = 0; i < 60; i++) {                                  // scuffs and scratches: bare steel shows through
    const px = R() * W, py = 14 + R() * 228, len = 6 + R() * 30, an = R() * 3.14;
    x.strokeStyle = `rgba(${R() < 0.5 ? '150,150,150' : '70,40,25'},${0.15 + R() * 0.2})`; x.lineWidth = 0.6 + R(); x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(an) * len, py + Math.sin(an) * len); x.stroke();
    ox.strokeStyle = 'rgba(255,200,80,0.7)'; ox.lineWidth = 1; ox.beginPath(); ox.moveTo(px, py); ox.lineTo(px + Math.cos(an) * len, py + Math.sin(an) * len); ox.stroke();
  }
  // fine grain in height and roughness
  for (let i = 0; i < 14000; i++) { const g = 120 + R() * 16; hx.fillStyle = `rgba(${g},${g},${g},0.5)`; hx.fillRect(R() * W, R() * H, 1 + R() * 2, 1 + R() * 2); }
  for (let i = 0; i < 6000; i++) { ox.fillStyle = `rgba(255,${R() < 0.5 ? 175 : 110},10,0.25)`; ox.fillRect(R() * W, R() * H, 2 + R() * 3, 2 + R() * 3); }
  const map = canvasTexture(c); map.anisotropy = 8;
  return { map, normal: heightToNormalTexture(hc, 2.4), orm: canvasTexture(oc, { linear: true }) };
}

// --------------------------------------------------------------- ship plating
// Welded shell plating, tile = 24 m × 12 m (2 plates × 4 strakes). Normal map + packed ORM, shared by all ships.
let _hullPlates = null;
function hullPlateTextures() {
  if (_hullPlates) return _hullPlates;
  const W = 2048, H = 1024, hc = makeCanvas(W, H), hx = hc.getContext('2d'), oc = makeCanvas(W, H), ox = oc.getContext('2d');
  const R = mulberry32(2718), pm = W / 24;                         // px per metre (both axes: tile is 24 × 12 m on 2048 × 1024)
  hx.fillStyle = '#808080'; hx.fillRect(0, 0, W, H);
  ox.fillStyle = 'rgb(255,128,14)'; ox.fillRect(0, 0, W, H);
  const plates = [];                                               // 4 rows of 3 m, plates 12 m long, alternate rows offset by 6 m
  for (let r = 0; r < 4; r++) for (let k = -1; k < 3; k++) plates.push([(k * 12 + (r % 2 ? 6 : 0)) * pm, r * 3 * pm, 12 * pm, 3 * pm]);
  for (const [px, py, pw, ph] of plates) {
    // dishing between the frames: shallow bulges every ~0.8 m, a slightly different gloss per plate (repainted plates)
    const nb = Math.round(pw / (0.8 * pm));
    for (let i = 0; i < nb; i++) {
      const bx = px + (i + 0.5) * pw / nb, g = hx.createLinearGradient(bx - pw / nb / 2, 0, bx + pw / nb / 2, 0);
      g.addColorStop(0, 'rgba(128,128,128,0)'); g.addColorStop(0.5, `rgba(${R() < 0.5 ? '170,170,170' : '96,96,96'},${0.09 + R() * 0.11})`); g.addColorStop(1, 'rgba(128,128,128,0)');
      hx.fillStyle = g; hx.fillRect(bx - pw / nb / 2, py, pw / nb, ph);
    }
    ox.fillStyle = `rgba(255,${R() < 0.5 ? 40 : 0},0,${R() * 0.22})`; ox.fillRect(px, py, pw, ph);
  }
  // weld seams: raised bead flanked by a shallow groove (and a rougher, unpainted look)
  const seam = (x0, y0, x1, y1) => {
    hx.lineCap = 'butt';
    hx.strokeStyle = 'rgba(70,70,70,0.9)'; hx.lineWidth = 0.075 * pm; hx.beginPath(); hx.moveTo(x0, y0); hx.lineTo(x1, y1); hx.stroke();
    hx.strokeStyle = 'rgba(205,205,205,0.95)'; hx.lineWidth = 0.035 * pm; hx.beginPath(); hx.moveTo(x0, y0); hx.lineTo(x1, y1); hx.stroke();
    ox.strokeStyle = 'rgb(255,190,14)'; ox.lineWidth = 0.08 * pm; ox.beginPath(); ox.moveTo(x0, y0); ox.lineTo(x1, y1); ox.stroke();
  };
  for (let r = 0; r <= 4; r++) seam(0, r * 3 * pm, W, r * 3 * pm);
  for (let r = 0; r < 4; r++) for (let k = -1; k < 3; k++) { const xx = (k * 12 + (r % 2 ? 6 : 0)) * pm; for (const o of [0, W]) seam(xx + o, r * 3 * pm, xx + o, (r + 1) * 3 * pm); }
  // pitting, small dents and fine grain
  for (let i = 0; i < 2600; i++) { const px = R() * W, py = R() * H, r = 0.5 + R() * 2.2; hx.fillStyle = `rgba(${R() < 0.6 ? 100 : 160},${R() < 0.6 ? 100 : 160},${R() < 0.6 ? 100 : 160},0.45)`; hx.beginPath(); hx.arc(px, py, r, 0, 7); hx.fill(); }
  for (let i = 0; i < 40; i++) { const px = R() * W, py = R() * H, r = 14 + R() * 40; const g = hx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(${R() < 0.5 ? 70 : 190},0,0,0)`); g.addColorStop(0, R() < 0.5 ? 'rgba(80,80,80,0.5)' : 'rgba(180,180,180,0.4)'); g.addColorStop(1, 'rgba(128,128,128,0)'); hx.fillStyle = g; hx.beginPath(); hx.arc(px, py, r, 0, 7); hx.fill(); }
  for (let i = 0; i < 9000; i++) { const g = 118 + R() * 22; hx.fillStyle = `rgba(${g},${g},${g},0.35)`; hx.fillRect(R() * W, R() * H, 1 + R() * 2, 1 + R() * 2); }
  for (let i = 0; i < 5000; i++) { ox.fillStyle = `rgba(255,${R() < 0.5 ? 175 : 100},12,0.22)`; ox.fillRect(R() * W, R() * H, 2 + R() * 4, 2 + R() * 4); }
  const normal = heightToNormalTexture(hc, 3.0, { aniso: 16 });
  const orm = canvasTexture(oc, { linear: true, aniso: 8 });
  for (const t of [normal, orm]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return (_hullPlates = { normal, orm });
}

// Lit windows for the facade above: an 8 × 10 module sheet (51 × 32 m), so every module gets its own random lights.
// Use with emissiveMap.repeat = (1/8, 1/10) on the deckhouse material.
function deckhouseEmissive(seed = 3, litP = 0.4) {
  const MW = 128, MH = 64, c = makeCanvas(MW * 8, MH * 10), x = c.getContext('2d'), R = mulberry32(seed * 977 + 5);
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
  for (let r = 0; r < 10; r++) for (let k = 0; k < 8; k++) for (const cx of [1.6, 4.8]) {
    if (R() > litP) continue;
    const wx = k * MW + (cx - 0.78) / 6.4 * MW, wy = r * MH + (1.0 / 3.2) * MH, ww = 1.56 / 6.4 * MW, wh = 1.15 / 3.2 * MH;
    x.fillStyle = `rgb(${235 + R() * 20},${185 + R() * 45},${110 + R() * 70})`; x.fillRect(wx, wy, ww, wh);
  }
  const t = canvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 8, 1 / 10);
  return t;
}

// --------------------------------------------------------------- accommodation facade
// One deck module 6.4 m × 3.2 m (512 × 256): white paint, two windows with dark glossy glass, frames, kick plate, deck ledge.
// Returns colour + ORM; the top-left 40×40 px is plain paint, used for roofs / undersides.
let _deckFacade = null;
function deckhouseFacadeTextures() {
  if (_deckFacade) return _deckFacade;
  const W = 512, H = 256, c = makeCanvas(W, H), x = c.getContext('2d'), oc = makeCanvas(W, H), ox = oc.getContext('2d'), hc = makeCanvas(W, H), hx = hc.getContext('2d');
  const R = mulberry32(31), px = W / 6.4;
  x.fillStyle = '#eceeed'; x.fillRect(0, 0, W, H);
  ox.fillStyle = 'rgb(255,140,10)'; ox.fillRect(0, 0, W, H);
  hx.fillStyle = '#808080'; hx.fillRect(0, 0, W, H);
  // vertical stiffener seams every 1.6 m
  for (let i = 0; i < 4; i++) { const sx = i * W / 4; x.fillStyle = 'rgba(0,0,0,0.07)'; x.fillRect(sx, 0, 2, H); hx.fillStyle = '#b0b0b0'; hx.fillRect(sx, 0, 2, H); }
  // deck ledge at the bottom, and a lighter band at the top
  x.fillStyle = 'rgba(0,0,0,0.20)'; x.fillRect(0, H - 6, W, 6); hx.fillStyle = '#d8d8d8'; hx.fillRect(0, H - 6, W, 4); hx.fillStyle = '#505050'; hx.fillRect(0, H - 2, W, 2);
  for (const cx of [1.6, 4.8]) {
    const wx = (cx - 0.78) * px, wy = 1.0 * px, ww = 1.56 * px, wh = 1.15 * px;
    // aluminium frame
    x.fillStyle = '#9aa3a8'; x.fillRect(wx - 5, wy - 5, ww + 10, wh + 10); hx.fillStyle = '#b8b8b8'; hx.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
    ox.fillStyle = 'rgb(255,110,150)'; ox.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
    // glass: dark blue-grey with a faint vertical gradient; recessed, very smooth
    const g = x.createLinearGradient(0, wy, 0, wy + wh); g.addColorStop(0, '#2b4254'); g.addColorStop(1, '#16222c');
    x.fillStyle = g; x.fillRect(wx, wy, ww, wh); hx.fillStyle = '#585858'; hx.fillRect(wx, wy, ww, wh);
    ox.fillStyle = 'rgb(255,14,0)'; ox.fillRect(wx, wy, ww, wh);
    // mullion
    x.fillStyle = '#9aa3a8'; x.fillRect(wx + ww / 2 - 2, wy, 4, wh); hx.fillStyle = '#c0c0c0'; hx.fillRect(wx + ww / 2 - 2, wy, 4, wh); ox.fillStyle = 'rgb(255,110,150)'; ox.fillRect(wx + ww / 2 - 2, wy, 4, wh);
    // sill and kick plate
    x.fillStyle = 'rgba(0,0,0,0.13)'; x.fillRect(wx - 5, wy + wh + 5, ww + 10, 10); hx.fillStyle = '#d0d0d0'; hx.fillRect(wx - 6, wy + wh + 5, ww + 12, 4);
  }
  // paint wear and streaks under the windows
  for (let i = 0; i < 40; i++) { const sx = R() * W, g = x.createLinearGradient(0, 150, 0, 256); g.addColorStop(0, 'rgba(90,70,50,0.10)'); g.addColorStop(1, 'rgba(90,70,50,0)'); x.fillStyle = g; x.fillRect(sx, 150, 1 + R() * 3, 106); }
  x.fillStyle = '#eceeed'; x.fillRect(0, 0, 40, 40); hx.fillStyle = '#808080'; hx.fillRect(0, 0, 40, 40); ox.fillStyle = 'rgb(255,140,10)'; ox.fillRect(0, 0, 40, 40);
  const map = canvasTexture(c, { aniso: 8 }), orm = canvasTexture(oc, { linear: true }), normal = heightToNormalTexture(hc, 2.2);
  for (const t of [map, orm, normal]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return (_deckFacade = { map, orm, normal });
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
  return ATMOS.bake2D(512, `
    varying vec2 vUv;
    vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec2 worley(vec2 p, vec2 per){
      vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 n = vec2(float(x), float(y)); vec2 df = n + h22(mod(i + n, per)) - f; float d = dot(df, df);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      return sqrt(vec2(d1, d2));
    }
    float vn(vec2 p, vec2 per){
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(mod(i, per)), h21(mod(i + vec2(1, 0), per)), f.x), mix(h21(mod(i + vec2(0, 1), per)), h21(mod(i + vec2(1, 1), per)), f.x), f.y);
    }
    void main(){
      vec2 uv = vUv;
      vec2 w1 = worley(uv * 18.0, vec2(18.0)), w2 = worley(uv * 40.0, vec2(40.0)), w3 = worley(uv * 86.0, vec2(86.0));
      float lace = (1.0 - smoothstep(0.0, 0.24, w1.y - w1.x)) * 0.55 + (1.0 - smoothstep(0.0, 0.2, w2.y - w2.x)) * 0.45 + (1.0 - smoothstep(0.0, 0.17, w3.y - w3.x)) * 0.3;
      float clump = vn(uv * 6.0, vec2(6.0)) * 0.55 + vn(uv * 13.0, vec2(13.0)) * 0.3 + vn(uv * 29.0, vec2(29.0)) * 0.15;
      float thick = smoothstep(0.32, 0.72, clump + (1.0 - worley(uv * 7.0, vec2(7.0)).x) * 0.35 - 0.2);
      float streak = vn(vec2(uv.x * 3.0, uv.y * 34.0), vec2(3.0, 34.0)) * 0.6 + vn(vec2(uv.x * 7.0, uv.y * 70.0), vec2(7.0, 70.0)) * 0.4;
      // a: rank for thresholding white water: it survives longest on the walls of bubble cells (three sizes) and in clumps
      vec2 c1 = worley(uv * 5.0 + 0.37, vec2(5.0)), c2 = worley(uv * 13.0 + 0.71, vec2(13.0)), c3 = worley(uv * 31.0, vec2(31.0));
      float rank = 0.5 * (1.0 - clamp((c1.y - c1.x) / 0.55, 0.0, 1.0)) + 0.32 * (1.0 - clamp((c2.y - c2.x) / 0.5, 0.0, 1.0))
                 + 0.18 * (1.0 - clamp((c3.y - c3.x) / 0.45, 0.0, 1.0)) + 0.35 * (clump - 0.5);
      // equalised (measured quantiles -> uniform), so a threshold of 1 − C leaves the fraction C covered
      const float RQ[9] = float[9](0.0, 0.15, 0.22, 0.31, 0.44, 0.56, 0.67, 0.81, 1.0);
      const float RP[9] = float[9](0.0, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0);
      float eq = 1.0;
      for (int k = 1; k < 9; k++) if (rank < RQ[k]) { eq = mix(RP[k - 1], RP[k], clamp((rank - RQ[k - 1]) / (RQ[k] - RQ[k - 1]), 0.0, 1.0)); break; }
      gl_FragColor = vec4(clamp(lace * (0.35 + 0.8 * thick), 0.0, 1.0), thick, streak, eq);
    }`);
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

// --------------------------------------------------------------- paved ground
// Apron concrete ('concrete': 8×8 slabs of 6 m on a 48 m tile), asphalt (40 m tile) and the quay wall ('wall': 3 m panels on a 12 m
// tile). Colour (each slab's own tone, stains, polished truck lanes, cracks), height (joints, cracks, aggregate → normal map) and
// roughness (oil and polish catch the low sun) are drawn together so that they agree; everything tiles. The joints are kept thin and
// soft: at a few hundred metres a dark grid is what makes ground look like a CAD floor. On the low setting only the colour is made.
function pavedTexture(kind) {
  const wall = kind === 'wall', asphalt = kind === 'asphalt', low = CFG.quality === 'low';
  const N = wall || low ? 512 : 1024, S = wall ? 4 : 8, cell = N / S;
  const R = mulberry32(wall ? 91 : asphalt ? 37 : 53);
  const layer = (fill) => { const cv = makeCanvas(N, N), g = cv.getContext('2d'); g.fillStyle = fill; g.fillRect(0, 0, N, N); return [cv, g]; };
  const [c, x] = layer(asphalt ? 'rgb(88,90,91)' : wall ? 'rgb(134,132,126)' : 'rgb(152,150,144)');
  const [hc, hx] = layer('rgb(128,128,128)');                                  // height: 128 = flat
  const [rc, rx] = layer(asphalt ? 'rgb(236,236,236)' : 'rgb(230,230,230)');   // roughness (g channel)
  const grey = (v, a) => `rgba(${v},${v},${v},${a})`;
  // soft blob on one layer: three concentric discs, wrapped
  const soft = (g, cx, cy, r, v, a) => { wrapBlob(g, cx, cy, r, N, N, grey(v, a / 3)); wrapBlob(g, cx, cy, r * 0.66, N, N, grey(v, a / 3)); wrapBlob(g, cx, cy, r * 0.33, N, N, grey(v, a / 3)); };
  const stroke = (g, pts, style, w) => {                                       // polyline that wraps round the tile
    g.strokeStyle = style; g.lineWidth = w; g.lineCap = g.lineJoin = 'round';
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px + ox * N, py + oy * N) : g.moveTo(px + ox * N, py + oy * N))); g.stroke(); }
  };
  // 1. every slab has its own tone and its own polish. Slabs run from joint to joint, the joints sitting half a cell off the origin
  //    because the quay's box-shaped parts only show a stretched sliver of the tile's corner
  const wrapRect = (g, X, Y, w, h, fn) => { for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) fn(g, X + ox * N, Y + oy * N, w, h); };
  if (!asphalt) for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
    const t = R() * 2 - 1, X = (i + 0.5) * cell, Y = (j + 0.5) * cell, rv = 232 + (R() - 0.5) * 34;
    x.fillStyle = t > 0 ? `rgba(255,250,235,${0.07 * t})` : `rgba(15,18,22,${-0.1 * t})`; wrapRect(x, X, Y, cell, cell, (g, a, b, w, h) => g.fillRect(a, b, w, h));
    rx.fillStyle = `rgba(${rv},${rv},${rv},0.8)`; wrapRect(rx, X, Y, cell, cell, (g, a, b, w, h) => g.fillRect(a, b, w, h));
    x.strokeStyle = 'rgba(20,20,20,0.05)'; x.lineWidth = 14; wrapRect(x, X, Y, cell, cell, (g, a, b, w, h) => g.strokeRect(a, b, w, h));     // the edges of a slab collect dirt
  }
  // 2. cloudy mottling at three scales
  for (let i = 0; i < 260; i++) soft(x, R() * N, R() * N, 30 + R() * 90, R() < 0.55 ? 20 : 235, 0.04 + R() * 0.05);
  for (let i = 0; i < 500; i++) soft(x, R() * N, R() * N, 5 + R() * 22, R() < 0.5 ? 30 : 230, 0.04 + R() * 0.06);
  // 3. wear lanes: trucks run in the same tracks, polishing the surface (smoother, a little darker, a little glossier)
  const lanes = wall ? 0 : asphalt ? 7 : 5;
  for (let i = 0; i < lanes; i++) {
    const y0 = R() * N, w0 = (asphalt ? 22 : 30) + R() * 30, ph = R() * 6, am = 4 + R() * 10, pts = [];
    for (let px = -20; px <= N + 20; px += 32) pts.push([px, y0 + Math.sin(px * 0.011 + ph) * am]);
    for (let k = 0; k < 5; k++) { const wk = w0 * (1 - k * 0.18); stroke(x, pts, `rgba(18,18,20,${asphalt ? 0.05 : 0.04})`, wk); stroke(rx, pts, 'rgba(150,150,150,0.2)', wk); }
  }
  // 4. oil and fuel drips: dark, glossy
  for (let i = 0, n = wall ? 12 : 70; i < n; i++) {
    const cx = R() * N, cy = R() * N, r = 3 + R() * 9;
    soft(x, cx, cy, r * 2.4, 10, 0.07); soft(x, cx, cy, r, 8, 0.2 + R() * 0.15);
    soft(rx, cx, cy, r * 1.4, 70, 0.55); soft(hx, cx, cy, r, 110, 0.15);
  }
  // 5. repair patches (sealed, smoother) – asphalt gets many, concrete a few
  for (let i = 0, n = wall ? 0 : asphalt ? 9 : 4; i < n; i++) {
    const w = (asphalt ? 50 : 30) + R() * 150, h = (asphalt ? 40 : 30) + R() * 90, px = R() * N, py = R() * N;
    x.fillStyle = asphalt ? 'rgba(30,31,33,0.4)' : 'rgba(210,205,195,0.16)'; wrapRect(x, px, py, w, h, (g, a, b, ww, hh) => g.fillRect(a, b, ww, hh));
    rx.fillStyle = 'rgba(190,190,190,0.5)'; wrapRect(rx, px, py, w, h, (g, a, b, ww, hh) => g.fillRect(a, b, ww, hh));
    hx.fillStyle = 'rgba(160,160,160,0.5)'; wrapRect(hx, px, py, w, h, (g, a, b, ww, hh) => g.fillRect(a, b, ww, hh));
    x.strokeStyle = 'rgba(15,15,15,0.4)'; x.lineWidth = 2; wrapRect(x, px, py, w, h, (g, a, b, ww, hh) => g.strokeRect(a, b, ww, hh));
    hx.strokeStyle = 'rgba(0,0,0,0.5)'; hx.lineWidth = 3; wrapRect(hx, px, py, w, h, (g, a, b, ww, hh) => g.strokeRect(a, b, ww, hh));
  }
  // 6. joints: thin and soft in the colour, a real groove in the height
  if (!asphalt) for (let i = 0; i < S; i++) {
    const p = (i + 0.5) * cell;
    for (const [a, b] of [[[p, 0], [p, N]], [[0, p], [N, p]]]) {
      stroke(x, [a, b], 'rgba(30,30,30,0.1)', wall ? 7 : 6); stroke(x, [a, b], 'rgba(22,22,22,0.3)', 2);
      stroke(hx, [a, b], 'rgba(0,0,0,0.25)', 6); stroke(hx, [a, b], 'rgba(0,0,0,0.6)', 2.5);
      stroke(rx, [a, b], 'rgba(255,255,255,0.7)', 3);
    }
  } else for (let i = 0; i < 6; i++) {                                   // paving strips: faint seams along the lanes
    const y0 = (i + R() * 0.4) * N / 6, pts = []; for (let px = -20; px <= N + 20; px += 40) pts.push([px, y0 + Math.sin(px * 0.02 + i) * 3]);
    stroke(x, pts, 'rgba(15,15,17,0.2)', 2); stroke(hx, pts, 'rgba(0,0,0,0.35)', 3);
  }
  // 7. cracks, branching
  const crack = (sx, sy, len, wid, depth) => {
    let a = R() * 6.283, px = sx, py = sy; const pts = [[px, py]];
    for (let i = 0; i < len; i++) {
      a += (R() - 0.5) * 0.8; const l = 4 + R() * 6; px += Math.cos(a) * l; py += Math.sin(a) * l; pts.push([px, py]);
      if (depth < 2 && R() < 0.05) crack(px, py, (len * 0.45) | 0, wid * 0.7, depth + 1);
    }
    stroke(x, pts, `rgba(18,18,20,${asphalt ? 0.45 : 0.55})`, wid); stroke(hx, pts, 'rgba(0,0,0,0.65)', wid * 2); stroke(rx, pts, 'rgba(255,255,255,0.5)', wid * 2);
  };
  for (let i = 0, n = wall ? 5 : asphalt ? 12 : 11; i < n; i++) crack(R() * N, R() * N, 18 + (R() * 60) | 0, 1 + R() * 1.3, 0);
  // 8. tie-bolt holes on the quay wall
  if (wall) for (let i = 0; i < S; i++) for (let j = 0; j < S * 2; j++) {
    const px = (i + 0.5) * cell + cell * 0.46, py = (j + 0.5) * cell / 2;
    wrapBlob(x, px, py, 4, N, N, 'rgba(15,15,15,0.55)'); wrapBlob(hx, px, py, 4, N, N, 'rgba(0,0,0,0.7)');
  }
  // 9. aggregate: per-pixel speckle, tiled from a small random image (fine grain) and from a coarser one (stones)
  const speckle = (amp) => {
    const n = 256, cv = makeCanvas(n, n), g = cv.getContext('2d'), id = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) { const v = R(), l = R() < 0.5 ? 255 : 0; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = l; id.data[i * 4 + 3] = (v * v * v * amp * 255) | 0; }
    g.putImageData(id, 0, 0); return cv;
  };
  const lay = (g, img, size) => { g.imageSmoothingEnabled = false; for (let ox = 0; ox < N; ox += size) for (let oy = 0; oy < N; oy += size) g.drawImage(img, ox, oy, size, size); };
  lay(x, speckle(asphalt ? 0.34 : 0.2), 256); lay(hx, speckle(asphalt ? 0.5 : 0.25), 256);
  if (asphalt) { lay(x, speckle(0.36), 512); lay(hx, speckle(0.5), 512); }       // coarse chippings
  const out = { map: canvasTexture(c, { aniso: 16 }), normal: null, rough: null };
  if (!low) {
    out.normal = heightToNormalTexture(hc, asphalt ? 2.0 : 1.6, { aniso: 16 });
    out.rough = canvasTexture(rc, { linear: true, aniso: 16 });
  }
  return out;
}

// The mainland as seen from the sea and from the quay: a patchwork of fields (greens, maize, hay, ploughed brown, the odd rapeseed yellow)
// with hedgerows and their trees, farm tracks and a soft mottling, on a 512 m tile. Field corners sit on a jittered grid that wraps, so
// the patchwork tiles without a seam. Colour only: the fine grain at close range comes from the weathering shader.
function landTexture() {
  const N = CFG.quality === 'low' ? 512 : 1024, G = 8, cell = N / G, R = mulberry32(61), c = makeCanvas(N, N), x = c.getContext('2d');
  x.fillStyle = '#4d6a30'; x.fillRect(0, 0, N, N);
  const jit = Array.from({ length: G * G }, () => [(R() - 0.5) * cell * 0.5, (R() - 0.5) * cell * 0.5]);
  const vtx = (i, j) => { const q = jit[(((j % G) + G) % G) * G + (((i % G) + G) % G)]; return [i * cell + q[0], j * cell + q[1]]; };
  const pal = [[[78, 108, 50], 22], [[92, 122, 58], 18], [[70, 98, 44], 14], [[104, 130, 62], 10], [[58, 84, 42], 12], [[152, 142, 82], 8], [[172, 154, 88], 5], [[114, 94, 68], 6], [[98, 82, 60], 3], [[204, 188, 72], 2]];
  const total = pal.reduce((a, b) => a + b[1], 0), pick = () => { let r = R() * total; for (const [col, w] of pal) { if ((r -= w) < 0) return col; } return pal[0][0]; };
  const each = (fn) => { for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) fn(ox * N, oy * N); };
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const col = pick(), v = [vtx(i, j), vtx(i + 1, j), vtx(i + 1, j + 1), vtx(i, j + 1)], ang = R() * Math.PI, brown = col[0] > 90 && col[2] < 72 && col[1] < 100;
    each((dx, dy) => {
      x.save(); x.beginPath(); v.forEach(([px, py], k) => (k ? x.lineTo(px + dx, py + dy) : x.moveTo(px + dx, py + dy))); x.closePath();
      x.fillStyle = `rgb(${col[0] + ((R() - 0.5) * 8) | 0},${col[1]},${col[2]})`; x.fill(); x.clip();
      // crop rows / furrows
      x.strokeStyle = brown ? 'rgba(40,28,16,0.13)' : 'rgba(20,34,12,0.055)'; x.lineWidth = 1;
      const cx = (v[0][0] + v[2][0]) / 2 + dx, cy = (v[0][1] + v[2][1]) / 2 + dy, ux = Math.cos(ang), uy = Math.sin(ang);
      for (let t = -cell; t < cell; t += 3) { x.beginPath(); x.moveTo(cx - uy * t - ux * cell, cy + ux * t - uy * cell); x.lineTo(cx - uy * t + ux * cell, cy + ux * t + uy * cell); x.stroke(); }
      x.restore();
    });
  }
  // hedgerows (and their trees) along most field edges, farm tracks along a few
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) for (const [a, b] of [[vtx(i, j), vtx(i + 1, j)], [vtx(i, j), vtx(i, j + 1)]]) {
    const u = R();
    if (u < 0.62) {
      each((dx, dy) => {
        x.strokeStyle = 'rgba(34,54,26,0.85)'; x.lineWidth = 3; x.beginPath(); x.moveTo(a[0] + dx, a[1] + dy); x.lineTo(b[0] + dx, b[1] + dy); x.stroke();
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let t = 6; t < len; t += 9 + R() * 8) { const px = a[0] + (b[0] - a[0]) * t / len + dx, py = a[1] + (b[1] - a[1]) * t / len + dy; x.fillStyle = `rgba(${28 + (R() * 16) | 0},${52 + (R() * 22) | 0},${24},0.9)`; x.beginPath(); x.arc(px, py, 2.5 + R() * 3, 0, 6.3); x.fill(); }
      });
    } else if (u < 0.74) each((dx, dy) => { x.strokeStyle = 'rgba(150,132,100,0.8)'; x.lineWidth = 2; x.beginPath(); x.moveTo(a[0] + dx, a[1] + dy); x.lineTo(b[0] + dx, b[1] + dy); x.stroke(); });
  }
  // soft mottling
  for (let i = 0; i < 160; i++) { const r = 30 + R() * 90, cx = R() * N, cy = R() * N, l = R() < 0.5 ? 20 : 235; for (let q = 0; q < 3; q++) wrapBlob(x, cx, cy, r * (1 - q * 0.3), N, N, `rgba(${l},${l},${l},0.018)`); }
  return canvasTexture(c, { aniso: 8 });
}

// Three-strand laid rope (colour + normal): a tile is one lay – the strands run slanted along the rope (u round it, v along it). Fibre speckle,
// darker grooves between the strands. The wrap is a whole number of turns, so it tiles along the rope.
function ropeTexture() {
  const N = 128, c = makeCanvas(N, N), x = c.getContext('2d'), hc = makeCanvas(N, N), hx = hc.getContext('2d');
  const img = x.createImageData(N, N), him = hx.createImageData(N, N), R = mulberry32(5), strands = 3, turns = 1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = i / N, v = j / N, ph = (((u * strands - v * turns * strands) % 1) + 1) % 1;       // phase across one strand
    const hgt = Math.pow(Math.sin(Math.PI * ph), 0.55), fibre = 0.86 + 0.28 * R(), l = (0.42 + 0.58 * hgt) * fibre, o = (j * N + i) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.min(255, 255 * l); img.data[o + 3] = 255;
    const hv = Math.min(255, 255 * (hgt * 0.8 + 0.12 * R())); him.data[o] = him.data[o + 1] = him.data[o + 2] = hv; him.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0); hx.putImageData(him, 0, 0);
  const map = canvasTexture(c, { aniso: 8 }), normal = heightToNormalTexture(hc, 3.0, { aniso: 8 });
  for (const t of [map, normal]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map, normal };
}

// Oil-tank shell: courses of welded plates – a tile is one plate wide (8 m) and three courses high (7.2 m), the vertical welds staggered by
// half a plate from one course to the next. Plate-to-plate tone, weld seams in colour and height (→ normal map), rust streaks running
// down from the welds. UVs are laid out in tile units by the caller (tankGeo).
function tankTexture() {
  const low = CFG.quality === 'low', W = low ? 256 : 512, H = W, R = mulberry32(88), k = W / 512;
  const c = makeCanvas(W, H), x = c.getContext('2d'), hc = makeCanvas(W, H), hx = hc.getContext('2d');
  x.fillStyle = '#d5d6d0'; x.fillRect(0, 0, W, H); hx.fillStyle = 'rgb(128,128,128)'; hx.fillRect(0, 0, W, H);
  const ch = H / 3;
  for (let j = 0; j < 3; j++) {
    const off = (j % 2) * W / 2;
    for (let i = -1; i <= 1; i++) {                                              // two plates per course in the tile's width: the second wraps
      const X = off + i * W, tone = (R() - 0.5) * 22;
      x.fillStyle = `rgba(${tone > 0 ? 255 : 30},${tone > 0 ? 250 : 34},${tone > 0 ? 240 : 40},${Math.abs(tone) / 255 * 1.6})`; x.fillRect(X, j * ch, W, ch);
    }
    // vertical weld at the course's offset, horizontal weld at its top edge
    for (const wx of [off, off + W]) {
      x.fillStyle = 'rgba(70,72,70,0.55)'; x.fillRect(wx - 1.5 * k, j * ch, 3 * k, ch); hx.fillStyle = 'rgba(210,210,210,0.9)'; hx.fillRect(wx - 2 * k, j * ch, 4 * k, ch);
      x.fillStyle = 'rgba(70,72,70,0.55)'; x.fillRect(wx - 1.5 * k - W, j * ch, 3 * k, ch); hx.fillRect(wx - 2 * k - W, j * ch, 4 * k, ch);
    }
    x.fillStyle = 'rgba(60,62,60,0.7)'; x.fillRect(0, j * ch - 1.5 * k, W, 3 * k); hx.fillStyle = 'rgba(225,225,225,0.95)'; hx.fillRect(0, j * ch - 2.2 * k, W, 4.4 * k);
    x.fillStyle = 'rgba(255,255,255,0.14)'; x.fillRect(0, j * ch + 2 * k, W, 2 * k);
    // rust and run-off streaks below the horizontal weld
    for (let n = 0; n < 26; n++) {
      const sx = R() * W, len = (30 + R() * 110) * k, a = 0.05 + R() * 0.1, w = (1 + R() * 3) * k, g = x.createLinearGradient(0, j * ch, 0, j * ch + len);
      g.addColorStop(0, `rgba(96,64,44,${a})`); g.addColorStop(1, 'rgba(96,64,44,0)');
      x.fillStyle = g; x.fillRect(sx, j * ch, w, len);
    }
  }
  for (let n = 0; n < 150; n++) { const sx = R() * W, y0 = R() * H, len = (40 + R() * 160) * k; const g = x.createLinearGradient(0, y0, 0, y0 + len); g.addColorStop(0, 'rgba(60,56,50,0)'); g.addColorStop(0.3, `rgba(60,56,50,${0.03 + R() * 0.05})`); g.addColorStop(1, 'rgba(60,56,50,0)'); x.fillStyle = g; x.fillRect(sx, y0, (1 + R() * 2) * k, len); }
  return { map: canvasTexture(c, { aniso: 8, repeat: [1, 1] }), normal: low ? null : heightToNormalTexture(hc, 2.4, { aniso: 8 }) };
}

// Rock armour of the breakwaters and the open coast (28 m tile): piled stones of a metre or two – lit on their tops, dark in the gaps
// between – with a normal map made from the same stones. Drawn as many overlapping gradient-shaded ellipses, wrapped round the tile.
function rockTexture() {
  const low = CFG.quality === 'low', N = low ? 512 : 1024, R = mulberry32(77);
  const c = makeCanvas(N, N), x = c.getContext('2d'), hc = makeCanvas(N, N), hx = hc.getContext('2d');
  x.fillStyle = '#2b2b29'; x.fillRect(0, 0, N, N);                         // the dark voids between the stones
  hx.fillStyle = '#1c1c1c'; hx.fillRect(0, 0, N, N);
  const k = N / 1024;
  for (let i = 0, n = 380; i < n; i++) {
    const cx = R() * N, cy = R() * N, r = (22 + R() * R() * 70) * k, ry = r * (0.62 + 0.3 * R()), rot = R() * 3.14, l = 82 + R() * 70, tint = R() < 0.25 ? 6 : 0;
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const X = cx + ox * N, Y = cy + oy * N; if (X + r < 0 || X - r > N || Y + r < 0 || Y - r > N) continue;
      let g = x.createRadialGradient(X - r * 0.3, Y - r * 0.35, r * 0.1, X, Y, r);
      g.addColorStop(0, `rgb(${l + 36 + tint},${l + 32},${l + 24})`); g.addColorStop(0.7, `rgb(${l + tint},${l - 2},${l - 7})`); g.addColorStop(1, `rgb(${(l * 0.42) | 0},${(l * 0.42) | 0},${(l * 0.4) | 0})`);
      x.fillStyle = g; x.beginPath(); x.ellipse(X, Y, r, ry, rot, 0, Math.PI * 2); x.fill();
      g = hx.createRadialGradient(X, Y, r * 0.05, X, Y, r);
      g.addColorStop(0, 'rgb(235,235,235)'); g.addColorStop(0.55, 'rgb(170,170,170)'); g.addColorStop(1, 'rgb(40,40,40)');
      hx.fillStyle = g; hx.beginPath(); hx.ellipse(X, Y, r, ry, rot, 0, Math.PI * 2); hx.fill();
    }
  }
  // grain on top (stones are not smooth): per-pixel speckle tiled from a small image
  const n = 256, sp = makeCanvas(n, n), sg = sp.getContext('2d'), id = sg.createImageData(n, n);
  for (let i = 0; i < n * n; i++) { const v = R(), l = R() < 0.5 ? 255 : 0; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = l; id.data[i * 4 + 3] = (v * v * v * 0.3 * 255) | 0; }
  sg.putImageData(id, 0, 0);
  for (const g of [x, hx]) { g.imageSmoothingEnabled = false; for (let ox = 0; ox < N; ox += 256) for (let oy = 0; oy < N; oy += 256) g.drawImage(sp, ox, oy, 256, 256); }
  return { map: canvasTexture(c, { aniso: 8 }), normal: low ? null : heightToNormalTexture(hc, 3.4, { aniso: 8 }) };
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
