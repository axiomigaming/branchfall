/**
 * One clock, two curves, and a single place that decides whether the calm variant
 * is playing.
 *
 * `docs/DESIGN.md` §6.4 is unusually specific about motion, and two of its rules
 * are the reason this module exists rather than a scatter of `setTimeout` calls:
 *
 * - **"Nothing bounces, nothing overshoots. 240 ms cubic-out on everything."**
 *   So there is no elastic curve and no spring in here to reach for, and there are
 *   only two curves: `outCubic` for everything, and `outQuint` for money counting,
 *   which decelerates harder so the last digits settle rather than arrive. A fall
 *   is not on this list — §6.4 gives gravity a number, so the stage integrates it
 *   rather than easing it.
 * - **The 12 Hz secondary clock is quantised in time, not in frames** (§6.8:
 *   *"a 1/12 s phase clock … identical on every device class"*). `stepped()` is
 *   that clock, and it is a pure function of seconds so a 30 fps device and a
 *   60 fps device land on the same phase.
 *
 * Everything animated in this client runs on the one `requestAnimationFrame`
 * loop below. That is a performance decision with a correctness benefit: a
 * client that starts a loop per widget cannot be reasoned about when a screen
 * re-renders mid-animation, and this one stops dead when nothing is subscribed
 * and when the tab is hidden.
 */

/** §5.2.2: the fallen pips go dark first, held with the claim unchanged. */
export const CAUSE_HOLD = 350;

/** §S4: the claim rolls in about 600 ms, tabular, never spinning. */
export const CLAIM_ROLL = 600;

/** §6.4: secondary motion is stepped to 12 fps, defined in time. */
export const STEP_HZ = 12;

export const outCubic = (t: number): number => 1 - (1 - t) ** 3;
export const outQuint = (t: number): number => 1 - (1 - t) ** 5;

/**
 * The calm variant.
 *
 * Two inputs, either of which turns it on: the OS setting, and the in-game
 * toggle in S9 (which is server-owned session state, so it survives a reload).
 * §10.8 asks for *full parity* with reduced motion, not a degraded mode — so
 * nothing reads this flag to skip a beat, only to play the beat as a state
 * change with a held frame instead of a traversal.
 */
const query =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

let calmPreference = false;
const calmListeners = new Set<() => void>();

export function setCalmPreference(value: boolean): void {
  if (calmPreference === value) return;
  calmPreference = value;
  for (const listener of calmListeners) listener();
}

export function calm(): boolean {
  return calmPreference || (query?.matches ?? false);
}

export function onCalmChange(listener: () => void): void {
  calmListeners.add(listener);
  query?.addEventListener?.('change', listener);
}

/* --------------------------------------------------------------- the clock */

type Frame = (nowMs: number) => void;

const subscribers = new Set<Frame>();
/**
 * Every animation in flight, and how to land it.
 *
 * A hidden tab does not run `requestAnimationFrame`. Without this set, an
 * animation that was mid-flight when the player switched away simply stopped, and
 * the value it was carrying stayed where it was — which for the §S4 claim roll
 * meant coming back to a claim figure showing the value the arena went *in* with
 * while the arithmetic under it stated the value it came out with. A frame-dump
 * pass over the resolve beat is how that was found, and it is a real defect
 * rather than a harness artefact: §2.1 promises that *"closing the app mid-round
 * is safe and resuming restores the exact frame"*, and a stale money figure is not
 * the exact frame.
 *
 * So going hidden lands every animation on its end state. Nothing is skipped —
 * the end state is the same one the traversal was heading for, which is the same
 * reasoning the calm variant runs on.
 */
const landings = new Set<() => void>();
let handle = 0;
let hidden = false;

function pump(now: number): void {
  handle = 0;
  // A copy, because a subscriber may unsubscribe itself from inside its frame —
  // which is exactly what a finished tween does.
  for (const frame of [...subscribers]) frame(now);
  if (subscribers.size > 0 && !hidden) handle = requestAnimationFrame(pump);
}

function wake(): void {
  if (handle === 0 && subscribers.size > 0 && !hidden) handle = requestAnimationFrame(pump);
}

