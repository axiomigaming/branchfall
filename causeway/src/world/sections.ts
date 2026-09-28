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
  | 'avenue';

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
    if (this.rng.chance(0.5)) this.place(piece, side * x, y, z0, 0);
    else this.place(piece, side * x, y, z0 - TILE, Math.PI);
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
const FLOORS = ['floor_0', 'floor_1', 'floor_0', 'floor_1', 'floor_2'];

function floorRun(b: Builder, z0: number, n: number, y = 0, broken = 0.12) {
  for (let i = 0; i < n; i++) {
    const piece = b.rng.chance(broken) ? 'floor_2' : b.rng.pick(FLOORS.slice(0, 4));
    const flip = b.rng.chance(0.5);
    // Flipping a tile end-for-end hides the repeat of the slab pattern.
    if (flip) b.tile(piece, 0, y, z0 - TILE * i - TILE, Math.PI);
    else b.tile(piece, 0, y, z0 - TILE * i, 0);
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
      if (b.rng.chance(gaps)) {
        b.place(`rubble_${b.rng.int(0, 3)}`, side * (PATH_HALF + 0.6), 0, z - 2, b.rng.range(0, 6.28));
        continue;
      }
      b.wall(b.rng.pick(LOW_WALLS), side, PATH_HALF + 0.36, 0, z);
      if (b.foliage(0.4)) b.place(`bush_${b.rng.int(0, 3)}`, side * (PATH_HALF + 0.5), b.rng.range(0.9, 1.4), z - b.rng.range(0.5, 3.5), b.rng.range(0, 6.28), b.rng.range(0.55, 0.9));
      if (b.foliage(0.55)) b.place(`grass_${b.rng.int(0, 1)}`, side * (PATH_HALF - 0.2), 0, z - b.rng.range(0.3, 3.7), b.rng.range(0, 6.28), b.rng.range(0.7, 1.1));
      if (b.foliage(0.22)) b.place(`vines_0`, side * (PATH_HALF + 0.95), b.rng.range(1.0, 1.5), z - 2, side * Math.PI / 2, [0.9, b.rng.range(0.5, 0.8), 1]);
    }
  }
}

