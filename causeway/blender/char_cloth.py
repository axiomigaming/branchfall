"""The runner's clothes: shells tailored from the sculpted body, with folds, seams and edges.

Every garment is built twice over: a dense `_hi` surface (folds, seams and stitches in the
geometry, for the bake) and a light game mesh decimated from it (see build_runner.py).
"""
import math

import bpy
import bmesh
from mathutils import Vector, Matrix, noise

from char_forms import V, HC, smooth01
from char_sculpt import (Meta, voxel_remesh, keep_faces, displace, solidify, smooth_mesh, duplicate, build, sweep,
                         catmull, rect, circle, ring, cyl, rounded_box, ellipsoid, mirror_x, bvh_of, apply_mods)

SLEEVE_T = 1.1   # the rolled sleeve sits just below the elbow (0 shoulder, 1 elbow, 2 wrist)
HEM_Z = 0.984    # shirt tucked in to here (under the belt)
WAIST_Z = 1.018  # trouser waistband top
BOOT_Z = 0.215   # trousers end inside the boot shaft


def bell(x, c, w):
    return math.exp(-((x - c) / w) ** 2)


def seg_param(c, pts):
    """(t, dist, point, axis dir): projection onto a polyline; t counts whole segments."""
    best = (1e9, 0.0, None, None)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        d = b - a
        t = max(0.0, min(1.0, (c - a).dot(d) / d.length_squared))
        p = a + d * t
        dist = (c - p).length
        if dist < best[0]:
            best = (dist, i + t, p, d.normalized())
    return best[1], best[0], best[2], best[3]


def arm_pts(s):
    return [V[f"shoulder.{s}"] + Vector((0, 0, 0.02)), V[f"elbow.{s}"], V[f"wrist.{s}"]]


def side(c):
    return "L" if c.x > 0 else "R"


def arm_info(c):
    """(is_arm, t, dist, axis point, axis dir) for a body point."""
    s = side(c)
    t, d, p, ax = seg_param(c, arm_pts(s))
    ax_ = abs(c.x)
    is_arm = c.z < 1.49 and d < 0.09 and ax_ > 0.158 and (c.z < 1.36 or ax_ > 0.175 or t > 0.25)
    return is_arm, t, d, p, ax


NECK_R = 0.066


def in_neck(c, grow=0.0):
    """Above the shirt's neckline: within the neck column."""
    r = math.hypot(c.x, c.y - 0.006)
    return c.z > 1.43 - grow and r < NECK_R + grow + 0.4 * max(0.0, c.z - 1.5)


def arm_at(s, t):
    P = arm_pts(s)
    i = min(1, int(t))
    return P[i].lerp(P[i + 1], t - i), (P[i + 1] - P[i]).normalized()


def in_v(c, grow=0.0):
    """Inside the open-collar V (two buttons undone)."""
    return c.y > 0.0 and c.z > 1.352 - grow and abs(c.x) < 0.006 + grow + (c.z - 1.352) * 0.92


# ------------------------------------------------------------------ zones on the body surface
def shirt_zone(c, n=None):
    if c.z < HEM_Z:
        return False
    arm, t, *_ = arm_info(c)
    if arm:
        return t < SLEEVE_T
    if in_neck(c):
        return False
    return not in_v(c)


def skin_zone(c, n=None):
    arm, t, *_ = arm_info(c)
    if arm:
        return SLEEVE_T - 0.12 < t < 2.02
    if in_neck(c, 0.02):
        return True
    return in_v(c, 0.03)


def trouser_zone(c, n=None):
    if c.z > WAIST_Z or c.z < BOOT_Z:
        return False
    arm, t, d, *_ = arm_info(c)
    return not (arm and d < 0.05)


