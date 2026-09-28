"""CAUSEWAY interface artwork: sunlit plates for the primary actions, and the sheets' frame.

    python3 blender/build_ui.py                       # shipped pieces -> public/ui/*.webp
    python3 blender/build_ui.py --fast                # quarter samples, for look-dev
    python3 blender/build_ui.py plate-sun plate-gold  # only the named pieces
    python3 blender/build_ui.py concept-b-run         # concept-board pieces (never shipped)

Every piece is modelled lying flat (Z up), rendered straight down with an
orthographic Cycles camera onto a transparent film, and saved as WebP.

plate-sun (RUN / ENTER: sandstone in gold leaf) and plate-gold (CASH OUT: gold
leaf) are 3-slice strips for CSS `border-image`: [pointed cap | one repeating
centre tile | pointed cap]. Geometry between the caps repeats every TILE/8 and
the textures every TILE, so the centre tiles seamlessly at any width. The panel
frame is a 9-slice. Text is never baked in; the page sets it live on top.
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


# ---------------------------------------------------------------- round 3: sunlit plates
TILE = 1.0  # the repeating centre of a 3-slice plate, in units (128 px)


def periodic(nt, period=TILE, sy=1.0):
    """Object coordinates wrapped so X repeats every `period`: textures tile seamlessly
    across the plate's centre slice however many times CSS repeats it."""
    tc = N(nt, "ShaderNodeTexCoord")
    sep = N(nt, "ShaderNodeSeparateXYZ")
    L(nt, tc.outputs["Object"], sep.inputs[0])
    th = math_node(nt, "MULTIPLY", sep.outputs["X"], 2 * math.pi / period)
    r = period / (2 * math.pi)
    cx = math_node(nt, "MULTIPLY", math_node(nt, "SINE", th), r)
    cy = math_node(nt, "MULTIPLY", math_node(nt, "COSINE", th), r)
    comb = N(nt, "ShaderNodeCombineXYZ")
    L(nt, cx, comb.inputs["X"])
    L(nt, cy, comb.inputs["Z"])
    L(nt, math_node(nt, "MULTIPLY", sep.outputs["Y"], sy), comb.inputs["Y"])
    return comb.outputs[0]


def mat_sandstone(name, light="#fbeed3", dark="#e9cc98", grain=0.3, rough=0.7):
    """Sun-warmed sandstone: pale cream ground, soft clouding, faint bedding, fine grain."""
    m = bpy.data.materials.new(name)
    nt = nodes_clear(m)
    bsdf = N(nt, "ShaderNodeBsdfPrincipled", Roughness=rough)
    v = periodic(nt)
    cloud = N(nt, "ShaderNodeTexNoise", Scale=2.2, Detail=4.0, Roughness=0.5)
    L(nt, v, cloud.inputs["Vector"])
    c = mix(nt, maprange(nt, cloud.outputs["Fac"], 0.25, 0.75, 0.15, 0.85), hexcol(light), hexcol(dark))
    fine = N(nt, "ShaderNodeTexNoise", Scale=70.0, Detail=2.0, Roughness=0.7)
    L(nt, v, fine.inputs["Vector"])
    c = mix(nt, maprange(nt, fine.outputs["Fac"], 0.55, 0.8, 0.0, 0.18), c, hexcol("#b98d58"))
    L(nt, c, bsdf.inputs["Base Color"])
    bump = N(nt, "ShaderNodeBump", Strength=grain, Distance=0.01)
    L(nt, fine.outputs["Fac"], bump.inputs["Height"])
    L(nt, bump.outputs[0], bsdf.inputs["Normal"])
    out = N(nt, "ShaderNodeOutputMaterial")
    L(nt, bsdf.outputs[0], out.inputs[0])
    return m


