#!/usr/bin/env node
/**
 * BRANCHFALL — reference commit-reveal transcript.
 *
 * The 3D crowd/ragdoll presentation is a deterministic replay of this
 * transcript. Client physics never decides money: the transcript decides who
 * falls, and the renderer is told.
 *
 * Lifecycle
 * ---------
 *   1. The operator draws a 32-byte seed and derives the COMPLETE hazard table
 *      for every arena, every route contract and every lane — including the
 *      routes the player will not take.
 *   2. The operator publishes `commitment = H(seed, hazard table)` BEFORE the
 *      player makes any choice.
 *   3. The player plays. Their choices select which pre-committed draws are
 *      consumed; they cannot change any draw.
 *   4. At settlement the seed is revealed. Anyone re-derives the table, checks
 *      the commitment, and replays the action list to reproduce every credit.
 *
 * Counterfactual completeness is deliberate. Because the table covers routes
 * the player did not take, no operator can adapt outcomes to a player's
 * choice, and the "Ghost Line" replay (docs/DESIGN.md) is provable rather than
 * decorative.
 *
 * Usage:
 *   node tools/transcript.mjs                       demo round
 *   node tools/transcript.mjs --seed <64 hex> --round <id>
 *   node tools/transcript.mjs --fixture             emit the frozen wire fixture
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { F, Frac } from './lib/exact.mjs';
import { CONFIG, CONTRACTS, CONTRACT_IDS, laneSizes } from './lib/model.mjs';

export const SCHEMA = 'branchfall/transcript-v1';
export const COMMITMENT_VERSION = 'branchfall/commit-v1';
export const SAMPLER_VERSION = 'branchfall/hazard-v1';

/** Hard limits at the untrusted-input boundary. */
export const LIMITS = Object.freeze({
  maxRoundIdBytes: 64,
  maxStakeMicro: 10n ** 15n,
  seedHexLength: 64,
});

export class TranscriptError extends Error {
  /** @param {string} code @param {string} message @param {string} [path] */
  constructor(code, message, path = '$') {
    super(message);
    this.name = 'TranscriptError';
    this.code = code;
    this.path = path;
  }
}

function fail(code, message, path) {
  throw new TranscriptError(code, message, path);
}

/* ------------------------------------------------------------------ *
 * canonical encoding — unambiguous, length-prefixed, type-tagged
 * ------------------------------------------------------------------ */

const TAG = Object.freeze({ STRING: 1, INTEGER: 2, BIGINT: 3, BYTES: 4 });

/** @param {Array<string|number|bigint|Uint8Array>} fields @returns {Buffer} */
export function encodeFields(fields) {
  if (!Array.isArray(fields)) fail('INVALID_ENCODING', 'encodeFields expects an array');
  const parts = [];
  for (const field of fields) {
    let tag;
    let payload;
    if (typeof field === 'string') {
      tag = TAG.STRING;
      payload = Buffer.from(field, 'utf8');
    } else if (typeof field === 'number') {
      if (!Number.isSafeInteger(field)) fail('INVALID_ENCODING', 'Only safe integers may be encoded');
      tag = TAG.INTEGER;
      payload = Buffer.from(String(field), 'utf8');
    } else if (typeof field === 'bigint') {
      tag = TAG.BIGINT;
      payload = Buffer.from(field.toString(), 'utf8');
    } else if (field instanceof Uint8Array) {
      tag = TAG.BYTES;
      payload = Buffer.from(field);
    } else {
      return fail('INVALID_ENCODING', `Unsupported field type: ${typeof field}`);
    }
    const header = Buffer.alloc(5);
    header.writeUInt8(tag, 0);
    header.writeUInt32BE(payload.length, 1);
    parts.push(header, payload);
  }
  return Buffer.concat(parts);
}

/** @param {string} seedHex */
export function normalizeSeed(seedHex) {
  if (typeof seedHex !== 'string' || !/^[0-9a-fA-F]{64}$/u.test(seedHex)) {
    fail('INVALID_SEED', 'Seed must be exactly 32 bytes of hexadecimal', '$.seed');
  }
  return seedHex.toLowerCase();
}

