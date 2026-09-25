// ============================================================================
// 05 — BRIDGE: wheelhouse structure, consoles, controls, interaction targets
// Bridge-local frame: x starboard, y up (floor 0), -z forward. Window line z=-6.
// ============================================================================
const BR = {
  CW: 12, WZ: -1.5,
  halfW: 30.8, zFront: -6.0, zAft: 6.0, H: 3.3, sill: 1.05,
  colliders: [],             // {x0,x1,z0,z1}
  nodes: {},                 // crew navigation graph
  controls: {},              // named control objects
  anim: [],                  // animated bits (wipers, radar scanners)
};
const BRIDGE_Y = 45.8, BRIDGE_Z = -50;

function addCollider(x0, x1, z0, z1) { BR.colliders.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) }); }

// Registers a mesh as clickable. cfg: {name, hint, click(hit, btn), wheel(dir), down(), up()}
function interactive(mesh, cfg) {
  mesh.userData.ia = cfg;
  G.interactables.push(mesh);
  return mesh;
}

// small push button with a printed label (lives on a tilted panel group)
function makeButton(parent, label, x, z, o = {}) {
  const w = o.w || 0.085, d = o.d || 0.05;
  const lab = labelTexture(label, { w: 128, h: Math.round(128 * d / w), bg: o.bg || '#262d33', color: o.color || '#e3eaee', size: o.size || 26, border: '#0b0e10' });
  const top = new THREE.MeshStandardMaterial({ map: lab, roughness: 0.5, emissive: 0x000000, emissiveMap: lab });
  const side = new THREE.MeshStandardMaterial({ color: 0x15191c, roughness: 0.6 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.018, d), [side, side, top, side, side, side]);
  m.position.set(x, 0.012, z);
  parent.add(m);
  const btn = {
    mesh: m, lit: false,
    setLit(on, color = 0x5fd1ff) { if (on === this.lit && this._c === color) return; this.lit = on; this._c = color; top.emissive.set(on ? color : 0x000000); top.emissiveIntensity = on ? 0.9 : 0; },
    press() { m.position.y = 0.006; setTimeout(() => (m.position.y = 0.012), 140); AUDIO.click(); },
  };
  if (o.click || o.down) interactive(m, { name: o.name || label, hint: o.hint || '', click: (h, b) => { btn.press(); o.click && o.click(h, b); }, down: o.down, up: o.up });
  return btn;
}

// tilted panel group (control desk surface) – returns group whose +y is the panel normal
function panelGroup(parent, x, y, z, w, d, tilt, mat) {
  const g = new THREE.Group();
  g.position.set(x, y, z); g.rotation.x = tilt;
  parent.add(g);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), mat); m.position.y = -0.015; m.receiveShadow = true; g.add(m);
  return g;
}

