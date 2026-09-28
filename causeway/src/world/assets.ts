import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import manifest from '../../public/assets/manifest.json';
import type { QualityLevel } from '../config/quality';

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

/**
 * Which compressed asset set to download (see tools/optimize-assets.mjs): "mobile" (1K textures) for
 * phones, the Low tier, Save-Data and small-memory devices; "high" (2K) otherwise. `?assets=` overrides.
 */
export type AssetSet = keyof typeof manifest.sets;
export function pickAssetSet(quality: QualityLevel): AssetSet {
  const forced = new URLSearchParams(location.search).get('assets');
  if (forced && forced in manifest.sets) return forced as AssetSet;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches;
  if (quality === 'low' || phone || nav.connection?.saveData || (nav.deviceMemory ?? 8) <= 4) return 'mobile';
  return 'high';
}

/** Hashed URL: the content hash rides in the query, so every file can be cached as immutable. */
const url = (e: { file: string; v: string }) => `${BASE}${e.file}?v=${e.v}`;

/** Bytes the first load downloads for a set (for honest progress before any response arrives). */
export function assetBytes(set: AssetSet): number {
  const s = manifest.sets[set];
  return s.kit.bytes + s.runner.bytes + manifest.shared.backdrop.bytes + manifest.shared.env.bytes + manifest.shared.backdropMeta.bytes;
}

export async function loadKit(onProgress: Progress, set: AssetSet = 'high'): Promise<Kit> {
  const files = manifest.sets[set];
  // Totals come from the manifest, so the bar never rescales when a response (maybe compressed, maybe
  // without Content-Length) arrives, and per-file counts only ever grow: progress is monotonic.
  const expected = new Map<string, number>();
  const got = new Map<string, number>();
  const total = assetBytes(set);
  let shown = 0;
  const report = () => {
    let a = 0;
    for (const [u, n] of got) a += Math.min(n, expected.get(u) ?? n);
    shown = Math.max(shown, Math.min(a, total));
    onProgress(shown, total);
  };
  const track = (u: string) => (e: ProgressEvent) => {
    // A gzip'd response reports decoded bytes; scale to the manifest size when a total is known.
    const n = e.lengthComputable && e.total > 0 ? (e.loaded / e.total) * (expected.get(u) ?? e.total) : e.loaded;
    got.set(u, Math.max(got.get(u) ?? 0, n));
    report();
  };
  const done = (u: string) => {
    got.set(u, expected.get(u) ?? 0);
    report();
  };
  const manager = new THREE.LoadingManager();
  const gltf = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  const load = <T,>(loader: { load: (u: string, ok: (r: T) => void, p: (e: ProgressEvent) => void, err: (e: unknown) => void) => void }, e: { file: string; v: string; bytes: number }) => {
    const u = url(e);
    expected.set(u, e.bytes);
    return new Promise<T>((res, rej) =>
      loader.load(
        u,
        (r) => {
          done(u);
          res(r);
        },
        track(u),
        rej,
      ),
    );
  };
  const metaUrl = url(manifest.shared.backdropMeta);
  expected.set(metaUrl, manifest.shared.backdropMeta.bytes);

  const [kitG, runG, backdrop, env, meta] = await Promise.all([
    load<{ scene: THREE.Group }>(gltf, files.kit),
    load<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(gltf, files.runner),
    load<THREE.Texture>(new THREE.TextureLoader(manager), manifest.shared.backdrop),
    load<THREE.DataTexture>(new HDRLoader(manager), manifest.shared.env),
    fetch(metaUrl)
      .then((r) => r.json() as Promise<{ sunDirBlender: [number, number, number] }>)
      .then((j) => (done(metaUrl), j)),
  ]);

  const geo = new Map<string, THREE.BufferGeometry>();
  const mat = new Map<string, THREE.Material>();
  const matOf = new Map<string, string>();
  kitG.scene.updateMatrixWorld(true);
  kitG.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = (m.name || m.parent?.name || '').replace(/_\d+$/, (s) => s); // keep full names
    // Quantized (KHR_mesh_quantization) attributes are decoded to float first: baking the node
    // transform into normalized integers would clamp them.
    const g = dequantize(m.geometry);
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

/** A float copy of a geometry whose attributes may be normalized integers and/or interleaved. */
function dequantize(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  if (src.index) g.setIndex(src.index.clone());
  for (const [name, a] of Object.entries(src.attributes)) {
    const attr = a as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    if (attr.array instanceof Float32Array && !(attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      g.setAttribute(name, (attr as THREE.BufferAttribute).clone());
      continue;
    }
    const n = attr.itemSize;
    const out = new Float32Array(attr.count * n);
    for (let i = 0; i < attr.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = attr.getComponent(i, c);
    g.setAttribute(name, new THREE.BufferAttribute(out, n));
  }
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.name = src.name;
  return g;
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
