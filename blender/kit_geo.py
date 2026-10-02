"""Geometry generators for the CAUSEWAY ruin kit. Pure bmesh, deterministic per seed.

Round 4: every stone is a rounded, eroded block (common.add_stone) instead of a crisp bevelled brick.
Walls are ragged stacks: a low continuous footing, then separate columns of uneven height, some
leaning, some broken down to a stump, loose blocks on top and at the foot. Floors are worn pavers
with soft edges, slightly tilted and displaced, sunk or missing here and there over a bed of sand.
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector, Matrix, Euler, noise

from common import add_block, add_stone, drop_faces_below, finish_obj, hexcol, jitter_color

# Warm, saturated sandstone (round 3: the beige read dusty; the references are red-orange and cream).
# Round 8: less brick-red. Weathered limestone and tan sandstone (the critic read the red bricks as
# European ruins); the pavers are a warm grey-tan stone rather than terracotta.
SAND = [hexcol(h) for h in ("#c39a6c", "#b58b60", "#d1aa7c", "#a8825c", "#bf9670", "#b9946c", "#cba57a", "#b5a080")]
TERRA = [hexcol(h) for h in ("#b08a6a", "#a07c60", "#bc9878", "#987458", "#a98a70", "#b39072")]
WOOD = [hexcol(h) for h in ("#8a6547", "#7a5a40", "#96714f", "#6d4f38")]
# Weathered boards: warm honey-brown, bleached where the sun takes them (round 5: never grey).
BOARDS = [hexcol(h) for h in ("#b8895c", "#a87a4e", "#c4986a", "#9e754e", "#c09c72", "#b08458")]
DUSTSAND = [hexcol(h) for h in ("#b8936a", "#c29e74", "#a98660")]
MOSSY = [hexcol(h) for h in ("#8a7a48", "#7f7a44", "#96864f")]

PATH_W = 4.4
# Wall crests per piece: [(y0, y1, z_top, x_offset)] for the ivy that drapes over them (foliage.wall_ivy).
CRESTS = {}


def sand(rng):
    return jitter_color(rng.choice(SAND), rng, 0.1, 0.04)


def weathered(rng, moss=0.12):
    """Wall stone: sandstone, now and then greened by moss or pale with dust."""
    r = rng.random()
    if r < moss:
        return jitter_color(rng.choice(MOSSY), rng, 0.1, 0.03)
    if r < moss + 0.1:
        return jitter_color(rng.choice(DUSTSAND), rng, 0.08, 0.03)
    return sand(rng)


def blk(bm, rng, size, loc, rot=(0, 0, 0), color=None, radius=0.26, erode=0.45, cuts=2, lean=(0, 0), pillow=0.04, uvshrink=None, taper=0.04):
    add_stone(bm, size, loc, rot, rng=rng, color=color or weathered(rng), radius=radius, erode=erode, cuts=cuts, lean=lean,
              pillow=pillow, uvshrink=uvshrink, taper=taper)


def pebble(bm, rng, s, loc, color=None, flat=0.6):
    """A 20-triangle pebble: a squashed, noise-bent icosahedron."""
    t = bmesh.new()
    bmesh.ops.create_icosphere(t, subdivisions=1, radius=1.0)
    off = Vector((rng.uniform(-40, 40), rng.uniform(-40, 40), 0))
    sx, sy, sz = s * rng.uniform(0.9, 1.4), s * rng.uniform(0.8, 1.2), s * flat * rng.uniform(0.7, 1.1)
    yaw = rng.uniform(0, 6.28)
    m = Matrix.Translation(Vector(loc)) @ Euler((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), yaw)).to_matrix().to_4x4()
    for v in t.verts:
        p = v.co * (1 + 0.38 * noise.noise(v.co * 1.9 + off))
        v.co = m @ Vector((p.x * sx, p.y * sy, p.z * sz))
    cl = t.loops.layers.float_color.new("Col")
    c = color or sand(rng)
    for f in t.faces:
        for l in f.loops:
            l[cl] = c
    me = bpy.data.meshes.new("_p")
    t.to_mesh(me)
    t.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


# ------------------------------------------------------------------ walls
def wall(name, seed, length=4.0, height=1.5, depth=0.7, ruin=0.4, tall=False):
    """A ragged dry-stone wall along +Y from 0 to `length`, centred on x=0.

    A continuous footing of rounded blocks, then separate stacked columns of uneven height with gaps
    between them (some lean, some are stumps), loose blocks on the crests and fallen at the foot.
    """
    rng = random.Random(seed)
    bm = bmesh.new()
    crests = []
    k = 1.35 if tall else 1.0
    base_h = height * (rng.uniform(0.28, 0.42) if not tall else rng.uniform(0.4, 0.55))
    back = {"bottom": 0.9, "end": 0.55}
    z = -0.3
    while z < base_h - 0.06:
        ch = rng.uniform(0.24, 0.36) * k
        y = -rng.uniform(0.0, 0.3)
        while y < length:
            bl = rng.uniform(0.36, 0.72) * k
            yc = y + bl / 2
            if yc > length + 0.1:
                break
            d = depth * rng.uniform(0.84, 1.0)
            blk(bm, rng, (d, bl - 0.03, ch - 0.02), (rng.uniform(-0.05, 0.05), yc, z + ch / 2),
                (rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), rng.uniform(-0.06, 0.06)), cuts=1, uvshrink=back)
            y += bl + rng.uniform(0.0, 0.02)
        z += ch
    z_base = z
    # Columns.
    y = -rng.uniform(0.0, 0.15)
    ci = 0
    while y < length - 0.15:
        w = min(rng.uniform(0.4, 0.78) * k, length + 0.1 - y)
        if w < 0.3:
            break
        yc = y + w / 2
        prof = height * (1 - ruin * 0.6 * (0.5 + 0.5 * noise.noise(Vector((seed * 0.37, yc * 0.6, 0.3)))))
        prof += rng.uniform(-0.35, 0.25) * ruin
        r = rng.random()
        if r < 0.16 * (0.5 + ruin):
            prof = z_base + rng.uniform(0.0, 0.35)  # a stump
        elif r > 0.9:
            prof += rng.uniform(0.25, 0.55)  # one stands proud
        lean = (0.0, 0.0)
        if rng.random() < 0.28:
            lean = (rng.uniform(-0.07, 0.07), rng.uniform(-0.09, 0.09))
        zc = z_base
        ox = oy = 0.0
        n = 0
        while zc < prof - 0.1:
            ch = rng.uniform(0.18, 0.3) * (1.0 if not tall else 1.25)
            bw = w * rng.uniform(0.8, 1.0)
            d = depth * rng.uniform(0.72, 0.97)
            ox += rng.uniform(-0.035, 0.035) + lean[0] * ch
            oy += rng.uniform(-0.03, 0.03) + lean[1] * ch
            blk(bm, rng, (d, bw - 0.03, ch - 0.015), (ox, yc + oy, zc + ch / 2),
                (rng.uniform(-0.04, 0.04) + lean[1] * 0.6, rng.uniform(-0.04, 0.04) - lean[0] * 0.6, rng.uniform(-0.12, 0.12)),
                erode=0.6 + 0.3 * (zc / max(prof, 0.5)), cuts=2 if zc + ch >= prof - 0.1 else 1, uvshrink={"bottom": 0.9})
            zc += ch
            n += 1
        # A cap: now and then a loose block lying askew on top.
        if n and rng.random() < 0.22:
            s = rng.uniform(0.22, 0.34)
            blk(bm, rng, (s * 1.5, s * 1.8, s), (ox + rng.uniform(-0.08, 0.08), yc + oy + rng.uniform(-0.1, 0.1), zc + s / 2 - 0.03),
                (rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), rng.uniform(0, 6.28)), erode=0.9)
            zc += s * 0.9
        crests.append((yc + oy - w / 2, yc + oy + w / 2, zc, ox))
        gap = rng.uniform(0.06, 0.32) if rng.random() < 0.55 else rng.uniform(0.0, 0.03)
        y += w + gap
        ci += 1
    # Fallen blocks at the foot, on both sides (never more than a hand's width into the path).
    for _ in range(int(ruin * 3) + rng.randint(0, 2)):
        side = rng.choice((-1, 1))
        s = rng.uniform(0.2, 0.34)
        x = side * (depth / 2 + rng.uniform(0.05, 0.22 if side < 0 else 0.4))
        blk(bm, rng, (s * 1.4, s * 1.7, s), (x, rng.uniform(0.2, length - 0.2), s * 0.35),
            (rng.uniform(-0.35, 0.35), rng.uniform(-0.3, 0.3), rng.uniform(0, 6.28)), erode=0.9, uvshrink={"bottom": 0.9})
    for _ in range(rng.randint(3, 7)):
        side = rng.choice((-1, 1))
        pebble(bm, rng, rng.uniform(0.05, 0.1), (side * (depth / 2 + rng.uniform(0.0, 0.3)), rng.uniform(0, length), 0.01))
    drop_faces_below(bm)
    CRESTS[name] = crests
    return finish_obj(name, bm, 60)


def foundation(name, seed, length=4.0, height=2.6):
    """Heavy rounded blocks under a causeway, down into the water."""
    rng = random.Random(seed)
    bm = bmesh.new()
    z = -height
    while z < -0.3:
        ch = rng.uniform(0.4, 0.6)
        y = -rng.uniform(0, 0.4)
        while y < length:
            bl = rng.uniform(0.7, 1.4)
            blk(bm, rng, (0.9, bl - 0.03, ch - 0.02), (rng.uniform(-0.06, 0.06), y + bl / 2, z + ch / 2),
                (0, rng.uniform(-0.02, 0.02), rng.uniform(-0.04, 0.04)), color=sand(rng), radius=0.45, erode=0.7, cuts=1,
                uvshrink={"bottom": 0.9, "top": 0.5, "end": 0.6})
            y += bl
        z += ch
    drop_faces_below(bm)
    return finish_obj(name, bm, 60)


# ------------------------------------------------------------------ floors
def floor(name, seed, width=PATH_W, length=4.0, broken=0.0, thickness=0.22, palette=None):
    """Worn pavers from y=0..length, x=±width/2, top at z≈0, over a bed of sand.

    Soft rounded edges, a little tilt and lift on every slab, some sunk, cracked in two or missing
    (the sand and a few pebbles show). The walkable plane stays within a couple of centimetres.
    """
    rng = random.Random(seed)
    pal = palette or TERRA
    bm = bmesh.new()
    hidden = {"side": 0.55, "bottom": 0.95, "end": 0.55}
    y = 0.0
    holes = []
    while y < length - 0.05:
        rd = min(rng.uniform(0.5, 0.95), length - y)
        if length - y - rd < 0.3:
            rd = length - y
        x = -width / 2
        stagger = rng.uniform(0.0, 0.5)
        first = True
        while x < width / 2 - 0.05:
            sl = rng.uniform(0.7, 1.45) - (stagger if first else 0)
            sl = max(0.4, min(sl, width / 2 - x))
            if width / 2 - x - sl < 0.3:
                sl = width / 2 - x
            first = False
            jt = rng.uniform(0.03, 0.055)
            cx, cy = x + sl / 2, y + rd / 2
            if rng.random() < 0.025 + broken * 0.3:
                holes.append((cx, cy, sl, rd))
                x += sl
                continue
            col = jitter_color(rng.choice(pal), rng, 0.09, 0.03)
            sunk = rng.random() < 0.07 + broken * 0.35
            dz = -rng.uniform(0.025, 0.06) if sunk else rng.uniform(-0.012, 0.006)
            tl = 0.035 if sunk else 0.009
            rot = (rng.uniform(-tl, tl), rng.uniform(-tl, tl), rng.uniform(-0.025, 0.025))
            rad = rng.uniform(0.12, 0.22)  # round 8: crisp arrises, not soft clay
            if sl > 0.85 and rng.random() < 0.14 + broken * 0.25:
                # Cracked in two: halves settle a little differently.
                t = rng.uniform(0.38, 0.62)
                a = (sl - jt) * t - 0.006
                b = (sl - jt) * (1 - t) - 0.006
                x0 = x + jt / 2
                for (w_, c_) in ((a, x0 + a / 2), (b, x0 + a + 0.012 + b / 2)):
                    blk(bm, rng, (w_, rd - jt, thickness), (c_, cy, -thickness / 2 + dz + rng.uniform(-0.008, 0.004)),
                        (rot[0] + rng.uniform(-0.012, 0.012), rot[1] + rng.uniform(-0.012, 0.012), rot[2]), color=col,
                        radius=rad, erode=0.3 + broken * 0.3, pillow=0.015, uvshrink=hidden, taper=0.02)
            else:
                blk(bm, rng, (sl - jt, rd - jt, thickness), (cx, cy, -thickness / 2 + dz), rot, color=col,
                    radius=rad, erode=0.3 + broken * 0.3, pillow=0.015, uvshrink=hidden, taper=0.02)
            x += sl
        y += rd
    # The bed: packed sand showing in the joints and where slabs are gone. Its top (−0.085) stays below
    # the lowest sunk, tilted slab: at −0.045 it covered some sunk slabs, which baked black (the bed's
    # face 9 mm over them closed their AO) and z-fought it in game — a dark rectangle beside the lane.
    blk(bm, rng, (width - 0.04, length - 0.02, 0.16), (0, length / 2, -0.165), color=jitter_color(hexcol("#a88460"), rng, 0.04),
        radius=0.2, erode=0.15, cuts=2, pillow=0.0, uvshrink={"top": 0.3, "side": 0.9, "bottom": 0.95, "end": 0.9}, taper=0.0)
    for cx, cy, sl, rd in holes:
        for _ in range(rng.randint(2, 5)):
            pebble(bm, rng, rng.uniform(0.04, 0.09), (cx + rng.uniform(-sl, sl) * 0.35, cy + rng.uniform(-rd, rd) * 0.35, -0.075),
                   color=jitter_color(rng.choice(pal + SAND), rng, 0.1))
    # Grit in the joints: a few tiny stones.
    for _ in range(rng.randint(4, 9)):
        pebble(bm, rng, rng.uniform(0.025, 0.05), (rng.uniform(-width / 2, width / 2) * 0.95, rng.uniform(0.1, length - 0.1), -0.03),
               color=jitter_color(rng.choice(DUSTSAND), rng, 0.1))
    drop_faces_below(bm)
    return finish_obj(name, bm, 60)


# ------------------------------------------------------------------ scatter
def scatter(name, seed, width=0.9, length=4.0, n=45, shards=10, chunks=3, falloff=0.45, low=False):
    """Rubble strewn along a wall's foot (x=+width/2 is the wall side) or, with `low`, across the path:
    pebbles, flat broken fragments and a few chunks. Runs y ∈ [0, length]."""
    rng = random.Random(seed)
    bm = bmesh.new()

    def xpos():
        if low:
            return rng.uniform(-width / 2, width / 2)
        return width / 2 - abs(rng.gauss(0, width * falloff))

    for _ in range(n):
        s = rng.uniform(0.025, 0.07) if low else rng.uniform(0.03, 0.095)
        c = rng.choice(SAND + TERRA + TERRA + DUSTSAND)
        c = jitter_color(c, rng, 0.12)
        c = (c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 1)
        pebble(bm, rng, s, (xpos(), rng.uniform(0, length), s * 0.1), color=c, flat=0.45 if low else 0.6)
    for _ in range(shards):
        s = rng.uniform(0.1, 0.24)
        th = rng.uniform(0.035, 0.07)
        blk(bm, rng, (s * rng.uniform(0.8, 1.3), s, th), (xpos(), rng.uniform(0.1, length - 0.1), th * 0.3),
            (rng.uniform(-0.3, 0.3) if not low else rng.uniform(-0.08, 0.08), rng.uniform(-0.25, 0.25) if not low else 0.0, rng.uniform(0, 6.28)),
            color=jitter_color(rng.choice(TERRA + SAND), rng, 0.1), radius=0.5, erode=0.8, cuts=1, pillow=0.0, taper=0.0)
    for _ in range(chunks):
        s = rng.uniform(0.2, 0.36)
        blk(bm, rng, (s * 1.3, s * 1.5, s), (width / 2 - abs(rng.gauss(0, width * 0.25)), rng.uniform(0.2, length - 0.2), s * 0.3),
            (rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(0, 6.28)), erode=0.9, cuts=1)
    drop_faces_below(bm)
    return finish_obj(name, bm, 38)


# ------------------------------------------------------------------ architecture
def pillar(name, seed, height=4.5, radius=0.42, broken=False):
    rng = random.Random(seed)
    bm = bmesh.new()
    blk(bm, rng, (radius * 2.7, radius * 2.7, 0.45), (0, 0, 0.2), color=sand(rng), radius=0.4)
    z = 0.42
    top = height if not broken else height * rng.uniform(0.35, 0.65)
    ox = oy = 0.0
    while z < top - 0.1:
        h = rng.uniform(0.45, 0.8)
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=True, segments=18, radius1=radius, radius2=radius * 0.97, depth=h - 0.02)
        bmesh.ops.bevel(tmp, geom=[e for e in tmp.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.8],
                        offset=0.06, segments=2, affect="EDGES")
        off = Vector((seed, z, 0))
        for v in tmp.verts:
            v.co += noise.noise_vector(v.co * 2.3 + off) * 0.03
            # Eroded rims: the drum edges wear back.
            rim = abs(v.co.z) / (h / 2)
            if rim > 0.8:
                f = 1 - 0.05 * (rim - 0.8) / 0.2 * (0.6 + 0.4 * noise.noise(v.co * 6 + off))
                v.co.x *= f
                v.co.y *= f
        ang = rng.uniform(0, 6.28)
        ox += rng.uniform(-0.025, 0.025)
        oy += rng.uniform(-0.025, 0.025)
        tilt = (rng.uniform(-0.025, 0.025), rng.uniform(-0.025, 0.025))
        m = Matrix.Translation((ox, oy, z + h / 2)) @ Euler((tilt[0], tilt[1], ang)).to_matrix().to_4x4()
        bmesh.ops.transform(tmp, matrix=m, verts=tmp.verts)
        cl = tmp.loops.layers.float_color.new("Col")
        c = weathered(rng)
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
        blk(bm, rng, (radius * 2.6, radius * 2.6, 0.38), (ox, oy, z + 0.19), color=sand(rng), radius=0.4)
    else:
        for _ in range(3):
            pebble(bm, rng, rng.uniform(0.08, 0.16), (rng.uniform(-0.9, 0.9), rng.uniform(-0.9, 0.9), 0.02))
    drop_faces_below(bm, zmax=0.05)
    return finish_obj(name, bm, 50)


def arch(name, seed, span=6.8, pier_h=4.0, depth=1.3):
    rng = random.Random(seed)
    bm = bmesh.new()
    r = span / 2
    for side in (-1, 1):
        z = -0.3
        while z < pier_h:
            h = rng.uniform(0.45, 0.7)
            blk(bm, rng, (1.25, depth, h - 0.02), (side * (r + 0.62) + rng.uniform(-0.03, 0.03), 0, z + h / 2),
                (0, 0, rng.uniform(-0.04, 0.04)), radius=0.35, erode=0.5)
            z += h
    # Round 8: a corbel (Maya) vault instead of a Roman voussoir ring: courses step inward over the
    # opening until a capstone closes it, under a carved lintel band.
    z = pier_h
    inner = r
    while inner > 0.5:
        h = rng.uniform(0.5, 0.6)
        for side in (-1, 1):
            w = r + 1.25 - inner + 0.15
            blk(bm, rng, (w, depth, h - 0.02), (side * (inner + w / 2 - 0.15), 0, z + h / 2), (0, 0, rng.uniform(-0.02, 0.02)),
                radius=0.2, erode=0.4, cuts=1)
        z += h
        inner -= r / 6.5
    blk(bm, rng, (2 * r + 2.6, depth * 1.06, 0.62), (0, 0, z + 0.31), radius=0.18, erode=0.35, cuts=1)
    # Glyph squares along the lintel's faces.
    for side in (-1, 1):
        for k in range(7):
            x = -r + 2 * r * (k + 0.5) / 7
            blk(bm, rng, (2 * r / 7 * 0.7, 0.08, 0.36), (x, side * depth * 0.53, z + 0.31), color=jitter_color(hexcol("#8f8268"), rng, 0.05),
                radius=0.2, erode=0.2, cuts=1, pillow=0.0, taper=0.0)
    z += 0.62
    # A broken, ragged crown course over the lintel.
    top = z + 1.3
    while z < top:
        h = rng.uniform(0.4, 0.6)
        x = -r - 1.25
        while x < r + 1.25:
            w = rng.uniform(0.6, 1.2)
            xc = x + w / 2
            inside = False
            crest = top - abs(xc) * 0.12 - rng.uniform(0, 1.0)
            if not inside and z + h / 2 < crest:
                blk(bm, rng, (w - 0.02, depth * 0.92, h - 0.02), (xc, rng.uniform(-0.05, 0.05), z + h / 2),
                    (0, rng.uniform(-0.03, 0.03), rng.uniform(-0.05, 0.05)), radius=0.4, erode=0.6, cuts=1)
            x += w
        z += h
    drop_faces_below(bm, zmax=0.0)
    return finish_obj(name, bm, 60)


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
            blk(bm, rng, (sl - 0.03, d + 0.06, rise + 0.25), (x + sl / 2, d * i + d / 2, ztop - (rise + 0.25) / 2),
                (rng.uniform(-0.01, 0.01), 0, rng.uniform(-0.015, 0.015)), color=jitter_color(rng.choice(TERRA), rng, 0.08),
                radius=0.4, erode=0.35, cuts=1, taper=0.0, uvshrink={"bottom": 0.95, "side": 0.3})
            x += sl
    # Cheek walls.
    for side in (-1, 1):
        for i in range(0, steps, 2):
            h = 0.55
            blk(bm, rng, (0.6, d * 2 - 0.03, h + rise * 2), (side * (width / 2 + 0.3), d * i + d, -rise * i + h / 2 - rise),
                radius=0.4, erode=0.6, cuts=1)
    drop_faces_below(bm)
    return finish_obj(name, bm, 60)


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
        blk(bm, rng, (s * rng.uniform(1, 1.8), s * rng.uniform(1, 1.6), s * rng.uniform(0.6, 1.0)),
            (math.cos(a) * r, math.sin(a) * r, s * 0.3 + (0.15 if i > n * 0.7 else 0)),
            (rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0, 6)), color=sand(rng), radius=0.55, erode=0.9)
    for _ in range(n * 2):
        a = rng.uniform(0, 6.28)
        r = rng.uniform(0, spread + 0.3)
        pebble(bm, rng, rng.uniform(0.05, 0.12), (math.cos(a) * r, math.sin(a) * r, 0.02))
    return finish_obj(name, bm, 60)


def drum(name, seed, radius=0.42, length=0.7):
    """A fallen column drum lying on its side."""
    rng = random.Random(seed)
    bm = bmesh.new()
    tmp = bmesh.new()
    bmesh.ops.create_cone(tmp, cap_ends=True, segments=18, radius1=radius, radius2=radius, depth=length)
    bmesh.ops.bevel(tmp, geom=[e for e in tmp.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.8],
                    offset=0.06, segments=2, affect="EDGES")
    for v in tmp.verts:
        v.co += noise.noise_vector(v.co * 3 + Vector((seed, 0, 0))) * 0.035
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
    """A ruined shrine tower for the middle distance (far: its faces get fewer texels)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    far = {"top": 0.55, "side": 0.55, "end": 0.55, "bottom": 0.95}
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
                    blk(bm, rng, (bl - 0.03, 0.8, ch - 0.02), (px, py, z + ch / 2), (0, 0, a), radius=0.35, erode=0.6, cuts=1, uvshrink=far)
                x += bl
        z += ch
        lvl += 1
    drop_faces_below(bm)
    return finish_obj(name, bm, 60)


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