def mat_leaf(name, base="#f1c56c", low="#c98f3a", rough=0.26, crinkle=0.06, glow=None, glow_strength=0.0):
    """Gold leaf: bright metal with soft tonal patches and a faint crinkle where the leaf laps."""
    m = bpy.data.materials.new(name)
    nt = nodes_clear(m)
    bsdf = N(nt, "ShaderNodeBsdfPrincipled", Metallic=1.0, Roughness=rough)
    v = periodic(nt)
    nz = N(nt, "ShaderNodeTexNoise", Scale=4.0, Detail=4.0, Roughness=0.55)
    L(nt, v, nz.inputs["Vector"])
    c = mix(nt, maprange(nt, nz.outputs["Fac"], 0.3, 0.7, 0.0, 0.3), hexcol(base), hexcol(low))
    L(nt, c, bsdf.inputs["Base Color"])
    L(nt, maprange(nt, nz.outputs["Fac"], 0.3, 0.7, rough * 0.7, rough * 1.4), bsdf.inputs["Roughness"])
    if crinkle:
        vz = N(nt, "ShaderNodeTexVoronoi", Scale=9.0)
        vz.feature = "DISTANCE_TO_EDGE"
        L(nt, v, vz.inputs["Vector"])
        bump = N(nt, "ShaderNodeBump", Strength=crinkle, Distance=0.01)
        L(nt, vz.outputs["Distance"], bump.inputs["Height"])
        L(nt, bump.outputs[0], bsdf.inputs["Normal"])
    if glow:
        bsdf.inputs["Emission Color"].default_value = hexcol(glow)
        bsdf.inputs["Emission Strength"].default_value = glow_strength
    out = N(nt, "ShaderNodeOutputMaterial")
    L(nt, bsdf.outputs[0], out.inputs[0])
    return m


def mat_gem(name, col, glow_strength=0.4):
    m = bpy.data.materials.new(name)
    nt = nodes_clear(m)
    bsdf = N(nt, "ShaderNodeBsdfPrincipled", Roughness=0.08)
    bsdf.inputs["Base Color"].default_value = hexcol(col)
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Emission Color"].default_value = hexcol(col)
    bsdf.inputs["Emission Strength"].default_value = glow_strength
    out = N(nt, "ShaderNodeOutputMaterial")
    L(nt, bsdf.outputs[0], out.inputs[0])
    return m


def sun_lights(w, h, key=110):
    # A sun lamp, not an area light: parallel rays light every point of the plate the
    # same way, so the centre slice tiles without a seam.
    d = bpy.data.lights.new("sun", "SUN")
    d.energy = key / 40
    d.angle = math.radians(8)
    d.color = (1.0, 0.9, 0.74)
    o = bpy.data.objects.new("sun", d)
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = (Vector((0.25, -0.9, -1.4))).to_track_quat("-Z", "Y").to_euler()
    # Daylight dome. Flat metal mirrors the zenith straight back at the camera, so the
    # zenith is bright warm sky (gold leaf reads bright, not bronze); bevels turned to
    # the top of the image catch more sun, bevels turned down fall into shade.
    sc = bpy.context.scene
    nt = nodes_clear(sc.world)
    tc = N(nt, "ShaderNodeTexCoord")
    sep = N(nt, "ShaderNodeSeparateXYZ")
    L(nt, tc.outputs["Generated"], sep.inputs[0])
    y = maprange(nt, sep.outputs["Y"], -1.0, 1.0, 0.0, 1.0, smooth=False)
    col = ramp(nt, y, [(0.0, (0.02, 0.012, 0.006)), (0.3, (0.16, 0.1, 0.05)), (0.5, (0.8, 0.64, 0.44)), (0.75, (1.3, 1.08, 0.76)), (1.0, (1.6, 1.35, 1.0))])
    bg = N(nt, "ShaderNodeBackground", Strength=1.0)
    L(nt, col, bg.inputs["Color"])
    out = N(nt, "ShaderNodeOutputWorld")
    L(nt, bg.outputs[0], out.inputs[0])
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = -0.15


def hexagon(w, h, p):
    """Long hexagon with pointed ends of depth p (CCW)."""
    x, y = w / 2, h / 2
    return [(-x + p, -y), (x - p, -y), (x, 0), (x - p, y), (-x + p, y), (-x, 0)]


