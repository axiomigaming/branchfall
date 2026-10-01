import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { MAX_MULT, MIN_MULT, RTP_DEN, RTP_NUM } from './config';

/**
 * Provably-fair derivation.
 *
 *   commitment = SHA-256(serverSeed)                       published before the bet
 *   roundHash  = HMAC-SHA-256(key = serverSeed, "clientSeed:nonce")
 *   h          = first 52 bits of roundHash, uniform on [0, 2^52)
 *   crash      = floor( 100 · RTP · 2^52 / (2^52 − h) ) hundredths, clamped to [1.00x, 10,000x]
 *
 * So P(crash ≥ m) = RTP / m for every m in [1.00x, 10,000x]: whatever multiplier a
 * player aims for, the expected return is exactly RTP. No timing is better than any
 * other, and the presentation cannot change it.
 */

const TWO52 = 1n << 52n;

export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

export function commitmentOf(serverSeedHex: string): string {
  return bytesToHex(sha256(hexToBytes(serverSeedHex)));
}

export function roundHash(serverSeedHex: string, clientSeed: string, nonce: number): string {
  return bytesToHex(hmac(sha256, hexToBytes(serverSeedHex), utf8ToBytes(`${clientSeed}:${nonce}`)));
}

/** Crash point in integer hundredths from the 52-bit draw `h`. Exact, BigInt only. */
export function crashFromDraw(h: bigint): number {
  if (h < 0n || h >= TWO52) throw new RangeError('draw out of range');
  const c = (RTP_NUM * 100n * TWO52) / (RTP_DEN * (TWO52 - h));
  if (c < BigInt(MIN_MULT)) return MIN_MULT;
  if (c > BigInt(MAX_MULT)) return MAX_MULT;
  return Number(c);
}

export function drawFromHash(hashHex: string): bigint {
  return BigInt('0x' + hashHex.slice(0, 13)); // 13 hex digits = 52 bits
}

export function crashPoint(serverSeedHex: string, clientSeed: string, nonce: number): number {
  return crashFromDraw(drawFromHash(roundHash(serverSeedHex, clientSeed, nonce)));
}

export interface RoundProof {
  serverSeed: string;
  commitment: string;
  clientSeed: string;
  nonce: number;
}

export interface VerifyResult {
  ok: boolean;
  commitmentMatches: boolean;
  crash: number;
  hash: string;
}

/** Anyone holding a revealed round can run this. It needs nothing from the operator. */
export function verifyRound(p: RoundProof, claimedCrash?: number): VerifyResult {
  const commitmentMatches = /^[0-9a-f]{64}$/.test(p.serverSeed) && commitmentOf(p.serverSeed) === p.commitment;
  const hash = commitmentMatches ? roundHash(p.serverSeed, p.clientSeed, p.nonce) : '';
  const crash = commitmentMatches ? crashFromDraw(drawFromHash(hash)) : 0;
  const ok = commitmentMatches && (claimedCrash === undefined || claimedCrash === crash);
  return { ok, commitmentMatches, crash, hash };
}

export function randomSeedHex(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** Deterministic server-seed stream for reproducible test sessions (?seed=…). Never for play. */
export function derivedSeed(master: string, index: number): string {
  return sha256Hex(`causeway/demo-seed/${master}/${index}`);
}
