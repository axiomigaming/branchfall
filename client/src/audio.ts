/**
 * The sound layer, synthesised in the browser.
 *
 * Every sound in this file is made out of oscillators and one shared buffer of
 * white noise. Nothing is downloaded, nothing is sampled from a recording, and
 * there is no audio asset in this repository — which is both the constraint this
 * wave was given and the only way a graybox can carry `docs/DESIGN.md` §7 without
 * a sound contract behind it.
 *
 * §7 is a list of decisions, not a mood, and the ones that shape this file are:
 *
 * - **"Sound carries state. A blindfolded player should know how many Kindlings
 *   are alive."** So the squad rhythm is not a loop: it is one scheduled voice
 *   per living runner, each at its own pitch and phase, and it thins because
 *   there are fewer of them. Nothing crossfades a "3 runners" stem.
 * - **"The sub gets 2 dB louder every arena. Nobody notices; everybody feels
 *   it."** `arena()` sets that, in decibels, once per arena.
 * - **"Silence is the loudest thing in the game and we spend it exactly once per
 *   losing round."** `lastLanternOut()` removes every warm layer at once and
 *   holds wind alone at -18 dB for 1.8 s. Nothing else in this file is allowed
 *   to make a sound during it.
 * - **"Never: crowd cheering, hype VO, rising-pitch riser under a decision,
 *   coin-cascade, big-win fanfare over a sub-stake return."** There is no
 *   function here that could be one. The largest sound in the game is a struck
 *   bell with a 0.9 s decay, and it gets quieter as the chord thickens rather
 *   than louder.
 * - **"Full parity with audio off."** Nothing here is ever the only carrier of a
 *   state. Every call site draws the same state on the screen first.
 *
 * §5.1 adds one prohibition that belongs here: the speed-of-play hairline has
 * **no ticking sound**, so there is no tick in this file to call.
 */

type Bus = 'bed' | 'world' | 'ui' | 'music';

interface Graph {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  /** The 120 ms high-shelf cut a dying lantern takes out of the whole mix. */
  readonly shelf: BiquadFilterNode;
  readonly bed: GainNode;
  readonly world: GainNode;
  readonly ui: GainNode;
  readonly music: GainNode;
  readonly noise: AudioBuffer;
  /** The bed's own pieces, because the endings reach in and turn them off. */
  readonly windGain: GainNode;
  readonly subGain: GainNode;
}

const BUS_LEVEL: Readonly<Record<Bus, number>> = {
  bed: 0.5,
  world: 0.62,
  ui: 0.34,
  music: 0.2,
};

let graph: Graph | null = null;
let enabled = false;
let unlocked = false;
let arenaIndex = 1;
let musicVoices = 0;
let hushUntil = 0;

/* ------------------------------------------------------------------ helpers */

function db(value: number): number {
  return 10 ** (value / 20);
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministic, so a device that renders the fog differently still gets the
  // same wind. A seeded LCG is also audibly no worse than `Math.random`.
  let seed = 0x9e3779b9;
  for (let index = 0; index < data.length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[index] = (seed / 0x7fffffff - 1) * 0.7;
  }
  return buffer;
}

function build(): Graph | null {
  if (graph) return graph;
  const Ctor: typeof AudioContext | undefined =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;

  const ctx = new Ctor();
  const master = ctx.createGain();
  master.gain.value = 0.9;

  // A gentle limiter, not a loudness war: the whole point of §7's mix is that a
  // lantern going out is felt as a *loss* of level, which needs headroom to be
  // audible at all.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 12;
  limiter.ratio.value = 4;
  limiter.attack.value = 0.006;
  limiter.release.value = 0.18;

  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 2600;
  shelf.gain.value = 0;

  master.connect(shelf);
  shelf.connect(limiter);
  limiter.connect(ctx.destination);

  const bus = (level: number) => {
    const node = ctx.createGain();
    node.gain.value = level;
    node.connect(master);
    return node;
  };

  const built: Graph = {
    ctx,
    master,
    shelf,
    bed: bus(BUS_LEVEL.bed),
    world: bus(BUS_LEVEL.world),
    ui: bus(BUS_LEVEL.ui),
    music: bus(BUS_LEVEL.music),
    noise: makeNoise(ctx),
    windGain: ctx.createGain(),
    subGain: ctx.createGain(),
  };
  graph = built;
  startBed(built);
  return built;
}

