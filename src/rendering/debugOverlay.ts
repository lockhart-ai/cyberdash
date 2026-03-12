let boxesVisible = false;
let labelsVisible = false;
const boxObjects: Phaser.GameObjects.Graphics[] = [];
const labelObjects: Phaser.GameObjects.Text[] = [];

export function isDebugVisible(): boolean {
  return boxesVisible;
}

export function toggleDebug(): boolean {
  boxesVisible = !boxesVisible;
  for (const obj of boxObjects) obj.setVisible(boxesVisible);
  return boxesVisible;
}

export function toggleLabels(): boolean {
  labelsVisible = !labelsVisible;
  for (const obj of labelObjects) obj.setVisible(labelsVisible);
  return labelsVisible;
}

export function addDebugGraphics(gfx: Phaser.GameObjects.Graphics): void {
  gfx.setVisible(boxesVisible);
  boxObjects.push(gfx);
}

export function addDebugText(txt: Phaser.GameObjects.Text): void {
  txt.setVisible(labelsVisible);
  labelObjects.push(txt);
}
