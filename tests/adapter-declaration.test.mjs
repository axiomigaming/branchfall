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
import { CONFIG, CONTRACTS, CONTRACT_IDS, SIDE_BET_IDS, laneSplitsFor } from '../tools/lib/model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const adapter = readFileSync(resolve(root, 'src/branchfall.adapter.ts'), 'utf8');
const lifecycle = readFileSync(resolve(root, 'src/staged-survival.ts'), 'utf8');
const engineDoc = readFileSync(resolve(root, 'docs/ENGINE.md'), 'utf8');

describe('src/branchfall.adapter.ts matches tools/lib/model.mjs', () => {
  it('declares the same hazard parameters for every contract', () => {
    for (const id of CONTRACT_IDS) {
      const spec = CONTRACTS[id];
      const block = adapter.slice(adapter.indexOf(`id: '${id}'`));
      expect(block, `${id} collapse`).toContain(
        `collapse: rational(${spec.collapse.n}n, ${spec.collapse.d}n)`,
      );
      expect(block, `${id} clear`).toContain(`clear: rational(${spec.clear.n}n, ${spec.clear.d}n)`);
      expect(block, `${id} laneCount`).toContain(`laneCount: ${spec.laneCount}`);
      expect(block, `${id} minRunners`).toContain(`minRunners: ${spec.minRunners}`);
    }
  });

  it('declares the same identity, size and RTP', () => {
    expect(adapter).toContain(`id: '${CONFIG.gameId}'`);
    expect(adapter).toContain(`adapterVersion: '${CONFIG.adapterVersion}'`);
    expect(adapter).toContain(`modelVersion: '${CONFIG.modelVersion}'`);
    expect(adapter).toContain(`squadSize: ${CONFIG.squadSize}`);
    expect(adapter).toContain(`arenas: ${CONFIG.arenas}`);
    expect(adapter).toContain(`firstEntryRtp: rational(${CONFIG.rtp.n}n, ${CONFIG.rtp.d}n)`);
    expect(adapter).toContain('continuationRtp: rational(1n, 1n)');
    const declaredMinStake = adapter.match(/minStake:\s*([\d_]+)n/);
    expect(declaredMinStake, 'adapter declares no minStake').not.toBeNull();
    expect(BigInt(declaredMinStake[1].replace(/_/g, ''))).toBe(CONFIG.minStakeMicro);
  });

  it('declares the same side-bet events, and no prices', () => {
    for (const id of SIDE_BET_IDS) expect(adapter).toContain(`id: '${id}'`);
    // A declared multiplier would be a re-pricing vector. There must be none.
    expect(adapter).not.toMatch(/multiplier\s*:/);
    expect(adapter).toContain("sideBetRule: 'firstEntryRtp/probability'");
  });

  it('declares the same cap, on the same basis', () => {
    expect(adapter).toContain(`maxWinMultiple: ${CONFIG.maxWinMultiple}n`);
    expect(adapter).toContain("capBasis: 'per-ticket'");
    expect(adapter).toContain('capMustBeUnreachable: true');
  });

  it('declares the same side-bet stake limits', () => {
    expect(adapter).toContain(
      `maxSideBetStakeRatio: rational(${CONFIG.sideBet.maxStakeRatioPerBet.n}n, ${CONFIG.sideBet.maxStakeRatioPerBet.d}n)`,
    );
    expect(adapter).toContain(
      `maxTotalSideBetStakeRatio: rational(${CONFIG.sideBet.maxTotalStakeRatio.n}n, ${CONFIG.sideBet.maxTotalStakeRatio.d}n)`,
    );
  });

  it('declares the same speed-of-play controls', () => {
    expect(adapter).toContain(`minGameCycleMs: ${CONFIG.minGameCycleMs}`);
    expect(adapter).toContain("cycleUnit: 'arena'");
    expect(adapter).toContain('maxDecisionCountdownMs: 0');
  });

  it('implements the same lane-balance rule the model enumerates', () => {
    // The declaration computes ceil(n/2)..n-1; assert it agrees with the model
    // for every size, by re-implementing the declared formula here.
    const declared = (n) => {
      const out = [];
      for (let k = Math.ceil(n / 2); k <= n - 1; k += 1) out.push(k);
      return out;
    };
    expect(adapter).toContain('for (let k = Math.ceil(runners / 2); k <= runners - 1; k += 1)');
    for (let n = 2; n <= CONFIG.squadSize; n += 1) {
      expect(declared(n)).toEqual([...laneSplitsFor('SPLIT', n)]);
    }
    expect(adapter).toContain('laneSplits: oneGeometry');
  });

  it('keeps cosmetics out of the mechanical surface', () => {
    expect(adapter).toContain('defaultRunnerNames');
    expect(adapter).toContain('renamable: true');
    expect(engineDoc).toContain('**Cosmetics are excluded.**');
  });
});

