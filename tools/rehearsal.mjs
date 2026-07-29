#!/usr/bin/env node
/**
 * The rehearsal round: BRANCHFALL's first-run teaching path, made executable.
 *
 * `docs/DESIGN.md` §5.2.3 specifies a free, unstaked, three-arena rehearsal that
 * runs the *real* model over a *published* seed pair, so that every player's
 * first three branches are the same and the teaching beats land where the design
 * says they land. A specification that only asserts "we pick a good seed" is not
 * buildable, so this file picks it, states the property it was picked for, and
 * lets CI re-derive it.
 *
 * The beats, on the default path (§5.2.5 offers WIDE first in arenas 1 and 2):
 *
 *   B1  arena 1, WIDE, 5 runners  -> all five clear      (the claim grows)
 *   B2  arena 2, WIDE, 5 runners  -> exactly three clear (two pips go dark)
 *   B3  arena 3, WIDE, 3 runners  -> nobody clears       (the other ending)
 *
 * and the derived money property the design leans on:
 *
 *   B4  banking after arena 2 returns LESS than the stake — the rehearsal never
 *       opens with a win.
 *
 * A player who chooses differently gets a different, equally real rehearsal.
 * That is not a defect: it is the fairness model demonstrated. The draws are
 * fixed for every route in advance; the player's choices only select which of
 * them are consumed.
 *
 * SAFETY. This seed pair is public and was chosen for its outcome. In a money
 * round that is precisely the attack `docs/ENGINE.md` §10.1 exists to prevent.
 * It is acceptable here for exactly one reason — the rehearsal has no stake, no
 * side bet, no wallet and no ledger entry — and it is therefore a hard build
 * rule that this pair is never usable for a real round, and that the rehearsal
 * is a separate entry point rather than a boolean on the money path
 * (`docs/DESIGN.md` §5.2.3, `docs/ENGINE.md` §10.2).
 *
 *   node tools/rehearsal.mjs            report the published rehearsal
 *   node tools/rehearsal.mjs --json     the frozen fixture, as JSON
 *   node tools/rehearsal.mjs --search   re-run the search that chose the pair
 */

import { F } from './lib/exact.mjs';
import { CONFIG, routeMultiplier } from './lib/model.mjs';
import { openRound, preCommit, resolveArena } from './transcript.mjs';

/** Arenas in the rehearsal. Three, not five (docs/DESIGN.md §5.2.3). */
export const REHEARSAL_ARENAS = 3;

/**
 * The published rehearsal seed pair. Found by `--search` over the client-seed
 * space below, frozen here, and re-verified by `tests/rehearsal.test.mjs`.
 *
 * The server seed is deliberately a recognisable non-secret: it must be obvious
 * on sight that this is not a live round's seed.
 */
export const REHEARSAL = Object.freeze({
  serverSeed: 'decafbad'.repeat(8),
  clientSeed: 'branchfall-rehearsal-00134',
  roundId: 'branchfall-rehearsal-v1',
});

/** The search space `--search` walks, so the choice is reproducible. */
export const SEARCH = Object.freeze({
  clientSeedPrefix: 'branchfall-rehearsal-',
  maxCandidates: 200_000,
});

/**
 * Derive a rehearsal from a seed pair and resolve the default path.
 * @returns {{published: object, hazard: object, arenas: object[], beats: object}}
 */
export function deriveRehearsal(pair = REHEARSAL) {
  const pre = preCommit(pair.serverSeed, pair.roundId);
  const { published, hazard } = openRound(pair.serverSeed, { seed: pair.clientSeed, respondingTo: pre.commitment }, pre);

  const arenas = [];
  let alive = Array.from({ length: CONFIG.squadSize }, (_, i) => i);
  // The claim opens at the first-entry RTP and rides at fair odds after that.
  let claim = CONFIG.rtp;

  for (let arena = 1; arena <= REHEARSAL_ARENAS && alive.length > 0; arena += 1) {
    const running = alive;
    const outcome = resolveArena(hazard, arena, 'WIDE', running, null);
    claim = claim.mul(F(BigInt(outcome.survivors.length), BigInt(running.length))).mul(routeMultiplier('WIDE'));
    arenas.push({
      arena,
      contract: 'WIDE',
      running: running.length,
      survivors: outcome.survivors.length,
      fallen: outcome.fallen.map((f) => ({ slot: f.slot, cause: f.cause })),
      collapsed: outcome.collapsed.some(Boolean),
      claimAfter: claim.toString(),
      claimAfterDecimal: claim.toNumber(),
    });
    alive = outcome.survivors;
  }

  const beats = {
    b1AllClearArena1: arenas[0]?.survivors === CONFIG.squadSize,
    b2ThreeClearArena2: arenas[1]?.survivors === 3,
    b3WipeArena3: arenas.length === REHEARSAL_ARENAS && arenas[2].survivors === 0,
    b4BankAfterArena2BelowStake: arenas.length >= 2 && F(...splitFraction(arenas[1].claimAfter)).lt(F(1n, 1n)),
  };
  beats.all = Object.values(beats).every(Boolean);
  return { published, hazard, arenas, beats };
}

