import Phaser from "phaser";
import {
  COL_PERIOD,
  CURB_HEIGHT,
  ROW_PERIOD,
  STREET_WIDTH,
  TileType,
} from "../iso/CityLayout";
import { isoToScreen, TILE_H, TILE_W } from "../iso/IsoGeometry";
import { TILE_COLORS } from "./BuildingTypes";

/**
 * Render a street tile and its markings (center lines, stop lines, crosswalks).
 */
export function renderStreetTile(
  _scene: Phaser.Scene,
  col: number,
  row: number,
  streetLines: Phaser.GameObjects.Graphics,
): void {
  const { x, y } = isoToScreen(col, row);

  const colMod = col % COL_PERIOD;
  const rowMod = row % ROW_PERIOD;
  const inStreetCol = colMod < STREET_WIDTH;
  const inStreetRow = rowMod < STREET_WIDTH;
  const isIntersection = inStreetCol && inStreetRow;

  if (isIntersection) return;

  const tw = TILE_W;
  const th = TILE_H;

  const centerCol = Math.floor(STREET_WIDTH / 2); // 4
  const cwNear = STREET_WIDTH; // 8 — first crosswalk tile
  const cwNearEnd = STREET_WIDTH + 1; // 9
  const cwFarRow = ROW_PERIOD - 2; // 54
  const cwFarRowEnd = ROW_PERIOD - 1; // 55
  const cwFarCol = COL_PERIOD - 2; // 34
  const cwFarColEnd = COL_PERIOD - 1; // 35
  const stopNear = STREET_WIDTH + 2; // 10
  const stopFarRow = ROW_PERIOD - 3; // 53
  const stopFarCol = COL_PERIOD - 3; // 33

  // Double yellow center lines
  const isCenter = inStreetCol ? colMod === centerCol : rowMod === centerCol;
  const nearCrosswalk = inStreetCol
    ? (rowMod >= cwNear - 1 && rowMod <= stopNear) ||
      (rowMod >= stopFarRow && rowMod <= cwFarRowEnd)
    : (colMod >= cwNear - 1 && colMod <= stopNear) ||
      (colMod >= stopFarCol && colMod <= cwFarColEnd);

  if (isCenter && !nearCrosswalk) {
    const ext = 16;
    const hext = 8;
    const gap = 2;
    const hw = 1;
    streetLines.fillStyle(0x8b8520, 0.5);
    if (inStreetCol) {
      for (const s of [-1, 1]) {
        const ox = gap * s;
        const oy = (gap * s) / 2;
        streetLines.fillPoints(
          [
            new Phaser.Geom.Point(x + ext + ox, y - hext + oy - hw),
            new Phaser.Geom.Point(x + ext + ox, y - hext + oy + hw),
            new Phaser.Geom.Point(x - ext + ox, y + hext + oy + hw),
            new Phaser.Geom.Point(x - ext + ox, y + hext + oy - hw),
          ],
          true,
        );
      }
    } else {
      for (const s of [-1, 1]) {
        const ox = -gap * s;
        const oy = (gap * s) / 2;
        streetLines.fillPoints(
          [
            new Phaser.Geom.Point(x - ext + ox, y - hext + oy - hw),
            new Phaser.Geom.Point(x - ext + ox, y - hext + oy + hw),
            new Phaser.Geom.Point(x + ext + ox, y + hext + oy + hw),
            new Phaser.Geom.Point(x + ext + ox, y + hext + oy - hw),
          ],
          true,
        );
      }
    }
  }

  // White stop lines
  const hw2 = 4;
  if (inStreetCol && rowMod === stopNear && colMod >= centerCol + 1) {
    streetLines.fillStyle(0xffffff, 0.4);
    streetLines.fillPoints(
      [
        new Phaser.Geom.Point(x - tw / 4 - hw2, y - th / 4 + hw2 * 0.5),
        new Phaser.Geom.Point(x - tw / 4 + hw2, y - th / 4 - hw2 * 0.5),
        new Phaser.Geom.Point(x + tw / 4 + hw2, y + th / 4 - hw2 * 0.5),
        new Phaser.Geom.Point(x + tw / 4 - hw2, y + th / 4 + hw2 * 0.5),
      ],
      true,
    );
  }
  if (inStreetCol && rowMod === stopFarRow && colMod <= centerCol - 1) {
    streetLines.fillStyle(0xffffff, 0.4);
    streetLines.fillPoints(
      [
        new Phaser.Geom.Point(x - tw / 4 - hw2, y - th / 4 + hw2 * 0.5),
        new Phaser.Geom.Point(x - tw / 4 + hw2, y - th / 4 - hw2 * 0.5),
        new Phaser.Geom.Point(x + tw / 4 + hw2, y + th / 4 - hw2 * 0.5),
        new Phaser.Geom.Point(x + tw / 4 - hw2, y + th / 4 + hw2 * 0.5),
      ],
      true,
    );
  }
  if (inStreetRow && colMod === stopNear && rowMod <= centerCol - 1) {
    streetLines.fillStyle(0xffffff, 0.4);
    streetLines.fillPoints(
      [
        new Phaser.Geom.Point(x + tw / 4 - hw2, y - th / 4 - hw2 * 0.5),
        new Phaser.Geom.Point(x + tw / 4 + hw2, y - th / 4 + hw2 * 0.5),
        new Phaser.Geom.Point(x - tw / 4 + hw2, y + th / 4 + hw2 * 0.5),
        new Phaser.Geom.Point(x - tw / 4 - hw2, y + th / 4 - hw2 * 0.5),
      ],
      true,
    );
  }
  if (inStreetRow && colMod === stopFarCol && rowMod >= centerCol + 1) {
    streetLines.fillStyle(0xffffff, 0.4);
    streetLines.fillPoints(
      [
        new Phaser.Geom.Point(x + tw / 4 - hw2, y - th / 4 - hw2 * 0.5),
        new Phaser.Geom.Point(x + tw / 4 + hw2, y - th / 4 + hw2 * 0.5),
        new Phaser.Geom.Point(x - tw / 4 + hw2, y + th / 4 + hw2 * 0.5),
        new Phaser.Geom.Point(x - tw / 4 - hw2, y + th / 4 - hw2 * 0.5),
      ],
      true,
    );
  }

  // Crosswalks
  const hw = 3;
  if (
    inStreetCol &&
    (rowMod === cwNear ||
      rowMod === cwNearEnd ||
      rowMod === cwFarRow ||
      rowMod === cwFarRowEnd)
  ) {
    streetLines.fillStyle(0xffffff, 0.35);
    streetLines.fillPoints(
      [
        new Phaser.Geom.Point(x + tw / 4 - hw, y - th / 4 - hw * 0.5),
        new Phaser.Geom.Point(x + tw / 4 + hw, y - th / 4 + hw * 0.5),
        new Phaser.Geom.Point(x - tw / 4 + hw, y + th / 4 + hw * 0.5),
        new Phaser.Geom.Point(x - tw / 4 - hw, y + th / 4 - hw * 0.5),
      ],
      true,
    );
  }
  if (
    inStreetRow &&
    (colMod === cwNear ||
      colMod === cwNearEnd ||
      colMod === cwFarCol ||
      colMod === cwFarColEnd)
  ) {
    streetLines.fillStyle(0xffffff, 0.35);
    streetLines.fillPoints(
      [
        new Phaser.Geom.Point(x - tw / 4 + hw, y - th / 4 - hw * 0.5),
        new Phaser.Geom.Point(x - tw / 4 - hw, y - th / 4 + hw * 0.5),
        new Phaser.Geom.Point(x + tw / 4 - hw, y + th / 4 + hw * 0.5),
        new Phaser.Geom.Point(x + tw / 4 + hw, y + th / 4 - hw * 0.5),
      ],
      true,
    );
  }
}

