"""Set pieces for the CAUSEWAY ruin kit (v2): carved heads, guardians, fallen columns,
relief walls, rope rails, roots, stepping stones, lily pads and moss. Pure bmesh, deterministic."""
import math
import random

import bmesh
import bpy
from mathutils import Vector, Matrix, Euler, noise

from common import add_block, finish_obj, hexcol, jitter_color
from kit_geo import sand, WOOD


def _merge(bm, tmp, color=None, color_fn=None):
    """Colour every loop of `tmp` and append it to `bm`."""
    cl = tmp.loops.layers.float_color.get("Col") or tmp.loops.layers.float_color.new("Col")
    for f in tmp.faces:
        for l in f.loops:
            l[cl] = color_fn(l.vert.co) if color_fn else color
    me = bpy.data.meshes.new("_t")
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def _append(t, other):
    me = bpy.data.meshes.new("_t")
    other.to_mesh(me)
    other.free()
    t.from_mesh(me)
    bpy.data.meshes.remove(me)


def _cyl(r0, r1, h, segs=16, m=None, caps=True):
    t = bmesh.new()
    bmesh.ops.create_cone(t, cap_ends=caps, segments=segs, radius1=r0, radius2=r1, depth=h)
    bmesh.ops.translate(t, vec=(0, 0, h / 2), verts=t.verts)
    if m is not None:
        bmesh.ops.transform(t, matrix=m, verts=t.verts)
    return t


def _tube(pts, radii, ring_n=5):
    t = bmesh.new()
    prev = None
    for p, r in zip(pts, radii):
        ring = [t.verts.new(p + Vector((math.cos(2 * math.pi * j / ring_n) * r, math.sin(2 * math.pi * j / ring_n) * r * 0.3,
                                        math.sin(2 * math.pi * j / ring_n) * r))) for j in range(ring_n)]
        if prev:
            for j in range(ring_n):
                t.faces.new((prev[j], prev[(j + 1) % ring_n], ring[(j + 1) % ring_n], ring[j]))
        prev = ring
    return t


def _g(x, s):
    return math.exp(-(x * x) / (2 * s * s))


def face_bm(seed, rings=30, segs=40, crown=True, cuts=2):
    """A serene carved head, ~2 units tall, face toward −Y, chin near z=−1, crown on top.

    A UV sphere whose front is subdivided, then displaced by smooth feature fields
    (brow, closed eyes, nose, lips, cheeks, chin): the calm of the temple faces.
    """
    t = bmesh.new()
    bmesh.ops.create_uvsphere(t, u_segments=segs, v_segments=rings, radius=1.0)
    if cuts:
        front = [f for f in t.faces if f.calc_center_median().y < -0.3 and -0.9 < f.calc_center_median().z < 0.6]
        edges = {e for f in front for e in f.edges}
        bmesh.ops.subdivide_edges(t, edges=list(edges), cuts=cuts, use_grid_fill=True)
    off = Vector((seed * 1.3, seed * 0.7, 0))
    for v in t.verts:
        p = v.co.copy()
        u, z = p.x, p.z
        fr = max(0.0, min(1.0, (-p.y - 0.2) / 0.45))
        au = abs(u)
        d = 0.0
        d += 0.07 * _g(z - 0.3, 0.07) * _g(u, 0.42)                          # brow
        d -= 0.09 * _g(au - 0.3, 0.12) * _g(z - 0.13, 0.08)                  # eye sockets
        d += 0.05 * _g(au - 0.3, 0.12) * _g(z - 0.1, 0.045)                  # heavy lids
        tn = max(0.0, min(1.0, (0.22 - z) / 0.42))
        d += 0.26 * tn * _g(u, 0.06 + 0.08 * tn) * (1 if z > -0.22 else _g(z + 0.22, 0.05))  # nose
        mz = -0.42 + 0.08 * u * u
        d += 0.075 * _g(u, 0.2) * _g(z - (mz + 0.06), 0.04)                  # upper lip
        d += 0.085 * _g(u, 0.17) * _g(z - (mz - 0.075), 0.045)               # lower lip
        d -= 0.045 * _g(u, 0.25) * _g(z - mz, 0.02)                          # the mouth line
        d += 0.06 * _g(u, 0.24) * _g(z + 0.7, 0.1)                           # chin
        d += 0.05 * _g(au - 0.42, 0.14) * _g(z + 0.2, 0.16)                  # cheeks
        d *= fr * 1.9
        d += noise.fractal(p * 3.0 + off, 0.6, 2.0, 4) * 0.022
        # Broad jaw and cheekbones, a flat face plane.
        sx = 0.86 + 0.08 * max(0.0, -z) * (1 - abs(z))
        v.co = Vector((p.x * sx, p.y * (0.72 if p.y < 0 else 0.9), p.z * 1.08)) + p.normalized() * d
    if crown:
        # A tiered lotus crown of stepped rings, and a finial.
        z = 0.7
        r = 0.8
        _append(t, _cyl(r * 1.02, r * 1.02, 0.14, 20, Matrix.Translation((0, 0.05, z))))  # diadem
        z += 0.14
        for i in range(3):
            h = 0.2
            _append(t, _cyl(r * 0.95, r * 0.86, h, 16, Matrix.Translation((0, 0.05, z))))
            z += h
            r *= 0.84
        _append(t, _cyl(r * 0.7, 0.05, 0.3, 10, Matrix.Translation((0, 0.05, z))))
    for sd in (-1, 1):  # long ear lobes
        e = bmesh.new()
        bmesh.ops.create_cube(e, size=1.0)
        bmesh.ops.bevel(e, geom=list(e.edges), offset=0.2, segments=2, affect="EDGES", clamp_overlap=True)
        bmesh.ops.transform(e, matrix=Matrix.Translation((sd * 0.78, 0.05, -0.12)) @ Matrix.Diagonal((0.12, 0.26, 0.78, 1)), verts=e.verts)
        _append(t, e)
    return t