/** The graph, or null when sound is off, unavailable, or not yet unlocked. */
function live(): Graph | null {
  if (!enabled || !unlocked) return null;
  const built = build();
  if (!built) return null;
  if (built.ctx.state === 'suspended') void built.ctx.resume();
  return built;
}

/** The graph during a hush: only the ending itself may speak (§7). */
function speaking(): Graph | null {
  const built = live();
  if (!built) return null;
  return built.ctx.currentTime < hushUntil ? null : built;
}

function noiseSource(g: Graph, loop: boolean): AudioBufferSourceNode {
  const source = g.ctx.createBufferSource();
  source.buffer = g.noise;
  source.loop = loop;
  return source;
}

/** A one-shot with an exponential tail. WebAudio cannot ramp to zero, so 1e-4. */
function envelope(
  g: Graph,
  peak: number,
  at: number,
  attack: number,
  decay: number,
): GainNode {
  const gain = g.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return gain;
}

/* ------------------------------------------------------------------ the bed */

/**
 * Wind through hollow wood, a 38 Hz sub for the void, and distant stone creak.
 *
 * The hollow formant §7 asks for — *"recorded through a cardboard tube"* — is a
 * resonant bandpass around 430 Hz with a second, wider one an octave down. Two
 * slow LFOs move the filter and the level so it never loops audibly; both are
 * far below the rate at which anything could read as urgency, which §7's ban on
 * tempo-driven pressure makes a requirement rather than taste.
 */
function startBed(g: Graph): void {
  const now = g.ctx.currentTime;

  const air = noiseSource(g, true);
  const formant = g.ctx.createBiquadFilter();
  formant.type = 'bandpass';
  formant.frequency.value = 430;
  formant.Q.value = 1.15;
  const body = g.ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 620;
  body.Q.value = 0.7;

  g.windGain.gain.value = 0.5;
  air.connect(formant);
  formant.connect(body);
  body.connect(g.windGain);
  g.windGain.connect(g.bed);
  air.start(now);

  const sweep = g.ctx.createOscillator();
  sweep.frequency.value = 0.063;
  const sweepDepth = g.ctx.createGain();
  sweepDepth.gain.value = 150;
  sweep.connect(sweepDepth);
  sweepDepth.connect(formant.frequency);
  sweep.start(now);

  const breathe = g.ctx.createOscillator();
  breathe.frequency.value = 0.104;
  const breatheDepth = g.ctx.createGain();
  breatheDepth.gain.value = 0.22;
  breathe.connect(breatheDepth);
  breatheDepth.connect(g.windGain.gain);
  breathe.start(now);

  // The void below. 38 Hz, and the only thing in the game that grows.
  const sub = g.ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 38;
  g.subGain.gain.value = db(-6);
  sub.connect(g.subGain);
  g.subGain.connect(g.bed);
  sub.start(now);

  creakLoop(g);
}

/** Distant stone creak: rare, dry, and never on a beat. */
function creakLoop(g: Graph): void {
  const schedule = () => {
    if (graph !== g) return;
    const wait = 7000 + Math.random() * 11000;
    window.setTimeout(() => {
      if (graph === g && enabled && g.ctx.currentTime >= hushUntil) creak(g);
      schedule();
    }, wait);
  };
  schedule();
}

function creak(g: Graph): void {
  const at = g.ctx.currentTime;
  const source = noiseSource(g, false);
  const band = g.ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(190, at);
  band.frequency.linearRampToValueAtTime(120, at + 1.4);
  band.Q.value = 9;
  const gain = envelope(g, 0.16, at, 0.35, 1.1);
  source.connect(band);
  band.connect(gain);
  gain.connect(g.bed);
  source.start(at);
  source.stop(at + 1.6);
}

/* ------------------------------------------------------------------- public */

export function setEnabled(value: boolean): void {
  enabled = value;
  if (!value && graph) {
    graph.master.gain.cancelScheduledValues(graph.ctx.currentTime);
    graph.master.gain.setTargetAtTime(0, graph.ctx.currentTime, 0.04);
    void graph.ctx.suspend();
  } else if (value && graph) {
    void graph.ctx.resume();
    graph.master.gain.cancelScheduledValues(graph.ctx.currentTime);
    graph.master.gain.setTargetAtTime(0.9, graph.ctx.currentTime, 0.05);
  }
}

export function isEnabled(): boolean {
  return enabled;
}

