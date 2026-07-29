/**
 * The server clock.
 *
 * The speed-of-play floor is enforced against *this* clock and nothing else
 * (`docs/ENGINE.md` §6.2: enforced server-side, so a modified client cannot beat
 * it and a slow network cannot be punished by it).
 *
 * `advance()` exists so a test can prove the floor rather than disable it: the
 * playthrough drives a command early, asserts `TOO_SOON`, moves the clock, and
 * drives it again. It is refused unless the process was started with
 * `--dev-clock`, and the flag prints a banner at boot, because a build that can
 * be told to skip its own game cycle silently is worse than one that cannot skip
 * it at all.
 */
export class Clock {
  #offsetMs = 0;

  constructor(readonly advanceable: boolean) {}

  now(): number {
    return Date.now() + this.#offsetMs;
  }

  advance(ms: number): number {
    if (!this.advanceable)
      throw new Error('The clock is not advanceable: start the server with --dev-clock');
    if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('Advance must be a non-negative integer');
    this.#offsetMs += ms;
    return this.now();
  }

  get offsetMs(): number {
    return this.#offsetMs;
  }
}
