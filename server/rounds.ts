/**
 * The round lifecycle: server-authoritative, idempotent, and the only place money
 * moves.
 *
 * The order in `docs/ENGINE.md` §5 is the order here, and no other:
 *
 * ```
 * 0. precommit   operator publishes SHA-256(seed, roundId). It has seen nothing of yours.
 * 1. open        player contributes entropy, binds it to the commitment it saw, and buys.
 *                only NOW is the tape derived — from both halves — and only its digest published.
 * 2. commit      route, fork balance, shelter, side bets. One transaction.
 * 3. resolve     the arena the player already committed to, replayed from the sealed tape.
 * 4. settle      the seed is revealed and the transcript published.
 * 5. verify      anyone, from the published record alone.
 * ```
 *
 * Three properties this file is responsible for, each stated where it is
 * enforced rather than here: the tape never leaves the process before settlement
 * (§10.2 prices what that is worth at 249% realised return), no command may
 * arrive before `earliestNextActionAtMs` (§6.2), and an abandoned round closes
 * through `expire()` and nothing else (§6.1).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  add,
  compare,
  constantTimeHexEqual,
  floor,
  multiply,
  rational,
  type Rational,
} from '@axiom-games/reveal-engine/core';
import {
  SurvivalBook,
  assertClientEntropy,
  deriveSteps,
  deriveTruth,
  makeTranscript,
  roundIdentityOf,
  roundRefId,
  seedCommitment,
  stagedSurvival,
  survivorDistribution,
  transcriptToWire,
  type SurvivalStep,
  type SurvivalTranscript,
  type SurvivalTruth,
} from '@axiom-games/reveal-engine/modules/staged-survival';
import { Clock } from './clock.js';
import {
  ARENAS,
  ARENA_NAMES,
  ARENA_SUBTITLES,
  BRANCHFALL,
  DEFAULT_RUNNER_NAMES,
  ENTRY_RETURN,
  FINGERPRINT,
  MAX_STAKE_MICRO,
  MIN_GAME_CYCLE_MS,
  MIN_STAKE_MICRO,
  SPEED,
  SQUAD_SIZE,
} from './definition.js';
import {
  RouteError,
  ROUTE_TITLES,
  engineContractFor,
  laneBalances,
  laneSizesFor,
  menuFor,
  validateRoute,
  type RouteId,
} from './geometry.js';
import { credits, decimals, fraction, view, type WireRationalView } from './money.js';
import { MICRO_PER_CREDIT } from './definition.js';
import { figuresFor, geometryKey, type GeometryFigures } from './paytable.js';
import { REHEARSAL_SEED_PAIR } from './rehearsal-seed.js';
import {
  SideBetError,
  allowanceFor,
  priceTickets,
  settleTickets,
  type PricedTicket,
  type SettledTicket,
} from './sidebets.js';
import { InsufficientFunds, Wallet } from './wallet.js';
import { BUNDLE_SCHEMA, type CreditEvent, type VerificationBundle } from './verify.js';
import { ghostLines, type GhostRow } from './ghost.js';

/**
 * A claim is carried in **micro-credits** — the unit the engine's book holds and
 * the unit a credit is floored to. Every label is in credits, so the conversion
 * happens once, here, and never by hand at a call site. Getting this wrong is
 * how a screen ends up showing `4775000.000` where the player staked five.
 */
function inCredits(value: Rational): Rational {
  return rational(value.numerator, value.denominator * MICRO_PER_CREDIT);
}

export class RoundError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly path?: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RoundError';
  }
}

export type RoundPhase =
  | 'PRECOMMIT'
  | 'DECISION'
  | 'RUNNING'
  | 'FINISHED'
  | 'SETTLED'
  | 'VOID';

export type RunnerStatus = 'running' | 'home' | 'lost';

interface Runner {
  readonly slot: number;
  name: string;
  status: RunnerStatus;
}

interface PendingChoice {
  readonly route: RouteId;
  readonly laneSplit: number | null;
  readonly shelter: readonly number[];
  readonly running: readonly number[];
  readonly contractId: string;
  readonly tickets: readonly PricedTicket[];
  readonly claimBefore: Rational;
  readonly shelterCreditedMicro: bigint;
  readonly committedAtMs: number;
}

export interface ArenaRecord {
  readonly index: number;
  readonly name: string;
  readonly route: RouteId;
  readonly laneSplit: number | null;
  readonly shelter: readonly { readonly slot: number; readonly name: string }[];
  readonly shelterCreditedMicro: bigint;
  readonly lanes: readonly {
    readonly entities: readonly { readonly slot: number; readonly name: string }[];
    readonly collapsed: boolean;
  }[];
  readonly survivors: readonly { readonly slot: number; readonly name: string }[];
  readonly fallen: readonly { readonly slot: number; readonly name: string }[];
  readonly running: number;
  readonly claimBeforeMicro: bigint;
  /** After a shelter has taken its share out, which is what the branch ran with. */
  readonly claimRunningMicro: bigint;
  readonly claimAfterMicro: bigint;
  readonly claimBefore: WireRationalView;
  readonly claimAfter: WireRationalView;
  readonly claimFactor: WireRationalView;
  readonly sideBets: readonly SettledTicket[];
  readonly arithmetic: string;
}

export interface Settlement {
  readonly kind: 'BANK' | 'FINISH' | 'WIPE' | 'AUTO_BANK' | 'VOID';
  readonly creditedMicro: bigint;
  readonly totalCreditedMicro: bigint;
  readonly routeStakeMicro: bigint;
  readonly sideBetStakeMicro: bigint;
  readonly returnMultiple: string;
  readonly revealedServerSeed: string | null;
  readonly transcript: unknown;
  readonly settledAtMs: number;
}

interface StoredCommand {
  readonly fingerprint: string;
  readonly response: unknown;
}

const ZERO_ENTROPY = '0'.repeat(64);

function slotName(runners: readonly Runner[], slot: number): string {
  return runners.find((runner) => runner.slot === slot)?.name ?? `Runner ${slot}`;
}

function named(runners: readonly Runner[], slots: readonly number[]) {
  return slots.map((slot) => ({ slot, name: slotName(runners, slot) }));
}

