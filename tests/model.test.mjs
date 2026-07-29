/**
 * The model itself: geometry, distributions, actions, side bets, the DP.
 *
 * Everything here is exact. A test that needed a tolerance would be a test that
 * had left the exact-arithmetic path, so there are none.
 */

import { describe, expect, it } from 'vitest';
import { F, Frac } from '../tools/lib/exact.mjs';
import {
  CONFIG,
  CONTRACTS,
  CONTRACT_IDS,
  ModelError,
  SIDE_BETS,
  SIDE_BET_IDS,
  SIDE_BET_PLANS,
  actionExpectedFactor,
  actionsFor,
  assertLegalAction,
  balancedSplit,
  branches,
  capAnalysis,
  committedConfiguration,
  configKey,
  contract,
  enumeratePolicy,
  laneDistribution,
  laneSizes,
  laneSplitsFor,
  largestSideBetMultiplier,
  marginalSurvival,
  maxPayoutDP,
  POLICIES,
  probabilityOfZero,
  routeConfigurations,
  routeMultiplier,
  scoutSplit,
  sideBetOffers,
  sideBetOffersFor,
  sideBetTable,
  stateValueDP,
  survivorDistribution,
} from '../tools/lib/model.mjs';

const sum = (fracs) => fracs.reduce((a, b) => a.add(b), Frac.ZERO);
const expectedSurvivors = (dist) => dist.reduce((s, p, m) => s.add(p.mul(F(BigInt(m)))), Frac.ZERO);

describe('lane geometry', () => {
  it('offers exactly one geometry for single-lane contracts, reported as null', () => {
    for (const id of ['WIDE', 'NARROW']) {
      for (let n = 1; n <= CONFIG.squadSize; n += 1) {
        expect([...laneSplitsFor(id, n)]).toEqual([null]);
        expect([...laneSizes(id, n, null)]).toEqual([n]);
      }
    }
  });

  it('offers canonical lane balances for SPLIT and never a mirrored duplicate', () => {
    expect([...laneSplitsFor('SPLIT', 2)]).toEqual([1]);
    expect([...laneSplitsFor('SPLIT', 3)]).toEqual([2]);
    expect([...laneSplitsFor('SPLIT', 4)]).toEqual([2, 3]);
    expect([...laneSplitsFor('SPLIT', 5)]).toEqual([3, 4]);
    for (let n = 2; n <= CONFIG.squadSize; n += 1) {
      for (const k of laneSplitsFor('SPLIT', n)) {
        expect(k).toBeGreaterThanOrEqual(Math.ceil(n / 2));
        expect(k).toBeLessThanOrEqual(n - 1);
      }
    }
  });

  it('rejects an illegal or mirrored lane balance', () => {
    expect(() => laneSizes('SPLIT', 5, 2)).toThrow(ModelError);
    expect(() => laneSizes('SPLIT', 5, 5)).toThrow(ModelError);
    expect(() => laneSizes('SPLIT', 5, 0)).toThrow(ModelError);
    expect(() => laneSizes('WIDE', 5, 3)).toThrow(ModelError);
    expect(() => laneSizes('SPLIT', 1, 1)).toThrow(ModelError);
  });

  it('gives lane sizes that sum to the running group', () => {
    for (const config of routeConfigurations()) {
      const sizes = laneSizes(config.contract, config.runners, config.laneSplit);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(config.runners);
      expect(sizes.length).toBe(CONTRACTS[config.contract].laneCount);
      expect(sizes.every((s) => s >= 1)).toBe(true);
    }
  });

  it('enumerates 16 distinct route configurations', () => {
    const configs = routeConfigurations();
    expect(configs.length).toBe(16);
    expect(new Set(configs.map((c) => c.key)).size).toBe(16);
    expect(configs.map((c) => c.key)).toContain(configKey('SPLIT', 5, 4));
  });
});

