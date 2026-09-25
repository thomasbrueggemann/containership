// ============================================================================
// 06 — INSTRUMENTS: canvas-driven displays (radar, ECDIS, conning, docking,
// overhead, autopilot, engine, echo sounder, VHF, GMDSS …)
// ============================================================================
const DISPLAYS = {};
const RADAR_RANGES = [0.75, 1.5, 3, 6, 12];
const ECDIS_RANGES = [0.25, 0.5, 0.75, 1.5, 3, 6, 12];
const ROUTE = [[-13200, 110], [-9000, 110], [-2900, 90], [-1500, -60], [-400, -520], [300, -650]];
const ROUTE_NAMES = ['WH', 'W3', 'ENTR', 'OH1', 'B4-APP', 'B4'];
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const SANS = 'Inter, system-ui, -apple-system, Segoe UI, Arial, sans-serif';

class Display {
  constructor(key, title, w, h, hz, draw) {
    this.key = key; this.title = title; this.w = w; this.h = h; this.interval = 1 / hz; this.acc = Math.random() * this.interval; this.drawFn = draw;
    this.canvas = makeCanvas(w, h); this.ctx = this.canvas.getContext('2d');
    this.tex = canvasTexture(this.canvas, { aniso: 4 });
    this.material = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    this.force = true;
  }
  update(dt) {
    this.acc += dt;
    if (this.acc < this.interval && !this.force) return;
    this.acc = 0; this.force = false;
    this.drawFn(this.ctx, this.w, this.h, this);
    this.tex.needsUpdate = true;
  }
}
function registerStatic(key, title, tex) { DISPLAYS[key] = { key, title, canvas: tex.image, static: true, update() {} }; }

function pal() {
  return ENV.night
    ? { bg: '#020406', panel: '#06090c', line: '#1b2a33', text: '#b58a4a', dim: '#6d5a3a', hi: '#f0b460', acc: '#c07a30', good: '#7fa860', warn: '#e0a040', bad: '#e04030', echo: '#c88a2a', grid: '#3a3020' }
    : { bg: '#07121c', panel: '#0c1822', line: '#22394a', text: '#cfe3ee', dim: '#6e8797', hi: '#ffffff', acc: '#4fc3f7', good: '#6fe08a', warn: '#ffc94a', bad: '#ff5b4f', echo: '#ffd54a', grid: '#1f4050' };
}

function initDisplays() {
  const D = (k, t, w, h, hz, f) => (DISPLAYS[k] = new Display(k, t, w, h, hz, f));
  D('radar1', 'X-band radar (3 cm) — ARPA', 1280, 860, 24, (x, w, h, d) => drawRadar(x, w, h, 0));
  D('radar2', 'S-band radar (10 cm) — ARPA/AIS', 1280, 860, 24, (x, w, h, d) => drawRadar(x, w, h, 1));
  D('ecdis1', 'ECDIS — master', 1280, 860, 5, (x, w, h, d) => drawECDIS(x, w, h, G.ecdisRange, 0));
  D('ecdis2', 'ECDIS — backup', 1280, 860, 4, (x, w, h, d) => drawECDIS(x, w, h, G.ecdisRange2, 1));
  D('conning', 'Conning display', 1280, 860, 10, drawConning);
  D('conning2', 'Conning — speed & thrusters', 1280, 860, 8, drawConning2);
  D('docking', 'Docking display', 1280, 860, 8, drawDocking);
  D('engine', 'Main engines — bridge control', 1280, 860, 8, drawEngine);
  D('tugd', 'Tug & thruster status', 1280, 860, 5, drawTugDisplay);
  D('autopilot', 'Autopilot / heading control', 800, 480, 8, drawAutopilot);
  D('steer', 'Steering stand — rudder & ROT', 800, 480, 12, drawSteer);
  D('overhead', 'Overhead instruments', 2400, 204, 10, drawOverhead);
  D('echo', 'Echo sounder', 900, 500, 4, drawEcho);
  D('vhf', 'VHF', 320, 128, 4, drawVHF);
  D('clock', 'Clock', 600, 240, 2, drawClock);
  D('gmdss', 'GMDSS', 560, 360, 0.5, drawGMDSS);
  D('navtex', 'NAVTEX', 560, 360, 0.5, drawNavtex);
  D('fire', 'Fire panel', 540, 360, 0.5, drawFire);
  D('bams', 'Bridge alert management', 1024, 640, 2, drawBAMS);
  D('cctv', 'CCTV', 1024, 600, 3, drawCCTV);
  D('office', 'Ship\'s office PC', 800, 480, 0.3, drawOffice);
  buildEcdisBase();
}
function updateDisplays(dt) {
  for (const k in DISPLAYS) if (!DISPLAYS[k].static) {
    // radars need a steady refresh; others throttle more when the player is far
    DISPLAYS[k].update(dt);
  }
}

// ------------------------------------------------------------- helpers
function txt(x, s, px, py, o = {}) {
  x.font = `${o.w || 600} ${o.s || 20}px ${o.f || SANS}`; x.fillStyle = o.c || '#fff'; x.textAlign = o.a || 'left'; x.textBaseline = o.b || 'alphabetic';
  x.fillText(s, px, py);
}
function box(x, px, py, w, h, P, title) {
  x.fillStyle = P.panel; x.fillRect(px, py, w, h); x.strokeStyle = P.line; x.lineWidth = 2; x.strokeRect(px + 1, py + 1, w - 2, h - 2);
  if (title) txt(x, title, px + 12, py + 24, { s: 15, c: P.dim, w: 700 });
}
function arcGauge(x, cx, cy, r, v, min, max, a0, a1, P, o = {}) {
  x.lineWidth = o.lw || 10; x.strokeStyle = P.line; x.beginPath(); x.arc(cx, cy, r, a0, a1); x.stroke();
  if (o.zones) for (const [z0, z1, col] of o.zones) { x.strokeStyle = col; x.beginPath(); x.arc(cx, cy, r, a0 + (a1 - a0) * (z0 - min) / (max - min), a0 + (a1 - a0) * (z1 - min) / (max - min)); x.stroke(); }
  // ticks
  x.lineWidth = 2; x.strokeStyle = P.dim;
  const nt = o.ticks || 8;
  for (let i = 0; i <= nt; i++) { const a = a0 + (a1 - a0) * i / nt; x.beginPath(); x.moveTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); x.lineTo(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6)); x.stroke();
    if (o.labels) txt(x, o.labels[i] ?? '', cx + Math.cos(a) * (r - 32), cy + Math.sin(a) * (r - 32) + 6, { s: 14, c: P.dim, a: 'center' }); }
  const vv = clamp(v, min, max), a = a0 + (a1 - a0) * (vv - min) / (max - min);
  if (o.order !== undefined) { const ao = a0 + (a1 - a0) * (clamp(o.order, min, max) - min) / (max - min); x.fillStyle = P.warn; x.beginPath(); x.moveTo(cx + Math.cos(ao) * (r + 14), cy + Math.sin(ao) * (r + 14)); x.lineTo(cx + Math.cos(ao - 0.06) * (r + 30), cy + Math.sin(ao - 0.06) * (r + 30)); x.lineTo(cx + Math.cos(ao + 0.06) * (r + 30), cy + Math.sin(ao + 0.06) * (r + 30)); x.fill(); }
  x.strokeStyle = o.col || P.hi; x.lineWidth = 5; x.lineCap = 'round'; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); x.stroke(); x.lineCap = 'butt';
  x.fillStyle = P.line; x.beginPath(); x.arc(cx, cy, 9, 0, 7); x.fill();
}
function hbar(x, px, py, w, h, v, P, col) { // v in -1..1
  x.fillStyle = P.line; x.fillRect(px, py, w, h);
  x.fillStyle = col || P.acc; const c = px + w / 2;
  if (v >= 0) x.fillRect(c, py, w / 2 * v, h); else x.fillRect(c + w / 2 * v, py, -w / 2 * v, h);
  x.fillStyle = P.hi; x.fillRect(c - 1, py - 3, 2, h + 6);
}
function shipPoly(scale) { // own ship outline in body coords [fwd, stbd] metres
  const L2 = 199.6, b = 29.3;
  return [[L2 + 3, 0], [L2 - 20, b * 0.55], [L2 - 60, b * 0.95], [L2 - 100, b], [-L2 + 40, b], [-L2 + 6, b * 0.88], [-L2, b * 0.75], [-L2, -b * 0.75], [-L2 + 6, -b * 0.88], [-L2 + 40, -b], [L2 - 100, -b], [L2 - 60, -b * 0.95], [L2 - 20, -b * 0.55]];
}
function nowClock() { const t = (START_TIME[CFG.tod] + G.simT) % 86400; return [Math.floor(t / 3600), Math.floor(t / 60) % 60, Math.floor(t) % 60]; }
function clockStr(sec = true) { const [h, m, s] = nowClock(); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + (sec ? ':' + String(s).padStart(2, '0') : ''); }

// nearest-quay geometry for docking aids (also used by scenario & tugs)
function berthInfo() {
  const s = G.ship; if (!s) return null;
  let best = null;
  for (const q of GEO.quays) {
    // perpendicular distance from ship centre to the fender line
    const line = (q.axis === 'x' ? q.z : q.x) + q.face * FENDER;
    const c = q.axis === 'x' ? s.z : s.x;
    const along = q.axis === 'x' ? s.x : s.z;
    const lo = q.axis === 'x' ? q.x0 : q.z0, hi = q.axis === 'x' ? q.x1 : q.z1;
    if (along < lo - 300 || along > hi + 300) continue;
    const dc = (c - line) * q.face;
    if (dc < -5) continue;
    if (!best || dc < best.dc) best = { q, line, dc };
  }
  if (!best) return null;
  const q = best.q;
  const pt = (xb) => {
    // choose the hull side facing the quay
    let res = null;
    for (const yb of [-29.3, 29.3]) {
      const [wx, wz] = s.toWorld(xb, yb);
      const d = ((q.axis === 'x' ? wz : wx) - best.line) * q.face;
      const vx = (s.u - s.r * yb) * Math.sin(s.psi) + (s.v + s.r * xb) * Math.cos(s.psi) + Math.sin(s.curSetTo) * s.curSpeed;
      const vz = -(s.u - s.r * yb) * Math.cos(s.psi) + (s.v + s.r * xb) * Math.sin(s.psi) - Math.cos(s.curSetTo) * s.curSpeed;
      const vIn = -(q.axis === 'x' ? vz : vx) * q.face;
      if (!res || d < res.d) res = { d, vIn, side: yb < 0 ? 'PORT' : 'STBD', wx, wz };
    }
    return res;
  };
  const bow = pt(100), stern = pt(-125); // shoulders of the parallel mid-body (flat side)
  const qa = q.axis === 'x' ? 1 : 0;
  let hdgQuay = q.axis === 'x' ? 90 : 0;
  let rel = wrap180(s.psi / DEG - hdgQuay); if (Math.abs(rel) > 90) rel = wrap180(rel + 180);
  const along = q.axis === 'x' ? s.x : s.z;
  return { q, bow, stern, side: bow.side, angle: rel, along, dc: best.dc, berthOff: q.id === 'N' ? s.x - GEO.berth.x : null };
}

