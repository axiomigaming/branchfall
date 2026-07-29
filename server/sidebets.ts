/**
 * Side bets: pricing, limits, settlement.
 *
 * The shipped `staged-survival` module has no side-bet surface, so this is the
 * one part of `docs/ENGINE.md` §3 that lives in the game server rather than in
 * the engine. What is *not* re-implemented here is anything the engine already
 * owns: the probability comes from the module's own `survivorDistribution()`
 * under the committed geometry, the price is `firstEntryRtp / P` from the
 * definition's declared `entryReturn`, the arithmetic is `Rational`, and the
 * credit is `payableWithinCap()` — the engine's own cap primitive, against this
 * ticket's own stake with a fresh accumulator, which is the per-ticket basis
 * `MATH.md` §9.1 proves.
 *
 * The two rules that make a side bet a bet rather than a receipt are structural
 * and live elsewhere: tickets are fields of the route command (`rounds.ts` accepts
 * them nowhere else), and the hazard tape never leaves the server. `ENGINE.md`
 * §10.2 measures what the second one is worth — a client holding the tape takes
 * realised return to 249%.
 */
import { compare, multiply, payableWithinCap, rational, type Rational } from '@axiom-games/reveal-engine/core';
import { MAX_WIN_MULTIPLE, MICRO_PER_CREDIT } from './definition.js';
import { fraction } from './money.js';
import {
  SIDE_BETS,
  SIDE_BET_MIN_RUNNERS,
  sideBetMultiplier,
  sideBetProbability,
  type SideBetId,
} from './paytable.js';

/** `docs/MATH.md` §5.5. Same floor as the route ticket. */
export const MIN_SIDE_BET_MICRO = MICRO_PER_CREDIT;
/** At most one ticket per event, three in total, per arena. */
export const MAX_TICKETS_PER_ARENA = SIDE_BETS.length;

export class SideBetError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = 'SideBetError';
  }
}

/** Half the route stake, per bet and per round (`MATH.md` §5.5). */
export function sideBetAllowanceMicro(routeStakeMicro: bigint): bigint {
  return routeStakeMicro / 2n;
}

export interface SideBetAllowance {
  readonly perBetMicro: bigint;
  readonly perRoundMicro: bigint;
  readonly remainingMicro: bigint;
  readonly minMicro: bigint;
  /**
   * `DESIGN.md` §4: the control is **hidden**, not disabled, once the remaining
   * allowance is under the minimum — *"a disabled control that can never
   * re-enable is worse than no control"*. A minimum-stake player never sees it.
   */
  readonly offered: boolean;
}

export function allowanceFor(
  routeStakeMicro: bigint,
  alreadyStakedMicro: bigint,
  running: number,
): SideBetAllowance {
  const perRound = sideBetAllowanceMicro(routeStakeMicro);
  const remaining = perRound > alreadyStakedMicro ? perRound - alreadyStakedMicro : 0n;
  return Object.freeze({
    perBetMicro: perRound,
    perRoundMicro: perRound,
    remainingMicro: remaining,
    minMicro: MIN_SIDE_BET_MICRO,
    offered: running >= SIDE_BET_MIN_RUNNERS && remaining >= MIN_SIDE_BET_MICRO,
  });
}

export interface TicketInput {
  readonly bet: string;
  readonly stakeMicro: string;
  /** The multiplier the card was showing. Recomputed; a disagreement is refused. */
  readonly quotedMultiplier?: string;
}

export interface PricedTicket {
  readonly bet: SideBetId;
  readonly stakeMicro: bigint;
  readonly probability: Rational;
  readonly multiplier: Rational;
}

export interface SettledTicket {
  readonly bet: SideBetId;
  readonly stakeMicro: bigint;
  readonly probabilityExact: string;
  readonly multiplierExact: string;
  readonly won: boolean;
  readonly creditedMicro: bigint;
  readonly capped: boolean;
}

function parseStake(raw: unknown, path: string): bigint {
  if (typeof raw !== 'string' || !/^[0-9]{1,19}$/u.test(raw))
    throw new SideBetError('INVALID_SIDE_BET', 'A side-bet stake is an integer of micro-credits', path);
  return BigInt(raw);
}

/**
 * Prices and bounds a whole arena's tickets, before a single micro-credit moves.
 *
 * Every limit in `MATH.md` §5.5 is enforced here — the per-ticket floor, the
 * per-bet ceiling, the round-wide ceiling, one ticket per event, the two-runner
 * minimum — and all of them before the debit, because they are load-bearing for
 * the cap proof and not a courtesy (`ENGINE.md` §6).
 */
