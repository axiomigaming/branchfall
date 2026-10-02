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

/** Closest a cinematic (crash or escape) lens may come to the runner's head, in metres. */
const MIN_SHOT = 2.35;

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
  /** 0..1, set by the game: the runner has dropped into a chasm and the lens tilts down after them. */
  gap = 0;
  /** Metres from the runner to the escape's gate of light (set by the game), for the push. */
  gateAhead = 12;
  /**
   * Set by the game when the result card appears: the settled shot then keeps the whole runner in
   * the band between the card (reported as the top inset) and the dock.
   */
  revealed = false;
  private revealK = 0;
  /** 0..1: how far a settled escape ends on a vista over the runner's shoulder. */
  private reveal = 0;
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

  setMode(m: CamMode, opts: { side?: number; shot?: CrashShot; escape?: EscapeShot; variant?: number; epic?: number; reveal?: number } = {}): void {
    if (opts.side) this.side = opts.side;
    if (opts.reveal !== undefined) this.reveal = opts.reveal;
    else if (m !== this.mode) this.reveal = 0;
    if (opts.shot) this.crashShot = opts.shot;
    if (opts.escape) this.escapeShot = opts.escape;
    if (opts.variant !== undefined) this.variant = opts.variant;
    if (opts.epic !== undefined) this.epic = opts.epic;
    if (m === this.mode) return;
    this.gap = 0;
    this.revealed = false;
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
    // A new round starts clean: no leftover shake, lens punch or jolt from the last cinematic.
    this.trauma = 0;
    this.fovKick = 0;
    this.bob = this.bobV = this.sway = this.swayV = 0;
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
    this.bobV -= (0.22 + 0.34 * strength) * this.motionScale;
    this.swayV += (foot === 'L' ? -1 : 1) * 0.06 * strength * this.motionScale;
    // Each plant flares the lens open a hair, more as he drives: the cadence is felt, not only seen.
    if (this.mode === 'run') this.fovKick += (0.35 + 0.25 * Math.min(4, this.drive) * 0.25) * strength * this.motionScale;
  }

  /**
   * An impact in a cinematic: the operator is jolted (a downward knock on the bob spring) and the
   * lens punches in by `deg`. Scaled by the motion setting.
   */
  jolt(strength: number, deg: number): void {
    this.bobV -= strength * 1.4 * this.motionScale;
    this.swayV += (Math.random() - 0.5) * strength * 0.8 * this.motionScale;
    this.fovKick -= deg * this.motionScale;
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

  /**
   * After the result card appears: stand back far enough that the whole runner fits ~75 % of the
   * band between the card and the dock, and aim at the hips, so the view offset (applyShift) sets
   * him in the middle of that band, under the card. Not while the lens looks down into a chasm.
   */
  private resultFrame(f: Frame): Frame {
    const k = this.revealK;
    if (k <= 0.001 || this.gap > 0.5) return f;
    const band = Math.max(0.25, 1 - this.insetTop - this.insetBottom);
    const a = this.camera.aspect;
    const lens = Math.min(96, f.fov * (a < 1 ? Math.min(1.55, 1 + (1 - a) * 0.95) : 1));
    const need = 1.95 / (0.75 * band * 2 * Math.tan((lens * Math.PI) / 360));
    const dy = f.up - 1.0;
    const d0 = Math.max(0.3, Math.hypot(f.along, f.lat, dy));
    const m = d0 < need ? need / d0 : 1;
    const out: Frame = { ...f, along: f.along * m, lat: f.lat * m, up: 1.0 + dy * m, lAlong: lerp(f.lAlong, 0.3, 0.85), lLat: lerp(f.lLat, 0, 0.85), lUp: lerp(f.lUp, 0.95, 0.85), focus: f.focus * 0.15 };
    return mixFrame(f, out, k);
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
        // On a tall screen the lens opens ~40 % wider vertically, so at 5.4 m the high pass looked
        // straight into the crowns of the arches over the road (7–8 m): big soft blocks across the
        // top of every phone title. There it rides above them instead.
        const tall = Math.min(1, Math.max(0, (1 - this.camera.aspect) / 0.5));
        fov = this.shot(runnerPos, {
          along: lerp(-8.5, -2.3, c),
          lat: lerp(-0.5, -1.45, c) + drift,
          up: lerp(5.4 + 4.4 * tall, 1.05, Math.pow(c, 1.5)),
          lAlong: lerp(22, 6, c),
          lLat: lerp(0.2, 0.95, c),
          lUp: lerp(0.4, 1.55, c),
          focus: 0,
          fov: lerp(50, 44, c),
        });
        break;
      }
      case 'setup': {
        // The whole runner stands in the band the interface leaves free (the view offset centres
        // that band, see setInsets): stand back far enough that head to feet fill ~60 % of it,
        // and aim at the hips.
        const sfov = 52;
        // The lens as update() will open it on a portrait screen (see `portrait` there).
        const a = this.camera.aspect;
        const lens = Math.min(96, sfov * (a < 1 ? Math.min(1.55, 1 + (1 - a) * 0.95) : 1));
        const span = 0.6 * this.free * 2 * Math.tan((lens * Math.PI) / 360);
        const back = Math.min(7.5, Math.max(2.75, 1.95 / span));
        fov = this.shot(runnerPos, F(-back, 0.25 + 0.06 * back, 1.15 + 0.12 * back, 0.6, 0.1, 0.92, sfov));
        break;
      }
      case 'lead': {
        // Low beside the coiled runner, easing in: the held breath before the go.
        const p = ease(T / 1.2);
        fov = this.shot(runnerPos, this.fitInBand(F(lerp(-2.45, -1.95, p), lerp(0.62, 0.78, p), lerp(1.2, 1.02, p), 7, 0.1, 1.05, lerp(52, 47, p))));
        break;
      }
      case 'run': {
        // Low and close on a wide lens (the references): shoulder height, the runner big and left
        // of centre, the way ahead open to the right. Energy rises with the run tier: closer and
        // lower at the top tiers, a wider lens, a drift. fitInBand keeps him whole, boots
        // included, above the cash-out plate.
        const d = this.drive;
        const hi = Math.max(0, d - 2.5);
        const dist = 2.2 + 0.3 * I - 0.1 * hi;
        const drift = 0.22 * I * Math.sin(this.t * 0.37) * this.motionScale;
        // Round 8: a three-quarter view over his right shoulder, a hand lower than before. Straight
        // from behind the forward lean of the run (9°) and the sprint (17°) vanished into his own
        // silhouette and read as an upright jog; from the side and below it reads as drive.
        fov = this.shot(runnerPos, this.fitInBand(F(-dist, 0.72 + drift, 1.34 - 0.06 * I - 0.05 * hi, 9, 0.6 + drift * 0.4, 1.0, 60 + 16 * I + 2 * hi)));
        break;
      }
      case 'crash': {
        fov = this.shot(runnerPos, this.resultFrame(this.settled(this.crashFrame(T / (1 + 0.5 * this.epic), s))));
        break;
      }
      case 'cashout': {
        fov = this.shot(runnerPos, this.resultFrame(this.settled(this.escapeFrame(T, s))));
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
          // Pull in front of the obstacle — but a cinematic never closes to a face-filling close-up.
          const len = this.cand.distanceTo(this.eye.set(this.runnerAt.x, this.runnerAt.y + 1.3, this.runnerAt.z));
          const floor = run ? 0.3 : Math.min(1, MIN_SHOT / Math.max(0.01, len));
          if (!found) this.pullTarget = Math.max(floor, Math.min(this.pullTarget, hit - 0.12));
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
        a = lerp(0.15, 0.6, ease((T - 0.3) / 2));
        r = lerp(3.6, 4.3, ease(T / 2));
        up = lerp(1.7, 1.45, ease((T - 1) / 1.5));
        lAlong = lerp(2.5, 0, ease(T / 1.4));
        lUp = lerp(1.25, 1.05, ease((T - 1) / 2));
        fov = lerp(52, 48, ease((T - 1) / 2));
        break;
      case 'leap':
        // Swing out to profile to watch the leap, then on round to a low three-quarter front.
        a = lerp(0.2, 1.45, ease(T / 0.8)) + lerp(0, 0.75, ease((T - 1.6) / 2));
        r = lerp(3.8, 4.4, ease(T / 0.8)) - 0.2 * low;
        up = lerp(1.5, 1.25, ease(T / 0.8)) - 0.15 * low;
        lAlong = lerp(2.5, 0, ease(T / 1.2));
        lUp = lerp(1.2, 1.1, low);
        fov = lerp(54, 49, low);
        break;
      case 'cheer':
        // Round to the front, low, looking up at the raised fists.
        a = T < 0.35 ? 0.15 : lerp(0.15, 2.55, ease((T - 0.35) / 2.0));
        r = lerp(3.6, 4.1, low);
        up = lerp(1.6, 0.95, low);
        lAlong = T < 0.35 ? 3 : lerp(1.5, 0, ease((T - 0.35) / 1.5));
        lUp = lerp(1.2, 1.2, low);
        fov = lerp(52, 50, low);
        break;
      default:
        // Look-back: orbit round to a three-quarter front as they stop, then low for the fist.
        a = T < 0.45 ? 0.15 : lerp(0.15, 2.25, ease((T - 0.45) / 2.1)) + Math.max(0, T - 3.4) * 0.03;
        r = lerp(3.6, 4.0, low);
        up = lerp(T < 0.45 ? 1.65 : 1.5, 1.1, low);
        lAlong = T < 0.45 ? 3 : lerp(1.5, 0, ease((T - 0.45) / 1.5));
        lUp = lerp(1.2, 1.15, low);
        fov = lerp(52, 48, low);
    }
    // Grand escapes: a wider orbit that cranes up as it settles.
    const crane = e * ease((T - 1.2) / 2.5);
    r *= 1 + 0.35 * e;
    up += 1.1 * crane;
    fov += 3 * e;
    lUp += 0.2 * crane;
    // The threshold: after the first beat the lens swings round behind the runner's shoulder and
    // pushes slowly toward the gate of light ahead (the way stays whole and calm), the runner a
    // silhouette against the daylight.
    const v = this.reveal * ease((T - 1.4) / 1.8);
    if (v > 0) {
      const push = ease((T - 2.6) / 4);
      a = lerp(a, 0.32, v);
      r = lerp(r, 5.0 + 0.6 * e - 1.3 * push, v);
      up = lerp(up, 1.9 + 0.5 * e, v);
      lAlong = lerp(lAlong, this.gateAhead, v);
      lUp = lerp(lUp, 2.4, v);
      fov = lerp(fov, 56 + 3 * e, v);
    }
    // Portrait: the lens is already opened up for width; come in so the figure keeps its size.
    if (this.camera.aspect < 1) r *= 0.66;
    return { along: -Math.cos(a) * r, lat: s * Math.sin(a) * r, up, lAlong, lLat: 0, lUp, focus: 0, fov };
  }

  /** Crash choreography per staging, in the runner's frame (s = the open side). */
  private crashFrame(T: number, s: number): Frame {
    const f = this.crashBase(T, s);
    // A big fall pulls wider and cranes higher, slowly, to take in the whole collapse.
    const grow = ease(T / 2.6) * this.epic;
    // A tall screen already opens the lens (and settles further back): stay closer on the gate.
    const tall = this.camera.aspect < 1 ? 0.8 : 1;
    if (this.crashShot === 'gate') return { ...f, along: f.along * (1 + 0.18 * grow) * tall, up: f.up + 0.7 * grow, lUp: f.lUp + 0.4 * grow, fov: f.fov + 2 * grow };
    const v = this.variant ? -0.35 : 0;
    const out = { ...f, along: f.along * (1 + 0.5 * grow), lat: f.lat * (1 + 0.25 * grow), up: f.up + 1.6 * grow + v * ease(T / 2), fov: f.fov + 4 * grow };
    // The runner went down with the floor: lean out over the lip and tilt down into the gap.
    if (this.crashShot === 'chasm' && this.gap > 0) return mixFrame(out, F(-1.3, 1.1 * s, 3.1, 1.2, 0, -2.8, 56, 0), this.gap);
    return out;
  }

  private crashBase(T: number, s: number): Frame {
    switch (this.crashShot) {
      case 'gate':
        // Pull back and rise at once, eyes up on the door coming down, then settle off-axis and
        // high: the runner, the broken slabs and the carved door together, never the door alone.
        return track(
          [
            [0, F(-3.2, 0.3 * s, 1.9, 4, 0, 2.8, 60, 0)],
            [0.4, F(-5.6, 1.1 * s, 2.6, 3, 0, 3.4, 62, 0.25)],
            [1.2, F(-6.8, 1.8 * s, 3.4, 2.4, 0, 1.6, 58, 0)],
            // Settle high and aside, looking down the broken way: the runner, the gap, the door.
            [3.0, F(-5.6, 1.9 * s, 3.7, 1.8, 0, 0.9, 57, 0)],
            [7, F(-5.3, 1.9 * s, 3.5, 1.8, 0.2 * s, 0.9, 56, 0)],
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

  /** Medium-shot floor for the cinematics: the lens stays ≥ MIN_SHOT from the runner's head. */
  private keepMedium(runnerPos: THREE.Vector3): void {
    const head = this.tmp.set(runnerPos.x, runnerPos.y + 1.62, runnerPos.z);
    const d = this.pos.distanceTo(head);
    if (d >= MIN_SHOT) return;
    const dir = this.pos.clone().sub(head);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.3, 1);
    this.pos.copy(head).addScaledVector(dir.normalize(), MIN_SHOT);
    this.constrain(this.pos);
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
      // An escape's run-out carries real speed for its first second: keep up harder then.
      const k = this.mode === 'cashout' && this.modeT < 1.6 ? 10 : 6;
      this.pos.addScaledVector(this.fwd, along * (1 - Math.exp(-dt * k)));
    }
    dampV(this.look, this.targetLook, stiff * 1.4, dt);
    this.constrain(this.pos);
    if (this.mode === 'cashout' || this.mode === 'crash') this.keepMedium(runnerPos);
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
    const bank = 0.08 * (1 + 0.25 * this.drive);
    this.dutch = damp(this.dutch, running ? THREE.MathUtils.clamp(yawRate * bank, -0.12, 0.12) * this.motionScale : 0, 3, dt);

    this.trauma = Math.max(0, this.trauma - dt * 0.9);
    const m = this.shakeEnabled ? this.motionScale : 0;
    // Continuous tremor rises with intensity; trauma adds sharp shake on impacts.
    const base = running ? 0.008 + 0.045 * intensity * intensity : 0.003;
    const amp = (base + this.trauma * this.trauma * 0.35) * m;
    const t = this.t;
    const sx = (Math.sin(t * 17.3) * 0.6 + Math.sin(t * 31.1 + 1.3) * 0.4) * amp;
    const sy = (Math.sin(t * 21.7 + 0.7) * 0.6 + Math.sin(t * 43.3 + 2.1) * 0.4) * amp;
    // A slow handheld breath outside the run; in the run, an operator's sway (low, uneven).
    const breathe = running ? 0 : Math.sin(t * 0.7) * 0.012 * this.motionScale;
    const hand = running ? this.motionScale * (0.6 + 0.4 * intensity) : 0;
    const hx = (Math.sin(t * 1.13) * 0.6 + Math.sin(t * 2.31 + 1.0) * 0.4) * 0.035 * hand;
    const hy = (Math.sin(t * 1.57 + 0.4) * 0.6 + Math.sin(t * 2.9 + 2.2) * 0.4) * 0.022 * hand;
    const hr = (Math.sin(t * 0.83 + 0.9) * 0.7 + Math.sin(t * 1.9) * 0.3) * 0.009 * hand;

    this.camera.position.copy(this.pos);
    this.camera.position.addScaledVector(this.right, sx + this.sway + hx);
    this.camera.position.y += sy + this.bob + breathe + hy;
    this.camera.lookAt(this.look);
    if (this.mode === 'run' || this.mode === 'lead') this.holdInBand(runnerPos);
    this.camera.rotateZ((Math.sin(t * 13.1) * 0.5 + Math.sin(t * 7.7)) * amp * 0.25 + this.dutch + hr);
    this.camera.fov = this.fov;
    this.revealK += ((this.revealed && (this.mode === 'crash' || this.mode === 'cashout') ? 1 : 0) - this.revealK) * (1 - Math.exp(-dt * 2.5));
    // The title fly-over rides high over the causeway, level with the arch crowns: their stones
    // passed a metre or two above the lens and filled the top of a phone frame as huge, soft blocks.
    // Nothing the title is about is nearer than the runner, so its near plane follows him: up to
    // 6.5 m out on the high pass (the floor is ≥ 9 m below it there), ~1.5 m on the low pass.
    if (this.mode === 'title') {
      const d = this.camera.position.distanceTo(this.tmp.copy(runnerPos).setY(runnerPos.y + 1));
      this.camera.near = Math.min(6.5, Math.max(0.1, 0.55 * d));
    } else this.camera.near = 0.1;
    this.applyShift(dt);
    this.camera.updateProjectionMatrix();
  }

  private shift = 0;
  private shiftTarget = 0;
  /** Compose for the part of the screen the interface leaves free (px covered at top/bottom). */
  setInsets(top: number, bottom: number, heightPx: number): void {
    this.shiftTarget = Math.min(0.32, Math.max(-0.1, (bottom - top) / 2 / Math.max(1, heightPx)));
    this.free = Math.min(1, Math.max(0.3, 1 - (Math.max(0, top) + Math.max(0, bottom)) / Math.max(1, heightPx)));
    this.insetTop = Math.min(0.45, Math.max(0, top / Math.max(1, heightPx)));
    this.insetBottom = Math.min(0.6, Math.max(0, bottom / Math.max(1, heightPx)));
  }
  /** Fraction of the screen height the interface leaves free (1 with no insets). */
  private free = 1;
  private insetTop = 0;
  private insetBottom = 0;

  /**
   * Keep the whole runner, boots to head, in the band the interface leaves free. In the unshifted
   * projection (NDC y, before the view offset moves the frame by `shift`) that band runs from
   * -1 - 2s + 2b (the dock's top edge) to 1 - 2s - 2t (the top bar's lower edge). The frame first
   * tilts down until the boots clear the dock line; if the head would then leave the top of the band,
   * it stands further back and tries again. Only lowers the aim or pulls back, never the reverse.
   */
  /**
   * fitInBand composes the target; the lens itself trails it on springs (further behind the faster
   * he runs), so check the real view too: if the boots sit below the dock line, tilt down just enough,
   * never so far that the crown leaves the top of the band.
   */
  private holdInBand(runnerPos: THREE.Vector3): void {
    const c = this.camera;
    const s = this.shift;
    const lo = -1 - 2 * s + 2 * this.insetBottom + 0.11;
    const hi = 1 - 2 * s - 2 * this.insetTop - 0.05;
    if (hi - lo < 0.2) return;
    const tanHF = Math.tan((this.fov * Math.PI) / 360);
    c.updateMatrixWorld();
    const inv = this.tmpInv.copy(c.matrixWorld).invert();
    const f = this.eye.copy(runnerPos).applyMatrix4(inv);
    const hd = this.cand.copy(runnerPos).setY(runnerPos.y + 1.8).applyMatrix4(inv);
    if (f.z > -0.3 || hd.z > -0.3) return;
    const elevFeet = Math.atan2(f.y, -f.z);
    const elevHead = Math.atan2(hd.y, -hd.z);
    const need = Math.atan(lo * tanHF) - elevFeet; // > 0: boots below the line
    if (need <= 0) return;
    const room = Math.max(0, Math.atan(hi * tanHF) - elevHead);
    const tilt = Math.min(need, room);
    if (tilt > 1e-4) c.rotateX(-tilt);
  }
  private tmpInv = new THREE.Matrix4();

  private fitInBand(f: Frame): Frame {
    const s = this.shiftTarget;
    // The bottom margin clears the gem crest that stands proud of the cash-out plate's top edge.
    const lo = -1 - 2 * s + 2 * this.insetBottom + 0.11;
    const hi = 1 - 2 * s - 2 * this.insetTop - 0.05;
    if (hi - lo < 0.2) return f;
    const a = this.camera.aspect;
    const lens = Math.min(96, f.fov * (a < 1 ? Math.min(1.55, 1 + (1 - a) * 0.95) : 1));
    const tanHF = Math.tan((lens * Math.PI) / 360);
    const H = 1.8; // boots to crown, metres
    const U = f.up;
    let D = Math.max(0.5, -f.along);
    const reach = f.lAlong + D;
    const theta0 = Math.atan2(U - f.lUp, reach);
    let theta = theta0;
    for (let i = 0; i < 10; i++) {
      const tMin = Math.atan2(U, D) + Math.atan(lo * tanHF);
      const tMax = Math.atan(hi * tanHF) - Math.atan2(H - U, D);
      theta = Math.max(theta0, tMin);
      if (theta <= tMax) break;
      D *= 1.1;
    }
    if (theta === theta0 && D === -f.along) return f;
    const k = D / Math.max(0.5, -f.along);
    return { ...f, along: -D, lat: f.lat * k, lUp: U - Math.tan(theta) * (f.lAlong + D) };
  }

  private applyShift(dt: number) {
    // A settled shot under the result card centres the band between the card and the dock, which
    // can sit higher than the run's own limits allow.
    const cine = this.revealK > 0.001 ? Math.min(0.32, Math.max(-0.3, (this.insetBottom - this.insetTop) / 2)) : this.shiftTarget;
    const target = lerp(this.shiftTarget, cine, this.revealK);
    this.shift += (target - this.shift) * (1 - Math.exp(-dt * 3));
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
