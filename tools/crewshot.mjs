// Crew lab: renders the bridge crew (and the deck-station figures) in headless Chrome for before/after comparisons.
//   node build.mjs && node tools/crewshot.mjs <outDir> [scenes] [--root <dir>] [--query "tod=morning&sea=moderate"] [--ids co,o2,o3,ab,pilot]
//                                             [--size 1000x1100] [--key] [--wait 60] [--cycle 8]
// scenes (comma list, default "stand"):
//   stand    front / side / back full-body shots of each id, standing relaxed, in a spot in the wheelhouse   -> <id>_front|side|back.png
//   upper    three-quarter close-up of head and torso (and a hand detail)                                      -> <id>_upper.png, <id>_hand.png
//   neck     head, neck and collar close-ups from front, three-quarter, side and back                           -> <id>_neck_front|three|side|back.png
//   seat     seated at the port radar chair (three-quarter view and from the side)                              -> <id>_seat_a|b.png
//   handset  at the VHF handset                                                                                 -> <id>_handset_a|b.png
//   poses    console / press / write / binoculars poses, three-quarter view                                     -> <id>_pose_<name>.png
//   walk     8-frame strip across one gait cycle (camera tracks the walker; --view side|front|back|three)       -> <id>_walk_0..7.png
//   decks    the deck-station figures (forecastle and poop) from free cameras and from the orbit camera        -> decks_*.png
//   probe    run page-side JavaScript (--jsfile) and print what it returns
//   helm     the helmsman at the wheel from behind, the side and the front                                       -> ab_helm_back|side|front.png
//   corner   a right-angle turn while walking, a frame every --every seconds -> <id>_corner_NN.png
//   skate    foot-skate numbers while walking
//   fp       first-person views from the player's eye height next to the crew at their posts                     -> fp_*.png
// --root serves another build (e.g. a copy of the old index.html) for before/after pairs. --key adds a soft key light so detail is
// easy to judge; without it the shots are lit exactly as in the game.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const argv = process.argv.slice(2), pos = [], opt = {};
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const nxt = argv[i + 1]; if (nxt === undefined || nxt.startsWith('--')) opt[k] = true; else { opt[k] = nxt; i++; } } else pos.push(argv[i]); }
const [outDir = 'crewshots', sceneArg = 'stand'] = pos;
const [W, H] = (opt.size || '900x1100').split('x').map(Number);
const root = opt.root ? path.resolve(opt.root) : path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ids = (opt.ids || 'co,o2,o3,ab,pilot').split(',');
const query = opt.query || 'tod=morning&sea=moderate';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(outDir, { recursive: true });