/**
 * The autoplay rule, honoured rather than worked around.
 *
 * A browser will not start an `AudioContext` outside a user gesture, and the
 * correct response to that is not a retry loop: it is to build the graph on the
 * first tap the player makes anywhere. Until then `live()` returns null and every
 * call in this file is a no-op, which is the same code path as sound being off.
 */
export function unlock(): void {
  if (unlocked) return;
  unlocked = true;
  if (enabled) build();
}

/** §7: the sub gains 2 dB per arena, and the music gains a voice per arena. */
export function arena(index: number, voices = index - 1): void {
  arenaIndex = Math.max(1, index);
  musicVoices = Math.max(0, Math.min(4, voices));
  const g = live();
  if (!g) return;
  g.subGain.gain.setTargetAtTime(db(-6 + 2 * (arenaIndex - 1)), g.ctx.currentTime, 0.6);
}

/* ------------------------------------------------------- the squad's rhythm */

interface Voice {
  /** Distinct per runner: five figures, five pitches, five phases. */
  readonly pitch: number;
  readonly phase: number;
  readonly pan: number;
  /** The thin limb loses its low end, as if heard across a gap (§7). */
  readonly distant: boolean;
}

let rhythm: { stop: () => void } | null = null;

/**
 * The squad rhythm (§7's *"core idea"*).
 *
 * One scheduled voice per living runner: a reed-creak footfall, a cloth rustle
 * and a glass *tink*, at its own pitch and its own phase. Five make a busy, warm,
 * slightly ragged rhythm; one is a single footstep in a large empty space. The
 * thinning is arithmetic, not a mix decision, which is what makes it honest —
 * there is no "3 runners" layer to get out of step with the transcript.
 */
export function startSquadRhythm(runners: readonly { readonly lane: number; readonly slot: number }[], lanes: number): void {
  stopSquadRhythm();
  const g = live();
  if (!g || runners.length === 0) return;

  const voices: Voice[] = runners.map((runner, index) => {
    const thin = lanes > 1 && runner.lane > 0;
    return {
      // A fifth of the way apart, so five reeds are a chord and not a unison.
      pitch: 360 + ((runner.slot * 47) % 240),
      phase: (index / runners.length) * 0.86 + ((runner.slot * 0.037) % 0.09),
      pan: thin ? 0.85 : (index / Math.max(1, runners.length - 1) - 0.5) * 0.3,
      distant: thin,
    };
  });

  const period = 0.36;
  let step = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    const now = g.ctx.currentTime;
    if (now >= hushUntil)
      for (const voice of voices) {
        const at = now + 0.05 + ((voice.phase + step) % 1) * period;
        footfall(g, voice, at);
        if ((step + Math.round(voice.phase * 4)) % 2 === 0) tink(g, voice, at + 0.03);
      }
    step += 1;
  };

  tick();
  const timer = window.setInterval(tick, period * 1000);
  rhythm = {
    stop: () => {
      stopped = true;
      window.clearInterval(timer);
    },
  };
}

export function stopSquadRhythm(): void {
  rhythm?.stop();
  rhythm = null;
}

function footfall(g: Graph, voice: Voice, at: number): void {
  const source = noiseSource(g, false);
  const reed = g.ctx.createBiquadFilter();
  reed.type = 'bandpass';
  reed.frequency.value = voice.pitch;
  reed.Q.value = 7;
  const gain = envelope(g, voice.distant ? 0.09 : 0.15, at, 0.004, 0.075);
  const pan = g.ctx.createStereoPanner();
  pan.pan.value = voice.pan;

  source.connect(reed);
  reed.connect(gain);
  if (voice.distant) {
    const gap = g.ctx.createBiquadFilter();
    gap.type = 'highpass';
    gap.frequency.value = 520;
    gain.connect(gap);
    gap.connect(pan);
  } else gain.connect(pan);
  pan.connect(g.world);
  source.start(at);
  source.stop(at + 0.14);

  // Cloth, under the reed, barely there.
  const cloth = noiseSource(g, false);
  const air = g.ctx.createBiquadFilter();
  air.type = 'highpass';
  air.frequency.value = 2400;
  const clothGain = envelope(g, 0.035, at + 0.012, 0.006, 0.05);
  cloth.connect(air);
  air.connect(clothGain);
  clothGain.connect(pan);
  cloth.start(at + 0.012);
  cloth.stop(at + 0.09);
}

