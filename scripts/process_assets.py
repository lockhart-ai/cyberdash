#!/usr/bin/env python3
"""Full asset processing pipeline for CyberDash SE wall assets.

Takes raw Replicate rd-plus output (384x384, black background) and produces
game-ready textures: bg removed, angle-filtered, shear-corrected, postprocessed.

Usage:
    python3 scripts/process_assets.py /tmp/rd_window_*.png -o public/assets/sprites/window
    python3 scripts/process_assets.py /tmp/rd_door_*.png -o public/assets/sprites/door
    python3 scripts/process_assets.py /tmp/rd_door_*.png -o public/assets/sprites/door --start-index 6

Steps:
    1. Remove black background (R<20, G<20, B<20 → transparent)
    2. Auto-crop to content
    3. Auto-flip SW-facing → SE
    4. Filter by isometric angle (±tolerance of -0.5)
    5. Shear-correct to exactly -0.5
    6. Postprocess (cyberdark preset: darken, blue-shift, contrast)
    7. Save with sequential numbering
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageEnhance

TARGET_SLOPE = -0.5
DEFAULT_TOLERANCE = 0.09


# ── Step 1-2: Remove black background and crop ───────────────────────────────

def remove_black_bg(img: Image.Image) -> Image.Image:
    """Replace near-black pixels with transparent, then crop."""
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if r < 20 and g < 20 and b < 20:
                pixels[x, y] = (0, 0, 0, 0)
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    return img


# ── Step 3-4: Measure slope, flip, filter ─────────────────────────────────────

def measure_slope(img: Image.Image) -> float:
    """Measure average top/bottom edge slope."""
    pixels = img.load()
    w, h = img.size
    top_edges, bot_edges = [], []
    for x in range(w):
        top_y = bot_y = None
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

    def edge_slope(edges):
        n = len(edges)
        q = max(1, n // 4)
        lp = edges[q:q * 2]
        rp = edges[n - q * 2:n - q]
        if not lp or not rp:
            return 0.0
        alx = sum(e[0] for e in lp) / len(lp)
        aly = sum(e[1] for e in lp) / len(lp)
        arx = sum(e[0] for e in rp) / len(rp)
        ary = sum(e[1] for e in rp) / len(rp)
        dx = arx - alx
        return (ary - aly) / dx if abs(dx) >= 1 else 0.0

    return (edge_slope(top_edges) + edge_slope(bot_edges)) / 2


def fix_facing(img: Image.Image) -> tuple:
    """Flip SW-facing assets to SE. Returns (img, was_flipped)."""
    pixels = img.load()
    w, h = img.size
    for y in range(h - 1, -1, -1):
        left_x = right_x = None
        for x in range(w):
            if pixels[x, y][3] > 32:
                if left_x is None:
                    left_x = x
                right_x = x
        if left_x is not None and right_x is not None:
            center = w / 2
            if (right_x - center) > (center - left_x):
                return img.transpose(Image.FLIP_LEFT_RIGHT), True
            return img, False
    return img, False


# ── Step 5: Shear-correct ─────────────────────────────────────────────────────

def shear_correct(img: Image.Image) -> Image.Image:
    """Apply affine vertical shear to correct slope to exactly -0.5."""
    current = measure_slope(img)
    delta = TARGET_SLOPE - current
    if abs(delta) < 0.005:
        return img

    w, h = img.size
    cx = w / 2
    extra = int(abs(delta) * w / 2) + 2
    new_h = h + 2 * extra

    padded = Image.new("RGBA", (w, new_h), (0, 0, 0, 0))
    padded.paste(img, (0, extra))

    result = padded.transform(
        (w, new_h), Image.AFFINE,
        (1, 0, 0, -delta, 1, delta * cx),
        resample=Image.BICUBIC,
    )

    # Snap alpha to 0/255
    rpx = result.load()
    for y in range(new_h):
        for x in range(w):
            r, g, b, a = rpx[x, y]
            rpx[x, y] = (r, g, b, 255 if a > 64 else 0)

    bbox = result.getbbox()
    if bbox:
        result = result.crop(bbox)
    return result


# ── Step 6: Postprocess (cyberdark) ───────────────────────────────────────────

def postprocess(img: Image.Image) -> Image.Image:
    """Darken, blue-shift, and contrast-boost for cyberpunk aesthetic."""
    brightness = 0.45
    blue_shift = 0.08
    contrast = 1.2

    img = img.convert("RGBA")
    r, g, b, a = img.split()

    r_mult = brightness * (1.0 - blue_shift)
    g_mult = brightness * (1.0 - blue_shift / 2.0)
    b_mult = brightness * (1.0 + blue_shift / 2.0)

    r = r.point(lambda v: min(255, int(v * r_mult)))
    g = g.point(lambda v: min(255, int(v * g_mult)))
    b = b.point(lambda v: min(255, int(v * b_mult)))

    rgb = Image.merge("RGB", (r, g, b))
    rgb = ImageEnhance.Contrast(rgb).enhance(contrast)
    r, g, b = rgb.split()

    return Image.merge("RGBA", (r, g, b, a))


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Full asset pipeline: bg removal → flip → filter → shear → postprocess"
    )
    parser.add_argument("inputs", nargs="+", help="Raw PNG files from Replicate")
    parser.add_argument("-o", "--output-prefix", required=True,
                        help="Output prefix (e.g. public/assets/sprites/window)")
    parser.add_argument("--start-index", type=int, default=0,
                        help="Starting index for output numbering (default: 0)")
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE,
                        help=f"Max slope deviation from -0.5 (default: {DEFAULT_TOLERANCE})")
    parser.add_argument("--no-shear", action="store_true",
                        help="Skip shear correction (for ground-level assets)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be kept without saving")
    args = parser.parse_args()

    kept = []
    rejected = []

    for input_path in args.inputs:
        name = Path(input_path).name
        print(f"\n{'='*50}")
        print(f"Processing: {name}")

        # Step 1-2: Remove bg and crop
        img = Image.open(input_path).convert("RGBA")
        img = remove_black_bg(img)
        if img.getbbox() is None:
            print(f"  REJECT: empty after bg removal")
            rejected.append((name, "empty"))
            continue
        print(f"  Cleaned: {img.size[0]}x{img.size[1]}")

        # Step 3: Fix facing
        img, flipped = fix_facing(img)
        if flipped:
            print(f"  Flipped: SW → SE")

        # Step 4: Check angle
        slope = measure_slope(img)
        if abs(slope - TARGET_SLOPE) > args.tolerance:
            print(f"  REJECT: slope={slope:.3f} (outside ±{args.tolerance} of {TARGET_SLOPE})")
            rejected.append((name, f"slope={slope:.3f}"))
            continue
        print(f"  Slope: {slope:.3f} OK")

        # Step 5: Shear-correct (skip for ground-level assets)
        if not args.no_shear:
            img = shear_correct(img)
            final_slope = measure_slope(img)
            print(f"  Corrected: {img.size[0]}x{img.size[1]}, slope={final_slope:.3f}")
        else:
            print(f"  Skipped shear correction")

        # Step 6: Postprocess
        img = postprocess(img)
        print(f"  Postprocessed")

        kept.append((name, img))

    # Save results
    print(f"\n{'='*50}")
    print(f"Results: {len(kept)} kept, {len(rejected)} rejected")

    if rejected:
        print(f"\nRejected:")
        for name, reason in rejected:
            print(f"  {name}: {reason}")

    if kept and not args.dry_run:
        print(f"\nSaved:")
        for i, (name, img) in enumerate(kept):
            idx = args.start_index + i
            out_path = f"{args.output_prefix}_{idx}.png"
            img.save(out_path)
            print(f"  {name} → {out_path} ({img.size[0]}x{img.size[1]})")

    if args.dry_run and kept:
        print(f"\nWould save (dry run):")
        for i, (name, img) in enumerate(kept):
            idx = args.start_index + i
            print(f"  {name} → {args.output_prefix}_{idx}.png ({img.size[0]}x{img.size[1]})")

    print(f"\nDone.")
    return len(kept)


if __name__ == "__main__":
    main()
