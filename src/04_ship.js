// ============================================================================
// 04 — SHIPS: hull lofting, livery, container stowage, superstructures, tugs
// Ship-local frame: -z = forward (bow), +x = starboard, y = up, waterline y=0.
// ============================================================================

function hullHalfBreadth(s, y, o) {
  const { B, T } = o;
  let f = 1;
  const bs = o.bowStart ?? 0.76;
  if (s > bs) {
    const t = (s - bs) / (1 - bs);
    const under = 1 - Math.pow(t, 1.65);
    const over = 1 - Math.pow(t, 3.2);
    f = lerp(under, over, smooth(-T * 0.25, o.D * 0.95, y));
    const bulb = Math.exp(-Math.pow((y + T * 0.6) / (T * 0.22), 2)) * smooth(0.7, 0.95, t) * 0.13;
    f = Math.max(f, bulb);
  }
  const ss = o.sternEnd ?? 0.2;
  if (s < ss) {
    const t = (ss - s) / ss;
    const under = 1 - Math.pow(t, 1.3) * 0.92;
    const over = 1 - Math.pow(t, 2.4) * 0.2;
    f = Math.min(f, lerp(under, over, smooth(-5, 3.5, y)));
  }
  let hb = B / 2 * Math.max(f, 0.012);
  const R = Math.min(3.4, B * 0.06), yb = -T + R;
  if (y < yb) { const d = yb - y; hb = Math.max(0.25, hb - R + Math.sqrt(Math.max(0, R * R - d * d))); }
  return hb;
}
function stationZ(s, y, o) {
  let z = o.L / 2 - s * o.L;
  if (s > 0.9) {
    const k = (s - 0.9) / 0.1;
    z -= k * k * (o.rake * smooth(-2, o.D, y) + 4.5 * Math.exp(-Math.pow((y + o.T * 0.6) / (o.T * 0.25), 2)));
  }
  return z;
}
function fcHeight(s, o) { return o.fc ? o.fc * smooth(0.87, 0.9, s) : 0; }

