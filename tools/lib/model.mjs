/**
 * BRANCHFALL — staged-survival probability model.
 *
 * This module is the single source of truth for the game's mathematics.
 * `tools/enumerate.mjs` renders it, `tools/transcript.mjs` samples it,
 * `tests/` proves it, and `docs/MATH.md` publishes it. Nothing here uses
 * floating point.
 *
 * Model in one paragraph
 * ----------------------
 * A squad of five named runners crosses up to five arenas. Before each arena
 * the player commits a ROUTE CONTRACT. A contract describes a lane geometry
 * and a hazard profile. Each lane resolves in two explicitly correlated
 * layers: a shared LANE COLLAPSE (probability `c`) that takes every runner in
 * that lane at once, and, if the lane holds, an independent per-runner CLEAR
 * check (probability `q`). Marginal per-runner survival is therefore
 * `p = (1 - c) * q`, identical for every runner in the contract, while the
 * *shape* of the survivor distribution differs sharply between contracts — and,
 * for SPLIT, between the lane balances the player may choose.
 *
 * Money rule in one sentence
 * --------------------------
 * Every runner carries an equal share of the squad's claim; a runner who
 * clears an arena has their share multiplied by the route multiplier
 * `mu = 1 / p`; a runner who falls loses their share.
 *
 * Consequence: `E[claim after arena] = claim before arena` for every contract,
 * every lane balance, every squad size and every shelter split. The house
 * margin is charged once, at entry (`claim_0 = stake * RTP`), and never again.
 * Contract choice, lane balance and bank/continue choice reshape the
 * distribution but cannot move the mean.
 *
 * Side bets are separate tickets bought with fresh money and priced at
 * `RTP / P(event)` against the *committed* configuration, so they too return
 * exactly the target RTP. They are part of the model, not an appendix to it:
 * see `sideBetOffersFor()` and `capAnalysis()`.
 */

import { F, Frac, binomial } from './exact.mjs';

export class ModelError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ModelError(code, message);
}

/** @typedef {'WIDE'|'SPLIT'|'NARROW'} ContractId */
/** @typedef {'CLEAN_SWEEP'|'SOLE_SURVIVOR'|'LAST_LIGHT'} SideBetId */

/**
 * Frozen game configuration. Any change here is a replay-visible change and
 * requires a new `adapterVersion` (see docs/ENGINE.md).
 */
export const CONFIG = Object.freeze({
  gameId: 'branchfall',
  adapterVersion: '2.0.0',
  modelVersion: 'branchfall-hazard/v2',
  /** Runners in a fresh squad. */
  squadSize: 5,
  /** Arenas in a full run. After the last arena the claim is banked automatically. */
  arenas: 5,
  /** Theoretical return to player, charged once at entry, on every ticket. */
  rtp: F(191n, 200n),
  /**
   * Liability ceiling for a single ticket, as a multiple of *that ticket's own
   * stake*. The route ticket is capped against the route stake; each side-bet
   * ticket is capped against its own stake. See docs/MATH.md §9 — the basis is
   * load-bearing and was wrong in the v1 draft.
   */
  maxWinMultiple: 1000n,
  /** Money is denominated in micro-credits so floor rounding is negligible. */
  microCreditsPerCredit: 1_000_000n,
  /** Minimum stake in micro-credits (1.00 credit), for the route ticket and for each side bet. */
  minStakeMicro: 1_000_000n,
  /**
   * Minimum game cycle in milliseconds, measured from committing an arena to the
   * moment the next money control unlocks.
   *
   * UKGC RTS 14G — five seconds for casino games other than slots and
   * peer-to-peer poker. NOT RTS 14D (2.5 s), which is the slots rule, and NOT
   * RTS 8, which is the autoplay prohibition (we satisfy that separately by
   * having no autoplay at all). BRANCHFALL is not reel-based, so 14G is the
   * conservative reading and the one we build to. See docs/DESIGN.md §5.1 for
   * the game-cycle boundary question, which is a classification matter for a
   * regulator and a test house, not something this repository can settle.
   */
  minGameCycleMs: 5000,
  /** Side-bet limits. Load-bearing for the cap proof and for responsible design. */
  sideBet: Object.freeze({
    /** Side bets are only offered when at least this many runners are running. */
    minRunners: 2,
    /** Each side bet's stake, as a multiple of the route stake. */
    maxStakeRatioPerBet: F(1n, 1n),
    /** All side bets in a round together, as a multiple of the route stake. */
    maxTotalStakeRatio: F(1n, 1n),
    /** At most one ticket per event per arena. */
    maxTicketsPerArena: 3,
  }),
});

/**
 * Route contracts. `collapse` is the shared lane-wipe probability, `clear` is
 * the independent per-runner survival probability given the lane holds.
 */
export const CONTRACTS = Object.freeze({
  WIDE: Object.freeze({
    id: 'WIDE',
    label: 'Wide',
    laneCount: 1,
    minRunners: 1,
    collapse: F(1n, 25n),
    clear: F(7n, 8n),
  }),
  SPLIT: Object.freeze({
    id: 'SPLIT',
    label: 'Split',
    laneCount: 2,
    minRunners: 2,
    collapse: F(1n, 10n),
    clear: F(5n, 6n),
  }),
  NARROW: Object.freeze({
    id: 'NARROW',
    label: 'Narrow',
    laneCount: 1,
    minRunners: 1,
    collapse: F(1n, 2n),
    clear: F(1n, 2n),
  }),
});

export const CONTRACT_IDS = Object.freeze(['WIDE', 'SPLIT', 'NARROW']);

