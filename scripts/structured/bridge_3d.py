#!/usr/bin/env python3
"""Bridge A: image-model concept -> image-to-3D mesh -> voxelized render.

Assumptions (stated up front):
- This is issue #14's light prototype, not a pipeline: two subjects, one pass
  each, no retries-until-perfect. We're checking whether the approach is
  worth building out, not shipping it.
- Concept image: openai/gpt-image-2 via OpenRouter (the brief's cheapest-good
  pick), asked for a single centered object in a neutral 3/4 view on a plain
  background, styled off the in-game reference sprites under
  public/assets/sprites/ and public/assets/player/ (never asset_packs/ or
  anything outside public/assets/). gpt-image-2 is one of the models that
  reject /chat/completions and need /api/v1/images directly (per generate.py's
  own comments and the task brief), so we call that route only.
- Image-to-3D: firtoz/trellis on Replicate, not tencent/hunyuan3d-2mv.
  Hunyuan3D-2mv's schema takes 4 separate pre-cropped view images and its
  Output is a single bare URI with no documented texture guarantee. TRELLIS
  takes a plain `images` array (one image is enough), and its schema has an
  explicit `generate_model` + `texture_size` pair whose Output
  (`PredictOutput.model_file`) is a textured GLB by construction — a better
  fit for "one concept image in, one textured mesh out" than juggling 4
  matched views for an uncertain texture outcome.
- Replicate inputs accept data: URIs directly in a `format: uri` field
  (documented Replicate behaviour), so the concept PNG is sent inline —
  never uploaded anywhere else, never logged.
- Mesh -> voxels: trimesh loads the GLB, bakes its texture to per-vertex
  colors (visual.to_color()), reorients from GLB's Y-up to our Z-up (X=east,
  Y=south, Z=up, matching scripts/voxel/renderer.py), uniformly scales so
  the tallest axis matches the subject's target Z size (keeps true
  proportions rather than stretching to fit a box), then
  trimesh.voxel.creation.voxelize(...).fill() gives an occupancy grid
  (shell + filled interior) in one step. Each occupied voxel's color comes
  from its nearest mesh vertex (a scipy cKDTree over vertices) — an
  approximation, not exact texture sampling, but enough for this prototype.
  Colors are then palette-reduced to <=12 via PIL's median-cut quantizer.
- Front-facing orientation (which way "rotation 0 / SE" in the renderer
  faces) is a best-effort guess, not verified against the mesh's actual
  front — TRELLIS/image-to-3D models don't report a canonical front axis.
  We report whatever came out rather than hand-tuning it away.
- We only ever read public/assets/ and write to /tmp/structured_work/ (raw
  concept images, downloaded GLBs, logs — gitignored by living outside the
  repo) and /Users/decker/Documents/cyberdash/structured-output/round1/
  (final strips), per the task brief. Never asset_packs/, never public/assets/.
- API keys load from /Users/decker/Documents/cyberdash/.env by absolute path
  and are never printed, logged, or written to any output file.

Usage:
  python3 scripts/structured/bridge_3d.py --subject vending_machine
  python3 scripts/structured/bridge_3d.py --subject punk --skip-generate
"""

from __future__ import annotations

import base64
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = Path("/Users/decker/Documents/cyberdash/.env")
WORK_DIR = Path("/tmp/structured_work")
OUT_ROOT = Path("/Users/decker/Documents/cyberdash/structured-output/round1")
COSTS_PATH = WORK_DIR / "costs.json"

SPRITES_DIR = REPO_ROOT / "public" / "assets" / "sprites"
PLAYER_DIR = REPO_ROOT / "public" / "assets" / "player"

sys.path.insert(0, str(REPO_ROOT / "scripts" / "voxel"))
sys.path.insert(0, str(REPO_ROOT / "scripts" / "imagegen"))

from box import Box, Model  # noqa: E402
from renderer import render_model_strip  # noqa: E402
import generate as imagegen  # noqa: E402  (reused: call_images_endpoint, extract_image_and_cost_images_api)

CONCEPT_MODEL = "openai/gpt-image-2"
TRELLIS_VERSION = "e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c"
REPLICATE_API = "https://api.replicate.com/v1"

OPENROUTER_CAP = 1.00
REPLICATE_CAP = 2.00

MAX_PALETTE_COLORS = 12

# Reference images used for style guidance only (never for subject shape).
# scale = nearest-neighbour enlargement before sending, matching
# scripts/imagegen/generate.py's own practice for small sprites.
REF_SPECS = {
    "light_pole": (SPRITES_DIR / "light_pole.png", 1),
    "parking_meter": (SPRITES_DIR / "parking_meter.png", 4),
    "car": (SPRITES_DIR / "cars" / "cars-0.png", 1),
    "player_south_east": (PLAYER_DIR / "south-east.png", 8),
}

