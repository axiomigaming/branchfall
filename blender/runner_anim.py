"""Runner animation library (imported by build_runner.py).

Rig conventions (verified by render): down-pointing bones (thigh, shin, upper
arm, forearm, fingers) flex forward with −X, knees flex with +X; up-pointing
bones (hips, spine, chest, neck, head) lean forward with −X, yaw with +Y (the
left side comes forward, the face turns to the character's right) and roll with
+Z (the left side rises); feet point toes-down with −X.

Every clip keys every bone each key, so clips blend cleanly. The root height is
solved from contacts (soles, knees, seat) so feet meet the ground; gait cycles
add ballistic flight phases between stances.
"""
import math
import os

import bpy
from mathutils import Vector, Euler

from common import CACHE, preview, link, hexcol

FPS = 30
LT, LS, HIP_Z = 0.42, 0.43, 0.95
# Sole points relative to the ankle in the foot's rest frame (y forward, z up): heel, mid, ball, toe tip.
SOLE = [(-0.07, -0.1), (0.02, -0.1), (0.12, -0.097), (0.19, -0.078)]
BONES = None
RIG = None


def mirror(s):
    return "R" if s == "L" else "L"


def sgn(s):
    return 1 if s == "L" else -1


# ------------------------------------------------------------------ semantic pose helpers
def leg(P, s, hip=0.0, knee=0.0, ankle=0.0, toe=0.0, out=0.0, yaw=0.0):
    P[f"thigh.{s}"] = (-hip, yaw, out * sgn(s))
    P[f"shin.{s}"] = (knee, 0, 0)
    P[f"foot.{s}"] = (-ankle, 0, 0)
    P[f"toe.{s}"] = (toe, 0, 0)


def arm(P, s, fwd=0.0, elbow=0.0, out=0.12, wrist=0.0, twist=0.0, curl=0.3, shrug=0.0, prot=0.0):
    P[f"upper_arm.{s}"] = (-fwd, twist * sgn(s), out * sgn(s))
    P[f"forearm.{s}"] = (-elbow, 0, 0)
    P[f"hand.{s}"] = (wrist, 0, 0)
    P[f"fingers.{s}"] = (0, 0, -curl * sgn(s))
    P[f"shoulder.{s}"] = (shrug, 0, prot * sgn(s))


def torso(P, lean=0.0, look=0.0, yaw=0.0, roll=0.0, hp=0.0, hyaw=0.0, hroll=0.0, head_yaw=0.0, head_roll=0.0, breath=0.0):
    """lean: upper body forward relative to the pelvis; hp: pelvis pitch forward; yaw/head_yaw are
    absolute (world) rotations of the chest and the head; look: head pitch up relative to the chest."""
    P["hips"] = (-hp, hyaw, hroll)
    dy = yaw - hyaw
    P["spine"] = (-lean * 0.55, dy * 0.5, roll * 0.5)
    P["chest"] = (-lean * 0.45 - breath, dy * 0.5, roll * 0.5)
    hy = head_yaw - yaw
    P["neck"] = (look * 0.6, hy * 0.6, head_roll * 0.5)
    P["head"] = (look * 0.4, hy * 0.4, head_roll * 0.5)


def contact_z(P):
    """Lowest contact point (soles, knees, seat) relative to the hip joints, sagittal plane."""
    hp = -P.get("hips", (0, 0, 0))[0]
    pts = [-0.125 - 0.02 * max(0.0, hp)]  # the seat
    for s in "LR":
        hip = -P.get(f"thigh.{s}", (0, 0, 0))[0]
        knee = P.get(f"shin.{s}", (0, 0, 0))[0]
        ankle = -P.get(f"foot.{s}", (0, 0, 0))[0]
        at = hip - hp
        as_ = at - knee
        af = as_ - ankle
        kz = -LT * math.cos(at)
        az = kz - LS * math.cos(as_)
        pts.append(kz - 0.058 * abs(math.cos(as_ - at * 0.5)) - 0.01)
        for y, z in SOLE:
            pts.append(az + y * math.sin(af) + z * math.cos(af))
    return min(pts)


def solve_root(P):
    return -(HIP_Z + contact_z(P))


def key(frame, P, z=None, y=0.0, x=0.0, lift=0.0):
    pb = RIG.pose.bones
    for p in pb:
        p.rotation_euler = Euler((0, 0, 0))
        p.location = Vector((0, 0, 0))
    for name, rot in P.items():
        pb[name].rotation_euler = Euler(rot)
    if z is None:
        z = solve_root(P)
    # The hips bone points up (+Z world): local X = world X, local Y = world Z, local Z = −world Y.
    pb["hips"].location = Vector((x, z + lift, -y))
    for p in pb:
        p.keyframe_insert("rotation_euler", frame=frame)
        p.keyframe_insert("location", frame=frame)


def new_action(name):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    RIG.animation_data_create()
    RIG.animation_data.action = act
    return act


def sample(keys, t):
    """Periodic Catmull-Rom through (t, *values) keys."""
    n = len(keys)
    for i in range(n):
        t0 = keys[i][0]
        t1 = keys[(i + 1) % n][0] + (1.0 if i + 1 == n else 0.0)
        tt = t if t >= t0 else t + 1.0
        if t0 <= tt < t1:
            u = (tt - t0) / (t1 - t0)
            p0, p1, p2, p3 = (keys[(i + k) % n][1:] for k in (-1, 0, 1, 2))
            return [0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u ** 3)
                    for a, b, c, d in zip(p0, p1, p2, p3)]
    return list(keys[0][1:])


def lerp(a, b, t):
    return a + (b - a) * t


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ gaits
# Locomotion is solved, not keyed. Each gait is a set of biomechanical targets for one stride
# cycle (t = 0 is this foot's strike), from sprint and distance-running kinematics:
#
#   stance (0 … ts): the foot is fixed to the ground. A ground anchor slides back under the hip at
#     exactly one contact length D per stance, the foot rolls heel → flat → ball (a run) or stays on
#     the forefoot (sprint, dash), and the leg is solved by two-bone IK in the sagittal plane, so the
#     sole never skates. The hip sinks through mid-stance (the leg loads like a spring) and pushes
#     back up to toe-off.
#   flight (ts … 0.5): ballistic — the pelvis follows a parabola whose height comes from the flight
#     time at the gait's design speed (g·T²/8).
#   swing: heel recovery (the knee folds, the heel comes up under the seat — higher at speed), knee
#     drive (the thigh up to ~40° running, ~65–75° sprinting), then the shin swings out and the foot
#     paws back into the next strike. Swing keys are Hermite-joined to the IK solutions at toe-off
#     and strike, so there is no pop at either end.
#   upper body: the pelvis rotates with the swing leg and drops on the swing side after each strike;
#     the chest counter-rotates; the arms pump from the shoulder opposite the legs at ~90° elbows
#     (closing in front, opening behind), hands loose; the head holds a steady gaze against the bob,
#     the pitch and the roll. A little left/right asymmetry keeps it from reading as a mirror.
#
# S = D / ts is the ground covered per cycle when the stance foot is still: the runtime sets its
# cadence to speed / S (see STRIDE in src/world/runner.ts), so the planted foot moves with the floor.
HEEL = (-0.07, -0.1)
BALL = (0.12, -0.097)
BALL_OFF = BALL[0] - HEEL[0]
G_ACC = 9.81

RUN = dict(
    ts=0.3, D=0.88, xtd=0.25, knee=(0.36, 0.85, 0.28), v=5.0,
    af=[(0.0, 0.14), (0.14, 0.0), (0.44, 0.0), (1.0, -1.0)],
    swing=[(0.18, -0.34, 1.05, 0.45), (0.42, 0.12, 1.85, 0.12), (0.68, 0.72, 1.42, -0.12), (0.86, 0.66, 0.66, -0.16)],
    hp=0.1, lean=0.08, hyaw=0.12, hroll=0.05, chest=0.6, head_down=0.14,
    arm_c=0.08, arm_a=0.6, elbow=1.45, elbow_a=0.2, out=0.16, curl=0.45, peak=0.76, frames=24,
)
SPRINT = dict(
    ts=0.235, D=0.8, xtd=0.16, knee=(0.4, 0.8, 0.2), v=9.0,
    af=[(0.0, -0.2), (0.4, -0.05), (0.55, -0.08), (1.0, -1.12)],
    swing=[(0.15, -0.4, 1.28, 0.55), (0.38, 0.2, 2.3, 0.1), (0.64, 1.12, 1.75, -0.2), (0.84, 0.92, 0.78, -0.12)],
    hp=0.15, lean=0.1, hyaw=0.16, hroll=0.06, chest=0.75, head_down=0.08,
    arm_c=0.15, arm_a=1.0, elbow=1.5, elbow_a=0.32, out=0.15, curl=0.5, peak=0.74, frames=24,
)
# The desperate all-out run of the top tiers: longer reach, higher knees, a harder pump, a deeper lean.
DASH = dict(SPRINT, ts=0.205, D=0.8, xtd=0.16, knee=(0.42, 0.78, 0.18), v=12.6,
            af=[(0.0, -0.26), (0.4, -0.08), (0.55, -0.1), (1.0, -1.18)],
            swing=[(0.15, -0.42, 1.38, 0.55), (0.37, 0.24, 2.42, 0.1), (0.63, 1.26, 1.85, -0.22), (0.83, 1.02, 0.84, -0.12)],
            hp=0.18, lean=0.14, hyaw=0.19, hroll=0.07, chest=0.8, head_down=0.05,
            arm_c=0.18, arm_a=1.18, elbow=1.46, elbow_a=0.4, out=0.17, curl=0.55, peak=0.73)