/** @param {string} id @returns {typeof CONTRACTS.WIDE} */
export function contract(id) {
  const found = Object.prototype.hasOwnProperty.call(CONTRACTS, id) ? CONTRACTS[id] : undefined;
  if (!found) fail('UNKNOWN_CONTRACT', `Unknown route contract: ${String(id)}`);
  return found;
}

/** @param {number} n @param {string} what */
function assertRunnerCount(n, what) {
  if (!Number.isSafeInteger(n) || n < 0 || n > CONFIG.squadSize) {
    fail('INVALID_SQUAD', `${what} must be an integer in [0, ${CONFIG.squadSize}]`);
  }
}

/* ------------------------------------------------------------------ *
 * lane geometry — SPLIT's balance is a genuine player choice
 * ------------------------------------------------------------------ */

/**
 * The legal lane balances for a contract at a given running-group size.
 *
 * Single-lane contracts have exactly one geometry, reported as `null`.
 * SPLIT lets the player choose how the group divides. `laneSplit` names the
 * size of the LEAD lane and is canonicalised to the larger-or-equal half, so
 * `[3,2]` and `[2,3]` are the same geometry (they are — lane order is a
 * drawing convention, not a distributional fact).
 *
 * At `n = 2` and `n = 3` there is exactly one balance, so there is no choice to
 * make and the UI must not pretend there is. At `n = 4` and `n = 5` there are
 * two, and they differ materially (docs/MATH.md §3.2).
 *
 * @param {ContractId} id
 * @param {number} runners
 * @returns {(number|null)[]}
 */
export function laneSplitsFor(id, runners) {
  const spec = contract(id);
  assertRunnerCount(runners, 'runners');
  if (runners < spec.minRunners) {
    fail('CONTRACT_UNAVAILABLE', `${id} requires at least ${spec.minRunners} runner(s)`);
  }
  if (spec.laneCount === 1) return Object.freeze([null]);
  const out = [];
  for (let k = Math.ceil(runners / 2); k <= runners - 1; k += 1) out.push(k);
  return Object.freeze(out);
}

/**
 * Deterministic lane sizes for a committed geometry.
 * @param {ContractId} id
 * @param {number} runners
 * @param {number|null} [laneSplit]
 * @returns {number[]}
 */
export function laneSizes(id, runners, laneSplit = null) {
  const spec = contract(id);
  assertRunnerCount(runners, 'runners');
  if (runners < spec.minRunners) {
    fail('CONTRACT_UNAVAILABLE', `${id} requires at least ${spec.minRunners} runner(s)`);
  }
  const legal = laneSplitsFor(id, runners);
  if (spec.laneCount === 1) {
    if (laneSplit !== null && laneSplit !== undefined) {
      fail('INVALID_LANE_SPLIT', `${id} has one lane and takes no lane balance`);
    }
    return Object.freeze([runners]);
  }
  if (!legal.includes(laneSplit)) {
    fail(
      'INVALID_LANE_SPLIT',
      `${id} with ${runners} runners accepts lane balance in {${legal.join(', ')}}, got ${String(laneSplit)}`,
    );
  }
  return Object.freeze([laneSplit, runners - laneSplit]);
}

/** Stable key for a committed route configuration. @returns {string} */
export function configKey(id, runners, laneSplit = null) {
  return laneSplit === null || laneSplit === undefined
    ? `${id}:${runners}`
    : `${id}:${runners}:${laneSplit}`;
}

/**
 * Every distinct route configuration the game can present, in a stable order.
 * A configuration is the unit that side bets are priced against.
 * @param {{minRunners?: number}} [options]
 * @returns {{contract: ContractId, runners: number, laneSplit: number|null, lanes: number[], key: string}[]}
 */
export function routeConfigurations(options = {}) {
  const floor = options.minRunners ?? 1;
  const rows = [];
  for (const id of CONTRACT_IDS) {
    for (let n = Math.max(CONTRACTS[id].minRunners, floor); n <= CONFIG.squadSize; n += 1) {
      for (const laneSplit of laneSplitsFor(id, n)) {
        rows.push(
          Object.freeze({
            contract: id,
            runners: n,
            laneSplit,
            lanes: laneSizes(id, n, laneSplit),
            key: configKey(id, n, laneSplit),
          }),
        );
      }
    }
  }
  return Object.freeze(rows);
}

/* ------------------------------------------------------------------ *
 * survivor distributions
 * ------------------------------------------------------------------ */

/**
 * Exact survivor distribution for a single lane.
 * `P(0) = c + (1-c)(1-q)^size`, `P(j>0) = (1-c) * C(size,j) * q^j * (1-q)^(size-j)`.
 * @param {number} size
 * @param {Frac} collapse
 * @param {Frac} clear
 * @returns {Frac[]} index j = survivors
 */
export function laneDistribution(size, collapse, clear) {
  assertRunnerCount(size, 'lane size');
  const holds = Frac.ONE.sub(collapse);
  const falls = Frac.ONE.sub(clear);
  const out = [];
  for (let j = 0; j <= size; j += 1) {
    let term = holds.mul(F(binomial(size, j))).mul(clear.pow(j)).mul(falls.pow(size - j));
    if (j === 0) term = term.add(collapse);
    out.push(term);
  }
  return Object.freeze(out);
}

/** @param {Frac[]} a @param {Frac[]} b @returns {Frac[]} */
export function convolve(a, b) {
  const out = new Array(a.length + b.length - 1).fill(Frac.ZERO);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      out[i + j] = out[i + j].add(a[i].mul(b[j]));
    }
  }
  return Object.freeze(out);
}

const distributionCache = new Map();