describe('survivor distributions', () => {
  it('are exact probability distributions for every geometry', () => {
    for (const config of routeConfigurations()) {
      const dist = survivorDistribution(config.contract, config.runners, config.laneSplit);
      expect(dist.length).toBe(config.runners + 1);
      expect(sum([...dist]).toString()).toBe('1/1');
    }
  });

  it('have mean n*p regardless of contract or lane balance', () => {
    for (const config of routeConfigurations()) {
      const dist = survivorDistribution(config.contract, config.runners, config.laneSplit);
      const expected = marginalSurvival(config.contract).mul(F(BigInt(config.runners)));
      expect(expectedSurvivors(dist).toString()).toBe(expected.toString());
    }
  });

  it('reproduces the hand-derived lopsided SPLIT at five runners', () => {
    // lane of 4: P(0) = 1/10 + (9/10)(1/6)^4 = 29/288; lane of 1: P(0) = 1/4.
    const dist = survivorDistribution('SPLIT', 5, 4);
    expect(dist[0].toString()).toBe('29/1152');
    expect(dist[1].toString()).toBe('91/1152');
    expect(dist[5].toString()).toBe('125/384');
  });

  it('keeps P(all clear) invariant across lane balances but not P(wipe)', () => {
    for (let n = 2; n <= CONFIG.squadSize; n += 1) {
      const splits = laneSplitsFor('SPLIT', n);
      const clears = splits.map((k) => survivorDistribution('SPLIT', n, k)[n].toString());
      expect(new Set(clears).size).toBe(1);
      if (splits.length > 1) {
        const wipes = splits.map((k) => survivorDistribution('SPLIT', n, k)[0].toString());
        expect(new Set(wipes).size).toBe(splits.length);
      }
    }
  });

  it('places the lopsided balance on the safer side of the "almost intact" outcome', () => {
    const atLeast = (dist, floor) => dist.reduce((s, p, m) => (m >= floor ? s.add(p) : s), Frac.ZERO);
    const balanced = survivorDistribution('SPLIT', 5, 3);
    const scout = survivorDistribution('SPLIT', 5, 4);
    // The trade the route card claims: worse wipe, better "four or five".
    expect(scout[0].gt(balanced[0])).toBe(true);
    expect(atLeast(scout, 4).gt(atLeast(balanced, 4))).toBe(true);
  });

  it('computes a single lane exactly', () => {
    const dist = laneDistribution(2, F(1n, 10n), F(5n, 6n));
    // P(0) = 1/10 + (9/10)(1/36) = 1/8
    expect(dist[0].toString()).toBe('1/8');
    expect(sum([...dist]).toString()).toBe('1/1');
  });
});

describe('actions', () => {
  it('withholds BANK before the first arena', () => {
    expect(actionsFor(1, 5).some((a) => a.type === 'BANK')).toBe(false);
    expect(actionsFor(2, 5).some((a) => a.type === 'BANK')).toBe(true);
  });

  it('offers a ROUTE action per legal lane balance', () => {
    const routes = actionsFor(2, 5).filter((a) => a.type === 'ROUTE');
    expect(routes.map((a) => `${a.contract}:${a.laneSplit}`).sort()).toEqual([
      'NARROW:null',
      'SPLIT:3',
      'SPLIT:4',
      'WIDE:null',
    ]);
  });

  it('offers no actions once the squad is gone, and rejects nonsense', () => {
    expect([...actionsFor(3, 0)]).toEqual([]);
    expect(() => actionsFor(0, 5)).toThrow(ModelError);
    expect(() => actionsFor(6, 5)).toThrow(ModelError);
    expect(() => actionsFor(2, 6)).toThrow(ModelError);
    expect(() => actionsFor(2, 1.5)).toThrow(ModelError);
  });

  it('rejects an illegal lane balance through assertLegalAction', () => {
    expect(() => assertLegalAction({ type: 'ROUTE', contract: 'SPLIT', laneSplit: 3 }, 2, 5)).not.toThrow();
    expect(() => assertLegalAction({ type: 'ROUTE', contract: 'SPLIT', laneSplit: 2 }, 2, 5)).toThrow(ModelError);
    expect(() => assertLegalAction({ type: 'ROUTE', contract: 'SPLIT' }, 2, 5)).toThrow(ModelError);
    expect(() => assertLegalAction({ type: 'BANK' }, 1, 5)).toThrow(ModelError);
    expect(() => assertLegalAction({ type: 'SHELTER', shelter: 5 }, 2, 5)).toThrow(ModelError);
    expect(() => assertLegalAction(null, 2, 5)).toThrow(ModelError);
  });

  it('reports the configuration an action actually commits', () => {
    expect(committedConfiguration({ type: 'BANK' }, 5)).toBeNull();
    expect({ ...committedConfiguration({ type: 'SHELTER', shelter: 3 }, 5) }).toEqual({
      contract: 'WIDE',
      runners: 2,
      laneSplit: null,
    });
    expect({ ...committedConfiguration({ type: 'ROUTE', contract: 'SPLIT', laneSplit: 4 }, 5) }).toEqual({
      contract: 'SPLIT',
      runners: 5,
      laneSplit: 4,
    });
  });

  it('has expected total factor exactly 1 for every legal action in every state', () => {
    for (let arena = 1; arena <= CONFIG.arenas; arena += 1) {
      for (let alive = 1; alive <= CONFIG.squadSize; alive += 1) {
        for (const action of actionsFor(arena, alive)) {
          expect(actionExpectedFactor(action, alive).toString()).toBe('1/1');
          expect(sum(branches(action, alive).map((b) => b.prob)).toString()).toBe('1/1');
        }
      }
    }
  });
});