// ============================================================= RADAR
const RADAR_ST = [{}, {}];
function radarTargets() {
  const out = [];
  if (typeof TRAFFIC !== 'undefined') for (const t of TRAFFIC.all()) out.push(t);
  for (const s of WORLD.staticShips) out.push({ x: s.x, z: s.z, psi: s.psi, L: s.L, B: s.B, name: s.name, sog: 0, cog: 0, static: true });
  return out;
}
function drawRadar(x, W, H, idx) {
  const P = pal(), s = G.ship, st = RADAR_ST[idx];
  const R = (H - 70) / 2, cx = R + 45, cy = H / 2 + 6;
  const rangeNm = G.radarRange[idx], range = rangeNm * NM, sc = R / range;
  if (!st.buf || st.R !== R) { st.buf = makeCanvas(R * 2, R * 2); st.bx = st.buf.getContext('2d'); st.R = R; st.last = 0; }
  const bx = st.bx;
  const echoCol = ENV.night ? '200,138,42' : '255,213,74';
  if (st.range !== range) { bx.fillStyle = P.bg; bx.fillRect(0, 0, R * 2, R * 2); st.range = range; }
  const per = idx === 0 ? 2.5 : 3.0;
  const ang = ((G.simT / per) * Math.PI * 2) % (Math.PI * 2);
  let a0 = st.last ?? ang, a1 = ang; if (a1 < a0) a1 += Math.PI * 2; if (a1 - a0 > 2.5) a0 = a1 - 2.5;
  st.last = ang;
  // erase wedge
  bx.fillStyle = P.bg; bx.beginPath(); bx.moveTo(R, R); bx.arc(R, R, R + 2, a0 - Math.PI / 2 - 0.01, a1 - Math.PI / 2 + 0.01); bx.closePath(); bx.fill();
  const inSweep = (b) => { let bb = b; while (bb < a0) bb += Math.PI * 2; return bb <= a1; };
  const bw = idx === 0 ? 1.1 * DEG : 1.9 * DEG;
  const pulse = Math.max(1.5, (rangeNm > 3 ? 60 : 25) * sc);
  bx.fillStyle = `rgba(${echoCol},0.9)`;
  const pts = WORLD.radarPts;
  for (let i = 0; i < pts.length; i += 3) {
    const dx = pts[i] - s.x, dz = pts[i + 1] - s.z;
    if (Math.abs(dx) > range || Math.abs(dz) > range) continue;
    const r2 = dx * dx + dz * dz; if (r2 > range * range) continue;
    let b = Math.atan2(dx, -dz); if (b < 0) b += Math.PI * 2;
    if (!inSweep(b)) continue;
    const r = Math.sqrt(r2), wdt = Math.max(1.6, r * bw * sc);
    bx.globalAlpha = Math.min(1, pts[i + 2] * (idx === 0 ? 1 : 0.85));
    bx.fillRect(R + dx * sc - wdt / 2, R + dz * sc - pulse / 2, wdt, pulse);
  }
  bx.globalAlpha = 1;
  // buoys (with racon on the fairway buoy)
  for (const b of GEO.buoys) {
    const dx = b.x - s.x, dz = b.z - s.z, r = Math.hypot(dx, dz); if (r > range) continue;
    let br = Math.atan2(dx, -dz); if (br < 0) br += Math.PI * 2; if (!inSweep(br)) continue;
    bx.fillStyle = `rgba(${echoCol},1)`; bx.beginPath(); bx.arc(R + dx * sc, R + dz * sc, Math.max(2.2, 6 * sc), 0, 7); bx.fill();
    if (b.type === 'safe' && Math.floor(G.simT / 10) % 3 === 0) { // racon 'T'
      bx.strokeStyle = `rgba(${echoCol},0.9)`; bx.lineWidth = Math.max(2, r * bw * sc); bx.beginPath();
      const ux = dx / r, uz = dz / r; bx.moveTo(R + (dx + ux * 60) * sc, R + (dz + uz * 60) * sc); bx.lineTo(R + (dx + ux * 900) * sc, R + (dz + uz * 900) * sc); bx.stroke();
    }
  }
  // ships
  for (const t of radarTargets()) {
    const dx = t.x - s.x, dz = t.z - s.z, r = Math.hypot(dx, dz); if (r > range + t.L) continue;
    let br = Math.atan2(dx, -dz); if (br < 0) br += Math.PI * 2; if (!inSweep(br)) continue;
    bx.save(); bx.translate(R + dx * sc, R + dz * sc); bx.rotate(t.psi);
    bx.fillStyle = `rgba(${echoCol},1)`; const l = Math.max(4, t.L * sc), wv = Math.max(3, Math.max(t.B, r * bw * 0.6) * sc);
    bx.fillRect(-wv / 2, -l / 2, wv, l); bx.restore();
  }
  // sea clutter near own ship
  const clutterR = 700 + s.windSpeed * 50, nC = Math.floor((a1 - a0) * 70 * (s.windSpeed / 8));
  for (let i = 0; i < nC; i++) {
    const b = a0 + Math.random() * (a1 - a0), r = Math.pow(Math.random(), 2.2) * clutterR; if (r > range) continue;
    bx.globalAlpha = 0.55 * (1 - r / clutterR); bx.fillStyle = `rgba(${echoCol},1)`;
    bx.fillRect(R + Math.sin(b) * r * sc, R - Math.cos(b) * r * sc, 2, 2);
  }
  bx.globalAlpha = 1;

  // ---- compose display
  x.fillStyle = P.panel; x.fillRect(0, 0, W, H);
  x.save(); x.beginPath(); x.arc(cx, cy, R, 0, 7); x.clip();
  x.drawImage(st.buf, cx - R, cy - R);
  // sweep afterglow
  if (x.createConicGradient) {
    const g = x.createConicGradient(ang - Math.PI / 2 - 0.9, cx, cy);
    g.addColorStop(0, 'rgba(80,200,255,0)'); g.addColorStop(0.143, ENV.night ? 'rgba(200,140,60,0.10)' : 'rgba(90,200,255,0.12)'); g.addColorStop(0.1433, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  // rings
  x.strokeStyle = P.grid; x.lineWidth = 1.5;
  for (let k = 1; k <= 5; k++) { x.beginPath(); x.arc(cx, cy, R * k / 6, 0, 7); x.stroke(); }
  // heading line & stern line
  const hd = s.psi;
  x.strokeStyle = ENV.night ? '#e0c080' : '#ffffff'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.sin(hd) * R, cy - Math.cos(hd) * R); x.stroke();
  // own ship outline to scale (when range small)
  if (rangeNm <= 1.5) {
    x.save(); x.translate(cx, cy); x.rotate(hd); x.strokeStyle = P.acc; x.lineWidth = 1.5; x.beginPath();
    shipPoly().forEach(([f, sb], i) => { const px = sb * sc, py = -f * sc; i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath(); x.stroke(); x.restore();
  }
  // own ship vector (6 min, true)
  const vt = 360;
  x.strokeStyle = P.acc; x.lineWidth = 2; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + s.vgx * vt * sc, cy + s.vgz * vt * sc); x.stroke();
  // ARPA / AIS targets
  const list = [];
  for (const t of radarTargets()) {
    const dx = t.x - s.x, dz = t.z - s.z, r = Math.hypot(dx, dz); if (r > range) continue;
    const tvx = Math.sin(t.cog) * t.sog, tvz = -Math.cos(t.cog) * t.sog;
    const rvx = tvx - s.vgx, rvz = tvz - s.vgz, rv2 = rvx * rvx + rvz * rvz;
    let tcpa = rv2 > 1e-4 ? -(dx * rvx + dz * rvz) / rv2 : 1e9;
    const cpa = tcpa > 0 ? Math.hypot(dx + rvx * tcpa, dz + rvz * tcpa) : r;
    const danger = !t.static && cpa < (t.L < 60 ? 0.12 : 0.4) * NM && tcpa > 0 && tcpa < 900 && !/^WH (TITAN|HERCULES)|PILOT/.test(t.name);
    const px = cx + dx * sc, py = cy + dz * sc;
    x.strokeStyle = danger ? P.bad : (idx === 1 ? P.good : P.acc); x.lineWidth = 2;
    if (idx === 1 && !t.static) { // AIS triangle
      x.save(); x.translate(px, py); x.rotate(t.psi); x.beginPath(); x.moveTo(0, -12); x.lineTo(7, 8); x.lineTo(-7, 8); x.closePath(); x.stroke(); x.restore();
    } else if (!t.static) { x.beginPath(); x.arc(px, py, 10, 0, 7); x.stroke(); }
    if (!t.static && t.sog > 0.2) { x.beginPath(); x.moveTo(px, py); x.lineTo(px + tvx * vt * sc, py + tvz * vt * sc); x.stroke(); }
    if (idx === 1 && !t.static) txt(x, t.name, px + 12, py - 10, { s: 13, c: P.dim });
    if (!t.static) list.push({ name: t.name, brg: wrap360(Math.atan2(dx, -dz) / DEG), rng: r / NM, cpa: cpa / NM, tcpa, danger, sog: t.sog / KN });
  }
  x.restore();
  // bearing scale
  x.strokeStyle = P.dim; x.lineWidth = 1.5;
  for (let d = 0; d < 360; d += 5) {
    const a = d * DEG, r0 = R + 2, r1 = R + (d % 30 === 0 ? 14 : d % 10 === 0 ? 9 : 5);
    x.beginPath(); x.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0); x.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1); x.stroke();
    if (d % 30 === 0) txt(x, String(d).padStart(3, '0'), cx + Math.sin(a) * (R + 28), cy - Math.cos(a) * (R + 28) + 5, { s: 13, c: P.dim, a: 'center', f: MONO });
  }
  // side panel
  const px0 = cx + R + 50, pw = W - px0 - 14;
  box(x, px0, 14, pw, H - 28, P);
  let y = 50;
  txt(x, idx === 0 ? 'X-BAND' : 'S-BAND', px0 + 16, y, { s: 26, w: 800, c: P.hi }); txt(x, 'NORTH UP · RM(T) · STAB GND', px0 + 16, y + 24, { s: 14, c: P.dim });
  y += 64;
  const row = (k, v, col) => { txt(x, k, px0 + 16, y, { s: 15, c: P.dim, w: 700 }); txt(x, v, px0 + pw - 16, y, { s: 20, c: col || P.text, a: 'right', f: MONO }); y += 30; };
  row('RANGE', rangeNm + ' NM  RINGS ' + (rangeNm / 6).toFixed(2));
  row('HDG', pad(s.psi / DEG) + '.' + Math.floor((s.psi / DEG % 1) * 10) + '°');
  row('STW', fmt(s.u / KN) + ' kn'); row('COG', pad(s.cog / DEG) + '°'); row('SOG', fmt(s.sog / KN) + ' kn');
  const [la, lo] = toLatLon(s.x, s.z); row('LAT', fmtLat(la)); row('LON', fmtLon(lo));
  row('GAIN / SEA / RAIN', 'AUTO / AUTO / 0');
  row('PULSE', rangeNm > 3 ? 'MP' : 'SP');
  y += 8;
  txt(x, 'TARGETS  (CPA / TCPA)', px0 + 16, y, { s: 15, c: P.acc, w: 700 }); y += 26;
  list.sort((a, b) => a.rng - b.rng).slice(0, 6).forEach((t) => {
    const col = t.danger ? P.bad : P.text;
    txt(x, t.name.slice(0, 14), px0 + 16, y, { s: 15, c: col, w: 700 });
    txt(x, `${pad(t.brg)}° ${t.rng.toFixed(2)}nm`, px0 + pw - 16, y, { s: 15, c: col, a: 'right', f: MONO }); y += 20;
    txt(x, `CPA ${t.cpa.toFixed(2)}  TCPA ${t.tcpa > 0 && t.tcpa < 1e8 ? (t.tcpa / 60).toFixed(1) + 'm' : '--'}  ${t.sog.toFixed(1)}kn`, px0 + 16, y, { s: 14, c: t.danger ? P.bad : P.dim, f: MONO }); y += 26;
  });
  if (list.some((t) => t.danger)) { x.fillStyle = P.bad; x.fillRect(px0 + 10, H - 70, pw - 20, 40); txt(x, 'CPA / TCPA ALARM', px0 + pw / 2, H - 42, { s: 20, w: 800, c: '#fff', a: 'center' }); G.cpaAlarm = true; } else G.cpaAlarm = false;
  txt(x, clockStr(), 20, 36, { s: 20, c: P.dim, f: MONO });
  txt(x, 'TRAILS OFF  ·  VRM ' + (rangeNm / 3).toFixed(2) + ' NM', 20, H - 18, { s: 14, c: P.dim });
  x.strokeStyle = P.dim; x.setLineDash([6, 6]); x.beginPath(); x.arc(cx, cy, R / 3, 0, 7); x.stroke(); x.setLineDash([]);
}

