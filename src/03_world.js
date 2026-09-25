// ============================================================================
// 03 — WORLD: geography, bathymetry, port, terminal, cranes, buoys, city
// World: x = east, z = south, y = up; 1 unit = 1 m. Waterline y = 0.
// ============================================================================
const QUAY_H = 4.6;       // quay deck above water
const FENDER = 2.2;       // fender stand-off from quay face
const GEO = {
  mainland: [[-1200, -9000], [16000, -9000], [16000, 9000], [-1200, 9000], [-1200, 760], [1500, 760], [1500, -700], [-1200, -700]],
  breakN: [[-1200, -700], [-2440, -700], [-2632, -382], [-2694, -410], [-2505, -762], [-1200, -762]],
  breakS: [[-1200, 700], [-2440, 700], [-2632, 382], [-2694, 410], [-2505, 762], [-1200, 762]],
  quays: [
    { id: 'N', x0: -1150, x1: 1450, z: -700, axis: 'x', face: 1 },   // faces south (+z)
    { id: 'E', z0: -650, z1: 710, x: 1500, axis: 'z', face: -1 },    // faces west (-x)
    { id: 'S', x0: -1150, x1: 1450, z: 760, axis: 'x', face: -1 },   // faces north (-z)
  ],
  berth: { name: 'Berth 4', x: 300, z: -700 + FENDER + 58.6 / 2, x0: 100, x1: 500 },
  channel: { x0: -13600, x1: -2500, half: 300 },
  pilotStation: [-10600, 0],
  seaBuoy: [-13200, 0],
  buoys: [],
};
// channel buoys, IALA region A: red to port when entering (heading east → north side)
(() => {
  const xs = [-12000, -10500, -9000, -7500, -6000, -4500, -3200];
  xs.forEach((x, i) => {
    GEO.buoys.push({ x, z: 320, type: 'green', name: 'W' + (2 * i + 1), per: 4, flashes: 1, phase: i * 0.7 });
    GEO.buoys.push({ x, z: -320, type: 'red', name: 'W' + (2 * i + 2), per: 4, flashes: 1, phase: i * 0.7 + 2 });
  });
  GEO.buoys.push({ x: GEO.seaBuoy[0], z: GEO.seaBuoy[1], type: 'safe', name: 'WH', per: 10, flashes: 1, long: true, phase: 0 });
  GEO.buoys.push({ x: -6600, z: 1150, type: 'cardN', name: 'WESTBANK N', per: 1, flashes: 99, phase: 0 });
  GEO.buoys.push({ x: -8800, z: -1150, type: 'cardS', name: 'NOORDBANK S', per: 15, flashes: 6, phase: 0 });
  GEO.buoys.push({ x: -1900, z: -560, type: 'red', name: 'H2', per: 3, flashes: 2, phase: 1 });
  GEO.buoys.push({ x: -1900, z: 560, type: 'green', name: 'H1', per: 3, flashes: 2, phase: 0 });
})();

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function isLand(x, z) { return pointInPoly(x, z, GEO.mainland) || pointInPoly(x, z, GEO.breakN) || pointInPoly(x, z, GEO.breakS); }

// ------------------------------------------------------------- bathymetry
function depthAt(x, z) {
  if (x > -1200 && x < 1500 && z > -700 && z < 760) {       // dredged basin
    let d = 18.8;
    d = lerp(d, 10.5, smooth(470, 640, z));                   // feeder berths in the south
    d = lerp(d, 16.8, smooth(1330, 1460, x));
    d += (vnoise(x * 0.01, z * 0.01) - 0.5) * 0.6;
    return d;
  }
  if (x >= -1200) return -5;
  const off = -1200 - x;
  let d = 7.2 + off * 0.0023 + (fbm(x * 0.0009, z * 0.0009, 3) - 0.5) * 3.2;
  d -= 7.5 * Math.exp(-(Math.pow((x + 6400) / 1700, 2) + Math.pow((z - 1500) / 520, 2)));   // Westbank
  d -= 6.8 * Math.exp(-(Math.pow((x + 8900) / 1900, 2) + Math.pow((z + 1600) / 620, 2)));  // Noordbank
  d -= 4.0 * Math.exp(-(Math.pow((x + 3600) / 900, 2) + Math.pow((z - 900) / 500, 2)));
  // dredged approach channel (Westgeul): -20.5 m with 1:4 side slopes
  const ch = GEO.channel;
  if (x > ch.x0 - 600 && x < ch.x1 + 400) {
    const t = 1 - smooth(ch.half, ch.half + 90, Math.abs(z));
    const along = smooth(ch.x0 - 600, ch.x0, x);
    d = Math.max(d, lerp(d, 20.8, t * along));
  }
  // outer harbour between breakwaters
  if (x > -2760 && Math.abs(z) < 700) {
    const t = 1 - smooth(560, 700, Math.abs(z));
    d = Math.max(d, lerp(d, 19.6, t * smooth(-2800, -2600, x)));
  }
  return Math.max(d, 1.2);
}

// fender/quay contact & allision (called by physics for each hull point)
function worldContact(px, pz, vx, vz) {
  const k = 3.2e6, c = 2.6e7, mu = 0.25;
  for (const q of GEO.quays) {
    if (q.axis === 'x') {
      if (px < q.x0 || px > q.x1) continue;
      const line = q.z + q.face * FENDER; // fender face line
      const pen = q.face > 0 ? line - pz : pz - line;
      if (pen > 0 && pen < 30) {
        const vn = -vz * q.face;   // speed into the quay
        const fn = k * pen + Math.max(0, vn) * c;
        return { fx: -mu * fn * Math.tanh(vx * 4), fz: fn * q.face, normalSpeed: Math.max(0, vn), kind: 'fender', quay: q.id };
      }
    } else {
      if (pz < q.z0 || pz > q.z1) continue;
      const line = q.x + q.face * FENDER;
      const pen = q.face > 0 ? line - px : px - line;
      if (pen > 0 && pen < 30) {
        const vn = -vx * q.face;
        const fn = k * pen + Math.max(0, vn) * c;
        return { fx: fn * q.face, fz: -mu * fn * Math.tanh(vz * 4), normalSpeed: Math.max(0, vn), kind: 'fender', quay: q.id };
      }
    }
  }
  if (isLand(px, pz)) {
    const sp = Math.hypot(vx, vz);
    return { fx: -vx * 9e7, fz: -vz * 9e7, normalSpeed: sp, kind: 'land' };
  }
  // static moored ships
  for (const s of WORLD.staticShips) {
    const dx = px - s.x, dz = pz - s.z;
    const a = dx * Math.sin(s.psi) - dz * Math.cos(s.psi), b = dx * Math.cos(s.psi) + dz * Math.sin(s.psi);
    if (Math.abs(a) < s.L / 2 && Math.abs(b) < s.B / 2) return { fx: -vx * 9e7, fz: -vz * 9e7, normalSpeed: Math.hypot(vx, vz), kind: 'ship', name: s.name };
  }
  return null;
}

