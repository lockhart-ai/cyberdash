// Wall face geometry for placing features (doors, windows, signs) on building surfaces.
//
// Wall faces are named by the compass direction they FACE (toward the camera):
//   SW wall = visible on LEFT side of building (W-to-N edge of iso diamond)
//   SE wall = visible on RIGHT side of building (E-to-S edge of iso diamond, storefront)
//   NW/NE = back walls (hidden by depth sorting, rendered as images)

import { TILE_H, TILE_W } from "./IsoGeometry";

export enum WallFaceId {
  SW = "SW", // left-visible wall, W-to-N edge, slope -0.5 going right
  SE = "SE", // right-visible wall, E-to-S edge, slope -0.5 going right
}

export interface WallFaceGeometry {
  /** Screen position of the wall's ground-level start (bottom-left of face) */
  baseX: number;
  baseY: number;
  /** Direction along the wall base: +1 = rightward on screen */
  dx: number;
  /** Slope of the wall base (dy per dx pixel): -0.5 for both visible faces */
  slope: number;
  /** Total height of the wall in pixels */
  wallHeight: number;
}

/**
 * Get geometry for a wall face at a given tile screen position.
 *
 * @param face Which wall face
 * @param bx Screen X of the tile center (after inset)
 * @param by Screen Y of the tile center (after inset)
 * @param wallHeight Total wall height in pixels (stories * STORY_HEIGHT + heightOffset)
 */
export function getWallFaceGeometry(
  face: WallFaceId,
  bx: number,
  by: number,
  wallHeight: number,
): WallFaceGeometry {
  switch (face) {
    case WallFaceId.SE:
      // SE wall: E-to-S edge. Base starts at E vertex, goes right toward S vertex.
      // E vertex of diamond = (bx + TILE_W/2, by). Slope = +0.5 going right...
      // Actually: the SE wall on screen is the wall visible on the RIGHT side.
      // It runs from the S vertex (bx, by + TILE_H/2) leftward to E vertex (bx + TILE_W/2, by).
      // For feature placement, we go from S vertex rightward (toward E), slope -0.5.
      return {
        baseX: bx,
        baseY: by + TILE_H / 2,
        dx: 1,
        slope: -0.5,
        wallHeight,
      };

    case WallFaceId.SW:
      // SW wall: W-to-N edge. Base starts at S vertex, goes left (toward W vertex).
      // S vertex = (bx, by + TILE_H/2). Going left toward W = (bx - TILE_W/2, by).
      // Slope going left: from S to W, x decreases by TILE_W/2, y decreases by TILE_H/2.
      // dy/dx = (-TILE_H/2) / (-TILE_W/2) = +0.5... but going leftward.
      // For uniform feature placement, we express as going rightward from W vertex:
      // W vertex = (bx - TILE_W/2, by), slope -0.5 going right toward S.
      // Actually let's keep it simple: base at W vertex going right.
      return {
        baseX: bx - TILE_W / 2,
        baseY: by,
        dx: 1,
        slope: 0.5,
        wallHeight,
      };
  }
}

/**
 * Compute 4 screen-space points for a rectangular feature on a wall face.
 *
 * Wall-local coordinates:
 *   - alongOffset: pixels along the wall base from baseX/baseY
 *   - bottomOffset: pixels up from ground level
 *   - featureWidth: width along the wall
 *   - featureHeight: height (vertical on screen)
 *
 * Returns points in order: bottom-left, bottom-right, top-right, top-left
 * ready for Graphics.fillPoints().
 */
export function wallFeatureRect(
  face: WallFaceGeometry,
  alongOffset: number,
  bottomOffset: number,
  featureWidth: number,
  featureHeight: number,
): { x: number; y: number }[] {
  const x0 = face.baseX + alongOffset * face.dx;
  const y0 = face.baseY + alongOffset * face.slope - bottomOffset;

  const x1 = x0 + featureWidth * face.dx;
  const y1 = y0 + featureWidth * face.slope;

  return [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
    { x: x1, y: y1 - featureHeight },
    { x: x0, y: y0 - featureHeight },
  ];
}
