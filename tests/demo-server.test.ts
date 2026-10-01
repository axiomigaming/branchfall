import { describe, expect, it } from 'vitest';
import { LEAD_IN_MS } from '../src/engine/config';
import { elapsedFor } from '../src/engine/curve';
import { crashPoint, derivedSeed, verifyRound } from '../src/engine/fairness';
import { payout } from '../src/engine/money';
import { DEMO_OPENING_BALANCE, DemoCrashServer, RoundError } from '../src/service/demoServer';
import type { Push, Reply } from '../src/service/protocol';

class FakeClock {
  t = 1_000_000;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  now = () => this.t;
  setTimer = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.push({ at: this.t + Math.max(0, ms), fn, id });
    return id;
  };
  clearTimer = (h: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== h);
  };
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

function setup(master = 'qa') {
  const clock = new FakeClock();
  const pushes: Push[] = [];
  const server = new DemoCrashServer(clock, (p) => pushes.push(p), master);
  return { clock, pushes, server };
}

function bet(server: DemoCrashServer, stake: number, auto: number | null = null) {
  const r = server.handle({ kind: 'bet', stake, autoCashout: auto }) as Extract<Reply, { kind: 'bet' }>;
  return r;
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof RoundError ? e.code : 'THREW';
  }
  return undefined;
}

/** Find the first nonce whose crash point satisfies `pred` for this QA master seed. */
function nonceWhere(master: string, clientSeed: string, pred: (c: number) => boolean) {
  for (let n = 0; n < 5000; n++) if (pred(crashPoint(derivedSeed(master, n), clientSeed, n))) return n;
  throw new Error('none');
}