// ============================================================= ECDIS
const ECB = { x0: -17000, x1: 5000, z0: -6500, z1: 6500, res: 10 };
function buildEcdisBase() {
  const w = Math.round((ECB.x1 - ECB.x0) / ECB.res), h = Math.round((ECB.z1 - ECB.z0) / ECB.res);
  const D = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const X = ECB.x0 + (i + 0.5) * ECB.res, Z = ECB.z0 + (j + 0.5) * ECB.res;
    D[j * w + i] = isLandFast(X, Z) ? -1 : depthAt(X, Z);
  }
  for (const night of [false, true]) {
    const c = makeCanvas(w, h), x = c.getContext('2d');
    const img = x.createImageData(w, h);
    const cols = night
      ? { land: [70, 60, 36], d0: [18, 38, 60], d5: [14, 30, 48], d10: [10, 22, 36], d20: [6, 14, 24], deep: [4, 8, 14], cont: [80, 110, 130], safe: [120, 120, 130] }
      : { land: [214, 199, 150], d0: [104, 176, 232], d5: [148, 200, 240], d10: [187, 222, 246], d20: [216, 236, 250], deep: [246, 250, 253], cont: [90, 120, 150], safe: [40, 40, 50] };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const d = D[j * w + i];
      let c = d < 0 ? cols.land : d < 5 ? cols.d0 : d < 10 ? cols.d5 : d < 16 ? cols.d10 : d < 25 ? cols.d20 : cols.deep;
      if (d >= 0 && i > 0 && j > 0) {
        const dl = D[j * w + i - 1], du = D[(j - 1) * w + i];
        const cross = (a, b, lv) => (a >= 0 && b >= 0) && ((a < lv) !== (b < lv));
        if (cross(d, dl, 16) || cross(d, du, 16)) c = cols.safe;
        else if (cross(d, dl, 10) || cross(d, du, 10) || cross(d, dl, 20) || cross(d, du, 20)) c = cols.cont;
      }
      const o = (j * w + i) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    // soundings
    const R = mulberry32(8); x.fillStyle = night ? '#6f7f8a' : '#4f5a64'; x.font = '9px Arial';
    ECB[night ? 'night' : 'day'] = c;
    ECB.sound = ECB.sound || [];
    if (!night) for (let k = 0; k < 900; k++) { const X = ECB.x0 + R() * (ECB.x1 - ECB.x0), Z = ECB.z0 + R() * (ECB.z1 - ECB.z0); if (!isLandFast(X, Z)) ECB.sound.push([X, Z, depthAt(X, Z)]); }
  }
}
function isLandFast(x, z) { if (x < -2800) return false; return isLand(x, z); }

