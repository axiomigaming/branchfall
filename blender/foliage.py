"""Foliage: leaves are modelled, rendered into an alpha atlas, then used on cards.

Atlas layout (2048², UV origin bottom-left). Single leaves (frond, fern, vine, grass, banana) are
modelled flat; the clusters (cluster, broad, cluster_s, drape) are modelled in 3D — a few hundred
leaves on lumpy sub-domes — and rendered lit from above-front, so each card already carries its own
self-shadowing: bright crowns, dark hollows between the lobes. A handful of such cards around a
centre (with normals pointing out of that centre, see jungle.py) reads as a soft volume.

  frond     u 0.0–0.5,   v 0.5–1.0    palm frond (tip at top)
  cluster   u 0.5–1.0,   v 0.5–1.0    big broadleaf mass (top at top)
  fern      u 0.0–0.25,  v 0.25–0.5
  broad     u 0.25–0.5,  v 0.25–0.5   broadleaf cluster (the old single-leaf cell, now a small mass)
  cluster_s u 0.5–0.75,  v 0.25–0.5   fine-leaved mass (ivy, bushes)
  banana    u 0.75–1.0,  v 0.0–0.5    one torn banana leaf (base at bottom; squeezed ×0.5 in u)
  drape     u 0.0–0.5,   v 0.0–0.25   leafy mass with vines hanging below it (wide)
  vine      u 0.5–0.625, v 0.0–0.25   (hangs downward)
  grass     u 0.625–0.75,v 0.0–0.25   (base at bottom)
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
    "cluster": (0.5, 0.5, 1.0, 1.0),
    "fern": (0.0, 0.25, 0.25, 0.5),
    "broad": (0.25, 0.25, 0.5, 0.5),
    "cluster_s": (0.5, 0.25, 0.75, 0.5),
    "banana": (0.75, 0.0, 1.0, 0.5),
    "drape": (0.0, 0.0, 0.5, 0.25),
    "vine": (0.5, 0.0, 0.625, 0.25),
    "grass": (0.625, 0.0, 0.75, 0.25),
}

LEAF_GREENS = ["#4a7024", "#5a842a", "#6c9432", "#3b5c1e", "#7a9638", "#527a28"]


def _leaf_material(lit=True):
    """Clusters are lit (they must carry their own self-shadowing into the atlas: bright crowns, dark
    hollows); single flat leaves are painted flat (coplanar blades would shadow each other)."""
    m = bpy.data.materials.new("leafpaint_lit" if lit else "leafpaint")
    nt = nodes_clear(m)
    out = N(nt, "ShaderNodeOutputMaterial")
    if lit:
        em = N(nt, "ShaderNodeBsdfDiffuse")
        tr = N(nt, "ShaderNodeBsdfTranslucent")
        mixs = N(nt, "ShaderNodeMixShader", Fac=0.25)
        L(nt, em.outputs[0], mixs.inputs[1])
        L(nt, tr.outputs[0], mixs.inputs[2])
        L(nt, mixs.outputs[0], out.inputs[0])
    else:
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
    if lit:
        L(nt, mx.outputs[2], tr.inputs[0])
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


# ---------------------------------------------------------------- 3D clusters (rendered lit)
CANOPY_GREENS = ["#3f6a1f", "#4d7a24", "#5b8a2a", "#355a1a", "#6a9630", "#47702a", "#2f5218", "#76a034"]


def _leaf3d(bm, base, d, nrm, length, width, color, seg=4, fold=0.12, droop=0.15, light=1.0):
    """A leaf blade in 3D: ovate, pointed, its two halves folded up along the midrib, its tip drooping."""
    t = bmesh.new()
    d = Vector(d).normalized()
    side = d.cross(Vector(nrm)).normalized()
    up = side.cross(d).normalized()
    rows = []
    for i in range(seg + 1):
        s = i / seg
        w = width * (math.sin(math.pi * min(1.0, s * 1.05)) ** 0.75) * (1.0 - 0.25 * s)
        c = Vector(base) + d * length * s - up * droop * length * s * s
        e = up * fold * w * -0.5
        rows.append((t.verts.new(c - side * w / 2 + e), t.verts.new(c), t.verts.new(c + side * w / 2 + e)))
    for i in range(seg):
        a, b = rows[i], rows[i + 1]
        t.faces.new((a[0], a[1], b[1], b[0]))
        t.faces.new((a[1], a[2], b[2], b[1]))
    b0 = Vector(base)

    def col(co):
        s = min(1.0, (co - b0).length / max(length, 1e-4))
        k = (0.85 + 0.25 * s) * light
        return (color[0] * k, color[1] * k, color[2] * k * 0.95, 1)

    _add_colored(bm, t, col)


def _lobes(rng, n, rx, ry, cy, r=(0.28, 0.48)):
    """Sub-dome centres for a cluster: a rounded mass filling its cell, lumpy at the edge, its crown
    (top) fuller than its underside."""
    out = []
    for k in range(n):
        a = rng.uniform(0, 2 * math.pi)
        rr = rng.uniform(0.15, 1.0) ** 0.5
        y = math.sin(a) * ry * rr * 0.72
        if y < 0:
            y *= 0.8
        p = Vector((math.cos(a) * rx * rr * 0.72, cy + y, rng.uniform(-0.2, 0.25)))
        out.append((p, rng.uniform(*r)))
    return out


def _cluster(bm, rng, lobes, n, size, greens=CANOPY_GREENS, bound=(0.97, 0.97), hang=0.0):
    """Leaves strewn over the lobes' surfaces, facing out of them (+Z is toward the viewer, +Y is up)."""
    bx, by = bound
    for k in range(n):
        c, r = rng.choice(lobes)
        # Mostly the front and top of each lobe (that is what the card shows), some round its rim.
        while True:
            v = Vector((rng.gauss(0, 1), rng.gauss(0, 1) + 0.35, abs(rng.gauss(0, 1)) + 0.15)).normalized()
            if v.y > -0.75:
                break
        p = c + v * r
        ln = rng.uniform(*size)
        if abs(p.x) + ln * 0.6 > bx or abs(p.y) + ln * 0.6 > by:
            continue
        # Leaves hang off their petioles: outward, then down; a few stand up at the crown.
        dirv = (v * 0.8 + Vector((rng.uniform(-0.4, 0.4), -0.35 - hang + rng.uniform(-0.3, 0.3), rng.uniform(-0.2, 0.3)))).normalized()
        nrm = (v * 0.7 + Vector((0, 0.5, 0.4))).normalized()
        col = hexcol(rng.choice(greens))
        if rng.random() < 0.08:
            col = hexcol(rng.choice(["#8f9a3a", "#a3a046", "#7d8a36"]))
        # Leaves deeper in the mass (toward the back) are shaded darker by the render; keep the albedo honest.
        _leaf3d(bm, p - dirv * ln * 0.15, dirv, nrm, ln, ln * rng.uniform(0.38, 0.5), col, seg=3, fold=rng.uniform(0.05, 0.25),
                droop=rng.uniform(0.05, 0.25))


