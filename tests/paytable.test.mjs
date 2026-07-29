/**
 * The published paytable in docs/MATH.md must match the enumeration exactly.
 *
 * This is the test that makes the documentation trustworthy: a tuning change
 * that is not re-published breaks the build, and a documentation edit that
 * invents a number breaks the build.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTables } from '../tools/enumerate.mjs';
import { extractTable } from '../tools/lib/doctables.mjs';
import { CONFIG, sideBetTable, survivorDistribution } from '../tools/lib/model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mathDoc = readFileSync(resolve(root, 'docs/MATH.md'), 'utf8');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const engineDoc = readFileSync(resolve(root, 'docs/ENGINE.md'), 'utf8');
const designDoc = readFileSync(resolve(root, 'docs/DESIGN.md'), 'utf8');
const tables = buildTables();

describe('docs/MATH.md publishes exactly what the enumerator computes', () => {
  for (const [name, body] of Object.entries(tables)) {
    it(`table:${name} matches row for row`, () => {
      const published = extractTable(mathDoc, name);
      expect(published, `docs/MATH.md is missing the <!-- table:${name} --> slot`).not.toBeNull();
      // Compare line by line so a diff points at the offending row.
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
    let expected = 0;
    for (const line of rows) {
      const [, contract, n, m, probability] = line.split('|').map((c) => c.trim());
      const exact = survivorDistribution(contract, Number(n))[Number(m)];
      expect(probability, `${contract}/${n}/${m}`).toBe(`\`${exact}\``);
      expected += 1;
    }
    expect(expected).toBe(58);
  });

  it('publishes a side-bet table in which every RTP is the target', () => {
    const rows = extractTable(mathDoc, 'sidebets').split('\n').slice(2);
    expect(rows.length).toBe(sideBetTable().length);
    for (const line of rows) {
      const cells = line.split('|').map((c) => c.trim());
      expect(cells[cells.length - 2]).toBe(`\`${CONFIG.rtp}\``);
    }
  });

  it('publishes a policy table in which every RTP is the target', () => {
    const rows = extractTable(mathDoc, 'policies').split('\n').slice(2);
    expect(rows.length).toBe(8);
    for (const line of rows) {
      const cells = line.split('|').map((c) => c.trim());
      expect(cells[3]).toBe(`\`${CONFIG.rtp}\``);
      expect(cells[4]).toBe('95.5000');
    }
  });
});

describe('prose figures agree with the model', () => {
  it('states the target RTP consistently across every document', () => {
    for (const [name, doc] of Object.entries({ readme, mathDoc, engineDoc, designDoc })) {
      expect(doc, name).toMatch(/95\.5/);
    }
    expect(mathDoc).toMatch(/191\/200/);
    expect(readme).toMatch(/191\/200/);
    expect(engineDoc).toMatch(/191n\/200n/);
  });

  it('states the max payout and the cap consistently', () => {
    for (const [name, doc] of Object.entries({ readme, mathDoc })) {
      expect(doc, name).toContain('24448/25');
      expect(doc, name).toMatch(/977\.92/);
      expect(doc, name).toMatch(/1000x|1000\.000000|maxWinMultiple/);
    }
  });

  it('states the biggest side-bet multiplier consistently', () => {
    expect(mathDoc).toContain('97792/105');
    expect(readme).toContain('97792/105');
    expect(readme).toMatch(/931\.35/);
  });

  it('never claims certification anywhere', () => {
    for (const [name, doc] of Object.entries({ readme, mathDoc, engineDoc, designDoc })) {
      expect(doc.toLowerCase(), name).not.toMatch(/\bcertified\b/);
      expect(doc.toLowerCase(), name).not.toMatch(/\bregulator(y)? approved\b/);
      expect(doc.toLowerCase(), name).not.toMatch(/\bguaranteed (win|payout)\b/);
    }
    expect(readme.toLowerCase()).toMatch(/certification.*none claimed/);
    expect(mathDoc).toMatch(/Certification boundary/);
    expect(engineDoc).toMatch(/Certification boundary/);
  });

  it('never frames the game as skill-based', () => {
    // The player-facing README must not use skill vocabulary at all.
    expect(readme).not.toMatch(/\b(outplay|beat the odds|skill-based|master the odds)\b/i);
    expect(readme).toMatch(/no skill/i);
    expect(designDoc).toMatch(/zero fake agency/i);
    // DESIGN.md is allowed to name the banned words exactly once, in the rule that bans them.
    expect(designDoc).toMatch(/forbidden from using/);
    expect(designDoc.match(/outplay/gi) ?? []).toHaveLength(1);
    expect(designDoc.match(/beat the odds/gi) ?? []).toHaveLength(1);
  });

  it('keeps the responsible-design commitments in DESIGN.md', () => {
    for (const requirement of [
      'No loss-chasing mechanics',
      'No misleading skill framing',
      'No latency-sensitive money decisions',
      'No countdown on any decision',
      'not insurance',
      'off by default',
    ]) {
      expect(designDoc, requirement).toContain(requirement);
    }
  });

  it('keeps the originality guard in DESIGN.md and the README', () => {
    expect(designDoc).toMatch(/Originality guard/);
    expect(readme).toMatch(/no third-party intellectual property/i);
    for (const [name, doc] of Object.entries({ readme, designDoc, mathDoc, engineDoc })) {
      expect(doc.toLowerCase(), name).not.toContain('fall guys');
    }
  });
});
