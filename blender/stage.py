"""Stage pieces for CAUSEWAY (round 3): the things that enclose and frame the run.

  cliff_wall_*        tall stratified sandstone faces with ledges, overhangs and a ragged crest,
  cliff_wall_*_veg    the plants that cling to them: ledge shrubs, hanging curtains, crest trees,
  tree_big_*          jungle trees with real volume (a branching trunk, a dome of leaf clusters),
  shrub_mass_*        dense green masses that spill over wall tops and banks,
  temple_*            stepped temple towers (a Khmer prang and a tiered pagoda),
  face_gate_0         a gopura the path runs through, a golden face above the passage (+ _gold),
  idol_0              a golden carved head on a lotus plinth (+ _gold),
  floor_medallion_0   a walkable tile with a circular carved medallion of ring stones.

Conventions as the rest of the kit: metres, Z up, the run direction is +Y. Pure bmesh, deterministic.
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector, Matrix, Euler, noise

from common import add_block, finish_obj, hexcol, jitter_color, new_mesh_obj
import foliage as F
from setpieces import face_bm, _merge, _cyl, _tube

# Saturated sandstone of the references: warm red-orange strata with pale cream bands.
CLIFF = [hexcol(h) for h in ("#b8683c", "#c77a47", "#a45a34", "#d08c58", "#b36e45", "#9a5534")]
CLIFF_PALE = [hexcol(h) for h in ("#d9a878", "#e0b486", "#cf9c6c")]
TEMPLE = [hexcol(h) for h in ("#b98a62", "#a87a55", "#c29670", "#9c7452", "#b0835c")]
GOLD = hexcol("#e0a93a")


def temple_col(rng):
    return jitter_color(rng.choice(TEMPLE), rng, 0.08, 0.03)


# ------------------------------------------------------------------ cliffs
def _strata(z, seed, layer=2.3):
    """Inset (m) of a stratified face at height z: every bed steps in or out, undercut at its foot."""
    zi = z / layer + 0.35 * noise.noise(Vector((seed * 0.7, z * 0.05, 1.3)))
    k = math.floor(zi)
    f = zi - k
    r = random.Random(seed * 1000 + k)
    bed = r.uniform(-0.9, 0.9)
    undercut = max(0.0, 0.25 - f) / 0.25  # the soft foot of each bed weathers back
    return bed + 0.7 * undercut * undercut, k


def cliff_wall(name, seed, length=24.0, height=20.0, depth=7.0, res=0.72):
    """A cliff face running along Y (centred), its face toward −X, z=0 at the water line.

    Built as a subdivided box (the back and bottom removed), displaced along the vertex
    normals by beds of rock that step in and out, an undercut at the foot of each bed,
    vertical fluting and fractal noise. The crest is ragged and the ends curl back so the
    piece reads as solid from the path. Returns (rock, ledges) where ledges are points on
    upward-facing shelves of the face for vegetation.
    """
    rng = random.Random(seed)
    bm = bmesh.new()
    nx = max(2, int(depth / res))
    ny = max(2, int(length / res))
    nz = max(2, int((height + 3) / res))
    # The three visible sheets (front x=0, top, both ends) as grids sharing their edge vertices.
    verts = {}

    def V(key, co):
        if key not in verts:
            verts[key] = bm.verts.new(co)
        return verts[key]

    ys = [-length / 2 + length * j / ny for j in range(ny + 1)]
    zs = [-3 + (height + 3) * i / nz for i in range(nz + 1)]
    xs = [depth * i / nx for i in range(nx + 1)]
    # Front (x=0): rows z, cols y. Keys shared along the edges with the top and the ends.
    for i, z in enumerate(zs):
        for j, y in enumerate(ys):
            V(("f", i, j), Vector((0, y, z)))
    for i in range(nz):
        for j in range(ny):
            bm.faces.new((V(("f", i, j), None), V(("f", i, j + 1), None), V(("f", i + 1, j + 1), None), V(("f", i + 1, j), None)))
    # Top (z=height): rows x, cols y; x=0 row is the front's top row.
    for k, x in enumerate(xs):
        for j, y in enumerate(ys):
            key = ("f", nz, j) if k == 0 else ("t", k, j)
            V(key, Vector((x, y, height)))
    for k in range(nx):
        for j in range(ny):
            a = ("f", nz, j) if k == 0 else ("t", k, j)
            b = ("f", nz, j + 1) if k == 0 else ("t", k, j + 1)
            c = ("t", k + 1, j + 1)
            d = ("t", k + 1, j)
            bm.faces.new((V(a, None), V(d, None), V(c, None), V(b, None)))
    # Ends (y = ±L/2): rows z, cols x.
    for s, j in ((-1, 0), (1, ny)):
        for i in range(nz + 1):
            for k in range(nx + 1):
                if k == 0:
                    key = ("f", i, j)
                elif i == nz:
                    key = ("t", k, j)
                else:
                    key = ("e", s, i, k)
                V(key, Vector((xs[k], ys[j], zs[i])))
        for i in range(nz):
            for k in range(nx):
                def kk(ii, kx):
                    if kx == 0:
                        return ("f", ii, j)
                    if ii == nz:
                        return ("t", kx, j)
                    return ("e", s, ii, kx)
                q = (V(kk(i, k), None), V(kk(i, k + 1), None), V(kk(i + 1, k + 1), None), V(kk(i + 1, k), None))
                bm.faces.new(q if s > 0 else tuple(reversed(q)))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    off = Vector((seed * 3.7, seed * 1.9, seed * 0.3))
    crest_amp = height * 0.22
    for v in bm.verts:
        p = v.co.copy()
        # Plan shape: the face bows and the ends curl back (away from the path) and down.
        ey = abs(p.y) / (length / 2)
        curl = max(0.0, ey - 0.55) / 0.45
        bow = 1.6 * noise.noise(Vector((p.y * 0.06, seed * 0.3, 0.5)))
        # Ragged crest: the top of the cliff rises and falls along its length.
        crest = height - crest_amp * (0.5 + 0.5 * noise.fractal(Vector((p.y * 0.05, seed * 0.9, 0)), 0.6, 2.0, 3)) - curl * curl * height * 0.35
        t = (p.z + 3) / (height + 3)
        z = -3 + t * (crest + 3)
        if p.z >= height - 1e-4:  # the top sheet slopes back and down a little
            z = crest - 1.2 * (p.x / depth) + 0.8 * noise.noise(Vector((p.x * 0.2, p.y * 0.2, seed)))
        inset, bed = _strata(z, seed)
        flute = 0.45 * noise.noise(Vector((p.y * 0.9, z * 0.08, seed * 0.5)))
        fr = noise.fractal(Vector((p.y, z, p.x)) * 0.35 + off, 0.55, 2.0, 5)
        # The face leans back with height (a steep but not sheer wall) and overhangs at some beds.
        lean = 0.12 * max(0.0, z)
        dx = inset + flute + 0.9 * fr + lean + bow + curl * curl * 6.0
        x = p.x + dx if p.x < 1e-4 else p.x + (dx if p.x < depth * 0.5 else 0.3 * fr) * (1 - p.x / depth) + curl * curl * 3.0
        v.co = Vector((x, p.y * (1 - 0.08 * curl), z))
    bm.normal_update()
    # Colour: beds alternate hue; pale cream bands; darker at the waterline.
    cl = bm.loops.layers.float_color.new("Col")
    for f in bm.faces:
        for l in f.loops:
            z = l.vert.co.z
            _, bed = _strata(z, seed)
            r = random.Random(seed * 77 + bed)
            c = r.choice(CLIFF_PALE) if r.random() < 0.22 else r.choice(CLIFF)
            k = 0.55 + 0.45 * min(1.0, max(0.0, (z + 0.5) / 2.5))
            l[cl] = (c[0] * k, c[1] * k, c[2] * k, 1)
    # Ledges: upward-facing points on the face, for plants.
    ledges = []
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.z > 0.55 and c.x < 3.5 and 0.5 < c.z and rng.random() < 0.5:
            ledges.append((c.copy(), f.normal.copy()))
    ob = finish_obj(name, bm, 55)
    return ob, ledges


def cliff_veg(f, rng, ledges, density=1.0):
    """Round 9: plants clinging to a cliff as volumetric clumps (jungle.Fol: normals out of each clump),
    not flat cards — seen against the sky they read as soft masses, not pale cut-outs. Vines trail
    from some ledges."""
    rng.shuffle(ledges)
    n = int(min(len(ledges), 30 * density))
    for (p, nrm) in ledges[:n]:
        r = rng.uniform(0.7, 1.4)
        c = p + Vector((-0.3, 0, r * 0.3))
        f.clump(rng, c, r, rng.choice(("broad", "cluster_s", "cluster")), squash=0.8, centre=c + Vector((0.5, 0, -r * 0.5)))
        if rng.random() < 0.45:
            ln = rng.uniform(2.0, 6.5)
            f.card("vine", p + Vector((-0.5, rng.uniform(-0.5, 0.5), 0.1)), (rng.uniform(-0.6, -0.2), 0, -ln), ln * 0.4,
                   normal=(-1, 0, 0), up_bias=0.2, seg=4, up=Vector((1, 0, 0)), flip_v=True)


def crest_trees(f, rng, pts, scale=1.0):
    """Tree crowns along a cliff's crest as soft clumps; returns trunk segments for the bark object."""
    trunks = []
    for p in pts:
        s = rng.uniform(0.8, 1.3) * scale
        top = p + Vector((rng.uniform(-1.0, 0.2), 0, rng.uniform(3.5, 6.0) * s))
        trunks.append((p, top, 0.22 * s))
        for cl in range(rng.randint(3, 4)):
            cc = top + Vector((rng.uniform(-1.8, 1.8), rng.uniform(-1.8, 1.8), rng.uniform(-0.8, 1.2))) * s
            f.clump(rng, cc, rng.uniform(1.8, 2.4) * s, "cluster", squash=0.8, centre=top - Vector((0, 0, 1.0 * s)))
    return trunks