/** One round. Every field the operator must persist for the life of the liability lives here. */
export class Round {
  phase: RoundPhase = 'PRECOMMIT';
  readonly createdAtMs: number;
  publishedAtMs: number;
  clientEntropy: string | null = null;
  /** Exactly what the player typed. Hashed into `clientEntropy` when it is not already hex. */
  clientSeedText: string | null = null;
  stakeMicro = 0n;
  entityStakeMicro = 0n;
  book: SurvivalBook | null = null;
  /** SEALED. Never serialised into any response before `settle()`. */
  truth: SurvivalTruth | null = null;
  tapeDigest: string | null = null;
  runners: Runner[];
  readonly arenas: ArenaRecord[] = [];
  pending: PendingChoice | null = null;
  sideBetStakedMicro = 0n;
  sideBetCreditedMicro = 0n;
  routeCreditedMicro = 0n;
  earliestNextActionAtMs = 0;
  settlement: Settlement | null = null;
  transcript: SurvivalTranscript | null = null;
  readonly commands = new Map<string, StoredCommand>();
  /** Every credit, in the order it happened. The ledger a verifier re-derives. */
  readonly creditEvents: CreditEvent[] = [];
  lastLossAtMs = 0;

  constructor(
    readonly roundId: string,
    /** PRIVATE until settlement. */
    readonly serverSeed: string,
    readonly preCommitment: string,
    now: number,
  ) {
    this.createdAtMs = now;
    this.publishedAtMs = now;
    this.runners = DEFAULT_RUNNER_NAMES.map((name, slot) => ({
      slot,
      name,
      status: 'running' as RunnerStatus,
    }));
  }

  get roundRef(): string {
    if (this.clientEntropy === null) throw new RoundError('INVALID_ARGUMENT', 'Round is not open');
    return roundRefId({ roundId: this.roundId, clientEntropy: this.clientEntropy });
  }

  get liveSlots(): readonly number[] {
    return this.book ? this.book.live : [];
  }

  /** Exact, unfloored, the sum of every claim still at risk. */
  get claim(): Rational {
    if (!this.book) return rational(0n);
    let total = rational(0n);
    for (const held of this.book.claims) if (held.live) total = add(total, held.value);
    return total;
  }

  get claimMicro(): bigint {
    return floor(this.claim);
  }

  get arena(): number {
    return (this.book?.stageRevision ?? 0) + 1;
  }
}

export interface CommandEnvelope {
  readonly idempotencyKey?: unknown;
  readonly expectedFrameRevision?: unknown;
}

/**
 * The round store.
 *
 * One process, one map, no database — the module supplies deterministic state
 * transitions and *"is not a wallet, not a database, and not a session manager"*
 * (`ENGINE.md` §9). This class is the smallest honest version of the three.
 */
export class RoundStore {
  readonly #rounds = new Map<string, Round>();
  #counter = 0;
  #openingRoundId: string | null = null;

  /**
   * Where server seeds come from.
   *
   * A reviewed CSPRNG in every real configuration (`ENGINE.md` §9, seed custody).
   * It is injectable for exactly one reason: a playthrough test that asserts
   * *specific* credits needs a round whose outcome it knows in advance, and a
   * test that reaches inside the server to fake one proves less than a test that
   * drives the real HTTP surface against a fixed seed. Nothing on the network can
   * choose it.
   */
  seedSource: () => string = () => randomBytes(32).toString('hex');

  /**
   * Where round ids come from.
   *
   * The round id is inside the seed pre-commitment and inside every draw, so it
   * is as much a part of the tape as the seeds are — which is why an operator
   * that mints one *after* seeing the client seed has the whole grinding attack
   * back (`ENGINE.md` §5). It is injectable for the same reason `seedSource` is
   * and with the same boundary: a test may fix it, the network may not.
   */
  roundIdSource: (counter: number) => string = (counter) =>
    `bf-${counter}-${randomUUID().slice(0, 8)}`;

  constructor(
    readonly wallet: Wallet,
    readonly clock: Clock,
    readonly expiryWindowMs: number = 24 * 60 * 60 * 1000,
  ) {}

