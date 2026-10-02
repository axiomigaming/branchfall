"""Look-dev: the round-8 Mesoamerican pieces with their procedural materials (no bake).

    python3 blender/look_meso.py [gate|pyramid|mask]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from common import reset, preview, CACHE
import materials as M
import kit_geo as K
import meso as X

which = sys.argv[-1] if len(sys.argv) > 1 and sys.argv[-1] in ("gate", "pyramid", "mask") else "gate"
reset()
st, gd, sa, fl = M.stone("statue", moss=0.5, glyphs=False), M.gold(), M.stone("stoneB", moss=0.45, glyphs=False), M.floor()


def put(ob, mat, loc, rz=0.0):
    ob.location = loc
    ob.rotation_euler.z = rz
    ob.data.materials.append(mat)
    return ob


if which == "gate":
    s, g = X.face_gate("face_gate_0", 950)
    put(s, st, (0, 20, 0)); put(g, gd, (0, 20, 0))
    put(K.arch("arch_0", 210), sa, (0, 8, 0))
    for i in range(6):
        put(K.floor(f"floor_{i}", 300 + i % 2), fl, (0, i * 4, 0))
    preview(f"{CACHE}/look_meso_gate.png", (1.2, -4, 2.2), (0, 20, 7), lens=22, sun=(32, 0, 160), samples=12)
elif which == "pyramid":
    put(X.step_pyramid("temple_0", 930), st, (-14, 40, 0))
    put(X.step_pyramid("temple_1", 931, base=12.0, tiers=4, ruin=0.6), st, (14, 34, 0), 0.4)
    s, g = X.idol("idol_0", 940)
    put(s, st, (0, 24, 0)); put(g, gd, (0, 24, 0))
    preview(f"{CACHE}/look_meso_pyramid.png", (0, -6, 4), (0, 30, 6), lens=24, sun=(32, 0, 160), samples=12)
else:
    s, g = X.face_gate("face_gate_0", 950)
    put(s, st, (0, 0, 0)); put(g, gd, (0, 0, 0))
    preview(f"{CACHE}/look_meso_mask.png", (2.5, -14, 11.5), (0, 0, 11.5), lens=40, sun=(30, 0, 160), samples=12)
for o in bpy.data.objects:
    if o.type == "MESH":
        print("tris", o.name, sum(len(p.vertices) - 2 for p in o.data.polygons))
