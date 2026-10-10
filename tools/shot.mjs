// Takes several screenshots of the game in headless Chrome (GPU on) from one page load.
//   node build.mjs && node tools/shot.mjs <outDir> [query] [presets] [waitSec] [WxH]
// presets: comma list of  bridge | orbit | bow | stern | quarter | crane | port | berth | sky | water | low   (default: bridge,orbit)
// e.g.  node tools/shot.mjs /tmp/shots "tod=night&sea=rough" bridge,orbit,water 14 1600x900
// Env:  SHOT_CONSOLE=1 prints console output / exceptions;  SHOT_JS="..." evaluated once before the presets;
//       SHOT_PERF=1 also prints the average frame time (ms) of 90 frames after each shot,
//       SHOT_URL=https://… shoots a deployed build instead of the local one (e.g. the GitHub Pages site),
//       SHOT_AFTER="..." is evaluated after each preset has been placed (before the shot) and its result printed,
//       SHOT_TOGGLE="..." (+ SHOT_TOGGLE_BACK) shoots every view twice, with that switch thrown for the second shot (<name>_b.png).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const [outDir = 'shots', query = '', presetArg = 'bridge,orbit', waitSec = '14', size = '1280x800'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const root = process.env.SHOT_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(outDir, { recursive: true });

// Camera presets. All in world coordinates relative to the own ship (x east, z south, y up);
// the ship starts at (-15600, 105) heading 090, so "orbit" distances are around her.
const PRESETS = {
  bridge: `inBridge(-0.4, -1.6, 0, -0.04)`,
  bridgeUp: `inBridge(-0.4, -1.6, 0, 0.12)`,
  bridgeDown: `inBridge(-0.4, -4.6, 0, -0.5)`,
  wingPort: `inBridge(-27.2, -2.3, 0.9, -0.25)`,
  wingAft: `inBridge(27.2, -2.3, 2.9, -0.2)`,
  consoles: `inBridge(-0.4, -1.6, 0, -0.55)`,
  bridgeSide: `inBridge(-0.4, -1.6, -0.9, -0.05)`,
  bridgeSun: `inBridge(-0.4, -1.6, -0.62, 0.1)`,
  wingQuay: `inBridge(-27.2, -2.3, 1.2, -0.45)`,
  wingQuayFwd: `inBridge(-27.2, -2.3, 0.4, -0.5)`,
  berthOrbit: `orbit(0.4, 0.2, 520)`,
  berthLow: `orbit(0.9, 0.04, 260)`,
  bridgeAft: `inBridge(-0.4, -1.6, 3.14159, -0.1)`,
  bridgeRight: `inBridge(0.8, -1.6, 0.85, -0.12)`,
  bridgeCeil: `inBridge(-0.4, -1.6, 0.4, 0.55)`,
  orbit: `orbit(2.3, 0.32, 620)`,
  bow: `orbit(-0.55, 0.12, 330)`,
  bowClose: `orbit(-0.9, 0.05, 150)`,
  // ship-local camera: x starboard, y up, z aft (bow at z = -199.6); then target x, z
  bowTop: `freecamShip(62, 52, -140, 0, -196)`,
  bowTop2: `freecamShip(30, 34, -120, 0, -190)`,
  bowLow: `freecamShip(-40, 7, -150, -10, -196)`,
  bowAhead: `freecamShip(10, 6, -270, 0, -190)`,
  bowSideLow: `freecamShip(-85, 6, -120, -25, -170)`,
  bowOver: `freecamShip(20, 90, -230, 0, -185)`,
  patrol: `freecamPatrol(36, 10, 150)`,
  patrolHi: `freecamPatrol(50, 30, 100)`,
  patrolSide: `freecamPatrol(30, 6, 80)`,
  railA: `freecamShip(46, 24, -168, 28, -168)`,
  railB: `freecamShip(46, 26, 40, 28, 40)`,
  bowA: `freecamShip(48, 16, -160, 0, -218)`,
  bowB: `freecamShip(75, 30, -110, -12, -206)`,
  bowC: `freecamShip(26, 7, -240, -6, -196)`,
  bowD: `freecamShip(14, 95, -186, 5, -200)`,
  bowE: `freecamShip(-60, 20, -150, 0, -222)`,
  sternTop: `freecamShip(60, 50, 280, 0, 196)`,
  aftDeck: `freecamShip(12, 28, 232, 0, 186)`,
  // the accommodation block and the bridge, from the starboard side, ahead, and above
  houseSide: `freecamShip(95, 52, -45, 0, -50)`,
  houseFront: `freecamShip(10, 58, -135, 0, -50)`,
  houseQuarter: `freecamShip(60, 70, 20, 0, -50)`,
  funnel: `freecamShip(70, 60, 120, 0, 130)`,
  aftDeck2: `freecamShip(30, 16, 215, -6, 190)`,
  foreDeck: `freecamShip(14, 26, -150, 0, -186)`,
  foreDeck2: `freecamShip(26, 14, -165, 0, -190)`,
  deckMid: `freecamShip(10, 24, 130, 0, 100)`,
  wakeA: `freecamShip(40, 60, 330, 0, 480)`,
  wakeB: `freecamShip(120, 220, 360, 0, 700)`,
  wakeC: `freecamShip(10, 25, 260, 0, 330)`,
  bowHigh: `orbit(-0.5, 0.35, 180)`,
  bowSide: `orbit(-1.57, 0.03, 200)`,
  vee: `freecamShip(210, 120, -330, -10, -150)`,
  vee2: `freecamShip(-200, 110, -300, 10, -140)`,
  vee3: `freecamShip(60, 260, -170, 0, -150)`,
  veeTop: `freecamShip(0, 420, -60, 0, -61)`,
  veeTopNear: `freecamShip(0, 230, -150, 0, -151)`,
  veeHigh: `freecamShip(120, 330, 40, 10, -200)`,
  stern: `orbit(2.8, 0.1, 380)`,
  quarter: `orbit(1.2, 0.18, 260)`,
  low: `orbit(0.9, 0.025, 800)`,
  sky: `orbit(1.9, 1.2, 600)`,
  water: `orbit(0.6, 0.05, 140)`,
  crane: `freecam(-1600, 14, 40, -1150, 40, 0)`,
  port: `freecam(-2200, 30, 260, 300, 25, -600)`,
  berth: `freecam(200, 12, 40, 300, 22, -700)`,
  quay: `freecam(-560, 9, -640, -640, 30, -705)`,
  yardLow: `freecam(-300, 8, -740, -300, 6, -1100)`,
  yardHigh: `freecam(-200, 60, -760, -150, 12, -1300)`,
  groundClose: `freecam(-300, 6.6, -800, -300, 4.85, -835)`,
  // the terminal's yard gantries and the trees behind it at working distances
  gantryA: `freecam(-262, 16, -790, -250, 14, -905)`,
  // alongside: needs SHOT_JS="shipAtBerth(); true"
  atWingFwd: `inBridge(-27.2, -2.3, 0.5, -0.3)`,
  ropeFwd: `freecam(450, 22, -650, 470, 18, -700)`,
  ropeAft: `freecam(150, 22, -650, 130, 18, -700)`,
  ropeQuay: `freecam(500, 8, -715, 480, 14, -702)`,
  ropeHigh: `freecam(380, 40, -600, 350, 16, -700)`,
  // standing on the quay beside the ship alongside (needs shipAtBerth): fenders, hull plating, bollards, lines
  quaySideA: `freecam(300, 7.5, -716, 280, 9, -698)`,
  quaySideB: `freecam(180, 6.5, -712, 230, 10, -698)`,
  quaySideC: `freecam(410, 9, -708, 360, 7, -698)`,
  atWingAft: `inBridge(-27.2, -2.3, 2.4, -0.3)`,
  atWingDown: `inBridge(-27.2, -2.3, 1.1, -0.9)`,
  atBridge: `inBridge(-0.4, -1.6, -0.9, -0.05)`,
  atOrbit: `orbit(-1.2, 0.2, 260)`,
  stsA: `freecam(-560, 30, -640, -600, 45, -720)`,
  stsB: `freecam(-640, 12, -655, -690, 40, -735)`,
  stsC: `freecam(-690, 60, -600, -690, 62, -740)`,
  gantryB: `freecam(-330, 40, -770, -250, 16, -930)`,
  gantryC: `freecam(-198, 9, -835, -230, 18, -905)`,
  treesA: `freecam(300, 14, -1700, 330, 14, -1795)`,
  treesB: `freecam(2560, 16, -300, 2640, 12, -420)`,
  // the first tug / the pilot boat / the first traffic ship, from 45 m / 30 m / 160 m away at a three-quarter angle
  tug: `freecam(__dbg.TUGS.list[0].x + 38, 14, __dbg.TUGS.list[0].z + 30, __dbg.TUGS.list[0].x, 4, __dbg.TUGS.list[0].z)`,
  tugHi: `freecam(__dbg.TUGS.list[0].x + 22, 7, __dbg.TUGS.list[0].z + 18, __dbg.TUGS.list[0].x, 4, __dbg.TUGS.list[0].z)`,
  trafficShip: `freecam(__dbg.TRAFFIC.ships[0].x + 150, 25, __dbg.TRAFFIC.ships[0].z + 120, __dbg.TRAFFIC.ships[0].x, 15, __dbg.TRAFFIC.ships[0].z)`,
  // traffic vessels by name, from a quarter angle at about three lengths
  // the pilot boat alongside the ship (set it there first: SHOT_JS="window.__side = pilotAlongside(); true")
  pilotA: `freecamShip(window.__side * 58, 14, 24, window.__side * 33.3, 10)`,
  ladderA: `freecamShip(window.__side * 48, 10, 22, window.__side * 29.3, 10)`,
  ladderB: `freecamShip(window.__side * 40, 24, 2, window.__side * 29.3, 12)`,
  pilotB: `freecamShip(window.__side * 44, 7, 4, window.__side * 33.3, 10)`,
  pilotTop: `freecamShip(window.__side * 36, 34, 18, window.__side * 33.3, 10)`,
  vesselRPA: `vessel('RPA 4', 3)`,
  // traffic vessels at long range (a night bridge view is mostly their lights): 1 / 2.5 / 5 km on the beam and fine on the bow
  hansa2k: `vessel('HANSA EXPRESS', 6.5)`,
  // the own ship's lights from ahead (dead ahead and a little to starboard) at 300 m / 2.5 km, and from astern and abeam (ship-local cameras)
  lightsAhead300: `freecamShip(0, 22, -520, 0, -190)`,
  lightsStbd300: `freecamShip(110, 24, -440, 0, -150)`,
  lightsAhead2k: `freecamShip(0, 24, -2700, 0, -190)`,
  lightsStbd2k: `freecamShip(300, 24, -2700, 0, -190)`,
  lightsAstern: `freecamShip(0, 24, 650, 0, 190)`,
  lightsBeam: `freecamShip(900, 24, -50, 0, -50)`,
  hansa4k: `vessel('HANSA EXPRESS', 13)`,
  vesselYacht: `vessel('BLUE WIND', 3)`,
  vesselZV: `vessel('UK-47 ZEEVAART', 2.4)`,
  portTop: `freecam(-500, 750, -300, -500, 0, -950)`,
  portTop2: `freecam(300, 500, -200, 300, 0, -800)`,
  groundMid: `freecam(-300, 14, -800, -300, 4.85, -900)`,
  asphaltClose: `freecam(300, 6.6, 900, 300, 4.85, 865)`,
  wallClose: `freecam(-700, 8, -560, -700, 3, -690)`,
  gate: `freecam(900, 14, -1500, 1100, 8, -1700)`,
  trees: `freecam(2500, 12, -500, 2640, 12, -900)`,
  citySkyline: `freecam(1800, 25, -200, 5000, 45, -3000)`,
  tanks: `freecam(-300, 20, 1000, -150, 20, 1700)`,
  tankFarm: `freecam(-700, 12, 1450, -860, 14, 1700)`,
  tankClose: `freecam(-900, 9, 1560, -950, 14, 1650)`,
  chimney: `freecam(450, 25, 1900, 650, 70, 2100)`,
  turbine: `freecam(-2100, 14, 560, -2110, 60, 731)`,
  turbineFar: `freecam(-2400, 12, 120, -2110, 60, 731)`,
  entrance: `freecam(-3700, 28, 30, -1500, 30, -200)`,
  breakwater: `freecam(-3100, 14, -300, -2500, 12, -560)`,
  breakClose: `freecam(-2830, 14, -330, -2650, 4, -430)`,
  breakTop: `freecam(-2300, 30, -560, -2600, 3, -520)`,
  harbour: `freecam(-1900, 24, 20, 200, 30, -650)`,
  coast: `freecam(-2200, 20, 900, -1200, 20, 2400)`,
  city: `freecam(1500, 60, -300, 6000, 60, -4200)`,
  alongside: `freecam(-780, 9, -520, -800, 22, -672)`,
  craneUp: `freecam(-690, 4, -655, -690, 60, -705)`,
  // look from above the bridge: compass azimuth, elevation (deg), vertical fov
  skySun: `lookAt(128, 12, 60)`,
  skyAway: `lookAt(290, 22, 68)`,
  skyUp: `lookAt(200, 55, 80)`,
  horizon: `lookAt(95, 1.5, 55)`,
  sunGlare: `lookAt(128, 9, 45)`,
  sunGold: `lookAt(258, 5, 55)`,
  // the camera turns at a steady rate while frames are stepped (use with SHOT_FREEZE=1 SHOT_SEQ="1,1": each entry steps 30 frames of the turn, then shoots): temporal effects (ghosting, smear)
  skyPan30: `lookPan(150, 22, 30)`,
  skyPan120: `lookPan(150, 22, 120)`,
  sunGoldHi: `lookAt(250, 14, 60)`,
  sunGoldEdge: `lookAt(212, 6, 60)`,
  moon: `lookAt(160, 26, 40)`,
  nightSky: `lookAt(250, 40, 80)`,
  nightSky2: `lookAt(60, 35, 80)`,
  // free camera 600 m abeam of the ship: (dx, dz from ship, height, azimuth, elevation, fov)
  seaSun: `lookFrom(0, 600, 12, 128, -3, 60)`,
  seaAway: `lookFrom(0, 600, 12, 300, -5, 60)`,
  seaSide: `lookFrom(0, 600, 30, 200, -9, 60)`,
  seaClose: `lookFrom(0, 600, 6, 250, -12, 60)`,
  // bow wave: bridge wings looking forward along the hull, external views at 300 / 600 m, close-ups (ship-local cameras: see freecamShip)
  wingFwdP: `freecamShip(-33.5, 47.5, -52, -31, -196)`,
  wingDownP: `freecamShip(-33.5, 47.5, -52, -44, -140)`,
  wingFwdS: `freecamShip(33.5, 47.5, -52, 31, -196)`,
  orbit300: `orbit(1.9, 0.22, 300)`,
  orbitFront600: `orbit(1.2, 0.2, 600)`,
  orbitSide300: `orbit(0.25, 0.12, 300)`,
  orbitHigh600: `orbit(1.0, 0.75, 600)`,
  bowFoam: `freecamShip(40, 24, -205, 10, -150)`,
  bowStem: `freecamShip(18, 9, -228, 4, -199)`,
  topBow: `freecamShip(0, 175, -140, 0, -152)`,
  topShip: `freecamShip(0, 520, -10, 0, -40)`,
  topObl: `freecamShip(45, 130, -110, 0, -180)`,
};
const HELPERS = `
  window.inBridge = (x, z, yaw, pitch) => { const P = __dbg.PLAYER; if (__dbg.G.mode !== 'bridge') P.toggleOrbit(); P.place(x, z, yaw); P.pitch = pitch; };
  window.orbit = (az, el, dist) => { const P = __dbg.PLAYER; if (__dbg.G.mode !== 'orbit') P.toggleOrbit(); P.orbit.az = az; P.orbit.el = el; P.orbit.dist = dist; };
  window.freecam = (x, y, z, tx, ty, tz) => { const P = __dbg.PLAYER; if (__dbg.G.mode !== 'orbit') P.toggleOrbit(); P.update = P.__upd || (P.__upd = P.update); const c = __dbg.camera; P.update = function () { c.position.set(x, y, z); c.lookAt(tx, ty, tz); }; };
  window.lookAt = (az, el, fov = 68, h = 48) => { const P = __dbg.PLAYER; if (__dbg.G.mode !== 'orbit') P.toggleOrbit(); P.update = P.__upd || (P.__upd = P.update); const c = __dbg.camera, s = __dbg.G.ship;
    P.update = function () { const a = az * Math.PI / 180, e = el * Math.PI / 180; c.position.set(s.x, h, s.z); c.lookAt(s.x + Math.sin(a) * Math.cos(e) * 1000, h + Math.sin(e) * 1000, s.z - Math.cos(a) * Math.cos(e) * 1000); if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); } }; };
  window.lookPan = (az0, el, rate, fov = 68, h = 48) => { const P = __dbg.PLAYER; if (__dbg.G.mode !== 'orbit') P.toggleOrbit(); P.update = P.__upd || (P.__upd = P.update); const c = __dbg.camera, s = __dbg.G.ship;
    P.update = function () { const a = (az0 + rate * __dbg.G.realT) * Math.PI / 180, e = el * Math.PI / 180; c.position.set(s.x, h, s.z); c.lookAt(s.x + Math.sin(a) * Math.cos(e) * 1000, h + Math.sin(e) * 1000, s.z - Math.cos(a) * Math.cos(e) * 1000); if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); } }; };
  window.lookFrom = (dx, dz, h, az, el, fov = 68) => { const P = __dbg.PLAYER; if (__dbg.G.mode !== 'orbit') P.toggleOrbit(); P.update = P.__upd || (P.__upd = P.update); const c = __dbg.camera, s = __dbg.G.ship;
    P.update = function () { const a = az * Math.PI / 180, e = el * Math.PI / 180, x = s.x + dx, z = s.z + dz; c.position.set(x, h, z); c.lookAt(x + Math.sin(a) * Math.cos(e) * 1000, h + Math.sin(e) * 1000, z - Math.cos(a) * Math.cos(e) * 1000); if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); } }; };
  // camera in the own ship's frame: (right, up, aft-of-stem... given as ship-local x starboard, y up, z; target x, z) -- z negative = forward of amidships
  window.freecamShip = (cx, cy, cz, tx, tz) => { const P = __dbg.PLAYER; if (__dbg.G.mode !== 'orbit') P.toggleOrbit(); P.update = P.__upd || (P.__upd = P.update); const c = __dbg.camera, g = __dbg.G.shipGroup;
    P.update = function () { g.updateMatrixWorld(); const a = new (c.position.constructor)(cx, cy, cz).applyMatrix4(g.matrixWorld), b = new (c.position.constructor)(tx, 1, tz).applyMatrix4(g.matrixWorld); c.position.copy(a); c.lookAt(b); if (c.fov !== 55) { c.fov = 55; c.updateProjectionMatrix(); } }; };
  window.freecamPatrol = (d, h, ang) => { const P = __dbg.PLAYER; if (__dbg.G.mode !== 'orbit') P.toggleOrbit(); P.update = P.__upd || (P.__upd = P.update); const c = __dbg.camera;
    P.update = function () { const o = window.__pb; const a = o.psi + ang * Math.PI / 180 + Math.PI; c.position.set(o.x + Math.sin(a) * d, h, o.z - Math.cos(a) * d); c.lookAt(o.x + Math.sin(o.psi) * 5, 1, o.z - Math.cos(o.psi) * 5); if (c.fov !== 50) { c.fov = 50; c.updateProjectionMatrix(); } }; };
  // the own ship alongside Berth 4, port side to the quay (as scored: stopped, in the middle of the berth)
  window.shipAtBerth = () => { const s = __dbg.G.ship; s.x = 300; s.z = -668.5; s.psi = Math.PI / 2; s.u = s.v = s.r = 0; s.rpm = [0, 0]; __dbg.frame(6, 1 / 30); return true; };
  // as shipAtBerth, with all lines out (the scenario's makeFast for both stations)
  window.shipMoored = () => { window.shipAtBerth(); const b = __dbg.berthInfo(); __dbg.SCN.makeFast('fwd', b.side); __dbg.SCN.makeFast('aft', b.side); __dbg.frame(3, 1 / 30); return true; };
  window.pilotAlongside = () => { const s = __dbg.G.ship, P = __dbg.PILOTBOAT, side = __dbg.G.flags.leeSide === 'STBD' ? 1 : -1; const [x, z] = s.toWorld(-10, side * 33.3); P.x = x; P.z = z; P.psi = s.psi; P.state = 'alongside'; P.alongT = 0; P.grp.position.set(x, 0.2, z); P.grp.rotation.set(0, -s.psi, 0); P.grp.updateMatrixWorld(true); return side; };
  window.vessel = (name, k) => { const o = __dbg.TRAFFIC.ships.find((t) => t.name === name); window.freecam(o.x + o.L * k * 0.7, Math.max(6, o.L * 0.5), o.z + o.L * k * 0.7, o.x, 3, o.z); const P = __dbg.PLAYER, c = __dbg.camera; P.update = function () { c.position.set(o.x + o.L * k * 0.7, Math.max(6, o.L * 0.5), o.z + o.L * k * 0.7); c.lookAt(o.x, 3, o.z); }; };
  window.restoreCam = () => { const P = __dbg.PLAYER; if (P.__upd) { P.update = P.__upd; } __dbg.camera.fov = 68; __dbg.camera.updateProjectionMatrix(); };
  true;`;

