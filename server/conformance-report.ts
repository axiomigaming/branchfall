/**
 * `npm run conformance` — the engine's own checks, run against this definition.
 *
 * Evidence, never certification (`ENGINE.md` §12). What it establishes is narrow
 * and worth having: the module this game is built on accepts the BRANCHFALL
 * declaration on the module's own terms — the fairness identity per contract, the
 * exact survivor law, stable lane geometry, an unreachable cap, a deterministic
 * tape in both seeds, a seed pre-commitment that opens, a transcript that round
 * trips, a snapshot that re-validates, and banking that loses no value.
 *
 * It also runs the game's own geometry proof, because the one thing the module
 * cannot check is whether its `laneWidth` cuts are the lane balances `docs/MATH.md`
 * declares.
 */
import { checkModuleConformance } from '@axiom-games/reveal-engine/conformance';
import { stagedSurvival } from '@axiom-games/reveal-engine/modules/staged-survival';
import { BRANCHFALL, FINGERPRINT, assertGeometryMatchesSpecification } from './definition.js';

assertGeometryMatchesSpecification();
const report = checkModuleConformance(stagedSurvival, BRANCHFALL);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, (_key, value) => (typeof value === 'bigint' ? String(value) : value), 2));
} else {
  console.log(`module      ${report.moduleId} ${report.moduleVersion}`);
  console.log(`definition  ${report.definitionId} ${report.definitionVersion}`);
  console.log(`fingerprint ${FINGERPRINT}`);
  console.log(`seeds       ${report.seeds}`);
  console.log('');
  for (const [code, count] of Object.entries(report.ran)) console.log(`  ran ${code} x${count}`);
  console.log('');
  for (const failure of report.failures) console.log(`  FAIL ${failure.code}: ${failure.message}`);
  console.log(
    report.ok
      ? `OK — ${Object.keys(report.ran).length} checks, 0 failures. Evidence, not certification.`
      : `FAILED — ${report.failures.length} failures`,
  );
}

process.exitCode = report.ok ? 0 : 1;
