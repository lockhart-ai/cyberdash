#!/usr/bin/env python3
"""Build one review sheet per subject: concept image(s), the bridge A
render, the bridge C render, and the in-game reference(s), labeled, stacked
vertically.

Assumptions (stated up front):
- Reads bridge_3d.py's and bridge_carve.py's own outputs - concept images
  from /tmp/structured_work/, render strips from
  /Users/decker/Documents/cyberdash/structured-output/round1/<subject>/ -
  plus the same read-only in-game reference sprites under public/assets/
  bridge_3d.py already uses for style guidance. Never reads or writes
  asset_packs/ or public/assets/.
- Two different kinds of image need two different scaling treatments on one
  sheet: the gpt-image-2 concept art is continuous-tone, so it's downscaled
  with LANCZOS to fit the row width; the voxel render strips and the
  in-game reference sprites are real pixel art, so they're scaled by a
  nearest-neighbour INTEGER zoom factor (never LANCZOS) to stay crisp, per
  the task brief's "pixel art nearest-neighbour" instruction.
- Sheet width is capped at MAX_SHEET_WIDTH (2000px); only the concept-art
  rows ever need the cap (render strips and reference sprites are already
  far narrower after their integer zoom).
- Writes only review_<subject>.png into
  /Users/decker/Documents/cyberdash/structured-output/round1/.

Usage:
  python3 scripts/structured/review.py
  python3 scripts/structured/review.py --subject punk
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bridge_3d as b3d  # noqa: E402  (reused: SUBJECTS, WORK_DIR, OUT_ROOT)

SPRITES_DIR = REPO_ROOT / "public" / "assets" / "sprites"
PLAYER_DIR = REPO_ROOT / "public" / "assets" / "player"

MAX_SHEET_WIDTH = 2000
OUTER_PAD = 16
ROW_GAP = 14
LABEL_H = 18
BG_COLOR = (24, 26, 30)
TEXT_COLOR = (235, 235, 235)
RENDER_TARGET_H = 220  # target on-screen height for voxel render strips


def fit_width_smooth(img: Image.Image, max_w: int) -> Image.Image:
    if img.width <= max_w:
        return img
    scale = max_w / img.width
    return img.resize((max_w, max(1, int(img.height * scale))), Image.LANCZOS)


def zoom_nearest_to_height(img: Image.Image, target_h: int) -> Image.Image:
    zoom = max(1, round(target_h / img.height))
    return img.resize((img.width * zoom, img.height * zoom), Image.NEAREST)


def reference_strip(subject_key: str) -> Image.Image:
    """Composite of the in-game reference sprite(s) bridge_3d.py used for
    style guidance, enlarged nearest-neighbour, concatenated horizontally."""
    subject = b3d.SUBJECTS[subject_key]
    imgs = []
    for ref_key in subject["style_refs"]:
        path, _scale = b3d.REF_SPECS[ref_key]
        im = Image.open(path).convert("RGBA")
        im = zoom_nearest_to_height(im, RENDER_TARGET_H)
        imgs.append(im)
    gap = 12
    total_w = sum(im.width for im in imgs) + gap * (len(imgs) - 1)
    max_h = max(im.height for im in imgs)
    strip = Image.new("RGBA", (total_w, max_h), (0, 0, 0, 0))
    x = 0
    for im in imgs:
        strip.paste(im, (x, max_h - im.height), im)
        x += im.width + gap
    return strip


def build_sheet(subject_key: str) -> Path:
    rows: list[tuple[str, Image.Image]] = []

    concept_a_path = b3d.WORK_DIR / f"{subject_key}_bridge_a_concept.png"
    concept_c_path = b3d.WORK_DIR / f"{subject_key}_bridge_c_concept.png"
    strip_a_path = b3d.OUT_ROOT / subject_key / "bridge_a_strip.png"
    strip_c_path = b3d.OUT_ROOT / subject_key / "bridge_c_strip.png"

    inner_max_w = MAX_SHEET_WIDTH - 2 * OUTER_PAD

    if concept_a_path.exists():
        img = Image.open(concept_a_path).convert("RGBA")
        rows.append(("concept (bridge A input: single 3/4 view)", fit_width_smooth(img, inner_max_w)))
    if concept_c_path.exists():
        img = Image.open(concept_c_path).convert("RGBA")
        rows.append(("concept (bridge C input: front / side / top blueprint)", fit_width_smooth(img, inner_max_w)))
    if strip_a_path.exists():
        img = Image.open(strip_a_path).convert("RGBA")
        rows.append(("bridge A render (image -> 3D mesh -> voxels)", zoom_nearest_to_height(img, RENDER_TARGET_H)))
    if strip_c_path.exists():
        img = Image.open(strip_c_path).convert("RGBA")
        rows.append(("bridge C render (orthographic views -> carved voxels)", zoom_nearest_to_height(img, RENDER_TARGET_H)))

    rows.append(("in-game reference(s) used as style guidance", reference_strip(subject_key)))

    font = ImageFont.load_default()
    sheet_w = max(im.width for _, im in rows) + 2 * OUTER_PAD
    sheet_w = min(sheet_w, MAX_SHEET_WIDTH)
    sheet_h = OUTER_PAD + sum(LABEL_H + im.height + ROW_GAP for _, im in rows)

    sheet = Image.new("RGB", (sheet_w, sheet_h), BG_COLOR)
    draw = ImageDraw.Draw(sheet)
    y = OUTER_PAD
    for label, img in rows:
        draw.text((OUTER_PAD, y), f"{subject_key}: {label}", fill=TEXT_COLOR, font=font)
        y += LABEL_H
        if img.mode == "RGBA":
            sheet.paste(img, (OUTER_PAD, y), img)
        else:
            sheet.paste(img, (OUTER_PAD, y))
        y += img.height + ROW_GAP

    out_path = b3d.OUT_ROOT / f"review_{subject_key}.png"
    sheet.save(out_path)
    return out_path


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--subject", choices=list(b3d.SUBJECTS) + ["all"], default="all")
    args = parser.parse_args()

    subjects = list(b3d.SUBJECTS) if args.subject == "all" else [args.subject]
    for subject_key in subjects:
        path = build_sheet(subject_key)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