describe('demo round authority', () => {
  it('debits on bet, credits floor(stake·m) on cashout, and reveals a verifiable seed', () => {
    const { clock, server } = setup();
    const s0 = (server.handle({ kind: 'hello' }) as Extract<Reply, { kind: 'hello' }>).session;
    expect(s0.balance).toBe(DEMO_OPENING_BALANCE);
    // Skip ahead to a round that survives past 1.50x.
    const n = nonceWhere('qa', s0.clientSeed, (c) => c > 150);
    for (let i = 0; i < n; i++) {
      bet(server, 10);
      clock.advance(LEAD_IN_MS + 10_000_000);
    }
    const before = (server.handle({ kind: 'hello' }) as Extract<Reply, { kind: 'hello' }>).session;
    const r = bet(server, 1000);
    expect(r.balance).toBe(before.balance - 1000);
    expect(r.round.commitment).toBe(before.nextCommitment);
    clock.advance(LEAD_IN_MS + elapsedFor(150));
    const c = server.handle({ kind: 'cashout', roundId: r.round.id }) as Extract<Reply, { kind: 'cashout' }>;
    expect(c.settled.outcome).toBe('cashout');
    expect(c.settled.cashoutMult).toBe(150);
    expect(c.balance).toBe(before.balance - 1000 + payout(1000, 150));
    const v = verifyRound(c.settled, c.settled.crash);
    expect(v.ok).toBe(true);
    expect(c.settled.crash).toBeGreaterThanOrEqual(150);
  });

  it('refuses cashout before the run starts, after the crash, and twice', () => {
    const { clock, server, pushes } = setup('qa2');
    const hello = (server.handle({ kind: 'hello' }) as Extract<Reply, { kind: 'hello' }>).session;
    const n = nonceWhere('qa2', hello.clientSeed, (c) => c > 120 && c < 400);
    for (let i = 0; i < n; i++) {
      bet(server, 10);
      clock.advance(10_000_000);
    }
    const r = bet(server, 500);
    expect(code(() => server.handle({ kind: 'cashout', roundId: r.round.id }))).toBe('NOT_STARTED');
    expect(code(() => bet(server, 10))).toBe('ROUND_IN_PROGRESS');
    clock.advance(LEAD_IN_MS);
    // Immediately after the start: cashes at 1.00x and returns the stake exactly.
    const c = server.handle({ kind: 'cashout', roundId: r.round.id }) as Extract<Reply, { kind: 'cashout' }>;
    expect(c.settled.cashoutMult).toBe(100);
    expect(c.settled.payout).toBe(500);
    expect(code(() => server.handle({ kind: 'cashout', roundId: r.round.id }))).toBe('ALREADY_SETTLED');

    const r2 = bet(server, 500);
    const crash = crashPoint(derivedSeed('qa2', r2.round.nonce), hello.clientSeed, r2.round.nonce);
    clock.advance(LEAD_IN_MS + elapsedFor(crash) + 5);
    const last = pushes.at(-1)!;
    expect(last.settled.id).toBe(r2.round.id);
    expect(last.settled.outcome).toBe('crash');
    expect(last.settled.payout).toBe(0);
    expect(code(() => server.handle({ kind: 'cashout', roundId: r2.round.id }))).toBe('ALREADY_SETTLED');
  });

  it('a cashout that races the crash timer settles as the crash', () => {
    const { clock, server } = setup('race');
    const hello = (server.handle({ kind: 'hello' }) as Extract<Reply, { kind: 'hello' }>).session;
    const n = nonceWhere('race', hello.clientSeed, (c) => c > 130 && c < 300);
    for (let i = 0; i < n; i++) {
      bet(server, 10);
      clock.advance(10_000_000);
    }
    const r = bet(server, 1000);
    const crash = crashPoint(derivedSeed('race', r.round.nonce), hello.clientSeed, r.round.nonce);
    // Move the clock past the crash without firing timers (a late request).
    clock.t += LEAD_IN_MS + elapsedFor(crash + 1);
    expect(code(() => server.handle({ kind: 'cashout', roundId: r.round.id }))).toBe('ALREADY_SETTLED');
  });

  it('cashing out exactly at the crash multiplier wins', () => {
    const { clock, server } = setup('edge');
    const hello = (server.handle({ kind: 'hello' }) as Extract<Reply, { kind: 'hello' }>).session;
    const n = nonceWhere('edge', hello.clientSeed, (c) => c > 110 && c < 500);
    for (let i = 0; i < n; i++) {
      bet(server, 10);
      clock.advance(10_000_000);
    }
    const r = bet(server, 1000);
    const crash = crashPoint(derivedSeed('edge', r.round.nonce), hello.clientSeed, r.round.nonce);
    clock.t += LEAD_IN_MS + elapsedFor(crash);
    const c = server.handle({ kind: 'cashout', roundId: r.round.id }) as Extract<Reply, { kind: 'cashout' }>;
    expect(c.settled.cashoutMult).toBe(crash);
  });

  it('auto cash-out settles at the target, server-side, with no client involved', () => {
    const { clock, server, pushes } = setup('auto');
    const hello = (server.handle({ kind: 'hello' }) as Extract<Reply, { kind: 'hello' }>).session;
    const n = nonceWhere('auto', hello.clientSeed, (c) => c >= 200);
    for (let i = 0; i < n; i++) {
      bet(server, 10);
      clock.advance(10_000_000);
    }
    const r = bet(server, 1000, 200);
    clock.advance(LEAD_IN_MS + elapsedFor(200));
    const p = pushes.at(-1)!;
    expect(p.settled.id).toBe(r.round.id);
    expect(p.settled.auto).toBe(true);
    expect(p.settled.cashoutMult).toBe(200);
    expect(p.settled.payout).toBe(2000);
  });

  it('validates stakes, funds and seeds', () => {
    const { server } = setup('v');
    expect(code(() => bet(server, 5))).toBe('BAD_STAKE');
    expect(code(() => bet(server, 10.5))).toBe('BAD_STAKE');
    expect(code(() => bet(server, 200_000))).toBe('BAD_STAKE');
    expect(code(() => bet(server, 10, 100))).toBe('BAD_AUTO_CASHOUT');
    expect(code(() => server.handle({ kind: 'setClientSeed', clientSeed: 'bad seed!' }))).toBe('BAD_CLIENT_SEED');
    expect(code(() => server.handle({ kind: 'setClientSeed', clientSeed: 'mine_01' }))).toBeUndefined();
  });

  it('refuses a stake above the balance', () => {
    const { clock, server } = setup('funds');
    // Burn the balance on max bets that we never cash out.
    let guard = 0;
    for (;;) {
      const s = (server.handle({ kind: 'hello' }) as Extract<Reply, { kind: 'hello' }>).session;
      if (s.balance < 100_000) {
        expect(code(() => bet(server, 100_000))).toBe('INSUFFICIENT_FUNDS');
        break;
      }
      bet(server, 100_000);
      clock.advance(1e9);
      if (++guard > 50) throw new Error('never ran out');
    }
  });

  it('a seeded session is reproducible round for round', () => {
    const run = () => {
      const { clock, pushes, server } = setup('repro');
      for (let i = 0; i < 25; i++) {
        bet(server, 100);
        clock.advance(1e9);
      }
      return pushes.map((p) => [p.settled.crash, p.settled.commitment]);
    };
    expect(run()).toEqual(run());
  });
});
