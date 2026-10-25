"""Round-2 test models for the voxel renderer.

Assumptions:
- Coordinates are in voxel grid units (renderer.py scales by UNIT_PX=4 and
  Z_RATIO=1.0 this round). Models are built from many small boxes (roughly
  15-30 units across) rather than a handful of big slabs, so trims, slots,
  frames and bevels are possible, matching the purchased packs' level of
  detail.
- "Decal" boxes (same cells as the box underneath, appended later in the
  list) recolor a patch of an existing face — a window, a slot, a sticker —
  without creating new geometry/silhouette. voxelize() in renderer.py
  overwrites a cell's color when two boxes claim the same cell, with the
  later box in the list winning.
- Base colors are mid-tone (not already-dark), per round-2 feedback: the
  renderer's own left-face shading does the darkening, so starting from a
  dark base color was crushing the left face to near-black.
"""

from box import Box, Model

# ---------------------------------------------------------------------------
# Calibration model: rough copy of asset_packs' City-103 mailbox/post prop —
# the yardstick for whether the renderer itself is right. Box sizes below
# are derived from exact-pixel measurements of the reference (see
# renderer.py's Z_RATIO comment and the round-2 report): head footprint from
# its measured full width (89px), head wall height from its measured wall
# height (68px), etc. The post-to-head "neck" is approximated with two
# stepped collars (a true sloped/chamfered neck isn't expressible with
# axis-aligned boxes).
# ---------------------------------------------------------------------------


def calibration_mailbox() -> Model:
    head_color = (100, 128, 134)
    collar_color = (90, 116, 122)
    post_color = (76, 100, 106)
    foot_color = (84, 108, 114)
    trim_color = (150, 165, 170)
    opening_color = (20, 22, 26)

    # Head is the widest element (footprint 11x11); every other part is
    # centered under it.
    def centered(size: int) -> int:
        return (11 - size) // 2

    foot_o = centered(6)
    post_o = centered(4)
    collar_lo_o = centered(6)
    collar_hi_o = centered(8)

    return [
        # Foot: z0-2.
        Box((foot_o, foot_o, 0), (6, 6, 2), foot_color, part="foot"),
        # Post: tall and slender, z2-8.
        Box((post_o, post_o, 2), (4, 4, 6), post_color, part="post"),
        # Neck, stepped wider in two stages, z8-14.
        Box((collar_lo_o, collar_lo_o, 8), (6, 6, 3), collar_color, part="collar_low"),
        Box((collar_hi_o, collar_hi_o, 11), (8, 8, 3), collar_color, part="collar_high"),
        # Head: z14-31.
        Box((0, 0, 14), (11, 11, 17), head_color, part="head"),
        # Decal: a framed front opening on the head's left (y+) face —
        # outer trim, then a darker recessed opening inset inside it.
        Box((3, 10, 17), (5, 1, 10), trim_color, part="opening_trim_decal"),
        Box((4, 10, 18), (3, 1, 8), opening_color, part="opening_decal"),
    ]


# ---------------------------------------------------------------------------
# Newspaper vending box: cyberpunk street prop with legs, a windowed front
# showing a paper stack, a coin/card slot, a handle, a neon accent strip and
# a couple of stickers.
# ---------------------------------------------------------------------------


