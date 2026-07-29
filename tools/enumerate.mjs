#!/usr/bin/env node
/**
 * BRANCHFALL — exact outcome enumerator.
 *
 * This script is the proof. It enumerates the complete outcome space of the
 * game with exact BigInt rational arithmetic and prints, as exact fractions:
 *
 *   1. every route contract's hazard parameters and route multiplier;
 *   2. every route GEOMETRY — including the lane balances the player chooses
 *      on a SPLIT — with its exact shape metrics;
 *   3. every (geometry, survivor count) outcome — exact probability and exact
 *      claim multiplier;
 *   4. every side bet against every geometry — exact probability, multiplier
 *      and RTP — and the proof that pricing is bound to the committed
 *      configuration rather than to a contract id;
 *   5. a backward-induction sweep of the entire decision space showing that the
 *      best and the worst policy have identical value in every reachable state;
 *   6. the full outcome space of a set of named policies, with exact RTP,
 *      variance and tail probabilities;
 *   7. the full outcome space of PORTFOLIOS — a route policy plus a side-bet
 *      plan — proving `E[credited] / E[staked] = r` exactly for each one;
 *   8. the max-win cap analysis, per ticket AND over the round total.
 *
 * Every claim printed here is asserted. A violated invariant exits non-zero.
 *
 * Usage:
 *   node tools/enumerate.mjs               full human-readable report
 *   node tools/enumerate.mjs --markdown    emit the docs/MATH.md tables
 *   node tools/enumerate.mjs --figures     emit the inline doc figures
 *   node tools/enumerate.mjs --json        emit machine-readable results
 *   node tools/enumerate.mjs --quiet       assertions only (exit code is the answer)
 */

import { F, Frac, sqrtFixed, toFixedExact } from './lib/exact.mjs';
import {
  CONFIG,
  CONTRACTS,
  CONTRACT_IDS,
  SIDE_BETS,
  SIDE_BET_PLANS,
  actionExpectedFactor,
  actionsFor,
  branches,
  breakEvenSurvivors,
  capAnalysis,
  claimFactorDistribution,
  claimMovement,
  claimMovementRows,
  committedConfiguration,
  configKey,
  distributionMean,
  dominanceRows,
  enumeratePolicy,
  laneSizes,
  laneSplitsFor,
  largestSideBetMultiplier,
  marginalSurvival,
  POLICIES,
  probabilityAtLeast,
  probabilityOfZero,
  reachableRoundMaxima,
  routeConfigurations,
  routeMultiplier,
  secondOrderCompare,
  sideBetOffersFor,
  sideBetTable,
  stateValueDP,
  survivorDistribution,
} from './lib/model.mjs';

/* ------------------------------------------------------------------ *
 * assertion harness
 * ------------------------------------------------------------------ */

const failures = [];
const checks = [];

/** @param {boolean} condition @param {string} description */
function check(condition, description) {
  checks.push({ description, ok: Boolean(condition) });
  if (!condition) failures.push(description);
  return Boolean(condition);
}

/** @param {Frac} actual @param {Frac} expected @param {string} description */
function checkEqual(actual, expected, description) {
  return check(actual.eq(expected), `${description} (expected ${expected}, got ${actual})`);
}

/* ------------------------------------------------------------------ *
 * formatting helpers
 * ------------------------------------------------------------------ */

const PROB_PLACES = 12;
const MULT_PLACES = 8;

/** @param {Frac} f @param {number} places */
const pct = (f, places = 2) => `${toFixedExact(f.mul(F(100n)), places)}%`;
/** @param {Frac} f @param {number} places */
const mult = (f, places = 3) => `${toFixedExact(f, places)}x`;
/** @param {bigint} value */
const grouped = (value) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
/** @param {number|null} laneSplit @param {number} runners */
const geometryLabel = (laneSplit, runners) => (laneSplit === null ? `${runners}` : `${laneSplit}+${runners - laneSplit}`);

/** @param {Frac[]} dist */
function expectedSurvivors(dist) {
  return dist.reduce((s, p, m) => s.add(p.mul(F(BigInt(m)))), Frac.ZERO);
}

/** @param {Frac[]} dist @param {number} floorCount */
function probabilityOfAtLeast(dist, floorCount) {
  return dist.reduce((s, p, m) => (m >= floorCount ? s.add(p) : s), Frac.ZERO);
}

/* ------------------------------------------------------------------ *
 * derived quantities
 * ------------------------------------------------------------------ */

/** Contract-level rows. */
export function contractRows() {
  return CONTRACT_IDS.map((id) => {
    const spec = CONTRACTS[id];
    return {
      id,
      laneCount: spec.laneCount,
      minRunners: spec.minRunners,
      collapse: spec.collapse,
      clear: spec.clear,
      marginal: marginalSurvival(id),
      multiplier: routeMultiplier(id),
    };
  });
}

/**
 * Every route geometry the game can present: contract x running group x lane
 * balance. This is the unit everything else is indexed by.
 */
export function geometryRows() {
  return routeConfigurations().map((config) => {
    const dist = survivorDistribution(config.contract, config.runners, config.laneSplit);
    return {
      ...config,
      choices: laneSplitsFor(config.contract, config.runners).length,
      wipe: dist[0],
      cleanSweep: dist[config.runners],
      soleSurvivor: config.runners >= 1 ? dist[1] : Frac.ZERO,
      expectedSurvivors: expectedSurvivors(dist),
      fairness: dist.reduce(
        (s, p, m) => s.add(p.mul(F(BigInt(m), BigInt(config.runners))).mul(routeMultiplier(config.contract))),
        Frac.ZERO,
      ),
      total: dist.reduce((s, p) => s.add(p), Frac.ZERO),
    };
  });
}

/** Every (geometry, survivors) outcome with probability and claim multiplier. */
export function outcomeRows() {
  const rows = [];
  for (const config of routeConfigurations()) {
    const dist = survivorDistribution(config.contract, config.runners, config.laneSplit);
    const mu = routeMultiplier(config.contract);
    for (let m = 0; m <= config.runners; m += 1) {
      rows.push({
        contract: config.contract,
        runners: config.runners,
        laneSplit: config.laneSplit,
        lanes: config.lanes,
        survivors: m,
        probability: dist[m],
        claimMultiplier: F(BigInt(m), BigInt(config.runners)).mul(mu),
      });
    }
  }
  return rows;
}

/** Full outcome space of every named policy, route ticket only. */
export function policyRows() {
  return Object.entries(POLICIES).map(([key, { label, fn }]) => {
    const result = enumeratePolicy(fn);
    return {
      key,
      label,
      leaves: result.leaves,
      distinctOutcomes: result.distribution.length,
      totalProbability: result.totalProbability,
      rtp: result.rtp,
      mean: result.mean,
      stakeDeterministic: result.stakeDeterministic,
      variance: result.variance,
      bust: probabilityOfZero(result.distribution),
      atLeast1: probabilityAtLeast(result.distribution, F(1n)),
      atLeast10: probabilityAtLeast(result.distribution, F(10n)),
      atLeast100: probabilityAtLeast(result.distribution, F(100n)),
      maxReturn: result.maxReturn,
      maxReturnProbability: result.distribution.reduce(
        (acc, o) => (o.value.eq(result.maxReturn) ? o.prob : acc),
        Frac.ZERO,
      ),
    };
  });
}

