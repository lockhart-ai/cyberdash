"""Voxel-to-isometric renderer.

Assumptions (stated up front):
- True 2:1 isometric projection, built from a single tunable constant
  UNIT_PX (pixel size of one voxel unit's horizontal step). "2:1" describes
  the ground diamond only: one grid unit of x or y advances the screen by
  (UNIT_PX, UNIT_PX * UY_RATIO) with UY_RATIO = 0.5. The vertical (z) axis is
  a separate, independently-calibrated constant Z_RATIO — see the round-2
  report for how it was measured against City-103 (its near-cube head gives
  a direct wall-height : top-diamond-height ratio in pixels, which equals
  Z_RATIO exactly when footprint W=D=h).
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

# Pixel size of one voxel unit's horizontal step. Round 2: dropped from 16 to
# 4 so models can be built from many small voxels (15-30 units across) and
# carry 2-4px details (trims, slots, frames) like the purchased packs do,
# instead of a handful of huge slabs.
UNIT_PX = 4

# Ground-diamond ratio: fixed by "true 2:1" (unchanged from round 1).
UY_RATIO = 0.5

# Vertical (z) pixels per unit, as a multiple of UNIT_PX. Round-1 used 0.5
# (treating z like another ground axis), which halved every height — the
# pedestrian read as lying flat, the mailbox as an anvil.
#
# Calibrated by rendering an actual test cube (equal W=D=h) at several
# candidate Z_RATIO values and checking which one LOOKS like a cube: 0.5
# reads as a flattened disc, 2.4 (naively back-solved from City-103's head
# assuming its height equals its footprint width) reads as a slender tower,
# and 1.0 reads as a proper cube. 1.0 is also the value a direct "vertical
# unit at the diamond's half-height x2" read of the brief implies. Used 1.0.
#
# This means City-103's head, measured at exact pixel precision (apex to
# full-width row y4->y32 = diamond height 28px; full-width to narrowing row
# y32->y100 = wall height 68px; ratio 68/28 ~= 2.43), is NOT a literal cube
# in grid units — at Z_RATIO=1.0 that pixel ratio implies its real height is
# ~2.4x its footprint width (a tall box, not equal W=D=h). The calibration
# mailbox model (models.py) uses that derived height directly, rather than
# assuming h=W, to match City-103's silhouette.
Z_RATIO = 1.0

# Flat per-face shading multipliers. Top is unshaded (brightest). Round 2:
# lifted right and left — round 1's left (0.31/0.31/0.44) measured true to
# City-103's own pixels, but combined with our dark base colors it crushed
# to near-black and merged with the outline. Mid-tone base colors (see
# models.py) plus a lighter left multiplier keep the left face readable.
# Cool shift kept: blue darkens less than red/green.
TOP_MULT: Tuple[float, float, float] = (1.0, 1.0, 1.0)
RIGHT_MULT: Tuple[float, float, float] = (0.78, 0.78, 0.78)
LEFT_MULT: Tuple[float, float, float] = (0.52, 0.52, 0.62)

OUTLINE_RGBA = (0, 0, 0, 255)

# Per-box edge rim: a 1px lighter line along a face's own boundary edges
# (top face: all 4 edges; side faces: just the top edge, i.e. the crease
# below the top face), giving the bevelled look the reference packs have
# instead of flat slabs. Separate from the black silhouette outline, which
# only wraps the whole sprite's outer edge.
RIM_MULT = 1.25

# Highlight down the single vertical seam where a box's right and left walls
# meet (its nearest corner to the camera) — brighter than the edge rim.
CORNER_MULT = 1.45

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
    opaque_pad = np.pad(opaque, 1, mode="constant", constant_values=False)

    def neighbor(arr: np.ndarray, dy: int, dx: int, fill):
        out = np.full((H, W), fill, dtype=arr.dtype)
        src_y0, src_y1 = max(0, dy), H + min(0, dy)
        src_x0, src_x1 = max(0, dx), W + min(0, dx)
        dst_y0, dst_y1 = max(0, -dy), H + min(0, -dy)
        dst_x0, dst_x1 = max(0, -dx), W + min(0, -dx)
        out[dst_y0:dst_y1, dst_x0:dst_x1] = arr[src_y0:src_y1, src_x0:src_x1]
        return out

    # --- Per-box edge rim: a 1px lighter line along each face's own
    # boundary (not the whole sprite's silhouette), so every box reads as
    # bevelled rather than a flat slab. Top face: all 4 edges — any
    # neighbor that isn't this same box's top face (background, a
    # different box's top, or this box's own side face below). Side
    # faces: just the top edge — the crease directly below the top face.
    is_top = face_arr == FACE_TOP
    is_side = (face_arr == FACE_RIGHT) | (face_arr == FACE_LEFT)

    top_boundary = np.zeros((H, W), dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            neigh_face = neighbor(face_arr, dy, dx, -1)
            neigh_boxid = neighbor(boxid_arr, dy, dx, -2)
            differs = (neigh_face != FACE_TOP) | (neigh_boxid != boxid_arr)
            top_boundary |= differs
    top_rim = is_top & top_boundary

    side_top_boundary = np.zeros((H, W), dtype=bool)
    for dx in (-1, 0, 1):
        neigh_face = neighbor(face_arr, -1, dx, -1)
        side_top_boundary |= neigh_face == FACE_TOP
    side_rim = is_side & side_top_boundary

    rim_mask = top_rim | side_rim

    # --- Vertical corner highlight: the seam where a box's right and left
    # walls meet (its nearest vertical edge to the camera).
    right_neighbor_face = neighbor(face_arr, 0, 1, -1)
    right_neighbor_boxid = neighbor(boxid_arr, 0, 1, -2)
    corner_highlight = (
        (face_arr == FACE_RIGHT)
        & (right_neighbor_face == FACE_LEFT)
        & (boxid_arr == right_neighbor_boxid)
    )

    out = color_arr.copy()
    rgb = out[:, :, :3].astype(np.float32)
    if rim_mask.any():
        rgb[rim_mask] = np.clip(rgb[rim_mask] * RIM_MULT, 0, 255)
    if corner_highlight.any():
        rgb[corner_highlight] = np.clip(rgb[corner_highlight] * CORNER_MULT, 0, 255)
    out[:, :, :3] = rgb.astype(np.uint8)

    # --- Outline pass: 1px pure black silhouette, 8-neighbor dilation.
    # Only wraps the sprite's outer edge, not internal box-to-box seams
    # (those get the rim treatment above instead).
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
