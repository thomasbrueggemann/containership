// ============================================================================
// 08 — TRAFFIC: AI vessels, pilot boat, harbour tugs
// ============================================================================
// ------------------------------------------------------------------ hull clearance
// Small craft steer round a hull, never through it. The hull is a convex outline in its own
// body frame (x ahead, y to starboard); a leg that would cross it is routed via the outline's
// corners pushed out by a clearance — the shortest way round, bow or stern. A ship making way
// gets a wider berth ahead of her stem.
const wrapPi = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
function hullHalfBeam(L, B, xb) {
  const sh = 0.276 * L; // end of the parallel mid-body
  return xb > sh ? B / 2 * Math.max(0.05, 1 - Math.pow((xb - sh) / (L / 2 - sh + 6), 1.8)) : B / 2;
}
const _outlines = {};
function hullOutline(L, B) {
  const k = L + ':' + B; if (_outlines[k]) return _outlines[k];
  const hx = L / 2 + 2, sh = 0.276 * L, xs = [-hx, sh, sh + (hx - sh) * 0.45, sh + (hx - sh) * 0.75], pts = [];
  for (const x of xs) pts.push([x, hullHalfBeam(L, B, x)]);
  pts.push([hx, 0]);
  for (let i = xs.length - 1; i >= 0; i--) pts.push([xs[i], -hullHalfBeam(L, B, xs[i])]);
  const edges = pts.map(([ax, ay], i) => {
    const [bx, by] = pts[(i + 1) % pts.length];
    let nx = by - ay, ny = ax - bx; const l = Math.hypot(nx, ny); nx /= l; ny /= l;
    if (nx * (ax + bx) + ny * (ay + by) < 0) { nx = -nx; ny = -ny; } // outward (origin is inside)
    return { ax, ay, nx, ny };
  });
  return (_outlines[k] = { pts, edges });
}
const inHull = (o, x, y) => o.edges.every((e) => e.nx * (x - e.ax) + e.ny * (y - e.ay) < 0);
function crossesHull(o, ax, ay, bx, by) { // Cyrus–Beck clip of the leg against the outline
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  let t0 = 0, t1 = 1;
  for (const e of o.edges) {
    const num = e.nx * (e.ax - ax) + e.ny * (e.ay - ay), den = e.nx * dx + e.ny * dy;
    if (Math.abs(den) < 1e-9) { if (num < 0) return false; continue; }
    if (den > 0) t1 = Math.min(t1, num / den); else t0 = Math.max(t0, num / den);
    if ((t1 - t0) * len < 0.5) return false;
  }
  return true;
}
// next point (body frame) to make for on the way from a to b round hull h {L, B, u}; m = clearance
function hullRoute(h, ax, ay, bx, by, m) {
  const o = hullOutline(h.L, h.B);
  if (inHull(o, ax, ay) || inHull(o, bx, by)) return [bx, by];
  // every leg keeps some water between boat and hull; corner-to-corner legs the most. A leg from or
  // to a point already that close (a tug's bow on the plating) need only not cross the hull itself
  const grow = (d) => ({ edges: o.edges.map((e) => ({ ax: e.ax + e.nx * d, ay: e.ay + e.ny * d, nx: e.nx, ny: e.ny })) });
  const wide = grow(m * 0.6), near = grow(m * 0.4), tight = inHull(near, ax, ay) || inHull(near, bx, by);
  if (!crossesHull(tight ? o : near, ax, ay, bx, by)) return [bx, by];
  const nodes = [[ax, ay]], n = o.pts.length, ahead = Math.max(0, h.u || 0) * 20, bow = [false];
  for (let i = 0; i < n; i++) {
    const e1 = o.edges[(i + n - 1) % n], e2 = o.edges[i];
    let vx = e1.nx + e2.nx, vy = e1.ny + e2.ny; const l = Math.hypot(vx, vy); vx /= l; vy /= l;
    const k = m / Math.max(0.35, vx * e2.nx + vy * e2.ny); // mitred corner
    nodes.push([o.pts[i][0] + vx * k + (vx > 0.3 ? ahead : 0), o.pts[i][1] + vy * k]); bow.push(vx > 0.3);
  }
  nodes.push([bx, by]); bow.push(false);
  const legHull = (u, v) => u > 0 && v < N - 1 ? wide : (u === 0 && inHull(near, ax, ay)) || (v === N - 1 && inHull(near, bx, by)) ? o : near;
  const N = nodes.length, dist = new Array(N).fill(Infinity), prev = new Array(N).fill(-1), done = new Array(N).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1; for (let i = 0; i < N; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === N - 1) break;
    done[u] = true;
    for (let v = 1; v < N; v++) {
      if (done[v]) continue;
      // crossing ahead of a ship under way is bad seamanship: go under her stern unless much shorter
      const d = dist[u] + Math.hypot(nodes[v][0] - nodes[u][0], nodes[v][1] - nodes[u][1]) + (bow[v] && !bow[u] ? ahead * 3 : 0);
      if (d < dist[v] && !crossesHull(legHull(u, v), nodes[u][0], nodes[u][1], nodes[v][0], nodes[v][1])) { dist[v] = d; prev[v] = u; }
    }
  }
  if (prev[N - 1] < 0) return [bx, by];
  const path = []; for (let v = N - 1; v > 0; v = prev[v]) path.unshift(v);
  for (const v of path) if (Math.hypot(nodes[v][0] - ax, nodes[v][1] - ay) > 8) return nodes[v];
  return [bx, by];
}
function bodyOf(h, wx, wz) { const dx = wx - h.x, dz = wz - h.z, s = Math.sin(h.psi), c = Math.cos(h.psi); return [dx * s - dz * c, dx * c + dz * s]; }
function worldOf(h, xb, yb) { const s = Math.sin(h.psi), c = Math.cos(h.psi); return [h.x + xb * s + yb * c, h.z - xb * c + yb * s]; }
// course to steer from p toward t with hull h {…, vx, vz ground velocity} in the way, at speed V.
// Legs round the hull (and targets that ride along with it) are steered relative to the moving
// ship, so the boat's track over her doesn't cut the corner while she steams on underneath it.
function steerRound(h, px, pz, tx, tz, m, V, rides = false) {
  const [ax, ay] = bodyOf(h, px, pz), [bx, by] = bodyOf(h, tx, tz);
  const w = hullRoute(h, ax, ay, bx, by, m), [wx, wz] = worldOf(h, w[0], w[1]);
  let dx = wx - px, dz = wz - pz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  if ((rides || w[0] !== bx || w[1] !== by) && V > 0.5) {
    const hv = h.vx * dx + h.vz * dz, disc = hv * hv - (h.vx * h.vx + h.vz * h.vz) + V * V;
    if (disc > 0) { const k = -hv + Math.sqrt(disc); if (k > 0.3) return Math.atan2(h.vx + k * dx, -(h.vz + k * dz)); }
  }
  return Math.atan2(dx, -dz);
}
const ownHull = () => { const s = G.ship; return { x: s.x, z: s.z, psi: s.psi, L: SHIPSPEC.L, B: SHIPSPEC.B, u: s.u, vx: s.vgx, vz: s.vgz }; };

