// Regression smoke test for the renderer, in headless Chrome with the GPU on.
//   node build.mjs && node tools/smoke.mjs [simSeconds=240]
// For every time of day × quality it starts the game, runs the simulation, drives the camera through bridge, orbit and the
// port, and fails on: uncaught exceptions, console errors (other than the known 404 favicon), WebGL errors / shader compile
// failures, a blank frame, or a save/restore round trip that changes the ship.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const SIM = +(process.argv[2] || 240);
const root = process.env.SHOT_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(root, u === '/' ? 'index.html' : u);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); res.end(d); });
}).listen(0);
const port = srv.address().port;

async function runCase(tod, quality, extra = '') {
  const dport = 9300 + Math.floor(Math.random() * 500), prof = fs.mkdtempSync('/tmp/smoke-');
  const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${prof}`, '--window-size=1280,800', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', 'about:blank'], { stdio: 'ignore' });
  const problems = [], info = {}; let glWarn = 0;
  let ws, id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r?.exceptionDetails) problems.push('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r?.result?.value; };
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${dport}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
      if (d.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') problems.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/favicon|404/.test(d.params.entry.text + (d.params.entry.url || ''))) problems.push('log.error: ' + d.params.entry.text.slice(0, 300));
      // the driver reports invalid GL calls as *warnings* in the log (and stops after 256); gl.getError() sampled once per view misses most of them
      if (d.method === 'Log.entryAdded' && /GL_INVALID|CONTEXT_LOST|Mismatch between texture/.test(d.params.entry.text)) { glWarn++; if (glWarn === 1) problems.push('WebGL driver error: ' + d.params.entry.text.slice(0, 200)); }
    };
    await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
    const t0 = Date.now();
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/?autostart&voice=off&dynres=off&tod=${tod}&quality=${quality}&sea=moderate${extra}` });
    // wait for the game to start (loading screen gone)
    let started = false;
    for (let i = 0; i < 120 && !started; i++) { await sleep(500); started = await ev('!!(window.__dbg && __dbg.G && __dbg.G.started)'); }
    if (!started) { problems.push('game did not start'); return { problems, info }; }
    info.loadSec = ((Date.now() - t0) / 1000).toFixed(1);
    // WebGL error watch
    await ev(`(() => { const gl = __dbg.renderer.getContext(); window.__glErrs = []; const o = gl.getError.bind(gl); return true; })()`);
    const prog = await ev(`(() => { const r = __dbg.renderer; const bad = []; for (const p of (r.info.programs || [])) { const d = r.getContext().getProgramParameter(p.program, r.getContext().LINK_STATUS); if (!d) bad.push(p.name); } return { programs: (r.info.programs || []).length, bad }; })()`);
    info.programs = prog?.programs; if (prog?.bad?.length) problems.push('program link failed: ' + prog.bad.join(','));
    // run the simulation
    const run = await ev(`(() => { const r = __dbg.run(${SIM}, 0.25); __dbg.frame(30, 1 / 30); return r; })()`);
    info.sim = run && `x=${run.x?.toFixed(0)} sog=${run.sog?.toFixed(1)} step=${run.step}`;
    // look around, render, sample pixels
    for (const cam of ['bridge', 'orbit', 'bridge']) {
      await ev(`(() => { const P = __dbg.PLAYER; if ('${cam}' === 'orbit' && __dbg.G.mode !== 'orbit') P.toggleOrbit(); if ('${cam}' === 'bridge' && __dbg.G.mode !== 'bridge') P.toggleOrbit(); __dbg.frame(20, 1 / 30); return true; })()`);
      const stats = await ev(`(() => { const gl = __dbg.renderer.getContext(); const e = gl.getError(); const c = __dbg.renderer.domElement; const w = c.width, h = c.height; const px = new Uint8Array(w * h * 4);
        // read back the default framebuffer after a fresh frame
        __dbg.frame(1, 1 / 60); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); let s = 0, mn = 255, mx = 0, n = 0; for (let i = 0; i < px.length; i += 64) { const l = (px[i] + px[i + 1] + px[i + 2]) / 3; s += l; n++; if (l < mn) mn = l; if (l > mx) mx = l; } return { err: e, mean: s / n, mn, mx }; })()`);
      if (stats?.err) problems.push(`GL error ${stats.err} in ${cam}`);
      if (stats && (stats.mx - stats.mn < 8)) problems.push(`${cam}: blank frame (mean ${stats.mean.toFixed(1)}, range ${stats.mn}..${stats.mx})`);
      info[cam] = stats && `mean ${stats.mean.toFixed(0)} range ${stats.mn}..${stats.mx}`;
    }
    // the port, seen from a free camera on the quay (the ship is still at sea): paved ground, cranes, tugs and the far shadows
    const portView = await ev(`(() => { const P = __dbg.PLAYER; if (__dbg.G.mode !== 'orbit') P.toggleOrbit(); const c = __dbg.camera; P.__upd = P.__upd || P.update;
      P.update = function () { c.position.set(-780, 9, -520); c.lookAt(-800, 22, -672); }; __dbg.frame(40, 1 / 30);
      const gl = __dbg.renderer.getContext(), e = gl.getError(), F = __dbg.FARSHADOW, far = F && F.on ? { baked: F.baked, w: F.U.uFarInfo.value.w } : null;
      P.update = P.__upd; __dbg.frame(2, 1 / 30);                                  // (read before the camera goes back to the ship: out at sea the far shadows switch themselves off)
      return { err: e, far }; })()`);
    if (portView?.err) problems.push(`GL error ${portView.err} in the port view`);
    if (portView?.far && !(portView.far.baked && portView.far.w === 1)) problems.push('far shadows did not come up in the port: ' + JSON.stringify(portView.far));
    info.port = portView && (portView.far ? 'far shadows on' : 'no far shadows');
    // scenario visuals: the pilot ladder goes over the side when rigged, the mooring lines go out when made fast (and survive a save / restore)
    const scn = await ev(`(() => { const G = __dbg.G, S = __dbg.SCN; G.flags.leeSide = G.flags.leeSide || 'STBD'; S.rigLadder(); __dbg.run(170, 0.25); __dbg.frame(3, 1 / 30);
      const L = G.shipGroup.userData.ladders, lad = G.flags.ladder && L && L[G.flags.leeSide].visible && !L[G.flags.leeSide === 'STBD' ? 'PORT' : 'STBD'].visible;
      S.makeFast('fwd', 'PORT'); S.makeFast('aft', 'PORT'); __dbg.frame(3, 1 / 30); const n = S.lineMeshes.length; G.flags.ladder = false; G.flags.linesFwd = G.flags.linesAft = false;
      S.clearLines(); __dbg.frame(2, 1 / 30); return { lad, n, left: S.lineMeshes.length, err: __dbg.renderer.getContext().getError() }; })()`);
    if (!scn?.lad) problems.push('pilot ladder not shown when rigged: ' + JSON.stringify(scn));
    if (scn?.n !== 8 || scn?.left !== 0) problems.push('mooring lines: ' + JSON.stringify(scn));
    if (scn?.err) problems.push('GL error ' + scn.err + ' after the scenario visuals');
    info.scn = scn && `ladder ${scn.lad ? 'ok' : 'MISSING'}, ${scn.n} lines`;
    // save → snapshot compare → restore into the same session
    const sv = await ev(`(() => { const s = __dbg.G.ship; const before = [s.x, s.z, s.psi, s.u]; const ok = __dbg.SAVE.save(false); const list = __dbg.SAVE.list(); if (!ok || !list.length) return { ok: false }; __dbg.SAVE.apply(list[0]); __dbg.frame(5, 1 / 30); const after = [s.x, s.z, s.psi, s.u]; return { ok: true, d: Math.hypot(before[0] - after[0], before[1] - after[1]) }; })()`);
    if (!sv?.ok) problems.push('save failed'); else if (sv.d > 5) problems.push('restore moved the ship by ' + sv.d.toFixed(1) + ' m');
    // dynamic resolution + resize path
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 640, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    await ev('__dbg.frame(10, 1 / 30); true');
    const gle = await ev('__dbg.renderer.getContext().getError()');
    if (gle) problems.push('GL error after resize: ' + gle);
  } catch (e) { problems.push('harness: ' + e.message); }
  finally { ch.kill(); await sleep(400); try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5 }); } catch {} }
  if (glWarn > 1) problems.push(`…and ${glWarn - 1} more WebGL driver errors`);
  return { problems, info };
}

let bad = 0;
const cases = [['morning', 'high'], ['golden', 'high'], ['night', 'high'], ['morning', 'medium'], ['night', 'low'], ['morning', 'low'], ['morning', 'high', '&post=off']];
const only = process.env.SMOKE_CASES ? process.env.SMOKE_CASES.split(',') : null;
for (const [tod, q, extra] of cases) {
  if (only && !only.includes(`${tod}/${q}${extra || ''}`)) continue;
  const r = await runCase(tod, q, extra || '');
  const tag = `${tod}/${q}${extra || ''}`;
  console.log(r.problems.length ? 'FAIL' : 'ok  ', tag.padEnd(24), JSON.stringify(r.info));
  for (const p of r.problems) console.log('       ·', p);
  bad += r.problems.length;
}
srv.close();
console.log(bad ? `\n${bad} problem(s)` : '\nall cases clean');
process.exit(bad ? 1 : 0);
