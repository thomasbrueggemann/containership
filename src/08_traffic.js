// ============================================================================
// 08 — TRAFFIC: AI vessels, pilot boat, harbour tugs
// ============================================================================
const TRAFFIC = {
  ships: [],
  init() {
    if (CFG.traffic === 'off') return;
    // outbound container ship – leaves when we pass the VTS line
    const hx = buildContainerShip({ L: 300, B: 48, T: 12.5, D: 12.5, hull: '#1c3f7a', boot: '#6a1d1a', name: 'HANSA EXPRESS', deckhouse: 0.8, funnel: 0.8, tiers: 6, seed: 31, style: 'generic', detail: 1, lightLoad: true, funnelColor: '#1c3f7a', palette: ['#1c3f7a', '#1c3f7a', '#243a86', '#dcdcd8', '#a8382a', '#6d7982'] });
    this.add({ name: 'HANSA EXPRESS', grp: hx, L: 300, B: 48, x: -2150, z: -140, psi: 270 * DEG, speed: 11 * KN, wps: [[-2800, -150], [-8000, -160], [-13000, -170], [-16000, -1600]], trigger: () => G.ship.x > -12300, wake: 26 });
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
    o.active = !o.trigger; o.wpi = 0; o.cog = o.psi; o.sog = o.active ? o.speed : 0;
    o.grp.visible = o.active;
    o.grp.position.set(o.x, 0, o.z); o.grp.rotation.y = -o.psi;
    scene.add(o.grp);
    o.wakeObj = new Wake({ width: o.wake, every: 2, life: 180, spread: 0.3, max: 90 });
    this.ships.push(o);
  },
  update(dt) {
    for (const o of this.ships) {
      if (!o.active) { if (o.trigger && o.trigger()) { o.active = true; o.grp.visible = true; o.sog = o.speed; SCN.onTraffic(o); } continue; }
      let tx, tz;
      if (o.wps) { const w = o.wps[o.wpi]; if (!w) { o.active = false; o.done = true; o.trigger = null; o.grp.visible = false; continue; } tx = w[0]; tz = w[1]; if (Math.hypot(tx - o.x, tz - o.z) < 150) o.wpi++; }
      else if (o.wander) { if (!o.tgt || Math.hypot(o.tgt[0] - o.x, o.tgt[1] - o.z) < 60) o.tgt = [rr(o.wander.x0, o.wander.x1), rr(o.wander.z0, o.wander.z1)]; [tx, tz] = o.tgt; }
      else if (o.circle) { const a = Math.atan2(o.z - o.circle.cz, o.x - o.circle.cx) + 0.25; tx = o.circle.cx + Math.cos(a) * o.circle.r; tz = o.circle.cz + Math.sin(a) * o.circle.r; }
      const want = Math.atan2(tx - o.x, -(tz - o.z));
      const d = ((want - o.psi + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      o.psi += clamp(d, -0.012 * dt * (o.L < 60 ? 4 : 1), 0.012 * dt * (o.L < 60 ? 4 : 1));
      o.x += Math.sin(o.psi) * o.sog * dt; o.z -= Math.cos(o.psi) * o.sog * dt;
      o.cog = o.psi;
      const bob = seaState().bob, small = o.L < 60;
      rideSwell(o.grp, o.x, o.z, o.psi, o.L, o.B, small ? Math.sin(G.simT * 0.8 + o.L) * 0.1 * bob : 0, small ? Math.sin(G.simT * 1.3 + o.L) * 0.02 * bob : 0);
      o.wakeObj.update(dt, o.x - Math.sin(o.psi) * o.L / 2, o.z + Math.cos(o.psi) * o.L / 2, -Math.sin(o.psi), Math.cos(o.psi), clamp(o.sog / 4, 0, 0.8));
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
};
// AIS/ARPA view of all moving traffic
Object.defineProperty(TRAFFIC, 'aisList', { get() { return TRAFFIC.ships.filter((o) => o.active).map((o) => ({ x: o.x, z: o.z, psi: o.psi, L: o.L, B: o.B, name: o.name, sog: o.sog, cog: o.cog })); } });
TRAFFIC.all = function () { return this.aisList.concat(TUGS.list.filter((t) => t.state !== 'berth').map((t) => t.ais()), PILOTBOAT.active ? [PILOTBOAT.ais()] : []); };

function buildSmallVessel(name, hullCol, L, B, stripe) {
  const o = { L, B, T: L * 0.1, D: L * 0.08, fc: L * 0.04, rake: 1, hull: hullCol, boot: '#6a1d1a', bootTop: 0.2, detail: 1, name, bowStart: 0.6, sternEnd: 0.1, seed: L };
  const g = new THREE.Group();
  g.add(new THREE.Mesh(hullGeometry(o), new THREE.MeshStandardMaterial({ map: hullTexture(o), roughness: 0.5 })));
  g.add(deckMesh(o, o.D, new THREE.MeshStandardMaterial({ color: 0x777a7a }), 0, 0.9));
  g.add(transomMesh(o, new THREE.MeshStandardMaterial({ color: hullCol })));
  const b = new Batcher();
  const white = new THREE.MeshStandardMaterial({ color: 0xf0f0ee, roughness: 0.5 });
  b.box(white, B * 0.6, L * 0.08, L * 0.25, 0, o.D + L * 0.04, -L * 0.05);
  b.box(new THREE.MeshStandardMaterial({ color: 0x1b2833, roughness: 0.1, metalness: 0.6 }), B * 0.62, L * 0.03, L * 0.2, 0, o.D + L * 0.065, -L * 0.07);
  b.box(white, 0.3, L * 0.25, 0.3, 0, o.D + L * 0.15, L * 0.05);
  if (stripe) b.box(new THREE.MeshStandardMaterial({ color: stripe }), B * 1.01, 0.6, L * 0.3, 0, o.D - 0.4, -L * 0.1);
  if (name.startsWith('ZEE')) { b.box(new THREE.MeshStandardMaterial({ color: 0x333333 }), 0.3, L * 0.35, 0.3, 0, o.D + L * 0.17, L * 0.25); b.box(new THREE.MeshStandardMaterial({ color: 0x333333 }), 0.25, 0.25, L * 0.35, 0, o.D + L * 0.3, L * 0.2, 0, 0.6); }
  b.build(g, { dynamic: true, cast: false });
  glowSprite(0xffffff, 3, g, 0, o.D + L * 0.28, L * 0.05);
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
    if (this.state === 'idle') {
      speed = 0;
      if (G.flags.vtsReported && Math.hypot(s.x - GEO.pilotStation[0], s.z - GEO.pilotStation[1]) < 3200) { this.state = 'approach'; SCN.say('pb', 'Majestic Maersk, pilot boat on the way. Keep eight knots, ladder ' + G.flags.leeSide.toLowerCase() + ' side please.', true); }
    }
    if (this.state === 'approach') {
      tx = ax; tz = az; speed = 12;
      const d = Math.hypot(ax - this.x, az - this.z);
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
    const want = Math.atan2(tx - this.x, -(tz - this.z));
    const d = ((want - this.psi + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.psi += clamp(d, -0.25 * dt, 0.25 * dt);
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
    this.line = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.9 }));
    this.line.visible = false; scene.add(this.line);
    this.fastT = 0; this.push = false;
  }
  ais() { return { x: this.x, z: this.z, psi: this.psi, L: 32, B: 12.8, name: this.name, sog: this.sog, cog: this.psi }; }
  get phys() { return G.ship.tugs[this.idx]; }
  attachPoint() { const tg = this.phys; return G.ship.toWorld(tg.xb, 0); }
  update(dt) {
    const s = G.ship, tg = this.phys;
    let tx = this.x, tz = this.z, tpsi = this.psi, speed = 0, glue = false;
    const [ax, az] = this.attachPoint();
    if (this.state === 'transit' || this.state === 'standby') {
      // escort position off the bow/stern, 60 m out on the side away from the quay
      const side = G.flags.berthSide === 'STBD' ? -1 : 1;
      const [ex, ez] = s.toWorld(tg.xb + (this.idx ? -40 : 40), side * 70);
      tx = ex; tz = ez; speed = 7;
      const d = Math.hypot(tx - this.x, tz - this.z);
      if (d < 60) {
        this.state = 'standby';
        if (s.sog / KN < 6.2) { this.state = 'making'; this.fastT = 0; SCN.say(this.idx ? 't2' : 't1', this.name + ' alongside ' + (this.idx ? 'aft' : 'forward') + ', passing the line.', true); }
      }
    }
    if (this.state === 'making') {
      [tx, tz] = s.toWorld(tg.xb + (this.idx ? -35 : 35), 0); speed = 6; glue = true;
      this.fastT += dt;
      if (s.sog / KN > 6.5) { this.state = 'standby'; SCN.say(this.idx ? 't2' : 't1', 'Too fast for us, Captain — slow down, we can\'t hold the line at ' + (s.sog / KN).toFixed(0) + ' knots!', true); }
      if (this.fastT > 70) { this.state = 'fast'; tg.attached = true; tg.powerCmd = 0; tg.power = 0; tg.dirCmd = tg.dir = G.flags.berthSide === 'STBD' ? 90 : 270; SCN.say(this.idx ? 't2' : 't1', this.name + ' fast ' + (this.idx ? 'aft' : 'forward') + '. Standing by.', true); AUDIO.horn(0.6, 1.3); SCN.flag('tugfast' + this.idx); }
    }
    if (this.state === 'fast') {
      const a = s.psi + tg.dir * DEG; // world direction of pull
      const bi = berthInfo();
      const towardQuay = bi && bi.dc < 90 && ((bi.side === 'PORT' && tg.dirCmd > 180) || (bi.side === 'STBD' && tg.dirCmd > 0 && tg.dirCmd < 180));
      this.push = towardQuay;
      if (this.push) { // push from the opposite side, bow against the hull
        const side = bi.side === 'PORT' ? 1 : -1;
        [tx, tz] = s.toWorld(tg.xb, side * (29.3 + 16.5));
        tpsi = s.psi + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      } else {
        const L = 45 + 16 + (1 - tg.power) * 10;
        tx = ax + Math.sin(a) * L; tz = az - Math.cos(a) * L; tpsi = a;
      }
      glue = true; speed = 8;
    }
    if (this.state === 'letgo') {
      tx = -900 + this.idx * 60; tz = 640; speed = 8;
      if (Math.hypot(tx - this.x, tz - this.z) < 40) { this.state = 'berth'; }
    }
    // motion
    if (glue) {
      const k = Math.min(1, dt * 0.6);
      this.x = lerp(this.x, tx, k); this.z = lerp(this.z, tz, k);
      const d = ((tpsi - this.psi + Math.PI * 3) % (Math.PI * 2)) - Math.PI; this.psi += d * Math.min(1, dt * 0.5);
      this.sog = Math.hypot(s.vgx, s.vgz);
    } else if (this.state !== 'berth') {
      const want = Math.atan2(tx - this.x, -(tz - this.z));
      const d = ((want - this.psi + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.psi += clamp(d, -0.2 * dt, 0.2 * dt);
      const dist = Math.hypot(tx - this.x, tz - this.z);
      this.sog = lerp(this.sog, Math.min(speed * KN * 1.6, 1 + dist * 0.05), Math.min(1, dt * 0.4));
      this.x += Math.sin(this.psi) * this.sog * dt; this.z -= Math.cos(this.psi) * this.sog * dt;
    }
    const wash = this.state === 'fast' ? tg.power : this.sog / 6;
    rideSwell(this.grp, this.x, this.z, this.psi, 32, 12.8, Math.sin(G.simT * 1.4 + this.idx) * 0.08 * seaState().bob);
    this.wake.update(dt, this.x - Math.sin(this.psi) * 16, this.z + Math.cos(this.psi) * 16, -Math.sin(this.psi), Math.cos(this.psi), clamp(wash, 0, 1));
    // towline
    if ((this.state === 'fast' && !this.push) || this.state === 'making') {
      const p0 = new THREE.Vector3(ax, 17.5, az);
      const p1 = new THREE.Vector3(this.x - Math.sin(this.psi) * (this.state === 'making' ? -14 : 9), 5, this.z + Math.cos(this.psi) * (this.state === 'making' ? -14 : 9));
      const mid = p0.clone().add(p1).multiplyScalar(0.5); const len = p0.distanceTo(p1);
      this.line.position.copy(mid); this.line.scale.set(1, len, 1);
      this.line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
      this.line.visible = true;
    } else this.line.visible = false;
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
      tg.dirCmd = want >= 0 ? towardDir : awayDir;
      tg.powerCmd = Math.min(0.9, Math.abs(want));
    });
  },
};
