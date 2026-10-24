"""Classify the courier's own sprite pixels into materials, by colour family + body band.

The courier's hair, jacket and trousers turn out to share the *exact same*
RGBA values (a small "dark fill" ramp reused across the whole silhouette to
save palette) - so colour alone can't tell hair from jacket from trousers.
What disambiguates them is where on the body they sit. This module:

1. Finds each frame's figure bounding box and splits it into four bands by
   height fraction: head, torso, leg, foot (see BAND_FRACTIONS).
2. Buckets every RGBA colour into a coarse "colour family" (ink, skin, cyan
   lens, light/near-white, neutral grey, dark fill, other) by simple
   thresholds on value and channel spread - this covers all ~285 colours
   used across the courier's idle/walk/run sheets, not just a hand-picked
   list, so nothing falls through unclassified.
3. Combines (band, family) -> material via MATERIAL_TABLE, a small table
   written out in full below.

Outline ink is never reassigned to a material - it stays ink in any band,
matching the courier's own rule (a fixed near-black, not a shade of
whatever it borders).

Verify with a false-colour render: classify_image() + FALSE_COLOURS.
"""

from __future__ import annotations

from PIL import Image

RGBA = tuple[int, int, int, int]

# ---- bands -----------------------------------------------------------------

# Fraction of the figure's own bounding-box height (top=0, bottom=1) where
# each band ends. Measured against the courier's south.png: hair top y=10,
# glasses y=18-19, shoulders widen at y=24, torso holds to y=39, legs to
# y=51, feet y=52-55, over a bbox of y=10..55 (height 46).
HEAD_END = 0.30
TORSO_END = 0.66
LEG_END = 0.90
# anything past LEG_END is the foot band


def figure_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    """Tight (minx, maxx, miny, maxy) box of the non-transparent pixels."""
    bbox = img.getbbox()
    if bbox is None:
        raise ValueError("image is fully transparent")
    left, top, right, bottom = bbox
    return left, right - 1, top, bottom - 1


def band_of(y: int, miny: int, maxy: int) -> str:
    height = max(1, maxy - miny + 1)
    frac = (y - miny) / height
    if frac < HEAD_END:
        return "head"
    if frac < TORSO_END:
        return "torso"
    if frac < LEG_END:
        return "leg"
    return "foot"


# ---- colour families ---------------------------------------------------

def color_family(rgb: RGBA) -> str:
    r, g, b = rgb[0], rgb[1], rgb[2]
    mx = max(r, g, b)
    mn = min(r, g, b)
    diff = mx - mn

    if mx <= 36:
        return "ink"
    if r > b + 20 and r >= g - 5 and r > 90:
        return "skin"
    if b > r + 25 and b > 120:
        return "cyan"
    if b > r + 40 and b > g + 30 and b > 80:
        return "cyan"  # darker lens shadow tones (needs a strong blue lead,
        # not just a bluish-grey tint - the suit's own dark fill is also
        # slightly blue-shifted and must not be caught here)
    if mx > 195 and diff < 35:
        return "light"
    if mx <= 78 and diff < 30:
        return "dark_fill"
    if diff < 22:
        return "grey"
    return "other"


# ---- (band, family) -> material ----------------------------------------

MATERIAL_TABLE: dict[str, dict[str, str]] = {
    "head": {
        "ink": "ink",
        "skin": "skin",
        "cyan": "glasses_lens",
        "grey": "glasses_frame",
        "light": "glasses_frame",
        "dark_fill": "hair",
        "other": "skin",
    },
    "torso": {
        "ink": "ink",
        "skin": "skin",
        "cyan": "other",
        "grey": "jacket",
        "light": "shirt",
        "dark_fill": "jacket",
        "other": "jacket",
    },
    "leg": {
        "ink": "ink",
        "skin": "skin",
        "cyan": "other",
        "grey": "pants",
        "light": "pants",
        "dark_fill": "pants",
        "other": "pants",
    },
    "foot": {
        "ink": "ink",
        "skin": "skin",
        "cyan": "other",
        "grey": "shoes",
        "light": "shoes",
        "dark_fill": "shoes",
        "other": "shoes",
    },
}

# Debug colours for the false-colour map, one per material.
FALSE_COLORS: dict[str, RGBA] = {
    "ink": (0, 0, 0, 255),
    "skin": (255, 205, 148, 255),
    "glasses_lens": (0, 220, 255, 255),
    "glasses_frame": (120, 90, 255, 255),
    "hair": (255, 0, 120, 255),
    "jacket": (40, 120, 40, 255),
    "shirt": (255, 255, 255, 255),
    "pants": (255, 165, 0, 255),
    "shoes": (255, 255, 0, 255),
    "other": (255, 0, 0, 255),
}


def classify_image(img: Image.Image) -> list[list[str | None]]:
    """Per-pixel material labels, same shape as the image (None = transparent)."""
    w, h = img.size
    px = img.load()
    minx, maxx, miny, maxy = figure_bbox(img)
    labels: list[list[str | None]] = [[None] * w for _ in range(h)]
    for y in range(h):
        band = band_of(y, miny, maxy)
        row = labels[y]
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            family = color_family((r, g, b, a))
            row[x] = MATERIAL_TABLE[band][family]
    return labels


def false_color_image(img: Image.Image) -> Image.Image:
    labels = classify_image(img)
    w, h = img.size
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y in range(h):
        for x in range(w):
            label = labels[y][x]
            if label is not None:
                out.putpixel((x, y), FALSE_COLORS[label])
    return out
