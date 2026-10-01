import * as THREE from 'three';
import { Rng } from '../engine/rng';
import { evalSeg, type Segment } from './path';

/**
 * Section library. A section is laid out in its own local space: origin on the
 * path at its start, −Z forward, +X to the runner's right. Everything except the
 * walkable surface is merged per material; the walkable surface is kept as
 * separate tiles so the way can visibly give out under a crash.
 */
export type SectionType =
  | 'start'
  | 'corridor'
  | 'bridge'
  | 'arcade'
  | 'gate'
  | 'tall'
  | 'plaza'
  | 'stairsDown'
  | 'stairsUp'
  | 'cliff'
  | 'ruins'
  | 'avenue'
  | 'gorge'
  | 'boardwalk'
  | 'tunnel'
  | 'statues';

export interface Placement {
  piece: string;
  m: THREE.Matrix4;
}

export interface Waterfall {
  m: THREE.Matrix4; // local; the sheet spans x ∈ [−w/2, w/2], y ∈ [0, −h]
  w: number;
  h: number;
}

export interface Layout {
  type: SectionType;
  len: number;
  turn: number;
  dy: number;
  props: Placement[];
  tiles: Placement[];
  falls: Waterfall[];
  /** Which crash stagings suit this place. */
  hazards: ('chasm' | 'gate' | 'rockfall')[];
  /** Tall structures near the path (for rockfall sources and camera framing). */
  walls: 'none' | 'low' | 'tall' | 'cliff';
}

export const PATH_HALF = 2.2;
const TILE = 4;
/** The water surface in section space (sections at other elevations are corrected at spawn). */
const WL = -2.2;

/** Pieces that sit on the water surface: they follow the water, not the path, when a section is lowered. */
export function isWaterPiece(piece: string): boolean {
  return piece.startsWith('lily_') || piece.startsWith('foam_');
}

/** Yaw that turns a piece modelled facing +Z toward the path from `side`, a little toward the runner. */
function faceIn(side: number, toward = 0.7): number {
  return Math.atan2(-side, toward);
}

class Builder {
  props: Placement[] = [];
  tiles: Placement[] = [];
  falls: Waterfall[] = [];
  constructor(
    readonly rng: Rng,
    readonly density: { foliage: number; scenery: number },
    /** Which variant of the section type this is (styles rotate through variants). */
    readonly variant = 0,
  ) {}

  place(piece: string, x: number, y: number, z: number, rotY = 0, s: number | [number, number, number] = 1, tilt?: [number, number]) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt?.[0] ?? 0, rotY, tilt?.[1] ?? 0, 'YXZ'));
    const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
    m.compose(new THREE.Vector3(x, y, z), q, sc);
    this.props.push({ piece, m });
  }

  tile(piece: string, x: number, y: number, z: number, rotY = 0, s: [number, number, number] = [1, 1, 1]) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(...s),
    );
    this.tiles.push({ piece, m });
  }

  /** A wall piece running from z0 toward −Z for 4 m, on `side` (−1 left, +1 right). */
  wall(piece: string, side: number, x: number, y: number, z0: number) {
    // Pieces run along −Z from their origin; flip half of them for variety (they are near-symmetric).
    const flip = this.rng.chance(0.5);
    const z = flip ? z0 - TILE : z0;
    const ry = flip ? Math.PI : 0;
    this.place(piece, side * x, y, z, ry);
    // Ragged walls carry their own ivy, draped over the crests of their columns.
    if (IVY.has(piece) && this.foliage(0.6)) this.place(`${piece}_ivy`, side * x, y, z, ry);
  }

  /** Rubble strewn along the foot of whatever stands at the path's edge on `side`, 4 m from z0 (dense on High, sparse on Low). */
  edgeRubble(side: number, z0: number, x = PATH_HALF - 0.45, y = 0, p = 1) {
    const d = this.density.scenery;
    if (!this.rng.chance(p * 0.92 * d * Math.sqrt(d))) return;
    // The strip's wall side is its local +X: on the left, turn it end for end.
    const piece = `scatter_edge_${this.rng.int(0, 2)}`;
    if (side > 0) this.place(piece, x, y, z0, 0);
    else this.place(piece, -x, y, z0 - TILE, Math.PI);
  }

  /** Grit and pebbles across a 4 m stretch of the path. */
  pathRubble(z0: number, y = 0, p = 1) {
    const d = this.density.scenery;
    if (!this.rng.chance(p * 0.42 * d * d)) return;
    const flip = this.rng.chance(0.5);
    this.place(`scatter_path_${this.rng.int(0, 1)}`, 0, y + 0.005, flip ? z0 - TILE : z0, flip ? Math.PI : 0);
  }

  foliage(p: number) {
    return this.rng.chance(p * this.density.foliage);
  }

  /** A band of foam where a stone face along the path meets the water, 4 m long from z0 toward −Z. */
  /** Small water dressing (foam, lilies, moss) costs draw calls: the lightest tier goes without. */
  get rich() {
    return this.density.scenery >= 0.5;
  }

  foam(side: number, x: number, z0: number, len = TILE) {
    if (!this.rich) return;
    this.place('foam_strip', side * x, WL, z0, 0, [side, 1, len / TILE]);
  }

  /** A ring of foam around something standing in the water. */
  foamRing(x: number, z: number, r: number) {
    if (!this.rich) return;
    this.place('foam_ring', x, WL, z, this.rng.range(0, 6.28), [r, 1, r]);
  }

  lilies(x: number, z: number, s = 1) {
    if (!this.rich) return;
    if (this.foliage(0.9)) this.place(`lily_${this.rng.int(0, 2)}`, x, WL + 0.01, z, this.rng.range(0, 6.28), s);
  }
}

// ------------------------------------------------------------------ shared dressing
const LOW_WALLS = ['wall_low_0', 'wall_low_1', 'wall_low_2', 'wall_low_3'];
/** Wall pieces modelled with an ivy companion (`<piece>_ivy`, the leaf atlas). */
const IVY = new Set([...LOW_WALLS, 'wall_mid_0', 'wall_mid_1']);
const FLOORS = ['floor_0', 'floor_1', 'floor_0', 'floor_1', 'floor_2'];

/** Cliff faces modelled in Blender: [piece, length along the path, height above the water]. */
const CLIFFS = [
  ['cliff_wall_0', 24, 18],
  ['cliff_wall_1', 24, 23],
  ['cliff_wall_2', 28, 27],
] as const;

/**
 * A cliff face along the path on `side`, its face `x` metres out, centred on z: the rock, the plants
 * clinging to its ledges and the trees on its crest (three pieces, one placement). Returns its height.
 */
function cliffWall(b: Builder, side: number, x: number, z: number, i = b.rng.int(0, CLIFFS.length - 1), sy = 1): number {
  const [piece, , h] = CLIFFS[i]!;
  const ry = (side > 0 ? 0 : Math.PI) + b.rng.range(-0.08, 0.08);
  const s: [number, number, number] = [1, sy, 1];
  b.place(piece, side * x, WL, z, ry, s);
  b.place(`${piece}_veg`, side * x, WL, z, ry, s);
  if (b.rich) b.place(`${piece}_trees`, side * x, WL, z, ry, s);
  return h * sy;
}

