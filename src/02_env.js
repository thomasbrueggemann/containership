// ============================================================================
// 02 — ENVIRONMENT: sky, clouds, stars, lights, fog, ocean shader, wakes
// ============================================================================
const TOD = {
  morning: { elev: 13, az: 128, turb: 4.5, ray: 1.25, mie: 0.004, g: 0.8, fog: 0x9fb0bd, fogD: 0.000048,
    sun: 3.4, sunCol: 0xfff0dc, hemiSky: 0xbcd3e6, hemiGnd: 0x3d4247, hemi: 0.4, exposure: 0.55,
    deep: [0.018, 0.05, 0.065], cloud: 0.42, night: false, bg: 1.0, post: { bloom: 0.07, saturation: 1.06, contrast: 1.08, vignette: 0.2 } },
  golden: { elev: 3.2, az: 258, turb: 7.5, ray: 2.4, mie: 0.007, g: 0.88, fog: 0xb99a82, fogD: 0.00005,
    sun: 2.6, sunCol: 0xffb36b, hemiSky: 0xd9b7a0, hemiGnd: 0x3b3430, hemi: 0.35, exposure: 0.6,
    deep: [0.02, 0.04, 0.05], cloud: 0.48, night: false, bg: 1.0, post: { bloom: 0.11, saturation: 1.1, contrast: 1.1, vignette: 0.26 } },
  night: { elev: -16, az: 220, moonElev: 26, moonAz: 160, turb: 2, ray: 0.6, mie: 0.003, g: 0.8, fog: 0x06090d, fogD: 0.00006,
    sun: 0.32, sunCol: 0x9db3d8, hemiSky: 0x1d2b3d, hemiGnd: 0x050709, hemi: 0.45, exposure: 1.0,
    deep: [0.004, 0.008, 0.012], cloud: 0.35, night: true, bg: 1.0, post: { bloom: 0.34, saturation: 0.92, contrast: 1.06, vignette: 0.3, sharpen: 0.2 } },
};
let ENV = null; // { preset, sunDir, sun, hemi, envMap, cubeRT, water, ... }

