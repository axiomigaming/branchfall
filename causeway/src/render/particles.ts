import * as THREE from 'three';

/**
 * Soft billboard particles on the CPU (a few hundred at most): dust puffs from
 * footsteps, impact clouds, splashes, falling grit. One draw call.
 */
export interface Emit {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  size: number;
  grow: number;
  color: THREE.Color;
  alpha: number;
  drag?: number;
  gravity?: number;
}

export class Particles {
  readonly points: THREE.Points;
  private max: number;
  private n = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private data: Float32Array; // life, maxLife, size, grow, alpha, drag, gravity
  private aPos: THREE.BufferAttribute;
  private aCol: THREE.BufferAttribute;
  private aSize: THREE.BufferAttribute;
  private aAlpha: THREE.BufferAttribute;
  budget = 1;

  constructor(max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.data = new Float32Array(max * 7);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 600 } }]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        attribute float aSize; attribute float aAlpha; attribute vec3 color;
        varying vec3 vCol; varying float vA;
        uniform float uScale;
        void main() {
          vCol = color; vA = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mvPosition.z, 0.1);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        varying vec3 vCol; varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          a *= a;
          // A little internal texture so clouds do not look like discs.
          float n = fract(sin(dot(floor(gl_PointCoord * 6.0), vec2(12.9, 78.2))) * 43758.5);
          a *= 0.85 + 0.15 * n;
          gl_FragColor = vec4(vCol, a * vA);
          #include <fog_fragment>
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  setViewport(heightPx: number, fovDeg: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale!.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(e: Emit): void {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([e.pos.x, e.pos.y, e.pos.z], i * 3);
    this.vel.set([e.vel.x, e.vel.y, e.vel.z], i * 3);
    this.col.set([e.color.r, e.color.g, e.color.b], i * 3);
    this.data.set([e.life, e.life, e.size, e.grow, e.alpha, e.drag ?? 1.5, e.gravity ?? 0], i * 7);
  }

  /** A burst of `count` particles around `at`, scaled by the quality budget. */
  burst(at: THREE.Vector3, count: number, opts: { spread: number; up: number; speed: number; size: number; life: number; color: THREE.Color; alpha?: number; grow?: number; gravity?: number; drag?: number }): void {
    const n = Math.round(count * this.budget);
    const v = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      p.set(at.x + (Math.random() - 0.5) * opts.spread, at.y + Math.random() * 0.2, at.z + (Math.random() - 0.5) * opts.spread);
      v.set((Math.random() - 0.5) * opts.speed, Math.random() * opts.up, (Math.random() - 0.5) * opts.speed);
      this.emit({
        pos: p,
        vel: v,
        life: opts.life * (0.6 + Math.random() * 0.8),
        size: opts.size * (0.6 + Math.random() * 0.8),
        grow: opts.grow ?? 1.2,
        color: opts.color,
        alpha: opts.alpha ?? 0.5,
        gravity: opts.gravity ?? 0,
        drag: opts.drag ?? 1.8,
      });
    }
  }

  update(dt: number): void {
    const size = this.aSize.array as Float32Array;
    const alpha = this.aAlpha.array as Float32Array;
    let i = 0;
    while (i < this.n) {
      const d = i * 7;
      this.data[d] = this.data[d]! - dt;
      if (this.data[d]! <= 0) {
        this.kill(i);
        continue;
      }
      const t = 1 - this.data[d]! / this.data[d + 1]!;
      const drag = Math.exp(-this.data[d + 5]! * dt);
      const p = i * 3;
      this.vel[p] = this.vel[p]! * drag;
      this.vel[p + 1] = this.vel[p + 1]! * drag - this.data[d + 6]! * dt;
      this.vel[p + 2] = this.vel[p + 2]! * drag;
      this.pos[p] = this.pos[p]! + this.vel[p]! * dt;
      this.pos[p + 1] = this.pos[p + 1]! + this.vel[p + 1]! * dt;
      this.pos[p + 2] = this.pos[p + 2]! + this.vel[p + 2]! * dt;
      size[i] = this.data[d + 2]! * (1 + this.data[d + 3]! * t);
      alpha[i] = this.data[d + 4]! * Math.min(1, t * 8) * (1 - t) * (1 - t);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }

  private kill(i: number): void {
    const last = --this.n;
    if (i !== last) {
      this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.col.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.data.copyWithin(i * 7, last * 7, last * 7 + 7);
    }
  }

  clear(): void {
    this.n = 0;
    this.points.geometry.setDrawRange(0, 0);
  }
}

/** Sunlit specks drifting in the air around the camera. */
export class Motes {
  readonly points: THREE.Points;
  private offsets: Float32Array;
  private count: number;
  constructor(count = 420) {
    this.count = count;
    const g = new THREE.BufferGeometry();
    this.offsets = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.offsets[i * 3] = (Math.random() - 0.5) * 30;
      this.offsets[i * 3 + 1] = Math.random() * 8 - 1;
      this.offsets[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.offsets.slice(), 3));
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = Math.random();
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uScale: { value: 600 }, uAmount: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime; uniform vec3 uCenter; uniform float uScale; uniform float uAmount;
        varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.3 + aSeed * 40.0) * 0.8;
          p.y += sin(uTime * 0.21 + aSeed * 17.0) * 0.5;
          // Wrap the field around the camera so it never runs out.
          vec3 rel = mod(p - uCenter + 15.0, 30.0) - 15.0;
          rel.y = mod(p.y - uCenter.y + 3.0, 8.0) - 3.0;
          vec4 mv = modelViewMatrix * vec4(uCenter + rel, 1.0);
          float d = -mv.z;
          vA = smoothstep(0.5, 2.5, d) * smoothstep(16.0, 8.0, d) * (0.4 + 0.6 * fract(aSeed * 7.3)) * uAmount;
          gl_PointSize = (0.025 + 0.03 * aSeed) * uScale / max(d, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * 1.6, a * vA * 0.7);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }

  update(t: number, cam: THREE.Camera, scale: number, amount: number): void {
    const u = (this.points.material as THREE.ShaderMaterial).uniforms;
    u.uTime!.value = t;
    u.uCenter!.value.copy(cam.position);
    u.uScale!.value = scale;
    u.uAmount!.value = amount;
  }
}
