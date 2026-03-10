#!/usr/bin/env python3
"""Post-process PixelLab assets for CyberDash's dark cyberpunk aesthetic.

Darkens, blue-shifts, and contrast-boosts pixel art PNGs while preserving alpha.

Usage:
    python3 scripts/postprocess.py [OPTIONS] INPUT [INPUT...]
    python3 scripts/postprocess.py --preview public/assets/sprites/door_*.png
    python3 scripts/postprocess.py --preset cyberdark-heavy public/assets/sprites/door_*.png
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageEnhance

# ── Presets ──────────────────────────────────────────────────────────────────

PRESETS = {
    "cyberdark":       {"brightness": 0.45, "blue_shift": 0.08, "contrast": 1.2, "gamma": 1.0},
    "cyberdark-heavy": {"brightness": 0.35, "blue_shift": 0.10, "contrast": 1.3, "gamma": 1.2},
    "neon-preserve":   {"brightness": 0.50, "blue_shift": 0.05, "contrast": 1.4, "gamma": 1.3},
}


def fix_iso_facing(img: Image.Image) -> tuple[Image.Image, bool]:
    """Auto-detect and fix SE wall facing.

    For SE-facing isometric assets, the lowest visible pixel should be
    on the bottom-left (the SE wall slopes down-right at -0.5).
    If the lowest pixel is on the right side, the image is facing SW
    and needs a horizontal flip.

    Returns (image, was_flipped).
    """
    pixels = img.load()
    w, h = img.size

    # Find the bottommost row with visible pixels, then check
    # whether the rightmost visible pixel in that row is on the
    # right half of the image.
    for y in range(h - 1, -1, -1):
        left_x = None
        right_x = None
        for x in range(w):
            if pixels[x, y][3] > 32:
                if left_x is None:
                    left_x = x
                right_x = x
        if left_x is not None and right_x is not None:
            center = w / 2
            # If the bottom-right extent is further from center than bottom-left
            if (right_x - center) > (center - left_x):
                return img.transpose(Image.FLIP_LEFT_RIGHT), True
            return img, False

    return img, False


def process_image(
    img: Image.Image,
    brightness: float,
    blue_shift: float,
    contrast: float,
    gamma: float,
    alpha_threshold: int,
) -> Image.Image:
    """Apply the full processing pipeline to an RGBA image."""
    img = img.convert("RGBA")
    r, g, b, a = img.split()

    # 1. Alpha cleanup
    if alpha_threshold > 0:
        a = a.point(lambda v: 255 if v >= alpha_threshold else 0)

    # 2. Darken + blue shift (per-channel multipliers)
    r_mult = brightness * (1.0 - blue_shift)
    g_mult = brightness * (1.0 - blue_shift / 2.0)
    b_mult = brightness * (1.0 + blue_shift / 2.0)

    r = r.point(lambda v: min(255, int(v * r_mult)))
    g = g.point(lambda v: min(255, int(v * g_mult)))
    b = b.point(lambda v: min(255, int(v * b_mult)))

    # 3. Gamma correction (>1 darkens midtones)
    if gamma != 1.0:
        inv_gamma = 1.0 / gamma
        r = r.point(lambda v: min(255, int(255 * (v / 255.0) ** inv_gamma)))
        g = g.point(lambda v: min(255, int(255 * (v / 255.0) ** inv_gamma)))
        b = b.point(lambda v: min(255, int(255 * (v / 255.0) ** inv_gamma)))

    # 4. Contrast boost (on RGB only, then reattach alpha)
    rgb = Image.merge("RGB", (r, g, b))
    rgb = ImageEnhance.Contrast(rgb).enhance(contrast)
    r, g, b = rgb.split()

    return Image.merge("RGBA", (r, g, b, a))


def make_preview(original: Image.Image, processed: Image.Image) -> Image.Image:
    """Side-by-side comparison with labels rendered as colored blocks."""
    gap = 4
    w = original.width * 2 + gap
    h = original.height + 12
    canvas = Image.new("RGBA", (w, h), (30, 30, 35, 255))
    canvas.paste(original, (0, 12))
    canvas.paste(processed, (original.width + gap, 12))
    # Simple indicator: 4px colored bar — green=original, magenta=processed
    for x in range(original.width):
        for y in range(4):
            canvas.putpixel((x, y + 4), (80, 200, 80, 255))
    for x in range(processed.width):
        for y in range(4):
            canvas.putpixel((original.width + gap + x, y + 4), (200, 80, 200, 255))
    return canvas


def main():
    parser = argparse.ArgumentParser(
        description="Post-process PixelLab assets for CyberDash cyberpunk aesthetic."
    )
    parser.add_argument("inputs", nargs="+", metavar="INPUT", help="PNG files to process")
    parser.add_argument("-b", "--brightness", type=float, default=None, help="Brightness multiplier (default: 0.45)")
    parser.add_argument("-s", "--blue-shift", type=float, default=None, help="Cool tint intensity (default: 0.08)")
    parser.add_argument("-c", "--contrast", type=float, default=None, help="Contrast factor (default: 1.2)")
    parser.add_argument("-g", "--gamma", type=float, default=None, help="Gamma correction (default: 1.0)")
    parser.add_argument("-a", "--alpha-threshold", type=int, default=None, help="Alpha snap threshold (default: 0 = off)")
    parser.add_argument("-o", "--output-dir", type=str, default=None, help="Output directory (default: in-place)")
    parser.add_argument("--suffix", type=str, default="", help="Append before extension (e.g. _dark)")
    parser.add_argument("--preview", action="store_true", help="Generate side-by-side comparison PNGs")
    parser.add_argument("--preset", type=str, default="cyberdark", choices=PRESETS.keys(), help="Parameter preset (default: cyberdark)")
    parser.add_argument("--fix-facing", action="store_true", help="Auto-detect and flip SW-facing assets to SE")
    parser.add_argument("--in-place", action="store_true", help="Allow overwriting input files (default: refuse)")

    args = parser.parse_args()

    # Resolve params: preset first, then CLI overrides
    preset = PRESETS[args.preset]
    brightness = args.brightness if args.brightness is not None else preset["brightness"]
    blue_shift = args.blue_shift if args.blue_shift is not None else preset["blue_shift"]
    contrast = args.contrast if args.contrast is not None else preset["contrast"]
    gamma = args.gamma if args.gamma is not None else preset["gamma"]
    alpha_threshold = args.alpha_threshold if args.alpha_threshold is not None else 0

    r_mult = brightness * (1.0 - blue_shift)
    g_mult = brightness * (1.0 - blue_shift / 2.0)
    b_mult = brightness * (1.0 + blue_shift / 2.0)

    print(f"Preset: {args.preset}")
    print(f"  brightness={brightness}, blue_shift={blue_shift}, contrast={contrast}, gamma={gamma}")
    print(f"  R×{r_mult:.3f}  G×{g_mult:.3f}  B×{b_mult:.3f}")
    if alpha_threshold > 0:
        print(f"  alpha_threshold={alpha_threshold}")
    print()

    output_dir = Path(args.output_dir) if args.output_dir else None
    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)

    for input_path_str in args.inputs:
        input_path = Path(input_path_str)
        if not input_path.exists():
            print(f"  SKIP {input_path} (not found)")
            continue

        img = Image.open(input_path).convert("RGBA")
        if args.fix_facing:
            img, flipped = fix_iso_facing(img)
            if flipped:
                print(f"  FLIPPED {input_path.name} (was facing SW)")
        result = process_image(img, brightness, blue_shift, contrast, gamma, alpha_threshold)

        stem = input_path.stem + args.suffix
        out_name = stem + input_path.suffix
        if output_dir:
            out_path = output_dir / out_name
        else:
            out_path = input_path.parent / out_name

        if out_path.resolve() == input_path.resolve() and not args.in_place:
            print(f"  SKIP {input_path.name} (would overwrite input; use --in-place or -o)")
            continue

        if args.preview:
            preview = make_preview(img, result)
            preview_path = out_path.parent / f"{stem}_preview.png"
            preview.save(preview_path)
            print(f"  PREVIEW {input_path.name} → {preview_path.name}")
        else:
            result.save(out_path)
            print(f"  {'OVERWROTE' if out_path.resolve() == input_path.resolve() else 'WROTE'} {out_path}")

    print("\nDone.")


if __name__ == "__main__":
    main()