/** @param {string} roundId */
export function normalizeRoundId(roundId) {
  if (typeof roundId !== 'string' || roundId.length === 0) {
    fail('INVALID_ROUND_ID', 'roundId must be a non-empty string', '$.roundId');
  }
  if (Buffer.byteLength(roundId, 'utf8') > LIMITS.maxRoundIdBytes) {
    fail('INVALID_ROUND_ID', 'roundId exceeds the published limit', '$.roundId');
  }
  if (!/^[\x20-\x7e]+$/u.test(roundId)) {
    fail('INVALID_ROUND_ID', 'roundId must be printable ASCII', '$.roundId');
  }
  return roundId;
}

/* ------------------------------------------------------------------ *
 * deterministic sampler — HMAC-SHA256 with exact rejection sampling
 * ------------------------------------------------------------------ */

const RANGE = 1n << 256n;

/**
 * Uniform integer in [0, modulus) derived from the seed. Rejection sampling
 * keeps the distribution exactly uniform: no modulo bias, ever.
 * @param {string} seedHex
 * @param {Array<string|number|bigint>} label
 * @param {bigint} modulus
 * @returns {bigint}
 */
export function uniformBigInt(seedHex, label, modulus) {
  const seed = normalizeSeed(seedHex);
  if (typeof modulus !== 'bigint' || modulus <= 0n || modulus >= RANGE) {
    fail('INVALID_MODULUS', 'Modulus must be a BigInt in [1, 2^256)', '$.modulus');
  }
  const limit = RANGE - (RANGE % modulus);
  const key = Buffer.from(seed, 'hex');
  for (let nonce = 0n; ; nonce += 1n) {
    const digest = createHmac('sha256', key)
      .update(encodeFields([SAMPLER_VERSION, ...label, nonce, modulus]))
      .digest('hex');
    const value = BigInt(`0x${digest}`);
    if (value < limit) return value % modulus;
  }
}

/* ------------------------------------------------------------------ *
 * hazard table
 * ------------------------------------------------------------------ */

/**
 * The complete, counterfactually complete hazard table for a round.
 * Shape: hazard[arena-1][contractId] = [{ collapse, slips: number[squadSize] }, ...lanes]
 * @param {string} seedHex
 * @param {string} roundId
 */
export function deriveHazardTable(seedHex, roundId) {
  const seed = normalizeSeed(seedHex);
  const round = normalizeRoundId(roundId);
  const arenas = [];
  for (let arena = 1; arena <= CONFIG.arenas; arena += 1) {
    /** @type {Record<string, {collapse:number, slips:number[]}[]>} */
    const byContract = {};
    for (const id of CONTRACT_IDS) {
      const spec = CONTRACTS[id];
      const lanes = [];
      for (let lane = 0; lane < spec.laneCount; lane += 1) {
        const collapse = Number(
          uniformBigInt(seed, [CONFIG.gameId, round, arena, id, lane, 'collapse', 0], spec.collapse.d),
        );
        const slips = [];
        for (let slot = 0; slot < CONFIG.squadSize; slot += 1) {
          slips.push(
            Number(uniformBigInt(seed, [CONFIG.gameId, round, arena, id, lane, 'slip', slot], spec.clear.d)),
          );
        }
        lanes.push(Object.freeze({ collapse, slips: Object.freeze(slips) }));
      }
      byContract[id] = Object.freeze(lanes);
    }
    arenas.push(Object.freeze(byContract));
  }
  return Object.freeze(arenas);
}

/** Canonical bytes of the hazard table — the thing the operator commits to. */
export function canonicalHazardBytes(roundId, hazard) {
  const fields = [
    'BRANCHFALL hazard table',
    SCHEMA,
    CONFIG.gameId,
    CONFIG.adapterVersion,
    CONFIG.modelVersion,
    normalizeRoundId(roundId),
    CONFIG.squadSize,
    CONFIG.arenas,
  ];
  hazard.forEach((arena, arenaIndex) => {
    for (const id of CONTRACT_IDS) {
      arena[id].forEach((lane, laneIndex) => {
        fields.push(arenaIndex + 1, id, laneIndex, lane.collapse);
        lane.slips.forEach((slip, slot) => fields.push(slot, slip));
      });
    }
  });
  return encodeFields(fields);
}

