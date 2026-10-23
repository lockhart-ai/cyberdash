#!/usr/bin/env node
// Assumptions:
// - Run from the project root (e.g. `npm run look -- ...`), so relative paths (look-output/, the dev server cwd)
//   resolve correctly.
// - Drives the dev server at http://localhost:3000 through the dev-only `window.__cyberdash` hook
//   (see src/debug/GameDebug.ts), which only exists under `vite`/`npm run dev`, never in a production build.
// - Headless Chromium has no real GPU, so WebGL needs software rendering: launched with
//   --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader (matches the working /tmp/pw/shot.mjs
//   prototype this harness replaces). Headless FPS numbers are therefore meaningless; this is noted in summary.json.
// - "col"/"row" in --col/--row and in step files are the isometric grid coordinates the in-game HUD shows as
//   "col X, row Y" (#hud-grid) — not pixel/screen coordinates.
// - `npm run look:setup` (playwright install chromium-headless-shell) must have been run once before this script
//   can launch a browser.

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const SERVER_URL = "http://localhost:3000";
const READY_TIMEOUT_MS = 30_000;
const SERVER_START_TIMEOUT_MS = 30_000;
const VIEWPORT = { width: 1440, height: 810 };

// Noisy, expected-under-software-rendering console lines, filtered out of summary.json so real problems stand out.
const NOISY_CONSOLE_PATTERNS = [
  /GPU stall due to ReadPixels/i,
  /willReadFrequently/i,
];

function usage() {
  return `Usage:
  npm run look -- --col <n> --row <n> [--face <dir>] [--out <dir>]
  npm run look -- --steps <file.json> [--video] [--out <dir>]

Directions: north south east west north-east north-west south-east south-west
Step ops: teleport {col,row} | face {dir} | hold {keys:[...], ms} | wait {ms} | pause | resume | screenshot {name} | state
`;
}

