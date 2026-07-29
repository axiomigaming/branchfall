/**
 * Money in the live frame has one unit per wire spelling.
 *
 * `micro` fields are integer micro-credits. Exact and display rationals are
 * credits, including the current claim, its per-runner share and arena history.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/http.ts';

const SERVER_SEED = '0000000000000000000000000000000000000000000000000000000000000054';
const ROUND_ID = 'bf-frame-units';
const MICRO_PER_CREDIT = 1_000_000n;

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

function floorCreditsToMicro(exact) {
  const [numerator, denominator] = exact.split('/').map(BigInt);
  return (numerator * MICRO_PER_CREDIT) / denominator;
}

beforeAll(async () => {
  app = createApp({
    devClock: true,
    openingBalanceMicro: 100_000_000n,
    seedSource: () => SERVER_SEED,
    roundIdSource: () => ROUND_ID,
  });
  await new Promise((resolve) => app.server.listen(0, resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => app.server.close(resolve));
});

describe('live frame money units', () => {
  it('publishes current and historical claim rationals in credits, agreeing to the micro-credit', async () => {
    const precommit = await call('POST', '/api/rounds');
    const opened = await call('POST', `/api/rounds/${ROUND_ID}/open`, {
      clientSeed: 'frame unit regression',
      respondingTo: precommit.body.seedCommitment,
      stakeMicro: '5000000',
    });
    expect(opened.status).toBe(200);
    expect(opened.body.frame.claim.exact).toBe('191/40');
    expect(opened.body.frame.claim.perRunnerExact).toBe('191/200');
    expect(opened.body.frame.squad[0].valueExact).toBe('191/200');
    expect(floorCreditsToMicro(opened.body.frame.claim.exact)).toBe(
      BigInt(opened.body.frame.claim.micro),
    );
    expect(floorCreditsToMicro(opened.body.frame.claim.perRunnerExact)).toBe(
      BigInt(opened.body.frame.claim.perRunnerMicro),
    );
    expect(floorCreditsToMicro(opened.body.frame.squad[0].valueExact)).toBe(
      BigInt(opened.body.frame.squad[0].valueMicro),
    );

    const committed = await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
      idempotencyKey: 'frame-unit-a1',
      expectedFrameRevision: 0,
      route: 'WIDE',
    });
    expect(committed.status).toBe(200);
    const resolved = await call('POST', `/api/rounds/${ROUND_ID}/resolve`, {});
    expect(resolved.status).toBe(200);

    const frame = resolved.body.frame;
    const last = frame.history.at(-1);
    expect(frame.claim.exact).toBe(last.claimAfter.exact);
    expect(frame.claim.display).toBe(last.claimAfter.decimal.slice(0, 5));
    expect(floorCreditsToMicro(frame.claim.exact)).toBe(BigInt(frame.claim.micro));
    expect(floorCreditsToMicro(last.claimAfter.exact)).toBe(BigInt(last.claimAfterMicro));
  });
});
