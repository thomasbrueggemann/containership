// ============================================================================
// 07 — SHIP DYNAMICS
// 3-DOF manoeuvring model (surge / sway / yaw) for a Triple-E class vessel.
// Hull derivatives from Clarke (1982), rudder/propeller after the MMG model,
// plus cross-flow drag for low-speed handling, bow thrusters, tugs, wind,
// current, shallow-water effects, fender contact and mooring lines.
// Body frame: x forward, y starboard, r > 0 turns the bow to starboard.
// World frame: x east, z south (three.js), heading psi clockwise from north.
// ============================================================================

const SHIPSPEC = {
  L: 397.7, B: 58.6, T: 14.5, D: 15.7,       // Lpp, beam, arrival draft, freeboard
  disp: 2.24e8,                               // displacement [kg]
  rho: 1025, rhoAir: 1.225,
  Cb: 0.66,
  rudderArea: 58,                             // per rudder [m^2]
  propD: 9.8,
  propY: 11.2,                                // prop lateral offset (twin skeg)
  bowThrX: 172, bowThrMax: 330e3,             // per unit [N] (2 units)
  windAreaLat: 16500, windAreaFront: 2400,    // with containers
  maxRudder: 35, rudderRate: 2.4,             // deg, deg/s (SOLAS: 35->30 in < 28 s)
  rpmMax: 78,
};

// Engine telegraph (bridge manoeuvring program, MAN B&W 8S80ME-C9)
const TELEGRAPH = [
  { id: 'FAS', label: 'FULL ASTERN',      rpm: -46 },
  { id: 'HAS', label: 'HALF ASTERN',      rpm: -36 },
  { id: 'SAS', label: 'SLOW ASTERN',      rpm: -28 },
  { id: 'DSAS', label: 'DEAD SLOW ASTERN', rpm: -21 },
  { id: 'STOP', label: 'STOP',             rpm: 0 },
  { id: 'DSA', label: 'DEAD SLOW AHEAD',  rpm: 21 },
  { id: 'SA',  label: 'SLOW AHEAD',       rpm: 29 },
  { id: 'HA',  label: 'HALF AHEAD',       rpm: 38 },
  { id: 'FA',  label: 'FULL AHEAD',       rpm: 48 },
  { id: 'NFA', label: 'NAV FULL (SEA)',   rpm: 66 },
];
const TELEGRAPH_STOP = 4;