def _trunk_bm(trunks, segs=6):
    bm = bmesh.new()
    for a, b, r in trunks:
        pts = [a.lerp(b, i / 4) + Vector((0.3 * math.sin(i * 1.7), 0.2 * math.cos(i * 1.3), 0)) * (i / 4) for i in range(5)]
        F._trunk(bm, pts, [r * (1.3 - 0.6 * i / 4) for i in range(5)], segs)
    return bm


def cliff_set(name, seed, length=24.0, height=20.0, depth=7.0):
    """cliff_wall_N (rock), cliff_wall_N_veg (leaf clumps: material leaf_jungle), cliff_wall_N_trees (bark)."""
    import jungle as J
    rng = random.Random(seed + 5)
    rock, ledges = cliff_wall(name, seed, length, height, depth)
    f = J.Fol()
    cliff_veg(f, random.Random(seed), ledges)
    me = rock.data
    crest = []
    for y in [-length / 2 + length * (k + rng.uniform(0.2, 0.8)) / 5 for k in range(5)]:
        best = None
        for v in me.vertices:
            if abs(v.co.y - y) < 0.8 and v.co.x < 3.0:
                if best is None or v.co.z > best.z:
                    best = v.co.copy()
        if best is not None:
            crest.append(best + Vector((1.2, 0, -0.4)))
    trunks = crest_trees(f, rng, crest[: rng.randint(3, 5)])
    # Green tumbling over the crest edge, a vine down the face.
    for p in crest:
        c = p + Vector((-0.6, rng.uniform(-1.5, 1.5), 0.3))
        f.clump(rng, c, rng.uniform(1.2, 1.7), rng.choice(("broad", "cluster_s")), squash=0.8, centre=c + Vector((0.8, 0, -0.8)))
        ln = rng.uniform(3.0, 7.0)
        f.card("vine", p + Vector((-1.4, rng.uniform(-1.5, 1.5), 0.2)), (-0.4, 0, -ln), ln * 0.5, normal=(-1, 0, 0), up_bias=0.2,
               seg=4, up=Vector((1, 0, 0)), flip_v=True)
    veg = f.finish(name + "_veg")
    trees = new_mesh_obj(name + "_trees", _trunk_bm(trunks))
    return rock, veg, trees


