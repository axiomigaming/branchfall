/**
 * The stage: the Understory, drawn.
 *
 * This is the presentation layer and nothing else. It is handed a scene — which
 * arena, which lane each runner is on, who is running, who fell, who is home —
 * and it draws and animates that. It never decides any of it. `docs/DESIGN.md`
 * §6.9 states the rule the whole file is built to keep: *"The renderer is a
 * player, not a judge."* There is no probability, no draw and no credit in here,
 * and the only inputs are the resolution the server already committed to.
 *
 * ## What it is drawing, and why it looks like this
 *
 * §6.1: *"Ten percent of the frame is warm. Ninety percent is not. That ratio is
 * the art direction; everything else is detail."* Every colour below is a §6.1
 * token, and the only saturated ones in the file are the four the emissive budget
 * in §6.2 permits: a lantern flame, the Lamp House interior, the Crown Lamp, and
 * The Char's crack network. Nothing else emits. The fog, the stone and the
 * figures are all cool, and the figures are silhouettes with a warm rim on the
 * lantern side — which is §6.6's first reference (*"a lantern procession
 * photographed at dusk in heavy fog"*) reduced to the one thing it is for: a
 * single warm point can carry an entire composition.
 *
 * §6.7 gives each of the five arenas a brief, and each one is here as a theme: the
 * horizontal wet bough with lanterns doubled in standing water, the converging
 * grain ridges you can see through, the raked windward ledge with fog ribbons
 * streaming across it, the shattered vitrified char with embers drifting upward,
 * and the pale thin crown with the Lamp on screen from the first frame.
 *
 * §6.4 is the motion, and two of its rules are structural here:
 *
 * - **Hybrid frame rate.** Root motion and camera run at full frame rate;
 *   secondary motion — cloth, reed sway, lantern swing — is stepped to 12 fps on
 *   a clock quantised in *time*, so a 30 fps device lands on the same phase as a
 *   60 fps one. `stepped()` in `motion.ts` is that clock.
 * - **Falls are weighted-light.** 0.7 g for the first 400 ms so the fall registers
 *   and the lantern arcs legibly, then full gravity. The ragdoll never flails
 *   comically: rotation is clamped, and the figure keeps reaching.
 *
 * ## What it costs
 *
 * §6.8's budgets are for the build that has a renderer and an asset set in it;
 * this is a canvas, so none of those numbers apply to it. What does apply is the
 * frame budget: everything static is rendered once into an offscreen canvas and
 * blitted, every glow is a pre-rendered sprite drawn with `drawImage` rather than
 * a gradient built per frame, the fog is three blits of one tiling texture, and
 * the whole thing runs on the single `requestAnimationFrame` loop in `motion.ts`
 * which stops dead when the tab is hidden. A frame is a handful of `drawImage`
 * calls and one path per figure.
 */
import { calm, hash01, onCalmChange, onFrame, outCubic, stepped } from './motion.js';

/* ------------------------------------------------------------------ palette */

/** §6.1, verbatim. Nothing in this file mixes a colour that is not from here. */
const C = {
  void: '#0e1114',
  night: '#1a2026',
  fogMid: '#38434b',
  fogFar: '#8a98a0',
  mist: '#d6dde0',
  barkDeep: '#2b231c',
  bark: '#4a3a2c',
  barkLit: '#7a6248',
  fossil: '#d8cfbb',
  lampCore: '#ffe7be',
  lamp: '#ffa53d',
  ember: '#d2621c',
  brass: '#c9a227',
  extinguish: '#5a4e63',
} as const;

/** The deep silhouette value the figures and the stone are cut out of. */
const SILHOUETTE = '#12161a';

/**
 * How far below the broad limb the thin limb of a fork runs.
 *
 * §6.7 hand-builds every fork and requires that *"every fork must read at a glance
 * as one broad limb and one thin limb, because the fork balance is a player
 * decision and the level has to show the player what they are choosing between"*.
 * A fraction of frame height, so the separation is the same read on the 96 px
 * decision band and on the full-bleed run.
 */
const THIN_LIMB_DROP = 0.13;

/** Where along the branch the Lamp House stands, so the runners have somewhere to go. */
const DOOR_U = 0.72;

/**
 * §S5's door beat, in milliseconds, and the reason it is published.
 *
 * *"The Lamp House door opens, the chosen lanterns go inside, the brass bell
 * strikes once, and the saved lights stack into a small constellation above the
 * door."* That is four events in a fixed order, and the screen above the stage
 * has to arrive on the same ones: the hero figure lands on the bell, the copy
 * arrives after the constellation, and the exit control is not drawn until the
 * beat is over (`DESIGN.md` §9 — the rescue gets *"the same production value as
 * the biggest win"*, and a `Round summary` button mounted over it is the round-2
 * finding that it did not).
 *
 * So the timeline lives here, next to the drawing that plays it, and `main.ts`
 * reads it rather than keeping a second copy of the same numbers.
 */
export const DOOR_BEAT = {
  /** The leaf swings, and the first warm light spills onto the stone. */
  openMs: 420,
  /** One lantern carried in, per lantern, in file. */
  perLanternMs: 240,
  /** The last one is through the doorway this long after its turn comes. */
  walkMs: 260,
  /** The leaf comes back, and the grille lights from inside. */
  closeMs: 300,
} as const;

/** When the door is shut on `n` lanterns, in ms from the beat's start. */
export function doorClosedMs(lanterns: number): number {
  return (
    DOOR_BEAT.openMs +
    Math.max(1, lanterns) * DOOR_BEAT.perLanternMs +
    DOOR_BEAT.walkMs +
    DOOR_BEAT.closeMs
  );
}

interface Theme {
  readonly name: string;
  /** Sky, top to bottom. §6.7: the palette drifts toward `--fossil` with height. */
  readonly sky: readonly [string, string, string];
  /** Where the fog's top plane sits, as a fraction of frame height. */
  readonly fogTop: number;
  readonly fogDensity: number;
  /**
   * How strong the far fog wall behind the branch is.
   *
   * §6.1 gives `--fog-far` one job — *"far fog; the value everything silhouettes
   * against"* — and this is the number that does it. Without a lighter value
   * behind the deck line the figures are a dark silhouette on a dark sky and
   * disappear, which is precisely what the first build of this stage did. It is
   * per-arena because §6.7 makes fog density part of each arena's brief: The Char
   * burned a hole in it, so The Char's figures have the least to stand against.
   */
  readonly horizon: number;
  /** Deck line and thickness, as fractions of frame height. */
  readonly deck: number;
  readonly thickness: number;
  readonly stone: string;
  readonly stoneLit: string;
  /** §6.7's silhouette motif, which decides the dressing. */
  readonly motif: 'horizontal' | 'ridges' | 'diagonals' | 'shattered' | 'converging';
  /** Lowbranch alone: standing water, the only reflective surface in the game. */
  readonly wet: boolean;
  /** The Char alone: an ember crack network, declared exception to §6.2. */
  readonly embers: boolean;
  /** Crown alone: the Lamp, small, warm, far, on screen the entire time. */
  readonly crownLamp: boolean;
  /** Windrow alone: fog in horizontal ribbons at 4 m/s, left to right. */
  readonly ribbons: boolean;
  /** §6.7's rake, in radians. Windrow is 6 degrees; nothing else is off level. */
  readonly rake: number;
}

/**
 * The five arenas of §6.7, and the shelf S0 opens on.
 *
 * Read down any column and the escalation §6.7 closes on is visible: fog density
 * falls, the deck rises, moisture goes to zero, the stone drifts from
 * `--bark-deep` toward `--fossil`, and the silhouette goes from horizontal to
 * converging.
 */
const THEMES: readonly Theme[] = [
  {
    // S0 — the low stone shelf in half-light. Not one of the five.
    name: 'shelf',
    sky: ['#1a2027', '#232b33', '#2e383f'],
    fogTop: 0.8,
    fogDensity: 0.4,
    horizon: 0.44,
    deck: 0.7,
    thickness: 0.07,
    stone: C.barkDeep,
    stoneLit: C.bark,
    motif: 'horizontal',
    wet: false,
    embers: false,
    crownLamp: false,
    ribbons: false,
    rake: 0,
  },
  {
    name: 'Lowbranch',
    sky: ['#1b2027', '#222b32', C.fogMid],
    fogTop: 0.65,
    fogDensity: 0.9,
    horizon: 0.66,
    deck: 0.62,
    thickness: 0.1,
    stone: C.barkDeep,
    stoneLit: C.bark,
    motif: 'horizontal',
    wet: true,
    embers: false,
    crownLamp: false,
    ribbons: false,
    rake: 0,
  },
  {
    name: 'The Grain',
    sky: ['#1a2027', '#28323a', '#48555e'],
    fogTop: 0.71,
    fogDensity: 0.78,
    horizon: 0.6,
    deck: 0.63,
    thickness: 0.075,
    stone: '#3b3a34',
    stoneLit: C.fossil,
    motif: 'ridges',
    wet: false,
    embers: false,
    crownLamp: false,
    ribbons: false,
    rake: 0,
  },
  {
    name: 'Windrow',
    sky: ['#1c232a', '#2c3841', '#55636c'],
    fogTop: 0.73,
    fogDensity: 0.66,
    horizon: 0.54,
    deck: 0.64,
    thickness: 0.065,
    stone: '#3a3128',
    stoneLit: C.barkLit,
    motif: 'diagonals',
    wet: false,
    embers: false,
    crownLamp: false,
    ribbons: true,
    rake: -0.105,
  },
  {
    name: 'The Char',
    sky: ['#0f1317', '#1a2128', '#2b353d'],
    fogTop: 0.88,
    fogDensity: 0.26,
    horizon: 0.34,
    deck: 0.6,
    thickness: 0.07,
    stone: '#14171a',
    stoneLit: '#2a2622',
    motif: 'shattered',
    wet: false,
    embers: true,
    crownLamp: false,
    ribbons: false,
    rake: 0,
  },
  {
    name: 'Crown',
    sky: ['#3b4a57', '#54646f', '#7c8a92'],
    fogTop: 0.84,
    fogDensity: 0.44,
    horizon: 0.3,
    deck: 0.66,
    thickness: 0.042,
    stone: '#6d6a5f',
    stoneLit: C.fossil,
    motif: 'converging',
    wet: false,
    embers: false,
    crownLamp: true,
    ribbons: false,
    rake: -0.03,
  },
];

/* -------------------------------------------------------------- scene input */

export type RunnerStatus = 'running' | 'lost' | 'home';

export interface StageRunner {
  readonly slot: number;
  readonly name: string;
  readonly status: RunnerStatus;
  readonly lane: number;
}

export type StageMode = 'shelf' | 'brief' | 'run' | 'resolve' | 'door' | 'crown' | 'quiet';

export interface StageScene {
  /** 1-5 for the arenas of §6.7; 0 for S0's shelf. */
  readonly arena: number;
  readonly lanes: number;
  readonly runners: readonly StageRunner[];
  readonly collapsed: readonly boolean[];
  /** How far along the branch, 0-1. The camera's dressing parallax reads this. */
  readonly progress: number;
  readonly mode: StageMode;
  /** §9's beat: one runner left, and the frame knows it. */
  readonly lastLamp: boolean;
  /**
   * Whether the figures carry their names.
   *
   * §10.1: *"Individuals are named at the moment of loss."* On a full-bleed stage
   * the name belongs on the figure. On the 96 px decision band there is no room
   * for five of them and the names are already on the pickers below, so the band
   * asks for this off rather than drawing five labels over each other.
   */
  readonly names: boolean;
}

/** One-shots the scene cannot express, because they are camera, not state. */
export type StageEffect = 'descent' | 'bloom' | 'shudder';

/* ------------------------------------------------------------ figure state */

type Pose = 'idle' | 'travel' | 'fall' | 'home' | 'gone';

