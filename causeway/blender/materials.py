"""Procedural look-dev materials. They are baked to atlases; three.js never sees these nodes."""
import bpy
from common import N, L, nodes_clear, mix, ramp, maprange, math_node, hexcol


def _coords(nt, scale=1.0):
    tc = N(nt, "ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (scale, scale, scale)
    L(nt, tc.outputs["Object"], mp.inputs[0])
    return mp.outputs[0], tc


def _noise(nt, vec, scale, detail=4.0, rough=0.55, dist=0.0, dims="3D"):
    n = N(nt, "ShaderNodeTexNoise", Scale=scale, Detail=detail, Roughness=rough, Distortion=dist)
    n.noise_dimensions = dims
    L(nt, vec, n.inputs["Vector"])
    return n


def _voronoi(nt, vec, scale, feature="DISTANCE_TO_EDGE", rand=1.0):
    v = N(nt, "ShaderNodeTexVoronoi", Scale=scale, Randomness=rand)
    v.feature = feature
    L(nt, vec, v.inputs["Vector"])
    return v


def _bump(nt, h, strength, dist=0.02, normal=None):
    b = N(nt, "ShaderNodeBump", Strength=strength, Distance=dist)
    L(nt, h, b.inputs["Height"])
    if normal is not None:
        L(nt, normal, b.inputs["Normal"])
    return b.outputs[0]


def _up_mask(nt, lo=0.45, hi=0.85):
    geo = N(nt, "ShaderNodeNewGeometry")
    sep = N(nt, "ShaderNodeSeparateXYZ")
    L(nt, geo.outputs["Normal"], sep.inputs[0])
    return maprange(nt, sep.outputs[2], lo, hi)


def _ao(nt, dist, only_local=True, inside=False):
    a = nt.nodes.new("ShaderNodeAmbientOcclusion")
    a.inputs["Distance"].default_value = dist
    a.only_local = only_local
    a.inside = inside
    a.samples = 12
    return a.outputs["AO"]


def stone(name="stone", moss=0.55, glyphs=False):
    m = bpy.data.materials.new(name)
    nt = nodes_clear(m)
    out = N(nt, "ShaderNodeOutputMaterial")
    bsdf = N(nt, "ShaderNodeBsdfPrincipled")
    L(nt, bsdf.outputs[0], out.inputs[0])
    vec, _ = _coords(nt)
    attr = N(nt, "ShaderNodeVertexColor", _layer_name="Col")
    base = attr.outputs[0]

    big = _noise(nt, vec, 1.3, 6, 0.6)
    mot = ramp(nt, big.outputs[0], [(0.3, (0.8, 0.78, 0.74)), (0.7, (1.1, 1.06, 1.0))])
    col = mix(nt, 1.0, base, mot, "MULTIPLY")
    grain = _noise(nt, vec, 38, 8, 0.7)
    gr = ramp(nt, grain.outputs[0], [(0.35, (0.86, 0.84, 0.82)), (0.65, (1.06, 1.04, 1.0))])
    col = mix(nt, 1.0, col, gr, "MULTIPLY")

    # Strata: soft horizontal banding in the sediment.
    wave = N(nt, "ShaderNodeTexWave", Scale=2.2, Distortion=6, Detail=3)
    wave.bands_direction = "Z"
    L(nt, vec, wave.inputs["Vector"])
    st = ramp(nt, wave.outputs[1], [(0.2, (0.92, 0.9, 0.88)), (0.8, (1.04, 1.02, 1.0))])
    col = mix(nt, 0.6, col, st, "MULTIPLY")

    # Hairline fractures.
    vor = _voronoi(nt, vec, 2.6)
    crack = maprange(nt, vor.outputs["Distance"], 0.0, 0.025, 0.8, 0.0)
    crack_n = _noise(nt, vec, 4, 2)
    crack = math_node(nt, "MULTIPLY", crack, maprange(nt, crack_n.outputs[0], 0.52, 0.64))
    col = mix(nt, crack, col, hexcol("#4a3422"), "MIX")

    # Dirt settles in crevices.
    ao = _ao(nt, 0.35)
    dirt = maprange(nt, ao, 0.35, 0.95, 0.75, 0.0)
    col = mix(nt, dirt, col, hexcol("#3b2a1c"), "MIX")

    # Damp, darker base where the stone meets the ground or water.
    zpos = N(nt, "ShaderNodeSeparateXYZ")
    L(nt, vec, zpos.inputs[0])
    damp = maprange(nt, zpos.outputs[2], 0.6, -0.3, 0.0, 0.55)
    col = mix(nt, damp, col, hexcol("#4f4630"), "MULTIPLY")
    # Waterline: foundations run down to the water (object z ≈ −2.2); stone below it is dark,
    # green with algae and stained a band above, where the splash reaches.
    wetn = _noise(nt, vec, 5, 3)
    wet = maprange(nt, math_node(nt, "ADD", zpos.outputs[2], math_node(nt, "MULTIPLY", wetn.outputs[0], 0.3)), -1.55, -2.05, 0.0, 1.0)
    col = mix(nt, math_node(nt, "MULTIPLY", wet, 0.8), col, hexcol("#3a4a2a"), "MULTIPLY")
    col = mix(nt, math_node(nt, "MULTIPLY", wet, 0.45), col, hexcol("#34502c"), "MIX")
    # Tafoni: honeycomb weathering hollows, clustered in soft bands of the sediment.
    taf = _voronoi(nt, vec, 4.5, "F1", 0.9)
    tafm = maprange(nt, _noise(nt, vec, 1.6, 3).outputs[0], 0.5, 0.62)
    tafh = math_node(nt, "MULTIPLY", maprange(nt, taf.outputs["Distance"], 0.28, 0.0, 0.0, 1.0), tafm)
    col = mix(nt, math_node(nt, "MULTIPLY", tafh, 0.55), col, hexcol("#6b4a2e"), "MULTIPLY")
    # Pale dust on convex, weathered edges.
    edge = _ao(nt, 0.08, True, True)
    ew = maprange(nt, edge, 0.55, 0.9, 0.45, 0.0)
    col = mix(nt, math_node(nt, "MULTIPLY", ew, maprange(nt, grain.outputs[0], 0.4, 0.6)), col, hexcol("#e3cfae"), "MIX")
    # Erosion pits.
    pits = _voronoi(nt, vec, 16, "F1")
    pm = maprange(nt, pits.outputs["Distance"], 0.0, 0.14, 0.5, 0.0)
    col = mix(nt, pm, col, hexcol("#5c4630"), "MIX")
    # Dark runoff stains, stretched vertically.
    tc2 = N(nt, "ShaderNodeMapping")
    tc2.inputs["Scale"].default_value = (3.5, 3.5, 0.45)
    L(nt, vec, tc2.inputs[0])
    stain = _noise(nt, tc2.outputs[0], 2.0, 5, 0.6)
    stain_m = maprange(nt, stain.outputs[0], 0.52, 0.72, 0.0, 0.38)
    col = mix(nt, stain_m, col, hexcol("#5b4a32"), "MULTIPLY")

    rough_v = maprange(nt, grain.outputs[0], 0.3, 0.7, 0.78, 0.95)
    if moss > 0:
        up = _up_mask(nt, 0.35, 0.8)
        mn = _noise(nt, vec, 3.2, 6, 0.65, 0.6)
        mm = maprange(nt, mn.outputs[0], 0.58 - 0.25 * moss, 0.7 - 0.2 * moss)
        mfac = math_node(nt, "MULTIPLY", up, mm)
        # Moss also creeps into cracks and down from the tops.
        mfac = math_node(nt, "MAXIMUM", mfac, math_node(nt, "MULTIPLY", dirt, maprange(nt, mn.outputs[0], 0.55, 0.7, 0, 0.6 * moss)))
        mc = _noise(nt, vec, 9, 4)
        moss_col = ramp(nt, mc.outputs[0], [(0.3, hexcol("#3f4d1c")), (0.7, hexcol("#6f7d2c"))])
        col = mix(nt, mfac, col, moss_col, "MIX")
        rough_v = mix(nt, mfac, rough_v, (1, 1, 1, 1), "MIX")

    L(nt, col, bsdf.inputs["Base Color"])
    L(nt, rough_v, bsdf.inputs["Roughness"])

    h1 = _noise(nt, vec, 9, 10, 0.72)
    h2 = _voronoi(nt, vec, 7, "F1")
    height = math_node(nt, "ADD", h1.outputs[0], math_node(nt, "MULTIPLY", h2.outputs["Distance"], 0.35))
    nrm = _bump(nt, height, 0.7, 0.14)
    nrm = _bump(nt, math_node(nt, "SUBTRACT", 0, math_node(nt, "ADD", crack, pm)), 0.7, 0.04, nrm)
    nrm = _bump(nt, math_node(nt, "SUBTRACT", 0, tafh), 0.8, 0.08, nrm)
    rough_v = mix(nt, math_node(nt, "MULTIPLY", wet, 0.6), rough_v, (0.45, 0.45, 0.45, 1), "MIX")
    L(nt, rough_v, bsdf.inputs["Roughness"])
    if glyphs:
        # Carved relief: a grid of cartouches with voronoi-cut glyph strokes.
        brick = N(nt, "ShaderNodeTexBrick", Scale=1.4, **{"Mortar Size": 0.06, "Mortar Smooth": 0.4})
        brick.offset = 0.0
        L(nt, vec, brick.inputs["Vector"])
        gv = _voronoi(nt, vec, 11, "DISTANCE_TO_EDGE")
        stroke = maprange(nt, gv.outputs["Distance"], 0.02, 0.06, 1.0, 0.0)
        carve = math_node(nt, "MULTIPLY", stroke, math_node(nt, "SUBTRACT", 1.0, brick.outputs["Fac"]))
        nrm = _bump(nt, math_node(nt, "SUBTRACT", brick.outputs["Fac"], math_node(nt, "MULTIPLY", carve, 0.6)), 0.9, 0.07, nrm)
    L(nt, nrm, bsdf.inputs["Normal"])
    return m


def floor(name="floor"):
    m = bpy.data.materials.new(name)
    nt = nodes_clear(m)
    out = N(nt, "ShaderNodeOutputMaterial")
    bsdf = N(nt, "ShaderNodeBsdfPrincipled")
    L(nt, bsdf.outputs[0], out.inputs[0])
    vec, _ = _coords(nt)
    base = N(nt, "ShaderNodeVertexColor", _layer_name="Col").outputs[0]
    big = _noise(nt, vec, 0.9, 5)
    col = mix(nt, 1.0, base, ramp(nt, big.outputs[0], [(0.3, (0.82, 0.8, 0.78)), (0.7, (1.1, 1.05, 1.0))]), "MULTIPLY")
    fine = _noise(nt, vec, 55, 8, 0.75)
    col = mix(nt, 1.0, col, ramp(nt, fine.outputs[0], [(0.3, (0.85, 0.84, 0.82)), (0.7, (1.07, 1.05, 1.03))]), "MULTIPLY")
    # Worn pale patches where feet go.
    wear = _noise(nt, vec, 2.2, 3)
    col = mix(nt, maprange(nt, wear.outputs[0], 0.55, 0.75, 0, 0.35), col, hexcol("#d9a47a"), "MIX")
    pits = _voronoi(nt, vec, 30, "F1")
    pm = maprange(nt, pits.outputs["Distance"], 0.0, 0.12, 0.55, 0.0)
    col = mix(nt, pm, col, hexcol("#5a3222"), "MIX")
    vor = _voronoi(nt, vec, 1.8)
    crack = maprange(nt, vor.outputs["Distance"], 0.0, 0.015, 0.7, 0.0)
    crack = math_node(nt, "MULTIPLY", crack, maprange(nt, _noise(nt, vec, 3, 2).outputs[0], 0.56, 0.66))
    col = mix(nt, crack, col, hexcol("#2e1a10"), "MIX")
    ao = _ao(nt, 0.2)
    dirt = maprange(nt, ao, 0.3, 0.95, 0.85, 0.0)
    col = mix(nt, dirt, col, hexcol("#3a2418"), "MIX")
    # Sand collects in gaps and at the edges.
    sand = math_node(nt, "MULTIPLY", dirt, maprange(nt, _noise(nt, vec, 6, 3).outputs[0], 0.4, 0.6))
    col = mix(nt, sand, col, hexcol("#b98c5c"), "MIX")
    up = _up_mask(nt, 0.3, 0.8)
    mn = _noise(nt, vec, 4, 5)
    moss = math_node(nt, "MULTIPLY", dirt, maprange(nt, mn.outputs[0], 0.58, 0.68, 0, 0.8))
    col = mix(nt, moss, col, hexcol("#4d5a22"), "MIX")
    L(nt, col, bsdf.inputs["Base Color"])
    L(nt, maprange(nt, wear.outputs[0], 0.3, 0.8, 0.9, 0.62), bsdf.inputs["Roughness"])
    h = _noise(nt, vec, 14, 10, 0.7)
    nrm = _bump(nt, h.outputs[0], 0.5, 0.07)
    nrm = _bump(nt, math_node(nt, "SUBTRACT", 0, math_node(nt, "ADD", crack, pm)), 0.6, 0.035, nrm)
    L(nt, nrm, bsdf.inputs["Normal"])
    return m


def rock(name="rock"):
    m = bpy.data.materials.new(name)
    nt = nodes_clear(m)
    out = N(nt, "ShaderNodeOutputMaterial")
    bsdf = N(nt, "ShaderNodeBsdfPrincipled")
    L(nt, bsdf.outputs[0], out.inputs[0])
    vec, _ = _coords(nt, 0.6)
    big = _noise(nt, vec, 1.0, 8, 0.6, 0.4)
    col = ramp(nt, big.outputs[0], [(0.25, hexcol("#6b5140")), (0.5, hexcol("#9c7a5c")), (0.75, hexcol("#b89572"))])
    wave = N(nt, "ShaderNodeTexWave", Scale=1.2, Distortion=9, Detail=5)
    wave.bands_direction = "Z"
    L(nt, vec, wave.inputs["Vector"])
    col = mix(nt, 0.55, col, ramp(nt, wave.outputs[1], [(0.2, (0.78, 0.74, 0.7)), (0.8, (1.08, 1.04, 1.0))]), "MULTIPLY")
    ao = _ao(nt, 1.2)
    dirt = maprange(nt, ao, 0.3, 0.95, 0.8, 0.0)
    col = mix(nt, dirt, col, hexcol("#2c2018"), "MIX")
    up = _up_mask(nt, 0.25, 0.7)
    mn = _noise(nt, vec, 2.5, 6, 0.6, 0.8)
    moss = math_node(nt, "MULTIPLY", up, maprange(nt, mn.outputs[0], 0.4, 0.55))
    mc = ramp(nt, _noise(nt, vec, 12, 3).outputs[0], [(0.3, hexcol("#2f4318")), (0.7, hexcol("#5c7026"))])
    col = mix(nt, moss, col, mc, "MIX")
    L(nt, col, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.92
    h = _noise(nt, vec, 6, 12, 0.7, 0.3)
    v = _voronoi(nt, vec, 3, "F1")
    height = math_node(nt, "ADD", h.outputs[0], math_node(nt, "MULTIPLY", v.outputs["Distance"], 0.6))
    nrm = _bump(nt, height, 0.85, 0.3)
    nrm = _bump(nt, wave.outputs[1], 0.35, 0.15, nrm)
    L(nt, nrm, bsdf.inputs["Normal"])
    return m


def wood(name="wood"):
    m = bpy.data.materials.new(name)
    nt = nodes_clear(m)
    out = N(nt, "ShaderNodeOutputMaterial")
    bsdf = N(nt, "ShaderNodeBsdfPrincipled")
    L(nt, bsdf.outputs[0], out.inputs[0])
    tc = N(nt, "ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (18, 0.6, 18)  # grain runs along Y (plank length)
    L(nt, tc.outputs["Object"], mp.inputs[0])
    vec = mp.outputs[0]
    base = N(nt, "ShaderNodeVertexColor", _layer_name="Col").outputs[0]
    grain = _noise(nt, vec, 2.0, 8, 0.6, 2.5)
    col = mix(nt, 1.0, base, ramp(nt, grain.outputs[0], [(0.3, (0.7, 0.68, 0.66)), (0.7, (1.12, 1.08, 1.02))]), "MULTIPLY")
    ao = _ao(nt, 0.15)
    col = mix(nt, maprange(nt, ao, 0.3, 0.95, 0.8, 0), col, hexcol("#241710"), "MIX")
    # Sun-bleached tops.
    col = mix(nt, math_node(nt, "MULTIPLY", _up_mask(nt, 0.5, 0.9), 0.35), col, hexcol("#c9a987"), "MIX")
    L(nt, col, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    L(nt, _bump(nt, grain.outputs[0], 0.5, 0.03), bsdf.inputs["Normal"])
    return m


def bark(name="bark"):
    m = bpy.data.materials.new(name)
    nt = nodes_clear(m)
    out = N(nt, "ShaderNodeOutputMaterial")
    bsdf = N(nt, "ShaderNodeBsdfPrincipled")
    L(nt, bsdf.outputs[0], out.inputs[0])
    vec, _ = _coords(nt)
    wave = N(nt, "ShaderNodeTexWave", Scale=5.5, Distortion=2.5, Detail=4)
    wave.bands_direction = "Z"
    L(nt, vec, wave.inputs["Vector"])
    fib = _noise(nt, vec, 30, 6)
    col = ramp(nt, wave.outputs[1], [(0.1, hexcol("#4a3a2a")), (0.5, hexcol("#7d6a52")), (0.9, hexcol("#9a8568"))])
    col = mix(nt, 0.4, col, ramp(nt, fib.outputs[0], [(0.3, (0.7, 0.7, 0.7)), (0.7, (1.1, 1.1, 1.1))]), "MULTIPLY")
    L(nt, col, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    L(nt, _bump(nt, wave.outputs[1], 0.8, 0.1), bsdf.inputs["Normal"])
    return m


def flora(name="flora"):
    """Vertex-coloured plants and moss: lily pads, lotus, moss mounds."""
    m = bpy.data.materials.new(name)
    nt = nodes_clear(m)
    out = N(nt, "ShaderNodeOutputMaterial")
    bsdf = N(nt, "ShaderNodeBsdfPrincipled")
    L(nt, bsdf.outputs[0], out.inputs[0])
    vec, _ = _coords(nt, 1.0)
    base = N(nt, "ShaderNodeVertexColor", _layer_name="Col").outputs[0]
    fine = _noise(nt, vec, 24, 6, 0.7)
    col = mix(nt, 1.0, base, ramp(nt, fine.outputs[0], [(0.3, (0.78, 0.8, 0.74)), (0.7, (1.12, 1.1, 1.0))]), "MULTIPLY")
    veins = _voronoi(nt, vec, 9, "DISTANCE_TO_EDGE")
    col = mix(nt, maprange(nt, veins.outputs["Distance"], 0.0, 0.04, 0.25, 0.0), col, hexcol("#2c3d14"), "MIX")
    sun = _noise(nt, vec, 3, 3)
    col = mix(nt, maprange(nt, sun.outputs[0], 0.55, 0.7, 0.0, 0.3), col, hexcol("#a4a24a"), "MIX")
    ao = _ao(nt, 0.25)
    col = mix(nt, maprange(nt, ao, 0.3, 0.95, 0.7, 0.0), col, hexcol("#1b2410"), "MIX")
    L(nt, col, bsdf.inputs["Base Color"])
    L(nt, maprange(nt, fine.outputs[0], 0.3, 0.7, 0.5, 0.85), bsdf.inputs["Roughness"])
    L(nt, _bump(nt, fine.outputs[0], 0.6, 0.03), bsdf.inputs["Normal"])
    return m