# ------------------------------------------------------------------ trees and masses
def tree_big(name, seed, height=14.0, spread=5.5):
    """A jungle tree with volume: a buttressed trunk forking into limbs, each carrying a dome of leaf clusters."""
    rng = random.Random(seed)
    tb = bmesh.new()
    lean = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.5
    fork = Vector((0, 0, height * 0.55)) + lean
    pts = [lean * (i / 6) ** 2 + Vector((0, 0, height * 0.55 * i / 6)) for i in range(7)]
    F._trunk(tb, pts, [0.55 * (1 - 0.45 * i / 6) + 0.35 * (1 - i / 6) ** 5 for i in range(7)], 9)
    tips = []
    for k in range(rng.randint(3, 4)):
        a = 2 * math.pi * k / 4 + rng.uniform(-0.4, 0.4)
        tip = fork + Vector((math.cos(a) * spread * rng.uniform(0.45, 0.75), math.sin(a) * spread * rng.uniform(0.45, 0.75), height * rng.uniform(0.25, 0.4)))
        mid = fork.lerp(tip, 0.5) + Vector((0, 0, 0.6))
        F._trunk(tb, [fork, mid, tip], [0.28, 0.2, 0.1], 6)
        tips.append(tip)
    trunk = new_mesh_obj(name + "_trunk", tb)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    centres = list(tips) + [fork + Vector((0, 0, height * 0.42))]
    for c in centres:
        for q in range(4):
            cc = c + Vector((rng.uniform(-1.8, 1.8), rng.uniform(-1.8, 1.8), rng.uniform(-0.6, 1.4)))
            for k in range(10):
                a = rng.uniform(0, 2 * math.pi)
                el = rng.uniform(-0.35, 1.1)
                d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
                F._card(bm, uvl, "broad", cc - d * 0.5, d * rng.uniform(2.0, 3.0), rng.uniform(2.0, 2.8), droop=0.25, seg=2,
                        twist=rng.uniform(-0.5, 0.5))
    # A few vines hanging from the limbs.
    for t in tips[:2]:
        ln = rng.uniform(3, 6)
        F._card(bm, uvl, "vine", t + Vector((0, 0, -0.5)), (0.1, 0.1, -ln), ln * 0.4, seg=4, up=Vector((0, -1, 0)), flip_v=True)
    crown = new_mesh_obj(name + "_crown", bm)
    return trunk, crown


