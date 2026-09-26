// ============================================================================
// 12 — PLAYER: walking on the bridge, looking, interacting, cameras
// ============================================================================
const PLAYER = {
  x: -0.4, z: -1.6, yaw: 0, pitch: -0.08, eye: 1.74, keys: {}, locked: false, drag: null,
  binos: false, binoHold: false, fov: 68, bob: 0,
  orbit: { az: 2.3, el: 0.32, dist: 620 },
  hover: null, ray: new THREE.Raycaster(), mouse: new THREE.Vector2(0, 0), lockFailed: false,
  // mouse-look settings (kept per browser) and pending look input, applied once per frame
  opts: { sens: 1, invert: false, smooth: true }, lookX: 0, lookY: 0, wantLock: false, skipMoves: 0,
  loadOpts() { try { Object.assign(this.opts, JSON.parse(localStorage.getItem('tripleE.mouse') || '{}')); } catch (e) { /* defaults */ } },
  saveOpts() { try { localStorage.setItem('tripleE.mouse', JSON.stringify(this.opts)); } catch (e) { /* not persisted */ } },
  // the mouse is captured on the game container, so it can already be taken on the click that starts the game
  get lockEl() { return $('app'); },
  init() {
    this.loadOpts();
    this.rig = new THREE.Object3D(); G.bridgeGroup.add(this.rig);
    this.rig.add(camera); camera.position.set(0, this.eye, 0); camera.rotation.set(0, 0, 0);
    this.place(-0.4, -1.6, 0);
    const el = this.lockEl;
    this.locked = document.pointerLockElement === el; if (this.locked) this.wantLock = true;
    el.addEventListener('mousedown', (e) => this.onDown(e));
    addEventListener('mouseup', (e) => this.onUp(e));
    addEventListener('mousemove', (e) => this.onMove(e));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === el; UI.lockChanged(this.locked);
      if (this.locked) { this.wantLock = true; this.refusals = 0; this.skipMoves = 2; this.lookX = this.lookY = 0; }   // first deltas after locking are junk
      const ours = this._releasing; this._releasing = false;
      if (this.locked || !was || ours || !G.started) return;
      // the browser took the mouse back (Esc, or switching windows): Esc closes a display, otherwise pause
      if (UI.zoomOpen()) UI.closeZoom();
      else if (!UI.modalOpen() && !UI.panelOpen()) UI.togglePause(true);
    });
    // repeated refusals (e.g. embedded without pointer-lock permission) fall back to drag-to-look;
    // a single refusal is usually Chrome's short cool-down after Esc and is simply retried later
    document.addEventListener('pointerlockerror', () => this.lockRefused());
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => { this.keys = {}; if (G.whistle) setWhistle(false); });
  },
  place(x, z, yaw) { this.leaveSeat(); this.x = x; this.z = z; this.yaw = yaw; this.pitch = -0.06; this.moveT = 1; },
  // ---- sitting: click a chair (or F at it); any walking key gets up again
  seat: null, eyeY: 1.74, moveT: 1,
  seatPos(s) { const a = s.chair ? this.yaw : s.yaw; return [s.x + Math.sin(a) * 0.08, s.z + Math.cos(a) * 0.08]; },   // a little back on the cushion
  sit(s, instant) {
    if (this.seat === s) { this.standUp(); return; }
    if (s.by && s.by !== 'player') { const c = CREW.info[s.by]; UI.toast((c ? c.short : 'Someone') + ' is sitting there', 'info'); return; }
    this.leaveSeat();
    this.seat = s; s.by = 'player'; s.hit.visible = false;
    this.vx = this.vz = 0;
    this.moveFrom = [this.x, this.z]; this.moveT = instant ? 1 : 0;
    [this.x, this.z] = this.seatPos(s);
    if (!s.chair) this.turnTo = s.yaw;              // fixed chairs: turn to face the table
    if (instant) { this.eyeY = s.h + 0.8; if (!s.chair) this.yaw = s.yaw; this.turnTo = null; }
  },
  leaveSeat() {
    const s = this.seat; if (!s) return;
    if (s.by === 'player') s.by = null;
    s.hit.visible = true; this.seat = null; this.turnTo = null;
  },
  // get up and step out beside or behind the chair, wherever there is room
  standUp() {
    const s = this.seat; if (!s) return;
    this.leaveSeat();
    const a = s.chair ? this.yaw : s.yaw, from = [this.x, this.z];
    for (const [da, r] of [[Math.PI, 0.75], [Math.PI / 2, 0.7], [-Math.PI / 2, 0.7], [Math.PI * 0.75, 0.8], [-Math.PI * 0.75, 0.8], [0, 0.7], [Math.PI, 1.1], [Math.PI / 2, 1.1], [-Math.PI / 2, 1.1]]) {
      const nx = s.x - Math.sin(a + da) * r, nz = s.z - Math.cos(a + da) * r;
      if (this.canStand(nx, nz)) { this.x = nx; this.z = nz; break; }
    }
    this.moveFrom = from; this.moveT = 0;
  },
  canStand(x, z, r = 0.28) {
    if (!BR.inside(x, z)) return false;
    for (const c of BR.colliders) if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return false;
    for (const m of CREW.members) if (m.present && Math.hypot(x - m.group.position.x, z - m.group.position.z) < 0.55) return false;
    return true;
  },
  inBridge() { return G.mode === 'bridge'; },
  pos() { return { x: this.x, z: this.z }; },
  // Raw (unaccelerated) mouse input where the browser supports it, plain pointer lock otherwise.
  requestLock(force) {
    if (this.lockFailed || this.locked || (!force && UI.modalOpen())) return;
    const el = this.lockEl;
    if (!el.requestPointerLock) { this.lockFailed = true; UI.lockChanged(false); return; }
    const plain = () => { try { const q = el.requestPointerLock(); if (q && q.catch) q.catch(() => this.lockRefused()); } catch (e) { this.lockRefused(); } };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch((err) => { if (err && err.name === 'NotSupportedError') plain(); else this.lockRefused(); });
    } catch (e) { plain(); }
  },
  lockRefused() { this.refusals = (this.refusals || 0) + 1; if (this.refusals >= 6) { this.lockFailed = true; UI.lockChanged(false); } },
  // after a menu closes, take the mouse back if the player was using mouse-look before
  release() { if (document.pointerLockElement) { this._releasing = true; document.exitPointerLock(); } },
  recapture() { if (this.wantLock && !this.locked && !this.lockFailed && !UI.modalOpen() && !UI.panelOpen()) this.requestLock(); },
  onDown(e) {
    AUDIO.resume(); G.bnwasT = 0;
    // with the mouse captured, a click on a full-screen display simply closes it again
    if (UI.zoomOpen() && (this.locked || this.lockEl.contains(e.target))) { UI.closeZoom(); return; }
    if (UI.modalOpen()) return;
    if (e.button === 2) { this.binoHold = true; return; }
    // a click that captures the mouse only captures – it never presses whatever is under the free cursor
    if (!this.locked && !this.lockFailed) { this.requestLock(); return; }
    if (G.mode === 'orbit') { if (!this.locked) this.drag = { x: e.clientX, y: e.clientY, moved: 0 }; return; }
    this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
    // press-and-hold controls (whistle, tiller)
    const hit = this.pick(e);
    if (hit && hit.object.userData.ia && hit.object.userData.ia.down) { hit.object.userData.ia.down(hit); this.holding = hit.object.userData.ia; }
  },
  onUp(e) {
    if (e.button === 2) { this.binoHold = false; return; }
    if (this.holding) { this.holding.up && this.holding.up(); this.holding = null; this.drag = null; return; }
    if (!this.drag) return;
    const moved = this.drag.moved; this.drag = null;
    if (G.mode === 'orbit' || moved > 6) return;
    const hit = this.pick(e);
    if (hit) { const ia = hit.object.userData.ia; if (ia.click) ia.click(hit, e.button); }
  },
  onMove(e) {
    if (this.locked) {
      if (this.skipMoves > 0) { this.skipMoves--; return; }
      // Chrome occasionally reports a huge bogus jump right after focus/lock changes – drop it
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      if (G.mode === 'orbit') { this.orbit.az -= e.movementX * 0.004 * this.opts.sens; this.orbit.el = clamp(this.orbit.el + e.movementY * 0.003 * this.opts.sens * (this.opts.invert ? -1 : 1), 0.02, 1.45); }
      else if (!UI.zoomOpen()) { this.lookX += e.movementX; this.lookY += e.movementY; }
      return;
    }
    this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (this.drag) {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy); this.drag.x = e.clientX; this.drag.y = e.clientY;
      if (G.mode === 'orbit') { this.orbit.az -= dx * 0.005; this.orbit.el = clamp(this.orbit.el + dy * 0.004, 0.02, 1.45); }
      else if (!this.holding) { this.lookX += dx * 1.2; this.lookY += dy * 1.2; }
    }
  },
  look(dx, dy) {
    const k = 0.0022 * this.opts.sens * (this.fov / 68);      // slower through the binoculars
    this.yaw -= dx * k; this.pitch = clamp(this.pitch - dy * k * (this.opts.invert ? -1 : 1), -1.45, 1.35);
  },
  // apply the mouse movement gathered since the last frame; optional light smoothing (~25 ms)
  applyLook(dt) {
    if (!this.lookX && !this.lookY) return;
    const a = this.opts.smooth ? 1 - Math.exp(-dt / 0.025) : 1;
    let dx = this.lookX * a, dy = this.lookY * a;
    if (Math.abs(this.lookX - dx) < 0.05 && Math.abs(this.lookY - dy) < 0.05) { dx = this.lookX; dy = this.lookY; }
    this.lookX -= dx; this.lookY -= dy;
    this.look(dx, dy);
  },
  onWheel(e) {
    e.preventDefault();
    if (UI.zoomOpen()) { UI.zoomRange(Math.sign(e.deltaY)); return; }
    if (G.mode === 'orbit') { this.orbit.dist = clamp(this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.1), 90, 4000); return; }
    const hit = this.pick(this.locked ? null : e);
    if (hit && hit.object.userData.ia && hit.object.userData.ia.wheel) { hit.object.userData.ia.wheel(Math.sign(e.deltaY)); G.bnwasT = 0; }
  },
  // Space / F: bring the display under the crosshair full screen (mouse stays captured)
  zoomAtCrosshair() {
    if (UI.zoomOpen()) { UI.closeZoom(); return true; }
    const h = this.pick(this.locked ? null : this.mouseEvent());
    if (h && h.object.userData.ia.zoom) { UI.zoomDisplay(h.object.userData.ia.zoom); return true; }
    return false;
  },
  mouseEvent() { return { clientX: (this.mouse.x + 1) / 2 * innerWidth, clientY: (1 - this.mouse.y) / 2 * innerHeight }; },
  pick(e) {
    if (G.mode !== 'bridge') return null;
    if (this.locked || !e) this.ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    else this.ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    this.ray.far = 5.5;
    const list = G.interactables.filter((m) => m.visible !== false && (!m.parent || m.parent.visible !== false));
    const hits = this.ray.intersectObjects(list, false);
    return hits.find((h) => h.object.userData.ia) || null;
  },
  toggleBinos() { this.binos = !this.binos; },
  toggleOrbit() {
    if (G.mode === 'bridge') {
      G.mode = 'orbit'; scene.add(camera); camera.rotation.set(0, 0, 0);   // the mouse now orbits the ship
    } else {
      G.mode = 'bridge'; this.rig.add(camera); camera.position.set(0, this.eye, 0);
    }
    UI.modeChanged();
    this.recapture();
  },
  teleport(k) {
    const spots = { 1: [-0.4, -1.6, 0], 2: [-27.2, -2.3, 0.35], 3: [27.2, -2.3, -0.35], 4: [-9.8, 4.0, Math.PI] };
    const s = spots[k]; if (!s) return;
    if (G.mode !== 'bridge') this.toggleOrbit();
    this.place(...s);
  },
  onKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.code;
    if (down) { G.bnwasT = 0; AUDIO.resume(); }
    // any key takes the mouse back for looking around (keys are a user gesture, like a click)
    if (down && G.started && !this.locked && k !== 'Escape' && !UI.modalOpen() && !UI.panelOpen()) this.requestLock();
    this.keys[k] = down;
    if (!G.started) return;
    if (down && this.seat && !e.repeat && /^Key[WASD]$/.test(k) && !(e.ctrlKey || e.metaKey) && G.mode === 'bridge' && !UI.modalOpen()) this.standUp();
    if (k === 'KeyH') { if (down !== G.whistle) setWhistle(down); e.preventDefault(); return; }
    if (k === 'KeyB' && down) { this.binos = !this.binos; return; }
    if (!down) return;
    if (k === 'KeyS' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.keys.KeyS = false; SAVE.save(false); return; }
    if (UI.zoomOpen() && (k === 'Space' || k === 'KeyF')) { UI.closeZoom(); e.preventDefault(); return; }
    if (UI.zoomOpen() && /^(Minus|Equal|NumpadAdd|NumpadSubtract)$/.test(k)) { UI.zoomRange(k === 'Minus' || k === 'NumpadSubtract' ? -1 : 1); e.preventDefault(); return; }
    if (UI.handleKey(e)) { e.preventDefault(); return; }
    if (G.paused && k !== 'KeyP') return;
    const sh = e.shiftKey;
    switch (k) {
      case 'ArrowUp': teleStep(1, -1); e.preventDefault(); break;
      case 'ArrowDown': teleStep(-1, -1); e.preventDefault(); break;
      case 'ArrowLeft': if (G.steering === 'AUTO') adjustAutopilot(sh ? -10 : -1); else helmStep(sh ? -10 : -5); e.preventDefault(); break;
      case 'ArrowRight': if (G.steering === 'AUTO') adjustAutopilot(sh ? 10 : 1); else helmStep(sh ? 10 : 5); e.preventDefault(); break;
      case 'KeyX': helmOrder(0); break;
      case 'KeyQ': thrStep(-0.25, -1); break;
      case 'KeyE': thrStep(0.25, -1); break;
      case 'KeyZ': thrZero(); break;
      case 'KeyT': UI.toggleTugPanel(); break;
      case 'KeyV': this.toggleOrbit(); break;
      case 'KeyM': UI.zoomDisplay('ecdis1'); break;
      case 'KeyR': UI.zoomDisplay('radar1'); break;
      case 'KeyC': UI.zoomDisplay('conning'); break;
      case 'KeyG': UI.zoomDisplay('docking'); break;
      case 'Space': if (!this.zoomAtCrosshair()) UI.toast('Look at a screen, chart or poster and press Space to view it full screen', 'info'); e.preventDefault(); break;
      case 'KeyF': { if (this.zoomAtCrosshair()) break; const h = this.pick(this.locked ? null : this.mouseEvent()); if (h && h.object.userData.ia.click) h.object.userData.ia.click(h, 0); break; }
      case 'Tab': UI.openCrewMenu(); e.preventDefault(); break;
      case 'BracketRight': UI.setTimeScale(1); break;
      case 'BracketLeft': UI.setTimeScale(-1); break;
      case 'KeyP': UI.togglePause(); break;
      case 'KeyJ': $('mission').classList.toggle('collapsed'); break;
      case 'KeyK': $('statusbar').classList.toggle('hidden'); break;
      case 'F1': UI.showHelp(); e.preventDefault(); break;
      case 'Slash': UI.showHelp(); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': this.teleport(+k.slice(-1)); break;
    }
  },
  update(dt) {
    // field of view (binoculars)
    const want = (this.binos || this.binoHold) ? 9 : 68;
    this.fov += (want - this.fov) * Math.min(1, dt * 10);
    if (Math.abs(camera.fov - this.fov) > 0.01) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
    UI.binoOverlay(this.fov < 30);
    if (G.mode === 'orbit') {
      const s = G.ship, o = this.orbit;
      const tx = s.x, tz = s.z, ty = 25;
      const a = o.az - s.psi * 0;
      camera.position.set(tx + Math.sin(a) * Math.cos(o.el) * o.dist, ty + Math.sin(o.el) * o.dist, tz + Math.cos(a) * Math.cos(o.el) * o.dist);
      camera.lookAt(tx, ty, tz);
      if (this.hover) { this.hover = null; UI.setHover(null); }
      return;
    }
    this.applyLook(dt);
    // walking
    const K = this.keys; let fx = 0, fz = 0;
    if (!UI.modalOpen()) { if (K.KeyW) fz -= 1; if (K.KeyS) fz += 1; if (K.KeyA) fx -= 1; if (K.KeyD) fx += 1; }
    if (this.seat) {                                  // seated (a fresh W/A/S/D press gets up — see onKey)
      fx = fz = 0;
      if (this.turnTo != null) { const d = wrap180((this.turnTo - this.yaw) / DEG) * DEG; this.yaw += d * Math.min(1, dt * 6); if (Math.abs(d) < 0.01) this.turnTo = null; }
      if (this.seat.chair) { const c = this.seat.chair; c.rotation.y += wrap180((this.yaw - c.rotation.y) / DEG) * DEG * Math.min(1, dt * 10); [this.x, this.z] = this.seatPos(this.seat); }
    }
    const run = K.ShiftLeft || K.ShiftRight;
    const speed = run ? 6.5 : 3.2;                    // m/s – brisk walk / jog across a 61 m bridge
    let tvx = 0, tvz = 0;
    if (fx || fz) {
      const l = Math.hypot(fx, fz); fx /= l; fz /= l;
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      tvx = (fx * c + fz * s) * speed; tvz = (-fx * s + fz * c) * speed;
    }
    this.vx = this.vx || 0; this.vz = this.vz || 0;
    const acc = Math.min(1, dt * ((fx || fz) ? 9 : 12));
    this.vx += (tvx - this.vx) * acc; this.vz += (tvz - this.vz) * acc;
    const moving = Math.hypot(this.vx, this.vz) > 0.15;
    if (moving) {
      const ox = this.x, oz = this.z;
      this.tryMove(this.vx * dt, 0); this.tryMove(0, this.vz * dt);
      if (this.x === ox) this.vx *= 0.5; if (this.z === oz) this.vz *= 0.5;
      this.bob += dt * (run ? 12 : 8.5);
    }
    // sitting down / getting up: glide between standing spot and cushion, eye height follows
    const eyeT = this.seat ? this.seat.h + 0.8 : this.eye;
    this.eyeY += (eyeT - this.eyeY) * Math.min(1, dt * 7);
    if (this.moveT < 1) {
      this.moveT = Math.min(1, this.moveT + dt / 0.45);
      const k = this.moveT * this.moveT * (3 - 2 * this.moveT);
      this.rig.position.set(lerp(this.moveFrom[0], this.x, k), 0, lerp(this.moveFrom[1], this.z, k));
    } else this.rig.position.set(this.x, 0, this.z);
    this.rig.rotation.set(0, this.yaw, 0);
    camera.position.y = this.eyeY + (moving ? Math.sin(this.bob * 2) * 0.022 : 0);
    camera.rotation.set(this.pitch, 0, 0);
    // hover
    // only point at things with the crosshair (captured) or the cursor (drag-look fallback)
    const h = this.locked ? this.pick(null) : this.lockFailed && !this.drag ? this.pick(this.mouseEvent()) : null;
    const ia = h ? h.object.userData.ia : null;
    if (ia !== this.hover) { this.hover = ia; UI.setHover(ia); }
  },
  tryMove(dx, dz) {
    const nx = this.x + dx, nz = this.z + dz, r = 0.28;
    if (!BR.inside(nx, nz)) return;
    for (const c of BR.colliders) if (nx > c.x0 - r && nx < c.x1 + r && nz > c.z0 - r && nz < c.z1 + r) return;
    for (const m of CREW.members) if (m.present && Math.hypot(nx - m.group.position.x, nz - m.group.position.z) < 0.55 && Math.hypot(nx - m.group.position.x, nz - m.group.position.z) < Math.hypot(this.x - m.group.position.x, this.z - m.group.position.z)) return;
    this.x = nx; this.z = nz;
  },
};
