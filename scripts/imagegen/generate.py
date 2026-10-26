#!/usr/bin/env python3
"""Generate reference sprite sheets from OpenRouter image models.

Assumptions (stated up front, per project convention):
- OPENROUTER_API_KEY lives in /Users/decker/Documents/cyberdash/.env (KEY=value line),
  the *main* checkout, not this worktree. We read it directly from that path and
  never print, log, or persist it anywhere else.
- Endpoint is POST https://openrouter.ai/api/v1/chat/completions with a `messages`
  array (one user message: a text part + image_url parts as base64 data URLs for
  references) and `modalities`. Generated images come back as data URLs in
  choices[0].message.images[].image_url.url. Image-only models reject that route
  (404 pointing at /api/v1/images instead); we retry those on POST
  /api/v1/images, which returns data[0].b64_json instead.
- Each round has its own spend cap; round 1 (people turnaround/walkcycle + one
  newspaper-box prop) spent $0.86 of a $3.00 cap. Round 2's cap is $4.00, and we
  refuse to start any further call once the running total for *that round*
  passes $3.50. We request usage.include=true so each response reports its own
  cost, and keep a running ledger in costs.json under that round's output dir.
- Reference assets are read-only. We only ever read them and write *enlarged
  copies* (or a generated palette swatch) to /tmp; we never touch the originals.
- Output (raw images + cost ledger) goes to /Users/decker/Documents/cyberdash/
  imagegen-output/round<N>/raw/, which is gitignored.

Usage:
  python3 scripts/imagegen/generate.py --round 2
  python3 scripts/imagegen/generate.py --round 2 --models openai/gpt-image-2 --prompts turnaround
"""

from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = Path("/Users/decker/Documents/cyberdash/.env")
IMAGEGEN_ROOT = Path("/Users/decker/Documents/cyberdash/imagegen-output")
TMP_REFS = Path("/tmp/imagegen_refs")

# total = hard cap for the round; stop = refuse to start a new call once the
# round's running total reaches this (leaves headroom under `total` for the
# call already in flight).
ROUND_SPEND_CAPS = {
    1: {"total": 3.00, "stop": 2.50},
    2: {"total": 4.00, "stop": 3.50},
}

API_URL = "https://openrouter.ai/api/v1/chat/completions"
IMAGES_API_URL = "https://openrouter.ai/api/v1/images"
REQUEST_TIMEOUT_S = 240

PLAYER_DIR = REPO_ROOT / "public" / "assets" / "player"
SPRITES_DIR = REPO_ROOT / "public" / "assets" / "sprites"
# Round 1 used props from the full purchased asset packs (asset_packs/) as style
# references. Jared's round-2 correction: reference only assets already chosen
# for the game, under public/assets/ in this checkout - these are the actual
# target style, not just "a pack we happen to have". All three are 4-rotation
# strips already, same composition as what we're asking the models to draw.
LIGHT_POLE = SPRITES_DIR / "light_pole.png"
PARKING_METER = SPRITES_DIR / "parking_meter.png"
CAR_REF = SPRITES_DIR / "cars" / "cars-0.png"

# Round-1 roster, kept for reference/reruns.
MODELS_ROUND1 = [
    "google/gemini-3-pro-image",
    "google/gemini-nano-banana-2.1",
    "openai/gpt-image-2",
    "black-forest-labs/flux-3-image",
    "recraft/recraft-v4-styles",
    "qwen/qwen-image-3",
    "bytedance-seed/seedream-5-0-pro",
]

# Round-2 default roster: the two round-1 winners, plus the three round-1
# failures to retry with fixed requests, plus a plain (non-styles) Recraft
# model as a fallback if recraft-v4-styles' style-reference requirement still
# can't be satisfied. qwen is explicitly skipped this round. Callers normally
# narrow this with --models for probing before committing to a full run.
MODELS_ROUND2 = [
    "bytedance-seed/seedream-5-0-pro",
    "openai/gpt-image-2",
    "google/gemini-3-pro-image",
    "google/gemini-nano-banana-2.1",
    "black-forest-labs/flux-3-image",
    "recraft/recraft-v4-styles",
    "recraft/recraft-v4.1",
]

