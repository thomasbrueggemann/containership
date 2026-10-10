// ============================================================================
// 02a — ATMOSPHERE: sky-coloured aerial perspective, raymarched cloud dome, sun / moon / stars
//   * every fogged material blends towards the baked sky colour *in the direction it is seen*, so the
//     haze matches the sky behind it (and warms up towards the sun) instead of one flat fog colour
//   * clouds are drawn live (they drift) as a volumetric layer between 1.3 and 2.5 km plus a thin cirrus
//     sheet; sun and moon are crisp analytic discs. The static sky cube only holds the clear sky.
// ============================================================================
const ATMOS = {
  U: { uFogEnv: { value: null }, uFogK: { value: 1 }, uGrunge: { value: null }, uGrungeK: { value: 1 }, uGlassDirt: { value: 0.45 }, uDirt: { value: null } },
  patched: false,
  // --- fog: sample the sky cube in the view direction
  patchFog() {
    if (this.patched) return; this.patched = true;
    this.flatFog = /[?&]fog=flat/.test(location.search);
    const C = THREE.ShaderChunk;
    C.fog_pars_vertex = `#ifdef USE_FOG\n varying float vFogDepth; varying vec3 vFogDir;\n#endif`;
    C.fog_vertex = `#ifdef USE_FOG\n vFogDepth = - mvPosition.z; vFogDir = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;\n#endif`;
    C.fog_pars_fragment = `#ifdef USE_FOG
      uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogDir; uniform samplerCube uFogEnv; uniform float uFogK;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear; uniform float fogFar;
      #endif
    #endif`;
    if (this.flatFog) C.fog_pars_fragment = '#define FLAT_FOG\n' + C.fog_pars_fragment;
    C.fog_fragment = `#ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp( - fogDensity * fogDensity * uFogK * uFogK * vFogDepth * vFogDepth );
      #else
        float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
      #endif
      vec3 fogDirN = normalize(vFogDir);
      #ifdef FLAT_FOG
        vec3 fogSky = fogColor;
      #else
        vec3 fogSky = textureLod(uFogEnv, vec3(fogDirN.x, max(fogDirN.y, 0.0) + 0.012, fogDirN.z), 0.0).rgb;
      #endif
      gl_FragColor.rgb = mix( gl_FragColor.rgb, fogSky, fogFactor );
    #endif`;
    const hook = function (shader) {
      if (this && this.userData && this.userData.glassDirt) { if (!/[?&]glassdirt=off/.test(location.search)) shader.fragmentShader = '#define GLASS_DIRT\n' + shader.fragmentShader; }
      else if (CFG.quality === 'low' || /[?&]grunge=off/.test(location.search)) shader.fragmentShader = '#define NO_GRUNGE\n' + shader.fragmentShader;      // weathering costs four volume lookups per pixel: skipped on the low setting
      shader.uniforms.uFogEnv = ATMOS.U.uFogEnv; shader.uniforms.uFogK = ATMOS.U.uFogK;
      if (ATMOS.U.uGrunge.value && shader.fragmentShader.includes('#include <roughnessmap_fragment>') && !shader.skinning && !(this && this.userData && this.userData.noGrunge)) ATMOS.grunge(shader, this);
    };
    ATMOS.hook = hook;
    THREE.Material.prototype.onBeforeCompile = hook;
    THREE.Material.prototype.customProgramCacheKey = function () { const u = this.userData; return u && u.glassDirt ? 'glass' : u && u.grunge !== undefined ? 'g' + u.grunge : ''; };
  },
  // Object-space "grunge" for every lit material: broad stains, mid-scale mottling, vertical rain streaks on walls,
  // and matching roughness changes – the difference between painted CG and weathered steel and concrete.
  // Object space (not world space) so it stays put on the moving ship and on every container instance.
  grunge(shader, mat) {
    shader.uniforms.uGrunge = ATMOS.U.uGrunge; shader.uniforms.uGrungeK = ATMOS.U.uGrungeK;
    const gScale = mat && mat.userData && mat.userData.grunge !== undefined ? mat.userData.grunge : 1;        // 1 = full weathering; a cleaned interior asks for less (userData.grunge)
    if (ENV.night) for (const k in LAMPS.U) shader.uniforms[k] = LAMPS.U[k];
    shader.uniforms.uGlassDirt = ATMOS.U.uGlassDirt; shader.uniforms.uDirt = ATMOS.U.uDirt; const glass = !!(mat && mat.userData && mat.userData.glassDirt);
    const far = FARSHADOW.wantMat && FARSHADOW.lightsChunk();                                     // the port's shadow, multiplied into the sun's (see 02f)
    if (far) Object.assign(shader.uniforms, FARSHADOW.U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLP; varying vec3 vLN; varying vec3 vWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 lp_ = vec4(transformed, 1.0); vec3 ln_ = objectNormal;
          #ifdef USE_INSTANCING
            lp_ = instanceMatrix * lp_; ln_ = mat3(instanceMatrix) * ln_;
          #endif
          vLP = lp_.xyz; vLN = ln_; vWP = (modelMatrix * lp_).xyz; }`);
    shader.fragmentShader = (ENV.night ? '#define USE_LAMPS\n' : '') + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler3D;
        uniform sampler3D uGrunge; uniform sampler2D uDirt; uniform float uGrungeK, uGlassDirt; varying vec3 vLP; varying vec3 vLN; varying vec3 vWP;
        #ifdef USE_LAMPS
          uniform int uLampN; uniform vec4 uLampPos[10]; uniform vec4 uLampCol[10]; uniform vec4 uLampDir[10];
        #endif
        float gnz(float v){ return clamp((v - 0.3) * 2.6, 0.0, 1.0); }
        ${far ? FARSHADOW.GLSL : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifndef NO_GRUNGE
        float gM = 0.5, grime = 0.5;
        if (uGrungeK > 0.0) {                                  // (switched off for the mirrored scene of the planar reflection)
          float gL = gnz(texture(uGrunge, vLP * 0.013).g);
          gM = gnz(texture(uGrunge, vLP * 0.11 + vec3(0.37, 0.11, 0.7)).b);
          // the 1 m detail and the rain streaks are invisible (and would only alias) beyond ~70 m: skip their lookups
          float gS = 0.5, gV = 0.5;
          if (dot(vViewPosition, vViewPosition) < 4900.0) {
            gS = gnz(texture(uGrunge, vLP * 0.9 + vec3(0.13, 0.71, 0.29)).a);
            gV = gnz(texture(uGrunge, vec3(vLP.x + vLP.z * 0.7, vLP.y * 0.09, vLP.z - vLP.x * 0.4) * 0.36 + 0.5).g);
          }
          float gVert = smoothstep(0.5, 0.9, 1.0 - abs(normalize(vLN).y));
          grime = gL * 0.5 + gM * 0.3 + gS * 0.2;
          diffuseColor.rgb *= 1.0 - uGrungeK * ${gScale.toFixed(2)} * (0.26 * smoothstep(0.3, 1.0, grime) + gVert * 0.2 * smoothstep(0.5, 0.95, gV) - 0.07 * (gS - 0.5));
        }
        #endif
        #ifdef GLASS_DIRT
          diffuseColor.rgb = vec3(0.8, 0.88, 0.9);          // undo the darkening above: salt on glass is pale
          vec3 dm = texture(uDirt, vLP.xy * 0.45 + vec2(0.3, 0.7)).rgb;       // panes are planes: their own x/y are the glass
          float dirt = clamp(dm.r * 0.9 + dm.g * 0.05 + dm.b * 0.5, 0.0, 1.0) * uGlassDirt;        // (the broad blotches read as camouflage paint on a window seen at an angle: kept as a faint haze)
          diffuseColor.a = clamp(diffuseColor.a + dirt * 0.4, 0.0, 1.0);
        #endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        #ifndef NO_GRUNGE
        roughnessFactor = clamp(roughnessFactor * (1.0 + uGrungeK * (0.35 * (gM - 0.5) + 0.25 * grime)), 0.04, 1.0);
        #endif`)
      .replace('#include <lights_fragment_begin>', far ? FARSHADOW.lightsChunk() : '#include <lights_fragment_begin>')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #ifdef USE_LAMPS
        for (int li = 0; li < 10; li++) {
          if (li >= uLampN) break;
          vec3 toL = uLampPos[li].xyz - vWP; float d2 = dot(toL, toL), dl = sqrt(d2); toL /= dl;
          float rng = uLampPos[li].w;
          float cone = smoothstep(uLampDir[li].w, mix(uLampDir[li].w, 1.0, 0.45), dot(-toL, uLampDir[li].xyz));
          float att = (1.0 / (1.0 + d2 * (6.0 / (rng * rng)))) * (1.0 - smoothstep(0.5 * rng, rng, dl)) * cone;
          if (att > 0.002) {
            IncidentLight lampL; lampL.direction = normalize((viewMatrix * vec4(toL, 0.0)).xyz); lampL.color = uLampCol[li].rgb * att; lampL.visible = true;
            RE_Direct(lampL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
          }
        }
        #endif`);
  },
  // renders a fragment shader (vUv in 0..1) once into a mip-mapped, repeating 2D texture
  bake2D(size, frag) {
    const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping; rt.texture.anisotropy = 8;
    const m = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: frag });
    const quad = new THREE.Mesh(new THREE.BufferGeometry(), m);
    quad.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)); quad.frustumCulled = false;
    const sc = new THREE.Scene(); sc.add(quad); const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt); renderer.render(sc, new THREE.Camera()); renderer.setRenderTarget(prev);
    m.dispose(); quad.geometry.dispose();
    return rt.texture;
  },
  // 64³ tileable noise on the GPU: r = Perlin-Worley, g/b/a = Worley fbm at increasing frequency
  makeNoise3D() {
    const N = CFG.quality === 'low' ? 48 : 96;
    const rt = new THREE.WebGL3DRenderTarget(N, N, N);
    rt.depthBuffer = false;
    const t3 = rt.texture;                                   // (WebGL3DRenderTarget ignores constructor options: nearest filtering by default)
    t3.minFilter = t3.magFilter = THREE.LinearFilter; t3.wrapR = t3.wrapS = t3.wrapT = THREE.RepeatWrapping;
    const m = new THREE.ShaderMaterial({
      uniforms: { uZ: { value: 0 } }, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform float uZ; varying vec2 vUv;
        vec3 h33(vec3 p){ p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return fract(sin(p) * 43758.5453123); }
        float perlin(vec3 p, float per){
          vec3 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
          float v[8];
          for (int k = 0; k < 8; k++) {
            vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
            vec3 g = normalize(h33(mod(i + o, per)) * 2.0 - 1.0);
            v[k] = dot(g, f - o);
          }
          return mix(mix(mix(v[0], v[1], u.x), mix(v[2], v[3], u.x), u.y), mix(mix(v[4], v[5], u.x), mix(v[6], v[7], u.x), u.y), u.z);
        }
        float worley(vec3 p, float per){
          vec3 i = floor(p), f = fract(p); float d = 1e3;
          for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
            vec3 n = vec3(float(x), float(y), float(z));
            vec3 df = n + h33(mod(i + n, per)) - f; d = min(d, dot(df, df));
          }
          return sqrt(d);
        }
        float wfbm(vec3 p, float f){ return (1.0 - worley(p * f, f)) * 0.625 + (1.0 - worley(p * f * 2.0, f * 2.0)) * 0.25 + (1.0 - worley(p * f * 4.0, f * 4.0)) * 0.125; }
        float pfbm(vec3 p, float f){ return perlin(p * f, f) * 0.5 + perlin(p * f * 2.0, f * 2.0) * 0.25 + perlin(p * f * 4.0, f * 4.0) * 0.125 + perlin(p * f * 8.0, f * 8.0) * 0.0625; }
        void main(){
          vec3 p = vec3(vUv, uZ);
          float pw = clamp(pfbm(p, 4.0) * 1.35 + 0.5, 0.0, 1.0);
          float w1 = wfbm(p, 4.0);
          pw = clamp((pw - (1.0 - w1) * 0.55) / (1.0 - (1.0 - w1) * 0.55), 0.0, 1.0);
          gl_FragColor = vec4(pw, w1, wfbm(p, 6.0), wfbm(p, 8.0));
        }`,
    });
    const quad = new THREE.Mesh(new THREE.BufferGeometry(), m);
    quad.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    quad.frustumCulled = false;
    const sc = new THREE.Scene(); sc.add(quad);
    const cam = new THREE.Camera(), prev = renderer.getRenderTarget();
    for (let z = 0; z < N; z++) { m.uniforms.uZ.value = (z + 0.5) / N; renderer.setRenderTarget(rt, z); renderer.render(sc, cam); }
    // CPU copy of the volume (the sun's visibility through the clouds is evaluated on the CPU, see CLOUDS): the same
    // layers drawn side by side into one 2D atlas, read back with a single call
    {
      const cols = 12, rows = Math.ceil(N / cols), at = new THREE.WebGLRenderTarget(cols * N, rows * N, { type: THREE.UnsignedByteType, depthBuffer: false });
      const ac = renderer.autoClear; renderer.autoClear = false;
      for (let z = 0; z < N; z++) { at.viewport.set((z % cols) * N, ((z / cols) | 0) * N, N, N); m.uniforms.uZ.value = (z + 0.5) / N; renderer.setRenderTarget(at); renderer.render(sc, cam); }      // (the viewport is read at setRenderTarget)
      const buf = new Uint8Array(cols * N * rows * N * 4); renderer.readRenderTargetPixels(at, 0, 0, cols * N, rows * N, buf);
      renderer.autoClear = ac; at.dispose();
      CLOUDS.set(buf, N, cols);
    }
    renderer.setRenderTarget(prev);
    m.dispose(); quad.geometry.dispose();
    // salt-spray mask for the bridge glass (tileable, 2.2 m per tile): r = fine speckle, g = blotches, b = vertical streaks
    this.U.uDirt.value = this.bake2D(512, `
      varying vec2 vUv;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p, vec2 per){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(mod(i, per)), h21(mod(i + vec2(1, 0), per)), f.x), mix(h21(mod(i + vec2(0, 1), per)), h21(mod(i + vec2(1, 1), per)), f.x), f.y); }
      float fbm(vec2 p, vec2 per){ return vn(p * per, per) * 0.5 + vn(p * per * 2.0, per * 2.0) * 0.25 + vn(p * per * 4.0, per * 4.0) * 0.125 + vn(p * per * 8.0, per * 8.0) * 0.0625; }
      void main(){
        float sp = smoothstep(0.88, 1.15, fbm(vUv, vec2(46.0)) * 1.55 - 0.05);          // sparse specks: a clean pane with spray on it, not a pane that is all dirt
        float bl = smoothstep(0.5, 0.95, fbm(vUv, vec2(3.0)) * 1.55 - 0.05);
        float st = smoothstep(0.85, 1.15, fbm(vUv, vec2(6.0, 1.0)) * 1.55 - 0.05);
        gl_FragColor = vec4(sp, bl, st, 1.0);
      }`);
    return rt;
  },
  // dome: clouds + sun/moon discs + stars, drawn over the sky cube. P = TOD preset.
  buildDome(P, sunDir, skySunDir) {
    const steps = CFG.quality === 'high' ? 20 : CFG.quality === 'medium' ? 12 : 6;
    const night = P.night;
    const sunLight = new THREE.Color(P.sunCol).multiplyScalar(P.sun * (night ? 1.0 : 1.5));
    const lsteps = CFG.quality === 'low' ? 0 : 3;
    const uniforms = {                                       // shared by the three variants below, so one set of updates drives them all
      tNoise: { value: this.noise.texture }, uTime: { value: 0 }, uSunDir: { value: skySunDir.clone() }, uLightDir: { value: sunDir.clone() },
      uSunRad: { value: sunLight }, uAmb: { value: new THREE.Color(P.hemiSky).multiplyScalar(night ? 0.012 : 0.55) },
      uFogEnv: ATMOS.U.uFogEnv, uFrame: { value: 0 }, uCover: { value: P.cloud }, uWind: { value: new THREE.Vector2(9, 4) }, uDens: { value: P.fogD }, uHorizon: { value: new THREE.Color(P.fog) },
      uSunDisc: { value: night ? 0 : 1 }, uMoon: { value: night ? 1 : 0 }, uSteps: { value: steps }, uLSteps: { value: lsteps },
      tClouds: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uAcc: { value: 0 },        // uAcc: how much of the clouds' temporal accumulation (see POST) can be trusted: 0 = filter the raw march spatially
      uPortPos: { value: new THREE.Vector2(150, -1100) }, uPortGlow: { value: night ? 1 : 0 },       // the terminal's lights on the underside of the clouds over it
    };
    const vertexShader = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 p = projectionMatrix * viewMatrix * w; gl_Position = p.xyww; }`;
    const fragmentShader = `
        precision highp sampler3D;
        uniform samplerCube uFogEnv;
        uniform sampler3D tNoise; uniform float uTime, uCover, uDens, uSunDisc, uMoon, uSteps, uLSteps, uPortGlow, uFrame, uAcc; uniform vec2 uPortPos; uniform vec3 uSunDir, uLightDir, uSunRad, uAmb, uHorizon; uniform vec2 uWind;
        #ifdef PASS_SKY
          uniform sampler2D tClouds; uniform vec2 uRes;
        #endif
        varying vec3 vW;
        const float H0 = 1300.0, H1 = 2500.0;
        float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        float hg(float c, float g){ float g2 = g * g; return (1.0 - g2) / (12.566371 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
        float remap(float v, float a, float b, float c, float d){ return c + (clamp(v, a, b) - a) / (b - a) * (d - c); }
        // channels of the noise volume are not normalised (r mean .3 / p95 .69, g,b,a mean .48 ± .1): stretch them to 0..1
        float nz(float v){ return clamp((v - 0.3) * 2.6, 0.0, 1.0); }
        // density of the cumulus layer at world position p
        float dens(vec3 p, float hf, float lod){
          vec3 q = p + vec3(uWind.x, 0.0, uWind.y) * uTime;
          float cm = texture(tNoise, vec3(q.xz * (1.0 / 52000.0), 0.31)).r;
          float thr = mix(0.62, 0.12, uCover);
          float cov = smoothstep(thr - 0.10, thr + 0.12, cm);
          float prof = smoothstep(0.0, 0.08, hf) * smoothstep(1.0, 0.5, hf);
          vec4 n = texture(tNoise, vec3(q.xz * (1.0 / 5600.0), hf * 0.3 + 0.1));
          float shape = clamp(n.r * 1.5, 0.0, 1.0) * 0.6 + nz(n.g) * 0.4;
          float d = clamp((shape * prof - (1.0 - cov) * 0.5) / 0.5, 0.0, 1.0);
          if (lod < 0.5 && d > 0.0) {
            vec4 e = texture(tNoise, q * (1.0 / 850.0));
            float er = nz(e.g) * 0.5 + nz(e.b) * 0.3 + nz(e.a) * 0.2;
            d = clamp((d - er * 0.45 * (1.15 - hf * 0.5)) / (1.0 - er * 0.45), 0.0, 1.0);
          }
          return d;
        }
        void main(){
          vec3 rd = normalize(vW - cameraPosition);
          vec3 col = vec3(0.0); float T = 1.0;
          float h0 = max(cameraPosition.y, 0.0);
          #ifdef PASS_SKY
            // the clouds were marched at half resolution: four bilinear taps average exactly one 4×4 period of the march's Bayer jitter
            vec2 uvs = gl_FragCoord.xy / uRes, tx = 1.0 / vec2(textureSize(tClouds, 0));
            vec4 cl;
            if (uAcc > 0.999) cl = texture(tClouds, uvs);                                       // (accumulated over time: the jitter has averaged out already)
            else {
              cl = 0.25 * (texture(tClouds, uvs + tx * vec2(-1.0, -1.0)) + texture(tClouds, uvs + tx * vec2(1.0, -1.0)) + texture(tClouds, uvs + tx * vec2(-1.0, 1.0)) + texture(tClouds, uvs + tx));
              if (uAcc > 0.0) cl = mix(cl, texture(tClouds, uvs), uAcc);
            }
            col = cl.rgb; T = 1.0 - cl.a;
          #else
          if (rd.y > 0.012) {
            // the haze the distant clouds fade into is the colour of the sky itself at that elevation (the same sun-less sky the fog uses), so no band shows
            // where the clouds stop at the horizon
            vec3 hz = textureLod(uFogEnv, vec3(rd.x, max(rd.y, 0.0) + 0.012, rd.z), 0.0).rgb;
            float hzf = smoothstep(0.012, 0.05, rd.y);                     // the clouds fade in over the first three degrees: no edge where they begin
            // ---- cumulus layer
            float t0 = (H0 - h0) / rd.y, t1 = (H1 - h0) / rd.y;
            float dt = (t1 - t0) / uSteps;
            ivec2 bp = ivec2(gl_FragCoord.xy) & 3;                 // 4×4 Bayer: the composite pass averages exactly these 16 phases
            const float bay[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
            float jit = fract((bay[bp.y * 4 + bp.x] + 0.5) / 16.0 + uFrame * 0.61803398875);        // (uFrame: a different phase each frame while the clouds are accumulated over time, else 0)
            float cosT = dot(rd, uLightDir);
            float ph = mix(hg(cosT, 0.62), hg(cosT, -0.28), 0.3) * 4.0;
            vec3 sunCol = uSunRad;
            for (int i = 0; i < STEPS; i++) {
              if (float(i) >= uSteps) break;
              float t = t0 + dt * (float(i) + jit);
              vec3 p = cameraPosition + rd * t; float hf = (p.y - H0) / (H1 - H0);
              float d = dens(p, hf, 0.0);
              if (d > 0.005) {
                float sig = d * dt * 0.012;
                float ls = 0.0;
                #if LSTEPS > 0
                  for (int k = 1; k <= LSTEPS; k++) { if (float(k) > uLSteps) break; vec3 pl = p + uLightDir * (float(k) * 150.0); ls += dens(pl, clamp((pl.y - H0) / (H1 - H0), 0.0, 1.0), 1.0) * 150.0; }
                #endif
                float Tl = exp(-ls * 0.012);
                float powder = 1.0 - exp(-d * 2.2);
                vec3 lit = sunCol * (Tl * ph * mix(1.0, powder * 2.0, 0.55) + exp(-ls * 0.012 * 0.25) * 0.12 * hg(cosT * 0.5, 0.0) * 4.0);
                vec3 amb = uAmb * mix(0.45, 1.3, hf);
                if (uPortGlow > 0.0) {                       // sodium-orange light from the terminal's floodlights scattered back from the cloud base
                  float hd = length(p.xz - uPortPos);
                  amb += vec3(1.0, 0.56, 0.24) * (0.085 * exp(-hd / 6500.0) * (1.0 - 0.55 * hf) * (0.35 + 0.65 * powder)) * uPortGlow;
                }
                float ft = 1.0 - exp(-(t * uDens) * (t * uDens));
                vec3 sc = mix(lit + amb, hz, ft);
                float a = (1.0 - exp(-sig)) * hzf;
                col += T * sc * a;
                T *= 1.0 - a * (1.0 - 0.5 * ft);
                if (T < 0.01) break;
              }
            }
            // ---- cirrus: thin high sheet, streaky
            {
              float tc = (9500.0 - h0) / rd.y;
              vec3 p = cameraPosition + rd * tc; vec3 q = p + vec3(uWind.x * 2.2, 0.0, uWind.y * 2.2) * uTime;
              vec4 n = texture(tNoise, vec3(q.x * (1.0 / 38000.0), q.z * (1.0 / 9000.0), 0.55));
              vec4 m = texture(tNoise, vec3(q.xz * (1.0 / 90000.0), 0.8));
              float c = smoothstep(0.4, 0.8, nz(n.g) * 0.6 + nz(n.b) * 0.4) * smoothstep(0.18, 0.5, m.r);
              float ft = 1.0 - exp(-(tc * uDens * 0.5) * (tc * uDens * 0.5));
              vec3 sc = mix(uSunRad * (0.16 + 0.35 * hg(cosT, 0.7)) + uAmb * 0.5, hz, ft);
              float a = c * 0.5 * (1.0 - ft * 0.7) * hzf;
              col += T * sc * a; T *= 1.0 - a;
            }
          }
          #endif
          #ifndef PASS_CLOUDS
          // ---- sun disc (crisp) – blocked by cloud
          #if NIGHT == 0
            float cs = dot(rd, uSunDir);
            float disc = smoothstep(0.999957, 0.999972, cs);
            float limb = mix(0.6, 1.0, smoothstep(0.999957, 1.0, cs));
            vec3 sunDisc = uSunRad * 90.0 * disc * limb;
            // thin aureole
            sunDisc += uSunRad * (pow(max(cs, 0.0), 2200.0) * 1.6 + pow(max(cs, 0.0), 220.0) * 0.07);
            col += sunDisc * T * smoothstep(-0.01, 0.01, rd.y);
          #else
            // ---- moon with maria, and stars
            float cm = dot(rd, uLightDir);
            if (cm > 0.9995) {
              vec3 b1 = normalize(cross(uLightDir, vec3(0.0, 1.0, 0.0))), b2 = cross(uLightDir, b1);
              vec2 mp = vec2(dot(rd, b1), dot(rd, b2)) / 0.0105;
              float r2 = dot(mp, mp);
              if (r2 < 1.0) {
                float z = sqrt(1.0 - r2); vec3 nn = vec3(mp, z);
                vec4 nz = texture(tNoise, vec3(mp * 0.28 + 0.5, 0.2));
                float maria = smoothstep(0.42, 0.62, nz.g * 0.6 + nz.b * 0.5);
                float cr = texture(tNoise, vec3(mp * 0.9 + 0.5, 0.6)).a;
                float alb = mix(0.95, 0.45, maria) * (0.9 + 0.1 * cr);
                float lit = smoothstep(-0.15, 0.55, dot(nn, normalize(vec3(0.55, 0.35, 0.75))));
                col += vec3(1.0, 0.97, 0.9) * alb * (0.15 + lit) * 3.2 * T;
              }
            }
            col += vec3(0.55, 0.62, 0.8) * (pow(max(cm, 0.0), 90.0) * 0.07 + pow(max(cm, 0.0), 12.0) * 0.012) * T;
            if (rd.y > 0.0) {
              // the Milky Way: a diffuse band (great circle), mottled with star clouds and cut by dust lanes
              vec3 gn = normalize(vec3(0.36, 0.78, 0.51));
              float gb = dot(rd, gn);
              float bandW = exp(-(gb / 0.2) * (gb / 0.2)), core = exp(-(gb / 0.07) * (gb / 0.07));
              vec4 mw = texture(tNoise, rd * 1.6 + 0.3), mw2 = texture(tNoise, rd * 4.3 + 0.7);
              float dust = smoothstep(0.42, 0.62, mw.g * 0.6 + mw2.b * 0.5) * core;
              float glow = bandW * (0.35 + 0.9 * mw2.g) * (0.6 + 0.8 * mw.r) * (1.0 - 0.8 * dust);
              col += vec3(0.62, 0.68, 0.9) * glow * 0.022 * T * smoothstep(0.0, 0.25, rd.y);
              vec3 sp = rd * 260.0; vec3 cell = floor(sp); vec3 fr = fract(sp) - 0.5;
              vec3 hh = fract(sin(vec3(dot(cell, vec3(127.1, 311.7, 74.7)), dot(cell, vec3(269.5, 183.3, 246.1)), dot(cell, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
              float on = step(0.968 - 0.012 * bandW, hh.x);
              float tw = 0.75 + 0.25 * sin(uTime * (2.0 + hh.y * 5.0) + hh.z * 40.0);
              float sz = smoothstep(0.34, 0.0, length(fr - (hh - 0.5) * 0.5));
              float mag = pow(hh.y, 6.0) * 2.6 + 0.07;
              col += vec3(0.8 + hh.z * 0.2, 0.88, 1.0 - hh.z * 0.15) * on * sz * mag * tw * T * smoothstep(0.0, 0.12, rd.y);
            }
          #endif
          #endif
          float alpha = 1.0 - T;
          #ifdef DISPLAY_OUT
            // drawn straight onto an already tone-mapped canvas: tone-map the (un-premultiplied) cloud colour, then blend
            vec3 un = col / max(alpha, 1e-3);
            gl_FragColor = vec4(un, alpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            gl_FragColor.rgb *= alpha;
          #else
            gl_FragColor = vec4(col, alpha);
          #endif
        }`;
    const mk = (defs, extra = {}) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, side: THREE.BackSide, fog: false, uniforms, vertexShader, fragmentShader,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      defines: { STEPS: steps, LSTEPS: lsteps, NIGHT: night ? 1 : 0, ...defs }, ...extra,
    });
    // FULL marches the clouds itself, per screen pixel (used for the planar reflection and when there is no post pipeline).
    // With the HDR pipeline the clouds are marched into a half-resolution target first (CLOUDS) and the dome (SKY) only composites them
    // and draws the crisp objects (sun, moon, stars) at full resolution.
    const full = mk(POST.on ? {} : { DISPLAY_OUT: '' });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), full);
    const follow = (m) => { m.onBeforeRender = (r, s, cam) => { m.position.setFromMatrixPosition(cam.matrixWorld); m.updateMatrixWorld(); }; m.scale.setScalar(60000); m.frustumCulled = false; m.matrixAutoUpdate = true; };
    dome.userData = { steps, lsteps, full };
    follow(dome); dome.renderOrder = -10;
    if (POST.on && !/[?&]clouds=full/.test(location.search)) {
      dome.userData.cloudFrame = { value: 0 };                                  // (only the march into the cloud target varies its jitter from frame to frame; the planar reflection's own march must not shimmer)
      dome.userData.cloudMat = mk({ PASS_CLOUDS: '' }, { depthTest: false, blending: THREE.NoBlending, uniforms: { ...uniforms, uFrame: dome.userData.cloudFrame } });
      dome.userData.skyMat = mk({ PASS_SKY: '' });
      const cm = new THREE.Mesh(dome.geometry, dome.userData.cloudMat); follow(cm);
      dome.userData.cloudScene = new THREE.Scene(); dome.userData.cloudScene.add(cm);
      dome.material = dome.userData.skyMat;
    }
    return dome;
  },
};

