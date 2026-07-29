/**
 * Frozen wire-format fixtures.
 *
 * `tests/fixtures/round-transcript-v2.json` is the conformance vector the engine
 * module must reproduce byte for byte. If this test fails, either the derivation
 * changed (bump `modelVersion` and regenerate deliberately) or something drifted
 * by accident. Both cases must be a human decision, never a silent one.
 *
 * `tests/fixtures/legacy-v1-transcript.json` is the frozen vector for the
 * *rejection* path: v1 derived its table without client entropy, so a v2
 * verifier must fail closed rather than attempt a migration.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_INPUT,
  SCHEMA,
  buildFixture,
  fixturePlay,
  openRound,
  replayRound,
  verifyRound,
} from '../tools/transcript.mjs';
import { CONFIG } from '../tools/lib/model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frozen = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/round-transcript-v2.json'), 'utf8'));
const legacy = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/legacy-v1-transcript.json'), 'utf8'));

describe('the frozen v2 fixture', () => {
  it('is byte-identical to a freshly built one', () => {
    expect(JSON.stringify(buildFixture(), null, 2)).toBe(
      JSON.stringify(frozen, null, 2).replace(/\r\n/g, '\n'),
    );
  });

  it('declares the current schema and adapter identity', () => {
    expect(frozen.schema).toBe(SCHEMA);
    expect(frozen.schema).toBe('branchfall/transcript-v2');
    expect(frozen.input.clientSeed).toBe(FIXTURE_INPUT.clientSeed);
    expect(frozen.serverCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(frozen.hazardDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exercises every path worth freezing', () => {
    const actions = frozen.input.actions;
    expect(actions.map((a) => a.type)).toEqual(['ROUTE', 'ROUTE', 'SHELTER', 'ROUTE', 'BANK']);
    // a lopsided lane balance
    expect(actions[0].contract).toBe('SPLIT');
    expect(actions[0].laneSplit).toBe(4);
    // all three side-bet events, at least one won and at least one lost
    const bets = frozen.replay.sideLedger.map((e) => e.bet);
    expect(new Set(bets).size).toBe(3);
    expect(frozen.replay.sideLedger.some((e) => e.won)).toBe(true);
    expect(frozen.replay.sideLedger.some((e) => !e.won)).toBe(true);
    // a shelter credit, an explicit bank, and a surviving runner at settlement
    expect(frozen.replay.ledger.some((e) => e.action === 'SHELTER')).toBe(true);
    expect(frozen.replay.ledger.some((e) => e.action === 'BANK')).toBe(true);
    expect(frozen.replay.survivorsBanked.length).toBe(1);
  });

  it('carries a complete hazard table and a complete side-bet ledger', () => {
    expect(frozen.hazard.length).toBe(CONFIG.arenas);
    for (const arena of frozen.hazard) {
      for (const id of ['WIDE', 'SPLIT', 'NARROW']) {
        expect(Array.isArray(arena[id])).toBe(true);
        for (const lane of arena[id]) expect(lane.slips.length).toBe(CONFIG.squadSize);
      }
    }
    for (const entry of frozen.replay.sideLedger) {
      for (const key of ['arena', 'bet', 'contract', 'runners', 'laneSplit', 'stakeMicro', 'probability', 'multiplier', 'won', 'creditedMicro']) {
        expect(Object.prototype.hasOwnProperty.call(entry, key), `sideLedger.${key}`).toBe(true);
      }
    }
  });

  it('serialises every money quantity as a string, never a JSON number', () => {
    const money = [
      frozen.replay.stakeMicro,
      frozen.replay.sideStakeMicro,
      frozen.replay.totalStakeMicro,
      frozen.replay.routeCreditedMicro,
      frozen.replay.sideCreditedMicro,
      frozen.replay.creditedMicro,
      frozen.replay.returnMultiple,
      frozen.replay.finalClaim,
      ...frozen.replay.sideLedger.map((e) => e.stakeMicro),
      ...frozen.replay.sideLedger.map((e) => e.creditedMicro),
      ...frozen.input.actions.flatMap((a) => (a.sideBets ?? []).map((b) => b.stakeMicro)),
    ];
    for (const value of money) expect(typeof value).toBe('string');
  });

  it('verifies from the revealed server seed alone', () => {
    const result = verifyRound(
      frozen.input.serverSeed,
      openRound(frozen.input.serverSeed, frozen.input.clientSeed, frozen.input.roundId),
      fixturePlay(frozen.input),
    );
    expect(result.ok).toBe(true);
    expect(result.commitment).toBe(frozen.serverCommitment);
    expect(result.hazardDigest).toBe(frozen.hazardDigest);
    expect(result.replay.creditedMicro).toBe(frozen.replay.creditedMicro);
  });

  it('is reproduced by an independent replay of the same inputs', () => {
    const round = openRound(frozen.input.serverSeed, frozen.input.clientSeed, frozen.input.roundId);
    const replay = replayRound(round, fixturePlay(frozen.input));
    expect(JSON.stringify(replay)).toBe(JSON.stringify(frozen.replay));
  });
});

describe('the frozen v1 fixture is a rejection vector', () => {
  it('is a v1 document', () => {
    expect(legacy.schema).toBe('branchfall/transcript-v1');
    expect(legacy.modelVersion).toBe('branchfall-hazard/v1');
    expect(legacy.adapterVersion).not.toBe(CONFIG.adapterVersion);
    expect(Object.prototype.hasOwnProperty.call(legacy, 'clientSeed')).toBe(false);
  });

  it('fails closed rather than being migrated', () => {
    const result = verifyRound(legacy.seed, legacy, { stakeMicro: 10_000_000n, actions: [{ type: 'BANK' }] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNSUPPORTED_VERSION');
    expect(result.path).toBe('$.schema');
  });
});
