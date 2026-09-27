/**
 * The only door between the game and money. The UI and renderer depend on this
 * interface; the demo adapter implements it over a Web Worker, and a production
 * adapter would implement it over a WebSocket to the operator's RGS/wallet.
 */
import type { Cents } from '../engine/money';
import type { ErrorCode, LiveRound, Push, Session, SettledRound } from './protocol';

export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface RoundService {
  connect(): Promise<Session>;
  placeBet(stake: Cents, autoCashout: number | null): Promise<{ round: LiveRound; balance: Cents }>;
  cashout(roundId: string): Promise<{ settled: SettledRound; balance: Cents; nextCommitment: string }>;
  setClientSeed(seed: string): Promise<string>;
  refill(): Promise<Cents>;
  onPush(fn: (p: Push) => void): () => void;
  /** Server clock estimate in ms. Every round timestamp is on this clock. */
  serverNow(): number;
}
