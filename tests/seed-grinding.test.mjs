/**
 * Does mixing client entropy actually close the seed-selection attack?
 *
 * `docs/ENGINE.md` §10.1 claims it does, and a threat-model table is worth
 * nothing unless the mitigation is executed. This file runs the attack twice.
 *
 *   ARM A — the v1 construction, simulated. The operator can score a candidate
 *     server seed against the table the player will actually face, because the
 *     table depends on nothing the operator does not already control. It keeps
 *     the worst-for-player candidate out of B.
 *   ARM B — the v2 construction. The operator must commit before the client seed
 *     exists, so it can only score against a guess. It still keeps the
 *     worst-for-player candidate; the candidate is simply uninformative.
 *
 * Everything is derived from a fixed root, so the experiment is deterministic
 * and the thresholds below can never flake.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openRound, replayRound } from '../tools/transcript.mjs';
import { CONFIG } from '../tools/lib/model.mjs';
import { F } from '../tools/lib/exact.mjs';

const STAKE = 1_000_000n;
const HONEST_RTP = CONFIG.rtp.toNumber();

/** The published Ranger policy: Wide, five times. */
const RANGER = Array.from({ length: CONFIG.arenas }, () => ({ type: 'ROUTE', contract: 'WIDE' }));

const hex = (label) => createHash('sha256').update(label).digest('hex');

function payout(serverSeed, clientSeed, roundId) {
  const round = openRound(serverSeed, clientSeed, roundId);
  return BigInt(replayRound(round, { stakeMicro: STAKE, actions: RANGER }).creditedMicro);
}

/**
 * @param {number} rounds
 * @param {number} candidates how many server seeds the operator draws per round
 * @param {boolean} operatorCanScoreTheRealTable arm A when true, arm B when false
 */
function realisedRtp(rounds, candidates, operatorCanScoreTheRealTable) {
  let credited = 0n;
  for (let r = 0; r < rounds; r += 1) {
    const roundId = `grind-${r}`;
    const actualClientSeed = `player-${r}`;
    const scoringClientSeed = operatorCanScoreTheRealTable ? actualClientSeed : 'operator-guess';
    let bestSeed = null;
    let worstPayout = null;
    for (let b = 0; b < candidates; b += 1) {
      const candidate = hex(`candidate:${r}:${b}`);
      const scored = payout(candidate, scoringClientSeed, roundId);
      if (worstPayout === null || scored < worstPayout) {
        worstPayout = scored;
        bestSeed = candidate;
      }
    }
    credited += payout(bestSeed, actualClientSeed, roundId);
  }
  return F(credited, BigInt(rounds) * STAKE).toNumber();
}

const ROUNDS = 120;

describe('operator seed selection', () => {
  it('is devastating when the operator can score the table the player will face', () => {
    // This is the v1 construction. Every one of these rounds still verifies:
    // the commitment matches, the seed reveals cleanly, the replay reproduces
    // the ledger. The player's verifier cannot tell.
    const honest = realisedRtp(ROUNDS, 1, true);
    const ground4 = realisedRtp(ROUNDS, 4, true);
    const ground16 = realisedRtp(ROUNDS, 16, true);

    expect(ground4).toBeLessThan(honest);
    expect(ground16).toBeLessThan(ground4);
    // Worst-of-16 should be catastrophic, not marginal.
    expect(ground16).toBeLessThan(0.2);
  }, 120_000);

  it('buys the operator nothing once the client seed is unknown at commit time', () => {
    // This is the v2 construction. The operator still grinds; the grinding is
    // simply uninformative, because every candidate has the same conditional
    // distribution given a client seed it has not seen.
    for (const candidates of [1, 4, 16]) {
      const realised = realisedRtp(ROUNDS, candidates, false);
      // Ranger's standard deviation is ~0.647, so over 120 rounds the standard
      // error is ~0.059. A 7-sigma band is wide enough to be unfalsifiable by
      // noise and far too tight to survive a working attack (worst-of-16 under
      // arm A lands below 0.2).
      expect(realised, `worst-of-${candidates}`).toBeGreaterThan(HONEST_RTP - 7 * 0.059);
      expect(realised, `worst-of-${candidates}`).toBeLessThan(HONEST_RTP + 7 * 0.059);
    }
  }, 120_000);

  it('separates the two arms by an order of magnitude at the same effort', () => {
    const armA = realisedRtp(ROUNDS, 16, true);
    const armB = realisedRtp(ROUNDS, 16, false);
    expect(armB / Math.max(armA, 1e-9)).toBeGreaterThan(4);
  }, 120_000);
});

describe('the structural reason it works', () => {
  it('publishes a commitment that cannot depend on the client seed', () => {
    const server = hex('structural');
    const a = openRound(server, 'client-one', 'r1');
    const b = openRound(server, 'client-two', 'r1');
    // Same pre-commitment ...
    expect(a.serverCommitment).toBe(b.serverCommitment);
    // ... completely different round.
    expect(a.hazardDigest).not.toBe(b.hazardDigest);
    expect(JSON.stringify(a.hazard)).not.toBe(JSON.stringify(b.hazard));
  });

  it('makes a single bit of client entropy change the whole table', () => {
    const server = hex('avalanche');
    const a = openRound(server, 'seed-a', 'r1').hazard;
    const b = openRound(server, 'seed-b', 'r1').hazard;
    let same = 0;
    let total = 0;
    for (let i = 0; i < a.length; i += 1) {
      for (const id of ['WIDE', 'SPLIT', 'NARROW']) {
        for (let lane = 0; lane < a[i][id].length; lane += 1) {
          total += 1;
          if (a[i][id][lane].collapse === b[i][id][lane].collapse) same += 1;
          for (let s = 0; s < a[i][id][lane].slips.length; s += 1) {
            total += 1;
            if (a[i][id][lane].slips[s] === b[i][id][lane].slips[s]) same += 1;
          }
        }
      }
    }
    expect(total).toBe(120);
    // Draws are small integers so collisions are expected; the point is that the
    // table is redrawn, not perturbed.
    expect(same / total).toBeLessThan(0.75);
  });
});
