let debugVisible = false;
const debugObjects: Phaser.GameObjects.Graphics[] = [];

export function isDebugVisible(): boolean { return debugVisible; }

export function toggleDebug(): boolean {
  debugVisible = !debugVisible;
  for (const obj of debugObjects) obj.setVisible(debugVisible);
  return debugVisible;
}

export function addDebugGraphics(gfx: Phaser.GameObjects.Graphics): void {
  gfx.setVisible(debugVisible);
  debugObjects.push(gfx);
}
