"""Voxel box model API.

Assumptions (stated up front per project convention):
- Grid coordinates are non-negative integers: x = east, y = south, z = up. One
  integer step is one "voxel unit". Units are arbitrary scale until the
  renderer multiplies by UNIT_PX (see renderer.py).
- A Box occupies the half-open cell range [origin, origin + size) along each
  axis, i.e. size is in whole voxel cells, but a box can span many cells
  ("variable-size boxes", not a dense 1x1x1 voxel sculpt).
- A Model is just a list of Box, painted in order: later boxes overwrite
  earlier ones in any grid cell they both occupy (lets an accent box sit
  "on top of" a body box at the same cells without worrying about order
  elsewhere).
- color is 0-255 RGB. part is a free-form label for the author's own
  bookkeeping; the renderer does not read it (shading/highlights key off
  box identity, not part name).
"""

from dataclasses import dataclass
from typing import List, Tuple

Vec3 = Tuple[int, int, int]
Color = Tuple[int, int, int]


@dataclass
class Box:
    origin: Vec3
    size: Vec3
    color: Color
    part: str = ""

    def extent(self) -> Vec3:
        ox, oy, oz = self.origin
        sx, sy, sz = self.size
        return (ox + sx, oy + sy, oz + sz)


Model = List[Box]


def model_extent(model: Model) -> Vec3:
    """Smallest grid size (X, Y, Z) that contains every box in the model."""
    ex, ey, ez = 0, 0, 0
    for b in model:
        bx, by, bz = b.extent()
        ex, ey, ez = max(ex, bx), max(ey, by), max(ez, bz)
    return (ex, ey, ez)
