import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTables,
  contractRows,
  largestSideBetMultiplier,
  maxPayoutMultiple,
  outcomeRows,
  policyRows,
  runInvariants,
  shapeRows,
} from '../tools/enumerate.mjs';
import { CONFIG } from '../tools/lib/model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('the enumeration is the proof', () => {
  const { checks, failures } = runInvariants();

  it('checks a substantial number of exact invariants', () => {
    expect(checks.length).toBeGreaterThanOrEqual(400);
  });

  it('fails none of them', () => {
    expect(failures).toEqual([]);
  });

  it('covers every category of obligation', () => {
    const text = checks.map((c) => c.description).join('\n');
    expect(text).toMatch(/probabilities sum to 1/);
    expect(text).toMatch(/E\[survivors\] = n \* p/);
    expect(text).toMatch(/expected factor is 1/);
    expect(text).toMatch(/optimal value is 1/);
    expect(text).toMatch(/pessimal value is 1/);
    expect(text).toMatch(/RTP is exactly the target/);
    expect(text).toMatch(/strictly below the cap/);
    expect(text).toMatch(/side bet .* RTP is exact/);
    expect(text).toMatch(/target RTP is within \[94%, 97%\]/);
  });
});

describe('published headline numbers', () => {
  it('pins the target RTP', () => {
    expect(CONFIG.rtp.toString()).toBe('191/200');
  });

  it('pins the maximum reachable payout and the cap headroom', () => {
    expect(maxPayoutMultiple().toString()).toBe('24448/25');
    expect(largestSideBetMultiplier().toString()).toBe('97792/105');
  });

  it('enumerates the expected number of rows', () => {
    // WIDE 1..5, SPLIT 2..5, NARROW 1..5 => (2+3+4+5+6) + (3+4+5+6) + (2+3+4+5+6)
    expect(outcomeRows().length).toBe(58);
    expect(shapeRows().length).toBe(14);
    expect(contractRows().length).toBe(3);
    expect(policyRows().length).toBe(8);
  });

  it('reports every named policy at exactly the target RTP', () => {
    for (const row of policyRows()) {
      expect(row.rtp.toString(), row.label).toBe('191/200');
      expect(row.totalProbability.toString(), row.label).toBe('1/1');
    }
  });

  it('spans a wide volatility range at constant RTP', () => {
    const variances = policyRows().map((r) => r.variance);
    const lowest = variances.reduce((a, b) => (b.lt(a) ? b : a));
    const highest = variances.reduce((a, b) => (b.gt(a) ? b : a));
    expect(highest.div(lowest).toNumber()).toBeGreaterThan(1000);
  });
});

describe('markdown table rendering', () => {
  const tables = buildTables();

  it('renders every published table', () => {
    expect(Object.keys(tables).sort()).toEqual(
      ['contracts', 'invariants', 'outcomes', 'policies', 'shape', 'sidebets'].sort(),
    );
  });

  it('renders well-formed markdown with a consistent column count', () => {
    for (const [name, body] of Object.entries(tables)) {
      const lines = body.split('\n');
      expect(lines.length, name).toBeGreaterThan(2);
      const columns = lines[0].split('|').length;
      for (const line of lines) {
        expect(line.startsWith('|'), `${name}: ${line}`).toBe(true);
        expect(line.split('|').length, `${name}: ${line}`).toBe(columns);
      }
    }
  });

  it('is deterministic across runs', () => {
    expect(buildTables()).toEqual(tables);
  });
});

describe('the CLI actually runs', () => {
  const run = (args) =>
    execFileSync(process.execPath, [resolve(root, 'tools/enumerate.mjs'), ...args], {
      encoding: 'utf8',
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  it('produces the human report and reports success', () => {
    const out = run([]);
    expect(out).toMatch(/BRANCHFALL — exact outcome enumeration/);
    expect(out).toMatch(/ROUTE CONTRACTS/);
    expect(out).toMatch(/DECISION SPACE/);
    expect(out).toMatch(/MAX-WIN CAP/);
    expect(out).toMatch(/OK — \d+ exact invariants checked, 0 failed/);
    // No decimal-looking probability may appear without its exact fraction nearby.
    expect(out).toMatch(/target RTP\s+191\/200/);
  });

  it('emits machine-readable JSON with exact fractions as strings', () => {
    const parsed = JSON.parse(run(['--json']));
    expect(parsed.failures).toEqual([]);
    expect(parsed.config.rtp).toBe('191/200');
    expect(parsed.maxPayoutMultiple).toBe('24448/25');
    for (const row of parsed.outcomes) expect(row.probability).toMatch(/^\d+\/\d+$/);
  });

  it('emits the markdown tables with their slot markers', () => {
    const out = run(['--markdown']);
    for (const name of ['contracts', 'outcomes', 'shape', 'sidebets', 'policies', 'invariants']) {
      expect(out).toContain(`<!-- table:${name} -->`);
    }
  });

  it('supports a quiet assertion-only mode', () => {
    expect(run(['--quiet']).trim()).toBe('');
  });
});
