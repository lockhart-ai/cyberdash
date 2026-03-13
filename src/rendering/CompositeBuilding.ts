import type Phaser from "phaser";
import { CYBERDARK_TINT } from "./BuildingTypes";
import {
  addDebugGraphics,
  addDebugText,
  isDebugVisible,
  isLabelsVisible,
} from "./debugOverlay";

/** Seeded PRNG (mulberry32) */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NUM_BUILDINGS = 16;
const DIR_SUFFIXES = ["se", "ne", "nw", "sw"];

/** Frame indices: SE=0, NE=1, NW=2, SW=3 */
export enum CompositeDir {
  SE = 0,
  NE = 1,
  NW = 2,
  SW = 3,
}

/** Texture key for a trimmed building+direction */
function trimKey(idx: number, dir: CompositeDir): string {
  return `cpc-${idx}-${DIR_SUFFIXES[dir]}`;
}

/**
 * Per-building origin X (the south point's horizontal position as a 0–1 fraction).
 * Indexed as originXMap[`${idx}-${dir}`].
 * origin Y is always 1.0 (south point is always on the bottom row of the trimmed image).
 */
const originXMap = new Map<string, number>();

/** Get the stored origin X for a trimmed building+direction */
export function getOriginX(idx: number, dir: CompositeDir): number {
  return originXMap.get(`${idx}-${dir}`) ?? 0.5;
}

/**
 * The tallest trimmed frame height across all buildings+directions (source pixels).
 * Set during trimCompositeBuildings(). All buildings scale from this so they
 * share one scale factor and preserve relative sizes.
 */
let maxTrimmedHeight = 1;

/** Compute the uniform scale factor for a given targetH. */
export function compositeScale(targetH: number): number {
  return targetH / maxTrimmedHeight;
}

/**
 * Call once after composite building spritesheets are loaded (in BootScene.create).
 *
 * For each frame:
 *   1. Scan for tight opaque bounds, crop to those bounds.
 *   2. Find the bottommost pixel (south point of the iso diamond).
 *   3. Store its x-position as a custom originX so that placing with
 *      origin(originX, 1) anchors exactly at the south point.
 *   4. Register the cropped image as a new Phaser texture.
 */
export function trimCompositeBuildings(scene: Phaser.Scene): void {
  for (let b = 0; b < NUM_BUILDINGS; b++) {
    const srcKey = `cpc-comp-${b}`;
    for (let d = 0; d < 4; d++) {
      const frame = scene.textures.getFrame(srcKey, d);
      const src = frame.source.image as HTMLImageElement;

      // Draw the original frame to a temp canvas
      const tmp = document.createElement("canvas");
      tmp.width = frame.cutWidth;
      tmp.height = frame.cutHeight;
      const ctx = tmp.getContext("2d")!;
      ctx.drawImage(
        src,
        frame.cutX,
        frame.cutY,
        frame.cutWidth,
        frame.cutHeight,
        0,
        0,
        frame.cutWidth,
        frame.cutHeight,
      );

      // Scan for tight opaque bounds
      const imgData = ctx.getImageData(0, 0, tmp.width, tmp.height);
      const px = imgData.data;
      let tLeft = tmp.width,
        tRight = 0,
        tTop = tmp.height,
        tBottom = 0;

      for (let y = 0; y < tmp.height; y++) {
        for (let x = 0; x < tmp.width; x++) {
          if (px[(y * tmp.width + x) * 4 + 3] > 10) {
            if (x < tLeft) tLeft = x;
            if (x > tRight) tRight = x;
            if (y < tTop) tTop = y;
            if (y > tBottom) tBottom = y;
          }
        }
      }

      // Find the south point: the bottommost opaque pixel.
      // Scan the bottom row of content for the average x of opaque pixels
      // (the south point of an iso diamond is typically a narrow peak).
      let southSumX = 0;
      let southCount = 0;
      for (let x = 0; x < tmp.width; x++) {
        if (px[(tBottom * tmp.width + x) * 4 + 3] > 10) {
          southSumX += x;
          southCount++;
        }
      }
      const southX =
        southCount > 0 ? southSumX / southCount : (tLeft + tRight) / 2;

      // Crop to tight bounds
      const tw = tRight - tLeft + 1;
      const th = tBottom - tTop + 1;
      const cropped = document.createElement("canvas");
      cropped.width = tw;
      cropped.height = th;
      const cCtx = cropped.getContext("2d")!;
      cCtx.drawImage(tmp, tLeft, tTop, tw, th, 0, 0, tw, th);

      // South point x within the cropped frame (shifted by tLeft)
      const southXInCropped = southX - tLeft;
      const originX = southXInCropped / tw;

      const key = trimKey(b, d as CompositeDir);
      originXMap.set(`${b}-${d}`, originX);
      scene.textures.addCanvas(key, cropped);

      if (th > maxTrimmedHeight) maxTrimmedHeight = th;
    }
  }
  console.log(
    `[CompositeBuilding] Trimmed ${NUM_BUILDINGS * 4} frames, maxH=${maxTrimmedHeight}`,
  );
}

