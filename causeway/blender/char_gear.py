"""The runner's kit and hair: belt, canteen, pouch, pack with bedroll and rope, straps,
neckerchief, and hair cards over a scalp cap. Everything is conformed to the clothes it sits on."""
import math
import random

import bpy
import bmesh
from mathutils import Vector, Matrix, Euler, noise

from char_forms import V, HC, HR, smooth01
from char_sculpt import (Meta, voxel_remesh, displace, solidify, smooth_mesh, build, sweep, catmull, rect, circle, ring,
                         cyl, rounded_box, ellipsoid, xform, bvh_of, keep_faces, duplicate)
from common import link

PACK_C = Vector((0, -0.222, 1.235))
ROLL_C = Vector((0, -0.215, 1.462))
CANTEEN_HANG = Vector((-0.17, -0.09, 1.02))
SCARF_PTS = [Vector((0.0, -0.075, 1.52)), Vector((0.008, -0.135, 1.548)), Vector((0.016, -0.195, 1.556)), Vector((0.024, -0.255, 1.545))]


def bell(x, c, w):
    return math.exp(-((x - c) / w) ** 2)


def around(bvh, z, off, n=36, cy=0.0, zfn=None):
    """Points around the body at height z (a belt line), `off` outside the surface."""
    pts, nrms = [], []
    for k in range(n):
        a = 2 * math.pi * k / n
        d = Vector((math.sin(a), math.cos(a), 0))
        zz = zfn(a) if zfn else z
        o = Vector((0, cy, zz))
        hit = bvh.ray_cast(o + d * 0.4, -d, 0.5)
        p = hit[0] if hit[0] is not None else o + d * 0.15
        pts.append(p + d * off)
        nrms.append(d)
    return pts, nrms


# ------------------------------------------------------------------ belt, buckle, canteen, pouch
def belt(waist_bvh):
    zf = lambda a: 1.0 - 0.006 * math.cos(a)   # dips a touch at the front
    pts, nrms = around(waist_bvh, 1.0, 0.004, 30, zfn=zf)
    band = build("belt", sweep(pts, rect(0.0065, 0.042, 0.0025), ups=[Vector((0, 0, 1))] * len(pts), closed=True))
    front = pts[0]
    n = nrms[0]
    # A brass frame buckle with its prong, the tongue of the belt through it, a keeper loop.
    frame = build("buckle", xform(ring((0, 0, 0), 0.026, 0.0035, axis="Y", seg=4, mseg=6, sy=1.0), Matrix.Translation(front + Vector((0.004, 0.009, 0))) @ Matrix.Rotation(math.pi / 4, 4, "Y") @ Matrix.Diagonal((1.0, 1.0, 0.82, 1.0))))
    prong = build("buckle_prong", cyl(front + Vector((0.0, 0.012, 0.0)), front + Vector((0.018, 0.012, 0.0)), 0.0018, seg=6, bevel=0))
    tip_pts = [front + Vector((-0.004, 0.011, 0)), front + Vector((-0.04, 0.007, 0)), front + Vector((-0.075, 0.0, 0))]
    tongue = build("belt_tip", sweep(tip_pts, rect(0.006, 0.038, 0.0025), ups=[Vector((0, 0, 1))] * 3))
    keeper = build("belt_keeper", rounded_box((0.012, 0.012, 0.05), front + Vector((-0.05, 0.004, 0)), 0.003, 1))
    return [band, frame, prong, tongue, keeper]


def canteen(waist_bvh):
    """A canvas-covered water bottle on the right hip, hung from the belt by a leather tab."""
    a = math.radians(-118)
    d = Vector((math.sin(a), math.cos(a), 0))
    hit = waist_bvh.ray_cast(Vector((0, 0, 0.93)) + d * 0.4, -d, 0.5)
    base = (hit[0] if hit[0] is not None else d * 0.15) + d * 0.045
    global CANTEEN_HANG
    CANTEEN_HANG = base + Vector((0, 0, 0.1)) - d * 0.03
    rot = Matrix.Translation(base) @ Matrix.Rotation(-a, 4, "Z")
    body = build("canteen", xform(ellipsoid((0, 0, 0), (0.06, 0.03, 0.078), seg=20, rings=12,
                                            shape=lambda c: c.__setattr__("z", max(-0.07, min(0.07, c.z * 1.1)))), rot))
    cap = build("canteen_cap", xform(cyl((0, 0, 0.07), (0, 0, 0.095), 0.014, seg=12, bevel=0.2), rot))
    tab = build("canteen_tab", xform(rounded_box((0.03, 0.006, 0.08), (0, -0.034, 0.06), 0.002, 1), rot))
    return [body, cap, tab]


