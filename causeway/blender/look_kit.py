"""Look-dev: build a representative set of pieces and render a preview (no bake)."""
import sys, math
sys.path.insert(0, __import__('os').path.dirname(__file__))
from common import reset, preview, CACHE
import kit_geo as K
import materials as M

reset()
st, fl, rk = M.stone(), M.floor(), M.rock()
objs = []
for i in range(3):
    f = K.floor(f"floor{i}", 10 + i, broken=0.0 if i < 2 else 0.5); f.location.y = i * 4; f.data.materials.append(fl)
    for side in (-1, 1):
        w = K.wall(f"wall{i}{side}", 20 + i * 2 + (side > 0), height=1.5 + 0.4 * (i % 2), ruin=0.5)
        w.location = (side * (2.2 + 0.36), i * 4, 0); w.data.materials.append(st)
a = K.arch("arch", 3); a.location = (0, 16, 0); a.data.materials.append(st)
p = K.pillar("pillar", 4); p.location = (-4.5, 10, 0); p.data.materials.append(st)
r = K.rock_obj("rock", 5); r.location = (7, 14, 2); r.data.materials.append(rk)
t = K.tower("tower", 6); t.location = (-9, 26, 0); t.data.materials.append(st)
g = K.slab_gate("gate", 7); g.location = (6, 6, 0); g.rotation_euler.z = 0.4; g.data.materials.append(st)
preview(f"{CACHE}/look_kit.png", (0.6, -3.2, 2.1), (0, 8, 0.9), lens=24, sun=(24, 0, 160), samples=16)