/** Islands, trees, rocks and ruins out in the water on both sides. */
function scenery(b: Builder, len: number, opts: { minX?: number; sides?: number[]; big?: boolean } = {}) {
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
        if (b.foliage(0.5)) b.place(`jungle_${b.rng.int(0, 1)}_trunk`, x + side * 3, -2.4, zz - 2, 0, b.rng.range(0.7, 1.0)), b.place(`jungle_${b.rng.int(0, 1)}_crown`, x + side * 3, -2.4, zz - 2, 0, b.rng.range(0.7, 1.0));
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
    if (opts.big !== false && b.rng.chance(0.4 * d + 0.1)) {
      const x = side * b.rng.range(28, 55);
      const t = b.rng.pick(['tower_0', 'tower_1', 'rock_big_0', 'rock_big_1', 'rock_big_2', 'arch_1']);
      const s = t.startsWith('rock') ? b.rng.range(1.2, 2.2) : b.rng.range(1.1, 1.6);
      b.place(t, x, -2.6, -b.rng.range(0, len), b.rng.range(0, 6.28), s);
      if (t.startsWith('tower') || t === 'arch_1') {
        const pi = b.rng.int(0, 1);
        b.place(`jungle_${pi}_trunk`, x + 6, -2.4, -len / 2, 0, 1.1);
        b.place(`jungle_${pi}_crown`, x + 6, -2.4, -len / 2, 0, 1.1);
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
          b.place(`rock_big_${b.rng.int(0, 2)}`, side * 15, -3, -len * 0.3, b.rng.range(0, 6.28), [1.3, 1.9, 1.2]);
          b.place(`rock_big_${b.rng.int(0, 2)}`, side * 16, -3, -len * 0.95, b.rng.range(0, 6.28), [1.4, 1.7, 1.3]);
          const fz = -len * b.rng.range(0.45, 0.7);
          const fm = new THREE.Matrix4().compose(
            new THREE.Vector3(side * 8.2, 12, fz),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side * Math.PI) / 2),
            new THREE.Vector3(1, 1, 1),
          );
          b.falls.push({ m: fm, w: 3.2, h: 14.2 });
          b.foamRing(side * 9, fz, 3);
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
          if (b.foliage(0.3)) b.place(`roots_${b.rng.int(0, 1)}`, side * (PATH_HALF + 0.1), b.rng.range(4.4, 5.0), z - 2, -side * Math.PI / 2, [b.rng.range(0.7, 1), b.rng.range(0.8, 1.2), 1]);
          if (b.foliage(0.3)) b.place(`fern_${b.rng.int(0, 1)}`, side * (PATH_HALF - 0.05), -0.05, z - b.rng.range(0.5, 3.5), b.rng.range(0, 6.28), 0.85);
          if (b.foliage(0.55)) b.place('vines_0', side * (PATH_HALF + 0.15), b.rng.range(3.8, 4.8), z - 2, -side * Math.PI / 2, [1, b.rng.range(0.8, 1.3), 1]);
          if (b.foliage(0.5)) b.place(`bush_${b.rng.int(0, 3)}`, side * (PATH_HALF + 0.7), b.rng.range(4.2, 5.0), z - b.rng.range(0, 4), 0, b.rng.range(0.7, 1.1));
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
      // The cliff: two big rocks overlapping, a waterfall pouring between them.
      const cx = side * 17;
      b.place(`rock_big_${b.rng.int(0, 2)}`, cx, -3, -len * 0.25, b.rng.range(0, 6.28), [1.5, 1.8, 1.4]);
      b.place(`rock_big_${b.rng.int(0, 2)}`, cx + side * 2, -3, -len * 0.85, b.rng.range(0, 6.28), [1.6, 1.6, 1.5]);
      b.place(`rock_mid_${b.rng.int(0, 2)}`, side * 5.5, -2.2, -len * 0.55, 0, 1.6);
      const fm = new THREE.Matrix4().compose(
        new THREE.Vector3(side * 8.5, 14, -len * 0.55),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side * Math.PI) / 2),
        new THREE.Vector3(1, 1, 1),
      );
      b.falls.push({ m: fm, w: 4.2, h: 16.5 });
      b.foamRing(side * 9.5, -len * 0.55, 3.4);
      b.lilies(side * 6.5, -len * 0.3, 1.3);
      b.lilies(side * 7, -len * 0.8, 1.1);
      for (let k = 0; k < 2; k++) if (b.foliage(0.8)) b.place(`roots_${b.rng.int(0, 1)}`, side * 8.2, b.rng.range(5, 9), -len * b.rng.range(0.2, 0.9), -side * Math.PI / 2, [1.4, 1.6, 1]);
      for (let z = -2; z > -len; z -= 5) if (b.foliage(0.7)) b.place(`bush_${b.rng.int(0, 3)}`, side * b.rng.range(7, 10), b.rng.range(0, 6), z, 0, b.rng.range(1, 1.6));
      b.place(`palm_1_trunk`, side * 9, 2, -len * 0.2, 0, 1.1);
      b.place(`palm_1_crown`, side * 9, 2, -len * 0.2, 0, 1.1);
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
      b.place(`head_${b.rng.int(0, 1)}`, hs * 12, WL - 0.6, -len * 0.6, faceIn(hs, 0.6), 1.3);
      b.foamRing(hs * 12, -len * 0.6, 3.4);
      scenery(b, len, { minX: 13, big: true });
      return { hazards: ['chasm', 'gate'], walls: 'low' };
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
    [elevation > -0.5 ? 'stairsDown' : 'stairsUp', 1.1],
  ];
  const options = w.filter(([t]) => t !== prev || t === 'corridor');
  return rng.weighted(options);
}

export type { Segment };
