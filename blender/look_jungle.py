"""Look-dev: the round-5 jungle pieces with the leaf atlas from blender/cache (run look_leaves.py first).

    python3 blender/look_jungle.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector
from common import reset, preview, CACHE, hexcol, textured_material
import materials as M
import foliage as F
import jungle as J

reset()
img = bpy.data.images.load(os.path.join(CACHE, "foliage_color.png"))
leaf = textured_material("leaf_jungle", img, None, None, alpha=True)
bk = M.bark()
ground = bpy.data.materials.new("ground")
ground.use_nodes = True
ground.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = hexcol("#b07a52")
water = bpy.data.materials.new("water")
water.use_nodes = True
water.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = hexcol("#2f6f6a")


def put(ob, mat, loc, rz=0.0):
    ob.location = loc
    ob.rotation_euler.z = rz
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 20, 0))
p = bpy.context.object
p.scale = (4.4, 60, 1)
p.data.materials.append(ground)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 20, -2.2))
bpy.context.object.data.materials.append(water)

put(J.jungle_bank("jungle_bank_0", 1200), leaf, (3.6, 8, 0))
put(J.jungle_bank("jungle_bank_1", 1201, height=1.15), leaf, (-3.6, 22, 0), 3.14159)
put(J.jungle_bank("jungle_bank_2", 1202, height=1.3), leaf, (4.2, 26, 0))
limb, leaves = J.canopy("canopy_0", 1210)
put(limb, bk, (0, 14, 0)); put(leaves, leaf, (0, 14, 0))
put(J.banana("banana_0", 1220), leaf, (-2.8, 6, 0))
put(J.spill("spill_0", 1230), leaf, (-2.4, 3, 1.3), 3.14159)
t, c = F.palm("palm_0", 600, height=8)
me = t.data
zmax = max(v.co.z for v in me.vertices)
ring = [v.co for v in me.vertices if v.co.z > zmax - 0.05]
top = sum(ring, Vector()) / len(ring)
bpy.data.objects.remove(c)
put(t, bk, (-6, 12, -2.2)); put(J.palm_crown("palm_0_crown", 605, top), leaf, (-6, 12, -2.2))
t, c = J.tree_big("tree_big_0", 920)
put(t, bk, (8, 34, -2.2)); put(c, leaf, (8, 34, -2.2))
put(J.bush("bush_1", 641, radius=1.25, n=2), leaf, (-3.2, 12, 0.6))
preview(f"{CACHE}/look_jungle.png", (0, -4.5, 3.0), (0, 20, 2.5), lens=24, sun=(30, 0, 170), samples=10)
for o in bpy.data.objects:
    if o.type == "MESH":
        print("tris", o.name, sum(len(p.vertices) - 2 for p in o.data.polygons))