BACKGROUND_CLAUSE = (
    "Flat solid pure magenta background, hex #FF00FF, filling every area outside "
    "the subject, so the background can be chroma-keyed out. No text, no labels, "
    "no numbers, no watermark, no drop shadow."
)

# Round 1 just asked for "crisp pixel art, no anti-aliasing" - every model we
# tested complied with that *in style* while actually rendering continuous-tone,
# high-resolution art (no real block structure at all; see cleanup.py). This
# round spells out the literal grid contract instead, in art-pixels, and points
# at an attached palette swatch so models stop inventing their own palette.
CHARACTER_GRID_CLAUSE = (
    "Draw this as genuine pixel art, not a smooth or painterly image merely "
    "styled to look like pixel art: every art-pixel is an exact 8x8 block of one "
    "flat, identical colour, aligned to an 8-pixel grid measured from the "
    "image's top-left corner (block boundaries fall exactly on multiples of 8 "
    "pixels). A single pure black, 1-art-pixel-wide outline traces the whole "
    "silhouette. Use at most 24 colours in total. No anti-aliasing, no "
    "gradients, no blur, no dithering, no soft or noisy shading - two "
    "neighbouring art-pixels are either the exact same flat colour or a "
    "hard-edged different one, never a blend. Each character cell is 64x64 "
    "art-pixels, and the character itself is about 44 art-pixels tall within "
    "that cell, matching the attached courier reference's proportions. A "
    "palette swatch image is attached showing the courier's exact in-game "
    "colours - use only those for the character's skin, clothing and boots, "
    "plus up to 4 extra accent colours of your own choice for hair and small "
    "details."
)

PROP_STYLE_CLAUSE = (
    "Match the isometric voxel-style pixel art of the three attached in-game "
    "reference props (a street light pole, a parking meter, and a car, each "
    "shown as a 4-rotation sheet) - the same chunky block shading, line "
    "weight, level of detail, proportions and camera angle. Crisp pixel art, "
    "no anti-aliasing, no gradients, no blur, no dithering."
)