def planks(name, seed, width=3.6, length=4.0):
    """A weathered boardwalk tile: long boards along the path (worn round, warped, a few split or gone)
    on cross-bearers, posts down into the water. Walkable top at z≈0."""
    rng = random.Random(seed)
    bm = bmesh.new()
    x = -width / 2
    hid = {"bottom": 0.95, "end": 0.4}
    while x < width / 2 - 0.08:
        pw = min(rng.uniform(0.26, 0.4), width / 2 - x)
        if width / 2 - x - pw < 0.15:
            pw = width / 2 - x
        xc = x + pw / 2
        # Cut points along the board line: staggered from line to line, no stub shorter than 0.5 m.
        cuts = [0.0]
        y = rng.uniform(0.6, 3.2)
        while y < length - 0.5:
            cuts.append(y)
            y += rng.uniform(1.6, 3.6)
        cuts.append(length)
        for y0, y1 in zip(cuts, cuts[1:]):
            if rng.random() < 0.035:
                continue  # a board gone
            th = rng.uniform(0.07, 0.1)
            warp = rng.uniform(-0.012, 0.012)
            blk(bm, rng, (pw - 0.028, y1 - y0 - 0.025, th), (xc + rng.uniform(-0.008, 0.008), (y0 + y1) / 2, -th / 2 + rng.uniform(-0.012, 0.004)),
                (warp, rng.uniform(-0.02, 0.02), rng.uniform(-0.008, 0.008)), color=jitter_color(rng.choice(BOARDS), rng, 0.12, 0.04),
                radius=0.55, erode=0.25, cuts=1, pillow=0.0, taper=0.0, uvshrink=hid)
        x += pw
    for yb in (0.45, 2.0, 3.55):
        blk(bm, rng, (width + 0.4, 0.22, 0.22), (rng.uniform(-0.05, 0.05), yb, -0.22), (0, 0, rng.uniform(-0.03, 0.03)),
            color=jitter_color(WOOD[3], rng), radius=0.5, erode=0.3, cuts=1, taper=0.0, uvshrink={"bottom": 0.8})
    for side in (-1, 1):
        for yb in (0.45, 3.55):
            blk(bm, rng, (0.24, 0.24, 3.0), (side * (width / 2 + 0.12), yb, -1.75), (rng.uniform(-0.05, 0.05), rng.uniform(-0.04, 0.04), rng.uniform(0, 1)),
                color=jitter_color(WOOD[1], rng), radius=0.6, erode=0.3, cuts=1, taper=0.0, uvshrink={"top": 0.5})
    drop_faces_below(bm, zmax=-0.05)
    return finish_obj(name, bm, 40)