// ------------------------------------------------------------------ tug handling (shared)
// Where an ASD tug made fast at xb on the given side of a hull works for a pull in dirDeg
// (relative, 90 = to starboard). A tug cannot pull a ship toward its own side of the hull, so a
// force pointing across the ship is a push: bow on the shell plating. Otherwise it lies back on
// its towline, facing the ship, line over its bow.
function tugStation(L, B, xb, side, dirDeg, power) {
  const a = dirDeg * DEG, fx = Math.cos(a), fy = Math.sin(a), hb = hullHalfBeam(L, B, xb);
  if (fy * side < -0.3) return { x: xb, y: side * (hb + 16.5), rel: side > 0 ? -Math.PI / 2 : Math.PI / 2, push: true, ax: xb, ay: side * hb };
  const len = 45 + 16 + (1 - power) * 10;
  let y = side * hb + fy * len; if (y * side < hb + 14) y = side * (hb + 14);
  return { x: xb + fx * len, y, rel: a + Math.PI, push: false, ax: xb, ay: side * hb };
}
// keep a tug on station at (gx, gy) of hull h: it moves in the hull's own frame (so it is carried
// along), goes round the ends to change sides, and swings to face its work (rel) once close
function tugGlide(t, h, gx, gy, rel, dt) {
  if (t.bx == null) [t.bx, t.by] = bodyOf(h, t.x, t.z);
  const dGoal = Math.hypot(gx - t.bx, gy - t.by);
  if (dt <= 0) return dGoal;
  const [wx, wy] = hullRoute(h, t.bx, t.by, gx, gy, 20), dw = Math.hypot(wx - t.bx, wy - t.by);
  const step = Math.min(3.5, 0.3 + dGoal * 0.25) * dt;
  if (dw > 1e-6) { const k = Math.min(1, step / dw); t.bx += (wx - t.bx) * k; t.by += (wy - t.by) * k; }
  const [nx, nz] = worldOf(h, t.bx, t.by), vx = (nx - t.x) / dt, vz = (nz - t.z) / dt;
  t.x = nx; t.z = nz; t.sog = Math.hypot(vx, vz);
  const want = dGoal > 60 && t.sog > 0.8 ? Math.atan2(vx, -vz) : h.psi + rel;
  t.psi += clamp(wrapPi(want - t.psi), -0.35 * dt, 0.35 * dt);
  return dGoal;
}
// free running (not on a hull's station): make for (tx, tz) at up to kn knots, round hull h;
// rides = the target moves with that hull (an escort position)
function tugRun(t, h, tx, tz, kn, dt, rides = false) {
  const want = h ? steerRound(h, t.x, t.z, tx, tz, 16, Math.max(t.sog, 2), rides) : Math.atan2(tx - t.x, -(tz - t.z));
  t.bx = null;
  t.psi += clamp(wrapPi(want - t.psi), -0.2 * dt, 0.2 * dt);
  const dist = Math.hypot(tx - t.x, tz - t.z);
  t.sog = lerp(t.sog, Math.min(kn * KN * 1.6, 1 + dist * 0.05), Math.min(1, dt * 0.4));
  t.x += Math.sin(t.psi) * t.sog * dt; t.z -= Math.cos(t.psi) * t.sog * dt;
  return dist;
}
function makeTowline() {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.9 }));
  m.visible = false; scene.add(m); return m;
}
// towline from a fairlead on hull h (body xb, yb at deck height y0) to the tug's bow staple
function setTowline(m, h, xb, yb, y0, t) {
  const [ax, az] = worldOf(h, xb, yb);
  const p0 = new THREE.Vector3(ax, y0, az), p1 = new THREE.Vector3(t.x + Math.sin(t.psi) * 13, 5, t.z - Math.cos(t.psi) * 13);
  m.position.copy(p0).add(p1).multiplyScalar(0.5); m.scale.set(1, p0.distanceTo(p1), 1);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.sub(p0).normalize());
  m.visible = true;
}

