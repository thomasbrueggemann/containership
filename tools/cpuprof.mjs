// CPU sampling profile of the running game in headless Chrome (GPU on): where does the JavaScript time go, and how much of each
// frame is the page waiting for the GPU?
//   node build.mjs && node tools/cpuprof.mjs "tod=morning&sea=moderate" [bridge|orbit] [seconds=6] [WxH=1280x800] [top=30]
// Env: SHOT_ROOT (build other than the repo), SHOT_DPR (device pixel ratio), SHOT_JS (evaluated once before profiling).
// Output: frames/s over the window, JS self time by function (ms per frame), and the share of each frame spent idle (GPU/vsync bound).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const [query = '', view = 'bridge', secArg = '6', size = '1280x800', topArg = '30'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number), SEC = +secArg, TOP = +topArg;
const root = process.env.SHOT_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]), p = path.join(root, u === '/' ? 'index.html' : u);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); res.end(d); });
}).listen(0);
const dport = 9300 + Math.floor(Math.random() * 500), prof = fs.mkdtempSync('/tmp/cpuprof-');
const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value;
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${dport}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: +(process.env.SHOT_DPR || 1), mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${port()}/?autostart&voice=off&dynres=off${query ? '&' + query : ''}` });
  function port() { return srv.address().port; }
  await sleep(12000);
  await ev(view === 'orbit' ? `(() => { const P = __dbg.PLAYER; if (__dbg.G.mode !== 'orbit') P.toggleOrbit(); P.orbit.az = 2.3; P.orbit.el = 0.32; P.orbit.dist = 620; return true; })()`
    : `(() => { const P = __dbg.PLAYER; if (__dbg.G.mode !== 'bridge') P.toggleOrbit(); P.place(-0.4, -1.6, 0); P.pitch = -0.04; return true; })()`);
  if (process.env.SHOT_JS) await ev(process.env.SHOT_JS);
  await sleep(2500);
  await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 250 });
  const frames0 = await ev('window.__f0 = 0; (function c(){ window.__f0++; requestAnimationFrame(c); })(); true');
  await send('Profiler.start'); const t0 = Date.now();
  await sleep(SEC * 1000);
  const { profile } = await send('Profiler.stop'); const wall = (Date.now() - t0) / 1000;
  const frames = await ev('window.__f0');
  // aggregate self time by function
  const byId = new Map(profile.nodes.map((n) => [n.id, n])), self = new Map();
  profile.samples.forEach((sid, i) => { const dt = (profile.timeDeltas[i] || 0) / 1000; const n = byId.get(sid), cf = n.callFrame; const key = (cf.functionName || '(anon)') + ' ' + (cf.url.split('/').pop() || '') + ':' + cf.lineNumber; self.set(key, (self.get(key) || 0) + dt); });
  const total = [...self.values()].reduce((a, b) => a + b, 0), idle = (self.get('(idle) :-1') || 0), prog = (self.get('(program) :-1') || 0), gc = (self.get('(garbage collector) :-1') || 0);
  const fps = frames / wall, perFrame = 1000 / fps;
  console.log(`window ${wall.toFixed(1)} s, ${frames} rAF callbacks = ${fps.toFixed(1)} fps (${perFrame.toFixed(1)} ms/frame)`);
  console.log(`per frame: JS+native busy ${((total - idle) / frames).toFixed(1)} ms, idle ${(idle / frames).toFixed(1)} ms, (program) ${(prog / frames).toFixed(1)} ms, GC ${(gc / frames).toFixed(2)} ms`);
  [...self.entries()].filter(([k]) => !/^\((idle|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, TOP).forEach(([k, v]) => console.log(`${(v / frames).toFixed(2).padStart(7)} ms/frame  ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`));
} finally { ch.kill(); srv.close(); await sleep(400); try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5 }); } catch {} process.exit(0); }
