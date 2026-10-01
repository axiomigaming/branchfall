import { describe, expect, it } from 'vitest';
import { MAX_MULT, MIN_MULT } from '../src/engine/config';
import { elapsedFor, multiplierAt } from '../src/engine/curve';
import { commitmentOf, crashFromDraw, crashPoint, derivedSeed, drawFromHash, roundHash, verifyRound } from '../src/engine/fairness';
import { formatCredits, formatMult, parseCredits, parseMult, payout } from '../src/engine/money';

const TWO52 = 1n << 52n;

/** Exact count of 52-bit draws whose crash point is ≥ m (hundredths). */
function survivors(m: number): bigint {
  // crash ≥ m  ⟺  floor(9700·2^52 / (100·u)) ≥ m  ⟺  u ≤ 97·2^52 / m, with u = 2^52 − h ∈ [1, 2^52].
  const bound = (97n * TWO52) / BigInt(m);
  return bound > TWO52 ? TWO52 : bound;
}

describe('crash distribution (exact)', () => {
  it('P(crash ≥ m) · m never exceeds the 97% RTP and misses it by < 1e-12', () => {
    for (const m of [101, 110, 150, 200, 237, 500, 1000, 2500, 10_000, 100_000, MAX_MULT]) {
      // Check the closed form against crashFromDraw at the boundary draw.
      const n = survivors(m);
      const hLowest = TWO52 - n; // the smallest draw that still survives to m
      expect(crashFromDraw(hLowest)).toBeGreaterThanOrEqual(m);
      if (hLowest > 0n) expect(crashFromDraw(hLowest - 1n)).toBeLessThan(m);
      const ev = (Number(n) / 2 ** 52) * (m / 100);
      expect(ev).toBeLessThanOrEqual(0.97 + 1e-15);
      expect(0.97 - ev).toBeLessThan(1e-12 * m);
    }
  });

  it('the instant-fall rate is 1 − 0.97/1.01', () => {
    const p = 1 - Number(survivors(101)) / 2 ** 52;
    expect(p).toBeCloseTo(1 - 0.97 / 1.01, 12);
  });

  it('clamps to [1.00x, 10,000x]', () => {
    expect(crashFromDraw(0n)).toBe(MIN_MULT);
    expect(crashFromDraw(TWO52 - 1n)).toBe(MAX_MULT);
    expect(() => crashFromDraw(TWO52)).toThrow();
    expect(() => crashFromDraw(-1n)).toThrow();
  });

  it('Monte Carlo agrees with the closed form', () => {
    const N = 40_000;
    let ge2 = 0;
    let ge10 = 0;
    for (let i = 0; i < N; i++) {
      const c = crashPoint(derivedSeed('mc', i), 'client', i);
      if (c >= 200) ge2++;
      if (c >= 1000) ge10++;
    }
    expect(ge2 / N).toBeGreaterThan(0.485 - 0.012);
    expect(ge2 / N).toBeLessThan(0.485 + 0.012);
    expect(ge10 / N).toBeGreaterThan(0.097 - 0.007);
    expect(ge10 / N).toBeLessThan(0.097 + 0.007);
  });
});

describe('fairness', () => {
  const seed = derivedSeed('fixture', 0);
  it('is deterministic and matches a frozen vector', () => {
    const a = crashPoint(seed, 'lantern', 7);
    expect(crashPoint(seed, 'lantern', 7)).toBe(a);
    expect(roundHash(seed, 'lantern', 7)).toMatch(/^[0-9a-f]{64}$/);
    expect(drawFromHash('fffffffffffff000')).toBe(TWO52 - 1n);
    // Frozen: if this changes, every published round becomes unverifiable.
    expect(commitmentOf('00'.repeat(32))).toBe('66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925');
  });
  it('verifies an honest round and rejects a forged one', () => {
    const commitment = commitmentOf(seed);
    const crash = crashPoint(seed, 'c', 1);
    expect(verifyRound({ serverSeed: seed, commitment, clientSeed: 'c', nonce: 1 }, crash).ok).toBe(true);
    expect(verifyRound({ serverSeed: seed, commitment, clientSeed: 'c', nonce: 1 }, crash + 1).ok).toBe(false);
    expect(verifyRound({ serverSeed: derivedSeed('x', 1), commitment, clientSeed: 'c', nonce: 1 }).commitmentMatches).toBe(false);
    expect(verifyRound({ serverSeed: 'not hex', commitment, clientSeed: 'c', nonce: 1 }).ok).toBe(false);
  });
});

describe('curve and money', () => {
  it('elapsedFor is the exact inverse of multiplierAt', () => {
    for (const m of [100, 101, 150, 199, 200, 1234, 10_000, 99_999, MAX_MULT]) {
      const t = elapsedFor(m);
      expect(multiplierAt(t)).toBeGreaterThanOrEqual(m);
      if (t > 0) expect(multiplierAt(t - 1)).toBeLessThan(m);
    }
  });
  it('is monotone', () => {
    let prev = 0;
    for (let t = 0; t < 200_000; t += 37) {
      const m = multiplierAt(t);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });
  it('pays floor(stake · mult)', () => {
    expect(payout(1000, 237)).toBe(2370);
    expect(payout(10, 101)).toBe(10);
    expect(payout(333, 150)).toBe(499);
    expect(payout(100_000, MAX_MULT)).toBe(1_000_000_000);
  });
  it('formats and parses', () => {
    expect(formatCredits(123456)).toBe('1,234.56');
    expect(formatCredits(-5, { sign: true })).toBe('−0.05');
    expect(formatMult(237)).toBe('2.37');
    expect(parseCredits('12.5')).toBe(1250);
    expect(parseCredits('1,200')).toBe(120000);
    expect(parseCredits('1.234')).toBeNull();
    expect(parseCredits('-3')).toBeNull();
    expect(parseMult('2.5x')).toBe(250);
    expect(parseMult('abc')).toBeNull();
  });
});