/** @param {string} seedHex @param {string} roundId @param {ReturnType<typeof deriveHazardTable>} hazard */
export function commitment(seedHex, roundId, hazard) {
  const seed = normalizeSeed(seedHex);
  return createHash('sha256')
    .update(
      encodeFields([
        'commitment',
        COMMITMENT_VERSION,
        Buffer.from(seed, 'hex'),
        canonicalHazardBytes(roundId, hazard),
      ]),
    )
    .digest('hex');
}

/** Build a full pre-round commitment (published before the player chooses). */
export function openRound(seedHex, roundId) {
  const seed = normalizeSeed(seedHex);
  const round = normalizeRoundId(roundId);
  const hazard = deriveHazardTable(seed, round);
  return Object.freeze({
    schema: SCHEMA,
    gameId: CONFIG.gameId,
    adapterVersion: CONFIG.adapterVersion,
    modelVersion: CONFIG.modelVersion,
    roundId: round,
    commitment: commitment(seed, round, hazard),
    hazard,
  });
}

/* ------------------------------------------------------------------ *
 * replay
 * ------------------------------------------------------------------ */

/**
 * @typedef {{type:'BANK'}
 *   | {type:'ROUTE', contract: 'WIDE'|'SPLIT'|'NARROW'}
 *   | {type:'SHELTER', shelter: number[]}} ReplayAction
 */

/** @param {number[]} running @param {'WIDE'|'SPLIT'|'NARROW'} id */
function assignLanes(running, id) {
  const sizes = laneSizes(id, running.length);
  const lanes = [];
  let cursor = 0;
  for (const size of sizes) {
    lanes.push(running.slice(cursor, cursor + size));
    cursor += size;
  }
  return lanes;
}

/**
 * Resolve one arena from the pre-committed hazard table.
 * @returns {{survivors: number[], fallen: {slot:number, cause:'collapse'|'slip', lane:number}[], lanes: number[][], collapsed: boolean[]}}
 */
export function resolveArena(hazard, arena, contractId, running) {
  const spec = CONTRACTS[contractId];
  const laneDraws = hazard[arena - 1][contractId];
  const lanes = assignLanes(running, contractId);
  const survivors = [];
  const fallen = [];
  const collapsed = [];
  lanes.forEach((members, laneIndex) => {
    const draws = laneDraws[laneIndex];
    const laneCollapsed = BigInt(draws.collapse) < spec.collapse.n;
    collapsed.push(laneCollapsed);
    for (const slot of members) {
      if (laneCollapsed) {
        fallen.push({ slot, cause: 'collapse', lane: laneIndex });
        continue;
      }
      if (BigInt(draws.slips[slot]) < spec.clear.n) survivors.push(slot);
      else fallen.push({ slot, cause: 'slip', lane: laneIndex });
    }
  });
  survivors.sort((a, b) => a - b);
  return { survivors, fallen, lanes, collapsed };
}

/** Chain cap, mirroring the engine's `payableWithinCap`. */
function creditWithinCap(theoretical, stakeMicro, maxWinMultiple, alreadyCredited) {
  const uncapped = theoretical.floor();
  const ceiling = stakeMicro * maxWinMultiple;
  const remaining = ceiling > alreadyCredited ? ceiling - alreadyCredited : 0n;
  const credited = uncapped > remaining ? remaining : uncapped;
  return { credited, capped: uncapped > remaining };
}

/**
 * Replay a round: deterministic, exact, and reproducible from the seed alone.
 * @param {{roundId: string, hazard: any}} round
 * @param {{stakeMicro: bigint, actions: ReplayAction[]}} play
 */
