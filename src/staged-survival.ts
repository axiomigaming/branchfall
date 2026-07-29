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
export const COMMITMENT_VERSION = 'branchfall/commit-v1' as const;
export const TRANSCRIPT_SCHEMA = 'branchfall/transcript-v1' as const;

export type LifecycleModule = typeof LIFECYCLE_MODULE;

/** Money is denominated in integer minor units. Never a float, never a Number. */
export type Micro = bigint;

export interface RoundContext {
  readonly gameId: string;
  readonly roundId: string;
  readonly proofVersion: typeof COMMITMENT_VERSION;
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
   * Deterministic lane sizes for a running group. Must be a pure function of
   * `runners`, must sum to `runners`, and must return exactly `laneCount` entries.
   */
  laneSizes(runners: number): readonly number[];
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
 * contract and every lane, including routes the player will not take. The
 * operator commits to the whole table before the player's first decision, so no
 * outcome can be adapted to a choice, and the unused branches remain
 * independently verifiable after the reveal.
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
  /** Pure, total, and deterministic: same seed and context yield identical tables. */
  derive(seedHex: string, context: RoundContext): HazardTable;
}

/* ------------------------------------------------------------------ *
 * player actions
 * ------------------------------------------------------------------ */

export type SquadSlot = number;

export type StagedSurvivalAction =
  | { readonly type: 'BANK' }
  | { readonly type: 'ROUTE'; readonly contractId: string }
  | { readonly type: 'SHELTER'; readonly shelter: readonly SquadSlot[] };

/** A side bet placed with fresh money, resolved by the arena it is attached to. */
export interface SideBetOffer {
  readonly id: string;
  readonly label: string;
  /** Exact probability under the committed contract and running group size. */
  readonly probability: Rational;
  /** Always `firstEntryRtp / probability`. Never quoted from a float. */
  readonly multiplier: Rational;
}

export interface SideBetTicket {
  readonly id: string;
  readonly arena: number;
  readonly stake: Micro;
  readonly quotedMultiplier: Rational;
}

/* ------------------------------------------------------------------ *
 * adapter surface
 * ------------------------------------------------------------------ */

export interface StagedSurvivalPricing {
  /** House margin, charged once when the run is bought. */
  readonly firstEntryRtp: Rational;
  /**
   * Margin charged on money already inside the round. Must be exactly 1:
   * continuation is a fair bet, which is what makes every policy equal-RTP.
   */
  readonly continuationRtp: Rational;
  readonly rounding: 'floor';
}

export interface StagedSurvivalRisk {
  /** Liability ceiling as a multiple of the stake. */
  readonly maxWinMultiple: bigint;
  /** Set true to require CI proof that the cap is unreachable by construction. */
  readonly capMustBeUnreachable: boolean;
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
  readonly hazard: HazardSchedule;
  readonly pricing: StagedSurvivalPricing;
  readonly risk: StagedSurvivalRisk;
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
  /** Claim carried by the squad, as a multiple of the stake. Exact rational. */
  readonly claim: Rational;
  /** Already credited this round, for the chain cap. */
  readonly creditedMicro: Micro;
  readonly terminal: boolean;
  readonly offers: readonly {
    readonly action: StagedSurvivalAction;
    readonly survivorProbabilities: readonly Rational[];
    readonly claimMultipliers: readonly Rational[];
    readonly sideBets: readonly SideBetOffer[];
  }[];
}

export interface ArenaResolution {
  readonly arena: number;
  readonly contractId: string;
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
  readonly commitment: string;
  /** Present only after settlement. */
  readonly revealedSeed?: string;
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
  | 'ILLEGAL_ACTION'
  | 'LEDGER_MISMATCH';

export type VerificationResult =
  | { readonly ok: true; readonly commitment: string; readonly creditedMicro: Micro }
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
  /** SHA-256 over every declarative field, including contracts and hazard identity. */
  adapterFingerprint(game: StagedSurvivalDefinition): string;
  /** Published before the player's first decision. */
  openRound(seedHex: string, game: StagedSurvivalDefinition, roundId: string): StagedSurvivalTranscript;
  /** Legal actions and their exact quoted distributions for the current frame. */
  offers(game: StagedSurvivalDefinition, frame: StagedSurvivalFrame): StagedSurvivalFrame['offers'];
  /** Applies one action; pure state transition, no wallet access. */
  advance(
    game: StagedSurvivalDefinition,
    transcript: StagedSurvivalTranscript,
    frame: StagedSurvivalFrame,
    action: StagedSurvivalAction,
  ): { readonly frame: StagedSurvivalFrame; readonly resolution?: ArenaResolution; readonly creditMicro: Micro };
  /** Re-derives everything from the revealed seed and replays the action list. */
  verify(seedHex: string, game: StagedSurvivalDefinition, transcript: unknown, stakeMicro: Micro): VerificationResult;
}