/**
 * Render a sidewalk tile with curb walls and grid lines.
 */
export function renderSidewalkTile(
  _scene: Phaser.Scene,
  col: number,
  row: number,
  sidewalkGfx: Phaser.GameObjects.Graphics,
  sidewalkLines: Phaser.GameObjects.Graphics,
): void {
  const tw = TILE_W;
  const th = TILE_H;
  const { x: sx, y: sy } = isoToScreen(col, row);

  // Curb walls (top face image handled by blitter in drawCityMap)
  const colors = TILE_COLORS[TileType.SIDEWALK];
  sidewalkGfx.fillStyle(colors.left, 1);
  sidewalkGfx.fillPoints(
    [
      new Phaser.Geom.Point(sx - tw / 2, sy - CURB_HEIGHT),
      new Phaser.Geom.Point(sx, sy + th / 2 - CURB_HEIGHT),
      new Phaser.Geom.Point(sx, sy + th / 2),
      new Phaser.Geom.Point(sx - tw / 2, sy),
    ],
    true,
  );
  sidewalkGfx.fillStyle(colors.right, 1);
  sidewalkGfx.fillPoints(
    [
      new Phaser.Geom.Point(sx + tw / 2, sy - CURB_HEIGHT),
      new Phaser.Geom.Point(sx, sy + th / 2 - CURB_HEIGHT),
      new Phaser.Geom.Point(sx, sy + th / 2),
      new Phaser.Geom.Point(sx + tw / 2, sy),
    ],
    true,
  );

  // Grid lines
  sidewalkLines.lineStyle(1, 0x2e2e3e, 0.5);
  if (col % 2 === 0) {
    sidewalkLines.lineBetween(
      sx,
      sy - th / 2 - CURB_HEIGHT,
      sx - tw / 2,
      sy - CURB_HEIGHT,
    );
  }
  if (row % 2 === 0) {
    sidewalkLines.lineBetween(
      sx,
      sy - th / 2 - CURB_HEIGHT,
      sx + tw / 2,
      sy - CURB_HEIGHT,
    );
  }
}
