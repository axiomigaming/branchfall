import * as THREE from 'three';

/**
 * Birds bursting out of the trees: a flock launches from a point, beats hard to climb, then
 * settles into a glide as it wheels away. CPU-steered (a few dozen at most), one instanced draw;
 * the wing beat is in the vertex shader from a per-bird phase.
 */

const VERT = /* glsl */ `
  #include <fog_pars_vertex>
  attribute float aWing;
  attribute float aFlap;
  varying float vShade;
  void main() {
    vec3 p = position;
    float tip = abs(aWing);
    p.y += sin(aFlap) * tip * 0.34;
    p.x *= 1.0 - 0.18 * tip * max(0.0, -sin(aFlap));
    vShade = 0.5 + 0.5 * tip;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */ `
  #include <fog_pars_fragment>
  varying float vShade;
  void main() {
    gl_FragColor = vec4(mix(vec3(0.09, 0.075, 0.06), vec3(0.2, 0.15, 0.11), vShade), 1.0);
    #include <fog_fragment>
  }`;

function birdGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // Body (a thin diamond) and two swept wings; aWing is 0 on the body, ±1 at the tips.
  const p = [
    0, 0, -0.22, 0.04, 0, 0, 0, 0, 0.2,
    0, 0, -0.22, 0, 0, 0.2, -0.04, 0, 0,
    0, 0, -0.06, 0.42, 0, 0.1, 0, 0, 0.08,
    0, 0, -0.06, 0, 0, 0.08, -0.42, 0, 0.1,
  ];
  const w = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, -1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(w, 1));
  return g;
}

interface Bird {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  goal: THREE.Vector3;
  phase: number;
  rate: number;
  age: number;
  life: number;
  delay: number;
  on: boolean;
}

export class Flock {
  readonly mesh: THREE.InstancedMesh;
  private birds: Bird[] = [];
  private aFlap: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  private look = new THREE.Matrix4();
  private tmp = new THREE.Vector3();
  budget: number;

  constructor(private cap: number) {
    this.budget = cap;
    const geo = birdGeometry();
    this.aFlap = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFlap', this.aFlap);
    const mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog), vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, fog: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'fx.flock';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) this.birds.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), goal: new THREE.Vector3(), phase: 0, rate: 0, age: 0, life: 0, delay: 0, on: false });
  }

  /**
   * `n` birds take off around `from` (spread metres), heading for `toward` (a direction, roughly
   * horizontal) and climbing. `stagger` spreads their take-offs over that many seconds.
   */
  launch(from: THREE.Vector3, toward: THREE.Vector3, n: number, spread: number, stagger = 0.5): void {
    const dir = this.tmp.copy(toward).setY(0).normalize();
    let free = this.birds.filter((b, i) => !b.on && i < this.budget);
    for (let k = 0; k < n && free.length; k++) {
      const b = free.pop()!;
      const r = Math.random;
      b.on = true;
      b.pos.set(from.x + (r() - 0.5) * spread, from.y + r() * spread * 0.3, from.z + (r() - 0.5) * spread);
      const side = (r() - 0.5) * 1.2;
      b.goal.set(dir.x + -dir.z * side, 0.35 + r() * 0.35, dir.z + dir.x * side).normalize().multiplyScalar(7 + r() * 3);
      b.vel.set((r() - 0.5) * 2, 3 + r() * 2.5, (r() - 0.5) * 2).addScaledVector(dir, 1.5);
      b.phase = r() * 6.28;
      b.rate = 15 + r() * 6;
      b.age = 0;
      b.life = 7 + r() * 3;
      b.delay = r() * stagger;
    }
    free = [];
  }

  update(dt: number): void {
    let top = 0;
    const flap = this.aFlap.array as Float32Array;
    for (let i = 0; i < this.cap; i++) {
      const b = this.birds[i]!;
      if (!b.on) continue;
      if (b.delay > 0) {
        b.delay -= dt;
        // Hidden until it breaks cover.
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        top = i + 1;
        continue;
      }
      b.age += dt;
      if (b.age > b.life) {
        b.on = false;
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        continue;
      }
      // Steer toward the goal velocity; hard beats early, gliding later.
      b.vel.lerp(b.goal, 1 - Math.exp(-dt * 1.4));
      b.pos.addScaledVector(b.vel, dt);
      const beating = b.age < 1.6 || Math.sin(b.age * 0.9 + b.phase) > 0.3;
      b.phase += dt * (beating ? b.rate : 0.6);
      flap[i] = beating ? b.phase : 0.25 + 0.1 * Math.sin(b.phase);
      this.look.lookAt(this.tmp.set(0, 0, 0), b.vel, THREE.Object3D.DEFAULT_UP);
      this.q.setFromRotationMatrix(this.look);
      const sc = Math.min(1, b.age * 6) * 1.15;
      this.m.compose(b.pos, this.q, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, this.m);
      top = i + 1;
    }
    this.mesh.count = top;
    if (top) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.aFlap.needsUpdate = true;
    }
  }

  clear(): void {
    for (const b of this.birds) b.on = false;
    this.mesh.count = 0;
  }
}