/**
 * Pick a building index (0–15) deterministically from seed.
 * If exclude is provided, guarantees a different pick.
 */
export function pickComposite(seed: number, exclude?: number): number {
  const rng = mulberry32(seed);
  if (exclude === undefined) {
    return Math.floor(rng() * NUM_BUILDINGS);
  }
  const others: number[] = [];
  for (let i = 0; i < NUM_BUILDINGS; i++) {
    if (i !== exclude) others.push(i);
  }
  return others[Math.floor(rng() * others.length)];
}

/**
 * Pick the largest building that fits within maxAdvance screen-x pixels.
 * chainDir controls which direction we measure advance:
 *   "se" = south point to SE corner = w * (1 - originX)
 *   "nw" = south point to SW corner = w * originX
 * candidates restricts the search to specific building indices.
 * Returns undefined if nothing fits.
 */
export function pickCompositeFitting(
  scene: Phaser.Scene,
  targetH: number,
  maxAdvance: number,
  exclude?: number,
  dir: CompositeDir = CompositeDir.SE,
  chainDir: "se" | "nw" = "se",
  candidates?: number[],
): number | undefined {
  let best: number | undefined;
  let bestAdvance = 0;

  const pool = candidates ?? Array.from({ length: NUM_BUILDINGS }, (_, i) => i);
  for (const i of pool) {
    if (i === exclude) continue;
    const adv = getCompositeAdvance(scene, i, targetH, dir, chainDir);
    if (adv <= maxAdvance && adv > bestAdvance) {
      best = i;
      bestAdvance = adv;
    }
  }
  return best;
}

export interface CompositeBuildingConfig {
  /** Target rendered height in pixels */
  targetH: number;
  /** Screen position — the south point of the building goes here */
  x: number;
  y: number;
  /** Depth sorting value */
  depth: number;
  /** Deterministic seed */
  seed: number;
  /** Direction (default SE) */
  direction?: CompositeDir;
  /** Show debug label */
  showLabel?: boolean;
  /** Building index to exclude (prevent adjacent duplicates) */
  exclude?: number;
  /** Force a specific building index (skip random pick) */
  buildingIdx?: number;
}

export interface PlacedBuilding {
  img: Phaser.GameObjects.Image;
  /** Tight bounding box in screen space */
  bbox: { left: number; right: number; top: number; bottom: number };
  /** SE corner of iso footprint — next building's south point goes here (chaining SE) */
  se: { x: number; y: number };
  /** SW corner of iso footprint — next building's south point goes here (chaining NW) */
  sw: { x: number; y: number };
  /** Which building index was placed */
  buildingIdx: number;
}

/** Bright debug colors to cycle through */
const DEBUG_COLORS = [
  0xff0000, 0x00ff00, 0x0000ff, 0xff00ff, 0xffff00, 0x00ffff, 0xff8800,
  0x88ff00,
];
let debugColorIdx = 0;

/**
 * Get a building's "advance" — the screen-x distance from south point to the
 * chaining corner. For SE chaining (going right) = w * (1 - originX).
 * For NW chaining (going left) = w * originX.
 */
export function getCompositeAdvance(
  scene: Phaser.Scene,
  buildingIdx: number,
  targetH: number,
  dir: CompositeDir = CompositeDir.SE,
  chainDir: "se" | "nw" = "se",
): number {
  const key = trimKey(buildingIdx, dir);
  const frame = scene.textures.getFrame(key);
  const scale = compositeScale(targetH);
  const w = frame.width * scale;
  const ox = getOriginX(buildingIdx, dir);
  return chainDir === "se" ? w * (1 - ox) : w * ox;
}

/**
 * Get the rendered width of a trimmed building at a given targetH.
 * Uses the uniform scale factor (all buildings share the same scale).
 */
export function getCompositeWidth(
  scene: Phaser.Scene,
  buildingIdx: number,
  targetH: number,
  dir: CompositeDir = CompositeDir.SE,
): number {
  const key = trimKey(buildingIdx, dir);
  const frame = scene.textures.getFrame(key);
  const scale = compositeScale(targetH);
  return frame.width * scale;
}

