// ============================================================================
// 99 — MAIN: bootstrap, own ship, control laws, frame loop
// ============================================================================
const OWN = {
  L: 399.2, B: 58.6, T: 14.5, D: 15.7, fc: 2.8, rake: 6, hull: '#3fa7d3', boot: '#9a2a24', bootLine: '#f2f2ee', bootTop: 1.3,
  name: 'MAJESTIC MAERSK', port: 'KØBENHAVN', hullText: 'MAERSK', hullTextH: 11, hullTextS: 0.44, hullTextY: 7.2,
  deckhouse: 0.625, funnel: 0.18, tiers: 10, eyeY: 47.5, bridgeFloor: BRIDGE_Y, dhW: 32, style: 'maersk', detail: 2, seed: 7,
  thrusterMark: true, flag: true, ownBridge: true, funnelW: 16, funnelTop: 52,
};

function setupOwnShip() {
  const s = new ShipPhysics();
  G.ship = s;
  s.x = -15600; s.z = 105; s.psi = 90 * DEG; s.u = 16 * KN;
  s.rpm = [56, 56]; s.tele = [9, 9]; s.engineMode = 'SEA';
  const W = { light: [6, 200], moderate: [14, 225], fresh: [24, 240] }[CFG.wind];
  s.windSpeed = W[0] * KN; s.windFrom = W[1] * DEG;
  s.curSetTo = 32 * DEG; s.curSpeed = 0.45 * KN;
  G.apHeading = 90; G.steering = 'AUTO';
  G.bellBook.push({ t: 0, txt: 'NAV FULL — sea passage (from noon log)' });
  const g = buildContainerShip(OWN);
  g.rotation.order = 'YXZ';
  scene.add(g);
  G.shipGroup = g;
  g.userData.ladders = buildPilotLadders(g, OWN);          // pilot ladders, one per side (shown while rigged, see updateShipVisual)
  // wakes & foam
  G.wake = new Wake({ width: 24, every: 1.5, life: 330, spread: 0.3, max: 170 });
  G.foam = {
    prop: foamPatch(g, 54, 80, 0, 238, 0, true), btP: foamPatch(g, 24, 30, -38, -172), btS: foamPatch(g, 24, 30, 38, -172),
  };
  G.exhaust = new ExhaustPlume(110);
  // deck floodlights (console button): four lamps on the front of the accommodation block shining forward over the stacks, two more aft
  if (ENV.night) {
    const fz = g.userData.bridgeZ - 12;                                                  // front face of the accommodation block
    for (const x of [-22, -9, 9, 22]) LAMPS.add(x, 36, fz, { follow: g, local: [x, 36, fz], ldir: [-x * 0.006, -0.42, -0.9], col: [0.95, 0.92, 0.85], power: 15, range: 190, cone: 0.78, on: () => G.deckLights });
    for (const z of [g.userData.funnelZ + 14, g.userData.funnelZ + 60]) LAMPS.add(0, 30, z, { follow: g, local: [0, 30, z], ldir: [0, -0.5, 0.86], col: [0.95, 0.92, 0.85], power: 10, range: 120, cone: 0.7, on: () => G.deckLights });
    for (const [sd, nm] of [[1, 'STBD'], [-1, 'PORT']]) LAMPS.add(sd * (OWN.B / 2 + 1), OWN.D + 3, 10, { follow: g, local: [sd * (OWN.B / 2 + 1.2), OWN.D + 3, 10], ldir: [sd * 0.55, -0.82, 0], col: [1, 0.95, 0.82], power: 5, range: 45, cone: 0.45, on: () => ladderOut(nm) });      // the light on the pilot ladder
  }
  G.track = [];
}

// the pilot ladder hangs over the lee side from the moment it is rigged until the pilot is on the bridge
const ladderOut = (side) => !!(G.flags.ladder && !G.flags.pilotOnBridge && G.flags.leeSide === side);

function controlStep(h) {
  const s = G.ship;
  if (G.steering === 'AUTO') {
    const err = wrap180(G.apHeading - s.psi / DEG);
    s.rudderCmd = clamp(err * 2.6 - s.rotDegMin * 2.2, -G.apRudderLimit, G.apRudderLimit);
  } else if (G.steering === 'HAND') s.rudderCmd = G.helmOrder;
  else if (G.steering === 'NFU') s.rudderCmd = clamp(s.rudderCmd + (G.nfuDir || 0) * SHIPSPEC.rudderRate * h * 1.2, -35, 35);
  // tidal stream: weaker in the dredged channel, slack inside the harbour
  s.curSpeed = (s.x > -2700 ? 0.04 : s.x > -6000 ? 0.3 : 0.45) * KN;
}