  get(roundId: unknown): Round {
    if (typeof roundId !== 'string' || !this.#rounds.has(roundId))
      throw new RoundError('INVALID_ARGUMENT', 'Unknown round', 404, '$.roundId');
    return this.#rounds.get(roundId) as Round;
  }

  get all(): readonly Round[] {
    return [...this.#rounds.values()];
  }

  /**
   * The open round, if there is one.
   *
   * The store refuses a second one below, so the reverse scan is normally
   * observationally identical to any scan. Choosing the newest is defence in
   * depth for a restored or hand-built store that already violates the invariant:
   * the session and the refusal then point at the same round a client should
   * resume, rather than quietly exposing an older stranded liability.
   */
  get openRound(): Round | undefined {
    if (this.#openingRoundId) {
      const opening = this.#rounds.get(this.#openingRoundId);
      if (opening) return opening;
    }
    const rounds = this.all;
    for (let index = rounds.length - 1; index >= 0; index -= 1) {
      const round = rounds[index] as Round;
      if (round.phase !== 'SETTLED' && round.phase !== 'VOID' && round.phase !== 'PRECOMMIT')
        return round;
    }
    return undefined;
  }

  // ---------------------------------------------------------------- step 0

  /**
   * Publishes the pre-commitment.
   *
   * The seed is drawn now and sealed now, before any client entropy exists, which
   * is the entire control against seed grinding (`ENGINE.md` §10.1: grinding 64
   * candidates against a server-only seed drives realised Ranger RTP to zero, and
   * every one of those rounds still verifies).
   *
   * `seedCommitment()` binds the operator round id and not the entropy — that is
   * the module's documented contract and the reason the commitment can be
   * published first. `open()` re-computes it against the real pair and refuses
   * the round if the two ever differ, so the property this step depends on is
   * checked at the point of use rather than assumed.
   */
  precommit(): {
    roundId: string;
    seedCommitment: string;
    publishedAtMs: number;
    definition: { id: string; version: string; fingerprint: string; moduleId: string };
  } {
    const now = this.clock.now();
    this.#counter += 1;
    const roundId = this.roundIdSource(this.#counter);
    let serverSeed = this.seedSource();
    // The published rehearsal seed is on a deny-list for live rounds
    // (`ENGINE.md` §10.2). It is a repeating pattern precisely so this check is
    // possible; drawing it from a CSPRNG is a 2^-256 event, and refusing it is
    // still cheaper than the paragraph explaining why we did not.
    while (serverSeed === REHEARSAL_SEED_PAIR.serverSeed)
      serverSeed = randomBytes(32).toString('hex');
    const commitment = seedCommitment(
      serverSeed,
      BRANCHFALL,
      roundIdentityOf(BRANCHFALL, roundRefId({ roundId, clientEntropy: ZERO_ENTROPY })),
    );
    const round = new Round(roundId, serverSeed, commitment, now);
    this.#rounds.set(roundId, round);
    return {
      roundId,
      seedCommitment: commitment,
      publishedAtMs: now,
      definition: {
        id: BRANCHFALL.id,
        version: BRANCHFALL.version,
        fingerprint: FINGERPRINT,
        moduleId: stagedSurvival.id,
      },
    };
  }

  // ---------------------------------------------------------------- step 1

  async open(
    roundId: unknown,
    body: { clientSeed?: unknown; clientEntropy?: unknown; respondingTo?: unknown; stakeMicro?: unknown },
  ): Promise<Round> {
    const round = this.get(roundId);
    if (round.phase !== 'PRECOMMIT')
      throw new RoundError('ILLEGAL_ACTION', 'That round is already open', 409);
    if (this.#openingRoundId === round.roundId)
      throw new RoundError('ILLEGAL_ACTION', 'That round is already open', 409);
    // The shipped client resumes `openRoundId` and never offers a second OPEN,
    // so this is defence in depth for direct API callers and future integrations,
    // not a claim that the present UI can strand liabilities by itself.
    const alreadyOpen = this.openRound;
    if (alreadyOpen && alreadyOpen !== round)
      throw new RoundError(
        'ROUND_ALREADY_OPEN',
        'This session already has a round in progress',
        409,
        '$.roundId',
        { openRoundId: alreadyOpen.roundId },
      );

    // The client binds its seed to the commitment it saw (`ENGINE.md` §5). An
    // honest client stores exactly one commitment before revealing its entropy
    // and refuses to answer any other, so entropy collected before a commitment
    // existed is unusable.
    if (typeof body.respondingTo !== 'string' || !constantTimeHexEqual(body.respondingTo, round.preCommitment))
      throw new RoundError(
        'COMMITMENT_MISMATCH',
        'Your seed answers a commitment this round did not publish',
        409,
        '$.respondingTo',
      );

    // The player's seed is whatever they typed, and the operator must accept it
    // (`ENGINE.md` §9: 1–64 bytes of printable ASCII, player-editable, refusing
    // it is an integration defect of the highest severity). The module needs
    // exactly 32 bytes of hex, so a seed that is not already in that form is
    // hashed into it — publicly, reproducibly, and shown next to the seed on the
    // verification screen, so a player who typed a seed can still see that
    // theirs is the one that was used.
    const seedText = typeof body.clientSeed === 'string' ? body.clientSeed : body.clientEntropy;
    if (typeof seedText !== 'string' || seedText.length === 0 || Buffer.byteLength(seedText, 'utf8') > 64)
      throw new RoundError(
        'INVALID_ARGUMENT',
        'A client seed is 1 to 64 characters. Anything you like.',
        400,
        '$.clientSeed',
      );
    if (/[\x00-\x1f\x7f]/u.test(seedText))
      throw new RoundError('INVALID_ARGUMENT', 'A client seed is printable text', 400, '$.clientSeed');
    const clientEntropy = /^[0-9a-f]{64}$/u.test(seedText)
      ? seedText
      : createHash('sha256').update(seedText, 'utf8').digest('hex');
    try {
      assertClientEntropy(clientEntropy, '$.clientEntropy');
    } catch {
      throw new RoundError('INVALID_ARGUMENT', 'That seed could not be used', 400, '$.clientSeed');
    }
    if (clientEntropy === REHEARSAL_SEED_PAIR.clientEntropy)
      throw new RoundError(
        'INVALID_ARGUMENT',
        'That is the published rehearsal seed. It is denied for staked rounds.',
        400,
        '$.clientEntropy',
      );

    const stake = parseMicro(body.stakeMicro, '$.stakeMicro');
    if (stake < MIN_STAKE_MICRO || stake > MAX_STAKE_MICRO)
      throw new RoundError(
        'INVALID_ARGUMENT',
        `A run costs between ${credits(MIN_STAKE_MICRO, 2)} and ${credits(MAX_STAKE_MICRO, 2)} credits`,
        400,
        '$.stakeMicro',
      );
    // Every runner carries an equal share of the claim (`MATH.md` §4), and a
    // share is a real entry in the engine's book, so the stake has to divide
    // exactly. At micro-credit precision this only excludes stakes that are not
    // a whole number of five-millionths of a credit.
    if (stake % BigInt(SQUAD_SIZE) !== 0n)
      throw new RoundError(
        'INVALID_ARGUMENT',
        `A stake divides into ${SQUAD_SIZE} equal shares, so it is a multiple of ${SQUAD_SIZE} micro-credits`,
        400,
        '$.stakeMicro',
      );

    // Reserve the session synchronously before the first engine await. Without a
    // reservation, two direct API calls can both observe PRECOMMIT, both debit,
    // and only later publish their DECISION phases. The ordinary client cannot
    // issue that race, but the server invariant must survive callers that can.
    this.#openingRoundId = round.roundId;
    try {
      try {
        this.wallet.debit(stake, 'Route ticket', round.roundId);
      } catch (error) {
        if (error instanceof InsufficientFunds)
          throw new RoundError('INSUFFICIENT_FUNDS', error.message, 402, '$.stakeMicro');
        throw error;
      }

      const book = new SurvivalBook(BRANCHFALL);
      const perRunner = stake / BigInt(SQUAD_SIZE);
      for (let slot = 0; slot < SQUAD_SIZE; slot += 1)
        await book.enter(`${round.roundId}:enter:${slot}`, slot, perRunner);

      round.clientEntropy = clientEntropy;
      round.clientSeedText = seedText;
      round.stakeMicro = stake;
      round.entityStakeMicro = perRunner;
      round.book = book;

      // The commitment published in step 0 must be the commitment of this pair.
      const recomputed = seedCommitment(
        round.serverSeed,
        BRANCHFALL,
        roundIdentityOf(BRANCHFALL, round.roundRef),
      );
      if (!constantTimeHexEqual(recomputed, round.preCommitment))
        throw new RoundError(
          'COMMITMENT_MISMATCH',
          'The published pre-commitment is not this round’s commitment',
          500,
        );

      // Only now, and never before, is the tape derived — from both halves.
      round.truth = deriveTruth(round.serverSeed, BRANCHFALL, round.roundRef);
      round.tapeDigest = round.truth.digest;
      round.phase = 'DECISION';
      round.earliestNextActionAtMs = this.clock.now();
      return round;
    } finally {
      if (this.#openingRoundId === round.roundId) this.#openingRoundId = null;
    }
  }

  // ---------------------------------------------------------------- step 2

  async commit(
    roundId: unknown,
    body: CommandEnvelope & {
      route?: unknown;
      laneSplit?: unknown;
      shelter?: unknown;
      laneOrder?: unknown;
      sideBets?: unknown;
    },
  ): Promise<unknown> {
    if (body === null || typeof body !== 'object' || Array.isArray(body))
      throw new RoundError('INVALID_ARGUMENT', 'A command body is a JSON object', 400, '$');
    const round = this.get(roundId);
    const key = idempotencyKey(body);
    const stored = round.commands.get(key);
    const fingerprint = JSON.stringify({
      c: 'commit',
      route: body.route ?? null,
      laneSplit: body.laneSplit ?? null,
      shelter: body.shelter ?? null,
      laneOrder: body.laneOrder ?? null,
      sideBets: body.sideBets ?? null,
    });
    if (stored) {
      if (stored.fingerprint !== fingerprint)
        throw new RoundError('IDEMPOTENCY_CONFLICT', 'That key was used for a different command', 409);
      return stored.response;
    }

    if (round.phase !== 'DECISION')
      throw new RoundError('ILLEGAL_ACTION', 'This round is not waiting for a route', 409);
    const book = round.book as SurvivalBook;
    this.#assertFrame(round, body);
    this.#assertCycle(round);

    const live = round.liveSlots;
    let action;
    try {
      action = validateRoute(live, {
        route: body.route,
        laneSplit: body.laneSplit,
        shelter: body.shelter,
      });
    } catch (error) {
      if (error instanceof RouteError)
        throw new RoundError(error.code, error.message, 400, error.path);
      throw error;
    }

    const runningSlots = live.filter((slot) => !action.shelter.includes(slot));

    // Who takes the thin limb. A permutation of names over the running slots:
    // mathematically inert (`MATH.md` §5.4 — runners are exchangeable), and the
    // whole emotional content of the fork. It selects which pre-committed slip
    // draw each named Kindling consumes, and nothing else in the model moves.
    const laneOrder =
      body.laneOrder === undefined || body.laneOrder === null
        ? null
        : this.#validateLaneOrder(round, runningSlots, body.laneOrder);

    const distribution = survivorDistribution(
      BRANCHFALL,
      engineContractFor(action.route, action.laneSplit),
      action.running,
    );

    let tickets: readonly PricedTicket[] = [];
    const rawTickets = body.sideBets;
    if (rawTickets !== undefined) {
      if (!Array.isArray(rawTickets))
        throw new RoundError('INVALID_SIDE_BET', 'Side bets are a list of tickets', 400, '$.sideBets');
      try {
        tickets = priceTickets(
          rawTickets,
          distribution,
          round.stakeMicro,
          round.sideBetStakedMicro,
        );
      } catch (error) {
        if (error instanceof SideBetError)
          throw new RoundError(error.code, error.message, 400, error.path);
        throw error;
      }
    }

    const sideBetTotal = tickets.reduce((total, ticket) => total + ticket.stakeMicro, 0n);
    if (sideBetTotal > this.wallet.balanceMicro)
      throw new RoundError('INSUFFICIENT_FUNDS', 'Not enough free-play credits for those tickets', 402);

    const claimBefore = round.claim;

    // One transaction, in this order: bank the shelter, debit the tickets, log
    // the decision. Everything above this line is validation; nothing below it
    // may fail on player input.
    if (laneOrder) this.#reseat(round, runningSlots, laneOrder);
    let shelterCredited = 0n;
    if (action.shelter.length > 0) {
      const receipt = await book.bank(`${key}:shelter`, [...action.shelter]);
      shelterCredited = receipt.credited;
      round.routeCreditedMicro += receipt.credited;
      round.creditEvents.push({
        kind: 'SHELTER',
        stage: book.stageRevision,
        entities: [...action.shelter],
        creditedMicro: receipt.credited.toString(),
      });
      this.wallet.credit(receipt.credited, 'Shelter', round.roundId);
      for (const slot of action.shelter) {
        const runner = round.runners.find((candidate) => candidate.slot === slot);
        if (runner) runner.status = 'home';
      }
    }

    for (const ticket of tickets) {
      this.wallet.debit(ticket.stakeMicro, `Side bet — ${ticket.bet}`, round.roundId);
      round.sideBetStakedMicro += ticket.stakeMicro;
    }

    await book.choose(`${key}:choose`, action.contract.id);

    const committedAt = this.clock.now();
    round.pending = {
      route: action.route,
      laneSplit: action.laneSplit,
      shelter: action.shelter,
      running: Object.freeze([...runningSlots]),
      contractId: action.contract.id,
      tickets,
      claimBefore,
      shelterCreditedMicro: shelterCredited,
      committedAtMs: committedAt,
    };
    round.phase = 'RUNNING';
    // `DESIGN.md` §5.1: from the moment a route is committed, the next money
    // control stays locked. A floor, not a countdown — nothing expires and
    // waiting longer is always free.
    round.earliestNextActionAtMs = committedAt + MIN_GAME_CYCLE_MS;

    const response = {
      ok: true,
      frameRevision: book.stageRevision,
      arena: round.arena,
      route: action.route,
      laneSplit: action.laneSplit,
      lanes: this.#lanePreview(round, runningSlots, action.route, action.laneSplit),
      shelter: named(round.runners, [...action.shelter]),
      shelterCreditedMicro: shelterCredited.toString(),
      sideBets: tickets.map((ticket) => ({
        bet: ticket.bet,
        stakeMicro: ticket.stakeMicro.toString(),
        multiplier: fraction(ticket.multiplier),
        probability: fraction(ticket.probability),
      })),
      /** Presentation only. The outcome is already sealed and is not in this response. */
      replayMs: 9000 + ((action.running * 977) % 5000),
      earliestNextActionAtMs: round.earliestNextActionAtMs,
    };
    round.commands.set(key, { fingerprint, response });
    return response;
  }

  // ---------------------------------------------------------------- step 3

  /**
   * Resolves the arena the player already committed to.
   *
   * The step is a pure function of (sealed tape, logged decisions) — the server
   * does not choose anything here, and could not: every draw the round can ever
   * consume was fixed before the first decision existed. Splitting it from
   * `commit()` is presentation (`DESIGN.md` §S3's 9–14 s replay), never
   * arithmetic; a client that never calls it is closed by `expire()`, which
   * resolves the committed route first because the money was already at risk.
   */
  async resolve(roundId: unknown, body: CommandEnvelope = {}): Promise<unknown> {
    const round = this.get(roundId);
    const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : `${round.roundId}:resolve:${round.arena}`;
    const stored = round.commands.get(key);
    if (stored) return stored.response;
    if (round.phase !== 'RUNNING' || !round.pending)
      throw new RoundError('ILLEGAL_ACTION', 'No branch is being run', 409);
    const record = await this.#applyResolution(round);
    const response = {
      ok: true,
      resolution: serialiseArena(record),
      frameRevision: (round.book as SurvivalBook).stageRevision,
      phase: round.phase,
    };
    round.commands.set(key, { fingerprint: 'resolve', response });
    return response;
  }

  async #applyResolution(round: Round): Promise<ArenaRecord> {
    const book = round.book as SurvivalBook;
    const truth = round.truth as SurvivalTruth;
    const pending = round.pending as PendingChoice;

    const steps = deriveSteps(BRANCHFALL, truth, book.choices);
    const step = steps[book.stageRevision] as SurvivalStep;
    await book.resolve(step);

    const survivors = [...step.survivors];
    const fallen = [...step.failed];
    for (const slot of fallen) {
      const runner = round.runners.find((candidate) => candidate.slot === slot);
      if (runner) runner.status = 'lost';
    }

    const settled = settleTickets(pending.tickets, survivors.length, pending.running.length);
    for (const ticket of settled) {
      round.creditEvents.push({
        kind: 'SIDE_BET',
        stage: step.index,
        bet: ticket.bet,
        stakeMicro: ticket.stakeMicro.toString(),
        multiplier: ticket.multiplierExact,
        won: ticket.won,
        creditedMicro: ticket.creditedMicro.toString(),
      });
      if (ticket.creditedMicro > 0n) {
        this.wallet.credit(ticket.creditedMicro, `Side bet — ${ticket.bet}`, round.roundId);
        round.sideBetCreditedMicro += ticket.creditedMicro;
      }
    }

    const claimAfter = round.claim;
    // The claim the branch actually ran with. A shelter credits its share before
    // the arena resolves, so printing the pre-shelter figure in the arithmetic
    // line would print an equation that does not add up — which is precisely the
    // kind of money display §10.5 forbids.
    const claimRunning = multiply(
      pending.claimBefore,
      rational(
        BigInt(pending.running.length),
        BigInt(pending.running.length + pending.shelter.length),
      ),
    );
    const factor = multiply(
      rational(BigInt(survivors.length), BigInt(pending.running.length)),
      rational(
        engineContractFor(pending.route, pending.laneSplit).multiplier.numerator,
        engineContractFor(pending.route, pending.laneSplit).multiplier.denominator,
      ),
    );

    const record: ArenaRecord = Object.freeze({
      index: step.index + 1,
      name: ARENA_NAMES[step.index] ?? `Arena ${step.index + 1}`,
      route: pending.route,
      laneSplit: pending.laneSplit,
      shelter: named(round.runners, [...pending.shelter]),
      shelterCreditedMicro: pending.shelterCreditedMicro,
      lanes: step.lanes.map((lane) => ({
        entities: named(round.runners, [...lane.entities]),
        collapsed: lane.collapsed,
      })),
      survivors: named(round.runners, survivors),
      fallen: named(round.runners, fallen),
      running: pending.running.length,
      claimBeforeMicro: floor(pending.claimBefore),
      claimAfterMicro: floor(claimAfter),
      claimBefore: view(inCredits(pending.claimBefore), 6),
      claimAfter: view(inCredits(claimAfter), 6),
      claimFactor: view(factor, 8),
      sideBets: settled,
      claimRunningMicro: floor(claimRunning),
      arithmetic:
        (pending.shelter.length > 0
          ? `${decimals(inCredits(pending.claimBefore), 3)} − ${decimals(inCredits(pending.claimBefore), 3) === decimals(inCredits(claimRunning), 3) ? '0.000' : credits(pending.shelterCreditedMicro, 3)} home → `
          : '') +
        `${decimals(inCredits(claimRunning), 3)} x (${survivors.length}/${pending.running.length}) x ${decimals(
          rational(
            engineContractFor(pending.route, pending.laneSplit).multiplier.numerator,
            engineContractFor(pending.route, pending.laneSplit).multiplier.denominator,
          ),
          3,
        )} = ${decimals(inCredits(claimAfter), 3)}`,
    });
    round.arenas.push(record);
    round.pending = null;

    if (book.live.length === 0) {
      round.phase = 'FINISHED';
      round.lastLossAtMs = this.clock.now();
    } else if (book.stageRevision >= ARENAS) {
      round.phase = 'FINISHED';
    } else {
      round.phase = 'DECISION';
    }
    return record;
  }

  // ---------------------------------------------------------------- step 4

  /**
   * BANK: bring every remaining lantern home, then settle.
   *
   * Legal from arena 2 onward and never before, because `BANK` does not exist in
   * state `(1, n)` (`MATH.md` §5.3). Buying a run commits you to arena 1: the
   * action set there is `{ROUTE(...), SHELTER(1..n-1)}` and every element of it
   * runs at least one runner. The engine's book would accept an all-entity bank
   * at stage zero — it is a generic module and that is a legal move in some
   * game — so the rule is enforced here, where the product is.
   */
  async bank(roundId: unknown, body: CommandEnvelope = {}): Promise<unknown> {
    const round = this.get(roundId);
    const key = idempotencyKey(body);
    const fingerprint = `bank:${String(body.expectedFrameRevision ?? 'any')}`;
    const stored = round.commands.get(key);
    if (stored) {
      if (stored.fingerprint !== fingerprint)
        throw new RoundError('IDEMPOTENCY_CONFLICT', 'That key was used for a different command', 409);
      return stored.response;
    }
    if (round.phase !== 'DECISION')
      throw new RoundError('ILLEGAL_ACTION', 'There is nothing to bank right now', 409);
    const book = round.book as SurvivalBook;
    if (book.stageRevision < 1)
      throw new RoundError(
        'ILLEGAL_ACTION',
        'Banking starts after the first branch. Every route on this screen sends at least one Kindling across.',
        409,
      );
    this.#assertFrame(round, body);
    this.#assertCycle(round);

    const live = [...book.live];
    if (live.length === 0) throw new RoundError('ILLEGAL_ACTION', 'No runner is still out', 409);
    const receipt = await book.bank(`${key}:bank`, live);
    round.routeCreditedMicro += receipt.credited;
    round.creditEvents.push({
      kind: 'BANK',
      stage: book.stageRevision,
      entities: live,
      creditedMicro: receipt.credited.toString(),
    });
    this.wallet.credit(receipt.credited, 'Bank', round.roundId);
    for (const slot of live) {
      const runner = round.runners.find((candidate) => candidate.slot === slot);
      if (runner) runner.status = 'home';
    }
    const settlement = await this.#settle(round, 'BANK', receipt.credited);
    const response = { ok: true, settlement: serialiseSettlement(settlement), phase: round.phase };
    round.commands.set(key, { fingerprint, response });
    return response;
  }

  /** Settles a finished round: the finish line, or a wipe. */
  async finish(roundId: unknown, body: CommandEnvelope = {}): Promise<unknown> {
    const round = this.get(roundId);
    const key = idempotencyKey(body);
    const stored = round.commands.get(key);
    if (stored) return stored.response;
    if (round.phase !== 'FINISHED')
      throw new RoundError('ILLEGAL_ACTION', 'This round has not finished', 409);
    const book = round.book as SurvivalBook;
    // A wipe is a round with nothing still running. Anything sheltered along the
    // way was credited when it was sheltered and is stated separately (§S6).
    const wiped = book.live.length === 0;
    const kind: Settlement['kind'] = wiped ? 'WIPE' : 'FINISH';
    for (const runner of round.runners) if (runner.status === 'running') runner.status = 'home';
    const settlement = await this.#settle(round, kind, 0n);
    const response = { ok: true, settlement: serialiseSettlement(settlement), phase: round.phase };
    round.commands.set(key, { fingerprint: 'finish', response });
    return response;
  }

  /**
   * The reveal.
   *
   * `settle()` is required on every path, including a round where everything has
   * already been banked or has failed: it is the only call that takes the
   * revealed seed, and a round whose seed is never revealed is a round nobody can
   * verify.
   */
  async #settle(round: Round, kind: Settlement['kind'], alreadyCredited: bigint): Promise<Settlement> {
    const book = round.book as SurvivalBook;
    const transcript = makeTranscript(round.serverSeed, BRANCHFALL, round.roundRef, book.choices);
    const liveAtSettle = [...book.live];
    const receipt = await book.settle(`${round.roundId}:settle`, round.serverSeed, transcript);
    round.routeCreditedMicro += receipt.credited;
    round.creditEvents.push({
      kind: 'SETTLE',
      stage: book.stageRevision,
      entities: liveAtSettle,
      creditedMicro: receipt.credited.toString(),
    });
    if (receipt.credited > 0n) this.wallet.credit(receipt.credited, 'Settlement', round.roundId);
    round.transcript = transcript;

    const totalCredited = round.routeCreditedMicro + round.sideBetCreditedMicro;
    const totalStaked = round.stakeMicro + round.sideBetStakedMicro;
    const settlement: Settlement = Object.freeze({
      kind,
      creditedMicro: alreadyCredited + receipt.credited,
      totalCreditedMicro: totalCredited,
      routeStakeMicro: round.stakeMicro,
      sideBetStakeMicro: round.sideBetStakedMicro,
      returnMultiple: decimals(rational(totalCredited, totalStaked === 0n ? 1n : totalStaked), 4),
      revealedServerSeed: round.serverSeed,
      transcript: transcriptToWire(transcript),
      settledAtMs: this.clock.now(),
    });
    round.settlement = settlement;
    round.phase = 'SETTLED';
    if (totalCredited < totalStaked) round.lastLossAtMs = this.clock.now();
    return settlement;
  }

  // ---------------------------------------------------------------- expiry

  /**
   * The one resolution the player did not choose (`ENGINE.md` §6.1).
   *
   * | Frame | Resolution | Money |
   * | --- | --- | --- |
   * | a branch has resolved — `BANK` is legal | `AUTO_BANK`, the same BANK the player could have sent | credits the claim |
   * | nothing has resolved — `BANK` is illegal | `VOID` | refunds the route stake whole, credits nothing |
   *
   * Never a forced run, in either row. A route the player *had already committed*
   * is resolved first: that is not a forced run, it is the completion of an
   * action they took and whose money is already at risk.
   *
   * **This is an operator path, not a player action.** A player who could call it
   * would hold a zero-risk exit from arena 1 — a full refund on demand — and the
   * action set in state `(1, n)` has no such element (`MATH.md` §5.3). So it
   * refuses until the round is actually past the operator's window. `force` is
   * reachable only from the dev endpoint, which only exists when the process was
   * started with `--dev-clock`.
   */
  async expire(roundId: unknown, options: { readonly force?: boolean } = {}): Promise<unknown> {
    const round = this.get(roundId);
    if (round.phase === 'SETTLED' || round.phase === 'VOID')
      throw new RoundError('ILLEGAL_ACTION', 'That round is already closed', 409);
    if (options.force !== true && !this.isExpired(round))
      throw new RoundError(
        'ILLEGAL_ACTION',
        'This round is not past its expiry window. A round waits as long as you need it to.',
        409,
      );
    if (round.phase === 'PRECOMMIT') {
      round.phase = 'VOID';
      return { ok: true, resolution: 'VOID', refundedMicro: '0' };
    }
    if (round.phase === 'RUNNING') await this.#applyResolution(round);

    const book = round.book as SurvivalBook;
    if (book.stageRevision >= 1) {
      const live = [...book.live];
      let credited = 0n;
      if (live.length > 0) {
        const receipt = await book.bank(`${round.roundId}:expiry-bank`, live);
        credited = receipt.credited;
        round.routeCreditedMicro += credited;
        // The expiry bank is a credit like any other, so it is in the published
        // ledger like any other. Omitting it left `verifyBundle` unable to
        // reproduce the round's own total — the server failing its own check.
        round.creditEvents.push({
          kind: 'BANK',
          stage: book.stageRevision,
          entities: live,
          creditedMicro: credited.toString(),
        });
        this.wallet.credit(credited, 'Auto-bank at expiry', round.roundId);
        for (const slot of live) {
          const runner = round.runners.find((candidate) => candidate.slot === slot);
          if (runner) runner.status = 'home';
        }
      }
      // `AUTO_BANK` is the resolution only where BANK was a legal move. A frame
      // with nothing still running is not a decision point the player walked
      // away from — the round had already resolved and only needed closing, so
      // calling that an auto-bank would name an action that did not exist.
      const banked = live.length > 0;
      const settlement = await this.#settle(round, banked ? 'AUTO_BANK' : 'WIPE', credited);
      return {
        ok: true,
        resolution: banked ? 'AUTO_BANK' : 'AUTO_SETTLE',
        settlement: serialiseSettlement(settlement),
      };
    }

    // No branch has resolved. A void is not a settlement: the stake comes back
    // whole, nothing is credited, and it contributes no turnover.
    this.wallet.refund(round.stakeMicro, 'Void — round cancelled at expiry', round.roundId);
    round.phase = 'VOID';
    round.settlement = Object.freeze({
      kind: 'VOID',
      creditedMicro: 0n,
      totalCreditedMicro: 0n,
      routeStakeMicro: round.stakeMicro,
      sideBetStakeMicro: 0n,
      returnMultiple: '1.0000',
      revealedServerSeed: round.serverSeed,
      transcript: null,
      settledAtMs: this.clock.now(),
    });
    return {
      ok: true,
      resolution: 'VOID',
      refundedMicro: round.stakeMicro.toString(),
      note: 'A cancelled wager is a wager that did not happen: no turnover, no RTP figure.',
    };
  }

  /** Has this round sat past the operator's window (default 24 h)? */
  isExpired(round: Round): boolean {
    if (round.phase === 'SETTLED' || round.phase === 'VOID') return false;
    const idleSince = round.arenas.length > 0 ? round.earliestNextActionAtMs : round.createdAtMs;
    return this.clock.now() - idleSince >= this.expiryWindowMs;
  }

  /** Rounds past the operator's expiry window, closed the only way they may be. */
  async sweepExpired(): Promise<number> {
    let closed = 0;
    for (const round of this.all) {
      if (round.phase === 'SETTLED' || round.phase === 'VOID' || round.phase === 'PRECOMMIT') continue;
      if (this.isExpired(round)) {
        await this.expire(round.roundId);
        closed += 1;
      }
    }
    return closed;
  }

  // ---------------------------------------------------------------- guards

  #assertFrame(round: Round, body: CommandEnvelope): void {
    const book = round.book as SurvivalBook;
    if (body.expectedFrameRevision === undefined || body.expectedFrameRevision === null) return;
    if (
      typeof body.expectedFrameRevision !== 'number' ||
      !Number.isSafeInteger(body.expectedFrameRevision) ||
      body.expectedFrameRevision < 0
    )
      throw new RoundError(
        'INVALID_ARGUMENT',
        'A frame revision is a non-negative integer',
        400,
        '$.expectedFrameRevision',
      );
    if (body.expectedFrameRevision !== book.stageRevision)
      throw new RoundError(
        'STALE_FRAME',
        'The frame moved under that command',
        409,
        '$.expectedFrameRevision',
        { frameRevision: book.stageRevision },
      );
  }

  #assertCycle(round: Round): void {
    const now = this.clock.now();
    if (now < round.earliestNextActionAtMs)
      throw new RoundError(
        'TOO_SOON',
        'The minimum game cycle has not elapsed',
        429,
        undefined,
        {
          earliestNextActionAtMs: round.earliestNextActionAtMs,
          retryInMs: round.earliestNextActionAtMs - now,
          minGameCycleMs: MIN_GAME_CYCLE_MS,
        },
      );
  }

  #validateLaneOrder(
    round: Round,
    runningSlots: readonly number[],
    laneOrder: unknown,
  ): readonly string[] {
    if (
      !Array.isArray(laneOrder) ||
      laneOrder.length !== runningSlots.length ||
      !laneOrder.every((value) => typeof value === 'string')
    )
      throw new RoundError(
        'ILLEGAL_ACTION',
        'A lane order names every running Kindling exactly once',
        400,
        '$.laneOrder',
      );
    const names = runningSlots.map((slot) => slotName(round.runners, slot));
    const wanted = laneOrder as string[];
    const sorted = (list: readonly string[]) => [...list].sort();
    if (JSON.stringify(sorted(names)) !== JSON.stringify(sorted(wanted)))
      throw new RoundError(
        'ILLEGAL_ACTION',
        'A lane order names every running Kindling exactly once',
        400,
        '$.laneOrder',
      );
    return Object.freeze([...wanted]);
  }