/**
 * Every (route policy, side-bet plan) portfolio. This is the table that makes
 * the "no policy beats the target RTP" claim cover side bets, which the v1
 * draft asserted without having them in its state space.
 */
export function portfolioRows(policyKeys = Object.keys(POLICIES)) {
  const rows = [];
  for (const policyKey of policyKeys) {
    const policy = POLICIES[policyKey];
    for (const [planKey, plan] of Object.entries(SIDE_BET_PLANS)) {
      const result = enumeratePolicy(policy.fn, plan.fn);
      rows.push({
        policyKey,
        planKey,
        policy: policy.label,
        plan: plan.label,
        leaves: result.leaves,
        expectedStake: result.expectedStake,
        expectedCredit: result.expectedCredit,
        rtp: result.rtp,
        stakeDeterministic: result.stakeDeterministic,
        variance: result.variance,
        bust: probabilityOfZero(result.distribution),
        maxReturn: result.maxReturn,
      });
    }
  }
  return rows;
}

/** Exact ceiling on credited payout for the route ticket, over all policies and paths. */
export function maxPayoutMultiple() {
  return capAnalysis().routeTicketMax;
}

/* ------------------------------------------------------------------ *
 * invariants — the actual proof obligations
 * ------------------------------------------------------------------ */

export function runInvariants() {
  failures.length = 0;
  checks.length = 0;

  const configs = routeConfigurations();

  // 1. Lane geometry is well formed: sizes sum to the group, one entry per lane,
  //    canonical (lead lane never smaller than the trailing lane), and the set of
  //    legal balances is exactly what the action list offers.
  for (const config of configs) {
    const sizes = laneSizes(config.contract, config.runners, config.laneSplit);
    check(
      sizes.length === CONTRACTS[config.contract].laneCount,
      `${config.key}: lane count is ${CONTRACTS[config.contract].laneCount}`,
    );
    check(
      sizes.reduce((a, b) => a + b, 0) === config.runners,
      `${config.key}: lane sizes sum to the running group`,
    );
    check(sizes.every((s) => s >= 1), `${config.key}: every lane carries at least one runner`);
    check(
      sizes[0] >= sizes[sizes.length - 1],
      `${config.key}: lane balance is canonical (lead lane is the larger half)`,
    );
  }

  // 2. Every survivor distribution is a probability distribution.
  for (const row of geometryRows()) {
    checkEqual(row.total, Frac.ONE, `${row.key}: probabilities sum to 1`);
  }

  // 3. Marginal per-runner survival matches the declared (1 - c) * q for every
  //    geometry — including every lane balance. This is what makes the lane
  //    balance a shape choice and not an odds choice.
  for (const config of configs) {
    const p = marginalSurvival(config.contract);
    const dist = survivorDistribution(config.contract, config.runners, config.laneSplit);
    checkEqual(
      expectedSurvivors(dist),
      p.mul(F(BigInt(config.runners))),
      `${config.key}: E[survivors] = n * p`,
    );
  }

  // 4. Route multiplier is exactly 1 / p, so a stage is a fair bet on the carried claim.
  for (const id of CONTRACT_IDS) {
    checkEqual(
      marginalSurvival(id).mul(routeMultiplier(id)),
      Frac.ONE,
      `${id}: route multiplier is the reciprocal of marginal survival`,
    );
  }

  // 5. P(all clear) depends only on the lane COUNT, never on the balance:
  //    it is (1-c)^lanes * q^n. Published in DESIGN.md §3.3 — bound here.
  for (let n = CONTRACTS.SPLIT.minRunners; n <= CONFIG.squadSize; n += 1) {
    const splits = laneSplitsFor('SPLIT', n);
    const first = survivorDistribution('SPLIT', n, splits[0])[n];
    for (const k of splits) {
      checkEqual(
        survivorDistribution('SPLIT', n, k)[n],
        first,
        `SPLIT/${n}: P(all clear) is identical across lane balances`,
      );
    }
  }

  // 6. Stage neutrality: every legal action has expected total factor exactly 1.
  for (let arena = 1; arena <= CONFIG.arenas; arena += 1) {
    for (let alive = 1; alive <= CONFIG.squadSize; alive += 1) {
      for (const action of actionsFor(arena, alive)) {
        checkEqual(
          actionExpectedFactor(action, alive),
          Frac.ONE,
          `arena ${arena}, ${alive} alive, ${JSON.stringify(action)}: expected factor is 1`,
        );
      }
    }
  }

  // 7. Branch tables are themselves probability distributions.
  for (let alive = 1; alive <= CONFIG.squadSize; alive += 1) {
    for (const action of actionsFor(2, alive)) {
      const total = branches(action, alive).reduce((s, b) => s.add(b.prob), Frac.ZERO);
      checkEqual(total, Frac.ONE, `${alive} alive, ${JSON.stringify(action)}: branch probabilities sum to 1`);
    }
  }

  // 8. Backward induction: best policy value == worst policy value == 1 everywhere.
  const dp = stateValueDP();
  for (const state of dp.states) {
    checkEqual(state.max, Frac.ONE, `state (arena ${state.arena}, ${state.alive} alive): optimal value is 1`);
    checkEqual(state.min, Frac.ONE, `state (arena ${state.arena}, ${state.alive} alive): pessimal value is 1`);
    for (const { action, value } of state.actions) {
      checkEqual(
        value,
        Frac.ONE,
        `state (arena ${state.arena}, ${state.alive} alive) action ${JSON.stringify(action)}: value is 1`,
      );
    }
  }

  // 9. Every named policy returns exactly the target RTP over its full outcome space.
  const cap = F(CONFIG.maxWinMultiple);
  for (const row of policyRows()) {
    checkEqual(row.totalProbability, Frac.ONE, `${row.label}: outcome space probabilities sum to 1`);
    checkEqual(row.rtp, CONFIG.rtp, `${row.label}: RTP is exactly the target`);
    check(row.stakeDeterministic, `${row.label}: the route ticket stakes a deterministic total`);
    checkEqual(row.mean, CONFIG.rtp, `${row.label}: mean return multiple equals the RTP`);
    check(row.maxReturn.lt(cap), `${row.label}: max return is strictly within the cap`);
  }

  // 10. Side-bet pricing is exactly r / P, and it is bound to the configuration
  //     the action actually commits — not to a contract id. An offer whose
  //     probability disagrees with the branch table it rides on fails here.
  for (let arena = 1; arena <= CONFIG.arenas; arena += 1) {
    for (let alive = 1; alive <= CONFIG.squadSize; alive += 1) {
      for (const action of actionsFor(arena, alive)) {
        const config = committedConfiguration(action, alive);
        const offers = sideBetOffersFor(action, alive);
        if (!config || config.runners < CONFIG.sideBet.minRunners) {
          check(
            offers.length === 0,
            `arena ${arena}, ${alive} alive, ${JSON.stringify(action)}: no side bets below ${CONFIG.sideBet.minRunners} runners`,
          );
          continue;
        }
        check(
          offers.length === SIDE_BETS.length,
          `arena ${arena}, ${alive} alive, ${JSON.stringify(action)}: all three side bets offered`,
        );
        const table = branches(action, alive);
        for (const offer of offers) {
          const spec = SIDE_BETS.find((s) => s.id === offer.bet);
          const fromBranches = table.reduce(
            (s, b) => (spec.predicate(b.survivors, config.runners) ? s.add(b.prob) : s),
            Frac.ZERO,
          );
          checkEqual(
            offer.probability,
            fromBranches,
            `${JSON.stringify(action)} @${alive}: ${offer.bet} probability matches the arena's own branch table`,
          );
          checkEqual(
            offer.probability.mul(offer.multiplier),
            CONFIG.rtp,
            `${JSON.stringify(action)} @${alive}: ${offer.bet} is priced at exactly r / P`,
          );
        }
      }
    }
  }

  // 11. The published side-bet paytable covers every geometry, once each.
  const published = sideBetTable();
  const expectedRows = SIDE_BETS.length * routeConfigurations({ minRunners: CONFIG.sideBet.minRunners }).length;
  check(published.length === expectedRows, `side-bet paytable has exactly ${expectedRows} rows`);
  const seen = new Set();
  for (const row of published) {
    const id = `${row.bet}@${row.key}`;
    check(!seen.has(id), `side-bet paytable row ${id} appears once`);
    seen.add(id);
    checkEqual(row.rtp, CONFIG.rtp, `side bet ${id}: RTP is exact`);
    check(row.multiplier.lt(cap), `side bet ${id}: multiplier ${row.multiplier} is strictly within the cap`);
    checkEqual(
      row.probability,
      survivorDistribution(row.contract, row.runners, row.laneSplit)[
        row.bet === 'CLEAN_SWEEP' ? row.runners : row.bet === 'SOLE_SURVIVOR' ? 1 : 0
      ],
      `side bet ${id}: probability reads out of the geometry's own distribution`,
    );
  }

  // 12. PORTFOLIOS. Every route policy combined with every side-bet plan returns
  //     E[credited] / E[staked] = r exactly. This is the statement DESIGN.md and
  //     the README make, and it now covers side bets rather than stopping at the
  //     route ticket.
  for (const row of portfolioRows()) {
    checkEqual(
      row.rtp,
      CONFIG.rtp,
      `portfolio ${row.policyKey} + ${row.planKey}: E[credited]/E[staked] is exactly the target RTP`,
    );
    check(
      row.maxReturn.lt(cap),
      `portfolio ${row.policyKey} + ${row.planKey}: max return ${row.maxReturn} is strictly within the cap`,
    );
    check(
      row.expectedStake.gte(Frac.ONE),
      `portfolio ${row.policyKey} + ${row.planKey}: expected stake includes the route ticket`,
    );
  }

  // 13. Target RTP sits inside the published 94%-97% band.
  check(CONFIG.rtp.gte(F(94n, 100n)) && CONFIG.rtp.lte(F(97n, 100n)), 'target RTP is within [94%, 97%]');

  // 14. MAX-WIN CAP, correctly scoped.
  //     (a) no ticket can pay more than the cap times its own stake;
  //     (b) no round can pay more than the cap times the round's total stake.
  const capReport = capAnalysis();
  check(
    capReport.routeTicketMax.lt(cap),
    `route ticket ceiling ${capReport.routeTicketMax} is strictly below the cap ${cap}`,
  );
  check(
    capReport.sideBetMax.lt(cap),
    `largest side-bet multiplier ${capReport.sideBetMax} is strictly below the cap ${cap}`,
  );
  check(
    capReport.maxTicketMultiple.lt(cap),
    `per-ticket ceiling ${capReport.maxTicketMultiple} is strictly below the cap ${cap}`,
  );
  check(
    capReport.ratioNoSideBets.lt(cap),
    `round total with no side bets, ${capReport.ratioNoSideBets} of total stake, is below the cap`,
  );
  check(
    capReport.ratioMaxSideBets.lt(cap),
    `round total at the maximum legal side-bet stake, ${capReport.ratioMaxSideBets} of total stake, is below the cap`,
  );
  check(
    capReport.maxRoundRatio.lte(capReport.maxTicketMultiple),
    'round total per unit of total stake never exceeds the per-ticket ceiling (weighted-mean bound)',
  );
  check(
    capReport.maxRoundRatio.lt(cap),
    `max round total ${capReport.maxRoundRatio} of total stake is strictly below the cap ${cap}`,
  );

  //     (c) and the bound is not the only evidence: an exhaustive walk over every
  //     action sequence with non-zero probability finds the round that actually
  //     pays the most, under the stake allocation that maximises it.
  const reachable = reachableRoundMaxima();
  checkEqual(
    reachable.routeTicketMax,
    capReport.routeTicketMax,
    'exhaustive path walk agrees with the backward induction on the route-ticket ceiling',
  );
  check(
    reachable.roundRatioMax.lte(capReport.maxRoundRatio),
    `reachable round ratio ${reachable.roundRatioMax} is within the weighted-mean bound ${capReport.maxRoundRatio}`,
  );
  check(
    reachable.roundRatioMax.lt(cap),
    `reachable max round total ${reachable.roundRatioMax} of total stake is strictly below the cap ${cap}`,
  );
  check(
    reachable.roundTotalPerRouteStakeMax.lte(capReport.maxRoundTotalPerRouteStake),
    'reachable round total in route stakes is within the published upper bound',
  );
  check(reachable.paths > 100000, `the cap search walked ${reachable.paths} terminal paths`);

  // 15. The published stake limits are coherent: a single bet may not exceed the
  //     round-wide allowance, and the allowance is finite and positive.
  check(
    CONFIG.sideBet.maxStakeRatioPerBet.gt(Frac.ZERO),
    'the per-bet side-bet stake limit is strictly positive',
  );
  check(
    CONFIG.sideBet.maxStakeRatioPerBet.lte(CONFIG.sideBet.maxTotalStakeRatio),
    'a single side bet cannot exceed the round-wide side-bet allowance',
  );
  check(
    CONFIG.sideBet.maxTotalStakeRatio.lte(F(1n)),
    'side bets can never carry more money than the route ticket they ride on',
  );

  // 16. Speed of play. UKGC RTS 14G is 5000 ms for casino games other than slots
  //     and peer-to-peer poker; RTS 14D's 2500 ms is the SLOTS rule and RTS 8 is
  //     the autoplay prohibition. BRANCHFALL is not reel-based, so it builds to
  //     the longer floor rather than assuming a classification in its own favour.
  check(
    CONFIG.minGameCycleMs >= 5000,
    `minimum game cycle ${CONFIG.minGameCycleMs} ms is at least 5000 ms (UKGC RTS 14G, non-slot)`,
  );
  check(
    CONFIG.minGameCycleMs >= 2500,
    'minimum game cycle also satisfies the slots floor (UKGC RTS 14D) if the game were ever classified as one',
  );

  // 17. WHERE THE CLAIM TURNS. The break-even survivor count is the number that
  //     makes the money rule legible, it varies by contract and squad size, and
  //     the route card carried none of it. Published in DESIGN.md §3.2 and
  //     MATH.md §5.2.1 — so it is computed here rather than reasoned about.
  for (const row of claimMovementRows()) {
    const mu = routeMultiplier(row.contract);
    const factorAt = (m) => F(BigInt(m), BigInt(row.runners)).mul(mu);
    check(
      row.breakEven >= 1 && row.breakEven <= row.runners,
      `${row.key}: break-even survivor count ${row.breakEven} is a legal survivor count`,
    );
    check(
      factorAt(row.breakEven).gte(Frac.ONE),
      `${row.key}: the claim holds or grows at ${row.breakEven} survivors`,
    );
    check(
      factorAt(row.breakEven - 1).lt(Frac.ONE),
      `${row.key}: the claim falls at ${row.breakEven - 1} survivors, so the break-even is the smallest one`,
    );
    checkEqual(
      row.rises.add(row.holds).add(row.fallsNonZero).add(row.wipe),
      Frac.ONE,
      `${row.key}: grows / holds / falls / wipes partition the outcome space`,
    );
    checkEqual(row.breakEvenFactor, factorAt(row.breakEven), `${row.key}: break-even claim factor is exact`);
    checkEqual(
      row.atLeastHolds,
      probabilityOfAtLeast(survivorDistribution(row.contract, row.runners, row.laneSplit), row.breakEven),
      `${row.key}: P(claim does not fall) is P(m >= break-even)`,
    );
  }

  //     Two published statements about how the break-even behaves, which are the
  //     reason the card cannot reuse an existing field for it.
  for (let n = 1; n <= CONFIG.squadSize; n += 1) {
    check(
      breakEvenSurvivors('WIDE', n) === n,
      `WIDE/${n}: the claim only grows when the whole running group clears`,
    );
    checkEqual(
      claimMovement('WIDE', n).rises,
      survivorDistribution('WIDE', n)[n],
      `WIDE/${n}: P(claim grows) coincides with P(all clear) — and only on WIDE`,
    );
  }
  for (const [id, n, laneSplit] of [
    ['SPLIT', 5, 3],
    ['SPLIT', 5, 4],
    ['NARROW', 5, null],
  ]) {
    check(
      !claimMovement(id, n, laneSplit).rises.eq(survivorDistribution(id, n, laneSplit)[n]),
      `${configKey(id, n, laneSplit)}: P(claim grows) is NOT P(all clear), so the two fields are different fields`,
    );
  }

  // 18. DOMINANCE — which choices are trades and which are volatility dials.
  //     The v2 draft asserted in prose that neither SPLIT balance dominates the
  //     other. That was false: the lopsided fork is an exact mean-preserving
  //     spread of the balanced one, so the balanced fork is preferred by every
  //     risk-averse reading. The claim is now computed, published as a table,
  //     and bound here — including the part that survived, which is that WIDE
  //     and SPLIT genuinely cross at every squad size.
  //
  //     Equal means make second-order dominance the standard reading; the
  //     comparison is over the exact claim-factor distribution of one arena.
  for (const config of configs) {
    checkEqual(
      distributionMean(claimFactorDistribution(config.contract, config.runners, config.laneSplit)),
      Frac.ONE,
      `${config.key}: the claim-factor distribution has mean exactly 1`,
    );
  }

  /**
   * The published lattice, as a rule rather than as a list: a SPLIT's balanced
   * geometry dominates its lopsided one, WIDE and SPLIT cross, and NARROW is
   * dominated by everything. `routeConfigurations()` orders WIDE, SPLIT (lead
   * lane ascending, so balanced first), NARROW.
   */
  const expectedRelation = (a, b) => {
    if (a.contract === b.contract) return a.laneSplit < b.laneSplit ? 'A' : 'B';
    if (a.contract === 'NARROW') return 'B';
    if (b.contract === 'NARROW') return 'A';
    return 'CROSSES';
  };
  const mirror = { A: 'B', B: 'A', CROSSES: 'CROSSES', IDENTICAL: 'IDENTICAL' };
  for (const row of dominanceRows()) {
    check(
      row.relation === expectedRelation(row.aConfig, row.bConfig),
      `${row.a} vs ${row.b}: second-order relation is ${expectedRelation(row.aConfig, row.bConfig)} (got ${row.relation})`,
    );
    const a = claimFactorDistribution(row.aConfig.contract, row.aConfig.runners, row.aConfig.laneSplit);
    const b = claimFactorDistribution(row.bConfig.contract, row.bConfig.runners, row.bConfig.laneSplit);
    check(
      secondOrderCompare(b, a) === mirror[row.relation],
      `${row.a} vs ${row.b}: the comparison is antisymmetric`,
    );
  }

  //     And the composed statement, because "take the lopsided fork only on the
  //     last arena" would otherwise be an untested escape hatch: over a whole
  //     five-arena run, the balanced policy dominates the lopsided one too.
  check(
    secondOrderCompare(
      enumeratePolicy(POLICIES.ALL_SPLIT.fn).distribution,
      enumeratePolicy(POLICIES.SCOUT_SPLIT.fn).distribution,
    ) === 'A',
    'over a whole run, the balanced fork policy second-order dominates the lopsided one',
  );

  return { checks: [...checks], failures: [...failures] };
}

