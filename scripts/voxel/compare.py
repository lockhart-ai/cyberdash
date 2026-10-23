"""Comparison-sheet builder for reviewing voxel renders against the
purchased reference packs.

Assumptions:
- This script only *reads* from asset_packs/ (never writes there — see the
  project's strict asset rules) and only to build throwaway review images;
  nothing it touches lands in public/assets/generated/ or gets committed.
- A "sheet" stacks a render's full 4-frame strip above the matching
  reference's full 4-frame strip, both enlarged by the same nearest-neighbor
  zoom factor (so relative size differences stay visible — this is a
  calibration aid, not a normalized comparison), on a dark background with
  text labels.
- Each reference strip is cropped to its first NUM_FRAMES-equal-width slice
  and trimmed to its opaque bounds per frame, mirroring how renderer.py
  trims its own frames, so the two strips are reasonably comparable.
"""

from __future__ import annotations

import os
from typing import List, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFont

BG_COLOR = (24, 26, 30)
TEXT_COLOR = (235, 235, 235)
ZOOM = 3
OUTER_PAD = 16
ROW_GAP = 10
LABEL_H = 16


def _trim(img: Image.Image) -> Image.Image:
    arr = np.array(img.convert("RGBA"))
    alpha = arr[:, :, 3]
    ys, xs = np.nonzero(alpha)
    if len(xs) == 0:
        return img
    return img.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def reference_strip_frames(path: str, num_frames: int = 4) -> List[Image.Image]:
    """Split a reference spritesheet into its frames, each trimmed to its
    own opaque bounds (read-only; never writes back to asset_packs/)."""
    im = Image.open(path).convert("RGBA")
    fw = im.width // num_frames
    frames = []
    for i in range(num_frames):
        frame = im.crop((i * fw, 0, (i + 1) * fw, im.height))
        frames.append(_trim(frame))
    return frames


def _strip_from_frames(frames: List[Image.Image]) -> Image.Image:
    max_h = max(f.height for f in frames)
    gap = 4
    total_w = sum(f.width for f in frames) + gap * (len(frames) - 1)
    strip = Image.new("RGBA", (total_w, max_h), (0, 0, 0, 0))
    x = 0
    for f in frames:
        strip.paste(f, (x, max_h - f.height), f)
        x += f.width + gap
    return strip


def _enlarge(img: Image.Image, zoom: int = ZOOM) -> Image.Image:
    return img.resize((img.width * zoom, img.height * zoom), Image.NEAREST)


def build_comparison_sheet(
    render_path: str,
    render_label: str,
    reference_path: Optional[str],
    reference_label: str,
    out_path: str,
) -> None:
    render_strip = Image.open(render_path).convert("RGBA")
    rows: List[Tuple[str, Image.Image]] = [(render_label, _enlarge(render_strip))]

    if reference_path is not None:
        ref_frames = reference_strip_frames(reference_path)
        ref_strip = _strip_from_frames(ref_frames)
        rows.append((reference_label, _enlarge(ref_strip)))

    font = ImageFont.load_default()
    max_w = max(im.width for _, im in rows)
    sheet_w = max_w + 2 * OUTER_PAD
    sheet_h = OUTER_PAD + sum(LABEL_H + im.height + ROW_GAP for _, im in rows)

    sheet = Image.new("RGB", (sheet_w, sheet_h), BG_COLOR)
    draw = ImageDraw.Draw(sheet)

    y = OUTER_PAD
    for label, im in rows:
        draw.text((OUTER_PAD, y), label, fill=TEXT_COLOR, font=font)
        y += LABEL_H
        sheet.paste(im, (OUTER_PAD, y), im)
        y += im.height + ROW_GAP

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    sheet.save(out_path)


if __name__ == "__main__":
    import models as model_defs
    from renderer import render_and_save, UNIT_PX

    generated_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "public", "assets", "generated")
    )
    # Reference packs live only in the main checkout, not this worktree (per
    # the task brief) — read-only, absolute path, never written to.
    asset_packs = "/Users/decker/Documents/cyberdash/asset_packs"
    out_dir = "/Users/decker/Documents/cyberdash/voxel-output/round1"

    comparisons = [
        (
            "calibration_mailbox",
            "calibration_mailbox.png (ours)",
            os.path.join(
                asset_packs,
                "Isometric City/Isometric City/Props/City-103-phone_booth.png",
            ),
            "City-103-phone_booth.png (reference, read-only)",
        ),
        (
            "newspaper_box",
            "newspaper_box.png (ours)",
            os.path.join(
                asset_packs,
                "Isometric City/Isometric City/Props/City-106-newspaper booth.png",
            ),
            "City-106-newspaper booth.png (reference, read-only)",
        ),
        (
            "pedestrian",
            "pedestrian.png (ours)",
            os.path.join(
                asset_packs,
                "Isometric Cyberpunk City/Character/Iso_Character_001.png",
            ),
            "Iso_Character_001.png (reference, read-only)",
        ),
    ]

    for name, render_label, ref_path, ref_label in comparisons:
        render_path = render_and_save(name, model_defs.ALL_MODELS[name], generated_dir)
        sheet_path = os.path.join(out_dir, f"compare_{name}.png")
        build_comparison_sheet(render_path, render_label, ref_path, ref_label, sheet_path)
        print(f"wrote {sheet_path}")
