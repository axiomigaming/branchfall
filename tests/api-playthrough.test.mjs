/**
 * A whole round, driven through the HTTP API, asserted to the micro-credit.
 *
 * The seed and the round id are fixed (and only a test may fix them — see
 * `RoundStore.seedSource`), so the line below is a *scripted* round: WIDE with
 * the squad, the fork at 3+2, a shelter of two, the Reach, then bank. Every
 * credit it asserts was computed by hand from `docs/MATH.md` §4 and §5.5 and is
 * written out as an integer here rather than recomputed by the code under test.
 *
 *   stake 5.000000            claim opens at 5.000000 x 191/200 = 4.775000
 *   A1 WIDE      5 of 5       x (5/5) x 25/21
 *   A2 SPLIT 3+2 4 of 5       x (4/5) x  4/3
 *   A3 SHELTER 2, WIDE 2 of 2 banks half the claim, then x (2/2) x 25/21
 *   A4 NARROW    2 of 2       x (2/2) x  4/1
 *   BANK
 *
 * plus one CLEAN SWEEP ticket of 2.000000 on arena 1, priced `191/200` over
 * `50421/102400` = `97792/50421` — a published row of `MATH.md` §5.5.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/http.ts';

const STAKE = 5_000_000n;
const SIDE_BET_STAKE = 2_000_000n;
const OPENING = 500_000_000n;

/** The first seed whose tape produces the scripted survivor line. */
const SEED = '0000000000000000000000000000000000000000000000000000000000000054';
const ROUND_ID = 'bf-1-playthru';
const CLIENT_ENTROPY = 'a'.repeat(64);

let app;
let base;

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const tick = () => call('POST', '/api/dev/advance-clock', { ms: 5000 });

