/**
 * Verification, and the part of it that is usually missing.
 *
 * `docs/ENGINE.md` §5: *"Verification is total."* Checking the commitment proves
 * the tape was honest and says **nothing about what the player was paid** — the
 * §10 threat table rates "operator publishes a settlement that does not match the
 * table" as high severity for exactly that reason. So this verifier does both
 * halves:
 *
 * 1. **The proof.** Handed to the module's own verifier, on the wire form, with
 *    the revealed seed: pre-commitment, tape digest, replayed steps and the
 *    sealed commitment, all re-derived. Nothing here re-implements it.
 * 2. **The ledger.** Every credited figure in the bundle is recomputed from the
 *    transcript and the route stake alone — the claim ladder, the floor, the cap,
 *    and each side bet's price re-derived as `r / P(event | committed geometry)`
 *    from the geometry the transcript itself records. A single micro-credit of
 *    disagreement is `LEDGER_MISMATCH`.
 *
 * A bundle carries no tape and cannot: the published record is the transcript,
 * and the transcript's own type forbids one.
 */
import {
  add,
  compare,
  constantTimeHexEqual,
  multiply,
  payableWithinCap,
  rational,
  type Rational,
} from '@axiom-games/reveal-engine/core';
import {
  deserializeTranscript,
  roundIdentityOf,
  roundRefId,
  seedCommitment,
  stagedSurvival,
  survivorDistribution,
  type SurvivalTranscript,
} from '@axiom-games/reveal-engine/modules/staged-survival';
import {
  BRANCHFALL,
  ENTRY_RETURN,
  FINGERPRINT,
  MAX_WIN_MULTIPLE,
  SQUAD_SIZE,
} from './definition.js';
import { fraction } from './money.js';
import { sideBetMultiplier, sideBetProbability, type SideBetId } from './paytable.js';
import { ticketWon } from './sidebets.js';

export const BUNDLE_SCHEMA = 'branchfall/verification-bundle-v1';

export type CreditEvent =
  | {
      readonly kind: 'SHELTER' | 'BANK' | 'SETTLE';
      readonly stage: number;
      readonly entities: readonly number[];
      readonly creditedMicro: string;
    }
  | {
      readonly kind: 'SIDE_BET';
      readonly stage: number;
      readonly bet: SideBetId;
      readonly stakeMicro: string;
      readonly multiplier: string;
      readonly won: boolean;
      readonly creditedMicro: string;
    };

export interface VerificationBundle {
  readonly schema: typeof BUNDLE_SCHEMA;
  readonly definition: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: string;
    readonly moduleId: string;
    readonly moduleVersion: string;
  };
  readonly roundId: string;
  readonly clientEntropy: string;
  readonly preCommitment: string;
  readonly preCommitmentPublishedAtMs: number;
  readonly tapeDigest: string;
  readonly revealedServerSeed: string;
  readonly routeStakeMicro: string;
  readonly transcript: unknown;
  readonly credits: readonly CreditEvent[];
  readonly totalCreditedMicro: string;
}