def shrub_mass(name, seed, w=4.0, h=1.8, d=2.4, n=34):
    """A dense, lumpy mass of green: cards spread over a half-ellipsoid, facing out."""
    rng = random.Random(seed)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    for k in range(n):
        a = rng.uniform(0, 2 * math.pi)
        el = rng.uniform(0.05, 1.3)
        o = Vector((math.cos(a) * math.cos(el) * w / 2, math.sin(a) * math.cos(el) * d / 2, math.sin(el) * h))
        dirv = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el) + 0.3)).normalized()
        ln = rng.uniform(1.0, 1.7)
        F._card(bm, uvl, rng.choice(("fern", "broad", "broad")), o * 0.55, dirv * ln, ln * rng.uniform(0.85, 1.1),
                droop=rng.uniform(0.2, 0.5), seg=3, twist=rng.uniform(-0.4, 0.4))
    return new_mesh_obj(name, bm)


# ------------------------------------------------------------------ temples
def _tier_ring(bm, rng, cx, cy, z, w, h, redent=0.18, ruin=0.0, block=1.4):
    """One tier of a redented tower: a ring of dressed blocks round a w×w square with stepped corners."""
    ch = h
    for side in range(4):
        a = side * math.pi / 2
        x = -w / 2
        while x < w / 2 - 0.05:
            bl = min(rng.uniform(block * 0.7, block * 1.3), w / 2 - x)
            xc = x + bl / 2
            if ruin and rng.random() < ruin:
                x += bl
                continue
            # Stepped (redented) corners: blocks near a corner sit back.
            inset = redent * w if abs(xc) > w * 0.36 else 0.0
            r = w / 2 - inset - 0.35
            px = cx + math.cos(a) * xc - math.sin(a) * r
            py = cy + math.sin(a) * xc + math.cos(a) * r
            add_block(bm, (bl - 0.03, 0.7, ch - 0.03), (px, py, z + ch / 2), (0, 0, a), bevel=0.05, rng=rng, color=temple_col(rng),
                      chip=0.25, segments=1)
            x += bl
    # Core fill so the tier is solid from any angle.
    add_block(bm, (w * 0.8, w * 0.8, ch), (cx, cy, z + ch / 2), bevel=0.0, rng=rng, color=temple_col(rng), jit=0.0)


def _cornice(bm, rng, z, w, t=0.28):
    add_block(bm, (w + 0.35, w + 0.35, t), (0, 0, z + t / 2), bevel=0.04, rng=rng, color=temple_col(rng), chip=0.4, segments=1)


