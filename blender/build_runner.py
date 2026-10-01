"""The runner: sculpted, dressed, rigged, baked, animated and exported → public/assets/runner.glb.

An original character (not a likeness of anyone): a field archaeologist in his thirties, heroic
7.5-head proportions, cropped hair, in a sun-bleached khaki short-sleeved shirt worn open at the
collar and untucked, a blue-grey undershirt sleeve showing to the elbow, dark green canvas trousers
bloused over laced leather field boots, a rust neckerchief, and a compact leather satchel on a
cross-body strap. From behind — where the chase camera sees him — the back, the shoulders and the
arms read, and the shirt tail and sleeves move (spring bones: hem.*, sleeve.*).

Pipeline (see char_*.py):
  1. Sculpt: anatomy from overlapping masses (metaballs), a head from a displaced surface with real
     lids and ears, hands from masses; everything fused by voxel remeshing.
  2. Tailor: shirt and trousers are shells cut from the body and displaced into folds, seams and
     stitches; collar, placket, pockets, rolled cuffs, boots and kit are built on top of them.
  3. Paint: colour and material channels on the dense surfaces (skin, stubble, weave, leather, dirt).
  4. Bake: the dense surfaces onto decimated game meshes (colour, normal, roughness, AO, metal).
  5. Rig: body weights by bone heat on a proxy, transferred to the clothes; rigid kit on its bones.
  6. Animate (runner_anim.py) and export.

    python3 blender/build_runner.py [--preview[=model|run|react|react2|all]] [--reuse]

`--reuse` skips 1–5 and loads the last built model from blender/cache (for animation work).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix, noise

from common import reset, hexcol, link, export_glb, OUT, CACHE, nodes_clear, N, L, mix, ramp, maprange, math_node
import char_sculpt as S
import char_forms as F
import char_cloth as C
import char_gear as G

PREVIEW = next((a.split("=", 1)[1] if "=" in a else "all" for a in sys.argv if a.startswith("--preview")), None)
REUSE = "--reuse" in sys.argv
MODEL_BLEND = os.path.join(CACHE, "runner_model.blend")
TEX = 1024 if (PREVIEW and not REUSE and "--full" not in sys.argv) else 2048
V = F.V
HC = F.HC
FPS = 30

# ------------------------------------------------------------------ palette (linear) and material channels
SKIN = hexcol("#b98b6f")
SKIN_RED = hexcol("#b8796a")
SKIN_TAN = hexcol("#a87a5d")
LIP = hexcol("#8a4a42")
SHIRT = hexcol("#cdbc8e")
SHIRT_DARK = hexcol("#b3a077")
UNDER = hexcol("#7c8c98")
UNDER_DARK = hexcol("#66747f")
BUTTON = hexcol("#3a2b20")
TROUSER = hexcol("#2f3b2b")
TROUSER_WORN = hexcol("#3e4a37")
BOOT = hexcol("#5a3924")
BOOT_WORN = hexcol("#7a5438")
SOLE = hexcol("#241b15")
LACE = hexcol("#6e5238")
BELT = hexcol("#4a2e1c")
BRASS = hexcol("#a78648")
STEEL = hexcol("#7d7a72")
LEATHER = hexcol("#6d4a2d")
LEATHER_DARK = hexcol("#533620")
STRAP = hexcol("#4a311e")
CANVAS = hexcol("#6a6346")
ROLL = hexcol("#786a4c")
ROPE = hexcol("#a28a5f")
SCARF = hexcol("#8c3322")
HAIR = hexcol("#24170f")
SCLERA = hexcol("#d9d0c4")
IRIS = hexcol("#4a3a22")
PUPIL = hexcol("#0d0a08")

# Mat = (roughness, weave, hair streaks, stubble); Mat2 = (skin, leather, dirt, metal).
def ch(rough, weave=0.0, hair=0.0, stubble=0.0, skin=0.0, leather=0.0, dirt=0.0, metal=0.0):
    return (rough, weave, hair, stubble), (skin, leather, dirt, metal)


CH_SKIN = ch(0.52, skin=1.0)
CH_CLOTH = ch(0.9, weave=1.0)
CH_CANVAS = ch(0.88, weave=0.8)
CH_LEATHER = ch(0.6, leather=1.0)
CH_METAL = ch(0.38, metal=1.0)
CH_RUBBER = ch(0.85)
CH_HAIR = ch(0.6, hair=1.0)
CH_ROPE = ch(0.9, weave=0.6, hair=0.6)
CH_EYE = ch(0.12)


def bell(x, c, w):
    return math.exp(-((x - c) / w) ** 2)


def lerpc(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


# ------------------------------------------------------------------ paint
def paint(ob, fn):
    """Point-domain colour attributes Col / Mat / Mat2 from fn(co, normal) → (col, (mat, mat2))."""
    me = ob.data
    n = len(me.vertices)
    cols = np.zeros((n, 4), np.float32)
    m1 = np.zeros((n, 4), np.float32)
    m2 = np.zeros((n, 4), np.float32)
    for i, v in enumerate(me.vertices):
        col, (a, b) = fn(v.co, v.normal)
        cols[i] = col
        m1[i] = a
        m2[i] = b
    for name, arr in (("Col", cols), ("Mat", m1), ("Mat2", m2)):
        if name in me.color_attributes:
            me.color_attributes.remove(me.color_attributes[name])
        at = me.color_attributes.new(name, "FLOAT_COLOR", "POINT")
        at.data.foreach_set("color", arr.ravel())


def flat(col, chn):
    return lambda c, n: (col, chn)


def head_paint(c, n):
    q = c - HC
    x, y, z = q
    ax = abs(x)
    col = SKIN
    rough, _, _, stub = CH_SKIN[0]
    stub = 0.0
    front = smooth((y - 0.02) / 0.05)
    # Warmth: ears, nose tip, cheeks and lips carry more blood; the brow and temples more sun.
    red = 0.0
    red += 0.7 * smooth((ax - 0.07) / 0.008)
    red += 0.4 * bell(ax, 0.0, 0.012) * bell(z, -0.033, 0.012) * front
    red += 0.2 * bell(ax, 0.042, 0.018) * bell(z, -0.02, 0.018) * front
    col = lerpc(col, SKIN_RED, red)
    col = lerpc(col, SKIN_TAN, 0.5 * smooth((z - 0.03) / 0.04))
    # Lips.
    if front > 0.5 and ax < 0.024 - 0.25 * max(0.0, abs(z + 0.0625) - 0.0) and -0.072 < z < -0.052:
        k = smooth((0.022 - ax) / 0.006)
        col = lerpc(col, LIP, 0.85 * k)
        # The line between the lips reads dark; the upper lip's edge a touch darker too.
        col = lerpc(col, hexcol("#4a2620"), 0.85 * bell(z, -0.0625, 0.0012) * k)
        col = lerpc(col, hexcol("#6e3a33"), 0.4 * bell(z, -0.053, 0.001) * k)
        rough = 0.42
    # Stubble: jaw, chin, upper lip, the cheeks below the cheekbones; thins toward the cheekbone.
    if y > -0.03 or z < -0.06:
        top = -0.04 - 0.012 * smooth((0.03 - ax) / 0.02) + 0.02 * smooth((0.02 - y) / 0.04)
        stub = smooth((top - z) / 0.012)
        if ax < 0.025 and -0.072 < z < -0.052 and front > 0.5:
            stub = 0.0
        # The neck under the jaw fades out.
        stub *= smooth((z + 0.14) / 0.03)
    # Eyelid margins and the sockets: a touch darker and cooler.
    for sx in (-1, 1):
        e = F.eye_centre(sx) - HC
        de = Vector((x - e.x, (y - e.y) * 0.3, (z - e.z) * 1.4)).length
        col = lerpc(col, hexcol("#9a6650"), 0.15 * bell(de, 0.0, 0.012) * front)
    return col, ((rough, 0.0, 0.0, stub), (1.0, 0.0, 0.0, 0.0))


def eye_paint(sx):
    ec = F.eye_centre(sx)
    fwd = Matrix.Rotation(sx * 0.12, 3, "Z") @ Vector((0, 1, 0))

    def f(c, n):
        d = (c - ec).normalized()
        k = d.dot(fwd)
        if k > 0.972:
            return PUPIL, CH_EYE
        if k > 0.8:
            t = (k - 0.8) / 0.172
            return lerpc(IRIS, hexcol("#6a5a30"), t * 0.6), CH_EYE
        if k > 0.78:
            return hexcol("#2a2014"), CH_EYE
        return lerpc(SCLERA, hexcol("#c9a898"), smooth((0.6 - k) / 0.6) * 0.5), CH_EYE
    return f


def skin_paint(c, n):
    # Forearms and neck: sun-browned, darker toward the hands; fine arm hair via the stubble speckle.
    tan = smooth((1.3 - c.z) / 0.3) if abs(c.x) > 0.15 else 0.0
    col = lerpc(SKIN, SKIN_TAN, 0.6 * tan)
    hair = 0.35 * tan if abs(c.x) > 0.15 else 0.0
    return col, ((0.55, 0.0, 0.0, hair), (1.0, 0.0, 0.0, 0.0))


def hand_paint(c, n):
    col = lerpc(SKIN, SKIN_TAN, 0.6)
    # Knuckles redder; nails paler on the fingertips' backs.
    red = bell(c.z, 0.848, 0.012) * smooth((abs(c.x) - 0.268) / 0.006)
    col = lerpc(col, SKIN_RED, 0.6 * red)
    return col, CH_SKIN


def shirt_paint(c, n):
    # Sun-bleached on the shoulders, sweat and dust darker at the back and the waist.
    t = 0.5 + 0.5 * noise.noise(c * 6)
    col = lerpc(SHIRT, SHIRT_DARK, 0.35 * t)
    col = lerpc(col, SHIRT_DARK, 0.35 * smooth((1.0 - c.z) / 0.08))
    col = lerpc(col, hexcol("#dccda6"), 0.55 * smooth((c.z - 1.38) / 0.08))
    # Sweat darkens a patch down the spine between the shoulder blades.
    col = lerpc(col, SHIRT_DARK, 0.45 * smooth((-c.y - 0.1) / 0.04) * bell(c.x, 0.0, 0.05) * bell(c.z, 1.3, 0.09))
    dirt = 0.3 * smooth((0.98 - c.z) / 0.07) + 0.2 * smooth((-c.y - 0.08) / 0.05) * bell(c.z, 1.25, 0.1)
    return col, ((0.9, 1.0, 0.0, 0.0), (0.0, 0.0, dirt, 0.0))


def under_paint(c, n):
    t = 0.5 + 0.5 * noise.noise(c * 9)
    return lerpc(UNDER, UNDER_DARK, 0.4 * t), ((0.85, 0.7, 0.0, 0.0), (0.0, 0.0, 0.1, 0.0))


def trouser_paint(c, n):
    t = 0.5 + 0.5 * noise.noise(c * 5)
    col = lerpc(TROUSER, TROUSER_WORN, 0.3 * t)
    # Worn knees and seat, dust climbing from the boots.
    x, y, z = c
    wear = bell(z, 0.53, 0.05) * smooth((y - 0.02) / 0.04) + bell(z, 0.9, 0.06) * smooth((-y - 0.05) / 0.04)
    col = lerpc(col, TROUSER_WORN, 0.7 * wear)
    dirt = 0.45 * smooth((0.4 - z) / 0.25) + 0.15 * wear
    return col, ((0.88, 0.8, 0.0, 0.0), (0.0, 0.0, dirt, 0.0))


def boot_paint(c, n):
    ax = abs(c.x)
    col = BOOT
    worn = smooth((c.y - 0.1) / 0.05) + 0.6 * bell(c.z, 0.225, 0.012)
    col = lerpc(col, BOOT_WORN, 0.6 * worn)
    return col, ((0.55, 0.0, 0.0, 0.0), (0.0, 1.0, 0.15 + 0.35 * smooth((0.06 - c.z) / 0.05), 0.0))


def pack_paint(c, n):
    t = 0.5 + 0.5 * noise.noise(c * 9)
    col = lerpc(LEATHER, LEATHER_DARK, 0.5 * t)
    return col, ((0.58, 0.0, 0.0, 0.0), (0.0, 1.0, 0.25 * smooth((1.1 - c.z) / 0.05), 0.0))


def hair_paint(c, n):
    return HAIR, CH_HAIR


# ------------------------------------------------------------------ build (or reuse)
def build_model():
    reset()
    bpy.context.scene.render.fps = FPS
    noise.seed_set(7)
    body = F.body_mass()
    BB = S.bvh_of(body)
    head = F.head_mass()
    HB = S.bvh_of(head)
    shirt = C.shell(body, "shirt_hi", C.shirt_zone, C.shirt_disp)
    trousers = C.shell(body, "trousers_hi", C.trouser_zone, C.trouser_disp)
    skin = C.shell(body, "skin_hi", C.skin_zone, lambda c, n: c, smooth=0)
    under = C.shell(body, "under_hi", C.under_zone, C.under_disp)
    SB = S.bvh_of(shirt)
    TB = S.bvh_of(trousers)

    # Pieces: (hi, low tris or None = same mesh, paint, weights, uv weight, flap)
    P = []

    def add(hi, tris, pnt, w, uvw=1.0, flap=False, sym=False, bake_solid=0.0):
        P.append(dict(hi=hi, tris=tris, paint=pnt, w=w, uvw=uvw, flap=flap, sym=sym, solid=bake_solid))

    add(head, 3400, head_paint, "headneck", uvw=2.2)
    for sx in (1, -1):
        add(F.eyeball(sx), None, eye_paint(sx), "head", uvw=2.5)
        add(F.hand_mass(sx), 1000, hand_paint, "hand", uvw=1.5)
    add(skin, 1300, skin_paint, "transfer", uvw=1.3, sym=True)
    add(shirt, 4300, shirt_paint, "shirt", flap=True, sym=True, bake_solid=0.0025)
    add(under, 700, under_paint, "shirt", flap=True, sym=True, bake_solid=0.0015)
    add(trousers, 2500, trouser_paint, "transfer", flap=False, sym=True, bake_solid=0.0025)
    add(C.collar(BB, SB), 600, shirt_paint, "transfer")
    band, buttons, revs = C.placket(SB)
    add(band, None, shirt_paint, "shirt")
    for b in buttons:
        add(b, None, flat(BUTTON, ch(0.35)), "shirt")
    for r in revs:
        add(r, None, shirt_paint, "transfer")
    for o in C.chest_pockets(SB):
        add(o, 160, shirt_paint, "shirt")
    for o in C.rolled_cuffs(BB):
        add(o, 240, shirt_paint, "shirt")
    for o in C.cargo_pocket(TB, 1):
        add(o, 160, trouser_paint, "transfer")
    for sx in (1, -1):
        up, sole, tongue, lace = C.boot_hi(sx)
        s = "L" if sx > 0 else "R"
        add(up, 1100, boot_paint, ("boot", s), uvw=1.2)
        add(sole, 300, flat(SOLE, ch(0.8, dirt=0.8)), ("boot", s))
        add(tongue, 160, boot_paint, ("boot", s))
        add(lace, 380, flat(LACE, ch(0.7, leather=0.5, dirt=0.3)), ("boot", s))
    for o in G.satchel(SB):
        nm = o.name
        metal = "buckle" in nm
        add(o, 700 if nm == "satchel" else (100 if metal else 160), flat(BRASS, CH_METAL) if metal else (flat(STRAP, CH_LEATHER) if "strap" in nm else pack_paint), "pack")
    for o in G.satchel_strap(SB):
        add(o, 420, flat(STRAP, CH_LEATHER), "shirt")
    band, knot, tails = G.neckerchief(BB)
    add(band, None, flat(SCARF, CH_CLOTH), "neck")
    add(knot, None, flat(hexcol("#7a2b1d"), CH_CLOTH), "neck")
    for t in tails:
        add(t, None, flat(SCARF, CH_CLOTH), "scarf")
    cap = G.scalp_cap(head)
    add(cap, 650, hair_paint, "head", uvw=1.5)
    cards = G.hair_cards(HB)
    brows = G.brow_cards(HB)
    proxy = S.duplicate(body, "proxy")
    S.decimate(proxy, 16000)
    bpy.data.objects.remove(body)

    # Paint the dense surfaces, then make the game meshes.
    his, los = [], []
    for p in P:
        hi = p["hi"]
        paint(hi, p["paint"])
        for poly in hi.data.polygons:
            poly.use_smooth = True
        lo = S.duplicate(hi, hi.name + "_lo")
        if p["tris"] is not None:
            S.decimate(lo, p["tris"])
        if p["flap"]:
            S.rim_flap(lo, 0.0045)
        if p["solid"]:
            S.solidify(hi, p["solid"], offset=-1.0)
        for name in [a.name for a in lo.data.color_attributes]:
            lo.data.color_attributes.remove(lo.data.color_attributes[name])
        lo["w"] = p["w"] if isinstance(p["w"], str) else "%s:%s" % p["w"]
        lo["uvw"] = p["uvw"]
        his.append(hi)
        los.append(lo)
        print(f"  {hi.name:18s} hi {S.tri_count(hi):7d}  lo {S.tri_count(lo):6d}", flush=True)
    print("hi tris:", sum(S.tri_count(o) for o in his), " lo tris:", sum(S.tri_count(o) for o in los),
          "+ hair", S.tri_count(cards) + S.tri_count(brows), flush=True)

    rig = build_rig()
    skin_proxy(rig, proxy)
    for lo in los:
        weigh(lo, lo["w"], proxy)
    for o in (cards, brows):
        weigh(o, "head", proxy)
    bpy.data.objects.remove(proxy)

    mesh = atlas_uvs(los)
    bake(his, mesh)
    hair_mat = hair_material()
    hair = S.join([cards, brows], "hair_cards")
    hair.data.materials.clear()
    hair.data.materials.append(hair_mat)
    mesh = S.join([mesh, hair], "runner_mesh")
    finish_skin(mesh, rig)
    strip_arm_weights(mesh)
    print("runner tris:", S.tri_count(mesh), flush=True)
    return rig, mesh


# ------------------------------------------------------------------ rig
HEM = (("hem.F", 0.0), ("hem.L", 90.0), ("hem.B", 180.0), ("hem.R", -90.0))
SECONDARY = ["pack", "scarf.0", "scarf.1", "scarf.2", "fingers.L", "fingers.R", "sleeve.L", "sleeve.R"] + [h for h, _ in HEM]


def build_rig():
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
    K = F.KNUCKLE
    bone("root", (0, 0, 0), (0, 0.3, 0))
    bone("hips", V["pelvis"], V["spine"], "root")
    bone("spine", V["spine"], V["chest"], "hips", True)
    bone("chest", V["chest"], V["neck"], "spine", True)
    bone("neck", V["neck"], V["head"], "chest", True)
    bone("head", V["head"], V["crown"], "neck", True)
    for s in "LR":
        sx = 1 if s == "L" else -1
        bone(f"shoulder.{s}", V["chest"] + Vector((0, 0, 0.12)), V[f"shoulder.{s}"], "chest")
        bone(f"upper_arm.{s}", V[f"shoulder.{s}"], V[f"elbow.{s}"], f"shoulder.{s}", True)
        bone(f"forearm.{s}", V[f"elbow.{s}"], V[f"wrist.{s}"], f"upper_arm.{s}", True)
        bone(f"hand.{s}", V[f"wrist.{s}"], Vector((sx * K.x, K.y, K.z)), f"forearm.{s}", True)
        bone(f"fingers.{s}", Vector((sx * K.x, K.y, K.z)), Vector((sx * K.x, K.y, 0.79)), f"hand.{s}", True)
        bone(f"thigh.{s}", V[f"hip.{s}"], V[f"knee.{s}"], "hips")
        bone(f"shin.{s}", V[f"knee.{s}"], V[f"ankle.{s}"], f"thigh.{s}", True)
        bone(f"foot.{s}", V[f"ankle.{s}"], V[f"toe.{s}"] + Vector((0, -0.05, 0.0)), f"shin.{s}", True)
        bone(f"toe.{s}", V[f"toe.{s}"] + Vector((0, -0.05, 0.0)), V[f"toe.{s}"] + Vector((0, 0.04, 0)), f"foot.{s}", True)
    # The satchel swings from its strap rings on the hips.
    sc = G.SATCHEL_C
    bone("pack", sc + Vector((0, 0.02, 0.09)), sc + Vector((0, 0.02, -0.08)), "hips")
    # Shirt-tail spring bones round the waist, hinged just under the ribs; sleeve bones at the shoulder.
    for name, deg in HEM:
        a = math.radians(deg)
        d = Vector((math.sin(a), math.cos(a), 0))
        bone(name, Vector((0, 0, 1.075)) + d * 0.12, Vector((0, 0, 0.9)) + d * 0.15, "hips")
    for s in "LR":
        p, _ = C.arm_at(s, C.SLEEVE_T)
        bone(f"sleeve.{s}", V[f"shoulder.{s}"], p, f"upper_arm.{s}")
    SP = G.SCARF_PTS
    bone("scarf.0", SP[0], SP[1], "neck")
    bone("scarf.1", SP[1], SP[2], "scarf.0", True)
    bone("scarf.2", SP[2], SP[3], "scarf.1", True)
    # Uniform roll so local X is the hinge axis for every limb (flexion = rotation about X).
    for b in eb:
        b.align_roll(Vector((0, 0, 1)) if abs(b.vector.normalized().z) < 0.7 else Vector((0, -1, 0)))
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def skin_proxy(rig, proxy):
    """Bone-heat weights on a closed proxy of the body (the clothes take theirs from it)."""
    ad = rig.data
    for n_ in SECONDARY:
        ad.bones[n_].use_deform = False
    bpy.ops.object.select_all(action="DESELECT")
    proxy.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    for n_ in SECONDARY:
        ad.bones[n_].use_deform = True
    proxy.parent = None
    for m in list(proxy.modifiers):
        proxy.modifiers.remove(m)


def set_weights(ob, fn):
    groups = {}
    for v in ob.data.vertices:
        for g, w in fn(v.co).items():
            if w <= 1e-4:
                continue
            if g not in groups:
                groups[g] = ob.vertex_groups.get(g) or ob.vertex_groups.new(name=g)
            groups[g].add([v.index], w, "REPLACE")


def hand_weights(co):
    s = "L" if co.x > 0 else "R"
    sx = 1 if s == "L" else -1
    K = F.KNUCKLE
    c = Vector((abs(co.x), co.y, co.z))
    # Thumb stays with the hand; fingers past the knuckle line go to the fingers bone.
    W = Vector((0.26, 0.0, 0.93))
    t0 = W + Vector((-0.006, 0.022, -0.022))
    t3 = t0 + Vector((-0.036, 0.042, -0.082))
    d = t3 - t0
    tt = max(0.0, min(1.0, (c - t0).dot(d) / d.length_squared))
    thumb = (c - (t0 + d * tt)).length < 0.017
    f = 0.0 if thumb else smooth((K.z + 0.006 - c.z) / 0.014)
    fore = smooth((c.z - 0.92) / 0.025)
    out = {f"fingers.{s}": f * (1 - fore), f"hand.{s}": (1 - f) * (1 - fore), f"forearm.{s}": fore}
    return out


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


def chain_weights(pts, bones):
    P = [Vector(p) for p in pts]
    seglen = [(P[i + 1] - P[i]).length for i in range(len(P) - 1)]
    total = sum(seglen)

    def w(co):
        best, bt, acc = 1e9, 0.0, 0.0
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


def cloth_weights(ob):
    """Blend the loose parts of the shirt onto its spring bones: the untucked tail onto hem.* (by the
    direction round the waist), the open end of each short sleeve onto sleeve.*."""
    for name in [h for h, _ in HEM] + ["sleeve.L", "sleeve.R"]:
        if name not in ob.vertex_groups:
            ob.vertex_groups.new(name=name)
    for v in ob.data.vertices:
        co = v.co
        arm, t, d, *_ = C.arm_info(co)
        add = {}
        if arm and (d < 0.05 or co.z > 1.1):
            # Only the loose linen sleeve itself (not the snug undershirt below it).
            w = 0.6 * smooth((t - 0.2) / 0.3) * (1 - smooth((t - C.SLEEVE_T) / 0.03))
            if w > 0:
                add[f"sleeve.{C.side(co)}"] = w
        else:
            w = smooth((1.08 - co.z) / 0.16)
            if w > 0:
                a = math.atan2(co.x, co.y)
                ks = [(h, max(0.0, math.cos(a - math.radians(deg))) ** 2) for h, deg in HEM]
                tot = sum(k for _, k in ks) or 1.0
                for h, k in ks:
                    if k > 1e-3:
                        add[h] = w * k / tot
        if not add:
            continue
        keep = 1.0 - sum(add.values())
        for ge in v.groups:
            ge.weight *= keep
        for h, w in add.items():
            ob.vertex_groups[h].add([v.index], w, "ADD")


ARM_CHAIN = ("upper_arm.", "forearm.", "hand.", "fingers.", "sleeve.")


def strip_arm_weights(mesh):
    """The torso and the shirt tail follow the spine, the hips and the cloth bones, never the arm that
    hangs beside them (bone heat on the fused body leaks forearm weight into the flanks, and a swinging
    arm would drag a sheet of shirt with it)."""
    names = {g.index: g.name for g in mesh.vertex_groups}
    hips = mesh.vertex_groups.get("hips") or mesh.vertex_groups.new(name="hips")
    fixed = 0
    moved = 0
    for v in mesh.data.vertices:
        co = v.co
        # Below the linen sleeve's hem the arm is the snug undershirt: it follows the arm bones.
        if 0.84 < co.z < 1.5 and abs(co.x) > 0.15:
            arm, t, d, *_ = C.arm_info(co)
            if arm and t > C.SLEEVE_T + 0.03:
                s_ = C.side(co)
                for ge in v.groups:
                    if names[ge.group] == f"sleeve.{s_}" and ge.weight > 0:
                        w = ge.weight
                        ge.weight = 0.0
                        k = smooth((t - 0.8) / 0.25)
                        mesh.vertex_groups[f"upper_arm.{s_}"].add([v.index], w * (1 - k), "ADD")
                        mesh.vertex_groups[f"forearm.{s_}"].add([v.index], w * k, "ADD")
                        moved += 1
        if abs(co.x) > 0.2 or not (0.84 < co.z < 1.24):
            continue
        arm, t, d, *_ = C.arm_info(co)
        if arm and (d < 0.05 or co.z > 1.1):
            continue
        bad = [ge for ge in v.groups if names[ge.group].startswith(ARM_CHAIN) and not (names[ge.group].startswith("upper_arm.") and co.z > 1.18)]
        if not bad:
            continue
        lost = sum(ge.weight for ge in bad)
        for ge in bad:
            ge.weight = 0.0
        rest = sum(ge.weight for ge in v.groups)
        if rest > 1e-4:
            for ge in v.groups:
                ge.weight *= (rest + lost) / rest
        else:
            hips.add([v.index], 1.0, "REPLACE")
        fixed += 1
    print("arm weights stripped from torso verts:", fixed, "undershirt verts off the sleeve bones:", moved, flush=True)


def weigh(ob, how, proxy):
    if how == "transfer":
        for g in proxy.vertex_groups:
            if g.name not in ob.vertex_groups:
                ob.vertex_groups.new(name=g.name)
        m = ob.modifiers.new("dt", "DATA_TRANSFER")
        m.object = proxy
        m.use_vert_data = True
        m.data_types_verts = {"VGROUP_WEIGHTS"}
        m.vert_mapping = "POLYINTERP_NEAREST"
        m.layers_vgroup_select_src = "ALL"
        m.layers_vgroup_select_dst = "NAME"
        S.apply_mods(ob)
    elif how == "shirt":
        weigh(ob, "transfer", proxy)
        cloth_weights(ob)
    elif how == "headneck":
        set_weights(ob, lambda co: {"head": smooth((co.z - 1.53) / 0.05), "neck": 1 - smooth((co.z - 1.53) / 0.05)})
    elif how == "hand":
        set_weights(ob, hand_weights)
    elif how.startswith("boot:"):
        set_weights(ob, boot_weights(how.split(":")[1]))
    elif how == "scarf":
        set_weights(ob, chain_weights(G.SCARF_PTS, ["scarf.0", "scarf.1", "scarf.2"]))
    else:
        set_weights(ob, lambda co: {how: 1.0})


def finish_skin(mesh, rig):
    with bpy.context.temp_override(object=mesh, active_object=mesh, selected_objects=[mesh], selected_editable_objects=[mesh]):
        bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.01)
        bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    # Any vertex left without weights follows the nearest body bone.
    unweighted = [v.index for v in mesh.data.vertices if not v.groups]
    if unweighted:
        print("unweighted verts:", len(unweighted), flush=True)
        g = mesh.vertex_groups.get("chest") or mesh.vertex_groups.new(name="chest")
        g.add(unweighted, 1.0, "REPLACE")
    mesh.parent = rig
    m = mesh.modifiers.new("arm", "ARMATURE")
    m.object = rig


# ------------------------------------------------------------------ UVs and bake
def atlas_uvs(los):
    """One atlas for everything but the hair: texel density raised on the face and hands."""
    for lo in los:
        me = lo.data
        at = me.attributes.new("orig", "FLOAT_VECTOR", "POINT")
        co = np.zeros(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", co)
        at.data.foreach_set("vector", co)
        k = float(lo["uvw"])
        if k != 1.0:
            me.vertices.foreach_set("co", co * k)
        if not me.uv_layers:
            me.uv_layers.new(name="UVMap")
    mesh = S.join(los, "runner_mesh")
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=0.002, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=0.0025, rotate=True, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    me = mesh.data
    co = np.zeros(len(me.vertices) * 3, np.float32)
    me.attributes["orig"].data.foreach_get("vector", co)
    me.vertices.foreach_set("co", co)
    me.attributes.remove(me.attributes["orig"])
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    return mesh


def hi_material():
    """The procedural look, read from the painted channels, baked down to the atlas."""
    mat = bpy.data.materials.new("runner_paint")
    nt = nodes_clear(mat)
    out = N(nt, "ShaderNodeOutputMaterial")
    bsdf = N(nt, "ShaderNodeBsdfPrincipled")
    L(nt, bsdf.outputs[0], out.inputs[0])

    def attr(name):
        a = N(nt, "ShaderNodeAttribute", _attribute_name=name)
        a.attribute_type = "GEOMETRY"
        return a
    vc = attr("Col")
    m1 = N(nt, "ShaderNodeSeparateColor")
    L(nt, attr("Mat").outputs["Color"], m1.inputs[0])
    m2 = N(nt, "ShaderNodeSeparateColor")
    L(nt, attr("Mat2").outputs["Color"], m2.inputs[0])
    rough_c, weave_c, hair_c, stub_c = m1.outputs[0], m1.outputs[1], m1.outputs[2], None
    m1a = attr("Mat").outputs["Alpha"]
    m2a = attr("Mat2").outputs["Alpha"]
    skin_c, leather_c, dirt_c = m2.outputs[0], m2.outputs[1], m2.outputs[2]
    tc = N(nt, "ShaderNodeTexCoord")
    obj = tc.outputs["Object"]

    # Linen/canvas weave: two crossed fine stripes, and slubs.
    wx = N(nt, "ShaderNodeTexWave", Scale=300.0, Distortion=0.8, Detail=1.0)
    wx.wave_type = "BANDS"
    wx.bands_direction = "X"
    wz = N(nt, "ShaderNodeTexWave", Scale=300.0, Distortion=0.8, Detail=1.0)
    wz.wave_type = "BANDS"
    wz.bands_direction = "Z"
    for w_ in (wx, wz):
        L(nt, obj, w_.inputs["Vector"])
    weave = math_node(nt, "MULTIPLY", wx.outputs[1], wz.outputs[1])
    col = mix(nt, weave_c, vc.outputs["Color"], mix(nt, 1.0, vc.outputs["Color"], ramp(nt, weave, [(0.0, (0.94, 0.94, 0.94)), (0.6, (1.03, 1.03, 1.03))]), "MULTIPLY"), "MIX")
    # Fabric: faded patches and discoloration.
    fade = N(nt, "ShaderNodeTexNoise", Scale=14.0, Detail=4.0, Distortion=0.6)
    L(nt, obj, fade.inputs["Vector"])
    col = mix(nt, weave_c, col, mix(nt, 1.0, col, ramp(nt, fade.outputs[0], [(0.35, (0.9, 0.9, 0.88)), (0.7, (1.06, 1.05, 1.03))]), "MULTIPLY"), "MIX")
    # Skin: blotchy warmth, freckle-ish flecks, pores.
    mot = N(nt, "ShaderNodeTexNoise", Scale=70.0, Detail=5.0)
    L(nt, obj, mot.inputs["Vector"])
    col = mix(nt, math_node(nt, "MULTIPLY", skin_c, 0.7), col, mix(nt, 1.0, col, ramp(nt, mot.outputs[0], [(0.35, (0.92, 0.95, 0.96)), (0.65, (1.05, 1.0, 0.98))]), "MULTIPLY"), "MIX")
    pores = N(nt, "ShaderNodeTexVoronoi", Scale=1400.0)
    L(nt, obj, pores.inputs["Vector"])
    # Hair streaks (scalp cap).
    hmap = N(nt, "ShaderNodeMapping")
    hmap.inputs["Scale"].default_value = (90.0, 90.0, 16.0)
    L(nt, obj, hmap.inputs["Vector"])
    hn = N(nt, "ShaderNodeTexNoise", Scale=2.0, Detail=5.0)
    L(nt, hmap.outputs[0], hn.inputs["Vector"])
    col = mix(nt, hair_c, col, mix(nt, 1.0, col, ramp(nt, hn.outputs[0], [(0.35, (0.75, 0.75, 0.75)), (0.65, (1.1, 1.05, 1.0))]), "MULTIPLY"), "MIX")
    # Stubble: fine dark speckle, denser toward the jaw.
    sn = N(nt, "ShaderNodeTexNoise", Scale=1100.0, Detail=1.0)
    L(nt, obj, sn.inputs["Vector"])
    stub_amt = math_node(nt, "MULTIPLY", m1a, maprange(nt, sn.outputs[0], 0.46, 0.62, 0.02, 0.4))
    col = mix(nt, stub_amt, col, hexcol("#2e2119"), "MIX")
    # Leather: grain, scuffed lighter streaks, darker creases.
    lmap = N(nt, "ShaderNodeMapping")
    lmap.inputs["Scale"].default_value = (30.0, 110.0, 30.0)
    L(nt, obj, lmap.inputs["Vector"])
    ln_ = N(nt, "ShaderNodeTexNoise", Scale=3.0, Detail=6.0)
    L(nt, lmap.outputs[0], ln_.inputs["Vector"])
    col = mix(nt, math_node(nt, "MULTIPLY", leather_c, maprange(nt, ln_.outputs[0], 0.6, 0.74, 0.0, 0.3)), col, hexcol("#8a6548"), "MIX")
    grain = N(nt, "ShaderNodeTexNoise", Scale=450.0, Detail=2.0, Distortion=2.0)
    L(nt, obj, grain.inputs["Vector"])
    # Dust and dried mud.
    dust = N(nt, "ShaderNodeTexNoise", Scale=7.0, Detail=6.0, Roughness=0.65)
    L(nt, obj, dust.inputs["Vector"])
    col = mix(nt, math_node(nt, "MULTIPLY", dirt_c, maprange(nt, dust.outputs[0], 0.42, 0.62, 0.0, 0.75)), col, hexcol("#8f7552"), "MIX")
    L(nt, col, bsdf.inputs["Base Color"])

    rvar = N(nt, "ShaderNodeTexNoise", Scale=20.0, Detail=3.0)
    L(nt, obj, rvar.inputs["Vector"])
    rough = math_node(nt, "ADD", rough_c, math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", rvar.outputs[0], 0.5), 0.14))
    rough = math_node(nt, "ADD", rough, math_node(nt, "MULTIPLY", dirt_c, 0.1))
    L(nt, rough, bsdf.inputs["Roughness"])
    L(nt, m2a, bsdf.inputs["Metallic"])
    # Masks for the bake: R = metal, G = skin.
    cm = N(nt, "ShaderNodeCombineColor")
    L(nt, m2a, cm.inputs[0])
    L(nt, skin_c, cm.inputs[1])
    L(nt, cm.outputs[0], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0

    b1 = N(nt, "ShaderNodeBump", Distance=0.0012)
    L(nt, math_node(nt, "MULTIPLY", weave_c, 0.1), b1.inputs["Strength"])
    L(nt, weave, b1.inputs["Height"])
    b2 = N(nt, "ShaderNodeBump", Distance=0.0006)
    L(nt, math_node(nt, "MULTIPLY", skin_c, 0.25), b2.inputs["Strength"])
    L(nt, pores.outputs["Distance"], b2.inputs["Height"])
    L(nt, b1.outputs[0], b2.inputs["Normal"])
    b3 = N(nt, "ShaderNodeBump", Distance=0.0008)
    L(nt, math_node(nt, "MULTIPLY", leather_c, 0.35), b3.inputs["Strength"])
    L(nt, grain.outputs[0], b3.inputs["Height"])
    L(nt, b2.outputs[0], b3.inputs["Normal"])
    b4 = N(nt, "ShaderNodeBump", Distance=0.002)
    L(nt, math_node(nt, "MULTIPLY", hair_c, 0.6), b4.inputs["Strength"])
    L(nt, hn.outputs[0], b4.inputs["Height"])
    L(nt, b3.outputs[0], b4.inputs["Normal"])
    L(nt, b4.outputs[0], bsdf.inputs["Normal"])
    return mat


def bake(his, mesh):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.render.bake.margin = 8
    mat = hi_material()
    for o in his:
        o.data.materials.clear()
        o.data.materials.append(mat)
    hi_all = S.join(his, "hi_all")
    his = [hi_all]
    lo_mat = bpy.data.materials.new("bake_target")
    lt = nodes_clear(lo_mat)
    tex = lt.nodes.new("ShaderNodeTexImage")
    lt.nodes.active = tex
    mesh.data.materials.clear()
    mesh.data.materials.append(lo_mat)
    size = TEX
    imgs = {}
    for key, cs in (("color", "sRGB"), ("normal", "Non-Color"), ("rough", "Non-Color"), ("ao", "Non-Color"), ("mask", "Non-Color")):
        im = bpy.data.images.new(f"runner_{key}", size, size, alpha=False, float_buffer=False)
        im.colorspace_settings.name = cs
        imgs[key] = im
    bpy.ops.object.select_all(action="DESELECT")
    for o in his:
        o.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    kw = dict(use_selected_to_active=True, cage_extrusion=0.012, max_ray_distance=0.03, margin=8, use_clear=True)
    for key, typ, samples, extra in (("color", "DIFFUSE", 1, dict(pass_filter={"COLOR"})), ("normal", "NORMAL", 1, {}),
                                     ("rough", "ROUGHNESS", 1, {}), ("mask", "EMIT", 1, {}), ("ao", "AO", 12 if TEX < 2048 else 32, {})):
        tex.image = imgs[key]
        sc.cycles.samples = samples
        print(f"  bake runner:{key} …", flush=True)
        bpy.ops.object.bake(type=typ, **kw, **extra)

    def arr(im):
        return np.array(im.pixels[:], dtype=np.float32).reshape(size, size, 4)
    col = arr(imgs["color"])
    ao = arr(imgs["ao"])[:, :, 0:1]
    rough = arr(imgs["rough"])[:, :, 0:1]
    mask = arr(imgs["mask"])
    metal = mask[:, :, 0:1]
    skin = mask[:, :, 1:2]
    # AO into albedo; on skin the shadow is warmer (light scattered through), elsewhere neutral.
    neutral = 0.42 + 0.58 * ao
    warm = np.concatenate([0.62 + 0.38 * ao ** 0.7, 0.5 + 0.5 * ao ** 1.0, 0.46 + 0.54 * ao ** 1.15], axis=2)
    col[:, :, 0:3] *= neutral * (1 - skin) + warm * skin
    imgs["color"].pixels[:] = col.ravel()
    orm = np.concatenate([ao, rough, metal, np.ones_like(ao)], axis=2)
    om = bpy.data.images.new("runner_orm", size, size, alpha=False)
    om.colorspace_settings.name = "Non-Color"
    om.pixels[:] = orm.ravel()
    om.scale(size // 2, size // 2)  # AO/roughness/metal are low-frequency: half resolution
    imgs["orm"] = om
    for k in ("color", "normal", "orm"):
        im = imgs[k]
        im.filepath_raw = os.path.join(CACHE, f"runner_{k}.png")
        im.file_format = "PNG"
        im.save()
    bpy.data.objects.remove(hi_all)
    from common import textured_material
    pbr = textured_material("runner", imgs["color"], imgs["normal"], imgs["orm"])
    mesh.data.materials.clear()
    mesh.data.materials.append(pbr)


def hair_material():
    im = G.hair_texture(os.path.join(CACHE, "runner_hair.png"))
    m = bpy.data.materials.new("M_hair")
    nt = nodes_clear(m)
    out = N(nt, "ShaderNodeOutputMaterial")
    bsdf = N(nt, "ShaderNodeBsdfPrincipled")
    L(nt, bsdf.outputs[0], out.inputs[0])
    t = N(nt, "ShaderNodeTexImage", _image=im)
    L(nt, t.outputs[0], bsdf.inputs["Base Color"])
    L(nt, t.outputs[1], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.5
    m.blend_method = "CLIP"
    m.alpha_threshold = 0.4
    m.use_backface_culling = False
    return m


# ------------------------------------------------------------------ main
if REUSE and os.path.exists(MODEL_BLEND):
    bpy.ops.wm.open_mainfile(filepath=MODEL_BLEND)
    rig = bpy.data.objects["runner"]
    mesh = bpy.data.objects["runner_mesh"]
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    for o in list(bpy.data.objects):
        if o not in (rig, mesh):
            bpy.data.objects.remove(o)
    strip_arm_weights(mesh)
    im = bpy.data.images.get("runner_orm")
    if im and im.size[0] > 1024:
        im.scale(im.size[0] // 2, im.size[1] // 2)
else:
    rig, mesh = build_model()
    if not PREVIEW or "--save" in sys.argv:
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=MODEL_BLEND, compress=True)

import runner_anim  # noqa: E402

bpy.context.scene.render.fps = FPS
runner_anim.build(rig)
if PREVIEW:
    runner_anim.previews(rig, PREVIEW)
    sys.exit(0)
export_glb(os.path.join(OUT, "runner.glb"), [rig, mesh], anim=True, quality=84)
os._exit(0)  # bpy can crash on interpreter teardown after an export
