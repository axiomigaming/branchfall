import * as THREE from 'three';
import { QUALITY, type QualityLevel } from '../config/quality';
import { multiplierAtSmooth } from '../engine/curve';
import { Rng, hashString } from '../engine/rng';
import { loadKit, wind, type Kit } from '../world/assets';
import { Debris } from '../world/debris';
import { forward } from '../world/path';
import { Runner } from '../world/runner';
import { PATH_HALF } from '../world/sections';
import { Track } from '../world/track';
import { WATER_Y, Water } from '../world/water';
import { CameraRig } from './cameraRig';
import { Motes, Particles } from './particles';
import { Post } from './post';

export type Stage = 'title' | 'setup' | 'lead' | 'run' | 'crash' | 'cashout';

/** What the audio layer hears from the world. Implemented by AudioEngine. */
export interface WorldSounds {
  footstep(strength: number, surface: 'stone' | 'wood'): void;
  impact(size: number, water: boolean): void;
  tremor(strength: number): void;
  run(intensity: number, running: boolean, speed: number): void;
  crash(kind: string): void;
  escape(): void;
  whoosh(): void;
}

const nullSounds: WorldSounds = { footstep() {}, impact() {}, tremor() {}, run() {}, crash() {}, escape() {}, whoosh() {} };

/** Presentation intensity from the multiplier: 0 at 1.00x, 1 at 30x and beyond. */
export function intensityOf(mult: number): number {
  return Math.min(1, Math.max(0, Math.log(mult) / Math.log(30)));
}

export function speedOf(intensity: number): number {
  return 5.0 + 7.6 * Math.pow(intensity, 0.85);
}

