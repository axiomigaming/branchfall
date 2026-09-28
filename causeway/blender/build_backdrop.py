"""The far world as an equirectangular Cycles render → public/assets/backdrop.webp + env.hdr.

Everything beyond ~250 m lives here: sky, clouds, cliffs, jungle ridges, distant
temples and open water. The game draws it on a camera-locked sphere, so it never
parallaxes, and uses the HDR version for image-based lighting so the sky and the
light on the stones agree. The sun direction is measured from the render and
written to backdrop.json for the realtime sun.

    python3 blender/build_backdrop.py [--fast]
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
import bmesh
from mathutils import Vector, noise

from common import reset, N, L, nodes_clear, hexcol, link, new_mesh_obj, mix, ramp, maprange, math_node, OUT, CACHE

FAST = "--fast" in sys.argv
sc = reset()
rng = random.Random(11)

SUN_EL = 24.0
SUN_AZ = 50.0  # degrees from +X toward +Y (the run direction is +Y): ahead and to the right, in frame
SUN_ROT = 90.0 - SUN_AZ  # Nishita: dir = (sin r·cos e, cos r·cos e, sin e)

# ---------------------------------------------------------------- world
w = bpy.data.worlds.new("sky")
sc.world = w
w.use_nodes = True
nt = w.node_tree
bg = nt.nodes["Background"]
sky = nt.nodes.new("ShaderNodeTexSky")
sky.sky_type = "NISHITA"
sky.sun_elevation = math.radians(SUN_EL)
sky.sun_rotation = math.radians(SUN_ROT)
sky.sun_size = math.radians(1.2)
sky.sun_intensity = 0.4
sky.altitude = 200
sky.air_density = 1.15
sky.dust_density = 1.4
sky.ozone_density = 2.2
_tc = nt.nodes.new("ShaderNodeTexCoord")
_sep = nt.nodes.new("ShaderNodeSeparateXYZ")
nt.links.new(_tc.outputs["Generated"], _sep.inputs[0])
_hz = maprange(nt, _sep.outputs[2], 0.0, 0.45, 0.0, 1.0)
# A warm band of haze on the horizon under a clear blue zenith.
_warm = ramp(nt, _hz, [(0.0, (1.22, 1.02, 0.8, 1)), (0.3, (1.0, 1.0, 1.0, 1)), (1.0, (0.88, 0.96, 1.08, 1))])
nt.links.new(mix(nt, 1.0, sky.outputs[0], _warm, "MULTIPLY"), bg.inputs[0])
bg.inputs[1].default_value = 0.22

# Haze colour for aerial perspective: warm near the sun side, cooler away.
HAZE = hexcol("#93aeb4")  # cool, a little green: the jungle breathes it
HAZE_FAR = hexcol("#c9d4d8")


def aerial(ntm, col, near=150.0, far=2600.0, strength=0.72):
    cam = N(ntm, "ShaderNodeCameraData")
    fac = maprange(ntm, cam.outputs["View Distance"], near, far, 0.0, strength, smooth=False)
    fac = math_node(ntm, "POWER", fac, 1.1)
    return mix(ntm, fac, col, HAZE, "MIX")


def terrain_mat(name, low, high, green=0.0, near=150, far=2600):
    m = bpy.data.materials.new(name)
    t = nodes_clear(m)
    out = N(t, "ShaderNodeOutputMaterial")
    bsdf = N(t, "ShaderNodeBsdfPrincipled")
    L(t, bsdf.outputs[0], out.inputs[0])
    tc = N(t, "ShaderNodeTexCoord")
    nz = N(t, "ShaderNodeTexNoise", Scale=0.02, Detail=8.0, Roughness=0.6)
    L(t, tc.outputs["Object"], nz.inputs["Vector"])
    sep = N(t, "ShaderNodeSeparateXYZ")
    L(t, tc.outputs["Object"], sep.inputs[0])
    h = maprange(t, sep.outputs[2], 0.0, 260.0)
    col = mix(t, h, low, high, "MIX")
    col = mix(t, 1.0, col, ramp(t, nz.outputs[0], [(0.3, (0.75, 0.75, 0.75)), (0.7, (1.15, 1.12, 1.08))]), "MULTIPLY")
    if green:
        geo = N(t, "ShaderNodeNewGeometry")
        sn = N(t, "ShaderNodeSeparateXYZ")
        L(t, geo.outputs["Normal"], sn.inputs[0])
        g = maprange(t, sn.outputs[2], 0.45, 0.8, 0.0, green)
        gn = N(t, "ShaderNodeTexNoise", Scale=0.08, Detail=6.0)
        L(t, tc.outputs["Object"], gn.inputs["Vector"])
        g = math_node(t, "MULTIPLY", g, maprange(t, gn.outputs[0], 0.35, 0.55))
        # Vegetation clings to the faces in vertical streaks and fills the base.
        mpv = N(t, "ShaderNodeMapping")
        mpv.inputs["Scale"].default_value = (0.09, 0.09, 0.025)
        L(t, tc.outputs["Object"], mpv.inputs[0])
        vn = N(t, "ShaderNodeTexNoise", Scale=1.0, Detail=8.0, Roughness=0.65)
        L(t, mpv.outputs[0], vn.inputs["Vector"])
        face = maprange(t, vn.outputs[0], 0.4, 0.55, 0.0, green)
        base = maprange(t, sep.outputs[2], 60.0, 5.0, 0.0, 1.0)
        g = math_node(t, "MAXIMUM", g, math_node(t, "MAXIMUM", face, base))
        col = mix(t, g, col, ramp(t, gn.outputs[0], [(0.3, hexcol("#1d3a12")), (0.7, hexcol("#3f6a1e"))]), "MIX")
    col = aerial(t, col, near, far)
    L(t, col, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    bump = N(t, "ShaderNodeBump", Strength=0.6, Distance=4.0)
    L(t, nz.outputs[0], bump.inputs["Height"])
    L(t, bump.outputs[0], bsdf.inputs["Normal"])
    return m


def ridge(name, r0, r1, hmax, seed, mat, steps_a=720, steps_r=40, cliff=0.0, gap=None):
    """A ring of terrain between radii r0..r1 around the origin."""
    bm = bmesh.new()
    off = Vector((seed * 13.1, seed * 7.3, 0))
    rows = []
    for i in range(steps_r + 1):
        r = r0 + (r1 - r0) * (i / steps_r) ** 1.3
        row = []
        for j in range(steps_a):
            a = 2 * math.pi * j / steps_a
            p = Vector((math.cos(a) * r, math.sin(a) * r, 0))
            q = p * 0.0022 + off
            n = noise.fractal(q, 0.55, 2.1, 7)
            n2 = noise.ridged_multi_fractal(q * 1.7, 0.9, 2.0, 5, 1.0, 2.0)
            env = math.sin(math.pi * i / steps_r) ** 0.6
            h = hmax * max(0.0, 0.45 + 0.55 * n + 0.25 * (n2 - 1.0)) * env
            if cliff:
                # Terraced mesas: quantise heights, keep the walls steep.
                step = hmax * 0.18
                h = math.floor(h / step) * step + (h % step) * (1 - cliff)
            if gap and abs(((math.degrees(a) - gap[0] + 180) % 360) - 180) < gap[1]:
                h *= 0.08
            row.append(bm.verts.new((p.x, p.y, h - 2.0)))
        rows.append(row)
    for i in range(steps_r):
        for j in range(steps_a):
            k = (j + 1) % steps_a
            bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][k], rows[i][k]))  # normals up
    ob = new_mesh_obj(name, bm)
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.materials.append(mat)
    return ob


rock_far = terrain_mat("farrock", hexcol("#8a4e34"), hexcol("#b77a52"), green=1.0, near=300, far=3200)
jungle = terrain_mat("jungle", hexcol("#1f3a14"), hexcol("#3f6420"), green=0.0, near=150, far=1600)
rock_near = terrain_mat("nearrock", hexcol("#7e4630"), hexcol("#b0714a"), green=1.0, near=200, far=2200)

# Mesas and cliff walls far away, a gap toward the sun so the light pours over the water.
ridge("mesas", 1100, 2600, 620, 3, rock_far, cliff=0.6, gap=(SUN_AZ, 16))
# Jungle-topped cliffs nearer, terraced like the limestone in the references.
ridge("hills", 380, 1000, 210, 7, rock_near, steps_a=900, cliff=0.7, gap=(SUN_AZ, 11))


def karst(name, loc, radius, height, seed):
    """A tropical limestone tower: steep fluted sides, a green cap."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
    off = Vector((seed * 5.3, seed * 2.1, seed * 3.7))
    for v in bm.verts:
        p = v.co.copy()
        z = (p.z + 1) / 2
        prof = (1 - z ** 6) ** 0.35
        flute = 1 + 0.28 * noise.noise(Vector((p.x * 4, p.y * 4, z * 0.8)) + off) + 0.2 * noise.fractal(p * 3.0 + off, 0.65, 2, 5)
        v.co = Vector((p.x * radius * (0.35 + 0.65 * prof) * flute, p.y * radius * (0.35 + 0.65 * prof) * flute, z * height))
    ob = new_mesh_obj(name, bm)
    for q in ob.data.polygons:
        q.use_smooth = True
    ob.location = loc
    ob.data.materials.append(rock_near)
    return ob


