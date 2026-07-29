/**
 * Independent, on-device reconstruction of a settled BRANCHFALL round.
 *
 * This file intentionally does not import Reveal Engine. Verification is useful
 * only if the browser can disagree with the process that produced the result:
 * importing the server's verifier, or even importing the engine's sampler, would
 * turn this screen into a second rendering of the same verdict. The small amount
 * of duplication below is therefore a control, not an abstraction accident.
 *
 * There is still an honest limit. This is a second implementation of the
 * published algorithm, not an independent fairness certificate, RNG review or
 * proof that the device itself is trustworthy. It establishes that the revealed
 * seed, the locally copied definition, the published commitment, the complete
 * counterfactual tape and every played arena agree byte for byte.
 */

/**
 * Pinned from Reveal Engine `src/core/versions.ts`.
 *
 * These strings enter canonical preimages. They are exported so the test can
 * compare them with the installed engine and make a version bump fail loudly
 * instead of leaving old browser proofs that merely look current.
 */
export const ENGINE_API_VERSION = 'reveal-engine/api-v1' as const;
export const COMMITMENT_VERSION = 'reveal-engine/commit-v2' as const;

/** Pinned from `src/modules/staged-survival/contracts.ts`. */
export const STAGED_SURVIVAL_MODULE_ID = 'staged-survival' as const;
export const STAGED_SURVIVAL_MODULE_VERSION = '1.0.0' as const;
export const TRANSCRIPT_SCHEMA = 'staged-survival/transcript-v1' as const;

export interface RederiveInput {
  readonly revealedServerSeed: string;
  readonly transcript: unknown;
  readonly preCommitment: string;
  readonly publishedFingerprint: string;
}

export interface LaneView {
  readonly entities: readonly number[];
  readonly collapsed: boolean;
  readonly draw: string;
  readonly threshold: string;
  readonly modulus: string;
}

export interface EntityView {
  readonly entity: number;
  readonly draw: string;
  readonly threshold: string;
  readonly survived: boolean;
}

export interface ArenaDerivation {
  readonly index: number;
  readonly contractId: string;
  readonly banked: readonly number[];
  readonly running: readonly number[];
  readonly lanes: readonly LaneView[];
  readonly entities: readonly EntityView[];
  readonly survivors: readonly number[];
  readonly failed: readonly number[];
  readonly matchesTranscript: boolean;
  readonly note: string;
}

export interface Rederivation {
  readonly available: boolean;
  readonly reason?: string;
  readonly fingerprint: string;
  readonly fingerprintMatches: boolean;
  readonly seedCommitment: string;
  readonly commitmentMatches: boolean;
  readonly tapeDigest: string;
  readonly digestMatches: boolean;
  readonly drawCount: number;
  readonly arenas: readonly ArenaDerivation[];
  readonly ok: boolean;
  readonly elapsedMs: number;
}

interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

interface LaneProfile {
  readonly laneFailure: Rational;
  readonly entitySurvival: Rational;
}

interface StageContract {
  readonly id: string;
  readonly label: string;
  readonly laneWidth: number;
  readonly minEntities: number;
  readonly profile: LaneProfile;
  readonly multiplier: Rational;
}

interface SurvivalDefinition {
  readonly apiVersion: typeof ENGINE_API_VERSION;
  readonly id: string;
  readonly version: string;
  readonly entities: number;
  readonly stages: number;
  readonly drawModulus: bigint;
  readonly contracts: readonly StageContract[];
  readonly pricing: {
    readonly entryReturn: Rational;
    readonly continuationReturn: Rational;
    readonly rounding: 'floor';
  };
  readonly risk: {
    readonly maxWinMultiple: bigint;
    readonly capBasis: 'round-external-stake';
    readonly capMustBeUnreachable: boolean;
  };
}

type CanonicalField = string | Uint8Array | bigint | number;

interface TapeDraw {
  readonly label: string;
  readonly counter: number;
  readonly modulus: bigint;
  readonly value: bigint;
}

interface ParsedChoice {
  readonly contractId: string;
  readonly banked: readonly number[];
}

interface ParsedLane {
  readonly entities: readonly number[];
  readonly collapsed: boolean;
}

interface ParsedStep {
  readonly index: number;
  readonly contractId: string;
  readonly banked: readonly number[];
  readonly lanes: readonly ParsedLane[];
  readonly survivors: readonly number[];
  readonly failed: readonly number[];
}

