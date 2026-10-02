"""Round 5 jungle: volumetric foliage from the lit cluster cells of the leaf atlas (see foliage.py).

Every plant here is built from *clumps*: three standing cluster cards crossed round a centre plus one
lying over it, with vertex normals pointing out of that centre (and a little up), so a clump shades
as a soft ball of leaves under the sun instead of as flat cards. The normals are authored here and
exported (the material is `leaf_jungle`, which the loader leaves alone; track.ts folds it back into
the one `leaf` draw call per section).

Pieces (Z up, run direction +Y, the path toward −X unless noted):
  jungle_bank_N        a wall of jungle 16 m long rising from the water behind a causeway wall
  canopy_N / _limb     a limb leaning out over the path from the right bank, clumps along it and
                       curtains of vines below — frames the top of the shot and dapples the path
  banana_N             a clump of torn banana leaves
  spill_N              green tumbling over a wall crest down its inner face (origin on the crest)
  palm_N_crown         drooping palm crowns (replace foliage.palm's)
  bush_N, shrub_mass_N, tree_big_N_crown, fern_N   rebuilt as clumps
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector

from common import new_mesh_obj
import foliage as F

UP = Vector((0, 0, 1))


class Fol:
    """A leaf mesh under construction that remembers, per vertex, which way its normal should face."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uvl = self.bm.loops.layers.uv.new("UVMap")
        self.normals = []  # one per vertex, in creation order

    def card(self, cell, p0, d, w, centre=None, normal=None, up_bias=0.45, **kw):
        n0 = len(self.bm.verts)
        F._card(self.bm, self.uvl, cell, Vector(p0), Vector(d), w, **kw)
        self.bm.verts.ensure_lookup_table()
        for i in range(n0, len(self.bm.verts)):
            co = self.bm.verts[i].co
            if normal is not None:
                n = Vector(normal)
            else:
                n = co - Vector(centre)
                if n.length < 1e-4:
                    n = UP.copy()
                n.normalize()
            n = (n + UP * up_bias).normalized()
            self.normals.append(n)

    def clump(self, rng, c, r, cell="cluster", squash=0.9, top=True, n=3, up_bias=0.45, centre=None):
        """Crossed standing cards round c (radius r) and one lying over it."""
        c = Vector(c)
        cc = Vector(centre) if centre is not None else c
        a0 = rng.uniform(0, math.pi)
        h = 2 * r * squash
        for k in range(n):
            a = a0 + k * math.pi / n + rng.uniform(-0.15, 0.15)
            nrm = Vector((math.cos(a), math.sin(a), rng.uniform(-0.15, 0.15)))
            self.card(cell, c - UP * h * 0.5, UP * h, 2 * r * rng.uniform(0.92, 1.08), centre=cc, up_bias=up_bias, up=nrm, seg=1)
        if top:
            b = rng.uniform(0, math.pi)
            d = Vector((math.cos(b), math.sin(b), 0)) * 2 * r * 0.95
            self.card(cell, c - d * 0.5 + UP * h * 0.18, d, 2 * r * 0.9, centre=cc, up_bias=up_bias, droop=0.12, seg=2,
                      twist=rng.uniform(-0.3, 0.3))

    def finish(self, name):
        bm = self.bm
        if not bm.faces:
            F._card(bm, self.uvl, "vine", (0, 0, 0), (0, 0, -0.1), 0.05, seg=1)
            bm.verts.ensure_lookup_table()
            self.normals += [UP.copy()] * (len(bm.verts) - len(self.normals))
        normals = list(self.normals)
        ob = new_mesh_obj(name, bm)
        me = ob.data
        for p in me.polygons:
            p.use_smooth = True
        assert len(normals) == len(me.vertices), (name, len(normals), len(me.vertices))
        me.normals_split_custom_set_from_vertices([tuple(n) for n in normals])
        return ob


