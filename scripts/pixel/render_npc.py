"""Render the "Riot" NPC - a cyberpunk street punk - to PNGs, and build a review sheet.

Riot is a mohawked street punk: a cropped black leather jacket over a worn
tank top, dark indigo pants, combat boots, a hot-magenta mohawk, and one
glowing green cybernetic eye. It is meant to read as the same art style as
the courier (same 64x64 frame, same ~46px standing height, same silhouette
outline rule, same 2-3 tone shading) while looking like a clearly different
person: a civilian NPC rather than the armoured courier.

Each pose is authored as a single text grid (one character per pixel),
24 columns wide, placed at canvas offset (20, 5) inside the 64x64 frame -
columns 20-43, rows 5-55 - so the standing envelope (feet at y=55, head top
at y=10, mohawk tip at y=5) lines up with the courier's own y=10..55 figure
height and ground line.

Run:
    python3 scripts/pixel/render_npc.py
"""

from __future__ import annotations

from pathlib import Path

from spritekit import (
    composite,
    grid_to_image,
    make_review_sheet,
    new_canvas,
    outline_pass,
    save_png,
)
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
PLAYER_DIR = REPO_ROOT / "public" / "assets" / "player"
NPC_DIR = REPO_ROOT / "public" / "assets" / "sprites" / "npc"
REVIEW_DIR = Path("/Users/decker/Documents/cyberdash/pixel-output/round1")

FRAME = 64
GRID_X = 20  # canvas x where each 24-col grid row starts
GRID_Y = 5   # canvas y where each grid's first row starts

PALETTE = {
    # mohawk - hot magenta, lit (M) / shaded (m)
    "M": (255, 60, 180, 255),
    "m": (190, 30, 130, 255),
    # skin - reused from the courier's own palette, lit / mid / shadow
    "S": (248, 199, 174, 255),
    "s": (243, 184, 159, 255),
    "d": (239, 168, 139, 255),
    # eyes
    "e": (31, 29, 36, 255),    # plain eye, dark pupil (courier's shade tone)
    "G": (90, 255, 140, 255),  # glowing cybernetic eye
    # jacket - black leather, lit / shaded
    "J": (45, 45, 52, 255),
    "j": (32, 32, 38, 255),
    # tank top under the jacket
    "T": (132, 132, 140, 255),
    "t": (100, 100, 108, 255),
    # pants - dark indigo
    "P": (40, 48, 64, 255),
    "p": (28, 34, 48, 255),
    # studs / belt buckle / boot sole
    "u": (195, 195, 200, 255),
    # hand-placed interior seam (zipper, leg line) - same ink as the outline
    "i": (0, 0, 0, 255),
}

# South (front-facing) idle. 24 columns x 51 rows, canvas offset (20, 5).
# Row-by-row: a 3-row mohawk spike that tapers into the skull; the mohawk
# colour continues as a center stripe for the first 3 skull rows only (above
# the eye line), not down over the face; shaved sides in skin tone; a 2-row
# neck; an open jacket collar with a sliver of tank top at the throat; a
# 14-row-tall jacket torso (matched against a 14-row pants run below so the
# figure doesn't read as a thin pillar - see the courier-comparison note in
# the module docstring); a cropped-jacket hem, tank sliver, and belt with a
# buckle; pants with a center seam; boots with a sole highlight inset one row
# above the true bottom (the auto silhouette outline consumes the outermost
# ring, so a highlight placed on the literal last row would vanish).
SOUTH_ROWS = [
    "..........MMmm..........",
    ".........MMMmmm.........",
    ".........MMMmmm.........",
    ".......SSSMMmdddd.......",
    "......SSSSMMmsdddd......",
    ".....SSSSsMMmdddddd.....",
    ".....SSSSssssdddddd.....",
    ".....SSeSssssdddGGd.....",
    ".....SSSSssssdddddd.....",
    "......SSSSssssdddd......",
    "......SSSSssssdddd......",
    "........SSssdddd........",
    "........SSssdddd........",
    "......JJJJTTtjjjjj......",
    "....JJJJJJJijjjjjjjj....",
    "...JJJJJJJJijjjjjjjjj...",
    "...JJJJJJJJijjjjjjjjj...",
    "...JJJJJJJJijjjjjjjjj...",
    "...JJJJJJJJijjjjjjjjj...",
    "...JJJJJJJJijjjjjjjjj...",
    "...JJJJJJJJijjjjjjjjj...",
    "...JJJJJJJJijjjjjjjjj...",
    "...JJJJJJJJijjjjjjjjj...",
    "...JJJJJJJJijjjjjjjjj...",
    "...JJJJJJJJijjjjjjjjj...",
    "...JJJJJJJJijjjjjjjjj...",
    "...JJJJJJJJijjjjjjjjj...",
    "...JJJJJJJJijjjjjjjjj...",
    "...JJJJJJJJijjjjjjjjj...",
    "....JJJJJJJijjjjjjjj....",
    ".....TTTTTTTttttttt.....",
    ".....PPPPPPuupppppp.....",
    ".....PPPPPPippppppp.....",
    "......PPPPPipppppp......",
    "......PPPPPipppppp......",
    "......PPPPPipppppp......",
    "......PPPPPipppppp......",
    "......PPPPPipppppp......",
    "......PPPPPipppppp......",
    "......PPPPPipppppp......",
    "......PPPPPipppppp......",
    "......PPPPPipppppp......",
    "......PPPPPipppppp......",
    "......PPPPPipppppp......",
    "......PPPPPipppppp......",
    "......PPPPPipppppp......",
    ".....PPPPPPippppppp.....",
    "....JJJJJJJJjjjjjjjj....",
    "....JJJJJJJJjjjjjjjj....",
    "....Juuuuuuuuuuuuuuj....",
    "....JJJJJJJJjjjjjjjj....",
]

