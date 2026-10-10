# Triple-E Bridge Command

A single-file WebGL (three.js) ship-handling simulator: take the Triple-E class
container ship **MAJESTIC MAERSK** (399 m, 18 270 TEU) from the sea buoy into the
fictional port of Westerhaven and put her alongside Berth 4.

**Play:** <https://thomasbrueggemann.github.io/containership/>

## Run

```bash
python3 -m http.server 8765
```

Run `node build.mjs` first, then open <http://localhost:8765>. (`index.html` is self-contained; three.js loads from jsDelivr.)
URL options: `?autostart&tod=night&wind=fresh&sea=rough&voice=off&quality=medium`. For debugging the renderer, `post=off` skips the HDR
post-processing path and `dynres=off` pins the render resolution (see *Rendering* below).

Crew voices are synthesised in the browser by [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (via
`kokoro-js`, on WebGPU in a Web Worker). The ~330 MB model is fetched from Hugging Face on the first visit and cached by
the browser. The bridge team is heard in the room; VTS, tugs, the pilot boat, the deck stations and the engine room come
through a VHF radio chain (band-pass, nasal mid boost, soft clipping, hiss). Without WebGPU the game falls back to the
browser's built-in speech.

Progress is saved in the browser's `localStorage` (pause menu, the **Save** button or Ctrl/⌘+S, plus an
autosave every 90 s and when the tab is closed). The start screen lists the five most recent saves.

## Build

The game is authored as modules in `src/` and concatenated into `index.html`:

```bash
node build.mjs
```

On every push to `main`, the GitHub Action in `.github/workflows/pages.yml` runs the build,
syntax-checks the bundle and deploys `index.html` to GitHub Pages. `index.html` is a build
output and is not committed; run `node build.mjs` locally before serving.

| File | Contents |
| --- | --- |
| `src/07_physics.js` | 3-DOF manoeuvring model (Clarke hull derivatives, MMG-style twin rudders in prop wash, cross-flow drag, bow thrusters, tugs, wind, current, squat/shallow water, fenders, mooring lines) |
| `src/02_env.js`, `src/02a_atmos.js`, `src/02b_post.js`, `src/02c_shipwaves.js`, `src/02d_bowfoam.js`, `src/02e_lod.js`, `src/02f_farshadow.js`, `src/02g_shipshadow.js`, `src/04a_navlights.js` | Sky & sea (see *Rendering*), sky-coloured fog, volumetric clouds, sun/moon/stars, floodlight and exhaust systems, HDR post-processing, bow waves & Kelvin wakes, screen-size culling, the port's shadows, ship shadows on the water, navigation lights |
| `src/03_world.js` | Bathymetry, breakwaters, quays with fenders/bollards, STS & ASC cranes, container yard, buoys (IALA A), turbines, city |
| `src/04_ship.js` | Lofted hull with painted livery, SOLAS-sightline container stowage, deckhouse, funnel, tugs, pilot boat |
| `src/05_bridge.js` | Wheelhouse, integrated bridge console, overhead panel, wing consoles with glass floor, all clickable controls |
| `src/06_instruments.js` | Radar (sweep/persistence, ARPA/AIS, CPA), ECDIS (S-52-style depth shading, route, predictor), conning, docking, engine, echo sounder, VHF |
| `src/08_traffic.js`, `src/09_crew.js`, `src/11_scenario.js` | Traffic, tugs, crew with speech, delegated orders carried out at the consoles (radio, phone, radar…) and idle routines, the 12-step arrival and scoring |
| `src/14_save.js` | Save games: snapshot / restore of ship, scenario, traffic, tugs and crew in `localStorage` |

`tools/phystest.mjs` runs the physics headlessly (speed table, stopping, turning circle).

## Rendering

The picture is built for plausibility rather than looks alone: everything is lit in linear HDR and tone-mapped once, at the end.