/**
 * Exact distribution of surviving runners for a committed configuration.
 * Lanes are independent; runners inside a lane are correlated through the collapse.
 * @param {ContractId} id
 * @param {number} runners
 * @param {number|null} [laneSplit]
 * @returns {Frac[]} index m = survivors, length runners + 1
 */
export function survivorDistribution(id, runners, laneSplit = null) {
  const key = configKey(id, runners, laneSplit);
  const cached = distributionCache.get(key);
  if (cached) return cached;
  const spec = contract(id);
  const sizes = laneSizes(id, runners, laneSplit);
  let dist = laneDistribution(sizes[0], spec.collapse, spec.clear);
  for (let i = 1; i < sizes.length; i += 1) {
    dist = convolve(dist, laneDistribution(sizes[i], spec.collapse, spec.clear));
  }
  const frozen = Object.freeze(dist);
  distributionCache.set(key, frozen);
  return frozen;
}

/** Marginal per-runner survival `p = (1 - c) q`. @param {ContractId} id @returns {Frac} */
export function marginalSurvival(id) {
  const spec = contract(id);
  return Frac.ONE.sub(spec.collapse).mul(spec.clear);
}

/** Route multiplier `mu = 1 / p`. @param {ContractId} id @returns {Frac} */
export function routeMultiplier(id) {
  return Frac.ONE.div(marginalSurvival(id));
}

/* ------------------------------------------------------------------ *
 * actions
 * ------------------------------------------------------------------ */

/**
 * @typedef {{type:'BANK'}
 *   | {type:'ROUTE', contract: ContractId, laneSplit?: number|null}
 *   | {type:'SHELTER', shelter: number}} Action
 */

/** Normalise an action's optional lane balance to `null` when absent. */
function splitOf(action) {
  return action.laneSplit === undefined ? null : action.laneSplit;
}

/**
 * Legal actions at a decision point.
 * Banking is unavailable before the first arena: buying a run commits to running it.
 * @param {number} arena 1-based
 * @param {number} alive
 * @returns {Action[]}
 */
export function actionsFor(arena, alive) {
  if (!Number.isSafeInteger(arena) || arena < 1 || arena > CONFIG.arenas) {
    fail('INVALID_ARENA', `arena must be an integer in [1, ${CONFIG.arenas}]`);
  }
  assertRunnerCount(alive, 'alive');
  if (alive === 0) return Object.freeze([]);
  /** @type {Action[]} */
  const actions = [];
  if (arena > 1) actions.push(Object.freeze({ type: 'BANK' }));
  for (const id of CONTRACT_IDS) {
    if (alive < CONTRACTS[id].minRunners) continue;
    for (const laneSplit of laneSplitsFor(id, alive)) {
      actions.push(Object.freeze({ type: 'ROUTE', contract: id, laneSplit }));
    }
  }
  for (let k = 1; k <= alive - 1; k += 1) actions.push(Object.freeze({ type: 'SHELTER', shelter: k }));
  return Object.freeze(actions);
}

/** @param {Action} action @param {number} arena @param {number} alive */
export function assertLegalAction(action, arena, alive) {
  if (!action || typeof action !== 'object') fail('INVALID_ACTION', 'Action must be an object');
  const legal = actionsFor(arena, alive);
  const match = legal.some(
    (a) =>
      a.type === action.type &&
      a.contract === action.contract &&
      splitOf(a) === splitOf(action) &&
      a.shelter === action.shelter,
  );
  if (!match) {
    fail('ILLEGAL_ACTION', `Action ${JSON.stringify(action)} is illegal at arena ${arena} with ${alive} alive`);
  }
}

/**
 * The route configuration an action actually commits: which contract runs, how
 * many runners run it, and on what lane balance. `null` for BANK.
 * @param {Action} action
 * @param {number} alive
 * @returns {{contract: ContractId, runners: number, laneSplit: number|null}|null}
 */
export function committedConfiguration(action, alive) {
  if (action.type === 'BANK') return null;
  if (action.type === 'ROUTE') {
    return Object.freeze({ contract: action.contract, runners: alive, laneSplit: splitOf(action) });
  }
  if (action.type === 'SHELTER') {
    return Object.freeze({ contract: 'WIDE', runners: alive - action.shelter, laneSplit: null });
  }
  return fail('INVALID_ACTION', `Unknown action type: ${String(action.type)}`);
}

/**
 * @typedef {{prob: Frac, survivors: number, claimFactor: Frac, bankFactor: Frac, terminal: boolean}} Branch
 */

/**
 * Exact branch table for an action.
 *
 * `bankFactor` is credited immediately (times the incoming claim);
 * `claimFactor` is what the incoming claim is multiplied by to carry forward.
 * The invariant `sum(prob * (bankFactor + claimFactor)) == 1` holds for every
 * action — that is the whole economic model.
 *
 * @param {Action} action
 * @param {number} alive
 * @returns {Branch[]}
 */
