#!/usr/bin/env node
/**
 * Re-publish the enumerated paytable and every generated figure into the docs.
 *
 * The enumerator is the source of truth. This script pushes its exact tables
 * into `docs/MATH.md` and its inline figures into every document, and
 * `tests/paytable.test.mjs` fails if any of them ever drift.
 *
 * The v1 draft bound only MATH.md's tables. That let `docs/DESIGN.md` — the
 * document the client actually gets built from — carry hand-written numbers and
 * at least one mechanical claim the model does not support. Every load-bearing
 * number in the prose is now a generated figure slot.
 *
 *   node tools/sync-docs.mjs           write the documents in place
 *   node tools/sync-docs.mjs --check   exit non-zero if any document is stale
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';
import { buildFigures, buildTables } from './enumerate.mjs';
import { extractTable, listFigures, spliceFigures, spliceTable } from './lib/doctables.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..');
export const MATH_DOC = resolve(ROOT, 'docs', 'MATH.md');

/** Documents that carry generated figure slots. */
export const FIGURE_DOCS = Object.freeze([
  resolve(ROOT, 'README.md'),
  resolve(ROOT, 'docs', 'DESIGN.md'),
  resolve(ROOT, 'docs', 'MATH.md'),
  resolve(ROOT, 'docs', 'ENGINE.md'),
]);

/**
 * Compute the desired content of every managed document.
 * @returns {{path: string, original: string, updated: string, staleTables: string[], staleFigures: string[], unknownFigures: string[], missingTables: string[]}[]}
 */
export function planDocuments() {
  const tables = buildTables();
  const figures = buildFigures();
  const plan = [];

  for (const path of FIGURE_DOCS) {
    const original = readFileSync(path, 'utf8');
    let updated = original;
    const staleTables = [];
    const missingTables = [];

    if (path === MATH_DOC) {
      for (const [name, body] of Object.entries(tables)) {
        const current = extractTable(updated, name);
        if (current === null) {
          missingTables.push(name);
          continue;
        }
        if (current !== body) staleTables.push(name);
        updated = spliceTable(updated, name, body);
      }
    }

    const spliced = spliceFigures(updated, figures);
    plan.push({
      path,
      original,
      updated: spliced.text,
      staleTables,
      missingTables,
      staleFigures: [...new Set(spliced.stale)],
      unknownFigures: [...new Set(spliced.unknown)],
    });
  }

  return plan;
}

/** Every figure name referenced anywhere in the managed documents. */
export function referencedFigures() {
  const names = new Set();
  for (const path of FIGURE_DOCS) {
    for (const fig of listFigures(readFileSync(path, 'utf8'))) names.add(fig.name);
  }
  return names;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const plan = planDocuments();
  let failed = false;
  const written = [];

  for (const entry of plan) {
    const name = relative(ROOT, entry.path);
    if (entry.missingTables.length > 0) {
      process.stderr.write(`${name} is missing table slots: ${entry.missingTables.join(', ')}\n`);
      failed = true;
    }
    if (entry.unknownFigures.length > 0) {
      process.stderr.write(
        `${name} references figures the enumerator does not publish: ${entry.unknownFigures.join(', ')}\n`,
      );
      failed = true;
    }
    if (checkOnly) {
      if (entry.staleTables.length > 0) {
        process.stderr.write(`${name} has stale tables: ${entry.staleTables.join(', ')}\n`);
        failed = true;
      }
      if (entry.staleFigures.length > 0) {
        process.stderr.write(`${name} has stale figures: ${entry.staleFigures.join(', ')}\n`);
        failed = true;
      }
    } else if (entry.updated !== entry.original) {
      writeFileSync(entry.path, entry.updated);
      written.push(
        `${name} (${[...entry.staleTables, ...entry.staleFigures].join(', ') || 'formatting'})`,
      );
    }
  }

  if (failed) {
    process.stderr.write('\nRun: npm run docs:sync\n');
    process.exitCode = 1;
    return;
  }
  if (checkOnly) {
    process.stdout.write(
      `Documents match the enumeration (${referencedFigures().size} figure slots, ${Object.keys(buildTables()).length} tables).\n`,
    );
    return;
  }
  process.stdout.write(written.length > 0 ? `Updated: ${written.join('; ')}\n` : 'Documents already up to date.\n');
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) main();