beforeAll(async () => {
  app = createApp({
    devClock: true,
    openingBalanceMicro: OPENING,
    seedSource: () => SEED,
    roundIdSource: () => ROUND_ID,
  });
  await new Promise((resolve) => app.server.listen(0, resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => app.server.close(resolve));
});

describe('BRANCHFALL round, end to end over the API', () => {
  let commitment;

  it('publishes a pre-commitment before anything of the player exists', async () => {
    const { status, body } = await call('POST', '/api/rounds');
    expect(status).toBe(200);
    expect(body.roundId).toBe(ROUND_ID);
    expect(body.seedCommitment).toMatch(/^[0-9a-f]{64}$/u);
    expect(body.definition.id).toBe('branchfall');
    expect(body.definition.moduleId).toBe('staged-survival');
    commitment = body.seedCommitment;
  });

  it('refuses a client seed that answers a commitment this round did not publish', async () => {
    const { status, body } = await call('POST', `/api/rounds/${ROUND_ID}/open`, {
      clientEntropy: CLIENT_ENTROPY,
      respondingTo: 'f'.repeat(64),
      stakeMicro: STAKE.toString(),
    });
    expect(status).toBe(409);
    expect(body.code).toBe('COMMITMENT_MISMATCH');
  });

  it('refuses the published rehearsal seed for a staked round', async () => {
    const { body: config } = await call('GET', '/api/config');
    const { status, body } = await call('POST', `/api/rounds/${ROUND_ID}/open`, {
      clientEntropy: config.rehearsal.seedPair.clientEntropy,
      respondingTo: commitment,
      stakeMicro: STAKE.toString(),
    });
    expect(status).toBe(400);
    expect(body.message).toMatch(/rehearsal seed/u);
  });

  it('opens the round: the claim is the stake times 191/200, split five ways', async () => {
    const { status, body } = await call('POST', `/api/rounds/${ROUND_ID}/open`, {
      clientEntropy: CLIENT_ENTROPY,
      respondingTo: commitment,
      stakeMicro: STAKE.toString(),
    });
    expect(status).toBe(200);
    const { frame } = body;
    expect(frame.phase).toBe('DECISION');
    expect(frame.claim.micro).toBe('4775000');
    expect(frame.claim.perRunnerMicro).toBe('955000');
    expect(frame.squad).toHaveLength(5);
    expect(frame.squad.every((runner) => runner.status === 'running')).toBe(true);
    expect(frame.squad[0].valueMicro).toBe('955000');
    // The digest is published; the tape is not, and there is no key that carries it.
    expect(frame.fairness.tapeDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(frame.fairness.revealedServerSeed).toBeNull();
    expect(JSON.stringify(frame)).not.toContain(SEED);
    expect(body.wallet.balanceMicro).toBe((OPENING - STAKE).toString());
  });

  it('offers exactly the four cards, with both fork balances at five runners', async () => {
    const { body } = await call('GET', `/api/rounds/${ROUND_ID}`);
    const routes = body.frame.menu.map((entry) => entry.route);
    expect(routes).toEqual(['WIDE', 'SPLIT', 'NARROW', 'SHELTER']);
    const split = body.frame.menu.find((entry) => entry.route === 'SPLIT');
    expect(split.laneSplits).toEqual([3, 4]);
    const wide = body.frame.menu.find((entry) => entry.route === 'WIDE').figures[0].figures;
    // docs/MATH.md §5.2, the WIDE row at five runners.
    expect(wide.wipe.exact).toBe('4099/102400');
    expect(wide.allClear.exact).toBe('50421/102400');
    expect(wide.breakEven).toBe(5);
    expect(wide.display.wipePct).toBe('4.00%');
    expect(wide.display.allClearPct).toBe('49.24%');
    expect(wide.display.fallsNonZeroPct).toBe('46.76%');
    // docs/DESIGN.md §S2: a shelter can never take the whole squad.
    const shelter = body.frame.menu.find((entry) => entry.route === 'SHELTER');
    expect(shelter.shelterSizes).toEqual([1, 2, 3, 4]);
  });

  it('refuses to bank before a branch has resolved, and refuses to shelter the whole squad', async () => {
    const bank = await call('POST', `/api/rounds/${ROUND_ID}/bank`, { idempotencyKey: 'bank-too-early' });
    expect(bank.status).toBe(409);
    expect(bank.body.code).toBe('ILLEGAL_ACTION');
    expect(bank.body.message).toMatch(/after the first branch/u);

    const shelterAll = await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
      idempotencyKey: 'shelter-all',
      route: 'SHELTER',
      shelter: [0, 1, 2, 3, 4],
    });
    expect(shelterAll.status).toBe(400);
    expect(shelterAll.body.message).toMatch(/One has to run/u);
  });

  it('refuses a lane balance the model does not have at this squad size', async () => {
    const { status, body } = await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
      idempotencyKey: 'bad-balance',
      route: 'SPLIT',
      laneSplit: 2,
    });
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_LANE_SPLIT');
  });

  it('refuses a side bet priced off a stale card', async () => {
    const { status, body } = await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
      idempotencyKey: 'stale-quote',
      route: 'WIDE',
      sideBets: [{ bet: 'CLEAN_SWEEP', stakeMicro: '1000000', quotedMultiplier: '2/1' }],
    });
    expect(status).toBe(400);
    expect(body.code).toBe('QUOTE_MISMATCH');
  });

  it('arena 1 — WIDE, the whole squad clears, and the Clean Sweep pays 97792/50421', async () => {
    const commit = await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
      idempotencyKey: 'a1',
      expectedFrameRevision: 0,
      route: 'WIDE',
      sideBets: [
        {
          bet: 'CLEAN_SWEEP',
          stakeMicro: SIDE_BET_STAKE.toString(),
          quotedMultiplier: '97792/50421',
        },
      ],
    });
    expect(commit.status).toBe(200);
    expect(commit.body.sideBets[0].multiplier).toBe('97792/50421');
    expect(commit.body.frame.phase).toBe('RUNNING');
    // Half of a 5.00 stake is 2.50; a 2.00 ticket leaves 0.50, under the 1.00
    // minimum, so the control is hidden for the rest of the round (DESIGN §4).
    expect(commit.body.frame.sideBets.remainingMicro).toBe('500000');
    expect(commit.body.frame.sideBets.offered).toBe(false);

    const resolve = await call('POST', `/api/rounds/${ROUND_ID}/resolve`, {});
    expect(resolve.status).toBe(200);
    const arena = resolve.body.resolution;
    expect(arena.survivors).toHaveLength(5);
    expect(arena.fallen).toHaveLength(0);
    expect(arena.lanes).toHaveLength(1);
    expect(arena.claimAfterMicro).toBe('5684523');
    expect(arena.sideBets[0].won).toBe(true);
    expect(arena.sideBets[0].creditedMicro).toBe('3879018');
    expect(resolve.body.frame.claim.micro).toBe('5684523');
  });

  it('holds the minimum game cycle against the next money command', async () => {
    const early = await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
      idempotencyKey: 'a2-early',
      route: 'SPLIT',
      laneSplit: 3,
    });
    expect(early.status).toBe(429);
    expect(early.body.code).toBe('TOO_SOON');
    expect(early.body.minGameCycleMs).toBe(5000);
    await tick();
  });

  it('arena 2 — the fork at 3+2, and the player names who takes the thin limb', async () => {
    const commit = await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
      idempotencyKey: 'a2',
      expectedFrameRevision: 1,
      route: 'SPLIT',
      laneSplit: 3,
      laneOrder: ['Sable', 'Ora', 'Tuck', 'Wren', 'Bramble'],
    });
    expect(commit.status).toBe(200);
    expect(commit.body.lanes.map((lane) => lane.entities.map((runner) => runner.name))).toEqual([
      ['Sable', 'Ora', 'Tuck'],
      ['Wren', 'Bramble'],
    ]);

    const resolve = await call('POST', `/api/rounds/${ROUND_ID}/resolve`, {});
    const arena = resolve.body.resolution;
    expect(arena.running).toBe(5);
    expect(arena.survivors).toHaveLength(4);
    expect(arena.fallen).toHaveLength(1);
    expect(arena.claimAfterMicro).toBe('6063492');
    expect(arena.claimFactor.exact).toBe('16/15');
    await tick();
  });

  it('arena 3 — a shelter of two banks exactly half the claim, and the rest run WIDE', async () => {
    const { body: before } = await call('GET', `/api/rounds/${ROUND_ID}`);
    const live = before.frame.live;
    expect(live).toHaveLength(4);

    const commit = await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
      idempotencyKey: 'a3',
      expectedFrameRevision: 2,
      route: 'SHELTER',
      shelter: live.slice(0, 2),
    });
    expect(commit.status).toBe(200);
    expect(commit.body.shelterCreditedMicro).toBe('3031746');

    const resolve = await call('POST', `/api/rounds/${ROUND_ID}/resolve`, {});
    const arena = resolve.body.resolution;
    expect(arena.running).toBe(2);
    expect(arena.survivors).toHaveLength(2);
    expect(arena.claimAfterMicro).toBe('3609221');
    // Sheltered runners are home and stay home.
    const sheltered = resolve.body.frame.squad.filter((runner) => runner.status === 'home');
    expect(sheltered).toHaveLength(2);
    await tick();
  });

  it('arena 4 — the Reach, both runners clear, claim x4', async () => {
    await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
      idempotencyKey: 'a4',
      expectedFrameRevision: 3,
      route: 'NARROW',
    });
    const resolve = await call('POST', `/api/rounds/${ROUND_ID}/resolve`, {});
    const arena = resolve.body.resolution;
    expect(arena.claimFactor.exact).toBe('4/1');
    expect(arena.claimAfterMicro).toBe('14436885');
    await tick();
  });

  it('bank — the credit, the wallet and the round total are exact', async () => {
    const { status, body } = await call('POST', `/api/rounds/${ROUND_ID}/bank`, {
      idempotencyKey: 'bank',
      expectedFrameRevision: 4,
    });
    expect(status).toBe(200);
    expect(body.settlement.kind).toBe('BANK');
    // 3 031 746 shelter + 14 436 885 bank + 3 879 018 side bet
    expect(body.settlement.totalCreditedMicro).toBe('21347649');
    expect(body.settlement.routeStakeMicro).toBe('5000000');
    expect(body.settlement.sideBetStakeMicro).toBe('2000000');
    expect(body.settlement.revealedServerSeed).toBe(SEED);
    expect(body.wallet.balanceMicro).toBe(
      (OPENING - STAKE - SIDE_BET_STAKE + 21_347_649n).toString(),
    );
    expect(body.frame.phase).toBe('SETTLED');
    // Four came home; the one who fell on the fork stays fallen.
    expect(body.frame.squad.filter((runner) => runner.status === 'home')).toHaveLength(4);
    expect(body.frame.squad.filter((runner) => runner.status === 'lost')).toHaveLength(1);
  });

  it('an exact retry replays the stored receipt; a changed payload under the same key fails', async () => {
    const again = await call('POST', `/api/rounds/${ROUND_ID}/bank`, {
      idempotencyKey: 'bank',
      expectedFrameRevision: 4,
    });
    expect(again.body.settlement.totalCreditedMicro).toBe('21347649');
    const conflict = await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
      idempotencyKey: 'a1',
      route: 'NARROW',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('verifies: the proof, the pre-commitment, the digest and every credited figure', async () => {
    const { status, body } = await call('GET', `/api/rounds/${ROUND_ID}/verify`);
    expect(status).toBe(200);
    expect(body.report.ok).toBe(true);
    const codes = body.report.checks.map((check) => check.code);
    expect(codes).toContain('PROOF');
    expect(codes).toContain('LEDGER');
    expect(codes).toContain('PRE_COMMITMENT');
    expect(body.report.checks.every((check) => check.ok)).toBe(true);
    expect(body.bundle.revealedServerSeed).toBe(SEED);
    expect(body.bundle.transcript.steps).toHaveLength(4);
    // The published record carries no tape, under any key.
    expect(JSON.stringify(body.bundle.transcript)).not.toContain('draws');
  });

  it('a bundle with one micro-credit moved fails the ledger check', async () => {
    const { body } = await call('GET', `/api/rounds/${ROUND_ID}/verify`);
    const tampered = structuredClone(body.bundle);
    const bank = tampered.credits.find((event) => event.kind === 'BANK');
    bank.creditedMicro = String(Number(bank.creditedMicro) + 1);
    const check = await call('POST', '/api/verify', { bundle: tampered });
    expect(check.body.ok).toBe(false);
    expect(check.body.checks.find((entry) => entry.code === 'LEDGER').ok).toBe(false);
  });

  it('a bundle whose transcript was edited fails the engine proof', async () => {
    const { body } = await call('GET', `/api/rounds/${ROUND_ID}/verify`);
    const tampered = structuredClone(body.bundle);
    tampered.transcript.steps[0].survivors = [0, 1, 2, 3];
    const check = await call('POST', '/api/verify', { bundle: tampered });
    expect(check.body.ok).toBe(false);
    expect(check.body.checks.find((entry) => entry.code === 'PROOF').ok).toBe(false);
  });
});
