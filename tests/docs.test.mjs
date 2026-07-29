/**
 * Every published number must be a number the model computes.
 *
 * The v1 draft bound only the generated tables in docs/MATH.md. That left
 * docs/DESIGN.md — the document the client is actually built from — free to
 * carry hand-written figures, and free to carry at least one mechanical claim
 * the model contradicts. Both classes of drift are now build failures.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFigures, buildTables } from '../tools/enumerate.mjs';
import { extractTable, listFigures } from '../tools/lib/doctables.mjs';
import { FIGURE_DOCS, planDocuments, referencedFigures } from '../tools/sync-docs.mjs';
import { CONFIG, sideBetTable, survivorDistribution } from '../tools/lib/model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const mathDoc = read('docs/MATH.md');
const designDoc = read('docs/DESIGN.md');
const engineDoc = read('docs/ENGINE.md');
const readme = read('README.md');
const tables = buildTables();
const figures = buildFigures();

describe('docs/MATH.md publishes exactly what the enumerator computes', () => {
  for (const [name, body] of Object.entries(tables)) {
    it(`table:${name} matches row for row`, () => {
      const published = extractTable(mathDoc, name);
      expect(published, `docs/MATH.md is missing the <!-- table:${name} --> slot`).not.toBeNull();
      const expectedLines = body.split('\n');
      const actualLines = published.split('\n');
      expect(actualLines.length, `${name}: row count`).toBe(expectedLines.length);
      for (let i = 0; i < expectedLines.length; i += 1) {
        expect(actualLines[i], `${name}: row ${i}`).toBe(expectedLines[i]);
      }
    });
  }

  it('publishes every enumerated outcome and no extra ones', () => {
    const rows = extractTable(mathDoc, 'outcomes').split('\n').slice(2);
    expect(rows.length).toBe(69);
    for (const line of rows) {
      const cells = line.split('|').map((c) => c.trim());
      const [, contract, n, balance, m, probability] = cells;
      const laneSplit = balance.includes('+') ? Number(balance.split('+')[0]) : null;
      const exact = survivorDistribution(contract, Number(n), laneSplit)[Number(m)];
      expect(probability, `${contract}/${n}/${balance}/${m}`).toBe(`\`${exact}\``);
    }
  });

  it('publishes a side-bet table in which every RTP is the target', () => {
    const rows = extractTable(mathDoc, 'sidebets').split('\n').slice(2);
    expect(rows.length).toBe(sideBetTable().length);
    for (const line of rows) {
      const cells = line.split('|').map((c) => c.trim());
      expect(cells[cells.length - 2]).toBe(`\`${CONFIG.rtp}\``);
    }
  });

  it('publishes a policy table and a portfolio table in which every RTP is the target', () => {
    for (const name of ['policies', 'portfolios']) {
      const rows = extractTable(mathDoc, name).split('\n').slice(2);
      expect(rows.length, name).toBeGreaterThan(0);
      for (const line of rows) {
        expect(line, `${name}: ${line}`).toContain(`\`${CONFIG.rtp}\``);
      }
    }
  });
});

describe('every inline figure in every document is generated', () => {
  it('has no stale, unknown or missing slot anywhere', () => {
    for (const entry of planDocuments()) {
      const name = relative(root, entry.path);
      expect(entry.missingTables, `${name}: missing tables`).toEqual([]);
      expect(entry.unknownFigures, `${name}: figures the enumerator does not publish`).toEqual([]);
      expect(entry.staleFigures, `${name}: stale figures — run npm run docs:sync`).toEqual([]);
      expect(entry.staleTables, `${name}: stale tables — run npm run docs:sync`).toEqual([]);
      expect(entry.updated, `${name}: content drift`).toBe(entry.original);
    }
  });

  it('binds figures in all four managed documents, not just MATH.md', () => {
    expect(FIGURE_DOCS.length).toBe(4);
    for (const path of FIGURE_DOCS) {
      const found = listFigures(readFileSync(path, 'utf8'));
      expect(found.length, `${relative(root, path)} carries no generated figures`).toBeGreaterThan(0);
    }
  });

  it('binds the numbers DESIGN.md would otherwise hand-write', () => {
    const used = new Set(listFigures(designDoc).map((f) => f.name));
    for (const name of [
      'splitWipe5',
      'scoutWipe5',
      'wideWipe5',
      'narrowWipe5',
      'splitSaferRatio5',
      'wideExpectedSurvivors5',
      'splitFallen5',
      'wideFallen5',
      'cleanSweepMax',
      'soleSurvivorMax',
      'lastLightMax',
      'balancedKeep4Plus5',
      'scoutKeep4Plus5',
      'minCycleMs',
    ]) {
      expect(used, `DESIGN.md should bind ${name}`).toContain(name);
    }
  });

  it('references at least forty distinct figures across the documents', () => {
    expect(referencedFigures().size).toBeGreaterThanOrEqual(40);
  });

  it('never references a figure the enumerator does not publish', () => {
    for (const name of referencedFigures()) {
      expect(Object.prototype.hasOwnProperty.call(figures, name), `unknown figure ${name}`).toBe(true);
    }
  });
});

describe('cross-document consistency', () => {
  it('states the same adapter and model versions everywhere', () => {
    expect(engineDoc).toContain(`\`${CONFIG.adapterVersion}\``);
    expect(engineDoc).toContain(CONFIG.modelVersion);
    expect(designDoc).not.toContain('branchfall-hazard/v1');
    expect(readme).not.toContain('branchfall-hazard/v1');
  });

  it('describes the cap on its per-ticket basis, never as a per-round pot', () => {
    expect(mathDoc).toContain('applied per ticket, against that ticket');
    expect(readme).toContain("per ticket, against that ticket's own stake");
    expect(engineDoc).toContain("capBasis: 'per-ticket'");
    // The v1 phrasing was the blocker. It must not survive anywhere.
    for (const [name, doc] of Object.entries({ mathDoc, readme, designDoc, engineDoc })) {
      expect(doc, name).not.toMatch(/chain cap across every credit event in a round/);
    }
  });

  it('documents the client seed as mandatory, not optional', () => {
    expect(engineDoc).toContain('Always accept from the client');
    expect(engineDoc).not.toMatch(/\*\*Never accept from a client:\*\* a seed/);
    expect(readme).toContain('client seed');
    expect(designDoc).toContain('client seed');
  });

  it('ranks operator seed selection as the top threat', () => {
    const table = engineDoc.slice(engineDoc.indexOf('## 10. Threat model'));
    const firstRow = table.split('\n').find((l) => l.startsWith('| **Operator'));
    expect(firstRow).toContain('seed grinding');
    expect(firstRow).toContain('highest');
    // And the v1 mis-ranking must be gone.
    expect(engineDoc).not.toMatch(/single highest-severity failure mode in this design/);
  });

  it('declares the side-bet stake limits in all three places that need them', () => {
    expect(mathDoc).toContain('Maximum per round, all side bets');
    expect(designDoc).toContain('Maximum, per round, all side bets together');
    expect(engineDoc).toContain('maxTotalSideBetStakeRatio');
    expect(readme).toContain('never more than the route stake');
  });

  it('states the minimum game cycle and names its unit', () => {
    for (const [name, doc] of Object.entries({ designDoc, engineDoc, readme })) {
      expect(doc, name).toContain('2500');
    }
    expect(designDoc).toContain('The game cycle is the arena, not the round');
    expect(engineDoc).toContain("cycleUnit: 'arena'");
  });
});
