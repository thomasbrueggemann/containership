# Realism pass — status and what is left

Written 2026-10-10 when the pass was wrapped up. The goal was "make the game graphics look even more realistic". The rendering itself is
described in the README (*Rendering*); this file records where things stand, what is *not* done, what was tried and dropped, and how to continue.

## State of the code

- `main` = `origin/main` = `ac00606` (pushed 2026-10-10, the Pages deploy ran green): HDR pipeline, volumetric clouds, sea and bow waves,
  weathering, port shadows, culling, paved ground, vessels, terminal and landscape detail.
- Branch `claude/realistic-game-graphics-185717` is **ahead of `origin/main` by the commits listed by `git log origin/main..HEAD` (about fifteen),
  committed but neither merged nor pushed** (a push to `main` deploys the live game, so it waits for a decision): navigation lights, night cloud glow, the AO stripe fix, temporally averaged clouds,
  weathered container palette, sea phase drift, mooring ropes, red night lighting in the wheelhouse, contact darkening of the water, engine
  casing and pilot ladder, sky haze and lit funnel smoke, sparse salt-spray, tooling and this file. `git log origin/main..HEAD` lists them.
- Crew bodies and gait: see the last section.

## Verification at wrap-up

- `node tools/smoke.mjs 60`: all 7 cases clean (morning/golden/night × high, medium, low, `post=off`). Each case also visits the port, checks that
  the far shadows came up, rigs the pilot ladder, makes the mooring lines fast, round-trips a save, resizes the window, and (new) **fails on any
  WebGL driver warning**: the driver reports invalid GL calls as log *warnings*, stops reporting after 256, and `gl.getError()` sampled once per
  view had missed a whole class of them (checked: a deliberately broken build now fails).
- Two 10-minute simulated runs through the harbour entrance (morning, night), alternating bridge and orbit: no exceptions, no GL errors; resource
  counts did not grow between two consecutive 2-minute windows in a separate run (no leak found; the heap sat at 160–170 MB).
- **Performance.** Headless Chrome, Apple GPU, 1280×800 CSS px at DPR 2 (a 2560×1600 canvas), minimum of 3 interleaved rounds of a
  `requestAnimationFrame` interval probe, dynamic resolution *off* (so this is the worst case: the governor would lower the render scale). The
  machine was busy with other work throughout, so trust the ratios, not the milliseconds; successive runs differ by ±2 ms.

  | view | original game | now |
  | --- | --- | --- |
  | wheelhouse, looking ahead | 46 ms | 48–49 ms |
  | yard, free camera | 27 ms | 33–35 ms |
  | berth / port, free camera | 22 ms | 28–30 ms |

  A sweep of the URL switches in the port at this density (default vs switch off): far shadows ≈ 2 ms, the weathering patch (`grunge=off`)
  ≈ 2 ms, the half-resolution cloud target (`clouds=full` is the slow one) 0–2 ms, culling (`lod=off`) and the light shafts within noise. At DPR 1
  the port views of builds after `40aebd9` ran at the 16.7 ms vsync limit (the original was not re-measured at that density in the last round).
  The quality governor (`02b_post.js`) starts one level down on Retina screens and sheds MSAA, cloud steps and render scale in that order, so a
  Retina player sees a lower render scale in busy views rather than a low frame rate. The `low` level renders straight to the canvas without the
  HDR pipeline, far shadows or weathering patch; its cost was not re-measured against the original.

## What is left, in the order a player would notice it

**People.** The crew are still the original tube-and-ball figures with a sine-wave walk (see the last section for the work in progress). Nobody
is on the quay (lashers, signalmen, drivers), which also removes the scale cue next to the ship; about thirty AGVs and trucks loop along 2.6 km
of lanes, which is sparse.

**Sea.**
- The ripple layers are baked tileable textures. An independent image review reported visible repetition (harbour entrance seen from the sea,
  lower right; the moonlit orbit view, left). A full-resolution crop of the entrance view at morning showed none, so it is at most angle- or
  light-dependent and unconfirmed; the moonlit view was not re-checked. A phase drift on the fragment waves was added, but the baked layers
  still tile: a domain warp, or a second, differently rotated set of lookups, would break any repeat that does show.
