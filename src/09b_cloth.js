// ============================================================================
// 09b — CLOTH, SKIN AND SHOE MATERIALS (generated on canvases, no external files)
// ============================================================================
// Garments are textured through UV rectangles of one atlas each (HUV in 09b_body.js). The atlas is painted here with the
// things that make cloth read as cloth: the weave (visible as a faint grain and in the roughness), pressed creases, the folds
// where cloth gathers (the waist above the belt, behind the knee, the elbow, the armpit, the ankle), stitching, pockets,
// plackets and buttons. A height field is drawn alongside the colour and turned into a tangent-space normal map; a roughness
// map makes pressed edges and worn knees and seat shinier. The colour is kept neutral and tinted by the material (white shirt,
// navy shirt, orange coverall all share one weave).

// Every standard material gets the game's atmosphere patch (aerial perspective, weathering, night lamps) through
// THREE.Material.prototype.onBeforeCompile (see ATMOS.patchFog). Two things are wrong for people: the weathering streaks the cloth
// with rain marks, and the patch is skipped for skinned meshes, which would leave the crew dark under the deck floodlights at night.
// So crew materials switch the stains off (NO_GRUNGE) and add the lamp / far-shadow part themselves for skinned shaders.
function humHook(mat) {
  mat.customProgramCacheKey = () => 'crew';
  mat.onBeforeCompile = function (shader) {
    shader.fragmentShader = '#define NO_GRUNGE\n' + shader.fragmentShader;
    ATMOS.hook.call(this, shader);
    if (shader.skinning && ATMOS.U.uGrunge.value && shader.fragmentShader.includes('#include <roughnessmap_fragment>')) ATMOS.grunge(shader, this);
  };
  return mat;
}

// ------------------------------------------------------------------ painting tools
// Periodic value noise (period px along x) so that textures wrap round a garment without a seam.
function humNoiseFn(seed, px = 0) {
  const R = mulberry32(seed), N = 256, tab = new Float32Array(N * N); for (let i = 0; i < tab.length; i++) tab[i] = R();
  const at = (i, j) => tab[((j & 255) << 8) | (px ? ((i % px) + px) % px & 255 : i & 255)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return at(xi, yi) * (1 - u) * (1 - v) + at(xi + 1, yi) * u * (1 - v) + at(xi, yi + 1) * (1 - u) * v + at(xi + 1, yi + 1) * u * v;
  };
}
// A canvas pair: colour (c / x) and a float height field (hf, 0.5 = flat) that becomes the normal map.
class HumPaint {
  constructor(W, H) { this.W = W; this.H = H; this.c = makeCanvas(W, H); this.x = this.c.getContext('2d'); this.hf = new Float32Array(W * H).fill(0.5); this.rf = new Float32Array(W * H).fill(0.8); }
  // soft ridge / groove along a polyline [[x, y], …] (pixels): amplitude a (+ raised, − groove), Gaussian width w; optional roughness change
  ridge(pts, w, a, rough = 0) {
    const { W, H, hf, rf } = this, r = Math.ceil(w * 1.9), st = Math.max(0.8, w * 0.35), gain = a / 4.28;
    let carry = 0;
    for (let sgm = 0; sgm < pts.length - 1; sgm++) {
      const [x0, y0] = pts[sgm], [x1, y1] = pts[sgm + 1], len = Math.hypot(x1 - x0, y1 - y0);
      for (let d = carry; d < len; d += st) {
        const px = x0 + (x1 - x0) * d / (len || 1), py = y0 + (y1 - y0) * d / (len || 1); carry = d + st - len;
        for (let j = Math.max(0, Math.floor(py - r)); j <= Math.min(H - 1, Math.floor(py + r)); j++) for (let i = Math.floor(px - r); i <= px + r; i++) {
          const g = Math.exp(-((i - px) ** 2 + (j - py) ** 2) / (w * w) * 1.4); if (g < 0.03) continue;
          const ii = ((i % W) + W) % W; hf[j * W + ii] += gain * g; if (rough) rf[j * W + ii] += rough * g / 4.28;
        }
      }
      if (len === 0) carry = 0;
    }
  }
  // a wavy line from (x0, y) to (x1, y): amplitude wob, wavelength wl
  wave(x0, x1, y, wob, wl, ph) { const p = []; for (let x = x0; x <= x1; x += 5) p.push([x, y + Math.sin(x / wl * 6.283 + ph) * wob]); return p; }
  normal(strength, wrapX = true) {
    const { W, H, hf } = this, out = new Uint8ClampedArray(W * H * 4), at = (x, y) => hf[Math.min(H - 1, Math.max(0, y)) * W + (wrapX ? (x + W) % W : Math.min(W - 1, Math.max(0, x)))];
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      const dx = (at(xx + 1, y) - at(xx - 1, y)) * strength, dy = (at(xx, y - 1) - at(xx, y + 1)) * strength, l = Math.hypot(dx, dy, 1), o = (y * W + xx) * 4;
      out[o] = (-dx / l * 0.5 + 0.5) * 255; out[o + 1] = (-dy / l * 0.5 + 0.5) * 255; out[o + 2] = (1 / l * 0.5 + 0.5) * 255; out[o + 3] = 255;
    }
    const nc = makeCanvas(W, H); nc.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
    return canvasTexture(nc, { linear: true, aniso: 8 });
  }
  roughCanvas() {
    const { W, H, rf } = this, out = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { const v = Math.min(1, Math.max(0.05, rf[i])) * 255; out[i * 4] = 255; out[i * 4 + 1] = v; out[i * 4 + 2] = 0; out[i * 4 + 3] = 255; }   // green = roughness (r / b unused: no AO or metalness)
    const nc = makeCanvas(W, H); nc.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
    return canvasTexture(nc, { linear: true, aniso: 4 });
  }
}