export interface CheckResult {
  readonly code: string;
  readonly title: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface VerificationReport {
  readonly ok: boolean;
  readonly checks: readonly CheckResult[];
}

function parseMicro(raw: unknown, label: string): bigint {
  if (typeof raw !== 'string' || !/^[0-9]{1,25}$/u.test(raw))
    throw new Error(`${label} is not an integer of micro-credits`);
  return BigInt(raw);
}

/**
 * Re-derives every credit from the transcript and the route stake.
 *
 * This is the half a verifier that only checks the commitment leaves out. It
 * knows the money rule (`MATH.md` §4) and nothing about how the server computed
 * it: an entry opens at `stake_i x r`, a surviving share is multiplied by the
 * contract's own `mu`, a fallen share is gone, and a credit event floors the sum
 * once — never mid-round.
 */
function replayLedger(
  transcript: SurvivalTranscript,
  routeStakeMicro: bigint,
  credits: readonly CreditEvent[],
): readonly CheckResult[] {
  const results: CheckResult[] = [];
  const entityStake = routeStakeMicro / BigInt(SQUAD_SIZE);
  const values = new Map<number, Rational>();
  for (let slot = 0; slot < SQUAD_SIZE; slot += 1)
    values.set(slot, multiply(rational(entityStake), ENTRY_RETURN));

  let liquid = 0n;
  let live: number[] = Array.from({ length: SQUAD_SIZE }, (_value, slot) => slot);
  let expectedTotal = 0n;
  let mismatch: string | null = null;

  const creditAt = (
    event: Extract<CreditEvent, { kind: 'SHELTER' | 'BANK' | 'SETTLE' }>,
  ): void => {
    let theoretical = rational(0n);
    for (const slot of event.entities) theoretical = add(theoretical, values.get(slot) ?? rational(0n));
    const payable = payableWithinCap(theoretical, routeStakeMicro, MAX_WIN_MULTIPLE, liquid);
    const claimed = parseMicro(event.creditedMicro, `${event.kind} credit`);
    if (payable.credited !== claimed)
      mismatch ??= `${event.kind} at stage ${event.stage}: bundle says ${claimed}, re-derivation says ${payable.credited}`;
    liquid += payable.credited;
    expectedTotal += payable.credited;
    for (const slot of event.entities) values.set(slot, rational(0n));
    live = live.filter((slot) => !event.entities.includes(slot));
  };

  const boundary = (stage: number): void => {
    for (const event of credits)
      if ((event.kind === 'SHELTER' || event.kind === 'BANK') && event.stage === stage)
        creditAt(event);
  };

  transcript.steps.forEach((step, index) => {
    // Everything that credits at this stage boundary — a shelter withdrawal or a
    // bank — happens before the branch runs, on the values the previous step
    // left behind.
    boundary(index);

    const running = live.filter((slot) => !step.banked.includes(slot));
    const contract = BRANCHFALL.contracts.find((candidate) => candidate.id === step.contractId);
    if (!contract) {
      mismatch ??= `Step ${index} names an unknown contract ${step.contractId}`;
      return;
    }

    for (const event of credits)
      if (event.kind === 'SIDE_BET' && event.stage === index) {
        const distribution = survivorDistribution(BRANCHFALL, contract, running.length);
        const probability = sideBetProbability(distribution, event.bet);
        const multiplier = sideBetMultiplier(probability);
        if (fraction(multiplier) !== event.multiplier)
          mismatch ??= `Side bet ${event.bet} at arena ${index + 1}: bundle price ${event.multiplier}, re-derivation ${fraction(multiplier)}`;
        const won = ticketWon(event.bet, step.survivors.length, running.length);
        if (won !== event.won)
          mismatch ??= `Side bet ${event.bet} at arena ${index + 1}: bundle says ${event.won ? 'won' : 'lost'}, the step says otherwise`;
        const stake = parseMicro(event.stakeMicro, 'Side-bet stake');
        const theoretical = won ? multiply(multiplier, rational(stake)) : rational(0n);
        const payable = payableWithinCap(theoretical, stake, MAX_WIN_MULTIPLE, 0n);
        const claimed = parseMicro(event.creditedMicro, 'Side-bet credit');
        if (payable.credited !== claimed)
          mismatch ??= `Side bet ${event.bet} at arena ${index + 1}: bundle says ${claimed}, re-derivation says ${payable.credited}`;
        expectedTotal += payable.credited;
      }

    const multiplier = rational(contract.multiplier.numerator, contract.multiplier.denominator);
    for (const slot of step.survivors)
      values.set(slot, multiply(values.get(slot) ?? rational(0n), multiplier));
    for (const slot of step.failed) values.set(slot, rational(0n));
    live = [...step.survivors];
  });

  boundary(transcript.steps.length);
  for (const event of credits) if (event.kind === 'SETTLE') creditAt(event);

  void expectedTotal;

  results.push({
    code: 'LEDGER',
    title: 'Every credited figure matches a fresh re-derivation',
    ok: mismatch === null,
    detail: mismatch ?? `${credits.length} credit events re-derived to the micro-credit`,
  });
  return results;
}

/** Verifies a published bundle end to end. Pure: no server state is consulted. */
export function verifyBundle(input: unknown): VerificationReport {
  const checks: CheckResult[] = [];
  const push = (code: string, title: string, ok: boolean, detail: string) =>
    checks.push({ code, title, ok, detail });

  try {
    if (typeof input !== 'object' || input === null) throw new Error('A bundle is an object');
    const bundle = input as VerificationBundle;
    if (bundle.schema !== BUNDLE_SCHEMA) throw new Error('Unsupported bundle schema');

    push(
      'DEFINITION',
      'The adapter is the one this verifier holds',
      bundle.definition.id === BRANCHFALL.id &&
        bundle.definition.version === BRANCHFALL.version &&
        constantTimeHexEqual(bundle.definition.fingerprint, FINGERPRINT),
      `${bundle.definition.id} @ ${bundle.definition.version}, fingerprint ${bundle.definition.fingerprint.slice(0, 16)}…`,
    );

    const ref = roundRefId({ roundId: bundle.roundId, clientEntropy: bundle.clientEntropy });
    const recomputedCommitment = seedCommitment(
      bundle.revealedServerSeed,
      BRANCHFALL,
      roundIdentityOf(BRANCHFALL, ref),
    );
    push(
      'PRE_COMMITMENT',
      'The seed published before your entropy existed opens to the seed revealed now',
      constantTimeHexEqual(recomputedCommitment, bundle.preCommitment),
      bundle.preCommitment,
    );

    const transcript = deserializeTranscript(bundle.transcript);
    push(
      'ROUND_PAIR',
      'The transcript is this round and your client seed',
      transcript.roundId === bundle.roundId && transcript.clientEntropy === bundle.clientEntropy,
      `${transcript.roundId} | ${transcript.clientEntropy.slice(0, 16)}…`,
    );
    push(
      'TAPE_DIGEST',
      'The digest published before you played is the digest of the revealed tape',
      constantTimeHexEqual(transcript.tapeDigest, bundle.tapeDigest),
      bundle.tapeDigest,
    );

    const result = stagedSurvival.verify(bundle.revealedServerSeed, BRANCHFALL, bundle.transcript);
    push(
      'PROOF',
      'The engine re-derives the whole round from the revealed seed',
      result.ok,
      result.ok ? `commitment ${result.commitment.slice(0, 16)}…` : `${result.code}: ${result.message}`,
    );

    const routeStake = parseMicro(bundle.routeStakeMicro, 'Route stake');
    for (const check of replayLedger(transcript, routeStake, bundle.credits)) checks.push(check);

    const total = bundle.credits.reduce(
      (sum, event) => sum + parseMicro(event.creditedMicro, 'credit'),
      0n,
    );
    push(
      'TOTAL',
      'The published total is the sum of the credits it lists',
      total === parseMicro(bundle.totalCreditedMicro, 'total'),
      `${total} micro-credits`,
    );
  } catch (error) {
    push(
      'INVALID_TRANSCRIPT',
      'The bundle could be read at all',
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  return { ok: checks.every((check) => check.ok), checks };
}

/** Sanity: the pre-commitment cannot depend on entropy that did not exist yet. */
export function commitmentIsEntropyIndependent(serverSeed: string, roundId: string): boolean {
  const a = seedCommitment(
    serverSeed,
    BRANCHFALL,
    roundIdentityOf(BRANCHFALL, roundRefId({ roundId, clientEntropy: '0'.repeat(64) })),
  );
  const b = seedCommitment(
    serverSeed,
    BRANCHFALL,
    roundIdentityOf(BRANCHFALL, roundRefId({ roundId, clientEntropy: 'f'.repeat(64) })),
  );
  return constantTimeHexEqual(a, b) && compare(rational(1n), rational(1n)) === 0;
}
