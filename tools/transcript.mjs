#!/usr/bin/env node
/**
 * BRANCHFALL — reference commit-reveal transcript.
 *
 * The 3D crowd/ragdoll presentation is a deterministic replay of this
 * transcript. Client physics never decides money: the transcript decides who
 * falls, and the renderer is told.
 *
 * Lifecycle — TWO-SIDED, and that is the point
 * --------------------------------------------
 *   1. The operator draws a 32-byte SERVER SEED and publishes
 *      `serverCommitment = H(server seed, roundId)` — before the player exists
 *      in this round and before any client entropy is known.
 *   2. The player's client generates a CLIENT SEED locally and sends it. The
 *      player may edit it, and the operator must accept whatever arrives.
 *   3. Only now is the hazard table derived, from BOTH seeds. It is complete —
 *      every arena, every route contract, every lane, including routes the
 *      player will not take — and its digest is published immediately.
 *   4. The player plays. Their choices select which pre-committed draws are
 *      consumed; they cannot change any draw.
 *   5. At settlement the server seed is revealed. Anyone re-derives the table,
 *      checks both the commitment and the digest, and replays the action list
 *      to reproduce every credit.
 *
 * Why the client seed is mandatory, not a nicety
 * ---------------------------------------------
 * With a server-only seed the operator draws the seed, derives the whole
 * counterfactually-complete table, and only then publishes a commitment —
 * so nothing forces it to publish the FIRST seed it drew. Grinding candidate
 * seeds against the player's likely policy is cheap (~120 HMACs each) and
 * silent: every ground round still verifies, because the commitment matches,
 * the seed reveals cleanly and the replay reproduces the ledger exactly.
 * Mixing entropy the operator cannot see at commit time is what closes it.
 * `buildSeedChain()` closes the residual (operator choosing WHICH server seed
 * to commit) by pre-committing the whole sequence.
 *
 * Usage:
 *   node tools/transcript.mjs                       demo round
 *   node tools/transcript.mjs --server <64 hex> --client <text> --round <id>
 *   node tools/transcript.mjs --fixture             emit the frozen wire fixture
 *   node tools/transcript.mjs --chain 8             demo a pre-committed seed chain
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { F, Frac } from './lib/exact.mjs';
import {
  CONFIG,
  CONTRACTS,
  CONTRACT_IDS,
  SIDE_BET_IDS,
  laneSizes,
  laneSplitsFor,
  sideBetOffers,
} from './lib/model.mjs';

export const SCHEMA = 'branchfall/transcript-v2';
export const COMMITMENT_VERSION = 'branchfall/commit-v2';
export const SAMPLER_VERSION = 'branchfall/hazard-v2';
export const CHAIN_VERSION = 'branchfall/seed-chain-v1';

/** Hard limits at the untrusted-input boundary. */
export const LIMITS = Object.freeze({
  maxRoundIdBytes: 64,
  maxClientSeedBytes: 64,
  maxStakeMicro: 10n ** 15n,
  seedHexLength: 64,
  maxChainLength: 1_000_000,
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
    fail('INVALID_SEED', 'Server seed must be exactly 32 bytes of hexadecimal', '$.serverSeed');
  }
  return seedHex.toLowerCase();
}

/**
 * The client seed is player-controlled and therefore deliberately permissive:
 * any 1..64 bytes of printable ASCII. The player must be able to type one.
 * @param {string} clientSeed
 */