def poly_slab(name, pts, z0, z1, mat, bevel=0.0, seg=2, profile=0.5):
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z0)) for x, y in pts]
    f = bm.faces.new(vs)
    if f.normal.z < 0:
        f.normal_flip()
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z = z1
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if bevel > 0:
        top = [e for e in bm.edges if all(v.co.z > z1 - 1e-4 for v in e.verts)]
        bmesh.ops.bevel(bm, geom=top, offset=bevel, segments=seg, profile=profile, affect="EDGES", clamp_overlap=True)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    return mesh_obj(name, bm, mat)


def render_strip(name, cap, tile=TILE):
    """Render the plate, then keep [left cap | one centre tile | right cap] for 3-slice use."""
    import numpy as np

    sc = bpy.context.scene
    tmp = os.path.join(OUT, f".{name}.png")
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    iw, ih = img.size
    a = np.array(img.pixels[:], np.float32).reshape(ih, iw, 4)
    c = round(cap * PPU)
    t = round(tile * PPU)
    m0 = iw // 2 - t // 2
    strip = np.ascontiguousarray(np.concatenate([a[:, :c], a[:, m0:m0 + t], a[:, iw - c:]], axis=1))
    o = bpy.data.images.new(name, strip.shape[1], ih, alpha=True)
    o.pixels[:] = strip.ravel()
    o.filepath_raw = os.path.join(OUT, f"{name}.webp")
    o.file_format = "WEBP"
    sc.render.image_settings.quality = 90
    o.save()
    os.remove(tmp)
    print("wrote", o.filepath_raw, strip.shape[1], "x", ih, "cap px", c)


def keystone_plate(name, face, rim, line, cap_mat, gem, W=4.5, H=1.5, P=0.46, CAP=0.75, ticks="bar", relief=1.0, key=180):
    """The round-3 plate: a long hexagon with pointed, gilt-capped ends.

    Rim (gold, highest) -> face (pillowed) -> a fine gold line top and bottom ->
    a band of small carved ticks along each edge -> gilt chevron ferrules on the
    points with a set stone inside each. Between the caps everything repeats every
    TILE/8 along X (geometry) or every TILE (textures), so CSS can tile the centre
    slice with `border-image-repeat: round` and never stretch the carving."""
    global PPU
    saved, PPU = PPU, 192  # 288 px tall: crisp on 3x phone screens
    reset()
    face, rim, line, cap_mat, gem = (f() for f in (face, rim, line, cap_mat, gem))  # materials made after the reset
    sun_lights(W, H, key)
    rimw = 0.075
    zr = 0.16 * relief
    zf = 0.11 * relief
    outer = hexagon(W, H, P)
    inner = inset_outline(outer, rimw)
    ring("rim", outer, inner, 0.0, zr, rim, bevel=0.035, seg=4, profile=0.6)
    poly_slab("face", inset_outline(outer, rimw - 0.01), 0.0, zf, face, bevel=0.09, seg=6, profile=0.5)
    h = H / 2 - rimw
    k = P / (H / 2)  # x run per unit of y along the slanted edges
    tc = 0.2  # ferrule width
    xt = W / 2 - rimw * 1.05
    xb = xt - h * k
    for sx in (-1, 1):
        pts = [(xb - tc, -h), (xb, -h), (xt, 0), (xb, h), (xb - tc, h), (xt - tc, 0)]
        if sx < 0:
            pts = [(-x, y) for x, y in reversed(pts)]
        poly_slab("cap", pts, 0.0, zr * 0.96, cap_mat, bevel=0.03, seg=3, profile=0.6)
        # a set stone just inside the ferrule, in a small gilt lozenge
        gx = sx * (xt - tc - 0.2)
        lo = [(gx + 0.14 * math.cos(a), 0.14 * math.sin(a)) for a in [i * math.pi / 2 for i in range(4)]]
        li = [(gx + 0.095 * math.cos(a), 0.095 * math.sin(a)) for a in [i * math.pi / 2 for i in range(4)]]
        ring("setting", lo, li, zf - 0.02, zf + 0.035, cap_mat, bevel=0.01, seg=2)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.085, location=(gx, 0, zf))
        g = bpy.context.active_object
        g.scale.z = 0.55
        bpy.ops.object.shade_smooth()
        g.data.materials.append(gem)
    # the fine gold lines, running into the ferrules; the tick bands stop at the cap slice
    ly = h - 0.17
    half = xt - tc - ly * k + 0.02
    xs = W / 2 - CAP - 0.02
    n = int(xs / (TILE / 8))
    for sy in (-1, 1):
        box("line", 0, sy * ly, 2 * half, 0.026, zf - 0.02, zf + 0.012, line, bevel=0.006)
        for i in range(-n, n + 1):
            x = i * TILE / 8
            if ticks == "bar":
                box("tick", x, sy * (h - 0.085), 0.022, 0.075, zf - 0.02, zf + 0.006, line, bevel=0.004)
            else:
                stud("dot", x, sy * (h - 0.085), 0.02, zf, line, h=0.014)
    camera(W, H)
    render_strip(name, CAP)
    PPU = saved


