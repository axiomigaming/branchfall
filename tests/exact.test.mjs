import { describe, expect, it } from 'vitest';
import { ExactError, F, Frac, binomial, gcdBig, isqrtBig, sqrtFixed, toFixedExact } from '../tools/lib/exact.mjs';

describe('Frac — exact rational arithmetic', () => {
  it('reduces on construction and normalises sign to the numerator', () => {
    expect(new Frac(6n, 4n).toString()).toBe('3/2');
    expect(new Frac(-6n, 4n).toString()).toBe('-3/2');
    expect(new Frac(6n, -4n).toString()).toBe('-3/2');
    expect(new Frac(0n, 7n).toString()).toBe('0/1');
  });

  it('is frozen', () => {
    const f = F(3n, 4n);
    expect(Object.isFrozen(f)).toBe(true);
    expect(() => {
      'use strict';
      f.n = 9n;
    }).toThrow();
  });

  it('adds, subtracts, multiplies and divides exactly', () => {
    expect(F(1n, 3n).add(F(1n, 6n)).toString()).toBe('1/2');
    expect(F(1n, 3n).sub(F(1n, 6n)).toString()).toBe('1/6');
    expect(F(2n, 3n).mul(F(3n, 4n)).toString()).toBe('1/2');
    expect(F(2n, 3n).div(F(4n, 9n)).toString()).toBe('3/2');
  });

  it('holds exactness where floating point fails', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754. It is exact here.
    expect(F(1n, 10n).add(F(2n, 10n)).eq(F(3n, 10n))).toBe(true);
    // A thousand tenths sum to exactly 100.
    let sum = Frac.ZERO;
    for (let i = 0; i < 1000; i += 1) sum = sum.add(F(1n, 10n));
    expect(sum.toString()).toBe('100/1');
  });

  it('compares without loss', () => {
    const a = F(10n ** 40n + 1n, 10n ** 40n);
    expect(a.gt(Frac.ONE)).toBe(true);
    expect(a.toNumber()).toBe(1); // the float view cannot see the difference
  });

  it('powers, floors and detects unity', () => {
    expect(F(2n, 3n).pow(0).toString()).toBe('1/1');
    expect(F(2n, 3n).pow(5).toString()).toBe('32/243');
    expect(F(7n, 2n).floor()).toBe(3n);
    expect(F(6n, 3n).toString()).toBe('2/1');
    expect(F(3n, 3n).isOne()).toBe(true);
    expect(F(6n, 3n).isOne()).toBe(false);
  });

  describe('hostile input', () => {
    it('rejects a zero denominator', () => {
      expect(() => new Frac(1n, 0n)).toThrow(ExactError);
      expect(() => new Frac(1n, 0n)).toThrow(/denominator/i);
    });

    it('rejects non-BigInt parts, including Numbers that look fine', () => {
      expect(() => new Frac(1, 2)).toThrow(ExactError);
      expect(() => new Frac(1n, 2)).toThrow(ExactError);
      expect(() => new Frac(NaN, 1n)).toThrow(ExactError);
      expect(() => new Frac('1', '2')).toThrow(ExactError);
    });

    it('rejects non-Frac operands rather than coercing them', () => {
      expect(() => F(1n, 2n).add(0.5)).toThrow(ExactError);
      expect(() => F(1n, 2n).mul({ n: 1n, d: 2n })).toThrow(ExactError);
      expect(() => F(1n, 2n).cmp(null)).toThrow(ExactError);
    });

    it('rejects division by zero', () => {
      expect(() => F(1n, 2n).div(Frac.ZERO)).toThrow(/zero/i);
    });

    it('rejects negative and fractional exponents', () => {
      expect(() => F(1n, 2n).pow(-1)).toThrow(ExactError);
      expect(() => F(1n, 2n).pow(1.5)).toThrow(ExactError);
    });

    it('refuses to floor a negative value', () => {
      expect(() => F(-1n, 2n).floor()).toThrow(/non-negative/i);
    });

    it('rejects out-of-range formatting requests', () => {
      expect(() => toFixedExact(F(1n, 3n), -1)).toThrow(ExactError);
      expect(() => toFixedExact(F(1n, 3n), 61)).toThrow(ExactError);
      expect(() => toFixedExact(0.5, 4)).toThrow(ExactError);
      expect(() => sqrtFixed(F(-1n, 2n), 4)).toThrow(ExactError);
    });
  });
});

describe('helpers', () => {
  it('computes gcd on BigInts including negatives', () => {
    expect(gcdBig(12n, 18n)).toBe(6n);
    expect(gcdBig(-12n, 18n)).toBe(6n);
    expect(gcdBig(0n, 5n)).toBe(5n);
  });

  it('computes exact binomial coefficients', () => {
    expect(binomial(5, 0)).toBe(1n);
    expect(binomial(5, 2)).toBe(10n);
    expect(binomial(5, 5)).toBe(1n);
    expect(binomial(5, 6)).toBe(0n);
    expect(binomial(60, 30)).toBe(118264581564861424n);
    expect(() => binomial(-1, 0)).toThrow(ExactError);
  });

  it('computes exact integer square roots', () => {
    expect(isqrtBig(0n)).toBe(0n);
    expect(isqrtBig(1n)).toBe(1n);
    expect(isqrtBig(15n)).toBe(3n);
    expect(isqrtBig(16n)).toBe(4n);
    expect(isqrtBig((10n ** 30n) ** 2n)).toBe(10n ** 30n);
    expect(() => isqrtBig(-1n)).toThrow(ExactError);
  });

  it('renders fixed-point decimals deterministically with round-half-up', () => {
    expect(toFixedExact(F(1n, 3n), 6)).toBe('0.333333');
    expect(toFixedExact(F(2n, 3n), 6)).toBe('0.666667');
    expect(toFixedExact(F(1n, 2n), 0)).toBe('1');
    expect(toFixedExact(F(191n, 200n), 4)).toBe('0.9550');
    expect(toFixedExact(F(-1n, 3n), 3)).toBe('-0.333');
  });

  it('renders square roots as truncated fixed-point decimals', () => {
    expect(sqrtFixed(F(4n, 1n), 6)).toBe('2.000000');
    expect(sqrtFixed(F(2n, 1n), 6)).toBe('1.414213');
  });
});
