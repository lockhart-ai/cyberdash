"""
Re-center each frame in a horizontal sprite sheet so the sprite's
bounding box is horizontally centered within each cell. This eliminates
the per-frame horizontal jitter caused by inconsistent sprite placement.
"""

from pathlib import Path
from PIL import Image

def get_content_x_bounds(frame: Image.Image):
    """Get leftmost and rightmost non-transparent pixel columns."""
    w, h = frame.size
    pixels = frame.load()
    left = None
    right = None
    for x in range(w):
        for y in range(h):
            if pixels[x, y][3] > 0:
                if left is None:
                    left = x
                right = x
                break
    return left, right

def center_frames(path: Path):
    img = Image.open(path).convert("RGBA")
    total_w, h = img.size
    frame_w = h
    n_frames = total_w // frame_w

    if n_frames * frame_w != total_w:
        print(f"  SKIP {path.name}: width {total_w} not divisible by height {h}")
        return False

    new_img = Image.new("RGBA", (total_w, h), (0, 0, 0, 0))
    changed = False

    for i in range(n_frames):
        x0 = i * frame_w
        frame = img.crop((x0, 0, x0 + frame_w, h))

        left, right = get_content_x_bounds(frame)
        if left is None:
            continue

        content_w = right - left + 1
        current_center = (left + right) / 2
        target_center = frame_w / 2
        shift = round(target_center - current_center)

        if shift != 0:
            changed = True

        new_left = max(0, min(frame_w - content_w, left + shift))
        content = frame.crop((left, 0, right + 1, h))
        new_img.paste(content, (x0 + new_left, 0))

    if changed:
        new_img.save(path)
        print(f"  FIXED {path.name} ({n_frames} frames)")
    else:
        print(f"  OK    {path.name} (already centered)")

    return changed

def main():
    sprite_dir = Path(__file__).parent.parent / "public" / "assets" / "sprites" / "player"
    fixed = 0

    for pattern in ["run-*.png", "walk-*.png"]:
        for path in sorted(sprite_dir.glob(pattern)):
            if center_frames(path):
                fixed += 1

    print(f"\nFixed {fixed} sprite sheets")

if __name__ == "__main__":
    main()