/** A waterfall pouring off a cliff face `x` out on `side`, from `top` above the water, bowing toward the path. */
function cliffFall(b: Builder, side: number, x: number, z: number, top: number, w: number) {
  const fm = new THREE.Matrix4().compose(
    new THREE.Vector3(side * x, WL + top, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-side * Math.PI) / 2),
    new THREE.Vector3(1, 1, 1),
  );
  b.falls.push({ m: fm, w, h: top });
  b.foamRing(side * (x - 1.5), z, w * 0.9);
}

function floorRun(b: Builder, z0: number, n: number, y = 0, broken = 0.12, medallion = 0.07) {
  for (let i = 0; i < n; i++) {
    const piece = b.rng.chance(broken) ? 'floor_2' : b.rng.chance(medallion) ? 'floor_medallion_0' : b.rng.pick(FLOORS.slice(0, 4));
    const flip = b.rng.chance(0.5);
    // Flipping a tile end-for-end hides the repeat of the slab pattern.
    if (flip) b.tile(piece, 0, y, z0 - TILE * i - TILE, Math.PI);
    else b.tile(piece, 0, y, z0 - TILE * i, 0);
    b.pathRubble(z0 - TILE * i, y, 0.6 + broken * 2);
  }
}

function lowWalls(b: Builder, z0: number, n: number, sides: number[] = [-1, 1], opts: { gaps?: number; foundation?: boolean } = {}) {
  const gaps = opts.gaps ?? 0.12;
  for (const side of sides) {
    for (let i = 0; i < n; i++) {
      const z = z0 - TILE * i;
      if (opts.foundation !== false) {
        b.wall(b.rng.chance(0.5) ? 'foundation_0' : 'foundation_1', side, PATH_HALF + 0.42, 0, z);
        b.foam(side, PATH_HALF + 0.84, z);
      }
      if (b.foliage(0.3)) b.place(`fern_${b.rng.int(0, 1)}`, side * (PATH_HALF - 0.05), -0.05, z - b.rng.range(0.4, 3.6), b.rng.range(0, 6.28), b.rng.range(0.6, 0.95));
      if (b.rich && b.foliage(0.25)) b.place(`moss_${b.rng.pick([0, 2])}`, side * (PATH_HALF + 0.05), 0, z - b.rng.range(0.5, 3.5), b.rng.range(0, 6.28), b.rng.range(0.7, 1.1));
      b.edgeRubble(side, z);
      if (b.rng.chance(gaps)) {
        b.place(`rubble_${b.rng.int(0, 3)}`, side * (PATH_HALF + 0.6), 0, z - 2, b.rng.range(0, 6.28));
        continue;
      }
      b.wall(b.rng.pick(LOW_WALLS), side, PATH_HALF + 0.36, 0, z);
      if (b.foliage(0.4)) b.place(`bush_${b.rng.int(0, 3)}`, side * (PATH_HALF + 0.5), b.rng.range(0.9, 1.4), z - b.rng.range(0.5, 3.5), b.rng.range(0, 6.28), b.rng.range(0.55, 0.9));
      // Green spilling over the wall's outer side, down toward the water.
      else if (b.foliage(0.3)) b.place(`shrub_mass_${b.rng.int(0, 1)}`, side * (PATH_HALF + 1.1), b.rng.range(0.2, 0.7), z - b.rng.range(1, 3), b.rng.range(0, 6.28), b.rng.range(0.55, 0.8));
      if (b.foliage(0.55)) b.place(`grass_${b.rng.int(0, 1)}`, side * (PATH_HALF - 0.2), 0, z - b.rng.range(0.3, 3.7), b.rng.range(0, 6.28), b.rng.range(0.7, 1.1));
      if (b.foliage(0.22)) b.place(`vines_0`, side * (PATH_HALF + 0.95), b.rng.range(1.0, 1.5), z - 2, side * Math.PI / 2, [0.9, b.rng.range(0.5, 0.8), 1]);
    }
  }
}

