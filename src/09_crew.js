// ============================================================================
// 09 — CREW: humanoid models, animation, pathing, speech, delegated orders
// ============================================================================
// (the bodies are built in 09b_body.js: buildHuman(look) returns the rig this file animates)

// ------------------------------------------------------------- speech
// Neural voices: Kokoro-82M (Apache-2.0) runs in a Web Worker on WebGPU (or threaded WASM if cross-origin isolated).
// The model (~330 MB fp32) comes from Hugging Face once and stays in the browser cache. Until it is ready, or if
// this machine is too slow for it, lines fall back to the browser's own speechSynthesis.
const KOKORO = {
  lib: 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js',
  model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  // [voice, speed] per speaker; the stations on deck are the C/O and 2/O on their handhelds
  voices: { co: ['bm_george', 1.0], o2: ['af_heart', 1.02], o3: ['am_michael', 1.0], ab: ['am_puck', 1.0], pilot: ['bm_fable', 1.04],
    ce: ['am_fenrir', 0.98], vts: ['bf_emma', 1.08], t1: ['bm_lewis', 1.08], t2: ['am_eric', 1.08], pb: ['am_liam', 1.06],
    fwd: ['bm_george', 1.04], aft: ['af_heart', 1.04], hx: ['am_onyx', 1.04] },
};
const KOKORO_WORKER = `
let tts = null, chain = Promise.resolve();
const dropped = new Set();
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'cancel') { dropped.add(m.id); return; }
  if (m.type === 'load') { chain = chain.then(() => load(m)); return; }
  if (m.type === 'say') chain = chain.then(() => say(m));
};
async function load(m) {
  try {
    const { KokoroTTS } = await import(m.lib);
    const progress_callback = (p) => { if (p.status === 'progress' && /onnx/.test(p.file || '')) self.postMessage({ type: 'progress', p: p.progress }); };
    let device = 'wasm';
    if (m.webgpu) {
      try { tts = await KokoroTTS.from_pretrained(m.model, { dtype: 'fp32', device: 'webgpu', progress_callback }); device = 'webgpu'; }
      catch (err) { tts = null; }
    }
    // WASM is only quick enough with threads, which need cross-origin isolation (GitHub Pages can't send those headers)
    if (!tts && self.crossOriginIsolated) tts = await KokoroTTS.from_pretrained(m.model, { dtype: 'q8', device: 'wasm', progress_callback });
    if (!tts) throw new Error('no WebGPU');
    await tts.generate('Ready.', { voice: 'af_heart' });     // warm up the kernels
    self.postMessage({ type: 'ready', device });
  } catch (err) { self.postMessage({ type: 'fail', msg: String((err && err.message) || err) }); }
}
async function say(m) {
  if (!tts || dropped.has(m.id)) { self.postMessage({ type: 'done', id: m.id }); return; }
  try {
    // one sentence at a time so playback can start early (kokoro-js 1.2.1's stream() never ends on a plain string)
    for (const t of m.text.split(/(?<=[.!?])\\s+/).filter((x) => /\\w/.test(x))) {
      if (dropped.has(m.id)) break;
      const audio = await tts.generate(t, { voice: m.voice, speed: m.speed });
      const pcm = audio.audio;
      self.postMessage({ type: 'chunk', id: m.id, pcm, rate: audio.sampling_rate }, [pcm.buffer]);
    }
    self.postMessage({ type: 'done', id: m.id });
  } catch (err) { self.postMessage({ type: 'error', id: m.id, msg: String(err) }); }
}`;
const NEURAL = {
  state: 'off', w: null, jobs: {}, n: 0, device: '', slow: 0,
  ok() { return this.state === 'ready' && CFG.voice === 'on'; },
  load() {
    if (this.state !== 'off' || CFG.voice !== 'on' || typeof Worker === 'undefined') return;
    if (!('gpu' in navigator) && !self.crossOriginIsolated) { this.state = 'failed'; return; }
    this.state = 'loading';
    try { this.w = new Worker(URL.createObjectURL(new Blob([KOKORO_WORKER], { type: 'text/javascript' })), { type: 'module' }); }
    catch (e) { this.state = 'failed'; return; }
    this.w.onmessage = (e) => this.msg(e.data);
    this.w.onerror = (e) => { console.warn('Neural voices unavailable', e.message); this.state = 'failed'; };
    this.w.postMessage({ type: 'load', lib: KOKORO.lib, model: KOKORO.model, webgpu: 'gpu' in navigator });
  },
  msg(m) {
    if (m.type === 'ready') { this.state = 'ready'; this.device = m.device; console.info('Neural crew voices ready (' + m.device + ')'); return; }
    if (m.type === 'fail') { this.state = 'failed'; console.warn('Neural voices unavailable:', m.msg); return; }
    if (m.type === 'progress') { this.progress = m.p; return; }
    const j = this.jobs[m.id]; if (!j) return;
    if (m.type === 'chunk') {
      j.chunks.push({ pcm: m.pcm, rate: m.rate });
      j.samples += m.pcm.length / m.rate;
      if (!j.firstT) j.firstT = performance.now();
    }
    if (m.type === 'done' || m.type === 'error') {
      j.done = true; if (m.type === 'error') j.failed = true;
      delete this.jobs[m.id];
      // far slower than real time (single-threaded WASM on a weak CPU): give up and use the system voice
      const gen = (performance.now() - j.t0) / 1000;
      if (j.samples > 1.5) this.slow = gen / j.samples > 1.4 ? this.slow + 1 : 0;
      if (this.slow >= 3) { this.state = 'failed'; console.warn('Neural voices too slow here — using system speech'); }
    }
    if (j.wake) j.wake();
  },
  request(id, text) {
    const [voice, speed] = KOKORO.voices[id] || ['am_michael', 1];
    const j = { key: ++this.n, chunks: [], samples: 0, done: false, failed: false, t0: performance.now(), firstT: 0, wake: null };
    this.jobs[j.key] = j;
    this.w.postMessage({ type: 'say', id: j.key, text, voice, speed });
    return j;
  },
  cancel(j) { if (j && !j.done) { this.w.postMessage({ type: 'cancel', id: j.key }); j.done = true; delete this.jobs[j.key]; } },
};
// what the TTS should say for a subtitle line
function speakable(t) {
  return t.replace(/°/g, ' degrees').replace(/\bkn\b/g, 'knots').replace(/…/g, ', ')
    .replace(/\bOYGR2\b/g, 'Oscar Yankee Golf Romeo Two').replace(/Maersk/g, 'Mersk')
    .replace(/\b[A-Z]{4,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());
}

const SPEECH = {
  queue: [], busy: false, voices: [], cur: null, gen: 0,
  speaking(id) { return this.cur === id || this.queue.some((q) => q.id === id); },
  init() {
    NEURAL.load();
    if (!('speechSynthesis' in window)) return;
    const load = () => { this.voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); };
    load(); speechSynthesis.onvoiceschanged = load;
  },
  voiceFor(id) {
    const v = this.voices; if (!v.length) return null;
    const pref = { co: ['Daniel', 'Arthur', 'Oliver', 'Google UK English Male'], o2: ['Samantha', 'Tessa', 'Fiona', 'Victoria', 'Google US English'], o3: ['Rishi', 'Aaron', 'Fred', 'Google US English'], ab: ['Aaron', 'Fred', 'Alex', 'Google US English'],
      pilot: ['Xander', 'Arthur', 'Daniel', 'Google UK English Male'], ce: ['Fred', 'Ralph', 'Daniel'], vts: ['Moira', 'Serena', 'Karen', 'Google UK English Female'], t1: ['Ralph', 'Fred', 'Alex'], t2: ['Albert', 'Rocko', 'Fred', 'Alex'], pb: ['Alex', 'Tom', 'Aaron'], me: ['Alex'] }[id] || [];
    for (const n of pref) { const f = v.find((x) => x.name.includes(n)); if (f) return f; }
    return v[(id.charCodeAt(0) + id.length) % v.length];
  },
  // whose voice reads the line (the VTS id also carries HANSA EXPRESS's own calls)
  voiceId(it) { return it.id === 'vts' && /^[^,]+, HANSA EXPRESS:/.test(it.text) ? 'hx' : it.id; },
  // the bridge team is heard in the room; everyone else comes through the VHF speaker or the ECR phone
  onBridge(id) { const c = CREW.byId(id); return !!(c && c.present); },
  // `slot` names a running report (telegraph repeat, helm repeat…): a newer line drops the one still waiting in the queue
  say(id, text, radio, slot) {
    const it = { id, text, radio, slot };
    if (slot) this.queue = this.queue.filter((q) => { if (q.slot !== slot) return true; NEURAL.cancel(q.job); return false; });
    if (NEURAL.ok() && id !== 'me') it.job = NEURAL.request(this.voiceId(it), speakable(text));   // start synthesising while earlier lines play
    this.queue.push(it);
    if (this.queue.length > 5) for (const d of this.queue.splice(0, this.queue.length - 5)) NEURAL.cancel(d.job);
    if (!this.busy) this.next();
  },
  clear() { for (const d of this.queue) NEURAL.cancel(d.job); this.queue = []; this.gen++; AUDIO.stopVoice(); if ('speechSynthesis' in window) speechSynthesis.cancel(); this.busy = false; this.cur = null; },
  next() {
    // the model is still coming in (first ~15 s of a first visit): hold the opening lines rather than say them robotically
    if (NEURAL.state === 'loading' && CFG.voice === 'on' && this.queue.length && performance.now() - (this._holdT ??= performance.now()) < 12000) {
      this.busy = true; setTimeout(() => this.next(), 250); return;
    }
    const it = this.queue.shift();
    if (!it) { this.busy = false; this.cur = null; return; }
    this.busy = true; this.cur = it.id;
    const gen = this.gen;
    const dur = Math.max(2.4, it.text.length * 0.062) * 1000;
    let done = false; const fin = () => { if (done || gen !== this.gen) return; done = true; if (it.radio) AUDIO.squelch(); setTimeout(() => this.next(), 250); };
    const begin = (len) => {
      const who = CREW.info[it.id] || { short: it.id, color: '#ccc' };
      UI.sub(who.short, it.text, it.id, it.radio);
      const c = CREW.byId(it.id); if (c) c.talk(len || Math.max(2, it.text.length * 0.065));
      if (it.radio) AUDIO.squelch();
    };
    if (CFG.voice !== 'on' || it.id === 'me') { begin(); setTimeout(fin, dur); return; }
    if (!it.job && NEURAL.ok()) it.job = NEURAL.request(this.voiceId(it), speakable(it.text));
    if (it.job) this.playNeural(it, begin, fin, gen);
    else { begin(); this.systemSay(it, fin, dur); }
  },
  // play a Kokoro job as its sentences arrive: dry and placed in the room for the bridge team, through the radio chain otherwise
  playNeural(it, begin, fin, gen) {
    const j = it.job, radio = !this.onBridge(it.id);
    let started = false, endT = 0, played = 0, out = null;
    const wait = setTimeout(() => {                     // nothing after 8 s: say it with the system voice instead
      if (started || gen !== this.gen) return; NEURAL.cancel(j); j.wake = null;
      begin(); this.systemSay(it, fin, Math.max(2.4, it.text.length * 0.062) * 1000);
    }, 8000);
    const pump = () => {
      if (gen !== this.gen) return;
      if (!started) {
        if (j.failed && !j.chunks.length) { clearTimeout(wait); j.wake = null; begin(); this.systemSay(it, fin, Math.max(2.4, it.text.length * 0.062) * 1000); return; }
        if (!j.chunks.length) return;
        clearTimeout(wait); started = true;
        out = AUDIO.voiceOut(radio, it.id);
        begin(j.done ? j.samples : Math.max(2, it.text.length * 0.065));
        endT = AUDIO.ctx ? AUDIO.ctx.currentTime + (radio ? 0.16 : 0.02) : 0;
      }
      while (played < j.chunks.length) endT = AUDIO.playPcm(j.chunks[played++], out, endT);
      if (j.done) {
        j.wake = null;
        const left = AUDIO.ctx ? Math.max(0, endT - AUDIO.ctx.currentTime) : 0;
        setTimeout(() => { if (out) out.end(); fin(); }, left * 1000 + 60);
      }
    };
    j.wake = pump; pump();
  },
  systemSay(it, fin, dur) {
    if (!('speechSynthesis' in window)) { setTimeout(fin, dur); return; }
    try {
      const u = new SpeechSynthesisUtterance(speakable(it.text));
      const v = this.voiceFor(it.id); if (v) u.voice = v;
      u.rate = { pilot: 1.08, vts: 1.1, t1: 1.12, t2: 1.12, ab: 1.05 }[it.id] || 1.0;
      u.pitch = { o2: 1.08, vts: 1.05, ab: 0.9, t1: 0.8, t2: 0.75, ce: 0.8, co: 0.95 }[it.id] || 1.0;
      u.volume = it.radio ? 0.8 : 1.0;
      let started = false;
      u.onstart = () => { started = true; };
      u.onend = fin; u.onerror = fin;
      speechSynthesis.speak(u);
      setTimeout(() => { if (!started && !speechSynthesis.speaking) { speechSynthesis.cancel(); setTimeout(fin, dur - 1500); } }, 1500);
      setTimeout(fin, dur * 1.6 + 2500);
    } catch (e) { setTimeout(fin, dur); }
  },
};