interface ParsedTranscript {
  readonly definitionFingerprint: string;
  readonly roundId: string;
  readonly clientEntropy: string;
  readonly seedCommitment: string;
  readonly tapeDigest: string;
  readonly choices: readonly ParsedChoice[];
  readonly steps: readonly ParsedStep[];
}

const UTF8 = new TextEncoder();
const HEX_32 = /^[0-9a-f]{64}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const LANE_LABEL = 'staged-survival/lane';
const ENTITY_LABEL = 'staged-survival/entity';
const FINGERPRINT_SEED = '0'.repeat(64);
const UINT256_RANGE = 1n << 256n;

/**
 * Reveal Engine reduces rationals before putting their parts in any preimage.
 *
 * Keeping the reducer here matters even though the literals below are already
 * reduced. It makes that invariant executable: a future editor may write `2/20`
 * while intending `1/10`, and the fingerprint must continue to describe the
 * rational value rather than the spelling used in this source file.
 */
function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new Error('A local rational has a zero denominator');
  let left = numerator < 0n ? -numerator : numerator;
  let right = denominator < 0n ? -denominator : denominator;
  while (right !== 0n) [left, right] = [right, left % right];
  const sign = denominator < 0n ? -1n : 1n;
  return Object.freeze({
    numerator: (sign * numerator) / left,
    denominator: (sign * denominator) / left,
  });
}

/**
 * The complete replay-visible BRANCHFALL declaration, copied locally from
 * `server/definition.ts` and `docs/MATH.md`.
 *
 * Labels are included because this is meant to remain recognisably the product
 * declaration, although Reveal Engine deliberately excludes cosmetic labels
 * from the fingerprint. All probability, return and cap values remain BigInts;
 * no probability is ever approximated by a JavaScript number.
 */
const BRANCHFALL: SurvivalDefinition = Object.freeze({
  apiVersion: ENGINE_API_VERSION,
  id: 'branchfall',
  version: '3.0.0',
  entities: 5,
  stages: 5,
  drawModulus: 600n,
  contracts: Object.freeze([
    Object.freeze({
      id: 'WIDE',
      label: 'The Broad Bough — one lane, whole squad',
      laneWidth: 5,
      minEntities: 1,
      profile: Object.freeze({
        laneFailure: rational(1n, 25n),
        entitySurvival: rational(7n, 8n),
      }),
      multiplier: rational(25n, 21n),
    }),
    Object.freeze({
      id: 'SPLIT_1',
      label: 'The Fork — lead limb of 1',
      laneWidth: 1,
      minEntities: 2,
      profile: Object.freeze({
        laneFailure: rational(1n, 10n),
        entitySurvival: rational(5n, 6n),
      }),
      multiplier: rational(4n, 3n),
    }),
    Object.freeze({
      id: 'SPLIT_2',
      label: 'The Fork — lead limb of 2',
      laneWidth: 2,
      minEntities: 3,
      profile: Object.freeze({
        laneFailure: rational(1n, 10n),
        entitySurvival: rational(5n, 6n),
      }),
      multiplier: rational(4n, 3n),
    }),
    Object.freeze({
      id: 'SPLIT_3',
      label: 'The Fork — lead limb of 3',
      laneWidth: 3,
      minEntities: 4,
      profile: Object.freeze({
        laneFailure: rational(1n, 10n),
        entitySurvival: rational(5n, 6n),
      }),
      multiplier: rational(4n, 3n),
    }),
    Object.freeze({
      id: 'SPLIT_4',
      label: 'The Fork — lead limb of 4',
      laneWidth: 4,
      minEntities: 5,
      profile: Object.freeze({
        laneFailure: rational(1n, 10n),
        entitySurvival: rational(5n, 6n),
      }),
      multiplier: rational(4n, 3n),
    }),
    Object.freeze({
      id: 'NARROW',
      label: 'The Reach — single file, the point runner leads',
      laneWidth: 5,
      minEntities: 1,
      profile: Object.freeze({
        laneFailure: rational(1n, 2n),
        entitySurvival: rational(1n, 2n),
      }),
      multiplier: rational(4n, 1n),
    }),
  ]),
  pricing: Object.freeze({
    entryReturn: rational(191n, 200n),
    continuationReturn: rational(1n, 1n),
    rounding: 'floor',
  }),
  risk: Object.freeze({
    maxWinMultiple: 1000n,
    capBasis: 'round-external-stake',
    capMustBeUnreachable: true,
  }),
});

class InputProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputProblem';
  }
}

function nowMs(): number {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

function elapsedSince(startedAt: number): number {
  const elapsed = nowMs() - startedAt;
  return elapsed < 0 ? 0 : elapsed;
}

function unavailable(startedAt: number, reason: string): Rederivation {
  return {
    available: false,
    reason,
    fingerprint: '',
    fingerprintMatches: false,
    seedCommitment: '',
    commitmentMatches: false,
    tapeDigest: '',
    digestMatches: false,
    drawCount: 0,
    arenas: Object.freeze([]),
    ok: false,
    elapsedMs: elapsedSince(startedAt),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new InputProblem(message);
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  subject: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  )
    throw new InputProblem(`${subject} has missing or unknown fields.`);
}

function requireBoundedText(value: unknown, subject: string, maxBytes: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    UTF8.encode(value).length > maxBytes ||
    CONTROL_CHARACTER.test(value)
  )
    throw new InputProblem(`${subject} must be non-empty bounded printable text.`);
  return value;
}

function requireHex(value: unknown, subject: string): string {
  if (typeof value !== 'string' || !HEX_32.test(value))
    throw new InputProblem(`${subject} must be exactly 64 lowercase hexadecimal characters.`);
  return value;
}

function requireEntityList(value: unknown, subject: string): readonly number[] {
  if (!Array.isArray(value) || value.length > BRANCHFALL.entities)
    throw new InputProblem(`${subject} must be a bounded list of entity indices.`);
  const result: number[] = [];
  let previous = -1;
  for (const [index, entity] of value.entries()) {
    if (
      typeof entity !== 'number' ||
      !Number.isSafeInteger(entity) ||
      entity < 0 ||
      entity >= BRANCHFALL.entities
    )
      throw new InputProblem(`${subject}[${index}] is not a BRANCHFALL entity index.`);
    if (entity <= previous)
      throw new InputProblem(`${subject} must be ascending and contain no duplicate entity.`);
    result.push(entity);
    previous = entity;
  }
  return Object.freeze(result);
}

function knownContract(contractId: string, subject: string): StageContract {
  const contract = BRANCHFALL.contracts.find((candidate) => candidate.id === contractId);
  if (!contract) throw new InputProblem(`${subject} names unknown contract "${contractId}".`);
  return contract;
}

/**
 * Decode the wire transcript as hostile input.
 *
 * This parser is deliberately narrower than a convenient `as Transcript` cast:
 * it checks exact key sets, bounded arrays, canonical entity lists and every
 * cryptographic string before a value reaches allocation or arithmetic. A
 * structurally valid but edited outcome remains parseable — it must produce an
 * arena mismatch, not be mistaken for an unavailable verifier.
 */
