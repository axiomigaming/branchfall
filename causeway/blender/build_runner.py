"""The runner: modelled, rigged, painted, animated and exported → public/assets/runner.glb.

An original character (not a likeness of anyone): a field archaeologist in a
bleached linen shirt with rolled sleeves, olive canvas trousers, worn boots and
a leather pack with a bedroll — a strong, readable silhouette from behind,
which is where the chase camera sees them.

    python3 blender/build_runner.py [--preview]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

from common import reset, hexcol, new_mesh_obj, link, bake_group, ensure_uvs, export_glb, OUT, CACHE, preview
import materials as M

PREVIEW = "--preview" in sys.argv
reset()
FPS = 30
bpy.context.scene.render.fps = FPS

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
        f"shoulder.{s}": (x * 0.2, -0.01, 1.44),
        f"elbow.{s}": (x * 0.24, -0.03, 1.16),
        f"wrist.{s}": (x * 0.26, 0.0, 0.93),
        f"hand.{s}": (x * 0.27, 0.01, 0.84),
        f"hip.{s}": (x * 0.1, 0.0, 0.95),
        f"knee.{s}": (x * 0.105, 0.025, 0.53),
        f"ankle.{s}": (x * 0.11, -0.01, 0.1),
        f"toe.{s}": (x * 0.115, 0.15, 0.035),
    })
V = {k: Vector(v) for k, v in J.items()}

# ------------------------------------------------------------------ body (skin modifier)
RADII = {
    "pelvis": (0.165, 0.12), "spine": (0.15, 0.11), "chest": (0.185, 0.12), "neck": (0.06, 0.062),
    "head": (0.092, 0.105), "crown": (0.07, 0.08),
}
for s in "LR":
    RADII.update({
        f"clav.{s}": (0.11, 0.09), f"shoulder.{s}": (0.068, 0.066), f"elbow.{s}": (0.05, 0.05), f"wrist.{s}": (0.036, 0.03),
        f"hand.{s}": (0.045, 0.022), f"hip.{s}": (0.1, 0.1), f"knee.{s}": (0.068, 0.068), f"ankle.{s}": (0.055, 0.058),
        f"toe.{s}": (0.05, 0.035),
    })
EDGES = [("pelvis", "spine"), ("spine", "chest"), ("chest", "neck"), ("neck", "head"), ("head", "crown")]
for s in "LR":
    EDGES += [("chest", f"clav.{s}"), (f"clav.{s}", f"shoulder.{s}"), (f"shoulder.{s}", f"elbow.{s}"),
              (f"elbow.{s}", f"wrist.{s}"), (f"wrist.{s}", f"hand.{s}"), ("pelvis", f"hip.{s}"),
              (f"hip.{s}", f"knee.{s}"), (f"knee.{s}", f"ankle.{s}"), (f"ankle.{s}", f"toe.{s}")]

names = [k for k in RADII]
me = bpy.data.meshes.new("body")
me.from_pydata([V[k] for k in names], [(names.index(a), names.index(b)) for a, b in EDGES], [])
body = bpy.data.objects.new("runner_body", me)
link(body)
sk = body.modifiers.new("skin", "SKIN")
sk.branch_smoothing = 0.6
sk.use_smooth_shade = True
for i, k in enumerate(names):
    r = RADII[k]
    body.data.skin_vertices[0].data[i].radius = r
body.data.skin_vertices[0].data[names.index("pelvis")].use_root = True
sub = body.modifiers.new("sub", "SUBSURF")
sub.levels = 2
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.modifier_apply(modifier="skin")
bpy.ops.object.modifier_apply(modifier="sub")

# Sculpt-ish shaping in code: chest/back volume, calves, glutes, trouser looseness, boot toe.
bm = bmesh.new()
bm.from_mesh(body.data)
for v in bm.verts:
    c = v.co
    # Shoulder blades and chest.
    if 1.22 < c.z < 1.46 and abs(c.x) < 0.2:
        c.y += 0.018 * math.sin((c.z - 1.22) / 0.24 * math.pi) * (1 if c.y > 0 else 0.6)
    # Calves (behind the shin).
    for s, x in (("L", 1), ("R", -1)):
        if 0.2 < c.z < 0.5 and c.x * x > 0 and c.y < 0.02:
            c.y -= 0.018 * math.sin((c.z - 0.2) / 0.3 * math.pi)
    # Glutes.
    if 0.82 < c.z < 1.02 and c.y < -0.03:
        c.y -= 0.02 * math.sin((c.z - 0.82) / 0.2 * math.pi)
    # Face: a nose and a brow.
    h = V["head"]
    d = c - h
    if d.y > 0.07 and abs(d.x) < 0.028 and -0.035 < d.z < 0.02:
        c.y += 0.018 * (1 - abs(d.x) / 0.028) * (1 - abs(d.z + 0.008) / 0.028)
    if d.y > 0.06 and 0.02 < d.z < 0.045 and abs(d.x) < 0.06:
        c.y += 0.008
    # Jaw narrower.
    if d.z < -0.03 and c.z > 1.52:
        c.x *= 0.92
bm.to_mesh(body.data)
bm.free()

# ------------------------------------------------------------------ paint regions (float colour per face corner)
SKIN = hexcol("#c58c68")
HAIR = hexcol("#3b2618")
SHIRT = hexcol("#d9cba8")
SHIRT_SHADOW = hexcol("#c8b793")
TROUSER = hexcol("#454b35")
BOOT = hexcol("#4a3021")
SOLE = hexcol("#231811")
BELT = hexcol("#5a3a22")
BUCKLE = hexcol("#a8874e")
EYE = hexcol("#2a1d16")


def region(c, n):
    h = V["head"]
    d = c - h
    if c.z > 1.535:
        if d.z > 0.035 or d.y < -0.02 or (d.z > -0.01 and abs(d.x) > 0.085 and d.y < 0.04):
            return HAIR
        if d.y > 0.075 and 0.0 < d.z < 0.022 and 0.018 < abs(d.x) < 0.048:
            return EYE
        return SKIN
    if c.z > 1.485:
        return SKIN if c.y > -0.02 or c.z > 1.51 else SHIRT
    arm = abs(c.x) > 0.2 and c.z > 0.8
    if arm:
        # Distance along the arm from shoulder, via height.
        if c.z > 1.12:
            return SHIRT
        return SKIN
    if c.z > 1.035:
        return SHIRT if (c.x * 7 + c.z * 13) % 1 > 0.02 else SHIRT_SHADOW
    if c.z > 0.975:
        if c.y > 0.1 and abs(c.x) < 0.035:
            return BUCKLE
        return BELT
    if c.z > 0.2:
        return TROUSER
    if c.z > 0.03:
        return BOOT
    return SOLE


bm = bmesh.new()
bm.from_mesh(body.data)
cl = bm.loops.layers.float_color.new("Col")
for f in bm.faces:
    col = region(f.calc_center_median(), f.normal)
    for l in f.loops:
        l[cl] = col
bm.to_mesh(body.data)
bm.free()


def solid(name, bmfn, color, group):
    bm = bmesh.new()
    bmfn(bm)
    cl = bm.loops.layers.float_color.new("Col")
    for f in bm.faces:
        for l in f.loops:
            l[cl] = color if not callable(color) else color(f.calc_center_median())
    ob = new_mesh_obj(name, bm)
    for p in ob.data.polygons:
        p.use_smooth = True
    vg = ob.vertex_groups.new(name=group)
    vg.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    return ob


def rounded_box(size, loc, bevel=0.03, seg=3):
    def f(bm):
        bmesh.ops.create_cube(bm, size=1)
        for v in bm.verts:
            v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=seg, affect="EDGES")
        bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return f


def ring(center, radius, minor, axis="Z", seg=20, flat=1.0, sy=1.0):
    def f(bm):
        rot = {"Z": Matrix(), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
        verts = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ringv = []
            for j in range(8):
                b = 2 * math.pi * j / 8
                p = Vector(((radius + minor * math.cos(b)) * math.cos(a), (radius + minor * math.cos(b)) * math.sin(a) * sy, minor * math.sin(b) * flat))
                ringv.append(bm.verts.new((Matrix.Translation(center) @ rot) @ p))
            verts.append(ringv)
        for i in range(seg):
            for j in range(8):
                bm.faces.new((verts[i][j], verts[(i + 1) % seg][j], verts[(i + 1) % seg][(j + 1) % 8], verts[i][(j + 1) % 8]))
    return f


def cyl(p0, p1, r, seg=16):
    def f(bm):
        d = Vector(p1) - Vector(p0)
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
        q = d.to_track_quat("Z", "Y")
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges if e.calc_face_angle(0) > 1.0], offset=r * 0.3, segments=2, affect="EDGES")
        bmesh.ops.transform(bm, matrix=Matrix.Translation((Vector(p0) + Vector(p1)) / 2) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return f


PACK = hexcol("#6b4a2e")
PACK_DARK = hexcol("#4d331f")
ROLL = hexcol("#7a6a4c")
extras = [
    solid("pack", rounded_box((0.3, 0.15, 0.34), (0, -0.2, 1.22), 0.045), lambda c: PACK if c.z > 1.08 else PACK_DARK, "chest"),
    solid("pack_flap", rounded_box((0.31, 0.16, 0.12), (0, -0.205, 1.35), 0.03), PACK_DARK, "chest"),
    solid("pack_pocket", rounded_box((0.2, 0.06, 0.13), (0, -0.29, 1.16), 0.025), PACK_DARK, "chest"),
    solid("bedroll", cyl((-0.21, -0.2, 1.445), (0.21, -0.2, 1.445), 0.075), ROLL, "chest"),
    solid("strap_L", rounded_box((0.045, 0.3, 0.02), (0.1, -0.06, 1.47), 0.008, 2), BELT, "chest"),
    solid("strap_R", rounded_box((0.045, 0.3, 0.02), (-0.1, -0.06, 1.47), 0.008, 2), BELT, "chest"),
    solid("belt", ring(Vector((0, 0.0, 1.0)), 0.16, 0.028, flat=1.1, sy=0.8), BELT, "hips"),
    solid("buckle", rounded_box((0.07, 0.02, 0.05), (0, 0.175, 1.0), 0.008, 2), BUCKLE, "hips"),
    solid("collar", ring(Vector((0, 0.005, 1.48)), 0.068, 0.018, flat=0.7), SHIRT_SHADOW, "chest"),
]
for s, x in (("L", 1), ("R", -1)):
    # Rolled sleeve cuff just above the elbow.
    e, sh = V[f"elbow.{s}"], V[f"shoulder.{s}"]
    p = e + (sh - e) * 0.12
    ob = solid(f"cuff_{s}", ring(Vector((0, 0, 0)), 0.052, 0.02, flat=1.2), SHIRT_SHADOW, f"upper_arm.{s}")
    ob.matrix_world = Matrix.Translation(p) @ (sh - e).to_track_quat("Z", "Y").to_matrix().to_4x4()
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    extras.append(ob)
    # Boot cuff.
    a = V[f"ankle.{s}"]
    extras.append(solid(f"bootcuff_{s}", ring(a + Vector((0, 0, 0.12)), 0.062, 0.018), BOOT, f"shin.{s}"))
    # Ears.
    extras.append(solid(f"ear_{s}", rounded_box((0.018, 0.04, 0.055), (x * 0.093, 0.01, 1.615), 0.012, 2), SKIN, "head"))

# ------------------------------------------------------------------ armature
arm_data = bpy.data.armatures.new("rig")
rig = bpy.data.objects.new("runner", arm_data)
link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None, connect=False, roll=0.0):
    b = eb.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    b.roll = roll
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
for s in "LR":
    bone(f"shoulder.{s}", V["chest"] + Vector((0, 0, 0.12)), V[f"shoulder.{s}"], "chest")
    bone(f"upper_arm.{s}", V[f"shoulder.{s}"], V[f"elbow.{s}"], f"shoulder.{s}", True)
    bone(f"forearm.{s}", V[f"elbow.{s}"], V[f"wrist.{s}"], f"upper_arm.{s}", True)
    bone(f"hand.{s}", V[f"wrist.{s}"], V[f"hand.{s}"] + Vector((0, 0, -0.04)), f"forearm.{s}", True)
    bone(f"thigh.{s}", V[f"hip.{s}"], V[f"knee.{s}"], "hips")
    bone(f"shin.{s}", V[f"knee.{s}"], V[f"ankle.{s}"], f"thigh.{s}", True)
    bone(f"foot.{s}", V[f"ankle.{s}"], V[f"toe.{s}"] + Vector((0, -0.05, 0.0)), f"shin.{s}", True)
    bone(f"toe.{s}", V[f"toe.{s}"] + Vector((0, -0.05, 0.0)), V[f"toe.{s}"] + Vector((0, 0.04, 0)), f"foot.{s}", True)
# Uniform roll so local X is the hinge axis for every limb (flexion = rotation about X).
for b in eb:
    b.align_roll(Vector((0, 0, 1)) if abs(b.vector.normalized().z) < 0.7 else Vector((0, -1, 0)))
bpy.ops.object.mode_set(mode="OBJECT")

# Bind the body with automatic (heat) weights.
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")

# Accessories: rigid to their bone, then merged into the body.
bpy.ops.object.select_all(action="DESELECT")
for o in extras:
    o.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.name = "runner_mesh"

# ------------------------------------------------------------------ bake a painted texture
mat = bpy.data.materials.new("runner_paint")
from common import nodes_clear, N, L, mix, ramp, maprange, math_node
nt = nodes_clear(mat)
out = N(nt, "ShaderNodeOutputMaterial")
bsdf = N(nt, "ShaderNodeBsdfPrincipled")
L(nt, bsdf.outputs[0], out.inputs[0])
vc = N(nt, "ShaderNodeVertexColor", _layer_name="Col")
tc = N(nt, "ShaderNodeTexCoord")
weave = N(nt, "ShaderNodeTexNoise", Scale=180.0, Detail=2.0)
L(nt, tc.outputs["Object"], weave.inputs["Vector"])
folds = N(nt, "ShaderNodeTexNoise", Scale=9.0, Detail=3.0, Distortion=1.5)
L(nt, tc.outputs["Object"], folds.inputs["Vector"])
col = mix(nt, 1.0, vc.outputs[0], ramp(nt, weave.outputs[0], [(0.35, (0.9, 0.9, 0.9)), (0.65, (1.06, 1.06, 1.06))]), "MULTIPLY")
col = mix(nt, 1.0, col, ramp(nt, folds.outputs[0], [(0.3, (0.8, 0.8, 0.8)), (0.7, (1.05, 1.05, 1.05))]), "MULTIPLY")
dust = N(nt, "ShaderNodeTexNoise", Scale=5.0, Detail=5.0)
L(nt, tc.outputs["Object"], dust.inputs["Vector"])
sep = N(nt, "ShaderNodeSeparateXYZ")
L(nt, tc.outputs["Object"], sep.inputs[0])
low = maprange(nt, sep.outputs[2], 0.55, 0.05, 0.0, 0.22)
col = mix(nt, math_node(nt, "MULTIPLY", low, maprange(nt, dust.outputs[0], 0.4, 0.6)), col, hexcol("#9c7a55"), "MIX")
L(nt, col, bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.78
bump = N(nt, "ShaderNodeBump", Strength=0.35, Distance=0.01)
L(nt, folds.outputs[0], bump.inputs["Height"])
b2 = N(nt, "ShaderNodeBump", Strength=0.15, Distance=0.002)
L(nt, weave.outputs[0], b2.inputs["Height"])
L(nt, bump.outputs[0], b2.inputs["Normal"])
L(nt, b2.outputs[0], bsdf.inputs["Normal"])

ensure_uvs([body], margin=0.006, angle=55)
bake_group([body], mat, "runner", 512 if PREVIEW else 2048, ao_samples=8 if PREVIEW else 24, ao_strength=0.5)

# ------------------------------------------------------------------ animation
pb = rig.pose.bones
for p in pb:
    p.rotation_mode = "XYZ"


def key(frame, pose, root_z=0.0, root_y=0.0):
    for p in pb:
        p.rotation_euler = Euler((0, 0, 0))
        p.location = Vector((0, 0, 0))
    pb["hips"].location = Vector((0, 0, 0))
    for name, rot in pose.items():
        pb[name].rotation_euler = Euler(rot)
    # Hips bone points up (+Z world) so its local Y is world Z: bob goes in local Y.
    pb["hips"].location = Vector((0, root_z, -root_y))
    for p in pb:
        p.keyframe_insert("rotation_euler", frame=frame)
        p.keyframe_insert("location", frame=frame)


def new_action(name):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    return act


def mirror(s):
    return "R" if s == "L" else "L"


# Semantic pose helpers. Rig convention (verified by render): down-pointing bones flex
# forward with −X, up-pointing bones lean forward with −X, knees flex with +X.
def leg(P, s, hip=0.0, knee=0.0, ankle=0.0, toe=0.0, out=0.0):
    P[f"thigh.{s}"] = (-hip, 0, out if s == "L" else -out)
    P[f"shin.{s}"] = (knee, 0, 0)
    P[f"foot.{s}"] = (-ankle, 0, 0)
    P[f"toe.{s}"] = (toe, 0, 0)


def arm(P, s, fwd=0.0, elbow=0.0, out=0.12, wrist=0.0, twist=0.0):
    P[f"upper_arm.{s}"] = (-fwd, twist, out if s == "L" else -out)
    P[f"forearm.{s}"] = (-elbow, 0, 0)
    P[f"hand.{s}"] = (wrist, 0, 0)


def torso(P, lean=0.0, look=0.0, twist=0.0, side=0.0, hips=0.0):
    P["hips"] = (-hips, 0, -twist * 0.5)
    P["spine"] = (-lean * 0.6, side, twist * 0.5)
    P["chest"] = (-lean * 0.4, 0, twist * 0.6)
    P["neck"] = (look * 0.6, 0, -twist * 0.7)
    P["head"] = (look * 0.4, 0, -twist * 0.3)


# Sprint leg key-poses over one stride, t=0 is foot strike: (t, hip, knee, ankle).
STRIDE = [
    (0.00, 0.38, 0.22, -0.05),
    (0.12, 0.05, 0.50, -0.15),
    (0.30, -0.50, 0.25, 0.45),
    (0.42, -0.62, 0.85, 0.65),
    (0.58, -0.10, 2.05, 0.40),
    (0.76, 0.95, 1.55, 0.00),
    (0.90, 0.72, 0.55, -0.15),
]


def sample(keys, t):
    """Periodic Catmull-Rom through (t, *values) keys."""
    n = len(keys)
    for i in range(n):
        t0 = keys[i][0]
        t1 = keys[(i + 1) % n][0] + (1.0 if i + 1 == n else 0.0)
        tt = t if t >= t0 else t + 1.0
        if t0 <= tt < t1:
            u = (tt - t0) / (t1 - t0)
            p0, p1, p2, p3 = (keys[(i + k) % n][1:] for k in (-1, 0, 1, 2))
            return [0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u ** 3)
                    for a, b, c, d in zip(p0, p1, p2, p3)]
    return list(keys[0][1:])


def run_pose(ph, k=1.0):
    P = {}
    tw = 2 * math.pi
    for s, off in (("L", 0.0), ("R", 0.5)):
        t = (ph + off) % 1.0
        hip, knee, ankle = sample(STRIDE, t)
        leg(P, s, hip * k, knee * (0.6 + 0.4 * k), ankle, toe=0.35 * max(0.0, math.sin(tw * (t - 0.2))), out=0.03)
        # The opposite arm drives with this leg.
        swing = math.cos(tw * (t - 0.02))  # +1 when this leg reaches forward
        arm(P, mirror(s), fwd=(-0.75 * swing + 0.15) * k, elbow=1.45 + 0.35 * max(0.0, -swing), out=0.16, wrist=0.15)
    twist = 0.14 * math.sin(tw * ph) * k
    torso(P, lean=0.34 * k, look=0.3 * k, twist=twist, hips=0.06 * k)
    P["shoulder.L"] = (0, 0, 0.05 * math.sin(tw * ph))
    P["shoulder.R"] = (0, 0, 0.05 * math.sin(tw * ph))
    # Two flight phases per cycle: highest just after each toe-off.
    bob = 0.04 * math.cos(2 * tw * (ph - 0.42)) - 0.035
    return P, bob


# RUN — 20 frames at 30 fps; the game scales playback with speed.
new_action("run")
RUN_F = 20
for f in range(RUN_F + 1):
    P, bob = run_pose(f / RUN_F)
    key(f + 1, P, bob)

# IDLE — relaxed stance, breathing, a weight shift; 90 frames.
new_action("idle")
for f in range(0, 91, 3):
    t = f / 90 * 2 * math.pi
    br = math.sin(t * 2)
    P = {}
    torso(P, lean=0.03 + 0.015 * br, look=-0.02, twist=0.05 * math.sin(t), side=0.02 * math.sin(t))
    P["head"] = (0.02 * math.sin(t * 2 + 0.5), 0, 0.14 * math.sin(t))
    arm(P, "L", fwd=0.05, elbow=0.25 + 0.03 * br, out=0.1)
    arm(P, "R", fwd=0.02, elbow=0.3, out=0.1)
    leg(P, "L", hip=0.05, knee=0.08, out=0.05)
    leg(P, "R", hip=-0.04, knee=0.02, out=0.08)
    key(f + 1, P, -0.008 + 0.004 * br)

# READY — coiled start stance, 40-frame loop.
new_action("ready")
for f in range(0, 41, 4):
    br = math.sin(f / 40 * 2 * math.pi)
    P = {}
    torso(P, lean=0.75 + 0.02 * br, look=0.7, hips=0.2)
    leg(P, "L", hip=0.95, knee=1.45, ankle=-0.35)
    leg(P, "R", hip=-0.1, knee=0.85, ankle=0.25)
    arm(P, "R", fwd=0.9, elbow=1.2, out=0.15)
    arm(P, "L", fwd=-0.7, elbow=0.9, out=0.2)
    key(f + 1, P, -0.2 + 0.006 * br, 0.03)

# FALL — the way gives out: a stumble, hands thrown out, down to the knees, sitting back. 54 frames, holds.
new_action("fall")
P0, b0 = run_pose(0.0)
key(1, P0, b0)
P = {}
torso(P, lean=0.8, look=0.6, twist=0.1)
leg(P, "L", hip=1.0, knee=0.5)
leg(P, "R", hip=-0.5, knee=1.7, ankle=0.5)
arm(P, "L", fwd=1.4, elbow=0.3, out=0.5)
arm(P, "R", fwd=1.3, elbow=0.35, out=0.5)
key(7, P, -0.1, 0.12)
P = {}
torso(P, lean=0.45, look=-0.1, twist=0.15)
leg(P, "L", hip=1.45, knee=2.25, ankle=-0.5)
leg(P, "R", hip=0.95, knee=2.35, ankle=-0.55, out=0.1)
arm(P, "L", fwd=1.2, elbow=0.4, out=0.7)
arm(P, "R", fwd=1.1, elbow=0.5, out=0.7)
key(15, P, -0.46, 0.2)
P = {}
torso(P, lean=-0.12, look=-0.3, twist=0.12)
leg(P, "L", hip=1.6, knee=2.5, ankle=-0.7, out=0.12)
leg(P, "R", hip=1.5, knee=2.45, ankle=-0.7, out=0.15)
arm(P, "L", fwd=-0.45, elbow=0.3, out=0.4)
arm(P, "R", fwd=-0.5, elbow=0.35, out=0.4)
key(27, P, -0.62, 0.1)
P = {}
torso(P, lean=-0.2, look=-0.15, twist=0.2)
P["head"] = (-0.05, 0, 0.25)
leg(P, "L", hip=1.58, knee=2.5, ankle=-0.7, out=0.14)
leg(P, "R", hip=1.5, knee=2.45, ankle=-0.7, out=0.17)
arm(P, "L", fwd=-0.55, elbow=0.35, out=0.35)
arm(P, "R", fwd=-0.6, elbow=0.3, out=0.35)
key(54, P, -0.64, 0.08)

# WIN — out of the sprint to standing, one clenched fist raised, breathing hard. 60 frames, holds.
new_action("win")
P0, b0 = run_pose(0.5)
key(1, P0, b0)
P = {}
torso(P, lean=0.35, look=0.3)
leg(P, "L", hip=0.5, knee=0.6)
leg(P, "R", hip=-0.15, knee=0.5)
arm(P, "L", fwd=-0.3, elbow=1.1, out=0.2)
arm(P, "R", fwd=0.3, elbow=1.0, out=0.2)
key(10, P, -0.07)
for fr, lift, bob in ((24, 2.7, -0.02), (36, 2.85, -0.01)):
    P = {}
    torso(P, lean=0.08, look=-0.12, twist=-0.15)
    leg(P, "L", hip=0.1, knee=0.15, out=0.06)
    leg(P, "R", hip=-0.02, knee=0.1, out=0.1)
    arm(P, "L", fwd=0.1, elbow=0.4, out=0.15)
    arm(P, "R", fwd=lift, elbow=0.55, out=0.25, wrist=0.3)
    key(fr, P, bob)
P = {}
torso(P, lean=0.28, look=0.15, twist=-0.05)
leg(P, "L", hip=0.12, knee=0.25, out=0.07)
leg(P, "R", hip=0.05, knee=0.2, out=0.1)
arm(P, "L", fwd=0.25, elbow=0.5, out=0.18)
arm(P, "R", fwd=0.2, elbow=0.45, out=0.18)
key(60, P, -0.04)

for act in bpy.data.actions:
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER" if act.name in ("fall", "win") else "LINEAR"

rig.animation_data.action = bpy.data.actions["run"]

if PREVIEW:
    for name, frame, cam in (("run", 1, (3.4, 0.4, 1.0)), ("run", 5, (3.4, 0.4, 1.0)), ("run", 9, (3.4, 0.4, 1.0)),
                             ("run", 13, (3.4, 0.4, 1.0)), ("run", 17, (3.4, 0.4, 1.0)), ("run", 6, (0.5, -3.6, 1.9)),
                             ("ready", 1, (3.0, 1.5, 1.0)), ("fall", 54, (2.5, 2.5, 1.3)), ("win", 30, (1.2, 3.2, 1.4))):
        rig.animation_data.action = bpy.data.actions[name]
        bpy.context.scene.frame_set(frame)
        preview(f"{CACHE}/runner_{name}_{frame}.png", cam, (0, 0, 0.9), lens=40, res=(480, 540), samples=12, sun=(40, 0, 130))
    sys.exit(0)

export_glb(os.path.join(OUT, "runner.glb"), [rig, body], anim=True, quality=88)
