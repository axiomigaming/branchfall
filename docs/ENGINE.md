# BRANCHFALL on Reveal Engine — the `staged-survival` lifecycle module

**Status:** specification for a module that does not exist yet in
`@axiom-games/reveal-engine` (currently `0.2.0`, API `reveal-engine/api-v1`).
This document is the build order for it. The compilable form of every type below
is [`../src/staged-survival.ts`](../src/staged-survival.ts), and the concrete
BRANCHFALL declaration is [`../src/branchfall.adapter.ts`](../src/branchfall.adapter.ts);
both are checked by `npm run typecheck`.

---

## 1. Why a new lifecycle module

Reveal Engine 0.2 ships one lifecycle: a **progressive information market**.
A round has a single hidden truth drawn from declared priors, a stream of
evidence events that update an exact rational posterior, and a `RoundBook` that
prices claims against that posterior (`src/core/posterior.ts`,
`src/protocol/round-book.ts`). BLACK SIGNAL is that shape.

BRANCHFALL is not that shape. There is no single truth to converge on and no
posterior to price against. Instead:

| | progressive information market | staged survival |
| --- | --- | --- |
| Hidden state | one truth index | a hazard table over stages x routes x lanes |
| Player agency | pick an outcome, hold or liquidate | pick a route geometry, shelter, bank |
| Pricing | `r / p_i` from a live posterior | `1 / p` per stage, margin charged once at entry |
| Correlation | n/a | explicit: shared lane collapse + independent per-runner checks |
| Terminal event | truth revealed | squad reaches zero, or player banks, or finish line |
| Money carrier | one contingent claim | a claim divided among surviving runners |

Forcing BRANCHFALL through the posterior API would mean encoding a squad-state
lattice as "outcomes" and faking evidence events — a lie in the transcript and a
guarantee of a wrong `adapterFingerprint`. The correct move is a second
lifecycle module beside the first.

### 1.1 What is reused unchanged

`staged-survival` is a **new lifecycle on the existing core**, not a fork. It
consumes, without modification:

| Reveal Engine surface | Used for |
| --- | --- |
| `core/rational` (`Rational`, `add/mul/div/floor/compare`) | every probability, multiplier and claim value |
| `core/fairness` (`normalizeSeed`, `uniformBigInt`, `sha256Hex`) | seed handling and unbiased rejection sampling |
| `internal/canonical` (`encodeFields`, `constantTimeHexEqual`) | canonical commitment bytes, timing-safe compare |
| `core/payments` (`payable`, `payableWithinCap`) | floor rounding and the chain cap at every credit |
| `api/errors` (`RevealEngineError`, stable `code`/`path`) | the untrusted-input boundary |
| `api/limits` (`ENGINE_LIMITS`) | bounded ids, labels, payload sizes, BigInt width |
| `serialization` (bounded JSON parsing, fail-closed on unknown versions) | transcript and snapshot wire formats |
| receipt/ledger discipline, idempotency fingerprints, frame-vs-ledger revision split | money movement |

### 1.2 What is new

1. `HazardSchedule` — replaces `EvidenceSchedule`. Derives a complete,
   counterfactually complete hazard table instead of a stream of evidence.
2. `RouteContract` — a lane geometry plus a `LaneProfile` (`collapse`, `clear`).
3. A squad-aware frame: `alive: SquadSlot[]` and a carried `claim: Rational`.
4. `SHELTER` — an action that credits part of the claim mid-round, which the
   existing lifecycle has no analogue for.
5. `continuationRtp` — pinned to exactly `1`, which is what makes every policy
   equal-RTP (`MATH.md` §8).
6. `capMustBeUnreachable` — a declarative risk flag that turns "the cap never
   clips an advertised win" into a build-time obligation.

---

## 2. Module boundary

```
src/protocol/staged-survival/
  contracts.ts     types only; no algorithms
  adapter.ts       defineStagedSurvival(), adapterFingerprint()
  hazard.ts        derivation, canonical bytes, commitment
  resolve.ts       lane assignment, arena resolution, claim transform
  book.ts          StagedSurvivalBook: frames, actions, receipts, cap, snapshot
  conformance.ts   mechanical adapter checks
```