SUBJECTS = {
    "vending_machine": {
        "description": (
            "a cyberpunk street drink vending machine: a tall freestanding "
            "vending cabinet with a backlit panel showing drink selections, "
            "a coin/card slot, a small dispensing flap near the bottom, and "
            "neon trim or signage"
        ),
        "style_refs": ["light_pole", "parking_meter", "car"],
        "voxel_target_z": 28,  # ~12x10x28 per the brief; Z drives the uniform scale
    },
    "punk": {
        "description": (
            "a cyberpunk street punk NPC: a person with a tall neon mohawk, "
            "a cropped jacket, combat boots, standing in a relaxed idle "
            "pose with arms at sides"
        ),
        "style_refs": ["player_south_east"],
        "voxel_target_z": 24,  # ~8x6x24 per the brief
    },
}

BRIDGE_A_PROMPT_TMPL = (
    "{description}. Single object only, centered in frame, neutral 3/4 view "
    "(an elevated front-corner perspective - not flat front-on, not "
    "top-down, not a dramatic action angle), on a plain flat white "
    "background, no shadow, no ground plane, no other props or characters, "
    "no text, no watermark, no logo. Clean continuous-tone concept-art "
    "shading with soft gradients and highlights so a 3D reconstruction "
    "model can read its form clearly - this is NOT pixel art and NOT a "
    "flat-color illustration. Match the gritty cyberpunk industrial "
    "aesthetic, proportions and color palette of the attached in-game "
    "reference image(s), adapted to this subject's own shape."
)


def load_api_key(var_name: str) -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{var_name}="):
            value = line.split("=", 1)[1].strip()
            return value.strip('"').strip("'")
    raise RuntimeError(f"{var_name} not found in {ENV_PATH}")


def build_ref_data_url(path: Path, scale: int) -> str:
    img = Image.open(path).convert("RGBA")
    if scale != 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    import io

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def ref_urls_for(keys: list[str]) -> list[str]:
    return [build_ref_data_url(*REF_SPECS[k]) for k in keys]


# ---------------------------------------------------------------------------
# Cost ledger (shared across bridge_3d.py and bridge_carve.py)
# ---------------------------------------------------------------------------


def load_costs() -> list[dict]:
    if COSTS_PATH.exists():
        return json.loads(COSTS_PATH.read_text())
    return []


def save_costs(records: list[dict]) -> None:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    COSTS_PATH.write_text(json.dumps(records, indent=2))


def running_total(records: list[dict], service: str) -> float:
    return sum(r.get("cost", 0.0) or 0.0 for r in records if r.get("service") == service)


def record_cost(records: list[dict], service: str, note: str, cost: float) -> None:
    records.append({"service": service, "note": note, "cost": cost})
    save_costs(records)


# ---------------------------------------------------------------------------
# OpenRouter concept image generation
# ---------------------------------------------------------------------------


def call_openrouter_concept(api_key: str, prompt_text: str, ref_urls: list[str]) -> tuple[bytes | None, float, str]:
    """gpt-image-2 needs /api/v1/images directly (it rejects chat/completions
    outright), so we call that route only - no chat fallback for this model."""
    try:
        resp_json = imagegen.call_images_endpoint(api_key, CONCEPT_MODEL, prompt_text, ref_urls)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:500]
        return None, 0.0, f"HTTP {e.code}: {body}"
    image_bytes, cost = imagegen.extract_image_and_cost_images_api(resp_json)
    return image_bytes, cost, "" if image_bytes else "response had no image data"


def generate_concept_image(subject_key: str, kind: str, prompt_text: str, records: list[dict]) -> Path:
    """kind is 'bridge_a' or 'bridge_c'. Caches on disk - a repeat run won't
    re-spend."""
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    dest = WORK_DIR / f"{subject_key}_{kind}_concept.png"
    if dest.exists():
        print(f"[SKIP-GEN] {dest} already exists, not re-spending")
        return dest

    total_so_far = running_total(records, "openrouter")
    if total_so_far >= OPENROUTER_CAP:
        raise RuntimeError(f"OpenRouter spend ${total_so_far:.4f} already at/above cap ${OPENROUTER_CAP:.2f}")

    subject = SUBJECTS[subject_key]
    ref_urls = ref_urls_for(subject["style_refs"])
    api_key = load_api_key("OPENROUTER_API_KEY")
    print(f"[CALL] openrouter {CONCEPT_MODEL} / {subject_key}/{kind}")
    image_bytes, cost, error = call_openrouter_concept(api_key, prompt_text, ref_urls)
    record_cost(records, "openrouter", f"{subject_key}/{kind}", cost)
    print(f"  -> cost=${cost:.4f} running_total=${running_total(records, 'openrouter'):.4f}")
    if not image_bytes:
        raise RuntimeError(f"concept image generation failed for {subject_key}/{kind}: {error}")
    dest.write_bytes(image_bytes)
    print(f"  -> saved {dest}")
    return dest


