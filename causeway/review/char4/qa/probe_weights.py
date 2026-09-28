"""Find vertices that the sprint pose throws far from their rest neighbours (skinning leaks)."""
import sys
import bpy
import numpy as np
glb = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene
rig = next(o for o in sc.objects if o.type == "ARMATURE")
me_ob = next(o for o in sc.objects if o.type == "MESH")
act = next(a for a in bpy.data.actions if a.name.startswith("sprint"))
rig.animation_data.action = act
f0, f1 = act.frame_range
sc.frame_set(int(f0 + (f1 - f0) * 2 / 8))
dg = bpy.context.evaluated_depsgraph_get()
ev = me_ob.evaluated_get(dg)
rest = np.array([v.co[:] for v in me_ob.data.vertices])
posed = np.array([v.co[:] for v in ev.data.vertices])
# Compare each edge's length rest vs posed.
edges = np.array([e.vertices[:] for e in me_ob.data.edges])
lr = np.linalg.norm(rest[edges[:, 0]] - rest[edges[:, 1]], axis=1)
lp = np.linalg.norm(posed[edges[:, 0]] - posed[edges[:, 1]], axis=1)
bad = np.where(lp > lr * 3 + 0.02)[0]
vs = set(edges[bad].ravel().tolist())
print("stretched edges", len(bad), "verts", len(vs))
names = {g.index: g.name for g in me_ob.vertex_groups}
from collections import Counter
cnt = Counter()
for i in list(vs)[:4000]:
    v = me_ob.data.vertices[i]
    top = max(v.groups, key=lambda g: g.weight) if v.groups else None
    cnt[names[top.group] if top else None] += 1
print(cnt.most_common(12))
for i in list(vs)[:15]:
    v = me_ob.data.vertices[i]
    print([round(c, 3) for c in v.co], sorted(((names[g.group], round(g.weight, 2)) for g in v.groups), key=lambda x: -x[1]))