# ---------------------------------------------------------------- pieces
def jungle_bank(name, seed, length=16.0, height=1.0):
    """A wall of jungle behind a causeway wall, from the waterline (z = −2.2) up to ~7 m above the path.
    Spans y ∈ [−L/2, L/2]; faces −X (toward the path); x grows away from it."""
    rng = random.Random(seed)
    f = Fol()
    L = length
    # Back: tall rounded masses of canopy.
    y = -L / 2 + rng.uniform(0.5, 2.0)
    while y < L / 2 - 1.0:
        r = rng.uniform(1.9, 2.8) * height
        f.clump(rng, (rng.uniform(3.2, 6.0), y, rng.uniform(3.0, 6.0) * height), r, "cluster")
        if rng.random() < 0.5:
            f.clump(rng, (rng.uniform(4.0, 6.5), y + rng.uniform(-1, 1), rng.uniform(5.5, 8.0) * height), r * 0.8, "cluster")
        y += rng.uniform(2.6, 3.6)
    # Middle: broadleaf masses.
    y = -L / 2 + rng.uniform(0, 1.2)
    while y < L / 2 - 0.6:
        f.clump(rng, (rng.uniform(1.4, 3.0), y, rng.uniform(0.8, 2.4) * height), rng.uniform(1.2, 1.7), rng.choice(("broad", "broad", "cluster")))
        y += rng.uniform(1.8, 2.7)
    # Front: fine undergrowth down to the water.
    y = -L / 2 + rng.uniform(0, 1)
    while y < L / 2 - 0.4:
        f.clump(rng, (rng.uniform(0.0, 1.2), y, rng.uniform(-1.2, 0.2)), rng.uniform(0.7, 1.1), "cluster_s", top=rng.random() < 0.5)
        y += rng.uniform(1.3, 2.0)
    # Banana plants and ferns in front, vines out of the canopy.
    for k in range(rng.randint(2, 4)):
        _banana(f, rng, Vector((rng.uniform(0.2, 1.8), rng.uniform(-L / 2 + 1, L / 2 - 1), rng.uniform(-0.6, 0.4))), rng.uniform(0.9, 1.3))
    for k in range(rng.randint(3, 5)):
        _fern(f, rng, Vector((rng.uniform(-0.2, 0.8), rng.uniform(-L / 2, L / 2), rng.uniform(-1.4, -0.4))), rng.uniform(0.9, 1.4))
    for k in range(rng.randint(2, 3)):
        yy = rng.uniform(-L / 2 + 2, L / 2 - 2)
        w = rng.uniform(2.6, 3.6)
        hh = w * 0.5
        top = rng.uniform(2.6, 4.0) * height
        f.card("drape", (0.9, yy, top), (0, 0, -hh), w, normal=(-1, 0, 0), up_bias=0.3, up=Vector((-1, 0, 0)), seg=1, flip_v=True)
    return f.finish(name)


def _banana(f, rng, base, s=1.0):
    n = rng.randint(5, 7)
    a0 = rng.uniform(0, 6.28)
    c = base + UP * 1.0 * s
    for k in range(n):
        a = a0 + 2 * math.pi * k / n + rng.uniform(-0.3, 0.3)
        el = rng.uniform(0.35, 1.0)
        d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
        ln = rng.uniform(1.5, 2.3) * s
        p0 = base + UP * rng.uniform(0.5, 1.0) * s
        f.card("banana", p0, d * ln, ln * 0.5, centre=c - UP * 0.6 * s, up_bias=0.35, droop=rng.uniform(0.25, 0.55), seg=4,
               twist=rng.uniform(-0.35, 0.35))


def _fern(f, rng, base, s=1.0):
    n = rng.randint(6, 8)
    for k in range(n):
        a = 2 * math.pi * k / n + rng.uniform(-0.3, 0.3)
        el = rng.uniform(0.3, 0.9)
        d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
        ln = rng.uniform(0.8, 1.2) * s
        f.card("fern", base, d * ln, ln * 0.8, centre=base - UP * 0.3 * s, up_bias=0.6, droop=rng.uniform(0.3, 0.5), seg=3)


def banana(name, seed, s=1.0):
    rng = random.Random(seed)
    f = Fol()
    _banana(f, rng, Vector((0, 0, 0)), s)
    if rng.random() < 0.7:
        _banana(f, rng, Vector((rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8), 0)), s * 0.7)
    return f.finish(name)


