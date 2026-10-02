"""Mesoamerican set pieces (round 8): the brief is Aztec / Maya jungle ruins, not Khmer or Gothic.

  mask_bm             an angular, menacing gold mask: a hexagonal face plate, a slanted brow over
                      deep obsidian eyes, a broad flat nose, an open snarl with fangs, jade ear
                      spools and a feathered headdress band. Built from crisp bevelled prisms.
  face_gate           a temple gateway the path runs through: ashlar piers with glyph panels, a
                      corbel (Maya) vault over the passage, a stepped-fret frieze carrying the mask,
                      talud-tablero tiers and a roof comb; serpent heads guard the threshold.
  step_pyramid        a talud-tablero pyramid out of the water with a central stair between serpent
                      balustrades and a shrine with a roof comb on top (`ruin` collapses part of it).
  idol                the mask on a stepped glyph plinth.
  corbel_arch         the arcade arch: piers and stepped corbel courses meeting under a capstone.

Same conventions as the kit: metres, Z up, run direction +Y, faces toward −Y; deterministic.
Names keep the kit's (face_gate_0 / _gold, temple_0/1, idol_0 / _gold, arch_0/1): the game and the
FX gate door (game.ts dressDoor: face_gate_0_gold centred 11.51 m up) depend on them.
"""
import math
import random

import bpy
import bmesh
from mathutils import Matrix, Vector

from common import add_block, finish_obj, hexcol, jitter_color
from setpieces import _cyl, _merge

# Weathered limestone (pale, a little grey-green), not the warm planks of the old temples.
LIME = [hexcol(h) for h in ("#c9bb9a", "#bcad8c", "#d3c6a6", "#b0a283", "#c4b592", "#a99a7c")]
LIME_DARK = [hexcol(h) for h in ("#8f8268", "#857a62", "#978a6e")]
MOSS = [hexcol(h) for h in ("#6f7a44", "#5f6c3a", "#7c8248")]
GOLD = hexcol("#e3ac3c")
GOLD_DK = hexcol("#b07a22")
JADE = hexcol("#2f7d5c")
JADE_LT = hexcol("#4fa07a")
OBSIDIAN = hexcol("#151210")
SHELL = hexcol("#efe6cf")
MAW = hexcol("#3a120c")
RECESS = hexcol("#4a4132")


def lime(rng, moss=0.12):
    if rng.random() < moss:
        return jitter_color(rng.choice(MOSS), rng, 0.08, 0.03)
    return jitter_color(rng.choice(LIME), rng, 0.07, 0.02)


