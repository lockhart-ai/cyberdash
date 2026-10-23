"""Voxel-to-isometric renderer.

Assumptions (stated up front):
- True 2:1 isometric projection, built from a single tunable constant
  UNIT_PX (pixel size of one voxel unit's horizontal step). The other two
  projection steps are fixed ratios of it (UY_RATIO, Z_RATIO = 0.5), which is
  what makes the projection "true" 2:1 rather than an arbitrary skew.
- Camera convention: +x (east) and +y (south) side faces are visible, plus
  the top (+z) face. We call the +x face "right" and the +y face "left" —
  this is a screen-space label (which side of the sprite it reads as), not a
  compass direction, and it stays fixed across all 4 rotation frames; only
  the voxel grid rotates.
- Models are voxelized onto an integer grid (one cell per unit), not drawn as
  raw boxes, so overlapping/adjacent boxes occlude each other correctly via
  a back-to-front painter's algorithm (sort by x+y+z, draw far to near).
  This is robust but assumes "chunky" box counts (tens to low hundreds), not
  dense voxel sculpts — fine for this pack's low-poly style.
- Frame order in the output strip: SE=0, NE=1, NW=2, SW=3 (matches
  src/rendering/BillboardTrim.ts's documented convention for this project).
  Rotation is a 90 deg turn of the grid per frame (numpy rot90), so exact
  compass labelling is a best effort, not verified against the purchased
  packs pixel-for-pixel.
- Outline/highlight are post-passes over flat-shaded face buffers, not baked
  into per-face color, so they can be tuned independently of shading.

Run as a script to render all models in models.py to public/assets/generated/.
"""

from __future__ import annotations

import os
from typing import List, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw

from box import Model, model_extent

# ---------------------------------------------------------------------------
# Tunable constants (the whole "look" lives here)
# ---------------------------------------------------------------------------

# Pixel size of one voxel unit's horizontal step. Calibrated against a rough
# copy of City-103 (the mailbox) — see models.py's calibration_mailbox() and
# the round-1 report for what this did and didn't match.
UNIT_PX = 16

# True 2:1 iso: one grid unit of y/depth or z/height advances the screen by
# half as many pixels as one grid unit of x advances it horizontally.
UY_RATIO = 0.5
Z_RATIO = 0.5

# Flat per-face shading multipliers. Top is unshaded (brightest). Right is a
# uniform darken. Left is darkest AND shifted cooler: blue darkens less than
# red/green, per the measured spec (e.g. 0.44x blue vs 0.31x red/green).
TOP_MULT: Tuple[float, float, float] = (1.0, 1.0, 1.0)
RIGHT_MULT: Tuple[float, float, float] = (0.73, 0.73, 0.73)
LEFT_MULT: Tuple[float, float, float] = (0.31, 0.31, 0.44)

OUTLINE_RGBA = (0, 0, 0, 255)
HIGHLIGHT_MULT = 1.45

# Transparent padding added around each frame's trimmed content.
FRAME_PAD = 5

FACE_TOP = 1
FACE_RIGHT = 2
FACE_LEFT = 3


# ---------------------------------------------------------------------------
# Voxelization
# ---------------------------------------------------------------------------


def voxelize(model: Model):
    """Rasterize a Model's boxes onto an integer occupancy grid.

    Returns (occ, color, boxid) numpy arrays, each shaped (X, Y, Z) (boxid
    and occ) or (X, Y, Z, 3) (color). boxid is -1 where empty.
    """
    ex, ey, ez = model_extent(model)
    ex, ey, ez = max(ex, 1), max(ey, 1), max(ez, 1)
    occ = np.zeros((ex, ey, ez), dtype=bool)
    color = np.zeros((ex, ey, ez, 3), dtype=np.uint8)
    boxid = np.full((ex, ey, ez), -1, dtype=np.int32)

    for i, b in enumerate(model):
        ox, oy, oz = b.origin
        sx, sy, sz = b.size
        occ[ox : ox + sx, oy : oy + sy, oz : oz + sz] = True
        color[ox : ox + sx, oy : oy + sy, oz : oz + sz] = b.color
        boxid[ox : ox + sx, oy : oy + sy, oz : oz + sz] = i

    return occ, color, boxid