def newspaper_box() -> Model:
    body_color = (70, 82, 90)
    leg_color = (50, 58, 64)
    lid_color = (70, 225, 210)
    trim_color = (170, 178, 182)
    glass_light = (225, 215, 195)
    glass_dark = (200, 188, 165)
    slot_color = (22, 24, 28)
    handle_color = (40, 44, 48)
    neon_color = (60, 230, 255)
    sticker_red = (230, 70, 60)
    sticker_yellow = (235, 200, 70)

    return [
        # Four short legs.
        Box((0, 0, 0), (1, 1, 2), leg_color, part="leg"),
        Box((7, 0, 0), (1, 1, 2), leg_color, part="leg"),
        Box((0, 5, 0), (1, 1, 2), leg_color, part="leg"),
        Box((7, 5, 0), (1, 1, 2), leg_color, part="leg"),
        # Main body.
        Box((0, 0, 2), (8, 6, 10), body_color, part="body"),
        # Decal: lit lid on the top face.
        Box((0, 0, 12), (8, 6, 1), lid_color, part="lid_decal"),
        # Decal: window frame + glass on the right (x+) face.
        Box((7, 1, 4), (1, 4, 6), trim_color, part="window_trim_decal"),
        Box((7, 2, 5), (1, 2, 4), glass_dark, part="window_glass_decal"),
        # Decal: stacked papers visible through the glass (alternating
        # light/dark bands).
        Box((7, 2, 5), (1, 2, 1), glass_light, part="paper_decal"),
        Box((7, 2, 7), (1, 2, 1), glass_light, part="paper_decal"),
        # Decal: coin/card slot with trim ring on the left (y+) face.
        Box((2, 5, 4), (4, 1, 3), trim_color, part="slot_trim_decal"),
        Box((3, 5, 5), (2, 1, 1), slot_color, part="slot_decal"),
        # Handle: a small box actually protruding from the front, next to
        # the slot.
        Box((3, 6, 3), (2, 1, 1), handle_color, part="handle"),
        # Decal: a thin neon accent strip down the front-left corner.
        Box((0, 0, 2), (1, 1, 10), neon_color, part="neon_decal"),
        # Decal: a couple of stickers on the right face, away from the
        # window.
        Box((7, 0, 3), (1, 1, 1), sticker_red, part="sticker_decal"),
        Box((7, 0, 9), (1, 1, 1), sticker_yellow, part="sticker_decal"),
    ]


# ---------------------------------------------------------------------------
# Pedestrian: standing upright, arms at the sides, in the style of
# Iso_Character_001. Proportions: head ~1/4 of total height (6/24), legs
# ~40% (10/24).
# ---------------------------------------------------------------------------


def pedestrian() -> Model:
    jacket_color = (140, 60, 70)
    # Distinctly darker than the jacket (not just a muted shade of the same
    # hue) so the arms read as separate limbs rather than blending in —
    # round-1 and an early round-2 pass both had arms too close in color to
    # the torso to see clearly, even though the geometry itself was right.
    sleeve_color = (52, 46, 50)
    pants_color = (70, 70, 82)
    boot_color = (45, 42, 46)
    skin_color = (225, 160, 160)
    implant_color = (130, 132, 142)
    accent_color = (70, 215, 230)

    return [
        # Legs, with a 1-unit gap between them (x=3) so they read as two
        # separate limbs. z0-10 (10 units, ~40% of the 24-unit total).
        Box((1, 0, 0), (2, 2, 10), pants_color, part="leg"),
        Box((4, 0, 0), (2, 2, 10), pants_color, part="leg"),
        # Decal: boots.
        Box((1, 0, 0), (2, 2, 2), boot_color, part="boot_decal"),
        Box((4, 0, 0), (2, 2, 2), boot_color, part="boot_decal"),
        # Torso, bridging the leg gap. z10-18 (8 units).
        Box((1, 0, 10), (5, 2, 8), jacket_color, part="torso"),
        # Decal: chest accent light, on the outer (left-face) layer.
        Box((3, 1, 13), (1, 1, 1), accent_color, part="accent_decal"),
        # Arms, down at the sides, flush against the torso (no forward
        # step this round — a natural hanging pose) and reaching slightly
        # past the hip. z9-18.
        Box((0, 0, 9), (1, 2, 9), sleeve_color, part="arm"),
        Box((6, 0, 9), (1, 2, 9), sleeve_color, part="arm"),
        # Head: z18-24 (6 units, exactly 1/4 of 24), offset toward one
        # side of the torso's centerline (not perfectly centered).
        Box((2, 0, 18), (3, 2, 6), skin_color, part="head"),
        # Second, offset head box (like the reference's two offset head
        # boxes) — a cybernetic implant unit flush against the head and
        # flush with its bottom (z18), so there's no floating gap below it.
        Box((5, 0, 18), (1, 2, 3), implant_color, part="implant"),
    ]


ALL_MODELS = {
    "calibration_mailbox": calibration_mailbox(),
    "newspaper_box": newspaper_box(),
    "pedestrian": pedestrian(),
}
