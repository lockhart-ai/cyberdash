---
name: look
description: Use when you need to see or drive the running CyberDash game — take a screenshot of the city/courier, move the player to a spot and check what's visible, or record a short sequence (e.g. teleport, hold a key, screenshot) as a video. Opens the dev server in headless Chromium; does not require a visible display.
---

# look

Drives the running CyberDash game headlessly (Playwright + Chromium) and saves screenshots, an
optional video, and a JSON summary of what happened — including console/page errors, which fail
the run.

## Setup (once)

```
npm install            # pulls in the playwright devDependency
npm run look:setup     # downloads the chromium-headless-shell browser binary
```

## Quick mode — one screenshot

```
npm run look -- --col 90 --row 117 --face east
```

Teleports the player to grid cell (col 90, row 117), faces them east, and takes one screenshot.
`--face` is optional. Output goes to `look-output/<timestamp>/` unless `--out <dir>` is given.

## Full mode — a sequence of steps

```
npm run look -- --steps path/to/steps.json [--video] [--out <dir>]
```

`steps.json` is a JSON array of step objects, run in order:

```json
[
  { "op": "teleport", "col": 90, "row": 117 },
  { "op": "face", "dir": "east" },
  { "op": "hold", "keys": ["Shift", "ArrowRight"], "ms": 800 },
  { "op": "pause" },
  { "op": "screenshot", "name": "after-run" },
  { "op": "resume" },
  { "op": "state" }
]
```

### Ops

- `teleport {col, row}` — move the player to a grid cell instantly; the camera snaps to match
  (no settle wait needed).
- `face {dir}` — set facing and show that direction's idle sprite. Directions: `north`, `south`,
  `east`, `west`, `north-east`, `north-west`, `south-east`, `south-west`.
- `hold {keys: [...], ms}` — real keyboard down/up (e.g. `["Shift", "ArrowRight"]` to run east)
  held for `ms` milliseconds.
- `wait {ms}` — do nothing for `ms` milliseconds.
- `pause` — freeze the game (update, physics, animation) while rendering keeps working, so a
  screenshot taken while paused still shows a clean, stable frame instead of a mid-tween blur.
- `resume` — unfreeze it.
- `screenshot {name}` — save a PNG named `<name>.png` in the output dir; also records player
  state (position, facing, prop/building-RT counts) into the summary at that point.
- `state` — record player state into the summary without taking a screenshot.

## Where output goes

Each run writes to its output dir (`look-output/<timestamp>/` by default, or `--out <dir>`):

- `*.png` — one per `screenshot` step.
- `*.webm` — the full run, only with `--video`.
- `summary.json` — per-step results (state after each `screenshot`/`state` step), every console
  message (minus known-noisy software-rendering warnings — see Caveats), page errors, and the
  resolved output paths.

The script prints the output paths at the end, so you know which PNGs to open.

## Server handling

Probes `http://localhost:3000` first. If nothing is listening there, it starts
`npx vite --port 3000 --strictPort` itself and stops it when the run ends. If the dev server is
already running (e.g. you have `npm run dev` open), it reuses that one and leaves it running.

## Caveats

- **Headless FPS is meaningless.** The browser renders with software WebGL (SwiftShader, no real
  GPU), which is much slower than a real GPU — ignore any FPS number in a screenshot or the HUD.
- **col/row are grid cells, not pixels.** They're exactly what the in-game HUD shows as
  `col X, row Y` — use those, not screen x/y.
- The harness only works against a dev server (`vite`): the hook it drives
  (`window.__cyberdash`) is stripped out of production builds.
- A console error or an uncaught page error fails the run (non-zero exit) and is printed, along
  with being recorded in `summary.json`.
