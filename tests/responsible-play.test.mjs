/**
 * The responsible-design controls, driven through the HTTP API.
 *
 * `docs/DESIGN.md` §10.2 opens with *"These are build requirements, not
 * aspirations. Each has an acceptance check."* This file is that acceptance
 * check for the four it names that are state rather than absence: the reality
 * check that fires at the operator's interval and pauses the game, the session
 * time limit, the session loss limit, and the self-exclusion hand-off.
 *
 * Every one of them is asserted against the **server**, because a limit a
 * modified client can skip is not a limit — the same reason the speed-of-play
 * floor is enforced by `advance()` and not by a disabled button. The session
 * clock is the store's clock, so `POST /api/dev/advance-clock` moves it and the
 * reality check can be proved to fire rather than reasoned about.
 *
 * The absences in §10.2 — no autoplay, no auto-rebet, no offer after a loss, no
 * countdown — are asserted in `tests/copy-discipline.test.mjs` and by the client
 * having no such endpoint to call.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/http.ts';

const STAKE = 5_000_000n;
const OPENING = 500_000_000n;

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

const advance = (ms) => call('POST', '/api/dev/advance-clock', { ms });

/** Buys a run: publishes a pre-commitment, then answers it with a stake. */
async function buy(stakeMicro = STAKE) {
  const published = await call('POST', '/api/rounds');
  if (published.status !== 200) return published;
  return call('POST', `/api/rounds/${published.body.roundId}/open`, {
    clientEntropy: 'a'.repeat(64),
    respondingTo: published.body.seedCommitment,
    stakeMicro: stakeMicro.toString(),
  });
}