/**
 * Place a composite building into the scene.
 *
 * Assumptions:
 * - Textures are pre-trimmed (no transparent padding).
 * - Each texture has a per-building originX stored during trimming,
 *   corresponding to the south point (bottommost pixel) of the iso diamond.
 * - origin(originX, 1) places (x, y) exactly at the south point.
 * - The bbox is the rendered rectangle, computed from the origin.
 *
 * (x, y) = where the south point of the building should land on screen.
 */
export function placeCompositeBuilding(
  scene: Phaser.Scene,
  config: CompositeBuildingConfig,
): PlacedBuilding {
  const { targetH, x, y, depth, seed, exclude } = config;
  const dir = config.direction ?? CompositeDir.SE;

  const buildingIdx = config.buildingIdx ?? pickComposite(seed, exclude);
  const key = trimKey(buildingIdx, dir);
  const originX = getOriginX(buildingIdx, dir);
  const frame = scene.textures.getFrame(key);
  const scale = compositeScale(targetH);
  const w = frame.width * scale;
  const h = frame.height * scale;

  const img = scene.add.image(x, y, key);
  img
    .setOrigin(originX, 1)
    .setScale(scale)
    .setDepth(depth)
    .setTint(CYBERDARK_TINT);

  // Bbox from origin: south point is at (x, y),
  // which is originX fraction from the left and at the bottom.
  const bbox = {
    left: Math.round(x - w * originX),
    right: Math.round(x + w * (1 - originX)),
    top: Math.round(y - h),
    bottom: Math.round(y),
  };

  // SE corner screen position (for chaining SE/right)
  const seX = bbox.right;
  const seY = y - 0.5 * (bbox.right - x);

  // SW corner screen position (for chaining NW/left)
  const swX = bbox.left;
  const swY = y - 0.5 * (x - bbox.left);

  // Debug: bounding box + chain dots (only created when debug is on)
  if (isDebugVisible()) {
    const gfx = scene.add.graphics();
    gfx.setDepth(depth + 1);
    const color = DEBUG_COLORS[debugColorIdx++ % DEBUG_COLORS.length];
    gfx.lineStyle(2, color, 0.8);
    gfx.strokeRect(
      bbox.left,
      bbox.top,
      bbox.right - bbox.left,
      bbox.bottom - bbox.top,
    );
    gfx.fillStyle(0xffffff, 1);
    gfx.fillCircle(x, y, 4);
    gfx.fillStyle(0xff0000, 1);
    gfx.fillCircle(seX, seY, 4);
    gfx.fillStyle(0x0088ff, 1);
    gfx.fillCircle(swX, swY, 4);
    addDebugGraphics(gfx);
  }

  if (isLabelsVisible()) {
    const midY = (bbox.top + bbox.bottom) / 2;
    const label = scene.add
      .text(bbox.right + 4, midY, `CPC-${buildingIdx}`, {
        fontSize: "12px",
        color: "#4af",
        backgroundColor: "#000c",
        padding: { x: 3, y: 2 },
      })
      .setOrigin(0, 0.5)
      .setDepth(depth + 1);
    addDebugText(label);
  }

  return {
    img,
    bbox,
    se: { x: seX, y: seY },
    sw: { x: swX, y: swY },
    buildingIdx,
  };
}

// ─── Skyscrapers ──────────────────────────────────────────────────────

const NUM_SKYSCRAPERS = 3;
const skyOriginXMap = new Map<string, number>();
let maxSkyTrimmedHeight = 1;

function skyTrimKey(idx: number, dir: CompositeDir): string {
  return `sky-${idx}-${DIR_SUFFIXES[dir]}`;
}

export function getSkyOriginX(idx: number, dir: CompositeDir): number {
  return skyOriginXMap.get(`${idx}-${dir}`) ?? 0.5;
}

export function skyScale(targetH: number): number {
  return targetH / maxSkyTrimmedHeight;
}

/**
 * Trim skyscraper spritesheets the same way as composite buildings.
 * Call once in BootScene.create() after loading.
 */
