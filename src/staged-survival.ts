/**
 * Reveal Engine — `staged-survival` lifecycle module.
 *
 * This file is the compilable form of the contract documented in
 * `docs/ENGINE.md`. It is types plus frozen declarations only: no game logic
 * lives here, and nothing in this file may reach for a floating point number.
 *
 * The existing Reveal Engine core (`reveal-engine/core`) models a progressive
 * information market: one hidden truth, a stream of evidence, a posterior that
 * prices claims. BRANCHFALL needs a different shape — a hidden per-stage hazard
 * table, a squad that shrinks, and a claim that is carried by survivors. That
 * shape is `staged-survival`. It reuses the engine's rational arithmetic,
 * commit-reveal fairness, payable/cap logic and receipt ledger unchanged.
 */

/* ------------------------------------------------------------------ *
 * shared engine primitives (mirrors reveal-engine/core)
 * ------------------------------------------------------------------ */

/** Exact rational. Reduced, denominator strictly positive. */
export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export const ENGINE_API_VERSION = 'reveal-engine/api-v1' as const;
export const LIFECYCLE_MODULE = 'reveal-engine/staged-survival-v1' as const;
export const COMMITMENT_VERSION = 'branchfall/commit-v2' as const;
export const TRANSCRIPT_SCHEMA = 'branchfall/transcript-v2' as const;
export const SEED_CHAIN_VERSION = 'branchfall/seed-chain-v1' as const;

export type LifecycleModule = typeof LIFECYCLE_MODULE;

/** Money is denominated in integer minor units. Never a float, never a Number. */
export type Micro = bigint;

export interface RoundContext {
  readonly gameId: string;
  readonly roundId: string;
  readonly proofVersion: typeof COMMITMENT_VERSION;
  /**
   * Player-contributed entropy, bound before the first decision and immutable
   * for the life of the round. Mandatory: see `docs/ENGINE.md` §10 and the
   * seed-selection threat it exists to close.
   */
  readonly clientSeed: string;
}

/* ------------------------------------------------------------------ *
 * hazard model — the adapter-owned part
 * ------------------------------------------------------------------ */

/**
 * A lane is a group of runners whose fates are correlated by a shared collapse.
 * `collapse` takes the whole lane; `clear` is the independent per-runner check
 * applied only if the lane holds. Marginal per-runner survival is therefore
 * `(1 - collapse) * clear`, and it must be identical across every lane of a
 * contract — that identity is what makes route choice EV-neutral.
 */
export interface LaneProfile {
  readonly collapse: Rational;
  readonly clear: Rational;
}

/** A route contract: a lane geometry plus a hazard profile. */
export interface RouteContract {
  readonly id: string;
  readonly label: string;
  /** Number of independent lanes the running group is divided into. */
  readonly laneCount: number;
  /** Minimum runners required for the contract to be offered. */
  readonly minRunners: number;
  readonly profile: LaneProfile;
  /**
   * The lane balances a player may choose for a running group of this size.
   *
   * Single-lane contracts return `[null]` — there is one geometry and the UI
   * must not imply otherwise. Multi-lane contracts return the size of the LEAD
   * lane for each distinct geometry, canonicalised so the lead lane is never
   * smaller than the trailing lane. Must be pure, non-empty, and stable.
   */
  laneSplits(runners: number): readonly (number | null)[];
  /**
   * Deterministic lane sizes for a committed geometry. Must be a pure function
   * of `(runners, laneSplit)`, must sum to `runners`, must return exactly
   * `laneCount` entries, and must reject any `laneSplit` not in `laneSplits()`.
   */
  laneSizes(runners: number, laneSplit: number | null): readonly number[];
}

/** One uniform draw consumed from the committed hazard table. */
export interface HazardDraw {
  readonly arena: number;
  readonly contractId: string;
  readonly lane: number;
  readonly kind: 'collapse' | 'slip';
  /** Squad slot for `slip`; 0 for `collapse`. */
  readonly slot: number;
  readonly modulus: bigint;
  readonly value: bigint;
}

/**
 * The complete hazard table for a round.
 *
 * Counterfactual completeness is mandatory: the table covers every arena, every
 * contract, every lane and every squad slot — including routes the player will
 * not take and lane balances they will not choose. It is fixed the moment both
 * seeds are known, before the player's first decision, so no outcome can be
 * adapted to a choice and the unused branches remain independently verifiable
 * after the reveal.
 */
export interface HazardTable {
  readonly modelVersion: string;
  readonly arenas: number;
  readonly squadSize: number;
  readonly draws: readonly HazardDraw[];
}