const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(root, u === '/' ? 'index.html' : u);
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : p.endsWith('.js') || p.endsWith('.mjs') ? 'text/javascript' : p.endsWith('.png') ? 'image/png' : 'application/octet-stream' });
    res.end(d);
  });
}).listen(0);
const port = srv.address().port;
const dport = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync('/tmp/shot-');
const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`,
  '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
  'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r?.exceptionDetails) console.error('eval error:', r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r?.result?.value; };
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${dport}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const CONSOLE = !!process.env.SHOT_CONSOLE;
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
    if (!CONSOLE) return;
    if (d.method === 'Runtime.consoleAPICalled') console.log('CONSOLE', d.params.type, d.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    if (d.method === 'Runtime.exceptionThrown') console.log('CONSOLE exception', d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Log.entryAdded') console.log('CONSOLE log', d.params.entry.level, d.params.entry.text);
  };
  await send('Page.enable');
  if (CONSOLE) { await send('Runtime.enable'); await send('Log.enable'); }
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: +(process.env.SHOT_DPR || 1), mobile: false });
  await send('Page.navigate', { url: `${process.env.SHOT_URL || `http://127.0.0.1:${port}/`}?autostart&voice=off${process.env.SHOT_DYN ? '' : '&dynres=off'}${query ? '&' + query : ''}` });
  await sleep(+waitSec * 1000);
  await ev(HELPERS);
  if (process.env.SHOT_JS) { const r = await ev(process.env.SHOT_JS); if (r !== undefined && r !== true) console.log('SHOT_JS ->', JSON.stringify(r)); }
  // SHOT_FREEZE=1: deterministic frames for A/B pixel comparisons – the game's own frame loop is stopped, time is pinned,
  // and every preset is rendered by hand (8 frames of dt = 0, enough for per-frame systems such as the culling to settle)
  if (process.env.SHOT_FREEZE) await ev('window.requestAnimationFrame = () => 0; __dbg.G.paused = true; __dbg.G.realT = 123; true');
  for (const name of presetArg.split(',')) {
    const js = PRESETS[name];
    if (!js) { console.error('unknown preset', name); continue; }
    await ev(`restoreCam && restoreCam(); ${js}; true`);
    if (process.env.SHOT_FREEZE) { await ev('__dbg.frame(8, 0); true'); await sleep(300); } else await sleep(1800);
    if (process.env.SHOT_AFTER) console.log('SHOT_AFTER', name, JSON.stringify(await ev(process.env.SHOT_AFTER)));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(outDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    // SHOT_TOGGLE="...": evaluated after the first shot, then the same view is shot again as <name>_b.png (same page, same frozen frame:
    // an exact A/B of one switch; use with SHOT_FREEZE=1)
    if (process.env.SHOT_TOGGLE) {
      await ev(process.env.SHOT_TOGGLE);
      if (process.env.SHOT_FREEZE) { await ev('__dbg.frame(8, 0); true'); await sleep(300); } else await sleep(1200);
      const shb = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(outDir, `${name}_b.png`), Buffer.from(shb.data, 'base64'));
      await ev(process.env.SHOT_TOGGLE_BACK || 'true');
    }
    if (process.env.SHOT_SEQ) for (const [k, dt] of process.env.SHOT_SEQ.split(',').entries()) {
      await ev(`__dbg.frame(${Math.max(1, Math.round(+dt * 30))}, 1 / 30); true`);
      const sh2 = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(outDir, `${name}_t${k + 1}.png`), Buffer.from(sh2.data, 'base64'));
    }
    let extra = '';
    if (process.env.SHOT_PERF) {
      // CPU+GPU time of a whole frame: render 40 frames back to back, gl.finish() after each so the GPU work is included
      const ms = await ev(`(() => { const gl = __dbg.renderer.getContext(); const px = new Uint8Array(4); const f = () => { __dbg.frame(1, 1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }; for (let i = 0; i < 8; i++) f(); const t0 = performance.now(); for (let i = 0; i < 40; i++) f(); return (performance.now() - t0) / 40; })()`);
      extra = `  ${ms.toFixed(1)} ms/frame (frame + readPixels sync)`;
    }
    console.log('wrote', file + extra);
  }
} finally { ch.kill(); srv.close(); await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5 }); } catch {} process.exit(0); }
