"""QA contact sheets for the runner's gait cycles, straight from an exported glb.

    python3 blender/qa_runner_sheet.py -- <runner.glb> <out_prefix> [clip[:tag] …]

For each gait clip renders eight evenly spaced phases of one cycle from the side and from behind
(a chase-camera height), and writes <out_prefix>_<tag>_side.png and <out_prefix>_<tag>_back.png as
one-row strips. Ground contact reads against a floor grid (0.25 m) and a shadow from a high sun.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector, Euler

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
glb, prefix = args[0], args[1]
clips = args[2:] or ["run:t0", "sprint:t2", "dash:t4"]
N = int(os.environ.get("N", 8))
RES = tuple(int(x) for x in os.environ.get("RES", "300x420").split("x"))

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = 12
sc.cycles.use_denoising = False
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.film_transparent = False
sc.view_settings.view_transform = "Standard"
bpy.ops.import_scene.gltf(filepath=glb)
rig = next(o for o in sc.objects if o.type == "ARMATURE")

# Floor with a 0.25 m checker so sliding feet show.
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
fl = bpy.context.active_object
m = bpy.data.materials.new("floor")
m.use_nodes = True
nt = m.node_tree
bs = nt.nodes["Principled BSDF"]
ck = nt.nodes.new("ShaderNodeTexChecker")
ck.inputs["Scale"].default_value = 24.0
ck.inputs["Color1"].default_value = (0.42, 0.36, 0.3, 1)
ck.inputs["Color2"].default_value = (0.5, 0.44, 0.37, 1)
nt.links.new(ck.outputs[0], bs.inputs["Base Color"])
fl.data.materials.append(m)
w = bpy.data.worlds.new("w")
sc.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.7, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
ld = bpy.data.lights.new("sun", "SUN")
ld.energy = 3.5
sun = bpy.data.objects.new("sun", ld)
sun.rotation_euler = Euler((math.radians(25), math.radians(15), math.radians(30)))
sc.collection.objects.link(sun)
cd = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cd)
sc.collection.objects.link(cam)
sc.camera = cam


def aim(loc, target, lens):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cd.lens = lens


def strip(paths, out):
    ims = []
    for p in paths:
        im = bpy.data.images.load(p)
        ims.append(np.array(im.pixels[:], np.float32).reshape(im.size[1], im.size[0], 4))
        bpy.data.images.remove(im)
    sheet = np.concatenate(ims, axis=1)
    o = bpy.data.images.new("strip", sheet.shape[1], sheet.shape[0], alpha=True)
    o.pixels[:] = sheet.ravel()
    o.filepath_raw = out
    o.file_format = "PNG"
    o.save()
    bpy.data.images.remove(o)
    for p in paths:
        os.remove(p)


# glTF faces +Y in Blender after import (the runner faces −Z in three / +Y here).
for spec in clips:
    name, tag = (spec.split(":") + [spec])[:2]
    act = bpy.data.actions.get(name) or next((a for a in bpy.data.actions if a.name.startswith(name + "_") or a.name == name), None)
    if act is None:
        print("no clip", name)
        continue
    rig.animation_data.action = act
    f0, f1 = act.frame_range
    for view, loc, tgt in (("side", (3.3, 0.0, 0.95), (0, 0.0, 0.85)), ("back", (0.0, -3.4, 1.55), (0, 0.4, 0.8))):
        paths = []
        for i in range(N):
            fr = f0 + (f1 - f0) * i / N
            sc.frame_set(int(math.floor(fr)), subframe=fr - math.floor(fr))
            aim(loc, tgt, 38)
            p = f"{prefix}_{tag}_{view}_{i}.png"
            sc.render.filepath = p
            bpy.ops.render.render(write_still=True)
            paths.append(p)
        strip(paths, f"{prefix}_{tag}_{view}.png")
        print("wrote", f"{prefix}_{tag}_{view}.png", flush=True)
