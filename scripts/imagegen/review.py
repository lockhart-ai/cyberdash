#!/usr/bin/env python3
"""Build one side-by-side review sheet per prompt: rows = models, columns =
raw thumbnail, cleaned frames (enlarged), and the reference image.

Assumptions (stated up front):
- Reads raw/<model>/<prompt>.png and clean/<model>/<prompt>/frame_*.png,
  written by generate.py and cleanup.py respectively, under
  /Users/decker/Documents/cyberdash/imagegen-output/round1/.
- Every row is scaled to a common row height so the grid lines up; the raw
  thumbnail and reference are fit into that height preserving aspect ratio,
  and the cleaned frames are composited into one horizontal strip first
  (native cleaned resolution, small gaps) and then that whole strip is scaled
  up with nearest-neighbour to roughly 4x (capped so it still fits the row),
  so individual art pixels stay crisp and inspectable.
- A model/prompt with no raw image at all is skipped (it failed generation);
  one with a raw image but no cleaned frames shows the raw thumbnail with a
  "no cleaned frames" note in the cleaned column.
- This script only reads raw/clean output and the read-only reference assets;
  it writes only review_<prompt>.png into round1/.

Usage: python3 scripts/imagegen/review.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = Path("/Users/decker/Documents/cyberdash/imagegen-output/round1")
RAW_DIR = OUTPUT_DIR / "raw"
CLEAN_DIR = OUTPUT_DIR / "clean"

PLAYER_DIR = REPO_ROOT / "public" / "assets" / "player"
VENDING_MACHINE = Path(
    "/Users/decker/Documents/cyberdash/asset_packs/Isometric Cyberpunk Streets/"
    "Isometric Cyberpunk Streets/Props/Cyberpunk Streets-160-Drink Dispenser-0.png"
)

REFERENCE_FOR_PROMPT = {
    "turnaround": PLAYER_DIR / "south-east.png",
    "walkcycle": PLAYER_DIR / "walk-south-east.png",
    "prop": VENDING_MACHINE,
}

ROW_HEIGHT = 300
LABEL_W = 220
PAD = 12
BG = (24, 24, 28, 255)
PANEL_BG = (40, 40, 46, 255)
TEXT_COLOR = (230, 230, 235, 255)
MAX_CLEAN_SCALE = 4


def load_font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


FONT = load_font(16)
FONT_SMALL = load_font(12)


def fit_in_box(img: Image.Image, box_w: int, box_h: int) -> Image.Image:
    scale = min(box_w / img.width, box_h / img.height)
    new_w = max(1, round(img.width * scale))
    new_h = max(1, round(img.height * scale))
    resized = img.resize((new_w, new_h), Image.NEAREST)
    canvas = Image.new("RGBA", (box_w, box_h), PANEL_BG)
    canvas.paste(resized, ((box_w - new_w) // 2, (box_h - new_h) // 2), resized)
    return canvas


def build_clean_strip(frame_paths: list[Path]) -> Image.Image | None:
    if not frame_paths:
        return None
    frames = [Image.open(p).convert("RGBA") for p in frame_paths]
    native_h = max(f.height for f in frames)
    scale = min(MAX_CLEAN_SCALE, max(1, ROW_HEIGHT // native_h))
    gap = 6
    total_w = sum(f.width for f in frames) * scale + gap * (len(frames) + 1)
    total_h = native_h * scale + 2 * gap
    strip = Image.new("RGBA", (total_w, total_h), PANEL_BG)
    x = gap
    for f in frames:
        big = f.resize((f.width * scale, f.height * scale), Image.NEAREST)
        strip.paste(big, (x, gap), big)
        x += big.width + gap
    return strip


def label_cell(text: str, w: int, h: int) -> Image.Image:
    cell = Image.new("RGBA", (w, h), BG)
    draw = ImageDraw.Draw(cell)
    # simple word-wrap for long model slugs
    words = text.split("/")
    lines = ["/".join(words[:1]), "/".join(words[1:])] if len(words) > 1 else [text]
    y = h // 2 - 10 * len(lines)
    for line in lines:
        draw.text((PAD, y), line, font=FONT, fill=TEXT_COLOR)
        y += 20
    return cell


def build_prompt_sheet(prompt_id: str) -> Image.Image | None:
    ref_path = REFERENCE_FOR_PROMPT[prompt_id]
    ref_img = Image.open(ref_path).convert("RGBA")

    rows: list[tuple[str, Image.Image, Image.Image, Image.Image]] = []
    clean_widths = [0]
    raw_widths = [0]

    for model_dir in sorted(RAW_DIR.iterdir()):
        if not model_dir.is_dir():
            continue
        raw_path = model_dir / f"{prompt_id}.png"
        if not raw_path.exists():
            continue
        model_slug = model_dir.name.replace("__", "/")

        raw_img = Image.open(raw_path).convert("RGBA")
        raw_cell = fit_in_box(raw_img, 320, ROW_HEIGHT)
        raw_widths.append(raw_cell.width)

        frame_paths = sorted((CLEAN_DIR / model_dir.name / prompt_id).glob("frame_*.png")) \
            if (CLEAN_DIR / model_dir.name / prompt_id).exists() else []
        clean_strip = build_clean_strip(frame_paths)
        if clean_strip is None:
            clean_cell = Image.new("RGBA", (260, ROW_HEIGHT), PANEL_BG)
            d = ImageDraw.Draw(clean_cell)
            d.text((PAD, ROW_HEIGHT // 2 - 8), "no cleaned frames", font=FONT_SMALL, fill=TEXT_COLOR)
        else:
            clean_cell = fit_in_box(clean_strip, max(clean_strip.width, 260), ROW_HEIGHT)
        clean_widths.append(clean_cell.width)

        ref_cell = fit_in_box(ref_img, 320, ROW_HEIGHT)

        rows.append((model_slug, raw_cell, clean_cell, ref_cell))

    if not rows:
        return None

    raw_w = max(raw_widths)
    clean_w = max(clean_widths)
    ref_w = ref_cell.width  # same for every row

    header_h = 36
    total_w = LABEL_W + raw_w + clean_w + ref_w + 4 * PAD
    total_h = header_h + len(rows) * (ROW_HEIGHT + PAD) + PAD
    sheet = Image.new("RGBA", (total_w, total_h), BG)
    draw = ImageDraw.Draw(sheet)

    x = LABEL_W
    for title, w in [("raw", raw_w), ("cleaned (enlarged)", clean_w), ("reference", ref_w)]:
        draw.text((x + PAD, 8), title, font=FONT, fill=TEXT_COLOR)
        x += w + PAD

    y = header_h
    for model_slug, raw_cell, clean_cell, ref_cell in rows:
        label = label_cell(model_slug, LABEL_W, ROW_HEIGHT)
        sheet.paste(label, (0, y))
        x = LABEL_W
        sheet.paste(raw_cell, (x, y))
        x += raw_w + PAD
        sheet.paste(clean_cell, (x, y))
        x += clean_w + PAD
        sheet.paste(ref_cell, (x, y))
        y += ROW_HEIGHT + PAD

    return sheet


def main() -> None:
    for prompt_id in ["turnaround", "walkcycle", "prop"]:
        print(f"[REVIEW] building sheet for {prompt_id}")
        sheet = build_prompt_sheet(prompt_id)
        if sheet is None:
            print(f"  no rows for {prompt_id}, skipping")
            continue
        dest = OUTPUT_DIR / f"review_{prompt_id}.png"
        sheet.convert("RGB").save(dest)
        print(f"  saved {dest} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
