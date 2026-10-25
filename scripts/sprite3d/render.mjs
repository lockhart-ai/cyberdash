#!/usr/bin/env node
// Sprite3D prototype driver (#15). Serves the page, GLBs and courier references over
// localhost, drives page.html in headless Chromium (software WebGL), and writes PNG
// strips + review sheets to the round output directory.
//
// Usage: node scripts/sprite3d/render.mjs [--out <dir>]
// Output default: sprite3d-output/round1 inside the repo (gitignored).
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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

const CHARACTERS = [
  {
    key: "robot",
    url: "/models/robot.glb",
    source: "/tmp/sprite3d/RobotExpressive.glb",
    clips: { idle: "Idle", walk: "Walking", run: "Running" },
  },
  {
    key: "xbot",
    url: "/models/xbot.glb",
    source: "/tmp/sprite3d/Xbot.glb",
    clips: { idle: "idle", walk: "walk", run: "run" },
  },
];

const FRAMES = { idle: 1, walk: 6, run: 8 }; // frames per direction per animation

function parseArgs(argv) {
  const args = { out: path.join(ROOT, "sprite3d-output", "round1") };
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
};

async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, SERVER_URL);
      let file = null;
      if (url.pathname.startsWith("/scripts/") || url.pathname.startsWith("/node_modules/")) {
        file = path.join(ROOT, url.pathname);
      } else if (url.pathname.startsWith("/courier/")) {
        const name = path.basename(url.pathname);
        if (!/\.(png|json)$/.test(name)) throw new Error(`bad courier path ${url.pathname}`);
        file = path.join(ROOT, "public", "assets", "player", name);
      } else if (url.pathname.startsWith("/models/")) {
        const name = path.basename(url.pathname);
        const character = CHARACTERS.find((c) => path.basename(c.url) === name);
        if (!character) throw new Error(`no model registered for ${name}`);
        file = character.source;
      }
      if (!file || !(await stat(file).then((s) => s.isFile()).catch(() => false))) {
        throw new Error(`not found: ${req.url}`);
      }
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
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
  await writeFile(file, Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"));
}

function pickClip(clips, wanted, characterKey, role) {
  const lower = clips.map((c) => c.toLowerCase());
  const idx = lower.indexOf(wanted.toLowerCase());
  if (idx >= 0) return clips[idx];
  // Fuzzy: clip name contains the wanted word.
  const loose = clips.filter((c) => c.toLowerCase().includes(wanted.toLowerCase()));
  if (loose.length === 1) return loose[0];
  throw new Error(
    `${characterKey}: no ${role} clip matching "${wanted}" (clips: ${clips.join(", ")})`,
  );
}

async function renderCharacter(page, character, outDir, courierUrl) {
  await page.goto(PAGE_URL);
  const info = await page.evaluate(async (url) => {
    const api = window.__sprite3d;
    api.init();
    return api.load(url);
  }, character.url);
  console.log(`[${character.key}] clips: ${info.clips.join(", ")}`);
  console.log(
    `[${character.key}] model height ${info.height.toFixed(2)} units, ${info.materialsReplaced} materials made toon`,
  );

  const chosen = {
    idle: pickClip(info.clips, character.clips.idle, character.key, "idle"),
    walk: pickClip(info.clips, character.clips.walk, character.key, "walk"),
    run: pickClip(info.clips, character.clips.run, character.key, "run"),
  };
  console.log(`[${character.key}] using clips: ${JSON.stringify(chosen)}`);

  // Calibrate the fixed framing on the idle pose (frontal) so the figure matches the
  // courier's framing: opaque silhouette 46px tall, feet on row 55, centred at px 32.
  const cal = await page.evaluate((clipName) => window.__sprite3d.calibrate(clipName), chosen.idle);
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
          await page.evaluate(({ clipName, time, yaw }) => {
            return window.__sprite3d.renderFrame(clipName, time, yaw).toDataURL();
          }, { clipName: clip, time: t, yaw: YAW[dir] }),
        );
      }
      frames[anim][dir] = urls;
    }
  }

  // Strips: one PNG per animation per direction.
  for (const [anim, count] of Object.entries(FRAMES)) {
    for (const dir of DIRS) {
      const cells = frames[anim][dir].map((src, i) => ({ src, dx: i * 64, dy: 0, w: 64, h: 64 }));
      const strip = await page.evaluate(
        ({ cells, w, h, scale }) => window.__sprite3d.compose(cells, w, h, scale),
        { cells, w: count * 64, h: 64, scale: 1 },
      );
      await savePng(strip, path.join(charDir, `${anim}-${dir}.png`));
    }
  }
  console.log(`[${character.key}] wrote 24 strips to ${charDir}`);

  // Review sheet (a): courier idle row above the rendered idle row, 2x nearest.
  const courierCells = [];
  const renderedCells = [];
  DIRS.forEach((dir, i) => {
    courierCells.push({ src: `${courierUrl}/${dir}.png`, dx: i * 64, dy: 0, w: 64, h: 64 });
    renderedCells.push({ src: frames.idle[dir][0], dx: i * 64, dy: 64, w: 64, h: 64 });
  });
  const sheetA = await page.evaluate(
    async ({ courierCells, renderedCells, w, h, scale }) =>
      window.__sprite3d.compose([...courierCells, ...renderedCells], w, h, scale),
    { courierCells, renderedCells, w: 512, h: 128, scale: 2 },
  );
  await savePng(sheetA, path.join(outDir, `${character.key}-sheet-a-idle.png`));

  // Review sheet (b): courier south-east walk/run above the rendered walk/run, 2x nearest.
  const seWalkCourier = { src: `${courierUrl}/walk-south-east.png`, dx: 0, dy: 0, w: 384, h: 64 };
  const cellsB = [
    seWalkCourier,
    {
      src: await page.evaluate(
        ({ cells, w, h, scale }) => window.__sprite3d.compose(cells, w, h, scale),
        {
          cells: frames.walk["south-east"].map((src, i) => ({ src, dx: i * 64, dy: 0, w: 64, h: 64 })),
          w: 384,
          h: 64,
          scale: 1,
        },
      ),
      dx: 0,
      dy: 64,
      w: 384,
      h: 64,
    },
    { src: `${courierUrl}/run-south-east.png`, dx: 0, dy: 128, w: 512, h: 64 },
    {
      src: await page.evaluate(
        ({ cells, w, h, scale }) => window.__sprite3d.compose(cells, w, h, scale),
        {
          cells: frames.run["south-east"].map((src, i) => ({ src, dx: i * 64, dy: 0, w: 64, h: 64 })),
          w: 512,
          h: 64,
          scale: 1,
        },
      ),
      dx: 0,
      dy: 192,
      w: 512,
      h: 64,
    },
  ];
  const sheetB = await page.evaluate(
    ({ cells, w, h, scale }) => window.__sprite3d.compose(cells, w, h, scale),
    { cells: cellsB, w: 512, h: 256, scale: 2 },
  );
  await savePng(sheetB, path.join(outDir, `${character.key}-sheet-b-se-walk-run.png`));
  console.log(`[${character.key}] wrote review sheets a and b to ${outDir}`);
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
    for (const character of CHARACTERS) {
      await renderCharacter(page, character, args.out, `${SERVER_URL}/courier`);
    }
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