const PHYS_ENV = {
  depthAt: (x, z) => depthAt(x, z),
  contact: (px, pz, vx, vz) => worldContact(px, pz, vx, vz),
  onContact: (c) => SCN.onContact(c),
};

const _exv = new THREE.Vector3(), _exw = new THREE.Vector3();
function updateShipVisual(dt) {
  const s = G.ship, g = G.shipGroup;
  const swell = seaState().swell;
  const t = G.realT;
  const sea = swell * (s.x > -2600 ? 0.35 : 1);
  // ride the actual swell: heave = mean height along the hull, pitch = fitted slope, roll from the
  // slope across the beam plus the ship's own slow roll (much reduced inside the breakwaters)
  let hsum = 0, hx = 0, xx = 0;
  for (let xb = -180; xb <= 180; xb += 45) { const [wx, wz] = s.toWorld(xb, 0), h = SWELL.height(wx, wz); hsum += h; hx += h * xb; xx += xb * xb; }
  const heave = hsum / 9, [px, pz] = s.toWorld(-60, -27), [sx2, sz2] = s.toWorld(-60, 27);
  const beam = (SWELL.height(sx2, sz2) - SWELL.height(px, pz)) / 54;
  // own roll near her natural period, building and dying away between sets of bigger waves
  const rollAmp = seaState().roll * DEG * (s.x > -2600 ? 0.3 : 1) * (0.7 + 0.3 * Math.sin(t * 2 * Math.PI / 95));
  const roll = clamp(s.u * s.r * 1.1, -0.045, 0.045) + (Math.sin(t * 2 * Math.PI / 14) * 0.8 + Math.sin(t * 2 * Math.PI / 21 + 2) * 0.3) * rollAmp + Math.atan(beam) * 0.5;
  const pitch = Math.atan(hx / xx) * 1.2 + Math.sin(t * 2 * Math.PI / 9.2 + 1) * 0.0005 * sea;
  g.position.set(s.x, -s.squat * 0.6 + heave * 0.85, s.z);
  g.rotation.set(pitch, -s.psi, roll, 'YXZ');
  if (g.userData.flag) g.userData.flag.rotation.y = Math.PI / 2 + Math.sin(t * 3) * 0.2;
  { const L = g.userData.ladders; if (L) { L.STBD.visible = ladderOut('STBD'); L.PORT.visible = ladderOut('PORT'); } }
  // funnel smoke: puffs stay behind in the air, so the ship leaves a drifting trail
  if (!G.paused || G.exhaust.age.some((a) => a >= 0)) {
    const ex = G.exhaust, fz = g.userData.funnelZ, load = clamp(((Math.abs(s.rpm[0]) + Math.abs(s.rpm[1])) / 2) / 66, 0, 1.2);
    _exv.set(0, OWN.funnelTop + 3, fz + 0.5); g.localToWorld(_exv);
    const wTo = s.windFrom + Math.PI, wv = s.windSpeed * 0.8;
    _exw.set(Math.sin(wTo) * wv, 0, -Math.cos(wTo) * wv);
    ex.update(G.paused ? 0 : dt * G.timeScale, _exv, _exw, load < 0.05 ? 0 : 1.6 + load * 2.4, 0.1 + load * 0.2);
  }
  // wake & foam
  const [sx, sz] = s.toWorld(-201, 0);
  const rpm = (Math.abs(s.rpm[0]) + Math.abs(s.rpm[1])) / 2;
  G.wake.update(G.paused ? 0 : dt * G.timeScale, sx, sz, -Math.sin(s.psi), Math.cos(s.psi), clamp(s.sog / 6 + rpm / 90, 0, 1), s.sog);
  const kn = s.sog / KN, F = G.foam;
  F.prop.setIntensity(clamp(rpm / 45, 0, 1) * clamp(1.4 - kn / 10, 0.3, 1));
  F.prop.position.z = s.rpm[0] < 0 ? 160 : 238;
  const bt = s.bowThr[0] + s.bowThr[1];
  F.btP.setIntensity(clamp(bt / 1.2, 0, 0.9)); F.btS.setIntensity(clamp(-bt / 1.2, 0, 0.9));
}

