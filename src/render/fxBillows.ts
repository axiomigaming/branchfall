import * as THREE from 'three';

/**
 * Billowing dust clouds: soft, sun-lit sprites that roll outward, swell and rise. Each sprite is a
 * camera-facing quad whose density comes from a tiling noise and a radial falloff; it is shaded by
 * marching one tap toward the sun on screen (self-shadowing: the side away from the sun is dense
 * and dark, the sunward rim bright), and glows at its thin edges when the sun is behind it. One
 * instanced draw, sorted back to front on the CPU (a few hundred sprites at most).
 */

const VERT = /* glsl */ `
  #include <fog_pars_vertex>
  attribute vec3 aPos;
  attribute vec4 aData; // size, alpha, rotation, seed
  attribute vec3 aTint;
  uniform vec3 uSunView;
  varying vec2 vUv;
  varying float vA;
  varying vec3 vTint;
  varying vec2 vSun;
  varying float vSeed;
  void main() {
    vec4 mvPosition = viewMatrix * vec4(aPos, 1.0);
    float c = cos(aData.z), s = sin(aData.z);
    mvPosition.xy += mat2(c, s, -s, c) * position.xy * aData.x;
    vUv = position.xy + 0.5;
    // The sun's direction across the screen, in the sprite's own (rotated) frame.
    vec2 sd = uSunView.xy;
    sd = length(sd) > 1e-3 ? normalize(sd) : vec2(0.0, 1.0);
    vSun = mat2(c, -s, s, c) * sd;
    // Fade out as a cloud reaches the lens, so the camera never sits inside a flat grey wall.
    vA = aData.y * smoothstep(0.6, 2.6, -mvPosition.z);
    vTint = aTint;
    vSeed = aData.w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */ `
  #include <fog_pars_fragment>
  uniform sampler2D uNoise;
  uniform vec3 uSunCol;
  uniform vec3 uShadeCol;
  uniform float uBack;
  varying vec2 vUv;
  varying float vA;
  varying vec3 vTint;
  varying vec2 vSun;
  varying float vSeed;
  float dens(vec2 uv) {
    vec2 c = uv - 0.5;
    float r = length(c) * 2.0;
    float n = texture2D(uNoise, uv * 0.62 + vec2(vSeed, vSeed * 1.7)).r;
    return clamp(n * 1.3 - 0.06 - r * r * 1.3, 0.0, 1.0);
  }
  void main() {
    float d = dens(vUv);
    if (d < 0.004) discard;
    float toward = dens(vUv + vSun * 0.13);
    float lit = clamp(1.0 - toward * 1.6 + d * 0.5, 0.0, 1.0);
    vec3 col = mix(uShadeCol, uSunCol, lit) * vTint;
    // Back-lit: the thin edges of the cloud catch the light.
    col += uSunCol * vTint * uBack * (1.0 - smoothstep(0.0, 0.55, d)) * 0.9;
    float a = smoothstep(0.0, 0.65, d) * 0.9 * vA;
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
  }`;

function noiseTexture(size = 128): THREE.DataTexture {
  // Tiling value-noise fbm with billowy (abs) octaves: cauliflower lumps.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lat = (n: number) => Array.from({ length: n * n }, rnd);
  const octaves = [4, 8, 16, 32].map((n) => ({ n, g: lat(n) }));
  const data = new Uint8Array(size * size * 4);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.55;
      for (const o of octaves) {
        const fx = (x / size) * o.n;
        const fy = (y / size) * o.n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const at = (i: number, j: number) => o.g[((j % o.n) * o.n + (i % o.n)) % (o.n * o.n)]!;
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        v += Math.abs((a + (b - a) * ty) * 2 - 1) * amp;
        amp *= 0.5;
      }
      const k = (y * size + x) * 4;
      const b = Math.max(0, Math.min(255, Math.round(Math.min(1, v * 1.25) * 255)));
      data[k] = data[k + 1] = data[k + 2] = b;
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export interface PuffOpts {
  /** Number of sprites (scaled by the budget). */
  count: number;
  /** Random placement around the centre (metres, horizontal; vertical is a fifth). */
  spread: number;
  /** Mean launch velocity, plus random jitter of this magnitude. */
  vel?: THREE.Vector3;
  jitter: number;
  /** Start and end size (metres). */
  size: [number, number];
  life: number;
  alpha: number;
  tint?: THREE.Color;
  /** Upward drift (m/s²) and drag (1/s). */
  rise?: number;
  drag?: number;
  /** Lowest the centre may sink (e.g. the floor), so clouds roll along it. */
  floor?: number;
  /** A tag for fading a group early (e.g. 'cue'). */
  group?: number;
}

const WHITE = new THREE.Color(1, 1, 1);

export class Billows {
  readonly mesh: THREE.Mesh;
  private cap: number;
  private n = 0;
  budget: number;
  /** Count multiplier from the quality tier and motion setting. */
  scale = 1;
  private p: Float32Array; // x y z
  private v: Float32Array;
  private d: Float32Array; // life, maxLife, s0, s1, alpha, rot, rotV, seed, rise, drag, floor, group
  private t: Float32Array; // tint
  private aPos: THREE.InstancedBufferAttribute;
  private aData: THREE.InstancedBufferAttribute;
  private aTint: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private order: number[] = [];
  private depth: Float32Array;
  private uniforms: Record<string, THREE.IUniform>;
  private static D = 12;

  constructor(cap: number) {
    this.cap = cap;
    this.budget = cap;
    this.p = new Float32Array(cap * 3);
    this.v = new Float32Array(cap * 3);
    this.d = new Float32Array(cap * Billows.D);
    this.t = new Float32Array(cap * 3);
    this.depth = new Float32Array(cap);
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aTint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos);
    g.setAttribute('aData', this.aData);
    g.setAttribute('aTint', this.aTint);
    g.instanceCount = 0;
    this.geo = g;
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uNoise: { value: null },
        uSunView: { value: new THREE.Vector3(0, 0.3, -1) },
        uSunCol: { value: new THREE.Color(1.25, 1.0, 0.74) },
        uShadeCol: { value: new THREE.Color(0.36, 0.27, 0.21) },
        uBack: { value: 0 },
      },
    ]);
    this.uniforms.uNoise!.value = noiseTexture();
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.name = 'fx.billows';
  }

  get count(): number {
    return this.n;
  }

  private static tmp = new THREE.Vector3();

  puff(at: THREE.Vector3, o: PuffOpts): void {
    const n = Math.max(o.count > 0 ? 1 : 0, Math.round(o.count * this.scale));
    const tint = o.tint ?? WHITE;
    for (let k = 0; k < n; k++) {
      if (this.n >= Math.min(this.cap, this.budget)) this.kill(this.oldest());
      const i = this.n++;
      const p = i * 3;
      const r = Math.random;
      this.p[p] = at.x + (r() - 0.5) * o.spread;
      this.p[p + 1] = at.y + (r() - 0.5) * o.spread * 0.2;
      this.p[p + 2] = at.z + (r() - 0.5) * o.spread;
      const v = o.vel ?? Billows.tmp.set(0, 0, 0);
      const j = o.jitter;
      this.v[p] = v.x + (r() - 0.5) * 2 * j;
      this.v[p + 1] = v.y + (r() - 0.3) * j;
      this.v[p + 2] = v.z + (r() - 0.5) * 2 * j;
      const d = i * Billows.D;
      const life = o.life * (0.7 + r() * 0.6);
      this.d[d] = life;
      this.d[d + 1] = life;
      this.d[d + 2] = o.size[0] * (0.75 + r() * 0.5);
      this.d[d + 3] = o.size[1] * (0.75 + r() * 0.5);
      this.d[d + 4] = o.alpha * (0.75 + r() * 0.5);
      this.d[d + 5] = r() * 6.283;
      this.d[d + 6] = (r() - 0.5) * 0.6;
      this.d[d + 7] = r();
      this.d[d + 8] = o.rise ?? 0.25;
      this.d[d + 9] = o.drag ?? 1.6;
      this.d[d + 10] = o.floor ?? -1e4;
      this.d[d + 11] = o.group ?? 0;
      const sh = 0.9 + r() * 0.2;
      this.t[p] = tint.r * sh;
      this.t[p + 1] = tint.g * sh;
      this.t[p + 2] = tint.b * sh;
    }
  }

  private oldest(): number {
    let best = 0;
    let bt = Infinity;
    for (let i = 0; i < this.n; i++) {
      const left = this.d[i * Billows.D]!;
      if (left < bt) {
        bt = left;
        best = i;
      }
    }
    return best;
  }

  /** Fade a tagged group out within `seconds`. */
  fadeGroup(group: number, seconds: number): void {
    for (let i = 0; i < this.n; i++) {
      const d = i * Billows.D;
      if (this.d[d + 11] === group && this.d[d]! > seconds) {
        // Keep the age fraction continuous: shrink the remaining life only.
        const age = this.d[d + 1]! - this.d[d]!;
        this.d[d] = seconds;
        this.d[d + 1] = age + seconds;
      }
    }
  }

  private camPos = new THREE.Vector3();
  private camFwd = new THREE.Vector3();
  private sunV = new THREE.Vector3();

  update(dt: number, cam: THREE.Camera, sunDir: THREE.Vector3): void {
    let i = 0;
    while (i < this.n) {
      const d = i * Billows.D;
      this.d[d] = this.d[d]! - dt;
      if (this.d[d]! <= 0) {
        this.kill(i);
        continue;
      }
      const p = i * 3;
      const drag = Math.exp(-this.d[d + 9]! * dt);
      this.v[p] = this.v[p]! * drag;
      this.v[p + 1] = this.v[p + 1]! * drag + this.d[d + 8]! * dt;
      this.v[p + 2] = this.v[p + 2]! * drag;
      this.p[p] = this.p[p]! + this.v[p]! * dt;
      this.p[p + 1] = this.p[p + 1]! + this.v[p + 1]! * dt;
      this.p[p + 2] = this.p[p + 2]! + this.v[p + 2]! * dt;
      const t = 1 - this.d[d]! / this.d[d + 1]!;
      const size = this.d[d + 2]! + (this.d[d + 3]! - this.d[d + 2]!) * (1 - (1 - t) * (1 - t));
      const fl = this.d[d + 10]! + size * 0.28;
      if (this.p[p + 1]! < fl) {
        this.p[p + 1] = fl;
        if (this.v[p + 1]! < 0) this.v[p + 1] = 0;
      }
      this.d[d + 5] = this.d[d + 5]! + this.d[d + 6]! * dt;
      i++;
    }
    // Sort back to front and upload.
    cam.getWorldPosition(this.camPos);
    cam.getWorldDirection(this.camFwd);
    const order = this.order;
    order.length = this.n;
    for (let k = 0; k < this.n; k++) {
      order[k] = k;
      this.depth[k] = (this.p[k * 3]! - this.camPos.x) * this.camFwd.x + (this.p[k * 3 + 1]! - this.camPos.y) * this.camFwd.y + (this.p[k * 3 + 2]! - this.camPos.z) * this.camFwd.z;
    }
    order.sort((a, b) => this.depth[b]! - this.depth[a]!);
    const ap = this.aPos.array as Float32Array;
    const ad = this.aData.array as Float32Array;
    const at = this.aTint.array as Float32Array;
    for (let k = 0; k < this.n; k++) {
      const s = order[k]!;
      const d = s * Billows.D;
      const t = 1 - this.d[d]! / this.d[d + 1]!;
      const size = this.d[d + 2]! + (this.d[d + 3]! - this.d[d + 2]!) * (1 - (1 - t) * (1 - t));
      ap[k * 3] = this.p[s * 3]!;
      ap[k * 3 + 1] = this.p[s * 3 + 1]!;
      ap[k * 3 + 2] = this.p[s * 3 + 2]!;
      ad[k * 4] = size;
      ad[k * 4 + 1] = this.d[d + 4]! * Math.min(1, t * 10) * (1 - t) * (1 - t * 0.35);
      ad[k * 4 + 2] = this.d[d + 5]!;
      ad[k * 4 + 3] = this.d[d + 7]!;
      at[k * 3] = this.t[s * 3]!;
      at[k * 3 + 1] = this.t[s * 3 + 1]!;
      at[k * 3 + 2] = this.t[s * 3 + 2]!;
    }
    this.geo.instanceCount = this.n;
    if (this.n > 0) {
      for (const a of [this.aPos, this.aData, this.aTint]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, this.n * a.itemSize);
        a.needsUpdate = true;
      }
    }
    // Sun in view space, and how much it sits behind the clouds (back light).
    this.sunV.copy(sunDir).transformDirection(cam.matrixWorldInverse);
    this.uniforms.uSunView!.value.copy(this.sunV);
    this.uniforms.uBack!.value = Math.max(0, -this.sunV.z) ** 2;
  }

  private kill(i: number): void {
    const last = --this.n;
    if (i !== last) {
      this.p.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.v.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.t.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.d.copyWithin(i * Billows.D, last * Billows.D, last * Billows.D + Billows.D);
    }
  }

  clear(): void {
    this.n = 0;
    this.geo.instanceCount = 0;
  }
}