def _rot(y, z, a):
    return y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a)


def _ankle_from(anchor, af, H):
    """Ankle (x fwd, z up, relative to the hip joint) for a foot pitched af (toes up +) whose heel
    would rest at `anchor` if flat: it pivots on the heel while toes-up, on the ball while toes-down."""
    if af > 0:
        px, (dy, dz) = anchor, HEEL
    else:
        px, (dy, dz) = anchor + BALL_OFF, BALL
    ox, oz = _rot(dy, dz, af)
    return px - ox, -H - oz


def _ik(ax, az):
    """Sagittal two-bone IK → (world thigh angle, knee flexion). Knee in front of the hip–ankle line."""
    d = min(math.hypot(ax, az), (LT + LS) * 0.9995)
    phi = math.atan2(ax, -az)
    al = math.acos(max(-1.0, min(1.0, (LT * LT + d * d - LS * LS) / (2 * LT * d))))
    at = phi + al
    kx, kz = LT * math.sin(at), -LT * math.cos(at)
    return at, at - math.atan2(ax - kx, -(az - kz))


def _pw(keys, u):
    """Piecewise smooth (eased) interpolation through (u, value) keys."""
    if u <= keys[0][0]:
        return keys[0][1]
    for (u0, a), (u1, b) in zip(keys, keys[1:]):
        if u <= u1:
            return a + (b - a) * ease((u - u0) / (u1 - u0))
    return keys[-1][1]


def _hermite(pts, t):
    """Cubic Hermite through (t, values, tangent-or-None) points; missing tangents are Catmull-Rom."""
    n = len(pts)
    tans = []
    for i, (ti, vi, mi) in enumerate(pts):
        if mi is not None:
            tans.append(mi)
            continue
        a = pts[max(0, i - 1)]
        b = pts[min(n - 1, i + 1)]
        tans.append([(y - x) / max(1e-6, b[0] - a[0]) for x, y in zip(a[1], b[1])])
    for i in range(n - 1):
        t0, p0, _ = pts[i]
        t1, p1, _ = pts[i + 1]
        if t <= t1 or i == n - 2:
            h = t1 - t0
            s = max(0.0, min(1.0, (t - t0) / h))
            h00, h10, h01, h11 = 2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s, -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2
            return [h00 * a + h10 * h * ma + h01 * b + h11 * h * mb for a, b, ma, mb in zip(p0, p1, tans[i], tans[i + 1])]
    return list(pts[-1][1])


def _scaled(G, k):
    """Amplitude k < 1 (easing down out of a run): shorter contacts, lower knees, a smaller pump."""
    if k >= 0.999:
        return G
    g = dict(G)
    g["D"] = G["D"] * (0.35 + 0.65 * k)
    g["xtd"] = G["xtd"] * (0.45 + 0.55 * k)
    g["swing"] = [(s, at * (0.35 + 0.65 * k), kn * (0.45 + 0.55 * k), an * k) for s, at, kn, an in G["swing"]]
    g["v"] = G["v"] * k
    for n_ in ("hyaw", "hroll", "arm_a", "elbow_a"):
        g[n_] = G[n_] * k
    g["knee"] = tuple(0.3 + (x - 0.3) * k for x in G["knee"])
    return g


def _height_for(G, u, knee):
    """Hip height at which the stance knee is flexed `knee` at stance fraction u (bisection)."""
    lo, hi = 0.6, 0.95
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        k_ = _ik(*_ankle_from(G["xtd"] - G["D"] * u, _pw(G["af"], u), mid))[1]
        lo, hi = (lo, mid) if k_ < knee else (mid, hi)
    return 0.5 * (lo + hi)


_HCACHE = {}


def _heights(G):
    """(strike, mid-stance, toe-off) hip heights from the knee targets: the leg lands nearly straight,
    loads to ~40° at mid-stance and pushes off almost straight."""
    key_ = (G["D"], G["xtd"], G["knee"], tuple(G["af"]))
    if key_ not in _HCACHE:
        ktd, kmid, kto = G["knee"]
        _HCACHE[key_] = (_height_for(G, 0.0, ktd), _height_for(G, 0.45, kmid), _height_for(G, 1.0, kto))
    return _HCACHE[key_]


def _sink(G):
    htd, hmid, hto = _heights(G)
    return 0.5 * (htd + hto) - hmid


def _pelvis(ph, G):
    """Pelvis yaw (left side forward +), roll (left side up +) and hip height at cycle phase ph."""
    tw = 2 * math.pi
    ts = G["ts"]
    hy = G["hyaw"] * math.cos(tw * (ph - 0.96))
    # Obliquity: the swing side drops sharply after each strike as the stance hip takes the load.
    loc = ph % 0.5
    drop = math.exp(-((loc - 0.3 * ts - 0.02) / (0.45 * ts + 0.04)) ** 2) * (1 if ph % 1.0 < 0.5 else -1)
    roll = G["hroll"] * drop
    # Height: spring-loaded stance, ballistic flight.
    htd, hmid, hto = _heights(G)
    if loc < ts:
        u = loc / ts
        base = htd + (hto - htd) * u
        bump = (hmid - (htd + (hto - htd) * 0.45)) / math.sin(0.45 * math.pi) ** 1.2
        H = base + bump * math.sin(math.pi * u) ** 1.2
    else:
        u = (loc - ts) / (0.5 - ts)
        cad = G["v"] / (G["D"] / ts) if G["v"] > 0.1 else 1.0
        tf = (0.5 - ts) / min(2.6, max(0.6, cad))
        H = hto + (htd - hto) * u + 4 * u * (1 - u) * G_ACC * tf * tf / 8
    return hy, roll, H


def _hip_of(s, hy, roll):
    """Hip joint (forward, up) offset from the pelvis centre for the pelvis yaw and roll."""
    return sgn(s) * 0.1 * math.sin(hy), sgn(s) * 0.1 * math.sin(roll)


def _stance_leg(s, ph, t, G):
    """(world thigh angle, knee, ankle joint, toe) of leg s in stance at its own phase t."""
    hy, roll, H = _pelvis(ph, G)
    hx, hz = _hip_of(s, hy, roll)
    u = t / G["ts"]
    af = _pw(G["af"], u)
    ax, az = _ankle_from(G["xtd"] - G["D"] * u - hx, af, H + hz)
    at, knee = _ik(ax, az)
    ankle = (at - knee) - af
    toe = min(0.8, max(0.0, -af - 0.05)) if af < 0 and u > 0.35 else 0.0
    return at, knee, ankle, toe


def _leg_state(s, ph, G):
    off = 0.0 if s == "L" else 0.5
    t = (ph + off) % 1.0
    ts = G["ts"]
    if t < ts:
        return _stance_leg(s, ph, t, G)
    # Swing: Hermite from the toe-off solution through the keys to the next strike's solution.
    e = 0.004
    ph_to = (ts - off) % 1.0
    ph_td = (1.0 - off) % 1.0
    a0 = _stance_leg(s, ph_to, ts - 1e-6, G)[:3]
    a0m = _stance_leg(s, (ph_to - e) % 1.0, ts - e, G)[:3]
    a1 = _stance_leg(s, ph_td, 0.0, G)[:3]
    a1p = _stance_leg(s, (ph_td + e) % 1.0, e, G)[:3]
    sw = 1.0 - ts
    m0 = [(x - y) / (e / sw) * 0.6 for x, y in zip(a0, a0m)]   # damped: the push-off's momentum carries into swing
    m1 = [(y - x) / (e / sw) * 0.6 for x, y in zip(a1, a1p)]
    m0[1] = max(0.0, m0[1])  # the knee folds straight after toe-off, never locks back
    pts = [(0.0, list(a0), m0)] + [(k[0], list(k[1:]), None) for k in G["swing"]] + [(1.0, list(a1), m1)]
    at, knee, ankle = _hermite(pts, (t - ts) / sw)
    knee = max(0.04, knee)
    # The toes flick straight after toe-off, then relax.
    toe = 0.55 * math.exp(-(((t - ts) / sw) / 0.08) ** 2)
    return at, knee, ankle, toe


