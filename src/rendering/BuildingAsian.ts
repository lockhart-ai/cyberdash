import type Phaser from "phaser";
import { CYBERDARK_TINT } from "./BuildingTypes";
import {
  addDebugGraphics,
  addDebugText,
  isDebugVisible,
  isLabelsVisible,
} from "./debugOverlay";

/**
 * Traditional Asian Heritage stackable buildings.
 *
 * Assumptions:
 * - Each source asset is a 4-rotation strip (SE=0, NE=1, NW=2, SW=3).
 *   We only use frame 0 (SE), trimmed of transparent padding at load time.
 * - Each trimmed texture has a per-module originX (south point).
 * - Buildings stack vertically: floor(s) → roof.
 * - The bottom layer's south point is the anchor for placement.
 *   Upper layers stack centered (origin 0.5, 1) with overlap.
 * - Layers overlap by LAYER_OVERLAP fraction of layer height to hide seams.
 */

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

// --- Module pools (keys refer to source textures; trimmed as `{key}-trim`) ---

// Square-footprint floors only (fw ~873, ratio ~1.33-1.36)
const FLOORS = [
  "tac-65", // Building_A Floor_A
  "tac-57", // Building_B floor_A
  "tac-59", // Building_B floor_C
  "tac-61", // Building_B floor_D
  "tac-53", // Building_E floor_A
  "tac-54", // Building_E floor_B
  "tac-49", // Building_F floor_A
  "tac-31", // Building_O floor_A
  "tac-30", // Building_O floor_B
  "tac-29", // Building_O floor_C
  "tac-28", // Building_O floor_D
  "tac-21", // Building_P floor_A
  "tac-23", // Building_P floor_B
];

// Roofs compatible with square-footprint floors
const ROOFS = [
  "tac-62", // Building_A roof_A
  "tac-56", // Building_B roof_A
  "tac-58", // Building_B roof_C
  "tac-60", // Building_B roof_D
  "tac-52", // Building_E roof_A
  "tac-48", // Building_F roof_A
  "tac-26", // Building_O roof_A
  "tac-25", // Building_O roof_D
  "tac-20", // Building_P roof_A
  "tac-22", // Building_P roof_B
];

const ALL_MODULES = [...FLOORS, ...ROOFS];

export const LAYER_OVERLAP = 0.3;

/** Per-module origin X (south point fraction), keyed by source key */
const originXMap = new Map<string, number>();

function getOriginX(key: string): number {
  return originXMap.get(key) ?? 0.5;
}

/**
 * Trim all Asian module textures (frame 0 / SE only).
 * For each module:
 *   1. Crop to tight opaque bounds.
 *   2. Find south point (bottommost pixel avg x).
 *   3. Store originX and register trimmed canvas as `{key}-trim`.
 * Call once in BootScene.create() after loading.
 */
export function trimAsianModules(scene: Phaser.Scene): void {
  for (const srcKey of ALL_MODULES) {
    const frame = scene.textures.getFrame(srcKey, 0);
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

    // South point: average x of bottommost opaque row
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
    originXMap.set(srcKey, southXInCropped / tw);
    scene.textures.addCanvas(`${srcKey}-trim`, cropped);
  }
  console.log(`[AsianBuilding] Trimmed ${ALL_MODULES.length} modules`);
}

export interface AsianBuildingConfig {
  targetW: number;
  /** South point of the bottom layer goes here */
  x: number;
  y: number;
  depth: number;
  seed: number;
}

export interface AsianPlaced {
  images: Phaser.GameObjects.Image[];
  /** SE corner of the bottom layer's iso footprint (for chaining) */
  se: { x: number; y: number };
  /** SW corner of the bottom layer's iso footprint (for chaining) */
  sw: { x: number; y: number };
  /** Number of floor layers (excluding the roof) — eligible for signs */
  numFloors: number;
}

/**
 * Generate a deterministic layer list: [floor(s), roof]
 */