# ------------------------------------------------------------------ displacement (folds)
def shirt_disp(c, n):
    arm, t, dist, p, ax = arm_info(c)
    nz = noise.noise(c * 18)
    off = 0.0055
    if arm:
        # A loose linen sleeve, fuller toward the roll; compression folds near the roll and the crook.
        r = c - p
        ang = math.atan2(r.dot(Vector((0, 1, 0)).cross(ax).normalized()), r.y)
        off += 0.001 + 0.009 * smooth01((t - 0.15) / 0.85)
        k = smooth01((t - 0.35) / 0.4)
        off += 0.0032 * k * math.sin(t * 58 + 2.2 * math.sin(ang * 2 + 1.3) + nz * 2.5)
        off += 0.002 * math.sin(ang * 5 + t * 9 + nz * 2) * (1 - k) * smooth01(t / 0.2)
        # Pull toward the underarm, where the sleeve meets the body.
        off -= 0.004 * bell(t, 0.05, 0.08) * max(0.0, -r.normalized().x * (1 if c.x > 0 else -1))
    else:
        x, y, z = c
        back = smooth01((-y + 0.02) / 0.1)
        # Blousing over the belt, more at the back; gathers where the shirt is tucked.
        b = bell(z, 1.045, 0.05)
        off += b * (0.008 + 0.012 * back)
        a = math.atan2(x, y)
        off += 0.0045 * bell(z, 1.0, 0.04) * math.sin(a * 24 + nz * 3.0)
        # Diagonal tension folds from the chest and shoulder blades toward the waist, on the flanks.
        flank = smooth01((abs(x) - 0.05) / 0.07) * bell(z, 1.18, 0.12)
        off += 0.0028 * flank * math.sin((z * 1.0 - abs(x) * 1.25) * 72 + nz * 2.2)
        # Folds radiating from the armpit.
        ap = Vector((math.copysign(0.15, x), -0.005, 1.33))
        dap = (c - ap).length
        off += 0.0022 * bell(dap, 0.05, 0.04) * math.sin(math.atan2(z - ap.z, y - ap.y) * 7 + nz)
        # Across the chest: the shirt drapes from the pecs.
        off += 0.002 * bell(z, 1.27, 0.03) * smooth01((y - 0.03) / 0.05) * math.sin(x * 60 + nz * 2)
        # Back yoke: flatter across the shoulder blades.
        off -= 0.002 * back * bell(z, 1.38, 0.05)
    off += 0.0012 * noise.noise(c * 40)
    return c + n * off


def trouser_disp(c, n):
    x, y, z = c
    s = side(c)
    t, dist, p, ax = seg_param(c, [V[f"hip.{s}"], V[f"knee.{s}"], V[f"ankle.{s}"]])
    nz = noise.noise(c * 15)
    off = 0.007
    # Loose canvas thighs and shins; the waistband snug under the belt.
    off += 0.012 * smooth01((z - 0.35) / 0.2) * smooth01((0.93 - z) / 0.12)
    off += 0.008 * smooth01((0.5 - z) / 0.15)
    off -= 0.003 * smooth01((z - 0.97) / 0.03)
    r = (c - p)
    rn = r.normalized() if r.length > 1e-6 else Vector((0, 1, 0))
    backk = max(0.0, -rn.y)
    frontk = max(0.0, rn.y)
    # Behind the knee: stacked horizontal folds; in front, the fabric pulls over the kneecap.
    off += 0.0045 * backk * bell(z, 0.52, 0.06) * math.sin(z * 170 + nz * 2.5)
    off += 0.002 * frontk * bell(z, 0.5, 0.05) * math.sin(z * 90 + x * 40 + nz)
    # Diagonal folds from the crotch down the inner thigh; the seat.
    inner = max(0.0, -rn.x if x > 0 else rn.x)
    off += 0.0025 * inner * bell(z, 0.78, 0.1) * math.sin((z + abs(x) * 1.5) * 90 + nz * 2)
    # Bloused over the boot tops, folds bunching.
    blouse = bell(z, 0.265, 0.045)
    off += blouse * (0.011 + 0.004 * math.sin(math.atan2(rn.x, rn.y) * 6 + nz * 3) + 0.003 * math.sin(z * 200 + nz * 2))
    # Gathers at the waist under the belt.
    off += 0.002 * bell(z, 0.99, 0.03) * math.sin(math.atan2(x, y) * 30 + nz * 2)
    off += 0.0012 * noise.noise(c * 35)
    return c + n * off


def shell(body, name, zone, disp, smooth=1):
    ob = duplicate(body, name)
    keep_faces(ob, lambda c, n: zone(c))
    displace(ob, disp)
    if smooth:
        smooth_mesh(ob, 0.35, smooth)
    return ob


def conform(bvh, p, off):
    """Snap p to the nearest surface point pushed out by `off`."""
    loc, nrm, _, _ = bvh.find_nearest(p)
    if loc is None:
        return p
    return loc + nrm * off


