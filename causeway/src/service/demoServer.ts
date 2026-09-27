/**
 * DEMO round authority. It owns seeds, the balance and the clock; a client can
 * only ask. It runs in a Web Worker in the browser build, so the main thread
 * (renderer, UI) has no reference to a live round's seed or crash point.
 *
 * It is NOT a production backend: its balance is virtual, its state is not
 * durable, and a browser can always inspect its own worker. Server-authoritative
 * play needs this exact logic behind a network boundary — see README.
 */
import {
  LEAD_IN_MS,
  MAX_MULT,
  MAX_STAKE,
  MIN_AUTO_CASHOUT,
  MIN_STAKE,
  RTP_DEN,
  RTP_NUM,
} from '../engine/config';
import { elapsedFor, multiplierAt } from '../engine/curve';
import { commitmentOf, crashPoint, derivedSeed, randomSeedHex } from '../engine/fairness';
import { payout, type Cents } from '../engine/money';
import type {
  DemoRestore,
  ErrorCode,
  LiveRound,
  Push,
  Reply,
  Request,
  Session,
  SettledRound,
} from './protocol';

export const DEMO_OPENING_BALANCE: Cents = 100_000; // 1,000.00 demo credits
const HISTORY_LIMIT = 60;

export class RoundError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ServerClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

interface Live {
  pub: LiveRound;
  serverSeed: string;
  crash: number;
  crashTimer: unknown;
  autoTimer: unknown;
}

export class DemoCrashServer {
  private balance: Cents = DEMO_OPENING_BALANCE;
  private clientSeed: string;
  private nonce = 0;
  private nextServerSeed: string;
  private history: SettledRound[] = [];
  private live: Live | null = null;

  constructor(
    private readonly clock: ServerClock,
    private readonly push: (p: Push) => void,
    /** Master seed for reproducible sessions (tests, QA). Absent in normal play. */
    private readonly masterSeed: string | null = null,
  ) {
    this.clientSeed = masterSeed ? `qa-${masterSeed}` : randomSeedHex(8);
    this.nextServerSeed = this.seedFor(this.nonce);
  }

  private seedFor(nonce: number): string {
    return this.masterSeed ? derivedSeed(this.masterSeed, nonce) : randomSeedHex(32);
  }

  handle(req: Request): Reply {
    switch (req.kind) {
      case 'hello':
        if (req.restore && !this.masterSeed) this.restore(req.restore);
        return { kind: 'hello', session: this.session() };
      case 'bet':
        return this.bet(req.stake, req.autoCashout);
      case 'cashout':
        return this.cashout(req.roundId);
      case 'setClientSeed':
        return this.setClientSeed(req.clientSeed);
      case 'refill':
        if (this.live) throw new RoundError('ROUND_IN_PROGRESS', 'Finish the run first.');
        this.balance = DEMO_OPENING_BALANCE;
        return { kind: 'refill', balance: this.balance };
    }
  }

  private restore(r: DemoRestore): void {
    if (Number.isSafeInteger(r.balance) && r.balance >= 0 && r.balance <= 1e12) this.balance = r.balance;
    if (typeof r.clientSeed === 'string' && validClientSeed(r.clientSeed)) this.clientSeed = r.clientSeed;
    if (Number.isSafeInteger(r.nextNonce) && r.nextNonce >= 0) this.nonce = r.nextNonce;
    if (Array.isArray(r.history)) this.history = r.history.slice(0, HISTORY_LIMIT);
    this.nextServerSeed = this.seedFor(this.nonce);
  }

  session(): Session {
    return {
      now: this.clock.now(),
      balance: this.balance,
      clientSeed: this.clientSeed,
      nextNonce: this.nonce,
      nextCommitment: commitmentOf(this.nextServerSeed),
      history: this.history.slice(),
      live: this.live ? { ...this.live.pub } : null,
      limits: {
        minStake: MIN_STAKE,
        maxStake: MAX_STAKE,
        minAutoCashout: MIN_AUTO_CASHOUT,
        maxMult: MAX_MULT,
        rtpPercent: Number((RTP_NUM * 10000n) / RTP_DEN) / 100,
        leadInMs: LEAD_IN_MS,
      },
      demo: true,
      deterministic: this.masterSeed !== null,
    };
  }

