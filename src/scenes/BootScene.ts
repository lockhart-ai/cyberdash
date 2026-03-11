import Phaser from "phaser";
import { ASSET_CATALOG } from "../config/assetCatalog";
import { trimCompositeBuildings, trimSkyscrapers } from "../rendering/CompositeBuilding";

export const DIRECTIONS = [
  "south",
  "south-west",
  "west",
  "north-west",
  "north",
  "north-east",
  "east",
  "south-east",
] as const;

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload() {
    for (const dir of DIRECTIONS) {
      this.load.image(`player-${dir}`, `assets/sprites/player/${dir}.png`);
      this.load.spritesheet(`walk-${dir}`, `assets/sprites/player/walk-${dir}.png`, {
        frameWidth: 64,
        frameHeight: 64,
      });
      this.load.spritesheet(`run-${dir}`, `assets/sprites/player/run-${dir}.png`, {
        frameWidth: 64,
        frameHeight: 64,
      });
    }

    // Street & sidewalk tiles
    this.load.image("street", "assets/tilemaps/street_0.png");
    for (let i = 0; i < 8; i++) {
      this.load.image(`sidewalk-${i}`, `assets/tilemaps/sidewalk_${i}.png`);
    }

    // Building wall textures
    for (let v = 0; v < 6; v++) {
      this.load.image(`bldg-top-v${v}`, `assets/tilemaps/bldg_top_v${v}.png`);
      for (const s of [2, 3, 4]) {
        this.load.image(`wall-left-v${v}-${s}s`, `assets/tilemaps/wall_left_v${v}_${s}s.png`);
        this.load.image(`wall-right-v${v}-${s}s`, `assets/tilemaps/wall_right_v${v}_${s}s.png`);
      }
    }

    // Asset pack catalog (for showroom)
    for (const section of ASSET_CATALOG) {
      for (const entry of section.entries) {
        this.load.image(entry.key, entry.path);
      }
    }

    // SciFi Buildings — all 3236px-wide strips (4 rotations, 809px per frame)
    const CPB = "asset_packs/Isometric Cyberpunk Buildings/Isometric Cyberpunk Buildings/Building";
    const cpbModules: { key: string; file: string; h: number }[] = [
      // ── Bases (10) ──
      { key: "cpb-base-10",  file: "SciFi_Buildings-10-Base_A.png",     h: 609 },
      { key: "cpb-base-11",  file: "SciFi_Buildings-11-Base_A-2.png",   h: 609 },
      { key: "cpb-base-12",  file: "SciFi_Buildings-12-Base_A-3.png",   h: 609 },
      { key: "cpb-base-18",  file: "SciFi_Buildings-18-Base_B.png",     h: 609 },
      { key: "cpb-base-19",  file: "SciFi_Buildings-19-Base_B-1.png",   h: 609 },
      { key: "cpb-base-69",  file: "SciFi_Buildings-69-Base_Back.png",  h: 609 },
      { key: "cpb-base-70",  file: "SciFi_Buildings-70-Base_Front.png", h: 609 },
      { key: "cpb-base-73",  file: "SciFi_Buildings-73-Base_B.png",     h: 509 },
      { key: "cpb-base-115", file: "SciFi_Buildings-115-Base_B.png",    h: 609 },
      { key: "cpb-base-117", file: "SciFi_Buildings-117-Base_A.png",    h: 609 },
      // ── Walls (43) ──
      { key: "cpb-wall-5",   file: "SciFi_Buildings-5-Building_D.png",       h: 609 },
      { key: "cpb-wall-6",   file: "SciFi_Buildings-6-Building_D-4.png",     h: 609 },
      { key: "cpb-wall-7",   file: "SciFi_Buildings-7-Building_C.png",       h: 609 },
      { key: "cpb-wall-8",   file: "SciFi_Buildings-8-Building_C-7.png",     h: 609 },
      { key: "cpb-wall-9",   file: "SciFi_Buildings-9-Building_E.png",       h: 609 },
      { key: "cpb-wall-15",  file: "SciFi_Buildings-15-Building_B.png",      h: 609 },
      { key: "cpb-wall-16",  file: "SciFi_Buildings-16-Building_B-1.png",    h: 609 },
      { key: "cpb-wall-17",  file: "SciFi_Buildings-17-Building_A.png",      h: 609 },
      { key: "cpb-wall-29",  file: "SciFi_Buildings-29-Building_B_Panel.png", h: 609 },
      { key: "cpb-wall-30",  file: "SciFi_Buildings-30-Building_A.png",      h: 489 },
      { key: "cpb-wall-31",  file: "SciFi_Buildings-31-Building_C_Panel.png", h: 569 },
      { key: "cpb-wall-35",  file: "SciFi_Buildings-35-Building_D.png",      h: 609 },
      { key: "cpb-wall-36",  file: "SciFi_Buildings-36-Building_D_Panel.png", h: 609 },
      { key: "cpb-wall-37",  file: "SciFi_Buildings-37-Building_B-1.png",    h: 609 },
      { key: "cpb-wall-41",  file: "SciFi_Buildings-41-Building_C.png",      h: 609 },
      { key: "cpb-wall-42",  file: "SciFi_Buildings-42-Building_B.png",      h: 609 },
      { key: "cpb-wall-43",  file: "SciFi_Buildings-43-Building_A.png",      h: 489 },
      { key: "cpb-wall-65",  file: "SciFi_Buildings-65-Building_G.png",      h: 609 },
      { key: "cpb-wall-66",  file: "SciFi_Buildings-66-Building_F.png",      h: 609 },
      { key: "cpb-wall-67",  file: "SciFi_Buildings-67-Building_F-1.png",    h: 609 },
      { key: "cpb-wall-72",  file: "SciFi_Buildings-72-Building_E.png",      h: 609 },
      { key: "cpb-wall-82",  file: "SciFi_Buildings-82-Building_D.png",      h: 609 },
      { key: "cpb-wall-83",  file: "SciFi_Buildings-83-Building_E.png",      h: 609 },
      { key: "cpb-wall-84",  file: "SciFi_Buildings-84-Building_E-3.png",    h: 609 },
      { key: "cpb-wall-85",  file: "SciFi_Buildings-85-Building_A.png",      h: 609 },
      { key: "cpb-wall-86",  file: "SciFi_Buildings-86-Building_C.png",      h: 609 },
      { key: "cpb-wall-87",  file: "SciFi_Buildings-87-Building_B.png",      h: 609 },
      { key: "cpb-wall-93",  file: "SciFi_Buildings-93-Building_C.png",      h: 609 },
      { key: "cpb-wall-95",  file: "SciFi_Buildings-95-Building_B.png",      h: 609 },
      { key: "cpb-wall-96",  file: "SciFi_Buildings-96-Building_A.png",      h: 609 },
      { key: "cpb-wall-97",  file: "SciFi_Buildings-97-Building_A-1.png",    h: 609 },
      { key: "cpb-wall-98",  file: "SciFi_Buildings-98-Building_A-2.png",    h: 609 },
      { key: "cpb-wall-99",  file: "SciFi_Buildings-99-Building_D.png",      h: 609 },
      { key: "cpb-wall-100", file: "SciFi_Buildings-100-Building_D-1.png",   h: 609 },
      { key: "cpb-wall-105", file: "SciFi_Buildings-105-Building_D-1.png",   h: 609 },
      { key: "cpb-wall-106", file: "SciFi_Buildings-106-Building_D-7.png",   h: 609 },
      { key: "cpb-wall-107", file: "SciFi_Buildings-107-Building_F.png",     h: 609 },
      { key: "cpb-wall-108", file: "SciFi_Buildings-108-Building_F-6.png",   h: 609 },
      { key: "cpb-wall-109", file: "SciFi_Buildings-109-Building_E.png",     h: 609 },
      { key: "cpb-wall-110", file: "SciFi_Buildings-110-Building_C.png",     h: 609 },
      { key: "cpb-wall-111", file: "SciFi_Buildings-111-Building_C-1.png",   h: 609 },
      { key: "cpb-wall-112", file: "SciFi_Buildings-112-Building_B.png",     h: 609 },
      { key: "cpb-wall-113", file: "SciFi_Buildings-113-Building_B-2.png",   h: 609 },
      { key: "cpb-wall-114", file: "SciFi_Buildings-114-Building_A.png",     h: 609 },
      // ── Roofs (11) ──
      { key: "cpb-roof-2",   file: "SciFi_Buildings-2-Rooftop_Short.png",  h: 521 },
      { key: "cpb-roof-3",   file: "SciFi_Buildings-3-Rooftop_Tall.png",   h: 609 },
      { key: "cpb-roof-26",  file: "SciFi_Buildings-26-Rooftop_B.png",     h: 465 },
      { key: "cpb-roof-33",  file: "SciFi_Buildings-33-Rooftop_A.png",     h: 473 },
      { key: "cpb-roof-34",  file: "SciFi_Buildings-34-Rooftop_A-1.png",   h: 473 },
      { key: "cpb-roof-38",  file: "SciFi_Buildings-38-Rooftop.png",       h: 473 },
      { key: "cpb-roof-39",  file: "SciFi_Buildings-39-Rooftop-1.png",     h: 473 },
      { key: "cpb-roof-75",  file: "SciFi_Buildings-75-Rooftop.png",       h: 473 },
      { key: "cpb-roof-77",  file: "SciFi_Buildings-77-Roof_Flat.png",     h: 609 },
      { key: "cpb-roof-104", file: "SciFi_Buildings-104-Rooftop_B-1.png",  h: 609 },
      { key: "cpb-roof-116", file: "SciFi_Buildings-116-Rooftop_A-1.png",  h: 609 },
    ];
    for (const m of cpbModules) {
      this.load.spritesheet(m.key, `${CPB}/${m.file}`, {
        frameWidth: 809,
        frameHeight: m.h,
      });
    }

    // Cyberpunk City Skyscrapers (BuildingModules) — 4 rotations per strip
    const CPC_SKY = "asset_packs/Isometric Cyberpunk City/BuildingModules";
    const skyBuildings = [
      { key: "sky-0", file: "Building.png" },
      { key: "sky-1", file: "Building1.png" },
      { key: "sky-2", file: "Building3.png" },
    ];
    for (const s of skyBuildings) {
      this.load.spritesheet(s.key, `${CPC_SKY}/${s.file}`, {
        frameWidth: 249,
        frameHeight: 633,
      });
    }

    // Cyberpunk City Composite Buildings — 4 rotations per strip (SE, NE, NW, SW)
    const CPC = "asset_packs/Isometric Cyberpunk City/CompositeBuildings";
    const cpcBuildings: { key: string; file: string; fw: number; h: number }[] = [
      { key: "cpc-comp-0",  file: "CompositeBuilding.png",   fw: 657, h: 705 },
      { key: "cpc-comp-1",  file: "CompositeBuilding1.png",  fw: 769, h: 797 },
      { key: "cpc-comp-2",  file: "CompositeBuilding2.png",  fw: 489, h: 645 },
      { key: "cpc-comp-3",  file: "CompositeBuilding3.png",  fw: 729, h: 741 },
      { key: "cpc-comp-4",  file: "CompositeBuilding4.png",  fw: 765, h: 731 },
      { key: "cpc-comp-5",  file: "CompositeBuilding5.png",  fw: 517, h: 531 },
      { key: "cpc-comp-6",  file: "CompositeBuilding6.png",  fw: 281, h: 533 },
      { key: "cpc-comp-7",  file: "CompositeBuilding7.png",  fw: 377, h: 689 },
      { key: "cpc-comp-8",  file: "CompositeBuilding8.png",  fw: 249, h: 529 },
      { key: "cpc-comp-9",  file: "CompositeBuilding9.png",  fw: 409, h: 833 },
      { key: "cpc-comp-10", file: "CompositeBuilding10.png", fw: 277, h: 387 },
      { key: "cpc-comp-11", file: "CompositeBuilding11.png", fw: 269, h: 539 },
      { key: "cpc-comp-12", file: "CompositeBuilding12.png", fw: 297, h: 441 },
      { key: "cpc-comp-13", file: "CompositeBuilding13.png", fw: 405, h: 667 },
      { key: "cpc-comp-14", file: "CompositeBuilding14.png", fw: 277, h: 543 },
      { key: "cpc-comp-15", file: "CompositeBuilding15.png", fw: 309, h: 503 },
    ];
    for (const b of cpcBuildings) {
      this.load.spritesheet(b.key, `${CPC}/${b.file}`, {
        frameWidth: b.fw,
        frameHeight: b.h,
      });
    }
  }

  create() {
    for (const dir of DIRECTIONS) {
      this.anims.create({
        key: `walk-${dir}`,
        frames: this.anims.generateFrameNumbers(`walk-${dir}`, { start: 0, end: 5 }),
        frameRate: 10,
        repeat: -1,
      });

      this.anims.create({
        key: `run-${dir}`,
        frames: this.anims.generateFrameNumbers(`run-${dir}`, { start: 0, end: 7 }),
        frameRate: 14,
        repeat: -1,
      });
    }

    trimCompositeBuildings(this);
    trimSkyscrapers(this);
    this.generatePlaceholders();
    this.scene.start("GameScene");
  }

  private generatePlaceholders() {
    const rect = (key: string, w: number, h: number, color: number) => {
      const gfx = this.add.graphics();
      gfx.fillStyle(color, 1);
      gfx.fillRect(0, 0, w, h);
      gfx.generateTexture(key, w, h);
      gfx.destroy();
    };

    // --- Doors (orange/brown) ---
    for (let d = 0; d < 6; d++) rect(`door-${d}`, 64, 128, 0xcc6633);
    for (let c = 0; c < 10; c++) rect(`door-candidate-${c}`, 64, 128, 0xcc6633);
    for (let i = 0; i < 14; i++) rect(`metal-door-${i}`, 64, 128, 0xcc6633);
    for (let i = 0; i < 6; i++) rect(`glass-door-${i}`, 64, 128, 0x66aacc);
    for (let i = 0; i < 9; i++) rect(`barred-door-${i}`, 64, 128, 0x996633);
    for (let i = 0; i < 9; i++) rect(`glass-barred-door-${i}`, 64, 128, 0x669999);
    for (let i = 0; i < 7; i++) rect(`garage-door-${i}`, 128, 128, 0x8b4513);

    // --- Windows (blue) ---
    for (let w = 0; w < 12; w++) rect(`window-${w}`, 64, 64, 0x3399ff);
    for (let i = 0; i < 14; i++) rect(`barred-window-${i}`, 64, 64, 0x336699);
    for (let i = 0; i < 6; i++) rect(`glass-window-${i}`, 64, 64, 0x66ccff);

    // --- Wall features ---
    rect("elec-box-0", 48, 48, 0xcccc33);                            // yellow
    for (let i = 0; i < 3; i++) rect(`wall-vent-${i}`, 48, 48, 0x888899); // gray
    rect("wall-pipe-0", 24, 64, 0x777788);                           // gray

    // --- Street props ---
    for (let i = 0; i < 8; i++) rect(`traffic-light-${i}`, 32, 128, 0xffcc00);  // yellow
    for (let i = 0; i < 10; i++) rect(`sewer-grate-${i}`, 48, 24, 0x444455);    // dark gray
    for (let i = 0; i < 10; i++) rect(`steam-vent-${i}`, 32, 32, 0xaabbcc);     // light gray

    // --- Street furniture ---
    for (let i = 0; i < 6; i++) rect(`garbage-bin-${i}`, 32, 48, 0x666677);     // gray
    for (let i = 0; i < 9; i++) rect(`vending-machine-${i}`, 48, 96, 0x33cc66); // green
    for (let i = 0; i < 10; i++) rect(`fire-hydrant-${i}`, 24, 48, 0xff3333);   // red
    for (let i = 0; i < 10; i++) rect(`street-lamp-${i}`, 16, 128, 0xffff66);   // yellow
    for (let i = 0; i < 10; i++) rect(`dumpster-${i}`, 64, 48, 0x336633);       // dark green

    // --- Loose clutter ---
    for (let i = 0; i < 10; i++) rect(`garbage-${i}`, 32, 32, 0x555544);        // olive
    for (let i = 0; i < 10; i++) rect(`debris-${i}`, 32, 32, 0x665544);         // brown
    for (let i = 0; i < 10; i++) rect(`boxes-${i}`, 32, 32, 0x886633);          // tan
    for (let i = 0; i < 10; i++) rect(`scraps-${i}`, 32, 32, 0x556655);         // green-gray

    // --- Neon signs ---
    for (let i = 0; i < 10; i++) rect(`neon-noodle-sign-${i}`, 48, 48, 0xff00ff); // magenta
    for (let i = 0; i < 10; i++) rect(`neon-dragon-sign-${i}`, 48, 48, 0xff6600); // orange


  }
}
