"""Foliage: leaves are modelled, rendered top-down into an alpha atlas, then used on cards.

Atlas layout (2048², UV origin bottom-left):
  frond     u 0.0–0.5, v 0.5–1.0     (tip at top)
  fern      u 0.5–1.0, v 0.5–1.0
  broadleaf u 0.0–0.5, v 0.0–0.5
  vine      u 0.5–0.75, v 0.0–0.5    (hangs downward)
  grass     u 0.75–1.0, v 0.0–0.5    (base at bottom)
"""
import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Vector, Matrix, Euler, noise

from common import CACHE, N, L, nodes_clear, hexcol, link, new_mesh_obj

CELLS = {
    "frond": (0.0, 0.5, 0.5, 1.0),
    "fern": (0.5, 0.5, 1.0, 1.0),
    "broad": (0.0, 0.0, 0.5, 0.5),
    "vine": (0.5, 0.0, 0.75, 0.5),
    "grass": (0.75, 0.0, 1.0, 0.5),
}

LEAF_GREENS = ["#4e6b25", "#5f7a2a", "#6f8a33", "#3f5a1f", "#7b8f3a", "#566f28"]


def _leaf_material():
    m = bpy.data.materials.new("leafpaint")
    nt = nodes_clear(m)
    out = N(nt, "ShaderNodeOutputMaterial")
    em = N(nt, "ShaderNodeEmission", Strength=1.0)
    L(nt, em.outputs[0], out.inputs[0])
    vc = N(nt, "ShaderNodeVertexColor", _layer_name="Col")
    tc = N(nt, "ShaderNodeTexCoord")
    nz = N(nt, "ShaderNodeTexNoise", Scale=40.0, Detail=6.0)
    L(nt, tc.outputs["Object"], nz.inputs["Vector"])
    mx = nt.nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mx.blend_type = "MULTIPLY"
    mx.inputs[0].default_value = 0.35
    L(nt, vc.outputs[0], mx.inputs[6])
    L(nt, nz.outputs[1], mx.inputs[7])
    L(nt, mx.outputs[2], em.inputs[0])
    return m


def _add_colored(bm_target, bm_src, color_fn):
    cl = bm_src.loops.layers.float_color.new("Col")
    for f in bm_src.faces:
        for l in f.loops:
            l[cl] = color_fn(l.vert.co)
    me = bpy.data.meshes.new("_t")
    bm_src.to_mesh(me)
    bm_src.free()
    bm_target.from_mesh(me)
    bpy.data.meshes.remove(me)


def _leaflet(bm, base, direction, length, width, color, seg=5, curl=0.0):
    """A lanceolate leaf as a strip of quads in the XY plane."""
    t = bmesh.new()
    d = Vector(direction).normalized()
    side = Vector((-d.y, d.x, 0))
    rows = []
    for i in range(seg + 1):
        s = i / seg
        w = width * math.sin(math.pi * min(1, s * 1.1)) ** 0.8 * (1 - 0.15 * s)
        c = Vector(base) + d * length * s + side * curl * s * s
        rows.append((t.verts.new(c - side * w / 2), t.verts.new(c), t.verts.new(c + side * w / 2)))
    for i in range(seg):
        a, b = rows[i], rows[i + 1]
        t.faces.new((a[0], a[1], b[1], b[0]))
        t.faces.new((a[1], a[2], b[2], b[1]))
    tip = Vector(base) + d * length

    def col(co):
        s = (co - Vector(base)).length / length
        mid = 1 - min(1, abs((co - (Vector(base) + d * (co - Vector(base)).dot(d))).length) / (width / 2 + 1e-6))
        k = 0.8 + 0.35 * s + 0.12 * mid
        return (color[0] * k, color[1] * k, color[2] * k * 0.95, 1)

    _add_colored(bm, t, col)


def build_frond(rng):
    bm = bmesh.new()
    # Rachis.
    _leaflet(bm, (0, -0.98, 0), (0, 1, 0), 1.9, 0.035, hexcol("#8a7a3a"), seg=4)
    n = 46
    for i in range(n):
        s = i / n
        y = -0.95 + 1.85 * s
        L_ = 0.62 * math.sin(math.pi * (0.12 + 0.88 * s)) ** 0.7 + 0.05
        for side in (-1, 1):
            ang = math.radians(rng.uniform(28, 42))
            dirv = (side * math.sin(ang), math.cos(ang), 0)
            c = hexcol(rng.choice(LEAF_GREENS))
            if rng.random() < 0.15 + 0.3 * s:
                c = hexcol(rng.choice(["#8f9440", "#a39a48", "#7d8a36"]))
            _leaflet(bm, (0, y, 0), dirv, L_, 0.045 + 0.015 * rng.random(), c, seg=4, curl=side * rng.uniform(-0.08, 0.02))
    return bm