function buildBridge(shipGroup) {
  const bg = new THREE.Group(); bg.name = 'bridge';
  bg.position.set(0, BRIDGE_Y, BRIDGE_Z);
  shipGroup.add(bg);
  G.bridgeGroup = bg;
  const W = BR.halfW, zf = BR.zFront, za = BR.zAft, H = BR.H;
  const B = new Batcher();

  // ---------- materials
  const envI = 0.35;
  const std = (c, r = 0.7, m = 0, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, envMapIntensity: envI, ...o });
  const floorTex = panelTexture('#3a4550', 3); floorTex.repeat.set(12, 3);
  const M = {
    floor: std(0xffffff, 0.75, 0, { map: floorTex }),
    wall: std(0xd9dcd8, 0.8, 0, { side: THREE.DoubleSide }),
    wallExt: std(0xf1f3f2, 0.6, 0.05, { side: THREE.DoubleSide, envMapIntensity: 1 }),
    ceiling: std(0xe9ebea, 0.9, 0, { side: THREE.DoubleSide }),
    frame: std(0x2a3036, 0.5, 0.5),
    console: std(0xc4c9c6, 0.5, 0.25),
    consoleDark: std(0x1e2429, 0.5, 0.3),
    panel: std(0xa9afb1, 0.55, 0.25),
    bezel: std(0x0d1013, 0.4, 0.3),
    steel: std(0x8d959b, 0.4, 0.7),
    black: std(0x0f1113, 0.6, 0.1),
    red: std(0xb3261e, 0.5, 0.1), green: std(0x1b8f3e, 0.5, 0.1),
    wood: std(0x6a4a2f, 0.6, 0.0),
    chair: std(0x2d62ad, 0.85, 0.0),
    chairBase: std(0x8c9398, 0.5, 0.5),
    lamp: new THREE.MeshStandardMaterial({ color: 0xf6f6f2, emissive: ENV.night ? 0x220000 : 0xfff6e6, emissiveIntensity: ENV.night ? 0.6 : 0.35, roughness: 0.4 }),
    rubber: std(0x131415, 0.9),
    orange: std(0xf06a14, 0.6),
    yellow: std(0xe8c21a, 0.6),
  };
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe6e0, transparent: true, opacity: 0.12, roughness: 0.03, metalness: 0.0, envMapIntensity: 1.2, depthWrite: false, side: THREE.DoubleSide });
  const tint = new THREE.MeshStandardMaterial({ color: 0x1a1d20, transparent: true, opacity: 0.55, roughness: 0.3, side: THREE.DoubleSide, depthWrite: false });

  // ---------- layout: central wheelhouse (|x| < CW) + narrow glazed wing passages (z < WZ)
  const CW = BR.CW, WZ = BR.WZ;
  const fl = (x0, x1, z0, z1, mat = M.floor, y = -0.15) => { const m = new THREE.Mesh(boxUV(x1 - x0, 0.3, z1 - z0, 2), mat); m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.receiveShadow = true; bg.add(m); };
  fl(-CW, CW, zf, za);
  M.deckExt = std(0x5f6f67, 0.85, 0.1, { envMapIntensity: 0.9 });
  for (const sx of [-1, 1]) {
    const a = (v) => [Math.min(sx * v[0], sx * v[1]), Math.max(sx * v[0], sx * v[1])];
    fl(...a([CW, 29.4]), zf, WZ);
    fl(...a([29.4, W]), zf, -4.1); fl(...a([29.4, W]), -1.7, WZ);
    // glass floor panel at the wing end
    const gf = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 2.4), new THREE.MeshPhysicalMaterial({ color: 0xbfe0e8, transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false }));
    gf.rotation.x = -Math.PI / 2; gf.position.set(sx * 30.05, 0.02, -2.9); bg.add(gf);
    B.box(M.frame, 1.4, 0.04, 0.08, sx * 30.05, 0.02, -4.12); B.box(M.frame, 1.4, 0.04, 0.08, sx * 30.05, 0.02, -1.68);
    // open wing deck behind the glazed passage, with railings
    fl(...a([CW, W]), WZ, 3.2, M.deckExt, -0.17);
    for (let x = CW + 0.6; x < W; x += 1.5) B.box(M.steel, 0.05, 1.1, 0.05, sx * x, 0.55, 3.15);
    B.box(M.steel, W - CW, 0.05, 0.05, sx * (CW + W) / 2, 1.1, 3.15); B.box(M.steel, W - CW, 0.04, 0.04, sx * (CW + W) / 2, 0.6, 3.15);
    for (let z = WZ + 0.6; z < 3.2; z += 1.5) B.box(M.steel, 0.05, 1.1, 0.05, sx * (W - 0.05), 0.55, z);
    B.box(M.steel, 0.05, 0.05, 3.2 - WZ, sx * (W - 0.05), 1.1, (WZ + 3.2) / 2);
  }
  // ceilings & roofs
  B.add(boxUV(CW * 2, 0.08, za - zf + 0.4, 1.2), M.ceiling, MX(0, H, 0));
  B.box(M.wallExt, CW * 2 + 0.6, 0.45, za - zf + 2.6, 0, H + 0.3, -0.6);
  for (const sx of [-1, 1]) {
    B.add(boxUV(W - CW, 0.08, WZ - zf + 0.2, 1.2), M.ceiling, MX(sx * (CW + W) / 2, H, (zf + WZ) / 2));
    B.box(M.wallExt, W - CW + 0.3, 0.45, WZ - zf + 2.3, sx * (CW + W + 0.3) / 2, H + 0.3, (zf - 1.9 + WZ + 0.4) / 2);
  }
  B.box(M.wallExt, W * 2 + 0.6, 0.9, 0.12, 0, H + 0.1, zf - 1.9);         // visor edge
  // ceiling light fittings
  for (let x = -10; x <= 10; x += 4) for (const z of [-2.6, 1.0, 4.2]) B.box(M.lamp, 1.2, 0.04, 0.3, x, H - 0.05, z);
  for (const sx of [-1, 1]) for (let x = 14.5; x <= 28; x += 4.5) B.box(M.lamp, 1.2, 0.04, 0.3, sx * x, H - 0.05, -3.9);

  // ---------- walls, windows
  const winTop = H - 0.3, tiltDZ = -0.42; // front windows lean outward at the top
  B.add(boxUV(W * 2, BR.sill, 0.12, 1.2), M.wall, MX(0, BR.sill / 2, zf));
  B.box(M.frame, W * 2, 0.1, 0.4, 0, BR.sill, zf - 0.08); // sill
  const paneW = 2.05; const nPanes = Math.floor(W * 2 / paneW);
  const x0 = -nPanes * paneW / 2;
  for (let i = 0; i < nPanes; i++) {
    const cx = x0 + (i + 0.5) * paneW;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(paneW - 0.08, winTop - BR.sill), glass);
    g.position.set(cx, (BR.sill + winTop) / 2, zf + tiltDZ / 2); g.rotation.x = Math.atan2(tiltDZ, winTop - BR.sill) * -1;
    g.renderOrder = 5; bg.add(g);
    if (i % 3 === 1) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(paneW - 0.1, 0.42), tint);
      t.position.set(cx, winTop - 0.24, zf + tiltDZ * 0.9 + 0.06); t.rotation.x = g.rotation.x; bg.add(t);
    }
  }
  for (let i = 0; i <= nPanes; i++) {
    const cx = x0 + i * paneW;
    B.beam(M.frame, new THREE.Vector3(cx, BR.sill, zf), new THREE.Vector3(cx, winTop, zf + tiltDZ), 0.09, 0.14);
  }
  B.box(M.frame, W * 2, 0.16, 0.2, 0, winTop, zf + tiltDZ);
  B.add(boxUV(W * 2, H - winTop, 0.1, 1.2), M.wall, MX(0, winTop + (H - winTop) / 2, zf + tiltDZ));
  for (let i = nPanes / 2 - 3; i < nPanes / 2 + 3; i++) {
    const cx = x0 + (Math.floor(i) + 0.5) * paneW;
    const piv = new THREE.Group(); piv.position.set(cx, BR.sill + 0.12, zf - 0.28); piv.rotation.x = Math.atan2(tiltDZ, winTop - BR.sill) * -1;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.2, 0.02), M.black); arm.geometry.translate(0, 0.6, 0); piv.add(arm);
    bg.add(piv); BR.anim.push({ type: 'wiper', obj: arm, ph: i * 0.2 });
  }
  // a glazed wall segment (sill wall + windows + header) along x or z
  const glazed = (axis, fixed, a0, a1, n) => {
    const len = a1 - a0, mid = (a0 + a1) / 2;
    if (axis === 'z') { // wall runs along z at x = fixed
      B.add(boxUV(0.12, BR.sill, len, 1.2), M.wall, MX(fixed, BR.sill / 2, mid));
      B.add(boxUV(0.12, H - winTop, len, 1.2), M.wall, MX(fixed, winTop + (H - winTop) / 2, mid));
      B.box(M.frame, 0.2, 0.1, len, fixed, BR.sill, mid);
      for (let k = 0; k < n; k++) {
        const g = new THREE.Mesh(new THREE.PlaneGeometry(len / n - 0.1, winTop - BR.sill), glass);
        g.position.set(fixed, (BR.sill + winTop) / 2, a0 + (k + 0.5) * len / n); g.rotation.y = Math.PI / 2; g.renderOrder = 5; bg.add(g);
        B.box(M.frame, 0.14, winTop - BR.sill, 0.09, fixed, (BR.sill + winTop) / 2, a0 + k * len / n);
      }
      B.box(M.frame, 0.14, winTop - BR.sill, 0.09, fixed, (BR.sill + winTop) / 2, a1);
    } else { // wall runs along x at z = fixed
      B.add(boxUV(len, BR.sill, 0.12, 1.2), M.wall, MX(mid, BR.sill / 2, fixed));
      B.add(boxUV(len, H - winTop, 0.12, 1.2), M.wall, MX(mid, winTop + (H - winTop) / 2, fixed));
      B.box(M.frame, len, 0.1, 0.2, mid, BR.sill, fixed);
      for (let k = 0; k < n; k++) {
        const g = new THREE.Mesh(new THREE.PlaneGeometry(len / n - 0.1, winTop - BR.sill), glass);
        g.position.set(a0 + (k + 0.5) * len / n, (BR.sill + winTop) / 2, fixed); g.renderOrder = 5; bg.add(g);
        B.box(M.frame, 0.09, winTop - BR.sill, 0.14, a0 + k * len / n, (BR.sill + winTop) / 2, fixed);
      }
      B.box(M.frame, 0.09, winTop - BR.sill, 0.14, a1, (BR.sill + winTop) / 2, fixed);
    }
  };
  for (const sx of [-1, 1]) {
    const x = sx * W;
    glazed('z', x, zf, WZ, 2);                               // wing end
    // wing passage aft wall: windows + a weathertight door onto the wing deck
    const d0 = 19.2, d1 = 20.4;
    glazed('x', WZ, sx < 0 ? -W : d1, sx < 0 ? -d1 : W, 4);
    glazed('x', WZ, sx < 0 ? -d0 : CW, sx < 0 ? -CW : d0, 3);
    B.add(boxUV(d1 - d0, H - 2.1, 0.12, 1.2), M.wall, MX(sx * (d0 + d1) / 2, 2.1 + (H - 2.1) / 2, WZ));
    const wd = new THREE.Mesh(new THREE.BoxGeometry(d1 - d0 - 0.12, 2.05, 0.08), std(0xd4d8d6, 0.5, 0.3)); wd.position.set(sx * (d0 + d1) / 2, 1.03, WZ); bg.add(wd);
    const port = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), glass); port.position.set(sx * (d0 + d1) / 2, 1.55, WZ - 0.05); port.rotation.y = Math.PI; bg.add(port);
    B.add(new THREE.TorusGeometry(0.19, 0.025, 8, 24), M.steel, MX(sx * (d0 + d1) / 2, 1.55, WZ - 0.05));
    for (const dy of [0.5, 1.1, 1.7]) B.box(M.steel, 0.12, 0.03, 0.05, sx * (d0 + 0.18), dy, WZ - 0.07);
    interactive(wd, { name: 'Weathertight door to the bridge wing deck', hint: 'Keep closed at sea — the open wing deck is outside' });
    // central wheelhouse side wall (looks out onto the wing deck)
    glazed('z', sx * CW, WZ, za, 3);
    // structural pillars at the corners of the wheelhouse
    B.add(boxUV(0.45, H, 0.45, 1.2), M.wall, MX(sx * (CW - 0.1), H / 2, WZ));
    // sidelights on wing ends (outside)
    const lc = sx < 0 ? 0xff2020 : 0x20ff60;
    B.box(M.black, 0.5, 0.5, 0.6, x + sx * 0.35, H + 0.9, zf + 0.6);
    const s = glowSprite(lc, 5, bg, x + sx * 0.45, H + 0.9, zf + 0.35, sx < 0 ? '255,40,40' : '40,255,100');
    BR.anim.push({ type: 'navlight', obj: s });
  }
  // aft central wall with door
  B.add(boxUV(CW * 2, H, 0.14, 1.2), M.wall, MX(0, H / 2, za));
  B.box(M.frame, 1.1, 2.15, 0.06, 0, 1.075, za - 0.08);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.1, 0.05), std(0x9aa3a8, 0.5, 0.4)); door.position.set(0, 1.05, za - 0.1); bg.add(door);
  BR.door = door;
  B.box(M.steel, 0.12, 0.03, 0.05, 0.36, 1.05, za - 0.15);
  // exterior skins
  B.box(M.wallExt, W * 2 + 0.2, BR.sill + 0.3, 0.05, 0, BR.sill / 2 - 0.15, zf - 0.08);
  B.box(M.wallExt, CW * 2, 0.35, za - zf + 0.2, 0, -0.45, 0);
  for (const sx of [-1, 1]) { B.box(M.wallExt, 29.4 - CW, 0.35, 3.2 - zf, sx * (CW + 29.4) / 2, -0.45, (zf + 3.2) / 2); B.box(M.wallExt, 1.5, 0.35, 2.0, sx * 30.1, -0.45, -5.0); B.box(M.wallExt, 1.5, 0.35, 4.9, sx * 30.1, -0.45, 0.75); }
  B.box(M.wallExt, 58.8, 0.6, 1.2, 0, -0.6, zf - 0.4);

  // ---------- roof equipment (masts, scanners, whistle, flags)
  const mastM = std(0xf1f3f2, 0.6, 0.1, { envMapIntensity: 1 });
  B.box(mastM, 1.2, 7, 1.2, 0, H + 4, 1.5);
  B.box(mastM, 10, 0.4, 1.4, 0, H + 7.5, 1.5);
  B.box(mastM, 0.8, 3.5, 0.8, 0, H + 9.2, 1.5);
  B.box(mastM, 1.6, 1.8, 1.6, -3.8, H + 1.2, 2.5); B.box(mastM, 1.6, 4.5, 1.6, 4, H + 2.6, 2.5);
  // whistle
  B.cyl(M.steel, 0.12, 0.35, 1.2, 1.6, H + 8.4, 1.5, 12, Math.PI / 2);
  const scanners = [];
  for (const [x, y, len] of [[-3.8, H + 2.2, 2.6], [4, H + 5, 3.9]]) {
    const sc = new THREE.Group(); sc.position.set(x, y, 2.5);
    const arr = new THREE.Mesh(new THREE.BoxGeometry(len, 0.32, 0.3), std(0xe8eaea, 0.5)); arr.position.y = 0.35; sc.add(arr);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.4, 10), std(0xdadddd, 0.5)); sc.add(ped);
    bg.add(sc); scanners.push(sc);
  }
  BR.anim.push({ type: 'scanner', objs: scanners });
  // masthead / all round lights
  const mh = glowSprite(0xffffff, 5, bg, 0, H + 11.2, 1.5); BR.anim.push({ type: 'navlight', obj: mh });
  // GPS / sat domes
  for (const [x, z, r] of [[-8, 3, 0.6], [8, 3, 0.9], [-10, 4.2, 0.25], [10.5, 4, 0.25]]) { B.cyl(mastM, 0.12, 0.12, 1, x, H + 1, z, 8); B.add(new THREE.SphereGeometry(r, 16, 10), mastM, MX(x, H + 1.5 + r * 0.6, z)); }
  // flag halyard: H flag (pilot on board) hoisted later
  const hflag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshStandardMaterial({ map: stripesTexture('#ffffff', '#d21f1f', 2, true), side: THREE.DoubleSide, roughness: 0.8 }));
  hflag.position.set(4.6, H + 3, 1.5); hflag.rotation.y = Math.PI / 2; hflag.visible = false; bg.add(hflag);
  BR.hflag = hflag;

  // ---------- main console (11 modules)
  const MOD = 1.1, NMOD = 11, cz0 = -5.08, cz1 = -4.03, ch = 0.8;
  const modX = (i) => -((NMOD * MOD) / 2) + MOD / 2 + i * MOD;
  M.consoleDoors = std(0xffffff, 0.5, 0.25, { map: consoleDoorTexture() });
  B.add(boxUV(NMOD * MOD, ch, cz1 - cz0, 1.1), M.consoleDoors, MX(0, ch / 2, (cz0 + cz1) / 2));
  B.box(M.consoleDark, NMOD * MOD + 0.02, 0.05, 0.1, 0, 0.03, cz1 + 0.02);
  addCollider(-NMOD * MOD / 2 - 0.1, NMOD * MOD / 2 + 0.1, cz0 - 0.1, cz1 + 0.25);
  // modules' display housings & control panels
  const panels = [];
  for (let i = 0; i < NMOD; i++) {
    const x = modX(i);
    B.box(M.bezel, MOD - 0.02, 0.005, 0.02, x, ch + 0.002, cz1 - 0.01);
    const p = panelGroup(bg, x, ch + 0.035, -4.33, MOD - 0.04, 0.55, 0.14, M.panel);
    panels.push(p);
  }
  // displays
  const dispAt = (key, i, w = 0.96, h = 0.62, extra = {}) => {
    const x = modX(i) + (extra.dx || 0);
    const grp = new THREE.Group(); grp.position.set(x, ch + (extra.dy || 0), -4.78 + (extra.dz || 0)); grp.rotation.x = -(extra.tilt ?? 0.66);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.07), M.bezel); housing.position.set(0, h / 2 + 0.03, 0.0); housing.castShadow = true; grp.add(housing);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), DISPLAYS[key].material); scr.position.set(0, h / 2 + 0.03, 0.037); grp.add(scr);
    bg.add(grp);
    interactive(scr, { name: DISPLAYS[key].title, hint: 'Click to view full screen', click: () => UI.zoomDisplay(key) });
    return scr;
  };
  dispAt('radar1', 0); dispAt('ecdis1', 1); dispAt('conning', 3); dispAt('conning2', 4, 0.96, 0.62);
  dispAt('engine', 6); dispAt('tugd', 7); dispAt('docking', 8); dispAt('ecdis2', 9); dispAt('radar2', 10);
  dispAt('autopilot', 2, 0.6, 0.36, { dx: 0.0 });
  // steering stand (module 5) – display for rudder/ROT
  dispAt('steer', 5, 0.62, 0.36);

  // ---- module 0 & 10: radar controls
  for (const [i, key, idx] of [[0, 'radar1', 0], [10, 'radar2', 1]]) {
    const p = panels[i];
    makeButton(p, 'RANGE −', -0.3, 0.08, { name: 'Radar range −', hint: 'Decrease radar range', click: () => { G.radarRange[idx] = RADAR_RANGES[Math.max(0, RADAR_RANGES.indexOf(G.radarRange[idx]) - 1)]; } });
    makeButton(p, 'RANGE +', -0.18, 0.08, { name: 'Radar range +', hint: 'Increase radar range', click: () => { G.radarRange[idx] = RADAR_RANGES[Math.min(RADAR_RANGES.length - 1, RADAR_RANGES.indexOf(G.radarRange[idx]) + 1)]; } });
    const tb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 10), M.black); tb.position.set(0.2, 0.01, 0.08); p.add(tb);
    B.box(M.consoleDark, 0.4, 0.02, 0.14, modX(i) + 0.1, ch + 0.06, -4.2);
  }
  // ---- module 1 & 9: ECDIS controls
  for (const [i, k] of [[1, 'ecdisRange'], [9, 'ecdisRange2']]) {
    const p = panels[i];
    makeButton(p, 'ZOOM IN', -0.3, 0.08, { name: 'ECDIS zoom in', hint: 'Decrease chart range', click: () => { G[k] = ECDIS_RANGES[Math.max(0, ECDIS_RANGES.indexOf(G[k]) - 1)]; DISPLAYS[i === 1 ? 'ecdis1' : 'ecdis2'].force = true; } });
    makeButton(p, 'ZOOM OUT', -0.18, 0.08, { name: 'ECDIS zoom out', hint: 'Increase chart range', click: () => { G[k] = ECDIS_RANGES[Math.min(ECDIS_RANGES.length - 1, ECDIS_RANGES.indexOf(G[k]) + 1)]; DISPLAYS[i === 1 ? 'ecdis1' : 'ecdis2'].force = true; } });
    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.015, 0.14), M.black); kb.position.set(0.15, 0.008, 0.06); p.add(kb);
  }
  // ---- module 2: steering mode + autopilot
  {
    const p = panels[2];
    const modes = ['AUTO', 'HAND', 'NFU'];
    BR.controls.modeBtns = {};
    modes.forEach((m, k) => {
      BR.controls.modeBtns[m] = makeButton(p, m, -0.4 + k * 0.1, 0.12, { name: 'Steering mode: ' + m, hint: { AUTO: 'Autopilot steers the set heading', HAND: 'Follow-up hand steering with the wheel (helm orders)', NFU: 'Non-follow-up: tiller moves the rudder while held' }[m], click: () => setSteering(m) });
    });
    const hb = [['−10°', -10], ['−1°', -1], ['+1°', 1], ['+10°', 10]];
    hb.forEach(([l, d], k) => makeButton(p, l, 0.02 + k * 0.1, 0.12, { name: 'Autopilot set heading ' + l, hint: 'Adjust autopilot set heading (← → keys in AUTO)', click: () => adjustAutopilot(d) }));
    makeButton(p, 'RUD LIM', 0.02, 0.0, { name: 'Autopilot rudder limit', hint: 'Toggle rudder limit 10° / 20°', click: () => { G.apRudderLimit = G.apRudderLimit === 10 ? 20 : 10; } });
    makeButton(p, 'NAV LTS', -0.4, 0.0, { name: 'Navigation lights', hint: 'Toggle navigation lights', click: () => { G.navLights = !G.navLights; } });
    makeButton(p, 'WIPERS', -0.3, 0.0, { name: 'Window wipers', hint: 'Toggle clear-view wipers', click: () => { G.wipers = !G.wipers; } });
    BR.controls.navBtn = null;
  }
  // ---- module 3: VHF radio
  {
    const p = panels[3];
    const vhf = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.16), M.black); vhf.position.set(0.1, 0.025, 0.08); p.add(vhf);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.08), DISPLAYS.vhf.material); scr.rotation.x = -Math.PI / 2; scr.position.set(0.02, 0.052, 0.08); p.add(scr);
    interactive(scr, { name: 'VHF radio (DSC)', hint: 'Shows the working channel. Ch 11 VTS · 12 Tugs · 14 Pilots · 16 Distress/Calling' });
    makeButton(p, 'CH ▲', 0.2, 0.04, { w: 0.07, name: 'VHF channel up', hint: 'Next channel', click: () => vhfStep(1) });
    makeButton(p, 'CH ▼', 0.2, 0.12, { w: 0.07, name: 'VHF channel down', hint: 'Previous channel', click: () => vhfStep(-1) });
    makeButton(p, '16', -0.4, 0.04, { w: 0.07, bg: '#7a1d17', name: 'VHF channel 16', hint: 'Jump to Ch 16', click: () => { G.vhfCh = 16; } });
    makeButton(p, 'CALL', -0.3, 0.04, { w: 0.09, bg: '#1d4f6e', name: 'VHF press-to-talk (call)', hint: 'Call the station on the selected channel', click: () => SCN.vhfCall() });
    // handset
    const hs = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.14, 4, 8), M.black); hs.rotation.z = Math.PI / 2; hs.position.set(-0.36, 0.04, 0.16); p.add(hs);
    interactive(hs, { name: 'VHF handset', hint: 'Call the station on the selected channel', click: () => SCN.vhfCall() });
  }
  // ---- module 4: ECR phone, alarms
  {
    const p = panels[4];
    const ph = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.1), M.red); ph.position.set(-0.35, 0.025, 0.1); p.add(ph);
    const hs = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.13, 4, 8), M.black); hs.rotation.z = Math.PI / 2; hs.position.set(-0.35, 0.07, 0.1); p.add(hs);
    interactive(hs, { name: 'Telephone: Engine Control Room', hint: 'Talk to the Chief Engineer', click: () => UI.openPhone() });
    interactive(ph, { name: 'Telephone: Engine Control Room', hint: 'Talk to the Chief Engineer', click: () => UI.openPhone() });
    makeButton(p, 'BNWAS\nRESET', -0.12, 0.1, { w: 0.09, d: 0.06, size: 20, bg: '#6e5a12', name: 'BNWAS reset', hint: 'Bridge navigational watch alarm – confirm you are alert', click: () => { G.bnwasT = 0; } });
    makeButton(p, 'GEN\nALARM', 0.0, 0.1, { w: 0.09, d: 0.06, size: 20, bg: '#7a1d17', name: 'General alarm', hint: 'Emergency use only – protected by cover', click: () => UI.sub('3/O', 'Captain, that is the general alarm — only in an emergency, sir!', 'o3') });
    makeButton(p, 'DECK\nLIGHTS', 0.12, 0.1, { w: 0.09, d: 0.06, size: 20, name: 'Deck lights', hint: 'Toggle deck floodlights', click: () => { G.deckLights = !G.deckLights; } });
    makeButton(p, 'ACK', 0.3, 0.1, { w: 0.08, bg: '#5a4a10', name: 'Alarm acknowledge', hint: 'Silence the audible alarm', click: () => { ALARMS.ack(); } });
  }
  // ---- module 5: steering stand, wheel, whistle
  {
    const p = panels[5];
    // steering stand: separate pedestal protruding aft of the console (as on the real Triple-E)
    B.add(boxUV(0.84, 0.94, 0.46, 1.1), M.consoleDoors, MX(0, 0.47, -3.8));
    const sp0 = panelGroup(bg, 0, 0.955, -3.8, 0.84, 0.46, 0.28, M.panel);
    addCollider(-0.45, 0.45, -4.05, -3.55);
    for (const [k, lab, hint] of [[0, 'PUMP 1', 'Steering gear pump 1 — running'], [1, 'PUMP 2', 'Steering gear pump 2 — running'], [2, 'RUD IND', 'Rudder angle indicator dimmer'], [3, 'OVERRIDE', 'Steering override (NFU) — use the wing tillers']]) {
      const b = makeButton(sp0, lab, -0.33 + k * 0.1, -0.15, { w: 0.08, size: 19, name: lab === 'OVERRIDE' ? 'Steering override' : 'Steering gear', hint, click: () => {} }); if (k < 2) b.setLit(true, 0x40ff80);
    }
    const wheel = new THREE.Group(); wheel.position.set(0, 1.13, -3.66); wheel.rotation.x = -0.62; bg.add(wheel);
    const teak = new THREE.MeshStandardMaterial({ color: 0x8a5528, roughness: 0.35, metalness: 0.0, envMapIntensity: 0.8 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 12, 40, Math.PI * 1.3), teak); rim.rotation.z = -Math.PI * 0.15 - Math.PI; wheel.add(rim);
    for (const a of [-Math.PI * 0.85, -Math.PI * 0.15]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.02), M.black); sp.geometry.translate(0, 0.085, 0); sp.rotation.z = a - Math.PI / 2; wheel.add(sp); }
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.08), M.black); wheel.add(hub);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16), M.steel); cap.rotation.x = Math.PI / 2; cap.position.z = 0.045; wheel.add(cap);
    const hit = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), new THREE.MeshBasicMaterial({ visible: false })); wheel.add(hit);
    interactive(hit, { name: 'Helm (follow-up wheel)', hint: 'Left half: port 5° · right half: starboard 5° · scroll: 1° · needs HAND mode', click: (h) => { const lp = wheel.worldToLocal(h.point.clone()); helmStep(lp.x < 0 ? -5 : 5); }, wheel: (d) => helmStep(d > 0 ? -1 : 1) });
    BR.controls.wheel = wheel;
    makeButton(p, 'MID', 0.25, 0.18, { w: 0.07, name: 'Midships', hint: 'Rudder amidships (X)', click: () => helmOrder(0) });
    const wh = makeButton(p, 'WHISTLE', 0.4, 0.1, { w: 0.1, d: 0.07, bg: '#8a6b12', size: 22, name: 'Ship\'s whistle', hint: 'Hold to sound (or hold H). 1 short = altering to stbd, 5 short = doubt', down: () => setWhistle(true), up: () => setWhistle(false) });
    // binoculars
    const bino = new THREE.Group(); bino.position.set(-0.38, 0.03, 0.18); p.add(bino);
    for (const dx of [-0.035, 0.035]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.16, 12), M.black); t.rotation.x = Math.PI / 2; t.position.x = dx; bino.add(t); }
    interactive(bino.children[0], { name: 'Binoculars (7×50)', hint: 'Click or hold right mouse / B to look through them', click: () => PLAYER.toggleBinos() });
    interactive(bino.children[1], { name: 'Binoculars (7×50)', hint: 'Click or hold right mouse / B to look through them', click: () => PLAYER.toggleBinos() });
  }
  // ---- module 6: engine telegraph levers
  {
    const p = panels[6];
    BR.controls.levers = [];
    const scaleTex = telegraphScaleTexture();
    for (const [k, dx, col] of [[0, -0.12, 0xb3261e], [1, 0.12, 0x1b8f3e]]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.44), new THREE.MeshStandardMaterial({ map: scaleTex, roughness: 0.5 }));
      plate.rotation.x = -Math.PI / 2; plate.position.set(dx + (k ? 0.075 : -0.075), 0.002, 0.02); p.add(plate);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.46), M.black); slot.position.set(dx, 0.01, 0.02); p.add(slot);
      const lev = new THREE.Group(); lev.position.set(dx, 0.0, 0.02); p.add(lev);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.2, 10), M.steel); shaft.position.y = 0.1; lev.add(shaft);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), new THREE.MeshStandardMaterial({ color: col, roughness: 0.35 })); knob.position.y = 0.21; knob.scale.set(1.3, 0.9, 1); lev.add(knob);
      const hitbox = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.5), new THREE.MeshBasicMaterial({ visible: false })); hitbox.position.set(0, 0.12, 0); p.add(hitbox); hitbox.position.x = dx;
      interactive(hitbox, { name: (k ? 'Starboard' : 'Port') + ' engine telegraph', hint: 'Left click: ahead one notch · right click: astern · scroll · ↑/↓ keys (both)', click: (h, b) => teleStep(b === 2 ? -1 : 1, G.splitEngines ? k : -1), wheel: (d) => teleStep(d < 0 ? 1 : -1, G.splitEngines ? k : -1) });
      BR.controls.levers.push(lev);
    }
    BR.controls.engBtns = {};
    for (const [m, x, hint] of [['STANDBY', -0.36, 'Engine room: stand-by / manoeuvring mode – allows astern and fast load changes'], ['SEA', -0.36, 'Sea passage mode – slow load-up program, no astern'], ['FWE', -0.36, 'Finished with engines']]) {
      const z = m === 'STANDBY' ? -0.12 : m === 'SEA' ? 0.0 : 0.12;
      BR.controls.engBtns[m] = makeButton(p, m, x, z, { w: 0.12, d: 0.05, size: 22, name: 'Engine mode: ' + m, hint, click: () => requestEngineMode(m) });
    }
    makeButton(p, 'SPLIT', 0.37, -0.12, { w: 0.09, name: 'Split / combine telegraphs', hint: 'Toggle independent control of port and starboard engines', click: () => { G.splitEngines = !G.splitEngines; UI.toast(G.splitEngines ? 'Telegraphs split — levers act independently' : 'Telegraphs combined'); } });
    // bell book on the desk
    const bb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.3), new THREE.MeshStandardMaterial({ color: 0x223c6e, roughness: 0.7 })); bb.position.set(0.36, 0.01, 0.12); p.add(bb);
    interactive(bb, { name: 'Bell book (engine movement log)', hint: 'Click to read', click: () => UI.showBellBook() });
  }
  // ---- module 7: bow thrusters
  {
    const p = panels[7];
    BR.controls.thr = [];
    const tsTex = thrusterScaleTexture();
    for (const [k, dx] of [[0, -0.2], [1, 0.02]]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: tsTex, roughness: 0.5 })); plate.rotation.x = -Math.PI / 2; plate.position.set(dx, 0.002, 0.05); p.add(plate);
      const dial = new THREE.Group(); dial.position.set(dx, 0.0, 0.05); p.add(dial);
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.04, 16), M.black); knob.position.y = 0.02; dial.add(knob);
      const ptr = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.075), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 })); ptr.position.set(0, 0.045, -0.03); dial.add(ptr);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.2), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(dx, 0.04, 0.05); p.add(hit);
      interactive(hit, { name: 'Bow thruster ' + (k + 1), hint: 'Left half: push bow to PORT · right half: STARBOARD (25% steps) · Q/E keys (both)', click: (h) => { const lp = p.worldToLocal(h.point.clone()); thrStep(lp.x < dx ? -0.25 : 0.25, k); }, wheel: (d) => thrStep(d < 0 ? 0.25 : -0.25, k) });
      BR.controls.thr.push(dial);
    }
    BR.controls.btStart = makeButton(p, 'BT START', 0.25, -0.12, { w: 0.11, size: 22, name: 'Bow thruster motors start', hint: 'Start both bow thruster motors (takes ~20 s, needs generator reserve)', click: () => startThrusters() });
    makeButton(p, 'BT ZERO', 0.25, 0.0, { w: 0.11, size: 22, name: 'Bow thrusters zero', hint: 'Both thrusters to zero pitch (Z)', click: () => thrZero() });
    makeButton(p, 'TUGS', 0.25, 0.12, { w: 0.11, size: 22, bg: '#1d4f6e', name: 'Tug control (via pilot / VHF 12)', hint: 'Open tug orders panel (T)', click: () => UI.toggleTugPanel() });
  }
  // ---- module 8: docking display extras
  {
    const p = panels[8];
    makeButton(p, 'CAM', -0.3, 0.1, { w: 0.08, name: 'External view', hint: 'Switch to external camera (V)', click: () => PLAYER.toggleOrbit() });
  }

  // ---------- overhead console
  {
    const oh = new THREE.Group(); oh.position.set(0, H - 0.34, -5.55); oh.rotation.x = 0.38; bg.add(oh);
    const box = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.62, 0.3), M.consoleDark); oh.add(box);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 0.56), DISPLAYS.overhead.material); face.position.z = 0.152; oh.add(face);
    interactive(face, { name: 'Overhead instrument panel', hint: 'Rudders · ROT · heading · speed · RPM · wind · depth. Click to enlarge', click: () => UI.zoomDisplay('overhead') });
    for (const x of [-3, 3]) B.box(M.frame, 0.08, 0.3, 0.08, x, H - 0.1, -5.5);
    // echo sounder unit hangs next to it
    const es = new THREE.Group(); es.position.set(4.6, H - 0.42, -5.45); es.rotation.x = 0.38; bg.add(es);
    es.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.2), M.consoleDark));
    const esf = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.72), DISPLAYS.echo.material); esf.position.z = 0.102; es.add(esf);
    interactive(esf, { name: 'Echo sounder', hint: 'Depth below keel & seabed profile. Click to enlarge', click: () => UI.zoomDisplay('echo') });
    // clocks
    const clk = new THREE.Group(); clk.position.set(-4.4, H - 0.4, -5.45); clk.rotation.x = 0.38; bg.add(clk);
    clk.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.15), M.consoleDark));
    const clf = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.44), DISPLAYS.clock.material); clf.position.z = 0.077; clk.add(clf);
    interactive(clf, { name: 'Ship\'s time / UTC / wind', hint: '' });
  }

  // ---------- wing consoles
  for (const sx of [-1, 1]) {
    const xw = sx * 28.4;
    B.add(boxUV(2.2, ch, 1.0, 1.1), M.consoleDoors, MX(xw, ch / 2, -4.6));
    addCollider(xw - 1.25, xw + 1.25, -5.2, -4.0);
    const p = panelGroup(bg, xw, ch + 0.035, -4.3, 2.3, 0.5, 0.14, M.panel);
    // docking display
    const grp = new THREE.Group(); grp.position.set(xw - sx * 0.5, ch, -4.8); grp.rotation.x = -0.66; bg.add(grp);
    const hs = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.6, 0.07), M.bezel); hs.position.y = 0.3; grp.add(hs);
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.54), DISPLAYS.docking.material); sc.position.set(0, 0.3, 0.037); grp.add(sc);
    interactive(sc, { name: 'Wing docking display', hint: 'Distances to quay, transverse speeds. Click to enlarge', click: () => UI.zoomDisplay('docking') });
    // combined telegraph lever
    const lev = new THREE.Group(); lev.position.set(sx * 0.45, 0, 0.0); p.add(lev);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.2, 10), M.steel); shaft.position.y = 0.1; lev.add(shaft);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), M.black); knob.position.y = 0.21; knob.scale.set(1.3, 0.9, 1); lev.add(knob);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.44), new THREE.MeshStandardMaterial({ map: telegraphScaleTexture(), roughness: 0.5 })); plate.rotation.x = -Math.PI / 2; plate.position.set(sx * 0.45 + 0.08, 0.002, 0); p.add(plate);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.5), new THREE.MeshBasicMaterial({ visible: false })); hb.position.set(sx * 0.45, 0.12, 0); p.add(hb);
    interactive(hb, { name: 'Wing telegraph (both engines)', hint: 'Left click: ahead · right click: astern · scroll', click: (h, b) => teleStep(b === 2 ? -1 : 1, -1), wheel: (d) => teleStep(d < 0 ? 1 : -1, -1) });
    BR.controls.levers.push(lev);
    // thruster joystick
    const js = new THREE.Group(); js.position.set(sx * 0.75, 0, 0.05); p.add(js);
    const jb = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 16), M.black); js.add(jb);
    const jst = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8), M.steel); jst.position.y = 0.07; js.add(jst);
    const jk = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), M.yellow); jk.position.y = 0.15; js.add(jk);
    const jh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ visible: false })); jh.position.set(sx * 0.75, 0.08, 0.05); p.add(jh);
    interactive(jh, { name: 'Wing bow thruster joystick', hint: 'Left half: bow to port · right half: bow to starboard', click: (h) => { const lp = p.worldToLocal(h.point.clone()); thrStep(lp.x < sx * 0.75 ? -0.25 : 0.25, -1); } });
    BR.controls.thr.push(js);
    // NFU tiller
    const til = new THREE.Group(); til.position.set(-sx * 0.1, 0, 0.1); p.add(til);
    const tb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.1), M.black); tb.position.y = 0.04; tb.rotation.z = 0; til.add(tb);
    const tht = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), new THREE.MeshBasicMaterial({ visible: false })); tht.position.set(-sx * 0.1, 0.06, 0.1); p.add(tht);
    interactive(tht, { name: 'NFU tiller (wing)', hint: 'Hold left half: rudder to port · right half: to starboard (switches to NFU)', down: (h) => { const lp = p.worldToLocal(h.point.clone()); nfuHold(lp.x < -sx * 0.1 ? -1 : 1); }, up: () => nfuHold(0) });
    BR.controls.tillers = BR.controls.tillers || []; BR.controls.tillers.push(tb);
    makeButton(p, 'WHISTLE', sx * 0.15 - 0.05, -0.1, { w: 0.1, bg: '#8a6b12', size: 22, name: 'Whistle', hint: 'Hold to sound', down: () => setWhistle(true), up: () => setWhistle(false) });
    makeButton(p, 'TUGS', sx * 0.15 - 0.05, 0.05, { w: 0.1, bg: '#1d4f6e', size: 22, name: 'Tug orders', hint: 'Open tug panel (T)', click: () => UI.toggleTugPanel() });
    // glass floor rail
    B.box(M.steel, 0.05, 1.0, 2.6, sx * 29.35, 0.5, -2.9);
    B.box(M.steel, 0.06, 0.06, 2.6, sx * 29.35, 1.0, -2.9);
    // chair
    buildChair(bg, sx * 27.2, -3.3, M);
  }

  // ---------- navigator chairs
  buildChair(bg, -5.5, -3.25, M); buildChair(bg, 5.5, -3.25, M);

  // ---------- chart table (port aft)
  {
    B.box(M.console, 2.4, 0.92, 1.1, -9.8, 0.46, 5.25);
    const ct = chartTableTexture(); registerStatic('chart', 'Paper chart — BA 1234 Westerhaven Approaches', ct);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.0), new THREE.MeshStandardMaterial({ map: ct, roughness: 0.85 }));
    top.rotation.x = -Math.PI / 2; top.position.set(-9.8, 0.925, 5.25); bg.add(top);
    interactive(top, { name: 'Chart table – BA 1234 Westerhaven Approaches', hint: 'Paper chart backup & passage plan. Click to read', click: () => UI.zoomDisplay('chart') });
    const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 6), M.steel); lampArm.position.set(-10.9, 1.3, 5.6); lampArm.rotation.z = 0.5; bg.add(lampArm);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.14, 12, 1, true), M.black); shade.position.set(-10.7, 1.66, 5.5); bg.add(shade);
    // parallel rulers / dividers
    B.box(std(0xd6d0b8, 0.5), 0.6, 0.012, 0.08, -9.6, 0.935, 5.1, 0.3);
    const pc = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.42), new THREE.MeshStandardMaterial({ map: (() => { const t = pilotCardTexture(); registerStatic('pilotcard', 'Pilot card', t); return t; })(), roughness: 0.8 }));
    pc.rotation.x = -Math.PI / 2; pc.rotation.z = 0.2; pc.position.set(-8.9, 0.94, 5.35); bg.add(pc);
    interactive(pc, { name: 'Pilot card', hint: 'Ship\'s particulars & manoeuvring data for the pilot', click: () => UI.zoomDisplay('pilotcard') });
    addCollider(-11.05, -8.55, 4.65, 6);
    // publications shelf
    for (let k = 0; k < 16; k++) B.box(std([0x1f3e6e, 0x6e1f1f, 0x2f5a2f, 0x6e5a1f][k % 4], 0.8), 0.06, 0.3, 0.22, -11.8 + k * 0.08, 1.95, 5.8);
    B.box(M.wood, 1.5, 0.03, 0.26, -11.2, 1.79, 5.8);
  }
  // ---------- GMDSS station (stbd aft)
  {
    B.box(M.console, 2.6, 0.9, 1.0, 9.8, 0.45, 5.3);
    const p = panelGroup(bg, 9.8, 0.93, 5.2, 2.5, 0.8, -0.05, M.panel);
    const gm = new THREE.Group(); gm.position.set(9.8, 0.92, 5.6); gm.rotation.x = 0.35; bg.add(gm);
    for (const [dx, key] of [[-0.8, 'gmdss'], [0.1, 'gmdss'], [0.9, 'navtex']]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.42, 0.06), M.bezel); h.position.set(dx, 0.25, 0); gm.add(h);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.36), DISPLAYS[key].material); s.position.set(dx, 0.25, 0.031); gm.add(s);
      interactive(s, { name: key === 'navtex' ? 'NAVTEX receiver' : 'GMDSS – MF/HF DSC & Inmarsat-C', hint: 'Click to read', click: () => UI.zoomDisplay(key) });
    }
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.1), new THREE.MeshStandardMaterial({ color: 0xcc2211, transparent: true, opacity: 0.8 })); cover.position.set(-0.9, 0.03, -0.1); p.add(cover);
    interactive(cover, { name: 'DISTRESS button (covered)', hint: 'Sends a DSC distress alert. Not today.', click: () => UI.sub('2/O', 'Captain, please — that is the distress button. We are fine!', 'o2') });
    addCollider(8.5, 11.1, 4.75, 6);
  }
  // ---------- coffee corner & safety gear (aft wall)
  {
    B.box(M.console, 1.8, 0.92, 0.6, -4.5, 0.46, 5.6);
    B.box(M.wood, 1.84, 0.04, 0.64, -4.5, 0.94, 5.6);
    const cm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.45, 0.38), std(0x1c1c1c, 0.4, 0.5)); cm.position.set(-4.9, 1.18, 5.62); bg.add(cm);
    interactive(cm, { name: 'Coffee machine', hint: 'Essential bridge equipment', click: () => SCN.coffee() });
    for (let k = 0; k < 4; k++) { const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 12), std([0x42b0d5, 0xffffff, 0x42b0d5, 0x223344][k], 0.5)); mug.position.set(-4.4 + k * 0.12, 1.01, 5.55); bg.add(mug); }
    addCollider(-5.45, -3.55, 5.25, 6);
    // fire extinguishers & lifejackets
    for (const x of [-2.2, 2.2]) { B.cyl(M.red, 0.09, 0.09, 0.55, x, 0.35, 5.8, 12); }
    B.box(M.orange, 0.8, 0.9, 0.35, 3.6, 0.9, 5.75);
    const lj = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.3), new THREE.MeshStandardMaterial({ map: labelTexture('LIFEJACKETS', { w: 256, h: 96, bg: '#f06a14', color: '#fff', size: 34 }) }));
    lj.position.set(3.6, 1.2, 5.56); lj.rotation.y = Math.PI; bg.add(lj);
    // notice boards / particulars poster
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.85), new THREE.MeshStandardMaterial({ map: (() => { const t = particularsTexture(); registerStatic('particulars', 'Wheelhouse poster', t); return t; })(), roughness: 0.8 }));
    poster.position.set(-2.0, 1.65, 5.92); poster.rotation.y = Math.PI; bg.add(poster);
    interactive(poster, { name: 'Wheelhouse poster – manoeuvring characteristics', hint: 'IMO manoeuvring booklet summary. Click to read', click: () => UI.zoomDisplay('particulars') });
    const alarmPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), DISPLAYS.fire.material); alarmPanel.position.set(2.0, 1.6, 5.92); alarmPanel.rotation.y = Math.PI; bg.add(alarmPanel);
    interactive(alarmPanel, { name: 'Fire detection panel', hint: 'All zones normal' });
  }
  // plants for a lived-in feel
  for (const x of [-8, 8]) buildPlant(B, x, 5.55, 0.8, x < 0 ? 3 : 4);

  // interior lights
  if (ENV.night) {
    for (const x of [-18, -6, 6, 18]) { const l = new THREE.PointLight(0xff5533, 0.9, 11, 2); l.position.set(x, H - 0.3, 0); bg.add(l); }
    const cl = new THREE.PointLight(0x9ab8ff, 0.5, 6, 2); cl.position.set(0, 1.4, -3.4); bg.add(cl);
  } else {
    const fill = new THREE.PointLight(0xfff4e8, 3.0, 22, 1.6); fill.position.set(0, H - 0.4, 0); bg.add(fill);
    for (const x of [-18, 18]) { const f2 = new THREE.PointLight(0xfff4e8, 1.8, 16, 1.6); f2.position.set(x, H - 0.4, 0); bg.add(f2); }
  }

  addBridgeDetails(bg, M, B);
  const meshes = B.build(bg, { cast: true, receive: true });
  meshes.forEach((m) => { m.castShadow = true; m.receiveShadow = true; });

  // stairwell (behind door)
  const sw = new THREE.Mesh(new THREE.BoxGeometry(3, 3.3, 3), std(0x9ca3a6, 0.8, 0, { side: THREE.BackSide }));
  sw.position.set(0, 1.65, za + 1.6); bg.add(sw);

  // bounds collider (walls)
  BR.inside = (x, z) => { const ax = Math.abs(x); if (z < zf + 0.45 || ax > W - 0.35) return false; if (ax <= CW - 0.3) return z < za - 0.35; return z < WZ - 0.3; };
  // crew navigation nodes
  BR.nodes = {
    door: [0, 5.3], aftC: [0, 2.6], helm: [0, -3.2], conL: [-2.2, -3.45], conR: [2.2, -3.45], pilot: [-1.1, -3.45], tele: [1.1, -3.4],
    ecdL: [-4.4, -3.45], ecdR: [4.4, -3.45], aftL: [-7.5, 2.6], aftR: [7.5, 2.6], chart: [-9.8, 4.3], gmdss: [9.8, 4.3],
    sideL: [-7.8, -3.9], sideR: [7.8, -3.9], wingL: [-26.5, -3.2], wingR: [26.5, -3.2], midL: [-16, -3.0], midR: [16, -3.0], coffee: [-4.5, 4.6],
  };
  BR.edges = [['door', 'aftC'], ['aftC', 'helm'], ['aftC', 'pilot'], ['aftC', 'tele'], ['helm', 'pilot'], ['helm', 'tele'], ['pilot', 'conL'], ['tele', 'conR'], ['conL', 'ecdL'], ['conR', 'ecdR'],
    ['aftC', 'aftL'], ['aftC', 'aftR'], ['aftL', 'chart'], ['aftR', 'gmdss'], ['ecdL', 'sideL'], ['ecdR', 'sideR'], ['sideL', 'midL'], ['sideR', 'midR'], 
    ['midL', 'wingL'], ['midR', 'wingR'], ['aftC', 'coffee'], ['aftL', 'coffee']];
  return bg;
}