export function normalizeClientSeed(clientSeed) {
  if (typeof clientSeed !== 'string' || clientSeed.length === 0) {
    fail('INVALID_CLIENT_SEED', 'clientSeed must be a non-empty string', '$.clientSeed');
  }
  if (Buffer.byteLength(clientSeed, 'utf8') > LIMITS.maxClientSeedBytes) {
    fail('INVALID_CLIENT_SEED', 'clientSeed exceeds the published limit', '$.clientSeed');
  }
  if (!/^[\x20-\x7e]+$/u.test(clientSeed)) {
    fail('INVALID_CLIENT_SEED', 'clientSeed must be printable ASCII', '$.clientSeed');
  }
  return clientSeed;
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
 * pre-commitment: the server seed, fixed before any client entropy exists
 * ------------------------------------------------------------------ */

/**
 * Published in step 1, before the player supplies anything. Binds the server
 * seed to the round id so the operator cannot shop for a round id either.
 * @param {string} serverSeedHex
 * @param {string} roundId
 */
export function serverCommitment(serverSeedHex, roundId) {
  const seed = normalizeSeed(serverSeedHex);
  const round = normalizeRoundId(roundId);
  return createHash('sha256')
    .update(
      encodeFields([
        'server commitment',
        COMMITMENT_VERSION,
        CONFIG.gameId,
        CONFIG.adapterVersion,
        CONFIG.modelVersion,
        round,
        Buffer.from(seed, 'hex'),
      ]),
    )
    .digest('hex');
}

/**
 * A pre-committed server-seed chain. The operator publishes only `terminal`,
 * long before any of these rounds are played, and then reveals the chain in
 * reverse — `chain[length-2]`, `chain[length-3]`, ... Each revealed seed is
 * verified by hashing it forward one step. The operator cannot choose a seed
 * per round because the whole sequence was fixed by a single public value.
 *
 * @param {string} rootHex 32-byte hex root, never published
 * @param {number} length
 * @returns {{version: string, length: number, seeds: string[], terminal: string}}
 */
export function buildSeedChain(rootHex, length) {
  const root = normalizeSeed(rootHex);
  if (!Number.isSafeInteger(length) || length < 2 || length > LIMITS.maxChainLength) {
    fail('INVALID_CHAIN', `Chain length must be an integer in [2, ${LIMITS.maxChainLength}]`, '$.length');
  }
  const seeds = [root];
  for (let i = 1; i < length; i += 1) {
    seeds.push(createHash('sha256').update(Buffer.from(seeds[i - 1], 'hex')).digest('hex'));
  }
  return Object.freeze({
    version: CHAIN_VERSION,
    length,
    seeds: Object.freeze(seeds),
    terminal: seeds[length - 1],
  });
}

/**
 * Verify one revealed link of a seed chain: `SHA256(revealed) == nextHash`.
 *
 * Sound as far as it goes, and NOT sufficient on its own: one link proves the
 * revealed seed hashes to some published value, not that it is the seed for
 * *this* round of *that* chain. Use `verifyChainPosition()`, which is what
 * `openRound()` and `verifyRound()` actually enforce.
 *
 * @param {string} revealedSeedHex
 * @param {string} nextHashHex
 */
export function verifyChainLink(revealedSeedHex, nextHashHex) {
  const revealed = normalizeSeed(revealedSeedHex);
  const next = normalizeSeed(nextHashHex);
  const forward = createHash('sha256').update(Buffer.from(revealed, 'hex')).digest('hex');
  return forward === next;
}

/**
 * A round's position in a published chain: which terminal it belongs to, how
 * long the chain is, and which index this round consumes.
 *
 * Binding the index is what stops link reuse and chain stalling: two rounds
 * that claim the same index are visibly the same round, and a verifier can see
 * exactly how many rounds a terminal is good for.
 *
 * @param {{terminal: string, length: number, index: number}} position
 */
export function normalizeChainPosition(position, path = '$.chain') {
  if (!position || typeof position !== 'object' || Array.isArray(position)) {
    fail('INVALID_CHAIN', 'chain position must be an object', path);
  }
  const terminal = normalizeSeed(position.terminal);
  const { length, index } = position;
  if (!Number.isSafeInteger(length) || length < 2 || length > LIMITS.maxChainLength) {
    fail('INVALID_CHAIN', `chain length must be an integer in [2, ${LIMITS.maxChainLength}]`, `${path}.length`);
  }
  if (!Number.isSafeInteger(index) || index < 0 || index > length - 2) {
    fail('INVALID_CHAIN', `chain index must be an integer in [0, ${length - 2}]`, `${path}.index`);
  }
  return Object.freeze({ version: CHAIN_VERSION, terminal, length, index });
}

/**
 * Hash a revealed seed forward to the published terminal and check it lands
 * exactly where the round claims it should.
 * @param {string} revealedSeedHex
 * @param {{terminal: string, length: number, index: number}} position
 */
export function verifyChainPosition(revealedSeedHex, position) {
  const revealed = normalizeSeed(revealedSeedHex);
  const chain = normalizeChainPosition(position);
  let current = Buffer.from(revealed, 'hex');
  for (let step = chain.index; step < chain.length - 1; step += 1) {
    current = createHash('sha256').update(current).digest();
  }
  return current.toString('hex') === chain.terminal;
}

/* ------------------------------------------------------------------ *
 * deterministic sampler — HMAC-SHA256 with exact rejection sampling
 * ------------------------------------------------------------------ */

const RANGE = 1n << 256n;

/**
 * Uniform integer in [0, modulus) derived from BOTH seeds. Rejection sampling
 * keeps the distribution exactly uniform: no modulo bias, ever.
 *
 * The server seed is the HMAC key; the client seed is a labelled field. Neither
 * party can steer the result: the operator commits to its seed before it sees
 * the client's, and the client sees only a commitment when it chooses.
 *
 * @param {string} serverSeedHex
 * @param {string} clientSeed
 * @param {Array<string|number|bigint>} label
 * @param {bigint} modulus
 * @returns {bigint}
 */
export function uniformBigInt(serverSeedHex, clientSeed, label, modulus) {
  const seed = normalizeSeed(serverSeedHex);
  const client = normalizeClientSeed(clientSeed);
  if (!Array.isArray(label)) fail('INVALID_ARGUMENT', 'label must be an array of encodable fields', '$.label');
  if (typeof modulus !== 'bigint' || modulus <= 0n || modulus >= RANGE) {
    fail('INVALID_MODULUS', 'Modulus must be a BigInt in [1, 2^256)', '$.modulus');
  }
  const limit = RANGE - (RANGE % modulus);
  const key = Buffer.from(seed, 'hex');
  for (let nonce = 0n; ; nonce += 1n) {
    const digest = createHmac('sha256', key)
      .update(encodeFields([SAMPLER_VERSION, client, ...label, nonce, modulus]))
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
 *
 * Note the slip array is per LANE and per SQUAD SLOT, so every runner has a
 * committed draw in every lane. That is what lets the SPLIT lane balance be a
 * free player choice without changing which draws exist.
 *
 * @param {string} serverSeedHex
 * @param {string} clientSeed
 * @param {string} roundId
 */
export function deriveHazardTable(serverSeedHex, clientSeed, roundId) {
  const seed = normalizeSeed(serverSeedHex);
  const client = normalizeClientSeed(clientSeed);
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
          uniformBigInt(seed, client, [CONFIG.gameId, round, arena, id, lane, 'collapse', 0], spec.collapse.d),
        );
        const slips = [];
        for (let slot = 0; slot < CONFIG.squadSize; slot += 1) {
          slips.push(
            Number(
              uniformBigInt(seed, client, [CONFIG.gameId, round, arena, id, lane, 'slip', slot], spec.clear.d),
            ),
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

/**
 * Structural validation of an untrusted hazard table. `verifyRound` re-derives
 * the table so this is unreachable there, but `replayRound` and `resolveArena`
 * are exported and documented entry points, and every other boundary in this
 * file fails closed with a typed error. This one does too.
 * @param {unknown} hazard
 */
export function assertHazardShape(hazard, path = '$.hazard') {
  if (!Array.isArray(hazard) || hazard.length !== CONFIG.arenas) {
    fail('MALFORMED_HAZARD', `hazard must be an array of ${CONFIG.arenas} arenas`, path);
  }
  hazard.forEach((arena, index) => {
    const at = `${path}[${index}]`;
    if (!arena || typeof arena !== 'object' || Array.isArray(arena)) {
      fail('MALFORMED_HAZARD', 'each arena must be an object keyed by contract id', at);
    }
    for (const id of CONTRACT_IDS) {
      const spec = CONTRACTS[id];
      const lanes = arena[id];
      if (!Array.isArray(lanes) || lanes.length !== spec.laneCount) {
        fail('MALFORMED_HAZARD', `${id} must carry exactly ${spec.laneCount} lane(s)`, `${at}.${id}`);
      }
      lanes.forEach((lane, laneIndex) => {
        const where = `${at}.${id}[${laneIndex}]`;
        if (!lane || typeof lane !== 'object') fail('MALFORMED_HAZARD', 'lane must be an object', where);
        if (!Number.isSafeInteger(lane.collapse) || lane.collapse < 0 || BigInt(lane.collapse) >= spec.collapse.d) {
          fail('MALFORMED_HAZARD', `collapse draw must be an integer in [0, ${spec.collapse.d})`, `${where}.collapse`);
        }
        if (!Array.isArray(lane.slips) || lane.slips.length !== CONFIG.squadSize) {
          fail('MALFORMED_HAZARD', `slips must be an array of ${CONFIG.squadSize} draws`, `${where}.slips`);
        }
        lane.slips.forEach((slip, slot) => {
          if (!Number.isSafeInteger(slip) || slip < 0 || BigInt(slip) >= spec.clear.d) {
            fail('MALFORMED_HAZARD', `slip draw must be an integer in [0, ${spec.clear.d})`, `${where}.slips[${slot}]`);
          }
        });
      });
    }
  });
  return hazard;
}

/** Canonical bytes of the hazard table — the thing the digest covers. */
export function canonicalHazardBytes(roundId, clientSeed, hazard) {
  assertHazardShape(hazard);
  const fields = [
    'BRANCHFALL hazard table',
    SCHEMA,
    CONFIG.gameId,
    CONFIG.adapterVersion,
    CONFIG.modelVersion,
    normalizeRoundId(roundId),
    normalizeClientSeed(clientSeed),
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

/** @param {string} roundId @param {string} clientSeed @param {ReturnType<typeof deriveHazardTable>} hazard */
export function hazardDigest(roundId, clientSeed, hazard) {
  return createHash('sha256').update(canonicalHazardBytes(roundId, clientSeed, hazard)).digest('hex');
}

/**
 * STEP 1. The pre-commitment the operator publishes before the player supplies
 * anything, and before the operator itself can evaluate any table.
 *
 * The round id is fixed HERE, not later. That matters: if the round id were
 * chosen after the client seed arrived, the operator could grind round ids
 * instead of seeds and recover the whole attack the client seed exists to
 * close — with the same silent, fully-verifiable result.
 *
 * @param {string} serverSeedHex
 * @param {string} roundId
 * @param {{chain?: {terminal: string, length: number, index: number}}} [options]
 */
export function preCommit(serverSeedHex, roundId, options = {}) {
  const seed = normalizeSeed(serverSeedHex);
  const round = normalizeRoundId(roundId);
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    fail('INVALID_ARGUMENT', 'preCommit options must be an object', '$.options');
  }
  const record = {
    version: COMMITMENT_VERSION,
    gameId: CONFIG.gameId,
    adapterVersion: CONFIG.adapterVersion,
    modelVersion: CONFIG.modelVersion,
    roundId: round,
    commitment: serverCommitment(seed, round),
  };
  if (options.chain !== undefined) {
    record.chain = normalizeChainPosition(options.chain, '$.options.chain');
    if (!verifyChainPosition(seed, record.chain)) {
      fail('CHAIN_MISMATCH', 'server seed is not at the declared chain position', '$.options.chain');
    }
  }
  return Object.freeze(record);
}

/** @param {unknown} pre */
export function assertPreCommitment(pre, path = '$.preCommitment') {
  if (!pre || typeof pre !== 'object' || Array.isArray(pre)) {
    fail('INVALID_TRANSCRIPT', 'pre-commitment must be an object', path);
  }
  if (pre.version !== COMMITMENT_VERSION) {
    fail('UNSUPPORTED_VERSION', 'unknown commitment version', `${path}.version`);
  }
  if (pre.adapterVersion !== CONFIG.adapterVersion || pre.modelVersion !== CONFIG.modelVersion) {
    fail('ADAPTER_MISMATCH', 'pre-commitment was produced by a different adapter', `${path}.adapterVersion`);
  }
  normalizeRoundId(pre.roundId);
  if (typeof pre.commitment !== 'string' || !/^[0-9a-f]{64}$/u.test(pre.commitment)) {
    fail('INVALID_TRANSCRIPT', 'commitment must be 32 bytes of lowercase hexadecimal', `${path}.commitment`);
  }
  if (pre.chain !== undefined) normalizeChainPosition(pre.chain, `${path}.chain`);
  return pre;
}

/**
 * STEP 3. The client seed has arrived, so the table is now fixed for both
 * parties. Takes the ALREADY PUBLISHED pre-commitment and opens it — it does not
 * manufacture one, because a commitment the operator mints at the same moment it
 * learns the client seed commits to nothing.
 *
 * Returns two separate objects, and the separation is the security property:
 *
 *   `published` — everything the player and any verifier may see now. It carries
 *     the hazard DIGEST and no draws. Publishing this object leaks nothing.
 *   `hazard` — the sealed table. Operator-side only, until settlement.
 *
 * The v1 draft returned one object with the table inside it. Any caller that
 * handed that object to a client handed over the outcomes, and a player who can
 * read the table can place a side bet on an event that has already happened —
 * which is not a pricing bug but a total break: side bets stop being bets.
 *
 * @param {string} serverSeedHex
 * @param {string} clientSeed
 * @param {ReturnType<typeof preCommit>} preCommitment
 * @returns {{published: object, hazard: ReturnType<typeof deriveHazardTable>}}
 */
export function openRound(serverSeedHex, clientSeed, preCommitment) {
  const seed = normalizeSeed(serverSeedHex);
  const client = normalizeClientSeed(clientSeed);
  const pre = assertPreCommitment(preCommitment);

  if (serverCommitment(seed, pre.roundId) !== pre.commitment) {
    fail(
      'COMMITMENT_MISMATCH',
      'the server seed does not open the published pre-commitment',
      '$.preCommitment.commitment',
    );
  }
  if (pre.chain !== undefined && !verifyChainPosition(seed, pre.chain)) {
    fail('CHAIN_MISMATCH', 'the server seed is not at the pre-committed chain position', '$.preCommitment.chain');
  }

  const hazard = deriveHazardTable(seed, client, pre.roundId);
  const published = Object.freeze({
    schema: SCHEMA,
    gameId: CONFIG.gameId,
    adapterVersion: CONFIG.adapterVersion,
    modelVersion: CONFIG.modelVersion,
    roundId: pre.roundId,
    clientSeed: client,
    preCommitment: pre,
    hazardDigest: hazardDigest(pre.roundId, client, hazard),
  });
  return Object.freeze({ published, hazard });
}

/* ------------------------------------------------------------------ *
 * replay
 * ------------------------------------------------------------------ */

/**
 * @typedef {{bet: 'CLEAN_SWEEP'|'SOLE_SURVIVOR'|'LAST_LIGHT', stakeMicro: bigint}} SideBetTicket
 * @typedef {{type:'BANK'}
 *   | {type:'ROUTE', contract: 'WIDE'|'SPLIT'|'NARROW', laneSplit?: number|null, sideBets?: SideBetTicket[]}
 *   | {type:'SHELTER', shelter: number[], sideBets?: SideBetTicket[]}} ReplayAction
 */

/** @param {number[]} running @param {'WIDE'|'SPLIT'|'NARROW'} id @param {number|null} laneSplit */
function assignLanes(running, id, laneSplit) {
  const sizes = laneSizes(id, running.length, laneSplit);
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
export function resolveArena(hazard, arena, contractId, running, laneSplit = null) {
  assertHazardShape(hazard);
  if (!Number.isSafeInteger(arena) || arena < 1 || arena > CONFIG.arenas) {
    fail('INVALID_ARENA', `arena must be an integer in [1, ${CONFIG.arenas}]`, '$.arena');
  }
  if (!CONTRACT_IDS.includes(contractId)) {
    fail('UNKNOWN_CONTRACT', `Unknown contract ${String(contractId)}`, '$.contract');
  }
  if (!Array.isArray(running) || running.length === 0) {
    fail('INVALID_SQUAD', 'running must be a non-empty array of squad slots', '$.running');
  }
  if (running.length > CONFIG.squadSize) {
    fail('INVALID_SQUAD', 'running cannot exceed the squad size', '$.running');
  }
  const seenSlots = new Set();
  for (const slot of running) {
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= CONFIG.squadSize) {
      fail('INVALID_SQUAD', `squad slot must be an integer in [0, ${CONFIG.squadSize})`, '$.running');
    }
    if (seenSlots.has(slot)) fail('INVALID_SQUAD', 'running must name distinct squad slots', '$.running');
    seenSlots.add(slot);
  }
  const spec = CONTRACTS[contractId];
  const laneDraws = hazard[arena - 1][contractId];
  const lanes = assignLanes(running, contractId, laneSplit);
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

/**
 * Per-ticket cap, mirroring the engine's `payableWithinCap`.
 *
 * The BASIS is the stake of the ticket being credited — the route stake for the
 * route ticket, the side-bet stake for a side bet. The v1 draft used one
 * accumulator against one stake for every credit event in the round, which made
 * the cap reachable the moment a side bet was in play. It is not a per-round
 * pot: it is a per-ticket ceiling, and the round total is bounded by it because
 * the total is a sum of capped tickets (docs/MATH.md §9).
 */
export function payableWithinCap(theoretical, basisStakeMicro, maxWinMultiple, alreadyCredited) {
  if (!(theoretical instanceof Frac)) {
    fail('INVALID_ARGUMENT', 'theoretical payout must be an exact Frac', '$.theoretical');
  }
  for (const [name, value] of [
    ['basisStakeMicro', basisStakeMicro],
    ['maxWinMultiple', maxWinMultiple],
    ['alreadyCredited', alreadyCredited],
  ]) {
    if (typeof value !== 'bigint' || value < 0n) {
      fail('INVALID_ARGUMENT', `${name} must be a non-negative BigInt`, `$.${name}`);
    }
  }
  const uncapped = theoretical.floor();
  const ceiling = basisStakeMicro * maxWinMultiple;
  const remaining = ceiling > alreadyCredited ? ceiling - alreadyCredited : 0n;
  const credited = uncapped > remaining ? remaining : uncapped;
  return { credited, capped: uncapped > remaining };
}

/** @param {unknown} value @param {string} path */
function assertStake(value, path, min, max) {
  if (typeof value !== 'bigint' || value < min || value > max) {
    fail('INVALID_STAKE', `stake must be a BigInt within the published limits`, path);
  }
  return value;
}

/**
 * Validate and price the side-bet tickets attached to one action.
 * @returns {{bet:string, stakeMicro:bigint, multiplier:Frac, probability:Frac}[]}
 */
function priceSideBets(tickets, contractId, runners, laneSplit, routeStakeMicro, alreadyStaked, path) {
  if (tickets === undefined) return [];
  if (!Array.isArray(tickets)) fail('INVALID_SIDE_BET', 'sideBets must be an array', path);
  if (tickets.length > CONFIG.sideBet.maxTicketsPerArena) {
    fail('INVALID_SIDE_BET', `at most ${CONFIG.sideBet.maxTicketsPerArena} side bets per arena`, path);
  }
  const offers = sideBetOffers(contractId, runners, laneSplit);
  if (tickets.length > 0 && offers.length === 0) {
    fail(
      'INVALID_SIDE_BET',
      `side bets require at least ${CONFIG.sideBet.minRunners} running Kindlings`,
      path,
    );
  }
  const perBetCeiling = CONFIG.sideBet.maxStakeRatioPerBet.mul(F(routeStakeMicro)).floor();
  const roundCeiling = CONFIG.sideBet.maxTotalStakeRatio.mul(F(routeStakeMicro)).floor();
  const seen = new Set();
  let staked = alreadyStaked;
  const priced = [];
  tickets.forEach((ticket, index) => {
    const at = `${path}[${index}]`;
    if (!ticket || typeof ticket !== 'object') fail('INVALID_SIDE_BET', 'side bet must be an object', at);
    if (!SIDE_BET_IDS.includes(ticket.bet)) {
      fail('UNKNOWN_SIDE_BET', `Unknown side bet ${String(ticket.bet)}`, `${at}.bet`);
    }
    if (seen.has(ticket.bet)) {
      fail('INVALID_SIDE_BET', `${ticket.bet} may be staked at most once per arena`, `${at}.bet`);
    }
    seen.add(ticket.bet);
    assertStake(ticket.stakeMicro, `${at}.stakeMicro`, CONFIG.minStakeMicro, perBetCeiling);
    staked += ticket.stakeMicro;
    if (staked > roundCeiling) {
      fail('INVALID_SIDE_BET', 'side-bet stake exceeds the published per-round limit', `${at}.stakeMicro`);
    }
    const offer = offers.find((o) => o.bet === ticket.bet);
    // The client may echo the multiplier it was shown. We never settle at the
    // client's number — we recompute and reject any disagreement, so a stale
    // card or a tampered payload fails closed instead of paying out.
    if (ticket.quotedMultiplier !== undefined) {
      if (typeof ticket.quotedMultiplier !== 'string') {
        fail('QUOTE_MISMATCH', 'quotedMultiplier must be a canonical "n/d" string', `${at}.quotedMultiplier`);
      }
      if (ticket.quotedMultiplier !== offer.multiplier.toString()) {
        fail(
          'QUOTE_MISMATCH',
          `quoted ${ticket.quotedMultiplier} but this geometry prices ${offer.multiplier}`,
          `${at}.quotedMultiplier`,
        );
      }
    }
    priced.push({
      bet: ticket.bet,
      stakeMicro: ticket.stakeMicro,
      multiplier: offer.multiplier,
      probability: offer.probability,
    });
  });
  return priced;
}

/** Does a side bet win, given the arena's survivor count and running group size? */
function sideBetWins(bet, survivors, runners) {
  if (bet === 'CLEAN_SWEEP') return survivors === runners;
  if (bet === 'SOLE_SURVIVOR') return survivors === 1;
  return survivors === 0;
}

/**
 * Replay a round: deterministic, exact, and reproducible from the seeds alone.
 * @param {{roundId: string, clientSeed: string, hazard: any}} round
 * @param {{stakeMicro: bigint, actions: ReplayAction[]}} play
 */
export function replayRound(round, play) {
  assertHazardShape(round?.hazard);
  const stake = assertStake(play?.stakeMicro, '$.stakeMicro', CONFIG.minStakeMicro, LIMITS.maxStakeMicro);
  if (!Array.isArray(play.actions) || play.actions.length === 0 || play.actions.length > CONFIG.arenas) {
    fail('INVALID_ACTIONS', `actions must be an array of 1..${CONFIG.arenas} entries`, '$.actions');
  }

  let alive = Array.from({ length: CONFIG.squadSize }, (_, i) => i);
  let claim = CONFIG.rtp; // as a multiple of the stake
  let routeCredited = 0n;
  let sideStaked = 0n;
  let sideCredited = 0n;
  let capped = false;
  const ledger = [];
  const sideLedger = [];

  for (let arena = 1; arena <= CONFIG.arenas; arena += 1) {
    const action = play.actions[arena - 1];
    if (!action) break;
    if (!action || typeof action !== 'object') {
      fail('INVALID_ACTION', 'action must be an object', `$.actions[${arena - 1}]`);
    }
    if (alive.length === 0) fail('INVALID_ACTIONS', 'No runners left to act', `$.actions[${arena - 1}]`);

    if (action.type === 'BANK') {
      if (arena === 1) fail('ILLEGAL_ACTION', 'Banking is unavailable before the first arena', `$.actions[0]`);
      if (action.sideBets !== undefined) {
        fail('INVALID_SIDE_BET', 'a BANK runs no arena and carries no side bet', `$.actions[${arena - 1}].sideBets`);
      }
      ledger.push(Object.freeze({ arena, action: 'BANK', alive: [...alive], claimBefore: claim.toString() }));
      break;
    }

    let running = alive;
    let sheltered = [];
    let contractId;
    let laneSplit = null;

    if (action.type === 'SHELTER') {
      const chosen = action.shelter;
      if (!Array.isArray(chosen) || chosen.length < 1 || chosen.length > alive.length - 1) {
        fail('ILLEGAL_ACTION', 'SHELTER must withdraw between 1 and alive-1 runners', `$.actions[${arena - 1}]`);
      }
      for (const slot of chosen) {
        if (!Number.isSafeInteger(slot)) {
          fail('ILLEGAL_ACTION', 'SHELTER slots must be integers', `$.actions[${arena - 1}].shelter`);
        }
      }
      const unique = new Set(chosen);
      if (unique.size !== chosen.length || chosen.some((s) => !alive.includes(s))) {
        fail('ILLEGAL_ACTION', 'SHELTER must name distinct living runners', `$.actions[${arena - 1}]`);
      }
      sheltered = [...unique].sort((a, b) => a - b);
      running = alive.filter((s) => !unique.has(s));
      contractId = 'WIDE';
    } else if (action.type === 'ROUTE') {
      contractId = action.contract;
      if (!CONTRACT_IDS.includes(contractId)) {
        fail('UNKNOWN_CONTRACT', `Unknown contract ${String(contractId)}`, `$.actions[${arena - 1}]`);
      }
      if (running.length < CONTRACTS[contractId].minRunners) {
        fail('ILLEGAL_ACTION', `${contractId} requires ${CONTRACTS[contractId].minRunners} runners`, `$.actions[${arena - 1}]`);
      }
      laneSplit = action.laneSplit === undefined ? null : action.laneSplit;
      const legal = laneSplitsFor(contractId, running.length);
      if (!legal.includes(laneSplit)) {
        fail(
          'INVALID_LANE_SPLIT',
          `${contractId} with ${running.length} runners accepts lane balance in {${legal.join(', ')}}`,
          `$.actions[${arena - 1}].laneSplit`,
        );
      }
    } else {
      fail('INVALID_ACTION', `Unknown action type ${String(action.type)}`, `$.actions[${arena - 1}]`);
    }

    // Side bets are committed at the same instant as the route: they ride the
    // group that actually runs, and they are priced off the committed geometry.
    const priced = priceSideBets(
      action.sideBets,
      contractId,
      running.length,
      laneSplit,
      stake,
      sideStaked,
      `$.actions[${arena - 1}].sideBets`,
    );
    for (const ticket of priced) sideStaked += ticket.stakeMicro;

    // A shelter withdrawal is a credit event on the route ticket.
    if (action.type === 'SHELTER') {
      const share = claim.mul(F(BigInt(sheltered.length), BigInt(alive.length)));
      const result = payableWithinCap(share.mul(F(stake)), stake, CONFIG.maxWinMultiple, routeCredited);
      routeCredited += result.credited;
      capped = capped || result.capped;
      claim = claim.mul(F(BigInt(running.length), BigInt(alive.length)));
    }

    const before = claim;
    const outcome = resolveArena(round.hazard, arena, contractId, running, laneSplit);
    const mu = Frac.ONE.div(Frac.ONE.sub(CONTRACTS[contractId].collapse).mul(CONTRACTS[contractId].clear));
    claim = claim.mul(F(BigInt(outcome.survivors.length), BigInt(running.length))).mul(mu);
    alive = outcome.survivors;

    for (const ticket of priced) {
      const won = sideBetWins(ticket.bet, outcome.survivors.length, running.length);
      const theoretical = won ? ticket.multiplier.mul(F(ticket.stakeMicro)) : Frac.ZERO;
      const result = payableWithinCap(theoretical, ticket.stakeMicro, CONFIG.maxWinMultiple, 0n);
      sideCredited += result.credited;
      capped = capped || result.capped;
      sideLedger.push(
        Object.freeze({
          arena,
          bet: ticket.bet,
          contract: contractId,
          runners: running.length,
          laneSplit,
          stakeMicro: ticket.stakeMicro.toString(),
          probability: ticket.probability.toString(),
          multiplier: ticket.multiplier.toString(),
          won,
          creditedMicro: result.credited.toString(),
        }),
      );
    }

    ledger.push(
      Object.freeze({
        arena,
        action: action.type === 'SHELTER' ? 'SHELTER' : 'ROUTE',
        contract: contractId,
        laneSplit,
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

  const settlement = payableWithinCap(claim.mul(F(stake)), stake, CONFIG.maxWinMultiple, routeCredited);
  routeCredited += settlement.credited;
  capped = capped || settlement.capped;

  const totalStaked = stake + sideStaked;
  const totalCredited = routeCredited + sideCredited;

  return Object.freeze({
    stakeMicro: stake.toString(),
    sideStakeMicro: sideStaked.toString(),
    totalStakeMicro: totalStaked.toString(),
    ledger: Object.freeze(ledger),
    sideLedger: Object.freeze(sideLedger),
    survivorsBanked: [...alive],
    finalClaim: claim.toString(),
    routeCreditedMicro: routeCredited.toString(),
    sideCreditedMicro: sideCredited.toString(),
    creditedMicro: totalCredited.toString(),
    returnMultiple: F(totalCredited, totalStaked).toString(),
    capped,
  });
}

/**
 * Verify a revealed round end to end: check the pre-commitment against the
 * revealed server seed, re-derive the hazard table from BOTH seeds, check the
 * published digest, optionally check the seed-chain link, and replay the
 * recorded actions.
 */
export function verifyRound(serverSeedHex, published, play, settlement = undefined) {
  try {
    const seed = normalizeSeed(serverSeedHex);
    if (!published || typeof published !== 'object' || published.schema !== SCHEMA) {
      return { ok: false, code: 'UNSUPPORTED_VERSION', message: 'Unknown transcript schema', path: '$.schema' };
    }
    if (published.adapterVersion !== CONFIG.adapterVersion || published.modelVersion !== CONFIG.modelVersion) {
      return { ok: false, code: 'ADAPTER_MISMATCH', message: 'Transcript was produced by a different adapter', path: '$.adapterVersion' };
    }
    // A published round that carries draws has already leaked its outcomes.
    if (published.hazard !== undefined) {
      return {
        ok: false,
        code: 'INVALID_TRANSCRIPT',
        message: 'A published round must carry the hazard digest, never the table',
        path: '$.hazard',
      };
    }
    const pre = assertPreCommitment(published.preCommitment);
    if (pre.roundId !== published.roundId) {
      return { ok: false, code: 'TRANSCRIPT_MISMATCH', message: 'Round id does not match the pre-commitment', path: '$.roundId' };
    }
    const expectedCommitment = serverCommitment(seed, pre.roundId);
    if (expectedCommitment !== pre.commitment) {
      return { ok: false, code: 'COMMITMENT_MISMATCH', message: 'Pre-commitment does not match the revealed server seed', path: '$.preCommitment.commitment' };
    }
    if (pre.chain !== undefined && !verifyChainPosition(seed, pre.chain)) {
      return { ok: false, code: 'CHAIN_MISMATCH', message: 'Revealed seed is not at the pre-committed chain position', path: '$.preCommitment.chain' };
    }
    const hazard = deriveHazardTable(seed, published.clientSeed, published.roundId);
    const digest = hazardDigest(published.roundId, published.clientSeed, hazard);
    if (digest !== published.hazardDigest) {
      return { ok: false, code: 'TRANSCRIPT_MISMATCH', message: 'Hazard digest does not match the published table', path: '$.hazardDigest' };
    }
    const replay = replayRound({ hazard }, play);

    // If the operator published a settlement, every credited figure in it must
    // equal the one re-derived here. Without this comparison a verifier proves
    // the table was honest and says nothing about what the player was paid.
    if (settlement !== undefined) {
      if (!settlement || typeof settlement !== 'object') {
        return { ok: false, code: 'LEDGER_MISMATCH', message: 'settlement must be an object', path: '$.settlement' };
      }
      for (const field of [
        'stakeMicro',
        'sideStakeMicro',
        'totalStakeMicro',
        'routeCreditedMicro',
        'sideCreditedMicro',
        'creditedMicro',
        'finalClaim',
        'returnMultiple',
      ]) {
        if (settlement[field] !== undefined && String(settlement[field]) !== replay[field]) {
          return {
            ok: false,
            code: 'LEDGER_MISMATCH',
            message: `published ${field} ${String(settlement[field])} does not match the re-derived ${replay[field]}`,
            path: `$.settlement.${field}`,
          };
        }
      }
      if (settlement.capped !== undefined && Boolean(settlement.capped) !== replay.capped) {
        return { ok: false, code: 'LEDGER_MISMATCH', message: 'published cap flag does not match', path: '$.settlement.capped' };
      }
      if (settlement.survivorsBanked !== undefined &&
          JSON.stringify(settlement.survivorsBanked) !== JSON.stringify(replay.survivorsBanked)) {
        return { ok: false, code: 'LEDGER_MISMATCH', message: 'published survivor set does not match', path: '$.settlement.survivorsBanked' };
      }
      if (settlement.sideLedger !== undefined &&
          JSON.stringify(settlement.sideLedger) !== JSON.stringify(replay.sideLedger)) {
        return { ok: false, code: 'LEDGER_MISMATCH', message: 'published side-bet ledger does not match', path: '$.settlement.sideLedger' };
      }
      if (settlement.ledger !== undefined &&
          JSON.stringify(settlement.ledger) !== JSON.stringify(replay.ledger)) {
        return { ok: false, code: 'LEDGER_MISMATCH', message: 'published arena ledger does not match', path: '$.settlement.ledger' };
      }
    }

    return { ok: true, commitment: expectedCommitment, hazardDigest: digest, replay };
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

/**
 * The frozen wire fixture used by tests/wire-format.test.mjs, and the
 * conformance vector the engine module must reproduce byte for byte.
 *
 * The client seed was searched for, not sampled, so that one round exercises
 * every path worth freezing: a lopsided SPLIT lane balance, all three side-bet
 * events with both a winning and a losing outcome among them, a SHELTER credit
 * mid-round, a NARROW arena, an explicit BANK, and a single surviving runner at
 * settlement.
 */
export const FIXTURE_INPUT = Object.freeze({
  serverSeed: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  clientSeed: 'wren-bramble-ora-tuck-sable-74',
  roundId: 'branchfall-fixture-0002',
  stakeMicro: '10000000',
  actions: [
    {
      type: 'ROUTE',
      contract: 'SPLIT',
      laneSplit: 4,
      sideBets: [{ bet: 'CLEAN_SWEEP', stakeMicro: '2000000', quotedMultiplier: '9168/3125' }],
    },
    { type: 'ROUTE', contract: 'WIDE' },
    { type: 'SHELTER', shelter: [0], sideBets: [{ bet: 'LAST_LIGHT', stakeMicro: '1000000' }] },
    { type: 'ROUTE', contract: 'NARROW', sideBets: [{ bet: 'SOLE_SURVIVOR', stakeMicro: '1000000' }] },
    { type: 'BANK' },
  ],
});

/** Re-hydrate the JSON fixture's string BigInts into a `replayRound` play. */
export function fixturePlay(input = FIXTURE_INPUT) {
  return {
    stakeMicro: BigInt(input.stakeMicro),
    actions: input.actions.map((action) =>
      action.sideBets
        ? { ...action, sideBets: action.sideBets.map((b) => ({ ...b, stakeMicro: BigInt(b.stakeMicro) })) }
        : action,
    ),
  };
}

export function buildFixture() {
  const pre = preCommit(FIXTURE_INPUT.serverSeed, FIXTURE_INPUT.roundId);
  const { published, hazard } = openRound(FIXTURE_INPUT.serverSeed, FIXTURE_INPUT.clientSeed, pre);
  const replay = replayRound({ hazard }, fixturePlay());
  return {
    schema: SCHEMA,
    input: FIXTURE_INPUT,
    /** Everything a player and a verifier may see before settlement. No draws. */
    published,
    /** Sealed until settlement. Frozen here because this file IS the reveal. */
    hazard,
    replay,
  };
}

/**
 * Build a legal action list against a known table.
 *
 * The demo has to be adaptive, not scripted: a fixed "shelter slot 0" is illegal
 * the moment slot 0 has already fallen, and CI runs this command on a random
 * seed. Stepping the resolved state is the only way a demo round is guaranteed
 * to be legal, and it is also what a real client does.
 *
 * @param {ReturnType<typeof deriveHazardTable>} hazard
 * @returns {ReplayAction[]}
 */
export function demoPlay(hazard) {
  assertHazardShape(hazard);
  let alive = Array.from({ length: CONFIG.squadSize }, (_, i) => i);
  const actions = [];

  for (let arena = 1; arena <= CONFIG.arenas && alive.length > 0; arena += 1) {
    if (arena === CONFIG.arenas) {
      actions.push({ type: 'BANK' });
      break;
    }

    let action;
    if (arena === 1 && alive.length >= 2) {
      const split = laneSplitsFor('SPLIT', alive.length)[0];
      action = {
        type: 'ROUTE',
        contract: 'SPLIT',
        laneSplit: split,
        sideBets: [{ bet: 'CLEAN_SWEEP', stakeMicro: 2_000_000n }],
      };
    } else if (arena === 3 && alive.length >= 2) {
      // Shelter a runner that is actually alive, chosen by position not by id.
      action = {
        type: 'SHELTER',
        shelter: [alive[0]],
        sideBets:
          alive.length - 1 >= CONFIG.sideBet.minRunners
            ? [{ bet: 'LAST_LIGHT', stakeMicro: 1_000_000n }]
            : undefined,
      };
    } else if (arena === 4) {
      action = { type: 'ROUTE', contract: 'NARROW' };
    } else {
      action = { type: 'ROUTE', contract: 'WIDE' };
    }
    if (action.sideBets === undefined) delete action.sideBets;

    const running = action.type === 'SHELTER' ? alive.filter((slot) => slot !== action.shelter[0]) : alive;
    const contractId = action.type === 'SHELTER' ? 'WIDE' : action.contract;
    const outcome = resolveArena(hazard, arena, contractId, running, action.laneSplit ?? null);
    actions.push(action);
    alive = outcome.survivors;
  }

  return actions;
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

  if (argv.includes('--chain')) {
    const length = Number(flag('--chain') ?? 8);
    const chain = buildSeedChain(randomBytes(32).toString('hex'), length);
    process.stdout.write('BRANCHFALL — pre-committed server-seed chain\n');
    process.stdout.write('===========================================\n');
    process.stdout.write(`terminal, published once before any of these rounds:\n  ${chain.terminal}\n\n`);
    process.stdout.write('Rounds consume the chain in reverse. Each round pre-commits to its INDEX,\n');
    process.stdout.write('so a reused link and a stalled chain are both visible to a verifier.\n\n');
    for (let index = length - 2; index >= 0; index -= 1) {
      const seed = chain.seeds[index];
      const position = { terminal: chain.terminal, length, index };
      const ok = verifyChainPosition(seed, position);
      const wrongIndex = index > 0 ? verifyChainPosition(seed, { ...position, index: index - 1 }) : false;
      process.stdout.write(
        `  round ${String(length - 1 - index).padStart(2)}  index ${String(index).padStart(2)}  ` +
          `reveal ${seed}  position ${ok ? 'OK' : 'BROKEN'}  replayed-at-wrong-index ${wrongIndex ? 'ACCEPTED' : 'rejected'}\n`,
      );
    }
    process.stdout.write(
      '\nThe operator never chooses a seed per round: the whole sequence was fixed by\none public hash, and each round names the position it consumes.\n',
    );
    return;
  }

  const serverSeed = flag('--server') ?? randomBytes(32).toString('hex');
  const clientSeed = flag('--client') ?? `player-${randomBytes(6).toString('hex')}`;
  const roundId = flag('--round') ?? 'demo-round';

  // Step 1: publish the pre-commitment. No client input exists yet.
  const pre = preCommit(serverSeed, roundId);
  // Step 2 & 3: the client seed arrives; only now is the table derivable, and
  // `published` is everything the player is allowed to see.
  const { published, hazard } = openRound(serverSeed, clientSeed, pre);
  const play = { stakeMicro: 10_000_000n, actions: demoPlay(hazard) };

  const replay = replayRound({ hazard }, play);
  // Step 5 & 6: reveal, and verify the published settlement against a fresh
  // re-derivation — the ledger comparison, not just the commitment check.
  const verified = verifyRound(serverSeed, published, play, replay);

  process.stdout.write('BRANCHFALL — reference round\n');
  process.stdout.write('============================\n');
  process.stdout.write(`roundId          ${published.roundId}\n`);
  process.stdout.write(`pre-commitment   ${pre.commitment}   (published before the client seed exists)\n`);
  process.stdout.write(`client seed      ${published.clientSeed}   (player-supplied, editable)\n`);
  process.stdout.write(`hazard digest    ${published.hazardDigest}   (published once both seeds are fixed)\n`);
  process.stdout.write(`server seed      ${serverSeed}   (revealed at settlement)\n`);
  process.stdout.write(
    `published keys   ${Object.keys(published).join(', ')}\n` +
      `                 (no hazard table: the draws stay sealed until settlement)\n\n`,
  );
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
  for (const entry of replay.sideLedger) {
    process.stdout.write(
      `  arena ${entry.arena}  SIDE     ${entry.bet.padEnd(14)} stake=${entry.stakeMicro} ` +
        `x=${entry.multiplier} ${entry.won ? 'WON' : 'lost'} credited=${entry.creditedMicro}\n`,
    );
  }
  process.stdout.write(
    `\n  banked runners  [${replay.survivorsBanked.join(',')}]\n` +
      `  staked          ${replay.totalStakeMicro} micro-credits (route ${replay.stakeMicro} + side ${replay.sideStakeMicro})\n` +
      `  credited        ${replay.creditedMicro} micro-credits (${replay.returnMultiple}x total stake)\n` +
      `  capped          ${replay.capped}\n` +
      `  verification    ${verified.ok ? 'OK (commitment, digest and ledger)' : `FAILED ${verified.code}`}\n`,
  );
  if (!verified.ok) {
    process.stderr.write(`${verified.message} at ${verified.path}\n`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) main();