def concept_b(name, base, low):
    """Concept B (not shipped): the round-2 chamfered tablet, all gold leaf and fret."""
    reset()
    M = mats()
    leaf = mat_leaf("leafface", base=base, low=low, rough=0.24, crinkle=0.08)
    w, h, chamfer, frame_w = 6.0, 2.0, 0.34, 0.2
    outer = crect(w, h, chamfer)
    inner = inset_outline(outer, frame_w)
    ring("frame", outer, inner, 0.0, 0.18, M["gold"], bevel=0.07, seg=4, profile=0.62)
    slab("face", inset_outline(outer, frame_w + 0.03), 0.0, 0.08, leaf, bevel=0.11, seg=6)
    corner_frets(w, h, frame_w + 0.16, 0.26, 0.045, 0.07, 0.11, M["bronze"])
    sun_lights(w, h)
    camera(w, h)
    render(name)


PIECES = {
    # 3-slice plates, 288 px tall: cap 144 px | centre tile 192 px | cap 144 px
    "plate-sun": lambda: keystone_plate(
        "plate-sun",
        face=lambda: mat_sandstone("sand"),
        rim=lambda: mat_leaf("rim", base="#e9b95c", low="#b77c2c", rough=0.3),
        line=lambda: mat_leaf("line", base="#cf9542", low="#9c6424", rough=0.35, crinkle=0),
        cap_mat=lambda: mat_leaf("cap", base="#f3c86e", low="#c68b35", rough=0.24),
        gem=lambda: mat_gem("gem", "#2f9c80", 0.15),
    ),
    "plate-gold": lambda: keystone_plate(
        "plate-gold",
        face=lambda: mat_leaf("face", base="#ffd97a", low="#f2aa45", rough=0.2, crinkle=0.07),
        rim=lambda: mat_leaf("rim", base="#c98530", low="#8a5220", rough=0.32),
        line=lambda: mat_leaf("line", base="#fff0bf", low="#e8b965", rough=0.18, crinkle=0),
        cap_mat=lambda: mat_leaf("cap", base="#d68d34", low="#9c5d22", rough=0.28),
        gem=lambda: mat_gem("gem", "#ff7a2a", 1.2),
        ticks="dot",
        relief=1.1,
        key=150,
    ),
    "concept-b-run": lambda: concept_b("concept-b-run", "#f1c56c", "#c98f3a"),
    "concept-b-cash": lambda: concept_b("concept-b-cash", "#ff9a4a", "#c0461c"),
    # 9-slice frame, open centre (1024x512, slice 80 px): the sheets' frame
    "frame-panel": lambda: panel_frame("frame-panel"),
}

if __name__ == "__main__":
    for key, fn in PIECES.items():
        if (ONLY and key not in ONLY) or (not ONLY and key.startswith("concept")):
            continue
        fn()
