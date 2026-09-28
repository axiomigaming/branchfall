"""The runner: modelled, rigged, painted, animated and exported → public/assets/runner.glb.

An original character (not a likeness of anyone): a field archaeologist in a
bleached linen shirt with an open collar and rolled sleeves, a rust neckerchief
knotted at the nape, olive canvas trousers tucked into laced leather boots, a
belt with pouches, and a leather pack with a bedroll and a coil of rope — a
strong, readable silhouette from behind, which is where the chase camera sees
them.

Geometry: a skin-modifier body (auto weights) plus separately modelled head,
hair, eyes, ears, hands (curled fingers on their own bone), boots, clothing
details and kit (rigid or hand-weighted to bones). Secondary-motion bones
(`pack`, `bedroll`, `scarf.0-2`) are driven procedurally at runtime.

Animation: gait cycles are generated from stride key-poses with a foot-contact
solver (the stance foot stays on the ground, flight phases are ballistic);
reactions are keyed poses whose root height is also solved from contacts.

    python3 blender/build_runner.py [--preview[=model|run|react|all]]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler, noise
from mathutils.bvhtree import BVHTree

from common import reset, hexcol, new_mesh_obj, link, bake_group, ensure_uvs, export_glb, OUT, CACHE, preview
from common import nodes_clear, N, L, mix, ramp, maprange, math_node

PREVIEW = next((a.split("=", 1)[1] if "=" in a else "all" for a in sys.argv if a.startswith("--preview")), None)
reset()
FPS = 30
bpy.context.scene.render.fps = FPS
noise.seed_set(7)

# ------------------------------------------------------------------ joints
J = {
    "root": (0, 0, 0),
    "pelvis": (0, 0.0, 0.99),
    "spine": (0, -0.005, 1.14),
    "chest": (0, 0.0, 1.31),
    "neck": (0, 0.01, 1.50),
    "head": (0, 0.025, 1.62),
    "crown": (0, 0.02, 1.78),
}
for s, x in (("L", 1), ("R", -1)):
    J.update({
        f"clav.{s}": (x * 0.05, 0.0, 1.45),
        f"shoulder.{s}": (x * 0.205, -0.01, 1.44),
        f"elbow.{s}": (x * 0.24, -0.03, 1.16),
        f"wrist.{s}": (x * 0.26, 0.0, 0.93),
        f"hand.{s}": (x * 0.268, 0.006, 0.84),
        f"hip.{s}": (x * 0.1, 0.0, 0.95),
        f"knee.{s}": (x * 0.105, 0.025, 0.53),
        f"ankle.{s}": (x * 0.11, -0.01, 0.1),
        f"toe.{s}": (x * 0.115, 0.15, 0.035),
    })
V = {k: Vector(v) for k, v in J.items()}
HC = Vector((0, 0.03, 1.655))  # head centre

# ------------------------------------------------------------------ palette (linear)
SKIN = hexcol("#c28a66")
SKIN_DARK = hexcol("#a5704f")
LIP = hexcol("#a4665a")
HAIR = hexcol("#35231a")
BROW = hexcol("#2e1f17")
SHIRT = hexcol("#dccfae")
SHIRT_SHADOW = hexcol("#c7b793")
BUTTON = hexcol("#e9dfc6")
TROUSER = hexcol("#4a5038")
TROUSER_DARK = hexcol("#3a3f2c")
BOOT = hexcol("#553623")
BOOT_DARK = hexcol("#3e281b")
SOLE = hexcol("#241a13")
LACE = hexcol("#9c8466")
BELT = hexcol("#5b3a22")
BRASS = hexcol("#b08e52")
PACK = hexcol("#6d4a2d")
PACK_DARK = hexcol("#4f3420")
ROLL = hexcol("#7c6c4e")
ROPE = hexcol("#a88f62")
SCARF = hexcol("#8f3423")
SCARF_DARK = hexcol("#6e271a")
EYE_W = hexcol("#d8d0c4")
IRIS = hexcol("#3a2a1c")

# Material channels (second colour layer "Mat"): roughness, weave, hair streaks, stubble.
M_SKIN = (0.55, 0.0, 0.0, 0.0)
M_STUBBLE = (0.6, 0.0, 0.0, 1.0)
M_HAIR = (0.62, 0.0, 1.0, 0.0)
M_CLOTH = (0.9, 1.0, 0.0, 0.0)
M_CANVAS = (0.88, 0.8, 0.0, 0.0)
M_LEATHER = (0.58, 0.0, 0.0, 0.0)
M_RUBBER = (0.8, 0.0, 0.0, 0.0)
M_METAL = (0.32, 0.0, 0.0, 0.0)
M_EYE = (0.18, 0.0, 0.0, 0.0)
M_ROPE = (0.9, 0.6, 0.6, 0.0)


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def gauss(d2, s):
    return math.exp(-d2 / (2 * s * s))


# ------------------------------------------------------------------ body (skin modifier)
RADII = {
    "pelvis": (0.165, 0.122), "spine": (0.15, 0.11), "chest": (0.19, 0.122), "neck": (0.058, 0.06),
    "head": (0.05, 0.05),
}
for s in "LR":
    RADII.update({
        f"clav.{s}": (0.115, 0.092), f"shoulder.{s}": (0.072, 0.07), f"elbow.{s}": (0.054, 0.052),
        f"wrist.{s}": (0.034, 0.028), f"hip.{s}": (0.105, 0.102), f"knee.{s}": (0.072, 0.072),
        f"ankle.{s}": (0.058, 0.058),
    })
EDGES = [("pelvis", "spine"), ("spine", "chest"), ("chest", "neck"), ("neck", "head")]
for s in "LR":
    EDGES += [("chest", f"clav.{s}"), (f"clav.{s}", f"shoulder.{s}"), (f"shoulder.{s}", f"elbow.{s}"),
              (f"elbow.{s}", f"wrist.{s}"), ("pelvis", f"hip.{s}"),
              (f"hip.{s}", f"knee.{s}"), (f"knee.{s}", f"ankle.{s}")]

names = list(RADII)
me = bpy.data.meshes.new("body")
me.from_pydata([V[k] for k in names], [(names.index(a), names.index(b)) for a, b in EDGES], [])
body = bpy.data.objects.new("runner_body", me)
link(body)
sk = body.modifiers.new("skin", "SKIN")
sk.branch_smoothing = 0.6
sk.use_smooth_shade = True
for i, k in enumerate(names):
    body.data.skin_vertices[0].data[i].radius = RADII[k]
body.data.skin_vertices[0].data[names.index("pelvis")].use_root = True
sub = body.modifiers.new("sub", "SUBSURF")
sub.levels = 2
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.modifier_apply(modifier="skin")
bpy.ops.object.modifier_apply(modifier="sub")


def arm_axis(c, s):
    """Closest point on the (shoulder→elbow→wrist) polyline for side s."""
    best = None
    for a, b in ((f"shoulder.{s}", f"elbow.{s}"), (f"elbow.{s}", f"wrist.{s}")):
        pa, pb_ = V[a], V[b]
        d = pb_ - pa
        t = max(0.0, min(1.0, (c - pa).dot(d) / d.length_squared))
        p = pa + d * t
        if best is None or (c - p).length < (c - best).length:
            best = p
    return best


def leg_axis(c, s):
    best = None
    for a, b in ((f"hip.{s}", f"knee.{s}"), (f"knee.{s}", f"ankle.{s}")):
        pa, pb_ = V[a], V[b]
        d = pb_ - pa
        t = max(0.0, min(1.0, (c - pa).dot(d) / d.length_squared))
        p = pa + d * t
        if best is None or (c - p).length < (c - best).length:
            best = p
    return best


# Sculpt in code: back and chest volume, traps, glutes, loose sleeves, shirt blousing, trouser folds.
bm = bmesh.new()
bm.from_mesh(body.data)
bm.normal_update()
for v in bm.verts:
    c = v.co
    n = v.normal.copy()
    side = "L" if c.x > 0 else "R"
    is_arm = abs(c.x) > 0.17 and c.z > 0.88 and c.z < 1.47 and abs(c.x) > 0.13 + (1.46 - c.z) * 0.0
    # Chest and shoulder blades.
    if 1.2 < c.z < 1.47 and abs(c.x) < 0.2:
        k = math.sin((c.z - 1.2) / 0.27 * math.pi)
        c.y += 0.02 * k * (1 if c.y > 0 else 0.7)
    # Trapezius: slope from neck to shoulder.
    if 1.43 < c.z < 1.53 and 0.05 < abs(c.x) < 0.17:
        c.z += 0.018 * math.sin((abs(c.x) - 0.05) / 0.12 * math.pi) * (1 if c.y < 0.04 else 0.5)
    # Lats: V-taper under the arms.
    if 1.16 < c.z < 1.36 and abs(c.x) < 0.2 and abs(c.x) > 0.08:
        c.x *= 1 + 0.05 * math.sin((c.z - 1.16) / 0.2 * math.pi)
    # Glutes and hamstrings.
    if 0.78 < c.z < 1.02 and c.y < -0.03 and abs(c.x) < 0.2:
        c.y -= 0.02 * math.sin((c.z - 0.78) / 0.24 * math.pi)
    # Loose linen sleeves between shoulder and roll.
    if abs(c.x) > 0.17 and 1.19 < c.z < 1.46:
        a = arm_axis(c, side)
        r = c - a
        blouse = 1.1 + 0.035 * noise.noise(c * 38)
        if c.z < 1.25:
            blouse = 1.1 + (1.25 - c.z) * 1.2
        c.xyz = a + r * blouse
    # Shirt blousing over the belt.
    if 1.03 < c.z < 1.12 and not (abs(c.x) > 0.2):
        k = math.sin((c.z - 1.03) / 0.09 * math.pi)
        c.x *= 1 + 0.05 * k
        c.y *= 1 + 0.06 * k
    # Shirt folds (horizontal-ish creases, pulled towards the belt).
    if 1.04 < c.z < 1.36 and abs(c.x) < 0.2:
        c.xyz += n * 0.004 * math.sin(c.z * 95 + c.x * 22 + noise.noise(c * 9) * 3)
    # Trousers: loose thighs, creases behind the knee, stacking above the boot.
    if 0.14 < c.z < 0.96 and abs(c.x) > 0.02:
        a = leg_axis(c, side)
        r = c - a
        loose = 1.0 + 0.08 * smooth((0.9 - c.z) / 0.15) * smooth((c.z - 0.6) / 0.1)
        c.xyz = a + r * loose
        fold = 0.0
        if 0.45 < c.z < 0.62:
            fold += 0.006 * math.sin(c.z * 160 + c.x * 30) * (1.2 if c.y < 0.02 else 0.5)
        if 0.14 < c.z < 0.3:
            fold += 0.007 * math.sin(c.z * 120 + math.atan2(r.y, r.x) * 2)
        fold += 0.003 * noise.noise(c * 22)
        c.xyz += n * fold
bm.to_mesh(body.data)
bm.free()

# BVH for placing details on the body surface.
_bvh_bm = bmesh.new()
_bvh_bm.from_mesh(body.data)
BODY_BVH = BVHTree.FromBMesh(_bvh_bm)


def surf(origin, direction, off=0.0):
    """Cast from inside the body outwards; returns the surface point pushed out by `off`."""
    d = Vector(direction).normalized()
    hit = BODY_BVH.ray_cast(Vector(origin), d, 2.0)
    if hit[0] is None:
        return Vector(origin) + d * 0.1
    return hit[0] + d * off


# ------------------------------------------------------------------ body paint
def body_region(c):
    if c.z > 1.47 and abs(c.x) < 0.075:
        return SKIN, M_SKIN
    armx = 0.212 if c.z < 1.0 else 0.196
    if abs(c.x) > armx and 0.84 < c.z < 1.21:
        return SKIN, M_SKIN
    if c.z > 1.035:
        return (SHIRT if (c.x * 7 + c.z * 13) % 1 > 0.03 else SHIRT_SHADOW), M_CLOTH
    if c.z > 0.97:
        return BELT, M_LEATHER
    if c.z > 0.16:
        # Seat and knee wear patches read as darker canvas.
        if (c.y < -0.05 and 0.84 < c.z < 0.97) or (c.y > 0.04 and 0.48 < c.z < 0.58):
            return TROUSER_DARK, M_CANVAS
        return TROUSER, M_CANVAS
    return BOOT, M_LEATHER


def paint(bm, fn, per_vertex=False):
    """Colour and material channels per face (crisp regions) or per vertex (soft features)."""
    cl = bm.loops.layers.float_color.get("Col") or bm.loops.layers.float_color.new("Col")
    ml = bm.loops.layers.float_color.get("Mat") or bm.loops.layers.float_color.new("Mat")
    cache = {}
    for f in bm.faces:
        if not per_vertex:
            col, mt = fn(f.calc_center_median(), f)
        for lp in f.loops:
            if per_vertex:
                v = lp.vert
                if v not in cache:
                    cache[v] = fn(v.co.copy(), f)
                col, mt = cache[v]
            lp[cl] = col
            lp[ml] = mt


bm = bmesh.new()
bm.from_mesh(body.data)
paint(bm, lambda c, f: body_region(c))
bm.to_mesh(body.data)
bm.free()


# ------------------------------------------------------------------ geometry helpers
def solid(name, bmfn, color, group, mat=M_CLOTH, recalc=True, per_vertex=False):
    """Build a mesh object; `color`/`mat` may be callables of the face centre; `group` a bone name or
    a callable co → {bone: weight}."""
    bm = bmesh.new()
    bmfn(bm)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    def fn(c, f):
        return (color(c) if callable(color) else color), (mat(c) if callable(mat) else mat)
    paint(bm, fn, per_vertex)
    ob = new_mesh_obj(name, bm)
    for p in ob.data.polygons:
        p.use_smooth = True
    if callable(group):
        groups = {}
        for v in ob.data.vertices:
            for g, w in group(v.co).items():
                if w <= 0:
                    continue
                if g not in groups:
                    groups[g] = ob.vertex_groups.new(name=g)
                groups[g].add([v.index], w, "REPLACE")
    else:
        vg = ob.vertex_groups.new(name=group)
        vg.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    return ob


def rounded_box(size, loc, bevel=0.03, seg=3, rot=None, shape=None):
    def f(bm):
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1)
        for v in tmp.verts:
            v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
        bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=min(bevel, min(size) * 0.45), segments=seg, affect="EDGES", clamp_overlap=True)
        if shape:
            for v in tmp.verts:
                shape(v.co)
        m = Matrix.Translation(Vector(loc)) @ (Euler(rot).to_matrix().to_4x4() if rot else Matrix())
        bmesh.ops.transform(tmp, matrix=m, verts=tmp.verts)
        _merge(bm, tmp)
    return f


def _merge(bm, tmp):
    me_ = bpy.data.meshes.new("_m")
    tmp.to_mesh(me_)
    tmp.free()
    bm.from_mesh(me_)
    bpy.data.meshes.remove(me_)


def ellipsoid(center, radii, seg=12, rings=8, rot=None, shape=None):
    def f(bm):
        tmp = bmesh.new()
        bmesh.ops.create_uvsphere(tmp, u_segments=seg, v_segments=rings, radius=1.0)
        for v in tmp.verts:
            v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
            if shape:
                shape(v.co)
        m = Matrix.Translation(Vector(center)) @ (Euler(rot).to_matrix().to_4x4() if rot else Matrix())
        bmesh.ops.transform(tmp, matrix=m, verts=tmp.verts)
        _merge(bm, tmp)
    return f


def ring(center, radius, minor, axis="Z", seg=20, flat=1.0, sy=1.0, mseg=8):
    def f(bm):
        rot = {"Z": Matrix(), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
        verts = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            rv = []
            for j in range(mseg):
                b = 2 * math.pi * j / mseg
                p = Vector(((radius + minor * math.cos(b)) * math.cos(a), (radius + minor * math.cos(b)) * math.sin(a) * sy, minor * math.sin(b) * flat))
                rv.append(bm.verts.new((Matrix.Translation(Vector(center)) @ rot) @ p))
            verts.append(rv)
        for i in range(seg):
            for j in range(mseg):
                bm.faces.new((verts[i][j], verts[(i + 1) % seg][j], verts[(i + 1) % seg][(j + 1) % mseg], verts[i][(j + 1) % mseg]))
    return f


def cyl(p0, p1, r, seg=16, bevel=0.3, r2=None):
    def f(bm):
        tmp = bmesh.new()
        d = Vector(p1) - Vector(p0)
        bmesh.ops.create_cone(tmp, cap_ends=True, segments=seg, radius1=r, radius2=r2 or r, depth=d.length)
        if bevel:
            bmesh.ops.bevel(tmp, geom=[e for e in tmp.edges if e.calc_face_angle(0) > 1.0], offset=r * bevel, segments=2, affect="EDGES")
        q = d.to_track_quat("Z", "Y")
        bmesh.ops.transform(tmp, matrix=Matrix.Translation((Vector(p0) + Vector(p1)) / 2) @ q.to_matrix().to_4x4(), verts=tmp.verts)
        _merge(bm, tmp)
    return f


def catmull(pts, n=4, closed=False):
    """Subdivide a polyline with Catmull-Rom."""
    P = [Vector(p) for p in pts]
    out = []
    m = len(P)
    rng_ = range(m) if closed else range(m - 1)
    for i in rng_:
        p0 = P[(i - 1) % m] if closed else P[max(0, i - 1)]
        p1 = P[i]
        p2 = P[(i + 1) % m]
        p3 = P[(i + 2) % m] if closed else P[min(m - 1, i + 2)]
        for k in range(n):
            u = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    if not closed:
        out.append(P[-1])
    return out


def sweep(pts, prof, ups=None, closed=False, cap=True, twist_up=None):
    """Sweep a 2D profile (list of (side, up) offsets or callable i→list) along `pts`.
    `ups` gives the 'up' direction at each point (defaults to a transported frame)."""
    def f(bm):
        n = len(pts)
        rings_ = []
        up_prev = None
        for i, p in enumerate(pts):
            p = Vector(p)
            t = (Vector(pts[(i + 1) % n]) - Vector(pts[i - 1])) if closed else (Vector(pts[min(n - 1, i + 1)]) - Vector(pts[max(0, i - 1)]))
            t.normalize()
            if ups is not None:
                up = Vector(ups[i])
            elif up_prev is None:
                up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((0, 1, 0))
            else:
                up = up_prev
            side = t.cross(up).normalized()
            up = side.cross(t).normalized()
            up_prev = up
            pr = prof(i) if callable(prof) else prof
            rings_.append([bm.verts.new(p + side * a + up * b) for a, b in pr])
        m = len(rings_[0])
        last = n if closed else n - 1
        for i in range(last):
            ra, rb = rings_[i], rings_[(i + 1) % n]
            for j in range(m):
                bm.faces.new((ra[j], rb[j], rb[(j + 1) % m], ra[(j + 1) % m]))
        if cap and not closed:
            for r_ in (rings_[0], rings_[-1]):
                bm.faces.new(r_)
    return f


def rect(w, h, bevel=0.0):
    hw, hh = w / 2, h / 2
    if bevel <= 0:
        return [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    b = min(bevel, hw * 0.9, hh * 0.9)
    return [(-hw + b, -hh), (hw - b, -hh), (hw, -hh + b), (hw, hh - b), (hw - b, hh), (-hw + b, hh), (-hw, hh - b), (-hw, -hh + b)]


def circle(r, seg=6, sx=1.0):
    return [(r * sx * math.cos(2 * math.pi * k / seg), r * math.sin(2 * math.pi * k / seg)) for k in range(seg)]


def mirror_obj(bmfn):
    """Wrap a bmesh builder so its output is mirrored in X (for the right side)."""
    def f(bm):
        tmp = bmesh.new()
        bmfn(tmp)
        bmesh.ops.scale(tmp, vec=Vector((-1, 1, 1)), verts=tmp.verts)
        bmesh.ops.reverse_faces(tmp, faces=tmp.faces)
        _merge(bm, tmp)
    return f


def chain_weights(pts, bones):
    """Weights for a vertex from its projection along a polyline split evenly into `bones`."""
    P = [Vector(p) for p in pts]
    seglen = [(P[i + 1] - P[i]).length for i in range(len(P) - 1)]
    total = sum(seglen)

    def w(co):
        best, bt = 1e9, 0.0
        acc = 0.0
        for i in range(len(P) - 1):
            d = P[i + 1] - P[i]
            t = max(0.0, min(1.0, (co - P[i]).dot(d) / max(1e-9, d.length_squared)))
            dist = (co - (P[i] + d * t)).length
            if dist < best:
                best, bt = dist, (acc + t * seglen[i]) / total
            acc += seglen[i]
        x = bt * len(bones) - 0.5
        i0 = max(0, min(len(bones) - 1, math.floor(x)))
        i1 = min(len(bones) - 1, i0 + 1)
        fr = max(0.0, min(1.0, x - i0))
        out = {bones[i0]: 1 - fr}
        out[bones[i1]] = out.get(bones[i1], 0) + fr
        return out
    return w


extras = []

# ------------------------------------------------------------------ head
HR = Vector((0.079, 0.1, 0.116))


def head_offset(p):
    """Displace a point on the base ellipsoid (head-local) into a face."""
    x, y, z = p
    d = Vector((x / HR.x, y / HR.y, z / HR.z))
    fy = max(0.0, d.y)
    q = Vector(p)
    # Flatter face plane, fuller back of the skull.
    if d.y > 0:
        q.y *= 1 - 0.08 * fy * fy
    if d.y < -0.2 and z > -0.03:
        q += d.normalized() * 0.006
    # Jaw: taper to the chin at the front, pull in under the skull at the back into the neck.
    if z < -0.015:
        t = smooth((-z - 0.015) / 0.095)
        q.x *= 1 - 0.42 * t * smooth((d.y + 0.25) / 0.9)
        if d.y < 0.3:
            back = smooth((0.3 - d.y) / 0.9)
            q.y = q.y * (1 - 0.35 * t * back)
            q.x *= 1 - 0.18 * t * back
    # Jaw angle: a hint of width just under the ears.
    q.x += math.copysign(0.006, x) * gauss((z + 0.05) ** 2 + (y - 0.02) ** 2, 0.022)
    # Chin forward and a touch square.
    q.y += 0.012 * gauss(x * x + (z + 0.097) ** 2, 0.018) * fy
    if fy > 0.35:
        # Brow ridge.
        q.y += 0.013 * math.exp(-((z - 0.032) / 0.012) ** 2) * math.exp(-(x / 0.05) ** 4)
        # Temples and the hollows under the cheekbones.
        for sx in (-1, 1):
            q += Vector((sx, 0.3, 0)) * -0.005 * gauss((x - sx * 0.062) ** 2 + (z - 0.03) ** 2, 0.014)
            q.y -= 0.006 * gauss((x - sx * 0.042) ** 2 + (z + 0.045) ** 2, 0.012)
        # Eye sockets.
        for sx in (-1, 1):
            q.y -= 0.015 * gauss((x - sx * 0.031) ** 2 + (z - 0.008) ** 2, 0.012)
        # Nose: bridge rising to the tip, wings either side.
        if -0.05 < z < 0.03:
            u = (0.025 - z) / 0.06  # 0 at bridge, 1 at tip
            prof = 0.004 + 0.024 * smooth(u) if u < 1.0 else 0.028 * (1 - smooth((u - 1.0) / 0.25))
            wid = 0.007 + 0.007 * smooth(u)
            q.y += max(0.0, prof) * math.exp(-(x / wid) ** 2)
        for sx in (-1, 1):
            q.y += 0.009 * gauss((x - sx * 0.014) ** 2 + (z + 0.034) ** 2, 0.007)
        # Cheekbones.
        for sx in (-1, 1):
            q += Vector((sx * 0.4, 0.6, 0)) * 0.011 * gauss((x - sx * 0.05) ** 2 + (z + 0.01) ** 2, 0.015)
        # Lips and the mouth line.
        q.y += 0.006 * math.exp(-(x / 0.021) ** 4) * math.exp(-((z + 0.06) / 0.009) ** 2)
        q.y -= 0.003 * math.exp(-(x / 0.019) ** 4) * math.exp(-((z + 0.0625) / 0.0022) ** 2)
    return q


def hairline(q):
    """Height (head-local z) above which there is hair, for a head-local point."""
    x, y, z = q
    d = Vector((x / HR.x, y / HR.y, z / HR.z)).normalized()
    front = smooth((d.y - 0.1) / 0.6)
    temple = 0.05 * smooth((abs(x) - 0.02) / 0.04)
    h_front = 0.066 - temple * 0.25
    h_side = 0.028 - 0.035 * smooth((-d.y + 0.2) / 0.9)  # down to the nape at the back
    return h_side + (h_front - h_side) * front + 0.002 * noise.noise(Vector(q) * 25)


def build_head(bm):
    NU, NV = 44, 30
    rows = []
    for j in range(1, NV):
        v = j / NV
        # Denser rings through the face.
        th = math.pi * (1 - v)
        th = th + 0.12 * math.sin(2 * (th - math.pi / 2))
        row = []
        for i in range(NU):
            s_ = -1 + 2 * i / NU
            ph = math.pi / 2 + math.pi * math.copysign(abs(s_) ** 1.35, s_)
            d = Vector((math.cos(ph) * math.sin(th), math.sin(ph) * math.sin(th), math.cos(th)))
            p = Vector((d.x * HR.x, d.y * HR.y, d.z * HR.z))
            row.append(bm.verts.new(HC + head_offset(p)))
        rows.append(row)
    top = bm.verts.new(HC + head_offset(Vector((0, 0, HR.z))))
    bot = bm.verts.new(HC + head_offset(Vector((0, 0, -HR.z))))
    for j in range(len(rows) - 1):
        for i in range(NU):
            bm.faces.new((rows[j][i], rows[j][(i + 1) % NU], rows[j + 1][(i + 1) % NU], rows[j + 1][i]))
    for i in range(NU):
        bm.faces.new((rows[-1][i], rows[-1][(i + 1) % NU], top))
        bm.faces.new((rows[0][(i + 1) % NU], rows[0][i], bot))


def head_paint(c):
    q = c - HC
    x, y, z = q
    d = Vector((x / HR.x, y / HR.y, z / HR.z))
    if z > hairline(q) + 0.006:
        return HAIR, M_HAIR
    if d.y > 0.5:
        if 0.025 < z < 0.035 - 0.12 * max(0.0, abs(x) - 0.03) and 0.012 < abs(x) < 0.052:
            return BROW, M_HAIR
        if abs(x) < 0.022 and -0.068 < z < -0.053:
            return (hexcol("#6f3e34") if -0.0645 < z < -0.0605 else LIP), M_SKIN
        # Lids: a darker ring around the eyes.
        for sx in (-1, 1):
            if (x - sx * 0.031) ** 2 + ((z - 0.008) * 1.6) ** 2 < 0.0185 ** 2:
                return SKIN_DARK, M_SKIN
    # Stubble along the jaw, chin and upper lip.
    if z < -0.035 and d.y > -0.35 and not (abs(x) < 0.022 and -0.068 < z < -0.053):
        return SKIN, M_STUBBLE
    return SKIN, M_SKIN


extras.append(solid("head", build_head, lambda c: head_paint(c)[0], "head", mat=lambda c: head_paint(c)[1], per_vertex=True))

HEAD_BM = bmesh.new()
HEAD_BM.from_mesh(extras[-1].data)
HEAD_BVH = BVHTree.FromBMesh(HEAD_BM)


def head_surf(x, z, off=0.0):
    hit = HEAD_BVH.ray_cast(Vector((x, 0.3, HC.z + z)), Vector((0, -1, 0)), 1.0)
    return hit[0] + Vector((0, off, 0))


# Hair: a shell over the scalp, thick and tousled on top, feathered to nothing at the hairline.
def build_hair(bm):
    """A shell over the scalp whose thickness is a signed function of the distance above the
    hairline: below it the shell dips under the skin, so the visible edge is the smooth curve where
    the shell meets the head, not the stair-step of the face boundary."""
    src = HEAD_BM.copy()
    src.normal_update()
    for f in list(src.faces):
        c = f.calc_center_median() - HC
        if c.z < hairline(c) - 0.03:
            src.faces.remove(f)
    for v in list(src.verts):
        if not v.link_faces:
            src.verts.remove(v)
    src.normal_update()
    for v in src.verts:
        q = v.co - HC
        above = q.z - hairline(q)
        top = smooth((q.z - 0.02) / 0.09)
        tuft = 0.5 + 0.5 * noise.noise(q * 55)
        full = 0.006 + 0.012 * top + 0.009 * tuft * (0.4 + top)
        k = max(-1.0, min(1.0, above / 0.014))
        thick = full * smooth(k) if k > 0 else 0.004 * k
        v.co += v.normal * thick
        if k > 0.5 and q.y > 0.02 and q.z > 0.04:
            v.co.y -= 0.004 * top
            v.co.z += 0.004
    _merge(bm, src)


extras.append(solid("hair", build_hair, HAIR, "head", mat=M_HAIR, recalc=False))

for s, sx in (("L", 1), ("R", -1)):
    # Eyes.
    ep = head_surf(sx * 0.031, 0.008, -0.0075)

    def eye_col(c, ep=ep):
        d = (c - ep).normalized()
        return IRIS if d.y > 0.82 else EYE_W
    extras.append(solid(f"eye_{s}", ellipsoid(ep, (0.0115, 0.0115, 0.0115), seg=10, rings=7), eye_col, "head", mat=M_EYE))

    # Ears: a flattened shell with a rim and a hollow, tilted back.
    def ear_shape(co):
        if co.x > 0.0:
            r = math.sqrt((co.y / 0.026) ** 2 + (co.z / 0.033) ** 2)
            if r < 0.7:
                co.x -= 0.006 * (1 - r / 0.7)
    eb_ = ellipsoid((0, 0, 0), (0.011, 0.026, 0.033), seg=12, rings=8, shape=ear_shape)
    ear = eb_ if sx > 0 else mirror_obj(eb_)
    eo = solid(f"ear_{s}", ear, SKIN, "head", mat=M_SKIN)
    eo.matrix_world = Matrix.Translation(HC + Vector((sx * 0.078, -0.012, -0.004))) @ Euler((0.18, 0, sx * 0.22)).to_matrix().to_4x4()
    extras.append(eo)

# ------------------------------------------------------------------ hands: palm, curled fingers, thumb
FINGERS = [(0.024, 0.074, 0.0095), (0.008, 0.08, 0.0098), (-0.008, 0.077, 0.0094), (-0.023, 0.062, 0.0085)]
KNUCKLE_Z = 0.848


def build_hand_L(bm, part):
    w = V["wrist.L"]
    hx = 0.266
    if part == "palm":
        def palm_shape(co):
            # A slab, not an egg: flatter across the palm, broad over the knuckles, narrower at the wrist.
            co.x = math.copysign(min(abs(co.x), 0.0125), co.x)
            k = smooth((0.03 - co.z) / 0.07)
            co.y *= 0.82 + 0.25 * k
        ellipsoid((hx, 0.004, 0.886), (0.017, 0.043, 0.05), seg=12, rings=8, shape=palm_shape)(bm)
        # Thumb: from the heel of the palm, forward and across.
        pts = []
        p = Vector((hx - 0.008, 0.03, 0.9))
        d = Vector((-0.35, 0.55, -0.76)).normalized()
        for k in range(5):
            pts.append(p.copy())
            p += d * 0.015
            d = (Matrix.Rotation(-0.18, 3, "Z") @ Matrix.Rotation(0.12, 3, "Y") @ d).normalized()
        sweep(pts, lambda i: circle(0.0115 - 0.0006 * i, 6, 1.0))(bm)
        return
    for (fy, ln, r) in FINGERS:
        pts = []
        p = Vector((hx, fy, KNUCKLE_Z + 0.006))
        d = Vector((0, 0, -1))
        n = 6
        curl = 2.15
        for k in range(n + 1):
            pts.append(p.copy())
            p += d * (ln / n)
            d = (Matrix.Rotation(curl / n, 3, "Y") @ d).normalized()
        sweep(pts, lambda i, r=r: circle(r * (1 - 0.18 * i / n), 6, 1.0))(bm)


for s, sx in (("L", 1), ("R", -1)):
    for part, grp in (("palm", f"hand.{s}"), ("fingers", f"fingers.{s}")):
        fn = (lambda bm, part=part: build_hand_L(bm, part))
        extras.append(solid(f"hand_{part}_{s}", fn if sx > 0 else mirror_obj(fn), SKIN, grp, mat=M_SKIN))

# ------------------------------------------------------------------ boots
def boot_weights(s):
    def w(co):
        if co.z > 0.16:
            return {f"shin.{s}": 1.0}
        if co.z > 0.1:
            k = (co.z - 0.1) / 0.06
            return {f"shin.{s}": k, f"foot.{s}": 1 - k}
        if co.y > 0.1:
            k = smooth((co.y - 0.1) / 0.04)
            return {f"toe.{s}": k, f"foot.{s}": 1 - k}
        return {f"foot.{s}": 1.0}
    return w


def build_boot_L(bm, part):
    ax, ay = 0.11, -0.012
    if part == "upper":
        def foot_shape(co):
            # Flat underneath, a lower rounded toe box, a square-ish heel.
            if co.z < -0.036:
                co.z = -0.036 + (co.z + 0.036) * 0.15
            t = smooth((co.y - 0.0) / 0.13)
            if co.z > 0:
                co.z *= 1 - 0.42 * t
            if co.y < -0.08:
                co.y = -0.08 + (co.y + 0.08) * 0.5
            co.x *= 1 - 0.1 * smooth((co.y - 0.07) / 0.07)
        ellipsoid((0.112, 0.06, 0.058), (0.053, 0.142, 0.052), seg=16, rings=10, shape=foot_shape)(bm)
        # Shaft, slightly flared at the top.
        cyl((ax, ay, 0.07), (ax, ay, 0.235), 0.063, seg=16, bevel=0.15, r2=0.066)(bm)
        # Folded top.
        ring((ax, ay, 0.232), 0.064, 0.012, seg=16, sy=1.06, mseg=6)(bm)
        # Tongue and laces over the instep.
        pts = [Vector((0.112, 0.12, 0.09)), Vector((0.112, 0.08, 0.108)), Vector((0.112, 0.062, 0.15)), Vector((0.112, 0.064, 0.222))]
        sweep(catmull(pts, 3), rect(0.042, 0.01, 0.003), ups=None)(bm)
        return
    if part == "laces":
        for k, (y, z) in enumerate(((0.11, 0.1), (0.088, 0.112), (0.072, 0.132), (0.068, 0.157), (0.068, 0.182), (0.069, 0.207))):
            rounded_box((0.052, 0.006, 0.0055), (0.112, y + 0.004, z + 0.002), 0.002, 1, rot=(0.3 + k * 0.12, 0, 0.35 if k % 2 else -0.35))(bm)
        return
    # Sole with a stacked heel.
    def sole_shape(co):
        # The upper's footprint plus a small welt: heel squared off, toe narrowed.
        if co.y < -0.08:
            co.y = -0.08 + (co.y + 0.08) * 0.5
        co.x *= 1 - 0.1 * smooth((co.y - 0.07) / 0.07)
    ellipsoid((0.112, 0.06, 0.012), (0.056, 0.146, 0.012), seg=16, rings=6, shape=sole_shape)(bm)
    rounded_box((0.078, 0.05, 0.026), (0.112, -0.022, 0.014), 0.008, 2)(bm)


for s, sx in (("L", 1), ("R", -1)):
    for part, col, mt in (("upper", lambda c: BOOT if c.z < 0.2 else BOOT_DARK, M_LEATHER), ("laces", LACE, M_ROPE), ("sole", SOLE, M_RUBBER)):
        fn = (lambda bm, part=part: build_boot_L(bm, part))
        extras.append(solid(f"boot_{part}_{s}", fn if sx > 0 else mirror_obj(fn), col, boot_weights(s), mat=mt))

# ------------------------------------------------------------------ shirt details: collar, placket, buttons, rolled sleeves, tail
extras.append(solid("collar_band", ring((0, 0.008, 1.482), 0.066, 0.016, seg=20, flat=0.85, mseg=6), SHIRT_SHADOW, "chest", mat=M_CLOTH))
for s, sx in (("L", 1), ("R", -1)):
    # Collar point: lies from the side of the neck down onto the chest.
    a = surf((sx * 0.045, 0.0, 1.47), (sx * 0.6, 0.8, 0.3), 0.004)
    b = surf((sx * 0.05, 0.0, 1.41), (sx * 0.25, 1, 0), 0.006)
    mid = (a + b) / 2 + Vector((0, 0.008, 0))
    extras.append(solid(f"collar_{s}", sweep([a, mid, b], lambda i: [(-0.02 * (1 - i * 0.35), -0.003), (0.02 * (1 - i * 0.35), -0.003), (0.02 * (1 - i * 0.35), 0.003), (-0.02 * (1 - i * 0.35), 0.003)],
                                             ups=[Vector((sx * 0.3, 1, 0.2))] * 3), SHIRT, "chest", mat=M_CLOTH))
placket = [surf((0, 0.0, z), (0, 1, 0), 0.003) for z in (1.405, 1.33, 1.25, 1.17, 1.1, 1.05)]
extras.append(solid("placket", sweep(catmull(placket, 2), rect(0.028, 0.006, 0.002), ups=[Vector((0, 1, 0))] * 11), SHIRT_SHADOW, "chest", mat=M_CLOTH))
for z in (1.37, 1.28, 1.19, 1.11):
    p = surf((0, 0.0, z), (0, 1, 0), 0.007)
    extras.append(solid(f"button_{z}", cyl(p - Vector((0, 0.002, 0)), p + Vector((0, 0.002, 0)), 0.0065, seg=8, bevel=0.3), BUTTON, "chest" if z > 1.2 else "spine", mat=M_METAL))
# Chest pockets with flaps.
for sx in (1, -1):
    p = surf((sx * 0.085, 0.0, 1.3), (0, 1, 0), 0.004)
    extras.append(solid(f"pocket_{sx}", rounded_box((0.075, 0.01, 0.028), p + Vector((0, 0, 0.025)), 0.004, 2, rot=(-0.15, 0, 0)), SHIRT_SHADOW, "chest", mat=M_CLOTH))
for s, sx in (("L", 1), ("R", -1)):
    e, sh = V[f"elbow.{s}"], V[f"shoulder.{s}"]
    axis_q = (sh - e).to_track_quat("Z", "Y").to_matrix().to_4x4()
    for k, (t, r, mr) in enumerate(((0.12, 0.062, 0.02), (0.2, 0.06, 0.016))):
        ob = solid(f"cuff_{s}{k}", ring((0, 0, 0), r, mr, seg=16, flat=1.25, mseg=6), SHIRT_SHADOW if k == 0 else SHIRT, f"upper_arm.{s}", mat=M_CLOTH)
        ob.matrix_world = Matrix.Translation(e + (sh - e) * t) @ axis_q @ Matrix.Rotation(0.12 * (k - 0.5), 4, "X")
        extras.append(ob)
# Shirt tail hanging out over the belt at the back.
tail = []
for k in range(9):
    a = math.radians(205 + k * 16.25)
    p = surf((0, 0, 0.985), (math.cos(a), math.sin(a), 0), 0.012)
    tail.append(p)
extras.append(solid("shirt_tail", sweep(tail, lambda i: [(0, 0.04), (0, -0.035 - 0.012 * math.sin(i / 8 * math.pi)), (0.006, -0.035 - 0.012 * math.sin(i / 8 * math.pi)), (0.006, 0.04)],
                                         ups=[Vector((0, 0, 1))] * 9), SHIRT, "hips", mat=M_CLOTH))

# ------------------------------------------------------------------ belt and pouches
belt_pts = [surf((0, 0, 1.0), (math.cos(2 * math.pi * k / 28), math.sin(2 * math.pi * k / 28), 0), 0.007) for k in range(28)]
extras.append(solid("belt", sweep(belt_pts, rect(0.012, 0.042, 0.003), ups=[Vector((0, 0, 1))] * 28, closed=True), BELT, "hips", mat=M_LEATHER))
bf = surf((0, 0, 1.0), (0, 1, 0), 0.014)
extras.append(solid("buckle", rounded_box((0.058, 0.01, 0.048), bf, 0.006, 2), BRASS, "hips", mat=M_METAL))
pp = surf((0, 0, 0.975), (-0.82, 0.57, 0), 0.03)
extras.append(solid("pouch", rounded_box((0.05, 0.1, 0.09), pp, 0.014, 2, rot=(0, 0, -0.6)), PACK, "hips", mat=M_LEATHER))
extras.append(solid("pouch_flap", rounded_box((0.055, 0.105, 0.035), pp + Vector((0, 0, 0.035)), 0.01, 2, rot=(0, 0, -0.6)), PACK_DARK, "hips", mat=M_LEATHER))
bp = surf((0, 0, 0.975), (0.55, -0.83, 0), 0.028)
extras.append(solid("back_pouch", rounded_box((0.1, 0.045, 0.075), bp, 0.014, 2, rot=(0, 0, 0.55)), PACK_DARK, "hips", mat=M_LEATHER))

# ------------------------------------------------------------------ neckerchief
SCARF_PTS = [Vector((0, -0.07, 1.513)), Vector((0.008, -0.145, 1.542)), Vector((0.016, -0.215, 1.55)), Vector((0.024, -0.285, 1.536))]
extras.append(solid("scarf_band", ring((0, 0.008, 1.505), 0.064, 0.017, seg=20, flat=1.1, sy=1.02, mseg=6), SCARF, "neck", mat=M_CLOTH))
extras.append(solid("scarf_knot", ellipsoid((0, -0.066, 1.508), (0.026, 0.018, 0.022), seg=10, rings=6), SCARF_DARK, "neck", mat=M_CLOTH))
for k, (dx, ln, wid) in enumerate(((0.016, 1.0, 0.042), (-0.02, 0.82, 0.036))):
    pts = catmull([SCARF_PTS[0] + Vector((dx * 0.3, 0, 0))] + [SCARF_PTS[0] + (p - SCARF_PTS[0]) * ln + Vector((dx * (i + 1) / 3, 0, -0.004 * k)) for i, p in enumerate(SCARF_PTS[1:])], 3)
    nn = len(pts)
    extras.append(solid(f"scarf_tail{k}", sweep(pts, lambda i, nn=nn, wid=wid: rect(wid * (1 - 0.55 * (i / (nn - 1)) ** 1.5), 0.005), ups=[Vector((0, 0, 1))] * nn),
                        SCARF, chain_weights(SCARF_PTS, ["scarf.0", "scarf.1", "scarf.2"]), mat=M_CLOTH))

# ------------------------------------------------------------------ pack, bedroll, rope, straps
PACK_C = Vector((0, -0.215, 1.235))


def pack_col(c):
    return PACK if c.z > PACK_C.z - 0.12 else PACK_DARK


extras += [
    solid("pack", rounded_box((0.3, 0.155, 0.34), PACK_C, 0.045), pack_col, "pack", mat=M_LEATHER),
    solid("pack_flap", rounded_box((0.312, 0.165, 0.13), PACK_C + Vector((0, -0.006, 0.12)), 0.03), PACK_DARK, "pack", mat=M_LEATHER),
    solid("pack_pocket", rounded_box((0.2, 0.06, 0.13), PACK_C + Vector((0, -0.098, -0.07)), 0.022), PACK_DARK, "pack", mat=M_LEATHER),
    solid("pack_pocket_flap", rounded_box((0.206, 0.066, 0.045), PACK_C + Vector((0, -0.1, -0.01)), 0.015), PACK, "pack", mat=M_LEATHER),
    solid("pack_side", rounded_box((0.05, 0.1, 0.15), PACK_C + Vector((0.165, 0, -0.06)), 0.02), PACK_DARK, "pack", mat=M_LEATHER),
]
for sx in (1, -1):
    # Flap straps and buckles.
    x = sx * 0.075
    extras.append(solid(f"flap_strap_{sx}", rounded_box((0.026, 0.006, 0.15), PACK_C + Vector((x, -0.092, 0.055)), 0.003, 1), BELT, "pack", mat=M_LEATHER))
    extras.append(solid(f"flap_buckle_{sx}", rounded_box((0.032, 0.008, 0.026), PACK_C + Vector((x, -0.097, 0.005)), 0.004, 1), BRASS, "pack", mat=M_METAL))
# Rope coil on the right side of the pack.
extras.append(solid("rope", ring(PACK_C + Vector((-0.172, 0.0, -0.03)), 0.066, 0.016, axis="X", seg=18, mseg=6), ROPE, "pack", mat=M_ROPE))
extras.append(solid("rope2", ring(PACK_C + Vector((-0.19, 0.0, -0.035)), 0.06, 0.014, axis="X", seg=18, mseg=6), ROPE, "pack", mat=M_ROPE))
# Bedroll strapped across the top.
ROLL_C = Vector((0, -0.21, 1.458))
extras.append(solid("bedroll", cyl(ROLL_C + Vector((-0.215, 0, 0)), ROLL_C + Vector((0.215, 0, 0)), 0.074, seg=16, bevel=0.35), ROLL, "bedroll", mat=M_CANVAS))
for sx in (1, -1):
    extras.append(solid(f"roll_tie_{sx}", ring(ROLL_C + Vector((sx * 0.13, 0, 0)), 0.076, 0.007, axis="X", seg=16, mseg=4), BELT, "bedroll", mat=M_LEATHER))
# Shoulder straps: over the trapezius, down the chest, under the arm and back to the pack.
for s, sx in (("L", 1), ("R", -1)):
    spec = [
        ((sx * 0.085, -0.05, 1.4), (0, -1, 0.15)),
        ((sx * 0.1, -0.05, 1.3), (0, -0.3, 1)),
        ((sx * 0.105, 0.03, 1.3), (0, 0.3, 1)),
        ((sx * 0.105, 0.0, 1.4), (sx * 0.1, 1, 0.25)),
        ((sx * 0.11, 0.0, 1.3), (sx * 0.15, 1, 0)),
        ((sx * 0.12, 0.0, 1.2), (sx * 0.4, 1, 0)),
        ((0.0, 0.0, 1.13), (sx * 1, 0.25, 0)),
        ((0.0, -0.02, 1.1), (sx * 0.8, -0.6, 0)),
    ]
    pts, ups = [], []
    for o, d in spec:
        dd = Vector(d).normalized()
        pts.append(surf(o, dd, 0.01))
        ups.append(dd)
    cp = catmull(pts, 3)
    cu = [ups[min(len(ups) - 1, i // 3)].lerp(ups[min(len(ups) - 1, i // 3 + 1)], (i % 3) / 3) for i in range(len(cp))]
    extras.append(solid(f"strap_{s}", sweep(cp, rect(0.042, 0.008, 0.002), ups=cu), BELT, "chest", mat=M_LEATHER))
    # Adjuster buckle on the chest.
    bpos = surf((sx * 0.11, 0.0, 1.33), (sx * 0.15, 1, 0), 0.016)
    extras.append(solid(f"strap_buckle_{s}", rounded_box((0.048, 0.008, 0.03), bpos, 0.004, 1, rot=(0, 0, sx * 0.15)), BRASS, "chest", mat=M_METAL))
# Sternum strap.
sa, sb = surf((0.105, 0.0, 1.345), (0.1, 1, 0), 0.016), surf((-0.105, 0.0, 1.345), (-0.1, 1, 0), 0.016)
sm = surf((0, 0, 1.345), (0, 1, 0), 0.02)
extras.append(solid("sternum", sweep(catmull([sa, sm, sb], 3), rect(0.018, 0.006, 0.002), ups=[Vector((0, 1, 0))] * 7), BELT, "chest", mat=M_LEATHER))
extras.append(solid("sternum_clip", rounded_box((0.03, 0.008, 0.022), sm + Vector((0, 0.004, 0)), 0.004, 1), BRASS, "chest", mat=M_METAL))

# ------------------------------------------------------------------ armature
arm_data = bpy.data.armatures.new("rig")
rig = bpy.data.objects.new("runner", arm_data)
link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None, connect=False):
    b = eb.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    return b


bone("root", (0, 0, 0), (0, 0.3, 0))
bone("hips", V["pelvis"], V["spine"], "root")
bone("spine", V["spine"], V["chest"], "hips", True)
bone("chest", V["chest"], V["neck"], "spine", True)
bone("neck", V["neck"], V["head"], "chest", True)
bone("head", V["head"], V["crown"], "neck", True)
SECONDARY = ["pack", "bedroll", "scarf.0", "scarf.1", "scarf.2", "fingers.L", "fingers.R"]
for s in "LR":
    sx = 1 if s == "L" else -1
    bone(f"shoulder.{s}", V["chest"] + Vector((0, 0, 0.12)), V[f"shoulder.{s}"], "chest")
    bone(f"upper_arm.{s}", V[f"shoulder.{s}"], V[f"elbow.{s}"], f"shoulder.{s}", True)
    bone(f"forearm.{s}", V[f"elbow.{s}"], V[f"wrist.{s}"], f"upper_arm.{s}", True)
    bone(f"hand.{s}", V[f"wrist.{s}"], Vector((sx * 0.266, 0.004, KNUCKLE_Z)), f"forearm.{s}", True)
    bone(f"fingers.{s}", Vector((sx * 0.266, 0.004, KNUCKLE_Z)), Vector((sx * 0.266, 0.004, 0.79)), f"hand.{s}", True)
    bone(f"thigh.{s}", V[f"hip.{s}"], V[f"knee.{s}"], "hips")
    bone(f"shin.{s}", V[f"knee.{s}"], V[f"ankle.{s}"], f"thigh.{s}", True)
    bone(f"foot.{s}", V[f"ankle.{s}"], V[f"toe.{s}"] + Vector((0, -0.05, 0.0)), f"shin.{s}", True)
    bone(f"toe.{s}", V[f"toe.{s}"] + Vector((0, -0.05, 0.0)), V[f"toe.{s}"] + Vector((0, 0.04, 0)), f"foot.{s}", True)
bone("pack", (0, -0.15, 1.43), (0, -0.2, 1.08), "chest")
bone("bedroll", (0, -0.16, 1.458), (0, -0.3, 1.458), "pack")
bone("scarf.0", SCARF_PTS[0], SCARF_PTS[1], "neck")
bone("scarf.1", SCARF_PTS[1], SCARF_PTS[2], "scarf.0", True)
bone("scarf.2", SCARF_PTS[2], SCARF_PTS[3], "scarf.1", True)
# Uniform roll so local X is the hinge axis for every limb (flexion = rotation about X).
for b in eb:
    b.align_roll(Vector((0, 0, 1)) if abs(b.vector.normalized().z) < 0.7 else Vector((0, -1, 0)))
bpy.ops.object.mode_set(mode="OBJECT")

# Bind the body with automatic (heat) weights, from the body bones only.
for n_ in SECONDARY:
    arm_data.bones[n_].use_deform = False
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
for n_ in SECONDARY:
    arm_data.bones[n_].use_deform = True

bpy.ops.object.select_all(action="DESELECT")
for o in extras:
    o.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.name = "runner_mesh"
print("runner tris:", sum(len(p.vertices) - 2 for p in body.data.polygons), flush=True)

# ------------------------------------------------------------------ bake a painted texture
mat = bpy.data.materials.new("runner_paint")
nt = nodes_clear(mat)
out = N(nt, "ShaderNodeOutputMaterial")
bsdf = N(nt, "ShaderNodeBsdfPrincipled")
L(nt, bsdf.outputs[0], out.inputs[0])
vc = N(nt, "ShaderNodeVertexColor", _layer_name="Col")
vm = N(nt, "ShaderNodeVertexColor", _layer_name="Mat")
msep = N(nt, "ShaderNodeSeparateColor")
L(nt, vm.outputs[0], msep.inputs[0])
tc = N(nt, "ShaderNodeTexCoord")
# Linen/canvas weave: two crossed fine stripes.
wx = N(nt, "ShaderNodeTexWave", Scale=260.0, Distortion=0.6, **{"Detail": 1.0})
wx.wave_type = "BANDS"
wx.bands_direction = "X"
wz = N(nt, "ShaderNodeTexWave", Scale=260.0, Distortion=0.6, **{"Detail": 1.0})
wz.wave_type = "BANDS"
wz.bands_direction = "Z"
for w_ in (wx, wz):
    L(nt, tc.outputs["Object"], w_.inputs["Vector"])
weave = math_node(nt, "MULTIPLY", wx.outputs[1], wz.outputs[1])
weave_c = ramp(nt, weave, [(0.0, (0.86, 0.86, 0.86)), (0.6, (1.05, 1.05, 1.05))])
col = mix(nt, msep.outputs[1], vc.outputs[0], mix(nt, 1.0, vc.outputs[0], weave_c, "MULTIPLY"), "MIX")
# Broad folds and fading.
folds = N(nt, "ShaderNodeTexNoise", Scale=9.0, Detail=3.0, Distortion=1.5)
L(nt, tc.outputs["Object"], folds.inputs["Vector"])
col = mix(nt, 1.0, col, ramp(nt, folds.outputs[0], [(0.3, (0.84, 0.84, 0.84)), (0.7, (1.05, 1.05, 1.05))]), "MULTIPLY")
# Hair: streaks along the strands.
hmap = N(nt, "ShaderNodeMapping")
hmap.inputs["Scale"].default_value = (70.0, 70.0, 14.0)
L(nt, tc.outputs["Object"], hmap.inputs["Vector"])
hn = N(nt, "ShaderNodeTexNoise", Scale=2.0, Detail=4.0)
L(nt, hmap.outputs[0], hn.inputs["Vector"])
col = mix(nt, msep.outputs[2], col, mix(nt, 1.0, col, ramp(nt, hn.outputs[0], [(0.35, (0.72, 0.72, 0.72)), (0.65, (1.12, 1.08, 1.04))]), "MULTIPLY"), "MIX")
# Stubble: fine dark speckle.
sn = N(nt, "ShaderNodeTexNoise", Scale=900.0, Detail=1.0)
L(nt, tc.outputs["Object"], sn.inputs["Vector"])
va = N(nt, "ShaderNodeVertexColor", _layer_name="Mat")
stub_amt = math_node(nt, "MULTIPLY", va.outputs[1], maprange(nt, sn.outputs[0], 0.45, 0.62, 0.0, 0.32))
col = mix(nt, stub_amt, col, hexcol("#6a4a38"), "MIX")
# Leather scuffs: lighter streaks where roughness is low-ish (leather), via stretched noise.
lmap = N(nt, "ShaderNodeMapping")
lmap.inputs["Scale"].default_value = (30.0, 120.0, 30.0)
L(nt, tc.outputs["Object"], lmap.inputs["Vector"])
ln_ = N(nt, "ShaderNodeTexNoise", Scale=3.0, Detail=6.0)
L(nt, lmap.outputs[0], ln_.inputs["Vector"])
is_leather = math_node(nt, "MULTIPLY", maprange(nt, msep.outputs[0], 0.62, 0.55), maprange(nt, msep.outputs[0], 0.45, 0.52))
col = mix(nt, math_node(nt, "MULTIPLY", is_leather, maprange(nt, ln_.outputs[0], 0.58, 0.72, 0.0, 0.45)), col, hexcol("#a07a58"), "MIX")
# Dust and dried mud climbing the boots and trouser legs.
dust = N(nt, "ShaderNodeTexNoise", Scale=5.0, Detail=5.0)
L(nt, tc.outputs["Object"], dust.inputs["Vector"])
sep = N(nt, "ShaderNodeSeparateXYZ")
L(nt, tc.outputs["Object"], sep.inputs[0])
low = maprange(nt, sep.outputs[2], 0.5, 0.04, 0.0, 0.3)
col = mix(nt, math_node(nt, "MULTIPLY", low, maprange(nt, dust.outputs[0], 0.4, 0.6)), col, hexcol("#9c7a55"), "MIX")
L(nt, col, bsdf.inputs["Base Color"])
L(nt, msep.outputs[0], bsdf.inputs["Roughness"])
bump = N(nt, "ShaderNodeBump", Strength=0.3, Distance=0.01)
L(nt, folds.outputs[0], bump.inputs["Height"])
b2 = N(nt, "ShaderNodeBump", Distance=0.0015)
L(nt, math_node(nt, "MULTIPLY", msep.outputs[1], 0.25), b2.inputs["Strength"])
L(nt, weave, b2.inputs["Height"])
L(nt, bump.outputs[0], b2.inputs["Normal"])
b3 = N(nt, "ShaderNodeBump", Distance=0.002)
L(nt, math_node(nt, "MULTIPLY", msep.outputs[2], 0.5), b3.inputs["Strength"])
L(nt, hn.outputs[0], b3.inputs["Height"])
L(nt, b2.outputs[0], b3.inputs["Normal"])
L(nt, b3.outputs[0], bsdf.inputs["Normal"])

ensure_uvs([body], margin=0.004, angle=55)
bake_group([body], mat, "runner", 1024 if PREVIEW else 2048, ao_samples=8 if PREVIEW else 24, ao_strength=0.55)

import runner_anim  # noqa: E402

runner_anim.build(rig)
if PREVIEW:
    runner_anim.previews(rig, PREVIEW)
    sys.exit(0)
export_glb(os.path.join(OUT, "runner.glb"), [rig, body], anim=True, quality=86)