const TRAFFIC = {
  ships: [],
  init() {
    if (CFG.traffic === 'off') return;
    // outbound container ship – alongside the south quay, bow east, starboard side to. Soon after
    // we arrive she singles up, her two tugs pull her off and swing her in the basin. VTS holds her
    // there until our pilot is aboard; then she lines up on the channel axis inside the breakwaters
    // and runs straight out the Westgeul
    const hx = buildContainerShip({ L: 300, B: 48, T: 12.5, D: 12.5, hull: '#1c3f7a', boot: '#6a1d1a', name: 'HANSA EXPRESS', deckhouse: 0.8, funnel: 0.8, tiers: 6, seed: 31, style: 'generic', detail: 1, lightLoad: true, funnelColor: '#1c3f7a', palette: ['#1c3f7a', '#1c3f7a', '#243a86', '#dcdcd8', '#a8382a', '#6d7982'] });
    const hz = 760 - FENDER - 24;
    const hansa = this.add({ name: 'HANSA EXPRESS', grp: hx, L: 300, B: 48, x: -450, z: hz, psi: 90 * DEG, speed: 11 * KN, wps: [[-800, 180, 6], [-1150, -120, 7], [-2800, -150, 10], [-8000, -160], [-13000, -170], [-16000, -1600]], wake: 26, accel: 0.035,
      dep: { phase: 'moored', t: 0, v: 0, r: 0, turned: 0, z0: hz }, depTrigger: () => G.simT > 5 });
    hansa.tugs = [['WH ATLAS', 110, [-1020, 640]], ['WH SAMSON', -115, [-1080, 640]]].map(([name, xb, home]) => {
      const t = { name, xb, home, state: 'work', grp: buildTug(name), wake: new Wake({ width: 6, every: 1, life: 120, spread: 0.4, max: 100 }), line: makeTowline(), sog: 0, bx: null, by: null };
      const st = tugStation(300, 48, xb, -1, 270, 0.2);
      [t.x, t.z] = worldOf(hansa, st.x, st.y); t.psi = hansa.psi + st.rel;
      t.grp.position.set(t.x, 0, t.z); t.grp.rotation.y = -t.psi; scene.add(t.grp);
      return t;
    });
    // fishing vessel
    const fv = buildSmallVessel('ZEEVAART UK-47', '#2d5a8a', 34, 8);
    this.add({ name: 'UK-47 ZEEVAART', grp: fv, L: 34, B: 8, x: -8200, z: 1900, psi: 60 * DEG, speed: 3.5 * KN, wander: { x0: -10500, x1: -5500, z0: 1300, z1: 3200 }, wake: 5 });
    // harbour patrol
    const pb = buildSmallVessel('PATROL 4', '#e8e8e8', 22, 6, '#1f5fa0');
    this.add({ name: 'RPA 4', grp: pb, L: 22, B: 6, x: 400, z: 380, psi: 270 * DEG, speed: 5 * KN, circle: { cx: 200, cz: 380, r: 260 }, wake: 4 });
    // yacht far south
    const yt = buildSmallVessel('BLUE WIND', '#f4f4f4', 14, 4);
    this.add({ name: 'BLUE WIND', grp: yt, L: 14, B: 4, x: -6000, z: 3800, psi: 250 * DEG, speed: 5 * KN, wander: { x0: -9000, x1: -3500, z0: 3200, z1: 5200 }, wake: 2 });
  },
  add(o) {
    o.active = !o.trigger; o.wpi = 0; o.cog = o.psi; o.cruise = o.speed; o.sog = o.active && !o.dep ? o.speed : 0;
    o.grp.visible = o.active;
    o.grp.position.set(o.x, 0, o.z); o.grp.rotation.y = -o.psi;
    scene.add(o.grp);
    o.wakeObj = new Wake({ width: o.wake, every: 2, life: 180, spread: 0.3, max: 90 });
    this.ships.push(o);
    return o;
  },
  update(dt) {
    for (const o of this.ships) {
      if (!o.active) { if (o.trigger && o.trigger()) { o.active = true; o.grp.visible = true; o.sog = o.speed; SCN.onTraffic(o); } continue; }
      if (o.dep && o.dep.phase !== 'done') this.depart(o, dt);
      else {
        let tx, tz;
        if (o.wps) { const w = o.wps[o.wpi]; if (!w) { o.active = false; o.done = true; o.trigger = null; o.grp.visible = false; continue; } tx = w[0]; tz = w[1]; o.speed = w[2] ? w[2] * KN : o.cruise; if (Math.hypot(tx - o.x, tz - o.z) < 150) o.wpi++; }
        else if (o.wander) { if (!o.tgt || Math.hypot(o.tgt[0] - o.x, o.tgt[1] - o.z) < 60) o.tgt = [rr(o.wander.x0, o.wander.x1), rr(o.wander.z0, o.wander.z1)]; [tx, tz] = o.tgt; }
        else if (o.circle) { const a = Math.atan2(o.z - o.circle.cz, o.x - o.circle.cx) + 0.25; tx = o.circle.cx + Math.cos(a) * o.circle.r; tz = o.circle.cz + Math.sin(a) * o.circle.r; }
        const want = Math.atan2(tx - o.x, -(tz - o.z));
        o.psi += clamp(wrapPi(want - o.psi), -0.012 * dt * (o.L < 60 ? 4 : 1), 0.012 * dt * (o.L < 60 ? 4 : 1));
        o.sog += clamp(o.speed - o.sog, -(o.accel || 0.015) * dt, (o.accel || 0.015) * dt);
        o.x += Math.sin(o.psi) * o.sog * dt; o.z -= Math.cos(o.psi) * o.sog * dt;
        o.cog = o.psi;
      }
      if (o.tugs) this.harbourTugs(o, dt);
      const bob = seaState().bob, small = o.L < 60;
      rideSwell(o.grp, o.x, o.z, o.psi, o.L, o.B, small ? Math.sin(G.simT * 0.8 + o.L) * 0.1 * bob : 0, small ? Math.sin(G.simT * 1.3 + o.L) * 0.02 * bob : 0);
      o.wakeObj.update(dt, o.x - Math.sin(o.psi) * o.L / 2, o.z + Math.cos(o.psi) * o.L / 2, -Math.sin(o.psi), Math.cos(o.psi), clamp(o.sog / 4, 0, 0.8), o.sog);
      // collision with own ship
      const s = G.ship; const dist = Math.hypot(o.x - s.x, o.z - s.z);
      if (dist < 200 + o.L / 2) {
        for (const [xb, yb] of s._hullPts) {
          const [px, pz] = s.toWorld(xb, yb);
          const dx = px - o.x, dz = pz - o.z;
          const a = dx * Math.sin(o.psi) - dz * Math.cos(o.psi), b = dx * Math.cos(o.psi) + dz * Math.sin(o.psi);
          if (Math.abs(a) < o.L / 2 && Math.abs(b) < o.B / 2) { SCN.collision(o.name, Math.hypot(s.vgx - Math.sin(o.psi) * o.sog, s.vgz + Math.cos(o.psi) * o.sog)); break; }
        }
      }
    }
  },
  // unberthing: single up, tugs pull her bodily off the quay, swing her 180° to port in the basin
  // (bow tug pulling the bow off, stern tug pushing the stern in), let go the tugs, proceed
  depart(o, dt) {
    const D = o.dep; D.t += dt;
    let vT = 0, rT = 0;
    if (D.phase === 'moored') { if (o.depTrigger && o.depTrigger()) { D.phase = 'singleup'; D.t = 0; SCN.onTraffic(o); } }
    else if (D.phase === 'singleup') { if (D.t > 30) { D.phase = 'pulloff'; D.t = 0; } }
    else if (D.phase === 'pulloff') {
      const off = D.z0 - o.z;               // metres off the quay (she lies bow east, so off = north)
      vT = -clamp((172 - off) * 0.035, 0.1, 0.85);
      if (off > 166) { D.phase = 'swing'; D.t = 0; }
    } else if (D.phase === 'swing') {
      const rem = 180 - D.turned;
      rT = -clamp(rem * 0.03, 0.1, 0.9) * DEG;
      if (rem < 0.5) {
        o.psi = 270 * DEG; D.r = 0; D.phase = 'hold'; D.t = 0;
        // VTS keeps her in the basin until the inbound has her pilot, so the passing is pilot to pilot
        if (!G.flags.pilotOnBridge) SCN.say('vts', 'HANSA EXPRESS, Westerhaven Traffic: hold in the basin, inbound Majestic Maersk is still embarking her pilot. I will call you.', true);
      }
    } else if (D.phase === 'hold') {
      if (G.flags.pilotOnBridge) {
        if (D.t > 5) SCN.say('vts', 'HANSA EXPRESS, Westerhaven Traffic: Majestic Maersk has her pilot. You may proceed outbound, pass port to port in the Westgeul.', true);
        D.phase = 'done'; D.v = D.r = 0; o.sog = 0; o.wpi = 0; o.tugs.forEach((t) => (t.state = 'home')); return;
      }
    }
    D.v += clamp(vT - D.v, -0.015 * dt, 0.015 * dt);
    D.r += clamp(rT - D.r, -0.02 * DEG * dt, 0.02 * DEG * dt);
    o.x += Math.cos(o.psi) * D.v * dt; o.z += Math.sin(o.psi) * D.v * dt;
    o.psi += D.r * dt; D.turned += Math.abs(D.r) * dt / DEG;
    o.sog = Math.abs(D.v); o.cog = Math.abs(D.v) > 0.02 ? o.psi + (D.v < 0 ? -Math.PI / 2 : Math.PI / 2) : o.psi;
  },
  // the departing ship's own tugs: made fast on her offshore (port) side
  harbourTugs(o, dt) {
    const D = o.dep, moving = D.phase === 'done';
    const h = { x: o.x, z: o.z, psi: o.psi, L: o.L, B: o.B, u: moving ? o.sog : 0, vx: moving ? Math.sin(o.psi) * o.sog : 0, vz: moving ? -Math.cos(o.psi) * o.sog : 0 };
    o.tugs.forEach((t, i) => {
      let power = 0;
      if (t.state === 'work') {
        const ph = D.phase, dir = ph === 'swing' && i === 1 ? 90 : 270;
        power = ph === 'pulloff' ? 0.75 : ph === 'swing' ? 0.85 : 0.15; // holding: lines slack, standing by
        const st = tugStation(o.L, o.B, t.xb, -1, dir, power);
        tugGlide(t, h, st.x, st.y, st.rel, dt);
        if (!st.push) setTowline(t.line, h, st.ax, st.ay, 13, t); else t.line.visible = false;
      } else {
        t.line.visible = false;
        if (t.state === 'home') { if (tugRun(t, h, t.home[0], t.home[1], 7, dt) < 40) t.state = 'berth'; }
        else { t.sog = 0; t.psi += clamp(wrapPi(90 * DEG - t.psi), -0.1 * dt, 0.1 * dt); }
      }
      rideSwell(t.grp, t.x, t.z, t.psi, 32, 12.8, Math.sin(G.simT * 1.4 + i + 2) * 0.08 * seaState().bob);
      t.wake.update(dt, t.x - Math.sin(t.psi) * 16, t.z + Math.cos(t.psi) * 16, -Math.sin(t.psi), Math.cos(t.psi), clamp(t.state === 'work' ? power : t.sog / 6, 0, 1));
    });
  },
};
// AIS/ARPA view of all moving traffic
Object.defineProperty(TRAFFIC, 'aisList', { get() { return TRAFFIC.ships.filter((o) => o.active).map((o) => ({ x: o.x, z: o.z, psi: o.psi, L: o.L, B: o.B, name: o.name, sog: o.sog, cog: o.cog })); } });
TRAFFIC.all = function () {
  const hTugs = []; for (const o of this.ships) if (o.tugs) for (const t of o.tugs) if (t.state !== 'berth') hTugs.push({ x: t.x, z: t.z, psi: t.psi, L: 32, B: 12.8, name: t.name, sog: t.sog, cog: t.psi });
  return this.aisList.concat(TUGS.list.filter((t) => t.state !== 'berth').map((t) => t.ais()), hTugs, PILOTBOAT.active ? [PILOTBOAT.ais()] : []);
};

