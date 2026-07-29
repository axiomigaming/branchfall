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
| Hidden state | one truth index | a hazard table over stages x routes x lanes x slots |
| Player agency | pick an outcome, hold or liquidate | pick a route geometry and its lane balance, shelter, bank |
| Pricing | `r / p_i` from a live posterior | `1 / p` per stage, margin charged once per ticket |
| Correlation | n/a | explicit: shared lane collapse + independent per-runner checks |
| Terminal event | truth revealed | squad reaches zero, or player banks, or finish line |
| Money carrier | one contingent claim | a claim divided among surviving runners, plus per-arena side tickets |

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
| `core/payments` (`payable`, `payableWithinCap`) | floor rounding and the per-ticket cap |
| `api/errors` (`RevealEngineError`, stable `code`/`path`) | the untrusted-input boundary |
| `api/limits` (`ENGINE_LIMITS`) | bounded ids, labels, payload sizes, BigInt width |
| `serialization` (bounded JSON parsing, fail-closed on unknown versions) | transcript and snapshot wire formats |
| receipt/ledger discipline, idempotency fingerprints, frame-vs-ledger revision split | money movement |

### 1.2 What is new

1. `HazardSchedule` — replaces `EvidenceSchedule`. Derives a complete,
   counterfactually complete hazard table instead of a stream of evidence, from
   **two** seeds.
2. `RouteContract` — a lane geometry plus a `LaneProfile` (`collapse`, `clear`),
   with a player-chosen lane balance (`laneSplits`, `laneSizes`).
3. A squad-aware frame: `alive: SquadSlot[]` and a carried `claim: Rational`.
4. `SHELTER` — an action that credits part of the claim mid-round, which the
   existing lifecycle has no analogue for.
5. `SideBetSpec` / `SideBetOffer` / `SideBetTicket` — per-arena tickets bought
   with fresh money, atomic with the route commitment, priced by the module.
6. `continuationRtp` — pinned to exactly `1`, which is what makes every policy
   equal-RTP (`MATH.md` §8).
7. `capBasis: 'per-ticket'` plus `capMustBeUnreachable` — a declarative risk
   pair that turns "the cap never clips an advertised win" into a build-time
   obligation with a stated basis.
8. `speed` — a minimum game cycle enforced in the state machine.

---

## 2. Module boundary

```
src/protocol/staged-survival/
  contracts.ts     types only; no algorithms
  adapter.ts       defineStagedSurvival(), adapterFingerprint()
  hazard.ts        two-seed derivation, canonical bytes, commitment, seed chain
  resolve.ts       lane assignment, arena resolution, claim transform
  sidebets.ts      event probabilities, pricing, stake limits
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

export interface RoundContext {
  readonly gameId: string;
  readonly roundId: string;
  readonly proofVersion: 'branchfall/commit-v2';
  /** Player-contributed entropy. Mandatory — see §10. */
  readonly clientSeed: string;
}

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
  /** Lane balances a player may choose. `[null]` when there is only one geometry. */
  laneSplits(runners: number): readonly (number | null)[];
  /** Pure; exactly `laneCount` sizes summing to `runners`; rejects an illegal balance. */
  laneSizes(runners: number, laneSplit: number | null): readonly number[];
}

export type SideBetEvent = 'ALL_CLEAR' | 'EXACTLY_ONE' | 'NONE';

/** Events only. The module computes prices; the adapter never declares one. */
export interface SideBetSpec {
  readonly id: string;
  readonly label: string;
  readonly event: SideBetEvent;
  readonly minRunners: number;
}

export interface SideBetTicket {
  readonly id: string;
  readonly stake: Micro;
  /** Recomputed and compared; a stale quote fails `QUOTE_MISMATCH`. */
  readonly quotedMultiplier: Rational;
}

export type StagedSurvivalAction =
  | { readonly type: 'BANK' }
  | {
      readonly type: 'ROUTE';
      readonly contractId: string;
      readonly laneSplit: number | null;
      readonly sideBets?: readonly SideBetTicket[];
    }
  | {
      readonly type: 'SHELTER';
      readonly shelter: readonly SquadSlot[];
      readonly sideBets?: readonly SideBetTicket[];
    };

export interface StagedSurvivalDefinition {
  readonly apiVersion: 'reveal-engine/api-v1';
  readonly lifecycle: 'reveal-engine/staged-survival-v1';
  readonly id: string;
  readonly adapterVersion: string;
  readonly squadSize: number;
  readonly arenas: number;
  readonly contracts: readonly RouteContract[];
  readonly sideBets: readonly SideBetSpec[];
  readonly hazard: HazardSchedule;
  readonly pricing: {
    readonly firstEntryRtp: Rational;
    /** MUST be exactly 1/1: money already in the round rides at fair odds. */
    readonly continuationRtp: Rational;
    /** The only legal value. Pinned into the fingerprint. */
    readonly sideBetRule: 'firstEntryRtp/probability';
    readonly rounding: 'floor';
  };
  readonly limits: {
    readonly minStake: Micro;
    readonly maxStake: Micro;
    readonly maxSideBetStakeRatio: Rational;
    readonly maxTotalSideBetStakeRatio: Rational;
  };
  readonly risk: {
    readonly maxWinMultiple: bigint;
    /** The cap basis. `per-ticket` is the only value the proof supports. */
    readonly capBasis: 'per-ticket';
    readonly capMustBeUnreachable: boolean;
  };
  readonly speed: {
    readonly cycleUnit: 'arena';
    readonly minGameCycleMs: number;
    readonly maxDecisionCountdownMs: 0;
  };
  readonly cosmetics: {
    readonly defaultRunnerNames: readonly string[];
    readonly renamable: boolean;
  };
}
```