def _gait(ph, G, k=1.0):
    """Pose, lateral root offset and root height for gait G at cycle phase ph (0 = left strike)."""
    G = _scaled(G, k)
    tw = 2 * math.pi
    P = {}
    hy, roll, H = _pelvis(ph, G)
    ts = G["ts"]
    # Pelvis pitch: tipped forward, most at each push-off (the hip extending behind).
    hp = G["hp"] * (0.4 + 0.6 * k) + 0.025 * k * math.cos(2 * tw * (ph - ts))
    for s in "LR":
        at, knee, ankle, toe = _leg_state(s, ph, G)
        t = (ph + (0.0 if s == "L" else 0.5)) % 1.0
        stance = t < ts
        # The stance foot lands under the body's line (a narrow track); the swing knee tracks straight.
        out = -0.035 if stance else -0.005 + 0.02 * math.sin(math.pi * (t - ts) / (1 - ts))
        P[f"thigh.{s}"] = (-(at + hp), hy * 0.8, out * sgn(s))
        P[f"shin.{s}"] = (knee, 0, 0)
        P[f"foot.{s}"] = (-ankle, 0, 0)
        P[f"toe.{s}"] = (toe, 0, 0)
        # Arms: the opposite arm swings with this leg's thigh; the forearm lags, the hand stays loose.
        m = mirror(s)
        a = math.cos(tw * (t - G["peak"]))
        lag = math.cos(tw * (t - G["peak"] - 0.05))
        flop = math.sin(tw * (t - G["peak"] - 0.12))
        asym = 1.0 if m == "R" else 0.93            # the right arm pumps a touch bigger …
        wide = 0.0 if m == "R" else 0.02            # … the left rides a touch wider
        fwd = (G["arm_c"] + G["arm_a"] * a * asym) * k + 0.05 * (1 - k)
        arm(P, m, fwd=fwd, elbow=(G["elbow"] + G["elbow_a"] * lag) * (0.55 + 0.45 * k),
            out=G["out"] + wide - 0.07 * a * k, wrist=0.08 + 0.12 * flop * k, twist=0.14 * a * k,
            curl=G["curl"] + 0.1 * lag * k, prot=0.1 * a * k, shrug=0.04 * max(0.0, a) * k)
    # Trunk: a steady forward lean with a small flex as each stance loads, the chest counter-rotating
    # against the pelvis; the head keeps its gaze level through all of it.
    load = math.exp(-(((ph % 0.5) - 0.45 * ts) / (0.5 * ts + 0.03)) ** 2)
    lean = G["lean"] * (0.4 + 0.6 * k) + 0.025 * k * load
    look = hp + lean - G["head_down"] - 0.015 * k * load
    torso(P, lean=lean, look=look, yaw=-G["chest"] * hy, roll=-roll * 0.8, hp=hp, hyaw=hy, hroll=roll,
          head_yaw=0.0, head_roll=-roll * 0.1)
    # The body's line shifts a little over each stance foot.
    x = 0.01 * k * math.cos(tw * (ph - ts * 0.5))
    return P, x, H - HIP_Z


def loco(ph, G, k=1.0):
    P, x, _ = _gait(ph, G, k)
    return P, x


def gait_root(ph, G, k=1.0):
    return _gait(ph, G, k)[2]


def gait_clip(name, G):
    new_action(name)
    n = G["frames"]
    for f in range(n + 1):
        ph = f / n
        P, x, z = _gait(ph, G)
        key(f + 1, P, z=z, x=x)
    print(f"  gait {name}: S = {G['D'] / G['ts']:.3f} m/cycle, hip heights {['%.3f' % h for h in _heights(G)]}", flush=True)


# ------------------------------------------------------------------ poses
def ready_pose(br=0.0):
    P = {}
    torso(P, lean=0.62 + 0.02 * br, look=0.62, hp=0.2, yaw=0.08, hyaw=0.05, head_yaw=0.0)
    leg(P, "L", hip=0.95, knee=1.45, ankle=-0.35)
    leg(P, "R", hip=-0.12, knee=0.85, ankle=0.25, toe=0.5)
    arm(P, "R", fwd=0.85, elbow=1.25, out=0.14, curl=0.7)
    arm(P, "L", fwd=-0.7, elbow=0.95, out=0.2, curl=0.7)
    return P


def standing(P, wide=0.06, bend=0.05):
    leg(P, "L", hip=0.04 + bend, knee=0.06 + bend * 2, ankle=bend, out=wide)
    leg(P, "R", hip=-0.02 + bend, knee=0.03 + bend * 2, ankle=bend, out=wide + 0.02)


