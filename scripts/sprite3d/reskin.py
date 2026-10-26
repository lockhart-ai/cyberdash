#!/usr/bin/env python3
"""Issue #16: skin the sprite3d template with an image-model character design,
two ways (recipe-based "A" and whole-sheet reskin "C"), and compare them.

Assumptions (stated up front, per project convention):
- Reuses scripts/imagegen/generate.py wholesale for the OpenRouter plumbing
  (load_api_key, run_one's retry/route-fallback/budget-stop loop, cost
  ledger) rather than re-implementing it - that module's HTTP/retry/budget
  logic is generic over the prompt and reference images, so this script just
  calls it with #16's own prompts, refs and output dir. Likewise borrows
  cleanup.py's chroma-key, grid-detect/downsample, k-means and review.py's
  sheet-layout helpers where they apply unchanged.
- OPENROUTER_API_KEY lives in /Users/decker/Documents/cyberdash/.env (the
  *main* checkout, not this worktree) - generate.load_api_key() already
  knows that path. Never printed, logged or persisted elsewhere.
- Spend cap for this whole round (concept image + all three C reskin models,
  each sent an idle sheet and a walk sheet = 1 + 3*2 = 7 calls) is $2.00
  total, stop issuing new calls once the running total reaches $1.70 (same
  "leave headroom for the call in flight" pattern as generate.py's caps).
  One shared ledger at skin-output/round1/costs.json.
- Approach A (the recipe) is rendered by render.mjs itself (given a
  --characters filter added there) - this script only handles the concept
  image and approach C (the whole-sheet reskin models + clean-up) plus the
  final 4 review sheets, which compare A, C and the courier.
- The C input sheets (grey mannequin, magenta background, 8x nearest,
  frames on an 8px grid) are rendered by reskin.mjs (the sprite3d renderer,
  reused the same way render.mjs uses it) - see MANNEQUIN_DIR below for
  where it writes them and the frame-position metadata this script needs to
  crop the model's response back into 64x64 frames at known positions.
- Output goes under /Users/decker/Documents/cyberdash/skin-output/round1/,
  gitignored, the only place outside this worktree and /tmp this script may
  write (per the brief's budget).

Usage:
  python3 scripts/sprite3d/reskin.py --stage concept
  python3 scripts/sprite3d/reskin.py --stage creskin --models openai/gpt-image-2
  python3 scripts/sprite3d/reskin.py --stage clean
  python3 scripts/sprite3d/reskin.py --stage sheets
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[2]
PLAYER_DIR = REPO_ROOT / "public" / "assets" / "player"
SKIN_ROOT = Path("/Users/decker/Documents/cyberdash/skin-output")
ROUND_DIR = SKIN_ROOT / "round1"
RAW_DIR = ROUND_DIR / "raw"
CLEAN_DIR = ROUND_DIR / "clean"
WORK_DIR = ROUND_DIR / "work"
MANNEQUIN_DIR = ROUND_DIR / "mannequin"  # written by reskin.mjs
APPROACH_A_DIR = ROUND_DIR / "approach-a"  # written by render.mjs --characters streetpunk
COSTS_PATH = ROUND_DIR / "costs.json"

ROUND_SPEND_CAP_TOTAL = 2.00
ROUND_SPEND_CAP_STOP = 1.70

TMP_REFS = Path("/tmp/skin_refs")

# --- reuse scripts/imagegen's generate.py and cleanup.py wholesale --------------


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


imagegen_generate = _load_module("imagegen_generate", REPO_ROOT / "scripts" / "imagegen" / "generate.py")
imagegen_cleanup = _load_module("imagegen_cleanup", REPO_ROOT / "scripts" / "imagegen" / "cleanup.py")
imagegen_review = _load_module("imagegen_review", REPO_ROOT / "scripts" / "imagegen" / "review.py")

C_MODELS = [
    "openai/gpt-image-2",
    "bytedance-seed/seedream-5-0-pro",
    "google/gemini-3-pro-image",
]

CONCEPT_PROMPT = (
    "Character design concept art for a cyberpunk street punk: a tall spiked "
    "neon-green mohawk, a studded black leather jacket covered in patches, "
    "ripped jeans, chunky boots, and one arm replaced by a metallic cyber-arm "
    "(visible plating/joints from the shoulder or elbow down). Show the full "
    "body, front view and back view side by side as two clean poses on one "
    "image, arms relaxed at the sides, facing the camera square-on (front) "
    "and square away (back). Flat plain light-grey background, no text, no "
    "labels, no watermark, no drop shadow. The attached reference image is "
    "an 8x-enlarged in-game courier character, included only to show the "
    "target proportions (head-to-body ratio, stocky chibi-ish build) and "
    "overall cyberpunk style tone - match that build, not the courier's own "
    "clothing or colours."
)

IDLE_RESKIN_PROMPT = (
    "The first image is a reference sheet: a grey mannequin figure shown "
    "from 8 compass directions in a single row, on a flat magenta (#FF00FF) "
    "background. The second image is a character design (front and back "
    "view). Repaint every one of the 8 figures in the first image as the "
    "character in the second image - same spiked neon-green mohawk, studded "
    "black leather jacket with patches, ripped jeans, chunky boots, metallic "
    "cyber-arm. Keep each figure's exact position, size, pose and facing "
    "direction unchanged - do not move, resize, re-pose or re-arrange "
    "anything. Pixel art: every art-pixel is an exact 8x8 block of one flat "
    "colour, aligned to the same 8-pixel grid the mannequin sheet already "
    "uses; a single 1-art-pixel-wide black outline traces each figure's "
    "silhouette; at most 24 colours total; no anti-aliasing, no gradients, "
    "no blur, no dithering. Hair and clothing (the mohawk, the jacket) may "
    "extend slightly beyond the grey mannequin's own silhouette, but keep "
    "the flat magenta background exactly as-is everywhere else, and do not "
    "add a background, a ground plane, or any new elements."
)

WALK_RESKIN_PROMPT = (
    "The first image is a reference sheet: 6 frames of a grey mannequin "
    "walking, facing south-east, in a single row, on a flat magenta "
    "(#FF00FF) background. The second image is a character design (front "
    "and back view). Repaint every one of the 6 frames in the first image "
    "as the character in the second image - same spiked neon-green mohawk, "
    "studded black leather jacket with patches, ripped jeans, chunky boots, "
    "metallic cyber-arm. Keep each frame's exact position, size, pose and "
    "facing direction unchanged - do not move, resize, re-pose or "
    "re-arrange anything; this is a walk-cycle, so the character's outfit "
    "and colours must stay identical frame to frame, only the pose changes "
    "(as already drawn). Pixel art: every art-pixel is an exact 8x8 block "
    "of one flat colour, aligned to the same 8-pixel grid the mannequin "
    "sheet already uses; a single 1-art-pixel-wide black outline traces "
    "each figure's silhouette; at most 24 colours total; no anti-aliasing, "
    "no gradients, no blur, no dithering. Hair and clothing may extend "
    "slightly beyond the grey mannequin's own silhouette, but keep the flat "
    "magenta background exactly as-is everywhere else."
)


def make_concept_ref() -> Path:
    """8x nearest-neighbour enlargement of the courier south-east.png, as the
    concept call's style reference. Reads the reference read-only, writes
    only the enlarged copy, to /tmp."""
    TMP_REFS.mkdir(parents=True, exist_ok=True)
    src = PLAYER_DIR / "south-east.png"
    dst = TMP_REFS / "south-east_8x.png"
    img = Image.open(src).convert("RGBA")
    img.resize((img.width * 8, img.height * 8), Image.NEAREST).save(dst)
    return dst


def stage_concept(records: list[dict], api_key: str) -> None:
    ref_path = make_concept_ref()
    ref_url = imagegen_generate.to_data_url(ref_path)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    imagegen_generate.run_one(
        api_key, "openai/gpt-image-2", "concept", CONCEPT_PROMPT, [ref_url],
        records, RAW_DIR, COSTS_PATH, ROUND_SPEND_CAP_STOP,
    )


MAX_COLORS_C = 24
DIRS = ["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"]
WALK_COUNT = 6


def crop_letterbox(img: Image.Image) -> Image.Image:
    """Trim away a solid-black letterbox border some models add around the
    sheet when they return it on their own (differently-proportioned)
    canvas - observed on openai/gpt-image-2's responses here, which
    preserved the sheet's own aspect ratio but shrank it to fit their
    square-ish output size, padding the rest with black. A row/column counts
    as letterbox only if EVERY pixel in it is near-black; a content row with
    black clothing in it still has magenta background pixels alongside, so
    this doesn't risk trimming real content."""
    arr = np.array(img.convert("RGB"))
    not_black = arr.astype(np.int32).sum(axis=-1) > 30
    if not not_black.any():
        return img
    rows = np.where(not_black.any(axis=1))[0]
    cols = np.where(not_black.any(axis=0))[0]
    return img.crop((int(cols.min()), int(rows.min()), int(cols.max()) + 1, int(rows.max()) + 1))


