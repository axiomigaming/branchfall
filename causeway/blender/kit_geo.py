"""Geometry generators for the CAUSEWAY ruin kit. Pure bmesh, deterministic per seed."""
import math
import random

import bmesh
import bpy
from mathutils import Vector, noise

from common import add_block, finish_obj, hexcol, jitter_color

# Warm, saturated sandstone (round 3: the beige read dusty; the references are red-orange and cream).
SAND = [hexcol(h) for h in ("#c4814d", "#b37043", "#d39560", "#a5653d", "#c07c4e", "#b88660", "#d09058")]
TERRA = [hexcol(h) for h in ("#a3634a", "#ae7057", "#94583f", "#b67b5e", "#8b5543", "#a36d57")]
WOOD = [hexcol(h) for h in ("#8a6547", "#7a5a40", "#96714f", "#6d4f38")]

PATH_W = 4.4


def sand(rng):
    return jitter_color(rng.choice(SAND), rng, 0.1, 0.04)


def wall(name, seed, length=4.0, height=1.5, depth=0.7, ruin=0.4, tall=False):
    """A dry-stone wall running along +Y from 0 to `length`, centred on x=0.

    `ruin` lowers and breaks the top into the stacked, crenellated profile of the references.
    """
    rng = random.Random(seed)
    bm = bmesh.new()
    z = -0.35
    course = 0
    while z < height - 0.05:
        ch = rng.uniform(0.26, 0.42) if not tall else rng.uniform(0.35, 0.55)
        y = -rng.uniform(0.0, 0.35)
        while y < length:
            bl = rng.uniform(0.38, 0.95) if not tall else rng.uniform(0.6, 1.3)
            yc = y + bl / 2
            if yc > length + 0.1:
                break
            # Height profile: noise along the wall decides where the top is broken.
            prof = height * (1 - ruin * (0.5 + 0.5 * noise.noise(Vector((seed * 0.37, yc * 0.55, 0.3)))))
            prof -= ruin * rng.uniform(0, 0.35)
            if z + ch * 0.5 > prof and course > 0:
                y += bl + rng.uniform(0.0, 0.02)
                continue
            d = depth * rng.uniform(0.86, 1.0)
            add_block(
                bm,
                (d, bl - 0.025, ch - 0.02),
                (rng.uniform(-0.05, 0.05), yc, z + ch / 2),
                (rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), rng.uniform(-0.04, 0.04)),
                bevel=rng.uniform(0.03, 0.07),
                rng=rng,
                color=sand(rng),
                chip=0.35 if z + ch > prof - 0.4 else 0.1,
            )
            y += bl + rng.uniform(0.0, 0.02)
        z += ch
        course += 1
    # A few loose stones on top of the ruined crest.
    for _ in range(int(ruin * 4)):
        yc = rng.uniform(0.3, length - 0.3)
        prof = height * (1 - ruin * (0.5 + 0.5 * noise.noise(Vector((seed * 0.37, yc * 0.55, 0.3)))))
        s = rng.uniform(0.25, 0.45)
        add_block(bm, (s * 1.3, s * 1.6, s), (rng.uniform(-0.1, 0.1), yc, max(0.2, prof) + s / 2 - 0.05),
                  (0, 0, rng.uniform(-0.5, 0.5)), bevel=0.05, rng=rng, color=sand(rng), chip=0.5)
    return finish_obj(name, bm)


def floor(name, seed, width=PATH_W, length=4.0, broken=0.0, thickness=0.32, palette=None):
    """Slabs from y=0..length, x=±width/2, top at z=0."""
    rng = random.Random(seed)
    pal = palette or TERRA
    bm = bmesh.new()
    y = 0.0
    while y < length - 0.05:
        rd = min(rng.uniform(0.42, 0.85), length - y)
        x = -width / 2
        stagger = rng.uniform(0.0, 0.5)
        first = True
        while x < width / 2 - 0.05:
            sl = rng.uniform(0.7, 1.6) - (stagger if first else 0)
            sl = max(0.35, min(sl, width / 2 - x))
            first = False
            if broken and rng.random() < broken * 0.35:
                x += sl
                continue
            dz = rng.uniform(-0.012, 0.012) - (rng.uniform(0.0, 0.06) if broken and rng.random() < broken else 0)
            add_block(
                bm,
                (sl - 0.022, rd - 0.022, thickness),
                (x + sl / 2, y + rd / 2, -thickness / 2 + dz),
                (rng.uniform(-0.012, 0.012), rng.uniform(-0.012, 0.012), rng.uniform(-0.008, 0.008)),
                bevel=rng.uniform(0.018, 0.035),
                rng=rng,
                color=jitter_color(rng.choice(pal), rng, 0.08, 0.03),
                chip=0.25 + broken * 0.4,
                jit=0.006,
            )
            x += sl
        y += rd
    if broken:
        # A bed of packed earth shows where slabs are missing.
        add_block(bm, (width, length, 0.2), (0, length / 2, -0.28), bevel=0.02, rng=rng, color=hexcol("#6e4a31"), jit=0.02)
    return finish_obj(name, bm)


