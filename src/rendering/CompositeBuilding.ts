import Phaser from "phaser";

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
export const enum CompositeDir {
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
        frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
        0, 0, frame.cutWidth, frame.cutHeight,
      );

      // Scan for tight opaque bounds
      const imgData = ctx.getImageData(0, 0, tmp.width, tmp.height);
      const px = imgData.data;
      let tLeft = tmp.width, tRight = 0, tTop = tmp.height, tBottom = 0;

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
      const southX = southCount > 0 ? southSumX / southCount : (tLeft + tRight) / 2;

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
  console.log(`[CompositeBuilding] Trimmed ${NUM_BUILDINGS * 4} frames, maxH=${maxTrimmedHeight}`);
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
 * "Advance" = distance from south point to SE corner = w * (1 - originX).
 * Returns undefined if nothing fits.
 */
export function pickCompositeFitting(
  scene: Phaser.Scene,
  targetH: number,
  maxAdvance: number,
  exclude?: number,
  dir: CompositeDir = CompositeDir.SE,
): number | undefined {
  let best: number | undefined;
  let bestAdvance = 0;

  for (let i = 0; i < NUM_BUILDINGS; i++) {
    if (i === exclude) continue;
    const key = trimKey(i, dir);
    const frame = scene.textures.getFrame(key);
    const scale = compositeScale(targetH);
    const w = frame.width * scale;
    const ox = getOriginX(i, dir);
    const advance = w * (1 - ox);
    if (advance <= maxAdvance && advance > bestAdvance) {
      best = i;
      bestAdvance = advance;
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
  /** SE corner of iso footprint — next building's south point goes here */
  se: { x: number; y: number };
  /** Which building index was placed */
  buildingIdx: number;
}

/** Bright debug colors to cycle through */
const DEBUG_COLORS = [
  0xff0000, 0x00ff00, 0x0000ff, 0xff00ff,
  0xffff00, 0x00ffff, 0xff8800, 0x88ff00,
];
let debugColorIdx = 0;

/**
 * Get a building's "advance" — the screen-x distance from south point to SE corner.
 * This is how much horizontal space the building occupies when chaining.
 */
export function getCompositeAdvance(
  scene: Phaser.Scene,
  buildingIdx: number,
  targetH: number,
  dir: CompositeDir = CompositeDir.SE,
): number {
  const key = trimKey(buildingIdx, dir);
  const frame = scene.textures.getFrame(key);
  const scale = compositeScale(targetH);
  const w = frame.width * scale;
  const ox = getOriginX(buildingIdx, dir);
  return w * (1 - ox);
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
  const { targetH, x, y, depth, seed, showLabel, exclude } = config;
  const dir = config.direction ?? CompositeDir.SE;

  const buildingIdx = config.buildingIdx ?? pickComposite(seed, exclude);
  const key = trimKey(buildingIdx, dir);
  const originX = getOriginX(buildingIdx, dir);
  const frame = scene.textures.getFrame(key);
  const scale = compositeScale(targetH);
  const w = frame.width * scale;
  const h = frame.height * scale;

  const img = scene.add.image(x, y, key);
  img.setOrigin(originX, 1).setScale(scale).setDepth(depth);

  // Bbox from origin: south point is at (x, y),
  // which is originX fraction from the left and at the bottom.
  const bbox = {
    left: Math.round(x - w * originX),
    right: Math.round(x + w * (1 - originX)),
    top: Math.round(y - h),
    bottom: Math.round(y),
  };

  // SE corner screen position (for chaining)
  const seX = bbox.right;
  const seY = y - 0.5 * (bbox.right - x);

  return { img, bbox, se: { x: seX, y: seY }, buildingIdx };
}
