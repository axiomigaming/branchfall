/**
 * Hostile HTTP input must stop at the request boundary.
 *
 * These cases deliberately drive the real server rather than the helpers they
 * exercise. A typed rejection is only half the contract: the same frame, wallet
 * and runner assignment must still be standing afterwards, because validation
 * that mutates and then rejects is not validation before the transaction.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/http.ts';

const OPENING = 100_000_000n;
const STAKE = 5_000_000n;
const SERVER_SEED = '0000000000000000000000000000000000000000000000000000000000000054';

const running = new Set();

async function harness() {
  const app = createApp({
    devClock: true,
    openingBalanceMicro: OPENING,
    seedSource: () => SERVER_SEED,
    roundIdSource: (counter) => `bf-hostile-${counter}`,
  });
  await new Promise((resolve) => app.server.listen(0, resolve));
  running.add(app.server);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { app, call };
}

async function precommitAndOpen(call) {
  const precommit = await call('POST', '/api/rounds');
  expect(precommit.status).toBe(200);
  const opened = await call('POST', `/api/rounds/${precommit.body.roundId}/open`, {
    clientSeed: 'hostile input regression',
    respondingTo: precommit.body.seedCommitment,
    stakeMicro: STAKE.toString(),
  });
  expect(opened.status).toBe(200);
  return precommit.body;
}

function stateOf(payload) {
  return {
    balanceMicro: payload.wallet.balanceMicro,
    stakedMicro: payload.wallet.stakedMicro,
    creditedMicro: payload.wallet.creditedMicro,
    frameRevision: payload.frame.frameRevision,
    phase: payload.frame.phase,
    history: payload.frame.history,
    squad: payload.frame.squad,
  };
}

afterEach(async () => {
  const servers = [...running];
  running.clear();
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe('the commit boundary', () => {
  it('treats null as no shelter on a non-shelter route and can resolve the branch', async () => {
    const { call } = await harness();
    const round = await precommitAndOpen(call);
    const before = await call('GET', `/api/rounds/${round.roundId}`);

    const committed = await call('POST', `/api/rounds/${round.roundId}/commit`, {
      idempotencyKey: 'wide-null-shelter',
      route: 'WIDE',
      shelter: null,
    });
    expect(committed.status).toBe(200);
    expect(committed.body.code).not.toBe('INTERNAL');
    expect(committed.body.wallet.balanceMicro).toBe(before.body.wallet.balanceMicro);

    const resolved = await call('POST', `/api/rounds/${round.roundId}/resolve`, {});
    expect(resolved.status).toBe(200);
    expect(resolved.body.frame.frameRevision).toBe(1);
  });

  it('rejects malformed leaves with stable 4xx codes and leaves the round untouched', async () => {
    const { call } = await harness();
    const round = await precommitAndOpen(call);
    const before = await call('GET', `/api/rounds/${round.roundId}`);
    const expected = stateOf(before.body);
    const names = before.body.frame.squad.map((runner) => runner.name);

    const cases = [
      {
        label: 'a null shelter on SHELTER',
        body: { idempotencyKey: 'bad-shelter-null', route: 'SHELTER', shelter: null },
        code: 'ILLEGAL_ACTION',
      },
      {
        label: 'an object shelter on WIDE',
        body: { idempotencyKey: 'bad-shelter-object', route: 'WIDE', shelter: {} },
        code: 'ILLEGAL_ACTION',
      },
      {
        label: 'a null shelter member',
        body: { idempotencyKey: 'bad-shelter-member', route: 'SHELTER', shelter: [null] },
        code: 'ILLEGAL_ACTION',
      },
      {
        label: 'a null side-bet ticket',
        body: { idempotencyKey: 'bad-ticket-null', route: 'WIDE', sideBets: [null] },
        code: 'INVALID_SIDE_BET',
      },
      {
        label: 'an array side-bet ticket',
        body: { idempotencyKey: 'bad-ticket-array', route: 'WIDE', sideBets: [[]] },
        code: 'INVALID_SIDE_BET',
      },
      {
        label: 'a numeric side-bet ticket',
        body: { idempotencyKey: 'bad-ticket-number', route: 'WIDE', sideBets: [42] },
        code: 'INVALID_SIDE_BET',
      },
      {
        label: 'an empty side-bet ticket',
        body: { idempotencyKey: 'bad-ticket-empty', route: 'WIDE', sideBets: [{}] },
        code: 'INVALID_SIDE_BET',
      },
      {
        label: 'a non-array side-bet collection',
        body: { idempotencyKey: 'bad-tickets-object', route: 'WIDE', sideBets: {} },
        code: 'INVALID_SIDE_BET',
      },
      {
        label: 'a null side-bet collection',
        body: { idempotencyKey: 'bad-tickets-null', route: 'WIDE', sideBets: null },
        code: 'INVALID_SIDE_BET',
      },
      {
        label: 'a missing side-bet stake',
        body: {
          idempotencyKey: 'bad-ticket-stake',
          route: 'WIDE',
          sideBets: [{ bet: 'CLEAN_SWEEP' }],
        },
        code: 'INVALID_SIDE_BET',
      },
      {
        label: 'a non-string side-bet quote',
        body: {
          idempotencyKey: 'bad-ticket-quote',
          route: 'WIDE',
          sideBets: [{ bet: 'CLEAN_SWEEP', stakeMicro: '1000000', quotedMultiplier: 2 }],
        },
        code: 'INVALID_SIDE_BET',
      },
      {
        label: 'a null lane-order member',
        body: {
          idempotencyKey: 'bad-lane-order',
          route: 'SPLIT',
          laneSplit: 3,
          laneOrder: [null, ...names.slice(1)],
        },
        code: 'ILLEGAL_ACTION',
      },
      {
        label: 'a string lane split',
        body: { idempotencyKey: 'bad-lane-split', route: 'SPLIT', laneSplit: '3' },
        code: 'INVALID_LANE_SPLIT',
      },
      {
        label: 'a string frame revision',
        body: { idempotencyKey: 'bad-frame-revision', expectedFrameRevision: '0', route: 'WIDE' },
        code: 'INVALID_ARGUMENT',
      },
      {
        label: 'a numeric idempotency key',
        body: { idempotencyKey: 7, route: 'WIDE' },
        code: 'INVALID_ARGUMENT',
      },
      {
        label: 'a null command body',
        body: null,
        code: 'INVALID_ARGUMENT',
      },
    ];

    for (const hostile of cases) {
      const rejected = await call('POST', `/api/rounds/${round.roundId}/commit`, hostile.body);
      expect(rejected.status, hostile.label).toBeGreaterThanOrEqual(400);
      expect(rejected.status, hostile.label).toBeLessThan(500);
      expect(rejected.body.code, hostile.label).toBe(hostile.code);
      expect(rejected.body.code, hostile.label).not.toBe('INTERNAL');

      const after = await call('GET', `/api/rounds/${round.roundId}`);
      expect(stateOf(after.body), hostile.label).toEqual(expected);
    }

    const playable = await call('POST', `/api/rounds/${round.roundId}/commit`, {
      idempotencyKey: 'valid-after-hostile-input',
      expectedFrameRevision: 0,
      route: 'WIDE',
    });
    expect(playable.status).toBe(200);
    expect(playable.body.frame.phase).toBe('RUNNING');
  });
});

describe('one open round per session', () => {
  it('refuses a second liability, reports the resumable id, and opens it after the first closes', async () => {
    const { call } = await harness();
    const first = await precommitAndOpen(call);
    const second = await call('POST', '/api/rounds');
    expect(second.status).toBe(200);
    expect(second.body.openRoundId).toBe(first.roundId);

    const before = await call('GET', '/api/session');
    const refused = await call('POST', `/api/rounds/${second.body.roundId}/open`, {
      clientSeed: 'second round must wait',
      respondingTo: second.body.seedCommitment,
      stakeMicro: STAKE.toString(),
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ROUND_ALREADY_OPEN');
    expect(refused.body.openRoundId).toBe(first.roundId);
    expect(refused.body.code).not.toBe('INTERNAL');

    const after = await call('GET', '/api/session');
    expect(after.body.openRoundId).toBe(first.roundId);
    expect(after.body.wallet.balanceMicro).toBe(before.body.wallet.balanceMicro);
    expect(after.body.wallet.stakedMicro).toBe(before.body.wallet.stakedMicro);

    const closed = await call('POST', `/api/rounds/${first.roundId}/expire`, {});
    expect(closed.status).toBe(200);
    const reopened = await call('POST', `/api/rounds/${second.body.roundId}/open`, {
      clientSeed: 'second round may start now',
      respondingTo: second.body.seedCommitment,
      stakeMicro: STAKE.toString(),
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body.openRoundId).toBe(second.body.roundId);
  });

  it('reserves the session before asynchronous engine entry can admit a racing open', async () => {
    const { call } = await harness();
    const first = await call('POST', '/api/rounds');
    const second = await call('POST', '/api/rounds');

    const attempts = await Promise.all([
      call('POST', `/api/rounds/${first.body.roundId}/open`, {
        clientSeed: 'concurrent first',
        respondingTo: first.body.seedCommitment,
        stakeMicro: STAKE.toString(),
      }),
      call('POST', `/api/rounds/${second.body.roundId}/open`, {
        clientSeed: 'concurrent second',
        respondingTo: second.body.seedCommitment,
        stakeMicro: STAKE.toString(),
      }),
    ]);
    const accepted = attempts.find((attempt) => attempt.status === 200);
    const refused = attempts.find((attempt) => attempt.status === 409);
    expect(accepted).toBeDefined();
    expect(refused).toBeDefined();
    expect(refused.body.code).toBe('ROUND_ALREADY_OPEN');
    expect(refused.body.openRoundId).toBe(accepted.body.frame.roundId);

    const session = await call('GET', '/api/session');
    expect(session.body.openRoundId).toBe(accepted.body.frame.roundId);
    expect(session.body.wallet.stakedMicro).toBe(STAKE.toString());
    expect(session.body.wallet.balanceMicro).toBe((OPENING - STAKE).toString());
  });
});

describe('runner-name input', () => {
  it('rejects ambiguous or non-printable squads atomically and accepts five distinct trimmed names', async () => {
    const { call } = await harness();
    const initial = await call('GET', '/api/session');
    const fingerprint = (await call('GET', '/api/config')).body.game.fingerprint;
    const invalid = [
      [{}, {}, {}, {}, {}],
      ['One', 'Two', 'Three', 'Four'],
      ['One', 'Two', 'Three', 'Four', ''],
      ['One', 'Two', 'Three', 'Four', 'bad\nname'],
      ['One', 'Two', 'Three', 'Four', 'x'.repeat(17)],
      [' One ', 'Two', 'Three', 'Four', 'One'],
    ];

    for (const names of invalid) {
      const rejected = await call('POST', '/api/session', {
        showEverything: true,
        runnerNames: names,
      });
      expect(rejected.status).toBe(400);
      expect(rejected.body.code).toBe('INVALID_ARGUMENT');
      expect(rejected.body.code).not.toBe('INTERNAL');
      const after = await call('GET', '/api/session');
      expect(after.body.session.runnerNames).toEqual(initial.body.session.runnerNames);
      expect(after.body.session.showEverything).toBe(false);
    }

    const accepted = await call('POST', '/api/session', {
      runnerNames: [' Alder ', 'Birch', 'Cedar', 'Dawn', 'Elm'],
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.session.runnerNames).toEqual(['Alder', 'Birch', 'Cedar', 'Dawn', 'Elm']);
    expect((await call('GET', '/api/config')).body.game.fingerprint).toBe(fingerprint);
  });
});