# ------------------------------------------------------------------ collar, placket, buttons, pockets
def neck_ring(body_bvh, a, z, off):
    d = Vector((math.sin(a), math.cos(a), 0))
    o = Vector((0, 0.008, z))
    hit = body_bvh.ray_cast(o, d, 0.3)
    base = hit[0] if hit[0] is not None else o + d * 0.065
    return base + d * off, d


def collar(body_bvh, shirt_bvh):
    """A soft collar: a stand around the neck, the leaves turned down over it, open at the throat."""
    NA, NV = 44, 8
    a0 = 0.55
    grid = []
    for i in range(NA + 1):
        a = a0 + (2 * math.pi - 2 * a0) * i / NA   # from the front-left, round the back, to the front-right
        fa = min(a, 2 * math.pi - a)                  # 0 at the throat, pi at the nape
        front = smooth01((1.7 - fa) / 1.1)
        d = Vector((math.sin(a), math.cos(a), 0))
        # Find the neckline on the body along this direction (where the shirt starts).
        base = None
        z = 1.58
        while z > 1.36:
            hit, _ = neck_ring(body_bvh, a, z, 0.0)
            r = math.hypot(hit.x, hit.y - 0.006)
            if r >= NECK_R + 0.4 * max(0.0, z - 1.5) - 0.003:
                base = hit + d * 0.0045
                break
            z -= 0.003
        if base is None:
            base, _ = neck_ring(body_bvh, a, 1.45, 0.0045)
        base.z -= 0.012 + 0.004 * front
        base += d * 0.004
        top = base + Vector((0, 0, 0.032 - 0.01 * front)) - d * 0.003
        L = 0.052 + 0.028 * front
        row = []
        for j in range(NV + 1):
            v = j / NV
            if v <= 0.25:
                u = v / 0.25
                p = base.lerp(top, u)
            else:
                u = (v - 0.25) / 0.75
                out = (d * (0.62 - 0.1 * front) + Vector((0, 0, -0.78))).normalized()
                p = top + d * 0.006 * math.sin(min(1.0, u * 2.5) * math.pi / 2) + out * L * u
                p.z -= 0.012 * front * u * u
                loc, nrm, _, _ = shirt_bvh.find_nearest(p)
                if loc is not None and (loc - p).length < 0.05:
                    depth = (p - loc).dot(nrm)
                    if depth < 0.0055:
                        p = p + nrm * (0.0055 - depth)
            row.append(p)
        grid.append(row)
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in row] for row in grid]
    for i in range(NA):
        for j in range(NV):
            bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
    me = bpy.data.meshes.new("collar")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("collar", me)
    bpy.context.scene.collection.objects.link(ob)
    smooth_mesh(ob, 0.5, 2)
    solidify(ob, 0.0028, offset=0.0)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def placket(shirt_bvh):
    """The button band from the V to the belt, and its buttons; the open fronts turned back."""
    pts = [conform(shirt_bvh, Vector((0.0, 0.2, z)), 0.0015) for z in (1.35, 1.29, 1.22, 1.15, 1.08, 1.0, 0.975)]
    pts = catmull(pts, 3)
    ups = []
    for p in pts:
        loc, nrm, _, _ = shirt_bvh.find_nearest(p)
        ups.append(nrm)
    band = build("placket", sweep(pts, rect(0.03, 0.0026, 0.001), ups=ups))
    buttons = []
    for z in (1.325, 1.245, 1.165, 1.085):
        loc, nrm, _, _ = shirt_bvh.find_nearest(Vector((0, 0.2, z)))
        p = loc + nrm * 0.003
        b = build(f"button", cyl(p - nrm * 0.0015, p + nrm * 0.0015, 0.0058, seg=10, bevel=0.35))
        buttons.append(b)
    # The open fronts fold back a little either side of the V (small revers).
    revs = []
    for sx in (1, -1):
        edge = []
        for k in range(7):
            z = 1.352 + k * 0.018
            x = sx * (0.006 + (z - 1.352) * 0.92)
            loc, nrm, _, _ = shirt_bvh.find_nearest(Vector((x, 0.2, z)))
            edge.append((loc, nrm))
        bm = bmesh.new()
        rows = []
        for (loc, nrm) in edge:
            out = Vector((sx, 0.2, 0)).normalized()
            w = 0.006 + 0.016 * smooth01((loc.z - 1.352) / 0.1)
            rows.append([bm.verts.new(loc + nrm * 0.002), bm.verts.new(loc + nrm * 0.004 + out * w)])
        for i in range(len(rows) - 1):
            bm.faces.new((rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]))
        me = bpy.data.meshes.new("revers")
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new("revers", me)
        bpy.context.scene.collection.objects.link(ob)
        solidify(ob, 0.002, offset=0.0)
        revs.append(ob)
    return band, buttons, revs