// ============================================================================
// CLOUDS (CPU) — the cumulus density of the dome shader, evaluated in JavaScript on a copy of the noise volume.
// Used to find out how much of the sun reaches the ship, so that the light dims and returns as clouds drift over the sun
// (the dome draws the same clouds, so the disc and the light always agree), and to choose a start time with the sun out.
// ============================================================================
const CLOUDS = {
  N: 0, cols: 12, buf: null, H0: 1300, H1: 2500, wind: [9, 4], cover: 0.4, ext: 0.012,
  set(buf, N, cols) { this.buf = buf; this.N = N; this.cols = cols; },
  // trilinear sample (wrapping) of channel c at texture coordinates (s, t, r)
  vol(s, t, r, c) {
    const N = this.N, W = this.cols * N, b = this.buf;
    const x = s * N - 0.5, y = t * N - 0.5, z = r * N - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = x - x0, fy = y - y0, fz = z - z0;
    const at = (xi, yi, zi) => { xi = ((xi % N) + N) % N; yi = ((yi % N) + N) % N; zi = ((zi % N) + N) % N; return b[(((((zi / this.cols) | 0) * N + yi) * W) + (zi % this.cols) * N + xi) * 4 + c] / 255; };
    const l = (a, bb, k) => a + (bb - a) * k;
    return l(l(l(at(x0, y0, z0), at(x0 + 1, y0, z0), fx), l(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), fx), fy),
             l(l(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), fx), l(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), fx), fy), fz);
  },
  nz: (v) => Math.min(1, Math.max(0, (v - 0.3) * 2.6)),
  ss(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); },
  // coverage only (large-scale pattern): 0..1
  coverage(x, z, t) {
    const qx = x + this.wind[0] * t, qz = z + this.wind[1] * t, thr = 0.62 + (0.12 - 0.62) * this.cover;
    return this.ss(thr - 0.1, thr + 0.12, this.vol(qx / 52000, qz / 52000, 0.31, 0));
  },
  // same as dens(p, hf, lod = 1) in the dome shader
  dens(x, y, z, t) {
    const hf = (y - this.H0) / (this.H1 - this.H0); if (hf < 0 || hf > 1) return 0;
    const qx = x + this.wind[0] * t, qz = z + this.wind[1] * t;
    const cov = this.coverage(x, z, t);
    if (cov <= 0) return 0;
    const prof = this.ss(0, 0.08, hf) * this.ss(1, 0.5, hf);
    const sx = qx / 5600, sz = qz / 5600, r = hf * 0.3 + 0.1;
    const shape = Math.min(1, this.vol(sx, sz, r, 0) * 1.5) * 0.6 + this.nz(this.vol(sx, sz, r, 1)) * 0.4;
    return Math.min(1, Math.max(0, (shape * prof - (1 - cov) * 0.5) / 0.5));
  },
  // fraction of the direct light that reaches position p (world, metres) from direction sd (unit, y up) at cloud time t
  sunTransmittance(px, py, pz, sd, t) {
    if (!this.buf || sd.y < 0.03) return 1;
    const t0 = (this.H0 - Math.max(py, 0)) / sd.y, t1 = (this.H1 - Math.max(py, 0)) / sd.y, n = 14, dt = (t1 - t0) / n;
    let od = 0;
    for (let i = 0; i < n; i++) { const s = t0 + dt * (i + 0.5); od += this.dens(px + sd.x * s, py + sd.y * s, pz + sd.z * s, t) * dt; }
    return Math.exp(-od * this.ext);
  },
};

