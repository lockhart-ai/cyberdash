/** Find tight opaque bounding box of a canvas. Returns pixel coords of leftmost/rightmost/topmost/bottommost opaque pixels. */
export function findOpaqueBounds(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  alphaThreshold = 10,
): { left: number; right: number; top: number; bottom: number } {
  const imgData = ctx.getImageData(0, 0, width, height);
  const px = imgData.data;
  let left = width,
    right = 0,
    top = height,
    bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] > alphaThreshold) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return { left, right, top, bottom };
}
