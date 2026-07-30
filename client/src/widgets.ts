/**
 * The two objects the product is actually made of: the claim meter and the route
 * card. Everything else on the screen is a container for one of them.
 *
 * Both are built to a hard constraint that is not decoration: on the baseline
 * device (390 x 844) the whole decision has to sit in one unscrolled viewport —
 * four options with their prices, the position value, and the primary action —
 * because `DESIGN.md` §3.2's Two-Card Moment is an argument about *comparison at
 * a glance*, and a card you have to scroll to read is not one. So every field the
 * specification puts on the card face is on the card face, and the card is sized
 * to fit rather than sized to whatever the fields happened to need.
 */
import { credits } from './api.js';
import { RTP_LINE } from './copy.js';
import { el, type Child } from './dom.js';
import { countUp } from './motion.js';
import type { Figures, SquadMember } from './types.js';

/**
 * The claim meter (`DESIGN.md` §5.2.2).
 *
 * *"The strongest thing we can do for comprehension is refuse to build a
 * tutorial-only explanation."* One pip per share, each labelled with its own
 * value, present in the rehearsal and in real rounds, never dismissed. On a Split
 * the pips group into two clusters matching the lane sizes, so lane membership is
 * legible in the money object and not only in the 3D scene.
 *
 * The pip carries the value and not the name: the value is the thing §5.2.2 asks
 * for, and it is money, so it is held to the 15 pt numeral floor in §6.5. The
 * names are on the figures in the scene above and on every picker that assigns
 * them, which is where a player is choosing between them.
 */
export function claimMeter(options: {
  readonly claim: string;
  readonly caption: string;
  readonly squad: readonly SquadMember[];
  readonly laneSizes?: readonly number[] | null;
  readonly bankedNote?: string | null;
  readonly perRunner?: string | null;
  /**
   * Where the claim figure starts, when it is about to move.
   *
   * §S4: *"the claim number rolls (tabular, ~600 ms, no spinning)"*. The screen
   * that knows the claim has just changed passes the old value here; the meter
   * prints that and counts to `claim`. Absent, the figure is simply printed —
   * which is every other screen, because a claim that has not moved must not
   * animate as though it had.
   */
  readonly rollFrom?: string | null;
}): HTMLElement {
  const running = options.squad.filter((member) => member.status === 'running');
  const pips: Child[] = [];
  const push = (member: SquadMember) =>
    pips.push(
      el(
        'div',
        { class: `pip ${member.status}`, title: `${member.name} — ${credits(member.valueMicro, 3)}` },
        el('span', { class: 'dot' }),
        el('span', { class: 'value', text: credits(member.valueMicro, 3) }),
      ),
    );

  if (options.laneSizes && options.laneSizes.length > 1) {
    let cursor = 0;
    options.laneSizes.forEach((size, index) => {
      if (index > 0) pips.push(el('div', { class: 'lane-gap' }));
      for (const member of running.slice(cursor, cursor + size)) push(member);
      cursor += size;
    });
    for (const member of options.squad.filter((candidate) => candidate.status !== 'running'))
      push(member);
  } else {
    for (const member of options.squad) push(member);
  }

  const rollFrom = options.rollFrom ?? null;
  const figure = el('div', {
    class: `claim-figure money${rollFrom !== null && rollFrom !== options.claim ? ' rolling' : ''}`,
    text: rollFrom ?? options.claim,
  });
  if (rollFrom !== null && rollFrom !== options.claim) roll(figure, rollFrom, options.claim);

  return el(
    'div',
    { class: 'claim-meter' },
    el('div', { class: 'claim-line' }, figure, el('div', { class: 'claim-caption', text: options.caption })),
    el('div', { class: 'pips' }, pips),
    options.bankedNote
      ? el('div', { class: 'banked-row money', text: options.bankedNote })
      : null,
  );
}

/**
 * The claim, counting from one value to another.
 *
 * Two rules from §6.4 and §S4 are load-bearing and both are about *not* doing
 * something: it is a tabular roll and **never a slot-machine spin**, and a
 * multiplier must never reflow while counting. So the width is fixed by taking the
 * decimal places from the destination string and formatting every intermediate
 * value to the same ones — the digits change and the box does not — and the final
 * frame writes the server's own string rather than a rounding of it.
 */
function roll(node: HTMLElement, from: string, to: string): void {
  const places = to.includes('.') ? to.length - to.indexOf('.') - 1 : 0;
  const start = Number.parseFloat(from);
  const end = Number.parseFloat(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    node.textContent = to;
    return;
  }
  countUp(node, start, end, to, (value) => value.toFixed(places));
  window.setTimeout(() => node.classList.remove('rolling'), 900);
}

/**
 * The exact distribution bars, with the break-even tick.
 *
 * Bars are scaled against the geometry's own largest probability so the shape is
 * readable at any squad size. The tick is the build requirement in §3.2: a player
 * should be able to see which side of the line the mass sits on before reading a
 * digit.
 */