export interface HazardSchedule {
  /** Adapter-owned version of the deterministic derivation algorithm. */
  readonly modelVersion: string;
  readonly arenas: number;
  readonly squadSize: number;
  /**
   * Pure, total, and deterministic in BOTH seeds. The server seed is the HMAC
   * key; the client seed rides in `context` and is a labelled field. The
   * signature takes no action parameter, so adapting a draw to a player's
   * choice is structurally impossible, and it takes a client seed, so
   * pre-selecting a favourable table is impossible too.
   */
  derive(serverSeedHex: string, context: RoundContext): HazardTable;
}

/* ------------------------------------------------------------------ *
 * commitment
 * ------------------------------------------------------------------ */

/**
 * Published in step 1 of the round lifecycle: before the player supplies a
 * client seed, and therefore before the operator can evaluate any table.
 */
export interface ServerPreCommitment {
  readonly version: typeof COMMITMENT_VERSION;
  readonly roundId: string;
  /** `SHA256(encodeFields(['server commitment', version, ids, roundId, seedBytes]))`. */
  readonly commitment: string;
  readonly publishedAtMs: number;
  /**
   * When the operator runs a pre-committed seed chain, the hash this round's
   * seed must map to under one forward SHA-256. Optional but recommended:
   * it removes per-round seed choice entirely.
   */
  readonly chainNextHash?: string;
}

/** A pre-committed server-seed chain: `s_i = SHA256(s_{i-1})`, `terminal` published once. */
export interface SeedChainCommitment {
  readonly version: typeof SEED_CHAIN_VERSION;
  readonly length: number;
  readonly terminal: string;
  readonly publishedAtMs: number;
}

/* ------------------------------------------------------------------ *
 * player actions
 * ------------------------------------------------------------------ */

export type SquadSlot = number;

export type SideBetEvent =
  /** every runner in the running group clears the arena */
  | 'ALL_CLEAR'
  /** exactly one runner clears the arena */
  | 'EXACTLY_ONE'
  /** no runner clears the arena */
  | 'NONE';

/**
 * A side bet, declared once by the adapter. The multiplier is NOT declared —
 * it is computed by the module as `firstEntryRtp / P(event | committed
 * geometry)` from the contract declaration, so an operator cannot change a
 * side-bet price without changing a fingerprinted field.
 */
export interface SideBetSpec {
  readonly id: string;
  readonly label: string;
  readonly event: SideBetEvent;
  /** Offered only when at least this many runners actually run the arena. */
  readonly minRunners: number;
}

/** A priced offer for the geometry the player is about to commit. */
export interface SideBetOffer {
  readonly id: string;
  readonly label: string;
  readonly contractId: string;
  readonly runners: number;
  readonly laneSplit: number | null;
  /** Exact probability under the committed contract, group size and lane balance. */
  readonly probability: Rational;
  /** Always `firstEntryRtp / probability`. Never quoted from a float, never declared by hand. */
  readonly multiplier: Rational;
  readonly maxStake: Micro;
}

/** A side bet the player actually placed, atomic with the route it rides. */
export interface SideBetTicket {
  readonly id: string;
  readonly stake: Micro;
  /**
   * The multiplier the client was shown. The module recomputes it and rejects
   * the command on any disagreement, so a stale or tampered quote fails closed
   * rather than settling at the client's number.
   */
  readonly quotedMultiplier: Rational;
}

/**
 * Side bets are attached to the action that commits the arena, not submitted
 * separately: they must be irrevocably placed at the same instant the geometry
 * is, and they resolve from the same survivor count.
 */
export type StagedSurvivalAction =
  | { readonly type: 'BANK' }
  | {
      readonly type: 'ROUTE';
      readonly contractId: string;
      /** Required when the contract offers more than one geometry; `null` otherwise. */
      readonly laneSplit: number | null;
      readonly sideBets?: readonly SideBetTicket[];
    }
  | {
      readonly type: 'SHELTER';
      readonly shelter: readonly SquadSlot[];
      readonly sideBets?: readonly SideBetTicket[];
    };

/* ------------------------------------------------------------------ *
 * adapter surface
 * ------------------------------------------------------------------ */

export interface StagedSurvivalPricing {
  /** House margin, charged once when the run is bought. Applies to every ticket. */
  readonly firstEntryRtp: Rational;
  /**
   * Margin charged on money already inside the round. Must be exactly 1:
   * continuation is a fair bet, which is what makes every policy equal-RTP.
   */
  readonly continuationRtp: Rational;
  /**
   * The only legal side-bet pricing rule. It is a fingerprinted literal so that
   * "the multiplier is r over the exact probability" is part of the game's
   * identity rather than a convention the operator could quietly abandon.
   */
  readonly sideBetRule: 'firstEntryRtp/probability';
  readonly rounding: 'floor';
}

