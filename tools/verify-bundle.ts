/**
 * `npm run verify:bundle -- round.json` — check a round on any machine.
 *
 * `docs/DESIGN.md` §S8 offers the player a `Copy verification bundle` control and
 * promises the export verifies elsewhere. This is elsewhere. It shares nothing
 * with the server but the definition and the engine: no round state, no wallet,
 * no session — it takes a file and the published record inside it and re-derives
 * the whole round from the revealed seed, including every credited figure.
 *
 * A verifier that only checks the commitment proves the tape was honest and says
 * nothing about what the player was paid, so this one does both (`ENGINE.md` §5,
 * and the `LEDGER_MISMATCH` row of the §10 threat table).
 */
import { readFileSync } from 'node:fs';
import { verifyBundle } from '../server/verify.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run verify:bundle -- <bundle.json>');
  process.exitCode = 2;
} else {
  const report = verifyBundle(JSON.parse(readFileSync(file, 'utf8')));
  for (const check of report.checks)
    console.log(`${check.ok ? '  ok  ' : ' FAIL '} ${check.code.padEnd(15)} ${check.title}`);
  for (const check of report.checks) if (!check.ok) console.log(`\n  ${check.code}: ${check.detail}`);
  console.log(
    report.ok
      ? '\nVerified. Every credited figure was re-derived from the revealed seed.'
      : '\nNOT VERIFIED.',
  );
  process.exitCode = report.ok ? 0 : 1;
}