function buildChair(parent, x, z, M) {
  // Maersk-blue high-back navigator chair on a pedestal with footrest
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const b = new Batcher();
  b.cyl(M.chairBase, 0.34, 0.38, 0.05, 0, 0.025, 0, 20);
  b.cyl(M.chairBase, 0.06, 0.07, 0.62, 0, 0.36, 0, 12);
  b.cyl(M.black, 0.075, 0.075, 0.18, 0, 0.72, 0, 12);
  b.add(new THREE.TorusGeometry(0.2, 0.018, 8, 24, Math.PI), M.chairBase, MX(0, 0.36, -0.08, -Math.PI / 2, 0, 0));
  b.add(new RoundedBoxGeometry(0.56, 0.14, 0.54, 3, 0.05), M.chair, MX(0, 0.86, 0));
  b.add(new RoundedBoxGeometry(0.52, 0.72, 0.13, 3, 0.05), M.chair, MX(0, 1.3, 0.27, -0.14));
  b.add(new RoundedBoxGeometry(0.34, 0.2, 0.12, 3, 0.05), M.chair, MX(0, 1.78, 0.34, -0.14));
  for (const sx of [-1, 1]) { b.add(new RoundedBoxGeometry(0.09, 0.07, 0.42, 2, 0.03), M.chair, MX(sx * 0.31, 1.07, 0.02)); b.box(M.chairBase, 0.04, 0.16, 0.04, sx * 0.31, 0.97, 0.15); }
  b.build(g, { cast: true, dynamic: true });
  parent.add(g);
  addCollider(x - 0.35, x + 0.35, z - 0.35, z + 0.35);
  return g;
}

