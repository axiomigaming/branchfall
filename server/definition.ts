/**
 * The BRANCHFALL declaration, on the real engine.
 *
 * This is `docs/ENGINE.md` §3.1 expressed in the lifecycle module that actually
 * shipped: `@axiom-games/reveal-engine/modules/staged-survival`. The module is
 * generic (`N` entities through `S` stages, a contract menu, correlated lanes,
 * per-entity claims banked in subsets), so BRANCHFALL is a *definition* of it and
 * not a fork of it. Nothing in this file re-implements an engine behaviour.
 *
 * Two places where the shipped module's shape differs from the specification
 * written before it existed, both recorded here rather than smoothed over:
 *
 * 1. **The fork balance is a contract, not an argument.** `ENGINE.md` §3 gives a
 *    `RouteContract` a `laneSplits(n)` / `laneSizes(n, k)` pair and lets the
 *    player pick `k` at commit time. The module fixes a contract's geometry with
 *    a single `laneWidth` and cuts the live field into consecutive lanes of that
 *    width. Those coincide exactly when `k < n <= 2k`, which is precisely the
 *    canonical balance range `ceil(n/2) <= k <= n-1` the specification declares —
 *    so each legal lead-lane size is declared as its own contract (`SPLIT_k`) and
 *    the product menu in `geometry.ts` offers exactly the balances the model has
 *    at each squad size. `assertGeometryMatchesSpecification()` proves the two
 *    agree, size by size, at boot.
 * 2. **The cap basis is the round's external stake, not the ticket.** The module
 *    proves one basis (`round-external-stake`). For the route ticket those are
 *    the same object: every entity's entry is funded from the one route stake, so
 *    the basis is the route stake and the ceiling accumulates across shelter
 *    withdrawals, banks and settlement exactly as `ENGINE.md` §6 requires. Side
 *    bets are separate tickets with their own stakes and their own accumulators
 *    (`sidebets.ts`), which is the per-ticket basis the cap proof in `MATH.md` §9
 *    is written against.
 */
import { rational, type Rational } from '@axiom-games/reveal-engine/core';
import {
  ENGINE_API_VERSION,
  defineSurvivalGame,
  laneSizes as engineLaneSizes,
  survivalFingerprint,
  type StageContract,
  type SurvivalDefinition,
} from '@axiom-games/reveal-engine/modules/staged-survival';

/** `docs/MATH.md` §1: five runners, five arenas, `r = 191/200`, floor at micro-credits. */
export const SQUAD_SIZE = 5;
export const ARENAS = 5;
export const MICRO_PER_CREDIT = 1_000_000n;

/** `docs/MATH.md` §5.5. Micro-credits, both ends inclusive. */
export const MIN_STAKE_MICRO = 1_000_000n;
export const MAX_STAKE_MICRO = 1_000_000_000n;

/** `docs/DESIGN.md` §5.1 / `ENGINE.md` §6.2. A floor on committing money, never a deadline. */
export const MIN_GAME_CYCLE_MS = 5000;

/**
 * The declared speed-of-play citation, carried verbatim from `DESIGN.md` §5.1.
 *
 * `verifiedAgainstCertifiedCopy` is `false` and stays `false`: this repository has
 * not checked the lettering or the edition against a certified copy, and
 * declaring otherwise without doing the work is the defect the field exists to
 * expose.
 */
export const SPEED = Object.freeze({
  cycleUnit: 'arena' as const,
  minGameCycleMs: MIN_GAME_CYCLE_MS,
  maxDecisionCountdownMs: 0 as const,
  standard: 'UKGC RTS',
  standardEdition: 'RTS 2021-10-31',
  provision: 'RTS 14G',
  provisionVerifiedAgainstCertifiedCopy: false,
});

/** `docs/DESIGN.md` §10.1. Cosmetic, renamable, and deliberately outside the fingerprint. */
export const DEFAULT_RUNNER_NAMES: readonly string[] = Object.freeze([
  'Wren',
  'Bramble',
  'Ora',
  'Tuck',
  'Sable',
]);

/** `docs/DESIGN.md` §6.7. Five branches, in order. */
export const ARENA_NAMES: readonly string[] = Object.freeze([
  'Lowbranch',
  'The Grain',
  'Windrow',
  'The Char',
  'Crown',
]);

export const ARENA_SUBTITLES: readonly string[] = Object.freeze([
  'The widest bough on the tree, and the closest to the fog.',
  'The bark is gone. You run on the wood itself.',
  'The windward side. Everything here is scoured.',
  'A lightning scar. The stone here was cooked.',
  'The top. The Lamp is visible from the first frame.',
]);

const WIDE_PROFILE = { laneFailure: rational(1n, 25n), entitySurvival: rational(7n, 8n) };
const SPLIT_PROFILE = { laneFailure: rational(1n, 10n), entitySurvival: rational(5n, 6n) };
const NARROW_PROFILE = { laneFailure: rational(1n, 2n), entitySurvival: rational(1n, 2n) };

