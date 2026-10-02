"""UV overlap check for baked atlases: texels covered by more than one face of a group.

    python3 blender/uvcheck.py public/assets/kit.glb [res]      (report per material)

build_kit.py calls `overlap_texels(objs, res)` after packing and refuses to bake an overlapping group:
two faces sharing texels get one bake, so one of them shows the other's albedo (round 5: a dark,
mossy patch from floor_0 printed on every floor_wide_0 slab beside the lane).
"""
import json
import struct
import sys

import numpy as np


def raster_count(tris, res):
    """tris: (n, 3, 2) UVs in [0, 1]. Returns (res, res) face-coverage counts at texel centres."""
    count = np.zeros((res, res), np.int32)
    t = tris * res - 0.5  # texel centres at integers
    for a, b, c in t:
        x0 = int(max(0, np.floor(min(a[0], b[0], c[0])))); x1 = int(min(res - 1, np.ceil(max(a[0], b[0], c[0]))))
        y0 = int(max(0, np.floor(min(a[1], b[1], c[1])))); y1 = int(min(res - 1, np.ceil(max(a[1], b[1], c[1]))))
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        l3 = 1 - l1 - l2
        e = 1e-6
        inside = (l1 > e) & (l2 > e) & (l3 > e)
        count[ys[inside], xs[inside]] += 1
    return count


def overlap_texels(objs, res=512):
    """Texels shared by two faces among Blender objects `objs` (their active UV layers)."""
    tris = []
    for o in objs:
        me = o.data
        uv = np.zeros(len(me.loops) * 2, np.float32)
        me.uv_layers.active.data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)
        me.calc_loop_triangles()
        lt = np.zeros(len(me.loop_triangles) * 3, np.int32)
        me.loop_triangles.foreach_get("loops", lt)
        tris.append(uv[lt.reshape(-1, 3)])
    if not tris:
        return 0
    return int((raster_count(np.concatenate(tris), res) > 1).sum())


def _glb(fn):
    b = open(fn, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    js = json.loads(b[20:20 + n])
    start = 20 + n + 8

    def acc(i):
        a = js["accessors"][i]
        bv = js["bufferViews"][a["bufferView"]]
        k = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
        dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a["componentType"]]
        arr = np.frombuffer(b, dtype=dt, count=a["count"] * k, offset=start + bv.get("byteOffset", 0) + a.get("byteOffset", 0))
        return arr.reshape(a["count"], k) if k > 1 else arr

    return js, acc


if __name__ == "__main__":
    fn = sys.argv[1]
    res = int(sys.argv[2]) if len(sys.argv) > 2 else 512
    js, acc = _glb(fn)
    by = {}
    for m in js["meshes"]:
        for p in m["primitives"]:
            mat = js["materials"][p["material"]]["name"]
            if "leaf" in mat:
                continue  # cards share their atlas cells by design
            uv = acc(p["attributes"]["TEXCOORD_0"]).astype(np.float64)
            idx = acc(p["indices"]).reshape(-1, 3)
            uv = uv.copy()
            uv[:, 1] = 1 - uv[:, 1]  # glTF v is flipped
            by.setdefault(mat, []).append(uv[idx])
    bad = 0
    for mat, tris in sorted(by.items()):
        c = raster_count(np.concatenate(tris), res)
        n = int((c > 1).sum())
        bad += n
        print(f"{mat:12s} overlapping texels {n:6d} of {int((c > 0).sum()):7d} covered")
    sys.exit(1 if bad else 0)
