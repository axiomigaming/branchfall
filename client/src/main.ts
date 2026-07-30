/**
 * BRANCHFALL — the graybox client.
 *
 * Portrait, mobile-first, one screen at a time, every primary action in the
 * bottom thumb zone. It renders `docs/DESIGN.md` §5's screen flow at placeholder
 * fidelity: the information architecture, the copy and every number are the real
 * ones; the branch is a rectangle and a Kindling is a stroke with a lantern dot.
 *
 * Two things this client is not allowed to be, and both are structural rather
 * than a matter of care:
 *
 * - **a judge.** It never computes a probability, a multiplier or a credit. The
 *   server does, from the engine, and the client renders what it is handed
 *   (§6.9: the renderer is a player, not a judge).
 * - **a holder of the tape.** It never receives a hazard draw before settlement.
 *   The one place it legitimately holds a table is the rehearsal, which has no
 *   stake, no wallet and no ledger entry in it (`ENGINE.md` §10.2).
 */
import {
  ApiError,
  api,
  credits,
  creditsSigned,
  idempotencyKey,
  isSeed,
  micro,
  multiplier,
  newClientSeed,
  pct,
  wasWipe,
} from './api.js';
import * as sound from './audio.js';
import * as clip from './clip.js';
import { COPY } from './copy.js';
import { rederive, type Rederivation } from './derive.js';
import { el, frag, type Child } from './dom.js';
import { CAUSE_HOLD, countUp, sequence, setCalmPreference } from './motion.js';
import {
  DOOR_BEAT,
  doorClosedMs,
  setQuality,
  stage,
  type StageMode,
  type StageRunner,
  type Quality,
  type StageScene,
} from './stage.js';
import type {
  ArenaRecord,
  Config,
  Figures,
  Frame,
  GhostRow,
  MenuEntry,
  RehearsalResult,
  Session,
  VerifyCheck,
  WalletView,
} from './types.js';
import {
  claimMeter,
  distributionBars,
  field,
  heroFigure,
  oddsTable,
  routeCard,
  routeTabs,
} from './widgets.js';

type View =
  | 'squad'
  | 'stake'
  | 'route'
  | 'run'
  | 'resolve'
  | 'wipe'
  | 'banked'
  | 'summary'
  | 'verify'
  | 'settings'
  | 'rehearsal';

/**
 * A sheet, as a *builder* rather than as a built tree.
 *
 * This was `body: Child`, built once at the moment the sheet was opened, and it
 * was a live defect the round-2 review reproduced: `render()` empties the root
 * and re-appends `state.sheet.body`, and appending a `DocumentFragment` **moves**
 * its children out — so the second render appended an empty fragment and the
 * sheet collapsed to a header-only stub over a scrimmed, inert screen. Any
 * re-render the sheet did not itself trigger did it: the scheduled reality check
 * was the one found in play, and it left the 32 x 25 px `close` link as the only
 * way out.
 *
 * A builder cannot have that bug: the tree is constructed fresh on every render,
 * from state, like every other screen in this client.
 */
interface Sheet {
  readonly title: string;
  readonly body: () => Child;
}

interface State {
  view: View;
  config: Config | null;
  session: Session | null;
  wallet: WalletView | null;
  frame: Frame | null;
  precommit: { roundId: string; seedCommitment: string; publishedAtMs: number } | null;
  clientSeed: string;
  stakeMicro: bigint;
  route: 'WIDE' | 'SPLIT' | 'NARROW' | 'SHELTER';
  laneSplit: number | null;
  shelter: number[];
  laneOrder: string[] | null;
  sideBets: Record<string, bigint>;
  sheet: Sheet | null;
  compare: [string, string] | null;
  lastArena: ArenaRecord | null;
  runStartedAt: number;
  wipeAtMs: number;
  toast: { message: string; bad: boolean } | null;
  busy: boolean;
  rehearsal: RehearsalResult | null;
  rehearsalChoices: { route: string; laneSplit: number | null; shelter: number[] }[];
  rehearsalStage: number;
  verify: { checks: readonly VerifyCheck[]; bundle: unknown; ghost: readonly GhostRow[] } | null;
  /** What this device recomputed for itself, and whether it is doing it now. */
  rederived: Rederivation | null;
  rederiving: boolean;
  /**
   * Which beat of the staged resolve the screen is currently showing (0-2).
   *
   * §5.2.2 asks for cause before effect — the fallen pips go dark first, held for
   * 350 ms with the claim figure unchanged, and only then does the claim roll. The
   * frame the server sends has all of it applied already, so the beat is *played*
   * out of a starting state the frame no longer describes, and this is that state.
   * `resolveScreen` is a pure function of it, which is what makes it safe for the
   * session poll or a toast to re-render in the middle of a beat.
   */
  beatStep: number;
  /**
   * Which beat of a *terminal* screen is on show (0-3), and why it is not chrome.
   *
   * §9 gives the rescue *"the same production value as the biggest win"* and §S6
   * gives the wipe *"two full seconds of fog and wind with no UI at all"*. Round 1
   * shipped both screens fully mounted from the first frame — a `Round summary`
   * button under the door before the door had opened, and a brass `Back to the
   * squad` beside a lantern that was still falling — which is the same defect
   * twice: the exit was on screen during the moment the exit is for.
   *
   * So both settled screens are staged, and this is the stage they are on:
   *
   * | step | what is on the screen |
   * | --- | --- |
   * | 0 | the world, and nothing else |
   * | 1 | the hero figure, on the bell |
   * | 2 | the copy that explains it |
   * | 3 | the way out |
   */
  settleStep: number;
  /**
   * Whether this round has contained a Last Lamp beat (§9).
   *
   * One light carrying the whole claim across, on any arena and at any squad
   * size — including the fork's thin limb, which is the variant §9 says *"only
   * exists because of the fork"*. It is what decides whether S7 offers the clip,
   * and it is a fact about the round rather than about the ending: §10.7 requires
   * *both* endings to export, and a losing export that is *"degraded, delayed or
   * hidden"* is the specific thing it forbids.
   */
  lastLampRound: boolean;
}

const state: State = {
  view: 'squad',
  config: null,
  session: null,
  wallet: null,
  frame: null,
  precommit: null,
  clientSeed: newClientSeed(),
  stakeMicro: 5_000_000n,
  route: 'WIDE',
  laneSplit: null,
  shelter: [],
  laneOrder: null,
  sideBets: {},
  sheet: null,
  compare: null,
  lastArena: null,
  runStartedAt: 0,
  wipeAtMs: 0,
  toast: null,
  busy: false,
  rehearsal: null,
  rehearsalChoices: [],
  rehearsalStage: 0,
  verify: null,
  rederived: null,
  rederiving: false,
  beatStep: 2,
  settleStep: 3,
  lastLampRound: false,
};

/**
 * The beat in flight, so leaving a screen abandons it.
 *
 * A staged resolve that kept running after the player tapped `Bank` would write
 * `state.beatStep` under the next screen and re-render it out from under them.
 * Every beat replaces the previous one, and every screen transition cancels.
 */
let cancelBeat: (() => void) | null = null;

/**
 * Whether the hero figure has already counted up on this settled screen.
 *
 * `render()` is a pure function of state and runs for anything — the session
 * poll, a toast, the next beat of the settle — so a count-up expressed as *"roll
 * from zero"* re-rolled from zero on every one of them: a frame dump of the bank
 * showed the banked figure counting 3.64, 5.27, 5.68, then starting again at
 * 2.84 and again at 1.37. The roll is a one-shot, so the fact that it has been
 * fired is state, and every later render prints the landed figure.
 */
let heroRolled = false;

function stopBeat(): void {
  cancelBeat?.();
  cancelBeat = null;
}

const root = document.getElementById('app') as HTMLElement;

/**
 * The scene the stage should be showing, set by whichever screen built a viewport.
 *
 * The stage is one canvas that lives across renders (`stage.mount` re-parents it
 * rather than rebuilding it), so the screen cannot hand it a scene while it is
 * being constructed — the host is not in the document yet and has no size. Every
 * `viewport()` therefore leaves its scene here and `render()` applies it once the
 * tree is attached, which is the same shape as `syncPager()` below and for the
 * same reason.
 */
let pendingScene: StageScene | null = null;

function render(): void {
  pendingScene = null;
  root.textContent = '';
  root.className = state.view === 'verify' ? 'verify' : '';
  if (!state.config) {
    root.appendChild(el('div', { class: 'pad', text: 'Opening the Understory…' }));
    return;
  }
  root.appendChild(sessionStrip());
  root.appendChild(screen());
  if (state.sheet) root.appendChild(sheetLayer(state.sheet));
  // The pause goes over the sheet as well as the game: §10.2 says it pauses the
  // game, and a modal a player can tap around is not a pause.
  if (realityCheckDue()) root.appendChild(realityCheck());
  if (state.toast)
    root.appendChild(
      el('div', { class: `toast${state.toast.bad ? ' error' : ''}`, text: state.toast.message }),
    );
  // The tree is now attached, so the pager can be put back where the player left
  // it. This is the line whose absence made the card on screen and the card being
  // committed two different things.
  syncPager();
  applyScene();
  tuneSoundToScreen();
}

function applyScene(): void {
  const host = root.querySelector('.stage-host') as HTMLElement | null;
  if (!host || !pendingScene) {
    stage.unmount();
    return;
  }
  stage.mount(host);
  stage.set(pendingScene);
}

function screen(): HTMLElement {
  switch (state.view) {
    case 'squad':
      return squadScreen();
    case 'stake':
      return stakeScreen();
    case 'route':
      return routeScreen();
    case 'run':
      return runScreen();
    case 'resolve':
      return resolveScreen();
    case 'wipe':
      return wipeScreen();
    case 'banked':
      return bankedScreen();
    case 'summary':
      return summaryScreen();
    case 'verify':
      return verifyScreen();
    case 'settings':
      return settingsScreen();
    case 'rehearsal':
      return rehearsalScreen();
  }
}

/**
 * The reality check (`DESIGN.md` §10.2).
 *
 * *"A reality check fires at the operator's interval, default 30 min, and pauses
 * the game."* The interval and the acknowledgement are the server's, measured on
 * the server's session clock, so the check cannot be skipped by a client that
 * chooses not to draw it, and a test can move the clock and prove it fires.
 *
 * It is not shown over the rehearsal, which has no stake, no wallet and no
 * ledger entry in it — but the clock keeps running underneath, so the check
 * fires on the next screen that has money on it.
 */
function realityCheckDue(): boolean {
  const session = state.session;
  if (!session) return false;
  if (state.view === 'rehearsal') return false;
  return session.realityCheckDueMs <= 0;
}

function realityCheck(): HTMLElement {
  const session = state.session as Session;
  const wallet = state.wallet as WalletView;
  const minutes = Math.floor(session.elapsedMs / 60000);
  return el(
    'div',
    { class: 'reality-backdrop', role: 'dialog', 'aria-modal': 'true' },
    el(
      'div',
      { class: 'reality' },
      el('h2', { text: 'You have been playing for a while' }),
      el(
        'div',
        { class: 'figures' },
        field('Time played', `${minutes} min`),
        field('Staked', credits(wallet.stakedMicro, 2)),
        field('Returned', credits(wallet.creditedMicro, 2)),
        field('Net', `${wallet.netSign}${wallet.netDisplay}`),
      ),
      el('p', {
        class: 'note',
        text: 'Nothing is waiting on you and nothing expires. A round in progress is exactly where you left it.',
      }),
      el('button', {
        class: 'btn',
        text: 'Keep playing',
        onClick: () =>
          void guard(async () => {
            adopt(await api('POST', '/api/session', { acknowledgeRealityCheck: true }));
          }),
      }),
      el('div', { style: 'height:10px' }),
      el('button', {
        class: 'btn quiet',
        text: 'Settings and limits',
        onClick: () =>
          void guard(async () => {
            adopt(await api('POST', '/api/session', { acknowledgeRealityCheck: true }));
            state.view = 'settings';
          }),
      }),
    ),
  );
}

function toast(message: string, bad = false): void {
  state.toast = { message, bad };
  render();
  window.setTimeout(() => {
    if (state.toast?.message === message) {
      state.toast = null;
      render();
    }
  }, 4200);
}

async function guard(work: () => Promise<void>): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  try {
    await work();
  } catch (error) {
    if (error instanceof ApiError) {
      const retry = error.detail.retryInMs;
      toast(
        typeof retry === 'number'
          ? `${error.message} — ${Math.ceil(retry / 1000)}s`
          : error.message,
        true,
      );
    } else {
      toast(String((error as Error).message ?? error), true);
    }
  } finally {
    state.busy = false;
    render();
  }
}

/* ------------------------------------------------------------------ chrome */

/** Always visible, never dismissible (`DESIGN.md` §10.2). */
function sessionStrip(): HTMLElement {
  const session = state.session;
  const wallet = state.wallet;
  const minutes = session ? Math.floor(session.elapsedMs / 60000) : 0;
  return el(
    'div',
    { class: 'session-strip' },
    /*
     * `session 8m`, built the way `balance` and `net` beside it are built: the
     * word on the strip's secondary size, the figure on the numeral floor.
     *
     * §6.5's floor is about figures, and the elapsed minutes are the figure the
     * responsible-play limits are measured against — so they carry `.num`, which
     * is where that floor lives (`docs/ADR-001-the-numeral-floor.md`). The word is
     * not a figure, and raising it too would also cost the strip 6.4 px it does
     * not have at the extreme: `session 120m` beside four-figure money leaves
     * 2.5 px of 358 spare as built, and 3.9 px short if the word comes up with it.
     */
    el('span', { class: 'clock' }, 'session ', el('span', { class: 'num', text: `${minutes}m` })),
    el(
      'span',
      {},
      'balance ',
      el('span', { class: 'money', text: wallet ? wallet.balanceDisplay : '—' }),
    ),
    el(
      'span',
      {},
      'net ',
      el('span', {
        class: 'money',
        /*
         * A loss, floored *away* from zero (`creditsSigned`).
         *
         * The server publishes `netSign` and a truncated magnitude, which is the
         * player-safe rounding on a credit and the wrong one on a debit: a true
         * net of -10.045 printed as -10.04 understates the loss, and the one
         * figure in this build that §10 asks to be conservative is this one. The
         * micro-credit total is on the same payload, so the strip renders the
         * sign from the amount rather than re-signing a rounded magnitude.
         */
        text: wallet
          ? micro(wallet.netMicro) < 0n
            ? creditsSigned(wallet.netMicro)
            : `+${credits(wallet.netMicro, 2)}`
          : '—',
      }),
    ),
    el('button', {
      // §10.8's 44 pt floor, out of the touch area rather than the ink: the
      // strip's height is load-bearing (ADR-001 measures its slack in pixels),
      // so `.tap` grows the hit box and leaves the row exactly as tall.
      class: 'link tap',
      text: 'settings',
      onClick: () => {
        state.view = 'settings';
        render();
      },
    }),
  );
}

