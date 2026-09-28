"""The runner's anatomy, blocked in as masses (see char_sculpt.py). All coordinates in metres,
Z up, the character faces +Y; x > 0 is the character's left (".L")."""
import math

import bpy
import bmesh
from mathutils import Vector, Matrix, Quaternion, Euler, noise

from char_sculpt import Meta, union_remesh, voxel_remesh, solidify, smooth_mesh, displace
from common import link

J = {
    "root": (0, 0, 0),
    "pelvis": (0, 0.0, 0.99),
    "spine": (0, -0.005, 1.14),
    "chest": (0, 0.0, 1.31),
    "neck": (0, 0.01, 1.50),
    "head": (0, 0.025, 1.62),
    "crown": (0, 0.02, 1.78),
}
for _s, _x in (("L", 1), ("R", -1)):
    J.update({
        f"clav.{_s}": (_x * 0.05, 0.0, 1.45),
        f"shoulder.{_s}": (_x * 0.205, -0.01, 1.44),
        f"elbow.{_s}": (_x * 0.24, -0.03, 1.16),
        f"wrist.{_s}": (_x * 0.26, 0.0, 0.93),
        f"hand.{_s}": (_x * 0.268, 0.006, 0.84),
        f"hip.{_s}": (_x * 0.1, 0.0, 0.95),
        f"knee.{_s}": (_x * 0.105, 0.025, 0.53),
        f"ankle.{_s}": (_x * 0.11, -0.01, 0.1),
        f"toe.{_s}": (_x * 0.115, 0.15, 0.035),
    })
V = {k: Vector(v) for k, v in J.items()}
HC = Vector((0, 0.03, 1.655))  # head centre
EYE_R = 0.0118


def eye_centre(sx):
    return HC + Vector((sx * 0.0315, 0.06, 0.004))


def _along(a, b):
    return (Vector(b) - Vector(a)).to_track_quat("Z", "Y")


def body_mass(res=0.0065):
    """Torso, neck, arms and legs (hands, feet and head are built separately)."""
    m = Meta("mbody", res)
    # Torso: ribcage, a broad upper chest, the belly and pelvis.
    m.ell((0, -0.012, 1.29), (0.138, 0.1, 0.16))
    m.ell((0, -0.005, 1.375), (0.165, 0.1, 0.085))
    m.ell((0, 0.01, 1.14), (0.12, 0.09, 0.11))
    m.ell((0, -0.005, 0.99), (0.128, 0.096, 0.09))
    m.ell((0, 0.035, 1.08), (0.1, 0.06, 0.07))
    for sx in (1, -1):
        # Pectorals, lats (the V under the arms), shoulder blades, obliques.
        m.ell((sx * 0.068, 0.052, 1.352), (0.072, 0.036, 0.052), rot=(0.25, sx * 0.15, 0))
        m.ell((sx * 0.112, -0.03, 1.26), (0.05, 0.068, 0.13), rot=(0, sx * -0.22, 0))
        m.ell((sx * 0.08, -0.07, 1.36), (0.062, 0.03, 0.075), rot=(0, sx * 0.2, 0))
        m.ell((sx * 0.1, 0.005, 1.06), (0.05, 0.07, 0.075))
        # Trapezius slope from the neck to the shoulder; the clavicle line.
        m.cap((sx * 0.025, -0.025, 1.535), (sx * 0.16, -0.02, 1.462), 0.034)
        # Deltoid, capping the shoulder.
        sh = V[f"shoulder.{'L' if sx > 0 else 'R'}"]
        m.ell(sh + Vector((sx * 0.0, 0.0, -0.024)), (0.047, 0.058, 0.08), rot=(0, sx * 0.22, 0))
        # Glutes.
        m.ell((sx * 0.066, -0.056, 0.905), (0.066, 0.056, 0.082))
        # Neck: sternocleidomastoid from behind the ear to the sternum.
        m.cap((sx * 0.046, 0.005, 1.61), (sx * 0.012, 0.05, 1.47), 0.015)
    m.cap((0, 0.0, 1.43), (0, 0.022, 1.62), 0.054)
    m.ell((0, -0.045, 1.44), (0.09, 0.05, 0.07))
    for s, sx in (("L", 1), ("R", -1)):
        sh, el, wr = V[f"shoulder.{s}"], V[f"elbow.{s}"], V[f"wrist.{s}"]
        sh2 = sh + Vector((0, 0, -0.02))
        m.tube([sh2, el], [0.047, 0.039])
        q = _along(sh2, el)
        m.ell(sh2.lerp(el, 0.55) + Vector((0, 0.019, 0)), (0.036, 0.036, 0.08), rot=q)   # biceps
        m.ell(sh2.lerp(el, 0.42) + Vector((sx * 0.002, -0.021, 0)), (0.038, 0.038, 0.095), rot=q)  # triceps
        m.ball(el + Vector((0, -0.01, 0)), 0.034)
        qf = _along(el, wr)
        m.tube([el, el.lerp(wr, 0.45), wr], [0.038, 0.032, 0.025])
        m.ell(el.lerp(wr, 0.28) + Vector((sx * 0.006, 0.006, 0)), (0.044, 0.036, 0.085), rot=qf)  # forearm flexors/extensors
        m.ell(wr + Vector((0, 0.002, 0.004)), (0.027, 0.02, 0.02))
        hp, kn, an = V[f"hip.{s}"], V[f"knee.{s}"], V[f"ankle.{s}"]
        ql = _along(hp, kn)
        m.tube([hp + Vector((-sx * 0.01, 0, 0.0)), kn], [0.08, 0.052])
        m.ell(hp.lerp(kn, 0.45) + Vector((sx * 0.008, 0.028, 0)), (0.066, 0.06, 0.16), rot=ql)   # quads
        m.ell(hp.lerp(kn, 0.8) + Vector((-sx * 0.026, 0.018, 0)), (0.036, 0.036, 0.055), rot=ql)  # vastus medialis
        m.ell(hp.lerp(kn, 0.42) + Vector((0, -0.03, 0)), (0.06, 0.056, 0.15), rot=ql)          # hamstrings
        m.ball(kn, 0.05)
        m.ell(kn + Vector((0, 0.036, 0.005)), (0.026, 0.016, 0.03))
        qs = _along(kn, an)
        m.tube([kn, an], [0.046, 0.03])
        m.ell(kn.lerp(an, 0.3) + Vector((sx * 0.004, -0.028, 0)), (0.054, 0.054, 0.105), rot=qs)     # calf
        m.ell(kn.lerp(an, 0.36) + Vector((-sx * 0.014, -0.022, 0)), (0.036, 0.04, 0.08), rot=qs)
        m.tube([an, V[f"toe.{s}"]], [0.036, 0.03])
    return m.mesh("body_hi")


