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
import { claimMeter, distributionBars, field, oddsTable, routeCard } from './widgets.js';

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
};

const root = document.getElementById('app') as HTMLElement;
let cycleTimer: number | undefined;

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
  if (state.toast)
    root.appendChild(
      el('div', { class: `toast${state.toast.bad ? ' error' : ''}`, text: state.toast.message }),
    );
  startCycleTicker();
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
    { class: 'viewport' },
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
      el('button', { class: 'btn primary', text: 'Buy the run', onClick: () => buyRun() }),
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

function figuresFor(entry: MenuEntry, laneSplit: number | null, shelterSize: number): Figures {
  if (entry.route === 'SHELTER') {
    const found = entry.figures.find((candidate) => candidate.shelterSize === shelterSize);
    return (found ?? entry.figures[0])?.figures as Figures;
  }
  const found = entry.figures.find((candidate) => (candidate.laneSplit ?? null) === laneSplit);
  return (found ?? entry.figures[0])?.figures as Figures;
}

function routeScreen(): HTMLElement {
  const frame = state.frame as Frame;
  const config = state.config as Config;
  const session = state.session as Session;
  const live = frame.live;
  const running = live.length;

  if (state.route === 'SPLIT' && state.laneSplit === null) {
    const split = frame.menu.find((entry) => entry.route === 'SPLIT');
    state.laneSplit = (split?.laneSplits[0] as number) ?? null;
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

  const canCommit =
    state.route !== 'SHELTER' || (shelterSize >= 1 && shelterSize <= running - 1);

  return el(
    'div',
    { class: 'screen fade-in' },
    viewport({
      title: frame.arena.name,
      subtitle: frame.arena.subtitle,
      counter: `${frame.arena.index} / ${frame.arena.of}`,
      lanes: state.route === 'SPLIT' ? 2 : 1,
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
      perRunner: frame.claim.perRunnerDisplay,
      bankedNote: bankedNote(frame),
    }),
    el(
      'div',
      { class: 'surface' },
      el('p', { class: 'note pad', style: 'padding-bottom:0', text: COPY.everyRoute }),
      el(
        'div',
        { class: 'card-pager' },
        ...frame.menu.map((entry) => renderCard(entry, frame, config)),
      ),
      sideBetPanel(frame, session, selectedFigures),
      session.roundsSeen < 3
        ? el('p', { class: 'tiny pad', text: COPY.noClock })
        : null,
      !session.showEverything
        ? el(
            'div',
            { class: 'pad' },
            el('button', {
              class: 'btn quiet',
              text: COPY.showEverything,
              onClick: () =>
                void guard(async () => {
                  adopt(await api('POST', '/api/session', { showEverything: true }));
                }),
            }),
          )
        : null,
    ),
    el(
      'div',
      { class: 'footer' },
      el(
        'div',
        { class: 'status' },
        el('span', { text: `claim ${frame.claim.display}` }),
        el('span', { text: `${running} of ${config.game.squadSize} running` }),
      ),
      el('button', {
        class: 'btn primary',
        text: commitLabel(),
        disabled: !canCommit,
        onClick: () => commitRoute(),
      }),
      cycleBar(frame),
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

  let extra: Child = null;
  if (entry.route === 'SPLIT' && entry.laneSplits.length > 1) extra = forkControl(entry, frame);
  else if (entry.route === 'SPLIT' && selected) extra = limbPicker(frame);
  else if (entry.route === 'SHELTER') extra = shelterPicker(entry, frame);

  return routeCard({
    title: entry.route,
    route: entry.route,
    fiction,
    figures,
    selected,
    rtp: config.money.rtpPct,
    headNote:
      entry.route === 'SHELTER'
        ? state.shelter.length > 0
          ? `Banks ${shelterCreditLabel(entry)} now. ${running - shelterSize} keep running, on the Broad Bough.`
          : `Bring one home and ${shelterCreditLabel(entry)} stops running. The rest cross on the Broad Bough.`
        : null,
    onSelect: () => {
      state.route = entry.route;
      if (entry.route !== 'SPLIT') state.laneOrder = null;
      if (entry.route !== 'SHELTER') state.shelter = [];
      if (entry.route === 'SPLIT' && state.laneSplit === null)
        state.laneSplit = (entry.laneSplits[0] as number) ?? null;
      if (entry.route !== 'SPLIT') state.laneSplit = null;
      render();
    },
    onOdds: () => {
      state.sheet = {
        title: `${entry.route} — every outcome, exactly`,
        body: frag(
          el('p', { class: 'note', text: `Multiplier ${figures.multiplier.exact} = ${figures.display.multiplier}.` }),
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
    extra,
  });
}

function shelterCreditLabel(entry: MenuEntry): string {
  const size = Math.max(1, state.shelter.length);
  const found = entry.figures.find((candidate) => candidate.shelterSize === size);
  return credits(found?.banksMicro ?? '0', 3);
}

/**
 * The fork balance (`DESIGN.md` §3.3).
 *
 * Both columns shown at once, always, with no default highlighted and no
 * recommendation. The added line under them is the honest one: `4 + 1` is the
 * wider spread — a mean-preserving spread of `3 + 2` — so the copy may not call
 * it a balanced trade, and may not call it the wrong choice either.
 */
function forkControl(entry: MenuEntry, frame: Frame): Child {
  const running = frame.live.length;
  const balances = entry.laneSplits.filter((value): value is number => value !== null);
  const rows: [string, (figures: Figures) => string][] = [
    ['Nobody makes it', (figures) => figures.display.wipePct],
    [`All ${running} make it`, (figures) => figures.display.allClearPct],
    ['Claim grows', (figures) => figures.display.growsPct],
    ['One alone comes home', (figures) => figures.display.solePct],
  ];
  const figuresOf = (balance: number) =>
    (entry.figures.find((candidate) => candidate.laneSplit === balance)?.figures as Figures);

  return el(
    'div',
    { class: 'fork' },
    el(
      'div',
      { class: 'balance-tabs' },
      ...balances.map((balance) =>
        el('button', {
          class: 'balance-tab',
          'aria-pressed': String(state.laneSplit === balance),
          text: `${balance} + ${running - balance}`,
          onClick: (event: MouseEvent) => {
            event.stopPropagation();
            state.route = 'SPLIT';
            state.laneSplit = balance;
            render();
          },
        }),
      ),
    ),
    el(
      'table',
      { class: 'compare-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { text: '' }),
          ...balances.map((balance) => el('th', { text: `${balance} + ${running - balance}` })),
        ),
      ),
      el(
        'tbody',
        {},
        ...rows.map(([label, read]) =>
          el(
            'tr',
            {},
            el('td', { text: label }),
            ...balances.map((balance) => el('td', { text: read(figuresOf(balance)) })),
          ),
        ),
      ),
    ),
    el(
      'div',
      { class: 'row', style: 'gap:6px;margin-top:8px' },
      ...balances.map((balance) => distributionBars(figuresOf(balance))),
    ),
    el('p', {
      class: 'tiny',
      text: `Same 95.5% either way. ${balances[balances.length - 1]} + ${running - (balances[balances.length - 1] as number)} ${COPY.forkShape}`,
    }),
    limbPicker(frame),
  );
}

/**
 * Who takes the thin limb.
 *
 * Narratively enormous, mathematically inert, and the card says both in one line.
 * Runners are exchangeable (`MATH.md` §5.4): no assignment of names to positions
 * can move any moment of any distribution. What it changes is which committed
 * slip draw each named Kindling consumes — that is, who comes home.
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

  const chip = (name: string) =>
    el(
      'button',
      {
        class: 'chip',
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          move(name);
        },
      },
      el('span', { class: 'dot' }),
      el('span', { class: 'runner-name', text: name }),
    );

  return el(
    'div',
    {},
    el(
      'div',
      { class: 'limb-picker' },
      el('div', { class: 'limb' }, el('h4', { text: 'Broad limb' }), ...order.slice(0, split).map(chip)),
      el('div', { class: 'lane-gap' }),
      el('div', { class: 'limb' }, el('h4', { text: 'Thin limb' }), ...order.slice(split).map(chip)),
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
 */
function shelterPicker(entry: MenuEntry, frame: Frame): HTMLElement {
  const running = frame.squad.filter((member) => member.status === 'running');
  const chosen = state.shelter;
  const wouldEmpty = chosen.length >= running.length - 1;
  return el(
    'div',
    { class: 'fork' },
    el(
      'div',
      {},
      ...running.map((member) => {
        const picked = chosen.includes(member.slot);
        const inert = !picked && wouldEmpty;
        return el(
          'button',
          {
            class: `chip${inert ? ' inert' : ''}`,
            'aria-pressed': String(picked),
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
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
      class: 'tiny',
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
    state.sheet = {
      title: `${entry.route} against ${other.route}`,
      body: frag(
        el(
          'div',
          { class: 'row', style: 'align-items:flex-start;gap:12px' },
          el(
            'div',
            { style: 'flex:1' },
            el('div', { class: 'route-name', text: entry.route }),
            el('div', { class: 'multiplier', text: left.display.multiplier }),
            distributionBars(left),
            field('nobody', left.display.wipePct),
            field(`all ${left.running}`, left.display.allClearPct),
            field('claim grows', left.display.growsPct),
          ),
          el(
            'div',
            { style: 'flex:1' },
            el('div', { class: 'route-name', text: other.route }),
            el('div', { class: 'multiplier', text: right.display.multiplier }),
            distributionBars(right),
            field('nobody', right.display.wipePct),
            field(`all ${right.running}`, right.display.allClearPct),
            field('claim grows', right.display.growsPct),
          ),
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

function sideBetPanel(frame: Frame, session: Session, figures: Figures | null): Child {
  // Hidden entirely, never disabled, when the remaining allowance is under the
  // minimum — and a minimum-stake player therefore never sees it at all (§4).
  if (!frame.sideBets.offered || !figures || figures.sideBets.length === 0) return null;

  if (!session.sideBetsOptedIn)
    return el(
      'div',
      { class: 'sidebet' },
      el('p', { class: 'note', text: COPY.sideBetOptIn }),
      el('p', {
        class: 'tiny',
        text: `Worked example: ${figures.sideBets[0]?.label} on this geometry is ${figures.sideBets[0]?.probabilityPct} likely and pays ${figures.sideBets[0]?.multiplier.decimal}x — that is ${state.config?.money.rtpExact} divided by the probability, which is the only pricing rule there is.`,
      }),
      el('button', {
        class: 'btn quiet',
        text: '+ turn side bets on',
        onClick: () =>
          void guard(async () => {
            adopt(await api('POST', '/api/session', { sideBetsOptedIn: true }));
          }),
      }),
    );

  const remaining = micro(frame.sideBets.remainingMicro);
  const min = micro(frame.sideBets.minMicro);
  const staked = Object.values(state.sideBets).reduce((sum, value) => sum + value, 0n);

  return el(
    'div',
    { class: 'sidebet' },
    el(
      'div',
      { class: 'spread' },
      el('h3', { text: '+ side bet' }),
      el('span', {
        class: 'tiny',
        text: `up to ${credits(remaining, 2)} left this round — half your run`,
      }),
    ),
    ...figures.sideBets.map((offer) => {
      const current = state.sideBets[offer.id] ?? 0n;
      const step = min;
      return el(
        'div',
        { class: 'sidebet-row' },
        el(
          'div',
          {},
          el('div', { text: offer.label }),
          el('div', { class: 'tiny', text: `${offer.claim} ${offer.probabilityPct}` }),
        ),
        el('div', { class: 'money', text: `${offer.multiplier.decimal}x` }),
        el(
          'div',
          { class: 'stepper' },
          el('button', {
            text: '−',
            onClick: () => {
              const next = current - step;
              state.sideBets[offer.id] = next < 0n ? 0n : next;
              render();
            },
          }),
          el('span', { class: 'amount', text: credits(current, 2) }),
          el('button', {
            text: '+',
            onClick: () => {
              const next = current + step;
              if (staked - current + next > remaining) {
                toast('That is past this round’s side-bet allowance.', true);
                return;
              }
              state.sideBets[offer.id] = next;
              render();
            },
          }),
        ),
      );
    }),
    el('p', { class: 'tiny', text: COPY.lastLight }),
  );
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
      perRunner: frame.claim.perRunnerDisplay,
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
  const remaining = frame.speed.earliestNextActionAtMs - (Date.now() - skew);
  // Nothing to draw once the floor has passed: a full bar that never empties
  // reads as a meter, and this is not a meter.
  if (remaining <= 0) return null;
  const total = frame.speed.minGameCycleMs;
  const filled = Math.max(0, Math.min(1, 1 - remaining / total));
  return el(
    'div',
    { class: 'cycle', 'aria-hidden': 'true' },
    el('span', { style: `width:${(filled * 100).toFixed(1)}%` }),
  );
}

function startCycleTicker(): void {
  window.clearTimeout(cycleTimer);
  const frame = state.frame;
  if (!frame) return;
  if (state.view !== 'resolve' && state.view !== 'route') return;
  const remaining = frame.speed.earliestNextActionAtMs - Date.now();
  if (remaining <= 0) return;
  cycleTimer = window.setTimeout(() => render(), Math.min(400, remaining));
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
        ? el('button', { class: 'btn primary', text: 'Close the round', onClick: () => finishRound() })
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
    state.view = 'verify';
  });
}

function verifyScreen(): HTMLElement {
  const frame = state.frame as Frame;
  const verify = state.verify;
  const session = state.session as Session;
  const fairness = frame.fairness;
  const losing =
    micro(frame.settlement?.totalCreditedMicro ?? '0') <
    micro(frame.settlement?.routeStakeMicro ?? '0');
  const ghostCooling = losing && Date.now() - frame.lastLossAtMs < 60_000;

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
      el('h2', { text: 'Re-derived, here, now' }),
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

function settingsScreen(): HTMLElement {
  const config = state.config as Config;
  const session = state.session as Session;
  const speed = config.speed;
  return el(
    'div',
    { class: 'screen fade-in' },
    el(
      'div',
      { class: 'surface pad stack' },
      el('h1', { text: 'Settings and responsible play' }),
      toggle('Reduced motion', session.reducedMotion, (value) => ({ reducedMotion: value })),
      toggle('Ghost Line', session.ghostLineEnabled, (value) => ({ ghostLineEnabled: value })),
      toggle('Side bets', session.sideBetsOptedIn, (value) => ({ sideBetsOptedIn: value })),
      toggle('Show every control', session.showEverything, (value) => ({ showEverything: value })),
      el('hr', {}),
      el('h2', { text: 'The numbers' }),
      field('Return to player', `${config.money.rtpPct4} (${config.money.rtpExact})`),
      field('House edge', config.money.houseEdgePct),
      field('Charged', 'once per ticket, never per arena'),
      field('Stakes', `${config.money.minStakeCredits} – ${config.money.maxStakeCredits}`),
      field('Side bet ceiling', `${config.money.sideBetRatio} of the route stake, per bet and per round`),
      field('Max-win cap', `${config.money.maxWinMultiple}x per ticket`),
      field('Minimum game cycle', `${speed.minGameCycleMs} ms per ${String(speed.cycleUnit)}`),
      el('p', {
        class: 'tiny',
        text: `Speed of play declared against ${String(speed.standard)} ${String(speed.standardEdition)}, ${String(speed.provision)}. Verified against a certified copy: ${speed.provisionVerifiedAgainstCertifiedCopy ? 'yes' : 'no'}.`,
      }),
      el('hr', {}),
      el('h2', { text: 'What this game does not do' }),
      el('p', { class: 'note', text: 'No autoplay. No auto-rebet. No double-or-nothing. No offer after a losing round. No countdown on any decision, ever.' }),
      el('p', { class: 'note', text: 'Every route returns the same. There is no skill in this game and nothing here will tell you otherwise.' }),
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

  const cards = offered
    .map((route) => {
      const key =
        route === 'SPLIT'
          ? `SPLIT:${running}:${Math.ceil(running / 2)}`
          : route === 'SHELTER'
            ? `WIDE:${Math.max(1, running - 1)}`
            : `${route}:${running}`;
      const figures = config.paytable[key];
      if (!figures) return null;
      return routeCard({
        title: route,
        route,
        fiction: config.game.routeTitles[route] ?? '',
        figures,
        selected: state.route === route,
        rtp: config.money.rtpPct,
        onSelect: () => {
          state.route = route as 'WIDE' | 'SPLIT' | 'NARROW' | 'SHELTER';
          state.laneSplit = route === 'SPLIT' ? Math.ceil(running / 2) : null;
          state.shelter = route === 'SHELTER' ? [0] : [];
          render();
        },
        onOdds: () => {
          state.sheet = { title: `${route} — every outcome, exactly`, body: oddsTable(figures) };
          render();
        },
        onCompare: () => {
          state.sheet = { title: 'Compare', body: distributionBars(figures) };
          render();
        },
      });
    })
    .filter((card): card is HTMLElement => card !== null);

  return el(
    'div',
    { class: 'screen fade-in' },
    viewport({
      title: over ? 'Rehearsal' : (config.game.arenaNames[stage] ?? ''),
      subtitle: over ? 'Three branches, no stake.' : (config.game.arenaSubtitles[stage] ?? ''),
      counter: `${Math.min(stage + 1, config.rehearsal.arenas)} / ${config.rehearsal.arenas}`,
      lanes: 1,
      runners: squad
        .filter((member) => member.status !== 'lost')
        .map((member) => ({ name: member.name, status: member.status, lane: 0 })),
      progress: over ? 0.9 : 0.05,
    }),
    el(
      'div',
      { class: 'claim-meter' },
      el('div', { class: 'badge rehearsal', text: COPY.rehearsalChip }),
      el('div', { class: 'claim-figure money', text: result.claim }),
      el('div', { class: 'claim-caption', text: 'claim, as a multiple of a notional stake' }),
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
      Number(result.banked) > 0
        ? el('div', { class: 'banked-row money', text: `${result.banked} sheltered` })
        : null,
    ),
    el(
      'div',
      { class: 'surface' },
      el('p', { class: 'note pad', style: 'padding-bottom:0', text: played === 0 ? COPY.claimIntro : COPY.everyRoute }),
      last
        ? el(
            'div',
            { class: 'pad' },
            el('p', { class: 'money', text: last.arithmetic }),
            last.fallen.length > 0
              ? el('p', {
                  class: 'note lost-name',
                  text: `${last.fallen.map((runner) => runner.name).join(', ')} did not make it.`,
                })
              : el('p', { class: 'note', text: 'Everyone is across.' }),
            played === 1 ? el('p', { class: 'note', text: COPY.firstResolve }) : null,
            played === 2 ? el('p', { class: 'note', text: COPY.splitAppears }) : null,
          )
        : null,
      over
        ? el(
            'div',
            { class: 'pad stack' },
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
        : el('div', { class: 'card-pager' }, ...cards),
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
}

void boot();
