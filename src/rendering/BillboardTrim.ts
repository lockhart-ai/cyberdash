import Phaser from "phaser";

/**
 * Billboard trim: extract frame 0 (SE-facing, flush) and frame 3 (SW-facing, protruding)
 * from each billboard spritesheet, trim to tight opaque bounds, and register as textures.
 *
 * Strip layout convention: SE=0, NE=1, NW=2, SW=3
 */

/** SE-facing trimmed billboard keys (frame 0, flush on SE wall) */
export const BILLBOARD_SE_KEYS: string[] = [];
/** SW-facing trimmed billboard keys (frame 3, protruding from SE wall) */
export const BILLBOARD_SW_KEYS: string[] = [];

/** Number of billboard spritesheets loaded in BootScene */
export const NUM_BILLBOARDS = 38;

/** Billboard indices to skip (wrong orientation, bad art, etc.) */
const SKIP_BILLBOARDS = new Set<number>([1, 8, 9, 11, 12, 16, 18, 21, 37]);

/** Billboards with inverted frame ordering: SW=frame 0, SE=frame 1 (instead of SE=0, SW=3) */
const INVERTED_BILLBOARDS = new Set<number>([10]);

function trimFrame(
  scene: Phaser.Scene,
  srcKey: string,
  frameIdx: number,
  outKey: string,
): boolean {
  const frame = scene.textures.getFrame(srcKey, frameIdx);
  if (!frame) return false;
  const src = frame.source.image as HTMLImageElement;

  const tmp = document.createElement("canvas");
  tmp.width = frame.cutWidth;
  tmp.height = frame.cutHeight;
  const ctx = tmp.getContext("2d")!;
  ctx.drawImage(
    src,
    frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
    0, 0, frame.cutWidth, frame.cutHeight,
  );

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

  if (tRight < tLeft || tBottom < tTop) return false;

  const tw = tRight - tLeft + 1;
  const th = tBottom - tTop + 1;
  const cropped = document.createElement("canvas");
  cropped.width = tw;
  cropped.height = th;
  const cCtx = cropped.getContext("2d")!;
  cCtx.drawImage(tmp, tLeft, tTop, tw, th, 0, 0, tw, th);

  scene.textures.addCanvas(outKey, cropped);
  return true;
}

/**
 * Trim billboard frames 0 (SE) and 3 (SW) for all loaded billboards.
 * Call in BootScene.create() after spritesheets are loaded.
 */
export function trimBillboards(scene: Phaser.Scene): void {
  let seCount = 0;
  let swCount = 0;

  for (let i = 0; i < NUM_BILLBOARDS; i++) {
    const srcKey = `bb-${i}`;
    if (SKIP_BILLBOARDS.has(i)) continue;
    if (!scene.textures.exists(srcKey)) continue;

    const inverted = INVERTED_BILLBOARDS.has(i);
    const seFrame = inverted ? 1 : 0;
    const swFrame = inverted ? 0 : 3;

    const seKey = `bb-${i}-se`;
    if (trimFrame(scene, srcKey, seFrame, seKey)) {
      BILLBOARD_SE_KEYS.push(seKey);
      seCount++;
    }

    const swKey = `bb-${i}-sw`;
    if (trimFrame(scene, srcKey, swFrame, swKey)) {
      BILLBOARD_SW_KEYS.push(swKey);
      swCount++;
    }
  }
  console.log(`[BillboardTrim] Trimmed billboards: ${seCount} SE, ${swCount} SW`);
}