function buildSmallVessel(name, hullCol, L, B, stripe) {
  const o = { L, B, T: L * 0.1, D: L * 0.08, fc: L * 0.04, rake: 1, hull: hullCol, boot: '#6a1d1a', bootTop: 0.2, detail: 1, name, bowStart: 0.6, sternEnd: 0.1, seed: L };
  const g = new THREE.Group();
  g.add(new THREE.Mesh(hullGeometry(o), new THREE.MeshStandardMaterial({ map: hullTexture(o), roughness: 0.5 })));
  g.add(deckMesh(o, o.D, new THREE.MeshStandardMaterial({ color: 0x777a7a }), 0, 0.9));
  g.add(transomMesh(o, new THREE.MeshStandardMaterial({ color: hullCol })));
  const b = new Batcher(), y0 = o.D;
  const kind = name.startsWith('ZEE') ? 'trawler' : name.startsWith('PATROL') ? 'patrol' : 'yacht';
  const white = plainMat(0xf0f0ee), grey = plainMat(0xc9cdcf, 0.55), dark = plainMat(0x33393d, 0.6, 0.3), black = plainMat(0x151515, 0.95), glass = plainMat(0x1b2833, 0.1, 0.6);
  // deckhouse: a base, glass all round, an overhanging roof – the trawler's forward, the others amidships; the yacht gets a flybridge
  const hw = B * 0.3, hd = L * (kind === 'yacht' ? 0.16 : kind === 'trawler' ? 0.1 : 0.13), cz = kind === 'trawler' ? -L * 0.14 : -L * 0.04;
  const hb = L * (kind === 'yacht' ? 0.05 : 0.045), hg = L * 0.04, ch = hd * 0.45;
  const house = (w, d, z, y, hBase, hGlass, mat) => {
    const p = chamfered(w, d, z, Math.min(w, d) * 0.45);
    b.add(prism(p, y, hBase), mat); b.add(prism(p, y + hBase, hGlass), glass);
    for (const [x, zz] of p) b.box(mat, 0.1, hGlass, 0.1, x, y + hBase + hGlass / 2, zz);
    b.add(prism(chamfered(w + 0.12, d + 0.12, z, Math.min(w, d) * 0.5), y + hBase + hGlass, 0.1), mat);
    return y + hBase + hGlass + 0.1;
  };
  let top = house(hw, hd, cz, y0, hb, hg, white);
  if (kind === 'yacht') top = house(hw * 0.72, hd * 0.6, cz + hd * 0.25, top, hb * 0.7, hg * 0.9, white);
  // mast with radar and a light; funnel and fender belt on the working boats
  const mz = cz + hd * 0.5, mh = L * 0.13;
  b.cyl(kind === 'trawler' ? dark : white, 0.1, 0.14, mh, 0, top + mh / 2, mz, 8);
  b.box(grey, L * 0.04, 0.05, L * 0.025, 0, top + mh * 0.7, mz); b.box(dark, L * 0.06, 0.07, 0.15, 0, top + mh * 0.85, mz);
  if (kind !== 'yacht') {
    b.add(roundBox(B * 0.18, L * 0.07, L * 0.07, 0.15), kind === 'patrol' ? white : dark, MX(0, top + L * 0.025, cz + hd + L * 0.05));
    const ell = []; for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; ell.push(new THREE.Vector3(Math.cos(a) * B * 0.49, y0 - 0.15, Math.sin(a) * L * 0.46 - L * 0.01)); }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ell, true), 40, Math.max(0.12, L * 0.008), 6, true), black);
  }
  if (stripe) b.box(plainMat(stripe), B * 1.01, 0.6, L * 0.3, 0, y0 - 0.4, -L * 0.1);
  if (kind === 'trawler') {
    // working deck aft: net drum, hatch, a gantry over the stern and derrick booms
    b.cyl(dark, L * 0.04, L * 0.04, B * 0.5, 0, y0 + L * 0.05, L * 0.1, 12, 0, 0, Math.PI / 2);
    b.box(dark, B * 0.3, 0.35, L * 0.1, 0, y0 + 0.18, L * 0.28);
    for (const sx of [-1, 1]) b.box(dark, 0.25, L * 0.22, 0.25, sx * B * 0.38, y0 + L * 0.11, L * 0.38);
    b.box(dark, B * 0.8, 0.25, 0.25, 0, y0 + L * 0.22, L * 0.38);
    b.box(dark, 0.25, 0.25, L * 0.35, 0, y0 + L * 0.3, L * 0.2, 0, 0.6);
    b.box(dark, 0.3, L * 0.35, 0.3, 0, y0 + L * 0.17, L * 0.25);
  }
  if (kind === 'yacht') b.add(roundBox(B * 0.5, 0.25, L * 0.12, 0.1), plainMat(0x2b6cb0), MX(0, y0 + 0.3, L * 0.3));      // sun pads on the aft deck
  deckRails(b, grey, o, kind === 'yacht' ? 2 : 3);
  b.build(g, { dynamic: true, cast: false });
  glowSprite(0xffffff, 3, g, 0, top + mh, mz);
  return g;
}