def prism(bm, poly, y0, depth, color, bevel=0.03, m=None):
    """A crisp slab: polygon `poly` in the XZ plane, front face at y=y0 (facing −Y), `depth` deep."""
    t = bmesh.new()
    vs = [t.verts.new((x, y0, z)) for x, z in poly]
    f = t.faces.new(vs)
    res = bmesh.ops.extrude_face_region(t, geom=[f])
    bmesh.ops.translate(t, vec=(0, depth, 0), verts=[e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(t, faces=t.faces)
    if bevel > 0:
        bmesh.ops.bevel(t, geom=list(t.edges), offset=bevel, segments=1, affect="EDGES", clamp_overlap=True)
    if m is not None:
        bmesh.ops.transform(t, matrix=m, verts=t.verts)
    _merge(bm, t, color)


def box(bm, rng, size, loc, color, rot=(0, 0, 0), bevel=0.035, chip=0.15):
    add_block(bm, size, loc, rot, bevel=bevel, rng=rng, color=color, chip=chip, jit=0.008, segments=1)


def frustum(bm, w0, d0, w1, d1, z0, h, color, cx=0.0, cy=0.0, bevel=0.04):
    """A sloped (talud) course: a w0×d0 base narrowing to w1×d1 at the top."""
    t = bmesh.new()
    bmesh.ops.create_cube(t, size=1.0)
    for v in t.verts:
        top = v.co.z > 0
        w, d = (w1, d1) if top else (w0, d0)
        v.co = Vector((cx + v.co.x * w, cy + v.co.y * d, z0 + (h if top else 0.0)))
    bmesh.ops.bevel(t, geom=list(t.edges), offset=bevel, segments=1, affect="EDGES", clamp_overlap=True)
    _merge(bm, t, color)


# ------------------------------------------------------------------ the mask
def mask_bm(seed, s=1.0):
    """The mask, ~2.2 s wide and ~2.6 s tall (headdress included), centred on the face plate's middle
    at the origin, face toward −Y, front at y ≈ −0.3 s."""
    rng = random.Random(seed)
    bm = bmesh.new()
    S = Matrix.Scale(s, 4)

    def P(poly, y0, depth, col, bevel=0.025):
        prism(bm, poly, y0, depth, col, bevel * s, S)

    def mirror(poly):
        return [(-x, z) for x, z in reversed(poly)]

    # Face plate: broad cheekbones, a heavy squared jaw.
    P([(-0.86, 0.74), (0.86, 0.74), (0.98, 0.08), (0.7, -0.72), (0.24, -1.0), (-0.24, -1.0), (-0.7, -0.72), (-0.98, 0.08)], 0.0, 0.42, GOLD)
    # Headdress: a band of jade-studded gold and a crest of stepped feather blades.
    P([(-1.12, 0.7), (1.12, 0.7), (1.08, 1.06), (-1.08, 1.06)], -0.14, 0.5, GOLD_DK)
    for k in range(7):
        x = -0.9 + 0.3 * k
        P([(x - 0.08, 0.84), (x + 0.08, 0.84), (x + 0.08, 0.96), (x - 0.08, 0.96)], -0.2, 0.08, JADE)
    for k in range(9):
        x = -1.0 + 0.25 * k
        hgt = 1.42 + 0.22 * math.cos((k - 4) * 0.55) + (0.08 if k % 2 else 0)
        P([(x - 0.13, 1.04), (x + 0.13, 1.04), (x + 0.07, hgt), (x - 0.07, hgt + 0.06)], -0.06 + 0.03 * (k % 2), 0.16, GOLD if k % 2 else GOLD_DK)
    # Brow: two heavy ridges slanting down to the middle (a scowl).
    brow = [(-0.84, 0.66), (-0.06, 0.46), (-0.06, 0.3), (-0.84, 0.48)]
    for poly in (brow, mirror(brow)):
        P(poly, -0.24, 0.26, GOLD_DK)
    # Eyes: deep obsidian, narrowed by the brow, with a shell glint set high (a stare).
    eye = [(-0.72, 0.4), (-0.16, 0.27), (-0.2, 0.1), (-0.66, 0.14)]
    for poly in (eye, mirror(eye)):
        P(poly, -0.05, 0.1, OBSIDIAN, 0.01)
    for sx in (-1, 1):
        P([(sx * 0.48 - 0.06, 0.27), (sx * 0.48 + 0.06, 0.27), (sx * 0.48 + 0.06, 0.35), (sx * 0.48 - 0.06, 0.35)], -0.07, 0.05, SHELL, 0.005)
    # Nose: broad and flat, flared nostrils.
    P([(-0.16, 0.32), (0.16, 0.32), (0.3, -0.16), (0.12, -0.24), (-0.12, -0.24), (-0.3, -0.16)], -0.3, 0.34, GOLD)
    # Cheek plaques of jade.
    for sx in (-1, 1):
        P([(sx * 0.56 - 0.13, -0.02), (sx * 0.56 + 0.13, -0.02), (sx * 0.56 + 0.1, -0.24), (sx * 0.56 - 0.1, -0.24)], -0.06, 0.08, JADE_LT, 0.012)
    # The snarl: a dark maw under a curled lip, fangs down, tusks up, a row of teeth.
    P([(-0.56, -0.32), (0.56, -0.32), (0.42, -0.72), (-0.42, -0.72)], -0.04, 0.1, MAW, 0.01)
    P([(-0.66, -0.24), (0.66, -0.24), (0.58, -0.36), (-0.58, -0.36)], -0.2, 0.22, GOLD_DK)
    P([(-0.5, -0.7), (0.5, -0.7), (0.56, -0.8), (-0.56, -0.8)], -0.16, 0.2, GOLD_DK)
    for x in (-0.3, 0.3):
        P([(x - 0.1, -0.34), (x + 0.1, -0.34), (x + 0.02, -0.64), (x - 0.02, -0.64)], -0.12, 0.09, SHELL, 0.008)
    for x in (-0.44, 0.44):
        P([(x - 0.06, -0.7), (x + 0.06, -0.7), (x + 0.01, -0.5), (x - 0.01, -0.5)], -0.1, 0.07, SHELL, 0.006)
    for k in range(4):
        x = -0.15 + 0.1 * k
        P([(x - 0.04, -0.34), (x + 0.04, -0.34), (x + 0.03, -0.44), (x - 0.03, -0.44)], -0.08, 0.05, SHELL, 0.005)
    # Ear spools: gold discs with jade centres, pendants hanging under them.
    for sx in (-1, 1):
        r = Matrix.Rotation(math.pi / 2, 4, "X")
        _merge(bm, _cyl(0.3 * s, 0.3 * s, 0.22 * s, 14, Matrix.Translation((sx * 1.08 * s, 0.25 * s, 0.05 * s)) @ r), GOLD_DK)
        _merge(bm, _cyl(0.16 * s, 0.16 * s, 0.1 * s, 12, Matrix.Translation((sx * 1.08 * s, 0.05 * s, 0.05 * s)) @ r), JADE)
        P([(sx * 1.08 - 0.08, -0.25), (sx * 1.08 + 0.08, -0.25), (sx * 1.08 + 0.05, -0.62), (sx * 1.08 - 0.05, -0.62)], -0.02, 0.1, GOLD)
    # Serpent fangs curling from the corners of the headdress down past the temples.
    for sx in (-1, 1):
        P([(sx * 1.1, 0.72), (sx * 1.26, 0.6), (sx * 1.2, 0.22), (sx * 1.1, 0.34)], -0.08, 0.18, SHELL, 0.01)
    del rng
    return bm


# ------------------------------------------------------------------ carved panels
def glyph_panel(bm, rng, cx, y, cz, w, h, axis="x"):
    """A carved cartouche panel on a wall face (facing −Y if axis 'x', else facing ±X): a recessed
    frame of squares, each holding a stylised day-sign of raised bars and dots."""
    n = max(1, int(round(w / 0.9)))
    cell = w / n
    for i in range(n):
        x = cx - w / 2 + cell * (i + 0.5)
        rows = max(1, int(round(h / 0.9)))
        ch = h / rows
        for j in range(rows):
            z = cz - h / 2 + ch * (j + 0.5)
            box(bm, rng, (cell * 0.88, 0.1, ch * 0.88), (x, y - 0.02, z), jitter_color(rng.choice(LIME_DARK), rng, 0.05, 0.02), chip=0.0, bevel=0.02)
            # A day-sign: a ring of 2–4 raised bars and a dot.
            k = rng.randint(2, 4)
            for b in range(k):
                bz = z - ch * 0.25 + ch * 0.5 * b / max(1, k - 1)
                bw = cell * rng.uniform(0.35, 0.62)
                box(bm, rng, (bw, 0.1, ch * 0.09), (x + rng.uniform(-0.08, 0.08) * cell, y - 0.07, bz), lime(rng, 0), chip=0.0, bevel=0.015)
            box(bm, rng, (cell * 0.14, 0.1, cell * 0.14), (x + cell * 0.27, y - 0.08, z + ch * 0.27), lime(rng, 0), chip=0.0, bevel=0.015)


def fret_frieze(bm, rng, x0, x1, y, z, h):
    """A stepped-fret (xicalcoliuhqui) band: alternating raised steps and hooks along a facade."""
    w = max(0.2, h * 1.2)  # (never a non-positive step)
    x = x0
    k = 0
    while x < x1 - w * 0.5:
        c = lime(rng, 0.04)
        box(bm, rng, (w * 0.45, 0.22, h * 0.32), (x + w * 0.22, y - 0.1, z - h * 0.3), c, chip=0.05)
        box(bm, rng, (w * 0.22, 0.22, h * 0.6), (x + w * 0.5, y - 0.1, z - h * 0.05), c, chip=0.05)
        box(bm, rng, (w * 0.45, 0.22, h * 0.3), (x + w * 0.72, y - 0.1, z + h * 0.3), c, chip=0.05)
        x += w
        k += 1


def serpent_head(bm, rng, loc, yaw=0.0, s=1.0):
    """A blocky feathered-serpent head at the foot of a stair or gate, jaws open toward −Y."""
    m = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Scale(s, 4)

    def B(size, p, col):
        box(bm, rng, size, (m @ Vector(p)), col, rot=(0, 0, yaw), chip=0.1)

    c = lime(rng, 0.1)
    B((1.1, 1.3, 0.5), (0, 0.1, 0.55), c)            # upper jaw / snout
    B((1.0, 1.1, 0.25), (0, 0.15, 0.12), c)          # lower jaw
    B((0.9, 0.2, 0.18), (0, -0.52, 0.33), MAW)        # the open mouth
    for x in (-0.3, 0.3):
        B((0.12, 0.12, 0.34), (x, -0.5, 0.2), SHELL)  # fangs
        B((0.24, 0.3, 0.2), (x * 1.3, -0.15, 0.86), lime(rng, 0))  # brow scales
        B((0.14, 0.06, 0.12), (x * 1.3, -0.33, 0.72), OBSIDIAN)    # eyes
    B((1.3, 0.35, 0.9), (0, 0.85, 0.6), c)           # the feathered collar
    for k in range(5):
        B((0.18, 0.2, 0.32), (-0.5 + 0.25 * k, 0.72, 1.12), lime(rng, 0.2))


# ------------------------------------------------------------------ the gateway
def face_gate(name, seed, span=6.4, depth=7.0, height=21.0):
    """A temple gateway across the path (passage centred on x=0, y ∈ [0, depth]). Returns (stone, gold)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    pw = 4.2
    half = span / 2
    ph = 5.4
    for sd in (-1, 1):
        cx = sd * (half + pw / 2)
        # Ashlar piers: big squared blocks in staggered courses.
        z = -2.6
        row = 0
        while z < ph - 0.05:
            h = min(rng.uniform(0.95, 1.25), ph - z)
            y = -rng.uniform(0.0, 0.6) if row % 2 else 0.0
            while y < depth - 0.05:
                bl = min(rng.uniform(1.5, 2.4), depth - max(y, 0.0))
                y0 = max(y, 0.0)
                box(bm, rng, (pw, bl - 0.04, h - 0.04), (cx + rng.uniform(-0.03, 0.03), y0 + bl / 2, z + h / 2), lime(rng))
                y = y0 + bl
            z += h
            row += 1
        # A glyph panel on the pier's front.
        glyph_panel(bm, rng, cx, -0.02, 2.6, pw - 1.0, 3.0)
        # Talud skirts stepping down into the water outside.
        for k in range(3):
            w = 3.0
            frustum(bm, w + 0.6, depth * (0.95 - 0.15 * k), w, depth * (0.85 - 0.15 * k), -2.6, 5.0 - k * 1.5, lime(rng, 0.25),
                    cx=sd * (half + pw + 1.5 + k * 2.6), cy=depth / 2)
        serpent_head(bm, rng, (sd * (half + 0.55), -0.55, 0.0), 0.0, 0.8)
    # The corbel vault: courses stepping in over the passage until a capstone closes it.
    z = ph
    inner = half
    k = 0
    while inner > 0.45:
        h = 0.62
        for sd in (-1, 1):
            w = (half + pw) - inner + 0.2
            box(bm, rng, (w, depth, h - 0.03), (sd * (inner + w / 2 - 0.2), depth / 2, z + h / 2), lime(rng, 0.05))
        z += h
        inner -= 0.58
        k += 1
    box(bm, rng, (2 * (half + pw), depth, 0.7), (0, depth / 2, z + 0.35), lime(rng, 0.05))
    z += 0.7
    # Frieze: the mask sits at its centre on a recessed panel, stepped frets either side.
    fz = z
    fh = 4.4
    box(bm, rng, (2 * (half + pw) + 0.4, depth, fh), (0, depth / 2, fz + fh / 2), lime(rng, 0.05))
    box(bm, rng, (4.2, 0.4, fh - 0.3), (0, -0.12, fz + fh / 2), RECESS, chip=0.0)
    fret_frieze(bm, rng, -(half + pw), -2.3, -0.02, fz + fh * 0.62, 1.3)
    fret_frieze(bm, rng, 2.3, half + pw, -0.02, fz + fh * 0.62, 1.3)
    glyph_panel(bm, rng, -(half + pw) / 2 - 1.1, -0.02, fz + fh * 0.2, 3.2, 1.0)
    glyph_panel(bm, rng, (half + pw) / 2 + 1.1, -0.02, fz + fh * 0.2, 3.2, 1.0)
    z = fz + fh
    box(bm, rng, (2 * (half + pw) + 0.8, depth + 0.6, 0.35), (0, depth / 2, z + 0.17), lime(rng, 0.1))
    z += 0.35
    # Talud-tablero tiers above, then a pierced roof comb.
    tw, td = 2 * (half + pw) - 1.2, depth - 0.6
    for k in range(3):
        th = (2.4, 2.0, 1.7)[k]
        frustum(bm, tw, td, tw - 0.7, td - 0.7, z, th * 0.55, lime(rng, 0.2), cy=depth / 2)
        box(bm, rng, (tw - 0.5, td - 0.5, th * 0.45), (0, depth / 2, z + th * 0.55 + th * 0.225), lime(rng, 0.1))
        z += th
        tw *= 0.74
        td *= 0.82
    comb_w = tw * 0.9
    comb_h = max(2.0, height - z)
    for i in range(5):
        x = -comb_w / 2 + comb_w * (i + 0.5) / 5
        box(bm, rng, (comb_w / 5 * 0.6, 0.5, comb_h), (x, depth / 2, z + comb_h / 2), lime(rng, 0.15))
    box(bm, rng, (comb_w, 0.55, 0.5), (0, depth / 2, z + comb_h * 0.55), lime(rng, 0.1))
    box(bm, rng, (comb_w + 0.2, 0.6, 0.4), (0, depth / 2, z + comb_h), lime(rng, 0.1))
    stone = finish_obj(name, bm, 40)
    # The mask: centred 11.51 m up (the FX door scales it about that point), 1.1 m proud of the facade.
    g = mask_bm(seed + 3, s=2.25)
    bmesh.ops.transform(g, matrix=Matrix.Translation((0, -1.1, 11.51)), verts=g.verts)
    gold = finish_obj(name + "_gold", g, 30)
    return stone, gold


# ------------------------------------------------------------------ pyramids
def step_pyramid(name, seed, base=16.0, tiers=5, ruin=0.0):
    """A talud-tablero pyramid rising out of the water (z=0 at the water line, base at −2.6), stair on
    its −Y face between serpent balustrades, a shrine with a roof comb on top."""
    rng = random.Random(seed)
    bm = bmesh.new()
    z = -2.6
    w = base
    th = 3.2
    stair_w = base * 0.22
    for i in range(tiers):
        if ruin and i == tiers - 1 and rng.random() < 0.5:
            break
        frustum(bm, w, w, w - 1.2, w - 1.2, z, th * 0.6, lime(rng, 0.08))
        # Tablero: a vertical band with a recessed panel on each face.
        tb = w - 1.0
        box(bm, rng, (tb, tb, th * 0.4), (0, 0, z + th * 0.6 + th * 0.2), lime(rng, 0.1))
        for a in range(4):
            ang = a * math.pi / 2
            px, py = -math.sin(ang) * tb / 2, -math.cos(ang) * tb / 2
            box(bm, rng, (tb * 0.8 if a % 2 == 0 else 0.12, 0.12 if a % 2 == 0 else tb * 0.8, th * 0.22),
                (px * 1.002, py * 1.002, z + th * 0.8), RECESS, chip=0.0, bevel=0.01)
        # Collapse: drop chunks off one corner of the upper tiers.
        if ruin and i >= 1:
            for _ in range(int(3 + 5 * ruin)):
                s = rng.uniform(0.6, 1.4)
                a = rng.uniform(0.6, 1.4)
                box(bm, rng, (s * 1.3, s, s * 0.8), (math.cos(a) * w * 0.55, math.sin(a) * w * 0.55, z + rng.uniform(0, th)),
                    lime(rng, 0.4), rot=(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0, 6.28)), chip=0.5)
        z += th
        w -= 2.4
    top = z
    # The stair: steps up the −Y face, from the water to the summit.
    steps = int((top + 2.6) / 0.45)
    run = (base - w) / 2
    for k in range(steps):
        t = (k + 0.5) / steps
        # Proud of the tiers (the stair is built out in front of them) and deep enough to meet them.
        box(bm, rng, (stair_w, 1.6, 0.46), (0, -base / 2 - 0.1 + t * run + 0.8, -2.6 + t * (top + 2.6) - 0.2), lime(rng, 0.08), chip=0.05)
    # Balustrades: sloped ramps either side, serpent heads at their feet.
    L = math.hypot(run, top + 2.6)
    ang = math.atan2(top + 2.6, run)
    for sd in (-1, 1):
        box(bm, rng, (0.8, L, 0.9), (sd * (stair_w / 2 + 0.4), -base / 2 + run / 2 - 0.15, -2.6 + (top + 2.6) / 2 + 0.25), lime(rng, 0.15), rot=(ang, 0, 0))
        serpent_head(bm, rng, (sd * (stair_w / 2 + 0.4), -base / 2 - 0.9, -2.6 + 0.3), 0.0, 1.0)
    # The shrine: walls with a dark doorway, a fret band, and a roof comb.
    if not ruin or rng.random() < 0.6:
        sw = max(4.0, w * 0.9)
        box(bm, rng, (sw, sw * 0.8, 3.0), (0, 0, top + 1.5), lime(rng, 0.1))
        box(bm, rng, (1.4, 0.4, 2.0), (0, -sw * 0.4 - 0.05, top + 1.0), OBSIDIAN, chip=0.0)
        fret_frieze(bm, rng, -sw / 2, sw / 2, -sw * 0.4 - 0.02, top + 2.55, 0.6)
        box(bm, rng, (sw + 0.4, sw * 0.8 + 0.4, 0.35), (0, 0, top + 3.15), lime(rng, 0.1))
        if not ruin:
            for i in range(4):
                x = -sw * 0.35 + sw * 0.7 * i / 3
                box(bm, rng, (0.5, 0.45, 2.4), (x, 0, top + 4.5), lime(rng, 0.15))
            box(bm, rng, (sw * 0.8, 0.5, 0.4), (0, 0, top + 5.6), lime(rng, 0.1))
    # Rubble at the foot.
    for _ in range(8):
        s = rng.uniform(0.5, 1.1)
        a = rng.uniform(0, 6.28)
        box(bm, rng, (s * 1.4, s, s * 0.8), (math.cos(a) * base * 0.56, math.sin(a) * base * 0.56, -2.3 + s * 0.3), lime(rng, 0.4),
            rot=(0.2, 0.1, a), chip=0.5)
    return finish_obj(name, bm, 40)


def idol(name, seed, size=2.8):
    """The mask on a stepped glyph plinth rising from the water (z=0 at the water line). Returns (stone, gold)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    z = -2.6
    w = size * 3.0
    for i in range(3):
        frustum(bm, w, w, w - 0.6, w - 0.6, z, 1.1, lime(rng, 0.08))
        z += 1.1
        w *= 0.8
    box(bm, rng, (w, w * 0.6, size * 1.1), (0, 0.3, z + size * 0.55), lime(rng, 0.1))
    glyph_panel(bm, rng, 0, -w * 0.3 + 0.28, z + size * 0.3, w * 0.8, size * 0.45)
    serpent_head(bm, rng, (-w * 0.55, -w * 0.45, z - 0.5), 0.0, 0.7)
    serpent_head(bm, rng, (w * 0.55, -w * 0.45, z - 0.5), 0.0, 0.7)
    stone = finish_obj(name, bm, 40)
    g = mask_bm(seed, s=size * 0.62)
    bmesh.ops.transform(g, matrix=Matrix.Translation((0, -w * 0.3 + 0.1, z + size * 1.1 + size * 0.62)), verts=g.verts)
    gold = finish_obj(name + "_gold", g, 30)
    return stone, gold


# ------------------------------------------------------------------ round 9: carved walls, serpents, capitals
def _two_faced(build, length, depth):
    """Build a frieze with `build(bm)` facing −Y along x ∈ [0, length], copy it turned to face +Y, and lay
    the pair along +Y (the kit's wall convention: runs y ∈ [0, length], faces ±X, centred on x=0)."""
    out = bmesh.new()
    for flip in (False, True):
        t = bmesh.new()
        build(t)
        if flip:
            bmesh.ops.transform(t, matrix=Matrix.Translation((length, 0, 0)) @ Matrix.Rotation(math.pi, 4, "Z"), verts=t.verts)
        bmesh.ops.transform(t, matrix=Matrix.Rotation(math.pi / 2, 4, "Z"), verts=t.verts)
        me = bpy.data.meshes.new("_tf")
        t.to_mesh(me)
        t.free()
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
    return out


def carved_wall(name, seed, length=4.0, height=1.7, depth=0.72, ruin=0.25):
    """A dressed parapet for the causeway's edge: squared courses, a band of glyph cartouches on both
    faces, a stepped-fret crest under a coping, here and there a stone gone or the crest broken."""
    rng = random.Random(seed)
    d2 = depth / 2

    def body(bm):
        z = -0.3
        row = 0
        while z < height * 0.38:
            ch = min(rng.uniform(0.34, 0.44), height * 0.45 - z)
            x = -rng.uniform(0, 0.4) if row % 2 else 0.0
            while x < length - 0.05:
                bw = min(rng.uniform(0.7, 1.2), length - max(x, 0.0))
                x0 = max(x, 0.0)
                box(bm, rng, (bw - 0.03, d2 - 0.01, ch - 0.03), (x0 + bw / 2, -d2 / 2, z + ch / 2), lime(rng, 0.15), chip=0.25)
                x = x0 + bw
            z += ch
            row += 1
        band = height * 0.28
        box(bm, rng, (length - 0.04, d2 - 0.05, band), (length / 2, -d2 / 2 + 0.03, z + band / 2), jitter_color(rng.choice(LIME_DARK), rng, 0.05, 0.02))
        glyph_panel(bm, rng, length / 2, -d2 + 0.06, z + band / 2, length - 0.3, band * 0.8)
        z += band
        crest = max(0.32, height - z)
        for k in range(int(length / 0.5)):
            x = 0.25 + 0.5 * k
            if ruin and rng.random() < ruin * 0.5:
                continue
            box(bm, rng, (0.46, d2 - 0.02, crest * 0.6), (x, -d2 / 2, z + crest * 0.3), lime(rng, 0.1), chip=0.2)
        fret_frieze(bm, rng, 0.0, length, -d2 + 0.02, z + crest * 0.3, crest * 0.55)
        if not ruin or rng.random() > ruin:
            box(bm, rng, (length - 0.02, d2 + 0.06, 0.16), (length / 2, -d2 / 2 - 0.03, height - 0.02), lime(rng, 0.2), chip=0.3)

    bm = _two_faced(body, length, depth)
    return finish_obj(name, bm, 40)


def serpent_post(name, seed, s=0.85):
    """A feathered-serpent head on a squared post, jaws open toward −Y: it ends a balustrade or guards a
    stair at the causeway's edge."""
    rng = random.Random(seed)
    bm = bmesh.new()
    box(bm, rng, (1.0 * s, 1.4 * s, 0.9), (0, 0.2 * s, 0.45 - 0.3), lime(rng, 0.2), chip=0.2)
    serpent_head(bm, rng, (0, 0, 0.75), 0.0, s)
    return finish_obj(name, bm, 40)


def pillar_cap(name, seed, w=1.3):
    """Round 10: a stepped (inverted talud-tablero) capital for the square piers — three widening courses,
    a fret band, and a serpent head looking out from one face. Not a Doric echinus."""
    rng = random.Random(seed)
    bm = bmesh.new()
    z = 0.0
    for k, (ww, hh) in enumerate(((0.95, 0.22), (1.15, 0.24), (1.38, 0.34))):
        box(bm, rng, (ww, ww, hh), (0, 0, z + hh / 2), lime(rng, 0.15 if k < 2 else 0.25), chip=0.25)
        z += hh
    for a in range(4):
        t = bmesh.new()
        fret_frieze(t, rng, -0.62, 0.62, -0.69 - 0.02, z - 0.17, 0.22)
        bmesh.ops.transform(t, matrix=Matrix.Rotation(a * math.pi / 2, 4, "Z"), verts=t.verts)
        _merge_bm(bm, t)
    serpent_head(bm, rng, (0, -0.65, 0.05), 0.0, 0.42)
    return finish_obj(name, bm, 40)


# ------------------------------------------------------------------ round 10: bold glyphs, piers, the door
GLYPH_RAISED = hexcol("#d6c9a8")
GLYPH_GROUND = hexcol("#5e5442")


def cartouche(bm, rng, x, y, z, s, motif=None):
    """One bold glyph block, s × s, facing −Y with its front at y: a dark sunk ground, a raised rounded
    frame and a simple, chunky sign (legible at phone size, unlike fine strokes). Motifs: 0 a face
    (ahau: two eyes and a mouth), 1 a kan cross, 2 a bar-and-dot numeral, 3 a stepped spiral, 4 three bars."""
    motif = rng.randint(0, 4) if motif is None else motif
    box(bm, rng, (s, 0.12, s), (x, y + 0.06, z), GLYPH_GROUND, bevel=0.02, chip=0.0)
    t = s * 0.13
    for dx, dz, w, h in ((0, s / 2 - t / 2, s, t), (0, -s / 2 + t / 2, s, t), (-s / 2 + t / 2, 0, t, s - 2 * t), (s / 2 - t / 2, 0, t, s - 2 * t)):
        box(bm, rng, (w, 0.16, h), (x + dx, y - 0.02, z + dz), GLYPH_RAISED, bevel=0.025, chip=0.0)
    u = s * 0.12

    def R(dx, dz, w, h):
        box(bm, rng, (w * s, 0.16, h * s), (x + dx * s, y - 0.02, z + dz * s), GLYPH_RAISED, bevel=0.02, chip=0.0)

    if motif == 0:
        R(-0.17, 0.12, 0.18, 0.18); R(0.17, 0.12, 0.18, 0.18); R(0, -0.18, 0.42, 0.1); R(0, -0.06, 0.1, 0.12)
    elif motif == 1:
        R(0, 0, 0.5, 0.14); R(0, 0, 0.14, 0.5)
    elif motif == 2:
        R(0, -0.16, 0.56, 0.1); R(0, -0.02, 0.56, 0.1)
        for k in (-1, 0, 1):
            R(k * 0.18, 0.18, 0.1, 0.1)
    elif motif == 3:
        R(-0.12, 0.14, 0.32, 0.1); R(0.03, 0.0, 0.1, 0.26); R(0.12, -0.14, 0.32, 0.1); R(-0.2, -0.04, 0.1, 0.26)
    else:
        for k in (-1, 0, 1):
            R(k * 0.17, 0, 0.1, 0.5)
    del u


def glyph_grid(bm, rng, cx, y, cz, cols, rows, s, gap=0.08):
    w = cols * s + (cols - 1) * gap
    h = rows * s + (rows - 1) * gap
    for i in range(cols):
        for j in range(rows):
            cartouche(bm, rng, cx - w / 2 + s / 2 + i * (s + gap), y, cz - h / 2 + s / 2 + j * (s + gap), s)


def square_pier(name, seed, height=5.0, w=0.95, broken=False):
    """A square limestone pier (Maya, not a Greek drum column): a stepped base, squared courses with a
    band of glyph blocks on all four faces, broken piers stop short in a ragged top."""
    rng = random.Random(seed)
    bm = bmesh.new()
    box(bm, rng, (w * 1.45, w * 1.45, 0.3), (0, 0, 0.15 - 0.1), lime(rng, 0.25), chip=0.3)
    box(bm, rng, (w * 1.2, w * 1.2, 0.25), (0, 0, 0.32), lime(rng, 0.2), chip=0.3)
    top = height if not broken else height * rng.uniform(0.38, 0.62)
    z = 0.45
    band_z = 0.45 + (height - 0.45) * 0.62
    while z < top - 0.1:
        h = min(rng.uniform(0.5, 0.75), top - z)
        ox, oy = rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02)
        if broken and z + h >= top - 0.1:
            box(bm, rng, (w * rng.uniform(0.6, 0.9), w * rng.uniform(0.6, 0.9), h), (ox, oy, z + h / 2), lime(rng, 0.3),
                rot=(rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), rng.uniform(-0.3, 0.3)), chip=0.6)
        else:
            box(bm, rng, (w, w, h - 0.025), (ox, oy, z + h / 2), lime(rng, 0.15), rot=(0, 0, rng.uniform(-0.03, 0.03)), chip=0.2)
        z += h
    if top > band_z + 0.5:
        for a in range(4):
            t = bmesh.new()
            glyph_grid(t, rng, 0, -w / 2 - 0.01, band_z + 0.25, 2, 1, w * 0.4, 0.04)
            bmesh.ops.transform(t, matrix=Matrix.Rotation(a * math.pi / 2, 4, "Z"), verts=t.verts)
            _merge_bm(bm, t)
    if broken:
        for _ in range(3):
            s = rng.uniform(0.18, 0.32)
            box(bm, rng, (s * 1.4, s, s * 0.8), (rng.uniform(-1, 1), rng.uniform(-1, 1), s * 0.3), lime(rng, 0.4),
                rot=(0.2, 0.1, rng.uniform(0, 6)), chip=0.6)
    return finish_obj(name, bm, 40)