// ------------------------------------------------------------- crew member
// Where people work on the bridge: node in BR.nodes, facing (0 = forward, π = aft) and body pose.
const SPOTS = {
  vhf: { node: 'conL', face: 0, pose: 'radio' },       // VHF handset, module 3
  phone: { node: 'pilot', face: 0, pose: 'phone' },    // ECR telephone, module 4
  radarL: { node: 'radarL', face: 0, pose: 'console', seat: 'navL' }, radarR: { node: 'radarR', face: 0, pose: 'console', seat: 'navR' },   // sit down if the chair is free
  ecdL: { node: 'ecdL', face: 0, pose: 'console' }, ecdR: { node: 'ecdR', face: 0, pose: 'console' },
  steer: { node: 'apL', face: 0, pose: 'press' },      // steering mode / autopilot / nav lights
  engine: { node: 'tele', face: 0, pose: 'press' },    // engine mode buttons & telegraphs
  thr: { node: 'conR', face: 0, pose: 'press' },       // bow thruster panel
  dock: { node: 'dockR', face: 0, pose: 'console' },
  chart: { node: 'chart', face: Math.PI, pose: 'write' }, gmdss: { node: 'gmdss', face: Math.PI, pose: 'console' },
  coffee: { node: 'coffee', face: Math.PI, pose: 'press' },
  lookL: { node: 'sideL', face: -0.25, pose: 'binos' }, lookR: { node: 'sideR', face: 0.25, pose: 'binos' },
  wingL: { node: 'wingL', face: -0.5, pose: 'binos' }, wingR: { node: 'wingR', face: 0.5, pose: 'binos' },
  aft: { node: 'aftC', face: 0.3, pose: null },
};

