// Pure isometric math — no Phaser dependencies

export const TILE_W = 64;
export const TILE_H = 32;

/** Convert isometric grid coordinates to screen position */
export function isoToScreen(
  col: number,
  row: number,
): { x: number; y: number } {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2),
  };
}

/** Convert screen position to isometric grid coordinates (use feetY for sprites) */
export function screenToIso(
  x: number,
  y: number,
): { col: number; row: number } {
  return {
    col: (x / (TILE_W / 2) + y / (TILE_H / 2)) / 2,
    row: (y / (TILE_H / 2) - x / (TILE_W / 2)) / 2,
  };
}
