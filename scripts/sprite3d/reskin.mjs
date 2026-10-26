#!/usr/bin/env node
// Issue #16, approach C (whole-sheet reskin): renders the sprite3d TEMPLATE as
// a neutral grey mannequin (MANNEQUIN_RECIPE in styles.js - same body/boneMap
// shape as the real recipes, flat grey zones, no face) and writes two kinds
// of output per animation:
//   - native 64x64 transparent-background PNGs per frame (for the review
//     sheets reskin.py builds later, same convention as render.mjs's strips)
//   - one "sheet" PNG per animation: frames enlarged 8x nearest-neighbour
//     onto a flat magenta (#FF00FF) background, laid out in a single row
//     with an 8-(template-)pixel gap between frames so every boundary in the
//     sheet - frame edges and gaps alike - stays on the 8px pixel-art grid.
//     These sheets are what reskin.py sends to the image models to repaint.
// A frames.json alongside records each frame's exact pixel box in the sheet
// (in sheet pixels, i.e. already x8), so reskin.py can crop back to known
// positions instead of re-detecting them.
//
// Reuses render.mjs's static server, DIRS/YAW/CLIPS/ANIM_LIBRARY constants
// (duplicated here, same values - render.mjs doesn't export them) and the
// renderer.js page/compose pipeline already used for the real recipes.
//
// Usage: node scripts/sprite3d/reskin.mjs [--out <dir>]
// Output default: skin-output/round1/mannequin (gitignored).

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { MANNEQUIN_RECIPE } from "./styles.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 8140;
const SERVER_URL = `http://localhost:${PORT}`;
const PAGE_URL = `${SERVER_URL}/scripts/sprite3d/page.html`;
const MODELS2_ROOT = "/tmp/sprite3d/r2";
const ANIM_LIBRARY = "/models2/UAL1_Standard.glb";
const CLIPS = { idle: "Idle_Loop", walk: "Walk_Loop" };

// Same 8-direction order and yaw mapping as render.mjs (see that file for
// the convention this matches - screen-compass names, courier-matched yaws).
const DIRS = ["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"];
const YAW = {
  "south-east": 0, south: 45, "south-west": 90, west: 135,
  "north-west": 180, north: 225, "north-east": 270, east: 315,
};
const WALK_FRAMES = 6;
const FRAME = 64; // template frame size, px
const SCALE = 8; // enlargement for the model-facing sheets
const GAP = 8; // gap between frames, in template px - kept on the 8px grid

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".png": "image/png",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream",
};

async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, SERVER_URL);
      let file = null;
      if (url.pathname.startsWith("/scripts/") || url.pathname.startsWith("/node_modules/")) {
        file = path.join(ROOT, url.pathname);
      } else if (url.pathname.startsWith("/models2/")) {
        const rel = decodeURIComponent(url.pathname.slice("/models2/".length));
        file = path.resolve(MODELS2_ROOT, rel);
        if (!file.startsWith(MODELS2_ROOT + "/")) throw new Error(`bad models2 path ${url.pathname}`);
      }
      if (!file || !(await stat(file).then((s) => s.isFile()).catch(() => false))) {
        throw new Error(`not found: ${req.url}`);
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(await readFile(file));
    } catch (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(String(err.message || err));
      console.error(`[server] ${err.message || err}`);
    }
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  return server;
}

