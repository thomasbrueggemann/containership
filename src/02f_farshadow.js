// ============================================================================
// 02f — FAR SHADOWS. The sun's shadow map follows the bridge (72 m) or the ship (up to 235 m) and holds the ship only: the port is
// built without casters, so at a low sun the terminal threw no shadows at all – cranes, stacks, sheds and the quay edge left the
// apron, the water and the ship alongside evenly lit. This is a second, coarser map of the static port alone (everything under
// WORLD.root), rendered from the sun into a depth texture around the ship and redone when the ship has moved some way or every couple of
// seconds (a pass costs about a millisecond; the cranes work, and their shadows follow in small steps). Back faces only: a lit surface then never competes with its own
// depth, so there is no acne to bias away, and a closed box shades whatever lies behind it. The standard materials multiply it into
// the sun's shadow term (ATMOS.grunge patches the light loop) and the sea shader reads it too. Only in and near the port.
// ============================================================================
const FARSHADOW = {
  on: false, baked: false, size: 2048, rad: 480, D: 4000, cx: 0, cz: 0, t: 0, rt: null, scene: null, cam: null, skip: [], _lc: undefined,
  // wanted at all? (decided when materials compile, so a program never lacks the code after the fact; U.uFarInfo.w switches it on)
  get want() { return CFG.quality !== 'low' && !/[?&]farshadow=off/.test(location.search); },
  get wantMat() { return this.want && !/[?&]farshadow=nomat/.test(location.search); },          // (nomat / nowater: to see which of the two costs what)
  get wantWater() { return this.want && !/[?&]farshadow=nowater/.test(location.search); },
  PORT_X: -3700,                                                                                  // west of this (the open sea, the channel) there is nothing to cast
  U: { uFarMap: { value: null }, uFarMat: { value: new THREE.Matrix4() }, uFarInfo: { value: new THREE.Vector4(0, 0, 0, 0) } },
  GLSL: `
    uniform sampler2D uFarMap; uniform mat4 uFarMat; uniform vec4 uFarInfo;       // map, world → map space, (1/size, -, 1/depth range in m, on)
    // 1 = lit, 0 = in the shadow of the port. wp = world position, ndl = cosine to the sun (a surface turned away is dark anyway)
    float farShadow(vec3 wp, float ndl){
      if (uFarInfo.w < 0.5 || ndl <= 0.0) return 1.0;
      vec3 p = (uFarMat * vec4(wp, 1.0)).xyz * 0.5 + 0.5;
      vec2 e = min(p.xy, 1.0 - p.xy);
      float edge = smoothstep(0.0, 0.1, min(e.x, e.y));
      if (edge <= 0.0 || p.z >= 1.0) return 1.0;
      float zr = p.z - 0.25 * uFarInfo.z;                                         // 25 cm
      vec2 st = p.xy / uFarInfo.x - 0.5, i = floor(st), f = st - i, uv = (i + 0.5) * uFarInfo.x;
      float a = step(zr, texture2D(uFarMap, uv).r), b = step(zr, texture2D(uFarMap, uv + vec2(uFarInfo.x, 0.0)).r),
            c = step(zr, texture2D(uFarMap, uv + vec2(0.0, uFarInfo.x)).r), d = step(zr, texture2D(uFarMap, uv + uFarInfo.xx).r);
      return mix(1.0, mix(mix(a, b, f.x), mix(c, d, f.x), f.y), edge);
    }`,
  // three's light loop with the far shadow multiplied into the sun's term (null if the chunk no longer looks as expected)
  lightsChunk() {
    if (this._lc === undefined) {
      const src = THREE.ShaderChunk.lights_fragment_begin, key = 'vDirectionalShadowCoord[ i ] ) : 1.0;';
      this._lc = src.includes(key) ? src.replace(key, 'vDirectionalShadowCoord[ i ] ) * farShadow( vWP, dot( geometryNormal, directLight.direction ) ) : 1.0;') : null;
      if (!this._lc) console.warn('far shadows: the light chunk of this three.js version is not the expected one – port shadows are off');
    }
    return this._lc;
  },
  init() {
    if (!this.want || !WORLD.root || !renderer.shadowMap.enabled) return;
    const hi = CFG.quality === 'high';
    this.size = hi ? 3072 : 2048; this.rad = hi ? 560 : 480;
    const dt = new THREE.DepthTexture(this.size, this.size); dt.minFilter = dt.magFilter = THREE.NearestFilter;
    this.rt = new THREE.WebGLRenderTarget(this.size, this.size, { depthTexture: dt, format: THREE.RedFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2 * this.D);
    this.cam.layers.set(0); this.cam.layers.enable(2);                        // (layer 3 = too small to see, see LOD)
    this.scene = new THREE.Scene();
    this.scene.overrideMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.BackSide });
    // not shadow casters: light glows and smoke (sprites), lines, points and anything see-through
    WORLD.root.traverse((o) => { if (o.isSprite || o.isPoints || o.isLine || (o.isMesh && o.material && o.material.transparent && o.material.depthWrite === false)) this.skip.push(o); });
    this.U.uFarMap.value = dt;
    this.U.uFarInfo.value.set(1 / this.size, 0, 1 / (2 * this.D - 1), 0);
    this.on = true;
  },
  // debugging: what does the map hold? (a 256² reduction of the depth texture, read back to the CPU)
  probe() {
    const n = 256, rt = new THREE.WebGLRenderTarget(n, n, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
    const m = new THREE.ShaderMaterial({ uniforms: { t: this.U.uFarMap }, depthTest: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).r, 0.0, 0.0, 1.0); }' });
    const quad = new THREE.Mesh(new THREE.BufferGeometry(), m); quad.frustumCulled = false;
    quad.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const sc = new THREE.Scene(), prev = renderer.getRenderTarget(), buf = new Float32Array(n * n * 4); sc.add(quad);
    renderer.setRenderTarget(rt); renderer.render(sc, new THREE.Camera()); renderer.readRenderTargetPixels(rt, 0, 0, n, n, buf); renderer.setRenderTarget(prev);
    let lo = 1, hi = 0, hit = 0, sum = 0; for (let i = 0; i < n * n; i++) { const d = buf[i * 4]; lo = Math.min(lo, d); hi = Math.max(hi, d); sum += d; if (d < 0.9999) hit++; }
    rt.dispose(); m.dispose(); quad.geometry.dispose();
    return { min: lo, max: hi, mean: sum / (n * n), filled: hit / (n * n) };
  },
  // debugging: the lookup as the materials do it, for a 64² grid of ground points (height y) around (cx, cz): the share that is lit
  probeLit(cx, cz, half = 300, y = 4.9) {
    const n = 64, rt = new THREE.WebGLRenderTarget(n, n, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
    const m = new THREE.ShaderMaterial({ uniforms: { ...this.U, uBox: { value: new THREE.Vector4(cx - half, cz - half, 2 * half, y) } }, depthTest: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `${this.GLSL} uniform vec4 uBox; varying vec2 vUv; void main(){ gl_FragColor = vec4(farShadow(vec3(uBox.x + vUv.x * uBox.z, uBox.w, uBox.y + vUv.y * uBox.z), 1.0), 0.0, 0.0, 1.0); }` });
    const quad = new THREE.Mesh(new THREE.BufferGeometry(), m); quad.frustumCulled = false;
    quad.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const sc = new THREE.Scene(), prev = renderer.getRenderTarget(), buf = new Float32Array(n * n * 4); sc.add(quad);
    renderer.setRenderTarget(rt); renderer.render(sc, new THREE.Camera()); renderer.readRenderTargetPixels(rt, 0, 0, n, n, buf); renderer.setRenderTarget(prev);
    let lit = 0, dark = 0; for (let i = 0; i < n * n; i++) { const v = buf[i * 4]; lit += v; if (v < 0.5) dark++; }
    rt.dispose(); m.dispose(); quad.geometry.dispose();
    return { meanLit: lit / (n * n), darkShare: dark / (n * n) };
  },
  _c: new THREE.Vector3(), _r: new THREE.Vector3(), _u: new THREE.Vector3(), _up: new THREE.Vector3(),
  bake(cx, cz, sd) {
    const cam = this.cam, R = this.rad, c = this._c, up = this._up.set(0, 1, 0);
    if (sd.y > 0.98) up.set(0, 0, 1);
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
    // the window sits on a whole-texel grid so that re-centring it never moves a shadow edge
    const r = this._r.crossVectors(up, sd).normalize(), u = this._u.crossVectors(sd, r), texel = 2 * R / this.size;
    c.set(cx, 8, cz);
    const x = c.dot(r), y = c.dot(u);
    c.addScaledVector(r, Math.round(x / texel) * texel - x).addScaledVector(u, Math.round(y / texel) * texel - y);
    cam.up.copy(up); cam.position.copy(c).addScaledVector(sd, this.D); cam.lookAt(c);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    this.U.uFarMat.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    // draw the static port alone: it is moved into a scene of its own for the length of the pass
    const root = WORLD.root, parent = root.parent, idx = parent.children.indexOf(root);
    const hid = this.skip.filter((o) => o.visible); for (const o of hid) o.visible = false;
    this.scene.add(root);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt); renderer.clear(); renderer.render(this.scene, cam); renderer.setRenderTarget(prev);
    parent.add(root); parent.children.pop(); parent.children.splice(idx, 0, root);        // and back at its old place in the draw order
    for (const o of hid) o.visible = true;
    this.cx = cx; this.cz = cz; this.t = performance.now(); this.baked = true;
  },
  // cp = camera position. The window is centred on the ship – or midway between the ship and an orbiting camera, or on the camera
  // when that is far from the ship (free views) – and the shadow is redone when that centre has moved a fifth of the radius
  update(cp) {
    if (!this.on) return;
    const sd = ENV.sunDir, s = G.ship, far = Math.hypot(cp.x - s.x, cp.z - s.z) > 900;
    const cx = far ? cp.x : (cp.x + s.x) / 2, cz = far ? cp.z : (cp.z + s.z) / 2;
    const live = sd.y > 0.03 && ENV.sun.intensity > 0.02 && cx > this.PORT_X;                    // (and not at sea: no pass, no lookups)
    this.U.uFarInfo.value.w = live && this.baked ? 1 : 0;
    if (!live) return;
    if (!this.baked || Math.hypot(cx - this.cx, cz - this.cz) > this.rad * 0.2 || performance.now() - this.t > 2000) { this.bake(cx, cz, sd); this.U.uFarInfo.value.w = 1; }
  },
};
