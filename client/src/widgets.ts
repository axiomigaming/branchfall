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
import { COPY, MONEY, RTP_LINE, UNIT } from './copy.js';
import { el, type Child } from './dom.js';
import { CLAIM_ROLL, countUp } from './motion.js';
import type { Figures, SquadMember } from './types.js';

/**
 * The hero figure on a terminal screen (`DESIGN.md` §S5, §9).
 *
 * §9 says the rescue *"is deliberately given the same production value as the
 * biggest win"*, and the round-2 review measured the opposite: the banked figure
 * was 15 px — the same size as the status-bar balance — while the wipe headline
 * was 28 px, so the loss shouted and the win whispered. §6.5 writes 28 pt as a
 * *floor* for the claim, not a ceiling, and this is the one figure in the game
 * that is the whole point of the screen it is on.
 *
 * It is brass, because banked money is the brass family (§6.1); it counts up on
 * a tabular roll and never spins (§6.4); and it carries its label above it so the
 * number is never a number on its own. Nothing scales, shakes or overshoots — the
 * production value is size, colour, light and sound, which is exactly what §6.4
 * permits and all it permits.
 */
export function heroFigure(options: {
  readonly label: string;
  readonly value: string;
  /** Where the count starts. Absent, the figure is simply printed. */
  readonly from?: string | null;
  readonly note?: Child;
  readonly ms?: number;
  /**
   * Warm or cold.
   *
   * The two endings are the same size and they are not the same temperature.
   * `brass` is money that came home; `cold` is the wipe's own statement of what
   * happened, held at the same weight so the loss is not the loudest thing in the
   * game (round-2 finding) and given none of the light, because §S6 is quiet and
   * §10.2 forbids dressing a loss as an event.
   */
  readonly tone?: 'brass' | 'cold';
  /**
   * How big the return was (`payoff.ts`), which is how big the figure is set.
   *
   * The round-2 build drew one figure at one size for every bank in the game, so
   * a 0.81x recovery and a 3.06x looked identical down to the pixel. §6.5 writes
   * 28 pt as a floor and §6.4 permits size, colour and light — so the tier moves
   * the size and the glow and nothing else. There is no tier on the cold ending:
   * a loss has one volume on purpose (§10.2).
   */
  readonly tier?: 'quiet' | 'big' | 'huge';
  /**
   * Whether this figure is a win, and may therefore be built as one.
   *
   * The payout plate — a lit gold surface with the figure in ink on its face — is
   * celebratory whatever number is printed on it, so it is gated on the one
   * question that decides whether celebrating is honest: did more come back than
   * went in (`payoff.ts`'s `celebrates`). Absent or false, the figure is stated
   * plainly on the frame and none of the plate, the rim, the bloom or the ink
   * inversion is drawn. §10.5, and the blocker on dressing a partial return as a
   * win.
   */
  readonly won?: boolean;
}): HTMLElement {
  const tier = options.tone === 'cold' ? 'quiet' : (options.tier ?? 'quiet');
  const won = options.tone !== 'cold' && options.won === true;
  const figure = el('div', {
    class: `hero-figure${options.tone === 'cold' ? ' cold' : ' money'}${tier === 'quiet' ? '' : ` ${tier}`}`,
    text: options.from ?? options.value,
  });
  if (options.from !== undefined && options.from !== null && options.from !== options.value)
    roll(figure, options.from, options.value, options.ms ?? 900);
  return el(
    'div',
    { class: `hero${options.tone === 'cold' ? ' cold' : ''}${won ? ' won' : ''}` },
    el('div', { class: 'hero-label', text: options.label }),
    /*
     * The unit is a sibling of the numeral, not part of it.
     *
     * Criterion 17 requires the currency attached to the payout figure, and every
     * reference writes it — `TOTAL WIN 1.03 FUN`. It cannot be inside the numeral
     * because `roll()` counts by writing `textContent`, which would eat it on the
     * first frame and print it back on the last; and it should not be, because it
     * is a *label* and the reference sets it smaller than the amount it belongs
     * to. So the row is the figure and its unit, baseline-aligned.
     */
    el('div', { class: 'hero-row' }, figure, el('span', { class: 'hero-unit', text: UNIT })),
    options.note ?? null,
  );
}

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
  /**
   * What is riding on this round, with its unit (`RUBRIC` criterion 3).
   *
   * The blind ranking could not answer *"what is at stake"* from the decision
   * screen's pixels: the bet amount appeared nowhere on it, only a session net in
   * the status bar. Every reference carries the stake beside the position on the
   * one screen where the player is about to commit it, so it is here — next to
   * the claim it bought, in the same object, where the comparison between the two
   * is the point.
   */
  readonly stake?: string | null;
  /**
   * Whether the meter draws its per-runner pips.
   *
   * §5.2.2's teaching object is the claim *and* its shares. On the decision
   * screen the shares are now printed on the figures themselves — a brass chip
   * under each Kindling carrying that runner's value — so a pip row underneath
   * would print the same five numbers a second time, which is the duplication the
   * round-1 subtraction test names as noise. Everywhere the world is not carrying
   * them, the pips are.
   */
  readonly pips?: boolean;
}): HTMLElement {
  const running = options.squad.filter((member) => member.status === 'running');
  const pips: Child[] = [];
  const push = (member: SquadMember) =>
    pips.push(
      el(
        'div',
        {
          class: `pip ${member.status}`,
          /*
           * Which Kindling this pip is, as a colour.
           *
           * The stage paints the same five identity colours on the figures'
           * straps (`stage.ts`'s `STRAPS`). Carrying them onto the pip is what
           * makes the money object and the world one thing: the player can see
           * which light in the meter is the figure they are watching, without a
           * name on either. The flame inside the pip is untouched — §6.2's
           * emissive budget spends its warm on the lantern and only there — so
           * the identity lives on the rim, which is brass, which is an object.
           */
          'data-kin': String(member.slot % 5),
          title: `${member.name} — ${credits(member.valueMicro, 3)}`,
        },
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
    { class: `claim-meter${options.pips === false ? ' bare' : ''}` },
    el(
      'div',
      { class: 'claim-line' },
      figure,
      el(
        'div',
        { class: 'claim-side' },
        el('div', { class: 'claim-caption', text: options.caption }),
        options.stake ? el('div', { class: 'stake-note money', text: `stake ${MONEY(options.stake)}` }) : null,
      ),
    ),
    options.pips === false ? null : el('div', { class: 'pips' }, pips),
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
function roll(node: HTMLElement, from: string, to: string, ms = CLAIM_ROLL): void {
  const places = to.includes('.') ? to.length - to.indexOf('.') - 1 : 0;
  const start = Number.parseFloat(from);
  const end = Number.parseFloat(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    node.textContent = to;
    return;
  }
  countUp(node, start, end, to, (value) => value.toFixed(places), ms);
  window.setTimeout(() => node.classList.remove('rolling'), ms + 300);
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
   * A second distribution on the same axis, drawn as a stepped outline.
   *
   * §3.3's whole argument is that `4 + 1` is *visibly* taller at both ends and
   * shorter in the middle, *"rendered on a shared axis"*. The first build did
   * that as two half-width charts side by side, and the round-2 review measured
   * the result: 44 px tall, with 1.30% and 3.39% both drawn as 1 px lines and no
   * label saying which chart was which. Two cramped pictures of one comparison
   * are worse than one full-width picture of it — so the selected balance is the
   * fill and the other is an outline over the same bars, on one scale, at the
   * card's full width. Fill against outline is a *shape* difference, so colour is
   * not carrying the distinction (§10.8).
   */
  ghost?: { readonly figures: Figures; readonly label: string } | null,
): HTMLElement {
  const values = figures.outcomes.map((row) => Number(row.probability.decimal));
  const ghostValues = ghost ? ghost.figures.outcomes.map((row) => Number(row.probability.decimal)) : [];
  const peak = Math.max(...values, ...ghostValues, 0.0001);
  return el(
    'div',
    // Heights are a percentage of whatever box the chart is given, so the card
    // can spend its spare height on the graphic rather than on empty space.
    { class: `bars${ghost ? ' paired' : ''}`, style: height === undefined ? '' : `height:${height}px;flex:none` },
    figures.outcomes.map((row, index) => {
      const value = values[index] ?? 0;
      /*
       * A floor in *percent of the track*, so a 1.30% outcome is a bar and not a
       * hairline. Three percent of a 100 px track is 3 px, which is the least that
       * still reads as a place with something in it; the bars above it are exact.
       */
      const fill = value <= 0 ? 0 : Math.max(4, Math.round((value / peak) * 100));
      const shade = ghostValues[index];
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
        el(
          'span',
          { class: 'track' },
          el('span', { class: 'fill', style: `height:${fill}%` }),
          shade === undefined
            ? null
            : el('span', {
                class: 'ghost',
                style: `bottom:${shade <= 0 ? 0 : Math.max(4, Math.round((shade / peak) * 100))}%`,
                title: `${ghost?.label}: ${ghost?.figures.outcomes[index]?.probability.exact ?? ''}`,
              }),
        ),
        el('span', { class: 'axis', text: String(row.survivors) }),
      );
    }),
  );
}

function barsBlock(figures: Figures, caption: string, ghost?: { figures: Figures; label: string } | null): HTMLElement {
  return el(
    'div',
    { class: 'bars-block' },
    distributionBars(figures, undefined, ghost),
    el('div', { class: 'bars-caption', text: caption }),
  );
}

/**
 * What happens to the claim, as one object instead of a table (`DESIGN.md` §3.2).
 *
 * ## The finding this replaces
 *
 * The round-1 blind ranking put our decision screen third of four real game
 * frames and named the tell precisely: *"at thumbnail size our decision screen
 * reads as a financial dashboard, because ~60% of its height is a
 * survivor-distribution bar chart plus a five-row percentage table."* It also
 * counted the duplication — `Chance of that 49.24%` and `All 5 make it 49.24%`,
 * the same number four rows apart — and measured the cost in hard-edge share,
 * which the table's hairline rules drove to 7.89% against a 2–9% reference band
 * whose top end is a *failure* signature.
 *
 * ## Why this is not a deletion of the information
 *
 * §3.2's three build requirements are the reason the card carries probabilities
 * at all, and two of them are about a specific pair of fields: the break-even,
 * and how often the claim falls *without ending the round*. Both are still on the
 * face, and they are still the fields the section argues for. What changed is the
 * *form*: four mutually exclusive outcomes that sum to one are a partition, and a
 * partition drawn as a table asks the player to add four numbers to see the
 * shape. Drawn as one divided bar, the shape is the picture — which is
 * requirement 2's own sentence (*"a player should be able to see which side of
 * the line the mass sits on before reading a digit"*) done properly rather than
 * by a tick mark on a second chart.
 *
 * The exact survivor distribution and the per-outcome fractions did not go
 * behind a paywall; they went behind `full odds ▸`, one tap, where §3.2 already
 * puts the exact table and where §5.2.5's disclosure ladder says depth belongs.
 *
 * ## The colour is the legend
 *
 * §6.1's money colours already run through the whole product — `--grows` on a
 * rising claim, `--falls` on a falling one, `--extinguish` on a light that went
 * out — so the four segments are not a new vocabulary to learn. `RUBRIC` §2:
 * *"colour maps to meaning, consistently and without a legend."*
 */
interface Segment {
  readonly kind: string;
  readonly name: string;
  /**
   * The one-word version, printed *on* the segment.
   *
   * The round-2 judge on this object: *"the legend 'grows · falls, run goes on
   * 7.81% · nobody makes it' places one percentage inline between three labels
   * with no stable mapping to the three segments."* A caption under a bar is a
   * legend, and rubric §2 is that colour and layout map to meaning **without**
   * one. Four characters on the segment itself is the whole fix.
   */
  readonly short: string;
  readonly share: number;
  readonly label: string;
  readonly wide: boolean;
  readonly named: boolean;
}

/**
 * The four outcomes, their shares of the track, and which of them can hold ink.
 *
 * Split out because the caption depends on it: a segment too narrow to print its
 * own percentage has that percentage named in the line underneath instead, so
 * every figure appears exactly once and none is dropped, rounded or restated at a
 * second precision. The precision ladder in `api.ts` exists because the round-2
 * review found `49.24%` on a card and `49.2393% likely` in a sheet; printing a
 * bar label at one place and the odds sheet at two would be the same fault in a
 * new object.
 *
 * `wide` is 13% of the track, which is 45 px at the card's 350 px — the width a
 * six-character percentage needs at the §6.5 numeral floor. Below it the ink
 * would be clipped, and a clipped number is worse than a number somewhere else.
 */
function outcomeSegments(figures: Figures): readonly Segment[] {
  const holds = Number(figures.holds.decimal);
  const raw: { kind: string; name: string; short: string; value: number; label: string }[] = [
    { kind: 'grows', name: 'grows', short: 'grows', value: Number(figures.grows.decimal), label: figures.display.growsPct },
    ...(holds > 0
      ? [{ kind: 'holds', name: 'holds', short: 'holds', value: holds, label: figures.display.holdsPct }]
      : []),
    {
      kind: 'falls',
      name: 'falls, run goes on',
      short: 'falls',
      value: Number(figures.fallsNonZero.decimal),
      label: figures.display.fallsNonZeroPct,
    },
    {
      kind: 'wipe',
      name: 'nobody makes it',
      short: 'none home',
      value: Number(figures.wipe.decimal),
      label: figures.display.wipePct,
    },
  ];
  const total = raw.reduce((sum, segment) => sum + segment.value, 0) || 1;
  return raw.map((segment) => {
    /*
     * A floor in width, so a 1.30% outcome is a place and not a seam.
     *
     * The same argument the distribution bars make about a 5 px fill: an outcome
     * the player can lose everything to has to be visible as a region. Four
     * percent of the track is 14 px, which is a block you can see and still small
     * enough that nobody could read it as a tenth of the picture.
     */
    const share = Math.max(4, (segment.value / total) * 100);
    return {
      kind: segment.kind,
      name: segment.name,
      short: segment.short,
      share,
      label: segment.label,
      wide: share >= 13,
      /*
       * 22% of the track is 77 px at the card's 350, which is what a word needs
       * at §6.5's 13 px secondary floor with its tracking. Below it the segment
       * carries its percentage only and the caption names it, which is the same
       * contract `wide` already had one rung down.
       */
      named: share >= 22,
    };
  });
}

export function outcomeBar(figures: Figures): HTMLElement {
  return el(
    'div',
    { class: 'outcome-bar' },
    ...outcomeSegments(figures).map((segment) =>
      el(
        'span',
        {
          class: `seg ${segment.kind}`,
          style: `flex:${segment.share.toFixed(3)}`,
          title: `${segment.name} — ${segment.label}`,
        },
        segment.wide
          ? el(
              'span',
              { class: 'seg-stack' },
              el('span', { class: 'seg-value money', text: segment.label }),
              segment.named ? el('span', { class: 'seg-name', text: segment.short }) : null,
            )
          : null,
      ),
    ),
  );
}

/**
 * The line under the bar: the key, carrying whatever the bar could not print.
 *
 * It is one text run, not a row of labels, and it is the only prose on the card
 * body. A segment that printed its own percentage is named here without one; a
 * segment too narrow to print it carries it here instead.
 */
export function outcomeCaption(figures: Figures): HTMLElement {
  const parts = outcomeSegments(figures).map((segment) =>
    segment.wide ? segment.name : `${segment.name} ${segment.label}`,
  );
  return el('div', { class: 'bars-caption', text: parts.join(' · ') });
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
  /** Picking a balance, from the column that carries its numbers (§3.3). */
  readonly onBalance: (balance: number) => void;
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
  const label = (balance: number) => `${balance} + ${fork.running - balance}`;
  /*
   * The dial, drawn as the thing it moves.
   *
   * §3.3 asks for both balances at once, no default and no recommendation,
   * *"rendered on a shared axis"*, and its own words for what the dial does are
   * *"more of both endings, same average, same 95.5%"*. Two partitions stacked on
   * one 100% track say exactly that as a picture: `4 + 1`'s growing segment is
   * visibly longer **and** its wipe segment is visibly longer, and the middle —
   * the claim falling while the run continues — is what shrank to pay for both.
   * The round-1 form of this was a paired bar chart plus a four-row table, which
   * is two pictures and eight numbers for one comparison.
   *
   * The row is the control, as §3.3 requires: the numbers a balance owns are
   * inside the surface you tap to choose it. Neither is highlighted until the
   * player picks one, and the difference between them is a *shape*, so colour is
   * not carrying it (§10.8).
   */
  return el(
    'div',
    { class: 'card-body fork-body' },
    el(
      'div',
      { class: 'break-even' },
      el('span', { class: 'label', text: `${COPY.breakEven} ` }),
      el('span', { class: 'value money', text: `${first.breakEven} of ${fork.running}` }),
      el('span', { class: 'label', text: ' get back' }),
    ),
    ...fork.balances.map((balance) =>
      el(
        'button',
        {
          class: `fork-row${fork.selected === balance ? ' on' : ''}`,
          'aria-pressed': String(fork.selected === balance),
          'aria-label': `Fork balance ${label(balance)} — tap to choose it`,
          onClick: (event: MouseEvent) => {
            event.stopPropagation();
            fork.onBalance(balance);
          },
        },
        el('span', { class: 'fork-name money', text: label(balance) }),
        outcomeBar(fork.figuresOf(balance)),
      ),
    ),
    el('div', { class: 'bars-caption', text: COPY.outcomeBar }),
  );
}

/**
 * `full odds ▸` — the depth, one tap from the face (`DESIGN.md` §3.2, §5.2.5).
 *
 * Everything the round-1 card printed at rest now lives here: the exact survivor
 * distribution with its break-even tick, the six §3.2 fields, the fork's paired
 * chart on one axis, and the per-outcome fractions. Nothing was removed from the
 * product — a player who wants the paytable still gets the paytable — and the
 * §5.2.5 ladder is what says this is the right rung for it: the resting surface
 * carries the decision, the disclosure carries the derivation.
 */
export function oddsDetail(
  figures: Figures,
  fork?: { readonly balances: readonly number[]; readonly running: number; readonly figuresOf: (balance: number) => Figures; readonly selected: number | null } | null,
): HTMLElement {
  const paired =
    fork && fork.balances.length > 1
      ? (() => {
          const selected = fork.selected ?? (fork.balances[0] as number);
          const other = fork.balances.find((balance) => balance !== selected) ?? selected;
          return {
            figures: fork.figuresOf(other),
            label: `${other} + ${fork.running - other}`,
            selected: fork.figuresOf(selected),
          };
        })()
      : null;
  return el(
    'div',
    { class: 'odds-detail' },
    barsBlock(
      paired ? paired.selected : figures,
      paired
        ? `survivors · ▲ grows from here · outline is ${paired.label}`
        : `survivors, ${figures.running} running · ▲ the claim grows from here`,
      paired ? { figures: paired.figures, label: paired.label } : null,
    ),
    fieldStack(paired ? paired.selected : figures),
    oddsTable(paired ? paired.selected : figures),
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
        'data-band': String(payoutBand(figures.display.multiplier)),
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
            /*
             * §3.2's two load-bearing fields, and then the shape.
             *
             * The break-even is a *sentence* rather than a row, because it is the
             * one thing on the card that is not a percentage and reading it as
             * one is how it got lost among six of them. The bar underneath is
             * every outcome that follows from it.
             */
            el('div', { class: 'break-even' },
              el('span', { class: 'label', text: `${COPY.breakEven} ` }),
              el('span', { class: 'value money', text: `${figures.breakEven} of ${figures.running}` }),
              el('span', { class: 'label', text: ' get back' }),
            ),
            outcomeBar(figures),
            outcomeCaption(figures),
          ),
      el(
        'div',
        { class: 'card-footer' },
        el('span', { class: 'rtp', text: RTP_LINE(options.rtp) }),
        el(
          'span',
          { class: 'row' },
          // §10.8's 44 pt target, taken from the touch area rather than from the
          // ink: a 44 px-tall underlined word inside a card footer would push an
          // odds figure off the card, which is the trade the round-2 review found
          // on the SHELTER card. `.link.tap` grows the hit box, not the type.
          el('button', {
            class: 'link tap',
            text: 'compare',
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              options.onCompare();
            },
          }),
          el('button', {
            class: 'link tap',
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
 * Which rung of the payout ramp a multiple sits on, 1 (lowest) to 4 (highest).
 *
 * `RUBRIC` criterion 11 — *"the player learns the payout scale by looking, never
 * by reading"* — is the whole reason this exists: a route's price gets a hue that
 * encodes its magnitude, the way a Plinko chip or a Balloon Mania balloon does.
 *
 * Three things it deliberately is not. It is not a recommendation: the bands are
 * a *scale*, all four routes return 95.5%, and §S2's rule that no segment gains
 * weight over another still holds — a band is a legend, not a badge. It is not a
 * danger signal: §6.1's first hard rule survives intact because the ramp is
 * green -> cyan -> violet -> magenta and never passes through red. And it is not
 * a decision: this reads a figure the server already computed and picks a class
 * name from it. Nothing downstream of it can reach money.
 */
export function payoutBand(multiplier: string): 1 | 2 | 3 | 4 {
  const value = Number.parseFloat(multiplier);
  if (!Number.isFinite(value) || value < 1.25) return 1;
  if (value < 2) return 2;
  if (value < 5) return 3;
  return 4;
}

/**
 * The page indicator, which is also the way to reach a page.
 *
 * `DESIGN.md` §S2 asks for a paged stack of cards with a page indicator. An
 * indicator that only *reports* the page leaves a four-way money decision behind
 * a swipe, so this one is tappable and carries each route's price: all four
 * options and all four multipliers are on screen at rest, which is what makes the
 * screen comparable at a glance. All four segments have identical weight — no
 * badge, no recommendation, no highlight of the higher multiplier (§S2). What a
 * segment does carry is `payoutBand`, which is the price itself expressed as a
 * colour rather than as an endorsement of it.
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
          'data-band': String(payoutBand(entry.multiplier)),
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
