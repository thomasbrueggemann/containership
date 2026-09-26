// ============================================================================
// 09a — REALISTIC HEADS from a photo-scanned head (Lee Perry-Smith, three.js
// example asset, CC-BY). The scan has closed eyes: we cut the eyelids open,
// seat textured eyeballs, grow a fitted hair cap and repaint skin per person.
// Falls back to the procedural head if the asset cannot be loaded.
// ============================================================================
const HEADS = {
  ready: false, S: 0.048,
  BASE: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/LeePerrySmith/',
  async load() {
    try {
      const img = (url) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const [gltf, col, nrm] = await Promise.all([
        new GLTFLoader().loadAsync(this.BASE + 'LeePerrySmith.glb'),
        img(this.BASE + 'Map-COL.jpg'),
        new THREE.TextureLoader().loadAsync(this.BASE + 'Infinite-Level_02_Tangent_SmoothUV.jpg'),
      ]);
      let mesh = null; gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      this.col = col; this.nrm = nrm;
      this.process(mesh.geometry);
      this.ready = true;
    } catch (e) { console.warn('Head scan unavailable – procedural heads', e); }
  },
  process(src) {
    const g = src.index ? src : src;
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, I = g.index.array;
    // eye centres from the texture atlas (closed-eye regions)
    const eye = (cu) => { let s = [0, 0, 0], n = 0; for (let i = 0; i < P.count; i++) if (Math.hypot(U.getX(i) - cu, U.getY(i) - 0.705) < 0.02) { s[0] += P.getX(i); s[1] += P.getY(i); s[2] += P.getZ(i); n++; } return new THREE.Vector3(s[0] / n, s[1] / n, s[2] / n); };
    const eL = eye(0.426), eR = eye(0.574);
    // the eye in the +x half of the scan
    this.eyes = [eL, eR];
    const a = 0.3, b = 0.085, yOff = -0.03;
    this.eyeShape = { a, b, yOff };
    const inOpening = (x, y, z) => {
      for (const e of this.eyes) {
        if (z < e.z - 0.45) continue;
        const du = (x - e.x) / a; if (Math.abs(du) >= 1) continue;
        const out = Math.sign(e.x - (eL.x + eR.x) / 2);
        const yc = e.y + yOff + 0.035 * du * out;
        if (Math.abs(y - yc) < b * Math.sqrt(1 - du * du) * (1 - 0.15 * du * du)) return true;
      }
      return false;
    };
    const keep = [], hair = [];
    const hairline = (x, y, z) => {
      // signed distance above the hairline (negative = bare skin)
      let yl;
      // natural front hairline: slight widow's peak, higher at the temple corners, down to the sideburns
      const front = 2.62 + 0.26 * smooth(0.3, 1.1, Math.abs(x)) - 0.04 * (1 - smooth(0, 0.3, Math.abs(x)));
      if (z > 1.1) yl = front; else if (z > -0.6) yl = lerp(2.15, front, smooth(0.2, 1.1, z)); else yl = lerp(0.75, 2.15, smooth(-1.7, -0.6, z));
      let d = y - yl;
      if (Math.abs(x) > 1.6 && z > -1.0) d = Math.min(d, y - 2.35);            // keep the ears clear
      return d;
    };
    for (let t = 0; t < I.length; t += 3) {
      const ia = I[t], ib = I[t + 1], ic = I[t + 2];
      const cx = (P.getX(ia) + P.getX(ib) + P.getX(ic)) / 3, cy = (P.getY(ia) + P.getY(ib) + P.getY(ic)) / 3, cz = (P.getZ(ia) + P.getZ(ib) + P.getZ(ic)) / 3;
      if (cy < -1.35) continue;                        // below the collar
      if (inOpening(cx, cy, cz)) continue;             // eye openings
      keep.push(ia, ib, ic);
      if (hairline(cx, cy, cz) > -0.35) hair.push(ia, ib, ic);
    }
    // snap the ragged cut edge onto a smooth almond and tuck it inwards (lid thickness)
    const used = new Uint8Array(P.count); for (const v of keep) used[v] = 1;
    const cut = new Uint8Array(P.count);
    for (let t = 0; t < I.length; t += 3) { const ia = I[t], ib = I[t + 1], ic = I[t + 2]; const cx = (P.getX(ia) + P.getX(ib) + P.getX(ic)) / 3, cy = (P.getY(ia) + P.getY(ib) + P.getY(ic)) / 3, cz = (P.getZ(ia) + P.getZ(ib) + P.getZ(ic)) / 3; if (cy >= -1.35 && inOpening(cx, cy, cz)) { cut[ia] = cut[ib] = cut[ic] = 1; } }
    const Pn = P.clone();
    for (let i = 0; i < P.count; i++) {
      if (!(used[i] && cut[i])) continue;
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const e = Math.abs(x - eL.x) < Math.abs(x - eR.x) ? eL : eR;
      const out = Math.sign(e.x - (eL.x + eR.x) / 2);
      const du = clamp((x - e.x) / a, -0.985, 0.985);
      const yc = e.y + yOff + 0.035 * du * out;
      const side = y >= yc ? 1 : -1;
      const h = b * Math.sqrt(1 - du * du) * (1 - 0.15 * du * du);
      Pn.setXYZ(i, e.x + du * a, yc + side * h, z - 0.05);
    }
    // taper the scan's shoulder flare into a round neck that disappears inside the collar
    for (let i = 0; i < Pn.count; i++) {
      const y = Pn.getY(i); if (y > -0.05) continue;
      const dx = Pn.getX(i) + 0.09, dz = Pn.getZ(i) + 0.3;
      const w = smooth(-0.05, -0.85, y) * (dz > 0.5 ? smooth(-1.0, -1.2, y) : 1);   // leave the jaw and chin alone
      const r = Math.hypot(dx / 1.12, dz / 1.2); if (r <= 1) continue;
      const k = lerp(1, 1 / r, w); Pn.setX(i, -0.09 + dx * k); Pn.setZ(i, -0.3 + dz * k);
    }
    this.P = Pn;
    const head = new THREE.BufferGeometry();
    head.setAttribute('position', Pn); head.setAttribute('normal', N); head.setAttribute('uv', U);
    head.setIndex(keep);
    this.headGeo = head;
    this.hairIdx = hair; this.keepIdx = keep; this.N = N; this.U = U; this.hairline = hairline;
    // eyelid lash lines following the upper and lower edges of each opening
    const sampleZ = (x, y) => { let best = 1e9, bz = 0; for (let i = 0; i < Pn.count; i++) { if (!used[i]) continue; const d = Math.hypot(Pn.getX(i) - x, Pn.getY(i) - y); if (Pn.getZ(i) > 0.8 && d < best) { best = d; bz = Pn.getZ(i); } } return bz; };
    this.lashGeos = this.eyes.map((e) => {
      const out = Math.sign(e.x - (eL.x + eR.x) / 2);
      const mk = (sgn, r) => { const pts = []; for (let k = 0; k <= 16; k++) { const du = -1 + 2 * k / 16; const yc = e.y + yOff + 0.035 * du * out; const zs = sampleZ(e.x + du * a, yc + sgn * b * Math.sqrt(1 - du * du) * (1 - 0.15 * du * du)); pts.push(new THREE.Vector3(e.x + du * a, yc + sgn * (b * Math.sqrt(1 - du * du) * (1 - 0.15 * du * du) + r * 0.5), zs - 0.03)); } return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 5); };
      return [mk(1, 0.026), mk(-1, 0.01)];
    });
  },
  hairGeo(style, female) {
    const th = { short: [0.2, 0.08], side: [0.3, 0.12], bun: [0.26, 0.12], crop: [0.07, 0.05], grey: [0.14, 0.07], receding: [0.12, 0.06] }[style] || [0.2, 0.08];
    const P = female ? this.femaleGeo().attributes.position : this.P, N = this.N;
    // long hair pulled back: a lower line over the temples and the tops of the ears, down to the nape
    const long = style === 'bun';
    const hl = long ? (x, y, z) => { let d = this.hairline(x, y, z) - (z > 1.1 ? 0.08 : 0); if (Math.abs(x) > 1.5 && z > -1.0 && z < 1.2) d = Math.max(d, y - 1.95); if (z < -0.9) d = Math.max(d, y - 0.35); return d; } : this.hairline;
    let idx = this.hairIdx;
    if (long) {
      idx = []; const K = this.keepIdx, c = (i0, i1, i2, f) => (f(i0) + f(i1) + f(i2)) / 3;
      for (let t = 0; t < K.length; t += 3) {
        const [i0, i1, i2] = [K[t], K[t + 1], K[t + 2]];
        if (hl(c(i0, i1, i2, (i) => P.getX(i)), c(i0, i1, i2, (i) => P.getY(i)), c(i0, i1, i2, (i) => P.getZ(i))) > -0.35) idx.push(i0, i1, i2);
      }
    }
    const map = new Map(), pos = [], uv = [], col = [], out = [];
    for (const i of idx) {
      if (!map.has(i)) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        let d = hl(x, y, z);
        if (style === 'receding' && z > 0.6) d = Math.min(d, y - 3.35);
        const t = (th[1] + (th[0] - th[1]) * smooth(2.4, 3.8, y)) * smooth(0, 0.3, d) + 0.02;
        pos.push(x + N.getX(i) * t, y + N.getY(i) * t, z + N.getZ(i) * t);
        uv.push(this.U.getX(i), this.U.getY(i));
        // alpha fades across the hairline; alphaTest turns it into a smooth cut edge
        col.push(1, 1, 1, smooth(-0.2, 0.35, d));
        map.set(i, map.size);
      }
      out.push(map.get(i));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(out); g.computeVertexNormals();
    return g;
  },
  skinTexture(o) {
    const c = makeCanvas(1024, 1024), x = c.getContext('2d');
    x.drawImage(this.col, 0, 0, 1024, 1024);
    const skin = x.getImageData(560, 360, 1, 1).data;
    const skinCol = `rgb(${skin[0]},${skin[1]},${skin[2]})`;
    if (o.shave !== false) {
      // clean-shaven: cover the scan's stubble, then restore lips and nose from the original
      x.save(); x.filter = 'blur(18px)'; x.globalAlpha = o.shave === 'light' ? 0.55 : 0.88;
      x.fillStyle = skinCol; x.beginPath(); x.ellipse(512, 590, 215, 200, 0, 0, 7); x.fill();
      x.restore();
      x.save(); x.beginPath(); x.ellipse(512, 478, 70, 26, 0, 0, 7); x.ellipse(512, 372, 52, 64, 0, 0, 7); x.clip(); x.drawImage(this.col, 0, 0, 1024, 1024); x.restore();
    }
    if (o.beard) {
      const R = mulberry32(o.seed || 3);
      x.save(); x.beginPath(); x.ellipse(512, 610, 200, 190, 0, 0, 7); x.clip();
      x.filter = 'blur(0.6px)';
      for (let i = 0; i < 26000; i++) {
        const px = 312 + R() * 400, py = 430 + R() * 380;
        if (Math.hypot((px - 512) / 72, (py - 478) / 26) < 1) continue;          // keep the lips clear
        const edge = Math.hypot((px - 512) / 200, (py - 610) / 190);
        x.strokeStyle = `rgba(${o.beard},${(0.18 + R() * 0.35) * (1 - Math.max(0, edge - 0.75) * 4)})`; x.lineWidth = 0.6 + R() * 0.6;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 2, py + 2 + R() * 3.5); x.stroke();
      }
      x.restore();
    }
    if (o.lips) {
      // a touch of colour on the lips and cheeks
      x.save(); x.filter = 'blur(6px)'; x.fillStyle = o.lips; x.beginPath(); x.ellipse(512, 480, 62, 20, 0, 0, 7); x.fill(); x.restore();
      x.save(); x.filter = 'blur(30px)'; x.fillStyle = 'rgba(200,90,90,0.10)'; for (const cx of [380, 644]) { x.beginPath(); x.ellipse(cx, 420, 60, 40, 0, 0, 7); x.fill(); } x.restore();
    }
    // brows & lash line in the person's hair colour
    // skin tone
    x.save(); x.globalCompositeOperation = 'multiply'; x.fillStyle = o.tone || '#ffffff'; x.fillRect(0, 0, 1024, 1024); x.restore();
    const s2 = x.getImageData(560, 360, 1, 1).data;
    this._lastSkin = new THREE.Color(`rgb(${s2[0]},${s2[1]},${s2[2]})`);
    const t = canvasTexture(c); t.anisotropy = 8;
    return t;
  },
  hairTexture(col, seed = 1, long = false) {
    const c = makeCanvas(512, 512), x = c.getContext('2d');
    // alpha 0.6–1 strand noise feathers the hairline against the vertex-alpha ramp (alphaTest 0.5)
    x.globalAlpha = 0.6; x.fillStyle = col; x.fillRect(0, 0, 512, 512); x.globalAlpha = 1;
    const R = mulberry32(seed);
    x.strokeStyle = col; x.lineWidth = 1.4;
    const len = long ? 4 : 1;   // long, combed strands vs short cropped hair
    for (let i = 0; i < 7000; i++) { const px = R() * 512, py = R() * 512; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 3, py + (5 + R() * 9) * len); x.stroke(); }
    for (let i = 0; i < 9000; i++) {
      const px = R() * 512, py = R() * 512;
      x.strokeStyle = R() < 0.5 ? `rgba(0,0,0,${long ? 0.15 : 0.25})` : `rgba(255,255,255,${long ? 0.07 : 0.12})`; x.lineWidth = 0.8;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 4, py + (6 + R() * 10) * len); x.stroke();
    }
    return canvasTexture(c);
  },
  irisTexture(col) {
    const W = 256, H = 128, c = makeCanvas(W, H), x = c.getContext('2d');
    const g = x.createRadialGradient(W * 0.25, H * 0.5, 4, W * 0.25, H * 0.5, W * 0.3);
    g.addColorStop(0, '#fbfaf6'); g.addColorStop(0.7, '#efe8e2'); g.addColorStop(1, '#d9b9b0');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const sh = x.createLinearGradient(0, H * 0.25, 0, H * 0.5); sh.addColorStop(0, 'rgba(60,30,25,0.55)'); sh.addColorStop(1, 'rgba(60,30,25,0)'); x.fillStyle = sh; x.fillRect(0, 0, W, H * 0.5);
    x.save(); x.translate(W * 0.25, H * 0.5);
    const ig = x.createRadialGradient(0, 0, 2, 0, 0, W * 0.075);
    ig.addColorStop(0, '#000'); ig.addColorStop(0.3, '#000'); ig.addColorStop(0.4, col); ig.addColorStop(0.85, col); ig.addColorStop(1, '#1a1410');
    x.fillStyle = ig; x.beginPath(); x.arc(0, 0, W * 0.08, 0, 7); x.fill();
    for (let k = 0; k < 60; k++) { const a = k / 60 * Math.PI * 2; x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 0.6; x.beginPath(); x.moveTo(Math.cos(a) * 7, Math.sin(a) * 7); x.lineTo(Math.cos(a) * W * 0.07, Math.sin(a) * W * 0.07); x.stroke(); }
    x.restore();
    return canvasTexture(c);
  },
  // Softer, narrower jaw and chin for female crew (the scan is a male head).
  femaleGeo() {
    if (this._fem) return this._fem;
    const P = this.P.clone(), ey = (this.eyes[0].y + this.eyes[1].y) / 2;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const low = smooth(ey - 0.5, ey - 2.4, y);                  // 0 below the eyes → 1 at the chin
      const k = 1 - 0.13 * low;
      P.setX(i, x * k);
      if (z > 0.6) P.setZ(i, z - 0.12 * low * smooth(0.6, 1.8, z)); // less prominent chin
      if (y > ey + 0.3 && z > 1.2) P.setZ(i, P.getZ(i) - 0.06 * smooth(ey + 0.3, ey + 0.9, y) * (1 - smooth(ey + 1.4, ey + 2.2, y))); // softer brow ridge
    }
    const g = this.headGeo.clone(); g.setAttribute('position', P);
    return (this._fem = g);
  },
  // Returns a group in head-local space (faces -z) and the matching skin colour
  build(o) {
    const S = this.S, grp = new THREE.Group();
    const inner = new THREE.Group(); inner.rotation.y = Math.PI; inner.scale.setScalar(S * (o.headScale || 1));
    const ey = (this.eyes[0].y + this.eyes[1].y) / 2;
    inner.position.set(0, -0.06 - ey * S, 0);
    grp.add(inner);
    const skinMap = this.skinTexture(o);
    const skinMat = new THREE.MeshStandardMaterial({ map: skinMap, normalMap: this.nrm, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.58, metalness: 0, envMapIntensity: 0.5 });
    const head = new THREE.Mesh(o.female ? this.femaleGeo() : this.headGeo, skinMat); head.castShadow = true; head.receiveShadow = true; inner.add(head);
    // eye sockets (dark back-face so the openings never show through the skull)
    const socketMat = new THREE.MeshStandardMaterial({ color: 0x5a2c26, roughness: 0.6 });
    const irisMat = new THREE.MeshStandardMaterial({ map: this.irisTexture(o.iris || '#5a3a22'), roughness: 0.12, metalness: 0, envMapIntensity: 0.8 });
    const eyes = [];
    for (const e of this.eyes) {
      const sock = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), socketMat); sock.position.set(e.x, e.y - 0.03, e.z - 0.42); inner.add(sock);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.255, 24, 16), irisMat);
      ball.position.set(e.x, e.y - 0.03, e.z - 0.23); inner.add(ball); eyes.push(ball);
    }
    const lashMat = new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 0.9 });
    for (const [up, lo] of this.lashGeos) { inner.add(new THREE.Mesh(up, lashMat)); inner.add(new THREE.Mesh(lo, lashMat)); }
    if (o.hairStyle && o.hairStyle !== 'bald') {
      const hm = new THREE.MeshStandardMaterial({ map: this.hairTexture(o.hairCol || '#2a1c12', o.seed || 1, o.female), vertexColors: true, alphaTest: 0.5, roughness: 0.75, metalness: 0.0 });
      const hair = new THREE.Mesh(this.hairGeo(o.hairStyle, o.female), hm); hair.castShadow = true; inner.add(hair);
      if (o.hairStyle === 'bun') {
        // hair gathered into a low bun at the back of the head
        const bm = new THREE.MeshStandardMaterial({ map: this.hairTexture(o.hairCol || '#2a1c12', (o.seed || 1) + 7, true), roughness: 0.75 });
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.85, 18, 14), bm); bun.scale.set(1.15, 0.95, 0.85); bun.position.set(0, 1.55, -2.35); bun.castShadow = true; inner.add(bun);
        const tie = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.1, 8, 20), new THREE.MeshStandardMaterial({ color: 0x1a2233, roughness: 0.6 })); tie.position.set(0, 1.62, -1.85); inner.add(tie);
      }
    }
    return { group: grp, skin: this._lastSkin, eyes };
  },
};
