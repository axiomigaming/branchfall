/**
 * The browser verifier against a round produced by the real HTTP application.
 *
 * This test does not manufacture a transcript. It publishes a pre-commitment,
 * contributes player entropy, runs WIDE, SPLIT and SHELTER choices, settles the
 * money-bearing round and fetches the same verification bundle the UI receives.
 * Only then does the independent browser implementation see the revealed seed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COMMITMENT_VERSION as ENGINE_COMMITMENT_VERSION,
  ENGINE_API_VERSION as ENGINE_ENGINE_API_VERSION,
  STAGED_SURVIVAL_MODULE_ID as ENGINE_STAGED_SURVIVAL_MODULE_ID,
  STAGED_SURVIVAL_MODULE_VERSION as ENGINE_STAGED_SURVIVAL_MODULE_VERSION,
  TRANSCRIPT_SCHEMA as ENGINE_TRANSCRIPT_SCHEMA,
} from '@axiom-games/reveal-engine/modules/staged-survival';
import {
  COMMITMENT_VERSION,
  ENGINE_API_VERSION,
  STAGED_SURVIVAL_MODULE_ID,
  STAGED_SURVIVAL_MODULE_VERSION,
  TRANSCRIPT_SCHEMA,
  rederive,
} from '../client/src/derive.ts';
import { FINGERPRINT } from '../server/definition.ts';
import { createApp } from '../server/http.ts';

const SEED = '0000000000000000000000000000000000000000000000000000000000000054';
const FLIPPED_SEED =
  '0000000000000000000000000000000000000000000000000000000000000055';
const ROUND_ID = 'bf-1-playthru';
const CLIENT_ENTROPY = 'a'.repeat(64);
const STAKE_MICRO = '5000000';
const EXPECTED_DRAW_COUNT = 5 * 6 * 5 * 2;

let app;
let base;
let bundle;
let preCommitment;
let measuredElapsedMs = Number.NaN;

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const tick = () => call('POST', '/api/dev/advance-clock', { ms: 5000 });

function inputFor(transcript = bundle.transcript, overrides = {}) {
  return {
    revealedServerSeed: bundle.revealedServerSeed,
    transcript,
    preCommitment,
    publishedFingerprint: bundle.definition.fingerprint,
    ...overrides,
  };
}

beforeAll(async () => {
  app = createApp({
    devClock: true,
    seedSource: () => SEED,
    roundIdSource: () => ROUND_ID,
  });
  await new Promise((resolve) => app.server.listen(0, resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;

  const published = await call('POST', '/api/rounds');
  expect(published.status).toBe(200);
  preCommitment = published.body.seedCommitment;

  const opened = await call('POST', `/api/rounds/${ROUND_ID}/open`, {
    clientEntropy: CLIENT_ENTROPY,
    respondingTo: preCommitment,
    stakeMicro: STAKE_MICRO,
  });
  expect(opened.status).toBe(200);

  const wide = await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
    idempotencyKey: 'derive-wide',
    expectedFrameRevision: 0,
    route: 'WIDE',
  });
  expect(wide.status).toBe(200);
  expect((await call('POST', `/api/rounds/${ROUND_ID}/resolve`, {})).status).toBe(200);
  await tick();

  const split = await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
    idempotencyKey: 'derive-split',
    expectedFrameRevision: 1,
    route: 'SPLIT',
    laneSplit: 3,
  });
  expect(split.status).toBe(200);
  expect((await call('POST', `/api/rounds/${ROUND_ID}/resolve`, {})).status).toBe(200);
  await tick();

  const beforeShelter = await call('GET', `/api/rounds/${ROUND_ID}`);
  const shelter = await call('POST', `/api/rounds/${ROUND_ID}/commit`, {
    idempotencyKey: 'derive-shelter',
    expectedFrameRevision: 2,
    route: 'SHELTER',
    shelter: beforeShelter.body.frame.live.slice(0, 2),
  });
  expect(shelter.status).toBe(200);
  expect((await call('POST', `/api/rounds/${ROUND_ID}/resolve`, {})).status).toBe(200);
  await tick();

  const banked = await call('POST', `/api/rounds/${ROUND_ID}/bank`, {
    idempotencyKey: 'derive-bank',
    expectedFrameRevision: 3,
  });
  expect(banked.status).toBe(200);

  const verification = await call('GET', `/api/rounds/${ROUND_ID}/verify`);
  expect(verification.status).toBe(200);
  expect(verification.body.report.ok).toBe(true);
  bundle = verification.body.bundle;
});

afterAll(async () => {
  await new Promise((resolve) => app.server.close(resolve));
});

describe('independent browser-side round derivation', () => {
  it('pins every engine constant that enters or selects the canonical proof', () => {
    expect(ENGINE_API_VERSION).toBe(ENGINE_ENGINE_API_VERSION);
    expect(COMMITMENT_VERSION).toBe(ENGINE_COMMITMENT_VERSION);
    expect(STAGED_SURVIVAL_MODULE_ID).toBe(ENGINE_STAGED_SURVIVAL_MODULE_ID);
    expect(STAGED_SURVIVAL_MODULE_VERSION).toBe(ENGINE_STAGED_SURVIVAL_MODULE_VERSION);
    expect(TRANSCRIPT_SCHEMA).toBe(ENGINE_TRANSCRIPT_SCHEMA);
  });

  it('reconstructs the complete tape and every played arena from the HTTP bundle', async () => {
    const result = await rederive(inputFor());
    measuredElapsedMs = result.elapsedMs;

    expect(result.available, result.reason).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.fingerprint).toBe(FINGERPRINT);
    expect(result.fingerprintMatches).toBe(true);
    expect(result.seedCommitment).toBe(preCommitment);
    expect(result.commitmentMatches).toBe(true);
    expect(result.tapeDigest).toBe(bundle.transcript.tapeDigest);
    expect(result.digestMatches).toBe(true);
    expect(result.drawCount).toBe(EXPECTED_DRAW_COUNT);
    expect(result.arenas).toHaveLength(bundle.transcript.steps.length);
    expect(result.elapsedMs).toBeLessThan(1000);

    result.arenas.forEach((arena, index) => {
      const step = bundle.transcript.steps[index];
      expect(arena.matchesTranscript).toBe(true);
      expect(arena.survivors).toEqual(step.survivors);
      expect(arena.failed).toEqual(step.failed);
      expect(arena.lanes.map((lane) => lane.collapsed)).toEqual(
        step.lanes.map((lane) => lane.collapsed),
      );
      expect(arena.lanes.every((lane) => /^[0-9]+$/u.test(lane.draw))).toBe(true);
      expect(arena.entities.every((entity) => /^[0-9]+$/u.test(entity.draw))).toBe(true);
    });
  });

  it('rejects a one-bit server-seed change through both the commitment and arenas', async () => {
    const result = await rederive(inputFor(bundle.transcript, {
      revealedServerSeed: FLIPPED_SEED,
    }));

    expect(result.available, result.reason).toBe(true);
    expect(result.commitmentMatches).toBe(false);
    expect(result.arenas.some((arena) => !arena.matchesTranscript)).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('identifies the arena whose published survivors were edited', async () => {
    const transcript = structuredClone(bundle.transcript);
    transcript.steps[0].survivors = transcript.steps[0].survivors.slice(0, -1);
    const result = await rederive(inputFor(transcript));

    expect(result.available, result.reason).toBe(true);
    expect(result.arenas[0].matchesTranscript).toBe(false);
    expect(result.arenas.slice(1).every((arena) => arena.matchesTranscript)).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('does not accept a different published definition fingerprint', async () => {
    const result = await rederive(inputFor(bundle.transcript, {
      publishedFingerprint: 'f'.repeat(64),
    }));

    expect(result.available, result.reason).toBe(true);
    expect(result.fingerprint).toBe(FINGERPRINT);
    expect(result.fingerprintMatches).toBe(false);
    expect(result.ok).toBe(false);
  });

  it.each([
    ['null transcript', null, /transcript must be an object/iu],
    ['empty transcript', {}, /transcript schema is missing/iu],
    [
      'unknown step contract',
      () => {
        const transcript = structuredClone(bundle.transcript);
        transcript.steps[0].contractId = 'UNKNOWN_CONTRACT';
        return transcript;
      },
      /step 0 names unknown contract/iu,
    ],
  ])('returns a specific unavailable result for a malformed %s', async (_label, sample, reason) => {
    const transcript = typeof sample === 'function' ? sample() : sample;
    const result = await rederive(inputFor(transcript));

    expect(result.available).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(reason);
  });
});

afterAll(() => {
  if (Number.isFinite(measuredElapsedMs))
    console.info(`client re-derivation measured ${measuredElapsedMs.toFixed(2)} ms for 300 HMAC draws`);
});