# ------------------------------------------------------------------ round 4 set pieces: tunnel, facades, gate
def _voussoirs(bm, rng, r_in, thick, zs, y0, y1, n, course=0.7, dark=0.0, far_out=None):
    """A barrel vault from y0 to y1 over x ∈ [−r_in, r_in], springing at zs: rings of rounded wedge stones,
    staggered between courses. Inside faces are darkened (`dark`) — soot, damp, no sky."""
    y = y0
    ring = 0
    while y < y1 - 0.05:
        cl = min(rng.uniform(course * 0.8, course * 1.2), y1 - y)
        rot0 = (0.5 if ring % 2 else 0.0) / n
        for i in range(n):
            a0 = math.pi * (i + rot0) / n
            a1 = math.pi * (i + 1 + rot0) / n
            a0, a1 = max(0.0, a0), min(math.pi, a1)
            if a1 - a0 < 0.05:
                continue
            am = (a0 + a1) / 2
            rm = r_in + thick / 2
            chord = 2 * rm * math.sin((a1 - a0) / 2) - 0.035
            cx, cz = -math.cos(am) * rm, zs + math.sin(am) * rm
            if rng.random() < 0.035 and 0.6 < am < 2.5:
                continue  # a stone gone from the vault
            c = sand(rng)
            c = (c[0] * (1 - dark), c[1] * (1 - dark * 0.95), c[2] * (1 - dark * 0.85), 1)
            drop = rng.uniform(0.0, 0.04)
            blk(bm, rng, (chord, cl - 0.035, thick * rng.uniform(0.9, 1.05)),
                (cx + math.cos(am) * drop, y + cl / 2, cz - math.sin(am) * drop), (0, am - math.pi / 2, rng.uniform(-0.03, 0.03)),
                color=c, radius=0.35, erode=0.55, cuts=1, taper=0.0, uvshrink=far_out)
        y += cl
        ring += 1


