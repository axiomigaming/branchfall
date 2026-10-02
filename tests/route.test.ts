import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { Path } from '../src/world/path';
import { buildLayout, nextType, PATH_HALF, SECTION_TYPES, type SectionType } from '../src/world/sections';

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

  it('keeps the jungle off the way: banks behind the walls, limbs high over it, falls landing at its edge', () => {
    let banks = 0;
    let limbs = 0;
    let pathFalls = 0;
    let vistas = 0;
    const v = new THREE.Vector3();
    for (const t of SECTION_TYPES) {
      for (let i = 0; i < 4; i++) {
        const l = buildLayout(t, `${t}#${i}`, { foliage: 1, scenery: 1 });
        for (const p of l.props) {
          v.setFromMatrixPosition(p.m);
          if (/^jungle_bank_\d$/.test(p.piece)) {
            banks++;
            expect(Math.abs(v.x)).toBeGreaterThanOrEqual(PATH_HALF + 1.9);
          }
          if (/^canopy_\d$/.test(p.piece)) {
            limbs++;
            expect(Math.abs(v.x)).toBeLessThan(1e-6);
          }
          if (p.piece === 'arch_1' && Math.abs(v.x) < 1e-6 && v.z < -l.len + 3) vistas++;
        }
        for (const f of l.falls) {
          if (!f.path) continue;
          pathFalls++;
          v.setFromMatrixPosition(f.m);
          expect(Math.abs(v.x)).toBeGreaterThan(PATH_HALF);
          expect(Math.abs(v.x)).toBeLessThan(PATH_HALF + 1);
          expect(f.h).toBeCloseTo(v.y, 0);
        }
      }
    }
    expect(banks).toBeGreaterThan(10);
    expect(limbs).toBeGreaterThan(4);
    expect(pathFalls).toBeGreaterThan(0);
    expect(vistas).toBeGreaterThan(0);
  });

  it('the tunnel has no room for the slab gate; its portals and vault fit inside the section', () => {
    for (let i = 0; i < 6; i++) {
      const l = buildLayout('tunnel', `tunnel#${i}`, { foliage: 1, scenery: 1 });
      expect(l.hazards).not.toContain('gate');
      expect(l.walls).toBe('tall');
      const at = (p: { m: THREE.Matrix4 }) => new THREE.Vector3().setFromMatrixPosition(p.m);
      const mouths = l.props.filter((p) => p.piece === 'tunnel_mouth_0').map(at);
      expect(mouths.length).toBe(2);
      for (const m of mouths) expect(Math.abs(m.x)).toBeLessThan(1e-6);
      const vaults = l.props.filter((p) => /^vault_\d$/.test(p.piece)).map(at);
      expect(vaults.length).toBeGreaterThanOrEqual(2);
      // Every vault segment (4 m along −Z from its origin, or +Z when turned) lies between the portals.
      const zs = mouths.map((m) => m.z).sort((a, b) => a - b);
      for (const v of vaults) {
        expect(v.z).toBeLessThanOrEqual(zs[1]! + 1e-6);
        expect(v.z).toBeGreaterThanOrEqual(zs[0]! - 1e-6);
      }
      expect(zs[0]!).toBeGreaterThanOrEqual(-l.len);
      // The path is floored all the way through.
      expect(l.tiles.length).toBe(l.len / 4);
    }
  });

  it('boardwalks are planks; statue avenues end at a lintel gate with the facades out over the water', () => {
    for (let i = 0; i < 4; i++) {
      const bw = buildLayout('boardwalk', `boardwalk#${i}`, { foliage: 1, scenery: 1 });
      expect(bw.tiles.every((t) => t.piece.startsWith('planks_'))).toBe(true);
      const st = buildLayout('statues', `statues#${i}`, { foliage: 1, scenery: 1 });
      expect(st.props.some((p) => p.piece === 'lintel_gate_0')).toBe(true);
      for (const p of st.props) {
        const x = Math.abs(new THREE.Vector3().setFromMatrixPosition(p.m).x);
        if (p.piece.startsWith('facade_')) expect(x).toBeGreaterThan(7.5);
        if (p.piece.startsWith('guardian_')) expect(x).toBeGreaterThan(2.9);
      }
    }
  });

  it('scatter thins out on the lightest tier', () => {
    const count = (d: number) => {
      let n = 0;
      for (const t of ['corridor', 'ruins', 'tall'] as const)
        for (let i = 0; i < 3; i++) n += buildLayout(t, `${t}#${i}`, { foliage: d, scenery: d }).props.filter((p) => p.piece.startsWith('scatter_')).length;
      return n;
    };
    const high = count(1);
    const low = count(0.4);
    expect(high).toBeGreaterThan(20);
    expect(low).toBeLessThan(high * 0.45);
  });
});
