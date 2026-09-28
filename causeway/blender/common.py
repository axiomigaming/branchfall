"""Shared helpers for the CAUSEWAY Blender asset pipeline (bpy 4.2, headless).

Conventions: metres, Z up, the run direction is +Y (exports to three.js -Z).
Every generator is deterministic: it seeds `random` and never reads the clock.
"""
import math
import os
import random

import bpy
import bmesh
from mathutils import Vector, Matrix, Euler, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "assets")
CACHE = os.path.join(HERE, "cache")
os.makedirs(OUT, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 16
    sc.cycles.use_denoising = False
    try:
        sc.cycles.use_auto_tile = False
    except AttributeError:
        pass
    return sc


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def new_mesh_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    return ob


def srgb_to_lin(c):
    def f(x):
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return tuple(f(v) for v in c)


def hexcol(h, a=1.0):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (*srgb_to_lin((r, g, b)), a)


def jitter_color(base, rng, v=0.08, h=0.03):
    """Return a linear RGBA near `base` (linear RGBA) with value and warmth variation."""
    r, g, b, a = base
    k = 1 + rng.uniform(-v, v)
    w = rng.uniform(-h, h)
    return (max(0, r * k * (1 + w)), max(0, g * k), max(0, b * k * (1 - w)), a)


def add_block(bm, size, loc, rot=(0, 0, 0), bevel=0.04, rng=None, color=None, chip=0.0, jit=0.018, segments=2):
    """Add an irregular, bevelled stone block to `bm`. Returns the new faces."""
    rng = rng or random
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    for v in tmp.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    b = min(bevel, min(size) * 0.3)
    if b > 0.004:
        bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=b, segments=segments, profile=0.6, affect="EDGES", clamp_overlap=True)
    # Irregularity: every vertex moves a little, corners can be chipped.
    for v in tmp.verts:
        n = noise.noise_vector(Vector(loc) * 0.7 + v.co * 1.7)
        v.co += n * jit * (1 + chip * 2)
    if chip > 0:
        for v in tmp.verts:
            c = v.co
            corner = abs(c.x) / (size[0] / 2) + abs(c.y) / (size[1] / 2) + abs(c.z) / (size[2] / 2)
            if corner > 2.55 and rng.random() < chip:
                v.co *= rng.uniform(0.86, 0.95)
    m = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4()
    bmesh.ops.transform(tmp, matrix=m, verts=tmp.verts)
    col_layer = tmp.loops.layers.float_color.new("Col")
    col = color or (0.5, 0.5, 0.5, 1)
    for f in tmp.faces:
        for l in f.loops:
            l[col_layer] = col
    me = bpy.data.meshes.new("_tmp")
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def finish_obj(name, bm, smooth_angle=35):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    ob = new_mesh_obj(name, bm)
    for p in ob.data.polygons:
        p.use_smooth = True
    try:
        ob.data.set_sharp_from_angle(angle=math.radians(smooth_angle))
    except Exception:
        pass
    return ob