def key_magenta(img: Image.Image, low: float = 50.0, high: float = 140.0) -> Image.Image:
    """Chroma-key straight against pure magenta (#FF00FF), unlike
    cleanup.py's key_out_magenta, which samples the image's own border to
    auto-detect the background colour - robust when the background colour
    is unknown, but here we dictated #FF00FF ourselves (reskin.mjs), and a
    model's letterbox padding (crop_letterbox trims the solid-black bars,
    but leaves a thin anti-aliased black/magenta transition ring at the cut)
    can otherwise fool the border sample into reading near-black as "the
    background"."""
    arr = np.array(img.convert("RGBA")).astype(np.float64)
    dist = np.sqrt(((arr[..., :3] - imagegen_cleanup.MAGENTA) ** 2).sum(axis=-1))
    alpha_mult = np.clip((dist - low) / (high - low), 0.0, 1.0)
    arr[..., 3] = arr[..., 3] * alpha_mult
    arr[alpha_mult < 0.2, 0:3] = 0
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def dilate_mask(mask: np.ndarray, iterations: int) -> np.ndarray:
    """4-neighbour binary dilation, `iterations` times (Manhattan-distance
    dilation by `iterations` px) - used to grow the template silhouette a
    few px so a repainted mohawk/coat can extend past the grey mannequin's
    own outline without opening the door to arbitrary stray paint."""
    out = mask
    for _ in range(iterations):
        p = np.pad(out, 1)
        out = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    return out


