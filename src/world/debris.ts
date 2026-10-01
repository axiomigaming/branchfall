import * as THREE from 'three';
import type { Kit } from './assets';
import { WATER_Y } from './water';

/**
 * Scripted rigid bodies for collapses: fall, tumble, bounce, break into fragments, roll to a stop
 * (or off the edge), splash, sink. Angular velocity is in world space, and a body rolling on the
 * floor spins to match its ground speed, so stones roll rather than slide.
 */
interface Body {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  ground: (x: number, z: number) => number | null;
  bounces: number;
  splashed: boolean;
  age: number;
  settle: boolean;
  /** Heavy bodies (a gate slab) land dead: one small recoil, no tumbling. */
  heavy: boolean;
  /** Approximate radius (m) for rolling. */
  radius: number;
  /** Split into this many fragments on the first hard impact (0 = never), or after `breakAfter` s. */
  breakInto: number;
  breakAfter: number;
  rolling: boolean;
  rest: boolean;
  /** Height of the centre above the contact point (procedural shards are centred, kit pieces sit on their base). */
  lift: number;
}

export interface ImpactEvent {
  pos: THREE.Vector3;
  speed: number;
  water: boolean;
  mass: number;
  /** True when the body broke apart at this impact. */
  broke?: boolean;
}

export interface SpawnOpts {
  settle?: boolean;
  scale?: number;
  heavy?: boolean;
  /** Break into this many fragments on the first hard landing. */
  breakInto?: number;
  /** Break apart in mid-air after this many seconds (a floor slab cracking up as it drops). */
  breakAfter?: number;
  /** Material key from the kit (for procedural shards); defaults to stone. */
  mat?: string;
}

const SHARD_KINDS = 6;

/** Irregular faceted stone fragments (unit size ≈ 1 m across), built once. */
function shardGeometries(): THREE.BufferGeometry[] {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: THREE.BufferGeometry[] = [];
  for (let k = 0; k < SHARD_KINDS; k++) {
    const g = new THREE.IcosahedronGeometry(0.5, k % 3 === 0 ? 1 : 0);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    // One squash per shard (slabs, wedges, chunks), then jitter each corner consistently.
    const sx = 0.7 + rnd() * 0.6;
    const sy = 0.35 + rnd() * 0.5;
    const sz = 0.7 + rnd() * 0.6;
    const seen = new Map<string, THREE.Vector3>();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      let v = seen.get(key);
      if (!v) {
        const j = 0.75 + rnd() * 0.5;
        v = new THREE.Vector3(p.getX(i) * sx * j, p.getY(i) * sy * j, p.getZ(i) * sz * j);
        // Cut a flat face on one side now and then: a fracture plane.
        if (v.y > 0.12 * sy && k % 2 === 0) v.y = 0.12 * sy;
        seen.set(key, v);
      }
      p.setXYZ(i, v.x, v.y, v.z);
    }
    const flat = g.index ? g.toNonIndexed() : g;
    flat.computeVertexNormals();
    flat.computeBoundingSphere();
    flat.computeBoundingBox();
    out.push(flat);
  }
  return out;
}

export class Debris {
  readonly root = new THREE.Group();
  private bodies: Body[] = [];
  private q = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  private shards = shardGeometries();
  /** Most bodies alive at once (quality budget); the oldest small pieces go first. */
  budget = 60;
  /** Fragments a breaking chunk splits into (quality budget). */
  shardBudget = 4;
  onImpact: (e: ImpactEvent) => void = () => {};

  constructor(private kit: Kit) {
    this.root.name = 'debris';
  }

  private geoOf(piece: string): THREE.BufferGeometry | undefined {
    if (piece.startsWith('shard_')) return this.shards[(+piece.slice(6) || 0) % SHARD_KINDS];
    return this.kit.geo.get(piece);
  }

  private matOf(piece: string, key?: string): THREE.Material | undefined {
    if (key) return this.kit.mat.get(key);
    if (piece.startsWith('shard_')) return this.kit.mat.get('stoneB') ?? this.kit.mat.values().next().value;
    return this.kit.mat.get(this.kit.matOf.get(piece)!);
  }

