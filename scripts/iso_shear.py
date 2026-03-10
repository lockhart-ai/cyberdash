"""
Apply isometric vertical shear to pixel art to match SE wall angle (-0.5 dy/dx).

Measures the current slope of the image's top/bottom edges, then applies
exactly the right vertical shear to correct it to -0.5.

Usage:
    python3 scripts/iso_shear.py INPUT OUTPUT
    python3 scripts/iso_shear.py --target -0.5 input.png output.png
"""

import argparse
from PIL import Image


def measure_slope(img: Image.Image) -> float:
    """Measure the average dy/dx slope of the top and bottom edges."""
    pixels = img.load()
    w, h = img.size

    top_edges = []
    bot_edges = []
    for x in range(w):
        top_y = None
        bot_y = None
        for y in range(h):
            if pixels[x, y][3] > 32:
                if top_y is None:
                    top_y = y
                bot_y = y
        if top_y is not None:
            top_edges.append((x, top_y))
            bot_edges.append((x, bot_y))

    if len(top_edges) < 4:
        return 0.0

    # Measure slope using left and right quarters to avoid noisy edges
    def quarter_slope(edges):
        n = len(edges)
        q = max(1, n // 4)
        left = edges[q:q * 2]
        right = edges[n - q * 2:n - q]
        if not left or not right:
            return 0.0
        lx = sum(e[0] for e in left) / len(left)
        ly = sum(e[1] for e in left) / len(left)
        rx = sum(e[0] for e in right) / len(right)
        ry = sum(e[1] for e in right) / len(right)
        dx = rx - lx
        if abs(dx) < 1:
            return 0.0
        return (ry - ly) / dx

    top_s = quarter_slope(top_edges)
    bot_s = quarter_slope(bot_edges)
    return (top_s + bot_s) / 2


def iso_shear(img: Image.Image, target: float = -0.5) -> Image.Image:
    """Shear image vertically so its edges match the target slope.

    Measures current slope, computes the delta, and shifts each column
    by the exact amount needed.
    """
    current = measure_slope(img)
    delta = target - current  # negative = shift right columns up

    w, h = img.size
    # Compute per-column vertical shift: column x shifts by delta * x
    # We shift relative to x=0 (leftmost column stays put)
    max_up = 0
    max_down = 0
    for x in range(w):
        shift = delta * x
        if shift < 0:
            max_up = max(max_up, int(-shift + 0.5))
        else:
            max_down = max(max_down, int(shift + 0.5))

    new_h = h + max_up + max_down
    result = Image.new("RGBA", (w, new_h), (0, 0, 0, 0))
    pixels_in = img.load()
    pixels_out = result.load()

    for x in range(w):
        # delta is target - current. For SE wall: target=-0.5, current~=0
        # So delta=-0.5, meaning right columns shift up (lower y in screen)
        # round(delta * x) is negative, so we add max_up to keep in bounds
        shift_y = round(delta * x) + max_up
        for y in range(h):
            new_y = y + shift_y
            if 0 <= new_y < new_h:
                pixels_out[x, new_y] = pixels_in[x, y]

    # Trim transparent rows from top and bottom
    result = trim_vertical(result)
    return result


def trim_vertical(img: Image.Image) -> Image.Image:
    """Remove fully transparent rows from top and bottom only."""
    bbox = img.getbbox()
    if bbox is None:
        return img
    # Keep full width, only trim vertical
    return img.crop((0, bbox[1], img.size[0], bbox[3]))


def main():
    parser = argparse.ArgumentParser(description="Apply isometric shear to pixel art.")
    parser.add_argument("input", help="Input PNG file")
    parser.add_argument("output", help="Output PNG file")
    parser.add_argument("--target", type=float, default=-0.5, help="Target slope dy/dx in screen coords (default: -0.5 for SE wall, right side higher)")
    args = parser.parse_args()

    img = Image.open(args.input).convert("RGBA")
    current = measure_slope(img)
    result = iso_shear(img, args.target)

    print(f"  {args.input}: slope {current:.3f} -> {args.target} | {img.size[0]}x{img.size[1]} -> {result.size[0]}x{result.size[1]}")
    result.save(args.output)


if __name__ == "__main__":
    main()