def mask_to_template(frame: Image.Image, template_alpha: np.ndarray, dilate_px: int = 3) -> Image.Image:
    """Force transparent anything outside the template silhouette dilated by
    `dilate_px` - the brief's "mask to the template silhouette dilated by
    ~3px (so a mohawk/coat can extend, but stray paint can't)"."""
    allowed = dilate_mask(template_alpha > 10, dilate_px)
    arr = np.array(frame.convert("RGBA"))
    arr[~allowed] = [0, 0, 0, 0]
    return Image.fromarray(arr)


def build_frame_palette(img: Image.Image, max_colors: int = MAX_COLORS_C) -> list[tuple[int, int, int]]:
    """The brief's "build a palette (<=24) from the idle south frame" - the
    frame's own distinct opaque colours, k-means-reduced to max_colors if it
    has more (reusing cleanup.py's simple_kmeans, the same reduction
    render.mjs's own quantizeMedianCut and this module's map_to_palette_or_kmeans
    already rely on elsewhere in this pipeline)."""
    arr = np.array(img.convert("RGBA"))
    opaque = arr[..., 3] > 10
    if not opaque.any():
        return [(128, 128, 128)]
    pixels = arr[opaque][:, :3].astype(np.float64)
    colors, counts = np.unique(pixels, axis=0, return_counts=True)
    if len(colors) <= max_colors:
        return [tuple(int(c) for c in col) for col in colors]
    centroids = imagegen_cleanup.simple_kmeans(colors, counts, max_colors)
    return [tuple(int(round(c)) for c in cen) for cen in centroids]


def snap_to_palette(img: Image.Image, palette: list[tuple[int, int, int]]) -> Image.Image:
    """The brief's "map every frame to it" - every opaque pixel snapped to
    its nearest colour in the given palette, no exceptions (unlike
    map_to_palette_or_kmeans's compliance-threshold/outlier-kmeans logic,
    which is for mapping toward a palette the model was only asked to
    prefer; here the palette was built FROM this character, so a direct
    nearest-colour snap is the right contract)."""
    arr = np.array(img.convert("RGBA"))
    alpha = arr[..., 3]
    opaque = alpha > 10
    if not opaque.any():
        return img
    pal = np.array(palette, dtype=np.float64)
    pixels = arr[opaque][:, :3].astype(np.float64)
    dist = ((pixels[:, None, :] - pal[None, :, :]) ** 2).sum(-1)
    nearest = pal[dist.argmin(axis=1)]
    out_rgb = np.zeros((*alpha.shape, 3))
    out_rgb[opaque] = nearest
    out = np.dstack([out_rgb, alpha]).astype(np.uint8)
    out[~opaque] = [0, 0, 0, 0]
    return Image.fromarray(out)