def colossal_head(name, seed, size=1.9):
    """A giant stone face sunk to the chin: z=0 is the ground or water line. Faces −Y."""
    rng = random.Random(seed)
    bm = bmesh.new()
    t = face_bm(seed)
    bmesh.ops.transform(t, matrix=Matrix.Translation((0, 0, size * 0.62))
                        @ Euler((rng.uniform(-0.1, 0.02), rng.uniform(-0.14, 0.14), 0)).to_matrix().to_4x4() @ Matrix.Scale(size, 4),
                        verts=t.verts)
    base = sand(rng)
    _merge(bm, t, base)
    for i in range(8):
        a = rng.uniform(0, 6.28)
        r = rng.uniform(1.3, 2.3) * size / 1.9
        s = rng.uniform(0.35, 0.8)
        add_block(bm, (s * 1.5, s * 1.2, s), (math.cos(a) * r, math.sin(a) * r, s * 0.3 - 0.2), (0.2, 0.1, a), bevel=0.06,
                  rng=rng, color=sand(rng), chip=0.6, segments=1)
    return finish_obj(name, bm, 60)


def guardian(name, seed, height=5.6, broken=False):
    """A standing temple guardian on a plinth, hands on a sword planted before him. Faces −Y."""
    rng = random.Random(seed)
    bm = bmesh.new()
    k = height / 5.6
    add_block(bm, (1.9 * k, 1.9 * k, 0.5 * k), (0, 0, 0.25 * k), bevel=0.06, rng=rng, color=sand(rng), chip=0.4)
    add_block(bm, (1.6 * k, 1.6 * k, 0.45 * k), (0, 0, 0.72 * k), bevel=0.05, rng=rng, color=sand(rng), chip=0.3)
    c = sand(rng)
    z0 = 0.95 * k
    robe = _cyl(0.72 * k, 0.5 * k, 2.1 * k, 24, Matrix.Translation((0, 0, z0)))
    for v in robe.verts:
        a = math.atan2(v.co.y, v.co.x)
        if Vector((v.co.x, v.co.y)).length > 0.05:
            f = 1 + 0.06 * math.cos(a * 9) * (1 - (v.co.z - z0) / (2.1 * k))
            v.co.x *= f
            v.co.y *= f
    _merge(bm, robe, c)
    zt = z0 + 2.1 * k
    add_block(bm, (1.12 * k, 0.86 * k, 0.22 * k), (0, 0, zt), bevel=0.05, rng=rng, color=jitter_color(c, rng, 0.05), chip=0.2)
    tor = bmesh.new()
    bmesh.ops.create_cube(tor, size=1.0)
    for v in tor.verts:
        v.co = Vector((v.co.x * (0.95 + 0.35 * (v.co.z + 0.5)) * k, v.co.y * 0.62 * k, v.co.z * 1.25 * k))
    bmesh.ops.bevel(tor, geom=list(tor.edges), offset=0.12 * k, segments=2, affect="EDGES", clamp_overlap=True)
    bmesh.ops.translate(tor, vec=(0, 0, zt + 0.72 * k), verts=tor.verts)
    _merge(bm, tor, c)
    zs = zt + 1.3 * k
    for sd in (-1, 1):
        if broken and sd > 0:
            add_block(bm, (0.36 * k, 0.36 * k, 0.4 * k), (sd * 0.72 * k, 0, zs - 0.25 * k), bevel=0.05, rng=rng, color=c, chip=0.8)
            continue
        _merge(bm, _cyl(0.2 * k, 0.17 * k, 0.95 * k, 10,
                        Matrix.Translation((sd * 0.74 * k, 0, zs - 0.95 * k)) @ Euler((0.2, sd * 0.1, 0)).to_matrix().to_4x4()), c)
        _merge(bm, _cyl(0.17 * k, 0.14 * k, 0.72 * k, 10,
                        Matrix.Translation((sd * 0.7 * k, -0.12 * k, zs - 0.92 * k)) @ Euler((1.95, 0, -sd * 1.0)).to_matrix().to_4x4()), c)
    add_block(bm, (0.44 * k, 0.32 * k, 0.28 * k), (0, -0.62 * k, zt + 0.1 * k), bevel=0.06, rng=rng, color=c, chip=0.2)  # hands
    # The sword, point down to the plinth.
    add_block(bm, (0.2 * k, 0.07 * k, 2.2 * k), (0, -0.7 * k, z0 + 1.0 * k), bevel=0.02, rng=rng, color=jitter_color(c, rng, 0.08), chip=0.3, segments=1)
    add_block(bm, (0.66 * k, 0.14 * k, 0.12 * k), (0, -0.7 * k, zt - 0.06 * k), bevel=0.03, rng=rng, color=c, chip=0.2, segments=1)
    for sd in (-1, 1):
        s = bmesh.new()
        bmesh.ops.create_uvsphere(s, u_segments=12, v_segments=8, radius=0.34 * k)
        bmesh.ops.transform(s, matrix=Matrix.Translation((sd * 0.74 * k, 0, zs)) @ Matrix.Diagonal((1.1, 1.0, 0.75, 1)), verts=s.verts)
        _merge(bm, s, c)
    add_block(bm, (0.4 * k, 0.4 * k, 0.3 * k), (0, 0, zs + 0.1 * k), bevel=0.06, rng=rng, color=c)  # neck
    h = face_bm(seed, rings=20, segs=26, cuts=1)
    if not broken:
        m = Matrix.Translation((0, 0, zs + 0.7 * k)) @ Matrix.Scale(0.42 * k, 4)
    else:  # the head lies at the statue's feet
        m = Matrix.Translation((0.95 * k, -1.2 * k, 0.4 * k)) @ Euler((1.2, 0.3, 0.6)).to_matrix().to_4x4() @ Matrix.Scale(0.42 * k, 4)
    bmesh.ops.transform(h, matrix=m, verts=h.verts)
    _merge(bm, h, c)
    for v in bm.verts:
        v.co += noise.noise_vector(v.co * 2.1 + Vector((seed, 0, 0))) * 0.012
    return finish_obj(name, bm, 45)


