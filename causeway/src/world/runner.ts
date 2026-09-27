import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Kit } from './assets';

/** Animation states. `run` is locomotion: the `run` and `sprint` clips blended and phase-locked by speed. */
export type RunnerAnim = 'idle' | 'ready' | 'start' | 'run' | 'fall_chasm' | 'fall_gate' | 'fall_rock' | 'win';

type Foot = 'L' | 'R';
const ONE_SHOT = new Set<string>(['start', 'fall_chasm', 'fall_gate', 'fall_rock', 'win']);
/** Foot plants inside one-shot clips (seconds, foot, strength 0..1). Skids read heavier. */
const EVENTS: Record<string, [number, Foot, number][]> = {
  start: [[0.24, 'R', 0.7], [0.5, 'L', 0.6]],
  win: [[0.2, 'R', 0.5], [0.4, 'L', 0.35], [0.6, 'R', 0.25]],
  fall_chasm: [[0.12, 'L', 1], [0.28, 'R', 0.9], [1.1, 'R', 0.4]],
  fall_gate: [[0.15, 'L', 0.9], [0.43, 'R', 0.5], [0.62, 'L', 0.5], [0.83, 'R', 0.45]],
  fall_rock: [[0.12, 'L', 0.8], [0.45, 'R', 0.4]],
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A damped angular spring (one axis), driven by an external acceleration. */
class Spring {
  x = 0;
  v = 0;
  constructor(
    private k: number,
    private c: number,
  ) {}
  step(target: number, force: number, dt: number, lo = -1, hi = 1): number {
    // Semi-implicit Euler in small substeps: stable at 1/30 s and at slow motion.
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -this.k * (this.x - target) - this.c * this.v + force;
      this.v += a * h;
      this.x += this.v * h;
      if (this.x < lo) {
        this.x = lo;
        this.v = Math.max(0, this.v);
      } else if (this.x > hi) {
        this.x = hi;
        this.v = Math.min(0, this.v);
      }
    }
    return this.x;
  }
  reset() {
    this.x = 0;
    this.v = 0;
  }
}

/**
 * The runner's body: clip blending, a speed-locked gait, footfalls, and a
 * procedural layer on top (pack and bedroll bounce, a neckerchief that streams
 * and flutters in the wind of the run, lean and bank). Where they are is the
 * caller's business.
 */
export class Runner {
  readonly root = new THREE.Group();
  readonly body: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private weights = new Map<string, number>();
  private current: RunnerAnim = 'idle';
  private fade = 0.25;
  /** Gait cycle phase, 0..1 (0 = left strike, 0.5 = right strike). */
  private phase = 0;
  private sprintMix = 0;
  private eventT = 0;
  onFootstep: (foot: Foot, strength: number) => void = () => {};
  /** Forward pitch (rad) and bank (rad), eased. `slope` is the path grade (rise/run) for stairs. */
  lean = 0;
  roll = 0;
  slope = 0;
  private bones: Record<string, THREE.Bone | undefined> = {};
  private chestPrev = new THREE.Vector3();
  private chestVel = new THREE.Vector3();
  private acc = new THREE.Vector3();
  private hasPrev = false;
  private springs = {
    pack: new Spring(90, 9),
    roll: new Spring(140, 10),
    rollSide: new Spring(110, 8),
    scarf: [new Spring(60, 5), new Spring(45, 3.5), new Spring(35, 2.5)],
    scarfSide: [new Spring(50, 4), new Spring(40, 3), new Spring(30, 2)],
  };
  private t = 0;
  private speed = 0;
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private tmp = new THREE.Vector3();
  private inv = new THREE.Quaternion();

