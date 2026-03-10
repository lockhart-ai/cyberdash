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

export interface AssetEntry {
  key: string;
  path: string;
  pack: string;
  sub: string;
  file: string;
}

// Loaded synchronously before Phaser boots so we can queue everything in preload()
let manifest: AssetEntry[] = [];

export function loadManifest(): Promise<void> {
  return fetch("asset_manifest.json")
    .then((r) => r.json())
    .then((data) => {
      manifest = data;
      console.log(`[boot] Manifest loaded: ${manifest.length} assets`);
    });
}

export function getManifest(): AssetEntry[] {
  return manifest;
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload() {
    // Player sprites
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

    // All pack assets from manifest (loaded before Phaser boot)
    for (const entry of manifest) {
      this.load.image(entry.key, entry.path);
    }

    console.log(`[boot] Queued ${manifest.length} pack assets for loading`);

    // Loading progress bar
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const barW = 300, barH = 20;
    const barX = (w - barW) / 2, barY = h / 2;

    const bg = this.add.graphics();
    bg.fillStyle(0x222233, 1);
    bg.fillRect(barX, barY, barW, barH);

    const bar = this.add.graphics();
    const label = this.add.text(w / 2, barY - 20, "Loading assets...", {
      fontSize: "14px", fontFamily: "monospace", color: "#00ffcc",
    }).setOrigin(0.5, 1);

    this.load.on("progress", (value: number) => {
      bar.clear();
      bar.fillStyle(0x00ffcc, 1);
      bar.fillRect(barX, barY, barW * value, barH);
      label.setText(`Loading assets... ${Math.floor(value * 100)}%`);
    });
  }

  create() {
    // Player animations
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

    this.scene.start("ShowroomScene");
  }
}
