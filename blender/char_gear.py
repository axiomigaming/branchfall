"""The runner's kit and hair: a compact leather satchel on a cross-body strap, the neckerchief,
and short hair cards over a scalp cap. Everything is conformed to the clothes it sits on."""
import math
import random

import bpy
import bmesh
from mathutils import Vector, Matrix, Euler, noise

from char_forms import V, HC, HR, smooth01
from char_sculpt import (Meta, voxel_remesh, displace, solidify, smooth_mesh, build, sweep, catmull, rect, circle, ring,
                         cyl, rounded_box, ellipsoid, xform, bvh_of, keep_faces, duplicate)
from common import link

SCARF_PTS = [Vector((0.0, -0.078, 1.515)), Vector((0.006, -0.125, 1.515)), Vector((0.012, -0.175, 1.508)), Vector((0.018, -0.225, 1.492))]


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


# ------------------------------------------------------------------ satchel
def _surface_out(bvh, o, d, reach=0.4):
    hit = bvh.ray_cast(o + d * reach, -d, reach + 0.1)
    return hit[0] if hit[0] is not None else o + d * 0.15


def satchel(shirt_bvh):
    """A compact leather satchel riding on the back of the left hip: a soft body, a flap with a
    strap and brass buckle, stitched gussets and two rings for the cross-body strap. Small and low,
    so the back, the shoulders and the arms read from behind."""
    global SATCHEL_C, SATCHEL_ENDS
    a = math.radians(140)
    d = Vector((math.sin(a), math.cos(a), 0))
    base = _surface_out(shirt_bvh, Vector((0, -0.01, 0.955)), d) + d * 0.036
    SATCHEL_C = base.copy()
    rot = Matrix.Translation(base) @ Matrix.Rotation(-a, 4, "Z")
    W, D, H = 0.2, 0.055, 0.15

    def slump(c):
        # The load sags to the bottom and bellies the outer face; the back face stays flat on the hip.
        k = (c.z + H / 2) / H
        c.y += 0.008 * math.cos(c.x / (W / 2) * math.pi / 2) * (1 - abs(2 * k - 1)) * (c.y > 0)
        c.x *= 1.0 + 0.04 * (1 - k)
    body = build("satchel", xform(rounded_box((W, D, H), (0, 0, 0), 0.018, 3, shape=slump), rot))

    def crease(p, n):
        q = p - base
        return p + n * (0.0018 * math.sin(p.z * 110 + noise.noise(p * 14) * 3) * bell(q.z, -0.05, 0.03) + 0.0012 * noise.noise(p * 35))
    for m_ in range(1):
        mm = body.modifiers.new("sub", "SUBSURF")
        mm.levels = 1
        from char_sculpt import apply_mods
        apply_mods(body)
    displace(body, crease)
    parts = [body]
    # The flap: over the top and two thirds down the outer face, a thick leather edge.
    parts.append(build("satchel_flap", xform(rounded_box((W + 0.008, D + 0.01, 0.018), (0, 0.0, H / 2 + 0.004), 0.008, 2), rot)))
    parts.append(build("satchel_flap", xform(rounded_box((W + 0.008, 0.008, 0.1), (0, D / 2 + 0.007, H / 2 - 0.05), 0.006, 2,
                                                         shape=lambda c: c.__setattr__("z", c.z - 0.012 * (1 - (c.x / (W / 2)) ** 2) * (c.z < 0))), rot)))
    # Flap strap and buckle.
    parts.append(build("satchel_strap", xform(rounded_box((0.022, 0.004, 0.09), (0, D / 2 + 0.013, 0.0), 0.0015, 1), rot)))
    parts.append(build("satchel_buckle", xform(ring((0, 0, 0), 0.012, 0.0022, axis="Y", seg=4, mseg=5), Matrix.Translation(base) @ Matrix.Rotation(-a, 4, "Z") @ Matrix.Translation((0, D / 2 + 0.016, -0.03)) @ Matrix.Rotation(math.pi / 4, 4, "Y"))))
    # Strap rings at the two top corners; the strap ends are returned for the cross-body strap.
    ends = []
    for sx in (-1, 1):
        lp = Vector((sx * (W / 2 + 0.004), 0.0, H / 2 - 0.01))
        parts.append(build("satchel_buckle", xform(ring(lp, 0.011, 0.0022, axis="X", seg=10, mseg=5), rot)))
        ends.append(rot @ (lp + Vector((0, 0, 0.012))))
    # local +x points toward the spine (world −x): ends[1] is the inner end, ends[0] the outer one.
    SATCHEL_ENDS = ends
    return parts


