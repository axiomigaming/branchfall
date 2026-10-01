"""Sculpt-in-code primitives for the runner (imported by build_runner.py).

Forms are built the way a sculptor blocks them in: overlapping masses (metaballs,
soft unions of balls, ellipsoids and capsules; negative elements carve), fused
into one surface, voxel-remeshed to even topology and then detailed by
displacement. The dense result is the high-poly source for baking; a decimated
copy is the game mesh.
"""
import math

import bpy
import bmesh
from mathutils import Vector, Matrix, Quaternion

from common import link

THRESH = 0.6


def _k(s):
    """Surface radius / element radius for an isolated element of stiffness s."""
    return math.sqrt(1 - (THRESH / s) ** (1 / 3))


class Meta:
    """A metaball family. Radii given are the *surface* radii of an isolated element."""

    # Blender clamps metaball resolution to >= 5 mm: model at 10x and scale the mesh back down.
    S = 10.0

    def __init__(self, name, res, stiff=2.0):
        self.stiff = stiff
        self.mb = bpy.data.metaballs.new(name)
        self.mb.resolution = res * self.S
        self.mb.render_resolution = res * self.S
        self.mb.threshold = THRESH
        self.mb.update_method = "UPDATE_ALWAYS"
        self.ob = bpy.data.objects.new(name, self.mb)
        link(self.ob)

    def _el(self, kind, c, r, s, neg):
        s = s or self.stiff
        e = self.mb.elements.new(type=kind)
        e.co = Vector(c) * self.S
        e.stiffness = s
        e.radius = r * self.S / _k(s)
        e.use_negative = neg
        return e

    def ball(self, c, R, s=None, neg=False):
        return self._el("BALL", c, R, s, neg)

    def ell(self, c, radii, rot=None, s=None, neg=False):
        R = max(radii)
        e = self._el("ELLIPSOID", c, R, s, neg)
        s = e.stiffness
        e.size_x, e.size_y, e.size_z = (r / R for r in radii)
        if rot is not None:
            e.rotation = rot if isinstance(rot, Quaternion) else Quaternion(rot) if len(rot) == 4 else _euler_q(rot)
        return e

    def cap(self, a, b, R, s=None, neg=False, flat=None):
        """A capsule a→b of surface radius R (optionally flattened: (sy, sz) scale of the cross-section)."""
        a, b = Vector(a), Vector(b)
        d = b - a
        if flat:
            # Ellipsoid-section capsules are not supported: approximate with a chain of ellipsoids.
            n = max(2, int(d.length / (R * 0.6)))
            q = d.to_track_quat("X", "Z")
            for i in range(n + 1):
                self.ell(a + d * (i / n), (R, R * flat[0], R * flat[1]), rot=q, s=s, neg=neg)
            return
        e = self._el("CAPSULE", (a + b) / 2, R, s, neg)
        e.size_x = d.length / 2 * self.S
        e.rotation = d.to_track_quat("X", "Z")
        return e

    def tube(self, pts, radii, s=None):
        """A tapered limb through `pts` with surface radius `radii[i]` at each point (chained balls)."""
        P = [Vector(p) for p in pts]
        for i in range(len(P) - 1):
            a, b = P[i], P[i + 1]
            n = max(1, int((b - a).length / (min(radii[i], radii[i + 1]) * 0.45)))
            for k in range(n + (1 if i == len(P) - 2 else 0)):
                t = k / n
                self.ball(a.lerp(b, t), radii[i] + (radii[i + 1] - radii[i]) * t, s=s)

    def mesh(self, name):
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(self.ob.evaluated_get(dg))
        me.name = name
        me.transform(Matrix.Scale(1 / self.S, 4))
        ob = bpy.data.objects.new(name, me)
        link(ob)
        bpy.data.objects.remove(self.ob)
        return ob


def _euler_q(rot):
    from mathutils import Euler
    return Euler(rot).to_quaternion()


def voxel_remesh(ob, size, smooth=0):
    ob.data.remesh_voxel_size = size
    ob.data.use_remesh_fix_poles = True
    ob.data.use_remesh_preserve_volume = True
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.voxel_remesh()
    if smooth:
        m = ob.modifiers.new("sm", "SMOOTH")
        m.factor = 0.5
        m.iterations = smooth
        apply_mods(ob)
    return ob


def apply_mods(ob):
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        for m in list(ob.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)


def join(objs, name=None):
    objs = [o for o in objs if o]
    base = objs[0]
    with bpy.context.temp_override(object=base, active_object=base, selected_objects=objs, selected_editable_objects=objs):
        bpy.ops.object.join()
    if name:
        base.name = name
        base.data.name = name
    return base


def union_remesh(objs, name, size, smooth=0):
    """Fuse closed meshes into one surface (volume union) via voxel remesh."""
    ob = join(objs, name)
    return voxel_remesh(ob, size, smooth)


def duplicate(ob, name):
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = name
    c.data.name = name
    link(c)
    return c