  spawn(piece: string, world: THREE.Matrix4, vel: THREE.Vector3, spin: THREE.Vector3, ground: (x: number, z: number) => number | null, opts: SpawnOpts = {}): THREE.Mesh | null {
    const geo = this.geoOf(piece);
    const mat = this.matOf(piece, opts.mat);
    if (!geo || !mat) return null;
    while (this.bodies.length >= this.budget) {
      // Over budget: drop what nobody will miss first — a resting pebble, then a small fragment,
      // then the oldest loose piece. Never the slab across the way.
      let i = this.bodies.findIndex((b) => !b.heavy && b.rest);
      if (i < 0) i = this.bodies.findIndex((b) => !b.heavy && b.lift > 0);
      if (i < 0) i = this.bodies.findIndex((b) => !b.heavy);
      if (i < 0) break;
      this.remove(i);
    }
    const mesh = new THREE.Mesh(geo, mat);
    world.decompose(mesh.position, mesh.quaternion, mesh.scale);
    if (opts.scale) mesh.scale.multiplyScalar(opts.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const radius = Math.max(0.05, geo.boundingSphere!.radius * mesh.scale.y * 0.8);
    this.bodies.push({
      mesh,
      vel: vel.clone(),
      spin: spin.clone(),
      ground,
      bounces: 0,
      splashed: false,
      age: 0,
      settle: opts.settle ?? false,
      heavy: opts.heavy ?? false,
      radius,
      breakInto: opts.breakInto ?? 0,
      breakAfter: opts.breakAfter ?? Infinity,
      rolling: false,
      rest: false,
      lift: piece.startsWith('shard_') ? radius * 0.55 : 0,
    });
    return mesh;
  }

  /** Split a body into fragments that carry its motion and fly apart. */
  private shatter(i: number): void {
    const b = this.bodies[i]!;
    const n = Math.min(b.breakInto, this.shardBudget);
    const m = b.mesh;
    const size = Math.max(m.scale.x, m.scale.y, m.scale.z) * (m.geometry.boundingSphere?.radius ?? 0.5) * 2;
    const mat = m.material as THREE.Material;
    const matKey = [...this.kit.mat.entries()].find(([, v]) => v === mat)?.[0];
    const pos = m.position.clone();
    const vel = b.vel.clone();
    const ground = b.ground;
    this.remove(i);
    for (let k = 0; k < n; k++) {
      const out = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
      const sc = (size / Math.cbrt(n)) * (0.55 + Math.random() * 0.35);
      const p = pos.clone().addScaledVector(out, size * 0.25);
      const w = new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)), new THREE.Vector3(sc, sc, sc));
      const v = vel.clone().multiplyScalar(0.6).addScaledVector(out, 1.5 + Math.random() * 2.5);
      this.spawn(`shard_${k % SHARD_KINDS}`, w, v, new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(9), ground, { mat: matKey });
    }
  }

  update(dt: number): void {
    const g = 19;
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i]!;
      b.age += dt;
      // Loose pieces still moving after 30 s are dropped; anything at rest stays (a slab across the way).
      if (b.age > 30 && !b.rest) {
        this.remove(i);
        continue;
      }
      if (b.rest) continue;
      const m = b.mesh;
      if (b.breakInto > 0 && b.age >= b.breakAfter && !b.splashed) {
        this.onImpact({ pos: m.position.clone(), speed: 0, water: false, mass: m.scale.x, broke: true });
        this.shatter(i);
        continue;
      }
      if (!b.rolling) b.vel.y -= g * dt;
      m.position.addScaledVector(b.vel, dt);
      const w = b.spin.length();
      if (w > 1e-4) {
        this.q.setFromAxisAngle(this.axis.copy(b.spin).divideScalar(w), w * dt);
        m.quaternion.premultiply(this.q);
      }
      const ground = b.splashed ? null : b.ground(m.position.x, m.position.z);
      if (b.rolling) {
        if (ground === null) {
          // Rolled off the edge: fall.
          b.rolling = false;
        } else {
          m.position.y = ground + b.lift;
          const h = Math.hypot(b.vel.x, b.vel.z);
          const nh = Math.max(0, h - 2.2 * dt);
          if (nh < 0.05) {
            b.vel.set(0, 0, 0);
            b.spin.set(0, 0, 0);
            b.rest = true;
          } else {
            b.vel.x *= nh / h;
            b.vel.z *= nh / h;
            // Rolling without slipping: ω = (up × v) / r.
            b.spin.set(b.vel.z, 0, -b.vel.x).divideScalar(b.radius);
          }
        }
      } else if (ground !== null && m.position.y < ground + b.lift && b.vel.y < 0) {
        const speed = -b.vel.y;
        m.position.y = ground + b.lift;
        if (b.breakInto > 0 && speed > 4) {
          this.onImpact({ pos: m.position.clone(), speed, water: false, mass: m.scale.x, broke: true });
          this.shatter(i);
          continue;
        }
        if (speed > 2.5 && b.bounces < (b.heavy ? 1 : 3)) {
          b.vel.y = speed * (b.heavy ? 0.05 : 0.3);
          b.vel.x *= b.heavy ? 0.3 : 0.7;
          b.vel.z *= b.heavy ? 0.3 : 0.7;
          // A bounce converts some ground speed into tumble.
          if (!b.heavy) b.spin.multiplyScalar(0.5).add(new THREE.Vector3(b.vel.z, 0, -b.vel.x).divideScalar(b.radius * 2));
          else b.spin.set(0, 0, 0);
          b.bounces++;
          this.onImpact({ pos: m.position.clone(), speed, water: false, mass: m.scale.x });
        } else if (!b.heavy && Math.hypot(b.vel.x, b.vel.z) > 0.4) {
          b.rolling = true;
          b.vel.y = 0;
        } else {
          b.vel.set(0, 0, 0);
          b.spin.set(0, 0, 0);
          b.settle = true;
          b.rest = true;
        }
      }
      if (!b.splashed && m.position.y < WATER_Y && (ground === null || ground < WATER_Y)) {
        b.splashed = true;
        b.rolling = false;
        this.onImpact({ pos: new THREE.Vector3(m.position.x, WATER_Y, m.position.z), speed: -b.vel.y, water: true, mass: m.scale.x });
        b.vel.multiplyScalar(0.15);
        b.spin.multiplyScalar(0.3);
      }
      if (b.splashed) {
        b.vel.y = Math.max(b.vel.y, -1.2);
        if (m.position.y < WATER_Y - 6) this.remove(i);
      }
    }
  }

  private remove(i: number): void {
    const b = this.bodies[i]!;
    this.root.remove(b.mesh);
    this.bodies.splice(i, 1);
  }

  clear(): void {
    for (let i = this.bodies.length - 1; i >= 0; i--) this.remove(i);
  }

  get count(): number {
    return this.bodies.length;
  }
}