def fallen_column(name, seed, radius=0.75, n=5):
    """A toppled colossal column: drums spilled in a rough line along +Y, the capital at the end."""
    rng = random.Random(seed)
    bm = bmesh.new()
    y = 0.0
    yaw = 0.0
    x = 0.0
    for i in range(n):
        ln = rng.uniform(0.9, 1.3) * radius * 1.4
        yaw += rng.uniform(-0.2, 0.2)
        d = _cyl(radius, radius * 0.98, ln, 20)
        for v in d.verts:
            a = math.atan2(v.co.y, v.co.x)
            fl = 1 + 0.035 * math.cos(a * 12)  # fluting
            v.co.x *= fl
            v.co.y *= fl
            v.co += noise.noise_vector(v.co * 2.5 + Vector((seed, i, 0))) * 0.035
        sink = rng.uniform(0.05, 0.3)
        x += math.sin(yaw) * ln * 0.5
        m = (Matrix.Translation((x, y, radius - sink))
             @ Euler((-math.pi / 2 + rng.uniform(-0.05, 0.05), 0, yaw)).to_matrix().to_4x4()
             @ Matrix.Rotation(rng.uniform(0, 6.28), 4, "Z"))
        bmesh.ops.transform(d, matrix=m, verts=d.verts)
        _merge(bm, d, sand(rng))
        y += ln + rng.uniform(0.05, 0.3)
    add_block(bm, (radius * 3.0, radius * 0.75, radius * 3.0), (x + 0.3, y + radius * 0.45, radius * 1.3), (0.1, 0.3, 0.15), bevel=0.06,
              rng=rng, color=sand(rng), chip=0.5)
    for _ in range(4):
        s = rng.uniform(0.2, 0.45)
        add_block(bm, (s * 1.4, s, s), (rng.uniform(-1.5, 1.5), rng.uniform(0, y), s * 0.3), (0, 0, rng.uniform(0, 6)), bevel=0.04,
                  rng=rng, color=sand(rng), chip=0.7, segments=1)
    return finish_obj(name, bm, 50)