def build(rig):
    global RIG
    RIG = rig
    for p in rig.pose.bones:
        p.rotation_mode = "XYZ"

    # ---------------------------------------------------------- gaits
    gait_clip("run", RUN)
    gait_clip("sprint", SPRINT)
    gait_clip("dash", DASH)

    # ---------------------------------------------------------- idle: breathing, weight shift, glances, a strap tug
    new_action("idle")
    for f in range(0, 151, 5):
        t = f / 150
        br = math.sin(t * 2 * math.pi * 2)
        glance_l = ease((f - 40) / 12) * (1 - ease((f - 68) / 12))
        glance_r = ease((f - 80) / 12) * (1 - ease((f - 108) / 14))
        tug = ease((f - 112) / 10) * (1 - ease((f - 136) / 10))
        sway = math.sin(t * 2 * math.pi)
        P = {}
        torso(P, lean=0.04 + 0.012 * br, look=0.02 + 0.08 * glance_r - 0.04 * tug, yaw=-0.12 * glance_l + 0.08 * glance_r,
              roll=0.015 * sway, hroll=-0.02 * sway, hyaw=0.03 * sway, head_yaw=-0.75 * glance_l + 0.6 * glance_r + 0.15 * tug,
              head_roll=0.03 * sway, breath=0.018 * br)
        standing(P)
        arm(P, "L", fwd=0.06 + 0.02 * br, elbow=0.25 + 0.03 * br, out=0.1, curl=0.5)
        arm(P, "R", fwd=0.02 + 0.55 * tug, elbow=0.3 + 1.65 * tug, out=0.1 - 0.05 * tug, twist=0.4 * tug, curl=0.5 + 0.6 * tug)
        P["shoulder.L"] = (0.02 * br, 0, 0)
        P["shoulder.R"] = (0.02 * br + 0.08 * tug, 0, 0)
        key(f + 1, P, x=0.012 * sway)

    # ---------------------------------------------------------- idle_b: weight onto one hip, roll the neck and
    # shoulders, look up at the ruins, brush dust off the forearm, settle (plays in turn with idle)
    new_action("idle_b")
    for f in range(0, 181, 5):
        t = f / 180
        br = math.sin(t * 2 * math.pi * 3)
        hipk = ease(f / 25) * (1 - ease((f - 150) / 25))          # weight onto the right leg
        neck = ease((f - 20) / 12) * (1 - ease((f - 56) / 14))    # a slow neck roll
        nroll = math.sin((f - 20) / 36 * 2 * math.pi) if 20 <= f <= 56 else 0.0
        up = ease((f - 62) / 16) * (1 - ease((f - 104) / 16))     # looks up at the heights
        brush = ease((f - 108) / 8) * (1 - ease((f - 142) / 10))  # brushes the left forearm
        stroke = math.sin((f - 108) / 34 * 3 * 2 * math.pi) if 108 <= f <= 142 else 0.0
        P = {}
        torso(P, lean=0.03 + 0.1 * brush + 0.01 * br, look=0.05 + 0.5 * up - 0.25 * brush + 0.2 * neck * nroll, yaw=0.06 * hipk - 0.1 * brush,
              roll=-0.03 * hipk, hroll=0.06 * hipk, hyaw=-0.04 * hipk, head_yaw=0.25 * up - 0.2 * brush + 0.15 * neck,
              head_roll=0.18 * neck * math.cos((f - 20) / 36 * 2 * math.pi) if 20 <= f <= 56 else 0.0, breath=0.016 * br)
        leg(P, "R", hip=0.02, knee=0.02, ankle=0.0, out=0.08 + 0.02 * hipk)
        leg(P, "L", hip=0.1 + 0.12 * hipk, knee=0.12 + 0.3 * hipk, ankle=0.08 + 0.12 * hipk, out=0.06 - 0.02 * hipk)
        arm(P, "L", fwd=0.06 + 0.75 * brush, elbow=0.25 + 1.2 * brush, out=0.1 - 0.02 * brush, twist=0.5 * brush, curl=0.5 - 0.2 * brush)
        arm(P, "R", fwd=0.04 + 0.6 * brush + 0.05 * stroke * brush, elbow=0.3 + 1.4 * brush, out=0.1 - 0.12 * brush + 0.04 * stroke * brush,
            twist=0.3 * brush, curl=0.45 - 0.35 * brush)
        P["shoulder.L"] = (0.02 * br + 0.1 * neck * max(0.0, nroll), 0, 0)
        P["shoulder.R"] = (0.02 * br + 0.1 * neck * max(0.0, -nroll), 0, 0)
        key(f + 1, P, x=-0.03 * hipk)

    # ---------------------------------------------------------- idle_c: getting ready to run — a look down the
    # causeway, shake out the hands, two quick bounces on the balls of the feet, a shoulder roll, a big breath out
    new_action("idle_c")
    for f in range(0, 181, 3):
        br = math.sin(f / 180 * 2 * math.pi * 3)
        look = ease((f - 6) / 14) * (1 - ease((f - 44) / 14))                 # peers down the way ahead
        shake = ease((f - 48) / 6) * (1 - ease((f - 86) / 8))                 # shakes out the hands
        sh = math.sin(f * 2.6) * shake
        bounce = ease((f - 92) / 5) * (1 - ease((f - 124) / 6))               # bounces on the toes
        bz = abs(math.sin((f - 92) / 32 * 2 * math.pi)) * bounce
        roll = ease((f - 126) / 8) * (1 - ease((f - 160) / 10))               # rolls the shoulders back
        rph = (f - 126) / 34 * 2 * math.pi
        blow = ease((f - 150) / 10) * (1 - ease((f - 176) / 6))               # a long breath out
        P = {}
        torso(P, lean=0.05 + 0.08 * look - 0.03 * blow + 0.012 * br + 0.03 * bz, look=0.02 - 0.06 * look - 0.1 * blow,
              yaw=0.05 * look, head_yaw=0.12 * look, roll=0.02 * sh, breath=0.018 * br - 0.03 * blow)
        bend = 0.05 + 0.1 * bz + 0.04 * look
        standing(P, wide=0.07, bend=bend)
        for s_, k in (("L", 1.0), ("R", -1.0)):
            arm(P, s_, fwd=0.1 + 0.25 * shake + 0.05 * sh * k + 0.05 * bz, elbow=0.3 + 0.35 * shake + 0.2 * bz,
                out=0.12 + 0.08 * shake + 0.03 * sh, wrist=0.35 * sh * k, twist=0.2 * sh, curl=0.4 - 0.25 * shake,
                shrug=0.08 * roll * max(0.0, math.sin(rph)), prot=0.1 * roll * math.cos(rph))
        # On the toes at the top of each bounce.
        for s_ in "LR":
            if bz > 0.01:
                th, kn, an, to = P[f"thigh.{s_}"], P[f"shin.{s_}"], P[f"foot.{s_}"], P[f"toe.{s_}"]
                P[f"foot.{s_}"] = (an[0] - 0.35 * bz, 0, 0)
                P[f"toe.{s_}"] = (0.35 * bz, 0, 0)
        key(f + 1, P, x=0.01 * sh)

    # ---------------------------------------------------------- ready: coiled, rocking gently on the balls of the feet
    new_action("ready")
    for f in range(0, 41, 4):
        br = math.sin(f / 40 * 2 * math.pi)
        key(f + 1, ready_pose(br), y=0.015 * br)

    # ---------------------------------------------------------- start: the burst out of the crouch into the run
    # Anticipation (sink and cock the arms), an explosive push off the front foot with the rear knee
    # driving through, then three accelerating steps — short and low, rising to the run by the fourth
    # plant (a left strike, where the run cycle begins).
    new_action("start")
    key(1, ready_pose())
    P = ready_pose()
    torso(P, lean=0.7, look=0.66, hp=0.24, yaw=0.12, hyaw=0.06)
    leg(P, "L", hip=1.05, knee=1.7, ankle=-0.45)
    leg(P, "R", hip=-0.05, knee=1.05, ankle=0.35, toe=0.6)
    arm(P, "R", fwd=1.05, elbow=1.45, out=0.14, curl=0.85)
    arm(P, "L", fwd=-0.9, elbow=1.0, out=0.2, curl=0.85)
    key(4, P)
    P = {}
    torso(P, lean=0.78, look=0.72, hp=0.22, hyaw=-0.16, yaw=0.14)
    leg(P, "L", hip=-0.2, knee=0.2, ankle=0.75, toe=0.7)
    leg(P, "R", hip=1.2, knee=2.0, ankle=0.25)
    arm(P, "L", fwd=1.45, elbow=1.3, curl=0.9, prot=0.14, out=0.06)
    arm(P, "R", fwd=-1.1, elbow=0.9, out=0.22, curl=0.9)
    key(7, P, lift=0.015)
    P = {}
    torso(P, lean=0.7, look=0.64, hp=0.2, hyaw=-0.06)
    leg(P, "R", hip=0.42, knee=0.55, ankle=-0.05)
    leg(P, "L", hip=-0.42, knee=1.1, ankle=0.55)
    arm(P, "L", fwd=0.5, elbow=1.45, curl=0.85)
    arm(P, "R", fwd=-0.3, elbow=1.2, curl=0.85)
    key(9, P)
    P = {}
    torso(P, lean=0.62, look=0.6, hp=0.18, hyaw=0.14, yaw=-0.12)
    leg(P, "R", hip=-0.42, knee=0.3, ankle=0.72, toe=0.6)
    leg(P, "L", hip=1.1, knee=1.95, ankle=0.22)
    arm(P, "R", fwd=1.3, elbow=1.35, curl=0.85, prot=0.12, out=0.07)
    arm(P, "L", fwd=-1.0, elbow=0.95, out=0.2, curl=0.85)
    key(13, P, lift=0.025)
    P = {}
    torso(P, lean=0.55, look=0.55, hp=0.16, hyaw=0.05)
    leg(P, "L", hip=0.4, knee=0.45, ankle=-0.05)
    leg(P, "R", hip=-0.4, knee=1.2, ankle=0.55)
    arm(P, "R", fwd=0.45, elbow=1.4, curl=0.8)
    arm(P, "L", fwd=-0.25, elbow=1.2, curl=0.8)
    key(16, P)
    P, x = loco(0.25, SPRINT, 0.85)
    key(19, P, z=gait_root(0.25, SPRINT, 0.85), x=x)
    P, x = loco(0.5, RUN, 0.95)
    key(23, P, z=gait_root(0.5, RUN, 0.95), x=x)
    P, x = loco(0.75, RUN)
    key(26, P, z=gait_root(0.75, RUN), x=x)
    P0, x0 = loco(0.0, RUN)
    key(29, P0, z=gait_root(0.0, RUN), x=x0)

    # ---------------------------------------------------------- chasm: skid, teeter and windmill at the edge, sit back hard
    new_action("fall_chasm")
    P0, x0 = loco(0.0, RUN)
    key(1, P0, z=gait_root(0.0, RUN), x=x0)
    P = {}
    torso(P, lean=-0.12, look=0.25, hp=-0.05)
    leg(P, "L", hip=0.75, knee=0.25, ankle=-0.3)
    leg(P, "R", hip=0.1, knee=0.9, ankle=0.2)
    arm(P, "L", fwd=1.1, elbow=0.6, out=0.4, curl=0.1)
    arm(P, "R", fwd=0.9, elbow=0.7, out=0.45, curl=0.1)
    key(4, P)
    P = {}
    torso(P, lean=-0.28, look=0.3, hp=-0.08, roll=0.05)
    leg(P, "L", hip=0.9, knee=0.45, ankle=-0.35)
    leg(P, "R", hip=0.35, knee=1.3, ankle=0.0)
    arm(P, "L", fwd=1.55, elbow=0.3, out=0.7, curl=0.0)
    arm(P, "R", fwd=1.4, elbow=0.35, out=0.75, curl=0.0)
    key(9, P)
    # Momentum pitches the body forward over the edge; the arms start to wheel.
    wheel = [(14, 0.45, 2.3, -0.5, 0.1), (19, 0.4, 0.8, 2.6, 0.15), (24, 0.3, -0.4, 1.2, 0.05), (29, 0.15, 2.4, -0.2, -0.1)]
    for fr, lean, fl, fr_, look in wheel:
        P = {}
        torso(P, lean=lean, look=look - 0.25, hp=0.12, roll=0.08 * math.sin(fr), head_yaw=0.05 * math.sin(fr * 0.7))
        leg(P, "L", hip=0.3, knee=0.25, ankle=0.35, toe=0.4)
        leg(P, "R", hip=-0.05, knee=0.25, ankle=0.55, toe=0.5, out=0.08)
        arm(P, "L", fwd=fl, elbow=0.3, out=0.55 + 0.2 * math.cos(fl), curl=0.0)
        arm(P, "R", fwd=fr_, elbow=0.3, out=0.55 + 0.2 * math.cos(fr_), curl=0.0)
        key(fr, P)
    P = {}
    torso(P, lean=-0.35, look=0.2, hp=-0.2)
    leg(P, "L", hip=0.35, knee=0.45, ankle=0.0)
    leg(P, "R", hip=-0.35, knee=0.55, ankle=0.3)
    arm(P, "L", fwd=1.3, elbow=0.5, out=0.5, curl=0.1)
    arm(P, "R", fwd=1.2, elbow=0.55, out=0.5, curl=0.1)
    key(34, P, y=-0.1)
    P = {}
    torso(P, lean=-0.2, look=0.15, hp=-0.25)
    leg(P, "L", hip=1.2, knee=0.9, ankle=-0.2)
    leg(P, "R", hip=0.9, knee=1.4, ankle=0.0)
    arm(P, "L", fwd=-0.9, elbow=0.15, out=0.35, wrist=-0.6, curl=0.05)
    arm(P, "R", fwd=-0.85, elbow=0.15, out=0.35, wrist=-0.6, curl=0.05)
    key(40, P, y=-0.28)
    P = {}
    torso(P, lean=-0.18, look=0.05, hp=-0.28)
    leg(P, "L", hip=1.45, knee=0.55, ankle=-0.15)
    leg(P, "R", hip=1.35, knee=1.15, ankle=0.0, out=0.08)
    arm(P, "L", fwd=-0.75, elbow=0.1, out=0.35, wrist=-0.7, curl=0.1)
    arm(P, "R", fwd=-0.8, elbow=0.12, out=0.35, wrist=-0.7, curl=0.1)
    key(46, P, y=-0.38)
    P = {}
    torso(P, lean=0.16, look=-0.2, hp=-0.24, head_roll=0.06)
    leg(P, "L", hip=1.5, knee=0.62, ankle=-0.12)
    leg(P, "R", hip=1.4, knee=1.3, ankle=0.05, out=0.09)
    arm(P, "L", fwd=-0.7, elbow=0.2, out=0.36, wrist=-0.75, curl=0.15)
    arm(P, "R", fwd=-0.72, elbow=0.2, out=0.36, wrist=-0.75, curl=0.15)
    key(50, P, y=-0.38, lift=-0.015)
    for fr, br in ((58, 0.0), (68, 1.0), (78, 0.0)):
        P = {}
        torso(P, lean=0.08 + 0.03 * br, look=-0.12 + 0.05 * br, hp=-0.22, head_yaw=0.1, breath=0.02 * br)
        leg(P, "L", hip=1.45, knee=0.7, ankle=-0.1)
        leg(P, "R", hip=1.4, knee=1.5, ankle=0.1, out=0.1)
        arm(P, "L", fwd=-0.6, elbow=0.15, out=0.35, wrist=-0.7, curl=0.2)
        arm(P, "R", fwd=0.55, elbow=0.9, out=0.2, curl=0.5)
        key(fr, P, y=-0.38)

    # ---------------------------------------------------------- gate: slam to a stop, recoil, stagger back, sink down
    new_action("fall_gate")
    P0, x0 = loco(0.0, RUN)
    key(1, P0, z=gait_root(0.0, RUN), x=x0)
    P = {}
    torso(P, lean=-0.1, look=0.25, hp=-0.02)
    leg(P, "L", hip=0.7, knee=0.3, ankle=-0.3)
    leg(P, "R", hip=0.0, knee=1.0, ankle=0.3)
    arm(P, "L", fwd=1.35, elbow=0.55, out=0.25, curl=0.1)
    arm(P, "R", fwd=1.3, elbow=0.6, out=0.25, curl=0.1)
    key(5, P)
    P = {}
    torso(P, lean=0.22, look=0.0, hp=0.05, head_yaw=0.5, head_roll=0.1)
    leg(P, "L", hip=0.3, knee=0.3, ankle=0.1)
    leg(P, "R", hip=-0.3, knee=0.4, ankle=0.5, toe=0.4)
    arm(P, "L", fwd=1.5, elbow=0.4, out=0.3, wrist=-0.5, curl=0.05)
    arm(P, "R", fwd=1.45, elbow=0.45, out=0.3, wrist=-0.5, curl=0.05)
    key(9, P, y=0.08)
    P = {}
    torso(P, lean=-0.35, look=0.3, hp=-0.1, head_yaw=0.2)
    leg(P, "L", hip=0.2, knee=0.2, ankle=0.0)
    leg(P, "R", hip=-0.4, knee=0.3, ankle=0.3)
    arm(P, "L", fwd=0.9, elbow=0.2, out=0.5, curl=0.1)
    arm(P, "R", fwd=0.85, elbow=0.25, out=0.55, curl=0.1)
    key(13, P, y=-0.05)
    P = {}
    torso(P, lean=-0.25, look=0.25, hp=-0.1, roll=0.1)
    leg(P, "L", hip=-0.35, knee=0.6, ankle=0.3)
    leg(P, "R", hip=0.25, knee=0.5, ankle=0.0)
    arm(P, "L", fwd=0.5, elbow=0.4, out=0.85, curl=0.2)
    arm(P, "R", fwd=0.4, elbow=0.4, out=0.8, curl=0.2)
    key(19, P, y=-0.2)
    P = {}
    torso(P, lean=-0.08, look=0.2, hp=-0.05, roll=-0.08)
    leg(P, "R", hip=-0.3, knee=0.95, ankle=0.4)
    leg(P, "L", hip=0.5, knee=1.1, ankle=0.0)
    arm(P, "L", fwd=0.3, elbow=0.5, out=0.6, curl=0.3)
    arm(P, "R", fwd=0.2, elbow=0.4, out=0.65, curl=0.3)
    key(25, P, y=-0.34)
    P = {}
    torso(P, lean=0.1, look=0.05, hp=-0.25)
    leg(P, "L", hip=1.3, knee=1.2, ankle=-0.1)
    leg(P, "R", hip=1.1, knee=1.6, ankle=0.1)
    arm(P, "L", fwd=-0.6, elbow=0.2, out=0.4, wrist=-0.5, curl=0.1)
    arm(P, "R", fwd=-0.55, elbow=0.25, out=0.4, wrist=-0.5, curl=0.1)
    key(32, P, y=-0.43)
    for fr, look, br in ((40, -0.3, 0.0), (52, -0.25, 1.0), (62, 0.35, 0.0), (80, 0.4, 1.0), (95, 0.38, 0.0)):
        P = {}
        torso(P, lean=0.35 - 0.12 * (look > 0), look=look, hp=-0.2, breath=0.02 * br, head_yaw=0.05)
        leg(P, "L", hip=1.5, knee=1.65, ankle=-0.2, out=0.1)
        leg(P, "R", hip=1.3, knee=1.0, ankle=0.0, out=0.14)
        arm(P, "L", fwd=0.9, elbow=1.3, out=0.2, curl=0.4)
        arm(P, "R", fwd=0.45, elbow=0.4, out=0.25, curl=0.4)
        key(fr, P, y=-0.45)

    # ---------------------------------------------------------- rockfall: flinch, cover the head, drop to a crouch
    new_action("fall_rock")
    P0, x0 = loco(0.0, RUN)
    key(1, P0, z=gait_root(0.0, RUN), x=x0)
    P = {}
    torso(P, lean=0.1, look=-0.4, hp=0.0)
    leg(P, "L", hip=0.6, knee=0.4, ankle=-0.2)
    leg(P, "R", hip=0.0, knee=0.9, ankle=0.3)
    arm(P, "L", fwd=1.2, elbow=1.2, out=0.5, curl=0.5, shrug=0.25)
    arm(P, "R", fwd=1.15, elbow=1.25, out=0.5, curl=0.5, shrug=0.25)
    key(4, P)
    cover = dict(fwd=2.45, elbow=2.05, out=0.5, twist=-0.3, curl=0.9, shrug=0.25)
    P = {}
    torso(P, lean=0.35, look=-0.35, hp=0.05)
    leg(P, "L", hip=0.9, knee=1.3, ankle=-0.2)
    leg(P, "R", hip=0.3, knee=1.4, ankle=0.4)
    arm(P, "L", **cover)
    arm(P, "R", **cover)
    key(8, P)
    P = {}
    torso(P, lean=0.6, look=-0.4, hp=0.2)
    leg(P, "L", hip=1.3, knee=2.1, ankle=-0.3)
    leg(P, "R", hip=0.6, knee=2.2, ankle=0.35, toe=0.5)
    arm(P, "L", **cover)
    arm(P, "R", **cover)
    key(14, P)
    for fr, lean, sh in ((22, 0.75, 0.25), (28, 0.92, 0.35), (36, 0.8, 0.25), (52, 0.78, 0.22), (72, 0.7, 0.18), (95, 0.68, 0.15)):
        P = {}
        torso(P, lean=lean * 0.75, look=-0.4 + 0.25 * (fr >= 72), hp=0.25, head_yaw=0.12 * (fr >= 72))
        # Down on the left knee, the right foot planted: the soles and the knee share the ground.
        leg(P, "L", hip=0.25, knee=1.8, ankle=0.3, toe=0.6)
        leg(P, "R", hip=1.95, knee=1.7, ankle=0.0, out=0.14)
        c = dict(cover)
        c["shrug"] = sh
        if fr >= 72:
            c.update(fwd=2.2, elbow=1.85)
        arm(P, "L", **c)
        arm(P, "R", **c)
        key(fr, P)

    # ---------------------------------------------------------- win: run out of it, look back, catch breath, fist raised
    new_action("win")
    P0, x0 = loco(0.0, RUN)
    key(1, P0, z=gait_root(0.0, RUN), x=x0)
    P, x = loco(0.5, RUN, 0.75)
    key(7, P, z=gait_root(0.5, RUN, 0.75), x=x)
    P, x = loco(0.0, RUN, 0.45)
    key(13, P, z=gait_root(0.0, RUN, 0.45), x=x)
    P = {}
    torso(P, lean=0.08, look=0.05, hp=0.02)
    leg(P, "L", hip=0.3, knee=0.35, ankle=-0.1)
    leg(P, "R", hip=0.12, knee=0.55, ankle=0.1, out=0.08)
    arm(P, "L", fwd=0.35, elbow=0.9, curl=0.5)
    arm(P, "R", fwd=0.25, elbow=0.8, curl=0.5)
    key(19, P)
    for fr, br in ((26, 0.0), (34, 1.0), (40, 0.0)):
        P = {}
        torso(P, lean=-0.03, look=0.1, yaw=0.4, hyaw=0.12, head_yaw=1.05, breath=0.03 * br)
        standing(P, wide=0.08, bend=0.03)
        arm(P, "L", fwd=0.15, elbow=0.5, out=0.15, curl=0.5)
        arm(P, "R", fwd=-0.05, elbow=0.4, out=0.14, curl=0.5)
        key(fr, P)
    for fr, br in ((48, 0.0), (55, 1.0), (62, 0.0), (69, 1.0)):
        P = {}
        torso(P, lean=0.72 - 0.05 * br, look=0.55, hp=0.35, breath=0.04 * br)
        leg(P, "L", hip=0.45, knee=0.6, ankle=0.12, out=0.1)
        leg(P, "R", hip=0.4, knee=0.55, ankle=0.12, out=0.12)
        arm(P, "L", fwd=0.72, elbow=0.18, out=0.2, wrist=0.3, curl=0.35)
        arm(P, "R", fwd=0.7, elbow=0.2, out=0.2, wrist=0.3, curl=0.35)
        key(fr, P)
    P = {}
    torso(P, lean=0.02, look=0.05)
    standing(P, wide=0.09, bend=0.04)
    arm(P, "L", fwd=0.15, elbow=0.6, curl=0.8)
    arm(P, "R", fwd=0.5, elbow=1.4, curl=1.0)
    key(78, P)
    P = {}
    torso(P, lean=0.1, look=0.0, yaw=0.08)
    standing(P, wide=0.1, bend=0.1)
    arm(P, "L", fwd=0.2, elbow=0.9, out=0.2, curl=1.2)
    arm(P, "R", fwd=1.2, elbow=2.0, out=0.3, curl=1.35, twist=0.2)
    key(84, P)
    for fr, up in ((90, 1.0), (98, 0.94), (120, 0.97), (140, 0.95)):
        P = {}
        torso(P, lean=-0.12 * up, look=0.35 * up, yaw=-0.1, roll=-0.05, breath=0.03 * (fr % 20 == 0))
        standing(P, wide=0.1, bend=0.02)
        arm(P, "R", fwd=2.95 * up, elbow=0.3 + (1 - up) * 3, out=0.3, curl=1.35, twist=0.3)
        arm(P, "L", fwd=0.12, elbow=0.95, out=0.22, curl=1.2)
        P["shoulder.R"] = (0.2, 0, -0.05)
        key(fr, P)

    extra_clips()

    for act in bpy.data.actions:
        gait = act.name in ("run", "sprint", "dash")
        for fc in act.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR" if gait else "BEZIER"
    rig.animation_data.action = bpy.data.actions["run"]