describe('side bets', () => {
  it('are withheld below the published minimum running group', () => {
    expect([...sideBetOffers('WIDE', 1)]).toEqual([]);
    expect([...sideBetOffersFor({ type: 'SHELTER', shelter: 4 }, 5)]).toEqual([]);
    expect([...sideBetOffersFor({ type: 'BANK' }, 5)]).toEqual([]);
    expect(sideBetOffersFor({ type: 'SHELTER', shelter: 3 }, 5).length).toBe(3);
  });

  it('price at exactly r / P against the committed geometry', () => {
    for (const row of sideBetTable()) {
      expect(row.rtp.toString()).toBe(CONFIG.rtp.toString());
      expect(row.probability.mul(row.multiplier).toString()).toBe(CONFIG.rtp.toString());
    }
  });

  it('price differently on different lane balances of the same contract', () => {
    const balanced = sideBetOffers('SPLIT', 5, 3).find((o) => o.bet === 'SOLE_SURVIVOR');
    const scout = sideBetOffers('SPLIT', 5, 4).find((o) => o.bet === 'SOLE_SURVIVOR');
    expect(balanced.multiplier.toString()).not.toBe(scout.multiplier.toString());
    // The lopsided balance makes a sole survivor likelier, so it must pay less.
    expect(scout.multiplier.lt(balanced.multiplier)).toBe(true);
  });

  it('read their probability out of the arena branch table they ride', () => {
    for (let arena = 1; arena <= CONFIG.arenas; arena += 1) {
      for (let alive = 1; alive <= CONFIG.squadSize; alive += 1) {
        for (const action of actionsFor(arena, alive)) {
          const config = committedConfiguration(action, alive);
          const table = branches(action, alive);
          for (const offer of sideBetOffersFor(action, alive)) {
            const spec = SIDE_BETS.find((s) => s.id === offer.bet);
            const fromBranches = table.reduce(
              (s, b) => (spec.predicate(b.survivors, config.runners) ? s.add(b.prob) : s),
              Frac.ZERO,
            );
            expect(offer.probability.toString()).toBe(fromBranches.toString());
          }
        }
      }
    }
  });

  it('publishes one row per (event, geometry) with no duplicates', () => {
    const rows = sideBetTable();
    const eligible = routeConfigurations({ minRunners: CONFIG.sideBet.minRunners });
    expect(rows.length).toBe(SIDE_BETS.length * eligible.length);
    expect(new Set(rows.map((r) => `${r.bet}@${r.key}`)).size).toBe(rows.length);
    expect([...SIDE_BET_IDS]).toEqual(['CLEAN_SWEEP', 'SOLE_SURVIVOR', 'LAST_LIGHT']);
  });

  it('never prices a zero-probability event', () => {
    for (const row of sideBetTable()) expect(row.probability.isZero()).toBe(false);
  });
});

