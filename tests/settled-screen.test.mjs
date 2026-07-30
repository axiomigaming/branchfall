/**
 * Which screen a settled round lands on — and the trap that made it the wrong one.
 *
 * BRANCHFALL has two terminal screens and they say opposite things: S5's brass
 * door closing on a light that is still burning, and S6's *"No one made it
 * back."* The client picked between them by reading `frame.live` **after** the
 * settle. The engine's settle empties the live set on every path, the finish line
 * included, so the test was always true: a player who ran all five arenas, walked
 * four runners home and was credited 9.134124 on a 5.000000 stake was shown the
 * wipe screen, with the settlement credit relabelled *"sheltered and side bets,
 * stated separately"* and a loss-screen `Run again` under it.
 *
 * Nothing about the money was wrong then and nothing about it changes here. What
 * this test binds is the decision: the settlement's own `kind` names the ending,
 * `frame.live` does not, and the two rounds below are the two endings driven
 * through the real HTTP application on fixed seeds.
 *
 * The figures are hand-derived from `docs/MATH.md` §4 — claim opens at
 * `stake x 191/200` and each arena multiplies it by `survivors/running` times the
 * geometry's multiplier, `25/21` for every WIDE lane:
 *
 *   finish line, seed 04, five WIDE arenas 5/5, 5/5, 5/5, 4/5, 4/4
 *     5 x 191/200 x (25/21)^5 x 4/5 = 74609375/8168202 -> 9 134 124 uc, 1.8268x
 *   wipe, seed 03, one NARROW arena 0/5
 *     the claim is gone, nothing was sheltered, 0 uc, 0.0000x
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wasWipe } from '../client/src/api.ts';
import { createApp } from '../server/http.ts';

const STAKE = '5000000';
const CLIENT_ENTROPY = 'a'.repeat(64);
const OPENING = 500_000_000n;

/** Both fixed: the tape is derived from the seed *and* the round reference. */
const FINISH_SEED = '0000000000000000000000000000000000000000000000000000000000000004';
const FINISH_ROUND_ID = 'bf-finish-line';
const WIPE_SEED = '0000000000000000000000000000000000000000000000000000000000000003';
const WIPE_ROUND_ID = 'bf-wipe-line';

/**
 * Plays one scripted round to its end and settles it through `POST /finish`.
 *
 * `liveBeforeSettle` is captured the way the client has to capture it — before
 * the settle request — because that is the only moment at which it still means
 * "still out there".
 */
