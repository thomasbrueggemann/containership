// ============================================================================
// 02b — POST: HDR scene target (MSAA), screen-space AO, bloom, tone mapping & grading
//   scene → half-float MSAA target (+depth) → AO (half res) → bloom chain → composite → canvas
// The scene uses a logarithmic depth buffer, so depth is linearised as  w = (far+1)^d − 1.
// Quality "low" skips all of this and renders straight to the canvas (see initRenderer).
// ============================================================================

// Per-channel filmic curve (Narkowicz ACES fit) — invertible, so emissive "screen" materials that must
// show their texture 1:1 (toneMapped:false before) can pre-compensate with filmicInv().
const POST_TONE_GLSL = `
  vec3 filmic(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  vec3 filmicInv(vec3 y){
    y = clamp(y, 0.0, 0.94);
    vec3 A = y * 2.43 - 2.51, B = y * 0.59 - 0.03, C = y * 0.14;
    return (-B - sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);
  }`;

// Debug aid (?gpuprof=1): GPU time per labelled section via timer queries, averaged and logged every 120 frames.
const GPUPROF = {
  on: false, ext: null, open: null, pending: [], sum: {}, n: 0,
  init() {
    if (!/[?&]gpuprof/.test(location.search)) return;
    const gl = renderer.getContext(); this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); this.on = !!this.ext;
    if (!this.on) console.log('GPUPROF: EXT_disjoint_timer_query_webgl2 not available');
  },
  begin(label) { if (!this.on || this.open) return; const q = this.gl.createQuery(); this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.open = { q, label }; },
  end() { if (!this.open) return; this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push(this.open); this.open = null; },
  poll() {
    if (!this.on) return;
    const gl = this.gl, dis = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length && gl.getQueryParameter(this.pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
      const { q, label } = this.pending.shift();
      if (!dis) { this.sum[label] = (this.sum[label] || 0) + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; this.cnt = this.cnt || {}; this.cnt[label] = (this.cnt[label] || 0) + 1; }
      gl.deleteQuery(q);
    }
    if (++this.n % 120 === 0) { const o = {}; for (const k in this.sum) o[k] = +(this.sum[k] / this.cnt[k]).toFixed(2); console.log('GPUPROF ms', JSON.stringify(o)); this.sum = {}; this.cnt = {}; }
  },
};

