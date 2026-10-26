#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
// Sprite3D prototype driver (#15). Serves the page, GLBs and courier references over
// localhost, drives page.html in headless Chromium (software WebGL), and writes PNG
// strips + review sheets to the round output directory.
//
// Usage: node scripts/sprite3d/render.mjs [--out <dir>]
// Output default: sprite3d-output/round3 inside the repo (gitignored).
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { RECIPES } from "./styles.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const PORT = 8137;
const SERVER_URL = `http://localhost:${PORT}`;
const PAGE_URL = `${SERVER_URL}/scripts/sprite3d/page.html`;

// Directory order used everywhere (matches the courier file naming).
const DIRS = [
  "south",
  "south-west",
  "west",
  "north-west",
  "north",
  "north-east",
  "east",
  "south-east",
];

// Yaw about the vertical axis for each direction, in degrees. The GLB characters face
// local +Z (glTF convention); the camera looks from world (+x, +y) toward the origin, so
// world +y is screen right-down and world +x is screen left-down. The courier sprites use
// a screen-compass convention (south.png = straight front toward the viewer, west.png =
// left profile, north.png = back; verified against the idle sheet), so each direction's
// yaw follows that: south = rotate +Z onto (+1,+1)/sqrt(2) = 45, west = 135, etc.
// (Note: the game maps "south" movement to grid row+1 = screen lower-left — the sprites
// are named by screen compass, not by movement axis. We match the sprites.)
const YAW = {
  "south-east": 0,
  south: 45,
  "south-west": 90,
  west: 135,
  "north-west": 180,
  north: 225,
  "north-east": 270,
  east: 315,
};

// The Quaternius base bodies + one Universal Animation Library, styled by the recipes
// in styles.js. Same skeleton and bone names across body, hair and the animation
// library, so the clips play on the body directly.
const ANIM_LIBRARY = "/models2/UAL1_Standard.glb";
// Round 3 (#15), fix 3: checked against the alternatives by rendering south-east
// strips of each (sprite3d-output/clipcheck/*.png, not committed). Of the 41 clips
// (A_TPose, Crouch_*, Dance_Loop, Death01, Driving_Loop, Fixing_Kneeling, Hit_*,
// Idle_Loop, Idle_Talking_Loop, Idle_Torch_Loop, Interact, Jog_Fwd_Loop, Jump_*,
// PickUp_Table, Pistol_*, Punch_*, Push_Loop, Roll, Sitting_*, Spell_Simple_*,
// Sprint_Loop, Swim_*, Sword_*, Walk_Formal_Loop, Walk_Loop) — Idle_Loop was already
// the most upright, neutral stand (the combat/tool idles like Pistol_Idle_Loop and
// Sword_Idle hunch into a stance; Sitting/Crouch aren't standing poses at all), so
// it's kept. Walk_Formal_Loop holds the arms in closer to the body (more reserved)
// but reads almost the same as Walk_Loop at 64px, so the plainer Walk_Loop is kept for
// all three recipes rather than picking a walk per outfit. Jog_Fwd_Loop and
// Sprint_Loop also read very similarly at this size; Jog_Fwd_Loop's shorter stride
// looks marginally calmer and was already proven in round 2, so it's kept.
const CLIPS = { idle: "Idle_Loop", walk: "Walk_Loop", run: "Jog_Fwd_Loop" };

const CHARACTERS = Object.entries(RECIPES).map(([key, recipe]) => ({
  key,
  url: recipe.bodyUrl,
  hairUrl: recipe.hairUrl,
  recipe,
  animUrl: ANIM_LIBRARY,
}));

// Where the driver's static server maps /models2/* — copies of the purchased packs
// (assets are read-only; these were copied to /tmp unmodified).
const MODELS2_ROOT = "/tmp/sprite3d/r2";

const FRAMES = { idle: 1, walk: 6, run: 8 }; // frames per direction per animation

function parseArgs(argv) {
  const args = { out: path.join(ROOT, "sprite3d-output", "round3") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

// --- static server ---------------------------------------------------------------

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
};

async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, SERVER_URL);
      let file = null;
      if (
        url.pathname.startsWith("/scripts/") ||
        url.pathname.startsWith("/node_modules/")
      ) {
        file = path.join(ROOT, url.pathname);
      } else if (url.pathname.startsWith("/courier/")) {
        const name = path.basename(url.pathname);
        if (!/\.(png|json)$/.test(name))
          throw new Error(`bad courier path ${url.pathname}`);
        file = path.join(ROOT, "public", "assets", "player", name);
      } else if (url.pathname.startsWith("/models/")) {
        const name = path.basename(url.pathname);
        const character = CHARACTERS.find((c) => path.basename(c.url) === name);
        if (!character) throw new Error(`no model registered for ${name}`);
        file = character.source;
      } else if (url.pathname.startsWith("/models2/")) {
        // Copies of the purchased packs under /tmp (assets are read-only originals).
        const rel = decodeURIComponent(url.pathname.slice("/models2/".length));
        file = path.resolve(MODELS2_ROOT, rel);
        if (!file.startsWith(MODELS2_ROOT + "/"))
          throw new Error(`bad models2 path ${url.pathname}`);
      }
      if (
        !file ||
        !(await stat(file)
          .then((s) => s.isFile())
          .catch(() => false))
      ) {
        throw new Error(`not found: ${req.url}`);
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] || "application/octet-stream",
      });
      res.end(body);
    } catch (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(String(err.message || err));
      console.error(`[server] ${err.message || err}`);
    }
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  return server;
}