def draw_outline(img: Image.Image, color: tuple[int, int, int] = (15, 12, 12)) -> Image.Image:
    """The brief's "re-draw the 1px outline" - a fresh near-black ring on
    every transparent pixel 4-adjacent to an opaque one (the renderer.js
    postProcess convention, not cleanup.py's add_outline, which only
    darkens already-dark-enough edge pixels in place and can't repair an
    outline the silhouette mask just cut through unevenly)."""
    arr = np.array(img.convert("RGBA"))
    opaque = arr[..., 3] > 10
    pad = np.pad(opaque, 1)
    neighbor_opaque = pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]
    needs_outline = (~opaque) & neighbor_opaque
    arr[needs_outline] = [*color, 255]
    return Image.fromarray(arr)


def pre_palette_frame(strip: Image.Image) -> tuple[Image.Image | None, dict]:
    """First half of cleanup, shared with cleanup.py's process_frame: trim,
    detect/apply a real pixel-art grid or fall back to a quality box
    downscale, resize to the courier's target figure height. Colour mapping
    is deferred - approach C needs the south idle frame's own palette built
    from ALL frames' pre-palette colours first (see stage_clean)."""
    meta: dict = {"grid_path": None, "cell": None, "grid_confidence": None}
    content = imagegen_cleanup.trim_to_content(strip)
    if content is None:
        return None, meta
    grid = imagegen_cleanup.detect_grid(content)
    if grid is not None:
        cell, offset_x, offset_y, confidence = grid
        pixelated = imagegen_cleanup.downsample_grid(content, cell, offset_x, offset_y)
        resize_filter = Image.NEAREST
        meta.update(grid_path="grid", cell=cell, grid_confidence=round(confidence, 3))
    else:
        pixelated = content
        resize_filter = Image.BOX
        meta.update(grid_path="fallback")
    resized = imagegen_cleanup.downsample_box(pixelated, imagegen_cleanup.COURIER_TARGET_HEIGHT, resize_filter)
    return resized, meta


def finish_frame(resized: Image.Image, palette: list[tuple[int, int, int]], template_alpha: np.ndarray) -> Image.Image | None:
    mapped = snap_to_palette(resized, palette)
    despeckled = imagegen_cleanup.despeckle(mapped)
    snapped = imagegen_cleanup.snap_alpha(despeckled)
    trimmed = imagegen_cleanup.trim_to_content(snapped)
    if trimmed is None:
        return None
    canvas = imagegen_cleanup.place_on_character_canvas(trimmed)
    masked = mask_to_template(canvas, template_alpha)
    return draw_outline(masked)


def load_template_alpha(anim: str, pos) -> np.ndarray:
    if anim == "idle":
        path = MANNEQUIN_DIR / "frames" / f"idle-{pos}.png"
    else:
        path = MANNEQUIN_DIR / "frames" / f"walk-south-east-{pos}.png"
    return np.array(Image.open(path).convert("RGBA"))[..., 3]


