// ============================================================================
// 11 — SCENARIO: arrival procedure, radio traffic, pilot, scoring
// ============================================================================
const SCN = {
  steps: [], cur: 0, timers: [], once: {}, done: false, failed: null, lineMeshes: [], contactCool: 0,
  init() {
    const s = G.ship, F = G.flags;
    const rel = wrap180(s.windFrom / DEG - 90);
    F.leeSide = rel > 0 ? 'PORT' : 'STBD';
    F.berthSide = 'PORT';
    const lee = F.leeSide.toLowerCase();
    this.steps = [
      { id: 'standby', title: 'Stand-by engines', phase: 'Arrival',
        text: 'Approaching port at sea speed. Warn the engine room and switch the main engines from sea passage to manoeuvring (stand-by) mode. Until then the engines follow the slow sea load-up programme and astern is blocked.',
        how: ['Click STANDBY on the engine panel (right of the wheel)', 'or pick up the red ECR phone', 'or Tab → 3/O Mehta → “Ring stand-by engine”'],
        done: () => s.engineMode === 'STANDBY' },
      { id: 'vts', title: 'Report to Westerhaven VTS', phase: 'Arrival',
        text: 'Call Westerhaven Traffic on VHF channel 11 with your ETA, draft and destination. VTS will give you pilot boarding instructions and traffic.',
        how: ['VHF (console left of centre): CH ▲/▼ to channel 11, then CALL', 'or Tab → 2/O Santos → “Call VTS on channel 11”'],
        done: () => F.vtsReported },
      { id: 'slow', title: 'Reduce to pilot speed', phase: 'Arrival',
        text: 'The pilot boards at the pilot boarding place (magenta Ⓟ on the ECDIS). Bring her down to 6–10 knots. A 224 000 t ship takes minutes to slow — start early.',
        how: ['↓ arrow: telegraph to HALF AHEAD, later SLOW AHEAD', 'Watch STW / SOG on the overhead panel and conning', 'Use ] to speed up time while waiting'],
        done: () => s.sog / KN < 10.5 },
      { id: 'ladder', title: 'Pilot ladder & hand steering', phase: 'Pilotage',
        text: `Rig the pilot ladder on the ${lee} (lee) side and put the ship in hand steering — pilots always ask for a helmsman.`,
        how: [`Tab → 3/O Mehta → “Rig the pilot ladder — ${lee} side”`, 'Tab → AB Reyes → “Take the wheel — hand steering”', 'or press HAND on the steering panel and steer yourself'],
        done: () => F.ladder && G.steering !== 'AUTO' },
      { id: 'pilot', title: 'Embark the pilot', phase: 'Pilotage',
        text: `Keep 6–10 kn and a steady heading around 090° while the pilot boat comes alongside to ${lee}. The pilot climbs the ladder and comes up to the bridge.`,
        how: ['Helm orders: ← → (5°), Shift for 10°, X = midships', 'Or order the AB “Steer a course… 090”', 'Watch the pilot boat from the ' + lee + ' bridge wing (key ' + (lee === 'port' ? '2' : '3') + ')'],
        done: () => F.pilotOnBridge },
      { id: 'channel', title: 'Run the Westgeul channel', phase: 'Pilotage',
        text: 'Follow the route between the buoys, keep to the starboard (south) side, max 12 kn. Outbound HANSA EXPRESS passes port-to-port. Red buoys to port, green to starboard.',
        how: ['Ask the pilot: “Pilot, take the con through the channel” — or steer yourself', 'ECDIS: orange route, grey predictor outlines show where you will be in 30/60/90 s', 'Hoist flag H (3/O) now the pilot is aboard'],
        done: () => s.x > -5200 },
      { id: 'tugs', title: 'Take the tugs', phase: 'Harbour',
        text: 'Two ASD tugs (70 t bollard pull) meet you before the breakwater. Tugs can only pass their lines below ~6 knots.',
        how: ['VHF channel 12 → CALL, or ask the pilot / 2nd Officer to order tugs', 'Telegraph DEAD SLOW AHEAD (or STOP) — below 6 kn', 'Start the bow thrusters now (BT START, or 3/O)'],
        done: () => s.tugs[0].attached && s.tugs[1].attached },
      { id: 'stations', title: 'Mooring stations', phase: 'Harbour',
        text: 'Send the Chief Officer forward and the 2nd Officer aft. They prepare the lines and stand by the anchors, then report on the UHF.',
        how: ['Tab → C/O Nielsen → “Man the forward mooring station”', 'Tab → 2/O Santos → “Man the aft mooring station”'],
        done: () => F.fwdStation && F.aftStation },
      { id: 'harbour', title: 'Enter between the breakwaters', phase: 'Harbour',
        text: 'Pass between the breakwater heads (red light to port, green to starboard) at 5 knots or less, with the bow thrusters running.',
        how: ['Keep on the leading line 090° (orange/white daymarks ahead)', 'Bow thrusters ready (BT START)', 'Engine: STOP / DEAD SLOW to carry just enough way'],
        done: () => s.x > -2400 && G.thrReady },
      { id: 'berth', title: 'Alongside Berth 4', phase: 'Berthing',
        text: 'Berth 4 is on the north quay, between the yellow STERN/BOW boards, cranes with booms raised. Bring her parallel, stop her with the midship abeam the “B4 MID” board, then walk her sideways onto the fenders at under 15 cm/s. Either side to.',
        how: ['Engines fore & aft; tugs and bow thrusters sideways (T = tug panel, Q/E = thrusters)', 'Or: Tab → Pilot → “Handle the tugs for berthing” and just work the engines', 'Docking display (G) / wing consoles show bow & stern distance and approach speed', 'Walk to a bridge wing (2/3) and look down through the glass floor'],
        done: () => { const bi = berthInfo(); return bi && bi.q.id === 'N' && bi.bow.d < 1.5 && bi.stern.d < 1.5 && Math.abs(bi.berthOff) < 40 && s.sog < 0.12; } },
      { id: 'lines', title: 'Make fast', phase: 'Berthing',
        text: 'All along the fenders. Get the mooring lines out: head lines, breast lines and springs forward and aft. Keep her pressed in with the tugs until lines are fast.',
        how: ['Tab → C/O → “Forward: send lines ashore”', 'Tab → 2/O → “Aft: send lines ashore”'],
        done: () => F.linesFwd && F.linesAft },
      { id: 'fwe', title: 'Finished with engines', phase: 'Berthing',
        text: 'All fast fore and aft. Let the tugs go, stop the engines and ring FINISHED WITH ENGINES.',
        how: ['Telegraph to STOP', 'Tug panel or Pilot → “Let go the tugs”', 'Press FWE on the engine panel (or phone the ECR)'],
        done: () => s.engineMode === 'FWE' },
    ];
    this.cur = 0;
    this.later(3, () => this.say('co', greeting() + ', Captain. We are eight and a half miles west of Westerhaven, sixteen knots on autopilot, heading zero-nine-zero. Engine room is waiting for stand-by. Pilot is ordered for the boarding place.'));
    this.later(28, () => this.say('vts', 'All stations, this is Westerhaven Traffic. Wind south-west, ' + Math.round(s.windSpeed / KN) + ' knots. Flood tide setting north-east, half a knot. Westgeul fairway: one outbound, HANSA EXPRESS. Out.', true));
    UI.updateMission(true);
  },
  say(id, t, radio) { CREW.say(id, t, radio); },
  flag(k) { G.flags[k] = true; },
  // Delayed events. Pass a function for throw-away chatter, or the name of a TIMED action
  // (plus a JSON-able argument) for anything that changes game state, so saves can restore it.
  later(sec, fn, arg) { this.timers.push(typeof fn === 'string' ? { t: G.simT + sec, key: fn, arg } : { t: G.simT + sec, fn }); },
  runTimer(t) { if (t.key) this.TIMED[t.key](t.arg); else t.fn(); },
  TIMED: {
    engMode(m) {
      const s = G.ship; s.engineMode = m; G.pendingMode = null;
      CREW.say('ce', { STANDBY: 'Bridge, engine room: engines on stand-by. Manoeuvring mode, astern available.', SEA: 'Bridge: sea mode.', FWE: 'Bridge: engines secured.' }[m], true);
      SCN.flag('eng_' + m);
    },
    thrReady() { G.thrReady = true; G.thrStarting = false; BR.controls.btStart.setLit(true, 0x40ff80); UI.toast('Bow thrusters READY'); SCN.flag('bt'); },
    stationReady(st) {
      G.flags[st + 'Station'] = true; CREW.showStation(st, true);
      SCN.say(st, st === 'fwd' ? 'Bridge, forward station: manned and ready. Both anchors cleared away, lines ready port and starboard.' : 'Bridge, aft: aft station manned, lines ready, propellers clear.', true);
      SCN.flag(st + 'Station');
    },
    ladderDone() {
      const F = G.flags; F.ladder = true; F.ladderRigging = false;
      SCN.say('o3', 'Bridge, pilot ladder rigged ' + F.leeSide.toLowerCase() + ' side, two metres. Deck lights on the ladder. Returning to the bridge.', true);
      SCN.later(60, 'o3Return');
    },
    o3Return() { const o3 = CREW.byId('o3'); o3.enter('tele', () => o3.goHome()); },
    pilotEnter() {
      const p = CREW.byId('pilot');
      p.setHome('pilot', 0, null); p.enter('pilot', () => p.goHome());
      G.flags.pilotOnBridge = true;
      SCN.say('pilot', greeting() + ', Captain. Hendrik de Vries, Westerhaven pilots. Thank you for the lee. Pilot card, please — ah, fourteen and a half metres. We go Berth four, port side alongside, two tugs at the breakwater. Keep her on zero-nine-zero at about ten knots.');
      SCN.later(40, () => { if (!G.flags.hflag) SCN.say('o3', 'Captain, shall I hoist the H flag?'); });
    },
    linesFast({ st, side }) { SCN.makeFast(st, side); },
    pbNag() { PILOTBOAT._nag = false; },
  },
  recommended(k) {
    const st = this.steps[this.cur]; if (!st) return false;
    const map = { standby: ['o3_sb'], vts: ['o2_vts'], ladder: ['o3_ladder', 'ab_wheel'], pilot: ['ab_course', 'ab_steady'], channel: ['pi_con', 'o3_h', 'pi_advice'], tugs: ['pi_tugs', 'o2_tugs', 'o3_bt'], stations: ['co_fwd', 'o2_aft'], harbour: ['o3_bt', 'pi_advice'], berth: ['pi_tugauto', 'co_dist', 'o2_dist'], lines: ['co_lines', 'o2_lines'], fwe: ['pi_letgo'] };
    return (map[st.id] || []).includes(k);
  },
  update(dt) {
    const s = G.ship, F = G.flags;
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) if (G.simT >= this.timers[i].t) { const t = this.timers.splice(i, 1)[0]; this.runTimer(t); }
    if (this.done || this.failed) return;
    // step progression: a step counts as done the moment it is achieved, in any order (e.g. the VTS
    // report before stand-by); the panel then moves on to the first step that is still open
    let ticked = false;
    for (let i = this.cur; i < this.steps.length; i++) {
      const st = this.steps[i];
      if (!st.ok && st.done()) { st.ok = true; ticked = true; if (i > this.cur) UI.toast('✓ ' + st.title, 'info'); }
    }
    if (ticked) { AUDIO.tone(880, 0.15, 'sine', 0.05); AUDIO.tone(1320, 0.2, 'sine', 0.05, 0.12); }
    while (this.cur < this.steps.length && this.steps[this.cur].ok) {
      this.cur++;
      if (this.cur >= this.steps.length) { UI.updateMission(true); this.complete(); return; }
      this.onStep(this.steps[this.cur].id);
    }
    if (ticked) UI.updateMission(true);
    UI.updateMission(false);
    F.berthSide = Math.abs(wrap180(s.psi / DEG - 90)) < 90 ? 'PORT' : 'STBD';
    // monitors
    const kn = s.sog / KN;
    if (s.x > -12000 && s.x < -2700 && kn > 12.8) this.penalty('Over 12 kn in the Westgeul channel', 50, 'spd1', () => this.say('vts', 'Majestic Maersk, Westerhaven Traffic: you are doing ' + kn.toFixed(0) + ' knots. Speed limit in the Westgeul is twelve, over.', true));
    if (s.x > -2700 && kn > 6.8) this.penalty('Over 6 kn inside the breakwaters', 75, 'spd2', () => this.say(F.pilotOnBridge ? 'pilot' : 'co', 'Captain, she is far too fast for the harbour — we need to take the way off her!'));
    if (s.x > -2600 && !F.pilotOnBridge) this.penalty('Entered harbour without a pilot', 150, 'nopilot', () => this.say('vts', 'Majestic Maersk, Westerhaven Traffic: pilotage is compulsory. Where is your pilot?', true));
    const rp = routeProgress(s);
    if (s.x < -2700 && Math.abs(rp.xte) > 320) this.penalty('Left the dredged channel', 40, 'xte', () => this.say('o2', 'Captain, we are ' + Math.abs(rp.xte).toFixed(0) + ' metres ' + (rp.xte > 0 ? 'south' : 'north') + ' of the track — outside the channel!'));
    if (s.x > -8000 && !TUGS.ordered && !this.once.tugHint) { this.once.tugHint = true; this.say(F.pilotOnBridge ? 'pilot' : 'co', 'Captain, time to order the tugs — they need twenty minutes to reach us.'); }
    if (s.x > -4800 && kn > 7.5 && !this.once.slowHint) { this.once.slowHint = true; this.say(F.pilotOnBridge ? 'pilot' : 'co', 'Captain, we need to be below six knots at the breakwater for the tugs. I suggest slow ahead now, then stop.'); }
    if (G.ship.grounded > 0.25) this.penalty('Touched bottom', 120, 'ground1', () => { AUDIO.thud(1.5); this.say('co', 'Captain! We are touching bottom — she is dragging!'); });
    if (G.ship.grounded > 1.2 && s.sog < 0.3) this.fail('AGROUND', 'Majestic Maersk ran aground outside the dredged depth. The ship is stuck — salvage tugs are on their way.');
    // pilot auto advice & conning
    if (F.pilotOnBridge) { this.pilotT = (this.pilotT || 0) + dt; if (this.pilotT > 100) { this.pilotT = 0; this.pilotAdvice(false); } }
    if (G.pilotCon) this.pilotConning(dt);
    // alongside flag
    const bi = berthInfo();
    if (bi && bi.q.id === 'N' && bi.bow.d < 3 && bi.stern.d < 3 && Math.abs(bi.berthOff) < 45) F.alongside = true;
    if (this.contactCool > 0) this.contactCool -= dt;
    // BNWAS timer
    G.bnwasT = (G.bnwasT || 0) + dt;
    // outbound passing calls
    const hx = TRAFFIC.ships.find((o) => o.name === 'HANSA EXPRESS');
    if (hx && hx.active && !this.once.hxcall && Math.hypot(hx.x - s.x, hx.z - s.z) < 5000) { this.once.hxcall = true; this.say('vts', 'Majestic Maersk, HANSA EXPRESS: we are outbound, request port-to-port passing, over.', true); this.later(6, () => F.pilotOnBridge ? this.say('pilot', 'HANSA EXPRESS, Majestic Maersk: port to port, we keep to the south side. Good watch.', true) : this.say('co', 'Captain, HANSA EXPRESS wants port-to-port. We keep to the south side of the channel.')); }
    // mooring lines visuals
    for (const L of this.lineMeshes) {
      const [ax, az] = s.toWorld(L.xb, L.yb);
      const p0 = new THREE.Vector3(ax, 17.2, az), p1 = new THREE.Vector3(L.qx, QUAY_H + 1.2, L.qz);
      const len = p0.distanceTo(p1);
      L.mesh.position.copy(p0).add(p1).multiplyScalar(0.5); L.mesh.scale.set(1, len, 1);
      L.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
    }
  },
  onStep(id) {
    const s = G.ship;
    if (id === 'ladder') this.say('co', 'Captain, the pilot boat will want the ladder on the ' + G.flags.leeSide.toLowerCase() + ' side and a helmsman on the wheel.');
    if (id === 'tugs' && !TUGS.ordered) this.say(G.flags.pilotOnBridge ? 'pilot' : 'co', 'Captain, let us get the tugs ordered.');
    if (id === 'berth') this.say(G.flags.pilotOnBridge ? 'pilot' : 'co', 'Berth four is ahead on the port side, Captain — the four cranes with booms up. Line her up parallel about a hundred metres off, stop her abeam the mark, then walk her in with the tugs.');
    if (id === 'lines') this.say('pilot', 'Nicely done, Captain. All along — send the lines.');
    if (id === 'fwe') this.say('pilot', 'All fast. I will let the tugs go when you are ready.');
  },
  pilotBoarded() {
    this.say('pb', 'Pilot is on the ladder… pilot aboard! Thank you, Majestic Maersk.', true);
    this.later(110, 'pilotEnter');
  },
  rigLadder() {
    const F = G.flags; F.ladderRigging = true;
    this.say('o3', 'Rigging the pilot ladder on the ' + F.leeSide.toLowerCase() + ' side, two metres above the water. Lifebuoy and heaving line ready.');
    CREW.byId('o3').leave();
    this.later(150, 'ladderDone');
  },
  // ------------------------------------------------ radio
  vhfCall() {
    AUDIO.squelch();
    const ch = G.vhfCh;
    if (ch === 11) return this.vtsCall('me');
    if (ch === 12) return this.tugCall('me');
    if (ch === 14) return G.flags.vtsReported ? this.say('pb', 'Majestic Maersk, pilot boat. Ladder ' + G.flags.leeSide.toLowerCase() + ' side, eight knots please. We will be alongside shortly.', true) : this.say('pb', 'Majestic Maersk, pilots: please report to VTS on channel eleven first.', true);
    if (ch === 16) return this.say('vts', 'Vessel calling on sixteen, this is Westerhaven Traffic. Channel sixteen is for calling and distress only — go to channel eleven.', true);
    this.say('me', '(Only static on channel ' + ch + '.)');
  },
  vtsCall(who) {
    const s = G.ship, F = G.flags;
    const eta = clockStr(false);
    if (!F.vtsReported) {
      this.say(who === 'o2' ? 'o2' : 'me', 'Westerhaven Traffic, Westerhaven Traffic, this is Majestic Maersk, Majestic Maersk, call sign OYGR2. Inbound, ' + (Math.abs(s.x - GEO.seaBuoy[0]) / NM).toFixed(1) + ' miles from the fairway buoy, draft fourteen decimal five, for Berth four Deepsea Terminal. Over.', true);
      this.later(4, () => {
        this.say('vts', 'Majestic Maersk, Westerhaven Traffic, ' + greeting(false) + '. Pilot boarding at the boarding place, ladder ' + F.leeSide.toLowerCase() + ' side, two metres, speed eight knots. Outbound HANSA EXPRESS departing, pass port to port in the Westgeul. Tugs available at the breakwater on channel twelve. Report when pilot on board. Over.', true);
        F.vtsReported = true;
      });
    } else if (F.pilotOnBridge && !this.once.vtsPob) {
      this.once.vtsPob = true;
      this.say('me', 'Westerhaven Traffic, Majestic Maersk: pilot on board, proceeding inbound. Over.', true);
      this.later(3, () => this.say('vts', 'Majestic Maersk, Traffic: roger, pilot on board. Westgeul is clear for you apart from the outbound. Out.', true));
      this.bonus('Reported pilot on board to VTS', 20, 'vtspob');
    } else this.say('vts', 'Majestic Maersk, Traffic: nothing further for you. Continue inbound, channel eleven. Out.', true);
  },
  tugCall(who) {
    if (TUGS.ordered) { this.say('t1', 'Majestic Maersk, Titan: we are on our way, Captain.', true); return; }
    TUGS.order();
    const caller = who === 'pilot' ? 'pilot' : who === 'o2' ? 'o2' : 'me';
    this.say(caller, 'Titan, Hercules, this is Majestic Maersk. Please meet us at the breakwater: Titan forward centre lead, Hercules aft. We will be at about five knots. Over.', true);
    this.later(5, () => this.say('t1', 'Titan copied — making fast forward, centre lead. On our way.', true));
    this.later(9, () => this.say('t2', 'Hercules, aft. Copied, on our way.', true));
    this.flag('tugsOrdered');
  },
  // ------------------------------------------------ reports
  reportDistance(st) {
    const bi = berthInfo();
    if (!bi || bi.dc > 600) { this.say(st, st === 'fwd' ? 'Forward: no quay close yet, Captain.' : 'Aft: nothing close, Captain.', true); return; }
    const e = st === 'fwd' ? bi.bow : bi.stern;
    const sp = e.vIn;
    this.say(st, (st === 'fwd' ? 'Forward: bow ' : 'Aft: stern ') + e.d.toFixed(0) + ' metres off the fenders, ' + (Math.abs(sp) < 0.02 ? 'steady' : sp > 0 ? 'closing ' + (sp * 100).toFixed(0) + ' centimetres per second' : 'opening') + '.', true);
  },
  reportPosition() {
    const s = G.ship, rp = routeProgress(s);
    const near = GEO.buoys.reduce((a, b) => { const d = Math.hypot(b.x - s.x, b.z - s.z); return !a || d < a.d ? { b, d } : a; }, null);
    this.say('o2', 'Captain, we are ' + (near.d / NM).toFixed(1) + ' miles from ' + near.b.name + ', ' + Math.abs(rp.xte).toFixed(0) + ' metres ' + (rp.xte > 0 ? 'south' : 'north') + ' of the track. Next waypoint ' + ROUTE_NAMES[rp.next] + ', bearing ' + pad(rp.brg) + ', ' + rp.dist.toFixed(1) + ' miles. Speed over ground ' + (s.sog / KN).toFixed(1) + ' knots. Under-keel clearance ' + s.ukc.toFixed(1) + ' metres.');
  },
  reportTraffic() {
    const s = G.ship;
    const l = TRAFFIC.all().map((t) => ({ t, d: Math.hypot(t.x - s.x, t.z - s.z) })).sort((a, b) => a.d - b.d).slice(0, 3);
    if (!l.length) { this.say('o2', 'No traffic of concern, Captain.'); return; }
    this.say('o2', 'Traffic: ' + l.map(({ t, d }) => t.name + ', ' + (d / NM).toFixed(1) + ' miles, bearing ' + pad(wrap360(Math.atan2(t.x - s.x, -(t.z - s.z)) / DEG))).join('; ') + '.');
  },
  checklistReport(who) {
    const pending = this.steps.slice(this.cur, this.cur + 3).map((s) => s.title.toLowerCase());
    this.say(who, 'Captain, still open: ' + pending.join(', ') + '.');
  },
  pilotAdvice(force) {
    const s = G.ship, F = G.flags, kn = s.sog / KN, rp = routeProgress(s), bi = berthInfo();
    let msg = null;
    if (s.x < -2800) {
      if (Math.abs(rp.xte) > 120) msg = 'We are ' + Math.abs(rp.xte).toFixed(0) + ' metres ' + (rp.xte > 0 ? 'south' : 'north') + ' of the line, Captain — a few degrees ' + (rp.xte > 0 ? 'to port' : 'to starboard') + ', course ' + pad(wrap360(rp.legBrg + (rp.xte > 0 ? -4 : 4))) + '.';
      else if (kn > 11.5) msg = 'She is a bit quick. Half ahead is enough in the channel.';
      else if (!TUGS.ordered && s.x > -9000) msg = 'Time to call the tugs, Captain.';
      else if (s.x > -6000 && kn > 7) msg = 'I would go slow ahead now and then stop — below six knots at the breakwater for the tugs.';
      else if (force) msg = 'Keep her on the leading lights, zero-nine-zero. The set is to the north-east, allow a degree or two. We are doing fine.';
    } else if (bi && bi.q.id === 'N') {
      const dx = bi.berthOff * Math.sign(Math.sin(s.psi));
      if (!(s.tugs[0].attached && s.tugs[1].attached)) msg = 'Careful, Captain — without both tugs fast I would keep her stopped.';
      else if (kn > 4) msg = 'Too much speed for the basin — stop the engines, maybe slow astern to take the way off.';
      else if (Math.abs(bi.angle) > 6 && bi.dc < 250) msg = 'She is not parallel yet, ' + Math.abs(bi.angle).toFixed(0) + ' degrees. Use the tugs — push the ' + (bi.bow.d > bi.stern.d ? 'bow' : 'stern') + ' in.';
      else if (dx > 40) msg = 'We are ' + dx.toFixed(0) + ' metres ahead of the mark — a touch astern.';
      else if (dx < -40) msg = 'Still ' + (-dx).toFixed(0) + ' metres to go to the mark, dead slow ahead and stop again.';
      else if (Math.max(bi.bow.vIn, bi.stern.vIn) > 0.18) msg = 'Easy — she is coming in at ' + (Math.max(bi.bow.vIn, bi.stern.vIn) * 100).toFixed(0) + ' centimetres a second. Tugs pull off a bit.';
      else if (bi.dc > 20) msg = 'Good position. Now walk her in parallel — tugs toward the quay, about half power, and watch the approach speed.';
      else if (force) msg = 'Very nice, Captain. Just let her settle on the fenders.';
    } else if (force) msg = 'Steady as she goes, Captain.';
    if (msg) this.say('pilot', msg);
  },
  togglePilotCon() {
    const F = G.flags;
    if (G.pilotCon) { G.pilotCon = false; this.say('pilot', 'Your con, Captain.'); return; }
    if (!(G.steering === 'HAND' && CREW.atHelm())) { this.say('pilot', 'Captain, I need a helmsman on the wheel in hand steering for that.'); return; }
    G.pilotCon = true; this.conT = 0; this.conTurn = null; this.conCourseT = -99;
    this.say('pilot', 'I have the con, Captain. I\'ll take her to the breakwater.');
  },
  pilotConning(dt) {
    const s = G.ship;
    this.conT = (this.conT || 0) - dt;
    if (!(G.steering === 'HAND' && CREW.atHelm())) { G.pilotCon = false; this.say('pilot', 'I lost the helmsman — your con, Captain.'); return; }
    if (s.x > -2900) { G.pilotCon = false; this.say('pilot', 'We are at the breakwater. Your ship for the berthing, Captain — I will advise.'); return; }
    // helm: look-ahead point on the route
    const rp = routeProgress(s);
    const a = ROUTE[rp.leg], b = ROUTE[rp.leg + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = ((s.x - a[0]) * (b[0] - a[0]) + (s.z - a[1]) * (b[1] - a[1])) / (L * L) + 900 / L;
    let px, pz; if (t > 1 && ROUTE[rp.leg + 2]) { const c = ROUTE[rp.leg + 2]; const tt = (t - 1) * L / Math.hypot(c[0] - b[0], c[1] - b[1]); px = lerp(b[0], c[0], Math.min(1, tt)); pz = lerp(b[1], c[1], Math.min(1, tt)); } else { px = lerp(a[0], b[0], Math.min(1, t)); pz = lerp(a[1], b[1], Math.min(1, t)); }
    const want = Math.round(wrap360(Math.atan2(px - s.x, -(pz - s.z)) / DEG));
    // Like a real pilot: give the helmsman a course to steer and let him keep it. Helm orders only
    // for a real alteration at a bend ("Port ten… midships… steer 085"), small drifts get a new
    // course at most every 45 s.
    const course = G.abCourse, rot = s.rotDegMin;
    if (this.conTurn != null) {
      const left = wrap180(this.conTurn - s.psi / DEG);
      // check her swing early enough – the helmsman meets her with counter-rudder on the new course
      if (Math.abs(left) < Math.max(4, Math.abs(rot) * 0.35) || Math.sign(left) !== Math.sign(G.helmOrder)) {
        const c = this.conTurn; this.conTurn = null; this.conCourseT = G.simT;
        this.say('pilot', 'Midships… steer ' + pad(c) + '.');
        G.helmOrder = 0; G.abCourse = c; CREW._steadyTold = false;
        CREW.say('ab', 'Midships, steer ' + pad(c) + ', pilot.');
      }
    } else {
      const off = wrap180(want - (course ?? s.psi / DEG));
      if (course == null || Math.abs(off) >= 8) {
        if (Math.abs(off) >= 4) {
          const order = Math.sign(off) * clamp(Math.round(Math.abs(off) / 2.5 / 5) * 5, 10, 20);
          this.conTurn = want;
          this.say('pilot', CREW.helmPhrase(order) + '.');
          G.helmOrder = order; CREW.helmOrder(order, 'pilot'); G.abCourse = null;
        } else { G.abCourse = want; this.conCourseT = G.simT; this.say('pilot', 'Steer ' + pad(want) + '.'); CREW.say('ab', 'Steer ' + pad(want) + ', pilot.'); }
      } else if (Math.abs(off) >= 3 && G.simT - (this.conCourseT ?? -99) > 45) {
        G.abCourse = want; this.conCourseT = G.simT; CREW._steadyTold = true;
        this.say('pilot', 'Steer ' + pad(want) + '.'); CREW.say('ab', 'Steer ' + pad(want) + ', pilot.');
      }
    }
    if (this.conT <= 0) {
      this.conT = 25;                         // let her settle before the next telegraph order
      // engine
      const kn = s.sog / KN, target = s.x < -7000 ? 10 : s.x < -4200 ? 8 : 5;
      let tele = s.tele[0];
      if (kn > target + 1.3 && tele > TELEGRAPH_STOP) tele--;
      else if (kn < target - 1.3 && tele < 8) tele++;
      if (tele !== s.tele[0]) { this.say('pilot', TELEGRAPH[tele].label.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) + ', please.'); s.tele = [tele, tele]; AUDIO.telegraph(); G.bellBook.unshift({ t: G.simT, txt: TELEGRAPH[tele].label + ' (pilot)' }); CREW.teleAck(TELEGRAPH[tele].label, 'pilot'); }
    }
  },
  sendLines(st) {
    const bi = berthInfo(), F = G.flags, s = G.ship;
    const e = bi && (st === 'fwd' ? bi.bow : bi.stern);
    if (!bi || bi.q.id !== 'N' || e.d > 6 || Math.abs(bi.berthOff) > 60) { this.say(st, (st === 'fwd' ? 'Forward' : 'Aft') + ': too far from the quay for the heaving lines, Captain — ' + (e ? e.d.toFixed(0) : '??') + ' metres.', true); return; }
    this.say(st, (st === 'fwd' ? 'Forward: heaving lines ashore… head lines and spring going out.' : 'Aft: stern lines and spring going ashore.'), true);
    this.later(60, 'linesFast', { st, side: bi.side });
  },
  makeFast(st, bside) {
    const F = G.flags, s = G.ship;
    const side = bside === 'PORT' ? -1 : 1;
    const fwd = st === 'fwd';
    const specs = fwd ? [[192, 60], [175, 5], [150, -70], [185, 45]] : [[-192, -60], [-175, -5], [-150, 70], [-188, -45]];
    for (const [xb, ahead] of specs) {
      const [wx] = s.toWorld(xb + ahead, 0);
      this.addLineMesh(fwd, xb, side * 27.5, wx, -703.5);
    }
    F[fwd ? 'linesFwd' : 'linesAft'] = true;
    this.say(st, (fwd ? 'Forward: all fast, four lines out. ' : 'Aft: all fast aft. ') + 'Tight and holding.', true);
    if (F.linesFwd && F.linesAft) {
      const tz = -700 + FENDER + 29.3 + 0.2;
      s.lines = { tx: s.x, tz, tpsi: Math.abs(wrap180(s.psi / DEG - 90)) < 90 ? 90 * DEG : 270 * DEG, tension: 0 };
    }
  },
  // one mooring line from a fairlead (ship frame xb, yb) to a quay bollard (world qx, qz)
  addLineMesh(fwd, xb, yb, qx, qz) {
    const mat = new THREE.MeshStandardMaterial({ color: fwd ? 0xf2e6b0 : 0xd9e8f2, roughness: 0.85 });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1, 6, 1, true), mat); scene.add(mesh);
    this.lineMeshes.push({ mesh, fwd, xb, yb, qx, qz });
  },
  coffee() {
    if (this.once.coffee && G.simT - this.once.coffee < 300) { this.say('co', 'Another one, Captain? That will be the third this watch.'); return; }
    this.once.coffee = G.simT;
    AUDIO.tone(300, 0.6, 'sawtooth', 0.02); AUDIO.tone(220, 1.2, 'sawtooth', 0.015, 0.4);
    const c = ['co', 'o3', 'ab'].map((k) => CREW.byId(k)).find((m) => m && m.present && !(m.id === 'ab' && CREW.atHelm()));
    if (c) CREW.job(c.id, 'coffee', 'coffee', 5); else this.say('me', '(You pour yourself a coffee.)');
  },
  onTraffic(o) { if (o.name === 'HANSA EXPRESS') this.say('vts', 'All stations, Westerhaven Traffic: HANSA EXPRESS departing Deepsea Terminal, outbound Westgeul. Out.', true); },
  // ------------------------------------------------ contacts
  onContact(c) {
    const F = G.flags;
    if (c.kind === 'fender') {
      // evaluate only the first touch of a new landing (off the fenders for > 60 s)
      const fresh = G.simT - (this.lastFenderT ?? -1e9) > 60;
      this.lastFenderT = G.simT;
      if (!fresh) { if (c.normalSpeed > 0.3 && this.contactCool <= 0) { this.contactCool = 20; AUDIO.thud(1); this.penalty('Second hard impact (' + (c.normalSpeed * 100).toFixed(0) + ' cm/s)', 80, 'hit' + Math.floor(G.simT / 30)); } return; }
      this.contactCool = 20;
      const v = c.normalSpeed;
      AUDIO.thud(clamp(v * 5, 0.3, 1.5));
      F.contactSpeeds = F.contactSpeeds || []; F.contactSpeeds.push(v);
      if (v > 0.45) return this.fail('HEAVY CONTACT', 'Majestic Maersk landed on Berth 4 at ' + (v * 100).toFixed(0) + ' cm/s. Fenders destroyed, quay wall cracked and a crane rail bent. Rule of thumb: less than 15 cm/s at first contact.');
      if (v > 0.15) { this.penalty('Hard landing on the fenders (' + (v * 100).toFixed(0) + ' cm/s)', Math.round(v * 400), 'hard' + Math.floor(G.simT)); this.say('pilot', 'Ouch — that was hard, Captain. ' + (v * 100).toFixed(0) + ' centimetres a second.'); }
      else if (v < 0.08) { this.bonus('Feather-light landing (' + (v * 100).toFixed(0) + ' cm/s)', 120, 'soft'); this.say('pilot', 'Beautiful. You could not break an egg with that.'); }
      else { this.bonus('Good landing (' + (v * 100).toFixed(0) + ' cm/s)', 60, 'good'); this.say('pilot', 'Nice landing, Captain.'); }
    } else if (c.kind === 'land') {
      if (c.normalSpeed > 0.3) this.fail('ALLISION', 'Majestic Maersk struck the ' + (G.ship.x < -1200 ? 'breakwater' : 'quay wall') + ' at ' + (c.normalSpeed / KN).toFixed(1) + ' knots. The hull is breached.');
      else if (!this.once.touch) { this.once.touch = true; AUDIO.thud(0.8); this.penalty('Touched the ' + (G.ship.x < -1200 ? 'breakwater' : 'quay') + ' structure', 150, 'touchland'); }
    } else if (c.kind === 'ship') this.collision(c.name, c.normalSpeed);
  },
  collision(name, v) {
    if (v > 0.25) this.fail('COLLISION', 'Majestic Maersk collided with ' + name + ' at ' + (v / KN).toFixed(1) + ' knots.');
    else if (!this.once['col' + name]) { this.once['col' + name] = true; AUDIO.thud(1); this.penalty('Touched ' + name, 200, 'col' + name); }
  },
  // ------------------------------------------------ scoring
  penalty(label, pts, key, cb) { if (this.once['p_' + key]) return; this.once['p_' + key] = true; G.score.penalties.push({ label, pts }); UI.toast('−' + pts + '  ' + label, 'caution'); cb && cb(); },
  bonus(label, pts, key) { key = key || label; if (this.once['b_' + key]) return; this.once['b_' + key] = true; G.score.bonuses.push({ label, pts }); UI.toast('+' + pts + '  ' + label, 'info'); },
  total() {
    let t = 1000;
    for (const p of G.score.penalties) t -= p.pts;
    for (const b of G.score.bonuses) t += b.pts;
    return t;
  },
  complete() {
    if (this.done) return;
    this.done = true;
    const mins = G.simT / 60;
    if (mins < 80) this.bonus('Efficient arrival (' + mins.toFixed(0) + ' min, par 80)', Math.round((80 - mins) * 3), 'time');
    const bi = berthInfo();
    if (bi && Math.abs(bi.berthOff) < 10) this.bonus('Spot on the berth mark (' + Math.abs(bi.berthOff).toFixed(0) + ' m)', 50, 'mark');
    if (Math.abs(wrap180(G.ship.psi / DEG - 270)) < 30) this.bonus('Swung on arrival — bow out for departure', 100, 'swung');
    this.say('pilot', 'All fast, finished with engines. Thank you Captain, a pleasure. Enjoy Westerhaven!');
    setTimeout(() => UI.debrief(true), 5000);
  },
  fail(title, text) {
    if (this.failed || this.done) return;
    this.failed = { title, text };
    AUDIO.thud(1.5);
    setTimeout(() => UI.debrief(false), 1500);
  },
};
