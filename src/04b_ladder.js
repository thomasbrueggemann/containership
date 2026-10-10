// ============================================================================
// 04b — PILOT LADDERS. "Rig the pilot ladder" is a step of the arrival, and until now nothing hung over the side. A real pilot ladder
// (SOLAS V/23, IMO A.1045) is two side ropes with wooden steps every 31–35 cm, a longer spreader step every ninth step to keep it from
// twisting, hung flat against the hull from the deck edge to about 1.5–2 m above the water, where the pilot boat comes alongside. One per
// side, hidden until the scenario has it rigged on the lee side (updateShipVisual), taken in again once the pilot has come to the bridge.
// The ladder follows the hull's curve (steps are put at the hull's half-breadth for their height), so it lies against the plating.
// ============================================================================
function buildPilotLadders(grp, o, zL = 10) {
  const S = (o.L / 2 - zL) / o.L, top = o.D + 0.9, bot = 2.0, pitch = 0.33, n = Math.floor((top - bot) / pitch);
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a7444, roughness: 0.8 }), rope = new THREE.MeshStandardMaterial({ color: 0xcdbf98, roughness: 0.95 });
  const out = {};
  for (const [name, side] of [['STBD', 1], ['PORT', -1]]) {
    const g = new THREE.Group(); g.visible = false; g.name = 'pilotLadder' + name;
    const B = new Batcher(), xAt = (y) => side * (hullHalfBreadth(S, Math.min(y, o.D), o) + 0.06);
    for (let k = 0; k <= n; k++) {
      const y = bot + k * pitch, spreader = k % 9 === 0;
      B.box(wood, 0.13, 0.026, spreader ? 1.95 : 0.52, xAt(y) + side * 0.02, y, zL);
      if (k < n) { const ym = y + pitch / 2; for (const dz of [-0.24, 0.24]) B.box(rope, 0.034, pitch + 0.02, 0.034, xAt(ym) + side * 0.05, ym, zL + dz); }       // the two side ropes, segment by segment
    }
    for (const dz of [-0.24, 0.24]) B.box(rope, 0.034, 1.6, 0.034, xAt(top) + side * 0.05, top + 0.7, zL + dz);        // their ends, made fast above the rail
    B.build(g, { cast: false });
    grp.add(g); out[name] = g;
  }
  return out;
}