// ------------------------------------------------------------- materials
const MAT = {};
function initMaterials() {
  const std = (c, r = 0.8, m = 0, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...o });
  const tex = (k, rep) => { const t = groundTexture(k); t.repeat.set(rep, rep); return t; };
  MAT.concrete = std(0xcfcfcb, 0.95, 0, { map: tex('concrete', 1 / 24) });
  MAT.asphalt = std(0x8a8c8e, 0.95, 0, { map: tex('asphalt', 1 / 20) });
  MAT.grass = std(0xc4cc9a, 1, 0, { map: tex('grass', 1 / 30) });
  MAT.sand = std(0xd8c9a6, 1, 0, { map: tex('sand', 1 / 25) });
  MAT.rock = std(0xd2cec4, 1, 0, { map: tex('rock', 1 / 14) });
  MAT.rockBox = std(0xc4c0b6, 1, 0, { map: tex('rock', 1) });
  MAT.quayWall = std(0x77756f, 0.95, 0, { map: tex('concrete', 1 / 12) });
  MAT.craneBlue = std(0x2a6aa3, 0.55, 0.35);
  MAT.craneWhite = std(0xe4e7e8, 0.55, 0.25);
  MAT.white = std(0xe9ecee, 0.6, 0.05);
  MAT.grey = std(0x8d9396, 0.7, 0.2);
  MAT.darkSteel = std(0x2b3035, 0.55, 0.55);
  MAT.steel = std(0x6d747a, 0.5, 0.6);
  MAT.yellow = std(0xf1bf22, 0.6, 0.1);
  MAT.black = std(0x121314, 0.85);
  MAT.rubber = std(0x161616, 0.92);
  MAT.red = std(0xb22a22, 0.6, 0.1);
  MAT.green = std(0x1e8a3c, 0.6, 0.1);
  MAT.orange = std(0xe2621b, 0.6, 0.1);
  MAT.glass = std(0x223a4c, 0.12, 0.7);
  MAT.lampOn = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 2) });
  MAT.lampOff = std(0xdddddd, 0.3, 0.1);
  MAT.turbine = std(0xf0f2f2, 0.5, 0.05);
  MAT.lineWhite = std(0xf5f5f0, 0.8);
  MAT.lineYellow = std(0xf2c21a, 0.8);
  MAT.hazard = std(0xffffff, 0.6, 0.1, { map: (() => { const c = makeCanvas(128, 128), x = c.getContext('2d'); x.fillStyle = '#f2c21a'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#151515'; for (let k = -4; k < 8; k++) { x.beginPath(); x.moveTo(k * 32, 0); x.lineTo(k * 32 + 16, 0); x.lineTo(k * 32 + 16 + 128, 128); x.lineTo(k * 32 + 128, 128); x.fill(); } return canvasTexture(c); })() });
  MAT.hatch = std(0x56645e, 0.8, 0.2);
  MAT.agv = std(0xf0b400, 0.55, 0.2);
  MAT.tree = std(0x3f5a2c, 0.95); MAT.tree2 = std(0x55703a, 0.95); MAT.trunk = std(0x4a3a2a, 0.95);
  MAT.silo = std(0xd8d8d2, 0.6, 0.2);
  const fac2 = (o) => { const t = facadeTexture(o); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  MAT.glassTower = std(0xffffff, 0.15, 0.7, { map: fac2({ cols: 10, rows: 12, wall: '#7f93a3', glass: '#2c4a62', mx: 0.04, my: 0.06, wh: 0.86, seed: 21 }), envMapIntensity: 1.3 });
  MAT.brick = std(0xffffff, 0.9, 0, { map: fac2({ cols: 6, rows: 5, wall: '#8a5a44', glass: '#2a3238', seed: 22 }) });
  MAT.whiteBlock = std(0xffffff, 0.8, 0, { map: fac2({ cols: 7, rows: 7, wall: '#e3e0d8', glass: '#34414b', seed: 23 }) });
  MAT.shed = std(0xffffff, 0.7, 0.3, { map: fac2({ cols: 16, rows: 2, wall: '#9fb4c2', glass: '#5c6b75', mx: 0.02, my: 0.1, wh: 0.08, seed: 24 }) });
  const fac = (o) => { const t = facadeTexture(o); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  MAT.office = std(0xffffff, 0.5, 0.2, { map: fac({ cols: 8, rows: 8, wall: '#c9d0d6', glass: '#2a4458', mx: 0.08, my: 0.15, wh: 0.7, night: false, seed: 11 }) });
  MAT.building = std(0xffffff, 0.8, 0.05, { map: fac({ cols: 6, rows: 6, wall: '#b9b3a8', glass: '#34414b', seed: 12 }) });
  MAT.hall = std(0xffffff, 0.8, 0.1, { map: fac({ cols: 12, rows: 3, wall: '#8fa1ad', glass: '#2c3a44', mx: 0.3, my: 0.6, wh: 0.15, seed: 13 }) });
  MAT.tank = std(0xe3e3de, 0.5, 0.2);
  if (ENV.night) {
    const em = (o) => { const t = emissiveWindowsTexture(o); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
    MAT.office.emissiveMap = em({ cols: 8, rows: 8, mx: 0.08, my: 0.15, wh: 0.7, seed: 11, litP: 0.5 }); MAT.office.emissive.set(0xffffff); MAT.office.emissiveIntensity = 1.3;
    MAT.building.emissiveMap = em({ cols: 6, rows: 6, seed: 12, litP: 0.35 }); MAT.building.emissive.set(0xffffff); MAT.building.emissiveIntensity = 1.1;
    MAT.hall.emissiveMap = em({ cols: 12, rows: 3, mx: 0.3, my: 0.6, wh: 0.15, seed: 13, litP: 0.6 }); MAT.hall.emissive.set(0xffffff);
    for (const [m, o] of [[MAT.glassTower, { cols: 10, rows: 12, mx: 0.04, my: 0.06, wh: 0.86, seed: 21, litP: 0.4 }], [MAT.brick, { cols: 6, rows: 5, seed: 22, litP: 0.4 }], [MAT.whiteBlock, { cols: 7, rows: 7, seed: 23, litP: 0.35 }]]) { m.emissiveMap = em(o); m.emissive.set(0xffffff); m.emissiveIntensity = 1.1; }
  }
}

// box with UVs scaled in metres (tiling facade textures)
function boxUV(w, h, d, s = 10) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k; let su = 1, sv = 1;
    if (f < 2) { su = d / s; sv = h / s; } else if (f < 4) { su = w / s; sv = d / s; } else { su = w / s; sv = h / s; }
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  return g;
}

// ------------------------------------------------------------- containers
const CONTAINER = {};
const BOX_COLORS = ['#a8382a', '#7e2b22', '#1f5b98', '#243a86', '#e06a1a', '#eea224', '#1d7244', '#6d7982', '#dcdcd8', '#cbc2ae', '#a0145c', '#0c5a6a', '#9a9c9c', '#5e6f2f', '#3b3f44', '#c7c9c9', '#b86a2a', '#2c6e9e'];
function initContainers() {
  CONTAINER.geo = containerGeometry();
  for (const k of ['maersk', 'generic', 'reefer']) {
    const a = containerAtlas(k);
    CONTAINER[k] = new THREE.MeshStandardMaterial({ map: a.map, bumpMap: a.bump, bumpScale: 1.2, roughness: 0.62, metalness: 0.25 });
  }
}
// list items: {x,y,z,ry,kind,color} — y is bottom of box
function buildContainers(list, parent, cast = false) {
  const groups = { maersk: [], generic: [], reefer: [] };
  for (const c of list) groups[c.kind || 'generic'].push(c);
  const out = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), col = new THREE.Color();
  for (const k in groups) {
    const arr = groups[k]; if (!arr.length) continue;
    const im = new THREE.InstancedMesh(CONTAINER.geo, CONTAINER[k], arr.length);
    arr.forEach((c, i) => {
      q.setFromAxisAngle(_up, c.ry || 0);
      s.set(1, 1, c.len ? c.len / 12.19 : 1);
      p.set(c.x, c.y + 1.295, c.z);
      m.compose(p, q, s); im.setMatrixAt(i, m);
      if (k === 'generic') col.set(c.color || '#888'); else col.setScalar(0.82 + rand() * 0.18);
      im.setColorAt(i, col);
    });
    im.castShadow = cast; im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    parent.add(im); out.push(im);
  }
  return out;
}
const _up = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------- world build
const WORLD = { buoys: [], lights: [], turbines: [], cranesAnim: [], vehicles: [], birds: [], staticShips: [], bas: [], flashers: [], radarPts: null, lamps: [] };

function extrudePoly(poly, top, depth, mat, parent) {
  const sh = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(Math.PI / 2); g.translate(0, top, 0);
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; parent.add(m);
  return m;
}
function flatPoly(poly, y, mat, parent) {
  const sh = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(Math.PI / 2); g.translate(0, y, 0);
  // ShapeGeometry after rotateX(+90) faces down – flip winding
  const idx = g.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; parent.add(m);
  return m;
}

async function buildWorld(progress) {
  const root = new THREE.Group(); root.name = 'world'; scene.add(root);
  WORLD.root = root;
  initMaterials(); initContainers();
  reseed(2024);
  const B = new Batcher();

  // ---------- land
  const land = extrudePoly(GEO.mainland, QUAY_H, 40, [MAT.grass, MAT.quayWall], root);
  land.material = [MAT.grass, MAT.quayWall];
  extrudePoly(GEO.breakN, 6.5, 40, [MAT.rock, MAT.rock], root);
  extrudePoly(GEO.breakS, 6.5, 40, [MAT.rock, MAT.rock], root);
  // terminal paving
  flatPoly([[-1200, -700], [1500, -700], [1500, -1650], [-1200, -1650]], QUAY_H + 0.25, MAT.concrete, root);
  flatPoly([[1500, -1650], [2600, -1650], [2600, 760], [1500, 760]], QUAY_H + 0.25, MAT.concrete, root);
  flatPoly([[-1200, 760], [1500, 760], [1500, 1500], [-1200, 1500]], QUAY_H + 0.25, MAT.asphalt, root);
  flatPoly([[-1200, -1650], [2600, -1650], [2600, -1760], [-1200, -1760]], QUAY_H + 0.28, MAT.asphalt, root);
  // dunes / beach along the open coast
  flatPoly([[-1200, 1500], [-1200, 9000], [-900, 9000], [-900, 1500]], QUAY_H + 0.2, MAT.sand, root);
  flatPoly([[-1200, -9000], [-1200, -1760], [-950, -1760], [-950, -9000]], QUAY_H + 0.2, MAT.sand, root);
  await progress(0.12, 'Dredging the channel');

  // rock armour along breakwaters & open coast (sloped boxes)
  const armour = (a, b, out) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const nx = -dz / len * out, nz = dx / len * out;
    const cx = (a[0] + b[0]) / 2 + nx * 7, cz = (a[1] + b[1]) / 2 + nz * 7;
    const ang = Math.atan2(dx, dz);
    B.add(BOX(18, 3, len + 10), MAT.rockBox, MX(cx, 1.6, cz, 0, ang, 0).multiply(new THREE.Matrix4().makeRotationZ(-0.45 * out * Math.sign(dz || 1))));
  };
  for (const poly of [GEO.breakN, GEO.breakS]) {
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i], b = poly[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const segs = Math.ceil(len / 60);
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs, t1 = (s + 1) / segs;
        const pa = [lerp(a[0], b[0], t0), lerp(a[1], b[1], t0)], pb = [lerp(a[0], b[0], t1), lerp(a[1], b[1], t1)];
        const mx = (pa[0] + pb[0]) / 2, mz = (pa[1] + pb[1]) / 2;
        const ang = Math.atan2(pb[0] - pa[0], pb[1] - pa[1]);
        for (const off of [-1, 1]) {
          const nx = Math.cos(ang) * off, nz = -Math.sin(ang) * off;
          // skip armour that ends up inside the land
          if (isLand(mx + nx * 14, mz + nz * 14)) continue;
          B.add(BOX(16, 3.2, len / segs + 6), MAT.rockBox, MX(mx + nx * 6, 2.2, mz + nz * 6, 0, ang, off * 0.42));
          for (let r = 0; r < 5; r++) {
            const bx = mx + nx * rr(2, 11) + Math.sin(ang) * rr(-20, 20), bz = mz + nz * rr(2, 11) + Math.cos(ang) * rr(-20, 20);
            B.add(new THREE.DodecahedronGeometry(rr(1.2, 2.6), 0), MAT.rockBox, MX(bx, rr(1.5, 5), bz, rr(0, 3), rr(0, 3), 0));
          }
        }
      }
    }
    // crown wall / service road
  }
  B.box(MAT.concrete, 1240, 1.2, 12, -1820, 7.1, -731); B.box(MAT.concrete, 1240, 1.2, 12, -1820, 7.1, 731);
  B.box(MAT.quayWall, 1240, 3.2, 2.2, -1820, 8.6, -752); B.box(MAT.quayWall, 1240, 3.2, 2.2, -1820, 8.6, 752);
  // coast revetment
  for (const [z0, z1] of [[-9000, -762], [762, 9000]]) {
    const n = Math.ceil((z1 - z0) / 80);
    for (let i = 0; i < n; i++) { const z = z0 + (i + 0.5) * (z1 - z0) / n; B.add(BOX(14, 3, (z1 - z0) / n + 4), MAT.rockBox, MX(-1205, 1.8, z, 0, 0, -0.42)); }
  }
  await progress(0.2, 'Building the quays');

  // ---------- quays: fenders, bollards, rails, markings
  for (const q of GEO.quays) {
    const len = q.axis === 'x' ? q.x1 - q.x0 : q.z1 - q.z0;
    const n = Math.floor(len / 25);
    for (let i = 0; i <= n; i++) {
      const t = i * 25;
      let fx, fz, bx, bz, ry;
      if (q.axis === 'x') { fx = q.x0 + t; fz = q.z + q.face * 0.9; bx = fx + 6; bz = q.z - q.face * 1.8; ry = 0; }
      else { fz = q.z0 + t; fx = q.x + q.face * 0.9; bz = fz + 6; bx = q.x - q.face * 1.8; ry = Math.PI / 2; }
      // cone fender + panel
      if (q.axis === 'x') { B.box(MAT.rubber, 3.2, 3.4, 1.8, fx, 1.7, fz); B.box(MAT.darkSteel, 4.2, 4.6, 0.5, fx, 2.2, q.z + q.face * 2.0); B.box(MAT.yellow, 4.2, 0.3, 0.52, fx, 4.4, q.z + q.face * 2.0); }
      else { B.box(MAT.rubber, 1.8, 3.4, 3.2, fx, 1.7, fz); B.box(MAT.darkSteel, 0.5, 4.6, 4.2, q.x + q.face * 2.0, 2.2, fz); }
      // bollard
      B.cyl(MAT.darkSteel, 0.45, 0.55, 1.0, bx, QUAY_H + 0.75, bz, 10);
      B.cyl(MAT.darkSteel, 0.7, 0.6, 0.25, bx, QUAY_H + 1.3, bz, 10);
    }
    // cope edge yellow line + rails
    if (q.axis === 'x') {
      B.box(MAT.yellow, len, 0.06, 0.4, (q.x0 + q.x1) / 2, QUAY_H + 0.29, q.z - q.face * 0.4);
      B.box(MAT.steel, len, 0.2, 0.3, (q.x0 + q.x1) / 2, QUAY_H + 0.33, q.z - q.face * 5);
      B.box(MAT.steel, len, 0.2, 0.3, (q.x0 + q.x1) / 2, QUAY_H + 0.33, q.z - q.face * 35.5);
    } else {
      B.box(MAT.yellow, 0.4, 0.06, len, q.x - q.face * 0.4, QUAY_H + 0.29, (q.z0 + q.z1) / 2);
      B.box(MAT.steel, 0.3, 0.2, len, q.x - q.face * 5, QUAY_H + 0.33, (q.z0 + q.z1) / 2);
      B.box(MAT.steel, 0.3, 0.2, len, q.x - q.face * 35.5, QUAY_H + 0.33, (q.z0 + q.z1) / 2);
    }
  }
  // berth markers for Berth 4
  const bt = GEO.berth;
  for (const [x, lab] of [[bt.x0, 'STERN'], [bt.x1, 'BOW'], [bt.x, 'B4 ◆ MID']]) {
    B.box(MAT.white, 0.25, 7, 0.25, x, QUAY_H + 3.5, -703);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshStandardMaterial({ map: labelTexture(lab, { w: 256, h: 128, bg: '#f2c21b', color: '#111', size: 44 }), roughness: 0.6 }));
    sign.position.set(x, QUAY_H + 6.5, -702.8); root.add(sign);
  }
  // painted berth numbers on the apron
  for (let b = 0; b < 6; b++) {
    const x = -1000 + b * 450;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(26, 13), new THREE.MeshStandardMaterial({ map: labelTexture('BERTH ' + (b + 1), { w: 512, h: 256, bg: 'rgba(0,0,0,0)', color: '#f4f2ea', size: 110 }), transparent: true, roughness: 0.9 }));
    pl.rotation.x = -Math.PI / 2; pl.position.set(x, QUAY_H + 0.31, -716); root.add(pl);
  }
  // berthing aid system (laser distance displays)
  for (const [x, lab] of [[bt.x0 + 40, 'AFT'], [bt.x1 - 40, 'FWD']]) {
    const c = makeCanvas(512, 256); const t = canvasTexture(c);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
    scr.position.set(x, QUAY_H + 9, -709); root.add(scr);
    B.box(MAT.darkSteel, 9.8, 5.3, 0.6, x, QUAY_H + 9, -709.4);
    B.box(MAT.darkSteel, 0.4, 7, 0.4, x - 3, QUAY_H + 3.3, -709.8); B.box(MAT.darkSteel, 0.4, 7, 0.4, x + 3, QUAY_H + 3.3, -709.8);
    B.box(MAT.yellow, 0.8, 0.8, 0.8, x, QUAY_H + 1.1, -701.5); // laser head
    WORLD.bas.push({ canvas: c, ctx: c.getContext('2d'), tex: t, x, lab });
  }
  await progress(0.3, 'Erecting ship-to-shore cranes');

  // ---------- STS cranes (numbered along the quay)
  // shipTop: height of the stacks the working cranes lower onto (NORDIC STAR / ELBE TRADER / CORAL PRINCESS)
  const craneSpots = [
    [-960, 'work', 35.5], [-880, 'work', 35.5], [-800, 'work', 35.5], [-720, 'work', 35.5], [-640, 'work', 35.5],
    [-330, 'up'], [150, 'up'], [235, 'up'], [360, 'up'], [445, 'up'],
    [930, 'work', 31.8], [1010, 'work', 31.8], [1090, 'work', 31.8], [1180, 'work', 31.8],
  ];
  craneSpots.forEach(([x, st, top], i) => buildSTS(B, root, x, -700, 0, st, top, i + 1));
  [-220, -140, -60, 30, 110].forEach((z, i) => buildSTS(B, root, 1500, z, -Math.PI / 2, 'work', 31.8, 21 + i));
  await progress(0.42, 'Stacking the yard');

  // ---------- container yard: ASC blocks perpendicular to the quay
  const yard = [];
  const addBlock = (x0, z0, rows, bays, maxT, ry = 0, fill = 0.94, emptyBays = 2) => {
    for (let r = 0; r < rows; r++) for (let b = emptyBays; b < bays; b++) {
      if (rand() > fill) continue;
      const tiers = Math.max(1, maxT - (rand() < 0.3 ? 1 : 0) - (rand() < 0.08 ? 2 : 0));
      const x = ry === 0 ? x0 + r * 2.9 : x0 + b * 12.8, z = ry === 0 ? z0 - b * 12.8 : z0 + r * 2.9;
      for (let t = 0; t < tiers; t++) {
        const k = rand() < 0.42 ? 'maersk' : rand() < 0.07 ? 'reefer' : 'generic';
        yard.push({ x, y: QUAY_H + 0.25 + t * 2.62, z, ry: ry === 0 ? 0 : Math.PI / 2, kind: k, color: pick(BOX_COLORS) });
      }
    }
  };
  for (let x = -1070; x < 1400; x += 52) {
    addBlock(x, -805, 9, 24, 5);
    addBlock(x, -1135, 9, 20, 4, 0, 0.85);
    const xL = x - 3.2, xR = x + 8 * 2.9 + 3.2;
    for (const [z0, z1] of [[-800, -1105], [-1130, -1385]]) {
      B.box(MAT.steel, 0.3, 0.12, z0 - z1, xL, QUAY_H + 0.31, (z0 + z1) / 2); B.box(MAT.steel, 0.3, 0.12, z0 - z1, xR, QUAY_H + 0.31, (z0 + z1) / 2);
      buildASC(B, root, xL, xR, z0 - 4 - rand() * 18);           // landside ASC at the interchange
      buildASC(B, root, xL, xR, z0 - 60 - rand() * (z0 - z1 - 80));
    }
    // interchange zone hatching at the block end
    for (let k = 0; k < 6; k++) B.box(MAT.lineYellow, 0.5, 0.04, 9, x + 1 + k * 4, QUAY_H + 0.3, -812, Math.PI / 4);
  }
  for (let z = -640; z < 700; z += 52) addBlock(1580, z, 9, 22, 4, Math.PI / 2, 0.88);
  for (let x = -1000; x < 700; x += 60) addBlock(x, 1150, 8, 12, 6, 0, 0.85, 0);
  // reefer racks (powered stacks) at the back of the north blocks
  for (let x = -1070; x < 1400; x += 104) for (let k = 0; k < 4; k++) { B.box(MAT.steel, 0.3, 14, 0.3, x - 1.5, QUAY_H + 7, -1150 - k * 50); B.box(MAT.steel, 0.3, 0.2, 0.9, x - 1.5, QUAY_H + 5.4 + (k % 2) * 5.2, -1150 - k * 50); }
  buildContainers(yard, root, false);

  // ---------- ground markings: apron lanes, crane rail trench, roads
  const H1 = QUAY_H + 0.31;
  const dashX = (x0, x1, z, mat = MAT.lineWhite, w = 0.18, dash = 6, gap = 6) => { for (let x = x0; x < x1; x += dash + gap) B.box(mat, dash, 0.04, w, x + dash / 2, H1, z); };
  const lineX = (x0, x1, z, mat = MAT.lineWhite, w = 0.2) => B.box(mat, x1 - x0, 0.04, w, (x0 + x1) / 2, H1, z);
  lineX(-1150, 1450, -708.5, MAT.lineYellow, 0.3);
  lineX(-1150, 1450, -733, MAT.lineYellow, 0.3);
  for (const z of [-712.5, -719.5, -726.5]) dashX(-1150, 1450, z);
  B.box(MAT.darkSteel, 2600, 0.03, 1.2, 150, QUAY_H + 0.29, -733.8);            // cable trench
  lineX(-1150, 1450, -745, MAT.lineWhite, 0.25); lineX(-1150, 1450, -792, MAT.lineWhite, 0.25);
  dashX(-1150, 1450, -768, MAT.lineWhite, 0.2, 4, 8);
  lineX(-1150, 1450, -1112, MAT.lineWhite, 0.2); dashX(-1150, 1450, -1118, MAT.lineWhite, 0.18, 4, 8); lineX(-1150, 1450, -1124, MAT.lineWhite, 0.2);
  for (let z = -1500; z < 700; z += 26) dashX(1510, 1570, z, MAT.lineWhite, 0.18, 3, 5);
  // hatch covers landed on the quay behind the working cranes
  for (const [x0, x1, zc] of [[-990, -620, -752], [900, 1210, -752]]) for (let x = x0; x < x1; x += 46) { const n = 1 + ri(0, 2); for (let k = 0; k < n; k++) B.box(MAT.hatch, 13.2, 1.5, 11, x, QUAY_H + 0.3 + 0.75 + k * 1.6, zc + (k % 2) * 0.3); }
  // lashing gear cages & empty trailers along the service lane
  for (let x = -1100; x < 1400; x += 70) B.box(MAT.grey, 2.4, 1.6, 2.4, x + rr(-10, 10), QUAY_H + 1.1, -788);
  await progress(0.55, 'Lighting the terminal');

  // ---------- light masts
  for (let x = -1100; x <= 1450; x += 150) for (const z of [-790, -1120, -1450]) lightMast(B, root, x, z);
  for (let z = -600; z <= 700; z += 180) lightMast(B, root, 1560, z);

  // ---------- buildings
  B.add(boxUV(70, 32, 34, 8), MAT.office, MX(-600, QUAY_H + 16, -1600));
  B.add(boxUV(46, 58, 30, 8), MAT.office, MX(-520, QUAY_H + 29, -1620));
  B.add(boxUV(160, 22, 60, 10), MAT.hall, MX(200, QUAY_H + 11, -1580));
  B.add(boxUV(120, 18, 50, 10), MAT.hall, MX(700, QUAY_H + 9, -1590));
  B.add(boxUV(90, 26, 40, 8), MAT.building, MX(2100, QUAY_H + 13, -1200));
  // gate canopy
  B.box(MAT.white, 120, 1.2, 26, 1100, QUAY_H + 7, -1700);
  for (let i = 0; i < 9; i++) B.box(MAT.grey, 0.8, 7, 0.8, 1045 + i * 14, QUAY_H + 3.5, -1700);
  // control tower (VTS) at the entrance
  B.cyl(MAT.white, 5, 6, 38, -1160, QUAY_H + 19, -800, 16);
  B.cyl(MAT.glass, 9, 8, 6, -1160, QUAY_H + 41, -800, 16);
  B.cyl(MAT.white, 9.6, 9.6, 1, -1160, QUAY_H + 44.5, -800, 16);
  // tank farm & industry (south)
  for (let i = 0; i < 18; i++) {
    const x = -950 + (i % 6) * 95, z = 1650 + Math.floor(i / 6) * 95, r = rr(28, 38), h = rr(16, 24);
    B.cyl(MAT.tank, r, r, h, x, QUAY_H + h / 2, z, 32);
    B.cyl(MAT.grey, r * 0.98, r, 1.2, x, QUAY_H + h + 0.6, z, 32);
  }
  for (const [x, z, h] of [[600, 2100, 110], [720, 2150, 90], [2400, 1800, 140]]) {
    B.cyl(MAT.white, 3, 4.5, h, x, QUAY_H + h / 2, z, 16);
    for (let k = 0; k < 4; k++) B.cyl(MAT.red, 3.2 - k * 0.2, 3.3 - k * 0.2, 8, x, QUAY_H + h - 6 - k * 22, z, 16);
    WORLD.flashers.push(glowSprite(0xff2a1a, 30, root, x, QUAY_H + h + 3, z, '255,60,40'));
  }
  // refinery flare
  B.cyl(MAT.steel, 1.6, 2.4, 90, 1800, QUAY_H + 45, 2600, 10);
  WORLD.flare = glowSprite(0xffa040, 60, root, 1800, QUAY_H + 96, 2600, '255,170,70');
  await progress(0.62, 'Raising the skyline');

  // ---------- city skyline (NE): downtown towers, residential blocks, warehouses
  const cityMats = [MAT.glassTower, MAT.office, MAT.building, MAT.brick, MAT.whiteBlock];
  for (let i = 0; i < 150; i++) {
    const cluster = rand() < 0.35;
    const x = cluster ? 6200 + rr(-900, 900) : rr(3200, 11500), z = cluster ? -4200 + rr(-900, 900) : rr(-7500, -1900);
    const w = rr(22, 60), d = rr(22, 60);
    const h = cluster ? rr(60, 190) : Math.pow(rand(), 2.4) * 90 + 14;
    const m = h > 90 ? pick([MAT.glassTower, MAT.office]) : pick(cityMats);
    B.add(boxUV(w, h, d, m === MAT.glassTower ? 14 : 10), m, MX(x, QUAY_H + h / 2, z, 0, rr(-0.15, 0.15), 0));
    if (h > 110) { B.box(MAT.grey, w * 0.5, 4, d * 0.5, x, QUAY_H + h + 2, z); B.cyl(MAT.white, 0.3, 0.3, 14, x, QUAY_H + h + 11, z, 6); }
  }
  // industrial halls & logistics warehouses (east and south)
  for (let i = 0; i < 55; i++) {
    const x = rr(2800, 12000), z = rr(1200, 7000), w = rr(50, 160), h = rr(10, 24);
    B.add(boxUV(w, h, rr(40, 110), 10), rand() < 0.6 ? MAT.shed : MAT.hall, MX(x, QUAY_H + h / 2, z, 0, rr(-0.2, 0.2), 0));
  }
  for (let i = 0; i < 14; i++) { const x = 2700 + i * 70, z = -1900 - (i % 3) * 60, h = rr(14, 22); B.add(boxUV(60, h, 40, 10), MAT.shed, MX(x, QUAY_H + h / 2, z)); }
  // cement / grain silos with elevator tower
  for (let k = 0; k < 8; k++) B.cyl(MAT.silo, 7, 7, 42, 3000 + (k % 4) * 15, QUAY_H + 21, -2300 + Math.floor(k / 4) * 15, 20);
  B.add(boxUV(10, 62, 10, 6), MAT.whiteBlock, MX(3070, QUAY_H + 31, -2293));
  // high-voltage pylons feeding the terminal substation
  const pyl = [];
  for (let x = 2700; x <= 11000; x += 400) {
    const z = -2600 + Math.sin(x * 0.0007) * 120, h = 48;
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) B.beam(MAT.steel, new THREE.Vector3(x + dx, QUAY_H, z + dz), new THREE.Vector3(x + dx * 0.25, QUAY_H + h, z + dz * 0.25), 0.4);
    for (const y of [h * 0.55, h * 0.75, h * 0.95]) B.box(MAT.steel, 0.5, 0.5, y > h * 0.9 ? 12 : 20, x, QUAY_H + y, z);
    for (let k = 0; k < 5; k++) B.box(MAT.steel, 0.2, 0.2, 7 - k, x, QUAY_H + 6 + k * 8, z, 0, 0.6);
    pyl.push([x, z]);
  }
  for (let i = 0; i < pyl.length - 1; i++) for (const off of [-9.5, 9.5]) for (const hy of [26, 36]) {
    const [x0, z0] = pyl[i], [x1, z1] = pyl[i + 1];
    for (let k = 0; k < 8; k++) { const t0 = k / 8, t1 = (k + 1) / 8, sag = (t) => -7 * 4 * t * (1 - t); B.beam(MAT.darkSteel, new THREE.Vector3(lerp(x0, x1, t0), QUAY_H + hy + sag(t0), lerp(z0, z1, t0) + off), new THREE.Vector3(lerp(x0, x1, t1), QUAY_H + hy + sag(t1), lerp(z0, z1, t1) + off), 0.08); }
  }
  // trees: shelter belts, parks and dune scrub (instanced)
  {
    const spots = [];
    const addClump = (cx, cz, n, r) => { for (let k = 0; k < n; k++) { const a = rand() * 7, d = Math.sqrt(rand()) * r; spots.push([cx + Math.cos(a) * d, cz + Math.sin(a) * d, rr(6, 13)]); } };
    for (let x = -1100; x < 2600; x += 18) spots.push([x + rr(-4, 4), -1790 + rr(-8, 8), rr(8, 13)]);          // belt behind the terminal
    for (let z = -1650; z < 1500; z += 20) spots.push([2640 + rr(-5, 5), z, rr(8, 12)]);
    for (let i = 0; i < 60; i++) addClump(rr(2800, 11500), rr(-7500, 7000), ri(8, 30), rr(40, 160));
    for (let i = 0; i < 40; i++) addClump(rr(-1150, -950), rr(1600, 8800), ri(4, 10), 30);
    const crownG = new THREE.IcosahedronGeometry(1, 1); crownG.translate(0, 1.6, 0);
    const trunkG = new THREE.CylinderGeometry(0.12, 0.16, 1.2, 5); trunkG.translate(0, 0.6, 0);
    const crowns = new THREE.InstancedMesh(crownG, MAT.tree, spots.length), crowns2 = new THREE.InstancedMesh(crownG, MAT.tree2, spots.length), trunks = new THREE.InstancedMesh(trunkG, MAT.trunk, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(); let n1 = 0, n2 = 0;
    spots.forEach(([x, z, h], i) => {
      const s = h / 3.2;
      m4.compose(new THREE.Vector3(x, QUAY_H + 0.2, z), q.setFromAxisAngle(_up, rand() * 6), new THREE.Vector3(s * rr(0.8, 1.2), s, s * rr(0.8, 1.2)));
      if (rand() < 0.5) crowns.setMatrixAt(n1++, m4); else crowns2.setMatrixAt(n2++, m4);
      trunks.setMatrixAt(i, m4);
    });
    crowns.count = n1; crowns2.count = n2;
    for (const im of [crowns, crowns2, trunks]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); root.add(im); }
  }
  // chimney smoke (billboard puffs)
  WORLD.smoke = [];
  const smokeTex = glowTexture('235,235,235');
  for (const [x, z, h] of [[600, 2100, 110], [720, 2150, 90], [2400, 1800, 140]]) for (let k = 0; k < 14; k++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: ENV.night ? 0x333333 : 0xdedede, transparent: true, depthWrite: false, opacity: 0.4 }));
    root.add(sp); WORLD.smoke.push({ sp, x, z, y: QUAY_H + h + 2, t: k / 14 });
  }
  // leading lights on channel axis (front / rear), orange-white daymarks
  for (const [x, h] of [[2250, 32], [2950, 58]]) {
    B.box(MAT.darkSteel, 2.2, h, 2.2, x, QUAY_H + h / 2, 0);
    const dm = new THREE.Mesh(new THREE.PlaneGeometry(9, 14), new THREE.MeshStandardMaterial({ map: stripesTexture('#f07a1c', '#ffffff', 5, true), side: THREE.DoubleSide, emissive: 0x222222 }));
    dm.position.set(x - 1.4, QUAY_H + h - 8, 0); dm.rotation.y = -Math.PI / 2; root.add(dm);
    WORLD.flashers.push(glowSprite(0xffffff, 26, root, x - 2, QUAY_H + h + 1.5, 0, '255,250,235'));
  }
  // breakwater head lights
  for (const [x, z, col, rgb, mat] of [[-2658, -398, 0xff2a2a, '255,40,40', MAT.red], [-2658, 398, 0x22ff66, '40,255,110', MAT.green]]) {
    B.cyl(mat, 2.2, 2.8, 16, x, 6.5 + 8, z, 16);
    B.cyl(MAT.white, 2.3, 2.3, 2, x, 6.5 + 12, z, 16);
    B.cyl(MAT.glass, 1.4, 1.4, 2.4, x, 6.5 + 17.2, z, 12);
    const g = glowSprite(col, 40, root, x, 6.5 + 17.2, z, rgb);
    WORLD.buoyLights = WORLD.buoyLights || [];
    WORLD.buoyLights.push({ spr: g, per: 5, flashes: 1, phase: z > 0 ? 0 : 2.5, base: 40 });
  }
  // coastal lighthouse (landmark)
  B.cyl(MAT.white, 5, 7, 52, -1150, QUAY_H + 26, 3100, 20);
  for (let k = 0; k < 3; k++) B.cyl(MAT.red, 5.2 - k * 0.6, 5.6 - k * 0.6, 7, -1150, QUAY_H + 8 + k * 16, 3100, 20);
  B.cyl(MAT.glass, 3.2, 3.2, 5, -1150, QUAY_H + 55, 3100, 16);
  WORLD.lighthouse = glowSprite(0xfff4d6, 90, root, -1150, QUAY_H + 55, 3100, '255,244,214');
  await progress(0.7, 'Planting wind turbines');

  // ---------- wind turbines on the breakwaters and offshore
  const turbSpots = [];
  for (let x = -2300; x <= -1350; x += 190) { turbSpots.push([x, -731]); turbSpots.push([x, 731]); }
  for (let i = 0; i < 12; i++) turbSpots.push([-9000 + (i % 4) * 700, -4200 - Math.floor(i / 4) * 700]);
  for (const [x, z] of turbSpots) windTurbine(B, root, x, z, z < -3000 ? 0 : 7.1);

  // ---------- buoys
  for (const b of GEO.buoys) makeBuoy(root, b);
  await progress(0.78, 'Mooring ships at the terminal');

  // ---------- ships already alongside
  const shipA = buildContainerShip({ L: 366, B: 51, T: 14, D: 13, hull: '#1b1c20', boot: '#7a2320', name: 'NORDIC STAR', deckhouse: 0.62, funnel: 0.84, tiers: 8, seed: 5, style: 'generic', detail: 1 });
  shipA.position.set(-800, 0, -700 + FENDER + 25.5); shipA.rotation.y = -Math.PI / 2; root.add(shipA);
  WORLD.staticShips.push({ x: -800, z: -700 + FENDER + 25.5, psi: Math.PI / 2, L: 366, B: 51, name: 'NORDIC STAR' });
  const shipB = buildContainerShip({ L: 300, B: 48, T: 13, D: 12, hull: '#8f1c1c', boot: '#3a1210', name: 'CORAL PRINCESS', deckhouse: 0.8, funnel: 0.8, tiers: 7, seed: 9, style: 'generic', detail: 1 });
  shipB.position.set(1500 - FENDER - 24, 0, -50); shipB.rotation.y = 0; root.add(shipB);
  WORLD.staticShips.push({ x: 1500 - FENDER - 24, z: -50, psi: 0, L: 300, B: 48, name: 'CORAL PRINCESS' });
  const shipC = buildContainerShip({ L: 294, B: 40, T: 12, D: 12, hull: '#223a5e', boot: '#7a2320', name: 'ELBE TRADER', deckhouse: 0.78, funnel: 0.78, tiers: 7, seed: 13, style: 'maersk2', detail: 1 });
  shipC.position.set(1080, 0, -700 + FENDER + 20); shipC.rotation.y = Math.PI / 2; root.add(shipC);
  WORLD.staticShips.push({ x: 1080, z: -700 + FENDER + 20, psi: 3 * Math.PI / 2, L: 294, B: 40, name: 'ELBE TRADER' });
  const feeder = buildContainerShip({ L: 172, B: 27, T: 9, D: 8, hull: '#26603f', boot: '#6e1f1c', name: 'BALTIC FEEDER', deckhouse: 0.86, funnel: 0.86, tiers: 4, seed: 21, style: 'generic', detail: 1 });
  feeder.position.set(250, 0, 760 - FENDER - 13.5); feeder.rotation.y = -Math.PI / 2; root.add(feeder);
  WORLD.staticShips.push({ x: 250, z: 760 - FENDER - 13.5, psi: Math.PI / 2, L: 172, B: 27, name: 'BALTIC FEEDER' });
  // anchored bulk carriers / tankers
  for (const [x, z, psi, nm, col] of [[-12400, -4200, 225, 'STENA PRIMORSK', '#2c2c30'], [-14100, -3300, 230, 'OCEAN GRACE', '#6b2b1f'], [-11300, 4400, 220, 'NORD MARIA', '#1f3a52']]) {
    const t = buildTanker({ L: 250, B: 44, hull: col, name: nm });
    t.position.set(x, 0, z); t.rotation.y = -psi * DEG; root.add(t);
    WORLD.staticShips.push({ x, z, psi: psi * DEG, L: 250, B: 44, name: nm, anchored: true });
  }
  await progress(0.86, 'Releasing the gulls');

  // ---------- AGVs under the cranes and trucks on the terminal road — constant speed, fixed spacing
  const mkAGV = () => {
    const g = new THREE.Group(), b2 = new Batcher();
    b2.box(MAT.agv, 15, 1.1, 3.1, 0, 1.0, 0); b2.box(MAT.darkSteel, 15.2, 0.3, 3.2, 0, 0.45, 0);
    for (const dx of [-5.5, 5.5]) for (const dz of [-1.3, 1.3]) b2.cyl(MAT.black, 0.45, 0.45, 0.35, dx, 0.45, dz, 10, Math.PI / 2);
    b2.box(MAT.white, 0.4, 0.5, 2.6, 7.4, 1.4, 0); b2.box(MAT.white, 0.4, 0.5, 2.6, -7.4, 1.4, 0);
    b2.build(g, { dynamic: true });
    return g;
  };
  const mkTruck = () => {
    const g = new THREE.Group(), b2 = new Batcher();
    b2.box(pick([MAT.red, MAT.white, MAT.craneBlue, MAT.green]), 2.5, 2.9, 2.5, 7.2, 1.95, 0); b2.box(MAT.glass, 2.52, 0.9, 1.2, 7.2, 2.6, 0.9);
    b2.box(MAT.darkSteel, 12.6, 0.4, 2.4, -0.6, 1.2, 0);
    for (const dx of [7.6, 4.2, -4.2, -5.6]) for (const dz of [-1.1, 1.1]) b2.cyl(MAT.black, 0.5, 0.5, 0.4, dx, 0.5, dz, 10, Math.PI / 2);
    b2.build(g, { dynamic: true });
    return g;
  };
  const lanes = [[-712.5, 1, 5.5, 7], [-719.5, -1, 5.0, 7], [-726.5, 1, 4.5, 6], [-768, -1, 8, 5], [-1118, 1, 10, 6]];
  const L0 = -1150, L1 = 1450;
  for (const [z, dir, speed, n] of lanes) for (let k = 0; k < n; k++) {
    const truck = z < -1000;
    const g = truck ? mkTruck() : mkAGV();
    if (rand() < 0.65) buildContainers([{ x: truck ? -0.6 : 0, y: truck ? 1.4 : 1.55, z: 0, ry: Math.PI / 2, kind: rand() < 0.45 ? 'maersk' : 'generic', color: pick(BOX_COLORS) }], g);
    g.position.set(0, QUAY_H + 0.3, z); root.add(g);
    WORLD.vehicles.push({ g, z, dir, speed, off: (L1 - L0) * k / n + rr(0, 30), L0, L1 });
  }
  // gulls
  const gullMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.8, side: THREE.DoubleSide });
  for (let i = 0; i < 26; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.4, 3, 6), gullMat); body.rotation.x = Math.PI / 2; g.add(body);
    const wg = new THREE.PlaneGeometry(0.75, 0.22); wg.translate(0.375, 0, 0);
    const wl = new THREE.Mesh(wg, gullMat), wr = new THREE.Mesh(wg, gullMat); wr.rotation.y = Math.PI;
    wl.rotation.x = wr.rotation.x = -Math.PI / 2; g.add(wl); g.add(wr);
    root.add(g);
    WORLD.birds.push({ g, wl, wr, cx: rr(-2500, 800), cz: rr(-900, 500), r: rr(30, 140), h: rr(15, 70), sp: rr(0.1, 0.25) * (rand() < 0.5 ? 1 : -1), ph: rand() * 7 });
  }

  // ---------- finish static batches
  B.build(root, { cast: false, receive: true });

  // ---------- radar reflectors
  buildRadarPoints();
  await progress(0.92, 'Charting');
  return root;
}

