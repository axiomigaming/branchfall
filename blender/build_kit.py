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

from common import reset, bake_group, ensure_uvs_packed_weighted, export_glb, textured_material, OUT, CACHE
import kit_geo as K
import materials as M
import foliage as F
import setpieces as S
import stage as G
import jungle as J

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
          "relief": [], "cliff": [], "gold": [], "jungle": []}

# ---- stone A: walls
for i, (h, ruin) in enumerate([(1.3, 0.35), (1.6, 0.55), (1.15, 0.7), (1.8, 0.4)]):
    groups["stoneA"].append(K.wall(f"wall_low_{i}", 100 + i, height=h, ruin=ruin))
for i in range(2):
    groups["stoneA"].append(K.wall(f"wall_mid_{i}", 120 + i, height=2.6, ruin=0.45, depth=0.8))
for i in range(2):
    groups["stoneA"].append(K.wall(f"wall_tall_{i}", 140 + i, height=5.2, ruin=0.3, depth=1.0, tall=True))
# Ivy draped over the ragged crests of the low and mid walls (placed with the wall, same transform).
for i, o in enumerate(list(groups["stoneA"])):
    if o.name.startswith(("wall_low_", "wall_mid_")):
        groups["leaf"].append(F.wall_ivy(o.name + "_ivy", 1100 + i, K.CRESTS[o.name], depth=0.8 if "mid" in o.name else 0.7, density=0.85))
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
# ---- round 4: the vaulted tunnel, ruined facades and a lintel gate for the vanishing point, a lone column
groups["stoneB"] += [
    K.vault("vault_0", 1010),
    K.vault("vault_1", 1011),
    K.tunnel_mouth("tunnel_mouth_0", 1000),
    K.facade("facade_0", 1030),
    K.facade("facade_1", 1031, width=8.0, height=11.0, windows=1),
    K.lintel_gate("lintel_gate_0", 1020),
    K.column_lone("column_lone_0", 1040),
]

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
# Rubble strewn along the wall feet and, sparser and flatter, across the path (no shadows; see track.ts).
groups["floor"] += [K.scatter(f"scatter_edge_{i}", 980 + i, n=40 + 8 * i, shards=8 + 2 * i, chunks=2 + i) for i in range(3)]
groups["floor"] += [K.scatter(f"scatter_path_{i}", 990 + i, width=4.0, n=14 + 6 * i, shards=4 + 2 * i, chunks=0, low=True) for i in range(2)]

# ---- rocks
for i in range(3):
    groups["rock"].append(K.rock_obj(f"rock_big_{i}", 400 + i, size=(12, 9, 18), detail=5))
for i in range(3):
    groups["rock"].append(K.rock_obj(f"rock_mid_{i}", 410 + i, size=(3.2, 2.6, 2.4), detail=4))

# ---- wood
groups["wood"] += [K.planks("planks_0", 500), K.planks("planks_1", 501), S.rope_rail("rope_rail_0", 510, width=3.6)]
groups["bark"] += [S.roots("roots_0", 520), S.roots("roots_1", 521, width=4.5, n=10, length=(2.0, 4.5))]
groups["flora"] += [
    S.lily_pads("lily_0", 800),
    S.lily_pads("lily_1", 801, n=20, spread=2.4, flowers=3),
    S.lily_pads("lily_2", 802, n=7, spread=1.0, flowers=1),
    S.moss_clump("moss_0", 810),
    S.moss_clump("moss_1", 811, radius=0.9, n=7),
    S.moss_clump("moss_2", 812, radius=0.4, n=3),
]

# ---- foliage: palms (drooping crowns built as clumps), bushes, grass, vines, ferns
for i in range(3):
    t, c = F.palm(f"palm_{i}", 600 + i, height=8 + i * 2.2)
    groups["bark"].append(t)
    me = t.data
    zmax = max(v.co.z for v in me.vertices)
    ring = [v.co for v in me.vertices if v.co.z > zmax - 0.05]
    top = sum(ring, Vector()) / len(ring)
    bpy.data.objects.remove(c)
    groups["jungle"].append(J.palm_crown(f"palm_{i}_crown", 605 + i, top))
for i in range(2):
    t, c = F.jungle_tree(f"jungle_{i}", 620 + i, height=11 + i * 3)
    groups["bark"].append(t)
    groups["leaf"].append(c)
