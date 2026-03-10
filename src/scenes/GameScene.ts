import Phaser from "phaser";
import { TILE_W, TILE_H, isoToScreen, screenToIso } from "../iso/IsoGeometry";
import { COL_PERIOD, ROW_PERIOD, STREET_WIDTH, SIDEWALK_WIDTH, BLOCK_INTERIOR, TileType, CURB_HEIGHT } from "../iso/CityLayout";
import { Building, BUILDING_PALETTE } from "../rendering/BuildingTypes";
import { renderBuilding, renderBuildingFootprint, dumpBuildingMetrics } from "../rendering/BuildingRenderer";
import { renderStreetTile, renderSidewalkTile } from "../rendering/StreetRenderer";

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
  private buildingObjects: {
    data: Building;
    objects: Phaser.GameObjects.GameObject[];
    footprint: Phaser.GameObjects.Graphics;
  }[] = [];
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private fpsEl!: HTMLElement | null;
  private neonTexts: Phaser.GameObjects.Image[] = [];

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

    // Building collision bodies — perimeter only (interior unreachable)
    for (let row = 0; row < this.mapRows; row++) {
      for (let col = 0; col < this.mapCols; col++) {
        if (this.cityMap[row][col] === TileType.BUILDING) {
          const colMod = col % COL_PERIOD;
          const rowMod = row % ROW_PERIOD;
          const isEdge =
            colMod === BLOCK_INTERIOR.colStart || colMod === BLOCK_INTERIOR.colEnd ||
            rowMod === BLOCK_INTERIOR.rowStart || rowMod === BLOCK_INTERIOR.rowEnd;
          if (!isEdge) continue;
          const { x, y } = isoToScreen(col, row);
          const zone = this.add.zone(x, y, TILE_W * 0.45, TILE_H * 0.45);
          this.physics.add.existing(zone, true);
          this.walls.add(zone);
        }
      }
    }

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
    this.cameras.main.setZoom(0.75);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setFollowOffset(0, 100);
    this.cameras.main.setDeadzone(40, 40);

    // HUD is rendered as HTML overlay (see index.html) for native resolution
    this.fpsEl = document.getElementById("hud-fps");

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

    // Performance diagnostics
    const totalObjects = this.children.length;
    const totalBodies = this.physics.world.bodies.entries.length
      + this.physics.world.staticBodies.entries.length;
    console.log(`[perf] Game objects: ${totalObjects}, Physics bodies: ${totalBodies}, Buildings: ${this.buildings.length}`);
  }

  update() {
    if (this.fpsEl) this.fpsEl.textContent = `${Math.round(this.game.loop.actualFps)} fps`;

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

      let moveX = inputX;
      let moveY = inputY;
      if (inputX !== 0 && inputY !== 0) {
        moveY = inputY * 0.5;
      }

      const len = Math.sqrt(moveX * moveX + moveY * moveY);
      body.setAcceleration(
        (moveX / len) * accel,
        (moveY / len) * accel
      );

      const prefix = running ? "run" : "walk";
      const animKey = `${prefix}-${this.facing}`;
      if (this.player.anims.currentAnim?.key !== animKey || !this.player.anims.isPlaying) {
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

    // Hide buildings that obstruct the player
    const { col: pCol, row: pRow } = screenToIso(this.player.x, feetY);
    const margin = 24;  // extended for 3-5 story buildings

    for (const entry of this.buildingObjects) {
      const b = entry.data;
      const nearestCol = Math.max(b.colStart, Math.min(b.colEnd, pCol));
      const nearestRow = Math.max(b.rowStart, Math.min(b.rowEnd, pRow));
      const behind = pCol + pRow < nearestCol + nearestRow;
      const withinCol = pCol >= b.colStart - margin && pCol <= b.colEnd;
      const withinRow = pRow >= b.rowStart - margin && pRow <= b.rowEnd;
      const hide = behind && withinCol && withinRow;

      for (const obj of entry.objects) {
        (obj as Phaser.GameObjects.Graphics).setVisible(!hide);
      }
      entry.footprint.setVisible(hide);
    }

    const t = 0.5 + 0.5 * Math.sin(this.time.now * Math.PI / 2000);
    const neonAlpha = 0.6 + 0.4 * t;
    for (const img of this.neonTexts) img.setAlpha(neonAlpha);
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
          const colEdge = colMod < BLOCK_INTERIOR.colStart || colMod > BLOCK_INTERIOR.colEnd;
          const rowEdge = rowMod < BLOCK_INTERIOR.rowStart || rowMod > BLOCK_INTERIOR.rowEnd;

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
          const rowEnd = Math.min(baseRow + rowOffset + depth - 1, this.mapRows - 1);
          // One seed per building, derived from coordinates
          let seed = (baseCol * 374761393 + rowStart * 668265263) | 0;
          seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
          seed = (seed ^ (seed >>> 16)) >>> 0;

          const h = (s: number) => this.hash(baseCol, rowStart, s);

          const stories = 3 + Math.floor(h(1) * 3);
          const color = BUILDING_PALETTE[Math.floor(h(2) * BUILDING_PALETTE.length)];
          const texture = Math.floor(h(3) * 6);
          const inset = 0.1 + h(4) * 2.5;
          const heightOffset = Math.floor(h(5) * 60);
          const doorSide = h(6) < 0.5 ? "left" as const : "right" as const;
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
      const depth = minDepth + Math.floor(this.hash(bCol * 100 + i, bRow, 99) * (maxDepth - minDepth + 1));
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
      sidewalkBlitters.push(this.add.blitter(0, 0, `sidewalk-${v}`).setDepth(0.6));
    }

    for (let row = 0; row < this.mapRows; row++) {
      for (let col = 0; col < this.mapCols; col++) {
        const tile = this.cityMap[row][col];

        if (tile === TileType.BUILDING) {
          // Sidewalk ground under buildings (visible through inset gaps)
          const { x, y } = isoToScreen(col, row);
          const v = Math.floor(this.hash(col, row, 500) * NUM_SIDEWALK_VARIANTS);
          sidewalkBlitters[v].create(x - TILE_W / 2, y - CURB_HEIGHT - TILE_H / 2);

        } else if (tile === TileType.STREET) {
          const { x, y } = isoToScreen(col, row);
          streetBlitter.create(x - TILE_W / 2, y - TILE_H / 2);
          renderStreetTile(this, col, row, streetLines);

        } else if (tile === TileType.SIDEWALK) {
          const { x, y } = isoToScreen(col, row);
          const v = Math.floor(this.hash(col, row, 500) * NUM_SIDEWALK_VARIANTS);
          sidewalkBlitters[v].create(x - TILE_W / 2, y - CURB_HEIGHT - TILE_H / 2);
          renderSidewalkTile(this, col, row, sidewalkGfx, sidewalkLines);
        }
      }
    }

    // Render buildings as 3-shape parallelograms
    for (const building of this.buildings) {
      const objects = renderBuilding(this, building);
      const footprint = renderBuildingFootprint(this, building);
      this.buildingObjects.push({ data: building, objects, footprint });
      for (const obj of objects) {
        if ((obj as any).isNeonText) this.neonTexts.push(obj as Phaser.GameObjects.Image);
      }
    }

    // Diagnostic: dump building/window/door metrics to console
    dumpBuildingMetrics(this, this.buildings);

    this.placeParkedCars();
    this.placeTrafficLights();
    this.placeSewerGrates();
    this.placeSteamVents();
    this.drawShowroom();
  }

  private placeParkedCars() {
    const NUM_CARS = 10;
    const CAR_H = 128; // rendered height
    const numBlockCols = Math.floor(this.mapCols / COL_PERIOD);
    const numBlockRows = Math.floor(this.mapRows / ROW_PERIOD);

    // Park cars along col-axis streets (vertical streets running NW-SE).
    // Lane 1 = near-side parking (next to SW sidewalk), lane 6 = far-side.
    // Cars are SE-facing assets, so they align with col-axis naturally.
    for (let bRow = 0; bRow < numBlockRows; bRow++) {
      for (let bCol = 0; bCol < numBlockCols; bCol++) {
        const streetColStart = bCol * COL_PERIOD;
        const streetRowStart = bRow * ROW_PERIOD + STREET_WIDTH; // skip intersection
        const streetRowEnd = (bRow + 1) * ROW_PERIOD - 1;

        // Decide how many cars on this block segment (0-3)
        const parkCol = streetColStart + 2; // NW side, two tiles from curb

        const segLen = streetRowEnd - streetRowStart - 4;
        const minGap = 12; // minimum tiles between cars
        const maxCars = Math.max(1, Math.floor(segLen / minGap));
        const segHash = this.hash(bCol, bRow, 300);
        const numCars = Math.min(maxCars, 2 + Math.floor(segHash * 4)); // 2-5, capped
        const spacing = Math.floor(segLen / (numCars + 1));
        for (let c = 0; c < numCars; c++) {
          const parkRow = streetRowStart + 2 + spacing * (c + 1);
          const carIdx = Math.floor(this.hash(bCol * 10 + c, bRow, 320) * NUM_CARS);
          const texKey = `car-${carIdx}`;
          const frame = this.textures.getFrame(texKey);
          if (!frame) continue;

          const scale = CAR_H / frame.height;
          const pos = isoToScreen(parkCol, parkRow);
          const img = this.add.image(pos.x, pos.y, texKey);
          img.setOrigin(0.5, 1).setScale(scale).setDepth(parkCol + parkRow + 0.4);

          // Collision: zones along car's visual footprint
          // Car sprites are asymmetric — visual center is offset from anchor.
          // Shift zones along -row direction (screen right+up) to match.
          const renderedW = frame.width * scale;
          const renderedH = frame.height * scale;
          const cx = pos.x + renderedW * 0.1;  // slight right offset
          const cy = pos.y - renderedH * 0.5;  // vertical center of car
          for (let t = -2; t <= 2; t++) {
            // Step along slope -0.5 (the car's iso axis)
            const step = renderedW / 5;
            const zx = cx + t * step;
            const zy = cy - t * step * 0.5;
            const zw = step * 1.1, zh = renderedH * 0.7;
            const southPad = renderedH * 0.4;
            const zone = this.add.zone(zx, zy + southPad / 2, zw, zh + southPad);
            this.physics.add.existing(zone, true);
            this.walls.add(zone);
          }
        }

        // Also park along row-axis streets (horizontal, running NE-SW).
        // These need flipX since the street runs the other direction.
        const hStreetRowStart2 = bRow * ROW_PERIOD;
        const hStreetColStart2 = bCol * COL_PERIOD + STREET_WIDTH;
        const hStreetColEnd2 = (bCol + 1) * COL_PERIOD - 1;

        const hParkRow = hStreetRowStart2 + 2; // NW side, two tiles from curb

        const hSegLen = hStreetColEnd2 - hStreetColStart2 - 4;
        const hMaxCars = Math.max(1, Math.floor(hSegLen / minGap));
        const hSegHash = this.hash(bCol, bRow, 330);
        const hNumCars = Math.min(hMaxCars, 2 + Math.floor(hSegHash * 4));
        const hSpacing = Math.floor(hSegLen / (hNumCars + 1));
        for (let c = 0; c < hNumCars; c++) {
          const hParkCol = hStreetColStart2 + 2 + hSpacing * (c + 1);
          const carIdx = Math.floor(this.hash(bCol, bRow * 10 + c, 350) * NUM_CARS);
          const texKey = `car-${carIdx}`;
          const frame = this.textures.getFrame(texKey);
          if (!frame) continue;

          const scale = CAR_H / frame.height;
          const pos = isoToScreen(hParkCol, hParkRow);
          const img = this.add.image(pos.x, pos.y, texKey);
          img.setOrigin(0.5, 1).setScale(scale).setFlipX(true).setDepth(hParkCol + hParkRow + 0.4);

          const hRenderedW = frame.width * scale;
          const hRenderedH = frame.height * scale;
          const hcx = pos.x - hRenderedW * 0.1;
          const hcy = pos.y - hRenderedH * 0.5;
          for (let t = -2; t <= 2; t++) {
            const step = hRenderedW / 5;
            // Flipped cars: slope is +0.5
            const zx = hcx + t * step;
            const zy = hcy + t * step * 0.5;
            const zw = step * 1.1, zh = hRenderedH * 0.7;
            const southPad = hRenderedH * 0.4;
            const zone = this.add.zone(zx, zy + southPad / 2, zw, zh + southPad);
            this.physics.add.existing(zone, true);
            this.walls.add(zone);
          }
        }
      }
    }
  }

  private placeTrafficLights() {
    const TRAFFIC_LIGHT_H = 140;
    const texKey = "traffic-light-2";
    const frame = this.textures.getFrame(texKey);
    if (!frame) return;
    const scale = TRAFFIC_LIGHT_H / frame.height;

    const numBlockCols = Math.floor(this.mapCols / COL_PERIOD);
    const numBlockRows = Math.floor(this.mapRows / ROW_PERIOD);

    for (let bRow = 0; bRow <= numBlockRows; bRow++) {
      for (let bCol = 0; bCol <= numBlockCols; bCol++) {
        const streetColStart = bCol * COL_PERIOD;
        const streetRowStart = bRow * ROW_PERIOD;
        const streetColEnd = streetColStart + STREET_WIDTH - 1;
        const streetRowEnd = streetRowStart + STREET_WIDTH - 1;

        const corners = [
          { col: streetColEnd + 1, row: streetRowEnd + 1, flip: false },
          { col: streetColStart - 1, row: streetRowEnd + 1, flip: true },
          { col: streetColEnd + 1, row: streetRowStart - 1, flip: true },
          { col: streetColStart - 1, row: streetRowStart - 1, flip: false },
        ];

        for (const c of corners) {
          if (c.col < 0 || c.col >= this.mapCols || c.row < 0 || c.row >= this.mapRows) continue;

          const pos = isoToScreen(c.col, c.row);
          const img = this.add.image(pos.x, pos.y, texKey);
          img.setOrigin(0.5, 1).setScale(scale);
          if (c.flip) img.setFlipX(true);
          img.setDepth(c.col + c.row + 0.5);
        }
      }
    }
  }

  private placeSewerGrates() {
    const NUM_GRATES = 10;
    const GRATE_W = 48; // rendered width in pixels
    const numBlockCols = Math.floor(this.mapCols / COL_PERIOD);
    const numBlockRows = Math.floor(this.mapRows / ROW_PERIOD);

    // Place one grate per street segment between intersections
    for (let bRow = 0; bRow < numBlockRows; bRow++) {
      for (let bCol = 0; bCol < numBlockCols; bCol++) {
        // Horizontal street segment (runs along cols, within row street band)
        const hStreetRowStart = bRow * ROW_PERIOD;
        const hStreetColStart = bCol * COL_PERIOD + STREET_WIDTH;
        const hStreetColEnd = (bCol + 1) * COL_PERIOD - 1;

        const h1 = this.hash(bCol, bRow, 200);
        const hCol = hStreetColStart + Math.floor(h1 * (hStreetColEnd - hStreetColStart - 2)) + 1;
        // Avoid center line (rowMod === 4 for horizontal streets)
        const centerLine = Math.floor(STREET_WIDTH / 2); // 4
        const hLanes = [];
        for (let l = 1; l < STREET_WIDTH - 1; l++) {
          if (l !== centerLine) hLanes.push(l);
        }
        const h2 = this.hash(bCol, bRow, 201);
        const hRow = hStreetRowStart + hLanes[Math.floor(h2 * hLanes.length)];
        const hTex = 4; // standardized on s4

        const hPos = isoToScreen(hCol, hRow);
        const frame = this.textures.getFrame(`sewer-grate-${hTex}`);
        if (frame) {
          const scale = GRATE_W / frame.width;
          const img = this.add.image(hPos.x, hPos.y, `sewer-grate-${hTex}`);
          img.setOrigin(0.5, 0.5).setScale(scale).setDepth(0.4);
          // Slight depth above street tiles
        }

        // Vertical street segment (runs along rows, within col street band)
        const vStreetColStart = bCol * COL_PERIOD;
        const vStreetRowStart = bRow * ROW_PERIOD + STREET_WIDTH;
        const vStreetRowEnd = (bRow + 1) * ROW_PERIOD - 1;

        const v1 = this.hash(bCol, bRow, 210);
        const vRow = vStreetRowStart + Math.floor(v1 * (vStreetRowEnd - vStreetRowStart - 2)) + 1;
        // Avoid center line (colMod === 4 for vertical streets)
        const vLanes = [];
        for (let l = 1; l < STREET_WIDTH - 1; l++) {
          if (l !== centerLine) vLanes.push(l);
        }
        const v2 = this.hash(bCol, bRow, 211);
        const vCol = vStreetColStart + vLanes[Math.floor(v2 * vLanes.length)];
        const vTex = 4; // standardized on s4

        const vPos = isoToScreen(vCol, vRow);
        const vFrame = this.textures.getFrame(`sewer-grate-${vTex}`);
        if (vFrame) {
          const vScale = GRATE_W / vFrame.width;
          const vImg = this.add.image(vPos.x, vPos.y, `sewer-grate-${vTex}`);
          vImg.setOrigin(0.5, 0.5).setScale(vScale).setDepth(0.4);
        }
      }
    }
  }

  private placeSteamVents() {
    const VENT_H = 32;
    const texKey = "steam-vent-0";
    const frame = this.textures.getFrame(texKey);
    if (!frame) return;
    const scale = VENT_H / frame.height;

    const numBlockCols = Math.floor(this.mapCols / COL_PERIOD);
    const numBlockRows = Math.floor(this.mapRows / ROW_PERIOD);

    // One vent per street segment, on the road flush against sidewalk, near the intersection
    for (let bRow = 0; bRow < numBlockRows; bRow++) {
      for (let bCol = 0; bCol < numBlockCols; bCol++) {
        const baseCol = bCol * COL_PERIOD;
        const baseRow = bRow * ROW_PERIOD;

        // Horizontal street: flush against north sidewalk, a bit past intersection
        const hCol = baseCol + STREET_WIDTH + 5;
        const hRow = baseRow + STREET_WIDTH - 1;
        if (hCol < this.mapCols && hRow < this.mapRows) {
          const pos = isoToScreen(hCol, hRow);
          const img = this.add.image(pos.x, pos.y, texKey);
          img.setOrigin(0.5, 1).setScale(scale).setDepth(0.4);
        }

        // Vertical street: flush against west sidewalk, a bit past intersection
        const vCol = baseCol + STREET_WIDTH - 1;
        const vRow = baseRow + STREET_WIDTH + 5;
        if (vCol < this.mapCols && vRow < this.mapRows) {
          const pos = isoToScreen(vCol, vRow);
          const img = this.add.image(pos.x, pos.y, texKey);
          img.setOrigin(0.5, 1).setScale(scale).setDepth(0.4);
        }
      }
    }
  }

  private drawShowroom() {
    const dpr = window.devicePixelRatio || 1;

    const sections = [
      { label: "METAL DOOR", prefix: "metal-door", count: 14, targetH: 128 },
      { label: "WINDOWS", prefix: "window", count: 12, targetH: 96 },
      { label: "GARBAGE BIN", prefix: "garbage-bin", count: 6, targetH: 64 },
      { label: "VENDING MACH", prefix: "vending-machine", count: 9, targetH: 96 },
      { label: "GARAGE DOOR", prefix: "garage-door", count: 7, targetH: 128 },
      { label: "ELEC BOX", prefix: "elec-box", count: 1, targetH: 96 },
      { label: "WALL VENT", prefix: "wall-vent", count: 3, targetH: 80 },
      { label: "NEON NOODLE", prefix: "neon-noodle-sign", count: 10, targetH: 96 },
      { label: "NEON DRAGON", prefix: "neon-dragon-sign", count: 10, targetH: 96 },
      { label: "CAR", prefix: "car", count: 10, targetH: 160 },
    ];

    // Each section gets its own lane — adjacent walls going NW (incrementing col)
    const baseCol = 1;
    const colSpacing = 8;       // columns between each lane
    const rStart = -2;          // start just outside the city edge
    const baseSlotsPerItem = 3; // row-tiles per asset slot at baseline targetH (96)
    const wallHeight = 200;

    for (let lane = 0; lane < sections.length; lane++) {
      const sec = sections[lane];
      const laneCol = baseCol + lane * colSpacing;
      const slotsPerItem = Math.ceil(baseSlotsPerItem * sec.targetH / 64);
      const rEnd = rStart - sec.count * slotsPerItem; // extend NW (negative rows)

      // Wall backdrop for this lane (rEnd < rStart, wall extends NW)
      const lE = isoToScreen(laneCol, rEnd);    // NE end (far NW)
      const lS = isoToScreen(laneCol, rStart);   // SW end (near city)
      const laneDepth = laneCol + Math.abs(rStart) + 1;

      const gfx = this.add.graphics();
      gfx.setDepth(laneDepth);
      gfx.fillStyle(0x2a2a35, 1);
      gfx.fillPoints([
        new Phaser.Geom.Point(lE.x, lE.y),
        new Phaser.Geom.Point(lS.x, lS.y),
        new Phaser.Geom.Point(lS.x, lS.y - wallHeight),
        new Phaser.Geom.Point(lE.x, lE.y - wallHeight),
      ], true);

      // Section label — at the SW end (opposite end from assets)
      const labelX = lS.x;
      const labelY = lS.y - wallHeight - 8;
      this.add.text(labelX, labelY, sec.label, {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: "14px",
        color: "#00ffff",
        fontStyle: "bold",
      }).setOrigin(0, 1).setResolution(dpr).setDepth(laneDepth + 0.2);

      // Place each asset along the lane
      for (let i = 0; i < sec.count; i++) {
        const t = (i + 0.5) / sec.count;
        const ax = lS.x + t * (lE.x - lS.x);
        const ay = lS.y + t * (lE.y - lS.y);

        const texKey = `${sec.prefix}-${i}`;
        const frame = this.textures.getFrame(texKey);
        if (!frame) continue;

        const scale = sec.targetH / frame.height;
        const img = this.add.image(ax, ay - 10, texKey);
        img.setOrigin(0.5, 1).setScale(scale);
        img.setDepth(laneDepth + 0.1);

        // Index label under each asset
        this.add.text(ax, ay - 10 - sec.targetH - 4, `${i}`, {
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: "18px",
          color: "#00ffff",
          fontStyle: "bold",
        }).setOrigin(0.5, 1).setResolution(dpr).setDepth(laneDepth + 0.2);
      }
    }
  }
}