def pillar(name, seed, height=4.5, radius=0.42, broken=False):
    rng = random.Random(seed)
    bm = bmesh.new()
    add_block(bm, (radius * 2.7, radius * 2.7, 0.45), (0, 0, 0.2), bevel=0.05, rng=rng, color=sand(rng), chip=0.3)
    z = 0.42
    top = height if not broken else height * rng.uniform(0.35, 0.65)
    while z < top - 0.1:
        h = rng.uniform(0.45, 0.8)
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=True, segments=18, radius1=radius, radius2=radius * 0.97, depth=h - 0.02)
        bmesh.ops.bevel(tmp, geom=[e for e in tmp.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.8],
                        offset=0.03, segments=2, affect="EDGES")
        for v in tmp.verts:
            v.co += noise.noise_vector(v.co * 2.3 + Vector((seed, z, 0))) * 0.018
        ang = rng.uniform(0, 6.28)
        tilt = (rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02))
        from mathutils import Matrix, Euler
        m = Matrix.Translation((rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), z + h / 2)) @ Euler((tilt[0], tilt[1], ang)).to_matrix().to_4x4()
        bmesh.ops.transform(tmp, matrix=m, verts=tmp.verts)
        cl = tmp.loops.layers.float_color.new("Col")
        c = sand(rng)
        for f in tmp.faces:
            for l in f.loops:
                l[cl] = c
        me = bpy.data.meshes.new("_t")
        tmp.to_mesh(me)
        tmp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        z += h
    if not broken:
        add_block(bm, (radius * 2.6, radius * 2.6, 0.38), (0, 0, z + 0.19), bevel=0.05, rng=rng, color=sand(rng), chip=0.3)
    return finish_obj(name, bm, 50)