Same discipline as the existing layers: `core` has no player balance,
`protocol` has no presentation, `serialization` is the untrusted boundary,
`conformance` produces evidence and never certification.

---

## 3. The adapter surface

The full typed surface lives in [`../src/staged-survival.ts`](../src/staged-survival.ts).
The load-bearing parts:

```ts
/** Exact rational. Reduced, denominator strictly positive. */
export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** Money is integer minor units. Never a float, never a Number. */
export type Micro = bigint;

/**
 * A lane is a group of runners whose fates are correlated by a shared collapse.
 * Marginal per-runner survival is (1 - collapse) * clear and MUST be identical
 * across every lane of a contract: that identity is what makes route choice
 * EV-neutral.
 */
export interface LaneProfile {
  readonly collapse: Rational;
  readonly clear: Rational;
}

export interface RouteContract {
  readonly id: string;
  readonly label: string;
  readonly laneCount: number;
  readonly minRunners: number;
  readonly profile: LaneProfile;
  /** Pure; must return exactly `laneCount` sizes summing to `runners`. */
  laneSizes(runners: number): readonly number[];
}

export interface HazardSchedule {
  readonly modelVersion: string;
  readonly arenas: number;
  readonly squadSize: number;
  /** Pure, total, deterministic. Same seed + context => identical table. */
  derive(seedHex: string, context: RoundContext): HazardTable;
}

export type StagedSurvivalAction =
  | { readonly type: 'BANK' }
  | { readonly type: 'ROUTE'; readonly contractId: string }
  | { readonly type: 'SHELTER'; readonly shelter: readonly SquadSlot[] };

export interface StagedSurvivalDefinition {
  readonly apiVersion: 'reveal-engine/api-v1';
  readonly lifecycle: 'reveal-engine/staged-survival-v1';
  readonly id: string;
  readonly adapterVersion: string;
  readonly squadSize: number;
  readonly arenas: number;
  readonly contracts: readonly RouteContract[];
  readonly hazard: HazardSchedule;
  readonly pricing: {
    /** House margin, charged once when the run is bought. */
    readonly firstEntryRtp: Rational;
    /** MUST be exactly 1/1: money already in the round rides at fair odds. */
    readonly continuationRtp: Rational;
    readonly rounding: 'floor';
  };
  readonly risk: {
    readonly maxWinMultiple: bigint;
    /** When true, the build must prove the cap is unreachable. */
    readonly capMustBeUnreachable: boolean;
  };
  /** Cosmetic only. Must not appear in any fingerprint or probability path. */
  readonly cosmetics: {
    readonly defaultRunnerNames: readonly string[];
    readonly renamable: boolean;
  };
}

export interface StagedSurvivalModule {
  defineStagedSurvival(input: StagedSurvivalDefinition): StagedSurvivalDefinition;
  adapterFingerprint(game: StagedSurvivalDefinition): string;
  openRound(seedHex: string, game: StagedSurvivalDefinition, roundId: string): StagedSurvivalTranscript;
  offers(game: StagedSurvivalDefinition, frame: StagedSurvivalFrame): StagedSurvivalFrame['offers'];
  advance(
    game: StagedSurvivalDefinition,
    transcript: StagedSurvivalTranscript,
    frame: StagedSurvivalFrame,
    action: StagedSurvivalAction,
  ): { readonly frame: StagedSurvivalFrame; readonly resolution?: ArenaResolution; readonly creditMicro: Micro };
  verify(
    seedHex: string,
    game: StagedSurvivalDefinition,
    transcript: unknown,
    stakeMicro: Micro,
  ): VerificationResult;
}
```

`defineStagedSurvival()` is the only supported construction path: it validates,
clones, deep-freezes, and computes the fingerprint eagerly so a malformed adapter
cannot reach a round.

### 3.1 The BRANCHFALL declaration