def temple_prang(name, seed, base=9.0, height=24.0):
    """A Khmer-style prang: a stepped platform, a shrine body with a doorway, and a corncob tower of shrinking tiers."""
    rng = random.Random(seed)
    bm = bmesh.new()
    z = -2.6
    w = base
    # Platform: three broad steps up out of the water.
    for i in range(3):
        add_block(bm, (w, w, 1.2), (0, 0, z + 0.6), bevel=0.06, rng=rng, color=temple_col(rng), chip=0.3, segments=1)
        z += 1.2
        w *= 0.84
    # A stair up the front face.
    for i in range(6):
        add_block(bm, (1.8, 0.7, 0.6), (0, -base / 2 + 0.3 + i * 0.52, -2.3 + i * 0.6), bevel=0.03, rng=rng, color=temple_col(rng), chip=0.3, segments=1)
    # Shrine body with a dark doorway (a recessed block) and false doors.
    bw = w * 0.95
    _tier_ring(bm, rng, 0, 0, z, bw, 3.4, redent=0.1, block=1.6)
    add_block(bm, (1.2, 0.3, 2.2), (0, -bw / 2 - 0.05, z + 1.1), bevel=0.02, rng=rng, color=hexcol("#2a1a10"), jit=0.0)
    for sd in (-1, 1):
        add_block(bm, (0.3, 0.5, 2.6), (sd * 0.8, -bw / 2 - 0.1, z + 1.3), bevel=0.03, rng=rng, color=temple_col(rng), segments=1)
    add_block(bm, (2.2, 0.55, 0.4), (0, -bw / 2 - 0.1, z + 2.7), bevel=0.03, rng=rng, color=temple_col(rng), segments=1)
    z += 3.4
    _cornice(bm, rng, z, bw)
    z += 0.28
    # The tower: tiers shrink and curve in like a lotus bud.
    tiers = 6
    top = height - 3.0
    tw = bw * 0.98
    for i in range(tiers):
        h = (top - z) / (tiers - i) * 0.92
        _tier_ring(bm, rng, 0, 0, z, tw, h, redent=0.14, ruin=0.04 if i > 2 else 0.0, block=1.1)
        z += h
        _cornice(bm, rng, z, tw * 0.98, 0.22)
        z += 0.22
        # Antefixes: little flame-shaped finials on the corners and mid-faces of every tier.
        for k in range(8):
            a = math.pi / 4 * k
            r = tw * (0.5 if k % 2 == 0 else 0.62)
            _merge(bm, _cyl(0.28 * tw / 4, 0.02, 0.9 * tw / 4, 5, Matrix.Translation((math.cos(a) * r, math.sin(a) * r, z))), temple_col(rng))
        tw *= (0.95, 0.92, 0.88, 0.82, 0.74, 0.7)[i]
    # Finial.
    _merge(bm, _cyl(tw * 0.5, tw * 0.15, 2.4, 10, Matrix.Translation((0, 0, z))), temple_col(rng))
    _merge(bm, _cyl(0.18, 0.02, 1.4, 6, Matrix.Translation((0, 0, z + 2.4))), temple_col(rng))
    # Rubble at the foot.
    for _ in range(6):
        s = rng.uniform(0.4, 0.9)
        a = rng.uniform(0, 6.28)
        add_block(bm, (s * 1.4, s, s * 0.8), (math.cos(a) * base * 0.55, math.sin(a) * base * 0.55, -2.4 + s * 0.3), (0.2, 0.1, a),
                  bevel=0.05, rng=rng, color=temple_col(rng), chip=0.6, segments=1)
    return finish_obj(name, bm, 40)