// fabric grain into the colour, height and roughness: kind 'poplin' (fine plain weave), 'twill' (diagonal ribs), 'drill' (heavy twill)
function humWeave(P, kind, seed, scale = 1) {
  const { W, H, hf, rf } = P, id = P.x.createImageData(W, H), d = id.data, n1 = humNoiseFn(seed, 64), n2 = humNoiseFn(seed + 9, 16), n3 = humNoiseFn(seed + 21, 0);
  const per = kind === 'poplin' ? 3 : kind === 'twill' ? 4 : 6;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    let g;
    if (kind === 'poplin') g = ((x % per) < per / 2 ? 0.5 : 0.35) * 0.5 + ((y % per) < per / 2 ? 0.5 : 0.35) * 0.5;
    else g = (((x + y) % per) < per / 2 ? 0.65 : 0.4);
    const slub = n1(x / (14 * scale), y / (50 * scale)) * 0.6 + n2(x / (5 * scale), y / (5 * scale)) * 0.4, blot = n3(x / 90, y / 90);
    const v = 0.93 + (g - 0.5) * (kind === 'poplin' ? 0.05 : 0.07) + (slub - 0.5) * 0.045 + (blot - 0.5) * 0.04;
    const c = Math.max(0, Math.min(255, v * 255));
    d[o] = c; d[o + 1] = c; d[o + 2] = c * 1.005; d[o + 3] = 255;
    hf[y * W + x] += (g - 0.5) * (kind === 'poplin' ? 0.012 : 0.022) + (slub - 0.5) * 0.012;
    rf[y * W + x] += (g - 0.5) * 0.06 + (slub - 0.5) * 0.08 - 0.02 * 0;
  }
  P.x.putImageData(id, 0, 0);
}
const humRect = (P, r) => [r[0] * P.W, r[1] * P.H, r[2] * P.W, r[3] * P.H];

