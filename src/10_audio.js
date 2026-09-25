// ============================================================================
// 10 — AUDIO (fully synthesised with WebAudio) & ALARMS
// ============================================================================
const AUDIO = {
  ctx: null, on: true,
  init() {
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(c.destination);
    // echo bus (harbour reflections for the whistle)
    this.echo = c.createDelay(2.0); this.echo.delayTime.value = 0.42;
    const fb = c.createGain(); fb.gain.value = 0.32; const eg = c.createGain(); eg.gain.value = 0.35;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    this.echo.connect(lp); lp.connect(fb); fb.connect(this.echo); lp.connect(eg); eg.connect(this.master);
    this.echoIn = this.echo;
    const noise = (type) => {
      const len = c.sampleRate * 3, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
      let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else if (type === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
        else d[i] = w;
      }
      const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.start(); return s;
    };
    const chain = (src, type, f, q, g) => { const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const gn = c.createGain(); gn.gain.value = g; src.connect(fl); fl.connect(gn); gn.connect(this.master); return { fl, gn }; };
    // engine: rumble + firing-order thump
    this.eng = chain(noise('brown'), 'lowpass', 90, 0.7, 0.2);
    this.engOsc = c.createOscillator(); this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 32;
    const eo = chain(this.engOsc, 'lowpass', 110, 1, 0.05); this.engOscG = eo.gn; this.engOsc.start();
    this.lfo = c.createOscillator(); this.lfo.frequency.value = 4; const lg = c.createGain(); lg.gain.value = 0.03; this.lfo.connect(lg); lg.connect(this.eng.gn.gain); this.lfo.start();
    this.hvac = chain(noise('pink'), 'bandpass', 520, 0.6, 0.035);
    this.hum = c.createOscillator(); this.hum.frequency.value = 60; const hg = chain(this.hum, 'lowpass', 200, 1, 0.006); this.hum.start();
    this.wind = chain(noise('pink'), 'bandpass', 700, 0.9, 0.0);
    this.water = chain(noise('white'), 'lowpass', 700, 0.5, 0.0);
    this.thr = chain(noise('brown'), 'lowpass', 70, 1, 0.0);
    // whistle
    this.wh = c.createGain(); this.wh.gain.value = 0; const whl = c.createBiquadFilter(); whl.type = 'lowpass'; whl.frequency.value = 1100;
    for (const [f, a] of [[72, 0.5], [144.6, 0.32], [216.5, 0.2], [289, 0.12]]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = c.createGain(); g.gain.value = a; o.connect(g); g.connect(whl); o.start(); }
    whl.connect(this.wh); this.wh.connect(this.master); this.wh.connect(this.echoIn);
    this.gullT = 5;
  },
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); },
  env(g, t, a, peak, d) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); },
  tone(f, dur, type = 'sine', vol = 0.1, delay = 0) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.value = f; const g = c.createGain(); o.connect(g); g.connect(this.master);
    this.env(g, t, 0.005, vol, dur); o.start(t); o.stop(t + dur + 0.1);
  },
  click() { if (!this.ctx) return; this.tone(2400, 0.03, 'square', 0.03); this.tone(900, 0.04, 'sine', 0.04); },
  beep(f = 1000, d = 0.12) { this.tone(f, d, 'square', 0.04); },
  telegraph() { if (!this.ctx) return; for (const dl of [0, 0.32]) for (const [f, v] of [[1318, 0.12], [2637, 0.05], [3960, 0.025]]) this.tone(f, 1.2, 'sine', v, dl); },
  squelch() {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const len = c.sampleRate * 0.18, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(); s.buffer = b; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.8; const g = c.createGain(); g.gain.value = 0.08;
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  },
  bell() { if (!this.ctx) return; for (const [f, v, d] of [[587, 0.14, 3.5], [1415, 0.07, 2.4], [2390, 0.04, 1.6], [3120, 0.02, 1.1], [293, 0.05, 3.8]]) this.tone(f, d, 'sine', v); },
  thud(k = 1) { if (!this.ctx) return; this.tone(42, 1.6, 'sine', 0.35 * k); this.tone(70, 0.9, 'triangle', 0.15 * k); this.tone(28, 2.2, 'sine', 0.25 * k); },
  horn(dur = 1, pitch = 1) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.connect(this.master); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.08); g.gain.setValueAtTime(0.12, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    for (const f of [180 * pitch, 361 * pitch]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const lp = c.createBiquadFilter(); lp.frequency.value = 1200; o.connect(lp); lp.connect(g); o.start(t); o.stop(t + dur + 0.4); }
  },
  gull() { if (!this.ctx) return; const c = this.ctx, t = c.currentTime; for (let k = 0; k < 3; k++) { const o = c.createOscillator(); o.type = 'triangle'; const g = c.createGain(); o.connect(g); g.connect(this.master); const t0 = t + k * 0.28; o.frequency.setValueAtTime(1600, t0); o.frequency.exponentialRampToValueAtTime(900, t0 + 0.22); this.env(g, t0, 0.02, 0.012, 0.22); o.start(t0); o.stop(t0 + 0.3); } },
  update(dt) {
    if (!this.ctx) return;
    const s = G.ship, c = this.ctx, t = c.currentTime;
    const inside = G.mode === 'bridge';
    const rpm = (Math.abs(s.rpm[0]) + Math.abs(s.rpm[1])) / 2;
    const set = (p, v) => p.setTargetAtTime(v, t, 0.3);
    set(this.eng.gn.gain, (0.1 + rpm / 70 * 0.35) * (inside ? 1 : 0.5));
    set(this.eng.fl.frequency, 55 + rpm * 1.5);
    set(this.engOsc.frequency, 22 + rpm * 0.55);
    set(this.engOscG.gain, 0.01 + rpm / 70 * 0.06);
    set(this.lfo.frequency, Math.max(0.5, rpm / 60 * 8));
    set(this.hvac.gn.gain, inside ? 0.035 : 0.0);
    const ws = (s._windRel ? s._windRel.speed : 0);
    set(this.wind.gn.gain, clamp(ws / 14, 0, 1) * (inside ? 0.035 : 0.15));
    set(this.water.gn.gain, clamp(s.sog / 8, 0, 1) * (inside ? 0.012 : 0.08) + (G.mode === 'orbit' ? 0.02 : 0));
    set(this.thr.gn.gain, (Math.abs(s.bowThr[0]) + Math.abs(s.bowThr[1])) * 0.18);
    const tugPow = s.tugs.reduce((a, tg) => a + (tg.attached ? tg.power : 0), 0);
    set(this.thr.fl.frequency, 60 + tugPow * 20);
    set(this.wh.gain, G.whistle ? 0.22 : 0.0);
    this.gullT -= dt;
    if (this.gullT < 0) { this.gullT = rr(4, 14); if (s.x > -3500) this.gull(); }
  },
};