async function savePng(dataUrl, file) {
  await writeFile(file, Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"));
}

function parseArgs(argv) {
  const args = { out: path.join("/Users/decker/Documents/cyberdash/skin-output", "round1", "mannequin") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 320, height: 320 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error(`[pageerror] ${err}`));
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") console.error(`[page:${msg.type()}] ${msg.text()}`);
    });
    await page.goto(PAGE_URL);
    const info = await page.evaluate(
      async (opts) => {
        window.__sprite3d.init();
        return window.__sprite3d.load(opts.url, { hairUrl: opts.hairUrl, recipe: opts.recipe, animUrl: opts.animUrl });
      },
      { url: MANNEQUIN_RECIPE.bodyUrl, hairUrl: MANNEQUIN_RECIPE.hairUrl, recipe: MANNEQUIN_RECIPE, animUrl: ANIM_LIBRARY },
    );
    console.log(`[mannequin] clips available: ${info.clips.length}, height ${info.height.toFixed(2)}`);
    await page.evaluate((clip) => window.__sprite3d.calibrate(clip), CLIPS.idle);

    const framesDir = path.join(args.out, "frames");
    await mkdir(framesDir, { recursive: true });

    // Idle: one native frame per direction.
    const idleFrames = [];
    for (const dir of DIRS) {
      const url = await page.evaluate(
        ({ clip, yaw }) => window.__sprite3d.renderFrame(clip, 0, yaw).toDataURL(),
        { clip: CLIPS.idle, yaw: YAW[dir] },
      );
      await savePng(url, path.join(framesDir, `idle-${dir}.png`));
      idleFrames.push({ dir, url });
    }

    // Walk: 6 south-east frames.
    const walkClip = info.durations[CLIPS.walk] !== undefined ? CLIPS.walk : null;
    if (!walkClip) throw new Error(`no duration for clip ${CLIPS.walk}`);
    const duration = info.durations[CLIPS.walk];
    const walkFrames = [];
    for (let i = 0; i < WALK_FRAMES; i++) {
      const t = (i / WALK_FRAMES) * duration;
      const url = await page.evaluate(
        ({ clip, time, yaw }) => window.__sprite3d.renderFrame(clip, time, yaw).toDataURL(),
        { clip: CLIPS.walk, time: t, yaw: YAW["south-east"] },
      );
      await savePng(url, path.join(framesDir, `walk-south-east-${i}.png`));
      walkFrames.push({ i, url });
    }

    // Model-facing sheets: 8x nearest-neighbour, magenta background, frames
    // laid out with an 8-(template-)px gap - everything stays on the 8px grid.
    const step = FRAME + GAP; // template px between each frame's left edge
    const idleCells = idleFrames.map((f, i) => ({ src: f.url, dx: i * step, dy: 0, w: FRAME, h: FRAME }));
    const idleSheetW = idleFrames.length * step - GAP;
    const idleSheet = await page.evaluate(
      ({ cells, w, h, scale, bg }) => window.__sprite3d.compose(cells, w, h, scale, bg),
      { cells: idleCells, w: idleSheetW, h: FRAME, scale: SCALE, bg: "#FF00FF" },
    );
    await savePng(idleSheet, path.join(args.out, "idle-8dir-8x.png"));

    const walkCells = walkFrames.map((f, i) => ({ src: f.url, dx: i * step, dy: 0, w: FRAME, h: FRAME }));
    const walkSheetW = walkFrames.length * step - GAP;
    const walkSheet = await page.evaluate(
      ({ cells, w, h, scale, bg }) => window.__sprite3d.compose(cells, w, h, scale, bg),
      { cells: walkCells, w: walkSheetW, h: FRAME, scale: SCALE, bg: "#FF00FF" },
    );
    await savePng(walkSheet, path.join(args.out, "walk-south-east-8x.png"));

    // Frame-position metadata, in sheet pixels (already x8), for reskin.py's
    // fixed-box crop - the model is asked to keep every figure's exact
    // position, so we crop at the positions we dictated rather than
    // re-detecting them from the model's (possibly imperfect) response.
    const frameBox = (i) => ({ x0: i * step * SCALE, y0: 0, x1: (i * step + FRAME) * SCALE, y1: FRAME * SCALE });
    const meta = {
      frame: FRAME, scale: SCALE, gap: GAP,
      idle: { dirs: DIRS, boxes: DIRS.map((_, i) => frameBox(i)) },
      walk: { count: WALK_FRAMES, boxes: Array.from({ length: WALK_FRAMES }, (_, i) => frameBox(i)) },
    };
    await writeFile(path.join(args.out, "frames.json"), JSON.stringify(meta, null, 2));
    console.log(`[mannequin] wrote native frames, 2 model-facing sheets and frames.json to ${args.out}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