for k in range(26):
    az = rng.uniform(0, 360)
    if abs(((az - SUN_AZ + 180) % 360) - 180) < 9:
        continue
    d = rng.uniform(320, 1500)
    karst(f"karst{k}", Vector((math.cos(math.radians(az)) * d, math.sin(math.radians(az)) * d, -4)),
          rng.uniform(25, 60) * (d / 700) ** 0.4, rng.uniform(90, 260) * (d / 700) ** 0.5, k)

# Canopy bumps on the hills: instanced icospheres read as tree crowns at distance.
canopy = bpy.data.materials.new("canopy")
t = nodes_clear(canopy)
out = N(t, "ShaderNodeOutputMaterial")
bsdf = N(t, "ShaderNodeBsdfPrincipled")
L(t, bsdf.outputs[0], out.inputs[0])
oi = N(t, "ShaderNodeObjectInfo")
col = ramp(t, oi.outputs["Random"], [(0.0, hexcol("#18331a")), (0.5, hexcol("#2c5418")), (1.0, hexcol("#56782a"))])
L(t, aerial(t, col, 120, 1500), bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.9

# ---------------------------------------------------------------- distant temples (stacked-block silhouettes)
stone_far = bpy.data.materials.new("stonefar")
t = nodes_clear(stone_far)
out = N(t, "ShaderNodeOutputMaterial")
bsdf = N(t, "ShaderNodeBsdfPrincipled")
L(t, bsdf.outputs[0], out.inputs[0])
tc = N(t, "ShaderNodeTexCoord")
nz = N(t, "ShaderNodeTexNoise", Scale=0.3, Detail=6.0)
L(t, tc.outputs["Object"], nz.inputs["Vector"])
col = mix(t, 1.0, hexcol("#b8845a"), ramp(t, nz.outputs[0], [(0.3, (0.7, 0.72, 0.6)), (0.7, (1.1, 1.05, 1.0))]), "MULTIPLY")
L(t, aerial(t, col, 150, 2200), bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.9


def blocks_temple(name, loc, scale, tiers=6, spire=False):
    bm = bmesh.new()
    w = 60 * scale
    z = 0
    for i in range(tiers):
        h = 9 * scale
        bmesh.ops.create_cube(bm, size=1.0, matrix=__import__("mathutils").Matrix.Translation((0, 0, z + h / 2)) @
                              __import__("mathutils").Matrix.Diagonal((w, w, h, 1)))
        z += h
        w *= 0.8
    if spire:
        bmesh.ops.create_cube(bm, size=1.0, matrix=__import__("mathutils").Matrix.Translation((0, 0, z + 20 * scale)) @
                              __import__("mathutils").Matrix.Diagonal((w * 0.5, w * 0.5, 40 * scale, 1)))
    ob = new_mesh_obj(name, bm)
    ob.location = loc
    ob.data.materials.append(stone_far)
    return ob


def at(az_deg, dist, z=0.0):
    a = math.radians(az_deg)
    return Vector((math.cos(a) * dist, math.sin(a) * dist, z))


# Toward the run direction (+Y is 90°) the eye expects a destination.
blocks_temple("temple_a", at(97, 700, -2), 2.0, tiers=7, spire=True)
blocks_temple("temple_b", at(80, 520, -2), 0.9, tiers=5)
blocks_temple("temple_c", at(128, 1150, 30), 0.9, tiers=6)
blocks_temple("temple_d", at(250, 800, -2), 0.8, tiers=5, spire=True)
blocks_temple("temple_e", at(70, 460, -2), 0.7, tiers=6, spire=True)
blocks_temple("temple_f", at(112, 540, -2), 0.8, tiers=5, spire=True)
blocks_temple("temple_g", at(160, 620, -2), 1.1, tiers=6)
for k in range(9):
    az = rng.uniform(0, 360)
    d = rng.uniform(380, 900)
    s = rng.uniform(0.6, 1.4)
    bm = bmesh.new()
    import mathutils
    bmesh.ops.create_cube(bm, size=1.0, matrix=mathutils.Matrix.Translation((0, 0, 25 * s)) @ mathutils.Matrix.Diagonal((9 * s, 9 * s, 50 * s, 1)))
    ob = new_mesh_obj(f"spire{k}", bm)
    ob.location = at(az, d, -2)
    ob.data.materials.append(stone_far)

# Canopy scatter on the near hills.
ico = bpy.data.meshes.new("ico")
bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
bm.to_mesh(ico)
bm.free()
hills = bpy.data.objects["hills"]
deps = bpy.context.evaluated_depsgraph_get()
count = 0
for k in range(9000 if not FAST else 2500):
    a = rng.uniform(0, 2 * math.pi)
    r = rng.uniform(260, 1100)
    p = Vector((math.cos(a) * r, math.sin(a) * r, 700))
    hit, loc, nrm, idx, obj, _ = sc.ray_cast(deps, p, Vector((0, 0, -1)))
    if not hit or loc.z < 2:
        continue
    if nrm.z < 0.6:
        continue
    s0 = rng.uniform(4, 9) * (r / 500) ** 0.3
    for c in range(3):
        o = bpy.data.objects.new("tree", ico)
        s = s0 * rng.uniform(0.55, 1.0)
        o.scale = (s, s, s * rng.uniform(0.6, 0.9))
        o.location = loc + Vector((rng.uniform(-s0, s0), rng.uniform(-s0, s0), s * 0.25))
        link(o)
    count += 1
ico.materials.append(canopy)
print("canopy", count)

# Near shore jungle band (200–320 m) so the water has a far bank.
for k in range(1600 if not FAST else 500):
    a = rng.uniform(0, 2 * math.pi)
    if abs(((math.degrees(a) - SUN_AZ + 180) % 360) - 180) < 10:
        continue
    r = rng.uniform(240, 380)
    o = bpy.data.objects.new("tree", ico)
    s = rng.uniform(3, 8)
    o.scale = (s, s, s * rng.uniform(0.8, 1.4))
    o.location = (math.cos(a) * r, math.sin(a) * r, s * 0.6 - 1)
    link(o)

# ---------------------------------------------------------------- water and clouds
water = bpy.data.materials.new("water")
t = nodes_clear(water)
out = N(t, "ShaderNodeOutputMaterial")
bsdf = N(t, "ShaderNodeBsdfPrincipled")
L(t, bsdf.outputs[0], out.inputs[0])
bsdf.inputs["Base Color"].default_value = hexcol("#17605c")
bsdf.inputs["Roughness"].default_value = 0.08
tc = N(t, "ShaderNodeTexCoord")
wv = N(t, "ShaderNodeTexNoise", Scale=0.15, Detail=6.0)
L(t, tc.outputs["Object"], wv.inputs["Vector"])
bump = N(t, "ShaderNodeBump", Strength=0.08, Distance=0.5)
L(t, wv.outputs[0], bump.inputs["Height"])
L(t, bump.outputs[0], bsdf.inputs["Normal"])
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6000)
wo = new_mesh_obj("water", bm)
wo.data.materials.append(water)

clouds = bpy.data.materials.new("clouds")
t = nodes_clear(clouds)
out = N(t, "ShaderNodeOutputMaterial")
em = N(t, "ShaderNodeEmission")
tr = N(t, "ShaderNodeBsdfTransparent")
mx = N(t, "ShaderNodeMixShader")
tc = N(t, "ShaderNodeTexCoord")
mp = N(t, "ShaderNodeMapping")
mp.inputs["Scale"].default_value = (1.0, 4.5, 1.0)
L(t, tc.outputs["Object"], mp.inputs[0])
cn = N(t, "ShaderNodeTexNoise", Scale=0.00045, Detail=12.0, Roughness=0.58, Distortion=0.2)
L(t, mp.outputs[0], cn.inputs["Vector"])
dens = maprange(t, cn.outputs[0], 0.52, 0.7)
dens = math_node(t, "MULTIPLY", dens, 0.8)
L(t, dens, mx.inputs[0])
L(t, tr.outputs[0], mx.inputs[1])
L(t, em.outputs[0], mx.inputs[2])
L(t, mx.outputs[0], out.inputs[0])
# Self-lit, so they glow gold toward the sun and go lilac-grey away from it (seen from below,
# a lit plane would only show its dark side).
_e, _r = math.radians(SUN_EL), math.radians(SUN_ROT)
_sd = (math.sin(_r) * math.cos(_e), math.cos(_r) * math.cos(_e), math.sin(_e))
geo = N(t, "ShaderNodeNewGeometry")
nv = t.nodes.new("ShaderNodeVectorMath")
nv.operation = "NORMALIZE"
L(t, geo.outputs["Position"], nv.inputs[0])
dv = t.nodes.new("ShaderNodeVectorMath")
dv.operation = "DOT_PRODUCT"
L(t, nv.outputs[0], dv.inputs[0])
dv.inputs[1].default_value = _sd
toward = maprange(t, dv.outputs["Value"], 0.2, 0.98, 0.0, 1.0)
ccol = ramp(t, toward, [(0.0, hexcol("#d8e0ea")), (0.6, hexcol("#f6ecdc")), (1.0, hexcol("#fff3dc"))])
L(t, ccol, em.inputs["Color"])
L(t, maprange(t, dv.outputs["Value"], 0.2, 0.98, 1.1, 3.2), em.inputs["Strength"])
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30000)
co = new_mesh_obj("clouds", bm)
co.location.z = 1400
co.data.materials.append(clouds)
co.visible_shadow = False  # thin golden streaks; they must not dim the land

