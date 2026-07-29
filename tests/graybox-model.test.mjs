/**
 * The graybox's numbers against the enumerator's numbers, and the module's own
 * conformance run against the BRANCHFALL definition.
 *
 * `docs/DESIGN.md` §11.3: *"the route cards and the fork control read their
 * numbers from the same tables `tools/enumerate.mjs` publishes. If the enumerator
 * and the card disagree, the build fails."* This is that build failure.
 *
 * The two sides are genuinely independent: `tools/enumerate.mjs` builds the
 * survivor law from first principles in this repository's own exact arithmetic,
 * and `server/paytable.ts` reads it out of the engine's `survivorDistribution()`.
 * Agreement fraction-for-fraction across the whole outcome space is evidence the
 * geometry translation in `server/definition.ts` — lane balance to `laneWidth` —
 * is the geometry the specification declares.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { checkModuleConformance } from '@axiom-games/reveal-engine/conformance';
import { stagedSurvival } from '@axiom-games/reveal-engine/modules/staged-survival';
import {
  BRANCHFALL,
  FINGERPRINT,
  assertGeometryMatchesSpecification,
} from '../server/definition.ts';
import { figuresFor } from '../server/paytable.ts';
import { laneBalances } from '../server/geometry.ts';
import { commitmentIsEntropyIndependent } from '../server/verify.ts';

const enumeration = JSON.parse(
  execFileSync('node', ['tools/enumerate.mjs', '--json'], { maxBuffer: 1024 * 1024 * 512 }).toString(),
);

describe('the engine reproduces the enumerated model', () => {
  it('cuts the lanes the specification declares, at every squad size and balance', () => {
    expect(() => assertGeometryMatchesSpecification()).not.toThrow();
    expect(laneBalances(5)).toEqual([3, 4]);
    expect(laneBalances(4)).toEqual([2, 3]);
    expect(laneBalances(3)).toEqual([2]);
    expect(laneBalances(2)).toEqual([1]);
    expect(laneBalances(1)).toEqual([]);
  });

  it('agrees with tools/enumerate.mjs on every geometry', () => {
    for (const geometry of enumeration.geometries) {
      const figures = figuresFor(geometry.contract, geometry.runners, geometry.laneSplit);
      const where = `${geometry.contract}/${geometry.runners}/${geometry.laneSplit}`;
      expect(`${where} wipe ${figures.wipe.exact}`).toBe(`${where} wipe ${geometry.wipe}`);
      expect(`${where} sweep ${figures.allClear.exact}`).toBe(`${where} sweep ${geometry.cleanSweep}`);
      expect(`${where} sole ${figures.sole.exact}`).toBe(`${where} sole ${geometry.soleSurvivor}`);
      expect(`${where} E ${figures.expectedSurvivors.exact}`).toBe(
        `${where} E ${geometry.expectedSurvivors}`,
      );
      expect([...figures.lanes]).toEqual(geometry.lanes);
    }
  });

  it('agrees on every (geometry, survivors) outcome and claim factor', () => {
    for (const outcome of enumeration.outcomes) {
      const figures = figuresFor(outcome.contract, outcome.runners, outcome.laneSplit);
      const row = figures.outcomes[outcome.survivors];
      const where = `${outcome.contract}/${outcome.runners}/${outcome.laneSplit}/m=${outcome.survivors}`;
      expect(`${where} P ${row.probability.exact}`).toBe(`${where} P ${outcome.probability}`);
      expect(`${where} f ${row.claimFactor.exact}`).toBe(`${where} f ${outcome.claimMultiplier}`);
    }
  });

  it('agrees on every one of the 42 side-bet prices', () => {
    expect(enumeration.sideBets).toHaveLength(42);
    for (const bet of enumeration.sideBets) {
      const figures = figuresFor(bet.contract, bet.runners, bet.laneSplit);
      const offer = figures.sideBets.find((candidate) => candidate.id === bet.bet);
      const where = `${bet.bet}/${bet.contract}/${bet.runners}/${bet.laneSplit}`;
      expect(`${where} P ${offer.probability.exact}`).toBe(`${where} P ${bet.probability}`);
      expect(`${where} x ${offer.multiplier.exact}`).toBe(`${where} x ${bet.multiplier}`);
    }
  });

  it('declares the cap the enumerator proves unreachable', () => {
    expect(BRANCHFALL.risk.maxWinMultiple).toBe(1000n);
    expect(BRANCHFALL.risk.capMustBeUnreachable).toBe(true);
    expect(enumeration.cap.routeTicketMax).toBe('24448/25');
    expect(enumeration.cap.cap).toBe('1000/1');
  });

  it('charges the margin once and rides fair after that', () => {
    expect(`${BRANCHFALL.pricing.entryReturn.numerator}/${BRANCHFALL.pricing.entryReturn.denominator}`).toBe(
      '191/200',
    );
    expect(BRANCHFALL.pricing.continuationReturn.numerator).toBe(1n);
    expect(BRANCHFALL.pricing.continuationReturn.denominator).toBe(1n);
  });
});

describe('the module accepts this definition on its own terms', () => {
  it('passes the engine’s staged-survival conformance run', () => {
    const report = checkModuleConformance(stagedSurvival, BRANCHFALL);
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.fingerprint).toBe(FINGERPRINT);
    // Evidence, and it is named: these are the codes that actually ran.
    expect(Object.keys(report.ran)).toEqual(
      expect.arrayContaining([
        'CONTINUATION_NOT_FAIR',
        'DISTRIBUTION_NOT_EXACT',
        'LANE_GEOMETRY_UNSTABLE',
        'CAP_REACHABLE',
        'TAPE_NOT_DETERMINISTIC',
        'SEED_PRECOMMITMENT_BROKEN',
        'BANKING_LOSES_VALUE',
      ]),
    );
    expect(report.seeds).toBeGreaterThanOrEqual(1);
  });

  it('publishes a pre-commitment that cannot depend on entropy that does not exist yet', () => {
    // The whole ordering in ENGINE.md §5 rests on this: the operator seals a seed
    // against a round it has named, before the player's half exists. If the
    // commitment moved with the entropy, step 0 could not precede step 2.
    expect(commitmentIsEntropyIndependent('ab'.repeat(32), 'bf-order-check')).toBe(true);
  });
});
