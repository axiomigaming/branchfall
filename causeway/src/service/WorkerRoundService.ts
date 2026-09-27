import DemoWorker from './demo.worker.ts?worker';
import type { Cents } from '../engine/money';
import type { DemoRestore, Push, Reply, Request, RequestEnvelope, ServerEnvelope } from './protocol';
import { ServiceError, type RoundService } from './RoundService';

const STORE_KEY = 'causeway.demo.v1';

/** Client side of the demo adapter. Swappable for a WebSocket transport. */
export class WorkerRoundService implements RoundService {
  private worker: Worker;
  private seq = 1;
  private pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: unknown) => void; sentAt: number }>();
  private listeners = new Set<(p: Push) => void>();
  private offset = 0; // serverNow ≈ performance.now() + offset
  private bestRtt = Infinity;
  private deterministic: boolean;

  constructor(opts: { seed?: string | null } = {}) {
    const w = new DemoWorker({ name: opts.seed ? `causeway-demo:seed=${opts.seed}` : 'causeway-demo' });
    this.worker = w;
    this.deterministic = !!opts.seed;
    w.onmessage = (ev: MessageEvent<ServerEnvelope>) => this.receive(ev.data);
  }

  private receive(env: ServerEnvelope): void {
    if ('push' in env) {
      this.sync(env.push.now, 0);
      this.persistFromPush(env.push);
      for (const l of this.listeners) l(env.push);
      return;
    }
    const p = this.pending.get(env.id);
    if (!p) return;
    this.pending.delete(env.id);
    const rtt = performance.now() - p.sentAt;
    this.sync(env.now, rtt);
    if (env.ok) p.resolve(env.reply);
    else p.reject(new ServiceError(env.error, env.message));
  }

  private sync(serverNow: number, rtt: number): void {
    if (rtt <= this.bestRtt || this.bestRtt === Infinity) {
      this.bestRtt = Math.max(rtt, 0);
      this.offset = serverNow + rtt / 2 - performance.now();
    }
  }

  private send(req: Request): Promise<Reply> {
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, sentAt: performance.now() });
      const env: RequestEnvelope = { id, req };
      this.worker.postMessage(env);
    });
  }

  serverNow(): number {
    return performance.now() + this.offset;
  }

  async connect() {
    const restore = this.deterministic ? undefined : loadRestore();
    // The demo authority lives in this page: a reload loses a live run whose stake was already
    // taken. It cannot be settled honestly without its seed, so the demo refunds it.
    let notice: string | undefined;
    if (restore?.pending && Number.isSafeInteger(restore.pending.stake) && restore.pending.stake > 0) {
      restore.balance += restore.pending.stake;
      notice = 'Your interrupted demo run was refunded.';
    }
    if (restore) restore.pending = null;
    const r = await this.send(restore ? { kind: 'hello', restore } : { kind: 'hello' });
    if (r.kind !== 'hello') throw new Error('bad reply');
    this.cache = { balance: r.session.balance, clientSeed: r.session.clientSeed, nextNonce: r.session.nextNonce, history: r.session.history, pending: null };
    if (!this.deterministic && this.cache) saveRestore(this.cache);
    return notice ? { ...r.session, notice } : r.session;
  }

  async placeBet(stake: Cents, autoCashout: number | null) {
    const r = await this.send({ kind: 'bet', stake, autoCashout });
    if (r.kind !== 'bet') throw new Error('bad reply');
    this.patch({ balance: r.balance, nextNonce: r.round.nonce + 1, pending: { id: r.round.id, stake: r.round.stake } });
    return { round: r.round, balance: r.balance };
  }

  async cashout(roundId: string) {
    const r = await this.send({ kind: 'cashout', roundId });
    if (r.kind !== 'cashout') throw new Error('bad reply');
    this.patch({ balance: r.balance, pending: null, history: [r.settled, ...(this.cache?.history ?? []).filter((h) => h.id !== r.settled.id)].slice(0, 60) });
    return { settled: r.settled, balance: r.balance, nextCommitment: r.nextCommitment };
  }

  async setClientSeed(seed: string) {
    const r = await this.send({ kind: 'setClientSeed', clientSeed: seed });
    if (r.kind !== 'setClientSeed') throw new Error('bad reply');
    this.patch({ clientSeed: r.clientSeed });
    return r.clientSeed;
  }

  async refill() {
    const r = await this.send({ kind: 'refill' });
    if (r.kind !== 'refill') throw new Error('bad reply');
    this.patch({ balance: r.balance });
    return r.balance;
  }

  onPush(fn: (p: Push) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---- demo-only persistence (virtual credits survive a reload) ----
  private cache: DemoRestore | null = null;
  private patch(p: Partial<DemoRestore>) {
    if (!this.cache) return;
    Object.assign(this.cache, p);
    if (!this.deterministic) saveRestore(this.cache);
  }
  private persistFromPush(p: Push) {
    this.patch({
      balance: p.balance,
      nextNonce: p.nextNonce,
      pending: null,
      history: [p.settled, ...(this.cache?.history ?? []).filter((h) => h.id !== p.settled.id)].slice(0, 60),
    });
  }
}

function loadRestore(): DemoRestore | undefined {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as DemoRestore) : undefined;
  } catch {
    return undefined;
  }
}
function saveRestore(r: DemoRestore) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(r));
  } catch {
    /* private mode: the demo simply starts fresh next time */
  }
}