function parseTranscript(input: unknown): ParsedTranscript {
  const wire = requireRecord(input, 'The transcript must be an object.');
  if (typeof wire.schema !== 'string')
    throw new InputProblem('The transcript schema is missing.');
  if (wire.schema !== TRANSCRIPT_SCHEMA)
    throw new InputProblem(`The transcript schema "${wire.schema}" is not supported.`);
  requireExactKeys(
    wire,
    [
      'schema',
      'definitionId',
      'definitionVersion',
      'definitionFingerprint',
      'roundId',
      'clientEntropy',
      'seedCommitment',
      'tapeDigest',
      'choices',
      'steps',
      'commitment',
    ],
    'The transcript',
  );

  if (wire.definitionId !== BRANCHFALL.id)
    throw new InputProblem('The transcript is not for the BRANCHFALL definition.');
  if (wire.definitionVersion !== BRANCHFALL.version)
    throw new InputProblem(
      `The transcript definition version is not BRANCHFALL ${BRANCHFALL.version}.`,
    );

  const definitionFingerprint = requireHex(
    wire.definitionFingerprint,
    'The transcript definition fingerprint',
  );
  const roundId = requireBoundedText(wire.roundId, 'The operator round id', 63);
  if (roundId.includes('|'))
    throw new InputProblem('The operator round id must not contain the round-pair separator.');
  const clientEntropy = requireHex(wire.clientEntropy, 'The client entropy');
  const seedCommitment = requireHex(wire.seedCommitment, 'The transcript seed commitment');
  const tapeDigest = requireHex(wire.tapeDigest, 'The transcript tape digest');
  requireHex(wire.commitment, 'The transcript commitment');

  if (!Array.isArray(wire.choices) || wire.choices.length > BRANCHFALL.stages)
    throw new InputProblem('The transcript choice log is not a bounded array.');
  if (!Array.isArray(wire.steps) || wire.steps.length > BRANCHFALL.stages)
    throw new InputProblem('The transcript step log is not a bounded array.');
  if (wire.steps.length !== wire.choices.length)
    throw new InputProblem('A settled transcript must have one step for every logged choice.');

  const choices = wire.choices.map((candidate, index): ParsedChoice => {
    const choice = requireRecord(candidate, `Transcript choice ${index} must be an object.`);
    requireExactKeys(choice, ['contractId', 'banked'], `Transcript choice ${index}`);
    const contractId = requireBoundedText(
      choice.contractId,
      `Transcript choice ${index} contract id`,
      64,
    );
    knownContract(contractId, `Transcript choice ${index}`);
    return Object.freeze({
      contractId,
      banked: requireEntityList(choice.banked, `Transcript choice ${index} banked list`),
    });
  });

  const steps = wire.steps.map((candidate, index): ParsedStep => {
    const step = requireRecord(candidate, `Transcript step ${index} must be an object.`);
    requireExactKeys(
      step,
      ['index', 'contractId', 'banked', 'lanes', 'survivors', 'failed'],
      `Transcript step ${index}`,
    );
    if (step.index !== index)
      throw new InputProblem(`Transcript step ${index} has the wrong index.`);
    const contractId = requireBoundedText(
      step.contractId,
      `Transcript step ${index} contract id`,
      64,
    );
    knownContract(contractId, `Transcript step ${index}`);
    if (!Array.isArray(step.lanes) || step.lanes.length > BRANCHFALL.entities)
      throw new InputProblem(`Transcript step ${index} lane list is not bounded.`);
    const lanes = step.lanes.map((candidateLane, laneIndex): ParsedLane => {
      const lane = requireRecord(
        candidateLane,
        `Transcript step ${index} lane ${laneIndex} must be an object.`,
      );
      requireExactKeys(
        lane,
        ['entities', 'collapsed'],
        `Transcript step ${index} lane ${laneIndex}`,
      );
      if (typeof lane.collapsed !== 'boolean')
        throw new InputProblem(
          `Transcript step ${index} lane ${laneIndex} collapse flag must be a boolean.`,
        );
      return Object.freeze({
        entities: requireEntityList(
          lane.entities,
          `Transcript step ${index} lane ${laneIndex} entities`,
        ),
        collapsed: lane.collapsed,
      });
    });
    return Object.freeze({
      index,
      contractId,
      banked: requireEntityList(step.banked, `Transcript step ${index} banked list`),
      lanes: Object.freeze(lanes),
      survivors: requireEntityList(step.survivors, `Transcript step ${index} survivors`),
      failed: requireEntityList(step.failed, `Transcript step ${index} failed entities`),
    });
  });

  return Object.freeze({
    definitionFingerprint,
    roundId,
    clientEntropy,
    seedCommitment,
    tapeDigest,
    choices: Object.freeze(choices),
    steps: Object.freeze(steps),
  });
}

function encodeField(field: CanonicalField): Uint8Array {
  if (field instanceof Uint8Array) return new Uint8Array(field);
  if (typeof field === 'bigint') return UTF8.encode(field.toString(10));
  if (typeof field === 'number') {
    if (!Number.isSafeInteger(field))
      throw new Error('A canonical number is not a safe integer');
    return UTF8.encode(String(field));
  }
  return UTF8.encode(field);
}

/**
 * Reveal Engine's canonical framing from `src/internal/canonical.ts`.
 *
 * A field count and every byte length are unsigned 32-bit big-endian values.
 * The framing is the reason concatenated fields such as `["ab", "c"]` and
 * `["a", "bc"]` cannot share a preimage.
 */