/** The lantern's glass, one small inharmonic ring per step. */
function tink(g: Graph, voice: Voice, at: number): void {
  const pan = g.ctx.createStereoPanner();
  pan.pan.value = voice.pan;
  pan.connect(g.world);
  for (const [ratio, level, decay] of [
    [1, 0.05, 0.16],
    [2.74, 0.026, 0.1],
  ] as const) {
    const osc = g.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = voice.pitch * 4.1 * ratio;
    const gain = envelope(g, voice.distant ? level * 0.55 : level, at, 0.002, decay);
    osc.connect(gain);
    gain.connect(pan);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

/* --------------------------------------------------------------- the events */

/**
 * A lane collapsing (§7: *"Not an explosion. A long, dry, splintering crack with
 * a 1.2 s tail, then a hole in the mix."*).
 *
 * The splinter is a burst of short band-limited clicks rather than one transient,
 * because a single click is a snap and a scatter of them is wood giving up. There
 * is deliberately no low-frequency thump in it.
 */
export function laneCollapse(): void {
  const g = speaking();
  if (!g) return;
  const at = g.ctx.currentTime;

  for (let index = 0; index < 16; index += 1) {
    const offset = (index / 16) ** 1.6 * 0.24;
    const source = noiseSource(g, false);
    const band = g.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 800 + ((index * 397) % 1900);
    band.Q.value = 5;
    const gain = envelope(g, 0.2 * (1 - index / 20), at + offset, 0.002, 0.03);
    source.connect(band);
    band.connect(gain);
    gain.connect(g.world);
    source.start(at + offset);
    source.stop(at + offset + 0.08);
  }

  const tail = noiseSource(g, false);
  const low = g.ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.setValueAtTime(700, at);
  low.frequency.exponentialRampToValueAtTime(140, at + 1.2);
  const tailGain = envelope(g, 0.13, at + 0.04, 0.05, 1.15);
  tail.connect(low);
  low.connect(tailGain);
  tailGain.connect(g.world);
  tail.start(at);
  tail.stop(at + 1.4);
}

/**
 * A lantern going out (§7).
 *
 * A small glass pop, plus a 120 ms high-shelf cut across the entire mix — as if
 * the world briefly lost a frequency band. It is uncomfortable by design and it
 * is over fast, and the *cut* is the part that carries the meaning: the level of
 * the game drops when a light does.
 */
export function lanternOut(): void {
  const g = speaking();
  if (!g) return;
  const at = g.ctx.currentTime;

  const pop = g.ctx.createOscillator();
  pop.type = 'sine';
  pop.frequency.setValueAtTime(2350, at);
  pop.frequency.exponentialRampToValueAtTime(760, at + 0.09);
  const popGain = envelope(g, 0.14, at, 0.002, 0.1);
  pop.connect(popGain);
  popGain.connect(g.world);
  pop.start(at);
  pop.stop(at + 0.14);

  const shard = noiseSource(g, false);
  const band = g.ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 3400;
  band.Q.value = 3;
  const shardGain = envelope(g, 0.08, at, 0.001, 0.04);
  shard.connect(band);
  band.connect(shardGain);
  shardGain.connect(g.world);
  shard.start(at);
  shard.stop(at + 0.07);

  const shelf = g.shelf.gain;
  shelf.cancelScheduledValues(at);
  shelf.setValueAtTime(0, at);
  shelf.linearRampToValueAtTime(-16, at + 0.015);
  shelf.setValueAtTime(-16, at + 0.085);
  shelf.linearRampToValueAtTime(0, at + 0.12);
}

/**
 * The last lantern going out (§7), and the only silence in the game.
 *
 * *"Every warm layer is removed at once. Wind at -18 dB, alone, for 1.8 seconds.
 * No sting, no music, no UI sound."* `hushUntil` enforces the last clause: for
 * the length of the hold, every other function in this file returns without
 * making a sound, including the UI taps the player can still trigger.
 */
export function lastLanternOut(): void {
  const g = live();
  if (!g) return;
  const at = g.ctx.currentTime;
  lanternOut();
  hushUntil = at + 0.16 + 1.8;

  stopSquadRhythm();
  stopMusic();
  g.world.gain.cancelScheduledValues(at);
  g.world.gain.setTargetAtTime(0, at + 0.16, 0.05);
  g.subGain.gain.setTargetAtTime(0.0001, at + 0.16, 0.12);
  g.windGain.gain.cancelScheduledValues(at);
  g.windGain.gain.setTargetAtTime(db(-18), at + 0.16, 0.1);

  // And back, slowly, to the cool key on grey fog. Nothing announces the return.
  g.windGain.gain.setTargetAtTime(0.5, hushUntil, 0.9);
  g.world.gain.setTargetAtTime(BUS_LEVEL.world, hushUntil, 0.6);
  g.subGain.gain.setTargetAtTime(db(-6 + 2 * (arenaIndex - 1)), hushUntil + 0.4, 0.8);
}

/**
 * Banking (§7): *"Brass door mechanism, one struck bell with a 0.9 s decay — a
 * bell, not a jackpot chime. Each previously saved lantern adds a tone; the Lamp
 * House chord thickens as the run goes on."*
 *
 * The chord thickens and the *level does not*: each added tone is quieter than
 * the one before it, so four lanterns are richer than one and not louder. That is
 * the line between a bell and a fanfare, and §10.5 makes it a requirement rather
 * than a preference — this sound plays over a 0.76x return as readily as over a
 * good one.
 */
export function bank(lanterns: number): void {
  const g = speaking();
  if (!g) return;
  const at = g.ctx.currentTime;
  door(g, at);

  // A minor-pentatonic stack on A2: adding a lantern adds a tone above, never a
  // transposition of the whole chord upward (§7: never modulates upward).
  const chord = [110, 164.81, 220, 277.18, 329.63];
  const voices = Math.max(1, Math.min(chord.length, lanterns));
  for (let index = 0; index < voices; index += 1) {
    const base = chord[index] as number;
    const level = 0.2 / (index + 1.4);
    // A struck bell is inharmonic. These ratios are a tubular-bell approximation.
    for (const [ratio, share, decay] of [
      [1, 1, 0.9],
      [2.0, 0.5, 0.7],
      [2.97, 0.3, 0.5],
      [4.16, 0.16, 0.34],
    ] as const) {
      const osc = g.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * ratio;
      const gain = envelope(g, level * share, at + 0.06 + index * 0.045, 0.004, decay);
      osc.connect(gain);
      gain.connect(g.world);
      osc.start(at + 0.06 + index * 0.045);
      osc.stop(at + 0.06 + index * 0.045 + decay + 0.1);
    }
  }
}

function door(g: Graph, at: number): void {
  const mech = noiseSource(g, false);
  const band = g.ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 300;
  band.Q.value = 2.2;
  const gain = envelope(g, 0.2, at, 0.008, 0.22);
  mech.connect(band);
  band.connect(gain);
  gain.connect(g.world);
  mech.start(at);
  mech.stop(at + 0.3);

  const clack = g.ctx.createOscillator();
  clack.type = 'triangle';
  clack.frequency.value = 178;
  const clackGain = envelope(g, 0.11, at + 0.02, 0.002, 0.13);
  clack.connect(clackGain);
  clackGain.connect(g.world);
  clack.start(at + 0.02);
  clack.stop(at + 0.2);
}

/**
 * The Last Lamp's hush (§9: *"The music drops out entirely."*).
 *
 * Not a hush like the one above — nothing is lost here, and it comes back. The
 * music leaves, the bed drops, and the single set of footfalls is left as the
 * most exposed sound in the game.
 */
export function duckForLastLamp(on: boolean): void {
  const g = live();
  if (!g) return;
  const at = g.ctx.currentTime;
  stopMusic();
  g.bed.gain.setTargetAtTime(on ? BUS_LEVEL.bed * db(-9) : BUS_LEVEL.bed, at, 0.45);
  g.world.gain.setTargetAtTime(on ? BUS_LEVEL.world * 1.15 : BUS_LEVEL.world, at, 0.45);
}

/** The frame going warm again — a Lamp House door or the Crown Lamp, resolving. */
export function warmth(): void {
  const g = speaking();
  if (!g) return;
  const at = g.ctx.currentTime;
  for (const [freq, level, decay] of [
    [220, 0.1, 1.5],
    [329.63, 0.06, 1.2],
    [440, 0.04, 1.0],
  ] as const) {
    const osc = g.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = envelope(g, level, at, 0.25, decay);
    osc.connect(gain);
    gain.connect(g.world);
    osc.start(at);
    osc.stop(at + decay + 0.4);
  }
}

/* ------------------------------------------------------------------- the UI */

type Tap = 'select' | 'commit' | 'stamp' | 'back' | 'toggle' | 'refuse';

const TAP: Readonly<Record<Tap, { readonly freq: number; readonly decay: number; readonly level: number }>> = {
  select: { freq: 520, decay: 0.06, level: 0.16 },
  commit: { freq: 300, decay: 0.1, level: 0.2 },
  stamp: { freq: 128, decay: 0.14, level: 0.26 },
  back: { freq: 240, decay: 0.07, level: 0.12 },
  toggle: { freq: 660, decay: 0.05, level: 0.13 },
  refuse: { freq: 150, decay: 0.09, level: 0.14 },
};

/**
 * Instant feedback on every tap, in the register the rest of the game is in:
 * struck wood, not a bubble. Percussive, dry, and short enough that a fast
 * sequence of taps does not build into a texture.
 */
export function tap(kind: Tap = 'select'): void {
  const g = speaking();
  if (!g) return;
  const spec = TAP[kind];
  const at = g.ctx.currentTime;

  const osc = g.ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(spec.freq, at);
  osc.frequency.exponentialRampToValueAtTime(spec.freq * 0.72, at + spec.decay);
  const gain = envelope(g, spec.level, at, 0.002, spec.decay);
  osc.connect(gain);
  gain.connect(g.ui);
  osc.start(at);
  osc.stop(at + spec.decay + 0.05);

  const knock = noiseSource(g, false);
  const band = g.ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = kind === 'stamp' ? 420 : 1500;
  band.Q.value = 1.4;
  const knockGain = envelope(g, spec.level * 0.5, at, 0.001, kind === 'stamp' ? 0.09 : 0.025);
  knock.connect(band);
  band.connect(knockGain);
  knockGain.connect(g.ui);
  knock.start(at);
  knock.stop(at + 0.14);
}

/* -------------------------------------------------------------- the music */

let musicTimer = 0;

/**
 * Music (§7): sparse, 68 BPM, prepared strings and plucked metal, one voice per
 * arena survived. **It never accelerates and never modulates upward** — so the
 * tempo is a constant in this file and the pitch set is fixed, and a voice being
 * "added" means another line of the same material, never a key change.
 *
 * *"Tempo-driven urgency pressures decisions, and we do not pressure
 * decisions."* This is the only music in the game and it plays on the decision
 * screen, which is exactly why it is built so it cannot lean on the player.
 */
export function startMusic(): void {
  stopMusic();
  const g = live();
  if (!g || musicVoices === 0) return;

  const beat = 60 / 68;
  let bar = 0;

  const play = () => {
    const now = g.ctx.currentTime;
    if (now < hushUntil) return;
    // D minor pentatonic, fixed. Low voices enter first and stay low.
    const lines: readonly (readonly [number, number, number])[] = [
      [146.83, 4, 0],
      [220, 4, 2],
      [293.66, 8, 3],
      [174.61, 8, 6],
    ];
    for (let index = 0; index < musicVoices; index += 1) {
      const line = lines[index];
      if (!line) continue;
      const [freq, every, offset] = line;
      if ((bar * 2 + offset) % every !== 0) continue;
      pluck(g, freq, now + 0.02, index >= 2);
    }
    bar += 1;
  };

  play();
  musicTimer = window.setInterval(play, beat * 2000);
}

export function stopMusic(): void {
  if (musicTimer !== 0) window.clearInterval(musicTimer);
  musicTimer = 0;
}

/** Prepared string, or plucked metal: the same pluck with a different partial set. */
function pluck(g: Graph, freq: number, at: number, metal: boolean): void {
  const partials = metal
    ? ([
        [1, 0.5, 1.6],
        [2.41, 0.3, 1.1],
        [3.77, 0.14, 0.7],
      ] as const)
    : ([
        [1, 0.6, 2.2],
        [2, 0.2, 1.4],
        [3, 0.08, 0.8],
      ] as const);
  for (const [ratio, share, decay] of partials) {
    const osc = g.ctx.createOscillator();
    osc.type = metal ? 'triangle' : 'sine';
    osc.frequency.value = freq * ratio;
    const gain = envelope(g, 0.22 * share, at, 0.01, decay);
    osc.connect(gain);
    gain.connect(g.music);
    osc.start(at);
    osc.stop(at + decay + 0.2);
  }
  // The "prepared" part: a muted click on the attack, like felt on a string.
  const damp = noiseSource(g, false);
  const band = g.ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq * 5;
  band.Q.value = 2;
  const dampGain = envelope(g, 0.04, at, 0.001, 0.05);
  damp.connect(band);
  band.connect(dampGain);
  dampGain.connect(g.music);
  damp.start(at);
  damp.stop(at + 0.1);
}
