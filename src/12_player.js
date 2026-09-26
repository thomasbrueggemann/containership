// ============================================================================
// 12 — PLAYER: walking on the bridge, looking, interacting, cameras
// ============================================================================
const PLAYER = {
  x: -0.4, z: -1.6, yaw: 0, pitch: -0.08, eye: 1.74, keys: {}, locked: false, drag: null,
  binos: false, binoHold: false, fov: 68, bob: 0,
  orbit: { az: 2.3, el: 0.32, dist: 620 },
  hover: null, ray: new THREE.Raycaster(), mouse: new THREE.Vector2(0, 0), lockFailed: false,
  init() {
    this.rig = new THREE.Object3D(); G.bridgeGroup.add(this.rig);
    this.rig.add(camera); camera.position.set(0, this.eye, 0); camera.rotation.set(0, 0, 0);
    this.place(-0.4, -1.6, 0);
    const el = renderer.domElement;
    el.addEventListener('mousedown', (e) => this.onDown(e));
    addEventListener('mouseup', (e) => this.onUp(e));
    addEventListener('mousemove', (e) => this.onMove(e));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el; UI.lockChanged(this.locked);
      // Esc while a display is up releases the mouse (browser rule) – treat it as "close"
      if (!this.locked && UI.zoomOpen() && UI.zoomLocked) UI.closeZoom();
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; UI.lockChanged(false); });
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => { this.keys = {}; if (G.whistle) setWhistle(false); });
  },
  place(x, z, yaw) { this.x = x; this.z = z; this.yaw = yaw; this.pitch = -0.06; },
  inBridge() { return G.mode === 'bridge'; },
  pos() { return { x: this.x, z: this.z }; },
  requestLock() {
    if (this.lockFailed || UI.modalOpen()) return;
    const el = renderer.domElement;
    try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => { this.lockFailed = true; }); } catch (e) { this.lockFailed = true; }
  },
  onDown(e) {
    AUDIO.resume(); G.bnwasT = 0;
    // with the mouse captured, a click on a full-screen display simply closes it again
    if (UI.zoomOpen() && (this.locked || e.target === renderer.domElement)) { UI.closeZoom(); return; }
    if (UI.modalOpen()) return;
    if (e.button === 2) { this.binoHold = true; return; }
    if (G.mode === 'orbit') { this.drag = { x: e.clientX, y: e.clientY, moved: 0 }; return; }
    if (!this.locked && !this.lockFailed && !this._askedLock) { this._askedLock = true; this.requestLock(); return; }
    if (!this.locked && !this.lockFailed) { this.requestLock(); }
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
    if (this.locked) { if (!UI.zoomOpen()) this.look(e.movementX, e.movementY); return; }
    this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (this.drag) {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy); this.drag.x = e.clientX; this.drag.y = e.clientY;
      if (G.mode === 'orbit') { this.orbit.az -= dx * 0.005; this.orbit.el = clamp(this.orbit.el + dy * 0.004, 0.02, 1.45); }
      else if (!this.holding) this.look(dx * 1.2, dy * 1.2);
    }
  },
  look(dx, dy) {
    const k = 0.0022 * (this.fov / 68);
    this.yaw -= dx * k; this.pitch = clamp(this.pitch - dy * k, -1.45, 1.35);
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
      G.mode = 'orbit'; scene.add(camera); camera.rotation.set(0, 0, 0);
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      G.mode = 'bridge'; this.rig.add(camera); camera.position.set(0, this.eye, 0);
    }
    UI.modeChanged();
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
    this.keys[k] = down;
    if (!G.started) return;
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
    // walking
    const K = this.keys; let fx = 0, fz = 0;
    if (!UI.modalOpen()) { if (K.KeyW) fz -= 1; if (K.KeyS) fz += 1; if (K.KeyA) fx -= 1; if (K.KeyD) fx += 1; }
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
    this.rig.position.set(this.x, 0, this.z);
    this.rig.rotation.set(0, this.yaw, 0);
    camera.position.y = this.eye + (moving ? Math.sin(this.bob * 2) * 0.022 : 0);
    camera.rotation.set(this.pitch, 0, 0);
    // hover
    const h = this.locked || this.lockFailed || !this.drag ? this.pick(this.locked ? null : this.mouseEvent()) : null;
    const ia = h ? h.object.userData.ia : null;
    if (ia !== this.hover) { this.hover = ia; UI.setHover(ia); }
  },
  tryMove(dx, dz) {
    const nx = this.x + dx, nz = this.z + dz, r = 0.28;
    if (!BR.inside(nx, nz)) return;
    for (const c of BR.colliders) if (nx > c.x0 - r && nx < c.x1 + r && nz > c.z0 - r && nz < c.z1 + r) return;
    for (const m of CREW.members) if (m.present && Math.hypot(nx - m.x, nz - m.z) < 0.55) return;
    this.x = nx; this.z = nz;
  },
};