# ------------------------------------------------------------------ head
def _lid_shell(sx):
    """Upper and lower lids: a shell over the eyeball with an almond aperture, as a closed solid."""
    c = eye_centre(sx)
    bm = bmesh.new()
    NU, NV = 48, 36
    # Aperture in (azimuth, elevation) about the eye's forward axis, turned slightly outward.
    turn = Matrix.Rotation(sx * 0.2, 3, "Z")
    rows = []
    for j in range(NV + 1):
        el = -0.95 + 1.9 * j / NV
        row = []
        for i in range(NU + 1):
            az = -1.25 + 2.5 * i / NU
            d = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
            row.append((az, el, turn @ d))
        rows.append(row)
    verts = [[bm.verts.new(c + d * (EYE_R + 0.0012)) for (_, _, d) in row] for row in rows]
    faces = []
    for j in range(NV):
        for i in range(NU):
            az = -1.25 + 2.5 * (i + 0.5) / NU
            el = -0.95 + 1.9 * (j + 0.5) / NV
            a = az * sx  # + toward the outer corner
            w = 1.08
            u = max(0.0, 1 - (a / w) ** 2) if abs(a) < w else 0.0
            # Almond: the upper lid arches higher toward the inner third, the lower is flatter,
            # the outer corner sits a touch higher than the inner.
            up = 0.37 * u ** 0.6 * (1 + 0.1 * math.sin(-a * 1.4)) + 0.05 * a
            lo = -0.25 * u ** 0.7 + 0.05 * a
            inside = abs(a) < w and lo < el < up
            if not inside:
                faces.append(bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i])))
    for v in list(bm.verts):
        if not v.link_faces:
            bm.verts.remove(v)
    me = bpy.data.meshes.new("lid")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("lid", me)
    link(ob)
    solidify(ob, 0.0019, offset=1.0)
    return ob


