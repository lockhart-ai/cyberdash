// Assumptions:
// - Only ever constructed in dev builds, from GameScene.create() guarded by `import.meta.env.DEV`; stripped from
//   production output by Vite's dead-code elimination (verified separately with a production build + grep).
// - Operates on an already-created GameScene: the player sprite + its Arcade body, and the camera's follow
//   target/offset, already exist by the time any method here runs.
// - teleport() moves the physics body via `body.reset(x, y)`, not the sprite's x/y directly: Arcade physics writes
//   the sprite's position from the body every step, so setting sprite.x/y alone would be overwritten next frame.
// - Camera snap on teleport: Phaser's camera follow targets `follow.x - followOffset.x` / `follow.y - followOffset.y`
//   as the point to center on (see node_modules/phaser/src/cameras/2d/Camera.js, preRender). Calling
//   `camera.centerOn()` with that same point, instead of letting the lerp settle, makes the jump instant.
// - pause()/resume() pause/resume the GameScene itself. Verified against node_modules/phaser/src/scene/Systems.js:
//   a PAUSED scene's status fails the `step()` guard (no update(), no animations, no physics — Arcade physics ticks
//   off the same per-frame event step() emits) but still passes the `render()` guard, so screenshots taken while
//   paused show a stable frame.
// - "Visible" props/RTs (for getState().counts) are computed on demand against the camera's current `worldView`,
//   not tracked incrementally — GameScene does not currently toggle a `visible` flag on these objects per frame.

import Phaser from "phaser";
import { isoToScreen, screenToIso } from "../iso/IsoGeometry";
import type { Direction, GameScene } from "../scenes/GameScene";

declare global {
  interface Window {
    __cyberdash?: GameDebug;
  }
}

export interface GameDebugState {
  x: number;
  y: number;
  col: number;
  row: number;
  facing: Direction;
  counts: {
    props: number;
    blockRTs: number;
    visibleProps: number;
    visibleRTs: number;
  };
}

export class GameDebug {
  /** Set once the scene is ready to be driven; a harness should wait on this before issuing commands. */
  readonly ready = true;

  constructor(private readonly scene: GameScene) {}

  /** Teleport the player to a grid cell and snap the camera to match, with no settle wait needed. */
  teleport(col: number, row: number): void {
    const { x, y } = isoToScreen(col, row);
    const body = this.scene.player.body as Phaser.Physics.Arcade.Body;
    body.reset(x, y);

    const camera = this.scene.cameras.main;
    const offset = camera.followOffset;
    camera.centerOn(x - offset.x, y - offset.y);
  }

  /** Face the player a given direction and show that direction's idle texture. */
  face(dir: Direction): void {
    this.scene.setFacing(dir);
    this.scene.player.stop();
    this.scene.player.setTexture(`player-${dir}`);
  }

  /** Freeze the running game (update, physics, animations) while leaving rendering live for screenshots. */
  pause(): void {
    this.scene.scene.pause();
  }

  /** Resume a paused game. */
  resume(): void {
    this.scene.scene.resume();
  }

  getState(): GameDebugState {
    const player = this.scene.player;
    const { col, row } = screenToIso(player.x, player.y);
    const view = this.scene.cameras.main.worldView;

    const props = this.scene.propImages;
    const blockRTs = this.scene.blockRTs;

    let visibleProps = 0;
    for (const img of props) {
      if (Phaser.Geom.Rectangle.Contains(view, img.x, img.y)) visibleProps++;
    }

    let visibleRTs = 0;
    const rtBounds = new Phaser.Geom.Rectangle();
    for (const rt of blockRTs) {
      rtBounds.setTo(rt.x, rt.y, rt.width, rt.height);
      if (Phaser.Geom.Rectangle.Overlaps(view, rtBounds)) visibleRTs++;
    }

    return {
      x: player.x,
      y: player.y,
      col,
      row,
      facing: this.scene.facing,
      counts: {
        props: props.length,
        blockRTs: blockRTs.length,
        visibleProps,
        visibleRTs,
      },
    };
  }
}
