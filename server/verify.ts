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
import { createHash } from 'node:crypto';
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
  /** What the player typed. `clientEntropy` is it, or `SHA-256` of it. */
  readonly clientSeed: string;
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
      }

    const multiplier = rational(contract.multiplier.numerator, contract.multiplier.denominator);
    for (const slot of step.survivors)
      values.set(slot, multiply(values.get(slot) ?? rational(0n), multiplier));
    for (const slot of step.failed) values.set(slot, rational(0n));
    live = [...step.survivors];
  });

  boundary(transcript.steps.length);
  for (const event of credits) if (event.kind === 'SETTLE') creditAt(event);

  /**
   * Completeness: every share that was not lost was credited exactly once.
   *
   * Re-deriving only the events a bundle *lists* is not verification — delete
   * them all, publish a total of zero, and a bundle of nothing verifies. So the
   * required set is derived from the transcript instead: a runner is either
   * failed in some step, or banked at some boundary, or still standing at the
   * end, and each of the latter two owes exactly one route credit. A missing
   * event, an invented one, or an entity credited twice all fail here.
   */
  const failed = new Set<number>();
  for (const step of transcript.steps) for (const slot of step.failed) failed.add(slot);
  const owed = new Set<number>();
  for (let slot = 0; slot < SQUAD_SIZE; slot += 1) if (!failed.has(slot)) owed.add(slot);
  const seen = new Set<number>();
  let doubled: number | null = null;
  for (const event of credits) {
    if (event.kind === 'SIDE_BET') continue;
    for (const slot of event.entities) {
      if (seen.has(slot)) doubled ??= slot;
      seen.add(slot);
    }
  }
  const missing = [...owed].filter((slot) => !seen.has(slot));
  const extra = [...seen].filter((slot) => !owed.has(slot));
  if (doubled !== null) mismatch ??= `Runner ${doubled} is credited by two events`;
  else if (missing.length > 0)
    mismatch ??= `Runner${missing.length > 1 ? 's' : ''} ${missing.join(', ')} survived and no credit event pays them`;
  else if (extra.length > 0)
    mismatch ??= `Runner${extra.length > 1 ? 's' : ''} ${extra.join(', ')} fell and are credited anyway`;

  results.push({
    code: 'LEDGER',
    title: 'Every credited figure matches a fresh re-derivation',
    ok: mismatch === null,
    detail: mismatch ?? `${credits.length} credit events re-derived to the micro-credit`,
  });
  return results;
}

/**
 * Side-bet legality, checked by the verifier and not only by the server.
 *
 * The stake limits in `MATH.md` §5.5 are load-bearing for the cap proof and for
 * `DESIGN.md` §10.2's responsible-design claim, so a published round that
 * breached them should be visible as a breach to anyone holding the record —
 * not only to the process that refused to write it. Without this, a bundle
 * carrying a losing 999-credit ticket on a 5-credit run verified: the price and
 * the loss both re-derive, and nothing looked at the size.
 */
function checkSideBetLegality(
  transcript: SurvivalTranscript,
  routeStakeMicro: bigint,
  credits: readonly CreditEvent[],
): readonly CheckResult[] {
  const perBetCeiling = routeStakeMicro / 2n;
  const tickets = credits.filter(
    (event): event is Extract<CreditEvent, { kind: 'SIDE_BET' }> => event.kind === 'SIDE_BET',
  );
  let breach: string | null = null;
  let total = 0n;
  const perArena = new Map<number, Set<string>>();
  for (const ticket of tickets) {
    const stake = parseMicro(ticket.stakeMicro, 'Side-bet stake');
    total += stake;
    if (stake < 1_000_000n) breach ??= `${ticket.bet} at arena ${ticket.stage + 1} stakes under the 1.00 minimum`;
    if (stake > perBetCeiling)
      breach ??= `${ticket.bet} at arena ${ticket.stage + 1} stakes ${stake}, past half the route stake`;
    const seen = perArena.get(ticket.stage) ?? new Set<string>();
    if (seen.has(ticket.bet)) breach ??= `${ticket.bet} is staked twice in arena ${ticket.stage + 1}`;
    seen.add(ticket.bet);
    perArena.set(ticket.stage, seen);
    if (seen.size > 3) breach ??= `More than three tickets in arena ${ticket.stage + 1}`;
    if (ticket.stage >= transcript.steps.length)
      breach ??= `A ticket rides arena ${ticket.stage + 1}, which this round never ran`;
  }
  if (total > perBetCeiling)
    breach ??= `Side bets total ${total}, past half the route stake for the round`;
  return [
    {
      code: 'SIDE_BET_LIMITS',
      title: 'Every side bet is inside the declared stake limits',
      ok: breach === null,
      detail: breach ?? `${tickets.length} tickets, ${total} micro-credits, ceiling ${perBetCeiling}`,
    },
  ];
}