export function trimSkyscrapers(scene: Phaser.Scene): void {
  for (let b = 0; b < NUM_SKYSCRAPERS; b++) {
    const srcKey = `sky-${b}`;
    for (let d = 0; d < 4; d++) {
      const frame = scene.textures.getFrame(srcKey, d);
      const src = frame.source.image as HTMLImageElement;

      const tmp = document.createElement("canvas");
      tmp.width = frame.cutWidth;
      tmp.height = frame.cutHeight;
      const ctx = tmp.getContext("2d")!;
      ctx.drawImage(
        src,
        frame.cutX,
        frame.cutY,
        frame.cutWidth,
        frame.cutHeight,
        0,
        0,
        frame.cutWidth,
        frame.cutHeight,
      );

      const imgData = ctx.getImageData(0, 0, tmp.width, tmp.height);
      const px = imgData.data;
      let tLeft = tmp.width,
        tRight = 0,
        tTop = tmp.height,
        tBottom = 0;

      for (let y = 0; y < tmp.height; y++) {
        for (let x = 0; x < tmp.width; x++) {
          if (px[(y * tmp.width + x) * 4 + 3] > 10) {
            if (x < tLeft) tLeft = x;
            if (x > tRight) tRight = x;
            if (y < tTop) tTop = y;
            if (y > tBottom) tBottom = y;
          }
        }
      }

      let southSumX = 0;
      let southCount = 0;
      for (let x = 0; x < tmp.width; x++) {
        if (px[(tBottom * tmp.width + x) * 4 + 3] > 10) {
          southSumX += x;
          southCount++;
        }
      }
      const southX =
        southCount > 0 ? southSumX / southCount : (tLeft + tRight) / 2;

      const tw = tRight - tLeft + 1;
      const th = tBottom - tTop + 1;
      const cropped = document.createElement("canvas");
      cropped.width = tw;
      cropped.height = th;
      const cCtx = cropped.getContext("2d")!;
      cCtx.drawImage(tmp, tLeft, tTop, tw, th, 0, 0, tw, th);

      const southXInCropped = southX - tLeft;
      const originX = southXInCropped / tw;

      const key = skyTrimKey(b, d as CompositeDir);
      skyOriginXMap.set(`${b}-${d}`, originX);
      scene.textures.addCanvas(key, cropped);

      if (th > maxSkyTrimmedHeight) maxSkyTrimmedHeight = th;
    }
  }
  console.log(
    `[Skyscraper] Trimmed ${NUM_SKYSCRAPERS * 4} frames, maxH=${maxSkyTrimmedHeight}`,
  );
}

export interface SkyPlaced {
  img: Phaser.GameObjects.Image;
  bbox: { left: number; right: number; top: number; bottom: number };
  se: { x: number; y: number };
  sw: { x: number; y: number };
  buildingIdx: number;
}

/**
 * Place a skyscraper into the scene.
 * Same origin/placement logic as composite buildings.
 */
export function placeSkyscraper(
  scene: Phaser.Scene,
  config: {
    targetH: number;
    x: number;
    y: number;
    depth: number;
    buildingIdx: number;
    direction?: CompositeDir;
  },
): SkyPlaced {
  const dir = config.direction ?? CompositeDir.SE;
  const { targetH, x, y, depth, buildingIdx } = config;

  const key = skyTrimKey(buildingIdx, dir);
  const originX = getSkyOriginX(buildingIdx, dir);
  const frame = scene.textures.getFrame(key);
  const scale = skyScale(targetH);
  const w = frame.width * scale;
  const h = frame.height * scale;

  const img = scene.add.image(x, y, key);
  img
    .setOrigin(originX, 1)
    .setScale(scale)
    .setDepth(depth)
    .setTint(CYBERDARK_TINT);

  const bbox = {
    left: Math.round(x - w * originX),
    right: Math.round(x + w * (1 - originX)),
    top: Math.round(y - h),
    bottom: Math.round(y),
  };

  const seX = bbox.right;
  const seY = y - 0.5 * (bbox.right - x);
  const swX = bbox.left;
  const swY = y - 0.5 * (x - bbox.left);

  if (isDebugVisible()) {
    const skyGfx = scene.add.graphics();
    skyGfx.setDepth(depth + 1);
    const skyColor = DEBUG_COLORS[debugColorIdx++ % DEBUG_COLORS.length];
    skyGfx.lineStyle(2, skyColor, 0.8);
    skyGfx.strokeRect(
      bbox.left,
      bbox.top,
      bbox.right - bbox.left,
      bbox.bottom - bbox.top,
    );
    skyGfx.fillStyle(0xffffff, 1);
    skyGfx.fillCircle(x, y, 4);
    skyGfx.fillStyle(0xff0000, 1);
    skyGfx.fillCircle(seX, seY, 4);
    skyGfx.fillStyle(0x0088ff, 1);
    skyGfx.fillCircle(swX, swY, 4);
    addDebugGraphics(skyGfx);
  }

  return {
    img,
    bbox,
    se: { x: seX, y: seY },
    sw: { x: swX, y: swY },
    buildingIdx,
  };
}