def pouch(waist_bvh):
    """A leather pouch on the left front hip with a flap and a brass stud."""
    a = math.radians(52)
    d = Vector((math.sin(a), math.cos(a), 0))
    hit = waist_bvh.ray_cast(Vector((0, 0, 0.97)) + d * 0.4, -d, 0.5)
    base = (hit[0] if hit[0] is not None else d * 0.15) + d * 0.03
    rot = Matrix.Translation(base) @ Matrix.Rotation(-a, 4, "Z")

    def sag(c):
        c.y += 0.006 * math.cos(c.x / 0.06 * math.pi / 2) * (1 - abs(c.z) / 0.05)
    box = build("pouch", xform(rounded_box((0.1, 0.045, 0.085), (0, 0, -0.01), 0.014, 3, shape=sag), rot))
    flap = build("pouch_flap", xform(rounded_box((0.106, 0.052, 0.038), (0, 0.003, 0.022), 0.01, 2), rot))
    stud = build("pouch_stud", xform(ellipsoid((0, 0.03, 0.01), (0.007, 0.004, 0.007), seg=10, rings=6), rot))
    return [box, flap, stud]


# ------------------------------------------------------------------ pack
def pack():
    """A worn leather rucksack: soft body, a flap with two straps and buckles, a front pocket,
    a rope coil on its right side and a canvas bedroll strapped across the top."""
    m = Meta("mpack", 0.004, stiff=3.0)
    c = PACK_C
    for dx in (-0.09, 0.0, 0.09):
        for dz in (-0.1, 0.0, 0.1):
            m.ell(c + Vector((dx, 0.0, dz)), (0.07, 0.07, 0.085))
    m.ell(c + Vector((0, -0.03, -0.13)), (0.14, 0.055, 0.05))   # the load sagging to the bottom
    body = m.mesh("pack")
    voxel_remesh(body, 0.003)

    def crease(p, n):
        q = p.copy()
        # Leather wrinkles, a slight slump, stitched seams round the side panels.
        q += n * 0.0025 * math.sin(p.z * 80 + noise.noise(p * 12) * 3) * smooth01((abs(p.x) - 0.1) / 0.04)
        q += n * 0.0015 * noise.noise(p * 30)
        seam = bell(abs(p.x - c.x), 0.128, 0.0025) * smooth01((p.y - c.y + 0.02) / 0.02)
        q -= n * 0.0015 * seam
        return q
    displace(body, crease)
    parts = [body]
    # The flap over the top and down the back, with a thick edge.
    flap = []
    for i in range(9):
        x = -0.155 + 0.31 * i / 8
        row = []
        for j in range(8):
            v = j / 7
            if v < 0.35:
                u = v / 0.35
                p = Vector((x, c.y + 0.06 - 0.12 * u, c.z + 0.155 + 0.02 * math.sin(u * math.pi)))
            else:
                u = (v - 0.35) / 0.65
                p = Vector((x, c.y - 0.075 - 0.004 * math.sin(u * math.pi), c.z + 0.15 - 0.17 * u))
            row.append(p)
        flap.append(row)
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in row] for row in flap]
    for i in range(8):
        for j in range(7):
            bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
    me = bpy.data.meshes.new("pack_flap")
    bm.to_mesh(me)
    bm.free()
    fo = bpy.data.objects.new("pack_flap", me)
    link(fo)
    solidify(fo, 0.006, offset=1.0)
    parts.append(fo)
    parts.append(build("pack_pocket", rounded_box((0.19, 0.05, 0.12), c + Vector((0, -0.095, -0.075)), 0.02, 3)))
    parts.append(build("pack_pocket_flap", rounded_box((0.198, 0.056, 0.04), c + Vector((0, -0.098, -0.018)), 0.012, 2)))
    for sx in (1, -1):
        x = sx * 0.075
        parts.append(build("pack_strap", sweep([c + Vector((x, -0.085, 0.14)), c + Vector((x, -0.087, 0.04)), c + Vector((x, -0.12, -0.03)), c + Vector((x, -0.123, -0.1))],
                                                rect(0.024, 0.005, 0.002), ups=[Vector((0, -1, 0))] * 4)))
        parts.append(build("pack_buckle", xform(ring((0, 0, 0), 0.013, 0.0022, axis="Y", seg=4, mseg=5), Matrix.Translation(c + Vector((x, -0.093, 0.035))) @ Matrix.Rotation(math.pi / 4, 4, "Y"))))
    # Rope coil on the right.
    for k, (dx, r) in enumerate(((-0.168, 0.064), (-0.182, 0.058), (-0.176, 0.052))):
        parts.append(build("rope", ring(c + Vector((dx, 0.0, -0.035 - 0.004 * k)), r, 0.0105, axis="X", seg=22, mseg=6,
                                        wob=lambda a, k=k: 0.004 * math.sin(a * 3 + k))))
    parts.append(build("rope_tie", ring(c + Vector((-0.175, 0.0, 0.02)), 0.02, 0.005, axis="Y", seg=10, mseg=5)))
    return parts


