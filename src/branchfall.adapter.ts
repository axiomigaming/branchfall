/**
 * BRANCHFALL adapter declaration.
 *
 * Every number below is exact. Change any of them and you have changed
 * replay-visible behaviour: bump `adapterVersion`, regenerate the paytable in
 * `docs/MATH.md` (`npm run docs:sync`), and let CI re-prove it.
 *
 * The canonical runtime source of these constants is `tools/lib/model.mjs`,
 * which the enumerator and the tests consume. This file is the typed
 * declaration the engine adapter layer expects; `tests/adapter-declaration.test.mjs`
 * asserts the two never drift apart.
 *
 * Note what is NOT here: a side-bet multiplier. Prices are computed by the
 * lifecycle module as `firstEntryRtp / P(event | committed geometry)` from the
 * contract declaration, and `pricing.sideBetRule` pins that rule into the
 * fingerprint. An operator cannot re-price a side bet without changing the
 * game's identity.
 */

import {
  ENGINE_API_VERSION,
  LIFECYCLE_MODULE,
  type HazardSchedule,
  type Rational,
  type RouteContract,
  type SideBetSpec,
  type StagedSurvivalDefinition,
} from './staged-survival.js';

const rational = (numerator: bigint, denominator: bigint): Rational => ({ numerator, denominator });

/** Single-lane contracts have exactly one geometry. */
const oneGeometry = (): readonly (number | null)[] => Object.freeze([null]);
const oneLane = (runners: number, laneSplit: number | null): readonly number[] => {
  if (laneSplit !== null) throw new RangeError('this contract has one lane and takes no lane balance');
  return Object.freeze([runners]);
};

/**
 * SPLIT's lane balance is a player choice, canonicalised so the lead lane is
 * never the smaller half: `[3,2]` and `[2,3]` are the same geometry. At two and
 * three runners there is exactly one balance and the UI must not imply a choice;
 * at four and five there are two, and they differ materially (docs/MATH.md §3.2).
 */
const splitGeometries = (runners: number): readonly (number | null)[] => {
  const out: number[] = [];
  for (let k = Math.ceil(runners / 2); k <= runners - 1; k += 1) out.push(k);
  return Object.freeze(out);
};

const splitLanes = (runners: number, laneSplit: number | null): readonly number[] => {
  if (laneSplit === null || !splitGeometries(runners).includes(laneSplit)) {
    throw new RangeError(`SPLIT with ${runners} runners requires a legal lane balance`);
  }
  return Object.freeze([laneSplit, runners - laneSplit]);
};

export const WIDE: RouteContract = Object.freeze({
  id: 'WIDE',
  label: 'Wide',
  laneCount: 1,
  minRunners: 1,
  profile: Object.freeze({ collapse: rational(1n, 25n), clear: rational(7n, 8n) }),
  laneSplits: oneGeometry,
  laneSizes: oneLane,
});

export const SPLIT: RouteContract = Object.freeze({
  id: 'SPLIT',
  label: 'Split',
  laneCount: 2,
  minRunners: 2,
  profile: Object.freeze({ collapse: rational(1n, 10n), clear: rational(5n, 6n) }),
  laneSplits: splitGeometries,
  laneSizes: splitLanes,
});

export const NARROW: RouteContract = Object.freeze({
  id: 'NARROW',
  label: 'Narrow',
  laneCount: 1,
  minRunners: 1,
  profile: Object.freeze({ collapse: rational(1n, 2n), clear: rational(1n, 2n) }),
  laneSplits: oneGeometry,
  laneSizes: oneLane,
});

/**
 * The three side bets. Events only — never prices. `minRunners: 2` keeps the
 * three events distinct: with one runner, "everybody clears" and "exactly one
 * clears" are the same proposition and the card would be a lie.
 */
export const SIDE_BETS: readonly SideBetSpec[] = Object.freeze([
  Object.freeze({ id: 'CLEAN_SWEEP', label: 'Clean Sweep', event: 'ALL_CLEAR' as const, minRunners: 2 }),
  Object.freeze({ id: 'SOLE_SURVIVOR', label: 'Sole Survivor', event: 'EXACTLY_ONE' as const, minRunners: 2 }),
  Object.freeze({ id: 'LAST_LIGHT', label: 'Last Light', event: 'NONE' as const, minRunners: 2 }),
]);

/**
 * Hazard derivation is implemented by the lifecycle module against the
 * reference algorithm in `tools/transcript.mjs`:
 * `HMAC-SHA256(serverSeed, encodeFields(['branchfall/hazard-v2', clientSeed,
 * gameId, roundId, arena, contractId, lane, kind, slot, nonce, modulus]))`
 * with exact rejection sampling. The declaration only pins identity and shape.
 */
export const hazard: Pick<HazardSchedule, 'modelVersion' | 'arenas' | 'squadSize'> = Object.freeze({
  modelVersion: 'branchfall-hazard/v2',
  arenas: 5,
  squadSize: 5,
});

export const branchfall: Omit<StagedSurvivalDefinition, 'hazard'> & {
  readonly hazard: typeof hazard;
} = Object.freeze({
  apiVersion: ENGINE_API_VERSION,
  lifecycle: LIFECYCLE_MODULE,
  id: 'branchfall',
  adapterVersion: '2.0.0',
  squadSize: 5,
  arenas: 5,
  contracts: Object.freeze([WIDE, SPLIT, NARROW]),
  sideBets: SIDE_BETS,
  hazard,
  pricing: Object.freeze({
    /** 95.5%, charged once per ticket when that ticket is bought. */
    firstEntryRtp: rational(191n, 200n),
    /** Exactly 1: money already in the round rides at fair odds. */
    continuationRtp: rational(1n, 1n),
    /** The only legal side-bet pricing rule, pinned into the fingerprint. */
    sideBetRule: 'firstEntryRtp/probability' as const,
    rounding: 'floor' as const,
  }),
  limits: Object.freeze({
    /** 1.00 credit. */
    minStake: 1_000_000n,
    maxStake: 10n ** 15n,
    /** A side bet may never carry more money than the run it rides on. */
    maxSideBetStakeRatio: rational(1n, 1n),
    maxTotalSideBetStakeRatio: rational(1n, 1n),
  }),
  risk: Object.freeze({
    maxWinMultiple: 1000n,
    /** Per ticket, against that ticket's own stake. See docs/MATH.md §9. */
    capBasis: 'per-ticket' as const,
    capMustBeUnreachable: true,
  }),
  speed: Object.freeze({
    /** The game cycle is one arena: it is where money is committed. */
    cycleUnit: 'arena' as const,
    /** UKGC RTS 8 floor. A delay, never a countdown. */
    minGameCycleMs: 2500,
    maxDecisionCountdownMs: 0 as const,
  }),
  /**
   * Cosmetic only. Excluded from the adapter fingerprint by design: a player
   * renaming a runner must not change the identity of the game they are playing.
   */
  cosmetics: Object.freeze({
    defaultRunnerNames: Object.freeze(['Wren', 'Bramble', 'Ora', 'Tuck', 'Sable']),
    renamable: true,
  }),
});