export function priceTickets(
  input: readonly unknown[],
  distribution: readonly Rational[],
  routeStakeMicro: bigint,
  alreadyStakedMicro: bigint,
): readonly PricedTicket[] {
  if (input.length === 0) return Object.freeze([]);
  const running = distribution.length - 1;
  if (running < SIDE_BET_MIN_RUNNERS)
    throw new SideBetError(
      'INVALID_SIDE_BET',
      'Side bets need at least two runners on the branch',
      '$.sideBets',
    );
  if (input.length > MAX_TICKETS_PER_ARENA)
    throw new SideBetError('INVALID_SIDE_BET', 'At most three tickets in one arena', '$.sideBets');

  const allowance = allowanceFor(routeStakeMicro, alreadyStakedMicro, running);
  const seen = new Set<string>();
  let total = 0n;
  const priced: PricedTicket[] = [];

  input.forEach((rawTicket, index) => {
    const path = `$.sideBets[${index}]`;
    // Tickets cross the HTTP boundary as `unknown`. Arrays and `null` both have
    // object-like behaviour in JavaScript, but neither is a ticket; checking the
    // complete leaf shape here keeps every later property read on trusted data
    // and, more importantly, keeps a malformed ticket above the debit line.
    if (rawTicket === null || typeof rawTicket !== 'object' || Array.isArray(rawTicket))
      throw new SideBetError('INVALID_SIDE_BET', 'A side bet is a ticket object', path);
    const ticket = rawTicket as Partial<TicketInput>;
    if (typeof ticket.bet !== 'string')
      throw new SideBetError('INVALID_SIDE_BET', 'Unknown side bet', `${path}.bet`);
    if (typeof ticket.stakeMicro !== 'string')
      throw new SideBetError(
        'INVALID_SIDE_BET',
        'A side-bet stake is an integer of micro-credits',
        `${path}.stakeMicro`,
      );
    if (ticket.quotedMultiplier !== undefined && typeof ticket.quotedMultiplier !== 'string')
      throw new SideBetError(
        'INVALID_SIDE_BET',
        'A quoted multiplier is an exact rational string',
        `${path}.quotedMultiplier`,
      );
    const known = SIDE_BETS.find((candidate) => candidate.id === ticket.bet);
    if (!known) throw new SideBetError('INVALID_SIDE_BET', 'Unknown side bet', `${path}.bet`);
    if (seen.has(known.id))
      throw new SideBetError('INVALID_SIDE_BET', 'The same event cannot be staked twice', `${path}.bet`);
    seen.add(known.id);

    const stake = parseStake(ticket.stakeMicro, `${path}.stakeMicro`);
    if (stake < MIN_SIDE_BET_MICRO)
      throw new SideBetError('INVALID_SIDE_BET', 'A side bet is at least 1.00 credit', `${path}.stakeMicro`);
    if (stake > allowance.perBetMicro)
      throw new SideBetError(
        'INVALID_SIDE_BET',
        'A side bet may never carry more than half the route stake',
        `${path}.stakeMicro`,
      );
    total += stake;
    if (total > allowance.remainingMicro)
      throw new SideBetError(
        'INVALID_SIDE_BET',
        'That is past this round’s side-bet allowance',
        `${path}.stakeMicro`,
      );

    const probability = sideBetProbability(distribution, known.id);
    if (compare(probability, rational(0n)) === 0)
      throw new SideBetError('INVALID_SIDE_BET', 'That event cannot happen here', `${path}.bet`);
    const multiplier = sideBetMultiplier(probability);
    if (ticket.quotedMultiplier !== undefined && ticket.quotedMultiplier !== fraction(multiplier))
      throw new SideBetError(
        'QUOTE_MISMATCH',
        'The price on the card is not the price of this geometry',
        `${path}.quotedMultiplier`,
      );
    priced.push(Object.freeze({ bet: known.id, stakeMicro: stake, probability, multiplier }));
  });

  return Object.freeze(priced);
}

/** Did this event happen, on the survivor count of the group that actually ran? */
export function ticketWon(bet: SideBetId, survivors: number, running: number): boolean {
  switch (bet) {
    case 'CLEAN_SWEEP':
      return survivors === running;
    case 'SOLE_SURVIVOR':
      return survivors === 1;
    case 'LAST_LIGHT':
      return survivors === 0;
  }
}

/**
 * Settles one arena's tickets against the resolved survivor count.
 *
 * Each ticket is capped against **its own** stake with a fresh accumulator: one
 * credit event, one ceiling, no shared pot (`MATH.md` §9.1). The cap cannot bind —
 * the largest multiplier in the whole 42-row side-bet paytable is `97792/105`,
 * 931.35x — and CI proves that rather than this comment asserting it.
 */
export function settleTickets(
  tickets: readonly PricedTicket[],
  survivors: number,
  running: number,
): readonly SettledTicket[] {
  return Object.freeze(
    tickets.map((ticket) => {
      const won = ticketWon(ticket.bet, survivors, running);
      const theoretical = won
        ? multiply(ticket.multiplier, rational(ticket.stakeMicro))
        : rational(0n);
      const payable = payableWithinCap(theoretical, ticket.stakeMicro, MAX_WIN_MULTIPLE, 0n);
      return Object.freeze({
        bet: ticket.bet,
        stakeMicro: ticket.stakeMicro,
        probabilityExact: fraction(ticket.probability),
        multiplierExact: fraction(ticket.multiplier),
        won,
        creditedMicro: payable.credited,
        capped: payable.capped,
      });
    }),
  );
}