# ---------------------------------------------------------------------------
# Replicate (TRELLIS) image-to-3D
# ---------------------------------------------------------------------------


def _replicate_request(api_key: str, method: str, path: str, body: dict | None = None) -> dict:
    url = f"{REPLICATE_API}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def run_trellis(api_key: str, image_data_url: str, records: list[dict], note: str) -> dict:
    total_so_far = running_total(records, "replicate")
    if total_so_far >= REPLICATE_CAP:
        raise RuntimeError(f"Replicate spend ${total_so_far:.4f} already at/above cap ${REPLICATE_CAP:.2f}")

    body = {
        "version": TRELLIS_VERSION,
        "input": {
            "images": [image_data_url],
            "generate_model": True,
            "generate_color": False,
            "generate_normal": False,
            "texture_size": 1024,
        },
    }
    created = _replicate_request(api_key, "POST", "/predictions", body)
    pred_id = created["id"]
    print(f"[CALL] replicate trellis prediction {pred_id} ({note})")

    start = time.time()
    status = created.get("status")
    result = created
    while status not in ("succeeded", "failed", "canceled"):
        if time.time() - start > 600:
            raise RuntimeError(f"trellis prediction {pred_id} timed out after 600s")
        time.sleep(5)
        result = _replicate_request(api_key, "GET", f"/predictions/{pred_id}")
        status = result.get("status")
        print(f"  -> status={status}")

    predict_time = (result.get("metrics") or {}).get("predict_time")
    # Replicate's prediction API doesn't return a dollar cost directly; we
    # log predict_time (seconds of billed GPU time) and leave the dollar
    # estimate to the account's own billing dashboard rather than guess at
    # a per-second rate we haven't confirmed.
    record_cost(records, "replicate", f"{note} (predict_time={predict_time}s, cost not reported by API)", 0.0)

    if status != "succeeded":
        raise RuntimeError(f"trellis prediction {pred_id} ended with status={status}: {result.get('error')}")
    return result["output"]


def download_file(url: str, dest: Path) -> Path:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=120) as resp:
        dest.write_bytes(resp.read())
    return dest


# ---------------------------------------------------------------------------
# Mesh -> voxels
# ---------------------------------------------------------------------------


def load_mesh_merged(glb_path: Path):
    import trimesh

    scene_or_mesh = trimesh.load(str(glb_path), force="scene")
    if isinstance(scene_or_mesh, trimesh.Scene):
        geoms = list(scene_or_mesh.dump(concatenate=False))
        mesh = trimesh.util.concatenate(geoms) if len(geoms) > 1 else geoms[0]
    else:
        mesh = scene_or_mesh
    # Bake any texture to per-vertex colors so we can sample without UV math.
    try:
        mesh.visual = mesh.visual.to_color()
    except Exception as e:  # noqa: BLE001 - fall back to a flat gray mesh, loudly
        print(f"  -> WARNING: could not bake texture to vertex colors ({e}); using flat gray")
    return mesh


def reorient_yup_to_zup(mesh):
    """glTF/GLB convention is Y-up, right-handed. Our renderer is Z-up
    (X=east, Y=south/depth, Z=up). A proper +90deg rotation about X sends
    (x, y, z) -> (x, -z, y), i.e. the old up axis (y) becomes the new up
    axis (z) with the same sign, and det=+1 so the mesh isn't mirrored.
    Caught by inspection (a quick vertex-color scatter plot of the raw
    mesh, projected front-on): a first attempt used (x, z, -y) instead,
    which negated the up axis and put the head at the bottom, feet at the
    top - a real finding about how easy this axis convention is to get
    backwards, not a hypothetical."""
    transform = np.array(
        [
            [1, 0, 0, 0],
            [0, 0, -1, 0],
            [0, 1, 0, 0],
            [0, 0, 0, 1],
        ],
        dtype=float,
    )
    mesh.apply_transform(transform)
    return mesh


def scale_to_target_height(mesh, target_z: float):
    bounds = mesh.bounds
    height = bounds[1][2] - bounds[0][2]
    if height <= 0:
        raise RuntimeError("mesh has zero height after reorientation")
    scale = target_z / height
    mesh.apply_scale(scale)
    # Sit on the ground plane (z=0) and center on x/y=0.
    bounds = mesh.bounds
    mesh.apply_translation([-(bounds[0][0] + bounds[1][0]) / 2, -(bounds[0][1] + bounds[1][1]) / 2, -bounds[0][2]])
    return mesh


