"""The supplied runner's texture maps, as supplied.

The owner's character ships with exactly the look of blender/sources/runner/albedo.png — the cream
henley with rolled sleeves, blue-grey jeans, the brown leather cross-harness and holster, his face and
hair. Colour and normal are used untouched (loaded straight from the source PNGs); only roughness and
metallic are packed into one glTF ORM map (R = 1, G = roughness, B = metallic), pixel for pixel.
"""
import os
import shutil

import bpy
import numpy as np


def source_maps(src_dir, out_dir):
    """{color, normal, orm} image paths at the source resolution."""
    os.makedirs(out_dir, exist_ok=True)
    rgh = bpy.data.images.load(os.path.join(src_dir, "roughness.png"))
    met = bpy.data.images.load(os.path.join(src_dir, "metallic.png"))
    for im in (rgh, met):
        im.colorspace_settings.name = "Non-Color"
    w, h = rgh.size
    r = np.array(rgh.pixels[:], np.float32).reshape(h, w, 4)[..., 0]
    m = np.array(met.pixels[:], np.float32).reshape(h, w, 4)[..., 0]
    one = np.ones_like(r)
    orm = bpy.data.images.new("runner_orm", w, h, alpha=False)
    orm.colorspace_settings.name = "Non-Color"
    orm.pixels[:] = np.stack([one, r, m, one], -1).ravel()
    path = os.path.join(out_dir, "runner_orm.png")
    orm.filepath_raw = path
    orm.file_format = "PNG"
    orm.save()
    for im in (rgh, met, orm):
        bpy.data.images.remove(im)
    # Byte-for-byte copies, named for the delivery pipeline (it sizes maps by name).
    out = {"orm": path}
    for k, f in (("color", "albedo.png"), ("normal", "normal.png")):
        out[k] = os.path.join(out_dir, f"runner_{k}.png")
        shutil.copyfile(os.path.join(src_dir, f), out[k])
    return out
