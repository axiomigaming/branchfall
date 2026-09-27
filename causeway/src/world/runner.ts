import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Kit } from './assets';

export type RunnerAnim = 'idle' | 'ready' | 'run' | 'fall' | 'win';

/** The runner's body: animation blending, footfalls and a lean. Where they are is the caller's business. */
export class Runner {
  readonly root = new THREE.Group();
  readonly body: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<RunnerAnim, THREE.AnimationAction>();
  private current: RunnerAnim = 'idle';
  private lastPhase = 0;
  /** Seconds of the run clip per stride pair. */
  private runDuration = 0.667;
  onFootstep: (foot: 'L' | 'R', strength: number) => void = () => {};
  lean = 0;
  roll = 0;

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
      const name = clip.name as RunnerAnim;
      const a = this.mixer.clipAction(clip);
      if (name === 'fall' || name === 'win') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(name, a);
      if (name === 'run') this.runDuration = clip.duration;
    }
    this.play('idle', 0);
  }

  get anim(): RunnerAnim {
    return this.current;
  }

  play(name: RunnerAnim, fade = 0.25): void {
    const next = this.actions.get(name);
    if (!next) return;
    const prev = this.actions.get(this.current);
    if (name === this.current && next.isRunning()) return;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(1);
    next.play();
    if (prev && prev !== next && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev && prev !== next) prev.stop();
    this.current = name;
    if (name === 'run') this.lastPhase = 0;
  }

  /** `speed` in m/s scales the stride rate; returns nothing, emits footsteps. */
  update(dt: number, speed: number): void {
    const run = this.actions.get('run');
    if (run && this.current === 'run') {
      // Natural clip speed ≈ 4.8 m/s. Faster runners lengthen the stride as well as quicken it.
      const k = 1 + (speed / 4.8 - 1) * 0.55;
      run.setEffectiveTimeScale(Math.max(0.6, k));
    }
    this.mixer.update(dt);
    if (run && this.current === 'run' && run.getEffectiveWeight() > 0.5) {
      const phase = (run.time % this.runDuration) / this.runDuration;
      // Foot strikes at phase 0 (left) and 0.5 (right).
      if (this.lastPhase > phase) this.onFootstep('L', Math.min(1, speed / 10));
      else if (this.lastPhase < 0.5 && phase >= 0.5) this.onFootstep('R', Math.min(1, speed / 10));
      this.lastPhase = phase;
    }
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, this.roll, 1 - Math.exp(-dt * 6));
    this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, this.lean, 1 - Math.exp(-dt * 4));
  }
}
