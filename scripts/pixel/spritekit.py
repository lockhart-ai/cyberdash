"""Small toolkit for hand-authored pixel-art sprites.

A sprite is authored as one or more "layers": each layer is a list of equal-
length text rows (one character per pixel) plus a palette mapping each
character to an RGBA colour. '.' is always transparent. Layers are
composited in order (later layers draw on top, but only where they have a
non-transparent pixel - they never erase pixels drawn by earlier layers).

This mirrors how the courier reference sprites read: a flat-colour fill per
material (2-3 tones: a base/lit tone and one or two shaded tones), with a
single dark "ink" colour used for the silhouette outline rather than a
darker shade of each material's own hue.

Usage sketch:

    body = grid_to_image(BODY_ROWS, PALETTE)
    clothes = grid_to_image(CLOTHES_ROWS, PALETTE)
    canvas = new_canvas(64, 64)
    composite(canvas, body, 20, 5)
    composite(canvas, clothes, 20, 5)
    canvas = outline_pass(canvas)
    save_png(canvas, "out.png")
"""

from __future__ import annotations

from PIL import Image, ImageOps

RGBA = tuple[int, int, int, int]
Palette = dict[str, RGBA]

TRANSPARENT: RGBA = (0, 0, 0, 0)


def new_canvas(width: int, height: int) -> Image.Image:
    """A blank, fully transparent RGBA canvas."""
    return Image.new("RGBA", (width, height), TRANSPARENT)


def grid_to_image(rows: list[str], palette: Palette, transparent_char: str = ".") -> Image.Image:
    """Render a text grid (one character per pixel) into a tightly-sized RGBA image.

    Every row must be the same length. Any character not in the palette is
    treated as transparent (besides ``transparent_char`` itself), so typos
    fail loudly as a visible hole rather than a crash.
    """
    if not rows:
        raise ValueError("grid has no rows")
    width = len(rows[0])
    for i, row in enumerate(rows):
        if len(row) != width:
            raise ValueError(f"row {i} has length {len(row)}, expected {width}")

    img = Image.new("RGBA", (width, len(rows)), TRANSPARENT)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == transparent_char:
                continue
            colour = palette.get(ch)
            if colour is not None:
                img.putpixel((x, y), colour)
    return img


def composite(canvas: Image.Image, layer: Image.Image, x: int, y: int) -> Image.Image:
    """Paste ``layer`` onto ``canvas`` at (x, y), keeping canvas pixels where layer is transparent."""
    canvas.alpha_composite(layer, (x, y))
    return canvas


def outline_pass(img: Image.Image, ink: RGBA = (0, 0, 0, 255)) -> Image.Image:
    """Stamp a 1px silhouette outline in ``ink``, following the courier's rule.

    The courier's outline is a fixed dark "ink" colour (near-black), not a
    darkened shade of whatever it borders - the same ink sits next to skin,
    suit fabric and glasses alike. This pass finds every opaque pixel that
    touches a transparent neighbour (4-connected) and recolours it to ``ink``,
    in place of whatever fill colour was there. The silhouette's size is
    unchanged - the outline replaces the outermost ring of fill pixels
    rather than growing the sprite by a pixel.

    Any pixel already hand-painted in ``ink`` as an interior line (a zipper,
    a seam) is left as-is; this pass only touches the outer boundary.
    """
    w, h = img.size
    src = img.load()
    out = img.copy()
    dst = out.load()

    def opaque(x: int, y: int) -> bool:
        return 0 <= x < w and 0 <= y < h and src[x, y][3] > 0

    for y in range(h):
        for x in range(w):
            if not opaque(x, y):
                continue
            touches_edge = (
                not opaque(x - 1, y)
                or not opaque(x + 1, y)
                or not opaque(x, y - 1)
                or not opaque(x, y + 1)
            )
            if touches_edge:
                dst[x, y] = ink
    return out


def mirror_horizontal(img: Image.Image) -> Image.Image:
    """Flip a sprite left-right (e.g. to derive a south-west frame from south-east)."""
    return ImageOps.mirror(img)


def save_png(img: Image.Image, path: str) -> None:
    img.save(path)


def make_review_sheet(
    frames: list[Image.Image],
    scale: int = 6,
    bg: RGBA = (12, 12, 16, 255),
    gap: int = 24,
    margin: int = 24,
) -> Image.Image:
    """Lay frames out left-to-right, enlarged with nearest-neighbour, on a dark background."""
    enlarged = [
        f.resize((f.width * scale, f.height * scale), Image.NEAREST) for f in frames
    ]
    total_w = margin * 2 + sum(f.width for f in enlarged) + gap * (len(enlarged) - 1)
    total_h = margin * 2 + max(f.height for f in enlarged)
    sheet = Image.new("RGBA", (total_w, total_h), bg)
    x = margin
    for f in enlarged:
        sheet.alpha_composite(f, (x, margin))
        x += f.width + gap
    return sheet
