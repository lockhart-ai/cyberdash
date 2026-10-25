#!/usr/bin/env python3
"""Bridge C: image-model orthographic blueprint -> carved voxels -> render.

Assumptions (stated up front):
- Same light-prototype scope as bridge_3d.py: one pass per subject, no
  retry-until-perfect loop.
- One OpenRouter call per subject (openai/gpt-image-2, same model and
  /api/v1/images route as bridge_3d.py - imports and reuses that module's
  generate_concept_image()/call_openrouter_concept() rather than duplicating
  them) asks for a single sheet with 3 views - front, side, top - arranged
  left to right in equal thirds, flat colors, plain white background, same
  scale. One call, not three, keeps this within the shared $1.00 OpenRouter
  cap alongside bridge_3d.py's own two calls.
- Segmenting the sheet: split into 3 equal-width columns (front, side, top,
  matching the prompt's requested order - the same equal-thirds convention
  scripts/voxel/compare.py's reference_strip_frames() uses for 4-rotation
  reference strips). Each column's background is removed by comparing every
  pixel to the mean of its own 4 corners (not a hardcoded "white", in case
  the model's background isn't perfectly pure) and thresholding distance;
  the view is then cropped to its foreground bounding box.
- Carving: a voxel grid sized to the subject's target (vending machine
  12x10x28, NPC 8x6x24 - the same figures the task brief gives for bridge A,
  reused here as "a sensible voxel size" for bridge C too). Each cropped
  view's silhouette is box-downsampled to the two grid axes it spans (front:
  X wide x Z tall; side: Y wide x Z tall; top: X wide x Y tall) and
  thresholded back to boolean. A grid cell is kept only if it falls inside
  all three silhouettes (classic visual-hull carving) - this assumes the
  three views share the same scale and ground line, which the prompt asks
  for but we don't independently verify; a wrong answer here shows up as a
  stretched or offset model, which is one of the honest "what broke"
  findings this prototype is meant to surface, not something to paper over.
- Coloring a kept voxel: front view's pixel colors the voxel closest to y=0
  in its (x, z) column (i.e. the surface a viewer standing in front, at
  y=-infinity, would see first); side view colors the voxel closest to
  x=(X-1) in its (y, z) column (a viewer at x=+infinity); top view colors
  the voxel closest to z=(Z-1) in its (x, y) column (a viewer looking down).
  A voxel claimed by more than one rule keeps whichever ran first in that
  priority order (front, then side, then top). Any voxel still uncolored
  (fully interior, visible from none of the three views) takes the nearest
  already-colored voxel's color by straightforward distance, so the
  renderer never sees a colorless cell. Top view's own row axis (which edge
  of the top-down image is "near" vs "far") is a guess, not derived from the
  front/side views - worth checking visually, not assumed correct.
- Palette reduction and the final Box-list render reuse bridge_3d.py's
  reduce_palette() and scripts/voxel/renderer.py's render_model_strip(), so
  both bridges produce directly comparable strips.
- Reads/writes the same paths as bridge_3d.py: public/assets/ (read-only,
  style refs), /tmp/structured_work/ (raw images, scratch), and
  /Users/decker/Documents/cyberdash/structured-output/round1/ (final
  strips). Never asset_packs/, never public/assets/ for writes.

Usage:
  python3 scripts/structured/bridge_carve.py --subject vending_machine
  python3 scripts/structured/bridge_carve.py --subject punk --skip-generate
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(REPO_ROOT / "scripts" / "voxel"))

from box import Box, Model  # noqa: E402
from renderer import render_model_strip  # noqa: E402
import bridge_3d as b3d  # noqa: E402  (reused: SUBJECTS, generate_concept_image, reduce_palette, cost ledger, OUT_ROOT, WORK_DIR)

VOXEL_DIMS = {
    # (X east-west, Y south depth, Z up), per the task brief's sensible sizes.
    "vending_machine": (12, 10, 28),
    "punk": (8, 6, 24),
}

BRIDGE_C_PROMPT_TMPL = (
    "{description}. Draw a clean orthographic blueprint reference sheet of "
    "this single subject: exactly 3 views of the exact same object at the "
    "exact same scale - front view, then side view, then top-down view - "
    "arranged left to right, evenly spaced in a single horizontal row, each "
    "view occupying an equal-width third of the image. The front and side "
    "views share the same ground baseline and the same overall height. Flat, "
    "even, shadowless lighting; flat colors with only minimal shading, just "
    "enough to tell surfaces apart; crisp clean edges; true orthographic "
    "projection, no perspective distortion. Plain flat white background, no "
    "grid lines, no dimension labels, no text, no watermark. Match the "
    "gritty cyberpunk industrial aesthetic and color palette of the attached "
    "in-game reference image(s)."
)

BG_DISTANCE_THRESHOLD = 28


def split_into_three(img: Image.Image) -> list[Image.Image]:
    w, h = img.size
    third = w // 3
    return [img.crop((i * third, 0, (i + 1) * third if i < 2 else w, h)) for i in range(3)]


def prepare_view(img: Image.Image, grid_w: int, grid_h: int) -> tuple[np.ndarray, np.ndarray]:
    """Removes background, crops to content, and box-downsamples to a
    (grid_h, grid_w) silhouette mask + matching colors. Row 0 of the
    returned arrays is the BOTTOM of the subject (z=0 / near-ground row),
    matching the renderer's up-is-positive-z convention."""
    arr = np.array(img.convert("RGB")).astype(float)
    h, w = arr.shape[:2]
    corners = np.array([arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]])
    bg = corners.mean(axis=0)
    dist = np.linalg.norm(arr - bg, axis=-1)
    fg = dist > BG_DISTANCE_THRESHOLD
    ys, xs = np.nonzero(fg)
    if len(xs) == 0:
        raise RuntimeError("view has no foreground content after background removal")
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop_rgb = arr[y0:y1, x0:x1].astype(np.uint8)
    crop_fg = fg[y0:y1, x0:x1]

    color_img = Image.fromarray(crop_rgb).resize((grid_w, grid_h), Image.BOX)
    mask_img = Image.fromarray((crop_fg * 255).astype(np.uint8)).resize((grid_w, grid_h), Image.BOX)
    mask = np.array(mask_img) > 127
    color = np.array(color_img)

    # Flip vertically: image row 0 is the top of the crop (highest point of
    # the subject), but we want array row 0 to be the bottom (z=0).
    return mask[::-1, :], color[::-1, :, :]


