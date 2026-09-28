import * as THREE from 'three';

export type CamMode = 'title' | 'setup' | 'lead' | 'run' | 'crash' | 'cashout';
export type CrashShot = 'chasm' | 'gate' | 'rockfall';
export type EscapeShot = 'lookback' | 'cheer' | 'salute' | 'leap';

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const dampV = (a: THREE.Vector3, b: THREE.Vector3, k: number, dt: number) => a.lerp(b, 1 - Math.exp(-k * dt));
const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const lerp = THREE.MathUtils.lerp;

function angleDelta(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** A camera placement in the runner's frame: metres along the route, to the right, and up. */
interface Frame {
  along: number;
  lat: number;
  up: number;
  /** Look target: along/lat/up from the runner, then pulled toward the focus point by `focus`. */
  lAlong: number;
  lLat: number;
  lUp: number;
  focus: number;
  fov: number;
}

function mixFrame(a: Frame, b: Frame, t: number): Frame {
  const k = ease(t);
  return {
    along: lerp(a.along, b.along, k),
    lat: lerp(a.lat, b.lat, k),
    up: lerp(a.up, b.up, k),
    lAlong: lerp(a.lAlong, b.lAlong, k),
    lLat: lerp(a.lLat, b.lLat, k),
    lUp: lerp(a.lUp, b.lUp, k),
    focus: lerp(a.focus, b.focus, k),
    fov: lerp(a.fov, b.fov, k),
  };
}

/** Piecewise-eased keyframes over time: [(t, frame)…]. */
function track(keys: [number, Frame][], t: number): Frame {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i]!;
    const [t1, b] = keys[i + 1]!;
    if (t < t1) return mixFrame(a, b, (t - t0) / (t1 - t0));
  }
  return keys[keys.length - 1]![1];
}

const F = (along: number, lat: number, up: number, lAlong: number, lLat: number, lUp: number, fov: number, focus = 0): Frame => ({ along, lat, up, lAlong, lLat, lUp, fov, focus });