function encodeFields(fields: readonly CanonicalField[]): Uint8Array {
  const encoded = fields.map(encodeField);
  let byteLength = 4;
  for (const part of encoded) {
    if (part.length > 0xffff_ffff)
      throw new Error('A canonical field is too large');
    byteLength += 4 + part.length;
  }
  const output = new Uint8Array(byteLength);
  const view = new DataView(output.buffer);
  let offset = 0;
  view.setUint32(offset, encoded.length, false);
  offset += 4;
  for (const part of encoded) {
    view.setUint32(offset, part.length, false);
    offset += 4;
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

function hexToBytes(hex: string): Uint8Array {
  if (!HEX_32.test(hex))
    throw new InputProblem('The revealed server seed must be 64 lowercase hexadecimal characters.');
  const result = new Uint8Array(32);
  for (let index = 0; index < result.length; index += 1)
    result[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return result;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

/**
 * DOM Web Crypto accepts views backed by an `ArrayBuffer`, not the wider
 * `ArrayBufferLike` TypeScript permits for a general `Uint8Array`.
 *
 * Every byte array built here already has ordinary ArrayBuffer storage in real
 * browsers. The explicit copy keeps that runtime fact visible to strict typing
 * and also prevents an exotic caller-owned shared buffer from crossing into a
 * cryptographic operation while another agent could mutate it.
 */
function cryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

async function sha256Hex(subtle: SubtleCrypto, input: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await subtle.digest('SHA-256', cryptoBytes(input))));
}

async function sealCommitment(
  subtle: SubtleCrypto,
  seedBytes: Uint8Array,
  body: Uint8Array,
): Promise<string> {
  return sha256Hex(
    subtle,
    encodeFields(['commitment', COMMITMENT_VERSION, seedBytes, body]),
  );
}

function laneSizes(contract: StageContract, liveCount: number): readonly number[] {
  const sizes: number[] = [];
  for (let remaining = liveCount; remaining > 0; remaining -= contract.laneWidth)
    sizes.push(remaining < contract.laneWidth ? remaining : contract.laneWidth);
  return Object.freeze(sizes);
}

function definitionFields(): readonly CanonicalField[] {
  const fields: CanonicalField[] = [
    'staged-survival definition',
    ENGINE_API_VERSION,
    STAGED_SURVIVAL_MODULE_ID,
    BRANCHFALL.id,
    BRANCHFALL.version,
    BRANCHFALL.entities,
    BRANCHFALL.stages,
    BRANCHFALL.drawModulus,
    BRANCHFALL.contracts.length,
  ];
  for (const contract of BRANCHFALL.contracts) {
    const laneFailure = rational(
      contract.profile.laneFailure.numerator,
      contract.profile.laneFailure.denominator,
    );
    const entitySurvival = rational(
      contract.profile.entitySurvival.numerator,
      contract.profile.entitySurvival.denominator,
    );
    const multiplier = rational(
      contract.multiplier.numerator,
      contract.multiplier.denominator,
    );
    fields.push(
      contract.id,
      contract.laneWidth,
      contract.minEntities,
      laneFailure.numerator,
      laneFailure.denominator,
      entitySurvival.numerator,
      entitySurvival.denominator,
      multiplier.numerator,
      multiplier.denominator,
    );
    for (let live = contract.minEntities; live <= BRANCHFALL.entities; live += 1) {
      const sizes = laneSizes(contract, live);
      fields.push(live, sizes.length, ...sizes);
    }
  }
  const entryReturn = rational(
    BRANCHFALL.pricing.entryReturn.numerator,
    BRANCHFALL.pricing.entryReturn.denominator,
  );
  const continuationReturn = rational(
    BRANCHFALL.pricing.continuationReturn.numerator,
    BRANCHFALL.pricing.continuationReturn.denominator,
  );
  fields.push(
    entryReturn.numerator,
    entryReturn.denominator,
    continuationReturn.numerator,
    continuationReturn.denominator,
    BRANCHFALL.pricing.rounding,
    BRANCHFALL.risk.maxWinMultiple,
    BRANCHFALL.risk.capBasis,
    BRANCHFALL.risk.capMustBeUnreachable ? 1 : 0,
  );
  return Object.freeze(fields);
}

async function survivalFingerprint(subtle: SubtleCrypto): Promise<string> {
  return sealCommitment(
    subtle,
    hexToBytes(FINGERPRINT_SEED),
    encodeFields(definitionFields()),
  );
}

/**
 * One HMAC key is imported for the revealed seed and retained for every draw.
 *
 * Importing it inside `uniformBigInt` would perform 300 key imports for a normal
 * BRANCHFALL derivation. Besides wasting most of the verifier's time, that would
 * make the verification screen vulnerable to appearing hung on slower devices.
 */
async function importSamplerKey(
  subtle: SubtleCrypto,
  seedBytes: Uint8Array,
): Promise<CryptoKey> {
  return subtle.importKey(
    'raw',
    cryptoBytes(seedBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function uniformBigInt(
  subtle: SubtleCrypto,
  key: CryptoKey,
  domain: string,
  roundId: string,
  label: string,
  counter: number,
  modulus: bigint,
): Promise<bigint> {
  const limit = UINT256_RANGE - (UINT256_RANGE % modulus);
  for (let nonce = 0n; ; nonce += 1n) {
    const payload = encodeFields([
      'sampler',
      COMMITMENT_VERSION,
      domain,
      roundId,
      label,
      counter,
      nonce,
      modulus,
    ]);
    const digest = new Uint8Array(
      await subtle.sign('HMAC', key, cryptoBytes(payload)),
    );
    const value = bytesToBigInt(digest);
    if (value < limit) return value % modulus;
  }
}

function blockIndex(stage: number, contractIndex: number): number {
  return (
    (stage * BRANCHFALL.contracts.length + contractIndex) *
    BRANCHFALL.entities *
    2
  );
}

/**
 * Expand every counterfactual route, not only the route the transcript chose.
 *
 * The promises are created together because Web Crypto may schedule independent
 * HMAC operations efficiently, but `Promise.all` preserves their declared tape
 * order. Rejection remains local to an address: a retry changes only that
 * address's nonce and cannot shift any later counter.
 */
async function deriveTape(
  subtle: SubtleCrypto,
  seedBytes: Uint8Array,
  fingerprint: string,
  roundPair: string,
): Promise<readonly TapeDraw[]> {
  const key = await importSamplerKey(subtle, seedBytes);
  const addresses: { readonly label: string; readonly counter: number }[] = [];
  for (let stage = 0; stage < BRANCHFALL.stages; stage += 1)
    for (
      let contractIndex = 0;
      contractIndex < BRANCHFALL.contracts.length;
      contractIndex += 1
    ) {
      const base = blockIndex(stage, contractIndex);
      for (let slot = 0; slot < BRANCHFALL.entities; slot += 1)
        addresses.push({ label: LANE_LABEL, counter: base + slot });
      for (let slot = 0; slot < BRANCHFALL.entities; slot += 1)
        addresses.push({
          label: ENTITY_LABEL,
          counter: base + BRANCHFALL.entities + slot,
        });
    }

  const values = await Promise.all(
    addresses.map((address) =>
      uniformBigInt(
        subtle,
        key,
        fingerprint,
        roundPair,
        address.label,
        address.counter,
        BRANCHFALL.drawModulus,
      ),
    ),
  );
  return Object.freeze(
    addresses.map((address, index) =>
      Object.freeze({
        ...address,
        modulus: BRANCHFALL.drawModulus,
        value: values[index] as bigint,
      }),
    ),
  );
}

async function tapeDigest(
  subtle: SubtleCrypto,
  fingerprint: string,
  roundPair: string,
  draws: readonly TapeDraw[],
): Promise<string> {
  const fields: CanonicalField[] = ['tape', fingerprint, roundPair, draws.length];
  for (const draw of draws)
    fields.push(draw.label, draw.counter, draw.modulus, draw.value);
  return sha256Hex(subtle, encodeFields(fields));
}

async function seedCommitment(
  subtle: SubtleCrypto,
  seedBytes: Uint8Array,
  fingerprint: string,
  operatorRoundId: string,
): Promise<string> {
  return sha256Hex(
    subtle,
    encodeFields([
      'seed-commitment',
      COMMITMENT_VERSION,
      seedBytes,
      STAGED_SURVIVAL_MODULE_ID,
      BRANCHFALL.id,
      fingerprint,
      operatorRoundId,
      COMMITMENT_VERSION,
    ]),
  );
}

function threshold(probability: Rational): bigint {
  const reduced = rational(probability.numerator, probability.denominator);
  if (BRANCHFALL.drawModulus % reduced.denominator !== 0n)
    throw new Error('A local probability denominator does not divide the draw modulus');
  return reduced.numerator * (BRANCHFALL.drawModulus / reduced.denominator);
}

function partition(contract: StageContract, live: readonly number[]): readonly (readonly number[])[] {
  const lanes: (readonly number[])[] = [];
  for (let start = 0; start < live.length; start += contract.laneWidth)
    lanes.push(Object.freeze(live.slice(start, start + contract.laneWidth)));
  return Object.freeze(lanes);
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameLanes(left: readonly LaneView[], right: readonly ParsedLane[]): boolean {
  return (
    left.length === right.length &&
    left.every((lane, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        lane.collapsed === other.collapsed &&
        sameNumbers(lane.entities, other.entities)
      );
    })
  );
}

function arenaNote(
  lanes: readonly LaneView[],
  entities: readonly EntityView[],
  modulus: string,
): string {
  const collapsedIndex = lanes.findIndex((lane) => lane.collapsed);
  if (collapsedIndex >= 0) {
    const lane = lanes[collapsedIndex] as LaneView;
    return `lane ${collapsedIndex + 1} drew ${lane.draw} of ${modulus} against ${lane.threshold} — the lane collapsed`;
  }
  const failed = entities.find((entity) => !entity.survived);
  const firstLane = lanes[0] as LaneView;
  if (failed)
    return `lane 1 drew ${firstLane.draw} of ${modulus} against ${firstLane.threshold} — the lane held; entity ${failed.entity} drew ${failed.draw} of ${modulus} against ${failed.threshold} and fell`;
  return `all ${lanes.length} lane draw${lanes.length === 1 ? '' : 's'} held; all ${entities.length} entity draws cleared`;
}

/**
 * Read the chosen route from the already complete tape.
 *
 * Entity draws are exposed even for a collapsed lane. The engine correctly
 * short-circuits those comparisons because the shared shock has already decided
 * the outcome; the verification table still prints the committed values so the
 * player can inspect the whole arena rather than a selectively redacted proof.
 */
function deriveArenas(
  transcript: ParsedTranscript,
  draws: readonly TapeDraw[],
): readonly ArenaDerivation[] {
  let live: readonly number[] = Object.freeze(
    Array.from({ length: BRANCHFALL.entities }, (_value, index) => index),
  );
  const arenas: ArenaDerivation[] = [];

  for (const [stage, choice] of transcript.choices.entries()) {
    const liveSet = new Set(live);
    for (const entity of choice.banked) {
      if (!liveSet.has(entity))
        throw new InputProblem(
          `Transcript choice ${stage} banks entity ${entity}, which was not running.`,
        );
      liveSet.delete(entity);
    }
    const running = Object.freeze([...liveSet].sort((left, right) => left - right));
    if (running.length === 0)
      throw new InputProblem(`Transcript choice ${stage} leaves no entity to run.`);

    const contract = knownContract(choice.contractId, `Transcript choice ${stage}`);
    if (contract.minEntities > running.length)
      throw new InputProblem(
        `Transcript choice ${stage} uses ${contract.id} with too few running entities.`,
      );
    const contractIndex = BRANCHFALL.contracts.indexOf(contract);
    const base = blockIndex(stage, contractIndex);
    const laneThreshold = threshold(contract.profile.laneFailure);
    const entityThreshold = threshold(contract.profile.entitySurvival);
    const laneViews: LaneView[] = [];
    const entityViews: EntityView[] = [];
    const survivors: number[] = [];
    const failed: number[] = [];

    partition(contract, running).forEach((laneEntities, laneIndex) => {
      const laneDraw = draws[base + laneIndex];
      if (
        laneDraw === undefined ||
        laneDraw.label !== LANE_LABEL ||
        laneDraw.counter !== base + laneIndex
      )
        throw new Error('The locally derived lane draw is missing from its address');
      const collapsed = laneDraw.value < laneThreshold;
      laneViews.push(
        Object.freeze({
          entities: laneEntities,
          collapsed,
          draw: laneDraw.value.toString(10),
          threshold: laneThreshold.toString(10),
          modulus: BRANCHFALL.drawModulus.toString(10),
        }),
      );

      for (const entity of laneEntities) {
        const counter = base + BRANCHFALL.entities + entity;
        const entityDraw = draws[counter];
        if (
          entityDraw === undefined ||
          entityDraw.label !== ENTITY_LABEL ||
          entityDraw.counter !== counter
        )
          throw new Error('The locally derived entity draw is missing from its address');
        const survived = !collapsed && entityDraw.value < entityThreshold;
        entityViews.push(
          Object.freeze({
            entity,
            draw: entityDraw.value.toString(10),
            threshold: entityThreshold.toString(10),
            survived,
          }),
        );
        (survived ? survivors : failed).push(entity);
      }
    });

    const published = transcript.steps[stage] as ParsedStep;
    const matchesTranscript =
      published.index === stage &&
      published.contractId === contract.id &&
      sameNumbers(published.banked, choice.banked) &&
      sameLanes(laneViews, published.lanes) &&
      sameNumbers(survivors, published.survivors) &&
      sameNumbers(failed, published.failed);
    arenas.push(
      Object.freeze({
        index: stage,
        contractId: contract.id,
        banked: choice.banked,
        running,
        lanes: Object.freeze(laneViews),
        entities: Object.freeze(entityViews),
        survivors: Object.freeze(survivors),
        failed: Object.freeze(failed),
        matchesTranscript,
        note: arenaNote(
          laneViews,
          entityViews,
          BRANCHFALL.drawModulus.toString(10),
        ),
      }),
    );
    live = Object.freeze(survivors);
  }
  return Object.freeze(arenas);
}

/**
 * Recompute a settled round without trusting the server's derived verdict.
 *
 * The function is total at the browser boundary: malformed caller data, missing
 * secure-context Web Crypto and cryptographic runtime failures all become an
 * unavailable result with a readable reason. It never substitutes a weaker hash
 * or a pseudo-random fallback, because a plausible-looking fake verification is
 * worse than an explicit statement that verification is unavailable.
 */
export async function rederive(input: RederiveInput): Promise<Rederivation> {
  const startedAt = nowMs();
  const subtle = (globalThis as { readonly crypto?: Crypto }).crypto?.subtle;
  if (!subtle)
    return unavailable(
      startedAt,
      'On-device re-derivation is unavailable because this page has no secure Web Crypto context.',
    );

  try {
    const candidate = requireRecord(input, 'The re-derivation input must be an object.');
    const revealedServerSeed = requireHex(
      candidate.revealedServerSeed,
      'The revealed server seed',
    );
    const preCommitment = requireHex(candidate.preCommitment, 'The published pre-commitment');
    const publishedFingerprint = requireHex(
      candidate.publishedFingerprint,
      'The published definition fingerprint',
    );
    const transcript = parseTranscript(candidate.transcript);
    const seedBytes = hexToBytes(revealedServerSeed);

    const fingerprint = await survivalFingerprint(subtle);
    const fingerprintMatches =
      fingerprint === publishedFingerprint &&
      fingerprint === transcript.definitionFingerprint;
    const roundPair = `${transcript.roundId}|${transcript.clientEntropy}`;
    const draws = await deriveTape(subtle, seedBytes, fingerprint, roundPair);
    const [derivedSeedCommitment, derivedTapeDigest] = await Promise.all([
      seedCommitment(subtle, seedBytes, fingerprint, transcript.roundId),
      tapeDigest(subtle, fingerprint, roundPair, draws),
    ]);
    const commitmentMatches =
      derivedSeedCommitment === preCommitment &&
      derivedSeedCommitment === transcript.seedCommitment;
    const digestMatches = derivedTapeDigest === transcript.tapeDigest;
    const arenas = deriveArenas(transcript, draws);
    const arenasMatch = arenas.every((arena) => arena.matchesTranscript);

    return {
      available: true,
      fingerprint,
      fingerprintMatches,
      seedCommitment: derivedSeedCommitment,
      commitmentMatches,
      tapeDigest: derivedTapeDigest,
      digestMatches,
      drawCount: draws.length,
      arenas,
      ok:
        fingerprintMatches &&
        commitmentMatches &&
        digestMatches &&
        arenasMatch,
      elapsedMs: elapsedSince(startedAt),
    };
  } catch (error) {
    if (error instanceof InputProblem) return unavailable(startedAt, error.message);
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    return unavailable(
      startedAt,
      `On-device re-derivation could not complete.${detail}`,
    );
  }
}
