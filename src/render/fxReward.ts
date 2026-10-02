import * as THREE from 'three';

/**
 * The escape's reward light: a burst of sun ahead of the runner (a glory of rays behind the
 * silhouette), gold and jade glints showering up around them, and a warm pool of light at their
 * feet that says "safe ground". All additive, all a few draw calls.
 */

const SPARK_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 color;
  attribute float aSeed;
  uniform float uScale;
  uniform float uTime;
  varying vec3 vCol;
  varying float vA;
  void main() {
    vCol = color;
    // Glints: each one flashes as it turns.
    float tw = 0.55 + 0.45 * sin(uTime * (9.0 + aSeed * 7.0) + aSeed * 40.0);
    vA = aAlpha * tw;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1) * (0.7 + 0.5 * tw);
    gl_Position = projectionMatrix * mv;
  }`;

const SPARK_FRAG = /* glsl */ `
  varying vec3 vCol;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    // A hot core with a four-point star.
    float core = smoothstep(1.0, 0.0, r);
    core *= core * core;
    float star = max(0.0, 1.0 - abs(c.x) * 14.0) * max(0.0, 1.0 - abs(c.y) * 2.2) + max(0.0, 1.0 - abs(c.y) * 14.0) * max(0.0, 1.0 - abs(c.x) * 2.2);
    float a = (core + star * 0.6) * vA;
    gl_FragColor = vec4(vCol * a, 1.0);
  }`;

const GOLD = new THREE.Color(1.0, 0.72, 0.28).multiplyScalar(2.6);
const JADE = new THREE.Color(0.32, 1.0, 0.62).multiplyScalar(1.9);

export class Sparkles {
  readonly points: THREE.Points;
  private cap: number;
  private n = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array; // life, maxLife, size
  private aPos: THREE.BufferAttribute;
  private aCol: THREE.BufferAttribute;
  private aSize: THREE.BufferAttribute;
  private aAlpha: THREE.BufferAttribute;
  private uniforms = { uScale: { value: 600 }, uTime: { value: 0 } };
  budget: number;

  constructor(cap: number) {
    this.cap = cap;
    this.budget = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap * 3);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    const seeds = new Float32Array(cap);
    for (let i = 0; i < cap; i++) seeds[i] = Math.random();
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.name = 'fx.sparkles';
  }

  /**
   * A shower of glints around `at`: `n` of them thrown up and out at up to `speed`, a share `jade`
   * of them jade, the rest gold.
   */
  burst(at: THREE.Vector3, n: number, speed: number, spread: number, jade = 0.35, size = 0.07, life = 2.4): void {
    const col = this.aCol.array as Float32Array;
    const count = Math.min(n, this.budget);
    for (let k = 0; k < count; k++) {
      if (this.n >= Math.min(this.cap, this.budget)) return;
      const i = this.n++;
      const p = i * 3;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.pos[p] = at.x + Math.cos(a) * r;
      this.pos[p + 1] = at.y + Math.random() * 0.4;
      this.pos[p + 2] = at.z + Math.sin(a) * r;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.vel[p] = Math.cos(a) * v * 0.45;
      this.vel[p + 1] = v;
      this.vel[p + 2] = Math.sin(a) * v * 0.45;
      const c = Math.random() < jade ? JADE : GOLD;
      col[p] = c.r;
      col[p + 1] = c.g;
      col[p + 2] = c.b;
      this.life[p] = this.life[p + 1] = life * (0.6 + Math.random() * 0.7);
      this.life[p + 2] = size * (0.6 + Math.random() * 0.9);
    }
  }

  update(dt: number, time: number, scale: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uScale.value = scale;
    const size = this.aSize.array as Float32Array;
    const alpha = this.aAlpha.array as Float32Array;
    const col = this.aCol.array as Float32Array;
    let i = 0;
    while (i < this.n) {
      const p = i * 3;
      this.life[p] = this.life[p]! - dt;
      if (this.life[p]! <= 0) {
        const last = --this.n;
        if (i !== last) {
          this.pos.copyWithin(p, last * 3, last * 3 + 3);
          this.vel.copyWithin(p, last * 3, last * 3 + 3);
          this.life.copyWithin(p, last * 3, last * 3 + 3);
          col.copyWithin(p, last * 3, last * 3 + 3);
        }
        continue;
      }
      // Thrown up, then they hang and drift down slowly like gold leaf.
      const drag = Math.exp(-2.2 * dt);
      this.vel[p] = this.vel[p]! * drag;
      this.vel[p + 1] = this.vel[p + 1]! * drag - 1.4 * dt;
      this.vel[p + 2] = this.vel[p + 2]! * drag;
      this.pos[p] = this.pos[p]! + this.vel[p]! * dt;
      this.pos[p + 1] = this.pos[p + 1]! + this.vel[p + 1]! * dt;
      this.pos[p + 2] = this.pos[p + 2]! + this.vel[p + 2]! * dt;
      const t = 1 - this.life[p]! / this.life[p + 1]!;
      size[i] = this.life[p + 2]!;
      alpha[i] = Math.min(1, t * 12) * (1 - t * t);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    if (this.n) for (const a of [this.aPos, this.aCol, this.aSize, this.aAlpha]) a.needsUpdate = true;
  }

  clear(): void {
    this.n = 0;
    this.points.geometry.setDrawRange(0, 0);
  }
}

const GLORY_VERT = /* glsl */ `
  uniform vec3 uCenter;
  uniform float uSize;
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 2.0;
    vec4 mv = viewMatrix * vec4(uCenter, 1.0);
    mv.xy += position.xy * uSize;
    gl_Position = projectionMatrix * mv;
  }`;

const GLORY_FRAG = /* glsl */ `
  uniform float uLevel;
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float r = length(vUv);
    float ang = atan(vUv.y, vUv.x);
    // Slowly turning rays of uneven width, a soft halo and a hot core.
    float rays = pow(0.5 + 0.5 * sin(ang * 13.0 + uTime * 0.25), 6.0) * 0.6 + pow(0.5 + 0.5 * sin(ang * 7.0 - uTime * 0.18 + 1.3), 8.0) * 0.5;
    rays *= smoothstep(1.0, 0.15, r) * smoothstep(0.0, 0.12, r);
    float halo = exp(-r * 3.2) * 0.9 + exp(-r * 9.0) * 1.6;
    float a = (rays + halo) * uLevel * smoothstep(1.0, 0.85, r);
    gl_FragColor = vec4(uColor * a, 1.0);
  }`;

/** A burst of sun: rays and a halo on a camera-facing quad, behind the runner (depth-tested). */
export class Glory {
  readonly mesh: THREE.Mesh;
  private uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uSize: { value: 10 },
    uLevel: { value: 0 },
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(1.0, 0.8, 0.5).multiplyScalar(1.6) },
  };
  private level = 0;
  private peak = 0;
  private age = 99;
  private hold = 1;

  constructor() {
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: GLORY_VERT, fragmentShader: GLORY_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'fx.glory';
  }

  /** Flare at `at`, `size` metres across, to `peak` brightness; it eases down to a glow after `hold` s. */
  flare(at: THREE.Vector3, size: number, peak: number, hold: number): void {
    this.uniforms.uCenter.value.copy(at);
    this.uniforms.uSize.value = size;
    this.peak = peak;
    this.hold = hold;
    this.age = 0;
  }

  update(dt: number, time: number): void {
    this.age += dt;
    // Snap up in a quarter second, hold, then settle to a third (the light stays on the way ahead).
    const target = this.age < 0.25 ? this.peak * (this.age / 0.25) : this.age < this.hold ? this.peak : this.peak * (0.35 + 0.65 * Math.exp(-(this.age - this.hold) * 0.8));
    this.level += (target - this.level) * (1 - Math.exp(-dt * 10));
    this.uniforms.uLevel.value = this.level;
    this.uniforms.uTime.value = time;
    this.mesh.visible = this.level > 0.003;
  }

  clear(): void {
    this.level = this.peak = 0;
    this.age = 99;
    this.uniforms.uLevel.value = 0;
    this.mesh.visible = false;
  }
}

const POOL_FRAG = /* glsl */ `
  uniform float uLevel;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float glow = exp(-r * r * 3.0) * (0.85 + 0.15 * sin(uTime * 2.0));
    float ring = exp(-pow((r - 0.78 - 0.04 * sin(uTime * 1.3)) / 0.05, 2.0)) * 0.5;
    float a = (glow + ring) * smoothstep(1.0, 0.9, r) * uLevel;
    gl_FragColor = vec4(vec3(1.0, 0.74, 0.36) * a, 1.0);
  }`;

/** A warm pool of light on the ground under the runner: safe footing. */
export class LightPool {
  readonly mesh: THREE.Mesh;
  private uniforms = { uLevel: { value: 0 }, uTime: { value: 0 } };
  private level = 0;
  target = 0;

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: POOL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'fx.pool';
  }

  /** Follow the runner's feet; `radius` in metres. */
  place(at: THREE.Vector3, radius: number): void {
    this.mesh.position.set(at.x, at.y + 0.03, at.z);
    this.mesh.scale.set(radius * 2, 1, radius * 2);
  }

  update(dt: number, time: number): void {
    this.level += (this.target - this.level) * (1 - Math.exp(-dt * 2.2));
    this.uniforms.uLevel.value = this.level;
    this.uniforms.uTime.value = time;
    this.mesh.visible = this.level > 0.003;
  }

  clear(): void {
    this.level = this.target = 0;
    this.uniforms.uLevel.value = 0;
    this.mesh.visible = false;
  }
}

const BARS_VERT = /* glsl */ `
  uniform float uH;
  varying float vY;
  void main() {
    // Two clip-space bands at the top and bottom of the frame; position.y is ±0.5 for the band.
    float top = position.z > 0.0 ? 1.0 : -1.0;
    float y = top * (1.0 - (position.y + 0.5) * uH * 2.0);
    vY = position.y + 0.5;
    gl_Position = vec4(position.x * 2.0, y, 0.0, 1.0);
  }`;

/** Cinematic bars that slide in for the moment of the fall or the escape. */
export class Letterbox {
  readonly mesh: THREE.Mesh;
  private uniforms = { uH: { value: 0 } };
  private h = 0;
  target = 0;

  constructor() {
    // Two quads; z marks which band (top +1, bottom −1), y spans the band.
    const a = new THREE.PlaneGeometry(1, 1).translate(0, 0, 1);
    const b = new THREE.PlaneGeometry(1, 1).translate(0, 0, -1);
    const geo = new THREE.BufferGeometry();
    const pa = a.getAttribute('position').array as Float32Array;
    const pb = b.getAttribute('position').array as Float32Array;
    const pos = new Float32Array(pa.length + pb.length);
    pos.set(pa);
    pos.set(pb, pa.length);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ia = Array.from(a.index!.array);
    geo.setIndex([...ia, ...ia.map((i) => i + 4)]);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: BARS_VERT,
      fragmentShader: 'varying float vY; void main(){ gl_FragColor = vec4(vec3(0.012, 0.008, 0.006), 1.0); }',
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    this.mesh.name = 'fx.letterbox';
  }

  update(rawDt: number): void {
    this.h += (this.target - this.h) * (1 - Math.exp(-rawDt * 5));
    if (Math.abs(this.target - this.h) < 1e-4) this.h = this.target;
    this.uniforms.uH.value = this.h;
    this.mesh.visible = this.h > 0.0015;
  }

  clear(): void {
    this.h = this.target = 0;
    this.uniforms.uH.value = 0;
    this.mesh.visible = false;
  }
}