def build_cluster(rng):
    """The big mass for tree crowns, jungle banks and canopies."""
    bm = bmesh.new()
    lobes = _lobes(rng, 24, 0.95, 0.95, 0.0, (0.22, 0.34))
    # A dark core so gaps between leaves read as depth, not as holes.
    for (c, r) in lobes:
        _leaf3d(bm, c + Vector((0, -r * 0.45, -r * 0.85)), (0, 1, 0), (0, 0, 1), r * 0.9, r * 0.8, hexcol("#1e3410"), seg=2, fold=0, droop=0)
    _cluster(bm, rng, lobes, 1500, (0.1, 0.19))
    return bm


def build_broad(rng):
    """A smaller mass of big glossy jungle leaves (the cell the trees and cliff plants use)."""
    bm = bmesh.new()
    lobes = _lobes(rng, 9, 0.9, 0.9, 0.0, (0.28, 0.42))
    for (c, r) in lobes:
        _leaf3d(bm, c + Vector((0, -r * 0.6, -r * 0.6)), (0, 1, 0), (0, 0, 1), r * 1.1, r * 1.0, hexcol("#21380f"), seg=2, fold=0, droop=0)
    _cluster(bm, rng, lobes, 520, (0.18, 0.32), greens=["#386420", "#467626", "#58862c", "#30561c", "#4f7f26", "#62902e"])
    return bm