const _ikS = { M: new THREE.Matrix4(), Mi: new THREE.Matrix4(), Mh: new THREE.Matrix4(), T: new THREE.Vector3(), S: new THREE.Vector3(), pole: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion() };
class CrewMember {
  constructor(id, look, node) {
    this.id = id; this.look = look;
    const h = buildHuman(look);
    Object.assign(this, h);
    this.group = h.root;
    const [x, z] = BR.nodes[node]; this.x = x; this.z = z; this.node = node;
    this.face = 0; this.targetFace = 0; this.path = []; this.state = 'idle';
    const seed = look.seed || 7; this.rng = mulberry32(seed * 977 + 13);
    this.gait = new HumGait(h, look, seed); this.speed = 0; this.vPref = 1.35 * ((look.gait && look.gait.speed) || 1);
    this.aj = [0, 1].map(() => ({ sx: 0, sy: 0, sz: 0, el: 0.14, pr: 0 })); this.at = [0, 1].map(() => ({ sx: 0, sy: 0, sz: 0, el: 0.14, pr: 0 }));
    this.gz = { yaw: 0, nod: 0, tYaw: 0, tNod: 0, t: 1 + this.rng() * 3, torsoYaw: 0 }; this.breathPh = this.rng() * 6.28;
    this.ikC = [0, 1].map(() => ({ on: false, space: 'root', x: 0, y: 0, z: 0, pole: [0, -1, 0], pr: 0, wx: 0 })); this.ikS = [0, 1].map(() => ({ w: 0, init: false, p: new THREE.Vector3() }));
    this.talkT = 0; this.present = true; this.idleT = this.rng() * 10;
    this.task = null; this.ambientT = 25 + Math.random() * 40;
    this.seat = null; this.sitK = 0; this.waitT = 0; this.ghostT = 0;
    this.group.position.set(x, 0, z);
    G.bridgeGroup.add(this.group);
    // handset at the right ear while on the radio or phone, binoculars at the eyes (both ride on the head; the hands are solved to them)
    this.handset = humHandset(); this.handset.visible = false; this.hc.add(this.handset);
    this.binoMesh = humBinoculars(); this.binoMesh.visible = false; this.hc.add(this.binoMesh);
    // interaction proxy (capsule)
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.9; this.group.add(hit);
    const info = CREW.info[id];
    interactive(hit, { name: info.name + ' — ' + info.role, hint: 'Give orders (or Tab)', click: () => UI.openCrewMenu(id) });
    this.hit = hit;
  }
  goTo(node, cb) {
    this.standUp();
    const path = CREW.findPath(this.nearestNode(), node);
    this.path = path.map((n) => BR.nodes[n].slice());
    this.node = node; this.onArrive = cb; this.state = 'walk';
  }
  nearestNode() { let b = null, bd = 1e9; for (const k in BR.nodes) { const [x, z] = BR.nodes[k]; const d = Math.hypot(x - this.x, z - this.z); if (d < bd) { bd = d; b = k; } } return b; }
  // take / leave a chair (the body blends between standing at the node and sitting on the cushion)
  sitDown(id) {
    const s = BR.seats.find((q) => q.id === id);
    if (!s || s.by) return false;
    s.by = this.id; this.seat = this.lastSeat = s;
    return true;
  }
  standUp() { if (this.seat) { if (this.seat.by === this.id) this.seat.by = null; this.seat = null; } }
  leave(cb) { this.task = null; this.goTo('door', () => { this.present = false; this.group.visible = false; this.hit.visible = false; cb && cb(); }); }
  enter(node, cb) { this.present = true; this.group.visible = true; this.hit.visible = true; const [x, z] = BR.nodes.door; this.x = x; this.z = z + 0.8; this.goTo(node, cb); }
  // usual place & posture when nothing else to do
  setHome(node, face = 0, pose = null) { this.home = { node, face, pose }; }
  goHome(cb) {
    const h = this.home; this.task = null;
    const settle = () => { this.idleFace = h.face; this.pose = h.pose; cb && cb(); };
    if (this.node === h.node && !this.path.length) { settle(); return; }
    this.pose = null; this.goTo(h.node, settle);
  }
  // Walk to a work spot, do the job (action runs on arrival), hold the pose, then go home.
  // key: CREW.ACTIONS entry (so a save can re-issue it); ambient tasks have no key and may be interrupted.
  doTask(spot, o = {}) {
    const sp = SPOTS[spot];
    this.task = { spot, key: o.key || null, arg: o.arg, dur: o.dur ?? 6, started: false, ambient: !!o.ambient };
    const t = this.task;
    this.pose = null;
    const arrive = () => {
      if (this.task !== t) return;
      t.started = true; t.left = t.dur;
      this.idleFace = sp.face; this.pose = sp.pose;
      if (sp.seat) this.sitDown(sp.seat);
      if (t.key) CREW.ACTIONS[t.key](this, t.arg);
      if (o.fn) o.fn(this);
    };
    if (this.node === sp.node && !this.path.length) arrive(); else this.goTo(sp.node, arrive);
  }
  busy() { return !!this.task || this.path.length > 0; }
  // One walking step with local avoidance: side-step people ahead (both keep to starboard when
  // meeting head-on), never into furniture, and wait if boxed in. Returns true if they moved.
  step(ux, uz, st, dt) {
    const px = -uz, pz = ux, others = CREW.others(this, this.ghostT > 0), R = 0.6;
    let lat = 0, blocker = null;
    for (const o of others) {
      const rx = o.x - this.x, rz = o.z - this.z, ahead = rx * ux + rz * uz, side = rx * px + rz * pz;
      if (ahead < -0.1 || ahead > 2.2 || Math.abs(side) > 0.85) continue;
      lat += (Math.abs(side) < 0.1 ? 1 : -Math.sign(side)) * (1 - Math.abs(side) / 0.85) * (1 - Math.max(0, ahead) / 2.2);
    }
    const cur = CREW.intrusion(this.x, this.z);
    // a candidate direction is fine if it does not walk into anyone (or, for detours, into furniture —
    // the path itself is known to be clear)
    const ok = (vx, vz, detour) => {
      const nx = this.x + vx * st, nz = this.z + vz * st;
      if (detour && CREW.intrusion(nx, nz) > cur + 1e-4) return false;
      for (const o of others) {
        const dn = Math.hypot(nx - o.x, nz - o.z);
        if (dn < R && dn < Math.hypot(this.x - o.x, this.z - o.z)) { blocker = o; return false; }
      }
      this.x = nx; this.z = nz; this.waitT = 0;
      return true;
    };
    const sd = lat < 0 ? -1 : 1, q = clamp(lat, -1, 1) * 1.5;
    const dir = (k) => { const vx = ux + px * k, vz = uz + pz * k, l = Math.hypot(vx, vz); return [vx / l, vz / l]; };
    if (lat && ok(...dir(q), true)) return true;
    if (ok(ux, uz, false)) return true;
    if (ok(...dir(sd * 2.5), true)) return true;       // squeeze past sideways as a last resort
    // boxed in: wait; ask the Master to make way; two crew stuck on each other squeeze past after a while
    this.waitT += dt;
    if (blocker && blocker.player && this.waitT > 1.2 && G.simT - (this._excuseT ?? -99) > 25 && !SPEECH.speaking(this.id)) {
      this._excuseT = G.simT;
      CREW.say(this.id, pick(['Excuse me, Captain.', 'Sorry Captain — may I pass?', 'Coming through, Captain.']));
    }
    if (this.waitT > 4 && !(blocker && blocker.player)) { this.ghostT = 1.5; this.waitT = 0; }
    return false;
  }
  talk(sec) { this.talkT = sec; }
  // preferred walking speed: the C/O strolls, the helmsman is brisk; faster when the game clock runs fast, but never into a run
  walkSpeed() { return Math.min(2.15, this.vPref * Math.min(1.7, Math.max(1, G.timeScale * 0.6))); }
  // forget everything about where the feet were (after a teleport or a restore)
  resetPose() { this.gait.init = false; this.speed = 0; }
  update(dt) {
    if (!this.present) return;
    const rdt = dt, gt = this.gait;
    let moving = false;
    // sitting down / getting up takes a moment; walking only starts once standing
    this.sitK = clamp(this.sitK + (this.seat ? 1 : -1) * rdt * 1.3, 0, 1);
    if (this.ghostT > 0) this.ghostT -= rdt;
    const px0 = this.x, pz0 = this.z;
    if (this.path.length && this.sitK < 0.05) {
      // reached waypoints are dropped first, so no frame is lost at a corner (the next leg starts at once)
      let tx, tz, dx, dz, d, last;
      for (;;) {
        [tx, tz] = this.path[0]; dx = tx - this.x; dz = tz - this.z; d = Math.hypot(dx, dz); last = this.path.length === 1;
        // someone is standing on the spot: stop next to them (last waypoint) or cut the corner (on the way)
        const onSpot = d < (last ? 1.0 : 0.9) && CREW.others(this).some((o) => Math.hypot(o.x - tx, o.z - tz) < 0.5);
        if (!(d < (last ? 0.035 : 0.08) || onSpot)) break;
        this.path.shift(); this.waitT = 0;
        if (!this.path.length) { this.state = 'idle'; this.speed = Math.min(this.speed, 0.25); const cb = this.onArrive; this.onArrive = null; cb && cb(); d = -1; break; }
      }
      if (d >= 0) {
        // speed: turn first and then walk, slow for corners, brake so as to arrive at a standstill, ease up and down
        let rem = d; for (let i = 1; i < this.path.length; i++) rem += Math.hypot(this.path[i][0] - this.path[i - 1][0], this.path[i][1] - this.path[i - 1][1]);
        let want = this.walkSpeed();
        const aim = Math.atan2(-dx, -dz), dFace = Math.atan2(Math.sin(aim - this.face), Math.cos(aim - this.face));
        want *= clamp(1.25 - Math.abs(dFace) / 1.2, 0.08, 1);
        if (this.path.length > 1) { const [nx, nz] = this.path[1], a2 = Math.atan2(-(nx - tx), -(nz - tz)), ang = Math.abs(Math.atan2(Math.sin(a2 - aim), Math.cos(a2 - aim))); if (ang > 0.5) want = Math.min(want, 0.75 + 0.25 * d); }
        want = Math.min(want, Math.sqrt(2 * 1.5 * Math.max(0, rem - 0.02)) + 0.04);
        const acc = this.speed < want ? 1.4 : 2.4;
        this.speed = clamp(this.speed + clamp(want - this.speed, -acc * rdt, acc * rdt), 0, 3);
        const ox = this.x, oz = this.z;
        if (this.speed > 1e-4 && this.step(dx / d, dz / d, Math.min(d, this.speed * rdt), rdt)) { this.targetFace = Math.atan2(-(this.x - ox), -(this.z - oz)); moving = true; }
        else this.speed = Math.max(0, this.speed - 3 * rdt);
      }
    } else this.speed = Math.max(0, this.speed - 3 * rdt);
    this.moveHold = moving ? 0.12 : Math.max(0, (this.moveHold || 0) - rdt);
    // task timing: keep the pose while they are still talking on the radio / phone
    const t = this.task;
    if (t && t.started) {
      t.left -= rdt;
      if (t.left <= 0 && !SPEECH.speaking(this.id)) this.goHome();
    }
    if (!moving) {
      // face forward (or the player if talking face to face)
      if (this.talkT > 0 && PLAYER.inBridge() && !(t && t.started)) { const p = PLAYER.pos(); this.targetFace = Math.atan2(-(p.x - this.x), -(p.z - this.z)); }
      else this.targetFace = this.idleFace ?? 0;
    }
    // turning: a rate-limited, eased turn (the head leads, see below), faster while walking
    const df = ((this.targetFace - this.face + Math.PI * 3) % (Math.PI * 2)) - Math.PI, rate = moving ? 3.6 : 2.6;
    this.face += clamp(df * 6 * rdt, -rate * rdt, rate * rdt);
    // seated: body on the cushion (a little back), chair swivels with the sitter
    const k = this.sitK * this.sitK * (3 - 2 * this.sitK), st = this.lastSeat;
    let seat = null;
    if (k > 0 && st) {
      const bx = st.x + Math.sin(this.face) * 0.06, bz = st.z + Math.cos(this.face) * 0.06;
      this.group.position.set(lerp(this.x, bx, k), 0, lerp(this.z, bz, k));
      if (this.seat && st.chair) st.chair.rotation.y += (this.face - st.chair.rotation.y) * Math.min(1, rdt * 4);
      const rest = st.h > 0.8;
      seat = { h: st.h, rootX: bx, rootZ: bz, footF: rest ? 0.26 : 0.2, footY: rest ? 0.378 : 0 };
    } else this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.face;
    const gp = this.group.position;
    // ---- legs and pelvis (planted feet, IK)
    gt.update(rdt, { x: gp.x, z: gp.z, face: this.face, speed: moving || this.moveHold > 0 ? this.speed : 0, walking: moving || this.moveHold > 0, sitK: k, seat });
    const wa = gt.out.walkAmt, onRadio = !moving && (this.pose === 'radio' || this.pose === 'phone');
    this.handset.visible = onRadio;
    this.idleT += rdt;
    const ph = this.idleT, sitting = k;
    // ---- trunk: breathing, lean, counter-rotation against the pelvis
    const breath = Math.sin(this.breathPh + ph * 1.7) * 0.013 + 0.004 * Math.sin(ph * 0.31);
    this.chest.scale.set(1 + breath, 1 + breath * 0.3, 1 + breath * 1.3);
    const task = this.pose === 'console' || this.pose === 'press' || this.pose === 'write';
    const leanPose = (task ? 0.08 : 0) + (this.pose === 'write' ? 0.1 : 0) + sitting * 0.05 + (this.look.gait && this.look.gait.stoop || 0) * (0.6 + 0.4 * (1 - wa));
    this.torso.rotation.set(gt.leanF * (1 - sitting) + leanPose, -1.55 * gt.yawP * wa + this.gz.torsoYaw, gt.leanS - 0.5 * gt.rollP, 'YXZ');
    // ---- arms: swing against the legs while walking, the task pose otherwise
    const aj = this.aj, A = this.arms;
    this.armTargets(ph, onRadio);
    for (let i = 0; i < 2; i++) {
      const a = aj[i], T = this.at[i], s = i === 0 ? -1 : 1;
      let sx = T.sx, sz = T.sz, sy = T.sy, el = T.el, pr = T.pr;
      if (wa > 0.01) {
        // arm swing: opposite to the leg on the same side, growing with speed; the elbow flexes more as the arm comes forward
        const off = i === 0 ? gt.out.offR : gt.out.offL, sw = -0.04 + 0.95 * gt.armK * off;
        const swEl = 0.2 + 0.5 * clamp((sw + 0.22) / 0.55, 0, 1) + 0.12 * clamp(this.speed - 1, 0, 1);
        sx = lerp(sx, sw, wa); sz = lerp(sz, s * 0.07, wa); sy = lerp(sy, 0, wa); el = lerp(el, swEl, wa); pr = lerp(pr, 0, wa);
      }
      const tau = wa > 0.3 ? 0.035 : 0.1;
      a.sx = humDamp(a.sx, sx, rdt, tau); a.sy = humDamp(a.sy, sy, rdt, tau); a.sz = humDamp(a.sz, sz, rdt, tau); a.el = humDamp(a.el, el, rdt, tau); a.pr = humDamp(a.pr, pr, rdt, tau);
      A[i].sh.rotation.set(a.sx, a.sy, a.sz); A[i].el.rotation.set(a.el, 0, 0);
      A[i].fa.rotation.y = a.pr * 0.5; A[i].wr.rotation.y = a.pr * 0.5; A[i].wr.rotation.x = 0;
    }
    // hands on the desk, at the ear or at the eyes: solved from where the hand has to be, so the pose fits every body
    this.hips.updateMatrix(); this.torso.updateMatrix(); _ikS.M.multiplyMatrices(this.hips.matrix, this.torso.matrix); _ikS.Mi.copy(_ikS.M).invert();
    for (let i = 0; i < 2; i++) this.applyArmIK(i, this.ikC[i], rdt);
    if (this.binoMesh) this.binoMesh.visible = this.pose === 'binos' && this.ikS[0].w > 0.6;
    // ---- head: looks where it is going, nods when talking, glances around when idle; levelled against the body's motion
    const gz = this.gz; gz.t -= rdt;
    if (gz.t <= 0) {
      gz.t = 1.6 + this.rng() * 3.8; const amp = this.pose ? 0.2 : 0.42;
      gz.tYaw = (this.rng() - 0.5) * 2 * amp; gz.tNod = (this.rng() - 0.5) * 0.12;
      if (this.pose === 'binos') gz.tYaw = Math.sin(this.idleT * 0.15) * 0.25;
    }
    let tYaw = gz.tYaw, tNod = gz.tNod + (task ? -0.25 : 0) + (onRadio ? 0.05 : 0);
    if (moving) { tYaw *= 0.3; tNod = tNod * 0.4 - 0.02; }
    // anticipation: when the body is turning to face something the head gets there first
    const lead = clamp(df * 0.55, -0.7, 0.7); tYaw += lead * (moving ? 0.4 : 1);
    if (this.talkT > 0) { this.talkT -= rdt; tNod += Math.sin(ph * 6) * 0.05; tYaw *= 0.4; }
    gz.yaw = humDamp(gz.yaw, tYaw, rdt, 0.22); gz.nod = humDamp(gz.nod, tNod, rdt, 0.2);
    gz.torsoYaw = humDamp(gz.torsoYaw, clamp(gz.yaw * 0.25, -0.2, 0.2) * (1 - wa), rdt, 0.4);
    const tr = this.torso.rotation, hp = this.hips.rotation;
    this.head.rotation.set(gz.nod - tr.x * 0.6 - hp.x * 0.3, gz.yaw - (tr.y + hp.y) * 0.85 - gz.torsoYaw, -(tr.z + hp.z) * 0.8, 'YXZ');
    this.neck.rotation.set(0, 0, 0);
  }
  // arm targets (shoulder flexion / rotation / abduction, elbow flexion, pronation) for each arm by pose
  armTargets(ph, onRadio) {
    const T = this.at, C = this.ikC, set = (a, sx, sz, el, pr = 0, sy = 0) => { a.sx = sx; a.sy = sy; a.sz = sz; a.el = el; a.pr = pr; };
    const L = T[0], R = T[1], pose = this.pose;
    // IK hand targets: space 'root' (x right, y up from the floor, z back; wrist position) or 'head' (head-centre frame); pole = where the elbow points
    const ik = (i, space, x, y, z, pole, pr, wx = 0) => { const c = C[i]; c.on = true; c.space = space; c.x = x; c.y = y; c.z = z; c.pole = pole; c.pr = pr; c.wx = wx; };
    C[0].on = C[1].on = false;
    const deskL = [-0.45, -1, 0.4], deskR = [0.45, -1, 0.4];
    if (this.id === 'ab' && CREW.atHelm()) { set(L, 1.0, 0.3, 0.5, 0.5); set(R, 1.0, -0.3, 0.5, -0.5); ik(0, 'root', -0.2, 1.1, -0.36, deskL, -1.0); ik(1, 'root', 0.2, 1.1, -0.36, deskR, 1.0); }
    else if (onRadio) { set(R, 1.35 + Math.sin(ph * 0.7) * 0.03, 0.22, 2.45, 0.2); set(L, 0.03, -0.08, 0.15); ik(1, 'head', 0.14, -0.185 + Math.sin(ph * 0.7) * 0.004, -0.1, [0.5, -0.9, -0.6], 0.2, 0.25); }
    else if (pose === 'press') { const p = Math.max(0, Math.sin(ph * 5)); set(R, 0.95 + p * 0.12, 0.08, 0.35 - p * 0.1, -0.9); set(L, 0.45, -0.05, 0.6, 0.9); ik(1, 'root', 0.1, 1.145 - p * 0.012, -0.44 - p * 0.02, deskR, 1.15, 0.1); ik(0, 'root', -0.18, 1.125, -0.32, deskL, -1.15, 0.1); }
    else if (pose === 'write') { set(R, 0.7, 0.05, 0.95 + Math.sin(ph * 9) * 0.05, -0.9); set(L, 0.6, -0.05, 0.9, 0.9); ik(1, 'root', 0.1 + Math.sin(ph * 2.2) * 0.02, 0.955, -0.36 + Math.sin(ph * 9) * 0.006, deskR, 1.15, 0.15); ik(0, 'root', -0.2, 0.955, -0.28, deskL, -1.15, 0.1); }
    else if (this.talkT > 0) { set(R, 0.5 + Math.sin(ph * 4) * 0.2, 0.08, 0.8, -0.3); set(L, 0.03, -0.08, 0.14); }
    else if (pose === 'console') { set(L, 0.55, -0.05, 0.6, 0.9); set(R, 0.55, 0.05, 0.6, -0.9); ik(0, 'root', -0.17, 1.125, -0.34, deskL, -1.15, 0.1); ik(1, 'root', 0.17, 1.125, -0.34, deskR, 1.15, 0.1); }
    else if (pose === 'binos') { set(L, 1.4, 0.5, 1.6, 0.4); set(R, 1.4, -0.5, 1.6, -0.4); ik(0, 'head', -0.085, -0.2, -0.19, [-0.7, -1, -0.2], -0.5, 0.3); ik(1, 'head', 0.085, -0.2, -0.19, [0.7, -1, -0.2], 0.5, 0.3); }
    else { set(L, 0.03, -0.08, 0.14); set(R, 0.03, 0.08, 0.14); }
  }
  // blend the arm towards the IK solution for its hand target (weight eased in and out)
  applyArmIK(i, c, dt) {
    const A = this.arms[i], ik = this.ikS[i], P = this.P;
    ik.w = humDamp(ik.w, c.on ? 1 : 0, dt, c.on ? 0.25 : 0.2);
    if (ik.w < 0.003) return;
    if (c.space === 'head') {
      this.neck.updateMatrix(); this.head.updateMatrix(); this.hc.updateMatrix();
      _ikS.Mh.multiplyMatrices(this.neck.matrix, this.head.matrix).multiply(this.hc.matrix); _ikS.T.set(c.x, c.y, c.z).applyMatrix4(_ikS.Mh);
    } else _ikS.T.set(c.x, c.y, c.z).applyMatrix4(_ikS.Mi);
    if (!ik.init) { ik.p.copy(_ikS.T); ik.init = true; } else ik.p.lerp(_ikS.T, 1 - Math.exp(-dt / 0.1));
    _ikS.S.copy(A.clav.position).add(A.sh.position);
    _ikS.pole.set(c.pole[0], c.pole[1], c.pole[2]);
    _ikS.q.copy(A.sh.quaternion); const elFk = A.el.rotation.x, prFk = A.fa.rotation.y * 2;
    humArmIK(A.sh, A.el, P.upper, P.fore, _ikS.S, ik.p, _ikS.pole);
    const elIk = A.el.rotation.x; _ikS.q2.copy(A.sh.quaternion);
    A.sh.quaternion.copy(_ikS.q).slerp(_ikS.q2, ik.w);
    A.el.rotation.set(elFk + (elIk - elFk) * ik.w, 0, 0);
    const pr = prFk + (c.pr - prFk) * ik.w; A.fa.rotation.y = pr * 0.5; A.wr.rotation.y = pr * 0.5; A.wr.rotation.x = c.wx * ik.w;
  }
}

