#!/usr/bin/env python3
"""Generate reference sprite sheets from OpenRouter image models.

Assumptions (stated up front, per project convention):
- OPENROUTER_API_KEY lives in /Users/decker/Documents/cyberdash/.env (KEY=value line),
  the *main* checkout, not this worktree. We read it directly from that path and
  never print, log, or persist it anywhere else.
- Endpoint is POST https://openrouter.ai/api/v1/chat/completions with a `messages`
  array (one user message: a text part + image_url parts as base64 data URLs for
  references) and `modalities`. Generated images come back as data URLs in
  choices[0].message.images[].image_url.url.
- Hard spend cap for this whole round is $3.00. We request usage.include=true so
  each response reports its cost, keep a running total in costs.json, and refuse
  to start any further call once that total passes $2.50.
- Reference assets are read-only. We only ever read them and write *enlarged
  copies* to /tmp; we never touch the originals.
- Output (raw images + cost ledger) goes to /Users/decker/Documents/cyberdash/
  imagegen-output/round1/raw/, which is gitignored.

Usage: python3 scripts/imagegen/generate.py
"""

from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = Path("/Users/decker/Documents/cyberdash/.env")
OUTPUT_DIR = Path("/Users/decker/Documents/cyberdash/imagegen-output/round1")
RAW_DIR = OUTPUT_DIR / "raw"
COSTS_PATH = OUTPUT_DIR / "costs.json"
TMP_REFS = Path("/tmp/imagegen_refs")

SPEND_CAP_TOTAL = 3.00
SPEND_CAP_STOP = 2.50  # stop starting new calls once running total passes this

API_URL = "https://openrouter.ai/api/v1/chat/completions"
IMAGES_API_URL = "https://openrouter.ai/api/v1/images"
REQUEST_TIMEOUT_S = 240

PLAYER_DIR = REPO_ROOT / "public" / "assets" / "player"
VENDING_MACHINE = Path(
    "/Users/decker/Documents/cyberdash/asset_packs/Isometric Cyberpunk Streets/"
    "Isometric Cyberpunk Streets/Props/Cyberpunk Streets-160-Drink Dispenser-0.png"
)

MODELS = [
    "google/gemini-3-pro-image",
    "google/gemini-nano-banana-2.1",
    "openai/gpt-image-2",
    "black-forest-labs/flux-3-image",
    "recraft/recraft-v4-styles",
    "qwen/qwen-image-3",
    "bytedance-seed/seedream-5-0-pro",
]

BACKGROUND_CLAUSE = (
    "Flat solid pure magenta background, hex #FF00FF, filling every area outside "
    "the subject, so the background can be chroma-keyed out. Crisp pixel art with "
    "hard-edged pixels, no anti-aliasing, no blur, no gradients, no text, no "
    "labels, no numbers, no watermark, no drop shadow."
)

PROMPTS = {
    "turnaround": {
        "text": (
            "A cyberpunk street character: a punk with a neon mohawk and a cropped "
            "jacket. Match the exact pixel-art style, line weight, proportions, and "
            "overall size of the attached reference courier character sprite. Draw "
            "it as a character turnaround sheet: the same character in the same "
            "pose, shown from 8 compass directions (N, NE, E, SE, S, SW, W, NW), "
            "one character per direction, evenly spaced in a single horizontal "
            "row. " + BACKGROUND_CLAUSE
        ),
        "refs": ["south", "south-east"],
    },
    "walkcycle": {
        "text": (
            "The same kind of cyberpunk street punk character (neon mohawk, "
            "cropped jacket), in the same pixel-art style as the attached "
            "reference. Draw a walk-cycle sprite sheet of this character facing "
            "south-east (the same facing as the attached reference walk sheet), "
            "with exactly 6 frames evenly spaced in a single horizontal row, like "
            "the attached courier walk-cycle reference. " + BACKGROUND_CLAUSE
        ),
        "refs": ["walk-south-east", "south-east"],
    },
    "prop": {
        "text": (
            "A cyberpunk newspaper vending box / newspaper dispenser, in the same "
            "isometric voxel-style pixel art as the attached reference vending "
            "machine prop. Draw it as a sheet of 4 rotations (front, right, back, "
            "left) of the same object, one rotation per cell, evenly spaced in a "
            "single horizontal row, matching the style, proportions, and scale of "
            "the attached reference. " + BACKGROUND_CLAUSE
        ),
        "refs": ["vending"],
    },
}


def load_api_key() -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith("OPENROUTER_API_KEY="):
            value = line.split("=", 1)[1].strip()
            return value.strip('"').strip("'")
    raise RuntimeError(f"OPENROUTER_API_KEY not found in {ENV_PATH}")


def make_ref_enlargements() -> dict[str, Path]:
    """Enlarge reference images with nearest-neighbour scaling into /tmp, read-only on sources."""
    TMP_REFS.mkdir(parents=True, exist_ok=True)
    specs = {
        "south": (PLAYER_DIR / "south.png", 8),
        "south-east": (PLAYER_DIR / "south-east.png", 8),
        "walk-south-east": (PLAYER_DIR / "walk-south-east.png", 8),
        "vending": (VENDING_MACHINE, 2),
    }
    out: dict[str, Path] = {}
    for key, (src, scale) in specs.items():
        dst = TMP_REFS / f"{key}_{scale}x.png"
        img = Image.open(src).convert("RGBA")
        big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
        big.save(dst)
        out[key] = dst
    return out


