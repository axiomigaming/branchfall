import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../engine/rng';
import type { Kit } from './assets';
import { Path, frameMatrix, type Frame, type Segment } from './path';
import { buildLayout, isWaterPiece, nextType, type Layout, type SectionType } from './sections';
import { foamTime, makeFoamMaterial, makeFoamRing, makeFoamStrip } from './water';
import { makeWaterfallMaterial } from './waterfall';

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
};

interface Variant {
  layout: Layout;
  group: THREE.Group; // merged props, shared by every instance
  inUse: number;
}

interface TileSlot {
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
  variant: Variant;
}

const TILE_CAPACITY: Record<string, number> = {
  floor_0: 110,
  floor_1: 110,
  floor_2: 40,
  floor_wide_0: 12,
  floor_narrow_0: 8,
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
      m.castShadow = true;
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
      const zone = isWaterPiece(pl.piece) ? 'water' : Math.abs(p.x) > 7.5 ? 'far' : 'near';
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
      inst.name = m.name;
      if (!m.name.endsWith('|near')) inst.position.y = toWater;
      root.add(inst);
    }
    const falls: THREE.Mesh[] = [];
    for (const f of layout.falls) {
      const geo = new THREE.PlaneGeometry(f.w, f.h, 1, 12).translate(0, -f.h / 2, 0);
      const mesh = new THREE.Mesh(geo, this.fallMat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.makeTranslation(0, toWater, 0).multiply(f.m);
      mesh.renderOrder = 2;
      root.add(mesh);
      falls.push(mesh);
    }
    this.root.add(root);

    const inst: SectionInstance = { type, layout, s0: seg.s0, len: layout.len, seg, root, mirror, tiles: [], falls, variant };
    const tmp = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const t of layout.tiles) {
      tmp.copy(world).multiply(t.m);
      // Tiles run 4 m along −Z from their origin (or +Z when rotated half a turn).
      p.setFromMatrixPosition(t.m);
      const flipped = Math.abs(Math.abs(new THREE.Euler().setFromRotationMatrix(t.m).y) - Math.PI) < 0.1;
      const near = flipped ? -p.z - 4 : -p.z;
      const slot: TileSlot = { piece: t.piece, index: -1, world: tmp.clone(), sNear: seg.s0 + near, sFar: seg.s0 + near + (t.piece === 'floor_wide_0' ? 8 : 4), alive: true };
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

  /** Remove the walkable tiles overlapping [sFrom, sTo]; returns their world matrices for debris. */
  collapse(sFrom: number, sTo: number): { piece: string; world: THREE.Matrix4 }[] {
    const out: { piece: string; world: THREE.Matrix4 }[] = [];
    for (const sec of this.sections) {
      for (const t of sec.tiles) {
        if (!t.alive || t.sFar < sFrom || t.sNear > sTo) continue;
        if (t.piece === 'floor_wide_0' || t.piece.startsWith('stairs')) continue;
        t.alive = false;
        this.tiles.hide(t);
        out.push({ piece: t.piece, world: t.world });
      }
    }
    return out;
  }

  tick(time: number): void {
    this.fallMat.uniforms.uTime!.value = time;
    foamTime.value = time;
  }

  get tileMeshes(): THREE.InstancedMesh[] {
    return [...this.tiles['meshes'].values()];
  }
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}
