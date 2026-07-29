#!/usr/bin/env node
/**
 * BRANCHFALL — exact outcome enumerator.
 *
 * This script is the proof. It enumerates the complete outcome space of the
 * game with exact BigInt rational arithmetic and prints, as exact fractions:
 *
 *   1. every route contract's hazard parameters and route multiplier;
 *   2. every (contract, squad size, survivor count) outcome — its exact
 *      probability and its exact claim multiplier;
 *   3. every side bet's exact probability, multiplier and RTP;
 *   4. a backward-induction sweep of the entire decision space showing that the
 *      best and the worst policy have identical value in every reachable state;
 *   5. the full outcome space of a set of named policies, with exact RTP,
 *      variance and tail probabilities;
 *   6. the maximum credited payout over all policies and paths, versus the cap.
 *
 * Every claim printed here is asserted. A violated invariant exits non-zero.
 *
 * Usage:
 *   node tools/enumerate.mjs               full human-readable report
 *   node tools/enumerate.mjs --markdown    emit the docs/MATH.md tables
 *   node tools/enumerate.mjs --json        emit machine-readable results
 *   node tools/enumerate.mjs --quiet       assertions only (exit code is the answer)
 */

import { F, Frac, sqrtFixed, toFixedExact } from './lib/exact.mjs';
import {
  CONFIG,
  CONTRACTS,
  CONTRACT_IDS,
  actionExpectedFactor,
  actionsFor,
  branches,
  enumeratePolicy,
  laneSizes,
  marginalSurvival,
  maxPayoutDP,
  POLICIES,
  probabilityAtLeast,
  probabilityOfZero,
  routeMultiplier,
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
 * derived quantities
 * ------------------------------------------------------------------ */

const PROB_PLACES = 12;
const MULT_PLACES = 8;

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

/** Every (contract, runners, survivors) outcome with probability and claim multiplier. */
export function outcomeRows() {
  const rows = [];
  for (const id of CONTRACT_IDS) {
    for (let n = CONTRACTS[id].minRunners; n <= CONFIG.squadSize; n += 1) {
      const dist = survivorDistribution(id, n);
      const mu = routeMultiplier(id);
      for (let m = 0; m <= n; m += 1) {
        rows.push({
          contract: id,
          runners: n,
          survivors: m,
          probability: dist[m],
          claimMultiplier: F(BigInt(m), BigInt(n)).mul(mu),
        });
      }
    }
  }
  return rows;
}

/** Per (contract, runners) shape metrics: the reason contract choice matters. */
export function shapeRows() {
  const rows = [];
  for (const id of CONTRACT_IDS) {
    for (let n = CONTRACTS[id].minRunners; n <= CONFIG.squadSize; n += 1) {
      const dist = survivorDistribution(id, n);
      const mu = routeMultiplier(id);
      const expectedSurvivors = dist.reduce((s, p, m) => s.add(p.mul(F(BigInt(m)))), Frac.ZERO);
      const fairness = dist.reduce(
        (s, p, m) => s.add(p.mul(F(BigInt(m), BigInt(n))).mul(mu)),
        Frac.ZERO,
      );
      rows.push({
        contract: id,
        runners: n,
        lanes: laneSizes(id, n),
        wipe: dist[0],
        cleanSweep: dist[n],
        expectedSurvivors,
        fairness,
        total: dist.reduce((s, p) => s.add(p), Frac.ZERO),
      });
    }
  }
  return rows;
}

/** Full outcome space of every named policy, with exact moments and tails. */
export function policyRows() {
  return Object.entries(POLICIES).map(([key, { label, fn }]) => {
    const result = enumeratePolicy(fn);
    return {
      key,
      label,
      leaves: result.leaves,
      distinctOutcomes: result.distribution.length,
      totalProbability: result.totalProbability,
      rtp: result.mean,
      variance: result.variance,
      bust: probabilityOfZero(result.distribution),
      atLeast1: probabilityAtLeast(result.distribution, F(1n)),
      atLeast10: probabilityAtLeast(result.distribution, F(10n)),
      atLeast100: probabilityAtLeast(result.distribution, F(100n)),
      maxReturn: result.maxReturn,
    };
  });
}

/** Exact ceiling on credited payout across every policy and path. */
export function maxPayoutMultiple() {
  const best = maxPayoutDP();
  return CONFIG.rtp.mul(best[1][CONFIG.squadSize]);
}

/* ------------------------------------------------------------------ *
 * invariants — the actual proof obligations
 * ------------------------------------------------------------------ */

export function runInvariants() {
  failures.length = 0;
  checks.length = 0;

  // 1. Every survivor distribution is a probability distribution.
  for (const row of shapeRows()) {
    checkEqual(row.total, Frac.ONE, `${row.contract}/${row.runners}: probabilities sum to 1`);
  }

  // 2. Marginal per-runner survival matches the declared (1 - c) * q for every squad size.
  for (const id of CONTRACT_IDS) {
    const p = marginalSurvival(id);
    for (let n = CONTRACTS[id].minRunners; n <= CONFIG.squadSize; n += 1) {
      const dist = survivorDistribution(id, n);
      const expected = dist.reduce((s, prob, m) => s.add(prob.mul(F(BigInt(m)))), Frac.ZERO);
      checkEqual(expected, p.mul(F(BigInt(n))), `${id}/${n}: E[survivors] = n * p`);
    }
  }

  // 3. Route multiplier is exactly 1 / p, so a stage is a fair bet on the carried claim.
  for (const id of CONTRACT_IDS) {
    checkEqual(
      marginalSurvival(id).mul(routeMultiplier(id)),
      Frac.ONE,
      `${id}: route multiplier is the reciprocal of marginal survival`,
    );
  }

  // 4. Stage neutrality: every legal action has expected total factor exactly 1.
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

  // 5. Branch tables are themselves probability distributions.
  for (let alive = 1; alive <= CONFIG.squadSize; alive += 1) {
    for (const action of actionsFor(2, alive)) {
      const total = branches(action, alive).reduce((s, b) => s.add(b.prob), Frac.ZERO);
      checkEqual(total, Frac.ONE, `${alive} alive, ${JSON.stringify(action)}: branch probabilities sum to 1`);
    }
  }

  // 6. Backward induction: best policy value == worst policy value == 1 everywhere.
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

  // 7. Every named policy returns exactly the target RTP over its full outcome space.
  for (const row of policyRows()) {
    checkEqual(row.totalProbability, Frac.ONE, `${row.label}: outcome space probabilities sum to 1`);
    checkEqual(row.rtp, CONFIG.rtp, `${row.label}: RTP is exactly the target`);
    check(row.maxReturn.lte(F(CONFIG.maxWinMultiple)), `${row.label}: max return is within the cap`);
  }

  // 8. Target RTP sits inside the published 94%-97% band.
  check(CONFIG.rtp.gte(F(94n, 100n)) && CONFIG.rtp.lte(F(97n, 100n)), 'target RTP is within [94%, 97%]');

  // 9. The max-win cap strictly dominates the best reachable payout of the main game.
  const cap = F(CONFIG.maxWinMultiple);
  const best = maxPayoutMultiple();
  check(best.lt(cap), `max reachable payout ${best} is strictly below the cap ${cap}`);

  // 10. Side bets: every one prices to exactly the target RTP and stays under the cap.
  for (const row of sideBetTable()) {
    checkEqual(row.rtp, CONFIG.rtp, `side bet ${row.bet} on ${row.contract}/${row.runners}: RTP is exact`);
    check(
      row.multiplier.lte(cap),
      `side bet ${row.bet} on ${row.contract}/${row.runners}: multiplier ${row.multiplier} within cap`,
    );
  }

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
  const cap = F(CONFIG.maxWinMultiple);
  const best = maxPayoutMultiple();

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

  const outcomes = table(
    ['Contract', 'Runners `n`', 'Survivors `m`', 'Exact probability', 'Probability', 'Exact claim multiplier', 'Claim multiplier'],
    outcomeRows().map((r) => [
      r.contract,
      String(r.runners),
      String(r.survivors),
      `\`${r.probability}\``,
      toFixedExact(r.probability, PROB_PLACES),
      `\`${r.claimMultiplier}\``,
      toFixedExact(r.claimMultiplier, MULT_PLACES),
    ]),
  );

  const shape = table(
    ['Contract', 'Runners `n`', 'Lane sizes', 'P(total wipe)', 'P(all clear)', 'E[survivors]', 'Stage RTP'],
    shapeRows().map((r) => [
      r.contract,
      String(r.runners),
      r.lanes.join('+'),
      `\`${r.wipe}\` = ${toFixedExact(r.wipe, PROB_PLACES)}`,
      `\`${r.cleanSweep}\` = ${toFixedExact(r.cleanSweep, PROB_PLACES)}`,
      `\`${r.expectedSurvivors}\` = ${toFixedExact(r.expectedSurvivors, 6)}`,
      `\`${r.fairness}\``,
    ]),
  );

  const sidebets = table(
    ['Side bet', 'Contract', 'Runners', 'Exact probability', 'Probability', 'Exact multiplier', 'Multiplier', 'Exact RTP'],
    sideBetTable().map((r) => [
      r.bet,
      r.contract,
      String(r.runners),
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

  const invariants = table(
    ['Quantity', 'Exact value', 'Decimal'],
    [
      ['Target RTP (all bets, all policies)', `\`${CONFIG.rtp}\``, toFixedExact(CONFIG.rtp, 6)],
      ['Squad size', `\`${CONFIG.squadSize}\``, String(CONFIG.squadSize)],
      ['Arenas per run', `\`${CONFIG.arenas}\``, String(CONFIG.arenas)],
      ['Max reachable payout (any policy)', `\`${best}\``, toFixedExact(best, 6)],
      ['Max-win cap', `\`${cap}\``, toFixedExact(cap, 6)],
      ['Cap headroom', `\`${cap.sub(best)}\``, toFixedExact(cap.sub(best), 6)],
      [
        'Largest side-bet multiplier',
        `\`${largestSideBetMultiplier()}\``,
        toFixedExact(largestSideBetMultiplier(), 6),
      ],
      ['Money unit', '`1/1000000` credit', '0.000001'],
      ['Max floor-rounding loss per round', '`5/1000000` credit', '0.000005'],
    ],
  );

  return Object.freeze({ contracts, outcomes, shape, sidebets, policies, invariants });
}

export function largestSideBetMultiplier() {
  return sideBetTable().reduce((m, r) => (r.multiplier.gt(m) ? r.multiplier : m), Frac.ZERO);
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function humanReport() {
  const lines = [];
  const push = (s = '') => lines.push(s);
  const cap = F(CONFIG.maxWinMultiple);
  const best = maxPayoutMultiple();

  push('BRANCHFALL — exact outcome enumeration');
  push('======================================');
  push(`game id            ${CONFIG.gameId}`);
  push(`adapter version    ${CONFIG.adapterVersion}`);
  push(`hazard model       ${CONFIG.modelVersion}`);
  push(`squad size         ${CONFIG.squadSize}`);
  push(`arenas             ${CONFIG.arenas}`);
  push(`target RTP         ${CONFIG.rtp} = ${toFixedExact(CONFIG.rtp.mul(F(100n)), 4)}%`);
  push(`max-win cap        ${cap}x`);
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

  push('2. ARENA OUTCOME SPACE — exact probability and exact claim multiplier');
  push('---------------------------------------------------------------------');
  let currentKey = '';
  for (const r of outcomeRows()) {
    const key = `${r.contract}/${r.runners}`;
    if (key !== currentKey) {
      currentKey = key;
      const shape = shapeRows().find((s) => s.contract === r.contract && s.runners === r.runners);
      push(
        `  ${key.padEnd(10)} lanes=${shape.lanes.join('+')}  sum(P)=${shape.total}  E[survivors]=${shape.expectedSurvivors}  stage RTP=${shape.fairness}`,
      );
    }
    push(
      `      m=${r.survivors}  P=${String(r.probability).padEnd(26)} (${toFixedExact(r.probability, PROB_PLACES)})` +
        `  claim x${String(r.claimMultiplier).padEnd(12)} (${toFixedExact(r.claimMultiplier, MULT_PLACES)})`,
    );
  }
  push('');

  push('3. SIDE BETS — priced at RTP / P(event)');
  push('---------------------------------------');
  for (const r of sideBetTable()) {
    push(
      `  ${r.bet.padEnd(14)} ${r.contract.padEnd(7)} n=${r.runners}  P=${String(r.probability).padEnd(22)} ` +
        `x=${String(r.multiplier).padEnd(24)} (${toFixedExact(r.multiplier, 6)})  RTP=${r.rtp}`,
    );
  }
  push('');

  push('4. DECISION SPACE — backward induction over every reachable state');
  push('------------------------------------------------------------------');
  push('   value = exact expected credited payout per unit of claim held on entry');
  const dp = stateValueDP();
  for (const state of [...dp.states].sort((a, b) => a.arena - b.arena || a.alive - b.alive)) {
    push(
      `  arena ${state.arena}, ${state.alive} alive: best=${state.max}  worst=${state.min}  ` +
        `actions=${state.actions.length} [${state.actions
          .map((a) => `${a.action.type === 'ROUTE' ? a.action.contract : a.action.type === 'SHELTER' ? `SHELTER${a.action.shelter}` : 'BANK'}=${a.value}`)
          .join(' ')}]`,
    );
  }
  push('');

  push('5. FULL OUTCOME SPACE OF NAMED POLICIES');
  push('---------------------------------------');
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

  push('6. MAX-WIN CAP');
  push('--------------');
  push(`  max reachable payout over all policies and paths: ${best} = ${toFixedExact(best, 6)}x`);
  push(`  declared cap:                                     ${cap} = ${toFixedExact(cap, 6)}x`);
  push(`  largest side-bet multiplier:                      ${largestSideBetMultiplier()} = ${toFixedExact(largestSideBetMultiplier(), 6)}x`);
  push(`  headroom:                                         ${cap.sub(best)} = ${toFixedExact(cap.sub(best), 6)}x`);
  push('  => the cap is a liability ceiling, never a payout rule: it cannot clip an advertised win.');
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
  } else if (args.has('--json')) {
    const replacer = (_k, v) => (v instanceof Frac ? v.toString() : typeof v === 'bigint' ? v.toString() : v);
    process.stdout.write(
      `${JSON.stringify(
        {
          config: { ...CONFIG, rtp: CONFIG.rtp.toString(), maxWinMultiple: CONFIG.maxWinMultiple.toString() },
          contracts: contractRows(),
          outcomes: outcomeRows(),
          shape: shapeRows(),
          sideBets: sideBetTable(),
          policies: policyRows(),
          maxPayoutMultiple: maxPayoutMultiple().toString(),
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
  if (args.has('--markdown') || args.has('--json') || args.has('--quiet')) {
    process.stderr.write(`OK — ${banner}\n`);
  } else {
    process.stdout.write(`OK — ${banner}\n`);
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) main();
