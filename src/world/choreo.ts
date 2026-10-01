import { Rng } from '../engine/rng';

/**
 * Presentation choreography: pure selection functions for run tiers and for
 * crash / escape variants.
 *
 * Honesty rule: every function here is a pure function of values that are
 * already public when it is called — the *current* multiplier (and time), or a
 * round id plus the *settled* multiplier. None of them can see the hidden crash
 * point, so nothing on screen before settlement can encode where the round ends,
 * and nothing after a cash-out can encode how close the fall was.
 */

export type CrashKind = 'chasm' | 'gate' | 'rockfall';

/** Run tiers by current multiplier: composed, driven, sprint, all-out, desperate. */
export const TIER_AT = [2, 5, 10, 25] as const;
export const TIER_NAMES = ['composed', 'driven', 'sprint', 'all-out', 'desperate'] as const;

export function runTier(mult: number): number {
  let t = 0;
  for (const m of TIER_AT) if (mult >= m) t++;
  return t;
}

/**
 * A continuous tier level, 0 at 1.00× rising through 1, 2, 3, 4 at the tier
 * boundaries (log-linear between them). Drives gait and camera blends so tier
 * changes never pop.
 */
export function runDrive(mult: number): number {
  const anchors = [1, ...TIER_AT];
  const m = Math.max(1, mult);
  if (m >= anchors[anchors.length - 1]!) return anchors.length - 1;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (m < b) return i + Math.log(m / a) / Math.log(b / a);
  }
  return anchors.length - 1;
}

/** How grand a settled moment should be: 0 at ≤1.5×, 1 at ≥10× (log scale). */
export function epicOf(mult: number): number {
  const x = Math.log(Math.max(1, mult) / 1.5) / Math.log(10 / 1.5);
  return Math.min(1, Math.max(0, x));
}

/** Runner clip for each crash kind and variant. */
export const CRASH_CLIPS: Record<CrashKind, readonly string[]> = {
  chasm: ['fall_chasm', 'fall_chasm_b'],
  gate: ['fall_gate', 'fall_gate_b'],
  rockfall: ['fall_rock', 'fall_rock_b'],
};

export interface CrashStaging {
  kind: CrashKind;
  variant: number;
  clip: string;
  /** 0 (quick, small) … 1 (big, slow, cinematic). */
  epic: number;
  /** The fall came before the runner got going: the gate slams as they push off. */
  atStart: boolean;
}

/**
 * Staging for a settled fall, from the round id and the (now public) crash
 * multiplier. `hazards` are the kinds the current section can stage; `standing`
 * means the runner has not got going yet (instant falls at 1.00×).
 */
export function crashStaging(roundId: string, crashMult: number, hazards: readonly CrashKind[], standing: boolean): CrashStaging {
  const epic = epicOf(crashMult);
  if (standing) return { kind: 'gate', variant: 0, clip: 'fall_start', epic: 0, atStart: true };
  const r = new Rng(`${roundId}/staging`);
  const kind = hazards.length ? r.pick(hazards) : 'rockfall';
  const variant = new Rng(`${roundId}/variant/${kind}`).int(0, CRASH_CLIPS[kind].length - 1);
  return { kind, variant, clip: CRASH_CLIPS[kind][variant]!, epic, atStart: false };
}

export type EscapeVariant = 'lookback' | 'cheer' | 'salute' | 'leap';
export const ESCAPE_CLIPS: Record<EscapeVariant, string> = { lookback: 'win', cheer: 'win_cheer', salute: 'win_salute', leap: 'win_leap' };

/** Relative weights by cash-out tier: bigger escapes favour the grander moves. */
const ESCAPE_WEIGHTS: readonly (readonly [number, readonly (readonly [EscapeVariant, number])[]])[] = [
  [1, [['lookback', 3], ['salute', 3], ['cheer', 1], ['leap', 0.5]]],
  [2, [['lookback', 3], ['salute', 2], ['cheer', 2], ['leap', 1]]],
  [10, [['lookback', 2], ['salute', 1], ['cheer', 2], ['leap', 2]]],
  [Infinity, [['lookback', 1], ['salute', 0.5], ['cheer', 2], ['leap', 3]]],
];

export interface EscapeStaging {
  variant: EscapeVariant;
  clip: string;
  epic: number;
  /** Seconds into the clip to start (a standing runner skips the run-out). */
  offset: number;
}

/**
 * Staging for a cash-out, from a round seed and the cash-out multiplier only.
 * `standing` (the runner barely moving, e.g. a cash-out at 1.00×) picks the
 * calm turn-and-salute and starts it past its run-out.
 */
export function escapeStaging(seed: string, cashMult: number, standing: boolean): EscapeStaging {
  const epic = epicOf(cashMult);
  if (standing) return { variant: 'salute', clip: ESCAPE_CLIPS.salute, epic, offset: 0.7 };
  const table = ESCAPE_WEIGHTS.find(([below]) => cashMult < below)![1];
  const variant = new Rng(`${seed}/escape`).weighted(table);
  return { variant, clip: ESCAPE_CLIPS[variant], epic, offset: 0 };
}

export type Beat = 'glance' | 'stumble';

/**
 * The next cosmetic beat in a run (a glance back over the shoulder, a
 * stumble-and-recover), from the cosmetic RNG and the current tier only.
 * Returns null below the tiers that have beats. `wait` is seconds until it.
 */
export function nextBeat(rng: Rng, tier: number): { beat: Beat; wait: number } | null {
  if (tier < 2) return null;
  const wait = rng.range(3.5, 8) * (1.35 - 0.15 * tier);
  const beat: Beat = rng.chance(tier >= 3 ? 0.55 : 0.3) ? 'glance' : 'stumble';
  return { beat, wait };
}
