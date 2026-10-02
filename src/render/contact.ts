import * as THREE from 'three';

/**
 * Contact shadow: soft dark blobs on the floor that ground the runner on every tier (Low has no sun
 * shadows at all; on the others the sun's map is too coarse to darken the few centimetres under a
 * sole). One blob per foot, which tightens and darkens as the foot plants and fades as it lifts,
 * and a broad, faint one under the body. Three flat quads in one draw, rebuilt on the CPU each frame
 * (twelve vertices); a radial falloff in the shader, multiplied over the floor.
 */
const BLOBS = 3;

export class ContactShadow {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private alpha: Float32Array;
  private aPos: THREE.BufferAttribute;
  private aAlpha: THREE.BufferAttribute;
  private feet: (THREE.Object3D | undefined)[] = [];
  private v = new THREE.Vector3();
  private toe = new THREE.Vector3();
  /** Overall strength (0 hides it, e.g. while the runner falls out of shot). */
  strength = 1;

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(BLOBS * 4 * 3);
    this.alpha = new Float32Array(BLOBS * 4);
    const uv = new Float32Array(BLOBS * 4 * 2);
    const idx: number[] = [];
    for (let b = 0; b < BLOBS; b++) {
      uv.set([-1, -1, 1, -1, 1, 1, -1, 1], b * 8);
      const o = b * 4;
      idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    }
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aAlpha', this.aAlpha);
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Multiply the floor toward a warm umber rather than painting grey over it.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying vec2 vUv;
        varying float vA;
        void main() {
          vUv = uv;
          vA = aAlpha;
          gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vA;
        void main() {
          float r = length(vUv);
          // A dense core that rolls off to nothing at the rim (no visible edge).
          float k = 1.0 - smoothstep(0.2, 1.0, r);
          k *= k * vA;
          gl_FragColor = vec4(mix(vec3(1.0), vec3(0.14, 0.11, 0.09), k), 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'contactShadow';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Bind to the runner's foot bones (by name). */
  attach(runner: THREE.Object3D): void {
    this.feet = [runner.getObjectByName('footL') ?? undefined, runner.getObjectByName('footR') ?? undefined];
    this.hips = runner.getObjectByName('hips') ?? undefined;
  }
  private hips: THREE.Object3D | undefined;

  /** Lay one quad flat at (x, floorY, z): half-sizes along the facing (`fx`, `fz`) and across it. */
  private quad(b: number, x: number, y: number, z: number, fx: number, fz: number, along: number, across: number, a: number) {
    const rx = -fz;
    const rz = fx;
    const p = this.pos;
    const o = b * 12;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (let i = 0; i < 4; i++) {
      const [u, v] = corners[i]!;
      p[o + i * 3] = x + rx * across * u! + fx * along * v!;
      p[o + i * 3 + 1] = y;
      p[o + i * 3 + 2] = z + rz * across * u! + fz * along * v!;
      this.alpha[b * 4 + i] = a;
    }
  }

  update(root: THREE.Object3D): void {
    const base = root.position;
    // Gone as he drops below the floor (a fall into a chasm is played by the clip, not the root).
    let s = this.strength;
    if (this.hips) {
      this.hips.getWorldPosition(this.v);
      const hh = this.v.y - base.y;
      s *= Math.min(1, Math.max(0, (hh + 0.2) / 0.6));
    }
    // Slab tops sit within ~3 cm under the path line he stands on (measured: median −1.5 cm, highest
    // +0.2 cm); just above the highest, the blob never sinks into a slab and never visibly floats.
    const y = base.y + 0.006;
    const fx = -Math.sin(root.rotation.y);
    const fz = -Math.cos(root.rotation.y);
    this.mesh.visible = s > 0.01 && root.visible;
    if (!this.mesh.visible) return;
    // Body: a broad, faint pool under the hips (the sky's occlusion), a touch behind the feet.
    this.quad(0, base.x - fx * 0.08, y, base.z - fz * 0.08, fx, fz, 0.72, 0.52, 0.75 * s);
    for (let k = 0; k < 2; k++) {
      const f = this.feet[k];
      if (!f) {
        this.quad(1 + k, base.x, y, base.z, fx, fz, 0, 0, 0);
        continue;
      }
      f.getWorldPosition(this.v);
      // The ball of the foot sits ahead of the ankle bone: centre the blob between the two.
      this.toe.set(fx, 0, fz).multiplyScalar(0.06);
      const h = Math.max(0, this.v.y - base.y - 0.07);
      const lift = 1 - Math.min(1, h / 0.4);
      const grow = 1 + h * 1.6;
      this.quad(1 + k, this.v.x + this.toe.x, y + 0.001 * (k + 1), this.v.z + this.toe.z, fx, fz, 0.24 * grow, 0.15 * grow, 0.9 * lift * lift * s);
    }
    this.aPos.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }
}