const POST = {
  on: false, w: 0, h: 0, rt: null, mips: [], ao: null, aoBlur: null,
  // Quality governor: when the frame rate stays low the pipeline sheds load in steps and climbs back after a few calm seconds.
  // Ordered by what costs the least to look at (measured on a 2560×1600 canvas, ms of a 34 ms frame): 2× instead of 4× MSAA (−3), a
  // shorter cloud march (−3), then render resolution (−8 per 0.15 of scale); ambient occlusion is nearly free (±0.3) and goes last.
  // scale = render resolution of the HDR target, ao on/off, msaa samples, sky = cloud-march effort.
  LEVELS: [{ scale: 1, ao: true, msaa: 4, sky: 1 }, { scale: 1, ao: true, msaa: 2, sky: 0.65 }, { scale: 0.88, ao: true, msaa: 2, sky: 0.65 },
    { scale: 0.76, ao: true, msaa: 2, sky: 0.6 }, { scale: 0.64, ao: false, msaa: 2, sky: 0.55 }, { scale: 0.54, ao: false, msaa: 2, sky: 0.55 }],
  level: 0, scale: 1, aoOn: true, sky: 1, dyn: { acc: 0, n: 0, last: 0, calm: 0, block: 0, settled: false },
  U: { uPostExp: { value: 1 } },            // shared with display materials (see displayMaterial)
  settings: { bloom: 0.1, scatter: 0.68, ao: 0.9, aoRadius: 1.6, vignette: 0.22, grain: 0.0, saturation: 1.0, contrast: 1.0, exposureScale: 1, sharpen: 0.35, shafts: 0.4 },
  // probed before the renderer exists: the canvas only needs its own MSAA when this is false
  supported() {
    if (CFG.quality === 'low' || /[?&]post=off/.test(location.search)) return false;
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ok = !!(gl && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')));
      const lose = gl && gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      return ok;
    } catch (e) { return false; }
  },
  init() {
    if (!renderer.capabilities.isWebGL2 || !this.supported()) { this.on = false; return; }
    this.high = CFG.quality === 'high';
    this.samples = this.high ? 4 : 2;
    this.nMips = this.high ? 6 : 5;
    this.useAO = this.aoOn = this.high;
    this.quad = new THREE.Mesh(new THREE.BufferGeometry(), null);
    this.quad.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene(); this.qscene.add(this.quad);
    this.qcam = new THREE.Camera();
    this.buildMaterials();
    GPUPROF.init();
    this.on = true;
    this.setLevel(devicePixelRatio >= 1.75 ? 1 : 0);      // high-density screens start one step down (it costs nothing visible there)
    addEventListener('resize', () => { this.resizeAt = performance.now() + 150; });       // debounced: dragging a window edge fires dozens of events
  },
  // compile every material for the HDR target up front (it differs from the canvas: no tone mapping, linear output)
  warm() {
    if (!this.on) { renderer.compile(scene, camera); return; }
    renderer.setRenderTarget(this.rt); renderer.compile(scene, camera); renderer.setRenderTarget(null);
    const cs = ENV.dome.userData.cloudScene;
    if (cs) { renderer.setRenderTarget(this.ensureCloudRT()); renderer.compile(cs, camera); renderer.setRenderTarget(null); }
  },
  ensureCloudRT() {
    const cw = Math.max(2, this.w >> 1), ch = Math.max(2, this.h >> 1);
    if (!this.cloudRT || this.cloudRT.width !== cw || this.cloudRT.height !== ch) {
      if (this.cloudRT) this.cloudRT.dispose();
      for (const t of this.cloudAcc || []) t.dispose();
      const mk = () => new THREE.WebGLRenderTarget(cw, ch, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      this.cloudRT = mk();
      this.cloudAcc = [mk(), mk()]; this.accCur = 0; this.accN = 0;                  // (history of the temporal accumulation, ping-pong; accN = frames in it)
    }
    return this.cloudRT;
  },
  // The clouds are marched at half resolution with a jitter that differs from pixel to pixel (4×4 Bayer) and from frame to frame; this pass
  // averages the frames. The clouds are at the horizon's distance, so the previous frame's picture of the same direction is found by the
  // camera's rotation alone (translation is a hundred thousandth of a pixel); history that no longer fits the current neighbourhood (a fast turn,
  // the zoom of the binoculars) is clamped to it, so nothing ghosts. Result: a sharp, grid-free sky at the cost of one small pass.
  accumulateClouds(crt, D) {
    const m = this.mAcc.uniforms, u = D.skyMat.uniforms, cur = 1 - this.accCur, hist = this.cloudAcc[this.accCur], out = this.cloudAcc[cur];
    if (!this._pv) { this._pv = new THREE.Matrix4(); this._pp = new THREE.Matrix4(); this._rot = new THREE.Matrix4(); }
    this._rot.multiplyMatrices(this._pv, camera.matrixWorld);                                   // current view space → previous view space (rotation part is what counts)
    m.tNew.value = crt.texture; m.tHist.value = hist.texture;
    m.uRot.value.setFromMatrix4(this._rot); m.uInvProj.value.copy(camera.projectionMatrixInverse); m.uPrevProj.value.copy(this._pp);
    m.uValid.value = this.accN > 0 ? 1 : 0; m.uBlend.value = Math.max(0.1, 1 / (this.accN + 1));
    this.run(this.mAcc, out);
    this.accCur = cur; this.accN = Math.min(this.accN + 1, 60);
    this._pv.copy(camera.matrixWorldInverse); this._pp.copy(camera.projectionMatrix);
    u.tClouds.value = out.texture; u.uAcc.value = Math.min(1, this.accN / 10);
    D.cloudFrame.value = (D.cloudFrame.value + 1) % 64;
  },
  pass(frag, uniforms, defines = {}, extra = {}) {
    return new THREE.ShaderMaterial({
      uniforms, defines, fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }', ...extra,
    });
  },
  buildMaterials() {
    const T = (v = null) => ({ value: v }), V2 = () => ({ value: new THREE.Vector2() });
    const dbg = (k) => new RegExp('[?&]postdebug=' + k).test(location.search);
    // --- bloom: 13-tap downsample (Karis-averaged on the first level) and 3x3 tent upsample
    this.mDown = this.pass(`
      uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      vec3 S(vec2 o){ return min(texture2D(tSrc, vUv + o * uTexel).rgb, vec3(24.0)); }          // the sun disc must not flood the frame
      float kw(vec3 c){ return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
      void main(){
        vec3 a = S(vec2(-2, 2)), b = S(vec2(0, 2)), c = S(vec2(2, 2)), d = S(vec2(-2, 0)), e = S(vec2(0, 0)), f = S(vec2(2, 0)),
             g = S(vec2(-2, -2)), h = S(vec2(0, -2)), i = S(vec2(2, -2)), j = S(vec2(-1, 1)), k = S(vec2(1, 1)), l = S(vec2(-1, -1)), m = S(vec2(1, -1));
        vec3 r;
        #ifdef KARIS
          vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
          float w0 = 0.125 * kw(g0), w1 = 0.125 * kw(g1), w2 = 0.125 * kw(g2), w3 = 0.125 * kw(g3), w4 = 0.5 * kw(g4);
          r = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
        #else
          r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
        #endif
        gl_FragColor = vec4(r, 1.0);
      }`, { tSrc: T(), uTexel: V2() }, { KARIS: '' });
    this.mDownPlain = this.mDown.clone(); delete this.mDownPlain.defines.KARIS; this.mDownPlain.needsUpdate = true;
    this.mUp = this.pass(`
      uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uScatter; varying vec2 vUv;
      vec3 S(vec2 o){ return texture2D(tSrc, vUv + o * uTexel).rgb; }
      void main(){
        vec3 r = S(vec2(0)) * 4.0 + (S(vec2(-1, 0)) + S(vec2(1, 0)) + S(vec2(0, -1)) + S(vec2(0, 1))) * 2.0
               + S(vec2(-1, -1)) + S(vec2(1, -1)) + S(vec2(-1, 1)) + S(vec2(1, 1));
        gl_FragColor = vec4(r / 16.0 * uScatter, 1.0);
      }`, { tSrc: T(), uTexel: V2(), uScatter: T(this.settings.scatter) },
    { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    // --- sun glare and light shafts: the bright sky (the disc, the lit edges of clouds) smeared towards the sun, with solid things in the
    //     way blocking it. Drawn additively into the 1/8-resolution bloom level (so the up-chain softens it) when the sun is in or near the picture.
    this.mShaft = this.pass(`
      uniform sampler2D tScene, tDepth; uniform vec2 uSun; uniform float uAspect, uK; varying vec2 vUv;
      void main(){
        vec2 d = uSun - vUv; float dist = length(d * vec2(uAspect, 1.0));
        vec4 s0 = texture2D(tScene, vUv);
        bool solid = texture2D(tDepth, vUv).x < 0.99999 && s0.a > 0.5;
        if (dist > 1.3 || solid) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }          // (a solid thing in front of the glow is dark against it)
        const int N = 64;
        vec2 stp = d / float(N), p = vUv;
        vec3 acc = vec3(0.0); float w = 1.0, ws = 0.0, tr = 1.0;
        for (int i = 0; i < N; i++) {
          p += stp;
          if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0) {
            float z = texture2D(tDepth, p).x; vec4 c = texture2D(tScene, p);
            if (z > 0.99999) acc += tr * w * max(min(c.rgb, vec3(80.0)) - 3.0, 0.0);
            else if (c.a > 0.5) tr *= 0.93;                                         // the sea is not an obstacle, ships and quays are
          }
          ws += w; w *= 0.975;
        }
        gl_FragColor = vec4(acc / ws * uK / (1.0 + dist * dist * 6.0), 1.0);
      }`, { tScene: T(), tDepth: T(), uSun: V2(), uAspect: T(1.6), uK: T(0) },
    { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    // --- temporal accumulation of the half-resolution cloud march (see accumulateClouds)
    this.mAcc = this.pass(`
      uniform sampler2D tNew, tHist; uniform mat4 uInvProj, uPrevProj; uniform mat3 uRot; uniform float uBlend, uValid; varying vec2 vUv;
      void main(){
        vec4 cur = texture2D(tNew, vUv);
        if (uValid < 0.5) { gl_FragColor = cur; return; }
        vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 dir = uRot * (v.xyz / v.w);                                  // this pixel's direction, in the previous frame's view space
        vec4 pc = uPrevProj * vec4(dir, 1.0);
        vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
        if (dir.z >= 0.0 || puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0) { gl_FragColor = cur; return; }
        vec2 t = 1.0 / vec2(textureSize(tNew, 0));
        vec4 mn = cur, mx = cur;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec4 c = texture2D(tNew, vUv + vec2(float(i), float(j)) * t); mn = min(mn, c); mx = max(mx, c); }
        vec4 h = clamp(texture2D(tHist, puv), mn, mx);
        gl_FragColor = mix(h, cur, uBlend);
      }`, { tNew: T(), tHist: T(), uInvProj: { value: new THREE.Matrix4() }, uPrevProj: { value: new THREE.Matrix4() }, uRot: { value: new THREE.Matrix3() }, uBlend: T(0.1), uValid: T(0) });
    // --- ambient occlusion from the (logarithmic) depth buffer. Output: r = AO, gb = view normal xy, a = view depth
    this.mAO = this.pass(`
      uniform sampler2D tDepth; uniform vec2 uRes; uniform float uFar, uTanH, uAspect, uRadius;
      varying vec2 vUv;
      float W(vec2 uv){ return pow(uFar + 1.0, texture2D(tDepth, uv).x) - 1.0; }
      vec3 P(vec2 uv, float w){ vec2 n = uv * 2.0 - 1.0; return vec3(n.x * uTanH * uAspect * w, n.y * uTanH * w, -w); }
      float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      void main(){
        // this pass is half the resolution of the depth buffer: the centre of its texel is the corner between four depth pixels, and a nearest
        // read there picks one of them by rounding – on a surface seen at a shallow angle neighbouring rows differ by centimetres, and the result
        // was stripes. Read at the centre of one depth pixel instead (the top-left of the block).
        vec2 uv0 = (floor(gl_FragCoord.xy) * 2.0 + 0.5) / uRes;
        float w0 = W(uv0);
        if (w0 > uFar * 0.2) { gl_FragColor = vec4(1.0, 0.5, 0.5, 0.0); return; }
        // world radius → pixels; far surfaces (sub-pixel radius) and the distant fade need no occlusion at all – bail out before the expensive part
        float pxWorld = 2.0 * uTanH * w0 / uRes.y;
        float rpx = min(uRadius / pxWorld, uRes.y * 0.06);
        float fade = smoothstep(2.0, 6.0, rpx) * (1.0 - smoothstep(200.0, 800.0, w0));
        if (fade <= 0.0) { gl_FragColor = vec4(1.0, 0.5, 0.5, w0); return; }
        vec2 px = 1.0 / uRes;
        vec3 p0 = P(uv0, w0);
        float wr = W(uv0 + vec2(px.x, 0.0)), wl = W(uv0 - vec2(px.x, 0.0)), wu = W(uv0 + vec2(0.0, px.y)), wd = W(uv0 - vec2(0.0, px.y));
        // The surface normal from the screen-space gradient of the INVERSE depth: on any plane 1/w is an affine function of the pixel position,
        // so this is exact however grazing the view (differences of w itself are not linear in screen space, and the one-sided difference of
        // a plane seen at a shallow angle tilts the normal enough to put the plane's own neighbours above it: stripes on every desk and deck).
        // The smaller of the two one-sided differences is still taken, so that a depth edge does not smear into the normal.
        float iw0 = 1.0 / w0, iwr = 1.0 / wr, iwl = 1.0 / wl, iwu = 1.0 / wu, iwd = 1.0 / wd;
        float gx = (abs(iwr - iw0) < abs(iw0 - iwl) ? iwr - iw0 : iw0 - iwl) / (2.0 * px.x), gy = (abs(iwu - iw0) < abs(iw0 - iwd) ? iwu - iw0 : iw0 - iwd) / (2.0 * px.y);
        vec2 xn = uv0 * 2.0 - 1.0;
        vec3 n = normalize(vec3(gx / (uTanH * uAspect), gy / uTanH, gx * xn.x + gy * xn.y - iw0));
        if (dot(n, p0) > 0.0) n = -n;                                // facing the camera
        float reff = rpx * pxWorld;
        float ao = 1.0;
        {
          float rot = ign(gl_FragCoord.xy) * 6.2831853, occ = 0.0;
          for (int i = 0; i < 12; i++) {
            float t = (float(i) + 0.5) / 12.0;
            float a = rot + t * 6.2831853 * 2.4;
            vec2 uv = uv0 + vec2(cos(a), sin(a)) * (t * 0.85 + 0.15) * rpx * px;
            vec3 v = P(uv, W(uv)) - p0;
            float d = length(v) + 1e-4;
            float el = dot(v, n) / d;                              // sin of the elevation above the tangent plane
            occ += clamp((el - 0.12) * 1.4, 0.0, 1.0) * (1.0 - smoothstep(reff * 0.7, reff * 2.0, d));
          }
          ao = 1.0 - clamp(occ / 12.0 * 2.0, 0.0, 1.0) * fade;
        }
        gl_FragColor = vec4(ao, n.xy * 0.5 + 0.5, w0);
      }`, { tDepth: T(), uRes: V2(), uFar: T(90000), uTanH: T(0.7), uAspect: T(1.6), uRadius: T(this.settings.aoRadius) });
    this.mBlur = this.pass(`
      uniform sampler2D tAO; uniform vec2 uDir; uniform float uTanH, uAspect; varying vec2 vUv;
      vec3 P(vec2 uv, float w){ vec2 n = uv * 2.0 - 1.0; return vec3(n.x * uTanH * uAspect * w, n.y * uTanH * w, -w); }
      vec3 N(vec2 g){ vec2 xy = g * 2.0 - 1.0; return vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0))); }
      void main(){
        vec4 c0 = texture2D(tAO, vUv);
        if (c0.a <= 0.0) { gl_FragColor = c0; return; }
        vec3 n0 = N(c0.gb), p0 = P(vUv, c0.a);
        float sum = c0.r * 0.2, ws = 0.2;
        for (int i = 1; i <= 4; i++) {
          float k = float(i), g = exp(-k * k * 0.1);
          for (int s = -1; s <= 1; s += 2) {
            vec2 uv = vUv + uDir * k * float(s);
            vec4 ci = texture2D(tAO, uv);
            if (ci.a <= 0.0) continue;
            float plane = abs(dot(P(uv, ci.a) - p0, n0));
            float wt = g * 0.2 * exp(-plane / (0.015 * c0.a + 0.01)) * pow(max(dot(N(ci.gb), n0), 0.0), 6.0);
            sum += ci.r * wt; ws += wt;
          }
        }
        gl_FragColor = vec4(sum / ws, c0.gba);
      }`, { tAO: T(), uDir: V2(), uTanH: T(0.7), uAspect: T(1.6) });
    // --- composite: AO, bloom, exposure, filmic tone curve, grading, vignette, dither → sRGB canvas
    this.mComp = this.pass(`
      uniform sampler2D tScene, tBloom, tAO, tDepth; uniform float uSharp, uSkyBlur, uBloom, uAO, uVig, uGrain, uSat, uCon, uTime, uPostExp; uniform vec2 uRes;
      varying vec2 vUv;
      ${POST_TONE_GLSL}
      float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main(){
        vec4 s0 = texture2D(tScene, vUv);
        vec3 c = s0.rgb;
        // the raymarched clouds carry an ordered 4×4 jitter: a 4×4 box average over sky pixels cancels it exactly
        if (uSkyBlur > 0.0 && texture2D(tDepth, vUv).x > 0.99999) {
          vec2 t = 1.0 / uRes; vec3 acc = vec3(0.0); float n = 0.0;
          for (int i = 0; i < 4; i++) {
            vec2 o = vec2((i & 1) == 0 ? -1.0 : 1.0, (i & 2) == 0 ? -1.0 : 1.0) * t;
            if (texture2D(tDepth, vUv + o).x > 0.99999) { acc += texture2D(tScene, vUv + o).rgb; n += 1.0; }     // bilinear tap = a 2×2 block
          }
          if (n > 3.5) c = mix(c, acc / n, uSkyBlur);
        }
        if (uSharp > 0.0) {                                           // gentle contrast-adaptive sharpening: restores the crispness MSAA / bilinear scaling take away
          vec2 t = 1.0 / uRes;
          vec3 n4 = (texture2D(tScene, vUv + vec2(t.x, 0.0)).rgb + texture2D(tScene, vUv - vec2(t.x, 0.0)).rgb + texture2D(tScene, vUv + vec2(0.0, t.y)).rgb + texture2D(tScene, vUv - vec2(0.0, t.y)).rgb) * 0.25;
          vec3 d = (c - n4) * uSharp;
          c += clamp(d, -0.35 * c, 0.35 * c);
        }
        #ifdef USE_AO
          c *= mix(1.0, texture2D(tAO, vUv).r, uAO * s0.a);                 // alpha 0 marks the sea: it is shaded by its own shader
        #endif
        c += texture2D(tBloom, vUv).rgb * uBloom;
        #ifdef DEBUG_AO
          c = vec3(texture2D(tAO, vUv).r) / max(uPostExp, 1e-3);
        #endif
        #ifdef DEBUG_BLOOM
          c = texture2D(tBloom, vUv).rgb;
        #endif
        vec3 o = toSRGB(filmic(c * uPostExp));
        float l = dot(o, vec3(0.2126, 0.7152, 0.0722));
        o = mix(vec3(l), o, uSat);
        o = mix(o, o * o * (3.0 - 2.0 * o), uCon - 1.0);                 // gentle S-curve in display space
        vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
        o *= 1.0 - uVig * smoothstep(0.35, 1.1, length(q));
        o += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * uGrain;
        o += (hash(gl_FragCoord.xy * 1.37 + 7.1) - 0.5) / 255.0;           // dither against banding in the sky
        gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
      }`, { tScene: T(), tBloom: T(), tAO: T(), tDepth: T(), uSharp: T(0.3), uSkyBlur: T(1), uBloom: T(0), uAO: T(0), uVig: T(0), uGrain: T(0), uSat: T(1), uCon: T(1), uTime: T(0), uPostExp: this.U.uPostExp, uRes: V2() },
    { ...(this.useAO ? { USE_AO: '' } : {}), ...(dbg('ao') ? { DEBUG_AO: '' } : {}), ...(dbg('bloom') ? { DEBUG_BLOOM: '' } : {}) });
  },
  resize() {
    if (!this.on) return;
    const v = renderer.getDrawingBufferSize(new THREE.Vector2());
    // the HDR target is 8 bytes per sample (×4 with MSAA): cap it at ~3.2 M pixels (2150×1500) and let the final pass scale it up on Retina screens
    const k = this.scale * Math.min(1, Math.sqrt(3.2e6 / (v.x * v.y)));
    const w = Math.max(2, (v.x * k) | 0), h = Math.max(2, (v.y * k) | 0);
    if (w === this.w && h === this.h && this.rt) return;
    this.w = w; this.h = h;
    for (const t of [this.rt, this.ao, this.aoBlur, ...this.mips]) if (t) { if (t.depthTexture) t.depthTexture.dispose(); t.dispose(); }
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.samples, depthTexture: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const mk = (mw, mh, filt = THREE.LinearFilter) => new THREE.WebGLRenderTarget(Math.max(2, mw), Math.max(2, mh), { type: THREE.HalfFloatType, depthBuffer: false, minFilter: filt, magFilter: filt });
    this.mips = [];
    for (let i = 0; i < this.nMips; i++) this.mips.push(mk(w >> (i + 1), h >> (i + 1)));
    if (this.useAO) { this.ao = mk(w >> 1, h >> 1, THREE.NearestFilter); this.aoBlur = mk(w >> 1, h >> 1, THREE.NearestFilter); }
  },
  // Dynamic resolution: if the frame rate stays low the HDR target (and with it every pass) shrinks in steps; the final
  // pass scales it back up with sharpening. It grows again after a few calm seconds, but not straight after a failed attempt.
  setLevel(l) {
    const L = this.LEVELS[this.level = l], samples = Math.min(L.msaa, this.high ? 4 : 2);
    this.scale = L.scale; this.aoOn = L.ao && this.useAO; this.sky = L.sky; this.tuned = 0;
    if (samples !== this.samples) { this.samples = samples; this.w = 0; }                  // a different sample count needs a new target
    this.resize();
  },
  adapt() {
    if (!this.on || /[?&]dynres=off/.test(location.search)) return;
    const D = this.dyn, now = performance.now(), dt = now - D.last; D.last = now;
    if (dt <= 0 || dt > 250 || G.paused) return;                       // first frame, tab switch, hitch, pause menu
    D.acc += dt; D.n++;
    if (D.block > 0) D.block -= dt;
    if (D.n < (D.settled ? 60 : 24)) return;                           // the first verdict comes quickly: a slow machine should not suffer for long
    const avg = D.acc / D.n; D.acc = 0; D.n = 0; D.settled = true;
    const top = this.LEVELS.length - 1;
    if (avg > 22 && this.level < top) { this.setLevel(Math.min(top, this.level + (avg > 45 ? 2 : 1))); D.calm = 0; D.block = D.lastUp && now - D.lastUp < 25000 ? 90000 : 0; }
    else if (avg < 17.5 && this.level > 0 && D.block <= 0) { if (++D.calm >= 3) { this.setLevel(this.level - 1); D.calm = 0; D.lastUp = now; } }
    else D.calm = 0;
  },
  // the cloud march is the costliest per-pixel shader: scale its step counts with the number of pixels it has to cover
  tuneSky() {
    const d = ENV && ENV.dome; if (!d) return;
    const px = d.userData.cloudScene ? this.w * this.h / 4 : this.w * this.h;           // pixels the march has to cover
    const k = clamp(Math.sqrt(2.2e6 / px), 0.55, 1) * this.sky, u = d.material.uniforms;
    u.uSteps.value = Math.max(6, Math.round(d.userData.steps * k)); u.uLSteps.value = k < 0.75 ? Math.min(2, d.userData.lsteps) : d.userData.lsteps;
  },
  run(mat, target) {
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(this.qscene, this.qcam);
  },
  _sv: new THREE.Vector3(),
  // glare and shafts of the sun (when it is in or near the picture, by day, and the machine is not struggling)
  shafts(sceneTex) {
    const S = this.settings;
    if (this.noShafts === undefined) this.noShafts = /[?&]shafts=off/.test(location.search);
    if (this.noShafts || !(S.shafts > 0) || ENV.night || this.level > 3) return;
    const sd = ENV.sunDir, c = camera, d = this._sv.copy(sd).transformDirection(c.matrixWorldInverse);
    if (d.z > -0.08 || sd.y < -0.02) return;                                          // behind the camera or below the horizon
    const th = Math.tan(c.fov * DEG / 2), u = (d.x / -d.z) / (th * c.aspect) * 0.5 + 0.5, v = (d.y / -d.z) / th * 0.5 + 0.5;
    const out = Math.max(Math.max(-u, u - 1), Math.max(-v, v - 1), 0);               // how far outside the picture, in picture widths
    const lvl = Math.min(2, this.mips.length - 1), k = S.shafts * ENV.sunLevel * (1 - smooth(0, 0.45, out)) * (1 - 0.5 * smooth(0.25, 0.8, sd.y)) / (Math.max(S.bloom, 0.02) * Math.pow(S.scatter, lvl));
    if (k <= 0.001) return;
    const m = this.mShaft.uniforms;
    m.tScene.value = sceneTex; m.tDepth.value = this.rt.depthTexture; m.uSun.value.set(u, v); m.uAspect.value = c.aspect; m.uK.value = k;
    this.run(this.mShaft, this.mips[lvl]);
  },
  render() {
    if (!this.on) { renderer.render(scene, camera); return; }
    const S = this.settings, r = renderer, ac = r.autoClear;
    if (this.resizeAt && performance.now() >= this.resizeAt) { this.resizeAt = 0; this.resize(); }
    this.adapt();
    if (this.tuned !== this.w * this.h) { this.tuned = this.w * this.h; this.tuneSky(); }
    this.U.uPostExp.value = r.toneMappingExposure * S.exposureScale * 0.85;      // 0.85 makes the Narkowicz curve match three's ACES at the same exposure
    // 0. clouds, marched at half resolution into their own target (the dome composites them in the scene pass)
    const D = ENV.dome.userData;
    if (D.cloudScene) {
      const crt = this.ensureCloudRT(), u = D.skyMat.uniforms, ca = r.getClearAlpha();
      u.tClouds.value = crt.texture; u.uRes.value.set(this.w, this.h);
      r.setRenderTarget(crt); r.setClearAlpha(0); r.autoClear = true;
      GPUPROF.begin('clouds'); r.render(D.cloudScene, camera); GPUPROF.end();
      r.setClearAlpha(ca);
      if (this.noAcc === undefined) this.noAcc = /[?&]cloudacc=off/.test(location.search);
      if (!this.noAcc) { r.autoClear = false; this.accumulateClouds(crt, D); r.autoClear = true; }
    }
    // 1. scene → HDR target
    GPUPROF.poll();
    r.setRenderTarget(this.rt); r.autoClear = true;
    GPUPROF.begin('scene'); r.render(scene, camera); GPUPROF.end();
    r.autoClear = false;
    const sceneTex = this.rt.texture;
    // 2. ambient occlusion (half res) + normal/depth-aware blur
    if (this.aoOn) {
      const u = this.mAO.uniforms, hw = this.ao.width, hh = this.ao.height;
      u.tDepth.value = this.rt.depthTexture; u.uRes.value.set(this.w, this.h); u.uFar.value = camera.far;
      u.uTanH.value = Math.tan(camera.fov * DEG / 2); u.uAspect.value = camera.aspect; u.uRadius.value = S.aoRadius;
      GPUPROF.begin('ao'); this.run(this.mAO, this.ao); GPUPROF.end();
      const b = this.mBlur.uniforms; b.uTanH.value = u.uTanH.value; b.uAspect.value = u.uAspect.value;
      GPUPROF.begin('aoBlur');
      b.tAO.value = this.ao.texture; b.uDir.value.set(1 / hw, 0); this.run(this.mBlur, this.aoBlur);
      b.tAO.value = this.aoBlur.texture; b.uDir.value.set(0, 1 / hh); this.run(this.mBlur, this.ao);
      GPUPROF.end();
    }
    // 3. bloom: down the chain, then back up accumulating
    GPUPROF.begin('bloom');
    {
      let src = sceneTex, sw = this.w, sh = this.h;
      this.mips.forEach((m, i) => {
        const mat = i === 0 ? this.mDown : this.mDownPlain;
        mat.uniforms.tSrc.value = src; mat.uniforms.uTexel.value.set(1 / sw, 1 / sh);
        this.run(mat, m);
        src = m.texture; sw = m.width; sh = m.height;
      });
      this.shafts(sceneTex);
      for (let i = this.mips.length - 2; i >= 0; i--) {
        const lo = this.mips[i + 1];
        this.mUp.uniforms.tSrc.value = lo.texture; this.mUp.uniforms.uTexel.value.set(1 / lo.width, 1 / lo.height);
        this.run(this.mUp, this.mips[i]);
      }
    }
    GPUPROF.end();
    // 4. composite to the canvas
    const c = this.mComp.uniforms;
    c.tScene.value = sceneTex; c.tDepth.value = this.rt.depthTexture; c.tBloom.value = this.mips[0].texture; c.tAO.value = this.useAO ? this.ao.texture : null;
    c.uSharp.value = S.sharpen; c.uSkyBlur.value = ENV && ENV.night || D.cloudScene ? 0 : 1; c.uBloom.value = S.bloom; c.uAO.value = this.aoOn ? S.ao : 0; c.uVig.value = S.vignette; c.uGrain.value = S.grain; c.uSat.value = S.saturation; c.uCon.value = S.contrast;
    c.uTime.value = G.realT; c.uRes.value.set(this.w, this.h);
    GPUPROF.begin('composite'); this.run(this.mComp, null); GPUPROF.end();
    r.autoClear = ac;
  },
};

// Emissive screens (instrument displays, berth boards, compass cards) were drawn with toneMapped:false so
// their canvas textures showed 1:1. With the HDR pipeline everything passes the filmic curve, so these
// materials output its inverse — what you see on screen is the texture again.
function displayMaterial(mat) {
  if (!POST.on) { mat.toneMapped = false; return mat; }
  mat.onBeforeCompile = (sh) => {
    ATMOS.hook(sh);
    sh.uniforms.uPostExp = POST.U.uPostExp;
    sh.fragmentShader = 'uniform float uPostExp;\n' + POST_TONE_GLSL + sh.fragmentShader.replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = filmicInv(gl_FragColor.rgb) / uPostExp;');
  };
  mat.customProgramCacheKey = () => 'display';
  return mat;
}