def decimate(ob, tris, symmetric=False):
    """Collapse-decimate to about `tris` triangles."""
    cur = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if cur <= tris:
        return ob
    m = ob.modifiers.new("dec", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = tris / cur
    m.use_collapse_triangulate = True
    if symmetric:
        m.use_symmetry = True
        m.symmetry_axis = "X"
    apply_mods(ob)
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def displace(ob, fn):
    """Move every vertex by fn(co, normal) → new co."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    for v in bm.verts:
        v.co = fn(v.co.copy(), v.normal.copy())
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def keep_faces(ob, pred):
    """Delete faces whose centre fails pred(centre, normal)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    from mathutils.bvhtree import BVHTree
    src = BVHTree.FromBMesh(bm)
    dead = [f for f in bm.faces if not pred(f.calc_center_median(), f.normal)]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    # Remove slivers hanging off the cut (faces with 2+ boundary edges), then relax the cut edge
    # along itself so it reads as a clean hem instead of the voxel stair-step.
    for _ in range(2):
        sl = [f for f in bm.faces if sum(1 for e in f.edges if e.is_boundary) >= 2]
        bmesh.ops.delete(bm, geom=sl, context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    for _ in range(12):
        new = {}
        for v in bm.verts:
            if not v.is_boundary:
                continue
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                new[v] = v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25
        for v, co in new.items():
            loc = src.find_nearest(co)[0]
            v.co = loc if loc is not None else co
        # Let the ring just inside the edge follow.
        for v in bm.verts:
            if v.is_boundary or not any(e.other_vert(v).is_boundary for e in v.link_edges):
                continue
            nb = [e.other_vert(v).co for e in v.link_edges]
            co = v.co * 0.5 + sum(nb, Vector()) / len(nb) * 0.5
            loc = src.find_nearest(co)[0]
            v.co = loc if loc is not None else co
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def solidify(ob, thick, offset=-1.0, rim=True):
    m = ob.modifiers.new("sol", "SOLIDIFY")
    m.thickness = thick
    m.offset = offset
    m.use_rim = rim
    m.use_even_offset = True
    apply_mods(ob)
    return ob


def smooth_mesh(ob, factor=0.5, iters=2):
    m = ob.modifiers.new("sm", "SMOOTH")
    m.factor = factor
    m.iterations = iters
    apply_mods(ob)
    return ob


def rim_flap(ob, depth=0.004):
    """Turn the open edges of a single-layer shell inward, so hems and cuffs read as thick cloth."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    edges = [e for e in bm.edges if e.is_boundary]
    if edges:
        nrm = {v: v.normal.copy() for e in edges for v in e.verts}
        res = bmesh.ops.extrude_edge_only(bm, edges=edges)
        new = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
        # Map each new vert back to its source via position.
        src = {tuple(round(c, 6) for c in v.co): v for v in nrm}
        for v in new:
            s = src.get(tuple(round(c, 6) for c in v.co))
            if s is not None:
                v.co -= nrm[s] * depth
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


# ------------------------------------------------------------------ bmesh builders (callables f(bm))
def _merge(bm, tmp):
    me_ = bpy.data.meshes.new("_m")
    tmp.to_mesh(me_)
    tmp.free()
    bm.from_mesh(me_)
    bpy.data.meshes.remove(me_)


def build(name, *builders, smooth=True):
    bm = bmesh.new()
    for f in builders:
        f(bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    for p in me.polygons:
        p.use_smooth = smooth
    return ob


def rounded_box(size, loc, bevel=0.03, seg=3, rot=None, shape=None):
    from mathutils import Euler

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


def ellipsoid(center, radii, seg=12, rings=8, rot=None, shape=None):
    from mathutils import Euler

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


def ring(center, radius, minor, axis="Z", seg=20, flat=1.0, sy=1.0, mseg=8, wob=None):
    def f(bm):
        rot = {"Z": Matrix(), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
        if isinstance(axis, Matrix):
            pass
        verts = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            rr = radius + (wob(a) if wob else 0.0)
            rv = []
            for j in range(mseg):
                b = 2 * math.pi * j / mseg
                p = Vector(((rr + minor * math.cos(b)) * math.cos(a), (rr + minor * math.cos(b)) * math.sin(a) * sy, minor * math.sin(b) * flat))
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


def sweep(pts, prof, ups=None, closed=False, cap=True):
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


def mirror_x(bmfn):
    """Wrap a bmesh builder so its output is mirrored in X (for the right side)."""
    def f(bm):
        tmp = bmesh.new()
        bmfn(tmp)
        bmesh.ops.scale(tmp, vec=Vector((-1, 1, 1)), verts=tmp.verts)
        bmesh.ops.reverse_faces(tmp, faces=tmp.faces)
        _merge(bm, tmp)
    return f


def xform(bmfn, mat):
    def f(bm):
        tmp = bmesh.new()
        bmfn(tmp)
        bmesh.ops.transform(tmp, matrix=mat, verts=tmp.verts)
        _merge(bm, tmp)
    return f


def bvh_of(ob):
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t
