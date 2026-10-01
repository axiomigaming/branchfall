import { afterEach, describe, expect, it, vi } from 'vitest';
import { MILESTONES, countUp, haptic, heatOf, milestoneApproach, milestoneCrossed, setHaptics, tierOf } from '../src/audio/feedback';

describe('milestones', () => {
  it('fires once, on the frame the multiplier reaches each mark', () => {
    expect(milestoneCrossed(199, 200)).toBe(0);
    expect(milestoneCrossed(200, 201)).toBe(-1);
    expect(milestoneCrossed(150, 199)).toBe(-1);
    expect(milestoneCrossed(499, 500)).toBe(1);
    expect(milestoneCrossed(9999, 10000)).toBe(5);
  });

  it('reports the highest mark when a frame skips several (tab was in the background)', () => {
    expect(milestoneCrossed(150, 1200)).toBe(2);
  });

  it('a whole climb emits every milestone exactly once, in order', () => {
    const hits: number[] = [];
    let prev = 100;
    for (let m = 101; m <= 10000; m += 7) {
      const h = milestoneCrossed(prev, m);
      if (h >= 0) hits.push(h);
      prev = m;
    }
    const h = milestoneCrossed(prev, 10000);
    if (h >= 0) hits.push(h);
    expect(hits).toEqual(MILESTONES.map((_, i) => i));
  });
});

describe('tension riser approach', () => {
  it('is a function of the multiplier alone: 0 after a mark, rising towards the next', () => {
    expect(milestoneApproach(100)).toBe(0);
    expect(milestoneApproach(200)).toBe(0);
    expect(milestoneApproach(141)).toBeCloseTo(0.5, 1); // √2 is half way to 2× in log space
    expect(milestoneApproach(199)).toBeGreaterThan(0.95);
    expect(milestoneApproach(20000)).toBe(0);
  });

  it('is monotone between marks', () => {
    let last = -1;
    for (let m = 201; m < 500; m++) {
      const a = milestoneApproach(m);
      expect(a).toBeGreaterThanOrEqual(last);
      last = a;
    }
  });
});

describe('heat and tiers', () => {
  it('stays within 0..1 and grows with the multiplier', () => {
    expect(heatOf(100)).toBe(0);
    expect(heatOf(500)).toBeGreaterThan(heatOf(200));
    expect(heatOf(5000)).toBe(1);
    expect(heatOf(1_000_000)).toBe(1);
  });
  it('tiers step at the shared boundaries: <2, 2–5, 5–10, 10–25, 25+', () => {
    expect([100, 199, 200, 499, 500, 999, 1000, 2499, 2500, 5000].map(tierOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('win count-up', () => {
  it('is integer, monotone and lands exactly on the payout', () => {
    let last = 1000;
    for (let t = 0; t <= 1.2; t += 0.01) {
      const v = countUp(1000, 3421, t);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v).toBeLessThanOrEqual(3421);
      last = v;
    }
    expect(countUp(1000, 3421, 1)).toBe(3421);
    expect(countUp(1000, 3421, 0)).toBe(1000);
  });
});

describe('haptics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setHaptics(true);
  });

  it('does nothing where vibration is unsupported', () => {
    vi.stubGlobal('navigator', {});
    expect(() => haptic('crash')).not.toThrow();
  });

  it('vibrates after a gesture, and not when switched off', () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate, userActivation: { hasBeenActive: true } });
    haptic('cashout');
    expect(vibrate).toHaveBeenCalledTimes(1);
    setHaptics(false);
    haptic('cashout');
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('waits for a user gesture', () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate, userActivation: { hasBeenActive: false } });
    haptic('bet');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('survives a browser that throws', () => {
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    expect(() => haptic('milestone')).not.toThrow();
  });
});