// --- driver ----------------------------------------------------------------------

async function savePng(dataUrl, file) {
  await writeFile(
    file,
    Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"),
  );
}

function pickClip(clips, wanted, characterKey, role) {
  const lower = clips.map((c) => c.toLowerCase());
  const idx = lower.indexOf(wanted.toLowerCase());
  if (idx >= 0) return clips[idx];
  // Fuzzy: clip name contains the wanted word.
  const loose = clips.filter((c) =>
    c.toLowerCase().includes(wanted.toLowerCase()),
  );
  if (loose.length === 1) return loose[0];
  throw new Error(
    `${characterKey}: no ${role} clip matching "${wanted}" (clips: ${clips.join(", ")})`,
  );
}

// Renders every frame for one styled character. Returns { frames, info } so main can
// compose the combined courier-vs-punk-vs-corporate review sheets afterwards.
async function renderCharacter(page, character, outDir) {
  await page.goto(PAGE_URL);
  const info = await page.evaluate(
    async (opts) => {
      const api = window.__sprite3d;
      api.init();
      return api.load(opts.url, {
        hairUrl: opts.hairUrl,
        recipe: opts.recipe,
        animUrl: opts.animUrl,
      });
    },
    {
      url: character.url,
      hairUrl: character.hairUrl,
      recipe: character.recipe,
      animUrl: character.animUrl,
    },
  );
  console.log(`[${character.key}] clips: ${info.clips.join(", ")}`);
  console.log(
    `[${character.key}] model height ${info.height.toFixed(2)} units, ${info.materialsReplaced} materials made toon, anims from ${info.animSource}`,
  );

  const chosen = {
    idle: pickClip(info.clips, CLIPS.idle, character.key, "idle"),
    walk: pickClip(info.clips, CLIPS.walk, character.key, "walk"),
    run: pickClip(info.clips, CLIPS.run, character.key, "run"),
  };
  console.log(`[${character.key}] using clips: ${JSON.stringify(chosen)}`);

  // Calibrate the fixed framing on the idle pose (frontal) so the figure matches the
  // courier's framing: opaque silhouette 46px tall, feet on row 55, centred at px 32.
  const cal = await page.evaluate(
    (clipName) => window.__sprite3d.calibrate(clipName),
    chosen.idle,
  );
  console.log(
    `[${character.key}] calibrated: opaque x[${cal.minx},${cal.maxx}] y[${cal.miny},${cal.maxy}]`,
  );

  const charDir = path.join(outDir, character.key);
  await mkdir(charDir, { recursive: true });

  // Render every frame: idle (1), walk (6), run (8) per direction.
  const frames = {}; // anim -> dir -> [dataURL]
  for (const [anim, count] of Object.entries(FRAMES)) {
    const clip = chosen[anim];
    const duration = info.durations[clip];
    frames[anim] = {};
    for (const dir of DIRS) {
      const urls = [];
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : (i / count) * duration; // last frame < duration (wraps to frame 0)
        urls.push(
          await page.evaluate(
            ({ clipName, time, yaw }) => {
              return window.__sprite3d
                .renderFrame(clipName, time, yaw)
                .toDataURL();
            },
            { clipName: clip, time: t, yaw: YAW[dir] },
          ),
        );
      }
      frames[anim][dir] = urls;
    }
  }

  // Strips: one PNG per animation per direction.
  for (const [anim, count] of Object.entries(FRAMES)) {
    for (const dir of DIRS) {
      const cells = frames[anim][dir].map((src, i) => ({
        src,
        dx: i * 64,
        dy: 0,
        w: 64,
        h: 64,
      }));
      const strip = await page.evaluate(
        ({ cells, w, h, scale }) =>
          window.__sprite3d.compose(cells, w, h, scale),
        { cells, w: count * 64, h: 64, scale: 1 },
      );
      await savePng(strip, path.join(charDir, `${anim}-${dir}.png`));
    }
  }
  console.log(`[${character.key}] wrote 24 strips to ${charDir}`);
  return { frames, page, outDir };
}

// Row of 8 idle cells (64px each) for a rendered character or the courier reference.
function idleRow(framesOrNull, courierUrl) {
  return DIRS.map((dir, i) => ({
    src: framesOrNull ? framesOrNull.idle[dir][0] : `${courierUrl}/${dir}.png`,
    dx: i * 64,
    dy: 0,
    w: 64,
    h: 64,
  }));
}

