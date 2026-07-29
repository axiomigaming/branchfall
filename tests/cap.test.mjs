/**
 * The max-win cap, exercised through the money path rather than argued about.
 *
 * The v1 draft proved two things (route ticket < 1000x, each side-bet multiplier
 * <= 1000x) and then declared a third (a per-round chain cap against one stake),
 * which was reachable. This file drives the actual settlement code to the
 * extremes of the paytable and asserts that nothing is ever clipped.
 *
 * The extreme lines are reached with synthetic hazard tables. That is not a
 * shortcut around the fairness model: a synthetic table is a legal table, and
 * the point is to test the *money* path at outcomes whose natural probability is
 * one in a billion.
 */

import { describe, expect, it } from 'vitest';
import { openRound, replayRound } from '../tools/transcript.mjs';
import {
  CONFIG,
  CONTRACTS,
  CONTRACT_IDS,
  capAnalysis,
  reachableRoundMaxima,
  sideBetOffers,
} from '../tools/lib/model.mjs';
import { F } from '../tools/lib/exact.mjs';

const STAKE = 1_000_000n;

/**
 * A structurally valid hazard table in which no lane collapses and every runner
 * clears. It is the best case for the player under every contract at once.
 */
function allClearHazard() {
  return Array.from({ length: CONFIG.arenas }, () => {
    const arena = {};
    for (const id of CONTRACT_IDS) {
      const spec = CONTRACTS[id];
      arena[id] = Array.from({ length: spec.laneCount }, () => ({
        collapse: Number(spec.collapse.d) - 1, // >= numerator, so the lane holds
        slips: Array.from({ length: CONFIG.squadSize }, () => 0), // < numerator, so every runner clears
      }));
    }
    return arena;
  });
}

/** No lane collapses, and exactly one nominated slot clears. */
function soleSurvivorHazard(slot) {
  const table = allClearHazard();
  for (const arena of table) {
    for (const id of CONTRACT_IDS) {
      for (const lane of arena[id]) {
        lane.slips = lane.slips.map((_, i) => (i === slot ? 0 : Number(CONTRACTS[id].clear.d) - 1));
      }
    }
  }
  return table;
}

describe('the largest route ticket the game can produce', () => {
  const round = { roundId: 'cap', clientSeed: 'cap', hazard: allClearHazard() };

  it('pays exactly the enumerated ceiling and is not capped', () => {
    const replay = replayRound(round, {
      stakeMicro: STAKE,
      actions: Array.from({ length: CONFIG.arenas }, () => ({ type: 'ROUTE', contract: 'NARROW' })),
    });
    expect(replay.finalClaim).toBe('24448/25');
    expect(replay.routeCreditedMicro).toBe(String(F(24448n, 25n).mul(F(STAKE)).floor()));
    expect(replay.capped).toBe(false);
    expect(F(BigInt(replay.creditedMicro), STAKE).toString()).toBe('24448/25');
    expect(capAnalysis().routeTicketMax.toString()).toBe('24448/25');
  });

  it('is strictly below the declared cap, so nothing is clipped', () => {
    const ceiling = STAKE * CONFIG.maxWinMultiple;
    const replay = replayRound(round, {
      stakeMicro: STAKE,
      actions: Array.from({ length: CONFIG.arenas }, () => ({ type: 'ROUTE', contract: 'NARROW' })),
    });
    expect(BigInt(replay.routeCreditedMicro)).toBeLessThan(ceiling);
  });

  it('stays uncapped even when shelter withdrawals consume the same ticket', () => {
    const replay = replayRound(round, {
      stakeMicro: STAKE,
      actions: [
        { type: 'ROUTE', contract: 'NARROW' },
        { type: 'SHELTER', shelter: [0] },
        { type: 'ROUTE', contract: 'NARROW' },
        { type: 'SHELTER', shelter: [1] },
        { type: 'ROUTE', contract: 'NARROW' },
      ],
    });
    expect(replay.capped).toBe(false);
    expect(BigInt(replay.routeCreditedMicro)).toBeLessThan(STAKE * CONFIG.maxWinMultiple);
  });
});

describe('the largest side bet the game can produce', () => {
  it('pays the full 931.35x on a maximum-stake ticket without capping', () => {
    const offer = sideBetOffers('WIDE', 5).find((o) => o.bet === 'SOLE_SURVIVOR');
    expect(offer.multiplier.toString()).toBe('97792/105');

    const replay = replayRound(
      { roundId: 'cap', clientSeed: 'cap', hazard: soleSurvivorHazard(2) },
      {
        stakeMicro: STAKE,
        // The side stake is at the published ceiling: equal to the route stake.
        actions: [{ type: 'ROUTE', contract: 'WIDE', sideBets: [{ bet: 'SOLE_SURVIVOR', stakeMicro: STAKE }] }],
      },
    );

    const entry = replay.sideLedger[0];
    expect(entry.won).toBe(true);
    expect(BigInt(entry.creditedMicro)).toBe(offer.multiplier.mul(F(STAKE)).floor());
    expect(BigInt(entry.creditedMicro)).toBeLessThan(STAKE * CONFIG.maxWinMultiple);
    expect(replay.capped).toBe(false);
  });
});