  #reseat(round: Round, runningSlots: readonly number[], wanted: readonly string[]): void {
    runningSlots.forEach((slot, index) => {
      const runner = round.runners.find((candidate) => candidate.slot === slot);
      if (runner) runner.name = wanted[index] as string;
    });
  }

  #lanePreview(
    round: Round,
    runningSlots: readonly number[],
    route: RouteId,
    laneSplit: number | null,
  ) {
    const sizes = laneSizesFor(runningSlots.length, route === 'SPLIT' ? laneSplit : null);
    const lanes: { entities: { slot: number; name: string }[] }[] = [];
    let cursor = 0;
    for (const size of sizes) {
      lanes.push({ entities: named(round.runners, runningSlots.slice(cursor, cursor + size)) });
      cursor += size;
    }
    return lanes;
  }
}

// -------------------------------------------------------------- serialisation

export function serialiseArena(record: ArenaRecord) {
  return {
    ...record,
    shelterCreditedMicro: record.shelterCreditedMicro.toString(),
    claimBeforeMicro: record.claimBeforeMicro.toString(),
    claimRunningMicro: record.claimRunningMicro.toString(),
    claimAfterMicro: record.claimAfterMicro.toString(),
    sideBets: record.sideBets.map((ticket) => ({
      ...ticket,
      stakeMicro: ticket.stakeMicro.toString(),
      creditedMicro: ticket.creditedMicro.toString(),
    })),
  };
}

