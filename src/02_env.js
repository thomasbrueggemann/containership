// ============================================================================
// 02 — ENVIRONMENT: sky, clouds, stars, lights, fog, ocean shader, wakes
// ============================================================================
const TOD = {
  morning: { elev: 13, az: 128, turb: 4.5, ray: 1.25, mie: 0.004, g: 0.8, fog: 0x9fb0bd, fogD: 0.000048,
    sun: 3.4, sunCol: 0xfff0dc, hemiSky: 0xbcd3e6, hemiGnd: 0x3d4247, hemi: 0.9, exposure: 0.55,
    deep: [0.018, 0.05, 0.065], cloud: 0.42, night: false, bg: 1.0 },
  golden: { elev: 3.2, az: 258, turb: 7.5, ray: 2.4, mie: 0.007, g: 0.88, fog: 0xb99a82, fogD: 0.00005,
    sun: 2.6, sunCol: 0xffb36b, hemiSky: 0xd9b7a0, hemiGnd: 0x3b3430, hemi: 0.75, exposure: 0.6,
    deep: [0.02, 0.04, 0.05], cloud: 0.48, night: false, bg: 1.0 },
  night: { elev: -16, az: 220, moonElev: 26, moonAz: 160, turb: 2, ray: 0.6, mie: 0.003, g: 0.8, fog: 0x06090d, fogD: 0.00006,
    sun: 0.32, sunCol: 0x9db3d8, hemiSky: 0x1d2b3d, hemiGnd: 0x050709, hemi: 0.45, exposure: 1.0,
    deep: [0.004, 0.008, 0.012], cloud: 0.35, night: true, bg: 1.0 },
};
let ENV = null; // { preset, sunDir, sun, hemi, envMap, cubeRT, water, ... }