const DUST = new THREE.Color('#d9b48a');
const DUST_DARK = new THREE.Color('#8a7058');
const SPRAY = new THREE.Color('#e9f2ee');

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  private kit!: Kit;
  private track!: Track;
  private runner!: Runner;
  private water!: Water;
  private debris!: Debris;
  private particles = new Particles(1100);
  private motes = new Motes(420);
  private post!: Post;
  private sun = new THREE.DirectionalLight(0xffd6a0, 5.2);
  private sunDir = new THREE.Vector3(0.4, 0.25, -0.8);
  private clock = new THREE.Clock();
  private raf = 0;
  private visible = true;
  sounds: WorldSounds = nullSounds;

  stage: Stage = 'title';
  private stageT = 0;
  /** Returns ms since the run started on the server clock, or null before it starts. */
  elapsed: () => number | null = () => null;
  private frozenMult: number | null = null;
  private s = 0;
  private speed = 0;
  private yawPrev = 0;
  private timeScale = 1;
  private worldT = 0;
  private fx = { danger: 0, cold: 0, gold: 0, flash: 0, fade: 0, bloom: 0 };
  private tremorIn = 4;
  private cosmetic = new Rng(1);
  private qualityLevel: QualityLevel;
  private fading: { dir: 1 | -1; done?: () => void } | null = null;
  private frameTimes: number[] = [];
  onQualityDrop: (to: QualityLevel) => void = () => {};
  autoQuality = true;
  motion: 'full' | 'reduced' = 'full';

  /** Live readout for the HUD (read by rAF in the UI, never through React state). */
  readonly live = { mult: 1, intensity: 0, speed: 0, distance: 0 };

  private constructor(
    private canvas: HTMLCanvasElement,
    quality: QualityLevel,
  ) {
    this.qualityLevel = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.rig = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.rig.constrain = (p) => this.corridor(p);
  }

  static async create(canvas: HTMLCanvasElement, quality: QualityLevel, onProgress: (p: number, label: string) => void): Promise<Game> {
    const g = new Game(canvas, quality);
    await g.init(onProgress);
    return g;
  }

  private async init(onProgress: (p: number, label: string) => void) {
    onProgress(0.02, 'Unearthing the ruins');
    this.kit = await loadKit((a, b) => onProgress(0.05 + 0.65 * (a / b), 'Unearthing the ruins'));
    const q = QUALITY[this.qualityLevel];
    const { scene, kit } = this;

    scene.background = kit.backdrop;
    kit.backdrop.mapping = THREE.EquirectangularReflectionMapping;
    scene.backgroundIntensity = 1.0;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromEquirectangular(kit.env).texture;
    scene.environmentIntensity = 0.5;
    pmrem.dispose();
    scene.fog = new THREE.FogExp2(0xd3b690, 0.0036);

    this.sunDir.copy(kit.sunDir);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.035;
    const sc = this.sun.shadow.camera;
    sc.left = -26;
    sc.right = 26;
    sc.top = 26;
    sc.bottom = -26;
    sc.near = 1;
    sc.far = 140;
    scene.add(this.sun, this.sun.target);
    // The sun disc itself, hot enough to bloom.
    const sunDisc = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0;
          float core = smoothstep(0.16, 0.12, d) * 7.0;
          float halo = exp(-d * 5.0) * 0.9 + exp(-d * 14.0) * 1.6;
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.64) * (core + halo), 1.0); }`,
      }),
    );
    sunDisc.name = 'sunDisc';
    this.sunDisc = sunDisc;
    scene.add(sunDisc);

    this.water = new Water(kit.backdrop, this.sunDir);
    scene.add(this.water.mesh);
    this.track = new Track(kit);
    scene.add(this.track.root);
    this.debris = new Debris(kit);
    this.debris.onImpact = (e) => this.onDebrisImpact(e);
    scene.add(this.debris.root);
    this.runner = new Runner(kit);
    this.runner.onFootstep = (foot, k) => this.footstep(foot, k);
    scene.add(this.runner.root);
    scene.add(this.particles.points, this.motes.points);

    onProgress(0.72, 'Laying the causeway');
    await this.track.prepare({ foliage: q.foliageDensity, scenery: q.sceneryDensity }, (i, n) => onProgress(0.72 + 0.23 * (i / n), 'Laying the causeway'));
    this.post = new Post(this.renderer, scene, this.rig.camera, q);
    this.applyQuality(this.qualityLevel, false);
    this.newWorld('title');
    this.resize();
    onProgress(0.97, 'Lighting the way');
    // Compile every program now so the first collapse does not hitch.
    const probe = this.debris.spawn('gate_0', new THREE.Matrix4().makeTranslation(0, -50, 0), new THREE.Vector3(), new THREE.Vector3(), () => null);
    this.debris.spawn('rock_mid_0', new THREE.Matrix4().makeTranslation(0, -50, 0), new THREE.Vector3(), new THREE.Vector3(), () => null);
    await this.renderer.compileAsync(scene, this.rig.camera);
    this.debris.clear();
    void probe;
    onProgress(1, 'Ready');
    document.addEventListener('visibilitychange', this.onVisibility);
    this.clock.start();
    this.loop();
  }

  private sunDisc!: THREE.Mesh;

  private onVisibility = () => {
    this.visible = document.visibilityState === 'visible';
    if (this.visible) this.clock.getDelta();
  };

  // ------------------------------------------------------------------ quality
  applyQuality(level: QualityLevel, rebuildTrack = true): void {
    this.qualityLevel = level;
    const q = QUALITY[level];
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    this.track.viewDistance = q.viewDistance;
    this.particles.budget = q.dust;
    this.water.setDetail(q.waterDetail);
    this.post.build(q);
    this.resize();
    if (rebuildTrack) {
      void this.track.prepare({ foliage: q.foliageDensity, scenery: q.sceneryDensity }).then(() => {
        if (this.stage === 'title' || this.stage === 'setup') this.newWorld(this.stage);
      });
    }
    this.frameTimes.length = 0;
  }

  get quality(): QualityLevel {
    return this.qualityLevel;
  }

  resize = (): void => {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, QUALITY[this.qualityLevel].pixelRatioCap);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.rig.setAspect(w / h);
    this.particles.setViewport(h * pr, this.rig.camera.fov);
  };

  // ------------------------------------------------------------------ stages
  /** A fresh stretch of causeway with the runner at its start. */
  private newWorld(stage: 'title' | 'setup'): void {
    const seed = `${Date.now()}-${Math.random()}`;
    this.cosmetic = new Rng(seed);
    this.track.reset(seed);
    this.debris.clear();
    this.particles.clear();
    this.queue.length = 0;
    this.s = 0;
    this.speed = 0;
    this.frozenMult = null;
    this.fx.cold = 0;
    this.fx.gold = 0;
    this.fx.danger = 0;
    this.runner.play('idle', 0);
    this.runner.resetSecondary();
    this.slowmo = null;
    this.timeScale = 1;
    this.setStage(stage);
    this.placeRunner(0);
    const f = this.track.path.sample(0);
    this.rig.snap(f.pos, f.yaw);
  }

  private setStage(s: Stage) {
    this.stage = s;
    this.stageT = 0;
    this.rig.setMode(s);
  }

  toTitle(): void {
    if (this.stage === 'crash' || this.stage === 'cashout') this.fadeThrough(() => this.newWorld('title'));
    else this.setStage('title');
  }

  /** Bet setup. After a finished run the world resets behind a short fade; returns when ready. */
  toSetup(): Promise<void> {
    return new Promise((resolve) => {
      if (this.stage === 'crash' || this.stage === 'cashout') {
        this.fadeThrough(() => {
          this.newWorld('setup');
          resolve();
        });
      } else {
        this.setStage('setup');
        this.runner.play('idle', 0.4);
        resolve();
      }
    });
  }

  private fadeThrough(mid: () => void): void {
    this.fading = { dir: 1, done: mid };
  }

  /** The bet is accepted: coil, then go when the server clock says so. */
  lead(): void {
    this.frozenMult = null;
    this.live.mult = 1;
    this.setStage('lead');
    this.runner.play('ready', 0.3);
    this.sounds.whoosh();
  }

  /** The way falls. `mult` is the crash point, now public. */
  crash(mult: number, roundId: string, forceKind?: 'chasm' | 'gate' | 'rockfall'): void {
    this.frozenMult = mult;
    this.live.mult = mult / 100;
    const r = new Rng(`${roundId}/staging`);
    const sec = this.track.sectionAt(this.s);
    const hazards = sec?.layout.hazards ?? ['rockfall'];
    const kind = forceKind ?? (this.stage === 'lead' || this.speed < 2 ? 'gate' : r.pick(hazards));
    this.setStage('crash');
    this.runner.play(kind === 'rockfall' ? 'fall_rock' : kind === 'chasm' ? 'fall_chasm' : 'fall_gate', 0.12);
    this.crashKind = kind;
    this.stageCrash(kind, r);
    this.sounds.crash(kind);
  }

  private crashKind = 'gate';

  cashout(): void {
    const v = this.speed;
    this.setStage('cashout');
    this.runner.play('win', 0.2);
    // Run out of it in about three quarters of a second.
    this.setStop(this.s + (v * 0.72) / 2);
    this.sounds.escape();
    this.fx.flash = 0.18;
    this.rig.setMode('cashout', { side: this.cosmetic.chance(0.5) ? 1 : -1 });
    // A held breath on the moment of escape.
    if (v > 3) this.slowmo = { t: 0, dur: 1.0, min: 0.6 };
  }

  /** Decelerate uniformly to stand at `sStop` (presentation only). */
  private setStop(sStop: number): void {
    this.stopAt = Math.max(this.s, sStop);
    const d = Math.max(0.01, this.stopAt - this.s);
    this.stopDecel = (this.speed * this.speed) / (2 * d);
  }
  private stopAt = 0;
  private stopDecel = 0;

  /** Keep a camera position inside the open corridor: between the walls (below their tops) and above the floor. */
  private cframe = { pos: new THREE.Vector3(), yaw: 0 };
  private corridor(p: THREE.Vector3): void {
    if (!this.track || !this.runner) return;
    const rp = this.runner.root.position;
    const ry = this.runner.root.rotation.y;
    const along = (p.x - rp.x) * -Math.sin(ry) + (p.z - rp.z) * -Math.cos(ry);
    const s = this.s + THREE.MathUtils.clamp(along, -30, 30);
    const f = this.track.path.sample(s, this.cframe);
    const rx = Math.cos(f.yaw);
    const rz = -Math.sin(f.yaw);
    const lat = (p.x - f.pos.x) * rx + (p.z - f.pos.z) * rz;
    const h = p.y - f.pos.y;
    const walls = this.track.sectionAt(s)?.layout.walls ?? 'low';
    const top = walls === 'tall' || walls === 'cliff' ? 6.4 : walls === 'low' ? 2.2 : 0;
    const lim = h < top ? PATH_HALF - 0.3 : walls === 'none' ? PATH_HALF + 0.4 : Infinity;
    if (Math.abs(lat) > lim) {
      const d = Math.sign(lat) * lim - lat;
      p.x += rx * d;
      p.z += rz * d;
    }
    p.y = Math.max(p.y, f.pos.y + 0.45);
  }

  // ------------------------------------------------------------------ crash staging
  /**
   * A tile's true span along the route, from its world matrix. (Track's recorded sNear/sFar can be a
   * tile off for half-turned tiles when the Euler decomposition lands on (π, 0, π); measuring the
   * tile's centre directly avoids collapsing the slab under the runner's feet.)
   */
  private tileSpan(t: { world: THREE.Matrix4; sNear: number; sFar: number }): [number, number] {
    const e = t.world.elements;
    const o = new THREE.Vector3(e[12], e[13], e[14]);
    const d = new THREE.Vector3(-e[8], -e[9], -e[10]).normalize();
    const c = o.addScaledVector(d, 2);
    const mid = (t.sNear + t.sFar) / 2;
    const f = this.track.path.sample(mid);
    const sc = mid + (c.x - f.pos.x) * -Math.sin(f.yaw) + (c.z - f.pos.z) * -Math.cos(f.yaw);
    return [sc - 2, sc + 2];
  }

  private collapsible(t: { piece: string; alive: boolean }): boolean {
    return t.alive && t.piece !== 'floor_wide_0' && !t.piece.startsWith('stairs');
  }

  /** The start of the first collapsible tile starting within [sMin, sMax] (tile seams make clean edges). */
  private tileEdge(sMin: number, sMax: number): number | null {
    let best: number | null = null;
    for (const sec of this.track.sections) {
      for (const t of sec.tiles) {
        if (!this.collapsible(t)) continue;
        const n = this.tileSpan(t)[0];
        if (n >= sMin && n <= sMax && (best === null || n < best)) best = n;
      }
    }
    return best;
  }

  /** Drop every collapsible tile that starts at or beyond `edge` (up to `to`); returns them for debris. */
  private collapseFrom(edge: number, to: number): { piece: string; world: THREE.Matrix4 }[] {
    const out: { piece: string; world: THREE.Matrix4 }[] = [];
    const tiles = (this.track as unknown as { tiles: { hide(t: unknown): void } }).tiles;
    for (const sec of this.track.sections) {
      for (const t of sec.tiles) {
        if (!this.collapsible(t)) continue;
        const n = this.tileSpan(t)[0];
        if (n < edge - 0.3 || n > to) continue;
        t.alive = false;
        tiles.hide(t);
        out.push({ piece: t.piece, world: t.world });
      }
    }
    return out;
  }

  /**
   * Stage the fall. Everything here is presentation chosen after the outcome is
   * known (kind and details come from an RNG seeded by the round id): the runner
   * brakes to a mark, the hazard is timed to meet them there, and the camera,
   * slow motion, dust and debris are choreographed around that beat.
   */
  private stageCrash(kind: string, r: Rng): void {
    const v = this.speed;
    const sec = this.track.sectionAt(this.s);
    const openSide = sec?.layout.walls === 'cliff' ? (sec.mirror ? 1 : -1) : r.chance(0.5) ? 1 : -1;
    this.timeScale = 1;
    const shot = kind === 'chasm' ? 'chasm' : kind === 'rockfall' ? 'rockfall' : 'gate';
    this.rig.setMode('crash', { side: openSide, shot });

    const frameAt = (s: number) => {
      const f = this.track.path.sample(s);
      return { pos: f.pos.clone(), yaw: f.yaw, fwd: forward(f.yaw), right: new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw)) };
    };
    const onPath = (at: { pos: THREE.Vector3; right: THREE.Vector3 }) => (x: number, z: number) => {
      const lateral = Math.abs((x - at.pos.x) * at.right.x + (z - at.pos.z) * at.right.z);
      return lateral < PATH_HALF + 0.2 ? at.pos.y : null;
    };

    if (kind === 'chasm') {
      // Skid to the lip of a tile seam; the floor beyond drops away from the edge outwards.
      const want = this.s + (v * 0.45) / 2 + 0.55;
      const edge = this.tileEdge(Math.max(this.s + 1.4, want - 2.2), want + 4) ?? want;
      this.setStop(edge - 0.5);
      const h = frameAt(edge);
      this.rig.focus.copy(h.pos).addScaledVector(h.fwd, 2).setY(h.pos.y + 0.2);
      const tiles = this.collapseFrom(edge, edge + 16);
      const dist = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m).distanceTo(h.pos);
      tiles.sort((a, b) => dist(a.world) - dist(b.world));
      tiles.forEach((t, i) => {
        this.later(0.08 + i * 0.07, () => {
          this.debris.spawn(t.piece, t.world, new THREE.Vector3(r.range(-0.6, 0.6), r.range(-1.5, 0), r.range(-0.6, 0.6)), new THREE.Vector3(r.range(-1.2, 1.2), r.range(-0.3, 0.3), r.range(-1.2, 1.2)), () => null);
          const p = new THREE.Vector3().setFromMatrixPosition(t.world);
          this.particles.burst(p.setY(p.y + 0.1), 14, { spread: 4, up: 1.4, speed: 2.6, size: 1.0, life: 2.2, color: DUST, alpha: 0.3 });
          if (i < 3) this.rig.addTrauma(0.25);
        });
      });
      // Grit pours off the broken lip for a while.
      for (let k = 0; k < 10; k++) {
        this.later(0.2 + k * 0.18, () => {
          const p = h.pos.clone().addScaledVector(h.right, r.range(-PATH_HALF, PATH_HALF)).setY(h.pos.y - 0.05);
          this.particles.burst(p, 4, { spread: 0.4, up: 0.1, speed: 0.4, size: 0.18, life: 1.4, color: DUST_DARK, alpha: 0.45, gravity: 6 });
        });
      }
      // Loose blocks from the walls go with it.
      for (let k = 0; k < 6; k++) {
        const side = k % 2 ? 1 : -1;
        const p = h.pos.clone().addScaledVector(h.fwd, r.range(1, 9)).addScaledVector(h.right, side * r.range(2.5, 3.2)).setY(h.pos.y + r.range(0.8, 1.6));
        this.later(0.3 + k * 0.12, () =>
          this.debris.spawn(`rubble_${r.int(0, 1)}`, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z), h.fwd.clone().multiplyScalar(r.range(-1, 1)).addScaledVector(h.right, -side * r.range(0.5, 2)), new THREE.Vector3(r.range(-3, 3), r.range(-3, 3), r.range(-3, 3)), () => null, { scale: r.range(0.5, 0.9) }),
        );
      }
      this.rig.addTrauma(0.55);
      this.fx.flash = 0.2;
      this.sounds.impact(1, false);
      // Slow motion lands on the teeter at the edge.
      this.slowmo = { t: -0.25, dur: 1.9, min: 0.33 };
    } else if (kind === 'gate') {
      // Brake hard; the slab drops to meet the runner as they reach it.
      const T = 0.3;
      const stop = this.s + (v * T) / 2;
      const gateS = Math.max(this.s + 1.5, stop + 0.5);
      this.setStop(gateS - 0.5);
      const h = frameAt(gateS);
      this.rig.focus.copy(h.pos).setY(h.pos.y + 1.6);
      const land = Math.max(0.24, T);
      const h0 = 7.5;
      const v0 = (h0 - 9.5 * land * land) / land;
      const m = new THREE.Matrix4().compose(h.pos.clone().setY(h.pos.y + h0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.yaw), new THREE.Vector3(1, 1, 1));
      this.debris.spawn('gate_0', m, new THREE.Vector3(0, -v0, 0), new THREE.Vector3(), (x, z) => onPath(h)(x, z) ?? h.pos.y, { settle: true, heavy: true });
      this.gateLand = { at: h.pos.clone(), done: false };
      this.fx.flash = 0.06;
      // Dust from the lintel as it starts to move.
      this.particles.burst(h.pos.clone().setY(h.pos.y + 5.5), 10, { spread: 3.5, up: 0.2, speed: 0.6, size: 0.5, life: 1.8, color: DUST, alpha: 0.35, gravity: 2 });
      this.later(land, () => {
        // The slam: a sheet of dust rolls out along the floor both ways, grit rains from above.
        for (let k = -3; k <= 3; k++) {
          const p = h.pos.clone().addScaledVector(h.right, k * 0.7).addScaledVector(h.fwd, -0.4).setY(h.pos.y + 0.05);
          this.particles.burst(p, 7, { spread: 0.8, up: 0.8, speed: 4.5, size: 0.9, life: 2.4, color: DUST, alpha: 0.34, drag: 1.4 });
        }
        for (let k = 0; k < 4; k++) {
          const p = h.pos.clone().addScaledVector(h.right, r.range(-1.8, 1.8)).addScaledVector(h.fwd, -0.6).setY(h.pos.y + r.range(3.5, 5));
          const sc = r.range(0.12, 0.22);
          this.debris.spawn('debris_0', new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)), h.fwd.clone().multiplyScalar(-r.range(0.3, 1.2)), new THREE.Vector3(3, 2, 1), onPath(h));
        }
        this.rig.addTrauma(0.7);
        this.fx.flash = 0.16;
      });
      this.slowmo = { t: -0.1, dur: 1.5, min: 0.3 };
    } else {
      // Rockfall: the first block drops square in the way as the runner flinches; the rest follow.
      const T = 0.4;
      const stop = this.s + (v * T) / 2;
      this.setStop(stop);
      const h = frameAt(stop + 1.4);
      this.rig.focus.copy(h.pos).setY(h.pos.y + 0.8);
      const pieces = ['rock_mid_0', 'rock_mid_1', 'rock_mid_2', 'rubble_3', 'rubble_2', 'drum_0'];
      const drop = (delay: number, along: number, lat: number, piece: string, sc: number, hStart: number, land: number) => {
        const at = frameAt(stop + along);
        const p = at.pos.clone().addScaledVector(at.right, lat).setY(at.pos.y + hStart);
        const v0 = Math.max(2, (hStart - 9.5 * land * land) / land);
        const m = new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(r.range(0, 6), r.range(0, 6), r.range(0, 6))), new THREE.Vector3(sc, sc, sc));
        this.later(delay, () => {
          this.debris.spawn(piece, m, new THREE.Vector3(-at.right.x * lat * 0.25, -v0, -at.right.z * lat * 0.25).addScaledVector(at.fwd, r.range(-0.5, 0.5)), new THREE.Vector3(r.range(-2.5, 2.5), r.range(-2, 2), r.range(-2.5, 2.5)), onPath(at));
          this.particles.burst(p, 6, { spread: 1, up: 0.2, speed: 0.6, size: 0.45, life: 1.5, color: DUST, alpha: 0.3, gravity: 3 });
        });
      };
      drop(0, 1.4, r.range(-0.4, 0.4), 'rock_mid_1', 0.75, 8, 0.32);
      for (let k = 0; k < 9; k++) {
        const along = r.range(-1.5, 9);
        // Never on the runner: anything near their mark lands well to the side.
        const lat = Math.abs(along) < 1.6 ? (r.chance(0.5) ? 1 : -1) * r.range(1.4, 3.6) : r.range(-3.6, 3.6);
        const piece = r.pick(pieces);
        const sc = piece.startsWith('rock') ? r.range(0.4, 0.75) : r.range(0.8, 1.2);
        drop(0.12 + k * r.range(0.08, 0.16), along, lat, piece, sc, r.range(9, 15), r.range(0.8, 1.2));
      }
      // Dust curtains pour off the wall tops.
      for (let k = 0; k < 8; k++) {
        this.later(k * 0.12, () => {
          const at = frameAt(stop + r.range(-2, 8));
          const side = r.chance(0.5) ? 1 : -1;
          const p = at.pos.clone().addScaledVector(at.right, side * r.range(2.4, 3.2)).setY(at.pos.y + r.range(3, 5.5));
          this.particles.burst(p, 8, { spread: 0.8, up: 0.1, speed: 0.4, size: 0.55, life: 2.2, color: DUST, alpha: 0.38, gravity: 2.2 });
        });
      }
      this.rig.addTrauma(0.4);
      this.slowmo = { t: -0.08, dur: 1.5, min: 0.35 };
    }
  }

  private gateLand: { at: THREE.Vector3; done: boolean } | null = null;
  private queue: { at: number; fn: () => void }[] = [];
  /** Run `fn` after `delay` seconds of presentation time (slow motion slows it too). */
  private later(delay: number, fn: () => void) {
    this.queue.push({ at: this.worldT + delay, fn });
  }
  /** Presentation slow motion: `t` counts real seconds (negative = not started yet). */
  private slowmo: { t: number; dur: number; min: number } | null = null;

  private onDebrisImpact(e: { pos: THREE.Vector3; speed: number; water: boolean; mass: number }) {
    const big = Math.min(1.5, e.mass * (e.speed / 12));
    if (e.water) {
      this.particles.burst(e.pos, 16 + big * 20, { spread: 1.2 + big, up: 5 + big * 3, speed: 2.5, size: 0.45, life: 1.1, color: SPRAY, alpha: 0.7, gravity: 9, drag: 0.6, grow: 0.8 });
      this.sounds.impact(big * 0.7, true);
    } else {
      this.particles.burst(e.pos, 8 + big * 16, { spread: 1.5 + big * 2, up: 1.6, speed: 4 + big * 3, size: 0.9 + big * 0.8, life: 2.2, color: DUST, alpha: 0.32 });
      this.rig.addTrauma(Math.min(0.6, big * 0.4));
      this.sounds.impact(big, false);
    }
  }

  // ------------------------------------------------------------------ frame
  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible || this.paused) return;
    const rawDt = Math.min(this.clock.getDelta(), 0.05);
    this.frame(rawDt);
  };

  private footstep(foot: 'L' | 'R', k: number) {
    const f = this.track.path.sample(this.s);
    const side = new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw)).multiplyScalar(foot === 'L' ? -0.13 : 0.13);
    const p = this.runner.root.position.clone().add(side);
    const wood = this.track.sectionAt(this.s)?.type === 'bridge';
    const skid = this.stage === 'crash';
    this.particles.burst(p, (1 + k * 2) * (skid ? 3 : 1), { spread: skid ? 0.5 : 0.2, up: 0.35 + k * 0.4, speed: (0.6 + k * 0.6) * (skid ? 2 : 1), size: (0.1 + k * 0.08) * (skid ? 2 : 1), life: skid ? 1.2 : 0.7, color: wood ? DUST_DARK : DUST, alpha: skid ? 0.24 : 0.16, grow: 1.4 });
    this.sounds.footstep(k, wood ? 'wood' : 'stone');
    this.rig.footfall(k, foot);
  }

  private placeRunner(dt: number) {
    const f = this.track.path.sample(this.s);
    this.runner.root.position.copy(f.pos);
    this.runner.root.rotation.y = f.yaw;
    if (dt > 0) {
      const yawRate = (f.yaw - this.yawPrev) / dt;
      this.runner.roll = THREE.MathUtils.clamp(-yawRate * this.speed * 0.05, -0.3, 0.3);
    }
    this.yawPrev = f.yaw;
  }

  private frame(rawDt: number, render = true): void {
    const t0 = performance.now();
    // Presentation time can slow down; the round clock never does.
    if (this.slowmo) {
      this.slowmo.t += rawDt;
      const x = Math.max(0, this.slowmo.t) / this.slowmo.dur;
      const reduced = this.motion === 'reduced';
      this.timeScale = reduced ? 1 : x < 0.15 ? THREE.MathUtils.lerp(1, this.slowmo.min, x / 0.15) : THREE.MathUtils.lerp(this.slowmo.min, 1, Math.min(1, (x - 0.15) / 0.85) ** 2);
      if (x >= 1) {
        this.slowmo = null;
        this.timeScale = 1;
      }
    }
    const dt = rawDt * this.timeScale;
    this.stageT += rawDt;
    this.worldT += dt;

    // Multiplier → intensity → speed.
    let mult = 1;
    const el = this.elapsed();
    if (this.frozenMult !== null) mult = this.frozenMult / 100;
    else if ((this.stage === 'run' || this.stage === 'lead') && el !== null && el >= 0) {
      mult = multiplierAtSmooth(el);
      if (this.stage === 'lead') {
        // Go: the runner bursts out of the crouch, the lens punches in.
        this.setStage('run');
        this.runner.play('run', 0.12);
        this.rig.kick(6);
        this.rig.addTrauma(0.08);
      }
    }
    if (this.stage === 'cashout' || this.stage === 'crash') mult = this.live.mult;
    const I = intensityOf(mult);
    if (this.stage === 'run' || this.stage === 'lead') {
      this.live.mult = mult;
      this.live.intensity = I;
    }

    // Kinematics. Crash and cash-out brake uniformly to a staged mark.
    if (this.stage === 'crash' || this.stage === 'cashout') {
      const rem = Math.max(0, this.stopAt - this.s);
      this.speed = Math.min(this.speed, Math.sqrt(2 * this.stopDecel * rem));
      this.s = Math.min(this.stopAt, this.s + this.speed * dt);
    } else {
      const target = this.stage === 'run' ? speedOf(I) : 0;
      const dv = target - this.speed;
      this.speed += Math.sign(dv) * Math.min(Math.abs(dv), 6 * dt * (this.stage === 'run' && this.stageT < 1 ? 1.4 : 1));
      this.s += this.speed * dt;
    }
    this.live.speed = this.speed;
    this.live.distance = this.s;
    this.track.update(this.s, I);
    this.placeRunner(dt);
    this.runner.lean = this.stage === 'run' ? 0.04 * I : 0;
    // Stairs: the path grade under the runner (they lean into a climb, sit back on a descent).
    if (this.stage === 'run') {
      const ya = this.track.path.sample(this.s + 0.7, this.cframe).pos.y;
      const yb = this.track.path.sample(this.s - 0.7, this.cframe).pos.y;
      this.runner.slope = (ya - yb) / 1.4;
    } else this.runner.slope = 0;
    this.runner.update(dt, this.speed);
    // Braking: the soles scour the floor.
    if (this.stage === 'crash' && this.speed > 1.5) {
      const rp0 = this.runner.root.position;
      this.particles.burst(rp0.clone().setY(rp0.y + 0.03), 1.5 * Math.min(1, this.speed / 8), { spread: 0.35, up: 0.5, speed: 1.2, size: 0.28, life: 0.9, color: DUST, alpha: 0.22, grow: 1.6 });
    }

    // Danger cues follow the multiplier only; they never know where the round ends.
    if (this.stage === 'run' && I > 0.35) {
      this.tremorIn -= dt;
      if (this.tremorIn <= 0) {
        this.tremorIn = this.cosmetic.range(2.2, 6.5) * (1.3 - I);
        this.tremor(I);
      }
    }
    const dangerTarget = this.stage === 'run' ? Math.max(0, (I - 0.35) / 0.65) * 0.55 : 0;
    this.fx.danger += (dangerTarget - this.fx.danger) * (1 - Math.exp(-dt * 2));
    const coldTarget = this.stage === 'crash' ? Math.min(0.85, this.stageT * 0.7) : 0;
    this.fx.cold += (coldTarget - this.fx.cold) * (1 - Math.exp(-rawDt * 3));
    const goldTarget = this.stage === 'cashout' ? (this.stageT < 1 ? 0.55 : 0.3) : 0;
    this.fx.gold += (goldTarget - this.fx.gold) * (1 - Math.exp(-rawDt * 3));
    this.fx.flash *= Math.exp(-rawDt * 6);
    this.fx.bloom = this.stage === 'cashout' ? 0.3 * Math.exp(-this.stageT * 1.2) : this.fx.danger * 0.25;

    if (this.gateLand && !this.gateLand.done && this.stageT > 0.9) this.gateLand.done = true;

    // Fade transitions.
    if (this.fading) {
      this.fx.fade += this.fading.dir * rawDt * 3.2;
      if (this.fading.dir === 1 && this.fx.fade >= 1) {
        this.fx.fade = 1;
        this.fading.done?.();
        this.fading = { dir: -1 };
      } else if (this.fading.dir === -1 && this.fx.fade <= 0) {
        this.fx.fade = 0;
        this.fading = null;
      }
    }

    // Camera.
    const rp = this.runner.root.position;
    this.rig.shakeEnabled = this.motion === 'full';
    this.rig.motionScale = this.motion === 'full' ? 1 : 0.25;
    this.rig.update(rawDt * (this.stage === 'crash' || this.stage === 'cashout' ? Math.max(this.timeScale, 0.55) : 1), rp, this.runner.root.rotation.y, this.stage === 'run' ? I : 0);
    const cam = this.rig.camera;

    // Sun follows the runner so its shadow box stays tight.
    this.sun.target.position.copy(rp);
    this.sun.position.copy(rp).addScaledVector(this.sunDir, 70);
    this.sunDisc.position.copy(cam.position).addScaledVector(this.sunDir, 900);
    this.sunDisc.lookAt(cam.position);

    wind.uTime.value = this.worldT;
    wind.uStrength.value = 1 + I * 0.8;
    this.water.update(this.worldT, cam);
    this.track.tick(this.worldT);
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i]!.at <= this.worldT) {
        const q = this.queue.splice(i, 1)[0]!;
        q.fn();
      }
    }
    this.debris.update(dt);
    this.particles.update(dt);
    this.motes.update(this.worldT, cam, this.renderer.domElement.height / (2 * Math.tan((cam.fov * Math.PI) / 360)), 1);

    // Keep the runner sharp in the blur: project the chest to screen.
    const chest = rp.clone().setY(rp.y + 1.05).project(cam);
    const speedBlur = this.motion === 'reduced' ? 0 : Math.min(1, Math.max(0, (this.speed - 4) / 10));
    this.post.apply({
      speed: speedBlur,
      runnerScreen: new THREE.Vector2(chest.x * 0.5 + 0.5, chest.y * 0.5 + 0.5),
      danger: this.fx.danger,
      cold: this.fx.cold,
      gold: this.fx.gold,
      flash: this.fx.flash,
      fade: this.fx.fade,
      bloomBoost: this.fx.bloom,
    });
    this.sounds.run(I, this.stage === 'run', this.speed);
    if (!render) return;
    this.renderer.info.reset();
    this.post.render(rawDt);
    this.govern(performance.now() - t0, rawDt);
  }

  private tremor(I: number) {
    this.rig.addTrauma(0.12 + I * 0.25);
    this.sounds.tremor(I);
    // Grit and small stones shaken loose ahead, off the walls.
    const f = this.track.path.sample(this.s + this.cosmetic.range(6, 14));
    const rightV = new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
    for (let k = 0; k < 2 + Math.round(I * 3); k++) {
      const side = this.cosmetic.chance(0.5) ? 1 : -1;
      const p = f.pos.clone().addScaledVector(rightV, side * this.cosmetic.range(2.3, 3.5)).setY(f.pos.y + this.cosmetic.range(2.5, 5));
      this.particles.burst(p, 6, { spread: 0.6, up: 0.2, speed: 0.5, size: 0.35, life: 1.6, color: DUST, alpha: 0.4, gravity: 3 });
      const sc = this.cosmetic.range(0.12, 0.28);
      this.debris.spawn('debris_0', new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)), rightV.clone().multiplyScalar(-side * this.cosmetic.range(0.2, 1.2)), new THREE.Vector3(3, 2, 1), () => (Math.abs(p.y) < 100 ? f.pos.y : null));
    }
  }

  private govern(ms: number, dt: number) {
    if (!this.autoQuality) return;
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length < 180) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const order: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
    const i = order.indexOf(this.qualityLevel);
    if (avg > 26 && i > 0) {
      const to = order[i - 1]!;
      this.applyQuality(to, false);
      this.onQualityDrop(to);
    }
    void ms;
  }

  /**
   * For QA and screenshots on slow (software) GPUs: advance presentation time in
   * fixed steps without drawing, on a virtual round clock, then draw once.
   */
  debugStep(seconds: number, fps = 30): void {
    this.paused = true;
    const n = Math.round(seconds * fps);
    for (let i = 0; i < n; i++) {
      this.virtualNow += 1000 / fps;
      this.frame(1 / fps, i === n - 1);
    }
  }
  virtualNow = 0;
  paused = false;

  /** For QA: jump the runner along the route to exercise generation. */
  debugAdvance(metres: number): void {
    this.s += metres;
    this.track.update(this.s, 0.5);
  }

  /** Triangles by mesh name, split into what the camera sees and what it does not. */
  debugTriangles() {
    const cam = this.rig.camera;
    cam.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const out: Record<string, { visible: number; hidden: number; shadow: number }> = {};
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry.index) return;
      let tris = m.geometry.index.count / 3;
      if ((m as THREE.InstancedMesh).isInstancedMesh) tris *= (m as THREE.InstancedMesh).count;
      const key = m.name.split(':')[0]!.split('|').join('.') || 'anon';
      out[key] ??= { visible: 0, hidden: 0, shadow: 0 };
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const sph = m.geometry.boundingSphere!.clone().applyMatrix4(m.matrixWorld);
      const vis = !m.frustumCulled || fr.intersectsSphere(sph);
      out[key]![vis ? 'visible' : 'hidden'] += tris;
      if (m.castShadow) out[key]!.shadow += tris;
    });
    return out;
  }

  get debugState() {
    return { s: this.s, sections: this.track.sections.length, debris: this.debris.count, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles, stage: this.stage, crashKind: this.crashKind };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.dispose();
  }
}
