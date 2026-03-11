#!/usr/bin/env python3
"""Split isometric sprite strips into individual tile PNGs.

Finds connected blobs of non-transparent pixels in each strip,
crops each blob to its bounding box, and saves as separate files.
No resizing, no color changes — only cutting.
"""

from pathlib import Path
from PIL import Image
import numpy as np


def find_blobs(alpha: np.ndarray, min_gap: int = 4) -> list[tuple[int, int, int, int]]:
    """Find bounding boxes of separate blobs in an alpha channel."""
    col_has_content = np.any(alpha > 0, axis=0)

    spans = []
    in_span = False
    x0 = 0
    gap = 0

    for x in range(len(col_has_content)):
        if col_has_content[x]:
            if not in_span:
                x0 = x
                in_span = True
            gap = 0
        else:
            if in_span:
                gap += 1
                if gap > min_gap:
                    spans.append((x0, x - gap))
                    in_span = False
                    gap = 0

    if in_span:
        spans.append((x0, len(col_has_content) - 1))

    bboxes = []
    for x0, x1 in spans:
        col_slice = alpha[:, x0:x1+1]
        rows_with_content = np.any(col_slice > 0, axis=1)
        y_indices = np.where(rows_with_content)[0]
        if len(y_indices) == 0:
            continue
        y0 = int(y_indices[0])
        y1 = int(y_indices[-1])
        bboxes.append((x0, y0, x1 + 1, y1 + 1))

    return bboxes


def split_strip(input_path: Path, output_dir: Path, prefix: str) -> list[Path]:
    """Split a sprite strip into individual tiles."""
    img = Image.open(input_path).convert("RGBA")
    alpha = np.array(img)[:, :, 3]

    bboxes = find_blobs(alpha)
    bboxes.sort(key=lambda b: b[0])

    output_dir.mkdir(parents=True, exist_ok=True)
    paths = []

    for i, (x0, y0, x1, y1) in enumerate(bboxes):
        tile = img.crop((x0, y0, x1, y1))
        out_path = output_dir / f"{prefix}_{i}.png"
        tile.save(out_path)
        print(f"  {out_path.name}: {x1-x0}x{y1-y0}")
        paths.append(out_path)

    return paths


def main():
    base = Path("/tmp/cyberdash_asset_packs")
    out_base = Path("public/assets/tiles")

    packs = [
        # (source_dir, output_subdir, [(prefix, filename), ...])
        (
            base / "Isometric Cyberpunk Streets/Isometric Cyberpunk Streets/Architecture",
            out_base / "cyberpunk_streets",
            [
                ("ground_0", "Cyberpunk Streets-8-GroundTile-0.png"),
                ("ground_1", "Cyberpunk Streets-7-GroundTile-1.png"),
                ("ground_2", "Cyberpunk Streets-6-GroundTile-2.png"),
                ("ground_3", "Cyberpunk Streets-5-GroundTile-3.png"),
                ("ground_4", "Cyberpunk Streets-4-GroundTile-4.png"),
                ("pavement_0", "Cyberpunk Streets-145-Pavement-0.png"),
                ("pavement_1_0", "Cyberpunk Streets-144-Pavement-1-0.png"),
                ("pavement_1_1", "Cyberpunk Streets-143-Pavement-1-1.png"),
                ("pavement_1_2", "Cyberpunk Streets-142-Pavement-1-2.png"),
                ("pavement_2", "Cyberpunk Streets-141-Pavement-2.png"),
                ("pavement_3", "Cyberpunk Streets-140-Pavement-3.png"),
            ],
        ),
        (
            base / "Isometric Cyberpunk City/StreetModules",
            out_base / "cyberpunk_city",
            [(f.stem.lower().replace(" ", "_"), f.name)
             for f in sorted((base / "Isometric Cyberpunk City/StreetModules").glob("*.png"))],
        ),
        (
            base / "Isometric City/Isometric City/GroundModules",
            out_base / "city",
            [(f.stem.split("-", 2)[-1].lower().replace(" ", "_") if "-" in f.stem else f.stem.lower(),
              f.name)
             for f in sorted((base / "Isometric City/Isometric City/GroundModules").glob("*.png"))
             if any(kw in f.stem.lower() for kw in ("road", "sidewalk"))],
        ),
        (
            base / "Isometric Roads and Cars/Isometric Roads and Cars/RoadTiles",
            out_base / "roads_and_cars",
            [(f"rt{parts[1]}_{parts[2].lower().replace(' ', '_')}" if len(parts := f.stem.split("-", 2)) == 3 else f.stem.lower(),
              f.name)
             for f in sorted(
                 (base / "Isometric Roads and Cars/Isometric Roads and Cars/RoadTiles").glob("*.png"),
                 key=lambda p: int(p.stem.split("-")[1]) if len(p.stem.split("-")) > 1 and p.stem.split("-")[1].isdigit() else 0,
             )],
        ),
    ]

    import json

    # manifest: { pack_name: { key: relative_path } }
    manifest: dict[str, dict[str, str]] = {}

    grand_total = 0
    for src_dir, out_dir, strips in packs:
        pack_name = out_dir.name
        print(f"\n{'='*60}")
        print(f"PACK: {src_dir.parent.name}/{src_dir.name}")
        print(f"  -> {out_dir}")
        pack_total = 0
        pack_entries: dict[str, str] = {}

        for prefix, filename in strips:
            src = src_dir / filename
            if not src.exists():
                print(f"  SKIP {filename} (not found)")
                continue
            print(f"\n  {filename} -> {prefix}_*:")
            paths = split_strip(src, out_dir, prefix)
            for p in paths:
                # Key = pack_name/filename_without_ext, path = relative to public/
                key = f"{pack_name}/{p.stem}"
                rel_path = str(p).replace("public/", "")
                pack_entries[key] = rel_path
            pack_total += len(paths)

        manifest[pack_name] = pack_entries
        print(f"\n  Pack total: {pack_total} tiles")
        grand_total += pack_total

    # Write manifest
    manifest_path = Path("public/assets/tiles/tile_manifest.json")
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n{'='*60}")
    print(f"Grand total: {grand_total} tiles extracted")
    print(f"Manifest written to {manifest_path}")


if __name__ == "__main__":
    main()
