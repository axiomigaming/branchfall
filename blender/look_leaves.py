"""Look-dev: render only the leaf atlas to blender/cache/foliage_color.png.

    python3 blender/look_leaves.py [size]
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from common import reset
import foliage as F

size = int(sys.argv[-1]) if sys.argv[-1].isdigit() else 1024
reset()
t = time.time()
F.render_atlas(size)
print("atlas", size, f"{time.time() - t:.0f}s")