def _ear(sx):
    """An ear from masses: helix rim, antihelix, concha bowl, tragus and lobe, then placed."""
    m = Meta("mear" + ("L" if sx > 0 else "R"), 0.0012)
    # Local frame: y back along the head, z up, x out from the head.
    rim = []
    for k in range(15):
        a = math.radians(-60 + k * 17)
        rim.append(Vector((0.004, -0.004 - 0.014 * math.sin(a) - 0.003, 0.004 + 0.024 * math.cos(a) * (1 if a < 1.6 else 0.9))))
    for p, q in zip(rim, rim[1:]):
        m.cap(p, q, 0.0034)
    m.ell((0.0, -0.01, 0.003), (0.004, 0.012, 0.022))                     # the flat of the ear
    m.cap((0.004, -0.013, 0.017), (0.005, -0.009, -0.005), 0.0028)         # antihelix
    m.cap((0.004, -0.013, 0.017), (0.004, -0.004, 0.022), 0.0022)
    m.ell((0.002, -0.003, -0.02), (0.004, 0.008, 0.009))                   # lobe
    m.ell((0.004, 0.004, -0.004), (0.0035, 0.004, 0.006))                  # tragus
    m.ell((0.006, -0.004, 0.0), (0.004, 0.0075, 0.009), neg=True)          # concha
    m.ell((-0.004, 0.0, 0.0), (0.006, 0.012, 0.02))                        # root into the head
    ob = m.mesh("ear")
    if sx < 0:
        ob.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
        ob.data.flip_normals()
    ob.data.transform(Matrix.Translation(HC + Vector((sx * 0.076, -0.006, -0.006))) @ Euler((0.0, sx * 0.1, -sx * 0.18)).to_matrix().to_4x4())
    return ob


HR = Vector((0.076, 0.098, 0.116))