def carve_subject(subject_key: str, front_img: Image.Image, side_img: Image.Image, top_img: Image.Image) -> Model:
    X, Y, Z = VOXEL_DIMS[subject_key]

    front_mask, front_color = prepare_view(front_img, grid_w=X, grid_h=Z)  # (Z, X)
    side_mask, side_color = prepare_view(side_img, grid_w=Y, grid_h=Z)  # (Z, Y)
    top_mask, top_color = prepare_view(top_img, grid_w=X, grid_h=Y)  # (Y, X)

    F = front_mask.T  # (X, Z)
    S = side_mask.T  # (Y, Z)
    T = top_mask.T  # (X, Y)

    occ = F[:, None, :] & S[None, :, :] & T[:, :, None]  # (X, Y, Z)
    kept = int(occ.sum())
    print(f"  -> carved occupancy: {kept} / {X * Y * Z} cells kept")
    if kept == 0:
        raise RuntimeError(f"{subject_key}: carving produced zero voxels - views didn't overlap")

    color = np.zeros((X, Y, Z, 3), dtype=np.uint8)
    colored = np.zeros((X, Y, Z), dtype=bool)

    # Front: nearest-to-front (min y) voxel per (x, z) column.
    for x in range(X):
        for z in range(Z):
            if not F[x, z]:
                continue
            ys = np.nonzero(occ[x, :, z])[0]
            if len(ys) == 0:
                continue
            y = ys.min()
            color[x, y, z] = front_color[z, x]
            colored[x, y, z] = True

    # Side: nearest-to-side (max x) voxel per (y, z) column.
    for y in range(Y):
        for z in range(Z):
            if not S[y, z]:
                continue
            xs = np.nonzero(occ[:, y, z])[0]
            if len(xs) == 0:
                continue
            x = xs.max()
            if not colored[x, y, z]:
                color[x, y, z] = side_color[z, y]
                colored[x, y, z] = True

    # Top: nearest-to-top (max z) voxel per (x, y) column.
    for x in range(X):
        for y in range(Y):
            if not T[x, y]:
                continue
            zs = np.nonzero(occ[x, y, :])[0]
            if len(zs) == 0:
                continue
            z = zs.max()
            if not colored[x, y, z]:
                color[x, y, z] = top_color[y, x]
                colored[x, y, z] = True

    # Interior fallback: nearest already-colored voxel (small grids, so a
    # plain O(n*m) nearest search over the colored set is fine here).
    occ_pts = np.argwhere(occ)
    colored_pts = np.argwhere(colored)
    if len(colored_pts) == 0:
        raise RuntimeError(f"{subject_key}: carving kept voxels but none got a color from any view")
    for x, y, z in occ_pts:
        if colored[x, y, z]:
            continue
        d = np.sum((colored_pts - np.array([x, y, z])) ** 2, axis=1)
        nx, ny, nz = colored_pts[d.argmin()]
        color[x, y, z] = color[nx, ny, nz]
        colored[x, y, z] = True

    raw_colors = color[occ]
    palette_colors = b3d.reduce_palette(raw_colors)

    model: Model = []
    for (x, y, z), c in zip(occ_pts.tolist(), palette_colors.tolist()):
        model.append(Box(origin=(x, y, z), size=(1, 1, 1), color=tuple(c)))
    return model


def run_bridge_c(subject_key: str, skip_generate: bool) -> Path:
    records = b3d.load_costs()
    subject = b3d.SUBJECTS[subject_key]

    sheet_path = b3d.WORK_DIR / f"{subject_key}_bridge_c_concept.png"
    if skip_generate and sheet_path.exists():
        print(f"[SKIP-GEN] using existing {sheet_path}")
    else:
        prompt = BRIDGE_C_PROMPT_TMPL.format(description=subject["description"])
        sheet_path = b3d.generate_concept_image(subject_key, "bridge_c", prompt, records)

    sheet = Image.open(sheet_path).convert("RGB")
    front_img, side_img, top_img = split_into_three(sheet)

    model = carve_subject(subject_key, front_img, side_img, top_img)
    strip = render_model_strip(model)
    out_dir = b3d.OUT_ROOT / subject_key
    out_dir.mkdir(parents=True, exist_ok=True)
    strip_path = out_dir / "bridge_c_strip.png"
    strip.save(strip_path)
    print(f"[DONE] bridge C / {subject_key} -> {strip_path}")
    return strip_path


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--subject", choices=list(VOXEL_DIMS) + ["all"], default="all")
    parser.add_argument("--skip-generate", action="store_true", help="reuse an existing blueprint sheet")
    args = parser.parse_args()

    subjects = list(VOXEL_DIMS) if args.subject == "all" else [args.subject]
    for subject_key in subjects:
        run_bridge_c(subject_key, args.skip_generate)


if __name__ == "__main__":
    main()
