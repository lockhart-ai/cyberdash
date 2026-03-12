import Phaser from "phaser";
import { TILE_W, TILE_H } from "../iso/IsoGeometry";
import { STORY_HEIGHT, ROW_PERIOD, BLOCK_INTERIOR } from "../iso/CityLayout";
import { Building, buildingHash } from "./BuildingTypes";

/**
 * Depth sub-layers within a building's col+row band.
 * Base depth = col + row for each wall tile.
 * These offsets ensure consistent front-to-back ordering.
 */
const DEPTH_ROOF = -0.5;          // behind everything
const DEPTH_WALL_FILL = -0.1;     // flat fill behind textures
const DEPTH_WALL_TEX = 0;         // wall texture images (base)
const DEPTH_FEATURE = 0.3;        // doors, windows (on wall surface)
const DEPTH_STREET_OBJ = 0.6;     // vending machines, garbage bins (in front of wall)
import { buildingCorners, tileInsetPosition, computeBuildingMetrics, SLOT_WIDTH, SLOT_GAP, WALL_MARGIN, WIN_TARGET_H, WIN_BOTTOM } from "./BuildingMetrics";
import { placeNeonSigns } from "./NeonSigns";
export type { BuildingMetrics } from "./BuildingMetrics";
export { computeBuildingMetrics } from "./BuildingMetrics";

/**
 * Browser-side wrapper: reads texture sizes from Phaser and logs to console.
 */
export function dumpBuildingMetrics(
  scene: Phaser.Scene,
  buildings: Building[],
) {
  const metrics = computeBuildingMetrics(buildings, (key) => {
    const src = scene.textures.get(key)?.getSourceImage();
    return { w: src?.width ?? 0, h: src?.height ?? 0 };
  });

  console.table(metrics.map(m => ({
    "#": m.index,
    rows: m.rowSpan,
    stories: m.stories,
    seWall: m.seWallLen,
    door: `${m.doorTexW}x${m.doorTexH} d${m.doorTexture}`,
    doorSide: m.doorSide,
    zone: m.windowZone,
    nWin: m.winCount,
    winTex: `${m.winTexW}x${m.winTexH} w${m.windowTexture}`,
    winScale: m.winScale,
    winRendered: `${m.winRenderedW}x${m.winRenderedH}`,
    "win/door": m.winDoorRatio,
  })));

  const ratios = metrics.filter(m => m.winScale > 0).map(m => m.winDoorRatio);
  if (ratios.length > 0) {
    const min = Math.min(...ratios);
    const max = Math.max(...ratios);
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    console.log(`Window/door height ratio — min: ${min}, max: ${max}, avg: ${avg.toFixed(2)}, n=${ratios.length}`);
  }

  return metrics;
}

/**
 * Render a building as 3 filled parallelograms (base layer) with
 * texture images tiled on top. Returns all GameObjects for occlusion.
 */
