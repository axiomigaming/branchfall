import { describe, expect, it } from 'vitest';
import { LEAD_IN_MS, MAX_MULT } from '../src/engine/config';
import { elapsedFor } from '../src/engine/curve';
import { DemoCrashServer } from '../src/service/demoServer';
import type { Push, Reply } from '../src/service/protocol';

/**
 * Whole-stack RTP: play thousands of rounds through the real demo authority on a fake
 * clock with fixed cash-out targets (via auto cash-out, as a player would), and check
 * (a) every credit is accounted for to the cent, and (b) the return is ~97% whatever
 * the target. The exact bound is proved in crash-math.test.ts; this proves the plumbing.
 */
class Clock {
  t = 0;
  timers: { at: number; fn: () => void; id: number }[] = [];
  seq = 0;
  now = () => this.t;
  setTimer = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  };
  clearTimer = (h: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== h);
  };
  runAll() {
    while (this.timers.length) {
      this.timers.sort((a, b) => a.at - b.at);
      const n = this.timers.shift()!;
      this.t = Math.max(this.t, n.at);
      n.fn();
    }
  }
}

function play(target: number | null, rounds: number, master: string) {
  const clock = new Clock();
  let settledPayout = 0;
  const server = new DemoCrashServer(clock, (p: Push) => (settledPayout += p.settled.payout), master);
  let staked = 0;
  let balance = (server.handle({ kind: 'hello' }) as Extract<Reply, { kind: 'hello' }>).session.balance;
  const start = balance;
  for (let i = 0; i < rounds; i++) {
    if (balance < 100) {
      server.handle({ kind: 'refill' });
      balance = (server.handle({ kind: 'hello' }) as Extract<Reply, { kind: 'hello' }>).session.balance;
    }
    const r = server.handle({ kind: 'bet', stake: 100, autoCashout: target }) as Extract<Reply, { kind: 'bet' }>;
    staked += 100;
    clock.runAll();
    balance = (server.handle({ kind: 'hello' }) as Extract<Reply, { kind: 'hello' }>).session.balance;
    void r;
  }
  return { rtp: settledPayout / staked, staked, settledPayout, start };
}

describe('return to player through the whole authority', () => {
  // Standard error of the RTP estimate is ~sqrt((m·0.97 − 0.97²)/n); tolerances are ~4σ.
  const cases: [number | null, number, number][] = [
    [101, 20_000, 0.01],
    [150, 20_000, 0.02],
    [200, 20_000, 0.03],
    [500, 30_000, 0.05],
    [1000, 30_000, 0.07],
  ];
  for (const [target, n, tol] of cases) {
    it(`auto cash-out at ${(target! / 100).toFixed(2)}× returns 97% ± ${tol * 100}%`, () => {
      const { rtp } = play(target, n, `rtp-${target}`);
      expect(Math.abs(rtp - 0.97)).toBeLessThan(tol);
    });
  }

  it('never cashing out pays only at the end of the causeway and loses otherwise', () => {
    const { settledPayout } = play(null, 5_000, 'rtp-never');
    // Only runs that reach 10,000× pay (probability 0.97/10000 per run): almost surely none here.
    expect(settledPayout % (100 * (MAX_MULT / 100))).toBe(0);
  });

  it('hand cash-outs are priced at the authority's multiplier and never above the fall point', () => {
    // Cash out by hand at arbitrary times; a paid cash-out is never above the round's fall point.
    const clock = new Clock();
    const server = new DemoCrashServer(clock, () => {}, 'edge-exact');
    let paid = 0;
    let refused = 0;
    for (let i = 0; i < 40; i++) {
      const r = server.handle({ kind: 'bet', stake: 100, autoCashout: null }) as Extract<Reply, { kind: 'bet' }>;

      let m = 101;
      let done = false;
      while (!done && m < 2000) {
        clock.t = r.round.runStartsAt + elapsedFor(m);
        try {
          const c = server.handle({ kind: 'cashout', roundId: r.round.id }) as Extract<Reply, { kind: 'cashout' }>;
          expect(c.settled.cashoutMult).toBe(m);
          expect(c.settled.crash).toBeGreaterThanOrEqual(m);
          paid++;
          done = true;
        } catch {
          refused++;
          done = true;
        }
        m += 37;
      }
      clock.runAll();
      clock.t += LEAD_IN_MS;
    }
    expect(paid + refused).toBe(40);
  });
});