function drawECDIS(x, W, H, rangeNm, idx) {
  const P = pal(), s = G.ship, night = ENV.night;
  const CW = W - 330;
  const scale = (H / 2) / (rangeNm * NM);
  const la = Math.min(0.35, 0.25) * rangeNm * NM;
  const ox = s.x + Math.sin(s.cog) * la * (s.sog > 0.5 ? 1 : 0), oz = s.z - Math.cos(s.cog) * la * (s.sog > 0.5 ? 1 : 0);
  const sx = (X) => CW / 2 + (X - ox) * scale, sy = (Z) => H / 2 + (Z - oz) * scale;
  x.save(); x.beginPath(); x.rect(0, 0, CW, H); x.clip();
  x.fillStyle = night ? '#040810' : '#f4f9fd'; x.fillRect(0, 0, CW, H);
  // base raster
  const base = ECB[night ? 'night' : 'day'];
  const halfW = CW / 2 / scale, halfH = H / 2 / scale;
  const srcX = (ox - halfW - ECB.x0) / ECB.res, srcY = (oz - halfH - ECB.z0) / ECB.res, srcW = 2 * halfW / ECB.res, srcH = 2 * halfH / ECB.res;
  x.imageSmoothingEnabled = rangeNm > 1.5;
  x.drawImage(base, srcX, srcY, srcW, srcH, 0, 0, CW, H);
  x.imageSmoothingEnabled = true;
  // land outline & quays
  const polyPath = (p) => { x.beginPath(); p.forEach(([X, Z], i) => (i ? x.lineTo(sx(X), sy(Z)) : x.moveTo(sx(X), sy(Z)))); x.closePath(); };
  x.fillStyle = night ? 'rgb(70,60,36)' : 'rgb(214,199,150)';
  for (const p of [GEO.mainland, GEO.breakN, GEO.breakS]) { polyPath(p); x.fill(); x.strokeStyle = night ? '#8a7a50' : '#50462a'; x.lineWidth = 1.5; x.stroke(); }
  // terminal areas & berths
  x.strokeStyle = night ? '#9a8a60' : '#222'; x.lineWidth = 2.5;
  for (const q of GEO.quays) { x.beginPath(); if (q.axis === 'x') { x.moveTo(sx(q.x0), sy(q.z)); x.lineTo(sx(q.x1), sy(q.z)); } else { x.moveTo(sx(q.x), sy(q.z0)); x.lineTo(sx(q.x), sy(q.z1)); } x.stroke(); }
  // dredged channel limits
  x.strokeStyle = night ? '#506070' : '#7a8894'; x.setLineDash([10, 6]); x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(sx(GEO.channel.x0), sy(-GEO.channel.half)); x.lineTo(sx(GEO.channel.x1), sy(-GEO.channel.half)); x.moveTo(sx(GEO.channel.x0), sy(GEO.channel.half)); x.lineTo(sx(GEO.channel.x1), sy(GEO.channel.half)); x.stroke();
  x.setLineDash([]);
  if (rangeNm <= 6) for (let X = -13000; X < -2600; X += 2500) txt(x, 'Dredged 20.5 m', sx(X), sy(40), { s: 12, c: night ? '#6f7f8a' : '#56626c' });
  // leading line
  x.strokeStyle = night ? '#8a8a8a' : '#333'; x.setLineDash([16, 8]); x.lineWidth = 1.2; x.beginPath(); x.moveTo(sx(-14000), sy(0)); x.lineTo(sx(2950), sy(0)); x.stroke(); x.setLineDash([]);
  if (rangeNm >= 1.5) txt(x, 'Ldg Lts 090°', sx(-5000), sy(-12), { s: 12, c: night ? '#8a8a8a' : '#333' });
  // soundings
  if (rangeNm <= 3) { x.fillStyle = night ? '#6f7f8a' : '#56626c'; x.font = '12px Arial'; x.textAlign = 'center'; for (const [X, Z, d] of ECB.sound) { const px = sx(X), py = sy(Z); if (px > 0 && px < CW && py > 0 && py < H) x.fillText(Math.round(d), px, py); } }
  // anchorage & pilot boarding place
  x.strokeStyle = '#c040c0'; x.setLineDash([8, 6]); x.lineWidth = 1.5; x.beginPath(); x.rect(sx(-15500), sy(-5200), (5000) * scale, 3000 * scale); x.stroke(); x.setLineDash([]);
  txt(x, '⚓ Anchorage A', sx(-15300), sy(-5000), { s: 13, c: '#c040c0' });
  const [pbx, pbz] = GEO.pilotStation;
  x.strokeStyle = '#c040c0'; x.lineWidth = 2; x.beginPath(); x.arc(sx(pbx), sy(pbz), Math.max(8, 400 * scale), 0, 7); x.stroke(); txt(x, 'Ⓟ Pilot boarding', sx(pbx) + 10, sy(pbz) - Math.max(10, 400 * scale) - 4, { s: 13, c: '#c040c0', w: 700 });
  // VTS reporting line
  x.strokeStyle = '#c040c0'; x.setLineDash([3, 5]); x.beginPath(); x.moveTo(sx(-12000), sy(-3000)); x.lineTo(sx(-12000), sy(3000)); x.stroke(); x.setLineDash([]);
  if (rangeNm >= 1.5) txt(x, 'VTS Ch 11', sx(-12000) + 6, sy(-2800), { s: 12, c: '#c040c0' });
  // buoys
  for (const b of GEO.buoys) {
    const px = sx(b.x), py = sy(b.z); if (px < -20 || px > CW + 20 || py < -20 || py > H + 20) continue;
    const col = b.type === 'red' ? '#e0302a' : b.type === 'green' ? '#1e9e46' : b.type === 'safe' ? '#e0302a' : '#e0c020';
    x.fillStyle = col; x.strokeStyle = '#111'; x.lineWidth = 1;
    x.beginPath();
    if (b.type === 'green') { x.moveTo(px, py - 12); x.lineTo(px + 7, py + 3); x.lineTo(px - 7, py + 3); }
    else if (b.type === 'red') { x.rect(px - 6, py - 9, 12, 12); }
    else { x.arc(px, py - 4, 7, 0, 7); }
    x.fill(); x.stroke();
    // light flare
    x.fillStyle = 'rgba(200,60,200,0.7)'; x.beginPath(); x.moveTo(px, py - 2); x.lineTo(px + 16, py - 14); x.lineTo(px + 10, py - 18); x.closePath(); x.fill();
    if (rangeNm <= 6) txt(x, b.name, px + 10, py + 14, { s: 12, c: night ? '#9aa' : '#333', w: 700 });
  }
  // lights on breakwater heads
  for (const [X, Z, c, t] of [[-2658, -398, '#e0302a', 'Fl R 5s 17m 8M'], [-2658, 398, '#1e9e46', 'Fl G 5s 17m 8M']]) {
    x.fillStyle = 'rgba(200,60,200,0.8)'; x.beginPath(); x.moveTo(sx(X), sy(Z)); x.lineTo(sx(X) + 20, sy(Z) - 16); x.lineTo(sx(X) + 12, sy(Z) - 22); x.closePath(); x.fill();
    x.fillStyle = c; x.beginPath(); x.arc(sx(X), sy(Z), 4, 0, 7); x.fill();
    if (rangeNm <= 3) txt(x, t, sx(X) + 8, sy(Z) + (Z < 0 ? -24 : 30), { s: 12, c: night ? '#9aa' : '#333' });
  }
  // berth box
  const bt = GEO.berth;
  x.strokeStyle = '#c040c0'; x.lineWidth = 2; x.setLineDash([6, 4]);
  x.beginPath(); x.rect(sx(bt.x0), sy(-700), (bt.x1 - bt.x0) * scale, 62 * scale); x.stroke(); x.setLineDash([]);
  if (rangeNm <= 3) txt(x, 'BERTH 4', sx(bt.x) , sy(-700) + 30 * scale + 5, { s: 13, c: '#c040c0', w: 800, a: 'center' });
  // route
  x.strokeStyle = '#e0501a'; x.lineWidth = 3;
  x.beginPath(); ROUTE.forEach((w, i) => (i ? x.lineTo(sx(w[0]), sy(w[1])) : x.moveTo(sx(w[0]), sy(w[1])))); x.stroke();
  x.lineWidth = 1; x.setLineDash([4, 6]); x.strokeStyle = 'rgba(224,80,26,0.6)';
  // XTE limits
  for (let i = 0; i < ROUTE.length - 1; i++) { const a = ROUTE[i], b = ROUTE[i + 1], d = Math.hypot(b[0] - a[0], b[1] - a[1]); const nx = -(b[1] - a[1]) / d * 150, nz = (b[0] - a[0]) / d * 150; for (const k of [-1, 1]) { x.beginPath(); x.moveTo(sx(a[0] + nx * k), sy(a[1] + nz * k)); x.lineTo(sx(b[0] + nx * k), sy(b[1] + nz * k)); x.stroke(); } }
  x.setLineDash([]);
  ROUTE.forEach((w, i) => { x.strokeStyle = '#e0501a'; x.lineWidth = 2; x.beginPath(); x.arc(sx(w[0]), sy(w[1]), 7, 0, 7); x.stroke(); if (rangeNm <= 6) txt(x, ROUTE_NAMES[i], sx(w[0]) + 10, sy(w[1]) - 8, { s: 12, c: '#e0501a', w: 700 }); });
  // AIS targets
  for (const t of radarTargets()) {
    const px = sx(t.x), py = sy(t.z); if (px < -50 || px > CW + 50 || py < -50 || py > H + 50) continue;
    x.save(); x.translate(px, py); x.rotate(t.psi);
    if (t.L * scale > 16) { x.fillStyle = 'rgba(40,160,80,0.25)'; x.strokeStyle = '#2a9a50'; x.lineWidth = 1.5; x.beginPath(); x.rect(-t.B / 2 * scale, -t.L / 2 * scale, t.B * scale, t.L * scale); x.fill(); x.stroke(); }
    else { x.strokeStyle = '#2a9a50'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, -12); x.lineTo(7, 8); x.lineTo(-7, 8); x.closePath(); x.stroke(); }
    x.restore();
    if (t.sog > 0.2) { x.strokeStyle = '#2a9a50'; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.sin(t.cog) * t.sog * 360 * scale, py - Math.cos(t.cog) * t.sog * 360 * scale); x.stroke(); }
    if (rangeNm <= 6) txt(x, t.name, px + 10, py - 10, { s: 12, c: '#2a9a50', w: 700 });
  }
  // past track
  x.fillStyle = night ? '#6a8aa0' : '#333';
  for (const p of G.track || []) { const px = sx(p[0]), py = sy(p[1]); if (px > 0 && px < CW && py > 0 && py < H) x.fillRect(px - 1.5, py - 1.5, 3, 3); }
  // predictor (30/60/90 s)
  const pred = predictShip(s, [30, 60, 90]);
  pred.forEach((p, i) => drawShipOutline(x, sx(p.x), sy(p.z), p.psi, scale, 'rgba(120,120,140,' + (0.8 - i * 0.2) + ')', 1.2, false));
  // own ship
  drawShipOutline(x, sx(s.x), sy(s.z), s.psi, scale, night ? '#e0a040' : '#101010', 2.5, true);
  // COG/SOG vector 6 min with 1-min ticks
  const vx = s.vgx * 360 * scale, vz = s.vgz * 360 * scale;
  x.strokeStyle = night ? '#e0a040' : '#101010'; x.lineWidth = 2; x.beginPath(); x.moveTo(sx(s.x), sy(s.z)); x.lineTo(sx(s.x) + vx, sy(s.z) + vz); x.stroke();
  for (let k = 1; k <= 6; k++) { const px = sx(s.x) + vx * k / 6, py = sy(s.z) + vz * k / 6; x.beginPath(); x.moveTo(px - vz / Math.hypot(vx, vz || 1) * 5, py + vx / Math.hypot(vx || 1, vz) * 5); x.lineTo(px + vz / Math.hypot(vx, vz || 1) * 5, py - vx / Math.hypot(vx || 1, vz) * 5); x.stroke(); }
  // scale bar
  const nmPx = NM * scale / 10; x.fillStyle = night ? '#9aa' : '#222';
  x.fillRect(16, H - 30, 4, 20); for (let k = 0; k < 10; k++) { x.fillStyle = k % 2 ? (night ? '#333' : '#fff') : (night ? '#9aa' : '#222'); x.fillRect(16, H - 30 - (k + 1) * nmPx / 2, 4, nmPx / 2); }
  txt(x, (rangeNm * 2).toFixed(rangeNm < 1 ? 2 : 1) + ' NM', 26, H - 14, { s: 13, c: night ? '#9aa' : '#222', w: 700 });
  txt(x, 'N↑', CW - 40, 34, { s: 22, w: 800, c: night ? '#9aa' : '#222' });
  x.restore();

  // ---- side panel
  const px0 = CW, pw = W - CW;
  x.fillStyle = P.panel; x.fillRect(px0, 0, pw, H);
  let y = 40;
  txt(x, 'ECDIS ' + (idx === 0 ? 'MASTER' : 'BACKUP'), px0 + 18, y, { s: 22, w: 800, c: P.hi }); y += 24;
  txt(x, 'ENC WH5ARR01 · S-52 ' + (night ? 'NIGHT' : 'DAY BRIGHT'), px0 + 18, y, { s: 13, c: P.dim }); y += 34;
  const row = (k, v, col) => { txt(x, k, px0 + 18, y, { s: 14, c: P.dim, w: 700 }); txt(x, v, px0 + pw - 18, y, { s: 19, c: col || P.text, a: 'right', f: MONO }); y += 29; };
  const [lat, lon] = toLatLon(s.x, s.z);
  row('LAT', fmtLat(lat)); row('LON', fmtLon(lon)); row('SOURCE', 'DGNSS 1');
  row('HDG', pad(s.psi / DEG) + '°'); row('COG', pad(s.cog / DEG) + '°'); row('SOG', fmt(s.sog / KN) + ' kn'); row('ROT', fmt(s.rotDegMin, 1) + '°/m');
  row('DEPTH', fmt(s.depthUnder - 0.0, 1) + ' m'); row('UKC', fmt(s.ukc, 1) + ' m', s.ukc < 1.5 ? P.bad : s.ukc < 3 ? P.warn : P.text);
  y += 6;
  txt(x, 'ROUTE  WESTERHAVEN ARR B4', px0 + 18, y, { s: 14, c: '#e0501a', w: 800 }); y += 28;
  const wp = routeProgress(s);
  row('TO WPT', ROUTE_NAMES[wp.next]); row('BRG', pad(wp.brg) + '°'); row('DIST', wp.dist.toFixed(2) + ' NM'); row('XTE', (wp.xte >= 0 ? 'S ' : 'P ') + Math.abs(wp.xte).toFixed(0) + ' m', Math.abs(wp.xte) > 150 ? P.warn : P.text);
  row('TTG', s.sog > 0.3 ? (wp.dist * NM / s.sog / 60).toFixed(0) + ' min' : '--');
  y += 6;
  row('RANGE', rangeNm + ' NM'); row('MODE', 'N-UP  TM');
  txt(x, clockStr() + ' LT', px0 + 18, H - 18, { s: 18, c: P.dim, f: MONO });
  if (s.ukc < 2) { x.fillStyle = P.bad; x.fillRect(px0 + 10, H - 90, pw - 20, 40); txt(x, 'SAFETY CONTOUR', px0 + pw / 2, H - 62, { s: 18, w: 800, c: '#fff', a: 'center' }); }
}
function drawShipOutline(x, px, py, psi, scale, col, lw, fill) {
  const pts = shipPoly();
  x.save(); x.translate(px, py); x.rotate(psi);
  x.strokeStyle = col; x.lineWidth = lw; x.beginPath();
  if (199 * scale < 8) { x.arc(0, 0, 8, 0, 7); x.moveTo(0, 0); x.arc(0, 0, 4, 0, 7); x.stroke(); x.beginPath(); x.moveTo(0, -8); x.lineTo(0, -40); x.stroke(); x.restore(); return; }
  pts.forEach(([f, sb], i) => (i ? x.lineTo(sb * scale, -f * scale) : x.moveTo(sb * scale, -f * scale)));
  x.closePath(); if (fill) { x.fillStyle = 'rgba(66,176,213,0.25)'; x.fill(); } x.stroke();
  x.beginPath(); x.moveTo(0, -200 * scale); x.lineTo(0, -200 * scale - 1500 * scale); x.stroke();
  x.restore();
}
function predictShip(s, times) {
  const out = []; let x = s.x, z = s.z, psi = s.psi, t = 0;
  const u = s.u, v = s.v, r = s.r;
  for (const T of times) {
    while (t < T) { const dt = 2; psi += r * dt; x += (u * Math.sin(psi) + v * Math.cos(psi) + Math.sin(s.curSetTo) * s.curSpeed) * dt; z += (-u * Math.cos(psi) + v * Math.sin(psi) - Math.cos(s.curSetTo) * s.curSpeed) * dt; t += dt; }
    out.push({ x, z, psi });
  }
  return out;
}
function routeProgress(s) {
  let best = { i: 0, d: 1e12 };
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const a = ROUTE[i], b = ROUTE[i + 1]; const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    let t = ((s.x - a[0]) * dx + (s.z - a[1]) * dz) / (L * L); t = clamp(t, 0, 1);
    const d = Math.hypot(s.x - (a[0] + dx * t), s.z - (a[1] + dz * t));
    if (d < best.d) best = { i, d, t };
  }
  const a = ROUTE[best.i], b = ROUTE[best.i + 1];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  const xte = ((s.x - a[0]) * (-dz) + (s.z - a[1]) * dx) / L * -1;
  const next = best.t > 0.98 ? Math.min(ROUTE.length - 1, best.i + 2) : best.i + 1;
  const w = ROUTE[next];
  const brg = wrap360(Math.atan2(w[0] - s.x, -(w[1] - s.z)) / DEG);
  const legBrg = wrap360(Math.atan2(dx, -dz) / DEG);
  return { next, brg, dist: Math.hypot(w[0] - s.x, w[1] - s.z) / NM, xte, legBrg, leg: best.i };
}

