/**
 * `Save the clip` (`DESIGN.md` §9), under §10.7's terms.
 *
 * §9 makes this a build requirement rather than a nice-to-have: *"After any round
 * containing a Last Lamp beat, S7 offers `Save the clip`"*, and *"the clip is the
 * moment; the verification code is the proof that it really happened that way"*.
 * §10.7 then names what the artefact actually is — a produced, watermarked video
 * of a gambling product that the player is invited to post, which is advertising
 * material the moment it leaves the device — and sets the terms this module is
 * built to:
 *
 * - **No money in the clip, at all.** *"It never carries a stake, a claim, a
 *   multiplier, a balance or a result figure."* That is structural here rather
 *   than careful: the recording is a capture of the *stage canvas*, and the stage
 *   draws no numerals of any kind. The claim, the hero figure and the session
 *   strip are DOM over the canvas and cannot reach the recording.
 * - **It carries an age mark and a safer-gambling reference**, plus the round id,
 *   the verification code and the game name, drawn into the frames by the stage
 *   while the recorder is running.
 * - **Both endings export**, won or lost, and the losing one is not degraded,
 *   delayed or hidden.
 * - **No incentive**: saving a clip credits nothing, unlocks nothing and is not
 *   acknowledged anywhere in the game.
 * - **Off by default, one tap to disable permanently, never re-prompted.** The
 *   preference lives on this device (`localStorage`) rather than in the session,
 *   because the session is server state and this build's server is frozen; the
 *   settings copy says so rather than implying an account-level setting.
 *
 * What this module deliberately does not do is decide whether the feature may be
 * *enabled* in a jurisdiction. §10.7 puts that behind the operator's advertising
 * compliance process per market, and §12 puts the review itself outside this
 * repository — so the control here is the player's opt-in, sitting under an
 * operator switch that a real deployment would own.
 */

/** Six seconds, per §9. Long enough to be the beat, short enough to be a clip. */
export const CLIP_MS = 6000;

const KEY = 'branchfall.clip';

interface Clip {
  readonly blob: Blob;
  readonly roundId: string;
  readonly code: string;
}

let held: Clip | null = null;
let recorder: MediaRecorder | null = null;
let listener: (() => void) | null = null;

/**
 * Called when a recording finishes, so the screen can offer what it now has.
 *
 * The beat is six seconds and a player can be on the round summary before it
 * ends. Without this the offer simply never appeared on the round it belongs to,
 * which is the same defect as hiding it.
 */
export function onReady(next: () => void): void {
  listener = next;
}

/** Whether this browser can produce a clip at all. Absent, nothing is offered. */
export function supported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    MediaRecorder.isTypeSupported('video/webm')
  );
}

/** The player's own switch: off until they turn it on, off again forever on a tap. */
export function optedIn(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function setOptedIn(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* A device that refuses storage simply never opts in. */
  }
  if (!on) discard();
}

/** True once the player has answered either way, so nothing re-prompts (§10.7). */
export function asked(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return true;
  }
}

/**
 * Records the beat as it plays, from the canvas the player is watching.
 *
 * Not a replay: a replay would be a second implementation of the moment, and the
 * one thing a clip has to be is the thing that happened. Anything already in
 * flight is dropped — a round has one Last Lamp beat in it at a time.
 */
export function record(canvas: HTMLCanvasElement, roundId: string, code: string): void {
  if (!supported() || !optedIn()) return;
  stop();
  try {
    const stream = canvas.captureStream(30);
    const local = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    local.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    local.onstop = () => {
      held = chunks.length === 0 ? null : { blob: new Blob(chunks, { type: 'video/webm' }), roundId, code };
      recorder = null;
      listener?.();
    };
    recorder = local;
    local.start();
    window.setTimeout(stop, CLIP_MS);
  } catch {
    recorder = null;
  }
}

export function stop(): void {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  else recorder = null;
}

/** Whether a recording is in flight, so a screen can say "not yet" honestly. */
export function recording(): boolean {
  return recorder !== null;
}

/** Whether a clip is waiting to be offered on S7. */
export function ready(): Clip | null {
  return held;
}

export function discard(): void {
  held = null;
}

/**
 * Hands the file to the player, and to nobody else.
 *
 * A local object URL and a download: nothing is uploaded, no service sees the
 * clip, and the game does not learn that it was saved (§10.7's no-incentive rule
 * has no telemetry hook behind it either).
 */
export function save(): void {
  const clip = held;
  if (!clip) return;
  const url = URL.createObjectURL(clip.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `branchfall-${clip.roundId.slice(0, 8)}-${clip.code}.webm`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