  constructor(kit: Kit) {
    this.body = cloneSkinned(kit.runner.scene);
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    this.root.add(this.body);
    this.root.name = 'runner';
    this.mixer = new THREE.AnimationMixer(this.body);
    for (const clip of kit.runner.clips) {
      const a = this.mixer.clipAction(clip);
      if (ONE_SHOT.has(clip.name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(clip.name, a);
      this.weights.set(clip.name, 0);
    }
    // Older exports had a single `fall` clip: use it for every reaction.
    const legacyFall = this.actions.get('fall');
    if (legacyFall) for (const k of ['fall_chasm', 'fall_gate', 'fall_rock']) if (!this.actions.has(k)) this.actions.set(k, legacyFall);
    for (const n of ['chest', 'pack', 'bedroll', 'scarf0', 'scarf1', 'scarf2']) this.bones[n] = this.body.getObjectByName(n) as THREE.Bone | undefined;
    this.play('idle', 0);
  }

  get anim(): RunnerAnim {
    return this.current;
  }

  /** Blend to a state over `fade` seconds. `run` after `ready` bursts out of the crouch first. */
  play(name: RunnerAnim, fade = 0.25): void {
    if (name === 'run' && this.current === 'ready' && this.actions.has('start')) name = 'start';
    if (name === this.current) return;
    if (name !== 'run' && !this.actions.has(name)) return;
    this.current = name;
    this.fade = Math.max(0.001, fade);
    this.eventT = 0;
    if (name === 'run') {
      for (const k of ['run', 'sprint']) this.actions.get(k)?.play();
    } else {
      const a = this.actions.get(name)!;
      a.reset();
      a.play();
    }
    if (fade <= 0) {
      for (const k of this.weights.keys()) this.weights.set(k, this.isActive(k) ? 1 : 0);
    }
  }

  private isActive(clip: string): boolean {
    if (this.current === 'run') return clip === 'run' || clip === 'sprint';
    return this.actions.get(this.current) === this.actions.get(clip);
  }

  /** `speed` in m/s drives the gait; emits footsteps; runs the procedural layer. */
  update(dt: number, speed: number): void {
    this.t += dt;
    this.speed = speed;
    // Burst clip hands over to the gait on its final plant (it ends on a left strike).
    if (this.current === 'start') {
      const a = this.actions.get('start')!;
      if (a.time >= a.getClip().duration - 0.06) {
        this.play('run', 0.12);
        this.phase = 0;
      }
    }

    // Gait: cadence rises with speed, the stride lengthens; sprint takes over from ~6 m/s.
    const cadence = THREE.MathUtils.clamp(1.35 + 0.1 * (speed - 5), 1.05, 2.3);
    const prevPhase = this.phase;
    if (this.current === 'run') this.phase = (this.phase + dt * cadence) % 1;
    const sprintTarget = smoothstep(6, 10.5, speed);
    this.sprintMix += (sprintTarget - this.sprintMix) * (1 - Math.exp(-dt * 3));
    for (const k of ['run', 'sprint']) {
      const a = this.actions.get(k);
      if (!a) continue;
      a.timeScale = 0;
      a.time = this.phase * a.getClip().duration;
    }

    // Weights: fade toward the active state, normalise so the pose never sags toward bind.
    const rate = dt / this.fade;
    let sum = 0;
    for (const [k, w] of this.weights) {
      const target = this.isActive(k) ? 1 : 0;
      const nw = target > w ? Math.min(target, w + rate) : Math.max(target, w - rate);
      this.weights.set(k, nw);
    }
    const gaitW = Math.max(this.weights.get('run') ?? 0, this.weights.get('sprint') ?? 0);
    const split = new Map<string, number>();
    for (const [k, w] of this.weights) {
      const x = w * (k === 'run' ? 1 - this.sprintMix : k === 'sprint' ? this.sprintMix : 1);
      split.set(k, x);
      sum += x;
    }
    for (const [k, x] of split) {
      const a = this.actions.get(k)!;
      const w = sum > 0 ? x / sum : 0;
      if (w > 0.001) {
        if (!a.isRunning() && !(ONE_SHOT.has(k) && a.time > 0)) a.play();
        a.enabled = true;
        a.setEffectiveWeight(w);
      } else if (a.isRunning() || a.enabled) {
        a.setEffectiveWeight(0);
        if (!this.isActive(k)) {
          a.stop();
          this.weights.set(k, 0);
        }
      }
    }
    this.mixer.update(dt);

    // Footfalls.
    const k = Math.min(1, speed / 10);
    if (this.current === 'run' && gaitW > 0.5) {
      if (prevPhase > this.phase) this.onFootstep('L', k);
      else if (prevPhase < 0.5 && this.phase >= 0.5) this.onFootstep('R', k);
    } else {
      const ev = EVENTS[this.current];
      const a = this.actions.get(this.current);
      if (ev && a) {
        const t0 = this.eventT;
        const t1 = a.time;
        for (const [at, foot, s] of ev) if (at > t0 && at <= t1) this.onFootstep(foot, s * Math.max(0.35, k));
        this.eventT = t1;
      }
    }

    // Stairs: lean into a climb, sit back on a descent; bank into turns.
    const lean = this.lean + THREE.MathUtils.clamp(this.slope, -0.5, 0.5) * 0.35;
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, this.roll, 1 - Math.exp(-dt * 6));
    this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, lean, 1 - Math.exp(-dt * 4));
    this.secondary(dt);
  }

