import * as THREE from 'three';
import type { QualityLevel } from '../config/quality';
import { Billows } from './fxBillows';
import { Cracks, Rings } from './fxDecals';
import { Beams, installRim, type RimUniforms } from './fxEscape';
import { Flock } from './fxFlock';
import { FX_CAPACITY, fxBudget, type FxBudget, type Motion } from './fxScale';

/**
 * The cinematic effects layer: lit dust clouds, water shockwaves, floor cracks, birds, sun shafts
 * and the runner's escape rim. Pools are sized for the highest tier; budgets cap what is live.
 * `clear()` resets everything at once (a new round).
 */
export class Fx {
  readonly root = new THREE.Group();
  readonly billows = new Billows(FX_CAPACITY.billows);
  readonly rings = new Rings(FX_CAPACITY.rings);
  readonly cracks = new Cracks(8);
  readonly flock = new Flock(FX_CAPACITY.birds);
  readonly beams = new Beams(FX_CAPACITY.beams);
  budget: FxBudget = fxBudget('high');
  private rim: RimUniforms | null = null;
  private rimLevel = 0;
  private rimTarget = 0;
  private rimColor = new THREE.Color(1.0, 0.66, 0.3);
  private sunView = new THREE.Vector3();

  constructor() {
    this.root.name = 'fx';
    this.root.add(this.cracks.mesh, this.rings.mesh, this.billows.mesh, this.flock.mesh, this.beams.mesh);
  }

  /** Patch the runner's materials for the escape rim (before programs compile). */
  attachRunner(root: THREE.Object3D): void {
    this.rim = installRim(root);
  }

  setBudget(level: QualityLevel, motion: Motion): void {
    const b = fxBudget(level, motion);
    this.budget = b;
    this.billows.budget = b.billows;
    this.billows.scale = b.billows / FX_CAPACITY.billows + 0.35;
    this.rings.budget = b.rings;
    this.flock.budget = b.birds;
    this.beams.budget = b.beams;
  }

  /** Golden rim strength target (0 = off). */
  set rimLevelTarget(x: number) {
    this.rimTarget = x;
  }

  update(dt: number, rawDt: number, cam: THREE.Camera, sunDir: THREE.Vector3, time: number): void {
    this.billows.update(dt, cam, sunDir);
    this.rings.update(dt);
    this.cracks.update(dt);
    this.flock.update(dt);
    this.beams.update(rawDt, time);
    if (this.rim) {
      this.rimLevel += (this.rimTarget - this.rimLevel) * (1 - Math.exp(-rawDt * 2.5));
      this.rim.uRimColor.value.copy(this.rimColor).multiplyScalar(this.rimLevel * 2.2);
      this.sunView.copy(sunDir).transformDirection(cam.matrixWorldInverse).setZ(0);
      if (this.sunView.lengthSq() < 1e-4) this.sunView.set(0, 1, 0);
      this.rim.uRimDir.value.copy(this.sunView.normalize());
    }
  }

  clear(): void {
    this.billows.clear();
    this.rings.clear();
    this.cracks.clear();
    this.flock.clear();
    this.beams.clear();
    this.rimLevel = this.rimTarget = 0;
    this.rim?.uRimColor.value.setRGB(0, 0, 0);
  }
}