# ---------------------------------------------------------------- sun lamp matching the sky
sl = bpy.data.lights.new("sun", "SUN")
sl.energy = 3.2
sl.angle = math.radians(1.5)
sl.color = (1.0, 0.9, 0.76)
so = bpy.data.objects.new("sun", sl)
link(so)
# Nishita: sun direction (x, y, z) = (sin r · cos e, cos r · cos e, sin e) — verified below from pixels.
e, r = math.radians(SUN_EL), math.radians(SUN_ROT)
sun_dir = Vector((math.sin(r) * math.cos(e), math.cos(r) * math.cos(e), math.sin(e)))
so.rotation_euler = (-sun_dir).to_track_quat("-Z", "Y").to_euler()

# ---------------------------------------------------------------- camera + render
cd = bpy.data.cameras.new("pano")
cd.type = "PANO"
try:
    cd.panorama_type = "EQUIRECTANGULAR"
except AttributeError:
    cd.cycles.panorama_type = "EQUIRECTANGULAR"
cd.clip_end = 40000
cam = bpy.data.objects.new("pano", cd)
cam.location = (0, 0, 3.0)
cam.rotation_euler = (math.radians(90), 0, math.radians(-90))  # look along +X; image centre = +X
link(cam)
sc.camera = cam
W = 2048 if FAST else 4096
sc.render.resolution_x, sc.render.resolution_y = W, W // 2
sc.cycles.samples = 24 if FAST else 32  # denoised; the far world needs no more
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 4
sc.view_settings.view_transform = "AgX"
sc.view_settings.look = "AgX - Base Contrast"
sc.view_settings.exposure = -0.35

