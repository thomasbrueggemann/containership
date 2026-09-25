# Triple-E Bridge Command

A single-file WebGL (three.js) ship-handling simulator: take the Triple-E class
container ship **MAJESTIC MAERSK** (399 m, 18 270 TEU) from the sea buoy into the
fictional port of Westerhaven and put her alongside Berth 4.

**Play:** <https://thomasbrueggemann.github.io/containership/>

## Run

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765>. (`index.html` is self-contained; three.js loads from jsDelivr.)
URL options: `?autostart&tod=night&wind=fresh&voice=off&quality=medium`.

## Build

The game is authored as modules in `src/` and concatenated into `index.html`:

```bash
node build.mjs
```

| File | Contents |
| --- | --- |
| `src/07_physics.js` | 3-DOF manoeuvring model (Clarke hull derivatives, MMG-style twin rudders in prop wash, cross-flow drag, bow thrusters, tugs, wind, current, squat/shallow water, fenders, mooring lines) |
| `src/03_world.js` | Bathymetry, breakwaters, quays with fenders/bollards, STS & ASC cranes, container yard, buoys (IALA A), turbines, city |
| `src/04_ship.js` | Lofted hull with painted livery, SOLAS-sightline container stowage, deckhouse, funnel, tugs, pilot boat |
| `src/05_bridge.js` | Wheelhouse, integrated bridge console, overhead panel, wing consoles with glass floor, all clickable controls |
| `src/06_instruments.js` | Radar (sweep/persistence, ARPA/AIS, CPA), ECDIS (S-52-style depth shading, route, predictor), conning, docking, engine, echo sounder, VHF |
| `src/08_traffic.js`, `src/09_crew.js`, `src/11_scenario.js` | Traffic, tugs, crew with speech & delegated orders, the 12-step arrival and scoring |

`tools/phystest.mjs` runs the physics headlessly (speed table, stopping, turning circle).

## Credits

- [three.js](https://threejs.org) (MIT), loaded from jsDelivr.
- Crew faces use the Lee Perry-Smith head scan from the three.js examples
  ([Infinite-Realities](https://www.ir-ltd.net), CC BY 3.0).

Fan-made; not an official Maersk product. Port geography is fictional.