def canopy(name, seed, reach=7.0, height=8.5):
    """A limb from the right bank (x ≈ 6) arching over the path to x ≈ −reach + 6, with leaf masses and
    hanging vines. Returns (limb, leaves). Origin at path level on the path's centre line."""
    rng = random.Random(seed)
    root = Vector((6.5, 0, -2.4))
    knee = Vector((5.6, rng.uniform(-0.5, 0.5), 3.5))
    crown = Vector((3.4, rng.uniform(-1, 1), height - 0.6))
    tip = Vector((6.0 - reach, rng.uniform(-1.5, 1.5), height + rng.uniform(-0.3, 0.6)))
    pts = []
    for i in range(13):
        t = i / 12
        # Quadratic through knee and crown, then out to the tip.
        if t < 0.5:
            u = t / 0.5
            p = (1 - u) ** 2 * root + 2 * (1 - u) * u * knee + u * u * crown
        else:
            u = (t - 0.5) / 0.5
            p = crown.lerp(tip, u) + UP * math.sin(u * math.pi) * 0.6
        pts.append(p)
    tb = bmesh.new()
    F._trunk(tb, pts, [0.62 * (1 - 0.75 * i / 12) + 0.25 * (1 - i / 12) ** 6 for i in range(13)], 9)
    # Side branches.
    for i in (7, 9, 11):
        a = pts[i]
        b = a + Vector((rng.uniform(-1.5, 0.5), rng.choice((-1, 1)) * rng.uniform(1.5, 2.8), rng.uniform(0.6, 1.6)))
        F._trunk(tb, [a, a.lerp(b, 0.5) + UP * 0.3, b], [0.16, 0.11, 0.05], 6)
    limb = new_mesh_obj(name + "_limb", tb)

    f = Fol()
    # The root's crown, a big mass on the bank.
    for k in range(3):
        f.clump(rng, (rng.uniform(5.5, 8.0), rng.uniform(-2.5, 2.5), rng.uniform(4.5, 7.5)), rng.uniform(2.0, 2.8), "cluster")
    # Masses along the arch, thinning to the tip.
    for i in range(6, 13):
        p = pts[i] + Vector((rng.uniform(-0.6, 0.6), rng.uniform(-1.6, 1.6), rng.uniform(0.3, 1.2)))
        r = rng.uniform(1.4, 2.2) * (1.15 - 0.35 * (i - 6) / 6)
        f.clump(rng, p, r, rng.choice(("cluster", "cluster", "broad")), squash=0.75)
    # Curtains hanging off the arch, facing the runner (−Y), and a few lone vines.
    for i in range(7, 13, 2):
        p = pts[i]
        w = rng.uniform(2.4, 3.4)
        hh = w * 0.5 * rng.uniform(1.0, 1.4)
        f.card("drape", p + Vector((0, rng.uniform(-0.8, 0.8), 0.6)), (0, 0, -hh), w, normal=(0, -1, 0), up_bias=0.25,
               up=Vector((0, -1, 0)), seg=1, flip_v=True)
    for k in range(5):
        p = pts[rng.randint(6, 12)] + Vector((rng.uniform(-0.5, 0.5), rng.uniform(-1, 1), 0))
        ln = rng.uniform(2.0, 3.6)
        f.card("vine", p, (rng.uniform(-0.1, 0.1), 0, -ln), ln * 0.45, normal=(0, -1, 0), up_bias=0.2, up=Vector((0, -1, 0)), seg=3,
               flip_v=True)
    return limb, f.finish(name)


def spill(name, seed, length=3.2):
    """Green tumbling over a wall crest: a fine mass on the crest and a curtain down its inner (−X) face.
    Origin on the crest's inner edge; spans y ∈ [0, length] like the wall pieces."""
    rng = random.Random(seed)
    f = Fol()
    y = rng.uniform(0.2, 0.6)
    while y < length - 0.3:
        f.clump(rng, (rng.uniform(0.1, 0.5), y, rng.uniform(0.15, 0.4)), rng.uniform(0.45, 0.7), rng.choice(("cluster_s", "broad")),
                top=True, up_bias=0.6)
        y += rng.uniform(0.9, 1.4)
    y0 = rng.uniform(0.0, 0.8)
    w = rng.uniform(1.8, length - y0)
    f.card("drape", (-0.08, y0 + w / 2, 0.45), (0, 0, -w * 0.5), w, normal=(-1, 0, 0.2), up_bias=0.3, up=Vector((-1, 0, 0)), seg=1,
           flip_v=True)
    return f.finish(name)


def bush(name, seed, radius=1.2, cells=("cluster_s", "broad"), n=3):
    rng = random.Random(seed)
    f = Fol()
    c0 = Vector((0, 0, radius * 0.45))
    for k in range(n):
        a = rng.uniform(0, 6.28)
        rr = radius * rng.uniform(0.0, 0.45)
        c = c0 + Vector((math.cos(a) * rr, math.sin(a) * rr, rng.uniform(-0.1, 0.25) * radius))
        f.clump(rng, c, radius * rng.uniform(0.55, 0.75), rng.choice(cells), centre=c0 - UP * radius * 0.3)
    for k in range(rng.randint(3, 5)):
        a = rng.uniform(0, 6.28)
        el = rng.uniform(0.2, 0.7)
        d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
        f.card(rng.choice(("fern", "broad")), Vector((0, 0, 0.1)), d * radius * rng.uniform(0.9, 1.2), radius * 0.8, centre=c0 - UP * radius * 0.4,
               droop=0.35, seg=3, twist=rng.uniform(-0.3, 0.3))
    return f.finish(name)


def fern(name, seed, s=1.0):
    rng = random.Random(seed)
    f = Fol()
    _fern(f, rng, Vector((0, 0, 0)), s * 0.8)
    return f.finish(name)


