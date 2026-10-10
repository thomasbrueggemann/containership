// ============================================================================
// 02g — SHIP SHADOWS ON THE SEA. The sea is one shader, not a lit mesh, so the shadow map never reaches it: a ship alongside
// or under way simply cast no shadow on the water, and in a low sun that is a big part of what makes a ship look planted in
// the sea. Each ship near the camera is therefore reduced to four boxes (hull, container stacks, accommodation, funnel) and the
// water shader asks, for every sea pixel, whether the ray towards the sun runs through one of them. A ray that only grazes a box
// fades out over a couple of metres, which is also about what the sun's disc does at these distances.
// ============================================================================
const SHSHADOW = {
  N: 4, groups: [], reach: 1400,
  U: {
    uShdPos: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },        // centre x, z (amidships) and heading (forward) fx, fz
    uShdBox: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, // 4 boxes per ship: centre offset forward, half length, half width, height (0 = unused)
  },
  GLSL: `
    uniform vec4 uShdPos[4]; uniform vec4 uShdBox[16];
    // 0 = lit, 1 = in the shadow of a ship; p = sea point (world x, z), L = unit vector towards the sun
    float shipShadow(vec2 p, vec3 L){
      float sh = 0.0;
      vec3 v0 = L; v0.y = max(v0.y, 0.02);
      for (int i = 0; i < 4; i++) {
        vec4 B0 = uShdBox[4 * i]; if (B0.w <= 0.0) continue;
        vec4 P = uShdPos[i]; vec2 d = p - P.xy;
        float reach = B0.y + max(max(uShdBox[4 * i + 1].w, uShdBox[4 * i + 2].w), uShdBox[4 * i + 3].w) / v0.y + 8.0;
        if (dot(d, d) > reach * reach) continue;
        vec2 f = P.zw, s = vec2(-P.w, P.z);                                      // forward, starboard
        vec3 o = vec3(dot(d, f), dot(d, s), 0.0), v = vec3(dot(L.xz, f), dot(L.xz, s), v0.y);
        v = sign(v + 1e-6) * max(abs(v), vec3(1e-4));
        vec3 iv = 1.0 / v;
        for (int k = 0; k < 4; k++) {
          vec4 B = uShdBox[4 * i + k]; if (B.w <= 0.0) continue;
          vec3 t1 = (vec3(B.x - B.y, -B.z, 0.0) - o) * iv, t2 = (vec3(B.x + B.y, B.z, B.w) - o) * iv;
          vec3 tn = min(t1, t2), tf = max(t1, t2);
          float chord = min(min(tf.x, tf.y), tf.z) - max(max(max(tn.x, tn.y), tn.z), 0.0);       // metres of the ray inside the box
          sh = max(sh, smoothstep(0.0, 2.5, chord));
        }
      }
      return sh;
    }
    // 0..1: how much of the sky the sea at p loses to a hull (or the quay wall) beside it – the dark band along a ship's side and in the gap
    // between ship and quay. A wall of height H blocks the sky over a distance of about its height, so the band is a few metres wide.
    float shipAO(vec2 p){
      float ao = 0.0;
      for (int i = 0; i < 4; i++) {
        vec4 B0 = uShdBox[4 * i]; if (B0.w <= 0.0) continue;
        vec4 P = uShdPos[i]; vec2 d = p - P.xy;
        float R = B0.y + 30.0; if (dot(d, d) > R * R) continue;
        vec2 f = P.zw, s = vec2(-P.w, P.z);
        vec2 q = max(abs(vec2(dot(d, f) - B0.x, dot(d, s))) - vec2(B0.y * 0.78, B0.z), 0.0);       // (the bow and stern taper: only the parallel body counts)
        ao = max(ao, exp(-length(q) / 4.5));
      }
      return ao;
    }
    float quayAO(vec2 p){                                           // the three quay walls of the basin (see GEO in 03_world.js)
      if (p.x < -1200.0 || p.x > 1500.0 || p.y < -700.0 || p.y > 760.0) return 0.0;
      return exp(-min(min(p.y + 700.0, 760.0 - p.y), 1500.0 - p.x) / 3.2) * 0.75;
    }`,
  // boxes in the ship's own frame: [centre offset forward, half length, half width, height]. Registered when a ship is built.
  register(grp, boxes) { grp.userData.shd = boxes; this.groups.push(grp); },
  _c: [], _f: new THREE.Vector3(),
  update(cp) {
    const c = this._c; c.length = 0;
    for (const g of this.groups) {
      if (!g.visible || !g.userData.shd) continue;
      const e = g.matrixWorld.elements, x = e[12], z = e[14], d = Math.hypot(x - cp.x, z - cp.z);
      if (d < this.reach) c.push({ g, x, z, d, fx: -e[8], fz: -e[10], own: g === G.shipGroup });
    }
    c.sort((a, b) => (b.own - a.own) || (a.d - b.d));
    const U = this.U;
    for (let i = 0; i < this.N; i++) {
      const s = c[i], P = U.uShdPos.value[i];
      if (!s) { for (let k = 0; k < 4; k++) U.uShdBox.value[4 * i + k].set(0, 0, 0, 0); continue; }
      const l = Math.hypot(s.fx, s.fz) || 1;
      P.set(s.x, s.z, s.fx / l, s.fz / l);
      for (let k = 0; k < 4; k++) { const b = s.g.userData.shd[k]; if (b) U.uShdBox.value[4 * i + k].set(b[0], b[1], b[2], b[3]); else U.uShdBox.value[4 * i + k].set(0, 0, 0, 0); }
    }
  },
};
