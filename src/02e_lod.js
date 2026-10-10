// ============================================================================
// 02e — SCREEN-SIZE CULLING. The scene is ~2 200 draw calls a frame (shadow, mirrored view of the sea, main view), and on a
// high-DPI screen the cost is the calls, not the pixels. Most of them are spent on things nobody can see: a bollard cluster, a
// crane's name plate or a gull from 15 km away is a fraction of a pixel, and the bridge interior never shows in the sea's
// reflection at all. So every mesh sits on one of three layers according to how large it appears:
//   layer 0  drawn by the camera and mirrored in the sea
//   layer 2  drawn by the camera only (too small to register in the blurred, rippled reflection; the small things of the
//            bridge – buttons, instruments, crew – are always here, the mirrored camera never sees them)
//   layer 3  not drawn at all (smaller than ~¾ of a pixel, or beyond the mesh's own userData.farCull distance)
// Layers instead of .visible, because the game toggles .visible itself (flashers, crew, lights) and the shadow pass honours
// layers too. Thresholds are in CSS pixels and follow the field of view, so binoculars bring the small things back.
// ============================================================================
const LOD = {
  list: [], frame: 0, rebuildAt: 0, on: true,
  PX_CULL: 0.75, PX_MIRROR: 2.8, HYST: 1.35,
  stats: { total: 0, mirror: 0, culled: 0 },
  init() {
    camera.layers.enable(2);                       // the camera sees 0, 1 (sea) and 2; the mirrored camera only 0
    PLAYER.ray.layers.enable(2);                   // …and the player can still pick the buttons on layer 2
    this.on = !/[?&]lod=off/.test(location.search);
    this.rebuild();
  },
  // (re)collects the meshes; new ones (mooring lines, …) join within a few seconds
  rebuild() {
    const old = new Map(this.list.map((e) => [e.mesh, e])), list = [], bridge = G.bridgeGroup, ship = G.shipGroup;
    scene.traverse((o) => {
      if (!o.isMesh || o.frustumCulled === false || (o.userData && o.userData.noLod) || o.layers.mask > 1 && !old.has(o)) return;   // sea, bow mesh, … keep their own layers
      let inBridge = false, inShip = false;
      for (let a = o.parent; a; a = a.parent) { if (a === bridge) inBridge = true; else if (a === ship) inShip = true; }
      if (inShip && !inBridge) return;             // the hull, stacks and deckhouse of the own ship are big and close: always drawn
      let e = old.get(o);
      if (!e) {
        // an instanced mesh is as big as the whole field of its instances (the tree belt, a container stack), not one of them
        let s;
        if (o.isInstancedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); s = o.boundingSphere; }
        else { const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); s = g.boundingSphere; }
        e = { mesh: o, center: s.center, radius: s.radius, inBridge, state: 0 };
        if (inBridge && o.castShadow && e.radius < 0.09) o.castShadow = false;        // knobs and buttons: no shadow worth a draw call
      }
      list.push(e);
    });
    this.list = list;
    this.rebuildAt = performance.now() + 3000;
  },
  _c: new THREE.Vector3(),
  update(cp) {
    if (!this.on || (this.frame++ % 5)) return;
    if (performance.now() > this.rebuildAt) this.rebuild();
    const k = camera.fov / innerHeight;                                     // degrees per CSS pixel (vertical field of view)
    const cull = this.PX_CULL * k / 114.59, mirror = this.PX_MIRROR * k / 114.59;     // as r/d (small angle: diameter ≈ 114.59 · r/d degrees)
    const c = this._c, H = this.HYST; let nm = 0, nc = 0;
    for (const e of this.list) {
      const o = e.mesh;
      c.copy(e.center).applyMatrix4(o.matrixWorld);
      const r = e.radius * o.matrixWorld.getMaxScaleOnAxis(), d = Math.max(c.distanceTo(cp) - r, 1), q = r / d, fc = o.userData.farCull;
      let want = 0;
      if ((q < cull * (e.state === 3 ? H : 1) || (fc && d > fc * (e.state === 3 ? 0.93 : 1))) && !e.inBridge) want = 3;       // (farCull: detail that is only worth drawing within this many metres)
      else if (e.inBridge ? r < 0.8 : q < mirror * (e.state === 2 ? H : 1)) want = 2;
      if (want !== e.state) { e.state = want; o.layers.set(want); }
      if (want === 2) nm++; else if (want === 3) nc++;
    }
    this.stats.total = this.list.length; this.stats.mirror = nm; this.stats.culled = nc;
  },
};