def rotate_grid(occ, color, boxid, k: int):
    """Rotate the voxel grid k * 90 degrees about the vertical (z) axis."""
    occ_r = np.rot90(occ, k=k, axes=(0, 1))
    color_r = np.rot90(color, k=k, axes=(0, 1))
    boxid_r = np.rot90(boxid, k=k, axes=(0, 1))
    return occ_r, color_r, boxid_r


# ---------------------------------------------------------------------------
# Projection
# ---------------------------------------------------------------------------


def project(gx: float, gy: float, gz: float, unit_px: float) -> Tuple[float, float]:
    sx = (gx - gy) * unit_px
    sy = (gx + gy) * unit_px * UY_RATIO - gz * unit_px * Z_RATIO
    return sx, sy


def _apply_mult(rgb: Tuple[int, int, int], mult: Tuple[float, float, float]) -> Tuple[int, int, int]:
    return tuple(min(255, max(0, int(round(c * m)))) for c, m in zip(rgb, mult))  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Face rasterization for one rotated grid -> one raw (untrimmed) RGBA frame
# ---------------------------------------------------------------------------


def render_frame(occ, color, boxid, unit_px: float = UNIT_PX) -> np.ndarray:
    X, Y, Z = occ.shape

    # Canvas bounds, derived from the projection formula's extremes.
    offset_x = Y * unit_px
    offset_y = Z * unit_px * Z_RATIO
    width = int((X + Y) * unit_px) + 2
    height = int((X + Y) * unit_px * UY_RATIO + Z * unit_px * Z_RATIO) + 2

    canvas_color = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    canvas_face = Image.new("L", (width, height), 0)
    canvas_boxid = Image.new("I", (width, height), -1)
    draw_color = ImageDraw.Draw(canvas_color)
    draw_face = ImageDraw.Draw(canvas_face)
    draw_boxid = ImageDraw.Draw(canvas_boxid)

    def to_screen(gx, gy, gz) -> Tuple[float, float]:
        sx, sy = project(gx, gy, gz, unit_px)
        return (sx + offset_x, sy + offset_y)

    # Collect face-draw jobs: (depth, face_type, corners, color, boxid)
    xs, ys, zs = np.nonzero(occ)
    depths = xs + ys + zs
    order = np.argsort(depths, kind="stable")

    jobs: List[Tuple[int, int, List[Tuple[float, float]], Tuple[int, int, int], int]] = []
    for idx in order:
        x, y, z = int(xs[idx]), int(ys[idx]), int(zs[idx])
        base_color = tuple(int(c) for c in color[x, y, z])
        bid = int(boxid[x, y, z])
        depth = x + y + z

        top_visible = z + 1 >= Z or not occ[x, y, z + 1]
        right_visible = x + 1 >= X or not occ[x + 1, y, z]
        left_visible = y + 1 >= Y or not occ[x, y + 1, z]

        if top_visible:
            pts = [
                to_screen(x, y, z + 1),
                to_screen(x + 1, y, z + 1),
                to_screen(x + 1, y + 1, z + 1),
                to_screen(x, y + 1, z + 1),
            ]
            jobs.append((depth, FACE_TOP, pts, _apply_mult(base_color, TOP_MULT), bid))

        if right_visible:
            pts = [
                to_screen(x + 1, y, z + 1),
                to_screen(x + 1, y + 1, z + 1),
                to_screen(x + 1, y + 1, z),
                to_screen(x + 1, y, z),
            ]
            jobs.append((depth, FACE_RIGHT, pts, _apply_mult(base_color, RIGHT_MULT), bid))

        if left_visible:
            pts = [
                to_screen(x, y + 1, z + 1),
                to_screen(x + 1, y + 1, z + 1),
                to_screen(x + 1, y + 1, z),
                to_screen(x, y + 1, z),
            ]
            jobs.append((depth, FACE_LEFT, pts, _apply_mult(base_color, LEFT_MULT), bid))

    # jobs are already appended in far-to-near order (xs/ys/zs iterated via
    # `order`, and a voxel's 3 faces share one depth so relative order among
    # them doesn't matter — they don't overlap on screen).
    for depth, face_type, pts, rgb, bid in jobs:
        poly = [(round(px), round(py)) for px, py in pts]
        draw_color.polygon(poly, fill=(rgb[0], rgb[1], rgb[2], 255))
        draw_face.polygon(poly, fill=face_type)
        draw_boxid.polygon(poly, fill=bid)

    color_arr = np.array(canvas_color)
    face_arr = np.array(canvas_face)
    boxid_arr = np.array(canvas_boxid, dtype=np.int32)

    return post_process(color_arr, face_arr, boxid_arr)


