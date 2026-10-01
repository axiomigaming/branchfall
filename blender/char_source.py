"""The supplied runner mesh (blender/sources/runner): import, normalise, measure.

The source is a scanned-looking game mesh (5,882 vertices, one 1024² PBR atlas, no normals, no rig),
Y-up, facing −Z, A-pose, 1.90 m, centred on the origin. Here it becomes a Z-up, +Y-facing mesh standing
on the ground at the CAUSEWAY character scale, with smooth normals, and its joint landmarks are measured
from cross-sections of the geometry (see landmarks()).
"""
import math
import os

import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, "sources", "runner")
# The game's cameras frame a ~1.8 m runner (head at 1.62 m in src/render/cameraRig.ts): the source is
# scaled uniformly to that stature so every shot, IK limit and contact solve keeps its meaning.
HEIGHT = 1.81


def load(height=HEIGHT):
    bpy.ops.wm.obj_import(filepath=os.path.join(SRC, "runner.obj"))
    ob = bpy.context.selected_objects[0]
    ob.name = "runner_mesh"
    ob.data.name = "runner_mesh"
    me = ob.data
    # Bake the importer's Y-up → Z-up rotation, then turn to face +Y and stand on the ground.
    me.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    co = np.zeros(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    co[:, 0] *= -1
    co[:, 1] *= -1
    co[:, 2] -= co[:, 2].min()
    co *= height / co[:, 2].max()
    me.vertices.foreach_set("co", co.ravel())
    me.update()
    for m in list(me.materials):
        if m:
            bpy.data.materials.remove(m)
    me.materials.clear()
    return ob


def weld_and_smooth(ob):
    """The OBJ has positions shared but no normals: weld any seam duplicates (UVs live on the loops, so
    a positional weld keeps every UV seam), close the pinholes, then smooth shading with sharp edges only
    at real creases (boot welts, belt edges)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    print(f"  weld: {n0} → {len(me.vertices)} verts", flush=True)
    for p in me.polygons:
        p.use_smooth = True
    for e in me.edges:
        e.use_edge_sharp = False
    # Creases sharper than ~75° stay sharp (soles, the belt's edge); everything else is smooth.
    bm = bmesh.new()
    bm.from_mesh(me)
    sharp = 0
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(75):
            e.smooth = False
            sharp += 1
    bm.to_mesh(me)
    bm.free()
    print(f"  sharp edges: {sharp}", flush=True)


def relax_crown(ob, band=0.014, iters=12):
    """The source's scalp ends in a single spiked vertex: relax the top of the head."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    top = max(v.co.z for v in bm.verts)
    sel = [v for v in bm.verts if v.co.z > top - band]
    for _ in range(iters):
        new = {v: sum((e.other_vert(v).co for e in v.link_edges), Vector()) / max(1, len(v.link_edges)) for v in sel}
        for v, c in new.items():
            v.co = v.co.lerp(c, 0.6)
    bm.to_mesh(me)
    bm.free()
    me.update()
    print(f"  crown: {len(sel)} verts relaxed, top {top:.3f} → {max(v.co.z for v in me.vertices):.3f}", flush=True)


def weighted_normals(ob):
    """Area-weighted custom normals (big flat panels keep flat, thin bevels take the turn)."""
    m = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
    m.mode = "FACE_AREA"
    m.weight = 50
    m.keep_sharp = True
    with bpy.context.temp_override(object=ob, active_object=ob):
        bpy.ops.object.modifier_apply(modifier=m.name)


def coords(ob):
    me = ob.data
    co = np.zeros(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def bvh(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.transform(ob.matrix_world)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


# ------------------------------------------------------------------ landmarks
def _slab(co, z, half=0.012, pred=None):
    m = np.abs(co[:, 2] - z) < half
    if pred is not None:
        m &= pred(co)
    return co[m]


def _arm_axis(co, sx, shoulder, tip, iters=3):
    """Centre line of an arm from slabs perpendicular to the shoulder→fingertip line."""
    a, b = np.array(shoulder), np.array(tip)
    pts = None
    for _ in range(iters):
        d = b - a
        L_ = np.linalg.norm(d)
        u = d / L_
        rel = co - a
        t = rel @ u
        perp = rel - np.outer(t, u)
        r = np.linalg.norm(perp, axis=1)
        pts = []
        for k in np.linspace(0.12, 0.98, 22):
            tt = k * L_
            m = (np.abs(t - tt) < 0.014) & (r < 0.075) & (co[:, 0] * sx > 0.12)
            if m.sum() >= 4:
                pts.append(a + u * tt + perp[m].mean(0))
        pts = np.array(pts)
        # Refit the line through the centroids (least squares), keep its ends at the shoulder and tip.
        c = pts.mean(0)
        _, _, vt = np.linalg.svd(pts - c)
        u2 = vt[0] * np.sign(vt[0] @ u)
        a = c + u2 * ((np.array(shoulder) - c) @ u2)
        b = c + u2 * ((np.array(tip) - c) @ u2)
    return a, b, pts


def landmarks(ob):
    """Joint positions measured from the mesh. Legs: the crotch from a ray probe down the midline, the
    knee and ankle centres from slices through each leg, the ankle's height and the foot's length from
    the boot. Spine: centroids of torso slices at anatomical fractions of the stature. Arms: the centre
    line of each A-posed arm from slabs perpendicular to it (fitted twice), the joints along it at
    measured segment fractions; the fingertips are its far end."""
    co = coords(ob)
    T = bvh(ob)
    H = float(co[:, 2].max())
    J = {}
    crotch = None
    for z in np.arange(0.6, 1.05, 0.005):
        if T.ray_cast(Vector((0, 0.6, z)), Vector((0, -1, 0)), 1.2)[0] is not None:
            crotch = float(z)
            break
    hip_z = crotch + 0.105 * H / 1.81
    # Torso centre line (y) from slices.
    def cy(z, w=0.17):
        p = _slab(co, z, 0.02, lambda c: np.abs(c[:, 0]) < w)
        return float(0.5 * (p[:, 1].min() + p[:, 1].max()))
    for name, f in (("pelvis", 0.547), ("spine", 0.63), ("chest", 0.724), ("neck", 0.83), ("head", 0.893), ("crown", 0.985)):
        z = f * H
        J[name] = Vector((0, cy(z, 0.17 if f < 0.8 else 0.08), z))
    J["pelvis"].z = hip_z + 0.04
    J["root"] = Vector((0, 0, 0))
    for s, sx in (("L", 1), ("R", -1)):
        # Foot: heel and toe from the sole, ankle over the heel third.
        f = co[(co[:, 2] < 0.16) & (co[:, 0] * sx > 0.05)]
        heel, toe = float(f[:, 1].min()), float(f[:, 1].max())
        fx = float(np.median(f[f[:, 2] < 0.04][:, 0]))
        ankle_z = 0.0525 * H
        ay = heel + 0.27 * (toe - heel)
        J[f"ankle.{s}"] = Vector((fx, ay, ankle_z))
        J[f"toe.{s}"] = Vector((fx + sx * 0.005, heel + 0.74 * (toe - heel), 0.019 * H))
        J[f"heel.{s}"] = Vector((fx, heel, 0.0))
        J[f"tip.{s}"] = Vector((fx, toe, 0.0))
        def leg_c(z):
            p = _slab(co, z, 0.02, lambda c: (c[:, 0] * sx > 0.01) & (np.abs(c[:, 0]) < 0.26))
            return Vector((float(0.5 * (p[:, 0].min() + p[:, 0].max())), float(0.5 * (p[:, 1].min() + p[:, 1].max())), z))
        knee_z = ankle_z + 0.505 * (hip_z - ankle_z)
        J[f"knee.{s}"] = leg_c(knee_z)
        hc = leg_c(crotch - 0.03)
        J[f"hip.{s}"] = Vector((sx * max(0.085, abs(hc.x) * 0.82), J["pelvis"].y * 0.5, hip_z))
        # Arm: the shoulder joint under the acromion; the fingertip is the arm's farthest point.
        top = _slab(co, 0.79 * H, 0.03, lambda c: c[:, 0] * sx > 0.1)
        sh = Vector((sx * float(np.abs(top[:, 0]).max() - 0.055), float(top[:, 1].mean()), 0.775 * H))
        arm = co[(co[:, 0] * sx > 0.3) & (co[:, 2] > 0.65)]
        far = arm[np.argmax(np.linalg.norm(arm - np.array(sh), axis=1))]
        a, b, pts = _arm_axis(co, sx, sh, far)
        u = (b - a) / np.linalg.norm(b - a)
        L_ = float(np.linalg.norm(b - a))
        hand = 0.105 * H
        wrist = b - u * hand
        J[f"shoulder.{s}"] = sh
        Lw = float(np.linalg.norm(wrist - a))
        J[f"elbow.{s}"] = Vector(a + u * Lw * 0.54)
        J[f"wrist.{s}"] = Vector(wrist)
        J[f"knuckle.{s}"] = Vector(b - u * hand * 0.47)
        J[f"fingertip.{s}"] = Vector(b)
        J[f"armaxis.{s}"] = pts
    J["_crotch"] = crotch
    J["_H"] = H
    return J