# ---------------------------------------------------------------- materials
def nodes_clear(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return nt


def N(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        if k.startswith("_"):
            setattr(n, k[1:], v)
        else:
            n.inputs[k].default_value = v
    return n


def L(nt, a, b):
    nt.links.new(a, b)


def mix(nt, fac, a, b, blend="MIX"):
    m = nt.nodes.new("ShaderNodeMix")
    m.data_type = "RGBA"
    m.blend_type = blend
    if isinstance(fac, (int, float)):
        m.inputs[0].default_value = fac
    else:
        L(nt, fac, m.inputs[0])
    for idx, src in ((6, a), (7, b)):
        if isinstance(src, tuple):
            m.inputs[idx].default_value = src
        else:
            L(nt, src, m.inputs[idx])
    return m.outputs[2]


def ramp(nt, src, stops):
    r = nt.nodes.new("ShaderNodeValToRGB")
    cr = r.color_ramp
    for i, (pos, col) in enumerate(stops):
        if i < 2:
            e = cr.elements[i]
            e.position = pos
        else:
            e = cr.elements.new(pos)
        e.color = col if len(col) == 4 else (*col, 1)
    L(nt, src, r.inputs[0])
    return r.outputs[0]


def maprange(nt, src, a, b, c=0.0, d=1.0, smooth=True):
    m = nt.nodes.new("ShaderNodeMapRange")
    if smooth:
        m.interpolation_type = "SMOOTHSTEP"
    m.inputs[1].default_value = a
    m.inputs[2].default_value = b
    m.inputs[3].default_value = c
    m.inputs[4].default_value = d
    L(nt, src, m.inputs[0])
    return m.outputs[0]


def math_node(nt, op, a, b=None):
    m = nt.nodes.new("ShaderNodeMath")
    m.operation = op
    for i, s in enumerate((a, b)):
        if s is None:
            continue
        if isinstance(s, (int, float)):
            m.inputs[i].default_value = s
        else:
            L(nt, s, m.inputs[i])
    return m.outputs[0]


# ---------------------------------------------------------------- baking
def ensure_uvs(objs, margin=0.003, angle=60):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        if not o.data.uv_layers:
            o.data.uv_layers.new(name="UVMap")
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=margin, rotate=True, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


def ensure_uvs_packed(objs, size, margin_px=5, angle=60):
    """Like ensure_uvs, but the island margin is a fixed number of texels of the final atlas.

    Blender's default (SCALED) margin grows with the island count: on groups of hundreds of dressed
    blocks it left most of a 4K atlas empty and every face a few texels wide. FRACTION keeps the
    gaps at `margin_px` texels, so the islands fill the atlas.
    """
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        if not o.data.uv_layers:
            o.data.uv_layers.new(name="UVMap")
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin_method="FRACTION", margin=margin_px / size, rotate=True, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_group(objs, mat, name, size, ao_samples=24, ao_strength=0.55, flat_ao=False):
    """Bake the procedural `mat` on `objs` into an atlas, then swap in a textured PBR material.

    Produces <name>_color (AO multiplied in), <name>_normal, <name>_orm (AO, roughness, metal).
    """
    import numpy as np
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.render.bake.margin = 6
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)
    nt = mat.node_tree
    imgs = {}
    for key, cs in (("color", "sRGB"), ("normal", "Non-Color"), ("rough", "Non-Color"), ("ao", "Non-Color")):
        im = bpy.data.images.new(f"{name}_{key}", size, size, alpha=False, float_buffer=False)
        im.colorspace_settings.name = cs
        imgs[key] = im
    tex = nt.nodes.new("ShaderNodeTexImage")
    nt.nodes.active = tex

    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

    def bake(key, typ, samples, **kw):
        tex.image = imgs[key]
        sc.cycles.samples = samples
        print(f"  bake {name}:{key} …", flush=True)
        bpy.ops.object.bake(type=typ, margin=6, use_clear=True, **kw)

    bake("color", "DIFFUSE", 1, pass_filter={"COLOR"})
    bake("normal", "NORMAL", 1)
    bake("rough", "ROUGHNESS", 1)
    if flat_ao:
        imgs["ao"].generated_color = (1, 1, 1, 1)
    else:
        bake("ao", "AO", ao_samples)

    def arr(im):
        return np.array(im.pixels[:], dtype=np.float32).reshape(size, size, 4)

    col = arr(imgs["color"])
    ao = arr(imgs["ao"])[:, :, 0:1] if not flat_ao else np.ones((size, size, 1), np.float32)
    rough = arr(imgs["rough"])[:, :, 0:1]
    # AO into albedo (sRGB image pixels are linear floats in Blender's buffer).
    col[:, :, 0:3] *= (1 - ao_strength) + ao_strength * ao
    imgs["color"].pixels[:] = col.ravel()
    orm = np.concatenate([ao, rough, np.zeros_like(ao), np.ones_like(ao)], axis=2)
    om = bpy.data.images.new(f"{name}_orm", size, size, alpha=False)
    om.colorspace_settings.name = "Non-Color"
    om.pixels[:] = orm.ravel()
    imgs["orm"] = om
    for k in ("color", "normal", "orm"):
        im = imgs[k]
        im.filepath_raw = os.path.join(CACHE, f"{name}_{k}.png")
        im.file_format = "PNG"
        im.save()

    pbr = textured_material(name, imgs["color"], imgs["normal"], imgs["orm"])
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(pbr)
    return pbr


def textured_material(name, color, normal, orm, alpha=False):
    m = bpy.data.materials.new(f"M_{name}")
    nt = nodes_clear(m)
    out = N(nt, "ShaderNodeOutputMaterial")
    bsdf = N(nt, "ShaderNodeBsdfPrincipled")
    L(nt, bsdf.outputs[0], out.inputs[0])
    tc = N(nt, "ShaderNodeTexImage", _image=color)
    L(nt, tc.outputs[0], bsdf.inputs["Base Color"])
    if alpha:
        L(nt, tc.outputs[1], bsdf.inputs["Alpha"])
        m.blend_method = "CLIP"
    if normal is not None:
        tn = N(nt, "ShaderNodeTexImage", _image=normal)
        nm = N(nt, "ShaderNodeNormalMap")
        L(nt, tn.outputs[0], nm.inputs["Color"])
        L(nt, nm.outputs[0], bsdf.inputs["Normal"])
    if orm is not None:
        to = N(nt, "ShaderNodeTexImage", _image=orm)
        sep = N(nt, "ShaderNodeSeparateColor")
        L(nt, to.outputs[0], sep.inputs[0])
        L(nt, sep.outputs[1], bsdf.inputs["Roughness"])
        L(nt, sep.outputs[2], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Roughness"].default_value = 0.85
    return m


def export_glb(path, objs=None, anim=False, webp=True, quality=85):
    bpy.ops.object.select_all(action="DESELECT")
    if objs:
        for o in objs:
            o.select_set(True)
    kw = dict(
        filepath=path,
        export_format="GLB",
        use_selection=bool(objs),
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_attributes=False,
        export_animations=anim,
        export_image_format="WEBP" if webp else "AUTO",
        export_image_quality=quality,
        export_extras=True,
    )
    if anim:
        kw.update(export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_step=1,
                  export_skins=True, export_def_bones=True, export_optimize_animation_size=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="NONE")
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=False)
    print("exported", path, os.path.getsize(path) // 1024, "KB")


def preview(path, cam_loc, target, lens=28, res=(960, 540), samples=24, sun=(35, 0, 200), strength=4.0):
    """Quick Cycles look-dev render."""
    sc = bpy.context.scene
    w = bpy.data.worlds.new("pv")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    sky = w.node_tree.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "NISHITA"
    sky.sun_elevation = math.radians(sun[0])
    sky.sun_rotation = math.radians(sun[2])
    sky.sun_intensity = 0.4
    w.node_tree.links.new(sky.outputs[0], bg.inputs[0])
    bg.inputs[1].default_value = 0.35
    ld = bpy.data.lights.new("sun", "SUN")
    ld.energy = strength
    ld.angle = math.radians(2)
    ld.color = (1.0, 0.86, 0.68)
    lo = bpy.data.objects.new("sun", ld)
    lo.rotation_euler = Euler((math.radians(90 - sun[0]), 0, math.radians(sun[2])))
    link(lo)
    cd = bpy.data.cameras.new("cam")
    cd.lens = lens
    co = bpy.data.objects.new("cam", cd)
    co.location = cam_loc
    d = Vector(target) - Vector(cam_loc)
    co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    link(co)
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(lo)
    bpy.data.objects.remove(co)