function buildEnvironment() {
  const P = TOD[CFG.tod];
  const sunDir = new THREE.Vector3();
  const lightElev = P.night ? P.moonElev : P.elev, lightAz = P.night ? P.moonAz : P.az;
  sunDir.setFromSphericalCoords(1, (90 - lightElev) * DEG, lightAz * DEG);
  sunDir.set(Math.sin(lightAz * DEG) * Math.cos(lightElev * DEG), Math.sin(lightElev * DEG), -Math.cos(lightAz * DEG) * Math.cos(lightElev * DEG));
  const skySunDir = new THREE.Vector3(Math.sin(P.az * DEG) * Math.cos(P.elev * DEG), Math.sin(P.elev * DEG), -Math.cos(P.az * DEG) * Math.cos(P.elev * DEG));

  // ---- sky scene (clear sky only) rendered once into cube maps: a big one for lighting / reflections and a
  //      tiny sun-less one that the fog samples. Clouds, sun and moon discs and stars are drawn live (ATMOS.buildDome).
  ATMOS.noise = ATMOS.noise || ATMOS.makeNoise3D();
  ATMOS.U.uGrunge.value = ATMOS.noise.texture;
  const skyScene = new THREE.Scene();
  const sky = new Sky(); sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = P.turb; u.rayleigh.value = P.ray; u.mieCoefficient.value = P.mie; u.mieDirectionalG.value = P.g;
  u.sunPosition.value.copy(skySunDir);
  u.uDisc = { value: 0 };           // the sun is a directional light plus a live disc in the dome – keeping it in the baked cube would light everything twice
  sky.material.fragmentShader = sky.material.fragmentShader.replace('uniform vec3 up;', 'uniform vec3 up; uniform float uDisc;')
    .replace('L0 += ( vSunE * 19000.0 * Fex ) * sundisk;', 'L0 += ( vSunE * 19000.0 * Fex ) * sundisk * uDisc;');
  if (!P.night) skyScene.add(sky);
  else {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { moonDir: { value: sunDir.clone() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 moonDir;
        void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, -0.2, 1.0);
          vec3 zen = vec3(0.004, 0.007, 0.016), hor = vec3(0.022, 0.03, 0.045);
          vec3 c = mix(hor, zen, pow(max(h, 0.0), 0.45));
          c += vec3(0.05, 0.06, 0.08) * pow(max(dot(d, normalize(moonDir)), 0.0), 18.0);
          c += vec3(0.045, 0.028, 0.012) * smoothstep(0.25, 0.0, abs(h)) * smoothstep(-0.2, 0.9, d.x);
          if (d.y < 0.0) c = hor * 0.6;
          gl_FragColor = vec4(c, 1.0); }`,
    }));
    skyScene.add(dome);
  }

  const cubeRT = new THREE.WebGLCubeRenderTarget(CFG.quality === 'low' ? 512 : 1024, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(1, 6000, cubeRT);
  cubeCam.update(renderer, skyScene);
  const fogRT = new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  new THREE.CubeCamera(1, 6000, fogRT).update(renderer, skyScene);
  ATMOS.U.uFogEnv.value = fogRT.texture;
  scene.background = cubeRT.texture;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromCubemap(cubeRT.texture);
  scene.environment = envRT.texture;
  renderer.toneMappingExposure = P.exposure;
  Object.assign(POST.settings, P.post || {});
  scene.fog = new THREE.FogExp2(P.fog, P.fogD);
  const dome = ATMOS.buildDome(P, sunDir, skySunDir);
  scene.add(dome);

  // ---- lights
  const sun = new THREE.DirectionalLight(P.sunCol, P.sun);
  sun.position.copy(sunDir).multiplyScalar(300);
  sun.castShadow = renderer.shadowMap.enabled;
  const sm = CFG.quality === 'high' ? 4096 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera; sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 10; sc.far = 900;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(P.hemiSky, P.hemiGnd, P.hemi);
  scene.add(hemi);

  ENV = { P, sunDir, skySunDir, sun, hemi, cubeRT, fogRT, dome, envMap: envRT.texture, night: P.night, cloudT0: 0, sunT: 1, sunTarget: 1, sunAcc: 0 };
  CLOUDS.cover = P.cloud; CLOUDS.wind = [9, 4];
  // start with the sun (or moon) out: pick the cloud time at which the light is clear now and stays reasonably clear for a while
  if (CLOUDS.buf && sunDir.y > 0.05) {
    let best = 0, bestScore = -1;
    for (let t0 = 0; t0 < 5000; t0 += 25) {
      const T = (dt) => CLOUDS.sunTransmittance(-15600, 50, 105, sunDir, t0 + dt), sc = T(0) * 1.0 + T(120) * 0.6 + T(300) * 0.4 + T(600) * 0.3;
      if (sc > bestScore) { bestScore = sc; best = t0; }
      if (T(0) > 0.92 && T(120) > 0.7 && T(300) > 0.5 && T(600) > 0.35) { best = t0; break; }
    }
    ENV.cloudT0 = best;
  }
  buildOcean();
  return ENV;
}

// ---------------------------------------------------------------- swell
// A few long-crested wave trains running downwind. The same function displaces the water mesh
// (GPU), floats wakes and foam, and moves the ship, small craft and buoys (CPU), so they all ride
// the same waves. Waves fade out with distance from the camera (the far sea keeps its shading)
// and are much reduced inside the breakwaters.
const SWELL = {
  // λ [m], Δdir [°], weight, phase, kind (0 = swell, scaled by waveA; 1 = short steep wind sea, scaled by chop)
  TRAINS: [[175, 0, 1.0, 0.3, 0], [128, 22, 0.8, 2.1, 0], [96, -18, 0.6, 4.0, 0], [72, 40, 0.45, 5.2, 0], [52, -30, 0.8, 1.1, 1], [38, 14, 0.6, 3.3, 1]],
  waves: [], cam: new THREE.Vector3(),
  U: { uSwA: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4()) }, uSwB: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4()) }, uSwAmp: { value: 0 }, uChop: { value: 0 }, uSwMax: { value: 1 } },
  // geometry is displaced only where the mesh is fine enough for the wavelength (fade 4λ…7λ from the
  // camera); the shading keeps the waves much further out (10λ…35λ)
  GEO: [4, 7], SHADE: [10, 35],
  GLSL: `
    uniform vec4 uSwA[6]; uniform vec4 uSwB[6]; uniform float uSwAmp, uChop, uSwMax;
    // xyz = height, d/dx, d/dz at world p; fr = fade range in wavelengths from the camera
    vec3 swell(vec2 p, float dist, float t, vec2 fr){
      vec3 r = vec3(0.0);
      float sh = 1.0 - 0.85 * smoothstep(-3200.0, -2500.0, p.x);
      for (int i = 0; i < 6; i++) {
        vec4 a = uSwA[i], b = uSwB[i];
        float A = b.x * sh * mix(uSwAmp, uChop, b.w) * (1.0 - smoothstep(b.z * fr.x, b.z * fr.y, dist));
        float ph = a.z * dot(a.xy, p) - a.w * t + b.y;
        r.x += A * sin(ph); r.yz += a.xy * (a.z * A * cos(ph));
      }
      return r;
    }`,
  // windTo: direction the wind blows towards, world-frame angle as used by the ocean shader
  init(windAng) {
    this.waves = this.TRAINS.map(([lam, dd, w, ph, kind], i) => {
      const a = windAng + dd * DEG, k = 2 * Math.PI / lam;
      const W = { dx: Math.cos(a), dz: Math.sin(a), k, w: Math.sqrt(9.81 * k), wt: w, ph, lam, kind };
      this.U.uSwA.value[i].set(W.dx, W.dz, k, W.w); this.U.uSwB.value[i].set(w, ph, lam, kind);
      return W;
    });
  },
  setAmp(swell, chop) {
    this.U.uSwAmp.value = swell; this.U.uChop.value = chop;
    this.U.uSwMax.value = Math.max(0.05, this.waves.reduce((s, W) => s + W.wt * (W.kind ? chop : swell), 0));
  },
  // height of the displaced water surface (matches the geometry, so things float on what you see)
  height(x, z, t = G.realT) {
    const sh = 1 - 0.85 * smooth(-3200, -2500, x);
    const dist = Math.hypot(x - this.cam.x, z - this.cam.z), U = this.U;
    let h = 0;
    for (const W of this.waves) h += W.wt * sh * (W.kind ? U.uChop.value : U.uSwAmp.value) * (1 - smooth(W.lam * this.GEO[0], W.lam * this.GEO[1], dist)) * Math.sin(W.k * (W.dx * x + W.dz * z) - W.w * t + W.ph);
    return h;
  },
};
// Places a small craft on the swell: heave from the average, pitch and roll from the local slope.
function rideSwell(grp, x, z, psi, L, B, extraY = 0, extraRoll = 0) {
  const fx = Math.sin(psi) * L / 2, fz = -Math.cos(psi) * L / 2, sx = Math.cos(psi) * B / 2, sz = Math.sin(psi) * B / 2;
  const hb = SWELL.height(x + fx, z + fz), ha = SWELL.height(x - fx, z - fz), hs = SWELL.height(x + sx, z + sz), hp = SWELL.height(x - sx, z - sz);
  grp.rotation.order = 'YXZ';
  grp.position.set(x, (hb + ha + hs + hp) / 4 + extraY, z);
  grp.rotation.set(Math.atan2(hb - ha, L), -psi, Math.atan2(hs - hp, B) * 0.85 + extraRoll);
}
// Camera-centred polar grid: dense near the viewer (swell geometry), sparse out to the horizon.
function oceanGeometry(rings, segs, rMax) {
  const pos = [0, 0, 0], idx = [], a = Math.log(rMax / 2 + 1) / rings;
  for (let j = 1; j <= rings; j++) { const r = 2 * (Math.exp(j * a) - 1); for (let i = 0; i < segs; i++) { const t = i / segs * Math.PI * 2; pos.push(Math.cos(t) * r, 0, Math.sin(t) * r); } }
  for (let i = 0; i < segs; i++) idx.push(0, 1 + (i + 1) % segs, 1 + i);
  for (let j = 0; j < rings - 1; j++) for (let i = 0; i < segs; i++) {
    const a0 = 1 + j * segs + i, a1 = 1 + j * segs + (i + 1) % segs, b0 = a0 + segs, b1 = a1 + segs;
    idx.push(a0, a1, b0, a1, b1, b0);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- ocean
function buildOcean() {
  const P = ENV.P;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uEnv: { value: null }, uRefl: { value: null }, uTexMatrix: { value: new THREE.Matrix4() }, uHasRefl: { value: 0 },
    uSunDir: { value: ENV.sunDir.clone() }, uSunCol: { value: new THREE.Color(P.sunCol).multiplyScalar(P.night ? 0.6 : 1.0) },
    uDeep: { value: new THREE.Vector3(...P.deep) }, uNight: { value: P.night ? 1 : 0 },
    uSkyAmb: { value: new THREE.Color(P.hemiSky).multiplyScalar(P.night ? 0.05 : 0.45) },
    uSea: { value: 0.75 }, uCaps: { value: 0.3 }, uWindAng: { value: 0.8 }, uRipple: { value: null },
    uFoamTex: { value: null }, uBathy: { value: null }, uBathyBox: { value: new THREE.Vector4() }, uCloudNoise: { value: ATMOS.noise.texture }, uCloudT: { value: 0 }, uCover: { value: P.cloud },
    uShallow: { value: new THREE.Color(P.night ? 0.004 : 0.055, P.night ? 0.007 : 0.115, P.night ? 0.006 : 0.085) },
  }]);
  ENV.foamTex = foamTexture(); uniforms.uFoamTex.value = ENV.foamTex;
  FOAMSIM.init();
  uniforms.uCloudNoise.value = ATMOS.noise.texture;          // (render-target textures are dropped by mergeUniforms: set after the merge)
  const bathy = bathyTexture(); uniforms.uBathy.value = bathy.tex; uniforms.uBathyBox.value.copy(bathy.box);
  uniforms.uEnv.value = ENV.cubeRT.texture;
  uniforms.uRipple.value = rippleNormalTexture();
  Object.assign(uniforms, SWELL.U);                 // shared with the wake material and the CPU
  Object.assign(uniforms, SHIPW.U, FOAMSIM.U, SHSHADOW.U, FARSHADOW.U);      // bow waves, hull troughs and Kelvin wakes of the vessels under way, the own ship's white water
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, defines: { ...(SHIPW.quality() ? { SW_KELVIN: '' } : {}), ...(FOAMSIM.on ? { SW_SIM: '' } : {}), ...(/[?&]swdebug/.test(location.search) ? { SW_DEBUG: '' } : {}) },
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      uniform float uTime;
      varying vec3 vWorld;
      ${SWELL.GLSL}
      ${SHIPW.GLSL}
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        wp.y += swell(wp.xz, distance(wp.xz, cameraPosition.xz), uTime, vec2(4.0, 7.0)).x;
        // the grid is too coarse further out: shading carries the ship waves there. The own ship's bow region has a mesh of
        // its own (BOWMESH): the sea sinks out of sight under it (and is not shaded there, see the fragment shader)
        float dcam = distance(wp.xz, cameraPosition.xz);
        wp.y += swHeightSmooth(wp.xz) * (1.0 - smoothstep(70.0, 220.0, dcam)) - swMeshSink(wp.xz, dcam);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime, uNight, uHasRefl, uSea, uCaps, uWindAng;
      uniform samplerCube uEnv; uniform sampler2D uRefl; uniform sampler2D uRipple; uniform mat4 uTexMatrix;
      uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uDeep; uniform vec3 uSkyAmb; uniform vec3 uShallow;
      precision highp sampler3D;
      uniform sampler2D uFoamTex, uBathy; uniform vec4 uBathyBox; uniform sampler3D uCloudNoise; uniform float uCloudT, uCover;
      varying vec3 vWorld;
      ${SWELL.GLSL}
      ${SHIPW.GLSL}
      ${SHIPW.GLSL_BREAK}
      ${FOAMSIM.GLSL}
      ${SHSHADOW.GLSL}
      ${FARSHADOW.wantWater ? FARSHADOW.GLSL : 'float farShadow(vec3 wp, float ndl){ return 1.0; }'}
      ${SHIPW.GLSL_FRAG}
      float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = h1(dot(i, vec2(1.0, 57.0))), b = h1(dot(i + vec2(1.0, 0.0), vec2(1.0, 57.0)));
        float c = h1(dot(i + vec2(0.0, 1.0), vec2(1.0, 57.0))), d = h1(dot(i + vec2(1.0, 1.0), vec2(1.0, 57.0)));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
      // tileable ripple slopes, three layers drifting with the wind at different speeds
      vec2 ripple(vec2 uv){ return texture2D(uRipple, uv).xy * 2.0 - 1.0; }
      void main(){
        // under the own ship's bow mesh: not shaded at all (the log depth buffer writes gl_FragDepth, so the depth test alone
        // would only reject the sunken sea after shading it)
        #ifndef SW_MESH
          if (uSwMesh.w > 0.0 && swMeshSink(vWorld.xz, distance(vWorld.xz, cameraPosition.xz)) > 4.0) discard;
        #endif
        #include <logdepthbuf_fragment>
        vec3 V = cameraPosition - vWorld; float dist = length(V); V /= dist;
        vec2 p = vWorld.xz;
        // world size of one pixel along the view – waves shorter than this are faded out (no aliasing)
        float pix = dist * 0.0017 / max(V.y, 0.06);
        // wind patches / cat's paws: slow large-scale modulation of the short waves
        float patchy = 0.45 + 1.1 * vn(p / 850.0 + uTime * vec2(0.0035, 0.002)) * (0.6 + 0.8 * vn(p / 230.0 - uTime * 0.005));
        // swell slope (matches the displaced geometry exactly)
        vec3 sw = swell(p, length(cameraPosition.xz - p), uTime, vec2(10.0, 35.0));
        vec2 slope = vec2(0.0); float h = 0.0, hsq = 0.0, lost = 0.0, comp = 0.0;
        float wl = 170.0;
        // a few dozen sine waves interfere into a regular lattice; a slow, patchy phase drift (different for every component) makes the pattern irregular
        // at the scale of tens of metres, as the sea is (the geometry keeps its own, exactly matching, swell)
        float pdr = vn(p / 63.0 + 17.3) - 0.5;
        for (int i = 0; i < 34; i++) {
          float fi = float(i);
          float spread = 0.55 + fi * 0.035;
          float a = uWindAng + (h1(fi * 3.17 + 1.3) - 0.5) * 2.0 * spread;
          vec2 dir = vec2(cos(a), sin(a));
          float k = 6.2831853 / wl;
          float w = sqrt(9.81 * k);
          float A = wl * 0.0088 * uSea * (i < 5 ? 0.85 : patchy);
          float fade = clamp((wl - 2.2 * pix) / (2.2 * pix), 0.0, 1.0);
          float ph = k * dot(dir, p) - w * uTime + h1(fi * 7.7) * 6.2831853 + pdr * (0.5 + 0.32 * fi) * (h1(fi * 1.9 + 4.0) - 0.3);
          slope += dir * (k * A * cos(ph) * fade);
          comp += k * A * sin(ph) * fade;                 // horizontal convergence: positive on the crests
          float hs = A * sin(ph) * fade;
          h += hs; hsq += A * A * fade * 0.5;
          lost += k * k * A * A * 0.5 * (1.0 - fade);   // slope variance too fine to resolve -> roughness
          wl *= 0.845;
        }
        float rms = sqrt(hsq) + 1e-4;
        // trochoidal sharpening: slopes steepen towards the crests and ease in the troughs (peaky crests, flat troughs)
        float Qc = (1.3 + 1.4 * clamp(uSea, 0.0, 1.5)) * comp;
        slope = sw.yz + slope / clamp(1.0 - Qc, 0.4, 1.6);
        // bow waves, hull troughs and Kelvin wakes of the vessels under way
        vec2 shSlope, shQ; float shFoam, shAer; vec4 shRoll;
        float shH = swFull(p, shSlope, shFoam, shAer, shQ, shRoll);
        slope += shSlope;
        // broken water is turbulent: a boiling, bumpy surface where the bubbles come up
        if (shAer + shFoam > 0.02 && dist < 900.0) {
          vec2 tq = shQ - uFsDrift;
          vec3 bn = vec3(texture(uCloudNoise, vec3(tq / 6.0, uTime * 0.21)).gb, texture(uCloudNoise, vec3(tq / 2.3 + 0.4, uTime * 0.37)).a);
          slope += (vec2(bn.x - bn.y, bn.y + bn.z - 1.0) * 0.9) * clamp(shAer * 0.5 + shFoam * 0.15, 0.0, 0.6) * (1.0 - smoothstep(150.0, 900.0, dist));
        }
        // drifting capillary / wind ripples (mip-mapped texture: fades out gracefully with distance)
        vec2 wd = vec2(cos(uWindAng), sin(uWindAng)), wp = vec2(-wd.y, wd.x);
        vec2 q = vec2(dot(p, wd), dot(p, wp));
        float rip = uSea * (0.55 + 0.45 * patchy);
        vec2 r1 = ripple(q / 47.0 - vec2(uTime * 0.045, 0.0));
        vec2 r2 = ripple(q.yx / 17.0 + vec2(uTime * 0.012, -uTime * 0.07));
        vec2 r3 = ripple(q / 6.3 - vec2(uTime * 0.16, uTime * 0.03));
        vec2 r4 = ripple(q.yx / 2.3 + vec2(-uTime * 0.25, uTime * 0.11));
        vec2 rs = r1 * 0.13 + r2 * 0.1 + r3 * 0.07 + r4 * 0.045;
        slope += vec2(rs.x * wd.x + rs.y * wp.x, rs.x * wd.y + rs.y * wp.y) * rip;
        lost += rip * rip * 0.0035 * smoothstep(150.0, 2500.0, dist);
        vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
        // unresolved micro-slopes tilt facets towards the viewer: less mirror-like at grazing angles
        float NdV = clamp(max(dot(N, V), 0.0) + sqrt(lost) * 0.8, 0.0, 1.0);
        float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.01;
        float blur = clamp(log2(1.0 + lost * 900.0), 0.0, 4.0);
        vec3 cubeRefl = textureCube(uEnv, R, blur).rgb;
        vec3 refl = cubeRefl;
        if (uHasRefl > 0.5) {
          vec4 rp = uTexMatrix * vec4(vWorld.x, 0.0, vWorld.z, 1.0);
          vec2 ruv = rp.xy / rp.w + N.xz * (0.05 / (1.0 + dist * 0.0015));
          ruv = clamp(ruv, 0.002, 0.998);
          float bl = 0.0018 + 0.004 * uSea;
          vec3 pl = texture2D(uRefl, ruv).rgb * 2.0;
          for (int k = 0; k < 8; k++) { float a = float(k) * 0.7853982 + 0.3927, r = (k & 1) == 0 ? bl : bl * 1.7; pl += texture2D(uRefl, ruv + vec2(cos(a), sin(a)) * vec2(r, r * 1.5)).rgb * 0.5; }
          pl /= 6.0;
          refl = mix(pl, cubeRefl, 0.28);
        }
        float sunUp = clamp(uSunDir.y * 3.0, 0.0, 1.0);
        // cloud shadows: where does the sun's ray from this point cross the cloud layer, and is there cloud there?
        float sv = 1.0;
        if (uSunDir.y > 0.03) {
          vec2 cxz = p + uSunDir.xz / uSunDir.y * 1900.0 + vec2(9.0, 4.0) * uCloudT;
          float thr = mix(0.62, 0.12, uCover);
          sv = 1.0 - 0.85 * smoothstep(thr - 0.1, thr + 0.12, texture(uCloudNoise, vec3(cxz / 52000.0, 0.31)).r);
          sv *= 1.0 - mix(0.28, 0.82, smoothstep(0.4, 2.0, uSunI)) * shipShadow(p, uSunDir);        // …and ships' shadows (by moonlight a ship's shadow on the sea is faint)
          if (p.x > -3700.0) sv *= mix(1.0, farShadow(vec3(p.x, 0.4, p.y), 1.0), 0.85);        // …and the port's (cranes, stacks, the quay)
        }
        // sea-bed depth: shoals are greener, lighter and make the swell break
        vec2 bu = (p - uBathyBox.xy) * uBathyBox.zw;
        float depthM = (bu.x > 0.0 && bu.x < 1.0 && bu.y > 0.0 && bu.y < 1.0) ? texture2D(uBathy, bu).r * 40.0 : 60.0;
        float shallow = 1.0 - smoothstep(4.0, 26.0, depthM), shoal = 1.0 - smoothstep(2.0, 9.0, depthM);
        float sunBody = sunUp * mix(0.4, 1.0, sv);
        vec3 body = mix(uDeep * (0.35 + 1.6 * sunBody), uShallow * (0.3 + 1.7 * sunBody), shallow * 0.9) + uSkyAmb * 0.035;
        float crest = clamp(h / (rms * 2.4) * 0.5 + 0.5, 0.0, 1.0);
        // light scattering through the crests (green/teal)
        body += vec3(0.02, 0.075, 0.07) * pow(crest, 2.5) * sunBody * (0.4 + 0.6 * max(0.0, dot(-V, uSunDir)));
        // bubbles just below the surface scatter the light back: milky turquoise around and under the white water; and sunlit
        // water piled against the bow is thin: it turns turquoise (both scale with the light: by night they all but vanish)
        float shLight = clamp(uSunI / 3.0, 0.0, 1.2) * (0.25 + 0.75 * sunBody);
        body += (vec3(0.05, 0.16, 0.15) * clamp(shAer * 0.6, 0.0, 1.0) + vec3(0.02, 0.06, 0.055) * clamp(shH * 0.5, 0.0, 1.0)) * shLight;
        float occ = max(shipAO(p), quayAO(p)); body *= 1.0 - 0.45 * occ; refl *= 1.0 - 0.4 * occ;      // (the gap between ship and quay, the lee of a hull: darker)
        vec3 col = mix(body, refl, clamp(F, 0.0, 1.0));
        float rough = min(mix(1500.0, 70.0, smoothstep(120.0, 7000.0, dist)), 1.0 / (0.0006 + lost * 1.6));
        float sd = max(dot(R, uSunDir), 0.0);
        col += uSunCol * (pow(sd, rough) * rough * 0.055 + pow(sd, 30.0) * 0.04) * step(0.0, uSunDir.y) * sv;
        // ---- foam: coverage from crest height / breaking on shoals, shaped by a lacy bubble texture
        float swCrest = sw.x / uSwMax;
        float capN = vn(p / 6.0 + uTime * 0.3) * vn(p / 23.0 - uTime * 0.05);
        float cov = smoothstep(1.7, 2.7, h / rms) * uCaps * smoothstep(0.15, 0.6, capN);
        float brk = vn(p / 7.0 + vec2(uTime * 0.35, -uTime * 0.2)) * vn(p / 29.0 - uTime * 0.06) * vn(p / 83.0 + 3.7);
        cov += smoothstep(0.5, 0.85, swCrest) * smoothstep(0.1, 0.3, brk) * uCaps * 1.1;
        cov += smoothstep(0.38, 0.85, Qc) * uCaps * (0.45 + 0.9 * vn(p / 5.0 + vec2(uTime * 0.2, 0.0)));        // crests that pile up break
        cov += shoal * smoothstep(0.1, 0.6, swCrest + 0.15 + 0.35 * vn(p / 9.0 + uTime * 0.2)) * 0.9;
        vec4 fa = texture2D(uFoamTex, q / 19.0 + vec2(uTime * 0.012, 0.0));
        vec4 fb = texture2D(uFoamTex, q.yx / 5.7 + vec2(-uTime * 0.03, uTime * 0.012) + 0.31);
        float lace = clamp(fa.r * 0.75 + fb.r * 0.6, 0.0, 1.0), thick = fa.g * 0.6 + fb.g * 0.4;
        float foam = smoothstep(0.26, 0.7, cov * (0.5 + 0.9 * lace) * (0.4 + 0.9 * thick));
        // faint, broken spindrift streaks blown downwind in the roughest seas
        float streak = fa.b * fb.b * vn(p / 61.0 + 1.3);
        foam += smoothstep(0.2, 0.42, streak) * smoothstep(0.7, 1.0, uCaps) * 0.2;
        float shF = 0.0, shLit = 1.0;
        if (shFoam > 0.004 || shRoll.x > 0.004) {
          // the pattern is fixed to the water the foam sits on (its label point), and evolves: bubbles burst, cells open up
          vec2 lq = shQ - uFsDrift;
          vec4 sa = texture2D(uFoamTex, lq / 11.0 + vec2(0.21, 0.55)), sb = texture2D(uFoamTex, lq.yx / 3.3 + 0.37);
          float boil = texture(uCloudNoise, vec3(lq / 2.7, uTime * 0.07)).g;
          // rank: where the white water holds out longest (two scales, re-equalised: 0.7 U₁ + 0.3 U₂ is not uniform);
          // the bubbles keep bursting, so its edges creep
          float X = sa.a * 0.7 + sb.a * 0.3;
          float rank = X < 0.3 ? X * X / 0.42 : X < 0.7 ? (X - 0.15) / 0.7 : 1.0 - swSq(1.0 - X) / 0.42;
          rank += (boil - 0.48) * 0.4;
          // thick, fresh white water covers everything; as it thins the cells open up, leaving lace, then specks; where the
          // cells are below a pixel only the mean coverage is left (no shimmer)
          float C = 1.0 - exp(-1.25 * shFoam), e = 0.06 + 0.2 * clamp(pix / 0.5, 0.0, 1.0);
          shF = mix(smoothstep(1.0 - C - e, 1.0 - C + e, rank), C, smoothstep(0.25, 1.5, pix));
          // it is a lumpy volume: the tops catch the light, the folds only see the sky; old, thin foam is greyer
          float fold = mix(0.5, clamp(0.5 + (sb.a - 0.5) * 0.9 + (boil - 0.5) * 0.8 + (rank - 1.0 + C) * 0.6, 0.0, 1.0), 1.0 - clamp(pix / 1.5, 0.0, 1.0));
          shLit = mix(0.5, 1.1, fold) * (0.7 + 0.3 * smoothstep(0.1, 1.2, shFoam));
          // the roller on the crest: solid, tumbling white water, streaming out along the crest and boiling
          if (shRoll.x > 0.004) {
            vec3 rc = vec3((shRoll.y - shRoll.w * 0.6 * uTime) / 2.3, shRoll.z / 1.1, uTime * 0.55);
            float churn = smoothstep(0.34, 0.64, texture(uCloudNoise, rc).g * 0.6 + texture(uCloudNoise, rc * vec3(2.1, 2.7, 1.3) + 0.3).b * 0.4);
            float rW = clamp(shRoll.x * 1.4, 0.0, 1.0) * mix(1.0, 0.75 + 0.25 * churn, 1.0 - clamp(pix / 1.5, 0.0, 1.0));
            shLit = mix(shLit, mix(0.62, 1.12, mix(0.5, churn, 1.0 - clamp(pix / 1.5, 0.0, 1.0))), rW);
            shF = max(shF, rW);
          }
        }
        foam *= 1.0 - smoothstep(900.0, 5000.0, dist);
        shF *= 1.0 - smoothstep(1500.0, 5000.0, dist);
        vec3 foamCol = vec3(0.9, 0.93, 0.95) * (0.2 + 0.8 * sunBody) * mix(1.0, 0.1, uNight) + uSkyAmb * 0.05;       // by night only the moon lights it
        col = mix(col, foamCol, clamp(foam * (0.6 + 0.4 * lace), 0.0, 0.93));
        // white water is lit like any matt white surface in the scene: the sky over it (the blurred sky cube) and the sun or moon
        // (sky: the most blurred mips of the sky cube around the foam's normal ≈ the light from the hemisphere over it; albedo ≈ 0.4–0.8)
        vec3 wwCol = vec3(0.0);
        if (shF > 0.0) {
          vec3 Nf = normalize(vec3(-slope.x * 0.6, 1.0, -slope.y * 0.6));
          // (the sky cube is the clear sky: blend in the scene's overall sky light, which knows about the clouds' colour)
          vec3 sky = mix(textureCube(uEnv, normalize(Nf + vec3(0.0, 0.35, 0.0)), 9.0).rgb, uSkyAmb * 1.1, 0.55);
          // (a dense, lumpy scatterer: light wraps round it, so a low sun still lights it, warmly)
          wwCol = 0.75 * (sky + uSunCol * uSunI * clamp((dot(Nf, uSunDir) + 0.45) / 1.45, 0.0, 1.0) * sv * 0.3183 * step(0.0, uSunDir.y + 0.05));
        }
        col = mix(col, wwCol * shLit * mix(vec3(0.62, 0.74, 0.84), vec3(1.0), clamp(shLit * 1.6 - 0.75, 0.0, 1.0)), shF * 0.97);
        #ifdef SW_DEBUG
          col = vec3(clamp(shFoam, 0.0, 1.0), clamp(shAer * 0.5, 0.0, 1.0), clamp(abs(shH) * 0.7, 0.0, 1.0)) * 0.8 + vec3(0.04);
        #endif
        gl_FragColor = vec4(col, 0.0);        // alpha 0: the post pass skips ambient occlusion on the sea
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const water = new THREE.Mesh(CFG.quality === 'low' ? oceanGeometry(200, 240, 60000) : oceanGeometry(330, 400, 60000), mat);
  water.frustumCulled = false;
  water.renderOrder = -1;
  scene.add(water);
  ENV.water = water; ENV.waterMat = mat;
  BOWMESH.init();
  // planar reflection (ship, cranes, quays mirrored in the water)
  if (CFG.quality !== 'low') {
    const k = CFG.quality === 'high' ? 0.5 : 0.35;
    const rt = new THREE.WebGLRenderTarget(Math.round(innerWidth * k), Math.round(innerHeight * k), { type: THREE.HalfFloatType });
    ENV.refl = { rt, k, cam: new THREE.PerspectiveCamera(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.15), tm: new THREE.Matrix4() };
    uniforms.uRefl.value = rt.texture; uniforms.uHasRefl.value = 1;
    addEventListener('resize', () => rt.setSize(Math.round(innerWidth * k), Math.round(innerHeight * k)));
  }
}

// Tileable slope map (RG = d/dx, d/dy) from integer-wavevector sinusoids with a
// wind-sea-like 1/k spectrum. Mip-mapped + anisotropic so it never aliases.
function rippleNormalTexture() {
  const N = 256, data = new Uint8Array(N * N * 4), sx = new Float32Array(N * N), sz = new Float32Array(N * N);
  const R = mulberry32(99), waves = [];
  for (let i = 0; i < 56; i++) {
    let kx, kz; do { kx = Math.round((R() - 0.5) * 2 * 36); kz = Math.round((R() - 0.5) * 2 * 36); } while (Math.hypot(kx, kz) < 2.5 || Math.hypot(kx, kz) > 36);
    const km = Math.hypot(kx, kz);
    waves.push([kx, kz, 1 / Math.pow(km, 1.35), R() * Math.PI * 2]);
  }
  let mx = 0;
  for (const [kx, kz, a, ph] of waves) {
    const fx = 2 * Math.PI * kx / N, fz = 2 * Math.PI * kz / N;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = Math.cos(fx * x + fz * y + ph) * a * N / 12;
      sx[y * N + x] += c * fx; sz[y * N + x] += c * fz;
    }
  }
  for (let i = 0; i < N * N; i++) mx = Math.max(mx, Math.abs(sx[i]), Math.abs(sz[i]));
  for (let i = 0; i < N * N; i++) { data[i * 4] = 128 + 127 * sx[i] / mx; data[i * 4 + 1] = 128 + 127 * sz[i] / mx; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

const _rv = { p: new THREE.Vector3(), d: new THREE.Vector3(), u: new THREE.Vector3() };
function renderReflection() {
  const R = ENV.refl; if (!R) return;
  camera.updateMatrixWorld();
  const cp = _rv.p.setFromMatrixPosition(camera.matrixWorld);
  if (cp.y < 0.5) return;
  const d = _rv.d.set(0, 0, -1).transformDirection(camera.matrixWorld);
  const u = _rv.u.set(0, 1, 0).transformDirection(camera.matrixWorld);
  const c = R.cam;
  c.position.set(cp.x, -cp.y, cp.z);
  c.up.set(u.x, -u.y, u.z);
  c.lookAt(cp.x + d.x, -(cp.y + d.y), cp.z + d.z);
  c.near = camera.near; c.far = camera.far;
  c.projectionMatrix.copy(camera.projectionMatrix); c.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
  c.updateMatrixWorld();
  R.tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
  ENV.waterMat.uniforms.uTexMatrix.value.copy(R.tm);
  ENV.water.visible = false;
  if (Wake._mat) Wake._mat.visible = false;
  const clip = renderer.clippingPlanes;
  renderer.clippingPlanes = [R.plane];
  renderer.shadowMap.autoUpdate = false;
  const dome = ENV.dome, domeMat = dome.material, dU = dome.userData.full.uniforms, s0 = dU.uSteps.value, l0 = dU.uLSteps.value;
  dome.material = dome.userData.full;                                  // the mirrored view cannot use the screen-space cloud target: march them in place…
  dU.uSteps.value = Math.min(s0, 6); dU.uLSteps.value = 0;            // …cheaply: the mirrored sky is blurred and dim
  ATMOS.U.uGrungeK.value = 0;                                          // …and so is the weathering of everything in it
  renderer.setRenderTarget(R.rt); renderer.clear(); GPUPROF.begin('reflection'); renderer.render(scene, c); GPUPROF.end(); renderer.setRenderTarget(null);
  dU.uSteps.value = s0; dU.uLSteps.value = l0; dome.material = domeMat; ATMOS.U.uGrungeK.value = 1;
  renderer.shadowMap.autoUpdate = true;
  renderer.clippingPlanes = clip;
  ENV.water.visible = true;
  if (Wake._mat) Wake._mat.visible = true;
}

// ---------------------------------------------------------------- wakes
// Ribbon of foam trailing a vessel; intensity from speed and propeller thrust. Per vertex: aAlpha (strength),
// aAge [s], aS (distance along the track [m]) and aHW (half width [m]); the shader turns those into a turbulent,
// streaky wake: bright twin screw lanes at first, widening and breaking up into streaks and patches as it ages.
class Wake {
  static K = 9;
  constructor(opts) {
    this.max = opts.max || 140; this.every = opts.every || 2.0; this.width = opts.width || 40; this.spread = opts.spread || 0.25;
    this.life = opts.life || 260; this.pts = []; this.acc = 0;
    // K vertices across: the water surface (swell) rises and falls through a ribbon that is 100 m wide, so two edge
    // vertices would leave the middle of the foam buried below the sea
    const n = this.max, K = Wake.K, nv = n * K;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(nv * 3); this.uv = new Float32Array(nv * 2); this.al = new Float32Array(nv);
    this.ag = new Float32Array(nv); this.sd = new Float32Array(nv); this.hw = new Float32Array(nv);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.al, 1));
    g.setAttribute('aAge', new THREE.BufferAttribute(this.ag, 1));
    g.setAttribute('aS', new THREE.BufferAttribute(this.sd, 1));
    g.setAttribute('aHW', new THREE.BufferAttribute(this.hw, 1));
    const idx = []; for (let i = 0; i < n - 1; i++) for (let k = 0; k < K - 1; k++) { const a = i * K + k, c = a + K; idx.push(a, a + 1, c, a + 1, c + 1, c); }
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, Wake.material());
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  static material() {
    if (Wake._mat) return Wake._mat;
    Wake._mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: { uFoam: { value: ENV.foamTex }, uLight: { value: new THREE.Color(ENV.night ? 0.03 : 0.95, ENV.night ? 0.036 : 0.97, ENV.night ? 0.044 : 1.0) }, uTime: { value: 0 }, ...SWELL.U, ...SHIPW.U },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float aAlpha, aAge, aS, aHW; varying float vA, vAge, vS, vHW; varying vec2 vW; varying vec2 vUv; uniform float uTime;
        ${SWELL.GLSL}
        ${SHIPW.GLSL}
        // wakes and foam patches sit on the water surface wherever they are (also those carried by the ship)
        void main(){ vA = aAlpha; vAge = aAge; vS = aS; vHW = aHW; vUv = uv; vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xz;
          float dc = distance(wp.xz, cameraPosition.xz);
          // (the ship waves as the sea mesh under them shows them: faded with distance, but in full on the own ship's near-field mesh)
          wp.y = 0.32 + swell(wp.xz, dc, uTime, vec2(4.0, 7.0)).x + swHeightSmooth(wp.xz) * max(1.0 - smoothstep(70.0, 220.0, dc), swMeshSink(wp.xz, dc) / 8.0);
          gl_Position = projectionMatrix*viewMatrix*wp;
          #include <logdepthbuf_vertex>
          // the foam lies on the water: pull it a little towards the camera so the sea mesh (coarser than the swell) never buries it
          #if defined( USE_LOGDEPTHBUF ) && defined( USE_LOGDEPTHBUF_EXT )
            vFragDepth = 1.0 + max(gl_Position.w - (0.5 + 0.0022 * gl_Position.w), 0.05);
          #endif
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D uFoam; uniform vec3 uLight; uniform float uTime; varying float vA, vAge, vS, vHW; varying vec2 vW; varying vec2 vUv;
        void main(){
          #include <logdepthbuf_fragment>
          vec4 fa = texture2D(uFoam, vW / 23.0), fb = texture2D(uFoam, vW.yx / 6.1 + vec2(uTime * 0.02, 0.0));
          float lace = clamp(fa.r * 0.75 + fb.r * 0.65, 0.0, 1.0), thick = fa.g * 0.6 + fb.g * 0.4;
          float c = vUv.x * 2.0 - 1.0, ac = abs(c);
          float f = (0.45 + 0.8 * lace) * (0.5 + 0.8 * thick);
          float dens;
          if (vHW > 0.0) {
            // wake ribbon: streaks stretched along the track (track coordinates: x = distance travelled, y = across)
            float sk = texture2D(uFoam, vec2(vS / 190.0, c * vHW / 105.0 + 0.37)).b * 0.65 + texture2D(uFoam, vec2(vS / 70.0 + 0.51, c * vHW / 48.0)).b * 0.55;
            float fresh = exp(-vAge / 55.0), old = exp(-vAge / 190.0);
            float body = 1.0 - smoothstep(0.3, 1.0, ac);                        // wide plateau, soft edges
            float ln = (ac - 0.3) / 0.2, lanes = exp(-ln * ln);                  // the twin screws (pow(negative, 2.0) is undefined in GLSL: square explicitly)
            dens = body * (0.3 * old + 0.8 * fresh * (0.5 + 0.5 * lanes)) * (0.35 + 1.0 * sk);
            f *= 1.15;
          } else {
            // patch (thruster / propeller wash): soft on every side. v runs from the aft end (0) to the end nearest the bow (1);
            // a trailing patch (aHW = -1) is strongest at the hull and thins away astern, a plain one fades towards both ends
            float v = vUv.y;
            float along = vHW < -0.5 ? smoothstep(0.0, 0.85, v) * smoothstep(1.0, 0.9, v) : smoothstep(0.0, 0.3, v) * smoothstep(1.0, 0.7, v);
            dens = (1.0 - ac * ac) * (1.0 - ac * ac) * along;
            f *= 0.5 + 0.8 * texture2D(uFoam, vW / 41.0 + 0.3).g * (1.0 - 0.5 * ac);   // broken up: clumps and gaps, not a flat sheet
          }
          float a = clamp(dens * f * pow(max(vA, 0.0), 0.65) * 2.3, 0.0, 0.96);
          // fresh, aerated water is milky blue-green; it whitens into lacy foam as it ages
          vec3 tint = mix(uLight * vec3(0.78, 0.93, 0.93), uLight, smoothstep(0.2, 0.9, f));
          gl_FragColor = vec4(tint, a);
          #include <colorspace_fragment>
        }`,
    });
    return Wake._mat;
  }
  // x,z = source point (stern), dirx/dirz = unit vector pointing aft, intensity 0..1, speed in m/s. A wake with no history yet (the
  // game starts, a save is loaded, a vessel appears) that is already under way starts as the straight track she has just been
  // sailing, not as a trail that begins abruptly a few boat lengths astern.
  update(dt, x, z, dirx, dirz, intensity, speed = 0) {
    if (!this.primed) {
      this.primed = true;
      if (speed > 1.5 && intensity > 0.2) for (let i = 1; i < this.max; i++) {
        const d = speed * this.every * i;
        this.pts.push({ x: x + dirx * d, z: z + dirz * d, dx: dirx, dz: dirz, age: i * this.every, a: intensity });
      }
    }
    this.acc += dt;
    for (const p of this.pts) p.age += dt;
    if (this.acc >= this.every) {
      this.acc = 0;
      this.pts.unshift({ x, z, dx: dirx, dz: dirz, age: 0, a: intensity });
      if (this.pts.length > this.max) this.pts.pop();
    }
    while (this.pts.length && this.pts[this.pts.length - 1].age > this.life) this.pts.pop();
    // live head point
    const pts = [{ x, z, dx: dirx, dz: dirz, age: 0, a: intensity }, ...this.pts];
    const n = Math.min(pts.length, this.max);
    // the oldest point is dropped when the ribbon is full, usually before its age fade has run out: taper the last stretch away
    const maxAge = Math.min(this.life, (this.max - 1) * this.every), tail = maxAge * 0.7;
    let s = 0; const K = Wake.K;
    for (let i = 0; i < this.max; i++) {
      const p = pts[Math.min(i, n - 1)];
      if (i > 0 && i < n) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      const w = this.width * (0.5 + p.age * this.spread / 10) * (i === 0 ? 0.6 : 1);
      const px = -p.dz, pz = p.dx; // perpendicular
      const fade = i >= n ? 0 : (1 - Math.pow(Math.min(1, p.age / this.life), 3)) * p.a * (1 - THREE.MathUtils.smoothstep(p.age, tail, maxAge));
      for (let k = 0; k < K; k++) {
        const t = k / (K - 1), o = (i * K + k) * 3, off = w * (1 - 2 * t), v = i * K + k;
        this.pos[o] = p.x + px * off; this.pos[o + 1] = 0.3; this.pos[o + 2] = p.z + pz * off;
        this.uv[v * 2] = t; this.uv[v * 2 + 1] = i;
        this.al[v] = fade; this.ag[v] = p.age; this.sd[v] = s; this.hw[v] = w;
      }
    }
    const A = this.geo.attributes;
    A.position.needsUpdate = A.aAlpha.needsUpdate = A.uv.needsUpdate = A.aAge.needsUpdate = A.aS.needsUpdate = A.aHW.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
}

