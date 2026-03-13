import Phaser from "phaser";
import {
  BLOCK_INTERIOR,
  COL_PERIOD,
  CURB_HEIGHT,
  ROW_PERIOD,
  STORY_HEIGHT,
  SIDEWALK_WIDTH,
  STREET_WIDTH,
  TileType,
} from "../iso/CityLayout";
import { isoToScreen, screenToIso, TILE_H, TILE_W } from "../iso/IsoGeometry";
import { placeAsianBuilding } from "../rendering/BuildingAsian";
import { BUILDING_PALETTE, type Building } from "../rendering/BuildingTypes";
import {
  CompositeDir,
  getCompositeAdvance,
  pickComposite,
  pickCompositeFitting,
  placeCompositeBuilding,
  placeSkyscraper,
} from "../rendering/CompositeBuilding";
import { toggleDebug, toggleLabels } from "../rendering/debugOverlay";
import { placeNeonSigns } from "../rendering/NeonSigns";
import {
  renderSidewalkTile,
  renderStreetTile,
} from "../rendering/StreetRenderer";

type Direction =
  | "south"
  | "south-west"
  | "west"
  | "north-west"
  | "north"
  | "north-east"
  | "east"
  | "south-east";

export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private facing: Direction = "south";
  private cityMap!: number[][];
  private buildings: Building[] = [];
  private fpsEl!: HTMLElement | null;
  private coordEl!: HTMLElement | null;
  private gridEl!: HTMLElement | null;

  /** Per-block collection of building/sign objects to bake into RenderTextures */
  private blockBuildingObjects = new Map<string, Phaser.GameObjects.GameObject[]>();

  /** Shared sidewalk rendering objects (initialized in drawCityMap) */
  private sidewalkGfx!: Phaser.GameObjects.Graphics;
  private sidewalkLines!: Phaser.GameObjects.Graphics;
  private sidewalkBlitters!: Phaser.GameObjects.Blitter[];
  private streetBlitter!: Phaser.GameObjects.Blitter;
  private streetLines!: Phaser.GameObjects.Graphics;

  // Walk tuning
  private walkSpeed = 160;
  private walkAccel = 1400;
  private walkDrag = 1600;

  // Run tuning (shift held)
  private runSpeed = 300;
  private runAccel = 2400;
  private runDrag = 2000;

  // Map settings — 4×4 blocks
  private readonly mapCols = 4 * COL_PERIOD;
  private readonly mapRows = 4 * ROW_PERIOD;

  constructor() {
    super({ key: "GameScene" });
  }

  create() {
    this.cityMap = this.generateCityMap();
    this.drawCityMap();

    // Spawn player on a street tile (center of grid)
    const numBlockCols = Math.floor(this.mapCols / COL_PERIOD);
    const numBlockRows = Math.floor(this.mapRows / ROW_PERIOD);
    const spawnCol = Math.floor(numBlockCols / 2) * COL_PERIOD + 4;
    const spawnRow = Math.floor(numBlockRows / 2) * ROW_PERIOD + 4;
    const { x: spawnX, y: spawnY } = isoToScreen(spawnCol, spawnRow);

    this.player = this.add.sprite(spawnX, spawnY, "player-south");
    this.player.setScale(1.5);
    this.physics.add.existing(this.player);

    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    playerBody.setSize(16, 8);
    playerBody.setOffset(16, 36);

    // Camera
    this.cameras.main.setZoom(1.5);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setFollowOffset(0, 100);
    this.cameras.main.setDeadzone(40, 40);

    // HUD is rendered as HTML overlay (see index.html) for native resolution
    this.fpsEl = document.getElementById("hud-fps");
    this.coordEl = document.getElementById("hud-coords");
    this.gridEl = document.getElementById("hud-grid");

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.shiftKey = this.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.SHIFT,
    );

    // 9 toggles debug overlay (bounding boxes + chain dots)
    this.input.keyboard!.on("keydown-NINE", () => {
      const on = toggleDebug();
      console.log(`[debug] boxes ${on ? "ON" : "OFF"}`);
    });

    // 0 toggles asset labels
    this.input.keyboard!.on("keydown-ZERO", () => {
      const on = toggleLabels();
      console.log(`[debug] labels ${on ? "ON" : "OFF"}`);
    });

    // Performance diagnostics
    const totalObjects = this.children.length;
    const totalBodies =
      this.physics.world.bodies.entries.length +
      this.physics.world.staticBodies.entries.length;
    console.log(
      `[perf] Game objects: ${totalObjects}, Physics bodies: ${totalBodies}, Buildings: ${this.buildings.length}`,
    );
  }

  update() {
    if (this.fpsEl)
      this.fpsEl.textContent = `${Math.round(this.game.loop.actualFps)} fps`;
    if (this.coordEl)
      this.coordEl.textContent = `${Math.round(this.player.x)}, ${Math.round(this.player.y)}`;
    if (this.gridEl) {
      const grid = screenToIso(this.player.x, this.player.y);
      this.gridEl.textContent = `col ${Math.floor(grid.col)}, row ${Math.floor(grid.row)}`;
    }

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const running = this.shiftKey.isDown;

    const maxSpeed = running ? this.runSpeed : this.walkSpeed;
    const accel = running ? this.runAccel : this.walkAccel;
    const drag = running ? this.runDrag : this.walkDrag;

    body.setMaxSpeed(maxSpeed);
    body.setDrag(drag, drag);

    let inputX = 0;
    let inputY = 0;

    if (this.cursors.left.isDown) inputX = -1;
    else if (this.cursors.right.isDown) inputX = 1;

    if (this.cursors.up.isDown) inputY = -1;
    else if (this.cursors.down.isDown) inputY = 1;

    if (inputX !== 0 || inputY !== 0) {
      this.facing = this.getDirection(inputX, inputY);

      const moveX = inputX;
      let moveY = inputY;
      if (inputX !== 0 && inputY !== 0) {
        moveY = inputY * 0.5;
      }

      const len = Math.sqrt(moveX * moveX + moveY * moveY);
      body.setAcceleration((moveX / len) * accel, (moveY / len) * accel);

      const prefix = running ? "run" : "walk";
      const animKey = `${prefix}-${this.facing}`;
      if (
        this.player.anims.currentAnim?.key !== animKey ||
        !this.player.anims.isPlaying
      ) {
        this.player.play(animKey);
      }
    } else {
      body.setAcceleration(0, 0);

      if (body.speed < 20) {
        this.player.stop();
        this.player.setTexture(`player-${this.facing}`);
      }
    }

    // Depth sort: use sprite bottom (feet)
    const feetY = this.player.y + this.player.displayHeight / 2;
    const playerDepth = feetY / (TILE_H / 2);
    this.player.setDepth(playerDepth);

  }

  private getDirection(dx: number, dy: number): Direction {
    if (dx === 0 && dy === -1) return "north";
    if (dx === 1 && dy === -1) return "north-east";
    if (dx === 1 && dy === 0) return "east";
    if (dx === 1 && dy === 1) return "south-east";
    if (dx === 0 && dy === 1) return "south";
    if (dx === -1 && dy === 1) return "south-west";
    if (dx === -1 && dy === 0) return "west";
    if (dx === -1 && dy === -1) return "north-west";
    return this.facing;
  }

  private generateCityMap(): number[][] {
    const map: number[][] = [];

    for (let row = 0; row < this.mapRows; row++) {
      map[row] = [];
      for (let col = 0; col < this.mapCols; col++) {
        const colMod = col % COL_PERIOD;
        const rowMod = row % ROW_PERIOD;
        const inStreetCol = colMod < STREET_WIDTH;
        const inStreetRow = rowMod < STREET_WIDTH;

        if (inStreetCol || inStreetRow) {
          map[row][col] = TileType.STREET;
        } else {
          const colEdge =
            colMod < BLOCK_INTERIOR.colStart || colMod > BLOCK_INTERIOR.colEnd;
          const rowEdge =
            rowMod < BLOCK_INTERIOR.rowStart || rowMod > BLOCK_INTERIOR.rowEnd;

          if (colEdge || rowEdge) {
            map[row][col] = TileType.SIDEWALK;
          } else {
            map[row][col] = TileType.BUILDING;
          }
        }
      }
    }

    this.generateBuildings();
    return map;
  }

  /** Simple deterministic hash from two coordinates. */
  private hash(a: number, b: number, salt = 0): number {
    let h = (a * 374761393 + b * 668265263 + salt) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 0x100000000; // 0..1
  }

  private generateBuildings() {
    this.buildings = [];

    const numBlockCols = Math.floor(this.mapCols / COL_PERIOD);
    const numBlockRows = Math.floor(this.mapRows / ROW_PERIOD);

    for (let bRow = 0; bRow < numBlockRows; bRow++) {
      for (let bCol = 0; bCol < numBlockCols; bCol++) {
        const baseCol = bCol * COL_PERIOD + BLOCK_INTERIOR.colStart;
        const colEnd = bCol * COL_PERIOD + BLOCK_INTERIOR.colEnd;
        const baseRow = bRow * ROW_PERIOD + BLOCK_INTERIOR.rowStart;

        const depths = this.splitBlockDepth(BLOCK_INTERIOR.rows, bCol, bRow);

        let rowOffset = 0;
        for (let i = 0; i < depths.length; i++) {
          const depth = depths[i];
          const rowStart = baseRow + rowOffset;
          const rowEnd = Math.min(
            baseRow + rowOffset + depth - 1,
            this.mapRows - 1,
          );
          // One seed per building, derived from coordinates
          let seed = (baseCol * 374761393 + rowStart * 668265263) | 0;
          seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
          seed = (seed ^ (seed >>> 16)) >>> 0;

          const h = (s: number) => this.hash(baseCol, rowStart, s);

          const stories = 3 + Math.floor(h(1) * 3);
          const color =
            BUILDING_PALETTE[Math.floor(h(2) * BUILDING_PALETTE.length)];
          const texture = Math.floor(h(3) * 6);
          const inset = 0.1 + h(4) * 2.5;
          const heightOffset = Math.floor(h(5) * 60);
          const doorSide = h(6) < 0.5 ? ("left" as const) : ("right" as const);
          const doorInset = 10 + Math.floor(h(7) * 30);
          const doorTexture = Math.floor(h(8) * 14);
          const windowTexture = Math.floor(h(9) * 12);

          this.buildings.push({
            seed,
            colStart: baseCol,
            colEnd,
            rowStart,
            rowEnd,
            stories,
            color,
            texture,
            inset,
            heightOffset,
            doorSide,
            doorInset,
            doorTexture,
            windowTexture,
          });

          rowOffset += depth;
        }
      }
    }
  }

  private splitBlockDepth(total: number, bCol: number, bRow: number): number[] {
    const depths: number[] = [];
    let remaining = total;
    let i = 0;

    while (remaining > 0) {
      if (remaining <= 10) {
        if (remaining >= 5) {
          depths.push(remaining);
        } else {
          depths[depths.length - 1] += remaining;
        }
        break;
      }

      const maxDepth = Math.min(10, remaining - 5);
      const minDepth = 5;
      const depth =
        minDepth +
        Math.floor(
          this.hash(bCol * 100 + i, bRow, 99) * (maxDepth - minDepth + 1),
        );
      depths.push(depth);
      remaining -= depth;
      i++;
    }

    return depths;
  }

  private readonly NUM_SIDEWALK_VARIANTS = 8;

  private drawCityMap() {
    this.sidewalkGfx = this.add.graphics();
    this.sidewalkGfx.setDepth(0.6);
    this.sidewalkLines = this.add.graphics();
    this.sidewalkLines.setDepth(0.7);
    this.streetLines = this.add.graphics();
    this.streetLines.setDepth(0.5);

    // Batch street tile images into a blitter (single draw call)
    this.streetBlitter = this.add.blitter(0, 0, "street").setDepth(0);

    // Batch sidewalk tile images into blitters (one per variant, vs ~9500 individual Images)
    this.sidewalkBlitters = [];
    for (let v = 0; v < this.NUM_SIDEWALK_VARIANTS; v++) {
      this.sidewalkBlitters.push(
        this.add.blitter(0, 0, `sidewalk-${v}`).setDepth(0.6),
      );
    }
    const sidewalkBlitters = this.sidewalkBlitters;

    for (let row = 0; row < this.mapRows; row++) {
      for (let col = 0; col < this.mapCols; col++) {
        const tile = this.cityMap[row][col];

        if (tile === TileType.BUILDING) {
          // Sidewalk ground under buildings (visible through inset gaps)
          const { x, y } = isoToScreen(col, row);
          const v = Math.floor(
            this.hash(col, row, 500) * this.NUM_SIDEWALK_VARIANTS,
          );
          sidewalkBlitters[v].create(
            x - TILE_W / 2,
            y - CURB_HEIGHT - TILE_H / 2,
          );
        } else if (tile === TileType.STREET) {
          const { x, y } = isoToScreen(col, row);
          this.streetBlitter.create(x - TILE_W / 2, y - TILE_H / 2);
          renderStreetTile(this, col, row, this.streetLines);
        } else if (tile === TileType.SIDEWALK) {
          const { x, y } = isoToScreen(col, row);
          const v = Math.floor(
            this.hash(col, row, 500) * this.NUM_SIDEWALK_VARIANTS,
          );
          sidewalkBlitters[v].create(
            x - TILE_W / 2,
            y - CURB_HEIGHT - TILE_H / 2,
          );
          renderSidewalkTile(this, col, row, this.sidewalkGfx, this.sidewalkLines);
        }
      }
    }

    // Buildings, props, and showroom — disabled while composing new buildings
    // for (const building of this.buildings) { ... }
    // this.placeTrafficLights();
    // this.placeSewerGrates();
    // this.placeSteamVents();
    // this.drawShowroom();

    this.placeBuildings();
    this.bakeBlockObjects();
    this.placeParkingMeters();
    this.placeLightPoles();
    this.placeCars();
  }

  private placeBuildings() {
    const numBlockCols = Math.floor(this.mapCols / COL_PERIOD);
    const numBlockRows = Math.floor(this.mapRows / ROW_PERIOD);
    for (let bCol = 0; bCol < numBlockCols; bCol++) {
      for (let bRow = 0; bRow < numBlockRows; bRow++) {
        this.placeInnerBlock(bCol, bRow, {
          perimNW: bCol === 0,
          perimNE: bRow === 0,
          perimSE: bCol === numBlockCols - 1,
          perimSW: bRow === numBlockRows - 1,
        });
      }
    }
  }

  /** Push game objects into the per-block collection for later RT baking. */
  private collectForBlock(key: string, objects: Phaser.GameObjects.GameObject[]) {
    if (objects.length === 0) return;
    const arr = this.blockBuildingObjects.get(key);
    if (arr) {
      arr.push(...objects);
    } else {
      this.blockBuildingObjects.set(key, [...objects]);
    }
  }

  // ─── Face constants ──────────────────────────────────────────────────
  private readonly TARGET_H = 800;
  private readonly CORNERS = [0, 1, 3, 4];
  private readonly FACADES = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

  // ─── SW face: anchor + SW facade chain going NW (screen-left) ────────
  private placeLineSW(
    anchorCol: number,
    anchorRow: number,
    swLimitX: number,
    seed: number,
    idPrefix: string,
  ): { anchorSE: { x: number; y: number }; anchorIdx: number; objects: Phaser.GameObjects.GameObject[] } {
    const collected: Phaser.GameObjects.GameObject[] = [];
    const startPos = isoToScreen(anchorCol, anchorRow);

    // Anchor: corner building at the SW corner, SE-facing (shows both faces)
    const anchorIdx = this.CORNERS[seed % this.CORNERS.length];
    const anchor = placeCompositeBuilding(this, {
      targetH: this.TARGET_H,
      x: startPos.x,
      y: startPos.y,
      depth: startPos.y / (TILE_H / 2),
      seed,
      direction: CompositeDir.SE,
      buildingIdx: anchorIdx,
    });
    anchor.img.setDepth(Math.min(anchor.se.y, anchor.sw.y) / (TILE_H / 2));
    collected.push(anchor.img);

    // Neon signs on anchor's SE wall
    const anchorH = anchor.bbox.bottom - anchor.bbox.top;
    const anchorSignFloors = Math.floor((anchorH * 0.65) / STORY_HEIGHT);
    if (anchorSignFloors >= 2) {
      collected.push(...placeNeonSigns(this, {
        seed,
        id: `${idPrefix}-anchor-se`,
        edgeStart: { x: startPos.x, y: startPos.y },
        edgeEnd: anchor.se,
        numFloors: anchorSignFloors,
        floorHeight: STORY_HEIGHT,
        depth: anchor.img.depth,
        buildingIdx: anchor.buildingIdx,
        buildingImages: [anchor.img],
      }));
      // Neon signs on anchor's SW wall
      collected.push(...placeNeonSigns(this, {
        seed: seed + 1000,
        id: `${idPrefix}-anchor-sw`,
        edgeStart: anchor.sw,
        edgeEnd: { x: startPos.x, y: startPos.y },
        numFloors: anchorSignFloors,
        floorHeight: STORY_HEIGHT,
        depth: anchor.img.depth,
        buildingIdx: anchor.buildingIdx,
        buildingImages: [anchor.img],
        wall: "sw",
      }));
    }

    // Chain SW facades NW (screen-left) from anchor's SW corner
    let southX = anchor.sw.x;
    let southY = anchor.sw.y;
    let prevIdx: number | undefined = anchor.buildingIdx;

    for (let i = 1; ; i++) {
      const remaining = southX - swLimitX;
      if (remaining <= 0) break;

      const facadeSeed = (seed ^ (i * 83492791)) >>> 0;

      // ~30% chance of an Asian heritage building on SW chain too
      let h = (facadeSeed + 0x6d2b79f5) | 0;
      h = Math.imul(h ^ (h >>> 15), 1 | h);
      h = (h + Math.imul(h ^ (h >>> 7), 61 | h)) ^ h;
      const rng = ((h ^ (h >>> 14)) >>> 0) / 4294967296;

      if (rng < 0.3 && remaining > 450) {
        const asianAnchorX = southX;
        const asianAnchorY = southY;
        const asianPlaced = placeAsianBuilding(this, {
          targetW: 450,
          x: southX,
          y: southY,
          depth: southY / (TILE_H / 2),
          seed: facadeSeed,
        });
        const asianDepth = asianPlaced.se.y / (TILE_H / 2);
        for (const img of asianPlaced.images) img.setDepth(asianDepth);
        collected.push(...asianPlaced.images);

        const asianSignFloors = asianPlaced.numFloors - 1;
        if (asianSignFloors >= 2) {
          collected.push(...placeNeonSigns(this, {
            seed: facadeSeed,
            id: `${idPrefix}-sw-asian-${i}`,
            edgeStart: { x: asianAnchorX, y: asianAnchorY },
            edgeEnd: asianPlaced.se,
            numFloors: asianSignFloors,
            floorHeight: STORY_HEIGHT,
            depth: asianDepth,
            buildingImages: asianPlaced.images,
          }));
        }

        southX = asianPlaced.sw.x;
        southY = asianPlaced.sw.y;
        prevIdx = undefined;
        continue;
      }

      let chosenIdx = this.FACADES[facadeSeed % this.FACADES.length];
      if (chosenIdx === prevIdx)
        chosenIdx = this.FACADES[(facadeSeed + 1) % this.FACADES.length];
      const advance = getCompositeAdvance(
        this,
        chosenIdx,
        this.TARGET_H,
        CompositeDir.SW,
        "nw",
      );
      if (advance > remaining) {
        const fitting = pickCompositeFitting(
          this,
          this.TARGET_H,
          remaining,
          prevIdx,
          CompositeDir.SW,
          "nw",
          this.FACADES,
        );
        if (fitting === undefined) break;
        chosenIdx = fitting;
      }

      const swPlacedX = southX;
      const swPlacedY = southY;
      const placed = placeCompositeBuilding(this, {
        targetH: this.TARGET_H,
        x: southX,
        y: southY,
        depth: southY / (TILE_H / 2),
        seed: facadeSeed,
        direction: CompositeDir.SW,
        buildingIdx: chosenIdx,
      });
      placed.img.setDepth(placed.sw.y / (TILE_H / 2));
      collected.push(placed.img);

      // Neon signs on SW facade
      const swH = placed.bbox.bottom - placed.bbox.top;
      const swSignFloors = Math.floor((swH * 0.65) / STORY_HEIGHT);
      if (swSignFloors >= 2) {
        collected.push(...placeNeonSigns(this, {
          seed: facadeSeed,
          id: `${idPrefix}-sw-${i}`,
          edgeStart: { x: swPlacedX, y: swPlacedY },
          edgeEnd: placed.se,
          numFloors: swSignFloors,
          floorHeight: STORY_HEIGHT,
          depth: placed.img.depth,
          buildingIdx: placed.buildingIdx,
          buildingImages: [placed.img],
        }));
        collected.push(...placeNeonSigns(this, {
          seed: facadeSeed + 1000,
          id: `${idPrefix}-sw-main-${i}`,
          edgeStart: placed.sw,
          edgeEnd: { x: swPlacedX, y: swPlacedY },
          numFloors: swSignFloors,
          floorHeight: STORY_HEIGHT,
          depth: placed.img.depth,
          buildingIdx: placed.buildingIdx,
          buildingImages: [placed.img],
          wall: "sw",
        }));
      }

      southX = placed.sw.x;
      southY = placed.sw.y;
      prevIdx = placed.buildingIdx;
    }

    return { anchorSE: anchor.se, anchorIdx: anchor.buildingIdx, objects: collected };
  }

  // ─── SE face: chain SE buildings going SE (screen-right) ─────────────
  private placeLineSE_facade(
    startX: number,
    startY: number,
    seLimitX: number,
    seed: number,
    idPrefix: string,
    prevIdx?: number,
  ): Phaser.GameObjects.GameObject[] {
    const collected: Phaser.GameObjects.GameObject[] = [];
    let southX = startX;
    let southY = startY;
    let curPrevIdx = prevIdx;

    for (let i = 0; ; i++) {
      const remaining = seLimitX - southX;
      if (remaining <= 0) break;

      const facadeSeed = (seed ^ ((i + 100) * 83492791)) >>> 0;
      // Hash for RNG
      let h = (facadeSeed + 0x6d2b79f5) | 0;
      h = Math.imul(h ^ (h >>> 15), 1 | h);
      h = (h + Math.imul(h ^ (h >>> 7), 61 | h)) ^ h;
      const rng = ((h ^ (h >>> 14)) >>> 0) / 4294967296;

      // ~30% chance of an Asian heritage building
      if (rng < 0.3 && remaining > 450) {
        const asianAnchorX = southX;
        const asianAnchorY = southY;
        const asianPlaced = placeAsianBuilding(this, {
          targetW: 450,
          x: southX,
          y: southY,
          depth: southY / (TILE_H / 2),
          seed: facadeSeed,
        });
        const asianDepth = asianPlaced.se.y / (TILE_H / 2);
        for (const img of asianPlaced.images) img.setDepth(asianDepth);
        collected.push(...asianPlaced.images);

        const asianSignFloors = asianPlaced.numFloors - 1;
        if (asianSignFloors >= 2) {
          collected.push(...placeNeonSigns(this, {
            seed: facadeSeed,
            id: `${idPrefix}-se-asian-${i}`,
            edgeStart: { x: asianAnchorX, y: asianAnchorY },
            edgeEnd: asianPlaced.se,
            numFloors: asianSignFloors,
            floorHeight: STORY_HEIGHT,
            depth: asianDepth,
            buildingImages: asianPlaced.images,
          }));
        }

        southX = asianPlaced.se.x;
        southY = asianPlaced.se.y;
        curPrevIdx = undefined;
        continue;
      }

      let chosenIdx = pickComposite(facadeSeed, curPrevIdx);
      const advance = getCompositeAdvance(
        this,
        chosenIdx,
        this.TARGET_H,
        CompositeDir.SE,
        "se",
      );
      if (advance > remaining) {
        const fitting = pickCompositeFitting(
          this,
          this.TARGET_H,
          remaining,
          curPrevIdx,
          CompositeDir.SE,
          "se",
        );
        if (fitting === undefined) break;
        chosenIdx = fitting;
      }

      const sePlacedX = southX;
      const sePlacedY = southY;
      const placed = placeCompositeBuilding(this, {
        targetH: this.TARGET_H,
        x: southX,
        y: southY,
        depth: southY / (TILE_H / 2),
        seed: facadeSeed,
        exclude: curPrevIdx,
        buildingIdx: chosenIdx,
      });
      placed.img.setDepth(placed.se.y / (TILE_H / 2));
      collected.push(placed.img);

      // Neon signs on SE chain building's SE wall
      const seH = placed.bbox.bottom - placed.bbox.top;
      const seSignFloors = Math.floor((seH * 0.65) / STORY_HEIGHT);
      if (seSignFloors >= 2) {
        collected.push(...placeNeonSigns(this, {
          seed: facadeSeed,
          id: `${idPrefix}-se-${i}`,
          edgeStart: { x: sePlacedX, y: sePlacedY },
          edgeEnd: placed.se,
          numFloors: seSignFloors,
          floorHeight: STORY_HEIGHT,
          depth: placed.img.depth,
          buildingIdx: placed.buildingIdx,
          buildingImages: [placed.img],
        }));
      }

      southX = placed.se.x;
      southY = placed.se.y;
      curPrevIdx = placed.buildingIdx;
    }

    return collected;
  }

  // ─── NE fill: skyscrapers along a row (SW-facing), NE edge ───────────
  private placeLineNE(
    row: number,
    colStart: number,
    colEnd: number,
    stride: number,
    seed: number,
  ): Phaser.GameObjects.GameObject[] {
    const collected: Phaser.GameObjects.GameObject[] = [];
    for (let col = colStart, i = 0; col <= colEnd; col += stride, i++) {
      const skyPos = isoToScreen(col, row);
      const skySeed = (seed ^ (i * 91573)) >>> 0;
      const sky = placeSkyscraper(this, {
        targetH: this.TARGET_H,
        x: skyPos.x,
        y: skyPos.y,
        depth: skyPos.y / (TILE_H / 2) - BLOCK_INTERIOR.cols,
        buildingIdx: skySeed % 3,
        direction: CompositeDir.SE,
      });
      collected.push(sky.img);
    }
    return collected;
  }

  // ─── NW fill: skyscrapers along a column (SE-facing), NW edge ────────
  private placeLineNW(
    col: number,
    rowStart: number,
    rowEnd: number,
    stride: number,
    seed: number,
    depthOffset = 0,
  ): Phaser.GameObjects.GameObject[] {
    const collected: Phaser.GameObjects.GameObject[] = [];
    for (let row = rowStart, i = 0; row <= rowEnd; row += stride, i++) {
      const skyPos = isoToScreen(col, row);
      const skySeed = (seed ^ (i * 78439)) >>> 0;
      const sky = placeSkyscraper(this, {
        targetH: this.TARGET_H,
        x: skyPos.x,
        y: skyPos.y,
        depth: skyPos.y / (TILE_H / 2) - BLOCK_INTERIOR.rows + depthOffset,
        buildingIdx: skySeed % 3,
        direction: CompositeDir.SE,
      });
      collected.push(sky.img);
    }
    return collected;
  }

  // ─── SE line: facade buildings + skyscrapers behind them ──────────────
  private placeLineSE(
    startX: number,
    startY: number,
    seLimitX: number,
    skyCol: number,
    skyRowStart: number,
    skyRowEnd: number,
    seed: number,
    idPrefix: string,
    prevIdx?: number,
  ): Phaser.GameObjects.GameObject[] {
    const facade = this.placeLineSE_facade(startX, startY, seLimitX, seed, idPrefix, prevIdx);
    const sky = this.placeLineNW(skyCol, skyRowStart, skyRowEnd, 8, seed);
    return [...facade, ...sky];
  }

  // ─── Inner block: compose all 4 faces ────────────────────────────────
  private placeInnerBlock(
    bCol: number,
    bRow: number,
    edges: { perimNW: boolean; perimNE: boolean; perimSE: boolean; perimSW: boolean },
  ) {
    const blockColEnd = bCol * COL_PERIOD + BLOCK_INTERIOR.colEnd;
    const blockRowEnd = bRow * ROW_PERIOD + BLOCK_INTERIOR.rowEnd;
    const blockColStart = bCol * COL_PERIOD + BLOCK_INTERIOR.colStart;
    const blockRowStart = bRow * ROW_PERIOD + BLOCK_INTERIOR.rowStart;

    const seedBase = ((bCol * 73856093) ^ (bRow * 19349669)) >>> 0;
    const key = `${bCol}-${bRow}`;
    const idPrefix = `blk-${bCol}-${bRow}`;
    const allObjects: Phaser.GameObjects.GameObject[] = [];

    // Perimeter extent values (used by multiple edges)
    const perimCol = bCol * COL_PERIOD - SIDEWALK_WIDTH;
    const perimRow = bRow * ROW_PERIOD - SIDEWALK_WIDTH;
    const swPerimRow = (bRow + 1) * ROW_PERIOD + STREET_WIDTH + SIDEWALK_WIDTH;
    const sePerimCol = (bCol + 1) * COL_PERIOD + STREET_WIDTH + SIDEWALK_WIDTH;

    // Row/col extents for perimeter walls (how far they extend to meet neighbors)
    const nwRowStart = edges.perimNE ? perimRow : bRow * ROW_PERIOD;
    const nwRowEnd = edges.perimSW ? swPerimRow + 17 : (bRow + 1) * ROW_PERIOD - 1;
    const neColStart = edges.perimNW ? perimCol - 5 : bCol * COL_PERIOD;
    const neColEnd = edges.perimSE ? sePerimCol + 14 : (bCol + 1) * COL_PERIOD - 1;

    // --- NW perimeter wall ---
    if (edges.perimNW) {
      const perimStart = isoToScreen(perimCol, nwRowEnd);
      const perimLimitX = isoToScreen(perimCol, nwRowStart).x;
      const nwPerim = this.placeLineSE(perimStart.x, perimStart.y, perimLimitX, perimCol - 5, nwRowStart + 10, nwRowEnd, seedBase ^ 5000, `${idPrefix}-perim-nw`);
      allObjects.push(...nwPerim);

      // Sidewalk tiles between NW road edge and perimeter buildings
      for (let row = nwRowStart; row <= nwRowEnd; row++) {
        for (let col = perimCol - 5; col < bCol * COL_PERIOD; col++) {
          const { x, y } = isoToScreen(col, row);
          const v = Math.floor(this.hash(col, row, 500) * this.NUM_SIDEWALK_VARIANTS);
          this.sidewalkBlitters[v].create(x - TILE_W / 2, y - CURB_HEIGHT - TILE_H / 2);
          renderSidewalkTile(this, col, row, this.sidewalkGfx, this.sidewalkLines);
        }
      }
    }

    // --- NE perimeter wall ---
    if (edges.perimNE) {
      const neNwLimitX = isoToScreen(neColStart, perimRow).x;
      const nePerim = this.placeLineSW(neColEnd, perimRow, neNwLimitX, seedBase ^ 6000, `${idPrefix}-perim-ne`);
      allObjects.push(...nePerim.objects);

      // Sidewalk tiles between NE road edge and perimeter buildings
      for (let col = neColStart; col <= neColEnd; col++) {
        for (let row = perimRow - 5; row < bRow * ROW_PERIOD; row++) {
          const { x, y } = isoToScreen(col, row);
          const v = Math.floor(this.hash(col, row, 500) * this.NUM_SIDEWALK_VARIANTS);
          this.sidewalkBlitters[v].create(x - TILE_W / 2, y - CURB_HEIGHT - TILE_H / 2);
          renderSidewalkTile(this, col, row, this.sidewalkGfx, this.sidewalkLines);
        }
      }
    }

    // --- SE perimeter wall + road ---
    if (edges.perimSE) {
      const seRowEnd = edges.perimSW ? swPerimRow + 17 : (bRow + 1) * ROW_PERIOD - 1;

      // SE road tiles
      const seRoadStart = (bCol + 1) * COL_PERIOD;
      for (let row = nwRowStart; row <= seRowEnd; row++) {
        for (let col = seRoadStart; col < seRoadStart + STREET_WIDTH; col++) {
          const { x, y } = isoToScreen(col, row);
          this.streetBlitter.create(x - TILE_W / 2, y - TILE_H / 2);
          renderStreetTile(this, col, row, this.streetLines);
        }
      }

      // SE skyscrapers
      const sePerim = this.placeLineNW(sePerimCol + 14, nwRowStart, seRowEnd, 8, seedBase ^ 7000, BLOCK_INTERIOR.cols);
      allObjects.push(...sePerim);

      // SE sidewalk tiles
      for (let row = nwRowStart; row <= seRowEnd; row++) {
        for (let col = (bCol + 1) * COL_PERIOD + STREET_WIDTH; col <= sePerimCol + 14; col++) {
          const { x, y } = isoToScreen(col, row);
          const v = Math.floor(this.hash(col, row, 500) * this.NUM_SIDEWALK_VARIANTS);
          this.sidewalkBlitters[v].create(x - TILE_W / 2, y - CURB_HEIGHT - TILE_H / 2);
          renderSidewalkTile(this, col, row, this.sidewalkGfx, this.sidewalkLines);
        }
      }
    }

    // --- SW perimeter wall + road ---
    if (edges.perimSW) {
      const swColEnd = edges.perimSE ? sePerimCol + 14 : (bCol + 1) * COL_PERIOD - 1;

      // SW road tiles
      const swRoadStart = (bRow + 1) * ROW_PERIOD;
      for (let col = neColStart; col <= swColEnd; col++) {
        for (let row = swRoadStart; row < swRoadStart + STREET_WIDTH; row++) {
          const { x, y } = isoToScreen(col, row);
          this.streetBlitter.create(x - TILE_W / 2, y - TILE_H / 2);
          renderStreetTile(this, col, row, this.streetLines);
        }
      }

      // SW skyscrapers
      const swPerim = this.placeLineNE(swPerimRow + 17, neColStart, swColEnd, 8, seedBase ^ 8000);
      allObjects.push(...swPerim);

      // SW sidewalk tiles
      for (let col = neColStart; col <= swColEnd; col++) {
        for (let row = (bRow + 1) * ROW_PERIOD + STREET_WIDTH; row <= swPerimRow + 17; row++) {
          const { x, y } = isoToScreen(col, row);
          const v = Math.floor(this.hash(col, row, 500) * this.NUM_SIDEWALK_VARIANTS);
          this.sidewalkBlitters[v].create(x - TILE_W / 2, y - CURB_HEIGHT - TILE_H / 2);
          renderSidewalkTile(this, col, row, this.sidewalkGfx, this.sidewalkLines);
        }
      }
    }

    // --- Block SW face: anchor at south corner, chain NW ---
    const swNwLimitX = isoToScreen(blockColStart, blockRowEnd).x;
    const blockSW = this.placeLineSW(blockColEnd, blockRowEnd, swNwLimitX, seedBase ^ 1000, `${idPrefix}-sw`);
    allObjects.push(...blockSW.objects);

    // --- Block SE face: chain SE from anchor's SE corner + skyscrapers behind ---
    const seLimitX = isoToScreen(blockColEnd, blockRowStart).x;
    const blockSE = this.placeLineSE(blockSW.anchorSE.x, blockSW.anchorSE.y, seLimitX, blockColEnd - 2, blockRowStart + 18, blockRowEnd, seedBase ^ 2000, `${idPrefix}-se`, blockSW.anchorIdx);
    allObjects.push(...blockSE);

    this.collectForBlock(key, allObjects);
  }

  /**
   * Bake each block's collected building objects into a single RenderTexture.
   * Replaces thousands of individual images with one RT per block.
   */
  private bakeBlockObjects() {
    let totalBaked = 0;
    let rtCount = 0;

    for (const [key, objects] of this.blockBuildingObjects) {
      if (objects.length === 0) continue;

      // Sort by depth for correct compositing order within the RT
      objects.sort((a, b) =>
        ((a as Phaser.GameObjects.Image).depth ?? 0) -
        ((b as Phaser.GameObjects.Image).depth ?? 0),
      );

      // Compute bounding box of all objects
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let maxDepth = -Infinity;

      for (const obj of objects) {
        const img = obj as Phaser.GameObjects.Image;
        const left = img.x - img.displayWidth * img.originX;
        const top = img.y - img.displayHeight * img.originY;
        const right = left + img.displayWidth;
        const bottom = top + img.displayHeight;
        if (left < minX) minX = left;
        if (top < minY) minY = top;
        if (right > maxX) maxX = right;
        if (bottom > maxY) maxY = bottom;
        if (img.depth > maxDepth) maxDepth = img.depth;
      }

      // Add 1px padding to avoid clipping
      minX = Math.floor(minX) - 1;
      minY = Math.floor(minY) - 1;
      const width = Math.ceil(maxX - minX) + 2;
      const height = Math.ceil(maxY - minY) + 2;

      // Create RenderTexture at the bounding box position
      const rt = this.add.renderTexture(minX, minY, width, height);
      rt.setOrigin(0, 0);

      // Set internal camera to map world coords → RT local coords
      rt.camera.setScroll(minX, minY);

      // Batch-draw all objects into the RT
      for (const obj of objects) {
        rt.draw(obj);
      }
      rt.render();

      // Depth = southernmost building (highest depth) so RT sorts behind player on streets
      rt.setDepth(maxDepth);

      // Destroy originals — they're now baked into the RT
      for (const obj of objects) {
        obj.destroy();
      }

      totalBaked += objects.length;
      rtCount++;
    }

    this.blockBuildingObjects.clear();
    console.log(`[RT Bake] Baked ${totalBaked} objects into ${rtCount} RenderTextures`);
  }

  /**
   * Place parking meters along all four sidewalk edges of each city block.
   * Each edge uses the rotation facing the adjacent street:
   *   South edge (rowMod=55) → SE,  North edge (rowMod=8) → NW,
   *   East edge (colMod=35)  → NE,  West edge (colMod=8)  → SW.
   */
  private placeParkingMeters() {
    const TARGET_H = 40;
    const SPACING = 8;
    const OFFSET = 6;
    const CORNER = SIDEWALK_WIDTH; // skip props within this many tiles of corners

    // Pre-compute scales for each rotation
    const rotations = ["se", "ne", "nw", "sw"] as const;
    const scales: Record<string, number> = {};
    for (const dir of rotations) {
      const tex = this.textures.get(`parking-meter-${dir}`);
      if (!tex || tex.key === "__MISSING") return;
      const src = tex.getSourceImage() as HTMLCanvasElement;
      scales[dir] = TARGET_H / src.height;
    }

    const numBlockCols = Math.floor(this.mapCols / COL_PERIOD);
    const numBlockRows = Math.floor(this.mapRows / ROW_PERIOD);
    let count = 0;

    for (let bRow = 0; bRow < numBlockRows; bRow++) {
      for (let bCol = 0; bCol < numBlockCols; bCol++) {
        const colMin = bCol * COL_PERIOD + STREET_WIDTH;
        const colMax = bCol * COL_PERIOD + COL_PERIOD - 1;
        const rowMin = bRow * ROW_PERIOD + STREET_WIDTH;
        const rowMax = bRow * ROW_PERIOD + ROW_PERIOD - 1;

        // South edge — skip corners
        for (let col = colMin + OFFSET; col <= colMax; col += SPACING) {
          if (col - colMin < CORNER || colMax - col < CORNER) continue;
          const { x, y } = isoToScreen(col, rowMax);
          const img = this.add.image(x, y, "parking-meter-nw");
          img.setScale(scales.nw);
          img.setOrigin(0.5, 1);
          img.setDepth(y / (TILE_H / 2));
          count++;
        }

        // North edge — skip corners
        for (let col = colMin + OFFSET; col <= colMax; col += SPACING) {
          if (col - colMin < CORNER || colMax - col < CORNER) continue;
          const { x, y } = isoToScreen(col, rowMin);
          const img = this.add.image(x, y, "parking-meter-se");
          img.setScale(scales.se);
          img.setOrigin(0.5, 1);
          img.setDepth(y / (TILE_H / 2));
          count++;
        }

        // East edge — skip corners
        for (let row = rowMin + OFFSET; row <= rowMax; row += SPACING) {
          if (row - rowMin < CORNER || rowMax - row < CORNER) continue;
          const { x, y } = isoToScreen(colMax, row);
          const img = this.add.image(x, y, "parking-meter-sw");
          img.setScale(scales.sw);
          img.setOrigin(0.5, 1);
          img.setDepth(y / (TILE_H / 2));
          count++;
        }

        // West edge — skip corners
        for (let row = rowMin + OFFSET; row <= rowMax; row += SPACING) {
          if (row - rowMin < CORNER || rowMax - row < CORNER) continue;
          const { x, y } = isoToScreen(colMin, row);
          const img = this.add.image(x, y, "parking-meter-ne");
          img.setScale(scales.ne);
          img.setOrigin(0.5, 1);
          img.setDepth(y / (TILE_H / 2));
          count++;
        }

        // --- Perimeter edges (opposite side of road from block edges) ---

        // NW perimeter: road-facing edge at col before NW road, props face SW
        if (bCol === 0) {
          const perimEdgeCol = bCol * COL_PERIOD - 1;
          const nwPropRowStart = bRow === 0 ? bRow * ROW_PERIOD - SIDEWALK_WIDTH + OFFSET : rowMin + OFFSET;
          const nwPropRowEnd = bRow === numBlockRows - 1 ? (bRow + 1) * ROW_PERIOD + STREET_WIDTH + SIDEWALK_WIDTH + 17 : rowMax;
          for (let row = nwPropRowStart; row <= nwPropRowEnd; row += SPACING) {
            const { x, y } = isoToScreen(perimEdgeCol, row);
            const img = this.add.image(x, y, "parking-meter-sw");
            img.setScale(scales.sw);
            img.setOrigin(0.5, 1);
            img.setDepth(y / (TILE_H / 2));
            count++;
          }
        }

        // NE perimeter: road-facing edge at row before NE road, props face NW
        if (bRow === 0) {
          const perimEdgeRow = bRow * ROW_PERIOD - 1;
          const nePropColStart = bCol === 0 ? bCol * COL_PERIOD - SIDEWALK_WIDTH + OFFSET : colMin + OFFSET;
          const nePropColEnd = bCol === numBlockCols - 1 ? (bCol + 1) * COL_PERIOD + STREET_WIDTH + SIDEWALK_WIDTH + 14 : colMax;
          for (let col = nePropColStart; col <= nePropColEnd; col += SPACING) {
            const { x, y } = isoToScreen(col, perimEdgeRow);
            const img = this.add.image(x, y, "parking-meter-nw");
            img.setScale(scales.nw);
            img.setOrigin(0.5, 1);
            img.setDepth(y / (TILE_H / 2));
            count++;
          }
        }

        // SE perimeter: road-facing edge at first col after SE road, props face NE
        if (bCol === numBlockCols - 1) {
          const perimEdgeCol = (bCol + 1) * COL_PERIOD + STREET_WIDTH;
          const sePropRowStart = bRow === 0 ? bRow * ROW_PERIOD - SIDEWALK_WIDTH + OFFSET : rowMin + OFFSET;
          const sePropRowEnd = bRow === numBlockRows - 1 ? (bRow + 1) * ROW_PERIOD + STREET_WIDTH + SIDEWALK_WIDTH + 17 : rowMax;
          for (let row = sePropRowStart; row <= sePropRowEnd; row += SPACING) {
            const { x, y } = isoToScreen(perimEdgeCol, row);
            const img = this.add.image(x, y, "parking-meter-ne");
            img.setScale(scales.ne);
            img.setOrigin(0.5, 1);
            img.setDepth(y / (TILE_H / 2));
            count++;
          }
        }

        // SW perimeter: road-facing edge at first row after SW road, props face SE
        if (bRow === numBlockRows - 1) {
          const perimEdgeRow = (bRow + 1) * ROW_PERIOD + STREET_WIDTH;
          const swPropColStart = bCol === 0 ? bCol * COL_PERIOD - SIDEWALK_WIDTH + OFFSET : colMin + OFFSET;
          const swPropColEnd = bCol === numBlockCols - 1 ? (bCol + 1) * COL_PERIOD + STREET_WIDTH + SIDEWALK_WIDTH + 14 : colMax;
          for (let col = swPropColStart; col <= swPropColEnd; col += SPACING) {
            const { x, y } = isoToScreen(col, perimEdgeRow);
            const img = this.add.image(x, y, "parking-meter-se");
            img.setScale(scales.se);
            img.setOrigin(0.5, 1);
            img.setDepth(y / (TILE_H / 2));
            count++;
          }
        }
      }
    }
    console.log(`[ParkingMeters] Placed ${count} meters`);
  }

  /**
   * Place light poles along all four sidewalk edges, offset by 2 tiles
   * from parking meters so they alternate in between.
   */
  private placeLightPoles() {
    const TARGET_H = 160;
    const SPACING = 8;
    const OFFSET = 2;
    const CORNER = SIDEWALK_WIDTH;

    const rotations = ["se", "ne", "nw", "sw"] as const;
    const scales: Record<string, number> = {};
    for (const dir of rotations) {
      const tex = this.textures.get(`light-pole-${dir}`);
      if (!tex || tex.key === "__MISSING") return;
      const src = tex.getSourceImage() as HTMLCanvasElement;
      scales[dir] = TARGET_H / src.height;
    }

    const numBlockCols = Math.floor(this.mapCols / COL_PERIOD);
    const numBlockRows = Math.floor(this.mapRows / ROW_PERIOD);
    let count = 0;

    for (let bRow = 0; bRow < numBlockRows; bRow++) {
      for (let bCol = 0; bCol < numBlockCols; bCol++) {
        const colMin = bCol * COL_PERIOD + STREET_WIDTH;
        const colMax = bCol * COL_PERIOD + COL_PERIOD - 1;
        const rowMin = bRow * ROW_PERIOD + STREET_WIDTH;
        const rowMax = bRow * ROW_PERIOD + ROW_PERIOD - 1;

        // South edge — skip corners
        for (let col = colMin + OFFSET; col <= colMax; col += SPACING) {
          if (col - colMin < CORNER || colMax - col < CORNER) continue;
          const { x, y } = isoToScreen(col, rowMax);
          const img = this.add.image(x, y, "light-pole-ne");
          img.setScale(scales.ne);
          img.setOrigin(0.5, 1);
          img.setDepth(y / (TILE_H / 2));
          count++;
        }

        // North edge — skip NW corner only
        for (let col = colMin + OFFSET; col <= colMax; col += SPACING) {
          if (col - colMin < CORNER) continue;
          const { x, y } = isoToScreen(col, rowMin);
          const img = this.add.image(x, y, "light-pole-sw");
          img.setScale(scales.sw);
          img.setOrigin(0.5, 1);
          img.setDepth(y / (TILE_H / 2));
          count++;
        }

        // East edge — skip corners
        for (let row = rowMin + OFFSET; row <= rowMax; row += SPACING) {
          if (row - rowMin < CORNER || rowMax - row < CORNER) continue;
          const { x, y } = isoToScreen(colMax, row);
          const img = this.add.image(x, y, "light-pole-nw");
          img.setScale(scales.nw);
          img.setOrigin(0.5, 1);
          img.setDepth(y / (TILE_H / 2));
          count++;
        }

        // West / NW edge — skip corners
        for (let row = rowMin + OFFSET; row <= rowMax; row += SPACING) {
          if (row - rowMin < CORNER || rowMax - row < CORNER) continue;
          const { x, y } = isoToScreen(colMin, row);
          const img = this.add.image(x, y, "light-pole-se");
          img.setScale(scales.se);
          img.setOrigin(0.5, 1);
          img.setDepth(y / (TILE_H / 2));
          count++;
        }

        // --- Perimeter edges ---

        // NW perimeter: props face NW (full wall extent including corners)
        if (bCol === 0) {
          const perimEdgeCol = bCol * COL_PERIOD - 1;
          const nwPropRowStart = bRow === 0 ? bRow * ROW_PERIOD - SIDEWALK_WIDTH + OFFSET : rowMin + OFFSET;
          const nwPropRowEnd = bRow === numBlockRows - 1 ? (bRow + 1) * ROW_PERIOD + STREET_WIDTH + SIDEWALK_WIDTH + 17 : rowMax;
          for (let row = nwPropRowStart; row <= nwPropRowEnd; row += SPACING) {
            const { x, y } = isoToScreen(perimEdgeCol, row);
            const img = this.add.image(x, y, "light-pole-nw");
            img.setScale(scales.nw);
            img.setOrigin(0.5, 1);
            img.setDepth(y / (TILE_H / 2));
            count++;
          }
        }

        // NE perimeter: props face NE (full wall extent including corners)
        if (bRow === 0) {
          const perimEdgeRow = bRow * ROW_PERIOD - 1;
          const nePropColStart = bCol === 0 ? bCol * COL_PERIOD - SIDEWALK_WIDTH + OFFSET : colMin + OFFSET;
          const nePropColEnd = bCol === numBlockCols - 1 ? (bCol + 1) * COL_PERIOD + STREET_WIDTH + SIDEWALK_WIDTH + 14 : colMax;
          for (let col = nePropColStart; col <= nePropColEnd; col += SPACING) {
            const { x, y } = isoToScreen(col, perimEdgeRow);
            const img = this.add.image(x, y, "light-pole-ne");
            img.setScale(scales.ne);
            img.setOrigin(0.5, 1);
            img.setDepth(y / (TILE_H / 2));
            count++;
          }
        }

        // SE perimeter: props face SE (full wall extent including corners)
        if (bCol === numBlockCols - 1) {
          const perimEdgeCol = (bCol + 1) * COL_PERIOD + STREET_WIDTH;
          const sePropRowStart = bRow === 0 ? bRow * ROW_PERIOD - SIDEWALK_WIDTH + OFFSET : rowMin + OFFSET;
          const sePropRowEnd = bRow === numBlockRows - 1 ? (bRow + 1) * ROW_PERIOD + STREET_WIDTH + SIDEWALK_WIDTH + 17 : rowMax;
          for (let row = sePropRowStart; row <= sePropRowEnd; row += SPACING) {
            const { x, y } = isoToScreen(perimEdgeCol, row);
            const img = this.add.image(x, y, "light-pole-se");
            img.setScale(scales.se);
            img.setOrigin(0.5, 1);
            img.setDepth(y / (TILE_H / 2));
            count++;
          }
        }

        // SW perimeter: props face SW (full wall extent including corners)
        if (bRow === numBlockRows - 1) {
          const perimEdgeRow = (bRow + 1) * ROW_PERIOD + STREET_WIDTH;
          const swPropColStart = bCol === 0 ? bCol * COL_PERIOD - SIDEWALK_WIDTH + OFFSET : colMin + OFFSET;
          const swPropColEnd = bCol === numBlockCols - 1 ? (bCol + 1) * COL_PERIOD + STREET_WIDTH + SIDEWALK_WIDTH + 14 : colMax;
          for (let col = swPropColStart; col <= swPropColEnd; col += SPACING) {
            const { x, y } = isoToScreen(col, perimEdgeRow);
            const img = this.add.image(x, y, "light-pole-sw");
            img.setScale(scales.sw);
            img.setOrigin(0.5, 1);
            img.setDepth(y / (TILE_H / 2));
            count++;
          }
        }
      }
    }
    console.log(`[LightPoles] Placed ${count} poles`);
  }

  private readonly NUM_CAR_MODELS = 47;

  /**
   * Place parked cars along street curbs throughout the city.
   * Vertical streets (colMod 0-7): cars face NE
   * Horizontal streets (rowMod 0-7): cars face SE
   */
  private placeCars() {
    const TARGET_H = 120;
    const CURB_OFFSET = 2;
    let count = 0;

    const numBlockCols = Math.floor(this.mapCols / COL_PERIOD);
    const numBlockRows = Math.floor(this.mapRows / ROW_PERIOD);

    // Vertical streets (colMod 0-7) — cars parked along NW curb, facing NE
    // Only inner streets (skip perimeter ring: bCol 0 and numBlockCols)
    for (let bCol = 0; bCol <= numBlockCols; bCol++) {
      const streetColBase = bCol * COL_PERIOD;
      const carCol = streetColBase + CURB_OFFSET;

      for (let bRow = 0; bRow < numBlockRows; bRow++) {
        const segStart = bRow * ROW_PERIOD + STREET_WIDTH + SIDEWALK_WIDTH;
        const segEnd = (bRow + 1) * ROW_PERIOD - SIDEWALK_WIDTH;

        let row = segStart + 2;
        while (row < segEnd - 2) {
          const h = this.hash(carCol, row, 777);
          if (h < 0.4) {
            const carIdx = Math.floor(
              this.hash(carCol, row, 3333) * this.NUM_CAR_MODELS,
            );
            const texKey = `car-${carIdx}-ne`;
            const tex = this.textures.get(texKey);
            if (tex && tex.key !== "__MISSING") {
              const src = tex.getSourceImage() as HTMLCanvasElement;
              const scale = TARGET_H / src.height;
              const { x, y } = isoToScreen(carCol, row);
              const img = this.add.image(x, y, texKey);
              img.setScale(scale);
              img.setOrigin(0.5, 1);
              img.setDepth(y / (TILE_H / 2));
              count++;
            }
            row += 6;
          } else {
            row += 3;
          }
        }
      }
    }

    // Horizontal streets (rowMod 0-7) — cars parked along NE curb, facing SE
    for (let bRow = 0; bRow <= numBlockRows; bRow++) {
      const streetRowBase = bRow * ROW_PERIOD;
      const carRow = streetRowBase + CURB_OFFSET;

      for (let bCol = 0; bCol < numBlockCols; bCol++) {
        const segStart = bCol * COL_PERIOD + STREET_WIDTH + SIDEWALK_WIDTH;
        const segEnd = (bCol + 1) * COL_PERIOD - SIDEWALK_WIDTH;

        let col = segStart + 2;
        while (col < segEnd - 2) {
          const h = this.hash(col, carRow, 999);
          if (h < 0.4) {
            const carIdx = Math.floor(
              this.hash(col, carRow, 4444) * this.NUM_CAR_MODELS,
            );
            const texKey = `car-${carIdx}-se`;
            const tex = this.textures.get(texKey);
            if (tex && tex.key !== "__MISSING") {
              const src = tex.getSourceImage() as HTMLCanvasElement;
              const scale = TARGET_H / src.height;
              const { x, y } = isoToScreen(col, carRow);
              const img = this.add.image(x, y, texKey);
              img.setScale(scale);
              img.setOrigin(0.5, 1);
              img.setDepth(y / (TILE_H / 2));
              count++;
            }
            col += 6;
          } else {
            col += 3;
          }
        }
      }
    }

    console.log(`[Cars] Placed ${count} cars`);
  }
}