// ------------------------------------------------------------------ pilot boat
const PILOTBOAT = {
  active: false, state: 'idle', x: -9400, z: 1400, psi: 0, sog: 0,
  init() {
    this.grp = buildPilotBoat(); scene.add(this.grp);
    this.wake = new Wake({ width: 4, every: 1, life: 90, spread: 0.3, max: 90 });
    this.grp.position.set(this.x, 0, this.z);
    this.active = true;
  },
  ais() { return { x: this.x, z: this.z, psi: this.psi, L: 18, B: 5.4, name: 'PILOT WH', sog: this.sog, cog: this.psi }; },
  update(dt) {
    if (!this.grp) return;
    const s = G.ship;
    let tx = this.x, tz = this.z, speed = 0;
    const side = G.flags.leeSide === 'STBD' ? 1 : -1;
    const [ax, az] = s.toWorld(-10, side * (29.3 + 4.0));
    const [ox, oz] = s.toWorld(-10, side * (29.3 + 30));        // stand-off abeam the ladder before closing in
    if (this.state === 'idle') {
      speed = 0;
      if (G.flags.vtsReported && Math.hypot(s.x - GEO.pilotStation[0], s.z - GEO.pilotStation[1]) < 3200) { this.state = 'approach'; SCN.say('pb', 'Majestic Maersk, pilot boat on the way. Keep eight knots, ladder ' + G.flags.leeSide.toLowerCase() + ' side please.', true); }
    }
    if (this.state === 'approach') {
      const d = Math.hypot(ax - this.x, az - this.z);
      [tx, tz] = Math.hypot(ox - this.x, oz - this.z) < 45 || d < 30 ? [ax, az] : [ox, oz]; speed = 12;
      if (d < 25) this.state = 'alongside', this.alongT = 0;
    }
    if (this.state === 'alongside') {
      this.x = lerp(this.x, ax, Math.min(1, dt * 0.8)); this.z = lerp(this.z, az, Math.min(1, dt * 0.8)); this.psi = s.psi; this.sog = s.sog;
      const okSpeed = s.sog / KN > 5 && s.sog / KN < 10.5, okHdg = Math.abs(wrap180(s.psi / DEG - 90)) < 25;
      if (okSpeed && okHdg && G.flags.ladder) this.alongT += dt;
      else if (Math.floor(G.simT) % 20 === 0 && !this._nag) { this._nag = true; SCN.say('pb', !G.flags.ladder ? 'Majestic Maersk, pilot boat: I see no ladder! ' + G.flags.leeSide + ' side please.' : !okSpeed ? 'Majestic Maersk, pilot boat: speed ' + (s.sog / KN).toFixed(0) + ' knots — we need six to ten.' : 'Majestic Maersk, pilot boat: please steady on about zero-nine-zero for the lee.', true); SCN.later(40, 'pbNag'); }
      if (this.alongT > 45) { this.state = 'leave'; SCN.pilotBoarded(); }
      rideSwell(this.grp, this.x, this.z, this.psi, 18, 5.4, Math.sin(G.simT * 2) * 0.15 * seaState().bob, Math.sin(G.simT * 1.7) * 0.03 * seaState().bob);
      this.wake.update(dt, this.x - Math.sin(this.psi) * 9, this.z + Math.cos(this.psi) * 9, -Math.sin(this.psi), Math.cos(this.psi), 0.6);
      return;
    }
    if (this.state === 'leave') { tx = -9400; tz = 1400; speed = 14; if (Math.hypot(tx - this.x, tz - this.z) < 80) { this.state = 'done'; } }
    if (this.state === 'done') speed = 0;
    const want = this.state === 'approach' || this.state === 'leave' ? steerRound(ownHull(), this.x, this.z, tx, tz, 12, Math.max(this.sog, 3), this.state === 'approach') : Math.atan2(tx - this.x, -(tz - this.z));
    this.psi += clamp(wrapPi(want - this.psi), -0.25 * dt, 0.25 * dt);
    const dist = Math.hypot(tx - this.x, tz - this.z);
    this.sog = lerp(this.sog, Math.min(speed * KN, dist * 0.2 + (this.state === 'approach' ? s.sog : 0)), Math.min(1, dt * 0.5));
    this.x += Math.sin(this.psi) * this.sog * dt; this.z -= Math.cos(this.psi) * this.sog * dt;
    rideSwell(this.grp, this.x, this.z, this.psi, 18, 5.4, Math.sin(G.simT * 2) * 0.12 * seaState().bob);
    this.grp.rotation.x += clamp(this.sog / 12, 0, 0.06);          // bow lifts under way
    this.wake.update(dt, this.x - Math.sin(this.psi) * 9, this.z + Math.cos(this.psi) * 9, -Math.sin(this.psi), Math.cos(this.psi), clamp(this.sog / 5, 0, 1));
  },
};