describe('src/staged-survival.ts is the contract ENGINE.md describes', () => {
  it('pins the versions the transcript uses', () => {
    expect(lifecycle).toContain("export const COMMITMENT_VERSION = 'branchfall/commit-v2'");
    expect(lifecycle).toContain("export const TRANSCRIPT_SCHEMA = 'branchfall/transcript-v2'");
    expect(lifecycle).toContain("export const SEED_CHAIN_VERSION = 'branchfall/seed-chain-v1'");
  });

  it('requires a client seed structurally, in the type the deriver reads', () => {
    const context = lifecycle.slice(lifecycle.indexOf('export interface RoundContext'));
    expect(context.slice(0, 600)).toContain('readonly clientSeed: string;');
    // Not optional. An optional client seed is a client seed an operator can skip.
    expect(context.slice(0, 600)).not.toContain('clientSeed?:');
  });

  it('gives derive() no way to see an action', () => {
    const schedule = lifecycle.slice(lifecycle.indexOf('export interface HazardSchedule'));
    const signature = schedule.slice(schedule.indexOf('derive('), schedule.indexOf('derive(') + 120);
    expect(signature).toContain('serverSeedHex: string');
    expect(signature).toContain('context: RoundContext');
    expect(signature).not.toContain('action');
  });

  it('makes side bets a field of the committing action, not a separate command', () => {
    const action = lifecycle.slice(
      lifecycle.indexOf('export type StagedSurvivalAction'),
      lifecycle.indexOf('/* ---', lifecycle.indexOf('export type StagedSurvivalAction')),
    );
    expect(action).toContain("readonly type: 'ROUTE'");
    expect(action).toContain('readonly laneSplit: number | null;');
    expect(action).toContain('readonly sideBets?: readonly SideBetTicket[];');
    expect(lifecycle).not.toContain("'PLACE_SIDE_BET'");
  });

  it('lets the adapter declare side-bet events but never a price', () => {
    const spec = lifecycle.slice(
      lifecycle.indexOf('export interface SideBetSpec'),
      lifecycle.indexOf('export interface SideBetOffer'),
    );
    expect(spec).toContain('readonly event: SideBetEvent;');
    expect(spec).not.toContain('multiplier');
  });

  it('types the cap basis and the speed floor so they cannot be omitted', () => {
    expect(lifecycle).toContain("readonly capBasis: 'per-ticket';");
    expect(lifecycle).toContain("readonly cycleUnit: 'arena' | 'round';");
    expect(lifecycle).toContain('readonly maxDecisionCountdownMs: 0;');
  });

  it('forbids the published transcript from carrying the table', () => {
    expect(lifecycle).toContain('readonly hazard?: never;');
    expect(lifecycle).toContain('export interface SealedRound');
    expect(lifecycle).toContain('readonly hazard: HazardTable;');
  });

  it('types the side-bet ticket exactly as the reference wire format accepts it', () => {
    const ticket = lifecycle.slice(
      lifecycle.indexOf('export interface SideBetTicket'),
      lifecycle.indexOf('export type StagedSurvivalAction'),
    );
    expect(ticket).toContain('readonly bet: string;');
    expect(ticket).toContain('readonly stakeMicro: Micro;');
    expect(ticket).toContain('readonly quotedMultiplier?: string;');
    // The reference implementation must accept exactly these names.
    const reference = readFileSync(resolve(root, 'tools/transcript.mjs'), 'utf8');
    expect(reference).toContain('ticket.quotedMultiplier');
    expect(reference).toContain('ticket.stakeMicro');
    expect(reference).toContain('ticket.bet');
  });

  it('binds a seed-chain POSITION, not just the next hash', () => {
    expect(lifecycle).toContain('export interface SeedChainPosition');
    expect(lifecycle).toContain('readonly index: number;');
    expect(lifecycle).not.toContain('chainNextHash');
  });

  it('requires openRound to open an already-published pre-commitment', () => {
    const surface = lifecycle.slice(lifecycle.indexOf('openRound('));
    expect(surface.slice(0, 400)).toContain('preCommitment: ServerPreCommitment');
    expect(surface.slice(0, 400)).toContain('): SealedRound;');
  });

  it('requires verify() to compare a published settlement', () => {
    expect(lifecycle).toContain('settlement?: StagedSurvivalSettlement');
    expect(lifecycle).toContain('export interface StagedSurvivalSettlement');
    expect(engineDoc).toContain('LEDGER_MISMATCH');
  });

  it('exposes the failure codes ENGINE.md documents', () => {
    for (const code of [
      'COMMITMENT_MISMATCH',
      'CHAIN_MISMATCH',
      'MALFORMED_HAZARD',
      'INVALID_LANE_SPLIT',
      'INVALID_SIDE_BET',
      'QUOTE_MISMATCH',
      'TOO_SOON',
    ]) {
      expect(lifecycle, `${code} missing from the type`).toContain(code);
      expect(engineDoc, `${code} missing from ENGINE.md`).toContain(code);
    }
  });

  it('declares a two-step commitment, in that order', () => {
    expect(lifecycle).toContain('preCommit(');
    expect(lifecycle).toContain('openRound(');
    expect(lifecycle.indexOf('preCommit(')).toBeLessThan(
      lifecycle.indexOf('openRound(', lifecycle.indexOf('preCommit(')),
    );
    expect(lifecycle).toContain('export interface ServerPreCommitment');
    expect(lifecycle).toContain('export interface SeedChainCommitment');
  });

  it('types round expiry so it cannot bank a round the model cannot bank', () => {
    const expiry = lifecycle.slice(
      lifecycle.indexOf('export type RoundExpiryResolution'),
      lifecycle.indexOf('export type VerificationFailureCode'),
    );
    expect(expiry).toContain("readonly kind: 'AUTO_BANK'");
    expect(expiry).toContain("readonly kind: 'VOID'");
    expect(expiry).toContain("readonly reason: 'BANK_ILLEGAL_BEFORE_FIRST_RESOLUTION'");
    // A void returns the stake; it never credits, so it carries no credit field.
    expect(expiry.slice(expiry.indexOf("readonly kind: 'VOID'"))).not.toContain('creditMicro');
    // The module must expose the only path that closes an abandoned round, and
    // the surface must be pure state plus a clock — never a policy argument.
    const surface = lifecycle.slice(lifecycle.indexOf('  expire('), lifecycle.indexOf('  expire(') + 260);
    expect(surface).toContain('frame: StagedSurvivalFrame');
    expect(surface).toContain('): RoundExpiryResolution;');
    expect(engineDoc).toContain('Expiry — the one resolution the player did not choose');
    expect(engineDoc).toContain('`expire()` may never emit a `ROUTE` or a `SHELTER`');
  });

  it('never mentions a float type in a money or probability position', () => {
    const moneyLines = lifecycle
      .split('\n')
      .filter((line) => /stake|credit|claim|probability|multiplier|Micro/i.test(line));
    for (const line of moneyLines) {
      expect(line, `float in a money path: ${line.trim()}`).not.toMatch(/:\s*number\b/);
    }
  });
});