export function renderBuilding(
  scene: Phaser.Scene,
  building: Building,
): Phaser.GameObjects.GameObject[] {
  const objects: Phaser.GameObjects.GameObject[] = [];
  const { N, E, S, W } = buildingCorners(building);
  const wallHeight = building.stories * STORY_HEIGHT + building.heightOffset;
  const depth = building.colEnd + building.rowEnd;
  const v = building.texture;

  // Roof corners (ground corners shifted up by wallHeight)
  const Nr = { x: N.x, y: N.y - wallHeight };
  const Er = { x: E.x, y: E.y - wallHeight };
  const Sr = { x: S.x, y: S.y - wallHeight };
  const Wr = { x: W.x, y: W.y - wallHeight };

  // --- Roof ---
  const roofGfx = scene.add.graphics();
  roofGfx.setDepth(depth + DEPTH_ROOF);
  roofGfx.fillStyle(building.color.top, 1);
  roofGfx.fillPoints([
    new Phaser.Geom.Point(Nr.x, Nr.y),
    new Phaser.Geom.Point(Er.x, Er.y),
    new Phaser.Geom.Point(Sr.x, Sr.y),
    new Phaser.Geom.Point(Wr.x, Wr.y),
  ], true);
  objects.push(roofGfx);

  // --- SE wall (fill + brick lines merged) ---
  const seGfx = scene.add.graphics();
  seGfx.setDepth(building.colEnd + building.rowStart + DEPTH_WALL_FILL);
  seGfx.fillStyle(building.color.right, 1);
  seGfx.fillPoints([
    new Phaser.Geom.Point(E.x, E.y),
    new Phaser.Geom.Point(S.x, S.y),
    new Phaser.Geom.Point(Sr.x, Sr.y),
    new Phaser.Geom.Point(Er.x, Er.y),
  ], true);

  // --- SW wall (fill + brick lines merged) ---
  const swGfx = scene.add.graphics();
  swGfx.setDepth(building.colStart + building.rowEnd + DEPTH_WALL_FILL);
  swGfx.fillStyle(building.color.left, 1);
  swGfx.fillPoints([
    new Phaser.Geom.Point(S.x, S.y),
    new Phaser.Geom.Point(W.x, W.y),
    new Phaser.Geom.Point(Wr.x, Wr.y),
    new Phaser.Geom.Point(Sr.x, Sr.y),
  ], true);

  // --- Wall textures ---
  const texStories = Math.max(2, Math.min(4, building.stories));
  const wallImgHeight = 16 + texStories * STORY_HEIGHT;
  const scaleY = (wallHeight + 16) / wallImgHeight;

  // SE wall textures
  for (let row = building.rowStart; row <= building.rowEnd; row++) {
    const pos = tileInsetPosition(building, building.colEnd, row);
    const img = scene.add.image(pos.x, pos.y - wallHeight, `wall-right-v${v}-${texStories}s`);
    img.setOrigin(0, 0).setDepth(building.colEnd + row + DEPTH_WALL_TEX).setTint(building.color.right).setScale(1, scaleY);
    objects.push(img);
  }

  // SW wall textures
  for (let col = building.colStart; col <= building.colEnd; col++) {
    const pos = tileInsetPosition(building, col, building.rowEnd);
    const img = scene.add.image(pos.x - TILE_W / 2, pos.y - wallHeight, `wall-left-v${v}-${texStories}s`);
    img.setOrigin(0, 0).setDepth(col + building.rowEnd + DEPTH_WALL_TEX).setTint(building.color.left).setScale(1, scaleY);
    objects.push(img);
  }

  // --- Wall line pattern (brick or vertical slats) ---
  const wallPattern = buildingHash(building.seed, 52); // 0-1
  const brickH = 10 + Math.floor(buildingHash(building.seed, 50) * 14); // 10-23px tall
  const brickW = 16 + Math.floor(buildingHash(building.seed, 51) * 18); // 16-33px wide
  const lineColor = 0x0a0a0c;
  const lineAlpha = 0.35;
  const seWallScreenLen = E.x - S.x;
  const swWallScreenLen = S.x - W.x;

  // SE wall brick/slat lines (drawn on same Graphics as SE fill)
  seGfx.lineStyle(1, lineColor, lineAlpha);

  if (wallPattern < 0.33) {
    // Vertical slats only
    const slatW = 24 + Math.floor(buildingHash(building.seed, 53) * 40);
    for (let along = slatW; along < seWallScreenLen; along += slatW) {
      const x = S.x + along;
      const baseY = S.y - along * 0.5;
      seGfx.lineBetween(x, baseY, x, baseY - wallHeight);
    }
  } else if (wallPattern < 0.66) {
    // Brick pattern
    const numBrickRows = Math.floor(wallHeight / brickH);
    for (let y = brickH; y < wallHeight; y += brickH) {
      seGfx.lineBetween(S.x, S.y - y, E.x, E.y - y);
    }
    for (let r = 0; r < numBrickRows; r++) {
      const rowBottom = r * brickH;
      const rowTop = Math.min((r + 1) * brickH, wallHeight);
      const offset = (r % 2 === 0) ? 0 : brickW / 2;
      for (let along = offset + brickW; along < seWallScreenLen; along += brickW) {
        const x = S.x + along;
        const baseY = S.y - along * 0.5;
        seGfx.lineBetween(x, baseY - rowBottom, x, baseY - rowTop);
      }
    }
  }
  objects.push(seGfx);

  // SW wall brick/slat lines (drawn on same Graphics as SW fill)
  swGfx.lineStyle(1, lineColor, lineAlpha);

  if (wallPattern < 0.33) {
    const slatW = 24 + Math.floor(buildingHash(building.seed, 53) * 40);
    for (let along = slatW; along < swWallScreenLen; along += slatW) {
      const x = S.x - along;
      const baseY = S.y - along * 0.5;
      swGfx.lineBetween(x, baseY, x, baseY - wallHeight);
    }
  } else if (wallPattern < 0.66) {
    const numBrickRows = Math.floor(wallHeight / brickH);
    for (let y = brickH; y < wallHeight; y += brickH) {
      swGfx.lineBetween(S.x, S.y - y, W.x, W.y - y);
    }
    for (let r = 0; r < numBrickRows; r++) {
      const rowBottom = r * brickH;
      const rowTop = Math.min((r + 1) * brickH, wallHeight);
      const offset = (r % 2 === 0) ? 0 : brickW / 2;
      for (let along = offset + brickW; along < swWallScreenLen; along += brickW) {
        const x = S.x - along;
        const baseY = S.y - along * 0.5;
        swGfx.lineBetween(x, baseY - rowBottom, x, baseY - rowTop);
      }
    }
  }
  objects.push(swGfx);

  // --- Balcony slabs on SE wall (each story above ground floor) ---
  const BALCONY_OUT = TILE_W;  // two tile widths outward (~64px)
  const BALCONY_THICK = 4;  // slab thickness (pixels)
  const RAIL_H = 64;        // railing wall height above slab

  // +row direction in screen coords (normalized to 1px)
  // Full tile step = (TILE_W/2, TILE_H/2), length = sqrt(32^2 + 16^2) ≈ 35.8
  const rowDirLen = Math.sqrt((TILE_W / 2) ** 2 + (TILE_H / 2) ** 2);
  const rowDirX = (TILE_W / 2) / rowDirLen;
  const rowDirY = (TILE_H / 2) / rowDirLen;

  // Shared Graphics for all balconies and signs (one each, not per-floor)
  const balcGfx = scene.add.graphics();
  balcGfx.setDepth(depth + DEPTH_FEATURE + 0.1);

  for (let floor = 1; floor < building.stories; floor++) {
    const floorY = floor * STORY_HEIGHT;

    // SE wall edge at this floor height: S and E shifted up
    const sFloor = { x: S.x, y: S.y - floorY };
    const eFloor = { x: E.x, y: E.y - floorY };

    // Outer edge: shifted outward by BALCONY_OUT along +row
    const sOut = { x: sFloor.x + rowDirX * BALCONY_OUT, y: sFloor.y + rowDirY * BALCONY_OUT };
    const eOut = { x: eFloor.x + rowDirX * BALCONY_OUT, y: eFloor.y + rowDirY * BALCONY_OUT };

    // Top face (roof color)
    balcGfx.fillStyle(building.color.top, 1);
    balcGfx.fillPoints([
      new Phaser.Geom.Point(sFloor.x, sFloor.y),
      new Phaser.Geom.Point(eFloor.x, eFloor.y),
      new Phaser.Geom.Point(eOut.x, eOut.y),
      new Phaser.Geom.Point(sOut.x, sOut.y),
    ], true);

    // Front face (under the slab, facing camera — SE wall color, slightly darker)
    balcGfx.fillStyle(building.color.right, 1);
    balcGfx.fillPoints([
      new Phaser.Geom.Point(sOut.x, sOut.y),
      new Phaser.Geom.Point(eOut.x, eOut.y),
      new Phaser.Geom.Point(eOut.x, eOut.y + BALCONY_THICK),
      new Phaser.Geom.Point(sOut.x, sOut.y + BALCONY_THICK),
    ], true);

    // Side face on S corner (small parallelogram closing the slab end)
    balcGfx.fillStyle(building.color.left, 1);
    balcGfx.fillPoints([
      new Phaser.Geom.Point(sFloor.x, sFloor.y),
      new Phaser.Geom.Point(sOut.x, sOut.y),
      new Phaser.Geom.Point(sOut.x, sOut.y + BALCONY_THICK),
      new Phaser.Geom.Point(sFloor.x, sFloor.y + BALCONY_THICK),
    ], true);

    // --- Railing walls (rise up from slab top) ---
    // Front railing (along outer edge sOut→eOut, faces camera like SE wall)
    balcGfx.fillStyle(building.color.right, 1);
    balcGfx.fillPoints([
      new Phaser.Geom.Point(sOut.x, sOut.y),
      new Phaser.Geom.Point(eOut.x, eOut.y),
      new Phaser.Geom.Point(eOut.x, eOut.y - RAIL_H),
      new Phaser.Geom.Point(sOut.x, sOut.y - RAIL_H),
    ], true);

    // S-side railing (sFloor→sOut, faces camera like SW wall)
    balcGfx.fillStyle(building.color.left, 1);
    balcGfx.fillPoints([
      new Phaser.Geom.Point(sFloor.x, sFloor.y),
      new Phaser.Geom.Point(sOut.x, sOut.y),
      new Phaser.Geom.Point(sOut.x, sOut.y - RAIL_H),
      new Phaser.Geom.Point(sFloor.x, sFloor.y - RAIL_H),
    ], true);

    // E-side railing (eFloor→eOut)
    balcGfx.fillStyle(building.color.right, 1);
    balcGfx.fillPoints([
      new Phaser.Geom.Point(eFloor.x, eFloor.y),
      new Phaser.Geom.Point(eOut.x, eOut.y),
      new Phaser.Geom.Point(eOut.x, eOut.y - RAIL_H),
      new Phaser.Geom.Point(eFloor.x, eFloor.y - RAIL_H),
    ], true);

    // Horizontal slat lines on railing faces
    balcGfx.lineStyle(1, lineColor, lineAlpha);
    const SLAT_SPACING = 8;
    // Front railing slats (sOut→eOut, slope -0.5)
    for (let h = SLAT_SPACING; h < RAIL_H; h += SLAT_SPACING) {
      balcGfx.lineBetween(sOut.x, sOut.y - h, eOut.x, eOut.y - h);
    }
    // S-side railing slats (sFloor→sOut, slope +0.5)
    for (let h = SLAT_SPACING; h < RAIL_H; h += SLAT_SPACING) {
      balcGfx.lineBetween(sFloor.x, sFloor.y - h, sOut.x, sOut.y - h);
    }
    // E-side railing slats (eFloor→eOut, slope +0.5)
    for (let h = SLAT_SPACING; h < RAIL_H; h += SLAT_SPACING) {
      balcGfx.lineBetween(eFloor.x, eFloor.y - h, eOut.x, eOut.y - h);
    }
  }
  objects.push(balcGfx);

  // Neon signs on balcony outer edge
  const signEdgeStart = { x: S.x + rowDirX * BALCONY_OUT, y: S.y + rowDirY * BALCONY_OUT };
  const signEdgeEnd = { x: E.x + rowDirX * BALCONY_OUT, y: E.y + rowDirY * BALCONY_OUT };
  const signObjs = placeNeonSigns(scene, {
    seed: building.seed,
    id: `bldg-${building.colStart}-${building.rowStart}`,
    edgeStart: signEdgeStart,
    edgeEnd: signEdgeEnd,
    numFloors: building.stories - 1,
    floorHeight: STORY_HEIGHT,
    depth: depth + DEPTH_FEATURE,
  });
  objects.push(...signObjs);

  // --- Slot grid for SE wall features (doors & windows) ---
  const seWallLen = E.x - S.x;
  const usableWidth = seWallLen - 2 * WALL_MARGIN;
  const numSlots = Math.max(1, Math.floor((usableWidth + SLOT_GAP) / (SLOT_WIDTH + SLOT_GAP)));
  const totalSlotsWidth = numSlots * SLOT_WIDTH + (numSlots - 1) * SLOT_GAP;
  const gridStart = WALL_MARGIN + (usableWidth - totalSlotsWidth) / 2;

  const doorSlot = building.doorSide === "left" ? 0 : numSlots - 1;

  const slotCenters: number[] = [];
  for (let s = 0; s < numSlots; s++) {
    slotCenters.push(gridStart + s * (SLOT_WIDTH + SLOT_GAP) + SLOT_WIDTH / 2);
  }

  const doorCenterAlong = slotCenters[doorSlot];
  const doorX = S.x + doorCenterAlong;
  const doorY = S.y - doorCenterAlong * 0.5 + TILE_H / 2;
  const doorAlong = doorCenterAlong - SLOT_WIDTH / 2;

  const seHasDoor = buildingHash(building.seed, 40) < 0.75;
  const NUM_GARAGE = 7;
  const doorRenderedH = 128;

  if (seHasDoor) {
    // Door + vending machine on ground floor
    const doorNearT = seWallLen > 0 ? doorAlong / seWallLen : 0;
    const doorNearRow = building.rowEnd + (building.rowStart - building.rowEnd) * doorNearT;
    const doorTexKey = `metal-door-${building.doorTexture}`;
    const doorFrame = scene.textures.getFrame(doorTexKey);
    const doorScale = doorFrame ? doorRenderedH / doorFrame.height : 1;
    const doorImg = scene.add.image(doorX, doorY, doorTexKey);
    doorImg.setOrigin(0.5, 1).setScale(doorScale).setDepth(building.colEnd + Math.ceil(doorNearRow) + DEPTH_FEATURE);
    objects.push(doorImg);

    // Vending machine on opposite side of door
    const VM_H = 96;
    const vmVariant = Math.floor(buildingHash(building.seed, 21) * 9);
    const vmKey = `vending-machine-${vmVariant}`;
    const vmFrame = scene.textures.getFrame(vmKey);
    if (vmFrame) {
      const vmSlot = building.doorSide === "left" ? numSlots - 1 : 0;
      const vmAlong = slotCenters[vmSlot];
      const vmScale = VM_H / vmFrame.height;
      const vmX = S.x + vmAlong;
      const vmBaseY = S.y - vmAlong * 0.5 + TILE_H / 2;
      const vmNearT = seWallLen > 0 ? vmAlong / seWallLen : 0;
      const vmNearRow = building.rowEnd + (building.rowStart - building.rowEnd) * vmNearT;
      const vmImg = scene.add.image(vmX, vmBaseY, vmKey);
      vmImg.setOrigin(0.5, 1).setScale(vmScale).setDepth(building.colEnd + Math.ceil(vmNearRow) + DEPTH_STREET_OBJ);
      objects.push(vmImg);
    }
  } else {
    // Garage door spanning two center slots
    const garageTexKey = `garage-door-${Math.floor(buildingHash(building.seed, 36) * NUM_GARAGE)}`;
    const gs0 = Math.max(0, Math.floor(numSlots / 2) - 1);
    const gs1 = Math.min(numSlots - 1, gs0 + 1);
    const gAlong = (slotCenters[gs0] + slotCenters[gs1]) / 2;
    const gX = S.x + gAlong;
    const gBaseY = S.y - gAlong * 0.5 + TILE_H / 2;
    const gFrame = scene.textures.getFrame(garageTexKey);
    if (gFrame) {
      const gScale = doorRenderedH / gFrame.height;
      const gNearT = seWallLen > 0 ? gAlong / seWallLen : 0;
      const gNearRow = building.rowEnd + (building.rowStart - building.rowEnd) * gNearT;
      const gImg = scene.add.image(gX, gBaseY, garageTexKey);
      gImg.setOrigin(0.5, 1).setScale(gScale, gScale);
      gImg.setDepth(building.colEnd + Math.ceil(gNearRow) + DEPTH_FEATURE);
      objects.push(gImg);
    }

    // Garbage bin next to garage door
    const BIN_H = 48;
    const binVariant = Math.floor(buildingHash(building.seed, 22) * 6);
    const binKey = `garbage-bin-${binVariant}`;
    const binFrame = scene.textures.getFrame(binKey);
    if (binFrame) {
      const binScale = BIN_H / binFrame.height;
      const binSlot = gs0 > 0 ? 0 : numSlots - 1;
      const binAlong = slotCenters[binSlot];
      const binX = S.x + binAlong;
      const binBaseY = S.y - binAlong * 0.5 + TILE_H / 2;
      const binNearT = seWallLen > 0 ? binAlong / seWallLen : 0;
      const binNearRow = building.rowEnd + (building.rowStart - building.rowEnd) * binNearT;
      const binImg = scene.add.image(binX, binBaseY, binKey);
      binImg.setOrigin(0.5, 1).setScale(binScale).setDepth(depth + DEPTH_STREET_OBJ);
      objects.push(binImg);
    }
  }

  // --- Windows on SE wall (upper floors only) ---
  const VENTS = ["wall-vent-0", "wall-vent-1", "wall-vent-2"];
  const ventKey = VENTS[Math.floor(buildingHash(building.seed, 30) * VENTS.length)];

  const allSlots = Array.from({ length: numSlots }, (_, i) => i);
  const upperFloors = Array.from({ length: building.stories - 1 }, (_, i) => i + 1);
  const elecSlot = allSlots.length > 0
    ? allSlots[Math.floor(buildingHash(building.seed, 31) * allSlots.length)] : -1;
  const elecFloor = upperFloors.length > 0
    ? upperFloors[Math.floor(buildingHash(building.seed, 32) * upperFloors.length)] : -1;
  const ventFloorOptions = upperFloors.filter(i => i !== elecFloor);
  if (ventFloorOptions.length === 0 && upperFloors.length > 0) ventFloorOptions.push(upperFloors[0]);
  const ventFloor = ventFloorOptions[Math.floor(buildingHash(building.seed, 33) * ventFloorOptions.length)];
  const ventSlotOptions = allSlots.filter(s => !(s === elecSlot && ventFloor === elecFloor));
  const ventSlot = ventSlotOptions.length > 0
    ? ventSlotOptions[Math.floor(buildingHash(building.seed, 34) * ventSlotOptions.length)] : -1;

  const texKey = `window-${building.windowTexture}`;
  const probe = scene.textures.getFrame(texKey);
  const texW = probe?.width ?? 128;
  const texH = probe?.height ?? 128;
  const winScale = Math.min(WIN_TARGET_H / texH, SLOT_WIDTH / texW);

  for (let floor = 0; floor < building.stories; floor++) {
    const floorY = floor * STORY_HEIGHT;

    for (let s = 0; s < numSlots; s++) {
      if (floor === 0) continue; // no windows on ground floor

      const along = slotCenters[s];
      const winX = S.x + along;
      const floorBaseY = S.y - along * 0.5 + TILE_H / 2 - floorY;
      const topY = floorBaseY - doorRenderedH;

      const winNearT = seWallLen > 0 ? (along - SLOT_WIDTH / 2) / seWallLen : 0;
      const winNearRow = building.rowEnd + (building.rowStart - building.rowEnd) * winNearT;

      let slotTexKey = texKey;
      let slotScale = winScale;
      if (floor === elecFloor && s === elecSlot) {
        const ef = scene.textures.getFrame("elec-box-0");
        if (ef) { slotTexKey = "elec-box-0"; slotScale = Math.min(WIN_TARGET_H / ef.height, SLOT_WIDTH / ef.width); }
      } else if (floor === ventFloor && s === ventSlot) {
        const vf = scene.textures.getFrame(ventKey);
        if (vf) { slotTexKey = ventKey; slotScale = Math.min(WIN_TARGET_H / vf.height, SLOT_WIDTH / vf.width); }
      }

      const winImg = scene.add.image(winX, topY, slotTexKey);
      winImg.setOrigin(0.5, 0).setScale(slotScale, slotScale);
      winImg.setDepth(building.colEnd + Math.ceil(winNearRow) + DEPTH_FEATURE);
      objects.push(winImg);
    }
  }

  // --- SW wall features (only on the building at the SW edge of the block) ---
  const isSWEdge = building.rowEnd % ROW_PERIOD === BLOCK_INTERIOR.rowEnd;
  if (!isSWEdge) { /* skip SW wall features */ } else {

  const swVentKey = VENTS[Math.floor(buildingHash(building.seed, 130) * VENTS.length)];

  const swWallLen = S.x - W.x;
  const swUsableWidth = swWallLen - 2 * WALL_MARGIN;
  const swNumSlots = Math.max(0, Math.floor((swUsableWidth + SLOT_GAP) / (SLOT_WIDTH + SLOT_GAP)));

  if (swNumSlots > 0) {
    const swTotalSlotsWidth = swNumSlots * SLOT_WIDTH + (swNumSlots - 1) * SLOT_GAP;
    const swGridStart = WALL_MARGIN + (swUsableWidth - swTotalSlotsWidth) / 2;
    const swSlotCenters: number[] = [];
    for (let s = 0; s < swNumSlots; s++) {
      swSlotCenters.push(swGridStart + s * (SLOT_WIDTH + SLOT_GAP) + SLOT_WIDTH / 2);
    }

    const swAllSlots = Array.from({ length: swNumSlots }, (_, i) => i);

    // --- SW ground floor: garage doors, vending machines, trash cans ---
    const swSkip = new Set<number>();
    for (let s = 0; s < swNumSlots; s++) {
      if (swSkip.has(s)) continue;
      const along = swSlotCenters[s];
      const objX = S.x - along;
      const objBaseY = S.y - along * 0.5 + TILE_H / 2;
      const roll = buildingHash(building.seed, 140 + s);
      if (roll < 0.15 && s + 1 < swNumSlots && !swSkip.has(s + 1)) {
        swSkip.add(s + 1);
        // Garage door
        const gIdx = Math.floor(buildingHash(building.seed, 150 + s) * NUM_GARAGE);
        const gKey = `garage-door-${gIdx}`;
        const gFrame = scene.textures.getFrame(gKey);
        if (gFrame) {
          const gScale = doorRenderedH / gFrame.height;
          const gImg = scene.add.image(objX, objBaseY, gKey);
          gImg.setOrigin(0.5, 1).setScale(gScale, gScale).setFlipX(true);
          gImg.setDepth(depth + DEPTH_FEATURE);
          objects.push(gImg);
        }
      } else if (roll < 0.55) {
        // Vending machine
        const vmIdx = Math.floor(buildingHash(building.seed, 160 + s) * 9);
        const vmKey = `vending-machine-${vmIdx}`;
        const vmFrame = scene.textures.getFrame(vmKey);
        if (vmFrame) {
          const vmScale = 96 / vmFrame.height;
          const vmImg = scene.add.image(objX, objBaseY, vmKey);
          vmImg.setOrigin(0.5, 1).setScale(vmScale).setFlipX(true);
          vmImg.setDepth(depth + DEPTH_STREET_OBJ);
          objects.push(vmImg);
        }
      } else {
        // Garbage bin
        const binIdx = Math.floor(buildingHash(building.seed, 170 + s) * 6);
        const binKey = `garbage-bin-${binIdx}`;
        const binFrame = scene.textures.getFrame(binKey);
        if (binFrame) {
          const binScale = 48 / binFrame.height;
          const binImg = scene.add.image(objX, objBaseY, binKey);
          binImg.setOrigin(0.5, 1).setScale(binScale).setFlipX(true);
          binImg.setDepth(depth + DEPTH_STREET_OBJ);
          objects.push(binImg);
        }
      }
    }

    const swElecSlot = swAllSlots.length > 0
      ? swAllSlots[Math.floor(buildingHash(building.seed, 131) * swAllSlots.length)] : -1;
    const swUpperFloors = Array.from({ length: building.stories - 1 }, (_, i) => i + 1);
    const swElecFloor = swUpperFloors.length > 0
      ? swUpperFloors[Math.floor(buildingHash(building.seed, 132) * swUpperFloors.length)] : -1;
    const swVentFloorOpts = swUpperFloors.filter(i => i !== swElecFloor);
    if (swVentFloorOpts.length === 0 && swUpperFloors.length > 0) swVentFloorOpts.push(swUpperFloors[0]);
    const swVentFloor = swVentFloorOpts[Math.floor(buildingHash(building.seed, 133) * swVentFloorOpts.length)];
    const swVentSlotOpts = swAllSlots.filter(s => !(s === swElecSlot && swVentFloor === swElecFloor));
    const swVentSlot = swVentSlotOpts.length > 0
      ? swVentSlotOpts[Math.floor(buildingHash(building.seed, 134) * swVentSlotOpts.length)] : -1;

    for (let floor = 0; floor < building.stories; floor++) {
      const floorY = floor * STORY_HEIGHT;

      for (let s = 0; s < swNumSlots; s++) {
        if (floor === 0) continue; // no windows/doors on ground floor

        const along = swSlotCenters[s];
        const winX = S.x - along;
        const floorBaseY = S.y - along * 0.5 + TILE_H / 2 - floorY;
        const topY = floorBaseY - doorRenderedH;

        const winNearT = swWallLen > 0 ? (along - SLOT_WIDTH / 2) / swWallLen : 0;
        const winNearCol = building.colEnd + (building.colStart - building.colEnd) * winNearT;

        let swSlotTexKey = texKey;
        let swSlotScale = winScale;
        if (floor === swElecFloor && s === swElecSlot) {
          const ef = scene.textures.getFrame("elec-box-0");
          if (ef) { swSlotTexKey = "elec-box-0"; swSlotScale = Math.min(WIN_TARGET_H / ef.height, SLOT_WIDTH / ef.width); }
        } else if (floor === swVentFloor && s === swVentSlot) {
          const vf = scene.textures.getFrame(swVentKey);
          if (vf) { swSlotTexKey = swVentKey; swSlotScale = Math.min(WIN_TARGET_H / vf.height, SLOT_WIDTH / vf.width); }
        }

        const winImg = scene.add.image(winX, topY, swSlotTexKey);
        winImg.setOrigin(0.5, 0).setScale(swSlotScale, swSlotScale);
        winImg.setFlipX(true);
        winImg.setDepth(Math.ceil(winNearCol) + building.rowEnd + DEPTH_FEATURE);
        objects.push(winImg);
      }
    }
  }
  } // end isSWEdge
  return objects;
}

/**
 * Render a colored footprint + outline for a building, shown when the building is occluded.
 * Starts hidden. Caller toggles visibility.
 */
export function renderBuildingFootprint(
  scene: Phaser.Scene,
  building: Building,
): Phaser.GameObjects.Graphics {
  const { N, E, S, W } = buildingCorners(building);
  const gfx = scene.add.graphics();
  gfx.setDepth(0.8);

  const pts = [
    new Phaser.Geom.Point(N.x, N.y),
    new Phaser.Geom.Point(E.x, E.y),
    new Phaser.Geom.Point(S.x, S.y),
    new Phaser.Geom.Point(W.x, W.y),
  ];

  gfx.fillStyle(building.color.top, 0.4);
  gfx.fillPoints(pts, true);
  gfx.lineStyle(1, 0x111111, 1);
  gfx.strokePoints(pts, true);

  gfx.setVisible(false);
  return gfx;
}
