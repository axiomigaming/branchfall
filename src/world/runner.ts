import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Kit } from './assets';
import { Rng } from '../engine/rng';

/**
 * Animation states. `run` is locomotion: the `run`, `sprint` and `dash` clips
 * blended by the run tier and phase-locked to one stride cycle.
 */
export type RunnerAnim =
  | 'idle'
  | 'ready'
  | 'start'
  | 'run'
  | 'fall_start'
  | 'fall_chasm'
  | 'fall_chasm_b'
  | 'fall_gate'
  | 'fall_gate_b'
  | 'fall_rock'
  | 'fall_rock_b'
  | 'win'
  | 'win_cheer'
  | 'win_salute'
  | 'win_leap';

type Foot = 'L' | 'R';
const GAITS = ['run', 'sprint', 'dash'] as const;
/**
 * Ground covered per stride cycle (m) while a foot is planted, per gait clip. The clips are solved in
 * blender/runner_anim.py so the stance foot slides back exactly D per stance (S = D / ts); setting the
 * cadence to speed / S keeps the planted foot still on the floor. Keep in step with the clip builder
 * (it prints S for each gait).
 */
export const STRIDE: Record<(typeof GAITS)[number], number> = { run: 2.8, sprint: 3.911, dash: 4.842 };

/** Blend weights of the gait clips for a (continuous) run tier. */
export function gaitMix(drive: number): Record<(typeof GAITS)[number], number> {
  const dash = smoothstep(2.2, 3.6, drive);
  const run = 1 - smoothstep(0.5, 2.0, drive);
  return { run, sprint: Math.max(0, 1 - run - dash), dash };
}

/** Turnover ceiling (stride cycles per second): an elite sprinter's ~5 steps/s, a touch more all-out. */
export function cadenceCap(drive: number): number {
  return 2.45 + 0.1 * drive;
}

/**
 * Stride cycles per second for a speed and run tier: speed over the blended stride length, so the planted
 * foot keeps pace with the floor. The strides are sized so this never reaches the cap at the speeds the
 * game runs at (tests/choreo.test.ts); the clamp only guards the extremes.
 */
export function gaitCadence(speed: number, drive: number): number {
  const m = gaitMix(drive);
  const stride = STRIDE.run * m.run + STRIDE.sprint * m.sprint + STRIDE.dash * m.dash;
  return Math.min(Math.max(speed / stride, 1.1), cadenceCap(drive));
}
const IDLES = ['idle', 'idle_b', 'idle_c'] as const;
const ONE_SHOT = new Set<string>(['start', 'fall_start', 'fall_chasm', 'fall_chasm_b', 'fall_gate', 'fall_gate_b', 'fall_rock', 'fall_rock_b', 'win', 'win_cheer', 'win_salute', 'win_leap']);
/** Foot plants inside one-shot clips (seconds, foot, strength 0..1). Skids read heavier. */
const EVENTS: Record<string, [number, Foot, number][]> = {
  start: [[0.16, 'L', 0.45], [0.27, 'R', 0.8], [0.5, 'L', 0.7], [0.73, 'R', 0.65], [0.9, 'L', 0.6]],
  win: [[0.2, 'R', 0.5], [0.4, 'L', 0.35], [0.6, 'R', 0.25]],
  fall_chasm: [[0.12, 'L', 1], [0.28, 'R', 0.9]],
  fall_gate: [[0.13, 'L', 0.9], [0.5, 'R', 0.55], [0.7, 'L', 0.5], [0.9, 'R', 0.4]],
  fall_rock: [[0.12, 'L', 0.8], [0.45, 'R', 0.4]],
  fall_start: [[0.38, 'L', 0.5], [0.6, 'R', 0.5]],
  fall_chasm_b: [[0.12, 'L', 1], [0.3, 'R', 0.9], [0.52, 'L', 0.6]],
  fall_gate_b: [[0.15, 'L', 0.9], [0.5, 'R', 0.6], [0.8, 'L', 0.5]],
  fall_rock_b: [[0.12, 'L', 0.8], [0.3, 'R', 0.6], [0.52, 'L', 0.7]],
  win_cheer: [[0.2, 'R', 0.6], [0.37, 'L', 0.8], [0.6, 'R', 0.4]],
  win_salute: [[0.27, 'R', 0.4], [0.5, 'L', 0.25], [0.93, 'R', 0.2], [1.13, 'L', 0.2], [1.33, 'R', 0.2]],
  win_leap: [[0.17, 'R', 0.6], [0.3, 'L', 0.8], [0.9, 'L', 1], [0.93, 'R', 0.8]],
};