export interface StagedSurvivalStakeLimits {
  readonly minStake: Micro;
  readonly maxStake: Micro;
  /** Each side bet's stake ceiling, as a multiple of the route stake. */
  readonly maxSideBetStakeRatio: Rational;
  /** All side bets in a round together, as a multiple of the route stake. */
  readonly maxTotalSideBetStakeRatio: Rational;
}

export interface StagedSurvivalRisk {
  /** Liability ceiling for one ticket, as a multiple of THAT TICKET'S OWN stake. */
  readonly maxWinMultiple: bigint;
  /**
   * The basis the cap is measured against. `per-ticket` is the only value the
   * BRANCHFALL proof supports; a per-round basis over a single stake makes the
   * cap reachable as soon as a side bet is in play.
   */
  readonly capBasis: 'per-ticket';
  /** Set true to require CI proof that no ticket and no round can reach the cap. */
  readonly capMustBeUnreachable: boolean;
}

/** Speed-of-play controls. The game cycle is the ARENA, not the round. */
export interface StagedSurvivalSpeed {
  readonly cycleUnit: 'arena';
  /** Minimum milliseconds between committing an arena and unlocking the next money control. */
  readonly minGameCycleMs: number;
  /** No countdown may ever appear on a money decision. Structural, not configurable. */
  readonly maxDecisionCountdownMs: 0;
}

export interface StagedSurvivalDefinition {
  readonly apiVersion: typeof ENGINE_API_VERSION;
  readonly lifecycle: LifecycleModule;
  readonly id: string;
  /** Change for any replay-visible behavioural change. */
  readonly adapterVersion: string;
  readonly squadSize: number;
  readonly arenas: number;
  readonly contracts: readonly RouteContract[];
  readonly sideBets: readonly SideBetSpec[];
  readonly hazard: HazardSchedule;
  readonly pricing: StagedSurvivalPricing;
  readonly limits: StagedSurvivalStakeLimits;
  readonly risk: StagedSurvivalRisk;
  readonly speed: StagedSurvivalSpeed;
  /** Cosmetic only. Must not appear in any fingerprint or probability path. */
  readonly cosmetics: {
    readonly defaultRunnerNames: readonly string[];
    readonly renamable: boolean;
  };
}

/* ------------------------------------------------------------------ *
 * round state and receipts
 * ------------------------------------------------------------------ */

export interface StagedSurvivalFrame {
  readonly arena: number;
  readonly alive: readonly SquadSlot[];
  /** Claim carried by the squad, as a multiple of the route stake. Exact rational. */
  readonly claim: Rational;
  /** Already credited against the ROUTE ticket, for that ticket's cap. */
  readonly routeCreditedMicro: Micro;
  /** Side-bet money already staked this round, for the round-wide side-bet limit. */
  readonly sideStakedMicro: Micro;
  /**
   * Server clock in milliseconds before which no money command is accepted.
   * `advance()` fails `TOO_SOON` if a command arrives earlier. This is a floor,
   * never a countdown: nothing expires, nothing is lost by waiting.
   */
  readonly earliestNextActionAtMs: number;
  readonly terminal: boolean;
  readonly offers: readonly {
    readonly action: StagedSurvivalAction;
    readonly survivorProbabilities: readonly Rational[];
    readonly claimMultipliers: readonly Rational[];
    readonly sideBets: readonly SideBetOffer[];
  }[];
}

export interface SideBetResolution {
  readonly id: string;
  readonly arena: number;
  readonly stake: Micro;
  readonly probability: Rational;
  readonly multiplier: Rational;
  readonly won: boolean;
  readonly credited: Micro;
}

export interface ArenaResolution {
  readonly arena: number;
  readonly contractId: string;
  readonly laneSplit: number | null;
  readonly lanes: readonly (readonly SquadSlot[])[];
  readonly collapsed: readonly boolean[];
  readonly survivors: readonly SquadSlot[];
  readonly fallen: readonly {
    readonly slot: SquadSlot;
    readonly lane: number;
    readonly cause: 'collapse' | 'slip';
  }[];
  readonly claimBefore: Rational;
  readonly claimAfter: Rational;
  readonly sideBets: readonly SideBetResolution[];
}