describe('the round total', () => {
  it('never exceeds the cap times the total round stake, at the extreme', () => {
    // Route ticket at its ceiling (NARROW x5 all clear) with a winning Clean
    // Sweep at the maximum legal stake on the first arena. Under the v1 basis
    // this round was over the cap; under the per-ticket basis it is not.
    const round = { roundId: 'cap', clientSeed: 'cap', hazard: allClearHazard() };
    const replay = replayRound(round, {
      stakeMicro: STAKE,
      actions: [
        { type: 'ROUTE', contract: 'NARROW', sideBets: [{ bet: 'CLEAN_SWEEP', stakeMicro: STAKE }] },
        { type: 'ROUTE', contract: 'NARROW' },
        { type: 'ROUTE', contract: 'NARROW' },
        { type: 'ROUTE', contract: 'NARROW' },
        { type: 'ROUTE', contract: 'NARROW' },
      ],
    });

    expect(replay.capped).toBe(false);
    expect(replay.sideLedger[0].won).toBe(true);

    const credited = BigInt(replay.creditedMicro);
    const staked = BigInt(replay.totalStakeMicro);
    expect(staked).toBe(2n * STAKE);

    // The binding statement: the round total, per unit of TOTAL round stake, is
    // under the cap — and under the per-ticket ceiling, as the weighted-mean
    // bound in docs/MATH.md §9.3 requires.
    const ratio = F(credited, staked);
    expect(ratio.lt(F(CONFIG.maxWinMultiple))).toBe(true);
    expect(ratio.lte(capAnalysis().maxTicketMultiple)).toBe(true);

    // And it exceeds what the route ticket alone would be capped at under a
    // naive single-basis reading — which is precisely why the basis matters.
    expect(credited).toBeGreaterThan(BigInt(replay.routeCreditedMicro));
  });

  it('is under the cap for the fixture round too', () => {
    const round = openRound(
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      'wren-bramble-ora-tuck-sable-74',
      'branchfall-fixture-0002',
    );
    const replay = replayRound(round, {
      stakeMicro: 10_000_000n,
      actions: [
        { type: 'ROUTE', contract: 'SPLIT', laneSplit: 4, sideBets: [{ bet: 'CLEAN_SWEEP', stakeMicro: 2_000_000n }] },
        { type: 'ROUTE', contract: 'WIDE' },
        { type: 'SHELTER', shelter: [0], sideBets: [{ bet: 'LAST_LIGHT', stakeMicro: 1_000_000n }] },
        { type: 'ROUTE', contract: 'NARROW', sideBets: [{ bet: 'SOLE_SURVIVOR', stakeMicro: 1_000_000n }] },
        { type: 'BANK' },
      ],
    });
    expect(replay.capped).toBe(false);
    expect(F(BigInt(replay.creditedMicro), BigInt(replay.totalStakeMicro)).lt(F(CONFIG.maxWinMultiple))).toBe(
      true,
    );
  });
});

describe('rounding at every credit event', () => {
  it('never loses more than one micro-credit per credit event', () => {
    const round = { roundId: 'cap', clientSeed: 'cap', hazard: allClearHazard() };
    // Four shelter withdrawals plus a settlement: the maximum number of credit
    // events a route ticket can have.
    const replay = replayRound(round, {
      stakeMicro: CONFIG.minStakeMicro,
      actions: [
        { type: 'SHELTER', shelter: [0] },
        { type: 'SHELTER', shelter: [1] },
        { type: 'SHELTER', shelter: [2] },
        { type: 'SHELTER', shelter: [3] },
        { type: 'ROUTE', contract: 'WIDE' },
      ],
    });
    // Independent derivation of the unrounded value of that exact line.
    // c_0 = r; each SHELTER of one from n banks c/n and carries c(n-1)/n, and an
    // all-clear WIDE arena multiplies the carried claim by mu. Unrolling:
    //   banked = r/5 (1 + mu + mu^2 + mu^3),  final = r/5 * mu^5
    const mu = F(25n, 21n);
    const theoretical = CONFIG.rtp
      .mul(F(1n, 5n))
      .mul(F(1n).add(mu).add(mu.pow(2)).add(mu.pow(3)).add(mu.pow(5)))
      .mul(F(CONFIG.minStakeMicro));
    const loss = theoretical.sub(F(BigInt(replay.routeCreditedMicro)));
    expect(loss.gte(F(0n))).toBe(true);
    expect(loss.lt(F(BigInt(CONFIG.arenas)))).toBe(true);
  });
});

describe('the exhaustive reachable-maximum search', () => {
  const reachable = reachableRoundMaxima();

  it('walks the whole non-zero-probability action space', () => {
    expect(reachable.paths).toBeGreaterThan(200_000);
  });

  it('agrees with the backward induction on the route-ticket ceiling', () => {
    // Two different algorithms over the same state space. Agreement is evidence
    // that neither has a bug the other shares.
    expect(reachable.routeTicketMax.toString()).toBe(capAnalysis().routeTicketMax.toString());
    expect(reachable.routeTicketMax.toString()).toBe('24448/25');
    expect([...reachable.routeTicketLine]).toEqual([
      'NARROW->5',
      'NARROW->5',
      'NARROW->5',
      'NARROW->5',
      'NARROW->5',
    ]);
  });

  it('stays inside the weighted-mean bound and under the cap', () => {
    expect(reachable.roundRatioMax.lte(capAnalysis().maxRoundRatio)).toBe(true);
    expect(reachable.roundRatioMax.lt(F(CONFIG.maxWinMultiple))).toBe(true);
    expect(reachable.roundTotalPerRouteStakeMax.lte(capAnalysis().maxRoundTotalPerRouteStake)).toBe(true);
  });

  it('finds a round that pays over 1000x of the ROUTE stake, which is why the basis matters', () => {
    // 977.92x route ticket plus a Clean Sweep winning on all five NARROW arenas.
    expect(reachable.roundTotalPerRouteStakeMax.toString()).toBe('25976/25');
    expect(reachable.roundTotalPerRouteStakeMax.gt(F(CONFIG.maxWinMultiple))).toBe(true);
    // ... and yet nothing is capped, because it staked 2x the route stake for it
    // and no ticket came near its own ceiling.
    expect(reachable.roundRatioMax.lt(F(CONFIG.maxWinMultiple))).toBe(true);
  });
});