// ------------------------------------------------------------- printed scales, posters
function telegraphScaleTexture() {
  const c = makeCanvas(128, 512), x = c.getContext('2d');
  x.fillStyle = '#20262b'; x.fillRect(0, 0, 128, 512);
  const labels = ['NAV', 'FULL', 'HALF', 'SLOW', 'D.SL', 'STOP', 'D.SL', 'SLOW', 'HALF', 'FULL'];
  x.font = '700 22px Inter, Arial, sans-serif'; x.textAlign = 'center';
  labels.forEach((l, i) => {
    const y = 30 + i * 50;
    x.fillStyle = i < 5 ? '#9fe0a8' : i === 5 ? '#ffffff' : '#ff9a8e';
    x.fillText(l, 64, y + 8);
    x.fillRect(10, y + 18, 108, 2);
  });
  x.fillStyle = '#9fe0a8'; x.font = '700 16px Inter, Arial'; x.fillText('AHEAD', 64, 12);
  x.fillStyle = '#ff9a8e'; x.fillText('ASTERN', 64, 506);
  return canvasTexture(c);
}
function thrusterScaleTexture() {
  const c = makeCanvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#20262b'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#c9d4da'; x.lineWidth = 3;
  x.beginPath(); x.arc(128, 128, 100, Math.PI * 1.1, Math.PI * 1.9); x.stroke();
  x.font = '700 26px Inter, Arial'; x.textAlign = 'center'; x.fillStyle = '#ff8b7d'; x.fillText('P', 30, 110); x.fillStyle = '#8be29a'; x.fillText('S', 226, 110);
  x.fillStyle = '#fff'; x.fillText('0', 128, 22);
  x.font = '600 20px Inter, Arial'; x.fillStyle = '#c9d4da'; x.fillText('BOW THR', 128, 220);
  return canvasTexture(c);
}
function pilotCardTexture() {
  const c = makeCanvas(512, 720), x = c.getContext('2d');
  x.fillStyle = '#f6f3ea'; x.fillRect(0, 0, 512, 720);
  x.fillStyle = '#123'; x.font = '800 30px Inter, Arial'; x.fillText('PILOT CARD', 30, 50);
  x.font = '600 18px Inter, Arial';
  const L = ['Ship: MAJESTIC MAERSK   Call sign: OYGR2', 'LOA 399.2 m   Beam 58.6 m', 'Draft F 14.4 m  A 14.6 m  (arr.)', 'Displacement ≈ 224 000 t', 'Air draft 73 m', 'Engines: 2 × MAN B&W 8S80ME-C9', 'Propellers: 2 × FP, inward turning', 'Rudders: 2 × semi-spade, 35° max', 'Bow thrusters: 2 (no stern thruster)', '', 'Telegraph  RPM   Speed (kn)', 'Nav Full    66    ~19', 'Full        48    ~14', 'Half        38    ~11', 'Slow        29    ~8', 'Dead slow   21    ~5', '', 'Astern power ≈ 80 % of ahead', 'Engine reversal ≈ 6–10 s after stop', 'Crash stop from 12 kn ≈ 1.8 km', 'Turning circle ≈ 4 L at full ahead'];
  L.forEach((l, i) => { x.fillStyle = i >= 10 && i <= 15 ? '#133' : '#333'; x.font = i >= 10 && i <= 15 ? '600 17px ui-monospace, Menlo' : '600 18px Inter, Arial'; x.fillText(l, 30, 100 + i * 29); });
  return canvasTexture(c);
}
function particularsTexture() {
  const c = makeCanvas(768, 544), x = c.getContext('2d');
  x.fillStyle = '#f4f2ea'; x.fillRect(0, 0, 768, 544);
  x.fillStyle = '#0b2b3d'; x.fillRect(0, 0, 768, 70);
  x.fillStyle = '#fff'; x.font = '800 30px Inter, Arial'; x.fillText('WHEELHOUSE POSTER — MAJESTIC MAERSK', 24, 46);
  x.fillStyle = '#222'; x.font = '600 20px Inter, Arial';
  const L = ['Stopping (crash stop) from 12 kn: 1.8 km, 11 min', 'Turning circle (FA, 35°): advance 3.4 L, tactical diameter 4.5 L', 'Response: rudder 35°→30° other side < 28 s (2 × steering gears)', 'Bow thrusters lose effect above ~4 kn', 'Wind area (laden): lateral ≈ 16 500 m²  ·  20 kn beam wind ≈ 60 t', 'Squat at 10 kn in channel ≈ 1.0 m', '', 'Blind sector ahead: 470 m (SOLAS V/22 ≤ 500 m)', 'Bridge eye height: 47.5 m above WL'];
  L.forEach((l, i) => x.fillText(l, 24, 110 + i * 44));
  drawStar(x, 700, 470, 40, '#42b0d5');
  return canvasTexture(c);
}
function chartTableTexture() {
  const c = makeCanvas(1024, 448), x = c.getContext('2d');
  x.fillStyle = '#efe6cf'; x.fillRect(0, 0, 1024, 448);
  // mini paper chart of the approach
  const sx = 1024 / 17000, oz = 224;
  const tx = (X) => (X + 15000) * sx, tz = (Z) => oz + Z * sx;
  x.fillStyle = '#d7c79c';
  const poly = (p) => { x.beginPath(); p.forEach(([X, Z], i) => (i ? x.lineTo(tx(X), tz(Z)) : x.moveTo(tx(X), tz(Z)))); x.closePath(); x.fill(); };
  poly(GEO.mainland); poly(GEO.breakN); poly(GEO.breakS);
  x.strokeStyle = 'rgba(40,70,120,0.5)'; x.setLineDash([6, 4]);
  x.beginPath(); x.moveTo(tx(-13600), tz(-300)); x.lineTo(tx(-2500), tz(-300)); x.moveTo(tx(-13600), tz(300)); x.lineTo(tx(-2500), tz(300)); x.stroke();
  x.setLineDash([]); x.strokeStyle = '#b01010'; x.lineWidth = 2;
  x.beginPath(); ROUTE.forEach((w, i) => (i ? x.lineTo(tx(w[0]), tz(w[1])) : x.moveTo(tx(w[0]), tz(w[1])))); x.stroke();
  x.fillStyle = '#333'; x.font = 'italic 600 16px Georgia, serif'; x.fillText('WESTERHAVEN APPROACHES — BA 1234', 20, 30);
  x.font = '12px Georgia'; for (let i = 0; i < 70; i++) { const X = rr(-15000, -1500), Z = rr(-3500, 3500); x.fillText(Math.round(depthAt(X, Z)), tx(X), tz(Z)); }
  // pencil lines
  x.strokeStyle = 'rgba(60,60,60,0.5)'; x.lineWidth = 1; for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(rr(0, 1024), rr(0, 448)); x.lineTo(rr(0, 1024), rr(0, 448)); x.stroke(); }
  return canvasTexture(c);
}

