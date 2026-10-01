"""Look-dev: the round-3 stage pieces with their procedural materials (no bake).

    python3 blender/look_stage.py [cliff|temple|med]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from common import reset, preview, CACHE, hexcol
import materials as M
import stage as G

which = sys.argv[-1] if len(sys.argv) > 1 else "cliff"
reset()
cl, tm, gd, bk = M.cliff(), M.stone("temple", moss=0.5, glyphs=True), M.gold(), M.bark()
fl = M.floor()
leaf = bpy.data.materials.new("leafflat")
leaf.use_nodes = True
leaf.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = hexcol("#3f6a22")


def put(ob, mat, loc, rz=0.0):
    ob.location = loc
    ob.rotation_euler.z = rz
    ob.data.materials.append(mat)
    return ob


if which == "cliff":
    r, v, t = G.cliff_set("cliff_wall_0", 900)
    put(r, cl, (7, 20, -2.2)); put(v, leaf, (7, 20, -2.2)); put(t, bk, (7, 20, -2.2))
    r, v, t = G.cliff_set("cliff_wall_1", 901)
    put(r, cl, (-7, 20, -2.2), 3.14159); put(v, leaf, (-7, 20, -2.2), 3.14159); put(t, bk, (-7, 20, -2.2), 3.14159)
    s, g = G.face_gate("face_gate_0", 950)
    put(s, tm, (0, 36, 0)); put(g, gd, (0, 36, 0))
    put(G.floor_medallion("med", 960), fl, (0, 4, 0))
    preview(f"{CACHE}/look_stage_cliff.png", (0.5, -4, 2.2), (0, 30, 6), lens=22, sun=(32, 0, 150), samples=12)
elif which == "temple":
    put(G.temple_prang("temple_0", 930), tm, (-10, 30, 0))
    put(G.temple_pagoda("temple_1", 931), tm, (10, 30, 0))
    s, g = G.idol("idol_0", 940)
    put(s, tm, (0, 22, 0)); put(g, gd, (0, 22, 0))
    t, c = G.tree_big("tree_big_0", 920)
    put(t, bk, (-4, 12, 0)); put(c, leaf, (-4, 12, 0))
    put(G.shrub_mass("shrub_mass_0", 925), leaf, (4, 10, 0))
    preview(f"{CACHE}/look_stage_temple.png", (0, -8, 4), (0, 22, 8), lens=24, sun=(32, 0, 150), samples=12)
elif which == "med":
    put(G.floor_medallion("med", 960), fl, (0, 0, 0))
    preview(f"{CACHE}/look_stage_med.png", (0, -3.0, 4.5), (0, 2, 0), lens=30, sun=(40, 0, 150), samples=12)
for o in bpy.data.objects:
    if o.type == "MESH":
        print("tris", o.name, sum(len(p.vertices) - 2 for p in o.data.polygons))