def _kerb(bm, rng, half, y0, y1):
    """Worn kerb stones between the paving (x = ±PATH_W/2) and the tunnel walls, top flush with the path."""
    w = half - PATH_W / 2 + 0.02
    for side in (-1, 1):
        y = y0
        while y < y1 - 0.05:
            bl = min(rng.uniform(0.6, 1.2), y1 - y)
            c = sand(rng)
            c = (c[0] * 0.6, c[1] * 0.58, c[2] * 0.55, 1)
            blk(bm, rng, (w, bl - 0.03, 0.4), (side * (PATH_W / 2 + w / 2 - 0.01), y + bl / 2, -0.21), (0, 0, rng.uniform(-0.02, 0.02)),
                color=c, radius=0.4, erode=0.5, cuts=1, taper=0.0, uvshrink={"bottom": 0.95, "side": 0.6})
            y += bl


def _backing(bm, rng, half, thick, spring, wall_d, y0, y1):
    """A dark, plain shell behind the stones, so light never shows through the joints of the vault."""
    dark = hexcol("#2a2018")
    uv = {"top": 0.9, "side": 0.9, "end": 0.9, "bottom": 0.9}
    for side in (-1, 1):
        add_stone(bm, (0.2, y1 - y0, spring + 0.4), (side * (half + wall_d * 0.72), (y0 + y1) / 2, spring / 2 - 0.2), rng=rng, color=dark,
                  radius=0.1, erode=0.0, cuts=1, taper=0.0, uvshrink=uv)
    n = 10
    r = half + thick * 0.72
    for i in range(n):
        am = math.pi * (i + 0.5) / n
        add_stone(bm, (2 * r * math.sin(math.pi / n / 2) + 0.08, y1 - y0, 0.2), (-math.cos(am) * r, (y0 + y1) / 2, spring + math.sin(am) * r),
                  (0, am - math.pi / 2, 0), rng=rng, color=dark, radius=0.1, erode=0.0, cuts=1, taper=0.0, uvshrink=uv)


