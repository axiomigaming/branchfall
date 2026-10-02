import type { QualityLevel } from '../config/quality';
import type { Rng } from '../engine/rng';
import { runTier } from '../world/choreo';

/**
 * Pure scaling and budget rules for the cinematic effects (falls, escapes, run-time danger cues).
 *
 * Honesty: a fall scales only with the settled crash multiplier, an escape only with the cash-out
 * multiplier, and a run-time cue only with the current multiplier and the cosmetic RNG.
 */

export type Motion = 'full' | 'reduced';

/** 0 at ≤1.5×, 1 at ≥25× (log scale): how grand a settled moment is for the effects. */
export function grandOf(mult: number): number {
  const x = Math.log(Math.max(1, mult) / 1.5) / Math.log(25 / 1.5);
  return Math.min(1, Math.max(0, x));
}

export interface FallScale {
  /** 0..1 grandness (see grandOf). */
  g: number;
  /** Slow motion: real seconds and the slowest time scale reached (1 = none). */
  slowDur: number;
  slowMin: number;
  /** Seconds of pre-impact cues (cracks spreading, grit falling) before the way gives. */
  pre: number;
  /** Metres of floor that drop in a chasm. */
  span: number;
  /** Multiplier on the number of debris pieces and dust emitters. */
  debris: number;
  dust: number;
  /** Camera trauma added on the main impact, and the lens punch in degrees. */
  shake: number;
  kick: number;
  /** Secondary collapse waves (walls coming down into the gap) after the first. */
  waves: number;
}

export function fallScale(mult: number, motion: Motion = 'full'): FallScale {
  const g = grandOf(mult);
  const reduced = motion === 'reduced';
  const slowDur = reduced ? 0.5 : 1.0 + 2.6 * g;
  const slowMin = reduced ? 0.8 : 0.5 - 0.3 * g;
  return {
    g,
    slowDur,
    slowMin,
    pre: 0.18 + 0.55 * g,
    span: 6 + 16 * g,
    debris: 0.6 + 1.6 * g,
    dust: (0.6 + 1.4 * g) * (reduced ? 0.6 : 1),
    shake: (0.3 + 0.55 * g) * (reduced ? 0.3 : 1),
    kick: (2 + 6 * g) * (reduced ? 0.25 : 1),
    waves: g < 0.35 ? 0 : g < 0.7 ? 1 : 2,
  };
}

export interface EscapeScale {
  g: number;
  slowDur: number;
  slowMin: number;
  /** Light shafts: how many beams and how bright (0..1). */
  beams: number;
  shafts: number;
  /** Birds taking off from the trees ahead. */
  birds: number;
  /** Golden rim on the runner (0..1). */
  rim: number;
  /** Camera vista reveal at the end of the move (0..1). */
  reveal: number;
  bloom: number;
}

export function escapeScale(mult: number, motion: Motion = 'full'): EscapeScale {
  const g = grandOf(mult);
  const reduced = motion === 'reduced';
  return {
    g,
    slowDur: reduced ? 0.4 : 0.7 + 1.8 * g,
    slowMin: reduced ? 0.85 : 0.62 - 0.27 * g,
    beams: Math.round(2 + 4 * g),
    shafts: 0.35 + 0.65 * g,
    birds: Math.round(4 + 22 * g),
    rim: 0.45 + 0.55 * g,
    reveal: g < 0.2 ? 0 : Math.min(1, (g - 0.2) / 0.6),
    bloom: 0.25 + 0.6 * g,
  };
}

export interface FxBudget {
  /** Lit dust-cloud sprites alive at once. */
  billows: number;
  /** Rigid debris bodies alive at once. */
  bodies: number;
  /** Fragments a breaking chunk splits into. */
  shards: number;
  /** Water shockwave rings alive at once. */
  rings: number;
  /** Birds in flight at once. */
  birds: number;
  /** Light shafts at once. */
  beams: number;
  /** Gold and jade escape glints alive at once. */
  sparks: number;
}

const BUDGETS: Record<QualityLevel, FxBudget> = {
  low: { billows: 70, bodies: 22, shards: 2, rings: 4, birds: 10, beams: 2, sparks: 90 },
  medium: { billows: 150, bodies: 40, shards: 3, rings: 8, birds: 18, beams: 4, sparks: 160 },
  high: { billows: 230, bodies: 60, shards: 4, rings: 10, birds: 26, beams: 6, sparks: 240 },
  ultra: { billows: 320, bodies: 80, shards: 5, rings: 12, birds: 32, beams: 6, sparks: 300 },
};

/** Effect budgets per quality tier; reduced motion trims the busiest ones. */
export function fxBudget(level: QualityLevel, motion: Motion = 'full'): FxBudget {
  const b = { ...BUDGETS[level] };
  if (motion === 'reduced') {
    b.billows = Math.round(b.billows * 0.6);
    b.birds = Math.round(b.birds * 0.5);
    b.shards = Math.max(1, b.shards - 1);
    b.sparks = Math.round(b.sparks * 0.6);
  }
  return b;
}

/** Hard capacity of the pools (the largest budget). */
export const FX_CAPACITY: FxBudget = BUDGETS.ultra;

export type DangerCue = 'burst' | 'stones' | 'rumble' | 'birds';

/**
 * Relative weights and the mean wait for run-time danger cues at a run tier. Tier 0 is calm;
 * from tier 1 walls start to shed dust, and the cues thicken with each tier.
 */
const CUE_TABLE: readonly { wait: number; w: readonly (readonly [DangerCue, number])[] }[] = [
  { wait: Infinity, w: [] },
  { wait: 7.5, w: [['burst', 2], ['birds', 2], ['stones', 1]] },
  { wait: 4.6, w: [['burst', 3], ['stones', 2], ['birds', 1], ['rumble', 1]] },
  { wait: 3.0, w: [['burst', 3], ['stones', 2], ['rumble', 2], ['birds', 1]] },
  { wait: 1.9, w: [['burst', 4], ['stones', 3], ['rumble', 2], ['birds', 1]] },
];

/**
 * The next cosmetic danger cue from the current multiplier and the cosmetic RNG only, or null when
 * the run is calm. `wait` is seconds until it, `strength` 0..1 scales it.
 */
export function nextDangerCue(rng: Rng, mult: number): { cue: DangerCue; wait: number; strength: number } | null {
  const tier = runTier(mult);
  const row = CUE_TABLE[tier]!;
  if (!row.w.length) return null;
  const cue = rng.weighted(row.w);
  const wait = row.wait * rng.range(0.6, 1.4);
  const strength = Math.min(1, 0.25 + 0.2 * tier + rng.range(0, 0.15));
  return { cue, wait, strength };
}

/**
 * How long the result card waits (presentation only): `after` real seconds past the impact (the
 * slam, the floor giving, the first block; for an escape, the cash-out itself), and never longer
 * than `cap` real seconds after the event. Money and state are settled before any of this.
 */
export function revealHold(outcome: 'fall' | 'escape', mult: number, motion: Motion = 'full'): { after: number; cap: number } {
  const g = grandOf(mult);
  const reduced = motion === 'reduced';
  if (outcome === 'escape') return { after: reduced ? 0.8 : 1.0 + 0.2 * g, cap: 2.0 };
  return { after: reduced ? 0.7 : 0.85 + 0.35 * g, cap: 3.4 };
}