def bedroll():
    parts = []
    L = 0.22
    bm_ = build("bedroll", cyl(ROLL_C + Vector((-L, 0, 0)), ROLL_C + Vector((L, 0, 0)), 0.07, seg=24, bevel=0.35))
    # A spiral seam and slumped middle.
    def roll(p, n):
        q = p.copy()
        a = math.atan2(p.z - ROLL_C.z, p.y - ROLL_C.y)
        q += n * (0.0022 * math.sin(a + p.x * 40) + 0.0012 * noise.noise(p * 25))
        q.z -= 0.008 * (1 - (p.x / L) ** 2) * smooth01((p.z - ROLL_C.z) / 0.07)
        return q
    for _ in range(2):
        m = bm_.modifiers.new("sub", "SUBSURF")
        m.levels = 1
        from char_sculpt import apply_mods
        apply_mods(bm_)
    displace(bm_, roll)
    parts.append(bm_)
    for sx in (1, -1):
        parts.append(build("roll_tie", ring(ROLL_C + Vector((sx * 0.13, 0, 0)), 0.072, 0.0055, axis="X", seg=20, mseg=4, flat=0.4)))
    return parts


def straps(shirt_bvh):
    """Shoulder straps over the trapezius, down the chest, under the arms and back to the pack."""
    out = []
    for s, sx in (("L", 1), ("R", -1)):
        spec = [
            ((sx * 0.085, -0.13, 1.42), (0, -1, 0.2)),
            ((sx * 0.09, -0.07, 1.47), (0, -0.3, 1)),
            ((sx * 0.1, 0.0, 1.48), (0, 0.3, 1)),
            ((sx * 0.105, 0.04, 1.42), (sx * 0.1, 1, 0.3)),
            ((sx * 0.11, 0.06, 1.33), (sx * 0.15, 1, 0)),
            ((sx * 0.13, 0.05, 1.23), (sx * 0.5, 1, 0)),
            ((sx * 0.16, 0.0, 1.17), (sx * 1, 0.2, 0)),
            ((sx * 0.13, -0.08, 1.15), (sx * 0.8, -0.6, 0)),
            ((sx * 0.1, -0.13, 1.12), (0, -1, 0)),
        ]
        pts, ups = [], []
        for o, d in spec:
            loc, nrm, _, _ = shirt_bvh.find_nearest(Vector(o))
            pts.append(loc + nrm * 0.0055)
            ups.append(nrm)
        cp = catmull(pts, 3)
        cu = []
        for p in cp:
            loc, nrm, _, _ = shirt_bvh.find_nearest(p)
            cu.append(nrm)
        cp = [shirt_bvh.find_nearest(p)[0] + n * 0.0055 for p, n in zip(cp, cu)]
        out.append(build("strap", sweep(cp, rect(0.042, 0.006, 0.002), ups=cu)))
        loc, nrm, _, _ = shirt_bvh.find_nearest(Vector((sx * 0.11, 0.2, 1.33)))
        q = nrm.to_track_quat("Y", "Z").to_matrix().to_4x4()
        out.append(build("strap_buckle", xform(ring((0, 0, 0), 0.022, 0.003, axis="Y", seg=4, mseg=5), Matrix.Translation(loc + nrm * 0.011) @ q @ Matrix.Rotation(math.pi / 4, 4, "Y"))))
        out.append(build("strap_pad", xform(rounded_box((0.05, 0.01, 0.06), (0, 0, 0), 0.004, 2), Matrix.Translation(loc + nrm * 0.008) @ q)))
    # Sternum strap.
    ends = []
    for sx in (1, -1):
        loc, nrm, _, _ = shirt_bvh.find_nearest(Vector((sx * 0.105, 0.2, 1.36)))
        ends.append(loc + nrm * 0.011)
    loc, nrm, _, _ = shirt_bvh.find_nearest(Vector((0, 0.2, 1.36)))
    mid = loc + nrm * 0.014
    out.append(build("sternum", sweep(catmull([ends[0], mid, ends[1]], 3), rect(0.018, 0.005, 0.002), ups=[Vector((0, 1, 0))] * 7)))
    out.append(build("sternum_clip", rounded_box((0.03, 0.008, 0.022), mid + Vector((0, 0.004, 0)), 0.004, 1)))
    return out