/** Islands, trees, rocks and ruins out in the water on both sides. */
function scenery(b: Builder, len: number, opts: { minX?: number; sides?: number[]; big?: boolean; cliffs?: boolean } = {}) {
  const minX = opts.minX ?? 7;
  const sides = opts.sides ?? [-1, 1];
  const d = b.density.scenery;
  for (const side of sides) {
    for (let z = -2; z > -len; z -= b.rng.range(5, 9)) {
      if (!b.rng.chance(0.75 * d + 0.15)) continue;
      const x = side * b.rng.range(minX, minX + 22);
      const zz = z + b.rng.range(-2, 2);
      const kind = b.rng.weighted([
        ['island', 5],
        ['palm', 3],
        ['ruin', 1.4],
        ['rocks', 1.5],
        ['head', 0.45],
        ['column', 0.7],
        ['stones', 0.6],
      ] as const);
      if (kind === 'island' || kind === 'palm') {
        const s = b.rng.range(0.9, 2.3);
        b.place(`rock_mid_${b.rng.int(0, 2)}`, x, -2.2 + s * 0.25, zz, b.rng.range(0, 6.28), [s * 1.3, s * 0.6, s * 1.3]);
        b.foamRing(x, zz, s * 2.1);
        if (b.rich && b.foliage(0.6)) b.place(`moss_${b.rng.int(0, 1)}`, x + b.rng.range(-0.6, 0.6), -2.2 + s * 0.5, zz + b.rng.range(-0.6, 0.6), b.rng.range(0, 6.28), s * 0.8);
        if (kind === 'palm' || b.rng.chance(0.5)) {
          const pi = b.rng.int(0, 2);
          const ps = b.rng.range(0.8, 1.15);
          const ry = b.rng.range(0, 6.28);
          b.place(`palm_${pi}_trunk`, x, -2.2 + s * 0.45, zz, ry, ps);
          b.place(`palm_${pi}_crown`, x, -2.2 + s * 0.45, zz, ry, ps);
        }
        if (b.foliage(0.8)) b.place(`bush_${b.rng.int(0, 3)}`, x + b.rng.range(-1, 1), -2.2 + s * 0.8, zz + b.rng.range(-1, 1), b.rng.range(0, 6.28), b.rng.range(0.8, 1.4));
        if (b.foliage(0.6)) {
          const t = b.rng.int(0, 1);
          const ts = b.rng.range(0.75, 1.05);
          const ry = b.rng.range(0, 6.28);
          b.place(`tree_big_${t}_trunk`, x + side * 3, -2.4, zz - 2, ry, ts);
          b.place(`tree_big_${t}_crown`, x + side * 3, -2.4, zz - 2, ry, ts);
        }
        if (b.foliage(0.5)) b.place(`shrub_mass_${b.rng.int(0, 1)}`, x, -2.2 + s * 0.35, zz, b.rng.range(0, 6.28), s * 0.7);
      } else if (kind === 'ruin') {
        const r = b.rng.weighted([
          ['pillar_0', 2],
          ['pillar_1', 2],
          ['pillar_2', 2],
          ['stele_0', 1],
          ['wall_mid_0', 1.5],
          ['wall_mid_1', 1.5],
        ] as const);
        b.place(r, x, -2.3, zz, b.rng.range(0, 6.28), b.rng.range(0.9, 1.25), [b.rng.range(-0.08, 0.08), b.rng.range(-0.08, 0.08)]);
        b.foamRing(x, zz, 1.4);
        if (b.foliage(0.6)) b.place(`bush_${b.rng.int(0, 3)}`, x, -1.8, zz + 1, b.rng.range(0, 6.28), 1.2);
      } else if (kind === 'head') {
        // A colossal face sunk to the chin, watching the causeway.
        const s = b.rng.range(0.9, 1.3);
        b.place(`head_${b.rng.int(0, 1)}`, x, WL - 0.5 * s, zz, faceIn(side, b.rng.range(0.4, 1.2)), s);
        b.foamRing(x, zz, 2.6 * s);
        b.lilies(x - side * 2.5, zz + 2, 1.2);
        if (b.foliage(0.7)) b.place('vines_0', x, WL + 4.6 * s, zz, faceIn(side, 0.7), [0.5, 0.6, 1]);
      } else if (kind === 'column') {
        b.place(`column_fallen_${b.rng.int(0, 1)}`, x, WL - 0.35, zz, b.rng.range(0, 6.28), b.rng.range(0.9, 1.3));
        b.foamRing(x, zz, 2.2);
        if (b.rich && b.foliage(0.5)) b.place(`moss_${b.rng.int(0, 1)}`, x, WL + 0.6, zz, 0, 0.9);
      } else if (kind === 'stones') {
        b.place('steps_water_0', x, WL, zz, b.rng.range(0, 6.28), b.rng.range(0.8, 1.2));
        b.lilies(x + b.rng.range(-2, 2), zz + b.rng.range(-2, 2), b.rng.range(0.9, 1.4));
      } else {
        for (let k = 0; k < 3; k++) {
          const s = b.rng.range(0.6, 1.5);
          const rx = x + b.rng.range(-3, 3);
          const rz = zz + b.rng.range(-3, 3);
          b.place(`rock_mid_${b.rng.int(0, 2)}`, rx, -2.3, rz, b.rng.range(0, 6.28), s);
          b.foamRing(rx, rz, s * 1.7);
        }
      }
    }
    // Lily pads in the calm water close to the causeway.
    for (let z = -b.rng.range(1, 5); z > -len; z -= b.rng.range(6, 12)) b.lilies(side * b.rng.range(minX - 3.2, minX + 2), z, b.rng.range(0.8, 1.4));
    // The middle ground closes in: a jungle-clad cliff face across the water, or a temple.
    // (Phones go without: the gorge and cliff sections still bring their own.)
    if (opts.cliffs !== false && b.rich && b.rng.chance(0.42 * d + 0.18)) {
      const x = b.rng.range(minX + 12, minX + 24);
      const r = b.rng.next();
      if (r < 0.72) cliffWall(b, side, x, -len / 2 + b.rng.range(-3, 3), undefined, b.rng.range(0.9, 1.25));
      else {
        b.place(r < 0.86 ? 'temple_0' : 'temple_1', side * x, WL + 0.2, -b.rng.range(0, len), b.rng.range(0, 6.28), b.rng.range(0.9, 1.2));
        b.foamRing(side * x, -len / 2, 5.5);
      }
    }
    if (opts.big !== false && b.rng.chance(0.4 * d + 0.1)) {
      const x = side * b.rng.range(28, 55);
      const t = b.rng.pick(['tower_0', 'tower_1', 'temple_0', 'temple_1', 'rock_big_0', 'arch_1']);
      const s = t.startsWith('rock') ? b.rng.range(1.2, 2.2) : t.startsWith('temple') ? b.rng.range(0.9, 1.3) : b.rng.range(1.1, 1.6);
      b.place(t, x, -2.6, -b.rng.range(0, len), b.rng.range(0, 6.28), s);
      if (t.startsWith('tower') || t === 'arch_1') {
        const pi = b.rng.int(0, 1);
        b.place(`tree_big_${pi}_trunk`, x + 6, -2.4, -len / 2, 0, 1.1);
        b.place(`tree_big_${pi}_crown`, x + 6, -2.4, -len / 2, 0, 1.1);
      }
    }
  }
}

// ------------------------------------------------------------------ section builders
type Build = (b: Builder, len: number) => Pick<Layout, 'hazards' | 'walls'> & { turn?: number; dy?: number };

