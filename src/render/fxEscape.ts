import * as THREE from 'three';

/**
 * The reward light of an escape: shafts of sun slanting down onto the way ahead, and a warm golden
 * rim on the runner's silhouette.
 */

const BEAM_VERT = /* glsl */ `
  attribute vec3 aTop;
  attribute vec3 aBot;
  attribute vec4 aW; // width, alpha, seed, -
  varying vec2 vUv;
  varying vec4 vW;
  void main() {
    float t = position.y + 0.5;
    vec3 axis = aTop - aBot;
    vec3 p = mix(aBot, aTop, t);
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = normalize(cross(axis, toCam));
    p += side * position.x * aW.x * (0.55 + 0.9 * t);
    vUv = vec2(position.x * 2.0, t);
    vW = aW;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const BEAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uStrength;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec4 vW;
  void main() {
    float across = 1.0 - abs(vUv.x);
    across *= across;
    float along = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
    float streak = 0.65 + 0.35 * sin(vUv.x * 9.0 + vW.z * 40.0 + uTime * 0.6) * sin(vUv.x * 4.0 - uTime * 0.35 + vW.z * 11.0);
    float a = across * along * streak * vW.y * uStrength;
    gl_FragColor = vec4(uColor * a, 1.0);
  }`;

interface Beam {
  top: THREE.Vector3;
  bot: THREE.Vector3;
  width: number;
  alpha: number;
  target: number;
  seed: number;
  on: boolean;
}

export class Beams {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private aTop: THREE.InstancedBufferAttribute;
  private aBot: THREE.InstancedBufferAttribute;
  private aW: THREE.InstancedBufferAttribute;
  private beams: Beam[] = [];
  private uniforms = { uTime: { value: 0 }, uStrength: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.78, 0.46).multiplyScalar(0.9) } };
  budget: number;
  private strength = 0;
  private strengthTarget = 0;

  constructor(private cap: number) {
    this.budget = cap;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    this.aTop = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aBot = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aW = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aTop', this.aTop);
    g.setAttribute('aBot', this.aBot);
    g.setAttribute('aW', this.aW);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'fx.beams';
    for (let i = 0; i < cap; i++) this.beams.push({ top: new THREE.Vector3(), bot: new THREE.Vector3(), width: 1, alpha: 0, target: 0, seed: 0, on: false });
  }

  /** A shaft of sun landing at `ground`, slanting in from `sunDir`. */
  add(ground: THREE.Vector3, sunDir: THREE.Vector3, width: number, alpha: number): void {
    const b = this.beams.find((x, i) => !x.on && i < this.budget);
    if (!b) return;
    b.on = true;
    b.bot.copy(ground);
    // Lower the sun a touch so the shafts lean visibly even under a high sun.
    const dir = new THREE.Vector3(sunDir.x, Math.min(sunDir.y, 0.55), sunDir.z).normalize();
    b.top.copy(ground).addScaledVector(dir, 34);
    b.width = width;
    b.alpha = 0;
    b.target = alpha;
    b.seed = Math.random();
  }

  /** Overall brightness target (0..1); the shafts ease toward it. */
  set level(x: number) {
    this.strengthTarget = x;
  }

  update(dt: number, time: number): void {
    this.strength += (this.strengthTarget - this.strength) * (1 - Math.exp(-dt * 1.6));
    this.uniforms.uTime.value = time;
    this.uniforms.uStrength.value = this.strength;
    let n = 0;
    const t = this.aTop.array as Float32Array;
    const bo = this.aBot.array as Float32Array;
    const w = this.aW.array as Float32Array;
    for (const b of this.beams) {
      if (!b.on) continue;
      b.alpha += (b.target - b.alpha) * (1 - Math.exp(-dt * 1.2));
      t.set([b.top.x, b.top.y, b.top.z], n * 3);
      bo.set([b.bot.x, b.bot.y, b.bot.z], n * 3);
      w.set([b.width, b.alpha, b.seed, 0], n * 4);
      n++;
    }
    this.geo.instanceCount = this.strength > 0.002 ? n : 0;
    if (n) {
      this.aTop.needsUpdate = true;
      this.aBot.needsUpdate = true;
      this.aW.needsUpdate = true;
    }
  }

  clear(): void {
    for (const b of this.beams) b.on = false;
    this.strength = this.strengthTarget = 0;
    this.geo.instanceCount = 0;
  }
}

/** Uniforms shared by every patched runner material. */
export interface RimUniforms {
  uRimColor: { value: THREE.Color };
  uRimDir: { value: THREE.Vector3 };
}

/**
 * Give the runner's materials a fresnel rim (emissive, so it costs nothing when dark), biased toward
 * the side the sun lights. Chains any existing onBeforeCompile.
 */
export function installRim(root: THREE.Object3D): RimUniforms {
  const u: RimUniforms = { uRimColor: { value: new THREE.Color(0, 0, 0) }, uRimDir: { value: new THREE.Vector3(0, 1, 0) } };
  const done = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const sm = m as THREE.MeshStandardMaterial;
      if (done.has(sm) || !sm.isMeshStandardMaterial) continue;
      done.add(sm);
      const prev = sm.onBeforeCompile;
      const prevKey = sm.customProgramCacheKey?.bind(sm);
      sm.onBeforeCompile = (shader, r) => {
        prev?.call(sm, shader, r);
        shader.uniforms.uRimColor = u.uRimColor;
        shader.uniforms.uRimDir = u.uRimDir;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform vec3 uRimDir;')
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            {
              float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
              totalEmissiveRadiance += uRimColor * rimF * (0.3 + 0.7 * max(0.0, dot(normal, uRimDir)));
            }`,
          );
      };
      sm.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|rim`;
      sm.needsUpdate = true;
    }
  });
  return u;
}