// ------------------------------------------------------------- alarms
const ALARMS = {
  active: {}, acked: {}, t: 0,
  set(id, on, text, level = 'alarm') {
    if (on) { if (!this.active[id]) { this.active[id] = { text, level }; delete this.acked[id]; } else this.active[id].text = text; }
    else { delete this.active[id]; delete this.acked[id]; }
  },
  ack() { for (const k in this.active) this.acked[k] = true; },
  update(dt) {
    this.t += dt;
    const s = G.ship;
    this.set('ukc', s.ukc < 2.0 && s.sog > 0.2, 'SHALLOW WATER — UKC ' + s.ukc.toFixed(1) + ' m');
    this.set('cpa', !!G.cpaAlarm, 'CPA / TCPA ALARM', 'caution');
    const err = wrap180(G.apHeading - s.psi / DEG);
    this.set('offhdg', G.steering === 'AUTO' && Math.abs(err) > 10, 'OFF HEADING ' + err.toFixed(0) + '°', 'caution');
    this.set('bnwas', G.steering === 'AUTO' && (G.bnwasT || 0) > 720, 'BNWAS — press RESET');
    this.set('xte', (() => { const r = routeProgress(s); return Math.abs(r.xte) > 250 && s.x < -2500; })(), 'CROSS TRACK ERROR', 'caution');
    // audible
    const sounding = Object.keys(this.active).filter((k) => !this.acked[k] && this.active[k].level === 'alarm');
    if (sounding.length && Math.floor(this.t * 2) !== this._last) { this._last = Math.floor(this.t * 2); if (this._last % 2 === 0) AUDIO.beep(1760, 0.18); }
  },
};