// ------------------------------------------------------------- control actions
function setSteering(m) {
  if (m === G.steering) return;
  G.steering = m;
  if (m === 'AUTO') { G.apHeading = Math.round(G.ship.psi / DEG); }
  if (m === 'HAND') { G.helmOrder = Math.round(G.ship.rudder); }
  UI.toast('Steering mode: ' + { AUTO: 'AUTOPILOT (heading ' + pad(G.apHeading) + '°)', HAND: 'HAND (follow-up)', NFU: 'NFU (tiller)' }[m]);
  SCN.flag('steer_' + m);
  AUDIO.beep(880, 0.08);
}
function adjustAutopilot(d) {
  if (G.steering !== 'AUTO') { UI.toast('Autopilot not engaged — steering mode is ' + G.steering); return; }
  G.apHeading = wrap360(G.apHeading + d);
}
function helmOrder(deg, spoken = true) {
  deg = clamp(Math.round(deg), -35, 35);
  if (G.steering === 'AUTO') {
    UI.toast('Steering is on AUTOPILOT — press HAND on the steering panel, or order the AB to take the wheel');
    return;
  }
  if (G.steering === 'NFU') setSteering('HAND');
  G.helmOrder = deg;
  if (spoken) CREW.helmOrder(deg);
}
function helmStep(d) { helmOrder((G.steering === 'HAND' ? G.helmOrder : 0) + d); }
function nfuHold(dir) {
  if (dir !== 0 && G.steering !== 'NFU') { G.steering = 'NFU'; UI.toast('Steering mode: NFU (tiller)'); }
  G.nfuDir = dir;
}
function teleStep(d, which) {
  const s = G.ship;
  const idx = which === -1 ? [0, 1] : [which];
  for (const i of idx) {
    const n = clamp(s.tele[i] + d, 0, TELEGRAPH.length - 1);
    if (n === 9 && s.engineMode !== 'SEA' && s.tele[i] === 8) { UI.toast('NAV FULL requires SEA mode (engine load-up program)'); continue; }
    s.tele[i] = n;
  }
  if (!G.splitEngines && which !== -1) s.tele[1 - which] = s.tele[which];
  AUDIO.telegraph();
  const lab = TELEGRAPH[s.tele[0]].label + (s.tele[0] !== s.tele[1] ? ' / ' + TELEGRAPH[s.tele[1]].label : '');
  G.bellBook.unshift({ t: G.simT, txt: lab });
  CREW.teleAck(lab);
  SCN.flag('tele');
}
function requestEngineMode(m) {
  const s = G.ship;
  if (m === s.engineMode || G.pendingMode) return;
  if (m === 'FWE' && Math.abs(s.rpm[0]) + Math.abs(s.rpm[1]) > 1) { UI.toast('Stop engines before Finished With Engines'); return; }
  G.pendingMode = m;
  BR.controls.engBtns[m].setLit(true, 0xffb020);
  CREW.say('ce', { STANDBY: 'Engine room. Stand-by engine, understood. Changing over to manoeuvring — give us a minute.', SEA: 'Engine room, sea passage mode, understood.', FWE: 'Engine room: finished with engines, copied. Thank you, Captain.' }[m], true);
  SCN.later(m === 'STANDBY' ? 30 : 6, () => {
    s.engineMode = m; G.pendingMode = null;
    CREW.say('ce', { STANDBY: 'Bridge, engine room: engines on stand-by. Manoeuvring mode, astern available.', SEA: 'Bridge: sea mode.', FWE: 'Bridge: engines secured.' }[m], true);
    SCN.flag('eng_' + m);
  });
}
function thrStep(d, which) {
  const s = G.ship;
  if (!G.thrReady) { UI.toast(G.thrStarting ? 'Bow thrusters starting — wait for READY' : 'Bow thrusters not running — press BT START'); return; }
  const idx = which === -1 ? [0, 1] : [which];
  for (const i of idx) s.bowThrCmd[i] = clamp(Math.round((s.bowThrCmd[i] + d) * 4) / 4, -1, 1);
  AUDIO.click();
}
function thrZero() { G.ship.bowThrCmd = [0, 0]; }
function startThrusters() {
  if (G.thrReady || G.thrStarting) return;
  G.thrStarting = true;
  BR.controls.btStart.setLit(true, 0xffb020);
  CREW.say('ce', 'Bridge, starting bow thruster motors. Second generator on line.', true);
  SCN.later(20, () => { G.thrReady = true; G.thrStarting = false; BR.controls.btStart.setLit(true, 0x40ff80); UI.toast('Bow thrusters READY'); SCN.flag('bt'); });
}
function vhfStep(d) {
  const chans = [6, 8, 10, 11, 12, 13, 14, 16, 67, 72];
  let i = chans.indexOf(G.vhfCh); if (i < 0) i = 0;
  G.vhfCh = chans[(i + d + chans.length) % chans.length];
  AUDIO.click();
}
function setWhistle(on) { G.whistle = on; if (on) SCN.flag('whistle'); }