**Side bets are attached to the action, not submitted separately.** That is a
correctness requirement, not an ergonomic one: a side bet must be irrevocably
placed at the same instant the geometry is committed, resolve from the same
survivor count, and appear in the same receipt. A separate `PLACE_SIDE_BET`
command would create a window in which a player has seen a route commitment and
not yet priced a bet against it.

**The adapter never declares a multiplier.** `sideBetProbability()` is a module
function over the committed geometry; the price is
`firstEntryRtp / probability` by the pinned `sideBetRule`. `SideBetTicket`
carries the multiplier the client was shown only so the module can recompute it
and reject any disagreement.

`defineStagedSurvival()` is the only supported construction path: it validates,
clones, deep-freezes, and computes the fingerprint eagerly so a malformed adapter
cannot reach a round.

### 3.1 The BRANCHFALL declaration

```ts
export const branchfall = {
  apiVersion: 'reveal-engine/api-v1',
  lifecycle: 'reveal-engine/staged-survival-v1',
  id: 'branchfall',
  adapterVersion: '2.0.0',
  squadSize: 5,
  arenas: 5,
  contracts: [
    { id: 'WIDE',   laneCount: 1, minRunners: 1,
      profile: { collapse: 1n/25n, clear: 7n/8n } },   // p = 21/25, mu = 25/21
    { id: 'SPLIT',  laneCount: 2, minRunners: 2,       // laneSplits(n) = ceil(n/2)..n-1
      profile: { collapse: 1n/10n, clear: 5n/6n } },   // p =  3/4,  mu =  4/3
    { id: 'NARROW', laneCount: 1, minRunners: 1,
      profile: { collapse: 1n/2n,  clear: 1n/2n } },   // p =  1/4,  mu =  4/1
  ],
  sideBets: [
    { id: 'CLEAN_SWEEP',   event: 'ALL_CLEAR',    minRunners: 2 },
    { id: 'SOLE_SURVIVOR', event: 'EXACTLY_ONE',  minRunners: 2 },
    { id: 'LAST_LIGHT',    event: 'NONE',         minRunners: 2 },
  ],
  hazard:  { modelVersion: 'branchfall-hazard/v2', arenas: 5, squadSize: 5, derive },
  pricing: { firstEntryRtp: 191n/200n, continuationRtp: 1n/1n,
             sideBetRule: 'firstEntryRtp/probability', rounding: 'floor' },
  limits:  { minStake: 1_000_000n, maxStake: 10n ** 15n,
             maxSideBetStakeRatio: 1n/1n, maxTotalSideBetStakeRatio: 1n/1n },
  risk:    { maxWinMultiple: 1000n, capBasis: 'per-ticket', capMustBeUnreachable: true },
  speed:   { cycleUnit: 'arena', minGameCycleMs: 2500, maxDecisionCountdownMs: 0 },
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
`core/fairness.uniformBigInt`, keyed by the **server** seed with the **client**
seed as a labelled field:

```
value = HMAC-SHA256(serverSeed, encodeFields([
  'branchfall/hazard-v2', clientSeed,
  gameId, roundId, arena, contractId, lane, kind, slot, nonce, modulus
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
every contract, every lane and **every squad slot in every lane** — including
routes the player will not take and lane balances they will not choose — and it
is fixed before the player's first decision. Two consequences, both deliberate:

1. No operator can adapt an outcome to a choice. The choice only selects which
   pre-committed draws are consumed. Because a slip draw exists for every slot in
   every lane, changing the fork balance re-selects draws that were already
   committed rather than requiring new ones.
2. The unchosen branches remain verifiable after the reveal, which is what makes
   the "Ghost Line" replay (`DESIGN.md` §8.2) a proof rather than a flourish.

For BRANCHFALL the table is
`5 arenas x 4 lanes x (1 collapse + 5 slips) = `<!-- fig:hazardDraws -->120<!-- /fig -->
draws — small enough to commit and ship whole.

**Lane assignment** is a pure function of the running set and the committed
balance: runners sorted by squad slot, the leading `laneSplit` to lane 0 and the
rest to lane 1 for SPLIT, all runners to lane 0 otherwise. Deterministic, so a
verifier reproduces it. Which *named* runner occupies which slot position is a
player choice with no distributional effect (`MATH.md` §5.4) and is recorded in
the transcript because it is what the replay needs to show.

---

## 5. Commitment and verification

The round has a **two-sided** commit-reveal, in this order and no other.

| Step | Who | What is published | What is still secret |
| --- | --- | --- | --- |
| 0. Publish the chain terminal (optional, recommended) | operator | `terminal = H^L(root)` | every seed in the chain |
| 1. Pre-commit | operator | `serverCommitment`, `roundId`, adapter + model versions, optional `chainNextHash` | the server seed |
| 2. Contribute entropy | player | `clientSeed` | nothing |
| 3. Open the round | operator | `hazardDigest`, the frame, the offers | the server seed |
| 4. Play | player | actions and resolutions as they happen | the server seed |
| 5. Settle | operator | the revealed server seed | nothing |
| 6. Verify | anyone | — | — |

```
serverCommitment = SHA256(encodeFields([
  'server commitment', 'branchfall/commit-v2',
  gameId, adapterVersion, modelVersion, roundId, serverSeedBytes,
]))

hazardDigest = SHA256(canonicalHazardBytes(roundId, clientSeed, table))

canonicalHazardBytes = encodeFields([
  'BRANCHFALL hazard table', schema, gameId, adapterVersion, modelVersion,
  roundId, clientSeed, squadSize, arenas,
  ...for each arena, contract (in declaration order), lane:
      arena, contractId, laneIndex, collapseDraw, ...(slot, slipDraw)
])
```

`encodeFields` is length-prefixed and type-tagged, so no two distinct field lists
share an encoding.

**Why step 1 precedes step 2 and cannot be reordered.** The commitment must be
computed from a value the operator cannot revise once it has seen the client
seed, and the table must not be derivable — by anyone — until both halves exist.
An implementation that derives the table at step 1 and merely mixes the client
seed in later has not built this protocol; it has built the one §10 says is
broken.

**Verification is total:** recompute the pre-commitment from the revealed server
seed and compare with a constant-time hex compare; verify the chain link if one
was published; re-derive the table from both seeds; compare the hazard digest;
replay the recorded action list; check every credit — route and side — against
the recomputed ledger. Failure codes are stable and machine-branchable:
`INVALID_TRANSCRIPT`, `UNSUPPORTED_VERSION`, `ADAPTER_MISMATCH`,
`DERIVATION_FAILED`, `TRANSCRIPT_MISMATCH`, `COMMITMENT_MISMATCH`,
`CHAIN_MISMATCH`, `MALFORMED_HAZARD`, `ILLEGAL_ACTION`, `INVALID_LANE_SPLIT`,
`INVALID_SIDE_BET`, `QUOTE_MISMATCH`, `LEDGER_MISMATCH`. Integrations branch on
`code`, never on message text.

### 5.1 Server-seed chains

`buildSeedChain(root, L)` produces `s_0 = root`, `s_i = SHA256(s_{i-1})`, and
publishes only `s_{L-1}`. Rounds consume the chain in reverse: round 1 reveals
`s_{L-2}`, round 2 reveals `s_{L-3}`, and each revealed seed is checked by one
forward hash against the previously published link.

This is optional in the protocol and **recommended in deployment**, because it
removes the operator's ability to choose a server seed per round at all: the
whole sequence is fixed by a single public value published before any of the
rounds existed. `verifyRound` checks the link whenever `chainNextHash` is
present, and `tools/transcript.mjs --chain 8` demonstrates it end to end.

---

## 6. Money path

BRANCHFALL's `firstEntryRtp` is `191/200` — 95.5%, charged once per ticket — and
its `continuationRtp` is exactly `1`.

```
claim_1                     = stake x firstEntryRtp          (margin, charged once)
claim_{a+1}                 = claim_a x (m / n) x mu_C       (fair; continuationRtp = 1)
credit(SHELTER k of n)      = payableWithinCap(claim_a x k/n x stake, stake, cap, routeCredited)
credit(BANK | finish line)  = payableWithinCap(claim x stake, stake, cap, routeCredited)
credit(side bet i)          = payableWithinCap(won ? mult_i x s_i : 0, s_i,  cap, 0)
```

- The claim is an exact `Rational` for the whole round. It is floored **only** at
  a credit event, never mid-round.
- **The cap basis is the ticket, not the round.** The route ticket accumulates
  against the route stake; each side bet is capped against its own stake, with a
  fresh accumulator. `MATH.md` §9 proves that neither can bind, and that the
  round total is bounded by the same multiple of total round stake.
- `mu_C = 1 / ((1 - collapse) * clear)`, computed from the declaration — never a
  hand-entered constant. A typo in a multiplier is impossible by construction.
- Side-bet stake limits (`maxSideBetStakeRatio`, `maxTotalSideBetStakeRatio`) are
  enforced at the command boundary before any debit. They are load-bearing for
  the cap proof, not a courtesy.
- Money unit: micro-credits. Bounded rounding loss of 5 uc per round on the route
  ticket and 1 uc per side bet (`MATH.md` §10).

### 6.1 Speed of play

`advance()` takes a server clock and rejects any money command arriving before
`frame.earliestNextActionAtMs` with `TOO_SOON`. The floor is
`speed.minGameCycleMs` = <!-- fig:minCycleMs -->2500<!-- /fig --> ms and the
cycle unit is the **arena**, because the arena is where money is committed.
`maxDecisionCountdownMs` is the literal `0`: the type system forbids an adapter
from declaring a decision timer.

This is a floor on how fast a player may commit money, not a deadline. Nothing
expires; a command that arrives late is always accepted.

---

## 7. Conformance checks the module must run on any adapter

Mechanical, adapter-agnostic, and evidence — not certification.

1. `laneSplits(n)` is non-empty, stable, and canonical (each entry `k` satisfies
   `ceil(n/2) <= k <= n-1`, or is the single `null` for a one-lane contract), for
   every `n` in `[minRunners, squadSize]`.
2. `laneSizes(n, k)` returns exactly `laneCount` entries summing to `n` for every
   legal `k`, throws for every illegal `k`, and is stable across repeated calls.
3. Marginal survival `(1 - collapse) * clear` is identical for every lane of a
   contract, and strictly inside `(0, 1)`.
4. `sum_m P(m) = 1` exactly, for every contract, squad size **and lane balance**.
5. `sum_m P(m) * (m/n) * mu = 1` exactly — the fair-continuation property, for
   every geometry.
6. Every side bet's offered probability equals the probability of its event under
   the committed geometry's own survivor distribution, and
   `probability * multiplier == firstEntryRtp` exactly.
7. `pricing.sideBetRule == 'firstEntryRtp/probability'` and
   `continuationRtp == 1/1`. Reject the adapter otherwise: any other continuation
   value re-charges margin per stage and silently destroys the equal-RTP
   guarantee.
8. `firstEntryRtp` in `(0, 1]`; the adapter's declared band is enforced by CI.
9. `limits.maxSideBetStakeRatio <= limits.maxTotalSideBetStakeRatio <= 1`.
   Without this the cap proof does not close (§9 of `MATH.md`).
10. `derive()` is deterministic in both seeds: called twice with the same server
    seed and context it returns identical tables; called with a different
    `clientSeed`, `roundId` or server seed it does not.
11. `derive()` never reads the player's actions. Enforced structurally: the
    signature has no action parameter. And it *does* read a client seed —
    enforced structurally the same way, by `RoundContext` requiring one.
12. If `risk.capMustBeUnreachable`, with `capBasis == 'per-ticket'`: the maximum
    credited route-ticket payout over all policies (backward induction, exact) is
    strictly below `maxWinMultiple`; every side-bet multiplier is strictly below
    `maxWinMultiple`; and both endpoints of the round-total-over-total-stake
    interval are strictly below `maxWinMultiple`.
13. `speed.minGameCycleMs >= 2500` and `speed.maxDecisionCountdownMs == 0`.
14. Every declarative field is frozen; the fingerprint is stable across
    re-construction and changes when any declarative field changes.

Checks 1–6, 9, 12 and 13 are already implemented and run on every CI run here by
[`../tools/enumerate.mjs`](../tools/enumerate.mjs)
(<!-- fig:invariantCount -->1602<!-- /fig --> exact invariants).

---

## 8. Fingerprint and versioning

`adapterFingerprint` is SHA-256 over `encodeFields` of, in order: API version,
lifecycle id, game id, adapter version, hazard `modelVersion`, `squadSize`,
`arenas`; then for each contract in declaration order its id, `laneCount`,
`minRunners`, the four `collapse`/`clear` BigInts, and its enumerated
`laneSplits(n)` for every `n` in range; then for each side bet in declaration
order its id, `event` and `minRunners`; then `firstEntryRtp`, `continuationRtp`,
`sideBetRule`, `rounding`; then `minStake`, `maxStake`, `maxSideBetStakeRatio`,
`maxTotalSideBetStakeRatio`; then `maxWinMultiple`, `capBasis`,
`capMustBeUnreachable`; then `cycleUnit`, `minGameCycleMs`,
`maxDecisionCountdownMs`.

**Why the side-bet fields must be in there.** A side-bet price is
`firstEntryRtp / P(event | geometry)`. Every input to that expression — the
contracts, the enumerated lane balances, the event definitions, the RTP and the
pricing rule — is fingerprinted, so the entire
<!-- fig:sideBetRows -->42<!-- /fig -->-row side-bet paytable is
determined by the fingerprint. An operator that re-prices a side bet must change
a fingerprinted field, and the change is visible to every verifier. In the v1
draft the fingerprint covered none of this and a side-bet multiplier could be
moved off `r/P` undetectably.

**Cosmetics are excluded.** Runner names must not enter the fingerprint,
because a player renaming a Kindling must not change the identity of the game
they are playing.

| Identity | Current | Change rule |
| --- | --- | --- |
| Engine API | `reveal-engine/api-v1` | new value for a breaking runtime/type contract |
| Lifecycle | `reveal-engine/staged-survival-v1` | new value for a breaking lifecycle contract |
| Adapter | `branchfall` @ `2.0.0` | bump for **any** replay-visible change |
| Hazard model | `branchfall-hazard/v2` | bump for any change to derivation behaviour |
| Commitment | `branchfall/commit-v2` | new rounds use current; old is verification-only |
| Transcript | `branchfall/transcript-v2` | bounded migration parser; unknown versions fail closed |
| Seed chain | `branchfall/seed-chain-v1` | bump for any change to the chain construction |
| Receipt | `reveal-engine/receipt-v1` | immutable money-movement record |

`v1 -> v2` is a deliberate hard break, not a migration: the hazard derivation now
takes a client seed, so no v1 table can be reproduced under v2 and no v1
transcript can be verified by a v2 verifier. `verifyRound` rejects a v1 schema
with `UNSUPPORTED_VERSION`, and `tests/fixtures/legacy-v1-transcript.json` is
frozen as the conformance vector for that rejection.

Changing a `collapse`, a `clear`, a lane-balance rule, `squadSize`, `arenas`,
lane assignment, `firstEntryRtp`, the side-bet rule or events, a stake limit,
rounding, the cap or its basis is replay-visible: bump `adapterVersion`, re-run
`npm run docs:sync`, re-publish `docs/MATH.md`, and let the paytable test confirm
it. An integration must retain the exact adapter implementation for as long as
any round it settled remains verifiable.

---

## 9. RGS integration obligations

The module supplies deterministic state transitions. It is not a wallet, not a
database, and not a session manager.

**Always accept from the client, exactly once per round, before the first
decision:** the **client seed**. It is 1–64 bytes of printable ASCII, it is
player-editable, and the operator must accept whatever arrives. Refusing it,
substituting it, silently defaulting it, or re-deriving the table after seeing it
all break the fairness property in §10 and are integration defects of the highest
severity.

**Never accept from a client:** the server seed, a hazard table or any draw from
it, a claim value, a multiplier (a quoted multiplier is accepted only to be
recomputed and compared), a survivor set, an adapter fingerprint, a cap basis, a
receipt, or a credited amount. Beyond the client seed, client-controlled input is
limited to: the chosen action (route id, lane balance, shelter slot list, bank),
zero to three side-bet tickets with their stakes and quoted multipliers, an
opaque idempotency key, and the observed frame revision.

**One transaction per command:** idempotency lookup, frame-revision check, game
cycle check, authorization, debit (route stake or side-bet stakes), state
transition, credit, receipt append, snapshot persist.

**Persist for the life of the liability:** engine API version, lifecycle id,
package release identity, adapter id/version/fingerprint, hazard `modelVersion`,
the pre-commitment and its publication timestamp, the seed-chain terminal and
this round's link if used, the client seed, the hazard digest, the revealed
server seed, the ordered action list including lane balances and side-bet
tickets, frame and ledger revisions, the cap basis, the receipt log.

**Seed custody:** server seeds are drawn from a reviewed CSPRNG (or taken in
order from a pre-committed chain), held server-side, and revealed only at
settlement. Two failure modes, correctly ranked in §10.

---

## 10. Threat model notes specific to this lifecycle

| Threat | Severity | Control |
| --- | --- | --- |
| **Operator pre-selects a favourable server seed** ("seed grinding") | **highest** | The operator commits to its seed *before* the client seed exists, so at commit time it cannot evaluate any table. A pre-committed seed chain removes per-round seed choice entirely. Residual below |
| Operator adapts outcomes to the player's route choice | high | The whole table — all routes, all lane balances, all slots — is committed before the first decision; unchosen branches are verifiable after the reveal |
| Operator re-prices a side bet | high | The price is `firstEntryRtp / P(event\|geometry)`; every input is fingerprinted (§8), and the module computes it — the adapter cannot declare one |
| Operator substitutes or defaults the client seed | high | The client seed is echoed in the opened round, covered by the hazard digest, and shown in the verification screen. A player who typed a seed can see whether it was used |
| Early server-seed disclosure | medium | Seed server-side until settlement; treat disclosure as a round-void incident. Note this failure favours the **player** and is detectable, which is why it ranks below seed grinding rather than above it |
| Client claims a survivor set or a multiplier | high | Survivors are re-derived server-side; a quoted multiplier is recomputed and must match exactly (`QUOTE_MISMATCH`) |
| Side bet placed after the route is known | high | Side bets are fields of the route action, not a separate command; there is no API path to place one later |
| Side-bet stake used to escape the cap or the limits | medium | `maxSideBetStakeRatio` and `maxTotalSideBetStakeRatio` enforced before debit; cap basis is per ticket |
| Replay/duplicate action | medium | Idempotency key bound to a canonical command fingerprint; exact retries replay the stored receipt, changed payloads fail `IDEMPOTENCY_CONFLICT` |
| Stale-frame action after a resolve | medium | Frame revision is separate from ledger revision; a mismatched `expectedFrameRevision` fails closed |
| Speed-of-play breach | medium | `advance()` rejects a command before `earliestNextActionAtMs` with `TOO_SOON`; enforced server-side so a modified client cannot beat it |
| Hostile shelter list, lane balance or side-bet payload | medium | Validated: distinct alive integer slots with `1 <= k <= n-1`; lane balance must be in `laneSplits(n)`; side bets must be known ids, unique per arena, within stake limits |
| Malformed hazard table reaching an exported replay entry point | low | `assertHazardShape()` validates arena count, per-contract lane count, and every draw's range, failing `MALFORMED_HAZARD` with a `path` |
| Oversized or malformed transcript | low | Bounded parser, `ENGINE_LIMITS`, fail closed on unknown versions |
| Float creeping into a money path | low | No `number` type in any money or probability signature; `Rational` and `bigint` only; lint rule bans `parseFloat`/`Number(` in the money path |
| Cap silently clipping an advertised win | low | `capMustBeUnreachable` with `capBasis: 'per-ticket'` proven in CI, per ticket and over the round total; a violation breaks the build instead of the player's payout |

### 10.1 Why seed grinding is the top row

With a server-only seed, the operator draws a seed, derives the complete
counterfactually-complete table, and only then publishes a commitment. Nothing in
the protocol forces it to publish the *first* seed it drew. Scoring a candidate
against a plausible player policy costs about
<!-- fig:hazardDraws -->120<!-- /fig --> HMAC-SHA256 evaluations plus a tree walk
— microseconds. Keeping the worst-for-player candidate out of `B` draws is
cheap, silent, and devastating.

Measured on this repository's own `openRound`/`replayRound`, against the
published Ranger policy, with the operator able to score the table the player
will actually face:

| Candidates ground | Realised RTP |
| --- | --- |
| 1 (honest) | ~0.955 |
| 4 | ~0.28 |
| 16 | ~0.01 |
| 64 | ~0.00 |

And every one of those rounds **verifies**: the commitment matches the revealed
seed, the replay reproduces the ledger to the micro-credit, and the unchosen
branches are all present. A player's verifier cannot tell a ground round from an
honest one. That is what makes it the highest-severity failure in the design —
it is undetectable by the very mechanism that is supposed to establish trust.

Mixing a client seed the operator cannot see at commit time removes the ability
to score candidates at all, and the same experiment run against the v2
construction returns realised RTP indistinguishable from honest play at every
`B`. `tests/seed-grinding.test.mjs` runs both arms and fails if the mitigation
stops working.

**Residual risks, stated rather than hidden.**

1. If the client seed is generated by the operator's own server and the player
   never changes it, the operator can grind the client seed instead. Mitigation:
   the client seed must be generated **on the device** with a CSPRNG, displayed
   before the round opens, and freely editable. The verification screen shows
   which seed was actually used.
2. An operator that draws a fresh server seed per round can still choose *which
   commitment to serve*, though with the client seed unknown every candidate has
   the same conditional distribution, so the choice is worthless. A pre-committed
   seed chain (§5.1) removes even that.
3. None of this constrains an operator that simply lies about the whole protocol.
   Commit-reveal establishes that a *published* round was not manipulated after
   the fact; it does not establish that the software running is the software
   described. That is what the adapter fingerprint, an independent build
   attestation and a laboratory process are for, and this repository provides
   none of them (§12).

---

## 11. Delivery order

1. `contracts.ts` + `adapter.ts` (types, `defineStagedSurvival`, fingerprint
   including the side-bet and limits fields).
2. `hazard.ts` — two-seed derivation, canonical bytes, chain helpers — against the
   frozen fixture in `tests/fixtures/`.
3. `resolve.ts`, cross-checked against `tools/enumerate.mjs` distributions for
   every geometry including both SPLIT balances.
4. `sidebets.ts` — event probabilities from the committed geometry, pricing,
   stake limits, quote comparison.
5. `book.ts` with receipts, per-ticket cap, game-cycle floor, snapshot/restore.
6. `conformance.ts` implementing §7.
7. `reveal-verify --lifecycle staged-survival` CLI support.
8. Export from `@axiom-games/reveal-engine/protocol`; minor version bump
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