# ---------------------------------------------------------------------------
# Post-processing: highlight + outline
# ---------------------------------------------------------------------------


def post_process(color_arr: np.ndarray, face_arr: np.ndarray, boxid_arr: np.ndarray) -> np.ndarray:
    H, W = face_arr.shape
    alpha = color_arr[:, :, 3]
    opaque = alpha > 0

    # --- Highlight pass (only touches already-opaque pixels) ---
    opaque_pad = np.pad(opaque, 1, mode="constant", constant_values=False)
    touches_background = np.zeros((H, W), dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            neigh = opaque_pad[1 + dy : 1 + dy + H, 1 + dx : 1 + dx + W]
            touches_background |= ~neigh

    top_highlight = (face_arr == FACE_TOP) & touches_background

    right_neighbor_face = np.full((H, W), -1, dtype=face_arr.dtype)
    right_neighbor_face[:, :-1] = face_arr[:, 1:]
    right_neighbor_boxid = np.full((H, W), -2, dtype=boxid_arr.dtype)
    right_neighbor_boxid[:, :-1] = boxid_arr[:, 1:]
    corner_highlight = (
        (face_arr == FACE_RIGHT)
        & (right_neighbor_face == FACE_LEFT)
        & (boxid_arr == right_neighbor_boxid)
    )

    highlight_mask = top_highlight | corner_highlight
    out = color_arr.copy()
    if highlight_mask.any():
        rgb = out[:, :, :3].astype(np.float32)
        rgb[highlight_mask] = np.clip(rgb[highlight_mask] * HIGHLIGHT_MULT, 0, 255)
        out[:, :, :3] = rgb.astype(np.uint8)

    # --- Outline pass: 1px pure black silhouette, 8-neighbor dilation ---
    dilated = np.zeros((H, W), dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            neigh = opaque_pad[1 + dy : 1 + dy + H, 1 + dx : 1 + dx + W]
            dilated |= neigh
    new_outline = dilated & ~opaque
    out[new_outline] = OUTLINE_RGBA

    return out


# ---------------------------------------------------------------------------
# Strip assembly
# ---------------------------------------------------------------------------


def trim_to_content(arr: np.ndarray) -> Optional[np.ndarray]:
    alpha = arr[:, :, 3]
    ys, xs = np.nonzero(alpha)
    if len(xs) == 0:
        return None
    return arr[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def render_model_strip(model: Model, unit_px: float = UNIT_PX) -> Image.Image:
    """Render all 4 rotation frames (SE, NE, NW, SW) and assemble a strip,
    each frame padded to a common size, horizontally centered and bottom
    (ground-contact) aligned, matching the purchased packs' frame layout.
    """
    occ, color, boxid = voxelize(model)
    trimmed_frames = []
    for k in range(4):
        occ_r, color_r, boxid_r = rotate_grid(occ, color, boxid, k)
        raw = render_frame(occ_r, color_r, boxid_r, unit_px)
        trimmed = trim_to_content(raw)
        if trimmed is None:
            trimmed = np.zeros((1, 1, 4), dtype=np.uint8)
        trimmed_frames.append(trimmed)

    max_h = max(f.shape[0] for f in trimmed_frames)
    max_w = max(f.shape[1] for f in trimmed_frames)
    frame_w = max_w + 2 * FRAME_PAD
    frame_h = max_h + 2 * FRAME_PAD

    strip = Image.new("RGBA", (frame_w * 4, frame_h), (0, 0, 0, 0))
    for k, f in enumerate(trimmed_frames):
        fh, fw = f.shape[0], f.shape[1]
        img = Image.fromarray(f)
        x = k * frame_w + FRAME_PAD + (max_w - fw) // 2
        y = frame_h - FRAME_PAD - fh  # ground contact at the bottom
        strip.paste(img, (x, y), img)

    return strip


def render_and_save(name: str, model: Model, out_dir: str, unit_px: float = UNIT_PX) -> str:
    strip = render_model_strip(model, unit_px)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{name}.png")
    strip.save(path)
    return path


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import models as model_defs

    out_dir = os.path.join(os.path.dirname(__file__), "..", "..", "public", "assets", "generated")
    out_dir = os.path.abspath(out_dir)

    for name, model in model_defs.ALL_MODELS.items():
        path = render_and_save(name, model, out_dir)
        print(f"wrote {path}")
