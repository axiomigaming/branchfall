"""Our kit on the supplied body (replacing its shoulder-holster harness): a compact leather satchel on
the back of the left hip, its cross-body strap over the right shoulder, and the rust neckerchief knotted
at the back of the neck. Built in the rest pose against the body's torso, textured from procedural
materials baked to one small atlas (M_kit)."""
import math
import os

import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

import char_sculpt as S
from char_sculpt import build, sweep, catmull, rect, ring, rounded_box, ellipsoid, xform, displace, apply_mods
from common import hexcol, nodes_clear, N, L, mix, ramp, maprange, math_node

LEATHER = hexcol("#6d4a2d")
LEATHER_DARK = hexcol("#4f331f")
STRAP = hexcol("#4a311e")
BRASS = hexcol("#a78648")
SCARF = hexcol("#7c3520")
SCARF_DARK = hexcol("#5e2414")


def bell(x, c, w):
    return math.exp(-((x - c) / w) ** 2)


def torso_bvh(mesh):
    """The body without its arms (so the strap never snaps onto a hanging hand)."""
    names = {g.index: g.name for g in mesh.vertex_groups}
    arm = set()
    for v in mesh.data.vertices:
        w = sum(ge.weight for ge in v.groups if names[ge.group].startswith(("upper_arm", "forearm", "hand", "fingers")))
        if w > 0.3:
            arm.add(v.index)
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index in arm], context="VERTS")
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