interface Body {
  slot: number;
  name: string;
  lane: number;
  pose: Pose;
  /** Where along the branch, 0-1, eased toward `targetU`. */
  u: number;
  targetU: number;
  /** Its own animation clock, in seconds — never shared, so five figures differ. */
  phase: number;
  /** Seconds since the fall began, or -1. */
  fell: number;
  /** Lantern brightness, 1 alive to 0 out, and how cold the dying light has gone. */
  light: number;
  chill: number;
  /** A per-figure constant, so no two are built quite the same (§6.6 ref 3). */
  seed: number;
  /** Set when the fall is the hero descent §9 keeps in frame all the way down. */
  hero: boolean;
  /** Place in the file walking into the Lamp House, so they go in one at a time. */
  order: number;
  /** Through the doorway: safe, and no longer drawn in the world (§S5). */
  inside: boolean;
}

/* -------------------------------------------------------------- the director */

const DPR_CAP = 2;

class Stage {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private host: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private stopFrame: (() => void) | null = null;

  private width = 0;
  private height = 0;
  private dpr = 1;

  private scene: StageScene = {
    arena: 0,
    lanes: 1,
    runners: [],
    collapsed: [],
    progress: 0.08,
    mode: 'shelf',
    lastLamp: false,
    names: false,
  };

  private bodies = new Map<number, Body>();
  private time = 0;
  private lastNow = 0;

  /** Cached static art, keyed so it is rebuilt only when it could look different. */
  private backdrop: HTMLCanvasElement | null = null;
  private backdropKey = '';
  private vignette: HTMLCanvasElement | null = null;
  private vignetteKey = '';

  /** Camera: a spotlight radius, a push-in, and a vertical follow for the descent. */
  private spot = 1;
  private spotTarget = 1;
  private push = 1;
  private pushTarget = 1;
  /**
   * The camera's vertical offset, in pixels, during §9's hero descent.
   *
   * *"We stay with it, not with the branch, all the way down until the glass gives
   * out and the light goes."* Following on a fixed ramp does not do that: at full
   * gravity a figure is a screen and a half below the frame inside a second, and the
   * shot the specification calls the game's signature clip was two seconds of empty
   * fog. So the camera reads the falling body's own position and lags it, which
   * keeps the lantern in the lower third while the branch and the fog streak up past
   * it — the lag *is* the sensation of falling.
   */
  private followPx = 0;
  private heroSlot: number | null = null;
  private shudder = 0;
  private bloom = 0;
  /**
   * When §S5's door beat started, on the stage's own clock, or -1 for "not on".
   *
   * The beat is a property of the *scene*, not of a call: a settled screen that
   * re-renders — a session poll, a toast, the reality check — must not restart the
   * door, so the clock is set once when the mode becomes `door` and read from
   * there. `houseTime()` is the only reader, and under the calm variant it returns
   * a time past the end of the beat so the frame holds the finished state (§10.8:
   * parity, not a degraded mode).
   */
  private houseStart = -1;

  private dust: { x: number; y: number; vx: number; vy: number; life: number }[] = [];

  /* ------------------------------------------------------------------ mount */