/**
 * The ledger is published in the order the round happened.
 *
 * Order does not move a figure here — no ticket and no round can reach the cap,
 * so the accumulator never binds — but a record that lists a settlement before
 * the shelter it followed is not a record of what happened, and a verifier that
 * silently re-sorts it is checking a different document from the one it was
 * handed.
 */
function checkOrdering(
  transcript: SurvivalTranscript,
  credits: readonly CreditEvent[],
): CheckResult {
  const rank = (event: CreditEvent): number => {
    const stage = event.stage;
    const within = event.kind === 'SETTLE' ? 3 : event.kind === 'SIDE_BET' ? 2 : 1;
    return stage * 10 + within;
  };
  let previous = -1;
  let out: string | null = null;
  for (const event of credits) {
    const value = rank(event);
    if (value < previous) out ??= `${event.kind} at stage ${event.stage} is out of order`;
    previous = Math.max(previous, value);
  }
  const settlements = credits.filter((event) => event.kind === 'SETTLE');
  if (settlements.length > 1) out ??= 'A round settles once';
  if (settlements.length === 1 && credits[credits.length - 1]?.kind !== 'SETTLE')
    out ??= 'The settlement is not the last credit';
  void transcript;
  return {
    code: 'LEDGER_ORDER',
    title: 'The credits are published in the order the round happened',
    ok: out === null,
    detail: out ?? `${credits.length} events, in order`,
  };
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

    const seedIsHex = /^[0-9a-f]{64}$/u.test(bundle.clientSeed ?? '');
    const derived = seedIsHex
      ? bundle.clientSeed
      : createHash('sha256').update(bundle.clientSeed ?? '', 'utf8').digest('hex');
    push(
      'CLIENT_SEED',
      'The round used the seed you typed',
      derived === bundle.clientEntropy,
      seedIsHex
        ? 'used as given'
        : `SHA-256("${bundle.clientSeed}") = ${bundle.clientEntropy.slice(0, 16)}…`,
    );

    const routeStake = parseMicro(bundle.routeStakeMicro, 'Route stake');
    for (const check of replayLedger(transcript, routeStake, bundle.credits)) checks.push(check);
    for (const check of checkSideBetLegality(transcript, routeStake, bundle.credits)) checks.push(check);
    checks.push(checkOrdering(transcript, bundle.credits));

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

    /**
     * The stake is a declaration, and saying so is the honest part.
     *
     * Commit-reveal proves what the tape was and what the decisions were. It
     * cannot prove what was debited, because no stake is inside the commitment —
     * the engine's transcript has no stake field, and nothing here is signed. So
     * what this verifier establishes is that **every credit is right for the
     * stake the record declares**, and a player checks the stake itself against
     * what their own client showed them. Claiming more would be claiming a
     * control that does not exist (`ENGINE.md` §10.1's residual risks, and §12).
     */
    push(
      'STAKE_BASIS',
      'The stake is a declared field, not a proven one — every credit is checked against it',
      routeStake >= 1_000_000n && routeStake <= 1_000_000_000n && routeStake % 5n === 0n,
      `${routeStake} micro-credits, inside the declared stake limits`,
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