def process_c_model(model_slug: str) -> tuple[dict, list[dict], list[tuple[int, int, int]]]:
    model_dir_name = imagegen_generate.slug_dir(model_slug)
    idle_raw = RAW_DIR / model_dir_name / "idle.png"
    walk_raw = RAW_DIR / model_dir_name / "walk.png"
    if not idle_raw.exists() or not walk_raw.exists():
        raise RuntimeError(f"{model_slug}: missing raw idle/walk output - run --stage creskin first")

    idle_keyed = key_magenta(crop_letterbox(Image.open(idle_raw).convert("RGBA")))
    walk_keyed = key_magenta(crop_letterbox(Image.open(walk_raw).convert("RGBA")))
    idle_boxes = imagegen_cleanup.segment_frames(idle_keyed, len(DIRS))
    walk_boxes = imagegen_cleanup.segment_frames(walk_keyed, WALK_COUNT)
    if len(idle_boxes) != len(DIRS):
        print(f"  [note] {model_slug}: idle segmentation found {len(idle_boxes)}/{len(DIRS)} cells")
    if len(walk_boxes) != WALK_COUNT:
        print(f"  [note] {model_slug}: walk segmentation found {len(walk_boxes)}/{WALK_COUNT} cells")

    pre: dict[tuple, tuple[Image.Image | None, dict]] = {}
    for i, box in enumerate(idle_boxes):
        pre[("idle", DIRS[i])] = pre_palette_frame(idle_keyed.crop(box))
    for i, box in enumerate(walk_boxes):
        pre[("walk", i)] = pre_palette_frame(walk_keyed.crop(box))

    south_resized, _ = pre.get(("idle", "south"), (None, {}))
    if south_resized is None:
        print(f"  [FAIL LOUD] {model_slug}: idle south frame didn't survive clean-up - "
              f"building the palette from all idle frames combined instead")
        combined = Image.new("RGBA", (64 * 8, 64), (0, 0, 0, 0))
        x = 0
        for (anim, pos), (img, _m) in pre.items():
            if anim == "idle" and img is not None:
                combined.paste(img, (x, 0))
                x += img.width
        palette = build_frame_palette(combined)
    else:
        palette = build_frame_palette(south_resized)

    outputs: dict[tuple, Image.Image | None] = {}
    metas: list[dict] = []
    for key, (resized, meta) in pre.items():
        anim, pos = key
        meta = {**meta, "anim": anim, "pos": pos}
        if resized is None:
            outputs[key] = None
            meta["saved"] = False
            metas.append(meta)
            continue
        template_alpha = load_template_alpha(anim, pos)
        final = finish_frame(resized, palette, template_alpha)
        outputs[key] = final
        meta["saved"] = final is not None
        metas.append(meta)

    out_dir = CLEAN_DIR / model_dir_name
    (out_dir / "idle").mkdir(parents=True, exist_ok=True)
    (out_dir / "walk").mkdir(parents=True, exist_ok=True)
    for (anim, pos), img in outputs.items():
        if img is None:
            continue
        name = f"{pos}.png" if anim == "idle" else f"{pos}.png"
        img.save(out_dir / anim / name)
    (out_dir / "meta.json").write_text(json.dumps(metas, indent=2))
    (out_dir / "palette.json").write_text(json.dumps(palette, indent=2))

    grid_n = sum(1 for m in metas if m.get("grid_path") == "grid")
    fallback_n = sum(1 for m in metas if m.get("grid_path") == "fallback")
    saved_n = sum(1 for m in metas if m.get("saved"))
    print(f"  {model_slug}: {saved_n}/{len(metas)} frames saved, grid path {grid_n}, box-resize fallback {fallback_n}")
    return outputs, metas, palette


def stage_clean(models: list[str]) -> None:
    for model in models:
        print(f"[CLEAN] {model}")
        process_c_model(model)


def stage_creskin(records: list[dict], api_key: str, models: list[str]) -> None:
    idle_sheet = MANNEQUIN_DIR / "idle-8dir-8x.png"
    walk_sheet = MANNEQUIN_DIR / "walk-south-east-8x.png"
    concept_path = RAW_DIR / imagegen_generate.slug_dir("openai/gpt-image-2") / "concept.png"
    if not idle_sheet.exists() or not walk_sheet.exists():
        raise RuntimeError(
            f"mannequin sheets missing ({idle_sheet}, {walk_sheet}) - run "
            f"`node scripts/sprite3d/reskin.mjs` first"
        )
    if not concept_path.exists():
        raise RuntimeError(f"concept image missing ({concept_path}) - run --stage concept first")

    idle_url = imagegen_generate.to_data_url(idle_sheet)
    walk_url = imagegen_generate.to_data_url(walk_sheet)
    concept_url = imagegen_generate.to_data_url(concept_path)

    for model in models:
        imagegen_generate.run_one(
            api_key, model, "idle", IDLE_RESKIN_PROMPT, [idle_url, concept_url],
            records, RAW_DIR, COSTS_PATH, ROUND_SPEND_CAP_STOP,
        )
        imagegen_generate.run_one(
            api_key, model, "walk", WALK_RESKIN_PROMPT, [walk_url, concept_url],
            records, RAW_DIR, COSTS_PATH, ROUND_SPEND_CAP_STOP,
        )


