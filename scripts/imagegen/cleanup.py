#!/usr/bin/env python3
"""Turn a raw model-generated reference sheet into real pixel-art frames.

Assumptions (stated up front):
- Input is a raw PNG with a flat pure-magenta (#FF00FF) background, produced by
  generate.py, containing N figures/rotations evenly spaced in a single row
  (N = 8 for the turnaround prompt, 6 for the walk-cycle prompt, 4 for the prop
  prompt).
- Measured fact, not an assumption: the raw renders from every model we tried
  turned out to be continuous-tone / high-resolution "pixel-art styled" art,
  not literal blocky low-res pixel art - per-pixel run-length analysis (looking
  for flat-colour runs and for hard edges above a contrast threshold) found no
  consistent block grid bigger than 1px in any of them. So this script still
  *measures* the apparent pixel size per frame (in case some model does hand us
  real block-scaled art), and majority-downsamples by that cell size when it's
  >1px; when it's 1px (what we saw in practice) it instead does a quality
  (box-filter) downscale to the target sprite resolution, since naive
  nearest-neighbour sampling of noisy/continuous source pixels just produces
  speckle, not clean pixel art.
- Order per frame: trim to content -> measure/apply block size -> downscale to
  target resolution -> reduce to a small palette -> snap alpha to pure 0/255
  (the courier reference itself only ever uses alpha 0 or 255 - no
  anti-aliased edges - so cleaned frames match that) -> add a 1px dark outline
  anywhere the silhouette edge doesn't already have one.
- Character frames (turnaround, walkcycle) are then placed on a 64x64 canvas
  with the figure ~44px tall and feet on the same baseline row as the courier
  reference (public/assets/player/south.png: content bbox y 10..55, so
  baseline row 55 of a 64px frame). Prop frames are scaled to PROP_TARGET_H
  tall and left trimmed to their own content, no fixed canvas (the brief gives
  a canvas spec for characters only).
- We only ever read raw/* and write into clean/*.

Usage:
  python3 scripts/imagegen/cleanup.py                 # process everything in raw/
  python3 scripts/imagegen/cleanup.py --model google/gemini-3-pro-image --prompt prop
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

OUTPUT_DIR = Path("/Users/decker/Documents/cyberdash/imagegen-output/round1")
RAW_DIR = OUTPUT_DIR / "raw"
CLEAN_DIR = OUTPUT_DIR / "clean"

EXPECTED_FRAMES = {"turnaround": 8, "walkcycle": 6, "prop": 4}
MAX_COLORS = {"turnaround": 24, "walkcycle": 24, "prop": 32}
IS_CHARACTER = {"turnaround": True, "walkcycle": True, "prop": False}

# Measured from public/assets/player/south.png: alpha>10 bbox is y:10..55, x:23..40
# (46px tall, in a 64x64 frame; alpha is pure 0/255, no AA). We target a
# slightly smaller ~44px figure height per the brief, feet pinned to the same
# baseline row, and match that binary-alpha convention in cleaned output.
COURIER_FRAME = 64
COURIER_BASELINE_Y = 55  # bottom row (feet) of the reference figure
COURIER_TARGET_HEIGHT = 44

# No equivalent in-game reference scale was specified for the prop; this is a
# reasonable "genuinely downsized, still readable" target, not a measured
# constant.
PROP_TARGET_HEIGHT = 140

MAGENTA = np.array([255, 0, 255])
ALPHA_THRESHOLD = 128


def detect_background_color(arr: np.ndarray) -> np.ndarray:
    """Sample a thin border strip around the sheet and take its modal colour.
    We asked every model for a flat pure-magenta (#FF00FF) background, but
    not all of them render exactly that shade - keying against the colour
    they actually used is far more robust than assuming #FF00FF outright."""
    h, w = arr.shape[:2]
    bh, bw = max(1, h // 50), max(1, w // 50)
    border = np.concatenate([
        arr[:bh, :, :3].reshape(-1, 3),
        arr[-bh:, :, :3].reshape(-1, 3),
        arr[:, :bw, :3].reshape(-1, 3),
        arr[:, -bw:, :3].reshape(-1, 3),
    ])
    colors, counts = np.unique(border, axis=0, return_counts=True)
    return colors[np.argmax(counts)].astype(np.float64)


def key_out_magenta(img: Image.Image, low: float = 50.0, high: float = 140.0) -> Image.Image:
    """Chroma-key the detected background colour out with a soft falloff
    between `low` and `high` colour distance, rather than one hard cutoff:
    models asked for "no anti-aliasing" still render a faint tinted halo a
    few pixels wide around the subject, and a single tolerance either leaves
    that halo (too low) or eats real near-background subject colour (too
    high)."""
    arr = np.array(img.convert("RGBA")).astype(np.float64)
    bg = detect_background_color(arr)
    off_magenta = np.sqrt(((bg - MAGENTA) ** 2).sum())
    if off_magenta > 60:
        print(f"    [note] background isn't pure magenta, got rgb{tuple(bg.astype(int))} "
              f"(distance {off_magenta:.0f} from #FF00FF) - keying against that instead")
    dist = np.sqrt(((arr[..., :3] - bg) ** 2).sum(axis=-1))
    alpha_mult = np.clip((dist - low) / (high - low), 0.0, 1.0)
    arr[..., 3] = arr[..., 3] * alpha_mult
    # Zero the RGB of near-fully-keyed pixels too, so later quality resizes
    # blend transparent neighbours toward black instead of bleeding the
    # background colour into edge pixels (PIL's resize doesn't premultiply
    # alpha).
    arr[alpha_mult < 0.2, 0:3] = 0
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def estimate_cell_size(img: Image.Image, max_cell: int = 48, edge_threshold: int = 40) -> int:
    """Estimate the apparent pixel-art cell size from gaps between *significant*
    colour edges (ignoring small deltas from noise/dithering/soft shading)."""
    arr = np.array(img).astype(np.int16)
    h, w = arr.shape[:2]
    if h < 2 or w < 2:
        return 1
    gaps: list[int] = []
    row_step = max(1, h // 150)
    col_step = max(1, w // 150)
    for y in range(0, h, row_step):
        row = arr[y]
        delta = np.abs(row[1:] - row[:-1]).max(axis=-1)
        changes = np.where(delta > edge_threshold)[0] + 1
        if len(changes) > 1:
            gaps.extend(np.diff(changes).tolist())
    for x in range(0, w, col_step):
        col = arr[:, x]
        delta = np.abs(col[1:] - col[:-1]).max(axis=-1)
        changes = np.where(delta > edge_threshold)[0] + 1
        if len(changes) > 1:
            gaps.extend(np.diff(changes).tolist())
    gaps_arr = np.array([g for g in gaps if 1 <= g <= max_cell])
    if len(gaps_arr) == 0:
        return 1
    counts = np.bincount(gaps_arr)
    return int(np.argmax(counts))


def downsample_majority(img: Image.Image, cell: int) -> Image.Image:
    if cell <= 1:
        return img
    arr = np.array(img)
    h, w = arr.shape[:2]
    new_h, new_w = h // cell, w // cell
    if new_h == 0 or new_w == 0:
        return img
    trimmed = arr[: new_h * cell, : new_w * cell]
    out = np.zeros((new_h, new_w, 4), dtype=np.uint8)
    for j in range(new_h):
        for i in range(new_w):
            block = trimmed[j * cell:(j + 1) * cell, i * cell:(i + 1) * cell].reshape(-1, 4)
            colors, counts = np.unique(block, axis=0, return_counts=True)
            out[j, i] = colors[np.argmax(counts)]
    return Image.fromarray(out)


def reduce_palette(img: Image.Image, max_colors: int) -> Image.Image:
    arr = np.array(img.convert("RGBA"))
    alpha = arr[..., 3]
    opaque = alpha > 10
    if not opaque.any():
        return img
    rgb = Image.fromarray(arr[..., :3])
    quant = rgb.convert("P", palette=Image.ADAPTIVE, colors=max_colors).convert("RGB")
    out_rgb = np.array(quant)
    out = np.dstack([out_rgb, alpha])
    out[~opaque] = [0, 0, 0, 0]
    return Image.fromarray(out.astype(np.uint8))


def snap_alpha(img: Image.Image, threshold: int = ALPHA_THRESHOLD) -> Image.Image:
    """Match the courier reference's binary (0/255) alpha - no anti-aliased edges."""
    arr = np.array(img.convert("RGBA"))
    alpha = arr[..., 3]
    binary = np.where(alpha >= threshold, 255, 0).astype(np.uint8)
    arr[..., 3] = binary
    arr[binary == 0, 0:3] = 0
    return Image.fromarray(arr)


def add_outline(img: Image.Image, dark_threshold: float = 70.0, darken_factor: float = 0.35) -> Image.Image:
    arr = np.array(img.convert("RGBA")).astype(np.int16)
    alpha = arr[..., 3]
    opaque = alpha > 10
    lum = 0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]
    pad = np.pad(opaque, 1, mode="constant", constant_values=False)
    up, down = pad[:-2, 1:-1], pad[2:, 1:-1]
    left, right = pad[1:-1, :-2], pad[1:-1, 2:]
    on_border = opaque & (~up | ~down | ~left | ~right)
    needs_outline = on_border & (lum > dark_threshold)
    arr[needs_outline, 0:3] = (arr[needs_outline, 0:3] * darken_factor).astype(np.int16)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def _find_runs(has_content: np.ndarray, min_width: float) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    in_run, start = False, 0
    for i, has in enumerate(has_content):
        if has and not in_run:
            start, in_run = i, True
        elif not has and in_run:
            runs.append((start, i))
            in_run = False
    if in_run:
        runs.append((start, len(has_content)))
    return [r for r in runs if r[1] - r[0] > min_width]


def segment_frames(img: Image.Image, expected_count: int) -> list[tuple[int, int, int, int]]:
    """Split a sheet into expected_count (x0, y0, x1, y1) frame boxes.

    Most prompts ask for a single row, but a model sometimes ignores that and
    draws an NxM grid instead (observed: gemini-3-pro-image drew the 8-pose
    turnaround as a 4x2 grid). So this first finds row-bands by empty-row
    gaps, then column segments within each band, and reads the grid in
    row-major order; a single-row sheet is just the N=1 case of the same
    logic. If the natural grid doesn't add up to expected_count (touching
    figures, stray noise band, etc.), each row-band's share of
    expected_count is split evenly across its own content width instead."""
    arr = np.array(img)
    alpha = arr[..., 3]
    h, w = alpha.shape
    row_has_content = (alpha > 10).any(axis=1)
    row_min_height = max(3, (h / max(expected_count, 1)) * 0.05)
    row_bands = _find_runs(row_has_content, row_min_height)
    if not row_bands:
        return []

    col_min_width = max(3, (w / expected_count) * 0.15)
    band_cols: list[list[tuple[int, int]]] = []
    for y0, y1 in row_bands:
        col_has_content = (alpha[y0:y1] > 10).any(axis=0)
        band_cols.append(_find_runs(col_has_content, col_min_width))

    total_found = sum(len(cols) for cols in band_cols)
    if total_found == expected_count:
        boxes = []
        for (y0, y1), cols in zip(row_bands, band_cols):
            for x0, x1 in cols:
                boxes.append((x0, y0, x1, y1))
        return boxes

    # Fallback: distribute expected_count across bands by each band's share
    # of total content width, then evenly split each band's own content bbox.
    band_widths = []
    for y0, y1 in row_bands:
        xs = np.where((alpha[y0:y1] > 10).any(axis=0))[0]
        band_widths.append((int(xs.min()), int(xs.max()) + 1) if len(xs) else (0, 0))
    total_width = sum(x1 - x0 for x0, x1 in band_widths) or 1

    remaining = expected_count
    boxes = []
    for band_idx, ((y0, y1), (x0, x1)) in enumerate(zip(row_bands, band_widths)):
        is_last_band = band_idx == len(row_bands) - 1
        if is_last_band:
            count = remaining
        else:
            count = max(1, round(expected_count * (x1 - x0) / total_width))
            count = min(count, remaining - (len(row_bands) - band_idx - 1))
        remaining -= count
        if count <= 0 or x1 <= x0:
            continue
        step = (x1 - x0) / count
        for i in range(count):
            boxes.append((int(x0 + i * step), y0, int(x0 + (i + 1) * step), y1))
    return boxes


def trim_to_content(img: Image.Image) -> Image.Image | None:
    arr = np.array(img)
    alpha = arr[..., 3]
    ys, xs = np.where(alpha > 10)
    if len(ys) == 0:
        return None
    return img.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def place_on_character_canvas(figure: Image.Image) -> Image.Image:
    """Paste an already target-height figure onto the courier's 64x64 frame,
    feet on the same baseline row, horizontally centred."""
    canvas = Image.new("RGBA", (COURIER_FRAME, COURIER_FRAME), (0, 0, 0, 0))
    x = (COURIER_FRAME - figure.width) // 2
    y = COURIER_BASELINE_Y - figure.height + 1
    canvas.paste(figure, (x, y), figure)
    return canvas


def process_frame(strip: Image.Image, prompt_id: str) -> Image.Image | None:
    content = trim_to_content(strip)
    if content is None:
        return None

    cell = estimate_cell_size(content)
    if cell > 1:
        pixelated = downsample_majority(content, cell)
        resize_filter = Image.NEAREST  # already genuine blocky pixel art, keep it crisp
    else:
        pixelated = content
        resize_filter = Image.BOX  # continuous-tone source: quality downscale, not speckle

    target_h = COURIER_TARGET_HEIGHT if IS_CHARACTER[prompt_id] else PROP_TARGET_HEIGHT
    if pixelated.height <= 0:
        return None
    scale = target_h / pixelated.height
    new_w = max(1, round(pixelated.width * scale))
    new_h = max(1, round(pixelated.height * scale))
    resized = pixelated.resize((new_w, new_h), resize_filter)

    reduced = reduce_palette(resized, MAX_COLORS[prompt_id])
    snapped = snap_alpha(reduced)
    trimmed = trim_to_content(snapped)
    if trimmed is None:
        return None
    outlined = add_outline(trimmed)

    if IS_CHARACTER[prompt_id]:
        return place_on_character_canvas(outlined)
    return outlined


def process_one(raw_path: Path, prompt_id: str, out_dir: Path) -> list[Path]:
    img = Image.open(raw_path).convert("RGBA")
    keyed = key_out_magenta(img)
    expected = EXPECTED_FRAMES[prompt_id]
    segments = segment_frames(keyed, expected)

    out_dir.mkdir(parents=True, exist_ok=True)
    saved: list[Path] = []
    for idx, (x0, y0, x1, y1) in enumerate(segments):
        strip = keyed.crop((x0, y0, x1, y1))
        frame = process_frame(strip, prompt_id)
        if frame is None:
            continue
        dest = out_dir / f"frame_{idx}.png"
        frame.save(dest)
        saved.append(dest)

    print(f"  frames={len(saved)}/{expected} -> {out_dir}")
    return saved


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=None, help="only this model slug (e.g. google/gemini-3-pro-image)")
    parser.add_argument("--prompt", default=None, choices=list(EXPECTED_FRAMES), help="only this prompt id")
    args = parser.parse_args()

    for model_dir in sorted(RAW_DIR.iterdir()):
        if not model_dir.is_dir():
            continue
        model_slug = model_dir.name.replace("__", "/")
        if args.model and model_slug != args.model:
            continue
        for raw_path in sorted(model_dir.glob("*.png")):
            prompt_id = raw_path.stem
            if prompt_id not in EXPECTED_FRAMES:
                continue
            if args.prompt and prompt_id != args.prompt:
                continue
            out_dir = CLEAN_DIR / model_dir.name / prompt_id
            print(f"[CLEAN] {model_slug} / {prompt_id}")
            process_one(raw_path, prompt_id, out_dir)


if __name__ == "__main__":
    main()