function sheetLayer(sheet: Sheet): HTMLElement {
  return el(
    'div',
    {
      class: 'sheet-backdrop',
      onClick: (event: MouseEvent) => {
        if (event.target === event.currentTarget) {
          state.sheet = null;
          render();
        }
      },
    },
    el(
      'div',
      { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': sheet.title },
      el(
        'div',
        { class: 'sheet-head' },
        el('h2', { text: sheet.title }),
        // A real 44 pt target. It was a 32 x 25 px link, and it was also the only
        // escape from the broken-sheet state above — the smallest control in the
        // build guarding the worst dead end in it.
        el('button', {
          class: 'sheet-close',
          'aria-label': 'Close',
          text: 'close',
          onClick: () => {
            state.sheet = null;
            render();
          },
        }),
      ),
      sheet.body(),
    ),
  );
}

/**
 * The world — the stage, and the text that belongs over it.
 *
 * Everything inside the frame is drawn by `client/src/stage.ts` onto one canvas:
 * the sky, the fog volume, the petrified branch dressed to §6.7's motif for this
 * arena, the Kindlings, and the light their lanterns throw. This function builds
 * the *host* for that canvas plus the two things that are text and therefore
 * belong in the document — the arena's name and its counter — and leaves the scene
 * in `pendingScene` for `render()` to apply once the host has a size.
 *
 * `compact` is the decision-screen band. §5's 58/42 seam is the layout for the
 * run, where the viewport expands to full bleed and the decision surface slides
 * away; on S2 the decision *is* the screen, so the world is a band that gives way
 * first and the card keeps its height.
 */
function viewport(options: {
  readonly title: string;
  readonly subtitle: string;
  readonly counter: string;
  /**
   * `slot` is the runner's identity and it matters: the stage keys every figure's
   * animation state by it, so the same Kindling keeps its gait phase, its lantern
   * swing and — the one that would be visible if this were wrong — its *fall*
   * across the re-render that turns it from running into lost. Passing the array
   * index here instead of the squad slot is how a fall stops playing.
   */
  readonly runners: readonly { slot: number; name: string; status: string; lane: number }[];
  readonly lanes: number;
  readonly progress?: number;
  readonly collapsed?: readonly boolean[];
  readonly compact?: boolean;
  /** A mid-height strip, for S1, where the world is context and not the subject. */
  readonly band?: boolean;
  /** Full bleed, for the run (§S3) and for the two settled screens. */
  readonly full?: boolean;
  readonly mode?: StageMode;
  readonly arena?: number;
  readonly lastLamp?: boolean;
  readonly names?: boolean;
  /**
   * Whether the stage carries its controls.
   *
   * §S6 asks for *"two full seconds of fog and wind with no UI at all"*, and §10.2
   * requires the session strip to be visible and never dismissible — so the two
   * rules meet on this screen and the responsible-play one wins. What §S6 can still
   * have is everything else: for those two seconds the stage carries no counter and
   * no sound control, and the fog is the whole frame.
   */
  readonly chrome?: boolean;
  readonly overlay?: Child;
}): HTMLElement {
  pendingScene = {
    arena: options.arena ?? 0,
    lanes: Math.max(1, options.lanes),
    runners: options.runners.map((runner) => ({
      slot: runner.slot,
      name: runner.name,
      status:
        runner.status === 'lost' ? 'lost' : runner.status === 'home' ? 'home' : 'running',
      lane: runner.lane,
    })) as readonly StageRunner[],
    collapsed: options.collapsed ?? [],
    progress: options.progress ?? 0.08,
    mode: options.mode ?? 'brief',
    lastLamp: options.lastLamp ?? false,
    names: options.names ?? options.compact !== true,
  };

  return el(
    'div',
    {
      class: `viewport${options.compact ? ' compact' : ''}${options.band ? ' band' : ''}${options.full ? ' full' : ''}`,
    },
    el('div', { class: 'stage-host' }),
    el(
      'div',
      { class: 'arena-label' },
      el(
        'div',
        {},
        el('h2', { text: options.title }),
        el('div', { class: 'fiction', text: options.subtitle }),
      ),
      options.chrome === false
        ? null
        : el(
            'div',
            { class: 'label-controls' },
            soundToggle(),
            // §S6 has no arena counter on it — the round is over. An empty badge is
            // a stray pill, so the badge is only drawn when it holds something.
            options.counter === '' ? null : el('div', { class: 'badge', text: options.counter }),
          ),
    ),
    options.overlay,
  );
}

/**
 * The sound control, over the world rather than in the strip.
 *
 * It has two homes on purpose. S9 carries the canonical toggle beside reduced
 * motion, because that is where §S9 puts it and where a player looks for a
 * preference; this one is the reach-for-it version, on every screen that has a
 * stage — which is every screen that makes a sound beyond a tap. It is a glyph
 * *and* a word, because §10.8 forbids colour as the sole carrier of a state, and
 * it is not in the session strip because the strip's four items have 358 px to
 * share and `docs/ADR-001-the-numeral-floor.md` measured the worst case at 2.5 px
 * of slack.
 */
function soundToggle(): HTMLElement {
  const on = state.session?.audioEnabled ?? false;
  return el(
    'button',
    {
      class: 'mute',
      'aria-pressed': String(on),
      'aria-label': on ? 'Sound on. Turn sound off' : 'Sound off. Turn sound on',
      onClick: (event: MouseEvent) => {
        event.stopPropagation();
        void guard(async () => {
          adopt(await api('POST', '/api/session', { audioEnabled: !on }));
        });
      },
    },
    el('span', { class: 'glyph', text: on ? '◗)' : '◗' }),
    el('span', { text: on ? 'sound' : 'muted' }),
  );
}

/* ------------------------------------------------------------------- S0 */

function squadScreen(): HTMLElement {
  const config = state.config as Config;
  const session = state.session as Session;
  const names = session.runnerNames;
  const first = !session.rehearsalSeen && session.roundsSeen === 0;
  return el(
    'div',
    { class: 'screen fade-in' },
    viewport({
      title: 'The Understory',
      subtitle: 'Five figures with lanterns for hearts.',
      counter: 'squad',
      lanes: 1,
      arena: 0,
      mode: 'shelf',
      runners: names.map((name, slot) => ({ slot, name, status: 'running', lane: 0 })),
      progress: 0.1,
    }),
    el(
      'div',
      { class: 'surface pad stack' },
      el('h1', { text: 'Your squad' }),
      el('p', { class: 'note', text: COPY.cosmetics }),
      ...names.map((name, index) =>
        el(
          'div',
          { class: 'row' },
          el('span', { class: 'pip' }, el('span', { class: 'dot' })),
          el('input', {
            class: 'runner-name',
            value: name,
            maxlength: '16',
            'aria-label': `Rename runner ${index + 1}`,
            style:
              'flex:1;background:transparent;border:0;border-bottom:1px solid rgba(138,152,160,.25);color:inherit;font-size:16px;padding:8px 0',
            onChange: (event: Event) => {
              const next = [...names];
              next[index] = (event.target as HTMLInputElement).value;
              void guard(async () => {
                const payload = await api<{ session: Session; wallet: WalletView }>(
                  'POST',
                  '/api/session',
                  { runnerNames: next },
                );
                state.session = payload.session;
                state.wallet = payload.wallet;
              });
            },
          }),
          el('span', { class: 'tiny', text: 'runs come home: —' }),
        ),
      ),
      el('p', { class: 'tiny', text: 'A Kindling is never lost for good. Every run starts with five.' }),
    ),
    el(
      'div',
      { class: 'footer' },
      first
        ? frag(
            el('p', { class: 'note', text: COPY.firstTime }),
            el('button', {
              class: 'btn primary',
              text: 'Rehearse ▸',
              onClick: () => startRehearsal(),
            }),
            el('div', { style: 'height:10px' }),
            el('button', {
              class: 'btn',
              text: 'Set the stake ▸',
              onClick: () => {
                state.view = 'stake';
                render();
              },
            }),
          )
        : frag(
            el('button', {
              class: 'btn primary',
              text: 'Set the stake ▸',
              onClick: () => {
                state.view = 'stake';
                render();
              },
            }),
            el('div', { style: 'height:10px' }),
            el('button', { class: 'btn quiet', text: 'Rehearse ▸', onClick: () => startRehearsal() }),
          ),
      el('p', {
        class: 'tiny',
        text: `${config.game.id} ${config.game.version} · engine ${config.game.moduleId} ${config.game.moduleVersion} · free play, no real money`,
      }),
    ),
  );
}

/* ------------------------------------------------------------------- S1 */

function stakeScreen(): HTMLElement {
  const config = state.config as Config;
  const stake = state.stakeMicro;
  const claim = (stake * 191n) / 200n;
  const min = micro(config.money.minStakeMicro);
  const max = micro(config.money.maxStakeMicro);
  const presets = [1_000_000n, 2_000_000n, 5_000_000n, 10_000_000n, 25_000_000n];

  const setStake = (value: bigint) => {
    state.stakeMicro = value < min ? min : value > max ? max : value - (value % 5n);
    render();
  };

  return el(
    'div',
    { class: 'screen fade-in' },
    // The squad, waiting at the foot of the tree. §S1 does not ask for the world on
    // this screen, but the screen that debits the stake is the last one before the
    // branch and it should be able to see what is about to cross it.
    viewport({
      title: 'The Understory',
      subtitle: 'Five lanterns at the foot of the tree.',
      counter: 'stake',
      lanes: 1,
      arena: 0,
      mode: 'shelf',
      band: true,
      names: false,
      runners: (state.session?.runnerNames ?? []).map((name, slot) => ({
        slot,
        name,
        status: 'running',
        lane: 0,
      })),
      progress: 0.06,
    }),
    el(
      'div',
      { class: 'surface pad stack' },
      el('h1', { text: 'Buy the run' }),
      el(
        'div',
        { class: 'row', style: 'justify-content:center' },
        el(
          'div',
          { class: 'stepper' },
          el('button', { text: '−', onClick: () => setStake(stake - 1_000_000n) }),
          el('span', { class: 'amount', text: credits(stake) }),
          el('button', { text: '+', onClick: () => setStake(stake + 1_000_000n) }),
        ),
      ),
      el(
        'div',
        // A grid rather than a wrapping row: five presets on one line, so the last
        // one is not a lone chip on a second row pretending to be a different kind
        // of control from the four above it.
        { class: 'presets' },
        ...presets.map((preset) =>
          el('button', {
            // A stake preset is a money figure on a money control: tabular
            // numerals and the §6.5 numeral floor, like every other figure.
            class: 'chip money',
            'aria-pressed': String(preset === stake),
            text: credits(preset),
            onClick: () => setStake(preset),
          }),
        ),
      ),
      el('p', {
        class: 'note',
        text: `Buying this run debits ${credits(stake, 2)} and opens a claim of ${credits(claim, 3)} — that's the ${config.money.rtpPct} return, charged once, now. It is not charged again no matter how far you go.`,
      }),
      el('p', { class: 'note', text: COPY.buyWarning }),
      collapsible('If you leave mid-round', el('p', { class: 'note', text: COPY.expiry })),
      collapsible(
        'Your seed',
        el(
          'div',
          { class: 'stack' },
          el('p', { class: 'note', text: COPY.seedNote }),
          el('input', {
            value: state.clientSeed,
            spellcheck: 'false',
            maxlength: '64',
            'aria-label': 'Client seed',
            style:
              'width:100%;background:var(--void);border:1px solid var(--fog-mid);color:var(--mist);font-family:var(--mono);font-size:13px;padding:10px;border-radius:3px',
            onChange: (event: Event) => {
              // Anything they like, which is what the line above promises. A seed
              // that is already 32 bytes of hex is used as it stands; anything
              // else is hashed into the round's entropy, publicly and visibly.
              const value = (event.target as HTMLInputElement).value.trim();
              if (value.length === 0) toast('A seed needs at least one character.', true);
              else state.clientSeed = value;
              render();
            },
          }),
          el('p', {
            class: 'tiny',
            text: isSeed(state.clientSeed)
              ? 'Used exactly as it stands.'
              : 'Not 32 bytes of hex, so the round uses SHA-256 of it — shown on the verification screen, next to what you typed.',
          }),
          el('button', {
            class: 'btn quiet',
            text: 'Generate another',
            onClick: () => {
              state.clientSeed = newClientSeed();
              render();
            },
          }),
        ),
      ),
      el('p', { class: 'tiny', text: COPY.sealNote }),
    ),
    el(
      'div',
      { class: 'footer' },
      el(
        'div',
        { class: 'status' },
        el('span', { text: `stake ${credits(stake, 2)}` }),
        el('span', { text: `claim opens at ${credits(claim, 3)}` }),
      ),
      state.session?.stakingBlock
        ? el('p', { class: 'note', text: state.session.stakingBlock.message })
        : null,
      el('button', {
        class: 'btn primary',
        text: 'Buy the run',
        disabled: Boolean(state.session?.stakingBlock),
        onClick: () => buyRun(),
      }),
      el('div', { style: 'height:8px' }),
      el('button', {
        class: 'btn quiet',
        text: '‹ back to the squad',
        onClick: () => {
          state.view = 'squad';
          render();
        },
      }),
    ),
  );
}

function collapsible(label: string, body: Child): HTMLElement {
  const details = el('details', {}, el('summary', { class: 'link', text: label }), el('div', { class: 'pad' }, body));
  return details;
}

async function buyRun(): Promise<void> {
  await guard(async () => {
    const precommit = await api<{ roundId: string; seedCommitment: string; publishedAtMs: number }>(
      'POST',
      '/api/rounds',
    );
    state.precommit = precommit;
    // The commitment is shown before the seed is sent: the client answers exactly
    // one commitment and refuses any other (`ENGINE.md` §5).
    toast(`${COPY.sealed} ${precommit.seedCommitment.slice(0, 16)}…`);
    const payload = await api<{ frame: Frame; session: Session; wallet: WalletView }>(
      'POST',
      `/api/rounds/${precommit.roundId}/open`,
      {
        clientSeed: state.clientSeed,
        respondingTo: precommit.seedCommitment,
        stakeMicro: state.stakeMicro.toString(),
      },
    );
    adopt(payload);
    resetChoice();
    // A new round is a new squad on the shelf: every figure's gait phase, fall and
    // lantern state belongs to the round that is over.
    stage.reset();
    state.view = 'route';
  });
}

function adopt(payload: { frame?: Frame; session?: Session; wallet?: WalletView }): void {
  if (payload.frame) state.frame = payload.frame;
  if (payload.session) {
    state.session = payload.session;
    // The two presentation preferences are server-owned session state, so they
    // survive a reload — and this is the one place they arrive, so it is the one
    // place that hands them to the layers that read them.
    sound.setEnabled(payload.session.audioEnabled);
    setCalmPreference(payload.session.reducedMotion);
    // §6.8's tier is one of them: the stage renders at the resolution and the
    // plane count the tier buys, and the setting survives a reload like the
    // other two because the server owns it.
    setQuality(payload.session.qualityTier as Quality);
  }
  if (payload.wallet) state.wallet = payload.wallet;
}

/**
 * Instant feedback on every tap, from one listener.
 *
 * The alternative was a `sound.tap()` call in ninety `onClick` handlers, which is
 * ninety chances to forget one — and a control that answers a tap on some screens
 * and not others feels broken in a way that is hard to name. So the feedback is
 * delegated: one capture-phase `pointerdown` on the root reads what kind of
 * control was hit and plays the matching struck-wood blip.
 *
 * It is `pointerdown` and not `click` on purpose. The sound has to land on the
 * finger going down, not on it coming up, or it is not feedback — it is a report.
 * The visual half of the same idea is `:active` in the stylesheet, which is also
 * instant on the way down and takes §6.4's beat on the way back.
 *
 * The same listener is where the audio graph is unlocked: a browser will not start
 * an `AudioContext` outside a user gesture, and this is the first gesture there is.
 */
function installTapFeedback(): void {
  root.addEventListener(
    'pointerdown',
    (event) => {
      sound.unlock();
      const target = (event.target as HTMLElement | null)?.closest('button') ?? null;
      if (!target || target.hasAttribute('disabled')) return;
      if (target.classList.contains('btn') && target.classList.contains('primary'))
        sound.tap('commit');
      else if (target.classList.contains('link') || target.classList.contains('mute'))
        sound.tap('toggle');
      else if (target.classList.contains('limb-chip') && target.classList.contains('inert'))
        sound.tap('refuse');
      else sound.tap('select');
    },
    { capture: true },
  );
}

/**
 * What the sound bed should be doing on the screen that is up.
 *
 * §7's music is *"sparse, 68 BPM … one voice per arena survived"* and it lives on
 * the decision screen, which is the screen with no clock on it. It stops for the
 * run, because the run's mix is the squad's own rhythm, and it stops for §9's beat
 * entirely — *"The music drops out entirely"* — which is the loudest thing the
 * sound layer does short of the silence at the end of a losing round.
 */
let soundKey = '';

function tuneSoundToScreen(): void {
  const frame = state.frame;
  /*
   * Only when something the mix depends on has actually changed.
   *
   * `render()` runs four times a second while the run screen is advancing its
   * progress, and re-scheduling the squad's rhythm on each of those would reset
   * every footfall's phase — five figures would fall into unison, which is the
   * one thing §7's *"busy, warm, slightly ragged"* rhythm must not do.
   */
  const key = [
    state.view,
    frame?.arena.index ?? 0,
    frame?.live.length ?? 0,
    state.route,
    state.laneSplit ?? '',
    sound.isEnabled(),
  ].join('|');
  if (key === soundKey) return;
  soundKey = key;

  const arena = frame ? frame.arena.index : 1;
  sound.arena(arena, Math.max(0, arena - 1));

  if (state.view === 'route' || state.view === 'rehearsal') {
    sound.duckForLastLamp(false);
    sound.startMusic();
    sound.stopSquadRhythm();
    return;
  }
  sound.stopMusic();
  if (state.view === 'run' && frame) {
    const lastLamp = frame.live.length === 1;
    sound.duckForLastLamp(lastLamp);
    const laneSizes =
      state.route === 'SPLIT' && state.laneSplit !== null
        ? [state.laneSplit, frame.live.length - state.laneSplit]
        : null;
    sound.startSquadRhythm(
      orderedRunners(frame).map((runner, index) => ({
        slot: runner.slot,
        lane: laneSizes && index >= (laneSizes[0] as number) ? 1 : 0,
      })),
      laneSizes ? 2 : 1,
    );
    return;
  }
  sound.stopSquadRhythm();
}

function resetChoice(): void {
  // Leaving a resolved arena abandons its beat: a staged resolve that kept running
  // would write `beatStep` under the next decision screen.
  stopBeat();
  state.route = 'WIDE';
  state.laneSplit = null;
  state.shelter = [];
  state.laneOrder = null;
  // §4: side-bet stakes reset to zero every arena and are never inherited.
  state.sideBets = {};
}
/* ------------------------------------------------------------------- S2 */

/**
 * The core screen, and the constraint it is built to.
 *
 * `DESIGN.md` §S2 asks for a paged stack of four route cards with a page
 * indicator, the claim meter on the seam, the controls that name Kindlings, and
 * `Commit route` in the thumb zone. The first build of this screen did all of
 * that and still failed, in two ways worth recording here because the layout
 * below is the answer to both:
 *
 * 1. **The card on screen was not the card being committed.** The whole tree is
 *    rebuilt on every state change, and nothing restored the pager's scroll
 *    position, so choosing a fork balance threw you off the SPLIT card while the
 *    footer still committed SPLIT. The pager is now the selection: `syncPager()`
 *    puts the selected card back under the scroll position after every render,
 *    and a settled scroll sets the selection from whatever card the player
 *    stopped on. The two can no longer disagree.
 * 2. **It was 2.7 screens tall.** Cards were sized by their content, stretched to
 *    the tallest of them, inside a page that scrolled vertically *and*
 *    horizontally — two axes to make one decision. The screen is now a fixed
 *    column: scene, claim, tabs, exactly one card, the controls, the action.
 *    Nothing on it scrolls vertically, and every field the specification puts on
 *    a card face is still on the card face.
 *
 * The controls that name a Kindling — the fork balance, who takes the thin limb,
 * who comes home — moved out of the card and into a strip directly above the
 * primary action. They are decisions, not information, so they belong in the
 * bottom 280 pt with the button that commits them, and they stay visible while
 * the player builds a selection.
 */

function figuresFor(entry: MenuEntry, laneSplit: number | null, shelterSize: number): Figures {
  if (entry.route === 'SHELTER') {
    const found = entry.figures.find((candidate) => candidate.shelterSize === shelterSize);
    return (found ?? entry.figures[0])?.figures as Figures;
  }
  const found = entry.figures.find((candidate) => (candidate.laneSplit ?? null) === laneSplit);
  return (found ?? entry.figures[0])?.figures as Figures;
}

/**
 * One multiplier format, everywhere (`api.multiplier`).
 *
 * This was a two-place truncation of the server's decimal, which put `1.93x` in
 * the side-bet strip beside `1.190x` on the cards and `1.93950933x` in the
 * worked example — the same quantity in three formats on one screen. Three
 * places, round-half-up, is the cards' own rule, so the ladder is the cards'.
 */
function shortMultiplier(decimal: string): string {
  return multiplier(decimal);
}

/**
 * Selecting a route, from the tabs, from a card tap, or from a settled swipe.
 *
 * Every route change drops the options that belonged to the previous one: a
 * shelter selection is not carried onto NARROW, and a fork balance is not
 * carried onto WIDE. The server would refuse either, but the screen should never
 * be showing a commitment it knows is illegal.
 */
function selectRoute(route: string, frame: Frame): void {
  if (route !== 'WIDE' && route !== 'SPLIT' && route !== 'NARROW' && route !== 'SHELTER') return;
  state.route = route;
  if (route !== 'SHELTER') state.shelter = [];
  if (route !== 'SPLIT') {
    state.laneSplit = null;
    state.laneOrder = null;
  } else if (state.laneSplit === null) {
    const split = frame.menu.find((entry) => entry.route === 'SPLIT');
    state.laneSplit = (split?.laneSplits[0] as number | undefined) ?? null;
  }
}

let pagerSettle: number | undefined;
/**
 * What a settled swipe means, set by whichever screen built the pager.
 *
 * The route screen and the rehearsal both page four cards and select differently
 * — one has a live frame behind it, the other a published seed pair — so the
 * handler carries no knowledge of either.
 */
let pagerPick: (route: string) => void = () => {};

/**
 * A settled swipe *is* a choice.
 *
 * The handler waits for the scroll to stop rather than tracking it live: reading
 * the position mid-gesture would fight the snap, and re-rendering mid-gesture
 * would cancel it. Once it has stopped, the card under the viewport becomes the
 * selection, which is the invariant the footer depends on.
 */
function onPagerScroll(event: Event): void {
  const pager = event.currentTarget as HTMLElement;
  window.clearTimeout(pagerSettle);
  pagerSettle = window.setTimeout(() => {
    if (!pager.isConnected) return;
    const width = pager.clientWidth || 1;
    const index = Math.max(0, Math.min(pager.children.length - 1, Math.round(pager.scrollLeft / width)));
    const route = (pager.children[index] as HTMLElement | undefined)?.getAttribute('data-route');
    if (route && route !== state.route) pagerPick(route);
  }, 90);
}

/**
 * Puts the selected card back under the viewport after a re-render.
 *
 * Called at the end of every `render()`. Each page is exactly the pager's client
 * width, so the position is `index x width` and no measurement of the card
 * itself is involved — the arithmetic cannot drift when a card's content changes
 * height. `scrollLeft` is assigned rather than animated: the tree it belongs to
 * was created microseconds ago and animating from a position the player never
 * saw would be theatre.
 */
function syncPager(): void {
  const pager = root.querySelector('.card-pager') as HTMLElement | null;
  if (!pager) return;
  const routes = [...pager.children].map((child) => (child as HTMLElement).getAttribute('data-route'));
  const index = routes.indexOf(state.route);
  if (index < 0) return;
  const target = index * (pager.clientWidth || 0);
  if (Math.abs(pager.scrollLeft - target) > 1) pager.scrollLeft = target;
}

function routeScreen(): HTMLElement {
  const frame = state.frame as Frame;
  const config = state.config as Config;
  const session = state.session as Session;
  const running = frame.live.length;

  if (state.route === 'SPLIT' && state.laneSplit === null) {
    const split = frame.menu.find((entry) => entry.route === 'SPLIT');
    state.laneSplit = (split?.laneSplits[0] as number | undefined) ?? null;
  }

  const selectedEntry = frame.menu.find((entry) => entry.route === state.route);
  const shelterSize = state.shelter.length;
  const selectedFigures = selectedEntry
    ? figuresFor(selectedEntry, state.laneSplit, Math.max(1, shelterSize))
    : null;

  const laneSizes =
    state.route === 'SPLIT' && state.laneSplit !== null
      ? [state.laneSplit, running - state.laneSplit]
      : null;

  const canCommit = state.route !== 'SHELTER' || (shelterSize >= 1 && shelterSize <= running - 1);

  const tabs = frame.menu.map((entry) => ({
    route: entry.route,
    multiplier: figuresFor(entry, state.laneSplit, Math.max(1, shelterSize)).display.multiplier,
  }));

  const pick = (route: string) => {
    selectRoute(route, frame);
    render();
  };
  pagerPick = pick;

  return el(
    'div',
    { class: 'screen route-screen fade-in' },
    viewport({
      title: frame.arena.name,
      subtitle: frame.arena.subtitle,
      counter: `${frame.arena.index} / ${frame.arena.of}`,
      lanes: state.route === 'SPLIT' ? 2 : 1,
      arena: frame.arena.index,
      mode: 'brief',
      compact: true,
      runners: orderedRunners(frame).map((runner, index) => ({
        slot: runner.slot,
        name: runner.name,
        status: runner.status,
        lane: laneSizes && index >= (laneSizes[0] as number) ? 1 : 0,
      })),
      progress: 0.02,
    }),
    claimMeter({
      claim: frame.claim.display,
      caption: `claim · ${running} still running`,
      squad: frame.squad,
      laneSizes,
      bankedNote: bankedNote(frame),
    }),
    routeTabs(tabs, state.route, pick),
    // The product's thesis, permanently on the route screen (§3). Not a
    // disclaimer in a legal sheet: the sentence the whole game is an argument for.
    el(
      'p',
      { class: 'thesis' },
      `Every route returns ${config.money.rtpPct}. ${COPY.everyRoute}`,
      // §5.2.5 rule 2: one tap out of every gated screen, remembered, never
      // re-asked. It is a link and not a button in the thumb zone because it is
      // not a money control.
      !session.showEverything
        ? el('button', {
            class: 'link tap',
            text: COPY.showEverything,
            onClick: () =>
              void guard(async () => {
                adopt(await api('POST', '/api/session', { showEverything: true }));
              }),
          })
        : null,
    ),
    el(
      'div',
      { class: 'card-pager', onScroll: onPagerScroll },
      ...frame.menu.map((entry) => renderCard(entry, frame, config)),
    ),
    controlStrip(frame, selectedEntry ?? null),
    sideBetStrip(frame, session, selectedFigures),
    el(
      'div',
      { class: 'footer' },
      el('button', {
        class: 'btn primary',
        text: commitLabel(),
        disabled: !canCommit,
        onClick: () => commitRoute(),
      }),
      cycleBar(frame),
      session.roundsSeen < 3 ? el('p', { class: 'tiny', text: COPY.noClock }) : null,
    ),
  );
}

function commitLabel(): string {
  if (state.route === 'SHELTER')
    return state.shelter.length === 0 ? 'Choose who comes home' : 'Open the Lamp House';
  return 'Commit route';
}

function orderedRunners(frame: Frame): { slot: number; name: string; status: string }[] {
  const running = frame.squad.filter((member) => member.status === 'running');
  if (state.laneOrder) {
    const byName = new Map(running.map((member) => [member.name, member]));
    const ordered = state.laneOrder
      .map((name) => byName.get(name))
      .filter((member): member is (typeof running)[number] => member !== undefined);
    if (ordered.length === running.length) return ordered;
  }
  return running;
}

function bankedNote(frame: Frame): string | null {
  const home = frame.squad.filter((member) => member.status === 'home');
  if (home.length === 0) return null;
  const total = home.reduce((sum, member) => sum + micro(member.valueMicro), 0n);
  return `${home.length} home · ${credits(total, 3)} banked`;
}

function renderCard(entry: MenuEntry, frame: Frame, config: Config): HTMLElement {
  const running = frame.live.length;
  const shelterSize = Math.max(1, state.shelter.length);
  const figures = figuresFor(entry, state.laneSplit, shelterSize);
  const selected = state.route === entry.route;
  const fiction = config.game.routeTitles[entry.route] ?? '';
  const balances = entry.laneSplits.filter((value): value is number => value !== null);

  return routeCard({
    route: entry.route,
    fiction,
    figures,
    selected,
    rtp: config.money.rtpPct,
    // At two and three runners there is one legal balance and the comparison does
    // not exist, so the card does not draw two columns to imply a choice that is
    // not there (§3.3).
    fork:
      entry.route === 'SPLIT' && balances.length > 1
        ? {
            balances,
            running,
            selected: state.laneSplit,
            figuresOf: (balance: number) =>
              entry.figures.find((candidate) => candidate.laneSplit === balance)
                ?.figures as Figures,
          }
        : null,
    /*
     * The card states the shape; the picker's readout states the money.
     *
     * Both said the same sentence once a runner was picked — *"Banks 0.955 now.
     * N keep running"* on the card and again under the chips — which is the
     * duplication the round-2 review found. §S2 puts the live readout under the
     * picker, where it changes as you tap, so that is where the figure stays and
     * the card keeps the part the readout does not carry.
     */
    headNote:
      entry.route === 'SHELTER'
        ? state.shelter.length > 0
          ? 'The rest cross on the Broad Bough.'
          : `Bring one home and ${shelterCreditLabel(entry)} stops running. The rest cross on the Broad Bough.`
        : null,
    onSelect: () => {
      selectRoute(entry.route, frame);
      render();
    },
    onOdds: () => {
      state.sheet = {
        title: `${entry.route} — every outcome, exactly`,
        body: () =>
          frag(
            el('p', {
              class: 'note',
              text: `Multiplier ${figures.multiplier.exact} = ${figures.display.multiplier}.`,
            }),
            oddsTable(figures),
            el('p', {
              class: 'tiny',
              text: 'These are the rows tools/enumerate.mjs publishes. The card and the enumerator are checked against each other on every build.',
            }),
          ),
      };
      render();
    },
    onCompare: () => openCompare(entry, frame, config),
  });
}

function shelterCreditLabel(entry: MenuEntry): string {
  const size = Math.max(1, state.shelter.length);
  const found = entry.figures.find((candidate) => candidate.shelterSize === size);
  return credits(found?.banksMicro ?? '0', 3);
}

/* ----------------------------------------------------------- the controls */

/**
 * The decisions that name a Kindling, in the thumb zone.
 *
 * One strip, directly above `Commit route`, carrying whatever the selected route
 * actually asks the player to decide: the fork balance and who takes the thin
 * limb, or who comes home through the Lamp House door. Nothing here changes a
 * distribution except the fork balance, and the copy says which is which — *"Who
 * goes where changes who comes home, not the odds"* is on the screen next to the
 * control it is about, not in a tooltip.
 */
function controlStrip(frame: Frame, entry: MenuEntry | null): Child {
  if (!entry) return null;
  if (entry.route === 'SPLIT') {
    const balances = entry.laneSplits.filter((value): value is number => value !== null);
    return el(
      'div',
      { class: 'control-strip' },
      balances.length > 1 ? forkDial(balances, frame) : null,
      limbPicker(frame),
    );
  }
  if (entry.route === 'SHELTER') return el('div', { class: 'control-strip' }, shelterPicker(entry, frame));
  return null;
}

/**
 * The fork balance (`DESIGN.md` §3.3).
 *
 * A volatility dial: `4 + 1` is an exact mean-preserving spread of `3 + 2`, so
 * the copy may not call it a balanced trade — and may not call it the wrong
 * choice either. No default is highlighted until the player has one, no colour
 * hierarchy, no recommendation. The card above carries both columns of numbers
 * at once; this is the control that picks between them.
 */
function forkDial(balances: readonly number[], frame: Frame): HTMLElement {
  const running = frame.live.length;
  return el(
    'div',
    {},
    el(
      'div',
      { class: 'balance-tabs' },
      ...balances.map((balance) =>
        el('button', {
          class: 'balance-tab',
          'aria-pressed': String(state.laneSplit === balance),
          text: `${balance} + ${running - balance}`,
          onClick: () => {
            state.route = 'SPLIT';
            state.laneSplit = balance;
            state.laneOrder = null;
            render();
          },
        }),
      ),
    ),
    el('p', {
      class: 'tiny',
      text: `Same 95.5% either way. ${balances[balances.length - 1]} + ${running - (balances[balances.length - 1] as number)} is the wider spread.`,
    }),
  );
}

/**
 * Who takes the thin limb.
 *
 * Narratively enormous, mathematically inert, and the strip says both in one
 * line. Runners are exchangeable (`MATH.md` §5.4): no assignment of names to
 * positions can move any moment of any distribution. What it changes is which
 * committed slip draw each named Kindling consumes — that is, who comes home.
 */
function limbPicker(frame: Frame): HTMLElement {
  const running = orderedRunners(frame);
  const split = state.laneSplit ?? Math.ceil(running.length / 2);
  const order = running.map((runner) => runner.name);
  state.laneOrder = order;

  const move = (name: string) => {
    const next = [...order];
    const index = next.indexOf(name);
    if (index < split) {
      next.splice(index, 1);
      next.push(name);
    } else {
      next.splice(index, 1);
      next.unshift(name);
    }
    state.laneOrder = next;
    render();
  };

  const chip = (name: string, lane: 'broad' | 'thin') =>
    el(
      'button',
      {
        class: `limb-chip ${lane}`,
        'aria-label': `${name}, ${lane} limb — tap to move`,
        onClick: () => move(name),
      },
      el('span', { class: 'dot' }),
      el('span', { class: 'runner-name', text: name }),
    );

  return el(
    'div',
    {},
    el(
      'div',
      { class: 'limb-row' },
      ...order.slice(0, split).map((name) => chip(name, 'broad')),
      el('div', { class: 'limb-divider' }),
      ...order.slice(split).map((name) => chip(name, 'thin')),
    ),
    el('p', { class: 'tiny', text: COPY.whoGoesWhere }),
  );
}

/**
 * The shelter picker (`DESIGN.md` §S2).
 *
 * The last unselected pip is **inert**, not an error at commit time:
 * `SHELTER(n)` does not exist in the model, so the picker refuses it at input
 * time and says why. This is the single easiest rule for a build to get wrong,
 * and it is the reason the specification states it three separate times.
 *
 * The live readout sits under the row, where it can be read while the selection
 * is being built — which is the whole point of a readout that changes as you tap.
 */
function shelterPicker(entry: MenuEntry, frame: Frame): HTMLElement {
  const running = frame.squad.filter((member) => member.status === 'running');
  const chosen = state.shelter;
  const wouldEmpty = chosen.length >= running.length - 1;
  return el(
    'div',
    {},
    el(
      'div',
      { class: 'limb-row' },
      ...running.map((member) => {
        const picked = chosen.includes(member.slot);
        const inert = !picked && wouldEmpty;
        return el(
          'button',
          {
            class: `limb-chip${inert ? ' inert' : ''}`,
            'aria-pressed': String(picked),
            // §10.8 asks for a screen-reader label on both pickers, and the fork's
            // chips carried one while these did not — the same control, half
            // labelled. It states what the tap does, not what the chip is.
            'aria-label': inert
              ? `${member.name} — one has to run`
              : picked
                ? `${member.name} is coming home — tap to send them on`
                : `${member.name} — tap to bring them home`,
            onClick: () => {
              state.route = 'SHELTER';
              if (picked) state.shelter = chosen.filter((slot) => slot !== member.slot);
              else if (inert) {
                toast(COPY.shelterFloor);
                return;
              } else state.shelter = [...chosen, member.slot];
              render();
            },
          },
          el('span', { class: 'dot' }),
          el('span', { class: 'runner-name', text: member.name }),
        );
      }),
    ),
    el('p', {
      class: 'readout money',
      text:
        chosen.length === 0
          ? 'Tap the ones to bring home.'
          : `Banks ${shelterCreditLabel(entry)} now. ${running.length - chosen.length} keep running.`,
    }),
    el('p', { class: 'tiny', text: COPY.shelterFloor }),
  );
}

/** The Two-Card Moment, made permanent (`DESIGN.md` §5.2.4). */
function openCompare(entry: MenuEntry, frame: Frame, config: Config): void {
  const others = frame.menu.filter((candidate) => candidate.route !== entry.route);
  const pick = (other: MenuEntry) => {
    const left = figuresFor(entry, entry.laneSplits[0] ?? null, 1);
    const right = figuresFor(other, other.laneSplits[0] ?? null, 1);
    const column = (route: string, figures: Figures) =>
      el(
        'div',
        { style: 'flex:1' },
        el('div', { class: 'route-name', text: route }),
        el('div', { class: 'multiplier money', text: figures.display.multiplier }),
        distributionBars(figures, 84),
        el('div', { class: 'bars-caption', text: `survivors, ${figures.running} running` }),
        field('nobody', figures.display.wipePct),
        field(`all ${figures.running}`, figures.display.allClearPct),
        field('claim grows', figures.display.growsPct),
      );
    state.sheet = {
      title: `${entry.route} against ${other.route}`,
      body: () => frag(
        el(
          'div',
          { class: 'row', style: 'align-items:flex-start;gap:12px' },
          column(entry.route, left),
          column(other.route, right),
        ),
        el('p', {
          class: 'note',
          style: 'text-align:center',
          text: `Both of these return ${config.money.rtpPct}. ${COPY.twoCardFooter}`,
        }),
      ),
    };
    render();
  };
  state.sheet = {
    title: `Compare ${entry.route} with…`,
    body: () => el(
      'div',
      { class: 'stack' },
      ...others.map((other) =>
        el('button', { class: 'btn', text: other.route, onClick: () => pick(other) }),
      ),
    ),
  };
  render();
}

/* --------------------------------------------------------------- side bets */

/**
 * The side-bet control (`DESIGN.md` §4).
 *
 * Collapsed behind one control, off by default, stake reset to zero every arena,
 * and **hidden entirely** — never shown disabled — when the round's remaining
 * allowance is under the 1.00 minimum. A minimum-stake player therefore never
 * sees it at all, which is the consequence §4 asks to be stated rather than
 * discovered.
 *
 * The stakes are set in a sheet rather than inline. That is a layout decision
 * with a money reason behind it: three stake steppers, their prices and their
 * ceiling do not fit beside the route decision on a 390 pt screen, and the first
 * build proved it by pushing an increment button eight pixels off the right edge
 * of the viewport. A partly unreachable control on a stake field is a defect, so
 * the control that needs the width gets the width.
 */
function sideBetStrip(frame: Frame, session: Session, figures: Figures | null): Child {
  if (!frame.sideBets.offered || !figures || figures.sideBets.length === 0) return null;

  if (!session.sideBetsOptedIn)
    return el(
      'div',
      { class: 'sidebet-strip' },
      el('button', {
        class: 'strip-button',
        onClick: () => openSideBetOptIn(figures),
      }, el('span', { text: '+ side bet' }), el('span', { class: 'tiny', text: 'off until you turn them on' })),
    );

  const remaining = micro(frame.sideBets.remainingMicro);
  const staked = Object.values(state.sideBets).reduce((sum, value) => sum + value, 0n);
  const placed = Object.entries(state.sideBets).filter(([, value]) => value > 0n);

  return el(
    'div',
    { class: 'sidebet-strip' },
    el(
      'button',
      { class: 'strip-button', onClick: () => openSideBetSheet(frame, figures) },
      el('span', { text: placed.length === 0 ? '+ side bet' : `${placed.length} side bet${placed.length > 1 ? 's' : ''}` }),
      el('span', {
        class: 'money',
        text:
          placed.length === 0
            ? `up to ${credits(remaining, 2)}`
            : `${credits(staked, 2)} of ${credits(remaining + staked, 2)}`,
      }),
    ),
  );
}

/** The opt-in, once, with the pricing rule in words and one worked example (§5.2.5 rule 5). */
function openSideBetOptIn(figures: Figures): void {
  const offer = figures.sideBets[0];
  state.sheet = {
    title: 'Side bets',
    body: () => frag(
      el('p', { class: 'note', text: COPY.sideBetOptIn }),
      el('p', {
        class: 'note',
        text: `Worked example: ${offer?.label} on this geometry is ${pct(offer?.probabilityPct ?? '0')} likely and pays ${shortMultiplier(offer?.multiplier.decimal ?? '0')} — that is ${state.config?.money.rtpExact} divided by the probability, which is the only pricing rule there is.`,
      }),
      el('button', {
        class: 'btn',
        text: 'Turn side bets on',
        onClick: () =>
          void guard(async () => {
            adopt(await api('POST', '/api/session', { sideBetsOptedIn: true }));
            state.sheet = null;
          }),
      }),
    ),
  };
  render();
}

function openSideBetSheet(frame: Frame, figures: Figures): void {
  const min = micro(frame.sideBets.minMicro);
  const build = (): Child => {
    const remaining = micro(frame.sideBets.remainingMicro);
    const staked = Object.values(state.sideBets).reduce((sum, value) => sum + value, 0n);
    return frag(
      el('p', {
        class: 'note',
        text: `Up to ${credits(remaining, 2)} this round — half your run. One ticket per event, three in all. They reset to zero every arena.`,
      }),
      ...figures.sideBets.map((offer) => {
        const current = state.sideBets[offer.id] ?? 0n;
        return el(
          'div',
          { class: 'sidebet-row' },
          el(
            'div',
            { class: 'spread' },
            el('span', { text: offer.label }),
            el('span', { class: 'money', text: shortMultiplier(offer.multiplier.decimal) }),
          ),
          el('div', { class: 'tiny', text: `${offer.claim} · ${pct(offer.probabilityPct)} likely` }),
          el(
            'div',
            { class: 'stepper-row' },
            el(
              'div',
              { class: 'stepper' },
              el('button', {
                'aria-label': `Lower the ${offer.label} stake`,
                text: '−',
                onClick: () => {
                  const next = current - min;
                  state.sideBets[offer.id] = next < 0n ? 0n : next;
                  openSideBetSheet(frame, figures);
                },
              }),
              el('span', { class: 'amount money', text: credits(current, 2) }),
              el('button', {
                'aria-label': `Raise the ${offer.label} stake`,
                text: '+',
                onClick: () => {
                  const next = current + min;
                  if (staked - current + next > remaining) {
                    toast('That is past this round’s side-bet allowance.', true);
                    return;
                  }
                  state.sideBets[offer.id] = next;
                  openSideBetSheet(frame, figures);
                },
              }),
            ),
            el('span', { class: 'tiny', text: `exact price ${offer.multiplier.exact}` }),
          ),
        );
      }),
      el('p', { class: 'tiny', text: COPY.lastLight }),
      el('button', {
        class: 'btn',
        text: 'Done',
        onClick: () => {
          state.sheet = null;
          render();
        },
      }),
    );
  };
  state.sheet = { title: 'Side bets, this arena', body: build };
  render();
}

/* ------------------------------------------------------------- commitment */

/**
 * The commit, stamped.
 *
 * §6.4's terms are the ones that decide what this is allowed to be: the plate
 * drops into its shadow and comes back to rest, and it never rises past where it
 * started. A card that sprang up on commit would read as a reward for choosing,
 * and §10.3 forbids that on four options with identical return. The sound is a
 * low struck-wood thump, which is the same idea in the other medium.
 *
 * It runs before the request rather than after it: the tap is answered on the
 * frame the finger goes down, and the network is not in that loop.
 */
function stampSelectedCard(): void {
  const card = root.querySelector(`.card-page[data-route="${state.route}"] .card`);
  if (!(card instanceof HTMLElement)) return;
  sound.tap('stamp');
  card.classList.remove('stamped');
  // One reflow read, deliberately, so the class re-applies and the animation
  // restarts on a second commit of the same card.
  void card.offsetWidth;
  card.classList.add('stamped');
}

async function commitRoute(): Promise<void> {
  stampSelectedCard();
  const frame = state.frame as Frame;
  const tickets = Object.entries(state.sideBets)
    .filter(([, value]) => value > 0n)
    .map(([bet, value]) => {
      const figures = figuresFor(
        frame.menu.find((entry) => entry.route === state.route) as MenuEntry,
        state.laneSplit,
        Math.max(1, state.shelter.length),
      );
      const offer = figures.sideBets.find((candidate) => candidate.id === bet);
      return {
        bet,
        stakeMicro: value.toString(),
        quotedMultiplier: offer?.multiplier.exact,
      };
    });

  await guard(async () => {
    const payload = await api<{ replayMs: number; frame: Frame; session: Session; wallet: WalletView }>(
      'POST',
      `/api/rounds/${frame.roundId}/commit`,
      {
        idempotencyKey: idempotencyKey('commit'),
        expectedFrameRevision: frame.frameRevision,
        route: state.route,
        laneSplit: state.route === 'SPLIT' ? state.laneSplit : null,
        shelter: state.route === 'SHELTER' ? state.shelter : [],
        laneOrder: state.route === 'SPLIT' ? state.laneOrder : null,
        sideBets: tickets,
      },
    );
    adopt(payload);
    state.runStartedAt = Date.now();
    state.view = 'run';
    render();
    window.setTimeout(() => void resolveArena(), Math.min(payload.replayMs ?? 9000, 9000));
  });
}

/**
 * The staged resolve (§5.2.2's order, played in §7's mix).
 *
 * Four beats, and the gap between the second and the third is the one the
 * specification puts a number on: *"the pips of fallen runners go dark **first**,
 * held for 350 ms with the claim figure unchanged, and only then does the claim
 * roll."*
 *
 * | at | what happens | why there |
 * | --- | --- | --- |
 * | 0 ms | the squad's rhythm stops; a collapsing lane cracks and shudders | the cause |
 * | 280 ms | the lanterns go out, one at a time, each taking its 120 ms band out of the mix | the effect on the squad |
 * | 630 ms | the claim rolls, and the arithmetic arrives behind it | the effect on the money, held 350 ms after the cause |
 *
 * Everything it can do to the *sound* is drawn from §7's list and nothing else:
 * a splintering crack with no explosion in it, a glass pop per lantern, and a
 * struck bell if a shelter door closed. There is no sting on a good arena and no
 * fanfare on any of them.
 */
function playResolveBeat(arena: ArenaRecord): void {
  stopBeat();
  state.beatStep = 0;
  const collapsed = arena.lanes.some((lane) => lane.collapsed);

  cancelBeat = sequence([
    {
      at: 0,
      run: () => {
        sound.stopSquadRhythm();
        if (collapsed) {
          // §7: not an explosion — a long, dry, splintering crack, then a hole.
          sound.laneCollapse();
          stage.effect('shudder');
        }
      },
    },
    {
      at: 280,
      run: () => {
        state.beatStep = 1;
        render();
        // One light at a time. §7's high-shelf cut is a per-lantern event, so five
        // falling runners take five bites out of the mix rather than one big one.
        arena.fallen.forEach((_, index) => window.setTimeout(() => sound.lanternOut(), index * 90));
      },
    },
    {
      at: 280 + CAUSE_HOLD,
      run: () => {
        state.beatStep = 2;
        render();
        // A shelter door closed in this arena: brass, and one struck bell.
        if (arena.shelter.length > 0) sound.bank(arena.shelter.length);
      },
    },
  ]);
}

/**
 * The wipe, which never reaches S4 — and §9's hero descent, which is why.
 *
 * A wipe leaves the model with no action in it, so `resolveArena` settles and goes
 * straight to S6. That is also where §9's signature shot belongs: *"The lantern
 * tumbles. We stay with it, not with the branch, all the way down until the glass
 * gives out and the light goes. Two seconds of empty fog."* The stage plays the
 * descent because the wipe screen hands it the same runners it was drawing a
 * moment ago, now fallen — so it animates a transition rather than drawing an
 * ending, and the camera follows the last light down.
 */
function playWipeBeat(arena: ArenaRecord | null): void {
  stopBeat();
  cancelBeat = sequence([
    {
      at: 0,
      run: () => {
        sound.stopSquadRhythm();
        if (arena?.lanes.some((lane) => lane.collapsed)) {
          sound.laneCollapse();
          stage.effect('shudder');
        }
      },
    },
    { at: 60, run: () => stage.effect('descent') },
    {
      at: 1400,
      run: () => {
        /*
         * §7: every warm layer removed at once, wind alone at -18 dB for 1.8 s. The
         * only silence in the game, spent exactly once per losing round.
         *
         * It lands at 1.4 s because that is when the glass gives out on screen —
         * the stage holds the hero's light for the length of the descent (§9) and
         * this is the frame it dies on. Sound and picture lose the light together,
         * and §S6's words then arrive *inside* the silence rather than after it.
         */
        sound.lastLanternOut();
      },
    },
  ]);
}

async function resolveArena(): Promise<void> {
  if (state.view !== 'run') return;
  await guard(async () => {
    const frame = state.frame as Frame;
    const payload = await api<{ resolution: ArenaRecord; frame: Frame; session: Session; wallet: WalletView }>(
      'POST',
      `/api/rounds/${frame.roundId}/resolve`,
      {},
    );
    adopt(payload);
    state.lastArena = payload.resolution;
    const next = payload.frame;
    // `next` is the frame as the resolve left it, which is the only moment at
    // which an empty live set means "nobody is out there" rather than "this round
    // is over" — the settle below empties it either way (see `wasWipe`).
    if (next.phase === 'FINISHED' && next.live.length === 0) {
      // A wipe leaves the model with no action in it, so closing the round is
      // bookkeeping rather than a decision — and the screen should be able to
      // state what was already sheltered or won on a side bet without asking the
      // player to press a button to find out (§S6). This is already inside a
      // guarded block, so it settles directly rather than through `finishRound`.
      if (next.settlement === null) await settleRound();
      // Through `wasWipe` like every other settled screen, even though the live
      // set has already answered the question here: one rule, so there is no
      // second place left that can disagree with the settlement. And last, so
      // that §S6's two seconds of fog are measured from the moment the screen is
      // drawn rather than from the moment the settle was sent.
      enterSettled(wasWipe((state.frame as Frame).settlement, next.live.length));
    } else {
      state.view = 'resolve';
      playResolveBeat(payload.resolution);
    }
  });
}

/** §S3: the `skip` affordance appears after 1.5 s, and at 1.5 s. */
const SKIP_AT = 1500;

/* ------------------------------------------------------------------- S3 */

/**
 * S3 — the run.
 *
 * §S3: *"Viewport expands to full bleed. Decision surface slides away; only the
 * claim and squad count remain, docked bottom-left."* That is this screen exactly:
 * the stage takes the whole frame and the HUD is two lines in the corner.
 *
 * The travel is animated by the stage on its own clock; this function only
 * advances the *progress* the stage travels along, which is why it re-renders on a
 * slow 260 ms tick rather than per frame. Everything that has to be smooth — the
 * fog, the gait, the lantern swing, the camera — is inside the canvas.
 *
 * **The client does not know the outcome while this screen is up, and that is
 * structural.** The transcript is not revealed until `/resolve`, so nothing here
 * can foreshadow who falls. §6.9 rule 4 — *"we never author a near-miss that is
 * not in the data"* — is satisfied here by there being no data yet to author
 * against.
 */
function runScreen(): HTMLElement {
  const frame = state.frame as Frame;
  const elapsed = Date.now() - state.runStartedAt;
  const progress = Math.min(0.95, elapsed / 9000);
  const laneSizes =
    state.route === 'SPLIT' && state.laneSplit !== null
      ? [state.laneSplit, frame.live.length - state.laneSplit]
      : null;
  // §9's beat, and the condition for it is a fact about the frame: one runner is
  // carrying the whole claim across.
  const lastLamp = frame.live.length === 1;
  // It is also a fact about the *round* from that moment on, whichever way the
  // round ends: §10.7 requires both endings to export, so S7 reads this and not
  // the settlement.
  if (lastLamp) state.lastLampRound = true;
  /*
   * The travel tick stops the moment a command is in flight.
   *
   * `/resolve` lands its frame before the settle that follows it is awaited, so
   * for as long as that await lasts the view is still `run` while the frame
   * already says the round is over — and this tick was rendering exactly that: a
   * run screen with `0.000` and *"0 running"* on it, which also handed the stage
   * a scene with an empty live set and deleted every figure in it. The §9 descent
   * then had nothing left to drop, which is why the wipe opened on empty fog. A
   * screen does not re-read the world while it is being taken away from it.
   */
  /*
   * …and the next tick lands on the `skip` affordance's own deadline.
   *
   * §S3 puts it at 1.5 s. On a 260 ms travel tick it actually appeared at 1624 ms
   * — measured — because the deadline fell between two ticks, so the first 1.6 s
   * of every 9-14 s replay offered no visible way out. The tick that would step
   * over the deadline is moved onto it instead.
   */
  const toSkip = SKIP_AT - elapsed;
  window.setTimeout(
    () => {
      if (state.view === 'run' && !state.busy) render();
    },
    toSkip > 0 && toSkip < 260 ? toSkip : 260,
  );

  return el(
    'div',
    { class: 'screen' },
    viewport({
      title: frame.arena.name,
      subtitle: lastLamp ? 'One light, and the branch narrows into fog.' : '',
      counter: `${frame.arena.index} / ${frame.arena.of}`,
      lanes: laneSizes ? 2 : 1,
      arena: frame.arena.index,
      mode: 'run',
      full: true,
      lastLamp,
      runners: orderedRunners(frame).map((runner, index) => ({
        slot: runner.slot,
        name: runner.name,
        status: runner.status,
        lane: laneSizes && index >= (laneSizes[0] as number) ? 1 : 0,
      })),
      progress,
      overlay: frag(
        // §9: *"There is no HUD except the claim, dimmed to 40%."*
        el(
          'div',
          { class: `hud-dock${lastLamp ? ' dimmed' : ''}` },
          el('div', { class: 'claim-figure money', text: frame.claim.display }),
          el('div', {
            class: 'tiny',
            text: `${frame.live.length} ${frame.live.length === 1 ? 'still out' : 'running'}`,
          }),
        ),
        // §S3: a `skip` affordance after 1.5 s, low contrast, bottom-right. It
        // skips the view and not the result, and it does not shorten the cycle.
        elapsed >= SKIP_AT
          ? el('button', {
              class: 'btn quiet stage-skip',
              text: 'skip ▸',
              'aria-label': COPY.skipNote,
              title: COPY.skipNote,
              onClick: () => void resolveArena(),
            })
          : null,
      ),
    }),
  );
}

/* ------------------------------------------------------------------- S4 */

/**
 * S4 — resolve, staged in beats, and the order is the teaching.
 *
 * §5.2.2 is unambiguous about it: *"On a resolve, the pips of fallen runners go
 * dark **first**, held for 350 ms with the claim figure unchanged, and only then
 * does the claim roll to its new value. Cause before effect, always in that
 * order. A player watching this three times has the money rule whether or not
 * they read anything."*
 *
 * The frame the server sends already has all of it applied — the new claim, the
 * new squad statuses, the arithmetic — so the beat is played out of a state the
 * frame no longer describes. `state.beatStep` is that state, and this function is
 * a pure function of it:
 *
 * | step | the frame the player is looking at |
 * | --- | --- |
 * | 0 | the arena as it was: everyone still out, the claim it went in with |
 * | 1 | the lane has given way and the lanterns are out; the claim has not moved |
 * | 2 | the claim rolls, and the arithmetic that produced it arrives behind it |
 *
 * Being a pure function of the step is what makes it safe for the session poll or
 * a toast to re-render mid-beat, which the first build of this screen was not.
 */
function resolveScreen(): HTMLElement {
  const frame = state.frame as Frame;
  const arena = state.lastArena as ArenaRecord;
  const config = state.config as Config;
  const nextName = config.game.arenaNames[frame.arena.index - 1] ?? '';
  const finished = frame.phase === 'FINISHED';
  const step = state.beatStep;

  const fallenSlots = new Set(arena.fallen.map((runner) => runner.slot));
  const shelteredSlots = new Set(arena.shelter.map((runner) => runner.slot));
  const inArena = new Set(arena.lanes.flatMap((lane) => lane.entities.map((entity) => entity.slot)));
  // The share each runner was carrying *into* this arena, which is the figure the
  // pips have to be showing while the claim is still held at its old value.
  const shareBefore = String(micro(arena.claimBeforeMicro) / BigInt(Math.max(1, arena.running)));

  // Step 0 shows the arena as it was: the resolution has landed on the server and
  // the screen has not caught up yet, which is the whole point of a staged beat.
  const sceneRunners = arena.lanes.flatMap((lane, laneIndex) =>
    lane.entities.map((entity) => ({
      slot: entity.slot,
      name: entity.name,
      status:
        step === 0
          ? 'running'
          : shelteredSlots.has(entity.slot)
            ? 'home'
            : fallenSlots.has(entity.slot)
              ? 'lost'
              : 'running',
      lane: laneIndex,
    })),
  );

  // The pips are the money object, so they follow the same clock as the claim: lit
  // and carrying their old share at step 0, dark at step 1, and the figure above
  // them does not move until step 2. Runners lost or banked in an *earlier* arena
  // are not part of this beat and are left exactly as the frame has them.
  const pipSquad = frame.squad.map((member) =>
    step === 0 && inArena.has(member.slot)
      ? { ...member, status: 'running' as const, valueMicro: shareBefore }
      : member,
  );
  const beforeDisplay = credits(arena.claimBeforeMicro, 3).slice(0, 5);

  return el(
    'div',
    /*
     * `resolving` is a layout state, and it is there to close a hole.
     *
     * The round-2 review measured up to 255 px of empty panel between the last
     * line of copy and the buttons on this screen — 30% of the viewport, on the
     * emotional beat of the loop. The slack belongs to the *world*, not to a
     * blank plate: the stage takes it, which is also what gives a fall on the
     * thin limb somewhere to happen (§9's descent was playing inside a 200 px
     * strip). The panel is sized by its content and nothing else.
     */
    { class: 'screen fade-in resolving' },
    viewport({
      title: arena.name,
      subtitle:
        step === 0
          ? 'They commit.'
          : arena.fallen.length > 0
            ? 'The branch took some of them.'
            : 'They are across.',
      counter: `${arena.index} / ${frame.arena.of}`,
      lanes: arena.lanes.length,
      arena: arena.index,
      mode: 'resolve',
      collapsed: step === 0 ? [] : arena.lanes.map((lane) => lane.collapsed),
      runners: sceneRunners,
      progress: step === 0 ? 0.62 : 0.94,
    }),
    claimMeter({
      claim: step === 2 ? frame.claim.display : beforeDisplay,
      caption: 'claim',
      squad: pipSquad,
      bankedNote: step === 0 ? null : bankedNote(frame),
      // §S4: the claim *rolls* — tabular, ~600 ms, no spinning. The meter starts the
      // figure at the value the arena went in with and counts to the value above.
      rollFrom: step === 2 ? beforeDisplay : null,
    }),
    el(
      'div',
      { class: 'surface pad stack' },
      // §S4: the arithmetic in full for one beat — never a mystery multiplier. It
      // arrives *after* the claim has started moving, so it reads as the
      // explanation of something the player has already seen happen.
      step === 2 ? el('p', { class: 'arithmetic money settle-in late', text: arena.arithmetic }) : null,
      step === 0
        ? null
        : arena.fallen.length > 0
          ? el(
              'p',
              { class: 'note settle-in' },
              // §10.1: individuals are named at the moment of loss — in one
              // sentence, not one sentence each: two names produced the run-on
              // "Wren did not make it. Ora did not make it." on a single line.
              el('span', {
                class: 'lost-name',
                text: `${didNotList(arena.fallen, 'did not make it')}.`,
              }),
            )
          : el('p', { class: 'note settle-in', text: 'Everyone is across.' }),
      step === 2 && micro(arena.shelterCreditedMicro) > 0n
        ? el('p', {
            class: 'note banked-figure settle-in late',
            text: `${arena.shelter.map((runner) => runner.name).join(', ')} came home — ${credits(arena.shelterCreditedMicro, 3)} banked.`,
          })
        : null,
      // §S4: side-bet money is never blended into the claim figure — its own line,
      // its own stake, its own result, stated separately from the run.
      ...(step === 2
        ? arena.sideBets.map((ticket) =>
            el('p', {
              class: 'note settle-in late',
              text: `${ticket.bet.replace('_', ' ')} ${credits(ticket.stakeMicro, 2)} — ${ticket.won ? `paid ${credits(ticket.creditedMicro, 2)}` : 'lost'}.`,
            }),
          )
        : []),
      step === 2 && state.session && state.session.roundsSeen === 0 && arena.index === 1
        ? el('p', { class: 'note settle-in late', text: COPY.firstResolve })
        : null,
    ),
    /*
     * The actions arrive with the result, and not before it.
     *
     * The round-2 review instrumented this at 90 ms: the panel mounted with the
     * *previous* arena's chips, an empty body, the claim still reading its old
     * value — and `Bank 12.12` already on screen and already tappable. For ~280 ms
     * the player could read the outcome off the button while the screen was still
     * telling them it had not happened, and could commit the next money command
     * before being told who died. Both halves of that are fixed by the same rule:
     * a button whose label is a post-resolve figure is drawn on the beat that
     * states the resolve, which is step 2 (§5.2.2's cause before effect, applied
     * to the controls as well as to the figures).
     */
    step < 2
      ? null
      : el(
          'div',
          { class: 'footer settle-in' },
          finished
            ? el('button', {
                class: 'btn primary',
                text: `Bring them home — ${credits(frame.bankAmountMicro, 2)}`,
                onClick: () => finishRound(),
              })
            : el(
                'div',
                { class: 'btn-row' },
                el('button', {
                  class: 'btn',
                  text: `Bank ${credits(frame.bankAmountMicro, 2)}`,
                  onClick: () => bankRound(),
                }),
                el('button', {
                  class: 'btn',
                  text: `Run ${nextName} ▸`,
                  onClick: () => {
                    resetChoice();
                    state.view = 'route';
                    render();
                  },
                }),
              ),
          cycleBar(frame),
          el('p', { class: 'tiny', text: COPY.noClock }),
        ),
  );
}

/**
 * The game-cycle hairline (§5.1).
 *
 * Fills under the primary action, no numerals, no ticking sound. When it
 * completes nothing has expired — the server simply stops refusing the next money
 * command with `TOO_SOON`.
 */
function cycleBar(frame: Frame): Child {
  const skew = Date.now() - frame.speed.serverNowMs;
  const deadline = frame.speed.earliestNextActionAtMs + skew;
  const total = frame.speed.minGameCycleMs;
  // Nothing to draw once the floor has passed: a full bar that never empties
  // reads as a meter, and this is not a meter.
  if (deadline - Date.now() <= 0) return null;

  const fill = el('span', {});
  /**
   * The hairline advances itself, and does **not** re-render the screen.
   *
   * The first build ticked this with `render()` every 400 ms, which rebuilt the
   * whole tree — including the card pager — four times a second while the player
   * was reading it. A progress hairline is decoration over a server-enforced
   * floor, so it mutates one element's width and nothing else, and it stops the
   * moment it is detached.
   */
  const advance = () => {
    const remaining = deadline - Date.now();
    const filled = Math.max(0, Math.min(1, 1 - remaining / total));
    fill.style.width = `${(filled * 100).toFixed(1)}%`;
    if (remaining > 0 && fill.isConnected) window.setTimeout(advance, 200);
  };
  advance();
  return el('div', { class: 'cycle', 'aria-hidden': 'true' }, fill);
}

async function bankRound(): Promise<void> {
  const frame = state.frame as Frame;
  await guard(async () => {
    const payload = await api<{ frame: Frame; session: Session; wallet: WalletView }>(
      'POST',
      `/api/rounds/${frame.roundId}/bank`,
      { idempotencyKey: idempotencyKey('bank'), expectedFrameRevision: frame.frameRevision },
    );
    adopt(payload);
    // A bank is only legal while someone is still out (`server/rounds.ts`), so it
    // is never the round where nobody came home.
    enterSettled(false);
  });
}

/**
 * The settle request itself, with no `guard()` around it.
 *
 * `guard` is deliberately not re-entrant: it returns immediately when a command
 * is already in flight, which is what stops a double tap becoming a double
 * command. That makes it the wrong thing to nest, and nesting it is how a wipe
 * came to leave the round open on the server — `resolveArena` called the guarded
 * `finishRound` from inside its own guarded block, the inner call returned
 * without doing anything, and the settle only landed later when the player
 * tapped their way off the screen. Callers that are already inside a guard call
 * this; callers that are not call `finishRound`.
 */
async function settleRound(): Promise<void> {
  const frame = state.frame as Frame;
  const payload = await api<{ frame: Frame; session: Session; wallet: WalletView }>(
    'POST',
    `/api/rounds/${frame.roundId}/finish`,
    { idempotencyKey: idempotencyKey('finish') },
  );
  adopt(payload);
}

async function finishRound(): Promise<void> {
  await guard(async () => {
    // The settlement's own `kind` decides this, and `wasWipe` carries the reason
    // why. The live set is read here only as its fallback, and it is read *before*
    // the settle because that is the last moment it still means "still out there".
    const liveBeforeSettle = (state.frame as Frame).live.length;
    await settleRound();
    enterSettled(wasWipe((state.frame as Frame).settlement, liveBeforeSettle));
  });
}

/**
 * The one place that chooses between the two settled screens.
 *
 * They say opposite things about the same round — S6 *"No one made it back"* and
 * S5's brass door closing on a light that is still burning — so the choice is
 * made once, from the settlement, and every path into a settled screen goes
 * through here rather than re-deciding it locally.
 */
function enterSettled(wiped: boolean): void {
  // Both endings open on the world and nothing else, and step up from there.
  state.settleStep = 0;
  heroRolled = false;
  startClip();
  if (!wiped) {
    state.view = 'banked';
    // §S5 / §9: a door, a bell and a frame that goes briefly warm. The bell's
    // chord thickens with the number of lanterns inside, and it does not get
    // louder — §10.5 means this sound plays over a 0.76x recovery too.
    const home = (state.frame as Frame).squad.filter((member) => member.status === 'home').length;
    playSettledBeat(Math.max(1, home));
    return;
  }
  state.view = 'wipe';
  // §S6's two seconds of fog with no UI on them are measured from the moment the
  // screen is entered, so every path into it starts that clock. It also gates the
  // `Run again` affordance, which must never appear on a round that was not lost.
  state.wipeAtMs = Date.now();
  playWipeBeat(state.lastArena);
}

/**
 * The bank (§S5, and §9 when it is the last one).
 *
 * *"The Lamp House door opens, the chosen lanterns go inside, the brass bell
 * strikes once, and the saved lights stack into a small constellation above the
 * door."* §6.4 decides what this may not be: no confetti, no coin fountain, no
 * screen shake. *"The reward for a big bank is that the tree is briefly warm."*
 * So the whole celebration is `bloom` — the lantern glows widen and fade back —
 * plus a door, a bell, and the claim counting up. Nothing moves across the frame.
 */
function playSettledBeat(lanterns: number): void {
  stopBeat();
  /*
   * The door beat, staged against the drawing that plays it.
   *
   * `DOOR_BEAT` in the stage is the timeline for the picture — leaf, file,
   * leaf, grille — and these are the sounds and the type landing on the same
   * marks: one soft brass note per lantern as it goes through the doorway, the
   * bell on the door closing, the hero figure counting up on the bell, the copy
   * behind it, and the way out last of all. §9 asks for the rescue to be given
   * the production value of the biggest win, and this is what that is made of
   * under §6.4's rules: size, colour, light and sound, with nothing kinetic.
   */
  const finished = state.frame?.settlement?.kind === 'FINISH';
  const closedAt = finished ? 900 : doorClosedMs(lanterns);
  const steps: { at: number; run: () => void }[] = [
    {
      at: 0,
      run: () => {
        sound.stopSquadRhythm();
        sound.duckForLastLamp(false);
        if (!finished) sound.doorSwing();
        stage.effect('bloom');
      },
    },
  ];
  if (!finished)
    for (let index = 0; index < lanterns; index += 1)
      steps.push({ at: DOOR_BEAT.openMs + index * DOOR_BEAT.perLanternMs, run: () => sound.lanternHome() });
  steps.push(
    // The door shuts and the bell is struck once — the chord thickens with the
    // number of lanterns inside and never gets louder (§7, §10.5).
    { at: closedAt, run: () => sound.bank(lanterns) },
    {
      at: closedAt + 120,
      run: () => {
        state.settleStep = 1;
        render();
      },
    },
    // The frame going warm, a beat behind the door — §6.3's hand-placed bounce
    // light off the brass, which is the only "win" presentation in the game.
    { at: closedAt + 420, run: () => sound.warmth() },
    {
      at: closedAt + 1000,
      run: () => {
        state.settleStep = 2;
        render();
      },
    },
    {
      at: closedAt + 1700,
      run: () => {
        state.settleStep = 3;
        render();
      },
    },
  );
  cancelBeat = sequence(steps);
}

/* ------------------------------------------------------------- S5 and S6 */

function bankedScreen(): HTMLElement {
  const frame = state.frame as Frame;
  const settlement = frame.settlement;
  const total = micro(settlement?.totalCreditedMicro ?? '0');
  const staked = micro(settlement?.routeStakeMicro ?? '0') + micro(settlement?.sideBetStakeMicro ?? '0');
  /*
   * Two ways to reach this screen, and they are not the same place.
   *
   * A bank is a Lamp House door, mid-tree (§S5). A round that ran every arena
   * ended at the top of the tree instead, where §9 puts the Crown Lamp — so the
   * screen names the door the runners actually walked through. Nothing about the
   * money changes with it: the figure, the return against the stake and the named
   * squad are the same statements on both.
   */
  const finished = settlement?.kind === 'FINISH';
  const home = frame.squad.filter((member) => member.status === 'home');
  /*
   * §9's rescue, and the reason it gets the same production value as the biggest
   * win: *"If they bank the last one … the single lantern goes in, the door
   * closes, and the light comes through the door's grille from inside — safe, and
   * visibly still burning. Copy: 'Wren came home.'"*
   */
  const lastLampRescue = home.length === 1 && frame.squad.some((member) => member.status === 'lost');
  const step = state.settleStep;
  const lost = frame.squad.filter((member) => member.status === 'lost');
  return el(
    'div',
    { class: `screen fade-in settled${step === 0 ? ' held' : ''}` },
    viewport({
      // The world first, and the words behind it. Nothing is written over the
      // door until the door has been through its beat (§9).
      title: step === 0 ? '' : finished ? 'The Crown Lamp' : 'The Lamp House',
      subtitle:
        step === 0
          ? ''
          : finished
            ? 'The Crown Lamp resolves out of the fog.'
            : lastLampRescue
              ? 'The door closes. The light is still burning inside it.'
              : 'The door closes on a light that is still burning.',
      // No counter: the round is over, and the hero figure below already carries
      // the word `banked`. Two badges saying the same word is the round-1 habit
      // of labelling a thing twice instead of drawing it once.
      counter: '',
      chrome: step > 0,
      lanes: 1,
      arena: finished ? (state.config as Config).game.arenas : Math.max(1, frame.arena.index - 1),
      mode: finished ? 'crown' : 'door',
      full: true,
      runners: home.map((member) => ({
        slot: member.slot,
        name: member.name,
        status: 'home',
        lane: 0,
      })),
      progress: 0.62,
      /*
       * The words sit *over* the world, not in a panel under it.
       *
       * Two reasons, and both are things the round-1 build got wrong. A panel
       * takes a third of the screen from the one shot the game is built to
       * deliver — the round-2 review measured 255 px of empty surface on a
       * terminal screen — and a panel that *appears* mid-beat resizes the stage
       * under the door while the door is closing, which re-scales the house in
       * the middle of its own moment. Over the frame, nothing moves but the type.
       */
      overlay:
        step === 0
          ? null
          : el(
              'div',
              { class: 'settle-panel' },
              /*
               * The figure this whole screen is for (§9, §6.5).
               *
               * It counts up from nothing on a tabular roll, in brass, under the
               * word `banked` — and it is the largest thing in the build, which is
               * the round-2 correction: the wipe headline was 28 px and this was
               * 15 px, so the game got quieter when it paid and louder when it did
               * not.
               */
              heroFigure({
                label: finished ? 'brought home' : 'banked',
                value: credits(total, 2),
                from: rollOnce(),
                // Always stated against the stake, and never presented as a win
                // when it is not one: a 0.76x recovery says 0.76x (§10.5). There
                // is no banner over this figure and nothing here calls it a win.
                note:
                  step >= 2
                    ? el('div', {
                        class: 'hero-note settle-in',
                        text: `that's ${settlement?.returnMultiple ?? '0'}x the ${credits(staked, 2)} you staked`,
                      })
                    : null,
              }),
              step >= 2
                ? el('p', {
                    class: 'note settle-in banked-figure',
                    text: `${didNotList(home, 'came home')}.`,
                  })
                : null,
              step >= 2 && lost.length > 0
                ? el('p', { class: 'note lost-name settle-in late', text: `${didNotList(lost)}.` })
                : null,
            ),
    }),
    // The way out, last. A `Round summary` button under a door that has not
    // opened yet is the beat played behind its own exit chrome (§9).
    step >= 3
      ? el(
          'div',
          { class: 'footer' },
          el('button', {
            class: 'btn primary settle-in',
            text: 'Round summary ▸',
            onClick: () => {
              state.view = 'summary';
              render();
            },
          }),
        )
      : null,
  );
}

/** S7's clip row: the save, or the one-time opt-in, or nothing at all. */
function clipBlock(): Child[] {
  if (!state.lastLampRound || !clip.supported()) return [];
  // Six seconds of beat can outlast the tap that leaves it, so the screen says
  // what is happening rather than showing nothing and then changing its mind.
  if (clip.recording())
    return [
      el('hr', {}),
      el('p', { class: 'tiny', text: 'Saving the last six seconds of that beat…' }),
    ];
  const saved = clip.ready();
  if (saved)
    return [
      el('hr', {}),
      el('button', {
        class: 'btn quiet',
        text: 'Save the clip',
        onClick: () => clip.save(),
      }),
      el('p', {
        class: 'tiny',
        text: 'Six seconds of the beat as it played, watermarked with the round id and its verification code, saved to this device. No money figure is in the file, and saving it earns nothing.',
      }),
    ];
  if (clip.asked()) return [];
  return [
    el('hr', {}),
    el('p', {
      class: 'tiny',
      text: 'That round had a Last Lamp beat in it. This build can save the next one as a six-second clip — watermarked with the round id, its verification code and an 18+ mark, carrying no money figure, kept on this device. It is off unless you turn it on, it earns you nothing, and you will not be asked again.',
    }),
    el(
      'div',
      { class: 'btn-row' },
      el('button', {
        class: 'btn',
        text: 'Turn clips on',
        onClick: () => {
          clip.setOptedIn(true);
          render();
        },
      }),
      el('button', {
        class: 'btn',
        text: 'No clips',
        onClick: () => {
          clip.setOptedIn(false);
          render();
        },
      }),
    ),
  ];
}

/**
 * §9's clip, recorded as the beat plays (§10.7's terms in `client/src/clip.ts`).
 *
 * The two endings are the two clips: the door closing on the last lantern, and
 * the lantern going down. Both are the settled screen's own beat, so this is one
 * call in one place — and it is deliberately a capture of what is happening
 * rather than a replay of it, because the verification code on the watermark is a
 * claim that this is what the round did.
 *
 * It does nothing at all unless the player has turned the export on, which is
 * off by default and never re-prompted.
 */
function startClip(): void {
  clip.discard();
  const frame = state.frame;
  if (!frame || !state.lastLampRound || !clip.optedIn()) return;
  const canvas = stage.surface();
  if (!canvas) return;
  const code = frame.roundId.slice(-6).toUpperCase();
  // §10.7's watermark, and every line of it is required: the round id and the
  // verification code (§9), the game, the age mark and the safer-gambling
  // reference. No stake, no claim, no multiplier, no balance, no result.
  stage.mark([
    'BRANCHFALL',
    `round ${frame.roundId.slice(0, 8)} · verify ${code}`,
    '18+ · begambleaware.org · free play, no real money',
  ]);
  clip.record(canvas, frame.roundId, code);
  window.setTimeout(() => stage.mark(null), clip.CLIP_MS);
  // The offer belongs to the round it was recorded on, so the screen that offers
  // it is told when the file exists rather than being left with a stale answer.
  clip.onReady(() => {
    if (state.view === 'summary') render();
  });
}

/** `'0.00'` the first time a settled screen draws its figure, and never again. */
function rollOnce(): string | null {
  if (heroRolled) return null;
  heroRolled = true;
  return '0.00';
}

/**
 * The fallen, named, in one sentence (§10.1).
 *
 * *"Individuals are named at the moment of loss"* — and two of them named in two
 * sentences on one line is the run-on the round-2 review found: *"Wren did not
 * make it. Ora did not make it."* One list, one verb, the same names.
 */
function didNotList(members: readonly { name: string }[], verb = 'did not'): string {
  const names = members.map((member) => member.name);
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} ${verb}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} ${verb}`;
}

/**
 * Leaves the wipe screen, closing the round first if the settle has not landed.
 *
 * The round is normally already settled by the time this screen is drawn; this
 * covers the case where that request failed, so a player is never stuck on the
 * screen that says everyone is gone.
 */
async function leaveWipe(view: View, before?: () => void): Promise<void> {
  const frame = state.frame;
  if (frame && frame.settlement === null) await guard(settleRound);
  before?.();
  state.view = view;
  render();
}

/**
 * S6 — the wipe, and §9's other ending.
 *
 * §S6: *"The last lantern falls, tumbles, and goes out. Two full seconds of fog
 * and wind with no UI at all. Then, quietly: 'No one made it back.'"*
 *
 * The stage is handed the arena's own runners, now fallen, so it plays the descent
 * as a transition out of the frame it was already drawing — §9's shot stays with
 * the lantern, not with the branch, all the way down. The screen carries no offer,
 * no bonus, no pre-filled stake and no one-tap replay (§10.2), and its primary
 * action leads *away* from the stake field.
 */
function wipeScreen(): HTMLElement {
  const frame = state.frame as Frame;
  const arena = state.lastArena;
  const sinceLoss = Date.now() - state.wipeAtMs;
  /*
   * §S6's clock, and everything on the screen is behind it.
   *
   * *"Two full seconds of fog and wind with no UI at all."* Round 1 gated the
   * heading and `Run again` on this and left the footer mounted, so §9's hero
   * descent — the clip the game is supposed to be shareable for — played above a
   * brass `Back to the squad` in a 250 px strip while the lantern was still in
   * the air. The gate is the same clock; what changed is that it now covers the
   * whole screen, which is what the sentence says.
   */
  const held = sinceLoss < 2000;
  if (sinceLoss < 2200) window.setTimeout(() => state.view === 'wipe' && render(), 2300 - sinceLoss);
  return el(
    'div',
    { class: `screen fade-in settled${held ? ' held' : ''}` },
    viewport({
      title: held ? '' : 'The Understory',
      subtitle: '',
      counter: '',
      chrome: !held,
      lanes: arena?.lanes.length ?? 1,
      arena: arena?.index ?? frame.arena.index,
      mode: 'quiet',
      full: true,
      collapsed: arena?.lanes.map((lane) => lane.collapsed) ?? [],
      runners: (arena?.lanes ?? []).flatMap((lane, laneIndex) =>
        lane.entities.map((entity) => ({
          slot: entity.slot,
          name: entity.name,
          status: 'lost',
          lane: laneIndex,
        })),
      ),
      progress: 0.9,
      // Over the fog, like the other ending — the descent keeps the whole frame
      // and the words arrive on top of it when the two seconds are up.
      overlay: held
        ? null
        : el(
            'div',
            { class: 'settle-panel' },
            /*
             * The other ending, at the same weight and none of the warmth.
             *
             * The round-2 review measured the asymmetry: a 28 px wipe headline
             * over a 15 px banked figure. Both endings now state themselves at
             * hero size — this one in the cool value, with no roll, no glow and no
             * light, so the loss is legible and dignified rather than the loudest
             * thing in the game (§S6, §10.2).
             */
            heroFigure({
              label: 'no one made it back',
              value: credits(frame.stakeMicro, 2),
              tone: 'cold',
              note: el('div', { class: 'hero-note settle-in', text: 'staked, and not returned' }),
            }),
            micro(frame.settlement?.totalCreditedMicro ?? '0') > 0n
              ? el('p', {
                  class: 'note banked-figure settle-in late',
                  text: `Sheltered and side bets, stated separately: ${credits(frame.settlement?.totalCreditedMicro ?? '0', 2)}.`,
                })
              : null,
          ),
    }),
    // §S6: one primary action, and it leads away from the stake field. The round
    // is already closed by the time this screen settles, so nothing here is a
    // money command — and there is no offer, no bonus, no pre-filled stake and no
    // one-tap replay anywhere on it (§10.2). None of it is drawn during the two
    // seconds the descent owns.
    held
      ? null
      : el(
          'div',
          { class: 'footer' },
          el('button', {
            class: 'btn primary settle-in',
            text: 'Back to the squad',
            onClick: () => void leaveWipe('squad'),
          }),
          el('div', { style: 'height:10px' }),
          el('button', {
            class: 'btn quiet settle-in',
            text: 'Round summary',
            onClick: () => void leaveWipe('summary'),
          }),
          // `Run again` never pre-fills the previous stake and carries no offer.
          el('button', {
            class: 'btn quiet settle-in late',
            text: 'Run again',
            onClick: () =>
              void leaveWipe('stake', () => {
                state.stakeMicro = micro((state.config as Config).money.minStakeMicro);
                state.clientSeed = newClientSeed();
                state.frame = null;
              }),
          }),
        ),
  );
}

/* ------------------------------------------------------------------- S7 */

function summaryScreen(): HTMLElement {
  const frame = state.frame as Frame;
  const settlement = frame.settlement;
  const staked = micro(settlement?.routeStakeMicro ?? '0') + micro(settlement?.sideBetStakeMicro ?? '0');
  const credited = micro(settlement?.totalCreditedMicro ?? '0');
  return el(
    'div',
    { class: 'screen fade-in' },
    el(
      'div',
      { class: 'surface pad stack' },
      el('h1', { text: 'The run' }),
      ...frame.history.map((arena) =>
        el(
          'div',
          { class: 'card arena-row' },
          el(
            'div',
            { class: 'spread' },
            el('span', { class: 'route-name', text: `${arena.index}. ${arena.route}` }),
            el('span', { class: 'money', text: credits(arena.claimAfterMicro, 3) }),
          ),
          el('div', { class: 'tiny', text: arena.name }),
          arena.laneSplit !== null
            ? el('div', {
                class: 'tiny',
                text: `fork ${arena.laneSplit} + ${arena.running - arena.laneSplit} · thin limb: ${arena.lanes[1]?.entities.map((runner) => runner.name).join(', ') ?? '—'}`,
              })
            : null,
          el('div', { class: 'tiny', text: arena.arithmetic }),
          arena.fallen.length > 0
            ? el('div', {
                class: 'tiny lost-name',
                text: `lost: ${arena.fallen.map((runner) => runner.name).join(', ')}`,
              })
            : null,
          ...arena.sideBets.map((ticket) =>
            el('div', {
              class: 'tiny',
              text: `${ticket.bet} ${credits(ticket.stakeMicro, 2)} — ${ticket.won ? `paid ${credits(ticket.creditedMicro, 2)}` : 'lost'}`,
            }),
          ),
        ),
      ),
      el('hr', {}),
      field('Staked, run', credits(settlement?.routeStakeMicro ?? '0', 2)),
      field('Staked, side bets', credits(settlement?.sideBetStakeMicro ?? '0', 2)),
      field('Credited', credits(credited, 2)),
      /*
       * The loss, floored away from zero, here as well as on the session strip.
       *
       * `credits` truncates, which is player-safe on a credit and understates a
       * debit: a true net of -0.9300001 printed as -0.93 says the round cost less
       * than it did. The two places in the build that print a net now use the
       * same rule, which is also why they no longer disagree in the last digit.
       */
      field(
        'Net',
        credited >= staked
          ? `+${credits(credited - staked, 2)}`
          : `−${creditsSigned(credited - staked).slice(1)}`,
      ),
      el('p', { class: 'tiny', text: `Return ${settlement?.returnMultiple ?? '—'}x on everything staked.` }),
      /*
       * §9's clip, offered on the round it belongs to (§10.7's terms).
       *
       * The offer appears after any round that contained a Last Lamp beat, won or
       * lost, and the losing one is not degraded, delayed or hidden. Saving is a
       * file on this device and nothing else: no upload, no acknowledgement, no
       * bonus, no progress — §10.7's no-incentive rule with no telemetry behind
       * it. The first time the beat could have been recorded, the offer is the
       * opt-in instead, asked once and never again.
       */
      ...clipBlock(),
    ),
    el(
      'div',
      { class: 'footer' },
      el('button', {
        class: 'btn primary',
        text: 'How this was decided ▸',
        onClick: () => void openVerify(),
      }),
      el('div', { style: 'height:10px' }),
      el('button', {
        class: 'btn quiet',
        text: 'Back to the squad',
        onClick: () => {
          state.view = 'squad';
          state.frame = null;
          render();
        },
      }),
    ),
  );
}

/* ------------------------------------------------------------------- S8 */

async function openVerify(): Promise<void> {
  const frame = state.frame as Frame;
  await guard(async () => {
    const payload = await api<{
      bundle: unknown;
      report: { ok: boolean; checks: readonly VerifyCheck[] };
      ghost: readonly GhostRow[];
    }>('GET', `/api/rounds/${frame.roundId}/verify`);
    state.verify = { checks: payload.report.checks, bundle: payload.bundle, ghost: payload.ghost };
    // A fresh bundle is a fresh question: never show one round's re-derivation
    // over another round's hashes.
    state.rederived = null;
    state.view = 'verify';
  });
}

/**
 * The verification screen (`DESIGN.md` §S8), and the distinction it is built on.
 *
 * The first build of this screen printed eleven green ticks under the heading
 * *"Re-derived, here, now"* — and every one of them was a field the **server**
 * computed and sent. The party being checked was supplying its own verdict, and
 * nothing on the screen said so. §6.1 says the proof UI must not feel like a
 * reward; a wall of green ticks from the counterparty is exactly that failure.
 *
 * So this screen now has three sections, and the boundary between them is the
 * point:
 *
 * 1. **What this device recomputed.** `client/src/derive.ts` is a second
 *    implementation of the engine's derivation, in the browser, with no import
 *    of the engine or of anything the server sent except the seed and the
 *    transcript. It re-derives the definition fingerprint, the seed
 *    pre-commitment, the whole 300-draw tape and every arena's draws, and shows
 *    each arena's numbers against the outcome. If it disagrees, it says so.
 * 2. **What the server reports.** The ledger half — that every credit matches a
 *    fresh re-derivation — is the server's own report, labelled as the server's
 *    own report, because that is what it is.
 * 3. **What you can check off this device.** The bundle export, which
 *    `npm run verify:bundle` verifies on any machine, including the ledger the
 *    browser does not recompute.
 */
function verifyScreen(): HTMLElement {
  const frame = state.frame as Frame;
  const verify = state.verify;
  const session = state.session as Session;
  const fairness = frame.fairness;
  const losing =
    micro(frame.settlement?.totalCreditedMicro ?? '0') <
    micro(frame.settlement?.routeStakeMicro ?? '0');
  const ghostCooling = losing && Date.now() - frame.lastLossAtMs < 60_000;
  const names = new Map(frame.squad.map((member) => [member.slot, member.name]));
  const nameOf = (slot: number) => names.get(slot) ?? `runner ${slot}`;

  return el(
    'div',
    { class: 'screen fade-in' },
    el(
      'div',
      { class: 'surface pad stack' },
      el('h1', { text: 'How this was decided' }),
      el('p', { class: 'note', text: COPY.sealNote }),
      el(
        'div',
        {},
        hashRow('Server pre-commitment', fairness.preCommitment, 'published before your seed existed'),
        hashRow(
          'Your client seed',
          fairness.clientSeed ?? '—',
          fairness.clientEntropyIsSeed
            ? 'generated on this device, used exactly as it stands'
            : 'generated on this device — hashed into the round entropy below',
        ),
        fairness.clientEntropyIsSeed
          ? null
          : hashRow('Round entropy', fairness.clientEntropy ?? '—', 'SHA-256 of your seed'),
        hashRow('Hazard tape digest', fairness.tapeDigest ?? '—', 'published when the round opened'),
        hashRow('Revealed server seed', fairness.revealedServerSeed ?? '—', 'revealed at settlement'),
        hashRow('Adapter fingerprint', fairness.fingerprint, `${fairness.definitionId} ${fairness.definitionVersion}`),
      ),
      el('h2', { text: 'What this device recomputed' }),
      rederiveBlock(nameOf),
      el('hr', {}),
      el('h2', { text: 'What the server reports' }),
      el('p', {
        class: 'note',
        text: 'These are the server’s checks on its own settlement, and they are its own word for it. They are worth showing because anyone can repeat them somewhere else: the bundle below carries everything they are computed from.',
      }),
      ...(verify?.checks ?? []).map((check) =>
        el(
          'div',
          { class: 'check' },
          el('span', { class: `mark${check.ok ? '' : ' bad'}`, text: check.ok ? '✓' : '✕' }),
          el(
            'div',
            {},
            el('div', { text: check.title }),
            el('div', { class: 'hash', text: check.detail }),
          ),
        ),
      ),
      el('button', {
        class: 'btn',
        text: 'Copy verification bundle',
        onClick: () => {
          void navigator.clipboard
            ?.writeText(JSON.stringify(verify?.bundle ?? {}, null, 2))
            .then(() => toast('Bundle copied. `npm run verify:bundle -- file.json` checks it anywhere.'));
        },
      }),
      el('p', {
        class: 'tiny',
        text: 'The bundle also carries the money: the ledger check re-derives every credit from the transcript and the stake, and it is the half this browser does not recompute.',
      }),
      el('hr', {}),
      el('h2', { text: 'The Ghost Line' }),
      el('p', { class: 'note', text: COPY.ghostNote }),
      ghostCooling
        ? el('p', { class: 'tiny', text: 'Not available for a minute after a losing round.' })
        : el('button', {
            class: 'btn quiet',
            text: session.ghostLineEnabled ? 'Turn the Ghost Line off' : 'Turn the Ghost Line on',
            onClick: () =>
              void guard(async () => {
                adopt(await api('POST', '/api/session', { ghostLineEnabled: !session.ghostLineEnabled }));
                await openVerify();
              }),
          }),
      ...(session.ghostLineEnabled && !ghostCooling ? ghostRows(verify?.ghost ?? []) : []),
      el('hr', {}),
      el('h2', { text: 'Receipts' }),
      ...frame.receipts.map((receipt) =>
        el('div', {
          class: 'hash',
          text: `${String(receipt.action)} · frame ${String(receipt.frameRevision)} · debited ${String(receipt.debited)} · credited ${String(receipt.credited)}${receipt.capped ? ' · capped' : ''}`,
        }),
      ),
      el('p', {
        class: 'tiny',
        text: 'Not a fairness certificate, an RNG certificate or regulatory approval. This is a free-play prototype.',
      }),
    ),
    el(
      'div',
      { class: 'footer' },
      el('button', {
        class: 'btn',
        text: 'Back to the squad',
        onClick: () => {
          state.view = 'squad';
          state.frame = null;
          render();
        },
      }),
    ),
  );
}

/** The on-device half: the button, the result, and every arena's draws. */
function rederiveBlock(nameOf: (slot: number) => string): Child {
  const frame = state.frame as Frame;
  const result = state.rederived;

  if (state.rederiving)
    return el('p', { class: 'note', text: 'Recomputing the hazard table on this device…' });

  if (!result)
    return frag(
      el('p', {
        class: 'note',
        text: 'Nothing here has been checked by this device yet. Re-derive recomputes the definition fingerprint, the seed commitment and the whole hazard table from the revealed seed — a second implementation of the engine’s derivation, running in your browser, which is only useful because it can disagree.',
      }),
      el('button', {
        class: 'btn',
        text: 'Re-derive on this device',
        disabled: frame.fairness.revealedServerSeed === null,
        onClick: () => void runRederivation(),
      }),
      frame.fairness.revealedServerSeed === null
        ? el('p', { class: 'tiny', text: 'The server seed is revealed at settlement. Until then there is nothing to open.' })
        : null,
    );

  if (!result.available)
    return frag(
      el(
        'div',
        { class: 'check' },
        el('span', { class: 'mark unknown', text: '—' }),
        el(
          'div',
          {},
          el('div', { text: 'This device could not recompute the round' }),
          el('div', { class: 'hash', text: result.reason ?? 'unknown reason' }),
        ),
      ),
      el('p', {
        class: 'tiny',
        text: 'That is a statement about this browser, not a verdict on the round. The exported bundle still verifies anywhere.',
      }),
    );

  const check = (ok: boolean, title: string, detail: string) =>
    el(
      'div',
      { class: 'check' },
      el('span', { class: `mark${ok ? '' : ' bad'}`, text: ok ? '✓' : '✕' }),
      el('div', {}, el('div', { text: title }), el('div', { class: 'hash', text: detail })),
    );

  return frag(
    el('p', {
      class: 'note',
      text: `${result.drawCount} draws recomputed here in ${Math.round(result.elapsedMs)} ms, from the revealed seed and this device’s own copy of the game’s declaration.`,
    }),
    check(
      result.fingerprintMatches,
      'The game played is the game this device holds',
      `fingerprint ${result.fingerprint.slice(0, 24)}…`,
    ),
    check(
      result.commitmentMatches,
      'The revealed seed opens the commitment published before your seed existed',
      `${result.seedCommitment.slice(0, 24)}…`,
    ),
    check(
      result.digestMatches,
      'The tape published when the round opened is the tape this device re-derives',
      `digest ${result.tapeDigest.slice(0, 24)}…`,
    ),
    ...result.arenas.map((arena) =>
      el(
        'details',
        { class: 'provenance' },
        el(
          'summary',
          {},
          el('span', {
            class: `mark${arena.matchesTranscript ? '' : ' bad'}`,
            text: arena.matchesTranscript ? '✓ ' : '✕ ',
          }),
          `Arena ${arena.index + 1} · ${routeLabel(arena.contractId, arena.running.length)} — ${arena.survivors.length} of ${arena.running.length} across`,
        ),
        ...arena.lanes.map((lane, index) =>
          el(
            'div',
            { class: 'draw-row' },
            el('span', {
              text: `lane ${index + 1} (${lane.entities.map(nameOf).join(', ')})`,
            }),
            el('span', {
              class: 'money',
              text: `${lane.draw} / ${lane.modulus} vs ${lane.threshold} — ${lane.collapsed ? 'collapsed' : 'held'}`,
            }),
          ),
        ),
        ...arena.entities.map((entity) =>
          el(
            'div',
            { class: 'draw-row' },
            el('span', { class: 'runner-name', text: nameOf(entity.entity) }),
            el('span', {
              class: 'money',
              text: `${entity.draw} vs ${entity.threshold} — ${entity.survived ? 'across' : 'fell'}`,
            }),
          ),
        ),
        el('p', { class: 'tiny', text: arena.note }),
      ),
    ),
    result.ok
      ? el('p', {
          class: 'tiny',
          text: 'Every draw this round consumed was in the tape sealed before you chose anything. That is what this device checked; it is not a certificate, and it says nothing about what you were paid — that is the ledger, below.',
        })
      : el('p', {
          class: 'note',
          text: 'This device does not agree with the published round. Export the bundle and check it elsewhere before believing either of us.',
        }),
    el('button', {
      class: 'btn quiet',
      text: 'Re-derive again',
      onClick: () => void runRederivation(),
    }),
  );
}

/**
 * The engine's contract id, in the game's own words.
 *
 * `SPLIT_4` is the module's name for the geometry (`server/definition.ts`
 * declares one contract per legal lead-lane size); the player chose "4 + 1" and
 * that is what the proof screen should say back to them.
 */
function routeLabel(contractId: string, running: number): string {
  const split = /^SPLIT_(\d+)$/u.exec(contractId);
  if (!split) return contractId;
  const lead = Number(split[1]);
  return `SPLIT ${lead} + ${running - lead}`;
}

async function runRederivation(): Promise<void> {
  const frame = state.frame as Frame;
  const bundle = state.verify?.bundle as
    | { transcript?: unknown; revealedServerSeed?: string; definition?: { fingerprint?: string } }
    | undefined;
  if (!bundle || typeof bundle.revealedServerSeed !== 'string') {
    toast('The bundle for this round has not been fetched yet.', true);
    return;
  }
  state.rederiving = true;
  state.rederived = null;
  render();
  try {
    state.rederived = await rederive({
      revealedServerSeed: bundle.revealedServerSeed,
      transcript: bundle.transcript,
      preCommitment: frame.fairness.preCommitment,
      publishedFingerprint: bundle.definition?.fingerprint ?? frame.fairness.fingerprint,
    });
  } finally {
    state.rederiving = false;
    render();
  }
}

function ghostRows(rows: readonly GhostRow[]): Child[] {
  const byArena = new Map<number, GhostRow[]>();
  for (const row of rows) byArena.set(row.arena, [...(byArena.get(row.arena) ?? []), row]);
  return [...byArena.entries()].map(([arena, group]) =>
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'route-name', text: `Arena ${arena}` }),
      ...group.map((row) =>
        el(
          'div',
          { class: 'field' },
          el('span', {
            class: 'label',
            text: `${row.route}${row.laneSplit === null ? '' : ` ${row.laneSplit}+${row.survivors.length + row.fallen.length - row.laneSplit}`}${row.taken ? ' (taken)' : ''}`,
          }),
          el('span', {
            class: 'value',
            text:
              row.fallen.length === 0
                ? 'all across'
                : `${row.fallen.join(', ')} fell`,
          }),
        ),
      ),
    ),
  );
}

function hashRow(label: string, value: string, note: string): HTMLElement {
  return el(
    'div',
    { style: 'margin-bottom:10px' },
    el('div', { class: 'small', text: label }),
    el('div', { class: 'hash', text: value }),
    el('div', { class: 'tiny', text: note }),
  );
}

/* ------------------------------------------------------------------- S9 */

/**
 * Settings and responsible play (`DESIGN.md` §S9).
 *
 * Everything §10.2 calls a build requirement is a control here and is enforced
 * on the server: the reality-check interval, a session time limit, a session
 * loss limit and the self-exclusion hand-off. The rest of §S9 — the odds tables,
 * §10 in plain language, the audio and motion toggles, the quality-tier override
 * — is here too, with the honest note about what each one can do in a free-play
 * prototype that has one in-memory session and no account behind it.
 */
function settingsScreen(): HTMLElement {
  const config = state.config as Config;
  const session = state.session as Session;
  const speed = config.speed;
  const patch = (body: object) =>
    void guard(async () => {
      adopt(await api('POST', '/api/session', body));
    });
  const limitMinutes = session.sessionLimitMinutes;
  const lossLimit = session.sessionLossLimitMicro;

  return el(
    'div',
    { class: 'screen fade-in' },
    el(
      'div',
      { class: 'surface pad stack' },
      el('h1', { text: 'Settings and responsible play' }),

      el('h2', { text: 'Limits' }),
      session.stakingBlock
        ? el('p', { class: 'note', text: `Staking is off for this session. ${session.stakingBlock.message}` })
        : null,
      el(
        'div',
        { class: 'spread' },
        el('span', { text: 'Reality check' }),
        el(
          'div',
          { class: 'row' },
          ...[15, 30, 60].map((minutes) =>
            el('button', {
              class: 'chip',
              'aria-pressed': String(session.realityCheckIntervalMs === minutes * 60_000),
              text: `${minutes}m`,
              onClick: () => patch({ realityCheckMinutes: minutes }),
            }),
          ),
        ),
      ),
      el('p', {
        class: 'tiny',
        text: `It pauses the game and states the session in plain figures. Next one in ${Math.max(0, Math.ceil(session.realityCheckDueMs / 60000))} min.`,
      }),
      el(
        'div',
        { class: 'spread' },
        el('span', { text: 'Session time limit' }),
        el(
          'div',
          { class: 'row' },
          ...[30, 60, 120].map((minutes) =>
            el('button', {
              class: 'chip',
              'aria-pressed': String(limitMinutes === minutes),
              text: `${minutes}m`,
              onClick: () => patch({ sessionLimitMinutes: limitMinutes === minutes ? null : minutes }),
            }),
          ),
        ),
      ),
      el(
        'div',
        { class: 'spread' },
        el('span', { text: 'Session loss limit' }),
        el(
          'div',
          { class: 'row' },
          ...([
            ['25.00', '25000000'],
            ['50.00', '50000000'],
            ['100.00', '100000000'],
          ] as const).map(([label, value]) =>
            el('button', {
              class: 'chip money',
              'aria-pressed': String(lossLimit === value),
              text: label,
              onClick: () => patch({ sessionLossLimitMicro: lossLimit === value ? null : value }),
            }),
          ),
        ),
      ),
      el('p', {
        class: 'tiny',
        text: 'When either limit is reached the game stops taking stakes for the rest of this session. A round already open still finishes — money already staked is never stranded by a limit.',
      }),
      el(
        'div',
        { class: 'spread' },
        el('span', { text: 'Stop for this session' }),
        el('button', {
          class: 'chip',
          'aria-pressed': String(session.selfExcluded),
          text: session.selfExcluded ? 'stopped' : 'stop',
          onClick: () => {
            if (session.selfExcluded) return;
            state.sheet = {
              title: 'Stop for this session',
              body: () => frag(
                el('p', {
                  class: 'note',
                  text: 'This turns staking off for the rest of this session and cannot be turned back on here.',
                }),
                el('p', {
                  class: 'note',
                  text: 'In a real deployment this is where the operator’s self-exclusion flow takes over, and it survives closing the app, because it belongs to an account. This prototype has no account: the setting lasts as long as the server does, and saying otherwise would be the dishonest part.',
                }),
                el('button', {
                  class: 'btn',
                  text: 'Stop staking for this session',
                  onClick: () => {
                    state.sheet = null;
                    patch({ selfExclude: true });
                  },
                }),
              ),
            };
            render();
          },
        }),
      ),

      el('hr', {}),
      el('h2', { text: 'The game' }),
      toggle('Reduced motion', session.reducedMotion, (value) => ({ reducedMotion: value })),
      el('p', {
        class: 'tiny',
        text: 'Every beat still happens and every figure still says the same thing; the traversal between two states becomes the second state. Your system setting turns this on by itself.',
      }),
      toggle('Sound', session.audioEnabled, (value) => ({ audioEnabled: value })),
      el('p', {
        class: 'tiny',
        text: 'The mix is synthesised in the browser — wind, the squad’s footfalls, a bell. It carries state and never information: every figure, route and outcome is readable with it off. A browser will not start audio without a tap, so the first tap anywhere is what opens it.',
      }),
      toggle('Ghost Line', session.ghostLineEnabled, (value) => ({ ghostLineEnabled: value })),
      toggle('Side bets', session.sideBetsOptedIn, (value) => ({ sideBetsOptedIn: value })),
      toggle('Show every control', session.showEverything, (value) => ({ showEverything: value })),
      /*
       * §9's clip export, and §10.7's switch for it.
       *
       * Off by default, one tap to turn off permanently, never re-prompted. It is
       * a *device* preference rather than a session one, because the session is
       * server state and this build's server is closed — the copy says so rather
       * than implying an account-level setting the build does not have. The
       * operator's per-jurisdiction advertising switch (§10.7) sits above this
       * one and is not this repository's to implement.
       */
      ...(clip.supported()
        ? [
            el(
              'div',
              { class: 'spread' },
              el('span', { text: 'Save the clip' }),
              el('button', {
                class: 'chip',
                'aria-pressed': String(clip.optedIn()),
                text: clip.optedIn() ? 'on' : 'off',
                onClick: () => {
                  sound.tap('toggle');
                  clip.setOptedIn(!clip.optedIn());
                  render();
                },
              }),
            ),
            el('p', {
              class: 'tiny',
              text: 'After a round with a Last Lamp beat in it, the six seconds of that beat can be saved as a watermarked video on this device — the round id, its verification code and an 18+ mark, and no stake, claim or balance anywhere in the file. Saving earns nothing and is never asked for. This preference is kept on this device, not on an account.',
            }),
          ]
        : []),
      el(
        'div',
        { class: 'spread' },
        el('span', { text: 'Quality' }),
        el(
          'div',
          { class: 'row' },
          ...['auto', 'high', 'medium', 'low'].map((tier) =>
            el('button', {
              class: 'chip',
              'aria-pressed': String(session.qualityTier === tier),
              text: tier,
              onClick: () => patch({ qualityTier: tier }),
            }),
          ),
        ),
      ),
      el('p', {
        class: 'tiny',
        text: 'Lower tiers draw the same world with less in the air: fewer fog planes, no dust, and a lower render resolution. Auto reads how many cores this device reports and picks for you. Nothing here changes a figure, a route or an outcome.',
      }),

      el('hr', {}),
      el('h2', { text: 'The numbers' }),
      field('Return to player', `${config.money.rtpPct4} (${config.money.rtpExact})`),
      field('House edge', config.money.houseEdgePct),
      field('Charged', 'once per ticket, never per arena'),
      field('Stakes', `${config.money.minStakeCredits} – ${config.money.maxStakeCredits}`),
      field('Side bet ceiling', `${config.money.sideBetRatio} of the route stake, per bet and per round`),
      field('Max-win cap', `${config.money.maxWinMultiple}x per ticket`),
      field('Minimum game cycle', `${speed.minGameCycleMs} ms per ${String(speed.cycleUnit)}`),
      el('button', {
        class: 'btn quiet',
        text: 'Every route’s full odds ▸',
        onClick: () => {
          const squad = config.game.squadSize;
          state.sheet = {
            title: 'Full odds, every route',
            body: () => frag(
              ...['WIDE', 'SPLIT', 'NARROW']
                .map((route) => {
                  const key = route === 'SPLIT' ? `SPLIT:${squad}:${Math.ceil(squad / 2)}` : `${route}:${squad}`;
                  const figures = config.paytable[key];
                  return figures
                    ? frag(
                        el('h3', { text: `${route} — ${figures.display.multiplier}` }),
                        oddsTable(figures),
                      )
                    : null;
                })
                .filter((node): node is DocumentFragment => node !== null),
              el('p', {
                class: 'tiny',
                text: 'The odds are never gated: this table is reachable from the first frame, including for routes not yet on offer (§5.2.5 rule 4).',
              }),
            ),
          };
          render();
        },
      }),
      el('p', {
        class: 'tiny',
        text: `Speed of play declared against ${String(speed.standard)} ${String(speed.standardEdition)}, ${String(speed.provision)}. Verified against a certified copy: ${speed.provisionVerifiedAgainstCertifiedCopy ? 'yes' : 'no'}.`,
      }),

      el('hr', {}),
      el('h2', { text: 'What this game does not do' }),
      el('p', { class: 'note', text: 'No autoplay. No auto-rebet. No double-or-nothing. No offer after a losing round. No countdown on any decision, ever.' }),
      el('p', { class: 'note', text: 'Every route returns the same. There is no skill in this game and nothing here will tell you otherwise.' }),
      el('p', { class: 'note', text: 'Cosmetics never change the odds. Choosing who runs where changes who comes home; it does not change the odds.' }),
      el('p', { class: 'tiny', text: 'Free-play prototype. No real money, no certification claimed.' }),
    ),
    el(
      'div',
      { class: 'footer' },
      el('button', {
        class: 'btn',
        text: 'Back',
        onClick: () => {
          state.view = state.frame && state.frame.phase !== 'SETTLED' ? 'route' : 'squad';
          render();
        },
      }),
    ),
  );
}

function toggle(label: string, value: boolean, patch: (next: boolean) => object): HTMLElement {
  return el(
    'div',
    { class: 'spread' },
    el('span', { text: label }),
    el('button', {
      class: 'chip',
      'aria-pressed': String(value),
      text: value ? 'on' : 'off',
      onClick: () =>
        void guard(async () => {
          adopt(await api('POST', '/api/session', patch(!value)));
        }),
    }),
  );
}

/* ------------------------------------------------------------- rehearsal */

function startRehearsal(): void {
  stopBeat();
  stage.reset();
  state.rehearsalChoices = [];
  state.rehearsalStage = 0;
  state.route = 'WIDE';
  state.laneSplit = null;
  state.shelter = [];
  void guard(async () => {
    const payload = await api<{ result: RehearsalResult; session: Session; wallet: WalletView }>(
      'POST',
      '/api/rehearsal/replay',
      { choices: [] },
    );
    state.rehearsal = payload.result;
    adopt(payload);
    state.view = 'rehearsal';
    // The Two-Card Moment, once, before the first commitment (§5.2.4).
    const config = state.config as Config;
    const wide = config.paytable['WIDE:5'] as Figures;
    const narrow = config.paytable['NARROW:5'] as Figures;
    state.sheet = {
      title: 'Two cards, one axis',
      body: () => frag(
        el(
          'div',
          { class: 'row', style: 'align-items:flex-start;gap:12px' },
          el(
            'div',
            { style: 'flex:1' },
            el('div', { class: 'route-name', text: 'WIDE' }),
            el('div', { class: 'multiplier money', text: wide.display.multiplier }),
            // An explicit height: in a sheet there is no flex column above the chart
            // to give it one, and a chart with no height is an axis with no bars.
            distributionBars(wide, 96),
            field('nobody', wide.display.wipePct),
            field('all five', wide.display.allClearPct),
          ),
          el(
            'div',
            { style: 'flex:1' },
            el('div', { class: 'route-name', text: 'NARROW' }),
            el('div', { class: 'multiplier money', text: narrow.display.multiplier }),
            distributionBars(narrow, 96),
            field('nobody', narrow.display.wipePct),
            field('all five', narrow.display.allClearPct),
          ),
        ),
        el('p', {
          class: 'note',
          style: 'text-align:center',
          text: `Both of these return ${config.money.rtpPct}. ${COPY.twoCardFooter}`,
        }),
      ),
    };
  });
}

function rehearsalScreen(): HTMLElement {
  const config = state.config as Config;
  const result = state.rehearsal as RehearsalResult;
  // Not `stage`: that name belongs to the imported canvas director in this module.
  const stageIndex = state.rehearsalStage;
  const played = result.arenas.length;
  const running =
    played === 0 ? config.game.squadSize : (result.arenas[played - 1]?.survivors.length ?? 0);
  const offered = (config.rehearsal.disclosure[stageIndex] ?? []) as readonly string[];
  const last = result.arenas[played - 1];
  const over = result.over;

  const squad = config.game.defaultRunnerNames.map((name, slot) => {
    const alive = played === 0 || (last?.survivors.some((runner) => runner.slot === slot) ?? false);
    const sheltered = result.arenas.some((arena) =>
      arena.shelter.some((runner) => runner.slot === slot),
    );
    return {
      slot,
      name,
      status: (sheltered ? 'home' : alive ? 'running' : 'lost') as 'home' | 'running' | 'lost',
      valueMicro: '0',
      valueDisplay: '0',
    };
  });

  const figuresOfRoute = (route: string): Figures | null => {
    const key =
      route === 'SPLIT'
        ? `SPLIT:${running}:${Math.ceil(running / 2)}`
        : route === 'SHELTER'
          ? `WIDE:${Math.max(1, running - 1)}`
          : `${route}:${running}`;
    return config.paytable[key] ?? null;
  };
  const onOffer = offered.filter((route) => figuresOfRoute(route) !== null);
  const pickRehearsalRoute = (route: string): void => {
    state.route = route as 'WIDE' | 'SPLIT' | 'NARROW' | 'SHELTER';
    state.laneSplit = route === 'SPLIT' ? Math.ceil(running / 2) : null;
    state.shelter = route === 'SHELTER' ? [0] : [];
    render();
  };
  pagerPick = pickRehearsalRoute;
  if (!onOffer.includes(state.route) && onOffer.length > 0)
    state.route = onOffer[0] as 'WIDE' | 'SPLIT' | 'NARROW' | 'SHELTER';

  const cards = onOffer.map((route) => {
    const figures = figuresOfRoute(route) as Figures;
    return routeCard({
      route,
      fiction: config.game.routeTitles[route] ?? '',
      figures,
      selected: state.route === route,
      rtp: config.money.rtpPct,
      onSelect: () => pickRehearsalRoute(route),
      onOdds: () => {
        state.sheet = { title: `${route} — every outcome, exactly`, body: () => oddsTable(figures) };
        render();
      },
      onCompare: () => {
        const other = onOffer.find((candidate) => candidate !== route);
        const otherFigures = other ? figuresOfRoute(other) : null;
        state.sheet = {
          title: other ? `${route} against ${other}` : route,
          body: () => frag(
            el(
              'div',
              { class: 'row', style: 'align-items:flex-start;gap:12px' },
              el(
                'div',
                { style: 'flex:1' },
                el('div', { class: 'route-name', text: route }),
                el('div', { class: 'multiplier money', text: figures.display.multiplier }),
                distributionBars(figures, 84),
                field('nobody', figures.display.wipePct),
                field(`all ${figures.running}`, figures.display.allClearPct),
              ),
              otherFigures
                ? el(
                    'div',
                    { style: 'flex:1' },
                    el('div', { class: 'route-name', text: other as string }),
                    el('div', { class: 'multiplier money', text: otherFigures.display.multiplier }),
                    distributionBars(otherFigures, 84),
                    field('nobody', otherFigures.display.wipePct),
                    field(`all ${otherFigures.running}`, otherFigures.display.allClearPct),
                  )
                : null,
            ),
            el('p', {
              class: 'note',
              style: 'text-align:center',
              text: `Both of these return ${config.money.rtpPct}. ${COPY.twoCardFooter}`,
            }),
          ),
        };
        render();
      },
    });
  });

  return el(
    'div',
    { class: 'screen route-screen fade-in' },
    viewport({
      title: over ? 'Rehearsal' : (config.game.arenaNames[stageIndex] ?? ''),
      subtitle: over ? 'Three branches, no stake.' : (config.game.arenaSubtitles[stageIndex] ?? ''),
      counter: `${Math.min(stageIndex + 1, config.rehearsal.arenas)} / ${config.rehearsal.arenas}`,
      lanes: 1,
      arena: Math.min(config.rehearsal.arenas, stageIndex + 1),
      mode: over ? 'quiet' : 'brief',
      compact: true,
      runners: squad
        .filter((member) => member.status !== 'lost')
        .map((member) => ({ slot: member.slot, name: member.name, status: member.status, lane: 0 })),
      progress: over ? 0.9 : 0.05,
    }),
    el(
      'div',
      { class: 'claim-meter' },
      el(
        'div',
        { class: 'claim-line' },
        el('div', { class: 'claim-figure money', text: result.claim }),
        el('div', { class: 'claim-caption', text: 'claim, of a notional stake of 1.000' }),
      ),
      el(
        'div',
        { class: 'pips' },
        ...squad.map((member) =>
          el(
            'div',
            { class: `pip ${member.status}` },
            el('span', { class: 'dot' }),
            el('span', { class: 'who runner-name', text: member.name }),
          ),
        ),
      ),
      el('div', { class: 'badge rehearsal', text: COPY.rehearsalChip }),
      Number(result.banked) > 0
        ? el('div', { class: 'banked-row money', text: `${result.banked} sheltered` })
        : null,
    ),
    over
      ? el(
          'div',
          { class: 'surface pad stack' },
          el('h2', { text: result.wiped ? 'That is the other ending.' : COPY.rehearsalBanked }),
          el('p', {
            class: 'note',
            text: result.wiped
              ? `It is ${config.money.rtpPct} either way — the route only changes how often it looks like this.`
              : `You would be holding ${result.total} of a notional stake of 1.000. ${COPY.noPayout}`,
          }),
          el('p', { class: 'note', text: COPY.practiceSeed }),
          el('div', { class: 'hash', text: `server seed ${result.seedPair.serverSeed}` }),
          el('div', { class: 'hash', text: `client seed ${result.seedPair.clientEntropy}` }),
          el('div', { class: 'hash', text: `tape digest ${result.tapeDigest}` }),
          el('h3', { text: 'The Ghost Line' }),
          el('p', { class: 'note', text: COPY.ghostNote }),
          ...ghostRows(result.ghost),
        )
      : frag(
          routeTabs(
            onOffer.map((route) => ({
              route,
              multiplier: (figuresOfRoute(route) as Figures).display.multiplier,
            })),
            state.route,
            pickRehearsalRoute,
          ),
          el('p', {
            class: 'thesis',
            text: played === 0 ? COPY.claimIntro : COPY.everyRoute,
          }),
          last
            ? el(
                'div',
                { class: 'resolve-line' },
                el('p', { class: 'money', text: last.arithmetic }),
                el('p', {
                  class: last.fallen.length > 0 ? 'tiny lost-name' : 'tiny',
                  text:
                    last.fallen.length > 0
                      ? `${last.fallen.map((runner) => runner.name).join(', ')} did not make it. ${played === 1 ? COPY.firstResolve : played === 2 ? COPY.splitAppears : ''}`
                      : 'Everyone is across.',
                }),
              )
            : null,
          el('div', { class: 'card-pager', onScroll: onPagerScroll }, ...cards),
        ),
    el(
      'div',
      { class: 'footer' },
      over
        ? el(
            'div',
            { class: 'btn-row' },
            el('button', {
              class: 'btn',
              text: 'Back to the squad',
              onClick: () => {
                state.view = 'squad';
                render();
              },
            }),
            el('button', { class: 'btn', text: 'New practice run', onClick: () => startRehearsal() }),
          )
        : el('button', {
            class: 'btn primary',
            text: 'Commit route',
            onClick: () => commitRehearsal(running),
          }),
      el('p', { class: 'tiny', text: COPY.noPayout }),
    ),
  );
}

function commitRehearsal(running: number): void {
  const choice = {
    route: state.route,
    laneSplit: state.route === 'SPLIT' ? (state.laneSplit ?? Math.ceil(running / 2)) : null,
    shelter: state.route === 'SHELTER' ? (state.shelter.length > 0 ? state.shelter : [0]) : [],
  };
  void guard(async () => {
    const choices = [...state.rehearsalChoices, choice];
    const payload = await api<{ result: RehearsalResult; session: Session; wallet: WalletView }>(
      'POST',
      '/api/rehearsal/replay',
      { choices },
    );
    state.rehearsalChoices = choices;
    state.rehearsal = payload.result;
    state.rehearsalStage = choices.length;
    state.route = 'WIDE';
    state.laneSplit = null;
    state.shelter = [];
    adopt(payload);
  });
}

/* ------------------------------------------------------------------ boot */

/**
 * The idle poll, which exists for exactly one reason.
 *
 * The reality check is measured on the server's session clock, and a player who
 * sits on the resolve screen for half an hour makes no requests — so without
 * this, the pause §10.2 requires would wait for the next tap. The poll re-renders
 * only when something the player can act on changed; the clock in the session
 * strip is nudged in place, because a screen that rebuilds itself under a
 * half-finished swipe is the defect this build spent its first round fixing.
 */
function startSessionPoll(): void {
  window.setInterval(() => {
    if (state.busy || state.rederiving || !state.session) return;
    void (async () => {
      const wasDue = realityCheckDue();
      const wasBlocked = state.session?.stakingBlock?.code ?? null;
      try {
        const payload = await api<{ session: Session; wallet: WalletView }>('GET', '/api/session');
        state.session = payload.session;
        state.wallet = payload.wallet;
      } catch {
        return; // a stale strip for twenty seconds is not worth a toast
      }
      if (realityCheckDue() !== wasDue || (state.session.stakingBlock?.code ?? null) !== wasBlocked) {
        render();
        return;
      }
      // The figure only: the word beside it is a sibling text node, and writing
      // the whole string back would take the numeral floor's element with it.
      const clock = root.querySelector('.session-strip .clock .num');
      if (clock) clock.textContent = `${Math.floor(state.session.elapsedMs / 60000)}m`;
    })();
  }, 20_000);
}

async function boot(): Promise<void> {
  installTapFeedback();
  state.config = await api<Config>('GET', '/api/config');
  const session = await api<{ session: Session; wallet: WalletView; openRoundId: string | null }>(
    'GET',
    '/api/session',
  );
  state.session = session.session;
  state.wallet = session.wallet;
  sound.setEnabled(session.session.audioEnabled);
  setCalmPreference(session.session.reducedMotion);
  if (session.openRoundId) {
    /*
     * A round is server-side state; closing the app mid-round is safe and
     * resuming restores the exact frame (§2.1). Which screen that frame belongs
     * on depends on its phase, and the first build sent every phase to the route
     * screen — so a player who closed the app mid-arena came back to a decision
     * screen for an arena they had already committed, and `resolveArena` refused
     * to run because it only runs from the run screen.
     */
    const payload = await api<{ frame: Frame }>('GET', `/api/rounds/${session.openRoundId}`);
    state.frame = payload.frame;
    if (payload.frame.phase === 'RUNNING') {
      // The arena is committed and the tape already decided it. Land on the run
      // screen and finish resolving it; if the speed-of-play floor has not passed
      // the `skip` control is the retry.
      state.view = 'run';
      state.runStartedAt = Date.now();
      void resolveArena();
    } else if (payload.frame.phase === 'FINISHED') {
      // Every arena has been run: the claim is decided and the only thing left is
      // the settle, so take it instead of drawing a decision screen with no
      // decision on it.
      await finishRound();
    } else state.view = 'route';
  }
  render();
  startSessionPoll();
}

void boot();
