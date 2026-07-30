/**
 * The client's view of the server, and the client's view of money.
 *
 * Two rules hold everywhere in this file. Money is a `bigint` of micro-credits
 * until the instant it becomes a string for a label — never a `number`, because
 * `4_775_000 / 1_000_000` is a float and a float is how a displayed figure stops
 * being the credited figure (`DESIGN.md` §10.5). And nothing here computes a
 * probability, a multiplier or a claim: those arrive already exact from the
 * server, which reads them out of the engine.
 */
import type { Settlement } from './types.js';

export interface Wire {
  readonly [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T = Wire>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? { method }
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(path, init);
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new ApiError(
      String(payload.code ?? 'ERROR'),
      String(payload.message ?? 'Something went wrong'),
      payload,
    );
  return payload as T;
}

const MICRO = 1_000_000n;

/** Micro-credits to a credit string. Truncating, because a credit is floored. */
export function credits(micro: string | bigint, places = 2): string {
  const value = typeof micro === 'bigint' ? micro : BigInt(micro || '0');
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / MICRO;
  const fraction = (magnitude % MICRO).toString().padStart(6, '0').slice(0, places);
  const body = places === 0 ? `${whole}` : `${whole}.${fraction}`;
  return negative ? `-${body}` : body;
}

export function micro(value: string | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value || '0');
}

/**
 * Did this round end with nobody coming home?
 *
 * The only honest source for that is the settlement's own `kind`, and reading it
 * anywhere else is a defect this client shipped once. The engine's settle empties
 * the live set on *every* path — the finish line included — so
 * `frame.live.length === 0` is true of every settled round, and the client used
 * it to pick the screen: a player who ran all five arenas, brought three runners
 * home and was credited 6.85 was told *"No one made it back."* (round-2 review).
 *
 * `kind` is decided before the settle, from the live set as it stood
 * (`server/rounds.ts` `finish()`): `WIPE` when nothing was still running,
 * `FINISH` at the finish line, `BANK`/`AUTO_BANK` when the claim was taken.
 *
 * `liveBeforeSettle` is the fallback for a settled frame that carries no
 * settlement — which this server never sends, so it is a defence and not a path —
 * and it has to be read *before* the settle request, because that is the only
 * moment at which the live set still means "still out there".
 */
export function wasWipe(settlement: Settlement | null, liveBeforeSettle: number): boolean {
  return settlement === null ? liveBeforeSettle === 0 : settlement.kind === 'WIPE';
}

/** A fresh client seed, generated **on the device** (`ENGINE.md` §10.1, residual 1). */
export function newClientSeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isSeed(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

export function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