def run_in(fr=1):
    P0, x0 = loco(0.0, RUN)
    key(fr, P0, z=gait_root(0.0, RUN), x=x0)


def sit_look_up(P, look, br):
    torso(P, lean=0.23, look=look, hp=-0.2, breath=0.02 * br, head_yaw=0.05)
    leg(P, "L", hip=1.5, knee=1.65, ankle=-0.2, out=0.1)
    leg(P, "R", hip=1.3, knee=1.0, ankle=0.0, out=0.14)
    arm(P, "L", fwd=0.9, elbow=1.3, out=0.2, curl=0.4)
    arm(P, "R", fwd=0.45, elbow=0.4, out=0.25, curl=0.4)


def kneel_one(P, lean=0.4, look=0.0, head_yaw=0.0):
    torso(P, lean=lean, look=look, hp=0.2, head_yaw=head_yaw)
    leg(P, "L", hip=0.25, knee=1.8, ankle=0.3, toe=0.6)
    leg(P, "R", hip=1.95, knee=1.7, ankle=0.0, out=0.14)


def standing_turned(P, yaw):
    # The root bone's local Z is world up: rotation about it turns the whole body.
    P["root"] = (0, 0, yaw)


def extra_clips():
    """Crash and escape variants, and the fall at the push-off."""
    # ---------------------------------------------------------- fall_start: the gate slams as they push off
    new_action("fall_start")
    key(1, ready_pose())
    P = {}
    torso(P, lean=0.1, look=0.35, hp=0.0)
    leg(P, "L", hip=0.55, knee=0.8, ankle=-0.1)
    leg(P, "R", hip=0.0, knee=0.5, ankle=0.2)
    arm(P, "L", fwd=1.35, elbow=1.5, out=0.35, curl=0.3, shrug=0.2)
    arm(P, "R", fwd=1.3, elbow=1.55, out=0.35, curl=0.3, shrug=0.2)
    key(6, P, y=-0.05)
    P = {}
    torso(P, lean=-0.25, look=0.35, hp=-0.08, roll=0.08)
    leg(P, "L", hip=-0.35, knee=0.5, ankle=0.3)
    leg(P, "R", hip=0.3, knee=0.4, ankle=0.0)
    arm(P, "L", fwd=0.6, elbow=0.5, out=0.8, curl=0.2)
    arm(P, "R", fwd=0.5, elbow=0.4, out=0.75, curl=0.2)
    key(12, P, y=-0.3)
    P = {}
    torso(P, lean=-0.05, look=0.2, hp=-0.05, roll=-0.08)
    leg(P, "R", hip=-0.3, knee=0.9, ankle=0.4)
    leg(P, "L", hip=0.5, knee=1.1, ankle=0.0)
    arm(P, "L", fwd=0.3, elbow=0.5, out=0.6, curl=0.3)
    arm(P, "R", fwd=0.2, elbow=0.4, out=0.65, curl=0.3)
    key(18, P, y=-0.5)
    P = {}
    torso(P, lean=0.1, look=0.05, hp=-0.25)
    leg(P, "L", hip=1.3, knee=1.2, ankle=-0.1)
    leg(P, "R", hip=1.1, knee=1.6, ankle=0.1)
    arm(P, "L", fwd=-0.6, elbow=0.2, out=0.4, wrist=-0.5, curl=0.1)
    arm(P, "R", fwd=-0.55, elbow=0.25, out=0.4, wrist=-0.5, curl=0.1)
    key(26, P, y=-0.6)
    for fr, look, br in ((34, -0.3, 0.0), (46, -0.25, 1.0), (58, 0.35, 0.0), (76, 0.4, 1.0), (92, 0.38, 0.0)):
        P = {}
        sit_look_up(P, look, br)
        key(fr, P, y=-0.62)

    # ---------------------------------------------------------- fall_gate_b: turn away from the slam, drop to a knee
    new_action("fall_gate_b")
    run_in()
    P = {}
    torso(P, lean=-0.1, look=0.25, hp=-0.02)
    leg(P, "L", hip=0.7, knee=0.3, ankle=-0.3)
    leg(P, "R", hip=0.0, knee=1.0, ankle=0.3)
    arm(P, "L", fwd=1.2, elbow=0.6, out=0.3, curl=0.1)
    arm(P, "R", fwd=1.1, elbow=0.6, out=0.3, curl=0.1)
    key(5, P)
    P = {}
    torso(P, lean=0.15, look=-0.1, yaw=-0.45, hyaw=-0.2, head_yaw=-1.0, head_roll=0.15)
    leg(P, "L", hip=0.35, knee=0.7, ankle=0.0)
    leg(P, "R", hip=-0.2, knee=0.8, ankle=0.4)
    arm(P, "R", fwd=2.1, elbow=1.9, out=0.55, twist=-0.3, curl=0.9, shrug=0.25)
    arm(P, "L", fwd=-0.3, elbow=0.9, out=0.45, curl=0.6)
    key(10, P, y=-0.08)
    P = {}
    torso(P, lean=0.35, look=-0.2, yaw=-0.35, hyaw=-0.15, head_yaw=-0.8)
    leg(P, "L", hip=0.6, knee=1.3, ankle=0.1)
    leg(P, "R", hip=0.1, knee=1.3, ankle=0.4)
    arm(P, "R", fwd=2.2, elbow=2.0, out=0.5, twist=-0.3, curl=0.9, shrug=0.25)
    arm(P, "L", fwd=0.2, elbow=0.8, out=0.4, curl=0.6)
    key(16, P, y=-0.25)
    P = {}
    kneel_one(P, lean=0.5, look=-0.3, head_yaw=-0.4)
    arm(P, "R", fwd=2.0, elbow=1.9, out=0.5, twist=-0.3, curl=0.9)
    arm(P, "L", fwd=0.9, elbow=0.1, out=0.25, wrist=-0.8, curl=0.1)
    key(24, P, y=-0.35)
    for fr, t in ((36, 0.0), (52, 0.4), (70, 1.0), (95, 1.0)):
        P = {}
        kneel_one(P, lean=0.5 - 0.3 * t, look=-0.3 + 0.75 * t, head_yaw=-0.4 * (1 - t))
        arm(P, "R", fwd=2.0 - 1.4 * t, elbow=1.9 - 1.0 * t, out=0.5, curl=0.9)
        arm(P, "L", fwd=0.9 - 0.4 * t, elbow=0.1 + 0.3 * t, out=0.25, wrist=-0.8 * (1 - t), curl=0.2)
        key(fr, P, y=-0.35)

    # ---------------------------------------------------------- fall_rock_b: thrown back onto the seat, arm up against the dust
    new_action("fall_rock_b")
    run_in()
    P = {}
    torso(P, lean=0.05, look=0.3, hp=0.0)
    leg(P, "L", hip=0.7, knee=0.4, ankle=-0.3)
    leg(P, "R", hip=0.0, knee=0.9, ankle=0.3)
    arm(P, "L", fwd=1.4, elbow=1.1, out=0.5, curl=0.4, shrug=0.2)
    arm(P, "R", fwd=1.3, elbow=1.2, out=0.5, curl=0.4, shrug=0.2)
    key(4, P)
    P = {}
    torso(P, lean=-0.45, look=0.55, hp=-0.15)
    leg(P, "L", hip=0.9, knee=0.5, ankle=-0.2)
    leg(P, "R", hip=0.4, knee=1.2, ankle=0.1)
    arm(P, "L", fwd=2.0, elbow=1.2, out=0.6, curl=0.6)
    arm(P, "R", fwd=0.6, elbow=0.6, out=0.8, curl=0.3)
    key(9, P, y=-0.25)
    P = {}
    torso(P, lean=-0.35, look=0.4, hp=-0.3)
    leg(P, "L", hip=1.35, knee=0.5, ankle=-0.2)
    leg(P, "R", hip=1.1, knee=1.3, ankle=0.0, out=0.1)
    arm(P, "L", fwd=1.9, elbow=1.3, out=0.6, curl=0.6)
    arm(P, "R", fwd=-0.8, elbow=0.15, out=0.35, wrist=-0.7, curl=0.1)
    key(16, P, y=-0.55)
    P = {}
    torso(P, lean=-0.1, look=0.15, hp=-0.26, head_roll=-0.08)
    leg(P, "L", hip=1.4, knee=0.55, ankle=-0.2)
    leg(P, "R", hip=1.15, knee=1.35, ankle=0.0, out=0.1)
    arm(P, "L", fwd=1.95, elbow=1.25, out=0.6, curl=0.6)
    arm(P, "R", fwd=-0.85, elbow=0.2, out=0.35, wrist=-0.75, curl=0.1)
    key(20, P, y=-0.58, lift=-0.01)
    for fr, t, br in ((28, 0.0, 0.0), (44, 0.3, 1.0), (62, 0.7, 0.0), (80, 1.0, 1.0), (95, 1.0, 0.0)):
        P = {}
        torso(P, lean=-0.2 + 0.25 * t, look=0.35 - 0.15 * t, hp=-0.28, head_yaw=0.35 * math.sin(t * 3), breath=0.02 * br)
        leg(P, "L", hip=1.4, knee=0.6 + 0.6 * t, ankle=-0.15)
        leg(P, "R", hip=1.2, knee=1.4, ankle=0.0, out=0.12)
        arm(P, "L", fwd=1.9 - 1.3 * t, elbow=1.3 - 0.4 * t, out=0.5, curl=0.6)
        arm(P, "R", fwd=-0.8, elbow=0.15, out=0.35, wrist=-0.7, curl=0.1)
        key(fr, P, y=-0.6)

    # ---------------------------------------------------------- fall_chasm_b: skid down onto the knees at the lip
    new_action("fall_chasm_b")
    run_in()
    P = {}
    torso(P, lean=-0.15, look=0.25, hp=-0.05)
    leg(P, "L", hip=0.8, knee=0.3, ankle=-0.3)
    leg(P, "R", hip=0.05, knee=1.0, ankle=0.2)
    arm(P, "L", fwd=1.2, elbow=0.6, out=0.45, curl=0.1)
    arm(P, "R", fwd=1.0, elbow=0.7, out=0.5, curl=0.1)
    key(4, P)
    P = {}
    torso(P, lean=-0.3, look=0.2, hp=-0.1)
    leg(P, "L", hip=1.0, knee=0.6, ankle=-0.3)
    leg(P, "R", hip=0.1, knee=1.6, ankle=0.4, toe=0.4)
    arm(P, "L", fwd=1.5, elbow=0.4, out=0.7, curl=0.0)
    arm(P, "R", fwd=0.4, elbow=0.4, out=0.9, curl=0.0)
    key(10, P)
    P = {}
    torso(P, lean=0.45, look=-0.05, hp=0.15)
    leg(P, "L", hip=0.05, knee=1.75, ankle=0.4, toe=0.5)
    leg(P, "R", hip=0.1, knee=1.8, ankle=0.4, toe=0.5, out=0.08)
    arm(P, "L", fwd=1.0, elbow=0.25, out=0.3, wrist=-0.6, curl=0.1)
    arm(P, "R", fwd=0.95, elbow=0.25, out=0.3, wrist=-0.6, curl=0.1)
    key(16, P, y=-0.05)
    P = {}
    torso(P, lean=0.75, look=-0.1, hp=0.2)
    leg(P, "L", hip=0.1, knee=1.75, ankle=0.4, toe=0.5)
    leg(P, "R", hip=0.15, knee=1.8, ankle=0.4, toe=0.5, out=0.08)
    arm(P, "L", fwd=1.2, elbow=0.15, out=0.3, wrist=-0.8, curl=0.1)
    arm(P, "R", fwd=1.15, elbow=0.15, out=0.3, wrist=-0.8, curl=0.1)
    key(26, P, y=-0.05)
    for fr, t, br in ((40, 0.0, 0.0), (56, 0.6, 1.0), (72, 1.0, 0.0), (95, 1.0, 1.0)):
        P = {}
        torso(P, lean=0.75 - 0.5 * t, look=-0.1 + 0.2 * t, hp=0.2 - 0.3 * t, head_yaw=0.25 * math.sin(fr * 0.3) * (1 - t), breath=0.03 * br)
        leg(P, "L", hip=0.1 + 0.5 * t, knee=1.75 + 0.6 * t, ankle=0.4 - 0.2 * t, toe=0.5)
        leg(P, "R", hip=0.15 + 0.5 * t, knee=1.8 + 0.6 * t, ankle=0.4 - 0.2 * t, toe=0.5, out=0.08)
        arm(P, "L", fwd=1.2 - 0.9 * t, elbow=0.15 + 0.5 * t, out=0.3, wrist=-0.8 * (1 - t), curl=0.3)
        arm(P, "R", fwd=1.15 - 0.85 * t, elbow=0.15 + 0.5 * t, out=0.3, wrist=-0.8 * (1 - t), curl=0.3)
        key(fr, P, y=-0.08)

    # ---------------------------------------------------------- win_cheer: skid to a halt, both fists up
    new_action("win_cheer")
    run_in()
    P, x = loco(0.5, RUN, 0.7)
    key(6, P, z=gait_root(0.5, RUN, 0.7), x=x)
    P = {}
    torso(P, lean=-0.15, look=0.25, hp=-0.05)
    leg(P, "L", hip=0.75, knee=0.3, ankle=-0.3)
    leg(P, "R", hip=0.05, knee=0.9, ankle=0.2)
    arm(P, "L", fwd=0.6, elbow=0.9, out=0.5, curl=0.8)
    arm(P, "R", fwd=0.5, elbow=0.9, out=0.5, curl=0.8)
    key(11, P)
    P = {}
    torso(P, lean=0.15, look=0.1)
    standing(P, wide=0.13, bend=0.28)
    arm(P, "L", fwd=0.4, elbow=1.9, out=0.3, curl=1.35)
    arm(P, "R", fwd=0.4, elbow=1.9, out=0.3, curl=1.35)
    key(18, P)
    for fr, up, bend in ((26, 1.0, 0.04), (33, 0.9, 0.16), (40, 1.0, 0.03), (48, 0.94, 0.1), (70, 0.96, 0.05), (82, 0.8, 0.05)):
        P = {}
        torso(P, lean=-0.18 * up, look=0.5 * up)
        standing(P, wide=0.13, bend=bend)
        for sd in "LR":
            arm(P, sd, fwd=2.6 * up, elbow=0.35 + (1 - up) * 2, out=0.9, curl=1.35, twist=0.2)
        key(fr, P)
    P = {}
    torso(P, lean=0.05, look=0.15)
    standing(P, wide=0.12, bend=0.04)
    for sd in "LR":
        arm(P, sd, fwd=-0.15, elbow=1.5, out=0.55, twist=0.5, curl=0.6)
    key(100, P)
    key(120, P)

    # ---------------------------------------------------------- win_salute: ease down to a walk, turn back, salute
    new_action("win_salute")
    run_in()
    P, x = loco(0.5, RUN, 0.6)
    key(8, P, z=gait_root(0.5, RUN, 0.6), x=x)
    P, x = loco(0.0, RUN, 0.3)
    key(15, P, z=gait_root(0.0, RUN, 0.3), x=x)
    P = {}
    torso(P, lean=0.05, look=0.05)
    standing(P, wide=0.07, bend=0.04)
    arm(P, "L", fwd=0.15, elbow=0.5, curl=0.5)
    arm(P, "R", fwd=0.1, elbow=0.5, curl=0.5)
    key(22, P)
    for fr, yaw, lift_leg in ((28, 0.9, "R"), (34, 1.9, "L"), (40, 2.7, "R"), (46, 2.85, None)):
        P = {}
        torso(P, lean=0.04, look=0.05, head_yaw=0.35 if fr < 40 else 0.0)
        standing(P, wide=0.08, bend=0.04)
        if lift_leg:
            leg(P, lift_leg, hip=0.4, knee=0.7, ankle=0.1)
        arm(P, "L", fwd=0.1, elbow=0.4, curl=0.5)
        arm(P, "R", fwd=0.05, elbow=0.4, curl=0.5)
        standing_turned(P, yaw)
        key(fr, P)
    # Two fingers to the brow, then out: a salute to the ruins.
    for fr, ph in ((54, 1), (62, 1), (68, 2), (76, 3)):
        P = {}
        torso(P, lean=0.0, look=0.12, yaw=-0.08)
        standing(P, wide=0.08, bend=0.02)
        if ph == 1:
            arm(P, "R", fwd=1.2, elbow=2.35, out=0.75, twist=0.5, wrist=0.3, curl=0.9)
        elif ph == 2:
            arm(P, "R", fwd=1.6, elbow=0.9, out=0.95, twist=0.2, curl=0.9)
        else:
            arm(P, "R", fwd=0.15, elbow=0.4, out=0.14, curl=0.5)
        arm(P, "L", fwd=0.1, elbow=0.4, curl=0.5)
        standing_turned(P, 2.85)
        key(fr, P)
    # A small bow, hand to the chest.
    for fr, b in ((88, 1.0), (100, 1.0), (112, 0.0), (130, 0.0)):
        P = {}
        torso(P, lean=0.4 * b, look=-0.35 * b + 0.05)
        standing(P, wide=0.08, bend=0.03)
        arm(P, "R", fwd=0.55 + 0.1 * b, elbow=2.0 * b + 0.4 * (1 - b), out=-0.05 * b + 0.14 * (1 - b), twist=0.3 * b, curl=0.4)
        arm(P, "L", fwd=0.1 - 0.3 * b, elbow=0.4, curl=0.5)
        standing_turned(P, 2.85)
        key(fr, P)

    # ---------------------------------------------------------- win_leap: a bound and a leap, fist punched at the sky
    new_action("win_leap")
    run_in()
    P, x = loco(0.5, RUN, 0.9)
    key(5, P, z=gait_root(0.5, RUN, 0.9), x=x)
    P = {}
    torso(P, lean=0.5, look=0.45, hp=0.2)
    leg(P, "L", hip=0.7, knee=1.2, ankle=-0.1)
    leg(P, "R", hip=0.0, knee=0.9, ankle=0.4)
    arm(P, "L", fwd=-0.9, elbow=0.6, out=0.2, curl=0.8)
    arm(P, "R", fwd=-0.8, elbow=0.6, out=0.2, curl=0.8)
    key(9, P, )
    P = {}
    torso(P, lean=0.05, look=0.35)
    leg(P, "L", hip=1.25, knee=1.6, ankle=0.1)
    leg(P, "R", hip=-0.35, knee=0.5, ankle=0.6, toe=0.3)
    arm(P, "R", fwd=2.85, elbow=0.3, out=0.3, curl=1.35, twist=0.2)
    arm(P, "L", fwd=0.4, elbow=0.8, out=0.9, curl=0.8)
    key(14, P, lift=0.45)
    P = {}
    torso(P, lean=-0.05, look=0.45)
    leg(P, "L", hip=1.1, knee=1.3, ankle=0.1)
    leg(P, "R", hip=0.2, knee=1.2, ankle=0.3)
    arm(P, "R", fwd=3.0, elbow=0.2, out=0.3, curl=1.35, twist=0.2)
    arm(P, "L", fwd=0.5, elbow=0.8, out=1.0, curl=0.8)
    key(20, P, lift=0.55)
    P = {}
    torso(P, lean=0.55, look=0.4, hp=0.25)
    leg(P, "L", hip=1.3, knee=2.0, ankle=-0.25)
    leg(P, "R", hip=0.5, knee=2.0, ankle=0.35, toe=0.5)
    arm(P, "R", fwd=1.0, elbow=1.2, out=0.5, curl=1.2)
    arm(P, "L", fwd=0.9, elbow=0.2, out=0.4, wrist=-0.7, curl=0.1)
    key(27, P, )
    P = {}
    torso(P, lean=0.68, look=0.3, hp=0.3)
    leg(P, "L", hip=1.45, knee=2.2, ankle=-0.35)
    leg(P, "R", hip=0.6, knee=2.2, ankle=0.4, toe=0.55)
    arm(P, "R", fwd=0.9, elbow=1.3, out=0.5, curl=1.2)
    arm(P, "L", fwd=1.0, elbow=0.15, out=0.4, wrist=-0.8, curl=0.1)
    key(30, P, )
    key(35, P, )
    P = {}
    torso(P, lean=0.2, look=0.2)
    standing(P, wide=0.1, bend=0.2)
    arm(P, "R", fwd=0.6, elbow=2.1, out=0.2, curl=1.35)
    arm(P, "L", fwd=0.2, elbow=0.7, out=0.25, curl=0.8)
    key(44, P, )
    for fr, up in ((52, 0.0), (60, 1.0), (72, 0.97), (100, 0.95)):
        P = {}
        torso(P, lean=0.12 - 0.22 * up, look=0.1 + 0.3 * up, yaw=-0.1 * up)
        standing(P, wide=0.1, bend=0.12 - 0.08 * up)
        if up > 0:
            arm(P, "R", fwd=2.95 * up, elbow=0.3, out=0.3, curl=1.35, twist=0.3)
        else:
            arm(P, "R", fwd=0.7, elbow=2.3, out=0.15, curl=1.35)
        arm(P, "L", fwd=0.12, elbow=0.95, out=0.22, curl=1.2)
        key(fr, P, )


