/**
 * The enumerator is the proof, so the enumerator itself is under test.
 *
 * These assertions are deliberately independent of the ones inside
 * `runInvariants()`: if the enumerator ever stopped asserting something, this
 * file would still notice, because it re-derives the headline claims from the
 * model rather than reading the enumerator's own verdict.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildFigures,
  buildTables,
  contractRows,
  geometryRows,
  maxPayoutMultiple,
  outcomeRows,
  policyRows,
  portfolioRows,
  runInvariants,
} from '../tools/enumerate.mjs';
import { CONFIG, POLICIES, SIDE_BET_PLANS, capAnalysis, sideBetTable } from '../tools/lib/model.mjs';
import { F } from '../tools/lib/exact.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('the enumeration is the proof', () => {
  const { checks, failures } = runInvariants();

  it('checks a substantial number of exact invariants and fails none', () => {
    expect(checks.length).toBeGreaterThanOrEqual(1000);
    expect(failures).toEqual([]);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it('covers the four obligations the v1 draft left open', () => {
    const text = checks.map((c) => c.description).join('\n');
    // 1. the cap, over the round total and not only per ticket
    expect(text).toMatch(/max round total .* is strictly below the cap/);
    // 2. side bets priced against the committed geometry, not a contract id
    expect(text).toMatch(/probability matches the arena's own branch table/);
    // 3. portfolios, not only route-ticket policies
    expect(text).toMatch(/portfolio .*E\[credited\]\/E\[staked\] is exactly the target RTP/);
    // 4. lane balance is a shape lever and never an odds lever
    expect(text).toMatch(/P\(all clear\) is identical across lane balances/);
  });

  it('checks the speed-of-play floor and the coherence of the stake limits', () => {
    const text = checks.map((c) => c.description).join('\n');
    expect(text).toMatch(/is at least 5000 ms \(UKGC RTS 14G, non-slot\)/);
    expect(text).toMatch(/a single side bet cannot exceed the round-wide side-bet allowance/);
  });
});

describe('derived row sets', () => {
  it('reports every contract once', () => {
    expect(contractRows().map((r) => r.id)).toEqual(['WIDE', 'SPLIT', 'NARROW']);
  });

  it('reports 16 geometries, each a probability distribution with stage RTP 1', () => {
    const rows = geometryRows();
    expect(rows.length).toBe(16);
    for (const row of rows) {
      expect(row.total.toString()).toBe('1/1');
      expect(row.fairness.toString()).toBe('1/1');
    }
    expect(rows.filter((r) => r.contract === 'SPLIT' && r.runners === 5).length).toBe(2);
  });

  it('reports one outcome row per (geometry, survivor count)', () => {
    const rows = outcomeRows();
    expect(rows.length).toBe(geometryRows().reduce((s, g) => s + g.runners + 1, 0));
    expect(rows.length).toBe(69);
  });

  it('reports every named policy at exactly the target RTP', () => {
    const rows = policyRows();
    expect(rows.length).toBe(Object.keys(POLICIES).length);
    for (const row of rows) {
      expect(row.rtp.toString()).toBe(CONFIG.rtp.toString());
      expect(row.totalProbability.toString()).toBe('1/1');
      expect(row.maxReturn.lt(F(CONFIG.maxWinMultiple))).toBe(true);
    }
  });

  it('reports every portfolio at exactly the target RTP', () => {
    const rows = portfolioRows();
    expect(rows.length).toBe(Object.keys(POLICIES).length * Object.keys(SIDE_BET_PLANS).length);
    expect(rows.length).toBe(45);
    for (const row of rows) expect(row.rtp.toString()).toBe(CONFIG.rtp.toString());
  });

  it('agrees with the model on the cap', () => {
    expect(maxPayoutMultiple().toString()).toBe(capAnalysis().routeTicketMax.toString());
  });
});

describe('generated tables', () => {
  const tables = buildTables();

  it('publishes every table slot the docs consume', () => {
    expect(Object.keys(tables).sort()).toEqual([
      'contracts',
      'dominance',
      'geometries',
      'invariants',
      'outcomes',
      'policies',
      'portfolios',
      'sidebets',
      'wipes',
    ]);
  });

  it('emits well-formed markdown with a header and a rule', () => {
    for (const [name, body] of Object.entries(tables)) {
      const lines = body.split('\n');
      expect(lines.length, name).toBeGreaterThan(2);
      expect(lines[0].startsWith('|'), name).toBe(true);
      expect(lines[1], name).toMatch(/^\|( --- \|)+$/);
      const columns = lines[0].split('|').length;
      for (const line of lines) expect(line.split('|').length, `${name}: ragged row`).toBe(columns);
    }
  });

  it('publishes a side-bet row per (event, geometry)', () => {
    expect(tables.sidebets.split('\n').length - 2).toBe(sideBetTable().length);
  });
});

describe('generated figures', () => {
  const figures = buildFigures();

  it('publishes only strings, none of them empty', () => {
    for (const [name, value] of Object.entries(figures)) {
      expect(typeof value, name).toBe('string');
      expect(value.length, name).toBeGreaterThan(0);
    }
  });

  it('renders the headline numbers the documents lead with', () => {
    expect(figures.rtpPct).toBe('95.5%');
    expect(figures.wideWipe5).toBe('4.00%');
    expect(figures.splitWipe5).toBe('1.30%');
    expect(figures.scoutWipe5).toBe('2.52%');
    expect(figures.narrowWipe5).toBe('51.56%');
    expect(figures.splitSaferRatio5).toBe('3.07x');
    expect(figures.routeTicketMax).toBe('977.92x');
    expect(figures.soleSurvivorMax).toBe('931.35x');
    expect(figures.capMultiple).toBe('1000x');
    expect(figures.topPrizeOdds).toBe('1 in 1,073,741,824');
    expect(figures.minCycleMs).toBe('5000');
    expect(figures.hazardDraws).toBe('120');
  });

  it('keeps the cap figures strictly under the cap', () => {
    for (const key of ['routeTicketMax', 'maxTicketMultiple', 'maxRoundRatio', 'ratioMaxSideBets']) {
      expect(Number.parseFloat(figures[key]), key).toBeLessThan(1000);
    }
  });

  it('reports the invariant count it actually ran', () => {
    expect(Number(figures.invariantCount)).toBe(runInvariants().checks.length);
  });
});

describe('the CLI', () => {
  const run = (args) =>
    execFileSync(process.execPath, [resolve(root, 'tools/enumerate.mjs'), ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

  it('exits zero and reports the invariant count', () => {
    expect(run(['--quiet'])).toBe('');
  });

  it('emits markdown containing every slot marker', () => {
    const out = run(['--markdown']);
    for (const name of Object.keys(buildTables())) expect(out).toContain(`<!-- table:${name} -->`);
  });

  it('emits parseable JSON with the cap analysis and the figures', () => {
    const parsed = JSON.parse(run(['--json']));
    expect(parsed.failures).toEqual([]);
    expect(parsed.cap.maxTicketMultiple).toBe('24448/25');
    expect(parsed.figures.rtpPct).toBe('95.5%');
    expect(parsed.geometries.length).toBe(16);
    expect(parsed.portfolios.length).toBe(45);
  });

  it('emits every figure in --figures mode', () => {
    const out = run(['--figures']);
    for (const name of Object.keys(buildFigures())) expect(out).toContain(name);
  });

  it('prints the human report with the cap section', () => {
    const out = run([]);
    expect(out).toContain('MAX-WIN CAP — per ticket, and over the round total');
    expect(out).toContain('ROUTE GEOMETRIES');
    expect(out).toContain('PORTFOLIOS');
    expect(out).toMatch(/OK — \d+ exact invariants checked, 0 failed/);
  });
});
