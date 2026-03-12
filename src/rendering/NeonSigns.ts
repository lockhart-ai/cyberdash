import type Phaser from "phaser";
import { BILLBOARD_SE_KEYS, BILLBOARD_SW_KEYS } from "./BillboardTrim";
import { buildingHash } from "./BuildingTypes";
import { addDebugText } from "./debugOverlay";

/** Composite building indices (CPC-N) that have geometry too complex for neon signs */
const NO_SIGN_BUILDINGS = new Set<number>([3]);

/** Max sign stories per building index. If not listed, uses numFloors as-is. */
const MAX_SIGN_STORIES = new Map<number, number>([
  [0, 1], // cpc-0: 2-story building
  [1, 2], // cpc-1: 3-story building
  [4, 1], // cpc-4: 2-story building
]);

const alphaCache = new Map<
  string,
  { data: Uint8ClampedArray; w: number; h: number }
>();

function getAlphaData(
  scene: Phaser.Scene,
  textureKey: string,
): { data: Uint8ClampedArray; w: number; h: number } | null {
  const cached = alphaCache.get(textureKey);
  if (cached) return cached;
  const tex = scene.textures.get(textureKey);
  if (!tex || tex.key === "__MISSING") return null;
  const src = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  if (!src || !src.width || !src.height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  const imgData = ctx.getImageData(0, 0, src.width, src.height);
  const entry = { data: imgData.data, w: src.width, h: src.height };
  alphaCache.set(textureKey, entry);
  return entry;
}

function isOccludedByBuilding(
  scene: Phaser.Scene,
  wx: number,
  wy: number,
  images: Phaser.GameObjects.Image[],
): boolean {
  for (const img of images) {
    const topLeftX = img.x - img.displayWidth * img.originX;
    const topLeftY = img.y - img.displayHeight * img.originY;
    const texX = Math.floor((wx - topLeftX) / img.scaleX);
    const texY = Math.floor((wy - topLeftY) / img.scaleY);
    const alpha = getAlphaData(scene, img.texture.key);
    if (!alpha) continue;
    if (texX < 0 || texX >= alpha.w || texY < 0 || texY >= alpha.h) continue;
    const idx = (texY * alpha.w + texX) * 4 + 3;
    if (alpha.data[idx] > 10) return true;
  }
  return false;
}

export interface NeonSignConfig {
  seed: number;
  id: string;
  edgeStart: { x: number; y: number };
  edgeEnd: { x: number; y: number };
  numFloors: number;
  floorHeight: number;
  depth: number;
  /** Composite building index — if in skip list, signs are suppressed */
  buildingIdx?: number;
  /** Building images for per-sign alpha occlusion check */
  buildingImages?: Phaser.GameObjects.Image[];
  /** Which wall face the signs are on. Defaults to 'se'. */
  wall?: "se" | "sw";
}

/**
 * Place neon signs along a wall edge.
 *
 * edgeStart/edgeEnd define the SE wall edge at ground level.
 * Signs are shifted up by floor * floorHeight for each row.
 */
export function placeNeonSigns(
  scene: Phaser.Scene,
  config: NeonSignConfig,
): Phaser.GameObjects.GameObject[] {
  const {
    seed,
    edgeStart,
    edgeEnd,
    numFloors,
    floorHeight,
    depth,
    buildingIdx,
    buildingImages,
  } = config;
  const objects: Phaser.GameObjects.GameObject[] = [];

  if (numFloors <= 0) return objects;
  if (buildingIdx !== undefined && NO_SIGN_BUILDINGS.has(buildingIdx))
    return objects;

  const isSW = config.wall === "sw";
  const protrudingKeys = isSW ? BILLBOARD_SE_KEYS : BILLBOARD_SW_KEYS;
  const flushKeys = isSW ? BILLBOARD_SW_KEYS : BILLBOARD_SE_KEYS;
  const protrudeDir = isSW ? -1 : 1;

  const edgeLen = edgeEnd.x - edgeStart.x;
  if (edgeLen < 100) return objects;

  const maxFloors =
    buildingIdx !== undefined && MAX_SIGN_STORIES.has(buildingIdx)
      ? Math.min(numFloors, MAX_SIGN_STORIES.get(buildingIdx)!)
      : numFloors;

  for (let floor = 1; floor <= maxFloors; floor++) {
    const floorY = floor * floorHeight;
    const sF = { x: edgeStart.x, y: edgeStart.y - floorY };
    const eF = { x: edgeEnd.x, y: edgeEnd.y - floorY };

    const floorEdgeW = eF.x - sF.x;

    // --- Protruding signs first (1 per narrow, 2 per wide) to detect pushed anchors ---
    const numProto = floorEdgeW > 300 ? 2 : 1;
    const protoSlotW = floorEdgeW / numProto;
    const numFlush = floorEdgeW > 300 ? 4 : 2;
    const flushPerProto = numFlush / numProto; // flush slots per proto region
    const skipFlushSlots = new Set<number>();

    for (let slot = 0; slot < numProto; slot++) {
      const slotEnd = (slot + 1) / numProto;

      const protoSizeR = buildingHash(seed, 150 + floor * 3 + slot);
      const pw = Math.floor(protoSlotW * (0.3 + protoSizeR * 0.2));
      const ph = Math.floor(floorHeight * (0.5 + protoSizeR * 0.25));
      if (pw < 20 || ph < 10) continue;

      // Scan left from geometric slot edge to find actual building pixels
      const nominalT = slotEnd;
      let px0 = sF.x + nominalT * (eF.x - sF.x);
      let py0 = sF.y + nominalT * (eF.y - sF.y);
      const scanY = py0 - ph / 2;
      let pushed = false;

      if (buildingImages && buildingImages.length > 0) {
        let found = false;
        for (let dx = 0; dx < protoSlotW; dx++) {
          const testX = px0 - dx;
          const testY = scanY + dx * 0.5;
          if (isOccludedByBuilding(scene, testX, testY, buildingImages)) {
            if (dx > 0) pushed = true;
            px0 = testX;
            const edgeFrac = (testX - sF.x) / (eF.x - sF.x);
            py0 = sF.y + edgeFrac * (eF.y - sF.y);
            found = true;
            break;
          }
        }
        if (!found) continue;
      }

      // If protruding sign was pushed left, skip the rightmost flush slot in this region
      if (pushed) {
        const rightmostFlush = (slot + 1) * flushPerProto - 1;
        skipFlushSlots.add(rightmostFlush);
      }

      const pcx = px0 + protrudeDir * pw / 2;
      const pcy = py0 + pw * 0.25 - ph / 2;

      if (protrudingKeys.length > 0) {
        const pbbIdx = Math.floor(
          buildingHash(seed, 250 + floor * 3 + slot) * protrudingKeys.length,
        );
        const pbbKey = protrudingKeys[pbbIdx];
        const ptex = scene.textures.get(pbbKey);
        if (ptex && ptex.key !== "__MISSING") {
          const ptexSrc = ptex.getSourceImage() as
            | HTMLImageElement
            | HTMLCanvasElement;
          if (ptexSrc?.width && ptexSrc.height) {
            const pbboxW = pw;
            const pbboxH = ph + pw * 0.5;
            const pscale = Math.min(
              pbboxW / ptexSrc.width,
              pbboxH / ptexSrc.height,
            );
            const pimg = scene.add.image(pcx, pcy, pbbKey);
            pimg.setOrigin(0.5, 0.5);
            pimg.setScale(pscale);
            pimg.setDepth(depth + 0.19);
            objects.push(pimg);
            const pLabel = scene.add.text(pcx, pcy, pbbKey, {
              fontSize: "14px",
              color: "#00ccff",
              backgroundColor: "#000c",
            });
            pLabel.setOrigin(0.5, 0.5).setDepth(depth + 0.2);
            addDebugText(pLabel);
          }
        }
      }
    }

    // --- Flush signs: 2 per narrow, 4 per wide (skip slots near pushed protruding signs) ---
    const flushSlotW = floorEdgeW / numFlush;

    for (let slot = 0; slot < numFlush; slot++) {
      if (skipFlushSlots.has(slot)) continue;

      const slotStart = slot / numFlush;
      const slotEnd = (slot + 1) / numFlush;
      const midT = (slotStart + slotEnd) / 2;

      const flushSizeR = buildingHash(seed, 100 + floor * 4 + slot);
      const fw = Math.floor(flushSlotW * (0.7 + flushSizeR * 0.2));
      const fh = Math.floor(floorHeight * (0.5 + flushSizeR * 0.25));
      if (fw < 20 || fh < 10) continue;

      const fx = sF.x + midT * (eF.x - sF.x) - fw / 2;
      const fy = sF.y + midT * (eF.y - sF.y) + (fw / 2) * 0.5;
      const fcx = fx + fw / 2;
      const fcy = fy - fw * 0.25 - fh / 2;

      const flushOccluded =
        !buildingImages ||
        buildingImages.length === 0 ||
        isOccludedByBuilding(scene, fcx, fcy, buildingImages);
      if (flushOccluded && flushKeys.length > 0) {
        const fbbIdx = Math.floor(
          buildingHash(seed, 200 + floor * 4 + slot) * flushKeys.length,
        );
        const fbbKey = flushKeys[fbbIdx];
        const ftex = scene.textures.get(fbbKey);
        if (ftex && ftex.key !== "__MISSING") {
          const ftexSrc = ftex.getSourceImage() as
            | HTMLImageElement
            | HTMLCanvasElement;
          if (ftexSrc?.width && ftexSrc.height) {
            const fbboxW = fw;
            const fbboxH = fh + fw * 0.5;
            const fscale = Math.min(
              fbboxW / ftexSrc.width,
              fbboxH / ftexSrc.height,
            );
            const fimg = scene.add.image(fcx, fcy, fbbKey);
            fimg.setOrigin(0.5, 0.5);
            fimg.setScale(fscale);
            fimg.setDepth(depth + 0.13);
            objects.push(fimg);
            const fLabel = scene.add.text(fcx, fcy, fbbKey, {
              fontSize: "14px",
              color: "#00ccff",
              backgroundColor: "#000c",
            });
            fLabel.setOrigin(0.5, 0.5).setDepth(depth + 0.14);
            addDebugText(fLabel);
          }
        }
      }
    }
  }

  return objects;
}
