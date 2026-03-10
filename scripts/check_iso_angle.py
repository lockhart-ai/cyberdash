"""
Validate that pixel art assets have correct isometric 2:1 SE-wall angle.

For SE-facing wall elements on a 2:1 isometric grid:
- The TOP and BOTTOM edges slope at -0.5 (every 2px right = 1px up)
- The left/right edges can be vertical (they're the wall height)
- The lowest visible pixel should be on the LEFT side (SE wall slopes down-left)

This script checks:
1. Facing: bottom pixel bias (left = SE correct, right = SW needs flip)
2. Top/bottom edge slopes: should be close to -0.5 (dy/dx)

Usage:
    python3 scripts/check_iso_angle.py public/assets/sprites/door_*.png
    python3 scripts/check_iso_angle.py --fix public/assets/sprites/door_*.png
"""

import argparse
from pathlib import Path
from PIL import Image


def _is_visible(pixel, bg_mode: str) -> bool:
    """Check if a pixel is 'visible' (not background)."""
    if bg_mode == "alpha":
        return pixel[3] > 32
    else:  # "black"
        return pixel[0] > 20 or pixel[1] > 20 or pixel[2] > 20


def _detect_bg(img: Image.Image) -> str:
    """Auto-detect background type: 'alpha' if transparent, 'black' if opaque dark."""
    pixels = img.load()
    w, h = img.size
    # Sample corners — if all have alpha > 200 and RGB < 20, it's a black bg
    corners = [(0, 0), (w-1, 0), (0, h-1), (w-1, h-1)]
    for cx, cy in corners:
        p = pixels[cx, cy]
        if p[3] < 200:
            return "alpha"
    # All corners opaque — check if they're dark
    for cx, cy in corners:
        p = pixels[cx, cy]
        if p[0] > 20 or p[1] > 20 or p[2] > 20:
            return "alpha"  # bright opaque corners — use alpha mode
    return "black"


def analyze_iso(img: Image.Image) -> dict:
    """Analyze isometric properties of a sprite."""
    pixels = img.load()
    w, h = img.size
    bg_mode = _detect_bg(img)

    # For each column, find topmost and bottommost visible pixel
    top_edges = []   # (x, y) of topmost pixel per column
    bot_edges = []   # (x, y) of bottommost pixel per column
    for x in range(w):
        top_y = None
        bot_y = None
        for y in range(h):
            if _is_visible(pixels[x, y], bg_mode):
                if top_y is None:
                    top_y = y
                bot_y = y
        if top_y is not None:
            top_edges.append((x, top_y))
            bot_edges.append((x, bot_y))

    if len(top_edges) < 4:
        return {"error": "too few visible columns"}

    # Check facing: is the bottommost pixel on the left or right?
    # Find the absolute lowest pixel
    lowest_y = max(e[1] for e in bot_edges)
    lowest_points = [e for e in bot_edges if e[1] == lowest_y]
    avg_lowest_x = sum(e[0] for e in lowest_points) / len(lowest_points)
    center = w / 2
    facing = "SE" if avg_lowest_x < center else "SW"

    # Measure bottom edge slope (dy/dx) - should be -0.5 for SE
    # Use points from the middle 50% of columns to avoid frame edges
    def edge_slope(edges):
        n = len(edges)
        quarter = max(1, n // 4)
        left_pts = edges[quarter:quarter * 2]
        right_pts = edges[n - quarter * 2:n - quarter]
        if not left_pts or not right_pts:
            return None
        avg_lx = sum(e[0] for e in left_pts) / len(left_pts)
        avg_ly = sum(e[1] for e in left_pts) / len(left_pts)
        avg_rx = sum(e[0] for e in right_pts) / len(right_pts)
        avg_ry = sum(e[1] for e in right_pts) / len(right_pts)
        dx = avg_rx - avg_lx
        if abs(dx) < 1:
            return 0.0
        return (avg_ry - avg_ly) / dx  # negative = slopes up going right

    top_slope = edge_slope(top_edges)
    bot_slope = edge_slope(bot_edges)

    return {
        "facing": facing,
        "top_slope": top_slope,
        "bot_slope": bot_slope,
        "num_cols": len(top_edges),
    }


def check_asset(path: Path, fix: bool, tolerance: float) -> bool:
    """Check a single asset. Returns True if passes."""
    img = Image.open(path).convert("RGBA")
    result = analyze_iso(img)

    if "error" in result:
        print(f"  SKIP  {path.name}: {result['error']}")
        return True

    issues = []

    # Check facing
    if result["facing"] == "SW":
        issues.append("SW-facing (needs flip)")
        if fix:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
            # Write to .fixed.png to avoid corrupting originals
            fixed_path = path.parent / f"{path.stem}.fixed{path.suffix}"
            img.save(fixed_path)
            issues[-1] += f" -> FIXED ({fixed_path.name})"
            result = analyze_iso(img)

    # Check slopes: SE wall top/bottom edges should slope at -0.5
    target = -0.5
    ts = result["top_slope"]
    bs = result["bot_slope"]

    if ts is not None and abs(ts - target) > tolerance:
        issues.append(f"top slope={ts:.2f} (want ~{target})")

    if bs is not None and abs(bs - target) > tolerance:
        issues.append(f"bot slope={bs:.2f} (want ~{target})")

    if issues:
        print(f"  FAIL  {path.name}: {'; '.join(issues)}")
        return False
    else:
        ts_str = f"{ts:.2f}" if ts is not None else "?"
        bs_str = f"{bs:.2f}" if bs is not None else "?"
        print(f"  OK    {path.name} (top={ts_str} bot={bs_str})")
        return True


def main():
    parser = argparse.ArgumentParser(description="Validate isometric angle of pixel art assets.")
    parser.add_argument("inputs", nargs="+", metavar="INPUT", help="PNG files to check")
    parser.add_argument("--fix", action="store_true", help="Auto-fix facing direction (flip SW->SE)")
    parser.add_argument("--tolerance", type=float, default=0.25, help="Slope tolerance from -0.5 (default: 0.25)")
    args = parser.parse_args()

    passed = 0
    failed = 0

    for p in args.inputs:
        path = Path(p)
        if not path.exists():
            print(f"  SKIP  {path} (not found)")
            continue
        if check_asset(path, args.fix, args.tolerance):
            passed += 1
        else:
            failed += 1

    print(f"\n{passed} passed, {failed} failed")


if __name__ == "__main__":
    main()
