/**
 * BRANCHFALL adapter declaration.
 *
 * Every number below is exact. Change any of them and you have changed
 * replay-visible behaviour: bump `adapterVersion`, regenerate the paytable in
 * `docs/MATH.md` (`npm run enumerate:markdown`), and let CI re-prove it.
 *
 * The canonical runtime source of these constants is `tools/lib/model.mjs`,
 * which the enumerator and the tests consume. This file is the typed
 * declaration the engine adapter layer expects; `tests/adapter-declaration.test.mjs`
 * asserts the two never drift apart.
 */

import {
  ENGINE_API_VERSION,
  LIFECYCLE_MODULE,
  type HazardSchedule,
  type Rational,
  type RouteContract,
  type StagedSurvivalDefinition,
} from './staged-survival.js';

const rational = (numerator: bigint, denominator: bigint): Rational => ({ numerator, denominator });

export const WIDE: RouteContract = Object.freeze({
  id: 'WIDE',
  label: 'Wide',
  laneCount: 1,
  minRunners: 1,
  profile: Object.freeze({ collapse: rational(1n, 25n), clear: rational(7n, 8n) }),
  laneSizes: (runners: number) => Object.freeze([runners]),
});

export const SPLIT: RouteContract = Object.freeze({
  id: 'SPLIT',
  label: 'Split',
  laneCount: 2,
  minRunners: 2,
  profile: Object.freeze({ collapse: rational(1n, 10n), clear: rational(5n, 6n) }),
  laneSizes: (runners: number) => Object.freeze([Math.ceil(runners / 2), Math.floor(runners / 2)]),
});

export const NARROW: RouteContract = Object.freeze({
  id: 'NARROW',
  label: 'Narrow',
  laneCount: 1,
  minRunners: 1,
  profile: Object.freeze({ collapse: rational(1n, 2n), clear: rational(1n, 2n) }),
  laneSizes: (runners: number) => Object.freeze([runners]),
});

/**
 * Hazard derivation is implemented by the lifecycle module against the
 * reference algorithm in `tools/transcript.mjs`:
 * `HMAC-SHA256(seed, encodeFields(['branchfall/hazard-v1', gameId, roundId,
 * arena, contractId, lane, kind, slot, nonce, modulus]))` with exact rejection
 * sampling. The declaration only pins identity and shape.
 */
export const hazard: Pick<HazardSchedule, 'modelVersion' | 'arenas' | 'squadSize'> = Object.freeze({
  modelVersion: 'branchfall-hazard/v1',
  arenas: 5,
  squadSize: 5,
});

export const branchfall: Omit<StagedSurvivalDefinition, 'hazard'> & {
  readonly hazard: typeof hazard;
} = Object.freeze({
  apiVersion: ENGINE_API_VERSION,
  lifecycle: LIFECYCLE_MODULE,
  id: 'branchfall',
  adapterVersion: '1.0.0',
  squadSize: 5,
  arenas: 5,
  contracts: Object.freeze([WIDE, SPLIT, NARROW]),
  hazard,
  pricing: Object.freeze({
    /** 95.5%, charged once when the run is bought. */
    firstEntryRtp: rational(191n, 200n),
    /** Exactly 1: money already in the round rides at fair odds. */
    continuationRtp: rational(1n, 1n),
    rounding: 'floor' as const,
  }),
  risk: Object.freeze({
    maxWinMultiple: 1000n,
    capMustBeUnreachable: true,
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
