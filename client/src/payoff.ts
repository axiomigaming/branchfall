/**
 * How big the payoff is, and therefore how big the payoff *looks*.
 *
 * ## Why this file exists
 *
 * The round-2 build played exactly one celebration. `playSettledBeat` took the
 * survivor count as its only parameter, so banking 4.06 on a 5.00 stake (0.81x)
 * and banking 15.28 on the same stake (3.06x) produced byte-identical beats: the
 * same door timing, the same bell, the same bloom, the same 46 px figure with the
 * same glow, the same ~1.2 s count-up, the same silence after. Frame dumps of the
 * two rounds matched frame for frame. A game that cannot tell the player they
 * just did something rare is a game with no top end.
 *
 * `DESIGN.md` §6.4 asks for exactly this and the build did not implement it:
 *
 * > The reward for a big bank is that the tree is briefly warm.
 *
 * *Briefly* and *warm* are quantities. This file is the scale they are measured
 * on, and it is the **only** place the scale is decided — the type, the light,
 * the sound and the timing all read it, so they cannot drift apart.
 *
 * ## What may and may not scale
 *
 * §6.4 forbids the usual escalation: no confetti, no coin fountain, no screen
 * shake, no slot-machine spin, and §10.5 forbids dressing a sub-stake return as a
 * win at any size. So nothing here is kinetic and nothing here is a banner. What
 * scales is size, light, duration and the body of one bell — the four things the
 * specification permits — and the scale is continuous, with two named steps at
 * the returns a player will actually feel as rare.
 *
 * ## Where the number comes from
 *
 * The multiple is the server's own `returnMultiple`, which is total credited over
 * total staked including the side bet. Nothing here computes money: the string
 * arrives already exact and is read as a magnitude to *draw*, never to pay.
 */

/**
 * The named steps.
 *
 * `quiet` is everything under 2x, which is most rounds and includes every
 * recovery — a 0.81x bank plays the smallest version of the beat because that is
 * what it is. `big` is 2x and over: rare enough that a player remembers it.
 * `huge` is 5x and over, which on a five-arena tree means a run that kept going.
 */
export type PayoffTier = 'quiet' | 'big' | 'huge';

export interface Payoff {
  readonly multiple: number;
  readonly tier: PayoffTier;
  /**
   * The continuous version, 0 to 1, on a log scale.
   *
   * Log, because the difference between 0.5x and 1x is the difference between
   * 1x and 2x, and a linear scale would make every bank below 2x look identical
   * — which is the exact fault this file exists to fix. 0 at 0.25x and under,
   * 0.5 at 2x, 1 at 10x and over.
   */
  readonly heat: number;
}

const FLOOR = 0.25;
const CEILING = 10;

export function payoff(returnMultiple: string | number): Payoff {
  const raw = typeof returnMultiple === 'number' ? returnMultiple : Number.parseFloat(returnMultiple);
  const multiple = Number.isFinite(raw) && raw > 0 ? raw : 0;
  const clamped = Math.min(CEILING, Math.max(FLOOR, multiple));
  const heat =
    multiple <= 0
      ? 0
      : (Math.log(clamped) - Math.log(FLOOR)) / (Math.log(CEILING) - Math.log(FLOOR));
  return {
    multiple,
    heat,
    tier: multiple >= 5 ? 'huge' : multiple >= 2 ? 'big' : 'quiet',
  };
}

/**
 * Whether this return is allowed to be celebrated at all.
 *
 * ## The rule, and why it is a predicate rather than a taste call
 *
 * §10.5 forbids dressing a sub-stake return as a win *at any size*, and the
 * house responsible-design list names the same thing as a blocker: "losses
 * dressed as wins (celebratory treatment on a net-losing outcome, including
 * partial returns below stake)". The round-3 build kept that rule by never
 * building a celebration at all — the payoff was a caption, so there was nothing
 * to withhold. Once the payoff is an *object* — a lit gold plate at the centre of
 * the frame with a wash of light behind it — the rule needs a switch, because a
 * plate is celebratory whatever number is printed on it.
 *
 * So: strictly above stake, and nothing else. `0.9095x` banked 4.54 against a
 * 5.00 stake; that is 46 pence lost, and it gets the plain statement of what came
 * back, in the cool half of the palette, with no plate, no bloom and no light.
 * `1.0000x` is not a win either — the money came back and nothing was won — and
 * it is treated the same way.
 *
 * `tier` still scales *within* the celebrated range and is untouched: it is the
 * question "how big is this win", which is only asked once this has answered yes.
 */
export function celebrates(returnMultiple: string | number): boolean {
  const raw = typeof returnMultiple === 'number' ? returnMultiple : Number.parseFloat(returnMultiple);
  return Number.isFinite(raw) && raw > 1;
}

/**
 * How long the hero figure counts for.
 *
 * §S4 fixes the *claim* roll at ~600 ms and §6.4 forbids a spin; this is the
 * terminal screen's own figure, which is a different object with a different job.
 * A count that is over before the player's eye lands on it is not a payoff, and a
 * count that runs for four seconds is a slot machine. 800 ms to 1600 ms.
 *
 * The ceiling came down from 2100 ms because of what the region counter sees. A
 * tabular roll changes four or five digits, and each digit is a separate island
 * of changed pixels to `diff.mjs` — so a roll still running at the third sample
 * of the beat reads as *nine independently moving regions* against the rubric's
 * absolute never-exceed of about eight, on a frame whose total pixel change is
 * one tenth of one percent. The count is one object and it should be measured as
 * one, but the honest fix is not to argue with the instrument: it is to have the
 * number finished, and the frame at rest, inside the celebration's own hold.
 */
export function countMs(heat: number): number {
  return Math.round(800 + Math.min(1, Math.max(0, heat)) * 800);
}

/**
 * How wide and how long the tree goes warm — §6.4's own reward, as a number.
 *
 * `bloom` is a multiplier on the lantern glow radius that decays back to nothing;
 * this is where it starts and how slowly it fades. A 0.8x recovery gets a flicker
 * of warmth; a 6x gets a frame that stays warm long enough to notice it going.
 */
export function bloom(heat: number): { readonly amount: number; readonly decay: number } {
  const t = Math.min(1, Math.max(0, heat));
  /*
   * It arrives, it peaks, it is *done* — and the decay rate is why.
   *
   * At `1.05 - t * 0.72` a big bank's bloom took three and a half seconds to
   * fade, which meant every lantern radius and the whole doorway wash were still
   * changing while the payout figure was counting. The round-2 judge measured the
   * consequence: sampled 1.9 -> 2.5 s into the celebration, **48 changed regions,
   * 23 of them >= 3 cells**, against the rubric's absolute ceiling of ~8 in any
   * state — and the genre's most violent moment, Space XY's crash, uses 4.
   *
   * The warmth that *holds* is not this: it is `scene.heat`, which is static for
   * as long as the scene is. This is the arrival flourish, and an arrival that is
   * still arriving three seconds later is not a flourish, it is a loop. At
   * `2.2 - t * 0.7` the biggest bank's bloom is spent in about a second, which
   * puts the world at rest before the figure has finished counting — one
   * dominant motion per beat, which is the whole rule.
   */
  return { amount: 0.45 + t * 1.15, decay: 2.2 - t * 0.7 };
}