async function play({ seed, roundId, routes }) {
  const app = createApp({
    devClock: true,
    openingBalanceMicro: OPENING,
    seedSource: () => seed,
    roundIdSource: () => roundId,
  });
  await new Promise((resolve) => app.server.listen(0, resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  try {
    const pre = await call('POST', '/api/rounds');
    const open = await call('POST', `/api/rounds/${roundId}/open`, {
      clientEntropy: CLIENT_ENTROPY,
      respondingTo: pre.body.seedCommitment,
      stakeMicro: STAKE,
    });
    expect(open.status, JSON.stringify(open.body)).toBe(200);

    let frame = open.body.frame;
    const line = [];
    for (const [index, route] of routes.entries()) {
      const commit = await call('POST', `/api/rounds/${roundId}/commit`, {
        idempotencyKey: `arena-${index}`,
        expectedFrameRevision: frame.frameRevision,
        route,
      });
      expect(commit.status, JSON.stringify(commit.body)).toBe(200);
      const resolved = await call('POST', `/api/rounds/${roundId}/resolve`, {});
      expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
      line.push(`${resolved.body.resolution.survivors.length}/${resolved.body.resolution.running}`);
      frame = resolved.body.frame;
      if (frame.phase === 'FINISHED') break;
      await call('POST', '/api/dev/advance-clock', { ms: 5000 });
    }

    const before = frame;
    const settled = await call('POST', `/api/rounds/${roundId}/finish`, { idempotencyKey: 'finish' });
    expect(settled.status, JSON.stringify(settled.body)).toBe(200);
    const after = await call('GET', `/api/rounds/${roundId}`);
    return {
      line,
      before,
      liveBeforeSettle: before.live.length,
      settlement: settled.body.settlement,
      after: after.body.frame,
      wallet: settled.body.wallet,
    };
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

let finish;
let wipe;

beforeAll(async () => {
  finish = await play({ seed: FINISH_SEED, roundId: FINISH_ROUND_ID, routes: Array(5).fill('WIDE') });
  wipe = await play({ seed: WIPE_SEED, roundId: WIPE_ROUND_ID, routes: ['NARROW'] });
}, 30_000);

afterAll(() => {
  finish = undefined;
  wipe = undefined;
});

describe('the finish line', () => {
  it('runs all five arenas, walks four runners home and credits above the stake', () => {
    expect(finish.line).toEqual(['5/5', '5/5', '5/5', '4/5', '4/4']);
    expect(finish.before.phase).toBe('FINISHED');
    expect(finish.before.arena.index).toBe(5);
    expect(finish.before.claim.exact).toBe('74609375/8168202');
    expect(finish.before.claim.micro).toBe('9134124');
    expect(finish.liveBeforeSettle).toBe(4);

    expect(finish.settlement.kind).toBe('FINISH');
    expect(finish.settlement.totalCreditedMicro).toBe('9134124');
    expect(finish.settlement.routeStakeMicro).toBe('5000000');
    expect(finish.settlement.sideBetStakeMicro).toBe('0');
    expect(finish.settlement.returnMultiple).toBe('1.8268');
    expect(finish.after.squad.filter((runner) => runner.status === 'home')).toHaveLength(4);
    expect(finish.after.squad.filter((runner) => runner.status === 'lost')).toHaveLength(1);
  });

  it('leaves an empty live set behind it, which is exactly why the screen may not read it', () => {
    // The settle brings every surviving runner home, so the engine's live set is
    // empty on a won round and on a lost one alike. This assertion is the bug,
    // pinned: any future code that decides the ending from this array decides it
    // wrongly for every round that reached the finish line.
    expect(finish.after.live).toEqual([]);
    expect(finish.after.live.length === 0).toBe(true);
    // And the honest reading of the same round.
    expect(wasWipe(finish.settlement, finish.liveBeforeSettle)).toBe(false);
  });
});

describe('a wipe', () => {
  it('ends with nobody home, nothing credited, and a settlement that says WIPE', () => {
    expect(wipe.line).toEqual(['0/5']);
    expect(wipe.liveBeforeSettle).toBe(0);
    expect(wipe.settlement.kind).toBe('WIPE');
    expect(wipe.settlement.totalCreditedMicro).toBe('0');
    expect(wipe.settlement.returnMultiple).toBe('0.0000');
    expect(wipe.after.live).toEqual([]);
    expect(wipe.after.squad.every((runner) => runner.status === 'lost')).toBe(true);
    expect(wasWipe(wipe.settlement, wipe.liveBeforeSettle)).toBe(true);
  });
});

describe('the client decides the ending in one place', () => {
  // A screen choice cannot be asserted from node, but its *shape* can, and the
  // shape is what failed: the decision was inline, so it was made twice and one
  // of the two was wrong. `enterSettled` is now the only writer of either view.
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../client/src/main.ts'),
    'utf8',
  );

  it('assigns each of the two settled views exactly once', () => {
    expect(source.match(/state\.view = 'wipe'/gu) ?? []).toHaveLength(1);
    expect(source.match(/state\.view = 'banked'/gu) ?? []).toHaveLength(1);
    expect(source).toContain('function enterSettled(');
  });

  it('never chooses a settled screen from the live set', () => {
    // The defect, as a pattern: the live set and one of the two settled views in
    // the same expression.
    expect(source).not.toMatch(/live\.length[^\n]*'(wipe|banked)'/u);
    expect(source).not.toMatch(/'(wipe|banked)'[^\n]*live\.length/u);
  });
});

describe('wasWipe', () => {
  it('believes the settlement over the live set, on every kind the server can send', () => {
    // Zero is the live count the client sees *after* a settle. Only WIPE may turn
    // it into the wipe screen.
    for (const kind of ['BANK', 'FINISH', 'AUTO_BANK', 'VOID'])
      expect(wasWipe({ kind }, 0), kind).toBe(false);
    expect(wasWipe({ kind: 'WIPE' }, 4)).toBe(true);
  });

  it('falls back to the pre-settle live set only when there is no settlement', () => {
    // The settle response was lost. The live count read before the request is
    // then the best available reading, and it is still the right one.
    expect(wasWipe(null, 0)).toBe(true);
    expect(wasWipe(null, 2)).toBe(false);
  });
});