// ============================================================= CONNING
function drawConning(x, W, H) {
  const P = pal(), s = G.ship;
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  // heading tape
  box(x, 12, 12, W - 24, 120, P);
  const hdg = s.psi / DEG;
  x.save(); x.beginPath(); x.rect(20, 20, W - 40, 104); x.clip();
  for (let d = -40; d <= 40; d++) {
    const v = Math.floor(hdg) + d, px = W / 2 + (v - hdg) * 14;
    const big = v % 10 === 0;
    x.fillStyle = P.dim; x.fillRect(px, 30, 2, big ? 26 : v % 5 === 0 ? 16 : 8);
    if (big) txt(x, pad(wrap360(v)), px, 84, { s: 20, c: P.text, a: 'center', f: MONO });
  }
  x.restore();
  x.fillStyle = P.acc; x.beginPath(); x.moveTo(W / 2, 22); x.lineTo(W / 2 - 10, 10); x.lineTo(W / 2 + 10, 10); x.fill();
  txt(x, pad(hdg) + '.' + Math.floor((hdg % 1) * 10) + '°', W / 2, 118, { s: 30, w: 800, c: P.hi, a: 'center', f: MONO });
  txt(x, 'GYRO 1', 30, 118, { s: 14, c: P.dim, w: 700 }); txt(x, 'COG ' + pad(s.cog / DEG) + '°', W - 30, 118, { s: 20, c: P.text, a: 'right', f: MONO });
  if (G.steering === 'AUTO') { const px = W / 2 + wrap180(G.apHeading - hdg) * 14; if (Math.abs(px - W / 2) < W / 2 - 30) { x.fillStyle = P.good; x.fillRect(px - 3, 60, 6, 20); } }

  // ROT gauge
  box(x, 12, 144, 400, 300, P, 'RATE OF TURN °/min');
  arcGauge(x, 212, 380, 150, s.rotDegMin, -30, 30, Math.PI * 1.15, Math.PI * 1.85, P, { labels: ['30', '', '', '', '0', '', '', '', '30'], ticks: 8, zones: [[-30, 0, 'rgba(255,90,79,0.35)'], [0, 30, 'rgba(111,224,138,0.35)']] });
  txt(x, (s.rotDegMin >= 0 ? 'S ' : 'P ') + Math.abs(s.rotDegMin).toFixed(1), 212, 430, { s: 28, w: 800, c: P.hi, a: 'center', f: MONO });
  // rudders
  box(x, 424, 144, 432, 300, P, 'RUDDER ANGLE  P / S');
  for (const [k, cx] of [[0, 532], [1, 748]]) {
    arcGauge(x, cx, 360, 90, s.rudder, -40, 40, Math.PI * 0.2, Math.PI * 0.8, P, { ticks: 8, labels: ['40', '30', '20', '10', '0', '10', '20', '30', '40'].reverse(), zones: [[-40, 0, 'rgba(255,90,79,0.35)'], [0, 40, 'rgba(111,224,138,0.35)']], order: G.steering === 'HAND' ? G.helmOrder : G.steering === 'AUTO' ? s.rudderCmd : undefined });
    txt(x, (k ? 'STBD ' : 'PORT ') + 'RUDDER', cx, 250, { s: 13, c: P.dim, a: 'center', w: 700 });
  }
  txt(x, (s.rudder < -0.5 ? 'P ' : s.rudder > 0.5 ? 'S ' : '') + Math.abs(s.rudder).toFixed(1) + '°', 640, 430, { s: 28, w: 800, c: P.hi, a: 'center', f: MONO });
  // steering mode
  box(x, 868, 144, 400, 300, P, 'STEERING');
  txt(x, G.steering === 'AUTO' ? 'AUTOPILOT' : G.steering === 'HAND' ? 'HAND (FU)' : 'NFU TILLER', 1068, 214, { s: 30, w: 800, c: G.steering === 'AUTO' ? P.good : P.warn, a: 'center' });
  if (G.steering === 'AUTO') { txt(x, 'SET ' + pad(G.apHeading) + '°', 1068, 262, { s: 34, w: 800, c: P.hi, a: 'center', f: MONO }); txt(x, 'RUD LIM ' + G.apRudderLimit + '°  ·  HDG MODE', 1068, 296, { s: 16, c: P.dim, a: 'center' }); }
  else { txt(x, 'HELM ' + (G.helmOrder < 0 ? 'P ' : G.helmOrder > 0 ? 'S ' : '') + Math.abs(G.helmOrder) + '°', 1068, 262, { s: 34, w: 800, c: P.hi, a: 'center', f: MONO }); txt(x, CREW.atHelm() ? 'AB at the wheel' : 'Master steering', 1068, 296, { s: 16, c: P.dim, a: 'center' }); }
  txt(x, 'Steering gear: 2 pumps running', 1068, 330, { s: 15, c: P.dim, a: 'center' });
  txt(x, 'Off-course alarm 10°', 1068, 356, { s: 15, c: P.dim, a: 'center' });
  // speed
  box(x, 12, 456, 620, 392, P, 'SPEED — DOPPLER LOG (water) / GNSS (ground)');
  txt(x, fmt(s.u / KN, 1), 180, 560, { s: 72, w: 800, c: P.hi, a: 'center', f: MONO }); txt(x, 'STW kn', 180, 596, { s: 16, c: P.dim, a: 'center', w: 700 });
  txt(x, fmt(s.sog / KN, 1), 460, 560, { s: 72, w: 800, c: P.text, a: 'center', f: MONO }); txt(x, 'SOG kn', 460, 596, { s: 16, c: P.dim, a: 'center', w: 700 });
  const vb = s.transverse(180), vs = s.transverse(-180);
  const arrow = (v) => (v > 0.005 ? '→' : v < -0.005 ? '←' : '·');
  txt(x, 'BOW  ' + arrow(vb) + ' ' + Math.abs(vb).toFixed(2) + ' m/s', 40, 660, { s: 26, w: 700, c: Math.abs(vb) > 0.3 ? P.warn : P.text, f: MONO });
  txt(x, 'STERN ' + arrow(vs) + ' ' + Math.abs(vs).toFixed(2) + ' m/s', 40, 700, { s: 26, w: 700, c: Math.abs(vs) > 0.3 ? P.warn : P.text, f: MONO });
  txt(x, 'LONG ' + (s.u >= 0 ? '↑ ' : '↓ ') + Math.abs(s.u / KN).toFixed(2) + ' kn', 40, 740, { s: 26, w: 700, c: P.text, f: MONO });
  txt(x, 'DRIFT ' + (Math.atan2(s.v, Math.max(0.3, Math.abs(s.u))) / DEG).toFixed(1) + '°', 360, 740, { s: 22, c: P.dim, f: MONO });
  txt(x, 'CURRENT ' + pad(s.curSetTo / DEG) + '° / ' + (s.curSpeed / KN).toFixed(1) + ' kn', 40, 800, { s: 18, c: P.dim, f: MONO });
  // wind + depth
  box(x, 644, 456, 300, 392, P, 'WIND');
  const wcx = 794, wcy = 660;
  x.strokeStyle = P.line; x.lineWidth = 3; x.beginPath(); x.arc(wcx, wcy, 110, 0, 7); x.stroke();
  for (let d = 0; d < 360; d += 30) { const a = d * DEG; x.beginPath(); x.moveTo(wcx + Math.sin(a) * 100, wcy - Math.cos(a) * 100); x.lineTo(wcx + Math.sin(a) * 112, wcy - Math.cos(a) * 112); x.stroke(); }
  // ship silhouette pointing up (relative)
  x.fillStyle = P.line; x.beginPath(); x.moveTo(wcx, wcy - 60); x.lineTo(wcx + 14, wcy - 30); x.lineTo(wcx + 14, wcy + 55); x.lineTo(wcx - 14, wcy + 55); x.lineTo(wcx - 14, wcy - 30); x.fill();
  const rw = s._windRel || { speed: 0, angle: 0 };
  const relFrom = Math.atan2(-Math.sin(rw.angle), -Math.cos(rw.angle));
  x.fillStyle = P.acc; x.save(); x.translate(wcx + Math.sin(relFrom) * 90, wcy - Math.cos(relFrom) * 90); x.rotate(relFrom + Math.PI); x.beginPath(); x.moveTo(0, -18); x.lineTo(10, 10); x.lineTo(-10, 10); x.fill(); x.restore();
  txt(x, 'REL ' + pad(wrap360(relFrom / DEG)) + '° ' + (rw.speed / KN).toFixed(1) + ' kn', wcx, 810, { s: 18, c: P.text, a: 'center', f: MONO });
  txt(x, 'TRUE ' + pad(s.windFrom / DEG) + '° ' + (s.windSpeed / KN).toFixed(1) + ' kn', wcx, 836, { s: 16, c: P.dim, a: 'center', f: MONO });
  box(x, 956, 456, 312, 392, P, 'DEPTH / UKC');
  txt(x, fmt(s.depthUnder - s.S.T, 1), 1112, 580, { s: 64, w: 800, c: s.ukc < 2 ? P.bad : P.hi, a: 'center', f: MONO });
  txt(x, 'm below keel (static)', 1112, 612, { s: 15, c: P.dim, a: 'center' });
  txt(x, 'Squat ' + fmt(s.squat, 2) + ' m', 1112, 660, { s: 20, c: P.text, a: 'center', f: MONO });
  txt(x, 'UKC ' + fmt(s.ukc, 1) + ' m', 1112, 700, { s: 26, w: 800, c: s.ukc < 1.5 ? P.bad : s.ukc < 3 ? P.warn : P.good, a: 'center', f: MONO });
  txt(x, 'Draft F 14.4 / A 14.6 m', 1112, 760, { s: 15, c: P.dim, a: 'center' });
  txt(x, clockStr() + ' LT', 1112, 820, { s: 20, c: P.dim, a: 'center', f: MONO });
}

function drawConning2(x, W, H) {
  const P = pal(), s = G.ship;
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  box(x, 12, 12, 620, 400, P, 'PROPULSION  (ordered ▲ / actual)');
  for (const [k, cx] of [[0, 170], [1, 470]]) {
    const ord = TELEGRAPH[s.tele[k]].rpm;
    arcGauge(x, cx, 280, 120, s.rpm[k], -60, 80, Math.PI * 0.75, Math.PI * 2.25, P, { ticks: 7, labels: ['60', '40', '20', '0', '20', '40', '60', '80'], order: ord, zones: [[-60, 0, 'rgba(255,90,79,0.3)'], [0, 80, 'rgba(111,224,138,0.3)']] });
    txt(x, (k ? 'STBD' : 'PORT') + ' ME', cx, 80, { s: 16, c: P.dim, a: 'center', w: 800 });
    txt(x, fmt(s.rpm[k], 0) + ' rpm', cx, 360, { s: 26, w: 800, c: P.hi, a: 'center', f: MONO });
    txt(x, TELEGRAPH[s.tele[k]].label, cx, 392, { s: 16, c: ord < 0 ? P.bad : ord > 0 ? P.good : P.text, a: 'center', w: 700 });
  }
  box(x, 644, 12, 624, 400, P, 'BOW THRUSTERS');
  for (const [k, cy] of [[0, 120], [1, 250]]) {
    txt(x, 'BT' + (k + 1), 670, cy + 10, { s: 22, w: 800, c: P.text });
    hbar(x, 740, cy - 14, 480, 32, s.bowThr[k], P, s.bowThr[k] < 0 ? P.bad : P.good);
    txt(x, (s.bowThr[k] < 0 ? 'P ' : s.bowThr[k] > 0 ? 'S ' : '') + Math.round(Math.abs(s.bowThr[k]) * 100) + ' %', 980, cy + 60, { s: 20, c: P.dim, a: 'center', f: MONO });
  }
  txt(x, G.thrReady ? 'READY · 2 × 2 500 kW' : G.thrStarting ? 'STARTING…' : 'STOPPED — press BT START', 956, 380, { s: 20, w: 700, c: G.thrReady ? P.good : P.warn, a: 'center' });
  box(x, 12, 424, 1256, 424, P, 'ENGINE / MANOEUVRING STATUS');
  const rows = [
    ['Engine mode', s.engineMode === 'STANDBY' ? 'STAND-BY (manoeuvring)' : s.engineMode === 'SEA' ? 'SEA PASSAGE' : 'FINISHED WITH ENGINES', s.engineMode === 'STANDBY' ? P.good : P.warn],
    ['Control location', 'BRIDGE', P.text],
    ['Telegraphs', G.splitEngines ? 'SPLIT' : 'COMBINED', P.text],
    ['Start air', (30 - Math.min(20, s.startAirUses * 0.8)).toFixed(1) + ' bar', P.text],
    ['Astern', s.engineMode === 'SEA' ? 'BLOCKED (sea mode)' : 'AVAILABLE', s.engineMode === 'SEA' ? P.warn : P.good],
    ['Shaft power', ((Math.abs(s.thrustOf(0, s.u)) + Math.abs(s.thrustOf(1, s.u))) * Math.max(0.5, Math.abs(s.u)) / 1e6 * 1.4).toFixed(1) + ' MW (est.)', P.text],
  ];
  rows.forEach(([k, v, c], i) => { txt(x, k, 40, 490 + i * 56, { s: 22, c: P.dim, w: 700 }); txt(x, v, 620, 490 + i * 56, { s: 26, c, w: 800, f: MONO }); });
}