  private bet(stake: Cents, autoCashout: number | null): Reply {
    if (this.live) throw new RoundError('ROUND_IN_PROGRESS', 'A run is already under way.');
    if (!Number.isSafeInteger(stake) || stake < MIN_STAKE || stake > MAX_STAKE)
      throw new RoundError('BAD_STAKE', 'Stake is outside the table limits.');
    if (autoCashout !== null && (!Number.isSafeInteger(autoCashout) || autoCashout < MIN_AUTO_CASHOUT || autoCashout > MAX_MULT))
      throw new RoundError('BAD_AUTO_CASHOUT', 'Auto cash-out is outside the allowed range.');
    if (stake > this.balance) throw new RoundError('INSUFFICIENT_FUNDS', 'Not enough demo credits.');

    const serverSeed = this.nextServerSeed;
    const nonce = this.nonce;
    const crash = crashPoint(serverSeed, this.clientSeed, nonce);
    const now = this.clock.now();
    this.balance -= stake;
    const pub: LiveRound = {
      id: `r${nonce.toString(36)}-${commitmentOf(serverSeed).slice(0, 8)}`,
      nonce,
      commitment: commitmentOf(serverSeed),
      clientSeed: this.clientSeed,
      stake,
      autoCashout,
      runStartsAt: now + LEAD_IN_MS,
    };
    const live: Live = { pub, serverSeed, crash, crashTimer: null, autoTimer: null };
    this.live = live;
    this.nonce += 1;
    this.nextServerSeed = this.seedFor(this.nonce);

    // A round that reaches the end of the causeway pays everyone still running at MAX.
    const ends = crash >= MAX_MULT;
    const endAt = pub.runStartsAt + elapsedFor(crash);
    if (autoCashout !== null && autoCashout <= crash) {
      live.autoTimer = this.clock.setTimer(() => this.settle('cashout', autoCashout, true), pub.runStartsAt + elapsedFor(autoCashout) - now);
    } else if (ends) {
      live.autoTimer = this.clock.setTimer(() => this.settle('cashout', MAX_MULT, true), endAt - now);
    } else {
      live.crashTimer = this.clock.setTimer(() => this.settle('crash', null, false), endAt - now);
    }
    return { kind: 'bet', round: { ...pub }, balance: this.balance, now };
  }

  private cashout(roundId: string): Reply {
    const live = this.live;
    if (!live || live.pub.id !== roundId) {
      const done = this.history.find((h) => h.id === roundId);
      if (done) throw new RoundError('ALREADY_SETTLED', done.outcome === 'crash' ? 'The way had already fallen.' : 'Already cashed out.');
      throw new RoundError('NO_LIVE_ROUND', 'No run in progress.');
    }
    const now = this.clock.now();
    if (now < live.pub.runStartsAt) throw new RoundError('NOT_STARTED', 'The run has not started yet.');
    const m = multiplierAt(now - live.pub.runStartsAt);
    if (m > live.crash) {
      // The crash timer is due; the request lost the race. Settle as the crash it is.
      const settled = this.settle('crash', null, false);
      throw new RoundError('ALREADY_SETTLED', `The way fell at ${settled.crash / 100}x.`);
    }
    if (live.pub.autoCashout !== null && m >= live.pub.autoCashout) {
      const s = this.settle('cashout', live.pub.autoCashout, true);
      return { kind: 'cashout', settled: s, balance: this.balance, nextCommitment: commitmentOf(this.nextServerSeed), now };
    }
    const s = this.settle('cashout', m, false, false);
    return { kind: 'cashout', settled: s, balance: this.balance, nextCommitment: commitmentOf(this.nextServerSeed), now };
  }

  private settle(outcome: 'cashout' | 'crash', mult: number | null, auto: boolean, emit = true): SettledRound {
    const live = this.live!;
    this.clock.clearTimer(live.crashTimer);
    this.clock.clearTimer(live.autoTimer);
    this.live = null;
    const won = outcome === 'cashout' ? payout(live.pub.stake, mult!) : 0;
    this.balance += won;
    const settled: SettledRound = {
      id: live.pub.id,
      nonce: live.pub.nonce,
      outcome,
      stake: live.pub.stake,
      cashoutMult: outcome === 'cashout' ? mult : null,
      auto,
      payout: won,
      crash: live.crash,
      commitment: live.pub.commitment,
      serverSeed: live.serverSeed,
      clientSeed: live.pub.clientSeed,
      settledAt: this.clock.now(),
    };
    this.history.unshift(settled);
    if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
    if (emit)
      this.push({
        kind: 'settled',
        settled,
        balance: this.balance,
        nextCommitment: commitmentOf(this.nextServerSeed),
        nextNonce: this.nonce,
        now: this.clock.now(),
      });
    return settled;
  }

  private setClientSeed(seed: string): Reply {
    if (this.live) throw new RoundError('ROUND_IN_PROGRESS', 'Change seeds between runs.');
    if (!validClientSeed(seed)) throw new RoundError('BAD_CLIENT_SEED', 'Use 1–64 letters, digits, - or _.');
    this.clientSeed = seed;
    return { kind: 'setClientSeed', clientSeed: seed };
  }
}

export function validClientSeed(s: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(s);
}