// ------------------------------------------------------------- crew manager
const CREW = {
  info: {
    co: { name: 'Anders Nielsen', short: 'C/O Nielsen', role: 'Chief Officer', color: '#7fd3ee' },
    o2: { name: 'Sofia Santos', short: '2/O Santos', role: 'Second Officer (navigator)', color: '#f4a8d4' },
    o3: { name: 'Rahul Mehta', short: '3/O Mehta', role: 'Third Officer', color: '#b7e38f' },
    ab: { name: 'Jomar Reyes', short: 'AB Reyes', role: 'Able Seaman — helmsman', color: '#ffc36b' },
    pilot: { name: 'Hendrik de Vries', short: 'Pilot', role: 'Westerhaven harbour pilot', color: '#ffe066' },
    ce: { name: 'Lars Jensen', short: 'Chief Eng. (ECR)', role: 'Chief Engineer', color: '#c9b8ff' },
    vts: { name: 'Westerhaven Traffic', short: 'VTS Westerhaven', role: 'Vessel Traffic Service', color: '#ffb080' },
    t1: { name: 'Tug WH Titan', short: 'Tug TITAN', role: 'Tug', color: '#ff9b6b' },
    t2: { name: 'Tug WH Hercules', short: 'Tug HERCULES', role: 'Tug', color: '#ff9b6b' },
    pb: { name: 'Pilot boat', short: 'Pilot boat', role: 'Pilot tender', color: '#ffe066' },
    me: { name: 'You', short: 'Master', role: 'Master', color: '#ffffff' },
    fwd: { name: 'Forward station', short: 'Fwd station (C/O)', role: '', color: '#7fd3ee' },
    aft: { name: 'Aft station', short: 'Aft station (2/O)', role: '', color: '#f4a8d4' },
  },
  members: [],
  helmState: { order: null, t: 0 },
  init() {
    SPEECH.init();
    const m = (id, look, node, face = 0, pose) => { const c = new CrewMember(id, look, node); c.idleFace = face; c.pose = pose; c.setHome(node, face, pose); this.members.push(c); return c; };
    m('co', { height: 1.86, build: 'average', shoulder: 1.04, belly: 0.08, legLen: 1.02, foot: 1.06, gait: { speed: 0.96, cadence: 0.96, arms: 1.0, toeOut: 0.09 }, shirt: 0xf3f3f0, pants: 0x1c2230, epaulettes: 3, skin: 0xe2b99a, hair: 0xb89a6a, radio: true, tone: '#fff4ee', shave: false, beard: '120,88,52', brow: '#b08858', hairStyle: 'short', hairCol: '#8a6a44', iris: '#4a7aa8', seed: 11 }, 'ecdL', 0, 'console');
    m('o2', { female: true, height: 1.68, build: 'lean', hips: 1.04, gait: { speed: 1.03, cadence: 1.05, arms: 0.95, sway: 1.2, toeOut: 0.06 }, shirt: 0xf3f3f0, pants: 0x1c2230, epaulettes: 2, skin: 0xa8765a, hair: 0x1b120c, radio: true, tone: '#e0b08c', shave: true, lips: 'rgba(165,55,72,0.55)', brow: '#553020', hairStyle: 'bob', hairCol: '#2a1810', iris: '#3a2616', seed: 12, headScale: 1.0 }, 'ecdR', 0, 'console');
    m('o3', { height: 1.74, build: 'lean', shoulder: 0.98, sleeves: 'short', gait: { speed: 1.06, cadence: 1.04, stoop: 0.05, arms: 0.9 }, shirt: 0xf3f3f0, pants: 0x1c2230, epaulettes: 1, skin: 0x9a6a4a, hair: 0x120c08, glasses: true, tone: '#b27a52', shave: 'light', brow: '#3a2010', hairStyle: 'short', hairCol: '#120c08', iris: '#2a1a0e', seed: 13 }, 'tele', 0, 'console');
    m('ab', { height: 1.66, build: 'stocky', shoulder: 1.05, arm: 1.06, leg: 1.04, legLen: 0.97, boots: true, gait: { speed: 1.13, cadence: 1.06, arms: 1.15, sway: 1.1, toeOut: 0.13 }, coverall: true, pants: 0xe0661c, shirt: 0xe0661c, skin: 0xb07a55, hair: 0x120c08, tone: '#c98f64', shave: true, brow: '#3a2010', hairStyle: 'crop', hairCol: '#0e0a08', iris: '#2e1d10', seed: 14, headScale: 0.98 }, 'aftC', 0.3);
    const pl = m('pilot', { height: 1.82, build: 'heavy', belly: 0.5, gait: { speed: 0.88, cadence: 0.93, arms: 0.85, stoop: 0.07, sway: 1.15, toeOut: 0.16 }, shirt: 0x1d2a3a, pants: 0x2a2a2a, vest: 0xf07a14, skin: 0xe8c0a0, hair: 0x8a8a8a, glasses: true, tone: '#fff0ea', shave: 'light', brow: '#8a8078', hairStyle: 'receding', hairCol: '#9a968e', iris: '#5a7890', seed: 15, headScale: 1.02 }, 'door', 0);
    pl.present = false; pl.group.visible = false; pl.hit.visible = false;
    this.buildStationFigures();
  },
  byId(id) { return this.members.find((c) => c.id === id); },
  // people a walker must not run into: the other crew on the bridge and the player (skipCrew: squeezing past)
  others(self, skipCrew) {
    const o = [];
    if (!skipCrew) for (const c of this.members) if (c !== self && c.present) o.push({ x: c.group.position.x, z: c.group.position.z });
    if (PLAYER.inBridge()) o.push({ x: PLAYER.x, z: PLAYER.z, player: true });
    return o;
  },
  // how deep a point (body radius r) is in a wall or piece of furniture, 0 if clear
  intrusion(x, z, r = 0.2) {
    if (!BR.inside(x, z)) return 1;
    let d = 0;
    for (const c of BR.colliders) {
      const ix = Math.min(x - c.x0 + r, c.x1 + r - x), iz = Math.min(z - c.z0 + r, c.z1 + r - z);
      if (ix > 0 && iz > 0) d = Math.max(d, Math.min(ix, iz));
    }
    return d;
  },
  atHelm() { const ab = this.byId('ab'); return ab && ab.present && ab.node === 'helm' && ab.state === 'idle'; },
  update(dt) { this.members.forEach((c) => c.update(dt)); this.updateHelmsman(dt); this.updateStations(dt); this.updateAmbient(dt); },

  // --------------------------------------------------- tasks at the consoles
  // Named, serialisable jobs: a crew member walks to a spot and then does this on arrival.
  ACTIONS: {
    vts: () => { G.vhfCh = 11; SCN.vtsCall('o2'); },
    tugs: () => { G.vhfCh = 12; SCN.tugCall('o2'); },
    standby: () => { CREW.say('o3', 'Ringing stand-by engine, Captain.'); requestEngineMode('STANDBY'); },
    thrusters: () => { CREW.say('o3', 'Starting bow thrusters.'); startThrusters(); },
    navlights: () => { G.navLights = !G.navLights; CREW.say('o3', CREW.vary('navl', G.navLights ? ['Navigation lights on.', 'Nav lights are on, Captain.', 'Switching on the navigation lights.'] : ['Navigation lights off.', 'Nav lights off, Captain.', 'Navigation lights switched off.'])); if (G.navLights && ENV.night) SCN.bonus('Nav lights at night', 25, 'navl'); },
    position: () => SCN.reportPosition(),
    traffic: () => SCN.reportTraffic(),
    checklist: () => SCN.checklistReport('co'),
    coffee: (c) => CREW.say(c.id, pick(['Coffee is on, Captain. Black, as always.', 'Good idea, Captain — long arrival ahead.', 'The pilot will want one too, I am sure.'])),
  },
  // order a crew member to a spot; falls back to doing it at once if they are away
  job(id, spot, key, dur = 6) {
    const c = this.byId(id);
    if (!c || !c.present) { this.ACTIONS[key](c); return; }
    c.doTask(spot, { key, dur });
  },
  // idle routines: glance at the radar, write up the log, look out with binoculars, fetch coffee
  AMBIENT: {
    co: ['lookL', 'radarL', 'chart', 'wingL', 'ecdL', 'coffee'],
    o2: ['radarR', 'dock', 'gmdss', 'chart', 'lookR'],
    o3: ['thr', 'lookR', 'chart', 'steer', 'engine'],
    ab: ['lookR', 'lookL', 'coffee'],
    pilot: ['lookL', 'lookR', 'radarL', 'ecdL'],
  },
  updateAmbient(dt) {
    if (!dt) return;
    const taken = new Set(this.members.filter((c) => c.present).map((c) => c.node));
    for (const c of this.members) {
      if (!c.present || !c.home || c.busy()) continue;
      if (c.id === 'ab' && c.home.node === 'helm') continue;           // the helmsman never leaves the wheel
      c.ambientT -= dt * Math.min(G.timeScale, 4);
      if (c.ambientT > 0) continue;
      c.ambientT = 45 + Math.random() * 70;
      const opts = (this.AMBIENT[c.id] || []).filter((k) => !taken.has(SPOTS[k].node) && SPOTS[k].node !== c.home.node);
      if (!opts.length) continue;
      const spot = pick(opts); taken.add(SPOTS[spot].node);
      c.doTask(spot, { ambient: true, dur: 8 + Math.random() * 14 });
    }
  },
  say(id, text, radio, slot) { SPEECH.say(id, text, radio, slot); },
  // one of a few equivalent phrasings, never the same one twice running — people don't talk like a tape loop
  vary(key, opts) {
    const last = (this._varied ||= {})[key];
    let i = Math.floor(Math.random() * opts.length);
    if (opts.length > 1 && i === last) i = (i + 1 + Math.floor(Math.random() * (opts.length - 1))) % opts.length;
    this._varied[key] = i;
    return opts[i];
  },
  findPath(a, b) {
    if (a === b) return [b];
    // shortest walking distance (Dijkstra; the graph has ~30 nodes)
    const adj = {}; for (const [p, q] of BR.edges) { (adj[p] = adj[p] || []).push(q); (adj[q] = adj[q] || []).push(p); }
    const len = (p, q) => Math.hypot(BR.nodes[p][0] - BR.nodes[q][0], BR.nodes[p][1] - BR.nodes[q][1]);
    const dist = { [a]: 0 }, prev = { [a]: null }, open = new Set([a]);
    while (open.size) {
      let n = null; for (const k of open) if (n === null || dist[k] < dist[n]) n = k;
      open.delete(n); if (n === b) break;
      for (const k of adj[n] || []) { const nd = dist[n] + len(n, k); if (!(k in dist) || nd < dist[k]) { dist[k] = nd; prev[k] = n; open.add(k); } }
    }
    if (!(b in prev)) return [b];
    const out = []; for (let n = b; n; n = prev[n]) out.unshift(n); return out;
  },

  // --------------------------------------------------- helm orders & AB steering
  helmPhrase(deg) {
    if (deg === 0) return 'Midships';
    const side = deg < 0 ? 'port' : 'starboard';
    if (Math.abs(deg) >= 35) return 'Hard-a-' + side;
    const words = { 5: 'five', 10: 'ten', 15: 'fifteen', 20: 'twenty', 25: 'twenty-five', 30: 'thirty' };
    return side[0].toUpperCase() + side.slice(1) + ' ' + (words[Math.abs(deg)] || Math.abs(deg));
  },
  // the helmsman / 3/O repeat an order back to whoever gave it: "Starboard five, pilot."
  helmOrder(deg, by = 'Captain') {
    // AB repeats where the wheel ends up once the orders stop coming (a quick 5–10–15 gets one "Starboard fifteen")
    clearTimeout(this._helmT);
    this._helmT = setTimeout(() => { if (this.atHelm()) this.say('ab', this.helmAckLine(deg, by), false, 'helm'); }, 900);
    G.abCourse = null;
  },
  helmAckLine(deg, by) {
    const P = this.helmPhrase(deg), p = P.toLowerCase();
    if (deg === 0) return this.vary('helm0', ['Midships, ' + by + '.', 'Midships.', 'Midships. Wheel is amidships.', 'Wheel amidships, ' + by + '.', 'Midships, ' + by + '. Rudder amidships.']);
    const hard = Math.abs(deg) >= 35;
    return this.vary('helm', [
      P + ', ' + by + '.',
      P + '.',
      P + ', ' + by + '. Wheel is ' + p + '.',
      P + '. Wheel is ' + p + ', ' + by + '.',
      hard ? P + ', ' + by + '. Wheel hard over.' : P + ', ' + by + '. Rudder ' + p + '.',
    ]);
  },
  // AB acknowledges a course to steer
  steerAck(c, by = 'Captain') {
    const C = pad(c);
    return this.vary('steer', ['Steer ' + C + ', ' + by + '.', 'Steer ' + C + '.', 'Steering ' + C + ', ' + by + '.', 'Coming to ' + C + ', ' + by + '.', C + ', ' + by + '. Steer ' + C + '.']);
  },
  steadyAck(c, by) {
    const C = pad(c);
    return this.vary('steady', ['Steady on ' + C + ', ' + by + '.', 'Steady on ' + C + '.', 'Steady, ' + C + ', ' + by + '.', 'Course ' + C + ', steady.', 'She\'s steady on ' + C + ', ' + by + '.']);
  },
  // 3/O repeats the telegraph — once the handle has settled, and only the order it ended on
  teleAck(label, by = 'Captain', prev) {
    if (!this._teleT) this._teleFrom = prev;                   // where the handle stood before this burst of orders
    clearTimeout(this._teleT);
    this._teleT = setTimeout(() => {
      this._teleT = null;
      if (label === this._teleFrom) return;                    // swung back to where it was: nothing new to repeat
      const o3 = this.byId('o3'); if (!o3 || !o3.present) return;
      this.say('o3', this.teleAckLine(label, by), false, 'tele');
    }, 1300);
  },
  teleAckLine(label, by) {
    // split engines are said side by side: "Port half ahead, starboard slow ahead"
    const l = label.replace(/ \(SEA\)/g, '').toLowerCase().replace(/^(.+) \/ (.+)$/, 'port $1, starboard $2'), L = l.charAt(0).toUpperCase() + l.slice(1);
    if (label === 'STOP') return this.vary('teleStop', ['Stop engine, ' + by + '.', 'Stop, ' + by + '. Logged.', 'Engine stop, ' + by + '.', 'Stop engine. Engine answering, ' + by + '.', 'Stop it is, ' + by + '.']);
    const opts = [
      L + ', ' + by + '.',
      L + ', ' + by + '. Logged.',
      L + ' it is, ' + by + '.',
      L + '. Engine answering, ' + by + '.',
      L + ', ' + by + ' — in the bell book.',
    ];
    if (!label.includes('/')) opts.push('Engine ' + l + ', ' + by + '.');
    return this.vary('tele', opts);
  },
  updateHelmsman(dt) {
    // AB steering an ordered course (hand steering), human-like
    if (G.steering !== 'HAND' || !this.atHelm() || G.abCourse == null) return;
    const s = G.ship;
    this.helmState.t -= dt; if (this.helmState.t > 0) return;
    this.helmState.t = 1.6;
    const err = wrap180(G.abCourse - s.psi / DEG);
    const rot = s.rotDegMin;
    // a good helmsman uses small, exact wheel and learns how much she needs against wind & tide
    const hs = this.helmState; if (hs.course !== G.abCourse) { hs.course = G.abCourse; hs.trim = 0; }
    if (Math.abs(err) < 6) hs.trim = clamp((hs.trim || 0) + err * 0.05, -5, 5);
    let order = clamp(Math.round(err * 4 - rot * 8 + hs.trim), -20, 20);
    if (Math.abs(err) < 0.8 && Math.abs(rot) < 1) { if (Math.abs(err) < 0.3) order = Math.round(hs.trim); if (!this._steadyTold) { this._steadyTold = true; this.say('ab', this.steadyAck(G.abCourse, G.pilotCon ? 'pilot' : 'Captain')); } }
    G.helmOrder = order;
  },

  // --------------------------------------------------- mooring stations (figures on deck)
  buildStationFigures() {
    this.stations = { fwd: [], aft: [] };
    const sg = G.shipGroup;
    const o = sg.userData.o;
    const bodies = [[1.74, 'average'], [1.70, 'stocky'], [1.80, 'lean'], [1.68, 'stocky'], [1.77, 'average'], [1.82, 'heavy']];
    let n = 0;
    const mk = (x, y, z, face, helmetCol) => {
      const [height, build] = bodies[n % bodies.length], look = { coverall: true, pants: 0xe0661c, shirt: 0xe0661c, hat: 'helmet', helmetCol, skin: 0xb07a55, gloves: true, boots: true, procedural: true, lod: 'low', height, build, belly: build === 'heavy' ? 0.3 : 0, seed: 41 + n, gait: { toeOut: 0.14 } };
      const h = buildHuman(look); h.gait = new HumGait(h, look, 41 + n); h.n = n++;
      h.root.position.set(x, y, z); h.root.rotation.y = face; h.root.visible = false; sg.add(h.root); return h;
    };
    const fy = o.D + o.fc, ay = o.D;
    const zb = o.L / 2 - 0.955 * o.L, zs = o.L / 2 - 0.03 * o.L;
    this.stations.fwd.push(mk(-6, fy, zb + 4, 0.3, 0xffffff), mk(4, fy, zb + 2, -0.5, 0xffd21a), mk(9, fy, zb - 3, -1.2, 0xffd21a));
    this.stations.aft.push(mk(6, ay, zs - 3, 2.6, 0xffffff), mk(-5, ay, zs - 1, 3.4, 0xffd21a), mk(-10, ay, zs + 2, 2.2, 0xffd21a));
  },
  // the deck hands stand their watch: weight shifting from the gait solver, breathing, a look around, one hand now and then at the radio on the chest
  updateStations(dt) {
    const t = G.simT, c = this._stc || (this._stc = { x: 0, z: 0, face: 0, speed: 0, walking: false, sitK: 0, seat: null });
    for (const k of ['fwd', 'aft']) this.stations[k].forEach((h, i) => {
      if (!h.root.visible) return;
      h.gait.update(dt, c);
      const ph = t * 0.35 + h.n * 2.1, look = Math.sin(ph) * 0.55 + Math.sin(ph * 2.7) * 0.2, radio = Math.max(0, Math.sin(t * 0.11 + h.n * 1.7)) ** 2;
      const br = Math.sin(t * 1.7 + h.n) * 0.013;
      h.chest.scale.set(1 + br, 1 + br * 0.3, 1 + br * 1.3);
      h.torso.rotation.set(0.03, look * 0.15, -0.4 * h.gait.rollP, 'YXZ');
      h.head.rotation.set(-0.03 + 0.06 * Math.sin(t * 0.4 + h.n), look * 0.85, 0, 'YXZ');
      const a = h.arms;
      a[0].sh.rotation.set(0.04, 0, -0.09); a[0].el.rotation.set(0.18, 0, 0);
      a[1].sh.rotation.set(0.05 + 0.9 * radio, 0, 0.09 - 0.12 * radio); a[1].el.rotation.set(0.2 + 1.25 * radio, 0, 0); a[1].fa.rotation.y = 0.3 * radio; a[1].wr.rotation.y = 0.3 * radio;
    });
  },
  showStation(k, on) { this.stations[k].forEach((h) => (h.root.visible = on)); },

  // --------------------------------------------------- orders catalogue
  orders(id) {
    const s = G.ship, F = G.flags;
    const rec = (k) => SCN.recommended(k);
    const L = [];
    if (id === 'ab') {
      L.push({ k: 'ab_wheel', t: 'Take the wheel — hand steering', d: 'AB goes to the steering stand and steers by hand. Required for the pilot.', ok: !this.atHelm(), fn: () => this.abTakeWheel() });
      L.push({ k: 'ab_course', t: 'Steer a course…', d: 'AB steers and steadies on the ordered heading', input: true, ok: this.atHelm(), fn: (v) => { G.abCourse = wrap360(v); this._steadyTold = false; this.say('ab', this.steerAck(G.abCourse)); } });
      L.push({ k: 'ab_steady', t: 'Steady as she goes', d: 'Hold the present heading', ok: this.atHelm(), fn: () => { G.abCourse = Math.round(s.psi / DEG); this._steadyTold = false; this.say('ab', 'Steady as she goes — steady on ' + pad(G.abCourse) + '.'); } });
      for (const [lab, d] of [['Port ten', -10], ['Starboard ten', 10], ['Port twenty', -20], ['Starboard twenty', 20], ['Hard-a-port', -35], ['Hard-a-starboard', 35], ['Midships', 0]]) L.push({ k: 'ab_h' + d, t: lab, d: 'Helm order', ok: this.atHelm(), fn: () => helmOrder(d) });
      L.push({ k: 'ab_auto', t: 'Back to autopilot', d: 'Engage autopilot on the present heading', ok: G.steering !== 'AUTO', fn: () => { setSteering('AUTO'); this.say('ab', this.vary('auto', ['Autopilot engaged, heading ' + pad(G.apHeading) + '.', 'Autopilot on, Captain. Heading ' + pad(G.apHeading) + '.', 'She\'s on auto, ' + pad(G.apHeading) + '.'])); const ab = this.byId('ab'); ab.setHome('aftC', 0.3, null); ab.goHome(); } });
    }
    if (id === 'co') {
      L.push({ k: 'co_fwd', t: 'Man the forward mooring station', d: 'Go forward with the bosun, prepare lines, stand by both anchors', ok: !F.fwdSent, fn: () => this.sendStation('co', 'fwd') });
      L.push({ k: 'co_lines', t: 'Forward: send head lines, breasts & spring ashore', d: 'Only when alongside', ok: F.fwdStation && !F.linesFwd, fn: () => SCN.sendLines('fwd') });
      L.push({ k: 'co_dist', t: 'Report distance forward', d: 'Bow distance and closing speed', ok: F.fwdStation, fn: () => SCN.reportDistance('fwd') });
      L.push({ k: 'co_check', t: 'Arrival checklist status', d: 'Summary of pending items', ok: this.byId('co').present, fn: () => this.job('co', 'chart', 'checklist') });
    }
    if (id === 'o2') {
      L.push({ k: 'o2_vts', t: 'Call VTS on channel 11', d: 'Report arrival to Westerhaven Traffic', ok: !F.vtsReported, fn: () => this.job('o2', 'vhf', 'vts', 10) });
      L.push({ k: 'o2_pos', t: 'Report position & next waypoint', d: 'Cross-track error, distance, next course', ok: this.byId('o2').present, fn: () => this.job('o2', 'ecdL', 'position') });
      L.push({ k: 'o2_traffic', t: 'Report traffic', d: 'Radar / AIS targets with CPA', ok: this.byId('o2').present, fn: () => this.job('o2', 'radarR', 'traffic') });
      L.push({ k: 'o2_tugs', t: 'Order tugs on channel 12', d: 'Two tugs to meet us at the breakwater', ok: !TUGS.ordered, fn: () => this.job('o2', 'vhf', 'tugs', 10) });
      L.push({ k: 'o2_aft', t: 'Man the aft mooring station', d: 'Go aft, prepare stern lines and springs', ok: !F.aftSent, fn: () => this.sendStation('o2', 'aft') });
      L.push({ k: 'o2_lines', t: 'Aft: send stern lines, breasts & spring ashore', d: 'Only when alongside', ok: F.aftStation && !F.linesAft, fn: () => SCN.sendLines('aft') });
      L.push({ k: 'o2_dist', t: 'Report distance aft', d: 'Stern distance and closing speed', ok: F.aftStation, fn: () => SCN.reportDistance('aft') });
    }
    if (id === 'o3') {
      L.push({ k: 'o3_sb', t: 'Ring stand-by engine', d: 'Tell the engine room to change to manoeuvring mode', ok: s.engineMode === 'SEA' && !G.pendingMode, fn: () => this.job('o3', 'phone', 'standby', 8) });
      L.push({ k: 'o3_ladder', t: 'Rig the pilot ladder — ' + (F.leeSide || 'lee') + ' side', d: 'Combination ladder, 2 m above water, with lifebuoy & light', ok: !F.ladder && !F.ladderRigging, fn: () => SCN.rigLadder() });
      L.push({ k: 'o3_bt', t: 'Start the bow thrusters', d: 'Needs ~20 s and a second generator', ok: !G.thrReady && !G.thrStarting, fn: () => this.job('o3', 'thr', 'thrusters') });
      L.push({ k: 'o3_h', t: 'Hoist flag "H" — pilot on board', d: 'International code flag H', ok: F.pilotOnBridge && !F.hflag, fn: () => { F.hflag = true; this.say('o3', 'Hotel flag hoisted, Captain.'); SCN.bonus('Flag H hoisted', 25); } });
      L.push({ k: 'o3_lights', t: (G.navLights ? 'Switch off' : 'Switch on') + ' navigation lights', d: 'Sidelights, masthead, stern light', ok: true, fn: () => this.job('o3', 'steer', 'navlights', 4) });
      L.push({ k: 'o3_book', t: 'Show me the bell book', d: 'Engine movement log', ok: true, fn: () => UI.showBellBook() });
    }
    if (id === 'pilot') {
      L.push({ k: 'pi_advice', t: 'Pilot, your advice?', d: 'What does the pilot suggest right now', ok: F.pilotOnBridge, fn: () => SCN.pilotAdvice(true) });
      L.push({ k: 'pi_tugs', t: 'Order the tugs', d: 'Pilot calls the tugs on VHF 12', ok: F.pilotOnBridge && !TUGS.ordered, fn: () => SCN.tugCall('pilot') });
      L.push({ k: 'pi_con', t: G.pilotCon ? 'I have the con (take over)' : 'Pilot, take the con through the channel', d: 'Pilot gives helm & engine orders until the breakwater', ok: F.pilotOnBridge && s.x < -2800, fn: () => SCN.togglePilotCon() });
      L.push({ k: 'pi_tugauto', t: G.tugAuto ? 'I\'ll handle the tugs myself' : 'Pilot, handle the tugs for berthing', d: 'Pilot controls the tugs to bring her alongside parallel; you control engines fore & aft', ok: F.pilotOnBridge && s.tugs[0].attached && s.tugs[1].attached, fn: () => { G.tugAuto = !G.tugAuto; this.say('pilot', G.tugAuto ? 'Okay Captain, I\'ll work the tugs. You keep her on the mark with the engines.' : 'Your tugs, Captain.'); } });
      L.push({ k: 'pi_letgo', t: 'Let go the tugs', d: 'Release both tugs', ok: s.tugs[0].attached || s.tugs[1].attached, fn: () => { this.say('pilot', 'Titan, Hercules — let go, thank you.', true); TUGS.letGo(); } });
    }
    return L;
  },
  abTakeWheel() {
    const ab = this.byId('ab');
    this.say('ab', this.vary('toWheel', ['Going to the wheel, Captain.', 'Taking the wheel, Captain.', 'On my way to the wheel.']));
    ab.task = null; ab.setHome('helm', 0, null);
    ab.goTo('helm', () => {
      ab.idleFace = 0; ab.pose = null;
      if (G.steering !== 'HAND') setSteering('HAND');
      G.helmOrder = 0; G.abCourse = Math.round(G.ship.psi / DEG); this._steadyTold = true;
      this.say('ab', 'Hand steering. I have the wheel, Captain — heading ' + pad(G.abCourse) + '.');
      SCN.flag('abWheel');
    });
  },
  sendStation(id, st) {
    const c = this.byId(id); const F = G.flags;
    F[st + 'Sent'] = true;
    this.say(id, st === 'fwd' ? 'Going forward, Captain. I\'ll call you on the radio when the station is ready.' : 'Going aft, Captain. Will report on channel 72.');
    c.leave();
    SCN.later(st === 'fwd' ? 160 : 180, 'stationReady', st);
  },
};
