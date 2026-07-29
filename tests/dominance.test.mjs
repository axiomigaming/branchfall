/**
 * Which choices are trades, and which are volatility dials.
 *
 * The v2 draft asserted in prose that neither SPLIT balance dominates the other,
 * and `DESIGN.md` sold the fork as "a genuine, non-dominated trade". Both were
 * false: the lopsided fork is an exact mean-preserving spread of the balanced
 * one. Nothing in 1603 invariants checked it, because the claim was the one thing
 * in that section that was never computed.
 *
 * This file is the machinery and the claim, both tested: the dominance primitives
 * against hand-computed examples, the published lattice against the model, and
 * the documents against the lattice.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { F, Frac } from '../tools/lib/exact.mjs';
import {
  CONFIG,
  POLICIES,
  claimFactorDistribution,
  distributionMean,
  dominanceRows,
  enumeratePolicy,
  integratedCdfAt,
  laneSplitsFor,
  secondOrderCompare,
} from '../tools/lib/model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

/** @param {[bigint,bigint,bigint,bigint][]} atoms [valueN, valueD, probN, probD] */
const dist = (atoms) => atoms.map(([vn, vd, pn, pd]) => ({ value: F(vn, vd), prob: F(pn, pd) }));

// Mean 1, two atoms. B is a mean-preserving spread of A.
const A = dist([
  [0n, 1n, 1n, 2n],
  [2n, 1n, 1n, 2n],
]);
const B = dist([
  [0n, 1n, 3n, 4n],
  [4n, 1n, 1n, 4n],
]);
// Mean 1, and neither nested inside the other.
const C = dist([
  [1n, 2n, 4n, 5n],
  [3n, 1n, 1n, 5n],
]);

describe('the dominance primitives', () => {
  it('integrates a discrete CDF exactly', () => {
    // I_A(t) = sum p_i max(0, t - x_i). At t = 2: (1/2)(2) + (1/2)(0) = 1.
    expect(integratedCdfAt(A, F(2n)).toString()).toBe('1/1');
    // At t = 1: only the zero atom is below. (1/2)(1) = 1/2.
    expect(integratedCdfAt(A, F(1n)).toString()).toBe('1/2');
    // Below the smallest atom it is zero; the atom at t itself contributes nothing.
    expect(integratedCdfAt(A, Frac.ZERO).toString()).toBe('0/1');
    expect(integratedCdfAt(B, F(4n)).toString()).toBe('3/1');
  });

  it('ranks a mean-preserving spread the way risk aversion does', () => {
    expect(distributionMean(A).toString()).toBe('1/1');
    expect(distributionMean(B).toString()).toBe('1/1');
    expect(secondOrderCompare(A, B)).toBe('A');
    expect(secondOrderCompare(B, A)).toBe('B');
  });

  it('reports a crossing when the integrated CDFs actually cross', () => {
    expect(distributionMean(C).toString()).toBe('1/1');
    // C is below A at t = 1 and above it at t = 2 — a genuine trade.
    expect(integratedCdfAt(C, F(1n)).lt(integratedCdfAt(A, F(1n)))).toBe(true);
    expect(integratedCdfAt(A, F(2n)).lt(integratedCdfAt(C, F(2n)))).toBe(true);
    expect(secondOrderCompare(A, C)).toBe('CROSSES');
    expect(secondOrderCompare(C, A)).toBe('CROSSES');
  });

  it('is reflexive on itself and refuses lotteries with different means', () => {
    expect(secondOrderCompare(A, A)).toBe('IDENTICAL');
    const richer = dist([[2n, 1n, 1n, 1n]]);
    expect(() => secondOrderCompare(A, richer)).toThrow(/equal-mean/);
    try {
      secondOrderCompare(A, richer);
    } catch (error) {
      expect(error.code).toBe('UNEQUAL_MEANS');
    }
  });
});

describe('the claim-factor distribution is the right object to compare', () => {
  it('has mean exactly 1 for every geometry, which is what makes the reading standard', () => {
    for (const row of dominanceRows()) {
      for (const config of [row.aConfig, row.bConfig]) {
        const mean = distributionMean(
          claimFactorDistribution(config.contract, config.runners, config.laneSplit),
        );
        expect(mean.toString(), config.key).toBe('1/1');
      }
    }
  });

  it('carries the exact claim multipliers, not a rounding of them', () => {
    const wide5 = claimFactorDistribution('WIDE', 5);
    expect(wide5.map((a) => a.value.toString())).toEqual(['0/1', '5/21', '10/21', '5/7', '20/21', '25/21']);
    expect(wide5.reduce((s, a) => s.add(a.prob), Frac.ZERO).toString()).toBe('1/1');
  });
});