- **Pipeline** (`02b_post.js`): clouds (half resolution) → scene → half-float 4× MSAA target → screen-space ambient occlusion (from the log-depth
  buffer) → bloom (13-tap downsample chain, with the sun's glare and light shafts – the bright sky smeared towards the sun, blocked by solid things – injected at its 1/8 level when the sun is in view) → filmic tone curve, grading, vignette, sharpening → canvas. A quality governor watches the frame
  rate and sheds load in the order of what costs the least to look at (2× instead of 4× MSAA and a shorter cloud march first, then render
  scale in steps, AO last because it is nearly free) and climbs back after a few calm seconds; on a Retina screen it starts one step down, and
  the HDR target is capped at ~3.2 MP, so the picture is upscaled with sharpening. *High* uses all of it, *Balanced* drops the AO and halves the
  MSAA, *Low* renders straight to the canvas as before. URL flags for debugging: `post=off`, `dynres=off`, `clouds=full`, `grunge=off`,
  `glassdirt=off`, `lod=off`, `shafts=off`, `farshadow=off`, `gpuprof=1`.
- **Culling** (`02e_lod.js`): the scene is ~2 200 draw calls a frame (sun shadow, mirrored view of the sea, main view), and on a high-DPI screen
  that, not the pixels, is the cost. Every mesh is put on a layer by how large it appears – drawn and mirrored, drawn but not mirrored (too
  small to register in the rippled reflection), or not drawn (under ¾ of a pixel) – with thresholds that follow the field of view, so
  binoculars bring the small things back. A mesh can also carry `userData.farCull` – a distance beyond which it is not drawn at all (the yard gantries' fine
  structure, the detailed tree crowns). Draw calls roughly halve; an A/B on a frozen frame changes 0.03 % of the pixels.
- **Sky** (`02a_atmos.js`): a Preetham clear sky is baked into cube maps for lighting and reflections; clouds are raymarched live through a
  96³ GPU noise volume (cumulus layer with self-shadowing, plus cirrus) into a half-resolution target with a jitter that changes every frame and
  is averaged over time (reprojected by the camera's rotation alone, clamped to the current neighbourhood so it never ghosts; `cloudacc=off`
  shows the raw march), and the dome composites them with a real sun
  disc, moon with maria, stars and Milky Way drawn crisp at full resolution. A CPU copy of the same volume tells the game how much of the sun
  reaches the ship, so the light dims and returns as clouds drift over it.
  Every fogged material blends towards the sky colour *in the direction it is seen* (aerial perspective).
- **Sea** (`02_env.js`): 6 swell trains + 34 spectral wave components with trochoidal crest sharpening, ripple normals, planar reflection of the
  ship and port, depth-dependent colour, breaking foam from crest convergence and on shoals, cloud shadows, and a streaky wake ribbon.
- **Ship waves** (`02c_shipwaves.js`, `02d_bowfoam.js`): every vessel under way gets a bow wave, a hull-side trough and a Kelvin wedge,
  evaluated in the water shader in the ship's own frame (so they displace, light, reflect and fog like the sea). The bow wave's height and
  position follow from the hull's entrance angle, draught and speed (Noblesse et al.: ≈ V²/2g for a big ship, minus a quarter for the bulb, ≈ 2.5 m
  at 16 kn): a smooth hump over the bulb, the water climbing the stem, a crest that leaves the hull a metre or two aft and curves out to the
  Kelvin angle, the trough behind it. The crest breaks as a roller of white water on its front face – unbroken at the stem, in bursts and patches
  farther out – that stays with the ship while the water runs through it. What it leaves behind stays on the water: for the own ship a
  simulated field on a water-fixed grid (thick for a few seconds, then a lace that lingers), for other vessels its steady state. The water's
  sideways displacement by the hull is mapped, not advected, so streaks slide out round the bow and along the hull without smearing. The bow
  region of the own ship has its own fine mesh, so the crest has a real body from close up. Turquoise bubble clouds, turbulent normals; the
  white water is lit by sky and sun/moon. The bow wave swells as the bow digs into a wave and shrinks as it lifts. `?swdebug` paints the fields.