def temple_pagoda(name, seed, base=8.0, tiers=5):
    """A tiered pagoda: square storeys each capped by a broad stone eave with lifted corners, a spire on top."""
    rng = random.Random(seed)
    bm = bmesh.new()
    z = -2.6
    add_block(bm, (base + 1.5, base + 1.5, 2.2), (0, 0, z + 1.1), bevel=0.06, rng=rng, color=temple_col(rng), chip=0.3, segments=1)
    z += 2.2
    w = base
    for i in range(tiers):
        h = 3.4 * (1 - 0.1 * i)
        _tier_ring(bm, rng, 0, 0, z, w, h, redent=0.0, block=1.3)
        if i < 2:  # a dark window in each face
            for a in range(4):
                ang = a * math.pi / 2
                r = w / 2 - 0.3
                add_block(bm, (0.9, 0.2, 1.3), (-math.sin(ang) * r, math.cos(ang) * r, z + h * 0.5), (0, 0, ang), bevel=0.0, rng=rng,
                          color=hexcol("#2a1a10"), jit=0)
        z += h
        # Eave: a wide thin slab; corners lifted.
        ew = w + 2.4
        t = bmesh.new()
        bmesh.ops.create_grid(t, x_segments=6, y_segments=6, size=ew / 2)
        for v in t.verts:
            c = max(abs(v.co.x), abs(v.co.y)) / (ew / 2)
            corner = (abs(v.co.x) / (ew / 2)) * (abs(v.co.y) / (ew / 2))
            v.co.z = -0.9 * c * c + 1.1 * corner ** 2
        res = bmesh.ops.extrude_face_region(t, geom=list(t.faces))
        bmesh.ops.translate(t, vec=(0, 0, 0.35), verts=[e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)])
        bmesh.ops.recalc_face_normals(t, faces=t.faces)
        bmesh.ops.translate(t, vec=(0, 0, z + 0.4), verts=t.verts)
        _merge(bm, t, temple_col(rng))
        z += 0.75
        w *= 0.8
    _merge(bm, _cyl(w * 0.45, 0.08, 4.0, 10, Matrix.Translation((0, 0, z))), temple_col(rng))
    for k in range(4):
        _merge(bm, _cyl(0.55 - k * 0.08, 0.5 - k * 0.08, 0.2, 10, Matrix.Translation((0, 0, z + 0.6 + k * 0.7))), hexcol("#c89a5e"))
    return finish_obj(name, bm, 40)


def _gold_face(size, seed, crown=True):
    t = face_bm(seed, rings=26, segs=34, crown=crown, cuts=1)
    bmesh.ops.transform(t, matrix=Matrix.Scale(size, 4), verts=t.verts)
    return t