/**
 * A chase camera with weight, and authored moves for the moments that matter.
 * The position lags on a spring, the heading lags the route, the lens widens
 * with speed, footfalls bob the operator, and shake comes from "trauma" that
 * decays. Title, start, crash and cash-out are choreographed as keyframed shots
 * in the runner's frame; every mode is a target the same springs move toward,
 * so switching is always a camera move, never a cut. A corridor constraint
 * (supplied by the game) keeps the lens out of the walls.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CamMode = 'title';
  private pos = new THREE.Vector3(0, 3, 8);
  private look = new THREE.Vector3();
  private yaw = 0;
  private fov = 55;
  private trauma = 0;
  private t = 0;
  private modeT = 0;
  private side = 1;
  private crashShot: CrashShot = 'gate';
  private escapeShot: EscapeShot = 'lookback';
  private variant = 0;
  /** 0..1: how grand the settled moment is (slower, wider, higher). */
  private epic = 0;
  /** Continuous run tier (see world/choreo): camera energy rises with it. */
  drive = 0;
  private fovKick = 0;
  private bob = 0;
  private bobV = 0;
  private sway = 0;
  private swayV = 0;
  private dutch = 0;
  private lastYaw = 0;
  shakeEnabled = true;
  motionScale = 1;
  /** Extra focus point for crash framing (the hazard). */
  focus = new THREE.Vector3();
  /** Keeps a camera position inside the open corridor (walls, floor). Set by the game. */
  constrain: (p: THREE.Vector3) => void = () => {};
  /** Distance from `a` to the first solid obstacle toward `b`, or null. Set by the game. */
  occlude: (a: THREE.Vector3, b: THREE.Vector3) => number | null = () => null;
  // Occlusion response: swing the orbit toward the clear side, else pull in along the sight line.
  private swing = 0;
  private swingTarget = 0;
  private pull = 1;
  private pullTarget = 1;
  private occT = 0;
  private blockedT = 0;
  private clearT = 0;
  private rawTarget = new THREE.Vector3();
  private runnerAt = new THREE.Vector3();
  private cand = new THREE.Vector3();
  private eye = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 2400);
  }

  setMode(m: CamMode, opts: { side?: number; shot?: CrashShot; escape?: EscapeShot; variant?: number; epic?: number } = {}): void {
    if (opts.side) this.side = opts.side;
    if (opts.shot) this.crashShot = opts.shot;
    if (opts.escape) this.escapeShot = opts.escape;
    if (opts.variant !== undefined) this.variant = opts.variant;
    if (opts.epic !== undefined) this.epic = opts.epic;
    if (m === this.mode) return;
    this.mode = m;
    this.modeT = 0;
    this.swingTarget = 0;
    this.pullTarget = 1;
  }

  /** Snap to the current target (after a teleport such as a new round). */
  snap(runnerPos: THREE.Vector3, runnerYaw: number): void {
    this.yaw = runnerYaw;
    this.lastYaw = runnerYaw;
    this.swing = this.swingTarget = 0;
    this.pull = this.pullTarget = 1;
    const fov = this.computeTarget(runnerPos, runnerYaw, 0, 1 / 60, true);
    this.pos.copy(this.targetPos);
    this.look.copy(this.targetLook);
    this.fov = fov;
  }

  addTrauma(x: number): void {
    this.trauma = Math.min(1, this.trauma + x);
  }

  /** A footfall: the operator is running too. */
  footfall(strength: number, foot: 'L' | 'R'): void {
    if (this.mode !== 'run' && this.mode !== 'lead') return;
    this.bobV -= (0.18 + 0.3 * strength) * this.motionScale;
    this.swayV += (foot === 'L' ? -1 : 1) * 0.06 * strength * this.motionScale;
  }

  /** A lens punch (the start burst). */
  kick(deg: number): void {
    this.fovKick += deg * this.motionScale;
  }

  private targetPos = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private targetLook = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();

  private place(out: THREE.Vector3, base: THREE.Vector3, along: number, lat: number, up: number) {
    return out.copy(base).addScaledVector(this.fwd, along).addScaledVector(this.right, lat).setY(base.y + up);
  }

  /**
   * How much to compose for a tall screen with the interface over its lower part: 0 on a landscape
   * screen with no dock, 1 on a phone in portrait. Settled shots pull back and aim lower by this, so
   * the runner's feet sit above the dock line.
   */
  private get compact(): number {
    const pf = Math.min(1, Math.max(0, (1 - this.camera.aspect) / 0.5));
    return Math.min(1, Math.max(pf, this.shiftTarget / 0.2));
  }

  private settled(f: Frame): Frame {
    const k = this.compact;
    if (k <= 0) return f;
    return { ...f, along: f.along * (1 + 0.3 * k), lat: f.lat * (1 + 0.2 * k), up: f.up + 0.3 * k, lUp: f.lUp - 0.3 * k };
  }

  private shot(runnerPos: THREE.Vector3, f: Frame) {
    this.place(this.targetPos, runnerPos, f.along, f.lat, f.up);
    this.place(this.targetLook, runnerPos, f.lAlong, f.lLat, f.lUp);
    if (f.focus > 0) {
      const y = this.targetLook.y;
      this.targetLook.lerp(this.focus, f.focus).setY(y);
    }
    return f.fov;
  }

  private computeTarget(runnerPos: THREE.Vector3, runnerYaw: number, intensity: number, dt: number, snap = false) {
    const k = snap ? 1e6 : 1;
    const follow = this.mode === 'run' || this.mode === 'lead' ? 2.6 : this.mode === 'crash' || this.mode === 'cashout' ? 0.6 : 1.6;
    this.yaw += angleDelta(this.yaw, runnerYaw) * (1 - Math.exp(-follow * dt * k));
    const yaw = this.yaw;
    this.fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const I = intensity;
    const s = this.side;
    const T = this.modeT;
    let fov = 55;
    switch (this.mode) {
      case 'title': {
        // An establishing move: high over the causeway looking down the way ahead, drifting down
        // to a low three-quarter view behind the runner (who sits right of frame, clear of the
        // title copy), and back up. Reduced motion slows it to a crawl.
        const period = this.motionScale < 1 ? 90 : 46;
        const c = ease(0.5 - 0.5 * Math.cos((2 * Math.PI * this.t) / period));
        const drift = Math.sin(this.t * 0.11) * 0.25;
        fov = this.shot(runnerPos, {
          along: lerp(-8.5, -2.3, c),
          lat: lerp(-0.5, -1.45, c) + drift,
          up: lerp(5.4, 1.05, Math.pow(c, 1.5)),
          lAlong: lerp(22, 6, c),
          lLat: lerp(0.2, 0.95, c),
          lUp: lerp(0.4, 1.55, c),
          focus: 0,
          fov: lerp(50, 44, c),
        });
        break;
      }
      case 'setup': {
        // On a tall screen with the dock up, pull back, rise and aim low so the whole runner stands
        // above the dock.
        fov = this.shot(runnerPos, mixFrame(F(-2.75, 0.5, 1.66, 7, 0.2, 1.2, 54), F(-3.0, 0.35, 1.9, 2.5, 0.1, 0.7, 54), this.compact));
        break;
      }
      case 'lead': {
        // Low beside the coiled runner, easing in: the held breath before the go.
        const p = ease(T / 1.2);
        fov = this.shot(runnerPos, F(lerp(-2.45, -1.95, p), lerp(0.62, 0.78, p), lerp(1.2, 1.02, p), 7, 0.1, 1.05, lerp(52, 47, p)));
        break;
      }
      case 'run': {
        // Energy rises with the run tier: closer and lower at the top tiers, a wider lens, a drift.
        const d = this.drive;
        const hi = Math.max(0, d - 2.5);
        const dist = 2.7 + 0.45 * I - 0.12 * hi;
        const drift = 0.22 * I * Math.sin(this.t * 0.37) * this.motionScale;
        fov = this.shot(runnerPos, F(-dist, drift, 1.68 - 0.1 * I - 0.1 * hi, 6.5, drift * 0.4, 1.12, 57 + 12 * I + 1.5 * hi));
        break;
      }
      case 'crash': {
        fov = this.shot(runnerPos, this.settled(this.crashFrame(T / (1 + 0.5 * this.epic), s)));
        break;
      }
      case 'cashout': {
        fov = this.shot(runnerPos, this.settled(this.escapeFrame(T, s)));
        break;
      }
    }
    this.rawTarget.copy(this.targetPos);
    this.runnerAt.copy(runnerPos);
    this.constrain(this.rawTarget);
    this.applyClearance(this.targetPos, this.swing, this.pull);
    return fov;
  }

  /** Rotate the target about the runner by `swing`, pull it toward the chest by `pull`, keep it in the corridor. */
  private applyClearance(out: THREE.Vector3, swing: number, pull: number): THREE.Vector3 {
    const r = this.runnerAt;
    const dx = out.x - r.x;
    const dz = out.z - r.z;
    const c = Math.cos(swing);
    const sn = Math.sin(swing);
    out.x = r.x + dx * c + dz * sn;
    out.z = r.z - dx * sn + dz * c;
    if (pull < 1) {
      this.eye.set(r.x, r.y + 1.3, r.z);
      out.sub(this.eye).multiplyScalar(pull).add(this.eye);
    }
    this.constrain(out);
    return out;
  }

  /** The nearest obstacle between the runner's chest/head and `p`, as a fraction of the way (or null). */
  private blockedAt(p: THREE.Vector3): number | null {
    const r = this.runnerAt;
    let best: number | null = null;
    for (const h of [1.25, 1.62]) {
      this.eye.set(r.x, r.y + h, r.z);
      const len = this.eye.distanceTo(p);
      const d = this.occlude(this.eye, p);
      if (d !== null && d < len - 0.15) best = Math.min(best ?? 1, d / len);
    }
    return best;
  }

  /**
   * Keep the runner in sight: every few frames test the sight lines from chest and head to the
   * camera target. Blocked for a moment → swing the orbit to the nearest clear angle (settled shots)
   * or pull in in front of the obstacle; clear for a while → ease back. Hysteresis stops jitter.
   */
  private clearance(dt: number): void {
    this.occT -= dt;
    const run = this.mode === 'run' || this.mode === 'lead';
    if (this.occT <= 0 && this.mode !== 'title') {
      const step = run ? 0.25 : 0.1;
      this.occT = step;
      const cur = this.applyClearance(this.cand.copy(this.rawTarget), this.swingTarget, 1);
      const hit = this.blockedAt(cur);
      if (hit === null) {
        this.blockedT = 0;
        this.clearT += step;
        if (this.clearT > 0.5) this.pullTarget = 1;
        if (this.swingTarget !== 0 && this.clearT > 1.0 && this.blockedAt(this.applyClearance(this.cand.copy(this.rawTarget), 0, 1)) === null) this.swingTarget = 0;
      } else {
        this.clearT = 0;
        this.blockedT += step;
        if (this.blockedT >= 0.1) {
          let found = false;
          if (!run) {
            for (const d of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
              const a = this.swingTarget + d;
              if (Math.abs(a) > 1.6) continue;
              if (this.blockedAt(this.applyClearance(this.cand.copy(this.rawTarget), a, 1)) === null) {
                this.swingTarget = a;
                this.pullTarget = 1;
                found = true;
                break;
              }
            }
          }
          if (!found) this.pullTarget = Math.max(0.3, Math.min(this.pullTarget, hit - 0.12));
        }
      }
    }
    this.swing = damp(this.swing, this.swingTarget, 2.2, dt);
    this.pull = damp(this.pull, this.pullTarget, this.pullTarget < this.pull ? 6 : 1.2, dt);
  }

  /**
   * Escape choreography per variant, as an orbit around the runner (angle 0 = behind, π = in
   * front). Bigger escapes orbit wider and crane higher, slower.
   */
  private escapeFrame(T0: number, s: number): Frame {
    const e = this.epic;
    const T = T0 / (1 + 0.4 * e);
    let a: number;
    let r: number;
    let up: number;
    let lAlong: number;
    let lUp: number;
    let fov: number;
    const low = ease((T - 2.3) / 1.1);
    switch (this.escapeShot) {
      case 'salute':
        // Stay behind: the runner turns back to face the lens for the salute.
        a = lerp(0.15, 0.55, ease((T - 0.3) / 2));
        r = lerp(3.2, 3.6, ease(T / 2));
        up = lerp(1.6, 1.3, ease((T - 1) / 1.5));
        lAlong = lerp(2.5, 0, ease(T / 1.4));
        lUp = 1.35;
        fov = lerp(52, 46, ease((T - 1) / 2));
        break;
      case 'leap':
        // Swing out to profile to watch the leap, then on round to a low three-quarter front.
        a = lerp(0.2, 1.45, ease(T / 0.8)) + lerp(0, 0.75, ease((T - 1.6) / 2));
        r = lerp(3.4, 3.9, ease(T / 0.8)) - 0.6 * low;
        up = lerp(1.5, 1.2, ease(T / 0.8)) - 0.25 * low;
        lAlong = lerp(2.5, 0, ease(T / 1.2));
        lUp = lerp(1.3, 1.5, low);
        fov = lerp(54, 46, low);
        break;
      case 'cheer':
        // Round to the front, low, looking up at the raised fists.
        a = T < 0.35 ? 0.15 : lerp(0.15, 2.55, ease((T - 0.35) / 2.0));
        r = lerp(3.1, 2.6, low);
        up = lerp(1.6, 0.75, low);
        lAlong = T < 0.35 ? 3 : lerp(1.5, 0, ease((T - 0.35) / 1.5));
        lUp = lerp(1.25, 1.65, low);
        fov = lerp(52, 47, low);
        break;
      default:
        // Look-back: orbit round to a three-quarter front as they stop, then low for the fist.
        a = T < 0.45 ? 0.15 : lerp(0.15, 2.25, ease((T - 0.45) / 2.1)) + Math.max(0, T - 3.4) * 0.03;
        r = lerp(3.1, 2.75, low);
        up = lerp(T < 0.45 ? 1.65 : 1.5, 0.95, low);
        lAlong = T < 0.45 ? 3 : lerp(1.5, 0, ease((T - 0.45) / 1.5));
        lUp = lerp(1.2, 1.5, low);
        fov = lerp(52, 45, low);
    }
    // Grand escapes: a wider orbit that cranes up as it settles.
    const crane = e * ease((T - 1.2) / 2.5);
    r *= 1 + 0.35 * e;
    up += 1.1 * crane;
    fov += 3 * e;
    return { along: -Math.cos(a) * r, lat: s * Math.sin(a) * r, up, lAlong, lLat: 0, lUp: lUp + 0.2 * crane, focus: 0, fov };
  }

  /** Crash choreography per staging, in the runner's frame (s = the open side). */
  private crashFrame(T: number, s: number): Frame {
    const f = this.crashBase(T, s);
    if (this.crashShot === 'gate') return f;
    const grow = ease(T / 2) * this.epic;
    const v = this.variant ? -0.35 : 0;
    return { ...f, along: f.along * (1 + 0.35 * grow), up: f.up + 1.0 * grow + v * ease(T / 2), fov: f.fov + 2 * grow };
  }

  private crashBase(T: number, s: number): Frame {
    switch (this.crashShot) {
      case 'gate':
        // Hold the chase and tilt up as the slab drops, then crane well back and up, off-axis: the
        // whole slab with sky above it, the walls either side, the runner small but clear in front.
        return track(
          [
            [0, F(-3.2, 0.3 * s, 1.9, 4, 0, 2.8, 60, 0)],
            [0.6, F(-4.4, 0.6 * s, 2.4, 3, 0, 2.6, 60, 0.2)],
            [2.6, F(-9.2, 1.55 * s, 3.4, 2.6, 0, 2.2, 62, 0)],
            [7, F(-8.6, 1.7 * s, 3.2, 2.6, 0.3 * s, 2.2, 61, 0)],
          ],
          T,
        );
      case 'chasm':
        // Look down as the slabs go, then crane up and aside over the runner's shoulder: the runner
        // teetering at the lip in the foreground, the gap and the falling slabs beyond. A slow push.
        return track(
          [
            [0, F(-2.8, 0.2 * s, 1.85, 5, 0, 0.3, 58, 0)],
            [0.55, F(-3.0, 0.8 * s, 2.3, 4, 0, 0.1, 57, 0.3)],
            [2.0, F(-3.3, 1.55 * s, 3.3, 3, 0, -0.4, 55, 0.5)],
            [6.5, F(-2.6, 1.7 * s, 2.7, 3, 0, -0.2, 52, 0.45)],
          ],
          T,
        );
      default:
        // Rockfall: pull back and look up into what is coming, then settle low and aside on the
        // crouched runner with the blocks beyond.
        return track(
          [
            [0, F(-3.0, 0.2 * s, 1.55, 3, 0, 3.4, 60, 0)],
            [0.45, F(-3.6, 0.6 * s, 1.35, 2, 0, 2.6, 58, 0.2)],
            [1.5, F(-3.7, 1.25 * s, 1.05, 0, 0, 1.0, 53, 0.5)],
            [6.5, F(-3.1, 1.5 * s, 1.25, 0, 0, 0.9, 50, 0.45)],
          ],
          T,
        );
    }
  }

  update(dt: number, runnerPos: THREE.Vector3, runnerYaw: number, intensity: number): void {
    this.t += dt;
    this.modeT += dt;
    const fov = this.computeTarget(runnerPos, runnerYaw, intensity, dt);
    this.clearance(dt);
    const running = this.mode === 'run';
    const stiff = running ? 7.5 : this.mode === 'title' ? 1.2 : this.mode === 'lead' ? 2.4 : 3.2;
    dampV(this.pos, this.targetPos, stiff, dt);
    if (running) {
      // Hold the chase distance along the route; springs only carry sway and height. For the first
      // moments of a run the hold is loose, so the runner bursts away before the lens catches up.
      const along = this.tmp.copy(this.targetPos).sub(this.pos).dot(this.fwd);
      const hold = 30 * (0.12 + 0.88 * ease(this.modeT / 0.9));
      this.pos.addScaledVector(this.fwd, along * (1 - Math.exp(-dt * hold)));
    }
    if (this.mode === 'cashout' || this.mode === 'crash') {
      // Settled shots: keep up with a runner still carrying speed (a big escape's run-out) along the
      // route, so the figure never shrinks into the distance while the springs catch up.
      const along = this.tmp.copy(this.targetPos).sub(this.pos).dot(this.fwd);
      this.pos.addScaledVector(this.fwd, along * (1 - Math.exp(-dt * 6)));
    }
    dampV(this.look, this.targetLook, stiff * 1.4, dt);
    this.constrain(this.pos);
    // Never let the lens dip under the runner's feet.
    this.pos.y = Math.max(this.pos.y, runnerPos.y + 0.6);
    // Portrait screens: open the vertical angle so the way ahead still fits across.
    const a = this.camera.aspect;
    const portrait = a < 1 ? Math.min(1.55, 1 + (1 - a) * 0.95) : 1;
    this.fovKick *= Math.exp(-dt * 2.2);
    this.fov = damp(this.fov, Math.min((fov + this.fovKick) * portrait, 96), 2.5, dt);

    // Operator: footfall bob and a little sway on a spring.
    const n = Math.max(1, Math.ceil(dt * 120));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.bobV += (-160 * this.bob - 15 * this.bobV) * h;
      this.bob += this.bobV * h;
      this.swayV += (-60 * this.sway - 9 * this.swayV) * h;
      this.sway += this.swayV * h;
    }
    // Bank a touch into turns.
    const yawRate = dt > 0 ? angleDelta(this.lastYaw, runnerYaw) / dt : 0;
    this.lastYaw = runnerYaw;
    const bank = 0.05 * (1 + 0.25 * this.drive);
    this.dutch = damp(this.dutch, running ? THREE.MathUtils.clamp(yawRate * bank, -0.08, 0.08) * this.motionScale : 0, 3, dt);

    this.trauma = Math.max(0, this.trauma - dt * 0.9);
    const m = this.shakeEnabled ? this.motionScale : 0;
    // Continuous tremor rises with intensity; trauma adds sharp shake on impacts.
    const base = running ? 0.008 + 0.045 * intensity * intensity : 0.003;
    const amp = (base + this.trauma * this.trauma * 0.35) * m;
    const t = this.t;
    const sx = (Math.sin(t * 17.3) * 0.6 + Math.sin(t * 31.1 + 1.3) * 0.4) * amp;
    const sy = (Math.sin(t * 21.7 + 0.7) * 0.6 + Math.sin(t * 43.3 + 2.1) * 0.4) * amp;
    // A slow handheld breath outside the run.
    const breathe = running ? 0 : Math.sin(t * 0.7) * 0.012 * this.motionScale;

    this.camera.position.copy(this.pos);
    this.camera.position.addScaledVector(this.right, sx + this.sway);
    this.camera.position.y += sy + this.bob + breathe;
    this.camera.lookAt(this.look);
    this.camera.rotateZ((Math.sin(t * 13.1) * 0.5 + Math.sin(t * 7.7)) * amp * 0.25 + this.dutch);
    this.camera.fov = this.fov;
    this.applyShift(dt);
    this.camera.updateProjectionMatrix();
  }

  private shift = 0;
  private shiftTarget = 0;
  /** Compose for the part of the screen the interface leaves free (px covered at top/bottom). */
  setInsets(top: number, bottom: number, heightPx: number): void {
    this.shiftTarget = Math.min(0.32, Math.max(-0.1, (bottom - top) / 2 / Math.max(1, heightPx)));
  }

  private applyShift(dt: number) {
    this.shift += (this.shiftTarget - this.shift) * (1 - Math.exp(-dt * 3));
    const c = this.camera;
    if (Math.abs(this.shift) < 0.001) {
      if (c.view) c.clearViewOffset();
      return;
    }
    const w = 1000;
    const h = w / c.aspect;
    c.setViewOffset(w, h, 0, this.shift * h, w, h);
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }
}
