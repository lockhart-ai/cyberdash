"""Round-1 test models for the voxel renderer.

Assumptions:
- Coordinates are in voxel grid units (renderer.py scales by UNIT_PX). Each
  model's own footprint is whatever size reads well; models are not scaled
  to match each other's real-world size (that's a layout-time job, not a
  render-time one).
- "Decal" boxes (same cells as the box underneath, appended later in the
  list) are used to recolor a patch of an existing face — e.g. a window or
  coin slot — without creating new geometry/silhouette. This relies on
  voxelize() in renderer.py overwriting a cell's color when two boxes claim
  the same cell, with the later box in the list winning.
"""

from box import Box, Model

# ---------------------------------------------------------------------------
# Calibration model: rough copy of asset_packs' City-103 mailbox/post prop,
# used only to pick UNIT_PX by comparing against the original (never copied
# or modified — this is an independent model built to the same rough
# proportions). See the round-1 report for what matched and what didn't.
# ---------------------------------------------------------------------------


def calibration_mailbox() -> Model:
    body_color = (74, 88, 102)
    post_color = (54, 64, 76)
    base_color = (58, 68, 80)
    slot_color = (18, 20, 24)

    return [
        Box((0, 0, 0), (3, 3, 1), base_color, part="base"),
        # Post is tall and slender relative to the head — the reference's
        # silhouette is dominated by the post, not the head box.
        Box((1, 1, 1), (2, 2, 4), post_color, part="post"),
        Box((0, 0, 5), (4, 4, 4), body_color, part="head"),
        # Decal: a recessed slot on the head's left (y+) face.
        Box((1, 3, 6), (2, 1, 2), slot_color, part="slot_decal"),
    ]


# ---------------------------------------------------------------------------
# Newspaper vending box: cyberpunk street prop.
# ---------------------------------------------------------------------------


def newspaper_box() -> Model:
    body_color = (46, 56, 62)
    leg_color = (28, 33, 38)
    lid_color = (58, 220, 206)  # neon cyan lit lid
    window_color = (120, 200, 210)
    slot_color = (15, 15, 20)
    coin_color = (235, 210, 90)

    return [
        # Four short legs.
        Box((0, 0, 0), (1, 1, 2), leg_color, part="leg"),
        Box((3, 0, 0), (1, 1, 2), leg_color, part="leg"),
        Box((0, 2, 0), (1, 1, 2), leg_color, part="leg"),
        Box((3, 2, 0), (1, 1, 2), leg_color, part="leg"),
        # Main body.
        Box((0, 0, 2), (4, 3, 5), body_color, part="body"),
        # Decal: lit lid on the top face.
        Box((0, 0, 6), (4, 3, 1), lid_color, part="lid_decal"),
        # Decal: glass window on the right (x+) face, showing papers.
        Box((3, 0, 3), (1, 2, 2), window_color, part="window_decal"),
        # Decal: coin slot on the left (y+) face.
        Box((1, 2, 2), (2, 1, 1), slot_color, part="slot_decal"),
        # Small coin-slot trim accent just above the slot.
        Box((1, 2, 3), (2, 1, 1), coin_color, part="trim_decal"),
    ]


# ---------------------------------------------------------------------------
# Pedestrian: blocky cyberpunk figure in the style of Iso_Character_001.
# ---------------------------------------------------------------------------


def pedestrian() -> Model:
    jacket_color = (92, 32, 42)
    jacket_shadow_color = (72, 26, 34)
    pants_color = (32, 32, 40)
    boot_color = (18, 18, 22)
    skin_color = (214, 142, 142)
    implant_color = (96, 96, 108)
    accent_color = (64, 206, 224)

    # Footprint is 5 wide (x0-5) x 2 deep (y0-2): legs/torso/head sit at the
    # back (y=1) on a center column with a gap between the legs; arms sit at
    # the front (y=0), stepped out from the torso so they read as separate
    # limbs rather than blending into its silhouette.
    return [
        # Legs, with an empty gap column (x=2) between them so they read as
        # two separate limbs instead of one solid block.
        Box((1, 1, 0), (1, 1, 3), pants_color, part="leg"),
        Box((3, 1, 0), (1, 1, 3), pants_color, part="leg"),
        # Decal: boots.
        Box((1, 1, 0), (1, 1, 1), boot_color, part="boot_decal"),
        Box((3, 1, 0), (1, 1, 1), boot_color, part="boot_decal"),
        # Torso, bridging the leg gap.
        Box((1, 1, 3), (3, 1, 3), jacket_color, part="torso"),
        # Decal: chest accent light.
        Box((2, 1, 4), (1, 1, 1), accent_color, part="accent_decal"),
        # Arms: each spans both depth rows (y0-2) so it stays face-adjacent
        # to the torso at y=1 (no diagonal-only contact, which would leave a
        # gap in iso projection) while also stepping forward to y=0, so its
        # own faces are visible instead of being flush with the torso.
        Box((0, 0, 3), (1, 2, 3), jacket_shadow_color, part="arm"),
        Box((4, 0, 3), (1, 2, 3), jacket_shadow_color, part="arm"),
        # Head, offset toward one side (not centered on the torso).
        Box((1, 1, 6), (2, 1, 2), skin_color, part="head"),
        # Second, offset head box (like the reference's two offset head
        # boxes) — a cybernetic implant unit the same height as the head,
        # flush against it so there's no gap at their shared boundary.
        Box((3, 1, 6), (1, 1, 2), implant_color, part="implant"),
    ]


ALL_MODELS = {
    "calibration_mailbox": calibration_mailbox(),
    "newspaper_box": newspaper_box(),
    "pedestrian": pedestrian(),
}
