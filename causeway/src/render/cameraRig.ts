import * as THREE from 'three';

export type CamMode = 'title' | 'setup' | 'lead' | 'run' | 'crash' | 'cashout';
export type CrashShot = 'chasm' | 'gate' | 'rockfall';

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

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 2400);
  }

  setMode(m: CamMode, opts: { side?: number; shot?: CrashShot } = {}): void {
    if (opts.side) this.side = opts.side;
    if (opts.shot) this.crashShot = opts.shot;
    if (m === this.mode) return;
    this.mode = m;
    this.modeT = 0;
  }

  /** Snap to the current target (after a teleport such as a new round). */
  snap(runnerPos: THREE.Vector3, runnerYaw: number): void {
    this.yaw = runnerYaw;
    this.lastYaw = runnerYaw;
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
        fov = this.shot(runnerPos, F(-2.75, 0.5, 1.66, 7, 0.2, 1.2, 54));
        break;
      }
      case 'lead': {
        // Low beside the coiled runner, easing in: the held breath before the go.
        const p = ease(T / 1.2);
        fov = this.shot(runnerPos, F(lerp(-2.45, -1.95, p), lerp(0.62, 0.78, p), lerp(1.2, 1.02, p), 7, 0.1, 1.05, lerp(52, 47, p)));
        break;
      }
      case 'run': {
        const dist = 2.7 + 0.45 * I;
        fov = this.shot(runnerPos, F(-dist, 0, 1.68 - 0.1 * I, 6.5, 0, 1.12, 57 + 12 * I));
        break;
      }
      case 'crash': {
        fov = this.shot(runnerPos, this.crashFrame(T, s));
        break;
      }
      case 'cashout': {
        // Out of the chase, orbit round to a three-quarter front as they stop, then drop low for
        // the raised fist; a slow drift holds the moment.
        const a = T < 0.45 ? 0.15 : lerp(0.15, 2.25, ease((T - 0.45) / 2.1)) + Math.max(0, T - 3.4) * 0.03;
        const low = ease((T - 2.3) / 1.1);
        const r = lerp(3.1, 2.75, low);
        fov = this.shot(runnerPos, {
          along: -Math.cos(a) * r,
          lat: s * Math.sin(a) * r,
          up: lerp(T < 0.45 ? 1.65 : 1.5, 0.95, low),
          lAlong: T < 0.45 ? 3 : lerp(1.5, 0, ease((T - 0.45) / 1.5)),
          lLat: 0,
          lUp: lerp(1.2, 1.5, low),
          focus: 0,
          fov: lerp(52, 45, low),
        });
        break;
      }
    }
    this.constrain(this.targetPos);
    return fov;
  }

  /** Crash choreography per staging, in the runner's frame (s = the open side). */
  private crashFrame(T: number, s: number): Frame {
    switch (this.crashShot) {
      case 'gate':
        // Hold the chase and tilt up as the slab drops, then crane back and aside to show the runner
        // before the sealed way, then a slow push in.
        return track(
          [
            [0, F(-3.2, 0.3 * s, 1.9, 4, 0, 2.8, 60, 0)],
            [0.6, F(-4.2, 0.5 * s, 2.3, 3, 0, 2.3, 60, 0.3)],
            [2.2, F(-5.8, 1.5 * s, 3.4, 0, 0, 1.6, 54, 0.4)],
            [6.5, F(-5.0, 1.3 * s, 2.9, 0, 0, 1.4, 52, 0.4)],
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
    this.dutch = damp(this.dutch, running ? THREE.MathUtils.clamp(yawRate * 0.05, -0.06, 0.06) * this.motionScale : 0, 3, dt);

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
