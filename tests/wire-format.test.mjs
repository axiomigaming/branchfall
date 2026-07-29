/**
 * Frozen wire-format fixture.
 *
 * `tests/fixtures/round-transcript-v1.json` is a complete round: seed, round id,
 * action list, the derived hazard table, the commitment, and the full money
 * ledger. It is the conformance vector for the engine's `staged-survival`
 * module (docs/ENGINE.md §4): an independent implementation is correct when it
 * reproduces this file byte for byte.
 *
 * If this test fails, either the derivation changed — in which case
 * `modelVersion` and `adapterVersion` must be bumped and the fixture
 * regenerated deliberately — or something drifted by accident. Never
 * regenerate this file to make a test pass.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixture, openRound, replayRound, verifyRound, SCHEMA } from '../tools/transcript.mjs';
import { CONFIG } from '../tools/lib/model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = resolve(root, 'tests/fixtures/round-transcript-v1.json');
const frozen = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('frozen transcript fixture', () => {
  it('regenerates byte for byte', () => {
    const rebuilt = buildFixture();
    expect(JSON.parse(JSON.stringify(rebuilt))).toEqual(frozen);
  });

  it('pins the wire schema and adapter identity', () => {
    expect(frozen.schema).toBe(SCHEMA);
    expect(frozen.schema).toBe('branchfall/transcript-v1');
    expect(CONFIG.adapterVersion).toBe('1.0.0');
    expect(CONFIG.modelVersion).toBe('branchfall-hazard/v1');
  });

  it('pins the commitment for this seed and round id', () => {
    expect(frozen.commitment).toBe('f093b04fbed13e5b659290bcb04bf7062f0b3d855de2cf8895f379bbb0f31cf1');
    expect(frozen.commitment).toBe(openRound(frozen.input.seed, frozen.input.roundId).commitment);
  });

  it('pins the money ledger exactly', () => {
    expect(frozen.replay.stakeMicro).toBe('10000000');
    expect(frozen.replay.creditedMicro).toBe('3031746');
    expect(frozen.replay.returnMultiple).toBe('1515873/5000000');
    expect(frozen.replay.finalClaim).toBe('0/1');
    expect(frozen.replay.capped).toBe(false);
  });

  it('tells a complete, readable story: a shelter rescue and then a wipe', () => {
    const ledger = frozen.replay.ledger;
    expect(ledger.map((e) => e.contract)).toEqual(['SPLIT', 'WIDE', 'WIDE', 'NARROW']);
    expect(ledger[0].survivors).toEqual([0, 1, 2, 3, 4]);
    expect(ledger[1].survivors).toEqual([0, 2, 4]);
    expect(ledger[2].action).toBe('SHELTER');
    expect(ledger[2].sheltered).toEqual([0]);
    expect(ledger[3].collapsed).toEqual([true]);
    expect(ledger[3].survivors).toEqual([]);
    expect(ledger[3].fallen.every((f) => f.cause === 'collapse')).toBe(true);
    // The round ends at arena 4; the recorded BANK at arena 5 is never reached.
    expect(ledger).toHaveLength(4);
  });

  it('serialises money and probability as strings, never as JSON numbers', () => {
    const text = readFileSync(fixturePath, 'utf8');
    expect(text).toContain('"creditedMicro": "3031746"');
    expect(text).toContain('"claimBefore": "191/200"');
    for (const entry of frozen.replay.ledger) {
      if (entry.claimBefore !== undefined) expect(typeof entry.claimBefore).toBe('string');
      if (entry.claimAfter !== undefined) expect(typeof entry.claimAfter).toBe('string');
    }
    expect(typeof frozen.replay.creditedMicro).toBe('string');
    expect(typeof frozen.replay.returnMultiple).toBe('string');
  });

  it('verifies from the revealed seed alone', () => {
    const round = openRound(frozen.input.seed, frozen.input.roundId);
    const play = { stakeMicro: BigInt(frozen.input.stakeMicro), actions: frozen.input.actions };
    const result = verifyRound(frozen.input.seed, round, play);
    expect(result.ok).toBe(true);
    expect(result.commitment).toBe(frozen.commitment);
    expect(result.replay.creditedMicro).toBe(frozen.replay.creditedMicro);
    expect(replayRound(round, play).ledger).toEqual(frozen.replay.ledger);
  });

  it('keeps the counterfactual branches in the fixture so the Ghost Line is provable', () => {
    // Arena 4 was run on NARROW; the WIDE and SPLIT draws for arena 4 are still committed.
    expect(frozen.hazard[3].WIDE).toHaveLength(1);
    expect(frozen.hazard[3].SPLIT).toHaveLength(2);
    expect(frozen.hazard[3].NARROW).toHaveLength(1);
    expect(frozen.hazard).toHaveLength(CONFIG.arenas);
  });
});
