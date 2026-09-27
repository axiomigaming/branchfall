"""CAUSEWAY interface artwork: carved plaques, cast frames and set medallions.

    python3 blender/build_ui.py            # all pieces -> public/ui/*.webp
    python3 blender/build_ui.py --fast     # quarter samples, for look-dev
    python3 blender/build_ui.py jade sun   # only the named pieces

Every piece is modelled lying flat (Z up), rendered straight down with an
orthographic Cycles camera onto a transparent film, and saved as WebP.

The plaques and the panel frame are built for CSS `border-image` 9-slice use:
all ornament sits inside the corner squares (`SLICE` units from each edge) and
everything between the corners is a straight extrusion, so the edge and centre
slices stretch cleanly to any button width. Text is never baked in; the page
sets it live on top.
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import N, L, hexcol, mix, nodes_clear, ramp, maprange, math_node  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "public", "ui")
os.makedirs(OUT, exist_ok=True)
FAST = "--fast" in sys.argv
ONLY = [a for a in sys.argv[1:] if not a.startswith("-")]
PPU = 128  # pixels per Blender unit in every render
SLICE = 0.625  # corner square of the 9-slice, in units (80 px)


# ---------------------------------------------------------------- scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 12 if FAST else 64
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    sc.cycles.max_bounces = 6
    sc.cycles.glossy_bounces = 3
    sc.cycles.transparent_max_bounces = 4
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Punchy"
    sc.view_settings.exposure = 0.2
    sc.render.threads_mode = "FIXED"
    sc.render.threads = 2
    world(sc)
    return sc


def world(sc):
    """A warm dome: bright above the piece (top of the image), dark below.

    Flat metal reflects straight back at the camera (+Z), so the dome's zenith
    sets the tone of flat gold; bevels catch the bright upper half or the dark
    lower half, which is what makes the relief read."""
    w = bpy.data.worlds.new("ui")
    sc.world = w
    nt = nodes_clear(w)
    tc = N(nt, "ShaderNodeTexCoord")
    sep = N(nt, "ShaderNodeSeparateXYZ")
    L(nt, tc.outputs["Generated"], sep.inputs[0])
    y = maprange(nt, sep.outputs["Y"], -1.0, 1.0, 0.0, 1.0, smooth=False)
    col = ramp(nt, y, [(0.0, (0.004, 0.003, 0.002)), (0.42, (0.05, 0.035, 0.02)), (0.55, (0.3, 0.22, 0.13)), (0.8, (1.3, 1.0, 0.66)), (1.0, (1.6, 1.3, 0.9))])
    bg = N(nt, "ShaderNodeBackground", Strength=1.0)
    L(nt, col, bg.inputs["Color"])
    out = N(nt, "ShaderNodeOutputWorld")
    L(nt, bg.outputs[0], out.inputs[0])


def lights(w, h):
    """Key from the upper left, a cool low rim from the lower right."""
    def area(name, loc, size, energy, color):
        d = bpy.data.lights.new(name, "AREA")
        d.size = size
        d.energy = energy
        d.color = color
        o = bpy.data.objects.new(name, d)
        bpy.context.scene.collection.objects.link(o)
        o.location = loc
        direction = Vector((0, 0, 0)) - Vector(loc)
        o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        return o

    s = max(w, h)
    area("key", (-w * 0.35, h * 1.4, 3.2), s * 0.6, 260 * s / 6, (1.0, 0.9, 0.75))
    area("fill", (w * 0.4, -h * 1.2, 2.2), s * 0.8, 40 * s / 6, (0.7, 0.8, 1.0))


def camera(w, h, margin=0.0):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = max(w, h) + 2 * margin
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    cam.location = (0, 0, 10)
    sc.camera = cam
    sc.render.resolution_x = round((w + 2 * margin) * PPU)
    sc.render.resolution_y = round((h + 2 * margin) * PPU)
    sc.render.resolution_percentage = 100


def render(name):
    sc = bpy.context.scene
    tmp = os.path.join(OUT, f".{name}.png")
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    img.pixels[0]  # force the lazy load before retargeting
    img.filepath_raw = os.path.join(OUT, f"{name}.webp")
    img.file_format = "WEBP"
    sc.render.image_settings.quality = 88
    img.save()
    os.remove(tmp)
    print("wrote", img.filepath_raw)


# ---------------------------------------------------------------- materials
def mat_metal(name, base, rough=0.3, hammer=0.25, patina=None):
    m = bpy.data.materials.new(name)
    nt = nodes_clear(m)
    bsdf = N(nt, "ShaderNodeBsdfPrincipled", Metallic=1.0, Roughness=rough)
    tc = N(nt, "ShaderNodeTexCoord")
    nz = N(nt, "ShaderNodeTexNoise", Scale=9.0, Detail=6.0, Roughness=0.6)
    L(nt, tc.outputs["Object"], nz.inputs["Vector"])
    col = base
    if patina:
        # dark wear gathers in the recesses-ish noise lows
        f = maprange(nt, nz.outputs["Fac"], 0.3, 0.5, 0.45, 0.0)
        col = mix(nt, f, base, patina)
    if isinstance(col, tuple):
        bsdf.inputs["Base Color"].default_value = col
    else:
        L(nt, col, bsdf.inputs["Base Color"])
    r = maprange(nt, nz.outputs["Fac"], 0.3, 0.7, rough * 0.7, rough * 1.5)
    L(nt, r, bsdf.inputs["Roughness"])
    if hammer:
        bump = N(nt, "ShaderNodeBump", Strength=hammer, Distance=0.02)
        vz = N(nt, "ShaderNodeTexVoronoi", Scale=38.0)
        L(nt, tc.outputs["Object"], vz.inputs["Vector"])
        L(nt, vz.outputs["Distance"], bump.inputs["Height"])
        L(nt, bump.outputs[0], bsdf.inputs["Normal"])
    out = N(nt, "ShaderNodeOutputMaterial")
    L(nt, bsdf.outputs[0], out.inputs[0])
    return m


def mat_stone(name, dark, light, vein=None, coat=0.7, rough=0.32, glow=None, glow_strength=0.0):
    """Polished stone: dark ground, soft cloud, fine veins, lacquer coat."""
    m = bpy.data.materials.new(name)
    nt = nodes_clear(m)
    bsdf = N(nt, "ShaderNodeBsdfPrincipled", Roughness=rough)
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = 0.08
    tc = N(nt, "ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.55, 1.4, 1.0)  # pre-squash: the slices stretch it back
    L(nt, tc.outputs["Object"], mp.inputs["Vector"])
    cloud = N(nt, "ShaderNodeTexNoise", Scale=2.2, Detail=5.0, Roughness=0.55)
    L(nt, mp.outputs[0], cloud.inputs["Vector"])
    c = mix(nt, maprange(nt, cloud.outputs["Fac"], 0.25, 0.8, 0.15, 0.85), dark, light)
    if vein:
        vn = N(nt, "ShaderNodeTexNoise", Scale=3.4, Detail=8.0, Roughness=0.6, Distortion=2.2)
        L(nt, mp.outputs[0], vn.inputs["Vector"])
        v = math_node(nt, "ABSOLUTE", math_node(nt, "SUBTRACT", vn.outputs["Fac"], 0.5))
        vm = maprange(nt, v, 0.0, 0.012, 0.22, 0.0)
        c = mix(nt, vm, c, vein)
    L(nt, c, bsdf.inputs["Base Color"])
    if glow:
        bsdf.inputs["Emission Color"].default_value = glow
        bsdf.inputs["Emission Strength"].default_value = glow_strength
    out = N(nt, "ShaderNodeOutputMaterial")
    L(nt, bsdf.outputs[0], out.inputs[0])
    return m


def mats():
    return {
        "gold": mat_metal("gold", hexcol("#e9b85e"), rough=0.22, hammer=0.12, patina=hexcol("#9a6a28")),
        "bronze": mat_metal("bronze", hexcol("#9a6a36"), rough=0.36, hammer=0.3, patina=hexcol("#3d2a18")),
        "darkbronze": mat_metal("darkbronze", hexcol("#5c3f22"), rough=0.42, hammer=0.3, patina=hexcol("#2a1c10")),
        "jade": mat_stone("jade", hexcol("#082a21"), hexcol("#185a45"), vein=hexcol("#5fae8c"), coat=0.8),
        "ember": mat_stone("ember", hexcol("#3a0c05"), hexcol("#8a2a10"), vein=hexcol("#e0833f"), coat=0.8, glow=hexcol("#ff5a1a"), glow_strength=0.05),
        "amber": mat_stone("amber", hexcol("#5a1606"), hexcol("#d8641a"), vein=hexcol("#ffc070"), coat=0.9, rough=0.25, glow=hexcol("#ff6a1a"), glow_strength=0.22),
        "obsidian": mat_stone("obsidian", hexcol("#0b0907"), hexcol("#2a2119"), vein=hexcol("#6b5236"), coat=0.55, rough=0.4),
    }


def assign(ob, mat):
    ob.data.materials.append(mat)
    return ob


# ---------------------------------------------------------------- geometry
def crect(w, h, c):
    """Chamfered rectangle outline, counter-clockwise, centred."""
    x, y = w / 2, h / 2
    c = min(c, x * 0.9, y * 0.9)
    return [(-x + c, -y), (x - c, -y), (x, -y + c), (x, y - c), (x - c, y), (-x + c, y), (-x, y - c), (-x, -y + c)]


def inset_outline(pts, d):
    """Offset a convex CCW outline inward by d (miter)."""
    n = len(pts)
    res = []
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        e0 = (p1 - p0).normalized()
        e1 = (p2 - p1).normalized()
        n0 = Vector((-e0.y, e0.x))
        n1 = Vector((-e1.y, e1.x))
        bis = (n0 + n1).normalized()
        k = d / max(0.2, bis.dot(n0))
        q = p1 + bis * k
        res.append((q.x, q.y))
    return res


def mesh_obj(name, bm, mat, smooth=True):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in ob.data.polygons:
        p.use_smooth = smooth
    assign(ob, mat)
    return ob


def ring(name, outer, inner, z0, z1, mat, bevel=0.03, seg=3, profile=0.5):
    """A closed band between two outlines, extruded from z0 to z1, bevelled."""
    bm = bmesh.new()
    n = len(outer)
    vo = [bm.verts.new((x, y, z0)) for x, y in outer]
    vi = [bm.verts.new((x, y, z0)) for x, y in inner]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((vo[i], vo[j], vi[j], vi[i]))
    ext = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z = z1
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if bevel > 0:
        top = [e for e in bm.edges if all(v.co.z > z1 - 1e-4 for v in e.verts)]
        bmesh.ops.bevel(bm, geom=top, offset=bevel, segments=seg, profile=profile, affect="EDGES", clamp_overlap=True)
    return mesh_obj(name, bm, mat)


def slab(name, outline, z0, z1, mat, bevel=0.05, seg=4, profile=0.5):
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z0)) for x, y in outline]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z = z1
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if bevel > 0:
        top = [e for e in bm.edges if all(v.co.z > z1 - 1e-4 for v in e.verts)]
        bmesh.ops.bevel(bm, geom=top, offset=bevel, segments=seg, profile=profile, affect="EDGES", clamp_overlap=True)
    return mesh_obj(name, bm, mat)


def box(name, cx, cy, sx, sy, z0, z1, mat, bevel=0.012):
    x, y = sx / 2, sy / 2
    return slab(name, [(cx - x, cy - y), (cx + x, cy - y), (cx + x, cy + y), (cx - x, cy + y)], z0, z1, mat, bevel=bevel, seg=2)


def stud(name, x, y, r, z0, mat, h=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=r, location=(x, y, z0))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale.z = (h or r * 0.7) / r
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(mat)
    return ob


def corner_frets(w, h, inset, arm, t, z0, z1, mat, steps=True):
    """Stepped L-brackets in the four inner corners (Mesoamerican fret)."""
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx = sx * (w / 2 - inset)
            cy = sy * (h / 2 - inset)
            # the two arms of the L, running inward from the corner
            box("fa", cx - sx * arm / 2, cy, arm, t, z0, z1, mat)
            box("fb", cx, cy - sy * arm / 2, t, arm, z0, z1, mat)
            if steps:
                # a small step inside the L
                s = arm * 0.42
                box("fs1", cx - sx * (s / 2 + t * 1.6), cy - sy * t * 1.6, s, t * 0.8, z0, z1 * 0.92 + z0 * 0.08, mat)
                box("fs2", cx - sx * t * 1.6, cy - sy * (s / 2 + t * 1.6), t * 0.8, s, z0, z1 * 0.92 + z0 * 0.08, mat)


# ---------------------------------------------------------------- pieces
def plaque(name, face_mat, frame_mat, inlay_mat, w=6.0, h=2.0, chamfer=0.34, frame_w=0.2, relief=1.0):
    """A carved stone tablet in a cast frame with a gold-inlaid rim.

    Profile from the outside in: cast frame (bevelled, highest), a fine gold
    bead in its middle, a gold fillet at its inner edge, then the stone face,
    pillowed and set lower. Fret brackets and rivets live in the corners."""
    sc = reset()
    M = mats()
    fm, im, sm = M[frame_mat], M[inlay_mat], M[face_mat]
    outer = crect(w, h, chamfer)
    inner = inset_outline(outer, frame_w)
    zf = 0.18 * relief
    ring("frame", outer, inner, 0.0, zf, fm, bevel=0.07, seg=4, profile=0.62)
    mid_o = inset_outline(outer, frame_w * 0.40)
    mid_i = inset_outline(outer, frame_w * 0.58)
    ring("bead", mid_o, mid_i, zf - 0.03, zf + 0.018, im, bevel=0.012, seg=3, profile=0.7)
    fil_o = inset_outline(outer, frame_w - 0.005)
    fil_i = inset_outline(outer, frame_w + 0.045)
    ring("fillet", fil_o, fil_i, 0.0, zf * 0.62, im, bevel=0.018, seg=3)
    face = inset_outline(outer, frame_w + 0.03)
    slab("face", face, 0.0, zf * 0.42, sm, bevel=0.11, seg=6, profile=0.5)
    # corners: fret brackets on the face, a rivet on each chamfer
    corner_frets(w, h, frame_w + 0.16, 0.26, 0.045, zf * 0.42 - 0.01, zf * 0.42 + 0.03, im)
    cm = chamfer * 0.5
    for sx in (-1, 1):
        for sy in (-1, 1):
            # centre of the chamfer's band, on the frame
            px = sx * (w / 2 - cm - frame_w * 0.25 + 0.02)
            py = sy * (h / 2 - cm - frame_w * 0.25 + 0.02)
            stud("rivet", px, py, 0.06, zf, im, h=0.05)
    lights(w, h)
    camera(w, h)
    render(name)


def panel_frame(name, w=8.0, h=4.0, frame_w=0.09, chamfer=0.3):
    """The dock/sheet frame: a thin bronze band, gold corner frets; open centre."""
    reset()
    M = mats()
    outer = crect(w, h, chamfer)
    inner = inset_outline(outer, frame_w)
    ring("frame", outer, inner, 0.0, 0.08, M["bronze"], bevel=0.03, seg=3)
    corner_frets(w, h, 0.22, 0.34, 0.05, 0.0, 0.06, M["gold"])
    for sx in (-1, 1):
        for sy in (-1, 1):
            stud("rivet", sx * (w / 2 - chamfer * 0.5 - 0.02), sy * (h / 2 - chamfer * 0.5 - 0.02), 0.07, 0.08, M["gold"], h=0.05)
    lights(w, h)
    camera(w, h)
    render(name)


def arch_mark(scale, z0, z1, mat, oy=0.0):
    """The game's mark (an arch over a causeway), as a raised gold relief."""
    pts = []
    def P(x, y):
        # SVG space (32x32, y down, centred at 16,17) -> units
        pts.append(((x - 16) * scale, (17 - y) * scale + oy))
    P(6, 26)
    P(6, 14)
    for k in range(1, 16):
        a = math.pi - math.pi * k / 16
        P(16 + 10 * math.cos(a), 14 - 10 * math.sin(a))
    P(26, 14)
    P(26, 26)
    P(21.5, 26)
    P(21.5, 14)
    for k in range(1, 12):
        a = math.pi * k / 12
        P(16 + 5.5 * math.cos(a), 14 - 5.5 * math.sin(a))
    P(10.5, 14)
    P(10.5, 26)
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z0)) for x, y in pts]
    f = bm.faces.new(vs)
    if f.normal.z < 0:
        f.normal_flip()
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z = z1
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    top = [e for e in bm.edges if all(v.co.z > z1 - 1e-4 for v in e.verts)]
    bmesh.ops.bevel(bm, geom=top, offset=0.012, segments=2, affect="EDGES", clamp_overlap=True)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    ob = mesh_obj("mark", bm, mat, smooth=False)
    # a line under the arch: the causeway
    box("road", 0, (17 - 28.5) * scale + oy, 26 * scale, 1.4 * scale, z0, z1, mat, bevel=0.008)
    return ob


