import { GROWTH_PER_MS, MAX_MULT, MIN_MULT } from './config';

/** Multiplier (integer hundredths, floored) after `elapsedMs` of running. */
export function multiplierAt(elapsedMs: number): number {
  if (elapsedMs <= 0) return MIN_MULT;
  const m = Math.floor(100 * Math.exp(GROWTH_PER_MS * elapsedMs) + 1e-9);
  return Math.min(Math.max(m, MIN_MULT), MAX_MULT);
}

/** Continuous (unfloored) multiplier, for smooth presentation only. */
export function multiplierAtSmooth(elapsedMs: number): number {
  if (elapsedMs <= 0) return 1;
  return Math.min(Math.exp(GROWTH_PER_MS * elapsedMs), MAX_MULT / 100);
}

/** Earliest elapsed time (ms, ceil) at which `multiplierAt` reaches `mult` hundredths. */
export function elapsedFor(mult: number): number {
  if (mult <= MIN_MULT) return 0;
  let t = Math.ceil(Math.log(mult / 100) / GROWTH_PER_MS);
  // Nudge across float boundaries so multiplierAt(t) >= mult > multiplierAt(t - 1).
  while (multiplierAt(t) < mult) t++;
  while (t > 0 && multiplierAt(t - 1) >= mult) t--;
  return t;
}
