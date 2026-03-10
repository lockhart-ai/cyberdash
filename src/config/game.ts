import Phaser from "phaser";
import { BootScene } from "../scenes/BootScene";
// import { GameScene } from "../scenes/GameScene";
import { ShowroomScene } from "../scenes/ShowroomScene";

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 720,
  height: 405,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: "#0a0a0a",
  scene: [BootScene, ShowroomScene],
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  render: {
    antialias: true,
    antialiasGL: true,
  },
  parent: "game",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};