def reduce_palette(colors: np.ndarray, max_colors: int = MAX_PALETTE_COLORS) -> np.ndarray:
    """colors: (N, 3) uint8. Returns (N, 3) uint8 snapped to a <=max_colors
    palette via PIL's median-cut quantizer."""
    n = len(colors)
    side = int(np.ceil(np.sqrt(n)))
    padded = np.zeros((side * side, 3), dtype=np.uint8)
    padded[:n] = colors
    img = Image.fromarray(padded.reshape(side, side, 3))
    quant = img.quantize(colors=max_colors, method=Image.MEDIANCUT)
    quant_rgb = np.array(quant.convert("RGB")).reshape(side * side, 3)
    return quant_rgb[:n]


def voxelize_mesh_to_model(mesh, target_z: int) -> Model:
    import trimesh

    pitch = 1.0  # one world unit == one voxel grid cell, after scale_to_target_height
    grid = trimesh.voxel.creation.voxelize(mesh, pitch=pitch)
    filled = grid.fill()
    points = filled.points  # (N, 3) world-space centers of occupied voxels (surface + interior)
    if len(points) == 0:
        raise RuntimeError("voxelization produced zero occupied voxels")

    vertices = mesh.visual.vertex_colors[:, :3] if hasattr(mesh.visual, "vertex_colors") else None
    from scipy.spatial import cKDTree

    tree = cKDTree(mesh.vertices)
    _, nearest_idx = tree.query(points)
    if vertices is not None:
        raw_colors = vertices[nearest_idx].astype(np.uint8)
    else:
        raw_colors = np.full((len(points), 3), 140, dtype=np.uint8)

    palette_colors = reduce_palette(raw_colors)

    # Map world points to non-negative integer grid cells (X=east, Y=south, Z=up).
    grid_idx = np.round(points).astype(int)
    grid_idx -= grid_idx.min(axis=0)  # shift so min index is 0 on every axis

    boxes: Model = []
    for (gx, gy, gz), color in zip(grid_idx.tolist(), palette_colors.tolist()):
        boxes.append(Box(origin=(gx, gy, gz), size=(1, 1, 1), color=tuple(color)))
    print(f"  -> voxelized to {len(boxes)} cells (target Z height {target_z})")
    return boxes


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def run_bridge_a(subject_key: str, skip_generate: bool, skip_replicate: bool) -> Path:
    subject = SUBJECTS[subject_key]
    records = load_costs()

    concept_path = WORK_DIR / f"{subject_key}_bridge_a_concept.png"
    if skip_generate and concept_path.exists():
        print(f"[SKIP-GEN] using existing {concept_path}")
    else:
        prompt = BRIDGE_A_PROMPT_TMPL.format(description=subject["description"])
        concept_path = generate_concept_image(subject_key, "bridge_a", prompt, records)

    glb_path = WORK_DIR / f"{subject_key}_bridge_a_mesh.glb"
    if skip_replicate and glb_path.exists():
        print(f"[SKIP-REPLICATE] using existing {glb_path}")
    else:
        replicate_key = load_api_key("REPLICATE_API_TOKEN")
        image_data_url = build_ref_data_url(concept_path, 1)
        output = run_trellis(replicate_key, image_data_url, records, f"{subject_key}/bridge_a")
        model_url = output["model_file"]
        download_file(model_url, glb_path)
        print(f"  -> saved {glb_path}")

    mesh = load_mesh_merged(glb_path)
    mesh = reorient_yup_to_zup(mesh)
    mesh = scale_to_target_height(mesh, subject["voxel_target_z"])
    model = voxelize_mesh_to_model(mesh, subject["voxel_target_z"])

    strip = render_model_strip(model)
    out_dir = OUT_ROOT / subject_key
    out_dir.mkdir(parents=True, exist_ok=True)
    strip_path = out_dir / "bridge_a_strip.png"
    strip.save(strip_path)
    print(f"[DONE] bridge A / {subject_key} -> {strip_path}")
    return strip_path


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--subject", choices=list(SUBJECTS) + ["all"], default="all")
    parser.add_argument("--skip-generate", action="store_true", help="reuse an existing concept image")
    parser.add_argument("--skip-replicate", action="store_true", help="reuse an existing downloaded GLB")
    args = parser.parse_args()

    subjects = list(SUBJECTS) if args.subject == "all" else [args.subject]
    for subject_key in subjects:
        run_bridge_a(subject_key, args.skip_generate, args.skip_replicate)


if __name__ == "__main__":
    main()
