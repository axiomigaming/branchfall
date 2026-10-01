import * as THREE from 'three';

/**
 * Flat, procedural, instanced decals for the falls:
 *  - Rings: a shockwave ripple spreading over the water where something heavy hit it.
 *  - Cracks: fissures spreading across the floor before a chasm opens (a pre-impact cue staged
 *    inside the fall's cinematic, once the outcome is settled).
 * Each pool is one draw; per-instance data drives a shader, nothing is textured.
 */

interface Slot {
  age: number;
  life: number;
  seed: number;
  alpha: number;
  on: boolean;
}

abstract class DecalPool {
  readonly mesh: THREE.InstancedMesh;
  protected slots: Slot[] = [];
  protected aP: THREE.InstancedBufferAttribute;
  budget: number;
  private dummy = new THREE.Object3D();

  constructor(
    protected cap: number,
    vertex: string,
    fragment: string,
    uniforms: Record<string, THREE.IUniform> = {},
  ) {
    this.budget = cap;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.aP = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aP', this.aP);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) this.slots.push({ age: 0, life: 1, seed: 0, alpha: 0, on: false });
  }

  protected place(pos: THREE.Vector3, yaw: number, sx: number, sz: number, life: number, alpha: number): number {
    let i = this.slots.findIndex((s, k) => !s.on && k < this.budget);
    if (i < 0) {
      // Recycle the oldest.
      let best = -1;
      for (let k = 0; k < Math.min(this.cap, this.budget); k++) if (best < 0 || this.slots[k]!.age / this.slots[k]!.life > this.slots[best]!.age / this.slots[best]!.life) best = k;
      i = Math.max(0, best);
    }
    const s = this.slots[i]!;
    s.on = true;
    s.age = 0;
    s.life = life;
    s.seed = Math.random();
    s.alpha = alpha;
    this.dummy.position.copy(pos);
    this.dummy.rotation.set(0, yaw, 0);
    this.dummy.scale.set(sx, 1, sz);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    return i;
  }

  /** Per-instance shader data from a slot's progress. */
  protected abstract data(s: Slot, out: Float32Array, o: number): void;

  update(dt: number): void {
    let top = 0;
    const a = this.aP.array as Float32Array;
    for (let i = 0; i < this.cap; i++) {
      const s = this.slots[i]!;
      if (s.on) {
        s.age += dt;
        if (s.age >= s.life) s.on = false;
      }
      if (s.on) {
        this.data(s, a, i * 4);
        top = i + 1;
      } else a[i * 4 + 1] = 0;
    }
    this.mesh.count = top;
    if (top) this.aP.needsUpdate = true;
  }

  clear(): void {
    for (const s of this.slots) s.on = false;
    this.mesh.count = 0;
  }
}

