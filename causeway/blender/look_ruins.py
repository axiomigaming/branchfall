"""Look-dev (round 4): weathered walls, worn floors, scatter; the tunnel, facades and lintel gate.

    python3 blender/look_ruins.py [walls|tunnel|avenue|board] …   (no bake; procedural materials)
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from common import reset, preview, CACHE
import kit_geo as K
import materials as M

which = [a for a in sys.argv[1:] if not a.startswith("-")] or ["walls"]
T0 = time.time()


def put(ob, mat, loc, rz=0.0):
    ob.location = loc
    ob.rotation_euler.z = rz
    ob.data.materials.append(mat)
    return ob


def tris(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


for w in which:
    reset()
    st, fl, sb = M.stone("stoneA", moss=0.7), M.floor(), M.stone("stoneB", moss=0.45)
    objs = []
    if w == "walls":
        for i in range(4):
            objs.append(put(K.floor(f"floor{i}", 300 + i, broken=0.5 if i == 2 else 0.0), fl, (0, i * 4, 0)))
            for side in (-1, 1):
                h, ruin = [(1.3, 0.35), (1.6, 0.55), (1.15, 0.7), (1.8, 0.4)][(i + (side > 0)) % 4]
                objs.append(put(K.wall(f"wall{i}{side}", 100 + (i + (side > 0)) % 4, height=h, ruin=ruin), st, (side * (2.2 + 0.36), i * 4, 0)))
                objs.append(put(K.scatter(f"sc{i}{side}", 980 + i, n=45), fl, (side * (2.2 - 0.45), i * 4, 0), 0 if side > 0 else 3.14159))
        objs.append(put(K.pillar("pillar", 201, height=5.0, broken=True), sb, (-4.2, 9, 0)))
        objs.append(put(K.rubble("rubble", 273, n=10, spread=1.8), sb, (3.8, 13, 0)))
        print("tris", tris(objs), "walls", [tris([o]) for o in objs if o.name.startswith("wall")][:4], "floor", tris([objs[0]]))
        preview(f"{CACHE}/look_ruins_walls.png", (0.4, -3.4, 1.9), (0, 8, 0.7), lens=24, sun=(28, 0, 150), samples=12)
        preview(f"{CACHE}/look_ruins_walls_close.png", (1.2, 0.6, 1.2), (2.6, 3.4, 0.6), lens=28, sun=(28, 0, 150), samples=12)
    elif w == "tunnel":
        for i in range(4):
            objs.append(put(K.floor(f"floor{i}", 300 + i), fl, (0, i * 4, 0)))
        objs.append(put(K.tunnel_mouth("mouth", 1000), sb, (0, 0, 0)))
        for i in range(3):
            objs.append(put(K.vault(f"vault{i}", 1010 + i % 2), sb, (0, 1.6 + i * 4, 0)))
        print("tris", tris(objs), [(o.name, tris([o])) for o in objs])
        preview(f"{CACHE}/look_ruins_tunnel.png", (1.0, -9.0, 2.6), (0, 6, 3.0), lens=26, sun=(40, 0, 200), samples=12)
        preview(f"{CACHE}/look_ruins_tunnel_in.png", (0.4, 3.0, 2.2), (0, 14, 1.8), lens=24, sun=(40, 0, 200), samples=12)
    elif w == "avenue":
        for i in range(5):
            objs.append(put(K.floor(f"floor{i}", 300 + i), fl, (0, i * 4, 0)))
        objs.append(put(K.lintel_gate("lintel", 1020), sb, (0, 20, 0)))
        objs.append(put(K.facade("facadeL", 1030), sb, (-8.5, 24, 0), 0.25))
        objs.append(put(K.facade("facadeR", 1031, width=8, height=11, windows=1), sb, (8.5, 25, 0), -0.3))
        objs.append(put(K.column_lone("col", 1040), sb, (-5.5, 30, 0)))
        print("tris", tris(objs), [(o.name, tris([o])) for o in objs])
        preview(f"{CACHE}/look_ruins_avenue.png", (0.3, -3.0, 2.4), (0, 20, 3.5), lens=24, sun=(30, 0, 150), samples=12)
    elif w == "board":
        wd = M.wood()
        for i in range(4):
            objs.append(put(K.planks(f"pl{i}", 500 + i % 2), wd, (0, i * 4, 0)))
        print("tris", tris(objs), [(o.name, tris([o])) for o in objs])
        preview(f"{CACHE}/look_ruins_board.png", (0.3, -2.8, 1.8), (0, 8, 0.0), lens=24, sun=(30, 0, 150), samples=12)
    print(w, "done", round(time.time() - T0), "s", flush=True)