def build_cluster_s(rng):
    """Fine-leaved mass: ivy, box-like bushes, the undergrowth."""
    bm = bmesh.new()
    lobes = _lobes(rng, 18, 0.95, 0.95, 0.0, (0.2, 0.32))
    for (c, r) in lobes:
        _leaf3d(bm, c + Vector((0, -r * 0.6, -r * 0.6)), (0, 1, 0), (0, 0, 1), r * 1.2, r * 1.1, hexcol("#22380f"), seg=2, fold=0, droop=0)
    _cluster(bm, rng, lobes, 3200, (0.07, 0.12), greens=["#4a7024", "#5a842a", "#6c9432", "#3b5c1e", "#7a9638", "#527a28"])
    return bm


def build_drape(rng):
    """A leafy ledge with vines hanging out of it (cell x ∈ [−2, 2], y ∈ [−1, 1])."""
    bm = bmesh.new()
    lobes = []
    for k in range(12):
        x = -1.75 + 3.5 * (k + rng.uniform(0.2, 0.8)) / 12
        lobes.append((Vector((x, rng.uniform(0.45, 0.62), rng.uniform(-0.1, 0.2))), rng.uniform(0.22, 0.34)))
    for (c, r) in lobes:
        _leaf3d(bm, c + Vector((0, -r * 0.6, -r * 0.6)), (0, 1, 0), (0, 0, 1), r * 1.2, r * 1.2, hexcol("#22380f"), seg=2, fold=0, droop=0)
    _cluster(bm, rng, lobes, 700, (0.09, 0.17), bound=(1.96, 0.97), hang=0.3)
    # Vines: from inside the mass down to ragged ends, leaves alternating along them.
    for k in range(34):
        x = -1.85 + 3.7 * (k + rng.uniform(0.1, 0.9)) / 34
        y = rng.uniform(0.35, 0.55)
        end = rng.uniform(-0.97, 0.1)
        xx = x
        while y > end:
            ny = y - 0.07
            nx = xx + rng.uniform(-0.012, 0.012)
            _leaf3d(bm, (xx, y, 0.05), (nx - xx, ny - y, 0), (0, 0, 1), 0.075, 0.012, hexcol("#4f5a28"), seg=1, fold=0, droop=0)
            for sd in (-1, 1):
                if rng.random() > 0.8:
                    continue
                dd = Vector((sd * rng.uniform(0.5, 1.0), rng.uniform(-0.9, -0.2), rng.uniform(0.0, 0.5))).normalized()
                _leaf3d(bm, (xx, y, 0.05), dd, (0, 0.3, 1), rng.uniform(0.09, 0.15), 0.07, hexcol(rng.choice(LEAF_GREENS)), seg=2,
                        fold=0.2, droop=0.1)
            if rng.random() < 0.05:
                _flower(bm, (xx, y, 0.08), 0.03, rng.choice(FLOWERS))
            xx, y = nx, ny
    return bm


def build_banana(rng):
    """One big banana leaf, torn into strips by the wind (x is squeezed ×0.5 into its cell)."""
    bm = bmesh.new()
    n = 40
    for side in (-1, 1):
        t = bmesh.new()
        tears = set(rng.sample(range(4, n - 3), 6))
        cols = []
        for i in range(n):
            s0, s1 = i / n, (i + 1) / n
            if i in tears:
                continue
            # The blade's half-width along the midrib; the veins run out and a little toward the tip.
            w0 = 0.9 * math.sin(math.pi * min(1.0, 0.06 + s0 * 0.98)) ** 0.5
            w1 = 0.9 * math.sin(math.pi * min(1.0, 0.06 + s1 * 0.98)) ** 0.5
            y0, y1 = -0.92 + 1.86 * s0, -0.92 + 1.86 * s1
            lift = 0.06 if (i + 1) in tears else 0.0
            shade = rng.uniform(0.9, 1.06)
            v = [t.verts.new((0, y0, 0)), t.verts.new((side * w0, y0 + 0.12 + lift, 0)), t.verts.new((side * w1, y1 + 0.12, 0)), t.verts.new((0, y1, 0))]
            t.faces.new(v if side > 0 else list(reversed(v)))
            cols.append(shade)
        base = hexcol(rng.choice(["#4f8a26", "#5a942c", "#4a8424"]))

        def col(co, base=base):
            e = min(1.0, abs(co.x) / 0.9)
            k = 0.95 + 0.25 * (co.y + 1) / 2 - 0.12 * e
            dry = max(0.0, (co.y - 0.5) * 1.5) * e
            c = [base[j] * k for j in range(3)]
            c = [c[0] * (1 - dry) + 0.38 * dry, c[1] * (1 - dry) + 0.34 * dry, c[2] * (1 - dry) + 0.1 * dry]
            return (c[0], c[1], c[2], 1)

        _add_colored(bm, t, col)
    # Pale midrib on top.
    t = bmesh.new()
    a, b2, c, d = (t.verts.new((-0.035, -0.98, 0.01)), t.verts.new((0.035, -0.98, 0.01)), t.verts.new((0.012, 0.95, 0.01)), t.verts.new((-0.012, 0.95, 0.01)))
    t.faces.new((a, b2, c, d))
    _add_colored(bm, t, lambda co: hexcol("#b8c070"))
    return bm


