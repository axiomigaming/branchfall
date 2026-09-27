import * as THREE from 'three';

export type CamMode = 'title' | 'setup' | 'run' | 'crash' | 'cashout';

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const dampV = (a: THREE.Vector3, b: THREE.Vector3, k: number, dt: number) => a.lerp(b, 1 - Math.exp(-k * dt));

function angleDelta(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * A chase camera with weight: the position lags on a spring, the heading lags
 * the route, the lens widens with speed, and shake comes from "trauma" that
 * decays. Every mode is a target the same springs move toward, so switching
 * modes is always a camera move, never a cut.
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
  private orbit = 0;
  private side = 1;
  shakeEnabled = true;
  motionScale = 1;
  /** Extra focus point for crash framing (the hazard). */
  focus = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 2400);
  }

  setMode(m: CamMode, opts: { side?: number } = {}): void {
    if (m === this.mode) return;
    this.mode = m;
    this.modeT = 0;
    if (opts.side) this.side = opts.side;
    if (m === 'crash' || m === 'cashout') this.orbit = 0;
  }

  /** Snap to the current target (after a teleport such as a new round). */
  snap(runnerPos: THREE.Vector3, runnerYaw: number): void {
    this.yaw = runnerYaw;
    this.computeTarget(runnerPos, runnerYaw, 0, 1 / 60, true);
  }

  addTrauma(x: number): void {
    this.trauma = Math.min(1, this.trauma + x);
  }

  private targetPos = new THREE.Vector3();
  private targetLook = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();

  private computeTarget(runnerPos: THREE.Vector3, runnerYaw: number, intensity: number, dt: number, snap = false) {
    const k = snap ? 1e6 : 1;
    this.yaw += angleDelta(this.yaw, runnerYaw) * (1 - Math.exp(-(this.mode === 'run' ? 2.6 : 1.6) * dt * k));
    const yaw = this.yaw;
    this.fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const I = intensity;
    let fov = 55;
    switch (this.mode) {
      case 'title': {
        // A slow crane behind the runner, looking down the causeway: the path is the subject.
        const a = Math.sin(this.t * 0.06) * 0.22 + 0.12;
        const r = 6.2 + Math.sin(this.t * 0.045) * 0.8;
        const dir = new THREE.Vector3().copy(this.fwd).multiplyScalar(-Math.cos(a)).addScaledVector(this.right, Math.sin(a));
        this.targetPos.copy(runnerPos).addScaledVector(dir, r).setY(runnerPos.y + 3.1 + Math.sin(this.t * 0.08) * 0.35);
        this.targetLook.copy(runnerPos).addScaledVector(this.fwd, 14).setY(runnerPos.y + 1.4);
        fov = 52;
        break;
      }
      case 'setup': {
        this.targetPos.copy(runnerPos).addScaledVector(this.fwd, -2.75).addScaledVector(this.right, 0.5).setY(runnerPos.y + 1.66);
        this.targetLook.copy(runnerPos).addScaledVector(this.fwd, 7).addScaledVector(this.right, 0.2).setY(runnerPos.y + 1.2);
        fov = 54;
        break;
      }
      case 'run': {
        const dist = 2.75 + 0.55 * I;
        this.targetPos.copy(runnerPos).addScaledVector(this.fwd, -dist).setY(runnerPos.y + 1.68 - 0.1 * I);
        this.targetLook.copy(runnerPos).addScaledVector(this.fwd, 6.5).setY(runnerPos.y + 1.12);
        fov = 58 + 16 * I;
        break;
      }
      case 'crash': {
        // Crane up and back, staying inside the corridor: runner in the foreground, the fall ahead.
        this.orbit = damp(this.orbit, 1, 1.3, dt);
        const o = this.orbit;
        this.targetPos
          .copy(runnerPos)
          .addScaledVector(this.fwd, -(3.0 + 2.2 * o))
          .addScaledVector(this.right, this.side * (0.4 + 0.9 * o))
          .setY(runnerPos.y + 1.9 + 2.9 * o);
        this.targetLook.copy(runnerPos).lerp(this.focus, 0.55).setY(runnerPos.y + 0.5);
        fov = 56;
        break;
      }
      case 'cashout': {
        this.orbit = damp(this.orbit, 1, 1.1, dt);
        const ang = this.side * (0.2 + 2.55 * this.orbit);
        const dir = new THREE.Vector3().copy(this.fwd).multiplyScalar(-Math.cos(ang)).addScaledVector(this.right, Math.sin(ang));
        this.targetPos.copy(runnerPos).addScaledVector(dir, 3.2 + 0.3 * this.orbit).setY(runnerPos.y + 1.6 - 0.15 * this.orbit);
        this.targetLook.copy(runnerPos).setY(runnerPos.y + 1.25);
        fov = 50;
        break;
      }
    }
    if (snap) {
      this.pos.copy(this.targetPos);
      this.look.copy(this.targetLook);
      this.fov = fov;
    }
    return fov;
  }

  update(dt: number, runnerPos: THREE.Vector3, runnerYaw: number, intensity: number): void {
    this.t += dt;
    this.modeT += dt;
    const fov = this.computeTarget(runnerPos, runnerYaw, intensity, dt);
    const stiff = this.mode === 'run' ? 7.5 : this.mode === 'title' ? 1.2 : 3.2;
    dampV(this.pos, this.targetPos, stiff, dt);
    dampV(this.look, this.targetLook, stiff * 1.4, dt);
    // Never let the lens dip under the runner's feet.
    this.pos.y = Math.max(this.pos.y, runnerPos.y + 0.6);
    // Portrait screens: open the vertical angle so the way ahead still fits across.
    const a = this.camera.aspect;
    const portrait = a < 1 ? Math.min(1.55, 1 + (1 - a) * 0.95) : 1;
    this.fov = damp(this.fov, Math.min(fov * portrait, 96), 2.5, dt);

    this.trauma = Math.max(0, this.trauma - dt * 0.9);
    const m = this.shakeEnabled ? this.motionScale : 0;
    // Continuous tremor rises with intensity; trauma adds sharp shake on impacts.
    const base = this.mode === 'run' ? 0.012 + 0.05 * intensity * intensity : 0.004;
    const amp = (base + this.trauma * this.trauma * 0.35) * m;
    const t = this.t;
    const sx = (Math.sin(t * 17.3) * 0.6 + Math.sin(t * 31.1 + 1.3) * 0.4) * amp;
    const sy = (Math.sin(t * 21.7 + 0.7) * 0.6 + Math.sin(t * 43.3 + 2.1) * 0.4) * amp;
    // Footfall bob: the operator is running too.
    const bob = this.mode === 'run' ? Math.sin(t * (9 + 5 * intensity)) * 0.018 * (0.4 + intensity) * this.motionScale : 0;

    this.camera.position.copy(this.pos);
    this.camera.position.x += sx;
    this.camera.position.y += sy + bob;
    this.camera.lookAt(this.look);
    this.camera.rotateZ((Math.sin(t * 13.1) * 0.5 + Math.sin(t * 7.7)) * amp * 0.25);
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
    // Portrait screens: widen vertically so the runner and the way ahead both fit.
    this.camera.updateProjectionMatrix();
  }
}