PROMPTS = {
    "turnaround": {
        "text": (
            "A cyberpunk street character: a punk with a neon mohawk and a "
            "cropped jacket. Match the exact proportions and overall size of "
            "the attached reference courier character sprite. Draw it as a "
            "character turnaround sheet: the same character in the same pose, "
            "shown from 8 compass directions (N, NE, E, SE, S, SW, W, NW), one "
            "character per direction, evenly spaced in a single horizontal "
            "row. " + CHARACTER_GRID_CLAUSE + " " + BACKGROUND_CLAUSE
        ),
        "refs": ["south", "south-east", "palette_swatch"],
    },
    "walkcycle": {
        "text": (
            "The same kind of cyberpunk street punk character (neon mohawk, "
            "cropped jacket), matching the attached reference's proportions. "
            "Draw a walk-cycle sprite sheet of this character facing "
            "south-east (the same facing as the attached reference walk "
            "sheet), with exactly 6 frames evenly spaced in a single "
            "horizontal row, like the attached courier walk-cycle reference. "
            + CHARACTER_GRID_CLAUSE + " " + BACKGROUND_CLAUSE
        ),
        "refs": ["walk-south-east", "south-east", "palette_swatch"],
    },
    "prop_newspaper_box": {
        "text": (
            "A cyberpunk newspaper vending box - this is NOT a vending "
            "machine or a tall cabinet: it is a small, waist-high box "
            "standing on short legs, with a hinged glass or plastic window on "
            "its angled top showing stacked newspapers inside, and a coin "
            "slot on the front. Much smaller and simpler than any of the "
            "attached reference props - use those references only for the "
            "isometric voxel art style, not for this box's actual shape or "
            "size. " + PROP_STYLE_CLAUSE + " Draw it as a sheet of 4 rotations "
            "(front, right, back, left) of the same object, one rotation per "
            "cell, evenly spaced in a single horizontal row. " + BACKGROUND_CLAUSE
        ),
        "refs": ["light_pole", "parking_meter", "car"],
    },
    "prop_phone_booth": {
        "text": (
            "A cyberpunk phone booth: a freestanding public comms booth with "
            "a glass or neon-trimmed enclosure and an antenna or small signal "
            "dish on top. " + PROP_STYLE_CLAUSE + " Draw it as a sheet of 4 "
            "rotations (front, right, back, left) of the same object, one "
            "rotation per cell, evenly spaced in a single horizontal row. "
            + BACKGROUND_CLAUSE
        ),
        "refs": ["light_pole", "parking_meter", "car"],
    },
    "prop_food_stall": {
        "text": (
            "A cyberpunk street food stall: a small vendor cart or stall with "
            "a cloth or metal awning overhead and a glowing neon sign "
            "advertising food. " + PROP_STYLE_CLAUSE + " Draw it as a sheet of "
            "4 rotations (front, right, back, left) of the same object, one "
            "rotation per cell, evenly spaced in a single horizontal row. "
            + BACKGROUND_CLAUSE
        ),
        "refs": ["light_pole", "parking_meter", "car"],
    },
    "prop_drone": {
        "text": (
            "A cyberpunk delivery drone: a small quadcopter-style drone with "
            "visible rotors and a cargo pod or package slung underneath. "
            + PROP_STYLE_CLAUSE + " Draw it as a sheet of 4 rotations (front, "
            "right, back, left) of the same object, one rotation per cell, "
            "evenly spaced in a single horizontal row. " + BACKGROUND_CLAUSE
        ),
        "refs": ["light_pole", "parking_meter", "car"],
    },
}


def load_api_key() -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith("OPENROUTER_API_KEY="):
            value = line.split("=", 1)[1].strip()
            return value.strip('"').strip("'")
    raise RuntimeError(f"OPENROUTER_API_KEY not found in {ENV_PATH}")