// ------------------------------------------------------------------ the shirt: torso, sleeve, collar / misc
function humShirtAtlas(kind, size) {
  const W = size, H = size, P = new HumPaint(W, H), R = mulberry32(5), x = P.x;
  humWeave(P, kind === 'drill' ? 'drill' : 'poplin', kind === 'drill' ? 77 : 41);
  const [tx, ty, tw, th] = humRect(P, HUV.shirtTorso), [sx, sy, sw, sh] = humRect(P, HUV.shirtSleeve), [mx, my, mw, mh] = humRect(P, HUV.shirtMisc);
  const S = size / 1024, line = (pts, w, col, a = 1) => { x.save(); x.strokeStyle = col; x.globalAlpha = a; x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.stroke(); x.restore(); };
  const stitch = (pts, w = 1.4 * S, col = 'rgba(40,40,45,0.5)') => { x.save(); x.strokeStyle = col; x.lineWidth = w; x.setLineDash([3.2 * S, 2.6 * S]); x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.stroke(); x.restore(); };
  // --- torso rect: u 0 = right side, 0.25 = back, 0.5 = left side, 0.75 = front; v 0 = collar, 1 = hem (0.65 m over th pixels)
  const TX = (u) => tx + u * tw, TY = (v) => ty + v * th;
  // gathers above the belt (the tucked-in shirt blouses over the waistband): wavy folds across the lower part, stronger at the front and sides
  for (let k = 0; k < 6; k++) { const v = 0.83 + k * 0.026, wob = 3.5 * S + R() * 3 * S; P.ridge(P.wave(tx, tx + tw, TY(v), wob, 70 * S + R() * 50 * S, R() * 6), 5 * S, (k % 2 ? 0.07 : -0.06) * (1 - k * 0.1), 0.1); }
  // under the arms: folds fanning towards the armpits (side seams at u = 0 and 0.5)
  for (const u0 of [0.0, 0.5]) for (let k = 0; k < 6; k++) { const v0 = 0.3 + k * 0.025, dir = k % 2 ? 1 : -1; for (const side of [-1, 1]) { const px = TX(u0) + side * 6 * S; P.ridge([[px, TY(v0)], [px + side * (40 + 18 * k) * S, TY(v0 + 0.1 + 0.03 * k)], [px + side * (70 + 20 * k) * S, TY(v0 + 0.2 + 0.03 * k)]].map(([a, b]) => [a, b]), 6 * S, 0.05 * dir, 0.05); } }
  // back: shoulder-blade tension arcs and a soft yoke seam
  for (let k = 0; k < 3; k++) P.ridge(P.wave(TX(0.18), TX(0.32), TY(0.2 + k * 0.05), 6 * S, 60 * S, k), 6 * S, -0.04 * (1 - k * 0.2));
  line([[TX(0.15), TY(0.075)], [TX(0.35), TY(0.075)]], 1.3 * S, 'rgba(60,60,70,0.35)'); stitch([[TX(0.15), TY(0.082)], [TX(0.35), TY(0.082)]]);
  // front: the placket (centre u = 0.75): two stitched edges and a raised band, six buttons from the collar down
  const pu = 0.75, pw = 0.019 * tw / 1;
  P.ridge([[TX(pu) - pw, TY(0.05)], [TX(pu) - pw, TY(1)]], 2.2 * S, 0.07); P.ridge([[TX(pu) + pw, TY(0.05)], [TX(pu) + pw, TY(1)]], 2.2 * S, 0.07);
  P.ridge([[TX(pu), TY(0.05)], [TX(pu), TY(1)]], pw * 0.8, 0.03);
  stitch([[TX(pu) - pw * 1.7, TY(0.05)], [TX(pu) - pw * 1.7, TY(1)]]); stitch([[TX(pu) + pw * 1.7, TY(0.05)], [TX(pu) + pw * 1.7, TY(1)]]);
  // chest pocket on the wearer's left (u ≈ 0.62): flap with a pointed edge, stitched
  { const pcx = TX(0.62), pty = TY(0.3), wpx = 0.104 * tw / 0.97, hpx = 0.118 * th / 0.576;      // 0.104 m wide, 0.118 m tall (1 m = tw / 0.97 px across, th / 0.576 px down)
    const x0 = pcx - wpx / 2, x1 = pcx + wpx / 2, y0 = pty, y1 = pty + hpx;
    P.ridge([[x0, y0], [x1, y0], [x1, y1], [pcx, y1 + 4 * S], [x0, y1], [x0, y0]], 2.4 * S, 0.1, 0.05);
    P.ridge([[x0 + 1, y0 + 0.4 * hpx], [pcx, y0 + 0.4 * hpx + 4 * S], [x1 - 1, y0 + 0.4 * hpx]], 2 * S, -0.07);
    stitch([[x0 + 3 * S, y0 + 3 * S], [x1 - 3 * S, y0 + 3 * S], [x1 - 3 * S, y1 - 2 * S], [pcx, y1 + 1 * S], [x0 + 3 * S, y1 - 2 * S], [x0 + 3 * S, y0 + 3 * S]]);
    x.fillStyle = 'rgba(30,30,35,0.07)'; x.fillRect(x0, y0 + 0.4 * hpx, wpx, 5 * S); }
  // buttons (cream, with two thread holes), plus the collar button and the hem stays tucked
  for (let k = 0; k < 7; k++) { const by = TY(0.12 + k * 0.125); x.fillStyle = '#e6dfd0'; x.beginPath(); x.arc(TX(pu), by, 5.2 * S, 0, 7); x.fill(); x.fillStyle = 'rgba(70,60,50,0.55)'; x.beginPath(); x.arc(TX(pu) - 1.6 * S, by, 0.9 * S, 0, 7); x.arc(TX(pu) + 1.6 * S, by, 0.9 * S, 0, 7); x.fill(); P.ridge([[TX(pu) - 4 * S, by], [TX(pu) + 4 * S, by]], 4.5 * S, 0.1); }
  // side seams (u = 0 and 0.5) and the armhole seam at the top
  for (const u of [0, 0.5, 1]) { P.ridge([[TX(u), TY(0.2)], [TX(u), TY(0.93)]], 1.8 * S, 0.035); stitch([[TX(u) + 3 * S, TY(0.3)], [TX(u) + 3 * S, TY(0.9)]]); }
  // --- sleeve rect (0.32 m round, 0.6 m long): v 0 = the shoulder, 1 = the cuff
  const SX = (u) => sx + u * sw, SY = (v) => sy + v * sh;
  for (let k = 0; k < 7; k++) { const v = 0.505 + k * 0.012; for (const [u0, a] of [[0.75, 0.085], [0.25, -0.05]]) P.ridge(P.wave(SX(u0 - 0.2), SX(u0 + 0.2), SY(v), 3 * S, 22 * S, k + u0 * 9), 4.5 * S, a * (1 - Math.abs(k - 3) * 0.14), 0.06); }      // elbow creases: strong on the inside, soft gathers behind
  for (let k = 0; k < 4; k++) P.ridge(P.wave(SX(0), SX(1), SY(0.14 + k * 0.03), 4 * S, 30 * S, k * 1.7), 5 * S, 0.035 * (k % 2 ? 1 : -1));       // shoulder drag
  for (let k = 0; k < 6; k++) { const v = 0.8 + k * 0.025; P.ridge(P.wave(SX(0), SX(1), SY(v), 3.5 * S, 24 * S, k * 2.1), 4 * S, 0.04 * (k % 2 ? 1 : -1)); }  // forearm: gathers pushed down to the cuff
  P.ridge([[SX(0.5), SY(0.05)], [SX(0.5), SY(0.98)]], 1.8 * S, 0.035); stitch([[SX(0.5) + 3 * S, SY(0.08)], [SX(0.5) + 3 * S, SY(0.9)]]);   // sleeve seam (inner side, u = 0.5 on the right sleeve ≈ the underarm)
  // cuff: a band of heavier cloth with a button and two rows of stitching
  { const c0 = SY(0.935); x.fillStyle = 'rgba(0,0,0,0.04)'; x.fillRect(sx, c0, sw, SY(1) - c0); P.ridge([[sx, c0], [sx + sw, c0]], 2.4 * S, 0.12); stitch([[sx, c0 + 6 * S], [sx + sw, c0 + 6 * S]]); stitch([[sx, SY(1) - 5 * S], [sx + sw, SY(1) - 5 * S]]);
    x.fillStyle = '#e6dfd0'; x.beginPath(); x.arc(SX(0.25), (c0 + SY(1)) / 2, 4.2 * S, 0, 7); x.fill(); P.ridge([[SX(0.25) - 3.5 * S, (c0 + SY(1)) / 2], [SX(0.25) + 3.5 * S, (c0 + SY(1)) / 2]], 4 * S, 0.1); }
  // --- misc rect: the collar (stand + leaves) – stitched edges
  { const mx0 = mx, mw0 = mw; for (let k = 0; k < 3; k++) { const v = my + (0.1 + k * 0.1) * mh; line([[mx0, v], [mx0 + mw0, v]], 1.2 * S, 'rgba(60,60,70,0.3)'); stitch([[mx0, v + 4 * S], [mx0 + mw0, v + 4 * S]]); P.ridge([[mx0, v], [mx0 + mw0, v]], 2 * S, 0.06); } }
  const map = canvasTexture(P.c, { aniso: 8 }); map.generateMipmaps = true;
  return { map, normal: P.normal(kind === 'drill' ? 4.2 : 3.4), rough: P.roughCanvas() };
}

