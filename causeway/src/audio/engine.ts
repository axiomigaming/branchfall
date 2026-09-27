/**
 * CAUSEWAY sound, synthesised in WebAudio. No samples are shipped yet, so every
 * voice is built from oscillators and filtered noise; the public surface is the
 * one a sample-based implementation would keep (see WorldSounds in render/game).
 *
 * Signal flow
 *   score voices → score (duck) ─┐
 *   stingers ─────────────────────┼→ music ─┐
 *   ambience → amb ─┐             │         ├→ master → shelf → compressor → out
 *   sfx voices ─────┴→ sfx ───────┼─────────┘
 *   music/sfx sends ──────────────┴→ room (convolver) → master
 *
 * The score builds with the multiplier on screen (tempo, layers, register, harmonic
 * rhythm) and the tension riser follows the approach to the next milestone. None of
 * it depends on the hidden fall point.
 */
import type { WorldSounds } from '../render/game';
import { milestoneApproach } from './feedback';

type Scene = 'title' | 'setup' | 'lead' | 'run' | 'escaped' | 'fallen';
export type UiSound = 'hover' | 'tick' | 'press' | 'confirm' | 'bet' | 'cashout' | 'deny' | 'open' | 'close' | 'stamp';

const ROOT = 146.83; // D3
const hz = (semi: number, base = ROOT) => base * Math.pow(2, semi / 12);

/** Chords as semitones from D3. Calm progression i–VI–III–VII; driven one i–VI–iv–V. */
const CALM = [
  [0, 3, 7],
  [-4, 0, 3],
  [3, 7, 10],
  [-2, 2, 5],
];
const DRIVEN = [
  [0, 3, 7],
  [-4, 0, 3],
  [-7, -4, 0],
  [-5, -1, 2],
];
/** Arpeggio order over chord tones (index into [r, 3rd, 5th, r+12, 3rd+12]). */
const ARP = [0, 2, 3, 2, 1, 2, 4, 2];
/** Bell pitch per milestone (semitones above D5), rising. */
const MILESTONE_BELL = [0, 3, 7, 10, 12, 15];

export class AudioEngine implements WorldSounds {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private score!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private room!: ConvolverNode;
  private musicSend!: GainNode;
  private sfxSend!: GainNode;
  private noise!: AudioBuffer;
  private scene: Scene = 'title';
  private intensity = 0;
  private running = false;
  private speed = 0;
  private nextBeat = 0;
  private beat = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  // Pad (the drone that follows the harmony).
  private padGain!: GainNode;
  private padFilter!: BiquadFilterNode;
  private padOsc: OscillatorNode[] = [];
  private chord = CALM[0]!;
  // Beds.
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private whistleGain!: GainNode;
  private whistleFilter!: BiquadFilterNode;
  private waterGain!: GainNode;
  private insectGain!: GainNode;
  private rumbleGain!: GainNode;
  private rumbleFilter!: BiquadFilterNode;
  // Tension riser (follows the approach to the next milestone).
  private riserGain!: GainNode;
  private riserFilter!: BiquadFilterNode;
  private riserToneGain!: GainNode;
  private riserOsc!: OscillatorNode;
  private levels = { master: 0.8, music: 0.6, sfx: 0.85, muted: false };
  private lastHover = 0;
  private stepSide = 1;
  private stepPan: StereoPannerNode[] = [];
  private recentImpacts: number[] = [];
  private crashAt = -10;
  private crashKind = '';
  private slamDone = true;
  private birdTimer: ReturnType<typeof setTimeout> | null = null;