# ------------------------------------------------------------------ look-dev previews
def _ground():
    if "ground" in bpy.data.objects:
        return
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = "ground"
    m = bpy.data.materials.new("ground")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = hexcol("#8c7a64")
    g.data.materials.append(m)


def shot(rig, action, frame, cam, target=(0, 0, 0.9), tag=None, lens=40, res=(480, 540)):
    rig.animation_data.action = bpy.data.actions[action]
    bpy.context.scene.frame_set(frame)
    path = f"{CACHE}/runner_{tag or action}_{frame}.png"
    preview(path, cam, target, lens=lens, res=res, samples=10, sun=(40, 0, 130))
    return path


def previews(rig, which):
    _ground()
    side = (3.6, 0.35, 1.0)
    if which in ("model", "all"):
        shot(rig, "idle", 1, (0.9, 3.0, 1.5), (0, 0, 1.05), tag="front", lens=45)
        shot(rig, "idle", 1, (0.5, -3.2, 1.6), (0, 0, 1.1), tag="back", lens=45)
        shot(rig, "idle", 1, (0.35, 0.9, 1.68), (0, 0.02, 1.6), tag="face", lens=60, res=(480, 480))
        shot(rig, "idle", 1, (-0.9, 0.7, 1.75), (0, 0.0, 1.55), tag="face34", lens=50, res=(480, 480))
        shot(rig, "idle", 1, (0.9, 0.5, 0.35), (0.1, 0.05, 0.25), tag="boots", lens=50, res=(480, 480))
        shot(rig, "idle", 1, (0.75, 0.55, 1.0), (0.26, 0.0, 0.88), tag="hand", lens=60, res=(480, 480))
    if which in ("run", "all"):
        for f in (1, 4, 8, 12, 15, 19):
            shot(rig, "run", f, side)
        for f in (1, 4, 7, 10, 13, 16):
            shot(rig, "sprint", f, side)
        for f in (1, 5, 9):
            shot(rig, "sprint", f, (0.4, -3.6, 1.8), tag="sprintback")
        for f in (1, 4, 7, 9, 13, 16, 19, 23):
            shot(rig, "start", f, side)
    if which in ("react", "all"):
        for f in (9, 19, 29, 46, 78):
            shot(rig, "fall_chasm", f, (2.6, 2.4, 1.3))
        for f in (9, 19, 32, 62):
            shot(rig, "fall_gate", f, (2.6, 2.4, 1.3))
        for f in (8, 22, 72):
            shot(rig, "fall_rock", f, (2.6, 2.4, 1.3))
        for f in (13, 30, 55, 84, 98):
            shot(rig, "win", f, (1.4, 3.2, 1.4))
        for f in (1, 50, 90):
            shot(rig, "idle", f, (1.4, 3.2, 1.4))
    if which in ("react2", "all"):
        for name, frames in (("fall_start", (6, 12, 26, 70)), ("fall_gate_b", (10, 16, 24, 80)), ("fall_rock_b", (9, 16, 60)),
                             ("fall_chasm_b", (10, 16, 26, 72)), ("win_cheer", (11, 26, 33, 110)),
                             ("win_salute", (34, 46, 54, 68, 100)), ("win_leap", (9, 14, 20, 27, 60)), ("dash", (1, 5, 9))):
            for f in frames:
                cam = (3.6, 0.35, 1.0) if name == "dash" else (2.6, 2.4, 1.3)
                shot(rig, name, f, cam)
