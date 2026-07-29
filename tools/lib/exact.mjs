/**
 * Exact rational arithmetic over BigInt.
 *
 * BRANCHFALL never uses IEEE-754 floating point in any probability or money
 * path. Every probability, multiplier, claim value and RTP figure in this
 * repository is a reduced fraction of BigInts. Floating point appears in
 * exactly one place — `Frac#toNumber()` — which is documented as
 * presentation-only and is never consumed by a money decision.
 */

export class ExactError extends Error {
  /**
   * @param {string} code stable machine-readable code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'ExactError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ExactError(code, message);
}

/** @param {bigint} a @param {bigint} b @returns {bigint} */
export function gcdBig(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * A reduced rational number with a strictly positive denominator.
 * Instances are frozen; every operation returns a new instance.
 */
export class Frac {
  /**
   * @param {bigint} numerator
   * @param {bigint} [denominator]
   */
  constructor(numerator, denominator = 1n) {
    if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint') {
      fail('INVALID_RATIONAL', 'Frac parts must be BigInt');
    }
    if (denominator === 0n) fail('INVALID_RATIONAL', 'Frac denominator must be non-zero');
    let n = numerator;
    let d = denominator;
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcdBig(n, d) || 1n;
    /** @type {bigint} */
    this.n = n / g;
    /** @type {bigint} */
    this.d = d / g;
    Object.freeze(this);
  }

  static get ZERO() {
    return ZERO;
  }
  static get ONE() {
    return ONE;
  }

  /** @param {Frac} o */
  #other(o) {
    if (!(o instanceof Frac)) fail('INVALID_RATIONAL', 'Expected a Frac operand');
    return o;
  }

  /** @param {Frac} o @returns {Frac} */
  add(o) {
    this.#other(o);
    return new Frac(this.n * o.d + o.n * this.d, this.d * o.d);
  }

  /** @param {Frac} o @returns {Frac} */
  sub(o) {
    this.#other(o);
    return new Frac(this.n * o.d - o.n * this.d, this.d * o.d);
  }

  /** @param {Frac} o @returns {Frac} */
  mul(o) {
    this.#other(o);
    return new Frac(this.n * o.n, this.d * o.d);
  }

  /** @param {Frac} o @returns {Frac} */
  div(o) {
    this.#other(o);
    if (o.n === 0n) fail('INVALID_RATIONAL', 'Division by zero');
    return new Frac(this.n * o.d, this.d * o.n);
  }

  /** @param {number} e non-negative integer exponent @returns {Frac} */
  pow(e) {
    if (!Number.isSafeInteger(e) || e < 0) fail('INVALID_RATIONAL', 'Exponent must be a non-negative integer');
    return new Frac(this.n ** BigInt(e), this.d ** BigInt(e));
  }

  /** @returns {Frac} */
  neg() {
    return new Frac(-this.n, this.d);
  }

  /** @param {Frac} o @returns {-1|0|1} */
  cmp(o) {
    this.#other(o);
    const diff = this.n * o.d - o.n * this.d;
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  }

  /** @param {Frac} o */
  eq(o) {
    return this.cmp(o) === 0;
  }
  /** @param {Frac} o */
  lt(o) {
    return this.cmp(o) < 0;
  }
  /** @param {Frac} o */
  lte(o) {
    return this.cmp(o) <= 0;
  }
  /** @param {Frac} o */
  gt(o) {
    return this.cmp(o) > 0;
  }
  /** @param {Frac} o */
  gte(o) {
    return this.cmp(o) >= 0;
  }

  isZero() {
    return this.n === 0n;
  }
  isOne() {
    return this.n === this.d;
  }

  /** Truncation toward zero; the only rounding mode used for credits. @returns {bigint} */
  floor() {
    if (this.n < 0n) fail('INVALID_RATIONAL', 'floor() is defined for non-negative values only');
    return this.n / this.d;
  }

  /** Canonical `n/d` form. Always reduced, denominator positive. */
  toString() {
    return `${this.n}/${this.d}`;
  }

  /** Presentation only. Never feed this back into a money or probability path. */
  toNumber() {
    return Number(this.n) / Number(this.d);
  }
}

const ZERO = new Frac(0n, 1n);
const ONE = new Frac(1n, 1n);

/**
 * @param {bigint|number|string} n
 * @param {bigint|number|string} [d]
 * @returns {Frac}
 */
export function F(n, d = 1n) {
  return new Frac(BigInt(n), BigInt(d));
}

/** @param {number} n @param {number} k @returns {bigint} */
export function binomial(n, k) {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(k) || n < 0 || k < 0) {
    fail('INVALID_ARGUMENT', 'binomial() requires non-negative integers');
  }
  if (k > n) return 0n;
  const kk = BigInt(Math.min(k, n - k));
  let result = 1n;
  for (let i = 0n; i < kk; i += 1n) {
    result = (result * (BigInt(n) - i)) / (i + 1n);
  }
  return result;
}

/** Exact integer square root (floor). @param {bigint} value @returns {bigint} */
export function isqrtBig(value) {
  if (typeof value !== 'bigint' || value < 0n) fail('INVALID_ARGUMENT', 'isqrtBig() requires a non-negative BigInt');
  if (value < 2n) return value;
  let x = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const next = (x + value / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}

/**
 * Deterministic fixed-point decimal rendering with round-half-up.
 * Used for human-readable columns; the exact fraction is always published beside it.
 * @param {Frac} f
 * @param {number} places
 * @returns {string}
 */
export function toFixedExact(f, places = 12) {
  if (!(f instanceof Frac)) fail('INVALID_ARGUMENT', 'toFixedExact() requires a Frac');
  if (!Number.isSafeInteger(places) || places < 0 || places > 60) {
    fail('INVALID_ARGUMENT', 'places must be an integer in [0, 60]');
  }
  const negative = f.n < 0n;
  const n = negative ? -f.n : f.n;
  const scale = 10n ** BigInt(places);
  const scaled = (n * scale) / f.d;
  const remainder = (n * scale) % f.d;
  const rounded = remainder * 2n >= f.d ? scaled + 1n : scaled;
  const text = rounded.toString().padStart(places + 1, '0');
  const whole = text.slice(0, text.length - places) || '0';
  const frac = places === 0 ? '' : `.${text.slice(text.length - places)}`;
  return `${negative ? '-' : ''}${whole}${frac}`;
}

/**
 * Square root of a non-negative Frac rendered as a fixed-point decimal.
 * Exact under the hood (integer sqrt of a scaled BigInt), truncated for display.
 * @param {Frac} f
 * @param {number} places
 * @returns {string}
 */
export function sqrtFixed(f, places = 6) {
  if (!(f instanceof Frac)) fail('INVALID_ARGUMENT', 'sqrtFixed() requires a Frac');
  if (f.n < 0n) fail('INVALID_ARGUMENT', 'sqrtFixed() requires a non-negative Frac');
  const scale = 10n ** BigInt(2 * places);
  const root = isqrtBig((f.n * scale) / f.d);
  return toFixedExact(new Frac(root, 10n ** BigInt(places)), places);
}
