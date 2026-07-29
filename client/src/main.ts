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
import { ApiError, api, credits, idempotencyKey, isSeed, micro, newClientSeed } from './api.js';
import { COPY } from './copy.js';
import { rederive, type Rederivation } from './derive.js';
import { el, frag, type Child } from './dom.js';
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
import { claimMeter, distributionBars, field, oddsTable, routeCard, routeTabs } from './widgets.js';

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

interface Sheet {
  readonly title: string;
  readonly body: Child;
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
};

const root = document.getElementById('app') as HTMLElement;

function render(): void {
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
    el('span', { text: `session ${minutes}m` }),
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
        text: wallet ? `${wallet.netSign}${wallet.netDisplay}` : '—',
      }),
    ),
    el('button', {
      class: 'link',
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
      { class: 'sheet' },
      el(
        'div',
        { class: 'spread' },
        el('h2', { text: sheet.title }),
        el('button', {
          class: 'link',
          text: 'close',
          onClick: () => {
            state.sheet = null;
            render();
          },
        }),
      ),
      sheet.body,
    ),
  );
}

/** The world, at placeholder fidelity: a branch, fog, and the squad on it. */
function viewport(options: {
  readonly title: string;
  readonly subtitle: string;
  readonly counter: string;
  readonly runners: readonly { name: string; status: string; lane: number }[];
  readonly lanes: number;
  readonly progress?: number;
  readonly collapsed?: readonly boolean[];
  /**
   * On the decision screens the world is a band rather than the top 58% of the
   * frame. `DESIGN.md` §5's seam is written for the run, where the viewport
   * expands to full bleed; on S2 the decision is the screen, and a graybox
   * rectangle is not what the player is there to read.
   */
  readonly compact?: boolean;
}): HTMLElement {
  const progress = options.progress ?? 0.08;
  const branches: Child[] = [];
  for (let lane = 0; lane < Math.max(1, options.lanes); lane += 1)
    branches.push(
      el('div', {
        class: `branch${lane > 0 ? ' thin' : ''}${options.collapsed?.[lane] ? ' collapsed' : ''}`,
      }),
    );
  return el(
    'div',
    { class: `viewport${options.compact ? ' compact' : ''}` },
    branches,
    ...options.runners.map((runner, index) => {
      const top = runner.lane > 0 ? '70%' : '52%';
      // Spread along the branch, then travel with the replay. A real build moves
      // a rig along a spline; this moves a rectangle along a percentage.
      const lanePosition = options.runners.filter((_, before) => before < index && options.runners[before]?.lane === runner.lane).length;
      const spread = 9 + lanePosition * 10;
      const offset = Math.min(94, spread + progress * 45);
      return el(
        'div',
        {
          class: `kindling ${runner.status}`,
          style: `left:${offset}%; top:${top}`,
        },
        el('span', {
          class: 'tag runner-name',
          text: runner.name,
          style: index % 2 === 0 ? '' : 'top:-30px',
        }),
        el('span', { class: 'body' }),
        el('span', { class: 'lantern' }),
      );
    }),
    el('div', { class: 'fog' }),
    el(
      'div',
      { class: 'arena-label' },
      el(
        'div',
        {},
        el('h2', { text: options.title }),
        el('div', { class: 'fiction', text: options.subtitle }),
      ),
      el('div', { class: 'badge', text: options.counter }),
    ),
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
      runners: names.map((name) => ({ name, status: 'running', lane: 0 })),
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
        { class: 'row', style: 'flex-wrap:wrap;justify-content:center' },
        ...presets.map((preset) =>
          el('button', {
            class: 'chip',
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
              'width:100%;background:var(--void);border:1px solid var(--fog-mid);color:var(--mist);font-family:var(--mono);font-size:11px;padding:10px;border-radius:3px',
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
    state.view = 'route';
  });
}

function adopt(payload: { frame?: Frame; session?: Session; wallet?: WalletView }): void {
  if (payload.frame) state.frame = payload.frame;
  if (payload.session) state.session = payload.session;
  if (payload.wallet) state.wallet = payload.wallet;
}

function resetChoice(): void {
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

/** Two decimals of a server-computed decimal string. A truncation, never a division. */
function shortMultiplier(decimal: string): string {
  const dot = decimal.indexOf('.');
  return `${dot < 0 ? decimal : decimal.slice(0, dot + 3)}x`;
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
      compact: true,
      runners: orderedRunners(frame).map((runner, index) => ({
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
            class: 'link',
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

function orderedRunners(frame: Frame): { name: string; status: string }[] {
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
    headNote:
      entry.route === 'SHELTER'
        ? state.shelter.length > 0
          ? `Banks ${shelterCreditLabel(entry)} now. ${running - shelterSize} keep running, on the Broad Bough.`
          : `Bring one home and ${shelterCreditLabel(entry)} stops running. The rest cross on the Broad Bough.`
        : null,
    onSelect: () => {
      selectRoute(entry.route, frame);
      render();
    },
    onOdds: () => {
      state.sheet = {
        title: `${entry.route} — every outcome, exactly`,
        body: frag(
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
        distributionBars(figures, 46),
        el('div', { class: 'bars-caption', text: `survivors, ${figures.running} running` }),
        field('nobody', figures.display.wipePct),
        field(`all ${figures.running}`, figures.display.allClearPct),
        field('claim grows', figures.display.growsPct),
      );
    state.sheet = {
      title: `${entry.route} against ${other.route}`,
      body: frag(
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
    body: el(
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
    body: frag(
      el('p', { class: 'note', text: COPY.sideBetOptIn }),
      el('p', {
        class: 'note',
        text: `Worked example: ${offer?.label} on this geometry is ${offer?.probabilityPct} likely and pays ${offer?.multiplier.decimal}x — that is ${state.config?.money.rtpExact} divided by the probability, which is the only pricing rule there is.`,
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
          el('div', { class: 'tiny', text: `${offer.claim} · ${offer.probabilityPct} likely` }),
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
  state.sheet = { title: 'Side bets, this arena', body: build() };
  render();
}

/* ------------------------------------------------------------- commitment */

async function commitRoute(): Promise<void> {
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
    if (next.phase === 'FINISHED' && next.live.length === 0) {
      state.view = 'wipe';
      state.wipeAtMs = Date.now();
    } else state.view = 'resolve';
  });
}

/* ------------------------------------------------------------------- S3 */

function runScreen(): HTMLElement {
  const frame = state.frame as Frame;
  const elapsed = Date.now() - state.runStartedAt;
  const progress = Math.min(0.95, elapsed / 9000);
  const laneSizes =
    state.route === 'SPLIT' && state.laneSplit !== null
      ? [state.laneSplit, frame.live.length - state.laneSplit]
      : null;
  window.setTimeout(() => {
    if (state.view === 'run') render();
  }, 220);

  return el(
    'div',
    { class: 'screen' },
    viewport({
      title: frame.arena.name,
      subtitle: '',
      counter: `${frame.arena.index} / ${frame.arena.of}`,
      lanes: laneSizes ? 2 : 1,
      runners: orderedRunners(frame).map((runner, index) => ({
        name: runner.name,
        status: runner.status,
        lane: laneSizes && index >= (laneSizes[0] as number) ? 1 : 0,
      })),
      progress,
    }),
    el(
      'div',
      { class: 'surface pad stack' },
      el('div', { class: 'claim-figure money', text: frame.claim.display }),
      el('p', { class: 'tiny', text: `${frame.live.length} running` }),
      elapsed > 1500
        ? el(
            'div',
            {},
            el('button', {
              class: 'btn quiet',
              text: 'skip ▸',
              onClick: () => void resolveArena(),
            }),
            el('p', { class: 'tiny', text: COPY.skipNote }),
          )
        : null,
    ),
  );
}

/* ------------------------------------------------------------------- S4 */

function resolveScreen(): HTMLElement {
  const frame = state.frame as Frame;
  const arena = state.lastArena as ArenaRecord;
  const config = state.config as Config;
  const nextName = config.game.arenaNames[frame.arena.index - 1] ?? '';
  const finished = frame.phase === 'FINISHED';

  return el(
    'div',
    { class: 'screen fade-in' },
    viewport({
      title: arena.name,
      subtitle: arena.fallen.length > 0 ? 'The branch took some of them.' : 'They are across.',
      counter: `${arena.index} / ${frame.arena.of}`,
      lanes: arena.lanes.length,
      collapsed: arena.lanes.map((lane) => lane.collapsed),
      runners: [
        ...arena.survivors.map((runner) => ({ name: runner.name, status: 'running', lane: 0 })),
        ...arena.fallen.map((runner) => ({ name: runner.name, status: 'lost', lane: 1 })),
      ],
      progress: 0.9,
    }),
    claimMeter({
      claim: frame.claim.display,
      caption: 'claim',
      squad: frame.squad,
      bankedNote: bankedNote(frame),
    }),
    el(
      'div',
      { class: 'surface pad stack' },
      el('p', { class: 'money', text: arena.arithmetic }),
      arena.fallen.length > 0
        ? el(
            'p',
            { class: 'note' },
            ...arena.fallen.map((runner) =>
              el('span', { class: 'lost-name', text: `${runner.name} did not make it. ` }),
            ),
          )
        : el('p', { class: 'note', text: 'Everyone is across.' }),
      micro(arena.shelterCreditedMicro) > 0n
        ? el('p', {
            class: 'note banked-figure',
            text: `${arena.shelter.map((runner) => runner.name).join(', ')} came home — ${credits(arena.shelterCreditedMicro, 3)} banked.`,
          })
        : null,
      ...arena.sideBets.map((ticket) =>
        el('p', {
          class: 'note',
          text: `${ticket.bet.replace('_', ' ')} ${credits(ticket.stakeMicro, 2)} — ${ticket.won ? `paid ${credits(ticket.creditedMicro, 2)}` : 'lost'}.`,
        }),
      ),
      state.session && state.session.roundsSeen === 0 && arena.index === 1
        ? el('p', { class: 'note', text: COPY.firstResolve })
        : null,
    ),
    el(
      'div',
      { class: 'footer' },
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
    state.view = 'banked';
  });
}

async function finishRound(): Promise<void> {
  const frame = state.frame as Frame;
  await guard(async () => {
    const payload = await api<{ frame: Frame; session: Session; wallet: WalletView }>(
      'POST',
      `/api/rounds/${frame.roundId}/finish`,
      { idempotencyKey: idempotencyKey('finish') },
    );
    adopt(payload);
    state.view = payload.frame.live.length === 0 ? 'wipe' : 'banked';
  });
}

/* ------------------------------------------------------------- S5 and S6 */

function bankedScreen(): HTMLElement {
  const frame = state.frame as Frame;
  const settlement = frame.settlement;
  const total = micro(settlement?.totalCreditedMicro ?? '0');
  const staked = micro(settlement?.routeStakeMicro ?? '0') + micro(settlement?.sideBetStakeMicro ?? '0');
  return el(
    'div',
    { class: 'screen fade-in' },
    viewport({
      title: 'The Lamp House',
      subtitle: 'The door closes on a light that is still burning.',
      counter: 'banked',
      lanes: 1,
      runners: frame.squad
        .filter((member) => member.status === 'home')
        .map((member) => ({ name: member.name, status: 'home', lane: 0 })),
      progress: 0.5,
    }),
    el(
      'div',
      { class: 'surface pad stack' },
      el('h1', { class: 'money banked-figure', text: credits(total, 2) }),
      // Always stated against the stake. A sub-stake return is never a win (§10.5).
      // Always against the stake, and never presented as a win when it is not
      // one: a 0.76x recovery says 0.76x (§10.5).
      el('p', {
        class: 'note',
        text: `Home with ${credits(total, 2)} in total — that's ${settlement?.returnMultiple ?? '0'}x the ${credits(staked, 2)} you staked.`,
      }),
      ...frame.squad
        .filter((member) => member.status === 'home')
        .map((member) => el('p', { class: 'note', text: `${member.name} came home.` })),
      ...frame.squad
        .filter((member) => member.status === 'lost')
        .map((member) => el('p', { class: 'note lost-name', text: `${member.name} did not.` })),
    ),
    el(
      'div',
      { class: 'footer' },
      el('button', {
        class: 'btn primary',
        text: 'Round summary ▸',
        onClick: () => {
          state.view = 'summary';
          render();
        },
      }),
    ),
  );
}

function wipeScreen(): HTMLElement {
  const frame = state.frame as Frame;
  const settled = frame.settlement !== null;
  const sinceLoss = Date.now() - state.wipeAtMs;
  // Two seconds of fog and wind with no UI at all, then the rest fades in.
  if (sinceLoss < 2200) window.setTimeout(() => state.view === 'wipe' && render(), 2300 - sinceLoss);
  return el(
    'div',
    { class: 'screen fade-in' },
    el('div', { class: 'viewport' }, el('div', { class: 'fog' })),
    el(
      'div',
      { class: 'surface pad stack' },
      // Two full seconds of fog and wind with no UI at all (§S6).
      sinceLoss < 2000
        ? el('div', { class: 'quiet-hold', text: '' })
        : frag(
            el('h1', { text: 'No one made it back.' }),
            el('p', {
              class: 'note',
              text: `You staked ${credits(frame.stakeMicro, 2)}.`,
            }),
            micro(frame.settlement?.totalCreditedMicro ?? '0') > 0n
              ? el('p', {
                  class: 'note banked-figure',
                  text: `Sheltered and side bets, stated separately: ${credits(frame.settlement?.totalCreditedMicro ?? '0', 2)}.`,
                })
              : null,
          ),
    ),
    el(
      'div',
      { class: 'footer' },
      !settled
        ? // §S6 names one primary action, and it leads away from the stake
          // field. Closing the round is bookkeeping the player should not have
          // to ask for, so the button that says where it goes does both.
          el('button', {
            class: 'btn primary',
            text: 'Back to the squad',
            onClick: () =>
              void guard(async () => {
                const frame = state.frame as Frame;
                const payload = await api<{ frame: Frame; session: Session; wallet: WalletView }>(
                  'POST',
                  `/api/rounds/${frame.roundId}/finish`,
                  { idempotencyKey: idempotencyKey('finish') },
                );
                adopt(payload);
                state.view = 'squad';
              }),
          })
        : frag(
            // The primary action leads *away* from the stake field (§10.2).
            el('button', {
              class: 'btn primary',
              text: 'Back to the squad',
              onClick: () => {
                state.view = 'squad';
                render();
              },
            }),
            el('div', { style: 'height:10px' }),
            el('button', {
              class: 'btn quiet',
              text: 'Round summary',
              onClick: () => {
                state.view = 'summary';
                render();
              },
            }),
            // `Run again` appears only after 2 s, never pre-fills the previous
            // stake, and carries no offer of any kind. Promotional surfaces are
            // suppressed for 60 s after a losing round, and there are none here
            // to suppress.
            sinceLoss > 2000
              ? el('button', {
                  class: 'btn quiet',
                  text: 'Run again',
                  onClick: () => {
                    state.stakeMicro = micro(
                      (state.config as Config).money.minStakeMicro,
                    );
                    state.clientSeed = newClientSeed();
                    state.frame = null;
                    state.view = 'stake';
                    render();
                  },
                })
              : null,
          ),
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
          { class: 'card' },
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
      field('Net', `${credited >= staked ? '+' : '−'}${credits(credited >= staked ? credited - staked : staked - credited, 2)}`),
      el('p', { class: 'tiny', text: `Return ${settlement?.returnMultiple ?? '—'}x on everything staked.` }),
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
          `Arena ${arena.index + 1} · ${arena.contractId} — ${arena.survivors.length} of ${arena.running.length} across`,
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
              class: 'chip',
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
              body: frag(
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
      toggle('Sound', session.audioEnabled, (value) => ({ audioEnabled: value })),
      el('p', { class: 'tiny', text: 'The graybox has no audio in it yet, so the switch is a preference the sound wave will read, not a mute.' }),
      toggle('Ghost Line', session.ghostLineEnabled, (value) => ({ ghostLineEnabled: value })),
      toggle('Side bets', session.sideBetsOptedIn, (value) => ({ sideBetsOptedIn: value })),
      toggle('Show every control', session.showEverything, (value) => ({ showEverything: value })),
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
        text: '§6.8’s quality ladder is for the build that has a renderer in it. Here every shape is a placeholder, so the override is recorded and changes nothing you can see.',
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
            body: frag(
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
      body: frag(
        el(
          'div',
          { class: 'row', style: 'align-items:flex-start;gap:12px' },
          el(
            'div',
            { style: 'flex:1' },
            el('div', { class: 'route-name', text: 'WIDE' }),
            el('div', { class: 'multiplier', text: wide.display.multiplier }),
            distributionBars(wide),
            field('nobody', wide.display.wipePct),
            field('all five', wide.display.allClearPct),
          ),
          el(
            'div',
            { style: 'flex:1' },
            el('div', { class: 'route-name', text: 'NARROW' }),
            el('div', { class: 'multiplier', text: narrow.display.multiplier }),
            distributionBars(narrow),
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
  const stage = state.rehearsalStage;
  const played = result.arenas.length;
  const running =
    played === 0 ? config.game.squadSize : (result.arenas[played - 1]?.survivors.length ?? 0);
  const offered = (config.rehearsal.disclosure[stage] ?? []) as readonly string[];
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
        state.sheet = { title: `${route} — every outcome, exactly`, body: oddsTable(figures) };
        render();
      },
      onCompare: () => {
        const other = onOffer.find((candidate) => candidate !== route);
        const otherFigures = other ? figuresOfRoute(other) : null;
        state.sheet = {
          title: other ? `${route} against ${other}` : route,
          body: frag(
            el(
              'div',
              { class: 'row', style: 'align-items:flex-start;gap:12px' },
              el(
                'div',
                { style: 'flex:1' },
                el('div', { class: 'route-name', text: route }),
                el('div', { class: 'multiplier money', text: figures.display.multiplier }),
                distributionBars(figures, 46),
                field('nobody', figures.display.wipePct),
                field(`all ${figures.running}`, figures.display.allClearPct),
              ),
              otherFigures
                ? el(
                    'div',
                    { style: 'flex:1' },
                    el('div', { class: 'route-name', text: other as string }),
                    el('div', { class: 'multiplier money', text: otherFigures.display.multiplier }),
                    distributionBars(otherFigures, 46),
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
      title: over ? 'Rehearsal' : (config.game.arenaNames[stage] ?? ''),
      subtitle: over ? 'Three branches, no stake.' : (config.game.arenaSubtitles[stage] ?? ''),
      counter: `${Math.min(stage + 1, config.rehearsal.arenas)} / ${config.rehearsal.arenas}`,
      lanes: 1,
      compact: true,
      runners: squad
        .filter((member) => member.status !== 'lost')
        .map((member) => ({ name: member.name, status: member.status, lane: 0 })),
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
      const clock = root.querySelector('.session-strip span');
      if (clock) clock.textContent = `session ${Math.floor(state.session.elapsedMs / 60000)}m`;
    })();
  }, 20_000);
}

async function boot(): Promise<void> {
  state.config = await api<Config>('GET', '/api/config');
  const session = await api<{ session: Session; wallet: WalletView; openRoundId: string | null }>(
    'GET',
    '/api/session',
  );
  state.session = session.session;
  state.wallet = session.wallet;
  if (session.openRoundId) {
    // A round is server-side state; closing the app mid-round is safe and
    // resuming restores the exact frame (§2.1).
    const payload = await api<{ frame: Frame }>('GET', `/api/rounds/${session.openRoundId}`);
    state.frame = payload.frame;
    state.view = payload.frame.phase === 'RUNNING' ? 'route' : 'route';
    if (payload.frame.phase === 'RUNNING') void resolveArena();
  }
  render();
  startSessionPoll();
}

void boot();