/** Spring-driven cloth bones (three strips the dots from the Blender names). */
const CLOTH = ['hemF', 'hemL', 'hemB', 'hemR', 'sleeveL', 'sleeveR'];

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The runner's material: full-detail sampling (trilinear + 8× anisotropy on the colour and normal maps,
 * which the chase camera sees at a grazing angle), and a runner-only lift so he never reads as a
 * silhouette against the sunlit causeway: a soft sky/ground fill (a hemisphere term: cool from above,
 * warm bounce from below, scaled by the albedo so it shades rather than flattens) and a faint rim along
 * the contour. The world's lights are untouched.
 */
export const RUNNER_FILL = 0.45;
export const RUNNER_RIM = 0.4;
/** A cool sky-light edge (not tinted by the albedo), so the figure separates from the terracotta. */
export const RUNNER_COOL_RIM = 0.22;
function liftRunner(m: THREE.MeshStandardMaterial): void {
  for (const t of [m.map, m.normalMap, m.roughnessMap]) {
    if (!t) continue;
    t.anisotropy = 8;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
  }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRunnerFill = { value: RUNNER_FILL };
    sh.uniforms.uRunnerRim = { value: RUNNER_RIM };
    sh.uniforms.uRunnerCool = { value: RUNNER_COOL_RIM };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRunnerFill;\nuniform float uRunnerRim;\nuniform float uRunnerCool;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 nW = inverseTransformDirection(normal, viewMatrix);
          vec3 hemi = mix(vec3(0.46, 0.36, 0.28), vec3(0.62, 0.68, 0.78), nW.y * 0.5 + 0.5);
          float rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * (hemi * uRunnerFill + vec3(1.0, 0.86, 0.68) * rim * uRunnerRim);
          reflectedLight.indirectSpecular += vec3(0.62, 0.74, 0.92) * pow(rim, 1.4) * uRunnerCool * (0.6 + 0.4 * saturate(nW.y + 0.5));
        }`,
      );
  };
  m.customProgramCacheKey = () => 'runner-lift';
  m.needsUpdate = true;
}

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

/** A planted foot held in place by two-bone IK while the body moves over it. */
interface FootLock {
  thigh?: THREE.Bone;
  shin?: THREE.Bone;
  foot?: THREE.Bone;
  locked: boolean;
  pos: THREE.Vector3;
  w: number;
}

/**
 * The runner's body: clip blending, a speed-locked gait, footfalls, and a
 * procedural layer on top: satchel, shirt-tail, sleeve and neckerchief springs,
 * breathing that follows exertion, a look-at for the head, and planted feet
 * (two-bone IK) whenever a one-shot clip stops or turns the runner, so boots
 * don't skate as the world brakes under them. Where they are is the caller's business.
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
  private cadence = 1.35;
  /** A one-shot waiting for the next left strike (so it starts on the foot its first key expects). */
  private pending: { name: RunnerAnim; fade: number; offset: number; until: number } | null = null;
  /** Which idle clip is playing (they alternate), and for how long. */
  private idleClip: string = 'idle';
  private idleT = 0;
  /** Continuous run tier (see choreo.runDrive); eased so tier changes never pop. */
  drive = 0;
  private driveS = 0;
  private glanceT = -1;
  private glanceSide = 1;
  private stumbleT = -1;
  private eventT = 0;
  onFootstep: (foot: Foot, strength: number) => void = () => {};
  /** Forward pitch (rad) and bank (rad), eased. `slope` is the path grade (rise/run) for stairs. */
  lean = 0;
  roll = 0;
  slope = 0;
  /** 0 fresh … 1 spent: builds while running, recovers at rest; drives breathing. */
  exertion = 0;
  private breathPh = 0;
  private look = { target: new THREE.Vector3(), want: 0, w: 0, has: false };
  private bones: Record<string, THREE.Bone | undefined> = {};
  private feet: Record<Foot, FootLock> = {
    L: { locked: false, pos: new THREE.Vector3(), w: 0 },
    R: { locked: false, pos: new THREE.Vector3(), w: 0 },
  };
  private headFwd = new THREE.Vector3(0, 0, 1);
  /** Bind rotations of the spring-driven bones: the clips carry no tracks for them (the exporter drops constant
   * channels), so each frame starts from rest instead of accumulating. */
  private rest = new Map<THREE.Bone, THREE.Quaternion>();
  private chestPrev = new THREE.Vector3();
  private chestVel = new THREE.Vector3();
  private hipPrev = new THREE.Vector3();
  private hipVel = new THREE.Vector3();
  private acc = new THREE.Vector3();
  private hipAcc = new THREE.Vector3();
  private hasPrev = false;
  private springs = {
    pack: new Spring(70, 6),
    packSide: new Spring(60, 5),
    scarf: [new Spring(60, 5), new Spring(45, 3.5), new Spring(35, 2.5)],
    scarfSide: [new Spring(50, 4), new Spring(40, 3), new Spring(30, 2)],
    /** Shirt tail: front, left, back, right (swing about the waist), and each one's sideways sway. */
    hem: [new Spring(120, 7), new Spring(110, 6), new Spring(95, 5), new Spring(110, 6)],
    hemSide: [new Spring(90, 6), new Spring(80, 5), new Spring(80, 5), new Spring(80, 5)],
    sleeve: [new Spring(160, 9), new Spring(160, 9)],
    sleeveOut: [new Spring(140, 8), new Spring(140, 8)],
  };
  /** Upper-arm swing angle last frame (for the sleeves' lag), per side. */
  private armPrev = [0, 0];
  private armVel = [0, 0];
  /** Per-stride variation: cosmetic, seeded, never tied to the round. */
  private vary = new Rng(0x5eed);
  private varyA = [0, 0, 0, 0, 0];
  private varyB = [0, 0, 0, 0, 0];
  private varyT = 1;
  /** A catch step (stairs): time since it began, and which way the grade goes. */
  private catchT = -1;
  private catchDir = 1;
  private speedPrev = 0;
  private accel = 0;
  private t = 0;
  private speed = 0;
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private e = new THREE.Euler();
  private tmp = new THREE.Vector3();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private inv = new THREE.Quaternion();

  constructor(kit: Kit) {
    this.body = cloneSkinned(kit.runner.scene);
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        // Hair cards are alpha-tested (sorting-free, depth-writing); the glTF comes through as blended.
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (m.name === 'M_hair') {
          m.transparent = false;
          m.alphaTest = 0.45;
          m.depthWrite = true;
          m.side = THREE.DoubleSide;
        } else if (m.name === 'M_runner') {
          m.side = THREE.FrontSide;
          liftRunner(m);
        }
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
    // three sanitises node names ('upper_arm.L' → 'upper_armL').
    for (const n of ['hips', 'spine', 'chest', 'neck', 'head', 'upper_armL', 'upper_armR', 'forearmL', 'forearmR', 'shoulderL', 'shoulderR', 'pack', 'scarf0', 'scarf1', 'scarf2', ...CLOTH])
      this.bones[n] = this.body.getObjectByName(n) as THREE.Bone | undefined;
    for (const s of ['L', 'R'] as const) {
      const f = this.feet[s];
      f.thigh = this.body.getObjectByName(`thigh${s}`) as THREE.Bone | undefined;
      f.shin = this.body.getObjectByName(`shin${s}`) as THREE.Bone | undefined;
      f.foot = this.body.getObjectByName(`foot${s}`) as THREE.Bone | undefined;
    }
    for (const n of ['pack', 'scarf0', 'scarf1', 'scarf2', ...CLOTH]) {
      const b = this.bones[n];
      if (b) this.rest.set(b, b.quaternion.clone());
    }
    // The face's forward direction in the head bone's frame (bind pose faces the root's −Z).
    const head = this.bones.head;
    if (head) {
      this.body.updateMatrixWorld(true);
      head.getWorldQuaternion(this.q).invert();
      this.headFwd.set(0, 0, -1).applyQuaternion(this.q).normalize();
    }
    this.play('idle', 0);
  }

  get anim(): RunnerAnim {
    return this.current;
  }

  /**
   * Blend to a state over `fade` seconds, starting `offset` seconds into a one-shot clip. `run`
   * after `ready` bursts out of the crouch first. Unknown clips fall back to a sibling. A reaction
   * from a full run waits (briefly) for the left foot to strike, which is where its clip begins.
   */
  play(name: RunnerAnim, fade = 0.25, offset = 0): void {
    if (name === 'run' && this.current === 'ready' && this.actions.has('start')) name = 'start';
    if (name !== 'run' && !this.actions.has(name)) {
      const fallback = name.startsWith('win') ? 'win' : name.startsWith('fall_') ? name.replace(/_b$/, '').replace('fall_start', 'fall_gate') : null;
      if (!fallback || !this.actions.has(fallback)) return;
      name = fallback as RunnerAnim;
    }
    this.pending = null;
    if (name === this.current) return;
    if (this.current === 'run' && ONE_SHOT.has(name) && name !== 'start' && offset === 0 && fade > 0) {
      const wait = ((1 - this.phase) % 1) / Math.max(0.5, this.cadence);
      // Escapes can afford a beat to land on the right foot; falls react almost at once.
      const budget = name.startsWith('win') ? 0.26 : 0.12;
      if (wait > 0.001 && wait < budget) {
        this.pending = { name, fade, offset, until: this.t + wait };
        return;
      }
      if (wait >= budget) fade = Math.max(fade, 0.2);
    }
    this.start(name, fade, offset);
  }

  private start(name: RunnerAnim, fade: number, offset: number) {
    this.current = name;
    this.fade = Math.max(0.001, fade);
    this.eventT = offset;
    this.glanceT = -1;
    this.stumbleT = -1;
    if (name === 'run') {
      for (const k of GAITS) this.actions.get(k)?.play();
    } else {
      const clip = name === 'idle' ? this.idleClip : name;
      const a = this.actions.get(clip)!;
      a.reset();
      a.time = Math.min(offset, a.getClip().duration);
      a.play();
    }
    if (name === 'idle') this.idleT = 0;
    if (fade <= 0) {
      for (const k of this.weights.keys()) this.weights.set(k, this.isActive(k) ? 1 : 0);
    }
  }

  private isActive(clip: string): boolean {
    if (this.current === 'run') return (GAITS as readonly string[]).includes(clip);
    if (this.current === 'idle') return clip === this.idleClip;
    return this.actions.get(this.current) === this.actions.get(clip);
  }

  /** A look back over the shoulder (cosmetic; `side` +1 = over the right shoulder). */
  glance(side: number): void {
    if (this.current !== 'run' || this.glanceT >= 0 || this.stumbleT >= 0) return;
    this.glanceT = 0;
    this.glanceSide = side >= 0 ? 1 : -1;
  }

  /** A stumble and recover (cosmetic). Returns false if the runner is busy. */
  stumble(): boolean {
    if (this.current !== 'run' || this.stumbleT >= 0 || this.glanceT >= 0) return false;
    this.stumbleT = 0;
    return true;
  }

  get stumbling(): number {
    return this.stumbleT < 0 ? 0 : this.stumbleEnv(this.stumbleT);
  }

  /** Turn the head toward a world point (weight 0..1, eased); null lets the clip lead. */
  lookAt(p: THREE.Vector3 | null, weight = 1): void {
    if (!p) {
      this.look.want = 0;
      return;
    }
    this.look.target.copy(p);
    this.look.want = THREE.MathUtils.clamp(weight, 0, 1);
    this.look.has = true;
  }

  private stumbleEnv(t: number): number {
    return t < 0.12 ? smoothstep(0, 0.12, t) : 1 - smoothstep(0.12, 0.75, t);
  }

  /** `speed` in m/s drives the gait; emits footsteps; runs the procedural layer. */
  update(dt: number, speed: number): void {
    this.t += dt;
    this.speed = speed;
    if (this.pending && (this.t >= this.pending.until || this.current !== 'run')) {
      const p = this.pending;
      this.pending = null;
      this.start(p.name, p.fade, p.offset);
    }
    // Burst clip hands over to the gait on its final plant (it ends on a left strike).
    if (this.current === 'start') {
      const a = this.actions.get('start')!;
      if (a.time >= a.getClip().duration - 0.06) {
        this.start('run', 0.12, 0);
        this.phase = 0;
      }
    }
    // Idle variety: the idle clips take turns (settle, look around, shake out for the run).
    if (this.current === 'idle' && this.actions.has('idle_b')) {
      this.idleT += dt;
      const a = this.actions.get(this.idleClip)!;
      if (this.idleT > a.getClip().duration - 0.5) {
        const have = IDLES.filter((n) => this.actions.has(n));
        this.idleClip = have[(have.indexOf(this.idleClip as (typeof IDLES)[number]) + 1) % have.length]!;
        const b = this.actions.get(this.idleClip)!;
        b.reset();
        b.play();
        this.fade = 0.8;
        this.idleT = 0;
      }
    }

    // Gait: the run tier blends run → sprint → dash on one stride phase, and the cadence is set so the
    // planted foot keeps pace with the floor (speed / stride length of the blend). Turnover tops out
    // near an elite sprinter's (~5 steps/s), a touch higher in the desperate dash.
    this.driveS += (this.drive - this.driveS) * (1 - Math.exp(-dt * 1.5));
    const d = this.driveS;
    const mix: Record<string, number> = gaitMix(this.actions.has('dash') ? d : Math.min(d, 2.2));
    const cadence = gaitCadence(speed, this.actions.has('dash') ? d : Math.min(d, 2.2));
    this.cadence = cadence;
    const prevPhase = this.phase;
    if (this.current === 'run') this.phase = (this.phase + dt * cadence) % 1;
    if (dt > 0) {
      const a = (speed - this.speedPrev) / dt;
      this.accel += (THREE.MathUtils.clamp(a, -12, 12) - this.accel) * (1 - Math.exp(-dt * 4));
    }
    this.speedPrev = speed;
    for (const k of GAITS) {
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
    const gaitW = Math.max(...GAITS.map((g) => this.weights.get(g) ?? 0));
    const split = new Map<string, number>();
    for (const [k, w] of this.weights) {
      const x = w * (mix[k] ?? 1);
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
    this.overlays(dt);

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

    // Stairs: lean into a climb, sit back on a descent; bank into turns. Accelerating, the body tips
    // forward from the ankles (the drive phase of a sprint start); easing off, it straightens.
    const drivePhase = this.current === 'run' || this.current === 'start' ? THREE.MathUtils.clamp(this.accel * 0.022, -0.05, 0.16) : 0;
    const lean = this.lean + drivePhase + THREE.MathUtils.clamp(this.slope, -0.5, 0.5) * 0.35;
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, this.roll, 1 - Math.exp(-dt * 6));
    this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, lean, 1 - Math.exp(-dt * 4));

    // Exertion builds with running (faster in the high tiers) and recovers slowly at rest.
    if (this.current === 'run' || this.current === 'start') this.exertion = Math.min(1, this.exertion + dt * (0.03 + 0.012 * speed));
    else this.exertion = Math.max(0, this.exertion - dt * 0.035);
    this.breathe(dt);
    this.lookLayer(dt);
    this.secondary(dt);
    this.plantFeet(dt);
  }

  /** A catch step at the lip of a flight of stairs: a check, eyes down to the steps, arms out a touch. */
  catchStep(dir: number): void {
    if (this.current !== 'run' || this.catchT >= 0 || this.stumbleT >= 0) return;
    this.catchT = 0;
    this.catchDir = dir >= 0 ? 1 : -1;
  }

  /** Additive beats on top of the gait: a glance back, a stumble and recover, a catch step. */
  private overlays(dt: number): void {
    const b = this.bones;
    if (this.current === 'run') {
      // No two strides alike: every stride eases toward fresh small offsets (head carriage, trunk
      // twist and side bend, one arm a touch wider or higher).
      this.varyT += dt * this.cadence;
      if (this.varyT >= 1) {
        this.varyT = 0;
        this.varyA = this.varyB;
        this.varyB = this.varyB.map(() => this.vary.range(-1, 1));
      }
      const u = smoothstep(0, 1, this.varyT);
      const v = this.varyA.map((a, i) => a + (this.varyB[i]! - a) * u);
      const w = Math.min(1, this.speed / 6);
      this.rotate(b.head, 0.02 * v[0]! * w, 0.03 * v[1]! * w, 0.025 * v[2]! * w);
      this.rotate(b.chest, 0, 0.025 * v[3]! * w, 0.02 * v[2]! * w);
      this.rotate(b.upper_armL, -0.05 * v[4]! * w, 0, 0.03 * v[3]! * w);
      this.rotate(b.upper_armR, 0.04 * v[4]! * w, 0, -0.03 * v[1]! * w);
    }
    if (this.catchT >= 0) {
      this.catchT += dt;
      const t = this.catchT;
      const e = t < 0.1 ? smoothstep(0, 0.1, t) : 1 - smoothstep(0.1, 0.55, t);
      const up = this.catchDir;
      // Climbing: the chest pitches in and the knees come up; descending: sit back, arms out.
      this.rotate(b.spine, -0.1 * e * up, 0, 0);
      this.rotate(b.neck, -0.14 * e, 0, 0);
      this.rotate(b.head, -0.1 * e, 0, 0);
      this.rotate(b.upper_armL, 0, 0, 0.25 * e * (up < 0 ? 1.6 : 1));
      this.rotate(b.upper_armR, 0, 0, -0.25 * e * (up < 0 ? 1.6 : 1));
      if (this.stumbleT < 0) this.body.position.y = -0.035 * e;
      if (t > 0.6) {
        this.catchT = -1;
        if (this.stumbleT < 0) this.body.position.y = 0;
      }
    }
    if (this.glanceT >= 0) {
      this.glanceT += dt;
      const t = this.glanceT;
      const g = smoothstep(0, 0.25, t) * (1 - smoothstep(0.6, 0.95, t));
      const s = -this.glanceSide;
      // Up-pointing bones yaw about local Y; the shoulder drops a touch as the chest turns.
      this.rotate(b.spine, 0, s * 0.1 * g, 0);
      this.rotate(b.chest, 0, s * 0.22 * g, 0);
      this.rotate(b.neck, 0.05 * g, s * 0.6 * g, 0);
      this.rotate(b.head, 0.05 * g, s * 0.55 * g, -s * 0.05 * g);
      if (t > 0.95) this.glanceT = -1;
    }
    if (this.stumbleT >= 0) {
      this.stumbleT += dt;
      const e = this.stumbleEnv(this.stumbleT);
      // Pitch forward, head up to find the way, arms thrown wide for balance, a dip.
      this.rotate(b.spine, -0.22 * e, 0, 0.05 * e);
      this.rotate(b.chest, -0.15 * e, 0, 0);
      this.rotate(b.neck, 0.2 * e, 0, 0);
      this.rotate(b.head, 0.15 * e, 0, 0);
      this.rotate(b.upper_armL, -0.3 * e, 0, 0.7 * e);
      this.rotate(b.upper_armR, -0.3 * e, 0, -0.7 * e);
      this.body.position.y = -0.07 * e;
      if (this.stumbleT > 0.8) {
        this.stumbleT = -1;
        this.body.position.y = 0;
      }
    }
  }

  /** Breathing: slow and shallow when fresh, quick and heaving when spent (visible at rest). */
  private breathe(dt: number): void {
    const x = this.exertion;
    const rest = this.current === 'run' ? 0.25 : 1;
    const rate = 0.28 + 0.75 * x;
    this.breathPh += dt * rate * Math.PI * 2;
    const s = Math.sin(this.breathPh);
    // Inhale: chest lifts and opens, shoulders rise; a faster, sharper intake when winded.
    const inhale = (s > 0 ? s : s * 0.7) * (0.012 + 0.045 * x) * rest;
    this.rotate(this.bones.chest, inhale, 0, 0);
    this.rotate(this.bones.spine, inhale * 0.4, 0, 0);
    this.rotate(this.bones.neck, -inhale * 0.8, 0, 0);
    this.rotate(this.bones.shoulderL, 0, 0, inhale * 0.6);
    this.rotate(this.bones.shoulderR, 0, 0, -inhale * 0.6);
  }

  /** Aim the neck and head at the look target, within a comfortable range, eased in and out. */
  private lookLayer(dt: number): void {
    const L = this.look;
    L.w += (L.want - L.w) * (1 - Math.exp(-dt * 3.5));
    const head = this.bones.head;
    const neck = this.bones.neck;
    if (!L.has || L.w < 0.01 || !head || !neck) return;
    head.updateWorldMatrix(true, false);
    const hp = head.getWorldPosition(this.v1);
    const want = this.v2.copy(L.target).sub(hp).normalize();
    const hq = head.getWorldQuaternion(this.q2);
    const fwd = this.v3.copy(this.headFwd).applyQuaternion(hq).normalize();
    // Limit the turn relative to where the body faces, so the head never spins past the shoulder.
    const bodyFwd = this.v4.set(0, 0, -1).applyQuaternion(this.root.getWorldQuaternion(this.q)).normalize();
    const lim = 1.05;
    const ang = bodyFwd.angleTo(want);
    if (ang > lim) {
      const axis = this.tmp.crossVectors(bodyFwd, want);
      if (axis.lengthSq() < 1e-8) return;
      axis.normalize();
      want.copy(bodyFwd).applyAxisAngle(axis, lim);
    }
    const full = this.q.setFromUnitVectors(fwd, want);
    const id = new THREE.Quaternion();
    // Neck takes 40 %, the head the rest.
    this.applyWorld(neck, id.clone().slerp(full, 0.4 * L.w));
    this.applyWorld(head, id.slerp(full, 0.6 * L.w));
  }

  /** Premultiply a world-space rotation onto a bone. */
  private applyWorld(b: THREE.Bone, rw: THREE.Quaternion): void {
    const parent = b.parent!;
    parent.updateWorldMatrix(true, false);
    const pq = parent.getWorldQuaternion(new THREE.Quaternion());
    const wq = pq.clone().multiply(b.quaternion);
    wq.premultiply(rw);
    b.quaternion.copy(pq.invert().multiply(wq));
    b.updateMatrixWorld(true);
  }

  /** The satchel bounces, the shirt moves (see cloth), the neckerchief streams in the wind of the run. */
  private secondary(dt: number): void {
    const chest = this.bones.chest;
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    if (!chest || dt <= 0) return;
    chest.updateWorldMatrix(true, false);
    const p = this.tmp.setFromMatrixPosition(chest.matrixWorld);
    const hips = this.bones.hips;
    const hp = hips ? this.v4.setFromMatrixPosition(hips.matrixWorld) : p;
    if (!this.hasPrev) {
      this.chestPrev.copy(p);
      this.chestVel.set(0, 0, 0);
      this.hipPrev.copy(hp);
      this.hipVel.set(0, 0, 0);
      this.hasPrev = true;
    }
    const vel = this.v1.copy(p).sub(this.chestPrev).divideScalar(dt);
    // Teleports (new round) must not kick the springs.
    if (vel.length() > 40) vel.copy(this.chestVel);
    this.acc.copy(vel).sub(this.chestVel).divideScalar(dt);
    this.acc.clampLength(0, 60);
    this.chestPrev.copy(p);
    this.chestVel.copy(vel);
    const hv = this.v2.copy(hp).sub(this.hipPrev).divideScalar(dt);
    if (hv.length() > 40) hv.copy(this.hipVel);
    this.hipAcc.copy(hv).sub(this.hipVel).divideScalar(dt).clampLength(0, 60);
    this.hipPrev.copy(hp);
    this.hipVel.copy(hv);
    // Into the runner's frame: x right, y up, z back.
    this.root.getWorldQuaternion(this.inv).invert();
    const a = this.acc.clone().applyQuaternion(this.inv);
    const ha = this.hipAcc.clone().applyQuaternion(this.inv);
    const s = this.springs;
    const run = Math.min(1, this.speed / 9);

    // The satchel rides the hip: it lags each landing and swings as the pelvis turns.
    const pack = s.pack.step(0, -ha.y * 0.5 + ha.z * 0.5, dt, -0.3, 0.35);
    const packSide = s.packSide.step(0, -ha.x * 0.6, dt, -0.25, 0.25);
    this.rotate(this.bones.pack, pack, 0, packSide);
    this.cloth(dt, a, ha, run);

    // Neckerchief: lifted by the airflow, fluttering faster and wider with speed, lagging the body.
    const w = this.t * (9 + this.speed * 1.6);
    for (let i = 0; i < 3; i++) {
      const lift = run * (i === 0 ? 0.22 : 0.1) + 0.02;
      const flutter = run * (0.12 + 0.1 * i) * Math.sin(w - i * 1.3) + run * 0.05 * Math.sin(w * 2.3 + i);
      const x = s.scarf[i]!.step(lift + flutter, a.y * (0.25 + 0.2 * i) + a.z * 0.15, dt, -0.15, 0.9);
      const z = s.scarfSide[i]!.step(run * 0.1 * Math.sin(w * 0.7 + i * 0.9), -a.x * 0.3, dt, -0.5, 0.5);
      this.rotate(this.bones[`scarf${i}`], x, 0, z);
    }
  }

  /**
   * The shirt in motion. The untucked tail is four hinged panels round the waist: the airflow lifts
   * the back one and sets it fluttering, harder with speed; each knee drive pushes the front and that
   * side's panel up and out; landings and the pelvis's swing make them all lag and bounce. The short
   * sleeves lag the arm swing and flare a little in the wind. Every panel is a damped spring.
   */
  private cloth(dt: number, a: THREE.Vector3, ha: THREE.Vector3, run: number): void {
    const s = this.springs;
    const t = this.t;
    const running = this.current === 'run' || this.current === 'start' ? 1 : 0.35;
    const air = run * running;
    const w = 11 + this.speed * 1.9;
    const flut = (i: number) => Math.sin(w * t + i * 1.7) * 0.6 + Math.sin(w * 1.93 * t + i * 0.6) * 0.4;
    // Knee drive per side from the stride phase (peaks at ~0.75 of each leg's own cycle).
    const ph = this.phase;
    const kneeL = this.current === 'run' ? Math.max(0, Math.cos(2 * Math.PI * (ph - 0.72))) ** 2 : 0;
    const kneeR = this.current === 'run' ? Math.max(0, Math.cos(2 * Math.PI * (ph + 0.5 - 0.72))) ** 2 : 0;
    const drive = 0.12 + 0.05 * this.driveS;
    // Down-pointing bones: −X swings the tail forward, +X back; ±Z (mirrored per side) swings it out.
    const hemTargets = [
      -drive * Math.max(kneeL, kneeR) * air + 0.02 * air * flut(0),
      -drive * 0.6 * kneeL * air + 0.03 * air + 0.04 * air * flut(1),
      0.05 * air + 0.05 * air * air + 0.07 * air * flut(2),
      -drive * 0.6 * kneeR * air + 0.03 * air + 0.04 * air * flut(3),
    ];
    const hemForce = [ha.z * 0.35 + ha.y * 0.25, ha.z * 0.3 - ha.y * 0.2, ha.z * 0.4 - ha.y * 0.4, ha.z * 0.3 - ha.y * 0.2];
    const names = ['hemF', 'hemL', 'hemB', 'hemR'];
    for (let i = 0; i < 4; i++) {
      const x = s.hem[i]!.step(hemTargets[i]!, hemForce[i]!, dt, -0.45, 0.4);
      const outSign = i === 1 ? 1 : i === 3 ? -1 : 0;
      const side = s.hemSide[i]!.step(outSign * (0.03 * air + 0.03 * air * flut(i + 4)), -ha.x * 0.35, dt, -0.25, 0.25);
      this.rotate(this.bones[names[i]!], x, 0, side);
    }
    // Sleeves: lag the swing of the upper arm (its pitch in the body's frame), flare in the wind.
    for (let k = 0; k < 2; k++) {
      const arm = k === 0 ? this.bones.upper_armL : this.bones.upper_armR;
      const sleeve = this.bones[k === 0 ? 'sleeveL' : 'sleeveR'];
      if (!arm || !sleeve || dt <= 0) continue;
      arm.updateWorldMatrix(true, false);
      const dir = this.v3.set(0, 1, 0).applyQuaternion(arm.getWorldQuaternion(this.q2)).applyQuaternion(this.inv);
      const pitch = Math.atan2(-dir.z, -dir.y);
      let vel = (pitch - this.armPrev[k]!) / dt;
      if (!Number.isFinite(vel) || Math.abs(vel) > 60) vel = 0;
      this.armVel[k]! += (vel - this.armVel[k]!) * Math.min(1, dt * 20);
      this.armPrev[k] = pitch;
      const lagX = s.sleeve[k]!.step(THREE.MathUtils.clamp(0.012 * this.armVel[k]!, -0.09, 0.09), 0, dt, -0.12, 0.12);
      const out = s.sleeveOut[k]!.step((k === 0 ? 1 : -1) * (0.02 * air + 0.015 * air * flut(k + 8)), 0, dt, -0.1, 0.1);
      this.rotate(sleeve, lagX, 0, out);
    }
  }

  /**
   * Planted feet. Outside the run cycle (whose cadence is locked to speed), a foot that touches down
   * is pinned where it landed and the leg is re-solved (two-bone IK) as the body moves on, until the
   * clip lifts it or the leg would have to stretch. Skids at speed are left to slide.
   */
  private plantFeet(dt: number): void {
    const active = this.current !== 'run' && this.current !== 'idle' && this.current !== 'ready';
    const ground = this.root.position.y;
    for (const s of ['L', 'R'] as const) {
      const f = this.feet[s];
      if (!f.thigh || !f.shin || !f.foot) continue;
      f.foot.updateWorldMatrix(true, false);
      const ankle = f.foot.getWorldPosition(this.v1);
      const h = ankle.y - ground;
      if (!active || this.speed > 4.5) f.locked = false;
      else if (!f.locked && h < 0.125) {
        f.locked = true;
        f.pos.copy(ankle);
      } else if (f.locked && h > 0.16) f.locked = false;
      f.w += ((f.locked ? 1 : 0) - f.w) * (1 - Math.exp(-dt * (f.locked ? 18 : 10)));
      if (f.w < 0.01) continue;
      if (f.locked) f.pos.y = Math.max(f.pos.y, ground + 0.08);
      const target = this.v2.copy(ankle).lerp(f.pos, f.w);
      if (!this.solveLeg(f, target)) f.locked = false;
    }
  }

  /** Two-bone IK in world space, bending in the current knee plane. False if out of reach. */
  private solveLeg(f: FootLock, target: THREE.Vector3): boolean {
    const thigh = f.thigh!;
    const shin = f.shin!;
    const foot = f.foot!;
    const H = thigh.getWorldPosition(new THREE.Vector3());
    const K = shin.getWorldPosition(new THREE.Vector3());
    const A = foot.getWorldPosition(new THREE.Vector3());
    const footQ = foot.getWorldQuaternion(new THREE.Quaternion());
    const a = H.distanceTo(K);
    const b = K.distanceTo(A);
    const toT = target.clone().sub(H);
    const d = toT.length();
    if (d > (a + b) * 0.995) return false;
    if (d < Math.abs(a - b) + 0.02) return true;
    const u = toT.divideScalar(d);
    // Bend direction: where the knee points now, made perpendicular to the hip→target line.
    const n = K.clone().sub(H);
    n.addScaledVector(u, -n.dot(u));
    if (n.lengthSq() < 1e-8) return true;
    n.normalize();
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const K2 = H.clone().addScaledVector(u, a * cosA).addScaledVector(n, a * sinA);
    this.applyWorld(thigh, new THREE.Quaternion().setFromUnitVectors(K.clone().sub(H).normalize(), K2.clone().sub(H).normalize()));
    const K3 = shin.getWorldPosition(new THREE.Vector3());
    const A3 = foot.getWorldPosition(new THREE.Vector3());
    this.applyWorld(shin, new THREE.Quaternion().setFromUnitVectors(A3.sub(K3).normalize(), target.clone().sub(K3).normalize()));
    // The foot keeps the orientation the clip gave it.
    const sq = shin.getWorldQuaternion(new THREE.Quaternion()).invert();
    foot.quaternion.copy(sq.multiply(footQ));
    foot.updateMatrixWorld(true);
    return true;
  }

  private rotate(b: THREE.Bone | undefined, x: number, y: number, z: number) {
    if (!b) return;
    this.q.setFromEuler(this.e.set(x, y, z));
    b.quaternion.multiply(this.q);
  }

  /** Forget velocities (after a teleport to a new round). */
  resetSecondary(): void {
    this.hasPrev = false;
    this.glanceT = -1;
    this.stumbleT = -1;
    this.pending = null;
    this.body.position.y = 0;
    this.driveS = this.drive = 0;
    this.exertion = 0;
    this.look.want = this.look.w = 0;
    for (const s of ['L', 'R'] as const) {
      this.feet[s].locked = false;
      this.feet[s].w = 0;
    }
    const s = this.springs;
    for (const sp of [s.pack, s.packSide, ...s.scarf, ...s.scarfSide, ...s.hem, ...s.hemSide, ...s.sleeve, ...s.sleeveOut]) sp.reset();
    this.catchT = -1;
    this.accel = 0;
    this.speedPrev = 0;
    this.armVel = [0, 0];
  }
}