def arch(name, seed, span=6.8, pier_h=4.0, depth=1.3):
    rng = random.Random(seed)
    bm = bmesh.new()
    r = span / 2
    for side in (-1, 1):
        z = -0.3
        while z < pier_h:
            h = rng.uniform(0.45, 0.7)
            add_block(bm, (1.25, depth, h - 0.02), (side * (r + 0.62), 0, z + h / 2), bevel=0.05, rng=rng,
                      color=sand(rng), chip=0.2)
            z += h
    n = 15
    for i in range(n):
        a0 = math.pi * i / n
        a1 = math.pi * (i + 1) / n
        am = (a0 + a1) / 2
        rin, rout = r, r + 1.05 + (0.18 if i == n // 2 else 0)
        rm = (rin + rout) / 2
        cx, cz = -math.cos(am) * rm, pier_h + math.sin(am) * rm
        chord = 2 * rm * math.sin((a1 - a0) / 2) - 0.03
        add_block(bm, (chord, depth * (1.05 if i == n // 2 else 1.0), rout - rin), (cx, 0, cz), (0, am - math.pi / 2, 0),
                  bevel=0.04, rng=rng, color=sand(rng), chip=0.25)
    # Spandrel fill and a broken crown course.
    z = pier_h
    top = pier_h + r + 1.6
    while z < top:
        h = rng.uniform(0.4, 0.6)
        x = -r - 1.25
        while x < r + 1.25:
            w = rng.uniform(0.6, 1.2)
            xc = x + w / 2
            inside = (xc ** 2 + (z + h / 2 - pier_h) ** 2) ** 0.5 < r + 1.1
            crest = top - abs(xc) * 0.25 - rng.uniform(0, 0.9)
            if not inside and z + h / 2 < crest:
                add_block(bm, (w - 0.02, depth * 0.92, h - 0.02), (xc, rng.uniform(-0.05, 0.05), z + h / 2), bevel=0.04,
                          rng=rng, color=sand(rng), chip=0.3, segments=1)
            x += w
        z += h
    return finish_obj(name, bm)


def stairs(name, seed, width=PATH_W, run=4.0, drop=1.6, steps=10):
    rng = random.Random(seed)
    bm = bmesh.new()
    d = run / steps
    rise = drop / steps
    for i in range(steps):
        ztop = -rise * i
        x = -width / 2
        while x < width / 2 - 0.05:
            sl = min(rng.uniform(0.8, 1.7), width / 2 - x)
            add_block(bm, (sl - 0.02, d + 0.06, rise + 0.25), (x + sl / 2, d * i + d / 2, ztop - (rise + 0.25) / 2),
                      (rng.uniform(-0.01, 0.01), 0, rng.uniform(-0.01, 0.01)), bevel=0.025, rng=rng,
                      color=jitter_color(rng.choice(TERRA), rng, 0.08), chip=0.3, jit=0.006)
            x += sl
    # Cheek walls.
    for side in (-1, 1):
        for i in range(0, steps, 2):
            h = 0.55
            add_block(bm, (0.6, d * 2 - 0.02, h + rise * 2), (side * (width / 2 + 0.3), d * i + d, -rise * i + h / 2 - rise),
                      bevel=0.04, rng=rng, color=sand(rng), chip=0.3)
    return finish_obj(name, bm)


def slab_gate(name, seed, w=6.2, h=6.0, d=0.8):
    """The carved stone that drops across the path when the way falls."""
    rng = random.Random(seed)
    bm = bmesh.new()
    add_block(bm, (w, d, h), (0, 0, h / 2), bevel=0.08, rng=rng, color=hexcol("#b98a5c"), chip=0.3, jit=0.02)
    # Raised border frame and a central disc.
    for zc in (0.25, h - 0.25):
        add_block(bm, (w + 0.1, d + 0.16, 0.45), (0, 0, zc), bevel=0.05, rng=rng, color=hexcol("#a97b50"), chip=0.3)
    tmp = bmesh.new()
    bmesh.ops.create_cone(tmp, cap_ends=True, segments=32, radius1=1.35, radius2=1.3, depth=0.22)
    from mathutils import Matrix
    bmesh.ops.transform(tmp, matrix=Matrix.Translation((0, -d / 2 - 0.08, h * 0.55)) @ Matrix.Rotation(math.pi / 2, 4, "X"), verts=tmp.verts)
    cl = tmp.loops.layers.float_color.new("Col")
    for f in tmp.faces:
        for l in f.loops:
            l[cl] = hexcol("#c49a68")
    me = bpy.data.meshes.new("_t")
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    return finish_obj(name, bm)


def stele(name, seed, w=1.4, h=3.2, d=0.55):
    rng = random.Random(seed)
    bm = bmesh.new()
    add_block(bm, (w * 1.3, d * 1.5, 0.4), (0, 0, 0.2), bevel=0.05, rng=rng, color=sand(rng), chip=0.4)
    add_block(bm, (w, d, h), (0, 0, 0.4 + h / 2), (0, 0, rng.uniform(-0.05, 0.05)), bevel=0.07, rng=rng,
              color=sand(rng), chip=0.5, jit=0.03)
    return finish_obj(name, bm)


def rubble(name, seed, n=6, spread=1.4, size=(0.2, 0.5)):
    rng = random.Random(seed)
    bm = bmesh.new()
    for i in range(n):
        s = rng.uniform(*size)
        a = rng.uniform(0, 6.28)
        r = rng.uniform(0, spread)
        add_block(bm, (s * rng.uniform(1, 1.8), s * rng.uniform(1, 1.6), s * rng.uniform(0.6, 1.0)),
                  (math.cos(a) * r, math.sin(a) * r, s * 0.3 + (0.15 if i > n * 0.7 else 0)),
                  (rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0, 6)), bevel=0.04, rng=rng,
                  color=sand(rng), chip=0.7, jit=0.02)
    return finish_obj(name, bm)


def drum(name, seed, radius=0.42, length=0.7):
    """A fallen column drum lying on its side."""
    rng = random.Random(seed)
    bm = bmesh.new()
    tmp = bmesh.new()
    bmesh.ops.create_cone(tmp, cap_ends=True, segments=18, radius1=radius, radius2=radius, depth=length)
    for v in tmp.verts:
        v.co += noise.noise_vector(v.co * 3 + Vector((seed, 0, 0))) * 0.03
    from mathutils import Matrix
    bmesh.ops.transform(tmp, matrix=Matrix.Translation((0, 0, radius * 0.92)) @ Matrix.Rotation(math.pi / 2, 4, "Y"), verts=tmp.verts)
    cl = tmp.loops.layers.float_color.new("Col")
    c = sand(rng)
    for f in tmp.faces:
        for l in f.loops:
            l[cl] = c
    me = bpy.data.meshes.new("_t")
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    return finish_obj(name, bm, 50)


def tower(name, seed, w=4.0, h=11.0):
    """A ruined shrine tower for the middle distance."""
    rng = random.Random(seed)
    bm = bmesh.new()
    z = -0.4
    lvl = 0
    while z < h:
        ch = rng.uniform(0.7, 1.05)
        shrink = 1 - 0.18 * (z / h)
        ww = w * shrink
        crest = h - rng.uniform(0, 2.5)
        for side in range(4):
            x = -ww / 2
            while x < ww / 2:
                bl = rng.uniform(1.0, 1.9)
                xc = x + bl / 2
                window = (lvl % 6 in (3, 4)) and abs(xc) < 0.5 and side in (0, 2)
                if z < crest - abs(xc) * 0.6 and not window:
                    a = side * math.pi / 2
                    px, py = math.cos(a) * xc - math.sin(a) * (ww / 2), math.sin(a) * xc + math.cos(a) * (ww / 2)
                    add_block(bm, (bl - 0.03, 0.8, ch - 0.02), (px, py, z + ch / 2), (0, 0, a), bevel=0.06, rng=rng,
                              color=sand(rng), chip=0.3, segments=1)
                x += bl
        z += ch
        lvl += 1
    return finish_obj(name, bm)


def rock_obj(name, seed, size=(6, 4, 8), detail=4, strata=0.25):
    rng = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=detail, radius=1.0)
    off = Vector((seed * 3.1, seed * 1.7, seed * 0.9))
    for v in bm.verts:
        p = v.co.copy()
        d = noise.fractal(p * 1.3 + off, 0.6, 2.0, 5) * 0.28
        d += noise.noise(p * 4.0 + off) * 0.06
        # Layered sediment: terraces in Z.
        z = p.z * size[2]
        terr = (z * 1.3) % 1.0
        d += strata * 0.08 * (terr - 0.5)
        v.co = Vector((p.x * size[0] / 2, p.y * size[1] / 2, p.z * size[2] / 2)) * (1 + d)
    # Flatten the base so it sits.
    for v in bm.verts:
        if v.co.z < -size[2] * 0.3:
            v.co.z = -size[2] * 0.3 + (v.co.z + size[2] * 0.3) * 0.2
    ob = finish_obj(name, bm, 70)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def planks(name, seed, width=3.2, length=4.0):
    rng = random.Random(seed)
    bm = bmesh.new()
    n = int(width / 0.26)
    pw = width / n
    for i in range(n):
        x = -width / 2 + pw * (i + 0.5)
        y = 0
        while y < length - 0.05:
            pl = min(rng.uniform(1.4, 3.2), length - y)
            if rng.random() < 0.035:
                y += pl
                continue
            add_block(bm, (pw - 0.025, pl - 0.03, 0.09), (x, y + pl / 2, -0.045 + rng.uniform(-0.01, 0.005)),
                      (0, rng.uniform(-0.02, 0.02), rng.uniform(-0.006, 0.006)), bevel=0.012, rng=rng,
                      color=jitter_color(rng.choice(WOOD), rng, 0.12), chip=0.2, jit=0.004)
            y += pl
    for yb in (0.5, 2.0, 3.5):
        add_block(bm, (width + 0.3, 0.22, 0.24), (0, yb, -0.22), bevel=0.02, rng=rng, color=jitter_color(WOOD[3], rng), jit=0.006)
    for side in (-1, 1):
        for yb in (0.5, 3.5):
            add_block(bm, (0.26, 0.26, 3.2), (side * (width / 2 + 0.05), yb, -1.8), (rng.uniform(-0.05, 0.05), 0, 0),
                      bevel=0.02, rng=rng, color=jitter_color(WOOD[1], rng), jit=0.01)
    return finish_obj(name, bm, 30)


def foundation(name, seed, length=4.0, height=2.6):
    """Heavy blocks under a causeway, down into the water."""
    rng = random.Random(seed)
    bm = bmesh.new()
    z = -height
    while z < -0.3:
        ch = rng.uniform(0.4, 0.6)
        y = -rng.uniform(0, 0.4)
        while y < length:
            bl = rng.uniform(0.7, 1.4)
            add_block(bm, (0.9, bl - 0.03, ch - 0.02), (rng.uniform(-0.06, 0.06), y + bl / 2, z + ch / 2), bevel=0.06,
                      rng=rng, color=sand(rng), chip=0.3, segments=1)
            y += bl
        z += ch
    return finish_obj(name, bm)