const BUILDERS: Record<SectionType, { lengths: number[]; build: Build }> = {
  start: {
    lengths: [12],
    build: (b) => {
      b.tile('floor_wide_0', 0, -0.02, 4, 0, [1, 1, 1]);
      floorRun(b, -4, 2, 0, 0);
      b.place('arch_0', 0, 0, 3.2);
      for (const side of [-1, 1]) {
        b.place('stele_0', side * 4.2, 0, -0.5, side * 0.3);
        b.place('pillar_0', side * 4.4, 0, -3.6);
        b.place(`bush_${b.rng.int(1, 3)}`, side * 4.6, 0.2, 1.2, 0, 1.1);
        b.place(`grass_1`, side * 3.6, 0, -2.2, 0, 1.1);
        b.place(`palm_${side > 0 ? 0 : 2}_trunk`, side * 6.5, -2.2, -1, 0, 1);
        b.place(`palm_${side > 0 ? 0 : 2}_crown`, side * 6.5, -2.2, -1, 0, 1);
      }
      lowWalls(b, -4, 2, [-1, 1], { gaps: 0 });
      scenery(b, 12);
      return { hazards: ['gate'], walls: 'low' };
    },
  },
  corridor: {
    lengths: [16, 20, 24],
    build: (b, len) => {
      const n = len / TILE;
      floorRun(b, 0, n);
      lowWalls(b, 0, n);
      for (let z = -b.rng.range(3, 6); z > -len; z -= b.rng.range(6, 11)) {
        const side = b.rng.chance(0.5) ? -1 : 1;
        b.place(b.rng.pick(['pillar_1', 'pillar_2', 'stele_1']), side * (PATH_HALF + 1.3), 0, z, b.rng.range(0, 6.28));
      }
      scenery(b, len);
      return { hazards: ['chasm', 'rockfall'], walls: 'low' };
    },
  },
  bridge: {
    lengths: [12, 16, 20],
    build: (b, len) => {
      const n = len / TILE;
      const style = (['rope', 'gorge', 'plain', 'rope'] as const)[b.variant % 4]!;
      for (let i = 0; i < n; i++) {
        const p = b.rng.chance(0.5) ? 'planks_0' : 'planks_1';
        if (b.rng.chance(0.5)) b.tile(p, 0, 0, -TILE * i, 0);
        else b.tile(p, 0, 0, -TILE * i - TILE, Math.PI);
        if (style !== 'plain') b.place('rope_rail_0', 0, 0, -TILE * i, 0);
      }
      if (style === 'gorge') {
        // Cliffs close in on both sides, a fall pouring from each; the planks cross the gap between.
        for (const side of [-1, 1]) {
          const cx = b.rng.range(8, 9.5);
          const h = cliffWall(b, side, cx, -len / 2, b.rng.int(0, 2), b.rng.range(0.95, 1.2));
          const fz = -len * b.rng.range(0.45, 0.7);
          cliffFall(b, side, cx - 0.8, fz, h * 0.7, 3.2);
          for (let k = 0; k < 3; k++) if (b.foliage(0.8)) b.place(`bush_${b.rng.int(0, 3)}`, side * b.rng.range(7.5, 9.5), b.rng.range(2, 9), -b.rng.range(0, len), 0, b.rng.range(1, 1.6));
          if (b.foliage(0.9)) b.place(`roots_1`, side * 8, b.rng.range(7, 10), -len * b.rng.range(0.1, 0.35), -side * Math.PI / 2, [1.5, 1.8, 1]);
          b.place(`palm_${b.rng.int(0, 2)}_trunk`, side * 9.5, 4, -len * 0.85, 0, 0.9);
          b.place(`palm_${b.rng.int(0, 2)}_crown`, side * 9.5, 4, -len * 0.85, 0, 0.9);
        }
      }
      for (const side of [-1, 1]) {
        b.place(b.rng.pick(['pillar_1', 'pillar_2']), side * 2.4, -2.3, 0.2, b.rng.range(0, 6));
        b.place(b.rng.pick(['pillar_1', 'pillar_2']), side * 2.4, -2.3, -len - 0.2, b.rng.range(0, 6));
        for (let z = -3; z > -len; z -= b.rng.range(4, 8)) {
          if (b.rng.chance(0.5)) b.place(`rock_mid_${b.rng.int(0, 2)}`, side * b.rng.range(3.5, 6), -2.4, z, b.rng.range(0, 6), b.rng.range(0.5, 0.9));
        }
      }
      if (style !== 'gorge') scenery(b, len, { minX: 6 });
      for (const side of [-1, 1]) b.foamRing(side * 2.4, 0.2, 0.9), b.foamRing(side * 2.4, -len - 0.2, 0.9);
      return { hazards: ['chasm'], walls: style === 'gorge' ? 'tall' : 'none' };
    },
  },
  arcade: {
    lengths: [16, 24],
    build: (b, len) => {
      const n = len / TILE;
      floorRun(b, 0, n, 0, 0.08);
      for (let z = -2; z > -len; z -= 8) {
        b.place(b.rng.chance(0.7) ? 'arch_0' : 'arch_1', 0, 0, z, b.rng.chance(0.5) ? 0 : Math.PI);
        if (b.foliage(0.8)) b.place(b.rng.chance(0.5) ? 'vines_1' : 'vines_2', b.rng.range(-1.5, 1.5), 8.2, z + 0.5, 0, [1, 1.1, 1]);
        if (b.foliage(0.5)) b.place(`roots_${b.rng.int(0, 1)}`, b.rng.pick([-1, 1]) * b.rng.range(3.6, 4.4), 7.6, z + 0.7, 0, [0.6, b.rng.range(0.8, 1.2), 1]);
        if (b.foliage(0.6)) b.place(`bush_${b.rng.int(0, 3)}`, b.rng.range(-3, 3), 8.6, z, 0, 1);
      }
      for (const side of [-1, 1]) {
        for (let i = 0; i < n; i++) {
          b.wall(b.rng.chance(0.5) ? 'foundation_0' : 'foundation_1', side, PATH_HALF + 0.42, 0, -TILE * i);
          b.foam(side, PATH_HALF + 0.84, -TILE * i);
          if (b.foliage(0.5)) b.place(`grass_${b.rng.int(0, 1)}`, side * (PATH_HALF - 0.1), 0, -TILE * i - 2, 0, 0.9);
          if (b.foliage(0.35)) b.place(`fern_${b.rng.int(0, 1)}`, side * (PATH_HALF - 0.05), -0.05, -TILE * i - b.rng.range(0.5, 3.5), b.rng.range(0, 6.28), 0.8);
        }
      }
      scenery(b, len, { minX: 9 });
      return { hazards: ['gate', 'rockfall', 'chasm'], walls: 'tall' };
    },
  },
  gate: {
    lengths: [8],
    build: (b) => {
      floorRun(b, 0, 2, 0, 0);
      b.place('arch_1', 0, 0, -4);
      b.place('vines_1', 0, 9.2, -3.4, 0, [1.2, 1.2, 1]);
      for (const side of [-1, 1]) {
        b.wall('wall_tall_' + b.rng.int(0, 1), side, 5.6, 0, 0);
        b.wall('wall_tall_' + b.rng.int(0, 1), side, 5.6, 0, -4);
        if (b.variant % 2 === 0) b.place(side < 0 ? 'guardian_0' : b.rng.pick(['guardian_0', 'guardian_1']), side * 3.55, 0, -0.9, faceIn(side, 1.4), 0.78);
        else b.place('stele_1', side * 3.3, 0, -0.6, side * -0.2);
        b.place(`bush_${b.rng.int(0, 3)}`, side * 4.8, 5.0, -2, 0, 1.2);
        if (b.foliage(0.7)) b.place(`roots_${b.rng.int(0, 1)}`, side * (PATH_HALF + 1.2), 5.1, -2, -side * Math.PI / 2, [0.9, 1, 1]);
      }
      scenery(b, 8, { minX: 10 });
      return { hazards: ['gate'], walls: 'tall' };
    },
  },
  tall: {
    lengths: [16, 20],
    build: (b, len) => {
      const n = len / TILE;
      floorRun(b, 0, n);
      for (const side of [-1, 1]) {
        for (let i = 0; i < n; i++) {
          const z = -TILE * i;
          const r = b.rng.next();
          if (r < 0.15) b.wall(b.rng.pick(['wall_mid_0', 'wall_mid_1']), side, PATH_HALF + 0.5, 0, z);
          else if (r < 0.4) {
            b.wall(`relief_wall_${b.rng.int(0, 1)}`, side, PATH_HALF + 0.52, 0, z);
            b.wall(`wall_low_${b.rng.int(0, 3)}`, side, PATH_HALF + 0.7, 3.2, z);
          } else b.wall(`wall_tall_${b.rng.int(0, 1)}`, side, PATH_HALF + 0.6, 0, z);
          b.edgeRubble(side, z, PATH_HALF - 0.4);
          if (b.foliage(0.3)) b.place(`roots_${b.rng.int(0, 1)}`, side * (PATH_HALF + 0.1), b.rng.range(4.4, 5.0), z - 2, -side * Math.PI / 2, [b.rng.range(0.7, 1), b.rng.range(0.8, 1.2), 1]);
          if (b.foliage(0.3)) b.place(`fern_${b.rng.int(0, 1)}`, side * (PATH_HALF - 0.05), -0.05, z - b.rng.range(0.5, 3.5), b.rng.range(0, 6.28), 0.85);
          if (b.foliage(0.55)) b.place('vines_0', side * (PATH_HALF + 0.15), b.rng.range(3.8, 4.8), z - 2, -side * Math.PI / 2, [1, b.rng.range(0.8, 1.3), 1]);
          if (b.foliage(0.5)) b.place(`bush_${b.rng.int(0, 3)}`, side * (PATH_HALF + 0.7), b.rng.range(4.2, 5.0), z - b.rng.range(0, 4), 0, b.rng.range(0.7, 1.1));
          if (b.foliage(0.35)) b.place(`shrub_mass_${b.rng.int(0, 1)}`, side * (PATH_HALF + 1.4), b.rng.range(4.4, 5.0), z - 2, b.rng.range(0, 6.28), b.rng.range(0.7, 1.0));
          if (b.foliage(0.4)) b.place(`grass_${b.rng.int(0, 1)}`, side * (PATH_HALF - 0.15), 0, z - 1.5, 0, 0.9);
        }
      }
      scenery(b, len, { minX: 12, big: true });
      return { hazards: ['gate', 'rockfall'], walls: 'tall' };
    },
  },
  plaza: {
    lengths: [8],
    build: (b, len) => {
      const turn = (b.rng.chance(0.5) ? 1 : -1) * b.rng.range(0.28, 0.5);
      const mid = evalSeg({ s0: 0, len, p0: new THREE.Vector3(), yaw0: 0, turn, dy: 0 }, len / 2, { pos: new THREE.Vector3(), yaw: 0 });
      // Longer than the arc and a hair lower: it tucks under the neighbours' tiles at both ends.
      b.tile('floor_wide_0', mid.pos.x - Math.sin(mid.yaw) * -4.3, -0.02, mid.pos.z - Math.cos(mid.yaw) * -4.3, mid.yaw, [1.05, 1, 1.08]);
      const o = new THREE.Vector3();
      for (const side of [-1, 1]) {
        for (const t of [0.15, 0.85]) {
          const f = evalSeg({ s0: 0, len, p0: new THREE.Vector3(), yaw0: 0, turn, dy: 0 }, len * t, { pos: new THREE.Vector3(), yaw: 0 });
          o.set(Math.cos(f.yaw) * side * 5.2, 0, -Math.sin(f.yaw) * side * 5.2).add(f.pos);
          const piece = b.rng.pick(['pillar_0', 'pillar_1', 'stele_0', 'pillar_2']);
          b.place(piece, o.x, 0, o.z, b.rng.range(0, 6.28));
          if (b.foliage(0.7)) b.place(`bush_${b.rng.int(0, 3)}`, o.x + b.rng.range(-0.8, 0.8), 0, o.z + b.rng.range(-0.8, 0.8), 0, b.rng.range(0.8, 1.2));
        }
        const f = evalSeg({ s0: 0, len, p0: new THREE.Vector3(), yaw0: 0, turn, dy: 0 }, len * 0.5, { pos: new THREE.Vector3(), yaw: 0 });
        o.set(Math.cos(f.yaw) * side * 4.2, 0, -Math.sin(f.yaw) * side * 4.2).add(f.pos);
        if (b.rng.chance(0.6)) b.place('drum_0', o.x, 0, o.z, b.rng.range(0, 6.28));
        else b.place(`rubble_${b.rng.int(1, 3)}`, o.x, 0, o.z, b.rng.range(0, 6.28));
        if (b.rich && b.foliage(0.8)) b.place(`moss_${b.rng.int(0, 2)}`, o.x + b.rng.range(-1, 1), 0, o.z + b.rng.range(-1, 1), 0, 1);
        if (b.foliage(0.8)) b.place(`fern_${b.rng.int(0, 1)}`, o.x + b.rng.range(-1, 1), 0, o.z + b.rng.range(-1, 1), b.rng.range(0, 6.28), 1);
      }
      {
        const side = b.rng.chance(0.5) ? -1 : 1;
        const f = evalSeg({ s0: 0, len, p0: new THREE.Vector3(), yaw0: 0, turn, dy: 0 }, len * 0.5, { pos: new THREE.Vector3(), yaw: 0 });
        o.set(Math.cos(f.yaw) * side * 8.5, 0, -Math.sin(f.yaw) * side * 8.5).add(f.pos);
        if (b.variant % 2 === 0) b.place(`head_${b.rng.int(0, 1)}`, o.x, WL - 0.4, o.z, f.yaw + faceIn(side, 0.5), 1.1);
        else b.place(`column_fallen_${b.rng.int(0, 1)}`, o.x, WL + 0.1, o.z, b.rng.range(0, 6.28), 1.2);
        b.foamRing(o.x, o.z, 2.8);
      }
      scenery(b, len, { minX: 9 });
      return { hazards: ['rockfall', 'gate'], walls: 'none', turn };
    },
  },
  stairsDown: {
    lengths: [12],
    build: (b) => {
      b.tile('stairs_0', 0, 0, 0, 0);
      floorRun(b, -4, 2, -1.6);
      lowWalls(b, -4, 2, [-1, 1], { gaps: 0.1 });
      for (const side of [-1, 1]) {
        b.wall('foundation_1', side, PATH_HALF + 0.42, 0, 0);
        b.place('pillar_0', side * 3.1, 0, 0.3);
      }
      scenery(b, 12);
      return { hazards: ['chasm', 'rockfall'], walls: 'low', dy: -1.6 };
    },
  },
  stairsUp: {
    lengths: [12],
    build: (b) => {
      b.tile('stairs_0', 0, 1.6, -4, Math.PI);
      floorRun(b, -4, 2, 1.6);
      lowWalls(b, -4, 2, [-1, 1], { gaps: 0.1 });
      for (const side of [-1, 1]) {
        b.wall('foundation_0', side, PATH_HALF + 0.42, 0, 0);
        b.place('pillar_1', side * 3.1, 1.6, -4.3);
      }
      scenery(b, 12);
      return { hazards: ['chasm', 'rockfall'], walls: 'low', dy: 1.6 };
    },
  },
  cliff: {
    lengths: [20, 24],
    build: (b, len) => {
      const n = len / TILE;
      floorRun(b, 0, n);
      const side = b.rng.chance(0.5) ? -1 : 1;
      lowWalls(b, 0, n, [-side], { gaps: 0.1 });
      for (let i = 0; i < n; i++) b.wall('foundation_1', side, PATH_HALF + 0.42, 0, -TILE * i);
      // The cliff: a towering stratified face close over the path, a waterfall pouring down it.
      const h = cliffWall(b, side, 8.2, -len / 2, 2, b.rng.range(1.0, 1.15));
      b.place(`rock_mid_${b.rng.int(0, 2)}`, side * 5.5, -2.2, -len * 0.55, 0, 1.6);
      cliffFall(b, side, 7.4, -len * 0.55, h * 0.72, 4.2);
      b.lilies(side * 6.5, -len * 0.3, 1.3);
      b.lilies(side * 7, -len * 0.8, 1.1);
      for (let k = 0; k < 2; k++) if (b.foliage(0.8)) b.place(`roots_${b.rng.int(0, 1)}`, side * 7.6, b.rng.range(5, 9), -len * b.rng.range(0.2, 0.9), -side * Math.PI / 2, [1.4, 1.6, 1]);
      for (let z = -2; z > -len; z -= 5) if (b.foliage(0.7)) b.place(`shrub_mass_${b.rng.int(0, 1)}`, side * b.rng.range(5.5, 7), -2.1, z, b.rng.range(0, 6.28), b.rng.range(0.8, 1.2));
      scenery(b, len, { sides: [-side] });
      return { hazards: ['rockfall', 'chasm'], walls: 'cliff' };
    },
  },
  ruins: {
    lengths: [16, 20],
    build: (b, len) => {
      const n = len / TILE;
      floorRun(b, 0, n, 0, 0.3);
      lowWalls(b, 0, n, [-1, 1], { gaps: 0.35 });
      for (const side of [-1, 1]) {
        b.place(b.rng.pick(['tower_0', 'tower_1']), side * b.rng.range(11, 16), -2.4, -b.rng.range(2, len - 2), b.rng.range(0, 6));
        for (let k = 0; k < 3; k++) b.place(`rubble_${b.rng.int(0, 3)}`, side * b.rng.range(3, 6), -0.6, -b.rng.range(0, len), b.rng.range(0, 6));
        b.place('drum_0', side * b.rng.range(3.2, 5), -0.3, -b.rng.range(2, len - 2), b.rng.range(0, 6));
        const cz = -b.rng.range(3, len - 3);
        if (b.rng.chance(0.6)) {
          const cx = side * b.rng.range(5.5, 7.5);
          b.place(`column_fallen_${b.rng.int(0, 1)}`, cx, WL + 0.2, cz, b.rng.range(0, 6.28));
          b.foamRing(cx, cz, 2.4);
        } else b.place('guardian_1', side * 5.6, WL + 0.3, cz, faceIn(side, 0.9), 0.9);
        for (let k = 0; k < 2; k++) if (b.rich && b.foliage(0.6)) b.place(`moss_${b.rng.int(0, 2)}`, side * b.rng.range(3, 5.5), -0.4, -b.rng.range(0, len), 0, b.rng.range(0.8, 1.3));
      }
      scenery(b, len, { minX: 9, big: false });
      return { hazards: ['rockfall', 'chasm'], walls: 'low' };
    },
  },
  avenue: {
    lengths: [20, 24],
    build: (b, len) => {
      const n = len / TILE;
      floorRun(b, 0, n, 0, 0.1);
      lowWalls(b, 0, n, [-1, 1], { gaps: 0.45 });
      let k = 0;
      for (let z = -3; z > -len + 2; z -= 7.5, k++) {
        for (const side of [-1, 1]) {
          const x = side * 5.2;
          const broken = b.rng.chance(0.3);
          b.place(broken ? 'guardian_1' : 'guardian_0', x, WL + 0.45, z, faceIn(side, 0.25), b.rng.range(1.15, 1.3));
          b.foamRing(x, z, 2.4);
          b.lilies(x + side * 1.8, z - 3, b.rng.range(0.8, 1.2));
          if (b.rich && b.foliage(0.5)) b.place(`moss_${b.rng.int(0, 2)}`, x, WL + 1.05, z + 0.6, 0, 0.8);
        }
      }
      const hs = b.rng.chance(0.5) ? -1 : 1;
      if (b.variant % 3 === 1) {
        // The avenue leads the eye to a golden face on its lotus plinth.
        b.place('idol_0', hs * 11, WL, -len + 1, faceIn(hs, 1.6), 1.1);
        b.foamRing(hs * 11, -len + 1, 5.8);
      } else {
        b.place(`head_${b.rng.int(0, 1)}`, hs * 12, WL - 0.6, -len * 0.6, faceIn(hs, 0.6), 1.3);
        b.foamRing(hs * 12, -len * 0.6, 3.4);
      }
      scenery(b, len, { minX: 13, big: true });
      return { hazards: ['chasm', 'gate'], walls: 'low' };
    },
  },
  gorge: {
    // The jungle gorge / temple valley: stratified cliffs close in on both sides, green clinging to
    // every ledge, waterfalls, and at its end either a gopura the path runs through, a golden face
    // gazing down the causeway, or temple towers and an idol standing in the water.
    lengths: [28, 32],
    build: (b, len) => {
      const n = len / TILE;
      const gate = b.variant % 2 === 0;
      floorRun(b, 0, n, 0, 0.06, 0.28);
      lowWalls(b, 0, gate ? n - 2 : n, [-1, 1], { gaps: 0.3 });
      const templeSide = b.rng.chance(0.5) ? -1 : 1;
      for (const side of [-1, 1]) {
        const wide = !gate && side === templeSide;
        // Overlapping cliff faces from just before the section to just past its end.
        let z = 3;
        let k = 0;
        while (z > -len - 3) {
          const i = b.rng.int(0, 2);
          const L = CLIFFS[i]![1];
          const x = (wide ? 15 : 8.6) + b.rng.range(0, 2.2);
          const h = cliffWall(b, side, x, Math.max(z - L / 2, -len - 3 + L / 2), i, b.rng.range(0.95, 1.25));
          if (k === 0 || b.rng.chance(0.5)) cliffFall(b, side, x - 0.8, Math.max(z - L * b.rng.range(0.3, 0.7), -len + 2), h * 0.7, b.rng.range(2.6, 4.2));
          z -= L * b.rng.range(0.82, 0.95);
          k++;
        }
        for (let zz = -2; zz > -len; zz -= b.rng.range(4, 7)) {
          if (b.foliage(0.7)) b.place(`shrub_mass_${b.rng.int(0, 1)}`, side * b.rng.range(5, 7), -2.1, zz, b.rng.range(0, 6.28), b.rng.range(0.8, 1.3));
          b.lilies(side * b.rng.range(4.5, 6.5), zz - 2, b.rng.range(0.8, 1.2));
        }
        if (b.foliage(0.8)) {
          const t = b.rng.int(0, 1);
          const tz = -len * b.rng.range(0.2, 0.6);
          const ry = b.rng.range(0, 6.28);
          const ts = b.rng.range(0.8, 1.0);
          b.place(`tree_big_${t}_trunk`, side * 6.6, -2.3, tz, ry, ts);
          b.place(`tree_big_${t}_crown`, side * 6.6, -2.3, tz, ry, ts);
        }
      }
      if (gate) {
        // The path runs through the gate's passage over the last tiles; the face looks straight down it.
        b.place('face_gate_0', 0, 0, -len + 8, 0);
        b.place('face_gate_0_gold', 0, 0, -len + 8, 0);
        for (const side of [-1, 1]) b.foam(side, 7.5, -len + 8, 7);
        if (b.foliage(0.9)) b.place('vines_2', 0, 15.5, -len + 8.6, 0, [1.8, 1.4, 1]);
      } else {
        // A temple tower stands in the widened side of the valley, a golden idol at its far end.
        b.place(b.rng.chance(0.5) ? 'temple_0' : 'temple_1', templeSide * 10, WL + 0.2, -len * 0.45, b.rng.range(0, 6.28), b.rng.range(0.85, 1.0));
        b.foamRing(templeSide * 10, -len * 0.45, 5.5);
        b.place('idol_0', -templeSide * 7.8, WL, -len + 2, faceIn(-templeSide, 2.2), 0.95);
        b.foamRing(-templeSide * 7.8, -len + 2, 5.2);
      }
      return { hazards: ['rockfall', 'chasm'], walls: 'tall' };
    },
  },
  boardwalk: {
    // A weathered plank boardwalk skirting a mossy bank: boulders along the waterline, jungle heaped on
    // the bank (on some variants a ragged quay wall), open water on the other side.
    lengths: [16, 20, 24],
    build: (b, len) => {
      const n = len / TILE;
      const bank = b.rng.chance(0.5) ? -1 : 1;
      const quay = b.variant % 3 === 0;
      for (let i = 0; i < n; i++) {
        const p = b.rng.chance(0.5) ? 'planks_0' : 'planks_1';
        if (b.rng.chance(0.5)) b.tile(p, 0, 0, -TILE * i, 0);
        else b.tile(p, 0, 0, -TILE * i - TILE, Math.PI);
      }
      // Boulders along the waterline on both sides, bigger and thicker on the bank side.
      for (const side of [-1, 1]) {
        const big = side === bank;
        for (let z = -b.rng.range(0.5, 2); z > -len; z -= b.rng.range(big ? 1.6 : 2.6, big ? 3.2 : 5)) {
          const s = b.rng.range(0.32, 0.6) * (big ? 1.25 : 1);
          const x = side * b.rng.range(2.7, 3.3) * (big ? 1.05 : 1);
          b.place(`rock_mid_${b.rng.int(0, 2)}`, x, WL + s * 0.45, z, b.rng.range(0, 6.28), [s, s * b.rng.range(0.7, 1.0), s]);
          b.foamRing(x, z, s * 1.9);
          if (b.rich && b.foliage(big ? 0.45 : 0.2)) b.place(`moss_${b.rng.int(0, 2)}`, x, WL + s * 1.15, z, 0, s * 1.2);
        }
      }
      // The bank: heaped rock, a green mass on top, palms and big trees behind.
      for (let z = 0; z > -len - 2; z -= b.rng.range(3.5, 5.5)) {
        const x = bank * b.rng.range(5.0, 6.4);
        const s = b.rng.range(1.0, 1.6);
        b.place(`rock_mid_${b.rng.int(0, 2)}`, x, WL + 0.3, z, b.rng.range(0, 6.28), [s * 1.2, s * 0.75, s * 1.4]);
        if (b.foliage(0.95)) b.place(`shrub_mass_${b.rng.int(0, 1)}`, x + bank * 0.4, WL + s * 1.35, z - b.rng.range(0, 1.5), b.rng.range(0, 6.28), b.rng.range(0.8, 1.15));
        if (b.foliage(0.6)) b.place(`bush_${b.rng.int(0, 3)}`, x - bank * b.rng.range(0.8, 1.6), WL + s * 1.1, z - b.rng.range(0.5, 2.5), b.rng.range(0, 6.28), b.rng.range(0.8, 1.2));
        if (b.foliage(0.45)) b.place(`fern_${b.rng.int(0, 1)}`, x - bank * 1.8, WL + s * 0.9, z - 1, b.rng.range(0, 6.28), 1.1);
        b.foam(bank, 3.8, z, 5);
      }
      if (quay) {
        // A ragged quay wall runs along the bank, the boardwalk skirting its foot.
        for (let i = 0; i < n; i++) {
          b.wall('foundation_0', bank, PATH_HALF + 1.55, 0, -TILE * i);
          b.wall(b.rng.pick(LOW_WALLS), bank, PATH_HALF + 1.55, 0, -TILE * i);
        }
      }
      for (let k = 0; k < 2; k++) {
        if (!b.foliage(0.85)) continue;
        const pi = b.rng.int(0, 2);
        const z = -len * b.rng.range(0.15, 0.85);
        b.place(`palm_${pi}_trunk`, bank * b.rng.range(6.5, 8), WL + 1.2, z, b.rng.range(0, 6.28), b.rng.range(0.85, 1.1));
        b.place(`palm_${pi}_crown`, bank * b.rng.range(6.5, 8), WL + 1.2, z, b.rng.range(0, 6.28), b.rng.range(0.85, 1.1));
      }
      if (b.foliage(0.9)) {
        const t = b.rng.int(0, 1);
        b.place(`tree_big_${t}_trunk`, bank * 9, WL, -len * 0.5, b.rng.range(0, 6.28), 1);
        b.place(`tree_big_${t}_crown`, bank * 9, WL, -len * 0.5, b.rng.range(0, 6.28), 1);
      }
      for (let z = -3; z > -len; z -= b.rng.range(5, 8)) b.lilies(-bank * b.rng.range(4.5, 7), z, b.rng.range(0.9, 1.3));
      if (b.rich) cliffWall(b, bank, b.rng.range(13, 16), -len / 2, undefined, b.rng.range(0.9, 1.15));
      scenery(b, len, { sides: [-bank], minX: 8 });
      return { hazards: ['chasm', 'rockfall'], walls: 'none' };
    },
  },
  tunnel: {
    // A dark vaulted passage through a ruin: a ragged portal hung with vines, 8–16 m of barrel vault, and
    // the bright way out at the far end. No room for the slab gate: the vault comes down instead.
    lengths: [20, 24, 28],
    build: (b, len) => {
      const n = len / TILE;
      floorRun(b, 0, n, 0, 0.1, 0.04);
      const mouthZ = -TILE;
      const k = Math.floor((len - TILE - 3.2) / TILE); // vault segments between the two portals
      const exitZ = mouthZ - 1.6 - TILE * k - 1.6;
      // Approach and way out: short walls up to the portals.
      lowWalls(b, 0, 1, [-1, 1], { gaps: 0 });
      b.place('tunnel_mouth_0', 0, 0, mouthZ, 0);
      b.place('tunnel_mouth_0', 0, 0, exitZ, Math.PI);
      for (let i = 0; i < k; i++) {
        const z = mouthZ - 1.6 - TILE * i;
        const v = `vault_${b.rng.int(0, 1)}`;
        if (b.rng.chance(0.5)) b.place(v, 0, 0, z, 0);
        else b.place(v, 0, 0, z - TILE, Math.PI);
        // Grit fallen from the vault along the kerbs.
        for (const side of [-1, 1]) b.edgeRubble(side, z, PATH_HALF - 0.4, 0, 0.8);
        // Roots and vines through the crown, the odd shaft of green.
        if (b.foliage(0.45)) b.place(`roots_${b.rng.int(0, 1)}`, b.rng.range(-1.2, 1.2), 5.9, z - b.rng.range(0.5, 3.5), 0, [0.5, b.rng.range(0.5, 0.8), 1]);
      }
      // Hanging vines across the mouth, jungle heaped over the portal and along the vault's back.
      for (const [z, face] of [[mouthZ, 1], [exitZ, -1]] as const) {
        if (b.foliage(0.95)) b.place('vines_2', b.rng.range(-0.8, 0.8), 6.3, z - face * 0.35, 0, [1.05, b.rng.range(0.5, 0.65), 1]);
        if (b.foliage(0.8)) b.place('vines_1', b.rng.range(-3, 3), 8.2, z + face * 0.1, 0, [1, 1.1, 1]);
        for (const side of [-1, 1]) {
          if (b.foliage(0.9)) b.place(`shrub_mass_${b.rng.int(0, 1)}`, side * b.rng.range(2.5, 5), b.rng.range(6.8, 8.2), z - face * 0.8, b.rng.range(0, 6.28), b.rng.range(0.8, 1.1));
          if (b.foliage(0.6)) b.place(`roots_${b.rng.int(0, 1)}`, side * b.rng.range(3.5, 5.5), b.rng.range(7.5, 8.5), z + face * 0.05, 0, [0.8, b.rng.range(0.9, 1.3), 1]);
        }
      }
      for (let z = mouthZ - 3; z > exitZ; z -= b.rng.range(3, 5)) {
        if (b.foliage(0.8)) b.place(`shrub_mass_${b.rng.int(0, 1)}`, b.rng.range(-2.5, 2.5), 6.9, z, b.rng.range(0, 6.28), b.rng.range(0.7, 1.0));
        // Bushes on the vault's shoulders (its back is a 3.65 m radius over the springing at 3.2 m).
        if (b.foliage(0.55)) {
          const x = b.rng.range(2.6, 3.2);
          b.place(`bush_${b.rng.int(0, 3)}`, b.rng.pick([-1, 1]) * x, 3.05 + Math.sqrt(3.65 * 3.65 - x * x), z, 0, b.rng.range(0.9, 1.3));
        }
      }
      if (b.foliage(0.8)) {
        const t = b.rng.int(0, 1);
        const side = b.rng.pick([-1, 1]);
        b.place(`tree_big_${t}_trunk`, side * 7.5, WL, (mouthZ + exitZ) / 2, b.rng.range(0, 6.28), 0.95);
        b.place(`tree_big_${t}_crown`, side * 7.5, WL, (mouthZ + exitZ) / 2, b.rng.range(0, 6.28), 0.95);
      }
      for (const side of [-1, 1]) {
        for (let i = 1; i < n; i++) {
          b.wall(b.rng.chance(0.5) ? 'foundation_0' : 'foundation_1', side, 3.3, 0, -TILE * i);
          b.foam(side, 3.75, -TILE * i);
        }
      }
      scenery(b, len, { minX: 10, big: false });
      return { hazards: ['rockfall', 'chasm'], walls: 'tall' };
    },
  },
  statues: {
    // A causeway lined with carved guardians on plinths at the path's edge, ragged walls between
    // them, carved medallions underfoot, and at its end a lintel gate before tall ruined facades
    // (a lone column standing off to one side).
    lengths: [24, 28],
    build: (b, len) => {
      const n = len / TILE;
      floorRun(b, 0, n, 0, 0.08, 0.22);
      for (const side of [-1, 1]) {
        for (let i = 0; i < n; i++) {
          const z = -TILE * i;
          const statue = i % 2 === (side > 0 ? 1 : 0) && i < n - 1;
          if (!statue) {
            lowWalls(b, z, 1, [side], { gaps: 0.2 });
            continue;
          }
          b.wall('foundation_1', side, PATH_HALF + 0.42, 0, z);
          b.foam(side, PATH_HALF + 0.84, z);
          b.edgeRubble(side, z);
          const broken = b.rng.chance(0.3);
          b.place(broken ? 'guardian_1' : 'guardian_0', side * (PATH_HALF + 0.95), 0, z - 2, faceIn(side, 0.9), b.rng.range(0.62, 0.7));
          if (b.foliage(0.5)) b.place(`fern_${b.rng.int(0, 1)}`, side * (PATH_HALF + 0.2), 0, z - b.rng.range(0.5, 1.2), b.rng.range(0, 6.28), 0.8);
          if (b.rich && b.foliage(0.5)) b.place(`moss_${b.rng.int(0, 2)}`, side * (PATH_HALF + 0.9), 0.95 * 0.66, z - 2, 0, 0.8);
          if (b.foliage(0.45)) b.place('vines_0', side * (PATH_HALF + 1.6), b.rng.range(3.0, 3.6), z - 2, faceIn(side, 0.4), [0.45, 0.6, 1]);
        }
      }
      // The vanishing point: a lintel gate over the way, facades rising behind it, a lone column.
      const gz = -len + 3.5;
      b.place('lintel_gate_0', 0, 0, gz, b.rng.chance(0.5) ? 0 : Math.PI);
      // Its posts stand out past the causeway's edge: boulders heaped under them.
      for (const side of [-1, 1]) b.place(`rock_mid_${b.rng.int(0, 2)}`, side * 3.7, WL + 0.9, gz, b.rng.range(0, 6.28), [0.55, 0.75, 0.5]);
      if (b.foliage(0.9)) b.place('vines_1', b.rng.range(-1.5, 1.5), 8.3, gz + 0.6, 0, [0.9, 0.9, 1]);
      if (b.foliage(0.8)) b.place(`bush_${b.rng.int(0, 3)}`, b.rng.range(-3, 3), 8.4, gz, 0, 1.0);
      const fs = b.rng.chance(0.5) ? -1 : 1;
      b.place(`facade_${b.variant % 2}`, fs * b.rng.range(9.5, 11), WL + 0.2, -len - 2, faceIn(fs, 2.2), b.rng.range(1.0, 1.15));
      b.place(`facade_${(b.variant + 1) % 2}`, -fs * b.rng.range(10.5, 12.5), WL + 0.2, -len - 6, faceIn(-fs, 2.4), b.rng.range(0.9, 1.05));
      b.foamRing(fs * 10, -len - 2, 6);
      b.place('column_lone_0', -fs * b.rng.range(6.5, 8), WL - 0.3, -len * b.rng.range(0.45, 0.65), b.rng.range(0, 6.28), b.rng.range(0.95, 1.1));
      b.foamRing(-fs * 7, -len * 0.55, 2);
      for (const side of [-1, 1]) {
        if (b.foliage(0.8)) {
          const t = b.rng.int(0, 1);
          b.place(`tree_big_${t}_trunk`, side * 14, WL, -len - 4, b.rng.range(0, 6.28), 1.05);
          b.place(`tree_big_${t}_crown`, side * 14, WL, -len - 4, b.rng.range(0, 6.28), 1.05);
        }
        if (b.foliage(0.8)) b.place(`shrub_mass_${b.rng.int(0, 1)}`, side * 8.5, WL + 0.4, -len + 1, b.rng.range(0, 6.28), 1.2);
      }
      scenery(b, len, { minX: 11, big: false, cliffs: b.variant % 2 === 1 });
      return { hazards: ['gate', 'rockfall', 'chasm'], walls: 'low' };
    },
  },
};