// per-frame visual state of bridge controls
function updateBridgeControls(dt, t) {
  const s = G.ship;
  if (BR.controls.levers) BR.controls.levers.forEach((lev, k) => {
    const idx = k < 2 ? k : 0;
    const notch = s.tele[idx] - TELEGRAPH_STOP; // -4..5
    const target = -notch * 0.1;
    lev.rotation.x += (target - lev.rotation.x) * Math.min(1, dt * 12);
  });
  if (BR.controls.thr) BR.controls.thr.forEach((d, k) => { const v = k < 2 ? s.bowThrCmd[k] : (s.bowThrCmd[0] + s.bowThrCmd[1]) / 2; if (k < 2) d.rotation.y = -v * 1.2; else d.rotation.z = -v * 0.5; });
  if (BR.controls.wheel) { const target = -(G.steering === 'HAND' ? G.helmOrder : s.rudder) * DEG * 4; BR.controls.wheel.children.forEach(() => {}); BR.controls.wheel.rotation.z += (target - BR.controls.wheel.rotation.z) * Math.min(1, dt * 6); }
  if (BR.controls.tillers) BR.controls.tillers.forEach((tl) => { tl.rotation.z = (G.steering === 'NFU' ? -(G.nfuDir || 0) * 0.5 : 0); });
  if (BR.controls.modeBtns) for (const m in BR.controls.modeBtns) BR.controls.modeBtns[m].setLit(G.steering === m, 0x40ff80);
  if (BR.controls.engBtns) for (const m in BR.controls.engBtns) if (G.pendingMode !== m) BR.controls.engBtns[m].setLit(s.engineMode === m, 0x40ff80);
  for (const a of BR.anim) {
    if (a.type === 'wiper') { a.obj.rotation.z = G.wipers ? Math.sin(G.realT * 2.4 + a.ph) * 1.2 + 0.25 : 1.52; }
    else if (a.type === 'scanner') { a.objs[0].rotation.y = t * Math.PI * 2 / 2.5; a.objs[1].rotation.y = t * Math.PI * 2 / 3.0 + 1; }
    else if (a.type === 'fn') a.fn(dt, t);
    else if (a.type === 'navlight') { a.obj.visible = G.navLights; a.obj.material.opacity = ENV.night ? 1 : 0.4; }
  }
  if (BR.hflag) { BR.hflag.visible = !!G.flags.hflag; if (BR.hflag.visible) BR.hflag.rotation.x = Math.sin(t * 3) * 0.08; }
}
