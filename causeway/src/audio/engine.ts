/**
 * CAUSEWAY sound, synthesised in WebAudio. No samples are shipped yet, so every
 * voice is built from oscillators and filtered noise; the public surface is the
 * one a sample-based implementation would keep (see WorldSounds in render/game).
 *
 * Buses: master → compressor → out; music and sfx (with ambience) each gain-staged
 * so the settings sliders map one-to-one.
 */
import type { WorldSounds } from '../render/game';

type Scene = 'title' | 'setup' | 'lead' | 'run' | 'escaped' | 'fallen';
export type UiSound = 'hover' | 'tick' | 'confirm' | 'bet' | 'cashout' | 'deny' | 'open' | 'close';

const ROOT = 146.83; // D3
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17]; // D minor pentatonic-ish, two octaves
const hz = (semi: number, base = ROOT) => base * Math.pow(2, semi / 12);

export class AudioEngine implements WorldSounds {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private noise!: AudioBuffer;
  private scene: Scene = 'title';
  private intensity = 0;
  private running = false;
  private speed = 0;
  private nextBeat = 0;
  private beat = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private droneGain!: GainNode;
  private droneFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private waterGain!: GainNode;
  private rumbleGain!: GainNode;
  private levels = { master: 0.8, music: 0.6, sfx: 0.85, muted: false };
  private lastHover = 0;