// ------------------------------------------------------------------ trousers: legs, pelvis (waistband, fly, pockets), misc
function humTrouserAtlas(kind, size) {
  const W = size, H = size, P = new HumPaint(W, H), R = mulberry32(9), x = P.x;
  humWeave(P, kind === 'drill' ? 'drill' : 'twill', kind === 'drill' ? 88 : 52);
  const [lx, ly, lw, lh] = humRect(P, HUV.trLeg), [px, py, pw, ph] = humRect(P, HUV.trPelvis);
  const S = size / 1024, stitch = (pts, w = 1.4 * S, col = 'rgba(30,30,40,0.55)') => { x.save(); x.strokeStyle = col; x.lineWidth = w; x.setLineDash([3.2 * S, 2.6 * S]); x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.stroke(); x.restore(); };
  // --- leg rect: u 0 = outer side, 0.25 = back, 0.5 = inner side, 0.75 = front; v 0 = top (hip), 1 = hem; a 0.9 m leg over lh pixels
  const LX = (u) => lx + u * lw, LY = (v) => ly + v * lh, kneeV = 0.46 / 0.917;
  // pressed creases down the front and back: a sharp raised line with a shiny edge
  if (kind !== 'drill') for (const u of [0.75, 0.25]) { P.ridge([[LX(u), LY(0.06)], [LX(u), LY(0.985)]], 1.7 * S, 0.1, -0.5); P.ridge([[LX(u) - 3 * S, LY(0.06)], [LX(u) - 3 * S, LY(0.985)]], 2.6 * S, -0.035); P.ridge([[LX(u) + 3 * S, LY(0.06)], [LX(u) + 3 * S, LY(0.985)]], 2.6 * S, -0.035); }
  // knee: horizontal creases above it on the front, a nest of curved folds behind it, the cloth stretching over the kneecap
  for (let k = 0; k < 6; k++) P.ridge(P.wave(LX(0.62), LX(0.88), LY(kneeV - 0.07 + k * 0.016), 2.5 * S, 30 * S, k * 1.9), 4.2 * S, (k % 2 ? 0.07 : -0.06) * (1 - k * 0.08), 0.08);
  for (let k = 0; k < 8; k++) P.ridge(P.wave(LX(0.1), LX(0.4), LY(kneeV - 0.03 + k * 0.014), 4 * S, 40 * S, k * 1.3), 4 * S, (k % 2 ? 0.075 : -0.07) * (1 - Math.abs(k - 3.5) * 0.1), 0.06);
  // thigh: diagonal folds running from the groin to the outer thigh (hip flexion), at the front
  for (let k = 0; k < 6; k++) { const v0 = 0.05 + k * 0.03; P.ridge([[LX(0.5), LY(v0)], [LX(0.66), LY(v0 + 0.06)], [LX(0.8), LY(v0 + 0.1)], [LX(0.98), LY(v0 + 0.13)]], 5 * S, (k % 2 ? 0.05 : -0.045)); }
  // the hem: cloth stacking on the shoe (three soft rings), a turned hem line and its stitching
  for (let k = 0; k < 4; k++) P.ridge(P.wave(lx, lx + lw, LY(0.915 + k * 0.016), 3 * S, 26 * S, k * 2.2), 4.5 * S, 0.06 * (k % 2 ? 1 : -1) * (1 - k * 0.1), 0.05);
  P.ridge([[lx, LY(0.975)], [lx + lw, LY(0.975)]], 2 * S, 0.08); stitch([[lx, LY(0.965)], [lx + lw, LY(0.965)]]);
  // seams along the outer and inner leg
  for (const u of [0, 0.5, 1]) { P.ridge([[LX(u), LY(0.03)], [LX(u), LY(0.97)]], 1.8 * S, 0.03); stitch([[LX(u) + 3 * S, LY(0.1)], [LX(u) + 3 * S, LY(0.95)]]); }
  // worn shine on the knees and the broad thigh (roughness) – and the whole cloth slightly shinier than the shirt
  for (const [u, v, ru, rv] of [[0.75, kneeV, 0.1, 0.05], [0.25, kneeV, 0.1, 0.05], [0.75, 0.25, 0.14, 0.12]]) { const cx = LX(u), cy = LY(v), rx = ru * lw, ry = rv * lh; for (let j = Math.floor(cy - ry); j <= cy + ry; j++) for (let i = Math.floor(cx - rx); i <= cx + rx; i++) { if (j < 0 || j >= H || i < 0 || i >= W) continue; const d = ((i - cx) / rx) ** 2 + ((j - cy) / ry) ** 2; if (d < 1) P.rf[j * W + i] -= 0.1 * (1 - d); } }
  // --- pelvis rect (1 m round, 0.2 m high): u 0 = right side, 0.25 = back, 0.5 = left side, 0.75 = front; v 0 = waistband top, 1 = crotch
  const PX = (u) => px + u * pw, PY = (v) => py + v * ph;
  // waistband (top 17 %): heavier, a seam below it, belt loops
  P.ridge([[px, PY(0.17)], [px + pw, PY(0.17)]], 2 * S, 0.1); stitch([[px, PY(0.03)], [px + pw, PY(0.03)]]); stitch([[px, PY(0.155)], [px + pw, PY(0.155)]]);
  for (const u of [0.04, 0.17, 0.34, 0.5, 0.66, 0.83, 0.96, 0.75 - 0.045, 0.75 + 0.045, 0.25]) { x.fillStyle = 'rgba(0,0,0,0.07)'; x.fillRect(PX(u) - 3.5 * S, py, 7 * S, PY(0.23) - py); P.ridge([[PX(u), py], [PX(u), PY(0.23)]], 3.4 * S, 0.1); }
  // fly (centre front u = 0.75) with a J stitch, a button on the waistband, hook-and-bar
  P.ridge([[PX(0.75), PY(0.17)], [PX(0.75), PY(1)]], 2 * S, -0.08); stitch([[PX(0.755) + 5 * S, PY(0.19)], [PX(0.755) + 5 * S, PY(0.72)], [PX(0.75), PY(0.82)], [PX(0.745), PY(0.76)]]);
  x.fillStyle = '#1b1b1d'; x.beginPath(); x.arc(PX(0.75) + 9 * S, PY(0.09), 5.5 * S, 0, 7); x.fill(); P.ridge([[PX(0.75) + 3.5 * S, PY(0.09)], [PX(0.75) + 14.5 * S, PY(0.09)]], 5 * S, 0.1);
  // front pockets: slanted slits from the waistband (u ≈ 0.64 and 0.86), with pocket-bag folds
  for (const [u0, d] of [[0.655, 1], [0.845, -1]]) { P.ridge([[PX(u0), PY(0.2)], [PX(u0 + d * 0.03), PY(0.62)]], 2.2 * S, -0.1); stitch([[PX(u0) + 4 * S, PY(0.22)], [PX(u0 + d * 0.03) + 4 * S, PY(0.6)]]); for (let k = 0; k < 3; k++) P.ridge([[PX(u0 - d * 0.04), PY(0.35 + k * 0.1)], [PX(u0 - d * 0.1), PY(0.42 + k * 0.1)]], 5 * S, 0.035); }
  // back: two welt pockets with buttons (u ≈ 0.18 and 0.32), seat folds radiating from the crease
  for (const u0 of [0.18, 0.32]) { const wp = 0.045 * pw; P.ridge([[PX(u0) - wp, PY(0.33)], [PX(u0) + wp, PY(0.33)]], 2 * S, -0.12); P.ridge([[PX(u0) - wp, PY(0.4)], [PX(u0) + wp, PY(0.4)]], 1.6 * S, 0.07); stitch([[PX(u0) - wp - 3 * S, PY(0.3)], [PX(u0) + wp + 3 * S, PY(0.3)], [PX(u0) + wp + 3 * S, PY(0.43)], [PX(u0) - wp - 3 * S, PY(0.43)], [PX(u0) - wp - 3 * S, PY(0.3)]]); }
  for (let k = 0; k < 7; k++) P.ridge([[PX(0.25), PY(0.55 + k * 0.05)], [PX(0.25 + (k % 2 ? 0.08 : -0.08)), PY(0.62 + k * 0.05)], [PX(0.25 + (k % 2 ? 0.14 : -0.14)), PY(0.66 + k * 0.05)]], 5 * S, 0.04 * (k % 2 ? 1 : -1));
  P.ridge([[PX(0.25), PY(0.17)], [PX(0.25), PY(1)]], 2 * S, -0.05); stitch([[PX(0.25) + 5 * S, PY(0.2)], [PX(0.25) + 5 * S, PY(0.9)]]);
  const map = canvasTexture(P.c, { aniso: 8 }); map.generateMipmaps = true;
  return { map, normal: P.normal(kind === 'drill' ? 4.2 : 3.6), rough: P.roughCanvas() };
}

