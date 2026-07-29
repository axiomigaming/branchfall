/**
 * The free-play wallet.
 *
 * In memory, per process, no persistence, no real money — `README.md` says so on
 * its first badge and this file is where that is true. It is deliberately the
 * dumbest object in the server: it moves integers and refuses to go negative. The
 * engine's ledger, not this, is what makes a credit correct; the wallet only
 * records that it happened.
 *
 * Every amount is micro-credits as a `bigint`. There is no `number` in this file.
 */
export type WalletEntryKind = 'stake' | 'credit' | 'refund';

export interface WalletEntry {
  readonly at: number;
  readonly kind: WalletEntryKind;
  readonly label: string;
  readonly roundId: string | null;
  readonly amountMicro: bigint;
  readonly balanceAfterMicro: bigint;
}

export class InsufficientFunds extends Error {
  readonly code = 'INSUFFICIENT_FUNDS';
  constructor(readonly requiredMicro: bigint, readonly availableMicro: bigint) {
    super('Not enough free-play credits for that stake');
    this.name = 'InsufficientFunds';
  }
}

export class Wallet {
  #balance: bigint;
  #staked = 0n;
  #credited = 0n;
  #refunded = 0n;
  readonly #entries: WalletEntry[] = [];

  constructor(
    openingMicro: bigint,
    private readonly now: () => number,
  ) {
    this.#balance = openingMicro;
  }

  get balanceMicro(): bigint {
    return this.#balance;
  }

  /** Turnover. A VOID never reaches it: a cancelled wager is a wager that did not happen. */
  get stakedMicro(): bigint {
    return this.#staked;
  }

  get creditedMicro(): bigint {
    return this.#credited;
  }

  /** Session net position, always visible in the session strip (`DESIGN.md` §S0). */
  get netMicro(): bigint {
    return this.#credited - this.#staked;
  }

  get entries(): readonly WalletEntry[] {
    return Object.freeze([...this.#entries]);
  }

  #record(kind: WalletEntryKind, label: string, roundId: string | null, amount: bigint): void {
    this.#entries.push(
      Object.freeze({
        at: this.now(),
        kind,
        label,
        roundId,
        amountMicro: amount,
        balanceAfterMicro: this.#balance,
      }),
    );
  }

  debit(amountMicro: bigint, label: string, roundId: string | null): void {
    if (amountMicro <= 0n) throw new Error('A stake is positive');
    if (amountMicro > this.#balance) throw new InsufficientFunds(amountMicro, this.#balance);
    this.#balance -= amountMicro;
    this.#staked += amountMicro;
    this.#record('stake', label, roundId, amountMicro);
  }

  credit(amountMicro: bigint, label: string, roundId: string | null): void {
    if (amountMicro < 0n) throw new Error('A credit is non-negative');
    if (amountMicro === 0n) return;
    this.#balance += amountMicro;
    this.#credited += amountMicro;
    this.#record('credit', label, roundId, amountMicro);
  }

  /**
   * Returns a stake whole and unwinds its turnover.
   *
   * `DESIGN.md` §2.1: a VOID *"contributes no turnover, no bonus or
   * wagering-requirement progress, and no RTP figure. A round that pays back
   * 1.00x by not being played is not a 95.5% round and must never be counted as
   * one."* Booking a refund as a credit would count it as exactly that, so the
   * reversal moves `staked` back down instead.
   */
  refund(amountMicro: bigint, label: string, roundId: string | null): void {
    if (amountMicro <= 0n) throw new Error('A refund is positive');
    this.#balance += amountMicro;
    this.#staked -= amountMicro;
    this.#refunded += amountMicro;
    this.#record('refund', label, roundId, amountMicro);
  }

  get refundedMicro(): bigint {
    return this.#refunded;
  }
}
