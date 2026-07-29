/**
 * How an abandoned round ends — the one resolution the player did not choose.
 *
 * `docs/ENGINE.md` §6.1 and `DESIGN.md` §2.1, as two assertions:
 *
 * | where it was abandoned | resolution | money |
 * | --- | --- | --- |
 * | a branch has resolved, so BANK is legal | AUTO_BANK | credits the claim |
 * | nothing has resolved, so BANK does not exist | VOID | refunds the stake whole |
 *
 * Never a forced run in either row, and a VOID contributes no turnover: *"a round
 * that pays back 1.00x by not being played is not a 95.5% round and must never be
 * counted as one."*
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/http.ts';

const SEED = '0000000000000000000000000000000000000000000000000000000000000054';
const ROUND_ID = 'bf-1-playthru';
const CLIENT_ENTROPY = 'a'.repeat(64);
const OPENING = 500_000_000n;
const STAKE = 5_000_000n;

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

async function openRound() {
  const { body } = await call('POST', '/api/rounds');
  await call('POST', `/api/rounds/${body.roundId}/open`, {
    clientEntropy: CLIENT_ENTROPY,
    respondingTo: body.seedCommitment,
    stakeMicro: STAKE.toString(),
  });
  return body.roundId;
}

beforeEach(async () => {
  app = createApp({
    devClock: true,
    openingBalanceMicro: OPENING,
    seedSource: () => SEED,
    roundIdSource: () => ROUND_ID,
  });
  await new Promise((resolve) => app.server.listen(0, resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => app.server.close(resolve));
});

describe('expiry', () => {
  it('voids a round abandoned before arena 1 resolved, and returns the stake whole', async () => {
    const roundId = await openRound();
    const { status, body } = await call('POST', `/api/rounds/${roundId}/expire`);
    expect(status).toBe(200);
    expect(body.resolution).toBe('VOID');
    expect(body.refundedMicro).toBe(STAKE.toString());
    expect(body.wallet.balanceMicro).toBe(OPENING.toString());
    // Not a settlement: no turnover, so no RTP figure can be computed from it.
    expect(body.wallet.stakedMicro).toBe('0');
    expect(body.wallet.creditedMicro).toBe('0');
    expect(body.frame.phase).toBe('VOID');
  });

  it('auto-banks a round abandoned after a branch resolved, exactly as a BANK would', async () => {
    const roundId = await openRound();
    await call('POST', `/api/rounds/${roundId}/commit`, { idempotencyKey: 'a1', route: 'WIDE' });
    await call('POST', `/api/rounds/${roundId}/resolve`, {});
    const { body } = await call('POST', `/api/rounds/${roundId}/expire`);
    expect(body.resolution).toBe('AUTO_BANK');
    // The claim after WIDE with all five clearing: 4.775000 x 25/21, floored.
    expect(body.settlement.totalCreditedMicro).toBe('5684523');
    expect(body.settlement.kind).toBe('AUTO_BANK');
    expect(body.frame.phase).toBe('SETTLED');
    expect(body.wallet.stakedMicro).toBe(STAKE.toString());
  });

  it('resolves a route the player already committed rather than leaving money at risk', async () => {
    const roundId = await openRound();
    await call('POST', `/api/rounds/${roundId}/commit`, { idempotencyKey: 'a1', route: 'WIDE' });
    // Abandoned mid-replay: the commitment happened, so the branch is run and the
    // resulting frame decides the resolution. That is completion, not a forced run.
    const { body } = await call('POST', `/api/rounds/${roundId}/expire`);
    expect(body.resolution).toBe('AUTO_BANK');
    expect(body.frame.history).toHaveLength(1);
  });

  it('never emits a route or a shelter of its own', async () => {
    const roundId = await openRound();
    const { body } = await call('POST', `/api/rounds/${roundId}/expire`);
    expect(body.frame.history).toHaveLength(0);
    expect(body.resolution).toBe('VOID');
  });
});