/** `"a/b"` -> `[a, b]` as BigInts. */
function splitFraction(text) {
  const [n, d] = text.split('/');
  return [BigInt(n), BigInt(d)];
}

/** Walk the declared search space for a pair satisfying every beat. */
export function search({ limit = SEARCH.maxCandidates, onProgress } = {}) {
  for (let i = 0; i < limit; i += 1) {
    const clientSeed = `${SEARCH.clientSeedPrefix}${String(i).padStart(5, '0')}`;
    // No try/catch: a derivation that throws is a bug in the model or in the
    // seed space, not a candidate to skip past quietly.
    const pair = { ...REHEARSAL, clientSeed };
    const result = deriveRehearsal(pair);
    if (result.beats.all) return { pair, result, candidatesTried: i + 1 };
    if (onProgress && i > 0 && i % 5_000 === 0) onProgress(i);
  }
  return null;
}

/** The frozen, publishable description of the rehearsal. */
export function buildRehearsalFixture() {
  const { published, arenas, beats } = deriveRehearsal();
  return {
    schema: 'branchfall/rehearsal-v1',
    note:
      'Public seed pair for the unstaked first-run rehearsal (docs/DESIGN.md §5.2.3). ' +
      'Never usable for a real round: no stake, no side bet, no wallet, no ledger.',
    seeds: REHEARSAL,
    arenas: REHEARSAL_ARENAS,
    published,
    path: arenas,
    beats,
  };
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--search')) {
    const found = search({ onProgress: (i) => process.stderr.write(`  ...${i} candidates\n`) });
    if (!found) {
      process.stderr.write('no seed pair in the declared search space satisfies every beat\n');
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `found after ${found.candidatesTried} candidates\n  clientSeed: ${found.pair.clientSeed}\n` +
        found.result.arenas
          .map((a) => `  arena ${a.arena}: ${a.running} ran, ${a.survivors} cleared, claim ${a.claimAfter}\n`)
          .join(''),
    );
    return;
  }

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(buildRehearsalFixture(), null, 2)}\n`);
    return;
  }

  const { arenas, beats } = deriveRehearsal();
  process.stdout.write('BRANCHFALL rehearsal — public seed pair, no stake, no payout\n\n');
  process.stdout.write(`  server seed  ${REHEARSAL.serverSeed}\n`);
  process.stdout.write(`  client seed  ${REHEARSAL.clientSeed}\n`);
  process.stdout.write(`  round id     ${REHEARSAL.roundId}\n\n`);
  process.stdout.write('  The default path (WIDE every arena, which §5.2.5 offers first):\n');
  for (const a of arenas) {
    process.stdout.write(
      `    arena ${a.arena}: ${a.running} ran, ${a.survivors} cleared` +
        `${a.collapsed ? ' (the branch went)' : ''} — claim ${a.claimAfter} = ${a.claimAfterDecimal.toFixed(6)}x stake\n`,
    );
  }
  process.stdout.write('\n  Teaching beats (docs/DESIGN.md §5.2.3):\n');
  for (const [name, ok] of Object.entries(beats)) {
    if (name === 'all') continue;
    process.stdout.write(`    ${ok ? 'OK  ' : 'FAIL'} ${name}\n`);
  }
  process.stdout.write(
    `\n  ${beats.all ? 'Every beat holds.' : 'A beat does not hold — re-run --search.'}\n` +
      '  A player who chooses a different route gets a different, equally real\n' +
      '  rehearsal. The draws were fixed for every route before the first choice.\n',
  );
  if (!beats.all) process.exitCode = 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) main();