// ------------------------------------------------------------------ page-side helpers
const HELPERS = `(async () => {
  const THREE = await import('three');
  const D = window.__dbg, G = D.G, CREW = D.CREW, PLAYER = D.PLAYER, BR = D.BR;
  const bg = () => G.bridgeGroup;
  window.CREW = CREW; window.G = G; window.BR = BR; window.PLAYER = PLAYER;
  const CS = window.CS = { THREE, keyLight: null };
  CS.bg = () => G.bridgeGroup;
  // hide every HUD element, keep the canvas
  CS.hideHud = () => { document.querySelectorAll('body > *:not(#app)').forEach((e) => { e.style.display = 'none'; }); };
  // a camera fixed in the bridge frame (x starboard, y up, -z forward), looking at a bridge-local point
  CS.cam = (px, py, pz, tx, ty, tz, fov = 32) => {
    if (G.mode !== 'orbit') PLAYER.toggleOrbit();
    PLAYER.__upd = PLAYER.__upd || PLAYER.update;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = D.camera;
    PLAYER.update = function () { bg().updateMatrixWorld(); a.set(px, py, pz).applyMatrix4(bg().matrixWorld); b.set(tx, ty, tz).applyMatrix4(bg().matrixWorld); c.position.copy(a); c.up.set(0, 1, 0); c.lookAt(b); if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); } };
    PLAYER.update(0);
  };
  CS.camFn = (fn) => { if (G.mode !== 'orbit') PLAYER.toggleOrbit(); PLAYER.__upd = PLAYER.__upd || PLAYER.update; PLAYER.update = fn; };
  CS.key = (on) => {
    if (on && !CS.keyLight) { const l = new THREE.DirectionalLight(0xfff2e6, 1.6); l.position.set(-2, 3, -4); const h = new THREE.HemisphereLight(0xdfe8ff, 0x8a7a6a, 0.35); bg().add(l, l.target, h); CS.keyLight = [l, h]; }
    if (CS.keyLight) CS.keyLight.forEach((x) => (x.visible = on));
  };
  CS.stepCrew = (n, dt) => { for (let i = 0; i < n; i++) { CREW.update(dt); } bg().updateMatrixWorld(true); };
  CS.render = (n = 3) => { D.frame(n, 0); return true; };
  // put a crew member at a bridge-local spot, relaxed and facing yaw (0 = forward), settled; optionally frozen afterwards
  CS.place = (id, x, z, yaw, o = {}) => {
    const m = CREW.byId(id);
    for (const c of CREW.members) { if (c.id !== id && c.__park === undefined) { c.__park = [c.x, c.z, c.group.visible, c.present]; } }
    m.present = true; m.group.visible = true; m.hit.visible = true;
    m.standUp(); m.path = []; m.task = null; m.onArrive = null; m.state = 'idle'; m.sitK = 0; m.ghostT = 0;
    m.x = x; m.z = z; m.face = m.targetFace = m.idleFace = yaw; m.pose = o.pose === undefined ? null : o.pose; m.talkT = 0;
    if (m.__freeze) { m.update = m.__origUpdate; m.__freeze = false; }
    m.group.position.set(x, 0, z); m.group.rotation.y = yaw;
    if (m.resetPose) m.resetPose();
    return m;
  };
  // everybody else out of the picture
  CS.hideOthers = (id) => { CS.showAll(); for (const c of CREW.members) { if (c.id !== id && !c.__hid) { c.__hid = true; c.__wasPresent = c.present; c.__wasVisible = c.group.visible; c.present = false; c.group.visible = false; c.hit.visible = false; } } };
  CS.showAll = () => { for (const c of CREW.members) { if (c.__hid) { c.present = c.__wasPresent; c.group.visible = c.__wasVisible; c.hit.visible = c.__wasVisible; c.__hid = false; } } };
  CS.settle = (m, sec = 3, dt = 1 / 60) => { for (let i = 0; i < sec / dt; i++) m.update(dt); bg().updateMatrixWorld(true); };
  CS.freeze = (m) => { if (m.__freeze) return; m.__origUpdate = m.update; m.update = () => {}; m.__freeze = true; };
  CS.unfreeze = (m) => { if (m.__freeze) { m.update = m.__origUpdate; m.__freeze = false; } };
  // seated / task poses use the real spots
  CS.spot = (id, spot) => {
    const m = CREW.byId(id), sp = D.SPOTS[spot]; const [x, z] = BR.nodes[sp.node];
    CS.place(id, x, z, sp.face, { pose: sp.pose });
    if (sp.seat) m.sitDown(sp.seat);
    return m;
  };
  CREW.updateAmbient = () => {};                 // nobody wanders off during a shoot
  CS.neutralHead = (m) => { m.head.rotation.set(0, 0, 0); };
  CS.height = (m) => { const par = m.hit.parent; if (par) par.remove(m.hit); m.group.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(m.group); if (par) par.add(m.hit); return b.max.y - b.min.y; };
  // a reference point on the foot, bridge-local (the ankle of the new rig, a point on the shoe of the old one)
  CS.footPoint = (m, k, out) => { const leg = m.legs[k]; const v = out || new THREE.Vector3(); if (leg.ankle) leg.ankle.getWorldPosition(v); else leg.kn.localToWorld(v.set(0, -0.46, -0.05)); return bg().worldToLocal(v); };

  // ---- foot-skate measurement ---------------------------------------------------------------------------------------------
  // The sets of foot vertices (lowest 4 cm of the sole in the settled pose) of both feet, read in the bridge frame every frame.
  CS.footSets = (m) => {
    m.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(bg().matrixWorld).invert(), v = new THREE.Vector3(), sets = [];
    for (let k = 0; k < 2; k++) {
      let mesh, idx, skinned = false;
      if (m.footVerts) { mesh = m.shoeMesh; idx = Array.from(m.footVerts[k]); skinned = true; }
      else { mesh = m.legs[k].kn.children.find((c) => c.isMesh && c.geometry && c.geometry.parameters && 'depth' in c.geometry.parameters); idx = Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) => i); }
      const S = { mesh, skinned, idx: [] };
      for (const i of idx) { if (skinned) mesh.getVertexPosition(i, v); else v.fromBufferAttribute(mesh.geometry.attributes.position, i); v.applyMatrix4(mesh.matrixWorld).applyMatrix4(inv); if (v.y < 0.04) S.idx.push(i); }
      S.n = S.idx.length; S.cur = new Float32Array(S.n * 3); S.prev = new Float32Array(S.n * 3);
      sets.push(S);
    }
    return { sets, inv, v };
  };
  CS.readFoot = (F, S, out) => {
    const mesh = S.mesh, v = F.v;
    for (let j = 0; j < S.n; j++) {
      const i = S.idx[j];
      if (S.skinned) mesh.getVertexPosition(i, v); else v.fromBufferAttribute(mesh.geometry.attributes.position, i);
      v.applyMatrix4(mesh.matrixWorld).applyMatrix4(F.inv);
      out[3 * j] = v.x; out[3 * j + 1] = v.y; out[3 * j + 2] = v.z;
    }
  };
  // walk from node a to node b and record, every frame, how the feet move relative to the floor. Contact slip: the ground speed (central
  // difference over three frames) of the shoe vertices that are within 8 mm of the floor at both ends of the interval; a planted foot gives 0.
  CS.skate = (id, a, b, o = {}) => {
    const dt = o.dt || 1 / 60, m = CREW.byId(id), [ax, az] = BR.nodes[a], [bx, bz] = BR.nodes[b];
    CS.place(id, ax, az, Math.atan2(-(bx - ax), -(bz - az))); CS.settle(m, 1.5, dt);
    const F = CS.footSets(m); m.goTo(b);
    for (const S of F.sets) { S.p0 = new Float32Array(S.n * 3); S.p1 = new Float32Array(S.n * 3); }
    const rec = [];
    let prevRoot = [m.x, m.z], t = 0, kf = [-1, -1], endT = 0;
    const lowest = (S) => { let k = 0, y = 9; for (let j = 0; j < S.n; j++) { const yy = S.cur[3 * j + 1]; if (yy < y) { y = yy; k = j; } } return [k, y]; };
    for (let i = 0; i < Math.round((o.seconds || 16) / dt); i++) {
      CREW.update(dt); t += dt; bg().updateMatrixWorld(true);
      for (const S of F.sets) { S.p0.set(S.p1); S.p1.set(S.cur); S.prev.set(S.cur); CS.readFoot(F, S, S.cur); }
      const sp = Math.hypot(m.x - prevRoot[0], m.z - prevRoot[1]) / dt; prevRoot = [m.x, m.z];
      const l0 = lowest(F.sets[0]), l1 = lowest(F.sets[1]), hover = Math.min(l0[1], l1[1]);
      let best = null, support = null;
      if (kf[0] >= 0) { const vs = [0, 1].map((f) => { const S = F.sets[f], k = kf[f]; return Math.hypot(S.cur[3 * k] - S.prev[3 * k], S.cur[3 * k + 2] - S.prev[3 * k + 2]) / dt; }); best = Math.min(vs[0], vs[1]); support = l0[1] <= l1[1] ? vs[0] : vs[1]; }
      kf = [l0[0], l1[0]];
      // contact slip of each foot (central difference over frames i-2 .. i; contact = within 8 mm of the floor at both ends)
      const cs = [null, null], nc = [0, 0];
      if (i >= 2) for (let f = 0; f < 2; f++) {
        const S = F.sets[f]; let sum = 0, n = 0;
        for (let j = 0; j < S.n; j++) if (S.p0[3 * j + 1] < 0.008 && S.cur[3 * j + 1] < 0.008) { sum += Math.hypot(S.cur[3 * j] - S.p0[3 * j], S.cur[3 * j + 2] - S.p0[3 * j + 2]) / (2 * dt); n++; }
        if (n) { cs[f] = sum / n; nc[f] = n; }
      }
      rec.push({ t, sp, hover, best, support, cs0: cs[0], cs1: cs[1], any: (nc[0] + nc[1]) > 0 ? 1 : 0 });
      if (!m.path.length && sp < 0.01 && t > 2) { if (!endT) endT = t; if (t - endT > 1.0) break; }
    }
    const nom = Math.max(...rec.map((r) => r.sp));
    const stat = (arr, key) => { const a = arr.map((r) => r[key]).filter((x) => x != null).sort((p, q) => p - q); if (!a.length) return null; const mean = a.reduce((p, q) => p + q, 0) / a.length; return { n: a.length, mean, p50: a[a.length >> 1], p95: a[Math.floor(a.length * 0.95)], max: a[a.length - 1] }; };
    const both = (arr) => { const r = []; for (const x of arr) { if (x.cs0 != null) r.push({ c: x.cs0 }); if (x.cs1 != null) r.push({ c: x.cs1 }); } return r; };
    const part = (arr) => ({ n: arr.length, support: stat(arr, 'support'), best: stat(arr, 'best'), contact: stat(both(arr), 'c'), hover: stat(arr, 'hover'), supported: arr.length ? arr.reduce((p, x) => p + x.any, 0) / arr.length : 0, hoverFrac: arr.length ? arr.filter((x) => x.hover > 0.01).length / arr.length : 0 });
    return { nominal: nom, frames: rec.length, steady: part(rec.filter((r) => r.sp > 0.95 * nom)), trip: part(rec.filter((r) => r.sp > 0.05)) };
  };

  // joint angles of one gait cycle (left leg, averaged over the cycles seen), binned by the phase of the left foot's heel strikes
  CS.gaitCurve = (id, o = {}) => {
    const dt = 1 / 60, m = CREW.byId(id), [ax, az] = BR.nodes.aftL, [bx, bz] = BR.nodes.aftR;
    CS.place(id, ax, az, Math.atan2(-(bx - ax), -(bz - az))); CS.settle(m, 1.5, dt); m.goTo('aftR');
    const g = m.gait, NB = 20, bins = Array.from({ length: NB }, () => ({ n: 0, hip: 0, knee: 0, ank: 0, py: 0, lat: 0, yaw: 0, roll: 0, tilt: 0, tyaw: 0, shL: 0, shR: 0, elL: 0, elR: 0, hipR: 0, kneeR: 0 }));
    const v = new THREE.Vector3(), E = new THREE.Euler();
    let lastLand = -1, prevPl = true, t = 0, period = 0, cycles = 0, clear = 9; const rec = [];
    const FS = CS.footSets(m), SS = FS.sets[0];
    for (let i = 0; i < 60 * 12; i++) {
      CREW.update(dt); t += dt;
      const L = g.feet[0];
      if (!prevPl && L.planted) { if (lastLand >= 0 && t > 3) { period = t - lastLand; cycles++; for (const r of rec) { const b = bins[Math.min(NB - 1, Math.floor((r.t - lastLand) / period * NB))]; if (b) { b.n++; for (const k in r.v) b[k] += r.v[k]; } } } lastLand = t; rec.length = 0; }
      prevPl = L.planted;
      if (!L.planted && t > 3) { const tau = L.sw.t / L.sw.T; if (tau > 0.08 && tau < 0.92) { CS.bg().updateMatrixWorld(true); CS.readFoot(FS, SS, SS.cur); for (let j = 0; j < SS.n; j++) clear = Math.min(clear, SS.cur[3 * j + 1]); } }
      const hipOf = (leg) => { v.set(0, -1, 0).applyQuaternion(leg.hp.quaternion); return Math.atan2(-v.z, -v.y) * 57.2958; };
      const e = (b) => { E.setFromQuaternion(b.quaternion, 'XYZ'); return E; };
      rec.push({ t, v: { hip: hipOf(m.legs[0]), knee: -m.legs[0].kn.rotation.x * 57.2958, ank: e(m.legs[0].ankle).x * 57.2958, hipR: hipOf(m.legs[1]), kneeR: -m.legs[1].kn.rotation.x * 57.2958, py: m.hips.position.y * 100, lat: m.hips.position.x * 100, yaw: e(m.hips).y * 57.2958, roll: e(m.hips).z * 57.2958, tilt: e(m.hips).x * 57.2958, tyaw: m.torso.rotation.y * 57.2958, shL: m.arms[0].sh.rotation.x * 57.2958, shR: m.arms[1].sh.rotation.x * 57.2958, elL: m.arms[0].el.rotation.x * 57.2958, elR: m.arms[1].el.rotation.x * 57.2958 } });
    }
    return { period, cycles, clear, bins: bins.map((b) => { const o = { n: b.n }; for (const k in b) if (k !== 'n') o[k] = b.n ? +(b[k] / b.n).toFixed(1) : null; return o; }) };
  };
  CS.info = () => ({ seats: BR.seats.map((s) => [s.id, s.x, s.z, s.h]), nodes: BR.nodes, members: CREW.members.map((m) => [m.id, m.x, m.z, m.present]) });
  return true;
})()`;