export function serialiseSettlement(settlement: Settlement) {
  return {
    ...settlement,
    creditedMicro: settlement.creditedMicro.toString(),
    totalCreditedMicro: settlement.totalCreditedMicro.toString(),
    routeStakeMicro: settlement.routeStakeMicro.toString(),
    sideBetStakeMicro: settlement.sideBetStakeMicro.toString(),
  };
}

/**
 * The published record, and the only thing that leaves the server.
 *
 * It carries a digest and never a draw before settlement, and after settlement it
 * carries the seed and the transcript — from which the whole tape, including the
 * branches the player did not take, is re-derivable by anyone.
 */
export function bundleFor(round: Round): VerificationBundle {
  if (!round.settlement?.revealedServerSeed || !round.transcript)
    throw new RoundError('ILLEGAL_ACTION', 'This round has not been settled', 409);
  return {
    schema: BUNDLE_SCHEMA,
    definition: {
      id: BRANCHFALL.id,
      version: BRANCHFALL.version,
      fingerprint: FINGERPRINT,
      moduleId: stagedSurvival.id,
      moduleVersion: stagedSurvival.version,
    },
    roundId: round.roundId,
    clientSeed: round.clientSeedText as string,
    clientEntropy: round.clientEntropy as string,
    preCommitment: round.preCommitment,
    preCommitmentPublishedAtMs: round.publishedAtMs,
    tapeDigest: round.tapeDigest as string,
    revealedServerSeed: round.settlement.revealedServerSeed,
    routeStakeMicro: round.stakeMicro.toString(),
    transcript: transcriptToWire(round.transcript),
    credits: [...round.creditEvents],
    totalCreditedMicro: (round.routeCreditedMicro + round.sideBetCreditedMicro).toString(),
  };
}