def relief_wall(name, seed, length=4.0, depth=0.9):
    """Big dressed ashlar with two tall carved courses (the glyph material cuts the relief). Runs along +Y."""
    rng = random.Random(seed)
    bm = bmesh.new()
    z = -0.35
    for ci, ch in enumerate([0.55, 1.15, 1.15, 0.5]):
        y = -rng.uniform(0, 0.6) if ci % 2 else 0.0
        while y < length - 0.05:
            bl = min(rng.uniform(1.2, 2.0) if ch > 1 else rng.uniform(0.6, 1.0), length - y)
            if ci == 3 and rng.random() < 0.3:
                y += bl
                continue
            add_block(bm, (depth, bl - 0.03, ch - 0.03), (0, y + bl / 2, z + ch / 2), bevel=0.03, rng=rng,
                      color=jitter_color(hexcol("#b89066"), rng, 0.06), chip=0.35 if ci == 3 else 0.12, jit=0.01, segments=1)
            y += bl
        z += ch
    y = 0.0
    while y < length - 0.05:  # a projecting cornice, a stone or two gone
        bl = rng.uniform(0.7, 1.2)
        if rng.random() > 0.2:
            add_block(bm, (depth + 0.3, bl - 0.03, 0.22), (0, y + bl / 2, z + 0.11), bevel=0.03, rng=rng, color=sand(rng), chip=0.5, segments=1)
        y += bl
    return finish_obj(name, bm)


def rope_rail(name, seed, length=4.0, width=3.2, h=1.05):
    """Posts and sagging rope hand-lines along both sides of a plank tile (runs along +Y)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    for sd in (-1, 1):
        x = sd * (width / 2 + 0.12)
        for yp in (0.15, length - 0.15):
            add_block(bm, (0.16, 0.16, h + 0.4), (x, yp, (h + 0.4) / 2 - 0.35), (rng.uniform(-0.06, 0.06), rng.uniform(-0.05, 0.05), 0),
                      bevel=0.02, rng=rng, color=jitter_color(WOOD[1], rng), jit=0.01, segments=1)
        for zr, sag in ((h, 0.2), (h * 0.55, 0.12)):
            n = 10
            pts = [Vector((x, 0.15 + (length - 0.3) * i / n, zr - sag * 4 * (i / n) * (1 - i / n))) for i in range(n + 1)]
            _merge(bm, _tube(pts, [0.03] * len(pts)), hexcol("#a08458"))
    return finish_obj(name, bm, 60)


def roots(name, seed, width=3.0, n=7, length=(1.5, 3.5)):
    """Aerial roots hanging from z=0 down a face in the XZ plane (bark material)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    for k in range(n):
        x = -width / 2 + width * (k + rng.uniform(0.1, 0.9)) / n
        ln = rng.uniform(*length)
        r0 = rng.uniform(0.04, 0.09)
        segs = 8
        p = Vector((x, -0.15, 0.25))
        pts, rad = [], []
        for i in range(segs + 1):
            s = i / segs
            if i == 1:
                p = Vector((x, 0.0, 0.0))
            elif i:
                p = p + Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.03, 0.05), -ln / segs))
            pts.append(p.copy())
            rad.append(r0 * (1 - 0.8 * s) + 0.008)
        _merge(bm, _tube(pts, rad), (0.3, 0.25, 0.2, 1))
    return finish_obj(name, bm, 70)


