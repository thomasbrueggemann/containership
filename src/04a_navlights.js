// ============================================================================
// 04a — NAVIGATION LIGHTS (COLREG rules 21–23). At night a vessel is her lights, and which of them you can see tells you which way she
// is facing: a masthead light is shown over a 225° arc ahead, the green sidelight over the starboard bow (from dead ahead to 22.5°
// abaft the beam), the red one over the port bow, the stern light over 135° astern. So each light here is a glow sprite that is only
// drawn while the camera is inside its sector (fading over a few degrees), kept a visible point at miles by never letting it shrink
// below a minimum angular size, and faded out beyond the legal visibility of its class. Added to every vessel under way; moored ships
// show none (nothing requires them to). Positions are in the vessel's own frame: x to starboard, y up, z aft.
// ============================================================================
const NAVLIGHTS = {
  vessels: [], _v: new THREE.Vector3(),
  KIND: {
    mast: { hex: 0xfff2da, rgb: '255,248,230', axis: 0, half: 112.5 },        // masthead (forward, and the higher one aft)
    stbd: { hex: 0x20ff60, rgb: '40,255,100', axis: 54.5, half: 58 },          // starboard sidelight, green: dead ahead to 22.5° abaft the beam, and a few degrees across the bow
    port: { hex: 0xff2a1a, rgb: '255,40,30', axis: -54.5, half: 58 },          // port sidelight, red (the screens of the two cross a little so that a ship end-on shows both)
    stern: { hex: 0xfff2da, rgb: '255,248,230', axis: 180, half: 67.5 },       // stern light
    all: { hex: 0xfff2da, rgb: '255,248,230', axis: 0, half: 180 },            // all-round white (anchor light)
    allRed: { hex: 0xff2a1a, rgb: '255,40,30', axis: 0, half: 180 },           // all-round red (pilot vessel)
  },
  // grp: the vessel; lights: [[kind, x, y, z, size (m, the lamp's glow at close range)], …]; big: 50 m or more (longer legal ranges)
  attach(grp, lights, big = true) {
    if (!ENV.night || !lights.length) return;
    const list = lights.map(([kind, x, y, z, size = 1.2]) => {
      const K = NAVLIGHTS.KIND[kind], spr = glowSprite(K.hex, size, grp, x, y, z, K.rgb, 6);
      return { spr, K, x, y, z, size, range: (kind === 'mast' ? (big ? 11000 : 5500) : (big ? 5500 : 3700)) * (kind === 'stern' ? 1 : 1) };
    });
    this.vessels.push({ grp, list });
  },
  update(cp) {
    if (!ENV.night) return;
    const v = this._v;
    for (const V of this.vessels) {
      const g = V.grp, on = g.visible && (!g.userData.navOn || g.userData.navOn());
      if (!on) { for (const L of V.list) L.spr.visible = false; continue; }
      v.copy(cp); g.worldToLocal(v);
      for (const L of V.list) {
        const dx = v.x - L.x, dy = v.y - L.y, dz = v.z - L.z, dist = Math.hypot(dx, dy, dz);
        let a = 1;
        if (L.K.half < 180) {
          let d = Math.atan2(dx, -dz) * 180 / Math.PI - L.K.axis; d = ((d + 540) % 360) - 180;      // bearing of the observer from the light, relative to the sector's axis
          a = clamp((L.K.half - Math.abs(d)) / 4 + 0.5, 0, 1);
        }
        a *= 1 - smooth(0.72, 1.0, dist / L.range);
        // a viewer a few metres from the lamp itself (the wing, the deck) is inside its housing, not looking at it
        a *= smooth(2.5, 7, dist);
        L.spr.visible = a > 0.01;
        if (L.spr.visible) { L.spr.material.opacity = a; L.spr.scale.setScalar(Math.max(L.size * 0.5, dist * 0.018)); }
      }
    }
  },
};
