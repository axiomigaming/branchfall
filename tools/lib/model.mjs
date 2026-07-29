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
 * *shape* of the survivor distribution differs sharply between contracts.
 *
 * Money rule in one sentence
 * --------------------------
 * Every runner carries an equal share of the squad's claim; a runner who
 * clears an arena has their share multiplied by the route multiplier
 * `mu = 1 / p`; a runner who falls loses their share.
 *
 * Consequence: `E[claim after arena] = claim before arena` for every contract,
 * every squad size and every shelter split. The house margin is charged once,
 * at entry (`claim_0 = stake * RTP`), and never again. Contract choice and
 * bank/continue choice reshape the distribution but cannot move the mean.
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

/**
 * Frozen game configuration. Any change here is a replay-visible change and
 * requires a new `adapterVersion` (see docs/ENGINE.md).
 */
export const CONFIG = Object.freeze({
  gameId: 'branchfall',
  adapterVersion: '1.0.0',
  modelVersion: 'branchfall-hazard/v1',
  /** Runners in a fresh squad. */
  squadSize: 5,
  /** Arenas in a full run. After the last arena the claim is banked automatically. */
  arenas: 5,
  /** Theoretical return to player, charged once at entry. */
  rtp: F(191n, 200n),
  /** Liability ceiling per round, as a multiple of the stake. */
  maxWinMultiple: 1000n,
  /** Money is denominated in micro-credits so floor rounding is negligible. */
  microCreditsPerCredit: 1_000_000n,
  /** Minimum stake in micro-credits (1.00 credit). */
  minStakeMicro: 1_000_000n,
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

/**
 * Deterministic lane sizes for a contract. SPLIT loads the leading lane first,
 * so the assignment is a pure function of the alive count.
 * @param {ContractId} id
 * @param {number} runners
 * @returns {number[]}
 */
export function laneSizes(id, runners) {
  const spec = contract(id);
  assertRunnerCount(runners, 'runners');
  if (runners < spec.minRunners) {
    fail('CONTRACT_UNAVAILABLE', `${id} requires at least ${spec.minRunners} runner(s)`);
  }
  if (spec.laneCount === 1) return [runners];
  return [Math.ceil(runners / 2), Math.floor(runners / 2)];
}

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
 * Exact distribution of surviving runners for a contract run by `runners` runners.
 * Lanes are independent; runners inside a lane are correlated through the collapse.
 * @param {ContractId} id
 * @param {number} runners
 * @returns {Frac[]} index m = survivors, length runners + 1
 */
export function survivorDistribution(id, runners) {
  const key = `${id}:${runners}`;
  const cached = distributionCache.get(key);
  if (cached) return cached;
  const spec = contract(id);
  const sizes = laneSizes(id, runners);
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

/**
 * @typedef {{type:'BANK'}
 *   | {type:'ROUTE', contract: ContractId}
 *   | {type:'SHELTER', shelter: number}} Action
 */

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
  if (alive === 0) return [];
  /** @type {Action[]} */
  const actions = [];
  if (arena > 1) actions.push(Object.freeze({ type: 'BANK' }));
  for (const id of CONTRACT_IDS) {
    if (alive >= CONTRACTS[id].minRunners) actions.push(Object.freeze({ type: 'ROUTE', contract: id }));
  }
  for (let k = 1; k <= alive - 1; k += 1) actions.push(Object.freeze({ type: 'SHELTER', shelter: k }));
  return Object.freeze(actions);
}

/** @param {Action} action @param {number} arena @param {number} alive */
export function assertLegalAction(action, arena, alive) {
  if (!action || typeof action !== 'object') fail('INVALID_ACTION', 'Action must be an object');
  const legal = actionsFor(arena, alive);
  const match = legal.some(
    (a) => a.type === action.type && a.contract === action.contract && a.shelter === action.shelter,
  );
  if (!match) {
    fail('ILLEGAL_ACTION', `Action ${JSON.stringify(action)} is illegal at arena ${arena} with ${alive} alive`);
  }
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
    const dist = survivorDistribution(id, alive);
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
        const value = branches(action, alive).reduce((sum, b) => {
          const carried = b.survivors === 0 ? Frac.ZERO : b.claimFactor.mul(max[arena + 1][b.survivors]);
          return sum.add(b.prob.mul(b.bankFactor.add(carried)));
        }, Frac.ZERO);
        const valueMin = branches(action, alive).reduce((sum, b) => {
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
 * with non-zero probability. Used to prove the max-win cap cannot bind.
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
 * @typedef {(arena: number, alive: number) => Action} Policy
 */

/**
 * Enumerate the complete outcome space of a policy.
 * Returns exact moments and the exact distribution of return multiples.
 * @param {Policy} policy
 * @returns {{
 *   leaves: number,
 *   totalProbability: Frac,
 *   mean: Frac,
 *   secondMoment: Frac,
 *   variance: Frac,
 *   maxReturn: Frac,
 *   distribution: {value: Frac, prob: Frac}[]
 * }}
 */
export function enumeratePolicy(policy) {
  if (typeof policy !== 'function') fail('INVALID_POLICY', 'Policy must be a function');
  /** @type {Map<string, {value: Frac, prob: Frac}>} */
  const outcomes = new Map();
  let leaves = 0;

  const record = (value, prob) => {
    leaves += 1;
    const key = value.toString();
    const existing = outcomes.get(key);
    if (existing) outcomes.set(key, { value, prob: existing.prob.add(prob) });
    else outcomes.set(key, { value, prob });
  };

  const walk = (arena, alive, claim, banked, prob) => {
    if (prob.isZero()) return;
    if (alive === 0 || arena > CONFIG.arenas) {
      record(banked.add(claim), prob);
      return;
    }
    const action = policy(arena, alive);
    assertLegalAction(action, arena, alive);
    if (action.type === 'BANK') {
      record(banked.add(claim), prob);
      return;
    }
    for (const b of branches(action, alive)) {
      if (b.prob.isZero()) continue;
      walk(
        arena + 1,
        b.survivors,
        claim.mul(b.claimFactor),
        banked.add(claim.mul(b.bankFactor)),
        prob.mul(b.prob),
      );
    }
  };

  walk(1, CONFIG.squadSize, CONFIG.rtp, Frac.ZERO, Frac.ONE);

  const distribution = [...outcomes.values()].sort((a, b) => a.value.cmp(b.value));
  const totalProbability = distribution.reduce((s, o) => s.add(o.prob), Frac.ZERO);
  const mean = distribution.reduce((s, o) => s.add(o.prob.mul(o.value)), Frac.ZERO);
  const secondMoment = distribution.reduce((s, o) => s.add(o.prob.mul(o.value).mul(o.value)), Frac.ZERO);
  const variance = secondMoment.sub(mean.mul(mean));
  const maxReturn = distribution.reduce((m, o) => (o.value.gt(m) ? o.value : m), Frac.ZERO);

  return Object.freeze({
    leaves,
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

/**
 * Side bets. Fresh money is priced at `RTP / P(event)`, so every side bet
 * returns exactly the house RTP regardless of the contract it is attached to.
 * Side bets require at least two running runners so the three events are distinct.
 * @returns {{bet:string, contract:ContractId, runners:number, probability:Frac, multiplier:Frac, rtp:Frac}[]}
 */
export function sideBetTable() {
  const rows = [];
  const events = [
    { bet: 'CLEAN SWEEP', pick: (dist, runners) => dist[runners] },
    { bet: 'SOLE SURVIVOR', pick: (dist) => dist[1] },
    { bet: 'LAST LIGHT', pick: (dist) => dist[0] },
  ];
  for (const { bet, pick } of events) {
    for (const id of CONTRACT_IDS) {
      for (let runners = 2; runners <= CONFIG.squadSize; runners += 1) {
        if (runners < CONTRACTS[id].minRunners) continue;
        const dist = survivorDistribution(id, runners);
        const probability = pick(dist, runners);
        if (probability.isZero()) fail('INVALID_SIDE_BET', `${bet} on ${id}/${runners} has zero probability`);
        const multiplier = CONFIG.rtp.div(probability);
        rows.push(
          Object.freeze({
            bet,
            contract: id,
            runners,
            probability,
            multiplier,
            rtp: probability.mul(multiplier),
          }),
        );
      }
    }
  }
  return Object.freeze(rows);
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
    label: 'Forker (Split x5, Wide when alone)',
    fn: (_arena, alive) => ({ type: 'ROUTE', contract: alive >= 2 ? 'SPLIT' : 'WIDE' }),
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
      if (arena <= 3) return { type: 'ROUTE', contract: alive >= 2 ? 'SPLIT' : 'WIDE' };
      return { type: 'ROUTE', contract: 'NARROW' };
    },
  },
  ADAPTIVE_GUARD: {
    label: 'Adaptive (Narrow while >=4 alive, Split below, bank at 1 alive)',
    fn: (arena, alive) => {
      if (alive === 1 && arena > 1) return { type: 'BANK' };
      if (alive >= 4) return { type: 'ROUTE', contract: 'NARROW' };
      return { type: 'ROUTE', contract: alive >= 2 ? 'SPLIT' : 'WIDE' };
    },
  },
  ADAPTIVE_GREEDY: {
    label: 'Greedy (Split until a runner falls, then Narrow to the end)',
    fn: (arena, alive) => {
      if (alive === CONFIG.squadSize) return { type: 'ROUTE', contract: 'SPLIT' };
      return { type: 'ROUTE', contract: 'NARROW' };
    },
  },
});
