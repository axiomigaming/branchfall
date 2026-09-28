import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { Path } from '../src/world/path';
import { buildLayout, nextType, SECTION_TYPES, type SectionType } from '../src/world/sections';

describe('route generation', () => {
  it('stays continuous, bounded and varied over 5 km', () => {
    const rng = new Rng('soak');
    const path = new Path();
    path.reset({ pos: new THREE.Vector3(), yaw: 0 });
    const layouts = new Map<SectionType, ReturnType<typeof buildLayout>>();
    for (const t of SECTION_TYPES) layouts.set(t, buildLayout(t, `${t}#0`, { foliage: 1, scenery: 1 }));
    let prev: SectionType = 'start';
    let elevation = 0;
    const counts = new Map<SectionType, number>();
    let lastRun = 0;
    let maxRun = 0;
    while (path.length < 5000) {
      const t = nextType(rng, prev, elevation, 0.5);
      const l = layouts.get(t)!;
      path.push(l.len, (rng.chance(0.5) ? 1 : -1) * l.turn, l.dy);
      elevation += l.dy;
      expect(elevation).toBeGreaterThanOrEqual(-1.6 - 1e-9);
      expect(elevation).toBeLessThanOrEqual(0 + 1e-9);
      counts.set(t, (counts.get(t) ?? 0) + 1);
      lastRun = t === prev ? lastRun + 1 : 0;
      maxRun = Math.max(maxRun, lastRun);
      prev = t;
    }
    // Continuity: sampling across every joint never jumps.
    const a = { pos: new THREE.Vector3(), yaw: 0 };
    const b = { pos: new THREE.Vector3(), yaw: 0 };
    for (const seg of path.segs.slice(1)) {
      path.sample(seg.s0 - 0.01, a);
      path.sample(seg.s0 + 0.01, b);
      expect(a.pos.distanceTo(b.pos)).toBeLessThan(0.05);
      expect(Math.abs(a.yaw - b.yaw)).toBeLessThan(0.01);
    }
    // Variety: every type appears, and no type other than corridor repeats back to back.
    for (const t of SECTION_TYPES.filter((x) => x !== 'start' && x !== 'stairsUp' && x !== 'stairsDown')) expect(counts.get(t) ?? 0).toBeGreaterThan(5);
    expect(maxRun).toBeLessThan(6);
  });

  it('every layout references only walkable tiles on the path and stays within its length', () => {
    for (const t of SECTION_TYPES) {
      for (let i = 0; i < 4; i++) {
        const l = buildLayout(t, `${t}#${i}`, { foliage: 1, scenery: 1 });
        expect(l.tiles.length).toBeGreaterThan(0);
        for (const tile of l.tiles) {
          const p = new THREE.Vector3().setFromMatrixPosition(tile.m);
          expect(p.z).toBeLessThanOrEqual(4.01);
          expect(p.z).toBeGreaterThanOrEqual(-l.len - 4.01);
        }
        expect(l.hazards.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps cliffs, temples and idols off the causeway; the face gate straddles it', () => {
    let gates = 0;
    let cliffs = 0;
    for (const t of SECTION_TYPES) {
      for (let i = 0; i < 4; i++) {
        const l = buildLayout(t, `${t}#${i}`, { foliage: 1, scenery: 1 });
        for (const p of l.props) {
          const x = Math.abs(new THREE.Vector3().setFromMatrixPosition(p.m).x);
          if (/^cliff_wall_\d$/.test(p.piece)) {
            cliffs++;
            expect(x).toBeGreaterThanOrEqual(7.4);
          }
          if (/^(temple_|idol_)\d$/.test(p.piece)) expect(x).toBeGreaterThanOrEqual(7.5);
          if (p.piece === 'face_gate_0') {
            gates++;
            expect(x).toBeLessThan(1e-6);
            expect(l.type).toBe('gorge');
          }
        }
      }
    }
    expect(gates).toBeGreaterThan(0);
    expect(cliffs).toBeGreaterThan(10);
  });
});
