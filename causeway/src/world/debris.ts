import * as THREE from 'three';
import type { Kit } from './assets';
import { WATER_Y } from './water';

/** Scripted rigid bodies for collapses: fall, tumble, bounce once or twice, splash, sink. */
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
  onImpact?: (b: Body, speed: number) => void;
}

export interface ImpactEvent {
  pos: THREE.Vector3;
  speed: number;
  water: boolean;
  mass: number;
}

export class Debris {
  readonly root = new THREE.Group();
  private bodies: Body[] = [];
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  onImpact: (e: ImpactEvent) => void = () => {};

  constructor(private kit: Kit) {
    this.root.name = 'debris';
  }

  spawn(
    piece: string,
    world: THREE.Matrix4,
    vel: THREE.Vector3,
    spin: THREE.Vector3,
    ground: (x: number, z: number) => number | null,
    opts: { settle?: boolean; scale?: number; heavy?: boolean } = {},
  ): THREE.Mesh | null {
    const geo = this.kit.geo.get(piece);
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, this.kit.mat.get(this.kit.matOf.get(piece)!)!);
    world.decompose(mesh.position, mesh.quaternion, mesh.scale);
    if (opts.scale) mesh.scale.multiplyScalar(opts.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.bodies.push({ mesh, vel: vel.clone(), spin: spin.clone(), ground, bounces: 0, splashed: false, age: 0, settle: opts.settle ?? false, heavy: opts.heavy ?? false });
    return mesh;
  }

  update(dt: number): void {
    const g = 19;
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i]!;
      b.age += dt;
      const m = b.mesh;
      b.vel.y -= g * dt;
      m.position.addScaledVector(b.vel, dt);
      this.e.set(b.spin.x * dt, b.spin.y * dt, b.spin.z * dt);
      this.q.setFromEuler(this.e);
      m.quaternion.multiply(this.q);
      const ground = b.ground(m.position.x, m.position.z);
      if (ground !== null && m.position.y < ground && b.vel.y < 0 && !b.splashed) {
        const speed = -b.vel.y;
        m.position.y = ground;
        if (speed > 2.5 && b.bounces < (b.heavy ? 1 : 2)) {
          b.vel.y = speed * (b.heavy ? 0.05 : 0.28);
          b.vel.x *= 0.5;
          b.vel.z *= 0.5;
          b.spin.multiplyScalar(0.5);
          b.bounces++;
          this.onImpact({ pos: m.position.clone(), speed, water: false, mass: m.scale.x });
        } else {
          b.vel.set(0, 0, 0);
          b.spin.set(0, 0, 0);
          if (!b.settle) b.settle = true;
        }
      }
      if (!b.splashed && m.position.y < WATER_Y && (ground === null || ground < WATER_Y)) {
        b.splashed = true;
        this.onImpact({ pos: new THREE.Vector3(m.position.x, WATER_Y, m.position.z), speed: -b.vel.y, water: true, mass: m.scale.x });
        b.vel.multiplyScalar(0.15);
      }
      if (b.splashed) {
        b.vel.y = Math.max(b.vel.y, -1.2);
        if (m.position.y < WATER_Y - 6) this.remove(i);
      } else if (b.age > 30) this.remove(i);
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
