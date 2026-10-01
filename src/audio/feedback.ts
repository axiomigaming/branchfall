/**
 * Pure helpers for moment-to-moment feedback: milestones, HUD heat, the tension
 * riser, haptics. Every cue here is a function of the multiplier already on
 * screen (or of an event that already happened). None of it knows, or could
 * know, where the round will end.
 */

/** Multipliers (integer hundredths) that earn a milestone flare. */
export const MILESTONES = [200, 500, 1000, 2500, 5000, 10000] as const;

/** Index of the highest milestone crossed going from `prev` to `cur` (both hundredths), or -1. */
export function milestoneCrossed(prev: number, cur: number): number {
  let hit = -1;
  for (let i = 0; i < MILESTONES.length; i++) if (prev < MILESTONES[i]! && cur >= MILESTONES[i]!) hit = i;
  return hit;
}

/**
 * How far the multiplier has travelled from the last milestone towards the next,
 * in log space: 0 just after a milestone, → 1 on arrival. Past the last one it is 0.
 * Drives the tension riser; it depends on nothing but `m`.
 */
export function milestoneApproach(m: number): number {
  let lo = 100;
  for (const hi of MILESTONES) {
    if (m < hi) return Math.min(1, Math.max(0, Math.log(m / lo) / Math.log(hi / lo)));
    lo = hi;
  }
  return 0;
}

/** HUD heat 0..1 from the multiplier (hundredths): 0 at 1×, ½ at 5×, 1 at 25× and beyond. */
export function heatOf(m: number): number {
  return Math.min(1, Math.max(0, Math.log(m / 100) / Math.log(25)));
}

/**
 * Presentation tier for a multiplier (hundredths), shared with the world:
 * 0 below 2×, 1 for 2–5×, 2 for 5–10×, 3 for 10–25×, 4 from 25×.
 * Live cues use the current multiplier; a result uses the multiplier it settled at
 * (the cash-out multiplier for an escape — never the fall point).
 */
export type Tier = 0 | 1 | 2 | 3 | 4;
export const TIER_BOUNDS = [200, 500, 1000, 2500] as const;
export function tierOf(m: number): Tier {
  return m >= 2500 ? 4 : m >= 1000 ? 3 : m >= 500 ? 2 : m >= 200 ? 1 : 0;
}

/** Short label for a milestone flare. */
export function milestoneLabel(i: number): string {
  return `${MILESTONES[i]! / 100}×`;
}

/** Deterministic ease used by the win count-up (easeOutCubic). */
export function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

/**
 * The value shown by a count-up at progress `t` (0..1), from `from` to `to` in
 * integer hundredths. Monotone, integer, and lands exactly on `to`.
 */
export function countUp(from: number, to: number, t: number): number {
  if (t >= 1) return to;
  return Math.round(from + (to - from) * easeOut(t));
}

// ------------------------------------------------------------------ haptics

export type Haptic = 'bet' | 'go' | 'cashout' | 'crash' | 'milestone' | 'press';

export const HAPTIC_PATTERNS: Record<Haptic, number | number[]> = {
  press: 8,
  bet: [14, 40, 10],
  go: 12,
  milestone: [10, 60, 18],
  cashout: [22, 50, 34],
  crash: [70, 40, 120],
};

let hapticsEnabled = true;

/** Turn haptics on or off (e.g. reduced motion). */
export function setHaptics(on: boolean): void {
  hapticsEnabled = on;
}

/** Short vibration on devices that support it; silently nothing elsewhere (iOS Safari, desktops). */
export function haptic(kind: Haptic): void {
  if (!hapticsEnabled) return;
  try {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }) : null;
    if (!nav || typeof nav.vibrate !== 'function') return;
    // Only after a user gesture; Chrome ignores (and warns about) earlier calls.
    const ua = (nav as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua && !ua.hasBeenActive) return;
    nav.vibrate(HAPTIC_PATTERNS[kind]);
  } catch {
    /* vibration blocked: nothing to do */
  }
}