- The far part of the own ship's wake is a streaky bright band. A real wake also leaves a smooth, darker *slick* (bubbles and surfactants damp
  the ripples) that stays visible at an angle for kilometres. The water shader does not know where the wake ribbon is, so this needs the ribbon
  (or a low-resolution wake map) to feed the shader.
- No airborne spray from the bow in rough water; whitecap variety at distance is thin; harbour water has no silt or oil sheen near the
  berths; the contact darkening beside hulls and quay walls is box-based (`shipAO`/`quayAO` in `02g_shipshadow.js`), not a real occlusion term.

**Land and structures.**
- Trees are lumpy multi-lobe crowns, smooth-shaded, without leaf texture or wind motion; the fields are a colour texture only (no relief).
- Cranes and gantries have ribs, rails and stairs but are still box beams: no lattices, no sagging cables, no pulleys.
- The apron has no puddles or oil sheen, and there are no cones or barriers.
- Moored ships at night show no deck floodlights or gangway light; the other ships use a generic textured-box deckhouse and bridge (the own
  ship has the detailed one).

**Light.** At golden hour the cyan hull stays evenly exposed under a strongly backlit orange sky; it lacks a warm rim and back-scatter. The
sun's glare is a bloom approximation (no lens ghosts).

**Not attempted (new features rather than realism of what exists):** rain, fog or overcast presets, spray on deck, wind motion of trees and
grass, anything below a desktop GPU (iOS and mobile were never tried).

## Engineering follow-ups

- **Hardware-filtered far shadow (tried, not adopted).** Reading the far-shadow map through a `sampler2DShadow` on a depth texture with
  `compareFunction = LessEqualCompare` and linear filtering is one tap instead of four and should recover ≈ 1.5–2 ms in the port at DPR 2. Pitfalls
  found with three r160: (1) its `emptyShadowTexture` is never uploaded, so a shadow sampler whose depth texture has no GL object yet is bound to a
  1×1 *colour* texture and the driver rejects **every draw call** with "Mismatch between texture format and sampler type"; the far render target
  must therefore be created at init (one `setRenderTarget` + `clear`), not at the first bake, because at sea the first bake never happens;
  (2) `precision highp sampler2DShadow;` must be declared in the patched shader; (3) per the WebGL spec a compare-mode depth texture must not be read
  through a plain `sampler2D`, so the `probe()` debug helper has to go. With those fixed there were no GL errors over 150 000 draws, but equality
  with the four-tap version and the real gain were **not** measured, so the change was reverted.
- The weathering patch (`ATMOS.grunge`) costs about 2 ms in the port at DPR 2 (four volume lookups; two are skipped beyond 70 m). A cheaper path
  for pixels beyond a few hundred metres would help the governor.
- `tools/smoke.mjs` is not run by CI (`.github/workflows/pages.yml` only builds and syntax-checks the bundle); a GPU-less runner would need
  SwiftShader and a lot of patience.
- Saves are compatible with the current build (the smoke test round-trips one, including the mooring lines), but nothing was tested against a
  save written by the *original* build.

## Tried and dropped

- **Window reflections of the wheelhouse** (a small cube map of the interior added to the glass by Fresnel): at night the interior is dark and
  reflects almost nothing, by day it is a faint ghost; not worth six extra renders per frame. Removed.
- The stripes on desks, decks and the quay seen at a shallow angle were first suspected to be shadow acne; they were the half-resolution AO pass
  reading depth at texel corners (fixed in `02b_post.js`). If stripes on shallow-angle surfaces come back, look at the AO pass first
  (`?postdebug=ao` shows its buffer).

## How to verify and measure

```bash
node build.mjs && node tools/smoke.mjs 60                       # regression, about 6 minutes
node tools/shot.mjs out "tod=golden&sea=moderate" bridge,orbit,quay 18 1600x1000
SHOT_FREEZE=1 SHOT_TOGGLE="__dbg.POST.settings.shafts = 0" node tools/shot.mjs out "tod=morning" sunGlare 16 1280x800     # exact A/B on one frame
SHOT_EARLY="…" / SHOT_AFTER="…" / SHOT_JS="…"                   # hook before the page runs / probe after the camera is placed / run once
node tools/cpuprof.mjs "tod=morning" bridge 8                   # where the JavaScript time goes
```

