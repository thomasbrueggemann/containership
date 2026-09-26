// ============================================================================
// 14 — SAVE GAMES: snapshot the arrival into localStorage and restore it later.
// Up to SAVE.MAX slots (manual saves + one autosave per session), newest first.
// ============================================================================
const SAVE = {
  KEY: 'tripleE.saves.v1', MAX: 5, MAX_AUTO: 2, VERSION: 1,
  sessionId: 'auto-' + Date.now().toString(36),
  pending: null, autoT: 0,
  G_KEYS: ['simT', 'timeScale', 'steering', 'apHeading', 'apRudderLimit', 'apRot', 'helmOrder', 'navLights', 'deckLights', 'wipers', 'vhfCh',
    'radarRange', 'ecdisRange', 'ecdisRange2', 'flags', 'score', 'splitEngines', 'bellBook', 'pendingMode', 'thrReady', 'thrStarting',
    'tugAuto', 'pilotCon', 'abCourse', 'track', 'trackT', 'bnwasT'],

  // ------------------------------------------------------------------ storage
  list() {
    try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a.filter((s) => s && s.v === this.VERSION) : []; } catch (e) { return []; }
  },
  write(list) {
    list.sort((a, b) => b.meta.date - a.meta.date);
    // autosaves (one per session) never crowd out more than MAX_AUTO slots
    let autos = 0; list = list.filter((s) => !s.auto || ++autos <= this.MAX_AUTO);
    // if the browser is short of space, drop the oldest saves until it fits
    for (let n = Math.min(list.length, this.MAX); n > 0; n--) {
      try { localStorage.setItem(this.KEY, JSON.stringify(list.slice(0, n))); return true; } catch (e) { /* quota — retry with fewer */ }
    }
    return false;
  },
  remove(id) { this.write(this.list().filter((s) => s.id !== id)); },

  // ------------------------------------------------------------------ capture
  snapshot() {
    const s = G.ship, cp = (o) => JSON.parse(JSON.stringify(o));
    const ship = {};
    for (const k of Object.keys(s)) if (k !== 'S' && k !== '_hullPts' && typeof s[k] !== 'function') ship[k] = s[k];
    const g = {}; for (const k of this.G_KEYS) g[k] = G[k];
    const st = SCN.steps[SCN.cur];
    return cp({
      v: this.VERSION,
      meta: { date: Date.now(), simT: G.simT, step: SCN.cur, steps: SCN.steps.length, title: st ? st.title : 'Alongside', score: SCN.total(), tod: CFG.tod, wind: CFG.wind, sea: CFG.sea },
      cfg: CFG, g, ship,
      scn: { cur: SCN.cur, once: SCN.once, done: SCN.done, failed: SCN.failed, contactCool: SCN.contactCool, lastFenderT: SCN.lastFenderT ?? null, pilotT: SCN.pilotT || 0, conT: SCN.conT || 0,
        timers: SCN.timers.filter((t) => t.key).map((t) => ({ t: t.t, key: t.key, arg: t.arg })),
        lines: SCN.lineMeshes.map((L) => ({ xb: L.xb, yb: L.yb, qx: L.qx, qz: L.qz, fwd: L.fwd })) },
      traffic: TRAFFIC.ships.map((o) => ({ name: o.name, x: o.x, z: o.z, psi: o.psi, sog: o.sog, cog: o.cog, active: o.active, wpi: o.wpi, tgt: o.tgt || null, done: !!o.done })),
      pilotboat: { state: PILOTBOAT.state, x: PILOTBOAT.x, z: PILOTBOAT.z, psi: PILOTBOAT.psi, sog: PILOTBOAT.sog, alongT: PILOTBOAT.alongT || 0 },
      tugs: { ordered: TUGS.ordered, list: TUGS.list.map((t) => ({ state: t.state, x: t.x, z: t.z, psi: t.psi, sog: t.sog, fastT: t.fastT, push: t.push })) },
      // someone on the way out (to a mooring station / the pilot ladder) counts as already gone
      crew: CREW.members.map((c) => ({ id: c.id, present: c.present && !(c.node === 'door' && c.path.length), x: c.x, z: c.z, node: c.node, face: c.face, idleFace: c.idleFace ?? 0, pose: c.pose ?? null, home: c.home,
        task: c.task && c.task.key && !c.task.started ? { spot: c.task.spot, key: c.task.key, arg: c.task.arg, dur: c.task.dur } : null })),
      helm: { steadyTold: !!CREW._steadyTold },
      player: { x: PLAYER.x, z: PLAYER.z, yaw: PLAYER.yaw, pitch: PLAYER.pitch, mode: G.mode },
    });
  },
  save(auto) {
    if (!G.started || !G.ship) return false;
    const snap = this.snapshot();
    snap.id = auto ? this.sessionId : 'save-' + Date.now().toString(36);
    snap.auto = !!auto;
    const list = this.list().filter((s) => s.id !== snap.id);
    list.unshift(snap);
    const ok = this.write(list);
    if (!auto) UI.toast(ok ? 'Game saved' : 'Could not save — browser storage is full or disabled', ok ? 'info' : 'caution');
    return ok;
  },
  // periodic autosave while the arrival is under way
  update(rdt) {
    if (!G.started || G.paused || SCN.done || SCN.failed || G.simT < 30) return;
    this.autoT += rdt;
    if (this.autoT > 90) { this.autoT = 0; this.save(true); }
  },

  // ------------------------------------------------------------------ restore
  // called from the start screen: set the options the world is built with, then start
  resume(id) {
    const snap = this.list().find((s) => s.id === id); if (!snap) return;
    Object.assign(CFG, snap.cfg);
    if (snap.auto) this.sessionId = snap.id;     // keep autosaving into the same slot
    this.pending = snap;
    startGame();
  },
  apply(snap) {
    const s = G.ship;
    for (const k of this.G_KEYS) if (k in snap.g) G[k] = snap.g[k];
    // ship: nested plain objects/arrays are replaced wholesale
    for (const k of Object.keys(snap.ship)) s[k] = snap.ship[k];
    // scenario
    const c = snap.scn;
    SCN.cur = c.cur; SCN.once = c.once || {}; SCN.done = c.done; SCN.failed = c.failed; SCN.contactCool = c.contactCool || 0;
    SCN.lastFenderT = c.lastFenderT ?? undefined; SCN.pilotT = c.pilotT; SCN.conT = c.conT;
    SCN.timers = c.timers.map((t) => ({ t: t.t, key: t.key, arg: t.arg }));
    for (const L of c.lines) SCN.addLineMesh(L.fwd, L.xb, L.yb, L.qx, L.qz);
    // traffic
    for (const o of snap.traffic) {
      const t = TRAFFIC.ships.find((x) => x.name === o.name); if (!t) continue;
      Object.assign(t, { x: o.x, z: o.z, psi: o.psi, sog: o.sog, cog: o.cog, active: o.active, wpi: o.wpi, tgt: o.tgt || undefined });
      if (o.done) { t.done = true; t.trigger = null; }              // already sailed past, don't re-trigger
      t.grp.visible = t.active; t.grp.position.set(t.x, 0, t.z); t.grp.rotation.y = -t.psi; t.wakeObj.pts = [];
    }
    Object.assign(PILOTBOAT, snap.pilotboat); PILOTBOAT._nag = false; PILOTBOAT.wake.pts = [];
    PILOTBOAT.grp.position.set(PILOTBOAT.x, 0, PILOTBOAT.z); PILOTBOAT.grp.rotation.y = -PILOTBOAT.psi;
    TUGS.ordered = snap.tugs.ordered;
    snap.tugs.list.forEach((o, i) => { const t = TUGS.list[i]; Object.assign(t, o); t.wake.pts = []; t.grp.position.set(t.x, 0, t.z); t.grp.rotation.y = -t.psi; });
    // crew
    for (const o of snap.crew) {
      const m = CREW.byId(o.id); if (!m) continue;
      m.present = o.present; m.group.visible = o.present; m.hit.visible = o.present;
      m.x = o.x; m.z = o.z; m.node = o.node; m.face = m.targetFace = o.face; m.idleFace = o.idleFace; m.pose = o.pose;
      m.path = []; m.state = 'idle'; m.task = null; m.onArrive = null;
      if (o.home) m.home = o.home;
      if (!o.present) continue;
      if (o.task) m.doTask(o.task.spot, { key: o.task.key, arg: o.task.arg, dur: o.task.dur });
      else if (m.home && o.node !== m.home.node) m.goHome();       // was mid-errand: back to their post
    }
    CREW._steadyTold = snap.helm.steadyTold;
    CREW.showStation('fwd', !!G.flags.fwdStation); CREW.showStation('aft', !!G.flags.aftStation);
    // bridge lamps that are only set on events
    if (G.thrReady) BR.controls.btStart.setLit(true, 0x40ff80); else if (G.thrStarting) BR.controls.btStart.setLit(true, 0xffb020);
    if (G.pendingMode) BR.controls.engBtns[G.pendingMode].setLit(true, 0xffb020);
    // own ship wake & player
    G.wake.pts = [];
    const p = snap.player; PLAYER.place(p.x, p.z, p.yaw); PLAYER.pitch = p.pitch;
    if (p.mode === 'orbit') PLAYER.toggleOrbit();
    SPEECH.queue = [];
    UI.refreshTC(); UI.updateMission(true);
    UI.toast('Welcome back, Captain — ' + (snap.meta.title || '') , 'info');
  },

  // ------------------------------------------------------------------ start screen
  renderList() {
    const box = $('saveList'); if (!box) return;
    const list = this.list();
    $('savesWrap').classList.toggle('hidden', !list.length);
    const TOD = { morning: 'Morning', golden: 'Golden hour', night: 'Night' }, WIND = { light: 'light wind', moderate: 'moderate wind', fresh: 'fresh wind' };
    const when = (t) => { const d = new Date(t), now = new Date(); const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); return d.toDateString() === now.toDateString() ? 'Today ' + hm : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + hm; };
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    box.innerHTML = list.map((s) => {
      const m = s.meta, pct = Math.round(Math.min(m.step, m.steps) / m.steps * 100);
      return `<div class="save" data-id="${esc(s.id)}">
        <button class="load" data-id="${esc(s.id)}">
          <span class="st">${m.step >= m.steps ? 'ALONGSIDE' : 'STEP ' + (m.step + 1) + ' / ' + m.steps}${s.auto ? ' · AUTOSAVE' : ''}</span>
          <span class="tt">${esc(m.title)}</span>
          <span class="mt">${TOD[m.tod] || m.tod}, ${WIND[m.wind] || m.wind}${m.sea ? ', ' + m.sea + ' sea' : ''} · ${Math.round(m.simT / 60)} min under way · ${m.score} pts</span>
          <span class="pb"><i style="width:${pct}%"></i></span>
          <span class="dt">${when(m.date)}</span>
        </button>
        <button class="del" data-del="${esc(s.id)}" title="Delete this save">×</button></div>`;
    }).join('');
    box.querySelectorAll('.load').forEach((b) => (b.onclick = () => { PLAYER.requestLock(true); this.resume(b.dataset.id); }));
    box.querySelectorAll('.del').forEach((b) => (b.onclick = () => { this.remove(b.dataset.del); this.renderList(); }));
  },
  init() {
    this.renderList();
    // save when the tab is closed or hidden, so leaving never loses progress
    const bye = () => { if (G.started && !SCN.done && !SCN.failed && G.simT > 30) this.save(true); };
    addEventListener('beforeunload', bye);
    document.addEventListener('visibilitychange', () => { if (document.hidden) bye(); });
  },
};