export interface StagedSurvivalReceipt {
  readonly schema: 'reveal-engine/receipt-v1';
  readonly idempotencyKey: string;
  readonly commandFingerprint: string;
  readonly action: 'buy' | 'route' | 'shelter' | 'bank' | 'settle' | 'side-bet';
  readonly frameRevision: number;
  readonly ledgerRevision: number;
  readonly debited: Micro;
  readonly credited: Micro;
  readonly balanceDelta: Micro;
  readonly capped: boolean;
}

export interface StagedSurvivalTranscript {
  readonly schema: typeof TRANSCRIPT_SCHEMA;
  readonly adapterVersion: string;
  readonly modelVersion: string;
  readonly context: RoundContext;
  readonly preCommitment: ServerPreCommitment;
  /** SHA-256 over the canonical hazard bytes, published once both seeds are fixed. */
  readonly hazardDigest: string;
  /** Present only after settlement. */
  readonly revealedServerSeed?: string;
  readonly hazard: HazardTable;
  readonly actions: readonly StagedSurvivalAction[];
  readonly resolutions: readonly ArenaResolution[];
  readonly receipts: readonly StagedSurvivalReceipt[];
}

export type VerificationFailureCode =
  | 'INVALID_TRANSCRIPT'
  | 'UNSUPPORTED_VERSION'
  | 'ADAPTER_MISMATCH'
  | 'DERIVATION_FAILED'
  | 'TRANSCRIPT_MISMATCH'
  | 'COMMITMENT_MISMATCH'
  | 'CHAIN_MISMATCH'
  | 'MALFORMED_HAZARD'
  | 'ILLEGAL_ACTION'
  | 'INVALID_LANE_SPLIT'
  | 'INVALID_SIDE_BET'
  | 'QUOTE_MISMATCH'
  | 'LEDGER_MISMATCH';

export type CommandFailureCode = VerificationFailureCode | 'TOO_SOON' | 'IDEMPOTENCY_CONFLICT';

export type VerificationResult =
  | {
      readonly ok: true;
      readonly commitment: string;
      readonly hazardDigest: string;
      readonly routeCreditedMicro: Micro;
      readonly sideCreditedMicro: Micro;
      readonly creditedMicro: Micro;
    }
  | {
      readonly ok: false;
      readonly code: VerificationFailureCode;
      readonly message: string;
      readonly path: string;
    };

/* ------------------------------------------------------------------ *
 * the functions the lifecycle module must export
 * ------------------------------------------------------------------ */

export interface StagedSurvivalModule {
  /** Clones and deep-freezes the declaration; the only supported construction path. */
  defineStagedSurvival(input: StagedSurvivalDefinition): StagedSurvivalDefinition;
  /**
   * SHA-256 over every declarative field: contracts, side-bet specs, the
   * side-bet pricing rule, stake limits, cap basis, speed controls and hazard
   * identity. Cosmetics are excluded.
   */
  adapterFingerprint(game: StagedSurvivalDefinition): string;
  /** Step 1: published before any client entropy exists. Takes no client input at all. */
  preCommit(
    serverSeedHex: string,
    game: StagedSurvivalDefinition,
    roundId: string,
    chainNextHash?: string,
  ): ServerPreCommitment;
  /** Step 3: the client seed has arrived, so the table is now fixed for both parties. */
  openRound(
    serverSeedHex: string,
    game: StagedSurvivalDefinition,
    preCommitment: ServerPreCommitment,
    clientSeed: string,
  ): StagedSurvivalTranscript;
  /** Legal actions, their exact quoted distributions, and the priced side bets. */
  offers(game: StagedSurvivalDefinition, frame: StagedSurvivalFrame): StagedSurvivalFrame['offers'];
  /**
   * The exact probability of a side-bet event under a committed geometry.
   * The module owns this; the adapter never supplies a probability or a price.
   */
  sideBetProbability(
    game: StagedSurvivalDefinition,
    spec: SideBetSpec,
    contractId: string,
    runners: number,
    laneSplit: number | null,
  ): Rational;
  /** Applies one action; pure state transition, no wallet access. */
  advance(
    game: StagedSurvivalDefinition,
    transcript: StagedSurvivalTranscript,
    frame: StagedSurvivalFrame,
    action: StagedSurvivalAction,
    nowMs: number,
  ): {
    readonly frame: StagedSurvivalFrame;
    readonly resolution?: ArenaResolution;
    readonly debitMicro: Micro;
    readonly creditMicro: Micro;
  };
  /** Re-derives everything from the revealed server seed and replays the action list. */
  verify(
    serverSeedHex: string,
    game: StagedSurvivalDefinition,
    transcript: unknown,
    stakeMicro: Micro,
  ): VerificationResult;
}