beforeEach(async () => {
  app = createApp({ devClock: true, openingBalanceMicro: OPENING });
  await new Promise((resolve) => app.server.listen(0, resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => app.server.close(resolve));
});

describe('the reality check (§10.2)', () => {
  it('defaults to the operator interval of 30 minutes and is not due at the start', async () => {
    const { body } = await call('GET', '/api/session');
    expect(body.session.realityCheckIntervalMs).toBe(30 * 60 * 1000);
    // Due in one interval, less however many milliseconds the session has
    // already been alive for.
    expect(body.session.realityCheckDueMs).toBeGreaterThan(29 * 60 * 1000);
    expect(body.session.realityCheckDueMs).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  it('becomes due once the interval has passed, and is re-armed by acknowledging it', async () => {
    await call('POST', '/api/session', { realityCheckMinutes: 15 });
    await advance(14 * 60 * 1000);
    expect((await call('GET', '/api/session')).body.session.realityCheckDueMs).toBeGreaterThan(0);

    await advance(2 * 60 * 1000);
    expect((await call('GET', '/api/session')).body.session.realityCheckDueMs).toBe(0);

    const acknowledged = await call('POST', '/api/session', { acknowledgeRealityCheck: true });
    expect(acknowledged.body.session.realityCheckDueMs).toBe(15 * 60 * 1000);

    // And it fires again one interval later, rather than once per session.
    await advance(15 * 60 * 1000 + 1000);
    expect((await call('GET', '/api/session')).body.session.realityCheckDueMs).toBe(0);
  });

  it('refuses an interval outside the range it can honestly enforce', async () => {
    for (const minutes of [0, -30, 1000, 2.5, '30', null]) {
      const { status, body } = await call('POST', '/api/session', { realityCheckMinutes: minutes });
      expect(status).toBe(400);
      expect(body.code).toBe('INVALID_SETTING');
    }
    // The setting that was refused did not move.
    expect((await call('GET', '/api/session')).body.session.realityCheckIntervalMs).toBe(1_800_000);
  });

  it('does not block play by itself — it is a pause the client draws, not a lock', async () => {
    await call('POST', '/api/session', { realityCheckMinutes: 1 });
    await advance(2 * 60 * 1000);
    const opened = await buy();
    expect(opened.status).toBe(200);
    expect(opened.body.session.realityCheckDueMs).toBe(0);
  });
});

describe('session limits (§S9)', () => {
  it('stops taking stakes once the time limit has passed, and says which limit', async () => {
    await call('POST', '/api/session', { sessionLimitMinutes: 30 });
    expect((await buy()).status).toBe(200);

    await advance(31 * 60 * 1000);
    const blocked = await buy();
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('SESSION_LIMIT_REACHED');
    expect(blocked.body.message).toContain('30-minute limit');

    // Refused, so nothing was debited beyond the one round that was bought.
    expect(BigInt(blocked.body.wallet.balanceMicro)).toBe(OPENING - STAKE);
  });

  it('stops taking stakes once the loss limit is reached', async () => {
    await call('POST', '/api/session', { sessionLossLimitMicro: '4000000' });
    expect((await call('GET', '/api/session')).body.session.stakingBlock).toBeNull();

    const opened = await buy();
    expect(opened.status).toBe(200);

    // The stake alone is a 5.00 net loss until the round pays, which is exactly
    // the position the limit is about: money committed and not yet returned.
    // The block is already reported in the payload the buy itself returned.
    expect(opened.body.session.stakingBlock.code).toBe('LOSS_LIMIT_REACHED');
    const status = await call('GET', '/api/session');
    expect(status.body.session.stakingBlock.code).toBe('LOSS_LIMIT_REACHED');

    const blocked = await buy();
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('LOSS_LIMIT_REACHED');
  });

  it('never strands money already staked: the open round still finishes under a limit', async () => {
    const opened = await buy();
    expect(opened.status).toBe(200);
    const roundId = opened.body.frame.roundId;

    await call('POST', '/api/session', { sessionLimitMinutes: 1 });
    await advance(2 * 60 * 1000);
    expect((await buy()).status).toBe(403);

    const committed = await call('POST', `/api/rounds/${roundId}/commit`, {
      idempotencyKey: 'limit-commit',
      expectedFrameRevision: 0,
      route: 'WIDE',
    });
    expect(committed.status).toBe(200);
    const resolved = await call('POST', `/api/rounds/${roundId}/resolve`, {});
    expect(resolved.status).toBe(200);
    await advance(5000);
    const settled = resolved.body.frame.live.length === 0
      ? await call('POST', `/api/rounds/${roundId}/finish`, { idempotencyKey: 'limit-finish' })
      : await call('POST', `/api/rounds/${roundId}/bank`, {
          idempotencyKey: 'limit-bank',
          expectedFrameRevision: resolved.body.frame.frameRevision,
        });
    expect(settled.status).toBe(200);
    expect(settled.body.frame.settlement).not.toBeNull();
  });

  it('refuses a malformed limit and leaves the previous one standing', async () => {
    await call('POST', '/api/session', { sessionLimitMinutes: 60 });
    for (const value of [0, 5000, 'soon', 12.5]) {
      const { status, body } = await call('POST', '/api/session', { sessionLimitMinutes: value });
      expect(status).toBe(400);
      expect(body.code).toBe('INVALID_SETTING');
    }
    for (const value of ['-1', 'lots', 0, '0', 12]) {
      const { status } = await call('POST', '/api/session', { sessionLossLimitMicro: value });
      expect(status).toBe(400);
    }
    expect((await call('GET', '/api/session')).body.session.sessionLimitMinutes).toBe(60);
  });

  it('clears a limit when the player clears it, which is not the same as never setting one', async () => {
    await call('POST', '/api/session', { sessionLimitMinutes: 30 });
    await advance(31 * 60 * 1000);
    expect((await buy()).status).toBe(403);

    await call('POST', '/api/session', { sessionLimitMinutes: null });
    const reopened = await buy();
    expect(reopened.status).toBe(200);
  });
});

describe('the self-exclusion hand-off (§S9)', () => {
  it('is one-way for the life of the session', async () => {
    expect((await buy()).status).toBe(200);
    await call('POST', '/api/session', { selfExclude: true });

    const blocked = await buy();
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('SELF_EXCLUDED');

    // There is no field that turns it off. Sending the opposite does nothing.
    await call('POST', '/api/session', { selfExclude: false, selfExcluded: false });
    expect((await call('GET', '/api/session')).body.session.selfExcluded).toBe(true);
    expect((await buy()).status).toBe(403);
  });
});

describe('the rest of the §S9 controls', () => {
  it('carries the audio and quality-tier preferences, and refuses an unknown tier', async () => {
    const on = await call('POST', '/api/session', { audioEnabled: true, qualityTier: 'low' });
    expect(on.body.session.audioEnabled).toBe(true);
    expect(on.body.session.qualityTier).toBe('low');

    const bad = await call('POST', '/api/session', { qualityTier: 'ultra' });
    expect(bad.status).toBe(400);
    expect((await call('GET', '/api/session')).body.session.qualityTier).toBe('low');
  });
});