describe('the published lattice', () => {
  const rows = dominanceRows();

  it('compares every pair a player can be offered at one squad size', () => {
    // 1 + 3 + 3 + 6 + 6 across n = 1..5.
    expect(rows.length).toBe(19);
    for (const row of rows) expect(row.aConfig.runners).toBe(row.bConfig.runners);
  });

  it('finds the fork balance nested at every size where a balance exists', () => {
    for (let n = 2; n <= CONFIG.squadSize; n += 1) {
      const balances = laneSplitsFor('SPLIT', n);
      if (balances.length < 2) continue;
      const balanced = claimFactorDistribution('SPLIT', n, balances[0]);
      const lopsided = claimFactorDistribution('SPLIT', n, balances[balances.length - 1]);
      expect(secondOrderCompare(balanced, lopsided), `SPLIT/${n}`).toBe('A');
    }
  });

  it('finds WIDE against SPLIT genuinely non-dominated, at every size and both balances', () => {
    const crossings = rows.filter((r) => r.relation === 'CROSSES');
    expect(crossings.length).toBe(6);
    for (const row of crossings) {
      expect([row.aConfig.contract, row.bConfig.contract].sort()).toEqual(['SPLIT', 'WIDE']);
    }
    for (let n = 2; n <= CONFIG.squadSize; n += 1) {
      for (const k of laneSplitsFor('SPLIT', n)) {
        expect(
          secondOrderCompare(claimFactorDistribution('WIDE', n), claimFactorDistribution('SPLIT', n, k)),
          `WIDE/${n} vs SPLIT/${n}/${k}`,
        ).toBe('CROSSES');
      }
    }
  });

  it('finds NARROW dominated by everything, at equal mean', () => {
    const narrowRows = rows.filter((r) => r.aConfig.contract === 'NARROW' || r.bConfig.contract === 'NARROW');
    // 1 + 2 + 2 + 3 + 3 across n = 1..5.
    expect(narrowRows.length).toBe(11);
    for (const row of narrowRows) {
      expect(row.relation, `${row.a} vs ${row.b}`).not.toBe('CROSSES');
      expect(row.preferred, `${row.a} vs ${row.b}`).not.toContain('NARROW');
    }
  });

  it('holds after composition, so the last arena is not an escape hatch', () => {
    const balanced = enumeratePolicy(POLICIES.ALL_SPLIT.fn);
    const lopsided = enumeratePolicy(POLICIES.SCOUT_SPLIT.fn);
    expect(balanced.rtp.toString()).toBe(lopsided.rtp.toString());
    expect(secondOrderCompare(balanced.distribution, lopsided.distribution)).toBe('A');
  });
});

describe('the documents say what the lattice says', () => {
  const mathDoc = read('docs/MATH.md');
  const designDoc = read('docs/DESIGN.md');
  const readme = read('README.md');

  it('lets the false claim survive only as a quotation of what changed', () => {
    // Same discipline the runtime section uses for the v1 renderer phrase: the
    // retracted sentence may be quoted so the record is legible, and may never
    // stand as a live claim.
    const retracted = [/Neither balance dominates the other on any reading/g, /genuine, non-dominated trade/g];
    for (const [name, doc] of Object.entries({ mathDoc, designDoc, readme })) {
      for (const pattern of retracted) {
        for (const match of doc.matchAll(pattern)) {
          const before = doc.slice(Math.max(0, match.index - 320), match.index).replace(/\s+/g, ' ');
          expect(before, `${name}: "${match[0]}" is not marked as retracted`).toMatch(
            /v2 draft|used to end|[Ee]arlier drafts/,
          );
        }
      }
    }
  });

  it('replaces it with the fact, in the math and in the product spec', () => {
    expect(mathDoc).toContain('Which choices are trades, and which are volatility dials');
    expect(mathDoc).toContain('A second-order stochastically dominates B');
    expect(mathDoc).toContain('mean-preserving spread');
    expect(designDoc).toContain('a volatility dial with a name on it');
    expect(designDoc).toMatch(/exact mean-preserving spread of `3 \+ 2`/);
  });

  it('keeps the honest boundary on what a dominance result means', () => {
    expect(mathDoc).toContain('It is **not** a claim that a player taking NARROW or `4+1` has made a mistake');
    expect(mathDoc).toContain('ranks equal-mean lotteries *by risk aversion alone*');
    // And the product is still forbidden from marking a dominated card as wrong.
    expect(designDoc).toContain('It still may not be labelled as the wrong choice either');
  });

  it('binds the counts in the prose to the computed lattice', () => {
    expect(mathDoc).toMatch(/<!-- fig:dominancePairs -->19<!-- \/fig -->/);
    expect(mathDoc).toMatch(/<!-- fig:dominanceTrades -->6<!-- \/fig -->/);
    expect(mathDoc).toMatch(/<!-- fig:dominanceDials -->13<!-- \/fig -->/);
  });
});
