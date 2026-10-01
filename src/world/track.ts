import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../engine/rng';
import type { Kit } from './assets';
import { Path, frameMatrix, type Frame, type Segment } from './path';
import { buildLayout, isWaterPiece, nextType, type Layout, type SectionType } from './sections';
import { foamTime, makeFoamMaterial, makeFoamRing, makeFoamStrip } from './water';
import { fallFeet, makeFallsGeometry, makeWaterfallMaterial } from './waterfall';
import { patchWetStone, updateCaustics } from './caustics';
import { upgradeLeafMaterial } from './foliage';
import { atmosphereUniforms } from './atmosphere';

const VARIANTS: Record<SectionType, number> = {
  start: 1,
  corridor: 6,
  bridge: 4,
  arcade: 3,
  gate: 2,
  tall: 3,
  plaza: 4,
  stairsDown: 2,
  stairsUp: 2,
  cliff: 3,
  ruins: 3,
  avenue: 3,
  gorge: 4,
  boardwalk: 3,
  tunnel: 3,
  statues: 3,
};

interface Variant {
  layout: Layout;
  group: THREE.Group; // merged props, shared by every instance
  inUse: number;
}

export interface TileSlot {
  piece: string;
  index: number;
  world: THREE.Matrix4;
  /** Arc length along the route at the tile's near and far edges. */
  sNear: number;
  sFar: number;
  alive: boolean;
}

export interface SectionInstance {
  type: SectionType;
  layout: Layout;
  s0: number;
  len: number;
  seg: Segment;
  root: THREE.Object3D;
  mirror: boolean;
  tiles: TileSlot[];
  falls: THREE.Mesh[];
  /** World-space feet of this section's waterfalls (xyz) and the reach of their spray (w). */
  feet: THREE.Vector4[];
  variant: Variant;
}

const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);

/** Length along the path of each walkable piece (metres). */
const TILE_LENGTH: Record<string, number> = { floor_wide_0: 8 };

const TILE_CAPACITY: Record<string, number> = {
  floor_0: 110,
  floor_1: 110,
  floor_2: 40,
  floor_wide_0: 12,
  floor_narrow_0: 8,
  floor_medallion_0: 36,
  planks_0: 40,
  planks_1: 40,
  stairs_0: 8,
};

/**
 * Walkable tiles, drawn as one InstancedMesh per piece so any tile can be removed on its own.
 * Instances stay densely packed (swap-remove), so the GPU draws exactly the live tiles.
 */
class TileSystem {
  readonly meshes = new Map<string, THREE.InstancedMesh>();
  private owners = new Map<string, TileSlot[]>();
  private static ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(kit: Kit, parent: THREE.Object3D) {
    for (const [piece, cap] of Object.entries(TILE_CAPACITY)) {
      const geo = kit.geo.get(piece);
      if (!geo) continue;
      const m = new THREE.InstancedMesh(geo, kit.mat.get(kit.matOf.get(piece)!)!, cap);
      m.name = `tiles:${piece}`;
      m.receiveShadow = true;
      // Paving lies flat on the causeway: its shadow falls only on itself. Planks neither: in the low
      // sun their warped boards shadowed each other edge to edge, and the boardwalk read grey-green
      // (sky light only) instead of sun-bleached wood. Stairs stand over water and keep theirs.
      m.castShadow = !piece.startsWith('floor_') && !piece.startsWith('planks_');
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent.add(m);
      this.meshes.set(piece, m);
      this.owners.set(piece, []);
    }
  }

  alloc(slot: TileSlot): void {
    const mesh = this.meshes.get(slot.piece);
    const owners = this.owners.get(slot.piece);
    if (!mesh || !owners || mesh.count >= mesh.instanceMatrix.count) {
      slot.index = -1;
      return;
    }
    slot.index = mesh.count++;
    owners[slot.index] = slot;
    mesh.setMatrixAt(slot.index, slot.world);
    mesh.instanceMatrix.needsUpdate = true;
  }

  hide(slot: TileSlot): void {
    const mesh = this.meshes.get(slot.piece);
    if (!mesh || slot.index < 0) return;
    mesh.setMatrixAt(slot.index, TileSystem.ZERO);
    mesh.instanceMatrix.needsUpdate = true;
  }