// ------------------------------------------------------------------ tugs
class Tug {
  constructor(idx, name) {
    this.idx = idx; this.name = name; this.state = 'berth';
    this.grp = buildTug(name); scene.add(this.grp);
    this.x = -900 + idx * 60; this.z = 640; this.psi = 90 * DEG; this.sog = 0;
    this.grp.position.set(this.x, 0, this.z); this.grp.rotation.y = -this.psi;
    this.wake = new Wake({ width: 6, every: 1, life: 120, spread: 0.4, max: 100 });
    this.line = makeTowline();
    this.fastT = 0; this.push = false; this.side = 0; this.bx = null; this.by = null;
  }
  ais() { return { x: this.x, z: this.z, psi: this.psi, L: 32, B: 12.8, name: this.name, sog: this.sog, cog: this.psi }; }
  get phys() { return G.ship.tugs[this.idx]; }
  update(dt) {
    const s = G.ship, tg = this.phys, h = ownHull();
    let tx = this.x, tz = this.z, speed = 0, station = null, lead = null;
    const who = this.idx ? 't2' : 't1', end = this.idx ? 'aft' : 'forward';
    if (this.state === 'transit' || this.state === 'standby') {
      // escort position off the bow/stern, 70 m out on the side away from the quay
      this.side = G.flags.berthSide === 'STBD' ? -1 : 1;
      [tx, tz] = s.toWorld(tg.xb + (this.idx ? -40 : 40), this.side * 70); speed = 7;
      if (Math.hypot(tx - this.x, tz - this.z) < 60) {
        this.state = 'standby';
        if (s.sog / KN < 6.2) { this.state = 'making'; this.fastT = 0; SCN.say(who, this.name + ' coming in ' + end + ' for the line.', true); }
      }
    }
    if (this.state === 'making') {
      // bow tug backs down ahead of the stem, stern tug follows under the transom — line through the centre leads
      const ex = this.idx ? -h.L / 2 : h.L / 2;
      station = [ex + (this.idx ? -36 : 36), 0, this.idx ? 0 : Math.PI]; lead = [ex, 0];
      if (s.sog / KN > 6.5) { this.state = 'standby'; station = lead = null; SCN.say(who, 'Too fast for us, Captain — slow down, we can\'t hold the line at ' + (s.sog / KN).toFixed(0) + ' knots!', true); }
    }
    if (this.state === 'fast') {
      // work from the offshore side: push to close the quay, pull on the line to open it
      const bi = berthInfo();
      if (bi && bi.dc < 600 && Math.abs(bi.angle) < 45) this.side = bi.side === 'PORT' ? 1 : -1;
      if (!this.side) this.side = G.flags.berthSide === 'STBD' ? -1 : 1;
      const st = tugStation(h.L, h.B, tg.xb, this.side, tg.dirCmd, tg.power);
      this.push = st.push; station = [st.x, st.y, st.rel]; if (!st.push) lead = [st.ax, st.ay];
    }
    if (this.state === 'letgo') {
      tx = -900 + this.idx * 60; tz = 640; speed = 8;
      if (Math.hypot(tx - this.x, tz - this.z) < 40) this.state = 'berth';
    }
    // motion
    if (station) {
      const d = tugGlide(this, h, station[0], station[1], station[2], dt);
      if (this.state === 'fast') tg.eff = clamp(1 - (d - 6) / 20, 0, 1); // no force until she is in position
      if (this.state === 'making' && d < 15 && (this.fastT += dt) > 45) {
        this.state = 'fast'; tg.attached = true; tg.powerCmd = 0; tg.power = 0; tg.dirCmd = tg.dir = G.flags.berthSide === 'STBD' ? 90 : 270;
        SCN.say(who, this.name + ' fast ' + end + '. Standing by.', true); AUDIO.horn(0.6, 1.3); SCN.flag('tugfast' + this.idx);
      }
    } else if (this.state === 'berth') { this.sog = 0; this.bx = null; }
    else tugRun(this, h, tx, tz, speed, dt, this.state !== 'letgo');
    const wash = this.state === 'fast' ? tg.power : this.sog / 6;
    rideSwell(this.grp, this.x, this.z, this.psi, 32, 12.8, Math.sin(G.simT * 1.4 + this.idx) * 0.08 * seaState().bob);
    this.wake.update(dt, this.x - Math.sin(this.psi) * 16, this.z + Math.cos(this.psi) * 16, -Math.sin(this.psi), Math.cos(this.psi), clamp(wash, 0, 1));
    if (lead) setTowline(this.line, h, lead[0], lead[1], 17.5, this); else this.line.visible = false;
  }
}
const TUGS = {
  list: [], ordered: false,
  init() { this.list = [new Tug(0, 'WH TITAN'), new Tug(1, 'WH HERCULES')]; },
  order() {
    if (this.ordered) return false;
    this.ordered = true;
    this.list.forEach((t) => (t.state = 'transit'));
    return true;
  },
  letGo() {
    this.list.forEach((t, i) => { if (t.state !== 'berth') { t.state = 'letgo'; G.ship.tugs[i].attached = false; G.ship.tugs[i].powerCmd = 0; } });
    G.tugAuto = false; SCN.flag('tugsLetGo');
  },
  command(i, dir, power) {
    const tg = G.ship.tugs[i];
    if (!tg.attached) { UI.toast(this.list[i].name + ' is not fast yet'); return; }
    if (dir !== null) tg.dirCmd = dir;
    if (power !== null) tg.powerCmd = clamp(power, 0, 1);
    G.tugAuto = false;
  },
  update(dt) { this.list.forEach((t) => t.update(dt)); if (G.tugAuto) this.auto(dt); },
  // pilot's tug handling: parallel approach to the quay at a safe lateral speed
  auto(dt) {
    const s = G.ship, bi = berthInfo();
    if (!bi || bi.dc > 400) return;
    const target = (d) => d > 60 ? 0.28 : d > 25 ? 0.18 : d > 8 ? 0.1 : d > 1.5 ? 0.06 : 0.0;
    const towardDir = bi.side === 'PORT' ? 270 : 90;
    const awayDir = bi.side === 'PORT' ? 90 : 270;
    [['bow', 0], ['stern', 1]].forEach(([k, i]) => {
      const e = bi[k];
      const err = target(e.d) - e.vIn;       // + → need more speed toward quay
      const tg = s.tugs[i]; if (!tg.attached) return;
      const want = clamp(err * 4.5, -1, 1);
      // switching between push and pull means the tug must shift station — only for a real change
      if ((want >= 0) !== (tg.dirCmd === towardDir) && Math.abs(want) < 0.2) { tg.powerCmd = 0; return; }
      tg.dirCmd = want >= 0 ? towardDir : awayDir;
      tg.powerCmd = Math.min(0.9, Math.abs(want));
    });
  },
};
