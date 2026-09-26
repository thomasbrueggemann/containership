// ============================================================================
// 13 — UI: HUD, mission panel, menus, overlays
// ============================================================================
const UI = {
  zoomKey: null, crewSel: null, toasts: [], hudT: 0,
  KEYS: [
    ['h', 'On the bridge'], ['W A S D', 'Walk  (Shift = hurry)'], ['Mouse', 'Look around (always on — Esc pauses; mouse settings in the pause menu)'], ['Click', 'Use the button / lever under the crosshair'], ['Space', 'Full-screen view of the screen / chart under the crosshair (Space again closes, wheel or − + changes range)'], ['Right mouse / B', 'Binoculars'], ['1 2 3 4', 'Jump: centre console · port wing · stbd wing · chart table'], ['V', 'External camera (mouse orbits, wheel zooms)'],
    ['h', 'Ship handling'], ['↑ / ↓', 'Engine telegraph (both engines) one notch'], ['← / →', 'Helm order 5° (Shift 10°) — or autopilot ±1° in AUTO'], ['X', 'Midships'], ['Q / E', 'Bow thrusters to port / starboard (25 %)'], ['Z', 'Thrusters zero'], ['T', 'Tug orders panel'], ['H (hold)', 'Ship\'s whistle'],
    ['h', 'Command'], ['Tab', 'Crew orders — delegate to your officers'], ['M R C G', 'Full-screen ECDIS · radar · conning · docking'], ['[ / ]', 'Time compression ×1 … ×8'], ['P', 'Pause'], ['Ctrl / ⌘ + S', 'Save the game (also autosaves every 90 s)'], ['J / K', 'Hide mission panel / status bar'],
  ],
  init() {
    // start screen option segments
    document.querySelectorAll('.seg').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
        CFG[seg.dataset.k] = b.dataset.v;
      });
    });
    $('startKeys').innerHTML = this.keysHTML();
    $('btnStart').addEventListener('click', () => { PLAYER.requestLock(true); startGame(); });   // mouse-look from the first frame
    $('btnResume').addEventListener('click', () => this.togglePause(false));
    $('btnRestart').addEventListener('click', () => location.reload());
    $('btnSave').addEventListener('click', () => { SAVE.save(false); });
    $('btnSaveQuit').addEventListener('click', () => { if (SAVE.save(false)) location.reload(); });
    $('btnSaveTop').addEventListener('click', () => SAVE.save(false));
    $('btnPauseHelp').addEventListener('click', () => this.showHelp());
    $('btnCrew').addEventListener('click', () => this.openCrewMenu());
    $('btnHelp').addEventListener('click', () => this.showHelp());
    $('missionToggle').addEventListener('click', () => $('mission').classList.toggle('collapsed'));
    $('help').addEventListener('click', (e) => { if (e.target.id === 'help' || e.target.dataset.close) $('help').classList.add('hidden'); });
    // whenever the last menu / panel closes, hand the mouse back to mouse-look
    const mo = new MutationObserver(() => { if (G.started) setTimeout(() => PLAYER.recapture(), 0); });
    for (const id of ['crewMenu', 'tugPanel', 'help', 'pause', 'debrief']) mo.observe($(id), { attributes: true, attributeFilter: ['class'] });
    // mouse settings in the pause menu
    const ms = $('mouseSens'), mi = $('mouseInvert'), msm = $('mouseSmooth'), mv = $('mouseSensV');
    const showMouse = () => { ms.value = Math.log2(PLAYER.opts.sens); mv.textContent = PLAYER.opts.sens.toFixed(2) + '×'; mi.checked = PLAYER.opts.invert; msm.checked = PLAYER.opts.smooth; };
    PLAYER.loadOpts(); showMouse();
    ms.oninput = () => { PLAYER.opts.sens = Math.round(Math.pow(2, +ms.value) * 100) / 100; PLAYER.saveOpts(); showMouse(); };
    mi.onchange = () => { PLAYER.opts.invert = mi.checked; PLAYER.saveOpts(); };
    msm.onchange = () => { PLAYER.opts.smooth = msm.checked; PLAYER.saveOpts(); };
    const tc = $('tcButtons'); [1, 2, 4, 8].forEach((v) => { const b = document.createElement('button'); b.textContent = '×' + v; b.dataset.v = v; b.onclick = () => { G.timeScale = v; this.refreshTC(); }; tc.appendChild(b); });
    this.refreshTC();
  },
  keysHTML() { return this.KEYS.map(([k, v]) => (k === 'h' ? `<span class="h">${v}</span>` : `<kbd>${k}</kbd><span>${v}</span>`)).join(''); },
  refreshTC() { document.querySelectorAll('#tcButtons button').forEach((b) => b.classList.toggle('on', +b.dataset.v === G.timeScale)); },
  setTimeScale(d) { const v = [1, 2, 4, 8]; let i = v.indexOf(G.timeScale); i = clamp(i + d, 0, 3); G.timeScale = v[i]; this.refreshTC(); this.toast('Time compression ×' + G.timeScale, 'info'); },
  showHUD() { ['crosshair', 'mission', 'topright', 'statusbar', 'lookhint'].forEach((k) => $(k).classList.remove('hidden')); if (CFG.assist === 'off') $('statusbar').classList.add('hidden'); },
  lockChanged(locked) {
    $('lookhint').classList.toggle('hidden', locked || PLAYER.lockFailed || G.mode !== 'bridge' || this.modalOpen());
    $('crosshair').classList.toggle('idle', !locked && !PLAYER.lockFailed); if (PLAYER.lockFailed) $('lookhint').innerHTML = 'Drag to look around · click controls directly'; },
  modeChanged() { $('crosshair').classList.toggle('hidden', G.mode !== 'bridge'); this.lockChanged(PLAYER.locked); if (G.mode === 'orbit') this.toast('External view — move the mouse to orbit, wheel to zoom, V to return', 'info'); },
  zoomOpen() { return !$('zoomView').classList.contains('hidden'); },
  panelOpen() { return !$('tugPanel').classList.contains('hidden'); },
  modalOpen() { return !$('crewMenu').classList.contains('hidden') || !$('zoomView').classList.contains('hidden') || !$('help').classList.contains('hidden') || !$('pause').classList.contains('hidden') || !$('debrief').classList.contains('hidden') || !$('start').classList.contains('hidden'); },
  releaseMouse() { PLAYER.release(); },
  handleKey(e) {
    if (e.code === 'Escape') {
      if (!$('zoomView').classList.contains('hidden')) { this.closeZoom(); return true; }
      if (!$('crewMenu').classList.contains('hidden')) { $('crewMenu').classList.add('hidden'); return true; }
      if (!$('help').classList.contains('hidden')) { $('help').classList.add('hidden'); return true; }
      if (!$('tugPanel').classList.contains('hidden')) { $('tugPanel').classList.add('hidden'); return true; }
      if (!PLAYER.locked && G.started && !this.modalOpen()) { this.togglePause(true); return true; }
      if (!$('pause').classList.contains('hidden')) { this.togglePause(false); return true; }
    }
    if (!$('crewMenu').classList.contains('hidden') && /^Digit\d$/.test(e.code)) {
      const n = +e.code.slice(-1); const btns = [...$('crewMenu').querySelectorAll('.orders button[data-i]')]; const b = btns[n - 1]; if (b && !b.disabled) b.click(); return true;
    }
    return false;
  },
  togglePause(on) {
    const p = on === undefined ? $('pause').classList.contains('hidden') : on;
    $('pause').classList.toggle('hidden', !p); G.paused = p; if (p) this.releaseMouse();
    else if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // Space must not re-press a menu button
  },
  showHelp() {
    this.releaseMouse();
    $('helpCard').innerHTML = `<button class="closex" data-close="1">×</button><div style="font-size:20px;font-weight:700;margin-bottom:12px">Bridge controls</div>
      <div class="cols"><div class="keys">${this.keysHTML()}</div><div class="specs">
      <div class="keys"><span class="h">Bridge layout</span></div>
      <b>Main console</b> (left → right): X-band radar · ECDIS · autopilot & steering mode · VHF + conning · ECR phone & alarms · <b>wheel & whistle</b> · <b>engine telegraphs</b> · bow thrusters & tugs · docking display · ECDIS 2 · S-band radar.<br>
      <b>Overhead</b>: rudder, rate of turn, heading, speed, RPM, wind, depth, time. <b>Echo sounder</b> to the right.<br>
      <b>Wings</b> (2 / 3): docking display, combined telegraph, thruster joystick, NFU tiller, glass floor to look down the ship's side.<br>
      <b>Aft</b>: chart table with pilot card (port), GMDSS (starboard), coffee.<br><br>
      <div class="keys"><span class="h">Seamanship notes</span></div>
      A laden Triple-E carries her way for kilometres: from 12 kn she needs ~2 km to stop even at full astern. Engines reverse only after stopping (~10 s air start). Rudders need propeller wash — at low speed give a “kick ahead”. Bow thrusters lose effect above ~4 kn and there is no stern thruster, so use the tugs for the stern. Wind on 16 500 m² of containers pushes hard — watch transverse speeds on the docking display.
      </div></div>`;
    $('help').classList.remove('hidden');
  },
  // --------------------------------------------------------- subtitles / toasts
  sub(who, text, id, radio) {
    const col = (CREW.info[id] && CREW.info[id].color) || '#ddd';
    const d = document.createElement('div'); d.className = 'sub' + (radio ? ' radio' : '');
    d.innerHTML = `<span class="who" style="color:${col}">${radio ? '📻 ' : ''}${who}:</span>${text}`;
    const box = $('subs'); box.appendChild(d);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => d.remove(), Math.max(4500, text.length * 75));
  },
  toast(msg, level = 'info') { this.toasts.push({ msg, level, t: 4.5 }); if (this.toasts.length > 4) this.toasts.shift(); this.renderAlerts(); },
  renderAlerts() {
    const box = $('alerts'); let h = '';
    for (const k in ALARMS.active) { const a = ALARMS.active[k]; h += `<div class="al ${a.level === 'caution' ? 'caution' : ''}">${a.text}${ALARMS.acked[k] ? ' · ACK' : ''}</div>`; }
    for (const t of this.toasts) h += `<div class="al ${t.level}">${t.msg}</div>`;
    if (box._h !== h) { box.innerHTML = h; box._h = h; }
  },
  setHover(ia) {
    const tt = $('tooltip');
    $('crosshair').classList.toggle('hot', !!ia);
    if (!ia) { tt.classList.add('hidden'); return; }
    const act = ia.zoom ? '<kbd>Space</kbd> full screen' : ia.click || ia.down ? 'Click to use' : '';
    tt.innerHTML = `<b>${ia.name}</b>${ia.hint ? '<span>' + ia.hint + '</span>' : ''}${act ? '<span class="act">' + act + '</span>' : ''}`;
    tt.classList.remove('hidden');
  },
  binoOverlay(on) {
    let el = $('binoMask');
    if (!el) {
      el = document.createElement('div'); el.id = 'binoMask';
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:3;display:none;background:radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) 38vmin, rgba(0,0,0,.55) 42vmin, #000 44vmin)';
      const r = document.createElement('div'); r.style.cssText = 'position:absolute;left:50%;top:50%;width:14vmin;height:1px;margin-left:-7vmin;background:rgba(0,0,0,.35)'; el.appendChild(r);
      const r2 = document.createElement('div'); r2.style.cssText = 'position:absolute;left:50%;top:50%;height:6vmin;width:1px;margin-top:-3vmin;background:rgba(0,0,0,.35)'; el.appendChild(r2);
      document.body.appendChild(el);
    }
    el.style.display = on ? 'block' : 'none';
  },
  // --------------------------------------------------------- mission panel
  updateMission(full) {
    const st = SCN.steps[SCN.cur];
    if (full) {
      if (st) {
        $('phaseTag').textContent = st.phase;
        $('stepTitle').textContent = st.title;
        $('stepText').textContent = CFG.assist === 'off' ? '' : st.text;
        $('stepHow').innerHTML = CFG.assist === 'off' ? '' : st.how.map((h) => `<li>${h}</li>`).join('');
      }
      $('stepProg').textContent = `STEP ${Math.min(SCN.cur + 1, SCN.steps.length)} / ${SCN.steps.length}`;
      $('checklist').innerHTML = SCN.steps.map((s, i) => `<div class="${i < SCN.cur || s.ok ? 'done' : i === SCN.cur ? 'cur' : ''}">${s.title}</div>`).join('');
    }
  },
  // --------------------------------------------------------- status bar
  update(dt) {
    this.hudT += dt;
    for (const t of this.toasts) t.t -= dt;
    const n = this.toasts.length; this.toasts = this.toasts.filter((t) => t.t > 0);
    if (this.hudT < 0.2) return; this.hudT = 0;
    this.renderAlerts();
    const s = G.ship;
    const cell = (k, v, cls = '') => `<div class="cell ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    const rud = (d) => (d < -0.5 ? 'P' : d > 0.5 ? 'S' : '') + Math.abs(d).toFixed(0) + '°';
    const tele = TELEGRAPH[s.tele[0]].id + (s.tele[0] !== s.tele[1] ? '/' + TELEGRAPH[s.tele[1]].id : '');
    const bt = (s.bowThr[0] + s.bowThr[1]) / 2;
    let h = cell('HDG', pad(s.psi / DEG) + '°') + cell('SOG', fmt(s.sog / KN) + ' kn', s.x > -2700 && s.sog / KN > 6 ? 'warn' : '') + cell('STW', fmt(s.u / KN) + ' kn') + cell('ROT', fmt(s.rotDegMin) + '°/m') + '<div class="sep"></div>';
    h += cell(G.steering === 'AUTO' ? 'AUTO SET' : 'HELM', G.steering === 'AUTO' ? pad(G.apHeading) + '°' : rud(G.steering === 'HAND' ? G.helmOrder : s.rudderCmd)) + cell('RUDDER', rud(s.rudder)) + '<div class="sep"></div>';
    h += cell('TELEGRAPH', tele) + cell('RPM', fmt(s.rpm[0], 0) + (G.splitEngines ? '/' + fmt(s.rpm[1], 0) : ''), s.engineMode === 'SEA' ? 'warn' : '') + cell('ENGINE', s.engineMode === 'STANDBY' ? 'S/BY' : s.engineMode, s.engineMode === 'SEA' ? 'warn' : '') + '<div class="sep"></div>';
    h += cell('BOW THR', G.thrReady ? (bt < 0 ? 'P' : bt > 0 ? 'S' : '') + Math.round(Math.abs(bt) * 100) + '%' : 'OFF') + cell('TUGS', s.tugs.filter((t) => t.attached).length + '/2' + (G.tugAuto ? ' A' : '')) + cell('UKC', fmt(s.ukc) + ' m', s.ukc < 1.5 ? 'bad' : s.ukc < 3 ? 'warn' : '');
    const sb = $('statusbar'); if (sb._h !== h) { sb.innerHTML = h; sb._h = h; }
    $('clock').textContent = clockStr(false) + ' LT';
    if (!$('tugPanel').classList.contains('hidden')) this.refreshTugPanel();
    if (!$('zoomView').classList.contains('hidden') && this.zoomKey === 'bellbook') this.showBellBook(true);
  },
  // --------------------------------------------------------- instrument zoom
  // Full-screen instrument view. The mouse is NOT released: Space / click / Esc closes it again,
  // the wheel or − / + keys change the range, so the player never has to chase a cursor.
  zoomDisplay(key) {
    if (key === 'bellbook') return this.showBellBook();
    const d = DISPLAYS[key]; if (!d) return;
    this.closeZoom();
    this.zoomKey = key; this.zoomLocked = PLAYER.locked; this.zoomRangeFn = null;
    $('zvTitle').textContent = d.title;
    const body = $('zvBody'); body.innerHTML = ''; body.appendChild(d.canvas);
    const ctl = $('zvCtl'); ctl.innerHTML = '';
    const btn = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; ctl.appendChild(b); };
    if (key.startsWith('radar')) {
      const i = key === 'radar1' ? 0 : 1;
      this.zoomRangeFn = (dir) => { G.radarRange[i] = RADAR_RANGES[clamp(RADAR_RANGES.indexOf(G.radarRange[i]) + dir, 0, RADAR_RANGES.length - 1)]; };
      btn('Range − [−]', () => this.zoomRangeFn(-1)); btn('Range + [+]', () => this.zoomRangeFn(1));
    }
    if (key.startsWith('ecdis')) {
      const k = key === 'ecdis1' ? 'ecdisRange' : 'ecdisRange2';
      this.zoomRangeFn = (dir) => { G[k] = ECDIS_RANGES[clamp(ECDIS_RANGES.indexOf(G[k]) + dir, 0, ECDIS_RANGES.length - 1)]; d.force = true; };
      btn('Zoom in [−]', () => this.zoomRangeFn(-1)); btn('Zoom out [+]', () => this.zoomRangeFn(1));
    }
    btn('Close (Space)', () => this.closeZoom());
    $('zoomView').classList.remove('hidden');
  },
  closeZoom() { $('zoomView').classList.add('hidden'); $('zvBody').innerHTML = ''; this.zoomKey = null; this.zoomRangeFn = null; },
  zoomRange(dir) { if (this.zoomRangeFn) { this.zoomRangeFn(dir); AUDIO.click(); } },
  showBellBook(refresh) {
    if (!refresh) { this.closeZoom(); this.zoomKey = 'bellbook'; this.zoomLocked = PLAYER.locked; $('zvTitle').textContent = 'Bell book — engine movements'; $('zvCtl').innerHTML = ''; const b = document.createElement('button'); b.textContent = 'Close (Space)'; b.onclick = () => this.closeZoom(); $('zvCtl').appendChild(b); $('zoomView').classList.remove('hidden'); }
    const rows = G.bellBook.slice(0, 40).map((e) => { const t = (START_TIME[CFG.tod] + e.t) % 86400; return `<tr><td style="font-family:ui-monospace,monospace;padding:4px 14px;color:#8ea4b3">${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(Math.floor(t) % 60).padStart(2, '0')}</td><td style="padding:4px 14px">${e.txt}</td></tr>`; }).join('');
    $('zvBody').innerHTML = `<div style="background:#f3efe2;color:#222;border-radius:8px;padding:18px 22px;max-height:100%;overflow:auto;min-width:420px;font-size:15px"><div style="font-weight:800;margin-bottom:8px">MAJESTIC MAERSK — Bell book</div><table>${rows || '<tr><td>No engine movements yet.</td></tr>'}</table></div>`;
  },
  // --------------------------------------------------------- crew orders
  openCrewMenu(id) {
    this.releaseMouse();
    if (id) this.crewSel = id;
    if (!this.crewSel) this.crewSel = SCN.steps[SCN.cur] && { standby: 'o3', vts: 'o2', ladder: 'o3', pilot: 'ab', channel: 'pilot', tugs: 'pilot', stations: 'co', harbour: 'o3', berth: 'pilot', lines: 'co', fwe: 'pilot' }[SCN.steps[SCN.cur].id] || 'co';
    const ids = ['co', 'o2', 'o3', 'ab', 'pilot'];
    const menu = $('crewMenu');
    const who = CREW.info[this.crewSel];
    const orders = CREW.orders(this.crewSel);
    const cm = CREW.byId(this.crewSel);
    const away = this.crewSel === 'co' ? G.flags.fwdSent : this.crewSel === 'o2' ? G.flags.aftSent : false;
    menu.innerHTML = `<button class="closex">×</button><h3>Crew orders</h3><div class="sub">Delegate tasks to your bridge team. Recommended orders for the current step are marked. Number keys select.</div>
      <div class="crewgrid"><div class="crewlist">${ids.map((k) => { const c = CREW.byId(k), inf = CREW.info[k]; const here = c && c.present; const st = k === 'co' && G.flags.fwdSent ? 'at forward station (UHF)' : k === 'o2' && G.flags.aftSent ? 'at aft station (UHF)' : k === 'pilot' && !G.flags.pilotOnBridge ? 'not yet on board' : here ? inf.role : 'away'; return `<button data-c="${k}" class="${k === this.crewSel ? 'sel' : ''}" ${k === 'pilot' && !G.flags.pilotOnBridge ? 'disabled' : ''}>${inf.short}<small>${st}</small></button>`; }).join('')}</div>
      <div class="orders">${orders.map((o, i) => `<button data-i="${i + 1}" data-k="${o.k}" class="${SCN.recommended(o.k) && o.ok ? 'rec' : ''}" ${o.ok ? '' : 'disabled'}><span class="n">${i + 1}</span>${o.t}<small>${o.d}</small></button>${o.input ? `<div class="row" data-in="${o.k}" style="display:none;margin:-2px 0 4px 20px"><input type="number" min="0" max="359" value="${pad(G.ship.psi / DEG)}"><button data-go="${o.k}" style="padding:7px 12px">Order</button></div>` : ''}`).join('')}</div></div>`;
    menu.querySelector('.closex').onclick = () => menu.classList.add('hidden');
    menu.querySelectorAll('.crewlist button').forEach((b) => (b.onclick = () => this.openCrewMenu(b.dataset.c)));
    menu.querySelectorAll('.orders button[data-k]').forEach((b) => (b.onclick = () => {
      const o = orders.find((x) => x.k === b.dataset.k); if (!o) return;
      if (o.input) { const row = menu.querySelector(`[data-in="${o.k}"]`); row.style.display = 'flex'; row.querySelector('input').focus(); row.querySelector('input').select(); return; }
      o.fn(); G.bnwasT = 0; menu.classList.add('hidden');
    }));
    menu.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { const o = orders.find((x) => x.k === b.dataset.go); const v = +b.parentElement.querySelector('input').value; if (Number.isFinite(v)) { o.fn(v); menu.classList.add('hidden'); } }));
    menu.querySelectorAll('[data-in] input').forEach((inp) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.parentElement.querySelector('button').click(); e.stopPropagation(); }));
    menu.classList.remove('hidden');
  },
  openPhone() {
    this.releaseMouse();
    const s = G.ship, menu = $('crewMenu');
    const opts = [
      ['Stand-by engine (manoeuvring mode)', s.engineMode === 'SEA' && !G.pendingMode, () => { SCN.say('me', 'Chief, stand-by engine please.'); requestEngineMode('STANDBY'); }],
      ['Back to sea passage mode', s.engineMode === 'STANDBY' && !G.pendingMode && s.x < -12000, () => requestEngineMode('SEA')],
      ['Start the bow thrusters', !G.thrReady && !G.thrStarting, () => startThrusters()],
      ['Finished with engines', s.engineMode !== 'FWE' && !G.pendingMode, () => requestEngineMode('FWE')],
      ['How is it going down there, Chief?', true, () => CREW.say('ce', pick(['All good, Captain. Both engines ready, jacket water ninety degrees, plenty of start air.', 'Fine down here. Just do not ask for full astern too often — I like my start air.', 'Purifiers humming, generators two and three on line. We are ready.']), true)],
    ];
    menu.innerHTML = `<button class="closex">×</button><h3>☎ Engine Control Room</h3><div class="sub">Chief Engineer Lars Jensen on the line.</div><div class="orders">${opts.map((o, i) => `<button data-i="${i + 1}" ${o[1] ? '' : 'disabled'} class="${i === 0 && o[1] && SCN.steps[SCN.cur]?.id === 'standby' ? 'rec' : ''}"><span class="n">${i + 1}</span>${o[0]}</button>`).join('')}</div>`;
    menu.querySelector('.closex').onclick = () => menu.classList.add('hidden');
    menu.querySelectorAll('.orders button').forEach((b, i) => (b.onclick = () => { opts[i][2](); menu.classList.add('hidden'); }));
    menu.classList.remove('hidden');
  },
  // --------------------------------------------------------- tugs
  toggleTugPanel() {
    const p = $('tugPanel');
    if (!p.classList.contains('hidden')) { p.classList.add('hidden'); return; }
    this.releaseMouse();
    p.classList.remove('hidden');
    this.refreshTugPanel(true);
  },
  refreshTugPanel(rebuild) {
    const p = $('tugPanel'), s = G.ship;
    const sig = TUGS.list.map((t) => t.state).join() + G.tugAuto + TUGS.ordered + s.tugs.map((t) => t.dirCmd).join();
    if (!rebuild && p._sig === sig) { TUGS.list.forEach((t, i) => { const el = p.querySelector(`[data-pw="${i}"]`); if (el) el.textContent = `${Math.round(s.tugs[i].power * 100)} % → ${Math.round(s.tugs[i].powerCmd * 100)} %  ·  ${(s.forceLog.tugs[i] / 9810).toFixed(0)} t`; const r = p.querySelector(`input[data-t="${i}"]`); if (r && document.activeElement !== r) r.value = Math.round(s.tugs[i].powerCmd * 100); }); return; }
    p._sig = sig;
    const dirs = [['◀ PORT', 270], ['STBD ▶', 90], ['▲ AHEAD', 0], ['▼ ASTERN', 180]];
    let h = `<button class="closex">×</button><h3>Tug orders <span style="color:var(--muted);font-weight:500;font-size:12px">VHF 12 · direction of pull on the ship</span></h3>`;
    if (!TUGS.ordered) h += `<div style="margin:10px 0"><button class="auto" data-order="1">Order tugs now (VHF 12)</button></div>`;
    TUGS.list.forEach((t, i) => {
      const tg = s.tugs[i];
      h += `<div class="tug"><div class="hd">${i ? 'AFT' : 'FORWARD'} — ${t.name}<span>${t.state.toUpperCase()}${t.push ? ' · PUSHING' : ''}</span></div>`;
      if (tg.attached) {
        h += `<div class="dirs">${dirs.map(([l, d]) => `<button data-t="${i}" data-d="${d}" class="${Math.round(tg.dirCmd) === d ? 'on' : ''}">${l}</button>`).join('')}</div>`;
        h += `<input type="range" min="0" max="100" step="5" value="${Math.round(tg.powerCmd * 100)}" data-t="${i}"><div class="pw"><span>POWER</span><span data-pw="${i}"></span></div>`;
      } else h += `<div style="color:var(--muted);font-size:12.5px">${t.state === 'berth' ? 'Waiting at the tug berth' : t.state === 'standby' ? 'Standing by — slow below 6 kn to make fast' : t.state === 'making' ? 'Passing the towline…' : 'Under way to you'}</div>`;
      h += `</div>`;
    });
    if (s.tugs[0].attached || s.tugs[1].attached) {
      h += `<button class="auto ${G.tugAuto ? 'on' : ''}" data-auto="1" ${G.flags.pilotOnBridge ? '' : 'disabled'}>${G.tugAuto ? '✓ Pilot is handling the tugs' : 'Let the pilot handle the tugs'}</button>`;
      h += `<button class="auto" data-stop="1" style="background:rgba(255,255,255,.05);border-color:var(--line);color:var(--text)">All tugs: stop pulling (0 %)</button>`;
      h += `<button class="auto" data-letgo="1" style="background:rgba(255,90,79,.12);border-color:rgba(255,90,79,.5);color:#ffd0cc">Let go both tugs</button>`;
    }
    p.innerHTML = h;
    p.querySelector('.closex').onclick = () => p.classList.add('hidden');
    p.querySelectorAll('.dirs button').forEach((b) => (b.onclick = () => { TUGS.command(+b.dataset.t, +b.dataset.d, null); if (s.tugs[+b.dataset.t].powerCmd < 0.05) TUGS.command(+b.dataset.t, null, 0.3); AUDIO.click(); this.refreshTugPanel(true); }));
    p.querySelectorAll('input[type=range]').forEach((r) => (r.oninput = () => TUGS.command(+r.dataset.t, null, r.value / 100)));
    const q = (sel, fn) => { const el = p.querySelector(sel); if (el) el.onclick = fn; };
    q('[data-order]', () => { G.vhfCh = 12; SCN.tugCall('me'); this.refreshTugPanel(true); });
    q('[data-auto]', () => { G.tugAuto = !G.tugAuto; CREW.say('pilot', G.tugAuto ? 'I have the tugs, Captain. You work the engines.' : 'Your tugs, Captain.'); this.refreshTugPanel(true); });
    q('[data-stop]', () => { TUGS.command(0, null, 0); TUGS.command(1, null, 0); this.refreshTugPanel(true); });
    q('[data-letgo]', () => { CREW.say('me', 'Titan, Hercules: let go, thank you.', true); TUGS.letGo(); this.refreshTugPanel(true); });
    this.refreshTugPanel(false);
  },
  // --------------------------------------------------------- debrief
  debrief(ok) {
    this.releaseMouse(); G.paused = true;
    const sc = SCN.total();
    const grade = !ok ? 'Mission failed' : sc >= 1150 ? 'Master Mariner — the pilot wants to sail with you again' : sc >= 1000 ? 'Very good — a textbook arrival' : sc >= 850 ? 'Competent — some rough edges' : 'Alongside, but the superintendent will call you';
    const rows = [...G.score.bonuses.map((b) => `<tr><td>${b.label}</td><td class="r" style="color:var(--good)">+${b.pts}</td></tr>`), ...G.score.penalties.map((p) => `<tr><td>${p.label}</td><td class="r" style="color:var(--bad)">−${p.pts}</td></tr>`)].join('');
    const mins = (G.simT / 60).toFixed(0);
    $('debriefCard').innerHTML = ok
      ? `<div style="font:600 11px ui-monospace,monospace;letter-spacing:.14em;color:var(--accent)">ALL FAST · BERTH 4</div><div style="font-size:26px;font-weight:800;margin:6px 0 2px">Majestic Maersk is alongside</div><div class="grade">${grade}</div>
         <div style="display:flex;gap:30px;align-items:flex-end;margin:16px 0 4px"><div><div class="score">${sc}</div><div class="grade">points (base 1000)</div></div><div class="grade">Arrival time ${mins} min<br>First contact ${(G.flags.contactSpeeds && G.flags.contactSpeeds[0] !== undefined) ? (G.flags.contactSpeeds[0] * 100).toFixed(0) + ' cm/s' : '—'}</div></div>
         <table>${rows || '<tr><td>No penalties, no bonuses.</td><td></td></tr>'}</table>
         <div style="display:flex;gap:10px"><button class="go" onclick="location.reload()">New arrival</button><button class="go sec" id="dbStay">Stay on the bridge</button></div>`
      : `<div style="font:600 11px ui-monospace,monospace;letter-spacing:.14em;color:var(--bad)">${SCN.failed.title}</div><div style="font-size:24px;font-weight:800;margin:6px 0 10px">Arrival aborted</div><div style="color:#c6d4dc;line-height:1.6">${SCN.failed.text}</div>
         <table>${rows}</table><div style="display:flex;gap:10px"><button class="go" onclick="location.reload()">Try again</button><button class="go sec" id="dbStay">Continue anyway</button></div>`;
    $('debrief').classList.remove('hidden');
    const stay = $('dbStay'); if (stay) stay.onclick = () => { $('debrief').classList.add('hidden'); G.paused = false; if (!ok) { SCN.failed = null; SCN.penalty('Continued after: ' + $('debriefCard').querySelector('div').textContent, 300, 'cont' + G.simT); } };
  },
};