// Batcher wrapper that places primitives in a local frame (crane / gantry coordinates)
function xformBatcher(B, Mc) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  return {
    add(g, mat, m) { B.add(g, mat, m ? Mc.clone().multiply(m) : Mc.clone()); },
    box(mat, w, h, d, x, y, z, ry = 0) { this.add(BOX(w, h, d), mat, MX(x, y, z, 0, ry, 0)); },
    cyl(mat, rt, rb, h, x, y, z, seg = 12, rx = 0, ry = 0, rz = 0) { this.add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, MX(x, y, z, rx, ry, rz)); },
    beam(mat, a, b, w, h = w) {
      const dir = V().subVectors(b, a), len = dir.length();
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.normalize());
      this.add(BOX(w, len, h), mat, new THREE.Matrix4().compose(V().addVectors(a, b).multiplyScalar(0.5), q, V(1, 1, 1)));
    },
  };
}

// ---- STS crane (super post-Panamax, 24-row outreach). Local frame: x along quay, z seaward.
function buildSTS(B, root, x, zq, rot, state, shipTop = 35, num = 1) {
  const Mc = new THREE.Matrix4().makeTranslation(x, 0, zq).multiply(new THREE.Matrix4().makeRotationY(rot));
  const C = xformBatcher(B, Mc), V = (a, b, c) => new THREE.Vector3(a, b, c);
  const P = (u, w, y) => V(u, y, w).applyMatrix4(Mc);
  const H0 = QUAY_H, gw = -5, gl = -35.5, yT = H0 + 47, gy = yT + 3.0;
  const blue = MAT.craneBlue, white = MAT.craneWhite, dark = MAT.darkSteel;
  // bogies, wheels, hazard-striped leg feet, legs
  for (const u of [-9, 9]) for (const w of [gw, gl]) {
    C.box(dark, 8.6, 1.3, 1.9, u, H0 + 1.75, w);
    for (let k = 0; k < 4; k++) C.cyl(dark, 0.5, 0.5, 1.6, u - 3 + k * 2, H0 + 0.55, w, 12, Math.PI / 2);
    C.box(MAT.hazard, 2.3, 3.2, 2.3, u, H0 + 4.0, w);
    C.box(blue, 2.0, yT - H0 - 5.6, 2.0, u, (H0 + 5.6 + yT) / 2, w);
  }
  // portal & sill beams, side bracing
  for (const w of [gw, gl]) { C.box(blue, 20, 2.4, 2.0, 0, H0 + 16, w); C.box(blue, 20.4, 2.8, 2.4, 0, yT, w); }
  for (const u of [-9, 9]) { C.box(blue, 1.8, 2.0, gw - gl, u, H0 + 16, (gw + gl) / 2); C.beam(blue, V(u, H0 + 17, gw - 1), V(u, yT - 1.6, gl + 1), 1.2); }
  // twin box girders (backreach) with cross ties and walkway handrails
  for (const u of [-4.3, 4.3]) { C.box(blue, 1.6, 3.6, (gw + 3) - (gl - 27), u, gy, ((gw + 3) + (gl - 27)) / 2); C.box(MAT.yellow, 0.06, 1.0, (gw + 3) - (gl - 27), u + Math.sign(u) * 1.0, gy + 2.3, ((gw + 3) + (gl - 27)) / 2); }
  for (let w = gl - 25; w < gw + 3; w += 6) C.box(blue, 8.6, 0.5, 0.6, 0, gy + 1.6, w);
  // machinery house with blue band and crane number
  C.box(white, 13, 7.5, 15, 0, gy + 1.8 + 3.75, gl - 16);
  C.box(blue, 13.05, 0.9, 15.05, 0, gy + 1.8 + 6.4, gl - 16);
  for (let k = 0; k < 3; k++) C.box(MAT.grey, 2, 1.2, 2, -4 + k * 4, gy + 10.3, gl - 16);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshStandardMaterial({ map: labelTexture(String(num), { w: 128, h: 96, bg: '#e4e7e8', color: '#2a6aa3', size: 80 }), roughness: 0.6 }));
  sign.position.copy(P(0, gl - 16 - 7.56, gy + 6.5)); sign.rotation.y = rot + Math.PI; root.add(sign);
  // A-frame apex with forestays and backstays
  const ax = gw - 5, ay = gy + 30;
  for (const u of [-4.3, 4.3]) { C.beam(blue, V(u, gy + 1.8, gw + 1), V(u * 0.7, ay, ax), 1.8); C.beam(blue, V(u, gy + 1.8, gl - 2), V(u * 0.7, ay, ax), 1.5); }
  C.box(blue, 7.2, 1.8, 2.0, 0, ay, ax);
  // boom (tapering twin girders), raised at berths awaiting a ship
  const ang = state === 'up' ? 78 * DEG : 0, Lb = 66;
  const bp = (t, dy = 0) => V(0, gy + Math.sin(ang) * t + dy * Math.cos(ang), gw + 3 + Math.cos(ang) * t - dy * Math.sin(ang));
  for (const u of [-4.3, 4.3]) for (let k = 0; k < 6; k++) { const a = bp(k * Lb / 6), b = bp((k + 1) * Lb / 6); a.x = b.x = u; C.beam(blue, a, b, 1.6, 3.6 - k * 0.35); }
  for (let k = 1; k <= 10; k++) { const p = bp(k * Lb / 10, 1.4); C.box(blue, 8.6, 0.45, 0.5, 0, p.y, p.z); }
  for (const u of [-3.2, 3.2]) { for (const t of [0.52, 0.97]) { const b = bp(t * Lb, 1.8); b.x = u; C.beam(dark, V(u * 0.95, ay, ax), b, 0.5); } C.beam(dark, V(u * 0.95, ay, ax), V(u, gy + 1.8, gl - 27), 0.5); }
  // stair tower up the landside leg
  for (let k = 0; k < 8; k++) { const y0 = H0 + 6 + k * 5.1, s = k % 2 ? 1 : -1; C.beam(MAT.yellow, V(10.7, y0, gl - 1.3 * s), V(10.7, y0 + 5.1, gl + 1.3 * s), 0.9, 0.15); C.box(MAT.steel, 1.5, 0.12, 3.4, 10.7, y0 + 5.1, gl); }
  // floodlights under the girders, aviation lights
  for (const w of state === 'up' ? [gl - 6, gl + 10] : [gl - 6, gl + 10, gw + 20, gw + 40]) { const p = w > gw ? bp(w - gw - 3, -1.8) : V(0, gy - 1.9, w); C.box(ENV.night ? MAT.lampOn : MAT.lampOff, 1.4, 0.35, 0.9, 0, p.y, p.z); }
  WORLD.flashers.push(glowSprite(0xff2a1a, 12, root, ...P(0, ax, ay + 1.5).toArray(), '255,50,30'));
  { const tip = bp(Lb, 1.8); WORLD.flashers.push(glowSprite(0xff2a1a, 9, root, ...P(0, tip.z, tip.y).toArray(), '255,50,30')); }
  // trolley with hanging operator cab; spreader & headblock (animated on working cranes)
  const trolley = new THREE.Group(), tb = new Batcher();
  tb.box(white, 10, 3, 9, 0, 0, 0); tb.box(white, 3.2, 3, 3.2, 3.4, -3.8, 2); tb.box(MAT.glass, 3.3, 1.6, 3.3, 3.4, -4.4, 2);
  tb.build(trolley, { dynamic: true }); trolley.rotation.y = rot; root.add(trolley);
  const parkW = gl - 8;
  trolley.position.copy(P(0, parkW, gy + 3.3));
  if (state === 'work') {
    const spreader = new THREE.Group(), sb = new Batcher();
    sb.box(MAT.yellow, 2.6, 0.9, 12.4, 0, 0, 0); sb.box(MAT.darkSteel, 2, 1.2, 3, 0, 1.0, 0);
    sb.build(spreader, { dynamic: true });
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 1.2), dark); cable.geometry.translate(0, -0.5, 0);
    const box = buildContainers([{ x: 0, y: -3.6, z: 0, kind: rand() < 0.5 ? 'maersk' : 'generic', color: pick(BOX_COLORS) }], spreader)[0];
    spreader.rotation.y = rot + Math.PI / 2; cable.rotation.y = rot;
    root.add(spreader); root.add(cable);
    WORLD.cranesAnim.push({ trolley, spreader, cable, box, P, top: gy - 1.5, shipY: shipTop + 4.2, landY: H0 + 2.0 + 3.7, wLand: -16, wShip: rr(14, 44), t: rand() * 100, speed: rr(0.8, 1.2), loaded: rand() < 0.5, gy });
  }
}