export function replayRound(round, play) {
  const stake = play.stakeMicro;
  if (typeof stake !== 'bigint' || stake < CONFIG.minStakeMicro || stake > LIMITS.maxStakeMicro) {
    fail('INVALID_STAKE', 'Stake must be a BigInt within the published limits', '$.stakeMicro');
  }
  if (!Array.isArray(play.actions) || play.actions.length === 0 || play.actions.length > CONFIG.arenas) {
    fail('INVALID_ACTIONS', `actions must be an array of 1..${CONFIG.arenas} entries`, '$.actions');
  }

  let alive = Array.from({ length: CONFIG.squadSize }, (_, i) => i);
  let claim = CONFIG.rtp; // as a multiple of the stake
  let creditedMicro = 0n;
  let capped = false;
  const ledger = [];

  for (let arena = 1; arena <= CONFIG.arenas; arena += 1) {
    const action = play.actions[arena - 1];
    if (!action) break;
    if (alive.length === 0) fail('INVALID_ACTIONS', 'No runners left to act', `$.actions[${arena - 1}]`);

    if (action.type === 'BANK') {
      if (arena === 1) fail('ILLEGAL_ACTION', 'Banking is unavailable before the first arena', `$.actions[0]`);
      ledger.push(Object.freeze({ arena, action: 'BANK', alive: [...alive], claimBefore: claim.toString() }));
      break;
    }

    let running = alive;
    let sheltered = [];
    let contractId;

    if (action.type === 'SHELTER') {
      const chosen = action.shelter;
      if (!Array.isArray(chosen) || chosen.length < 1 || chosen.length > alive.length - 1) {
        fail('ILLEGAL_ACTION', 'SHELTER must withdraw between 1 and alive-1 runners', `$.actions[${arena - 1}]`);
      }
      const unique = new Set(chosen);
      if (unique.size !== chosen.length || chosen.some((s) => !alive.includes(s))) {
        fail('ILLEGAL_ACTION', 'SHELTER must name distinct living runners', `$.actions[${arena - 1}]`);
      }
      sheltered = [...unique].sort((a, b) => a - b);
      running = alive.filter((s) => !unique.has(s));
      contractId = 'WIDE';
      const share = claim.mul(F(BigInt(sheltered.length), BigInt(alive.length)));
      const result = creditWithinCap(share.mul(F(stake)), stake, CONFIG.maxWinMultiple, creditedMicro);
      creditedMicro += result.credited;
      capped = capped || result.capped;
      claim = claim.mul(F(BigInt(running.length), BigInt(alive.length)));
    } else if (action.type === 'ROUTE') {
      contractId = action.contract;
      if (!CONTRACT_IDS.includes(contractId)) {
        fail('UNKNOWN_CONTRACT', `Unknown contract ${String(contractId)}`, `$.actions[${arena - 1}]`);
      }
      if (running.length < CONTRACTS[contractId].minRunners) {
        fail('ILLEGAL_ACTION', `${contractId} requires ${CONTRACTS[contractId].minRunners} runners`, `$.actions[${arena - 1}]`);
      }
    } else {
      fail('INVALID_ACTION', `Unknown action type ${String(action.type)}`, `$.actions[${arena - 1}]`);
    }

    const before = claim;
    const outcome = resolveArena(round.hazard, arena, contractId, running);
    const mu = Frac.ONE.div(Frac.ONE.sub(CONTRACTS[contractId].collapse).mul(CONTRACTS[contractId].clear));
    claim = running.length === 0
      ? Frac.ZERO
      : claim.mul(F(BigInt(outcome.survivors.length), BigInt(running.length))).mul(mu);
    alive = outcome.survivors;

    ledger.push(
      Object.freeze({
        arena,
        action: action.type === 'SHELTER' ? 'SHELTER' : 'ROUTE',
        contract: contractId,
        sheltered,
        running: [...running],
        lanes: outcome.lanes.map((l) => [...l]),
        collapsed: [...outcome.collapsed],
        survivors: [...outcome.survivors],
        fallen: outcome.fallen.map((f) => ({ ...f })),
        claimBefore: before.toString(),
        claimAfter: claim.toString(),
      }),
    );

    if (alive.length === 0) break;
  }

  const settlement = creditWithinCap(claim.mul(F(stake)), stake, CONFIG.maxWinMultiple, creditedMicro);
  creditedMicro += settlement.credited;
  capped = capped || settlement.capped;

  return Object.freeze({
    stakeMicro: stake.toString(),
    ledger: Object.freeze(ledger),
    survivorsBanked: [...alive],
    finalClaim: claim.toString(),
    creditedMicro: creditedMicro.toString(),
    returnMultiple: F(creditedMicro, stake).toString(),
    capped,
  });
}

/**
 * Verify a revealed round end to end: re-derive the hazard table from the seed,
 * recompute the commitment, and replay the recorded actions.
 */