  /** Browsers only allow audio after a gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    // Master chain: a gentle top shelf (synth noise gets bright), then a soft-knee
    // compressor that glues rather than pumps, and a fast catch for the big hits.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.25;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.1;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 7000;
    shelf.gain.value = -3;
    this.master = ctx.createGain();
    this.master.connect(shelf).connect(comp).connect(limit).connect(ctx.destination);
    this.music = ctx.createGain();
    this.score = ctx.createGain();
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.score.connect(this.music);
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.amb.connect(this.sfx);
    // Two seconds of white noise, reused by every noisy voice.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // A stone room: a short, dark, generated impulse. Everything sends a little.
    this.room = ctx.createConvolver();
    this.room.buffer = this.impulse(2.2, 2.6);
    const roomOut = ctx.createGain();
    roomOut.gain.value = 0.9;
    this.room.connect(roomOut).connect(this.master);
    this.musicSend = ctx.createGain();
    this.musicSend.gain.value = 0.28;
    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = 0.14;
    // Keep the sub out of the room: reverberant lows are mud.
    const roomHp = ctx.createBiquadFilter();
    roomHp.type = 'highpass';
    roomHp.frequency.value = 220;
    roomHp.connect(this.room);
    this.music.connect(this.musicSend).connect(roomHp);
    this.sfx.connect(this.sfxSend).connect(roomHp);
    for (const p of [-0.12, 0.12]) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = p;
      sp.connect(this.sfx);
      this.stepPan.push(sp);
    }
    this.buildBeds();
    this.buildPad();
    this.buildRiser();
    this.applyLevels();
    this.nextBeat = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
    // Background tabs: stop the clock rather than pile up (and save the battery).
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
    this.setScene(this.scene);
  }

  setLevels(l: { master: number; music: number; sfx: number; muted: boolean }): void {
    this.levels = l;
    this.applyLevels();
  }

  private applyLevels() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.levels.muted ? 0 : this.levels.master;
    this.master.gain.setTargetAtTime(m, t, 0.05);
    this.music.gain.setTargetAtTime(this.levels.music * 0.6, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.levels.sfx, t, 0.05);
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len;
        // Darker as it decays: a one-pole lowpass whose cutoff falls over the tail.
        const a = 0.55 - 0.45 * k;
        lp += a * ((Math.random() * 2 - 1) - lp);
        const pre = i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1;
        d[i] = lp * Math.pow(1 - k, decay) * pre * 0.9;
      }
    }
    return buf;
  }

  // ------------------------------------------------------------------ beds
  private loopNoise(rate = 1): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, Math.random() * 1.9);
    return s;
  }

  private lfo(freq: number, depth: number, target: AudioParam, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
  }

  private buildBeds() {
    const ctx = this.ctx!;
    // Water: low lapping against the causeway, two slow swells out of phase.
    const w = this.loopNoise(0.8);
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 480;
    wf.Q.value = 0.4;
    this.lfo(0.11, 160, wf.frequency);
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0.05;
    const lap = ctx.createGain();
    lap.gain.value = 0.7;
    this.lfo(0.23, 0.3, lap.gain);
    w.connect(wf).connect(lap).connect(this.waterGain).connect(this.amb);
    // Wind: a broad body plus a thin whistle, both gusting, both rising with speed.
    const n = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.02;
    const gust = ctx.createGain();
    gust.gain.value = 0.75;
    this.lfo(0.07, 0.25, gust.gain);
    n.connect(this.windFilter).connect(gust).connect(this.windGain).connect(this.amb);
    const wh = this.loopNoise(1.3);
    this.whistleFilter = ctx.createBiquadFilter();
    this.whistleFilter.type = 'bandpass';
    this.whistleFilter.frequency.value = 1100;
    this.whistleFilter.Q.value = 5;
    this.lfo(0.17, 160, this.whistleFilter.frequency);
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0.004;
    const whPan = ctx.createStereoPanner();
    this.lfo(0.05, 0.6, whPan.pan);
    wh.connect(this.whistleFilter).connect(this.whistleGain).connect(whPan).connect(this.amb);
    // Insects: a high shimmer, amplitude-modulated, out in the trees.
    const ins = this.loopNoise();
    const inf = ctx.createBiquadFilter();
    inf.type = 'bandpass';
    inf.frequency.value = 6200;
    inf.Q.value = 7;
    const ing = ctx.createGain();
    ing.gain.value = 0.0;
    this.lfo(31, 0.01, ing.gain);
    this.insectGain = ctx.createGain();
    this.insectGain.gain.value = 1;
    ins.connect(inf).connect(ing).connect(this.insectGain).connect(this.amb);
    // Rumble: the ruins under strain; follows intensity.
    const r = this.loopNoise(0.5);
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 90;
    this.rumbleFilter.Q.value = 0.9;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    r.connect(this.rumbleFilter).connect(this.rumbleGain).connect(this.sfx);
    // Birds, now and then, when nothing is chasing us.
    const bird = () => {
      if (this.ctx && this.ctx.state === 'running' && (this.scene === 'title' || this.scene === 'setup' || this.scene === 'escaped')) this.birdCall();
      this.birdTimer = setTimeout(bird, 2500 + Math.random() * 6000);
    };
    this.birdTimer = setTimeout(bird, 1800);
  }

  /** The harmonic drone: five persistent voices that glide to each new chord. */
  private buildPad() {
    const ctx = this.ctx!;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 380;
    this.padFilter.Q.value = 0.7;
    this.lfo(0.09, 60, this.padFilter.frequency);
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padFilter.connect(this.padGain).connect(this.music);
    const voices: [OscillatorType, number, number][] = [
      ['sawtooth', -8, 0.16], // root, an octave down
      ['sawtooth', 7, 0.16], // root, an octave down, detuned
      ['triangle', 0, 0.2], // third
      ['sawtooth', 4, 0.1], // fifth
      ['sine', 0, 0.28], // sub root
    ];
    for (const [type, det, g] of voices) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = det;
      const gn = ctx.createGain();
      gn.gain.value = g;
      o.connect(gn).connect(this.padFilter);
      o.start();
      this.padOsc.push(o);
    }
    this.voiceChord(this.chord, ctx.currentTime, 0.01);
  }

  private voiceChord(c: number[], at: number, glide: number) {
    const [r, third, fifth] = c as [number, number, number];
    const f = [hz(r - 12), hz(r - 12), hz(third), hz(fifth), hz(r - 24)];
    this.padOsc.forEach((o, i) => o.frequency.setTargetAtTime(f[i]!, at, glide));
  }

  private buildRiser() {
    const ctx = this.ctx!;
    const n = this.loopNoise();
    this.riserFilter = ctx.createBiquadFilter();
    this.riserFilter.type = 'bandpass';
    this.riserFilter.frequency.value = 500;
    this.riserFilter.Q.value = 2.2;
    this.riserGain = ctx.createGain();
    this.riserGain.gain.value = 0;
    n.connect(this.riserFilter).connect(this.riserGain).connect(this.score);
    // A bowed tone under the noise, rising a fifth across the approach.
    this.riserOsc = ctx.createOscillator();
    this.riserOsc.type = 'sawtooth';
    this.riserOsc.frequency.value = hz(12);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    this.riserToneGain = ctx.createGain();
    this.riserToneGain.gain.value = 0;
    this.riserOsc.connect(lp).connect(this.riserToneGain).connect(this.score);
    this.riserOsc.start();
  }

  private birdCall() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.amb);
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1600;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const st = t + i * (0.09 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.2), st);
      o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.6), st + 0.07);
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.014, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.08);
      o.connect(g).connect(pan);
      o.start(st);
      o.stop(st + 0.1);
    }
  }

  // ------------------------------------------------------------------ voices
  private noiseHit(at: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, dest: AudioNode = this.sfx, sweepTo?: number, attack = 0) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, at);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    if (attack > 0) {
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + attack);
    } else g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(dur, attack + 0.01));
    s.connect(f).connect(g).connect(dest);
    s.start(at, Math.random() * 1.5);
    s.stop(at + Math.max(dur, attack + 0.01) + 0.02);
  }

  private tone(at: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', dest: AudioNode = this.sfx, toFreq?: number, attack = 0.005) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  /** A filtered sawtooth note (bass, strings, brass). */
  private synth(at: number, freq: number, dur: number, gain: number, cutoff: number, dest: AudioNode, opts: { attack?: number; release?: number; toCutoff?: number; detune?: number; type?: OscillatorType } = {}) {
    const ctx = this.ctx!;
    const attack = opts.attack ?? 0.01;
    const release = opts.release ?? dur * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, at);
    if (opts.toCutoff) f.frequency.exponentialRampToValueAtTime(opts.toCutoff, at + dur);
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + attack);
    g.gain.setTargetAtTime(0.0001, at + Math.max(attack, dur - release), release / 4);
    f.connect(g).connect(dest);
    const dets = opts.detune ? [-opts.detune, opts.detune] : [0];
    for (const det of dets) {
      const o = ctx.createOscillator();
      o.type = opts.type ?? 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(at);
      o.stop(at + dur + 0.05);
    }
  }

  /** Inharmonic bell: three sine partials with staggered decays. */
  private bell(at: number, freq: number, gain: number, dur = 1.8, dest: AudioNode = this.music) {
    this.tone(at, freq, dur, gain, 'sine', dest, undefined, 0.003);
    this.tone(at, freq * 2.76, dur * 0.45, gain * 0.35, 'sine', dest, undefined, 0.002);
    this.tone(at, freq * 5.4, dur * 0.2, gain * 0.14, 'sine', dest, undefined, 0.002);
  }

  // ------------------------------------------------------------------ world hooks
  footstep(strength: number, surface: 'stone' | 'wood'): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = 0.45 + strength * 0.55;
    this.stepSide = -this.stepSide;
    const out = this.stepPan[this.stepSide > 0 ? 1 : 0]!;
    const v = 0.9 + Math.random() * 0.2;
    if (surface === 'wood') {
      // A hollow plank: a resonant knock with a short ring, and now and then a creak.
      this.tone(t, 170 * v, 0.12, 0.13 * k, 'triangle', out, 120);
      this.noiseHit(t, 0.12, 'bandpass', 420 * v, 7, 0.16 * k, out);
      this.noiseHit(t, 0.025, 'bandpass', 2400, 1.2, 0.06 * k, out);
      if (Math.random() < 0.14) {
        const c = t + 0.04;
        this.synth(c, 260 + Math.random() * 90, 0.22, 0.012, 900, out, { attack: 0.04, type: 'sawtooth', toCutoff: 600 });
      }
    } else {
      // Leather on stone: a soft body thump, a dry scuff and a little grit.
      this.tone(t, 110 * v, 0.07, 0.11 * k, 'sine', out, 55);
      this.noiseHit(t, 0.035 + 0.02 * Math.random(), 'bandpass', 1500 * v + Math.random() * 700, 1.1, 0.08 * k, out);
      this.noiseHit(t + 0.01, 0.05, 'highpass', 5200, 0.7, 0.022 * k, out);
    }
  }

  impact(size: number, water: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Voice limiting: in a collapse dozens of bodies land at once.
    this.recentImpacts = this.recentImpacts.filter((x) => t - x < 0.25);
    if (this.recentImpacts.length >= 6) return;
    this.recentImpacts.push(t);
    const crowd = 1 / Math.sqrt(this.recentImpacts.length);
    const k = Math.min(1.3, 0.3 + size) * crowd;
    if (water) {
      // Splash body falling in pitch, a low whump, then a few plops.
      this.noiseHit(t, 0.5 + k * 0.5, 'lowpass', 4200, 0.6, 0.16 * k, this.sfx, 420);
      this.noiseHit(t, 0.1, 'bandpass', 1300, 1.4, 0.1 * k);
      this.tone(t, 90, 0.3, 0.2 * k, 'sine', this.sfx, 48);
      for (let i = 0; i < 3; i++) this.tone(t + 0.08 + i * 0.05 + Math.random() * 0.08, 380 + Math.random() * 300, 0.05, 0.025 * k, 'sine', this.sfx, 1100);
      return;
    }
    // The gate's landing is the slam that ends the run: make it the heaviest sound in the game.
    const slam = !this.slamDone && this.crashKind === 'gate' && t - this.crashAt < 3;
    if (slam) {
      this.slamDone = true;
      this.tone(t, 64, 1.8, 0.75, 'sine', this.sfx, 28, 0.002);
      this.tone(t, 128, 0.5, 0.25, 'triangle', this.sfx, 60, 0.002);
      this.noiseHit(t, 0.9, 'lowpass', 2600, 0.7, 0.55, this.sfx, 120);
      this.noiseHit(t, 0.05, 'bandpass', 900, 0.8, 0.4);
      for (let i = 0; i < 10; i++) this.noiseHit(t + 0.08 + Math.random() * 0.9, 0.05, 'bandpass', 1000 + Math.random() * 3000, 2, 0.05);
      return;
    }
    // Stone: a sub thump, a crack, a gritty body and a crumbling tail.
    this.tone(t, 72, 0.45 + k * 0.4, 0.45 * k, 'sine', this.sfx, 32);
    this.noiseHit(t, 0.03, 'bandpass', 1100 + Math.random() * 600, 1, 0.22 * k);
    this.noiseHit(t, 0.3 + k * 0.3, 'lowpass', 1500, 0.6, 0.3 * k, this.sfx, 160);
    for (let i = 0; i < Math.round(5 * k); i++) this.noiseHit(t + 0.05 + Math.random() * 0.6, 0.045, 'bandpass', 900 + Math.random() * 2500, 2, 0.04 * k);
  }

  tremor(strength: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseHit(t, 1.8, 'lowpass', 150, 0.9, 0.22 + strength * 0.22, this.sfx, 55, 0.25);
    this.tone(t, 41, 1.5, 0.1 + strength * 0.12, 'sine', this.sfx, 33, 0.3);
    for (let i = 0; i < 4 + strength * 5; i++) this.noiseHit(t + 0.2 + Math.random() * 1.1, 0.04, 'bandpass', 2000 + Math.random() * 2500, 3, 0.022);
  }

  whoosh(): void {
    if (!this.ctx) return;
    this.noiseHit(this.ctx.currentTime, 0.7, 'bandpass', 280, 1.2, 0.1, this.sfx, 2200, 0.25);
  }

  run(intensity: number, running: boolean, speed: number): void {
    if (!this.ctx) return;
    this.intensity = intensity;
    this.running = running;
    this.speed = speed;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.016 + speed * 0.0045, t, 0.35);
    this.windFilter.frequency.setTargetAtTime(360 + speed * 70, t, 0.35);
    this.whistleGain.gain.setTargetAtTime(0.003 + speed * speed * 0.00009, t, 0.4);
    this.rumbleGain.gain.setTargetAtTime(running ? Math.max(0, intensity - 0.3) * 0.26 : 0, t, 0.5);
    this.rumbleFilter.frequency.setTargetAtTime(80 + intensity * 50, t, 0.5);
    this.padFilter.frequency.setTargetAtTime(running ? 320 + intensity * 1400 : 260, t, 0.4);
    this.insectGain.gain.setTargetAtTime(running ? Math.max(0, 1 - intensity * 1.6) : 1, t, 0.8);
    if (!running) this.climb(100);
  }

  /**
   * The tension riser, from the multiplier on screen (hundredths). Swells across
   * the last stretch before each milestone and resets on arrival. Call per frame.
   */
  climb(m: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const live = this.running && this.scene === 'run';
    const a = live ? milestoneApproach(m) : 0;
    const p = Math.max(0, (a - 0.55) / 0.45); // only the last stretch
    const shaped = p * p;
    this.riserGain.gain.setTargetAtTime(shaped * 0.05, t, live ? 0.12 : 0.05);
    this.riserFilter.frequency.setTargetAtTime(500 + shaped * 3800, t, 0.12);
    this.riserToneGain.gain.setTargetAtTime(shaped * 0.018, t, live ? 0.15 : 0.05);
    this.riserOsc.frequency.setTargetAtTime(hz(12 + 7 * p), t, 0.12);
  }

  /** A milestone reached (index into MILESTONES): a low bloom, a bell, air. */
  milestone(i: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const semi = MILESTONE_BELL[Math.min(i, MILESTONE_BELL.length - 1)]!;
    this.tone(t, 96, 0.9, 0.28, 'sine', this.sfx, 46, 0.004);
    this.noiseHit(t, 0.9, 'highpass', 6500, 0.6, 0.03, this.music, undefined, 0.01);
    this.bell(t, hz(semi + 24), 0.05, 2.2);
    this.bell(t + 0.07, hz(semi + 31), 0.03, 1.8);
    if (i >= 2) this.synth(t, hz(this.chord[0]! - 12), 1.6, 0.05, 700, this.music, { attack: 0.01, release: 1.2, toCutoff: 200, detune: 8 });
  }

  crash(kind: string): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.crashAt = t;
    this.crashKind = kind;
    this.slamDone = false;
    // The score drops out; the riser is cut dead.
    this.score.gain.cancelScheduledValues(t);
    this.score.gain.setValueAtTime(this.score.gain.value, t);
    this.score.gain.setTargetAtTime(0, t, 0.03);
    this.riserGain.gain.setTargetAtTime(0, t, 0.02);
    this.riserToneGain.gain.setTargetAtTime(0, t, 0.02);
    // Common: a sub drop and a low, dark minor-second sting.
    this.tone(t, 58, 2.4, 0.55, 'sine', this.sfx, 26, 0.004);
    this.synth(t + 0.05, hz(-24), 3.4, 0.09, 1200, this.music, { attack: 0.02, release: 2.4, toCutoff: 140, detune: 9 });
    this.synth(t + 0.05, hz(-23), 3.4, 0.06, 1000, this.music, { attack: 0.02, release: 2.4, toCutoff: 140, detune: 6 });
    this.synth(t + 0.05, hz(-17), 3.2, 0.05, 900, this.music, { attack: 0.03, release: 2.2, toCutoff: 160 });
    if (kind === 'gate') {
      // The slab lets go above: a stone-on-stone grind falling in pitch (the slam is its impact).
      this.noiseHit(t, 0.8, 'bandpass', 900, 2.5, 0.16, this.sfx, 280, 0.15);
      this.synth(t, 70, 0.8, 0.05, 500, this.sfx, { attack: 0.1, type: 'square', toCutoff: 180 });
      this.noiseHit(t, 0.04, 'bandpass', 2400, 1, 0.12);
    } else if (kind === 'chasm') {
      // The causeway cracks under the feet, then the slabs go: a long collapsing roar.
      this.noiseHit(t, 0.05, 'highpass', 1800, 0.7, 0.35);
      this.noiseHit(t + 0.02, 0.25, 'bandpass', 700, 1.5, 0.25, this.sfx, 300);
      this.noiseHit(t + 0.05, 2.6, 'lowpass', 1400, 0.6, 0.4, this.sfx, 80, 0.2);
      for (let i = 0; i < 14; i++) this.noiseHit(t + 0.1 + Math.random() * 1.6, 0.06, 'bandpass', 600 + Math.random() * 2600, 2, 0.05);
    } else {
      // Rockfall: the cliff lets go overhead — a rising roar from above before the hits land.
      this.noiseHit(t, 1.2, 'lowpass', 300, 0.8, 0.35, this.sfx, 1600, 0.6);
      this.noiseHit(t + 0.02, 0.05, 'bandpass', 1600, 1, 0.18);
      for (let i = 0; i < 10; i++) this.noiseHit(t + 0.2 + Math.random() * 1.2, 0.05, 'bandpass', 1400 + Math.random() * 2600, 2.5, 0.045);
    }
  }

  escape(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // The riser resolves instead of cutting; the score gives way to a warm major lift.
    this.riserGain.gain.setTargetAtTime(0, t, 0.3);
    this.riserToneGain.gain.setTargetAtTime(0, t, 0.3);
    this.score.gain.cancelScheduledValues(t);
    this.score.gain.setValueAtTime(this.score.gain.value, t);
    this.score.gain.setTargetAtTime(0, t, 0.25);
    // D major (the Picardy third after all that minor): low to high, slow bloom.
    this.tone(t, hz(-24), 3.6, 0.22, 'sine', this.music, undefined, 0.04);
    for (const s of [-12, 0, 4, 7, 12]) this.synth(t + 0.02, hz(s), 3.8, 0.035, 1800, this.music, { attack: 0.35, release: 2.6, toCutoff: 900, detune: 7, type: 'triangle' });
    // Bells climbing out.
    for (const [i, s] of [12, 19, 24, 28, 31].entries()) this.bell(t + 0.06 + i * 0.085, hz(s + 12), 0.032 - i * 0.003, 2.4);
    this.noiseHit(t, 1.6, 'highpass', 6000, 0.5, 0.025, this.sfx, undefined, 0.2);
    this.noiseHit(t, 0.5, 'bandpass', 800, 0.9, 0.05, this.sfx, 3000, 0.08);
  }

  ui(s: UiSound): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (s) {
      case 'hover':
        if (t - this.lastHover < 0.07) return;
        this.lastHover = t;
        this.noiseHit(t, 0.018, 'bandpass', 3400, 3, 0.02);
        break;
      case 'tick':
        this.tone(t, 1800, 0.035, 0.028, 'triangle');
        this.noiseHit(t, 0.012, 'bandpass', 5000, 2, 0.02);
        break;
      case 'press':
        this.tone(t, 420, 0.06, 0.05, 'sine', this.sfx, 260);
        this.noiseHit(t, 0.02, 'bandpass', 2500, 1.5, 0.03);
        break;
      case 'open':
        this.tone(t, 587, 0.14, 0.028, 'sine', this.sfx, 880, 0.01);
        this.noiseHit(t, 0.18, 'bandpass', 1400, 1, 0.012, this.sfx, 3200, 0.05);
        break;
      case 'close':
        this.tone(t, 880, 0.12, 0.022, 'sine', this.sfx, 520, 0.008);
        break;
      case 'confirm':
        this.bell(t, hz(19), 0.035, 0.9, this.sfx);
        this.bell(t + 0.07, hz(26), 0.028, 1.0, this.sfx);
        break;
      case 'bet':
        // A token set on stone: a low knock, a dry click, and a quiet low bell.
        this.tone(t, 190, 0.2, 0.14, 'sine', this.sfx, 85, 0.002);
        this.noiseHit(t, 0.05, 'bandpass', 1700, 1.3, 0.08);
        this.bell(t + 0.02, hz(12), 0.03, 1.2, this.sfx);
        break;
      case 'cashout':
        // Bright and immediate: the press itself must feel answered before the server replies.
        this.bell(t, hz(31), 0.045, 1.0, this.sfx);
        this.bell(t + 0.045, hz(36), 0.035, 1.1, this.sfx);
        this.noiseHit(t, 0.35, 'bandpass', 900, 1, 0.05, this.sfx, 4200, 0.03);
        break;
      case 'stamp':
        this.tone(t, 140, 0.25, 0.14, 'sine', this.sfx, 70, 0.002);
        this.noiseHit(t, 0.06, 'lowpass', 1600, 0.8, 0.1);
        break;
      case 'deny':
        this.tone(t, 196, 0.16, 0.05, 'triangle', this.sfx, 165);
        this.tone(t + 0.09, 185, 0.16, 0.04, 'triangle', this.sfx, 155);
        break;
    }
  }

  setScene(s: Scene): void {
    const prev = this.scene;
    this.scene = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const pad = s === 'run' ? 0.42 : s === 'lead' ? 0.3 : s === 'fallen' ? 0 : s === 'escaped' ? 0.12 : 0.16;
    this.padGain.gain.setTargetAtTime(pad, t, s === 'fallen' ? 0.06 : 0.6);
    this.waterGain.gain.setTargetAtTime(s === 'run' ? 0.03 : 0.06, t, 1);
    if (s === 'lead' || s === 'run' || s === 'setup' || s === 'title') {
      // Bring the score back (it is cut at the fall / cash-out).
      this.score.gain.cancelScheduledValues(t);
      this.score.gain.setValueAtTime(Math.max(0.0001, this.score.gain.value), t);
      this.score.gain.setTargetAtTime(1, t, 0.15);
    }
    if (s === 'lead' && prev !== 'lead') {
      this.beat = 0;
      this.nextBeat = t + 0.02;
      this.setChord(CALM[0]!, t, 0.3);
    }
    if (s === 'run' && prev !== 'run') {
      // Go: a big low drum and a lift of air on the downbeat; the groove starts from bar one.
      this.beat = 0;
      this.nextBeat = t + 0.01;
      this.drum(t, 0.4, 52, this.score);
      this.noiseHit(t, 0.6, 'bandpass', 500, 0.9, 0.06, this.score, 3500, 0.02);
    }
    if (s === 'escaped') this.score.gain.setTargetAtTime(0.8, t + 2.8, 1.2);
    if (s === 'setup' || s === 'title') this.setChord(CALM[0]!, t, 1.5);
  }

  private setChord(c: number[], at: number, glide: number) {
    this.chord = c;
    this.voiceChord(c, at, glide);
  }

  // ------------------------------------------------------------------ score
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // After a stall (tab throttled), skip ahead instead of firing a burst of old notes.
    if (this.nextBeat < ctx.currentTime - 0.05) this.nextBeat = ctx.currentTime + 0.02;
    const ahead = ctx.currentTime + 0.12;
    const I = this.intensity;
    const bpm = 96 + 40 * I;
    const step = 60 / bpm / 4; // sixteenths
    while (this.nextBeat < ahead) {
      const at = this.nextBeat;
      const b = this.beat % 16;
      const bar = Math.floor(this.beat / 16);
      if (this.scene === 'run' || this.scene === 'lead') this.musicStep(at, b, bar, I, step);
      else if (this.scene === 'setup' || this.scene === 'title' || this.scene === 'escaped') this.ambientStep(at, b, bar);
      this.nextBeat += step;
      this.beat++;
    }
  }

  /** Between runs: patient, spacious — a low drum now and then, a held chord that drifts. */
  private ambientStep(at: number, b: number, bar: number) {
    if (b !== 0) return;
    if (bar % 4 === 0) {
      this.drum(at, 0.09, 64, this.score);
      const c = CALM[(bar / 4) % CALM.length]!;
      this.setChord(c, at, 1.8);
      if (this.scene !== 'escaped') for (const s of c) this.synth(at, hz(s + 12), 5.5, 0.012, 1100, this.score, { attack: 1.6, release: 3, type: 'triangle', detune: 5 });
    }
    if (bar % 4 === 2 && Math.random() < 0.6) this.bell(at, hz(this.chord[Math.floor(Math.random() * 3)]! + 24), 0.012, 2.4, this.score);
  }

  /** A frame drum / taiko: pitch-dropping body plus a soft skin slap. */
  private drum(at: number, gain: number, freq: number, dest: AudioNode = this.score) {
    this.tone(at, freq * 2.2, 0.4, gain, 'sine', dest, freq, 0.002);
    this.noiseHit(at, 0.05, 'lowpass', 1200, 0.5, gain * 0.3, dest);
  }

  private musicStep(at: number, b: number, bar: number, I: number, step: number) {
    const out = this.score;
    if (this.scene === 'lead') {
      // Coiled: a heartbeat, nothing else.
      if (b === 0) this.drum(at, 0.26, 54, out);
      if (b === 3) this.drum(at, 0.16, 54, out);
      return;
    }
    // Harmony: chord every two bars, every bar once it is driving hard.
    const hr = I > 0.7 ? 1 : 2;
    if (b === 0 && bar % hr === 0) {
      const prog = I > 0.5 ? DRIVEN : CALM;
      this.setChord(prog[Math.floor(bar / hr) % prog.length]!, at, 0.12);
      if (I > 0.35) {
        // Strings: a held line on the chord's fifth and third, two octaves up, swelling.
        const len = step * 16 * hr;
        const g = 0.012 + 0.02 * I;
        this.synth(at, hz(this.chord[2]! + 24), len, g, 2200, out, { attack: len * 0.5, release: len * 0.4, detune: 6 });
        if (I > 0.6) this.synth(at, hz(this.chord[1]! + 24), len, g * 0.7, 2000, out, { attack: len * 0.6, release: len * 0.35, detune: 5 });
      }
    }
    const phraseEnd = bar % 4 === 3;
    // Drums: heartbeat kick, busier as the multiplier climbs.
    const kick = b === 0 || b === 8 || (I > 0.2 && b === 10) || (I > 0.5 && (b === 3 || b === 14)) || (I > 0.8 && b === 6);
    if (kick) this.drum(at, 0.24 + I * 0.1, 50, out);
    // Backbeat: a rim/clap, with a taiko under it later.
    if (b === 4 || b === 12) {
      this.noiseHit(at, 0.08, 'bandpass', 1900, 1.2, 0.07 + I * 0.05, out);
      this.tone(at, 210, 0.08, 0.05 + I * 0.03, 'triangle', out, 150, 0.002);
      if (I > 0.4) this.drum(at, 0.12 + I * 0.08, 92, out);
    }
    // Shaker: sixteenths with accents, alternating a little left and right.
    if (I > 0.12) {
      const acc = b % 4 === 2 ? 1 : b % 2 === 0 ? 0.6 : 0.35;
      this.noiseHit(at, 0.035, 'highpass', 6500, 0.7, (0.012 + I * 0.022) * acc, out);
    }
    // Taiko fill closing each phrase.
    if (I > 0.35 && phraseEnd && b >= 12) this.drum(at, 0.14 + I * 0.1, 110 - (b - 12) * 12, out);
    // Bass: eighths on the root, octave jumps on the offbeat once driving.
    if (I > 0.28 && b % 2 === 0) {
      const r = this.chord[0]! - 24 + (I > 0.6 && b % 4 === 2 ? 12 : 0);
      this.synth(at, hz(r), step * 1.8, 0.07 + I * 0.03, 260 + I * 500, out, { attack: 0.005, release: step, toCutoff: 140 });
    }
    // Ostinato: a marimba-like arpeggio over the chord, climbing in register.
    const every = I > 0.45 ? 1 : 2;
    if (b % every === 0) {
      const c = this.chord;
      const tones = [c[0]!, c[1]!, c[2]!, c[0]! + 12, c[1]! + 12];
      const n = tones[ARP[(this.beat / every) % ARP.length | 0]!]! + (I > 0.65 ? 24 : 12);
      const g = (0.035 + I * 0.02) * (b % 4 === 0 ? 1 : 0.7);
      this.tone(at, hz(n), 0.28, g, 'sine', out, undefined, 0.002);
      this.tone(at, hz(n) * 4, 0.06, g * 0.3, 'sine', out, undefined, 0.001);
    }
  }
}