// ---- Automated stacking crane spanning a yard block (rails along z at xL / xR)
function buildASC(B, root, xL, xR, z) {
  const H0 = QUAY_H, yT = H0 + 22, white = MAT.craneWhite, blue = MAT.craneBlue;
  for (const x of [xL, xR]) {
    for (const dz of [-3.6, 3.6]) { B.box(white, 1.2, yT - H0 - 3, 1.2, x, (H0 + 3 + yT) / 2, z + dz); B.box(MAT.hazard, 1.35, 2.6, 1.35, x, H0 + 1.9, z + dz); }
    B.box(MAT.darkSteel, 1.6, 1.0, 9.4, x, H0 + 0.8, z);
    B.box(white, 1.5, 1.6, 8.6, x, yT - 0.8, z);
  }
  for (const dz of [-3.6, 3.6]) B.box(white, xR - xL + 1.5, 2.0, 1.5, (xL + xR) / 2, yT + 0.2, z + dz);
  B.box(blue, xR - xL + 1.52, 0.4, 1.52, (xL + xR) / 2, yT + 1.25, z - 3.6);
  const tx = lerp(xL + 4, xR - 4, rand());
  B.box(blue, 5, 2.6, 8.8, tx, yT + 2.3, z); B.box(MAT.white, 2.4, 3, 3, xR + 2, H0 + 16, z + 2);
  const drop = rr(6, 16);
  B.box(MAT.darkSteel, 0.15, drop, 0.15, tx - 1, yT + 1 - drop / 2, z - 3); B.box(MAT.darkSteel, 0.15, drop, 0.15, tx + 1, yT + 1 - drop / 2, z + 3);
  B.box(MAT.yellow, 2.6, 0.8, 12.4, tx, yT + 0.6 - drop, z);
}

