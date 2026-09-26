// ============================================================================
// 09 — CREW: humanoid models, animation, pathing, speech, delegated orders
// ============================================================================
// Lofts superelliptic rings [y, halfWidth, halfDepth, zOffset] into a smooth closed body shell.
function loftGeometry(rings, capBottom = false, capTop = true, seg = 24) {
  const pos = [], idx = [], n = 2.6;
  for (const [y, w, d, z0 = 0] of rings) for (let k = 0; k < seg; k++) {
    const a = k / seg * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    pos.push(Math.sign(c) * Math.abs(c) ** (2 / n) * w, y, z0 + Math.sign(sn) * Math.abs(sn) ** (2 / n) * d);
  }
  for (let r = 0; r < rings.length - 1; r++) for (let k = 0; k < seg; k++) {
    const a = r * seg + k, b = r * seg + (k + 1) % seg, c = a + seg, e = b + seg;
    idx.push(a, c, b, b, c, e);
  }
  const cap = (r, up) => { const ci = pos.length / 3, [y, , , z0 = 0] = rings[r]; pos.push(0, y + (up ? 0.004 : -0.004), z0); for (let k = 0; k < seg; k++) { const a = r * seg + k, b = r * seg + (k + 1) % seg; up ? idx.push(ci, b, a) : idx.push(ci, a, b); } };
  if (capTop) cap(rings.length - 1, true);
  if (capBottom) cap(0, false);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function buildHuman(o) {
  const mat = (c, r = 0.75) => new THREE.MeshStandardMaterial({ color: c, roughness: r, envMapIntensity: 0.4 });
  const skin = mat(o.skin || 0xc99a78, 0.6), shirt = mat(o.shirt || 0xf2f2ef, 0.85), pants = mat(o.pants || 0x1c2230, 0.85), shoe = mat(0x111111, 0.5), hairM = mat(o.hair || 0x241a12, 0.9);
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.94; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  // contoured torso: superelliptic cross-sections lofted from waist to neck (front is -z)
  const F = o.female ? 1 : 0;
  // body proportions relative to the head: shoulder breadth ≈ 3 head widths (men), a little less for women
  const W = o.female ? 0.84 : 0.86, D = o.female ? 0.9 : 0.96, AR = o.female ? 0.8 : 0.86, LG = o.female ? 0.86 : 0.92;
  // scale a loft ring [y, halfWidth, halfDepth, z]; rings at the collar keep their size so the neck still fits
  const ring = ([y, w, d, z = 0]) => { const t = smooth(0.52, 0.6, y), k = lerp(W, 1, t), kd = lerp(D, 1, t); return [y, w * k, d * kd, z * kd]; };
  const shirtProfile = [[0.02, 0.166 + F * 0.01, 0.114], [0.16, 0.158 - F * 0.02, 0.112], [0.3, 0.176 - F * 0.02, 0.12, -0.006], [0.41, 0.196 - F * 0.02, 0.124, -0.01],
    [0.49, 0.212 - F * 0.02, 0.114, -0.004], [0.535, 0.205 - F * 0.02, 0.1], [0.565, 0.16 - F * 0.015, 0.084], [0.59, 0.095, 0.066], [0.605, 0.066, 0.056]].map(ring);
  const chest = new THREE.Mesh(loftGeometry(shirtProfile), o.coverall ? pants : shirt); torso.add(chest);
  const belly = new THREE.Mesh(loftGeometry([[-0.2, 0.05, 0.06], [-0.165, 0.12, 0.09], [-0.1, 0.162 + F * 0.012, 0.108], [-0.02, 0.176 + F * 0.015, 0.114], [0.06, 0.171 + F * 0.012, 0.116], [0.1, 0.169 + F * 0.01, 0.116]].map(ring), true), pants); torso.add(belly);
  if (!o.coverall) { const belt = new THREE.Mesh(loftGeometry([[0.07, 0.172 + F * 0.012, 0.118], [0.105, 0.171 + F * 0.012, 0.118]].map(ring), false, false), mat(0x111111, 0.4)); torso.add(belt); }
  if (o.vest) { const v = new THREE.Mesh(loftGeometry(shirtProfile.slice(1, 7).map(([y, w, d, z = 0]) => [y, w + 0.018, d + 0.02, z]), false, false), mat(o.vest, 0.6)); v.material.side = THREE.DoubleSide; torso.add(v); }
  if (o.epaulettes) for (const sx of [-1, 1]) { const e = new THREE.Group(); e.position.set(sx * 0.155 * W, 0.563, 0); e.rotation.z = -sx * 0.42; torso.add(e); e.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 0.11), mat(0x1a2233, 0.5))); for (let k = 0; k < o.epaulettes; k++) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.101, 0.012, 0.012), mat(0xd4a93a, 0.3)); st.position.set(0, 0.002, -0.03 + k * 0.022); e.add(st); } }
  if (o.radio) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.035), mat(0x111111)); r.position.set(0.12 * W, 0.44, -0.13 * D); torso.add(r); }
  // neck pivot at the base of the neck so nodding/turning keeps the neck seated in the collar
  const head = new THREE.Group(); head.position.y = 0.6; torso.add(head);
  const hc = new THREE.Group(); hc.position.y = 0.16; head.add(hc);
  let eyes = null;
  if (HEADS.ready && !o.procedural) {
    const hb = o.female && HEADS.femaleReady ? HEADS.buildFemale(o) : HEADS.build(o);
    hc.add(hb.group); eyes = hb.eyes;
    skin.color.copy(hb.skin).multiplyScalar(0.92);
    if (o.glasses) { const gm = mat(0x151515, 0.3); for (const sx of [-1, 1]) { const l = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0028, 6, 18), gm); l.position.set(sx * 0.034, -0.062, -0.103); hc.add(l); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, 0.1), gm); arm.position.set(sx * 0.058, -0.058, -0.055); hc.add(arm); } const br = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.003, 0.003), gm); br.position.set(0, -0.058, -0.106); hc.add(br); }
    if (!o.coverall) {
      // open shirt collar around the neck
      const col = mat(o.shirt || 0xf2f2ef, 0.85);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.014, 8, 24, Math.PI * 1.45), col); band.rotation.x = Math.PI / 2; band.rotation.z = Math.PI * 0.275 + Math.PI / 2; band.position.set(0, 0.585, 0.005); torso.add(band);
    } else { const c2 = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.05, 16, 1, true), pants); c2.position.y = 0.6; torso.add(c2); }
  } else {
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), skin); neck.position.y = 0.63; torso.add(neck);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.108, 20, 16), skin); skull.scale.set(0.92, 1.12, 1.0); hc.add(skull);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 10), skin); jaw.position.set(0, -0.055, -0.02); jaw.scale.set(0.95, 0.8, 1); hc.add(jaw);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mat(0x1a1410, 0.3)); eye.position.set(sx * 0.037, 0.018, -0.095); hc.add(eye);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, 0.01), hairM); brow.position.set(sx * 0.037, 0.045, -0.1); hc.add(brow);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), skin); ear.position.set(sx * 0.1, 0.0, 0.0); ear.scale.set(0.5, 1, 0.8); hc.add(ear);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 8), skin); nose.rotation.x = -Math.PI / 2 - 0.3; nose.position.set(0, -0.005, -0.112); hc.add(nose);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.006, 0.01), mat(0x6a3a30)); mouth.position.set(0, -0.052, -0.098); hc.add(mouth);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.114, 18, 12, 0, Math.PI * 2, 0, Math.PI * (o.female ? 0.62 : 0.5)), hairM); hair.position.y = 0.012; hair.scale.set(0.95, 1.12, 1.03); hair.rotation.x = 0.25; hc.add(hair);
  if (o.female) { const bun = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), hairM); bun.position.set(0, 0.03, 0.11); hc.add(bun); }
  if (o.beard) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), hairM); b.position.set(0, -0.04, -0.03); hc.add(b); }
  if (o.glasses) { const gm = mat(0x111111, 0.3); for (const sx of [-1, 1]) { const l = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 6, 14), gm); l.position.set(sx * 0.037, 0.018, -0.105); hc.add(l); } }
  }
  if (o.hat === 'helmet') { const h = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(o.helmetCol || 0xffffff, 0.4)); h.position.y = 0.03; hc.add(h); const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 16), mat(o.helmetCol || 0xffffff, 0.4)); brim.position.set(0, 0.03, -0.02); hc.add(brim); }
  if (o.hat === 'cap') { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.115, 0.07, 16), mat(0x1a2233, 0.7)); h.position.y = 0.09; hc.add(h); const v = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.08), mat(0x111111, 0.4)); v.position.set(0, 0.06, -0.12); hc.add(v); }
  // tapered limb: sphere joint, conical segment, sphere joint (hangs down from the pivot)
  const limb = (r0, r1, len, m) => {
    const off = (r0 + r1) / 2 * 0.3;
    const g = mergeGeometries([new THREE.SphereGeometry(r0, 12, 8).translate(0, -off, 0), new THREE.CylinderGeometry(r0, r1, len, 12, 1, true).translate(0, -len / 2 - off, 0), new THREE.SphereGeometry(r1, 12, 8).translate(0, -len - off, 0)].map((q) => { q.deleteAttribute('uv'); return q; }));
    return new THREE.Mesh(g, m);
  };
  const arms = [], legs = [], legTape = [];
  if (o.coverall) torso.add(new THREE.Mesh(loftGeometry([[0.4, 0.2, 0.128, -0.01], [0.445, 0.207, 0.123, -0.008]].map(ring), false, false), mat(0xd8dcd8, 0.35)));
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sx * (o.female ? 0.195 : 0.215) * W, 0.52, 0); torso.add(sh);
    const ua = limb(0.058 * AR, 0.047 * AR, 0.24, o.coverall ? pants : shirt); sh.add(ua);
    const delt = new THREE.Mesh(new THREE.SphereGeometry(0.056 * AR, 14, 10), o.coverall ? pants : shirt); delt.scale.set(0.95, 0.9, 1.1); delt.position.set(-sx * 0.012 * AR, -0.045, 0); sh.add(delt);
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    const fa = limb(0.047 * AR, 0.035 * AR, 0.22, o.shortSleeve ? skin : (o.coverall ? pants : shirt)); el.add(fa);
    const hand = new THREE.Mesh(new RoundedBoxGeometry(0.036, 0.1, 0.075, 2, 0.016), o.gloves ? mat(0xe8e0c0) : skin); hand.position.y = -0.3; hand.scale.setScalar(o.female ? 0.9 : 1); el.add(hand);
    if (o.coverall) { const tape = mat(0xd8dcd8, 0.35); for (const [g, y, r] of [[el, -0.17, 0.043 * AR], [null, -0.3, 0.059 * LG]]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.035, 14, 1, true), tape); t.position.y = y; (g || (legTape.push(t), el)).add(t); } }
    sh.rotation.z = sx * 0.08;
    arms.push({ sh, el });
    const hp = new THREE.Group(); hp.position.set(sx * 0.1 * LG, 0.0, 0); hips.add(hp);
    const th = limb(0.086 * LG, 0.06 * LG, 0.36, pants); hp.add(th);
    const kn = new THREE.Group(); kn.position.y = -0.45; hp.add(kn);
    const sn = limb(0.06 * LG, 0.045 * LG, 0.36, pants); kn.add(sn);
    if (o.coverall) { const t = legTape.pop(); t.position.y = -0.24; kn.add(t); }
    const ft = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.07, 0.25, 2, 0.03), shoe); ft.position.set(0, -0.46, -0.05); kn.add(ft);
    legs.push({ hp, kn });
  }
  if (o.female) root.scale.setScalar(0.95);   // ~1.68 m instead of ~1.77 m
  root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return { root, hips, torso, head, arms, legs, chest, eyes };
}