export function distributionBars(
  figures: Figures,
  height?: number,
  /**
   * A shared denominator, for the fork's two charts.
   *
   * §3.3's whole argument is that `4 + 1` is *visibly* taller at both ends and
   * shorter in the middle. Normalising each chart against its own peak would
   * rescale that difference away and draw two charts that look alike, which is
   * the opposite of what the control is for.
   */
  scale?: number,
): HTMLElement {
  const values = figures.outcomes.map((row) => Number(row.probability.decimal));
  const peak = Math.max(scale ?? 0, ...values, 0.0001);
  return el(
    'div',
    // Heights are a percentage of whatever box the chart is given, so the card
    // can spend its spare height on the graphic rather than on empty space.
    { class: 'bars', style: height === undefined ? '' : `height:${height}px;flex:none` },
    figures.outcomes.map((row, index) => {
      const fill = Math.max(3, Math.round(((values[index] ?? 0) / peak) * 100));
      return el(
        'div',
        {
          class: `bar ${row.direction}${row.survivors === figures.breakEven ? ' breakeven' : ''}`,
          title: `${row.survivors} back — ${row.probability.exact}`,
        },
        // The fill is a percentage of its own track, and the track is what is
        // left after the axis numeral has taken its line. Resolving the height
        // against the whole bar instead let the flex box shrink the tallest
        // fills unevenly, which drew two identical probabilities at two
        // different heights — a chart that lies about the one thing it is for.
        el('span', { class: 'track' }, el('span', { class: 'fill', style: `height:${fill}%` })),
        el('span', { class: 'axis', text: String(row.survivors) }),
      );
    }),
  );
}

function barsBlock(figures: Figures, caption: string): HTMLElement {
  return el(
    'div',
    { class: 'bars-block' },
    distributionBars(figures),
    el('div', { class: 'bars-caption', text: caption }),
  );
}

export function field(label: string, value: string, emphasis = false): HTMLElement {
  return el(
    'div',
    { class: `field${emphasis ? ' emphasis' : ''}` },
    el('span', { class: 'label', text: label }),
    el('span', { class: 'value money', text: value }),
  );
}

/** The six §3.2 fields, on the face, in the same weight, at every squad size. */
function fieldStack(figures: Figures): HTMLElement {
  return el(
    'div',
    { class: 'fields' },
    field('Your claim grows if', `${figures.breakEven} of ${figures.running} get back`, true),
    field('Chance of that', figures.display.growsPct),
    Number(figures.holds.decimal) > 0 ? field('Chance it holds', figures.display.holdsPct) : null,
    field('Claim falls, run goes on', figures.display.fallsNonZeroPct),
    field('Nobody makes it', figures.display.wipePct),
    field(`All ${figures.running} make it`, figures.display.allClearPct),
    field('Expected survivors', figures.display.expectedSurvivors),
  );
}

export interface ForkView {
  readonly balances: readonly number[];
  readonly running: number;
  readonly figuresOf: (balance: number) => Figures;
  readonly selected: number | null;
}

/**
 * The fork's two columns, on the card face (`DESIGN.md` §3.3).
 *
 * Both balances are shown at once, always, with no default highlighted and no
 * recommendation, on a shared axis. The two numbers that are identical on both —
 * the break-even and the expected survivors — are stated once above the columns
 * rather than printed twice, because their being identical is the content: the
 * dial moves the tails and nothing else.
 */
