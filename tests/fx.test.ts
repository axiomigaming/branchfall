import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { FX_CAPACITY, escapeScale, fallScale, fxBudget, grandOf, nextDangerCue } from '../src/render/fxScale';

describe('fx scaling', () => {
  it('grandOf is 0 for small, 1 for huge, monotonic between', () => {
    expect(grandOf(1)).toBe(0);
    expect(grandOf(1.5)).toBe(0);
    expect(grandOf(25)).toBe(1);
    expect(grandOf(1000)).toBe(1);
    let prev = -1;
    for (let m = 1; m < 40; m *= 1.1) {
      const g = grandOf(m);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it('a fall at 1.2x is quick and contained, at 20x+ big and slow', () => {
    const small = fallScale(1.2);
    const big = fallScale(22);
    expect(small.waves).toBe(0);
    expect(big.waves).toBe(2);
    expect(big.slowDur).toBeGreaterThan(small.slowDur * 2);
    expect(big.slowMin).toBeLessThan(small.slowMin);
    expect(big.span).toBeGreaterThan(small.span * 2);
    expect(big.pre).toBeGreaterThan(small.pre);
    expect(big.debris).toBeGreaterThan(small.debris);
  });

  it('reduced motion: short, shallow slow motion and gentle kicks', () => {
    for (const m of [1.2, 5, 30]) {
      const f = fallScale(m, 'reduced');
      expect(f.slowDur).toBeLessThanOrEqual(0.5);
      expect(f.slowMin).toBeGreaterThanOrEqual(0.8);
      expect(f.kick).toBeLessThan(fallScale(m).kick);
      const e = escapeScale(m, 'reduced');
      expect(e.slowDur).toBeLessThanOrEqual(0.5);
      expect(e.slowMin).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('escapes grow with the cash-out multiplier', () => {
    const a = escapeScale(1.3);
    const b = escapeScale(30);
    expect(a.reveal).toBe(0);
    expect(b.reveal).toBe(1);
    expect(b.birds).toBeGreaterThan(a.birds);
    expect(b.beams).toBeGreaterThan(a.beams);
    expect(b.rim).toBeGreaterThan(a.rim);
    expect(b.slowDur).toBeGreaterThan(a.slowDur);
  });
});

describe('fx budgets', () => {
  it('grow with the tier, stay within the pools, and low stays light', () => {
    const order = ['low', 'medium', 'high', 'ultra'] as const;
    for (let i = 1; i < order.length; i++) {
      const lo = fxBudget(order[i - 1]!);
      const hi = fxBudget(order[i]!);
      for (const k of Object.keys(lo) as (keyof typeof lo)[]) expect(hi[k]).toBeGreaterThanOrEqual(lo[k]);
    }
    for (const q of order) {
      const b = fxBudget(q);
      for (const k of Object.keys(b) as (keyof typeof b)[]) expect(b[k]).toBeLessThanOrEqual(FX_CAPACITY[k]);
    }
    expect(fxBudget('low').billows).toBeLessThanOrEqual(80);
    expect(fxBudget('low').bodies).toBeLessThanOrEqual(24);
  });

  it('reduced motion trims particles and birds', () => {
    const f = fxBudget('high');
    const r = fxBudget('high', 'reduced');
    expect(r.billows).toBeLessThan(f.billows);
    expect(r.birds).toBeLessThan(f.birds);
    expect(r.shards).toBeGreaterThanOrEqual(1);
  });
});

describe('danger cues', () => {
  it('are calm below 2x and thicken with the tier', () => {
    const rng = new Rng('cues');
    for (let i = 0; i < 50; i++) expect(nextDangerCue(rng, 1.5)).toBeNull();
    const mean = (m: number) => {
      const r = new Rng(`m${m}`);
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += nextDangerCue(r, m)!.wait;
      return sum / 400;
    };
    expect(mean(3)).toBeGreaterThan(mean(7));
    expect(mean(7)).toBeGreaterThan(mean(15));
    expect(mean(15)).toBeGreaterThan(mean(40));
  });

  it('depend only on the multiplier and the cosmetic RNG (same inputs, same cues)', () => {
    const a = new Rng('same');
    const b = new Rng('same');
    for (let i = 0; i < 30; i++) expect(nextDangerCue(a, 12)).toEqual(nextDangerCue(b, 12));
  });

  it('strength stays within 0..1', () => {
    const r = new Rng('s');
    for (let i = 0; i < 200; i++) {
      const c = nextDangerCue(r, 2 + i);
      expect(c!.strength).toBeGreaterThan(0);
      expect(c!.strength).toBeLessThanOrEqual(1);
    }
  });
});
