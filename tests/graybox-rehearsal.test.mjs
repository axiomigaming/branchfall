/**
 * The rehearsal: its published beats, and its quarantine.
 *
 * Two separate claims, and the second is the one that matters most:
 *
 * 1. The frozen seed pair still produces the teaching beats `docs/DESIGN.md`
 *    §5.2.3 specifies — 5 clear, then 3, then nobody — and it still pays nothing.
 *    If the derivation, the model or the chosen pair ever stops producing them,
 *    onboarding is silently broken.
 * 2. Nothing in the rehearsal's module graph can reach the book, the wallet or a
 *    receipt. `ENGINE.md` §7 check 17 makes that a conformance obligation and
 *    §10.2 explains the cost of getting it wrong: the rehearsal is the one place
 *    a client legitimately holds a hazard table, and it earns that only by having
 *    no money in it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REHEARSAL_SEED_PAIR } from '../server/rehearsal-seed.ts';
import { REHEARSAL_ARENAS, replay } from '../server/rehearsal.ts';
import { candidateSeed, defaultPathBeats, search } from '../tools/rehearsal-seed.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const wide = () => ({ route: 'WIDE' });

describe('the published rehearsal', () => {
  it('is the first hit of the published search, not a pair we picked', () => {
    const found = search(REHEARSAL_SEED_PAIR.candidateIndex + 1);
    expect(found).not.toBeNull();
    expect(found.serverSeed).toBe(REHEARSAL_SEED_PAIR.serverSeed);
    expect(found.index).toBe(REHEARSAL_SEED_PAIR.candidateIndex);
    expect(candidateSeed(REHEARSAL_SEED_PAIR.candidateIndex)).toBe(REHEARSAL_SEED_PAIR.serverSeed);
  });

  it('is a repeating pattern, so a live seed can never be confused with it', () => {
    const pattern = REHEARSAL_SEED_PAIR.serverSeed.slice(0, 4);
    expect(REHEARSAL_SEED_PAIR.serverSeed).toBe(pattern.repeat(16));
  });

  it('lands the three beats DESIGN §5.2.3 requires', () => {
    expect([...defaultPathBeats(REHEARSAL_SEED_PAIR.serverSeed)]).toEqual([5, 3, 0]);
    const result = replay([wide(), wide(), wide()]);
    expect(result.arenas).toHaveLength(REHEARSAL_ARENAS);
    expect(result.arenas[0].survivors).toHaveLength(5);
    expect(result.arenas[1].survivors).toHaveLength(3);
    expect(result.arenas[2].survivors).toHaveLength(0);
    expect(result.wiped).toBe(true);
  });

  it('teaches both endings, and neither of them is a win', () => {
    // Bank after arena 2 and you are below the stake, not merely below the claim
    // the round opened at.
    const banked = replay([wide(), wide()]);
    expect(Number(banked.claim)).toBeLessThan(1);
    expect(banked.claim).toBe('0.812');
    // Continue and you finish with nothing.
    const wiped = replay([wide(), wide(), wide()]);
    expect(wiped.claim).toBe('0.000');
    // And there is no payout on any path, ever.
    expect(banked.payout).toBeNull();
    expect(wiped.payout).toBeNull();
  });

  it('shows the ghost line once the run is over, and never a money figure', () => {
    const result = replay([wide(), wide(), wide()]);
    expect(result.ghost.length).toBeGreaterThan(0);
    expect(result.ghost.some((row) => row.route === 'NARROW')).toBe(true);
    const serialised = JSON.stringify(result.ghost);
    expect(serialised).not.toMatch(/claim|credit|Micro|multiplier/iu);
  });

  it('refuses a card the disclosure ladder has not reached yet', () => {
    expect(() => replay([{ route: 'SPLIT', laneSplit: 3 }])).toThrow(/not on offer/u);
    expect(() => replay([wide(), { route: 'SHELTER', shelter: [0] }])).toThrow(/not on offer/u);
  });
});

describe('rehearsal quarantine', () => {
  const graph = (entry, seen = new Set()) => {
    if (seen.has(entry)) return seen;
    seen.add(entry);
    const source = readFileSync(entry, 'utf8');
    for (const match of source.matchAll(/from '(\.[^']+)'/gu)) {
      const target = resolve(dirname(entry), match[1].replace(/\.js$/u, '.ts'));
      graph(target, seen);
    }
    return seen;
  };

  it('cannot reach the book, the wallet, a receipt or a round from anywhere in its graph', () => {
    const modules = [...graph(resolve(root, 'server/rehearsal.ts'))];
    expect(modules.length).toBeGreaterThan(3);
    for (const file of modules) {
      const source = readFileSync(file, 'utf8');
      expect(`${file}: ${/from '\.\/wallet\.js'/u.test(source)}`).toBe(`${file}: false`);
      expect(`${file}: ${/from '\.\/rounds\.js'/u.test(source)}`).toBe(`${file}: false`);
      expect(`${file}: ${/SurvivalBook/u.test(source)}`).toBe(`${file}: false`);
    }
  });

  it('has no money vocabulary in its code, only in its prose', () => {
    // Comments are stripped first: this file argues at length about wallets and
    // receipts precisely because it must never touch one.
    const code = readFileSync(resolve(root, 'server/rehearsal.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/\/\/.*$/gmu, '');
    for (const forbidden of ['stakeMicro', 'Wallet', 'creditedMicro', 'Receipt', 'payableWithinCap'])
      expect(`${forbidden}: ${code.includes(forbidden)}`).toBe(`${forbidden}: false`);
  });
});