function lightMast(B, root, x, z) {
  B.cyl(MAT.grey, 0.35, 0.6, 36, x, QUAY_H + 18, z, 8);
  B.box(MAT.darkSteel, 5, 0.8, 1.6, x, QUAY_H + 36, z);
  for (let k = -2; k <= 2; k++) B.box(ENV.night ? MAT.lampOn : MAT.lampOff, 0.8, 0.3, 1.2, x + k, QUAY_H + 35.5, z);
  if (ENV.night) WORLD.lamps.push(glowSprite(0xffd9a0, 42, root, x, QUAY_H + 35, z, '255,215,160'));
}

function windTurbine(B, root, x, z, base) {
  const H = 96;
  B.cyl(MAT.turbine, 2.1, 3.4, H, x, base + H / 2, z, 18);
  B.cyl(MAT.yellow, 3.5, 3.5, 12, x, base + 6, z, 18);
  B.box(MAT.turbine, 4.2, 4.2, 12, x, base + H + 1.5, z - 1);
  const hub = new THREE.Group(); hub.position.set(x, base + H + 1.8, z - 7.5);
  const hb = new Batcher();
  hb.add(new THREE.SphereGeometry(2.1, 12, 8), MAT.turbine, MX(0, 0, 0, 0, 0, 0, 1, 1, 1.4));
  for (let k = 0; k < 3; k++) {
    const g = new THREE.BoxGeometry(2.6, 60, 0.5); g.translate(0, 31, 0);
    const pos = g.attributes.position; for (let i = 0; i < pos.count; i++) { const yy = pos.getY(i); pos.setX(i, pos.getX(i) * (1 - yy / 70)); }
    g.computeVertexNormals();
    hb.add(g, MAT.turbine, MX(0, 0, 0, 0, 0, k * Math.PI * 2 / 3));
  }
  hb.build(hub, { dynamic: true });
  root.add(hub);
  WORLD.turbines.push({ hub, speed: rr(0.9, 1.3) });
  WORLD.flashers.push(glowSprite(0xff2a1a, 16, root, x, base + H + 4.4, z, '255,50,30'));
}

