import Phaser from "phaser";
import { BootScene } from "../scenes/BootScene";
import { GameScene } from "../scenes/GameScene";

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1440,
  height: 810,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: "#0a0a0a",
  scene: [BootScene, GameScene],
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  render: {
    antialias: false,
    antialiasGL: false,
  },
  parent: "game",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};