bpy.ops.render.render()
rr = bpy.data.images["Render Result"]
png = os.path.join(CACHE, "backdrop.png")
exr = os.path.join(CACHE, "backdrop.exr")
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGB"
sc.render.image_settings.color_depth = "8"
rr.save_render(png, scene=sc)
sc.render.image_settings.file_format = "OPEN_EXR"
sc.render.image_settings.color_depth = "16"
rr.save_render(exr, scene=sc)

import numpy as np
res = bpy.data.images.load(exr)
H = W // 2
px = np.array(res.pixels[:], np.float32).reshape(H, W, 4)
lum = px[:, :, 0] * 0.2126 + px[:, :, 1] * 0.7152 + px[:, :, 2] * 0.0722
iy, ix = np.unravel_index(np.argmax(lum), lum.shape)
u, v = (ix + 0.5) / W, (iy + 0.5) / H
print("sun pixel", ix, iy, "u", round(u, 4), "v", round(v, 4), "expected dir", tuple(round(c, 3) for c in sun_dir))

env = bpy.data.images.new("env", 1024, 512, float_buffer=True)
small = px.reshape(512, H // 512, 1024, W // 1024, 4).mean(axis=(1, 3))
env.pixels[:] = small.ravel()
env.filepath_raw = os.path.join(OUT, "env.hdr")
env.file_format = "HDR"
env.save()

ldr = bpy.data.images.load(png)
ldr.pixels[0]  # force the lazy load before retargeting the path
ldr.filepath_raw = os.path.join(OUT, "backdrop.webp")
ldr.file_format = "WEBP"
ldr.save()

with open(os.path.join(OUT, "backdrop.json"), "w") as f:
    json.dump({
        "sunDirBlender": [round(c, 5) for c in sun_dir],
        "sunPixel": [int(ix), int(iy)],
        "sunUV": [round(u, 5), round(v, 5)],
        "size": [W, H],
        "sunElevationDeg": SUN_EL,
        "cameraForward": "+X at image centre",
    }, f, indent=2)
print("backdrop done")