def patch(bvh, centre, w, h, off, name, bulge=0.0, nu=10, nv=10, shape=None):
    """A rectangular patch conformed to a surface (pockets, flaps), as a thin solid."""
    loc, nrm, _, _ = bvh.find_nearest(centre)
    up = Vector((0, 0, 1))
    right = up.cross(nrm).normalized()
    up = nrm.cross(right).normalized()
    bm = bmesh.new()
    vs = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            u, v = i / nu - 0.5, j / nv - 0.5
            if shape:
                u, v = shape(u, v)
            p = loc + right * (u * w) + up * (v * h)
            q = conform(bvh, p, off + bulge * math.cos(u * math.pi) * math.cos(v * math.pi))
            row.append(bm.verts.new(q))
        vs.append(row)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    solidify(ob, 0.0025, offset=1.0)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def chest_pockets(shirt_bvh):
    out = []
    for sx in (1, -1):
        c = Vector((sx * 0.085, 0.2, 1.29))
        out.append(patch(shirt_bvh, c, 0.07, 0.078, 0.0015, "pocket", bulge=0.003))
        out.append(patch(shirt_bvh, c + Vector((0, 0, 0.034)), 0.076, 0.026, 0.0045, "pocket_flap", bulge=0.001,
                         shape=lambda u, v: (u, v - 0.35 * (0.5 - abs(u)) * (v < 0))))
    return out


def rolled_cuffs(body_bvh):
    """Two turns of rolled linen above each elbow, uneven and creased."""
    out = []
    for s in "LR":
        for k, (t, minor, extra) in enumerate(((SLEEVE_T - 0.03, 0.0125, 0.016), (SLEEVE_T - 0.13, 0.0115, 0.019))):
            c, ax = arm_at(s, t)
            e1 = ax.cross(Vector((0, 1, 0))).normalized()
            e2 = ax.cross(e1).normalized()
            NA, NM = 28, 8
            bm = bmesh.new()
            rings_ = []
            for i in range(NA):
                a = 2 * math.pi * i / NA
                d = e1 * math.cos(a) + e2 * math.sin(a)
                hit = body_bvh.ray_cast(c, d, 0.2)
                r = ((hit[0] - c).length if hit[0] is not None else 0.05) + extra
                r += 0.003 * noise.noise(Vector((a * 1.3, k * 5.0, 0.3)) * 1.7)
                cz = c + ax * (0.004 * math.sin(a * 2 + k) + 0.003 * noise.noise(Vector((a, k, 1.0))))
                row = []
                for j in range(NM):
                    b = 2 * math.pi * j / NM
                    mn = minor * (1 + 0.15 * noise.noise(Vector((a * 2.0, b, k))))
                    row.append(bm.verts.new(cz + d * (r + mn * 0.75 * math.cos(b)) + ax * (mn * math.sin(b))))
                rings_.append(row)
            for i in range(NA):
                for j in range(NM):
                    bm.faces.new((rings_[i][j], rings_[(i + 1) % NA][j], rings_[(i + 1) % NA][(j + 1) % NM], rings_[i][(j + 1) % NM]))
            me = bpy.data.meshes.new("cuff")
            bm.to_mesh(me)
            bm.free()
            ob = bpy.data.objects.new("cuff", me)
            bpy.context.scene.collection.objects.link(ob)
            for p in me.polygons:
                p.use_smooth = True
            ob["side"] = s
            out.append(ob)
    return out


def cargo_pocket(tr_bvh, sx):
    c = Vector((sx * 0.2, 0.0, 0.7))
    return [patch(tr_bvh, c, 0.09, 0.12, 0.002, "cargo", bulge=0.008),
            patch(tr_bvh, c + Vector((0, 0, 0.058)), 0.095, 0.035, 0.009, "cargo_flap", bulge=0.002)]


