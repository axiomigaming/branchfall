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

which = sys.argv[-1] if len(sys.argv) > 1 and sys.argv[-1] in ("gate", "pyramid", "mask", "wall") else "gate"
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
elif which == "wall":
    gl = M.stone("glyph", moss=0.35, glyphs=True)
    for i in range(4):
        put(X.carved_wall(f"wc{i}", 1300 + i % 2, ruin=0.25 if i % 2 == 0 else 0.5), gl, (2.6, 2 + i * 4, 0))
        put(K.wall(f"wl{i}", 100 + i, height=1.4, ruin=0.4), sa, (-2.6, 2 + i * 4, 0))
        put(K.floor(f"fl{i}", 300 + i % 2), fl, (0, 2 + i * 4, 0))
    put(X.serpent_post("serpent_0", 1310), gl, (2.2, 1.0, 0))
    put(K.pillar("pillar_0", 200, height=5.0), sa, (-3.4, 14, 0))
    put(X.pillar_cap("pillar_cap_0", 1320), gl, (-3.4, 14, 5.0))
    put(K.tunnel_mouth("tm", 1000), sa, (0, 20, 0))
    put(K.vault("v0", 1010), sa, (0, 21.6, 0))
    preview(f"{CACHE}/look_meso_wall.png", (0.6, -3.5, 1.9), (0, 16, 2.5), lens=22, sun=(30, 0, 200), samples=12)
else:
    s, g = X.face_gate("face_gate_0", 950)
    put(s, st, (0, 0, 0)); put(g, gd, (0, 0, 0))
    preview(f"{CACHE}/look_meso_mask.png", (2.5, -14, 11.5), (0, 0, 11.5), lens=40, sun=(30, 0, 160), samples=12)
for o in bpy.data.objects:
    if o.type == "MESH":
        print("tris", o.name, sum(len(p.vertices) - 2 for p in o.data.polygons))