BG = (120, 120, 120, 255)  # "mid-grey background" per the brief, for the comparison sheets
MAX_SHEET_WIDTH = 2000

C_ROW_LABELS = {
    "openai/gpt-image-2": "C: gpt-image-2",
    "bytedance-seed/seedream-5-0-pro": "C: seedream-5-0-pro",
    "google/gemini-3-pro-image": "C: gemini-3-pro-image",
}
BEST_C_MODEL = "openai/gpt-image-2"  # the only one that preserved all 8 idle directions - see the report


def _open_or_blank(path: Path, size=(64, 64)) -> Image.Image:
    if path.exists():
        return Image.open(path).convert("RGBA")
    blank = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(blank).text((4, size[1] // 2 - 6), "missing", fill=(220, 80, 80, 255))
    return blank


def row_cells_idle(frame_paths: list[Path], label: str, cell_w: int, row_h: int) -> tuple[Image.Image, list[Image.Image]]:
    cells = [imagegen_review.fit_in_box(_open_or_blank(p), cell_w, row_h) for p in frame_paths]
    return imagegen_review.label_cell(label, 160, row_h), cells


def build_idle_sheet() -> Image.Image:
    label_w, cell_w, row_h, pad = 160, 215, 240, 6
    rows: list[tuple[str, list[Path]]] = [
        ("courier", [PLAYER_DIR / f"{d}.png" for d in DIRS]),
        ("template (grey)", [MANNEQUIN_DIR / "frames" / f"idle-{d}.png" for d in DIRS]),
        ("A: streetpunk", [APPROACH_A_DIR / "streetpunk" / f"idle-{d}.png" for d in DIRS]),
    ]
    for model in C_MODELS:
        rows.append((C_ROW_LABELS[model], [CLEAN_DIR / imagegen_generate.slug_dir(model) / "idle" / f"{d}.png" for d in DIRS]))

    total_w = label_w + len(DIRS) * (cell_w + pad) + pad
    assert total_w <= MAX_SHEET_WIDTH, f"idle sheet is {total_w}px, over the {MAX_SHEET_WIDTH}px cap"
    header_h = 30
    total_h = header_h + len(rows) * (row_h + pad) + pad
    sheet = Image.new("RGBA", (total_w, total_h), BG)
    draw = ImageDraw.Draw(sheet)
    x = label_w
    for d in DIRS:
        draw.text((x + pad, 8), d, font=imagegen_review.FONT_SMALL, fill=imagegen_review.TEXT_COLOR)
        x += cell_w + pad
    y = header_h
    for label, paths in rows:
        label_cell, cells = row_cells_idle(paths, label, cell_w, row_h)
        sheet.paste(label_cell, (0, y))
        x = label_w
        for cell in cells:
            sheet.paste(cell, (x, y))
            x += cell_w + pad
        y += row_h + pad
    return sheet


def build_walk_sheet() -> Image.Image:
    label_w, strip_box_w, row_h, pad = 160, 1180, 220, 6
    rows: list[tuple[str, Image.Image | None]] = []

    courier_strip = Image.open(PLAYER_DIR / "walk-south-east.png").convert("RGBA")
    rows.append(("courier", courier_strip))

    mannequin_frames = [MANNEQUIN_DIR / "frames" / f"walk-south-east-{i}.png" for i in range(WALK_COUNT)]
    rows.append(("template (grey)", imagegen_review.build_clean_strip(mannequin_frames)))

    a_strip_path = APPROACH_A_DIR / "streetpunk" / "walk-south-east.png"
    rows.append(("A: streetpunk", Image.open(a_strip_path).convert("RGBA") if a_strip_path.exists() else None))

    for model in C_MODELS:
        frame_dir = CLEAN_DIR / imagegen_generate.slug_dir(model) / "walk"
        frames = sorted(frame_dir.glob("*.png"), key=lambda p: int(p.stem)) if frame_dir.exists() else []
        rows.append((C_ROW_LABELS[model], imagegen_review.build_clean_strip(frames)))

    total_w = label_w + strip_box_w + 2 * pad
    assert total_w <= MAX_SHEET_WIDTH, f"walk sheet is {total_w}px, over the {MAX_SHEET_WIDTH}px cap"
    total_h = len(rows) * (row_h + pad) + pad
    sheet = Image.new("RGBA", (total_w, total_h), BG)
    y = pad
    for label, strip in rows:
        sheet.paste(imagegen_review.label_cell(label, label_w, row_h), (0, y))
        if strip is not None:
            sheet.paste(imagegen_review.fit_in_box(strip, strip_box_w, row_h), (label_w + pad, y))
        y += row_h + pad
    return sheet


def build_closeup_sheet() -> Image.Image:
    zoom = 6
    cell_w, cell_h, label_w, pad = 64 * zoom, 64 * zoom, 160, 6
    rows = [
        ("courier", [PLAYER_DIR / "south.png", PLAYER_DIR / "south-east.png"]),
        ("A: streetpunk", [APPROACH_A_DIR / "streetpunk" / "idle-south.png", APPROACH_A_DIR / "streetpunk" / "idle-south-east.png"]),
        (C_ROW_LABELS[BEST_C_MODEL], [
            CLEAN_DIR / imagegen_generate.slug_dir(BEST_C_MODEL) / "idle" / "south.png",
            CLEAN_DIR / imagegen_generate.slug_dir(BEST_C_MODEL) / "idle" / "south-east.png",
        ]),
    ]
    total_w = label_w + 2 * (cell_w + pad) + pad
    total_h = len(rows) * (cell_h + pad) + pad
    sheet = Image.new("RGBA", (total_w, total_h), BG)
    y = pad
    for label, paths in rows:
        sheet.paste(imagegen_review.label_cell(label, label_w, cell_h), (0, y))
        x = label_w
        for p in paths:
            img = _open_or_blank(p).resize((cell_w, cell_h), Image.NEAREST)
            sheet.paste(img, (x, y), img)
            x += cell_w + pad
        y += cell_h + pad
    return sheet


def stage_sheets() -> None:
    concept_path = RAW_DIR / imagegen_generate.slug_dir("openai/gpt-image-2") / "concept.png"
    Image.open(concept_path).convert("RGB").save(ROUND_DIR / "sheet1-concept.png")
    print(f"  wrote {ROUND_DIR / 'sheet1-concept.png'}")

    idle_sheet = build_idle_sheet()
    idle_sheet.convert("RGB").save(ROUND_DIR / "sheet2-idle.png")
    print(f"  wrote {ROUND_DIR / 'sheet2-idle.png'} ({idle_sheet.width}x{idle_sheet.height})")

    walk_sheet = build_walk_sheet()
    walk_sheet.convert("RGB").save(ROUND_DIR / "sheet3-walk-south-east.png")
    print(f"  wrote {ROUND_DIR / 'sheet3-walk-south-east.png'} ({walk_sheet.width}x{walk_sheet.height})")

    closeup_sheet = build_closeup_sheet()
    closeup_sheet.convert("RGB").save(ROUND_DIR / "sheet4-closeup.png")
    print(f"  wrote {ROUND_DIR / 'sheet4-closeup.png'} ({closeup_sheet.width}x{closeup_sheet.height})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stage", required=True, choices=["concept", "creskin", "clean", "sheets"])
    parser.add_argument("--models", nargs="*", default=C_MODELS, help="subset of C models (creskin stage only)")
    args = parser.parse_args()

    ROUND_DIR.mkdir(parents=True, exist_ok=True)
    records = imagegen_generate.load_costs(COSTS_PATH)
    start_total = imagegen_generate.running_total(records)
    print(f"=== skin round1: starting total ${start_total:.4f}, stop at ${ROUND_SPEND_CAP_STOP:.2f}, "
          f"hard cap ${ROUND_SPEND_CAP_TOTAL:.2f} ===")

    api_key = imagegen_generate.load_api_key()

    if args.stage == "concept":
        stage_concept(records, api_key)
    elif args.stage == "creskin":
        stage_creskin(records, api_key, args.models)
    elif args.stage == "clean":
        stage_clean(args.models)
    elif args.stage == "sheets":
        stage_sheets()

    total = imagegen_generate.running_total(records)
    print(f"\n=== DONE. round1 total spend: ${total:.4f} (cap ${ROUND_SPEND_CAP_TOTAL:.2f}); "
          f"this invocation spent ${total - start_total:.4f} ===")


if __name__ == "__main__":
    main()
