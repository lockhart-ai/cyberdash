import Phaser from "phaser";

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

    // Tiles
    this.load.image("street", "assets/tilemaps/street_0.png");
    for (let i = 0; i < 8; i++) {
      this.load.image(`sidewalk-${i}`, `assets/tilemaps/sidewalk_${i}.png`);
    }

    // Building features (used in game world)
    for (let w = 0; w < 12; w++) {
      this.load.image(`window-${w}`, `assets/sprites/window_${w}.png`);
    }
    for (let i = 0; i < 14; i++) {
      this.load.image(`metal-door-${i}`, `assets/sprites/metal_door_${i}.png`);
    }
    for (let i = 0; i < 6; i++) {
      this.load.image(`garbage-bin-${i}`, `assets/sprites/garbage_bin_${i}.png`);
    }
    for (let i = 0; i < 9; i++) {
      this.load.image(`vending-machine-${i}`, `assets/sprites/vending_machine_${i}.png`);
    }
    for (let i = 0; i < 7; i++) {
      this.load.image(`garage-door-${i}`, `assets/sprites/garage_door_${i}.png`);
    }
    for (let i = 0; i < 1; i++) {
      this.load.image(`elec-box-${i}`, `assets/sprites/elec_box_${i}.png`);
    }
    for (let i = 0; i < 3; i++) {
      this.load.image(`wall-vent-${i}`, `assets/sprites/wall_vent_${i}.png`);
    }

    // Street props (only used variants)
    this.load.image("traffic-light-2", "assets/sprites/traffic_light_2.png");
    this.load.image("sewer-grate-4", "assets/sprites/sewer_grate_4.png");
    this.load.image("steam-vent-0", "assets/sprites/steam_vent_0.png");

    // Neon signs
    for (let i = 0; i < 10; i++) {
      this.load.image(`neon-noodle-sign-${i}`, `assets/sprites/neon_noodle_sign_${i}.png`);
    }
    for (let i = 0; i < 10; i++) {
      this.load.image(`neon-dragon-sign-${i}`, `assets/sprites/neon_dragon_sign_${i}.png`);
    }

    // Cars
    for (let i = 0; i < 10; i++) {
      this.load.image(`car-${i}`, `assets/sprites/car_${i}.png`);
    }

    // Building wall textures
    for (let v = 0; v < 6; v++) {
      for (const s of [2, 3, 4]) {
        this.load.image(`wall-left-v${v}-${s}s`, `assets/tilemaps/wall_left_v${v}_${s}s.png`);
        this.load.image(`wall-right-v${v}-${s}s`, `assets/tilemaps/wall_right_v${v}_${s}s.png`);
      }
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

    this.scene.start("GameScene");
  }
}
