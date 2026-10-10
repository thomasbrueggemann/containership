// ============================================================================
// 02c — SHIP WAVES: the bow wave, hull trough, stern hump and Kelvin wedge of every vessel under way, evaluated in
// the water shader (so it lights, reflects and fogs exactly like the sea around it; the own ship's bow region gets a finer
// mesh of its own, see BOWMESH in 02d).
//
// The field is stationary in the ship's frame (the water flows through it), described in coordinates
//   u = distance aft of the stem, c = lateral offset (+ starboard), lat = distance outboard of the hull side,
//   c0 = the water's *label*: its lateral offset before the hull shoved it aside (≈ stream function / V)
//   * bow wave   : crest height z_b and position x_b from the hull's entrance angle, draught and speed (Noblesse et al.);
//                  the crest leaves the hull a metre or two aft of the stem and curves out and aft (a curve in label
//                  space, steep at the bow, bending to the Kelvin cusp angle); a steep front face, behind it a cosine of the
//                  transverse wave length down into the trough; a smooth hump over the bulb ahead of the stem
//   * hull trough: the water level sags beside the parallel body (Bernoulli), recovering to a stern hump
//   * Kelvin wave: 8 plane waves whose wavelengths follow the deep-water dispersion relation k = g / (V cosθ)²,
//                  each confined to the ray where its stationary phase lies
//   * breaking   : a roller of white water tumbling down the crest's front face, unbroken at the stem, in bursts and
//                  patches farther out (swRoller: it stays with the ship, the water runs through it, and stands proud)
//   * white water: what the breaker leaves behind on the water (swInject), thick and bright for a few seconds, then a lace
//                  that lingers. For the own ship a simulated field (FOAMSIM, 02d); other vessels use its steady state
//                  (swFoamA) on the same noise, pinned to the water
// ============================================================================
const SHIPW = {
  N: 4,
  U: {
    uShipA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },   // stem x, stem z, heading hx, hz (world)
    uShipB: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },   // length, beam, speed through the water [m/s], strength (0 = unused)
    uShipC: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },   // bow immersion -1..1, reserved, bow-start fraction, 1 = white water simulated
    uShipD: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },   // bow wave crest height z_b [m], bulb (0/1), crest x_b [m aft of the stem], reserved
    uSwPh: { value: new THREE.Vector2() },                               // breaking noise phases (fast, slow): fract(0.11·t), fract(0.013·t)
    uSwMesh: { value: new THREE.Vector4(-35, 90, 40, 0) },              // the own ship's near-field mesh (BOWMESH, 02d): u from, u to, outboard reach, on (0..1)
    uSunI: { value: 1 },                                                 // direct light (sun or moon) intensity, as lit for the scene
  },
  GLSL: `
    #define SW_N 4
    float swSq(float x){ return x * x; }                // (pow(x, 2.0) is undefined for x < 0 in GLSL)
    uniform vec4 uShipA[SW_N]; uniform vec4 uShipB[SW_N]; uniform vec4 uShipC[SW_N]; uniform vec4 uShipD[SW_N]; uniform vec2 uSwPh; uniform vec4 uSwMesh; uniform float uSunI;
    // waterline half-breadth u metres aft of the stem (bow entrance as in the hull loft, parallel body, run to the transom);
    // behind the transom the gap the hull leaves closes over about a beam
    float swHB(float u, float L, float B, float bs){
      if (u <= 0.0) return 0.0;
      if (u >= L) return 0.27 * B * exp(-(u - L) / (0.6 * B));
      float s = 1.0 - u / L;
      if (s > bs) { float t = (s - bs) / (1.0 - bs); return 0.5 * B * max(1.0 - pow(max(t, 1e-3), 1.65), 0.012); }
      return 0.5 * B * (1.0 - 0.46 * pow(max(1.0 - s / 0.2, 0.0), 1.8));
    }
    // label of the water at |c| beside a hull of half-breadth hb: the displacement decays over λ outboard
    float swLabel(float ac, float hb, float lam){ return max(ac - hb * exp(-max(ac - hb, 0.0) / lam), 0.0); }
    // x = u, y = c, z = hull half-breadth there, w = distance outboard of the hull side
    vec4 swFrame(vec2 p, int i){
      vec4 A = uShipA[i], B = uShipB[i];
      vec2 d = p - A.xy;
      float u = -dot(d, A.zw), c = dot(d, vec2(-A.w, A.z));
      float hb = swHB(u, B.x, B.y, uShipC[i].z);
      return vec4(u, c, hb, u < B.x ? max(abs(c) - hb, 0.0) : abs(c));
    }
    // bow wave crest in label space: x = metres aft of where it leaves the hull, returns the crest's label offset;
    // it stands well off the bow (~65°) and bends to the 19.5° cusp line a few wave lengths out
    float swCrestW(float x, float kv){ return x > 0.0 ? x * (0.354 + 1.8 / (1.0 + x / (2.0 * kv))) : 0.0; }
    // (s along the crest, n across it: + = ahead of / outside the crest, both in metres); xb = crest position on the hull
    vec2 swCrest(float u, float c0, float kv, float xb){
      float x = u - xb, w = swCrestW(x, kv);
      float sl = x > 0.0 ? 0.354 + 1.8 / swSq(1.0 + x / (2.0 * kv)) : 2.15;             // local slope dW/dx
      return vec2(length(vec2(max(x, 0.0), w)), (c0 - w - min(x, 0.0) * 2.15) / sqrt(1.0 + sl * sl));
    }
    // cross-section about the crest (Noblesse et al.): a steep front; behind it the surface falls as a cosine of the
    // transverse wave length (back to the mean level (π/2)V²/g aft of the crest, the trough πV²/g aft) and recovers
    float swRidge(float n, float kv){
      if (n > 0.0) return exp(-swSq(n / (0.65 * kv + 0.4)));
      float t = -n / kv;
      return t < 3.1416 ? cos(t) : -exp(-swSq((t - 3.1416) / 1.3));
    }
    // the smooth part: bow wave (z_b high just aft of the stem), bulb hump, hull-side trough, stern hump
    float swSmooth(vec4 f, int i){
      vec4 B = uShipB[i], D = uShipD[i];
      float L = B.x, kv = B.z * B.z / 9.81, u = f.x, lat = f.w;
      float c0 = swLabel(abs(f.y), f.z, 0.5 * B.y);
      vec2 sn = swCrest(u, c0, kv, D.z);
      // out along the crest the wave spreads (∝ 1/√s) and hands over to the Kelvin field
      float along = inversesqrt(1.0 + sn.x / (1.5 * kv + 2.0)) * (1.0 - smoothstep(6.0 * kv, 16.0 * kv + 30.0, sn.x));
      // the bulb pushes a low, smooth hump ahead of the stem
      float bulb = D.y * exp(-swSq((u + 0.35 * kv) / (0.6 * kv + 1.0))) * exp(-swSq(f.y / (0.5 * kv + 0.25 * B.y)));
      float gT = smoothstep(0.1 * L, 0.3 * L, u) * (1.0 - smoothstep(L * 0.8, L, u));
      float hT = exp(-swSq(lat / (5.0 + 0.02 * u)));
      float gS = exp(-swSq((u - L * 1.01) / 20.0)), hS = exp(-swSq(lat / 9.0));
      return D.x * (swRidge(sn.y, kv) * along * smoothstep(-0.6 * kv - 2.0, 0.0, u) + 0.3 * bulb) + B.w * kv * (0.07 * gS * hS - 0.065 * gT * hT);
    }
    // where the own ship's near-field mesh (BOWMESH) lies, the ocean grid sinks out of sight; the sinking stays a margin
    // (≈ one ocean cell) inside the mesh's edges, so the two surfaces overlap there
    float swMeshSink(vec2 p, float dcam){
      if (uSwMesh.w <= 0.0) return 0.0;
      vec4 f = swFrame(p, 0);
      float hb = f.x > 0.0 && f.x < uShipB[0].x ? f.z : 0.0;
      float e = min(min(f.x - uSwMesh.x, uSwMesh.y - f.x), hb + uSwMesh.z - abs(f.y)), m = 2.0 + 0.04 * dcam;
      return 8.0 * smoothstep(m, m + 3.0, e);
    }
    // total of the smooth parts at a world point (what the water mesh is displaced by)
    float swHeightSmooth(vec2 p){
      float h = 0.0;
      for (int i = 0; i < SW_N; i++) {
        if (uShipB[i].w <= 0.0) continue;
        vec4 f = swFrame(p, i);
        if (f.x < -40.0 || f.x > uShipB[i].x * 1.3 || f.w > 60.0) continue;
        h += swSmooth(f, i);
      }
      return h;
    }`,
  // where the bow wave breaks, as injection rates (x = white water, y = bubbles, per second) for the water labelled q
  // (world point of its undisturbed position). Shared by the simulation and the analytic steady state.
  GLSL_BREAK: `
    // breaking strength of vessel i: none below Fn ≈ 0.05, grows with the bow's immersion when she pitches into a sea
    // (z_b already carries the speed, the bow's shape and its immersion; a bow wave of a few decimetres hardly breaks)
    float swBrk(int i){ return smoothstep(0.12, 1.6, uShipD[i].x); }
    // the breaker rides on the crest's front face, its toe wandering in and out; near the stem it never stops breaking,
    // farther out along the crest only the stronger bursts break (patches), and the water crossing it at some lateral
    // labels picks up more white water than its neighbours (scars: streaks drawn out aft). Noise channels: r ≈ 0..0.65
    // (cloud-like, mean 0.3), g/b/a ≈ 0.3..0.68 (mean 0.48): normalised here
    // Scales: bursts ~2.5 z_b + 3 m long, a second or two, running out along the crest at ≈ V; the toe wanders over a few
    // metres; streaks ~0.5 z_b apart. (Integer multiples of the phases only: they wrap.)
    // (sd = side, ±1: port and starboard break independently)
    vec4 swBreaker(float s, float n, float c0, float zb, float kv, vec2 ph, int i, float sd, out float w){
      vec3 nc = vec3(s / (10.0 * zb + 12.0) - 2.0 * ph.x, ph.x, float(i) * 0.29 + 0.13 + 0.5 * step(0.0, sd));
      vec4 nz = texture(uCloudNoise, nc);
      float burst = smoothstep(0.0, 0.62, nz.r + 0.6 * (texture(uCloudNoise, nc * vec3(2.0, 3.0, 1.0) + 0.5).g - 0.48));
      w = (0.8 * zb + 0.6) * (0.6 + 0.8 * smoothstep(0.32, 0.66, nz.b));
      float zl = zb * inversesqrt(1.0 + s / (1.5 * kv + 2.0)), thr = mix(-0.25, 0.5, smoothstep(0.0, 8.0 * zb + 10.0, s));
      float pot = smoothstep(0.12, 1.2, zl) * (1.0 - smoothstep(8.0 * zb + 10.0, 10.0 * zb + 14.0, s));
      // (ragged ends: the threshold itself frays at the metre scale)
      float fray = texture(uCloudNoise, vec3(s / (1.5 * zb + 3.0), n / (1.5 * zb + 3.0), ph.x * 3.0 + 0.37 + 0.5 * step(0.0, sd))).g - 0.48;
      float on = smoothstep(thr, thr + 0.3, burst + 0.9 * fray) * pot;
      float scar = 0.45 + 1.1 * smoothstep(0.36, 0.62, texture(uCloudNoise, vec3(c0 / (3.0 * zb + 3.5) + 0.5 * step(0.0, sd), ph.y, 0.61 + float(i) * 0.17)).b);
      // x = white water made (bursts, scars), y = burst, z = n from the breaker's centre, w = its smooth envelope (no streaks)
      return vec4(on * scar, burst, n - (0.3 + 2.5 * (nz.a - 0.49)) * w, pot * mix(0.45, 1.0, burst));
    }
    // the roller: white water tumbling down the crest's front face, from its top to the toe. It stays with the ship (the
    // water runs through it) and comes and goes with the bursts. Returns whiteness (0..~1.6), (s, n) on the crest, and the
    // smooth envelope of its body
    vec4 swRoller(vec4 f, float c0, int i){
      vec4 B = uShipB[i], D = uShipD[i];
      float kv = B.z * B.z / 9.81, zb = D.x, wr = 0.65 * kv + 0.4, wt = 1.12 * zb + 0.84;     // (wt: the toe's widest wander)
      if (zb < 0.08) return vec4(0.0);
      vec2 sn = swCrest(f.x, c0, kv, D.z);
      if (sn.x > 10.0 * zb + 14.0 || sn.y < -0.8 * wr - wt || sn.y > 1.6 * wr + wt || f.x < -0.5 * kv - 1.0) return vec4(0.0);
      float w; vec4 br = swBreaker(sn.x, sn.y, c0, zb, kv, uSwPh, i, f.y, w);
      // from just behind the top down the front face (≈ 0.65 V²/g wide) to the toe
      float x = br.z / (0.65 * kv + 0.4), stem = smoothstep(-0.5 * kv - 1.0, 0.0, f.x);
      float body = smoothstep(-0.8, 0.0, sn.y / (0.65 * kv + 0.4)) * (1.0 - smoothstep(0.3, 1.6, sn.y / (0.65 * kv + 0.4)));
      // (s is returned offset on the port side, so whatever is textured along it differs from starboard)
      return vec4(br.x * smoothstep(-0.5, 0.05, x) * (1.0 - smoothstep(0.6, 1.4, x)) * stem, sn.x + 517.3 * step(f.y, 0.0), sn.y, br.w * body * stem);
    }
    // (s, n) on the crest at a world point (s offset on the port side, as swRoller returns it)
    vec2 swSN(vec2 p, int i){
      vec4 f = swFrame(p, i);
      return swCrest(f.x, swLabel(abs(f.y), f.z, 0.5 * uShipB[i].y), uShipB[i].z * uShipB[i].z / 9.81, uShipD[i].z) + vec2(517.3 * step(f.y, 0.0), 0.0);
    }
    // its body: how far the tumbling white water stands proud of the surface, in lumps that roll out along the crest
    float swRollerH(vec4 r, int i, float t){
      if (r.w <= 0.0) return 0.0;
      float lump = smoothstep(0.3, 0.66, texture(uCloudNoise, vec3((r.y - uShipB[i].z * 0.6 * t) / 9.0, r.z / 4.5, t * 0.2)).g);
      return r.w * (0.25 * uShipD[i].x + 0.1) * (0.3 + 0.9 * lump);
    }
    vec2 swInject(vec2 q, int i){
      vec4 B = uShipB[i], D = uShipD[i];
      vec4 f = swFrame(q, i);
      float u = f.x, c0 = abs(f.y), V = max(B.z, 0.3), kv = V * V / 9.81, zb = D.x;
      if (zb < 0.08 || u < -2.0 * kv - 3.0 || u > 30.0 * kv + 40.0 || c0 > 12.0 * kv + 20.0) return vec2(0.0);
      vec2 sn = swCrest(u, c0, kv, D.z);
      float w; vec4 br = swBreaker(sn.x, sn.y, c0, zb, kv, uSwPh, i, f.y, w);
      // the water crosses the band at ≈ 0.6 V: at this rate each crossing leaves ≈ br.x behind (×3.4 below: thick white water)
      float rate = V * 0.6 / (w * 1.77);
      float F = br.x * exp(-swSq(br.z / w)) * rate * smoothstep(-0.5 * kv - 1.0, 0.0, sn.x);
      // white collar where the water runs up the stem and falls back
      float collar = exp(-swSq((u - 0.5 * D.z) / (0.4 * zb + 0.8))) * exp(-swSq(c0 / (0.3 * zb + 0.6))) * smoothstep(0.12, 1.6, zb) * rate * (0.15 + 1.1 * br.y * br.y);
      return vec2(F * 3.4 + collar * 2.5, (F + collar) * 3.0);
    }`,
  // fragment-only: Kelvin crests and the white water
  GLSL_FRAG: `
    const float SW_TH[8] = float[8](0.0, 0.209, 0.419, 0.559, 0.628, 0.716, 0.838, 1.012);
    const float SW_W[8]  = float[8](0.5, 0.5, 0.7, 1.0, 1.0, 0.85, 0.55, 0.3);
    const float SW_PH[8] = float[8](0.3, 1.7, 2.9, 4.4, 0.9, 5.6, 2.2, 3.8);
    float swKelvin(vec4 f, int i, inout vec2 slope){
      vec4 A = uShipA[i], B = uShipB[i];
      float V = max(B.z, 0.5), u = f.x, cabs = abs(f.y);
      if (u < 2.0 || f.w > 500.0) return 0.0;
      float amp = 0.16 * V * V / 19.62 * B.w * (1.0 + 0.4 * uShipC[i].x);
      float r = length(vec2(u, cabs)), ang = atan(cabs, max(u, 0.5));
      float att = inversesqrt(1.0 + r / 16.0) * smoothstep(1.0, 9.0, u) * smoothstep(-0.5, 2.5, f.w);
      vec2 hd = A.zw, rt = vec2(-A.w, A.z);
      float sgn = f.y >= 0.0 ? 1.0 : -1.0, h = 0.0;
      for (int j = 0; j < 8; j++) {
        float th = SW_TH[j], ct = cos(th), st = sin(th);
        float k = 9.81 / (V * V * ct * ct);
        float tn = st / ct, psi = atan(tn / (1.0 + 2.0 * tn * tn));
        float wnd = exp(-swSq((ang - psi) / 0.22));
        float ph = k * (-u * ct + cabs * st) + SW_PH[j];
        float a = amp * SW_W[j] * wnd * att;
        h += a * cos(ph);
        slope += -a * sin(ph) * k * (ct * hd + sgn * st * rt);
      }
      return h;
    }
    // steady state of the white water for a vessel that is not simulated: what the water labelled q collected when it
    // crossed the breaking zone, decayed since; the bursts are pinned to the water (sampled at the noise phase of the crossing)
    vec2 swFoamA(vec2 q, int i){
      vec4 B = uShipB[i], D = uShipD[i];
      vec4 f = swFrame(q, i);
      float u = f.x, c0 = abs(f.y), V = max(B.z, 0.3), kv = V * V / 9.81, zb = D.x;
      if (zb < 0.08 || u < -2.0 * kv - 3.0 || c0 > 12.0 * kv + 20.0) return vec2(0.0);
      // where (u) the water now at label c0 crossed the crest (inverse of swCrestW), and how long ago
      float a = 0.354, b = 1.8, R = 2.0 * kv, Bq = a + b - c0 / R;
      float xc = c0 > 0.0 ? (-Bq + sqrt(Bq * Bq + 4.0 * a / R * c0)) / (2.0 * a / R) : 0.0;
      float age = (u - xc - D.z) / V, s = length(vec2(xc, c0));
      float collar = exp(-swSq(c0 / (0.3 * zb + 0.6))) * smoothstep(0.12, 1.6, zb) * smoothstep(0.0, 0.5 * kv + 1.0, u) * exp(-max(u, 0.0) / (V * 20.0)) * 1.5;
      if (s > 10.0 * zb + 14.0 || age > 60.0) return vec2(collar, collar * 1.3);       // never broke here / long gone
      vec2 ph = uSwPh - vec2(0.11, 0.013) * age;                          // the noise phases when it crossed: pinned to the water
      float w; vec4 br = swBreaker(s, 0.0, c0, zb, kv, ph, i, f.y, w);
      float on = smoothstep(-0.6 * w / V, 0.4 * w / V, age + br.z / (0.6 * V));   // the front of the breaker (its toe wanders)
      // the same two-stage decay as the simulation: ≈ 3.5 s while thick, then a lace that lingers
      float F = 3.1 * br.x * on, a0 = max(age, 0.0), tk = 3.5 * log(max(F, 1.0));
      F = F > 1.0 && a0 < tk ? F * exp(-a0 / 3.5) : min(F, 1.0) * exp(-max(a0 - tk, 0.0) / 14.0);
      return vec2(F + collar, (3.1 * br.x * on * exp(-a0 / 4.5) + collar) * 1.3);
    }
    // all vessels at a world point: height, slope (d/dx, d/dz), white water left on the water, bubbles, its label point
    // rl = roller: whiteness, s, n, speed (of the vessel with the strongest one)
    float swFull(vec2 p, out vec2 slope, out float foam, out float aer, out vec2 lq, out vec4 rl){
      float h = 0.0; foam = 0.0; aer = 0.0; slope = vec2(0.0); lq = p; rl = vec4(0.0); vec4 rb = vec4(0.0); int ri = 0;
      for (int i = 0; i < SW_N; i++) {
        if (uShipB[i].w <= 0.0) continue;
        vec4 f = swFrame(p, i);
        float L = uShipB[i].x;
        if (f.x < -40.0 || f.x > L * 1.3 + 300.0 || f.w > 90.0 + 0.5 * max(f.x, 0.0)) continue;
        if (f.x < L * 1.1 && f.w < 70.0) {                              // (beyond, the smooth parts have died away)
          float hs = swSmooth(f, i);
          float hx = swSmooth(swFrame(p + vec2(0.4, 0.0), i), i), hz = swSmooth(swFrame(p + vec2(0.0, 0.4), i), i);
          h += hs; slope += vec2(hx - hs, hz - hs) / 0.4;
        }
        #ifdef SW_KELVIN
          h += swKelvin(f, i, slope);
        #endif
        // under the hull / no white water out there (the simulated window ends ~310 m aft of the stem; elsewhere it is gone in a minute)
        if ((f.x < L && abs(f.y) < f.z) || f.x > (uShipC[i].w > 0.5 ? 320.0 : min(L + 200.0, 60.0 * uShipB[i].z + 40.0)) || f.w > 120.0) continue;
        // the water's label point: where it was before the hull pushed it aside
        float c0 = swLabel(abs(f.y), f.z, 0.5 * uShipB[i].y);
        vec2 q = p + vec2(-uShipA[i].w, uShipA[i].z) * (sign(f.y) * c0 - f.y);
        vec2 fa;
        #ifdef SW_SIM
          if (uShipC[i].w > 0.5) fa = fsSample(q - uFsDrift, 0.0); else
        #endif
        fa = swFoamA(q, i);
        if (fa.x > foam) lq = q;
        foam = max(foam, fa.x); aer = max(aer, fa.y);
        vec4 r = swRoller(f, c0, i);
        if (r.w > rb.w) { rb = r; ri = i; }
        if (r.x > rl.x) rl = vec4(r.xyz, uShipB[i].z);
        aer = max(aer, r.x * 1.4);
      }
      // the roller's lumps (as the near-field mesh raises them), so the light falls on them as on the water around
      if (rb.w > 0.004) {
        float r0 = swRollerH(rb, ri, uTime), e = 0.35;
        float rx = swRollerH(vec4(0.0, swSN(p + vec2(e, 0.0), ri), rb.w), ri, uTime), rz = swRollerH(vec4(0.0, swSN(p + vec2(0.0, e), ri), rb.w), ri, uTime);
        h += r0; slope += vec2(rx - r0, rz - r0) / e;
      }
      return h;
    }`,
  quality: () => CFG.quality !== 'low',
  _own: { relMean: 0, imm: 0, init: false },
  _pool: [], _n: 0, _pick: [null, null, null, null],
  // one candidate vessel: stem position, heading, size, speed through the water (pooled: nothing is allocated per frame)
  // ta = tan of the waterline entrance half-angle, T = draught, bulb = bulbous bow
  _add(x, z, psi, L, B, V, imm, bs, own, ta, T, bulb) {
    const o = this._pool[this._n] || (this._pool[this._n] = {});
    this._n++;
    o.x = x; o.z = z; o.psi = psi; o.L = L; o.B = B; o.V = V; o.imm = imm; o.bs = bs; o.own = own; o.ta = ta; o.T = T; o.bulb = bulb;
    return o;
  },
  // small craft and traffic: (x, z) amidships
  _addCraft(t, L, B, bs, ta, T, bulb) { if (t.sog > 0.8 && t.grp && t.grp.visible) this._add(t.x + Math.sin(t.psi) * L / 2, t.z - Math.cos(t.psi) * L / 2, t.psi, L, B, t.sog, 0, bs, false, ta, T, bulb); },
  // bow wave crest height (Noblesse et al. 2013): z_b g/V² = min(2.2 tanα / ((1 + F_D) cosα), ½), F_D = V/√(gT). Above ½ the bow
  // wave cannot stand and breaks unsteadily (big slow ships, blunt tugs); a bulb takes about a quarter off; planing craft are capped
  crestHeight(o) {
    const kv = o.V * o.V / 9.81, FD = o.V / Math.sqrt(9.81 * o.T), ca = 1 / Math.hypot(1, o.ta);
    return Math.min(kv * Math.min(2.2 * o.ta / ((1 + FD) * ca), 0.5) * (o.bulb ? 0.75 : 1), 0.07 * o.L + 0.3);
  },
  // ... and where it stands: x_b g/V² ≈ 1.1 cos⁸α / (1 + F_D) – a metre or two aft of the stem, at the stem for a blunt bow
  crestAft(o) { const kv = o.V * o.V / 9.81, ca = 1 / Math.hypot(1, o.ta); return 0.3 + 1.1 * ca ** 8 / (1 + o.V / Math.sqrt(9.81 * o.T)) * kv; },
  gather() {
    this._n = 0;
    const s = G.ship, g = G.shipGroup;
    if (s && g) {
      const L = OWN.L, hx = Math.sin(s.psi), hz = -Math.cos(s.psi), sx = s.x + hx * L / 2, sz = s.z + hz * L / 2, V = Math.max(s.u, 0);    // (astern: no bow wave)
      // bow height relative to the water at the stem: the bow wave swells as the bow digs in and shrinks as it lifts
      const bowY = g.position.y + (L / 2) * Math.sin(g.rotation.x), rel = bowY - SWELL.height(sx, sz), O = this._own;
      if (!O.init) { O.relMean = rel; O.init = true; }
      O.relMean += (rel - O.relMean) * (1 - Math.exp(-(G.paused ? 0 : 1 / 60) / 25));
      O.imm += (clamp(-(rel - O.relMean) / 1.1, -1, 1) - O.imm) * 0.12;
      this._add(sx, sz, s.psi, L, OWN.B, V, O.imm, 0.76, true, 0.45, OWN.T, 1);
    }
    if (typeof TRAFFIC !== 'undefined') for (const o of TRAFFIC.ships) {
      if (o.active && !o.done) this._addCraft(o, o.L, o.B, o.L < 60 ? 0.6 : 0.76, o.L < 60 ? 0.4 : 0.45, o.L < 60 ? 0.12 * o.L : 0.04 * o.L, o.L < 60 ? 0 : 1);
      if (o.tugs) for (const t of o.tugs) this._addCraft(t, 32, 12.8, 0.62, 0.9, 5, 0);
    }
    if (typeof TUGS !== 'undefined') for (const t of TUGS.list) this._addCraft(t, 32, 12.8, 0.62, 0.9, 5, 0);
    if (typeof PILOTBOAT !== 'undefined' && PILOTBOAT.grp) this._addCraft(PILOTBOAT, 18, 5.4, 0.55, 0.35, 1.2, 0);
  },
  // dt: simulation time step (the breaking noise advances with it)
  update(cp, t, dt = 0) {
    this.gather();
    this._T = ((this._T || 0) + dt) % 9000; this.U.uSwPh.value.set((this._T * 0.11) % 1, (this._T * 0.013) % 1);
    if (ENV && ENV.sun) this.U.uSunI.value = ENV.sun.intensity;
    // the own ship always takes slot 0 (her frame is kept even when stopped: the bow mesh hangs on it); the other slots
    // go to the vessels nearest to the camera (and not hopelessly far)
    const P = this._pick; P.fill(null);
    for (let k = 0; k < this._n; k++) {
      const o = this._pool[k];
      if (o.own) { P[0] = o; continue; }
      o.d = Math.hypot(o.x - cp.x, o.z - cp.z) - o.L * 0.5;
      if (o.d > 2500) continue;
      for (let i = 1; i < this.N; i++) if (!P[i] || o.d < P[i].d) { for (let j = this.N - 1; j > i; j--) P[j] = P[j - 1]; P[i] = o; break; }
    }
    for (let i = 0; i < this.N; i++) {
      const o = P[i], A = this.U.uShipA.value[i], B = this.U.uShipB.value[i], C = this.U.uShipC.value[i], D = this.U.uShipD.value[i];
      if (!o || (o.V < 0.5 && !o.own)) { B.set(1, 1, 1, 0); D.set(0, 0, 0, 0); continue; }
      const breath = 1 + 0.1 * Math.sin(t * 0.9 + i * 2) + 0.06 * Math.sin(t * 2.3 + i);       // the wave is never perfectly steady
      const str = o.V < 0.5 ? 0 : smooth(0.4, 1.6, o.V) * (this.gain ?? 1);
      A.set(o.x, o.z, Math.sin(o.psi), -Math.cos(o.psi));
      B.set(o.L, o.B, Math.max(o.V, 0.3), o.own ? Math.max(str * breath, 1e-3) : str * breath);    // (the own ship's slot stays live: her white water fades out on the water)
      C.set(o.imm, 0, o.bs, o.own && typeof FOAMSIM !== 'undefined' && FOAMSIM.on ? 1 : 0);
      D.set(this.crestHeight(o) * str * (1 + 0.55 * o.imm) * (0.96 + 0.04 * breath), o.bulb, this.crestAft(o), 0);
    }
  },
};