# ------------------------------------------------------------------ boots
def boot_hi(sx):
    """A laced leather field boot (left, mirrored for right): upper, sole with heel, tongue, laces."""
    m = Meta("mboot" + ("L" if sx > 0 else "R"), 0.0022, stiff=2.0)
    X = 0.112
    m.ell((X, -0.058, 0.052), (0.043, 0.048, 0.048))                 # heel
    m.ell((X, 0.035, 0.046), (0.047, 0.1, 0.044))                   # vamp
    m.ell((X + 0.002, 0.125, 0.038), (0.043, 0.055, 0.033))         # toe box
    m.cap((X - 0.002, -0.012, 0.07), (X - 0.002, -0.012, 0.235), 0.06)  # shaft
    m.cap((X, 0.0, 0.1), (X, 0.075, 0.064), 0.034)                  # instep
    up = m.mesh("boot_upper")
    voxel_remesh(up, 0.0022)

    def shape(c, n):
        x, y, z = c
        c = c.copy()
        if z < 0.026:
            c.z = 0.026
        # Ankle flex creases across the front, a toe-cap seam, the lacing gap and heel counter.
        front = smooth01((y - 0.02) / 0.04)
        c += n * (0.0022 * front * bell(z, 0.105, 0.03) * math.sin(z * 260 + noise.noise(c * 30) * 2))
        toe_seam = bell(y - (0.1 + 0.012 * math.cos((x - X) / 0.045 * 1.5)), 0, 0.0018)
        c -= n * 0.0012 * toe_seam * smooth01((z - 0.03) / 0.01)
        heel = bell(z - (0.06 + 0.3 * max(0.0, -y - 0.02)), 0, 0.002) * smooth01((-y - 0.01) / 0.03)
        c -= n * 0.001 * heel
        # Padded top roll.
        c += n * 0.004 * bell(z, 0.225, 0.012)
        c += n * 0.0008 * noise.noise(c * 60)
        return c
    displace(up, shape)
    # Sole: the footprint with a welt, a stacked heel.
    def sole_shape(co):
        if co.y < -0.08:
            co.y = -0.08 + (co.y + 0.08) * 0.5
        co.x *= 1 - 0.12 * smooth01((co.y - 0.07) / 0.07)
    sole = build("boot_sole", ellipsoid((X, 0.03, 0.016), (0.053, 0.148, 0.013), seg=24, rings=8, shape=sole_shape),
                 rounded_box((0.08, 0.055, 0.03), (X, -0.06, 0.015), 0.008, 2))
    # Tongue and laces over the instep: crossing pairs with a bow at the top.
    tongue_pts = [Vector((X, 0.115, 0.07)), Vector((X, 0.085, 0.092)), Vector((X, 0.057, 0.14)), Vector((X, 0.052, 0.2)), Vector((X, 0.05, 0.25))]
    tongue = build("boot_tongue", sweep(catmull(tongue_pts, 4), rect(0.046, 0.007, 0.003)))
    laces = []
    lace_pts = [(0.108, 0.1), (0.089, 0.112), (0.074, 0.13), (0.064, 0.152), (0.06, 0.176), (0.059, 0.2), (0.059, 0.222)]
    for k in range(len(lace_pts) - 1):
        (y0, z0), (y1, z1) = lace_pts[k], lace_pts[k + 1]
        for sgn in (1, -1):
            a = Vector((X + sgn * 0.02, y0 + 0.006, z0))
            b = Vector((X - sgn * 0.02, y1 + 0.006, z1))
            mid = (a + b) / 2 + Vector((0, 0.004, 0))
            laces.append(sweep(catmull([a, mid, b], 3), circle(0.0022, 5)))
        # Eyelets / speed hooks either side.
        for sgn in (1, -1):
            laces.append(ring((X + sgn * 0.023, y0 + 0.004, z0), 0.0038, 0.0014, axis="Y", seg=8, mseg=4))
    top = Vector((X, lace_pts[-1][0] + 0.008, lace_pts[-1][1] + 0.004))
    for sgn in (1, -1):
        laces.append(ring(top + Vector((sgn * 0.012, 0.004, -0.004)), 0.009, 0.0022, axis="Y", seg=10, mseg=5, flat=0.8))
        laces.append(sweep(catmull([top, top + Vector((sgn * 0.006, 0.01, -0.02)), top + Vector((sgn * 0.01, 0.012, -0.045))], 3), circle(0.002, 5)))
    lace = build("boot_laces", *laces)
    parts = [up, sole, tongue, lace]
    if sx < 0:
        for o in parts:
            o.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
            o.data.flip_normals()
    return parts