const WIDE_MULTIPLIER = rational(25n, 21n);
const SPLIT_MULTIPLIER = rational(4n, 3n);
const NARROW_MULTIPLIER = rational(4n, 1n);

/**
 * One `SPLIT_k` per legal lead-lane size.
 *
 * `minEntities = k + 1` is the module's own availability floor and it is the
 * correct one: a lead lane of `k` needs a field strictly larger than `k` or the
 * second lane is empty. The *upper* bound `n <= 2k` — the canonicalisation that
 * makes `[3,2]` and `[2,3]` one geometry — is not expressible in a module whose
 * menu filter is a floor, so it lives in the product menu (`geometry.ts`) and is
 * proved against the module's own `laneSizes()` at boot.
 */
function splitContract(k: number): StageContract {
  return {
    id: `SPLIT_${k}`,
    label: `The Fork — lead limb of ${k}`,
    laneWidth: k,
    minEntities: k + 1,
    profile: SPLIT_PROFILE,
    multiplier: SPLIT_MULTIPLIER,
  };
}

/**
 * The definition.
 *
 * `drawModulus` is `600 = lcm(25, 8, 10, 6, 2)`: every declared denominator
 * divides it exactly, so a survival test is an integer comparison and never a
 * rounded one.
 */
export const BRANCHFALL: SurvivalDefinition = defineSurvivalGame({
  apiVersion: ENGINE_API_VERSION,
  id: 'branchfall',
  version: '3.0.0',
  entities: SQUAD_SIZE,
  stages: ARENAS,
  drawModulus: 600n,
  contracts: [
    {
      id: 'WIDE',
      label: 'The Broad Bough — one lane, whole squad',
      laneWidth: SQUAD_SIZE,
      minEntities: 1,
      profile: WIDE_PROFILE,
      multiplier: WIDE_MULTIPLIER,
    },
    splitContract(1),
    splitContract(2),
    splitContract(3),
    splitContract(4),
    {
      id: 'NARROW',
      label: 'The Reach — single file, the point runner leads',
      laneWidth: SQUAD_SIZE,
      minEntities: 1,
      profile: NARROW_PROFILE,
      multiplier: NARROW_MULTIPLIER,
    },
  ],
  pricing: {
    entryReturn: rational(191n, 200n),
    continuationReturn: rational(1n),
    rounding: 'floor',
  },
  risk: { maxWinMultiple: 1000n, capBasis: 'round-external-stake', capMustBeUnreachable: true },
});

export const ENTRY_RETURN: Rational = BRANCHFALL.pricing.entryReturn;
export const MAX_WIN_MULTIPLE: bigint = BRANCHFALL.risk.maxWinMultiple;
export const FINGERPRINT: string = survivalFingerprint(BRANCHFALL);

/** The lane sizes `docs/MATH.md` §3.2 declares for a lead lane of `k` in a field of `n`. */
export function specificationLaneSizes(n: number, k: number): readonly number[] {
  return [k, n - k];
}

/**
 * Proves the module's geometry is the specification's geometry, at boot.
 *
 * This is the one place the `laneWidth`-for-`laneSplit` translation could be
 * silently wrong, and a wrong lane partition re-prices every correlated outcome
 * in the game — `docs/ENGINE.md` §8 works the example: hold the balances fixed,
 * redefine the sizes, and `P(wipe)` moves from `5/384` to `29/1152` under an
 * unchanged menu. So it is checked rather than reasoned about, for every squad
 * size and every balance the model declares.
 */
export function assertGeometryMatchesSpecification(): void {
  for (let n = 2; n <= SQUAD_SIZE; n += 1)
    for (let k = Math.ceil(n / 2); k <= n - 1; k += 1) {
      const contract = BRANCHFALL.contracts.find((candidate) => candidate.id === `SPLIT_${k}`);
      if (!contract) throw new Error(`No engine contract for lane balance ${k} of ${n}`);
      const engine = engineLaneSizes(contract, n);
      const declared = specificationLaneSizes(n, k);
      if (engine.length !== declared.length || engine.some((size, i) => size !== declared[i]))
        throw new Error(
          `SPLIT ${k}+${n - k} at ${n} runners: engine cuts [${engine.join(',')}], ` +
            `the specification declares [${declared.join(',')}]`,
        );
    }
  for (const id of ['WIDE', 'NARROW']) {
    const contract = BRANCHFALL.contracts.find((candidate) => candidate.id === id);
    if (!contract) throw new Error(`Missing contract ${id}`);
    for (let n = 1; n <= SQUAD_SIZE; n += 1) {
      const sizes = engineLaneSizes(contract, n);
      if (sizes.length !== 1 || sizes[0] !== n)
        throw new Error(`${id} at ${n} runners must be one lane of ${n}, got [${sizes.join(',')}]`);
    }
  }
}