```ts
export const branchfall = {
  apiVersion: 'reveal-engine/api-v1',
  lifecycle: 'reveal-engine/staged-survival-v1',
  id: 'branchfall',
  adapterVersion: '1.0.0',
  squadSize: 5,
  arenas: 5,
  contracts: [
    { id: 'WIDE',   laneCount: 1, minRunners: 1,
      profile: { collapse: 1n/25n, clear: 7n/8n } },   // p = 21/25, mu = 25/21
    { id: 'SPLIT',  laneCount: 2, minRunners: 2,
      profile: { collapse: 1n/10n, clear: 5n/6n } },   // p =  3/4,  mu =  4/3
    { id: 'NARROW', laneCount: 1, minRunners: 1,
      profile: { collapse: 1n/2n,  clear: 1n/2n } },   // p =  1/4,  mu =  4/1
  ],
  hazard: { modelVersion: 'branchfall-hazard/v1', arenas: 5, squadSize: 5, derive },
  pricing: { firstEntryRtp: 191n/200n, continuationRtp: 1n/1n, rounding: 'floor' },
  risk:    { maxWinMultiple: 1000n, capMustBeUnreachable: true },
  cosmetics: { defaultRunnerNames: ['Wren','Bramble','Ora','Tuck','Sable'], renamable: true },
};
```

(Rationals written as `a/b` above for readability; the real declaration uses
`{ numerator, denominator }` — see `src/branchfall.adapter.ts`.)

---

## 4. Hazard derivation

Reference implementation: [`../tools/transcript.mjs`](../tools/transcript.mjs).
The engine module must produce byte-identical tables; the frozen fixture in
`tests/fixtures/` is the conformance vector.

**Sampler.** Exact rejection sampling over 256 bits, same construction as
`core/fairness.uniformBigInt`:

```
value = HMAC-SHA256(seed, encodeFields([
  'branchfall/hazard-v1', gameId, roundId, arena, contractId, lane, kind, slot, nonce, modulus
]))
accept the first value < 2^256 - (2^256 mod modulus); result = value mod modulus
```

`kind` is `'collapse'` (with `slot = 0`) or `'slip'` (with `slot` = squad slot).
`modulus` is the denominator of the corresponding `Rational`; the event fires
when the draw is strictly less than the numerator.

| Contract | collapse modulus / threshold | slip modulus / threshold |
| --- | --- | --- |
| WIDE | 25, collapse iff draw < 1 | 8, clears iff draw < 7 |
| SPLIT | 10, collapse iff draw < 1 | 6, clears iff draw < 5 |
| NARROW | 2, collapse iff draw < 1 | 2, clears iff draw < 1 |

**Counterfactual completeness is mandatory.** The table covers every arena,
every contract, and every lane — including the routes the player will not take —
and it is derived and committed *before the player's first decision*. Two
consequences, both deliberate:

1. No operator can adapt an outcome to a choice. The choice only selects which
   pre-committed draws are consumed.
2. The unchosen branches remain verifiable after the reveal, which is what makes
   the "Ghost Line" replay (`DESIGN.md` §8) a proof rather than a flourish.

For BRANCHFALL the table is `5 arenas x 4 lanes x (1 collapse + 5 slips) = 120`
draws — small enough to commit and ship whole.

**Lane assignment** is a pure function of the running set: runners sorted by
squad slot, the leading `ceil(n/2)` to lane 0 and the rest to lane 1 for SPLIT,
all runners to lane 0 otherwise. Deterministic, so a verifier reproduces it.

---

## 5. Commitment and verification

```
commitment = SHA256(encodeFields([
  'commitment',
  'branchfall/commit-v1',
  seedBytes,
  canonicalHazardBytes(roundId, table),
]))

canonicalHazardBytes = encodeFields([
  'BRANCHFALL hazard table', schema, gameId, adapterVersion, modelVersion,
  roundId, squadSize, arenas,
  ...for each arena, contract (in declaration order), lane:
      arena, contractId, laneIndex, collapseDraw, ...(slot, slipDraw)
])
```

`encodeFields` is length-prefixed and type-tagged, so no two distinct field lists
share an encoding.

**Lifecycle.**

| Step | Who | What is public |
| --- | --- | --- |
| 1. Draw seed | operator | nothing |
| 2. Derive table, publish commitment | operator | `commitment`, `roundId`, adapter + model versions |
| 3. Player buys, plays | player | actions and resolutions as they happen |
| 4. Settlement | operator | revealed `seed` |
| 5. Verification | anyone | re-derive table, recompute commitment, replay actions |

