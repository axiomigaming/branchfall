#!/usr/bin/env node
/**
 * BRANCHFALL — Monte Carlo sanity cross-check.
 *
 * NOT the proof. `tools/enumerate.mjs` is the proof: it enumerates the whole
 * outcome space in exact rational arithmetic. This script exists only to catch
 * the class of bug where the closed-form model and a naive forward simulation
 * of the same rules disagree — i.e. where the enumerator is internally
 * consistent but does not describe the game a player would actually play.
 *
 * The simulation deliberately re-implements the hazard rules from first
 * principles (draw a collapse, draw a clear per runner) instead of sampling
 * from the enumerated distributions, so agreement is evidence rather than
 * tautology.
 *
 * Usage:
 *   node tools/montecarlo.mjs [--rounds 200000] [--policy ALL_WIDE] [--seed <hex>]
 */

import { createHash } from 'node:crypto';
import { F, Frac, toFixedExact } from './lib/exact.mjs';
import { CONFIG, CONTRACTS, POLICIES, laneSizes, survivorDistribution } from './lib/model.mjs';

/** Deterministic byte stream: SHA-256 in counter mode. */
export class ByteStream {
  /** @param {string} seedHex */
  constructor(seedHex) {
    this.seed = Buffer.from(seedHex, 'hex');
    this.counter = 0n;
    this.buffer = Buffer.alloc(0);
    this.offset = 0;
  }

  #refill() {
    const counterBytes = Buffer.alloc(8);
    counterBytes.writeBigUInt64BE(this.counter);
    this.counter += 1n;
    this.buffer = createHash('sha256').update(this.seed).update(counterBytes).digest();
    this.offset = 0;
  }

  /** @returns {number} uint32 */
  nextUint32() {
    if (this.offset + 4 > this.buffer.length) this.#refill();
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  /** Unbiased uniform integer in [0, modulus) by rejection. @param {number} modulus */
  nextBelow(modulus) {
    const limit = 0x100000000 - (0x100000000 % modulus);
    for (;;) {
      const value = this.nextUint32();
      if (value < limit) return value % modulus;
    }
  }
}

/**
 * Simulate one arena from first principles.
 * @param {ByteStream} rng
 * @param {'WIDE'|'SPLIT'|'NARROW'} contractId
 * @param {number} runners
 * @returns {number} survivors
 */
export function simulateArena(rng, contractId, runners) {
  const spec = CONTRACTS[contractId];
  const collapseDen = Number(spec.collapse.d);
  const collapseNum = Number(spec.collapse.n);
  const clearDen = Number(spec.clear.d);
  const clearNum = Number(spec.clear.n);
  let survivors = 0;
  for (const size of laneSizes(contractId, runners)) {
    const collapsed = rng.nextBelow(collapseDen) < collapseNum;
    for (let i = 0; i < size; i += 1) {
      const cleared = rng.nextBelow(clearDen) < clearNum;
      if (!collapsed && cleared) survivors += 1;
    }
  }
  return survivors;
}

/**
 * Simulate `rounds` complete rounds under a policy.
 * Money is tracked in micro-credits with exact rationals and floor rounding,
 * exactly as the settlement path does.
 * @param {(arena:number, alive:number)=>any} policy
 * @param {number} rounds
 * @param {string} seedHex
 * @param {bigint} stakeMicro
 */
