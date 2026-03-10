import Phaser from "phaser";
import { getManifest, type AssetEntry } from "./BootScene";

type Direction =
  | "south"
  | "south-west"
  | "west"
  | "north-west"
  | "north"
  | "north-east"
  | "east"
  | "south-east";

const COLS = 10;         // assets per row
const CELL_PAD = 40;     // padding around each asset
const PACK_GAP = 100;    // gap between pack sections
const SUB_GAP = 40;      // gap between subfolder sections

export class ShowroomScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private facing: Direction = "south";
  private manifest: AssetEntry[] = [];

  constructor() {
    super({ key: "ShowroomScene" });
  }

  create() {
    this.manifest = getManifest();
    const dpr = window.devicePixelRatio || 1;

    this.cameras.main.setBackgroundColor("#111118");

    // Group assets by pack, then by subfolder
    const packs = new Map<string, Map<string, AssetEntry[]>>();
    for (const entry of this.manifest) {
      if (!packs.has(entry.pack)) packs.set(entry.pack, new Map());
      const subs = packs.get(entry.pack)!;
      const subKey = entry.sub || "(root)";
      if (!subs.has(subKey)) subs.set(subKey, []);
      subs.get(subKey)!.push(entry);
    }

    // First pass: measure all asset sizes so we can compute row heights
    // Layout: full-size assets in a grid, rows sized to the tallest asset in that row
    let curY = 100;
    let maxWorldW = 0;

    for (const [packName, subs] of packs) {
      // Pack header
      this.add.text(40, curY, packName.toUpperCase(), {
        fontSize: "18px",
        fontFamily: "monospace",
        color: "#00ffcc",
        resolution: dpr,
      }).setDepth(10);
      curY += 36;

      for (const [subName, entries] of subs) {
        // Subfolder label
        if (subName !== "(root)") {
          this.add.text(60, curY, subName, {
            fontSize: "13px",
            fontFamily: "monospace",
            color: "#888899",
            resolution: dpr,
          }).setDepth(10);
          curY += 24;
        }

        // Measure sizes for all entries in this subfolder
        interface Measured { entry: AssetEntry; w: number; h: number }
        const measured: Measured[] = [];
        for (const entry of entries) {
          const tex = this.textures.get(entry.key);
          if (!tex || tex.key === "__MISSING") continue;
          const frame = tex.get();
          measured.push({ entry, w: frame.width, h: frame.height });
        }

        // Lay out in rows of COLS, each row's height = tallest asset in that row
        let col = 0;
        let rowStartIdx = 0;

        while (rowStartIdx < measured.length) {
          const rowEnd = Math.min(rowStartIdx + COLS, measured.length);
          const rowItems = measured.slice(rowStartIdx, rowEnd);

          // Row height = tallest item + padding
          const rowH = Math.max(...rowItems.map(m => m.h)) + CELL_PAD * 2 + 16; // 16 for label

          // Place items left to right, vertically centered in row
          let curX = 80;
          for (const item of rowItems) {
            const x = curX + item.w / 2;
            const y = curY + CELL_PAD + item.h / 2;

            const img = this.add.image(x, y, item.entry.key);
            img.setDepth(1);
            // Full size — no scaling

            // Filename label below
            const shortName = item.entry.file.replace(/\.png$/i, "").substring(0, 24);
            this.add.text(x, y + item.h / 2 + 4, shortName, {
              fontSize: "8px",
              fontFamily: "monospace",
              color: "#555566",
              resolution: dpr,
            }).setOrigin(0.5, 0).setDepth(10);

            curX += item.w + CELL_PAD;
          }

          if (curX > maxWorldW) maxWorldW = curX;
          curY += rowH;
          rowStartIdx = rowEnd;
        }

        curY += SUB_GAP;
      }

      curY += PACK_GAP;
    }

    // Player
    this.player = this.physics.add.sprite(400, 100, "player-south");
    this.player.setScale(1.5).setDepth(100);
    const body = this.player.body as Phaser.Physics.Arcade.Body;

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

    // Camera follows player, zoomed out to see more
    this.cameras.main.setZoom(0.25);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setDeadzone(40, 40);

    // World bounds
    const worldW = Math.max(maxWorldW + 200, 2000);
    const worldH = curY + 400;
    this.physics.world.setBounds(0, 0, worldW, worldH);
    body.setCollideWorldBounds(true);

    // HUD
    this.add.text(10, 10, "ASSET SHOWROOM — Arrow keys to move, Shift to run", {
      fontSize: "12px",
      fontFamily: "monospace",
      color: "#00ffcc",
      resolution: dpr,
    }).setScrollFactor(0).setDepth(1000);

    const loaded = this.manifest.filter(e => {
      const t = this.textures.get(e.key);
      return t && t.key !== "__MISSING";
    }).length;
    this.add.text(10, 26, `${loaded} / ${this.manifest.length} assets loaded`, {
      fontSize: "10px",
      fontFamily: "monospace",
      color: "#888899",
      resolution: dpr,
    }).setScrollFactor(0).setDepth(1000);

    console.log(`[showroom] ${loaded} assets, world ${worldW}x${worldH}`);
  }

  update() {
    const speed = this.shiftKey.isDown ? 600 : 300;
    let vx = 0, vy = 0;

    if (this.cursors.left.isDown) vx = -speed;
    else if (this.cursors.right.isDown) vx = speed;
    if (this.cursors.up.isDown) vy = -speed;
    else if (this.cursors.down.isDown) vy = speed;

    if (vx !== 0 && vy !== 0) {
      vx *= 0.707;
      vy *= 0.707;
    }

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(vx, vy);

    let dir: Direction = this.facing;
    if (vy < 0 && vx === 0) dir = "north";
    else if (vy > 0 && vx === 0) dir = "south";
    else if (vx < 0 && vy === 0) dir = "west";
    else if (vx > 0 && vy === 0) dir = "east";
    else if (vx < 0 && vy < 0) dir = "north-west";
    else if (vx > 0 && vy < 0) dir = "north-east";
    else if (vx < 0 && vy > 0) dir = "south-west";
    else if (vx > 0 && vy > 0) dir = "south-east";

    if (vx !== 0 || vy !== 0) {
      this.facing = dir;
      const animKey = this.shiftKey.isDown ? `run-${dir}` : `walk-${dir}`;
      if (!this.player.anims.isPlaying || this.player.anims.currentAnim?.key !== animKey) {
        this.player.play(animKey);
      }
    } else {
      this.player.stop();
      this.player.setTexture(`player-${this.facing}`);
    }
  }
}