export function branches(action, alive) {
  assertRunnerCount(alive, 'alive');
  if (alive === 0) fail('INVALID_SQUAD', 'No runners left to act');
  const n = F(BigInt(alive));

  if (action.type === 'BANK') {
    return Object.freeze([
      Object.freeze({
        prob: Frac.ONE,
        survivors: 0,
        claimFactor: Frac.ZERO,
        bankFactor: Frac.ONE,
        terminal: true,
      }),
    ]);
  }

  if (action.type === 'ROUTE') {
    const id = action.contract;
    const mu = routeMultiplier(id);
    const dist = survivorDistribution(id, alive, splitOf(action));
    return Object.freeze(
      dist.map((prob, m) =>
        Object.freeze({
          prob,
          survivors: m,
          claimFactor: F(BigInt(m)).div(n).mul(mu),
          bankFactor: Frac.ZERO,
          terminal: m === 0,
        }),
      ),
    );
  }

  if (action.type === 'SHELTER') {
    const k = action.shelter;
    if (!Number.isSafeInteger(k) || k < 1 || k > alive - 1) {
      fail('INVALID_ACTION', `SHELTER count must be an integer in [1, ${alive - 1}]`);
    }
    const running = alive - k;
    const mu = routeMultiplier('WIDE');
    const dist = survivorDistribution('WIDE', running);
    const banked = F(BigInt(k)).div(n);
    return Object.freeze(
      dist.map((prob, m) =>
        Object.freeze({
          prob,
          survivors: m,
          claimFactor: F(BigInt(m)).div(n).mul(mu),
          bankFactor: banked,
          terminal: m === 0,
        }),
      ),
    );
  }

  return fail('INVALID_ACTION', `Unknown action type: ${String(action.type)}`);
}

/** Exact expected total factor of an action: banked now plus carried forward. @param {Action} a @param {number} alive @returns {Frac} */
export function actionExpectedFactor(action, alive) {
  return branches(action, alive).reduce(
    (sum, b) => sum.add(b.prob.mul(b.bankFactor.add(b.claimFactor))),
    Frac.ZERO,
  );
}

/* ------------------------------------------------------------------ *
 * side bets — first-class tickets, priced against the committed configuration
 * ------------------------------------------------------------------ */

/**
 * The three side-bet events, defined on the survivor count `m` of the running
 * group. `pick` reads the probability straight out of the configuration's exact
 * survivor distribution, so pricing can never drift from the arena it rides on.
 */
export const SIDE_BETS = Object.freeze([
  Object.freeze({
    id: 'CLEAN_SWEEP',
    label: 'Clean Sweep',
    statement: 'every running Kindling clears this arena',
    /** @param {Frac[]} dist @param {number} runners */
    pick: (dist, runners) => dist[runners],
    predicate: (m, runners) => m === runners,
  }),
  Object.freeze({
    id: 'SOLE_SURVIVOR',
    label: 'Sole Survivor',
    statement: 'exactly one Kindling clears this arena',
    pick: (dist) => dist[1],
    predicate: (m) => m === 1,
  }),
  Object.freeze({
    id: 'LAST_LIGHT',
    label: 'Last Light',
    statement: 'no Kindling clears this arena',
    pick: (dist) => dist[0],
    predicate: (m) => m === 0,
  }),
]);

export const SIDE_BET_IDS = Object.freeze(SIDE_BETS.map((b) => b.id));

/** @param {string} id */
export function sideBet(id) {
  const found = SIDE_BETS.find((b) => b.id === id);
  if (!found) fail('UNKNOWN_SIDE_BET', `Unknown side bet: ${String(id)}`);
  return found;
}

/**
 * The side bets offered against a committed route configuration, with exact
 * probability and exact multiplier `r / P`.
 *
 * Offered only when at least `CONFIG.sideBet.minRunners` runners are running, so
 * the three events stay distinct (at `n = 1`, CLEAN SWEEP and SOLE SURVIVOR are
 * the same event and the card would be a lie).
 *
 * @param {ContractId} id
 * @param {number} runners
 * @param {number|null} [laneSplit]
 * @returns {{bet: SideBetId, label: string, contract: ContractId, runners: number,
 *            laneSplit: number|null, key: string, probability: Frac, multiplier: Frac, rtp: Frac}[]}
 */
export function sideBetOffers(id, runners, laneSplit = null) {
  if (runners < CONFIG.sideBet.minRunners) return Object.freeze([]);
  const dist = survivorDistribution(id, runners, laneSplit);
  return Object.freeze(
    SIDE_BETS.map((spec) => {
      const probability = spec.pick(dist, runners);
      if (probability.isZero()) {
        fail('INVALID_SIDE_BET', `${spec.id} on ${configKey(id, runners, laneSplit)} has zero probability`);
      }
      const multiplier = CONFIG.rtp.div(probability);
      return Object.freeze({
        bet: spec.id,
        label: spec.label,
        contract: id,
        runners,
        laneSplit,
        key: configKey(id, runners, laneSplit),
        probability,
        multiplier,
        rtp: probability.mul(multiplier),
      });
    }),
  );
}

/**
 * The side bets offered alongside a specific action. This is the binding that
 * was missing in the v1 draft: a side bet is priced against the configuration
 * the action actually commits, including SHELTER's reduced running group.
 * @param {Action} action
 * @param {number} alive
 */
export function sideBetOffersFor(action, alive) {
  const config = committedConfiguration(action, alive);
  if (!config) return Object.freeze([]);
  return sideBetOffers(config.contract, config.runners, config.laneSplit);
}

/**
 * The complete published side-bet paytable: every offer against every route
 * configuration the game can present. This is the table the adapter declares
 * and the adapter fingerprint covers.
 */
export function sideBetTable() {
  const rows = [];
  for (const spec of SIDE_BETS) {
    for (const config of routeConfigurations({ minRunners: CONFIG.sideBet.minRunners })) {
      const offer = sideBetOffers(config.contract, config.runners, config.laneSplit).find(
        (o) => o.bet === spec.id,
      );
      rows.push(offer);
    }
  }
  return Object.freeze(rows);
}

/** @returns {Frac} the largest multiplier anywhere in the side-bet paytable */
export function largestSideBetMultiplier() {
  return sideBetTable().reduce((m, r) => (r.multiplier.gt(m) ? r.multiplier : m), Frac.ZERO);
}

