/**
 * Monte Carlo cross-check — evidence, not proof.
 *
 * The proof is tests/model.test.mjs and tests/enumerate.test.mjs, which work in
 * exact rationals over the complete outcome space. This file exists to catch the
 * one failure mode exact enumeration cannot: a model that is internally
 * consistent but does not describe the game as a forward simulation would play
 * it. The simulator re-derives outcomes from the raw hazard rules rather than
 * sampling the enumerated distributions, so agreement is informative.
 */

import { describe, expect, it } from 'vitest';
import { ByteStream, crossCheckArena, simulate, simulateArena } from '../tools/montecarlo.mjs';
import { CONFIG, POLICIES, survivorDistribution } from '../tools/lib/model.mjs';
import { F } from '../tools/lib/exact.mjs';

const SEED = 'b7a11cf0d3e94a5586c2ef0913d4bb2f77e1c0aa4d5b9631f2e8c07a4d19b3e5';

describe('deterministic byte stream', () => {
  it('reproduces the same sequence for the same seed', () => {
    const a = new ByteStream(SEED);
    const b = new ByteStream(SEED);
    for (let i = 0; i < 100; i += 1) expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('stays inside the requested modulus', () => {
    const rng = new ByteStream(SEED);
    for (let i = 0; i < 5000; i += 1) {
      const value = rng.nextBelow(25);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(25);
    }
  });

  it('is unbiased across a non-power-of-two modulus', () => {
    const rng = new ByteStream(SEED);
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 120_000; i += 1) counts[rng.nextBelow(6)] += 1;
    for (const c of counts) expect(Math.abs(c - 20_000)).toBeLessThan(700); // ~5 sigma
  });
});

describe('per-arena distributions match the exact model', () => {
  for (const [contractId, runners, draws] of [
    ['WIDE', 5, 200_000],
    ['SPLIT', 5, 200_000],
    ['NARROW', 5, 200_000],
    ['SPLIT', 2, 200_000],
  ]) {
    it(`${contractId} with ${runners} runners`, () => {
      const rows = crossCheckArena(contractId, runners, draws, SEED);
      const totalProbability = rows.reduce((s, r) => s + r.empirical.toNumber(), 0);
      expect(Math.abs(totalProbability - 1)).toBeLessThan(1e-9);
      for (const row of rows) {
        // 5 sigma on a binomial with n = draws, generously bounded.
        const p = row.exact.toNumber();
        const sigma = Math.sqrt(Math.max(p * (1 - p), 1e-6) / draws);
        expect(row.absError.toNumber(), `${contractId}/${runners} m=${row.survivors}`).toBeLessThan(
          5 * sigma + 1e-4,
        );
      }
    });
  }

  it('reproduces the correlated collapse atom that independence cannot explain', () => {
    const rows = crossCheckArena('NARROW', 5, 200_000, SEED);
    // Independent-only wipe probability would be (1/2)^5 = 0.03125; with the
    // shared collapse it is 33/64 = 0.515625. The simulator must see the latter.
    expect(rows[0].empirical.toNumber()).toBeGreaterThan(0.5);
    expect(Math.abs(rows[0].empirical.toNumber() - survivorDistribution('NARROW', 5)[0].toNumber())).toBeLessThan(
      0.01,
    );
  });

  it('never returns more survivors than runners', () => {
    const rng = new ByteStream(SEED);
    for (let i = 0; i < 5000; i += 1) {
      for (const id of ['WIDE', 'SPLIT', 'NARROW']) {
        const m = simulateArena(rng, id, 5);
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe('full-round RTP agrees with the exact value', () => {
  it('reproduces 95.5% under the low-variance Ranger policy', () => {
    const rounds = 60_000;
    const result = simulate(POLICIES.ALL_WIDE.fn, rounds, SEED);
    const error = Math.abs(result.empiricalRtp.toNumber() - CONFIG.rtp.toNumber());
    // Exact SD of this policy is ~0.6473; 5 sigma at 60k rounds is ~0.0132.
    expect(error).toBeLessThan(0.0132);
    expect(result.creditedTotal).toBeGreaterThan(0n);
  });

  it('reproduces the exact bust rate of the Ranger policy', () => {
    const result = simulate(POLICIES.ALL_WIDE.fn, 60_000, SEED);
    expect(Math.abs(result.bustRate.toNumber() - 0.20698397)).toBeLessThan(0.01);
  });

  it('reproduces the exact zero-bust guarantee of the Keeper policy', () => {
    const result = simulate(POLICIES.SHELTER_LADDER.fn, 20_000, SEED);
    expect(result.bustRate.toString()).toBe('0/1');
  });

  it('never exceeds the max reachable payout, let alone the cap', () => {
    const result = simulate(POLICIES.ALL_NARROW.fn, 40_000, SEED);
    expect(result.bestReturn.lte(F(24448n, 25n))).toBe(true);
    expect(result.bestReturn.lt(F(CONFIG.maxWinMultiple))).toBe(true);
  });
});