function hullTexture(o) {
  const W = 4096, H = 1024, c = makeCanvas(W, H), x = c.getContext('2d');
  const yTop = o.D + (o.fc || 0), span = o.T + yTop;
  const rowOf = (y, half) => (half ? H / 2 : 0) + (yTop - y) / span * (H / 2);
  for (const half of [0, 1]) { // 0 = starboard (top half), 1 = port
    const y0 = half * H / 2;
    const gr = x.createLinearGradient(0, y0, 0, y0 + H / 2);
    gr.addColorStop(0, o.hull); gr.addColorStop(1, o.hull);
    x.fillStyle = o.hull; x.fillRect(0, y0, W, H / 2);
    const wl = rowOf(o.bootTop ?? 1.4, half);
    x.fillStyle = o.boot; x.fillRect(0, wl, W, y0 + H / 2 - wl);
    if (o.bootLine) { x.fillStyle = o.bootLine; x.fillRect(0, wl - 4, W, 4); }
    // weathering: vertical streaks & sheer line
    const R = mulberry32(o.seed || 1);
    for (let i = 0; i < 260; i++) {
      const px = R() * W, py = y0 + R() * (wl - y0) * 0.8;
      const gg = x.createLinearGradient(0, py, 0, py + 40 + R() * 120);
      gg.addColorStop(0, `rgba(${R() < 0.4 ? '120,60,30' : '0,0,0'},${0.05 + R() * 0.08})`); gg.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gg; x.fillRect(px, py, 2 + R() * 4, 160);
    }
    x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(0, y0, W, 6);
    const U = (s) => (half ? 1 - s : s) * W;
    const txt = (t, s, y, hMeters, font, col = '#fff', align = 'center') => {
      const pxPerM_v = (H / 2) / span, pxPerM_h = W / o.L;
      x.save();
      x.translate(U(s), rowOf(y, half));
      x.scale(1, pxPerM_v / pxPerM_h);
      x.fillStyle = col; x.textAlign = align; x.textBaseline = 'middle';
      x.font = `${font} ${hMeters * pxPerM_h}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      x.fillText(t, 0, 0);
      x.restore();
    };
    if (o.hullText) txt(o.hullText, o.hullTextS ?? 0.5, o.hullTextY ?? o.D * 0.52, o.hullTextH ?? 10, '900', o.hullTextCol || '#fff');
    if (o.name) {
      txt(o.name, half ? 0.955 : 0.955, yTop - 3.2, 2.1, '800', '#fff');
      txt(o.name, 0.035, yTop - 3.2, 1.6, '800', '#fff');
      txt(o.port || '', 0.035, yTop - 5.4, 1.2, '700', '#fff');
    }
    // draft marks (bow, mid, stern)
    for (const s of [0.99, 0.5, 0.012]) {
      for (let d = Math.ceil(o.T - 4); d <= Math.floor(o.T + 3); d++) {
        const y = d - o.T;
        txt(d + 'M', s, y + 0.25, 0.55, '700', '#f4f4f4');
        for (let k = 1; k < 5; k++) if (k % 2 === 0) txt('—', s, y + k * 0.2, 0.2, '700', '#f4f4f4');
      }
    }
    // bow thruster symbol
    if (o.thrusterMark) {
      const r = 2.4 * W / o.L; const cx = U(0.925), cy = rowOf(4.2, half);
      x.save(); x.translate(cx, cy); x.scale(1, (H / 2) / span / (W / o.L));
      x.strokeStyle = '#fff'; x.lineWidth = 5; x.beginPath(); x.arc(0, 0, r, 0, 7); x.stroke();
      x.beginPath(); x.moveTo(-r * 0.7, -r * 0.7); x.lineTo(r * 0.7, r * 0.7); x.moveTo(r * 0.7, -r * 0.7); x.lineTo(-r * 0.7, r * 0.7); x.stroke();
      x.restore();
      // bulbous bow mark
      txt('⊂⊃', 0.965, 3.3, 1.4, '700', '#fff');
    }
    // plimsoll
    { const cx = U(0.5), cy = rowOf(2.2, half), r = 0.35 * W / o.L;
      x.save(); x.translate(cx, cy); x.scale(1, (H / 2) / span / (W / o.L)); x.strokeStyle = '#fff'; x.lineWidth = 3;
      x.beginPath(); x.arc(0, 0, r, 0, 7); x.stroke(); x.beginPath(); x.moveTo(-r * 1.4, 0); x.lineTo(r * 1.4, 0); x.stroke(); x.restore(); }
    // hawse pipe rust
    if (o.detail > 1) for (const s of [0.93]) {
      const g2 = x.createLinearGradient(0, rowOf(o.D - 1, half), 0, rowOf(-1, half));
      g2.addColorStop(0, 'rgba(110,50,25,0.45)'); g2.addColorStop(1, 'rgba(110,50,25,0)');
      x.fillStyle = g2; x.fillRect(U(s) - 12, rowOf(o.D - 1, half), 24, rowOf(-1, half) - rowOf(o.D - 1, half));
      x.fillStyle = '#111'; x.beginPath(); x.ellipse(U(s), rowOf(o.D - 2, half), 18, 34, 0, 0, 7); x.fill();
    }
  }
  const t = canvasTexture(c); t.anisotropy = 16;
  return t;
}

function hullGeometry(o) {
  const NS = o.detail > 1 ? 120 : 48, NH = o.detail > 1 ? 30 : 14;
  const pos = [], uv = [], idx = [];
  const yTopMax = o.D + (o.fc || 0), span = o.T + yTopMax;
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NS; i++) {
      // denser stations near the ends
      const a = i / NS, s = a < 0.5 ? 0.5 - 0.5 * Math.pow(1 - 2 * a, 1.6) : 0.5 + 0.5 * Math.pow(2 * a - 1, 1.6);
      const yTop = o.D + fcHeight(s, o);
      for (let j = 0; j <= NH; j++) {
        const b = j / NH;
        const y = -o.T + (yTop + o.T) * (b < 0.5 ? 2 * b * b : 1 - 2 * (1 - b) * (1 - b)) * 0.5 + (yTop + o.T) * b * 0.5;
        const hb = hullHalfBreadth(s, y, o);
        const z = stationZ(s, y, o);
        pos.push(side * hb, y, z);
        const u = side > 0 ? s : 1 - s;
        const vv = (y + o.T) / span * 0.5;
        uv.push(u, side > 0 ? 0.5 + vv : vv);
      }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NH; j++) {
      const a = base + i * (NH + 1) + j, b = a + NH + 1;
      if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function deckOutline(o, y, s0 = 0, s1 = 1) {
  const pts = [];
  const N = 60;
  for (let i = 0; i <= N; i++) { const s = s0 + (s1 - s0) * i / N; pts.push([hullHalfBreadth(s, y, o) - 0.05, stationZ(s, y, o)]); }
  for (let i = N; i >= 0; i--) { const s = s0 + (s1 - s0) * i / N; pts.push([-(hullHalfBreadth(s, y, o) - 0.05), stationZ(s, y, o)]); }
  return pts;
}
function deckMesh(o, y, mat, s0, s1) {
  const sh = new THREE.Shape(deckOutline(o, y, s0, s1).map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(Math.PI / 2); g.translate(0, y, 0);
  const idx = g.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
  return m;
}
function transomMesh(o, mat) {
  const pts = [];
  const N = 20, yTop = o.D;
  for (let j = 0; j <= N; j++) { const y = -o.T + (yTop + o.T) * j / N; pts.push(new THREE.Vector2(hullHalfBreadth(0, y, o), y)); }
  for (let j = N; j >= 0; j--) { const y = -o.T + (yTop + o.T) * j / N; pts.push(new THREE.Vector2(-hullHalfBreadth(0, y, o), y)); }
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
  g.translate(0, 0, o.L / 2);
  return new THREE.Mesh(g, mat);
}

// ---------------------------------------------------------------- container ship
function buildContainerShip(o) {
  o = Object.assign({ fc: 2.8, rake: 6, detail: 1, bootTop: 1.4, tiers: 8, deckhouse: 0.62, funnel: 0.2, style: 'generic', seed: 1 }, o);
  reseed(o.seed * 101 + 7);
  const grp = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ map: hullTexture(o), roughness: 0.55, metalness: 0.15 });
  const hull = new THREE.Mesh(hullGeometry(o), hullMat);
  hull.receiveShadow = true; hull.castShadow = o.detail > 1;
  grp.add(hull);
  const deckMat = new THREE.MeshStandardMaterial({ color: o.deckColor || 0x56605a, roughness: 0.9 });
  grp.add(deckMesh(o, o.D, deckMat, 0, 0.9));
  grp.add(deckMesh(o, o.D + o.fc, deckMat, 0.875, 1));
  const tr = transomMesh(o, new THREE.MeshStandardMaterial({ color: o.hull, roughness: 0.6 })); grp.add(tr);

  const B = new Batcher();
  const white = new THREE.MeshStandardMaterial({ color: 0xeef0ef, roughness: 0.55 });
  const hatchMat = new THREE.MeshStandardMaterial({ color: o.hatchColor || 0x4b5a55, roughness: 0.8, metalness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8b9296, roughness: 0.6, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x25292d, roughness: 0.7, metalness: 0.4 });

  const zOf = (s) => o.L / 2 - s * o.L;
  const bridgeZ = zOf(o.deckhouse);
  const funnelZ = zOf(o.funnel);
  const hatchTop = o.D + 1.7;
  const eyeY = o.eyeY ?? (hatchTop + o.tiers * 2.59 + 4.5);

  // wave breaker
  const wbS = 0.872, wbZ = zOf(wbS), wbHb = hullHalfBreadth(wbS, o.D, o) - 1;
  B.box(white, wbHb * 1.05, 5.5, 0.6, wbHb * 0.5, o.D + 2.75 + o.fc * 0.4, wbZ + 2, -0.35);
  B.box(white, wbHb * 1.05, 5.5, 0.6, -wbHb * 0.5, o.D + 2.75 + o.fc * 0.4, wbZ + 2, 0.35);
  // forecastle gear: windlasses, bitts, foremast
  for (const sx of [-1, 1]) {
    B.cyl(dark, 1.3, 1.3, 1.8, sx * 5, o.D + o.fc + 1.6, zOf(0.955), 14, 0, 0, Math.PI / 2);
    B.box(o.detail > 1 ? steel : dark, 3.2, 1.6, 3.2, sx * 5, o.D + o.fc + 0.8, zOf(0.955));
    for (const s of [0.93, 0.98]) B.cyl(dark, 0.4, 0.45, 1.1, sx * hullHalfBreadth(s, o.D, o) * 0.7, o.D + o.fc + 0.55, zOf(s), 8);
  }
  B.cyl(white, 0.35, 0.5, 14, 0, o.D + o.fc + 7, zOf(0.975), 10);
  // aft mooring deck gear
  for (const sx of [-1, 1]) { B.cyl(dark, 1.2, 1.2, 1.6, sx * 8, o.D + 1.5, zOf(0.03), 12, 0, 0, Math.PI / 2); B.cyl(dark, 0.4, 0.45, 1.1, sx * 14, o.D + 0.55, zOf(0.015), 8); }

  // ---- container stowage
  const boxes = [];
  const bayPitch = 12.19 + 1.2;
  const fwdLimit = zOf(0.865) + 2;
  const zones = [
    [fwdLimit, bridgeZ - 13],
    [bridgeZ + 11, funnelZ - 13],
    [funnelZ + 13, zOf(o.aftLimit ?? 0.045)],
  ];
  const deckhouseLen = 22;
  const kindOf = () => {
    const r = rand();
    if (o.style === 'maersk') return r < 0.72 ? 'maersk' : r < 0.78 ? 'reefer' : 'generic';
    if (o.style === 'maersk2') return r < 0.5 ? 'maersk' : r < 0.55 ? 'reefer' : 'generic';
    return r < 0.12 ? 'maersk' : r < 0.2 ? 'reefer' : 'generic';
  };
  const palette = o.palette || BOX_COLORS;
  const bays = [];
  for (const [z0, z1] of zones) {
    let z = z0 + bayPitch / 2;
    while (z + bayPitch / 2 <= z1 + 0.01) { bays.push(z); z += bayPitch; }
  }
  for (const bz of bays) {
    const s = (o.L / 2 - bz) / o.L;
    const hb = Math.min(hullHalfBreadth(s - 0.016, o.D, o), hullHalfBreadth(s + 0.016, o.D, o)) - 1.0;
    const rows = Math.max(2, Math.min(o.rows || 99, Math.floor(2 * hb / 2.53)));
    let tiers = o.tiers;
    if (bz < bridgeZ) { // visibility line (SOLAS V/22)
      const dEye = (bridgeZ - 8) - (bz - 6.1), Dv = (bridgeZ - 8) - (zOf(1) - 500);
      const Hc = eyeY * (1 - dEye / Dv);
      tiers = Math.min(tiers, Math.floor((Hc - hatchTop) / 2.59));
    }
    tiers = Math.max(2, tiers);
    // hatch covers
    B.box(hatchMat, rows * 2.53 + 1.6, 1.6, 12.8, 0, o.D + 0.85, bz);
    for (let r = 0; r < rows; r++) {
      const x = (r - (rows - 1) / 2) * 2.53;
      const edge = Math.min(r, rows - 1 - r);
      let tt = tiers - (edge === 0 && rand() < 0.5 ? 1 : 0) - (rand() < 0.18 ? ri(1, 3) : 0);
      if (o.lightLoad) tt = Math.max(1, tt - ri(0, 4));
      for (let t = 0; t < tt; t++) {
        const kind = kindOf();
        const len = kind !== 'reefer' && rand() < 0.08 ? 6.06 : 12.19;
        if (len < 7) {
          for (const dz of [-3.05, 3.05]) boxes.push({ x, y: hatchTop + t * 2.59, z: bz + dz, kind, color: pick(palette), len: 6.06 });
        } else boxes.push({ x, y: hatchTop + t * 2.59, z: bz, kind, color: pick(palette) });
      }
    }
  }
  // lashing bridges between bays
  for (let i = 0; i < bays.length - 1; i++) {
    if (bays[i + 1] - bays[i] > bayPitch + 0.5) continue;
    const zc = (bays[i] + bays[i + 1]) / 2, s = (o.L / 2 - zc) / o.L;
    const hb = hullHalfBreadth(s, o.D, o) - 1.2;
    B.box(steel, hb * 2, 0.25, 1.0, 0, hatchTop + 2.6, zc); B.box(steel, hb * 2, 0.25, 1.0, 0, hatchTop + 5.2, zc);
    if (o.detail > 1) for (let x = -hb; x <= hb; x += 5.06) B.box(steel, 0.18, 5.4, 0.18, x, hatchTop + 2.7, zc);
    B.box(o.detail > 1 ? new THREE.MeshStandardMaterial({ color: 0xd6b02a, roughness: 0.7 }) : steel, hb * 2, 0.08, 0.05, 0, hatchTop + 6.1, zc - 0.5);
  }
  const cont = buildContainers(boxes, grp, o.detail > 1);

  // ---- deckhouse (accommodation)
  const dhW = o.dhW || Math.min(o.B * 0.62, 36), dhTop = o.bridgeFloor ?? (eyeY - 1.7);
  if (!o.noBridge) {
    const fac = facadeTexture({ cols: 8, rows: 10, wall: '#eef0ef', glass: '#27394a', mx: 0.22, my: 0.3, wh: 0.4, seed: o.seed + 3 });
    fac.wrapS = fac.wrapT = THREE.RepeatWrapping;
    const dhMat = new THREE.MeshStandardMaterial({ map: fac, roughness: 0.6 });
    if (ENV.night) { dhMat.emissiveMap = emissiveWindowsTexture({ cols: 8, rows: 10, mx: 0.22, my: 0.3, wh: 0.4, seed: o.seed + 3, litP: 0.4 }); dhMat.emissiveMap.wrapS = dhMat.emissiveMap.wrapT = THREE.RepeatWrapping; dhMat.emissive.set(0xffffff); dhMat.emissiveIntensity = 1.2; }
    const h = dhTop - o.D - (o.ownBridge ? 0.6 : 0);
    B.add(boxUV(dhW, h, deckhouseLen - 4, 3.2), dhMat, MX(0, o.D + h / 2, bridgeZ + 2));
    // stair towers / lower wider block
    B.add(boxUV(dhW + 8, 9, deckhouseLen, 3.2), dhMat, MX(0, o.D + 4.5, bridgeZ + 1));
    if (!o.ownBridge) {
      // generic bridge on top with wings
      B.add(boxUV(o.B + 1, 3.4, 11, 3.4), new THREE.MeshStandardMaterial({ map: facadeTexture({ cols: 16, rows: 1, wall: '#eef0ef', glass: '#1c2c38', mx: 0.05, my: 0.18, wh: 0.62, seed: 4 }), roughness: 0.5 }), MX(0, dhTop + 1.7, bridgeZ - 3));
      B.box(white, o.B + 1.6, 0.5, 12.5, 0, dhTop + 3.65, bridgeZ - 3);
      B.box(white, 3, 9, 3, 0, dhTop + 8, bridgeZ);   // radar mast
      B.box(dark, 6, 0.3, 0.5, 0, dhTop + 12.6, bridgeZ);
    }
    // lifeboats (orange, enclosed)
    for (const sx of [-1, 1]) {
      const lb = new THREE.CapsuleGeometry(1.6, 6.5, 4, 10); lb.rotateX(Math.PI / 2); lb.scale(1, 0.85, 1);
      B.add(lb, new THREE.MeshStandardMaterial({ color: 0xf06a14, roughness: 0.5 }), MX(sx * (dhW / 2 + 3), o.D + 15, bridgeZ + 4));
      B.box(steel, 0.4, 5, 0.4, sx * (dhW / 2 + 1.2), o.D + 14, bridgeZ + 1); B.box(steel, 0.4, 5, 0.4, sx * (dhW / 2 + 1.2), o.D + 14, bridgeZ + 7);
    }
  }
  // ---- engine casing & funnel
  const fW = o.funnelW || Math.min(18, o.B * 0.34), fTop = o.funnelTop || (hatchTop + o.tiers * 2.59 + 6);
  B.box(white, fW + 6, fTop - o.D - 12, 22, 0, o.D + (fTop - o.D - 12) / 2, funnelZ);
  const fMat = new THREE.MeshStandardMaterial({ color: o.funnelColor || '#42b0d5', roughness: 0.5 });
  if (o.style === 'maersk' || o.style === 'maersk2') {
    const c = makeCanvas(512, 512), x = c.getContext('2d');
    x.fillStyle = '#42b0d5'; x.fillRect(0, 0, 512, 512); drawStar(x, 256, 250, 150, '#fff');
    fMat.map = canvasTexture(c); fMat.color.set(0xffffff);
  }
  const fb = new THREE.BoxGeometry(fW, 12, 14);
  B.add(fb, fMat, MX(0, fTop - 6, funnelZ + 1));
  B.box(dark, fW + 0.2, 1.5, 14.2, 0, fTop + 0.3, funnelZ + 1);
  for (const sx of [-2.5, 2.5]) for (const dz of [-3, 2]) B.cyl(dark, 0.8, 0.8, 3, sx, fTop + 1.5, funnelZ + dz, 10);
  // stern flagpole
  B.cyl(white, 0.08, 0.1, 7, 0, o.D + 3.5, zOf(0.004), 6);
  B.build(grp, { cast: o.detail > 1, receive: true });

  // flag
  if (o.flag) {
    const c = makeCanvas(128, 96), x = c.getContext('2d');
    x.fillStyle = '#c8102e'; x.fillRect(0, 0, 128, 96); x.fillStyle = '#fff'; x.fillRect(38, 0, 14, 96); x.fillRect(0, 41, 128, 14);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8, 8, 1), new THREE.MeshStandardMaterial({ map: canvasTexture(c), side: THREE.DoubleSide, roughness: 0.8 }));
    fl.position.set(0, o.D + 6.1, zOf(0.004) + 1.2); fl.rotation.y = Math.PI / 2;
    grp.add(fl); grp.userData.flag = fl;
  }
  grp.userData.o = o;
  grp.userData.bridgeZ = bridgeZ; grp.userData.funnelZ = funnelZ; grp.userData.eyeY = eyeY;
  grp.userData.containers = cont;
  return grp;
}

// ---------------------------------------------------------------- tanker / bulker
function buildTanker(o) {
  o = Object.assign({ T: 11, D: 9, fc: 2.5, rake: 4, detail: 1, boot: '#6d1f1b', bootTop: 3.5, seed: 3, bowStart: 0.82, sternEnd: 0.14 }, o);
  const grp = new THREE.Group();
  const hull = new THREE.Mesh(hullGeometry(o), new THREE.MeshStandardMaterial({ map: hullTexture({ ...o, hullText: null }), roughness: 0.6 }));
  grp.add(hull);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x7a3a2c, roughness: 0.9 });
  grp.add(deckMesh(o, o.D, deckMat, 0, 0.9)); grp.add(deckMesh(o, o.D + o.fc, deckMat, 0.875, 1));
  grp.add(transomMesh(o, new THREE.MeshStandardMaterial({ color: o.hull })));
  const B = new Batcher();
  const white = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.6 });
  const pipe = new THREE.MeshStandardMaterial({ color: 0x9aa0a0, roughness: 0.6, metalness: 0.4 });
  for (const x of [-3, -1.5, 0, 1.5, 3]) B.cyl(pipe, 0.35, 0.35, o.L * 0.7, x, o.D + 1, -o.L * 0.08, 8, Math.PI / 2);
  B.box(white, o.B * 0.2, 1.5, 3, 0, o.D + 1.5, -o.L * 0.05);
  const fac = facadeTexture({ cols: 8, rows: 6, wall: '#f1f1ee', glass: '#26333d', seed: 5 }); fac.wrapS = fac.wrapT = THREE.RepeatWrapping;
  B.add(boxUV(o.B * 0.8, 16, 16, 3.2), new THREE.MeshStandardMaterial({ map: fac, roughness: 0.6 }), MX(0, o.D + 8, o.L / 2 - 26));
  B.box(white, o.B + 1, 3.2, 8, 0, o.D + 17.6, o.L / 2 - 30);
  B.box(new THREE.MeshStandardMaterial({ color: 0x2a2f33 }), 7, 12, 9, 0, o.D + 20, o.L / 2 - 16);
  B.cyl(white, 0.4, 0.5, 14, 0, o.D + o.fc + 7, -o.L / 2 + 10, 8);
  B.build(grp, { receive: true });
  if (ENV.night) { glowSprite(0xfff3dd, 14, grp, 0, o.D + 16, -o.L / 2 + 10, '255,240,220'); glowSprite(0xfff3dd, 14, grp, 0, o.D + 26, o.L / 2 - 16, '255,240,220'); }
  return grp;
}

// ---------------------------------------------------------------- tug (ASD)
function buildTug(name, hullCol = '#b3261e') {
  const o = { L: 32, B: 12.8, T: 5.5, D: 2.8, fc: 1.6, rake: 1.5, hull: hullCol, boot: '#2a2a2a', bootTop: 0.4, detail: 1, name, port: 'WESTERHAVEN', bowStart: 0.62, sternEnd: 0.25, seed: name.length };
  const g = new THREE.Group();
  g.add(new THREE.Mesh(hullGeometry(o), new THREE.MeshStandardMaterial({ map: hullTexture(o), roughness: 0.55 })));
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x4b4f52, roughness: 0.9 });
  g.add(deckMesh(o, o.D, deckMat, 0, 0.9)); g.add(deckMesh(o, o.D + o.fc, deckMat, 0.875, 1));
  g.add(transomMesh(o, new THREE.MeshStandardMaterial({ color: hullCol })));
  const B = new Batcher();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2833, roughness: 0.1, metalness: 0.6 });
  // fender belt
  const ell = []; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; ell.push(new THREE.Vector3(Math.cos(a) * 6.9, 2.4, Math.sin(a) * 16.4 - 0.5)); }
  B.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ell, true), 64, 0.65, 6, true), black);
  B.box(black, 8, 2.2, 1.6, 0, 3.4, -16.6);
  // superstructure & wheelhouse
  B.box(white, 8, 2.6, 11, 0, o.D + 1.3, -1);
  B.box(white, 6.6, 2.4, 6.4, 0, o.D + 3.8, -2.4);
  B.box(glass, 6.8, 1.3, 6.6, 0, o.D + 4.2, -2.4);
  B.box(white, 7.2, 0.3, 7.0, 0, o.D + 5.1, -2.4);
  B.box(white, 1.2, 4.2, 1.2, 0, o.D + 7.2, -1.8);
  for (const sx of [-2, 2]) B.cyl(new THREE.MeshStandardMaterial({ color: 0x222222 }), 0.45, 0.45, 3.5, sx, o.D + 4.2, 4, 8);
  B.cyl(new THREE.MeshStandardMaterial({ color: 0x3a3f44, metalness: 0.5, roughness: 0.4 }), 1.1, 1.3, 1.4, 0, o.D + 2.2, -9, 12); // winch
  B.cyl(white, 0.3, 0.3, 1.2, 0, o.D + o.fc + 0.6, -13.4, 8); // staple
  B.build(g, { cast: true, dynamic: true });
  glowSprite(0xffffff, 3, g, 0, o.D + 9.3, -1.8);
  return g;
}

function buildPilotBoat() {
  const o = { L: 18, B: 5.4, T: 1.2, D: 1.8, fc: 0.8, rake: 1.5, hull: '#161616', boot: '#8a1d1a', bootTop: 0.3, detail: 1, name: 'PILOT', hullText: 'PILOT', hullTextH: 1.0, hullTextY: 1.0, bowStart: 0.55, sternEnd: 0.08, seed: 4 };
  const g = new THREE.Group();
  g.add(new THREE.Mesh(hullGeometry(o), new THREE.MeshStandardMaterial({ map: hullTexture(o), roughness: 0.5 })));
  g.add(deckMesh(o, o.D, new THREE.MeshStandardMaterial({ color: 0x3a3a3a }), 0, 0.9));
  g.add(transomMesh(o, new THREE.MeshStandardMaterial({ color: '#161616' })));
  const B = new Batcher();
  const orange = new THREE.MeshStandardMaterial({ color: 0xf0661a, roughness: 0.5 });
  B.box(orange, 4.2, 2.2, 6.5, 0, o.D + 1.1, 0.5);
  B.box(new THREE.MeshStandardMaterial({ color: 0x1b2833, roughness: 0.1, metalness: 0.6 }), 4.3, 0.9, 6.0, 0, o.D + 1.6, 0.5);
  B.box(orange, 0.4, 3, 0.4, 0, o.D + 3.5, 2);
  B.build(g, { dynamic: true, cast: true });
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), new THREE.MeshStandardMaterial({ map: stripesTexture('#ffffff', '#c8102e', 2, true), side: THREE.DoubleSide }));
  fl.position.set(0, o.D + 4.6, 2.5); fl.rotation.y = Math.PI / 2; g.add(fl);
  glowSprite(0xffffff, 2.4, g, 0, o.D + 5.1, 2); glowSprite(0xff2020, 2.4, g, 0, o.D + 4.7, 2, '255,40,30');
  return g;
}
