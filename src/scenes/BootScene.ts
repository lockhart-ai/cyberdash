import Phaser from "phaser";
import { trimCompositeBuildings, trimSkyscrapers } from "../rendering/CompositeBuilding";
import { trimAsianModules } from "../rendering/BuildingAsian";
import { trimBillboards } from "../rendering/BillboardTrim";

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
      this.load.image(`player-${dir}`, `assets/player/${dir}.png`);
      this.load.spritesheet(`walk-${dir}`, `assets/player/walk-${dir}.png`, {
        frameWidth: 64,
        frameHeight: 64,
      });
      this.load.spritesheet(`run-${dir}`, `assets/player/run-${dir}.png`, {
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
      for (const s of [2, 3, 4]) {
        this.load.image(`wall-left-v${v}-${s}s`, `assets/tilemaps/wall_left_v${v}_${s}s.png`);
        this.load.image(`wall-right-v${v}-${s}s`, `assets/tilemaps/wall_right_v${v}_${s}s.png`);
      }
    }

    // Traditional Asian City — stackable building modules (4 rotations per strip, SE=0)
    const TAC = "assets/buildings/asian";
    const tacModules: { key: string; file: string; fw: number; h: number }[] = [
      // Floors
      { key: "tac-65", file: "Traditional Asian City-65-Building_A_Floor_A.png", fw: 873, h: 641 },
      { key: "tac-57", file: "Traditional Asian City-57-Building_B_floor_A.png", fw: 873, h: 641 },
      { key: "tac-59", file: "Traditional Asian City-59-Building_B_floor_C.png", fw: 873, h: 645 },
      { key: "tac-61", file: "Traditional Asian City-61-Building_B_floor_D.png", fw: 897, h: 665 },
      { key: "tac-53", file: "Traditional Asian City-53-Building_E_floor_A.png", fw: 925, h: 695 },
      { key: "tac-54", file: "Traditional Asian City-54-Building_E_floor_B.png", fw: 865, h: 637 },
      { key: "tac-49", file: "Traditional Asian City-49-Building_F_floor_A.png", fw: 873, h: 641 },
      { key: "tac-31", file: "Traditional Asian City-31-Building_O_floor_A.png", fw: 873, h: 641 },
      { key: "tac-30", file: "Traditional Asian City-30-Building_O_floor_B.png", fw: 873, h: 649 },
      { key: "tac-29", file: "Traditional Asian City-29-Building_O_floor_C.png", fw: 873, h: 645 },
      { key: "tac-28", file: "Traditional Asian City-28-Building_O_floor_D.png", fw: 869, h: 647 },
      { key: "tac-21", file: "Traditional Asian City-21-Building_P_floor_A.png", fw: 873, h: 645 },
      { key: "tac-23", file: "Traditional Asian City-23-Building_P_floor_B.png", fw: 869, h: 639 },
      // Roofs
      { key: "tac-62", file: "Traditional Asian City-62-Building_A_roof_A.png",  fw: 1001, h: 669 },
      { key: "tac-56", file: "Traditional Asian City-56-Building_B_roof_A.png",  fw: 985, h: 945 },
      { key: "tac-58", file: "Traditional Asian City-58-Building_B_roof_C.png",  fw: 1145, h: 673 },
      { key: "tac-60", file: "Traditional Asian City-60-Building_B_roof_D.png",  fw: 1145, h: 673 },
      { key: "tac-52", file: "Traditional Asian City-52-Building_E_roof_A.png",  fw: 1021, h: 779 },
      { key: "tac-48", file: "Traditional Asian City-48-Building_F_roof_A.png",  fw: 1049, h: 785 },
      { key: "tac-26", file: "Traditional Asian City-26-Building_O_roof_A.png",  fw: 985, h: 949 },
      { key: "tac-25", file: "Traditional Asian City-25-Building_O_roof_D.png",  fw: 1145, h: 673 },
      { key: "tac-20", file: "Traditional Asian City-20-Building_P_roof_A.png",  fw: 985, h: 757 },
      { key: "tac-22", file: "Traditional Asian City-22-Building_P_roof_B.png",  fw: 1145, h: 673 },
    ];
    for (const m of tacModules) {
      const sub = m.file.includes("_roof_") ? "roofs" : "floors";
      this.load.spritesheet(m.key, `${TAC}/${sub}/${m.file}`, {
        frameWidth: m.fw,
        frameHeight: m.h,
      });
    }

    // Cyberpunk City Skyscrapers (BuildingModules) — 4 rotations per strip
    const CPC_SKY = "assets/buildings/city/skyscrapers";
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
    const CPC = "assets/buildings/city/composites";
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

    // Billboard signs from Cyberpunk Streets — 4 rotations per strip (SE=0, NE=1, NW=2, SW=3)
    const BB = "assets/sprites/billboards";
    const billboards: { key: string; file: string; fw: number; h: number }[] = [
      { key: "bb-0",  file: "Cyberpunk Streets-18-Billboard_TVCity-4.png",          fw: 253, h: 251 },
      { key: "bb-1",  file: "Cyberpunk Streets-19-Billboard_TVCity-0.png",          fw: 61,  h: 71 },
      { key: "bb-2",  file: "Cyberpunk Streets-20-Billboard_Smoke-0.png",           fw: 261, h: 295 },
      { key: "bb-3",  file: "Cyberpunk Streets-21-Billboard_Sachio-3.png",          fw: 105, h: 217 },
      { key: "bb-4",  file: "Cyberpunk Streets-22-Billboard_Sachio-1.png",          fw: 105, h: 217 },
      { key: "bb-5",  file: "Cyberpunk Streets-23-Billboard_Ring-0.png",            fw: 149, h: 279 },
      { key: "bb-6",  file: "Cyberpunk Streets-24-Billboard_RedCrime-0.png",        fw: 233, h: 681 },
      { key: "bb-7",  file: "Cyberpunk Streets-240-Billboard_Sexy.png",             fw: 257, h: 361 },
      { key: "bb-8",  file: "Cyberpunk Streets-241-Billboard_Sexy_frame.png",       fw: 289, h: 417 },
      { key: "bb-9",  file: "Cyberpunk Streets-242-Billboard_Ramen_StoreFront.png", fw: 609, h: 421 },
      { key: "bb-10", file: "Cyberpunk Streets-243-Billboard_Pharmacy_Large.png",   fw: 429, h: 371 },
      { key: "bb-11", file: "Cyberpunk Streets-244-Billboard_GunStore-5.png",       fw: 193, h: 237 },
      { key: "bb-12", file: "Cyberpunk Streets-245-Billboard_GunStore-4.png",       fw: 189, h: 143 },
      { key: "bb-13", file: "Cyberpunk Streets-246-Billboard_GunStore-3.png",       fw: 169, h: 201 },
      { key: "bb-14", file: "Cyberpunk Streets-247-Billboard_Drugs_Framed.png",     fw: 385, h: 397 },
      { key: "bb-15", file: "Cyberpunk Streets-248-Billboard_DVD.png",              fw: 173, h: 143 },
      { key: "bb-16", file: "Cyberpunk Streets-249-Billboard_Chinese_Large.png",    fw: 269, h: 307 },
      { key: "bb-17", file: "Cyberpunk Streets-25-Billboard_Ramen-0.png",           fw: 201, h: 177 },
      { key: "bb-18", file: "Cyberpunk Streets-250-BIllboard_Rooftop-1.png",       fw: 469, h: 383 },
      { key: "bb-19", file: "Cyberpunk Streets-251-BIllboard_Rooftop-0.png",       fw: 469, h: 371 },
      { key: "bb-20", file: "Cyberpunk Streets-26-Billboard_Pill.png",              fw: 69,  h: 191 },
      { key: "bb-21", file: "Cyberpunk Streets-27-Billboard_Pharmacy.png",          fw: 169, h: 241 },
      { key: "bb-22", file: "Cyberpunk Streets-28-Billboard_Open-3.png",            fw: 189, h: 151 },
      { key: "bb-23", file: "Cyberpunk Streets-29-Billboard_News-3.png",            fw: 257, h: 253 },
      { key: "bb-24", file: "Cyberpunk Streets-30-Billboard_LifeBar.png",           fw: 69,  h: 191 },
      { key: "bb-25", file: "Cyberpunk Streets-31-Billboard_KoreanOK-2.png",       fw: 257, h: 253 },
      { key: "bb-26", file: "Cyberpunk Streets-32-Billboard_JapaneseGun-2.png",    fw: 257, h: 253 },
      { key: "bb-27", file: "Cyberpunk Streets-33-Billboard_Herb-3.png",            fw: 149, h: 279 },
      { key: "bb-28", file: "Cyberpunk Streets-34-Billboard_Girl2-0.png",           fw: 257, h: 361 },
      { key: "bb-29", file: "Cyberpunk Streets-35-Billboard_Girl1-0.png",           fw: 257, h: 361 },
      { key: "bb-30", file: "Cyberpunk Streets-36-Billboard_Game-3.png",            fw: 177, h: 233 },
      { key: "bb-31", file: "Cyberpunk Streets-37-Billboard_Drugs-0.png",           fw: 101, h: 451 },
      { key: "bb-32", file: "Cyberpunk Streets-38-Billboard_DVD-0.png",             fw: 161, h: 241 },
      { key: "bb-33", file: "Cyberpunk Streets-39-Billboard_Crab-2.png",            fw: 177, h: 249 },
      { key: "bb-34", file: "Cyberpunk Streets-40-Billboard_Chinese3-1.png",        fw: 161, h: 181 },
      { key: "bb-35", file: "Cyberpunk Streets-41-Billboard_Chinese2-0.png",        fw: 69,  h: 195 },
      { key: "bb-36", file: "Cyberpunk Streets-42-Billboard_Chinese1-0.png",        fw: 257, h: 253 },
      { key: "bb-37", file: "Cyberpunk Streets-43-Billboard_CatchADoll-0.png",      fw: 985, h: 657 },
    ];
    for (const b of billboards) {
      this.load.spritesheet(b.key, `${BB}/${b.file}`, {
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
    trimAsianModules(this);
    trimBillboards(this);
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