function updateEnvFrame(rdt = 1 / 60) {
  const cp = new THREE.Vector3(); camera.getWorldPosition(cp);
  const sdt = G.paused ? 0 : rdt * G.timeScale;
  SHIPW.update(cp, G.realT, sdt); FOAMSIM.update(sdt); BOWMESH.update(cp);
  ENV.water.position.set(Math.round(cp.x / 4) * 4, 0, Math.round(cp.z / 4) * 4);
  ENV.waterMat.uniforms.uTime.value = G.realT;
  ENV.dome.material.uniforms.uTime.value = G.realT + ENV.cloudT0;
  if (Wake._mat) Wake._mat.uniforms.uTime.value = G.realT;
  const U = ENV.waterMat.uniforms;
  const SS = seaState(); U.uSea.value = SS.sea; U.uCaps.value = SS.caps;
  const wTo = G.ship.windFrom + Math.PI; // waves run downwind
  U.uWindAng.value = Math.atan2(-Math.cos(wTo), Math.sin(wTo));
  if (!SWELL.waves.length) SWELL.init(U.uWindAng.value);
  SWELL.setAmp(SS.waveA, SS.chop); SWELL.cam.copy(cp);
  // inside the breakwaters the sea is sheltered
  const shelter = G.ship.x > -2600 ? 0.45 : 1; U.uSea.value *= shelter; U.uCaps.value *= shelter;
  ATMOS.U.uGlassDirt.value += ((G.wipers ? 0.03 : 0.2) - ATMOS.U.uGlassDirt.value) * Math.min(1, (G.wipers ? 1.8 : 0.12) / 60);   // wipers clear the salt, it creeps back
  // direct light follows the clouds: the sun is dimmed (never to zero: skylight remains) when a cloud is in front of it
  ENV.sunAcc += rdt;
  if (ENV.sunAcc > 0.25) { ENV.sunAcc = 0; ENV.sunTarget = CLOUDS.sunTransmittance(G.ship.x, 40, G.ship.z, ENV.sunDir, G.realT + ENV.cloudT0); }
  ENV.sunT += (ENV.sunTarget - ENV.sunT) * (1 - Math.exp(-rdt / 2.5));
  ENV.sunLevel = 0.16 + 0.84 * smooth(0.03, 0.6, ENV.sunT);
  ENV.sun.intensity = ENV.P.sun * ENV.sunLevel;
  U.uCloudT.value = G.realT + ENV.cloudT0;
  fitSunShadow();
  if (G.exhaust) G.exhaust.light();
  G.shipGroup.updateMatrixWorld(); LAMPS.update(cp, rdt); LOD.update(cp); SHSHADOW.update(cp); FARSHADOW.update(cp); NAVLIGHTS.update(cp);
}

// The shadow map is one orthographic box that follows what is being looked at: the bridge and the stacks
// ahead of it from inside, the whole ship from outside. Snapped to the texel grid so shadows do not crawl.
const _sf = { c: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), rad: 0 };
function fitSunShadow() {
  const sun = ENV.sun, sc = sun.shadow.camera, sd = ENV.sunDir;
  const c = _sf.c;
  let rad;
  if (G.mode === 'orbit') { c.set(G.ship.x, 22, G.ship.z); rad = clamp(PLAYER.orbit.dist * 0.7, 70, 235); }
  else { G.bridgeGroup.getWorldPosition(c); rad = 72; }
  const size = sun.shadow.mapSize.x, texel = 2 * rad / size;
  _sf.r.crossVectors(_sf.up, sd).normalize(); _sf.u.crossVectors(sd, _sf.r);
  const x = c.dot(_sf.r), y = c.dot(_sf.u);
  c.addScaledVector(_sf.r, Math.round(x / texel) * texel - x).addScaledVector(_sf.u, Math.round(y / texel) * texel - y);
  sun.target.position.copy(c);
  sun.position.copy(c).addScaledVector(sd, 500);
  if (Math.abs(rad - _sf.rad) > 0.5) {
    _sf.rad = rad;
    sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.near = 500 - rad - 140; sc.far = 500 + rad + 60;
    sc.updateProjectionMatrix();
    // bias in metres (a low sun meets flat surfaces at a grazing angle: the error is about texel × tan(angle) ≈ 4 texels)
    sun.shadow.bias = -Math.max(0.14, texel * 5) / (sc.far - sc.near); sun.shadow.normalBias = Math.max(0.05, texel * 2.2);
  }
}

let _frame = 0;
function simTick(sdt) {
  G.simT += sdt;
  const n = Math.max(1, Math.ceil(sdt / 0.05)), h = sdt / n;
  for (let i = 0; i < n; i++) { controlStep(h); G.ship.step(h, PHYS_ENV); }
  SCN.update(sdt); TRAFFIC.update(sdt); TUGS.update(sdt); PILOTBOAT.update(sdt);
  updateWorld(sdt, G.simT); ALARMS.update(sdt);
  G.trackT = (G.trackT || 0) + sdt;
  if (G.trackT > 20) { G.trackT = 0; G.track.push([G.ship.x, G.ship.z]); if (G.track.length > 400) G.track.shift(); }
}
function loop() {
  requestAnimationFrame(loop);
  frame(Math.min(clock.getDelta(), 0.1));
}
function frame(rdt) {
  G.realT += rdt; _frame++;
  if (!G.paused) simTick(rdt * G.timeScale);
  CREW.update(G.paused ? 0 : rdt);
  PLAYER.update(rdt);
  updateShipVisual(rdt);
  updateBridgeControls(rdt, G.simT);
  updateDisplays(G.paused ? 0 : rdt);
  updateWasBAS();
  AUDIO.update(rdt);
  UI.update(rdt);
  SAVE.update(rdt);
  updateEnvFrame(rdt);
  renderReflection();
  POST.render();
}