def _merge_bm(bm, t):
    me = bpy.data.meshes.new("_mb")
    t.to_mesh(me)
    t.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def door_slab(name, seed, w=6.2, h=6.0, d=0.8):
    """The carved stone that drops across the path when the way falls (game.ts dresses it: the mask fills
    the roundel 3.3 m up, r 1.35). A plain bevelled frame, a sunk roundel, and two columns of bold glyph
    blocks either side; the back face carries a glyph grid too."""
    rng = random.Random(seed)
    bm = bmesh.new()
    box(bm, rng, (w, d, h), (0, 0, h / 2), lime(rng, 0.05), bevel=0.06, chip=0.05)
    fr = 0.32
    for x, z, ww, hh in ((0, h - fr / 2, w, fr), (0, fr / 2, w, fr), (-w / 2 + fr / 2, h / 2, fr, h - 2 * fr), (w / 2 - fr / 2, h / 2, fr, h - 2 * fr)):
        for sy in (-1, 1):
            box(bm, rng, (ww, 0.1, hh), (x, sy * (d / 2 + 0.04), z), lime(rng, 0.0), bevel=0.03, chip=0.0)
    # The roundel the mask sits in: a dark sunk disc in a raised ring.
    for r0, r1, y, col in ((1.42, 1.42, -d / 2 - 0.06, GLYPH_RAISED), (1.25, 1.25, -d / 2 - 0.1, GLYPH_GROUND)):
        t = _cyl(r0, r1, 0.14 if col is GLYPH_RAISED else 0.1, 40, Matrix.Translation((0, y + 0.07, h * 0.55)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
        _merge(bm, t, col)
    s = 0.84
    for sx in (-1, 1):
        glyph_grid(bm, rng, sx * 2.2, -d / 2 - 0.02, h * 0.5, 1, 4, s, 0.12)
    t = bmesh.new()
    glyph_grid(t, rng, 0, -d / 2 - 0.02, h * 0.5, 5, 4, s, 0.14)
    bmesh.ops.transform(t, matrix=Matrix.Rotation(math.pi, 4, "Z"), verts=t.verts)
    _merge_bm(bm, t)
    return finish_obj(name, bm, 40)


def relief_wall(name, seed, length=4.0, depth=0.9):
    """Dressed ashlar with a band of bold glyph blocks on both faces under a projecting cornice. Runs along
    +Y like the wall pieces (the FX door also wears it as a carved band)."""
    rng = random.Random(seed)
    hgt = 3.4

    def body(bm):
        z = -0.35
        for ci, ch in enumerate([0.6, 0.7]):
            x = -rng.uniform(0, 0.5) if ci % 2 else 0.0
            while x < length - 0.05:
                bw = min(rng.uniform(1.0, 1.7), length - max(x, 0.0))
                x0 = max(x, 0.0)
                box(bm, rng, (bw - 0.03, depth / 2, ch - 0.03), (x0 + bw / 2, -depth / 4, z + ch / 2), lime(rng, 0.15), chip=0.2)
                x = x0 + bw
            z += ch
        band = 1.5
        box(bm, rng, (length - 0.02, depth / 2, band), (length / 2, -depth / 4, z + band / 2), lime(rng, 0.05), chip=0.05)
        glyph_grid(bm, rng, length / 2, -depth / 2 - 0.02, z + band / 2, 5, 2, 0.62, 0.12)
        z += band
        box(bm, rng, (length - 0.02, depth / 2, hgt - z - 0.25), (length / 2, -depth / 4, (z + hgt - 0.25) / 2), lime(rng, 0.15), chip=0.2)
        box(bm, rng, (length, depth / 2 + 0.15, 0.25), (length / 2, -depth / 4 - 0.07, hgt - 0.12), lime(rng, 0.2), chip=0.3)

    return finish_obj(name, _two_faced(body, length, depth), 40)


def stele_glyph(name, seed, w=1.4, h=3.2, d=0.55):
    """A stele: a plinth and a slab carved with a column of bold glyph blocks on both faces."""
    rng = random.Random(seed)
    bm = bmesh.new()
    box(bm, rng, (w * 1.3, d * 1.5, 0.4), (0, 0, 0.2), lime(rng, 0.3), chip=0.4)
    box(bm, rng, (w, d, h), (0, 0, 0.4 + h / 2), lime(rng, 0.1), rot=(0, 0, rng.uniform(-0.05, 0.05)), chip=0.2)
    rows = max(2, int(h / (w * 0.5)))
    s = min(w * 0.38, (h - 0.4) / rows - 0.1)
    for flip in (0, 1):
        t = bmesh.new()
        glyph_grid(t, rng, 0, -d / 2 - 0.01, 0.4 + h / 2, 2, rows, s, 0.08)
        if flip:
            bmesh.ops.transform(t, matrix=Matrix.Rotation(math.pi, 4, "Z"), verts=t.verts)
        _merge_bm(bm, t)
    return finish_obj(name, bm, 40)