export function verifyRound(seedHex, published, play) {
  try {
    const seed = normalizeSeed(seedHex);
    if (!published || published.schema !== SCHEMA) {
      return { ok: false, code: 'UNSUPPORTED_VERSION', message: 'Unknown transcript schema', path: '$.schema' };
    }
    if (published.adapterVersion !== CONFIG.adapterVersion || published.modelVersion !== CONFIG.modelVersion) {
      return { ok: false, code: 'ADAPTER_MISMATCH', message: 'Transcript was produced by a different adapter', path: '$.adapterVersion' };
    }
    const hazard = deriveHazardTable(seed, published.roundId);
    const expected = commitment(seed, published.roundId, hazard);
    if (expected !== published.commitment) {
      return { ok: false, code: 'COMMITMENT_MISMATCH', message: 'Commitment does not match the revealed seed', path: '$.commitment' };
    }
    const replay = replayRound({ roundId: published.roundId, hazard }, play);
    return { ok: true, commitment: expected, replay };
  } catch (error) {
    if (error instanceof TranscriptError) {
      return { ok: false, code: error.code, message: error.message, path: error.path };
    }
    return { ok: false, code: 'VERIFICATION_FAILED', message: 'Verification failed', path: '$' };
  }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

/** The frozen wire fixture used by tests/wire-format.test.mjs. */
export const FIXTURE_INPUT = Object.freeze({
  seed: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  roundId: 'branchfall-fixture-0001',
  stakeMicro: '10000000',
  actions: [
    { type: 'ROUTE', contract: 'SPLIT' },
    { type: 'ROUTE', contract: 'WIDE' },
    { type: 'SHELTER', shelter: [0] },
    { type: 'ROUTE', contract: 'NARROW' },
    { type: 'BANK' },
  ],
});

export function buildFixture() {
  const round = openRound(FIXTURE_INPUT.seed, FIXTURE_INPUT.roundId);
  const replay = replayRound(round, {
    stakeMicro: BigInt(FIXTURE_INPUT.stakeMicro),
    actions: FIXTURE_INPUT.actions,
  });
  return {
    schema: SCHEMA,
    input: FIXTURE_INPUT,
    commitment: round.commitment,
    hazard: round.hazard,
    replay,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (argv.includes('--fixture')) {
    process.stdout.write(`${JSON.stringify(buildFixture(), null, 2)}\n`);
    return;
  }

  const seed = flag('--seed') ?? randomBytes(32).toString('hex');
  const roundId = flag('--round') ?? 'demo-round';
  const round = openRound(seed, roundId);
  const play = {
    stakeMicro: 10_000_000n,
    actions: [
      { type: 'ROUTE', contract: 'SPLIT' },
      { type: 'ROUTE', contract: 'WIDE' },
      { type: 'SHELTER', shelter: [0] },
      { type: 'ROUTE', contract: 'NARROW' },
      { type: 'BANK' },
    ],
  };
  const replay = replayRound(round, play);
  const verified = verifyRound(seed, round, play);

  process.stdout.write('BRANCHFALL — reference round\n');
  process.stdout.write('============================\n');
  process.stdout.write(`roundId     ${roundId}\n`);
  process.stdout.write(`commitment  ${round.commitment}   (published before any choice)\n`);
  process.stdout.write(`seed        ${seed}   (revealed at settlement)\n\n`);
  for (const entry of replay.ledger) {
    if (entry.action === 'BANK') {
      process.stdout.write(`  arena ${entry.arena}  BANK        claim=${entry.claimBefore}\n`);
      continue;
    }
    process.stdout.write(
      `  arena ${entry.arena}  ${entry.action.padEnd(8)} ${String(entry.contract).padEnd(6)} ` +
        `lanes=[${entry.lanes.map((l) => l.join('')).join('|')}] collapsed=[${entry.collapsed.join(',')}] ` +
        `survivors=[${entry.survivors.join(',')}] claim ${entry.claimBefore} -> ${entry.claimAfter}\n`,
    );
  }
  process.stdout.write(
    `\n  banked runners  [${replay.survivorsBanked.join(',')}]\n` +
      `  credited        ${replay.creditedMicro} micro-credits (${replay.returnMultiple}x stake)\n` +
      `  capped          ${replay.capped}\n` +
      `  verification    ${verified.ok ? 'OK' : `FAILED ${verified.code}`}\n`,
  );
  if (!verified.ok) process.exitCode = 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) main();
