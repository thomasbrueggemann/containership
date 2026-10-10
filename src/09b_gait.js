// ============================================================================
// 09b — LOCOMOTION: planted-foot stepping with leg IK
// ============================================================================
// A walking person is not a pair of pendulums swung from the hips. Each foot is either planted on the floor (it does not move: the
// body travels over it, so the stance foot's ground speed is zero by construction) or in a swing that carries it to where it will
// land. The legs are solved from the foot placements: the pelvis is positioned (height from the leg length, lateral shift over
// the stance foot, rotation and obliquity from where the feet are), two-bone IK finds hip and knee, and the ankle follows the
// foot's roll: heel strike (toes up, pivoting on the heel) → foot flat → heel-off (pivoting on the ball, the toes bending) →
// toe-off → swing. Step length and cadence follow from the speed, so nothing skates at any speed; starting, stopping and turning
// on the spot are the same machinery (a foot steps when it is too far from where it should be).
// The rest of the body is coupled to the feet: arms swing against the legs, the thorax counter-rotates against the pelvis,
// the head stays level and on course.
// Frames: bridge-local x (starboard), z (aft); the person faces `face` (0 = -z); what the bones receive is in the root frame
// (the group is rotated by `face`).
// ============================================================================
const _gV = { H: new THREE.Vector3(), A: new THREE.Vector3(), d: new THREE.Vector3(), u: new THREE.Vector3(), h0: new THREE.Vector3(), h: new THREE.Vector3(), t: new THREE.Vector3(), nt: new THREE.Vector3(), z: new THREE.Vector3(), c: new THREE.Vector3() };
const _gM = new THREE.Matrix4(), _gE = new THREE.Euler(0, 0, 0, 'YXZ'), _gEx = new THREE.Euler(0, 0, 0, 'XYZ');
const _gQp = new THREE.Quaternion(), _gQinv = new THREE.Quaternion(), _gQf = new THREE.Quaternion(), _gQc = new THREE.Quaternion(), _gQk = new THREE.Quaternion();
const humDamp = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));
const humAng = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const humClamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Two-bone leg solve. H = hip joint, A = ankle target (both in the hips frame), psi = heading of the knee axis (the foot's yaw in that
// frame). Sets the thigh's quaternion and the knee's flexion; returns the flexion (rad).
function humLegIK(hp, kn, L1, L2, H, A, psi) {
  const d = _gV.d.subVectors(A, H); let D = d.length();
  const max = (L1 + L2) * 0.9997, min = Math.abs(L1 - L2) + 0.02;
  if (D > max) { d.multiplyScalar(max / D); D = max; } else if (D < min) { d.multiplyScalar(min / Math.max(D, 1e-6)); D = min; }
  const u = _gV.u.copy(d).multiplyScalar(1 / D);
  _gV.h0.set(Math.cos(psi), 0, -Math.sin(psi));
  const h = _gV.h.copy(_gV.h0).addScaledVector(u, -_gV.h0.dot(u));
  if (h.lengthSq() < 1e-8) h.set(1, 0, 0);
  h.normalize();
  const alpha = Math.acos(humClamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
  // thigh direction: the hip→ankle axis turned about the hinge so that the knee goes forward (−z for a straight standing leg)
  _gV.c.crossVectors(h, u);
  const t = _gV.t.copy(u).multiplyScalar(Math.cos(alpha)).addScaledVector(_gV.c, Math.sin(alpha));
  const flex = Math.PI - Math.acos(humClamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1));
  const nt = _gV.nt.copy(t).negate(), z = _gV.z.crossVectors(h, nt);
  _gM.makeBasis(h, nt, z); hp.quaternion.setFromRotationMatrix(_gM);
  kn.rotation.set(-flex, 0, 0);
  return flex;
}

// Two-bone arm solve: shoulder S, hand target T (both in the parent's frame of the shoulder bone), pole = the direction the elbow points
// to. Sets the upper arm's quaternion and the elbow flexion (positive = forearm forward). Returns the flexion.
function humArmIK(sh, el, L1, L2, S, T, pole) {
  const d = _gV.d.subVectors(T, S); let D = d.length();
  const max = (L1 + L2) * 0.9995, min = Math.abs(L1 - L2) + 0.02;
  if (D > max) { d.multiplyScalar(max / D); D = max; } else if (D < min) { d.multiplyScalar(min / Math.max(D, 1e-6)); D = min; }
  const u = _gV.u.copy(d).multiplyScalar(1 / D);
  const q = _gV.h0.copy(pole); q.addScaledVector(u, -q.dot(u)); if (q.lengthSq() < 1e-8) q.set(0, 0, 1); q.normalize();   // elbow side, perpendicular to the axis
  const alpha = Math.acos(humClamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
  const t = _gV.t.copy(u).multiplyScalar(Math.cos(alpha)).addScaledVector(q, Math.sin(alpha));
  const flex = Math.PI - Math.acos(humClamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1));
  const h = _gV.h.crossVectors(q, u).normalize();                                 // hinge: positive rotation about it swings the forearm forward
  const nt = _gV.nt.copy(t).negate(), z = _gV.z.crossVectors(h, nt);
  _gM.makeBasis(h, nt, z); sh.quaternion.setFromRotationMatrix(_gM);
  el.rotation.set(flex, 0, 0);
  return flex;
}

class HumGait {
  constructor(body, look, seed) {
    this.b = body; this.P = body.P; const P = this.P, st = look.gait || {};
    this.rng = mulberry32(seed || 7);
    // personal style
    this.vK = st.speed || 1; this.cadK = st.cadence || 1; this.armK = st.arms || 1; this.swayK = st.sway || 1;
    this.toeOut = st.toeOut !== undefined ? st.toeOut : 0.1; this.stoop = st.stoop || 0; this.lazy = st.lazy || 0;
    // leg geometry (hip joint to ankle) and how far the legs are asked to reach (a hair under straight, as people walk)
    this.L1 = P.thigh; this.L2 = P.shin; this.Lmax = P.thigh + P.shin; this.reach = 0.9985; this.bounceK = st.bounce || 1;
    this.stanceHalf = P.hipX + 0.012;                       // lateral position of each foot when standing (distance from the midline)
    this.stepHalf = (P.F ? 0.050 : 0.058) * P.sc;           // …and while walking
    this.heel = P.foot.heel; this.ball = P.foot.ball; this.ankleH = P.ankleH;
    const mk = (side) => ({ side, planted: true, x: 0, z: 0, yaw: 0, tPlanted: 0, s0: 0, gHs: 0.26, sw: { t: 0, T: 0.4, x0: 0, y0: 0, z0: 0, g0: 0, yaw0: 0, x1: 0, z1: 0, g1: 0, yaw1: 0 },
      ax: 0, ay: P.ankleH, az: 0, pitch: 0, pivot: 0, knee: 0 });
    this.feet = [mk(-1), mk(1)];
    this.init = false; this.lx = 0; this.lz = 0; this.wasWalking = false; this.t = 0; this.settleT = 0; this.lead = 1;
    // pelvis / trunk state
    this.lat = 0; this.py = P.hipH; this.yawP = 0; this.rollP = 0; this.tiltP = 0.04; this.leanF = 0; this.leanS = 0;
    this.shift = 0; this.shiftS = 0; this.shiftT = 3 + this.rng() * 5;
    this.speed = 0; this.accel = 0; this.lastSpeed = 0; this.yawRate = 0; this.lastFace = 0;
    this.out = { walkAmt: 0, offL: 0, offR: 0, hipY: P.hipH };
  }
  stepFreq(v) { return (0.95 + 0.72 * v) * this.cadK * Math.sqrt(1.78 / this.P.H); }     // steps per second at speed v
  // neutral standing place of a foot (heel contact point, world) for the root at (x, z) facing `face`
  neutral(f, x, z, face, out) {
    const sf = Math.sin(face), cf = Math.cos(face), fx = -sf, fz = -cf, rx = cf, rz = -sf, w = f.side * this.stanceHalf, stag = f.side === this.lead ? 0.022 : -0.012;
    out.x = x + rx * w + fx * (stag - this.heel); out.z = z + rz * w + fz * (stag - this.heel); out.yaw = face - f.side * this.toeOut * 1.4;
    return out;
  }
  snap(c) {
    this.lead = this.rng() < 0.5 ? -1 : 1;
    for (const f of this.feet) { this.neutral(f, c.x, c.z, c.face, f); f.planted = true; f.tPlanted = 1; f.s0 = 0; f.pitch = 0; f.pivot = 0; f.ay = this.ankleH; }
    this.init = true; this.lx = c.x; this.lz = c.z; this.lastFace = c.face; this.speed = 0; this.yawRate = 0; this.wasWalking = false; this.settleT = 0;
  }

  // ankle position (world) of a planted foot with the given pitch; pivot 0 = on the heel contact point, 1 = on the ball
  ankleOf(f, pitch, pivot, out) {
    const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw), fx = -sy, fz = -cy, cp = Math.cos(pitch), sp = Math.sin(pitch);
    if (pivot === 0) {      // the ankle relative to the heel contact in the foot frame is (0, ankleH, -heel), rotated by the pitch about x
      const y = this.ankleH * cp + this.heel * sp, zl = this.ankleH * sp - this.heel * cp;
      out.x = f.x - fx * zl; out.z = f.z - fz * zl; out.y = y; return out;
    }
    const bx = f.x + fx * (this.heel - this.ball), bz = f.z + fz * (this.heel - this.ball);       // the ball's contact point (flat foot)
    const y = this.ankleH * cp + this.ball * sp, zl = this.ankleH * sp - this.ball * cp;           // r = (0, ankleH, -ball)
    out.x = bx - fx * zl; out.z = bz - fz * zl; out.y = y; return out;
  }

  // ------------------------------------------------------------------ frame update
  // c: { x, z (root position), face, speed (m/s), walking (moved this frame), sitK (0..1), seat: { h, rootX, rootZ, footF, footY } | null }
  update(dt, c) {
    const F = this.feet;
    if (!this.init || Math.hypot(c.x - this.lx, c.z - this.lz) > 0.45) this.snap(c);
    if (dt <= 0) return;
    this.t += dt;
    const spd = c.speed;
    this.accel = humDamp(this.accel, (spd - this.lastSpeed) / dt, dt, 0.12); this.lastSpeed = spd;
    this.yawRate = humDamp(this.yawRate, humAng(c.face - this.lastFace) / dt, dt, 0.1); this.lastFace = c.face;
    const sf = Math.sin(c.face), cf = Math.cos(c.face), fx = -sf, fz = -cf, rx = cf, rz = -sf;
    const sit = c.sitK > 0.001, walking = c.walking && spd > 0.03 && !sit;
    this.speed = spd;
    const fq = this.stepFreq(Math.max(spd, 0.55)), Tc = 2 / fq, Tsw = Math.min(0.62, Tc * 0.37 + 0.03), Tst = Tc - Tsw;
    const stepLen = spd / this.stepFreq(Math.max(spd, 0.2)) * (1 + this.lazy);
    // ---- stepping
    if (walking) {
      if (!this.wasWalking) {          // the first step goes with the foot that is further behind, after a short weight transfer; the other follows half a cycle later
        const a = F[0], b = F[1], offA = (a.x - c.x) * fx + (a.z - c.z) * fz, offB = (b.x - c.x) * fx + (b.z - c.z) * fz;
        const first = Math.abs(offA - offB) > 0.03 ? (offA < offB ? a : b) : (this.lead === -1 ? b : a), other = first === a ? b : a;
        first.tPlanted = Tst - 0.17; other.tPlanted = Tst - 0.17 - Tc / 2;
      }
      for (const f of F) if (f.planted) {
        f.tPlanted += dt;
        const o = F[f === F[0] ? 1 : 0];
        if (f.tPlanted >= Tst && (o.planted || spd > 2.3) && o.tPlanted > 0.05) this.liftFoot(f, c, Tsw, stepLen, fx, fz);
      }
    } else for (const f of F) if (f.planted) f.tPlanted += dt;
    for (const f of F) if (!f.planted) { f.sw.t += dt; if (f.sw.t >= f.sw.T) this.landFoot(f, c, fx, fz); }
    this.wasWalking = walking;
    if (!walking) this.settle(dt, c);
    // a planted foot that the pelvis has left too far behind (a glitch, a shove, a very quick turn) steps at once
    for (const f of F) if (f.planted && f.tPlanted > 0.05) {
      const dh = Math.hypot(f.ax - (c.x + rx * f.side * this.P.hipX), f.az - (c.z + rz * f.side * this.P.hipX));
      if (dh > 0.52 * this.P.sc && F[f === F[0] ? 1 : 0].planted) { if (walking) this.liftFoot(f, c, Tsw, stepLen, fx, fz); else this.stepToNeutral(f, c); }
    }
    this.solve(dt, c, fx, fz, rx, rz, sf, cf);
    this.lx = c.x; this.lz = c.z;
  }

  // a foot leaves the floor: where it lands follows from where the pelvis will be and how long the step is
  liftFoot(f, c, Tsw, stepLen, fx, fz) {
    const sw = f.sw, spd = Math.max(this.speed, 0), T = Tsw;
    sw.t = 0; sw.T = T; sw.x0 = f.ax; sw.y0 = f.ay; sw.z0 = f.az; sw.g0 = f.pitch; sw.yaw0 = f.yaw;
    const px = c.x + fx * (spd * T + 0.5 * this.accel * T * T), pz = c.z + fz * (spd * T + 0.5 * this.accel * T * T);
    const heading = c.face + this.yawRate * T * 0.5, hx = -Math.sin(heading), hz = -Math.cos(heading), lx = Math.cos(heading), lz = -Math.sin(heading);
    const wide = this.stepHalf * (1 + 0.25 * humClamp(Math.abs(this.yawRate) / 1.5, 0, 1));
    const turnAdj = humClamp(this.yawRate * f.side * 0.012, -0.04, 0.04);
    // the heel lands about half a step ahead of the pelvis
    const lead = 0.44 * stepLen + turnAdj;
    sw.x1 = px + hx * lead + lx * f.side * wide; sw.z1 = pz + hz * lead + lz * f.side * wide;
    sw.yaw1 = heading - f.side * this.toeOut; sw.g1 = humMix(0.2, 0.3, humSS(0.4, 1.8, spd));
    f.planted = false; f.tPlanted = 0;
  }

  landFoot(f, c, fx, fz) {
    const sw = f.sw;
    f.x = sw.x1; f.z = sw.z1; f.yaw = sw.yaw1; f.planted = true; f.tPlanted = 0; f.pitch = sw.g1; f.gHs = sw.g1;
    f.s0 = (c.x - (f.x + fx * this.heel)) * fx + (c.z - (f.z + fz * this.heel)) * fz;      // the pelvis relative to the flat ankle: negative = the foot is ahead
  }

  // standing feet that have been left behind (a turn, the end of a walk) step to where they should be
  settle(dt, c) {
    const F = this.feet; if (!F[0].planted || !F[1].planted) return;
    if (this.settleT > 0) { this.settleT -= dt; return; }
    if (this.speed > 0.1 || c.sitK > 0.001) return;
    const n = { x: 0, z: 0, yaw: 0 }; let worst = null, wd = 0;
    for (const f of F) {
      this.neutral(f, c.x, c.z, c.face, n);
      const d = Math.hypot(n.x - f.x, n.z - f.z) + 0.2 * Math.abs(humAng(n.yaw - f.yaw));
      if (d > wd) { wd = d; worst = f; }
    }
    if (worst && wd > 0.1) this.stepToNeutral(worst, c, wd);
  }
  stepToNeutral(f, c, wd = 0.3) {
    const n = { x: 0, z: 0, yaw: 0 }; this.neutral(f, c.x, c.z, c.face, n);
    const sw = f.sw; sw.t = 0; sw.T = humClamp(0.3 + 0.3 * wd, 0.3, 0.5);
    sw.x0 = f.ax; sw.y0 = f.ay; sw.z0 = f.az; sw.g0 = f.pitch; sw.yaw0 = f.yaw; sw.x1 = n.x; sw.z1 = n.z; sw.yaw1 = n.yaw; sw.g1 = 0.12;
    f.planted = false; f.tPlanted = 0; this.settleT = 0.1;
  }

  // ------------------------------------------------------------------ the pose
  solve(dt, c, fx, fz, rx, rz, sf, cf) {
    const P = this.P, F = this.feet, out = this.out, sc = P.sc, spd = this.speed;
    out.walkAmt = humDamp(out.walkAmt, humSS(0.15, 0.7, spd) * (c.sitK > 0.01 ? 0 : 1), dt, 0.12);
    const wa = out.walkAmt;
    // ---- the feet
    for (const f of F) {
      if (f.planted) {
        const ex = f.x - Math.sin(f.yaw) * this.heel, ez = f.z - Math.cos(f.yaw) * this.heel;
        const s = (c.x - ex) * fx + (c.z - ez) * fz;                         // how far the pelvis is ahead of the (flat) ankle
        let pitch = 0, pivot = 0;
        if (f.tPlanted < 2 && f.s0 < -0.02) pitch = f.gHs * (1 - humSS(f.s0, f.s0 + 0.2, s));      // heel rocker
        if (wa > 0.05 && s > 0.14) { const sched = -Math.pow(humClamp((s - 0.14) / 0.34, 0, 1), 2.1) * 1.12 * wa; if (sched < pitch - 1e-4) { pitch = sched; pivot = 1; } }   // heel off, on the ball
        f.pitch = pitch; f.pivot = pivot;
        this.ankleOf(f, pitch, pivot, _gV.A); f.ax = _gV.A.x; f.ay = _gV.A.y; f.az = _gV.A.z;
      } else {
        const sw = f.sw, tau = humClamp(sw.t / sw.T, 0, 1), e = tau * tau * tau * (10 - 15 * tau + 6 * tau * tau);
        // landing ankle (the foot arrives heel first, toes up by g1)
        const cp = Math.cos(sw.g1), sp = Math.sin(sw.g1), yL = this.ankleH * cp + this.heel * sp, zl = this.ankleH * sp - this.heel * cp;
        const xL = sw.x1 - (-Math.sin(sw.yaw1)) * zl, zL = sw.z1 - (-Math.cos(sw.yaw1)) * zl;
        f.ax = sw.x0 + (xL - sw.x0) * e; f.az = sw.z0 + (zL - sw.z0) * e;
        const lift = 0.07 * sc * Math.pow(Math.sin(Math.PI * Math.pow(tau, 0.68)), 1.2) * (0.75 + 0.5 * wa);
        f.ay = sw.y0 + (yL - sw.y0) * humSS(0, 1, tau) + lift;
        f.yaw = sw.yaw0 + humAng(sw.yaw1 - sw.yaw0) * humSS(0, 0.8, tau);
        // the foot pitch follows the shank through the swing (toes down while the knee is bent), then comes up to meet the floor heel first
        const k1 = sw.g0 * 0.72, k2 = sw.g0 * 0.28, k3 = 0.0;
        f.pitch = tau < 0.3 ? humMix(sw.g0, k1, humSS(0, 0.3, tau)) : tau < 0.5 ? humMix(k1, k2, humSS(0.3, 0.5, tau)) : tau < 0.78 ? humMix(k2, k3, humSS(0.5, 0.78, tau)) : humMix(k3, sw.g1, humSS(0.78, 1, tau)); f.pivot = 0;
      }
    }
    // ---- pelvis position and orientation
    const supL = F[0].planted ? humSS(0, 0.2, F[0].tPlanted) : 0, supR = F[1].planted ? humSS(0, 0.2, F[1].tPlanted) : 0, sup = supL + supR || 1;
    this.shiftT -= dt;
    if (this.shiftT <= 0) { this.shiftT = 5 + this.rng() * 7; this.shiftS = this.shiftS === 0 ? (this.rng() < 0.5 ? -1 : 1) : (this.rng() < 0.35 ? 0 : -this.shiftS); }
    this.shift = humDamp(this.shift, this.shiftS, dt, 0.45);
    const idle = (1 - wa) * (1 - c.sitK);
    const latT = ((supR - supL) / sup) * this.stepHalf * 0.45 * this.swayK * wa + this.shift * 0.03 * idle + Math.sin(this.t * 0.7 + 1.3) * 0.004 * idle;
    this.lat = humDamp(this.lat, latT, dt, 0.09);
    const px = c.x + rx * this.lat, pz = c.z + rz * this.lat;
    const offL = (F[0].ax - px) * fx + (F[0].az - pz) * fz, offR = (F[1].ax - px) * fx + (F[1].az - pz) * fz;
    out.offL = offL; out.offR = offR;
    this.yawP = humDamp(this.yawP, 0.115 * (offR - offL) * wa * this.swayK, dt, 0.06);
    this.rollP = humDamp(this.rollP, ((supR - supL) / sup) * 0.065 * wa * this.swayK + this.shift * 0.022 * idle, dt, 0.08);
    this.leanF = humDamp(this.leanF, humClamp(0.02 + 0.03 * spd + 0.05 * this.accel + this.stoop * 0.5, -0.12, 0.2) * (1 - c.sitK), dt, 0.18);
    this.leanS = humDamp(this.leanS, humClamp(spd * this.yawRate * 0.06, -0.14, 0.14) * (1 - c.sitK), dt, 0.2);
    this.tiltP = humDamp(this.tiltP, 0.035 + 0.01 * Math.sin(this.t * 0.9) * idle + 0.1 * this.leanF, dt, 0.1);
    // ---- height: a double-hump bob (lowest just after each heel strike, highest in mid stance), never higher than the stance legs reach
    const tSince = Math.min(F[0].planted ? F[0].tPlanted : 9, F[1].planted ? F[1].tPlanted : 9), Tstep = 1 / this.stepFreq(Math.max(spd, 0.55));
    const phi = Math.min(tSince / Tstep, 1.4), bob = 0.038 * sc * this.bounceK * wa;
    let yMax = P.hipH * 0.998 - Math.abs(this.shift) * 0.006 * (1 - c.sitK) - bob * 0.5 * (1 + Math.cos(2 * Math.PI * (phi - 0.1))) * (this.bobOn ? 1 : 1), yReach = P.hipH;
    const r = this.Lmax * this.reach, syw = Math.sin(this.yawP), cyw = Math.cos(this.yawP), srl = Math.sin(this.rollP);
    for (const f of F) {
      if (!f.planted) continue;
      const hxl = f.side * P.hipX, dx = f.ax - c.x, dz = f.az - c.z, axl = dx * cf - dz * sf, azl = dx * sf + dz * cf;      // ankle, root frame
      const hx = this.lat + hxl * cyw - axl, hz = -hxl * syw - azl, hd2 = hx * hx + hz * hz;                               // hip joint (yawed pelvis) to ankle, horizontal
      yReach = Math.min(yReach, f.ay + Math.sqrt(Math.max(0.01, r * r - hd2)) - hxl * srl);
    }
    yMax = Math.min(yMax, yReach);
    yMax = Math.max(yMax, P.hipH * 0.8);
    let y;
    if (c.seat && c.sitK > 0.001) { const k = humSS(0, 1, c.sitK); y = humMix(yMax, c.seat.h + 0.088 * sc, k); this.py = y; }
    else { this.py = humDamp(this.py, yMax, dt, 0.03); y = Math.min(this.py, yReach); }
    out.hipY = y;
    const hips = this.b.hips;
    hips.position.set(this.lat, y, 0);
    _gE.set(this.tiltP + (c.sitK > 0.5 ? 0.06 : 0), this.yawP, this.rollP, 'YXZ'); hips.quaternion.setFromEuler(_gE);
    _gQp.copy(hips.quaternion); _gQinv.copy(_gQp).invert();
    // ---- legs
    for (let i = 0; i < 2; i++) this.leg(dt, c, i, sf, cf);
  }

  leg(dt, c, i, sf, cf) {
    const P = this.P, f = this.feet[i], leg = this.b.legs[i], side = f.side, hips = this.b.hips;
    let ax = f.ax, ay = f.ay, az = f.az, pitch = f.pitch;
    if (c.seat && c.sitK > 0.001) {        // seated: feet on the footrest or the floor, ahead of the knees
      const k = humSS(0, 1, c.sitK), t = c.seat;
      const sx = t.rootX + cf * side * 0.105 - sf * t.footF, sz = t.rootZ - sf * side * 0.105 - cf * t.footF;
      ax = humMix(ax, sx, k); az = humMix(az, sz, k); ay = humMix(ay, t.footY + P.ankleH, k) + Math.sin(Math.PI * k) * 0.05; pitch = humMix(pitch, 0.05, k);
    }
    // bridge frame → root frame (rotated by face) → hips frame
    const dx = ax - c.x, dz = az - c.z;
    _gV.A.set(dx * cf - dz * sf, ay, dx * sf + dz * cf);
    _gV.A.x -= hips.position.x; _gV.A.y -= hips.position.y; _gV.A.z -= hips.position.z;
    _gV.A.applyQuaternion(_gQinv);
    _gV.H.set(side * P.hipX, 0, 0);
    const yawRoot = f.yaw - c.face;
    const flex = humLegIK(leg.hp, leg.kn, this.L1, this.L2, _gV.H, _gV.A, yawRoot - this.yawP);
    // ankle: the foot's orientation in the root frame, relative to the shank
    _gE.set(pitch, yawRoot, 0, 'YXZ'); _gQf.setFromEuler(_gE);
    _gQc.copy(_gQp).multiply(leg.hp.quaternion); _gEx.set(-flex, 0, 0, 'XYZ'); _gQk.setFromEuler(_gEx); _gQc.multiply(_gQk).invert().multiply(_gQf);
    leg.ankle.quaternion.copy(_gQc);
    const toe = f.planted ? (f.pivot ? humClamp(-f.pitch, 0, 1.05) : 0.0) : humClamp(-f.pitch * 0.75, 0, 0.85);       // the toes stay bent at toe-off and relax during the swing
    leg.toe.rotation.x = humDamp(leg.toe.rotation.x, toe, dt, 0.04);
    f.knee = flex;
  }
}
