// Building data types and color palette

// Cyberdark night tint — applied to all asset-pack sprites at render time.
// Derived from postprocess.py "cyberdark" preset: brightness 0.45, blue_shift 0.08
//   R × 0.414 → 106,  G × 0.432 → 110,  B × 0.468 → 119
export const CYBERDARK_TINT = 0x6A6E77;

export interface TileColors {
  top: number;
  left: number;
  right: number;
}

export interface Building {
  seed: number;        // deterministic seed derived from coordinates
  colStart: number;    // first col (absolute grid coords)
  colEnd: number;      // last col (inclusive)
  rowStart: number;    // first row
  rowEnd: number;      // last row (inclusive)
  stories: number;
  color: TileColors;
  texture: number;     // 0-5, indexes into texture variants
  inset: number;       // fractional tile inset from sidewalk (0.2-0.8)
  heightOffset: number; // random pixel offset added to base story height
  doorSide: "left" | "right";
  doorInset: number;   // pixels inset from wall edge
  doorTexture: number; // 0-2, door image variant
  windowTexture: number; // 0-5, window style variant (for future textures)
}

/** Hash a building seed with a salt to get a float in [0, 1). */
export function buildingHash(seed: number, salt: number): number {
  let h = (seed + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 0x100000000;
}

// Dark cyberpunk color palette — base hues with consistent lighting
export const BUILDING_PALETTE: TileColors[] = [
  { top: 0x2a2a2a, left: 0x202020, right: 0x181818 }, // dark grey
  { top: 0x2e2e2e, left: 0x242424, right: 0x1c1c1c }, // medium dark grey
  { top: 0x232323, left: 0x1a1a1a, right: 0x141414 }, // charcoal
  { top: 0x282830, left: 0x1e1e26, right: 0x18181e }, // blue-grey
  { top: 0x2a2a32, left: 0x202028, right: 0x1a1a20 }, // steel grey
  { top: 0x242832, left: 0x1c1e28, right: 0x161820 }, // slate blue-grey
  { top: 0x2e2828, left: 0x241e1e, right: 0x1c1818 }, // reddish grey
  { top: 0x302a2a, left: 0x262020, right: 0x1e1818 }, // warm grey
  { top: 0x2a2420, left: 0x201c18, right: 0x181410 }, // dark brown
  { top: 0x2c2622, left: 0x221e1a, right: 0x1a1612 }, // warm brown
];

// Sidewalk/street tile colors
export const TILE_COLORS: Record<number, TileColors> = {
  1: { top: 0x2a2a2a, left: 0x222222, right: 0x1a1a1a }, // STREET
  2: { top: 0x262628, left: 0x202022, right: 0x1a1a1c }, // SIDEWALK
};