def face_gate(name, seed, span=6.4, depth=7.0, height=21.0):
    """A gopura across the path: two massive piers, a corbelled passage, stepped tiers above,
    and a golden face gazing down the causeway over the entrance. The passage is centred on
    x=0 and runs y ∈ [0, depth]; the path goes through it. Returns (stone, gold)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    pw = 4.2
    half = span / 2
    ph = 6.2
    for sd in (-1, 1):
        cx = sd * (half + pw / 2)
        z = -2.6
        while z < ph:
            h = rng.uniform(0.7, 1.0)
            y = 0.0
            while y < depth - 0.05:
                bl = min(rng.uniform(1.0, 1.8), depth - y)
                add_block(bm, (pw, bl - 0.03, h - 0.03), (cx + rng.uniform(-0.04, 0.04), y + bl / 2, z + h / 2), bevel=0.05, rng=rng,
                          color=temple_col(rng), chip=0.25, segments=1)
                y += bl
            z += h
        # Outer wings stepping down to the water.
        for k in range(3):
            add_block(bm, (3.0, depth * (0.9 - 0.15 * k), 5.5 - k * 1.6), (sd * (half + pw + 1.5 + k * 2.6), depth / 2, -2.6 + (5.5 - k * 1.6) / 2),
                      bevel=0.06, rng=rng, color=temple_col(rng), chip=0.35, segments=1)
    # Corbelled lintel courses over the passage.
    z = ph
    for k in range(2):
        w = span + 2 * pw - k * 0.4
        add_block(bm, (w, depth, 0.7), (0, depth / 2, z + 0.35), bevel=0.05, rng=rng, color=temple_col(rng), chip=0.25, segments=1)
        z += 0.7
    add_block(bm, (span + 2 * pw + 0.6, depth + 0.6, 0.35), (0, depth / 2, z + 0.17), bevel=0.04, rng=rng, color=temple_col(rng), chip=0.4, segments=1)
    z += 0.35
    # Tiers above, each a little smaller: the face sits on the front of the first.
    face_z = z
    tw, td = span + 2 * pw - 1.0, depth
    for k in range(4):
        h = [6.6, 2.6, 2.2, 1.8][k]
        yb = 0.0
        while yb < td - 0.05:
            bl = min(rng.uniform(1.2, 2.0), td - yb)
            xb = -tw / 2
            while xb < tw / 2 - 0.05:
                bw = min(rng.uniform(1.0, 1.8), tw / 2 - xb)
                edge = yb < 0.1 or yb + bl > td - 0.1 or xb < -tw / 2 + 0.1 or xb + bw > tw / 2 - 0.1
                if edge:
                    add_block(bm, (bw - 0.03, bl - 0.03, h - 0.03), (xb + bw / 2, (depth - td) / 2 + yb + bl / 2, z + h / 2), bevel=0.05, rng=rng,
                              color=temple_col(rng), chip=0.3 if k else 0.15, segments=1)
                xb += bw
            yb += bl
        add_block(bm, (tw * 0.9, td * 0.9, h), (0, depth / 2, z + h / 2), bevel=0.0, rng=rng, color=temple_col(rng), jit=0.0)
        z += h
        add_block(bm, (tw + 0.4, td + 0.4, 0.3), (0, depth / 2, z + 0.15), bevel=0.04, rng=rng, color=temple_col(rng), chip=0.4, segments=1)
        z += 0.3
        tw *= 0.78
        td *= 0.8
    _merge(bm, _cyl(tw * 0.45, 0.1, 3.2, 10, Matrix.Translation((0, depth / 2, z))), temple_col(rng))
    # Niche behind the face.
    add_block(bm, (6.6, 0.5, 6.2), (0, -0.05, face_z + 3.2), bevel=0.04, rng=rng, color=hexcol("#6b4a32"), jit=0.0)
    stone = finish_obj(name, bm, 40)
    g = bmesh.new()
    t = _gold_face(2.9, seed + 3, crown=True)
    bmesh.ops.transform(t, matrix=Matrix.Translation((0, -1.1, face_z + 2.6)), verts=t.verts)
    _merge(g, t, GOLD)
    gold = finish_obj(name + "_gold", g, 60)
    return stone, gold


def idol(name, seed, size=2.8):
    """A golden head on a lotus plinth rising from the water (z=0 at the water line). Faces −Y. Returns (stone, gold)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    z = -2.6
    w = size * 3.2
    for i in range(3):
        add_block(bm, (w, w, 1.1), (0, 0, z + 0.55), bevel=0.06, rng=rng, color=temple_col(rng), chip=0.35, segments=1)
        z += 1.1
        w *= 0.82
    # Lotus petals round the neck (stone).
    for k in range(12):
        a = 2 * math.pi * k / 12
        add_block(bm, (0.9 * size / 2.8, 0.35, 1.3 * size / 2.8), (math.cos(a) * w * 0.42, math.sin(a) * w * 0.42, z + 0.5), (0.35, 0, a + math.pi / 2),
                  bevel=0.08, rng=rng, color=temple_col(rng), chip=0.2, segments=1)
    stone = finish_obj(name, bm, 40)
    g = bmesh.new()
    t = _gold_face(size, seed, crown=True)
    bmesh.ops.transform(t, matrix=Matrix.Translation((0, 0, z + size * 1.0)), verts=t.verts)
    _merge(g, t, GOLD)
    gold = finish_obj(name + "_gold", g, 60)
    return stone, gold


