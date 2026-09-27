/**
 * The wire protocol between the game client and a round authority.
 *
 * The demo adapter speaks it over a Web Worker's message port; a production
 * adapter would speak the same messages over a WebSocket to an RGS. The client
 * never receives a crash point or a server seed for a round that is still live.
 */
import type { Cents } from '../engine/money';

export type Outcome = 'cashout' | 'crash';

export interface Limits {
  minStake: Cents;
  maxStake: Cents;
  minAutoCashout: number;
  maxMult: number;
  rtpPercent: number;
  leadInMs: number;
}

/** What the client may know about a live round. */
export interface LiveRound {
  id: string;
  nonce: number;
  commitment: string;
  clientSeed: string;
  stake: Cents;
  autoCashout: number | null;
  /** Server-clock ms at which the runner sets off and the multiplier starts to grow. */
  runStartsAt: number;
}

export interface SettledRound {
  id: string;
  nonce: number;
  outcome: Outcome;
  stake: Cents;
  /** The multiplier the player left at, or null if the way fell first. */
  cashoutMult: number | null;
  auto: boolean;
  payout: Cents;
  /** The round's crash point. Revealed only once the round is settled. */
  crash: number;
  commitment: string;
  serverSeed: string;
  clientSeed: string;
  settledAt: number;
}

export interface Session {
  now: number;
  balance: Cents;
  clientSeed: string;
  nextNonce: number;
  nextCommitment: string;
  history: SettledRound[];
  live: LiveRound | null;
  limits: Limits;
  demo: boolean;
  deterministic: boolean;
}

export type ErrorCode =
  | 'BAD_STAKE'
  | 'BAD_AUTO_CASHOUT'
  | 'INSUFFICIENT_FUNDS'
  | 'ROUND_IN_PROGRESS'
  | 'NO_LIVE_ROUND'
  | 'NOT_STARTED'
  | 'ALREADY_SETTLED'
  | 'BAD_CLIENT_SEED'
  | 'UNKNOWN';

export type Request =
  | { kind: 'hello'; restore?: DemoRestore }
  | { kind: 'bet'; stake: Cents; autoCashout: number | null }
  | { kind: 'cashout'; roundId: string }
  | { kind: 'setClientSeed'; clientSeed: string }
  | { kind: 'refill' };

export interface DemoRestore {
  balance: Cents;
  clientSeed: string;
  nextNonce: number;
  history: SettledRound[];
}

export type Reply =
  | { kind: 'hello'; session: Session }
  | { kind: 'bet'; round: LiveRound; balance: Cents; now: number }
  | { kind: 'cashout'; settled: SettledRound; balance: Cents; nextCommitment: string; now: number }
  | { kind: 'setClientSeed'; clientSeed: string }
  | { kind: 'refill'; balance: Cents };

export type Push = {
  kind: 'settled';
  settled: SettledRound;
  balance: Cents;
  nextCommitment: string;
  nextNonce: number;
  now: number;
};

export interface RequestEnvelope {
  id: number;
  req: Request;
}
export type ServerEnvelope =
  | { id: number; ok: true; reply: Reply; now: number }
  | { id: number; ok: false; error: ErrorCode; message: string; now: number }
  | { push: Push };