// ============================================================================
// EXHAUST — funnel smoke as a single Points draw: puffs are left behind in the air (world space), drift with the wind,
// rise, billow and thin out. Density follows engine load; colour follows the light.
// ============================================================================
class ExhaustPlume {
  constructor(n = 90) {
    this.n = n; this.i = 0; this.acc = 0;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.age = new Float32Array(n).fill(-1); this.seed = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    this.aAge = new THREE.BufferAttribute(new Float32Array(n), 1); g.setAttribute('aAge', this.aAge);
    this.aSeed = new THREE.BufferAttribute(this.seed, 1); g.setAttribute('aSeed', this.aSeed);
    this.aDens = new THREE.BufferAttribute(new Float32Array(n), 1); g.setAttribute('aDens', this.aDens);
    for (let k = 0; k < n; k++) this.seed[k] = Math.random();
    this.dens = new Float32Array(n);
    const night = ENV.night, base = night ? 0.025 : 0.2;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: { uSunV: { value: new THREE.Vector3(0, 1, 0) }, uSunE: { value: new THREE.Color() }, uSky: { value: new THREE.Color(ENV.P.fog).multiplyScalar(0.9) }, tNoise: { value: ATMOS.noise.texture }, uCol: { value: new THREE.Color(base, base * 0.97, base * 0.93) }, uLit: { value: new THREE.Color(night ? 0.04 : 0.62, night ? 0.04 : 0.6, night ? 0.045 : 0.57) }, uScale: { value: 1 }, ...THREE.UniformsLib.fog },
      vertexShader: `
        #include <common>
        #include <fog_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        attribute float aAge, aSeed, aDens; uniform float uScale; varying float vAge, vSeed, vDens; varying vec3 vMV;
        void main(){
          vAge = aAge; vSeed = aSeed; vDens = aDens;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vMV = mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp((4.0 + aAge * 1.9) * uScale * projectionMatrix[1][1] * 0.5 * resolution_y / max(-mvPosition.z, 1.0), 0.0, 900.0);
          if (aAge < 0.0) gl_PointSize = 0.0;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`.replace('resolution_y', 'viewportH'),
      fragmentShader: `
        precision highp sampler3D;
        #include <common>
        #include <fog_pars_fragment>
        #include <logdepthbuf_pars_fragment>
        uniform sampler3D tNoise; uniform vec3 uCol, uLit, uSunV, uSunE, uSky; varying float vAge, vSeed, vDens; varying vec3 vMV;
        void main(){
          #include <logdepthbuf_fragment>
          vec2 q = gl_PointCoord * 2.0 - 1.0; float r = length(q);
          if (r > 1.0) discard;
          vec4 n = texture(tNoise, vec3(q * 0.4 + vSeed * 7.0, vSeed + vAge * 0.02)), n2 = texture(tNoise, vec3(q * 1.15 + vSeed * 3.0, vSeed * 2.0 + vAge * 0.05));
          float edge = (1.0 - r) * (0.35 + 1.2 * n.g) - 0.42 * n2.b - 0.12 * n2.a;
          float a = smoothstep(0.0, 0.45, edge) * vDens * (1.0 - smoothstep(14.0, 42.0, vAge)) * smoothstep(0.0, 1.5, vAge);
          // lit like a lump of smoke: a pseudo-normal from the puff's disc, the sun's own colour and direction (view space) on its sunny side, the sky on
          // the other; dark soot while it is young, paler as it dilutes; thin edges lit from behind glow (forward scattering)
          vec3 nrm = normalize(vec3(q, sqrt(max(1.0 - r * r, 0.0)) * 0.8 + n.g * 0.3));
          float wrapL = clamp(dot(nrm, uSunV) * 0.5 + 0.5, 0.0, 1.0);
          float alb = mix(0.12, 0.45, smoothstep(0.0, 24.0, vAge));
          vec3 vd = normalize(vMV);
          float fs = pow(max(dot(vd, uSunV), 0.0), 5.0) * (1.0 - smoothstep(0.0, 0.7, a));
          vec3 col = alb * (uSky * (0.55 + 0.45 * (nrm.y * 0.5 + 0.5)) + uSunE * (wrapL * wrapL * 0.95 + fs * 1.4));
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mat.uniforms.viewportH = { value: 800 };
    this.mat.vertexShader = 'uniform float viewportH;\n' + this.mat.vertexShader;
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 4;
    scene.add(this.pts);
  }
  // the sun's direction in view space and its colour as radiance for a diffuse surface (intensity/π): called every frame
  light() {
    const U = this.mat.uniforms, sun = ENV.sun;
    U.uSunV.value.copy(ENV.sunDir).transformDirection(camera.matrixWorldInverse);
    U.uSunE.value.copy(sun.color).multiplyScalar(sun.intensity / Math.PI);
  }
  // origin: world position of the funnel top; wind: world velocity of the air [m/s]; rate: puffs/s; dens: 0..1
  update(dt, origin, wind, rate, dens, ship) {
    this.mat.uniforms.viewportH.value = POST.on ? POST.h : renderer.domElement.height;      // pixels of the target the plume is drawn into
    this.acc += dt * rate;
    while (this.acc >= 1) {
      this.acc -= 1; const k = this.i = (this.i + 1) % this.n;
      this.p[k * 3] = origin.x + (Math.random() - 0.5) * 3; this.p[k * 3 + 1] = origin.y; this.p[k * 3 + 2] = origin.z + (Math.random() - 0.5) * 3;
      this.v[k * 3] = wind.x * 0.85 + (Math.random() - 0.5) * 0.8; this.v[k * 3 + 1] = 5.5 + Math.random() * 2; this.v[k * 3 + 2] = wind.z * 0.85 + (Math.random() - 0.5) * 0.8;
      this.age[k] = 0; this.dens[k] = dens * (0.7 + 0.6 * Math.random());
    }
    for (let k = 0; k < this.n; k++) {
      if (this.age[k] < 0) continue;
      this.age[k] += dt;
      if (this.age[k] > 50) { this.age[k] = -1; continue; }
      const a = this.age[k], damp = Math.exp(-dt * 0.35);
      this.v[k * 3 + 1] = this.v[k * 3 + 1] * damp + 0.35 * (1 - damp) * 0 + 0.06 * dt * 8;       // exit velocity dies away, a little buoyancy remains
      this.v[k * 3] += (wind.x * 0.85 - this.v[k * 3]) * Math.min(1, dt * 0.6); this.v[k * 3 + 2] += (wind.z * 0.85 - this.v[k * 3 + 2]) * Math.min(1, dt * 0.6);
      this.p[k * 3] += this.v[k * 3] * dt; this.p[k * 3 + 1] += this.v[k * 3 + 1] * dt; this.p[k * 3 + 2] += this.v[k * 3 + 2] * dt;
    }
    const A = this.pts.geometry.attributes;
    for (let k = 0; k < this.n; k++) { A.aAge.array[k] = this.age[k]; A.aDens.array[k] = this.dens[k]; }
    A.position.needsUpdate = A.aAge.needsUpdate = A.aDens.needsUpdate = true;
  }
}

// ============================================================================
// LAMPS — the terminal's floodlight masts (and deck lights) as analytic lights.
// There are ~60 of them, far too many for the forward renderer's light loop, so a shader snippet injected into every
// standard material (see ATMOS.grunge) loops over the N lamps nearest to the camera, which are re-selected a few times
// per second. Each lamp is a shadow-less spot (soft cone, inverse-square falloff with a hard range).
// ============================================================================
const LAMPS = {
  N: 10, list: [], t: 0,
  U: {
    uLampN: { value: 0 },
    uLampPos: { value: Array.from({ length: 10 }, () => new THREE.Vector4()) },   // xyz position, w range
    uLampCol: { value: Array.from({ length: 10 }, () => new THREE.Vector4()) },   // rgb radiance (HDR), a unused
    uLampDir: { value: Array.from({ length: 10 }, () => new THREE.Vector4()) },   // xyz axis, w cos(outer cone)
  },
  // color: [r,g,b] linear, power scales it; range in metres; dir = unit axis (default straight down)
  add(x, y, z, o = {}) { const l = { x, y, z, col: o.col || [1, 0.8, 0.52], power: o.power ?? 1, range: o.range || 90, dir: o.dir || [0, -1, 0], cone: o.cone ?? 0.2, d: 0, follow: o.follow || null, local: o.local || null, ldir: o.ldir || null, on: o.on || null }; this.list.push(l); return l; },
  _v: new THREE.Vector3(), _d: new THREE.Vector3(),
  update(cp, dt) {
    if (!this.list.length) return;
    // lamps carried by a moving object (the ship's deck lights) follow it every frame
    for (const l of this.list) if (l.follow) {
      this._v.set(...l.local).applyMatrix4(l.follow.matrixWorld); l.x = this._v.x; l.y = this._v.y; l.z = this._v.z;
      this._d.set(...l.ldir).transformDirection(l.follow.matrixWorld); l.dir = [this._d.x, this._d.y, this._d.z];
    }
    this.t -= dt;
    if (this.t <= 0 || this._cx === undefined || Math.hypot(cp.x - this._cx, cp.z - this._cz) > 25) {
      this.t = 0.3; this._cx = cp.x; this._cz = cp.z;
      for (const l of this.list) { const dx = l.x - cp.x, dy = l.y - cp.y, dz = l.z - cp.z; l.d = Math.sqrt(dx * dx + dy * dy + dz * dz) - l.range * 0.6; }
      this.near = this.list.filter((l) => l.d < l.range).sort((a, b) => a.d - b.d).slice(0, CFG.quality === 'low' ? 3 : CFG.quality === 'medium' ? 6 : this.N);      // every lit pixel loops over these
    }
    const U = this.U, near = (this.near || []).filter((l) => !l.on || l.on());
    U.uLampN.value = near.length;
    near.forEach((l, i) => {
      U.uLampPos.value[i].set(l.x, l.y, l.z, l.range);
      U.uLampCol.value[i].set(l.col[0] * l.power, l.col[1] * l.power, l.col[2] * l.power, 0);
      U.uLampDir.value[i].set(l.dir[0], l.dir[1], l.dir[2], l.cone);
    });
  },
};
