"""Build, bake and export the CAUSEWAY environment kit → public/assets/kit.glb.

    python3 blender/build_kit.py [--fast]

--fast bakes at quarter resolution with few AO samples (look-dev only).
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector

from common import reset, bake_group, ensure_uvs, export_glb, textured_material, OUT, CACHE
import kit_geo as K
import materials as M
import foliage as F
import setpieces as S
import stage as G

FAST = "--fast" in sys.argv
Q = 4 if FAST else 1
T0 = time.time()


def log(*a):
    print(f"[kit {time.time() - T0:6.1f}s]", *a, flush=True)


reset()
# Leaves are rendered first, while the scene is still empty.
log("rendering foliage atlas")
leaf_img = F.render_atlas(2048 // (2 if FAST else 1))

groups = {"stoneA": [], "stoneB": [], "floor": [], "rock": [], "wood": [], "bark": [], "leaf": [], "statue": [], "flora": [],
          "relief": [], "cliff": [], "temple": [], "gold": []}

# ---- stone A: walls
for i, (h, ruin) in enumerate([(1.3, 0.35), (1.6, 0.55), (1.15, 0.7), (1.8, 0.4)]):
    groups["stoneA"].append(K.wall(f"wall_low_{i}", 100 + i, height=h, ruin=ruin))
for i in range(2):
    groups["stoneA"].append(K.wall(f"wall_mid_{i}", 120 + i, height=2.6, ruin=0.45, depth=0.8))
for i in range(2):
    groups["stoneA"].append(K.wall(f"wall_tall_{i}", 140 + i, height=5.2, ruin=0.3, depth=1.0, tall=True))
groups["stoneA"].append(K.foundation("foundation_0", 160))
groups["stoneA"].append(K.foundation("foundation_1", 161, height=4.0))

# ---- stone B: architecture
groups["stoneB"] += [
    K.pillar("pillar_0", 200, height=5.0),
    K.pillar("pillar_1", 201, height=5.0, broken=True),
    K.pillar("pillar_2", 202, height=3.0, broken=True),
    K.arch("arch_0", 210),
    K.arch("arch_1", 211, span=7.2, pier_h=4.6),
    K.stairs("stairs_0", 220),
    K.slab_gate("gate_0", 230),
    K.stele("stele_0", 240),
    K.stele("stele_1", 241, w=1.1, h=2.4),
    K.drum("drum_0", 250),
    K.tower("tower_0", 260),
    K.tower("tower_1", 261, w=3.4, h=14),
]
for i in range(4):
    groups["stoneB"].append(K.rubble(f"rubble_{i}", 270 + i, n=4 + i * 2, spread=0.6 + 0.4 * i))
groups["stoneB"].append(K.rubble("debris_0", 290, n=1, spread=0, size=(0.5, 0.5)))

# ---- statuary and set pieces (their own atlas, so the faces get texels)
groups["statue"] += [
    S.colossal_head("head_0", 700, size=1.9),
    S.colossal_head("head_1", 701, size=2.5),
    S.guardian("guardian_0", 710),
    S.guardian("guardian_1", 711, broken=True),
    S.fallen_column("column_fallen_0", 720),
    S.fallen_column("column_fallen_1", 721, radius=0.6, n=4),
    S.stepping_stones("steps_water_0", 730),
]
groups["relief"] += [S.relief_wall("relief_wall_0", 740), S.relief_wall("relief_wall_1", 741)]

# ---- floors
groups["floor"] += [
    K.floor("floor_0", 300),
    K.floor("floor_1", 301),
    K.floor("floor_2", 302, broken=0.5),
    K.floor("floor_wide_0", 303, width=10.0, length=8.0),
    K.floor("floor_narrow_0", 304, width=3.0),
]

# ---- rocks
for i in range(3):
    groups["rock"].append(K.rock_obj(f"rock_big_{i}", 400 + i, size=(12, 9, 18), detail=5))
for i in range(3):
    groups["rock"].append(K.rock_obj(f"rock_mid_{i}", 410 + i, size=(3.2, 2.6, 2.4), detail=4))

# ---- wood
groups["wood"] += [K.planks("planks_0", 500), K.planks("planks_1", 501), S.rope_rail("rope_rail_0", 510)]
groups["bark"] += [S.roots("roots_0", 520), S.roots("roots_1", 521, width=4.5, n=10, length=(2.0, 4.5))]
groups["flora"] += [
    S.lily_pads("lily_0", 800),
    S.lily_pads("lily_1", 801, n=20, spread=2.4, flowers=3),
    S.lily_pads("lily_2", 802, n=7, spread=1.0, flowers=1),
    S.moss_clump("moss_0", 810),
    S.moss_clump("moss_1", 811, radius=0.9, n=7),
    S.moss_clump("moss_2", 812, radius=0.4, n=3),
]

# ---- foliage cards
for i in range(3):
    t, c = F.palm(f"palm_{i}", 600 + i, height=8 + i * 2.2)
    groups["bark"].append(t)
    groups["leaf"].append(c)
for i in range(2):
    t, c = F.jungle_tree(f"jungle_{i}", 620 + i, height=11 + i * 3)
    groups["bark"].append(t)
    groups["leaf"].append(c)
for i in range(4):
    groups["leaf"].append(F.bush(f"bush_{i}", 640 + i, radius=0.9 + 0.35 * i, cells=("fern", "broad") if i % 2 else ("fern",)))
for i in range(2):
    groups["leaf"].append(F.grass(f"grass_{i}", 660 + i, n=4 + 3 * i))
for i in range(2):
    groups["leaf"].append(F.vines(f"vines_{i}", 680 + i, width=4.0 + 2 * i, n=6 + 3 * i))
groups["leaf"].append(F.vines("vines_2", 682, width=5.0, n=12, length=(2.2, 5.0)))
# Ferns that sprout from the joints of walls and floors.
groups["leaf"].append(F.bush("fern_0", 690, radius=0.6, cells=("fern",), n=8))
groups["leaf"].append(F.bush("fern_1", 691, radius=0.85, cells=("fern", "broad"), n=10))

# ---- round 3 stage: cliffs that close in on the path, temples, a golden face gate, big trees
for i, (h, ln) in enumerate([(18, 24), (23, 24), (27, 28)]):
    r, v, t = G.cliff_set(f"cliff_wall_{i}", 900 + i, length=ln, height=h)
    groups["cliff"].append(r)
    groups["leaf"].append(v)
    groups["bark"].append(t)
groups["temple"] += [G.temple_prang("temple_0", 930), G.temple_pagoda("temple_1", 931)]
s_, g_ = G.face_gate("face_gate_0", 950)
groups["temple"].append(s_)
groups["gold"].append(g_)
s_, g_ = G.idol("idol_0", 940)
groups["temple"].append(s_)
groups["gold"].append(g_)
for i in range(2):
    t, c = G.tree_big(f"tree_big_{i}", 920 + i, height=13 + 3 * i)
    groups["bark"].append(t)
    groups["leaf"].append(c)
    groups["leaf"].append(G.shrub_mass(f"shrub_mass_{i}", 925 + i, w=3.5 + 1.5 * i, h=1.5 + 0.6 * i, n=28 + 10 * i))
groups["floor"].append(G.floor_medallion("floor_medallion_0", 960))

# Spread pieces out so baked AO only sees each piece itself.
all_objs = [o for g in groups.values() for o in g]
for i, o in enumerate(all_objs):
    o.location = Vector(((i % 8) * 40.0, (i // 8) * 40.0, 0))

mats = {
    "stoneA": (M.stone("stoneA", moss=0.7), 4096),
    "stoneB": (M.stone("stoneB", moss=0.45, glyphs=False), 4096),
    "floor": (M.floor("floor"), 4096),
    "rock": (M.rock("rock"), 2048),
    "wood": (M.wood("wood"), 1024),
    "bark": (M.bark("bark"), 1024),
    "statue": (M.stone("statue", moss=0.5, glyphs=False), 2048),
    "flora": (M.flora("flora"), 1024),
    "cliff": (M.cliff("cliff"), 2048),
    "temple": (M.stone("temple", moss=0.55, glyphs=True), 2048),
    "gold": (M.gold("gold"), 1024),
}
# The gate and stelae carry carved glyphs: give them their own small atlas.
glyph_objs = [o for o in groups["stoneB"] if o.name.startswith(("gate_", "stele_"))]
groups["stoneB"] = [o for o in groups["stoneB"] if o not in glyph_objs]
groups["glyph"] = glyph_objs + groups.pop("relief")
mats["glyph"] = (M.stone("glyph", moss=0.35, glyphs=True), 2048)

for key, (mat, size) in mats.items():
    objs = groups[key]
    if not objs:
        continue
    log(f"uv + bake {key} ({len(objs)} objects, {size // Q}px)")
    ensure_uvs(objs, margin=0.004 if size >= 4096 else 0.006)
    bake_group(objs, mat, key, size // Q, ao_samples=6 if FAST else 20, ao_strength=0.6 if key != "rock" else 0.7)

leaf_mat = textured_material("leaf", leaf_img, None, None, alpha=True)
for o in groups["leaf"]:
    o.data.materials.clear()
    o.data.materials.append(leaf_mat)

for o in all_objs:
    o.location = (0, 0, 0)

export_glb(os.path.join(OUT, "kit.glb"), all_objs, quality=82)
log("done")