for i in range(4):
    groups["jungle"].append(J.bush(f"bush_{i}", 640 + i, radius=0.9 + 0.35 * i, cells=("cluster_s", "broad") if i % 2 else ("cluster_s",), n=2 + i // 2))
for i in range(2):
    groups["leaf"].append(F.grass(f"grass_{i}", 660 + i, n=4 + 3 * i))
for i in range(2):
    groups["leaf"].append(F.vines(f"vines_{i}", 680 + i, width=4.0 + 2 * i, n=6 + 3 * i))
groups["leaf"].append(F.vines("vines_2", 682, width=5.0, n=12, length=(2.2, 5.0)))
# Ferns that sprout from the joints of walls and floors.
groups["jungle"].append(J.fern("fern_0", 690, 0.75))
groups["jungle"].append(J.fern("fern_1", 691, 1.0))
# ---- round 5 jungle: banks of jungle, limbs over the path, banana plants, green spilling over walls
for i in range(3):
    groups["jungle"].append(J.jungle_bank(f"jungle_bank_{i}", 1200 + i, height=1.0 + 0.15 * i))
for i in range(2):
    limb, leaves = J.canopy(f"canopy_{i}", 1210 + i, reach=7.0 + 1.2 * i, height=8.0 + 1.0 * i)
    groups["bark"].append(limb)
    groups["jungle"].append(leaves)
for i in range(2):
    groups["jungle"].append(J.banana(f"banana_{i}", 1220 + i, s=1.0 + 0.2 * i))
for i in range(2):
    groups["jungle"].append(J.spill(f"spill_{i}", 1230 + i, length=3.2 + 0.6 * i))

# ---- round 3 stage: cliffs that close in on the path, temples, a golden face gate, big trees
for i, (h, ln) in enumerate([(18, 24), (23, 24), (27, 28)]):
    r, v, t = G.cliff_set(f"cliff_wall_{i}", 900 + i, length=ln, height=h)
    groups["cliff"].append(r)
    groups["leaf"].append(v)
    groups["bark"].append(t)
# Temples share the statuary atlas (mid-distance pieces; packed tight, there is room).
groups["statue"] += [G.temple_prang("temple_0", 930), G.temple_pagoda("temple_1", 931)]
s_, g_ = G.face_gate("face_gate_0", 950)
groups["statue"].append(s_)
groups["gold"].append(g_)
s_, g_ = G.idol("idol_0", 940)
groups["statue"].append(s_)
groups["gold"].append(g_)
for i in range(2):
    t, c = J.tree_big(f"tree_big_{i}", 920 + i, height=13 + 3 * i)
    groups["bark"].append(t)
    groups["jungle"].append(c)
    groups["jungle"].append(J.shrub_mass(f"shrub_mass_{i}", 925 + i, w=3.5 + 1.5 * i, h=1.5 + 0.6 * i))
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
    "gold": (M.gold("gold"), 1024),
}
# The gate and stelae carry carved glyphs: give them their own small atlas.
glyph_objs = [o for o in groups["stoneB"] if o.name.startswith(("gate_", "stele_"))]
groups["stoneB"] = [o for o in groups["stoneB"] if o not in glyph_objs]
groups["glyph"] = glyph_objs + groups.pop("relief")
mats["glyph"] = (M.stone("glyph", moss=0.35, glyphs=True), 2048)

# KIT_REUSE=<dir> (with KIT_REUSE_GROUPS=a,b,…): for groups whose pieces and materials did not change,
# lay out the UVs exactly as a full bake does (packing is deterministic) and take the atlases from a
# previous full bake (tools/kit-atlases.mjs extracts them) instead of re-baking: hours on a shared CPU.
REUSE = os.environ.get("KIT_REUSE")
REUSE_GROUPS = set(filter(None, os.environ.get("KIT_REUSE_GROUPS", "").split(",")))


def reuse_group(objs, key):
    imgs = []
    for k, cs in (("color", "sRGB"), ("normal", "Non-Color"), ("orm", "Non-Color")):
        im = bpy.data.images.load(os.path.join(REUSE, f"{key}_{k}.png"))
        im.colorspace_settings.name = cs
        im.name = f"{key}_{k}"
        imgs.append(im)
    pbr = textured_material(key, *imgs)
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(pbr)


for key, (mat, size) in mats.items():
    objs = groups[key]
    if not objs:
        continue
    reuse = bool(REUSE) and key in REUSE_GROUPS and not FAST
    log(f"uv + {'reuse' if reuse else 'bake'} {key} ({len(objs)} objects, {size // Q}px)")
    # Margins in texels of the shipped (optimized, halved) atlas stay at 3–4 px.
    ensure_uvs_packed_weighted(objs, size // Q, margin_px=max(2, (8 if size >= 4096 else 6 if size >= 2048 else 4) // Q))
    if reuse:
        reuse_group(objs, key)
        continue
    bake_group(objs, mat, key, size // Q, ao_samples=6 if FAST else 20, ao_strength=0.6 if key != "rock" else 0.7)

leaf_mat = textured_material("leaf", leaf_img, None, None, alpha=True)
for o in groups["leaf"]:
    o.data.materials.clear()
    o.data.materials.append(leaf_mat)
# Round 5 clumps carry authored normals: a material of their own keeps the loader from rebuilding
# them (track.ts merges them back into the `leaf` draw calls). Same image, so no extra bytes.
jungle_mat = textured_material("leaf_jungle", leaf_img, None, None, alpha=True)
# A glTF-visible difference, or the optimizer's dedup() folds it into M_leaf (and the loader then
# rebuilds the clumps' normals). The runtime never reads this roughness (track.ts restyles the leaves).
next(n for n in jungle_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Roughness"].default_value = 0.8
for o in groups["jungle"]:
    o.data.materials.clear()
    o.data.materials.append(jungle_mat)

for o in all_objs:
    o.location = (0, 0, 0)

export_glb(os.environ.get("KIT_OUT", os.path.join(OUT, "kit.glb")), all_objs, quality=82)
log("done")