/* ------------------------------------------------------------------ *
 * decision-space analysis
 * ------------------------------------------------------------------ */

/**
 * Backward induction over the entire decision space.
 *
 * `value[arena][alive]` is the exact expected credited payout per unit of claim
 * held on entry to that arena, under the best (`max`) and worst (`min`)
 * deterministic policy. Because the two coincide at exactly 1 in every state,
 * every policy — deterministic, adaptive or randomised — yields the same RTP.
 *
 * @returns {{max: Frac[][], min: Frac[][], states: {arena:number, alive:number, max:Frac, min:Frac, actions:{action:Action, value:Frac}[]}[]}}
 */
export function stateValueDP() {
  const K = CONFIG.arenas;
  const N = CONFIG.squadSize;
  /** @type {Frac[][]} */
  const max = [];
  /** @type {Frac[][]} */
  const min = [];
  const states = [];

  // Arena K+1 is the finish line: the claim is banked at face value.
  max[K + 1] = [];
  min[K + 1] = [];
  for (let n = 0; n <= N; n += 1) {
    max[K + 1][n] = n === 0 ? Frac.ZERO : Frac.ONE;
    min[K + 1][n] = n === 0 ? Frac.ZERO : Frac.ONE;
  }

  for (let arena = K; arena >= 1; arena -= 1) {
    max[arena] = [];
    min[arena] = [];
    max[arena][0] = Frac.ZERO;
    min[arena][0] = Frac.ZERO;
    for (let alive = 1; alive <= N; alive += 1) {
      const evaluated = actionsFor(arena, alive).map((action) => {
        const table = branches(action, alive);
        const value = table.reduce((sum, b) => {
          const carried = b.survivors === 0 ? Frac.ZERO : b.claimFactor.mul(max[arena + 1][b.survivors]);
          return sum.add(b.prob.mul(b.bankFactor.add(carried)));
        }, Frac.ZERO);
        const valueMin = table.reduce((sum, b) => {
          const carried = b.survivors === 0 ? Frac.ZERO : b.claimFactor.mul(min[arena + 1][b.survivors]);
          return sum.add(b.prob.mul(b.bankFactor.add(carried)));
        }, Frac.ZERO);
        return { action, value, valueMin };
      });
      max[arena][alive] = evaluated.reduce((best, e) => (e.value.gt(best) ? e.value : best), Frac.ZERO);
      min[arena][alive] = evaluated.reduce(
        (worst, e) => (worst === null || e.valueMin.lt(worst) ? e.valueMin : worst),
        /** @type {Frac|null} */ (null),
      );
      states.push({
        arena,
        alive,
        max: max[arena][alive],
        min: min[arena][alive],
        actions: evaluated.map((e) => ({ action: e.action, value: e.value })),
      });
    }
  }
  return { max, min, states };
}

/**
 * Maximum credited payout per unit of claim, over every policy and every path
 * with non-zero probability. Used to bound the route ticket against the cap.
 * @returns {Frac[][]} indexed [arena][alive]
 */
export function maxPayoutDP() {
  const K = CONFIG.arenas;
  const N = CONFIG.squadSize;
  /** @type {Frac[][]} */
  const best = [];
  best[K + 1] = [];
  for (let n = 0; n <= N; n += 1) best[K + 1][n] = n === 0 ? Frac.ZERO : Frac.ONE;

  for (let arena = K; arena >= 1; arena -= 1) {
    best[arena] = [];
    best[arena][0] = Frac.ZERO;
    for (let alive = 1; alive <= N; alive += 1) {
      let top = Frac.ZERO;
      for (const action of actionsFor(arena, alive)) {
        for (const b of branches(action, alive)) {
          if (b.prob.isZero()) continue;
          const carried = b.survivors === 0 ? Frac.ZERO : b.claimFactor.mul(best[arena + 1][b.survivors]);
          const total = b.bankFactor.add(carried);
          if (total.gt(top)) top = total;
        }
      }
      best[arena][alive] = top;
    }
  }
  return best;
}

/**
 * The max-win cap analysis, in full, over the round's whole ticket portfolio.
 *
 * The v1 draft bounded the route ticket and each side-bet multiplier separately
 * and then asserted a per-round chain cap against a single stake — which is not
 * the same statement, and was false. The corrected statement has two parts,
 * both proved here:
 *
 *   (a) PER TICKET. No single ticket can pay more than `maxTicketMultiple`
 *       times its own stake. The route ticket's exact ceiling comes from
 *       `maxPayoutDP()`; each side bet's ceiling is its own multiplier.
 *
 *   (b) PER ROUND. Total credit in a round is a sum over tickets of
 *       `multiple_i * stake_i`, so `total / totalStake` is a weighted mean of
 *       ticket multiples and is therefore bounded by `maxTicketMultiple`. The
 *       endpoints of the published stake-limit interval are evaluated exactly
 *       below so the bound is a computation, not an argument.
 *
 * @returns {{routeTicketMax: Frac, sideBetMax: Frac, maxTicketMultiple: Frac,
 *            cap: Frac, headroom: Frac, ratioNoSideBets: Frac, ratioMaxSideBets: Frac,
 *            maxRoundRatio: Frac, maxRoundTotalPerRouteStake: Frac}}
 */