# ------------------------------------------------------------------ neckerchief
def neckerchief(body_bvh):
    pts = []
    for k in range(28):
        a = 2 * math.pi * k / 28
        d = Vector((math.sin(a), math.cos(a), 0))
        z = 1.515 - 0.012 * max(0.0, math.cos(a)) + 0.004 * math.sin(a * 3)
        hit = body_bvh.ray_cast(Vector((0, 0.008, z)), d, 0.2)
        p = (hit[0] if hit[0] is not None else Vector((0, 0.008, z)) + d * 0.06) + d * 0.009
        pts.append(p)
    band = build("scarf_band", sweep(pts, lambda i: [(-0.003, -0.016), (0.004, -0.018), (0.006, 0.0), (0.004, 0.018), (-0.003, 0.016), (-0.005, 0.0)],
                                     ups=[Vector((0, 0, 1))] * 28, closed=True))
    knot = build("scarf_knot", ellipsoid(SCARF_PTS[0] + Vector((0.0, -0.004, -0.004)), (0.024, 0.017, 0.02), seg=12, rings=8,
                                         shape=lambda c: c.__iadd__(Vector((0, 0, 0.003 * math.sin(c.x * 200))))))
    tails = []
    for k, (dx, ln, wid) in enumerate(((0.016, 1.0, 0.05), (-0.022, 0.8, 0.042))):
        base = SCARF_PTS[0]
        P = [base + Vector((dx * 0.3, 0, 0))] + [base + (p - base) * ln + Vector((dx * (i + 1) / 3, -0.004 * k, 0)) for i, p in enumerate(SCARF_PTS[1:])]
        pts = catmull(P, 4)
        nn = len(pts)
        tails.append(build("scarf_tail", sweep(pts, lambda i, nn=nn, wid=wid: [(-wid * (1 - 0.6 * (i / (nn - 1)) ** 1.4) / 2, 0.0), (0, 0.003), (wid * (1 - 0.6 * (i / (nn - 1)) ** 1.4) / 2, 0.0), (0, -0.003)],
                                              ups=[Vector((0, -1, 0.3))] * nn)))
    return band, knot, tails


