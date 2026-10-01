"""Numbers for the gait clips (run, sprint, dash) on the built runner — the checklist of a sprint coach.

    python3 blender/qa_gait_audit.py            (needs blender/cache/runner_src_model.blend: build first)

Per gait, sampled at 120 phases of one stride cycle, with the floor moving back at S m/cycle as it
does at runtime (cadence = speed / S):
  skate      worst drift (cm) of a planted sole vertex against the moving floor, and its float/sink
  contact    duty factor (fraction of the cycle a foot is down) and the flight fraction
  strike     foot pitch at touchdown (+ toes up = heel strike, − = forefoot) and the strike point ahead of
             the hip (overstriding reads as braking)
  knee drive peak thigh angle above vertical in swing; heel recovery (min knee angle in swing)
  pelvis     vertical travel of the hips (cm), pelvis yaw/roll range, chest counter-rotation
  arms       hand travel fore/aft of the hip (cm), worst crossing of the midline (cm), elbow range
  head       pitch and height wobble (stability)
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
import numpy as np
from mathutils import Vector

from common import CACHE

bpy.ops.wm.open_mainfile(filepath=os.path.join(CACHE, "runner_src_model.blend"))
rig = bpy.data.objects["runner"]
mesh = bpy.data.objects["runner_mesh"]
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
import runner_anim as A  # noqa: E402

A.build(rig)
sc = bpy.context.scene
names = {g.index: g.name for g in mesh.vertex_groups}
sole = {"L": [], "R": []}
for v in mesh.data.vertices:
    if v.co.z < 0.03:
        for ge in v.groups:
            n = names[ge.group]
            if n.startswith(("foot.", "toe.")) and ge.weight > 0.5:
                sole[n[-1]].append(v.index)
                break
N = 120
for s_ in "LR":
    pts = np.array([mesh.data.vertices[k].co[:] for k in sole[s_]])
    ank = rig.data.bones[f"foot.{s_}"].head_local
    print(f"rest sole {s_}: ankle z {ank.z:.3f}; sole z min {pts[:, 2].min():.4f}; y {pts[:, 1].min() - ank.y:+.3f} … {pts[:, 1].max() - ank.y:+.3f} from the ankle")
    for y0 in np.arange(-0.1, 0.26, 0.03):
        q = pts[np.abs(pts[:, 1] - ank.y - y0) < 0.015]
        if len(q):
            print(f"   y {y0:+.2f}: bottom z {q[:, 2].min() - ank.z:+.3f}")
which = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["run", "sprint", "dash"]
for g in which:
    G = {"run": A.RUN, "sprint": A.SPRINT, "dash": A.DASH}[g]
    S = G["D"] / G["ts"]
    act = bpy.data.actions[g]
    rig.animation_data.action = act
    f0, f1 = act.frame_range
    rows = []
    for i in range(N + 1):
        t = i / N
        fr = f0 + t * (f1 - f0)
        sc.frame_set(int(fr), subframe=fr - int(fr))
        dg = bpy.context.evaluated_depsgraph_get()
        ev = mesh.evaluated_get(dg)
        co = np.array([ev.data.vertices[k].co[:] for s in "LR" for k in sole[s]])
        nL = len(sole["L"])
        pb = rig.pose.bones
        W = lambda n, tail=False: rig.matrix_world @ (pb[n].tail if tail else pb[n].head)
        rows.append(dict(t=t, L=co[:nL], R=co[nL:], hip=W("hips"), head=W("head", True), neck=W("head"),
                         handL=W("hand.L", True), handR=W("hand.R", True), sh=(W("upper_arm.L"), W("upper_arm.R")),
                         hp=(W("thigh.L"), W("thigh.R")), knee=(W("shin.L"), W("shin.R")), ank=(W("foot.L"), W("foot.R")),
                         ball=(W("toe.L"), W("toe.R")), elbow=(pb["forearm.L"].rotation_euler.x, pb["forearm.R"].rotation_euler.x),
                         pel=pb["hips"].rotation_euler.copy(), chest=(pb["spine"].rotation_euler.y + pb["chest"].rotation_euler.y)))
    print(f"\n== {g}: S = {S:.3f} m/cycle, ts = {G['ts']}, D = {G['D']}")
    for s, k in (("L", 0), ("R", 1)):
        down = []
        worst = 0.0
        sink = 0.0
        acc = 0.0
        prev = None
        landed = 0
        for r in rows:
            c = r[s]
            zmin = c[:, 2].min()
            on = zmin < 0.004
            down.append(on)
            if on and os.environ.get("DBG") and s == "L":
                j = int(np.argmin(c[:, 2]))
                print(f"     t {r['t']:.3f} zmin {zmin*100:+.2f} lowest y+St {(c[j,1] + S * r['t'])*100:+.1f} vert {sole['L'][j]} acc {acc*100:+.2f}")
            if on:
                sink = min(sink, float(zmin))
                if prev is not None and landed >= 2:
                    # Vertices bearing load now and a sample ago should move back exactly with the floor.
                    m = (c[:, 2] < zmin + 0.006) & (prev[:, 2] < prev[:, 2].min() + 0.006)
                    if m.any():
                        slip = float(np.mean(c[m, 1] - prev[m, 1])) + S / N
                        acc += slip
                        worst = max(worst, abs(acc))
                prev = c
                landed += 1
            else:
                prev = None
                acc = 0.0
                landed = 0
        duty = sum(down) / len(down)
        # Strike: first contact sample.
        idx = next(i for i in range(1, len(down)) if down[i] and not down[i - 1]) if any(down) and not all(down) else 0
        r = rows[idx]
        a, b = r["ank"][k], r["ball"][k]
        pitch = math.degrees(math.atan2(b.z - a.z + 0.063, b.y - a.y))  # 0 at rest (ball below ankle)
        ahead = (a.y - r["hp"][k].y) * 100
        th = [math.degrees(math.atan2(r["knee"][k].y - r["hp"][k].y, -(r["knee"][k].z - r["hp"][k].z))) for r in rows]
        knee_ang = []
        for r in rows:
            u = (r["hp"][k] - r["knee"][k]).normalized()
            v = (r["ank"][k] - r["knee"][k]).normalized()
            knee_ang.append(math.degrees(math.acos(max(-1, min(1, u.dot(v))))))
        print(f"  {s}: skate {worst * 100:.2f} cm, sink {sink * 100:.2f} cm, duty {duty:.2f}, strike pitch {pitch:+.0f}°, "
              f"strike {ahead:+.0f} cm ahead of hip, peak knee drive {max(th):.0f}°, tightest knee {min(knee_ang):.0f}°")
    both = sum(1 for r in rows if not ((r['L'][:, 2].min() < 0.012) or (r['R'][:, 2].min() < 0.012))) / len(rows)
    hz = [r["hip"].z for r in rows]
    hd = [r["head"].z for r in rows]
    pel_yaw = [math.degrees(r["pel"].y) for r in rows]
    chest = [math.degrees(r["chest"]) for r in rows]
    pel_roll = [math.degrees(r["pel"].z) for r in rows]
    hand_y = [((r["handL"].y - r["hip"].y), (r["handR"].y - r["hip"].y)) for r in rows]
    cross = max(max(-r["handL"].x, r["handR"].x) for r in rows)
    pitch_head = [math.degrees(math.atan2((r["head"] - r["neck"]).y, (r["head"] - r["neck"]).z)) for r in rows]
    corr = np.corrcoef(pel_yaw, chest)[0, 1]
    print(f"  flight {both:.2f}; hips travel {(max(hz) - min(hz)) * 100:.1f} cm; pelvis yaw ±{(max(pel_yaw) - min(pel_yaw)) / 2:.0f}°, "
          f"roll ±{(max(pel_roll) - min(pel_roll)) / 2:.0f}°; chest vs pelvis yaw corr {corr:+.2f} (−1 = counter-rotating)")
    print(f"  hands fore/aft of hip: {min(min(h) for h in hand_y) * 100:+.0f} … {max(max(h) for h in hand_y) * 100:+.0f} cm; "
          f"worst midline crossing {cross * 100:+.1f} cm (+ = across); elbow flex "
          f"{math.degrees(-max(r['elbow'][0] for r in rows)):.0f}–{math.degrees(-min(r['elbow'][0] for r in rows)):.0f}°")
    print(f"  head pitch range {max(pitch_head) - min(pitch_head):.1f}°, head height travel {(max(hd) - min(hd)) * 100:.1f} cm")
os._exit(0)
