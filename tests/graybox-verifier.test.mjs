/**
 * What the verifier must refuse.
 *
 * A verifier that only re-derives the figures a record *lists* is not a
 * verifier: a record listing nothing passes it. These are the tampered bundles
 * that used to verify and now do not — each one written as the attack it is,
 * because "the ledger check passes" is only worth something if some ledger fails
 * it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/http.ts';
import { verifyBundle } from '../server/verify.ts';

const SEED = '0000000000000000000000000000000000000000000000000000000000000054';
const ROUND_ID = 'bf-1-playthru';
const STAKE = 5_000_000n;

let app;
let base;
let bundle;

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const failing = (report, code) => report.checks.find((check) => check.code === code);

beforeAll(async () => {
  app = createApp({
    devClock: true,
    openingBalanceMicro: 500_000_000n,
    seedSource: () => SEED,
    roundIdSource: () => ROUND_ID,
  });
  await new Promise((resolve) => app.server.listen(0, resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;

  const { body: precommit } = await call('POST', '/api/rounds');
  await call('POST', `/api/rounds/${ROUND_ID}/open`, {
    clientSeed: 'a lantern in the fog',
    respondingTo: precommit.seedCommitment,
    stakeMicro: STAKE.toString(),
  });
  await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
    idempotencyKey: 'a1',
    route: 'WIDE',
    sideBets: [{ bet: 'CLEAN_SWEEP', stakeMicro: '2000000' }],
  });
  await call('POST', `/api/rounds/${ROUND_ID}/resolve`, {});
  await call('POST', '/api/dev/advance-clock', { ms: 5000 });
  await call('POST', `/api/rounds/${ROUND_ID}/bank`, { idempotencyKey: 'bank' });
  const verify = await call('GET', `/api/rounds/${ROUND_ID}/verify`);
  bundle = verify.body.bundle;
  expect(verify.body.report.ok).toBe(true);
});

afterAll(async () => {
  await new Promise((resolve) => app.server.close(resolve));
});

const tampered = (mutate) => {
  const copy = structuredClone(bundle);
  mutate(copy);
  return verifyBundle(copy);
};

describe('a published round that was edited', () => {
  it('accepts a client seed the player actually typed, and proves it was used', () => {
    const report = verifyBundle(bundle);
    expect(report.ok).toBe(true);
    expect(bundle.clientSeed).toBe('a lantern in the fog');
    expect(failing(report, 'CLIENT_SEED').ok).toBe(true);
    expect(failing(report, 'CLIENT_SEED').detail).toContain('SHA-256');
  });

  it('refuses a bundle claiming a different seed produced the same entropy', () => {
    const report = tampered((copy) => {
      copy.clientSeed = 'a different seed entirely';
    });
    expect(failing(report, 'CLIENT_SEED').ok).toBe(false);
  });

  it('refuses a ledger with its credits deleted', () => {
    // The attack the first version of this verifier passed: publish nothing and
    // there is nothing to disagree with.
    const report = tampered((copy) => {
      copy.credits = [];
      copy.totalCreditedMicro = '0';
    });
    expect(report.ok).toBe(false);
    expect(failing(report, 'LEDGER').ok).toBe(false);
    expect(failing(report, 'LEDGER').detail).toMatch(/survived and no credit event pays them/u);
  });

  it('refuses a ledger that pays a runner twice', () => {
    const report = tampered((copy) => {
      const bank = copy.credits.find((event) => event.kind === 'BANK');
      copy.credits.push({ ...bank });
      copy.totalCreditedMicro = String(Number(copy.totalCreditedMicro) + Number(bank.creditedMicro));
    });
    expect(failing(report, 'LEDGER').ok).toBe(false);
  });

  it('refuses a side bet outside the declared stake limits', () => {
    const report = tampered((copy) => {
      const ticket = copy.credits.find((event) => event.kind === 'SIDE_BET');
      ticket.stakeMicro = '999000000';
      ticket.creditedMicro = '0';
      ticket.won = false;
    });
    expect(failing(report, 'SIDE_BET_LIMITS').ok).toBe(false);
  });

  it('refuses the same event staked twice in one arena', () => {
    const report = tampered((copy) => {
      const ticket = copy.credits.find((event) => event.kind === 'SIDE_BET');
      copy.credits.splice(copy.credits.indexOf(ticket), 0, { ...ticket, creditedMicro: '0', won: false });
    });
    expect(failing(report, 'SIDE_BET_LIMITS').ok).toBe(false);
  });

  it('refuses a ledger published out of the order the round happened', () => {
    const report = tampered((copy) => {
      copy.credits.reverse();
    });
    expect(failing(report, 'LEDGER_ORDER').ok).toBe(false);
  });

  it('refuses a stake outside the declared limits, and says the stake is declared', () => {
    const report = verifyBundle(bundle);
    const stake = failing(report, 'STAKE_BASIS');
    expect(stake.ok).toBe(true);
    expect(stake.title).toMatch(/declared field, not a proven one/u);
    expect(tampered((copy) => (copy.routeStakeMicro = '1')).checks.find((c) => c.code === 'STAKE_BASIS').ok).toBe(
      false,
    );
  });

  it('refuses an edited transcript, an edited credit and an edited total', () => {
    expect(tampered((copy) => (copy.transcript.steps[0].survivors = [0, 1])).ok).toBe(false);
    expect(
      tampered((copy) => {
        const bank = copy.credits.find((event) => event.kind === 'BANK');
        bank.creditedMicro = String(Number(bank.creditedMicro) + 1);
      }).ok,
    ).toBe(false);
    expect(tampered((copy) => (copy.totalCreditedMicro = '1')).ok).toBe(false);
  });
});

describe('expiry is an operator path, not a player action', () => {
  it('refuses a round that is not past its window', async () => {
    const strict = createApp({ openingBalanceMicro: 100_000_000n, expiryWindowMs: 60_000 });
    await new Promise((resolve) => strict.server.listen(0, resolve));
    const at = `http://127.0.0.1:${strict.server.address().port}`;
    const precommit = await (await fetch(`${at}/api/rounds`, { method: 'POST' })).json();
    await fetch(`${at}/api/rounds/${precommit.roundId}/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientSeed: 'b'.repeat(64),
        respondingTo: precommit.seedCommitment,
        stakeMicro: '5000000',
      }),
    });
    const response = await fetch(`${at}/api/rounds/${precommit.roundId}/expire`, { method: 'POST' });
    const payload = await response.json();
    // A player-reachable cancel would be a zero-risk exit from arena 1, and the
    // action set in state (1, n) has no such element.
    expect(response.status).toBe(409);
    expect(payload.code).toBe('ILLEGAL_ACTION');
    expect(payload.message).toMatch(/not past its expiry window/u);
    await new Promise((resolve) => strict.server.close(resolve));
  });

  it('publishes the auto-bank credit, so the round still verifies', async () => {
    const auto = createApp({
      devClock: true,
      openingBalanceMicro: 100_000_000n,
      seedSource: () => SEED,
      roundIdSource: () => 'bf-expiry',
    });
    await new Promise((resolve) => auto.server.listen(0, resolve));
    const at = `http://127.0.0.1:${auto.server.address().port}`;
    const post = async (path, body) =>
      (
        await fetch(`${at}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        })
      ).json();
    const precommit = await post('/api/rounds');
    await post(`/api/rounds/bf-expiry/open`, {
      clientSeed: 'c'.repeat(64),
      respondingTo: precommit.seedCommitment,
      stakeMicro: '5000000',
    });
    await post('/api/rounds/bf-expiry/commit', { idempotencyKey: 'a1', route: 'WIDE' });
    const resolved = await post('/api/rounds/bf-expiry/resolve', {});
    const claim = resolved.frame.claim.micro;
    const expired = await post('/api/rounds/bf-expiry/expire');
    // Exactly the BANK the player could have sent: the claim standing when they
    // walked away, floored once, and nothing else.
    expect(expired.resolution).toBe('AUTO_BANK');
    expect(expired.settlement.totalCreditedMicro).toBe(claim);
    const verify = await (await fetch(`${at}/api/rounds/bf-expiry/verify`)).json();
    expect(verify.report.ok).toBe(true);
    expect(verify.bundle.credits.some((event) => event.kind === 'BANK')).toBe(true);
    await new Promise((resolve) => auto.server.close(resolve));
  });
});