function parseArgs(argv) {
  const args = {
    col: null,
    row: null,
    face: null,
    steps: null,
    video: false,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--col") args.col = Number(argv[++i]);
    else if (a === "--row") args.row = Number(argv[++i]);
    else if (a === "--face") args.face = argv[++i];
    else if (a === "--steps") args.steps = argv[++i];
    else if (a === "--video") args.video = true;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}\n\n${usage()}`);
    }
  }
  return args;
}

function defaultOutDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join("look-output", stamp);
}

async function probeServer() {
  try {
    const res = await fetch(SERVER_URL, { method: "GET" });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(deadline) {
  while (Date.now() < deadline) {
    if (await probeServer()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** Start the Vite dev server on port 3000 if nothing is already serving it. */
async function ensureServer() {
  if (await probeServer()) {
    return { started: false, proc: null };
  }

  const proc = spawn("npx", ["vite", "--port", "3000", "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let startupOutput = "";
  proc.stdout.on("data", (d) => {
    startupOutput += d.toString();
  });
  proc.stderr.on("data", (d) => {
    startupOutput += d.toString();
  });

  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  const up = await waitForServer(deadline);
  if (!up) {
    proc.kill();
    throw new Error(
      `Dev server did not come up at ${SERVER_URL} within ${SERVER_START_TIMEOUT_MS}ms.\n` +
        `Output so far:\n${startupOutput}`,
    );
  }

  return { started: true, proc };
}

function stopServer(proc) {
  if (!proc) return;
  proc.kill();
}

function isNoisyConsoleText(text) {
  return NOISY_CONSOLE_PATTERNS.some((re) => re.test(text));
}

/** Translate a quick-mode (--col/--row/--face) invocation into a step list. */
function buildQuickSteps(args) {
  if (args.col === null || args.row === null) {
    throw new Error(`Quick mode needs both --col and --row.\n\n${usage()}`);
  }
  const steps = [{ op: "teleport", col: args.col, row: args.row }];
  if (args.face) steps.push({ op: "face", dir: args.face });
  steps.push({ op: "screenshot", name: "look" });
  return steps;
}

async function loadSteps(args) {
  if (args.steps) {
    const text = await readFile(args.steps, "utf8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error(`--steps file must contain a JSON array of step objects`);
    }
    return parsed;
  }
  return buildQuickSteps(args);
}

async function runStep(page, step, ctx) {
  const { op } = step;
  if (op === "teleport") {
    await page.evaluate(
      ({ col, row }) => window.__cyberdash.teleport(col, row),
      { col: step.col, row: step.row },
    );
  } else if (op === "face") {
    await page.evaluate((dir) => window.__cyberdash.face(dir), step.dir);
  } else if (op === "hold") {
    for (const key of step.keys) await page.keyboard.down(key);
    await page.waitForTimeout(step.ms);
    for (const key of [...step.keys].reverse()) await page.keyboard.up(key);
  } else if (op === "wait") {
    await page.waitForTimeout(step.ms);
  } else if (op === "pause") {
    await page.evaluate(() => window.__cyberdash.pause());
  } else if (op === "resume") {
    await page.evaluate(() => window.__cyberdash.resume());
  } else if (op === "screenshot") {
    const name = step.name || `screenshot-${ctx.screenshotCount++}`;
    const file = path.join(ctx.outDir, `${name}.png`);
    await page.screenshot({ path: file });
    const state = await page.evaluate(() => window.__cyberdash.getState());
    return { file, state };
  } else if (op === "state") {
    const state = await page.evaluate(() => window.__cyberdash.getState());
    return { state };
  } else {
    throw new Error(`Unknown step op: ${op}`);
  }
  return {};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.out || defaultOutDir();
  await mkdir(outDir, { recursive: true });

  const steps = await loadSteps(args);

  const { started, proc: serverProc } = await ensureServer();

  const consoleMessages = [];
  const consoleErrors = [];
  const pageErrors = [];
  const stepResults = [];
  let exitCode = 0;
  let browser;
  let videoPath = null;

  try {
    browser = await chromium.launch({
      channel: "chromium-headless-shell",
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });

    const contextOptions = { viewport: VIEWPORT };
    if (args.video) {
      contextOptions.recordVideo = { dir: outDir, size: VIEWPORT };
    }
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    page.on("console", (msg) => {
      const text = `${msg.type()}: ${msg.text()}`;
      if (isNoisyConsoleText(text)) return;
      consoleMessages.push(text);
      if (msg.type() === "error") consoleErrors.push(text);
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    await page.goto(SERVER_URL, { waitUntil: "load" });

    try {
      await page.waitForFunction(() => window.__cyberdash?.ready === true, {
        timeout: READY_TIMEOUT_MS,
      });
    } catch {
      throw new Error(
        `Timed out after ${READY_TIMEOUT_MS}ms waiting for window.__cyberdash.ready. ` +
          `Is the dev server serving a build with the GameDebug hook (import.meta.env.DEV)?`,
      );
    }

    const ctx = { outDir, screenshotCount: 0 };
    for (const step of steps) {
      const result = await runStep(page, step, ctx);
      stepResults.push({ step, ...result });
    }

    const video = args.video ? page.video() : null;
    await context.close();
    if (video) videoPath = await video.path();
  } finally {
    if (browser) await browser.close();
    if (started) stopServer(serverProc);
  }

  if (consoleErrors.length > 0 || pageErrors.length > 0) {
    exitCode = 1;
    if (consoleErrors.length > 0) {
      console.error("Console errors:");
      for (const e of consoleErrors) console.error(`  ${e}`);
    }
    if (pageErrors.length > 0) {
      console.error("Page errors:");
      for (const e of pageErrors) console.error(`  ${e}`);
    }
  }

  const summary = {
    url: SERVER_URL,
    serverStartedBySelf: started,
    video: videoPath ? path.resolve(videoPath) : null,
    note: "Headless FPS is meaningless: this runs under software WebGL (swiftshader), not a real GPU.",
    steps: stepResults,
    console: consoleMessages,
    consoleErrors,
    pageErrors,
    outDir,
  };
  await writeFile(
    path.join(outDir, "summary.json"),
    JSON.stringify(summary, null, 2),
  );

  console.log(`\nOutput written to: ${path.resolve(outDir)}`);
  for (const { step, file } of stepResults) {
    if (file)
      console.log(
        `  screenshot (${step.name || "unnamed"}): ${path.resolve(file)}`,
      );
  }
  if (videoPath) console.log(`  video: ${path.resolve(videoPath)}`);
  console.log(`  summary: ${path.resolve(path.join(outDir, "summary.json"))}`);

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
