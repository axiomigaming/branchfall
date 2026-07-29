/**
 * Money and probability rendering. Exact in, exact out.
 *
 * Every function here takes BigInt or `Rational` and produces a **string**. No
 * value in this file is ever converted to a `number` on the way to a decimal:
 * a float in a money path is the defect `docs/ENGINE.md` §10's last row is about,
 * and a display helper is exactly where one gets in. Decimals are produced by
 * BigInt division with an explicit truncation, so the digits shown are the digits
 * the model holds.
 */
import { compare, floor, multiply, rational, subtract, type Rational } from '@axiom-games/reveal-engine/core';
import { MICRO_PER_CREDIT } from './definition.js';

const TEN = 10n;

function pow10(places: number): bigint {
  let value = 1n;
  for (let index = 0; index < places; index += 1) value *= TEN;
  return value;
}

/** Exact fixed-point rendering of a non-negative rational, truncated toward zero. */
export function decimals(value: Rational, places: number): string {
  const negative = compare(value, rational(0n)) < 0;
  const magnitude = negative ? subtract(rational(0n), value) : value;
  const scaled = floor(multiply(magnitude, rational(pow10(places))));
  const unit = pow10(places);
  const whole = scaled / unit;
  const fraction = scaled % unit;
  const body =
    places === 0 ? `${whole}` : `${whole}.${fraction.toString().padStart(places, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Fixed-point rendering with **round-half-up**, for display only.
 *
 * Money never uses this: a credit is floored, always, and rounding a credit up
 * by half a unit is inventing money. Probabilities and multipliers do, because
 * `tools/lib/exact.mjs` renders the published tables that way and a card that
 * disagrees with `docs/MATH.md` in its last digit is a card that disagrees with
 * `docs/MATH.md`.
 */
export function rounded(value: Rational, places: number): string {
  const negative = compare(value, rational(0n)) < 0;
  const magnitude = negative ? subtract(rational(0n), value) : value;
  const unit = pow10(places);
  const reduced = rational(magnitude.numerator, magnitude.denominator);
  const scaledNumerator = reduced.numerator * unit;
  const whole = scaledNumerator / reduced.denominator;
  const remainder = scaledNumerator % reduced.denominator;
  const carried = remainder * 2n >= reduced.denominator ? whole + 1n : whole;
  const integer = carried / unit;
  const fraction = carried % unit;
  const body = places === 0 ? `${integer}` : `${integer}.${fraction.toString().padStart(places, '0')}`;
  return negative ? `-${body}` : body;
}

/** `a/b`, reduced, as the fraction the model actually holds. */
export function fraction(value: Rational): string {
  const reduced = rational(value.numerator, value.denominator);
  return `${reduced.numerator}/${reduced.denominator}`;
}

/** A probability as a percentage string: `49.24%` at two places. */
export function percent(value: Rational, places = 2): string {
  return `${rounded(multiply(value, rational(100n)), places)}%`;
}

/** Micro-credits as credits. `4_775_000` -> `4.775000`. */
export function credits(micro: bigint, places = 6): string {
  return decimals(rational(micro, MICRO_PER_CREDIT), places);
}

/** Micro-credits as credits with trailing zeros trimmed, never below two places. */
export function creditsShort(micro: bigint): string {
  const full = credits(micro, 6);
  const trimmed = full.replace(/(\.\d\d[0-9]*?)0+$/u, '$1');
  return trimmed;
}

/** Whole credits to micro-credits, for presets and steppers. */
export function creditsToMicro(whole: number): bigint {
  return BigInt(Math.round(whole)) * MICRO_PER_CREDIT;
}

/** The wire form of an exact rational: both halves, plus a rendered decimal. */
export interface WireRationalView {
  readonly exact: string;
  readonly decimal: string;
}

export function view(value: Rational, places = 8): WireRationalView {
  return { exact: fraction(value), decimal: decimals(value, places) };
}

/**
 * The same view, rendered the way the published tables render.
 *
 * `docs/MATH.md`'s probability and multiplier columns are round-half-up
 * (`tools/lib/exact.mjs`), so a card that truncated would print
 * `12.08967032` where the paytable prints `12.08967033`. Money keeps `view()`:
 * a claim is never rounded up, not even in a label.
 */
export function viewRounded(value: Rational, places = 8): WireRationalView {
  return { exact: fraction(value), decimal: rounded(value, places) };
}