/**
 * The Ghost Line for a settled round.
 *
 * Only after the reveal — before it, the tape is what a client must never hold
 * (`ENGINE.md` §10.2). `DESIGN.md` §10.6 puts the rest of the limits on the
 * client: opt-in, off by default, out of the game flow, and unavailable for 60
 * seconds after a losing round.
 */
export function ghostFor(round: Round): readonly GhostRow[] {
  if (round.phase !== 'SETTLED' || !round.truth || !round.book) return [];
  return ghostLines(round.truth, round.book.choices, (slot) => slotName(round.runners, slot));
}

function parseMicro(raw: unknown, path: string): bigint {
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) return BigInt(raw);
  if (typeof raw !== 'string' || !/^[0-9]{1,19}$/u.test(raw))
    throw new RoundError('INVALID_ARGUMENT', 'Expected an integer of micro-credits', 400, path);
  return BigInt(raw);
}

function idempotencyKey(body: CommandEnvelope): string {
  const key = body.idempotencyKey;
  if (typeof key !== 'string' || key.length === 0 || key.length > 128)
    throw new RoundError('INVALID_ARGUMENT', 'Every money command carries an idempotency key', 400, '$.idempotencyKey');
  return key;
}

// -------------------------------------------------------------- the frame

/**
 * The whole client frame.
 *
 * Everything a player may see and nothing they may not: the digest, never the
 * tape; the pre-commitment, never the seed before settlement. `ENGINE.md` §9 is
 * the list, and the omissions here are the important part of this function.
 */