Verification is total: re-derive from the seed, compare the commitment with a
constant-time hex compare, replay the recorded action list, and check every
credit against the recomputed ledger. Failure codes are stable and machine-
branchable: `INVALID_TRANSCRIPT`, `UNSUPPORTED_VERSION`, `ADAPTER_MISMATCH`,
`DERIVATION_FAILED`, `TRANSCRIPT_MISMATCH`, `COMMITMENT_MISMATCH`,
`ILLEGAL_ACTION`, `LEDGER_MISMATCH`. Integrations branch on `code`, never on
message text.

---

## 6. Money path

BRANCHFALL's `firstEntryRtp` is `191/200` — 95.5%, charged once — and its
`continuationRtp` is exactly `1`.

```
claim_1                     = stake x firstEntryRtp          (margin, charged once)
claim_{a+1}                 = claim_a x (m / n) x mu_C       (fair; continuationRtp = 1)
credit(SHELTER k of n)      = payableWithinCap(claim_a x k/n x stake, stake, cap, alreadyCredited)
credit(BANK | finish line)  = payableWithinCap(claim x stake, stake, cap, alreadyCredited)
```

- The claim is an exact `Rational` for the whole round. It is floored **only** at
  a credit event, never mid-round.
- The chain cap uses `alreadyCredited` exactly as `core/payments.payableWithinCap`
  does, so shelter withdrawals consume cap headroom.
- `mu_C = 1 / ((1 - collapse) * clear)`, computed from the declaration — never a
  hand-entered constant. A typo in a multiplier is impossible by construction.
- Money unit: micro-credits. Bounded rounding loss of 5 uc per round
  (`MATH.md` §10).

---

## 7. Conformance checks the module must run on any adapter

Mechanical, adapter-agnostic, and evidence — not certification.

1. `laneSizes(n)` returns exactly `laneCount` entries summing to `n`, for every
   `n` in `[minRunners, squadSize]`, and is stable across repeated calls.
2. Marginal survival `(1 - collapse) * clear` is identical for every lane of a
   contract, and strictly inside `(0, 1)`.
3. `sum_m P(m) = 1` exactly, for every contract and every squad size.
4. `sum_m P(m) * (m/n) * mu = 1` exactly — the fair-continuation property.
5. `continuationRtp == 1/1`. Reject the adapter otherwise: any other value
   re-charges margin per stage and silently destroys the equal-RTP guarantee.
6. `firstEntryRtp` in `(0, 1]`; the adapter's declared band is enforced by CI.
7. `derive()` is deterministic: called twice with the same seed and context it
   returns identical tables. Called with a different `roundId` it does not.
8. `derive()` never reads the player's actions. Enforced structurally: the
   signature has no action parameter.
9. If `risk.capMustBeUnreachable`, the maximum credited payout over all policies
   (backward induction, exact) is strictly below `maxWinMultiple`, and every
   side-bet multiplier is at most `maxWinMultiple`.
10. Every declarative field is frozen; the fingerprint is stable across
    re-construction and changes when any declarative field changes.

Checks 3, 4 and 9 are already implemented and run on every CI run here by
[`../tools/enumerate.mjs`](../tools/enumerate.mjs) (488 exact invariants).

---

## 8. Fingerprint and versioning

`adapterFingerprint` is SHA-256 over `encodeFields` of, in order: API version,
lifecycle id, game id, adapter version, hazard `modelVersion`, `squadSize`,
`arenas`, then for each contract in declaration order its id, `laneCount`,
`minRunners`, and the four `collapse`/`clear` BigInts, then `firstEntryRtp`,
`continuationRtp`, `rounding`, `maxWinMultiple`, `capMustBeUnreachable`.

**Cosmetics are excluded.** Runner names must not enter the fingerprint,
because a player renaming a Kindling must not change the identity of the game
they are playing.

| Identity | Current | Change rule |
| --- | --- | --- |
| Engine API | `reveal-engine/api-v1` | new value for a breaking runtime/type contract |
| Lifecycle | `reveal-engine/staged-survival-v1` | new value for a breaking lifecycle contract |
| Adapter | `branchfall` @ `1.0.0` | bump for **any** replay-visible change |
| Hazard model | `branchfall-hazard/v1` | bump for any change to derivation behaviour |
| Commitment | `branchfall/commit-v1` | new rounds use current; old is verification-only |
| Transcript | `branchfall/transcript-v1` | bounded migration parser; unknown versions fail closed |
| Receipt | `reveal-engine/receipt-v1` | immutable money-movement record |