describe('the decision-space DP', () => {
  const dp = stateValueDP();

  it('gives best value == worst value == 1 in every state', () => {
    for (const state of dp.states) {
      expect(state.max.toString()).toBe('1/1');
      expect(state.min.toString()).toBe('1/1');
      for (const { value } of state.actions) expect(value.toString()).toBe('1/1');
    }
  });

  it('sweeps the 25-state superset, not just the reachable 21', () => {
    expect(dp.states.length).toBe(CONFIG.arenas * CONFIG.squadSize);
  });

  it('bounds the route ticket at r * 4^5', () => {
    const best = maxPayoutDP();
    expect(CONFIG.rtp.mul(best[1][CONFIG.squadSize]).toString()).toBe('24448/25');
  });
});

describe('policy enumeration', () => {
  it('returns exactly the target RTP for every named policy', () => {
    for (const { fn, label } of Object.values(POLICIES)) {
      const result = enumeratePolicy(fn);
      expect(result.totalProbability.toString(), label).toBe('1/1');
      expect(result.rtp.toString(), label).toBe(CONFIG.rtp.toString());
      expect(result.mean.toString(), label).toBe(CONFIG.rtp.toString());
      expect(result.stakeDeterministic, label).toBe(true);
    }
  });

  it('returns exactly the target RTP for every portfolio of policy and side-bet plan', () => {
    for (const [policyKey, policy] of Object.entries(POLICIES)) {
      for (const [planKey, plan] of Object.entries(SIDE_BET_PLANS)) {
        const result = enumeratePolicy(policy.fn, plan.fn);
        const label = `${policyKey}+${planKey}`;
        expect(result.rtp.toString(), label).toBe(CONFIG.rtp.toString());
        expect(result.expectedCredit.toString(), label).toBe(
          CONFIG.rtp.mul(result.expectedStake).toString(),
        );
      }
    }
  });

  it('stakes a path-dependent total for an every-arena plan, and a fixed one otherwise', () => {
    const everyArena = enumeratePolicy(POLICIES.ALL_WIDE.fn, SIDE_BET_PLANS.SWEEP_EVERY_ARENA.fn);
    expect(everyArena.stakeDeterministic).toBe(false);
    expect(everyArena.expectedStake.gt(Frac.ONE)).toBe(true);
    const firstArenaOnly = enumeratePolicy(POLICIES.ALL_WIDE.fn, SIDE_BET_PLANS.MAX_SOLE_SURVIVOR.fn);
    expect(firstArenaOnly.stakeDeterministic).toBe(true);
    expect(firstArenaOnly.expectedStake.toString()).toBe('2/1');
  });

  it('changes variance when only the lane balance changes', () => {
    const balanced = enumeratePolicy(POLICIES.ALL_SPLIT.fn);
    const scout = enumeratePolicy(POLICIES.SCOUT_SPLIT.fn);
    expect(balanced.rtp.toString()).toBe(scout.rtp.toString());
    expect(balanced.variance.toString()).not.toBe(scout.variance.toString());
    expect(scout.variance.gt(balanced.variance)).toBe(true);
  });

  it('reaches zero bust probability under the shelter ladder', () => {
    const keeper = enumeratePolicy(POLICIES.SHELTER_LADDER.fn);
    expect(probabilityOfZero(keeper.distribution).toString()).toBe('0/1');
  });

  it('rejects a plan that stakes outside the published limits', () => {
    const overweight = () => [{ bet: 'CLEAN_SWEEP', weight: F(2n, 1n) }];
    expect(() => enumeratePolicy(POLICIES.ALL_WIDE.fn, overweight)).toThrow(ModelError);
    const unoffered = (_a, _b, _c, config) =>
      config.runners < 2 ? [{ bet: 'CLEAN_SWEEP', weight: F(1n, 10n) }] : [];
    expect(() => enumeratePolicy(POLICIES.ALL_WIDE.fn, unoffered)).toThrow(ModelError);
    expect(() => enumeratePolicy('not a function')).toThrow(ModelError);
  });
});