export function generateAsianLayers(seed: number): string[] {
  const rng = mulberry32(seed);

  // 3–5 floor sections (stories)
  const nFloors = 3 + Math.floor(rng() * 3);
  const floors: string[] = [];
  for (let i = 0; i < nFloors; i++) {
    floors.push(FLOORS[Math.floor(rng() * FLOORS.length)]);
  }

  const roof = ROOFS[Math.floor(rng() * ROOFS.length)];

  return [...floors, roof];
}

/**
 * Place a stacked Asian heritage building into the scene.
 * The bottom layer's south point is placed at (x, y).
 * Upper layers stack centered with overlap.
 * Returns SE/SW corners of bottom layer for chaining.
 */
export function placeAsianBuilding(
  scene: Phaser.Scene,
  config: AsianBuildingConfig,
): AsianPlaced {
  const { targetW, x, y, depth, seed } = config;
  const layers = generateAsianLayers(seed);
  const images: Phaser.GameObjects.Image[] = [];

  let curY = y;
  let se = { x: 0, y: 0 };
  let sw = { x: 0, y: 0 };
  let bboxLeft = Infinity,
    bboxRight = -Infinity,
    bboxTop = Infinity,
    bboxBottom = -Infinity;

  for (let li = 0; li < layers.length; li++) {
    const key = layers[li];
    const trimKey = `${key}-trim`;
    const frame = scene.textures.getFrame(trimKey);
    if (!frame) {
      console.warn(`Missing trimmed texture: ${trimKey}`);
      continue;
    }

    const scale = targetW / frame.width;
    const w = frame.width * scale;
    const h = frame.height * scale;

    if (li === 0) {
      // Bottom layer: anchor at south point using per-module originX
      const ox = getOriginX(key);
      const img = scene.add.image(x, curY, trimKey);
      img
        .setOrigin(ox, 1)
        .setScale(scale)
        .setDepth(depth)
        .setTint(CYBERDARK_TINT);
      images.push(img);

      // Compute bbox and chain corners from bottom layer
      const left = Math.round(x - w * ox);
      const right = Math.round(x + w * (1 - ox));
      se = { x: right, y: curY - 0.5 * (right - x) };
      sw = { x: left, y: curY - 0.5 * (x - left) };

      bboxLeft = left;
      bboxRight = right;
      bboxBottom = curY;
      bboxTop = curY - h;
    } else {
      // Upper layers: center on the bottom layer's anchor x
      const img = scene.add.image(x, curY, trimKey);
      img
        .setOrigin(0.5, 1)
        .setScale(scale)
        .setDepth(depth)
        .setTint(CYBERDARK_TINT);
      images.push(img);

      const layerLeft = x - w * 0.5;
      const layerRight = x + w * 0.5;
      if (layerLeft < bboxLeft) bboxLeft = layerLeft;
      if (layerRight > bboxRight) bboxRight = layerRight;
      if (curY - h < bboxTop) bboxTop = curY - h;
    }

    curY -= h * LAYER_OVERLAP;
  }

  if (isDebugVisible()) {
    const gfx = scene.add.graphics();
    gfx.setDepth(depth + 0.5);
    gfx.lineStyle(2, 0xffff00, 0.8);
    gfx.strokeRect(bboxLeft, bboxTop, bboxRight - bboxLeft, bboxBottom - bboxTop);
    gfx.fillStyle(0xffffff, 1);
    gfx.fillCircle(x, y, 4);
    gfx.fillStyle(0x00ff00, 1);
    gfx.fillCircle(se.x, se.y, 3);
    gfx.fillStyle(0xff0000, 1);
    gfx.fillCircle(sw.x, sw.y, 3);
    addDebugGraphics(gfx);
  }

  if (isLabelsVisible()) {
    const layerLabel = layers.map((k) => k.replace("tac-", "")).join(",");
    const midY = (bboxTop + bboxBottom) / 2;
    const label = scene.add
      .text(bboxRight + 4, midY, `TAC[${layerLabel}]`, {
        fontSize: "10px",
        color: "#4af",
        backgroundColor: "#000c",
        padding: { x: 3, y: 2 },
      })
      .setOrigin(0, 0.5)
      .setDepth(depth + 1);
    addDebugText(label);
  }

  return { images, se, sw, numFloors: layers.length - 1 };
}