# ------------------------------------------------------------------ floor medallion
def _prism(bm, poly, ztop, depth, color):
    t = bmesh.new()
    top = [t.verts.new((x, y, ztop)) for x, y in poly]
    f = t.faces.new(top)
    res = bmesh.ops.extrude_face_region(t, geom=[f])
    bmesh.ops.translate(t, vec=(0, 0, -depth), verts=[e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(t, faces=t.faces)
    top_edges = [e for e in t.edges if all(abs(v.co.z - ztop) < 1e-4 for v in e.verts)]
    bmesh.ops.bevel(t, geom=top_edges, offset=0.02, segments=1, affect="EDGES", clamp_overlap=True)
    bmesh.ops.triangulate(t, faces=[f for f in t.faces if len(f.verts) > 4])
    _merge(bm, t, color)


def _ring_poly(r0, r1, a0, a1, n=5, gap=0.012):
    a0 += gap / max(r0, 0.3)
    a1 -= gap / max(r0, 0.3)
    outer = [(math.cos(a0 + (a1 - a0) * i / n) * (r1 - gap), math.sin(a0 + (a1 - a0) * i / n) * (r1 - gap)) for i in range(n + 1)]
    inner = [(math.cos(a1 - (a1 - a0) * i / n) * (r0 + gap), math.sin(a1 - (a1 - a0) * i / n) * (r0 + gap)) for i in range(n + 1)]
    return outer + inner


def floor_medallion(name, seed, width=4.4, length=4.0, thickness=0.32):
    """A 4 m walkable tile (y ∈ [0, length]) with a carved stone medallion: a sun disc, rings of
    wedge stones in alternating tones, a scalloped rim, and corner slabs out to the square."""
    from kit_geo import TERRA
    rng = random.Random(seed)
    bm = bmesh.new()
    cy = length / 2
    pale = [hexcol(h) for h in ("#c98a5c", "#d29666", "#bf7f52")]

    def col(p):
        return jitter_color(rng.choice(p), rng, 0.06, 0.03)

    def at(poly):
        return [(x, y + cy) for x, y in poly]

    dz = lambda: rng.uniform(-0.01, 0.006)
    # Centre: a sun disc with eight raised petals.
    disc = [(math.cos(2 * math.pi * i / 20) * 0.42, math.sin(2 * math.pi * i / 20) * 0.42) for i in range(20)]
    _prism(bm, at(disc), 0.01, thickness, col(pale))
    for k in range(8):
        a = 2 * math.pi * k / 8
        petal = [(math.cos(a) * 0.12, math.sin(a) * 0.12), (math.cos(a + 0.28) * 0.28, math.sin(a + 0.28) * 0.28),
                 (math.cos(a) * 0.4, math.sin(a) * 0.4), (math.cos(a - 0.28) * 0.28, math.sin(a - 0.28) * 0.28)]
        _prism(bm, at(petal), 0.035, 0.05, col(TERRA))
    rings = [(0.44, 0.95, 10, TERRA), (0.97, 1.42, 16, pale), (1.44, 1.86, 22, TERRA)]
    for ri, (r0, r1, n, pal) in enumerate(rings):
        rot = rng.uniform(0, 1)
        for k in range(n):
            a0 = 2 * math.pi * (k + rot) / n
            a1 = 2 * math.pi * (k + 1 + rot) / n
            _prism(bm, at(_ring_poly(r0, r1, a0, a1, 4)), dz(), thickness, col(pal if (k + ri) % 2 == 0 or ri != 1 else TERRA))
    # Scalloped rim beads between rings.
    for k in range(28):
        a = 2 * math.pi * k / 28
        _merge(bm, _cyl(0.07, 0.06, 0.05, 6, Matrix.Translation((math.cos(a) * 1.43, cy + math.sin(a) * 1.43, -0.01))), col(pale))
    # Corner stones: sectors from the rim (r=1.88) out to the tile's rectangle.
    hx, hy = width / 2, length / 2

    def to_rect(a):
        c, s = math.cos(a), math.sin(a)
        t = min(hx / abs(c) if abs(c) > 1e-6 else 1e9, hy / abs(s) if abs(s) > 1e-6 else 1e9)
        return (c * t, s * t)

    corners = [(hx, hy), (-hx, hy), (-hx, -hy), (hx, -hy)]
    ns = 12
    for k in range(ns):
        a0 = 2 * math.pi * k / ns + 0.004
        a1 = 2 * math.pi * (k + 1) / ns - 0.004
        arc = [(math.cos(a0 + (a1 - a0) * i / 4) * 1.9, math.sin(a0 + (a1 - a0) * i / 4) * 1.9) for i in range(5)]
        outer = [to_rect(a1)]
        for cx_, cy_ in corners:
            ca = math.atan2(cy_, cx_) % (2 * math.pi)
            if a0 < ca < a1:
                outer.append((cx_ * 0.995, cy_ * 0.995))
        outer.append(to_rect(a0))
        # Order: arc a0→a1, then rectangle a1→a0 (corner in between if any).
        rect = [outer[0]] + sorted(outer[1:-1], key=lambda p: -math.atan2(p[1], p[0]) % (2 * math.pi)) + [outer[-1]]
        poly = arc + rect
        _prism(bm, at(poly), dz(), thickness, col(TERRA))
    return finish_obj(name, bm, 30)