def build_palette_swatch(dest: Path) -> Path:
    """A swatch of the courier's own most-used colours, so character prompts
    can point a model at exact hex values instead of trusting it to invent a
    matching palette (round 1 showed every model inventing its own)."""
    counts: dict[tuple[int, int, int], int] = {}
    for name in ["south.png", "south-east.png", "walk-south-east.png"]:
        arr = np.array(Image.open(PLAYER_DIR / name).convert("RGBA"))
        opaque = arr[arr[..., 3] > 10][:, :3]
        for r, g, b in opaque.tolist():
            key = (r, g, b)
            counts[key] = counts.get(key, 0) + 1
    top = sorted(counts.items(), key=lambda kv: -kv[1])[:24]

    cols = 6
    rows = (len(top) + cols - 1) // cols
    # cell size picked so the swatch clears flux-3-image's 256x256 minimum
    # reference-image size (round-2 probe: it 422'd on a 288x192 swatch).
    cell = 70
    swatch = Image.new("RGB", (cols * cell, rows * cell), (20, 20, 20))
    draw = ImageDraw.Draw(swatch)
    for i, (color, _count) in enumerate(top):
        x, y = (i % cols) * cell, (i // cols) * cell
        draw.rectangle([x + 2, y + 2, x + cell - 2, y + cell - 2], fill=color, outline=(255, 255, 255))
    swatch.save(dest)
    return dest


def make_ref_enlargements() -> dict[str, Path]:
    """Enlarge reference images with nearest-neighbour scaling into /tmp, read-only on sources."""
    TMP_REFS.mkdir(parents=True, exist_ok=True)
    specs = {
        "south": (PLAYER_DIR / "south.png", 8),
        "south-east": (PLAYER_DIR / "south-east.png", 8),
        "walk-south-east": (PLAYER_DIR / "walk-south-east.png", 8),
        "light_pole": (LIGHT_POLE, 1),
        "parking_meter": (PARKING_METER, 4),
        "car": (CAR_REF, 1),
    }
    out: dict[str, Path] = {}
    for key, (src, scale) in specs.items():
        dst = TMP_REFS / f"{key}_{scale}x.png"
        img = Image.open(src).convert("RGBA")
        big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
        big.save(dst)
        out[key] = dst
    out["palette_swatch"] = build_palette_swatch(TMP_REFS / "palette_swatch.png")
    return out


def to_data_url(path: Path) -> str:
    data = path.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:image/png;base64,{b64}"


def slug_dir(model: str) -> str:
    return model.replace("/", "__")


def load_costs(costs_path: Path) -> list[dict]:
    if costs_path.exists():
        return json.loads(costs_path.read_text())
    return []


def save_costs(costs_path: Path, records: list[dict]) -> None:
    costs_path.write_text(json.dumps(records, indent=2))


def running_total(records: list[dict]) -> float:
    return sum(r.get("cost", 0.0) or 0.0 for r in records)


def _post(api_key: str, url: str, body: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
        return json.loads(resp.read().decode("utf-8"))


def call_chat_completions(api_key: str, model: str, prompt_text: str, ref_urls: list[str], modalities: list[str]) -> dict:
    """POST /api/v1/chat/completions - the route most text+image chat models use."""
    content = [{"type": "text", "text": prompt_text}]
    for url in ref_urls:
        content.append({"type": "image_url", "image_url": {"url": url}})
    body = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "modalities": modalities,
        "usage": {"include": True},
    }
    return _post(api_key, API_URL, body)


def recraft_style_extra_fields(images_attempt: int, ref_urls: list[str]) -> dict:
    """recraft/recraft-v4-styles rejects requests with "style references are
    required" even though we already send input_references - that field is
    apparently read as *content* references, not *style* references. We don't
    have confirmed docs for the exact field name, so we try a couple of
    plausible shapes across successive images-route attempts before giving up
    on this model (recraft/recraft-v4.1, tried as a separate model slug, is
    the brief's suggested fallback if none of these land)."""
    if images_attempt == 1:
        return {"style_reference_images": ref_urls}
    if images_attempt == 2:
        return {"image_config": {"style_reference_images": ref_urls}}
    return {}


def call_images_endpoint(api_key: str, model: str, prompt_text: str, ref_urls: list[str], extra: dict | None = None) -> dict:
    """POST /api/v1/images - the route dedicated image-only models require
    instead. No output_format field: flux-3-image rejected it outright
    ("does not support: output_format"), and the response's b64_json is
    format-agnostic anyway - PIL sniffs the real format when we later open it,
    so we don't need to request a specific one."""
    body = {
        "model": model,
        "prompt": prompt_text,
        "input_references": [{"type": "image_url", "image_url": {"url": url}} for url in ref_urls],
        "n": 1,
        "usage": {"include": True},
    }
    if extra:
        body.update(extra)
    return _post(api_key, IMAGES_API_URL, body)


def extract_image_and_cost(resp_json: dict) -> tuple[bytes | None, float]:
    """Parse a /chat/completions response: image at choices[0].message.images[0]."""
    cost = 0.0
    usage = resp_json.get("usage") or {}
    if isinstance(usage, dict) and "cost" in usage:
        try:
            cost = float(usage["cost"])
        except (TypeError, ValueError):
            cost = 0.0
    image_bytes = None
    choices = resp_json.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        images = message.get("images") or []
        if images:
            url = images[0].get("image_url", {}).get("url", "")
            if url.startswith("data:") and "," in url:
                b64 = url.split(",", 1)[1]
                image_bytes = base64.b64decode(b64)
    return image_bytes, cost


def extract_image_and_cost_images_api(resp_json: dict) -> tuple[bytes | None, float]:
    """Parse a /images response: image at data[0].b64_json."""
    cost = 0.0
    usage = resp_json.get("usage") or {}
    if isinstance(usage, dict) and "cost" in usage:
        try:
            cost = float(usage["cost"])
        except (TypeError, ValueError):
            cost = 0.0
    image_bytes = None
    data = resp_json.get("data") or []
    if data and data[0].get("b64_json"):
        image_bytes = base64.b64decode(data[0]["b64_json"])
    return image_bytes, cost


def needs_images_endpoint(error_text: str) -> bool:
    # Two different 404 shapes mean the same thing: an explicit pointer at
    # /api/v1/images (flux, qwen, gpt-image-2, ...), or a routing-funnel
    # rejection with no mention of /images at all (recraft/recraft-v4-styles,
    # whose chat-completions route 404s on the *filter by output modality*
    # step before it would even get to a models-specific error).
    explicit_pointer = "/api/v1/images" in error_text and "cannot be used with the chat/completions" in error_text
    modality_routing_failure = "No endpoints found that support the requested output modalities" in error_text
    return explicit_pointer or modality_routing_failure


def needs_style_reference_retry(error_text: str) -> bool:
    # recraft/recraft-v4-styles: once routed past the modality-filter 404
    # above, chat-completions *does* reach Recraft's backend and hits its
    # real requirement - a style reference - which our plain input_references
    # field doesn't satisfy there either. Worth one more try on the images
    # route with the style-reference field guesses in recraft_style_extra_fields.
    return "style references are required" in error_text


def is_rate_limited(error_text: str) -> bool:
    return "rate-limited upstream" in error_text or '"code":429' in error_text


# Seconds to wait before each successive attempt once we've hit a rate limit,
# keyed by the attempt number *about to run* (i.e. the wait before attempt 2
# is RATE_LIMIT_BACKOFF[2]). Deliberately long and increasing: a shared
# upstream pool being briefly full needs real wall-clock time to free up, not
# a quick 2-second retry.
RATE_LIMIT_BACKOFF = {2: 30, 3: 90}


def run_one(api_key: str, model: str, prompt_id: str, prompt_text: str, ref_urls: list[str],
            records: list[dict], raw_dir: Path, costs_path: Path, spend_cap_stop: float) -> None:
    dest_dir = raw_dir / slug_dir(model)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / f"{prompt_id}.png"
    if dest_path.exists():
        print(f"[SKIP] {model} / {prompt_id}: already have {dest_path}, not re-spending")
        return

    # recraft-v4-styles gets extra attempts: one throwaway chat-route 404,
    # then up to 3 different guesses at its style-reference field on the
    # images route (see recraft_style_extra_fields). Every other model gets
    # chat-route, then images-route: 2 attempts, extended to 3 if we hit a
    # rate limit (see RATE_LIMIT_BACKOFF) since that's worth a real wait, not
    # giving up.
    max_attempts = 4 if model == "recraft/recraft-v4-styles" else 2

    attempt_num = 0
    images_attempt = 0
    last_error = ""
    route = "chat"
    chat_modalities = ["image", "text"]

    while attempt_num < max_attempts:
        attempt_num += 1
        total_so_far = running_total(records)
        if total_so_far >= spend_cap_stop:
            records.append({
                "model": model, "prompt": prompt_id, "attempt": attempt_num,
                "cost": 0.0, "status": "skipped-budget", "error": "",
            })
            save_costs(costs_path, records)
            print(f"[SKIP] {model} / {prompt_id}: running total ${total_so_far:.4f} >= cap, stopping new calls")
            return
        try:
            if route == "chat":
                print(f"[CALL] {model} / {prompt_id} (attempt {attempt_num}, route=chat, modalities={chat_modalities})")
                resp_json = call_chat_completions(api_key, model, prompt_text, ref_urls, chat_modalities)
                image_bytes, cost = extract_image_and_cost(resp_json)
            else:
                images_attempt += 1
                extra = recraft_style_extra_fields(images_attempt, ref_urls) if model == "recraft/recraft-v4-styles" else None
                print(f"[CALL] {model} / {prompt_id} (attempt {attempt_num}, route=images, extra_keys={list(extra or {})})")
                resp_json = call_images_endpoint(api_key, model, prompt_text, ref_urls, extra)
                image_bytes, cost = extract_image_and_cost_images_api(resp_json)
            records.append({
                "model": model, "prompt": prompt_id, "attempt": attempt_num,
                "cost": cost, "status": "ok" if image_bytes else "no-image", "error": "",
            })
            save_costs(costs_path, records)
            print(f"  -> cost=${cost:.4f} running_total=${running_total(records):.4f}")
            if image_bytes:
                dest_path.write_bytes(image_bytes)
                print(f"  -> saved {dest_path}")
                return
            last_error = "response had no image data"
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:500]
            last_error = f"HTTP {e.code}: {body}"
            records.append({
                "model": model, "prompt": prompt_id, "attempt": attempt_num,
                "cost": 0.0, "status": "error", "error": last_error,
            })
            save_costs(costs_path, records)
            print(f"  -> ERROR {last_error}")
            if route == "chat" and (needs_images_endpoint(body) or needs_style_reference_retry(body)):
                route = "images"
                continue  # retry immediately on the right endpoint, don't burn the attempt budget on sleeping
            if route == "chat" and chat_modalities != ["image"]:
                chat_modalities = ["image"]  # some models reject ["image", "text"]; retry image-only
            if is_rate_limited(body):
                max_attempts = max(max_attempts, 3)
                wait_s = RATE_LIMIT_BACKOFF.get(attempt_num + 1, 90)
                print(f"  -> rate-limited; backing off {wait_s}s before retrying (spacing the retry out, not hammering it)")
                time.sleep(wait_s)
                continue
        except Exception as e:  # noqa: BLE001 - we want to log and move on, not crash the batch
            last_error = f"{type(e).__name__}: {e}"
            records.append({
                "model": model, "prompt": prompt_id, "attempt": attempt_num,
                "cost": 0.0, "status": "error", "error": last_error,
            })
            save_costs(costs_path, records)
            print(f"  -> ERROR {last_error}")
        time.sleep(2)
    print(f"[FAIL] {model} / {prompt_id}: gave up after {attempt_num} attempts. Last error: {last_error}")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--round", type=int, default=2, choices=sorted(ROUND_SPEND_CAPS), help="output round (default 2)")
    parser.add_argument("--models", nargs="*", default=None, help="subset of model slugs to run")
    parser.add_argument("--prompts", nargs="*", default=None, help="subset of prompt ids to run")
    args = parser.parse_args()

    default_models = MODELS_ROUND2 if args.round == 2 else MODELS_ROUND1
    models = args.models if args.models else default_models
    prompt_ids = args.prompts if args.prompts else list(PROMPTS.keys())

    output_dir = IMAGEGEN_ROOT / f"round{args.round}"
    raw_dir = output_dir / "raw"
    costs_path = output_dir / "costs.json"
    caps = ROUND_SPEND_CAPS[args.round]

    api_key = load_api_key()
    raw_dir.mkdir(parents=True, exist_ok=True)
    ref_paths = make_ref_enlargements()
    ref_urls_by_key = {k: to_data_url(p) for k, p in ref_paths.items()}

    records = load_costs(costs_path)
    start_total = running_total(records)
    print(f"=== round {args.round}: starting total ${start_total:.4f}, stop at ${caps['stop']:.2f}, "
          f"hard cap ${caps['total']:.2f} ===")

    for model in models:
        for prompt_id in prompt_ids:
            spec = PROMPTS[prompt_id]
            ref_urls = [ref_urls_by_key[k] for k in spec["refs"]]
            run_one(api_key, model, prompt_id, spec["text"], ref_urls, records, raw_dir, costs_path, caps["stop"])

    total = running_total(records)
    this_run = total - start_total
    print(f"\n=== DONE. Round {args.round} total spend: ${total:.4f} (cap ${caps['total']:.2f}); "
          f"this invocation spent ${this_run:.4f} ===")


if __name__ == "__main__":
    main()
