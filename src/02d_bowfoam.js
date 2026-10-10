// ============================================================================
// 02d — BOW FOAM: the white water of the own ship's bow wave as a persistent field on the water.
//
// White water is born where the bow wave breaks and is then *left behind on the water*: the breaker travels with the
// ship, the water (and the foam on it) does not. So the field lives on a grid fixed to the water (a 384 m square around the
// bow, addressed toroidally, so it never needs to be resampled or advected – nothing smears), and each frame the
// breaking region injects foam and bubbles into it while everything decays. The only motion the water has relative to
// the grid is being shoved aside by the hull; that is not advected either but mapped analytically: every texel stores the
// foam of the water whose *undisturbed* lateral position it is (a stream-function label, see swLabel), so a streak born
// at the stem slides out along the bow, rides alongside the parallel body and closes in again behind the stern.
//   R = white water (foam on the surface), G = aeration (bubble cloud just below it; milky turquoise, short-lived)
// Decay is modulated by a lace pattern fixed to the water, so old foam thins into a network and breaks up into patches.
// ============================================================================
const FOAMSIM = {
  on: false, rt: [null, null], cur: 0, win: [0, 0], prevWin: [1e9, 1e9], drift: [0, 0],
  U: {
    uFsTex: { value: null }, uFsWin: { value: new THREE.Vector4() },      // current window origin (water frame), size, 1/size
    uFsDrift: { value: new THREE.Vector2() },                               // water frame = world − drift (the tidal stream carries the foam)
  },
  // sampling (ocean shader): q = water-frame point that the foam belongs to (after the label map)
  GLSL: `
    uniform sampler2D uFsTex; uniform vec4 uFsWin; uniform vec2 uFsDrift;
    vec2 fsSample(vec2 q, float lod){
      vec2 r = (q - uFsWin.xy) * uFsWin.w;
      if (r.x < 0.0 || r.y < 0.0 || r.x > 1.0 || r.y > 1.0) return vec2(0.0);
      float edge = smoothstep(0.0, 0.06, min(min(r.x, r.y), min(1.0 - r.x, 1.0 - r.y)));
      return textureLod(uFsTex, q * uFsWin.w, lod).rg * edge;
    }`,
  init() {
    const hi = CFG.quality === 'high';
    if (CFG.quality === 'low' || !renderer.capabilities.isWebGL2 || !renderer.extensions.has('EXT_color_buffer_float')) return;
    // 384 m square from 70 m ahead of the stem: the bow wave's white water and what is left of it along the hull
    this.N = hi ? 512 : 384; this.dx = 384 / this.N; this.D = 384;
    const mk = () => new THREE.WebGLRenderTarget(this.N, this.N, { type: THREE.HalfFloatType, format: THREE.RGFormat, depthBuffer: false,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.rt = [mk(), mk()];
    this.mat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { uPrev: { value: null }, uWin: { value: new THREE.Vector4() }, uGrid: { value: new THREE.Vector4() }, uDt: { value: 0 }, uBack: { value: 0 }, uDrift: { value: new THREE.Vector2() },
        uLace: { value: ENV.foamTex }, uCloudNoise: { value: ATMOS.noise.texture }, ...SHIPW.U },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        precision highp sampler3D;
        uniform sampler2D uPrev, uLace; uniform sampler3D uCloudNoise; uniform vec4 uWin, uGrid; uniform float uDt, uBack; uniform vec2 uDrift;
        ${SHIPW.GLSL}
        ${SHIPW.GLSL_BREAK}
        void main(){
          // the water-frame point this texel holds now (toroidal window: x = origin + (i·dx − origin) mod D)
          vec2 q = uWin.xy + mod(gl_FragCoord.xy * uGrid.x - uWin.xy, uGrid.y);
          vec2 pq = q - uWin.zw;
          bool kept = pq.x >= 0.0 && pq.y >= 0.0 && pq.x < uGrid.y && pq.y < uGrid.y;      // inside last frame's window too
          vec2 v = kept ? texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0).rg : vec2(0.0);
          // decay: thick, active white water collapses within seconds (e-folding ≈ 3.5 s once the breaker stops feeding it);
          // what is left is a thin lace that lingers along the cell walls and clears first inside the cells
          if (v.r > 1e-3) {
            float lace = texture(uLace, q / 13.0).a;
            v.r *= exp(-uDt / mix(mix(6.0, 40.0, lace * lace), 3.5, smoothstep(0.25, 1.1, v.r)));
          } else v.r = 0.0;
          v.g *= exp(-uDt / 4.5);
          // injection by the breaking bow wave (in the ship's frame, at the water's current position; uBack: where the ship
          // was earlier in a long time step, so time compression does not leave gaps)
          v += swInject(q + uDrift + uShipA[0].zw * uBack, 0) * uDt;
          gl_FragColor = vec4(min(v, vec2(4.0, 2.5)), 0.0, 1.0);
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.quad.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad); this.cam = new THREE.Camera();
    this.on = true;
  },
  // dt = simulation time step (0 while paused: the foam holds still with the ship); long steps (time compression) are split,
  // with the breaker following the ship along her track
  update(dt) {
    if (!this.on) return;
    const s = G.ship, cur = s.curSpeed || 0;
    this.drift[0] += Math.sin(s.curSetTo || 0) * cur * dt; this.drift[1] -= Math.cos(s.curSetTo || 0) * cur * dt;
    // window: centred 120 m aft of the stem (water frame), snapped to whole texels so a texel always holds the same water
    const A = SHIPW.U.uShipA.value[0], dx = this.dx, D = this.D, mx = A.x - A.z * 120 - this.drift[0], mz = A.y - A.w * 120 - this.drift[1];
    const wx = Math.floor((mx - D / 2) / dx) * dx, wz = Math.floor((mz - D / 2) / dx) * dx;
    const m = this.mat.uniforms, T = Math.min(dt, 0.4), n = Math.min(4, Math.ceil(T / 0.08)), V = SHIPW.U.uShipB.value[0].z;
    m.uGrid.value.set(dx, D, 0, 0); m.uDrift.value.set(this.drift[0], this.drift[1]);
    if (dt > 0 || this.prevWin[0] !== wx || this.prevWin[1] !== wz) {
      const prev = renderer.getRenderTarget();
      GPUPROF.begin('foamsim');
      for (let j = 0; j < Math.max(n, 1); j++) {
        m.uPrev.value = this.rt[this.cur].texture; m.uWin.value.set(wx, wz, this.prevWin[0], this.prevWin[1]);
        m.uDt.value = n ? T / n : 0; m.uBack.value = n ? V * T / n * (n - 1 - j) : 0;
        renderer.setRenderTarget(this.rt[1 - this.cur]); renderer.render(this.scene, this.cam);
        this.cur = 1 - this.cur; this.prevWin[0] = wx; this.prevWin[1] = wz;
      }
      GPUPROF.end(); renderer.setRenderTarget(prev);
    }
    this.U.uFsTex.value = this.rt[this.cur].texture;
    this.U.uFsWin.value.set(wx, wz, D, 1 / D); this.U.uFsDrift.value.set(this.drift[0], this.drift[1]);
  },
};

// ============================================================================
// BOWMESH — the water around the own ship's bow as a mesh of its own. The ocean grid is centred on the camera and far too
// coarse beyond a hundred metres for a crest a few metres wide, so the bow region (from 35 m ahead of the stem to 90 m aft,
// 40 m out from the hull) is drawn by a grid that hugs the hull: rows parallel to the waterline, stations across it, growing
// outwards and aft. Same water shader; the ocean grid sinks out of sight and is not shaded under it (swMeshSink). The water
// climbs the stem and runs along the hull where this mesh meets the hull, and the breaking crest has a body: it stands proud
// of the surface and boils. At its edges it blends into the ocean grid's surface; from far away (where its cells shrink
// towards a pixel – costly to shade) it fades out and the shading alone carries the bow wave.
// ============================================================================
const BOWMESH = {
  mesh: null,
  init() {
    if (CFG.quality === 'low') return;
    // (cells of ~1.7 m: finer only multiplies the shading cost – thin triangles are shaded in partial quads – without showing more)
    const k = CFG.quality === 'high' ? 1.7 : 2.8, R = SHIPW.U.uSwMesh.value, us = [], ds = [];
    for (let u = R.x; u < R.y; u += (1.0 + 0.012 * Math.abs(u - 8)) * k) us.push(u);
    us.push(R.y);
    for (let d = -2; d < R.z; d += (0.9 + 0.02 * Math.max(d, 0)) * k) ds.push(d);
    ds.push(R.z);
    const nu = us.length, nd = ds.length, pos = new Float32Array(2 * nu * nd * 3), idx = [];
    for (let sd = 0; sd < 2; sd++) {
      const side = sd ? 1 : -1, base = sd * nu * nd;
      for (let i = 0; i < nu; i++) for (let j = 0; j < nd; j++) { const o = (base + i * nd + j) * 3; pos[o] = us[i]; pos[o + 1] = ds[j]; pos[o + 2] = side; }
      for (let i = 0; i < nu - 1; i++) for (let j = 0; j < nd - 1; j++) {
        const a = base + i * nd + j, b = a + nd;
        if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    const W = ENV.waterMat;
    const mat = new THREE.ShaderMaterial({
      uniforms: W.uniforms, defines: { ...W.defines, SW_MESH: '' }, fog: true, fragmentShader: W.fragmentShader,
      vertexShader: `
        #include <common>
        #include <fog_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        precision highp sampler3D;
        uniform float uTime; uniform sampler3D uCloudNoise;
        varying vec3 vWorld;
        ${SWELL.GLSL}
        ${SHIPW.GLSL}
        ${SHIPW.GLSL_BREAK}
        ${FOAMSIM.GLSL}
        void main(){
          // position = (u aft of the stem, d outboard of the waterline, side); the rows follow the hull of vessel slot 0
          vec4 A = uShipA[0], B = uShipB[0];
          float u = position.x, side = position.z, inHull = u > 0.0 && u < B.x ? 1.0 : 0.0;
          float c = side * (swHB(u, B.x, B.y, uShipC[0].z) * inHull + position.y);
          vec2 st = vec2(-A.w, A.z), p = A.xy - A.zw * u + st * c;
          float dc = distance(p, cameraPosition.xz);
          // towards its open edges (and as it fades out) the surface becomes the ocean grid's: no seam
          float inner = smoothstep(0.0, 10.0, min(min(u - uSwMesh.x, uSwMesh.y - u), uSwMesh.z - position.y)) * uSwMesh.w;
          vec4 wp = vec4(p.x, swell(p, dc, uTime, vec2(4.0, 7.0)).x + swHeightSmooth(p) * mix(1.0 - smoothstep(70.0, 220.0, dc), 1.0, inner), p.y, 1.0);
          // the breaking crest stands proud of the surface; fresh white water boils
          vec4 f = swFrame(p, 0);
          float c0 = swLabel(abs(f.y), f.z, 0.5 * B.y);
          wp.y += swRollerH(swRoller(f, c0, 0), 0, uTime) * inner;
          #ifdef SW_SIM
            vec2 q = p + st * (sign(f.y) * c0 - f.y) - uFsDrift;
            wp.y += fsSample(q, 0.0).y * 0.25 * (texture(uCloudNoise, vec3(q / 3.1, uTime * 0.23)).g - 0.45) * inner;
          #endif
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`,
    });
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false; m.renderOrder = -1;
    m.layers.set(1); camera.layers.enable(1);                   // not drawn into the mirrored (reflection) view, like the sea
    scene.add(m);
    this.mesh = m;
  },
  // fade out between 300 and 420 m from the camera to the stem (it would only cost there: cells far below a pixel); seen
  // from above the cells look bigger, so it stays on a little longer
  update(cp) {
    if (!this.mesh) return;
    const A = SHIPW.U.uShipA.value[0], R = SHIPW.U.uSwMesh.value;
    R.w = 1 - smooth(300, 420, Math.hypot(cp.x - A.x, cp.z - A.y) - Math.max(0, cp.y - 40) * 0.5);
    this.mesh.visible = R.w > 0;
  },
};