Changing a `collapse`, a `clear`, `squadSize`, `arenas`, lane assignment,
`firstEntryRtp`, rounding or the cap is replay-visible: bump `adapterVersion`,
re-run `npm run enumerate:markdown`, re-publish `docs/MATH.md`, and let the
paytable test confirm it. An integration must retain the exact adapter
implementation for as long as any round it settled remains verifiable.

---

## 9. RGS integration obligations

The module supplies deterministic state transitions. It is not a wallet, not a
database, and not a session manager.

**Never accept from a client:** a seed, a hazard table or any draw from it, a
claim value, a multiplier, a survivor set, an adapter fingerprint, a cap basis,
a receipt, or a credited amount. Client-controlled input is limited to: the
chosen action (route id, shelter slot list, bank), an optional side-bet id and
stake, an opaque idempotency key, and the observed frame revision.

**One transaction per command:** idempotency lookup, frame-revision check,
authorization, debit/credit, state transition, receipt append, snapshot persist.

**Persist for the life of the liability:** engine API version, lifecycle id,
package release identity, adapter id/version/fingerprint, hazard `modelVersion`,
commitment and its publication timestamp, the revealed seed, the ordered action
list, frame and ledger revisions, the cap basis, the receipt log.

**Seed custody:** seeds are drawn from a reviewed CSPRNG, held server-side, and
revealed only at settlement. A seed revealed early lets a player read the whole
hazard table, including every unchosen route — which is precisely as bad as it
sounds, and is the single highest-severity failure mode in this design.

---

## 10. Threat model notes specific to this lifecycle

| Threat | Control |
| --- | --- |
| Operator adapts outcomes to the player's route choice | The whole table, all routes, is committed before the first decision; unchosen branches are verifiable after the reveal |
| Early seed disclosure | Seed server-side until settlement; commitment published without it; treat disclosure as a round-void incident |
| Client claims a survivor set | Survivors are re-derived server-side; client input carries no outcome |
| Replay/duplicate action | Idempotency key bound to a canonical command fingerprint; exact retries replay the stored receipt, changed payloads fail `IDEMPOTENCY_CONFLICT` |
| Stale-frame action after a resolve | Frame revision is separate from ledger revision; a mismatched `expectedFrameRevision` fails closed |
| Hostile shelter list (duplicates, dead runners, all runners, non-integers) | Validated: distinct, alive, `1 <= k <= n-1`, integer slots in range |
| Oversized or malformed transcript | Bounded parser, `ENGINE_LIMITS`, fail closed on unknown versions |
| Float creeping into a money path | No `number` type in any money or probability signature; `Rational` and `bigint` only; lint rule bans `parseFloat`/`Number(` in the money path |
| Cap silently clipping an advertised win | `capMustBeUnreachable` proven in CI; a violation breaks the build instead of the player's payout |

---

## 11. Delivery order

1. `contracts.ts` + `adapter.ts` (types, `defineStagedSurvival`, fingerprint).
2. `hazard.ts` against the frozen fixture in `tests/fixtures/`.
3. `resolve.ts`, cross-checked against `tools/enumerate.mjs` distributions.
4. `book.ts` with receipts, chain cap, snapshot/restore.
5. `conformance.ts` implementing §7.
6. `reveal-verify --lifecycle staged-survival` CLI support.
7. Export from `@axiom-games/reveal-engine/protocol`; minor version bump
   (additive), no change to `reveal-engine/api-v1`.

---

## 12. Certification boundary

This is a specification and a reference implementation of the derivation and
replay path. It is not a fairness certificate, an RNG certificate, a mathematical
certification, regulatory approval, a penetration-test attestation, or proof of a
deployed game's RTP. Deployment requires frozen configuration, independently
reviewed seed custody, operator integration and wallet audit, jurisdictional
analysis, a reserve and risk model, production load evidence, incident controls,
and any required laboratory process.