// South-east walk/run strip for the courier reference pngs (rendered strips are
// composed inline in composeSheetB, per character).
function courierAnimRow(anim, courierUrl, count) {
  return [
    {
      src: `${courierUrl}/${anim}-south-east.png`,
      dx: 0,
      dy: 0,
      w: count * 64,
      h: 64,
    },
  ];
}

// Review sheet (a): courier idle row, then each styled recipe — 8 directions each.
async function composeSheetA(page, rendered, courierUrl) {
  const rows = [
    { label: "courier", row: idleRow(null, courierUrl) },
    ...rendered.map((r) => ({
      label: r.key,
      row: idleRow(r.frames, courierUrl),
    })),
  ];
  const cells = rows.flatMap((r, i) =>
    r.row.map((c) => ({ ...c, dy: i * 64 })),
  );
  const sheet = await page.evaluate(
    async ({ cells, w, h, scale, bg }) =>
      window.__sprite3d.compose(cells, w, h, scale, bg),
    { cells, w: 512, h: rows.length * 64, scale: 3, bg: "#808080" },
  );
  return sheet;
}

// Review sheet (b): south-east walk and run, courier row then each styled recipe.
async function composeSheetB(page, rendered, courierUrl) {
  const rows = [];
  for (const anim of ["walk", "run"]) {
    const count = FRAMES[anim];
    rows.push({
      label: `courier ${anim}`,
      row: courierAnimRow(anim, courierUrl, count),
    });
    for (const r of rendered) {
      const strip = await page.evaluate(
        ({ cells, w, h, scale }) =>
          window.__sprite3d.compose(cells, w, h, scale),
        {
          cells: r.frames[anim]["south-east"].map((src, i) => ({
            src,
            dx: i * 64,
            dy: 0,
            w: 64,
            h: 64,
          })),
          w: count * 64,
          h: 64,
          scale: 1,
        },
      );
      rows.push({
        label: `${r.key} ${anim}`,
        row: [{ src: strip, dx: 0, dy: 0, w: count * 64, h: 64 }],
      });
    }
  }
  const cells = [];
  rows.forEach((r, i) =>
    r.row.forEach((c) => cells.push({ ...c, dy: i * 64 })),
  );
  const sheet = await page.evaluate(
    async ({ cells, w, h, scale, bg }) =>
      window.__sprite3d.compose(cells, w, h, scale, bg),
    { cells, w: 512, h: rows.length * 64, scale: 3, bg: "#808080" },
  );
  return sheet;
}

// Review sheet (c), round 3 (#15): south and south-east idle frames only, 6x zoomed,
// courier row then the rendered characters — close enough to read the face post-pass
// and the interior ink lines (fixes 2 and 4).
const ZOOM_DIRS = ["south", "south-east"];

function zoomRow(framesOrNull, courierUrl) {
  return ZOOM_DIRS.map((dir, i) => ({
    src: framesOrNull ? framesOrNull.idle[dir][0] : `${courierUrl}/${dir}.png`,
    dx: i * 64,
    dy: 0,
    w: 64,
    h: 64,
  }));
}

async function composeSheetC(page, rendered, courierUrl) {
  const rows = [
    { label: "courier", row: zoomRow(null, courierUrl) },
    ...rendered.map((r) => ({
      label: r.key,
      row: zoomRow(r.frames, courierUrl),
    })),
  ];
  const cells = rows.flatMap((r, i) =>
    r.row.map((c) => ({ ...c, dy: i * 64 })),
  );
  const sheet = await page.evaluate(
    async ({ cells, w, h, scale, bg }) =>
      window.__sprite3d.compose(cells, w, h, scale, bg),
    {
      cells,
      w: ZOOM_DIRS.length * 64,
      h: rows.length * 64,
      scale: 6,
      bg: "#808080",
    },
  );
  return sheet;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 320, height: 320 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error(`[pageerror] ${err}`));
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning")
        console.error(`[page:${msg.type()}] ${msg.text()}`);
    });
    const rendered = [];
    for (const character of CHARACTERS) {
      rendered.push(await renderCharacter(page, character, args.out));
    }
    // Combined review sheets: courier reference row above the rendered characters,
    // mid-grey background, 3x nearest-neighbour enlargement.
    const courierUrl = `${SERVER_URL}/courier`;
    const sheetA = await composeSheetA(page, rendered, courierUrl);
    await savePng(sheetA, path.join(args.out, "round3-sheet-a-idle.png"));
    const sheetB = await composeSheetB(page, rendered, courierUrl);
    await savePng(
      sheetB,
      path.join(args.out, "round3-sheet-b-se-walk-run.png"),
    );
    const sheetC = await composeSheetC(page, rendered, courierUrl);
    await savePng(sheetC, path.join(args.out, "round3-sheet-c-zoom.png"));
    console.log(`wrote review sheets a, b and c to ${args.out}`);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`done → ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