export function capAnalysis() {
  const cap = F(CONFIG.maxWinMultiple);
  const routeTicketMax = CONFIG.rtp.mul(maxPayoutDP()[1][CONFIG.squadSize]);
  const sideBetMax = largestSideBetMultiplier();
  const maxTicketMultiple = routeTicketMax.gt(sideBetMax) ? routeTicketMax : sideBetMax;

  // Round total as a multiple of TOTAL round stake, at both endpoints of the
  // side-bet stake interval [0, maxTotalStakeRatio] measured in route stakes.
  const T = CONFIG.sideBet.maxTotalStakeRatio;
  const ratioNoSideBets = routeTicketMax;
  const ratioMaxSideBets = routeTicketMax.add(sideBetMax.mul(T)).div(Frac.ONE.add(T));
  const maxRoundRatio = ratioNoSideBets.gt(ratioMaxSideBets) ? ratioNoSideBets : ratioMaxSideBets;

  return Object.freeze({
    routeTicketMax,
    sideBetMax,
    maxTicketMultiple,
    cap,
    headroom: cap.sub(maxTicketMultiple),
    ratioNoSideBets,
    ratioMaxSideBets,
    maxRoundRatio,
    /** Absolute worst-case round total expressed in route stakes (both limits maxed). */
    maxRoundTotalPerRouteStake: routeTicketMax.add(sideBetMax.mul(T)),
  });
}

/**
 * Exhaustive search for the round that actually pays the most.
 *
 * `capAnalysis()` gives an upper BOUND by a weighted-mean argument. This gives
 * the reachable MAXIMUM, by walking every action sequence with non-zero
 * probability and, on each one, choosing the stake allocation that maximises the
 * round total. The two together are what the cap obligation needs: a bound that
 * holds for every allocation, and a witness showing how close the game can
 * actually get.
 *
 * The stake optimisation is exact rather than searched. Total credit is
 * `routeCredit + sum_a m_a s_a` with `m_a` the realised side multiple on arena
 * `a`; it is linear in the stakes over a scaled simplex, so the optimum puts the
 * whole side allowance on the single best-paying winning side bet available on
 * that path. The ratio `(R + M tau) / (1 + tau)` is linear-fractional in `tau`
 * and therefore extremal at an endpoint of `[0, maxTotalStakeRatio]`.
 *
 * @returns {{paths: number, routeTicketMax: Frac, routeTicketLine: string[],
 *            roundRatioMax: Frac, roundRatioLine: string[],
 *            roundTotalPerRouteStakeMax: Frac, roundTotalLine: string[]}}
 */
let reachableCache = null;
export function reachableRoundMaxima() {
  if (reachableCache) return reachableCache;
  const T = CONFIG.sideBet.maxTotalStakeRatio;

  let paths = 0;
  let routeTicketMax = Frac.ZERO;
  let routeTicketLine = [];
  let roundRatioMax = Frac.ZERO;
  let roundRatioLine = [];
  let roundTotalMax = Frac.ZERO;
  let roundTotalLine = [];

  const record = (routeMultiple, bestSide, line) => {
    paths += 1;
    if (routeMultiple.gt(routeTicketMax)) {
      routeTicketMax = routeMultiple;
      routeTicketLine = line;
    }
    // ratio(tau) = (R + M tau) / (1 + tau); extremal at tau = 0 or tau = T.
    const atZero = routeMultiple;
    const atMax = routeMultiple.add(bestSide.mul(T)).div(Frac.ONE.add(T));
    const ratio = atZero.gt(atMax) ? atZero : atMax;
    if (ratio.gt(roundRatioMax)) {
      roundRatioMax = ratio;
      roundRatioLine = line;
    }
    const total = routeMultiple.add(bestSide.mul(T));
    if (total.gt(roundTotalMax)) {
      roundTotalMax = total;
      roundTotalLine = line;
    }
  };

  const walk = (arena, alive, claim, banked, bestSide, line) => {
    if (alive === 0 || arena > CONFIG.arenas) {
      record(banked.add(claim), bestSide, line);
      return;
    }
    for (const action of actionsFor(arena, alive)) {
      if (action.type === 'BANK') {
        record(banked.add(claim), bestSide, [...line, 'BANK']);
        continue;
      }
      const config = committedConfiguration(action, alive);
      const offers = sideBetOffersFor(action, alive);
      const label =
        action.type === 'SHELTER'
          ? `SHELTER${action.shelter}`
          : `${action.contract}${action.laneSplit === null ? '' : `(${action.laneSplit})`}`;
      for (const b of branches(action, alive)) {
        if (b.prob.isZero()) continue;
        let side = bestSide;
        for (const offer of offers) {
          const spec = sideBet(offer.bet);
          if (!spec.predicate(b.survivors, config.runners)) continue;
          if (offer.multiplier.gt(side)) side = offer.multiplier;
        }
        walk(
          arena + 1,
          b.survivors,
          claim.mul(b.claimFactor),
          banked.add(claim.mul(b.bankFactor)),
          side,
          [...line, `${label}->${b.survivors}`],
        );
      }
    }
  };

  walk(1, CONFIG.squadSize, CONFIG.rtp, Frac.ZERO, Frac.ZERO, []);

  reachableCache = Object.freeze({
    paths,
    routeTicketMax,
    routeTicketLine: Object.freeze(routeTicketLine),
    roundRatioMax,
    roundRatioLine: Object.freeze(roundRatioLine),
    roundTotalPerRouteStakeMax: roundTotalMax,
    roundTotalLine: Object.freeze(roundTotalLine),
  });
  return reachableCache;
}

/* ------------------------------------------------------------------ *
 * policy enumeration
 * ------------------------------------------------------------------ */

/**
 * @typedef {(arena: number, alive: number) => Action} Policy
 */

/**
 * A side-bet plan: given the arena, the squad size, the action and the route
 * configuration the action commits, return the tickets to place — each with a
 * stake expressed as an exact multiple of the ROUTE stake. Returning `[]` (the
 * default) plays the route ticket alone.
 * @typedef {(arena: number, alive: number, action: Action,
 *            config: {contract: ContractId, runners: number, laneSplit: number|null})
 *            => {bet: SideBetId, weight: Frac}[]} SideBetPlan
 */