function makeBuoy(root, b) {
  const g = new THREE.Group();
  const bb = new Batcher();
  const col = b.type === 'red' ? MAT.red : b.type === 'green' ? MAT.green : b.type === 'safe' ? MAT.red : MAT.yellow;
  bb.cyl(col, 1.4, 1.5, 2.2, 0, 0.2, 0, 16);        // float
  bb.cyl(MAT.darkSteel, 1.55, 1.55, 0.3, 0, 1.1, 0, 16);
  if (b.type === 'red') { bb.cyl(col, 0.9, 1.0, 3.2, 0, 2.8, 0, 12); bb.cyl(col, 0.55, 0.55, 0.9, 0, 5.0, 0, 12); }
  else if (b.type === 'green') { bb.cyl(col, 0.2, 1.0, 3.6, 0, 3.0, 0, 12); bb.add(new THREE.ConeGeometry(0.55, 0.9, 12), col, MX(0, 5.4, 0)); }
  else if (b.type === 'safe') { for (let k = 0; k < 4; k++) bb.cyl(k % 2 ? MAT.white : MAT.red, 0.35, 0.95 - k * 0.12, 1, 0, 1.8 + k, 0, 12, 0, 0, 0); bb.add(new THREE.SphereGeometry(0.5, 12, 8), MAT.red, MX(0, 6.3, 0)); }
  else { // cardinal
    bb.cyl(b.type === 'cardN' ? MAT.black : MAT.yellow, 0.7, 0.9, 1.7, 0, 2.2, 0, 12);
    bb.cyl(b.type === 'cardN' ? MAT.yellow : MAT.black, 0.5, 0.7, 1.7, 0, 3.9, 0, 12);
    const up = b.type === 'cardN';
    bb.add(new THREE.ConeGeometry(0.5, 0.8, 12), MAT.black, MX(0, 5.5, 0, up ? 0 : Math.PI));
    bb.add(new THREE.ConeGeometry(0.5, 0.8, 12), MAT.black, MX(0, 6.3, 0, up ? 0 : Math.PI));
  }
  bb.cyl(MAT.darkSteel, 0.08, 0.08, 1.4, 0.5, 4.8, 0, 6);
  bb.build(g, { dynamic: true });
  // number boards
  if (b.name.length < 5) {
    const t = labelTexture(b.name, { w: 128, h: 64, bg: '#f5f5f0', color: '#111', size: 40 });
    for (const s of [1, -1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
      p.position.set(0, 3.2, s * 1.05); if (s < 0) p.rotation.y = Math.PI; g.add(p);
    }
  }
  const lightCol = b.type === 'red' ? 0xff3322 : b.type === 'green' ? 0x33ff77 : 0xfff6e0;
  const rgb = b.type === 'red' ? '255,60,40' : b.type === 'green' ? '60,255,120' : '255,245,225';
  const spr = glowSprite(lightCol, 16, g, 0, 6.2, 0, rgb);
  g.position.set(b.x, 0, b.z);
  root.add(g);
  const obj = { ...b, g, spr, bob: rand() * 7 };
  WORLD.buoys.push(obj);
  WORLD.buoyLights = WORLD.buoyLights || [];
  WORLD.buoyLights.push({ spr, per: b.per, flashes: b.flashes, long: b.long, phase: b.phase, base: 16 });
}

// IALA-ish flash character: returns 0..1 intensity
function flashChar(t, L) {
  const per = L.per, tt = ((t + L.phase) % per + per) % per;
  if (L.flashes === 99) return (tt % 1) < 0.3 ? 1 : 0;     // very quick
  if (L.long) return tt < 2 ? 1 : 0;
  for (let i = 0; i < L.flashes; i++) if (tt > i * 0.9 && tt < i * 0.9 + 0.45) return 1;
  return 0;
}

// sample radar reflectors from coastlines, structures
function buildRadarPoints() {
  const pts = [];
  const edge = (poly, step, str) => {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s < len; s += step) {
        const x = lerp(a[0], b[0], s / len), z = lerp(a[1], b[1], s / len);
        if (Math.abs(x) > 22000 || Math.abs(z) > 12000) continue;
        pts.push(x, z, str);
      }
    }
  };
  edge(GEO.mainland, 14, 0.9); edge(GEO.breakN, 8, 1); edge(GEO.breakS, 8, 1);
  // land clutter (buildings, stacks, cranes)
  const R = mulberry32(3);
  for (let i = 0; i < 5200; i++) {
    const x = -1200 + Math.pow(R(), 1.6) * 9000, z = (R() - 0.5) * 16000;
    if (!isLand(x, z)) continue;
    pts.push(x, z, 0.35 + R() * 0.5);
  }
  for (let x = -1100; x < 1450; x += 20) for (let z = -800; z > -1450; z -= 30) pts.push(x + R() * 10, z, 0.8);
  WORLD.radarPts = new Float32Array(pts);
}