def render_atlas(size=2048):
    rng = random.Random(7)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    # Soft sky from everywhere plus a sun from above and in front: flat leaves come out at about their
    # albedo, the clusters bright on their crowns and dark in their hollows.
    w = bpy.data.worlds.new("leafsky")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.78, 0.84, 0.72, 1)
    bg.inputs[1].default_value = 0.5
    sc.world = w
    ld = bpy.data.lights.new("leafsun", "SUN")
    ld.energy = 3.3
    ld.angle = math.radians(6)
    lo = bpy.data.objects.new("leafsun", ld)
    # Light travels along the lamp's −Z: from +Y (up in the cell) and +Z (the viewer's side).
    lo.rotation_euler = Vector((0.25, 0.8, 0.55)).normalized().to_track_quat("Z", "Y").to_euler()
    link(lo)
    mat_lit, mat_flat = _leaf_material(True), _leaf_material(False)
    atlas = np.zeros((size, size, 4), np.float32)
    builders = {"frond": build_frond, "fern": build_fern, "vine": build_vine, "grass": build_grass, "banana": build_banana,
                "broad": build_broad, "cluster_s": build_cluster_s, "cluster": build_cluster, "drape": build_drape}
    for key, fn in builders.items():
        solid = key in ("broad", "cluster_s", "cluster", "drape")
        sc.cycles.samples = 64 if solid else 4
        sc.cycles.use_denoising = True
        bm = fn(rng)
        ob = new_mesh_obj(f"leaf_{key}", bm)
        ob.data.materials.append(mat_lit if solid else mat_flat)
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
    bpy.data.objects.remove(lo)
    sc.cycles.use_denoising = False
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


def wall_ivy(name, seed, crests, depth=0.7, density=0.5):
    """Vines draped over a ragged wall's column tops (kit_geo.CRESTS) and hanging down both faces,
    with a tuft of fern on some crests. Same local space as the wall piece."""
    rng = random.Random(seed)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    for (y0, y1, zt, ox) in crests:
        if rng.random() > density or zt < 0.5:
            continue
        for side in (-1, 1):
            if rng.random() < 0.35:
                continue
            for _ in range(rng.randint(1, 2)):
                yy = rng.uniform(y0 + 0.05, y1 - 0.05)
                ln = rng.uniform(0.45, min(1.5, zt + 0.1))
                x = ox + side * (depth / 2 + 0.03)
                # From the crest, over the edge and down the face (the card hangs toward −Z).
                _card(bm, uvl, "vine", (x, yy, zt + 0.02), (side * 0.05, rng.uniform(-0.08, 0.08), -ln),
                      ln * rng.uniform(0.4, 0.55), seg=4, up=Vector((side, 0, 0)), flip_v=True)
        if rng.random() < 0.35:
            a = rng.uniform(0, 6.28)
            for k in range(3):
                b = a + k * 2.1
                d = Vector((math.cos(b) * 0.6, math.sin(b) * 0.6, 0.55))
                _card(bm, uvl, "fern", (ox, (y0 + y1) / 2, zt - 0.02), d * rng.uniform(0.45, 0.6), rng.uniform(0.35, 0.45), droop=0.25, seg=3)
    if not bm.faces:
        _card(bm, uvl, "vine", (0, 1, 0.5), (0, 0, -0.3), 0.1, seg=1)
    return new_mesh_obj(name, bm)
