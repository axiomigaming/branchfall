"""Look-dev: the v2 set pieces with their procedural materials (no bake).

    python3 blender/look_setpieces.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import reset, preview, CACHE
import materials as M
import setpieces as S

reset()
st, fl, gl = M.stone("statue", moss=0.5), M.flora(), M.stone("glyph", moss=0.35, glyphs=True)


def put(ob, mat, loc, rz=0.0):
    ob.location = loc
    ob.rotation_euler.z = rz
    ob.data.materials.append(mat)
    return ob


put(S.colossal_head("head", 700), st, (0, 6, 0))
put(S.guardian("guard", 710), st, (-4.5, 4, 0), 0.35)
put(S.guardian("guardb", 711, broken=True), st, (4.5, 4, 0), -0.35)
put(S.fallen_column("col", 720), st, (-3, 0, 0), 1.2)
put(S.relief_wall("relief", 740), gl, (7, 8, 0), 0.0)
put(S.lily_pads("lily", 801, n=20, spread=2.4, flowers=3), fl, (2.5, 0.5, 0))
put(S.moss_clump("moss", 811, radius=0.9, n=7), fl, (0.8, 2.5, 0))
preview(f"{CACHE}/look_setpieces.png", (0.3, -6.5, 2.2), (0, 4, 1.8), lens=26, sun=(20, 0, 150), samples=12)
