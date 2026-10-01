import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Kit } from '../src/world/assets';
import { Track } from '../src/world/track';

/** A kit with just enough geometry: every piece is a unit box, all on one material. */
function fakeKit(): Kit {
  const geo = new Map<string, THREE.BufferGeometry>();
  const matOf = new Map<string, string>();
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (const n of ['floor_0', 'floor_1', 'floor_2', 'floor_wide_0', 'floor_narrow_0', 'planks_0', 'planks_1', 'stairs_0', 'floor_medallion_0']) {
    geo.set(n, box);
    matOf.set(n, 'stone');
  }
  const mat = new Map<string, THREE.Material>([['stone', new THREE.MeshBasicMaterial()]]);
  return { geo, mat, matOf } as unknown as Kit;
}

describe('walkable tiles', () => {
  it('know where they lie along the route, however they are rotated', async () => {
    const track = new Track(fakeKit());
    await track.prepare({ foliage: 1, scenery: 1 });
    track.reset('tiles');
    track.update(600, 0.5);
    const mid = new THREE.Vector3();
    const f = { pos: new THREE.Vector3(), yaw: 0 };
    let n = 0;
    for (const sec of track.sections) {
      for (const t of sec.tiles) {
        const len = t.sFar - t.sNear;
        expect(len).toBeGreaterThan(3.9);
        expect(len).toBeLessThan(9);
        if (t.piece === 'floor_wide_0') continue; // the plaza slab is laid on the chord of an arc
        // The tile's own centre (4 m along its −Z) sits on the path at the middle of its s-range.
        const flip = new THREE.Vector3(0, 0, -2).applyMatrix4(t.world);
        mid.copy(flip);
        track.path.sample((t.sNear + t.sFar) / 2, f);
        expect(Math.hypot(mid.x - f.pos.x, mid.z - f.pos.z)).toBeLessThan(0.3);
        n++;
      }
    }
    expect(n).toBeGreaterThan(50);
  });

  it('collapse spares tiles outside the range and tileAt finds the one underfoot', async () => {
    const track = new Track(fakeKit());
    await track.prepare({ foliage: 1, scenery: 1 });
    track.reset('collapse');
    track.update(200, 0.5);
    const s = 230; // ahead of the runner at 200 (sections behind are cleared)
    const under = track.tileAt(s)!;
    expect(under).toBeDefined();
    track.collapse(under.sFar + 0.01, under.sFar + 12);
    expect(under.alive).toBe(true);
    expect(track.tileAt(under.sFar + 2)).toBeUndefined();
  });
});