export function frameOf(round: Round, store: RoundStore) {
  const book = round.book;
  const live = round.liveSlots;
  const claim = round.claim;
  const perRunner = live.length > 0 ? rational(claim.numerator, claim.denominator * BigInt(live.length)) : rational(0n);
  const allowance = allowanceFor(round.stakeMicro, round.sideBetStakedMicro, live.length);
  const arenaIndex = Math.min(round.arena, ARENAS);

  const menu = live.length > 0
    ? menuFor(live.length).map((entry) => ({
        route: entry.route,
        title: ROUTE_TITLES[entry.route],
        laneSplits: entry.laneSplits,
        shelterSizes: entry.shelterSizes,
        figures:
          entry.route === 'SHELTER'
            ? entry.shelterSizes.map((size) => ({
                shelterSize: size,
                banksMicro: floor(
                  multiply(claim, rational(BigInt(size), BigInt(live.length))),
                ).toString(),
                figures: figuresFor('WIDE', live.length - size, null),
              }))
            : entry.laneSplits.map((split) => ({
                laneSplit: split,
                figures: figuresFor(entry.route as Exclude<RouteId, 'SHELTER'>, live.length, split),
              })),
      }))
    : [];

  return {
    roundId: round.roundId,
    phase: round.phase,
    arena: {
      index: arenaIndex,
      of: ARENAS,
      name: ARENA_NAMES[arenaIndex - 1] ?? '',
      subtitle: ARENA_SUBTITLES[arenaIndex - 1] ?? '',
    },
    frameRevision: book?.stageRevision ?? 0,
    ledgerRevision: book?.ledgerRevision ?? 0,
    stakeMicro: round.stakeMicro.toString(),
    entityStakeMicro: round.entityStakeMicro.toString(),
    claim: {
      micro: floor(claim).toString(),
      exact: fraction(inCredits(claim)),
      display: decimals(inCredits(claim), 3),
      perRunnerMicro: floor(perRunner).toString(),
      perRunnerExact: fraction(inCredits(perRunner)),
      perRunnerDisplay: decimals(inCredits(perRunner), 3),
    },
    squad: round.runners.map((runner) => {
      const held = book?.claims.find((candidate) => candidate.entity === runner.slot);
      return {
        slot: runner.slot,
        name: runner.name,
        status: runner.status,
        valueMicro: held ? floor(held.value).toString() : '0',
        valueExact: held ? fraction(inCredits(held.value)) : '0/1',
        valueDisplay: held ? decimals(inCredits(held.value), 3) : '0.000',
      };
    }),
    live: [...live],
    menu,
    bankable: round.phase === 'DECISION' && (book?.stageRevision ?? 0) >= 1 && live.length > 0,
    bankAmountMicro: floor(claim).toString(),
    sideBets: {
      offered: allowance.offered,
      perBetMicro: allowance.perBetMicro.toString(),
      perRoundMicro: allowance.perRoundMicro.toString(),
      remainingMicro: allowance.remainingMicro.toString(),
      minMicro: allowance.minMicro.toString(),
      stakedMicro: round.sideBetStakedMicro.toString(),
    },
    speed: {
      ...SPEED,
      earliestNextActionAtMs: round.earliestNextActionAtMs,
      serverNowMs: store.clock.now(),
    },
    fairness: {
      preCommitment: round.preCommitment,
      publishedAtMs: round.publishedAtMs,
      clientSeed: round.clientSeedText,
      clientEntropy: round.clientEntropy,
      clientEntropyIsSeed: round.clientSeedText === round.clientEntropy,
      tapeDigest: round.tapeDigest,
      definitionId: BRANCHFALL.id,
      definitionVersion: BRANCHFALL.version,
      fingerprint: FINGERPRINT,
      moduleId: stagedSurvival.id,
      moduleVersion: stagedSurvival.version,
      /** Revealed only at settlement. `null` is the security property, not a gap. */
      revealedServerSeed: round.settlement?.revealedServerSeed ?? null,
    },
    history: round.arenas.map(serialiseArena),
    settlement: round.settlement ? serialiseSettlement(round.settlement) : null,
    receipts: book
      ? (book.snapshot() as { receipts: { receipt: Record<string, unknown> }[] }).receipts.map(
          (entry) => entry.receipt,
        )
      : [],
    lastLossAtMs: round.lastLossAtMs,
  };
}

export { ENTRY_RETURN, geometryKey, laneBalances, type GeometryFigures };
