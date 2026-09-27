import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/** Everything the world is built from. Loaded once; geometry and materials are shared. */
export interface Kit {
  geo: Map<string, THREE.BufferGeometry>;
  mat: Map<string, THREE.Material>;
  /** Mesh name → material key ("stoneA", "floor", "leaf", …). */
  matOf: Map<string, string>;
  runner: { scene: THREE.Group; clips: THREE.AnimationClip[] };
  backdrop: THREE.Texture;
  env: THREE.DataTexture;
  sunDir: THREE.Vector3;
}

export type Progress = (loaded: number, total: number) => void;

const BASE = `${import.meta.env.BASE_URL}assets/`;

/** Wind uniforms shared by every foliage material. */
export const wind = { uTime: { value: 0 }, uStrength: { value: 1 } };

export async function loadKit(onProgress: Progress): Promise<Kit> {
  const manager = new THREE.LoadingManager();
  const bytes = new Map<string, [number, number]>();
  const report = () => {
    let a = 0;
    let b = 0;
    for (const [l, t] of bytes.values()) {
      a += l;
      b += t;
    }
    onProgress(a, Math.max(b, 1));
  };
  const track = (url: string) => (e: ProgressEvent) => {
    bytes.set(url, [e.loaded, e.total || e.loaded || 1]);
    report();
  };
  const gltf = new GLTFLoader(manager);
  const load = <T,>(loader: { load: (u: string, ok: (r: T) => void, p: (e: ProgressEvent) => void, err: (e: unknown) => void) => void }, url: string) =>
    new Promise<T>((res, rej) => loader.load(BASE + url, res, track(url), rej));

  const [kitG, runG, backdrop, env, meta] = await Promise.all([
    load<{ scene: THREE.Group }>(gltf, 'kit.glb'),
    load<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(gltf, 'runner.glb'),
    load<THREE.Texture>(new THREE.TextureLoader(manager), 'backdrop.webp'),
    load<THREE.DataTexture>(new HDRLoader(manager), 'env.hdr'),
    fetch(BASE + 'backdrop.json').then((r) => r.json() as Promise<{ sunDirBlender: [number, number, number] }>),
  ]);

  const geo = new Map<string, THREE.BufferGeometry>();
  const mat = new Map<string, THREE.Material>();
  const matOf = new Map<string, string>();
  kitG.scene.updateMatrixWorld(true);
  kitG.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = (m.name || m.parent?.name || '').replace(/_\d+$/, (s) => s); // keep full names
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const src = m.material as THREE.MeshStandardMaterial;
    const key = src.name.replace(/^M_/, '');
    if (!mat.has(key)) mat.set(key, prepareMaterial(key, src));
    if (key === 'leaf') foliageNormals(g);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    geo.set(name, g);
    matOf.set(name, key);
  });

  backdrop.colorSpace = THREE.SRGBColorSpace;
  backdrop.anisotropy = 4;
  env.mapping = THREE.EquirectangularReflectionMapping;

  // Blender (x, y, z) → three (x, z, −y).
  const [bx, by, bz] = meta.sunDirBlender;
  const sunDir = new THREE.Vector3(bx, bz, -by).normalize();

  runG.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      const mm = m.material as THREE.MeshStandardMaterial;
      mm.envMapIntensity = 0.9;
      if (mm.map) mm.map.anisotropy = 4;
    }
  });

  return { geo, mat, matOf, runner: { scene: runG.scene, clips: runG.animations }, backdrop, env, sunDir };
}

function prepareMaterial(key: string, src: THREE.MeshStandardMaterial): THREE.Material {
  const m = src;
  m.name = key;
  for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap]) if (t) t.anisotropy = 8;
  m.metalness = 0;
  m.envMapIntensity = 0.75;
  if (m.normalMap) m.normalScale.set(1.15, 1.15);
  if (key === 'leaf') {
    m.alphaTest = 0.45;
    m.transparent = false;
    m.side = THREE.DoubleSide;
    m.roughness = 0.75;
    m.envMapIntensity = 0.6;
    // Leaves glow a little when the sun is behind them, and move in the wind.
    m.emissive = new THREE.Color(0x1e2a0a);
    m.emissiveMap = m.map;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = wind.uTime;
      shader.uniforms.uWind = wind.uStrength;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float h = clamp(position.y * 0.18, 0.0, 1.6);
          float ph = wp.x * 0.21 + wp.z * 0.17;
          transformed.x += sin(uTime * 1.7 + ph) * 0.07 * h * uWind + sin(uTime * 4.3 + ph * 3.0) * 0.02 * h * uWind;
          transformed.z += cos(uTime * 1.3 + ph * 1.3) * 0.06 * h * uWind;
          transformed.y += sin(uTime * 2.1 + ph * 2.0) * 0.025 * h * uWind;`,
        );
    };
    m.customProgramCacheKey = () => 'leaf-wind';
  }
  if (key === 'rock') m.roughness = 1;
  m.needsUpdate = true;
  return m;
}

/** Card normals point away from the plant's core so a bush shades like a volume, not like cards. */
function foliageNormals(g: THREE.BufferGeometry): void {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const c = new THREE.Vector3();
  bb.getCenter(c);
  c.y = bb.min.y + (bb.max.y - bb.min.y) * 0.35;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const n = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(c);
    v.y = v.y * 0.6 + 0.9;
    v.normalize();
    n[i * 3] = v.x;
    n[i * 3 + 1] = v.y;
    n[i * 3 + 2] = v.z;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
}