  mount(host: HTMLElement): void {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'stage-canvas';
      this.canvas.setAttribute('aria-hidden', 'true');
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      onCalmChange(() => {
        this.backdropKey = '';
        this.draw(0);
      });
    }
    if (this.host !== host) {
      this.observer?.disconnect();
      this.host = host;
      this.observer = new ResizeObserver(() => this.measure());
      this.observer.observe(host);
    }
    // Re-parenting a canvas keeps its bitmap and its animation state, which is
    // what lets the whole screen re-render on every tap without the stage
    // restarting. This is the reason the stage is a singleton and not a widget.
    if (this.canvas.parentElement !== host) host.appendChild(this.canvas);
    this.measure();
    this.run();
  }

  /** Called when a screen without a stage takes over, so the loop can stop. */
  unmount(): void {
    this.stopFrame?.();
    this.stopFrame = null;
  }

  private measure(): void {
    const host = this.host;
    const canvas = this.canvas;
    if (!host || !canvas) return;
    const rect = host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    this.backdropKey = '';
    this.vignetteKey = '';
    this.draw(0);
  }

  private run(): void {
    if (this.stopFrame) return;
    this.lastNow = 0;
    this.stopFrame = onFrame((now) => {
      const delta = this.lastNow === 0 ? 16 : Math.min(64, now - this.lastNow);
      this.lastNow = now;
      this.draw(delta / 1000);
    });
  }

  /* ------------------------------------------------------------------ scene */

  set(scene: StageScene): void {
    const previous = this.scene;
    this.scene = scene;

    /*
     * §S5's door beat starts once, on the render that first says `door`.
     *
     * Every other render of the settled screen — the session poll, a toast, the
     * reality check — hands the stage the same scene again, and a beat that
     * restarted on those would play the rescue as a stutter.
     */
    const doorOpens = scene.mode === 'door' && previous.mode !== 'door';
    if (doorOpens) this.houseStart = performance.now();
    if (scene.mode !== 'door') this.houseStart = -1;

    const seen = new Set<number>();
    scene.runners.forEach((runner, index) => {
      seen.add(runner.slot);
      const lanePeers = scene.runners.filter((peer) => peer.lane === runner.lane);
      const order = lanePeers.findIndex((peer) => peer.slot === runner.slot);
      const spread = lanePeers.length > 1 ? order / (lanePeers.length - 1) : 0.5;
      const body = this.bodies.get(runner.slot);
      /*
       * Runners file along the branch behind the point runner, spread by lane
       * position and then travelled forward by the replay's own progress.
       *
       * The spread is wide — 40% of the frame at five runners — because it has to
       * carry two things at once: §6.4's *"single file, point runner first"* read on
       * The Reach, and five legible name tags. At the narrow spread this started
       * with, adjacent names overlapped into one word.
       */
      /*
       * On the door screen the file has one destination and it is the doorway.
       *
       * §S5 is *"the chosen lanterns go inside"*, so the target is the door rather
       * than a place on the branch, and the queue order is what makes them go in
       * one at a time instead of arriving as a group.
       */
      const target = scene.mode === 'door' ? DOOR_U : 0.09 + spread * 0.4 + scene.progress * 0.44;

      if (!body) {
        /*
         * A figure that arrives *already* lost on §S6's screen still falls.
         *
         * A body created lost is `gone` — it has fallen somewhere the camera was
         * not, in an earlier arena, and there is nothing to play. The wipe screen
         * is the exception, and it is the one that matters: if the squad's bodies
         * were dropped between the run and the wipe, recreating them as `gone`
         * meant §9's descent — *"we stay with it all the way down"* — played over
         * an empty frame. On `quiet` a lost runner is a runner in the air.
         */
        const falling = runner.status === 'lost' && scene.mode === 'quiet';
        this.bodies.set(runner.slot, {
          slot: runner.slot,
          name: runner.name,
          lane: runner.lane,
          pose:
            runner.status === 'home'
              ? 'home'
              : runner.status === 'lost'
                ? falling
                  ? 'fall'
                  : 'gone'
                : 'idle',
          // A body that arrives already at the door would be standing in it. It
          // starts back along the branch and walks in like the rest.
          u: scene.mode === 'door' ? DOOR_U - 0.3 - order * 0.09 : target,
          targetU: target,
          phase: hash01(runner.slot * 7.3) * 4,
          fell: falling ? 0 : -1,
          light: runner.status === 'lost' && !falling ? 0 : 1,
          chill: runner.status === 'lost' && !falling ? 1 : 0,
          seed: runner.slot * 3 + index,
          hero: falling && scene.runners.every((peer) => peer.status === 'lost'),
          order,
          inside: false,
        });
        return;
      }

      body.lane = runner.lane;
      body.name = runner.name;
      body.targetU = target;
      body.order = order;

      if (runner.status === 'lost' && body.pose !== 'fall' && body.pose !== 'gone') {
        body.pose = 'fall';
        body.fell = 0;
        // §9: the hero descent is the one fall the camera never leaves, and it is
        // the fall of the last light in the frame.
        body.hero = scene.runners.filter((peer) => peer.status !== 'lost').length === 0;
        this.puff(body);
      } else if (runner.status === 'home') {
        // On the door screen a runner who is home is *walking home*: the pose is
        // the walk until the doorway takes them, and only then the standing one.
        if (scene.mode === 'door' && !body.inside) body.pose = 'travel';
        else if (body.pose !== 'home') body.pose = 'home';
        body.fell = -1;
      } else if (runner.status === 'running' && (body.pose === 'idle' || body.pose === 'travel'))
        body.pose = scene.mode === 'run' ? 'travel' : 'idle';
    });

    for (const [slot, body] of this.bodies)
      if (!seen.has(slot) && body.pose !== 'fall') this.bodies.delete(slot);

    /*
     * The squad, put into a file behind the door as the beat opens.
     *
     * They arrive on this screen standing wherever the last arena left them,
     * which is four figures within a few percent of each other — so they reached
     * the doorway together and the beat that is meant to be *one lantern at a
     * time* was over in a third of a second. A file, spaced by queue order, is
     * what makes the count readable as a count.
     */
    if (doorOpens)
      for (const body of this.bodies.values()) {
        body.u = DOOR_U - 0.15 - body.order * 0.11;
        body.inside = false;
      }

    // A lane that has just given way, from the transcript and from nowhere else.
    scene.collapsed.forEach((collapsed, lane) => {
      if (collapsed && !previous.collapsed[lane]) {
        this.shudder = 1;
        this.dustAlongLane(lane);
      }
    });

    /*
     * The spotlight, on both of §9's endings.
     *
     * It narrows for the last light on the branch, and it narrows again on the
     * door — *"the same production value as the biggest win"* is a lighting
     * instruction as much as a copy one, and the one thing this stage can do that
     * a panel of type cannot is put the frame's whole attention on the doorway
     * while the lanterns go in. It is a mask and a push, not a colour grade, and
     * §6.4 still forbids the shake and the confetti that usually come with this.
     */
    this.spotTarget = scene.lastLamp ? 0.44 : scene.mode === 'door' ? 0.62 : 1;
    this.pushTarget = scene.lastLamp ? 1.16 : scene.mode === 'door' ? 1.12 : 1;
    if (previous.arena !== scene.arena) {
      this.backdropKey = '';
      this.followPx = 0;
      this.heroSlot = null;
    }
  }

  effect(kind: StageEffect): void {
    if (kind === 'shudder') this.shudder = 1;
    if (kind === 'bloom') this.bloom = 1;
    // The descent's camera is driven by the falling body, so the effect only has
    // to say which body: `set()` has already marked the hero.
    if (kind === 'descent' && this.heroSlot === null)
      this.heroSlot = [...this.bodies.values()].find((body) => body.hero)?.slot ?? null;
  }

  /** Drops every figure's animation state — a new round is a new squad. */
  reset(): void {
    this.bodies.clear();
    this.dust = [];
    this.followPx = 0;
    this.heroSlot = null;
    this.bloom = 0;
    this.spot = 1;
    this.spotTarget = 1;
    this.push = 1;
    this.pushTarget = 1;
  }

  /* ------------------------------------------------------------- particles */

  private puff(body: Body): void {
    if (calm()) return;
    const { x, y } = this.place(body.u, body.lane);
    for (let index = 0; index < 9; index += 1)
      this.dust.push({
        x,
        y,
        vx: (hash01(body.seed * 11 + index) - 0.5) * 26,
        vy: -6 - hash01(body.seed * 5 + index) * 16,
        life: 0.5 + hash01(index * 3.1) * 0.5,
      });
  }

  private dustAlongLane(lane: number): void {
    if (calm()) return;
    for (let index = 0; index < 26; index += 1) {
      const u = 0.08 + (index / 26) * 0.84;
      const { x, y } = this.place(u, lane);
      this.dust.push({
        x,
        y: y + 2,
        vx: (hash01(index * 2.7) - 0.5) * 14,
        vy: 8 + hash01(index * 9.1) * 22,
        life: 0.7 + hash01(index) * 0.7,
      });
    }
  }

  /* ------------------------------------------------------------- geometry */

  /**
   * The arena's theme, recomposed for the frame it has to fit in.
   *
   * §S2's decision band is 96 px tall and §S3's run is the whole screen, and the
   * same composition cannot serve both: at 96 px a fog plane at 52% of the height
   * is 50 px of white over a 60 px frame and the branch disappears into it. So a
   * short frame gets the deck pushed down, the fog plane pushed below it and the
   * density pulled back — the same arena, framed as an establishing band rather
   * than as a stage. Nothing about *which* arena it is changes.
   */
  private theme(): Theme {
    const base = THEMES[Math.max(0, Math.min(THEMES.length - 1, this.scene.arena))] as Theme;
    const short = this.height < 150;
    const fork = this.scene.lanes > 1;
    const door = this.scene.mode === 'door';
    if (!short && !fork && !door) return base;

    let deck = base.deck;
    let fogTop = base.fogTop;
    let fogDensity = base.fogDensity;
    let horizon = base.horizon;
    let thickness = base.thickness;

    if (door && !short) {
      /*
       * The door screen is a portrait composition with a building in it.
       *
       * At the travelling deck height the Lamp House sits in the middle of the
       * frame with a third of the picture empty above it and a third empty below
       * — which is how the round-1 terminal screens came to be mostly grey. The
       * deck comes down so the house stands *on the lower third*, the fog plane
       * comes with it, and the frame is filled by the thing it is about.
       */
      deck = 0.72;
      fogTop = Math.max(base.fogTop, 0.88);
      horizon *= 1.1;
    }
    if (short) {
      deck = 0.66;
      fogTop = Math.max(fogTop, 0.76);
      fogDensity *= 0.55;
      horizon *= 0.85;
      thickness *= 0.5;
    }
    if (fork) {
      /*
       * A fork needs two levels *and* clear air under the lower one.
       *
       * Left at the single-lane composition, the thin limb landed below the fog
       * plane — a limb drawn inside the fog it is suspended over, which reads as a
       * pale plate rather than as stone and takes §6.7's "one broad, one thin" read
       * away with it. So the broad limb comes up and the fog goes down by exactly
       * enough to leave the thin limb standing in air.
       */
      deck -= short ? 0.05 : 0.08;
      fogTop = Math.max(fogTop, deck + THIN_LIMB_DROP + 0.07);
    }
    return { ...base, deck, fogTop, fogDensity, horizon, thickness };
  }

  /**
   * The height of the deck's walking surface at a point along it.
   *
   * **One function, two callers, and that is the whole point.** `paintDeck` draws
   * the top face from this and `place` stands the figures on it from this, so a
   * raked arena, a rising crown tine or a shattered fracture plane cannot put the
   * stone in one place and the feet in another. When these were two separate
   * expressions, Crown's runners floated a few pixels above their own branch.
   */
  private deckY(u: number, lane: number): number {
    const theme = this.theme();
    const h = this.height;
    const thin = lane > 0 && this.scene.lanes > 1;
    // §6.7: on a fork the thin limb runs along the flank, lower and separate.
    const base = (thin ? theme.deck + THIN_LIMB_DROP : theme.deck) * h;
    const thickness = h * theme.thickness * (thin ? 0.45 : 1);
    let y = base + theme.rake * (u - 0.5) * h;
    if (theme.motif === 'shattered')
      // Nine facets, not forty: §6.7's Char is *"shattered and angular … every edge
      // is a fracture plane"*, and forty of them per screen is a noise ridge. A
      // fracture plane has to be big enough to read as a plane.
      y += (hash01(Math.floor(u * 9) * 3.7 + lane) - 0.5) * thickness * 1.5;
    else if (theme.motif === 'converging') y -= u * u * h * 0.06;
    else if (theme.motif === 'ridges') y += Math.sin(u * 9 + lane) * thickness * 0.1;
    else y += Math.sin(u * 5.3 + lane * 2) * thickness * 0.07;
    return y;
  }

  /** Where a point on a lane sits in the frame. The one source of that answer. */
  private place(u: number, lane: number): { x: number; y: number } {
    return { x: u * this.width, y: this.deckY(u, lane) };
  }

  /**
   * How tall a Kindling is, in the frame it is standing in.
   *
   * §6.4's camera is *"a 35 mm-equivalent tracking rig at chest height"*, which on
   * a full-bleed portrait frame means the figures are a real presence and not five
   * marks on a horizon — a 46 px figure on a 700 px stage read as a diorama seen
   * from across a room. The floor is what keeps them legible in §S2's 96 px
   * decision band, where they are establishing shot rather than subject.
   */
  private figureHeight(): number {
    return Math.max(20, Math.min(76, this.height * 0.13));
  }

  /**
   * The camera on §9's hero descent.
   *
   * It reads the falling body's own position and lags it, so the lantern settles
   * into the lower third of the frame and everything else streaks up past it. When
   * the light has gone — the glass gives out, §9's words — the camera stops
   * following and eases back, which is the cut to the two seconds of empty fog.
   */
  private trackDescent(delta: number): void {
    const hero = this.heroSlot === null ? undefined : this.bodies.get(this.heroSlot);
    if (!hero || hero.pose !== 'fall' || hero.light <= 0.02) {
      // Back to level, slowly. Nothing announces the return.
      this.followPx += (0 - this.followPx) * Math.min(1, delta * (calm() ? 20 : 1.1));
      if (Math.abs(this.followPx) < 0.5) this.followPx = 0;
      return;
    }
    const { y } = this.figureAnchor(hero, this.figureHeight());
    const want = Math.max(0, y - this.height * 0.42);
    // Lagging, not locked: a camera that matches the fall exactly draws a figure
    // that is not moving.
    this.followPx += (want - this.followPx) * Math.min(1, delta * (calm() ? 20 : 3.4));
  }

  /* ------------------------------------------------------------------ draw */

  private draw(delta: number): void {
    const ctx = this.ctx;
    if (!ctx || this.width === 0) return;
    this.time += delta;

    // Cameras and decays, all first-order so a dropped frame cannot overshoot.
    const settle = (from: number, to: number, rate: number) =>
      calm() ? to : from + (to - from) * Math.min(1, delta * rate);
    this.spot = settle(this.spot, this.spotTarget, 2.4);
    this.push = settle(this.push, this.pushTarget, 2.2);
    this.shudder = Math.max(0, this.shudder - delta * 2.6);
    this.bloom = Math.max(0, this.bloom - delta * 0.7);
    this.trackDescent(delta);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.save();
    // The camera: a push-in for §9's close 24 mm follow, a vertical follow for the
    // hero descent, and a shudder that belongs to the branch rather than the
    // frame — §6.4 forbids screen shake on a win and this is neither.
    const shake = this.shudder * this.shudder * 3.2;
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.push, this.push);
    ctx.translate(
      -this.width / 2 + (calm() ? 0 : Math.sin(this.time * 47) * shake),
      -this.height / 2 - this.followPx + (calm() ? 0 : Math.cos(this.time * 41) * shake * 0.6),
    );

    this.paintBackdrop(ctx);
    this.paintUnderside(ctx);
    this.paintFog(ctx, 0);
    // The house stands on the branch, so it is drawn with the branch: behind the
    // figures walking toward it, in front of the fog they came out of.
    this.paintLampHouse(ctx);
    this.paintFigures(ctx, delta);
    this.paintFog(ctx, 1);
    this.paintDust(ctx, delta);
    ctx.restore();

    this.paintVignette(ctx);
  }

  /* --------------------------------------------------------- static layers */

  private paintBackdrop(ctx: CanvasRenderingContext2D): void {
    // `collapsed` is part of the key: a lane that has given way is drawn broken, so
    // it is a different backdrop and not a different overlay.
    const key = `${this.scene.arena}|${this.scene.lanes}|${this.scene.collapsed.join('')}|${this.width}x${this.height}|${this.dpr}`;
    if (this.backdropKey !== key || !this.backdrop) {
      this.backdrop = this.buildBackdrop();
      this.backdropKey = key;
    }
    ctx.drawImage(this.backdrop, 0, 0, this.width, this.height);
  }

  private buildBackdrop(): HTMLCanvasElement {
    const theme = this.theme();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(this.width * this.dpr);
    canvas.height = Math.round(this.height * this.dpr);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = this.width;
    const h = this.height;

    // The sky: one cool key from above and behind, whose job is to give the world
    // silhouettes rather than to illuminate it (§6.3).
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, theme.sky[0]);
    sky.addColorStop(0.52, theme.sky[1]);
    sky.addColorStop(1, theme.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    this.paintFarTree(ctx, w, h);

    /*
     * The far fog wall — the value everything silhouettes against (§6.1).
     *
     * §6.6's first reference is a lantern procession in heavy fog, and the thing
     * that makes that photograph work is that the fog *behind* the figures is
     * brighter than the figures. Without this band the whole composition is a dark
     * silhouette on a dark sky and the Kindlings vanish; with it they are cut out
     * of a lit volume, which is the read the material brief asks for.
     */
    const wall = ctx.createLinearGradient(0, h * (theme.deck - 0.46), 0, h * (theme.deck + 0.1));
    wall.addColorStop(0, 'rgba(138,152,160,0)');
    wall.addColorStop(0.6, `rgba(138,152,160,${(0.34 * theme.horizon).toFixed(3)})`);
    wall.addColorStop(1, `rgba(138,152,160,${(0.58 * theme.horizon).toFixed(3)})`);
    ctx.fillStyle = wall;
    ctx.fillRect(0, h * (theme.deck - 0.46), w, h * 0.56);

    if (theme.crownLamp) this.paintCrownLamp(ctx, w, h);
    else if (h >= 200) this.paintCanopy(ctx, w, h);
    this.paintDeck(ctx, w, h, theme);

    // The void below: the deepest value in frame, under everything (§6.1).
    const below = ctx.createLinearGradient(0, h * theme.fogTop, 0, h);
    below.addColorStop(0, 'rgba(14,17,20,0)');
    below.addColorStop(1, theme.embers ? 'rgba(14,17,20,0.95)' : 'rgba(14,17,20,0.55)');
    ctx.fillStyle = below;
    ctx.fillRect(0, h * theme.fogTop, w, h * (1 - theme.fogTop));
    return canvas;
  }

  /**
   * What is under the frame, so §9's descent has somewhere to go.
   *
   * The backdrop is exactly one frame tall, so once the camera follows a falling
   * lantern past the bottom edge it is looking at nothing. §1 says *"nobody knows
   * what is under the fog and nobody who has gone down has come back to say"*, so
   * what is under it is the deepest value in the palette and one fog layer thinning
   * into it — drawn only while the camera has left level, because there is no other
   * moment it can be seen.
   */
  private paintUnderside(ctx: CanvasRenderingContext2D): void {
    if (this.followPx < 1) return;
    const theme = this.theme();
    const h = this.height;
    const top = h * theme.fogTop;
    const depth = this.followPx + h;
    /*
     * Deep, and never black.
     *
     * §S6 asks for *"two full seconds of fog and wind"*, and the first build gave
     * two seconds of `--void`: past 30% of the drop the gradient had bottomed out
     * at the deepest value in the palette and the frame was a black rectangle,
     * which reads as a rendering fault rather than as the Understory. It bottoms
     * out above black now, and the volume keeps its structure all the way down —
     * fog banks and the fossil trunks streaking past — because what makes a fall
     * read as a fall is the things going *up* past the camera.
     */
    const gradient = ctx.createLinearGradient(0, top, 0, top + depth);
    gradient.addColorStop(0, `rgba(56,67,75,${(0.34 * theme.fogDensity).toFixed(3)})`);
    gradient.addColorStop(0.42, 'rgba(30,37,44,0.92)');
    gradient.addColorStop(1, '#111820');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, top, this.width, depth);

    if (calm()) return;

    // Trunks, going up past the camera: the only thing that gives the drop speed.
    ctx.save();
    for (let index = 0; index < 5; index += 1) {
      const seed = index * 13.7;
      const width = this.width * (0.04 + hash01(seed) * 0.08);
      const x = this.width * hash01(seed + 3);
      const span = h * (0.5 + hash01(seed + 5) * 0.9);
      const drift = (this.followPx * (0.55 + hash01(seed + 7) * 0.5) + index * h * 0.8) % (depth + span);
      const y0 = top + drift - span;
      // Ends that fade rather than stop: a hard-edged rectangle in fog is a bar.
      const trunk = ctx.createLinearGradient(0, y0, 0, y0 + span);
      const alpha = 0.16 + hash01(seed + 9) * 0.2;
      trunk.addColorStop(0, 'rgba(12,16,20,0)');
      trunk.addColorStop(0.3, `rgba(12,16,20,${alpha.toFixed(3)})`);
      trunk.addColorStop(0.7, `rgba(12,16,20,${alpha.toFixed(3)})`);
      trunk.addColorStop(1, 'rgba(12,16,20,0)');
      ctx.fillStyle = trunk;
      ctx.fillRect(x, y0, width, span);
    }
    ctx.restore();

    // And the fog itself, in three planes at three speeds.
    const tile = fogTile();
    ctx.save();
    ctx.globalAlpha = 0.13 * theme.fogDensity;
    const band = h * 0.7;
    for (let index = 0; index < 3; index += 1) {
      const y = top + ((this.followPx * (0.5 + index * 0.35) + index * band) % (depth + band));
      ctx.drawImage(tile, -this.width * 0.2, y, this.width * 1.4, band);
    }
    ctx.restore();
  }

  /**
   * A dead world-tree, petrified into pale stone, at two depths (§1).
   *
   * Straight, evenly spaced, cross-braced trunks read as scaffolding — which is
   * what the first version of this drew. A tree at distance is a small number of
   * heavy, tapering, leaning masses that lose contrast with depth, so that is what
   * this draws: two behind the branch, two further back, none of them vertical and
   * none of them with a horizontal member on it.
   */
  private paintFarTree(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    for (let layer = 0; layer < 2; layer += 1) {
      const alpha = layer === 0 ? 0.2 : 0.1;
      ctx.fillStyle = `rgba(18,23,28,${alpha})`;
      for (let index = 0; index < 2; index += 1) {
        const seed = layer * 23 + index * 7;
        const x = w * (0.12 + hash01(seed) * 0.76);
        const base = (18 + hash01(seed + 1) * 26) * (layer === 0 ? 1 : 0.6);
        const top = h * (0.04 + hash01(seed + 2) * 0.14);
        const lean = (hash01(seed + 3) - 0.5) * w * 0.1;
        ctx.beginPath();
        ctx.moveTo(x - base / 2, h);
        // Tapering, and leaning: nothing in a dead forest is plumb.
        ctx.quadraticCurveTo(x - base * 0.3 + lean * 0.6, h * 0.5, x + lean - base * 0.1, top);
        ctx.lineTo(x + lean + base * 0.1, top);
        ctx.quadraticCurveTo(x + base * 0.3 + lean * 0.6, h * 0.5, x + base / 2, h);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /**
   * Limbs of the tree, overhead.
   *
   * §1 is a dead world-tree and the runners are crossing one branch of it, so on a
   * full-bleed frame there is more tree above them — and without it the top 60% of
   * a portrait stage is empty sky, which reads as a missing background rather than
   * as height. They are silhouettes only: nothing up there is lit, because §6.2's
   * emissive budget spends all four of its exceptions elsewhere.
   *
   * Absent on Crown, where §6.7 says the sky opens for the first and only time —
   * *"a cold high dome, no stars, no moon"* — and putting a branch across it would
   * take away the one moment the palette is allowed to get lighter.
   */
  private paintCanopy(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.save();
    for (const [side, seed, alpha] of [
      [-1, 3, 0.2],
      [1, 11, 0.13],
    ] as const) {
      /*
       * Soft, wide, and far back.
       *
       * A high-contrast limb sweeping in from the corner is a foreground element,
       * and a foreground element up here competes with the one thing the frame is
       * about — the light on the branch. §6.6's first reference has *nothing* in
       * the top of frame except grey volume, so these sit at the same value as the
       * far trunks and read as depth rather than as shape.
       */
      const edge = side < 0 ? -w * 0.1 : w * 1.1;
      const inward = side < 0 ? 1 : -1;
      const thickness = h * (0.13 + hash01(seed) * 0.05);
      const reach = w * (0.5 + hash01(seed + 1) * 0.26);
      const drop = h * (0.1 + hash01(seed + 2) * 0.06);
      ctx.fillStyle = `rgba(18,23,28,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(edge, -h * 0.05);
      ctx.quadraticCurveTo(edge + inward * reach * 0.55, drop * 0.55, edge + inward * reach, drop);
      ctx.quadraticCurveTo(
        edge + inward * reach * 0.5,
        drop * 0.6 + thickness * 0.8,
        edge,
        -h * 0.05 + thickness,
      );
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * The Crown Lamp (§6.7 arena 5): *"small, warm, far, and on screen the entire
   * time"*. It is one of the four things in the game permitted to emit.
   */
  private paintCrownLamp(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const x = w * 0.9;
    const y = h * 0.3;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(x, y, 0, x, y, h * 0.34);
    glow.addColorStop(0, 'rgba(255,231,190,0.5)');
    glow.addColorStop(0.25, 'rgba(255,165,61,0.16)');
    glow.addColorStop(1, 'rgba(255,165,61,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - h * 0.34, y - h * 0.34, h * 0.68, h * 0.68);
    ctx.restore();
    ctx.fillStyle = C.lampCore;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.6, h * 0.011), 0, Math.PI * 2);
    ctx.fill();
  }

  /* ------------------------------------------------------- §S5: the door */

  /**
   * Seconds since the door beat began; past the end of it under the calm variant.
   *
   * §10.8 asks for parity rather than a degraded mode, and the parity form of a
   * beat is its finished frame: door shut, grille lit, constellation up. Nothing
   * is skipped, because the end state is the state the traversal was heading for.
   */
  private houseTime(): number {
    if (this.scene.mode !== 'door') return -1;
    if (calm()) return 99;
    /*
     * Wall clock, not the stage's own accumulated time.
     *
     * `this.time` is a sum of frame deltas clamped to 64 ms, which is the right
     * clock for a gait or a swing — a device that drops frames should not
     * fast-forward the animation. It is the wrong clock for this: the screen
     * above is landing its own beats on `setTimeout`, so a stage running behind
     * wall time puts the banked figure on screen while the door is still open.
     * The two timelines have to be the same timeline.
     */
    return this.houseStart < 0 ? 0 : (performance.now() - this.houseStart) / 1000;
  }

  /**
   * The Lamp House (`DESIGN.md` §S5, §9).
   *
   * *"The Lamp House door opens, the chosen lanterns go inside, the brass bell
   * strikes once, and the saved lights stack into a small constellation above the
   * door."* Round 1 shipped that sentence as a screen subtitle over a picture of
   * three figures standing on a branch — the door the copy is about was never
   * drawn, which made the rescue the one moment in the game with no object in it.
   *
   * It is built out of the same two materials as everything else the player has
   * been looking at for five arenas: petrified stone for the mass, brass for the
   * frame, and one warm interior light that is the only emissive surface in it
   * (§6.2's exception list). Nothing here is a new colour and nothing bounces:
   * the leaf swings, the light spills, the leaf closes, and the light comes back
   * through the grille — which is exactly the read §9 asks the rescue to have,
   * *"safe, and visibly still burning"*.
   */
  private paintLampHouse(ctx: CanvasRenderingContext2D): void {
    const t = this.houseTime();
    if (t < 0) return;

    const ground = this.deckY(DOOR_U, 0);
    const x = DOOR_U * this.width;
    // The subject of the shot, and sized like one: the house is three figures
    // tall, so the doorway a Kindling walks into is a *door* and not a slot.
    const H = Math.max(58, this.figureHeight() * 3);
    const W = H * 0.7;
    const top = ground - H;

    // The beat, read off the one published timeline (`DOOR_BEAT`).
    const lamps = this.scene.runners.filter((runner) => runner.status === 'home').length;
    const closedAt = doorClosedMs(lamps) / 1000;
    const open = Math.min(1, t / (DOOR_BEAT.openMs / 1000));
    const shut = Math.max(0, Math.min(1, (t - closedAt) / (DOOR_BEAT.closeMs / 1000)));
    // How wide the doorway is standing, 0 shut to 1 wide: open, then closed again.
    const gape = outCubic(open) * (1 - outCubic(shut));
    const inside = [...this.bodies.values()].filter((body) => body.inside).length;

    const doorW = W * 0.46;
    const doorH = H * 0.56;
    const doorLeft = x - doorW / 2;
    const doorTop = ground - doorH;

    ctx.save();

    // The mass sits on the stone, so it gets the same contact decal as a figure.
    ctx.fillStyle = 'rgba(14,17,20,0.5)';
    ctx.beginPath();
    ctx.ellipse(x, ground + 1, W * 0.62, H * 0.026, 0, 0, Math.PI * 2);
    ctx.fill();

    /*
     * The mass: a squat stone gatehouse, wider at the foot, with a heavy hood.
     *
     * Drawn as a silhouette against the fog wall like everything else on the
     * branch — §6.1's ninety percent — with one cool rim off the sky key down its
     * left edge so it reads as stone with a form rather than as a cut-out.
     */
    const shoulderY = top + H * 0.26;
    const body = new Path2D();
    body.moveTo(x - W * 0.5, ground);
    body.lineTo(x - W * 0.42, shoulderY);
    body.lineTo(x - W * 0.5, shoulderY);
    body.lineTo(x - W * 0.44, top + H * 0.12);
    body.lineTo(x, top);
    body.lineTo(x + W * 0.44, top + H * 0.12);
    body.lineTo(x + W * 0.5, shoulderY);
    body.lineTo(x + W * 0.42, shoulderY);
    body.lineTo(x + W * 0.5, ground);
    body.closePath();

    /*
     * Stone, not a black barn.
     *
     * §6.2's material is petrified wood at two scales — courses of grain and a
     * hairline fracture network — and a flat silhouette fill reads as a cut-out
     * of the sky. So the mass is a value *above* the figures rather than the same
     * one: it is architecture, and it is the thing they are walking into.
     */
    const stone = ctx.createLinearGradient(0, top, 0, ground);
    stone.addColorStop(0, '#2b333b');
    stone.addColorStop(0.5, '#1d242b');
    stone.addColorStop(1, '#10151a');
    ctx.fillStyle = stone;
    ctx.fill(body);

    ctx.save();
    ctx.clip(body);
    // Courses, at the 2 m scale.
    ctx.strokeStyle = 'rgba(216,207,187,0.09)';
    ctx.lineWidth = 1;
    for (let course = 1; course < 9; course += 1) {
      const y = top + (H * course) / 9 + hash01(course * 3.7) * 2;
      ctx.beginPath();
      ctx.moveTo(x - W * 0.5, y);
      ctx.lineTo(x + W * 0.5, y);
      ctx.stroke();
    }
    // Fractures, at the 10 cm scale: short, angular, never parallel.
    ctx.strokeStyle = 'rgba(14,17,20,0.5)';
    for (let crack = 0; crack < 7; crack += 1) {
      const cx = x - W * 0.5 + hash01(crack * 5.1) * W;
      const cy = top + hash01(crack * 2.3 + 1) * H;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + (hash01(crack * 7.7) - 0.5) * W * 0.3, cy + hash01(crack * 3.3) * H * 0.16);
      ctx.stroke();
    }
    // The dust layer, lightening the upward-facing hood toward `--fossil` (§6.2).
    const dust = ctx.createLinearGradient(0, top, 0, top + H * 0.3);
    dust.addColorStop(0, 'rgba(216,207,187,0.16)');
    dust.addColorStop(1, 'rgba(216,207,187,0)');
    ctx.fillStyle = dust;
    ctx.fillRect(x - W * 0.5, top, W, H * 0.3);
    ctx.restore();

    // The cool rim off the sky key, on the left edge only (§6.3: one key light).
    ctx.strokeStyle = 'rgba(138,152,160,0.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - W * 0.5, ground);
    ctx.lineTo(x - W * 0.42, shoulderY);
    ctx.lineTo(x - W * 0.44, top + H * 0.12);
    ctx.lineTo(x, top);
    ctx.stroke();

    /*
     * The doorway, and what is behind it.
     *
     * The opening is the darkest shape in the frame until the leaf moves, and
     * then it is the warmest: the light is *inside*, and the door is the only
     * thing between the player and it. That is the whole picture the rescue is.
     */
    const arch = new Path2D();
    arch.moveTo(doorLeft, ground);
    arch.lineTo(doorLeft, doorTop + doorW * 0.42);
    arch.quadraticCurveTo(doorLeft, doorTop, doorLeft + doorW * 0.5, doorTop);
    arch.quadraticCurveTo(doorLeft + doorW, doorTop, doorLeft + doorW, doorTop + doorW * 0.42);
    arch.lineTo(doorLeft + doorW, ground);
    arch.closePath();
    ctx.fillStyle = '#07090b';
    ctx.fill(arch);

    if (gape > 0.02) {
      // Warm interior, seen through the opening.
      ctx.save();
      ctx.clip(arch);
      const glow = ctx.createLinearGradient(0, ground, 0, doorTop);
      glow.addColorStop(0, `rgba(255,165,61,${(0.5 * gape).toFixed(3)})`);
      glow.addColorStop(1, `rgba(255,231,190,${(0.28 * gape).toFixed(3)})`);
      ctx.fillStyle = glow;
      ctx.fillRect(doorLeft, doorTop, doorW, doorH);
      ctx.restore();

      // The spill on the stone in front of it: a trapezoid of light, not a glow.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 * gape;
      const spill = ctx.createLinearGradient(x, ground, x - W * 1.1, ground);
      spill.addColorStop(0, 'rgba(255,165,61,0.42)');
      spill.addColorStop(1, 'rgba(255,165,61,0)');
      ctx.fillStyle = spill;
      ctx.beginPath();
      ctx.moveTo(doorLeft, ground - 1);
      ctx.lineTo(doorLeft + doorW, ground - 1);
      ctx.lineTo(x + W * 0.1, ground + H * 0.05);
      ctx.lineTo(x - W * 1.2, ground + H * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    /*
     * The leaf: brass-banded stone on a hinge at the left jamb.
     *
     * Swung open it is foreshortened rather than rotated — a door seen from the
     * side of the branch the camera is on — which is the honest read at this
     * scale and costs no transform stack.
     */
    const leafW = doorW * (1 - gape * 0.86);
    if (leafW > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(doorLeft, doorTop - 1, leafW, doorH + 1);
      ctx.clip();
      const leaf = ctx.createLinearGradient(doorLeft, 0, doorLeft + leafW, 0);
      leaf.addColorStop(0, '#161b21');
      leaf.addColorStop(1, '#0d1114');
      ctx.fillStyle = leaf;
      ctx.fill(arch);

      // The grille: four brass bars in the head of the leaf, and the light from
      // inside behind them once the door is shut (§9's *"through the grille"*).
      const grilleTop = doorTop + doorH * 0.14;
      const grilleH = doorH * 0.26;
      const lit = Math.max(0, Math.min(1, (t - closedAt - DOOR_BEAT.closeMs / 1000) / 0.5));
      if (lit > 0) {
        const inner = ctx.createLinearGradient(0, grilleTop, 0, grilleTop + grilleH);
        inner.addColorStop(0, `rgba(255,231,190,${(0.85 * lit).toFixed(3)})`);
        inner.addColorStop(1, `rgba(255,165,61,${(0.55 * lit).toFixed(3)})`);
        ctx.fillStyle = inner;
        ctx.fillRect(doorLeft + doorW * 0.12, grilleTop, doorW * 0.76, grilleH);
      }
      ctx.strokeStyle = C.brass;
      ctx.lineWidth = Math.max(1, doorW * 0.045);
      for (let bar = 1; bar <= 4; bar += 1) {
        const bx = doorLeft + doorW * (0.12 + (0.76 * bar) / 5);
        ctx.beginPath();
        ctx.moveTo(bx, grilleTop);
        ctx.lineTo(bx, grilleTop + grilleH);
        ctx.stroke();
      }
      // Two brass bands across the leaf, and the ring.
      ctx.lineWidth = Math.max(1, doorW * 0.06);
      ctx.strokeStyle = 'rgba(201,162,39,0.72)';
      for (const level of [0.52, 0.82] as const) {
        ctx.beginPath();
        ctx.moveTo(doorLeft, doorTop + doorH * level);
        ctx.lineTo(doorLeft + doorW, doorTop + doorH * level);
        ctx.stroke();
      }
      ctx.restore();

      if (lit > 0) {
        /*
         * The light reaching out of the grille — and the frame going warm.
         *
         * §6.4: *"The reward for a big bank is that the tree is briefly warm."*
         * That is the entire win presentation the document allows, so this is it:
         * a wide, slow warm wash off the door, over the stone the squad crossed.
         * No confetti, no coin fountain, no shake.
         */
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.44 * lit;
        drawGlow(ctx, glowSprite('warm'), x, grilleTop + grilleH * 0.5, doorW * 2.4);
        ctx.globalAlpha = 0.16 * lit;
        drawGlow(ctx, glowSprite('warm'), x, ground - H * 0.2, this.width * 1.1);
        ctx.restore();
      }
    }

    /*
     * The brass hood and the bell.
     *
     * §S5 strikes the bell once, and the sound layer already does; this is the
     * object it is struck on, so the sound has something on screen to belong to.
     */
    ctx.strokeStyle = C.brass;
    ctx.lineWidth = Math.max(2, H * 0.024);
    ctx.beginPath();
    ctx.moveTo(doorLeft - doorW * 0.08, doorTop - H * 0.015);
    ctx.lineTo(doorLeft + doorW * 1.08, doorTop - H * 0.015);
    ctx.stroke();
    // The jambs, so the brass frames the opening rather than crossing it.
    ctx.lineWidth = Math.max(1, H * 0.012);
    ctx.strokeStyle = 'rgba(201,162,39,0.62)';
    for (const side of [-1, 1] as const) {
      const jx = x + side * (doorW / 2 + doorW * 0.06);
      ctx.beginPath();
      ctx.moveTo(jx, doorTop - H * 0.015);
      ctx.lineTo(jx, ground);
      ctx.stroke();
    }

    const bellX = x + W * 0.36;
    const bellY = top + H * 0.3;
    const struck = Math.max(0, 1 - Math.abs(t - closedAt) * 2.4);
    ctx.save();
    ctx.translate(bellX, bellY);
    ctx.rotate((calm() ? 0 : Math.sin(this.time * 9) * 0.12) * struck);
    // The yoke it hangs from, then the bell: a shouldered cone with a lip and a
    // clapper, which is what makes it a bell and not a lampshade.
    const R = H * 0.05;
    ctx.strokeStyle = 'rgba(201,162,39,0.8)';
    ctx.lineWidth = Math.max(1, H * 0.008);
    ctx.beginPath();
    ctx.moveTo(-R * 0.8, -R * 0.7);
    ctx.lineTo(R * 0.8, -R * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.7);
    ctx.lineTo(0, -R * 0.2);
    ctx.stroke();
    ctx.fillStyle = C.brass;
    ctx.beginPath();
    ctx.moveTo(-R * 0.9, R);
    ctx.quadraticCurveTo(-R * 0.78, -R * 0.28, 0, -R * 0.28);
    ctx.quadraticCurveTo(R * 0.78, -R * 0.28, R * 0.9, R);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,231,190,0.55)';
    ctx.fillRect(-R * 0.9, R, R * 1.8, Math.max(1, R * 0.16));
    ctx.fillStyle = 'rgba(201,162,39,0.9)';
    ctx.beginPath();
    ctx.arc(0, R * 1.28, Math.max(1, R * 0.16), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /*
     * The constellation: one saved light per lantern, stacked above the door.
     *
     * They arrive in the order the lanterns went in, which makes the count
     * readable as a count — this is the picture of what was rescued, and §10.5's
     * rule that a sub-stake return is never dressed as a win is why it is a row of
     * small lights and not a fountain.
     */
    for (let index = 0; index < inside; index += 1) {
      const entered = closedAt + 0.35 + index * 0.14;
      const life = Math.max(0, Math.min(1, (t - entered) / 0.45));
      if (life <= 0) continue;
      const spread = (index - (lamps - 1) / 2) * W * 0.3;
      const dy = top - H * (0.16 + (index % 2) * 0.1);
      const dot = { x: x + spread, y: dy };
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 * life;
      drawGlow(ctx, glowSprite('brass'), dot.x, dot.y, H * 0.3);
      ctx.restore();
      ctx.fillStyle = C.lampCore;
      ctx.globalAlpha = life;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, Math.max(1.4, H * 0.017), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  /**
   * The branch: one deck, dressed per §6.7's motif.
   *
   * Petrified wood, everything the runners touch. The read the material brief
   * asks for at this fidelity is three things — grain along the direction of
   * travel, a hairline fracture network, and a dust layer that lightens the
   * upward-facing surface toward `--fossil` — so those are the three passes.
   */
  private paintDeck(ctx: CanvasRenderingContext2D, w: number, h: number, theme: Theme): void {
    const lanes = this.scene.lanes;
    const deck = (lane: number, span?: readonly [number, number]) => {
      const thin = lane > 0;
      const thickness = h * theme.thickness * (thin ? 0.45 : 1);
      const from = span ? span[0] : thin ? w * 0.06 : -2;
      const to = span ? span[1] : thin ? w * 0.9 : w + 2;
      // The surface's own extent across this span, so every pass below can be
      // measured from the stone rather than from a horizontal line through it.
      let surfaceTop = Infinity;
      let surfaceBottom = -Infinity;
      for (let index = 0; index <= 24; index += 1) {
        const y = this.deckY((from + ((to - from) * index) / 24) / w, lane);
        surfaceTop = Math.min(surfaceTop, y);
        surfaceBottom = Math.max(surfaceBottom, y);
      }
      const bottom = surfaceBottom + thickness * 3.4;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(from, this.deckY(from / w, lane));
      // The upper face, from the same surface function the figures stand on.
      const steps = 56;
      for (let index = 0; index <= steps; index += 1) {
        const x = from + ((to - from) * index) / steps;
        ctx.lineTo(x, this.deckY(x / w, lane));
      }
      ctx.lineTo(to, bottom);
      ctx.lineTo(from, bottom);
      ctx.closePath();
      ctx.clip();

      /*
       * Everything below is measured from the *surface*, not from a fixed line.
       *
       * Windrow is raked 6 degrees and Crown's tine rises toward the Lamp (§6.7), so
       * a body fill, a grain line or a crack anchored to one horizontal `top` sits
       * on the stone at the middle of the span and off it at both ends. On Windrow
       * that left the lower half of the thin limb unpainted, showing the fog through
       * it as a pale plate — which is what a straight rule on a sloped limb looks
       * like.
       */
      const body = ctx.createLinearGradient(0, surfaceTop - thickness, 0, surfaceTop + thickness * 2.4);
      body.addColorStop(0, theme.stoneLit);
      body.addColorStop(0.3, theme.stone);
      body.addColorStop(1, C.void);
      ctx.fillStyle = body;
      ctx.fillRect(from, surfaceTop - thickness * 1.4, to - from, bottom - surfaceTop + thickness * 2);

      // Grain, along the direction of travel (§6.2, and §6.7's arena 2 motif).
      ctx.lineWidth = 1;
      for (let line = 0; line < 9; line += 1) {
        const depth = (line / 9) * thickness * 1.9 + 1;
        ctx.strokeStyle = `rgba(216,207,187,${0.1 - line * 0.009})`;
        ctx.beginPath();
        for (let index = 0; index <= 32; index += 1) {
          const x = from + ((to - from) * index) / 32;
          const wobble = Math.sin(index * 0.7 + line * 2.3) * thickness * 0.05;
          const y = this.deckY(x / w, lane) + depth + wobble;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // A hairline fracture network, in the cavity of the stone. Near-vertical:
      // §6.2 asks for a fracture network, and a shallow diagonal reads as hatching.
      ctx.strokeStyle = 'rgba(14,17,20,0.6)';
      for (let crack = 0; crack < 9; crack += 1) {
        const x = from + hash01(crack * 4.1 + lane) * (to - from);
        const y = this.deckY(x / w, lane);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (hash01(crack + 9) - 0.5) * 4, y + thickness * (0.5 + hash01(crack) * 0.7));
        ctx.stroke();
      }

      /*
       * The dust layer: upward-facing surfaces lighten toward `--fossil` (§6.2).
       *
       * Drawn along the actual surface rather than as a straight rule, because on a
       * raked or rising limb a straight highlight crosses the stone instead of
       * sitting on it — and this line is the one that tells the player where the
       * walking surface is.
       */
      ctx.strokeStyle = theme.wet ? 'rgba(214,221,224,0.3)' : 'rgba(216,207,187,0.4)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let index = 0; index <= 56; index += 1) {
        const x = from + ((to - from) * index) / 56;
        const y = this.deckY(x / w, lane);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      if (theme.embers) {
        // The Char's crack network, carrying `--ember` (§6.7's declared exception:
        // it is heat, it casts no shadow, and it illuminates nothing).
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(210,98,28,0.7)';
        ctx.lineWidth = 1.2;
        for (let crack = 0; crack < 12; crack += 1) {
          const x = from + hash01(crack * 2.9) * (to - from);
          const y = this.deckY(x / w, lane);
          ctx.beginPath();
          ctx.moveTo(x, y + 1);
          ctx.lineTo(x + (hash01(crack * 5) - 0.5) * 22, y + thickness * (0.4 + hash01(crack * 7)));
          ctx.stroke();
        }
      }
      ctx.restore();

      if (theme.wet) {
        // Standing water pooled in the grain — the only reflective surface in the
        // game, and it is spent here so the following four arenas can be dry.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let pool = 0; pool < 4; pool += 1) {
          const x = from + hash01(pool * 6.3) * (to - from);
          const width = 18 + hash01(pool) * 34;
          const y = this.deckY(x / w, lane);
          const gradient = ctx.createLinearGradient(x, y, x + width, y + 2);
          gradient.addColorStop(0, 'rgba(138,152,160,0)');
          gradient.addColorStop(0.5, 'rgba(138,152,160,0.22)');
          gradient.addColorStop(1, 'rgba(138,152,160,0)');
          ctx.fillStyle = gradient;
          ctx.fillRect(x, y - 1, width, 2.5);
        }
        ctx.restore();
      }
    };

    if (theme.motif === 'ridges') this.paintRidges(ctx, w, h, theme);
    for (let lane = 0; lane < Math.max(1, lanes); lane += 1) {
      /*
       * A lane that has given way is drawn broken.
       *
       * §6.7's arenas collapse under the runners, and the transcript says which lane
       * did — so the stone the player is looking at afterwards has a hole in it. It
       * is drawn as two pieces with the middle third missing rather than as a
       * darkened whole, because §S6 is a branch that is no longer there.
       */
      const broken = this.scene.collapsed[lane] === true;
      const thin = lane > 0;
      const start = thin ? w * 0.06 : -2;
      const end = thin ? w * 0.9 : w + 2;
      if (!broken) deck(lane);
      else {
        const gap = (end - start) * 0.34;
        const mid = start + (end - start) * 0.36;
        deck(lane, [start, mid]);
        deck(lane, [mid + gap, end]);
      }
    }
    if (theme.motif === 'diagonals') this.paintCables(ctx, w, h, theme);
    if (theme.motif === 'shattered') this.paintSplinters(ctx, w, h, theme);
  }

  /** §6.7 arena 2: the whole arena reads as perspective lines to a vanishing point. */
  private paintRidges(ctx: CanvasRenderingContext2D, w: number, h: number, theme: Theme): void {
    const top = theme.deck * h;
    ctx.save();
    ctx.strokeStyle = 'rgba(216,207,187,0.09)';
    for (let ridge = 0; ridge < 7; ridge += 1) {
      const spread = (ridge - 3) / 3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, top + spread * h * 0.11);
      ctx.lineTo(w, top + spread * h * 0.022);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** §6.7 arena 3: petrified vine-cables, the only vertical elements, and they hum. */
  private paintCables(ctx: CanvasRenderingContext2D, w: number, h: number, theme: Theme): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(18,22,26,0.75)';
    for (let cable = 0; cable < 3; cable += 1) {
      const x = w * (0.2 + cable * 0.31);
      ctx.lineWidth = 2 + cable * 0.6;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + 8, h * 0.4, x - 4, theme.deck * h + 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** §6.7 arena 4: every edge is a fracture plane; nothing is a smooth curve. */
  private paintSplinters(ctx: CanvasRenderingContext2D, w: number, h: number, theme: Theme): void {
    const top = theme.deck * h;
    ctx.save();
    ctx.fillStyle = SILHOUETTE;
    for (let shard = 0; shard < 5; shard += 1) {
      const x = w * (0.1 + hash01(shard * 3.3) * 0.8);
      const size = 5 + hash01(shard) * 12;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + size, top - size * 0.9);
      ctx.lineTo(x + size * 1.7, top);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------- fog */

  /**
   * The fog: the game's depth cue and its dread (§6.2).
   *
   * What is fixed on every tier is the *silhouette behaviour* — figures dissolve
   * into `--fog-far` with distance, lanterns scatter warmth into the near fog, and
   * the fog has visible internal parallax so the branch reads as suspended in a
   * volume rather than pasted on a backdrop. Three blits of one tiling texture at
   * three speeds is what buys the parallax; the warm scatter is the second glow
   * pass in `paintFigures`, drawn after this layer.
   */
  private paintFog(ctx: CanvasRenderingContext2D, layer: 0 | 1): void {
    const theme = this.theme();
    const tile = fogTile();
    const h = this.height;
    const w = this.width;
    const top = h * theme.fogTop;

    ctx.save();
    if (layer === 0) {
      /*
       * The sea below, with a visible surface (§6.7 arena 2: *"a flat white sea with
       * a visible surface. The player learns what falling means."*).
       *
       * It brightens toward the surface and then goes *down* again into the deeper
       * volume, rather than brightening all the way to the frame edge — a fog that
       * gets lighter to the bottom of the screen reads as a floor, and the whole
       * point of this layer is that there is no floor.
       */
      const sea = ctx.createLinearGradient(0, top - h * 0.05, 0, h);
      sea.addColorStop(0, 'rgba(138,152,160,0)');
      sea.addColorStop(0.16, `rgba(176,188,195,${(0.34 * theme.fogDensity).toFixed(3)})`);
      sea.addColorStop(0.42, `rgba(126,140,149,${(0.34 * theme.fogDensity).toFixed(3)})`);
      sea.addColorStop(1, `rgba(24,29,34,${(0.72 * theme.fogDensity).toFixed(3)})`);
      ctx.fillStyle = sea;
      ctx.fillRect(0, top - h * 0.05, w, h - top + h * 0.05);
    }

    const bands: readonly [number, number, number][] =
      layer === 0
        ? [
            [11, 0.1 * theme.fogDensity, 0.9],
            [23, 0.09 * theme.fogDensity, 1.5],
          ]
        : [[41, 0.08 * theme.fogDensity, 2.4]];

    const drift = calm() ? 0 : this.time;
    for (const [speed, alpha, scale] of bands) {
      const bandHeight = h * 0.5 * scale;
      const y = top - bandHeight * 0.55;
      const width = w * 1.9 * scale;
      const offset = -((drift * speed + this.scene.progress * 140) % width);
      ctx.globalAlpha = alpha;
      ctx.drawImage(tile, offset, y, width, bandHeight);
      ctx.drawImage(tile, offset + width, y, width, bandHeight);
    }

    if (theme.ribbons) {
      // §6.7 arena 3: horizontal ribbons streaming left to right at 4 m/s. The
      // player reads wind before they hear it.
      ctx.globalAlpha = 0.16;
      for (let ribbon = 0; ribbon < 4; ribbon += 1) {
        const y = h * (0.2 + ribbon * 0.16) + Math.sin(this.time * 0.4 + ribbon) * 3;
        const width = w * 1.4;
        const offset = -(((drift * (120 + ribbon * 26)) % width) - 0);
        ctx.drawImage(tile, offset, y, width, h * 0.1);
        ctx.drawImage(tile, offset + width, y, width, h * 0.1);
      }
    }

    if (theme.embers && layer === 1) this.paintEmbers(ctx);
    ctx.restore();
  }

  /** §6.7 arena 4: embers drift *upward*, the only upward motion in the game. */
  private paintEmbers(ctx: CanvasRenderingContext2D): void {
    const theme = this.theme();
    const top = theme.deck * this.height;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let index = 0; index < 16; index += 1) {
      const seed = index * 4.7;
      const speed = 14 + hash01(seed) * 22;
      const span = this.height * 0.5;
      const rise = calm() ? span * hash01(seed + 3) : ((this.time * speed + hash01(seed + 1) * span) % span);
      const x = hash01(seed + 2) * this.width + Math.sin(this.time * 0.7 + index) * 4;
      const alpha = (1 - rise / span) * 0.55;
      ctx.fillStyle = `rgba(210,98,28,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, top - rise, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private paintDust(ctx: CanvasRenderingContext2D, delta: number): void {
    if (this.dust.length === 0) return;
    ctx.save();
    for (const mote of this.dust) {
      mote.life -= delta;
      mote.x += mote.vx * delta;
      mote.y += mote.vy * delta;
      mote.vy += 22 * delta;
      if (mote.life <= 0) continue;
      ctx.fillStyle = `rgba(216,207,187,${Math.max(0, mote.life) * 0.3})`;
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    this.dust = this.dust.filter((mote) => mote.life > 0);
    ctx.restore();
  }

  /* --------------------------------------------------------------- figures */

  private paintFigures(ctx: CanvasRenderingContext2D, delta: number): void {
    const height = this.figureHeight();
    const bodies = [...this.bodies.values()].sort((a, b) => a.lane - b.lane || a.u - b.u);
    const doorTime = this.houseTime();

    for (const body of bodies) {
      body.phase += delta;
      if (body.pose === 'fall') {
        body.fell += delta;
        /*
         * §6.3: the death of a light is a lighting event. The point light falls off
         * over 220 ms with a slight blue shift, and the local fog loses its warm
         * scatter with it.
         *
         * *When* it starts is the difference between an ordinary fall and §9's shot.
         * A runner who drops out of a five-body arena loses their light as they
         * leave — the frame gets colder and the squad's rhythm thins. The hero
         * descent is the opposite: *"We stay with it … all the way down until the
         * glass gives out and the light goes."* The glass gives out at the end of
         * the fall, not at the start of it, so the hero keeps its light for the
         * length of the descent and then loses it.
         */
        const givesOut = body.hero ? 1.4 : 0.16;
        if (body.fell > givesOut) {
          body.light = Math.max(0, body.light - delta / 0.22);
          body.chill = Math.min(1, body.chill + delta / 0.22);
        }
        if (body.hero) this.heroSlot = body.slot;
        if (body.fell > 4.5) body.pose = 'gone';
      } else if (this.scene.mode === 'door') {
        /*
         * §S5's file into the doorway: one at a time, and only once it is open.
         *
         * The walk is at a constant rate rather than the eased approach every
         * other screen uses, because an asymptote never arrives — and this one has
         * to arrive, on a schedule the screen above the stage is timing its own
         * beats against (`DOOR_BEAT`).
         */
        const due = (DOOR_BEAT.openMs + body.order * DOOR_BEAT.perLanternMs) / 1000;
        if (doorTime >= due) body.u = Math.min(DOOR_U, body.u + delta * 1.15);
        if (calm()) body.u = DOOR_U;
        if (body.u >= DOOR_U - 0.004 && !body.inside) {
          body.inside = true;
          body.pose = 'home';
        }
      } else {
        body.u += (body.targetU - body.u) * Math.min(1, delta * (calm() ? 20 : 2.6));
      }
      // Inside the Lamp House: safe, and off the branch. The light it carried is
      // the constellation above the door from here on.
      if (body.inside || body.pose === 'gone') continue;
      this.paintKindling(ctx, body, height);
      if (this.scene.names && height >= 26) this.paintName(ctx, body, height);
    }

    // The warm scatter, drawn *after* the near fog so a lantern lights the fog in
    // front of it rather than being covered by it (§6.2's fixed behaviour).
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const body of bodies) {
      if (body.light <= 0.02 || body.inside) continue;
      const { x, y } = this.figureAnchor(body, height);
      const lanternY = y - height * 0.56;
      const radius = height * (2.4 + this.bloom * 2.2);
      ctx.globalAlpha = 0.22 * body.light;
      drawGlow(ctx, glowSprite('warm'), x, lanternY, radius);
      if (this.theme().wet) {
        // Lanterns double in the pools (§6.7 arena 1).
        ctx.globalAlpha = 0.1 * body.light;
        drawGlow(ctx, glowSprite('warm'), x, y + height * 0.12, radius * 0.7);
      }
    }
    ctx.restore();
  }

  /**
   * The name on the figure (§6.5: *"as if written on a luggage tag tied to the
   * figure"*, and §10.1: individuals are named).
   *
   * A fallen runner's name goes to `--extinguish` and stays on screen while the
   * figure is still in frame, because the moment of loss is the moment the name
   * matters. The authoritative named list is still in the document below the
   * stage — this is the label on the object, not the accessible text.
   */
  private paintName(ctx: CanvasRenderingContext2D, body: Body, height: number): void {
    const { x, y } = this.figureAnchor(body, height);
    if (y > this.height + height) return;
    ctx.save();
    ctx.font = `italic 13px ${'ui-sans-serif, system-ui, sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const fading = body.pose === 'fall' ? Math.max(0, 1 - body.fell / 2.2) : 1;
    // A dead runner's name is the reading that matters most on the screen it is
    // on, so it takes the *text* tint of `--extinguish` (5.4:1) rather than the
    // object colour (2.12:1) the round-1 build painted it in.
    const ink =
      body.pose === 'home'
        ? `rgba(201,162,39,${fading})`
        : body.light < 0.5
          ? `rgba(156,143,174,${fading})`
          : `rgba(138,152,160,${fading})`;
    /*
     * Two rows, and a leader line down to the figure it belongs to.
     *
     * Alternating rows keep five names from overlapping — adjacent figures are
     * ~40 px apart and same-row names are ~80. What that alone does not do is say
     * *which figure* a label belongs to: the round-2 review found five labels
     * floating at five heights reading as a debug overlay, and on a 3+1 fork the
     * thin-limb runner's name drawn above the broad limb, next to the three
     * runners she is not with — on the one screen whose whole point is knowing
     * who took the thin limb. A tag needs a string to the thing it is tied to
     * (§6.5: *"as if written on a luggage tag tied to the figure"*), so the label
     * is anchored over its own figure's *lane* and the line is drawn.
     */
    const row = [...this.bodies.keys()].sort((a, b) => a - b).indexOf(body.slot) % 2;
    /*
     * On a fork the thin limb's names go *below* their own figures.
     *
     * Above, they land in the air over the broad limb — which is how `Sable` came
     * to be labelled among the three runners she is not with. There is nothing
     * under the thin limb but fog, so that is where its labels belong, and the
     * two lanes' names can then never be read as one row.
     */
    const under = body.lane > 0 && this.scene.lanes > 1;
    const top = under ? y + height * 0.58 : y - height * (row === 0 ? 1.2 : 1.58);
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, under ? y + 2 : top + 4);
    ctx.lineTo(x, under ? top - 11 : y - height * 0.98);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink;
    ctx.shadowColor = 'rgba(14,17,20,0.95)';
    ctx.shadowBlur = 4;
    ctx.fillText(body.name, x, top);
    ctx.restore();
  }

  private figureAnchor(body: Body, height: number): { x: number; y: number } {
    const { x, y } = this.place(body.u, body.lane);
    if (body.pose !== 'fall') return { x, y };
    const t = Math.max(0, body.fell);
    // §6.4: weighted-light. 0.7 g for the first 400 ms so the fall registers and
    // the lantern arcs legibly, then full gravity.
    const g = height * 42;
    const soft = 0.7 * g;
    const drop =
      t < 0.4 ? 0.5 * soft * t * t : 0.5 * soft * 0.16 + soft * 0.4 * (t - 0.4) + 0.5 * g * (t - 0.4) ** 2;
    return { x: x + t * height * 0.5, y: y + drop };
  }

  /**
   * A Kindling: woven reed, linen and leather, with a blown-glass lantern set
   * into the chest where a heart would be (§1).
   *
   * It is drawn as a silhouette with two rims — a warm one from its own lantern
   * and a cool one from the sky key — because that is what §6.6's first reference
   * produces and what the 90/10 ratio in §6.1 requires: the figure is not
   * illuminated, it is *cut out of* the fog by the light it carries.
   *
   * §1's originality guard is a drawing constraint here and not a note: the
   * silhouette is a hand-made armature — a bundled torso with a visible shoulder
   * join, a hanging linen wrap, thin reed limbs and a knot for a head. It is
   * deliberately not a rounded body with a big head, because that is the register
   * the guard rejects by name.
   */
  private paintKindling(ctx: CanvasRenderingContext2D, body: Body, height: number): void {
    const { x, y } = this.figureAnchor(body, height);
    /*
     * Imperfect symmetry, per figure (§6.6's third reference).
     *
     * *"Real cloth weave, imperfect symmetry, thumbprints in the material."* Five
     * identical figures read as five instances of one asset; a few percent of height
     * and a mirrored wrap read as five things somebody made by hand. The variation
     * is a pure function of the slot, so it is the same figure every round.
     */
    const H = height * (0.93 + hash01(body.seed * 2.7) * 0.14);
    const flip = hash01(body.seed * 5.1) > 0.5 ? -1 : 1;
    const falling = body.pose === 'fall';
    const travelling = body.pose === 'travel';

    // Secondary motion is stepped to 12 fps in time (§6.4); root motion is not.
    const step = stepped(body.phase + body.seed);
    const sway = Math.sin(step * 3.1 + body.seed);
    const gait = travelling ? Math.sin(body.phase * 7.2 + body.seed) : 0;
    const bob = travelling
      ? Math.abs(Math.cos(body.phase * 7.2 + body.seed)) * H * 0.03
      : Math.sin(step * 1.6 + body.seed) * H * 0.01;
    // §6.4: the determined run lean. Nothing else in the game leans.
    const lean = travelling ? -0.15 : falling ? 0 : sway * 0.012;
    // §6.4: the ragdoll never flails comically — joint limits are tight, so the
    // rotation is clamped and the figure keeps reaching upward for the branch.
    const spin = falling ? Math.max(-0.9, Math.min(0.9, body.fell * 1.3)) : 0;

    /*
     * Three values, not one.
     *
     * A single flat fill made the whole figure one blob and the blob read as a
     * lamppost. §6.6's third reference is exposed-craft puppetry *with the wire
     * showing*, which needs internal edges: the linen wrap is the darkest thing on
     * the figure, the reed limbs sit between, and the bundled torso is the lightest
     * — three values close enough to stay a silhouette and far enough apart to
     * describe a shape.
     */
    const CLOAK = '#0c0f12';
    const LIMB = '#141920';
    const TORSO = '#1c222a';

    ctx.save();

    // A baked contact-shadow decal under the figure, not a shadow map (§6.3).
    if (!falling) {
      ctx.fillStyle = 'rgba(14,17,20,0.45)';
      ctx.beginPath();
      ctx.ellipse(x, y + 1, H * 0.16, H * 0.028, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.translate(x, y - bob);
    ctx.rotate(lean + spin);

    const hip = -H * 0.38;
    const shoulder = -H * 0.78;
    const halfShoulder = H * 0.13;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    /*
     * Reed legs, with a stance.
     *
     * At rest the feet are apart: two legs drawn from the same hip to the same
     * point are one stalk, which is the other half of why this read as a lamppost.
     * Falling, they fold under rather than splaying — tight joint limits (§6.4).
     */
    ctx.strokeStyle = LIMB;
    ctx.lineWidth = Math.max(1.3, H * 0.05);
    const legs: readonly [number, number][] = falling
      ? [
          [H * 0.16, H * 0.14],
          [-H * 0.04, H * 0.22],
        ]
      : travelling
        ? [
            [gait * H * 0.19, Math.max(0, gait) * H * 0.1],
            [-gait * H * 0.19, Math.max(0, -gait) * H * 0.1],
          ]
        : [
            [-H * 0.075, 0],
            [H * 0.085, 0],
          ];
    for (const [dx, lift] of legs) {
      ctx.beginPath();
      ctx.moveTo(0, hip);
      ctx.quadraticCurveTo(dx * 0.45, hip + H * 0.19, dx, -lift);
      ctx.stroke();
      // A foot, so the leg ends in something that stands rather than in a point.
      ctx.beginPath();
      ctx.moveTo(dx - H * 0.022, -lift);
      ctx.lineTo(dx + H * 0.042, -lift - H * 0.004);
      ctx.stroke();
    }

    /*
     * The bundled torso: taller than it is wide, waisted, with the reed weave
     * showing. §1 asks for woven reed, linen and leather and for figures that are
     * *"not cute … earnest, slightly battered, and clearly made by hand"*.
     */
    ctx.fillStyle = TORSO;
    ctx.beginPath();
    ctx.moveTo(-H * 0.075, hip);
    ctx.quadraticCurveTo(-H * 0.115, hip - H * 0.16, -H * 0.115, shoulder + H * 0.02);
    ctx.lineTo(H * 0.115, shoulder + H * 0.02);
    ctx.quadraticCurveTo(H * 0.115, hip - H * 0.16, H * 0.085, hip);
    ctx.closePath();
    ctx.fill();

    // The weave, at two scales: visible at 30 cm and invisible at 30 m (§6.6).
    ctx.strokeStyle = 'rgba(216,207,187,0.11)';
    ctx.lineWidth = 1;
    for (let band = 0; band < 4; band += 1) {
      const level = shoulder + (hip - shoulder) * (0.16 + band * 0.24);
      ctx.beginPath();
      ctx.moveTo(-H * 0.1, level);
      ctx.lineTo(H * 0.1, level);
      ctx.stroke();
    }

    // An aged leather strap at the waist, with its wax specular (§6.2).
    ctx.strokeStyle = 'rgba(122,98,72,0.6)';
    ctx.lineWidth = Math.max(1, H * 0.022);
    ctx.beginPath();
    ctx.moveTo(-H * 0.09, hip - H * 0.05);
    ctx.lineTo(H * 0.09, hip - H * 0.04);
    ctx.stroke();

    /*
     * The linen wrap, asymmetric and hanging off one shoulder, stepped at 12 fps.
     * Travelling it flattens back; on Windrow's exposed ledge that is the cloth §6.7
     * says the fog ribbons press against them.
     */
    const flutter = travelling ? H * 0.1 : sway * H * 0.014;
    ctx.fillStyle = CLOAK;
    ctx.beginPath();
    ctx.moveTo(flip * H * 0.105, shoulder + H * 0.02);
    ctx.quadraticCurveTo(
      flip * (H * 0.2 - flutter),
      hip - H * 0.16,
      flip * (H * 0.12 - flutter * 1.6),
      hip + H * 0.12,
    );
    ctx.quadraticCurveTo(flip * H * 0.02, hip + H * 0.06, flip * -H * 0.05, hip - H * 0.02);
    ctx.lineTo(flip * -H * 0.02, shoulder + H * 0.04);
    ctx.closePath();
    ctx.fill();

    /*
     * Arms. Two segments with the elbow where an elbow goes, so the figure has a
     * gesture. Falling, they reach *up*: the figure keeps trying to grab (§6.4).
     */
    ctx.strokeStyle = LIMB;
    ctx.lineWidth = Math.max(1.1, H * 0.038);
    for (const side of [-1, 1] as const) {
      const swing = travelling ? -side * gait : side * sway * 0.25;
      // Outside the torso silhouette, or the arm is not an arm — it is a shading
      // detail inside the body and the figure reads as a post with a lamp on it.
      const elbow = { x: side * H * 0.185, y: shoulder + H * 0.15 - swing * H * 0.03 };
      const hand = falling
        ? { x: side * H * 0.12, y: shoulder - H * 0.17 }
        : { x: side * H * 0.16 + swing * H * 0.055, y: shoulder + H * 0.29 + swing * H * 0.035 };
      ctx.beginPath();
      ctx.moveTo(side * halfShoulder * 0.85, shoulder + H * 0.03);
      ctx.lineTo(elbow.x, elbow.y);
      ctx.lineTo(hand.x, hand.y);
      ctx.stroke();
    }

    /*
     * The shoulder yoke, with the join showing at each end — §6.6's *"visible join
     * at the shoulder"*, which is the single detail that says someone built this.
     */
    ctx.strokeStyle = LIMB;
    ctx.lineWidth = Math.max(1.5, H * 0.052);
    ctx.beginPath();
    ctx.moveTo(-halfShoulder, shoulder + H * 0.01);
    ctx.lineTo(halfShoulder, shoulder);
    ctx.stroke();
    ctx.fillStyle = 'rgba(122,98,72,0.5)';
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.arc(side * halfShoulder, shoulder + (side < 0 ? H * 0.01 : 0), Math.max(0.8, H * 0.017), 0, Math.PI * 2);
      ctx.fill();
    }

    /*
     * The head: a small knot with a strap round it, close to the shoulders, and no
     * face. It is small on purpose — a large head on a small body is the party-game
     * silhouette §1's originality guard rejects by name.
     */
    const headY = shoulder - H * 0.055;
    ctx.fillStyle = LIMB;
    ctx.beginPath();
    ctx.ellipse(sway * H * 0.008 + (travelling ? -H * 0.012 : 0), headY, H * 0.055, H * 0.062, sway * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(122,98,72,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-H * 0.05, headY + H * 0.008);
    ctx.lineTo(H * 0.05, headY - H * 0.004);
    ctx.stroke();

    /*
     * The cool rim from the sky key. §6.3: its job is to give the world
     * silhouettes, not to illuminate it — so it is one edge, on the side the key
     * comes from, and it stops there.
     */
    ctx.strokeStyle = 'rgba(138,152,160,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-H * 0.112, shoulder + H * 0.03);
    ctx.quadraticCurveTo(-H * 0.118, hip - H * 0.16, -H * 0.08, hip - H * 0.02);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, headY, H * 0.056, Math.PI * 1.05, Math.PI * 1.6);
    ctx.stroke();

    this.paintLantern(ctx, body, H, H * 0.26, shoulder, hip);
    ctx.restore();
  }

  /**
   * The lantern: thin blown glass in an aged brass frame, with an emissive core.
   *
   * §6.2 rules out a refraction pass on every tier — *"the read we want is 'a lit
   * object behind slightly warped glass', and a fresnel rim over a probe delivers
   * it"* — so the glass here is exactly that: a bright core, a fresnel rim arc on
   * the lit edge, and a brass frame with patina in the crevice. Nothing refracts.
   */
  private paintLantern(
    ctx: CanvasRenderingContext2D,
    body: Body,
    H: number,
    w: number,
    shoulder: number,
    hip: number,
  ): void {
    const size = H * 0.165;
    const cy = shoulder + (hip - shoulder) * 0.42;
    const swing = stepped(body.phase * 1.3 + body.seed);
    // Falling, the lantern trails behind on its strap and arcs legibly (§6.4).
    const cx =
      body.pose === 'fall'
        ? -Math.sin(body.fell * 3.4) * w * 0.5
        : Math.sin(swing * 2.2 + body.seed) * w * 0.07;

    const warm = body.light;
    const cold = body.chill;
    const core = warm > 0.02 ? mix(C.lampCore, C.extinguish, cold) : C.extinguish;

    if (body.pose === 'fall') {
      ctx.strokeStyle = 'rgba(122,98,72,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cy - size * 0.4);
      ctx.lineTo(cx, cy);
      ctx.stroke();
    }

    /*
     * The glass, in three layers and no more.
     *
     * A flame, not a screen: the warm falloff (`--ember` at the edge, `--lamp`
     * through the body, `--lamp-core` at the centre) is what separates a lantern
     * from a lit rectangle, and the first build of this got it wrong by filling one
     * near-white square. The brass frame is a rounded cage around it, which at this
     * size is two arcs' worth of hint rather than a drawn object.
     */
    ctx.fillStyle = warm > 0.02 ? mix(C.ember, C.extinguish, cold) : C.extinguish;
    ctx.globalAlpha = 0.5 + warm * 0.4;
    roundRect(ctx, cx - size * 0.44, cy - size * 0.44, size * 0.88, size * 0.88, size * 0.4);
    ctx.fill();

    ctx.fillStyle = warm > 0.02 ? mix(C.lamp, C.extinguish, cold) : C.extinguish;
    ctx.globalAlpha = 0.6 + warm * 0.4;
    roundRect(ctx, cx - size * 0.32, cy - size * 0.32, size * 0.64, size * 0.64, size * 0.3);
    ctx.fill();

    if (warm > 0.02) {
      ctx.fillStyle = core;
      ctx.globalAlpha = warm;
      ctx.beginPath();
      ctx.arc(cx, cy - size * 0.04, size * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /*
     * The brass cage: two uprights and a lid.
     *
     * A ring around the glass read as a hole in the chest. A lantern frame is
     * vertical bars and a cap, which is also what makes the object read as *set
     * into* the torso rather than painted on it.
     */
    ctx.strokeStyle = body.pose === 'home' ? C.brass : 'rgba(201,162,39,0.72)';
    ctx.lineWidth = 1;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(cx + side * size * 0.5, cy - size * 0.5);
      ctx.lineTo(cx + side * size * 0.5, cy + size * 0.5);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.56, cy - size * 0.5);
    ctx.lineTo(cx + size * 0.56, cy - size * 0.5);
    ctx.stroke();

    // The fresnel rim: a bright arc on the lit edge, which is the whole trick.
    if (warm > 0.02) {
      ctx.strokeStyle = `rgba(255,231,190,${0.55 * warm})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.4, Math.PI * 0.95, Math.PI * 1.8);
      ctx.stroke();
    }

    if (body.pose === 'home') {
      // §9: the light comes through the door's grille from inside — safe, and
      // visibly still burning. Brass, not lamp: banked money is its own family.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4;
      drawGlow(ctx, glowSprite('brass'), cx, cy, size * 5);
      ctx.restore();
    }
  }

  /* -------------------------------------------------------------- vignette */

  /**
   * The vignette, and §9's spotlight.
   *
   * *"The camera cuts to 24 mm, close behind the last Kindling … There is no HUD
   * except the claim."* The narrowing is here: one radial mask whose radius the
   * scene's `lastLamp` flag drives. It is a camera move, not a colour grade, so it
   * is applied after the world transform and never scales with it.
   */
  private paintVignette(ctx: CanvasRenderingContext2D): void {
    const key = `${this.width}x${this.height}|${this.dpr}`;
    if (this.vignetteKey !== key || !this.vignette) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(this.width * this.dpr);
      canvas.height = Math.round(this.height * this.dpr);
      const local = canvas.getContext('2d') as CanvasRenderingContext2D;
      local.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const radius = Math.max(this.width, this.height) * 0.9;
      const gradient = local.createRadialGradient(
        this.width * 0.5,
        this.height * 0.46,
        radius * 0.42,
        this.width * 0.5,
        this.height * 0.46,
        radius,
      );
      gradient.addColorStop(0, 'rgba(14,17,20,0)');
      gradient.addColorStop(1, 'rgba(14,17,20,0.5)');
      local.fillStyle = gradient;
      local.fillRect(0, 0, this.width, this.height);
      this.vignette = canvas;
      this.vignetteKey = key;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.vignette, 0, 0, this.width, this.height);

    if (this.spot < 0.99) {
      const strength = 1 - this.spot;
      const focus = this.bodies.size === 1 ? [...this.bodies.values()][0] : undefined;
      // On the door screen the subject is the door, whatever is still walking
      // toward it: the narrowing is what puts the frame's attention on the light.
      const x =
        this.scene.mode === 'door'
          ? DOOR_U * this.width
          : focus
            ? this.place(focus.u, focus.lane).x
            : this.width * 0.5;
      const gradient = ctx.createRadialGradient(
        x,
        this.height * 0.5,
        this.width * this.spot * 0.28,
        x,
        this.height * 0.5,
        this.width * (0.3 + this.spot * 0.9),
      );
      gradient.addColorStop(0, 'rgba(14,17,20,0)');
      gradient.addColorStop(1, `rgba(14,17,20,${0.86 * strength})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }
}

/* --------------------------------------------------------- shared textures */

let tile: HTMLCanvasElement | null = null;

/**
 * One tiling fog texture, built once.
 *
 * Soft blobs at three scales, blurred, with the left and right edges mirrored so
 * two copies laid side by side have no seam — which is what makes three scrolling
 * copies read as one volume with internal parallax rather than as three bands.
 */
function fogTile(): HTMLCanvasElement {
  if (tile) return tile;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.filter = 'blur(14px)';
  for (let blob = 0; blob < 44; blob += 1) {
    const x = hash01(blob * 1.7) * size;
    const y = hash01(blob * 3.1 + 5) * size;
    const r = 14 + hash01(blob * 5.3) * 46;
    ctx.fillStyle = `rgba(214,221,224,${0.1 + hash01(blob * 7.1) * 0.16})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // The wrap: every blob is drawn again one tile over, so the seam matches.
    ctx.beginPath();
    ctx.arc(x - size, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + size, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = 'none';
  tile = canvas;
  return canvas;
}

const glows = new Map<string, HTMLCanvasElement>();

/** A pre-rendered glow. A gradient built per frame per lantern is the slow way. */
function glowSprite(kind: 'warm' | 'brass'): HTMLCanvasElement {
  const found = glows.get(kind);
  if (found) return found;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  if (kind === 'warm') {
    gradient.addColorStop(0, 'rgba(255,231,190,0.95)');
    gradient.addColorStop(0.14, 'rgba(255,165,61,0.5)');
    gradient.addColorStop(0.45, 'rgba(210,98,28,0.14)');
    gradient.addColorStop(1, 'rgba(210,98,28,0)');
  } else {
    gradient.addColorStop(0, 'rgba(255,231,190,0.7)');
    gradient.addColorStop(0.2, 'rgba(201,162,39,0.4)');
    gradient.addColorStop(1, 'rgba(201,162,39,0)');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  glows.set(kind, canvas);
  return canvas;
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
): void {
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Two hex colours, mixed. Used for one thing: a dying light going blue (§6.3). */
function mix(from: string, to: string, t: number): string {
  const parse = (hex: string) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  const a = parse(from);
  const b = parse(to);
  const channel = (index: number) =>
    Math.round((a[index] as number) + ((b[index] as number) - (a[index] as number)) * t);
  return `rgb(${channel(0)},${channel(1)},${channel(2)})`;
}


export const stage = new Stage();