def satchel_strap(shirt_bvh):
    """The cross-body strap: from the satchel up across the back, over the right shoulder, down across
    the chest and round the left flank back to the bag."""
    inner, outer = SATCHEL_ENDS[1], SATCHEL_ENDS[0]
    way = [(0.04, -0.17, 1.1), (-0.03, -0.16, 1.22), (-0.09, -0.13, 1.35), (-0.115, -0.07, 1.45), (-0.11, 0.0, 1.475),
           (-0.1, 0.07, 1.42), (-0.06, 0.15, 1.32), (0.01, 0.17, 1.2), (0.08, 0.15, 1.09), (0.15, 0.09, 1.0), (0.185, 0.0, 0.97)]
    pts = [inner + Vector((0, 0, 0.01))]
    for w in way:
        loc, nrm, _, _ = shirt_bvh.find_nearest(Vector(w))
        pts.append(loc + nrm * 0.008)
    pts.append(outer + Vector((0, 0, 0.01)))
    cp = catmull(pts, 3)
    out, ups = [], []
    for i, p in enumerate(cp):
        loc, nrm, _, _ = shirt_bvh.find_nearest(p)
        if 1 < i < len(cp) - 2:
            p = loc + nrm * 0.0085
        out.append(p)
        ups.append(nrm)
    return [build("xstrap", sweep(out, rect(0.036, 0.0055, 0.002), ups=ups))]


SATCHEL_C = Vector((0.12, -0.17, 0.955))
SATCHEL_ENDS = [Vector((0.2, -0.1, 1.02)), Vector((0.05, -0.2, 1.02))]


# ------------------------------------------------------------------ neckerchief
def neckerchief(body_bvh):
    pts = []
    for k in range(28):
        a = 2 * math.pi * k / 28
        d = Vector((math.sin(a), math.cos(a), 0))
        z = 1.532 - 0.008 * max(0.0, math.cos(a))
        hit = body_bvh.ray_cast(Vector((0, 0.008, z)), d, 0.2)
        r = (hit[0] - Vector((0, 0.008, z))).length if hit[0] is not None else 0.06
        pts.append((a, z, r))
    # Smooth the radius round the neck, then sit the band clear of the collar stand beneath it.
    rs = [p[2] for p in pts]
    for _ in range(4):
        rs = [(rs[i - 1] + 2 * rs[i] + rs[(i + 1) % len(rs)]) / 4 for i in range(len(rs))]
    pts = [Vector((0, 0.008, z)) + Vector((math.sin(a), math.cos(a), 0)) * (r + 0.011) for (a, z, _), r in zip(pts, rs)]
    prof = [(0.0055 * math.cos(t), 0.012 * math.sin(t)) for t in (2 * math.pi * k / 10 for k in range(10))]
    band = build("scarf_band", sweep(pts, prof, ups=[Vector((0, 0, 1))] * 28, closed=True))
    knot = build("scarf_knot", ellipsoid(SCARF_PTS[0] + Vector((0.0, -0.012, 0.0)), (0.024, 0.017, 0.021), seg=12, rings=8,
                                         shape=lambda c: c.__iadd__(Vector((0, 0, 0.003 * math.sin(c.x * 200))))))
    tails = []
    for k, (dx, ln, wid) in enumerate(((0.016, 1.0, 0.05), (-0.022, 0.8, 0.042))):
        base = SCARF_PTS[0]
        P = [base + Vector((dx * 0.3, 0, 0))] + [base + (p - base) * ln + Vector((dx * (i + 1) / 3, -0.004 * k, 0)) for i, p in enumerate(SCARF_PTS[1:])]
        pts = catmull(P, 4)
        nn = len(pts)
        tails.append(build("scarf_tail", sweep(pts, lambda i, nn=nn, wid=wid: [(-wid * (1 - 0.6 * (i / (nn - 1)) ** 1.4) / 2, 0.0), (0, 0.003), (wid * (1 - 0.6 * (i / (nn - 1)) ** 1.4) / 2, 0.0), (0, -0.003)],
                                              ups=[Vector((0, 0, 1))] * nn)))
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
    for i in range(48):
        for j in range(21):
            ph = 2 * math.pi * (i + rng.random() * 0.8) / 48
            th = math.pi * 0.5 * (j + rng.random() * 0.8) / 21 * 1.25
            d = Vector((math.sin(ph) * math.sin(th), math.cos(ph) * math.sin(th), math.cos(th)))
            o = HC + Vector((0, -0.005, 0.0))
            hit = head_bvh.ray_cast(o + d * 0.3, -d, 0.35)
            if hit[0] is None:
                continue
            q = hit[0] - HC
            if q.z < hairline(q) + 0.0015 or q.z < -0.085:
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
        # Cropped short: a little length on top, clipped close at the sides and the nape.
        length = rng.uniform(0.022, 0.036) * (1.0 + 0.4 * top) * (0.7 if q.z < 0.0 else 1.0)
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
    # Soft shading: card normals lean toward a sphere round the skull (60 %), keeping some per-card relief.
    ctr = HC + Vector((0, -0.012, 0.004))
    me.update()
    nrm = [((v.co - ctr).normalized() * 0.6 + v.normal * 0.4).normalized() for v in me.vertices]
    me.normals_split_custom_set_from_vertices([tuple(n) for n in nrm])
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
                z = 0.026 + 0.005 * math.sin(t * math.pi * 0.9) - 0.005 * t + (k - 0.5) * 0.0018
                o = HC + Vector((x, 0.3, z))
                hit = head_bvh.ray_cast(o, Vector((0, -1, 0)), 0.5)
                pts.append((hit[0], hit[1]) if hit[0] is not None else (o, Vector((0, 1, 0))))
            rows = []
            for i, (p, n) in enumerate(pts):
                w = 0.0024 * (1 - 0.5 * i / 4)
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