// ------------------------------------------------------------------ driver
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(root, u === '/' ? 'index.html' : u);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : p.endsWith('.js') || p.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream' }); res.end(d); });
}).listen(0);
const port = srv.address().port;
const dport = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync('/tmp/crewshot-');
const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`,
  '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(); const logs = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r?.exceptionDetails) console.error('eval error:', (r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 600)); return r?.result?.value; };
const shot = async (name) => { await ev('CS.render(4)'); await sleep(250); const s = await send('Page.captureScreenshot', { format: 'png' }); const f = path.join(outDir, name + '.png'); fs.writeFileSync(f, Buffer.from(s.data, 'base64')); console.log('wrote', f); };

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${dport}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) logs.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: +(opt.dpr || 1), mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/?autostart&voice=off&dynres=off&${query}` });
  let started = false;
  for (let i = 0; i < 240 && !started; i++) { await sleep(500); started = await ev('!!(window.__dbg && __dbg.G && __dbg.G.started)'); }
  if (!started) throw new Error('game did not start');
  await sleep(1500);
  await ev(HELPERS);
  // stop the game's own frame loop: every frame below is stepped by hand
  await ev('window.requestAnimationFrame = () => 0; true');
  await sleep(300);
  await ev('CS.hideHud(); __dbg.G.paused = false; __dbg.G.timeScale = 1; true');
  if (opt.key) await ev('CS.key(true)');
  const info = await ev('CS.info()');
  if (opt.info) console.log(JSON.stringify(info));
  const scenes = sceneArg.split(',');
  const S = { x: 0, z: 1.0 };           // the studio spot: open floor behind the consoles
  // vertical field: the target height follows the person's height
  const persons = async (fn) => { for (const idd of ids) { await ev(`CS.hideOthers('${idd}'); true`); await fn(idd); } await ev('CS.showAll(); true'); };
  const heightOf = async (idd) => (await ev(`CS.height(CREW.byId('${idd}'))`)) || 1.8;

  for (const scene of scenes) {
    if (scene === 'stand') {
      await persons(async (idd) => {
        await ev(`CS.place('${idd}', ${S.x}, ${S.z}, 0); CS.settle(CREW.byId('${idd}'), 3); CS.neutralHead(CREW.byId('${idd}')); CS.freeze(CREW.byId('${idd}')); true`);
        const h = await heightOf(idd), ty = h * 0.52;
        const d = 3.7, fov = 32;
        await ev(`CS.cam(${S.x}, ${ty}, ${S.z - d}, ${S.x}, ${ty}, ${S.z}, ${fov})`); await shot(`${idd}_front`);
        await ev(`CS.cam(${S.x + d}, ${ty}, ${S.z}, ${S.x}, ${ty}, ${S.z}, ${fov})`); await shot(`${idd}_side`);
        await ev(`CS.cam(${S.x}, ${ty}, ${S.z + d}, ${S.x}, ${ty}, ${S.z}, ${fov})`); await shot(`${idd}_back`);
        await ev(`CS.unfreeze(CREW.byId('${idd}')); true`);
      });
    }
    if (scene === 'upper') {
      await persons(async (idd) => {
        await ev(`CS.place('${idd}', ${S.x}, ${S.z}, 0); CS.settle(CREW.byId('${idd}'), 3); CS.neutralHead(CREW.byId('${idd}')); CS.freeze(CREW.byId('${idd}')); true`);
        const h = await heightOf(idd);
        // three-quarter view from the front-left of the person's face / chest
        await ev(`CS.cam(${S.x - 0.75}, ${h * 0.84}, ${S.z - 1.15}, ${S.x}, ${h * 0.8}, ${S.z}, 30)`); await shot(`${idd}_upper`);
        // the person's right hand hangs at (+0.22, ~0.8 h)
        await ev(`CS.cam(${S.x + 0.55}, ${h * 0.5}, ${S.z - 0.75}, ${S.x + 0.2}, ${h * 0.48}, ${S.z}, 26)`); await shot(`${idd}_hand`);
        await ev(`CS.unfreeze(CREW.byId('${idd}')); true`);
      });
    }
    if (scene === 'neck') {
      // head, neck and collar from the front, the front three-quarter, the side and the back (a lit close-up: use with --key)
      await persons(async (idd) => {
        await ev(`CS.place('${idd}', ${S.x}, ${S.z}, 0); CS.settle(CREW.byId('${idd}'), 3); CS.neutralHead(CREW.byId('${idd}')); CS.freeze(CREW.byId('${idd}')); true`);
        const h = await heightOf(idd), y = h * 0.9, d = 0.95;
        for (const [nm, ax, az] of [['front', 0, -d], ['three', -0.7 * d, -0.7 * d], ['side', -d, 0], ['back', 0, d]]) { await ev(`CS.cam(${S.x + ax}, ${y + 0.04}, ${S.z + az}, ${S.x}, ${y - 0.02}, ${S.z}, 22)`); await shot(`${idd}_neck_${nm}`); }
        await ev(`CS.unfreeze(CREW.byId('${idd}')); true`);
      });
    }
    if (scene === 'seat') {
      await persons(async (idd) => {
        await ev(`CS.spot('${idd}', 'radarL'); CS.settle(CREW.byId('${idd}'), 3); CS.freeze(CREW.byId('${idd}')); true`);
        // the port radar chair: navL at (-5.5, -3.25), the sitter faces forward
        await ev(`CS.cam(-4.0, 1.35, -1.55, -5.5, 0.95, -3.1, 38)`); await shot(`${idd}_seat_a`);
        await ev(`CS.cam(-2.6, 1.0, -3.15, -5.5, 0.85, -3.15, 36)`); await shot(`${idd}_seat_b`);
        await ev(`CS.unfreeze(CREW.byId('${idd}')); CREW.byId('${idd}').standUp(); true`);
      });
    }
    if (scene === 'handset') {
      await persons(async (idd) => {
        await ev(`CS.spot('${idd}', 'vhf'); CS.settle(CREW.byId('${idd}'), 3); CS.freeze(CREW.byId('${idd}')); true`);
        const [hx, hz] = [-2.2, -3.45];
        await ev(`CS.cam(${hx + 1.3}, 1.5, ${hz + 1.2}, ${hx}, 1.35, ${hz}, 30)`); await shot(`${idd}_handset_a`);
        await ev(`CS.cam(${hx + 1.9}, 1.45, ${hz + 0.05}, ${hx}, 1.35, ${hz}, 30)`); await shot(`${idd}_handset_b`);
        await ev(`CS.unfreeze(CREW.byId('${idd}')); true`);
      });
    }
    if (scene === 'poses') {
      for (const [spot, nm] of [['ecdL', 'console'], ['steer', 'press'], ['chart', 'write'], ['wingL', 'binos']]) {
        await persons(async (idd) => {
          await ev(`CS.spot('${idd}', '${spot}'); CS.settle(CREW.byId('${idd}'), 3); CS.freeze(CREW.byId('${idd}')); true`);
          const [mx, mz, face] = await ev(`(() => { const m = CREW.byId('${idd}'); return [m.x, m.z, m.face]; })()`);
          const fx = -Math.sin(face), fz = -Math.cos(face), rx = Math.cos(face), rz = -Math.sin(face);   // forward and right of the person (bridge x, z)
          const cam = (a, b, y, ty, fov) => `CS.cam(${mx + fx * a + rx * b}, ${y}, ${mz + fz * a + rz * b}, ${mx}, ${ty}, ${mz}, ${fov})`;
          await ev(cam(0, 2.1, 1.4, 1.2, 36)); await shot(`${idd}_pose_${nm}_side`);
          await ev(cam(-1.6, 1.2, 1.7, 1.2, 36)); await shot(`${idd}_pose_${nm}_rear`);
          await ev(`CS.unfreeze(CREW.byId('${idd}')); true`);
        });
      }
    }
    if (scene === 'walk') {
      const nFrames = +(opt.frames || 8);
      for (const idd of (opt.walkids ? opt.walkids.split(',') : ids.slice(0, 2))) {
        await ev(`CS.hideOthers('${idd}'); true`);
        // walk aftL -> aftR along z = 2.6 (yaw -pi/2 faces +x); the camera behind (aft of) the path sees the walker's right side moving to the image right
        // warm up, then find the gait period from the left foot's height peaks
        const r = await ev(`(() => {
          const m = CREW.byId('${idd}'); CS.place('${idd}', -7.5, 2.6, -Math.PI / 2); CS.settle(m, 1);
          m.goTo('aftR');
          const dt = 1 / 60, ys = [], xs = [], rel = [], v = new CS.THREE.Vector3();
          for (let i = 0; i < 60 * 3.5; i++) CREW.update(dt);
          CS.bg().updateMatrixWorld(true);
          for (let i = 0; i < 60 * 3; i++) { CREW.update(dt); CS.bg().updateMatrixWorld(true); const f = CS.footPoint(m, 0, v); ys.push(f.y); xs.push(m.x); rel.push(f.x - m.x); }
          const mean = rel.reduce((a, b) => a + b, 0) / rel.length; const cr = [];
          for (let i = 1; i < rel.length; i++) if (rel[i - 1] - mean < 0 && rel[i] - mean >= 0) cr.push(i - 1 + (mean - rel[i - 1]) / (rel[i] - rel[i - 1]));
          const per = cr.length > 1 ? (cr[cr.length - 1] - cr[0]) / (cr.length - 1) * dt : 0.84;
          return { per, x: m.x, speed: Math.abs(xs[xs.length - 1] - xs[0]) / (xs.length * dt), cycles: cr.length, ymin: Math.min(...ys), ymax: Math.max(...ys) };
        })()`);
        console.log('walk', idd, JSON.stringify(r));
        // restart cleanly and capture frames across one cycle at steady state
        await ev(`(() => { const m = CREW.byId('${idd}'); CS.place('${idd}', -7.5, 2.6, -Math.PI / 2); CS.settle(m, 1); m.goTo('aftR'); return true; })()`);
        await ev(`CS.stepCrew(${Math.round(60 * 3.5)}, 1 / 60); true`);
        const per = r.per || 0.84, hh = await heightOf(idd), view = opt.view || 'side', [cx, cz] = { side: [0, 3.2], front: [3.6, 0.15], back: [-3.6, 0.15], three: [2.6, 2.2] }[view];
        for (let k = 0; k < nFrames; k++) {
          const st = Math.round(k * per * 60 / nFrames) - Math.round((k - 1) * per * 60 / nFrames);
          await ev(`(() => { CS.stepCrew(${k === 0 ? 0 : st}, 1 / 60); const m = CREW.byId('${idd}'); CS.cam(m.x + ${cx}, ${hh * 0.5}, m.z + ${cz}, m.x, ${hh * 0.5}, m.z, 36); return true; })()`);
          await shot(`${idd}_walk${view === 'side' ? '' : '_' + view}_${k}`);
        }
        await ev(`(() => { const m = CREW.byId('${idd}'); m.path = []; m.task = null; return true; })()`);
      }
      await ev('CS.showAll(); true');
    }
    if (scene === 'helm') {
      // the helmsman at the wheel (hand steering): from behind-left, from the side and from the front
      await ev(`(() => { const ab = CREW.byId('ab'); CS.hideOthers('ab'); const [x, z] = BR.nodes.helm; CS.place('ab', x, z, 0); ab.node = 'helm'; ab.state = 'idle'; if (ab.home) ab.home.node = 'helm'; CS.settle(ab, 3); CS.freeze(ab); return true; })()`);
      const hn = await ev(`BR.nodes.helm`); const [hx, hz] = hn;
      for (const [nm, ax, ay, az] of [['back', -0.9, 1.5, 1.4], ['side', -1.7, 1.3, 0], ['front', 0.5, 1.4, -1.5]]) { await ev(`CS.cam(${hx + ax}, ${ay}, ${hz + az}, ${hx}, 1.2, ${hz}, 38)`); await shot(`ab_helm_${nm}`); }
      await ev('CS.unfreeze(CREW.byId("ab")); CS.showAll(); true');
    }
    if (scene === 'corner') {
      // a right-angle turn while walking (-4, 2.6) -> (-4, 6): a frame every --every seconds (default 0.25) from just before the corner, camera following from the side
      const every = +(opt.every || 0.25), nF = +(opt.frames || 12), start = +(opt.start || 2.7);
      for (const idd of (opt.walkids ? opt.walkids.split(',') : ids.slice(0, 1))) {
        await ev(`CS.hideOthers('${idd}'); true`);
        await ev(`(() => { const m = CREW.byId('${idd}'); CS.place('${idd}', -7, 2.6, -Math.PI / 2); CS.settle(m, 1.5); m.path = [[-4, 2.6], [-4, 6]]; m.state = 'walk'; return true; })()`);
        await ev(`CS.stepCrew(${Math.round(60 * start)}, 1 / 60); true`);
        const hh = await heightOf(idd);
        for (let k = 0; k < nF; k++) {
          await ev(`(() => { CS.stepCrew(${k === 0 ? 0 : Math.round(every * 60)}, 1 / 60); const m = CREW.byId('${idd}'); CS.cam(m.x - 3.2, ${hh * 0.5}, m.z, m.x, ${hh * 0.5}, m.z, 36); return true; })()`);
          await shot(`${idd}_corner_${String(k).padStart(2, '0')}`);
        }
        await ev(`(() => { const m = CREW.byId('${idd}'); m.path = []; m.task = null; return true; })()`);
      }
      await ev('CS.showAll(); true');
    }
    if (scene === 'skate') {
      // foot skate while walking aftL -> aftR (15 m): ground speed of the feet. "contact" = vertices within 8 mm of the floor (central difference);
      // "lowest foot" = the lowest vertex of the lower foot, followed from frame to frame; "slower foot" = the better of the two feet
      const fmt = (o) => (o ? `mean ${o.mean.toFixed(3)}  p50 ${o.p50.toFixed(3)}  p95 ${o.p95.toFixed(3)}  max ${o.max.toFixed(3)}  (n=${o.n})` : 'none (the foot never rests on the floor)');
      for (const idd of (opt.walkids ? opt.walkids.split(',') : ids.slice(0, 3))) {
        await ev(`CS.hideOthers('${idd}'); true`);
        const r = await ev(`CS.skate('${idd}', 'aftL', 'aftR', { seconds: 16 })`);
        console.log(`skate ${idd}: nominal speed ${r.nominal.toFixed(2)} m/s, ${r.frames} frames`);
        for (const [nm, p] of [['steady walking', r.steady], ['whole trip', r.trip]]) {
          console.log(`  ${nm} (${p.n} frames)`);
          console.log(`    contact slip [m/s]      : ${fmt(p.contact)}`);
          console.log(`    lowest foot speed [m/s] : ${fmt(p.support)}`);
          console.log(`    slower foot speed [m/s] : ${fmt(p.best)}`);
          console.log(`    lowest foot height [m]  : ${p.hover ? p.hover.mean.toFixed(3) + ' mean, ' + p.hover.max.toFixed(3) + ' max' : '-'};  frames with a foot on the floor: ${(p.supported * 100).toFixed(0)} %,  hovering > 1 cm: ${(p.hoverFrac * 100).toFixed(0)} %`);
        }
        if (opt.json) fs.writeFileSync(path.join(outDir, `skate_${idd}.json`), JSON.stringify(r, null, 1));
      }
      await ev('CS.showAll(); true');
    }
    if (scene === 'probe') {
      // run page-side JavaScript (--js "code" or --jsfile path; the code may `return` a value) and print the result: handy for probing the model
      const code = opt.jsfile ? fs.readFileSync(opt.jsfile, 'utf8') : opt.js;
      const r = await ev(`(async () => { ${code} })()`);
      console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
    }
    if (scene === 'gaitcurve') {
      for (const idd of (opt.walkids ? opt.walkids.split(',') : ids.slice(0, 1))) {
        await ev(`CS.hideOthers('${idd}'); true`);
        const r = await ev(`CS.gaitCurve('${idd}')`);
        console.log(`gait ${idd}: period ${r.period.toFixed(3)} s (${(2 / r.period).toFixed(2)} steps/s), ${r.cycles} cycles, minimum toe clearance in swing ${(r.clear * 100).toFixed(1)} cm`);
        console.log('phase%  hipL  kneeL  ankL | hipR kneeR | hipsY[cm] lat[cm] yaw  roll  tilt | torsoYaw | shL  shR  elL  elR');
        r.bins.forEach((b, i) => console.log(`${String(i * 5).padStart(4)}   ${[b.hip, b.knee, b.ank].map((x) => String(x).padStart(5)).join(' ')} | ${[b.hipR, b.kneeR].map((x) => String(x).padStart(5)).join(' ')} | ${[b.py, b.lat, b.yaw, b.roll, b.tilt].map((x) => String(x).padStart(6)).join(' ')} | ${String(b.tyaw).padStart(5)} | ${[b.shL, b.shR, b.elL, b.elR].map((x) => String(x).padStart(5)).join(' ')}`));
      }
      await ev('CS.showAll(); true');
    }
    if (scene === 'startstop') {
      // from standing: start, walk a few metres, stop and settle; a frame every --every seconds (default 0.2), camera follows
      const every = +(opt.every || 0.2), nF = +(opt.frames || 14), dist = +(opt.dist || 3.2);
      for (const idd of (opt.walkids ? opt.walkids.split(',') : ids.slice(0, 1))) {
        await ev(`CS.hideOthers('${idd}'); true`);
        await ev(`(() => { const m = CREW.byId('${idd}'); CS.place('${idd}', -1.5, 2.6, -Math.PI / 2); CS.settle(m, 2); m.path = [[${-1.5 + dist}, 2.6]]; m.state = 'walk'; return true; })()`);
        const hh = await heightOf(idd), [cx, cz] = { side: [0, 3.2], front: [3.6, 0.15], three: [2.6, 2.2] }[opt.view || 'side'];
        for (let k = 0; k < nF; k++) {
          await ev(`(() => { CS.stepCrew(${k === 0 ? 0 : Math.round(every * 60)}, 1 / 60); const m = CREW.byId('${idd}'); CS.cam(m.x + ${cx}, ${hh * 0.5}, m.z + ${cz}, m.x, ${hh * 0.5}, m.z, 36); return true; })()`);
          await shot(`${idd}_startstop_${String(k).padStart(2, '0')}`);
        }
        await ev(`(() => { const m = CREW.byId('${idd}'); m.path = []; return true; })()`);
      }
      await ev('CS.showAll(); true');
    }
    if (scene === 'decks') {
      await ev('CS.hideHud(); __dbg.CREW.showStation("fwd", true); __dbg.CREW.showStation("aft", true); __dbg.CREW.stations.fwd.forEach((h, i) => { h.root.visible = true; }); true');
      await ev('CS.stepCrew(60, 1 / 30); true');
      const camShip = (cx, cy, cz, tx, ty, tz, fov) => `(() => { const g = __dbg.G.shipGroup, c = __dbg.camera, T = CS.THREE; const a = new T.Vector3(), b = new T.Vector3(); CS.camFn(function () { g.updateMatrixWorld(); a.set(${cx}, ${cy}, ${cz}).applyMatrix4(g.matrixWorld); b.set(${tx}, ${ty}, ${tz}).applyMatrix4(g.matrixWorld); c.position.copy(a); c.up.set(0, 1, 0); c.lookAt(b); if (c.fov !== ${fov}) { c.fov = ${fov}; c.updateProjectionMatrix(); } }); return true; })()`;
      const fwd = await ev('(() => { const s = __dbg.CREW.stations.fwd.map((h) => h.root.position.toArray()); const a = __dbg.CREW.stations.aft.map((h) => h.root.position.toArray()); return { s, a }; })()');
      console.log('stations', JSON.stringify(fwd));
      const f0 = fwd.s[1], a0 = fwd.a[0];
      await ev(camShip(f0[0] + 5.5, f0[1] + 2.2, f0[2] - 7, f0[0], f0[1] + 1.1, f0[2], 36)); await shot('decks_fwd_a');
      await ev(camShip(f0[0] - 8, f0[1] + 2.4, f0[2] - 4, f0[0], f0[1] + 1.0, f0[2] + 1, 40)); await shot('decks_fwd_b');
      await ev(camShip(f0[0] + 12, f0[1] + 8, f0[2] - 18, f0[0], f0[1] + 1, f0[2], 40)); await shot('decks_fwd_c');
      await ev(camShip(a0[0] - 6, a0[1] + 2.4, a0[2] + 7, a0[0], a0[1] + 1.1, a0[2], 36)); await shot('decks_aft_a');
      // the orbit camera as a player would use it: from 90 m, looking at the ship
      await ev('(() => { const P = __dbg.PLAYER; if (P.__upd) P.update = P.__upd; __dbg.camera.fov = 68; __dbg.camera.updateProjectionMatrix(); if (__dbg.G.mode !== "orbit") P.toggleOrbit(); P.orbit.az = -0.6; P.orbit.el = 0.22; P.orbit.dist = 90; return true; })()');
      await shot('decks_orbit_90m');
      await ev('(() => { const P = __dbg.PLAYER; P.orbit.az = 0.5; P.orbit.el = 0.35; P.orbit.dist = 140; return true; })()');
      await shot('decks_orbit_140m');
      await ev('__dbg.CREW.showStation("fwd", false); __dbg.CREW.showStation("aft", false); true');
    }
    if (scene === 'fp') {
      // the player's own eyes: next to the C/O at his console, and across the bridge
      await ev('(() => { const P = __dbg.PLAYER; if (P.__upd) { P.update = P.__upd; } __dbg.camera.fov = 68; __dbg.camera.updateProjectionMatrix(); if (__dbg.G.mode !== "bridge") P.toggleOrbit(); return true; })()');
      const views = [['fp_co_side', -3.1, -2.3, -1.2, -0.12], ['fp_co_close', -3.6, -1.9, -0.55, -0.2], ['fp_o2_side', 3.2, -2.2, 1.2, -0.12], ['fp_o3_close', 1.1, -2.1, 0.25, -0.22], ['fp_back', 0, 1.9, 3.14159, -0.1]];
      for (const [nm, x, z, yaw, pitch] of views) { await ev(`(() => { const P = __dbg.PLAYER; P.place(${x}, ${z}, ${yaw}); P.pitch = ${pitch}; return true; })()`); await shot(nm); }
    }
  }
  if (logs.length) console.log('LOG', logs.slice(0, 20).join('\n'));
} catch (e) { console.error('FAILED', e); if (logs.length) console.log('LOG', logs.slice(0, 20).join('\n')); process.exitCode = 1; }
finally { ch.kill(); srv.close(); await sleep(400); try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5 }); } catch {} process.exit(process.exitCode || 0); }