Never compare screenshots from two page loads pixel by pixel (the cloud field differs per run); toggle inside one page with `SHOT_TOGGLE`. For
frame times use an interleaved minimum-of-N comparison of this probe, passed as the end of `SHOT_JS` (do **not** combine `SHOT_PERF=1` with
`SHOT_DPR=2`: the synchronous read-backs hang headless Chrome at that density):

```js
new Promise((res) => { let n = 0, t0 = 0; const f = (t) => { if (n === 0) t0 = t; if (++n > 50) res(+((t - t0) / 50).toFixed(1)); else requestAnimationFrame(f); }; setTimeout(() => requestAnimationFrame(f), 2500); })
```

Leftover headless Chrome processes: kill them by PID, never with `pkill -f` (it also kills other sessions' browsers).

## Decisions waiting for you

1. Merge the branch's commits to `main` and push (this deploys the live game).
2. Whether to keep the Retina default of starting the governor one level down.

## Corrections after the first play-through (2026-10-10)

The user played the build and reported three faults; all three were reproduced and fixed, and they are worth knowing about because each one looked fine in the test views.

- **Windows far too dirty.** The wheelhouse glass was a pale, sunlit film (diffuse 0.8/0.88/0.9 lit by a low sun, plus up to 0.4 × 0.45 extra opacity from speckle *and* vertical streaks), which veiled the sea and horizon at golden hour. Now: film colour 0.34/0.38/0.40, only the speckle and a trace of the runs add opacity (0.22 × `uGlassDirt`), `uGlassDirt` 0.2 (wipers 0.03). Check glass changes at golden hour looking at the horizon, not at night.
- **Necks.** The scanned male head stops at the jaw and the code carried its open edge down as a narrow tube whose last row of texture was smeared (vertical stripes, 4× stretched), inside a tall open stand collar; the female model's neck is only 7 cm across. Now: `HEADS.thickenNeck` widens both necks below the jaw (+17 % male, +34 % female, never forwards), `extendNeck` continues the texture down the atlas instead of repeating the last row and flares only 4 %, the shirt's neck rows are a little larger (more room at the back, so nothing pokes through), the V is shallower, the collar closes nearer the throat and its stand is lower. `node tools/crewshot.mjs out neck --ids co,o2 --key` shows front, three-quarter, side and back.
- **Legs collapsing at corners.** A step is timed and aimed for the speed it starts at; leaving a corner the walker accelerates from about 0.5 to 1.3 m/s while the other foot is still in a 0.6 s swing, so the stance foot was left 1 m behind and the pelvis was lowered towards it (to 27 % of the normal hip height, then it snapped back: the "falling"). Now: swings are re-aimed every frame at where the body will be and hurried along when the walk has got faster; steps land along the way the body actually moves (it slides sideways through a corner); a stance foot that is still outrun is dragged (2–12 cm in a tight zig-zag, none in a plain corner) rather than lowering the pelvis, which never goes below 86 % of the hip height; the walking turn rate is 2.8 rad/s instead of 3.6. Measured over right-angle and zig-zag paths for three bodies: lowest pelvis 0.88–0.92 of the hip height (was 0.24–0.44); straight-line foot skate unchanged (0.02 m/s). `node tools/crewshot.mjs out corner --ids ab --key` renders a frame sequence through a corner.

## Crew bodies and walking (done by a Sonnet subagent, integrated)

New modules `src/09b_body.js` (23-bone skinned body, lofted shells, per-person build), `09b_extremities.js` (hands with fingers, shoes), `09b_cloth.js`
(procedural normal/roughness maps: placket, pockets, creases), `09b_details.js` (collar, epaulettes, buckle, radio, hi-vis), `09b_gait.js` (planted feet with
heel strike and toe-off, leg IK, pelvis motion, stride matched to speed, settle steps); `09_crew.js` and `09a_heads.js` call them. Measured foot skate while walking:
lowest-foot speed 3.7 m/s before, 0.02–0.03 m/s after. The smoke test is clean in all seven cases with them. I looked at the bridge by day and night: the bodies read
well; hair is still a plain cap and the glasses basic. Not tested by the agent or me: the AB's helm pose, sit/stand transitions, save/restore of a mid-walk crew
member, frame time with all crew at high quality (a person is near 20 k triangles). The deck figures are a few pixels tall in the orbit view. The agent's
before/after images are in the session scratchpad (`crew/`, temporary); its worktree `.claude/worktrees/agent-a2c16c5d25b500d6f` can be deleted.