describe('the max-win cap analysis', () => {
  const report = capAnalysis();

  it('bounds every ticket strictly below the declared cap', () => {
    expect(report.routeTicketMax.toString()).toBe('24448/25');
    expect(report.sideBetMax.toString()).toBe('97792/105');
    expect(report.maxTicketMultiple.toString()).toBe('24448/25');
    expect(report.maxTicketMultiple.lt(F(CONFIG.maxWinMultiple))).toBe(true);
    expect(report.sideBetMax.toString()).toBe(largestSideBetMultiplier().toString());
  });

  it('bounds the round total strictly below the cap at both stake endpoints', () => {
    const cap = F(CONFIG.maxWinMultiple);
    expect(report.ratioNoSideBets.lt(cap)).toBe(true);
    expect(report.ratioMaxSideBets.lt(cap)).toBe(true);
    expect(report.maxRoundRatio.lt(cap)).toBe(true);
    // The round ratio is a weighted mean of ticket multiples, so it can never
    // exceed the largest ticket ceiling. That is the whole per-round argument.
    expect(report.maxRoundRatio.lte(report.maxTicketMultiple)).toBe(true);
  });

  it('keeps the stake limits coherent, which is what closes the proof', () => {
    expect(CONFIG.sideBet.maxStakeRatioPerBet.lte(CONFIG.sideBet.maxTotalStakeRatio)).toBe(true);
    expect(CONFIG.sideBet.maxTotalStakeRatio.lte(F(1n))).toBe(true);
    expect(CONFIG.sideBet.maxStakeRatioPerBet.gt(Frac.ZERO)).toBe(true);
  });

  it('confirms the v1 basis really was reachable, which is why it changed', () => {
    // Not a hypothetical: a per-round chain cap against the route stake is
    // reachable the moment side bets are in play. NARROW x5 all-clear pays
    // 977.92x and wins a Clean Sweep on every one of the five arenas.
    const cleanSweepNarrow = sideBetTable().find(
      (r) => r.bet === 'CLEAN_SWEEP' && r.contract === 'NARROW' && r.runners === 5,
    );
    const v1Total = report.routeTicketMax.add(cleanSweepNarrow.multiplier.mul(F(BigInt(CONFIG.arenas))));
    expect(v1Total.gt(F(CONFIG.maxWinMultiple))).toBe(true);
    expect(v1Total.toString()).toBe('32088/25');
  });
});

describe('configuration surface', () => {
  it('declares a game cycle that satisfies UKGC RTS 8', () => {
    expect(CONFIG.minGameCycleMs).toBeGreaterThanOrEqual(2500);
  });

  it('declares an RTP inside the mandated band', () => {
    expect(CONFIG.rtp.gte(F(94n, 100n))).toBe(true);
    expect(CONFIG.rtp.lte(F(97n, 100n))).toBe(true);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CONFIG)).toBe(true);
    expect(Object.isFrozen(CONTRACTS)).toBe(true);
    expect(Object.isFrozen(CONFIG.sideBet)).toBe(true);
    for (const id of CONTRACT_IDS) expect(Object.isFrozen(CONTRACTS[id])).toBe(true);
  });

  it('exposes the UI helpers the fork control needs', () => {
    expect(balancedSplit(5)).toBe(3);
    expect(scoutSplit(5)).toBe(4);
    expect([...laneSplitsFor('SPLIT', 5)]).toContain(balancedSplit(5));
    expect([...laneSplitsFor('SPLIT', 5)]).toContain(scoutSplit(5));
  });

  it('rejects an unknown contract', () => {
    expect(() => contract('LADDER')).toThrow(ModelError);
    expect(() => routeMultiplier('LADDER')).toThrow(ModelError);
  });
});