// ------------------------------------------------------------- per-frame world animation
function updateWorld(dt, t) {
  // buoys bobbing & lights
  for (const b of WORLD.buoys) {
    b.bob += dt;
    b.g.position.y = Math.sin(b.bob * 1.1) * 0.25 - 0.2;
    b.g.rotation.x = Math.sin(b.bob * 0.9) * 0.06; b.g.rotation.z = Math.cos(b.bob * 0.77) * 0.06;
  }
  const dayK = ENV.night ? 1 : CFG.tod === 'golden' ? 0.55 : 0.18;
  for (const L of WORLD.buoyLights || []) {
    const on = flashChar(t, L);
    L.spr.visible = on > 0; L.spr.material.opacity = dayK;
    L.spr.scale.setScalar(L.base * (0.6 + 0.4 * dayK));
  }
  const blink = (Math.floor(t * 1.0) % 2) === 0;
  for (const f of WORLD.flashers) { f.visible = blink; f.material.opacity = Math.max(0.35, dayK); }
  if (WORLD.lighthouse) { const a = (t * 0.7) % (Math.PI * 2); WORLD.lighthouse.material.opacity = Math.pow(Math.max(0, Math.cos(a)), 16) * dayK * 1.2; }
  if (WORLD.flare) WORLD.flare.scale.setScalar(55 + Math.sin(t * 7) * 6 + Math.sin(t * 13) * 4);
  // turbines
  for (const tb of WORLD.turbines) tb.hub.rotation.z -= dt * tb.speed * 1.4;
  // cranes: trolley shuttles between ship and quay, spreader hoists – lands ON the stacks, never inside them
  for (const c of WORLD.cranesAnim) {
    c.t += dt * c.speed;
    const cyc = 100, ph = (c.t % cyc) / cyc, cycN = Math.floor(c.t / cyc);
    if (cycN !== c.cycN) { c.cycN = cycN; c.wShip = 14 + ((cycN * 7.3 + c.gy) % 30); }
    let w, sy;
    const dip = (a, lo) => lerp(c.top, lo, Math.sin(clamp(a, 0, 1) * Math.PI));
    if (ph < 0.25) { w = lerp(c.wLand, c.wShip, smooth(0, 0.25, ph)); sy = c.top; }
    else if (ph < 0.4) { w = c.wShip; sy = dip((ph - 0.25) / 0.15, c.shipY); }
    else if (ph < 0.65) { w = lerp(c.wShip, c.wLand, smooth(0.4, 0.65, ph)); sy = c.top; }
    else if (ph < 0.8) { w = c.wLand; sy = dip((ph - 0.65) / 0.15, c.landY); }
    else { w = c.wLand; sy = c.top; }
    const tp = c.P(0, w, c.gy + 3.3);
    c.trolley.position.copy(tp);
    c.spreader.position.set(tp.x, sy, tp.z);
    c.cable.position.set(tp.x, tp.y - 1.5, tp.z); c.cable.scale.y = Math.max(0.5, tp.y - 1.5 - sy - 0.5);
    c.box.visible = (ph < 0.4 || ph > 0.8) ? c.loaded : !c.loaded;
    if (Math.abs(ph - 0.4) < 0.002 || Math.abs(ph - 0.8) < 0.002) c.loaded = !c.loaded;
  }
  // AGVs & trucks: constant speed loops with fixed spacing (never overlap)
  for (const v of WORLD.vehicles) {
    v.off += dt * v.speed;
    const len = v.L1 - v.L0, s = ((v.off % len) + len) % len;
    v.g.position.x = v.dir > 0 ? v.L0 + s : v.L1 - s;
    v.g.rotation.y = v.dir > 0 ? 0 : Math.PI;
  }
  // chimney smoke drifting downwind
  if (WORLD.smoke) for (const p of WORLD.smoke) {
    p.t = (p.t + dt * 0.012) % 1;
    const wTo = (G.ship ? G.ship.windFrom : 225 * DEG) + Math.PI;
    const d = p.t * 420;
    p.sp.position.set(p.x + Math.sin(wTo) * d, p.y + p.t * 90, p.z - Math.cos(wTo) * d);
    p.sp.scale.setScalar(12 + p.t * 110);
    p.sp.material.opacity = 0.45 * Math.sin(p.t * Math.PI) * (1 - p.t * 0.4);
  }
  // gulls
  for (const b of WORLD.birds) {
    b.ph += dt * b.sp;
    const x = b.cx + Math.cos(b.ph) * b.r, z = b.cz + Math.sin(b.ph) * b.r;
    b.g.position.set(x, b.h + Math.sin(b.ph * 3) * 3, z);
    b.g.rotation.y = -b.ph - (b.sp > 0 ? 0 : Math.PI);
    const f = Math.sin(t * 7 + b.r) * 0.5;
    b.wl.rotation.z = f; b.wr.rotation.z = -f;
  }
}