class ShipPhysics {
  constructor() {
    const S = SHIPSPEC;
    this.S = S;
    this.x = 0; this.z = 0; this.psi = Math.PI / 2;
    this.u = 0; this.v = 0; this.r = 0;
    this.rudder = 0; this.rudderCmd = 0;
    this.tele = [TELEGRAPH_STOP, TELEGRAPH_STOP];       // telegraph notch per engine
    this.rpm = [0, 0];
    this.engineMode = 'SEA';                             // SEA | STANDBY | FWE
    this.reverseDelay = [0, 0];
    this.startAirUses = 0;
    this.bowThr = [0, 0]; this.bowThrCmd = [0, 0];       // -1..1 (+ = push bow to stbd)
    this.tugs = [
      { name: 'fwd', xb: 168, attached: false, power: 0, powerCmd: 0, dir: 270, dirCmd: 270 },
      { name: 'aft', xb: -170, attached: false, power: 0, powerCmd: 0, dir: 270, dirCmd: 270 },
    ];
    this.windFrom = 225 * DEG; this.windSpeed = 8;       // true wind [m/s]
    this.curSetTo = 20 * DEG; this.curSpeed = 0.35;       // current set/drift [m/s]
    this.squat = 0; this.ukc = 20; this.depthUnder = 30;
    this.grounded = 0;                                   // metres of penetration
    this.contact = { active: false, speed: 0, maxSpeed: 0, first: null, points: 0 };
    this.lines = null;                                   // mooring lines {tx, tz, tpsi, k}
    this.forceLog = { tugs: [0, 0] };
    // derived
    this.sog = 0; this.cog = this.psi; this.vgx = 0; this.vgz = 0;
    this.rotDegMin = 0;
    this._hullPts = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const xb = -S.L / 2 + 6 + (S.L - 12) * i / n;
      const taper = xb > 110 ? Math.max(0.05, 1 - Math.pow((xb - 110) / (S.L / 2 - 110 + 6), 1.8)) : 1;
      const hb = S.B / 2 * taper;
      this._hullPts.push([xb, hb], [xb, -hb]);
    }
    this._hullPts.push([S.L / 2 + 2, 0], [-S.L / 2 - 1, 0]);
  }

  fwd() { return [Math.sin(this.psi), -Math.cos(this.psi)]; }
  stb() { return [Math.cos(this.psi), Math.sin(this.psi)]; }
  toWorld(xb, yb) {
    const s = Math.sin(this.psi), c = Math.cos(this.psi);
    return [this.x + xb * s + yb * c, this.z - xb * c + yb * s];
  }
  toBody(wx, wz) {
    const dx = wx - this.x, dz = wz - this.z, s = Math.sin(this.psi), c = Math.cos(this.psi);
    return [dx * s - dz * c, dx * c + dz * s];
  }

  thrustOf(i, u) {
    const n = this.rpm[i];
    if (n >= 0) return 560 * n * n - 950 * n * u;
    return -0.8 * 560 * n * n - 950 * (-n) * u * 0.9;
  }

  // ---------------------------------------------------------------- engines
  updateEngines(dt) {
    for (let i = 0; i < 2; i++) {
      let target = TELEGRAPH[this.tele[i]].rpm;
      if (this.engineMode === 'FWE') target = 0;
      if (this.engineMode === 'SEA' && target < 0) target = 0; // no astern in sea mode
      const cur = this.rpm[i];
      if (cur !== 0 && target !== 0 && Math.sign(cur) !== Math.sign(target)) target = 0; // must stop first
      if (cur === 0 && target !== 0) {
        // air start / reversing of camshaft-less ME engine takes a few seconds
        this.reverseDelay[i] += dt;
        if (this.reverseDelay[i] < 6) continue;
        this.rpm[i] = Math.sign(target) * 12;           // firing speed
        this.startAirUses++;
        this.reverseDelay[i] = 0;
        continue;
      }
      this.reverseDelay[i] = 0;
      // load-up programme: slow above 55 rpm, very slow in sea mode
      let rate = this.engineMode === 'SEA' ? 0.25 : (Math.abs(cur) > 50 ? 0.35 : 1.6);
      if (Math.abs(target) < Math.abs(cur)) rate = this.engineMode === 'SEA' ? 0.6 : 2.2;
      const d = target - cur;
      if (Math.abs(target) < 1 && Math.abs(cur) < 13) { this.rpm[i] = 0; continue; } // cut fuel
      this.rpm[i] = cur + clamp(d, -rate * dt, rate * dt);
    }
  }

  // ------------------------------------------------------------------- step
  step(dt, env) {
    const S = this.S, rho = S.rho, L = S.L, T = S.T, B = S.B;
    this.updateEngines(dt);

    // steering gear
    const dr = clamp(this.rudderCmd, -S.maxRudder, S.maxRudder) - this.rudder;
    this.rudder += clamp(dr, -S.rudderRate * dt, S.rudderRate * dt);

    // thrusters (electric, ~8 s to full)
    for (let i = 0; i < 2; i++) {
      const d = this.bowThrCmd[i] - this.bowThr[i];
      this.bowThr[i] += clamp(d, -0.12 * dt, 0.12 * dt);
    }

    // depth & shallow water
    const depth = env.depthAt(this.x, this.z);
    this.depthUnder = depth;
    const U = Math.hypot(this.u, this.v);
    const Ukn = U / KN;
    const hT = Math.max(1.01, depth / T);
    this.squat = S.Cb * Ukn * Ukn / 100 * (hT < 1.5 ? 1.6 : 1.0);
    this.ukc = depth - T - this.squat;
    const shallow = 1 + 1.6 * Math.pow(1 / hT, 3);   // resistance / damping amplification

    const u = this.u, v = this.v, r = this.r;
    const m = S.disp;
    const mx = m * 1.05, my = m + 1.76e8, Iz = m * Math.pow(0.25 * L, 2) + 1.68e12;

    // --- hull resistance
    const cR = 2.8e4 * (u >= 0 ? 1 : 1.6) * Math.sqrt(shallow);
    let X = -cR * u * Math.abs(u) - 4e4 * u;
    let Y = 0, N = 0;

    // --- linear hull (Clarke) — scaled with U
    const Ueff = Math.max(U, 0.05);
    const q2 = 0.5 * rho * L * L, q3 = q2 * L, q4 = q3 * L;
    const Yv = -0.0125 * q2 * Ueff, Yr = 0.00208 * q3 * Ueff;
    const Nv = -0.00246 * q3 * Ueff, Nr = -0.00136 * q4 * Ueff;
    Y += (Yv * v + (Yr) * r) * shallow;
    N += (Nv * v + Nr * r) * shallow;

    // --- cross-flow drag (dominant at low speed)
    const Cd = 0.75 * shallow;
    const nStrip = 12, dx = L / nStrip;
    let Ycf = 0, Ncf = 0;
    for (let k = 0; k < nStrip; k++) {
      const xs = -L / 2 + dx * (k + 0.5);
      const vl = v + xs * r;
      const f = -0.5 * rho * T * Cd * vl * Math.abs(vl) * dx;
      Ycf += f; Ncf += f * xs;
    }
    Y += Ycf; N += Ncf;
    // yaw damping at rest (so the ship doesn't spin forever)
    N += -3e10 * r * Math.sqrt(shallow);

    // --- propellers
    const T0 = this.thrustOf(0, u), T1 = this.thrustOf(1, u);
    X += (T0 + T1) * 0.9; // thrust deduction
    N += (T1 - T0) * 0.0; // twin-screw lateral offset: port prop at -y, stbd at +y
    N += (T0 - T1) * S.propY * 0.5; // stbd prop ahead (T1>T0) turns bow to port

    // --- rudders (in each propeller slipstream)
    const Ap = Math.PI * Math.pow(S.propD / 2, 2);
    const delta = this.rudder * DEG;
    let Yr_ = 0, Nr_ = 0, Xr_ = 0;
    for (let i = 0; i < 2; i++) {
      const Ti = i === 0 ? T0 : T1;
      const ua = u * 0.74;
      let UR2 = ua * Math.abs(ua);
      if (Ti > 0) UR2 = Math.max(0, ua) * Math.max(0, ua) + 1.25 * Ti / (rho * Ap);
      // astern: rudder in reverse flow is weak
      const sgn = UR2 >= 0 ? 1 : -0.5;
      const UR2a = Math.abs(UR2);
      const alpha = delta - (v * 0.3) / Math.max(1, Math.sqrt(UR2a)) * 0; // simplified
      const fa = 3.1;
      const stall = Math.abs(this.rudder) > 36 ? 0.7 : 1;
      const FN = 0.5 * rho * S.rudderArea * fa * Math.sin(alpha) * UR2a * sgn * stall;
      Yr_ += -(1 + 0.25) * FN * Math.cos(delta);
      Nr_ += (0.5 * L + 0.25 * 0.45 * L) * FN * Math.cos(delta);
      Xr_ += -Math.abs(FN * Math.sin(delta)) * 0.35;
    }
    X += Xr_; Y += Yr_; N += Nr_;

    // --- bow thrusters (lose effect with speed)
    const ueff = Math.abs(u);
    const thrEff = 1 / (1 + Math.pow(ueff / 1.35, 2.2));
    const Fbt = (this.bowThr[0] + this.bowThr[1]) * S.bowThrMax * thrEff;
    Y += Fbt; N += Fbt * S.bowThrX;

    // --- wind (relative)
    const [fx, fz] = this.fwd(), [sx, sz] = this.stb();
    const vgx = u * fx + v * sx + Math.sin(this.curSetTo) * this.curSpeed;
    const vgz = u * fz + v * sz - Math.cos(this.curSetTo) * this.curSpeed;
    const wTo = this.windFrom + Math.PI;
    const wx = Math.sin(wTo) * this.windSpeed - vgx;
    const wz = -Math.cos(wTo) * this.windSpeed - vgz;
    const wb = wx * fx + wz * fz, ws = wx * sx + wz * sz; // relative wind (air velocity) in body axes
    const Vr2 = wb * wb + ws * ws;
    if (Vr2 > 0.01) {
      const gam = Math.atan2(ws, wb); // direction the air moves in body frame
      const qA = 0.5 * S.rhoAir * Vr2;
      const Xw = qA * S.windAreaFront * 0.7 * Math.cos(gam);
      const Yw = qA * S.windAreaLat * 0.9 * Math.sin(gam);
      // centre of pressure shifts toward the leading end
      const Nw = Yw * (0.10 * L * Math.cos(gam)) + qA * S.windAreaLat * L * 0.02 * Math.sin(2 * gam) * -0.2;
      X += Xw; Y += Yw; N += Nw;
      this._windRel = { speed: Math.sqrt(Vr2), angle: gam };
    }

    // --- tugs
    for (let t = 0; t < this.tugs.length; t++) {
      const tg = this.tugs[t];
      if (!tg.attached) { tg.power = Math.max(0, tg.power - dt * 0.2); this.forceLog.tugs[t] = 0; continue; }
      tg.power += clamp(tg.powerCmd - tg.power, -0.08 * dt, 0.08 * dt);
      let dd = ((tg.dirCmd - tg.dir + 540) % 360) - 180;
      tg.dir = (tg.dir + clamp(dd, -2.2 * dt, 2.2 * dt) + 360) % 360;
      const speedLoss = clamp(1 - (Math.abs(u) / KN - 4.5) / 4, 0, 1);
      const F = tg.power * 690e3 * speedLoss; // ~70 t bollard pull ASD tug
      const a = tg.dir * DEG;
      const Fx = F * Math.cos(a), Fy = F * Math.sin(a);
      X += Fx; Y += Fy; N += tg.xb * Fy;
      this.forceLog.tugs[t] = F;
    }

    // --- contacts (quay fenders, land, other ships) and grounding
    const cs = Math.cos(this.psi), sn = Math.sin(this.psi);
    let contactPts = 0, maxNormal = 0;
    this.grounded = 0;
    for (let k = 0; k < this._hullPts.length; k++) {
      const [xb, yb] = this._hullPts[k];
      const px = this.x + xb * sn + yb * cs, pz = this.z - xb * cs + yb * sn;
      const pvb = [u - r * yb, v + r * xb];
      const pvx = pvb[0] * fx + pvb[1] * sx + Math.sin(this.curSetTo) * this.curSpeed;
      const pvz = pvb[0] * fz + pvb[1] * sz - Math.cos(this.curSetTo) * this.curSpeed;
      const c = env.contact(px, pz, pvx, pvz, xb, yb);
      if (c) {
        const Fb = c.fx * fx + c.fz * fz, Fs = c.fx * sx + c.fz * sz;
        X += Fb; Y += Fs; N += xb * Fs - yb * Fb;
        contactPts++;
        maxNormal = Math.max(maxNormal, c.normalSpeed || 0);
        if (c.kind && env.onContact) env.onContact(c, px, pz);
      }
      // grounding under side points and centreline
      const d = env.depthAt(px, pz);
      const pen = (T + this.squat * 0.5) - d;
      if (pen > 0) this.grounded = Math.max(this.grounded, pen);
    }
    if (this.grounded > 0) {
      // bottom friction – massive
      const g = Math.min(1, this.grounded / 1.5);
      X += -Math.sign(u) * g * 2.2e7 - u * 2e7 * g;
      Y += -Math.sign(v) * g * 1.5e7 - v * 3e7 * g;
      N += -r * 3e12 * g;
    }
    this.contact.active = contactPts > 0;
    this.contact.points = contactPts;
    this.contact.speed = maxNormal;

    // --- mooring lines (after "all fast"): springs to the berth pose
    if (this.lines) {
      const Ln = this.lines;
      Ln.tension = Math.min(1, Ln.tension + dt * 0.02);
      const k = 1.6e6 * Ln.tension, c = 2.2e8 * Ln.tension;
      const ex = Ln.tx - this.x, ez = Ln.tz - this.z;
      const Fxw = k * ex - c * 0.002 * vgx * 0, Fzw = k * ez;
      X += Fxw * fx + Fzw * fz - c * 0.02 * u;
      Y += Fxw * sx + Fzw * sz - c * 0.02 * v;
      let dpsi = ((Ln.tpsi - this.psi + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      N += 4e11 * Ln.tension * dpsi - 8e13 * Ln.tension * r;
    }

    // --- integrate (body frame, with centripetal coupling)
    const du = (X + 0.55 * my * v * r) / mx;
    const dv = (Y - mx * u * r) / my;
    const drr = N / Iz;
    this.u += du * dt;
    this.v += dv * dt;
    this.r += drr * dt;
    // numerical settling for very low speeds
    if (Math.abs(this.u) < 1e-4 && Math.abs(T0 + T1) < 1) this.u = 0;

    const nfx = Math.sin(this.psi), nfz = -Math.cos(this.psi);
    const nsx = Math.cos(this.psi), nsz = Math.sin(this.psi);
    this.vgx = this.u * nfx + this.v * nsx + Math.sin(this.curSetTo) * this.curSpeed;
    this.vgz = this.u * nfz + this.v * nsz - Math.cos(this.curSetTo) * this.curSpeed;
    this.x += this.vgx * dt;
    this.z += this.vgz * dt;
    this.psi = (this.psi + this.r * dt + Math.PI * 2) % (Math.PI * 2);

    this.sog = Math.hypot(this.vgx, this.vgz);
    this.cog = (Math.atan2(this.vgx, -this.vgz) + Math.PI * 2) % (Math.PI * 2);
    this.rotDegMin = this.r / DEG * 60;
  }

  // transverse speeds at bow & stern (Doppler log), m/s, + = to starboard
  transverse(xb) { return this.v + this.r * xb; }
}