# ------------------------------------------------------------------ hair
def hairline(q):
    """Head-local height above which the scalp carries hair."""
    x, y, z = q
    d = Vector((x / HR.x, y / HR.y, z / 0.104)).normalized()
    front = smooth01((d.y - 0.1) / 0.6)
    temple = 0.05 * smooth01((abs(x) - 0.02) / 0.04)
    h_front = 0.075 - temple * 0.3 - 0.006 * math.cos(x * 60)
    h_side = 0.03 - 0.055 * smooth01((-d.y + 0.2) / 0.9)   # down to the nape at the back
    # Sideburns in front of the ears.
    sb = bell(abs(x), 0.07, 0.01) * bell(y, 0.012, 0.012)
    return h_side + (h_front - h_side) * front + 0.002 * noise.noise(Vector(q) * 25) - 0.03 * sb


def scalp_cap(head):
    """The hair's base layer: a thin shell over the scalp that dips under the skin at the hairline."""
    cap = duplicate(head, "hair_cap")
    keep_faces(cap, lambda c, n: (c - HC).z > hairline(c - HC) - 0.012 and (c - HC).z > -0.1)

    def push(p, n):
        q = p - HC
        above = q.z - hairline(q)
        k = max(-1.0, min(1.0, above / 0.01))
        top = smooth01((q.z - 0.02) / 0.08)
        thick = (0.0035 + 0.003 * top) * smooth01(k) if k > 0 else 0.002 * k
        return p + n * thick
    displace(cap, push)
    return cap


def hair_cards(head_bvh, seed=11):
    """Clumps of hair as curved ribbons laid over the scalp: swept back and up on top, down at the
    sides and nape; overlapping rows give volume. UVs: u across the card, v root→tip."""
    rng = random.Random(seed)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    count = 0
    # Seed roots on a jittered grid over the scalp (head-local spherical coords).
    roots = []
    for i in range(44):
        for j in range(20):
            ph = 2 * math.pi * (i + rng.random() * 0.8) / 44
            th = math.pi * 0.5 * (j + rng.random() * 0.8) / 20 * 1.25
            d = Vector((math.sin(ph) * math.sin(th), math.cos(ph) * math.sin(th), math.cos(th)))
            o = HC + Vector((0, -0.005, 0.0))
            hit = head_bvh.ray_cast(o + d * 0.3, -d, 0.35)
            if hit[0] is None:
                continue
            q = hit[0] - HC
            if q.z < hairline(q) + 0.004 or q.z < -0.085:
                continue
            roots.append((hit[0], hit[1]))
    for (p0, n0) in roots:
        q = p0 - HC
        top = smooth01((q.z - 0.03) / 0.06)
        front = smooth01((q.y - 0.02) / 0.06)
        # Growth direction: back over the crown, down at the sides and nape, a slight part on the left.
        back = Vector((0, -1, 0))
        down = Vector((0, 0, -1))
        side = Vector((math.copysign(1, q.x), 0, 0))
        g = (back * (0.9 * top + 0.25) + down * (1 - top) * 1.1 + side * 0.25 * (1 - top) + Vector((0, 0, 0.35)) * front * top)
        g = (g - n0 * g.dot(n0)).normalized()
        length = rng.uniform(0.035, 0.06) * (1.0 + 0.3 * top) * (0.75 if q.z < 0.0 else 1.0)
        width = rng.uniform(0.011, 0.017)
        lift = rng.uniform(0.002, 0.006) * (0.5 + top)
        nseg = 3
        pts, nrms = [], []
        p = p0 + n0 * 0.0015
        dirv = g.copy()
        for k in range(nseg + 1):
            t = k / nseg
            # Keep off the scalp: offset grows toward the tip, then lies back down.
            hit = head_bvh.find_nearest(p)
            base, nn = (hit[0], hit[1]) if hit[0] is not None else (p, n0)
            h = 0.0015 + lift * math.sin(min(1.0, t * 1.4) * math.pi * 0.6)
            pts.append(base + nn * h)
            nrms.append(nn)
            p = base + nn * h + dirv * (length / nseg)
            dirv = (dirv - nn * dirv.dot(nn) * 0.8 + Vector((rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.1))) * 0.25).normalized()
        u0 = rng.choice((0.0, 0.25, 0.5, 0.75))
        rows = []
        for k, (pt, nn) in enumerate(zip(pts, nrms)):
            t = k / nseg
            tan = (pts[min(nseg, k + 1)] - pts[max(0, k - 1)]).normalized()
            s_ = tan.cross(nn).normalized()
            w = width * (1 - 0.45 * t)
            rows.append((bm.verts.new(pt - s_ * w / 2 + nn * 0.001 * (1 - t)), bm.verts.new(pt + s_ * w / 2), t))
        for k in range(nseg):
            a, b = rows[k], rows[k + 1]
            f = bm.faces.new((a[0], a[1], b[1], b[0]))
            for lp, uv in zip(f.loops, ((u0, a[2]), (u0 + 0.25, a[2]), (u0 + 0.25, b[2]), (u0, b[2]))):
                lp[uvl].uv = (uv[0], 1 - uv[1] * 0.98)
        count += 1
    me = bpy.data.meshes.new("hair_cards")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("hair_cards", me)
    link(ob)
    for p in me.polygons:
        p.use_smooth = True
    print("hair cards:", count, flush=True)
    return ob