def to_data_url(path: Path) -> str:
    data = path.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:image/png;base64,{b64}"


def slug_dir(model: str) -> str:
    return model.replace("/", "__")


def load_costs() -> list[dict]:
    if COSTS_PATH.exists():
        return json.loads(COSTS_PATH.read_text())
    return []


def save_costs(records: list[dict]) -> None:
    COSTS_PATH.write_text(json.dumps(records, indent=2))


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


def call_images_endpoint(api_key: str, model: str, prompt_text: str, ref_urls: list[str]) -> dict:
    """POST /api/v1/images - the route dedicated image-only models require instead."""
    body = {
        "model": model,
        "prompt": prompt_text,
        "input_references": [{"type": "image_url", "image_url": {"url": url}} for url in ref_urls],
        "n": 1,
        "output_format": "png",
        "usage": {"include": True},
    }
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
    return "/api/v1/images" in error_text and "cannot be used with the chat/completions" in error_text


def run_one(api_key: str, model: str, prompt_id: str, prompt_text: str, ref_urls: list[str], records: list[dict]) -> None:
    dest_dir = RAW_DIR / slug_dir(model)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / f"{prompt_id}.png"
    if dest_path.exists():
        print(f"[SKIP] {model} / {prompt_id}: already have {dest_path}, not re-spending")
        return

    # Two attempts total: chat/completions is tried first since it fits most models; a model
    # that reports it belongs on the dedicated /images endpoint is retried there once instead
    # of retrying chat/completions with a different `modalities` a second time for no reason.
    attempt_num = 0
    last_error = ""
    route = "chat"
    chat_modalities = ["image", "text"]

    while attempt_num < 2:
        attempt_num += 1
        total_so_far = running_total(records)
        if total_so_far >= SPEND_CAP_STOP:
            records.append({
                "model": model, "prompt": prompt_id, "attempt": attempt_num,
                "cost": 0.0, "status": "skipped-budget", "error": "",
            })
            save_costs(records)
            print(f"[SKIP] {model} / {prompt_id}: running total ${total_so_far:.4f} >= cap, stopping new calls")
            return
        try:
            if route == "chat":
                print(f"[CALL] {model} / {prompt_id} (attempt {attempt_num}, route=chat, modalities={chat_modalities})")
                resp_json = call_chat_completions(api_key, model, prompt_text, ref_urls, chat_modalities)
                image_bytes, cost = extract_image_and_cost(resp_json)
            else:
                print(f"[CALL] {model} / {prompt_id} (attempt {attempt_num}, route=images)")
                resp_json = call_images_endpoint(api_key, model, prompt_text, ref_urls)
                image_bytes, cost = extract_image_and_cost_images_api(resp_json)
            records.append({
                "model": model, "prompt": prompt_id, "attempt": attempt_num,
                "cost": cost, "status": "ok" if image_bytes else "no-image", "error": "",
            })
            save_costs(records)
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
            save_costs(records)
            print(f"  -> ERROR {last_error}")
            if route == "chat" and needs_images_endpoint(body):
                route = "images"
                continue  # retry immediately on the right endpoint, don't burn the attempt budget on sleeping
            if route == "chat" and chat_modalities != ["image"]:
                chat_modalities = ["image"]  # some models reject ["image", "text"]; retry image-only
        except Exception as e:  # noqa: BLE001 - we want to log and move on, not crash the batch
            last_error = f"{type(e).__name__}: {e}"
            records.append({
                "model": model, "prompt": prompt_id, "attempt": attempt_num,
                "cost": 0.0, "status": "error", "error": last_error,
            })
            save_costs(records)
            print(f"  -> ERROR {last_error}")
        time.sleep(2)
    print(f"[FAIL] {model} / {prompt_id}: gave up after {attempt_num} attempts. Last error: {last_error}")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="*", default=None, help="subset of model slugs to run")
    parser.add_argument("--prompts", nargs="*", default=None, help="subset of prompt ids to run")
    args = parser.parse_args()

    models = args.models if args.models else MODELS
    prompt_ids = args.prompts if args.prompts else list(PROMPTS.keys())

    api_key = load_api_key()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    ref_paths = make_ref_enlargements()
    ref_urls_by_key = {k: to_data_url(p) for k, p in ref_paths.items()}

    records = load_costs()

    for model in models:
        for prompt_id in prompt_ids:
            spec = PROMPTS[prompt_id]
            ref_urls = [ref_urls_by_key[k] for k in spec["refs"]]
            run_one(api_key, model, prompt_id, spec["text"], ref_urls, records)

    total = running_total(records)
    print(f"\n=== DONE. Total spend: ${total:.4f} (cap ${SPEND_CAP_TOTAL:.2f}) ===")


if __name__ == "__main__":
    main()
