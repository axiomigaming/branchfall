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
 * A loss, floored **away** from zero.
 *
 * `credits()` truncates the magnitude, which is player-safe on a credit — the
 * figure shown is never more than the figure paid. On a *negative* net the same
 * truncation runs the other way: a true net of `-10.045000` displayed as
 * `-10.04` understates the loss by a hundredth, which is the one direction a
 * responsible-play figure may not err in (round-2 review found exactly that in
 * the session strip). So the magnitude is rounded up when there is anything
 * below the last shown place, and the arithmetic stays in `bigint`.
 */
export function creditsSigned(value: string | bigint, places = 2): string {
  const amount = micro(value);
  if (amount >= 0n) return credits(amount, places);
  const magnitude = -amount;
  const unit = 10n ** BigInt(6 - places);
  const ceiled = ((magnitude + unit - 1n) / unit) * unit;
  return `-${credits(ceiled, places)}`;
}

/**
 * A server-rendered decimal string, re-rendered at fewer places, half-up.
 *
 * One precision ladder, held everywhere: probabilities at two places,
 * multipliers at three. The round-2 review found the same quantity printed as
 * `49.24%` on a route card and `49.2393% likely` in the side-bet sheet, and a
 * multiplier as `1.190x` on a card and `1.93950933x` in a worked example. The
 * server publishes both a long decimal and the exact fraction; the *card's*
 * rendering is round-half-up (`server/money.ts` `rounded`), so this reproduces
 * that rule rather than truncating — a card and a sheet that disagree in the
 * last digit disagree about the odds.
 *
 * It is string arithmetic on digits, deliberately: `Number.parseFloat` on a
 * published probability is how a displayed figure stops being the published one.
 */
export function places(decimal: string, count: number): string {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/u.exec(decimal.trim());
  if (!match) return decimal;
  const [, sign, whole, fractionPart = ''] = match;
  const digits = (fractionPart as string).padEnd(count + 1, '0');
  const kept = `${whole}${digits.slice(0, count)}`;
  const carry = Number(digits[count]) >= 5;
  const scaled = (BigInt(kept) + (carry ? 1n : 0n)).toString().padStart(count + 1, '0');
  const head = scaled.slice(0, scaled.length - count);
  const tail = scaled.slice(scaled.length - count);
  return count === 0 ? `${sign}${head}` : `${sign}${head}.${tail}`;
}

/** `49.2393%` -> `49.24%`, on the card's own rounding rule. */
export function pct(value: string): string {
  return `${places(value.replace('%', ''), 2)}%`;
}

/** `1.93950933` -> `1.940x`, the one multiplier format in the client. */
export function multiplier(value: string): string {
  return `${places(value.replace('x', ''), 3)}x`;
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