// ------------------------------------------------------------- speech
const SPEECH = {
  queue: [], busy: false, voices: [], cur: null,
  speaking(id) { return this.cur === id || this.queue.some((q) => q.id === id); },
  init() {
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
  say(id, text, radio) {
    this.queue.push({ id, text, radio });
    if (this.queue.length > 5) this.queue.splice(0, this.queue.length - 5);
    if (!this.busy) this.next();
  },
  next() {
    const it = this.queue.shift();
    if (!it) { this.busy = false; this.cur = null; return; }
    this.busy = true; this.cur = it.id;
    const who = CREW.info[it.id] || { short: it.id, color: '#ccc' };
    UI.sub(who.short, it.text, it.id, it.radio);
    const c = CREW.byId(it.id); if (c) c.talk(Math.max(2, it.text.length * 0.065));
    if (it.radio) AUDIO.squelch();
    const dur = Math.max(2.4, it.text.length * 0.062) * 1000;
    let done = false; const fin = () => { if (done) return; done = true; if (it.radio) AUDIO.squelch(); setTimeout(() => this.next(), 250); };
    if (CFG.voice === 'on' && 'speechSynthesis' in window && it.id !== 'me') {
      try {
        const u = new SpeechSynthesisUtterance(it.text.replace(/°/g, ' degrees').replace(/\bkn\b/g, 'knots'));
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
    } else setTimeout(fin, dur);
  },
};

// ------------------------------------------------------------- crew member
// Where people work on the bridge: node in BR.nodes, facing (0 = forward, π = aft) and body pose.
const SPOTS = {
  vhf: { node: 'conL', face: 0, pose: 'radio' },       // VHF handset, module 3
  phone: { node: 'pilot', face: 0, pose: 'phone' },    // ECR telephone, module 4
  radarL: { node: 'radarL', face: 0, pose: 'console' }, radarR: { node: 'radarR', face: 0, pose: 'console' },
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

class CrewMember {
  constructor(id, look, node) {
    this.id = id; this.look = look;
    const h = buildHuman(look);
    Object.assign(this, h);
    this.group = h.root;
    const [x, z] = BR.nodes[node]; this.x = x; this.z = z; this.node = node;
    this.face = 0; this.targetFace = 0; this.path = []; this.state = 'idle';
    this.walkPh = Math.random() * 6; this.talkT = 0; this.present = true; this.idleT = Math.random() * 10;
    this.task = null; this.ambientT = 25 + Math.random() * 40;
    this.group.position.set(x, 0, z);
    G.bridgeGroup.add(this.group);
    // handset / walkie-talkie shown in the right hand while on the radio or phone
    this.handset = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.12, 4, 8), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 }));
    this.handset.position.set(0.0, -0.3, -0.03); this.handset.rotation.x = 0.3; this.handset.visible = false;
    this.arms[1].el.add(this.handset);
    // interaction proxy (capsule)
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.9; this.group.add(hit);
    const info = CREW.info[id];
    interactive(hit, { name: info.name + ' — ' + info.role, hint: 'Give orders (or Tab)', click: () => UI.openCrewMenu(id) });
    this.hit = hit;
  }
  goTo(node, cb) {
    const path = CREW.findPath(this.nearestNode(), node);
    this.path = path.map((n) => BR.nodes[n].slice());
    this.node = node; this.onArrive = cb; this.state = 'walk';
  }
  nearestNode() { let b = null, bd = 1e9; for (const k in BR.nodes) { const [x, z] = BR.nodes[k]; const d = Math.hypot(x - this.x, z - this.z); if (d < bd) { bd = d; b = k; } } return b; }
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
      if (t.key) CREW.ACTIONS[t.key](this, t.arg);
      if (o.fn) o.fn(this);
    };
    if (this.node === sp.node && !this.path.length) arrive(); else this.goTo(sp.node, arrive);
  }
  busy() { return !!this.task || this.path.length > 0; }
  talk(sec) { this.talkT = sec; }
  update(dt) {
    if (!this.present) return;
    const rdt = dt;
    let moving = false;
    if (this.path.length) {
      const [tx, tz] = this.path[0];
      const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
      const sp = 1.35 * Math.min(3, Math.max(1, G.timeScale * 0.6));
      if (d < 0.08) { this.path.shift(); if (!this.path.length) { this.state = 'idle'; const cb = this.onArrive; this.onArrive = null; cb && cb(); } }
      else { const st = Math.min(d, sp * rdt); this.x += dx / d * st; this.z += dz / d * st; this.targetFace = Math.atan2(-dx, -dz); moving = true; }
    }
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
    let df = ((this.targetFace - this.face + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.face += df * Math.min(1, rdt * 5);
    this.group.position.set(this.x, 0, this.z); this.group.rotation.y = this.face;
    // animation
    const L = this.legs, A = this.arms;
    const onRadio = !moving && (this.pose === 'radio' || this.pose === 'phone');
    this.handset.visible = onRadio;
    if (moving) {
      this.walkPh += rdt * 7.5;
      const s = Math.sin(this.walkPh);
      L[0].hp.rotation.x = s * 0.5; L[1].hp.rotation.x = -s * 0.5;
      L[0].kn.rotation.x = -Math.max(0, -Math.cos(this.walkPh)) * 0.7; L[1].kn.rotation.x = -Math.max(0, Math.cos(this.walkPh)) * 0.7;
      A[0].sh.rotation.x = s * 0.4; A[1].sh.rotation.x = -s * 0.4; A[0].el.rotation.x = 0.3; A[1].el.rotation.x = 0.3;
      A[0].sh.rotation.z = -0.08; A[1].sh.rotation.z = 0.08;
      this.hips.position.y = 0.94 + Math.abs(Math.cos(this.walkPh)) * 0.03;
    } else {
      this.idleT += rdt;
      for (const l of L) { l.hp.rotation.x *= 0.85; l.kn.rotation.x *= 0.85; }
      this.hips.position.y = 0.94;
      const breath = Math.sin(this.idleT * 1.6) * 0.012;
      this.chest.scale.set(1 + breath, 1, 1 + breath);
      const set = (a, sx, sz, el) => { a.sh.rotation.x += (sx - a.sh.rotation.x) * Math.min(1, rdt * 8); a.sh.rotation.z += (sz - a.sh.rotation.z) * Math.min(1, rdt * 8); a.el.rotation.x += (el - a.el.rotation.x) * Math.min(1, rdt * 8); };
      const R = A[1], Lf = A[0], ph = this.idleT;
      if (this.id === 'ab' && CREW.atHelm()) { set(Lf, 1.0, 0.3, 0.5); set(R, 1.0, -0.3, 0.5); }
      else if (onRadio) { set(R, 1.35 + Math.sin(ph * 0.7) * 0.03, 0.22, 2.45); set(Lf, 0.1, -0.08, 0.15); }   // elbow forward, handset at the ear
      else if (this.pose === 'press') { set(R, 0.95 + Math.max(0, Math.sin(ph * 5)) * 0.12, 0.08, 0.35 - Math.max(0, Math.sin(ph * 5)) * 0.1); set(Lf, 0.45, -0.05, 0.6); }
      else if (this.pose === 'write') { set(R, 0.7, 0.05, 0.95 + Math.sin(ph * 9) * 0.05); set(Lf, 0.6, -0.05, 0.9); }
      else if (this.talkT > 0) { set(R, 0.5 + Math.sin(ph * 4) * 0.2, 0.08, 0.8); set(Lf, 0.0, -0.08, 0.1); }
      else if (this.pose === 'console') { set(Lf, 0.55, -0.05, 0.6); set(R, 0.55, 0.05, 0.6); }
      else if (this.pose === 'binos') { set(Lf, 1.4, 0.5, 1.6); set(R, 1.4, -0.5, 1.6); }
      else { set(Lf, 0.0, -0.08, 0.1); set(R, 0.0, 0.08, 0.1); }
    }
    // head: nod when talking, look around when idle
    if (this.talkT > 0) { this.talkT -= rdt; this.head.rotation.x = Math.sin(this.idleT * 6) * 0.06 + (onRadio ? 0.05 : 0); this.head.rotation.y *= 0.9; }
    else if (this.pose === 'binos') { this.head.rotation.y = Math.sin(this.idleT * 0.15) * 0.25; this.head.rotation.x = 0; }
    else { this.head.rotation.y = Math.sin(this.idleT * 0.23 + this.x) * (this.pose ? 0.15 : 0.35); this.head.rotation.x = this.pose === 'console' || this.pose === 'press' || this.pose === 'write' ? -0.25 : 0; }
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
    m('co', { shirt: 0xf3f3f0, pants: 0x1c2230, epaulettes: 3, skin: 0xe2b99a, hair: 0xb89a6a, radio: true, tone: '#fff4ee', shave: false, beard: '120,88,52', brow: '#b08858', hairStyle: 'short', hairCol: '#8a6a44', iris: '#4a7aa8', seed: 11 }, 'ecdL', 0, 'console');
    m('o2', { female: true, shirt: 0xf3f3f0, pants: 0x1c2230, epaulettes: 2, skin: 0xa8765a, hair: 0x1b120c, radio: true, tone: '#e0b08c', shave: true, lips: 'rgba(165,55,72,0.55)', brow: '#553020', hairStyle: 'bob', hairCol: '#2a1810', iris: '#3a2616', seed: 12, headScale: 1.0 }, 'ecdR', 0, 'console');
    m('o3', { shirt: 0xf3f3f0, pants: 0x1c2230, epaulettes: 1, skin: 0x9a6a4a, hair: 0x120c08, glasses: true, tone: '#b27a52', shave: 'light', brow: '#3a2010', hairStyle: 'short', hairCol: '#120c08', iris: '#2a1a0e', seed: 13 }, 'tele', 0, 'console');
    m('ab', { coverall: true, pants: 0xe0661c, shirt: 0xe0661c, skin: 0xb07a55, hair: 0x120c08, tone: '#c98f64', shave: true, brow: '#3a2010', hairStyle: 'crop', hairCol: '#0e0a08', iris: '#2e1d10', seed: 14, headScale: 0.98 }, 'aftC', 0.3);
    const pl = m('pilot', { shirt: 0x1d2a3a, pants: 0x2a2a2a, vest: 0xf07a14, skin: 0xe8c0a0, hair: 0x8a8a8a, glasses: true, tone: '#fff0ea', shave: 'light', brow: '#8a8078', hairStyle: 'receding', hairCol: '#9a968e', iris: '#5a7890', seed: 15, headScale: 1.02 }, 'door', 0);
    pl.present = false; pl.group.visible = false; pl.hit.visible = false;
    this.buildStationFigures();
  },
  byId(id) { return this.members.find((c) => c.id === id); },
  atHelm() { const ab = this.byId('ab'); return ab && ab.present && ab.node === 'helm' && ab.state === 'idle'; },
  update(dt) { this.members.forEach((c) => c.update(dt)); this.updateHelmsman(dt); this.updateStations(dt); this.updateAmbient(dt); },

  // --------------------------------------------------- tasks at the consoles
  // Named, serialisable jobs: a crew member walks to a spot and then does this on arrival.
  ACTIONS: {
    vts: () => { G.vhfCh = 11; SCN.vtsCall('o2'); },
    tugs: () => { G.vhfCh = 12; SCN.tugCall('o2'); },
    standby: () => { CREW.say('o3', 'Ringing stand-by engine, Captain.'); requestEngineMode('STANDBY'); },
    thrusters: () => { CREW.say('o3', 'Starting bow thrusters.'); startThrusters(); },
    navlights: () => { G.navLights = !G.navLights; CREW.say('o3', 'Navigation lights ' + (G.navLights ? 'on' : 'off') + '.'); if (G.navLights && ENV.night) SCN.bonus('Nav lights at night', 25, 'navl'); },
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
  say(id, text, radio) { SPEECH.say(id, text, radio); },
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
  helmOrder(deg) {
    // AB repeats the order (debounced)
    clearTimeout(this._helmT);
    this._helmT = setTimeout(() => {
      if (this.atHelm()) this.say('ab', this.helmPhrase(deg) + ', Captain.' + (Math.random() < 0.4 ? ' Wheel is ' + this.helmPhrase(deg).toLowerCase() + '.' : ''));
    }, 500);
    G.abCourse = null;
  },
  teleAck(label) {
    clearTimeout(this._teleT);
    this._teleT = setTimeout(() => { const o3 = this.byId('o3'); if (o3 && o3.present) this.say('o3', label.charAt(0) + label.slice(1).toLowerCase() + ', Captain. Logged.'); }, 700);
  },
  updateHelmsman(dt) {
    // AB steering an ordered course (hand steering), human-like
    if (G.steering !== 'HAND' || !this.atHelm() || G.abCourse == null) return;
    const s = G.ship;
    this.helmState.t -= dt; if (this.helmState.t > 0) return;
    this.helmState.t = 1.6;
    const err = wrap180(G.abCourse - s.psi / DEG);
    const rot = s.rotDegMin;
    let order = clamp(Math.round((err * 1.4 - rot * 0.9) / 5) * 5, -20, 20);
    if (Math.abs(err) < 1.2 && Math.abs(rot) < 1.5) { order = 0; if (!this._steadyTold) { this._steadyTold = true; this.say('ab', 'Steady on ' + pad(G.abCourse) + ', Captain.'); } }
    G.helmOrder = order;
  },

  // --------------------------------------------------- mooring stations (figures on deck)
  buildStationFigures() {
    this.stations = { fwd: [], aft: [] };
    const sg = G.shipGroup;
    const o = sg.userData.o;
    const mk = (x, y, z, face, helmetCol) => { const h = buildHuman({ coverall: true, pants: 0xe0661c, shirt: 0xe0661c, hat: 'helmet', helmetCol, skin: 0xb07a55, gloves: true, procedural: true }); h.root.position.set(x, y, z); h.root.rotation.y = face; h.root.visible = false; h.root.scale.setScalar(1.05); sg.add(h.root); return h; };
    const fy = o.D + o.fc, ay = o.D;
    const zb = o.L / 2 - 0.955 * o.L, zs = o.L / 2 - 0.03 * o.L;
    this.stations.fwd.push(mk(-6, fy, zb + 4, 0.3, 0xffffff), mk(4, fy, zb + 2, -0.5, 0xffd21a), mk(9, fy, zb - 3, -1.2, 0xffd21a));
    this.stations.aft.push(mk(6, ay, zs - 3, 2.6, 0xffffff), mk(-5, ay, zs - 1, 3.4, 0xffd21a), mk(-10, ay, zs + 2, 2.2, 0xffd21a));
  },
  updateStations(dt) {
    const t = G.simT;
    for (const k of ['fwd', 'aft']) this.stations[k].forEach((h, i) => { if (!h.root.visible) return; h.head.rotation.y = Math.sin(t * 0.3 + i) * 0.6; h.arms[1].sh.rotation.x = Math.sin(t * 0.8 + i * 2) * 0.3 + 0.2; });
  },
  showStation(k, on) { this.stations[k].forEach((h) => (h.root.visible = on)); },

  // --------------------------------------------------- orders catalogue
  orders(id) {
    const s = G.ship, F = G.flags;
    const rec = (k) => SCN.recommended(k);
    const L = [];
    if (id === 'ab') {
      L.push({ k: 'ab_wheel', t: 'Take the wheel — hand steering', d: 'AB goes to the steering stand and steers by hand. Required for the pilot.', ok: !this.atHelm(), fn: () => this.abTakeWheel() });
      L.push({ k: 'ab_course', t: 'Steer a course…', d: 'AB steers and steadies on the ordered heading', input: true, ok: this.atHelm(), fn: (v) => { G.abCourse = wrap360(v); this._steadyTold = false; this.say('ab', 'Steer ' + pad(G.abCourse) + ', Captain.'); } });
      L.push({ k: 'ab_steady', t: 'Steady as she goes', d: 'Hold the present heading', ok: this.atHelm(), fn: () => { G.abCourse = Math.round(s.psi / DEG); this._steadyTold = false; this.say('ab', 'Steady as she goes — steady on ' + pad(G.abCourse) + '.'); } });
      for (const [lab, d] of [['Port ten', -10], ['Starboard ten', 10], ['Port twenty', -20], ['Starboard twenty', 20], ['Hard-a-port', -35], ['Hard-a-starboard', 35], ['Midships', 0]]) L.push({ k: 'ab_h' + d, t: lab, d: 'Helm order', ok: this.atHelm(), fn: () => helmOrder(d) });
      L.push({ k: 'ab_auto', t: 'Back to autopilot', d: 'Engage autopilot on the present heading', ok: G.steering !== 'AUTO', fn: () => { setSteering('AUTO'); this.say('ab', 'Autopilot engaged, heading ' + pad(G.apHeading) + '.'); const ab = this.byId('ab'); ab.setHome('aftC', 0.3, null); ab.goHome(); } });
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
    this.say('ab', 'Going to the wheel, Captain.');
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
