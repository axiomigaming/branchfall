#!/usr/bin/env node
/**
 * Re-publish the enumerated paytable into docs/MATH.md.
 *
 * The enumerator is the source of truth. This script pushes its exact tables
 * into the document, and `tests/paytable.test.mjs` fails if the two ever drift.
 * Run it after any change to `tools/lib/model.mjs`.
 *
 *   node tools/sync-docs.mjs           write docs/MATH.md in place
 *   node tools/sync-docs.mjs --check   exit non-zero if the doc is stale
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildTables } from './enumerate.mjs';
import { extractTable, spliceTable } from './lib/doctables.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const MATH_DOC = resolve(here, '..', 'docs', 'MATH.md');

function main() {
  const checkOnly = process.argv.includes('--check');
  const tables = buildTables();
  const original = readFileSync(MATH_DOC, 'utf8');
  let updated = original;
  const stale = [];

  for (const [name, body] of Object.entries(tables)) {
    const current = extractTable(updated, name);
    if (current === null) {
      process.stderr.write(`docs/MATH.md is missing the slot <!-- table:${name} -->\n`);
      process.exitCode = 1;
      return;
    }
    if (current !== body) stale.push(name);
    updated = spliceTable(updated, name, body);
  }

  if (checkOnly) {
    if (stale.length > 0) {
      process.stderr.write(`docs/MATH.md is stale: ${stale.join(', ')}\nRun: npm run docs:sync\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write('docs/MATH.md matches the enumeration.\n');
    return;
  }

  if (updated !== original) {
    writeFileSync(MATH_DOC, updated);
    process.stdout.write(`docs/MATH.md updated (${stale.join(', ') || 'formatting'}).\n`);
  } else {
    process.stdout.write('docs/MATH.md already up to date.\n');
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) main();
