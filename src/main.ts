import Phaser from "phaser";
import { gameConfig } from "./config/game";
import { loadManifest } from "./scenes/BootScene";

// Load asset manifest before booting Phaser so preload() can queue everything
loadManifest().then(() => {
  new Phaser.Game(gameConfig);
});