// quay-side berthing aid displays (laser distance boards)
function updateWasBAS() {
  if (_frame % 10) return;
  const bi = berthInfo(), s = G.ship;
  for (const b of WORLD.bas) {
    const x = b.ctx; x.fillStyle = '#050505'; x.fillRect(0, 0, 512, 256);
    let d = null, v = null;
    if (bi && bi.q.id === 'N' && bi.dc < 400) {
      // distance measured at this laser's position along the quay
      const xb = (b.x - s.x) * Math.sin(s.psi);
      const e = xb > 0 ? bi.bow : bi.stern; d = e.d; v = e.vIn;
    }
    x.font = `800 110px ${MONO}`; x.textAlign = 'center'; x.fillStyle = d === null ? '#333' : v > 0.15 ? '#ff3b2b' : '#ffcc00';
    x.fillText(d === null ? '---.-' : d.toFixed(1), 256, 120);
    x.font = `800 70px ${MONO}`; x.fillStyle = d === null ? '#333' : v > 0.15 ? '#ff3b2b' : '#30ff60';
    x.fillText(v === null ? '--' : (v * 100).toFixed(0) + ' cm/s', 256, 215);
    x.font = `700 26px ${SANS}`; x.fillStyle = '#777'; x.textAlign = 'left'; x.fillText(b.lab + ' m', 14, 30);
    b.tex.needsUpdate = true;
  }
}

async function startGame() {
  $('start').classList.add('hidden');
  $('loading').classList.remove('hidden');
  const progress = (p, msg) => { $('loadBar').style.width = (p * 100).toFixed(0) + '%'; $('loadMsg').textContent = msg; return new Promise((r) => setTimeout(r, 20)); };
  try {
    await progress(0.02, 'Starting the renderer');
    initRenderer();
    AUDIO.init();
    NEURAL.load();                       // fetch the voice model while the world builds
    await progress(0.05, 'Painting the sky');
    buildEnvironment();
    await buildWorld(progress);
    await progress(0.93, 'Loading 18 270 TEU');
    setupOwnShip();
    await progress(0.96, 'Loading the ENC charts');
    initDisplays();
    buildBridge(G.shipGroup);
    await progress(0.97, 'Mustering the crew');
    await HEADS.load();
    CREW.init(); TRAFFIC.init(); PILOTBOAT.init(); TUGS.init();
    PLAYER.init(); SCN.init(); LOD.init(); FARSHADOW.init();
    if (SAVE.pending) { await progress(0.99, 'Restoring your watch'); SAVE.apply(SAVE.pending); SAVE.pending = null; }
    await progress(1, 'Taking over the watch');
    POST.warm();
  } catch (e) {
    console.error(e);
    $('loadMsg').innerHTML = '<span style="color:#ff6b5f">Failed to start: ' + (e && e.message) + '</span>';
    return;
  }
  $('loading').classList.add('hidden');
  UI.showHUD(); UI.lockChanged(PLAYER.locked);
  G.started = true; G.paused = false;
  clock.getDelta();
  loop();
}

UI.init();
SAVE.init();
window.__dbg = { POST, ATMOS, CLOUDS, LAMPS, LOD, SHSHADOW, FARSHADOW, NAVLIGHTS, SHIPW, FOAMSIM, BOWMESH, GPUPROF, get ENV() { return ENV; }, G, PLAYER, SCN, CREW, SPEECH, NEURAL, AUDIO, HEADS, SPOTS, SAVE, TUGS, TRAFFIC, PILOTBOAT, BR, get camera() { return camera; }, get scene() { return scene; }, get renderer() { return renderer; }, teleStep, setSteering, requestEngineMode, startThrusters, berthInfo,
  frame(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) frame(dt); },
  run(sec, dt = 0.25) { for (let t = 0; t < sec; t += dt) { simTick(dt); CREW.update(dt); } return { simT: G.simT, x: G.ship.x, z: G.ship.z, sog: G.ship.sog / KN, step: SCN.cur }; } };
if (/autostart/.test(location.search)) { const q = new URLSearchParams(location.search); for (const k of Object.keys(CFG)) if (q.get(k)) CFG[k] = q.get(k); startGame(); }