export function simulate(policy, rounds, seedHex, stakeMicro = CONFIG.microCreditsPerCredit) {
  const rng = new ByteStream(seedHex);
  let creditedTotal = 0n;
  let busts = 0;
  let atLeastStake = 0;
  let best = 0n;

  for (let round = 0; round < rounds; round += 1) {
    let alive = CONFIG.squadSize;
    let claim = CONFIG.rtp;
    let credited = 0n;

    for (let arena = 1; arena <= CONFIG.arenas && alive > 0; arena += 1) {
      const action = policy(arena, alive);
      if (action.type === 'BANK') break;
      let running = alive;
      let contractId = 'WIDE';
      if (action.type === 'SHELTER') {
        const k = action.shelter;
        credited += claim.mul(F(BigInt(k), BigInt(alive))).mul(F(stakeMicro)).floor();
        claim = claim.mul(F(BigInt(alive - k), BigInt(alive)));
        running = alive - k;
      } else {
        contractId = action.contract;
      }
      const survivors = simulateArena(rng, contractId, running);
      const spec = CONTRACTS[contractId];
      const mu = Frac.ONE.div(Frac.ONE.sub(spec.collapse).mul(spec.clear));
      claim = claim.mul(F(BigInt(survivors), BigInt(running))).mul(mu);
      alive = survivors;
    }

    credited += claim.mul(F(stakeMicro)).floor();
    creditedTotal += credited;
    if (credited === 0n) busts += 1;
    if (credited >= stakeMicro) atLeastStake += 1;
    if (credited > best) best = credited;
  }

  const wagered = BigInt(rounds) * stakeMicro;
  return {
    rounds,
    wagered,
    creditedTotal,
    empiricalRtp: F(creditedTotal, wagered),
    bustRate: F(BigInt(busts), BigInt(rounds)),
    atLeastStakeRate: F(BigInt(atLeastStake), BigInt(rounds)),
    bestReturn: F(best, stakeMicro),
  };
}

/**
 * Cross-check a single arena's survivor distribution against the exact model.
 * @returns {{survivors:number, exact:Frac, empirical:Frac, absError:Frac}[]}
 */
export function crossCheckArena(contractId, runners, draws, seedHex) {
  const rng = new ByteStream(seedHex);
  const counts = new Array(runners + 1).fill(0);
  for (let i = 0; i < draws; i += 1) counts[simulateArena(rng, contractId, runners)] += 1;
  const exact = survivorDistribution(contractId, runners);
  return counts.map((count, m) => {
    const empirical = F(BigInt(count), BigInt(draws));
    const diff = empirical.sub(exact[m]);
    return { survivors: m, exact: exact[m], empirical, absError: diff.n < 0n ? diff.neg() : diff };
  });
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const rounds = Number(flag('--rounds', '200000'));
  const policyKey = flag('--policy', 'ALL_WIDE');
  const seed = flag('--seed', 'b7a11cf0d3e94a5586c2ef0913d4bb2f77e1c0aa4d5b9631f2e8c07a4d19b3e5');
  const policy = POLICIES[policyKey];
  if (!policy) {
    process.stderr.write(`Unknown policy ${policyKey}. Known: ${Object.keys(POLICIES).join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('BRANCHFALL — Monte Carlo cross-check (sanity only; the proof is tools/enumerate.mjs)\n');
  process.stdout.write('====================================================================================\n\n');

  process.stdout.write('Per-arena survivor distributions (1,000,000 draws each)\n');
  for (const [contractId, runners] of [
    ['WIDE', 5],
    ['SPLIT', 5],
    ['NARROW', 5],
  ]) {
    process.stdout.write(`  ${contractId}/${runners}\n`);
    for (const row of crossCheckArena(contractId, runners, 1_000_000, `${seed}`)) {
      process.stdout.write(
        `    m=${row.survivors}  exact=${toFixedExact(row.exact, 8)}  empirical=${toFixedExact(row.empirical, 8)}  |err|=${toFixedExact(row.absError, 8)}\n`,
      );
    }
  }

  process.stdout.write(`\nFull rounds under policy ${policyKey} (${policy.label})\n`);
  const result = simulate(policy.fn, rounds, seed);
  process.stdout.write(`  rounds            ${result.rounds}\n`);
  process.stdout.write(`  exact RTP         ${CONFIG.rtp} = ${toFixedExact(CONFIG.rtp, 8)}\n`);
  process.stdout.write(`  empirical RTP     ${toFixedExact(result.empiricalRtp, 8)}\n`);
  process.stdout.write(
    `  difference        ${toFixedExact(result.empiricalRtp.sub(CONFIG.rtp).n < 0n ? CONFIG.rtp.sub(result.empiricalRtp) : result.empiricalRtp.sub(CONFIG.rtp), 8)}\n`,
  );
  process.stdout.write(`  bust rate         ${toFixedExact(result.bustRate, 8)}\n`);
  process.stdout.write(`  P(credit >= 1x)   ${toFixedExact(result.atLeastStakeRate, 8)}\n`);
  process.stdout.write(`  best round        ${toFixedExact(result.bestReturn, 6)}x\n`);
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) main();