function forkBody(fork: ForkView): HTMLElement {
  const first = fork.figuresOf(fork.balances[0] as number);
  const rows: [string, (figures: Figures) => string][] = [
    ['Chance of that', (figures) => figures.display.growsPct],
    ['Nobody makes it', (figures) => figures.display.wipePct],
    [`All ${fork.running} make it`, (figures) => figures.display.allClearPct],
    ['One alone comes home', (figures) => figures.display.solePct],
    ['Expected survivors', (figures) => figures.display.expectedSurvivors],
  ];
  const shared = Math.max(
    ...fork.balances.flatMap((balance) =>
      fork.figuresOf(balance).outcomes.map((row) => Number(row.probability.decimal)),
    ),
  );
  return el(
    'div',
    { class: 'card-body' },
    el(
      'div',
      { class: 'bars-pair' },
      ...fork.balances.map((balance) =>
        el(
          'div',
          { class: `bars-half${fork.selected === balance ? ' on' : ''}` },
          distributionBars(fork.figuresOf(balance), undefined, shared),
        ),
      ),
    ),
    field('Your claim grows if', `${first.breakEven} of ${fork.running} get back`, true),
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
          ...fork.balances.map((balance) =>
            el('th', {
              class: fork.selected === balance ? 'on' : '',
              text: `${balance} + ${fork.running - balance}`,
            }),
          ),
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
            ...fork.balances.map((balance) =>
              el('td', {
                class: fork.selected === balance ? 'on' : '',
                text: read(fork.figuresOf(balance)),
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * A route card (`DESIGN.md` §3.2) — the most important UI object in the game.
 *
 * Every field on the face, in the same weight, at every squad size: the
 * multiplier, the break-even, the chance the claim grows, the chance nobody
 * makes it, the chance everybody does, expected survivors, and the footer that
 * says every route returns the same. The two fields the v2 card did not carry —
 * where the claim turns, and how often it falls *without ending the round* — are
 * on the face and never behind `full odds`.
 *
 * What is *not* on the card is any control that names a Kindling. The fork
 * balance, who takes the thin limb and who comes home are decisions, and they
 * live in the thumb zone directly above `Commit route` (§5, "all primary actions
 * in the bottom 280 pt"), where they are visible while you build the selection
 * rather than somewhere inside a card you are also being asked to read.
 */
export function routeCard(options: {
  readonly route: string;
  readonly fiction: string;
  readonly figures: Figures;
  readonly selected: boolean;
  readonly rtp: string;
  readonly onSelect: () => void;
  readonly onOdds: () => void;
  readonly onCompare: () => void;
  readonly fork?: ForkView | null;
  readonly headNote?: string | null;
}): HTMLElement {
  const figures = options.figures;
  return el(
    'div',
    { class: 'card-page', 'data-route': options.route },
    el(
      'section',
      {
        class: `card${options.selected ? ' selected' : ''}`,
        onClick: options.onSelect,
      },
      el(
        'div',
        { class: 'card-head' },
        el(
          'div',
          { class: 'card-title' },
          el('div', { class: 'route-name', text: options.route }),
          el('div', { class: 'fiction', text: options.fiction }),
        ),
        el(
          'div',
          { class: 'card-price' },
          el('div', { class: 'multiplier money', text: figures.display.multiplier }),
          el('div', { class: 'tiny', text: 'per runner who clears' }),
        ),
      ),
      options.headNote ? el('div', { class: 'head-note', text: options.headNote }) : null,
      options.fork
        ? forkBody(options.fork)
        : el(
            'div',
            { class: 'card-body' },
            barsBlock(
              figures,
              `survivors, ${figures.running} running · ▲ the claim grows from here`,
            ),
            fieldStack(figures),
          ),
      el(
        'div',
        { class: 'card-footer' },
        el('span', { text: RTP_LINE(options.rtp) }),
        el(
          'span',
          { class: 'row' },
          el('button', {
            class: 'link',
            text: 'compare',
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              options.onCompare();
            },
          }),
          el('button', {
            class: 'link',
            text: 'full odds ▸',
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              options.onOdds();
            },
          }),
        ),
      ),
    ),
  );
}

/**
 * The page indicator, which is also the way to reach a page.
 *
 * `DESIGN.md` §S2 asks for a paged stack of cards with a page indicator. An
 * indicator that only *reports* the page leaves a four-way money decision behind
 * a swipe, so this one is tappable and carries each route's price: all four
 * options and all four multipliers are on screen at rest, which is what makes the
 * screen comparable at a glance. All four segments have identical weight — no
 * badge, no recommendation, no highlight of the higher multiplier (§S2).
 */
export function routeTabs(
  entries: readonly { readonly route: string; readonly multiplier: string }[],
  selected: string,
  onPick: (route: string) => void,
): HTMLElement {
  return el(
    'div',
    { class: 'route-tabs', role: 'tablist' },
    ...entries.map((entry) =>
      el(
        'button',
        {
          class: 'route-tab',
          role: 'tab',
          'aria-selected': String(entry.route === selected),
          onClick: () => onPick(entry.route),
        },
        el('span', { class: 'route-name', text: entry.route }),
        el('span', { class: 'money', text: entry.multiplier }),
      ),
    ),
  );
}

/**
 * The exact per-outcome table — the same rows as `MATH.md` §5.2, as fractions.
 *
 * Wrapped in its own scroller. A twelve-digit exact denominator does not always
 * fit four columns across a 390 pt screen at the §6.5 numeral floor, and the
 * answer to that is a table that moves sideways, not a numeral that shrinks.
 */
export function oddsTable(figures: Figures): HTMLElement {
  return el(
    'div',
    { class: 'odds-scroll' },
    el(
      'table',
      { class: 'odds-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { text: 'Back' }),
          el('th', { text: 'Probability' }),
          el('th', { text: 'Exact' }),
          el('th', { text: 'Claim x' }),
        ),
      ),
      el(
        'tbody',
        {},
        figures.outcomes.map((row) =>
          el(
            'tr',
            {},
            el('td', { text: String(row.survivors) }),
            el('td', { text: row.probability.decimal.slice(0, 10) }),
            el('td', { text: row.probability.exact }),
            el('td', { text: row.claimFactor.exact }),
          ),
        ),
      ),
    ),
  );
}