// small foam patch (bow wave, thruster wash, prop wash) attached to a parent
function foamPatch(parent, w, l, x, z, rotY = 0, trailing = false) {
  const g = new THREE.PlaneGeometry(w, l, 8, 8);          // subdivided: it must follow the swell (see Wake)
  g.rotateX(-Math.PI / 2);
  const nv = g.attributes.position.count, al = new Float32Array(nv).fill(0);
  g.setAttribute('aAlpha', new THREE.BufferAttribute(al, 1));
  for (const k of ['aAge', 'aS', 'aHW']) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(nv).fill(k === 'aHW' && trailing ? -1 : 0), 1));
  const m = new THREE.Mesh(g, Wake.material());
  m.position.set(x, 0.35, z); m.rotation.y = rotY; m.renderOrder = 2;
  parent.add(m);
  m.setIntensity = (a) => { al.fill(a); g.attributes.aAlpha.needsUpdate = true; };
  return m;
}

// Sprite glow for lights (visible mostly at dusk/night)
const _glowTex = {};
function lightTexture(rgb) {
  const N = 128, c = makeCanvas(N, N), x = c.getContext('2d'), img = x.createImageData(N, N), [r, g, b] = rgb.split(',').map(Number);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const d = Math.hypot((i + 0.5) / N * 2 - 1, (j + 0.5) / N * 2 - 1), o = (j * N + i) * 4;
    const a = Math.min(1, Math.exp(-d * d * 22) + Math.exp(-d * 6.5) * 0.16 * (1 - smooth(0.6, 1, d)));
    // the very core burns out towards white
    const w = Math.exp(-d * d * 90) * 0.75;
    img.data[o] = 255 * (r / 255 * (1 - w) + w); img.data[o + 1] = 255 * (g / 255 * (1 - w) + w); img.data[o + 2] = 255 * (b / 255 * (1 - w) + w); img.data[o + 3] = 255 * a;
  }
  x.putImageData(img, 0, 0);
  return canvasTexture(c);
}
// size = diameter of the visible glow in metres (before bloom); boost > 1 makes the source overexpose, so the post pass blooms it
function glowSprite(color, size, parent, x, y, z, rgb = '255,255,255', boost = 4) {
  if (!_glowTex[rgb]) _glowTex[rgb] = lightTexture(rgb);
  const col = new THREE.Color(color).multiplyScalar(boost);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: _glowTex[rgb], color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.position.set(x, y, z); s.scale.setScalar(size * 0.5);
  s.userData.boost = boost;
  parent.add(s);
  return s;
}