// ============================================================= DOCKING
function drawDocking(x, W, H) {
  const P = pal(), s = G.ship;
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  const bi = berthInfo();
  const view = 720, sc = (H - 40) / view;
  const cx = 440, cy = H / 2;
  // world → view rotated so ship heading is up
  const cs = Math.cos(-s.psi), sn = Math.sin(-s.psi);
  const tv = (X, Z) => { const dx = X - s.x, dz = Z - s.z; return [cx + (dx * cs - dz * sn) * sc, cy + (dx * sn + dz * cs) * sc]; };
  x.save(); x.beginPath(); x.rect(0, 0, 880, H); x.clip();
  // grid
  x.strokeStyle = P.line; x.lineWidth = 1;
  for (let k = -400; k <= 400; k += 50) { x.beginPath(); x.moveTo(cx + k * sc, 0); x.lineTo(cx + k * sc, H); x.stroke(); x.beginPath(); x.moveTo(0, cy + k * sc); x.lineTo(880, cy + k * sc); x.stroke(); }
  // land & quays
  x.fillStyle = ENV.night ? '#2a2418' : '#3a3a33';
  for (const p of [GEO.mainland, GEO.breakN, GEO.breakS]) { x.beginPath(); p.forEach(([X, Z], i) => { const [a, b] = tv(X, Z); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.closePath(); x.fill(); }
  x.strokeStyle = P.warn; x.lineWidth = 3;
  for (const q of GEO.quays) { x.beginPath(); const a = q.axis === 'x' ? tv(q.x0, q.z + q.face * FENDER) : tv(q.x + q.face * FENDER, q.z0); const b = q.axis === 'x' ? tv(q.x1, q.z + q.face * FENDER) : tv(q.x + q.face * FENDER, q.z1); x.moveTo(...a); x.lineTo(...b); x.stroke(); }
  // berth target
  const bt = GEO.berth;
  x.strokeStyle = '#c040c0'; x.setLineDash([8, 6]); x.lineWidth = 2;
  x.beginPath(); [[bt.x0, bt.z - 29.3], [bt.x1, bt.z - 29.3], [bt.x1, bt.z + 29.3], [bt.x0, bt.z + 29.3]].forEach(([X, Z], i) => { const [a, b] = tv(X, Z); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.closePath(); x.stroke(); x.setLineDash([]);
  // other ships
  for (const t of radarTargets()) { const [a, b] = tv(t.x, t.z); x.save(); x.translate(a, b); x.rotate(t.psi - s.psi); x.fillStyle = 'rgba(120,140,150,0.6)'; x.fillRect(-t.B / 2 * sc, -t.L / 2 * sc, t.B * sc, t.L * sc); x.restore(); }
  // own ship
  x.save(); x.translate(cx, cy); x.fillStyle = 'rgba(66,176,213,0.35)'; x.strokeStyle = P.acc; x.lineWidth = 2.5; x.beginPath();
  shipPoly().forEach(([f, sb], i) => (i ? x.lineTo(sb * sc, -f * sc) : x.moveTo(sb * sc, -f * sc))); x.closePath(); x.fill(); x.stroke();
  // transverse speed arrows
  const vb = s.transverse(180), vs = s.transverse(-180);
  const arr = (y, v) => { const L = clamp(v * 300, -150, 150); x.strokeStyle = Math.abs(v) > 0.2 ? P.bad : P.good; x.lineWidth = 5; x.beginPath(); x.moveTo(0, y); x.lineTo(L, y); x.stroke(); x.beginPath(); x.moveTo(L, y); x.lineTo(L - Math.sign(L) * 12, y - 8); x.lineTo(L - Math.sign(L) * 12, y + 8); x.closePath(); x.fillStyle = x.strokeStyle; if (Math.abs(L) > 4) x.fill(); };
  arr(-170 * sc, vb); arr(170 * sc, vs);
  // tug force vectors
  s.tugs.forEach((tg) => { if (!tg.attached) return; const F = tg.power; const a = tg.dir * DEG; const y = -tg.xb * sc; x.strokeStyle = '#f07a1c'; x.lineWidth = 4; x.beginPath(); x.moveTo(0, y); x.lineTo(Math.sin(a) * F * 120, y - Math.cos(a) * F * 120); x.stroke(); });
  // thruster
  const bt2 = (s.bowThr[0] + s.bowThr[1]) / 2; if (Math.abs(bt2) > 0.02) { x.strokeStyle = '#ffd54a'; x.lineWidth = 4; x.beginPath(); x.moveTo(0, -172 * sc); x.lineTo(bt2 * 90, -172 * sc); x.stroke(); }
  x.restore();
  x.restore();
  // side panel
  const px0 = 880, pw = W - px0;
  x.fillStyle = P.panel; x.fillRect(px0, 0, pw, H);
  let y = 44;
  txt(x, 'DOCKING', px0 + 18, y, { s: 24, w: 800, c: P.hi }); y += 20;
  txt(x, bi ? 'Quay ' + bi.q.id + ' · ' + bi.side + ' side to' : 'No quay in range', px0 + 18, y + 10, { s: 15, c: P.dim }); y += 50;
  const row = (k, v, col, big) => { txt(x, k, px0 + 18, y, { s: 15, c: P.dim, w: 700 }); txt(x, v, px0 + pw - 18, y, { s: big ? 26 : 20, c: col || P.text, a: 'right', f: MONO, w: big ? 800 : 600 }); y += big ? 40 : 30; };
  if (bi && bi.dc < 900) {
    row('FWD  dist', bi.bow.d.toFixed(1) + ' m', bi.bow.d < 5 ? P.warn : P.text, true);
    row('FWD  appr', (bi.bow.vIn * 100).toFixed(0) + ' cm/s', bi.bow.vIn > 0.15 ? P.bad : P.good, true);
    row('AFT  dist', bi.stern.d.toFixed(1) + ' m', bi.stern.d < 5 ? P.warn : P.text, true);
    row('AFT  appr', (bi.stern.vIn * 100).toFixed(0) + ' cm/s', bi.stern.vIn > 0.15 ? P.bad : P.good, true);
    row('ANGLE', bi.angle.toFixed(1) + '°', Math.abs(bi.angle) > 5 ? P.warn : P.text);
    if (bi.berthOff !== null) row('TO B4 MARK', (bi.berthOff > 0 ? 'fwd ' : 'aft ') + Math.abs(bi.berthOff * Math.sign(Math.sin(s.psi))).toFixed(0) + ' m', Math.abs(bi.berthOff) > 30 ? P.warn : P.good);
  }
  y += 6;
  row('LONG SPD', (s.u / KN).toFixed(2) + ' kn');
  row('ROT', s.rotDegMin.toFixed(1) + '°/min');
  row('HDG', pad(s.psi / DEG) + '°');
  const rw = s._windRel || { speed: 0 };
  row('WIND', pad(s.windFrom / DEG) + '° / ' + (s.windSpeed / KN).toFixed(0) + ' kn');
  txt(x, 'Safe contact < 15 cm/s', px0 + 18, H - 20, { s: 14, c: P.dim });
}

// ============================================================= ENGINE / TUG / AUTOPILOT / STEER
function drawEngine(x, W, H) {
  const P = pal(), s = G.ship;
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  txt(x, 'MAIN ENGINES  2 × MAN B&W 8S80ME-C9', 24, 44, { s: 26, w: 800, c: P.hi });
  txt(x, 'Bridge control · ' + (s.engineMode === 'STANDBY' ? 'STAND-BY' : s.engineMode), 24, 76, { s: 18, c: s.engineMode === 'STANDBY' ? P.good : P.warn, w: 700 });
  for (const [k, cx] of [[0, 330], [1, 950]]) {
    const ord = TELEGRAPH[s.tele[k]].rpm;
    arcGauge(x, cx, 440, 220, s.rpm[k], -60, 80, Math.PI * 0.75, Math.PI * 2.25, P, { lw: 16, ticks: 7, labels: ['60', '40', '20', '0', '20', '40', '60', '80'], order: ord, zones: [[-60, 0, 'rgba(255,90,79,0.3)'], [0, 80, 'rgba(111,224,138,0.3)']] });
    txt(x, (k ? 'STBD' : 'PORT') + ' ENGINE', cx, 150, { s: 20, c: P.dim, a: 'center', w: 800 });
    txt(x, fmt(s.rpm[k], 0), cx, 580, { s: 64, w: 800, c: P.hi, a: 'center', f: MONO });
    txt(x, 'RPM', cx, 614, { s: 18, c: P.dim, a: 'center' });
    x.fillStyle = ord < 0 ? '#5a1814' : ord > 0 ? '#154a26' : '#2a3036'; x.fillRect(cx - 190, 650, 380, 70);
    txt(x, TELEGRAPH[s.tele[k]].label, cx, 697, { s: 30, w: 800, c: '#fff', a: 'center' });
    if (s.reverseDelay[k] > 0) txt(x, 'STARTING ON AIR…', cx, 760, { s: 20, c: P.warn, a: 'center', w: 700 });
  }
  txt(x, 'Start air ' + (30 - Math.min(20, s.startAirUses * 0.8)).toFixed(1) + ' bar  ·  Telegraphs ' + (G.splitEngines ? 'SPLIT' : 'COMBINED'), W / 2, H - 30, { s: 20, c: P.dim, a: 'center' });
}
function drawTugDisplay(x, W, H) {
  const P = pal(), s = G.ship;
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  txt(x, 'TUGS  ·  VHF 12', 24, 46, { s: 28, w: 800, c: P.hi });
  const cx = 360, cy = 470, sc = 0.9;
  x.fillStyle = 'rgba(66,176,213,0.25)'; x.strokeStyle = P.acc; x.lineWidth = 3; x.beginPath();
  shipPoly().forEach(([f, sb], i) => (i ? x.lineTo(cx + sb * sc, cy - f * sc) : x.moveTo(cx + sb * sc, cy - f * sc))); x.closePath(); x.fill(); x.stroke();
  const tugsState = typeof TUGS !== 'undefined' ? TUGS.list : [];
  s.tugs.forEach((tg, i) => {
    const y0 = cy - tg.xb * sc;
    const st = tugsState[i];
    if (tg.attached) { const a = tg.dir * DEG, L = 60 + tg.power * 120; x.strokeStyle = '#f07a1c'; x.lineWidth = 6; x.beginPath(); x.moveTo(cx, y0); x.lineTo(cx + Math.sin(a) * L, y0 - Math.cos(a) * L); x.stroke(); }
    const lbl = st ? st.name + ' — ' + st.state : '—';
    txt(x, (i ? 'AFT: ' : 'FWD: ') + lbl, 720, 140 + i * 230, { s: 24, w: 800, c: tg.attached ? P.good : P.text });
    if (tg.attached) { txt(x, 'Direction ' + dirName(tg.dirCmd) + '  (' + Math.round(tg.dir) + '°)', 720, 180 + i * 230, { s: 20, c: P.text, f: MONO }); txt(x, 'Power ' + Math.round(tg.power * 100) + ' %  → ' + Math.round(tg.powerCmd * 100) + ' %', 720, 214 + i * 230, { s: 20, c: P.text, f: MONO }); txt(x, 'Force ' + (s.forceLog.tugs[i] / 9810).toFixed(0) + ' t', 720, 248 + i * 230, { s: 20, c: P.dim, f: MONO }); }
  });
  txt(x, G.tugAuto ? 'PILOT CONTROLLING TUGS' : 'Tug orders: T key or TUGS button', 720, H - 40, { s: 20, c: G.tugAuto ? P.good : P.dim, w: 700 });
}
function dirName(d) { d = wrap360(d); return d < 20 || d > 340 ? 'AHEAD' : d < 160 ? 'TO STBD' : d < 200 ? 'ASTERN' : 'TO PORT'; }
function drawAutopilot(x, W, H) {
  const P = pal(), s = G.ship;
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  txt(x, 'AUTOPILOT', 24, 44, { s: 26, w: 800, c: P.hi });
  txt(x, G.steering, W - 24, 44, { s: 26, w: 800, c: G.steering === 'AUTO' ? P.good : P.warn, a: 'right' });
  txt(x, 'SET HDG', 24, 110, { s: 18, c: P.dim, w: 700 }); txt(x, pad(G.apHeading) + '°', 24, 190, { s: 84, w: 800, c: G.steering === 'AUTO' ? P.hi : P.dim, f: MONO });
  txt(x, 'ACT HDG', 440, 110, { s: 18, c: P.dim, w: 700 }); txt(x, pad(s.psi / DEG) + '°', 440, 190, { s: 84, w: 800, c: P.text, f: MONO });
  txt(x, 'RUD LIM ' + G.apRudderLimit + '°   ROT LIM ' + G.apRot + '°/min   HDG CTRL', 24, 260, { s: 20, c: P.dim, f: MONO });
  const err = wrap180(G.apHeading - s.psi / DEG);
  if (G.steering === 'AUTO' && Math.abs(err) > 10) { x.fillStyle = P.bad; x.fillRect(20, 300, W - 40, 60); txt(x, 'OFF HEADING ' + err.toFixed(0) + '°', W / 2, 342, { s: 30, w: 800, c: '#fff', a: 'center' }); }
  else txt(x, 'RUDDER ' + (s.rudder < 0 ? 'P ' : 'S ') + Math.abs(s.rudder).toFixed(1) + '°   ORDER ' + s.rudderCmd.toFixed(1) + '°', 24, 340, { s: 22, c: P.text, f: MONO });
  txt(x, '±1° / ±10° buttons · ← → keys', 24, H - 30, { s: 18, c: P.dim });
}
function drawSteer(x, W, H) {
  const P = pal(), s = G.ship;
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  arcGauge(x, 210, 300, 170, s.rudder, -40, 40, Math.PI * 1.2, Math.PI * 1.8, P, { lw: 14, ticks: 8, labels: ['40', '30', '20', '10', '0', '10', '20', '30', '40'], zones: [[-40, 0, 'rgba(255,90,79,0.35)'], [0, 40, 'rgba(111,224,138,0.35)']], order: G.steering === 'HAND' ? G.helmOrder : s.rudderCmd });
  txt(x, 'RUDDER', 210, 360, { s: 18, c: P.dim, a: 'center', w: 800 });
  txt(x, (s.rudder < -0.5 ? 'P ' : s.rudder > 0.5 ? 'S ' : '') + Math.abs(s.rudder).toFixed(0) + '°', 210, 420, { s: 44, w: 800, c: P.hi, a: 'center', f: MONO });
  arcGauge(x, 590, 300, 170, s.rotDegMin, -30, 30, Math.PI * 1.2, Math.PI * 1.8, P, { lw: 14, ticks: 6, labels: ['30', '20', '10', '0', '10', '20', '30'], zones: [[-30, 0, 'rgba(255,90,79,0.35)'], [0, 30, 'rgba(111,224,138,0.35)']] });
  txt(x, 'ROT °/min', 590, 360, { s: 18, c: P.dim, a: 'center', w: 800 });
  txt(x, s.rotDegMin.toFixed(1), 590, 420, { s: 44, w: 800, c: P.hi, a: 'center', f: MONO });
  txt(x, 'HDG ' + pad(s.psi / DEG) + '°   MODE ' + G.steering, W / 2, 50, { s: 30, w: 800, c: P.text, a: 'center', f: MONO });
}

// ============================================================= OVERHEAD
function drawOverhead(x, W, H) {
  // hanging cluster of classic white-faced analogue repeaters (as fitted on the Triple-E)
  const s = G.ship, night = ENV.night;
  const face = night ? '#2a1d0e' : '#f3f2ec', ink = night ? '#d89a40' : '#15181a', red = night ? '#b0502a' : '#c8102e', grn = night ? '#6a8a3a' : '#1e8a3c';
  x.fillStyle = '#3a4046'; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,255,255,0.05)'; x.fillRect(0, 0, W, 4);
  const cw = W / 10, r = Math.min(cw, H) / 2 - 14, cy = H / 2;
  const bezel = (cx) => {
    x.fillStyle = '#15181b'; x.beginPath(); x.arc(cx, cy, r + 10, 0, 7); x.fill();
    const g = x.createLinearGradient(0, cy - r, 0, cy + r); g.addColorStop(0, '#9aa1a6'); g.addColorStop(1, '#4b5256');
    x.strokeStyle = g; x.lineWidth = 5; x.beginPath(); x.arc(cx, cy, r + 6, 0, 7); x.stroke();
    x.fillStyle = face; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  };
  const dial = (i, title, v, min, max, lab, zones, labels) => {
    const cx = i * cw + cw / 2; bezel(cx);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    if (zones) for (const [z0, z1, col] of zones) { x.strokeStyle = col; x.lineWidth = 7; x.beginPath(); x.arc(cx, cy, r - 8, a0 + (a1 - a0) * (z0 - min) / (max - min), a0 + (a1 - a0) * (z1 - min) / (max - min)); x.stroke(); }
    x.strokeStyle = ink;
    for (let k = 0; k <= 20; k++) { const a = a0 + (a1 - a0) * k / 20, big = k % 5 === 0; x.lineWidth = big ? 3 : 1.5; x.beginPath(); x.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); x.lineTo(cx + Math.cos(a) * (r - (big ? 20 : 12)), cy + Math.sin(a) * (r - (big ? 20 : 12))); x.stroke();
      if (big && labels) { x.fillStyle = ink; x.font = `600 13px ${SANS}`; x.textAlign = 'center'; x.fillText(labels[k / 5], cx + Math.cos(a) * (r - 34), cy + Math.sin(a) * (r - 34) + 5); } }
    x.fillStyle = ink; x.font = `700 12px ${SANS}`; x.textAlign = 'center'; x.fillText(title, cx, cy - r * 0.32);
    x.font = `800 17px ${MONO}`; x.fillText(lab, cx, cy + r * 0.5);
    const a = a0 + (a1 - a0) * (clamp(v, min, max) - min) / (max - min);
    x.strokeStyle = night ? '#e0a040' : '#111'; x.lineWidth = 4; x.lineCap = 'round'; x.beginPath(); x.moveTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12); x.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); x.stroke(); x.lineCap = 'butt';
    x.fillStyle = '#222'; x.beginPath(); x.arc(cx, cy, 7, 0, 7); x.fill();
  };
  const lcd = (i, title, val, unit) => {
    const cx = i * cw + cw / 2; bezel(cx);
    x.fillStyle = ink; x.font = `700 12px ${SANS}`; x.textAlign = 'center'; x.fillText(title, cx, cy - r * 0.45);
    x.fillStyle = night ? '#140c04' : '#1b2126'; x.fillRect(cx - r * 0.72, cy - 20, r * 1.44, 44);
    x.fillStyle = night ? '#e09030' : '#ff5a3c'; x.font = `800 34px ${MONO}`; x.fillText(val, cx, cy + 14);
    x.fillStyle = ink; x.font = `600 12px ${SANS}`; x.fillText(unit, cx, cy + r * 0.6);
  };
  const rz = [[-40, 0, red], [0, 40, grn]];
  dial(0, 'RUDDER P', s.rudder, -40, 40, (s.rudder < 0 ? 'P' : 'S') + Math.abs(s.rudder).toFixed(0) + '°', rz, ['40', '20', '0', '20', '40']);
  dial(1, 'RUDDER S', s.rudder, -40, 40, (s.rudder < 0 ? 'P' : 'S') + Math.abs(s.rudder).toFixed(0) + '°', rz, ['40', '20', '0', '20', '40']);
  dial(2, 'RATE OF TURN', s.rotDegMin, -30, 30, s.rotDegMin.toFixed(1), [[-30, 0, red], [0, 30, grn]], ['30', '15', '0', '15', '30']);
  lcd(3, 'HEADING', pad(s.psi / DEG) + '°', 'GYRO 1');
  lcd(4, 'SPEED LOG', fmt(s.u / KN, 1), 'kn  (SOG ' + fmt(s.sog / KN, 1) + ')');
  dial(5, 'RPM PORT', s.rpm[0], -60, 80, fmt(s.rpm[0], 0), [[-60, 0, red], [0, 80, grn]], ['60', '25', '10', '45', '80']);
  dial(6, 'RPM STBD', s.rpm[1], -60, 80, fmt(s.rpm[1], 0), [[-60, 0, red], [0, 80, grn]], ['60', '25', '10', '45', '80']);
  { // wind: rose with true-wind arrow relative to the bow
    const cx = 7 * cw + cw / 2; bezel(cx);
    x.strokeStyle = ink; for (let d = 0; d < 360; d += 10) { const a = d * DEG - Math.PI / 2; x.lineWidth = d % 30 ? 1 : 2.5; x.beginPath(); x.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); x.lineTo(cx + Math.cos(a) * (r - (d % 30 ? 10 : 16)), cy + Math.sin(a) * (r - (d % 30 ? 10 : 16))); x.stroke(); }
    x.fillStyle = ink; x.font = `700 12px ${SANS}`; x.textAlign = 'center'; x.fillText('WIND REL', cx, cy - r * 0.32);
    const rw = s._windRel || { speed: 0, angle: 0 }; const from = Math.atan2(-Math.sin(rw.angle), -Math.cos(rw.angle));
    x.save(); x.translate(cx, cy); x.rotate(from); x.fillStyle = night ? '#e0a040' : '#1c3f94'; x.beginPath(); x.moveTo(0, -r + 18); x.lineTo(9, -r + 40); x.lineTo(2, -r + 40); x.lineTo(2, 0); x.lineTo(-2, 0); x.lineTo(-2, -r + 40); x.lineTo(-9, -r + 40); x.fill(); x.restore();
    x.fillStyle = ink; x.font = `800 16px ${MONO}`; x.fillText((rw.speed / KN).toFixed(0) + ' kn', cx, cy + r * 0.55);
  }
  lcd(8, 'DEPTH U/KEEL', fmt(s.depthUnder - s.S.T, 1), 'metres');
  { // analogue clock
    const cx = 9 * cw + cw / 2; bezel(cx);
    x.strokeStyle = ink; for (let k = 0; k < 60; k++) { const a = k / 60 * Math.PI * 2; x.lineWidth = k % 5 ? 1 : 3; x.beginPath(); x.moveTo(cx + Math.sin(a) * (r - 4), cy - Math.cos(a) * (r - 4)); x.lineTo(cx + Math.sin(a) * (r - (k % 5 ? 9 : 16)), cy - Math.cos(a) * (r - (k % 5 ? 9 : 16))); x.stroke(); }
    const [h, m, sec] = nowClock();
    const hand = (a, len, w, col) => { x.strokeStyle = col; x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len); x.stroke(); x.lineCap = 'butt'; };
    hand(((h % 12) + m / 60) / 12 * Math.PI * 2, r * 0.5, 6, ink); hand((m + sec / 60) / 60 * Math.PI * 2, r * 0.78, 3.5, ink); hand(sec / 60 * Math.PI * 2, r * 0.85, 1.5, red);
    x.fillStyle = ink; x.font = `700 11px ${SANS}`; x.textAlign = 'center'; x.fillText('SHIP TIME', cx, cy + r * 0.45);
  }
}
function drawEcho(x, W, H) {
  const P = pal(), s = G.ship;
  const st = drawEcho.st || (drawEcho.st = { hist: [] });
  st.hist.push(s.depthUnder); if (st.hist.length > 220) st.hist.shift();
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  txt(x, 'ECHO SOUNDER  50 kHz · FWD', 20, 36, { s: 20, w: 800, c: P.hi });
  const gx = 20, gy = 60, gw = W - 260, gh = H - 80, maxD = 40;
  x.strokeStyle = P.line; x.strokeRect(gx, gy, gw, gh);
  for (let d = 0; d <= maxD; d += 10) { const y = gy + d / maxD * gh; x.fillStyle = P.line; x.fillRect(gx, y, gw, 1); txt(x, d + 'm', gx + gw + 6, y + 5, { s: 14, c: P.dim }); }
  x.fillStyle = ENV.night ? '#6a3a10' : '#c05020';
  st.hist.forEach((d, i) => { const px = gx + i / 220 * gw, y = gy + clamp(d, 0, maxD) / maxD * gh; x.fillRect(px, y, gw / 220 + 1, gy + gh - y); });
  x.fillStyle = P.warn; const ky = gy + (s.S.T + s.squat) / maxD * gh; x.fillRect(gx, ky, gw, 2); txt(x, 'keel+squat', gx + 8, ky - 6, { s: 13, c: P.warn });
  txt(x, fmt(s.depthUnder - s.S.T, 1), W - 120, 160, { s: 60, w: 800, c: s.ukc < 2 ? P.bad : P.hi, a: 'center', f: MONO });
  txt(x, 'm below keel', W - 120, 190, { s: 15, c: P.dim, a: 'center' });
  txt(x, 'ALARM 2.0 m', W - 120, 240, { s: 16, c: P.dim, a: 'center' });
}
function drawVHF(x, W, H) {
  x.fillStyle = ENV.night ? '#1b1206' : '#9fb88a'; x.fillRect(0, 0, W, H);
  x.fillStyle = ENV.night ? '#e09030' : '#1c2a14';
  x.font = `800 70px ${MONO}`; x.textAlign = 'left'; x.fillText(String(G.vhfCh).padStart(2, '0'), 20, 86);
  x.font = `700 20px ${MONO}`; x.fillText('25W  DSC', 150, 44); x.fillText(({ 11: 'VTS', 12: 'TUGS', 14: 'PILOT', 16: 'DISTRESS', 13: 'BR-BR' })[G.vhfCh] || 'INT', 150, 76); x.fillText('SQL ▮▮▮', 150, 108);
}
function drawClock(x, W, H) {
  const P = pal(), s = G.ship;
  x.fillStyle = '#05080b'; x.fillRect(0, 0, W, H);
  txt(x, clockStr(), W / 2, 110, { s: 86, w: 800, c: ENV.night ? '#e09030' : '#ff5a3c', a: 'center', f: MONO });
  const [h, m] = nowClock();
  txt(x, 'LT (UTC+2)   UTC ' + String((h + 22) % 24).padStart(2, '0') + ':' + String(m).padStart(2, '0'), W / 2, 170, { s: 26, c: P.dim, a: 'center', f: MONO });
  txt(x, 'Time ×' + G.timeScale, W / 2, 214, { s: 22, c: P.dim, a: 'center' });
}
function drawGMDSS(x, W, H) {
  const P = pal();
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  txt(x, 'GMDSS  A3 · MF/HF DSC · Inm-C', 16, 34, { s: 20, w: 800, c: P.hi });
  ['DSC watch 2187.5 / 8414.5 kHz', 'Ch 70 watch: ON', 'Last test: ' + (new Date().getDate()) + ' days ago OK', 'Inmarsat-C: LOGGED IN (AOR-E)', 'EPIRB: armed, next service 03/27', 'SART ×2 · VHF GMDSS handhelds ×3'].forEach((l, i) => txt(x, l, 16, 80 + i * 40, { s: 19, c: P.text, f: MONO }));
}
function drawNavtex(x, W, H) {
  const P = pal();
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  txt(x, 'NAVTEX 518 kHz — station P', 16, 34, { s: 20, w: 800, c: P.hi });
  ['PA41 NAV WARNING WESTERHAVEN', 'DREDGING OPS SOUTH OF W5 BUOY,', 'KEEP CLEAR. VESSELS < 12KN.', '', 'PE72 WEATHER: SW 4-5 VEER W 6', 'LATER. SEA 1.5 M. VIS GOOD.'].forEach((l, i) => txt(x, l, 16, 80 + i * 40, { s: 19, c: P.text, f: MONO }));
}
function drawBAMS(x, W, H) {
  const P = pal();
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  txt(x, 'BRIDGE ALERT MANAGEMENT', 24, 44, { s: 26, w: 800, c: P.hi });
  txt(x, clockStr(), W - 24, 44, { s: 22, c: P.dim, a: 'right', f: MONO });
  const rows = Object.keys(ALARMS.active).map((k) => [ALARMS.active[k].level === 'alarm' ? 'ALARM' : 'WARNING', ALARMS.active[k].text, ALARMS.acked[k] ? 'ACK' : 'ACTIVE']);
  rows.push(['CAUTION', 'Gyro 1 / Gyro 2 difference 0.3°', 'INFO'], ['CAUTION', 'Engine: aux blower 2 auto start', 'INFO']);
  rows.forEach(([lvl, t, st], i) => {
    const y = 90 + i * 52; x.fillStyle = lvl === 'ALARM' ? 'rgba(255,90,79,0.25)' : lvl === 'WARNING' ? 'rgba(255,201,74,0.18)' : 'rgba(79,195,247,0.12)'; x.fillRect(20, y, W - 40, 44);
    txt(x, lvl, 36, y + 30, { s: 18, w: 800, c: lvl === 'ALARM' ? P.bad : lvl === 'WARNING' ? P.warn : P.acc }); txt(x, t, 190, y + 30, { s: 19, c: P.text }); txt(x, st, W - 40, y + 30, { s: 17, c: P.dim, a: 'right', f: MONO });
  });
}
function drawCCTV(x, W, H) {
  const s = G.ship, cams = ['CAM 01 FWD MOORING', 'CAM 02 AFT MOORING', 'CAM 07 HOLD 3', 'CAM 11 ENGINE ROOM'];
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  cams.forEach((c, i) => {
    const cx = (i % 2) * W / 2, cy = Math.floor(i / 2) * H / 2, w = W / 2 - 4, h = H / 2 - 4;
    const g = x.createLinearGradient(0, cy, 0, cy + h);
    if (i < 2) { g.addColorStop(0, '#8fa2ad'); g.addColorStop(0.45, '#6b7c86'); g.addColorStop(0.46, '#3e4c3f'); g.addColorStop(1, '#2d3a31'); }
    else if (i === 2) { g.addColorStop(0, '#2a2f33'); g.addColorStop(1, '#101316'); }
    else { g.addColorStop(0, '#4a4c40'); g.addColorStop(1, '#23241e'); }
    x.fillStyle = g; x.fillRect(cx + 2, cy + 2, w, h);
    if (i < 2) { x.fillStyle = '#c9b200'; x.fillRect(cx + w * 0.2, cy + h * 0.62, w * 0.12, h * 0.1); x.fillRect(cx + w * 0.6, cy + h * 0.66, w * 0.1, h * 0.08); const st = i === 0 ? G.flags.fwdStation : G.flags.aftStation; if (st) for (let k = 0; k < 3; k++) { x.fillStyle = '#e06a1a'; x.fillRect(cx + w * (0.35 + k * 0.1), cy + h * 0.5, 8, 22); x.fillStyle = '#fff'; x.fillRect(cx + w * (0.35 + k * 0.1), cy + h * 0.5 - 6, 8, 6); } }
    if (i === 2) for (let k = 0; k < 6; k++) { x.fillStyle = ['#3f97c7', '#a8382a', '#3f97c7', '#dcdcd8', '#3f97c7', '#1d7244'][k]; x.fillRect(cx + 20 + k * 78, cy + h * 0.35, 70, h * 0.5); }
    if (i === 3) { x.fillStyle = '#6e7060'; x.fillRect(cx + w * 0.2, cy + h * 0.2, w * 0.6, h * 0.6); x.fillStyle = '#9a9c8a'; for (let k = 0; k < 8; k++) x.fillRect(cx + w * 0.22 + k * w * 0.07, cy + h * 0.25, w * 0.04, h * 0.5); }
    for (let k = 0; k < 500; k++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; x.fillRect(cx + Math.random() * w, cy + Math.random() * h, 2, 2); }
    x.fillStyle = '#fff'; x.font = `700 16px ${MONO}`; x.fillText(c, cx + 12, cy + 24); x.fillText(clockStr(), cx + w - 100, cy + 24);
  });
}
function drawOffice(x, W, H) {
  x.fillStyle = '#eef1f4'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#0b2b3d'; x.fillRect(0, 0, W, 50); txt(x, 'Voyage orders — MAJESTIC MAERSK · Voy 2641W', 16, 33, { s: 20, w: 700, c: '#fff' });
  ['Rotation: Tanjung Pelepas → Suez → Algeciras → WESTERHAVEN → Bremerhaven', 'Arrival draft 14.5 m even keel · 17 842 TEU on board · 1 402 reefers', 'Berth 4 Deepsea Terminal, port side alongside, 4 STS cranes', 'ETB 09:30 LT · cargo ops 26 h · ETD tomorrow 13:00', 'Bunkers: 4 600 t VLSFO · no bunkering this call', 'Crew change: 2 on / 2 off via agent at berth'].forEach((l, i) => txt(x, l, 20, 100 + i * 50, { s: 20, c: '#223' }));
}
function drawFire(x, W, H) {
  const P = pal();
  x.fillStyle = '#1a1c1e'; x.fillRect(0, 0, W, H);
  txt(x, 'FIRE DETECTION', 20, 44, { s: 30, w: 800, c: '#fff' });
  for (let i = 0; i < 12; i++) { x.fillStyle = '#1f7a35'; x.beginPath(); x.arc(40 + (i % 6) * 84, 120 + Math.floor(i / 6) * 100, 18, 0, 7); x.fill(); txt(x, 'Z' + (i + 1), 40 + (i % 6) * 84, 170 + Math.floor(i / 6) * 100, { s: 16, c: '#aaa', a: 'center' }); }
  txt(x, 'SYSTEM NORMAL', 20, H - 30, { s: 26, w: 800, c: '#6fe08a' });
}