  release(slot: TileSlot): void {
    const mesh = this.meshes.get(slot.piece);
    const owners = this.owners.get(slot.piece);
    if (!mesh || !owners || slot.index < 0) return;
    const last = mesh.count - 1;
    const moved = owners[last]!;
    if (moved !== slot) {
      // Move the last live instance into the hole, keeping its visibility.
      const tmp = new THREE.Matrix4();
      mesh.getMatrixAt(last, tmp);
      mesh.setMatrixAt(slot.index, tmp);
      moved.index = slot.index;
      owners[slot.index] = moved;
    }
    owners.length = last;
    mesh.count = last;
    slot.index = -1;
    mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Track {
  readonly root = new THREE.Group();
  readonly path = new Path();
  readonly sections: SectionInstance[] = [];
  private variants = new Map<SectionType, Variant[]>();
  private tiles: TileSystem;
  private rng = new Rng(1);
  private elevation = 0;
  private lastType: SectionType = 'start';
  private fallMat = makeWaterfallMaterial();
  private density = { foliage: 1, scenery: 1 };
  viewDistance = 190;
  /** QA: section types to spawn next, in order, before the pacing rules resume. */
  forceNext: SectionType[] = [];

  constructor(private kit: Kit) {
    this.root.name = 'track';
    this.tiles = new TileSystem(kit, this.root);
    // Foam is generated here rather than in Blender: it is a shader, not a texture.
    kit.geo.set('foam_strip', makeFoamStrip());
    kit.geo.set('foam_ring', makeFoamRing());
    kit.matOf.set('foam_strip', 'foam');
    kit.matOf.set('foam_ring', 'foam');
    if (!kit.mat.has('foam')) kit.mat.set('foam', makeFoamMaterial());
    stageKit(kit);
  }

  /** Build every section variant. Yields between variants so a loading screen can animate. */
  async prepare(density: { foliage: number; scenery: number }, onStep?: (i: number, n: number) => void): Promise<void> {
    this.density = density;
    // Build into a fresh map and swap at the end: the route keeps spawning from the old
    // variants meanwhile, and their geometry is retired only when the world next resets.
    const next = new Map<SectionType, Variant[]>();
    const total = Object.values(VARIANTS).reduce((a, b) => a + b, 0);
    let done = 0;
    for (const [type, n] of Object.entries(VARIANTS) as [SectionType, number][]) {
      const list: Variant[] = [];
      for (let i = 0; i < n; i++) {
        const layout = buildLayout(type, `${type}#${i}`, density);
        list.push({ layout, group: this.mergeProps(layout), inUse: 0 });
        onStep?.(++done, total);
        await new Promise((r) => setTimeout(r, 0));
      }
      next.set(type, list);
    }
    for (const vs of this.variants.values()) for (const v of vs) this.retired.push(v.group);
    this.variants = next;
  }

  private retired: THREE.Group[] = [];

  private mergeProps(layout: Layout): THREE.Group {
    // Near the path (walls, pillars, arches) casts shadows; scenery out over the water does not,
    // and is merged separately so both halves cull on their own tighter bounds. Things that float
    // on the water (lilies, foam) are a third zone: like the far scenery they are placed relative
    // to the water, so a section lowered by stairs moves them back up to the surface.
    const byKey = new Map<string, THREE.BufferGeometry[]>();
    const p = new THREE.Vector3();
    for (const pl of layout.props) {
      const g = this.kit.geo.get(pl.piece);
      if (!g) {
        if (import.meta.env.DEV) console.warn('missing piece', pl.piece);
        continue;
      }
      p.setFromMatrixPosition(pl.m);
      // Scattered pebbles are a zone of their own: near the path, but too small to be worth a shadow.
      // Jungle banks, shrub masses and banana clumps stand by the path but throw no shadow (in a low sun
      // ahead their masses would blanket the causeway in sky-lit grey): they join the far scenery's
      // draw call. Like it they follow the water when stairs lower a section, which they rise out of. The limbs over the way do cast, through holes (see leafDepth).
      const zone = isWaterPiece(pl.piece)
        ? 'water'
        : pl.piece.startsWith('scatter_')
          ? 'grit'
          : pl.piece.startsWith('jungle_bank') || (/^(shrub_mass|banana)/.test(pl.piece) && p.y < -1.5)
            ? 'far'
            : Math.abs(p.x) > 7.5
              ? 'far'
              : 'near';
      const key = `${this.kit.matOf.get(pl.piece)!}|${zone}`;
      const c = g.clone().applyMatrix4(pl.m);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(c);
    }
    const group = new THREE.Group();
    for (const [key, geos] of byKey) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const [mat, zone] = key.split('|') as [string, string];
      const mesh = new THREE.Mesh(merged, this.kit.mat.get(mat)!);
      mesh.name = key;
      mesh.castShadow = zone === 'near' && mat !== 'flora';
      if (mesh.castShadow && mat === 'leaf') mesh.customDepthMaterial = leafDepth(this.kit);
      if (zone === 'water') mesh.renderOrder = 1;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }

  reset(seed: string): void {
    for (const s of this.sections) this.despawn(s);
    this.sections.length = 0;
    for (const g of this.retired) disposeGroup(g);
    this.retired.length = 0;
    this.rng = new Rng(`world/${seed}`);
    this.elevation = 0;
    this.path.reset({ pos: new THREE.Vector3(0, 0, 0), yaw: 0 });
    this.spawn('start');
    this.lastType = 'start';
    this.update(0, 0);
  }

  /** Keep the route built ahead of `s` and cleared behind it. */
  update(s: number, intensity: number): void {
    while (this.path.length < s + this.viewDistance) {
      const t = this.forceNext.shift() ?? nextType(this.rng, this.lastType, this.elevation, intensity);
      this.spawn(t);
      this.lastType = t;
    }
    while (this.sections.length > 1 && this.sections[0]!.s0 + this.sections[0]!.len < s - 45) {
      this.despawn(this.sections.shift()!);
    }
    this.path.trim(s - 60);
  }

  private spawn(type: SectionType): void {
    const list = this.variants.get(type)!;
    // Prefer the least-used variant, with a random tiebreak, so repeats are spread out.
    const min = Math.min(...list.map((v) => v.inUse));
    const candidates = list.filter((v) => v.inUse === min);
    const variant = this.rng.pick(candidates);
    variant.inUse++;
    const layout = variant.layout;
    const mirror = type !== 'start' && this.rng.chance(0.5);
    const turn = mirror ? -layout.turn : layout.turn;
    const seg = this.path.push(layout.len, turn, layout.dy);
    this.elevation += layout.dy;

    const frame: Frame = { pos: seg.p0.clone(), yaw: seg.yaw0 };
    const root = new THREE.Object3D();
    const base = frameMatrix(frame);
    const local = new THREE.Matrix4().makeScale(mirror ? -1 : 1, 1, 1);
    const world = base.clone().multiply(local);
    root.matrixAutoUpdate = false;
    root.matrix.copy(world);
    root.matrixWorldNeedsUpdate = true;
    // Scenery and floating things keep to the water, whatever the path's elevation.
    const toWater = -seg.p0.y;
    for (const child of variant.group.children) {
      const m = child as THREE.Mesh;
      const inst = new THREE.Mesh(m.geometry, m.material);
      inst.castShadow = m.castShadow;
      inst.receiveShadow = m.receiveShadow;
      inst.renderOrder = m.renderOrder;
      inst.customDepthMaterial = m.customDepthMaterial;
      inst.name = m.name;
      if (!m.name.endsWith('|near') && !m.name.endsWith('|grit')) inst.position.y = toWater;
      root.add(inst);
    }
    // Every fall in the section is one mesh: sheets and spray in a single draw call.
    const falls: THREE.Mesh[] = [];
    const fg = makeFallsGeometry(layout.falls, toWater, seg.s0 * 0.013);
    if (fg) {
      const mesh = new THREE.Mesh(fg, this.fallMat);
      mesh.name = 'falls';
      mesh.renderOrder = 2;
      root.add(mesh);
      falls.push(mesh);
    }
    const feet: THREE.Vector4[] = [];
    fallFeet(layout.falls, world, toWater, feet);
    this.root.add(root);

    const inst: SectionInstance = { type, layout, s0: seg.s0, len: layout.len, seg, root, mirror, tiles: [], falls, feet, variant };
    const tmp = new THREE.Matrix4();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const t of layout.tiles) {
      tmp.copy(world).multiply(t.m);
      // A mirrored section must not mirror its tiles: an instance matrix with a negative determinant
      // flips the winding (three only corrects that per object, not per instance), so the slabs drew
      // inside out — their dark undersides seen through culled tops, half the causeway near black.
      // Mirror each tile back about its own axis instead (they are symmetric enough).
      if (mirror) tmp.multiply(MIRROR_X);
      // A tile runs `len` metres along its own −Z from its origin. Push both ends through the
      // placement and read the extent along the section's −Z: robust to however the rotation is
      // factored (a half turn about Y can decompose as Euler (π, 0, π)).
      const len = TILE_LENGTH[t.piece] ?? 4;
      a.set(0, 0, 0).applyMatrix4(t.m);
      b.set(0, 0, -len).applyMatrix4(t.m);
      const near = Math.min(-a.z, -b.z);
      const far = Math.max(-a.z, -b.z);
      const slot: TileSlot = { piece: t.piece, index: -1, world: tmp.clone(), sNear: seg.s0 + near, sFar: seg.s0 + far, alive: true };
      this.tiles.alloc(slot);
      inst.tiles.push(slot);
    }
    this.sections.push(inst);
  }

  private despawn(s: SectionInstance): void {
    this.root.remove(s.root);
    for (const f of s.falls) f.geometry.dispose();
    for (const t of s.tiles) this.tiles.release(t);
    s.variant.inUse--;
  }

  sectionAt(s: number): SectionInstance | undefined {
    for (const sec of this.sections) if (s >= sec.s0 && s < sec.s0 + sec.len) return sec;
    return this.sections[this.sections.length - 1];
  }

  /**
   * Remove the walkable tiles overlapping [sFrom, sTo]; returns their world matrices for debris.
   * By default a tile only has to touch the range; `whole` keeps tiles that extend outside it
   * (so the slab under the runner can be spared precisely), `includeFixed` also takes wide
   * plaza slabs and stairs.
   */
  collapse(sFrom: number, sTo: number, opts: { whole?: boolean; includeFixed?: boolean } = {}): { piece: string; world: THREE.Matrix4 }[] {
    const out: { piece: string; world: THREE.Matrix4 }[] = [];
    for (const t of this.tilesIn(sFrom, sTo, opts.whole)) {
      if (!opts.includeFixed && (t.piece === 'floor_wide_0' || t.piece.startsWith('stairs'))) continue;
      this.hideTile(t);
      out.push({ piece: t.piece, world: t.world });
    }
    return out;
  }

  /** Live walkable tiles overlapping [sFrom, sTo] (or lying wholly inside it with `whole`). */
  tilesIn(sFrom: number, sTo: number, whole = false): TileSlot[] {
    const out: TileSlot[] = [];
    for (const sec of this.sections) {
      for (const t of sec.tiles) {
        if (!t.alive) continue;
        if (whole ? t.sNear >= sFrom && t.sFar <= sTo : t.sFar > sFrom && t.sNear < sTo) out.push(t);
      }
    }
    return out;
  }

  /** The live tile under arc length `s`, if any. */
  tileAt(s: number): TileSlot | undefined {
    for (const sec of this.sections) for (const t of sec.tiles) if (t.alive && s >= t.sNear && s < t.sFar) return t;
    return undefined;
  }

  /** Hide one walkable tile (it stays allocated until its section despawns). */
  hideTile(t: TileSlot): void {
    if (!t.alive) return;
    t.alive = false;
    this.tiles.hide(t);
  }

  tick(time: number, s = 0): void {
    this.fallMat.uniforms.uTime!.value = time;
    const sd = atmosphereUniforms.fogSunDir.value;
    (this.fallMat.uniforms.uSun!.value as THREE.Vector3).set(sd.x, sd.y, sd.z);
    foamTime.value = time;
    // The spray around the nearest falls ahead of the runner (then the ones just behind) wets the stone.
    this.feet.length = 0;
    for (const sec of this.sections) if (sec.s0 + sec.len >= s - 4) for (const f of sec.feet) this.feet.push(f);
    for (const sec of this.sections) if (sec.s0 + sec.len < s - 4) for (const f of sec.feet) this.feet.push(f);
    updateCaustics(time, this.feet);
  }
  private feet: THREE.Vector4[] = [];

  /** Every prepared section variant's merged props (for shader and upload warm-up). */
  variantGroups(): THREE.Object3D[] {
    return [...this.variants.values()].flat().map((v) => v.group);
  }

  get tileMeshes(): THREE.InstancedMesh[] {
    return [...this.tiles['meshes'].values()];
  }
}

/**
 * Runtime finishing for the round-3 stage pieces (once per kit): the golden faces are metal, and
 * the plants clinging to a cliff shade as a mass leaning out toward the path and the sky, not as one
 * dome the size of the cliff (the loader's radial foliage normals).
 */
function stageKit(kit: Kit): void {
  // Round 5: the jungle clumps come in on a material of their own so the loader keeps their authored
  // normals; they draw with (and merge into) the one leaf material.
  // The optimizer quantizes UVs per material (KHR_texture_transform on each material's map), so
  // the clumps' UVs are brought into the leaf material's frame before they share its draw call.
  const lj = (kit.mat.get('leaf_jungle') as THREE.MeshStandardMaterial | undefined)?.map;
  const lf = (kit.mat.get('leaf') as THREE.MeshStandardMaterial | undefined)?.map;
  let uvFix: THREE.Matrix3 | null = null;
  if (lj && lf) {
    lj.updateMatrix();
    lf.updateMatrix();
    uvFix = new THREE.Matrix3().copy(lf.matrix).invert().multiply(lj.matrix);
  }
  for (const [name, key] of kit.matOf) {
    if (key !== 'leaf_jungle') continue;
    kit.matOf.set(name, 'leaf');
    const g = kit.geo.get(name);
    const uv = g?.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (uv && uvFix && !g!.userData.uvFixed) {
      g!.userData.uvFixed = true;
      uv.applyMatrix3(uvFix);
      uv.needsUpdate = true;
    }
  }
  const leaf = kit.mat.get('leaf');
  if (leaf) upgradeLeafMaterial(leaf);
  for (const key of ['stoneA', 'stoneB', 'floor', 'rock', 'cliff', 'statue', 'glyph', 'wood']) {
    const m = kit.mat.get(key);
    if (m) patchWetStone(m, key !== 'floor');
  }
  const gold = kit.mat.get('gold') as THREE.MeshStandardMaterial | undefined;
  if (gold && !gold.userData.staged) {
    gold.userData.staged = true;
    gold.metalness = 1;
    gold.metalnessMap = null;
    gold.envMapIntensity = 1.35;
    // A little self-light in the leaf: the face must read as gold even in shade, at the end of a valley.
    gold.emissive = new THREE.Color(0xffc56a);
    gold.emissiveMap = gold.map;
    gold.emissiveIntensity = 0.32;
    gold.needsUpdate = true;
  }
  const lean = new THREE.Vector3(-0.55, 0.85, 0.05).normalize();
  const n = new THREE.Vector3();
  for (const [name, g] of kit.geo) {
    if (!name.endsWith('_veg') || g.userData.staged) continue;
    g.userData.staged = true;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (!nrm) continue;
    for (let i = 0; i < nrm.count; i++) {
      n.fromBufferAttribute(nrm, i).multiplyScalar(0.35).add(lean).normalize();
      nrm.setXYZ(i, n.x, n.y, n.z);
    }
    nrm.needsUpdate = true;
  }
}

let leafDepthMat: THREE.MeshDepthMaterial | null = null;
/**
 * The leaves' shadow: their alpha-tested cards, opened up by world-space holes so a canopy throws
 * dappled light (pools of sun between the shade) rather than one solid shadow.
 */
function leafDepth(kit: Kit): THREE.MeshDepthMaterial {
  if (leafDepthMat) return leafDepthMat;
  const leaf = kit.mat.get('leaf') as THREE.MeshStandardMaterial | undefined;
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leaf?.map ?? null, alphaTest: 0.5, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDapW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDapW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDapW;
        float dapH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float dapN(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dapH(i), dapH(i + vec3(1,0,0)), f.x), mix(dapH(i + vec3(0,1,0)), dapH(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(dapH(i + vec3(0,0,1)), dapH(i + vec3(1,0,1)), f.x), mix(dapH(i + vec3(0,1,1)), dapH(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        if (dapN(vDapW * 1.3) * 0.65 + dapN(vDapW * 3.1) * 0.35 < 0.47) discard;`);
  };
  m.customProgramCacheKey = () => 'leaf-dapple';
  leafDepthMat = m;
  return m;
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}