// hi-vis vest cloth: fluorescent orange mesh with two silver reflective bands (the vest spans y 0.115 … 0.6 m above the hip line, top of the canvas = top)
function humVestTexture() {
  const W = 512, H = 256, c = makeCanvas(W, H), x = c.getContext('2d'), R = mulberry32(3);
  x.fillStyle = '#ff6a12'; x.fillRect(0, 0, W, H);
  for (let j = 0; j < H; j += 4) for (let i = (j / 4 % 2) * 2.5; i < W; i += 5) { x.fillStyle = 'rgba(150,45,0,0.3)'; x.fillRect(i, j, 2, 2); }
  for (let i = 0; i < 3000; i++) { x.fillStyle = `rgba(255,${150 + R() * 80},40,${0.05 + R() * 0.06})`; x.fillRect(R() * W, R() * H, 1 + R() * 3, 1); }
  for (const y of [0.2, 0.37]) {
    const cy = (0.6 - y) / 0.485 * H, hh = 0.026 / 0.485 * H;
    x.fillStyle = '#c4c9cd'; x.fillRect(0, cy - hh, W, 2 * hh);
    for (let i = 0; i < W; i += 3) { x.fillStyle = 'rgba(95,105,115,0.28)'; x.fillRect(i, cy - hh, 1, 2 * hh); }
    x.fillStyle = 'rgba(90,60,40,0.5)'; x.fillRect(0, cy - hh - 1, W, 1.2); x.fillRect(0, cy + hh, W, 1.2);
  }
  const t = canvasTexture(c, { aniso: 8 }); t.wrapS = THREE.RepeatWrapping; return t;
}