const RING_VERT = /* glsl */ `
  #include <fog_pars_vertex>
  attribute vec4 aP;
  varying vec2 vUv;
  varying vec4 vP;
  void main() {
    vUv = uv - 0.5;
    vP = aP;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const RING_FRAG = /* glsl */ `
  #include <fog_pars_fragment>
  varying vec2 vUv;
  varying vec4 vP; // progress, alpha, seed, -
  void main() {
    float r = length(vUv) * 2.0;
    float t = vP.x;
    float ang = atan(vUv.y, vUv.x);
    float wob = 0.012 * sin(ang * 7.0 + vP.z * 30.0) + 0.008 * sin(ang * 13.0 - vP.z * 11.0);
    float R1 = (1.0 - pow(1.0 - t, 2.2)) * 0.92 + wob;
    float R2 = R1 * 0.62;
    float w = 0.025 + 0.05 * t;
    float crest = exp(-pow((r - R1) / w, 2.0)) + 0.6 * exp(-pow((r - R2) / (w * 0.8), 2.0));
    float trough = exp(-pow((r - R1 + w * 1.8) / (w * 1.4), 2.0));
    float fade = (1.0 - t) * (1.0 - t) * smoothstep(1.0, 0.85, r);
    // A brief boil of white water at the centre.
    float boil = smoothstep(0.32 * (1.0 - t), 0.0, r) * (1.0 - smoothstep(0.0, 0.35, t));
    vec3 col = mix(vec3(0.16, 0.22, 0.2), vec3(1.0, 0.98, 0.93), clamp(crest + boil, 0.0, 1.0));
    float a = clamp(crest * 0.75 + trough * 0.22 + boil * 0.85, 0.0, 1.0) * fade * vP.y;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * 1.05, a);
    #include <fog_fragment>
  }`;

export class Rings extends DecalPool {
  constructor(cap: number) {
    super(cap, RING_VERT, RING_FRAG);
    this.mesh.name = 'fx.rings';
    this.mesh.renderOrder = 2;
  }

  /** A shockwave on the water at `pos` (y = water level) reaching `radius` metres. */
  spawn(pos: THREE.Vector3, radius: number, strength: number, life = 1.6 + radius * 0.12): void {
    this.place(new THREE.Vector3(pos.x, pos.y + 0.06, pos.z), Math.random() * 6.28, radius * 2, radius * 2, life, Math.min(1, strength));
  }

  protected data(s: Slot, a: Float32Array, o: number): void {
    a[o] = s.age / s.life;
    a[o + 1] = s.alpha;
    a[o + 2] = s.seed;
  }
}

const CRACK_FRAG = /* glsl */ `
  #include <fog_pars_fragment>
  varying vec2 vUv;
  varying vec4 vP; // progress, alpha, seed, aspect (length / width)
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p + vP.z * 17.0) * 43758.5453);
  }
  // Distance to the nearest voronoi cell border.
  float edges(vec2 x) {
    vec2 n = floor(x);
    vec2 f = fract(x);
    vec2 mg, mr;
    float md = 8.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + hash2(n + g) - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
    md = 8.0;
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + hash2(n + g) - f;
      if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
    }
    return md;
  }
  void main() {
    // Local metres: x across the path, y along it (0 = the seam that will give).
    vec2 m = vec2(vUv.x, vUv.y * vP.w);
    float t = vP.x;
    // The main fissure runs across the path along the seam, jagged.
    float jag = 0.02 * sin(m.x * 13.0 + vP.z * 20.0) + 0.012 * sin(m.x * 41.0 - vP.z * 7.0) + 0.006 * sin(m.x * 97.0);
    float main = abs(m.y - 0.02 - jag);
    // It races across from a random start point; branches follow behind it.
    float start = vP.z - 0.5;
    float reach = t * 1.4;
    float across = smoothstep(reach, reach - 0.12, abs(m.x - start));
    float mainLine = (1.0 - smoothstep(0.003, 0.008 + 0.01 * t, main)) * across;
    float e = edges(m * vec2(5.0, 3.2) + vP.z * 9.0);
    float branchReach = 0.02 + 0.6 * smoothstep(0.05, 1.0, t);
    float near = smoothstep(branchReach, branchReach * 0.5, max(0.0, m.y)) * step(-0.05, m.y);
    float branch = (1.0 - smoothstep(0.008, 0.02, e)) * near * across;
    float crack = max(mainLine, branch * 0.85);
    // A pale dusty lip either side of the fissure.
    float lip = (1.0 - smoothstep(0.01, 0.04 + 0.03 * t, main)) * across * 0.25;
    vec3 col = mix(vec3(0.42, 0.32, 0.24), vec3(0.03, 0.02, 0.015), crack / max(1e-3, crack + lip));
    float a = clamp(crack + lip, 0.0, 1.0) * vP.y;
    a *= smoothstep(0.5, 0.42, abs(vUv.x)) * smoothstep(0.5, 0.4, abs(vUv.y));
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
  }`;

export class Cracks extends DecalPool {
  private grow = new Map<Slot, number>();
  constructor(cap: number) {
    super(cap, RING_VERT, CRACK_FRAG);
    this.mesh.name = 'fx.cracks';
    this.mesh.renderOrder = 1;
  }

  /**
   * Cracks across the path at `pos` (on the floor, the seam that will give), spreading over
   * `spreadT` seconds and holding for `hold` more; `len` metres along the route, `width` across.
   */
  spawn(pos: THREE.Vector3, yaw: number, width: number, len: number, spreadT: number, hold: number): void {
    const i = this.place(pos, yaw, width, len * 2, spreadT + hold, 0.92);
    this.grow.set(this.slots[i]!, spreadT);
    (this.aP.array as Float32Array)[i * 4 + 3] = (len * 2) / width;
  }

  protected data(s: Slot, a: Float32Array, o: number): void {
    const spread = this.grow.get(s) ?? 0.5;
    a[o] = Math.min(1, s.age / spread);
    a[o + 1] = s.alpha * Math.min(1, (s.life - s.age) / 0.3);
    a[o + 2] = s.seed;
  }
}
