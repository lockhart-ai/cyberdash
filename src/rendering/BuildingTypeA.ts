import Phaser from "phaser";

/** Seeded PRNG (mulberry32) — deterministic from a single integer seed */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Module pools (all 3236px-wide compatible strips) ---

const BASES = [
  "cpb-base-10", "cpb-base-11", "cpb-base-12",
  "cpb-base-18", "cpb-base-19",
  "cpb-base-69", "cpb-base-70", "cpb-base-73",
  "cpb-base-115", "cpb-base-117",
];

const WALLS = [
  "cpb-wall-5",   "cpb-wall-6",   "cpb-wall-7",   "cpb-wall-8",   "cpb-wall-9",
  "cpb-wall-15",  "cpb-wall-16",  "cpb-wall-17",
  "cpb-wall-29",  "cpb-wall-30",  "cpb-wall-31",
  "cpb-wall-35",  "cpb-wall-36",  "cpb-wall-37",
  "cpb-wall-41",  "cpb-wall-42",  "cpb-wall-43",
  "cpb-wall-65",  "cpb-wall-66",  "cpb-wall-67",
  "cpb-wall-72",
  "cpb-wall-82",  "cpb-wall-83",  "cpb-wall-84",  "cpb-wall-85",  "cpb-wall-86",  "cpb-wall-87",
  "cpb-wall-93",  "cpb-wall-95",  "cpb-wall-96",  "cpb-wall-97",  "cpb-wall-98",  "cpb-wall-99",
  "cpb-wall-100", "cpb-wall-105", "cpb-wall-106", "cpb-wall-107", "cpb-wall-108",
  "cpb-wall-109", "cpb-wall-110", "cpb-wall-111", "cpb-wall-112", "cpb-wall-113", "cpb-wall-114",
];

const ROOFS = [
  "cpb-roof-2",  "cpb-roof-3",
  "cpb-roof-26", "cpb-roof-33", "cpb-roof-34",
  "cpb-roof-38", "cpb-roof-39",
  "cpb-roof-75", "cpb-roof-77",
  "cpb-roof-104", "cpb-roof-116",
];

export const LAYER_OVERLAP = 0.30;

export interface BuildingAConfig {
  targetW: number;
  anchorX: number;
  anchorY: number;
  depth: number;
  seed: number;
  showLabels?: boolean;
}

/**
 * Generate a deterministic layer list for a Type-A building from a seed.
 * Returns array of texture keys: [base, ...walls, roof]
 */
export function generateBuildingALayers(seed: number): string[] {
  const rng = mulberry32(seed);

  const base = BASES[Math.floor(rng() * BASES.length)];

  // 1–3 wall sections
  const nWalls = 1 + Math.floor(rng() * 3);
  const walls: string[] = [];
  for (let i = 0; i < nWalls; i++) {
    walls.push(WALLS[Math.floor(rng() * WALLS.length)]);
  }

  const roof = ROOFS[Math.floor(rng() * ROOFS.length)];

  return [base, ...walls, roof];
}

/**
 * Place a Type-A stacked building into the scene.
 * Uses the seed to deterministically pick base, wall sections, and roof.
 */
export function placeBuildingA(
  scene: Phaser.Scene,
  config: BuildingAConfig,
): Phaser.GameObjects.Image[] {
  const { targetW, anchorX, anchorY, depth, seed, showLabels } = config;
  const dpr = window.devicePixelRatio || 1;
  const layers = generateBuildingALayers(seed);
  const images: Phaser.GameObjects.Image[] = [];

  let curY = anchorY;

  for (const key of layers) {
    const frame = scene.textures.getFrame(key, 0);
    if (!frame) {
      console.warn(`Missing texture: ${key}`);
      continue;
    }

    const scale = targetW / frame.width;
    const layerH = frame.height * scale;

    const img = scene.add.image(anchorX, curY, key, 0);
    img.setOrigin(0.5, 1).setScale(scale).setDepth(depth);
    images.push(img);

    if (showLabels) {
      scene.add.text(anchorX + targetW / 2 + 8, curY - layerH / 2, key, {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#00ffcc",
        backgroundColor: "#000000aa",
        padding: { x: 3, y: 2, left: 3, right: 3, top: 2, bottom: 2 },
      }).setOrigin(0, 0.5).setResolution(dpr).setDepth(depth + 0.1);
    }

    curY -= layerH * LAYER_OVERLAP;
  }

  return images;
}