export function buildLayout(type: SectionType, seed: string, density: { foliage: number; scenery: number }, len?: number): Layout {
  const rng = new Rng(seed);
  const def = BUILDERS[type];
  const L = len ?? rng.pick(def.lengths);
  const b = new Builder(rng, density, Number(seed.split('#')[1] ?? 0) || 0);
  const r = def.build(b, L);
  return { type, len: L, turn: r.turn ?? 0, dy: r.dy ?? 0, props: b.props, tiles: b.tiles, falls: b.falls, hazards: r.hazards, walls: r.walls };
}

export const SECTION_TYPES = Object.keys(BUILDERS) as SectionType[];

/** Pacing: what can follow what, and how often. Elevation stays within one flight of stairs. */
export function nextType(rng: Rng, prev: SectionType, elevation: number, intensity: number): SectionType {
  const w: [SectionType, number][] = [
    ['corridor', 4],
    ['bridge', 2.2],
    ['arcade', 1.6],
    ['gate', 1.2],
    ['tall', 1.8 + intensity],
    ['plaza', 1.6],
    ['cliff', 1.4],
    ['ruins', 1.3],
    ['avenue', 1.2],
    ['gorge', 1.7],
    ['boardwalk', 1.5],
    ['tunnel', 1.0 + 0.4 * intensity],
    ['statues', 1.2],
    [elevation > -0.5 ? 'stairsDown' : 'stairsUp', 1.1],
  ];
  const options = w.filter(([t]) => t !== prev || t === 'corridor');
  return rng.weighted(options);
}

export type { Segment };
