#!/usr/bin/env python3
"""Turn a raw model-generated reference sheet into real pixel-art frames.

Assumptions (stated up front):
- Input is a raw PNG with a flat (ideally pure-magenta #FF00FF) background,
  produced by generate.py, containing N figures/rotations evenly spaced in a
  single row (8 for turnaround, 6 for walkcycle, 4 for every prop prompt).
- Round 1 measured a fact, not an assumption: every model's raw render turned
  out to be continuous-tone / high-resolution "pixel-art styled" art, not
  literal blocky low-res pixel art - a flat-colour-run detector found no real
  block grid bigger than 1px anywhere. Round 2's prompts spell out a literal
  8x8-block grid contract instead, so this round's clean-up tries harder to
  find and use real grid structure when a model actually drew one:
    1. detect_grid() looks for genuine periodicity via autocorrelation of the
       row/column colour-gradient signal (not just flat-colour runs, which
       noise/dithering defeats) and reports a block size, an (x, y) grid
       phase, and a confidence score;
    2. if confidence clears the threshold, downsample_grid() takes the
       majority colour per detected block, anchored at the detected phase
       ("the grid path");
    3. otherwise we fall back to round 1's quality box-filter downscale to
       the target sprite height ("the fallback path") - still needed, since
       not every model honours the grid instruction.
  Each frame's path is recorded in meta.json next to its output and is meant
  to be shown on the review sheet - this matters enough to the "did the model
  actually draw grid-aligned pixel art" question that we fail loudly about
  which path ran, rather than silently always taking one.
- Character prompts (turnaround, walkcycle) attach a palette swatch built
  from the courier's own colours and ask the model to use only those (plus up
  to 4 accent colours). After downsampling, map_to_palette_or_kmeans() checks
  how much of the frame's colour actually falls near that reference palette;
  if most of it does, remaining pixels are snapped to the nearest palette
  colour (outliers get their own small k-means clusters, honouring the "4
  accent colours" allowance) - "the palette path". If the model ignored the
  palette (most pixels are far from every reference colour), we fall back to
  plain k-means reduction instead, same as round 1 - "the kmeans path". Props
  have no reference palette (none was attached to their prompts), so they
  always take the kmeans path.
- despeckle() (new this round) removes isolated single-pixel colour noise - a
  pixel that matches none of its 4 neighbours gets replaced by the 8-neighbour
  majority colour - right after palette mapping and before the outline pass.
- Order per frame: trim to content -> detect/apply grid (or box-resize
  fallback) -> resize to target sprite height -> map to palette or k-means ->
  despeckle -> snap alpha to pure 0/255 (the courier reference only ever uses
  alpha 0 or 255 - no AA - so cleaned frames match that) -> trim -> add a 1px
  dark outline anywhere the silhouette edge doesn't already have one.
- Character frames are placed on a 64x64 canvas with the figure ~44px tall
  and feet on the same baseline row as the courier reference
  (public/assets/player/south.png: content bbox y 10..55, so baseline row 55
  of a 64px frame). Prop frames are scaled to PROP_TARGET_H tall and left
  trimmed to their own content, no fixed canvas.
- We only ever read raw/* and write into clean/*, under the given --round.

Usage:
  python3 scripts/imagegen/cleanup.py --round 2
  python3 scripts/imagegen/cleanup.py --round 2 --model google/gemini-3-pro-image --prompt prop_drone
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
PLAYER_DIR = REPO_ROOT / "public" / "assets" / "player"
IMAGEGEN_ROOT = Path("/Users/decker/Documents/cyberdash/imagegen-output")

EXPECTED_FRAMES = {
    "turnaround": 8,
    "walkcycle": 6,
    "prop": 4,  # round 1's single generic prop prompt
    "prop_newspaper_box": 4,
    "prop_phone_booth": 4,
    "prop_food_stall": 4,
    "prop_drone": 4,
}
MAX_COLORS = {
    "turnaround": 24,
    "walkcycle": 24,
    "prop": 32,
    "prop_newspaper_box": 32,
    "prop_phone_booth": 32,
    "prop_food_stall": 32,
    "prop_drone": 32,
}
IS_CHARACTER = {
    "turnaround": True,
    "walkcycle": True,
    "prop": False,
    "prop_newspaper_box": False,
    "prop_phone_booth": False,
    "prop_food_stall": False,
    "prop_drone": False,
}

# Measured from public/assets/player/south.png: alpha>10 bbox is y:10..55, x:23..40
# (46px tall, in a 64x64 frame; alpha is pure 0/255, no AA). We target a
# slightly smaller ~44px figure height per the brief, feet pinned to the same
# baseline row, and match that binary-alpha convention in cleaned output.
COURIER_FRAME = 64
COURIER_BASELINE_Y = 55  # bottom row (feet) of the reference figure
COURIER_TARGET_HEIGHT = 44

# No equivalent in-game reference scale was specified for props; this is a
# reasonable "genuinely downsized, still readable" target, not a measured
# constant.
PROP_TARGET_HEIGHT = 140

MAGENTA = np.array([255, 0, 255])
ALPHA_THRESHOLD = 128


def get_courier_palette(top_n: int = 24) -> list[tuple[int, int, int]]:
    """The same colour-counting generate.py uses to build the palette swatch
    image, recomputed independently here (no shared-state file needed) so
    clean-up knows what "the supplied palette" actually was."""
    counts: dict[tuple[int, int, int], int] = {}
    for name in ["south.png", "south-east.png", "walk-south-east.png"]:
        path = PLAYER_DIR / name
        if not path.exists():
            continue
        arr = np.array(Image.open(path).convert("RGBA"))
        opaque = arr[arr[..., 3] > 10][:, :3]
        for r, g, b in opaque.tolist():
            key = (r, g, b)
            counts[key] = counts.get(key, 0) + 1
    top = sorted(counts.items(), key=lambda kv: -kv[1])[:top_n]
    return [color for color, _count in top]


def detect_background_color(arr: np.ndarray) -> np.ndarray:
    """Sample a thin border strip around the sheet and take its modal colour.
    We ask every model for a flat pure-magenta (#FF00FF) background, but not
    all of them render exactly that shade - keying against the colour they
    actually used is far more robust than assuming #FF00FF outright."""
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


def _autocorr_best_period(signal: np.ndarray, min_p: int, max_p: int) -> tuple[int, float]:
    """Best lag (period) in [min_p, max_p] by normalised autocorrelation of a
    1-D signal - robust to noisy/dithered edges in a way a flat-colour-run
    count isn't, since it looks for *recurring* structure rather than
    requiring any single run to be perfectly flat."""
    n = len(signal)
    max_p = min(max_p, n // 2)
    if max_p < min_p:
        return min_p, 0.0
    sig = signal - signal.mean()
    energy = float(np.dot(sig, sig))
    if energy <= 1e-9:
        return min_p, 0.0
    best_p, best_score = min_p, -1.0
    for p in range(min_p, max_p + 1):
        score = float(np.dot(sig[:-p], sig[p:])) / energy
        if score > best_score:
            best_score, best_p = score, p
    return best_p, best_score


def _best_phase(signal: np.ndarray, period: int) -> int:
    """Which offset (mod period) has the strongest average edge signal - i.e.
    where the grid's block boundaries actually fall."""
    sums = np.zeros(period)
    counts = np.zeros(period)
    for i, v in enumerate(signal):
        sums[i % period] += v
        counts[i % period] += 1
    return int(np.argmax(sums / np.maximum(counts, 1)))


def detect_grid(img: Image.Image, min_cell: int = 2, max_cell: int = 32,
                 confidence_threshold: float = 0.35) -> tuple[int, int, int, float] | None:
    """Returns (cell, offset_x, offset_y, confidence) if the frame looks like
    genuine grid-aligned pixel art, else None. offset_x/y are measured in the
    row/column-gradient signal's own index space (see downsample_grid for how
    they're turned into actual block boundaries)."""
    arr = np.array(img.convert("RGBA")).astype(np.float64)
    h, w = arr.shape[:2]
    if h < min_cell * 3 or w < min_cell * 3:
        return None
    gx = np.abs(np.diff(arr[:, :, :3], axis=1)).sum(axis=(0, 2))  # length w-1
    gy = np.abs(np.diff(arr[:, :, :3], axis=0)).sum(axis=(1, 2))  # length h-1
    px, score_x = _autocorr_best_period(gx, min_cell, max_cell)
    py, score_y = _autocorr_best_period(gy, min_cell, max_cell)
    if score_x < confidence_threshold and score_y < confidence_threshold:
        return None
    if score_x >= confidence_threshold and score_y >= confidence_threshold:
        cell = round((px + py) / 2)
    else:
        cell = px if score_x >= score_y else py
    cell = max(min_cell, cell)
    offset_x = _best_phase(gx, cell) if len(gx) >= cell else 0
    offset_y = _best_phase(gy, cell) if len(gy) >= cell else 0
    return cell, offset_x, offset_y, max(score_x, score_y)


def _block_bounds(length: int, cell: int, phase: int) -> list[tuple[int, int]]:
    start0 = ((phase + 1) % cell) - cell
    bounds = []
    s = start0
    while s < length:
        a, b = max(0, s), min(length, s + cell)
        if b > a:
            bounds.append((a, b))
        s += cell
    return bounds


def downsample_grid(img: Image.Image, cell: int, offset_x: int, offset_y: int) -> Image.Image:
    """Majority colour per block, anchored at the detected grid phase (not
    just an arbitrary (0,0)-anchored grid - a model's art rarely starts
    exactly at pixel 0 after we've already cropped this frame out of a
    larger sheet)."""
    arr = np.array(img)
    h, w = arr.shape[:2]
    col_bounds = _block_bounds(w, cell, offset_x)
    row_bounds = _block_bounds(h, cell, offset_y)
    if not col_bounds or not row_bounds:
        return img
    out = np.zeros((len(row_bounds), len(col_bounds), 4), dtype=np.uint8)
    for j, (y0, y1) in enumerate(row_bounds):
        for i, (x0, x1) in enumerate(col_bounds):
            block = arr[y0:y1, x0:x1].reshape(-1, 4)
            colors, counts = np.unique(block, axis=0, return_counts=True)
            out[j, i] = colors[np.argmax(counts)]
    return Image.fromarray(out)


def downsample_box(img: Image.Image, target_h: int, resize_filter) -> Image.Image:
    if img.height <= 0:
        return img
    scale = target_h / img.height
    new_w, new_h = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    return img.resize((new_w, new_h), resize_filter)


def simple_kmeans(colors: np.ndarray, weights: np.ndarray, k: int, iters: int = 12, seed: int = 0) -> np.ndarray:
    """Small k-means++-seeded k-means over a handful of distinct colours
    (never more than a few hundred after majority-vote downsampling), so a
    plain numpy loop is plenty fast - no sklearn dependency needed."""
    colors = colors.astype(np.float64)
    if len(colors) <= k:
        return colors
    rng = np.random.default_rng(seed)
    idx = [int(rng.integers(len(colors)))]
    for _ in range(k - 1):
        d2 = np.min(((colors[:, None, :] - colors[idx][None, :, :]) ** 2).sum(-1), axis=1)
        probs = d2 * weights
        total = probs.sum()
        probs = probs / total if total > 0 else np.ones(len(colors)) / len(colors)
        idx.append(int(rng.choice(len(colors), p=probs)))
    centroids = colors[idx].copy()
    for _ in range(iters):
        d2 = ((colors[:, None, :] - centroids[None, :, :]) ** 2).sum(-1)
        assign = np.argmin(d2, axis=1)
        for c in range(k):
            mask = assign == c
            if mask.any():
                w = weights[mask]
                centroids[c] = (colors[mask] * w[:, None]).sum(0) / w.sum()
    return centroids


def map_to_palette_or_kmeans(img: Image.Image, reference_palette: list[tuple[int, int, int]] | None,
                              max_colors: int, compliance_threshold: float = 0.55,
                              snap_threshold: float = 45.0) -> tuple[Image.Image, str]:
    """"map to the supplied palette (or k-means <=N if the model ignored it)":
    checks what fraction of the frame's (weighted) pixels already land near
    the reference palette; if most do, snap them to it and k-means-cluster
    the leftover far-from-palette pixels into a few accent colours instead of
    forcing everything into 24 courier colours. If the model clearly used its
    own palette instead, don't fight it - just k-means the whole frame."""
    arr = np.array(img.convert("RGBA"))
    alpha = arr[..., 3]
    opaque = alpha > 10
    if not opaque.any():
        return img, "none"

    pixels = arr[opaque][:, :3].astype(np.float64)
    colors, inverse, counts = np.unique(pixels, axis=0, return_inverse=True, return_counts=True)

    path = "kmeans"
    mapped_colors = None
    if reference_palette:
        pal = np.array(reference_palette, dtype=np.float64)
        dist = np.sqrt(((colors[:, None, :] - pal[None, :, :]) ** 2).sum(-1))
        nearest_idx = dist.argmin(axis=1)
        nearest_dist = dist.min(axis=1)
        compliant = nearest_dist <= snap_threshold
        compliance = counts[compliant].sum() / counts.sum() if counts.sum() > 0 else 0.0
        if compliance >= compliance_threshold:
            path = "palette"
            mapped_colors = colors.copy()
            mapped_colors[compliant] = pal[nearest_idx[compliant]]
            outlier = ~compliant
            if outlier.any():
                k = min(4, int(outlier.sum()))
                centroids = simple_kmeans(colors[outlier], counts[outlier], k)
                d2 = ((colors[outlier][:, None, :] - centroids[None, :, :]) ** 2).sum(-1)
                mapped_colors[outlier] = centroids[d2.argmin(axis=1)]

    if mapped_colors is None:
        k = min(max_colors, len(colors))
        centroids = simple_kmeans(colors, counts, k)
        d2 = ((colors[:, None, :] - centroids[None, :, :]) ** 2).sum(-1)
        mapped_colors = centroids[d2.argmin(axis=1)]

    new_pixels = mapped_colors[inverse]
    out_rgb = np.zeros((*alpha.shape, 3))
    out_rgb[opaque] = new_pixels
    out = np.dstack([out_rgb, alpha]).astype(np.uint8)
    out[~opaque] = [0, 0, 0, 0]
    return Image.fromarray(out), path


def despeckle(img: Image.Image) -> Image.Image:
    """Remove isolated single-pixel colour speckles: an opaque art-pixel none
    of whose 4-neighbours share its exact colour gets replaced by the modal
    colour of its 8-neighbourhood. One pass only - repeated passes start
    eating genuine single-pixel detail (eyes, buttons, highlights)."""
    arr = np.array(img.convert("RGBA"))
    h, w = arr.shape[:2]
    out = arr.copy()
    for y in range(h):
        for x in range(w):
            if arr[y, x, 3] <= 10:
                continue
            color = tuple(int(c) for c in arr[y, x])
            neighbors4 = []
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w:
                    neighbors4.append(tuple(int(c) for c in arr[ny, nx]))
            if not neighbors4 or any(n == color for n in neighbors4):
                continue
            neighbors8 = list(neighbors4)
            for dy, dx in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w:
                    neighbors8.append(tuple(int(c) for c in arr[ny, nx]))
            counts: dict[tuple[int, int, int, int], int] = {}
            for n in neighbors8:
                counts[n] = counts.get(n, 0) + 1
            out[y, x] = max(counts, key=counts.get)
    return Image.fromarray(out)


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


def _axis_has_content(arr_rgba: np.ndarray, axis: int, flat_std_threshold: float = 6.0) -> np.ndarray:
    """A position (column, if axis=0; row, if axis=1) counts as real content
    only if it has opaque pixels AND isn't a uniform flat-colour line. Some
    models (observed: flux-3-image's turnaround) draw a grid of repeated
    panels separated by thin solid divider lines instead of leaving a
    background gap - those lines are opaque, so a plain alpha check treats
    them as "content" and segmentation never finds a gap at all. A divider
    line has near-zero colour variation along its length; real character
    silhouette does not."""
    alpha = arr_rgba[..., 3]
    has_opaque = (alpha > 10).any(axis=axis)
    rgb = arr_rgba[..., :3].astype(np.float64)
    is_flat = rgb.std(axis=axis).max(axis=-1) < flat_std_threshold
    return has_opaque & ~is_flat


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


def _segment_pass(arr: np.ndarray, expected_count: int, use_flat_test: bool) -> list[tuple[int, int, int, int]]:
    h, w = arr.shape[:2]
    if use_flat_test:
        row_has_content = _axis_has_content(arr, axis=1)
    else:
        row_has_content = (arr[..., 3] > 10).any(axis=1)
    row_min_height = max(3, (h / max(expected_count, 1)) * 0.05)
    row_bands = _find_runs(row_has_content, row_min_height)
    if not row_bands:
        return []
    col_min_width = max(3, (w / expected_count) * 0.15)
    boxes = []
    for y0, y1 in row_bands:
        band = arr[y0:y1]
        col_has_content = _axis_has_content(band, axis=0) if use_flat_test else (band[..., 3] > 10).any(axis=0)
        for x0, x1 in _find_runs(col_has_content, col_min_width):
            boxes.append((x0, y0, x1, y1))
    return boxes


def segment_frames(img: Image.Image, expected_count: int) -> list[tuple[int, int, int, int]]:
    """Split a sheet into expected_count (x0, y0, x1, y1) frame boxes.

    Most prompts ask for a single row, but a model sometimes ignores that and
    draws an NxM grid instead (observed: gemini-3-pro-image drew the 8-pose
    turnaround as a 4x2 grid). This tries two passes and keeps whichever
    worked:
      - the plain pass (a position is "content" iff it has opaque pixels)
        handles the normal case, including genuinely flat-shaded pixel art
        (round 2's strict-grid prompts produce a lot of that, and a column
        of one solid colour down a wall or sleeve is real content, not a
        gap);
      - the divider-aware pass (see _axis_has_content) additionally treats a
        long uniform-colour run as a boundary, for the case a model draws a
        grid of repeated panels separated by a thin solid divider line
        instead of a background gap (observed: flux-3-image's turnaround,
        6x2 panels on hairline black dividers that the plain pass couldn't
        see at all).
    Whichever pass's cell count is closer to expected_count wins (ties
    broken toward having *more* cells, since extra real cells can be
    truncated cleanly but a merged blob covering two figures cannot be
    split cleanly after the fact). If neither pass finds anything, we fall
    back to a blind proportional split of the content bounding box, as a
    last resort."""
    arr = np.array(img)
    plain_boxes = _segment_pass(arr, expected_count, use_flat_test=False)
    if len(plain_boxes) == expected_count:
        return plain_boxes
    flat_boxes = _segment_pass(arr, expected_count, use_flat_test=True)
    if len(flat_boxes) == expected_count:
        return flat_boxes

    candidates = [b for b in (plain_boxes, flat_boxes) if b]
    if candidates:
        over_or_equal = [b for b in candidates if len(b) >= expected_count]
        best = min(over_or_equal, key=len) if over_or_equal else max(candidates, key=len)
        if len(best) != expected_count:
            print(f"    [note] found {len(best)} real grid cells, expected {expected_count} - "
                  f"using the real ones ({'truncating' if len(best) > expected_count else 'short'}), "
                  f"not distorting them to fit")
        return best[:expected_count]

    # Last resort: nothing segmentable at all (fully merged content, no gaps
    # anywhere) - distribute expected_count across the content bbox evenly.
    alpha = arr[..., 3]
    h, w = alpha.shape
    row_has_content = (alpha > 10).any(axis=1)
    row_min_height = max(3, (h / max(expected_count, 1)) * 0.05)
    row_bands = _find_runs(row_has_content, row_min_height)
    if not row_bands:
        return []
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


def process_frame(strip: Image.Image, prompt_id: str,
                   reference_palette: list[tuple[int, int, int]] | None) -> tuple[Image.Image | None, dict]:
    meta: dict = {"grid_path": None, "cell": None, "grid_confidence": None, "color_path": None}
    content = trim_to_content(strip)
    if content is None:
        return None, meta

    grid = detect_grid(content)
    if grid is not None:
        cell, offset_x, offset_y, confidence = grid
        pixelated = downsample_grid(content, cell, offset_x, offset_y)
        resize_filter = Image.NEAREST  # genuine blocky pixel art now - keep it crisp
        meta.update(grid_path="grid", cell=cell, grid_confidence=round(confidence, 3))
    else:
        pixelated = content
        resize_filter = Image.BOX  # continuous-tone source: quality downscale, not speckle
        meta.update(grid_path="fallback")

    target_h = COURIER_TARGET_HEIGHT if IS_CHARACTER[prompt_id] else PROP_TARGET_HEIGHT
    resized = downsample_box(pixelated, target_h, resize_filter)

    pal = reference_palette if IS_CHARACTER[prompt_id] else None
    mapped, color_path = map_to_palette_or_kmeans(resized, pal, MAX_COLORS[prompt_id])
    meta["color_path"] = color_path

    despeckled = despeckle(mapped)
    snapped = snap_alpha(despeckled)
    trimmed = trim_to_content(snapped)
    if trimmed is None:
        return None, meta
    outlined = add_outline(trimmed)

    result = place_on_character_canvas(outlined) if IS_CHARACTER[prompt_id] else outlined
    return result, meta


def process_one(raw_path: Path, prompt_id: str, out_dir: Path,
                 reference_palette: list[tuple[int, int, int]] | None) -> list[Path]:
    img = Image.open(raw_path).convert("RGBA")
    keyed = key_out_magenta(img)
    expected = EXPECTED_FRAMES[prompt_id]
    segments = segment_frames(keyed, expected)

    out_dir.mkdir(parents=True, exist_ok=True)
    saved: list[Path] = []
    frame_meta: list[dict] = []
    for idx, (x0, y0, x1, y1) in enumerate(segments):
        strip = keyed.crop((x0, y0, x1, y1))
        frame, meta = process_frame(strip, prompt_id, reference_palette)
        meta["frame"] = idx
        if frame is None:
            meta["saved"] = False
            frame_meta.append(meta)
            continue
        dest = out_dir / f"frame_{idx}.png"
        frame.save(dest)
        saved.append(dest)
        meta["saved"] = True
        frame_meta.append(meta)

    (out_dir / "meta.json").write_text(json.dumps(frame_meta, indent=2))
    paths_used = sorted({m["grid_path"] for m in frame_meta if m.get("grid_path")})
    print(f"  frames={len(saved)}/{expected} paths={paths_used} -> {out_dir}")
    return saved


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--round", type=int, default=2, help="round number (default 2)")
    parser.add_argument("--model", default=None, help="only this model slug (e.g. google/gemini-3-pro-image)")
    parser.add_argument("--prompt", default=None, choices=list(EXPECTED_FRAMES), help="only this prompt id")
    args = parser.parse_args()

    output_dir = IMAGEGEN_ROOT / f"round{args.round}"
    raw_dir = output_dir / "raw"
    clean_dir = output_dir / "clean"

    reference_palette = get_courier_palette()

    for model_dir in sorted(raw_dir.iterdir()):
        if not model_dir.is_dir():
            continue
        model_slug = model_dir.name.replace("__", "/")
        if args.model and model_slug != args.model:
            continue
        for raw_path in sorted(model_dir.glob("*.png")):
            prompt_id = raw_path.stem
            if prompt_id not in EXPECTED_FRAMES:
                continue  # e.g. the *__oldrefs.png probes we keep but don't fold into the main pipeline
            if args.prompt and prompt_id != args.prompt:
                continue
            out_dir = clean_dir / model_dir.name / prompt_id
            print(f"[CLEAN] {model_slug} / {prompt_id}")
            process_one(raw_path, prompt_id, out_dir, reference_palette)


if __name__ == "__main__":
    main()
