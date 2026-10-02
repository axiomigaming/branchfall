import { multiplierAt } from '../engine/curve';
import { payout } from '../engine/money';
import type { AudioEngine } from '../audio/engine';
import { haptic, type Haptic } from '../audio/feedback';
import type { Game } from '../render/game';
import type { RoundService } from '../service/RoundService';
import { ServiceError } from '../service/RoundService';
import type { Push, SettledRound } from '../service/protocol';
import { useStore } from './store';

/**
 * The one place the round authority, the 3D world, the interface and the sound
 * meet. Money state only ever changes from a service reply or push; the world
 * and the UI present it. Nothing here waits for an animation.
 */
export class Controller {
  private settledIds = new Set<string>();

  constructor(
    readonly service: RoundService,
    readonly game: Game,
    readonly audio: AudioEngine,
  ) {
    game.elapsed = () => this.elapsedMs();
    // The result card waits for the fall or escape to play (presentation only; see State.revealed).
    game.onReveal = () => useStore.getState().set({ revealed: true });
    service.onPush((p) => this.onPush(p));
  }

  async connect(): Promise<void> {
    const s = await this.service.connect();
    const st = useStore.getState();
    if (s.notice) setTimeout(() => useStore.getState().toast(s.notice!), 1500);
    st.set({
      balance: s.balance,
      limits: s.limits,
      history: s.history,
      clientSeed: s.clientSeed,
      nextCommitment: s.nextCommitment,
      nextNonce: s.nextNonce,
      deterministic: s.deterministic,
      stake: Math.min(st.stake, Math.max(s.limits.minStake, s.balance || s.limits.minStake)),
    });
    for (const h of s.history) this.settledIds.add(h.id);
  }

  /** ms since the live run started, on the server's clock; null when no run is live. */
  elapsedMs(): number | null {
    const live = useStore.getState().live;
    if (!live) return null;
    return this.service.serverNow() - live.runStartsAt;
  }

  /** The multiplier a cash-out would ask for right now (integer hundredths). */
  currentMult(): number {
    const e = this.elapsedMs();
    return e === null || e < 0 ? 100 : multiplierAt(e);
  }

  currentReturn(): number {
    const live = useStore.getState().live;
    return live ? payout(live.stake, this.currentMult()) : 0;
  }

  enter(): void {
    this.audio.unlock();
    this.audio.ui('confirm');
    void this.toSetup();
  }

  async toSetup(): Promise<void> {
    const st = useStore.getState();
    st.set({ modal: null });
    await this.game.toSetup();
    useStore.getState().set({ phase: 'setup', result: null });
    this.audio.setScene('setup');
  }

  toTitle(): void {
    const st = useStore.getState();
    if (st.phase === 'running' || st.phase === 'lead' || st.phase === 'cashing' || st.phase === 'placing') return;
    st.set({ phase: 'title', modal: null, result: null });
    this.game.toTitle();
    this.audio.setScene('title');
  }

  /** Set for the whole of run(): a second press during the world's reset fade must not place a second bet. */
  private starting = false;

  async run(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    try {
      await this.startRun();
    } finally {
      this.starting = false;
    }
  }

  private async startRun(): Promise<void> {
    const st = useStore.getState();
    if (st.phase !== 'setup' && st.phase !== 'result') return;
    if (st.stake > st.balance) {
      st.toast('Not enough demo credits for that stake.', 'warn');
      this.audio.ui('deny');
      return;
    }
    this.audio.unlock();
    if (st.phase === 'result') await this.game.toSetup();
    useStore.getState().set({ phase: 'placing', result: null, modal: null });
    try {
      const { round, balance } = await this.service.placeBet(st.stake, st.autoOn ? st.auto : null);
      useStore.getState().set({ phase: 'lead', live: round, balance, nextNonce: round.nonce + 1 });
      this.game.lead();
      this.audio.setScene('lead');
      this.audio.ui('bet');
      this.buzz('bet');
      // Flip to "running" exactly at the server's start time.
      const wait = Math.max(0, round.runStartsAt - this.service.serverNow());
      setTimeout(() => {
        const s = useStore.getState();
        if (s.phase === 'lead' && s.live?.id === round.id) {
          s.set({ phase: 'running' });
          this.audio.setScene('run');
          this.buzz('go');
        }
      }, wait);
    } catch (e) {
      useStore.getState().set({ phase: 'setup' });
      this.fail(e);
    }
  }

  async cashout(): Promise<void> {
    const st = useStore.getState();
    if (st.phase !== 'running' || !st.live) return;
    st.set({ phase: 'cashing' });
    // Send first; the click and the buzz answer the press without delaying the request.
    const req = this.service.cashout(st.live.id);
    this.audio.ui('cashout');
    this.buzz('press');
    try {
      const r = await req;
      this.settle(r.settled, r.balance, r.nextCommitment, r.settled.nonce + 1);
    } catch (e) {
      // Lost the race to the fall (or already settled by auto cash-out): the push carries the truth.
      if (e instanceof ServiceError && e.code === 'ALREADY_SETTLED') return;
      if (useStore.getState().phase === 'cashing') useStore.getState().set({ phase: 'running' });
      this.fail(e);
    }
  }

  private onPush(p: Push): void {
    if (p.kind === 'settled') this.settle(p.settled, p.balance, p.nextCommitment, p.nextNonce);
  }

  private settle(round: SettledRound, balance: number, nextCommitment: string, nextNonce: number): void {
    if (this.settledIds.has(round.id)) return;
    this.settledIds.add(round.id);
    const st = useStore.getState();
    const won = round.outcome === 'cashout';
    st.set({
      phase: 'result',
      live: null,
      balance,
      nextCommitment,
      nextNonce,
      result: { round, won },
      revealed: false,
      history: [round, ...st.history.filter((h) => h.id !== round.id)].slice(0, 60),
    });
    // Size the stinger: the cash-out multiplier for an escape (never the fall point), the fall point for a fall.
    this.audio.outcome(won ? (round.cashoutMult ?? 100) : round.crash);
    if (won) {
      this.game.live.mult = (round.cashoutMult ?? 100) / 100;
      this.game.cashout(round.id);
      this.audio.setScene('escaped');
      this.buzz('cashout');
    } else {
      this.game.crash(round.crash, round.id);
      this.audio.setScene('fallen');
      this.buzz('crash');
    }
  }

  /** Haptic feedback on phones; follows the Haptics setting. Presentation only. */
  buzz(kind: Haptic): void {
    if (!useStore.getState().settings.haptics) return;
    haptic(kind);
  }

  async setClientSeed(seed: string): Promise<boolean> {
    try {
      const s = await this.service.setClientSeed(seed);
      useStore.getState().set({ clientSeed: s });
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  async refill(): Promise<void> {
    try {
      const b = await this.service.refill();
      useStore.getState().set({ balance: b });
      useStore.getState().toast('Demo balance restored to 1,000.00.');
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown): void {
    const msg = e instanceof ServiceError ? e.message : 'Something went wrong. Please try again.';
    useStore.getState().toast(msg, 'warn');
    this.audio.ui('deny');
    if (!(e instanceof ServiceError)) console.error(e);
  }
}
