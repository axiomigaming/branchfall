/**
 * The first-run rehearsal, proved rather than promised.
 *
 * `docs/DESIGN.md` §5.2.3 makes three claims a specification normally gets away
 * with asserting: the rehearsal runs the real model, its seed pair is published
 * and frozen here, and that pair was chosen so the first run *loses* rather than
 * flatters. All three are checkable, so they are checked — the same standard the
 * paytable is held to.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { F } from '../tools/lib/exact.mjs';
import { CONFIG } from '../tools/lib/model.mjs';
import {
  REHEARSAL,
  REHEARSAL_ARENAS,
  buildRehearsalFixture,
  deriveRehearsal,
  search,
} from '../tools/rehearsal.mjs';
import { FIXTURE_INPUT, deriveHazardTable, hazardDigest, preCommit, resolveArena } from '../tools/transcript.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const frozen = JSON.parse(read('tests/fixtures/rehearsal-v1.json'));

describe('the published rehearsal seed pair', () => {
  const derived = deriveRehearsal();

  it('is frozen: the fixture is exactly what the tools produce today', () => {
    expect(buildRehearsalFixture()).toEqual(frozen);
  });

  it('runs the real model — same derivation, same commitment, same digest', () => {
    const pre = preCommit(REHEARSAL.serverSeed, REHEARSAL.roundId);
    expect(derived.published.preCommitment.commitment).toBe(pre.commitment);
    const hazard = deriveHazardTable(REHEARSAL.serverSeed, REHEARSAL.clientSeed, REHEARSAL.roundId);
    expect(derived.published.hazardDigest).toBe(hazardDigest(REHEARSAL.roundId, REHEARSAL.clientSeed, hazard));
    // The table is the full five-arena one. The rehearsal simply stops at three.
    expect(Object.keys(hazard.draws ?? hazard).length).toBeGreaterThan(0);
    expect(REHEARSAL_ARENAS).toBeLessThan(CONFIG.arenas);
  });

  it('lands every teaching beat DESIGN.md §5.2.3 promises', () => {
    expect(derived.beats.all).toBe(true);
    expect(derived.arenas.map((a) => [a.running, a.survivors])).toEqual([
      [5, 5],
      [5, 3],
      [3, 0],
    ]);
  });

  it('does not open with a win: banking after arena 2 returns less than the stake', () => {
    const [n, d] = derived.arenas[1].claimAfter.split('/').map(BigInt);
    expect(F(n, d).lt(F(1n, 1n)), 'the rehearsal would pay a first-time player').toBe(true);
    // And it is below the claim the round opened at, which is the weaker claim
    // DESIGN.md makes in prose.
    expect(F(n, d).lt(CONFIG.rtp)).toBe(true);
  });

  it('ends at nothing if the player keeps going, which is the point', () => {
    expect(derived.arenas[2].survivors).toBe(0);
    expect(derived.arenas[2].claimAfter).toBe('0/1');
  });

  it('is reproducible: the declared search finds exactly this pair', () => {
    const found = search({ limit: 2000 });
    expect(found).not.toBeNull();
    expect(found.pair.clientSeed).toBe(REHEARSAL.clientSeed);
  });
});

describe('the rehearsal is quarantined from real play', () => {
  it('does not share a seed, a round id or a commitment with any real round', () => {
    expect(REHEARSAL.serverSeed).not.toBe(FIXTURE_INPUT.serverSeed);
    expect(REHEARSAL.clientSeed).not.toBe(FIXTURE_INPUT.clientSeed);
    expect(REHEARSAL.roundId).not.toBe(FIXTURE_INPUT.roundId);
  });

  it('publishes a server seed that is obviously ceremonial rather than random', () => {
    // A live seed must never look like this. That is the property we want.
    expect(REHEARSAL.serverSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(REHEARSAL.serverSeed.match(/.{8}/g)).size).toBe(1);
  });

  it('carries no stake, no side bet and no ledger anywhere in its fixture', () => {
    // The note is prose *declaring* the absence; the data is what must be clean.
    const { note: _note, ...data } = frozen;
    const text = JSON.stringify(data);
    for (const forbidden of ['stakeMicro', 'sideBets', 'credited', 'ledger', 'wallet']) {
      expect(text, `the rehearsal fixture mentions "${forbidden}"`).not.toContain(forbidden);
    }
    expect(frozen.note).toContain('Never usable for a real round');
  });

  it('depends on the money path one-way: transcript never imports rehearsal', () => {
    expect(read('tools/rehearsal.mjs')).toMatch(/from '\.\/transcript\.mjs'/);
    expect(read('tools/transcript.mjs')).not.toMatch(/rehearsal/i);
    expect(read('tools/lib/model.mjs')).not.toMatch(/rehearsal/i);
  });

  it('is documented as a separate entry point, not a flag on the money path', () => {
    const design = read('docs/DESIGN.md');
    const engine = read('docs/ENGINE.md');
    expect(design).toContain('separate entry point');
    expect(design).toContain('cannot be handed a live round');
    expect(engine).toContain('rehearsal');
    expect(engine).toMatch(/boolean on the money path|flag on the money path/);
  });

  it('states plainly that choosing this seed would be an attack if money were involved', () => {
    const design = read('docs/DESIGN.md');
    expect(design).toContain('is, in a money round, exactly the attack');
    expect(read('tools/rehearsal.mjs')).toContain('§10.1 exists to prevent');
  });
});

describe('a rehearsal on any other seed is still a real rehearsal', () => {
  it('derives and resolves cleanly on seeds that land no teaching beat', () => {
    // The "random practice run" path in DESIGN.md §5.2.3: same code, no promises.
    let differed = 0;
    for (let i = 900; i < 940; i += 1) {
      const pair = { ...REHEARSAL, clientSeed: `branchfall-rehearsal-${String(i).padStart(5, '0')}` };
      const result = deriveRehearsal(pair);
      expect(result.arenas.length).toBeGreaterThanOrEqual(1);
      expect(result.arenas.length).toBeLessThanOrEqual(REHEARSAL_ARENAS);
      for (const arena of result.arenas) {
        expect(arena.survivors).toBeLessThanOrEqual(arena.running);
        expect(arena.survivors).toBeGreaterThanOrEqual(0);
      }
      if (!result.beats.all) differed += 1;
    }
    expect(differed, 'the beats must be a property of the chosen seed, not of all seeds').toBeGreaterThan(0);
  });

  it('proves the unchosen routes were committed too, which is what the Ghost Line shows', () => {
    const hazard = deriveHazardTable(REHEARSAL.serverSeed, REHEARSAL.clientSeed, REHEARSAL.roundId);
    const running = [0, 1, 2, 3, 4];
    // Arena 1 on the route the default path did not take, from the same table.
    const narrow = resolveArena(hazard, 1, 'NARROW', running, null);
    const wide = resolveArena(hazard, 1, 'WIDE', running, null);
    expect(wide.survivors).toHaveLength(5);
    expect(narrow.survivors.length).toBeLessThanOrEqual(5);
    // Re-deriving twice gives the same answer: the counterfactual is fixed.
    expect(resolveArena(hazard, 1, 'NARROW', running, null).survivors).toEqual(narrow.survivors);
  });
});