- **Land and structures**: the mainland is a patchwork of fields with hedgerows and tracks (`landTexture`); trees are lumpy multi-lobe broadleaf, poplar
  and conifer crowns with per-tree tint, height and lean (cheaper crowns beyond the terminal); the yard gantries and quay cranes carry stiffener ribs, rails,
  handrails, louvres and stair towers, and the gantries hang containers from their spreaders. The mooring lines are three-strand laid ropes that sag
  between the fairlead and the bollard they are made fast to, with an eye over it.
- **Materials**: object-space weathering (stains, rain streaks, roughness variation) is injected into every standard material; containers,
  hull plating and deckhouse facades carry normal and roughness/metalness maps generated in `01_textures.js`; so do the apron concrete, the
  asphalt and the quay wall (slabs with their own tone, cracks, oil, truck lanes – colour, height and roughness drawn together so they agree);
  bridge glass collects salt spray that the wipers clear.
- **Night**: the ~60 floodlight masts, crane lights and the ship's deck lights (console button) are analytic lights evaluated for the 10 nearest
  lamps per pixel; point lights burn out and bloom. Vessels under way show their COLREG lights (`04a_navlights.js`): masthead lights, green and red
  sidelights and the stern light, each drawn only inside its legal sector (so a ship seen end-on shows red and green, from the side only one of them),
  kept a visible point at miles and faded beyond the legal range of its class; ships alongside show none. At night the terminal's floodlights also warm the underside of the clouds over the port (light pollution, in the cloud march).
- **Shadows**: one sun shadow map fitted to the bridge, or to the whole ship in the external view, snapped to texels so shadows do not crawl.
  The sea is a shader, not a lit mesh, so the shadow map never reaches it; instead (`02g_shipshadow.js`) each ship near the camera is reduced to
  four boxes (hull, stacks, accommodation, funnel) and every sea pixel tests whether the ray to the sun runs through one of them, with a soft
  edge about as wide as the sun's disc. A low sun lays the ship's shadow across the water and the quay, which is much of what makes a ship look
  seated in the sea. The port itself casts through a second, coarser shadow map (`02f_farshadow.js`): everything static under the world root is
  drawn from the sun, back faces only (so lit surfaces never shadow themselves and nothing needs biasing), into a 2–3 k depth texture around the ship
  that is redone when she has moved a fifth of its radius or every 2 s (the cranes work; a pass costs about a millisecond). The materials multiply it into the sun's shadow term, so cranes and
  stacks shade each other, the apron, the quay wall, the ship alongside and – through the sea shader – the water. `?farshadow=off` disables it.

`tools/shot.mjs` takes screenshots of any camera preset in headless Chrome (`node tools/shot.mjs out "tod=night&sea=rough" bridge,orbit,port 14 1600x900`),
`SHOT_ROOT=<dir>` renders another build for before/after pairs, `SHOT_PERF=1` prints frame times (not at `SHOT_DPR=2`, where synchronous read-backs hang headless Chrome),
`SHOT_FREEZE=1` with `SHOT_TOGGLE="…"` shoots every view twice on one frozen frame with a switch thrown in between – an exact A/B of a single feature. `tools/smoke.mjs` starts
the game in every time of day and quality level, runs the simulation, visits the port with a free camera, and fails on exceptions, GL errors, blank frames, far shadows that
do not come up, or a broken save/restore round trip.
`tools/cpuprof.mjs` samples the JavaScript profile of the running game and reports how much of each frame the page spends waiting for the GPU.

## Credits

- [three.js](https://threejs.org) (MIT), loaded from jsDelivr.
- Voices: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) via [kokoro-js](https://www.npmjs.com/package/kokoro-js) (Apache-2.0).
- Crew faces use the Lee Perry-Smith head scan from the three.js examples
  ([Infinite-Realities](https://www.ir-ltd.net), CC BY 3.0).
- The female officer's head and hair come from the `female02` figure in the three.js examples
  (Reallusion iClone, via Google 3D Warehouse).

Fan-made; not an official Maersk product. Port geography is fictional.