const HUMTEX = new Map();
function humAtlas(type, kind) {
  const low = CFG.quality === 'low', key = type + ':' + kind + ':' + (low ? 512 : 1024);
  let t = HUMTEX.get(key); if (t) return t;
  const size = low ? 512 : 1024;
  t = type === 'shirt' ? humShirtAtlas(kind, size) : humTrouserAtlas(kind, size);
  HUMTEX.set(key, t); return t;
}

// ------------------------------------------------------------------ materials
function humMaterials(P, o) {
  const std = (c, r, extra = {}) => humHook(new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: r, envMapIntensity: 0.5, vertexColors: true }, extra)));
  const cloth = (c, atlas, extra = {}) => humHook(new THREE.MeshPhysicalMaterial(Object.assign({ color: c, roughness: 1, roughnessMap: atlas.rough, map: atlas.map, normalMap: atlas.normal, normalScale: new THREE.Vector2(1, 1), envMapIntensity: 0.45, vertexColors: true,
    sheen: 0.7, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xffffff) }, extra)));
  const m = {}, drill = !!o.coverall;
  const shirtA = humAtlas('shirt', drill ? 'drill' : 'poplin'), trA = humAtlas('trousers', drill ? 'drill' : 'twill');
  m.skin = std(o.skin || 0xc99a78, 0.58);
  m.shirt = cloth(o.shirt || 0xf2f2ef, shirtA, { sheenColor: new THREE.Color(o.coverall ? 0xffb070 : 0xdfe6ff) });
  m.trousers = cloth(o.pants || 0x1c2230, trA, { sheenColor: new THREE.Color(0x6a7288), sheen: 0.4 });
  m.belt = std(0x181818, 0.42);
  m.shoeUpper = std(0xffffff, 0.34);
  m.shoeSole = std(0x1a1a1a, 0.82);
  m.glove = std(0xd9b24a, 0.9);
  m.trim = std(0xffffff, 0.55);
  m.metal = std(0xffffff, 0.3, { metalness: 0.85, envMapIntensity: 0.9 });
  m.vest = humHook(new THREE.MeshStandardMaterial({ map: (HUMTEX.get('vest') || (HUMTEX.set('vest', humVestTexture()), HUMTEX.get('vest'))), color: 0xffffff, roughness: 0.72, envMapIntensity: 0.4, vertexColors: true, side: THREE.DoubleSide }));
  return m;
}