if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (hidden) {
      if (handle !== 0) cancelAnimationFrame(handle);
      handle = 0;
      for (const land of [...landings]) land();
    } else wake();
  });

/** Subscribes to the shared frame loop. Returns the unsubscribe. */
export function onFrame(frame: Frame): () => void {
  subscribers.add(frame);
  wake();
  return () => {
    subscribers.delete(frame);
  };
}

/**
 * One value, from here to there, on the shared clock.
 *
 * Under the calm variant the traversal is skipped and the end state is applied
 * once — which is the *same* end state, so nothing about what the player can
 * read changes. Returns a cancel, and cancelling never leaves a half-applied
 * value: it snaps to the end, because a cancelled animation in this client
 * always means "the screen moved on", and the screen moved on to the end state.
 */
function tween(options: {
  readonly ms: number;
  readonly ease?: (t: number) => number;
  readonly onFrame: (value: number) => void;
  readonly onDone?: () => void;
  readonly delay?: number;
}): () => void {
  const ease = options.ease ?? outCubic;
  const delay = options.delay ?? 0;

  // Nothing to traverse: the calm variant, a zero-length beat, or a tab that is
  // already hidden and therefore has no frames to traverse it with.
  if (calm() || hidden || options.ms <= 0) {
    options.onFrame(1);
    options.onDone?.();
    return () => {};
  }

  let started = 0;
  let stop = () => {};
  let landed = false;

  /** The end state, applied exactly once, however the animation ends. */
  const land = () => {
    if (landed) return;
    landed = true;
    landings.delete(land);
    stop();
    options.onFrame(1);
    options.onDone?.();
  };

  stop = onFrame((now) => {
    if (started === 0) started = now;
    const elapsed = now - started - delay;
    if (elapsed < 0) return;
    const t = Math.min(1, elapsed / options.ms);
    if (t >= 1) {
      land();
      return;
    }
    options.onFrame(ease(t));
  });
  landings.add(land);
  return land;
}

/**
 * A sequence of beats, on wall-clock time, cancellable as one thing.
 *
 * The staged resolve is written as a list of `(atMs, do)` pairs rather than as
 * nested timeouts, because the whole sequence has to be abandonable the instant
 * the player leaves the screen — and because a list can be read as a timeline.
 * Under the calm variant every step still runs, in order, immediately: the
 * player who cannot have the traversal still gets the whole state machine.
 */
export function sequence(steps: readonly { readonly at: number; readonly run: () => void }[]): () => void {
  if (calm()) {
    for (const step of [...steps].sort((a, b) => a.at - b.at)) step.run();
    return () => {};
  }
  const timers = steps.map((step) => window.setTimeout(step.run, step.at));
  return () => {
    for (const timer of timers) window.clearTimeout(timer);
  };
}

/**
 * The 12 Hz secondary clock (§6.4).
 *
 * Quantised in *time*: at 60 Hz it lands on every fifth frame, at 30 Hz on a
 * 2-3-2-3 pattern, and the phase is the same number on both. Nothing here scales
 * with frame rate, which is the property that makes the stepped animation read
 * as a choice on a slow device instead of as a dropped frame.
 */
export function stepped(seconds: number): number {
  return Math.floor(seconds * STEP_HZ) / STEP_HZ;
}

/**
 * A money figure counting to its new value (§S4: tabular, ~600 ms, no spinning).
 *
 * The element's text is replaced with formatted intermediate values, so the
 * caller owns the format and the figure never reflows: `format` is expected to
 * produce a fixed number of digits, and `.money` supplies tabular numerals.
 * The final frame writes the *exact* target string rather than a formatted
 * interpolation, so the number the player is left looking at is the number the
 * server sent and not a rounding of it.
 */
export function countUp(
  node: HTMLElement,
  from: number,
  to: number,
  target: string,
  format: (value: number) => string,
  ms = CLAIM_ROLL,
): () => void {
  if (from === to || calm()) {
    node.textContent = target;
    return () => {};
  }
  return tween({
    ms,
    ease: outQuint,
    onFrame: (t) => {
      node.textContent = t >= 1 ? target : format(from + (to - from) * t);
    },
  });
}

/** Deterministic value noise, for scenery that must look authored, not random. */
export function hash01(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