def vault(name, seed, length=4.0, half=2.9, spring=3.2, thick=0.75):
    """A 4 m segment of a dark vaulted tunnel along +Y (y ∈ [0, length]), path at z=0 on x=0:
    walls of rounded courses, a barrel vault of voussoirs, earth and rubble heaped over it."""
    rng = random.Random(seed)
    bm = bmesh.new()
    wall_d = 0.8
    for side in (-1, 1):
        z = -0.35
        while z < spring - 0.05:
            ch = min(rng.uniform(0.38, 0.58), spring - z)
            y = -rng.uniform(0, 0.4)
            while y < length - 0.05:
                bl = rng.uniform(0.6, 1.1)
                y0, y1 = max(0.0, y), min(length, y + bl)
                if length - y1 < 0.25:
                    y1 = length
                c = sand(rng)
                k = 0.45 + 0.25 * (z / spring)
                c = (c[0] * k, c[1] * k * 0.98, c[2] * k * 0.95, 1)
                if y1 - y0 > 0.2:
                    blk(bm, rng, (wall_d, y1 - y0 - 0.03, ch - 0.025), (side * (half + wall_d / 2) + rng.uniform(-0.04, 0.04), (y0 + y1) / 2, z + ch / 2),
                        (0, 0, rng.uniform(-0.03, 0.03)), color=c, radius=0.4, erode=0.6, cuts=1, taper=0.0,
                        uvshrink={"bottom": 0.95, "top": 0.8, "end": 0.6})
                y = y1
            z += ch
    _kerb(bm, rng, half, 0.0, length)
    _voussoirs(bm, rng, half, thick, spring, 0.0, length, 11, course=0.8, dark=0.5)
    _backing(bm, rng, half, thick, spring, wall_d, 0.0, length)
    # Earth and fallen stones heaped over the vault (seen from outside, from afar).
    outer = {"top": 0.75, "side": 0.75, "end": 0.75, "bottom": 0.95}
    for _ in range(6):
        s = rng.uniform(0.35, 0.7)
        a = rng.uniform(0.3, 2.8)
        rr = half + thick + s * 0.2
        blk(bm, rng, (s * 1.6, s * 1.4, s), (-math.cos(a) * rr, rng.uniform(0.3, length - 0.3), spring + math.sin(a) * rr),
            (rng.uniform(-0.3, 0.3), a - math.pi / 2, rng.uniform(0, 6)), radius=0.6, erode=0.9, cuts=1, uvshrink=outer)
    drop_faces_below(bm, zmax=0.2)
    return finish_obj(name, bm, 55)


