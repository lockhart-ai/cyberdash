"""Render the "Riot" NPC by recolouring the courier's own sprites (round 2).

Round 1 drew Riot from scratch as hand-authored text grids and lost the
courier's anatomy in the process: no arms, flat torso/legs, a south-east
pose that barely differed from south. Round 2 instead treats the courier as
a "mannequin" - standard pixel-art practice - and never draws a body from
scratch:

1. material_map.py classifies every pixel of a courier frame into a
   material (hair, skin, glasses, jacket, shirt, pants, shoes, ink) using
   colour + which height-band of the figure it's in.
2. This module swaps each material's 2-3 tone ramp for a new one (the
   "recipe"), erases the glasses and hair back to skin, and draws small
   hand-authored overlays (a mohawk, two eyes, a collar trim, a belt
   buckle) positioned from each frame's own head/glasses bounding box - so
   they track the walk-cycle bob instead of sitting at a fixed offset.

The courier's own PNGs under public/assets/player/ are only ever read here
and recoloured in memory - never written back to.

Run:
    python3 scripts/pixel/render_npc.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

import material_map as mm
import spritekit as sk

REPO_ROOT = Path(__file__).resolve().parents[2]
PLAYER_DIR = REPO_ROOT / "public" / "assets" / "player"
NPC_DIR = REPO_ROOT / "public" / "assets" / "sprites" / "npc"
REVIEW_DIR = Path("/Users/decker/Documents/cyberdash/pixel-output/round2")

IDLE_DIRECTIONS = [
    "south",
    "south-east",
    "east",
    "north-east",
    "north",
    "north-west",
    "west",
    "south-west",
]
WALK_DIRECTION = "south-east"
FRAME = 64

# ---- the recipe: a 2-3 tone ramp per material, swapped onto the courier's
# own shading pattern. Skin and ink are untouched - same human skin, same
# near-black outline rule as the courier.

SKIN_BASE = (248, 199, 174, 255)
SKIN_MID = (243, 184, 159, 255)

# Hair and glasses are "erased" back to skin (shaved head, bare face) -
# a mohawk and eyes are then drawn on top as overlays, positioned per frame.
_HAIR_OLD = [(52, 52, 68, 255), (39, 38, 50, 255)]
_HAIR_NEW = [SKIN_BASE, SKIN_MID]

# Dark oxblood cropped leather jacket (courier's suit is navy-grey).
_JACKET_OLD = [(52, 52, 68, 255), (39, 38, 50, 255)]
_JACKET_NEW = [(96, 34, 30, 255), (62, 20, 18, 255)]

# Dark indigo trousers - distinct from the jacket even though the courier
# draws jacket and trousers in the exact same colours (see material_map.py).
_PANTS_OLD = [(52, 52, 68, 255), (39, 38, 50, 255)]
_PANTS_NEW = [(40, 48, 64, 255), (28, 34, 48, 255)]

# Worn grey tank top under the open jacket collar (courier's crisp white shirt).
_SHIRT_OLD = [(232, 218, 212, 255), (243, 243, 243, 255)]
_SHIRT_NEW = [(140, 138, 132, 255), (104, 102, 98, 255)]

# Boots: base/shade + a lighter buckle-ish highlight tone.
_SHOES_OLD = [(52, 52, 68, 255), (39, 38, 50, 255), (124, 119, 128, 255)]
_SHOES_NEW = [(48, 46, 50, 255), (30, 28, 32, 255), (150, 148, 152, 255)]

RECIPE = {
    "ink": None,
    "skin": None,
    "hair": mm.make_ramp_recolor(_HAIR_OLD, _HAIR_NEW),
    "glasses_lens": lambda c: SKIN_MID,
    "glasses_frame": lambda c: SKIN_MID,
    "jacket": mm.make_ramp_recolor(_JACKET_OLD, _JACKET_NEW),
    "shirt": mm.make_ramp_recolor(_SHIRT_OLD, _SHIRT_NEW),
    "pants": mm.make_ramp_recolor(_PANTS_OLD, _PANTS_NEW),
    "shoes": mm.make_ramp_recolor(_SHOES_OLD, _SHOES_NEW),
}

MOHAWK_PALETTE = {"M": (255, 45, 170, 255), "m": (190, 25, 120, 255)}
MOHAWK_ROWS = [
    "..M..M..",
    ".MM..MM.",
    ".MMm.mMm",
    "MMMmmmMm",
    ".MMmmmm.",
    "..Mmmm..",
    "..Mmmm..",
]

EYE_DARK = (31, 29, 36, 255)
EYE_GLOW = (90, 255, 140, 255)
TRIM_COLOR = (214, 36, 148, 255)  # a mid-tone of the mohawk's own ramp
BUCKLE_COLOR = (170, 166, 172, 255)


def recolor_frame(im: Image.Image) -> Image.Image:
    """Apply the full Riot recipe to one 64x64 courier frame."""
    glasses = mm.glasses_bbox(im)
    head = mm.head_bbox(im)

    out = mm.apply_recipe(im, RECIPE)

    # Erase the glasses fully, including their own ink linework (a lens
    # outline left in place would be a ghost of glasses Riot doesn't wear).
    if glasses and (glasses[1] - glasses[0] + 1) >= 6:
        gminx, gmaxx, gminy, gmaxy = glasses
        for y in range(gminy - 1, gmaxy + 2):
            for x in range(gminx - 1, gmaxx + 2):
                if 0 <= x < out.width and 0 <= y < out.height and out.getpixel((x, y))[3] > 0:
                    out.putpixel((x, y), SKIN_MID)

    # Collar trim: tint the first row of jacket pixels (the shoulder/collar
    # seam) to match the mohawk, a small hand-placed repaint rather than a
    # ramp swap.
    labels = mm.classify_image(im)
    minx, maxx, miny, maxy = mm.figure_bbox(im)
    for y in range(miny, maxy + 1):
        if mm.band_of(y, miny, maxy) != "torso":
            continue
        row_jacket_xs = [x for x in range(out.width) if labels[y][x] == "jacket"]
        if row_jacket_xs:
            for x in row_jacket_xs:
                out.putpixel((x, y), TRIM_COLOR)
            break

    # Belt buckle: two pixels at the torso/leg seam, centred on the figure.
    for y in range(miny, maxy + 1):
        if mm.band_of(y, miny, maxy) != "leg":
            continue
        row_pants_xs = [x for x in range(out.width) if labels[y][x] == "pants"]
        if row_pants_xs:
            cx = (min(row_pants_xs) + max(row_pants_xs)) // 2
            out.putpixel((cx, y), BUCKLE_COLOR)
            out.putpixel((cx + 1, y), BUCKLE_COLOR)
            break

    # Mohawk, positioned from this frame's own head bbox - follows the walk bob.
    if head:
        hminx, hmaxx, hminy, _ = head
        mohawk = sk.grid_to_image(MOHAWK_ROWS, MOHAWK_PALETTE)
        cx = (hminx + hmaxx) // 2
        mx = cx - mohawk.width // 2
        my = hminy - (mohawk.height - 4)
        sk.composite(out, mohawk, mx, my)

    # Eyes, positioned from this frame's own glasses bbox - skipped on frames
    # (e.g. a back view) where no glasses are visible in the first place.
    if glasses and (glasses[1] - glasses[0] + 1) >= 6:
        gminx, gmaxx, gminy, _ = glasses
        out.putpixel((gminx + 1, gminy), EYE_DARK)
        out.putpixel((gmaxx - 1, gminy), EYE_GLOW)
        out.putpixel((gmaxx, gminy), EYE_GLOW)

    return sk.outline_pass(out)


def split_strip(im: Image.Image, frame_size: int = FRAME) -> list[Image.Image]:
    w, h = im.size
    count = w // frame_size
    return [im.crop((i * frame_size, 0, (i + 1) * frame_size, h)) for i in range(count)]


def join_strip(frames: list[Image.Image]) -> Image.Image:
    w = frames[0].width * len(frames)
    h = frames[0].height
    strip = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        strip.alpha_composite(f, (i * f.width, 0))
    return strip


def main() -> None:
    NPC_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)

    idle_courier: dict[str, Image.Image] = {}
    idle_riot: dict[str, Image.Image] = {}
    for d in IDLE_DIRECTIONS:
        im = Image.open(PLAYER_DIR / f"{d}.png").convert("RGBA")
        idle_courier[d] = im
        riot = recolor_frame(im)
        idle_riot[d] = riot
        sk.save_png(riot, str(NPC_DIR / f"riot-{d}.png"))
        print(f"wrote riot-{d}.png")

    walk_courier_strip = Image.open(PLAYER_DIR / f"walk-{WALK_DIRECTION}.png").convert("RGBA")
    walk_courier_frames = split_strip(walk_courier_strip)
    walk_riot_frames = [recolor_frame(f) for f in walk_courier_frames]
    walk_riot_strip = join_strip(walk_riot_frames)
    sk.save_png(walk_riot_strip, str(NPC_DIR / f"riot-walk-{WALK_DIRECTION}.png"))
    print(f"wrote riot-walk-{WALK_DIRECTION}.png")

    # Review sheet 1: courier vs Riot, all 8 idle directions.
    idle_pairs = []
    for d in IDLE_DIRECTIONS:
        idle_pairs.append(idle_courier[d])
        idle_pairs.append(idle_riot[d])
    idle_sheet = sk.make_review_sheet(idle_pairs, scale=6)
    sk.save_png(idle_sheet, str(REVIEW_DIR / "idle_sheet.png"))
    print("wrote idle_sheet.png")

    # Review sheet 2: both walk-south-east cycles.
    walk_pairs = []
    for c, r in zip(walk_courier_frames, walk_riot_frames):
        walk_pairs.append(c)
        walk_pairs.append(r)
    walk_sheet = sk.make_review_sheet(walk_pairs, scale=6)
    sk.save_png(walk_sheet, str(REVIEW_DIR / "walk_sheet.png"))
    print("wrote walk_sheet.png")


if __name__ == "__main__":
    main()