# ------------------------------------------------------------------ neckerchief
def neckerchief(body, J):
    """A rolled band round the collar, a knot at the nape and two short tails (scarf.0–2)."""
    nk, hd = J["neck"], J["head"]
    zc = nk.z + 0.004
    c = Vector((0, nk.y + 0.012, zc))
    pts = []
    n = 28
    for k in range(n):
        a = 2 * math.pi * k / n
        d = Vector((math.sin(a), math.cos(a), 0))
        z = zc - 0.03 * max(0.0, math.cos(a)) ** 1.5
        o = Vector((c.x, c.y, z))
        inner = body.ray_cast(o, d, 0.2)
        outer = body.ray_cast(o + d * 0.2, -d, 0.2)
        ri = (inner[0] - o).length if inner[0] is not None else 0.06
        ro = (outer[0] - o).length if outer[0] is not None else ri
        pts.append((a, z, min(ro, ri + 0.03)))
    rs = [p[2] for p in pts]
    for _ in range(4):
        rs = [(rs[i - 1] + 2 * rs[i] + rs[(i + 1) % n]) / 4 for i in range(n)]
    ring_pts = [Vector((c.x, c.y, z)) + Vector((math.sin(a), math.cos(a), 0)) * (r + 0.006) for (a, z, _), r in zip(pts, rs)]
    prof = [(0.0085 * math.cos(t), 0.016 * math.sin(t)) for t in (2 * math.pi * k / 12 for k in range(12))]
    band = build("scarf_band", sweep(ring_pts, prof, ups=[Vector((0, 0, 1))] * n, closed=True))
    back = ring_pts[n // 2]
    P0 = back + Vector((0, -0.006, -0.004))
    sp = [P0, P0 + Vector((0.006, -0.047, 0.0)), P0 + Vector((0.012, -0.097, -0.007)), P0 + Vector((0.018, -0.147, -0.023))]
    knot = build("scarf_knot", ellipsoid(P0 + Vector((0.0, -0.01, 0.0)), (0.024, 0.017, 0.021), seg=12, rings=8,
                                         shape=lambda q: q.__iadd__(Vector((0, 0, 0.003 * math.sin(q.x * 200))))))
    tails = []
    for k, (dx, ln, wid) in enumerate(((0.016, 1.0, 0.05), (-0.022, 0.8, 0.042))):
        P = [P0 + Vector((dx * 0.3, 0, 0))] + [P0 + (p - P0) * ln + Vector((dx * (i + 1) / 3, -0.004 * k, 0)) for i, p in enumerate(sp[1:])]
        cp = catmull(P, 4)
        nn = len(cp)
        tails.append(build("scarf_tail", sweep(cp, lambda i, nn=nn, wid=wid: [(-wid * (1 - 0.6 * (i / (nn - 1)) ** 1.4) / 2, 0.0), (0, 0.003), (wid * (1 - 0.6 * (i / (nn - 1)) ** 1.4) / 2, 0.0), (0, -0.003)],
                                              ups=[Vector((0, 0, 1))] * nn)))
    return band, knot, tails, sp


# ------------------------------------------------------------------ satchel and strap
def _surface_out(bvh, o, d, reach=0.4):
    hit = bvh.ray_cast(o + d * reach, -d, reach + 0.1)
    return hit[0] if hit[0] is not None else o + d * 0.15


def satchel(tb, J):
    """A compact leather satchel riding on the back of the left hip: a soft body, a flap with a strap
    and brass buckle, and two rings for the cross-body strap. Returns the parts, the pack bone and the
    strap ends (outer, inner)."""
    a = math.radians(138)
    d = Vector((math.sin(a), math.cos(a), 0))
    zc = J["hip.L"].z + 0.06
    base = _surface_out(tb, Vector((0, J["pelvis"].y, zc)), d) + d * 0.036
    rot = Matrix.Translation(base) @ Matrix.Rotation(-a, 4, "Z")
    W, D, H = 0.2, 0.058, 0.155

    def slump(c):
        k = (c.z + H / 2) / H
        c.y += 0.008 * math.cos(c.x / (W / 2) * math.pi / 2) * (1 - abs(2 * k - 1)) * (c.y > 0)
        c.x *= 1.0 + 0.04 * (1 - k)
    body = build("satchel", xform(rounded_box((W, D, H), (0, 0, 0), 0.018, 3, shape=slump), rot))
    mm = body.modifiers.new("sub", "SUBSURF")
    mm.levels = 1
    apply_mods(body)

    def crease(p, n):
        q = p - base
        return p + n * (0.0018 * math.sin(p.z * 110 + noise.noise(p * 14) * 3) * bell(q.z, -0.05, 0.03) + 0.0012 * noise.noise(p * 35))
    displace(body, crease)
    parts = [body]
    parts.append(build("satchel_flap", xform(rounded_box((W + 0.008, D + 0.01, 0.018), (0, 0.0, H / 2 + 0.004), 0.008, 2), rot)))
    parts.append(build("satchel_flap", xform(rounded_box((W + 0.008, 0.008, 0.1), (0, D / 2 + 0.007, H / 2 - 0.05), 0.006, 2,
                                                         shape=lambda c: c.__setattr__("z", c.z - 0.012 * (1 - (c.x / (W / 2)) ** 2) * (c.z < 0))), rot)))
    parts.append(build("satchel_strap", xform(rounded_box((0.022, 0.004, 0.09), (0, D / 2 + 0.013, 0.0), 0.0015, 1), rot)))
    parts.append(build("satchel_buckle", xform(ring((0, 0, 0), 0.012, 0.0022, axis="Y", seg=4, mseg=5),
                                               rot @ Matrix.Translation((0, D / 2 + 0.016, -0.03)) @ Matrix.Rotation(math.pi / 4, 4, "Y"))))
    ends = []
    for sx in (-1, 1):
        lp = Vector((sx * (W / 2 + 0.004), 0.0, H / 2 - 0.01))
        parts.append(build("satchel_buckle", xform(ring(lp, 0.011, 0.0022, axis="X", seg=10, mseg=5), rot)))
        ends.append(rot @ (lp + Vector((0, 0, 0.012))))
    pack = (base + Vector((0, 0.02, 0.09)), base + Vector((0, 0.02, -0.08)))
    return parts, pack, ends


def strap(tb, ends, J):
    """From the satchel up across the back, over the right shoulder, down across the chest and round the
    left flank back to the bag. Way points are fractions of the measured torso, snapped to its surface."""
    inner, outer = ends[1], ends[0]
    sh = J["shoulder.R"]
    hz, cz = J["hip.L"].z, sh.z
    def lvl(t):
        return hz + (cz - hz) * t
    way = [(0.04, -0.17, lvl(0.36)), (-0.03, -0.16, lvl(0.53)), (-0.09, -0.13, lvl(0.75)), (sh.x * 0.6, -0.07, lvl(0.98)),
           (sh.x * 0.56, 0.0, lvl(1.08)), (sh.x * 0.5, 0.07, lvl(0.98)), (-0.06, 0.15, lvl(0.8)), (0.01, 0.17, lvl(0.6)),
           (0.08, 0.15, lvl(0.36)), (0.15, 0.09, lvl(0.15)), (0.185, 0.0, lvl(0.06))]
    pts = [inner + Vector((0, 0, 0.01))]
    for w in way:
        loc, nrm, _, _ = tb.find_nearest(Vector(w))
        pts.append(loc + nrm * 0.008)
    pts.append(outer + Vector((0, 0, 0.01)))
    cp = catmull(pts, 3)
    out, ups = [], []
    for i, p in enumerate(cp):
        loc, nrm, _, _ = tb.find_nearest(p)
        if 1 < i < len(cp) - 2:
            p = loc + nrm * 0.009
        out.append(p)
        ups.append(nrm)
    return build("xstrap", sweep(out, rect(0.038, 0.0055, 0.002), ups=ups))


# ------------------------------------------------------------------ material and bake
def _proc_material(name, base, dark, kind):
    """A procedural look per kit piece: Principled for the bake, Emission = (1, roughness, metal) for the ORM."""
    m = bpy.data.materials.new(name)
    nt = nodes_clear(m)
    out = N(nt, "ShaderNodeOutputMaterial")
    bsdf = N(nt, "ShaderNodeBsdfPrincipled")
    L(nt, bsdf.outputs[0], out.inputs[0])
    tc = N(nt, "ShaderNodeTexCoord")
    obj = tc.outputs["Object"]
    rough, metal = {"leather": (0.62, 0.0), "brass": (0.38, 1.0), "scarf": (0.88, 0.0)}[kind]
    if kind == "leather":
        mp = N(nt, "ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (30.0, 110.0, 30.0)
        L(nt, obj, mp.inputs["Vector"])
        n1 = N(nt, "ShaderNodeTexNoise", Scale=3.0, Detail=6.0)
        L(nt, mp.outputs[0], n1.inputs["Vector"])
        col = mix(nt, maprange(nt, n1.outputs[0], 0.35, 0.65, 0.0, 1.0), base, dark)
        n2 = N(nt, "ShaderNodeTexNoise", Scale=9.0, Detail=4.0)
        L(nt, obj, n2.inputs["Vector"])
        col = mix(nt, maprange(nt, n2.outputs[0], 0.6, 0.75, 0.0, 0.35), col, hexcol("#8a6548"))
        grain = N(nt, "ShaderNodeTexNoise", Scale=420.0, Detail=2.0, Distortion=2.0)
        L(nt, obj, grain.inputs["Vector"])
        bump = N(nt, "ShaderNodeBump", Strength=0.35, Distance=0.0008)
        L(nt, grain.outputs[0], bump.inputs["Height"])
        L(nt, bump.outputs[0], bsdf.inputs["Normal"])
    elif kind == "scarf":
        wx = N(nt, "ShaderNodeTexWave", Scale=260.0, Distortion=0.6, Detail=1.0)
        wx.bands_direction = "X"
        wz = N(nt, "ShaderNodeTexWave", Scale=260.0, Distortion=0.6, Detail=1.0)
        wz.bands_direction = "Z"
        for w_ in (wx, wz):
            L(nt, obj, w_.inputs["Vector"])
        weave = math_node(nt, "MULTIPLY", wx.outputs[1], wz.outputs[1])
        n1 = N(nt, "ShaderNodeTexNoise", Scale=25.0, Detail=4.0)
        L(nt, obj, n1.inputs["Vector"])
        col = mix(nt, maprange(nt, n1.outputs[0], 0.35, 0.7, 0.0, 0.8), base, dark)
        bump = N(nt, "ShaderNodeBump", Strength=0.12, Distance=0.001)
        L(nt, weave, bump.inputs["Height"])
        L(nt, bump.outputs[0], bsdf.inputs["Normal"])
    else:
        n1 = N(nt, "ShaderNodeTexNoise", Scale=60.0, Detail=3.0)
        L(nt, obj, n1.inputs["Vector"])
        col = mix(nt, maprange(nt, n1.outputs[0], 0.4, 0.7, 0.0, 0.5), base, dark)
    L(nt, col, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Emission Color"].default_value = (1.0, rough, metal, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 1.0
    return m


def bake_kit(kit, out_dir, size=512):
    """One atlas for the kit: colour, tangent-space normal and ORM, then a single textured M_kit."""
    me = kit.data
    bpy.ops.object.select_all(action="DESELECT")
    kit.select_set(True)
    bpy.context.view_layer.objects.active = kit
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=0.006, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    imgs = {}
    for key, cs in (("color", "sRGB"), ("normal", "Non-Color"), ("orm", "Non-Color")):
        im = bpy.data.images.new(f"kit_{key}", size, size, alpha=False)
        im.colorspace_settings.name = cs
        imgs[key] = im
    for m in me.materials:
        nt = m.node_tree
        t = nt.nodes.new("ShaderNodeTexImage")
        nt.nodes.active = t
    for key, typ, extra in (("color", "DIFFUSE", dict(pass_filter={"COLOR"})), ("normal", "NORMAL", {}), ("orm", "EMIT", {})):
        for m in me.materials:
            nt = m.node_tree
            nt.nodes.active.image = imgs[key]
        sc.cycles.samples = 1
        bpy.ops.object.bake(type=typ, margin=4, use_clear=True, **extra)
    paths = {}
    for k, im in imgs.items():
        p = os.path.join(out_dir, f"kit_{k}.png")
        im.filepath_raw = p
        im.file_format = "PNG"
        im.save()
        paths[k] = p
    from common import textured_material
    mat = textured_material("kit", imgs["color"], imgs["normal"], imgs["orm"])
    mat.use_backface_culling = False
    for m in list(me.materials):
        bpy.data.materials.remove(m)
    me.materials.clear()
    me.materials.append(mat)
    return paths


def build_kit(mesh, J):
    """All of the kit as one mesh (with weights) plus the spring-bone placements."""
    tb = torso_bvh(mesh)
    band, knot, tails, scarf_pts = neckerchief(tb, J)
    parts, pack, ends = satchel(tb, J)
    xs = strap(tb, ends, J)
    m_leather = _proc_material("kit_leather", LEATHER, LEATHER_DARK, "leather")
    m_strap = _proc_material("kit_strap", STRAP, LEATHER_DARK, "leather")
    m_brass = _proc_material("kit_brass", BRASS, hexcol("#6e5a34"), "brass")
    m_scarf = _proc_material("kit_scarf", SCARF, SCARF_DARK, "scarf")
    groups = []
    for o in parts:
        mat = m_brass if "buckle" in o.name else (m_strap if "strap" in o.name else m_leather)
        groups.append((o, mat, {"pack": 1.0}))
    groups.append((xs, m_strap, "transfer"))
    groups.append((band, m_scarf, "transfer"))
    groups.append((knot, m_scarf, {"neck": 1.0}))
    for t in tails:
        groups.append((t, m_scarf, "scarf"))
    objs = []
    for o, mat, w in groups:
        o.data.materials.clear()
        o.data.materials.append(mat)
        objs.append(o)
        if w == "transfer":
            _transfer(o, mesh)
        elif w == "scarf":
            _chain(o, scarf_pts)
        else:
            for g, x in w.items():
                vg = o.vertex_groups.new(name=g)
                vg.add(list(range(len(o.data.vertices))), x, "REPLACE")
    # The strap's last hand-span at each end rides with the satchel.
    _strap_ends(xs, ends)
    kit = S.join(objs, "runner_kit")
    for p in kit.data.polygons:
        p.use_smooth = True
    return kit, pack, scarf_pts


def _transfer(o, mesh):
    for g in mesh.vertex_groups:
        if g.name not in o.vertex_groups:
            o.vertex_groups.new(name=g.name)
    m = o.modifiers.new("dt", "DATA_TRANSFER")
    m.object = mesh
    m.use_vert_data = True
    m.data_types_verts = {"VGROUP_WEIGHTS"}
    m.vert_mapping = "POLYINTERP_NEAREST"
    m.layers_vgroup_select_src = "ALL"
    m.layers_vgroup_select_dst = "NAME"
    apply_mods(o)
    # Never the arms (the strap rides the torso; the band the neck).
    names = {g.index: g.name for g in o.vertex_groups}
    for v in o.data.vertices:
        bad = [ge for ge in v.groups if names[ge.group].startswith(("upper_arm", "forearm", "hand", "fingers"))]
        lost = sum(ge.weight for ge in bad)
        for ge in bad:
            ge.weight = 0.0
        if lost > 0.999:
            g = o.vertex_groups.get("chest") or o.vertex_groups.new(name="chest")
            g.add([v.index], 1.0, "REPLACE")


def _strap_ends(xs, ends):
    pk = xs.vertex_groups.get("pack") or xs.vertex_groups.new(name="pack")
    for v in xs.data.vertices:
        d = min((v.co - e).length for e in ends)
        k = max(0.0, min(1.0, (0.12 - d) / 0.08))
        if k <= 0:
            continue
        for ge in v.groups:
            if ge.group != pk.index:
                ge.weight *= 1 - k
        pk.add([v.index], k, "ADD")


def _chain(o, pts):
    bones = ["scarf.0", "scarf.1", "scarf.2"]
    vgs = [o.vertex_groups.new(name=b) for b in bones]
    P = [Vector(p) for p in pts]
    seg = [(P[i + 1] - P[i]).length for i in range(3)]
    tot = sum(seg)
    for v in o.data.vertices:
        best, bt, acc = 1e9, 0.0, 0.0
        for i in range(3):
            d = P[i + 1] - P[i]
            t = max(0.0, min(1.0, (v.co - P[i]).dot(d) / d.length_squared))
            dist = (v.co - (P[i] + d * t)).length
            if dist < best:
                best, bt = dist, (acc + t * seg[i]) / tot
            acc += seg[i]
        x = bt * 3 - 0.5
        i0 = max(0, min(2, math.floor(x)))
        i1 = min(2, i0 + 1)
        fr = max(0.0, min(1.0, x - i0))
        vgs[i0].add([v.index], 1 - fr, "REPLACE")
        if i1 != i0:
            vgs[i1].add([v.index], fr, "ADD")
