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

FAST = "--fast" in sys.argv
Q = 4 if FAST else 1
T0 = time.time()


def log(*a):
    print(f"[kit {time.time() - T0:6.1f}s]", *a, flush=True)


reset()
# Leaves are rendered first, while the scene is still empty.
log("rendering foliage atlas")
leaf_img = F.render_atlas(2048 // (2 if FAST else 1))

groups = {"stoneA": [], "stoneB": [], "floor": [], "rock": [], "wood": [], "bark": [], "leaf": []}

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
groups["wood"] += [K.planks("planks_0", 500), K.planks("planks_1", 501)]

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

# Spread pieces out so baked AO only sees each piece itself.
all_objs = [o for g in groups.values() for o in g]
for i, o in enumerate(all_objs):
    o.location = Vector(((i % 8) * 40.0, (i // 8) * 40.0, 0))

mats = {
    "stoneA": (M.stone("stoneA", moss=0.6), 4096),
    "stoneB": (M.stone("stoneB", moss=0.45, glyphs=False), 4096),
    "floor": (M.floor("floor"), 4096),
    "rock": (M.rock("rock"), 2048),
    "wood": (M.wood("wood"), 1024),
    "bark": (M.bark("bark"), 1024),
}
# The gate and stelae carry carved glyphs: give them their own small atlas.
glyph_objs = [o for o in groups["stoneB"] if o.name.startswith(("gate_", "stele_"))]
groups["stoneB"] = [o for o in groups["stoneB"] if o not in glyph_objs]
groups["glyph"] = glyph_objs
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