  /** Pack and bedroll bounce, the neckerchief streams in the wind of the run. */
  private secondary(dt: number): void {
    const chest = this.bones.chest;
    if (!chest || dt <= 0) return;
    chest.updateWorldMatrix(true, false);
    const p = this.tmp.setFromMatrixPosition(chest.matrixWorld);
    if (!this.hasPrev) {
      this.chestPrev.copy(p);
      this.chestVel.set(0, 0, 0);
      this.hasPrev = true;
    }
    const vel = this.tmp.clone().sub(this.chestPrev).divideScalar(dt);
    // Teleports (new round) must not kick the springs.
    if (vel.length() > 40) vel.copy(this.chestVel);
    this.acc.copy(vel).sub(this.chestVel).divideScalar(dt);
    this.acc.clampLength(0, 60);
    this.chestPrev.copy(p);
    this.chestVel.copy(vel);
    // Into the runner's frame: x right, y up, z back.
    this.root.getWorldQuaternion(this.inv).invert();
    const a = this.acc.clone().applyQuaternion(this.inv);
    const s = this.springs;
    const run = Math.min(1, this.speed / 9);

    const pack = s.pack.step(0, -a.y * 0.9 + a.z * 0.6, dt, -0.12, 0.2);
    const roll = s.roll.step(0, a.y * 1.2, dt, -0.2, 0.25);
    const rollSide = s.rollSide.step(0, a.x * 1.1, dt, -0.2, 0.2);
    this.rotate(this.bones.pack, pack, 0, 0);
    this.rotate(this.bones.bedroll, roll, 0, rollSide);

    // Neckerchief: lifted by the airflow, fluttering faster and wider with speed, lagging the body.
    const w = this.t * (9 + this.speed * 1.6);
    for (let i = 0; i < 3; i++) {
      const lift = run * (i === 0 ? 0.28 : 0.12) + 0.02;
      const flutter = run * (0.12 + 0.1 * i) * Math.sin(w - i * 1.3) + run * 0.05 * Math.sin(w * 2.3 + i);
      const x = s.scarf[i]!.step(lift + flutter, a.y * (0.25 + 0.2 * i) + a.z * 0.15, dt, -0.15, 0.9);
      const z = s.scarfSide[i]!.step(run * 0.1 * Math.sin(w * 0.7 + i * 0.9), -a.x * 0.3, dt, -0.5, 0.5);
      this.rotate(this.bones[`scarf${i}`], x, 0, z);
    }
  }

  private rotate(b: THREE.Bone | undefined, x: number, y: number, z: number) {
    if (!b) return;
    this.q.setFromEuler(this.e.set(x, y, z));
    b.quaternion.multiply(this.q);
  }

  /** Forget velocities (after a teleport to a new round). */
  resetSecondary(): void {
    this.hasPrev = false;
    this.springs.pack.reset();
    this.springs.roll.reset();
    this.springs.rollSide.reset();
    for (const sp of [...this.springs.scarf, ...this.springs.scarfSide]) sp.reset();
  }
}