# South-east (3/4 turn) idle: the same per-part turn ratio the courier uses
# going from south to south-east (~18% narrower at the torso, less at the
# head/legs, more on the far/left side than the near/right side), the far
# eye dropped (turned away), the mohawk crest shifted toward the near side.
SOUTH_EAST_ROWS = [
    "...........MMm..........",
    "..........MMMmm.........",
    "..........MMMmm.........",
    "........SSMMmddd........",
    ".......SSSMMmdddd.......",
    ".......SSSsMMmdddd......",
    ".......SSSsssddddd......",
    ".......SSSsssddGGd......",
    ".......SSSsssddddd......",
    ".......SSSsssdddd.......",
    ".......SSSsssdddd.......",
    ".........SSssddd........",
    ".........SSssddd........",
    ".......JJJJTjjjjj.......",
    "......JJJJJJijjjjjj.....",
    ".....JJJJJJJijjjjjjj....",
    ".....JJJJJJJijjjjjjj....",
    ".....JJJJJJJijjjjjjj....",
    ".....JJJJJJJijjjjjjj....",
    ".....JJJJJJJijjjjjjj....",
    ".....JJJJJJJijjjjjjj....",
    ".....JJJJJJJijjjjjjj....",
    ".....JJJJJJJijjjjjjj....",
    ".....JJJJJJJijjjjjjj....",
    ".....JJJJJJJijjjjjjj....",
    ".....JJJJJJJijjjjjjj....",
    ".....JJJJJJJijjjjjjj....",
    ".....JJJJJJJijjjjjjj....",
    ".....JJJJJJJijjjjjjj....",
    "......JJJJJJijjjjjj.....",
    ".......TTTTTTttttt......",
    ".......PPPPPuppppp......",
    ".......PPPPPippppp......",
    ".......PPPPippppp.......",
    ".......PPPPippppp.......",
    ".......PPPPippppp.......",
    ".......PPPPippppp.......",
    ".......PPPPippppp.......",
    ".......PPPPippppp.......",
    ".......PPPPippppp.......",
    ".......PPPPippppp.......",
    ".......PPPPippppp.......",
    ".......PPPPippppp.......",
    ".......PPPPippppp.......",
    ".......PPPPippppp.......",
    ".......PPPPippppp.......",
    ".......PPPPPippppp......",
    "......JJJJJJJjjjjjj.....",
    "......JJJJJJJjjjjjj.....",
    "......Juuuuuuuuuuuj.....",
    "......JJJJJJJjjjjjj.....",
]


def render_pose(rows: list[str]) -> Image.Image:
    layer = grid_to_image(rows, PALETTE)
    canvas = new_canvas(FRAME, FRAME)
    composite(canvas, layer, GRID_X, GRID_Y)
    return outline_pass(canvas)


def main() -> None:
    NPC_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)

    south = render_pose(SOUTH_ROWS)
    south_east = render_pose(SOUTH_EAST_ROWS)

    south_path = NPC_DIR / "riot-south.png"
    south_east_path = NPC_DIR / "riot-south-east.png"
    save_png(south, str(south_path))
    save_png(south_east, str(south_east_path))
    print(f"wrote {south_path}")
    print(f"wrote {south_east_path}")

    courier_south = Image.open(PLAYER_DIR / "south.png").convert("RGBA")
    courier_south_east = Image.open(PLAYER_DIR / "south-east.png").convert("RGBA")

    sheet = make_review_sheet([courier_south, courier_south_east, south, south_east])
    sheet_path = REVIEW_DIR / "sheet.png"
    save_png(sheet, str(sheet_path))
    print(f"wrote {sheet_path}")

    # Also drop plain copies of the new frames next to the sheet for easy viewing.
    save_png(south, str(REVIEW_DIR / "riot-south.png"))
    save_png(south_east, str(REVIEW_DIR / "riot-south-east.png"))


if __name__ == "__main__":
    main()