def build_fern(rng):
    bm = bmesh.new()
    for k in range(9):
        a = math.radians(-70 + 140 * k / 8 + rng.uniform(-6, 6))
        d = Vector((math.sin(a), math.cos(a), 0))
        ln = rng.uniform(0.7, 0.95)
        base = Vector((0, -0.95, 0))
        _leaflet(bm, base, d, ln * 1.95, 0.02, hexcol("#56662a"), seg=3)
        m = 22
        for i in range(2, m):
            s = i / m
            p = base + d * ln * 1.95 * s
            side_len = 0.2 * math.sin(math.pi * s) + 0.03
            for sd in (-1, 1):
                sv = Vector((-d.y, d.x, 0)) * sd
                dd = (sv * 0.8 + d * 0.6).normalized()
                _leaflet(bm, p, dd, side_len, 0.05, hexcol(rng.choice(LEAF_GREENS)), seg=3)
    return bm


def build_broad(rng):
    bm = bmesh.new()
    for k in range(7):
        a = math.radians(rng.uniform(-60, 60))
        d = Vector((math.sin(a), math.cos(a), 0))
        base = Vector((rng.uniform(-0.2, 0.2), -0.9 + rng.uniform(0, 0.4), 0))
        ln = rng.uniform(0.9, 1.3)
        c = hexcol(rng.choice(["#3d5a1d", "#4a6b22", "#577a2a", "#35501a"]))
        _leaflet(bm, base, d, ln, rng.uniform(0.5, 0.7), c, seg=8, curl=rng.uniform(-0.1, 0.1))
    return bm


def build_vine(rng):
    bm = bmesh.new()
    for strand in range(3):
        x0 = -0.28 + 0.28 * strand + rng.uniform(-0.05, 0.05)
        y = 0.98
        x = x0
        while y > -0.95:
            ny = y - 0.08
            nx = x + rng.uniform(-0.02, 0.02)
            _leaflet(bm, (x, y, 0), (nx - x, ny - y, 0), 0.085, 0.012, hexcol("#4f5a28"), seg=1)
            if rng.random() < 0.8:
                for sd in (-1, 1):
                    if rng.random() < 0.7:
                        a = math.radians(rng.uniform(200, 250) if sd < 0 else rng.uniform(-70, -20))
                        _leaflet(bm, (x, y, 0), (math.cos(a), math.sin(a), 0), rng.uniform(0.06, 0.1), 0.06,
                                 hexcol(rng.choice(LEAF_GREENS)), seg=3)
            # Flowering vines: small five-petalled blooms, warm against the green.
            if rng.random() < 0.16:
                _flower(bm, (x + rng.uniform(-0.04, 0.04), y, 0.02), rng.uniform(0.035, 0.05), rng.choice(FLOWERS))
            x, y = nx, ny
    return bm


FLOWERS = ["#e8577a", "#f08a4b", "#f4d9e2", "#d9406a", "#f5b642"]


def _flower(bm, c, r, col):
    base = hexcol(col)
    for k in range(5):
        a = 2 * math.pi * k / 5
        _leaflet(bm, c, (math.cos(a), math.sin(a), 0), r, r * 0.9, base, seg=2)
    _leaflet(bm, (c[0] - r * 0.15, c[1], c[2] + 0.01), (1, 0, 0), r * 0.3, r * 0.35, hexcol("#f2d24a"), seg=1)


def build_grass(rng):
    bm = bmesh.new()
    for k in range(38):
        x = rng.uniform(-0.35, 0.35)
        a = math.radians(rng.uniform(-28, 28))
        d = Vector((math.sin(a) + x * 0.4, math.cos(a), 0))
        c = hexcol(rng.choice(LEAF_GREENS + ["#8a8a45", "#9a9248"]))
        _leaflet(bm, (x, -0.98, 0), d, rng.uniform(0.9, 1.85), rng.uniform(0.03, 0.06), c, seg=5,
                 curl=rng.uniform(-0.25, 0.25))
    return bm


