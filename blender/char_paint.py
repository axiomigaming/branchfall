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


def vertex_hsv(mesh, albedo_path):
    """Mean albedo of each vertex's corners, as (hue°, saturation, value) arrays."""
    im = bpy.data.images.load(albedo_path)
    w, h = im.size
    px = np.array(im.pixels[:], np.float32).reshape(h, w, 4)[..., :3]
    bpy.data.images.remove(im)
    me = mesh.data
    uv = np.zeros(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    vi = np.zeros(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", vi)
    c = px[np.clip((uv[:, 1] * h).astype(int), 0, h - 1), np.clip((uv[:, 0] * w).astype(int), 0, w - 1)]
    acc = np.zeros((len(me.vertices), 3))
    np.add.at(acc, vi, c)
    acc /= np.maximum(np.bincount(vi, minlength=len(me.vertices)), 1)[:, None]
    r, g, b = acc[:, 0], acc[:, 1], acc[:, 2]
    mx, mn = acc.max(1), acc.min(1)
    d = mx - mn + 1e-6
    hue = np.where(mx == r, (g - b) / d % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    return hue, (mx - mn) / (mx + 1e-6), mx