/* ------------------------------------------------------------------ *
 * markdown tables (the published paytable in docs/MATH.md)
 * ------------------------------------------------------------------ */

function table(header, rows) {
  const head = `| ${header.join(' | ')} |`;
  const rule = `| ${header.map(() => '---').join(' | ')} |`;
  return [head, rule, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

export function buildTables() {
  const capReport = capAnalysis();

  const contracts = table(
    ['Contract', 'Lanes', 'Min runners', 'Lane collapse `c`', 'Per-runner clear `q`', 'Marginal survival `p`', 'Route multiplier `mu`', '`mu` decimal'],
    contractRows().map((r) => [
      r.id,
      String(r.laneCount),
      String(r.minRunners),
      `\`${r.collapse}\``,
      `\`${r.clear}\``,
      `\`${r.marginal}\``,
      `\`${r.multiplier}\``,
      toFixedExact(r.multiplier, MULT_PLACES),
    ]),
  );

  // The wipe comparison in docs/MATH.md §3.1 — the number a player feels.
  // Generated rather than hand-written: it is the headline claim of the design.
  const wipes = table(
    ['Runners `n`', 'WIDE', 'SPLIT (balanced)', 'SPLIT (lopsided)', 'NARROW', 'Safer route'],
    [2, 3, 4, 5].map((n) => {
      const splits = laneSplitsFor('SPLIT', n);
      const wide = survivorDistribution('WIDE', n)[0];
      const balanced = survivorDistribution('SPLIT', n, splits[0])[0];
      const lopsided = survivorDistribution('SPLIT', n, splits[splits.length - 1])[0];
      return [
        String(n),
        toFixedExact(wide, 6),
        `**${toFixedExact(balanced, 6)}**`,
        splits.length > 1 ? toFixedExact(lopsided, 6) : '—',
        toFixedExact(survivorDistribution('NARROW', n)[0], 6),
        balanced.lt(wide) ? 'SPLIT' : 'WIDE',
      ];
    }),
  );

  // Where the claim turns: the number the route card was missing.
  const breakeven = table(
    [
      'Contract',
      'Runners `n`',
      'Lane balance',
      'Claim holds or grows at',
      'Claim factor there',
      'P(claim grows)',
      'P(claim holds)',
      'P(claim falls, above zero)',
      'P(total wipe)',
    ],
    claimMovementRows().map((r) => [
      r.contract,
      String(r.runners),
      geometryLabel(r.laneSplit, r.runners),
      `**${r.breakEven}** of ${r.runners}`,
      `\`${r.breakEvenFactor}\``,
      pct(r.rises),
      pct(r.holds),
      pct(r.fallsNonZero),
      pct(r.wipe),
    ]),
  );

  // Which of the choices offered at one squad size is a genuine trade and which
  // is a pure volatility dial. Generated, because the v2 draft asserted it in
  // prose and the assertion was false for the fork balance.
  const dominance = table(
    ['Runners `n`', 'A', 'B', 'Second-order relation', 'What that makes the choice'],
    dominanceRows().map((r) => {
      const label = (c) => (c.laneSplit === null ? c.contract : `${c.contract} ${geometryLabel(c.laneSplit, c.runners)}`);
      const preferred = r.preferred === null ? null : r.preferred === r.a ? label(r.aConfig) : label(r.bConfig);
      return [
        String(r.runners),
        label(r.aConfig),
        label(r.bConfig),
        preferred === null ? '**neither** — integrated CDFs cross' : `**${preferred}** dominates`,
        preferred === null
          ? 'a genuine trade: no risk-averse reading prefers one'
          : 'a volatility dial: the other side is a mean-preserving spread',
      ];
    }),
  );

  const geometries = table(
    ['Contract', 'Runners `n`', 'Lane balance', 'Balances offered', 'P(total wipe)', 'P(all clear)', 'P(exactly one)', 'E[survivors]', 'Stage RTP'],
    geometryRows().map((r) => [
      r.contract,
      String(r.runners),
      geometryLabel(r.laneSplit, r.runners),
      String(r.choices),
      `\`${r.wipe}\` = ${toFixedExact(r.wipe, PROB_PLACES)}`,
      `\`${r.cleanSweep}\` = ${toFixedExact(r.cleanSweep, PROB_PLACES)}`,
      `\`${r.soleSurvivor}\` = ${toFixedExact(r.soleSurvivor, PROB_PLACES)}`,
      `\`${r.expectedSurvivors}\` = ${toFixedExact(r.expectedSurvivors, 6)}`,
      `\`${r.fairness}\``,
    ]),
  );

  const outcomes = table(
    ['Contract', 'Runners `n`', 'Lane balance', 'Survivors `m`', 'Exact probability', 'Probability', 'Exact claim multiplier', 'Claim multiplier'],
    outcomeRows().map((r) => [
      r.contract,
      String(r.runners),
      geometryLabel(r.laneSplit, r.runners),
      String(r.survivors),
      `\`${r.probability}\``,
      toFixedExact(r.probability, PROB_PLACES),
      `\`${r.claimMultiplier}\``,
      toFixedExact(r.claimMultiplier, MULT_PLACES),
    ]),
  );

  const sidebets = table(
    ['Side bet', 'Contract', 'Runners', 'Lane balance', 'Exact probability', 'Probability', 'Exact multiplier', 'Multiplier', 'Exact RTP'],
    sideBetTable().map((r) => [
      r.bet,
      r.contract,
      String(r.runners),
      geometryLabel(r.laneSplit, r.runners),
      `\`${r.probability}\``,
      toFixedExact(r.probability, PROB_PLACES),
      `\`${r.multiplier}\``,
      toFixedExact(r.multiplier, MULT_PLACES),
      `\`${r.rtp}\``,
    ]),
  );

  const policies = table(
    ['Policy', 'Leaves', 'Exact RTP', 'RTP %', 'Std. dev.', 'P(bust)', 'P(>= 1x)', 'P(>= 10x)', 'P(>= 100x)', 'Max return'],
    policyRows().map((r) => [
      r.label,
      String(r.leaves),
      `\`${r.rtp}\``,
      toFixedExact(r.rtp.mul(F(100n)), 4),
      sqrtFixed(r.variance, 6),
      toFixedExact(r.bust, 8),
      toFixedExact(r.atLeast1, 8),
      toFixedExact(r.atLeast10, 8),
      toFixedExact(r.atLeast100, 10),
      `\`${r.maxReturn}\` = ${toFixedExact(r.maxReturn, 6)}`,
    ]),
  );

  const portfolios = table(
    ['Route policy', 'Side-bet plan', 'Leaves', 'E[staked]', 'E[credited]', 'RTP = E[cr]/E[st]', 'RTP %', 'Std. dev.', 'Max return'],
    portfolioRows(['ALL_WIDE', 'ALL_SPLIT', 'ALL_NARROW', 'SHELTER_LADDER']).map((r) => [
      r.policy,
      r.plan,
      String(r.leaves),
      `\`${r.expectedStake}\``,
      `\`${r.expectedCredit}\``,
      `\`${r.rtp}\``,
      toFixedExact(r.rtp.mul(F(100n)), 4),
      sqrtFixed(r.variance, 6),
      `\`${r.maxReturn}\` = ${toFixedExact(r.maxReturn, 6)}`,
    ]),
  );

  const invariants = table(
    ['Quantity', 'Exact value', 'Decimal'],
    [
      ['Target RTP (every ticket, every policy, every portfolio)', `\`${CONFIG.rtp}\``, toFixedExact(CONFIG.rtp, 6)],
      ['Squad size', `\`${CONFIG.squadSize}\``, String(CONFIG.squadSize)],
      ['Arenas per run', `\`${CONFIG.arenas}\``, String(CONFIG.arenas)],
      ['Route-ticket ceiling (any policy, any path)', `\`${capReport.routeTicketMax}\``, toFixedExact(capReport.routeTicketMax, 6)],
      ['Largest side-bet multiplier', `\`${capReport.sideBetMax}\``, toFixedExact(capReport.sideBetMax, 6)],
      ['Per-ticket ceiling (the binding one)', `\`${capReport.maxTicketMultiple}\``, toFixedExact(capReport.maxTicketMultiple, 6)],
      ['Max-win cap (per ticket, against that ticket\'s own stake)', `\`${capReport.cap}\``, toFixedExact(capReport.cap, 6)],
      ['Cap headroom', `\`${capReport.headroom}\``, toFixedExact(capReport.headroom, 6)],
      ['Max round total, per unit of total round stake (bound)', `\`${capReport.maxRoundRatio}\``, toFixedExact(capReport.maxRoundRatio, 6)],
      ['Max round total, per unit of total round stake (reachable)', `\`${reachableRoundMaxima().roundRatioMax}\``, toFixedExact(reachableRoundMaxima().roundRatioMax, 6)],
      ['Max round total, per unit of route stake (reachable)', `\`${reachableRoundMaxima().roundTotalPerRouteStakeMax}\``, toFixedExact(reachableRoundMaxima().roundTotalPerRouteStakeMax, 6)],
      ['Max round total, per unit of route stake (both limits maxed)', `\`${capReport.maxRoundTotalPerRouteStake}\``, toFixedExact(capReport.maxRoundTotalPerRouteStake, 6)],
      ['Side-bet stake limit, per bet', `\`${CONFIG.sideBet.maxStakeRatioPerBet}\``, `${toFixedExact(CONFIG.sideBet.maxStakeRatioPerBet, 2)} x route stake`],
      ['Side-bet stake limit, per round', `\`${CONFIG.sideBet.maxTotalStakeRatio}\``, `${toFixedExact(CONFIG.sideBet.maxTotalStakeRatio, 2)} x route stake`],
      ['Minimum game cycle', `\`${CONFIG.minGameCycleMs}\` ms`, `${(CONFIG.minGameCycleMs / 1000).toFixed(1)} s per arena`],
      ['Money unit', '`1/1000000` credit', '0.000001'],
      ['Max floor-rounding loss, route ticket', '`5/1000000` credit', '0.000005'],
      [
        'Max floor-rounding loss, whole round incl. side bets',
        `\`${CONFIG.arenas * (1 + CONFIG.sideBet.maxTicketsPerArena)}/1000000\` credit`,
        toFixedExact(
          F(BigInt(CONFIG.arenas * (1 + CONFIG.sideBet.maxTicketsPerArena)), CONFIG.microCreditsPerCredit),
          6,
        ),
      ],
    ],
  );

  return Object.freeze({
    contracts,
    wipes,
    breakeven,
    dominance,
    geometries,
    outcomes,
    sidebets,
    policies,
    portfolios,
    invariants,
  });
}

/* ------------------------------------------------------------------ *
 * inline figures — every load-bearing number in the prose documents
 * ------------------------------------------------------------------ */

export function buildFigures() {
  const capReport = capAnalysis();
  const policies = policyRows();
  const geometry = (id, n, k = null) => survivorDistribution(id, n, k);

  const wide5 = geometry('WIDE', 5);
  const wide2 = geometry('WIDE', 2);
  const balanced5 = geometry('SPLIT', 5, 3);
  const scout5 = geometry('SPLIT', 5, 4);
  const balanced4 = geometry('SPLIT', 4, 2);
  const scout4 = geometry('SPLIT', 4, 3);
  const split2 = geometry('SPLIT', 2, 1);
  const narrow5 = geometry('NARROW', 5);

  const byBet = (id) => sideBetTable().filter((r) => r.bet === id);
  const lo = (rows) => rows.reduce((m, r) => (r.multiplier.lt(m) ? r.multiplier : m), F(10n ** 9n));
  const hi = (rows) => rows.reduce((m, r) => (r.multiplier.gt(m) ? r.multiplier : m), Frac.ZERO);

  const varianceOf = (key) => policies.find((p) => p.key === key).variance;
  const minVar = policies.reduce((m, p) => (p.variance.lt(m) ? p.variance : m), policies[0].variance);
  const maxVar = policies.reduce((m, p) => (p.variance.gt(m) ? p.variance : m), Frac.ZERO);

  const knife = policies.find((p) => p.key === 'ALL_NARROW');
  const topOdds = Frac.ONE.div(knife.maxReturnProbability);

  const { checks: allChecks } = runInvariants();

  return Object.freeze({
    /* identity */
    rtpPct: pct(CONFIG.rtp, 1),
    rtpPct4: pct(CONFIG.rtp, 4),
    rtpExact: `${CONFIG.rtp}`,
    houseEdgePct: pct(Frac.ONE.sub(CONFIG.rtp), 1),
    squadSize: String(CONFIG.squadSize),
    arenas: String(CONFIG.arenas),
    invariantCount: String(allChecks.length),
    minCycleMs: String(CONFIG.minGameCycleMs),
    minCycleSeconds: (CONFIG.minGameCycleMs / 1000).toFixed(1),
    hazardDraws: String(
      CONFIG.arenas *
        CONTRACT_IDS.reduce((s, id) => s + CONTRACTS[id].laneCount, 0) *
        (1 + CONFIG.squadSize),
    ),

    /* route multipliers */
    wideMult: mult(routeMultiplier('WIDE')),
    splitMult: mult(routeMultiplier('SPLIT')),
    narrowMult: mult(routeMultiplier('NARROW')),

    /* wipe probabilities */
    wideWipe5: pct(wide5[0]),
    wideWipe2: pct(wide2[0]),
    splitWipe5: pct(balanced5[0]),
    splitWipe2: pct(split2[0]),
    scoutWipe5: pct(scout5[0]),
    splitWipe4: pct(balanced4[0]),
    scoutWipe4: pct(scout4[0]),
    narrowWipe5: pct(narrow5[0]),
    splitSaferRatio5: mult(wide5[0].div(balanced5[0]), 2),

    /* clean sweeps and shape */
    wideAllClear5: pct(wide5[5]),
    splitAllClear5: pct(balanced5[5]),
    narrowAllClear5: pct(narrow5[5]),
    wideExpectedSurvivors5: toFixedExact(expectedSurvivors(wide5), 2),
    narrowExpectedSurvivors5: toFixedExact(expectedSurvivors(narrow5), 2),
    splitExpectedSurvivors5: toFixedExact(expectedSurvivors(balanced5), 2),
    wideFallen5: toFixedExact(F(5n).sub(expectedSurvivors(wide5)), 2),
    splitFallen5: toFixedExact(F(5n).sub(expectedSurvivors(balanced5)), 2),
    balancedKeep4Plus5: pct(probabilityOfAtLeast(balanced5, 4)),
    scoutKeep4Plus5: pct(probabilityOfAtLeast(scout5, 4)),
    balancedSole5: pct(balanced5[1]),
    scoutSole5: pct(scout5[1]),
    splitAllClear4: pct(balanced4[4]),
    splitExpectedSurvivors4: toFixedExact(expectedSurvivors(balanced4), 2),
    balancedKeep3Plus4: pct(probabilityOfAtLeast(balanced4, 3)),
    scoutKeep3Plus4: pct(probabilityOfAtLeast(scout4, 3)),
    balancedSole4: pct(balanced4[1]),
    scoutSole4: pct(scout4[1]),

    /* where the claim turns */
    wideBreakEven5: String(breakEvenSurvivors('WIDE', 5)),
    splitBreakEven5: String(breakEvenSurvivors('SPLIT', 5)),
    splitBreakEven4: String(breakEvenSurvivors('SPLIT', 4)),
    narrowBreakEven5: String(breakEvenSurvivors('NARROW', 5)),
    wideRises5: pct(claimMovement('WIDE', 5).rises),
    balancedRises5: pct(claimMovement('SPLIT', 5, 3).rises),
    scoutRises5: pct(claimMovement('SPLIT', 5, 4).rises),
    narrowRises5: pct(claimMovement('NARROW', 5).rises),
    wideFallsNonZero5: pct(claimMovement('WIDE', 5).fallsNonZero),
    narrowFallsNonZero5: pct(claimMovement('NARROW', 5).fallsNonZero),
    balancedHolds4: pct(claimMovement('SPLIT', 4, 2).holds),

    /* side bets */
    cleanSweepMin: mult(lo(byBet('CLEAN_SWEEP')), 2),
    cleanSweepMax: mult(hi(byBet('CLEAN_SWEEP')), 2),
    soleSurvivorMin: mult(lo(byBet('SOLE_SURVIVOR')), 2),
    soleSurvivorMax: mult(hi(byBet('SOLE_SURVIVOR')), 2),
    lastLightMin: mult(lo(byBet('LAST_LIGHT')), 2),
    lastLightMax: mult(hi(byBet('LAST_LIGHT')), 2),
    sideBetRows: String(sideBetTable().length),

    /* dominance */
    dominancePairs: String(dominanceRows().length),
    dominanceTrades: String(dominanceRows().filter((r) => r.relation === 'CROSSES').length),
    dominanceDials: String(dominanceRows().filter((r) => r.relation !== 'CROSSES').length),

    policyCount: String(Object.keys(POLICIES).length),
    sideBetPlanCount: String(Object.keys(SIDE_BET_PLANS).length),
    portfolioCount: String(Object.keys(POLICIES).length * Object.keys(SIDE_BET_PLANS).length),
    geometryCount: String(routeConfigurations().length),

    /* cap */
    routeTicketMax: mult(capReport.routeTicketMax, 2),
    maxTicketMultiple: mult(capReport.maxTicketMultiple, 2),
    maxRoundRatio: mult(capReport.maxRoundRatio, 2),
    ratioMaxSideBets: mult(capReport.ratioMaxSideBets, 2),
    worstCaseRoundTotal: mult(capReport.maxRoundTotalPerRouteStake, 2),
    reachableRoundTotal: mult(reachableRoundMaxima().roundTotalPerRouteStakeMax, 2),
    reachableRoundRatio: mult(reachableRoundMaxima().roundRatioMax, 2),
    capSearchPaths: grouped(BigInt(reachableRoundMaxima().paths)),
    v1BreachTotal: mult(
      capReport.routeTicketMax.add(hi(byBet('CLEAN_SWEEP')).mul(F(BigInt(CONFIG.arenas)))),
      2,
    ),
    v1BreachSoleSurvivor: mult(capReport.sideBetMax.mul(F(2n)), 2),
    capMultiple: mult(capReport.cap, 0),
    capHeadroom: mult(capReport.headroom, 2),
    topPrizeOdds: `1 in ${grouped(topOdds.floor())}`,

    /* volatility */
    sdMin: sqrtFixed(minVar, 2),
    sdMax: sqrtFixed(maxVar, 2),
    sdSpread: `${sqrtFixed(maxVar.div(minVar), 1)}x`,
    keeperBust: pct(policies.find((p) => p.key === 'SHELTER_LADDER').bust, 2),
    keeperMax: mult(policies.find((p) => p.key === 'SHELTER_LADDER').maxReturn, 2),
    knifeBust: pct(knife.bust, 2),
    rangerBust: pct(policies.find((p) => p.key === 'ALL_WIDE').bust, 2),
    rangerSd: sqrtFixed(varianceOf('ALL_WIDE'), 2),
    forkerSd: sqrtFixed(varianceOf('ALL_SPLIT'), 2),
    scoutSd: sqrtFixed(varianceOf('SCOUT_SPLIT'), 2),

    /* rounding */
    maxRoundingLoss: '0.000005',
    maxRoundingLossRoundUc: String(CONFIG.arenas * (1 + CONFIG.sideBet.maxTicketsPerArena)),
    maxRoundingLossRound: toFixedExact(
      F(BigInt(CONFIG.arenas * (1 + CONFIG.sideBet.maxTicketsPerArena)), CONFIG.microCreditsPerCredit),
      6,
    ),
    roundingRtpFloorPct: pct(CONFIG.rtp.sub(F(5n, 1_000_000n)), 4),
  });
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function humanReport() {
  const lines = [];
  const push = (s = '') => lines.push(s);
  const capReport = capAnalysis();

  push('BRANCHFALL — exact outcome enumeration');
  push('======================================');
  push(`game id            ${CONFIG.gameId}`);
  push(`adapter version    ${CONFIG.adapterVersion}`);
  push(`hazard model       ${CONFIG.modelVersion}`);
  push(`squad size         ${CONFIG.squadSize}`);
  push(`arenas             ${CONFIG.arenas}`);
  push(`target RTP         ${CONFIG.rtp} = ${toFixedExact(CONFIG.rtp.mul(F(100n)), 4)}%`);
  push(`max-win cap        ${capReport.cap}x per ticket, against that ticket's own stake`);
  push('');

  push('1. ROUTE CONTRACTS');
  push('------------------');
  for (const r of contractRows()) {
    push(
      `  ${r.id.padEnd(7)} lanes=${r.laneCount}  collapse c=${String(r.collapse).padEnd(6)} clear q=${String(r.clear).padEnd(5)} ` +
        `p=${String(r.marginal).padEnd(7)} mu=1/p=${String(r.multiplier).padEnd(7)} (${toFixedExact(r.multiplier, 6)})`,
    );
  }
  push('');

  push('2. ROUTE GEOMETRIES — contract x running group x lane balance');
  push('--------------------------------------------------------------');
  push('   the lane balance of a SPLIT is a player choice; it moves the shape, never the mean');
  for (const r of geometryRows()) {
    push(
      `  ${r.key.padEnd(14)} lanes=${geometryLabel(r.laneSplit, r.runners).padEnd(5)} ` +
        `wipe=${toFixedExact(r.wipe, 8)}  allClear=${toFixedExact(r.cleanSweep, 8)}  ` +
        `E[surv]=${toFixedExact(r.expectedSurvivors, 6)}  stageRTP=${r.fairness}`,
    );
  }
  push('');

  push('2.1 WHERE THE CLAIM TURNS — the break-even survivor count');
  push('----------------------------------------------------------');
  push('   the claim holds or grows only from ceil(n*p) survivors up; below it the');
  push('   claim falls without the round ending, which is the opposite of the genre');
  for (const r of claimMovementRows()) {
    push(
      `  ${r.key.padEnd(14)} break-even m>=${r.breakEven} (factor ${String(r.breakEvenFactor).padEnd(6)})  ` +
        `grows=${pct(r.rises).padStart(7)}  holds=${pct(r.holds).padStart(7)}  ` +
        `falls=${pct(r.fallsNonZero).padStart(7)}  wipe=${pct(r.wipe).padStart(7)}`,
    );
  }
  push('');

  push('2.2 DOMINANCE — which choices are trades, and which are volatility dials');
  push('----------------------------------------------------------------------');
  push('   second-order stochastic dominance over the exact claim-factor distribution');
  push('   (all means are exactly 1, so this is the standard reading for the comparison)');
  for (const r of dominanceRows()) {
    const verdict =
      r.preferred === null ? 'CROSSES  — genuine trade' : `${r.preferred} dominates  — volatility dial`;
    push(`  n=${r.runners}  ${r.a.padEnd(14)} vs ${r.b.padEnd(14)} ${verdict}`);
  }
  push('');

  push('3. ARENA OUTCOME SPACE — exact probability and exact claim multiplier');
  push('---------------------------------------------------------------------');
  let currentKey = '';
  for (const r of outcomeRows()) {
    const key = configKey(r.contract, r.runners, r.laneSplit);
    if (key !== currentKey) {
      currentKey = key;
      push(`  ${key.padEnd(14)} lanes=${r.lanes.join('+')}`);
    }
    push(
      `      m=${r.survivors}  P=${String(r.probability).padEnd(26)} (${toFixedExact(r.probability, PROB_PLACES)})` +
        `  claim x${String(r.claimMultiplier).padEnd(12)} (${toFixedExact(r.claimMultiplier, MULT_PLACES)})`,
    );
  }
  push('');

  push('4. SIDE BETS — priced at r / P against the COMMITTED geometry');
  push('-------------------------------------------------------------');
  for (const r of sideBetTable()) {
    push(
      `  ${r.bet.padEnd(14)} ${r.key.padEnd(14)} P=${String(r.probability).padEnd(22)} ` +
        `x=${String(r.multiplier).padEnd(24)} (${toFixedExact(r.multiplier, 6)})  RTP=${r.rtp}`,
    );
  }
  push('');

  push('5. DECISION SPACE — backward induction over every reachable state');
  push('------------------------------------------------------------------');
  push('   value = exact expected credited payout per unit of claim held on entry');
  const dp = stateValueDP();
  for (const state of [...dp.states].sort((a, b) => a.arena - b.arena || a.alive - b.alive)) {
    push(
      `  arena ${state.arena}, ${state.alive} alive: best=${state.max}  worst=${state.min}  ` +
        `actions=${state.actions.length} [${state.actions
          .map((a) => {
            if (a.action.type === 'BANK') return `BANK=${a.value}`;
            if (a.action.type === 'SHELTER') return `SHELTER${a.action.shelter}=${a.value}`;
            const suffix = a.action.laneSplit === null || a.action.laneSplit === undefined ? '' : `(${a.action.laneSplit})`;
            return `${a.action.contract}${suffix}=${a.value}`;
          })
          .join(' ')}]`,
    );
  }
  push('');

  push('6. FULL OUTCOME SPACE OF NAMED POLICIES (route ticket only)');
  push('-----------------------------------------------------------');
  for (const r of policyRows()) {
    push(`  ${r.label}`);
    push(
      `      leaves=${r.leaves} distinct=${r.distinctOutcomes} sum(P)=${r.totalProbability} ` +
        `RTP=${r.rtp} (${toFixedExact(r.rtp.mul(F(100n)), 4)}%)`,
    );
    push(
      `      var=${r.variance}` +
        `\n      sd=${sqrtFixed(r.variance, 6)}  P(bust)=${toFixedExact(r.bust, 8)}  P(>=1x)=${toFixedExact(r.atLeast1, 8)}  ` +
        `P(>=10x)=${toFixedExact(r.atLeast10, 8)}  P(>=100x)=${toFixedExact(r.atLeast100, 10)}  max=${r.maxReturn} (${toFixedExact(r.maxReturn, 4)})`,
    );
  }
  push('');

  push('7. PORTFOLIOS — route policy x side-bet plan');
  push('--------------------------------------------');
  push('   RTP is E[credited] / E[staked], which is the only correct definition when a');
  push('   plan stakes a path-dependent total. Every one of them is exactly r.');
  for (const r of portfolioRows()) {
    push(
      `  ${r.policyKey.padEnd(18)} ${r.planKey.padEnd(24)} E[stake]=${String(r.expectedStake).padEnd(20)} ` +
        `E[credit]=${String(r.expectedCredit).padEnd(28)} RTP=${r.rtp}  max=${toFixedExact(r.maxReturn, 4)}x`,
    );
  }
  push('');

  push('8. MAX-WIN CAP — per ticket, and over the round total');
  push('-----------------------------------------------------');
  push(`  route-ticket ceiling (all policies, all paths):    ${capReport.routeTicketMax} = ${toFixedExact(capReport.routeTicketMax, 6)}x`);
  push(`  largest side-bet multiplier:                       ${capReport.sideBetMax} = ${toFixedExact(capReport.sideBetMax, 6)}x`);
  push(`  per-ticket ceiling (the binding one):              ${capReport.maxTicketMultiple} = ${toFixedExact(capReport.maxTicketMultiple, 6)}x`);
  push(`  declared cap (per ticket, own stake basis):        ${capReport.cap} = ${toFixedExact(capReport.cap, 6)}x`);
  push(`  headroom:                                          ${capReport.headroom} = ${toFixedExact(capReport.headroom, 6)}x`);
  push('');
  push(`  round total / total round stake, no side bets:     ${capReport.ratioNoSideBets} = ${toFixedExact(capReport.ratioNoSideBets, 6)}x`);
  push(`  round total / total round stake, max side bets:    ${capReport.ratioMaxSideBets} = ${toFixedExact(capReport.ratioMaxSideBets, 6)}x`);
  push(`  worst case over the interval:                      ${capReport.maxRoundRatio} = ${toFixedExact(capReport.maxRoundRatio, 6)}x`);
  push(`  worst-case round total in route stakes (bound):    ${capReport.maxRoundTotalPerRouteStake} = ${toFixedExact(capReport.maxRoundTotalPerRouteStake, 6)}x`);
  push('');
  const reach = reachableRoundMaxima();
  push(`  exhaustive walk over ${reach.paths} terminal paths:`);
  push(`    reachable route ticket:                          ${reach.routeTicketMax} = ${toFixedExact(reach.routeTicketMax, 6)}x`);
  push(`      via ${reach.routeTicketLine.join(' ')}`);
  push(`    reachable round total / total round stake:       ${reach.roundRatioMax} = ${toFixedExact(reach.roundRatioMax, 6)}x`);
  push(`    reachable round total / route stake:             ${reach.roundTotalPerRouteStakeMax} = ${toFixedExact(reach.roundTotalPerRouteStakeMax, 6)}x`);
  push(`      via ${reach.roundTotalLine.join(' ')}`);
  push('  => no ticket and no round can reach the cap: it cannot clip an advertised win.');
  push('');

  return lines.join('\n');
}

function main() {
  const args = new Set(process.argv.slice(2));
  const { checks: allChecks, failures: allFailures } = runInvariants();

  if (args.has('--markdown')) {
    const tables = buildTables();
    for (const [name, body] of Object.entries(tables)) {
      process.stdout.write(`<!-- table:${name} -->\n${body}\n\n`);
    }
  } else if (args.has('--figures')) {
    for (const [name, value] of Object.entries(buildFigures())) {
      process.stdout.write(`${name.padEnd(28)} ${value}\n`);
    }
  } else if (args.has('--json')) {
    const replacer = (_k, v) => (v instanceof Frac ? v.toString() : typeof v === 'bigint' ? v.toString() : v);
    process.stdout.write(
      `${JSON.stringify(
        {
          config: {
            ...CONFIG,
            rtp: CONFIG.rtp.toString(),
            maxWinMultiple: CONFIG.maxWinMultiple.toString(),
            sideBet: {
              ...CONFIG.sideBet,
              maxStakeRatioPerBet: CONFIG.sideBet.maxStakeRatioPerBet.toString(),
              maxTotalStakeRatio: CONFIG.sideBet.maxTotalStakeRatio.toString(),
            },
          },
          contracts: contractRows(),
          geometries: geometryRows(),
          outcomes: outcomeRows(),
          sideBets: sideBetTable(),
          policies: policyRows(),
          portfolios: portfolioRows(),
          cap: capAnalysis(),
          figures: buildFigures(),
          checks: allChecks.length,
          failures: allFailures,
        },
        replacer,
        2,
      )}\n`,
    );
  } else if (!args.has('--quiet')) {
    process.stdout.write(`${humanReport()}\n`);
  }

  const banner = `${allChecks.length} exact invariants checked, ${allFailures.length} failed`;
  if (allFailures.length > 0) {
    process.stderr.write(`\nFAIL — ${banner}\n`);
    for (const f of allFailures) process.stderr.write(`  x ${f}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.has('--markdown') || args.has('--json') || args.has('--quiet') || args.has('--figures')) {
    process.stderr.write(`OK — ${banner}\n`);
  } else {
    process.stdout.write(`OK — ${banner}\n`);
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) main();

export { largestSideBetMultiplier, capAnalysis };