def render_atlas(size=2048):
    rng = random.Random(7)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 8
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.world = bpy.data.worlds.new("black")
    mat = _leaf_material()
    atlas = np.zeros((size, size, 4), np.float32)
    builders = {"frond": build_frond, "fern": build_fern, "broad": build_broad, "vine": build_vine, "grass": build_grass}
    for key, fn in builders.items():
        bm = fn(rng)
        ob = new_mesh_obj(f"leaf_{key}", bm)
        ob.data.materials.append(mat)
        u0, v0, u1, v1 = CELLS[key]
        w, h = int((u1 - u0) * size), int((v1 - v0) * size)
        cd = bpy.data.cameras.new("c")
        cd.type = "ORTHO"
        aspect = w / h
        cd.ortho_scale = 2.0 * max(1.0, aspect)
        co = bpy.data.objects.new("c", cd)
        co.location = (0, 0, 5)
        link(co)
        sc.camera = co
        sc.render.resolution_x, sc.render.resolution_y = w, h
        # Narrow cells show x ∈ [-aspect, aspect]; scale geometry to fill them.
        if aspect < 1:
            ob.scale = (aspect, 1, 1)
        path = os.path.join(CACHE, f"leaf_{key}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.array(img.pixels[:], np.float32).reshape(h, w, 4)
        atlas[int(v0 * size):int(v0 * size) + h, int(u0 * size):int(u0 * size) + w] = px
        bpy.data.images.remove(img)
        bpy.data.objects.remove(ob)
        bpy.data.objects.remove(co)
    # Bleed colour into transparent texels so mipmaps don't fringe black.
    rgb = atlas[:, :, :3]
    a = atlas[:, :, 3:4]
    filled = rgb.copy()
    mask = a[:, :, 0] > 0.5
    for _ in range(24):
        acc = np.zeros_like(filled)
        cnt = np.zeros(mask.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m2 = np.roll(mask, (dy, dx), (0, 1))
            acc += np.roll(filled, (dy, dx), (0, 1)) * m2[:, :, None]
            cnt += m2
        grow = (~mask) & (cnt > 0)
        filled[grow] = acc[grow] / cnt[grow][:, None]
        mask = mask | grow
    atlas[:, :, :3] = np.where(a > 0.5, rgb, filled)
    im = bpy.data.images.new("foliage_atlas", size, size, alpha=True)
    im.pixels[:] = atlas.ravel()
    im.filepath_raw = os.path.join(CACHE, "foliage_color.png")
    im.file_format = "PNG"
    im.save()
    sc.render.film_transparent = False
    return im


# ---------------------------------------------------------------- card meshes
def _card(bm, uvl, cell, p0, dir_len, width, droop=0.0, seg=6, twist=0.0, up=Vector((0, 0, 1)), flip_v=False):
    """A curved card from p0 along dir (length = |dir_len|); UVs map to `cell`."""
    u0, v0, u1, v1 = CELLS[cell]
    d = Vector(dir_len)
    ln = d.length
    d.normalize()
    side = d.cross(up)
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side.normalize()
    normal = side.cross(d)
    rows = []
    for i in range(seg + 1):
        s = i / seg
        c = Vector(p0) + d * ln * s - up * droop * s * s * ln
        sv = (Matrix.Rotation(twist * s, 3, d) @ side) * width / 2
        rows.append((bm.verts.new(c - sv), bm.verts.new(c + sv), s))
    for i in range(seg):
        a, b = rows[i], rows[i + 1]
        f = bm.faces.new((a[0], a[1], b[1], b[0]))
        for loop, (uu, ss) in zip(f.loops, ((0, a[2]), (1, a[2]), (1, b[2]), (0, b[2]))):
            vv = ss if not flip_v else 1 - ss
            loop[uvl].uv = (u0 + (u1 - u0) * uu, v0 + (v1 - v0) * vv)


def _trunk(bm, path_pts, radii, segs=10):
    prev = None
    for c, r in zip(path_pts, radii):
        ring = [bm.verts.new(c + Vector((math.cos(2 * math.pi * j / segs) * r, math.sin(2 * math.pi * j / segs) * r, 0)))
                for j in range(segs)]
        if prev:
            for j in range(segs):
                bm.faces.new((prev[j], prev[(j + 1) % segs], ring[(j + 1) % segs], ring[j]))
        prev = ring


def palm(name, seed, height=9.0):
    """Returns (trunk, crown). The trunk takes the bark material, the crown the foliage atlas."""
    rng = random.Random(seed)
    bend = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)).normalized() * rng.uniform(0.8, 2.2)
    rings = 22
    pts = [bend * ((i / rings) ** 2) + Vector((0, 0, height * i / rings)) for i in range(rings + 1)]
    rad = [0.3 * (1 - 0.4 * i / rings) + (0.035 if i % 2 else 0) + (0.12 * (1 - i / 3) if i < 3 else 0) for i in range(rings + 1)]
    tb = bmesh.new()
    _trunk(tb, pts, rad)
    trunk = new_mesh_obj(name + "_trunk", tb)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    top = pts[-1]
    n = rng.randint(13, 17)
    for k in range(n):
        a = 2 * math.pi * k / n + rng.uniform(-0.2, 0.2)
        el = rng.uniform(-0.15, 0.55) if k % 3 else rng.uniform(0.6, 1.0)
        d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
        _card(bm, uvl, "frond", top, d * rng.uniform(3.4, 4.6), rng.uniform(1.9, 2.4), droop=rng.uniform(0.25, 0.5),
              seg=7, twist=rng.uniform(-0.4, 0.4))
    crown = new_mesh_obj(name + "_crown", bm)
    return trunk, crown


