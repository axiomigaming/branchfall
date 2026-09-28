import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { CRASH_CLIPS, crashStaging, epicOf, escapeStaging, nextBeat, runDrive, runTier, type CrashKind, type EscapeVariant } from '../src/world/choreo';

describe('run tiers', () => {
  it('steps at 2x, 5x, 10x and 25x', () => {
    expect([1, 1.99, 2, 4.99, 5, 9.99, 10, 24.99, 25, 100, 10000].map(runTier)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4]);
  });

  it('drive is continuous, monotonic, and meets the tier at each boundary', () => {
    let prev = runDrive(1);
    expect(prev).toBe(0);
    for (let m = 1.001; m < 60; m *= 1.003) {
      const d = runDrive(m);
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d - prev).toBeLessThan(0.01); // no pops
      expect(Math.floor(d + 1e-9)).toBe(Math.min(4, runTier(m)));
      prev = d;
    }
    expect(runDrive(0.5)).toBe(0);
    expect(runDrive(1e6)).toBe(4);
  });
});

describe('epic scale', () => {
  it('is 0 for small falls, 1 for big ones, monotonic between', () => {
    expect(epicOf(1)).toBe(0);
    expect(epicOf(1.5)).toBe(0);
    expect(epicOf(10)).toBe(1);
    expect(epicOf(500)).toBe(1);
    expect(epicOf(3)).toBeGreaterThan(epicOf(2));
  });
});

describe('crash staging', () => {
  const all: CrashKind[] = ['chasm', 'gate', 'rockfall'];

  it('is deterministic in (round id, crash multiplier)', () => {
    for (let i = 0; i < 50; i++) expect(crashStaging(`r-${i}`, 3.2, all, false)).toEqual(crashStaging(`r-${i}`, 3.2, all, false));
  });

  it('only stages kinds the section offers, and reaches every variant', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const s = crashStaging(`round-${i}`, 2, ['gate', 'rockfall'], false);
      expect(['gate', 'rockfall']).toContain(s.kind);
      expect(CRASH_CLIPS[s.kind][s.variant]).toBe(s.clip);
      seen.add(s.clip);
    }
    for (const c of [...CRASH_CLIPS.gate, ...CRASH_CLIPS.rockfall]) expect(seen).toContain(c);
  });

  it('the variant does not depend on the multiplier; only the scale does', () => {
    for (let i = 0; i < 50; i++) {
      const a = crashStaging(`x${i}`, 1.2, all, false);
      const b = crashStaging(`x${i}`, 40, all, false);
      expect(a.clip).toBe(b.clip);
      expect(a.epic).toBeLessThan(b.epic);
    }
  });

  it('a fall before the runner gets going is the push-off gate', () => {
    const s = crashStaging('r', 1, all, true);
    expect(s).toMatchObject({ kind: 'gate', clip: 'fall_start', atStart: true });
  });

  it('falls back when the section offers no hazard list', () => {
    expect(crashStaging('r', 2, [], false).kind).toBe('rockfall');
  });
});

describe('escape staging', () => {
  it('is deterministic in (seed, cash-out multiplier) and reaches every variant', () => {
    const seen = new Set<EscapeVariant>();
    for (let i = 0; i < 400; i++) {
      const a = escapeStaging(`s${i}`, 12, false);
      expect(a).toEqual(escapeStaging(`s${i}`, 12, false));
      seen.add(a.variant);
    }
    expect(seen.size).toBe(4);
  });

  it('grand escapes favour the grand moves', () => {
    const count = (m: number) => {
      let n = 0;
      for (let i = 0; i < 2000; i++) if (['leap', 'cheer'].includes(escapeStaging(`k${i}`, m, false).variant)) n++;
      return n;
    };
    expect(count(40)).toBeGreaterThan(count(1.2));
  });

  it('a standing cash-out (1.00x) turns and salutes, starting past the run-out', () => {
    expect(escapeStaging('s', 1, true)).toMatchObject({ variant: 'salute', offset: 0.7 });
  });
});

describe('run beats', () => {
  it('none below the sprint tier; always a positive wait above it', () => {
    const r = new Rng(1);
    expect(nextBeat(r, 0)).toBeNull();
    expect(nextBeat(r, 1)).toBeNull();
    for (let t = 2; t <= 4; t++) {
      for (let i = 0; i < 100; i++) {
        const b = nextBeat(r, t)!;
        expect(b.wait).toBeGreaterThan(1);
        expect(['glance', 'stumble']).toContain(b.beat);
      }
    }
  });
});
