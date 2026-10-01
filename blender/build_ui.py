"""The CAUSEWAY interface material: carved limestone, gold and jewels → public/ui/*.webp

    python3 blender/build_ui.py [--fast] [only ...]

Everything is rendered top-down through an orthographic camera at 2× the CSS size, one
Blender unit per CSS pixel, so chips, relief and bevels are authored in the same units the
stylesheet slices them with:

  plate-frame.webp   960×192  hero frame (RUN, CASH OUT, ENTER): worn limestone with stepped
                              corners, carved key hooks on the end caps and moss on the top
                              corners. Sliced 50 % / 56 px: each end cap is two half-height
                              corners, so it scales with the plate height and never stretches.
  panel*.webp        960×128  the recessed red-brown stone inside it (panel, panel-hot with
                              ember seams for CASH OUT heat, panel-jade, panel-smoke).
                              Nine-slice 24 px + fill.
  tablet*.webp       192×96   secondary tablet: a fine limestone rim with stepped corners around
                              the red-brown (or jade) panel. Nine-slice 16 px + fill.
  crest.webp         256×104  gold crest with a red cabochon and two green ones (primary only).
  pendant.webp       176×56   gold fret pendant under the primary plate.
  leaves.webp        144×192  a tuft of jungle leaves tucked behind a plate end.
  fret.webp          512×24   a gold key-fret band, tileable on x (dividers, the title rule).
  stud.webp           64×64   a gold boss with a ruby (toggle and slider thumbs).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector, Matrix

from common import reset, N, L, hexcol, ramp, maprange, math_node, ROOT

FAST = "--fast" in sys.argv
ONLY = [a for a in sys.argv[1:] if not a.startswith("--")]
OUT = os.path.join(ROOT, "public", "ui")
os.makedirs(OUT, exist_ok=True)
SAMPLES = 24 if FAST else 160


# ---------------------------------------------------------------- scene
def scene(w, h):
    """A fresh scene whose camera frames the CSS rectangle (0,0)-(w,h), y down, at 2×."""
    sc = reset()
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    sc.render.film_transparent = True
    sc.render.resolution_x = int(w * 2)
    sc.render.resolution_y = int(h * 2)
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.image_settings.file_format = "WEBP"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.quality = 92
    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = max(w, h)
    cam = bpy.data.objects.new("cam", cam_d)
    cam.location = (w / 2, -h / 2, 200)
    sc.collection.objects.link(cam)
    sc.camera = cam
    world(sc)
    return sc


def world(sc):
    """Dark studio with one warm softbox high to the upper left and a cool low fill, so
    facets and bevels that face the light flare and the rest fall into shadow."""
    w = bpy.data.worlds.new("studio")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    tc = N(nt, "ShaderNodeTexCoord")
    key = N(nt, "ShaderNodeVectorMath", _operation="DOT_PRODUCT")
    L(nt, tc.outputs["Generated"], key.inputs[0])
    key.inputs[1].default_value = Vector((-0.55, 0.62, 0.56)).normalized()
    soft = maprange(nt, key.outputs["Value"], 0.55, 0.97, 0.0, 1.0)
    fill = N(nt, "ShaderNodeVectorMath", _operation="DOT_PRODUCT")
    L(nt, tc.outputs["Generated"], fill.inputs[0])
    fill.inputs[1].default_value = Vector((0.7, -0.5, 0.35)).normalized()
    fl = maprange(nt, fill.outputs["Value"], 0.5, 1.0, 0.0, 1.0)
    sep = N(nt, "ShaderNodeSeparateXYZ")
    L(nt, tc.outputs["Generated"], sep.inputs[0])
    zen = maprange(nt, sep.outputs["Z"], 0.2, 1.0, 0.0, 1.0)
    # colour = base + zenith + key + fill
    add1 = N(nt, "ShaderNodeMix")
    add1.data_type = "RGBA"
    add1.blend_type = "ADD"
    add1.inputs[0].default_value = 1
    add1.inputs[6].default_value = (0.012, 0.010, 0.008, 1)
    zc = N(nt, "ShaderNodeMix")
    zc.data_type = "RGBA"
    L(nt, zen, zc.inputs[0])
    zc.inputs[6].default_value = (0.0, 0.0, 0.0, 1)
    zc.inputs[7].default_value = (0.30, 0.25, 0.19, 1)
    L(nt, zc.outputs[2], add1.inputs[7])
    kc = N(nt, "ShaderNodeMix")
    kc.data_type = "RGBA"
    L(nt, soft, kc.inputs[0])
    kc.inputs[6].default_value = (0, 0, 0, 1)
    kc.inputs[7].default_value = (5.0, 4.1, 3.0, 1)
    add2 = N(nt, "ShaderNodeMix")
    add2.data_type = "RGBA"
    add2.blend_type = "ADD"
    add2.inputs[0].default_value = 1
    L(nt, add1.outputs[2], add2.inputs[6])
    L(nt, kc.outputs[2], add2.inputs[7])
    fc = N(nt, "ShaderNodeMix")
    fc.data_type = "RGBA"
    L(nt, fl, fc.inputs[0])
    fc.inputs[6].default_value = (0, 0, 0, 1)
    fc.inputs[7].default_value = (0.25, 0.42, 0.45, 1)
    add3 = N(nt, "ShaderNodeMix")
    add3.data_type = "RGBA"
    add3.blend_type = "ADD"
    add3.inputs[0].default_value = 1
    L(nt, add2.outputs[2], add3.inputs[6])
    L(nt, fc.outputs[2], add3.inputs[7])
    L(nt, add3.outputs[2], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0


def P(pts, h):
    """Image coordinates (y down) → Blender XY (y up, camera centred on (w/2, -h/2))."""
    return [(x, -y) for x, y in pts]


def curve_obj(name, loops, extrude=0.0, bevel=0.0, fill="BOTH", closed=True, z=0.0, res=3, dim="2D", offset=0.0):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = dim
    if dim == "2D":
        cu.fill_mode = fill
    else:
        cu.fill_mode = "FULL"
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = res
    cu.offset = offset
    for loop in loops:
        sp = cu.splines.new("POLY")
        sp.points.add(len(loop) - 1)
        for p, (x, y) in zip(sp.points, loop):
            p.co = (x, y, 0, 1)
        sp.use_cyclic_u = closed
    ob = bpy.data.objects.new(name, cu)
    ob.location.z = z
    bpy.context.scene.collection.objects.link(ob)
    return ob


def stepped(x0, y0, w, h, s):
    """The ziggurat silhouette: two steps of s at each end (image coords)."""
    return [
        (x0 + 2 * s, y0), (x0 + w - 2 * s, y0), (x0 + w - 2 * s, y0 + s), (x0 + w - s, y0 + s), (x0 + w - s, y0 + 2 * s),
        (x0 + w, y0 + 2 * s), (x0 + w, y0 + h - 2 * s), (x0 + w - s, y0 + h - 2 * s), (x0 + w - s, y0 + h - s),
        (x0 + w - 2 * s, y0 + h - s), (x0 + w - 2 * s, y0 + h), (x0 + 2 * s, y0 + h), (x0 + 2 * s, y0 + h - s),
        (x0 + s, y0 + h - s), (x0 + s, y0 + h - 2 * s), (x0, y0 + h - 2 * s), (x0, y0 + 2 * s), (x0 + s, y0 + 2 * s),
        (x0 + s, y0 + s), (x0 + 2 * s, y0 + s),
    ]


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def stepped_rect(x0, y0, x1, y1, s):
    """A rectangle whose four corners are cut in one small step (the tablet silhouette)."""
    return [
        (x0 + s, y0), (x1 - s, y0), (x1 - s, y0 + s), (x1, y0 + s), (x1, y1 - s), (x1 - s, y1 - s), (x1 - s, y1),
        (x0 + s, y1), (x0 + s, y1 - s), (x0, y1 - s), (x0, y0 + s), (x0 + s, y0 + s),
    ]




def sun_lamp(strength=1.7, el=42, az=135):
    """A warm key from the upper left (the stone is diffuse, it needs a real light)."""
    ld = bpy.data.lights.new("sun", "SUN")
    ld.energy = strength
    ld.angle = math.radians(8)
    ld.color = (1.0, 0.93, 0.82)
    ob = bpy.data.objects.new("sun", ld)
    # the lamp points down -Z; tilt it so light comes from the upper left of the frame
    ob.rotation_euler = (math.radians(90 - el), 0, math.radians(az + 90))
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------- materials
def limestone(name="limestone", moss_zones=(), scale=1.0):
    """Weathered warm-grey limestone: pores, darker grime in the cavities, chipped bright
    edges, and moss where moss_zones say (list of (cx, cy, r) in object units, y down → -y)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes["Principled BSDF"]
    tc = N(nt, "ShaderNodeTexCoord")
    big = N(nt, "ShaderNodeTexNoise")
    big.inputs["Scale"].default_value = 0.06 / scale
    big.inputs["Detail"].default_value = 6
    L(nt, tc.outputs["Object"], big.inputs["Vector"])
    pore = N(nt, "ShaderNodeTexNoise")
    pore.inputs["Scale"].default_value = 0.8 / scale
    pore.inputs["Detail"].default_value = 8
    pore.inputs["Roughness"].default_value = 0.7
    L(nt, tc.outputs["Object"], pore.inputs["Vector"])
    stone = ramp(nt, big.outputs["Fac"], [(0.3, hexcol("#6f685b")), (0.55, hexcol("#8f8674")), (0.78, hexcol("#aaa08a"))])
    ao = N(nt, "ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 4.0 * scale
    ao.samples = 16
    grime = N(nt, "ShaderNodeMix")
    grime.data_type = "RGBA"
    grime.blend_type = "MULTIPLY"
    L(nt, maprange(nt, ao.outputs["AO"], 0.5, 0.99, 0.95, 0.0), grime.inputs[0])
    L(nt, stone, grime.inputs[6])
    grime.inputs[7].default_value = hexcol("#3a3127")
    col = grime.outputs[2]
    # pores: tiny dark speckles
    sp = N(nt, "ShaderNodeMix")
    sp.data_type = "RGBA"
    sp.blend_type = "MULTIPLY"
    L(nt, maprange(nt, pore.outputs["Fac"], 0.62, 0.7, 0.0, 0.35), sp.inputs[0])
    L(nt, col, sp.inputs[6])
    sp.inputs[7].default_value = hexcol("#4a4034")
    col = sp.outputs[2]
    # hairline cracks
    vc = N(nt, "ShaderNodeTexVoronoi")
    vc.feature = "DISTANCE_TO_EDGE"
    vc.inputs["Scale"].default_value = 0.09 / scale
    L(nt, tc.outputs["Object"], vc.inputs["Vector"])
    cn = N(nt, "ShaderNodeTexNoise")
    cn.inputs["Scale"].default_value = 0.08 / scale
    L(nt, tc.outputs["Object"], cn.inputs["Vector"])
    crack = math_node(nt, "MULTIPLY", maprange(nt, vc.outputs["Distance"], 0.0, 0.03, 0.75, 0.0), maprange(nt, cn.outputs["Fac"], 0.5, 0.62, 0.0, 1.0))
    ck = N(nt, "ShaderNodeMix")
    ck.data_type = "RGBA"
    ck.blend_type = "MULTIPLY"
    L(nt, crack, ck.inputs[0])
    L(nt, col, ck.inputs[6])
    ck.inputs[7].default_value = hexcol("#2a231b")
    col = ck.outputs[2]
    rough = 0.88
    if moss_zones:
        sep = N(nt, "ShaderNodeSeparateXYZ")
        L(nt, tc.outputs["Object"], sep.inputs[0])
        mz = None
        for cx, cy, r in moss_zones:
            dx = math_node(nt, "SUBTRACT", sep.outputs["X"], cx)
            dy = math_node(nt, "SUBTRACT", sep.outputs["Y"], -cy)
            d = math_node(nt, "SQRT", math_node(nt, "ADD", math_node(nt, "MULTIPLY", dx, dx), math_node(nt, "MULTIPLY", dy, dy)))
            z = maprange(nt, d, r * 0.35, r, 1.0, 0.0)
            mz = z if mz is None else math_node(nt, "MAXIMUM", mz, z)
        mn = N(nt, "ShaderNodeTexNoise")
        mn.inputs["Scale"].default_value = 0.35
        mn.inputs["Detail"].default_value = 10
        L(nt, tc.outputs["Object"], mn.inputs["Vector"])
        mask = math_node(nt, "MULTIPLY", mz, maprange(nt, mn.outputs["Fac"], 0.38, 0.55, 0.0, 1.0))
        # moss collects on top faces, not on the vertical chips
        nz = N(nt, "ShaderNodeSeparateXYZ")
        L(nt, tc.outputs["Normal"], nz.inputs[0])
        mask = math_node(nt, "MULTIPLY", mask, maprange(nt, nz.outputs["Z"], 0.55, 0.9, 0.0, 1.0))
        mcol = ramp(nt, mn.outputs["Fac"], [(0.4, hexcol("#3d5a1c")), (0.6, hexcol("#6f8f2c")), (0.75, hexcol("#9bb446"))])
        mm = N(nt, "ShaderNodeMix")
        mm.data_type = "RGBA"
        L(nt, mask, mm.inputs[0])
        L(nt, col, mm.inputs[6])
        L(nt, mcol, mm.inputs[7])
        col = mm.outputs[2]
    L(nt, col, bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = rough
    bump = N(nt, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.45
    bump.inputs["Distance"].default_value = 0.6
    hgt = math_node(nt, "ADD", math_node(nt, "MULTIPLY", pore.outputs["Fac"], 0.6), math_node(nt, "MULTIPLY", big.outputs["Fac"], 1.2))
    L(nt, hgt, bump.inputs["Height"])
    L(nt, bump.outputs["Normal"], bs.inputs["Normal"])
    return m


def gold(name="gold", scale=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes["Principled BSDF"]
    tc = N(nt, "ShaderNodeTexCoord")
    nz = N(nt, "ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.2 / scale
    nz.inputs["Detail"].default_value = 4
    L(nt, tc.outputs["Object"], nz.inputs["Vector"])
    L(nt, ramp(nt, nz.outputs["Fac"], [(0.35, hexcol("#e9a92c")), (0.65, hexcol("#ffd668"))]), bs.inputs["Base Color"])
    bs.inputs["Metallic"].default_value = 1.0
    L(nt, maprange(nt, nz.outputs["Fac"], 0.3, 0.7, 0.16, 0.3), bs.inputs["Roughness"])
    return m


def jewel(name, color, glow):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes["Principled BSDF"]
    bs.inputs["Base Color"].default_value = hexcol(color)
    bs.inputs["Roughness"].default_value = 0.06
    bs.inputs["Coat Weight"].default_value = 1.0
    bs.inputs["Coat Roughness"].default_value = 0.02
    bs.inputs["Emission Color"].default_value = hexcol(glow)
    # a glow from inside, strongest where the dome is thick (facing the camera)
    lw = N(nt, "ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.35
    L(nt, maprange(nt, lw.outputs["Facing"], 0.0, 0.8, 0.35, 0.0), bs.inputs["Emission Strength"])
    return m


PANELS = {
    # body dark, body light, edge shadow, glow (None = no glow)
    "panel": ("#2a0d06", "#4e1c0e", "#120502", None),
    "panel-hot": ("#2e0a03", "#5a1a07", "#140402", "#ff6a14"),
    "panel-jade": ("#04261a", "#0d4a33", "#021009", None),
    "panel-smoke": ("#1e1915", "#3a322a", "#0c0a08", None),
}


def panel_material(name, w, h):
    lo, hi, edge, glow = PANELS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes["Principled BSDF"]
    tc = N(nt, "ShaderNodeTexCoord")
    nz = N(nt, "ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.03
    nz.inputs["Detail"].default_value = 6
    L(nt, tc.outputs["Object"], nz.inputs["Vector"])
    fine = N(nt, "ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 0.7
    fine.inputs["Detail"].default_value = 6
    L(nt, tc.outputs["Object"], fine.inputs["Vector"])
    body = ramp(nt, nz.outputs["Fac"], [(0.3, hexcol(lo)), (0.75, hexcol(hi))])
    sep = N(nt, "ShaderNodeSeparateXYZ")
    L(nt, tc.outputs["Object"], sep.inputs[0])
    # the recess: the frame's shadow falls on the top and left, a faint bounce at the bottom
    top = maprange(nt, math_node(nt, "MULTIPLY", sep.outputs["Y"], -1.0), 0.0, 9.0, 0.85, 0.0)
    left = maprange(nt, sep.outputs["X"], 0.0, 7.0, 0.6, 0.0)
    right = maprange(nt, math_node(nt, "SUBTRACT", w, sep.outputs["X"]), 0.0, 6.0, 0.45, 0.0)
    bot = maprange(nt, math_node(nt, "ADD", sep.outputs["Y"], h), 0.0, 5.0, 0.35, 0.0)
    sh = math_node(nt, "MAXIMUM", math_node(nt, "MAXIMUM", top, left), math_node(nt, "MAXIMUM", right, bot))
    mx = N(nt, "ShaderNodeMix")
    mx.data_type = "RGBA"
    L(nt, sh, mx.inputs[0])
    L(nt, body, mx.inputs[6])
    mx.inputs[7].default_value = hexcol(edge)
    L(nt, mx.outputs[2], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.78
    bump = N(nt, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    L(nt, fine.outputs["Fac"], bump.inputs["Height"])
    L(nt, bump.outputs["Normal"], bs.inputs["Normal"])
    if glow:
        # seams of ember in the stone, brightest low in the middle: the way is breaking
        mp = N(nt, "ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (0.02, 0.05, 0.1)
        L(nt, tc.outputs["Object"], mp.inputs["Vector"])
        vo = N(nt, "ShaderNodeTexVoronoi")
        vo.feature = "DISTANCE_TO_EDGE"
        L(nt, mp.outputs["Vector"], vo.inputs["Vector"])
        seam = maprange(nt, vo.outputs["Distance"], 0.0, 0.018, 1.0, 0.0)
        wob = N(nt, "ShaderNodeTexNoise")
        wob.inputs["Scale"].default_value = 0.05
        L(nt, tc.outputs["Object"], wob.inputs["Vector"])
        seam = math_node(nt, "MULTIPLY", seam, maprange(nt, wob.outputs["Fac"], 0.5, 0.66, 0.0, 1.0))
        under = maprange(nt, math_node(nt, "ADD", sep.outputs["Y"], h), 0.0, h, 0.16, 0.0)
        e = math_node(nt, "ADD", math_node(nt, "MULTIPLY", seam, 3.2), under)
        e = math_node(nt, "MULTIPLY", e, math_node(nt, "SUBTRACT", 1.0, sh))
        bs.inputs["Emission Color"].default_value = hexcol(glow)
        L(nt, e, bs.inputs["Emission Strength"])
    return m


def plane(name, x0, y0, x1, y1, z, mat):
    import bmesh
    bm = bmesh.new()
    vs = [bm.verts.new((x, -y, z)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
    bm.faces.new(vs)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def render(name):
    path = os.path.join(OUT, name + ".webp")
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("wrote", path, flush=True)


def chipped(pts, rng, step=3.0, depth=0.9, bites=0.06):
    """Subdivide a closed polygon and nibble its edge: worn stone, never a ruler line."""
    out = []
    n = len(pts)
    for i in range(n):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
        L_ = math.hypot(x1 - x0, y1 - y0)
        k = max(1, int(L_ / step))
        nx, ny = (y1 - y0) / (L_ or 1), -(x1 - x0) / (L_ or 1)
        for j in range(k):
            t = j / k
            d = rng.uniform(0, depth) if j else 0.0
            if j and rng.random() < bites:
                d += rng.uniform(1.0, 2.4) * depth
            out.append((x0 + (x1 - x0) * t - nx * d, y0 + (y1 - y0) * t - ny * d))
    return out


# ---------------------------------------------------------------- the key (xicalcoliuhqui hook)
def key_hook(x, y, s, flip_x=False, flip_y=False):
    """A square spiral hook in an s×s cell (image coords)."""
    u = s / 6.0
    pts = [(0, 6), (0, 0), (6, 0), (6, 4), (2, 4), (2, 2), (4, 2)]
    out = []
    for px, py in pts:
        if flip_x:
            px = 6 - px
        if flip_y:
            py = 6 - py
        out.append((x + px * u, y + py * u))
    return out


# ---------------------------------------------------------------- assets
def plate_frame():
    """The hero frame. 480×96 CSS: 28-wide end caps carry the keys and the moss and are
    sliced as half-height corners, so they scale with the plate height and never stretch;
    the 16-high bands between them stretch on x (they are plain worn stone)."""
    import random
    W, H, FX, FY = 480, 96, 34, 17
    scene(W, H)
    sun_lamp()
    rng = random.Random(5)
    moss = [(8, 5, 22), (W - 8, 5, 22), (36, 2, 12), (W - 40, 2, 12), (6, 30, 9), (W - 6, 28, 10)]
    st = limestone("frame", moss_zones=moss)
    s = 6
    outer = chipped(stepped(0.8, 0.8, W - 1.6, H - 1.6, s), rng)
    inner = chipped(rect(FX, FY, W - FX, H - FY), rng, depth=0.5, bites=0.03)
    fr = curve_obj("frame", [P(outer, H), P(inner, H)], extrude=3.0, bevel=1.6, offset=-1.6, z=3.0, res=3)
    fr.data.materials.append(st)
    # carved relief: a key hook top and bottom on each end cap, and a bar between them
    hooks = []
    for xx, fx in ((6, False), (W - 6 - 22, True)):
        hooks.append(key_hook(xx, 13, 22, flip_x=fx))
        hooks.append(key_hook(xx, H - 13 - 22, 22, flip_x=fx, flip_y=True))
    rel = curve_obj("keys", [P(hk, H) for hk in hooks], bevel=2.3, closed=False, z=6.9, dim="3D", res=2)
    rel.data.materials.append(st)
    bars = [[(17, 40), (17, H - 40)], [(W - 17, 40), (W - 17, H - 40)]]
    b = curve_obj("bars", [P(x, H) for x in bars], bevel=2.3, closed=False, z=6.9, dim="3D", res=2)
    b.data.materials.append(st)
    # a carved line running along each band
    lines = [[(FX + 4, 8), (W - FX - 4, 8)], [(FX + 4, H - 8), (W - FX - 4, H - 8)]]
    ln = curve_obj("lines", [P(x, H) for x in lines], bevel=0.9, closed=False, z=5.3, dim="3D", res=2)
    ln.data.materials.append(st)
    # tufts of moss on the top corners (geometry, so they break the silhouette a little)
    mm = limestone("moss", moss_zones=[(x, y, 60) for x, y, _ in moss])
    import bmesh
    bm = bmesh.new()
    for cx, cy, r in moss:
        for _ in range(int(r * 5)):
            a = rng.uniform(0, math.tau)
            d = abs(rng.gauss(0, r * 0.38))
            x, y = cx + math.cos(a) * d * 1.4, cy + abs(math.sin(a)) * d * 0.7
            rr = rng.uniform(0.9, 2.2)
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rr, matrix=Matrix.Translation((x, -y, 6.0 + rng.uniform(-0.6, 0.6))))
    me = bpy.data.meshes.new("tufts")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("tufts", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mm)
    render("plate-frame")


def panel(name):
    W, H = 480, 64
    scene(W, H)
    sun_lamp(1.2)
    plane("p", 0, 0, W, H, 0, panel_material(name, W, H))
    render(name)


def tablet(name, pname):
    """The secondary tablet: a 4 px worn limestone rim with stepped corners around the
    red-brown (or jade) panel. 96×48 CSS, sliced 8 px."""
    import random
    W, H, s = 96, 48, 3
    scene(W, H)
    sun_lamp(1.5)
    rng = random.Random(9)
    st = limestone("rim", scale=0.6)
    outer = chipped(stepped_rect(0.5, 0.5, W - 0.5, H - 0.5, s), rng, step=2.0, depth=0.4, bites=0.04)
    inner = stepped_rect(4.2, 4.2, W - 4.2, H - 4.2, 2)
    rim = curve_obj("rim", [P(outer, H), P(inner, H)], extrude=1.4, bevel=0.8, offset=-0.8, z=1.4, res=2)
    rim.data.materials.append(st)
    plane("p", 3.6, 3.6, W - 3.6, H - 3.6, 0.2, panel_material(pname, W, H))
    render(name)


def crest():
    """Gold crest for the primary plate: a red cabochon in a stepped gold bezel, flanked by
    two green ones, with stepped fret wings. 128×52 CSS."""
    W, H = 128, 52
    scene(W, H)
    sun_lamp(1.5)
    g = gold()
    cx = W / 2
    # wings: stepped fret scrolls
    wing = [(cx - 14, 20), (cx - 52, 20), (cx - 52, 26), (cx - 62, 26), (cx - 62, 38), (cx - 50, 38), (cx - 50, 32), (cx - 40, 32), (cx - 40, 40), (cx - 14, 40)]
    for side in (1, -1):
        pts = [(cx + (x - cx) * side, y) for x, y in wing]
        if side < 0:
            pts = pts[::-1]
        o = curve_obj("wing", [P(pts, H)], extrude=2.0, bevel=1.6, offset=-1.6, z=2.0, res=3)
        o.data.materials.append(g)
        # a groove line in each wing
        gl = curve_obj("wl", [P([(cx + (x - cx) * side, y) for x, y in [(cx - 18, 30), (cx - 46, 30)]], H)], bevel=0.8, closed=False, z=4.6, dim="3D", res=2)
        gl.data.materials.append(g)
    # central bezel: an inverted teardrop (point up), with a knob on top
    def drop(cx, cy, rx, ry, n=40):
        pts = []
        for i in range(n):
            t = i / n * math.tau
            x = math.sin(t) * rx * (0.62 + 0.38 * (1 - math.cos(t)) / 2) if False else math.sin(t) * rx
            y = -math.cos(t) * ry
            # pinch the top into a point
            k = max(0.0, -math.cos(t))
            x *= 1 - 0.55 * k ** 1.6
            pts.append((cx + x, cy + y))
        return pts
    bez = curve_obj("bezel", [P(drop(cx, 27, 15, 21), H)], extrude=3.0, bevel=2.0, offset=-2.0, z=3.0, res=3)
    bez.data.materials.append(g)
    red = curve_obj("ruby", [P(drop(cx, 28, 10, 15.5), H)], extrude=1.0, bevel=4.2, offset=-4.2, z=6.0, res=6)
    red.data.materials.append(jewel("ruby", "#6a0710", "#ff2a2a"))
    for side in (-1, 1):
        x = cx + side * 27
        b2 = curve_obj("b2", [P(drop(x, 29, 7.5, 10), H)], extrude=2.2, bevel=1.4, offset=-1.4, z=2.6, res=3)
        b2.data.materials.append(g)
        gm = curve_obj("em", [P(drop(x, 29.5, 4.8, 6.8), H)], extrude=0.6, bevel=2.6, offset=-2.6, z=4.6, res=6)
        gm.data.materials.append(jewel("emer", "#0a6a38", "#2bd47a"))
    knob = curve_obj("knob", [P(rect(cx - 5, 1.5, cx + 5, 7.5), H)], extrude=1.8, bevel=1.4, offset=-1.4, z=2.0, res=3)
    knob.data.materials.append(g)
    render("crest")


def pendant():
    """Gold fret pendant hung under the primary plate. 88×28 CSS."""
    W, H = 88, 28
    scene(W, H)
    sun_lamp(1.5)
    g = gold()
    cx = W / 2
    body = [(4, 2), (W - 4, 2), (W - 4, 8), (W - 16, 8), (W - 16, 14), (cx + 12, 14), (cx + 6, 26), (cx - 6, 26), (cx - 12, 14), (16, 14), (16, 8), (4, 8)]
    o = curve_obj("pend", [P(body, H)], extrude=1.8, bevel=1.4, offset=-1.4, z=1.8, res=3)
    o.data.materials.append(g)
    ring = [(cx + 5.5 * math.cos(i / 32 * math.tau), 12 + 5.5 * math.sin(i / 32 * math.tau)) for i in range(32)]
    r = curve_obj("ring", [P(ring, H)], bevel=1.6, closed=True, z=4.6, dim="3D", res=3)
    r.data.materials.append(g)
    hole = curve_obj("hole", [P([(cx + 3.2 * math.cos(i / 24 * math.tau), 12 + 3.2 * math.sin(i / 24 * math.tau)) for i in range(24)], H)], extrude=0.3, z=4.4)
    hole.data.materials.append(jewel("ruby2", "#5a0a0c", "#ff3a2a"))
    for side in (-1, 1):
        gl = curve_obj("pl", [P([(cx + side * 16, 5), (cx + side * 38, 5)], H)], bevel=0.7, closed=False, z=3.8, dim="3D", res=2)
        gl.data.materials.append(g)
    render("pendant")


def leaves():
    """A tuft of jungle leaves to tuck behind a plate end. 72×96 CSS (mirrored for the other side)."""
    import bmesh
    W, H = 72, 96
    scene(W, H)
    sun_lamp(3.0)
    m = bpy.data.materials.new("leaf")
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes["Principled BSDF"]
    tc = N(nt, "ShaderNodeTexCoord")
    sepu = N(nt, "ShaderNodeSeparateXYZ")
    L(nt, tc.outputs["UV"], sepu.inputs[0])
    L(nt, ramp(nt, sepu.outputs["X"], [(0.0, hexcol("#123d14")), (0.6, hexcol("#2b6f22")), (1.0, hexcol("#5ea12e"))]), bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.45
    bs.inputs["Subsurface Weight"].default_value = 0.0
    specs = [(60, 62, 62, 140, 0.0), (62, 70, 56, 118, 0.3), (64, 56, 50, 162, -0.25), (62, 78, 46, 98, 0.2), (66, 66, 40, 185, -0.1)]
    for i, (bx, by, ln, ang, tw) in enumerate(specs):
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new()
        segs, cols = 14, 6
        grid = []
        for a in range(segs + 1):
            t = a / segs
            wdt = math.sin(math.pi * t) ** 0.8 * ln * 0.2
            row = []
            for b in range(cols + 1):
                v = b / cols * 2 - 1
                x = t * ln
                y = v * wdt
                z = -abs(v) * wdt * 0.35 + math.sin(t * math.pi) * 3
                row.append(bm.verts.new((x, y, z)))
            grid.append(row)
        for a in range(segs):
            for b in range(cols):
                f = bm.faces.new((grid[a][b], grid[a + 1][b], grid[a + 1][b + 1], grid[a][b + 1]))
                for lp in f.loops:
                    # u along the leaf (dark at the stem), v across
                    co = lp.vert.co
                    lp[uv].uv = (co.x / ln, 0.5)
        me = bpy.data.meshes.new("leaf%d" % i)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new("leaf%d" % i, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.data.materials.append(m)
        ob.location = (bx, -by, 4 + i)
        ob.rotation_euler = (tw, 0, math.radians(ang))
        for p in me.polygons:
            p.use_smooth = True
        # midrib
        rib = curve_obj("rib%d" % i, [[(0, 0), (ln * 0.92, 0)]], bevel=0.45, closed=False, dim="3D", res=1)
        rib.location = (bx, -by, 4 + i + 1.6)
        rib.rotation_euler = (tw, 0, math.radians(ang))
        rib.data.materials.append(m)
    render("leaves")


def fret_strip():
    W, H = 256, 12
    scene(W, H)
    sun_lamp(1.4)
    g = gold("fretgold", scale=0.6)
    pats = []
    x = -16
    while x < W + 16:
        pats.append(P(key_hook(x + 2, 2.5, 7, flip_y=False) + [(x + 2, 9.5), (x + 16, 9.5)], H))
        x += 16
    o = curve_obj("fret", pats, bevel=0.75, closed=False, z=1.4, dim="3D", res=2)
    o.data.materials.append(g)
    rails = curve_obj("rails", [P([(-20, 0.9), (W + 20, 0.9)], H), P([(-20, 11.1), (W + 20, 11.1)], H)], bevel=0.7, closed=False, z=1.2, dim="3D", res=2)
    rails.data.materials.append(g)
    bk = plane("back", -20, 0.5, W + 20, H - 0.5, 0.0, panel_material("panel", W + 40, H))
    render("fret")


def stud():
    W, H = 32, 32
    scene(W, H)
    sun_lamp(1.5)
    g = gold("studgold", scale=0.5)
    ring = [(16 + 14.5 * math.cos(i / 48 * math.tau), 16 + 14.5 * math.sin(i / 48 * math.tau)) for i in range(48)]
    st = curve_obj("boss", [P(ring, H)], extrude=1.6, bevel=2.4, offset=-2.4, z=1.6, res=5)
    st.data.materials.append(g)
    gemr = [(16 + 7.5 * math.cos(i / 40 * math.tau), 16 + 7.5 * math.sin(i / 40 * math.tau)) for i in range(40)]
    gm = curve_obj("gem", [P(gemr, H)], extrude=0.5, bevel=3.4, offset=-3.4, z=4.4, res=6)
    gm.data.materials.append(jewel("ruby3", "#8a0d12", "#ff2a2a"))
    render("stud")


JOBS = {
    "frame": plate_frame,
    "panel": lambda: panel("panel"),
    "panel-hot": lambda: panel("panel-hot"),
    "panel-jade": lambda: panel("panel-jade"),
    "panel-smoke": lambda: panel("panel-smoke"),
    "tablet": lambda: tablet("tablet", "panel"),
    "tablet-jade": lambda: tablet("tablet-jade", "panel-jade"),
    "crest": crest,
    "pendant": pendant,
    "leaves": leaves,
    "fret": fret_strip,
    "stud": stud,
}
for k, fn in JOBS.items():
    if ONLY and k not in ONLY:
        continue
    fn()