def smooth01(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def g2(x, y, z, cx, cz, sx_, sz_, cy=None, sy_=None):
    """Anisotropic gaussian over the face (x, z), optionally y."""
    e = ((x - cx) / sx_) ** 2 + ((z - cz) / sz_) ** 2
    if cy is not None:
        e += ((y - cy) / sy_) ** 2
    return math.exp(-0.5 * e)


def face_offset(p):
    """Base ellipsoid point (head-local) → sculpted head surface point."""
    x, y, z = p
    d = Vector((x / HR.x, y / HR.y, z / HR.z))
    fy = max(0.0, d.y)
    q = Vector(p)
    ax = abs(x)
    # Planes: a flatter face, fuller occiput, squarer sides of the skull.
    if d.y > 0:
        q.y *= 1 - 0.07 * fy * fy
    if d.y < -0.2:
        q += d.normalized() * 0.007 * smooth01((-d.y - 0.2) / 0.5) * smooth01((z + 0.05) / 0.04)
    q.x *= 1 + 0.03 * (1 - abs(d.z)) * (1 - fy)
    # Jaw: taper to the chin at the front, pull in under the skull into the neck behind.
    if z < -0.012:
        t = smooth01((-z - 0.012) / 0.1)
        q.x *= 1 - 0.36 * t * smooth01((d.y + 0.2) / 0.9)
        if d.y < 0.35:
            back = smooth01((0.35 - d.y) / 0.9)
            q.y = q.y * (1 - 0.38 * t * back)
            q.x *= 1 - 0.2 * t * back
    # A strong jaw: width at the angle, a squared chin pushed forward.
    q.x += math.copysign(0.012, x) * g2(x, y, z, math.copysign(0.058, x), -0.066, 0.018, 0.02) * smooth01((d.y + 0.4) / 0.6)
    q.x += math.copysign(0.004, x) * g2(x, y, z, math.copysign(0.035, x), -0.095, 0.02, 0.015) * fy
    q.y += 0.02 * g2(x, y, z, 0, -0.098, 0.026, 0.018) * fy
    q.z -= 0.006 * g2(x, y, z, 0, -0.105, 0.03, 0.02) * fy
    if fy > 0.15:
        w = smooth01((fy - 0.15) / 0.55)
        # Forehead slope back above the brow.
        q.y -= 0.004 * smooth01((z - 0.045) / 0.06) * w
        # Brow ridge, heavier over the inner eye, and the glabella between.
        brow = math.exp(-((z - 0.029 + 0.08 * max(0.0, ax - 0.03) ** 1.0 * 0.3) / 0.0105) ** 2) * math.exp(-(ax / 0.052) ** 4)
        q.y += 0.015 * brow * w
        q.y += 0.004 * g2(x, y, z, 0, 0.022, 0.009, 0.01) * w
        # Temples.
        q.x -= math.copysign(0.004, x) * g2(x, y, z, math.copysign(0.064, x), 0.03, 0.012, 0.02) * w
        # Eye sockets (the eyeball and lids sit in these).
        for sx in (-1, 1):
            q.y -= 0.026 * g2(x, y, z, sx * 0.0315, 0.004, 0.0135, 0.0115) * w
            # Under-eye bag and the orbital rim below.
            q.y += 0.0025 * g2(x, y, z, sx * 0.03, -0.014, 0.012, 0.004) * w
        # Cheekbones and the hollow beneath.
        for sx in (-1, 1):
            q += Vector((sx * 0.5, 0.55, 0)) * 0.011 * g2(x, y, z, sx * 0.05, -0.012, 0.014, 0.011) * w
            q.y -= 0.005 * g2(x, y, z, sx * 0.047, -0.048, 0.012, 0.014) * w
        # Nose: bridge from the glabella, a strong straight dorsum, the tip, and the wings.
        if -0.06 < z < 0.035:
            u = (0.022 - z) / 0.056  # 0 at the bridge root, 1 at the tip
            if u < 1.0:
                prof = 0.006 + 0.015 * smooth01(u) ** 0.9
            else:
                prof = 0.021 * (1 - smooth01((u - 1.0) / 0.22))
            wid = 0.0075 + 0.005 * smooth01(u) + 0.003 * math.exp(-((u - 1.0) / 0.12) ** 2)
            q.y += max(0.0, prof) * math.exp(-(x / wid) ** 2) * w
        for sx in (-1, 1):
            q.y += 0.011 * g2(x, y, z, sx * 0.0125, -0.04, 0.0065, 0.0065) * w
            # Nostril openings.
            q.y -= 0.004 * g2(x, y, z, sx * 0.0068, -0.0455, 0.0028, 0.0022) * w
            q.z += 0.002 * g2(x, y, z, sx * 0.0068, -0.0455, 0.003, 0.0025) * w
            # Nasolabial fold: a crease from the nose wing to the mouth corner, fuller cheek outside it.
            ux = sx * 0.017 + (sx * 0.031 - sx * 0.017) * smooth01((-0.042 - z) / 0.03)
            fold = math.exp(-((x - ux) / 0.0035) ** 2) * math.exp(-((z + 0.058) / 0.016) ** 2)
            q.y -= 0.0022 * fold * w
            q.y += 0.003 * math.exp(-((x - ux - sx * 0.008) / 0.007) ** 2) * math.exp(-((z + 0.056) / 0.016) ** 2) * w
        # Muzzle over the teeth.
        q.y += 0.003 * g2(x, y, z, 0, -0.062, 0.024, 0.02) * w
        # Fuller cheeks between the cheekbone and the jaw.
        for sx in (-1, 1):
            q += Vector((sx * 0.4, 0.6, 0)) * 0.005 * g2(x, y, z, sx * 0.038, -0.035, 0.018, 0.02) * w
        # Lips: an upper lip with a bow, a fuller lower lip, the line between, corners tucked in.
        bow = 0.0012 * math.exp(-((ax - 0.006) / 0.004) ** 2)
        q.y += 0.0042 * math.exp(-(x / 0.023) ** 4) * math.exp(-((z + 0.0565 + bow) / 0.0048) ** 2) * w
        q.y += 0.0048 * math.exp(-(x / 0.021) ** 4) * math.exp(-((z + 0.0685) / 0.0055) ** 2) * w
        q.y -= 0.0035 * math.exp(-(x / 0.022) ** 6) * math.exp(-((z + 0.0625) / 0.0014) ** 2) * w
        for sx in (-1, 1):
            q.y -= 0.003 * g2(x, y, z, sx * 0.023, -0.0625, 0.003, 0.004) * w
            # Philtrum ridges.
            q.y += 0.0012 * g2(x, y, z, sx * 0.004, -0.051, 0.0015, 0.004) * w
        # Under the lower lip.
        q.y -= 0.0035 * g2(x, y, z, 0, -0.08, 0.014, 0.0045) * w
    # Under the skull, behind the jaw: gather into the neck column.
    if z < -0.02:
        t = smooth01((-z - 0.02) / 0.07) * smooth01((0.45 - d.y) / 0.5)
        col = Vector((0, -0.004, q.z))
        r = Vector((q.x, q.y - col.y, 0))
        if r.length > 0.052:
            r2 = r * (0.052 / r.length)
            q.x = q.x + (r2.x - r.x) * t
            q.y = q.y + (col.y + r2.y - q.y) * t
    # Back of the skull: the occipital shelf into the neck.
    q.y -= 0.004 * g2(x, y, z, 0, -0.06, 0.05, 0.02) * smooth01((-d.y - 0.3) / 0.4)
    return q


def _head_grid(nu, nv):
    bm = bmesh.new()
    rows = []
    for j in range(1, nv):
        th = math.pi * (1 - j / nv)
        row = []
        for i in range(nu):
            ph = 2 * math.pi * i / nu
            dd = Vector((math.sin(ph) * math.sin(th), math.cos(ph) * math.sin(th), math.cos(th)))
            p = Vector((dd.x * HR.x, dd.y * HR.y, dd.z * (0.104 if dd.z > 0 else HR.z)))
            row.append(bm.verts.new(HC + face_offset(p)))
        rows.append(row)
    top = bm.verts.new(HC + face_offset(Vector((0, 0, 0.104))))
    bot = bm.verts.new(HC + face_offset(Vector((0, 0, -HR.z))))
    for j in range(len(rows) - 1):
        for i in range(nu):
            bm.faces.new((rows[j][i], rows[j + 1][i], rows[j + 1][(i + 1) % nu], rows[j][(i + 1) % nu]))
    for i in range(nu):
        bm.faces.new((rows[-1][i], top, rows[-1][(i + 1) % nu]))
        bm.faces.new((rows[0][(i + 1) % nu], bot, rows[0][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("head_hi")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("head_hi", me)
    link(ob)
    return ob


def head_mass():
    face = _head_grid(400, 300)
    parts = [face, _lid_shell(1), _lid_shell(-1), _ear(1), _ear(-1)]
    ob = union_remesh(parts, "head_hi", 0.0012, smooth=0)
    smooth_mesh(ob, 0.4, 2)
    return ob


def eyeball(sx):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=11, radius=EYE_R)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    # Cornea bulge.
    for v in bm.verts:
        d = v.co.normalized()
        if d.y > 0.75:
            v.co += d * 0.0012 * ((d.y - 0.75) / 0.25) ** 1.5
    bmesh.ops.translate(bm, verts=bm.verts, vec=eye_centre(sx))
    me = bpy.data.meshes.new("eye")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("eye", me)
    link(ob)
    return ob


# ------------------------------------------------------------------ hands
KNUCKLE = Vector((0.266, 0.004, 0.848))
# Per finger: y offset at the knuckle, phalanx lengths, radius, relaxed flex at MCP/PIP/DIP.
FINGERS = [
    (0.027, (0.043, 0.026, 0.021), 0.0092, (0.4, 0.62, 0.4)),
    (0.008, (0.047, 0.029, 0.022), 0.0095, (0.45, 0.7, 0.42)),
    (-0.011, (0.044, 0.027, 0.021), 0.009, (0.5, 0.75, 0.45)),
    (-0.028, (0.035, 0.021, 0.019), 0.008, (0.58, 0.8, 0.48)),
]


def hand_mass(sx):
    """A strong, working hand (built as the left one, mirrored for the right), fingers relaxed."""
    m = Meta("mhand" + ("L" if sx > 0 else "R"), 0.0014, stiff=2.0)
    W = Vector((0.26, 0.0, 0.93))
    K = KNUCKLE
    # Wrist into the palm; the palm a slab, thicker at the heel.
    m.cap(W + Vector((0, 0.0, 0.03)), W + Vector((0.002, 0.002, -0.01)), 0.023, flat=(1.25, 1.0))
    m.ell(W.lerp(K, 0.52) + Vector((0.0, 0.004, 0.0)), (0.016, 0.041, 0.047), rot=(0, 0.06, 0))
    m.ell(W.lerp(K, 0.3) + Vector((-0.004, -0.018, 0.0)), (0.014, 0.017, 0.03))            # heel under the pinky
    m.ell(W.lerp(K, 0.35) + Vector((-0.008, 0.021, 0.0)), (0.015, 0.017, 0.028))           # thenar pad
    for (fy, lens, r, flex) in FINGERS:
        p = K + Vector((0.0, fy, 0.004))
        m.ball(p + Vector((0.003, 0, 0.004)), r * 0.85, s=5.0)                             # knuckle
        d = Vector((0.0, fy * 0.08, -1)).normalized()
        rr = r
        for ln, fl in zip(lens, flex):
            d = (Matrix.Rotation(fl, 3, "Y") @ d).normalized()
            q = p + d * ln
            m.cap(p, q, rr, s=8.0)
            m.ball(q, rr * 0.93, s=8.0)
            p = q
            rr *= 0.9
    # Thumb: from the heel of the palm, forward and across toward the index finger.
    t0 = W + Vector((-0.006, 0.022, -0.022))
    t1 = t0 + Vector((-0.006, 0.026, -0.03))
    t2 = t1 + Vector((-0.012, 0.012, -0.03))
    t3 = t2 + Vector((-0.012, 0.004, -0.022))
    m.cap(t0, t1, 0.0125, s=4.0)
    m.cap(t1, t2, 0.0105, s=6.0)
    m.cap(t2, t3, 0.0095, s=8.0)
    ob = m.mesh("hand_hi")
    if sx < 0:
        ob.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
        ob.data.flip_normals()
    return ob