function buildEnvironment() {
  const P = TOD[CFG.tod];
  const sunDir = new THREE.Vector3();
  const lightElev = P.night ? P.moonElev : P.elev, lightAz = P.night ? P.moonAz : P.az;
  sunDir.setFromSphericalCoords(1, (90 - lightElev) * DEG, lightAz * DEG);
  sunDir.set(Math.sin(lightAz * DEG) * Math.cos(lightElev * DEG), Math.sin(lightElev * DEG), -Math.cos(lightAz * DEG) * Math.cos(lightElev * DEG));
  const skySunDir = new THREE.Vector3(Math.sin(P.az * DEG) * Math.cos(P.elev * DEG), Math.sin(P.elev * DEG), -Math.cos(P.az * DEG) * Math.cos(P.elev * DEG));

  // ---- sky scene rendered once into a cube map
  const skyScene = new THREE.Scene();
  const sky = new Sky(); sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = P.turb; u.rayleigh.value = P.ray; u.mieCoefficient.value = P.mie; u.mieDirectionalG.value = P.g;
  u.sunPosition.value.copy(skySunDir);
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

  // clouds
  const cloudMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false,
    uniforms: { sunDir: { value: skySunDir.clone() }, lightDir: { value: sunDir.clone() }, cover: { value: P.cloud }, night: { value: P.night ? 1 : 0 },
      sunCol: { value: new THREE.Color(P.sunCol) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 sunDir; uniform vec3 lightDir; uniform float cover; uniform float night; uniform vec3 sunCol;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<6;i++){ s+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        if (d.y < 0.0) discard;
        vec2 p = d.xz / (d.y + 0.06);
        float base = fbm(p*0.9 + vec2(4.0, 1.3));
        float det = fbm(p*3.7 + vec2(-2.0, 7.0));
        float c = smoothstep(1.0-cover, 1.0-cover+0.28, base*0.8 + det*0.32);
        float streak = smoothstep(0.55, 0.9, fbm(vec2(p.x*0.35, p.y*2.2)+3.0)) * 0.35;
        c = max(c, streak * smoothstep(0.1,0.4,d.y));
        float hz = smoothstep(0.0, 0.10, d.y);
        float toward = pow(max(dot(d, normalize(sunDir)), 0.0), 5.0);
        float thick = smoothstep(0.3, 1.0, det);
        vec3 lit = mix(vec3(0.95,0.96,1.0)*0.92, sunCol*1.25, 0.25 + 0.6*toward);
        vec3 shade = vec3(0.52,0.56,0.63);
        vec3 col = mix(lit, shade, thick*0.55);
        col *= mix(1.0, 0.018, night);
        col = mix(col, col*vec3(1.0,0.92,0.85), step(0.5, 1.0-night) * (1.0 - smoothstep(0.02, 0.3, sunDir.y)) * 0.6);
        gl_FragColor = vec4(col, c*hz*0.9);
      }`,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1500, 64, 32), cloudMat);
  skyScene.add(clouds);

  if (P.night) {
    const n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const R = mulberry32(42);
    for (let i = 0; i < n; i++) {
      const th = R() * Math.PI * 2, y = Math.pow(R(), 0.7);
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * r * 1400, y * 1400, Math.sin(th) * r * 1400], i * 3);
      const b = 0.08 + Math.pow(R(), 8) * 1.6; const t = R();
      col.set([b * (0.85 + t * 0.15), b * 0.9, b * (1.0 - t * 0.12)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    skyScene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.1, sizeAttenuation: false, vertexColors: true, depthWrite: false })));
    // moon
    const moon = new THREE.Mesh(new THREE.CircleGeometry(22, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.35, 2.2) }));
    moon.position.copy(sunDir).multiplyScalar(1350); moon.lookAt(0, 0, 0);
    skyScene.add(moon);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('170,190,220'), color: 0x445566, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.copy(moon.position); halo.scale.setScalar(260); skyScene.add(halo);
  }

  const cubeRT = new THREE.WebGLCubeRenderTarget(CFG.quality === 'low' ? 512 : 1024, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(1, 6000, cubeRT);
  if (P.night) u.rayleigh.value = P.ray;
  cubeCam.update(renderer, skyScene);
  scene.background = cubeRT.texture;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromCubemap(cubeRT.texture);
  scene.environment = envRT.texture;
  renderer.toneMappingExposure = P.exposure;
  scene.fog = new THREE.FogExp2(P.fog, P.fogD);

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

  ENV = { P, sunDir, skySunDir, sun, hemi, cubeRT, envMap: envRT.texture, night: P.night };
  buildOcean();
  return ENV;
}

// ---------------------------------------------------------------- swell
// A few long-crested wave trains running downwind. The same function displaces the water mesh
// (GPU), floats wakes and foam, and moves the ship, small craft and buoys (CPU), so they all ride
// the same waves. Waves fade out with distance from the camera (the far sea keeps its shading)
// and are much reduced inside the breakwaters.
const SWELL = {
  TRAINS: [[175, 0, 1.0, 0.3], [128, 22, 0.8, 2.1], [96, -18, 0.6, 4.0], [72, 40, 0.45, 5.2]], // λ [m], Δdir [°], weight, phase
  waves: [], cam: new THREE.Vector3(),
  U: { uSwA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uSwB: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uSwAmp: { value: 0 } },
  GLSL: `
    uniform vec4 uSwA[4]; uniform vec4 uSwB[4]; uniform float uSwAmp;
    // xyz = height, d/dx, d/dz at world p, faded with distance from the camera
    vec3 swell(vec2 p, float dist, float t){
      vec3 r = vec3(0.0);
      float sh = uSwAmp * (1.0 - 0.85 * smoothstep(-3200.0, -2500.0, p.x));
      for (int i = 0; i < 4; i++) {
        vec4 a = uSwA[i], b = uSwB[i];
        float A = b.x * sh * (1.0 - smoothstep(b.z * 8.0, b.z * 25.0, dist));
        float ph = a.z * dot(a.xy, p) - a.w * t + b.y;
        r.x += A * sin(ph); r.yz += a.xy * (a.z * A * cos(ph));
      }
      return r;
    }`,
  // windTo: direction the wind blows towards, world-frame angle as used by the ocean shader
  init(windAng) {
    this.waves = this.TRAINS.map(([lam, dd, w, ph], i) => {
      const a = windAng + dd * DEG, k = 2 * Math.PI / lam;
      const W = { dx: Math.cos(a), dz: Math.sin(a), k, w: Math.sqrt(9.81 * k), wt: w, ph, lam };
      this.U.uSwA.value[i].set(W.dx, W.dz, k, W.w); this.U.uSwB.value[i].set(w, ph, lam, 0);
      return W;
    });
  },
  setAmp(a) { this.U.uSwAmp.value = a; },
  height(x, z, t = G.realT) {
    const sh = this.U.uSwAmp.value * (1 - 0.85 * smooth(-3200, -2500, x));
    if (!sh) return 0;
    const dist = Math.hypot(x - this.cam.x, z - this.cam.z);
    let h = 0;
    for (const W of this.waves) h += W.wt * sh * (1 - smooth(W.lam * 8, W.lam * 25, dist)) * Math.sin(W.k * (W.dx * x + W.dz * z) - W.w * t + W.ph);
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
  }]);
  uniforms.uEnv.value = ENV.cubeRT.texture;
  uniforms.uRipple.value = rippleNormalTexture();
  Object.assign(uniforms, SWELL.U);                 // shared with the wake material and the CPU
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true,
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      uniform float uTime;
      varying vec3 vWorld;
      ${SWELL.GLSL}
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        wp.y += swell(wp.xz, distance(wp.xz, cameraPosition.xz), uTime).x;
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
      uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uDeep; uniform vec3 uSkyAmb;
      varying vec3 vWorld;
      ${SWELL.GLSL}
      float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = h1(dot(i, vec2(1.0, 57.0))), b = h1(dot(i + vec2(1.0, 0.0), vec2(1.0, 57.0)));
        float c = h1(dot(i + vec2(0.0, 1.0), vec2(1.0, 57.0))), d = h1(dot(i + vec2(1.0, 1.0), vec2(1.0, 57.0)));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
      // tileable ripple slopes, three layers drifting with the wind at different speeds
      vec2 ripple(vec2 uv){ return texture2D(uRipple, uv).xy * 2.0 - 1.0; }
      void main(){
        #include <logdepthbuf_fragment>
        vec3 V = cameraPosition - vWorld; float dist = length(V); V /= dist;
        vec2 p = vWorld.xz;
        // world size of one pixel along the view – waves shorter than this are faded out (no aliasing)
        float pix = dist * 0.0017 / max(V.y, 0.06);
        // wind patches / cat's paws: slow large-scale modulation of the short waves
        float patchy = 0.45 + 1.1 * vn(p / 850.0 + uTime * vec2(0.0035, 0.002)) * (0.6 + 0.8 * vn(p / 230.0 - uTime * 0.005));
        // swell slope (matches the displaced geometry exactly)
        vec3 sw = swell(p, length(cameraPosition.xz - p), uTime);
        vec2 slope = sw.yz; float h = 0.0, hsq = 0.0, lost = 0.0;
        float wl = 170.0;
        for (int i = 0; i < 34; i++) {
          float fi = float(i);
          float spread = 0.55 + fi * 0.035;
          float a = uWindAng + (h1(fi * 3.17 + 1.3) - 0.5) * 2.0 * spread;
          vec2 dir = vec2(cos(a), sin(a));
          float k = 6.2831853 / wl;
          float w = sqrt(9.81 * k);
          float A = wl * 0.0088 * uSea * (i < 5 ? 0.85 : patchy);
          float fade = clamp((wl - 2.2 * pix) / (2.2 * pix), 0.0, 1.0);
          float ph = k * dot(dir, p) - w * uTime + h1(fi * 7.7) * 6.2831853;
          slope += dir * (k * A * cos(ph) * fade);
          float hs = A * sin(ph) * fade;
          h += hs; hsq += A * A * fade * 0.5;
          lost += k * k * A * A * 0.5 * (1.0 - fade);   // slope variance too fine to resolve -> roughness
          wl *= 0.845;
        }
        float rms = sqrt(hsq) + 1e-4;
        // drifting capillary / wind ripples (mip-mapped texture: fades out gracefully with distance)
        vec2 wd = vec2(cos(uWindAng), sin(uWindAng)), wp = vec2(-wd.y, wd.x);
        vec2 q = vec2(dot(p, wd), dot(p, wp));
        float rip = uSea * (0.55 + 0.45 * patchy);
        vec2 r1 = ripple(q / 47.0 - vec2(uTime * 0.045, 0.0));
        vec2 r2 = ripple(q.yx / 17.0 + vec2(uTime * 0.012, -uTime * 0.07));
        vec2 r3 = ripple(q / 6.3 - vec2(uTime * 0.16, uTime * 0.03));
        vec2 rs = r1 * 0.13 + r2 * 0.1 + r3 * 0.07;
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
          vec2 bl = vec2(0.0018 + 0.004 * uSea, 0.0);
          vec3 pl = (texture2D(uRefl, ruv).rgb * 2.0 + texture2D(uRefl, ruv + bl).rgb + texture2D(uRefl, ruv - bl).rgb
                   + texture2D(uRefl, ruv + bl.yx * 1.5).rgb + texture2D(uRefl, ruv - bl.yx * 1.5).rgb) / 6.0;
          refl = mix(pl, cubeRefl, 0.28);
        }
        float sunUp = clamp(uSunDir.y * 3.0, 0.0, 1.0);
        vec3 body = uDeep * (0.35 + 1.6 * sunUp) + uSkyAmb * 0.035;
        float crest = clamp(h / (rms * 2.4) * 0.5 + 0.5, 0.0, 1.0);
        // light scattering through the crests (green/teal)
        body += vec3(0.02, 0.075, 0.07) * pow(crest, 2.5) * sunUp * (0.4 + 0.6 * max(0.0, dot(-V, uSunDir)));
        vec3 col = mix(body, refl, clamp(F, 0.0, 1.0));
        float rough = min(mix(1500.0, 70.0, smoothstep(120.0, 7000.0, dist)), 1.0 / (0.0006 + lost * 1.6));
        float sd = max(dot(R, uSunDir), 0.0);
        col += uSunCol * (pow(sd, rough) * rough * 0.055 + pow(sd, 30.0) * 0.04) * step(0.0, uSunDir.y);
        // whitecaps on the steepest crests
        float capN = vn(p / 6.0 + uTime * 0.3) * vn(p / 23.0 - uTime * 0.05);
        float foam = smoothstep(1.7, 2.7, h / rms) * uCaps * smoothstep(0.15, 0.6, capN) * (1.0 - smoothstep(600.0, 4000.0, dist));
        col = mix(col, vec3(0.85, 0.88, 0.9) * (0.2 + 0.8 * sunUp) + uSkyAmb * 0.05, clamp(foam, 0.0, 0.85));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const water = new THREE.Mesh(CFG.quality === 'low' ? oceanGeometry(150, 200, 60000) : oceanGeometry(240, 360, 60000), mat);
  water.frustumCulled = false;
  water.renderOrder = -1;
  scene.add(water);
  ENV.water = water; ENV.waterMat = mat;
  ENV.foamTex = foamTexture();
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
  renderer.setRenderTarget(R.rt); renderer.clear(); renderer.render(scene, c); renderer.setRenderTarget(null);
  renderer.shadowMap.autoUpdate = true;
  renderer.clippingPlanes = clip;
  ENV.water.visible = true;
  if (Wake._mat) Wake._mat.visible = true;
}

// ---------------------------------------------------------------- wakes
// Ribbon of foam trailing a vessel; intensity from speed and propeller thrust.
class Wake {
  constructor(opts) {
    this.max = opts.max || 140; this.every = opts.every || 2.0; this.width = opts.width || 40; this.spread = opts.spread || 0.25;
    this.life = opts.life || 260; this.pts = []; this.acc = 0;
    const n = this.max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3); this.uv = new Float32Array(n * 2 * 2); this.al = new Float32Array(n * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.al, 1));
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, Wake.material());
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  static material() {
    if (Wake._mat) return Wake._mat;
    Wake._mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uFoam: { value: ENV.foamTex }, uLight: { value: new THREE.Color(ENV.night ? 0.05 : 0.95, ENV.night ? 0.06 : 0.97, ENV.night ? 0.07 : 1.0) }, uTime: { value: 0 }, ...SWELL.U },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float aAlpha; varying float vA; varying vec2 vW; varying vec2 vUv; uniform float uTime;
        ${SWELL.GLSL}
        // wakes and foam patches sit on the water surface wherever they are (also those carried by the ship)
        void main(){ vA = aAlpha; vUv = uv; vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xz;
          wp.y = 0.32 + swell(wp.xz, distance(wp.xz, cameraPosition.xz), uTime).x;
          gl_Position = projectionMatrix*viewMatrix*wp;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D uFoam; uniform vec3 uLight; uniform float uTime; varying float vA; varying vec2 vW; varying vec2 vUv;
        void main(){
          #include <logdepthbuf_fragment>
          float f = texture2D(uFoam, vW/38.0).r * 0.7 + texture2D(uFoam, vW/11.0 + vec2(uTime*0.01)).r * 0.6;
          float edge = 1.0 - pow(abs(vUv.x*2.0-1.0), 2.0);
          float a = clamp(f * vA * edge * 1.6, 0.0, 0.95);
          gl_FragColor = vec4(uLight, a);
          #include <colorspace_fragment>
        }`,
    });
    return Wake._mat;
  }
  // x,z = source point (stern), dirx/dirz = unit vector pointing aft, intensity 0..1
  update(dt, x, z, dirx, dirz, intensity) {
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
    for (let i = 0; i < this.max; i++) {
      const p = pts[Math.min(i, n - 1)];
      const w = this.width * (0.5 + p.age * this.spread / 10) * (i === 0 ? 0.6 : 1);
      const px = -p.dz, pz = p.dx; // perpendicular
      const o = i * 6;
      this.pos[o] = p.x + px * w; this.pos[o + 1] = 0.3; this.pos[o + 2] = p.z + pz * w;
      this.pos[o + 3] = p.x - px * w; this.pos[o + 4] = 0.3; this.pos[o + 5] = p.z - pz * w;
      this.uv[i * 4] = 0; this.uv[i * 4 + 1] = i; this.uv[i * 4 + 2] = 1; this.uv[i * 4 + 3] = i;
      const fade = i >= n ? 0 : Math.max(0, 1 - p.age / this.life) * p.a;
      this.al[i * 2] = fade; this.al[i * 2 + 1] = fade;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aAlpha.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
}

// small foam patch (bow wave, thruster wash, prop wash) attached to a parent
function foamPatch(parent, w, l, x, z, rotY = 0) {
  const g = new THREE.PlaneGeometry(w, l, 1, 1);
  g.rotateX(-Math.PI / 2);
  const al = new Float32Array(4).fill(0);
  g.setAttribute('aAlpha', new THREE.BufferAttribute(al, 1));
  const m = new THREE.Mesh(g, Wake.material());
  m.position.set(x, 0.35, z); m.rotation.y = rotY; m.renderOrder = 2;
  parent.add(m);
  m.setIntensity = (a) => { al.fill(a); g.attributes.aAlpha.needsUpdate = true; };
  return m;
}

// Sprite glow for lights (visible mostly at dusk/night)
const _glowTex = {};
function glowSprite(color, size, parent, x, y, z, rgb = '255,255,255') {
  if (!_glowTex[rgb]) _glowTex[rgb] = glowTexture(rgb);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: _glowTex[rgb], color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.position.set(x, y, z); s.scale.setScalar(size);
  parent.add(s);
  return s;
}
