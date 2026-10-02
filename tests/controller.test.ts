import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAD_IN_MS } from '../src/engine/config';
import { elapsedFor } from '../src/engine/curve';
import { crashPoint, derivedSeed } from '../src/engine/fairness';
import { payout } from '../src/engine/money';
import { DemoCrashServer, RoundError } from '../src/service/demoServer';
import type { Push, Reply, Request } from '../src/service/protocol';
import { ServiceError, type RoundService } from '../src/service/RoundService';

// The store persists settings through localStorage; give node a stand-in.
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
vi.stubGlobal('matchMedia', () => ({ matches: false }));
vi.stubGlobal('navigator', { userAgent: 'node', hardwareConcurrency: 8 });

const { Controller } = await import('../src/state/controller');
const { useStore } = await import('../src/state/store');

class Clock {
  t = 5_000_000;
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
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const n = this.timers[0];
      if (!n || n.at > end) break;
      this.timers.shift();
      this.t = n.at;
      n.fn();
    }
    this.t = end;
  }
}

/** RoundService over an in-process authority; same semantics as the worker transport. */
class LocalService implements RoundService {
  listeners = new Set<(p: Push) => void>();
  server: DemoCrashServer;
  constructor(
    readonly clock: Clock,
    master: string,
  ) {
    this.server = new DemoCrashServer(clock, (p) => this.listeners.forEach((l) => l(p)), master);
  }
  private call(req: Request): Promise<Reply> {
    try {
      return Promise.resolve(this.server.handle(req));
    } catch (e) {
      const err = e as RoundError;
      return Promise.reject(new ServiceError(err.code, err.message));
    }
  }
  async connect() {
    return ((await this.call({ kind: 'hello' })) as Extract<Reply, { kind: 'hello' }>).session;
  }
  async placeBet(stake: number, autoCashout: number | null) {
    const r = (await this.call({ kind: 'bet', stake, autoCashout })) as Extract<Reply, { kind: 'bet' }>;
    return { round: r.round, balance: r.balance };
  }
  async cashout(roundId: string) {
    const r = (await this.call({ kind: 'cashout', roundId })) as Extract<Reply, { kind: 'cashout' }>;
    return { settled: r.settled, balance: r.balance, nextCommitment: r.nextCommitment };
  }
  async setClientSeed(seed: string) {
    return ((await this.call({ kind: 'setClientSeed', clientSeed: seed })) as Extract<Reply, { kind: 'setClientSeed' }>).clientSeed;
  }
  async refill() {
    return ((await this.call({ kind: 'refill' })) as Extract<Reply, { kind: 'refill' }>).balance;
  }
  onPush(fn: (p: Push) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  serverNow() {
    return this.clock.now();
  }
}

function stubGame() {
  return {
    elapsed: () => null,
    onReveal: () => {},
    live: { mult: 1 },
    calls: [] as string[],
    toSetup() {
      this.calls.push('setup');
      return Promise.resolve();
    },
    toTitle() {
      this.calls.push('title');
    },
    lead() {
      this.calls.push('lead');
    },
    crash(m: number) {
      this.calls.push(`crash:${m}`);
    },
    cashout() {
      this.calls.push('cashout');
    },
  };
}
const audio = { unlock() {}, ui() {}, setScene() {}, outcome() {} };

async function setup(master: string, pred: (c: number) => boolean) {
  const clock = new Clock();
  const svc = new LocalService(clock, master);
  const game = stubGame();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctl = new Controller(svc, game as any, audio as any);
  await ctl.connect();
  const client = useStore.getState().clientSeed;
  // Burn rounds until the next one satisfies `pred`, so each test sees a known shape.
  for (let n = useStore.getState().nextNonce; !pred(crashPoint(derivedSeed(master, n), client, n)); n++) {
    await svc.placeBet(10, null);
    clock.advance(1e9);
  }
  const s = await svc.connect();
  useStore.getState().set({ phase: 'setup', balance: s.balance, stake: 1000, autoOn: false, nextNonce: s.nextNonce });
  const nonce = s.nextNonce;
  return { clock, svc, game, ctl, crash: crashPoint(derivedSeed(master, nonce), client, nonce) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('controller ↔ authority', () => {
  beforeEach(() => useStore.getState().set({ result: null, live: null, history: [] }));

  it('run → cash out: balance, phase and world agree; repeated clicks settle once', async () => {
    const { clock, ctl, game, crash } = await setup('c1', (c) => c > 180);
    const before = useStore.getState().balance;
    await ctl.run();
    expect(useStore.getState().phase).toBe('lead');
    expect(useStore.getState().balance).toBe(before - 1000);
    // Cash-out during the lead-in is ignored (the run has not started).
    await ctl.cashout();
    expect(useStore.getState().phase).toBe('lead');
    clock.advance(LEAD_IN_MS + elapsedFor(150));
    useStore.getState().set({ phase: 'running' });
    await Promise.all([ctl.cashout(), ctl.cashout(), ctl.cashout()]);
    await flush();
    const st = useStore.getState();
    expect(st.phase).toBe('result');
    expect(st.result?.won).toBe(true);
    expect(st.result?.round.cashoutMult).toBe(150);
    expect(st.balance).toBe(before - 1000 + payout(1000, 150));
    expect(game.calls.filter((c) => c === 'cashout')).toHaveLength(1);
    expect(crash).toBeGreaterThanOrEqual(150);
  });

  it('the way falls: push settles, a late cash-out changes nothing', async () => {
    const { clock, ctl, game, crash } = await setup('c2', (c) => c > 110 && c < 400);
    const before = useStore.getState().balance;
    await ctl.run();
    useStore.getState().set({ phase: 'running' });
    clock.advance(LEAD_IN_MS + elapsedFor(crash) + 1);
    await flush();
    expect(useStore.getState().phase).toBe('result');
    expect(useStore.getState().result?.won).toBe(false);
    expect(game.calls).toContain(`crash:${crash}`);
    await ctl.cashout();
    expect(useStore.getState().balance).toBe(before - 1000);
  });

  it('a click that loses the race to the fall reads as the fall, not an error', async () => {
    const { clock, ctl, crash } = await setup('c3', (c) => c > 110 && c < 400);
    await ctl.run();
    useStore.getState().set({ phase: 'running' });
    clock.t += LEAD_IN_MS + elapsedFor(crash + 5); // late, timers not yet fired
    await ctl.cashout();
    await flush();
    const st = useStore.getState();
    expect(st.phase).toBe('result');
    expect(st.result?.won).toBe(false);
    expect(st.toasts.some((t) => t.tone === 'warn')).toBe(false);
  });

  it('auto cash-out settles through the push with no click', async () => {
    const { clock, ctl } = await setup('c4', (c) => c >= 250);
    useStore.getState().set({ autoOn: true, auto: 250 });
    const before = useStore.getState().balance;
    await ctl.run();
    useStore.getState().set({ phase: 'running' });
    clock.advance(LEAD_IN_MS + elapsedFor(250));
    await flush();
    const st = useStore.getState();
    expect(st.result?.round.auto).toBe(true);
    expect(st.balance).toBe(before - 1000 + 2500);
  });

  it('refuses a stake above the balance without touching money', async () => {
    const { ctl } = await setup('c5', () => true);
    useStore.getState().set({ stake: 100_000, balance: 5_000 });
    await ctl.run();
    expect(useStore.getState().phase).toBe('setup');
    expect(useStore.getState().toasts.at(-1)?.tone).toBe('warn');
  });

  it('very small and very large stakes pay exactly', async () => {
    for (const stake of [10, 100_000]) {
      const { clock, ctl } = await setup(`c6-${stake}`, (c) => c > 300);
      await ctl.refill();
      useStore.getState().set({ stake, phase: 'setup', balance: 100_000 });
      const before = useStore.getState().balance;
      await ctl.run();
      useStore.getState().set({ phase: 'running' });
      clock.advance(LEAD_IN_MS + elapsedFor(237));
      await ctl.cashout();
      expect(useStore.getState().balance).toBe(before - stake + payout(stake, 237));
    }
  });

  it('a second press during the reset fade does not place a second bet', async () => {
    const { clock, ctl, svc, crash } = await setup('c7', (c) => c > 150);
    await ctl.run();
    useStore.getState().set({ phase: 'running' });
    clock.advance(LEAD_IN_MS + elapsedFor(120));
    await ctl.cashout();
    expect(useStore.getState().phase).toBe('result');
    const before = useStore.getState().balance;
    const historyBefore = (await svc.connect()).nextNonce;
    // Run again, pressed twice while the world fades back to the start.
    await Promise.all([ctl.run(), ctl.run()]);
    const s = await svc.connect();
    expect(s.nextNonce).toBe(historyBefore + 1);
    expect(useStore.getState().balance).toBe(before - 1000);
    expect(useStore.getState().phase).toBe('lead');
    expect(crash).toBeGreaterThan(150);
  });
});