  /** Browsers only allow audio after a gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.music = ctx.createGain();
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.amb.connect(this.sfx);
    // Two seconds of white noise, reused by every noisy voice.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.buildBeds();
    this.applyLevels();
    this.nextBeat = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
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
    this.music.gain.setTargetAtTime(this.levels.music * 0.55, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.levels.sfx, t, 0.05);
  }

  // ------------------------------------------------------------------ beds
  private loopNoise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start();
    return s;
  }

  private buildBeds() {
    const ctx = this.ctx!;
    // Water: low, lapping.
    const w = this.loopNoise();
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 520;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lg = ctx.createGain();
    lg.gain.value = 0.03;
    lfo.connect(lg).connect(this.waterGain.gain);
    lfo.start();
    w.connect(wf).connect(this.waterGain).connect(this.amb);
    // Wind: rises with speed.
    const n = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.02;
    n.connect(this.windFilter).connect(this.windGain).connect(this.amb);
    // Insects: a high shimmer, amplitude-modulated.
    const ins = this.loopNoise();
    const inf = ctx.createBiquadFilter();
    inf.type = 'bandpass';
    inf.frequency.value = 6200;
    inf.Q.value = 6;
    const ing = ctx.createGain();
    ing.gain.value = 0.0;
    const am = ctx.createOscillator();
    am.frequency.value = 31;
    const amg = ctx.createGain();
    amg.gain.value = 0.012;
    am.connect(amg).connect(ing.gain);
    am.start();
    ins.connect(inf).connect(ing).connect(this.amb);
    // Rumble: the ruins under strain; follows intensity.
    const r = this.loopNoise();
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 110;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    r.connect(rf).connect(this.rumbleGain).connect(this.sfx);
    // Drone for the score.
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 380;
    this.droneFilter.Q.value = 0.8;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter.connect(this.droneGain).connect(this.music);
    for (const [f, det] of [
      [ROOT / 2, -6],
      [ROOT / 2, 7],
      [hz(7, ROOT / 2), 0],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = 0.18;
      o.connect(g).connect(this.droneFilter);
      o.start();
    }
    // Birds, now and then.
    const bird = () => {
      if (this.ctx && (this.scene === 'title' || this.scene === 'setup' || this.scene === 'escaped')) this.birdCall();
      setTimeout(bird, 2500 + Math.random() * 6000);
    };
    setTimeout(bird, 1800);
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
      g.gain.linearRampToValueAtTime(0.018, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.08);
      o.connect(g).connect(pan);
      o.start(st);
      o.stop(st + 0.1);
    }
  }

  // ------------------------------------------------------------------ voices
  private noiseHit(at: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, dest: AudioNode = this.sfx, sweepTo?: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, at);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(at, Math.random() * 1.5);
    s.stop(at + dur + 0.02);
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

  footstep(strength: number, surface: 'stone' | 'wood'): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = 0.5 + strength * 0.5;
    if (surface === 'wood') {
      this.tone(t, 150 + Math.random() * 20, 0.09, 0.14 * k, 'triangle', this.sfx, 90);
      this.noiseHit(t, 0.06, 'bandpass', 900, 2, 0.12 * k);
    } else {
      this.tone(t, 95, 0.06, 0.1 * k, 'sine', this.sfx, 60);
      this.noiseHit(t, 0.05 + 0.03 * Math.random(), 'bandpass', 1600 + Math.random() * 900, 1.2, 0.09 * k);
      // Grit.
      this.noiseHit(t + 0.012, 0.04, 'highpass', 4500, 0.7, 0.03 * k);
    }
  }

  impact(size: number, water: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1.3, 0.3 + size);
    if (water) {
      this.noiseHit(t, 0.5 + k * 0.4, 'lowpass', 3000, 0.5, 0.18 * k, this.sfx, 400);
      this.noiseHit(t, 0.12, 'bandpass', 1200, 1.5, 0.12 * k);
      for (let i = 0; i < 3; i++) this.tone(t + 0.05 + i * 0.04 + Math.random() * 0.05, 500 + Math.random() * 400, 0.06, 0.03 * k, 'sine', this.sfx, 1400);
    } else {
      this.tone(t, 70, 0.5 + k * 0.4, 0.5 * k, 'sine', this.sfx, 32);
      this.noiseHit(t, 0.35 + k * 0.3, 'lowpass', 1400, 0.6, 0.35 * k, this.sfx, 180);
      // Crumbling tail.
      for (let i = 0; i < 6 * k; i++) this.noiseHit(t + 0.05 + Math.random() * 0.6, 0.05, 'bandpass', 900 + Math.random() * 2500, 2, 0.05 * k);
    }
  }

  tremor(strength: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseHit(t, 1.6, 'lowpass', 160, 0.8, 0.25 + strength * 0.25, this.sfx, 60);
    for (let i = 0; i < 5; i++) this.noiseHit(t + 0.2 + Math.random() * 1.0, 0.04, 'bandpass', 2000 + Math.random() * 2000, 3, 0.03);
  }

  whoosh(): void {
    if (!this.ctx) return;
    this.noiseHit(this.ctx.currentTime, 0.7, 'bandpass', 300, 1.2, 0.12, this.sfx, 2400);
  }

  run(intensity: number, running: boolean, speed: number): void {
    if (!this.ctx) return;
    this.intensity = intensity;
    this.running = running;
    this.speed = speed;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.015 + speed * 0.006, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(380 + speed * 90, t, 0.3);
    this.rumbleGain.gain.setTargetAtTime(running ? Math.max(0, intensity - 0.3) * 0.22 : 0, t, 0.5);
    this.droneFilter.frequency.setTargetAtTime(running ? 320 + intensity * 1500 : 260, t, 0.4);
  }

  crash(kind: string): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, 55, 2.2, 0.7, 'sine', this.sfx, 28);
    this.noiseHit(t, 1.8, 'lowpass', 2200, 0.5, 0.5, this.sfx, 90);
    if (kind === 'gate') this.tone(t + 0.35, 42, 1.4, 0.8, 'sine', this.sfx, 25);
    // Score: cut, then a low sting.
    this.tone(t + 0.1, hz(-12 + 1), 3.2, 0.12, 'sawtooth', this.music, hz(-13), 0.04);
    this.tone(t + 0.1, hz(-12 + 7), 3.2, 0.08, 'sawtooth', this.music, hz(-12 + 6), 0.04);
  }

  escape(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // A warm major lift over the drone's root, then a bright chime.
    for (const s of [0, 4, 7, 12]) this.tone(t + 0.02, hz(s), 2.8, 0.06, 'triangle', this.music, undefined, 0.25);
    for (const [i, s] of [24, 31, 36].entries()) this.tone(t + 0.08 + i * 0.07, hz(s), 1.6, 0.045, 'sine', this.sfx);
    this.noiseHit(t, 1.2, 'highpass', 6000, 0.5, 0.03, this.sfx);
  }

  ui(s: UiSound): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (s) {
      case 'hover':
        if (t - this.lastHover < 0.06) return;
        this.lastHover = t;
        this.tone(t, 2600, 0.025, 0.012);
        break;
      case 'tick':
        this.tone(t, 1900, 0.03, 0.03, 'triangle');
        break;
      case 'open':
        this.tone(t, 660, 0.12, 0.03, 'sine', this.sfx, 990);
        break;
      case 'close':
        this.tone(t, 880, 0.1, 0.025, 'sine', this.sfx, 520);
        break;
      case 'confirm':
        this.tone(t, 392, 0.2, 0.05, 'triangle');
        this.tone(t + 0.06, 587, 0.25, 0.04, 'triangle');
        break;
      case 'bet':
        this.tone(t, 180, 0.18, 0.12, 'sine', this.sfx, 90);
        this.noiseHit(t, 0.1, 'bandpass', 1500, 1, 0.06);
        break;
      case 'cashout':
        this.tone(t, 1175, 0.35, 0.07, 'sine');
        this.tone(t + 0.03, 1760, 0.3, 0.05, 'sine');
        break;
      case 'deny':
        this.tone(t, 220, 0.14, 0.06, 'square', this.sfx, 180);
        break;
    }
  }

  setScene(s: Scene): void {
    this.scene = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const drone = s === 'run' ? 0.5 : s === 'lead' ? 0.35 : s === 'fallen' ? 0 : s === 'escaped' ? 0.15 : 0.18;
    this.droneGain.gain.setTargetAtTime(drone, t, s === 'fallen' ? 0.08 : 0.6);
    this.waterGain.gain.setTargetAtTime(s === 'run' ? 0.03 : 0.06, t, 1);
    if (s === 'lead') this.nextBeat = Math.max(this.nextBeat, t);
  }

  // ------------------------------------------------------------------ score
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const ahead = ctx.currentTime + 0.12;
    const I = this.intensity;
    const bpm = 92 + 44 * I;
    const step = 60 / bpm / 4; // sixteenths
    while (this.nextBeat < ahead) {
      const at = this.nextBeat;
      const b = this.beat % 16;
      if (this.scene === 'run' || this.scene === 'lead') this.musicStep(at, b, I);
      else if ((this.scene === 'setup' || this.scene === 'title') && b === 0 && this.beat % 64 === 0) {
        // Sparse, patient: a single low frame-drum and a held note.
        this.drum(at, 0.12, 70);
        this.tone(at, hz(SCALE[Math.floor(Math.random() * 4)]!), 3.5, 0.025, 'triangle', this.music, undefined, 0.6);
      }
      this.nextBeat += step;
      this.beat++;
    }
  }

  private drum(at: number, gain: number, freq: number) {
    this.tone(at, freq * 1.8, 0.35, gain, 'sine', this.music, freq, 0.002);
    this.noiseHit(at, 0.06, 'lowpass', 900, 0.5, gain * 0.35, this.music);
  }

  private musicStep(at: number, b: number, I: number) {
    const lead = this.scene === 'lead';
    // Heartbeat kick pattern; busier as the way gets worse.
    const kick = b === 0 || b === 8 || (I > 0.25 && b === 10) || (I > 0.55 && (b === 4 || b === 14));
    if (kick) this.drum(at, 0.22 + I * 0.1, 58);
    if (!lead && (b === 4 || b === 12)) this.drum(at, 0.1 + I * 0.08, 140);
    if (!lead && I > 0.15 && b % 2 === 1) this.noiseHit(at, 0.03, 'highpass', 7000, 0.7, 0.02 + I * 0.03, this.music);
    // Ostinato: plucked pentatonic, climbing register with intensity.
    if (!lead && (b % 4 === 2 || (I > 0.45 && b % 2 === 0))) {
      const idx = (this.beat / 2 + Math.floor(I * 3)) % SCALE.length;
      const oct = I > 0.6 ? 12 : 0;
      this.tone(at, hz(SCALE[Math.floor(idx)]! + oct), 0.22, 0.05 + I * 0.03, 'triangle', this.music, undefined, 0.003);
    }
    // High strings: a rising tension note every bar past halfway.
    if (!lead && I > 0.4 && b === 0) this.tone(at, hz(19 + Math.round(I * 5)), 2.2, 0.018 + 0.02 * I, 'sawtooth', this.music, undefined, 0.8);
  }
}
