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
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private fpsEl!: HTMLElement | null;
  private coordEl!: HTMLElement | null;
  private gridEl!: HTMLElement | null;

  // Walk tuning
  private walkSpeed = 160;
  private walkAccel = 1400;
  private walkDrag = 1600;

  // Run tuning (shift held)
  private runSpeed = 300;
  private runAccel = 2400;
  private runDrag = 2000;

  // Map settings
  private readonly mapCols = 108;
  private readonly mapRows = 168;

  constructor() {
    super({ key: "GameScene" });
  }

  create() {
    this.walls = this.physics.add.staticGroup();
    this.cityMap = this.generateCityMap();
    this.drawCityMap();

    // Building collision bodies — disabled while composing new buildings
    // for (let row = 0; row < this.mapRows; row++) {
    //   for (let col = 0; col < this.mapCols; col++) {
    //     if (this.cityMap[row][col] === TileType.BUILDING) {
    //       const colMod = col % COL_PERIOD;
    //       const rowMod = row % ROW_PERIOD;
    //       const isEdge =
    //         colMod === BLOCK_INTERIOR.colStart || colMod === BLOCK_INTERIOR.colEnd ||
    //         rowMod === BLOCK_INTERIOR.rowStart || rowMod === BLOCK_INTERIOR.rowEnd;
    //       if (!isEdge) continue;
    //       const { x, y } = isoToScreen(col, row);
    //       const zone = this.add.zone(x, y, TILE_W * 0.45, TILE_H * 0.45);
    //       this.physics.add.existing(zone, true);
    //       this.walls.add(zone);
    //     }
    //   }
    // }

    // Spawn player on a street tile
    const spawnCol = 4 + 36;
    const spawnRow = 4;
    const { x: spawnX, y: spawnY } = isoToScreen(spawnCol, spawnRow);

    this.player = this.add.sprite(spawnX, spawnY, "player-south");
    this.player.setScale(1.5);
    this.physics.add.existing(this.player);

    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    playerBody.setSize(16, 8);
    playerBody.setOffset(16, 36);

    this.physics.add.collider(this.player, this.walls);

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

  private drawCityMap() {
    const sidewalkGfx = this.add.graphics();
    sidewalkGfx.setDepth(0.6);
    const sidewalkLines = this.add.graphics();
    sidewalkLines.setDepth(0.7);
    const streetLines = this.add.graphics();
    streetLines.setDepth(0.5);

    // Batch street tile images into a blitter (single draw call)
    const streetBlitter = this.add.blitter(0, 0, "street").setDepth(0);

    // Batch sidewalk tile images into blitters (one per variant, vs ~9500 individual Images)
    const NUM_SIDEWALK_VARIANTS = 8;
    const sidewalkBlitters: Phaser.GameObjects.Blitter[] = [];
    for (let v = 0; v < NUM_SIDEWALK_VARIANTS; v++) {
      sidewalkBlitters.push(
        this.add.blitter(0, 0, `sidewalk-${v}`).setDepth(0.6),
      );
    }

    for (let row = 0; row < this.mapRows; row++) {
      for (let col = 0; col < this.mapCols; col++) {
        const tile = this.cityMap[row][col];

        if (tile === TileType.BUILDING) {
          // Sidewalk ground under buildings (visible through inset gaps)
          const { x, y } = isoToScreen(col, row);
          const v = Math.floor(
            this.hash(col, row, 500) * NUM_SIDEWALK_VARIANTS,
          );
          sidewalkBlitters[v].create(
            x - TILE_W / 2,
            y - CURB_HEIGHT - TILE_H / 2,
          );
        } else if (tile === TileType.STREET) {
          const { x, y } = isoToScreen(col, row);
          streetBlitter.create(x - TILE_W / 2, y - TILE_H / 2);
          renderStreetTile(this, col, row, streetLines);
        } else if (tile === TileType.SIDEWALK) {
          const { x, y } = isoToScreen(col, row);
          const v = Math.floor(
            this.hash(col, row, 500) * NUM_SIDEWALK_VARIANTS,
          );
          sidewalkBlitters[v].create(
            x - TILE_W / 2,
            y - CURB_HEIGHT - TILE_H / 2,
          );
          renderSidewalkTile(this, col, row, sidewalkGfx, sidewalkLines);
        }
      }
    }

    // Buildings, props, and showroom — disabled while composing new buildings
    // for (const building of this.buildings) { ... }
    // this.placeTrafficLights();
    // this.placeSewerGrates();
    // this.placeSteamVents();
    // this.drawShowroom();

    this.placeTestBuildings();
    this.placeParkingMeters();
    this.placeLightPoles();
    this.placeTestCar();
  }

  private placeTestBuildings() {
    const numBlockCols = Math.floor(this.mapCols / COL_PERIOD);
    const numBlockRows = Math.floor(this.mapRows / ROW_PERIOD);
    for (let bCol = 0; bCol < numBlockCols; bCol++) {
      for (let bRow = 0; bRow < numBlockRows; bRow++) {
        this.placeBlockComposites(bCol, bRow);
      }
    }
  }

  /**
   * Place composite buildings on a block.
   * 1. Anchor: SW facade at the SW corner (colEnd, rowEnd)
   * 2. Chain SW facades NW (screen-left) from anchor's SW corner
   * 3. Chain SE buildings SE (screen-right) from anchor's SE corner
   */
  private placeBlockComposites(bCol: number, bRow: number) {
    const TARGET_H = 800;

    const blockColEnd = bCol * COL_PERIOD + BLOCK_INTERIOR.colEnd;
    const blockRowEnd = bRow * ROW_PERIOD + BLOCK_INTERIOR.rowEnd;
    const blockColStart = bCol * COL_PERIOD + BLOCK_INTERIOR.colStart;
    const blockRowStart = bRow * ROW_PERIOD + BLOCK_INTERIOR.rowStart;

    // SW corner of block = bottommost on screen = anchor point
    const startPos = isoToScreen(blockColEnd, blockRowEnd);

    // Corner buildings (show both SE + SW faces): buildings 0, 1, 3, 4
    const CORNERS = [0, 1, 3, 4];
    // Thin facade indices (SW ratio < 0.75): buildings 6-15
    const FACADES = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

    // --- Anchor: corner building at the SW corner, SE-facing (shows both faces) ---
    const anchorSeed = ((bCol * 73856093) ^ (bRow * 19349669)) >>> 0;
    const anchorIdx = CORNERS[anchorSeed % CORNERS.length];
    const anchor = placeCompositeBuilding(this, {
      targetH: TARGET_H,
      x: startPos.x,
      y: startPos.y,
      depth: startPos.y / (TILE_H / 2),
      seed: anchorSeed,
      direction: CompositeDir.SE,
      buildingIdx: anchorIdx,
    });
    // Depth at NE-most ground point so player on sidewalk sorts in front
    anchor.img.setDepth(Math.min(anchor.se.y, anchor.sw.y) / (TILE_H / 2));

    // Neon signs on anchor's SE wall
    const anchorH = anchor.bbox.bottom - anchor.bbox.top;
    const anchorSignFloors = Math.floor((anchorH * 0.65) / STORY_HEIGHT);
    if (anchorSignFloors >= 2) {
      placeNeonSigns(this, {
        seed: anchorSeed,
        id: `comp-anchor-${bCol}-${bRow}`,
        edgeStart: { x: startPos.x, y: startPos.y },
        edgeEnd: anchor.se,
        numFloors: anchorSignFloors,
        floorHeight: STORY_HEIGHT,
        depth: anchor.img.depth,
        buildingIdx: anchor.buildingIdx,
        buildingImages: [anchor.img],
      });
    }

    // --- Chain SW facades NW (screen-left) from anchor's SW corner ---
    const nwLimitX = isoToScreen(blockColStart, blockRowEnd).x;
    let southX = anchor.sw.x;
    let southY = anchor.sw.y;
    let prevIdx: number | undefined = anchor.buildingIdx;

    for (let i = 1; ; i++) {
      const remaining = southX - nwLimitX;
      if (remaining <= 0) break;

      const seed =
        ((bCol * 73856093) ^ (bRow * 19349669) ^ (i * 83492791)) >>> 0;

      let chosenIdx = FACADES[seed % FACADES.length];
      if (chosenIdx === prevIdx)
        chosenIdx = FACADES[(seed + 1) % FACADES.length];
      const advance = getCompositeAdvance(
        this,
        chosenIdx,
        TARGET_H,
        CompositeDir.SW,
        "nw",
      );
      if (advance > remaining) {
        const fitting = pickCompositeFitting(
          this,
          TARGET_H,
          remaining,
          prevIdx,
          CompositeDir.SW,
          "nw",
          FACADES,
        );
        if (fitting === undefined) break;
        chosenIdx = fitting;
      }

      const swPlacedX = southX;
      const swPlacedY = southY;
      const placed = placeCompositeBuilding(this, {
        targetH: TARGET_H,
        x: southX,
        y: southY,
        depth: southY / (TILE_H / 2),
        seed,
        direction: CompositeDir.SW,
        buildingIdx: chosenIdx,
      });
      placed.img.setDepth(placed.sw.y / (TILE_H / 2));

      // Neon signs on SW facade's SE wall
      const swH = placed.bbox.bottom - placed.bbox.top;
      const swSignFloors = Math.floor((swH * 0.65) / STORY_HEIGHT);
      if (swSignFloors >= 2) {
        placeNeonSigns(this, {
          seed,
          id: `comp-sw-${bCol}-${bRow}-${i}`,
          edgeStart: { x: swPlacedX, y: swPlacedY },
          edgeEnd: placed.se,
          numFloors: swSignFloors,
          floorHeight: STORY_HEIGHT,
          depth: placed.img.depth,
          buildingIdx: placed.buildingIdx,
          buildingImages: [placed.img],
        });
      }

      southX = placed.sw.x;
      southY = placed.sw.y;
      prevIdx = placed.buildingIdx;
    }

    // --- Chain SE buildings SE (screen-right) from anchor's SE corner ---
    // The anchor SW building is the first building in the SE chain.
    const seLimitX = isoToScreen(blockColEnd, blockRowStart).x;
    southX = anchor.se.x;
    southY = anchor.se.y;
    prevIdx = anchor.buildingIdx;

    for (let i = 0; ; i++) {
      const remaining = seLimitX - southX;
      if (remaining <= 0) break;

      const seed =
        ((bCol * 73856093) ^ (bRow * 19349669) ^ ((i + 100) * 83492791)) >>> 0;
      // Hash the seed for a uniform 0-1 value
      let h = (seed + 0x6d2b79f5) | 0;
      h = Math.imul(h ^ (h >>> 15), 1 | h);
      h = (h + Math.imul(h ^ (h >>> 7), 61 | h)) ^ h;
      const rng = ((h ^ (h >>> 14)) >>> 0) / 4294967296;

      // ~30% chance of an Asian heritage building
      if (rng < 0.3 && remaining > 450) {
        const asianW = 450;
        const asianAnchorX = southX;
        const asianAnchorY = southY;
        const asianPlaced = placeAsianBuilding(this, {
          targetW: asianW,
          x: southX,
          y: southY,
          depth: southY / (TILE_H / 2),
          seed,
        });
        const asianDepth = asianPlaced.se.y / (TILE_H / 2);
        for (const img of asianPlaced.images) img.setDepth(asianDepth);

        // Neon signs on asian building's SE wall (floors only, not roof, not ground)
        const asianSignFloors = asianPlaced.numFloors - 1;
        if (asianSignFloors >= 2) {
          placeNeonSigns(this, {
            seed,
            id: `asian-${bCol}-${bRow}-${i}`,
            edgeStart: { x: asianAnchorX, y: asianAnchorY },
            edgeEnd: asianPlaced.se,
            numFloors: asianSignFloors,
            floorHeight: STORY_HEIGHT,
            depth: asianDepth,
            buildingImages: asianPlaced.images,
          });
        }

        // Chain from the SE corner of the placed Asian building
        southX = asianPlaced.se.x;
        southY = asianPlaced.se.y;
        prevIdx = undefined;
        continue;
      }

      let chosenIdx = pickComposite(seed, prevIdx);
      const advance = getCompositeAdvance(
        this,
        chosenIdx,
        TARGET_H,
        CompositeDir.SE,
        "se",
      );
      if (advance > remaining) {
        const fitting = pickCompositeFitting(
          this,
          TARGET_H,
          remaining,
          prevIdx,
          CompositeDir.SE,
          "se",
        );
        if (fitting === undefined) break;
        chosenIdx = fitting;
      }

      const sePlacedX = southX;
      const sePlacedY = southY;
      const placed = placeCompositeBuilding(this, {
        targetH: TARGET_H,
        x: southX,
        y: southY,
        depth: southY / (TILE_H / 2),
        seed,
        exclude: prevIdx,
        buildingIdx: chosenIdx,
      });
      placed.img.setDepth(placed.se.y / (TILE_H / 2));

      // Neon signs on SE chain building's SE wall
      const seH = placed.bbox.bottom - placed.bbox.top;
      const seSignFloors = Math.floor((seH * 0.65) / STORY_HEIGHT);
      if (seSignFloors >= 2) {
        placeNeonSigns(this, {
          seed,
          id: `comp-se-${bCol}-${bRow}-${i}`,
          edgeStart: { x: sePlacedX, y: sePlacedY },
          edgeEnd: placed.se,
          numFloors: seSignFloors,
          floorHeight: STORY_HEIGHT,
          depth: placed.img.depth,
          buildingIdx: placed.buildingIdx,
          buildingImages: [placed.img],
        });
      }

      southX = placed.se.x;
      southY = placed.se.y;
      prevIdx = placed.buildingIdx;
    }

    // --- Skyscrapers filling behind the facade rows toward the NE street ---
    const nwOffset = 4; // tiles NW (decreasing col) from SE edge
    const skyCol = blockColEnd - nwOffset;
    const skyRowStart = blockRowStart + 10; // first skyscraper position (SW of NE street)
    const skyRowEnd = blockRowEnd; // behind the SW anchor
    const skyStride = 8; // row spacing between skyscrapers

    for (
      let row = skyRowStart, i = 0;
      row <= skyRowEnd;
      row += skyStride, i++
    ) {
      const skyPos = isoToScreen(skyCol, row);
      const skySeed = ((bCol * 48271) ^ (bRow * 65537) ^ (i * 91573)) >>> 0;
      placeSkyscraper(this, {
        targetH: TARGET_H,
        x: skyPos.x,
        y: skyPos.y,
        depth: skyPos.y / (TILE_H / 2) - BLOCK_INTERIOR.cols,
        buildingIdx: skySeed % 3,
        direction: CompositeDir.SE,
      });
    }
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

        // North edge — skip corners
        for (let col = colMin + OFFSET; col <= colMax; col += SPACING) {
          if (col - colMin < CORNER || colMax - col < CORNER) continue;
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
  private placeTestCar() {
    const TARGET_H = 120;
    const CURB_OFFSET = 2;
    let count = 0;

    const numBlockCols = Math.floor(this.mapCols / COL_PERIOD);
    const numBlockRows = Math.floor(this.mapRows / ROW_PERIOD);

    // Vertical streets (colMod 0-7) — cars parked along NW curb, facing NE
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