def stepping_stones(name, seed, n=6, spread=3.0):
    """Squat worn blocks just breaking the water (z=0 is the water line)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    for i in range(n):
        s = rng.uniform(0.5, 1.0)
        add_block(bm, (s * 1.3, s * 1.1, 0.9), (rng.uniform(-spread, spread) * 0.5, i * spread * 0.5 + rng.uniform(-0.4, 0.4), -0.32 + rng.uniform(0, 0.15)),
                  (rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), rng.uniform(0, 6)), bevel=0.08, rng=rng, color=sand(rng), chip=0.6, segments=1)
    return finish_obj(name, bm)


# ------------------------------------------------------------------ flora (vertex-coloured, baked)
PAD = [hexcol(h) for h in ("#3f6424", "#4d7229", "#5a7d2e", "#36561f", "#6b7f33")]
LOTUS = [hexcol(h) for h in ("#f2b8c6", "#f7d0da", "#e994ad", "#fbe6ea")]


def lily_pads(name, seed, n=12, spread=1.6, flowers=2):
    """A raft of lily pads (z=0 is the water line) with a lotus or two."""
    rng = random.Random(seed)
    bm = bmesh.new()
    for i in range(n):
        r = rng.uniform(0.18, 0.42)
        a = rng.uniform(0, 6.28)
        d = spread * math.sqrt(rng.random())
        cx, cy = math.cos(a) * d, math.sin(a) * d
        t = bmesh.new()
        segs = 14
        notch = rng.uniform(0, 6.28)
        c = t.verts.new((cx, cy, 0.02))
        ring = []
        for j in range(segs + 1):
            aa = notch + 0.35 + (2 * math.pi - 0.7) * j / segs
            rr = r * (1 + 0.04 * math.sin(j * 3.1))
            ring.append(t.verts.new((cx + math.cos(aa) * rr, cy + math.sin(aa) * rr, 0.012 + 0.02 * (j % 2 == 0) * rng.random())))
        for j in range(segs):
            t.faces.new((c, ring[j], ring[j + 1]))
        col = jitter_color(rng.choice(PAD), rng, 0.1, 0.05)
        _merge(bm, t, color_fn=lambda co, col=col, cx=cx, cy=cy, r=r: tuple(
            ch * (0.8 + 0.4 * min(1, Vector((co.x - cx, co.y - cy)).length / r)) for ch in col[:3]) + (1,))
    for k in range(flowers):
        a = rng.uniform(0, 6.28)
        d = spread * 0.6 * math.sqrt(rng.random())
        cx, cy = math.cos(a) * d, math.sin(a) * d
        pc = rng.choice(LOTUS)
        for layer, (npet, ln, el) in enumerate(((8, 0.2, 0.55), (6, 0.16, 0.95))):
            for j in range(npet):
                aa = 2 * math.pi * j / npet + layer * 0.4
                t = bmesh.new()
                base = Vector((cx, cy, 0.05))
                dirv = Vector((math.cos(aa) * math.cos(el), math.sin(aa) * math.cos(el), math.sin(el)))
                side = Vector((-math.sin(aa), math.cos(aa), 0)) * 0.06
                tip = base + dirv * ln
                mid = base + dirv * ln * 0.5
                vs = [t.verts.new(base), t.verts.new(mid - side), t.verts.new(tip), t.verts.new(mid + side)]
                t.faces.new(vs)
                _merge(bm, t, color_fn=lambda co, base=base, pc=pc: tuple(
                    ch * (0.75 + 0.35 * min(1, (co - base).length / 0.2)) for ch in pc[:3]) + (1,))
        _merge(bm, _cyl(0.04, 0.05, 0.06, 8, Matrix.Translation((cx, cy, 0.05))), hexcol("#e6c040"))
    return finish_obj(name, bm, 80)


def moss_clump(name, seed, radius=0.6, n=5):
    """Soft mounds of moss for wall tops, rubble and stones (z=0 is the surface it sits on)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    for i in range(n):
        t = bmesh.new()
        r = radius * rng.uniform(0.45, 1.0)
        bmesh.ops.create_icosphere(t, subdivisions=2, radius=r)
        off = Vector((seed + i * 3.1, i, 0))
        a = rng.uniform(0, 6.28)
        d = radius * rng.uniform(0, 0.9)
        for v in t.verts:
            v.co.z = max(v.co.z, -0.02) * rng.uniform(0.35, 0.5)
            v.co *= 1 + noise.fractal(v.co * 3 + off, 0.6, 2, 3) * 0.25
            v.co += Vector((math.cos(a) * d, math.sin(a) * d, -0.03))
        col = jitter_color(hexcol(rng.choice(("#4e6a22", "#5c7426", "#435e1e", "#6f7f2c"))), rng, 0.1, 0.05)
        _merge(bm, t, col)
    ob = finish_obj(name, bm, 80)
    return ob