def shrub_mass(name, seed, w=4.0, h=1.8, d=2.4):
    rng = random.Random(seed)
    f = Fol()
    for k in range(int(4 + w)):
        a = rng.uniform(0, 6.28)
        rr = rng.uniform(0.2, 1.0)
        c = Vector((math.cos(a) * w / 2 * rr * 0.7, math.sin(a) * d / 2 * rr * 0.7, h * rng.uniform(0.35, 0.8) * (1.2 - 0.5 * rr)))
        f.clump(rng, c, rng.uniform(0.8, 1.2) * h * 0.65, rng.choice(("broad", "cluster_s", "cluster")), centre=(0, 0, -h * 0.2))
    _fern(f, rng, Vector((rng.uniform(-w / 3, w / 3), -d / 2.5, 0)), 0.9)
    return f.finish(name)


def palm_crown(name, seed, top, n=18):
    """Fronds arching out of the crown and drooping past it; a few dead ones hanging along the trunk."""
    rng = random.Random(seed)
    f = Fol()
    top = Vector(top)
    for k in range(n):
        a = 2 * math.pi * k / n + rng.uniform(-0.2, 0.2)
        young = k % 4 == 0
        el = rng.uniform(0.5, 0.95) if young else rng.uniform(-0.05, 0.45)
        d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
        ln = rng.uniform(3.4, 4.6) * (0.8 if young else 1)
        f.card("frond", top, d * ln, rng.uniform(1.7, 2.2), centre=top - UP * 1.2, up_bias=0.5,
               droop=rng.uniform(0.15, 0.3) if young else rng.uniform(0.45, 0.85), seg=7, twist=rng.uniform(-0.5, 0.5))
    for k in range(rng.randint(2, 4)):
        a = rng.uniform(0, 6.28)
        d = Vector((math.cos(a) * 0.25, math.sin(a) * 0.25, -1))
        f.card("frond", top + Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, -0.2)), d * rng.uniform(2.0, 2.8), 1.2, centre=top - UP * 3, up_bias=0.2,
               seg=3, twist=rng.uniform(-0.6, 0.6))
    return f.finish(name)


def tree_big(name, seed, height=14.0, spread=5.5):
    """A buttressed jungle tree forking into limbs, each carrying soft masses of leaves, vines hanging."""
    rng = random.Random(seed)
    tb = bmesh.new()
    lean = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.5
    # Forking low (the crown must come down into the shot from a low chase camera, not float above it).
    fork = Vector((0, 0, height * 0.36)) + lean
    pts = [lean * (i / 6) ** 2 + Vector((0, 0, height * 0.36 * i / 6)) for i in range(7)]
    F._trunk(tb, pts, [0.55 * (1 - 0.45 * i / 6) + 0.35 * (1 - i / 6) ** 5 for i in range(7)], 9)
    tips = []
    for k in range(rng.randint(3, 4)):
        a = 2 * math.pi * k / 4 + rng.uniform(-0.4, 0.4)
        tip = fork + Vector((math.cos(a) * spread * rng.uniform(0.5, 0.8), math.sin(a) * spread * rng.uniform(0.5, 0.8), height * rng.uniform(0.16, 0.3)))
        mid = fork.lerp(tip, 0.5) + Vector((0, 0, 0.6))
        F._trunk(tb, [fork, mid, tip], [0.28, 0.2, 0.1], 6)
        tips.append(tip)
    trunk = new_mesh_obj(name + "_trunk", tb)
    f = Fol()
    cc = fork + UP * height * 0.3
    for t in tips:
        for q in range(2):
            c = t + Vector((rng.uniform(-1.2, 1.2), rng.uniform(-1.2, 1.2), rng.uniform(-0.4, 1.2)))
            f.clump(rng, c, rng.uniform(2.0, 2.7), "cluster", squash=0.8, centre=cc.lerp(c, 0.5))
        # Lower masses hanging off each limb fill the space down toward the trunk's fork.
        c = fork.lerp(t, 0.7) + Vector((0, 0, -0.6))
        f.clump(rng, c, rng.uniform(1.4, 1.9), "broad", squash=0.8, centre=cc.lerp(c, 0.4))
    f.clump(rng, cc + UP * 1.0, rng.uniform(2.2, 2.8), "cluster", squash=0.8, centre=cc - UP)
    # Skirts of leaves hanging below the limbs, down toward the water.
    for t in tips:
        c = fork.lerp(t, 0.45) + Vector((rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8), -rng.uniform(1.0, 2.0)))
        f.clump(rng, c, rng.uniform(1.3, 1.8), rng.choice(("broad", "cluster_s")), squash=0.85, centre=cc.lerp(c, 0.3))
    for t in tips[:3]:
        w = rng.uniform(2.0, 3.0)
        dirv = Vector((t.x, t.y, 0)).normalized()
        side = Vector((-dirv.y, dirv.x, 0))
        f.card("drape", t - UP * 0.6, -UP * w * 0.5, w, normal=dirv, up_bias=0.2, up=dirv, seg=1, flip_v=True)
    return trunk, f.finish(name + "_crown")