def bush(name, seed, radius=1.2, cells=("fern", "broad"), n=14):
    rng = random.Random(seed)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    for k in range(n):
        a = rng.uniform(0, 2 * math.pi)
        el = rng.uniform(0.25, 1.2)
        d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
        base = Vector((rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), rng.uniform(0, 0.15)))
        _card(bm, uvl, rng.choice(cells), base, d * radius * rng.uniform(0.8, 1.2), radius * rng.uniform(0.8, 1.1),
              droop=rng.uniform(0.1, 0.35), seg=4, twist=rng.uniform(-0.3, 0.3))
    return new_mesh_obj(name, bm)


def grass(name, seed, n=5, spread=0.5):
    rng = random.Random(seed)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    for k in range(n):
        base = Vector((rng.uniform(-spread, spread), rng.uniform(-spread, spread), -0.05))
        for c in range(2):
            a = rng.uniform(0, math.pi) + c * math.pi / 2
            side = Vector((math.cos(a), math.sin(a), 0))
            h = rng.uniform(0.45, 0.8)
            _card(bm, uvl, "grass", base, (0, 0, h), h * 0.9, seg=2, up=side)
    return new_mesh_obj(name, bm)


def vines(name, seed, width=4.0, n=7, length=(1.2, 3.0)):
    """A curtain of hanging vines along X, hanging from z=0 downwards, facing -Y (toward the runner)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    for k in range(n):
        x = -width / 2 + width * (k + rng.uniform(0.1, 0.9)) / n
        ln = rng.uniform(*length)
        _card(bm, uvl, "vine", (x, rng.uniform(-0.1, 0.1), 0), (rng.uniform(-0.1, 0.1), rng.uniform(-0.2, 0.05), -ln),
              ln * 0.45, seg=5, up=Vector((0, -1, 0)), flip_v=True)
    return new_mesh_obj(name, bm)


def jungle_tree(name, seed, height=12.0):
    rng = random.Random(seed)
    lean = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.6
    pts = [lean * (i / 8) + Vector((0, 0, height * 0.72 * i / 8)) for i in range(9)]
    rad = [0.45 * (1 - 0.6 * i / 8) + 0.3 * (1 - i / 8) ** 6 for i in range(9)]
    tb = bmesh.new()
    _trunk(tb, pts, rad, 8)
    trunk = new_mesh_obj(name + "_trunk", tb)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    top = pts[-1]
    for cl in range(rng.randint(5, 7)):
        cc = top + Vector((rng.uniform(-2.5, 2.5), rng.uniform(-2.5, 2.5), rng.uniform(-1.5, 2.0)))
        for k in range(9):
            a = rng.uniform(0, 2 * math.pi)
            el = rng.uniform(-0.3, 1.0)
            d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
            _card(bm, uvl, "broad", cc - d * 0.4, d * rng.uniform(2.0, 2.8), rng.uniform(2.0, 2.6), droop=0.2, seg=3,
                  twist=rng.uniform(-0.5, 0.5))
    return trunk, new_mesh_obj(name + "_crown", bm)
