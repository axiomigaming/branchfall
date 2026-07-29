/**
 * The typed adapter declaration and the runtime model must never drift.
 *
 * `src/branchfall.adapter.ts` is what the engine's `staged-survival` module will
 * consume; `tools/lib/model.mjs` is what the enumerator proves. They are two
 * files, so they can disagree. This test makes that impossible to ship.
 *
 * The declaration is checked as source text rather than imported, so this test
 * holds regardless of TypeScript tooling. `npm run typecheck` covers the types.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG, CONTRACTS, CONTRACT_IDS } from '../tools/lib/model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const adapter = readFileSync(resolve(root, 'src/branchfall.adapter.ts'), 'utf8');
const lifecycle = readFileSync(resolve(root, 'src/staged-survival.ts'), 'utf8');

describe('src/branchfall.adapter.ts matches tools/lib/model.mjs', () => {
  it('declares the same hazard parameters for every contract', () => {
    for (const id of CONTRACT_IDS) {
      const spec = CONTRACTS[id];
      const expected = `collapse: rational(${spec.collapse.n}n, ${spec.collapse.d}n), clear: rational(${spec.clear.n}n, ${spec.clear.d}n)`;
      expect(adapter, `${id} profile`).toContain(expected);
    }
  });

  it('declares the same identity, size and horizon', () => {
    expect(adapter).toContain(`id: '${CONFIG.gameId}'`);
    expect(adapter).toContain(`adapterVersion: '${CONFIG.adapterVersion}'`);
    expect(adapter).toContain(`modelVersion: '${CONFIG.modelVersion}'`);
    expect(adapter).toContain(`squadSize: ${CONFIG.squadSize}`);
    expect(adapter).toContain(`arenas: ${CONFIG.arenas}`);
  });

  it('declares the same pricing and risk policy', () => {
    expect(adapter).toContain(`firstEntryRtp: rational(${CONFIG.rtp.n}n, ${CONFIG.rtp.d}n)`);
    expect(adapter).toContain('continuationRtp: rational(1n, 1n)');
    expect(adapter).toContain(`maxWinMultiple: ${CONFIG.maxWinMultiple}n`);
    expect(adapter).toContain('capMustBeUnreachable: true');
    expect(adapter).toContain("rounding: 'floor'");
  });

  it('declares the same minimum squad size and lane count per contract', () => {
    for (const id of CONTRACT_IDS) {
      const spec = CONTRACTS[id];
      const block = adapter.slice(adapter.indexOf(`id: '${id}'`), adapter.indexOf(`id: '${id}'`) + 400);
      expect(block, `${id} laneCount`).toContain(`laneCount: ${spec.laneCount}`);
      expect(block, `${id} minRunners`).toContain(`minRunners: ${spec.minRunners}`);
    }
  });

  it('keeps cosmetics out of the money path', () => {
    expect(adapter).toContain('defaultRunnerNames');
    expect(adapter).toMatch(/Cosmetic only\./);
    expect(lifecycle).toMatch(/Cosmetic only\. Must not appear in any fingerprint or probability path\./);
  });
});

describe('src/staged-survival.ts pins the lifecycle contract', () => {
  it('targets the current engine API and names the new lifecycle', () => {
    expect(lifecycle).toContain("ENGINE_API_VERSION = 'reveal-engine/api-v1'");
    expect(lifecycle).toContain("LIFECYCLE_MODULE = 'reveal-engine/staged-survival-v1'");
    expect(lifecycle).toContain("COMMITMENT_VERSION = 'branchfall/commit-v1'");
    expect(lifecycle).toContain("TRANSCRIPT_SCHEMA = 'branchfall/transcript-v1'");
  });

  it('keeps money as BigInt and probability as exact rationals', () => {
    expect(lifecycle).toContain('export type Micro = bigint');
    expect(lifecycle).toMatch(/readonly numerator: bigint;/);
    expect(lifecycle).toMatch(/readonly denominator: bigint;/);
    // No floating point type may appear in the money or probability surface.
    expect(lifecycle).not.toMatch(/:\s*number(\[\])?;\s*\/\/.*(money|credit|stake)/i);
    expect(lifecycle).not.toContain('parseFloat');
  });

  it('requires fair continuation, which is what makes every policy equal-RTP', () => {
    expect(lifecycle).toMatch(/Must be exactly 1/);
    expect(lifecycle).toContain('continuationRtp');
  });

  it('declares counterfactual completeness as a requirement, not an option', () => {
    expect(lifecycle).toMatch(/Counterfactual completeness is mandatory/);
    expect(lifecycle).toMatch(/including routes the player will not take/);
  });

  it('gives the module a total verification surface', () => {
    for (const code of [
      'INVALID_TRANSCRIPT',
      'UNSUPPORTED_VERSION',
      'ADAPTER_MISMATCH',
      'DERIVATION_FAILED',
      'TRANSCRIPT_MISMATCH',
      'COMMITMENT_MISMATCH',
      'ILLEGAL_ACTION',
      'LEDGER_MISMATCH',
    ]) {
      expect(lifecycle, code).toContain(`'${code}'`);
    }
  });
});

describe('docs/ENGINE.md matches the typed surface', () => {
  const engineDoc = readFileSync(resolve(root, 'docs/ENGINE.md'), 'utf8');

  it('documents the same lifecycle and schema identifiers', () => {
    expect(engineDoc).toContain('reveal-engine/staged-survival-v1');
    expect(engineDoc).toContain('branchfall/commit-v1');
    expect(engineDoc).toContain('branchfall/transcript-v1');
    expect(engineDoc).toContain('branchfall-hazard/v1');
  });

  it('documents the same hazard thresholds the sampler uses', () => {
    expect(engineDoc).toMatch(/WIDE \| 25, collapse iff draw < 1 \| 8, clears iff draw < 7/);
    expect(engineDoc).toMatch(/SPLIT \| 10, collapse iff draw < 1 \| 6, clears iff draw < 5/);
    expect(engineDoc).toMatch(/NARROW \| 2, collapse iff draw < 1 \| 2, clears iff draw < 1/);
  });

  it('documents the draw count the reference implementation actually produces', () => {
    expect(engineDoc).toContain('5 arenas x 4 lanes x (1 collapse + 5 slips) = 120');
  });
});