/**
 * Enumerate the complete outcome space of a policy, optionally including a
 * side-bet plan.
 *
 * A side-bet plan may stake path-dependent amounts (a plan that bets every
 * arena stakes less on a round that ends early), so the published return is the
 * only definition that is correct in that case:
 *
 *     RTP = E[total credited] / E[total staked]
 *
 * The enumerator computes both expectations exactly over every leaf. When the
 * plan happens to stake a deterministic total — which is true of the route
 * ticket alone, and of any arena-1-only plan — that ratio coincides with the
 * mean of the per-round return multiple, and `stakeDeterministic` says so.
 *
 * `distribution` is over the per-round return multiple `credited / staked`,
 * which is what a player experiences regardless of plan shape.
 *
 * @param {Policy} policy
 * @param {SideBetPlan} [plan]
 */
export function enumeratePolicy(policy, plan = () => []) {
  if (typeof policy !== 'function') fail('INVALID_POLICY', 'Policy must be a function');
  if (typeof plan !== 'function') fail('INVALID_POLICY', 'Side-bet plan must be a function');
  /** @type {Map<string, {value: Frac, prob: Frac}>} */
  const outcomes = new Map();
  let leaves = 0;
  let expectedCredit = Frac.ZERO;
  let expectedStake = Frac.ZERO;
  /** @type {Frac|null} */
  let firstStake = null;
  let stakeDeterministic = true;

  const record = (credited, stakeWeight, prob) => {
    leaves += 1;
    expectedCredit = expectedCredit.add(prob.mul(credited));
    expectedStake = expectedStake.add(prob.mul(stakeWeight));
    if (firstStake === null) firstStake = stakeWeight;
    else if (!firstStake.eq(stakeWeight)) stakeDeterministic = false;
    const value = credited.div(stakeWeight);
    const key = value.toString();
    const existing = outcomes.get(key);
    if (existing) outcomes.set(key, { value, prob: existing.prob.add(prob) });
    else outcomes.set(key, { value, prob });
  };

  const walk = (arena, alive, claim, banked, staked, prob) => {
    if (prob.isZero()) return;
    if (alive === 0 || arena > CONFIG.arenas) {
      record(banked.add(claim), staked, prob);
      return;
    }
    const action = policy(arena, alive);
    assertLegalAction(action, arena, alive);
    if (action.type === 'BANK') {
      record(banked.add(claim), staked, prob);
      return;
    }

    const config = committedConfiguration(action, alive);
    const offers = sideBetOffersFor(action, alive);
    // The plan is handed the COMMITTED configuration, not the alive count: a
    // SHELTER runs a smaller group than the squad, and a side bet rides the
    // group that actually runs.
    const tickets = plan(arena, alive, action, config) ?? [];
    let arenaSideStake = Frac.ZERO;
    const priced = tickets.map((t) => {
      const offer = offers.find((o) => o.bet === t.bet);
      if (!offer) fail('INVALID_SIDE_BET', `${t.bet} is not offered at ${JSON.stringify(action)}`);
      if (t.weight.lte(Frac.ZERO) || t.weight.gt(CONFIG.sideBet.maxStakeRatioPerBet)) {
        fail('INVALID_SIDE_BET', `side-bet weight ${t.weight} is outside the published limits`);
      }
      arenaSideStake = arenaSideStake.add(t.weight);
      return { offer, weight: t.weight, spec: sideBet(t.bet) };
    });
    if (arenaSideStake.gt(CONFIG.sideBet.maxTotalStakeRatio)) {
      fail('INVALID_SIDE_BET', 'side-bet stake exceeds the published per-round limit');
    }

    for (const b of branches(action, alive)) {
      if (b.prob.isZero()) continue;
      let sideCredit = Frac.ZERO;
      for (const t of priced) {
        if (t.spec.predicate(b.survivors, config.runners)) {
          sideCredit = sideCredit.add(t.weight.mul(t.offer.multiplier));
        }
      }
      walk(
        arena + 1,
        b.survivors,
        claim.mul(b.claimFactor),
        banked.add(claim.mul(b.bankFactor)).add(sideCredit),
        staked.add(arenaSideStake),
        prob.mul(b.prob),
      );
    }
  };

  walk(1, CONFIG.squadSize, CONFIG.rtp, Frac.ZERO, Frac.ONE, Frac.ONE);

  const distribution = [...outcomes.values()].sort((a, b) => a.value.cmp(b.value));
  const totalProbability = distribution.reduce((s, o) => s.add(o.prob), Frac.ZERO);
  const mean = distribution.reduce((s, o) => s.add(o.prob.mul(o.value)), Frac.ZERO);
  const secondMoment = distribution.reduce((s, o) => s.add(o.prob.mul(o.value).mul(o.value)), Frac.ZERO);
  const variance = secondMoment.sub(mean.mul(mean));
  const maxReturn = distribution.reduce((m, o) => (o.value.gt(m) ? o.value : m), Frac.ZERO);

  return Object.freeze({
    leaves,
    stakeDeterministic,
    expectedCredit,
    expectedStake,
    /** E[credited] / E[staked] — the definition that survives path-dependent stakes. */
    rtp: expectedCredit.div(expectedStake),
    totalProbability,
    mean,
    secondMoment,
    variance,
    maxReturn,
    distribution: Object.freeze(distribution),
  });
}