def tunnel_mouth(name, seed, half=2.9, spring=3.2, height=9.5, width=13.0, depth=1.6):
    """The portal of the vaulted tunnel: a deep arch of big voussoirs in a ragged facade of rounded
    blocks, its crest broken into columns. Faces −Y; the passage (x ∈ ±half) runs y ∈ [0, depth]."""
    rng = random.Random(seed)
    bm = bmesh.new()
    r_arch = half
    ring_t = 1.0
    # The arch ring, deeper than the facade, with a projecting keystone.
    _voussoirs(bm, rng, r_arch, ring_t, spring, -0.25, depth, 13, course=depth + 0.25, dark=0.25)
    _backing(bm, rng, r_arch, ring_t, spring, ring_t, 0.0, depth)
    _kerb(bm, rng, half, -0.25, depth)
    # Jambs under the ring.
    for side in (-1, 1):
        z = -0.35
        while z < spring - 0.05:
            ch = min(rng.uniform(0.5, 0.75), spring - z)
            blk(bm, rng, (ring_t + 0.1, depth + 0.3, ch - 0.03), (side * (half + ring_t / 2 + 0.05), depth / 2 - 0.15, z + ch / 2),
                (0, 0, rng.uniform(-0.03, 0.03)), radius=0.35, erode=0.55, cuts=2, uvshrink={"bottom": 0.95})
            z += ch
    # Facade: courses of blocks around the arch; above the ring it breaks up into ragged columns.
    z = -0.35
    rim = r_arch + ring_t + 0.05
    while z < height:
        ch = rng.uniform(0.42, 0.62)
        x = -width / 2 - rng.uniform(0, 0.4)
        while x < width / 2:
            bw = rng.uniform(0.6, 1.2)
            xc = x + bw / 2
            zc = z + ch / 2
            dz_ = zc - spring
            in_arch = (abs(xc) < rim and zc < spring) or (dz_ >= 0 and (xc * xc + dz_ * dz_) ** 0.5 < rim + 0.1)
            crest = height - 1.2 - abs(xc) * 0.38 + 1.4 * noise.noise(Vector((xc * 0.7, seed * 0.3, 0))) - rng.uniform(0, 0.8)
            if not in_arch and zc < crest:
                blk(bm, rng, (bw - 0.03, depth * rng.uniform(0.85, 1.0), ch - 0.025), (xc, depth / 2 + rng.uniform(-0.06, 0.06), zc),
                    (rng.uniform(-0.03, 0.03), 0, rng.uniform(-0.04, 0.04)), radius=0.4, erode=0.65, cuts=1,
                    uvshrink={"bottom": 0.95, "end": 0.6})
            x += bw
        z += ch
    drop_faces_below(bm, zmax=0.2)
    return finish_obj(name, bm, 55)