def brow_cards(head_bvh):
    """Eyebrows: a few short cards lying along the brow ridge, thicker toward the nose."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    for sx in (1, -1):
        for k in range(2):
            pts = []
            for i in range(5):
                t = i / 4
                x = sx * (0.012 + 0.04 * t)
                z = 0.029 + 0.005 * math.sin(t * math.pi * 0.9) - 0.004 * t + (k - 0.5) * 0.002
                o = HC + Vector((x, 0.3, z))
                hit = head_bvh.ray_cast(o, Vector((0, -1, 0)), 0.5)
                pts.append((hit[0], hit[1]) if hit[0] is not None else (o, Vector((0, 1, 0))))
            rows = []
            for i, (p, n) in enumerate(pts):
                w = 0.0045 * (1 - 0.55 * i / 4)
                up = Vector((0, 0, 1))
                up = (up - n * up.dot(n)).normalized()
                rows.append((bm.verts.new(p + n * 0.0012 - up * w / 2), bm.verts.new(p + n * 0.0016 + up * w / 2)))
            u0 = 0.25 * k
            for i in range(4):
                a, b = rows[i], rows[i + 1]
                f = bm.faces.new((a[0], b[0], b[1], a[1]))
                for lp, uv in zip(f.loops, ((u0, i / 4), (u0, (i + 1) / 4), (u0 + 0.25, (i + 1) / 4), (u0 + 0.25, i / 4))):
                    lp[uvl].uv = (uv[0], 1 - uv[1] * 0.6)
    me = bpy.data.meshes.new("brows")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("brows", me)
    link(ob)
    return ob


def hair_texture(path, size=(256, 512), seed=5):
    """Strands with alpha: dark brown with sun-lightened ends, tapering at the tip."""
    import numpy as np
    rng = np.random.default_rng(seed)
    w, h = size
    col = np.zeros((h, w, 3), np.float32)
    alpha = np.zeros((h, w), np.float32)
    base = np.array([0.045, 0.028, 0.017])
    tip = np.array([0.11, 0.07, 0.042])
    for _ in range(900):
        x = rng.uniform(0, w)
        L = rng.uniform(0.55, 1.0) * h
        wid = rng.uniform(0.8, 2.2)
        curve = rng.uniform(-6, 6)
        shade = rng.uniform(0.6, 1.35)
        ys = np.arange(int(L))
        t = ys / h
        xs = x + curve * t ** 2
        for yy, xx in zip(ys, xs):
            x0 = int(xx - wid - 1)
            for xi in range(max(0, x0), min(w, x0 + int(wid * 2) + 3)):
                a = max(0.0, 1 - abs(xi - xx) / wid) * (1 - (yy / L) ** 3)
                if a > alpha[yy, xi]:
                    alpha[yy, xi] = a
                    c = base + (tip - base) * min(1.0, (yy / h) ** 1.5 * 1.2)
                    col[yy, xi] = c * shade
    # Four columns of cards share the sheet: vary density per column so neighbours differ.
    img = np.concatenate([col, np.clip(alpha * 1.25, 0, 1)[..., None]], axis=2)
    img = img[::-1]  # Blender images are bottom-up; v=1 is the root row
    im = bpy.data.images.new("hair_strands", w, h, alpha=True)
    im.pixels[:] = img.ravel()
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    return im
