#!/usr/bin/env python3
"""Build review sheets: one for people (turnaround + walkcycle together),
one per prop. Rows = models; columns = raw thumbnail(s), cleaned frames
(enlarged, nearest-neighbour), and the reference image(s) actually used.

Assumptions (stated up front):
- Reads raw/<model>/<prompt>.png, clean/<model>/<prompt>/frame_*.png, and
  clean/<model>/<prompt>/meta.json (written by generate.py and cleanup.py
  respectively) under /Users/decker/Documents/cyberdash/imagegen-output/
  round<N>/.
- Every sheet is capped at MAX_SHEET_WIDTH (2000px): column widths are fixed
  budgets, and both raw thumbnails and cleaned-frame strips are scaled DOWN
  with nearest-neighbour to fit their column rather than left at native size,
  so pixel art stays crisp but the sheet never exceeds the cap.
- Each cleaned strip is labelled with how many of its frames took the "grid"
  path (real block-grid detected and majority-voted) vs the "fallback" path
  (no reliable grid found, quality box-downscale instead) - meta.json says
  which, per frame; silently always picking one would hide exactly the
  thing round 2 was supposed to measure.
- Round 2's props reference three in-game sprites (public/assets/sprites/
  light_pole.png, parking_meter.png, cars/cars-0.png), shown as one composite
  reference thumbnail next to every prop row. One probe call
  (black-forest-labs/flux-3-image's first prop_phone_booth attempt) ran
  before that switch, using the old asset-pack references (a vending machine
  and a phone booth); that result is kept as a separate, clearly labelled row
  on the prop_phone_booth sheet with its own (old-ref) reference thumbnail,
  per Jared's instruction to keep-but-label rather than discard it.
- This script only reads raw/clean output and the read-only reference
  assets; it writes only review_<name>.png into round<N>/.

Usage:
  python3 scripts/imagegen/review.py --round 2
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[2]
IMAGEGEN_ROOT = Path("/Users/decker/Documents/cyberdash/imagegen-output")

PLAYER_DIR = REPO_ROOT / "public" / "assets" / "player"
SPRITES_DIR = REPO_ROOT / "public" / "assets" / "sprites"
LIGHT_POLE = SPRITES_DIR / "light_pole.png"
PARKING_METER = SPRITES_DIR / "parking_meter.png"
CAR_REF = SPRITES_DIR / "cars" / "cars-0.png"

# Round 1's single generic "prop" prompt used these asset-pack references;
# kept here only to label the one round-2 probe call that still used them.
OLD_VENDING_MACHINE = Path(
    "/Users/decker/Documents/cyberdash/asset_packs/Isometric Cyberpunk Streets/"
    "Isometric Cyberpunk Streets/Props/Cyberpunk Streets-160-Drink Dispenser-0.png"
)
OLD_PHONE_BOOTH = Path(
    "/Users/decker/Documents/cyberdash/asset_packs/Isometric City/Isometric City/"
    "Props/City-103-phone_booth.png"
)

PROP_PROMPTS = ["prop_newspaper_box", "prop_phone_booth", "prop_food_stall", "prop_drone"]

BG = (24, 24, 28, 255)
PANEL_BG = (40, 40, 46, 255)
TEXT_COLOR = (230, 230, 235, 255)
DIM_TEXT = (170, 170, 178, 255)
MAX_SHEET_WIDTH = 2000


def load_font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


FONT = load_font(15)
FONT_SMALL = load_font(11)


def fit_in_box(img: Image.Image, box_w: int, box_h: int) -> Image.Image:
    """Scale (up or down) with nearest-neighbour to fit inside box_w x box_h,
    preserving aspect ratio, centred on a panel-coloured canvas of exactly
    that size - this is what keeps every sheet under MAX_SHEET_WIDTH."""
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
    gap = 5
    strip = Image.new("RGBA", (sum(f.width for f in frames) + gap * (len(frames) + 1), native_h + 2 * gap), PANEL_BG)
    x = gap
    for f in frames:
        strip.paste(f, (x, gap), f)
        x += f.width + gap
    return strip


def path_summary(out_dir: Path) -> str:
    meta_path = out_dir / "meta.json"
    if not meta_path.exists():
        return ""
    meta = json.loads(meta_path.read_text())
    grid_n = sum(1 for m in meta if m.get("grid_path") == "grid")
    fallback_n = sum(1 for m in meta if m.get("grid_path") == "fallback")
    color_paths = {m.get("color_path") for m in meta if m.get("color_path")}
    bits = []
    if grid_n or fallback_n:
        bits.append(f"grid {grid_n}/{len(meta)}" if grid_n else f"fallback {fallback_n}/{len(meta)}")
        if fallback_n and grid_n:
            bits[-1] = f"grid {grid_n}, fallback {fallback_n}"
    if color_paths:
        bits.append("+".join(sorted(color_paths)) + " colour")
    return ", ".join(bits)


def label_cell(text: str, w: int, h: int, sublines: list[str] | None = None) -> Image.Image:
    cell = Image.new("RGBA", (w, h), BG)
    draw = ImageDraw.Draw(cell)
    parts = text.split("/")
    lines = (["/".join(parts[:1]), "/".join(parts[1:])] if len(parts) > 1 else [text]) + (sublines or [])
    y = max(6, h // 2 - 10 * len(lines))
    for i, line in enumerate(lines):
        font = FONT if i < 2 else FONT_SMALL
        color = TEXT_COLOR if i < 2 else DIM_TEXT
        draw.text((10, y), line, font=font, fill=color)
        y += 20 if i < 2 else 15
    return cell


def build_in_game_prop_reference(box_w: int, box_h: int) -> Image.Image:
    imgs = [Image.open(p).convert("RGBA") for p in [LIGHT_POLE, PARKING_METER, CAR_REF]]
    cell_w = box_w // len(imgs)
    composite = Image.new("RGBA", (box_w, box_h), PANEL_BG)
    for i, img in enumerate(imgs):
        thumb = fit_in_box(img, cell_w - 4, box_h - 4)
        composite.paste(thumb, (i * cell_w + 2, 2))
    return composite


def build_old_pack_reference(box_w: int, box_h: int) -> Image.Image:
    imgs = [Image.open(p).convert("RGBA") for p in [OLD_VENDING_MACHINE, OLD_PHONE_BOOTH]]
    cell_w = box_w // len(imgs)
    composite = Image.new("RGBA", (box_w, box_h), PANEL_BG)
    for i, img in enumerate(imgs):
        thumb = fit_in_box(img, cell_w - 4, box_h - 4)
        composite.paste(thumb, (i * cell_w + 2, 2))
    return composite


def build_people_sheet(raw_dir: Path, clean_dir: Path) -> Image.Image | None:
    label_w, raw_w, turn_clean_w, walk_raw_w, walk_clean_w, ref_w = 150, 100, 760, 90, 600, 120
    row_h = 240
    pad = 10

    ref_cell = fit_in_box(Image.open(PLAYER_DIR / "south-east.png").convert("RGBA"), ref_w, row_h)

    rows = []
    for model_dir in sorted(raw_dir.iterdir()):
        if not model_dir.is_dir():
            continue
        turn_raw = model_dir / "turnaround.png"
        walk_raw = model_dir / "walkcycle.png"
        if not turn_raw.exists() and not walk_raw.exists():
            continue
        model_slug = model_dir.name.replace("__", "/")

        def cell_for(prompt_id: str, raw_path: Path, raw_box_w: int, clean_box_w: int):
            if not raw_path.exists():
                raw_cell = Image.new("RGBA", (raw_box_w, row_h), PANEL_BG)
                clean_cell = Image.new("RGBA", (clean_box_w, row_h), PANEL_BG)
                d = ImageDraw.Draw(clean_cell)
                d.text((8, row_h // 2 - 8), "(failed)", font=FONT_SMALL, fill=DIM_TEXT)
                return raw_cell, clean_cell
            raw_cell = fit_in_box(Image.open(raw_path).convert("RGBA"), raw_box_w, row_h)
            frame_dir = clean_dir / model_dir.name / prompt_id
            frames = sorted(frame_dir.glob("frame_*.png"), key=lambda p: int(p.stem.split("_")[1])) \
                if frame_dir.exists() else []
            strip = build_clean_strip(frames)
            if strip is None:
                clean_cell = Image.new("RGBA", (clean_box_w, row_h), PANEL_BG)
                ImageDraw.Draw(clean_cell).text((8, row_h // 2 - 8), "no cleaned frames", font=FONT_SMALL, fill=DIM_TEXT)
            else:
                clean_cell = fit_in_box(strip, clean_box_w, row_h - 16)
                full = Image.new("RGBA", (clean_box_w, row_h), PANEL_BG)
                full.paste(clean_cell, (0, 0))
                summary = path_summary(frame_dir)
                if summary:
                    ImageDraw.Draw(full).text((6, row_h - 15), summary, font=FONT_SMALL, fill=DIM_TEXT)
                clean_cell = full
            return raw_cell, clean_cell

        turn_raw_cell, turn_clean_cell = cell_for("turnaround", turn_raw, raw_w, turn_clean_w)
        walk_raw_cell, walk_clean_cell = cell_for("walkcycle", walk_raw, walk_raw_w, walk_clean_w)
        rows.append((model_slug, turn_raw_cell, turn_clean_cell, walk_raw_cell, walk_clean_cell))

    if not rows:
        return None

    header_h = 48
    total_w = label_w + raw_w + turn_clean_w + walk_raw_w + walk_clean_w + ref_w + 6 * pad
    total_h = header_h + len(rows) * (row_h + pad) + pad
    sheet = Image.new("RGBA", (total_w, total_h), BG)
    draw = ImageDraw.Draw(sheet)

    x = label_w
    for title, w in [("turnaround: raw", raw_w), ("turnaround: cleaned", turn_clean_w),
                      ("walk: raw", walk_raw_w), ("walk: cleaned", walk_clean_w), ("reference", ref_w)]:
        draw.text((x + pad, 10), title, font=FONT, fill=TEXT_COLOR)
        x += w + pad
    draw.text((label_w + pad, 30), "(courier south-east + walk-south-east, palette swatch attached)", font=FONT_SMALL, fill=DIM_TEXT)

    y = header_h
    for model_slug, turn_raw_cell, turn_clean_cell, walk_raw_cell, walk_clean_cell in rows:
        sheet.paste(label_cell(model_slug, label_w, row_h), (0, y))
        x = label_w
        for cell, w in [(turn_raw_cell, raw_w), (turn_clean_cell, turn_clean_w),
                        (walk_raw_cell, walk_raw_w), (walk_clean_cell, walk_clean_w), (ref_cell, ref_w)]:
            sheet.paste(cell, (x, y))
            x += w + pad
        y += row_h + pad

    assert total_w <= MAX_SHEET_WIDTH, f"people sheet is {total_w}px wide, over the {MAX_SHEET_WIDTH}px cap"
    return sheet


def build_prop_sheet(prompt_id: str, raw_dir: Path, clean_dir: Path) -> Image.Image | None:
    label_w, raw_w, clean_w, ref_w = 170, 150, 950, 300
    row_h = 220
    pad = 10

    in_game_ref = build_in_game_prop_reference(ref_w, row_h)
    old_ref = build_old_pack_reference(ref_w, row_h) if prompt_id == "prop_phone_booth" else None

    rows = []
    for model_dir in sorted(raw_dir.iterdir()):
        if not model_dir.is_dir():
            continue
        raw_path = model_dir / f"{prompt_id}.png"
        if raw_path.exists():
            model_slug = model_dir.name.replace("__", "/")
            raw_cell = fit_in_box(Image.open(raw_path).convert("RGBA"), raw_w, row_h)
            frame_dir = clean_dir / model_dir.name / prompt_id
            frames = sorted(frame_dir.glob("frame_*.png"), key=lambda p: int(p.stem.split("_")[1])) \
                if frame_dir.exists() else []
            strip = build_clean_strip(frames)
            if strip is None:
                clean_cell = Image.new("RGBA", (clean_w, row_h), PANEL_BG)
                ImageDraw.Draw(clean_cell).text((8, row_h // 2 - 8), "no cleaned frames", font=FONT_SMALL, fill=DIM_TEXT)
            else:
                fitted = fit_in_box(strip, clean_w, row_h - 16)
                clean_cell = Image.new("RGBA", (clean_w, row_h), PANEL_BG)
                clean_cell.paste(fitted, (0, 0))
                summary = path_summary(frame_dir)
                if summary:
                    ImageDraw.Draw(clean_cell).text((6, row_h - 15), summary, font=FONT_SMALL, fill=DIM_TEXT)
            rows.append((model_slug, raw_cell, clean_cell, in_game_ref))

        # The one probe call made before the switch to in-game references.
        oldref_path = model_dir / f"{prompt_id}__oldrefs.png"
        if oldref_path.exists() and old_ref is not None:
            model_slug = model_dir.name.replace("__", "/") + " (OLD pack refs)"
            raw_cell = fit_in_box(Image.open(oldref_path).convert("RGBA"), raw_w, row_h)
            clean_cell = Image.new("RGBA", (clean_w, row_h), PANEL_BG)
            ImageDraw.Draw(clean_cell).text(
                (8, row_h // 2 - 8),
                "not re-cleaned: kept only as a labelled\nprobe of the asset-pack references",
                font=FONT_SMALL, fill=DIM_TEXT)
            rows.append((model_slug, raw_cell, clean_cell, old_ref))

    if not rows:
        return None

    header_h = 32
    total_w = label_w + raw_w + clean_w + ref_w + 4 * pad
    total_h = header_h + len(rows) * (row_h + pad) + pad
    sheet = Image.new("RGBA", (total_w, total_h), BG)
    draw = ImageDraw.Draw(sheet)

    x = label_w
    for title, w in [("raw", raw_w), ("cleaned (enlarged)", clean_w), ("in-game reference used", ref_w)]:
        draw.text((x + pad, 8), title, font=FONT, fill=TEXT_COLOR)
        x += w + pad

    y = header_h
    for model_slug, raw_cell, clean_cell, ref_cell in rows:
        sheet.paste(label_cell(model_slug, label_w, row_h), (0, y))
        x = label_w
        for cell, w in [(raw_cell, raw_w), (clean_cell, clean_w), (ref_cell, ref_w)]:
            sheet.paste(cell, (x, y))
            x += w + pad
        y += row_h + pad

    assert total_w <= MAX_SHEET_WIDTH, f"{prompt_id} sheet is {total_w}px wide, over the {MAX_SHEET_WIDTH}px cap"
    return sheet


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--round", type=int, default=2, help="round number (default 2)")
    args = parser.parse_args()

    output_dir = IMAGEGEN_ROOT / f"round{args.round}"
    raw_dir = output_dir / "raw"
    clean_dir = output_dir / "clean"

    print("[REVIEW] building people sheet (turnaround + walkcycle)")
    sheet = build_people_sheet(raw_dir, clean_dir)
    if sheet is None:
        print("  no rows for people, skipping")
    else:
        dest = output_dir / "review_people.png"
        sheet.convert("RGB").save(dest)
        print(f"  saved {dest} ({sheet.width}x{sheet.height})")

    for prompt_id in PROP_PROMPTS:
        print(f"[REVIEW] building sheet for {prompt_id}")
        sheet = build_prop_sheet(prompt_id, raw_dir, clean_dir)
        if sheet is None:
            print(f"  no rows for {prompt_id}, skipping")
            continue
        dest = output_dir / f"review_{prompt_id}.png"
        sheet.convert("RGB").save(dest)
        print(f"  saved {dest} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