def facade(name, seed, width=10.0, height=13.0, depth=1.4, door=2.4, windows=2):
    """A tall ruined temple front for the vanishing point: a massive lower storey with pilasters, a dark
    doorway and a cornice, a narrower tower storey above with window slots, its top bitten into ragged,
    uneven columns. Faces −Y, base z=0 (seen from afar: its faces get fewer texels)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    far = {"top": 0.45, "side": 0.45, "end": 0.6, "bottom": 0.95}
    h1 = height * 0.5
    tw = width * rng.uniform(0.55, 0.68)
    tx = rng.uniform(-0.12, 0.12) * width

    def course_band(x0, x1, z0, z1, crest_fn, openings, pilasters, dep):
        z = z0
        while z < z1 - 0.1:
            ch = min(rng.uniform(0.62, 0.95), z1 - z)
            x = x0 - rng.uniform(0, 0.5)
            while x < x1 - 0.1:
                bw = min(rng.uniform(0.9, 1.7), x1 - x)
                xa = max(x, x0)
                bw_ = x + bw - xa
                if bw_ < 0.35:
                    x += bw
                    continue
                xc = xa + bw_ / 2
                zc = z + ch / 2
                hole = any(abs(xc - ox) < ow / 2 + 0.1 and oz0 < zc < oz1 for ox, ow, oz0, oz1 in openings)
                pil = any(abs(xc - px) < 0.6 for px in pilasters)
                if not hole and zc < crest_fn(xc):
                    blk(bm, rng, (bw_ - 0.03, dep + (0.45 if pil else 0.0), ch - 0.03), (xc, dep / 2 - (0.22 if pil else 0.0), zc),
                        (rng.uniform(-0.02, 0.02), 0, rng.uniform(-0.03, 0.03)), radius=0.35, erode=0.7, cuts=1, uvshrink=far)
                x += bw
            z += ch
        return z

    # Lower storey: nearly whole, a bite out of one corner.
    bite = rng.choice((-1, 1))
    crest1 = lambda xc: h1 + 0.5 - (2.5 * max(0.0, (bite * xc - width * 0.25) / (width * 0.25)))
    course_band(-width / 2, width / 2, -0.4, h1 + 0.6, crest1, [(tx * 0.3, door, -1, door * 1.9)],
                (-width / 2 + 0.55, width / 2 - 0.55, tx * 0.3 - door / 2 - 1.0, tx * 0.3 + door / 2 + 1.0), depth)
    blk(bm, rng, (door + 2.0, depth + 0.3, 0.8), (tx * 0.3, depth / 2 - 0.1, door * 1.9 + 0.4), radius=0.3, erode=0.6, cuts=2, uvshrink=far)
    # Cornice.
    x = -width / 2 - 0.2
    while x < width / 2:
        bw = rng.uniform(0.9, 1.5)
        xc = x + bw / 2
        if rng.random() > 0.22 and crest1(xc) > h1:
            blk(bm, rng, (bw - 0.03, depth + 0.7, 0.4), (xc, depth / 2 - 0.35, h1 + 0.8), radius=0.35, erode=0.7, cuts=1, uvshrink=far)
        x += bw
    # Tower storey: ragged columns of uneven height.
    wins = [(tx + (wi - (windows - 1) / 2) * tw * 0.45, 0.8, h1 + 2.0, h1 + 4.4) for wi in range(windows)]
    crest2 = lambda xc: height - 1.5 - 3.2 * (0.5 + 0.5 * noise.noise(Vector((xc * 0.55, seed * 0.13, 1.0)))) - abs(xc - tx) * 0.25
    course_band(tx - tw / 2, tx + tw / 2, h1 + 1.0, height, crest2, wins, (tx - tw / 2 + 0.5, tx + tw / 2 - 0.5), depth * 0.85)
    # Dark recess behind the openings.
    for ox, ow, oz0, oz1 in [(tx * 0.3, door, 0.0, door * 1.9)] + wins:
        add_block(bm, (ow + 0.5, 0.3, oz1 - max(oz0, 0.0) + 0.3), (ox, depth * 0.85, (max(oz0, 0.0) + oz1) / 2), bevel=0.0, rng=rng,
                  color=hexcol("#2a1e14"), jit=0.0)
    # Fallen blocks at its foot.
    for _ in range(8):
        s_ = rng.uniform(0.45, 0.9)
        blk(bm, rng, (s_ * 1.5, s_ * 1.2, s_), (rng.uniform(-width / 2, width / 2), rng.uniform(-2.4, -0.4), s_ * 0.3),
            (rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(0, 6)), radius=0.55, erode=0.9, cuts=1, uvshrink=far)
    drop_faces_below(bm, zmax=0.3)
    return finish_obj(name, bm, 55)


def lintel_gate(name, seed, span=6.2, post=1.1, height=7.4):
    """A trilithon over the path: two posts of stacked, worn blocks and a carved lintel (x ∈ ±span/2
    is open). Faces −Y, base z=0."""
    rng = random.Random(seed)
    bm = bmesh.new()
    for side in (-1, 1):
        z = -0.3
        ox = 0.0
        while z < height - 0.1:
            ch = min(rng.uniform(0.6, 0.95), height - z)
            ox += rng.uniform(-0.03, 0.03)
            blk(bm, rng, (post * rng.uniform(0.92, 1.02), post * rng.uniform(0.92, 1.02), ch - 0.03),
                (side * (span / 2 + post / 2) + ox, 0, z + ch / 2), (0, 0, rng.uniform(-0.06, 0.06)), radius=0.4, erode=0.6, cuts=2,
                uvshrink={"bottom": 0.95})
            z += ch
    L = span + post * 2 + 0.8
    blk(bm, rng, (L * 0.55, post * 1.1, 0.95), (-L * 0.22, 0, height + 0.47), (0, 0.02, 0.01), radius=0.3, erode=0.55, cuts=2)
    blk(bm, rng, (L * 0.47, post * 1.05, 0.9), (L * 0.27, 0.02, height + 0.45), (0, -0.03, -0.01), radius=0.3, erode=0.65, cuts=2)
    # A carved band on the lintel's face and a ragged course above, broken off at one end.
    for i in range(7):
        xc = -L / 2 + 0.7 + i * (L - 1.4) / 6
        blk(bm, rng, (0.5, 0.18, 0.5), (xc, -post * 0.55 - 0.05, height + 0.47), radius=0.5, erode=0.4, cuts=1, color=jitter_color(hexcol("#c49a68"), rng, 0.08))
    x = -L / 2 + 0.2
    while x < L / 2 * rng.uniform(0.2, 0.9):
        bw = rng.uniform(0.7, 1.2)
        blk(bm, rng, (bw - 0.03, post * 0.9, 0.5), (x + bw / 2, 0, height + 1.2), (0, rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05)),
            radius=0.4, erode=0.7, cuts=1)
        x += bw
    drop_faces_below(bm, zmax=0.2)
    return finish_obj(name, bm, 55)


def column_lone(name, seed, height=10.0, radius=0.62):
    """A lone standing column far down the causeway: a stack of worn drums on a stepped base, a
    battered capital, leaning a hair."""
    rng = random.Random(seed)
    bm = bmesh.new()
    blk(bm, rng, (radius * 3.4, radius * 3.4, 0.6), (0, 0, 0.1), color=sand(rng), radius=0.4, erode=0.6)
    blk(bm, rng, (radius * 2.8, radius * 2.8, 0.45), (0, 0, 0.62), color=sand(rng), radius=0.4, erode=0.6)
    z = 0.85
    lean = (rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02))
    while z < height - 0.2:
        h = rng.uniform(0.6, 1.0)
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=True, segments=16, radius1=radius, radius2=radius * 0.97, depth=h - 0.03)
        bmesh.ops.bevel(tmp, geom=[e for e in tmp.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.8],
                        offset=0.08, segments=2, affect="EDGES")
        off = Vector((seed, z, 0))
        for v in tmp.verts:
            v.co += noise.noise_vector(v.co * 2.0 + off) * 0.045
        m = Matrix.Translation((lean[0] * z, lean[1] * z, z + h / 2)) @ Euler((rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02), rng.uniform(0, 6))).to_matrix().to_4x4()
        bmesh.ops.transform(tmp, matrix=m, verts=tmp.verts)
        cl = tmp.loops.layers.float_color.new("Col")
        c = weathered(rng)
        for f in tmp.faces:
            for l in f.loops:
                l[cl] = c
        me = bpy.data.meshes.new("_t")
        tmp.to_mesh(me)
        tmp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        z += h
    blk(bm, rng, (radius * 3.0, radius * 3.0, 0.55), (lean[0] * z, lean[1] * z, z + 0.27), (0.03, -0.02, 0.2), radius=0.35, erode=0.8)
    drop_faces_below(bm, zmax=0.2)
    return finish_obj(name, bm, 50)