def medallion(name, stone, bezel="gold", rays=0, glyph="arch"):
    """A cabochon set in a cast bezel: the jewel on the face of a button."""
    reset()
    M = mats()
    R = 1.0
    # bezel: a torus-profiled ring
    bpy.ops.mesh.primitive_torus_add(major_radius=0.86 * R, minor_radius=0.13 * R, major_segments=96, minor_segments=18, location=(0, 0, 0.05))
    tor = bpy.context.active_object
    tor.scale.z = 0.8
    bpy.ops.object.shade_smooth()
    tor.data.materials.append(M[bezel])
    # beaded outer rim
    for k in range(36):
        a = 2 * math.pi * k / 36
        stud("bead", math.cos(a) * 0.985 * R, math.sin(a) * 0.985 * R, 0.035 * R, 0.0, M[bezel], h=0.03)
    if rays:
        for k in range(rays):
            a = 2 * math.pi * (k + 0.5) / rays
            bm = bmesh.new()
            r0, r1, hw = 0.93 * R, 1.0 * R, 0.07
            ca, sa = math.cos(a), math.sin(a)
            tx, ty = -sa, ca
            pts = [(ca * r0 + tx * hw, sa * r0 + ty * hw), (ca * r1, sa * r1), (ca * r0 - tx * hw, sa * r0 - ty * hw)]
            vs = [bm.verts.new((x, y, 0.0)) for x, y in pts]
            f = bm.faces.new(vs)
            if f.normal.z < 0:
                f.normal_flip()
            ext = bmesh.ops.extrude_face_region(bm, geom=[f])
            for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
                v.co.z = 0.06
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            mesh_obj("ray", bm, M[bezel], smooth=False)
    # the stone: a low dome
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=0.8 * R, location=(0, 0, -0.05))
    dome = bpy.context.active_object
    dome.scale.z = 0.36
    bpy.ops.object.shade_smooth()
    dome.data.materials.append(M[stone])
    if glyph == "arch":
        arch_mark(0.029 * R, 0.13, 0.26, M["gold"], oy=0.02)
    elif glyph == "sun":
        # a raised gold disc with a ring of dots: the sun coin
        bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.26 * R, depth=0.12, location=(0, 0, 0.2))
        c = bpy.context.active_object
        bev = c.modifiers.new("b", "BEVEL")
        bev.width = 0.04
        bev.segments = 4
        bpy.ops.object.shade_smooth()
        c.data.materials.append(M["gold"])
        for k in range(12):
            a = 2 * math.pi * k / 12
            stud("dot", math.cos(a) * 0.44 * R, math.sin(a) * 0.44 * R, 0.045 * R, 0.19, M["gold"], h=0.04)
    lights(2.2, 2.2)
    camera(2.1, 2.1)
    render(name)


PIECES = {
    # 9-slice plaques (768x256, slice 80 px)
    "plaque-jade": lambda: plaque("plaque-jade", "jade", "bronze", "gold"),
    "plaque-ember": lambda: plaque("plaque-ember", "ember", "gold", "gold", relief=1.1),
    "plaque-stone": lambda: plaque("plaque-stone", "obsidian", "darkbronze", "bronze", relief=0.8),
    # 9-slice frame, open centre (1024x512, slice 80 px)
    "frame-panel": lambda: panel_frame("frame-panel"),
    # medallions (269x269)
    "medal-jade": lambda: medallion("medal-jade", "jade", glyph="arch"),
    "medal-sun": lambda: medallion("medal-sun", "amber", rays=16, glyph="sun"),
}

if __name__ == "__main__":
    for key, fn in PIECES.items():
        if ONLY and not any(o in key for o in ONLY):
            continue
        fn()