/** @param {{value:Frac,prob:Frac}[]} distribution @param {Frac} threshold @returns {Frac} */
export function probabilityAtLeast(distribution, threshold) {
  return distribution.reduce((s, o) => (o.value.gte(threshold) ? s.add(o.prob) : s), Frac.ZERO);
}

/** @param {{value:Frac,prob:Frac}[]} distribution @returns {Frac} */
export function probabilityOfZero(distribution) {
  return distribution.reduce((s, o) => (o.value.isZero() ? s.add(o.prob) : s), Frac.ZERO);
}

/** Balanced SPLIT geometry for a running group — the UI default. */
export function balancedSplit(alive) {
  return Math.ceil(alive / 2);
}

/** Most lopsided legal SPLIT geometry: the largest lead lane, one scout alone. */
export function scoutSplit(alive) {
  return alive - 1;
}

/** Canonical named policies used for the published volatility profile. */
export const POLICIES = Object.freeze({
  BANK_AFTER_ONE: {
    label: 'Bolt (Wide, bank after arena 1)',
    fn: (arena) => (arena === 1 ? { type: 'ROUTE', contract: 'WIDE' } : { type: 'BANK' }),
  },
  ALL_WIDE: {
    label: 'Ranger (Wide x5)',
    fn: () => ({ type: 'ROUTE', contract: 'WIDE' }),
  },
  ALL_SPLIT: {
    label: 'Forker (Split x5 balanced, Wide when alone)',
    fn: (_arena, alive) =>
      alive >= 2
        ? { type: 'ROUTE', contract: 'SPLIT', laneSplit: balancedSplit(alive) }
        : { type: 'ROUTE', contract: 'WIDE' },
  },
  SCOUT_SPLIT: {
    label: 'Scout (Split x5 lopsided, Wide when alone)',
    fn: (_arena, alive) =>
      alive >= 2
        ? { type: 'ROUTE', contract: 'SPLIT', laneSplit: scoutSplit(alive) }
        : { type: 'ROUTE', contract: 'WIDE' },
  },
  ALL_NARROW: {
    label: 'Knife (Narrow x5)',
    fn: () => ({ type: 'ROUTE', contract: 'NARROW' }),
  },
  SHELTER_LADDER: {
    label: 'Keeper (Shelter half, then Wide)',
    fn: (_arena, alive) =>
      alive >= 2 ? { type: 'SHELTER', shelter: Math.floor(alive / 2) } : { type: 'ROUTE', contract: 'WIDE' },
  },
  SPLIT_THEN_NARROW: {
    label: 'Gambit (Split x3, then Narrow x2)',
    fn: (arena, alive) => {
      if (arena <= 3) {
        return alive >= 2
          ? { type: 'ROUTE', contract: 'SPLIT', laneSplit: balancedSplit(alive) }
          : { type: 'ROUTE', contract: 'WIDE' };
      }
      return { type: 'ROUTE', contract: 'NARROW' };
    },
  },
  ADAPTIVE_GUARD: {
    label: 'Adaptive (Narrow while >=4 alive, Split below, bank at 1 alive)',
    fn: (arena, alive) => {
      if (alive === 1 && arena > 1) return { type: 'BANK' };
      if (alive >= 4) return { type: 'ROUTE', contract: 'NARROW' };
      return alive >= 2
        ? { type: 'ROUTE', contract: 'SPLIT', laneSplit: balancedSplit(alive) }
        : { type: 'ROUTE', contract: 'WIDE' };
    },
  },
  ADAPTIVE_GREEDY: {
    label: 'Greedy (Split until a runner falls, then Narrow to the end)',
    fn: (_arena, alive) => {
      if (alive === CONFIG.squadSize) {
        return { type: 'ROUTE', contract: 'SPLIT', laneSplit: balancedSplit(alive) };
      }
      return { type: 'ROUTE', contract: 'NARROW' };
    },
  },
});

/**
 * Canonical named side-bet plans. Each is a portfolio layered on top of a route
 * policy; the enumerator proves every one of them still returns exactly `r` on
 * total money staked, which is the statement the v1 draft asserted without
 * having the side bets in its state space at all.
 */
export const SIDE_BET_PLANS = Object.freeze({
  NONE: {
    label: 'route ticket only',
    fn: () => [],
  },
  SWEEP_EVERY_ARENA: {
    label: '+ Clean Sweep every arena at 1/10 the route stake',
    fn: (_arena, _alive, _action, config) =>
      config.runners >= CONFIG.sideBet.minRunners ? [{ bet: 'CLEAN_SWEEP', weight: F(1n, 10n) }] : [],
  },
  LAST_LIGHT_EVERY_ARENA: {
    label: '+ Last Light every arena at 1/10 the route stake',
    fn: (_arena, _alive, _action, config) =>
      config.runners >= CONFIG.sideBet.minRunners ? [{ bet: 'LAST_LIGHT', weight: F(1n, 10n) }] : [],
  },
  MAX_SOLE_SURVIVOR: {
    label: '+ Sole Survivor at the maximum legal stake, arena 1 only',
    fn: (arena, _alive, _action, config) =>
      arena === 1 && config.runners >= CONFIG.sideBet.minRunners
        ? [{ bet: 'SOLE_SURVIVOR', weight: CONFIG.sideBet.maxStakeRatioPerBet }]
        : [],
  },
  ALL_THREE_FIRST_ARENA: {
    label: '+ all three side bets on arena 1 at 1/3 the route stake each',
    fn: (arena, _alive, _action, config) =>
      arena === 1 && config.runners >= CONFIG.sideBet.minRunners
        ? SIDE_BET_IDS.map((bet) => ({ bet, weight: F(1n, 3n) }))
        : [],
  },
});
